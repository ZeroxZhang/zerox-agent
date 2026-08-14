import type { RuntimeKernelResult } from "./runtimeKernel";
import type {
  ProductionKernelDriver,
  ProductionKernelExecutionContext,
  ProductionKernelReporter,
  ProductionKernelSegment,
} from "./productionKernelDriver";

export type GoalKernelSettlement<TResult> = ProductionKernelSegment & {
  result: TResult;
  persistence: {
    runRecordPersisted: true;
    trajectoryFlushed: true;
    checkpointPersisted?: true;
  };
};

export type GoalKernelSegmentInput<TResult> = {
  driver: ProductionKernelDriver;
  runId: string;
  signal?: AbortSignal;
  execute(
    reporter: ProductionKernelReporter,
    context: ProductionKernelExecutionContext,
  ): Promise<GoalKernelSettlement<TResult>>;
  settleAborted(
    status: "paused" | "canceled",
    context: ProductionKernelExecutionContext,
  ): Promise<GoalKernelSettlement<TResult>>;
  settleFailed(
    error: unknown,
    context: ProductionKernelExecutionContext,
  ): Promise<GoalKernelSettlement<TResult>>;
};

export async function runGoalKernelSegment<TResult>(
  input: GoalKernelSegmentInput<TResult>,
): Promise<{
  kernel: RuntimeKernelResult;
  settlement: GoalKernelSettlement<TResult>;
}> {
  const outcome = await input.driver.run({
    runId: input.runId,
    mode: "goal",
    ...(input.signal ? { signal: input.signal } : {}),
    async execute(reporter, context) {
      return validateGoalKernelSettlement(
        await input.execute(reporter, context),
      );
    },
    async settleAborted(status, context) {
      return validateGoalKernelSettlement(
        await input.settleAborted(status, context),
      );
    },
    async settleFailed(error, context) {
      return validateGoalKernelSettlement(
        await input.settleFailed(error, context),
      );
    },
  });
  return {
    kernel: outcome.kernel,
    settlement: outcome.segment,
  };
}

export function validateGoalKernelSettlement<TResult>(
  settlement: GoalKernelSettlement<TResult>,
): GoalKernelSettlement<TResult> {
  if (settlement.persistence.runRecordPersisted !== true) {
    throw new Error(
      "Goal Kernel settlement requires a persisted run record.",
    );
  }
  if (settlement.persistence.trajectoryFlushed !== true) {
    throw new Error(
      "Goal Kernel settlement requires flushed trajectory writes.",
    );
  }
  if (
    settlement.status === "paused" &&
    settlement.persistence.checkpointPersisted !== true
  ) {
    throw new Error(
      "Paused Goal Kernel settlement requires a persisted checkpoint.",
    );
  }
  return Object.freeze(settlement);
}
