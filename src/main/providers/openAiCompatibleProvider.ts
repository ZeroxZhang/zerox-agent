// OpenAICompatibleProvider (contracts v1.4 §2.2/§2.4).
//
// Wraps the existing `createOpenAiCompatibleClient` — `complete`/`streamComplete`
// are preserved as the internal implementation (contract §2.4). This provider
// converts NormalizedMessage ⇄ ChatMessage at the boundary, maps the low-level
// `content_delta` StreamEvent to the contract `text_delta` variant, and falls
// back to the `estimateTextTokens` heuristic for `countTokens` (OpenAI-compatible
// has no universal token-count endpoint). OpenAI-compatible has no prompt-cache
// reporting, so cacheRead/WriteTokens are 0.

import { createOpenAiCompatibleClient } from "../openAiCompatibleClient";
import type { ChatCompletionRequest } from "../openAiCompatibleClient";
import { estimateTextTokens } from "../contextManager";
import { fromNormalized } from "./normalize";
import { buildCachePrefix } from "./cachePrefix";
import type {
  CompleteRequest,
  CompleteResponse,
  LLMProvider,
  NormalizedMessage,
  ProviderCapabilities,
  ProviderId,
  StreamEvent,
  ToolDefinition,
} from "./provider";

const CAPABILITIES: ProviderCapabilities = {
  toolUse: true,
  thinking: false, // gated per-request via thinking field; provider-compat only
  vision: false,
  promptCache: false, // OpenAI-compatible: automatic prefix, no reported hit tokens
  streamingToolCalls: true,
};

export interface OpenAICompatibleProviderOptions {
  /** Injectable fetch (tests). */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export function createOpenAICompatibleProvider(
  options: OpenAICompatibleProviderOptions = {},
): LLMProvider {
  const client = createOpenAiCompatibleClient({
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
  });

  return {
    id: "openai-compatible" as ProviderId,
    capabilities: CAPABILITIES,

    async complete(req: CompleteRequest): Promise<CompleteResponse> {
      const chatReq = toChatRequest(req);
      const res = await client.complete(chatReq);
      return {
        content: res.content,
        toolCalls: res.toolCalls,
        finishReason: res.finishReason,
        ...(res.reasoningContent !== undefined ? { reasoningContent: res.reasoningContent } : {}),
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      };
    },

    async *stream(req: CompleteRequest): AsyncIterable<StreamEvent> {
      const chatReq = toChatRequest(req);
      for await (const ev of client.streamComplete(chatReq)) {
        if (ev.type === "content_delta") {
          yield { type: "text_delta", text: ev.text };
        } else if (ev.type === "reasoning_delta") {
          yield { type: "thinking_delta", text: ev.text };
        } else if (ev.type === "tool_call_delta") {
          yield {
            type: "tool_call_delta",
            toolCallId: ev.id,
            name: ev.name,
            argumentsDelta: ev.arguments,
          };
        } else if (ev.type === "done") {
          yield { type: "done" };
        }
      }
    },

    async countTokens(
      messages: NormalizedMessage[],
      opts?: { system?: string; tools?: ToolDefinition[] },
    ): Promise<number> {
      // Heuristic fallback (contract §2.4): OpenAI-compatible has no universal
      // count endpoint.
      const system = opts?.system ?? "";
      const tools = opts?.tools ?? [];
      let total = estimateTextTokens(system);
      for (const m of messages) {
        total += estimateTextTokens(summarizeNormalized(m));
      }
      for (const t of tools) {
        total += estimateTextTokens(JSON.stringify(t));
      }
      return total;
    },

    buildCachePrefix(messages, opts?) {
      return buildCachePrefix(messages, opts);
    },
  };
}

function toChatRequest(req: CompleteRequest): ChatCompletionRequest {
  // Reconstruct the legacy ChatCompletionRequest shape from the contract request.
  // The contract's toolChoice allows "required" (OpenAI supports it); the legacy
  // type is narrower, so cast at the boundary.
  return {
    baseUrl: req.baseUrl ?? "",
    apiKey: req.apiKey,
    model: req.model,
    temperature: req.temperature,
    maxTokens: req.maxTokens,
    messages: fromNormalized(req.messages),
    ...(req.tools ? { tools: req.tools } : {}),
    ...(req.toolChoice ? { tool_choice: req.toolChoice as ChatCompletionRequest["tool_choice"] } : {}),
    ...(req.thinking ? { thinking: req.thinking } : {}),
    ...(req.signal ? { signal: req.signal } : {}),
  };
}

function summarizeNormalized(m: NormalizedMessage): string {
  if (m.role === "system") return m.content;
  if (m.role === "tool") return m.content;
  return m.content
    .map((c) => (c.type === "text" ? c.text : c.type === "thinking" ? c.text : JSON.stringify(c)))
    .join("");
}
