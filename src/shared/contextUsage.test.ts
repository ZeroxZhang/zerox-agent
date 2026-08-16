import { describe, expect, it } from "vitest";
import {
  createAgentContextUsage,
  resolveAgentContextBudget,
  resolveContextTokenBudget,
} from "./contextUsage";

describe("agent context usage", () => {
  const publicCatalogSource = {
    kind: "public_catalog" as const,
    label: "Zerox 公开模型目录",
    checkedAt: "2026-08-16T00:00:00.000Z",
  };

  it("separates the model context window from the maximum output tokens", () => {
    expect(
      resolveContextTokenBudget({
        contextWindow: 128_000,
        maxOutputTokens: 8_000,
      }),
    ).toBe(108_000);
  });

  it("enforces a verified public window and carries its provenance", () => {
    expect(
      resolveAgentContextBudget({
        contextWindow: 128_000,
        contextWindowSource: publicCatalogSource,
        maxOutputTokens: 8_000,
      }),
    ).toEqual({
      contextWindow: 128_000,
      contextWindowSource: publicCatalogSource,
      enforcement: "hard",
      maxOutputTokens: 8_000,
      safetyMarginTokens: 12_000,
      tokenBudget: 108_000,
    });
  });

  it("uses a visible advisory budget instead of inventing a hard window when metadata is unknown", () => {
    expect(
      resolveAgentContextBudget({ maxOutputTokens: 8_000 }),
    ).toEqual({
      enforcement: "advisory",
      maxOutputTokens: 8_000,
      safetyMarginTokens: 2_477,
      tokenBudget: 22_291,
    });
    expect(resolveContextTokenBudget({ maxOutputTokens: 8_000 })).toBe(22_291);
  });

  it("fails closed when a known window cannot satisfy the configured output reserve", () => {
    expect(
      resolveAgentContextBudget({
        contextWindow: 4_096,
        maxOutputTokens: 8_192,
      }),
    ).toMatchObject({
      contextWindow: 4_096,
      enforcement: "hard",
      tokenBudget: 1,
    });
  });

  it("normalizes context telemetry and caps the displayed occupancy", () => {
    expect(
      createAgentContextUsage({
        estimatedTokens: 2_000,
        tokenBudget: 1_000,
        budgetEnforcement: "hard",
        contextWindow: 128_000,
        contextWindowSource: publicCatalogSource,
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
      budgetEnforcement: "hard",
      contextWindow: 128_000,
      contextWindowSource: publicCatalogSource,
    });
  });
});
