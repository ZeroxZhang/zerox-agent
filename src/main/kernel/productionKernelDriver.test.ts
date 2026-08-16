import { describe, expect, it } from "vitest";
import { KernelEventBus } from "./eventBus";
import { createProductionKernelDriver } from "./productionKernelDriver";

describe("production Kernel driver", () => {
  it.each(["succeeded", "paused", "failed", "canceled"] as const)(
    "preserves %s segment parity and emits exactly one terminal event",
    async (status) => {
      const bus = new KernelEventBus();
      const driver = createProductionKernelDriver({
        bus,
        now: fixedNow,
      });

      const result = await driver.run({
        runId: `run_${status}`,
        mode: "scheduled_task",
        async execute(reporter) {
          reporter.toolCall("file_read", { path: "README.md" });
          reporter.retry({
            attempt: 1,
            maxRetries: 2,
            afterMs: 10,
            error: "transient",
          });
          reporter.checkpoint(`checkpoint_${status}`);
          return {
            status,
            summary: `${status} summary`,
            value: 42,
          };
        },
      });

      expect(result.segment.value).toBe(42);
      expect(result.kernel).toMatchObject({
        runId: `run_${status}`,
        status,
        summary: `${status} summary`,
      });
      expect(
        bus.history().map((event) => event.type),
      ).toEqual([
        "turn_start",
        "tool_call",
        "retry",
        "checkpoint_written",
        "run_end",
      ]);
      expect(
        bus.history().filter((event) => event.type === "run_end"),
      ).toHaveLength(1);
    },
  );

  it.each(["chat", "goal", "scheduled_task"] as const)(
    "passes a frozen %s execution context to the segment",
    async (mode) => {
      const contexts: unknown[] = [];
      const result = await createProductionKernelDriver({
        bus: new KernelEventBus(),
        now: fixedNow,
      }).run({
        runId: `run_mode_${mode}`,
        mode,
        async execute(_reporter, context) {
          contexts.push(context);
          expect(Object.isFrozen(context)).toBe(true);
          return {
            status: "succeeded",
            summary: `${mode} complete`,
          };
        },
      });

      expect(contexts).toEqual([
        {
          runId: `run_mode_${mode}`,
          mode,
          turn: 1,
        },
      ]);
      expect(result.kernel.status).toBe("succeeded");
    },
  );

  it("rethrows a segment failure after publishing one failed terminal event", async () => {
    const bus = new KernelEventBus();
    const driver = createProductionKernelDriver({
      bus,
      now: fixedNow,
    });
    const error = new Error("segment exploded");

    await expect(
      driver.run({
        runId: "run_error",
        mode: "scheduled_task",
        async execute() {
          throw error;
        },
      }),
    ).rejects.toBe(error);
    expect(bus.history()).toEqual([
      expect.objectContaining({ type: "turn_start" }),
      expect.objectContaining({
        type: "run_end",
        status: "failed",
        reason: "segment exploded",
      }),
    ]);
  });

  it("settles a failed segment before run_end and rethrows the execution error", async () => {
    const bus = new KernelEventBus();
    const lifecycle: string[] = [];
    const error = new Error("segment exploded");
    const unsubscribe = bus.subscribe((event) => {
      if (event.type === "run_end") {
        lifecycle.push("run_end");
      }
    });

    await expect(
      createProductionKernelDriver({ bus, now: fixedNow }).run({
        runId: "run_settled_failure",
        mode: "chat",
        async execute() {
          lifecycle.push("execute");
          throw error;
        },
        async settleFailed(observedError, context) {
          expect(observedError).toBe(error);
          expect(context).toEqual({
            runId: "run_settled_failure",
            mode: "chat",
            turn: 1,
          });
          expect(Object.isFrozen(context)).toBe(true);
          lifecycle.push("persisted");
          return {
            status: "failed",
            summary: "Durable Chat failure.",
          };
        },
      }),
    ).rejects.toBe(error);
    unsubscribe();

    expect(lifecycle).toEqual(["execute", "persisted", "run_end"]);
    expect(bus.history().at(-1)).toMatchObject({
      type: "run_end",
      status: "failed",
      reason: "segment exploded",
    });
  });

  it("does not publish run_end when durable failure settlement fails", async () => {
    const bus = new KernelEventBus();
    const settlementError = new Error("failure persistence failed");

    await expect(
      createProductionKernelDriver({ bus, now: fixedNow }).run({
        runId: "run_failure_settlement_error",
        mode: "goal",
        async execute() {
          throw new Error("segment exploded");
        },
        async settleFailed() {
          throw settlementError;
        },
      }),
    ).rejects.toBe(settlementError);

    expect(
      bus.history().filter((event) => event.type === "run_end"),
    ).toEqual([]);
  });

  it("rejects a failure settlement that does not return failed", async () => {
    const bus = new KernelEventBus();

    await expect(
      createProductionKernelDriver({ bus, now: fixedNow }).run({
        runId: "run_invalid_failure_settlement",
        mode: "goal",
        async execute() {
          throw new Error("segment exploded");
        },
        async settleFailed() {
          return {
            status: "succeeded",
            summary: "invalid settlement",
          };
        },
      }),
    ).rejects.toThrow(/status must be failed/i);

    expect(
      bus.history().filter((event) => event.type === "run_end"),
    ).toEqual([]);
  });

  it("does not execute a pre-canceled production segment", async () => {
    const bus = new KernelEventBus();
    const controller = new AbortController();
    controller.abort(new Error("user canceled"));
    let executed = false;

    await expect(
      createProductionKernelDriver({ bus, now: fixedNow }).run({
        runId: "run_pre_canceled",
        mode: "scheduled_task",
        signal: controller.signal,
        async execute() {
          executed = true;
          return { status: "succeeded", summary: "unreachable" };
        },
      }),
    ).rejects.toThrow(/without an execution segment/i);
    expect(executed).toBe(false);
    expect(bus.history()).toEqual([
      expect.objectContaining({
        type: "run_end",
        status: "canceled",
      }),
    ]);
  });

  it("publishes paused for a pre-paused production segment", async () => {
    const bus = new KernelEventBus();
    const controller = new AbortController();
    controller.abort("pause");
    let executed = false;

    await expect(
      createProductionKernelDriver({ bus, now: fixedNow }).run({
        runId: "run_pre_paused",
        mode: "scheduled_task",
        signal: controller.signal,
        async execute() {
          executed = true;
          return { status: "succeeded", summary: "unreachable" };
        },
      }),
    ).rejects.toThrow(/without an execution segment/i);
    expect(executed).toBe(false);
    expect(bus.history()).toEqual([
      expect.objectContaining({
        type: "run_end",
        status: "paused",
      }),
    ]);
  });

  it("settles a pre-paused segment before publishing its terminal event", async () => {
    const bus = new KernelEventBus();
    const controller = new AbortController();
    controller.abort("pause");
    const lifecycle: string[] = [];
    const unsubscribe = bus.subscribe((event) => {
      if (event.type === "run_end") {
        lifecycle.push("run_end");
      }
    });

    const result = await createProductionKernelDriver({
      bus,
      now: fixedNow,
    }).run({
      runId: "run_pre_paused_settled",
      mode: "scheduled_task",
      signal: controller.signal,
      async execute() {
        throw new Error("pre-paused segment must not execute");
      },
      async settleAborted(status) {
        lifecycle.push("persisted");
        return {
          status,
          summary: "Agent run paused.",
        };
      },
    });
    unsubscribe();

    expect(result).toMatchObject({
      kernel: {
        status: "paused",
        summary: "Agent run paused.",
      },
      segment: {
        status: "paused",
        summary: "Agent run paused.",
      },
    });
    expect(lifecycle).toEqual(["persisted", "run_end"]);
  });

  it("does not publish run_end when pre-abort settlement cannot persist", async () => {
    const bus = new KernelEventBus();
    const controller = new AbortController();
    controller.abort("pause");
    const settlementError = new Error("pause persistence failed");

    await expect(
      createProductionKernelDriver({ bus, now: fixedNow }).run({
        runId: "run_pre_paused_settlement_error",
        mode: "scheduled_task",
        signal: controller.signal,
        async execute() {
          throw new Error("pre-paused segment must not execute");
        },
        async settleAborted() {
          throw settlementError;
        },
      }),
    ).rejects.toBe(settlementError);

    expect(bus.history()).toEqual([]);
  });

  it("rejects a stale success when cancellation wins before segment settlement", async () => {
    const bus = new KernelEventBus();
    const controller = new AbortController();
    const driver = createProductionKernelDriver({
      bus,
      now: fixedNow,
    });

    await expect(
      driver.run({
        runId: "run_cancel_race",
        mode: "scheduled_task",
        signal: controller.signal,
        async execute() {
          controller.abort(new Error("user canceled"));
          return {
            status: "succeeded",
            summary: "stale success",
          };
        },
      }),
    ).rejects.toThrow(/status parity failed/i);
    expect(bus.history().at(-1)).toMatchObject({
      type: "run_end",
      status: "canceled",
    });
  });

  it("validates this invocation without depending on bounded event history", async () => {
    const bus = new KernelEventBus();
    const driver = createProductionKernelDriver({
      bus,
      now: fixedNow,
    });
    await driver.run({
      runId: "run_long_resume",
      mode: "scheduled_task",
      async execute() {
        return { status: "paused", summary: "first segment" };
      },
    });

    await expect(
      driver.run({
        runId: "run_long_resume",
        mode: "scheduled_task",
        async execute(reporter) {
          for (let index = 0; index < 1_005; index += 1) {
            reporter.toolCall("file_read", { index });
          }
          return {
            status: "succeeded",
            summary: "resumed segment complete",
          };
        },
      }),
    ).resolves.toMatchObject({
      kernel: {
        status: "succeeded",
        summary: "resumed segment complete",
      },
    });
  });
});

function fixedNow(): string {
  return "2026-08-14T10:00:00.000Z";
}
