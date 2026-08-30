import { describe, expect, it } from "vitest";
import { getChatResultSettlementUiState } from "./chatResultSettlement";

describe("chat result settlement UI", () => {
  it.each([
    ["paused", "paused"],
    ["failed", "failed"],
    ["canceled", "canceled"],
    ["unknown", "paused"],
    ["succeeded", null],
    [undefined, null],
  ] as const)("maps durable %s without inventing success", (status, expected) => {
    expect(getChatResultSettlementUiState({
      turnSettlementStatus: status,
    })).toBe(expected);
  });

  it("keeps the more severe live Agent result", () => {
    expect(getChatResultSettlementUiState({
      turnSettlementStatus: "paused",
      agentStatus: {
        state: "failed",
        message: "failed",
        toolCallsExecuted: 0,
      },
    })).toBe("failed");
  });
});
