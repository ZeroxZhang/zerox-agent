import { describe, expect, it, vi } from "vitest";
import { createModelConnectionService } from "./modelConnectionService";
import type { ChatCompletionRequest, ChatClient } from "./openAiCompatibleClient";
import type { ModelSettingsStore } from "./modelSettingsStore";
import type { PublicModelSettings } from "../shared/modelSettings";

describe("model connection service", () => {
  it("sends a compact chat request with the saved model profile", async () => {
    const requests: ChatCompletionRequest[] = [];
    const service = createModelConnectionService({
      modelSettingsStore: createModelSettingsStore(
        {
          chatModel: "qwen-plus",
          hasApiKey: true,
        },
        "secret-key",
      ),
      chatClient: createChatClient(requests, "OK"),
      now: createClock(["2026-06-06T08:00:00.000Z", "2026-06-06T08:00:01.250Z"]),
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
      modelSettingsStore: createModelSettingsStore(
        {
          chatModel: "",
          hasApiKey: false,
        },
        null,
      ),
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
      modelSettingsStore: createModelSettingsStore(
        {
          chatModel: "bad-model",
          hasApiKey: true,
        },
        "secret-key",
      ),
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

  it("probes Ollama /api/tags once per 30-second cache window and filters unavailable models", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            models: [{ name: "qwen3-coder:30b" }, { name: "llama3.3:70b" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const service = createModelConnectionService({
      modelSettingsStore: createModelSettingsStore(
        { chatModel: "", hasApiKey: false },
        null,
      ) as ModelSettingsStore,
      chatClient: createChatClient([], "unused"),
      fetch: fetchMock as typeof fetch,
      now: () => new Date("2026-07-30T00:00:00.000Z"),
    });
    const catalog = {
      schemaVersion: 2 as const,
      descriptors: [],
      entries: [
        {
          routedModelId: "ollama:qwen3-coder:30b",
          providerKind: "ollama" as const,
          modelId: "qwen3-coder:30b",
          label: "Qwen",
          capabilities: {
            tools: false,
            vision: false,
            pdf: false,
            streaming: true,
            parallelToolCalls: false,
          },
          verified: true,
        },
      ],
      connections: [
        {
          id: "ollama-local",
          name: "Local",
          providerKind: "ollama" as const,
          values: { baseUrl: "http://localhost:11434" },
          credentialSource: "none" as const,
          hasCredential: true,
          revision: 1,
          createdAt: "2026-07-30T00:00:00.000Z",
          updatedAt: "2026-07-30T00:00:00.000Z",
        },
      ],
      profiles: [],
      defaultChatProfileId: null,
      defaultEmbeddingProfileId: null,
      hiddenRoutedModelIds: [],
      updatedAt: null,
    };

    const first = await service.enrichCatalog(catalog);
    const second = await service.enrichCatalog(catalog);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.connections[0]).toMatchObject({
      availability: "available",
      availableModelIds: ["llama3.3:70b", "qwen3-coder:30b"],
    });
    expect(first.entries.map((entry) => entry.modelId)).toEqual([
      "qwen3-coder:30b",
      "llama3.3:70b",
    ]);
    expect(second).toEqual(first);
  });

  it("does not report a credentialed cloud connection as available until it is verified", async () => {
    const service = createModelConnectionService({
      modelSettingsStore: createModelSettingsStore(
        { chatModel: "", hasApiKey: false },
        null,
      ) as ModelSettingsStore,
      chatClient: createChatClient([], "unused"),
    });
    const connection = {
      id: "openai-primary",
      name: "OpenAI",
      providerKind: "openai" as const,
      values: { baseUrl: "https://api.openai.com/v1" },
      credentialSource: "stored" as const,
      hasCredential: true,
      revision: 1,
      createdAt: "2026-07-31T00:00:00.000Z",
      updatedAt: "2026-07-31T00:00:00.000Z",
    };
    const catalog = {
      schemaVersion: 2 as const,
      descriptors: [],
      entries: [],
      connections: [connection],
      profiles: [],
      defaultChatProfileId: null,
      defaultEmbeddingProfileId: null,
      hiddenRoutedModelIds: [],
      updatedAt: null,
    };

    await expect(service.enrichCatalog(catalog)).resolves.toMatchObject({
      connections: [{ availability: "unknown" }],
    });
    await expect(
      service.enrichCatalog({
        ...catalog,
        connections: [
          {
            ...connection,
            verification: {
              status: "passed",
              checkedAt: "2026-07-31T00:00:01.000Z",
              message: "模型连接测试成功。",
              latencyMs: 200,
              connectionRevision: 1,
            },
          },
        ],
      }),
    ).resolves.toMatchObject({
      connections: [{ availability: "available" }],
    });
  });

  it("tests a Coding Plan draft before saving and persists the verified state", async () => {
    const checkedAt = "2026-07-31T00:00:01.000Z";
    const connection = {
      id: "coding-plan",
      name: "Coding Plan",
      providerKind: "dashscope-coding" as const,
      values: { baseUrl: "https://coding.dashscope.aliyuncs.com/v1" },
      credentialSource: "stored" as const,
      hasCredential: true,
      revision: 1,
      createdAt: checkedAt,
      updatedAt: checkedAt,
    };
    const catalog = {
      schemaVersion: 2 as const,
      descriptors: [],
      entries: [],
      connections: [connection],
      profiles: [
        {
          id: "coding-plan-profile",
          name: "Qwen 3.7 Plus",
          connectionId: "coding-plan",
          modelId: "qwen3.7-plus",
          purpose: "chat" as const,
          generation: {
            temperature: 0.2,
            maxTokens: 8192,
            thinkingEnabled: false,
            thinkingBudgetTokens: 8192,
          },
          custom: false,
          revision: 1,
          createdAt: checkedAt,
          updatedAt: checkedAt,
        },
      ],
      defaultChatProfileId: null,
      defaultEmbeddingProfileId: null,
      hiddenRoutedModelIds: [],
      updatedAt: checkedAt,
    };
    const saveConnection = vi.fn(async () => ({
      ok: true as const,
      catalog,
      connection,
    }));
    const recordConnectionVerification = vi.fn(async (_connectionId, _revision, verification) => ({
      ok: true as const,
      catalog: {
        ...catalog,
        connections: [
          {
            ...connection,
            verification: {
              ...verification,
              connectionRevision: 1,
            },
          },
        ],
      },
    }));
    const recordProfileVerification = vi.fn(
      async (_profileId, _profileRevision, _connectionRevision, verification) => ({
        ok: true as const,
        catalog: {
          ...catalog,
          connections: [
            {
              ...connection,
              verification: {
                status: "passed" as const,
                checkedAt,
                message: "passed",
                connectionRevision: 1,
              },
            },
          ],
          profiles: catalog.profiles.map((profile) => ({
            ...profile,
            verification: {
              ...verification,
              profileRevision: 1,
              connectionRevision: 1,
            },
          })),
        },
      }),
    );
    const setDefaultProfile = vi.fn(async () => ({
      ok: true as const,
      catalog: {
        ...catalog,
        connections: [
          {
            ...connection,
            verification: {
              status: "passed" as const,
              checkedAt,
              message: "passed",
              connectionRevision: 1,
            },
          },
        ],
        defaultChatProfileId: "coding-plan-profile",
      },
    }));
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const service = createModelConnectionService({
      modelSettingsStore: {
        saveConnection,
        recordConnectionVerification,
        recordProfileVerification,
        setDefaultProfile,
      } as unknown as ModelSettingsStore,
      chatClient: createChatClient([], "unused"),
      fetch: fetchMock as typeof fetch,
      now: () => new Date(checkedAt),
    });

    const result = await service.testAndSaveProvider({
      name: "Coding Plan",
      providerKind: "dashscope-coding",
      credentialSource: "stored",
      values: {
        apiKey: "coding-secret",
        baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
      },
    });

    expect(result).toMatchObject({
      ok: true,
      connection: {
        id: "coding-plan",
        availability: "available",
        verification: { status: "passed" },
      },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://coding.dashscope.aliyuncs.com/v1/chat/completions",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer coding-secret",
        }),
      }),
    );
    expect(saveConnection).toHaveBeenCalledTimes(1);
    expect(recordConnectionVerification).toHaveBeenCalledWith(
      "coding-plan",
      1,
      expect.objectContaining({ status: "passed" }),
    );
    expect(recordProfileVerification).toHaveBeenCalledWith(
      "coding-plan-profile",
      1,
      1,
      expect.objectContaining({ status: "passed" }),
    );
  });

  it("uses an installed Ollama model instead of verifying a missing recommendation", async () => {
    const checkedAt = "2026-07-31T00:00:01.000Z";
    const connection = {
      id: "ollama-local",
      name: "Ollama",
      providerKind: "ollama" as const,
      values: { baseUrl: "http://localhost:11434" },
      credentialSource: "none" as const,
      hasCredential: true,
      revision: 1,
      createdAt: checkedAt,
      updatedAt: checkedAt,
    };
    const recommendedProfile = {
      id: "recommended-profile",
      name: "qwen3-coder:30b",
      connectionId: connection.id,
      modelId: "qwen3-coder:30b",
      purpose: "chat" as const,
      generation: {
        temperature: 0.2,
        maxTokens: 8192,
        thinkingEnabled: false,
        thinkingBudgetTokens: 8192,
      },
      custom: false,
      revision: 1,
      createdAt: checkedAt,
      updatedAt: checkedAt,
    };
    const installedProfile = {
      ...recommendedProfile,
      id: "installed-profile",
      name: "llama3.3:70b",
      modelId: "llama3.3:70b",
      custom: true,
    };
    const catalog = {
      schemaVersion: 2 as const,
      descriptors: [],
      entries: [],
      connections: [connection],
      profiles: [recommendedProfile],
      defaultChatProfileId: null,
      defaultEmbeddingProfileId: null,
      hiddenRoutedModelIds: [],
      updatedAt: checkedAt,
    };
    const saveProfile = vi.fn(async () => ({
      ok: true as const,
      profile: installedProfile,
      catalog: { ...catalog, profiles: [recommendedProfile, installedProfile] },
    }));
    const recordConnectionVerification = vi.fn(async () => ({
      ok: true as const,
      catalog,
    }));
    const recordProfileVerification = vi.fn(async () => ({
      ok: true as const,
      catalog: { ...catalog, profiles: [recommendedProfile, installedProfile] },
    }));
    const setDefaultProfile = vi.fn(async () => ({
      ok: true as const,
      catalog: {
        ...catalog,
        profiles: [recommendedProfile, installedProfile],
        defaultChatProfileId: installedProfile.id,
      },
    }));
    const fetchMock = vi.fn(
      async (url) =>
        String(url).endsWith("/api/tags")
          ? new Response(
              JSON.stringify({ models: [{ name: "llama3.3:70b" }] }),
              { status: 200, headers: { "content-type": "application/json" } },
            )
          : new Response(
              JSON.stringify({
                choices: [
                  { message: { content: "OK" }, finish_reason: "stop" },
                ],
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
    );
    const service = createModelConnectionService({
      modelSettingsStore: {
        saveConnection: vi.fn(async () => ({
          ok: true as const,
          catalog,
          connection,
        })),
        resolveConnection: vi.fn(async () => ({
          id: connection.id,
          providerKind: "ollama" as const,
          credentialSource: "none" as const,
          connectionValues: { baseUrl: "http://localhost:11434" },
          secrets: {},
          revision: 1,
        })),
        saveProfile,
        recordConnectionVerification,
        recordProfileVerification,
        setDefaultProfile,
      } as unknown as ModelSettingsStore,
      chatClient: createChatClient([], "unused"),
      fetch: fetchMock as typeof fetch,
      now: () => new Date(checkedAt),
    });

    const result = await service.testAndSaveProvider({
      name: "Ollama",
      providerKind: "ollama",
      credentialSource: "none",
      values: { baseUrl: "http://localhost:11434" },
    });

    expect(result).toMatchObject({
      ok: true,
      test: { modelId: "llama3.3:70b" },
      catalog: { defaultChatProfileId: "installed-profile" },
    });
    expect(saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: "llama3.3:70b" }),
    );
    expect(recordProfileVerification).toHaveBeenCalledWith(
      "installed-profile",
      1,
      1,
      expect.objectContaining({ status: "passed" }),
    );
    expect(recordProfileVerification).not.toHaveBeenCalledWith(
      "recommended-profile",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );

    setDefaultProfile.mockClear();
    const retestedExisting = await service.testAndSaveProvider({
      id: connection.id,
      expectedRevision: connection.revision,
      name: "Ollama renamed",
      providerKind: "ollama",
      credentialSource: "none",
      values: { baseUrl: "http://localhost:11434" },
    });
    expect(retestedExisting).toMatchObject({
      ok: true,
      catalog: { defaultChatProfileId: null },
    });
    expect(setDefaultProfile).not.toHaveBeenCalled();
  });

  it("routes a custom Anthropic draft only to the configured Messages endpoint", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            content: [{ type: "text", text: "OK" }],
            stop_reason: "end_turn",
            usage: { input_tokens: 5, output_tokens: 1 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const service = createModelConnectionService({
      modelSettingsStore: {} as ModelSettingsStore,
      chatClient: createChatClient([], "unused"),
      fetch: fetchMock as typeof fetch,
      now: () => new Date("2026-07-31T00:00:01.000Z"),
    });

    await expect(
      service.testProvider({
        connection: {
          name: "Private Anthropic",
          providerKind: "custom",
          credentialSource: "stored",
          values: {
            protocol: "anthropic",
            apiKey: "private-secret",
            baseUrl: "https://private.example/v1",
            modelId: "private-claude",
          },
        },
      }),
    ).resolves.toMatchObject({ ok: true, providerKind: "custom" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://private.example/v1/messages",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-api-key": "private-secret",
          "anthropic-version": expect.any(String),
        }),
      }),
    );
  });

  it("rejects a saved custom protocol switch before any credentialed request", async () => {
    const fetchMock = vi.fn();
    const service = createModelConnectionService({
      modelSettingsStore: {
        resolveConnection: vi.fn(async () => ({
          id: "custom_1",
          providerKind: "custom" as const,
          credentialSource: "stored" as const,
          connectionValues: {
            protocol: "openai",
            baseUrl: "https://openai-proxy.example/v1",
            modelId: "proxy-model",
          },
          secrets: { apiKey: "stored-secret" },
          revision: 2,
        })),
      } as unknown as ModelSettingsStore,
      chatClient: createChatClient([], "unused"),
      fetch: fetchMock as typeof fetch,
    });

    await expect(
      service.testProvider({
        connection: {
          id: "custom_1",
          expectedRevision: 2,
          name: "Private gateway",
          providerKind: "custom",
          credentialSource: "stored",
          values: {
            protocol: "anthropic",
            apiKey: "",
            baseUrl: "https://anthropic-proxy.example",
            modelId: "private-claude",
          },
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("不能切换接口协议"),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not reuse a stored key across endpoints and accepts an explicit replacement key", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const service = createModelConnectionService({
      modelSettingsStore: {
        resolveConnection: vi.fn(async () => ({
          id: "custom_1",
          providerKind: "custom" as const,
          credentialSource: "stored" as const,
          connectionValues: {
            protocol: "openai",
            baseUrl: "https://first.example/v1",
            modelId: "proxy-model",
          },
          secrets: { apiKey: "original-secret" },
          revision: 2,
        })),
      } as unknown as ModelSettingsStore,
      chatClient: createChatClient([], "unused"),
      fetch: fetchMock as typeof fetch,
    });
    const draft = {
      id: "custom_1",
      expectedRevision: 2,
      name: "Private gateway",
      providerKind: "custom" as const,
      credentialSource: "stored" as const,
      values: {
        protocol: "openai",
        apiKey: "",
        baseUrl: "https://second.example/v1",
        modelId: "proxy-model",
      },
    };

    await expect(
      service.testProvider({ connection: draft }),
    ).resolves.toMatchObject({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();

    await expect(
      service.testProvider({
        connection: {
          ...draft,
          values: { ...draft.values, apiKey: "replacement-secret" },
        },
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://second.example/v1/chat/completions",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer replacement-secret",
        }),
      }),
    );
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain(
      "original-secret",
    );
  });

  it("does not reuse a stored Bedrock key when the draft changes region", async () => {
    const fetchMock = vi.fn();
    const service = createModelConnectionService({
      modelSettingsStore: {
        resolveConnection: vi.fn(async () => ({
          id: "bedrock_1",
          providerKind: "bedrock" as const,
          credentialSource: "stored" as const,
          connectionValues: {
            region: "us-east-1",
            authMethod: "api_key",
          },
          secrets: { bedrockApiKey: "east-secret" },
          revision: 1,
        })),
      } as unknown as ModelSettingsStore,
      chatClient: createChatClient([], "unused"),
      fetch: fetchMock as typeof fetch,
    });

    await expect(
      service.testProvider({
        connection: {
          id: "bedrock_1",
          expectedRevision: 1,
          name: "Bedrock west",
          providerKind: "bedrock",
          credentialSource: "stored",
          values: {
            region: "us-west-2",
            authMethod: "api_key",
            bedrockApiKey: "",
          },
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("Bedrock API Key"),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("tests a saved profile without marking it used and surfaces verification conflicts", async () => {
    const resolveProfile = vi.fn(async () => ({
      binding: {
        profileId: "profile_1",
        connectionId: "connection_1",
        providerKind: "openai" as const,
        modelId: "gpt-test",
        revision: 7,
        connectionRevision: 3,
        profileRevision: 1,
        baseUrl: "https://api.openai.com/v1",
        capabilities: {
          tools: true,
          vision: false,
          pdf: false,
          streaming: true,
          parallelToolCalls: true,
        },
        generation: {
          temperature: 0.2,
          maxTokens: 4096,
          thinkingEnabled: false,
          thinkingBudgetTokens: 0,
        },
      },
      connectionValues: { baseUrl: "https://api.openai.com/v1" },
      secrets: { apiKey: "profile-secret" },
      profile: {
        id: "profile_1",
        name: "GPT test",
        connectionId: "connection_1",
        modelId: "gpt-test",
        purpose: "chat" as const,
        generation: {
          temperature: 0.2,
          maxTokens: 4096,
          thinkingEnabled: false,
          thinkingBudgetTokens: 0,
        },
        custom: true,
        revision: 1,
        createdAt: "2026-07-31T00:00:00.000Z",
        updatedAt: "2026-07-31T00:00:00.000Z",
      },
    }));
    const recordProfileVerification = vi.fn(async () => ({
      ok: false as const,
      message: "模型已在测试期间更新，请重新测试。",
    }));
    const recordConnectionVerification = vi.fn(async () => ({
      ok: true as const,
      catalog: {} as never,
    }));
    const routerResolve = vi.fn(async () => {
      throw new Error("profile tests must not route through markConnectionUsed");
    });
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const service = createModelConnectionService({
      modelSettingsStore: {
        resolveProfile,
        recordConnectionVerification,
        recordProfileVerification,
      } as unknown as ModelSettingsStore,
      chatClient: createChatClient([], "unused"),
      modelRouter: {
        resolve: routerResolve,
      } as never,
      fetch: fetchMock as typeof fetch,
      now: () => new Date("2026-07-31T00:00:01.000Z"),
    });

    await expect(service.testProvider({ profileId: "profile_1" })).resolves.toMatchObject({
      ok: false,
      providerKind: "openai",
      message: expect.stringContaining("验证状态未保存"),
    });
    expect(resolveProfile).toHaveBeenCalledWith("profile_1");
    expect(routerResolve).not.toHaveBeenCalled();
    expect(recordProfileVerification).toHaveBeenCalledWith(
      "profile_1",
      1,
      3,
      expect.objectContaining({ status: "passed" }),
    );
    expect(recordConnectionVerification).toHaveBeenCalledWith(
      "connection_1",
      3,
      expect.objectContaining({ status: "passed" }),
    );
  });

  it("normalizes the saved Ollama base URL before testing a chat profile", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const successfulMutation = vi.fn(async () => ({
      ok: true as const,
      catalog: {} as never,
    }));
    const service = createModelConnectionService({
      modelSettingsStore: {
        resolveProfile: vi.fn(async () => ({
          binding: {
            profileId: "ollama_chat",
            connectionId: "ollama_local",
            providerKind: "ollama" as const,
            modelId: "llama3.3:70b",
            revision: 1,
            connectionRevision: 1,
            profileRevision: 1,
            baseUrl: "http://localhost:11434",
            capabilities: {
              tools: false,
              vision: false,
              pdf: false,
              streaming: true,
              parallelToolCalls: false,
            },
            generation: {
              temperature: 0.2,
              maxTokens: 4096,
              thinkingEnabled: false,
              thinkingBudgetTokens: 0,
            },
          },
          connectionValues: { baseUrl: "http://localhost:11434" },
          secrets: {},
          profile: {
            id: "ollama_chat",
            name: "Llama",
            connectionId: "ollama_local",
            modelId: "llama3.3:70b",
            purpose: "chat" as const,
            generation: {
              temperature: 0.2,
              maxTokens: 4096,
              thinkingEnabled: false,
              thinkingBudgetTokens: 0,
            },
            custom: true,
            revision: 1,
            createdAt: "2026-07-31T00:00:00.000Z",
            updatedAt: "2026-07-31T00:00:00.000Z",
          },
        })),
        recordConnectionVerification: successfulMutation,
        recordProfileVerification: successfulMutation,
      } as unknown as ModelSettingsStore,
      chatClient: createChatClient([], "unused"),
      fetch: fetchMock as typeof fetch,
    });

    await expect(
      service.testProvider({ profileId: "ollama_chat" }),
    ).resolves.toMatchObject({ ok: true, modelId: "llama3.3:70b" });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:11434/v1/chat/completions",
      expect.any(Object),
    );
  });

  it("tests embedding profiles through the embeddings endpoint", async () => {
    const recordProfileVerification = vi.fn(async () => ({
      ok: true as const,
      catalog: {} as never,
    }));
    const recordConnectionVerification = vi.fn(async () => ({
      ok: true as const,
      catalog: {} as never,
    }));
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2] }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const service = createModelConnectionService({
      modelSettingsStore: {
        resolveProfile: vi.fn(async () => ({
          binding: {
            profileId: "embedding_1",
            connectionId: "connection_1",
            providerKind: "ollama" as const,
            modelId: "text-embedding-test",
            revision: 5,
            connectionRevision: 2,
            profileRevision: 3,
            baseUrl: "http://localhost:11434",
            capabilities: {
              tools: false,
              vision: false,
              pdf: false,
              streaming: false,
              parallelToolCalls: false,
            },
            generation: {
              temperature: 0,
              maxTokens: 1,
              thinkingEnabled: false,
              thinkingBudgetTokens: 0,
            },
          },
          connectionValues: { baseUrl: "http://localhost:11434" },
          secrets: {},
          profile: {
            id: "embedding_1",
            name: "Embedding",
            connectionId: "connection_1",
            modelId: "text-embedding-test",
            purpose: "embedding" as const,
            generation: {
              temperature: 0,
              maxTokens: 1,
              thinkingEnabled: false,
              thinkingBudgetTokens: 0,
            },
            custom: true,
            revision: 3,
            createdAt: "2026-07-31T00:00:00.000Z",
            updatedAt: "2026-07-31T00:00:00.000Z",
          },
        })),
        recordConnectionVerification,
        recordProfileVerification,
      } as unknown as ModelSettingsStore,
      chatClient: createChatClient([], "unused"),
      fetch: fetchMock as typeof fetch,
      now: () => new Date("2026-07-31T00:00:01.000Z"),
    });

    await expect(
      service.testProvider({ profileId: "embedding_1" }),
    ).resolves.toMatchObject({
      ok: true,
      message: "Embedding 模型连接测试成功。",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:11434/v1/embeddings",
      expect.objectContaining({
        body: expect.stringContaining("text-embedding-test"),
      }),
    );
    expect(recordProfileVerification).toHaveBeenCalledWith(
      "embedding_1",
      3,
      2,
      expect.objectContaining({ status: "passed" }),
    );
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

function createChatClient(requests: ChatCompletionRequest[], responseContent: string): ChatClient {
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
