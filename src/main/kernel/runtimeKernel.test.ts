import { describe, expect, it } from "vitest";
import { KernelEventBus } from "./eventBus";
import {
  runRuntimeKernel,
  type RunContext,
  type StopPolicy,
} from "./runtimeKernel";

describe("runRuntimeKernel", () => {
  it("continues across a legacy turn checkpoint until semantic completion", async () => {
    const bus = new KernelEventBus();
    const turns: number[] = [];

    const result = await runRuntimeKernel(createContext({
      mode: "chat",
      maxTurns: 2,
      stopPolicy: turnLimitPolicy(),
    }), {
      bus,
      now: fixedNow,
      async runTurn(ctx) {
        turns.push(ctx.turn);
        return {
          summary: `turn ${ctx.turn}`,
          completed: ctx.turn === 4,
        };
      },
      async onCheckpoint(ctx) {
        return `checkpoint:${ctx.turn}`;
      },
    });

    expect(result).toEqual({
      runId: "run_1",
      status: "succeeded",
      turns: 4,
      reason: "run completed",
      summary: "turn 4",
    });
    expect(turns).toEqual([1, 2, 3, 4]);
    expect(bus.history().map((event) => event.type)).toEqual([
      "turn_start",
      "turn_start",
      "checkpoint_written",
      "turn_start",
      "turn_start",
      "run_end",
    ]);
  });

  it("emits judge verdicts for evidence stop policies", async () => {
    const bus = new KernelEventBus();

    const result = await runRuntimeKernel(createContext({
      mode: "goal",
      maxTurns: 12,
      stopPolicy: {
        kind: "evidence_judge",
        async shouldStop() {
          return {
            stop: true,
            reason: "transcript contains verification evidence",
            evidence: ["npm run verify -> passed"],
          };
        },
      },
    }), {
      bus,
      now: fixedNow,
      async runTurn(ctx) {
        return {
          summary: `goal turn ${ctx.turn}`,
        };
      },
    });

    expect(result.status).toBe("succeeded");
    expect(bus.history().map((event) => event.type)).toEqual([
      "turn_start",
      "judge_verdict",
      "run_end",
    ]);
    expect(bus.history()[1]).toMatchObject({
      type: "judge_verdict",
      decision: {
        stop: true,
        evidence: ["npm run verify -> passed"],
      },
    });
  });

  it("marks impossible stop decisions as failed", async () => {
    const bus = new KernelEventBus();

    const result = await runRuntimeKernel(createContext({
      mode: "goal",
      maxTurns: 12,
      stopPolicy: {
        kind: "evidence_judge",
        async shouldStop() {
          return {
            stop: true,
            impossible: true,
            reason: "required local resource is unavailable",
          };
        },
      },
    }), {
      bus,
      now: fixedNow,
      async runTurn() {
        return {
          summary: "resource check failed",
        };
      },
    });

    expect(result.status).toBe("failed");
    expect(result.reason).toBe("required local resource is unavailable");
    expect(bus.history().at(-1)).toMatchObject({
      type: "run_end",
      status: "failed",
      reason: "required local resource is unavailable",
    });
  });

  it("cancels before running a turn when the signal is already aborted", async () => {
    const bus = new KernelEventBus();
    const controller = new AbortController();
    controller.abort();
    let turnRan = false;

    const result = await runRuntimeKernel(createContext({
      signal: controller.signal,
      stopPolicy: turnLimitPolicy(),
    }), {
      bus,
      now: fixedNow,
      async runTurn() {
        turnRan = true;
        return {};
      },
    });

    expect(turnRan).toBe(false);
    expect(result).toMatchObject({
      status: "canceled",
      turns: 0,
      reason: "Agent run canceled.",
    });
    expect(bus.history()).toEqual([
      {
        v: 1,
        type: "run_end",
        runId: "run_1",
        status: "canceled",
        reason: "Agent run canceled.",
        createdAt: fixedNow(),
      },
    ]);
  });

  it.each(["paused", "failed", "canceled"] as const)(
    "preserves an explicit %s production segment terminal status",
    async (terminalStatus) => {
      const bus = new KernelEventBus();
      const result = await runRuntimeKernel(createContext({
        mode: "scheduled_task",
      }), {
        bus,
        now: fixedNow,
        async runTurn() {
          return {
            terminalStatus,
            reason: `segment ${terminalStatus}`,
            summary: `${terminalStatus} summary`,
          };
        },
      });

      expect(result).toMatchObject({
        status: terminalStatus,
        reason: `segment ${terminalStatus}`,
        summary: `${terminalStatus} summary`,
      });
      expect(
        bus.history().filter((event) => event.type === "run_end"),
      ).toEqual([
        expect.objectContaining({
          status: terminalStatus,
          reason: `segment ${terminalStatus}`,
        }),
      ]);
    },
  );

  it("gives parent cancellation precedence over a stale successful segment", async () => {
    const bus = new KernelEventBus();
    const controller = new AbortController();
    const result = await runRuntimeKernel(createContext({
      mode: "scheduled_task",
      signal: controller.signal,
    }), {
      bus,
      now: fixedNow,
      async runTurn() {
        controller.abort(new Error("user canceled"));
        return {
          terminalStatus: "succeeded",
          summary: "stale success",
        };
      },
    });

    expect(result).toMatchObject({
      status: "canceled",
      reason: "Agent run canceled.",
      summary: "stale success",
    });
  });
});

function createContext(overrides: Partial<RunContext> = {}): RunContext {
  return {
    runId: "run_1",
    mode: "chat",
    turn: 0,
    maxTurns: 4,
    stopPolicy: turnLimitPolicy(),
    ...overrides,
  };
}

function turnLimitPolicy(): StopPolicy {
  return {
    kind: "checkpoint_interval",
    async shouldStop(_ctx, lastTurn) {
      if (lastTurn.completed) {
        return {
          stop: true,
          reason: "run completed",
        };
      }

      return {
        stop: false,
        reason: "continue after checkpoint",
      };
    },
  };
}

function fixedNow() {
  return "2026-06-16T00:00:00.000Z";
}
