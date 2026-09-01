import { describe, expect, it } from "vitest";
import { createAgentGoalTranslator } from "./agentGoalTranslator";
import { ResponseBodyLimitError } from "./fetchWithTimeout";

describe("agent goal translator degradation", () => {
  it("retries one transient planning failure before falling back", async () => {
    let attempts = 0;
    const translator = createAgentGoalTranslator({
      chatClient: {
        async complete() {
          attempts += 1;
          if (attempts === 1) throw new Error("temporary outage");
          return {
            content: JSON.stringify({
              normalizedDescription: "分析项目",
              successCriteria: [],
              milestones: [],
            }),
            toolCalls: [],
            finishReason: "stop",
          };
        },
      },
      getModelProfile: async () => ({
        baseUrl: "http://localhost",
        apiKey: "test",
        model: "test-model",
        temperature: 0,
        maxTokens: 2_000,
      }),
      retryDelayMs: 0,
    });

    const draft = await translator.translate({
      sessionId: "session_1",
      originMessageId: null,
      message: "分析项目",
    });

    expect(attempts).toBe(2);
    expect(draft.warnings).not.toContainEqual(
      expect.objectContaining({ code: "planning_model_unavailable" }),
    );
  });

  it("surfaces provider failure and produces a concise local fallback", async () => {
    const diagnostics: string[] = [];
    const translator = createAgentGoalTranslator({
      chatClient: {
        async complete() {
          throw new Error("provider unavailable");
        },
      },
      getModelProfile: async () => ({
        baseUrl: "http://localhost",
        apiKey: "test",
        model: "test-model",
        temperature: 0,
        maxTokens: 2_000,
      }),
      onDiagnostic(event) {
        diagnostics.push(event.message);
      },
      createId: () => "draft_fallback",
      now: () => "2026-07-11T19:20:00.000Z",
    });
    const source = [
      "# 角色 你是一位资深软件架构师兼技术分析师",
      "请对当前项目进行完整分析，修复运行时、授权、取消和前端展示问题。",
      "这个说明故意很长，用于验证整段提示不会再成为抽屉标题。".repeat(8),
    ].join("\n");

    const draft = await translator.translate({
      sessionId: "session_1",
      originMessageId: "message_1",
      message: source,
    });

    expect(diagnostics).toEqual(["Goal translation model failed: provider unavailable"]);
    expect(draft.sourceMessage).toBe(source);
    expect(draft.normalizedDescription.length).toBeLessThanOrEqual(96);
    expect(draft.normalizedDescription).not.toContain("\n");
    expect(draft.milestones?.[0]?.description).toBe(
      "执行目标并产出可验收结果",
    );
    expect(draft.warnings).toContainEqual(
      expect.objectContaining({
        code: "planning_model_unavailable",
        severity: "warning",
      }),
    );
  });

  it("does not swallow cancellation as a planning fallback", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("Canceled", "AbortError"));
    const translator = createAgentGoalTranslator({
      chatClient: { async complete() { throw new Error("unused"); } },
      getModelProfile: async () => ({
        baseUrl: "http://localhost",
        apiKey: "test",
        model: "test-model",
        temperature: 0,
        maxTokens: 2_000,
      }),
    });

    await expect(
      translator.translate({
        sessionId: "session_1",
        originMessageId: null,
        message: "分析项目",
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("does not retry or locally degrade a response budget violation", async () => {
    let attempts = 0;
    const limit = new ResponseBodyLimitError("LLM", 32);
    const translator = createAgentGoalTranslator({
      chatClient: {
        async complete() {
          attempts += 1;
          throw new Error("wrapped", { cause: limit });
        },
      },
      getModelProfile: async () => ({
        baseUrl: "http://localhost",
        apiKey: "test",
        model: "test-model",
        temperature: 0,
        maxTokens: 2_000,
      }),
      retryDelayMs: 0,
    });

    await expect(translator.translate({
      sessionId: "session_1",
      originMessageId: null,
      message: "分析项目",
    })).rejects.toBe(limit);
    expect(attempts).toBe(1);
  });
});
