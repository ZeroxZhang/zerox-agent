import {
  defaultModelCapabilities,
  type ModelCatalogEntry,
  type ModelCapabilities,
  type ProviderKind,
} from "../../shared/modelSettings";

const agentic: ModelCapabilities = {
  tools: true,
  vision: false,
  pdf: false,
  streaming: true,
  parallelToolCalls: true,
};

const agenticVision: ModelCapabilities = {
  ...agentic,
  vision: true,
  pdf: true,
};

const agenticVisionWithoutPdf: ModelCapabilities = {
  ...agentic,
  vision: true,
  pdf: false,
};

const streamingVisionWithoutTools: ModelCapabilities = {
  ...defaultModelCapabilities(),
  vision: true,
};

const agenticSequentialTools: ModelCapabilities = {
  ...agentic,
  parallelToolCalls: false,
};

const verifiedAt = "2026-07-28";
const codingPlanVerifiedAt = "2026-07-31";

const entry = (
  providerKind: ProviderKind,
  modelId: string,
  label: string,
  capabilities: ModelCapabilities = agentic,
  contextWindow?: number,
): ModelCatalogEntry => ({
  routedModelId: `${providerKind}:${modelId}`,
  providerKind,
  modelId,
  label,
  capabilities,
  ...(contextWindow ? { contextWindow } : {}),
  verified: true,
  verifiedAt,
});

