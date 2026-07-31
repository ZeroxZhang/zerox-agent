import { defaultRequestTimeoutMs, fetchWithTimeout } from "./fetchWithTimeout";
import { providerHttpError } from "./providers/providerHttpError";
import {
  modelServiceNoticeFromFinishReason,
  type ModelServiceNotice,
} from "../shared/modelServiceNotice";

export type ChatImageContent = {
  mediaType: string;
  data: string;
};

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
  images?: ChatImageContent[];
};

export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type ChatCompletionRequest = {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  tool_choice?: "auto" | "none" | { type: "function"; function: { name: string } };
  signal?: AbortSignal;
  thinking?: { type: "enabled" | "disabled"; budgetTokens?: number };
  /**
   * Provider-specific wire shape for the semantic `thinking` setting.
   * Callers should normally leave this to the provider adapter.
   */
  thinkingWireFormat?:
    | "thinking-object"
    | "enable-thinking"
    | "reasoning-object"
    | "reasoning-effort"
    | "omit";
};

export type ChatCompletionResponse = {
  content: string | null;
  toolCalls: ToolCall[];
  finishReason: string;
  reasoningContent?: string;
  /** P8: token usage for runGraph cost aggregation (populated when the provider
   *  returns it; absent for providers that don't report usage). */
  usage?: {
    inputTokens: number;
    outputTokens: number;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  modelServiceNotice?: ModelServiceNotice;
};

export type ChatClient = {
  complete(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;
};

export type ChatClientLegacy = {
  complete(request: ChatCompletionRequest): Promise<string>;
};

export type EmbeddingRequest = {
  baseUrl: string;
  apiKey: string;
  model: string;
  input: string;
  signal?: AbortSignal;
};

export type EmbeddingClient = {
  embed(request: EmbeddingRequest): Promise<number[]>;
};

export type StreamEvent =
  | { type: "content_delta"; text: string }
  | { type: "reasoning_delta"; text: string }
  | { type: "tool_call_delta"; id: string; index?: number; name: string; arguments: string }
  | {
      type: "done";
      finishReason: string;
      modelServiceNotice?: ModelServiceNotice;
    };

export type StreamingChatClient = ChatClient & {
  streamComplete(
    request: ChatCompletionRequest,
  ): AsyncIterable<StreamEvent>;
};

export function createOpenAiCompatibleClient(options?: {
  fetch?: typeof fetch;
  timeoutMs?: number;
}): ChatClient & StreamingChatClient {
  const fetchImpl = options?.fetch ?? fetch;
  const timeoutMs = options?.timeoutMs ?? defaultRequestTimeoutMs;

  return {
    async complete(request) {
      const response = await fetchWithTimeout(
        fetchImpl,
        `${request.baseUrl.replace(/\/+$/, "")}/chat/completions`,
        buildJsonRequest({
          apiKey: request.apiKey,
          body: buildChatCompletionBody(request),
        }),
        timeoutMs,
        "LLM",
        request.signal,
      );

      if (!response.ok) {
        throw await providerHttpError(response);
      }

      const payload = (await response.json()) as {
        choices?: Array<{
          message?: {
            content?: string | null;
            reasoning_content?: unknown;
            reasoning?: unknown;
            thinking?: unknown;
            tool_calls?: Array<{
              id: string;
              type: "function";
              function: { name: string; arguments: string };
            }>;
          };
          finish_reason?: string;
        }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
          prompt_tokens_details?: { cached_tokens?: number };
        };
        error?: { message?: string };
      };

      const choice = payload.choices?.[0];
      const message = choice?.message;
      const toolCalls = normalizeToolCalls(message?.tool_calls ?? []);
      const content = message?.content?.trim() || null;
      const reasoningContent = normalizeReasoningContent(message);
      const usage = normalizeCompletionUsage(payload.usage);

      const finishReason = choice?.finish_reason ?? "stop";
      const modelServiceNotice = modelServiceNoticeFromFinishReason(
        finishReason,
        { model: request.model },
      );

      if (
        !content &&
        !toolCalls.length &&
        !reasoningContent &&
        !modelServiceNotice
      ) {
        const diagnostics = [
          `choice=${choice ? "present" : "missing"}`,
          `message=${message ? "present" : "missing"}`,
          `finishReason=${choice?.finish_reason ?? "unknown"}`,
          `completionTokens=${usage?.completionTokens ?? "unknown"}`,
        ].join(", ");
        throw new Error(
          `LLM response did not include message content, reasoning content, or tool calls (${diagnostics}).`,
        );
      }

      return {
        content,
        toolCalls,
        finishReason,
        ...(modelServiceNotice ? { modelServiceNotice } : {}),
        ...(reasoningContent ? { reasoningContent } : {}),
        // P8: surface provider usage for runGraph cost aggregation.
        ...(usage
          ? {
              usage,
              ...(payload.usage?.prompt_tokens_details?.cached_tokens !== undefined
                ? { cacheReadTokens: payload.usage.prompt_tokens_details.cached_tokens }
                : {}),
            }
          : {}),
      };
    },

    async *streamComplete(request) {
      const body = {
        ...buildChatCompletionBody(request),
        stream: true,
      };

      const response = await fetchWithTimeout(
        fetchImpl,
        `${request.baseUrl.replace(/\/+$/, "")}/chat/completions`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${request.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
        timeoutMs,
        "LLM",
        request.signal,
      );

      if (!response.ok) {
        throw await providerHttpError(response);
      }
      if (!response.body) {
        throw new Error("LLM streaming response did not include a body.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let terminalFinishReason = "stop";
      let doneEmitted = false;

      // v3.6.0: SSE idle timeout per read (30 s). Prevents infinite hang when
      // the stream stalls without sending [DONE] (CORE-02, NET-14).
      const SSE_READ_IDLE_TIMEOUT_MS = 30_000;

      try {
        let streamEnded = false;
        while (true) {
          // v3.6.0: Wrap reader.read() with an idle timeout that is
          // properly cleaned up after the race settles (CORE-02, NET-14).
          let readTimeoutId: ReturnType<typeof setTimeout> | null = null;
          const readResult = await Promise.race([
            reader.read(),
            new Promise<never>((_, reject) => {
              readTimeoutId = setTimeout(
                () => reject(new Error("SSE stream idle timeout after 30 s")),
                SSE_READ_IDLE_TIMEOUT_MS,
              );
            }),
          ]);
          if (readTimeoutId !== null) clearTimeout(readTimeoutId);

          const { done, value } = readResult;
          if (done) {
            streamEnded = true;
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data: ")) continue;

            const data = trimmed.slice(6);
            if (data === "[DONE]") {
              streamEnded = true;
              // v3.6.0: Flush final UTF-8 bytes from TextDecoder before done
              // (CORE-01). This ensures multi-byte CJK characters split across
              // chunks are not truncated.
              if (buffer.trim()) {
                const final = decoder.decode();
                if (final) buffer += final;
              }
              if (!doneEmitted) {
                doneEmitted = true;
                const modelServiceNotice =
                  modelServiceNoticeFromFinishReason(terminalFinishReason, {
                    model: request.model,
                  });
                yield {
                  type: "done",
                  finishReason: terminalFinishReason,
                  ...(modelServiceNotice ? { modelServiceNotice } : {}),
                };
              }
              return;
            }

            try {
              const chunk = JSON.parse(data) as {
                choices?: Array<{
                  delta?: {
                    content?: string | null;
                    reasoning_content?: unknown;
                    reasoning?: unknown;
                    thinking?: unknown;
                    tool_calls?: Array<{
                      index?: number;
                      id?: string;
                      type?: "function";
                      function?: { name?: string; arguments?: string };
                    }>;
                  };
                  finish_reason?: string | null;
                }>;
              };
              const delta = chunk.choices?.[0]?.delta;
              const finishReason = chunk.choices?.[0]?.finish_reason;
              const reasoningDelta = normalizeReasoningDelta(delta);

              if (reasoningDelta) {
                yield { type: "reasoning_delta", text: reasoningDelta };
              }

              if (delta?.content) {
                yield { type: "content_delta", text: delta.content };
              }

              if (delta?.tool_calls?.length) {
                for (const tc of delta.tool_calls) {
                  const index = normalizeStreamToolCallIndex(tc.index);
                  yield {
                    type: "tool_call_delta",
                    id: tc.id ?? "",
                    ...(index !== undefined ? { index } : {}),
                    name: tc.function?.name ?? "",
                    arguments: tc.function?.arguments ?? "",
                  };
                }
              }

              // v3.6.0: handle finish_reason=length by emitting a special
              // done reason so the caller can issue a continuation (CORE-03).
              if (finishReason) {
                streamEnded = true;
                const currentNotice =
                  modelServiceNoticeFromFinishReason(terminalFinishReason, {
                    model: request.model,
                  });
                const candidateNotice =
                  modelServiceNoticeFromFinishReason(finishReason, {
                    model: request.model,
                  });
                if (candidateNotice || !currentNotice) {
                  terminalFinishReason = finishReason;
                }
              }
            } catch {
              // Skip unparseable chunks in streaming
            }
          }
        }

        // v3.6.0: Flush final UTF-8 bytes from TextDecoder after loop exit
        // (CORE-01). If the stream ended without [DONE] and there were
        // incomplete multi-byte characters buffered in the decoder, flush
        // them now so they appear as a final content_delta.
        if (streamEnded) {
          const final = decoder.decode();
          if (final.length > 0) {
            yield { type: "content_delta", text: final };
          }
        }
        if (!doneEmitted) {
          const modelServiceNotice = modelServiceNoticeFromFinishReason(
            terminalFinishReason,
            { model: request.model },
          );
          yield {
            type: "done",
            finishReason: terminalFinishReason,
            ...(modelServiceNotice ? { modelServiceNotice } : {}),
          };
        }
      } finally {
        reader.releaseLock();
      }
    },
  };
}

function normalizeReasoningContent(message: {
  reasoning_content?: unknown;
  reasoning?: unknown;
  thinking?: unknown;
} | undefined): string | undefined {
  const value =
    readReasoningValue(message?.reasoning_content) ??
    readReasoningValue(message?.reasoning) ??
    readReasoningValue(message?.thinking);

  return value?.trim() || undefined;
}

function normalizeReasoningDelta(delta: {
  reasoning_content?: unknown;
  reasoning?: unknown;
  thinking?: unknown;
} | undefined): string | undefined {
  return (
    readReasoningValue(delta?.reasoning_content) ??
    readReasoningValue(delta?.reasoning) ??
    readReasoningValue(delta?.thinking)
  );
}

function readReasoningValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.content === "string") {
      return record.content;
    }
    if (typeof record.text === "string") {
      return record.text;
    }
  }

  return undefined;
}

function normalizeCompletionUsage(
  usage:
    | {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      }
    | undefined,
): NonNullable<ChatCompletionResponse["usage"]> | undefined {
  const promptTokens = normalizeTokenCount(usage?.prompt_tokens);
  const completionTokens = normalizeTokenCount(usage?.completion_tokens);
  const totalTokens = normalizeTokenCount(usage?.total_tokens);

  if (
    promptTokens === undefined &&
    completionTokens === undefined &&
    totalTokens === undefined
  ) {
    return undefined;
  }

  return {
    inputTokens: promptTokens ?? 0,
    outputTokens: completionTokens ?? 0,
    ...(promptTokens !== undefined ? { promptTokens } : {}),
    ...(completionTokens !== undefined ? { completionTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
  };
}

function normalizeTokenCount(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(0, Math.floor(value));
}

function normalizeStreamToolCallIndex(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(0, Math.floor(value));
}

export function createOpenAiCompatibleEmbeddingClient(options?: {
  fetch?: typeof fetch;
  timeoutMs?: number;
}): EmbeddingClient {
  const fetchImpl = options?.fetch ?? fetch;
  const timeoutMs = options?.timeoutMs ?? defaultRequestTimeoutMs;

  return {
    async embed(request) {
      const response = await fetchWithTimeout(
        fetchImpl,
        `${request.baseUrl.replace(/\/+$/, "")}/embeddings`,
        buildJsonRequest({
          apiKey: request.apiKey,
          body: {
            model: request.model,
            input: request.input,
          },
        }),
        timeoutMs,
        "Embedding",
        request.signal,
      );

      if (!response.ok) {
        throw await providerHttpError(response);
      }

      const payload = (await response.json()) as {
        data?: Array<{ embedding?: number[] }>;
        error?: { message?: string };
      };

      const embedding = payload.data?.[0]?.embedding;
      if (!embedding?.length) {
        throw new Error("Embedding response did not include a vector.");
      }

      return embedding;
    },
  };
}

function buildChatCompletionBody(
  request: ChatCompletionRequest,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model,
    messages: request.messages.map(serializeMessage),
    temperature: request.temperature,
    max_tokens: request.maxTokens,
  };

  if (request.tools?.length) {
    body.tools = request.tools;
    body.tool_choice = request.tool_choice ?? "auto";
  }

  applyThinkingWireFormat(body, request);

  return body;
}

function applyThinkingWireFormat(
  body: Record<string, unknown>,
  request: ChatCompletionRequest,
): void {
  if (!request.thinking || request.thinkingWireFormat === "omit") {
    return;
  }

  const format = request.thinkingWireFormat ?? "legacy";
  if (format === "thinking-object") {
    body.thinking = { type: request.thinking.type };
    return;
  }
  if (format === "enable-thinking") {
    body.enable_thinking = request.thinking.type === "enabled";
    if (
      request.thinking.type === "enabled" &&
      typeof request.thinking.budgetTokens === "number"
    ) {
      body.thinking_budget = request.thinking.budgetTokens;
    }
    return;
  }
  if (format === "reasoning-object") {
    body.reasoning =
      request.thinking.type === "enabled"
        ? {
            enabled: true,
            ...(typeof request.thinking.budgetTokens === "number"
              ? { max_tokens: request.thinking.budgetTokens }
              : {}),
          }
        : { effort: "none" };
    return;
  }
  if (format === "reasoning-effort") {
    body.reasoning_effort =
      request.thinking.type === "enabled" ? "high" : "none";
    return;
  }

  // Preserve the legacy generic-client behavior. Provider-routed requests use
  // an explicit wire format and therefore serialize both enabled and disabled.
  if (request.thinking.type === "enabled") {
    body.thinking = {
      type: "enabled",
      ...(typeof request.thinking.budgetTokens === "number"
        ? { budget_tokens: request.thinking.budgetTokens }
        : {}),
    };
  }
}

function serializeMessage(
  message: ChatMessage,
): Record<string, unknown> {
  const serialized: Record<string, unknown> = {
    role: message.role,
    content:
      message.role === "user" && message.images?.length
        ? [
            { type: "text", text: message.content },
            ...message.images.map((image) => ({
              type: "image_url",
              image_url: {
                url: `data:${image.mediaType};base64,${image.data}`,
              },
            })),
          ]
        : message.content,
  };

  if (message.tool_calls?.length) {
    serialized.tool_calls = message.tool_calls.map((tc) => ({
      id: tc.id,
      type: tc.type,
      function: {
        name: tc.function.name,
        arguments: tc.function.arguments,
      },
    }));
  }

  if (message.tool_call_id) {
    serialized.tool_call_id = message.tool_call_id;
  }

  if (message.name) {
    serialized.name = message.name;
  }

  return serialized;
}

function normalizeToolCalls(
  raw: Array<{
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }>,
): ToolCall[] {
  return raw
    .filter(
      (tc): tc is ToolCall =>
        typeof tc.id === "string" &&
        (tc.type === "function" || tc.function !== undefined),
    )
    .map((tc) => ({
      id: tc.id,
      type: "function" as const,
      function: {
        name: tc.function?.name ?? "",
        arguments: tc.function?.arguments ?? "{}",
      },
    }));
}

function buildJsonRequest(options: {
  apiKey: string;
  body: Record<string, unknown>;
}): RequestInit {
  return {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(options.body),
  };
}
