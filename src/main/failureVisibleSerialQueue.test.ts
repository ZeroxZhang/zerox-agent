import { describe, expect, it } from "vitest";
import { createFailureVisibleSerialQueue } from "./failureVisibleSerialQueue";

describe("failure-visible serial queue", () => {
  it("drains every admitted operation and rethrows the first failure", async () => {
    const queue = createFailureVisibleSerialQueue();
    const operations: string[] = [];

    void queue.enqueue(async () => {
      operations.push("first");
      throw new Error("first persistence failure");
    });
    void queue.enqueue(async () => {
      operations.push("second");
      throw new Error("later persistence failure");
    });
    void queue.enqueue(async () => {
      operations.push("third");
    });

    await expect(queue.drain()).rejects.toThrow("first persistence failure");
    expect(operations).toEqual(["first", "second", "third"]);

    void queue.enqueue(async () => {
      operations.push("after-report");
    });
    await expect(queue.drain()).resolves.toBeUndefined();
    expect(operations.at(-1)).toBe("after-report");
  });

  it("closes admission before draining the final captured tail", async () => {
    const queue = createFailureVisibleSerialQueue();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    void queue.enqueue(() => blocked);

    const closingDrain = queue.drain({ close: true });
    expect(() => queue.assertOpen()).toThrow("Persistence queue is closed.");
    expect(() => queue.enqueue(async () => undefined)).toThrow(
      "Persistence queue is closed.",
    );

    release();
    await expect(closingDrain).resolves.toBeUndefined();
    await expect(queue.drain({ close: true })).resolves.toBeUndefined();
  });
});
