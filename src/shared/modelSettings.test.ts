import { describe, expect, it } from "vitest";
import {
  getDefaultModelSettings,
  getGenerationSettingRecommendations,
  getModelSettingsFieldGuidance,
  normalizeModelSettingsInput,
  validateModelSettingsInput,
} from "./modelSettings";

describe("model settings", () => {
  it("starts with OpenAI-compatible defaults without pretending an API key exists", () => {
    expect(getDefaultModelSettings()).toEqual({
      baseUrl: "https://api.openai.com/v1",
      chatModel: "",
      embeddingModel: "",
      temperature: 0.2,
      maxTokens: 8192,
      hasApiKey: false,
      updatedAt: null,
    });
  });

  it("normalizes text fields and numeric fields before saving", () => {
    expect(
      normalizeModelSettingsInput({
        baseUrl: " https://api.example.com/v1/ ",
        chatModel: " qwen-plus ",
        embeddingModel: " text-embedding-v4 ",
        apiKey: " sk-test ",
        temperature: 0.3333,
        maxTokens: 2048.7,
      }),
    ).toEqual({
      baseUrl: "https://api.example.com/v1",
      chatModel: "qwen-plus",
      embeddingModel: "text-embedding-v4",
      apiKey: "sk-test",
      temperature: 0.33,
      maxTokens: 2049,
    });
  });

  it("treats embeddings as optional while requiring the chat profile fields", () => {
    const result = validateModelSettingsInput(
      {
        baseUrl: "https://api.example.com/v1",
        chatModel: "agent-chat",
        embeddingModel: "",
        apiKey: "sk-test",
        temperature: 0.2,
        maxTokens: 8192,
      },
      false,
    );

    expect(result).toEqual({ valid: true, errors: {} });
  });

  it("validates required model profile fields", () => {
    const result = validateModelSettingsInput(
      {
        baseUrl: "not-a-url",
        chatModel: "",
        embeddingModel: "",
        apiKey: "",
        temperature: 5,
        maxTokens: 0,
      },
      false,
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual({
      apiKey: "首次保存模型配置时必须填写模型密钥（API Key）。",
      baseUrl: "接口地址（Base URL）必须是有效的 http(s) 地址。",
      chatModel: "对话模型必填。",
      maxTokens: "单次回复最大输出（max tokens）必须在 1 到 200000 之间。",
      temperature: "温度（temperature）必须在 0 到 2 之间。",
    });
  });

  it("recommends practical generation settings for common use cases", () => {
    expect(getGenerationSettingRecommendations()).toEqual([
      {
        id: "agent",
        label: "智能体 / 编程",
        temperature: 0.2,
        maxTokens: 8192,
        description: "适合稳定调用工具、处理文件、写代码和跑定时任务。",
      },
      {
        id: "analysis",
        label: "分析 / 报告",
        temperature: 0.4,
        maxTokens: 12000,
        description: "适合长摘要、调研笔记和记忆整理。",
      },
      {
        id: "creative",
        label: "创意写作",
        temperature: 0.8,
        maxTokens: 8192,
        description: "适合头脑风暴、命名和草稿创作，输出更多样。",
      },
    ]);
  });

  it("explains that max tokens applies to one model response, not the whole session", () => {
    expect(getModelSettingsFieldGuidance().maxTokens).toEqual({
      label: "单次回复最大输出（max tokens）",
      hint: "这是一次模型回复的输出上限，不是整个会话长度、历史上下文长度，也不是界面显示字数。",
    });
  });

  it("uses Chinese-first labels for the visible model setup fields", () => {
    expect(getModelSettingsFieldGuidance()).toMatchObject({
      baseUrl: {
        label: "接口地址（Base URL）",
      },
      chatModel: {
        label: "对话模型",
      },
      embeddingModel: {
        label: "向量模型（embedding，可选）",
      },
      apiKey: {
        label: "模型密钥（API Key）",
      },
      temperature: {
        label: "温度（temperature）",
      },
      maxTokens: {
        label: "单次回复最大输出（max tokens）",
      },
    });
  });
});
