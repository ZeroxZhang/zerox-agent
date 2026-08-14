import {
  KERNEL_EVENT_VERSION,
  type KernelEvent,
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

export type ProductionKernelDriver = {
  run<TSegment extends ProductionKernelSegment>(input: {
    runId: string;
    signal?: AbortSignal;
    checkpointEvery?: number;
    execute(
      reporter: ProductionKernelReporter,
    ): Promise<TSegment>;
    settleAborted?(
      status: "paused" | "canceled",
    ): Promise<TSegment>;
  }): Promise<{
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
  input: {
    runId: string;
    signal?: AbortSignal;
    checkpointEvery?: number;
    execute(
      reporter: ProductionKernelReporter,
    ): Promise<TSegment>;
    settleAborted?(
      status: "paused" | "canceled",
    ): Promise<TSegment>;
  },
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

  let kernel: RuntimeKernelResult;
  try {
    kernel = await runRuntimeKernel(
      {
        runId: input.runId,
        mode: "scheduled_task",
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
            segment = await input.settleAborted(status);
          }
          return segment ? { summary: segment.summary } : undefined;
        },
        async runTurn(ctx) {
          activeTurn = ctx.turn;
          try {
            const executed = await input.execute(reporter);
            segment = executed;
            return {
              summary: executed.summary,
              terminalStatus: executed.status,
              reason: `segment ${executed.status}`,
            };
          } catch (error) {
            segmentError = error;
            throw error;
          }
        },
      },
    );
  } finally {
    unsubscribe();
  }

  assertOneTerminalEvent(terminalEvents, kernel);
  if (segmentError) {
    throw segmentError;
  }
  if (!segment) {
    throw new Error(
      "Production Kernel ended without an execution segment result.",
    );
  }
  const settledSegment = segment as TSegment;
  if (kernel.status !== settledSegment.status) {
    throw new Error(
      `Production Kernel status parity failed: ${kernel.status} != ${settledSegment.status}.`,
    );
  }
  if (kernel.summary !== settledSegment.summary) {
    throw new Error(
      "Production Kernel summary parity failed.",
    );
  }
  return {
    kernel,
    segment: settledSegment,
  };
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
