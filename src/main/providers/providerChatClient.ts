// ProviderChatClient adapter (contracts v1.4 §2.4, spec §3.1).
//
// Adapts the frozen `LLMProvider` to the legacy `ChatClient & StreamingChatClient`
// shape so every existing consumer (chatService, agentRunnerService, agentLoop,
// agentRuntimeEngine, ...) can transparently route through a provider with zero
// dependency-type changes. The round-trip ChatMessage ⇄ NormalizedMessage is
// lossless for the OpenAI shape (see normalize.ts), so `providerId:
// "openai-compatible"` is behavior-identical to the raw client.

import type {
  ChatClient,
  ChatCompletionRequest,
  ChatCompletionResponse,
  StreamingChatClient,
  StreamEvent as LowLevelStreamEvent,
} from "../openAiCompatibleClient";
import type { LLMProvider, CompleteRequest } from "./provider";
import {
  modelServiceNoticeFromFinishReason,
  type ModelServiceNotice,
} from "../../shared/modelServiceNotice";
import {
  fromNormalized,
  toChatCompletionResponse,
  toCompleteRequest,
  toNormalized,
} from "./normalize";

export interface ProviderChatClientOptions {
  /** Inject the provider to use. If absent, falls back to a raw client. */
  provider?: LLMProvider;
  /** Fallback raw client (used when no provider is configured). */
  fallback?: ChatClient & StreamingChatClient;
}

export function createProviderChatClient(
  options: ProviderChatClientOptions,
): ChatClient & StreamingChatClient {
  const { provider, fallback } = options;

  return {
    async complete(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
      if (!provider) {
        if (!fallback) throw new Error("ProviderChatClient: no provider or fallback configured");
        return fallback.complete(request);
      }
      const req = toCompleteRequest(request);
      const res = await provider.complete(req);
      return toChatCompletionResponse(res, {
        provider: provider.id,
        model: request.model,
      });
    },

    async *streamComplete(
      request: ChatCompletionRequest,
    ): AsyncIterable<LowLevelStreamEvent> {
      if (!provider) {
        if (!fallback) throw new Error("ProviderChatClient: no provider or fallback configured");
        yield* fallback.streamComplete(request);
        return;
      }
      const req = toCompleteRequest(request);
      if (shouldUseCompleteForProviderToolStreaming(provider, req)) {
        const response = await provider.complete(req);
        yield* completeResponseToStreamEvents(response);
        return;
      }
      let finishReason = "stop";
      let modelServiceNotice: ModelServiceNotice | undefined;
      for await (const ev of provider.stream(req)) {
        if (ev.type === "text_delta") {
          yield { type: "content_delta", text: ev.text };
        } else if (ev.type === "thinking_delta") {
          yield { type: "reasoning_delta", text: ev.text };
        } else if (ev.type === "tool_call_delta") {
          yield {
            type: "tool_call_delta",
            id: ev.toolCallId,
            ...(ev.index !== undefined ? { index: ev.index } : {}),
            name: ev.name ?? "",
            arguments: ev.argumentsDelta ?? "",
          };
        } else if (ev.type === "done") {
          const candidateReason =
            ev.response?.finishReason ?? ev.finishReason ?? "stop";
          const candidateNotice =
            ev.response?.modelServiceNotice ??
            modelServiceNoticeFromFinishReason(candidateReason, {
              provider: provider.id,
              model: request.model,
            });
          if (candidateNotice || !modelServiceNotice) {
            finishReason = candidateReason;
          }
          modelServiceNotice ??= candidateNotice;
        } else if (ev.type === "error") {
          throw ev.error;
        }
      }
      modelServiceNotice ??= modelServiceNoticeFromFinishReason(finishReason, {
        provider: provider.id,
        model: request.model,
      });
      yield {
        type: "done",
        finishReason,
        ...(modelServiceNotice ? { modelServiceNotice } : {}),
      };
    },
  };
}

function shouldUseCompleteForProviderToolStreaming(
  provider: LLMProvider,
  request: CompleteRequest,
): boolean {
  // v3.6.0: Use capabilities.streamingToolCalls instead of provider identity
  // check (NET-08). Providers that don't support native streaming tool calls
  // fall back to complete() when tools are present.
  return !provider.capabilities.streamingToolCalls && Boolean(request.tools?.length);
}

async function* completeResponseToStreamEvents(
  response: Awaited<ReturnType<LLMProvider["complete"]>>,
): AsyncIterable<LowLevelStreamEvent> {
  if (response.reasoningContent) {
    yield { type: "reasoning_delta", text: response.reasoningContent };
  }
  if (response.content) {
    yield { type: "content_delta", text: response.content };
  }
  for (const toolCall of response.toolCalls) {
    yield {
      type: "tool_call_delta",
      id: toolCall.id,
      name: toolCall.function.name,
      arguments: toolCall.function.arguments,
    };
  }
  yield {
    type: "done",
    finishReason: response.finishReason,
    ...(response.modelServiceNotice
      ? { modelServiceNotice: response.modelServiceNotice }
      : {}),
  };
}

