import {
  isProviderKind,
  type ProviderDescriptor,
  type ProviderField,
  type ProviderKind,
} from "../../shared/modelSettings";

const apiKeyField = (
  label: string,
  placeholder = "粘贴 API Key",
): ProviderField => ({
  key: "apiKey",
  label,
  secret: true,
  required: true,
  placeholder,
});

const compatible = (input: {
  kind: ProviderKind;
  title: string;
  endpoint: string;
  recommendedModel: string;
  environmentKey: string;
  description?: string;
}): ProviderDescriptor => ({
  kind: input.kind,
  title: input.title,
  description:
    input.description ??
    `通过 ${input.title} 的 OpenAI-compatible API 连接，默认端点可编辑。`,
  needsCredential: true,
  recommendedModel: input.recommendedModel,
  environmentKey: input.environmentKey,
  fields: [
    apiKeyField(`${input.title} API Key`),
    {
      key: "baseUrl",
      label: "接口地址",
      secret: false,
      required: true,
      defaultValue: input.endpoint,
      placeholder: input.endpoint,
      help: "已预填官方端点；仅在使用区域端点或代理时修改。",
    },
  ],
  capabilities: {
    nativeApi: false,
    local: false,
    customEndpoint: true,
  },
});

const descriptors: readonly ProviderDescriptor[] = [
  {
    kind: "openai",
    title: "OpenAI",
    description: "OpenAI 原生接口，也可连接 Azure OpenAI、vLLM 或兼容网关。",
    needsCredential: true,
    recommendedModel: "gpt-5.6-sol",
    environmentKey: "OPENAI_API_KEY",
    fields: [
      apiKeyField("OpenAI API Key", "sk-…"),
      {
        key: "baseUrl",
        label: "自定义接口地址",
        secret: false,
        required: false,
        defaultValue: "https://api.openai.com/v1",
        placeholder: "https://api.openai.com/v1",
      },
    ],
    capabilities: {
      nativeApi: true,
      local: false,
      customEndpoint: true,
    },
  },
  {
    kind: "anthropic",
    title: "Claude（Anthropic）",
    description: "使用 Anthropic Messages API、原生工具调用和 Prompt Cache。",
    needsCredential: true,
    recommendedModel: "claude-fable-5",
    environmentKey: "ANTHROPIC_API_KEY",
    fields: [apiKeyField("Anthropic API Key", "sk-ant-…")],
    capabilities: {
      nativeApi: true,
      local: false,
      customEndpoint: false,
    },
  },
  {
    kind: "gemini",
    title: "Gemini（Google）",
    description: "使用 Google Generative Language API。",
    needsCredential: true,
    recommendedModel: "gemini-3.6-flash",
    environmentKey: "GEMINI_API_KEY",
    fields: [apiKeyField("Gemini API Key", "AIza…")],
    capabilities: {
      nativeApi: true,
      local: false,
      customEndpoint: false,
    },
  },
  {
    kind: "bedrock",
    title: "AWS Bedrock",
    description: "在用户自己的 AWS 账号中运行 Claude、Nova 与开放权重模型。",
    needsCredential: true,
    recommendedModel: "claude/anthropic.claude-sonnet-4-6-v1:0",
    fields: [
      {
        key: "region",
        label: "AWS Region",
        secret: false,
        required: true,
        placeholder: "us-east-1",
        defaultValue: "us-east-1",
      },
      {
        key: "authMethod",
        label: "连接方式",
        secret: false,
        required: true,
        defaultValue: "api_key",
        choices: [
          {
            value: "api_key",
            label: "Bedrock API Key",
            tag: "简单",
            description: "使用 Bedrock 控制台生成的 Bearer Key。",
          },
          {
            value: "profile",
            label: "AWS Profile",
            description: "使用 ~/.aws 中的命名 Profile 或默认凭证链。",
          },
          {
            value: "iam",
            label: "IAM Keys",
            description: "使用 Access Key，可附带 STS Session Token。",
          },
        ],
      },
      {
        key: "bedrockApiKey",
        label: "Bedrock API Key",
        secret: true,
        required: false,
        showWhen: { authMethod: "api_key" },
      },
      {
        key: "awsProfile",
        label: "AWS Profile",
        secret: false,
        required: false,
        placeholder: "default",
        showWhen: { authMethod: "profile" },
      },
      {
        key: "awsAccessKeyId",
        label: "Access Key ID",
        secret: false,
        required: false,
        showWhen: { authMethod: "iam" },
      },
      {
        key: "awsSecretAccessKey",
        label: "Secret Access Key",
        secret: true,
        required: false,
        showWhen: { authMethod: "iam" },
      },
      {
        key: "awsSessionToken",
        label: "Session Token（可选）",
        secret: true,
        required: false,
        showWhen: { authMethod: "iam" },
      },
    ],
    capabilities: {
      nativeApi: true,
      local: false,
      customEndpoint: false,
    },
  },
  {
    kind: "vertex",
    title: "Vertex AI（Google Cloud）",
    description: "在用户自己的 GCP Project 中运行 Gemini、Claude 和开放权重模型。",
    needsCredential: true,
    recommendedModel: "gemini/gemini-3.6-flash",
    fields: [
      {
        key: "project",
        label: "GCP Project ID",
        secret: false,
        required: true,
        placeholder: "my-project",
      },
      {
        key: "location",
        label: "Location",
        secret: false,
        required: true,
        defaultValue: "global",
        placeholder: "global",
      },
      {
        key: "authMethod",
        label: "连接方式",
        secret: false,
        required: true,
        defaultValue: "adc",
        choices: [
          {
            value: "adc",
            label: "Google Cloud 登录",
            tag: "推荐",
            description: "使用 Application Default Credentials。",
            command: "gcloud auth application-default login",
          },
          {
            value: "service_account",
            label: "Service Account",
            description: "使用服务账号 JSON。",
          },
          {
            value: "api_key",
            label: "API Key",
            description: "仅支持允许 API Key 的 Gemini 路径。",
          },
        ],
      },
      {
        key: "serviceAccountJson",
        label: "Service Account JSON",
        secret: true,
        required: false,
        showWhen: { authMethod: "service_account" },
      },
      {
        key: "vertexApiKey",
        label: "Vertex API Key",
        secret: true,
        required: false,
        showWhen: { authMethod: "api_key" },
      },
    ],
    capabilities: {
      nativeApi: true,
      local: false,
      customEndpoint: false,
    },
  },
  compatible({
    kind: "zai",
    title: "Z AI（GLM）",
    endpoint: "https://api.z.ai/api/paas/v4",
    recommendedModel: "glm-5.2",
    environmentKey: "ZAI_API_KEY",
  }),
  compatible({
    kind: "deepseek",
    title: "DeepSeek",
    endpoint: "https://api.deepseek.com",
    recommendedModel: "deepseek-v4-flash",
    environmentKey: "DEEPSEEK_API_KEY",
  }),
  compatible({
    kind: "kimi",
    title: "Kimi（Moonshot AI）",
    endpoint: "https://api.moonshot.ai/v1",
    recommendedModel: "kimi-k2.6",
    environmentKey: "MOONSHOT_API_KEY",
  }),
  compatible({
    kind: "minimax",
    title: "MiniMax",
    endpoint: "https://api.minimax.io/v1",
    recommendedModel: "MiniMax-M2.5",
    environmentKey: "MINIMAX_API_KEY",
  }),
  compatible({
    kind: "qwen",
    title: "Qwen（Alibaba）",
    endpoint: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    recommendedModel: "qwen3-max",
    environmentKey: "DASHSCOPE_API_KEY",
  }),
  compatible({
    kind: "xai",
    title: "xAI（Grok）",
    endpoint: "https://api.x.ai/v1",
    recommendedModel: "grok-4.3",
    environmentKey: "XAI_API_KEY",
  }),
  compatible({
    kind: "mistral",
    title: "Mistral",
    endpoint: "https://api.mistral.ai/v1",
    recommendedModel: "mistral-large-latest",
    environmentKey: "MISTRAL_API_KEY",
  }),
  compatible({
    kind: "meta",
    title: "Meta Model API",
    endpoint: "https://api.meta.ai/v1",
    recommendedModel: "muse-spark-1.1",
    environmentKey: "META_API_KEY",
  }),
  compatible({
    kind: "together",
    title: "Together AI",
    endpoint: "https://api.together.xyz/v1",
    recommendedModel: "zai-org/GLM-5.2",
    environmentKey: "TOGETHER_API_KEY",
  }),
  compatible({
    kind: "fireworks",
    title: "Fireworks AI",
    endpoint: "https://api.fireworks.ai/inference/v1",
    recommendedModel: "accounts/fireworks/models/glm-5p2",
    environmentKey: "FIREWORKS_API_KEY",
  }),
  compatible({
    kind: "openrouter",
    title: "OpenRouter",
    endpoint: "https://openrouter.ai/api/v1",
    recommendedModel: "z-ai/glm-5.2",
    environmentKey: "OPENROUTER_API_KEY",
  }),
  {
    kind: "ollama",
    title: "Ollama（本地模型）",
    description: "连接本机或局域网 Ollama，自动使用 OpenAI-compatible /v1 接口。",
    needsCredential: false,
    recommendedModel: "qwen3-coder:30b",
    fields: [
      {
        key: "baseUrl",
        label: "Ollama 地址",
        secret: false,
        required: false,
        defaultValue: "http://localhost:11434",
        placeholder: "http://localhost:11434",
      },
    ],
    capabilities: {
      nativeApi: false,
      local: true,
      customEndpoint: true,
    },
  },
];

