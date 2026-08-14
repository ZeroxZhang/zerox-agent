import { describe, expect, it } from "vitest";
import { KernelEventBus } from "./eventBus";
import { createProductionKernelDriver } from "./productionKernelDriver";
import {
  runGoalKernelSegment,
  validateGoalKernelSettlement,
  type GoalKernelSettlement,
} from "./goalKernelSegment";

describe("Goal Kernel segment adapter", () => {
  it.each(["succeeded", "failed", "canceled"] as const)(
    "persists and flushes a %s milestone before run_end",
    async (status) => {
      const bus = new KernelEventBus();
      const lifecycle: string[] = [];
      bus.subscribe((event) => {
        if (event.type === "run_end") lifecycle.push("run_end");
      });

      const result = await runGoalKernelSegment({
        driver: createProductionKernelDriver({ bus, now: fixedNow }),
        runId: `goal_${status}`,
        async execute(_reporter, context) {
          expect(context.mode).toBe("goal");
          lifecycle.push("run_persisted", "trajectory_flushed");
          return settlement(status, { status });
        },
        settleAborted: unreachable,
        settleFailed: unreachable,
      });

      expect(result.kernel.status).toBe(status);
      expect(lifecycle).toEqual([
        "run_persisted",
        "trajectory_flushed",
        "run_end",
      ]);
    },
  );

  it("requires a checkpoint before paused run_end", async () => {
    const bus = new KernelEventBus();
    const lifecycle: string[] = [];
    bus.subscribe((event) => {
      if (event.type === "run_end") lifecycle.push("run_end");
    });
    await runGoalKernelSegment({
      driver: createProductionKernelDriver({ bus }),
      runId: "goal_paused",
      async execute() {
        lifecycle.push(
          "checkpoint_persisted",
          "run_persisted",
          "trajectory_flushed",
        );
        return {
          ...settlement("paused", { status: "paused" }),
          persistence: {
            runRecordPersisted: true,
            trajectoryFlushed: true,
            checkpointPersisted: true,
          },
        };
      },
      settleAborted: unreachable,
      settleFailed: unreachable,
    });
    expect(lifecycle.at(-1)).toBe("run_end");
  });

  it("settles a thrown milestone failure before rethrowing", async () => {
    const bus = new KernelEventBus();
    const lifecycle: string[] = [];
    const error = new Error("milestone failed");
    bus.subscribe((event) => {
      if (event.type === "run_end") lifecycle.push("run_end");
    });
    await expect(
      runGoalKernelSegment({
        driver: createProductionKernelDriver({ bus }),
        runId: "goal_error",
        async execute() {
          throw error;
        },
        settleAborted: unreachable,
        async settleFailed(observed) {
          expect(observed).toBe(error);
          lifecycle.push("run_persisted", "trajectory_flushed");
          return settlement("failed", { status: "failed" });
        },
      }),
    ).rejects.toBe(error);
    expect(lifecycle).toEqual([
      "run_persisted",
      "trajectory_flushed",
      "run_end",
    ]);
  });

  it("settles pre-cancel before run_end", async () => {
    const bus = new KernelEventBus();
    const controller = new AbortController();
    controller.abort(new Error("canceled"));
    let executed = false;
    const result = await runGoalKernelSegment({
      driver: createProductionKernelDriver({ bus }),
      runId: "goal_pre_canceled",
      signal: controller.signal,
      async execute() {
        executed = true;
        return settlement("succeeded", {});
      },
      async settleAborted(status) {
        return settlement(status, { status });
      },
      settleFailed: unreachable,
    });
    expect(executed).toBe(false);
    expect(result.kernel.status).toBe("canceled");
  });

  it("rejects missing run, trajectory, or paused checkpoint evidence", () => {
    expect(() =>
      validateGoalKernelSettlement({
        ...settlement("succeeded", {}),
        persistence: {
          runRecordPersisted: false,
          trajectoryFlushed: true,
        },
      } as unknown as GoalKernelSettlement<unknown>),
    ).toThrow(/persisted run record/i);
    expect(() =>
      validateGoalKernelSettlement({
        ...settlement("succeeded", {}),
        persistence: {
          runRecordPersisted: true,
          trajectoryFlushed: false,
        },
      } as unknown as GoalKernelSettlement<unknown>),
    ).toThrow(/flushed trajectory/i);
    expect(() =>
      validateGoalKernelSettlement(
        settlement("paused", {}),
      ),
    ).toThrow(/persisted checkpoint/i);
  });
});

function settlement<TResult>(
  status: GoalKernelSettlement<TResult>["status"],
  result: TResult,
): GoalKernelSettlement<TResult> {
  return {
    status,
    summary: `${status} milestone`,
    result,
    persistence: {
      runRecordPersisted: true,
      trajectoryFlushed: true,
    },
  };
}

async function unreachable(): Promise<never> {
  throw new Error("unreachable");
}

function fixedNow(): string {
  return "2026-08-14T12:00:00.000Z";
}
