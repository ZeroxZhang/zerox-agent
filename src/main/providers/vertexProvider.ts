import { GoogleAuth } from "google-auth-library";
import { estimateTextTokens } from "../contextManager";
import { defaultRequestTimeoutMs, fetchWithTimeout } from "../fetchWithTimeout";
import { buildCachePrefix } from "./cachePrefix";
import { geminiGenerationConfig } from "./geminiProvider";
import { providerHttpError } from "./providerHttpError";
import { withModelServiceNotice } from "../../shared/modelServiceNotice";
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

const capabilities: ProviderCapabilities = {
  toolUse: true,
  thinking: true,
  vision: true,
  promptCache: false,
  streamingToolCalls: false,
};

export type VertexProviderOptions = {
  project: string;
  location: string;
  authMethod?: "adc" | "service_account" | "api_key";
  serviceAccountJson?: string;
  apiKey?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  getAccessToken?: () => Promise<string>;
};

export function createVertexProvider(
  options: VertexProviderOptions,
): LLMProvider {
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? defaultRequestTimeoutMs;

  return {
    id: "vertex" as ProviderId,
    capabilities,

    async complete(req) {
      const { family, modelId } = splitFamily(req.model);
      const auth = await resolveAuth(options);
      let response: CompleteResponse;
      if (family === "claude") {
        response = await completeClaude(
          fetchImpl,
          options,
          modelId,
          req,
          auth,
          timeoutMs,
        );
      } else if (family === "openweight") {
        response = await completeOpenWeight(
          fetchImpl,
          options,
          modelId,
          req,
          auth,
          timeoutMs,
        );
      } else {
        response = await completeGemini(
          fetchImpl,
          options,
          modelId,
          req,
          auth,
          timeoutMs,
        );
      }
      return withModelServiceNotice(response, {
        provider: "vertex",
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
      return estimateTextTokens(
        [opts?.system ?? "", JSON.stringify(messages), JSON.stringify(opts?.tools ?? [])].join(
          "\n",
        ),
      );
    },

    buildCachePrefix(messages, opts?) {
      return buildCachePrefix(messages, opts);
    },
  };
}

type VertexAuth = { bearer?: string; apiKey?: string };

async function resolveAuth(options: VertexProviderOptions): Promise<VertexAuth> {
  if (options.authMethod === "api_key") {
    if (!options.apiKey) {
      throw new Error("Vertex API Key 未配置。");
    }
    return { apiKey: options.apiKey };
  }
  if (options.getAccessToken) {
    return { bearer: await options.getAccessToken() };
  }
  const serviceAccount =
    options.authMethod === "service_account"
      ? options.serviceAccountJson?.trim()
      : undefined;
  const auth = serviceAccount
    ? serviceAccount.startsWith("{")
      ? new GoogleAuth({
          credentials: JSON.parse(serviceAccount) as Record<string, string>,
          scopes: ["https://www.googleapis.com/auth/cloud-platform"],
        })
      : new GoogleAuth({
          keyFilename: serviceAccount,
          scopes: ["https://www.googleapis.com/auth/cloud-platform"],
        })
    : new GoogleAuth({
        scopes: ["https://www.googleapis.com/auth/cloud-platform"],
      });
  const token = await auth.getAccessToken();
  if (!token) {
    throw new Error("无法获取 Vertex AI 访问令牌。");
  }
  return { bearer: token };
}

async function completeGemini(
  fetchImpl: typeof fetch,
  options: VertexProviderOptions,
  modelId: string,
  req: CompleteRequest,
  auth: VertexAuth,
  timeoutMs: number,
): Promise<CompleteResponse> {
  const { system, contents } = toGeminiMessages(req.messages);
  const body = {
    contents,
    ...(system
      ? { systemInstruction: { parts: [{ text: system }] } }
      : {}),
    generationConfig: geminiGenerationConfig(req),
    ...(req.tools?.length
      ? {
          tools: [
            {
              functionDeclarations: req.tools.map((tool) => ({
                name: tool.function.name,
                description: tool.function.description,
                parameters: tool.function.parameters,
              })),
            },
          ],
        }
      : {}),
  };
  const location = options.location || "global";
  const url = auth.apiKey
    ? `https://aiplatform.googleapis.com/v1/publishers/google/models/${encodeURIComponent(
        modelId,
      )}:generateContent`
    : vertexUrl(
        location,
        options.project,
        `publishers/google/models/${modelId}:generateContent`,
      );
  const json = await vertexFetch(fetchImpl, url, body, auth, timeoutMs, req.signal);
  return parseGeminiResponse(json);
}

async function completeClaude(
  fetchImpl: typeof fetch,
  options: VertexProviderOptions,
  modelId: string,
  req: CompleteRequest,
  auth: VertexAuth,
  timeoutMs: number,
): Promise<CompleteResponse> {
  if (auth.apiKey) {
    throw new Error("Vertex API Key 认证仅支持 Gemini 模型。");
  }
  const { system, messages } = toAnthropicMessages(req.messages);
  const body = {
    anthropic_version: "vertex-2023-10-16",
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
    ...vertexAnthropicThinkingBody(req),
  };
  const url = vertexUrl(
    options.location || "global",
    options.project,
    `publishers/anthropic/models/${modelId}:rawPredict`,
  );
  const json = await vertexFetch(fetchImpl, url, body, auth, timeoutMs, req.signal);
  return parseAnthropicResponse(json);
}

function vertexAnthropicThinkingBody(
  req: CompleteRequest,
): { thinking?: { type: "enabled"; budget_tokens: number } } {
  if (req.thinking?.type !== "enabled") {
    return {};
  }
  if (req.maxTokens <= 1024) {
    throw new Error(
      "Vertex Claude 思考模式要求 max tokens 大于最小思考预算 1024。",
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

async function completeOpenWeight(
  fetchImpl: typeof fetch,
  options: VertexProviderOptions,
  modelId: string,
  req: CompleteRequest,
  auth: VertexAuth,
  timeoutMs: number,
): Promise<CompleteResponse> {
  if (auth.apiKey) {
    throw new Error("Vertex API Key 认证不支持开放权重 MaaS 模型。");
  }
  const url = `https://${vertexHost(
    options.location || "global",
  )}/v1beta1/projects/${encodeURIComponent(
    options.project,
  )}/locations/${encodeURIComponent(
    options.location || "global",
  )}/endpoints/openapi/chat/completions`;
  const body = {
    model: modelId,
    messages: toOpenAiMessages(req.messages),
    temperature: req.temperature,
    max_tokens: req.maxTokens,
    ...(req.tools?.length ? { tools: req.tools } : {}),
  };
  const json = await vertexFetch(fetchImpl, url, body, auth, timeoutMs, req.signal);
  const choice = (json.choices as Array<Record<string, unknown>> | undefined)?.[0];
  const message = choice?.message as
    | { content?: string; tool_calls?: Array<Record<string, unknown>> }
    | undefined;
  return {
    content: message?.content ?? null,
    toolCalls: (message?.tool_calls ?? []).map((candidate) => {
      const fn = candidate.function as { name?: string; arguments?: string };
      return {
        id: String(candidate.id ?? fn.name ?? "tool"),
        type: "function" as const,
        function: {
          name: fn.name ?? "tool",
          arguments: fn.arguments ?? "{}",
        },
      };
    }),
    finishReason: String(choice?.finish_reason ?? "stop"),
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
}

async function vertexFetch(
  fetchImpl: typeof fetch,
  url: string,
  body: unknown,
  auth: VertexAuth,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const response = await fetchWithTimeout(
    fetchImpl,
    url,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(auth.bearer ? { authorization: `Bearer ${auth.bearer}` } : {}),
        ...(auth.apiKey ? { "x-goog-api-key": auth.apiKey } : {}),
      },
      body: JSON.stringify(body),
    },
    timeoutMs,
    "Vertex AI",
    signal,
  );
  const text = await response.text();
  if (!response.ok) {
    throw await providerHttpError(response);
  }
  return JSON.parse(text) as Record<string, unknown>;
}

function vertexUrl(
  location: string,
  project: string,
  suffix: string,
): string {
  return `https://${vertexHost(location)}/v1/projects/${encodeURIComponent(
    project,
  )}/locations/${encodeURIComponent(location)}/${suffix}`;
}

function vertexHost(location: string): string {
  return location === "global"
    ? "aiplatform.googleapis.com"
    : `${location}-aiplatform.googleapis.com`;
}

function splitFamily(model: string): { family: string; modelId: string } {
  const separator = model.indexOf("/");
  if (separator < 0) {
    return { family: "gemini", modelId: model };
  }
  return {
    family: model.slice(0, separator),
    modelId: model.slice(separator + 1),
  };
}

function toGeminiMessages(messages: NormalizedMessage[]): {
  system: string;
  contents: unknown[];
} {
  let system = "";
  const contents: unknown[] = [];
  for (const message of messages) {
    if (message.role === "system") {
      system += `${system ? "\n\n" : ""}${message.content}`;
      continue;
    }
    if (message.role === "tool") {
      contents.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name: message.toolCallId,
              response: { content: message.content },
            },
          },
        ],
      });
      continue;
    }
    contents.push({
      role: message.role === "assistant" ? "model" : "user",
      parts: message.content.map((content) => {
        if (content.type === "text" || content.type === "thinking") {
          return {
            text: content.text,
            ...(content.type === "thinking" ? { thought: true } : {}),
          };
        }
        if (content.type === "image") {
          return {
            inlineData: { mimeType: content.mediaType, data: content.data },
          };
        }
        if (content.type === "tool_use") {
          return { functionCall: { name: content.name, args: content.input } };
        }
        return {
          functionResponse: {
            name: content.toolUseId,
            response: { content: content.content },
          },
        };
      }),
    });
  }
  return { system, contents };
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
      content: message.content.map((content) => {
        if (content.type === "text") return { type: "text", text: content.text };
        if (content.type === "thinking") {
          return { type: "thinking", thinking: content.text };
        }
        if (content.type === "image") {
          return {
            type: "image",
            source: {
              type: "base64",
              media_type: content.mediaType,
              data: content.data,
            },
          };
        }
        if (content.type === "tool_use") {
          return {
            type: "tool_use",
            id: content.id,
            name: content.name,
            input: content.input,
          };
        }
        return {
          type: "tool_result",
          tool_use_id: content.toolUseId,
          content: content.content,
        };
      }),
    });
  }
  return { system, messages: output };
}