const byKind = new Map(descriptors.map((descriptor) => [descriptor.kind, descriptor]));

export function listProviderDescriptors(): ProviderDescriptor[] {
  return descriptors.map(cloneDescriptor);
}

export function getProviderDescriptor(
  kind: ProviderKind,
): ProviderDescriptor | null {
  const descriptor = byKind.get(kind);
  return descriptor ? cloneDescriptor(descriptor) : null;
}

export function requireProviderDescriptor(value: unknown): ProviderDescriptor {
  if (!isProviderKind(value)) {
    throw new Error(`未知模型服务商：${String(value)}`);
  }
  const descriptor = getProviderDescriptor(value);
  if (!descriptor) {
    throw new Error(`未注册模型服务商：${value}`);
  }
  return descriptor;
}

export function normalizeOllamaBaseUrl(value: string | undefined): string {
  const base = (value?.trim() || "http://localhost:11434").replace(/\/+$/, "");
  return base.endsWith("/v1") ? base : `${base}/v1`;
}

export function validateProviderFields(
  descriptor: ProviderDescriptor,
  values: Record<string, string>,
  options?: { hasStoredSecret?: boolean },
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of descriptor.fields) {
    if (!field.required || !isFieldVisible(field, values)) {
      continue;
    }
    const value = values[field.key]?.trim() || field.defaultValue?.trim() || "";
    if (!value && !(field.secret && options?.hasStoredSecret)) {
      errors[field.key] = `${field.label}必填。`;
    }
  }
  return errors;
}

function isFieldVisible(
  field: ProviderField,
  values: Record<string, string>,
): boolean {
  if (!field.showWhen) {
    return true;
  }
  return Object.entries(field.showWhen).every(
    ([key, expected]) => values[key] === expected,
  );
}

function cloneDescriptor(descriptor: ProviderDescriptor): ProviderDescriptor {
  return structuredClone(descriptor);
}