const entries: readonly ModelCatalogEntry[] = [
  entry("openai", "gpt-5.6-sol", "GPT-5.6 Sol · OpenAI", agenticVision, 400_000),
  entry("openai", "gpt-5.6-terra", "GPT-5.6 Terra · OpenAI", agenticVision, 400_000),
  entry("openai", "gpt-5.6-luna", "GPT-5.6 Luna · OpenAI", agenticVision, 400_000),
  entry("openai", "gpt-5.5", "GPT-5.5 · OpenAI", agenticVision, 400_000),
  entry("anthropic", "claude-fable-5", "Claude Fable 5 · Anthropic", agenticVision, 1_000_000),
  entry("anthropic", "claude-opus-4-8", "Claude Opus 4.8 · Anthropic", agenticVision, 200_000),
  entry("anthropic", "claude-sonnet-4-6", "Claude Sonnet 4.6 · Anthropic", agenticVision, 200_000),
  entry("anthropic", "claude-haiku-4-5", "Claude Haiku 4.5 · Anthropic", agenticVision, 200_000),
  entry("gemini", "gemini-3.6-flash", "Gemini 3.6 Flash · Google", agenticVision, 1_048_576),
  entry("gemini", "gemini-3.1-pro-preview", "Gemini 3.1 Pro · Google", agenticVision, 1_048_576),
  entry("gemini", "gemini-2.5-pro", "Gemini 2.5 Pro · Google", agenticVision, 1_048_576),
  entry("gemini", "gemini-2.5-flash", "Gemini 2.5 Flash · Google", agenticVision, 1_048_576),
  entry("zai", "glm-5.2", "GLM-5.2 · Z AI", agentic, 128_000),
  entry("deepseek", "deepseek-v4-flash", "DeepSeek V4 Flash · DeepSeek", agentic, 128_000),
  entry("deepseek", "deepseek-v4-pro", "DeepSeek V4 Pro · DeepSeek", agentic, 128_000),
  entry("kimi", "kimi-k2.6", "Kimi K2.6 · Moonshot", agentic, 256_000),
  entry("minimax", "MiniMax-M2.5", "MiniMax M2.5 · MiniMax", agentic),
  entry("qwen", "qwen3-max", "Qwen3 Max · Alibaba", agentic, 256_000),
  {
    ...entry(
      "dashscope-coding",
      "qwen3.7-plus",
      "Qwen3.7 Plus · 阿里云百炼 Coding Plan",
      agenticVisionWithoutPdf,
      1_000_000,
    ),
    verifiedAt: codingPlanVerifiedAt,
  },
  {
    ...entry(
      "dashscope-coding",
      "qwen3.6-plus",
      "Qwen3.6 Plus · 阿里云百炼 Coding Plan",
      agenticVisionWithoutPdf,
      1_000_000,
    ),
    verifiedAt: codingPlanVerifiedAt,
  },
  {
    ...entry(
      "dashscope-coding",
      "kimi-k2.5",
      "Kimi K2.5 · 阿里云百炼 Coding Plan",
      streamingVisionWithoutTools,
    ),
    verifiedAt: codingPlanVerifiedAt,
  },
  {
    ...entry(
      "dashscope-coding",
      "glm-5",
      "GLM-5 · 阿里云百炼 Coding Plan",
      defaultModelCapabilities(),
    ),
    verifiedAt: codingPlanVerifiedAt,
  },
  {
    ...entry(
      "dashscope-coding",
      "MiniMax-M2.5",
      "MiniMax M2.5 · 阿里云百炼 Coding Plan",
      defaultModelCapabilities(),
    ),
    verifiedAt: codingPlanVerifiedAt,
  },
  {
    ...entry(
      "dashscope-coding",
      "qwen3.5-plus",
      "Qwen3.5 Plus · 阿里云百炼 Coding Plan",
      agenticVisionWithoutPdf,
      1_000_000,
    ),
    verifiedAt: codingPlanVerifiedAt,
  },
  {
    ...entry(
      "dashscope-coding",
      "qwen3-max-2026-01-23",
      "Qwen3 Max 2026-01-23 · 阿里云百炼 Coding Plan",
      defaultModelCapabilities(),
    ),
    verifiedAt: codingPlanVerifiedAt,
  },
  {
    ...entry(
      "dashscope-coding",
      "qwen3-coder-next",
      "Qwen3 Coder Next · 阿里云百炼 Coding Plan",
      defaultModelCapabilities(),
      262_144,
    ),
    verifiedAt: codingPlanVerifiedAt,
  },
  {
    ...entry(
      "dashscope-coding",
      "qwen3-coder-plus",
      "Qwen3 Coder Plus · 阿里云百炼 Coding Plan",
      agentic,
    ),
    verifiedAt: codingPlanVerifiedAt,
  },
  {
    ...entry(
      "dashscope-coding",
      "glm-4.7",
      "GLM-4.7 · 阿里云百炼 Coding Plan",
      defaultModelCapabilities(),
    ),
    verifiedAt: codingPlanVerifiedAt,
  },
  entry("xai", "grok-4.3", "Grok 4.3 · xAI", agentic, 256_000),
  entry("mistral", "mistral-large-latest", "Mistral Large · Mistral", agentic, 128_000),
  entry("meta", "muse-spark-1.1", "Muse Spark 1.1 · Meta", agenticVisionWithoutPdf),
  entry("together", "thinkingmachines/Inkling", "Inkling · via Together", agentic),
  entry("together", "zai-org/GLM-5.2", "GLM-5.2 · via Together", agentic, 128_000),
  entry("together", "moonshotai/Kimi-K2.7-Code", "Kimi K2.7 Code · via Together", agentic, 256_000),
  entry("together", "moonshotai/Kimi-K2.6", "Kimi K2.6 · via Together", agentic, 256_000),
  entry("together", "deepseek-ai/DeepSeek-V4-Pro", "DeepSeek V4 Pro · via Together", agentic, 128_000),
  entry(
    "together",
    "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
    "Llama 4 Maverick · via Together",
    agentic,
    1_000_000,
  ),
  entry("fireworks", "accounts/fireworks/models/glm-5p2", "GLM-5.2 · via Fireworks", agentic, 128_000),
  entry("fireworks", "accounts/fireworks/models/kimi-k2p6", "Kimi K2.6 · via Fireworks", agentic, 256_000),
  entry("fireworks", "accounts/fireworks/models/deepseek-v4-pro", "DeepSeek V4 Pro · via Fireworks", agentic, 128_000),
  entry(
    "fireworks",
    "accounts/fireworks/models/llama4-maverick-instruct-basic",
    "Llama 4 Maverick · via Fireworks",
    agentic,
    1_000_000,
  ),
  entry("openrouter", "z-ai/glm-5.2", "GLM-5.2 · via OpenRouter", agentic, 128_000),
  entry("openrouter", "moonshotai/kimi-k2.6", "Kimi K2.6 · via OpenRouter", agentic, 256_000),
  entry("openrouter", "deepseek/deepseek-v4-pro", "DeepSeek V4 Pro · via OpenRouter", agentic, 128_000),
  entry(
    "openrouter",
    "meta-llama/llama-4-maverick",
    "Llama 4 Maverick · via OpenRouter",
    agentic,
    1_000_000,
  ),
  entry("bedrock", "claude/anthropic.claude-sonnet-4-6-v1:0", "Claude Sonnet 4.6 · AWS Bedrock", agenticVision, 200_000),
  entry("bedrock", "claude/anthropic.claude-haiku-4-5-v1:0", "Claude Haiku 4.5 · AWS Bedrock", agenticVision, 200_000),
  entry("bedrock", "other/amazon.nova-2-pro-v1:0", "Nova 2 Pro · AWS Bedrock", agentic, 300_000),
  entry("bedrock", "other/meta.llama4-maverick-17b-instruct-v1:0", "Llama 4 Maverick · AWS Bedrock", agentic, 1_000_000),
  entry("bedrock", "other/mistral.mistral-large-3-v1:0", "Mistral Large 3 · AWS Bedrock", agentic, 128_000),
  entry(
    "bedrock",
    "other/nvidia.nemotron-super-3-120b",
    "Nemotron Super 3 120B · AWS Bedrock",
    agenticSequentialTools,
  ),
  entry("vertex", "gemini/gemini-3.1-pro-preview", "Gemini 3.1 Pro · Vertex AI", agenticVision, 1_048_576),
  entry("vertex", "gemini/gemini-3.6-flash", "Gemini 3.6 Flash · Vertex AI", agenticVision, 1_048_576),
  entry("vertex", "claude/claude-sonnet-4-6", "Claude Sonnet 4.6 · Vertex AI", agenticVision, 200_000),
  entry("vertex", "claude/claude-haiku-4-5", "Claude Haiku 4.5 · Vertex AI", agenticVision, 200_000),
  entry(
    "vertex",
    "openweight/meta/llama-4-maverick-17b-128e-instruct-maas",
    "Llama 4 Maverick · Vertex AI",
    agentic,
    1_000_000,
  ),
  entry("vertex", "openweight/qwen/qwen3-coder-480b-a35b-instruct-maas", "Qwen3 Coder · Vertex AI", agentic, 256_000),
  entry("ollama", "qwen3-coder:30b", "Qwen3 Coder 30B · Ollama", agentic),
];

export function listModelCatalogEntries(): ModelCatalogEntry[] {
  return entries.map((candidate) => structuredClone(candidate));
}

export function getModelCatalogEntry(
  providerKind: ProviderKind,
  modelId: string,
): ModelCatalogEntry | null {
  const candidate = entries.find(
    (item) => item.providerKind === providerKind && item.modelId === modelId,
  );
  return candidate ? structuredClone(candidate) : null;
}

export function capabilitiesForModel(
  providerKind: ProviderKind,
  modelId: string,
): ModelCapabilities {
  return (
    getModelCatalogEntry(providerKind, modelId)?.capabilities ??
    defaultModelCapabilities()
  );
}

export function modelsForProvider(
  providerKind: ProviderKind,
): ModelCatalogEntry[] {
  return listModelCatalogEntries().filter(
    (candidate) => candidate.providerKind === providerKind,
  );
}
