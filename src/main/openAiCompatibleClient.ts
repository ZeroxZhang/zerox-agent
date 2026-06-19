export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
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
};

export type ChatCompletionResponse = {
  content: string | null;
  toolCalls: ToolCall[];
  finishReason: string;
  reasoningContent?: string;
  /** P8: token usage for runGraph cost aggregation (populated when the provider
   *  returns it; absent for providers that don't report usage). */
  usage?: { inputTokens: number; outputTokens: number };
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
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
  | { type: "tool_call_delta"; id: string; name: string; arguments: string }
  | { type: "done"; finishReason: string };

export type StreamingChatClient = ChatClient & {
  streamComplete(
    request: ChatCompletionRequest,
  ): AsyncIterable<StreamEvent>;
};

const defaultRequestTimeoutMs = 300_000;

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
          prompt_tokens_details?: { cached_tokens?: number };
        };
        error?: { message?: string };
      };

      if (!response.ok) {
        throw new Error(
          `LLM request failed with status ${response.status}: ${
            payload.error?.message ?? response.statusText
          }`,
        );
      }

      const choice = payload.choices?.[0];
      const message = choice?.message;
      const toolCalls = normalizeToolCalls(message?.tool_calls ?? []);
      const content = message?.content?.trim() || null;
      const reasoningContent = normalizeReasoningContent(message);

      if (!content && !toolCalls.length) {
        throw new Error("LLM response did not include message content or tool calls.");
      }

      return {
        content,
        toolCalls,
        finishReason: choice?.finish_reason ?? "stop",
        ...(reasoningContent ? { reasoningContent } : {}),
        // P8: surface provider usage for runGraph cost aggregation.
        ...(payload.usage
          ? {
              usage: {
                inputTokens: payload.usage.prompt_tokens ?? 0,
                outputTokens: payload.usage.completion_tokens ?? 0,
              },
              ...(payload.usage.prompt_tokens_details?.cached_tokens !== undefined
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

      if (!response.ok || !response.body) {
        const errorPayload = await response.json().catch(() => ({})) as {
          error?: { message?: string };
        };
        throw new Error(
          `LLM streaming request failed with status ${response.status}: ${
            errorPayload.error?.message ?? response.statusText
          }`,
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data: ")) continue;

            const data = trimmed.slice(6);
            if (data === "[DONE]") {
              yield { type: "done", finishReason: "stop" };
              return;
            }

            try {
              const chunk = JSON.parse(data) as {
                choices?: Array<{
                  delta?: {
                    content?: string | null;
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

              if (delta?.content) {
                yield { type: "content_delta", text: delta.content };
              }

              if (delta?.tool_calls?.length) {
                for (const tc of delta.tool_calls) {
                  yield {
                    type: "tool_call_delta",
                    id: tc.id ?? "",
                    name: tc.function?.name ?? "",
                    arguments: tc.function?.arguments ?? "",
                  };
                }
              }

              if (finishReason) {
                yield { type: "done", finishReason };
              }
            } catch {
              // Skip unparseable chunks in streaming
            }
          }
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

      const payload = (await response.json()) as {
        data?: Array<{ embedding?: number[] }>;
        error?: { message?: string };
      };

      if (!response.ok) {
        throw new Error(
          `Embedding request failed with status ${response.status}: ${
            payload.error?.message ?? response.statusText
          }`,
        );
      }

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

  if (request.thinking?.type === "enabled") {
    body.thinking = {
      type: "enabled",
      ...(typeof request.thinking.budgetTokens === "number"
        ? { budget_tokens: request.thinking.budgetTokens }
        : {}),
    };
  }

  return body;
}

function serializeMessage(
  message: ChatMessage,
): Record<string, unknown> {
  const serialized: Record<string, unknown> = {
    role: message.role,
    content: message.content,
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

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  label: string,
  externalSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  let didTimeout = false;
  const abortFromExternalSignal = () => controller.abort();
  const timeout = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);

  try {
    if (externalSignal?.aborted) {
      controller.abort();
    } else {
      externalSignal?.addEventListener("abort", abortFromExternalSignal, {
        once: true,
      });
    }

    return await fetchImpl(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (didTimeout) {
      throw new Error(`${label} request timed out after ${timeoutMs} ms.`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromExternalSignal);
  }
}
