import { describe, expect, it } from "vitest";
import { createModelConnectionService } from "./modelConnectionService";
import type { ChatCompletionRequest, ChatClient } from "./openAiCompatibleClient";
import type { ModelSettingsStore } from "./modelSettingsStore";
import type { PublicModelSettings } from "../shared/modelSettings";

describe("model connection service", () => {
  it("sends a compact chat request with the saved model profile", async () => {
    const requests: ChatCompletionRequest[] = [];
    const service = createModelConnectionService({
      modelSettingsStore: createModelSettingsStore({
        chatModel: "qwen-plus",
        hasApiKey: true,
      }, "secret-key"),
      chatClient: createChatClient(requests, "OK"),
      now: createClock([
        "2026-06-06T08:00:00.000Z",
        "2026-06-06T08:00:01.250Z",
      ]),
    });

    await expect(service.testConnection()).resolves.toEqual({
      ok: true,
      message: "模型连接测试成功。",
      model: "qwen-plus",
      latencyMs: 1250,
      checkedAt: "2026-06-06T08:00:01.250Z",
      replyPreview: "OK",
    });
    expect(requests).toEqual([
      expect.objectContaining({
        baseUrl: "https://api.example.com/v1",
        apiKey: "secret-key",
        model: "qwen-plus",
        temperature: 0,
        maxTokens: 32,
        messages: [
          {
            role: "system",
            content: "你正在进行桌面智能体的模型连通性测试。",
          },
          {
            role: "user",
            content: "请只回复 OK。",
          },
        ],
      }),
    ]);
  });

  it("returns a setup error without calling the model when chat config is incomplete", async () => {
    let completeCalled = false;
    const service = createModelConnectionService({
      modelSettingsStore: createModelSettingsStore({
        chatModel: "",
        hasApiKey: false,
      }, null),
      chatClient: {
        async complete() {
          completeCalled = true;
          return { content: "unused", toolCalls: [], finishReason: "stop" };
        },
      },
    });

    await expect(service.testConnection()).resolves.toEqual({
      ok: false,
      message: "模型配置不完整：请先保存 base URL、对话模型和 API Key。",
    });
    expect(completeCalled).toBe(false);
  });

  it("returns a compact provider error when the test request fails", async () => {
    const service = createModelConnectionService({
      modelSettingsStore: createModelSettingsStore({
        chatModel: "bad-model",
        hasApiKey: true,
      }, "secret-key"),
      chatClient: {
        async complete() {
          throw new Error("LLM request failed with status 401: bad key");
        },
      },
    });

    await expect(service.testConnection()).resolves.toEqual({
      ok: false,
      message: "模型连接测试失败：LLM request failed with status 401: bad key",
    });
  });
});

function createModelSettingsStore(
  settings: Partial<PublicModelSettings>,
  apiKey: string | null,
): Pick<ModelSettingsStore, "load" | "getApiKey"> {
  return {
    async load() {
      return {
        baseUrl: "https://api.example.com/v1",
        chatModel: "",
        embeddingModel: "",
        temperature: 0.2,
        maxTokens: 8192,
        hasApiKey: false,
        updatedAt: null,
        ...settings,
      };
    },
    async getApiKey() {
      return apiKey;
    },
  };
}

function createChatClient(
  requests: ChatCompletionRequest[],
  responseContent: string,
): ChatClient {
  return {
    async complete(request) {
      requests.push(request);
      return {
        content: responseContent,
        toolCalls: [],
        finishReason: "stop",
      };
    },
  };
}

function createClock(values: string[]): () => Date {
  return () => new Date(values.shift() ?? "2026-06-06T08:00:01.250Z");
}
