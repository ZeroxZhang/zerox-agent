export type ModelSettingsInput = {
  baseUrl: string;
  chatModel: string;
  embeddingModel: string;
  apiKey: string;
  temperature: number;
  maxTokens: number;
};

export type NormalizedModelSettingsInput = ModelSettingsInput;

export type PublicModelSettings = {
  baseUrl: string;
  chatModel: string;
  embeddingModel: string;
  temperature: number;
  maxTokens: number;
  hasApiKey: boolean;
  updatedAt: string | null;
};

export type ModelSettingsValidationErrors = Partial<
  Record<keyof ModelSettingsInput, string>
>;

export type ModelSettingsValidationResult = {
  valid: boolean;
  errors: ModelSettingsValidationErrors;
};

export type SaveModelSettingsResult =
  | {
      ok: true;
      settings: PublicModelSettings;
    }
  | {
      ok: false;
      errors: ModelSettingsValidationErrors;
      message: string;
    };

export type TestModelConnectionResult =
  | {
      ok: true;
      message: string;
      model: string;
      latencyMs: number;
      checkedAt: string;
      replyPreview: string;
    }
  | {
      ok: false;
      message: string;
    };

export type GenerationSettingRecommendation = {
  id: "agent" | "analysis" | "creative";
  label: string;
  temperature: number;
  maxTokens: number;
  description: string;
};

export type ModelSettingsFieldGuidance = {
  baseUrl: {
    label: string;
    hint: string;
  };
  chatModel: {
    label: string;
    hint: string;
  };
  embeddingModel: {
    label: string;
    hint: string;
  };
  apiKey: {
    label: string;
    hint: string;
  };
  temperature: {
    label: string;
    hint: string;
  };
  maxTokens: {
    label: string;
    hint: string;
  };
};

export function getDefaultModelSettings(): PublicModelSettings {
  return {
    baseUrl: "https://api.openai.com/v1",
    chatModel: "",
    embeddingModel: "",
    temperature: 0.2,
    maxTokens: 8192,
    hasApiKey: false,
    updatedAt: null,
  };
}

export function getGenerationSettingRecommendations(): GenerationSettingRecommendation[] {
  return [
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
  ];
}

export function getModelSettingsFieldGuidance(): ModelSettingsFieldGuidance {
  return {
    baseUrl: {
      label: "接口地址（Base URL）",
      hint: "填写兼容 OpenAI 的接口根地址，通常以 /v1 结尾。",
    },
    chatModel: {
      label: "对话模型",
      hint: "必填。用于会话、任务规划和工具调用。",
    },
    embeddingModel: {
      label: "向量模型（embedding，可选）",
      hint: "不填也能先用关键词和全文检索记忆；以后配置向量模型后再开启语义记忆。",
    },
    apiKey: {
      label: "模型密钥（API Key）",
      hint: "密钥只保存在本机安全存储里，不会回显到界面。",
    },
    temperature: {
      label: "温度（temperature）",
      hint: "智能体和工具调用建议 0.2；需要更发散的创作时再提高。",
    },
    maxTokens: {
      label: "单次回复最大输出（max tokens）",
      hint: "这是一次模型回复的输出上限，不是整个会话长度、历史上下文长度，也不是界面显示字数。",
    },
  };
}

export function normalizeModelSettingsInput(
  input: ModelSettingsInput,
): NormalizedModelSettingsInput {
  return {
    baseUrl: trimTrailingSlashes(input.baseUrl.trim()),
    chatModel: input.chatModel.trim(),
    embeddingModel: input.embeddingModel.trim(),
    apiKey: input.apiKey.trim(),
    temperature: roundToTwoDecimals(input.temperature),
    maxTokens: Math.round(input.maxTokens),
  };
}

export function validateModelSettingsInput(
  input: ModelSettingsInput,
  hasExistingApiKey: boolean,
): ModelSettingsValidationResult {
  const normalized = normalizeModelSettingsInput(input);
  const errors: ModelSettingsValidationErrors = {};

  if (!isHttpUrl(normalized.baseUrl)) {
    errors.baseUrl = "接口地址（Base URL）必须是有效的 http(s) 地址。";
  }

  if (!normalized.chatModel) {
    errors.chatModel = "对话模型必填。";
  }

  if (!hasExistingApiKey && !normalized.apiKey) {
    errors.apiKey = "首次保存模型配置时必须填写模型密钥（API Key）。";
  }

  if (normalized.temperature < 0 || normalized.temperature > 2) {
    errors.temperature = "温度（temperature）必须在 0 到 2 之间。";
  }

  if (normalized.maxTokens < 1 || normalized.maxTokens > 200000) {
    errors.maxTokens = "单次回复最大输出（max tokens）必须在 1 到 200000 之间。";
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

function roundToTwoDecimals(value: number): number {
  if (!Number.isFinite(value)) {
    return getDefaultModelSettings().temperature;
  }

  return Math.round(value * 100) / 100;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
