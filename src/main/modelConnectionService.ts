import type {
  ProviderKind,
  PublicModelCatalog,
  TestModelConnectionResult,
  TestProviderConnectionInput,
  TestProviderConnectionResult,
} from "../shared/modelSettings";
import { defaultModelCapabilities } from "../shared/modelSettings";
import { fetchWithTimeout } from "./fetchWithTimeout";
import type { ModelSettingsStore } from "./modelSettingsStore";
import type { ChatClient, StreamingChatClient } from "./openAiCompatibleClient";
import { createOpenAiCompatibleClient } from "./openAiCompatibleClient";
import type { ModelRouter } from "./providers/modelRouter";
import { createProviderChatClient } from "./providers/providerChatClient";
import {
  createProvider,
  resolveProviderBaseUrl,
} from "./providers/providerFactory";
import {
  normalizeOllamaBaseUrl,
  requireProviderDescriptor,
  validateProviderFields,
} from "./providers/providerRegistry";

export type ModelConnectionService = {
  testConnection(): Promise<TestModelConnectionResult>;
  testProvider(
    input: TestProviderConnectionInput,
  ): Promise<TestProviderConnectionResult>;
  enrichCatalog(catalog: PublicModelCatalog): Promise<PublicModelCatalog>;
};

export function createModelConnectionService(options: {
  modelSettingsStore: ModelSettingsStore;
  chatClient: ChatClient;
  modelRouter?: ModelRouter;
  fetch?: typeof fetch;
  now?: () => Date;
}): ModelConnectionService {
  const now = options.now ?? (() => new Date());
  const fetchImpl = options.fetch ?? fetch;
  const ollamaCache = new Map<
    string,
    {
      expiresAt: number;
      ok: boolean;
      models: string[];
      message: string;
    }
  >();

  async function probeOllama(baseUrl: string) {
    const base = normalizeOllamaBaseUrl(baseUrl).replace(/\/v1$/, "");
    const cached = ollamaCache.get(base);
    const currentTime = now().getTime();
    if (cached && cached.expiresAt > currentTime) {
      return cached;
    }
    try {
      const response = await fetchWithTimeout(
        fetchImpl,
        `${base}/api/tags`,
        { method: "GET" },
        5_000,
        "Ollama",
      );
      if (!response.ok) {
        throw new Error(`Ollama 返回 HTTP ${response.status}。`);
      }
      const json = (await response.json()) as {
        models?: Array<{ name?: string; model?: string }>;
      };
      const models = [
        ...new Set(
          (json.models ?? [])
            .map((model) => model.name ?? model.model ?? "")
            .filter(Boolean),
        ),
      ].sort();
      const result = {
        expiresAt: currentTime + 30_000,
        ok: true,
        models,
        message: models.length
          ? `Ollama 可用，发现 ${models.length} 个模型。`
          : "Ollama 可用，但尚未安装模型。",
      };
      ollamaCache.set(base, result);
      return result;
    } catch (error) {
      const result = {
        expiresAt: currentTime + 30_000,
        ok: false,
        models: [],
        message: error instanceof Error ? error.message : "Ollama 不可达。",
      };
      ollamaCache.set(base, result);
      return result;
    }
  }

  async function testBoundClient(input: {
    client: ChatClient;
    baseUrl: string;
    apiKey: string;
    model: string;
  }): Promise<TestModelConnectionResult> {
    const startedAt = now();
    try {
      const response = await input.client.complete({
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
        model: input.model,
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
      });
      const checkedAt = now();
      return {
        ok: true,
        message: "模型连接测试成功。",
        model: input.model,
        latencyMs: Math.max(0, checkedAt.getTime() - startedAt.getTime()),
        checkedAt: checkedAt.toISOString(),
        replyPreview: (response.content ?? "").slice(0, 120),
      };
    } catch (error) {
      return {
        ok: false,
        message: `模型连接测试失败：${
          error instanceof Error ? error.message : "未知错误"
        }`,
      };
    }
  }

  return {
    async enrichCatalog(catalog) {
      const connections = await Promise.all(
        catalog.connections.map(async (connection) => {
          if (connection.providerKind !== "ollama") {
            return {
              ...connection,
              availability: connection.hasCredential
                ? ("available" as const)
                : ("unavailable" as const),
            };
          }
          const probe = await probeOllama(
            connection.values.baseUrl ?? "http://localhost:11434",
          );
          return {
            ...connection,
            availability: probe.ok
              ? ("available" as const)
              : ("unavailable" as const),
            availableModelIds: [...probe.models],
          };
        }),
      );
      const ollamaModelIds = new Set(
        connections
          .filter(
            (connection) =>
              connection.providerKind === "ollama" &&
              connection.availability === "available",
          )
          .flatMap((connection) => connection.availableModelIds ?? []),
      );
      const entries = [
        ...catalog.entries.filter(
          (entry) =>
            entry.providerKind !== "ollama" ||
            ollamaModelIds.has(entry.modelId),
        ),
        ...[...ollamaModelIds]
          .filter(
            (modelId) =>
              !catalog.entries.some(
                (entry) =>
                  entry.providerKind === "ollama" &&
                  entry.modelId === modelId,
              ),
          )
          .map((modelId) => ({
            routedModelId: `ollama:${modelId}`,
            providerKind: "ollama" as const,
            modelId,
            label: modelId,
            capabilities: defaultModelCapabilities(),
            verified: true,
            verifiedAt: now().toISOString(),
          })),
      ];
      return {
        ...catalog,
        connections,
        entries,
      };
    },

    async testConnection() {
      if (options.modelRouter) {
        try {
          const bound = await options.modelRouter.resolve();
          return testBoundClient({
            client: bound.client,
            baseUrl: bound.binding.baseUrl ?? "",
            apiKey: "",
            model: bound.binding.modelId,
          });
        } catch (error) {
          return {
            ok: false,
            message:
              error instanceof Error
                ? error.message
                : "模型配置不完整。",
          };
        }
      }

      const settings = await options.modelSettingsStore.load();
      const apiKey = await options.modelSettingsStore.getApiKey();
      if (!settings.chatModel || !apiKey) {
        return {
          ok: false,
          message: "模型配置不完整：请先保存 base URL、对话模型和 API Key。",
        };
      }
      return testBoundClient({
        client: options.chatClient,
        baseUrl: settings.baseUrl,
        apiKey,
        model: settings.chatModel,
      });
    },

    async testProvider(input) {
      const startedAt = now();
      try {
        if ("profileId" in input) {
          if (!options.modelRouter) {
            throw new Error("模型路由器不可用。");
          }
          const bound = await options.modelRouter.resolve(input.profileId);
          const result = await testBoundClient({
            client: bound.client,
            baseUrl: bound.binding.baseUrl ?? "",
            apiKey: "",
            model: bound.binding.modelId,
          });
          if (!result.ok) return result;
          return {
            ok: true,
            message: result.message,
            providerKind: bound.binding.providerKind,
            latencyMs: result.latencyMs,
            checkedAt: result.checkedAt,
          };
        }

        const descriptor = requireProviderDescriptor(
          input.connection.providerKind,
        );
        const storedConnection = input.connection.id
          ? await options.modelSettingsStore.resolveConnection(
              input.connection.id,
            )
          : null;
        if (
          storedConnection &&
          storedConnection.providerKind !== descriptor.kind
        ) {
          throw new Error("临时配置与已保存连接的服务商不一致。");
        }
        const mergedValues = {
          ...(storedConnection?.connectionValues ?? {}),
          ...input.connection.values,
        };
        const secrets: Record<string, string> = {
          ...(storedConnection?.secrets ?? {}),
        };
        for (const field of descriptor.fields.filter(
          (candidate) => candidate.secret,
        )) {
          const temporaryValue = input.connection.values[field.key]?.trim();
          if (temporaryValue) {
            secrets[field.key] = temporaryValue;
          }
        }
        const environmentSecret =
          input.connection.credentialSource === "environment" &&
          descriptor.environmentKey
            ? process.env[descriptor.environmentKey] ?? ""
            : "";
        if (environmentSecret) {
          const targetField =
            descriptor.fields.find((field) => field.key === "apiKey") ??
            descriptor.fields.find((field) => field.secret);
          if (targetField) {
            secrets[targetField.key] = environmentSecret;
          }
        }
        const errors = validateProviderFields(
          descriptor,
          mergedValues,
          { hasStoredSecret: Object.keys(secrets).length > 0 },
        );
        if (Object.keys(errors).length) {
          return {
            ok: false,
            message: Object.values(errors).join(" "),
          };
        }
        if (descriptor.kind === "ollama") {
          const probe = await probeOllama(
            mergedValues.baseUrl ?? "http://localhost:11434",
          );
          if (!probe.ok) throw new Error(probe.message);
          return {
            ok: true,
            message: probe.message,
            providerKind: "ollama",
            latencyMs: Math.max(0, now().getTime() - startedAt.getTime()),
            checkedAt: now().toISOString(),
            models: probe.models,
          };
        }

        validateTemporaryConditionalCredentials(
          descriptor.kind,
          mergedValues,
          secrets,
        );
        const values = Object.fromEntries(
          descriptor.fields
            .filter((field) => !field.secret)
            .map((field) => [
              field.key,
              mergedValues[field.key]?.trim() ||
                field.defaultValue ||
                "",
            ]),
        );
        const provider = createProvider(
          {
            providerKind: descriptor.kind,
            apiKey: secrets.apiKey ?? "",
            chatModel:
              input.modelId ?? descriptor.recommendedModel ?? "",
            connectionValues: values,
            secrets,
          },
          { fetch: fetchImpl },
        );
        const client = createProviderChatClient({
          provider,
          fallback: createOpenAiCompatibleClient({ fetch: fetchImpl }),
        });
        const result = await testBoundClient({
          client: client as ChatClient & StreamingChatClient,
          baseUrl:
            resolveProviderBaseUrl(descriptor.kind, values) ?? "",
          apiKey:
            secrets.apiKey ??
            secrets.bedrockApiKey ??
            secrets.vertexApiKey ??
            "",
          model: input.modelId ?? descriptor.recommendedModel ?? "",
        });
        if (!result.ok) return result;
        return {
          ok: true,
          message: result.message,
          providerKind: descriptor.kind,
          latencyMs: result.latencyMs,
          checkedAt: result.checkedAt,
        };
      } catch (error) {
        return {
          ok: false,
          message: `服务商连接测试失败：${
            error instanceof Error ? error.message : "未知错误"
          }`,
        };
      }
    },
  };
}

function validateTemporaryConditionalCredentials(
  providerKind: ProviderKind,
  values: Record<string, string>,
  secrets: Record<string, string>,
): void {
  if (providerKind === "bedrock") {
    const method = values.authMethod || "api_key";
    if (method === "api_key" && !secrets.bedrockApiKey) {
      throw new Error("Bedrock API Key 必填。");
    }
    if (
      method === "iam" &&
      (!values.awsAccessKeyId?.trim() || !secrets.awsSecretAccessKey)
    ) {
      throw new Error("IAM Access Key ID 和 Secret Access Key 必填。");
    }
  }
  if (providerKind === "vertex") {
    const method = values.authMethod || "adc";
    if (method === "service_account" && !secrets.serviceAccountJson) {
      throw new Error("Service Account JSON 必填。");
    }
    if (method === "api_key" && !secrets.vertexApiKey) {
      throw new Error("Vertex API Key 必填。");
    }
  }
}
