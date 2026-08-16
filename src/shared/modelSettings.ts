export type ProviderId = "openai-compatible" | "anthropic" | "gemini" | (string & {});

export const providerKinds = [
  "openai",
  "anthropic",
  "gemini",
  "bedrock",
  "vertex",
  "zai",
  "deepseek",
  "kimi",
  "minimax",
  "qwen",
  "dashscope-coding",
  "xai",
  "mistral",
  "meta",
  "together",
  "fireworks",
  "openrouter",
  "ollama",
  "custom",
] as const;

export type ProviderKind = (typeof providerKinds)[number];
export type ProviderCredentialSource =
  | "stored"
  | "environment"
  | "ambient"
  | "none";

export type ModelContextWindowSource = {
  kind: "public_catalog" | "provider_metadata";
  label: string;
  checkedAt?: string;
};

export type PublishedModelMetadata = {
  modelId: string;
  contextWindow: number;
  contextWindowSource: ModelContextWindowSource;
};

export type ProviderConnectionVerification = {
  status: "passed" | "failed";
  checkedAt: string;
  message: string;
  latencyMs?: number;
  connectionRevision: number;
};

export type ProviderFieldChoice = {
  value: string;
  label: string;
  tag?: string;
  description?: string;
  command?: string;
};

export type ProviderField = {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
  help?: string;
  placeholder?: string;
  defaultValue?: string;
  choices?: ProviderFieldChoice[];
  showWhen?: Record<string, string>;
};

export type ProviderDescriptor = {
  kind: ProviderKind;
  title: string;
  description: string;
  needsCredential: boolean;
  recommendedModel?: string;
  environmentKey?: string;
  fields: ProviderField[];
  capabilities: {
    nativeApi: boolean;
    local: boolean;
    customEndpoint: boolean;
    embeddings: boolean;
  };
};

export type ProviderConnectionInput = {
  id?: string;
  name: string;
  providerKind: ProviderKind;
  values: Record<string, string>;
  credentialSource?: ProviderCredentialSource;
  expectedRevision?: number;
};

