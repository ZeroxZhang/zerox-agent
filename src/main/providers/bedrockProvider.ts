import {
  BedrockRuntimeClient,
  ConverseCommand,
  InvokeModelCommand,
  type BedrockRuntimeClientConfig,
} from "@aws-sdk/client-bedrock-runtime";
import { fromIni } from "@aws-sdk/credential-providers";
import { Readable, Transform } from "node:stream";
import { estimateTextTokens } from "../contextManager";
import { buildCachePrefix } from "./cachePrefix";
import type {
  CompleteRequest,
  CompleteResponse,
  LLMProvider,
  NormalizedContent,
  NormalizedMessage,
  ProviderCapabilities,
  ProviderId,
  StreamEvent,
  ToolDefinition,
} from "./provider";
import { withModelServiceNotice } from "../../shared/modelServiceNotice";
import { ResponseBodyLimitError } from "../fetchWithTimeout";
import { MODEL_RESPONSE_MAX_BODY_BYTES } from "../../shared/limits";
import { defaultRequestTimeoutMs } from "../fetchWithTimeout";

const capabilities: ProviderCapabilities = {
  toolUse: true,
  thinking: true,
  vision: true,
  promptCache: false,
  streamingToolCalls: false,
};

export type BedrockProviderOptions = {
  region: string;
  authMethod?: "api_key" | "profile" | "iam";
  bedrockApiKey?: string;
  awsProfile?: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  awsSessionToken?: string;
  client?: Pick<BedrockRuntimeClient, "send">;
  timeoutMs?: number;
};

export function createBedrockProvider(
  options: BedrockProviderOptions,
): LLMProvider {
  const client = options.client ?? createBoundedBedrockClient(options);
  const timeoutMs = options.timeoutMs ?? defaultRequestTimeoutMs;

  return {
    id: "bedrock" as ProviderId,
    capabilities,

    async complete(req) {
      const { family, modelId } = splitFamily(req.model);
      const response =
        family === "claude"
          ? await completeClaude(client, modelId, req, timeoutMs)
          : await completeConverse(client, modelId, req, timeoutMs);
      return withModelServiceNotice(response, {
        provider: "bedrock",
        model: req.model,
      });
    },

    async *stream(req): AsyncIterable<StreamEvent> {
      const response = await this.complete(req);
      if (response.reasoningContent) {
        yield { type: "thinking_delta", text: response.reasoningContent };
      }
      if (response.content) {
        yield { type: "text_delta", text: response.content };
      }
      for (const toolCall of response.toolCalls) {
        yield {
          type: "tool_call_delta",
          toolCallId: toolCall.id,
          name: toolCall.function.name,
          argumentsDelta: toolCall.function.arguments,
        };
      }
      yield { type: "done", response };
    },

    async countTokens(messages, opts?) {
      return heuristicCount(messages, opts?.system, opts?.tools);
    },

    buildCachePrefix(messages, opts?) {
      return buildCachePrefix(messages, opts);
    },
  };
}

function createBoundedBedrockClient(
  options: BedrockProviderOptions,
): BedrockRuntimeClient {
  const client = new BedrockRuntimeClient(buildClientConfig(options));
  const responseBudgetMiddleware = (
    next: (args: object) => Promise<{ response?: unknown }>,
  ) => async (args: object) => {
      const result = await next(args);
      const response = (result as {
        response?: { headers?: Record<string, string>; body?: unknown };
      }).response;
      if (response) {
        enforceBedrockSdkResponseBudget(response);
      }
      return result;
    };
  client.middlewareStack.addRelativeTo(
    responseBudgetMiddleware as Parameters<
      typeof client.middlewareStack.addRelativeTo
    >[0],
    {
      name: "zeroxBedrockResponseBudget",
      relation: "after",
      toMiddleware: "deserializerMiddleware",
      override: true,
    },
  );
  return client;
}

/**
 * AWS SDK commands deserialize their entire JSON body before `send()` resolves.
 * Install this immediately outside Smithy's deserializer so the raw body is
 * bounded while it is read, rather than after the SDK has already allocated it.
 * Exported for a direct transport regression; production installs it above.
 */
