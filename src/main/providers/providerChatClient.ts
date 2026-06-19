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
      let finishReason = "stop";
      for await (const ev of provider.stream(req)) {
        if (ev.type === "text_delta") {
          yield { type: "content_delta", text: ev.text };
        } else if (ev.type === "tool_call_delta") {
          yield {
            type: "tool_call_delta",
            id: ev.toolCallId,
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

// Re-export normalize helpers for consumers that build CompleteRequest directly.
export { toNormalized, fromNormalized, toCompleteRequest };
export type { CompleteRequest };
