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
      return toChatCompletionResponse(res);
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
          if (ev.response?.finishReason) finishReason = ev.response.finishReason;
          yield { type: "done", finishReason };
        }
      }
    },
  };
}

function shouldUseCompleteForProviderToolStreaming(
  provider: LLMProvider,
  request: CompleteRequest,
): boolean {
  return provider.id !== "openai-compatible" && Boolean(request.tools?.length);
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
  yield { type: "done", finishReason: response.finishReason };
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

import type { PublicModelSettings } from "../../shared/modelSettings";
import { createProvider } from "./providerFactory";

export interface SettingsBackedChatClientOptions {
  loadSettings: () => Promise<PublicModelSettings>;
  getApiKey: () => Promise<string | null>;
  /** Raw OpenAI-compatible client used for providerId "openai-compatible" (default). */
  fallback: ChatClient & StreamingChatClient;
  fetch?: typeof fetch;
}

export function createSettingsBackedChatClient(
  options: SettingsBackedChatClientOptions,
): ChatClient & StreamingChatClient {
  // Cache the provider-wrapped client keyed by (providerId, apiKey, chatModel, baseUrl)
  // so we don't reconstruct a provider on every turn. The raw fallback is used
  // directly for openai-compatible (the common case) — no wrapping overhead.
  let cacheKey: string | null = null;
  let cachedWrapped: ChatClient & StreamingChatClient | null = null;

  async function resolveClient(): Promise<ChatClient & StreamingChatClient> {
    const settings = await options.loadSettings();
    const apiKey = (await options.getApiKey()) ?? "";
    const providerId = settings.providerId ?? "openai-compatible";
    if (providerId === "openai-compatible") {
      return options.fallback;
    }
    const key = `${providerId}|${apiKey}|${settings.chatModel}|${settings.baseUrl}`;
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