export function enforceBedrockSdkResponseBudget(response: {
  headers?: Record<string, string>;
  body?: unknown;
}): void {
  const label = "Bedrock SDK";
  const declaredLength = readContentLength(response.headers);
  if (
    declaredLength !== undefined
    && declaredLength > MODEL_RESPONSE_MAX_BODY_BYTES
  ) {
    cancelBedrockBody(response.body);
    throw new ResponseBodyLimitError(label, MODEL_RESPONSE_MAX_BODY_BYTES);
  }
  response.body = boundedBedrockBody(response.body, label);
}

function boundedBedrockBody(body: unknown, label: string): unknown {
  if (body === undefined || body === null) return body;
  if (typeof body === "string" || body instanceof Uint8Array) {
    const byteLength = typeof body === "string"
      ? Buffer.byteLength(body)
      : body.byteLength;
    if (byteLength > MODEL_RESPONSE_MAX_BODY_BYTES) {
      throw new ResponseBodyLimitError(label, MODEL_RESPONSE_MAX_BODY_BYTES);
    }
    return body;
  }
  if (isWebReadableStream(body)) {
    return boundWebReadableStream(body, label);
  }
  if (isNodeReadable(body)) {
    return boundNodeReadable(body, label);
  }
  if (isAsyncIterable(body)) {
    return Readable.from(createBoundedAsyncIterable(body, label));
  }
  throw new Error("Bedrock SDK response body used an unsupported transport type.");
}

function boundNodeReadable(body: Readable, label: string): Readable {
  let bytesRead = 0;
  const limiter = new Transform({
    transform(chunk: unknown, encoding, callback) {
      let byteLength: number;
      try {
        byteLength = bedrockChunkByteLength(chunk, encoding);
      } catch (error) {
        body.destroy();
        callback(error as Error);
        return;
      }
      bytesRead += byteLength;
      if (bytesRead > MODEL_RESPONSE_MAX_BODY_BYTES) {
        body.destroy();
        callback(new ResponseBodyLimitError(label, MODEL_RESPONSE_MAX_BODY_BYTES));
        return;
      }
      callback(null, chunk);
    },
  });
  const propagateSourceError = (error: Error) => limiter.destroy(error);
  body.once("error", propagateSourceError);
  limiter.once("close", () => body.off("error", propagateSourceError));
  body.pipe(limiter);
  return limiter;
}

function boundWebReadableStream(
  body: ReadableStream<Uint8Array>,
  label: string,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let bytesRead = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read();
        if (result.done) {
          releaseWebReader(reader);
          controller.close();
          return;
        }
        bytesRead += bedrockChunkByteLength(result.value);
        if (bytesRead > MODEL_RESPONSE_MAX_BODY_BYTES) {
          cancelWebReaderWithoutWaiting(
            reader,
            `${label} response exceeded ${MODEL_RESPONSE_MAX_BODY_BYTES} bytes`,
          );
          controller.error(
            new ResponseBodyLimitError(label, MODEL_RESPONSE_MAX_BODY_BYTES),
          );
          return;
        }
        controller.enqueue(result.value);
      } catch (error) {
        cancelWebReaderWithoutWaiting(reader, error);
        controller.error(error);
      }
    },
    cancel(reason) {
      cancelWebReaderWithoutWaiting(reader, reason);
    },
  });
}

function cancelWebReaderWithoutWaiting(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  reason: unknown,
): void {
  try {
    void reader.cancel(reason).catch(() => undefined);
  } catch {
    // Cleanup must never delay or replace the response-budget failure.
  }
  releaseWebReader(reader);
}

function releaseWebReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): void {
  try {
    reader.releaseLock();
  } catch {
    // The bounded stream never reads this private reader again after closure.
  }
}

function createBoundedAsyncIterable(
  body: AsyncIterable<unknown>,
  label: string,
): AsyncIterable<unknown> {
  const iterator = body[Symbol.asyncIterator]();
  let bytesRead = 0;
  let closed = false;
  const closeWithoutWaiting = () => {
    if (closed) return;
    closed = true;
    try {
      void Promise.resolve(iterator.return?.()).catch(() => undefined);
    } catch {
      // Cleanup must never delay or replace the response-budget failure.
    }
    cancelBedrockBody(body);
  };
  return {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          if (closed) return { done: true, value: undefined };
          const result = await iterator.next();
          if (result.done) {
            closed = true;
            return result;
          }
          const chunk = result.value;
          let byteLength: number;
          try {
            byteLength = bedrockChunkByteLength(chunk);
          } catch (error) {
            closeWithoutWaiting();
            throw error;
          }
          bytesRead += byteLength;
          if (bytesRead > MODEL_RESPONSE_MAX_BODY_BYTES) {
            closeWithoutWaiting();
            throw new ResponseBodyLimitError(
              label,
              MODEL_RESPONSE_MAX_BODY_BYTES,
            );
          }
          return { done: false, value: chunk };
        },
        async return() {
          closeWithoutWaiting();
          return { done: true, value: undefined };
        },
        async throw(error?: unknown) {
          closeWithoutWaiting();
          throw error;
        },
      };
    },
  };
}