function toOpenAiMessages(messages: NormalizedMessage[]): unknown[] {
  return messages.map((message) => {
    if (message.role === "system") return message;
    if (message.role === "tool") {
      return {
        role: "tool",
        tool_call_id: message.toolCallId,
        content: message.content,
      };
    }
    return {
      role: message.role,
      content: message.content
        .filter((content) => content.type === "text")
        .map((content) => ("text" in content ? content.text : ""))
        .join(""),
    };
  });
}

function parseGeminiResponse(json: Record<string, unknown>): CompleteResponse {
  const candidate = (json.candidates as Array<Record<string, unknown>> | undefined)?.[0];
  const parts =
    (
      candidate?.content as
        | { parts?: Array<Record<string, unknown>> }
        | undefined
    )?.parts ?? [];
  let text = "";
  let thinking = "";
  const toolCalls: CompleteResponse["toolCalls"] = [];
  for (const part of parts) {
    if (typeof part.text === "string" && part.thought === true) {
      thinking += part.text;
    } else if (typeof part.text === "string") {
      text += part.text;
    }
    const call = part.functionCall as
      | { name?: string; args?: unknown }
      | undefined;
    if (call?.name) {
      toolCalls.push({
        id: call.name,
        type: "function",
        function: {
          name: call.name,
          arguments: JSON.stringify(call.args ?? {}),
        },
      });
    }
  }
  const usage = json.usageMetadata as
    | { promptTokenCount?: number; candidatesTokenCount?: number }
    | undefined;
  return {
    content: text || null,
    toolCalls,
    finishReason: String(candidate?.finishReason ?? "STOP"),
    ...(thinking ? { reasoningContent: thinking } : {}),
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    ...(usage
      ? {
          usage: {
            inputTokens: usage.promptTokenCount ?? 0,
            outputTokens: usage.candidatesTokenCount ?? 0,
          },
        }
      : {}),
  };
}

function parseAnthropicResponse(
  json: Record<string, unknown>,
): CompleteResponse {
  const content = Array.isArray(json.content) ? json.content : [];
  let text = "";
  let thinking = "";
  const toolCalls: CompleteResponse["toolCalls"] = [];
  for (const block of content) {
    const candidate = block as {
      type?: string;
      text?: string;
      id?: string;
      name?: string;
      input?: unknown;
      thinking?: string;
    };
    if (candidate.type === "text" && candidate.text) text += candidate.text;
    if (candidate.type === "thinking" && candidate.thinking) {
      thinking += candidate.thinking;
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
  return {
    content: text || null,
    toolCalls,
    finishReason: String(json.stop_reason ?? "end_turn"),
    ...(thinking ? { reasoningContent: thinking } : {}),
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
}

export function heuristicVertexTokenCount(
  messages: NormalizedMessage[],
  system?: string,
  tools?: ToolDefinition[],
): number {
  return estimateTextTokens(
    [system ?? "", JSON.stringify(messages), JSON.stringify(tools ?? [])].join(
      "\n",
    ),
  );
}