// Re-export normalize helpers for consumers that build CompleteRequest directly.
export { toNormalized, fromNormalized, toCompleteRequest };
export type { CompleteRequest };

// ---------------------------------------------------------------------------
// Settings-backed chat client (P3 activation).
//
// Routes each request through the provider for the current model settings:
// `openai-compatible` (default) → the raw fallback client (byte-identical to
// the legacy single-path behavior — zero regression); `anthropic`/`gemini` → a
// native provider via the factory. This is the single swap the 8 container
// `createOpenAiCompatibleClient()` points use to "turn on" multi-provider
// routing without touching the synchronous construction or the loop's ChatClient
// dependency shape.
// ---------------------------------------------------------------------------

import type {
  PublicModelSettings,
  ResolvedModelBinding,
} from "../../shared/modelSettings";
import { createProvider, resolveProviderBaseUrl } from "./providerFactory";

export interface SettingsBackedChatClientOptions {
  loadSettings: () => Promise<PublicModelSettings>;
  getApiKey: () => Promise<string | null>;
  resolveProfile?: () => Promise<{
    binding: ResolvedModelBinding;
    connectionValues: Record<string, string>;
    secrets: Record<string, string>;
  }>;
  /** Raw OpenAI-compatible client used for providerId "openai-compatible" (default). */
  fallback: ChatClient & StreamingChatClient;
  fetch?: typeof fetch;
}

export function createSettingsBackedChatClient(
  options: SettingsBackedChatClientOptions,
): ChatClient & StreamingChatClient {
  // Cache by public connection/profile revisions. Credentials must never be
  // embedded in cache keys, logs, or renderer-visible state.
  // so we don't reconstruct a provider on every turn. The raw fallback is used
  // directly for openai-compatible (the common case) — no wrapping overhead.
  let cacheKey: string | null = null;
  let cachedWrapped: ChatClient & StreamingChatClient | null = null;

  async function resolveClient(): Promise<ChatClient & StreamingChatClient> {
    if (options.resolveProfile) {
      const resolved = await options.resolveProfile();
      const key = `${resolved.binding.connectionId}:${resolved.binding.revision}`;
      if (key === cacheKey && cachedWrapped) return cachedWrapped;
      const apiKey =
        resolved.secrets.apiKey ??
        resolved.secrets.bedrockApiKey ??
        resolved.secrets.vertexApiKey ??
        "";
      const provider = createProvider(
        {
          providerKind: resolved.binding.providerKind,
          apiKey,
          chatModel: resolved.binding.modelId,
          connectionValues: resolved.connectionValues,
          secrets: resolved.secrets,
          baseUrl: resolveProviderBaseUrl(
            resolved.binding.providerKind,
            resolved.connectionValues,
          ),
        },
        options.fetch ? { fetch: options.fetch } : {},
      );
      cachedWrapped = createProviderChatClient({
        provider,
        fallback: options.fallback,
      });
      cachedWrapped = bindResolvedProfileRequest(cachedWrapped, {
        binding: resolved.binding,
        apiKey,
        baseUrl: resolveProviderBaseUrl(
          resolved.binding.providerKind,
          resolved.connectionValues,
        ),
      });
      cacheKey = key;
      return cachedWrapped;
    }
    const settings = await options.loadSettings();
    const apiKey = (await options.getApiKey()) ?? "";
    const providerId = settings.providerId ?? "openai-compatible";
    if (providerId === "openai-compatible") {
      return options.fallback;
    }
    const key = `${providerId}|${settings.chatModel}|${settings.baseUrl}|${settings.updatedAt ?? ""}`;
    if (key === cacheKey && cachedWrapped) return cachedWrapped;
    const provider = createProvider(
      {
        providerId,
        apiKey,
        chatModel: settings.chatModel,
        baseUrl: settings.baseUrl,
        thinkingEnabled: settings.thinkingEnabled,
        thinkingBudgetTokens: settings.thinkingBudgetTokens,
      },
      options.fetch ? { fetch: options.fetch } : {},
    );
    cachedWrapped = createProviderChatClient({ provider, fallback: options.fallback });
    cacheKey = key;
    return cachedWrapped;
  }

  return {
    async complete(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
      const client = await resolveClient();
      return client.complete(request);
    },
    async *streamComplete(request: ChatCompletionRequest): AsyncIterable<LowLevelStreamEvent> {
      const client = await resolveClient();
      yield* client.streamComplete(request);
    },
  };
}

function bindResolvedProfileRequest(
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
          type: "enabled",
          budgetTokens: options.binding.generation.thinkingBudgetTokens,
        }
      : { type: "disabled" },
  });
  return {
    complete(request) {
      return client.complete(apply(request));
    },
    async *streamComplete(request) {
      yield* client.streamComplete(apply(request));
    },
  };
}