function bedrockChunkByteLength(
  chunk: unknown,
  encoding?: BufferEncoding,
): number {
  if (typeof chunk === "string") {
    return Buffer.byteLength(chunk, encoding);
  }
  if (chunk instanceof Uint8Array) return chunk.byteLength;
  throw new Error("Bedrock SDK response stream emitted a non-byte chunk.");
}

function readContentLength(
  headers: Record<string, string> | undefined,
): number | undefined {
  const raw = Object.entries(headers ?? {}).find(
    ([name]) => name.toLowerCase() === "content-length",
  )?.[1];
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function cancelBedrockBody(body: unknown): void {
  if (!body || typeof body !== "object") return;
  const candidate = body as {
    destroy?: () => void;
    cancel?: (reason?: unknown) => unknown;
  };
  try {
    candidate.destroy?.();
  } catch {
    // Cleanup must never delay or replace the response-budget failure.
  }
  try {
    void Promise.resolve(candidate.cancel?.("Bedrock response budget exceeded"))
      .catch(() => undefined);
  } catch {
    // Cleanup must never delay or replace the response-budget failure.
  }
}

function isNodeReadable(value: unknown): value is Readable {
  return value instanceof Readable;
}

function isWebReadableStream(
  value: unknown,
): value is ReadableStream<Uint8Array> {
  return typeof ReadableStream !== "undefined" && value instanceof ReadableStream;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return Boolean(
    value
    && typeof value === "object"
    && Symbol.asyncIterator in value
    && typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function",
  );
}

function buildClientConfig(
  options: BedrockProviderOptions,
): BedrockRuntimeClientConfig {
  const config: BedrockRuntimeClientConfig = {
    region: options.region || "us-east-1",
  };
  if (options.authMethod === "api_key" && options.bedrockApiKey) {
    config.token = { token: options.bedrockApiKey };
  } else if (
    options.authMethod === "iam" &&
    options.awsAccessKeyId &&
    options.awsSecretAccessKey
  ) {
    config.credentials = {
      accessKeyId: options.awsAccessKeyId,
      secretAccessKey: options.awsSecretAccessKey,
      ...(options.awsSessionToken
        ? { sessionToken: options.awsSessionToken }
        : {}),
    };
  } else if (options.authMethod === "profile" && options.awsProfile) {
    config.credentials = fromIni({ profile: options.awsProfile });
  }
  return config;
}

async function completeClaude(
  client: Pick<BedrockRuntimeClient, "send">,
  modelId: string,
  req: CompleteRequest,
  timeoutMs: number,
): Promise<CompleteResponse> {
  const { system, messages } = toAnthropicMessages(req.messages);
  const body = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: req.maxTokens,
    temperature: req.temperature,
    system,
    messages,
    ...(req.tools?.length
      ? {
          tools: req.tools.map((tool) => ({
            name: tool.function.name,
            description: tool.function.description,
            input_schema: tool.function.parameters,
          })),
        }
      : {}),
    ...bedrockClaudeThinkingBody(req),
  };
  const output = await sendBedrockWithTimeout(
    (signal) => client.send(
      new InvokeModelCommand({
        modelId,
        contentType: "application/json",
        accept: "application/json",
        body: new TextEncoder().encode(JSON.stringify(body)),
      }),
      { abortSignal: signal },
    ),
    req.signal,
    timeoutMs,
  );
  if (output.body.byteLength > MODEL_RESPONSE_MAX_BODY_BYTES) {
    throw new ResponseBodyLimitError(
      "Bedrock Claude",
      MODEL_RESPONSE_MAX_BODY_BYTES,
    );
  }
  const json = JSON.parse(
    new TextDecoder().decode(output.body),
  ) as Record<string, unknown>;
  return parseAnthropicResponse(json);
}