export type PublicProviderConnection = {
  id: string;
  name: string;
  providerKind: ProviderKind;
  values: Record<string, string>;
  credentialSource: ProviderCredentialSource;
  hasCredential: boolean;
  availability?: "unknown" | "available" | "unavailable";
  availableModelIds?: string[];
  publishedModels?: PublishedModelMetadata[];
  verification?: ProviderConnectionVerification;
  keySetAt?: string;
  lastUsedAt?: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type ModelCapabilities = {
  tools: boolean;
  vision: boolean;
  pdf: boolean;
  streaming: boolean;
  parallelToolCalls: boolean;
};

export type ModelCatalogEntry = {
  routedModelId: string;
  providerKind: ProviderKind;
  modelId: string;
  label: string;
  contextWindow?: number;
  contextWindowSource?: ModelContextWindowSource;
  capabilities: ModelCapabilities;
  verified: boolean;
  verifiedAt?: string;
};

export type ModelPurpose = "chat" | "embedding";

export type ModelProfileVerification = {
  status: "passed" | "failed";
  checkedAt: string;
  message: string;
  latencyMs?: number;
  connectionRevision: number;
  profileRevision: number;
};

export type ModelProfile = {
  id: string;
  name: string;
  connectionId: string;
  modelId: string;
  purpose: ModelPurpose;
  generation: {
    temperature: number;
    maxTokens: number;
    thinkingEnabled: boolean;
    thinkingBudgetTokens: number;
  };
  capabilityOverrides?: Partial<ModelCapabilities>;
  verification?: ModelProfileVerification;
  custom: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type ModelProfileInput = {
  id?: string;
  name: string;
  connectionId: string;
  modelId: string;
  purpose: ModelPurpose;
  generation?: Partial<ModelProfile["generation"]>;
  capabilityOverrides?: Partial<ModelCapabilities>;
  expectedRevision?: number;
};

export type PublicModelCatalog = {
  schemaVersion: 2;
  descriptors: ProviderDescriptor[];
  entries: ModelCatalogEntry[];
  connections: PublicProviderConnection[];
  profiles: ModelProfile[];
  defaultChatProfileId: string | null;
  defaultEmbeddingProfileId: string | null;
  hiddenRoutedModelIds: string[];
  updatedAt: string | null;
};

export type ResolvedModelBinding = {
  profileId: string;
  connectionId: string;
  providerKind: ProviderKind;
  modelId: string;
  contextWindow?: number;
  contextWindowSource?: ModelContextWindowSource;
  revision: number;
  connectionRevision?: number;
  profileRevision?: number;
  baseUrl?: string;
  capabilities: ModelCapabilities;
  generation: ModelProfile["generation"];
};

export type SaveProviderConnectionResult =
  | { ok: true; catalog: PublicModelCatalog; connection: PublicProviderConnection }
  | { ok: false; message: string; errors?: Record<string, string> };

export type SaveModelProfileResult =
  | { ok: true; catalog: PublicModelCatalog; profile: ModelProfile }
  | { ok: false; message: string };

export type ModelCatalogMutationResult =
  | { ok: true; catalog: PublicModelCatalog }
  | { ok: false; message: string };

export type RevisionedModelResourceInput = {
  id: string;
  expectedRevision: number;
};

export type TestAndSaveProviderConnectionResult =
  | {
      ok: true;
      catalog: PublicModelCatalog;
      connection: PublicProviderConnection;
      test: Extract<TestProviderConnectionResult, { ok: true }>;
    }
  | {
      ok: false;
      message: string;
      errors?: Record<string, string>;
      test?: TestProviderConnectionResult;
    };

export type TestProviderConnectionResult =
  | {
      ok: true;
      message: string;
      providerKind: ProviderKind;
      latencyMs: number;
      checkedAt: string;
      models?: string[];
      modelId?: string;
    }
  | {
      ok: false;
      message: string;
      providerKind?: ProviderKind;
      latencyMs?: number;
      checkedAt?: string;
    };

export type TestProviderConnectionInput =
  | { profileId: string }
  | {
      connection: ProviderConnectionInput;
      modelId?: string;
    };

export function isProviderKind(value: unknown): value is ProviderKind {
  return (
    typeof value === "string" &&
    (providerKinds as readonly string[]).includes(value)
  );
}

export function providerConnectionTargetIdentity(
  kind: ProviderKind,
  values: Record<string, string>,
): string {
  if (kind === "bedrock") {
    return JSON.stringify([
      kind,
      values.region?.trim() || "us-east-1",
      values.authMethod?.trim() || "api_key",
    ]);
  }
  if (kind === "vertex") {
    return JSON.stringify([
      kind,
      values.project?.trim() || "",
      values.location?.trim() || "global",
      values.authMethod?.trim() || "adc",
    ]);
  }
  const protocol =
    kind === "custom" ? values.protocol?.trim() || "openai" : "openai";
  let baseUrl = values.baseUrl?.trim().replace(/\/+$/, "") || "";
  baseUrl =
    protocol === "anthropic"
      ? baseUrl.replace(/\/v1\/messages$/, "")
      : baseUrl.replace(/\/chat\/completions$/, "");
  if (kind === "ollama") {
    baseUrl = baseUrl.replace(/\/v1$/, "");
  }
  return JSON.stringify([kind, protocol, baseUrl]);
}

export function defaultModelCapabilities(): ModelCapabilities {
  return {
    tools: false,
    vision: false,
    pdf: false,
    streaming: true,
    parallelToolCalls: false,
  };
}

export function defaultModelGenerationSettings(): ModelProfile["generation"] {
  return {
    temperature: 0.2,
    maxTokens: 8192,
    thinkingEnabled: false,
    thinkingBudgetTokens: 8192,
  };
}

export type ModelSettingsInput = {
  baseUrl: string;
  chatModel: string;
  embeddingModel: string;
  apiKey: string;
  temperature: number;
  maxTokens: number;
  thinkingEnabled?: boolean;
  thinkingBudgetTokens?: number;
  providerId?: ProviderId;
};

export type NormalizedModelSettingsInput = {
  baseUrl: string;
  chatModel: string;
  embeddingModel: string;
  apiKey: string;
  temperature: number;
  maxTokens: number;
  thinkingEnabled: boolean;
  thinkingBudgetTokens: number;
  providerId?: ProviderId;
};

export type PublicModelSettings = {
  baseUrl: string;
  chatModel: string;
  embeddingModel: string;
  temperature: number;
  maxTokens: number;
  thinkingEnabled: boolean;
  thinkingBudgetTokens: number;
  hasApiKey: boolean;
  updatedAt: string | null;
  providerId?: ProviderId;
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
  thinkingEnabled: {
    label: string;
    hint: string;
  };
  thinkingBudgetTokens: {
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
    thinkingEnabled: false,
    thinkingBudgetTokens: 8192,
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
    thinkingEnabled: {
      label: "启用模型思考过程",
      hint: "开启后模型会返回推理内容，适用于 Qwen3.6-plus、Claude 3.7 Sonnet (thinking) 等支持思考的模型。",
    },
    thinkingBudgetTokens: {
      label: "思考预算（tokens）",
      hint: "模型用于思考的最大 token 数，通常 1024-8192。",
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
    thinkingEnabled: input.thinkingEnabled ?? false,
    thinkingBudgetTokens: Math.max(
      256,
      Math.round(input.thinkingBudgetTokens ?? 8192),
    ),
    ...(input.providerId ? { providerId: input.providerId } : {}),
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

  if (
    normalized.thinkingEnabled &&
    (normalized.thinkingBudgetTokens < 256 ||
      normalized.thinkingBudgetTokens > 32000)
  ) {
    errors.thinkingBudgetTokens = "思考预算必须在 256 到 32000 之间。";
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
