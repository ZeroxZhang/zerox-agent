// Normalization layer (contracts v1.4 §2.1).
//
// Bridges the legacy OpenAI-shaped `ChatMessage` (string content + tool_calls)
// and the provider contract's `NormalizedMessage` (structured NormalizedContent[]).
// The round-trip is lossless for the OpenAI shape, which is what lets the
// `ProviderChatClient` adapter route every existing `ChatClient` consumer
// through a provider with identical behavior (zero regression).

import type { ChatMessage, ToolCall } from "../openAiCompatibleClient";
import type {
  NormalizedContent,
  NormalizedMessage,
  ToolDefinition,
} from "./provider";
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
} from "../openAiCompatibleClient";
import type { CompleteRequest, CompleteResponse } from "./provider";
import { modelServiceNoticeFromFinishReason } from "../../shared/modelServiceNotice";

export function toNormalized(messages: ChatMessage[]): NormalizedMessage[] {
  return messages.map((msg) => {
    if (msg.role === "system") {
      return { role: "system", content: msg.content };
    }
    if (msg.role === "tool") {
      return { role: "tool", toolCallId: msg.tool_call_id ?? "", content: msg.content };
    }
    // user | assistant
    const content: NormalizedContent[] = [
      { type: "text", text: msg.content },
      ...(msg.role === "user"
        ? (msg.images ?? []).map((image) => ({
            type: "image" as const,
            mediaType: image.mediaType,
            data: image.data,
          }))
        : []),
    ];
    const toolCalls = msg.tool_calls;
    if (msg.role === "assistant" && toolCalls && toolCalls.length) {
      return {
        role: "assistant",
        content,
        toolCalls: toolCalls.map(normalizeToolCall),
      };
    }
    return { role: msg.role, content } as NormalizedMessage;
  });
}

export function fromNormalized(messages: NormalizedMessage[]): ChatMessage[] {
  return messages.map((msg) => {
    if (msg.role === "system") {
      return { role: "system", content: msg.content };
    }
    if (msg.role === "tool") {
      return { role: "tool", tool_call_id: msg.toolCallId, content: msg.content };
    }
    const text = msg.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("");
    const thinking = msg.content
      .filter((c): c is { type: "thinking"; text: string } => c.type === "thinking")
      .map((c) => c.text)
      .join("");
    const out: ChatMessage = {
      role: msg.role,
      content: thinking ? `<thinking>${thinking}</thinking>${text}` : text,
      ...(msg.role === "user"
        ? {
            images: msg.content
              .filter(
                (c): c is { type: "image"; mediaType: string; data: string } =>
                  c.type === "image",
              )
              .map((image) => ({
                mediaType: image.mediaType,
                data: image.data,
              })),
          }
        : {}),
    };
    if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length) {
      out.tool_calls = msg.toolCalls.map(denormalizeToolCall);
    }
    return out;
  });
}

function normalizeToolCall(tc: ToolCall): ToolCall {
  return { id: tc.id, type: "function", function: { name: tc.function.name, arguments: tc.function.arguments } };
}
function denormalizeToolCall(tc: ToolCall): ToolCall {
  return normalizeToolCall(tc);
}

/** Convert a legacy `ChatCompletionRequest` to a contract `CompleteRequest`. */
export function toCompleteRequest(req: ChatCompletionRequest): CompleteRequest {
  return {
    model: req.model,
    apiKey: req.apiKey,
    baseUrl: req.baseUrl,
    temperature: req.temperature,
    maxTokens: req.maxTokens,
    messages: toNormalized(req.messages),
    tools: req.tools,
    ...(req.tool_choice ? { toolChoice: req.tool_choice } : {}),
    ...(req.thinking ? { thinking: req.thinking } : {}),
    ...(req.signal ? { signal: req.signal } : {}),
  };
}

/** Convert a contract `CompleteResponse` to a legacy `ChatCompletionResponse`. */
export function toChatCompletionResponse(
  res: CompleteResponse,
  context: { provider?: string; model?: string } = {},
): ChatCompletionResponse {
  const rawModelServiceNotice =
    res.modelServiceNotice ??
    modelServiceNoticeFromFinishReason(res.finishReason, context);
  const modelServiceNotice = rawModelServiceNotice
    ? {
        ...rawModelServiceNotice,
        ...(rawModelServiceNotice.provider
          ? {}
          : context.provider
            ? { provider: context.provider }
            : {}),
        ...(rawModelServiceNotice.model
          ? {}
          : context.model
            ? { model: context.model }
            : {}),
      }
    : undefined;
  const out: ChatCompletionResponse = {
    content: res.content,
    toolCalls: res.toolCalls,
    finishReason: res.finishReason,
    ...(modelServiceNotice ? { modelServiceNotice } : {}),
    ...(res.usage
      ? {
          usage: {
            inputTokens: res.usage.inputTokens,
            outputTokens: res.usage.outputTokens,
            promptTokens: res.usage.inputTokens,
            completionTokens: res.usage.outputTokens,
            totalTokens: res.usage.inputTokens + res.usage.outputTokens,
          },
        }
      : {}),
    ...(res.cacheReadTokens ? { cacheReadTokens: res.cacheReadTokens } : {}),
    ...(res.cacheWriteTokens ? { cacheWriteTokens: res.cacheWriteTokens } : {}),
  };
  if (res.reasoningContent !== undefined) out.reasoningContent = res.reasoningContent;
  return out;
}

export type { ToolDefinition };
