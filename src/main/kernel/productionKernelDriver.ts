import {
  KERNEL_EVENT_VERSION,
  type KernelEvent,
  type KernelRunMode,
  type KernelRunStatus,
} from "../../shared/kernelContract";
import type { KernelEventBus } from "./eventBus";
import {
  runRuntimeKernel,
  type RuntimeKernelResult,
} from "./runtimeKernel";

export type ProductionKernelSegment = {
  status: Extract<
    KernelRunStatus,
    "succeeded" | "failed" | "canceled" | "paused"
  >;
  summary: string;
};

export type ProductionKernelReporter = {
  checkpoint(ref: string, turn?: number): void;
  toolCall(tool: string, args: unknown): void;
  retry(input: {
    attempt: number;
    maxRetries: number;
    afterMs: number;
    error: string;
  }): void;
};

export type ProductionKernelExecutionContext = Readonly<{
  runId: string;
  mode: KernelRunMode;
  turn: number;
}>;

export type ProductionKernelRunInput<
  TSegment extends ProductionKernelSegment,
> = {
  runId: string;
  mode: KernelRunMode;
  signal?: AbortSignal;
  checkpointEvery?: number;
  execute(
    reporter: ProductionKernelReporter,
    context: ProductionKernelExecutionContext,
  ): Promise<TSegment>;
  settleAborted?(
    status: "paused" | "canceled",
    context: ProductionKernelExecutionContext,
  ): Promise<TSegment>;
  settleFailed?(
    error: unknown,
    context: ProductionKernelExecutionContext,
  ): Promise<TSegment>;
};

export type ProductionKernelDriver = {
  run<TSegment extends ProductionKernelSegment>(
    input: ProductionKernelRunInput<TSegment>,
  ): Promise<{
    kernel: RuntimeKernelResult;
    segment: TSegment;
  }>;
};

export function createProductionKernelDriver(options: {
  bus: KernelEventBus;
  now?: () => string;
}): ProductionKernelDriver {
  const now = options.now ?? (() => new Date().toISOString());

  return {
    run(input) {
      return runProductionSegment(input, {
        bus: options.bus,
        now,
      });
    },
  };
}

async function runProductionSegment<
  TSegment extends ProductionKernelSegment,
>(
  input: ProductionKernelRunInput<TSegment>,
  options: {
    bus: KernelEventBus;
    now: () => string;
  },
): Promise<{
  kernel: RuntimeKernelResult;
  segment: TSegment;
}> {
  let segment: TSegment | undefined;
  let segmentError: unknown;
  let activeTurn = 0;
  const terminalEvents: Array<
    Extract<KernelEvent, { type: "run_end" }>
  > = [];
  const unsubscribe = options.bus.subscribe((event) => {
    if (event.runId === input.runId && event.type === "run_end") {
      terminalEvents.push(event);
    }
  });
  const reporter: ProductionKernelReporter = {
    checkpoint(ref, turn = activeTurn) {
      options.bus.publish({
        v: KERNEL_EVENT_VERSION,
        type: "checkpoint_written",
        runId: input.runId,
        ref,
        turn,
        createdAt: options.now(),
      });
    },
    toolCall(tool, args) {
      options.bus.publish({
        v: KERNEL_EVENT_VERSION,
        type: "tool_call",
        runId: input.runId,
        tool,
        args,
        createdAt: options.now(),
      });
    },
    retry(retry) {
      options.bus.publish({
        v: KERNEL_EVENT_VERSION,
        type: "retry",
        runId: input.runId,
        ...retry,
        createdAt: options.now(),
      });
    },
  };
  const executionContext = (
    turn = activeTurn,
  ): ProductionKernelExecutionContext =>
    Object.freeze({
      runId: input.runId,
      mode: input.mode,
      turn,
    });

  let kernel: RuntimeKernelResult;
  try {
    kernel = await runRuntimeKernel(
      {
        runId: input.runId,
        mode: input.mode,
        turn: 0,
        maxTurns: Math.max(
          1,
          Math.floor(input.checkpointEvery ?? 1),
        ),
        ...(input.signal ? { signal: input.signal } : {}),
        stopPolicy: {
          kind: "checkpoint_interval",
          async shouldStop() {
            return {
              stop: true,
              reason: "production segment completed",
            };
          },
        },
      },
      {
        bus: options.bus,
        now: options.now,
        async beforeAbortedEnd(ctx) {
          const status = ctx.signal?.reason === "pause"
            ? "paused"
            : "canceled";
          if (
            input.settleAborted &&
            (!segment || segment.status !== status)
          ) {
            try {
              const settled = await input.settleAborted(
                status,
                executionContext(ctx.turn),
              );
              assertSettlementStatus(settled, status, "aborted");
              segment = settled;
            } catch (error) {
              segmentError = error;
              throw error;
            }
          }
          return segment ? { summary: segment.summary } : undefined;
        },
        async runTurn(ctx) {
          activeTurn = ctx.turn;
          try {
            const executed = await input.execute(
              reporter,
              executionContext(ctx.turn),
            );
            segment = executed;
            return {
              summary: executed.summary,
              terminalStatus: executed.status,
              reason: `segment ${executed.status}`,
            };
          } catch (error) {
            if (!input.settleFailed) {
              segmentError = error;
              throw error;
            }
            try {
              const settled = await input.settleFailed(
                error,
                executionContext(ctx.turn),
              );
              assertSettlementStatus(settled, "failed", "failed");
              segment = settled;
              segmentError = error;
              return {
                summary: settled.summary,
                terminalStatus: settled.status,
                reason: formatError(error),
              };
            } catch (settlementError) {
              segment = undefined;
              segmentError = settlementError;
              throw settlementError;
            }
          }
        },
      },
    );
  } finally {
    unsubscribe();
  }

  assertOneTerminalEvent(terminalEvents, kernel);
  if (!segment) {
    if (segmentError) {
      throw segmentError;
    }
    throw new Error(
      "Production Kernel ended without an execution segment result.",
    );
  }
  const settledSegment = segment as TSegment;
  assertSegmentParity(kernel, settledSegment);
  if (segmentError) {
    throw segmentError;
  }
  return {
    kernel,
    segment: settledSegment,
  };
}

function assertSettlementStatus(
  segment: ProductionKernelSegment,
  expected: ProductionKernelSegment["status"],
  kind: string,
): void {
  if (segment.status !== expected) {
    throw new Error(
      `Production Kernel ${kind} settlement status must be ${expected}, received ${segment.status}.`,
    );
  }
}

function assertSegmentParity(
  kernel: RuntimeKernelResult,
  segment: ProductionKernelSegment,
): void {
  if (kernel.status !== segment.status) {
    throw new Error(
      `Production Kernel status parity failed: ${kernel.status} != ${segment.status}.`,
    );
  }
  if (kernel.summary !== segment.summary) {
    throw new Error(
      "Production Kernel summary parity failed.",
    );
  }
}

function formatError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error ?? "Unknown error");
}

function assertOneTerminalEvent(
  events: Array<Extract<KernelEvent, { type: "run_end" }>>,
  result: RuntimeKernelResult,
): void {
  if (events.length !== 1) {
    throw new Error(
      `Production Kernel expected one run_end event, observed ${events.length}.`,
    );
  }
  const terminal = events[0];
  if (
    terminal.status !== result.status ||
    terminal.reason !== result.reason
  ) {
    throw new Error(
      "Production Kernel terminal event parity failed.",
    );
  }
}
