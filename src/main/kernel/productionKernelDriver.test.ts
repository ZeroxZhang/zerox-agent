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

  it("does not execute a pre-canceled production segment", async () => {
    const bus = new KernelEventBus();
    const controller = new AbortController();
    controller.abort(new Error("user canceled"));
    let executed = false;

    await expect(
      createProductionKernelDriver({ bus, now: fixedNow }).run({
        runId: "run_pre_canceled",
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
});

function fixedNow(): string {
  return "2026-08-14T10:00:00.000Z";
}
