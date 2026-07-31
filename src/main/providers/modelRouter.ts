import type {
  ChatClient,
  ChatCompletionRequest,
  ChatCompletionResponse,
  StreamingChatClient,
  StreamEvent as LowLevelStreamEvent,
} from "../openAiCompatibleClient";
import type {
  ResolvedModelBinding,
} from "../../shared/modelSettings";
import type {
  ModelSettingsStore,
  ResolvedModelProfile,
} from "../modelSettingsStore";
import { createProviderChatClient } from "./providerChatClient";
import {
  createProvider,
  resolveProviderBaseUrl,
} from "./providerFactory";
import type { LLMProvider } from "./provider";

export type BoundModelClient = {
  binding: ResolvedModelBinding;
  client: ChatClient & StreamingChatClient;
};

export type ModelRouter = {
  resolve(profileId?: string | null): Promise<BoundModelClient>;
  resolveFrozen(binding: ResolvedModelBinding): Promise<BoundModelClient>;
  invalidate(connectionId?: string): void;
};

export function createModelRouter(options: {
  modelSettingsStore: ModelSettingsStore;
  fallback: ChatClient & StreamingChatClient;
  fetch?: typeof fetch;
}): ModelRouter {
  const providerCache = new Map<string, LLMProvider>();

  async function bindResolved(
    resolved: ResolvedModelProfile,
  ): Promise<BoundModelClient> {
    const cacheKey = `${resolved.binding.connectionId}:${resolved.binding.revision}`;
    let provider = providerCache.get(cacheKey);
    if (!provider) {
      provider = createProviderForResolved(resolved, options.fetch);
      providerCache.set(cacheKey, provider);
    }
    const providerClient = createProviderChatClient({
      provider,
      fallback: options.fallback,
    });
    const apiKey = firstSecret(resolved.secrets);
    const baseUrl = resolveProviderBaseUrl(
      resolved.binding.providerKind,
      resolved.connectionValues,
    );
    const binding = structuredClone(resolved.binding);
    const client = bindRequestProfile(providerClient, {
      binding,
      apiKey,
      baseUrl,
    });
    void options.modelSettingsStore
      .markConnectionUsed(binding.connectionId)
      .catch(() => undefined);
    return { binding, client };
  }

  async function resolve(profileId?: string | null): Promise<BoundModelClient> {
    return bindResolved(
      await options.modelSettingsStore.resolveProfile(profileId),
    );
  }

  return {
    resolve,
    async resolveFrozen(binding) {
      return bindResolved(
        await options.modelSettingsStore.resolveBinding(binding),
      );
    },
    invalidate(connectionId) {
      if (!connectionId) {
        providerCache.clear();
        return;
      }
      for (const key of providerCache.keys()) {
        if (key.startsWith(`${connectionId}:`)) {
          providerCache.delete(key);
        }
      }
    },
  };
}

function createProviderForResolved(
  resolved: ResolvedModelProfile,
  fetchImpl?: typeof fetch,
): LLMProvider {
  return createProvider(
    {
      providerKind: resolved.binding.providerKind,
      apiKey: firstSecret(resolved.secrets),
      chatModel: resolved.binding.modelId,
      baseUrl: resolved.binding.baseUrl,
      connectionValues: resolved.connectionValues,
      secrets: resolved.secrets,
      thinkingEnabled: resolved.binding.generation.thinkingEnabled,
      thinkingBudgetTokens:
        resolved.binding.generation.thinkingBudgetTokens,
    },
    fetchImpl ? { fetch: fetchImpl } : {},
  );
}

function bindRequestProfile(
  client: ChatClient & StreamingChatClient,
  options: {
    binding: ResolvedModelBinding;
    apiKey: string;
    baseUrl?: string;
  },
): ChatClient & StreamingChatClient {
  const apply = (request: ChatCompletionRequest): ChatCompletionRequest => ({
    ...request,
    model: options.binding.modelId,
    apiKey: options.apiKey,
    baseUrl: options.baseUrl ?? request.baseUrl,
    temperature: options.binding.generation.temperature,
    maxTokens: options.binding.generation.maxTokens,
    thinking: options.binding.generation.thinkingEnabled
      ? {
          type: "enabled" as const,
          budgetTokens: options.binding.generation.thinkingBudgetTokens,
        }
      : { type: "disabled" as const },
  });
  return {
    complete(
      request: ChatCompletionRequest,
    ): Promise<ChatCompletionResponse> {
      return client.complete(apply(request));
    },
    async *streamComplete(
      request: ChatCompletionRequest,
    ): AsyncIterable<LowLevelStreamEvent> {
      yield* client.streamComplete(apply(request));
    },
  };
}

function firstSecret(secrets: Record<string, string>): string {
  return (
    secrets.apiKey ??
    secrets.bedrockApiKey ??
    secrets.vertexApiKey ??
    ""
  );
}
