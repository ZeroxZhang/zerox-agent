import { describe, expect, it } from "vitest";
import {
  createAgentContextUsage,
  resolveContextTokenBudget,
} from "./contextUsage";

describe("agent context usage", () => {
  it("separates the model context window from the maximum output tokens", () => {
    expect(
      resolveContextTokenBudget({
        contextWindow: 128_000,
        maxOutputTokens: 8_000,
      }),
    ).toBe(108_000);
  });

  it("preserves the compatibility budget when a custom model window is unknown", () => {
    expect(resolveContextTokenBudget({ maxOutputTokens: 8_000 })).toBe(5_600);
  });

  it("normalizes context telemetry and caps the displayed occupancy", () => {
    expect(
      createAgentContextUsage({
        estimatedTokens: 2_000,
        tokenBudget: 1_000,
        messageCount: 4.8,
        compactionCount: 1.9,
        updatedAt: "2026-08-03T08:00:00.000Z",
      }),
    ).toMatchObject({
      estimatedTokens: 2_000,
      tokenBudget: 1_000,
      occupancyRatio: 1,
      messageCount: 4,
      compactionCount: 1,
    });
  });
});
