import { describe, expect, it } from "vitest";
import {
  buildOutputLimitContinuationPrompt,
  escalateOutputBudget,
  isRecoverableOutputLimit,
  MAX_ESCALATED_OUTPUT_TOKENS,
  MIN_ESCALATED_OUTPUT_TOKENS,
} from "./structuredOutputBudget";

describe("structured output budget recovery", () => {
  it("doubles the budget with a floor and a hard ceiling", () => {
    expect(escalateOutputBudget(8192)).toBe(16384);
    expect(escalateOutputBudget(4096)).toBe(MIN_ESCALATED_OUTPUT_TOKENS);
    expect(escalateOutputBudget(2000)).toBe(MIN_ESCALATED_OUTPUT_TOKENS);
    expect(escalateOutputBudget(20_000)).toBe(MAX_ESCALATED_OUTPUT_TOKENS);
    expect(escalateOutputBudget(64_000)).toBe(MAX_ESCALATED_OUTPUT_TOKENS);
  });

  it("falls back to the floor for invalid budgets", () => {
    expect(escalateOutputBudget(0)).toBe(MIN_ESCALATED_OUTPUT_TOKENS);
    expect(escalateOutputBudget(Number.NaN)).toBe(MIN_ESCALATED_OUTPUT_TOKENS);
    expect(escalateOutputBudget(-5)).toBe(MIN_ESCALATED_OUTPUT_TOKENS);
  });

  it("treats output-limit notices as recoverable only with partial content", () => {
    const notice = {
      kind: "output_limit" as const,
      message: "模型或服务商已达到本次输出长度限制，当前内容可能不完整。",
    };
    expect(isRecoverableOutputLimit(notice, '{"title":"part')).toBe(true);
    expect(isRecoverableOutputLimit(notice, "")).toBe(false);
    expect(isRecoverableOutputLimit(notice, "   ")).toBe(false);
    expect(isRecoverableOutputLimit(notice, null)).toBe(false);
    expect(isRecoverableOutputLimit(notice, undefined)).toBe(false);
    expect(
      isRecoverableOutputLimit(
        { kind: "rate_limit", message: "rate limited" },
        '{"title":"part',
      ),
    ).toBe(false);
    expect(isRecoverableOutputLimit(undefined, '{"title":"part')).toBe(false);
  });

  it("asks the model to resume exactly at the cut and stay compact", () => {
    const prompt = buildOutputLimitContinuationPrompt();
    expect(prompt).toContain("截断");
    expect(prompt).toContain("不要重复已输出的任何字符");
    expect(prompt).toContain("紧凑 JSON");
  });
});
