import {
  KERNEL_EVENT_VERSION,
  type KernelEvent,
} from "../../shared/kernelContract";
import type { KernelEventBus } from "./eventBus";
import type {
  RunContext,
  RuntimeKernelResult,
  StopPolicy,
  TurnResult,
} from "./kernelTypes";

export type RuntimeKernelDependencies = {
  bus: KernelEventBus;
  runTurn: (ctx: RunContext) => Promise<TurnResult>;
  now?: () => string;
};

export type {
  RunContext,
  RuntimeKernelResult,
  StopPolicy,
  TurnResult,
};

export async function runRuntimeKernel(
  initialContext: RunContext,
  deps: RuntimeKernelDependencies,
): Promise<RuntimeKernelResult> {
  const now = deps.now ?? (() => new Date().toISOString());
  let ctx: RunContext = {
    ...initialContext,
    turn: Math.max(0, Math.floor(initialContext.turn)),
    maxTurns: Math.max(0, Math.floor(initialContext.maxTurns)),
  };
  let summary = "";

  if (ctx.signal?.aborted) {
    return endRun(ctx, deps.bus, now, "canceled", "Agent run canceled.", summary);
  }

  while (ctx.turn < ctx.maxTurns) {
    ctx = {
      ...ctx,
      turn: ctx.turn + 1,
    };

    deps.bus.publish({
      v: KERNEL_EVENT_VERSION,
      type: "turn_start",
      runId: ctx.runId,
      turn: ctx.turn,
      maxTurns: ctx.maxTurns,
      createdAt: now(),
    });

    let lastTurn: TurnResult;
    try {
      lastTurn = await deps.runTurn(ctx);
    } catch (error) {
      return endRun(ctx, deps.bus, now, "failed", formatError(error), summary);
    }

    if (lastTurn.summary) {
      summary = lastTurn.summary;
    }

    if (ctx.signal?.aborted) {
      return endRun(ctx, deps.bus, now, "canceled", "Agent run canceled.", summary);
    }

    let decision;
    try {
      decision = await ctx.stopPolicy.shouldStop(ctx, lastTurn);
    } catch (error) {
      return endRun(ctx, deps.bus, now, "failed", formatError(error), summary);
    }

    if (ctx.stopPolicy.kind === "evidence_judge") {
      deps.bus.publish({
        v: KERNEL_EVENT_VERSION,
        type: "judge_verdict",
        runId: ctx.runId,
        decision,
        createdAt: now(),
      });
    }

    if (decision.stop) {
      return endRun(
        ctx,
        deps.bus,
        now,
        decision.impossible ? "failed" : "succeeded",
        decision.reason,
        summary,
      );
    }
  }

  return endRun(ctx, deps.bus, now, "paused", "max turns exhausted", summary);
}

function endRun(
  ctx: RunContext,
  bus: KernelEventBus,
  now: () => string,
  status: RuntimeKernelResult["status"],
  reason: string,
  summary: string,
): RuntimeKernelResult {
  bus.publish({
    v: KERNEL_EVENT_VERSION,
    type: "run_end",
    runId: ctx.runId,
    status,
    reason,
    createdAt: now(),
  } satisfies KernelEvent);

  return {
    runId: ctx.runId,
    status,
    turns: ctx.turn,
    reason,
    summary,
  };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "Unknown error");
}
