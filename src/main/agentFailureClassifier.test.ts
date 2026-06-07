import { describe, expect, it } from "vitest";
import { classifyAgentFailure } from "./agentFailureClassifier";

describe("agent failure classifier", () => {
  it("classifies permission denials", () => {
    expect(classifyAgentFailure(new Error("工具调用被拒绝：未授权路径"))).toBe(
      "permission_denied",
    );
    expect(classifyAgentFailure("User denied approval in dialog")).toBe(
      "permission_denied",
    );
  });

  it("classifies invalid model output", () => {
    expect(classifyAgentFailure(new Error("JSON parse failed"))).toBe(
      "invalid_model_output",
    );
    expect(classifyAgentFailure("无法解析模型输出")).toBe("invalid_model_output");
  });

  it("classifies timeout, cancellation, tool, and model failures", () => {
    expect(classifyAgentFailure(new Error("request timed out"))).toBe("timeout");
    expect(classifyAgentFailure(new Error("Agent run canceled."))).toBe(
      "canceled",
    );
    expect(classifyAgentFailure(new Error("Tool execution failed"))).toBe(
      "tool_error",
    );
    expect(classifyAgentFailure(new Error("LLM request failed with status 500"))).toBe(
      "model_error",
    );
  });

  it("falls back to unknown for unrecognized failures", () => {
    expect(classifyAgentFailure(new Error("Something strange happened"))).toBe(
      "unknown",
    );
    expect(classifyAgentFailure(null)).toBe("unknown");
  });
});
