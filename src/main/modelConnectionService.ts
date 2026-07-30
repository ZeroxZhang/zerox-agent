import type {
  ProviderConnectionInput,
  ProviderKind,
  PublicModelCatalog,
  TestAndSaveProviderConnectionResult,
  TestModelConnectionResult,
  TestProviderConnectionInput,
  TestProviderConnectionResult,
} from "../shared/modelSettings";
import {
  defaultModelCapabilities,
  providerConnectionTargetIdentity,
} from "../shared/modelSettings";
import { fetchWithTimeout } from "./fetchWithTimeout";
import type { ModelSettingsStore, ResolvedModelProfile } from "./modelSettingsStore";
import type { ChatClient, StreamingChatClient } from "./openAiCompatibleClient";
import {
  createOpenAiCompatibleClient,
  createOpenAiCompatibleEmbeddingClient,
} from "./openAiCompatibleClient";
import type { ModelRouter } from "./providers/modelRouter";
import { createProviderChatClient } from "./providers/providerChatClient";
import { createProvider, resolveProviderBaseUrl } from "./providers/providerFactory";
import {
  normalizeOllamaBaseUrl,
  providerSupportsEmbeddings,
  requireProviderDescriptor,
  validateProviderFields,
} from "./providers/providerRegistry";

export type ModelConnectionService = {
  testConnection(): Promise<TestModelConnectionResult>;
  testProvider(input: TestProviderConnectionInput): Promise<TestProviderConnectionResult>;
  testAndSaveProvider(input: ProviderConnectionInput): Promise<TestAndSaveProviderConnectionResult>;
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
          (json.models ?? []).map((model) => model.name ?? model.model ?? "").filter(Boolean),
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
        message: `模型连接测试失败：${error instanceof Error ? error.message : "未知错误"}`,
      };
    }
  }

  async function testBoundEmbedding(
    resolved: ResolvedModelProfile,
  ): Promise<TestModelConnectionResult> {
    const startedAt = now();
    if (
      !providerSupportsEmbeddings(
        resolved.binding.providerKind,
        resolved.connectionValues,
      )
    ) {
      return {
        ok: false,
        message: "该服务商或接口协议尚未实现 Embedding 调用。",
      };
    }
    try {
      const vector = await createOpenAiCompatibleEmbeddingClient({
        fetch: fetchImpl,
      }).embed({
        baseUrl:
          resolveProviderBaseUrl(
            resolved.binding.providerKind,
            resolved.connectionValues,
          ) ??
          resolved.binding.baseUrl ??
          "",
        apiKey: firstSecret(resolved.secrets),
        model: resolved.binding.modelId,
        input: "Zerox Agent embedding connection test",
      });
      const checkedAt = now();
      return {
        ok: true,
        message: "Embedding 模型连接测试成功。",
        model: resolved.binding.modelId,
        latencyMs: Math.max(0, checkedAt.getTime() - startedAt.getTime()),
        checkedAt: checkedAt.toISOString(),
        replyPreview: `${vector.length} dimensions`,
      };
    } catch (error) {
      return {
        ok: false,
        message: `Embedding 模型连接测试失败：${
          error instanceof Error ? error.message : "未知错误"
        }`,
      };
    }
  }

  function createClientForResolvedProfile(
    resolved: ResolvedModelProfile,
  ): ChatClient & StreamingChatClient {
    const provider = createProvider(
      {
        providerKind: resolved.binding.providerKind,
        apiKey: firstSecret(resolved.secrets),
        chatModel: resolved.binding.modelId,
        baseUrl:
          resolveProviderBaseUrl(
            resolved.binding.providerKind,
            resolved.connectionValues,
          ) ??
          resolved.binding.baseUrl,
        connectionValues: resolved.connectionValues,
        secrets: resolved.secrets,
      },
      { fetch: fetchImpl },
    );
    return createProviderChatClient({
      provider,
      fallback: createOpenAiCompatibleClient({ fetch: fetchImpl }),
    }) as ChatClient & StreamingChatClient;
  }

  const service: ModelConnectionService = {
    async enrichCatalog(catalog) {
      const connections = await Promise.all(
        catalog.connections.map(async (connection) => {
          if (connection.providerKind !== "ollama") {
            return {
              ...connection,
              availability: !connection.hasCredential
                ? ("unavailable" as const)
                : connection.verification?.status === "passed"
                  ? ("available" as const)
                  : connection.verification?.status === "failed"
                    ? ("unavailable" as const)
                    : ("unknown" as const),
            };
          }
          const probe = await probeOllama(connection.values.baseUrl ?? "http://localhost:11434");
          return {
            ...connection,
            availability: probe.ok ? ("available" as const) : ("unavailable" as const),
            availableModelIds: [...probe.models],
          };
        }),
      );
      const ollamaModelIds = new Set(
        connections
          .filter(
            (connection) =>
              connection.providerKind === "ollama" && connection.availability === "available",
          )
          .flatMap((connection) => connection.availableModelIds ?? []),
      );
      const entries = [
        ...catalog.entries.filter(
          (entry) => entry.providerKind !== "ollama" || ollamaModelIds.has(entry.modelId),
        ),
        ...[...ollamaModelIds]
          .filter(
            (modelId) =>
              !catalog.entries.some(
                (entry) => entry.providerKind === "ollama" && entry.modelId === modelId,
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
            message: error instanceof Error ? error.message : "模型配置不完整。",
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
          const bound = await options.modelSettingsStore.resolveProfile(input.profileId);
          const result =
            bound.profile.purpose === "embedding"
              ? await testBoundEmbedding(bound)
              : await testBoundClient({
                  client: createClientForResolvedProfile(bound),
                  baseUrl:
                    resolveProviderBaseUrl(
                      bound.binding.providerKind,
                      bound.connectionValues,
                    ) ??
                    bound.binding.baseUrl ??
                    "",
                  apiKey: firstSecret(bound.secrets),
                  model: bound.binding.modelId,
                });
          const failedCheckedAt = now().toISOString();
          const verification = result.ok
            ? {
                status: "passed" as const,
                checkedAt: result.checkedAt,
                message: result.message,
                latencyMs: result.latencyMs,
              }
            : {
                status: "failed" as const,
                checkedAt: failedCheckedAt,
                message: result.message,
                latencyMs: Math.max(0, Date.parse(failedCheckedAt) - startedAt.getTime()),
              };
          if (result.ok) {
            const connectionRecorded =
              await options.modelSettingsStore.recordConnectionVerification(
                bound.binding.connectionId,
                bound.binding.connectionRevision ?? 1,
                verification,
              );
            if (!connectionRecorded.ok) {
              return {
                ok: false,
                message: `模型测试已完成，但连接验证状态未保存：${connectionRecorded.message}`,
                providerKind: bound.binding.providerKind,
                checkedAt: verification.checkedAt,
                latencyMs: verification.latencyMs,
              };
            }
          }
          const recorded = await options.modelSettingsStore.recordProfileVerification(
            bound.profile.id,
            bound.profile.revision,
            bound.binding.connectionRevision ?? 1,
            verification,
          );
          if (!recorded.ok) {
            return {
              ok: false,
              message: `连接测试已完成，但验证状态未保存：${recorded.message}`,
              providerKind: bound.binding.providerKind,
              checkedAt: verification.checkedAt,
              latencyMs: verification.latencyMs,
            };
          }
          if (!result.ok) {
            return {
              ...result,
              providerKind: bound.binding.providerKind,
              checkedAt: verification.checkedAt,
              latencyMs: verification.latencyMs,
            };
          }
          return {
            ok: true,
            message: result.message,
            providerKind: bound.binding.providerKind,
            latencyMs: result.latencyMs,
            checkedAt: result.checkedAt,
            modelId: bound.binding.modelId,
          };
        }

        const descriptor = requireProviderDescriptor(input.connection.providerKind);
        const storedConnection = input.connection.id
          ? await options.modelSettingsStore.resolveConnection(input.connection.id)
          : null;
        if (storedConnection && storedConnection.providerKind !== descriptor.kind) {
          throw new Error("临时配置与已保存连接的服务商不一致。");
        }
        if (
          descriptor.kind === "custom" &&
          storedConnection?.connectionValues.protocol &&
          storedConnection.connectionValues.protocol !==
            (input.connection.values.protocol ||
              storedConnection.connectionValues.protocol)
        ) {
          throw new Error(
            "已保存的自定义连接不能切换接口协议；请新建连接，避免凭证被发送到不同协议端点。",
          );
        }
        const mergedValues = {
          ...(storedConnection?.connectionValues ?? {}),
          ...input.connection.values,
        };
        const requestedCredentialSource =
          input.connection.credentialSource ??
          storedConnection?.credentialSource ??
          (descriptor.needsCredential ? "stored" : "none");
        const canReuseStoredSecrets = Boolean(
          storedConnection &&
            storedConnection.credentialSource === requestedCredentialSource &&
            providerConnectionTargetIdentity(
              descriptor.kind,
              storedConnection.connectionValues,
            ) ===
              providerConnectionTargetIdentity(
                descriptor.kind,
                mergedValues,
              ),
        );
        const secrets: Record<string, string> = {
          ...(canReuseStoredSecrets ? storedConnection?.secrets ?? {} : {}),
        };
        for (const field of descriptor.fields.filter((candidate) => candidate.secret)) {
          const temporaryValue = input.connection.values[field.key]?.trim();
          if (temporaryValue) {
            secrets[field.key] = temporaryValue;
          }
        }
        const environmentSecret =
          requestedCredentialSource === "environment" && descriptor.environmentKey
            ? (process.env[descriptor.environmentKey] ?? "")
            : "";
        if (environmentSecret) {
          const targetField =
            descriptor.fields.find((field) => field.key === "apiKey") ??
            descriptor.fields.find((field) => field.secret);
          if (targetField) {
            secrets[targetField.key] = environmentSecret;
          }
        }
        const errors = validateProviderFields(descriptor, mergedValues, {
          hasStoredSecret: Object.keys(secrets).length > 0,
        });
        if (Object.keys(errors).length) {
          return {
            ok: false,
            message: Object.values(errors).join(" "),
          };
        }
        if (descriptor.kind === "ollama") {
          const probe = await probeOllama(mergedValues.baseUrl ?? "http://localhost:11434");
          if (!probe.ok) throw new Error(probe.message);
          const explicitlyRequestedModel = input.modelId?.trim();
          if (
            explicitlyRequestedModel &&
            !probe.models.includes(explicitlyRequestedModel)
          ) {
            throw new Error(
              `Ollama 尚未安装模型 ${explicitlyRequestedModel}。`,
            );
          }
          const preferredModel =
            explicitlyRequestedModel ||
            mergedValues.modelId?.trim() ||
            descriptor.recommendedModel ||
            "";
          const testedModelId = probe.models.includes(preferredModel)
            ? preferredModel
            : probe.models[0];
          if (!testedModelId) {
            throw new Error("Ollama 可达，但尚未安装任何模型。");
          }
          const modelTest = await testBoundClient({
            client: createOpenAiCompatibleClient({ fetch: fetchImpl }),
            baseUrl: normalizeOllamaBaseUrl(
              mergedValues.baseUrl ?? "http://localhost:11434",
            ),
            apiKey: "",
            model: testedModelId,
          });
          if (!modelTest.ok) {
            const checkedAt = now().toISOString();
            return {
              ...modelTest,
              providerKind: "ollama",
              latencyMs: Math.max(
                0,
                Date.parse(checkedAt) - startedAt.getTime(),
              ),
              checkedAt,
            };
          }
          return {
            ok: true,
            message: `${probe.message} ${testedModelId} 已完成对话测试。`,
            providerKind: "ollama",
            latencyMs: Math.max(0, now().getTime() - startedAt.getTime()),
            checkedAt: modelTest.checkedAt,
            models: probe.models,
            modelId: testedModelId,
          };
        }

        validateTemporaryConditionalCredentials(descriptor.kind, mergedValues, secrets);
        const values = Object.fromEntries(
          descriptor.fields
            .filter((field) => !field.secret)
            .map((field) => [
              field.key,
              mergedValues[field.key]?.trim() || field.defaultValue || "",
            ]),
        );
        const provider = createProvider(
          {
            providerKind: descriptor.kind,
            apiKey: secrets.apiKey ?? "",
            chatModel: input.modelId ?? mergedValues.modelId ?? descriptor.recommendedModel ?? "",
            baseUrl: resolveProviderBaseUrl(descriptor.kind, values),
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
          baseUrl: resolveProviderBaseUrl(descriptor.kind, values) ?? "",
          apiKey: secrets.apiKey ?? secrets.bedrockApiKey ?? secrets.vertexApiKey ?? "",
          model: input.modelId ?? mergedValues.modelId ?? descriptor.recommendedModel ?? "",
        });
        if (!result.ok) {
          const checkedAt = now().toISOString();
          return {
            ...result,
            providerKind: descriptor.kind,
            latencyMs: Math.max(0, Date.parse(checkedAt) - startedAt.getTime()),
            checkedAt,
          };
        }
        return {
          ok: true,
          message: result.message,
          providerKind: descriptor.kind,
          latencyMs: result.latencyMs,
          checkedAt: result.checkedAt,
          modelId:
            input.modelId ??
            mergedValues.modelId ??
            descriptor.recommendedModel ??
            "",
        };
      } catch (error) {
        const checkedAt = now().toISOString();
        return {
          ok: false,
          message: `服务商连接测试失败：${error instanceof Error ? error.message : "未知错误"}`,
          latencyMs: Math.max(0, Date.parse(checkedAt) - startedAt.getTime()),
          checkedAt,
        };
      }
    },

    async testAndSaveProvider(input) {
      const test = await service.testProvider({
        connection: input,
        modelId: input.values.modelId,
      });
      if (!test.ok) {
        return {
          ok: false,
          message: test.message,
          test,
        };
      }
      const saved = await options.modelSettingsStore.saveConnection(input);
      if (!saved.ok) {
        return saved;
      }
      const recorded = await options.modelSettingsStore.recordConnectionVerification(
        saved.connection.id,
        saved.connection.revision,
        {
          status: "passed",
          checkedAt: test.checkedAt,
          message: test.message,
          latencyMs: test.latencyMs,
        },
      );
      if (!recorded.ok) {
        return {
          ok: false,
          message: recorded.message,
          test,
        };
      }
      let savedCatalog = recorded.catalog;
      const testedModelId =
        test.modelId ||
        input.values.modelId?.trim() ||
        requireProviderDescriptor(input.providerKind).recommendedModel ||
        "";
      let initialProfile = savedCatalog.profiles.find(
        (profile) =>
          profile.connectionId === saved.connection.id &&
          profile.purpose === "chat" &&
          profile.modelId === testedModelId,
      );
      if (!initialProfile && testedModelId) {
        const createdProfile = await options.modelSettingsStore.saveProfile({
          name: testedModelId,
          connectionId: saved.connection.id,
          modelId: testedModelId,
          purpose: "chat",
        });
        if (!createdProfile.ok) {
          return {
            ok: false,
            message: `连接已验证，但测试模型未保存：${createdProfile.message}`,
            test,
          };
        }
        savedCatalog = createdProfile.catalog;
        initialProfile = createdProfile.profile;
      }
      if (initialProfile) {
        const profileRecorded =
          await options.modelSettingsStore.recordProfileVerification(
            initialProfile.id,
            initialProfile.revision,
            saved.connection.revision,
            {
              status: "passed",
              checkedAt: test.checkedAt,
              message: test.message,
              latencyMs: test.latencyMs,
            },
          );
        if (!profileRecorded.ok) {
          return {
            ok: false,
            message: `连接已验证，但模型验证状态未保存：${profileRecorded.message}`,
            test,
          };
        }
        savedCatalog = profileRecorded.catalog;
        if (!savedCatalog.defaultChatProfileId && !input.id) {
          const defaulted =
            await options.modelSettingsStore.setDefaultProfile(
              "chat",
              initialProfile.id,
            );
          if (!defaulted.ok) {
            return {
              ok: false,
              message: `连接已验证，但默认模型状态未保存：${defaulted.message}`,
              test,
            };
          }
          savedCatalog = defaulted.catalog;
        }
      }
      const catalog = await service.enrichCatalog(savedCatalog);
      const connection = catalog.connections.find(
        (candidate) => candidate.id === saved.connection.id,
      );
      if (!connection) {
        return {
          ok: false,
          message: "连接已保存，但无法读取保存后的连接状态。",
          test,
        };
      }
      return { ok: true, catalog, connection, test };
    },
  };
  return service;
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
    if (method === "iam" && (!values.awsAccessKeyId?.trim() || !secrets.awsSecretAccessKey)) {
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

function firstSecret(secrets: Record<string, string>): string {
  return secrets.apiKey ?? secrets.bedrockApiKey ?? secrets.vertexApiKey ?? "";
}
