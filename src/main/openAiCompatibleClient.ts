import {
  defaultRequestTimeoutMs,
  fetchWithTimeout,
  readResponseJsonWithLimit,
} from "./fetchWithTimeout";
import { providerHttpError } from "./providers/providerHttpError";
import { readSseLinesUntilTerminal } from "./providers/sseLineReader";
import {
  modelServiceNoticeFromFinishReason,
  type ModelServiceNotice,
} from "../shared/modelServiceNotice";
import { MODEL_RESPONSE_MAX_BODY_BYTES } from "../shared/limits";

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
  countTokens?(request: ChatCompletionRequest): Promise<number>;
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

/**
 * The transport ended before the provider supplied a protocol terminal event.
 * Callers may retry the idempotent request and, after bounded retries, surface
 * the already received deltas as an output-limit continuation.
 */
export class IncompleteModelStreamError extends Error {
  constructor(message = "Model stream ended before a terminal event.") {
    super(message);
    this.name = "IncompleteModelStreamError";
  }
}

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

      const payload = await readResponseJsonWithLimit<{
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
      }>(response, MODEL_RESPONSE_MAX_BODY_BYTES, "LLM");

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

      let terminalFinishReason: string | undefined;
      let terminalObserved = false;
      let doneEmitted = false;

      // v3.6.0: SSE idle timeout per read (30 s). Prevents infinite hang when
      // the stream stalls without sending [DONE] (CORE-02, NET-14).
      const SSE_READ_IDLE_TIMEOUT_MS = 30_000;

      const emitDataLine = async function* (
        rawLine: string,
      ): AsyncGenerator<StreamEvent, void, void> {
        const trimmed = rawLine.trim();
        if (!trimmed || !trimmed.startsWith("data:")) return;

        const data = trimmed.slice(5).trimStart();
        if (data === "[DONE]") {
          terminalObserved = true;
          terminalFinishReason ??= "stop";
          return;
        }

        let chunk: {
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
        try {
          chunk = JSON.parse(data) as typeof chunk;
        } catch (error) {
          throw new Error("LLM stream returned malformed JSON.", {
            cause: error,
          });
        }

        const delta = chunk.choices?.[0]?.delta;
        const finishReason = chunk.choices?.[0]?.finish_reason;
        const reasoningDelta = normalizeReasoningDelta(delta);
        if (reasoningDelta) {
          yield { type: "reasoning_delta", text: reasoningDelta };
        }
        if (delta?.content) {
          yield { type: "content_delta", text: delta.content };
        }
        for (const tc of delta?.tool_calls ?? []) {
          const index = normalizeStreamToolCallIndex(tc.index);
          yield {
            type: "tool_call_delta",
            id: tc.id ?? "",
            ...(index !== undefined ? { index } : {}),
            name: tc.function?.name ?? "",
            arguments: tc.function?.arguments ?? "",
          };
        }
        if (finishReason) {
          terminalObserved = true;
          const currentNotice = terminalFinishReason
            ? modelServiceNoticeFromFinishReason(terminalFinishReason, {
                model: request.model,
              })
            : undefined;
          const candidateNotice = modelServiceNoticeFromFinishReason(
            finishReason,
            { model: request.model },
          );
          if (candidateNotice || !currentNotice) {
            terminalFinishReason = finishReason;
          }
        }
      };

      for await (const line of readSseLinesUntilTerminal(response.body, {
        isTerminal: () => terminalObserved,
        idleTimeoutMs: SSE_READ_IDLE_TIMEOUT_MS,
        idleTimeoutMessage: "SSE stream idle timeout after 30 s",
      })) {
        for await (const event of emitDataLine(line)) {
          yield event;
        }
      }
      if (!terminalObserved) {
        throw new IncompleteModelStreamError();
      }
      if (!doneEmitted) {
        const finishReason = terminalFinishReason ?? "stop";
        const modelServiceNotice = modelServiceNoticeFromFinishReason(
          finishReason,
          { model: request.model },
        );
        doneEmitted = true;
        yield {
          type: "done",
          finishReason,
          ...(modelServiceNotice ? { modelServiceNotice } : {}),
        };
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

      const payload = await readResponseJsonWithLimit<{
        data?: Array<{ embedding?: number[] }>;
        error?: { message?: string };
      }>(response, MODEL_RESPONSE_MAX_BODY_BYTES, "Embedding");

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
