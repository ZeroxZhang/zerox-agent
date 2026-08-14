import { describe, expect, it } from "vitest";
import {
  createSerialToolPolicyAdmission,
  scheduleToolBatch,
} from "./toolBatchScheduler";

describe("tool batch scheduler", () => {
  it("runs parallel groups concurrently and places exclusive barriers between them", async () => {
    const events: string[] = [];
    let firstGroupStarted = 0;
    let releaseFirstGroup!: () => void;
    const firstGroupGate = new Promise<void>((resolve) => {
      releaseFirstGroup = resolve;
    });
    let secondGroupStarted = 0;
    let releaseSecondGroup!: () => void;
    const secondGroupGate = new Promise<void>((resolve) => {
      releaseSecondGroup = resolve;
    });
    let exclusiveActive = false;
    let exclusiveFinished = false;

    const results = await scheduleToolBatch(
      [
        { value: "read_1", mode: "parallel" },
        { value: "read_2", mode: "parallel" },
        { value: "write", mode: "exclusive" },
        { value: "read_3", mode: "parallel" },
        { value: "read_4", mode: "parallel" },
      ],
      {
        maxParallel: 2,
        async execute(name) {
          events.push(`start:${name}`);
          if (name === "read_1" || name === "read_2") {
            expect(exclusiveActive).toBe(false);
            firstGroupStarted += 1;
            if (firstGroupStarted === 2) releaseFirstGroup();
            await firstGroupGate;
          } else if (name === "write") {
            expect(firstGroupStarted).toBe(2);
            expect(secondGroupStarted).toBe(0);
            exclusiveActive = true;
            await Promise.resolve();
            exclusiveActive = false;
            exclusiveFinished = true;
          } else {
            expect(exclusiveFinished).toBe(true);
            expect(exclusiveActive).toBe(false);
            secondGroupStarted += 1;
            if (secondGroupStarted === 2) releaseSecondGroup();
            await secondGroupGate;
          }
          events.push(`end:${name}`);
          return name.toUpperCase();
        },
      },
    );

    expect(results.map((result) => result.status)).toEqual([
      "fulfilled",
      "fulfilled",
      "fulfilled",
      "fulfilled",
      "fulfilled",
    ]);
    expect(
      results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      ),
    ).toEqual(["READ_1", "READ_2", "WRITE", "READ_3", "READ_4"]);
    expect(events.indexOf("start:write")).toBeGreaterThan(
      events.indexOf("end:read_1"),
    );
    expect(events.indexOf("start:write")).toBeGreaterThan(
      events.indexOf("end:read_2"),
    );
    expect(events.indexOf("start:read_3")).toBeGreaterThan(
      events.indexOf("end:write"),
    );
  });

  it("caps a rolling pool and returns values in model order", async () => {
    let active = 0;
    let highWater = 0;
    const completionOrder: number[] = [];

    const results = await scheduleToolBatch(
      Array.from({ length: 8 }, (_, index) => ({
        value: index,
        mode: "parallel" as const,
      })),
      {
        maxParallel: 3,
        async execute(index) {
          active += 1;
          highWater = Math.max(highWater, active);
          await delay((8 - index) * 2);
          completionOrder.push(index);
          active -= 1;
          return `result_${index}`;
        },
      },
    );

    expect(highWater).toBe(3);
    expect(completionOrder).not.toEqual([...completionOrder].sort());
    expect(
      results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      ),
    ).toEqual(Array.from({ length: 8 }, (_, index) => `result_${index}`));
  });

  it("closes queued admission on cancellation and drains started work", async () => {
    const controller = new AbortController();
    const started: number[] = [];
    const settled: number[] = [];

    const scheduled = scheduleToolBatch(
      Array.from({ length: 5 }, (_, index) => ({
        value: index,
        mode: "parallel" as const,
      })),
      {
        maxParallel: 2,
        signal: controller.signal,
        async execute(index) {
          started.push(index);
          await waitForAbort(controller.signal);
          await delay(5);
          settled.push(index);
          throw controller.signal.reason;
        },
      },
    );

    await waitFor(() => started.length === 2);
    controller.abort(new Error("user canceled"));
    const results = await scheduled;

    expect(started).toEqual([0, 1]);
    expect(settled).toEqual([0, 1]);
    expect(results.map((result) => result.status)).toEqual([
      "rejected",
      "rejected",
      "skipped",
      "skipped",
      "skipped",
    ]);
  });

  it("stops queued admission after a dispatch exception but drains active peers", async () => {
    const started: number[] = [];
    const settled: number[] = [];
    let releasePeer!: () => void;
    const peerGate = new Promise<void>((resolve) => {
      releasePeer = resolve;
    });

    const results = await scheduleToolBatch(
      [0, 1, 2, 3].map((value) => ({
        value,
        mode: "parallel" as const,
      })),
      {
        maxParallel: 2,
        async execute(index) {
          started.push(index);
          if (index === 0) {
            await waitFor(() => started.length === 2);
            releasePeer();
            throw new Error("dispatch failed");
          }
          await peerGate;
          settled.push(index);
          return index;
        },
      },
    );

    expect(started).toEqual([0, 1]);
    expect(settled).toEqual([1]);
    expect(results.map((result) => result.status)).toEqual([
      "rejected",
      "fulfilled",
      "skipped",
      "skipped",
    ]);
  });

  it("commits each settled group in model order before crossing its barrier", async () => {
    const events: string[] = [];
    const results = await scheduleToolBatch(
      [
        { value: 0, mode: "parallel" },
        { value: 1, mode: "parallel" },
        { value: 2, mode: "exclusive" },
      ],
      {
        maxParallel: 2,
        async execute(index) {
          await delay(index === 0 ? 8 : 1);
          events.push(`settled:${index}`);
          return index;
        },
        async commit(result, index) {
          expect(result.status).toBe("fulfilled");
          events.push(`commit:${index}`);
        },
        afterGroup({ start, end }) {
          events.push(`group:${start}-${end}`);
        },
      },
    );

    expect(results.map((result) => result.status)).toEqual([
      "fulfilled",
      "fulfilled",
      "fulfilled",
    ]);
    expect(events.indexOf("settled:1")).toBeLessThan(
      events.indexOf("settled:0"),
    );
    expect(events.indexOf("commit:0")).toBeLessThan(
      events.indexOf("commit:1"),
    );
    expect(events.indexOf("group:0-2")).toBeLessThan(
      events.indexOf("settled:2"),
    );
  });
});

describe("serial tool policy admission", () => {
  it("serializes policy until dispatch while allowing dispatched bodies to overlap", async () => {
    const admission = createSerialToolPolicyAdmission();
    let activePolicy = 0;
    let policyHighWater = 0;
    let activeBody = 0;
    let bodyHighWater = 0;

    await Promise.all(
      [0, 1, 2].map((index) =>
        admission.run(async (release) => {
          activePolicy += 1;
          policyHighWater = Math.max(policyHighWater, activePolicy);
          await Promise.resolve();
          activePolicy -= 1;
          activeBody += 1;
          bodyHighWater = Math.max(bodyHighWater, activeBody);
          release();
          await delay(5 + index);
          activeBody -= 1;
        }),
      ),
    );

    expect(policyHighWater).toBe(1);
    expect(bodyHighWater).toBeGreaterThan(1);
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for scheduler condition.");
    }
    await delay(1);
  }
}

async function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}
