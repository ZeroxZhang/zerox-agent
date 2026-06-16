import { describe, expect, it } from "vitest";
import type { KernelEvent } from "../../shared/kernelContract";
import { KernelEventBus } from "./eventBus";

describe("KernelEventBus", () => {
  it("publishes events to subscribers in order", () => {
    const bus = new KernelEventBus();
    const received: KernelEvent[] = [];

    bus.subscribe((event) => {
      received.push(event);
    });

    const first = createTurnStartEvent(1);
    const second = createRunEndEvent("succeeded");
    bus.publish(first);
    bus.publish(second);

    expect(received).toEqual([first, second]);
  });

  it("stops delivering events after unsubscribe", () => {
    const bus = new KernelEventBus();
    const received: KernelEvent[] = [];
    const unsubscribe = bus.subscribe((event) => {
      received.push(event);
    });

    bus.publish(createTurnStartEvent(1));
    unsubscribe();
    bus.publish(createTurnStartEvent(2));

    expect(received.map((event) => event.type)).toEqual(["turn_start"]);
  });

  it("returns a defensive copy of history", () => {
    const bus = new KernelEventBus();
    bus.publish(createTurnStartEvent(1));

    const firstHistory = bus.history();
    firstHistory.push(createTurnStartEvent(99));

    expect(bus.history().map((event) => event.type)).toEqual(["turn_start"]);
  });

  it("streams only matching events", async () => {
    const bus = new KernelEventBus();
    const stream = bus.stream((event) => event.type === "retry");
    const iterator = stream[Symbol.asyncIterator]();

    const nextRetry = iterator.next();
    bus.publish(createTurnStartEvent(1));
    bus.publish({
      v: 1,
      type: "retry",
      runId: "run_1",
      attempt: 1,
      maxRetries: 2,
      afterMs: 500,
      error: "status 429",
      createdAt: "2026-06-16T00:00:01.000Z",
    });

    await expect(nextRetry).resolves.toMatchObject({
      done: false,
      value: {
        type: "retry",
        afterMs: 500,
      },
    });
    await iterator.return?.();
  });

  it("isolates subscriber failures from other subscribers", () => {
    const bus = new KernelEventBus();
    const received: KernelEvent[] = [];

    bus.subscribe(() => {
      throw new Error("subscriber failed");
    });
    bus.subscribe((event) => {
      received.push(event);
    });

    const event = createTurnStartEvent(1);
    bus.publish(event);

    expect(received).toEqual([event]);
  });
});

function createTurnStartEvent(turn: number): KernelEvent {
  return {
    v: 1,
    type: "turn_start",
    runId: "run_1",
    turn,
    maxTurns: 8,
    createdAt: `2026-06-16T00:00:0${turn}.000Z`,
  };
}

function createRunEndEvent(status: "succeeded" | "failed" | "canceled" | "paused"): KernelEvent {
  return {
    v: 1,
    type: "run_end",
    runId: "run_1",
    status,
    reason: "test completed",
    createdAt: "2026-06-16T00:00:09.000Z",
  };
}