function bedrockClaudeThinkingBody(
  req: CompleteRequest,
): { thinking?: { type: "enabled"; budget_tokens: number } } {
  if (req.thinking?.type !== "enabled") {
    return {};
  }
  if (req.maxTokens <= 1024) {
    throw new Error(
      "Bedrock Claude 思考模式要求 max tokens 大于最小思考预算 1024。",
    );
  }
  return {
    thinking: {
      type: "enabled",
      budget_tokens: Math.min(
        req.thinking.budgetTokens ?? 4096,
        req.maxTokens - 1,
      ),
    },
  };
}

async function completeConverse(
  client: Pick<BedrockRuntimeClient, "send">,
  modelId: string,
  req: CompleteRequest,
  timeoutMs: number,
): Promise<CompleteResponse> {
  const { system, messages } = toConverseMessages(req.messages);
  const response = await sendBedrockWithTimeout(
    (signal) => client.send(new ConverseCommand({
      modelId,
      system: system.map((text) => ({ text })),
      messages: messages as never,
      inferenceConfig: {
        temperature: req.temperature,
        maxTokens: req.maxTokens,
      },
      ...(req.tools?.length
        ? {
            toolConfig: {
              tools: req.tools.map((tool) => ({
                toolSpec: {
                  name: tool.function.name,
                  description: tool.function.description,
                  inputSchema: { json: tool.function.parameters as never },
                },
              })),
            },
          }
        : {}),
    }), { abortSignal: signal }),
    req.signal,
    timeoutMs,
  );

  const content =
    (response.output as { message?: { content?: unknown[] } } | undefined)
      ?.message?.content ?? [];
  assertConverseContentWithinBudget(content);
  let text = "";
  let reasoningContent = "";
  const toolCalls: CompleteResponse["toolCalls"] = [];
  for (const block of content) {
    const candidate = block as {
      text?: string;
      reasoningContent?: { reasoningText?: { text?: string } };
      toolUse?: { toolUseId?: string; name?: string; input?: unknown };
    };
    if (candidate.text) {
      text += candidate.text;
    }
    if (candidate.reasoningContent?.reasoningText?.text) {
      reasoningContent += candidate.reasoningContent.reasoningText.text;
    }
    if (candidate.toolUse?.name) {
      toolCalls.push({
        id: candidate.toolUse.toolUseId ?? candidate.toolUse.name,
        type: "function",
        function: {
          name: candidate.toolUse.name,
          arguments: JSON.stringify(candidate.toolUse.input ?? {}),
        },
      });
    }
  }
  return {
    content: text || null,
    toolCalls,
    finishReason: response.stopReason ?? "end_turn",
    ...(reasoningContent ? { reasoningContent } : {}),
    cacheReadTokens: response.usage?.cacheReadInputTokens ?? 0,
    cacheWriteTokens: response.usage?.cacheWriteInputTokens ?? 0,
    ...(response.usage
      ? {
          usage: {
            inputTokens: response.usage.inputTokens ?? 0,
            outputTokens: response.usage.outputTokens ?? 0,
          },
        }
      : {}),
  };
}

function assertConverseContentWithinBudget(content: unknown[]): void {
  let bytes = 0;
  const consumeText = (value: string | undefined) => {
    if (!value) return;
    bytes += Buffer.byteLength(value);
    if (bytes > MODEL_RESPONSE_MAX_BODY_BYTES) {
      throw new ResponseBodyLimitError(
        "Bedrock Converse",
        MODEL_RESPONSE_MAX_BODY_BYTES,
      );
    }
  };
  for (const block of content) {
    const candidate = block as {
      text?: string;
      reasoningContent?: { reasoningText?: { text?: string } };
      toolUse?: { toolUseId?: string; name?: string; input?: unknown };
    };
    consumeText(candidate.text);
    consumeText(candidate.reasoningContent?.reasoningText?.text);
    consumeText(candidate.toolUse?.toolUseId);
    consumeText(candidate.toolUse?.name);
    if (candidate.toolUse) {
      bytes += jsonByteLength(candidate.toolUse.input ?? {},
        MODEL_RESPONSE_MAX_BODY_BYTES - bytes);
      if (bytes > MODEL_RESPONSE_MAX_BODY_BYTES) {
        throw new ResponseBodyLimitError(
          "Bedrock Converse",
          MODEL_RESPONSE_MAX_BODY_BYTES,
        );
      }
    }
  }
}

