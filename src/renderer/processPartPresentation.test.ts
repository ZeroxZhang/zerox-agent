import { describe, expect, it } from "vitest";
import type { RenderedOutputPart } from "./chatOutputModel";
import {
  isProcessOutputPart,
  processPartAttention,
  processPartPresentation,
} from "./components/chat/AnswerBlock";

function part(
  value: RenderedOutputPart["type"] extends never ? never : RenderedOutputPart,
): RenderedOutputPart {
  return value;
}

describe("process part presentation", () => {
  it("classifies which parts belong to the process stream", () => {
    expect(isProcessOutputPart(part({
      id: "r",
      type: "reasoning",
      text: "thinking",
      redacted: false,
      truncated: false,
      streaming: false,
      renderKey: "m:r",
      source: "persisted",
    }))).toBe(true);
    expect(isProcessOutputPart(part({
      id: "t",
      type: "text",
      text: "answer",
      format: "markdown",
      renderKey: "m:t",
      source: "persisted",
    }))).toBe(false);
  });

  it("treats failures, approvals and input requests as attention", () => {
    expect(processPartAttention(part({
      id: "tr",
      type: "tool_result",
      toolCallId: "c",
      ok: false,
      error: "boom",
      renderKey: "m:tr",
      source: "persisted",
    }))).toBe("blocking");
    expect(processPartAttention(part({
      id: "tr-ok",
      type: "tool_result",
      toolCallId: "c",
      ok: true,
      renderKey: "m:tr-ok",
      source: "persisted",
    }))).toBe("normal");
    expect(processPartAttention(part({
      id: "ap",
      type: "approval_request",
      approvalId: "a",
      toolName: "file_write",
      riskLevel: "medium",
      renderKey: "m:ap",
      source: "persisted",
    }))).toBe("blocking");
    expect(processPartAttention(part({
      id: "ir",
      type: "input_request",
      inputRequestId: "i",
      skillName: "report",
      reason: "need input",
      fields: [],
      renderKey: "m:ir",
      source: "persisted",
    }))).toBe("normal");
  });

  it("never marks reasoning as attention so thinking stays folded", () => {
    expect(processPartAttention(part({
      id: "r",
      type: "reasoning",
      text: "a long thought",
      redacted: false,
      truncated: false,
      streaming: false,
      renderKey: "m:r",
      source: "persisted",
    }))).toBe("normal");
  });

  it("summarizes reasoning to a bounded single line", () => {
    const long = "字".repeat(120);
    const presentation = processPartPresentation(part({
      id: "r",
      type: "reasoning",
      text: `${long}\nsecond line`,
      redacted: true,
      truncated: true,
      streaming: false,
      renderKey: "m:r",
      source: "persisted",
    }));

    expect(presentation.tone).toBe("thinking");
    expect(presentation.label).toBe("思考");
    expect(presentation.summary).not.toContain("\n");
    expect(presentation.summary.length).toBeLessThanOrEqual(81);
    expect(presentation.meta).toBe("已截断");
  });

  it("labels tool failures and approvals for the one-line row", () => {
    const failure = processPartPresentation(part({
      id: "tr",
      type: "tool_result",
      toolCallId: "c",
      ok: false,
      error: "command failed",
      renderKey: "m:tr",
      source: "persisted",
    }));
    expect(failure.tone).toBe("tool-error");
    expect(failure.label).toBe("工具失败");
    expect(failure.summary).toBe("command failed");

    const approval = processPartPresentation(part({
      id: "ap",
      type: "approval_request",
      approvalId: "a",
      toolName: "file_write",
      riskLevel: "high",
      renderKey: "m:ap",
      source: "persisted",
    }));
    expect(approval.tone).toBe("approval");
    expect(approval.summary).toContain("file_write");
    expect(approval.meta).toBe("等待中");
  });
});

describe("plan step and turn progress presentation", () => {
  it("marks a failed plan step as attention", () => {
    expect(processPartAttention(part({
      id: "plan",
      type: "plan_step",
      steps: [
        { id: "s1", label: "第一步", status: "done" },
        { id: "s2", label: "第二步", status: "failed" },
      ],
      currentIndex: -1,
      total: 2,
      renderKey: "m:plan",
      source: "persisted",
    }))).toBe("blocking");
  });

  it("keeps an in-progress plan step as a normal row", () => {
    const inProgress = part({
      id: "plan",
      type: "plan_step",
      steps: [
        { id: "s1", label: "第一步", status: "done" },
        { id: "s2", label: "第二步", status: "active" },
      ],
      currentIndex: 1,
      total: 2,
      renderKey: "m:plan",
      source: "persisted",
    });

    expect(processPartAttention(inProgress)).toBe("normal");
    expect(processPartPresentation(inProgress)).toMatchObject({
      tone: "plan",
      label: "计划 · 步骤 2/2",
      summary: "第二步",
    });
  });

  it("summarizes a turn-progress row", () => {
    const presentation = processPartPresentation(part({
      id: "model_call_3",
      type: "model_call",
      turn: 3,
      toolCallsExecuted: 5,
      renderKey: "m:model_call_3",
      source: "persisted",
    }));

    expect(presentation.tone).toBe("model");
    expect(presentation.label).toBe("第 3 轮");
    expect(presentation.summary).toBe("已调用 5 次工具");
  });
});
