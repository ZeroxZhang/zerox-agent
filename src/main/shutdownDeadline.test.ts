import { describe, expect, it, vi } from "vitest";
import { settleShutdownWithDeadline } from "./shutdownDeadline";

describe("shutdown deadline", () => {
  it("reports a normally drained shutdown", async () => {
    await expect(
      settleShutdownWithDeadline(Promise.resolve(), 100),
    ).resolves.toBe("drained");
  });

  it("reaches the timeout even when a dependency never settles", async () => {
    vi.useFakeTimers();
    try {
      const result = settleShutdownWithDeadline(new Promise(() => {}), 100);
      await vi.advanceTimersByTimeAsync(100);
      await expect(result).resolves.toBe("timed_out");
    } finally {
      vi.useRealTimers();
    }
  });
});