function jsonByteLength(value: unknown, remaining: number): number {
  let bytes = 0;
  const active = new WeakSet<object>();
  const stack: Array<
    | { kind: "value"; value: unknown; arrayElement: boolean }
    | { kind: "leave"; value: object }
  > = [{ kind: "value", value, arrayElement: false }];
  const add = (amount: number) => {
    bytes += amount;
    if (bytes > remaining) {
      throw new ResponseBodyLimitError(
        "Bedrock Converse",
        MODEL_RESPONSE_MAX_BODY_BYTES,
      );
    }
  };
  while (stack.length) {
    const item = stack.pop();
    if (!item) break;
    if (item.kind === "leave") {
      active.delete(item.value);
      continue;
    }
    const candidate = item.value;
    if (candidate === null) {
      add(4);
    } else if (typeof candidate === "string") {
      add(jsonStringByteLength(candidate));
    } else if (typeof candidate === "number") {
      add(Buffer.byteLength(Number.isFinite(candidate) ? String(candidate) : "null"));
    } else if (typeof candidate === "boolean") {
      add(candidate ? 4 : 5);
    } else if (
      candidate === undefined
      || typeof candidate === "function"
      || typeof candidate === "symbol"
    ) {
      if (item.arrayElement) add(4);
    } else if (typeof candidate === "bigint") {
      throw new TypeError("Bedrock tool input cannot contain bigint values.");
    } else {
      if (active.has(candidate)) {
        throw new TypeError("Bedrock tool input cannot contain circular values.");
      }
      active.add(candidate);
      stack.push({ kind: "leave", value: candidate });
      if (Array.isArray(candidate)) {
        add(2 + Math.max(0, candidate.length - 1));
        for (let index = candidate.length - 1; index >= 0; index -= 1) {
          stack.push({ kind: "value", value: candidate[index], arrayElement: true });
        }
      } else {
        const prototype = Object.getPrototypeOf(candidate);
        if (prototype !== Object.prototype && prototype !== null) {
          throw new TypeError("Bedrock tool input must be plain JSON data.");
        }
        const entries = Object.entries(candidate).filter(([, entry]) =>
          entry !== undefined
          && typeof entry !== "function"
          && typeof entry !== "symbol");
        add(2 + Math.max(0, entries.length - 1) + entries.length);
        for (let index = entries.length - 1; index >= 0; index -= 1) {
          const [key, entry] = entries[index]!;
          stack.push({ kind: "value", value: entry, arrayElement: false });
          add(jsonStringByteLength(key));
        }
      }
    }
  }
  return bytes;
}

function jsonStringByteLength(value: string): number {
  let bytes = 2;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x22 || code === 0x5c) {
      bytes += 2;
    } else if (code <= 0x1f) {
      bytes += code === 0x08 || code === 0x09 || code === 0x0a
          || code === 0x0c || code === 0x0d
        ? 2
        : 6;
    } else if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff
      && value.charCodeAt(index + 1) >= 0xdc00
      && value.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4;
      index += 1;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

async function sendBedrockWithTimeout<T>(
  send: (signal: AbortSignal) => Promise<T>,
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<T> {
  if (parentSignal?.aborted) {
    throw parentSignal.reason instanceof Error
      ? parentSignal.reason
      : new Error("Bedrock request aborted.");
  }
  const controller = new AbortController();
  let removeAbortListener: () => void = () => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    const onAbort = () => {
      reject(
        controller.signal.reason instanceof Error
          ? controller.signal.reason
          : new Error("Bedrock request aborted."),
      );
    };
    controller.signal.addEventListener("abort", onAbort, { once: true });
    removeAbortListener = () =>
      controller.signal.removeEventListener("abort", onAbort);
  });
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  const timer = setTimeout(() => {
    controller.abort(new Error(`Bedrock request timed out after ${timeoutMs}ms.`));
  }, timeoutMs);
  timer.unref?.();
  try {
    return await Promise.race([
      send(controller.signal),
      aborted,
    ]);
  } finally {
    clearTimeout(timer);
    removeAbortListener();
    parentSignal?.removeEventListener("abort", abortFromParent);
  }
}

function splitFamily(model: string): { family: string; modelId: string } {
  const separator = model.indexOf("/");
  if (separator < 0) {
    return { family: "other", modelId: model };
  }
  return {
    family: model.slice(0, separator),
    modelId: model.slice(separator + 1),
  };
}

