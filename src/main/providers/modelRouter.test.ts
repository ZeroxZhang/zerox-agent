import { describe, expect, it, vi } from "vitest";
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  StreamingChatClient,
} from "../openAiCompatibleClient";
import type {
  ModelSettingsStore,
  ResolvedModelProfile,
} from "../modelSettingsStore";
import type { ResolvedModelBinding } from "../../shared/modelSettings";
import { createModelRouter } from "./modelRouter";

const generation = {
  temperature: 0.2,
  maxTokens: 512,
  thinkingEnabled: false,
  thinkingBudgetTokens: 0,
};

const capabilities = {
  tools: true,
  vision: false,
  pdf: false,
  streaming: true,
  parallelToolCalls: true,
};

function resolved(input: {
  profileId: string;
  connectionId: string;
  modelId: string;
  baseUrl: string;
  apiKey: string;
  revision?: number;
}): ResolvedModelProfile {
  const revision = input.revision ?? 1;
  const binding: ResolvedModelBinding = {
    profileId: input.profileId,
    connectionId: input.connectionId,
    providerKind: "openai",
    modelId: input.modelId,
    revision,
    connectionRevision: revision,
    profileRevision: revision,
    baseUrl: input.baseUrl,
    capabilities,
    generation,
  };
  return {
    binding,
    connectionValues: { baseUrl: input.baseUrl },
    secrets: { apiKey: input.apiKey },
    profile: {
      id: input.profileId,
      name: input.profileId,
      connectionId: input.connectionId,
      modelId: input.modelId,
      purpose: "chat",
      generation,
      custom: false,
      revision,
      createdAt: "2026-07-30T00:00:00.000Z",
      updatedAt: "2026-07-30T00:00:00.000Z",
    },
  };
}

function request(): ChatCompletionRequest {
  return {
    baseUrl: "https://must-be-overridden.invalid/v1",
    apiKey: "must-be-overridden",
    model: "must-be-overridden",
    temperature: 1,
    maxTokens: 1,
    messages: [{ role: "user", content: "hello" }],
  };
}

function fallback(): StreamingChatClient {
  return {
    async complete(): Promise<ChatCompletionResponse> {
      throw new Error("fallback must not be used");
    },
    async *streamComplete() {
      throw new Error("fallback must not be used");
    },
  };
}

describe("ModelRouter", () => {
  it("keeps credentials and endpoints isolated across profiles for the same provider", async () => {
    const profiles = new Map([
      [
        "profile-a",
        resolved({
          profileId: "profile-a",
          connectionId: "connection-a",
          modelId: "model-a",
          baseUrl: "https://a.example/v1",
          apiKey: "key-a",
        }),
      ],
      [
        "profile-b",
        resolved({
          profileId: "profile-b",
          connectionId: "connection-b",
          modelId: "model-b",
          baseUrl: "https://b.example/v1",
          apiKey: "key-b",
        }),
      ],
    ]);
    const calls: Array<{ url: string; authorization: string; model: string }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { model: string };
      const headers = new Headers(init?.headers);
      calls.push({
        url: String(input),
        authorization: headers.get("authorization") ?? "",
        model: body.model,
      });
      return new Response(
        JSON.stringify({
          choices: [
            { message: { content: "ok" }, finish_reason: "stop" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    const store = {
      resolveProfile: async (profileId?: string | null) => {
        const profile = profileId ? profiles.get(profileId) : undefined;
        if (!profile) throw new Error("missing profile");
        return structuredClone(profile);
      },
      resolveBinding: async (binding: ResolvedModelBinding) => {
        const profile = profiles.get(binding.profileId);
        if (!profile) throw new Error("missing profile");
        return structuredClone(profile);
      },
      markConnectionUsed: async () => undefined,
    } as unknown as ModelSettingsStore;
    const router = createModelRouter({
      modelSettingsStore: store,
      fallback: fallback(),
      fetch: fetchImpl,
    });

    await (await router.resolve("profile-a")).client.complete(request());
    await (await router.resolve("profile-b")).client.complete(request());

    expect(calls).toEqual([
      {
        url: "https://a.example/v1/chat/completions",
        authorization: "Bearer key-a",
        model: "model-a",
      },
      {
        url: "https://b.example/v1/chat/completions",
        authorization: "Bearer key-b",
        model: "model-b",
      },
    ]);
  });

  it("resolves a frozen binding instead of silently switching models", async () => {
    const frozen = resolved({
      profileId: "profile-a",
      connectionId: "connection-a",
      modelId: "model-v1",
      baseUrl: "https://frozen.example/v1",
      apiKey: "frozen-key",
      revision: 1,
    });
    const current = resolved({
      profileId: "profile-a",
      connectionId: "connection-a",
      modelId: "model-v2",
      baseUrl: "https://current.example/v1",
      apiKey: "current-key",
      revision: 2,
    });
    const resolveBinding = vi.fn(async () => structuredClone(frozen));
    const store = {
      resolveProfile: async () => structuredClone(current),
      resolveBinding,
      markConnectionUsed: async () => undefined,
    } as unknown as ModelSettingsStore;
    const router = createModelRouter({
      modelSettingsStore: store,
      fallback: fallback(),
      fetch: (async () =>
        new Response(
          JSON.stringify({
            choices: [
              { message: { content: "ok" }, finish_reason: "stop" },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        )) as typeof fetch,
    });

    const bound = await router.resolveFrozen(frozen.binding);

    expect(resolveBinding).toHaveBeenCalledWith(frozen.binding);
    expect(bound.binding.modelId).toBe("model-v1");
    expect(bound.binding.revision).toBe(1);
  });
});