function toAnthropicMessages(messages: NormalizedMessage[]): {
  system: string;
  messages: unknown[];
} {
  let system = "";
  const output: unknown[] = [];
  for (const message of messages) {
    if (message.role === "system") {
      system += `${system ? "\n\n" : ""}${message.content}`;
      continue;
    }
    if (message.role === "tool") {
      output.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: message.toolCallId,
            content: message.content,
          },
        ],
      });
      continue;
    }
    output.push({
      role: message.role,
      content: message.content.map(toAnthropicBlock),
    });
  }
  return { system, messages: output };
}

function toAnthropicBlock(content: NormalizedContent): Record<string, unknown> {
  switch (content.type) {
    case "text":
      return { type: "text", text: content.text };
    case "thinking":
      return { type: "thinking", thinking: content.text };
    case "tool_use":
      return {
        type: "tool_use",
        id: content.id,
        name: content.name,
        input: content.input,
      };
    case "tool_result":
      return {
        type: "tool_result",
        tool_use_id: content.toolUseId,
        content: content.content,
      };
    case "image":
      return {
        type: "image",
        source: {
          type: "base64",
          media_type: content.mediaType,
          data: content.data,
        },
      };
  }
}

function toConverseMessages(messages: NormalizedMessage[]): {
  system: string[];
  messages: unknown[];
} {
  const system: string[] = [];
  const output: unknown[] = [];
  for (const message of messages) {
    if (message.role === "system") {
      system.push(message.content);
      continue;
    }
    if (message.role === "tool") {
      output.push({
        role: "user",
        content: [
          {
            toolResult: {
              toolUseId: message.toolCallId,
              content: [{ text: message.content }],
            },
          },
        ],
      });
      continue;
    }
    output.push({
      role: message.role === "assistant" ? "assistant" : "user",
      content: message.content.map(toConverseBlock),
    });
  }
  return { system, messages: output };
}

function toConverseBlock(content: NormalizedContent): Record<string, unknown> {
  switch (content.type) {
    case "text":
    case "thinking":
      return { text: content.text };
    case "tool_use":
      return {
        toolUse: {
          toolUseId: content.id,
          name: content.name,
          input: content.input,
        },
      };
    case "tool_result":
      return {
        toolResult: {
          toolUseId: content.toolUseId,
          content: [{ text: content.content }],
        },
      };
    case "image": {
      const format = content.mediaType.split("/")[1] || "png";
      return {
        image: {
          format,
          source: { bytes: Buffer.from(content.data, "base64") },
        },
      };
    }
  }
}

function parseAnthropicResponse(
  json: Record<string, unknown>,
): CompleteResponse {
  const blocks = Array.isArray(json.content) ? json.content : [];
  let text = "";
  let reasoningContent = "";
  const toolCalls: CompleteResponse["toolCalls"] = [];
  for (const block of blocks) {
    const candidate = block as {
      type?: string;
      text?: string;
      thinking?: string;
      id?: string;
      name?: string;
      input?: unknown;
    };
    if (candidate.type === "text" && candidate.text) {
      text += candidate.text;
    }
    if (candidate.type === "thinking" && candidate.thinking) {
      reasoningContent += candidate.thinking;
    }
    if (candidate.type === "tool_use" && candidate.name) {
      toolCalls.push({
        id: candidate.id ?? candidate.name,
        type: "function",
        function: {
          name: candidate.name,
          arguments: JSON.stringify(candidate.input ?? {}),
        },
      });
    }
  }
  const usage = json.usage as
    | {
        input_tokens?: number;
        output_tokens?: number;
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
      }
    | undefined;
  return {
    content: text || null,
    toolCalls,
    finishReason: String(json.stop_reason ?? "end_turn"),
    ...(reasoningContent ? { reasoningContent } : {}),
    cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage?.cache_creation_input_tokens ?? 0,
    ...(usage
      ? {
          usage: {
            inputTokens: usage.input_tokens ?? 0,
            outputTokens: usage.output_tokens ?? 0,
          },
        }
      : {}),
  };
}

function heuristicCount(
  messages: NormalizedMessage[],
  system?: string,
  tools?: ToolDefinition[],
): number {
  return estimateTextTokens(
    [
      system ?? "",
      JSON.stringify(messages),
      JSON.stringify(tools ?? []),
    ].join("\n"),
  );
}
