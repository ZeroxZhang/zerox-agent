// AnthropicProvider (contracts v1.4 §2.2/§2.3).
//
// Native Anthropic Messages API: x-api-key + anthropic-version headers,
// tool_use/tool_result content blocks, `thinking`, and prompt-cache
// `cache_control` breakpoints. `countTokens` uses the native
// `/v1/messages/count_tokens` endpoint (with the credentials captured at
// construction). HTTP failures expose only structured status and bounded retry
// metadata; provider response bodies are not copied into errors.

import { buildCachePrefix } from "./cachePrefix";
import { estimateTextTokens } from "../contextManager";
import { defaultRequestTimeoutMs, fetchWithTimeout } from "../fetchWithTimeout";
import { providerHttpError } from "./providerHttpError";
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

const CAPABILITIES: ProviderCapabilities = {
  toolUse: true,
  thinking: true,
  vision: true,
  promptCache: true,
  streamingToolCalls: true,
};

const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_BASE_URL = "https://api.anthropic.com";

export interface AnthropicProviderOptions {
  fetch?: typeof fetch;
  baseUrl?: string;
  /** Credentials for countTokens (complete/stream take apiKey from the request). */
  apiKey?: string;
  /** Default model for countTokens. */
  model?: string;
  timeoutMs?: number;
}

export function createAnthropicProvider(
  options: AnthropicProviderOptions = {},
): LLMProvider {
  const fetchImpl = options.fetch ?? fetch;
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? defaultRequestTimeoutMs;

  return {
    id: "anthropic" as ProviderId,
    capabilities: CAPABILITIES,

    async complete(req: CompleteRequest): Promise<CompleteResponse> {
      const { system, messages, tools } = toAnthropicBodyParts(req.messages, undefined, req.tools);
      const body: Record<string, unknown> = {
        model: req.model,
        max_tokens: req.maxTokens,
        temperature: req.temperature,
        system,
        messages,
        ...(tools ? { tools } : {}),
        ...(req.toolChoice ? { tool_choice: toAnthropicToolChoice(req.toolChoice) } : {}),
        ...(req.thinking?.type === "enabled"
          ? { thinking: { type: "enabled", budget_tokens: req.thinking.budgetTokens ?? 4096 } }
          : {}),
      };
      if (req.cachePrefix) applyCacheBreakpoint(body);
      const json = await anthropicFetch(fetchImpl, baseUrl, "/v1/messages", req.apiKey, body, timeoutMs, req.signal);
      return parseAnthropicResponse(json);
    },

    async *stream(req: CompleteRequest): AsyncIterable<StreamEvent> {
      const { system, messages, tools } = toAnthropicBodyParts(req.messages, undefined, req.tools);
      const body: Record<string, unknown> = {
        model: req.model,
        max_tokens: req.maxTokens,
        temperature: req.temperature,
        system,
        messages,
        stream: true,
        ...(tools ? { tools } : {}),
        ...(req.toolChoice ? { tool_choice: toAnthropicToolChoice(req.toolChoice) } : {}),
      };
      const res = await anthropicFetchRaw(fetchImpl, baseUrl, "/v1/messages", req.apiKey, body, timeoutMs, req.signal);
      if (!res.ok) {
        yield { type: "error", error: providerHttpError(res) };
        return;
      }
      yield* parseAnthropicStream(res);
    },

    async countTokens(messages, opts?) {
      if (!options.apiKey || !options.model) {
        // No credentials captured: heuristic fallback (contract O3).
        return heuristicCount(messages, opts?.system, opts?.tools);
      }
      try {
        const { system, messages: aMsgs } = toAnthropicBodyParts(messages, opts?.system, opts?.tools);
        const json = await anthropicFetch(fetchImpl, baseUrl, "/v1/messages/count_tokens", options.apiKey, {
          model: options.model,
          system,
          messages: aMsgs,
        }, timeoutMs, undefined);
        return (json as { input_tokens?: number }).input_tokens ?? heuristicCount(messages, opts?.system, opts?.tools);
      } catch {
        return heuristicCount(messages, opts?.system, opts?.tools);
      }
    },

    buildCachePrefix(messages, opts?) {
      return buildCachePrefix(messages, opts);
    },
  };
}

/** Multi-segment system messages improve Anthropic prompt cache hit rate
 *  by keeping the base layer byte-identical. Controlled by env flag; defaults off. */
const MULTI_SEGMENT_SYSTEM = process.env.ZEROX_MULTI_SEGMENT_SYSTEM === "1";

type AnthropicSystemPart = { type: "text"; text: string; cache_control?: { type: "ephemeral" } };
type AnthropicSystem = string | AnthropicSystemPart[];

// --- body conversion ---

function toAnthropicBodyParts(
  messages: NormalizedMessage[],
  systemOverride?: string,
  tools?: ToolDefinition[],
): { system: AnthropicSystem; messages: unknown[]; tools?: unknown[] } {
  if (MULTI_SEGMENT_SYSTEM) {
    const parts: AnthropicSystemPart[] = [];
    if (systemOverride) {
      parts.push({ type: "text", text: systemOverride });
    }
    for (const m of messages) {
      if (m.role === "system") {
        parts.push({ type: "text", text: m.content });
        continue;
      }
    }
    const out: unknown[] = [];
    for (const m of messages) {
      if (m.role === "system") continue;
      if (m.role === "tool") {
        out.push({ role: "user", content: [{ type: "tool_result", tool_use_id: m.toolCallId, content: m.content }] });
        continue;
      }
      const content = m.content.map(toAnthropicBlock);
      out.push({ role: m.role, content });
    }
    const t = tools?.map((td) => ({
      name: td.function.name,
      description: td.function.description,
      input_schema: td.function.parameters,
    }));
    return { system: parts, messages: out, ...(t ? { tools: t } : {}) };
  }

  // Legacy: merge all system messages into a single string
  let system = systemOverride ?? "";
  const out: unknown[] = [];
  for (const m of messages) {
    if (m.role === "system") { system += (system ? "\n\n" : "") + m.content; continue; }
    if (m.role === "tool") {
      out.push({ role: "user", content: [{ type: "tool_result", tool_use_id: m.toolCallId, content: m.content }] });
      continue;
    }
    const content = m.content.map(toAnthropicBlock);
    out.push({ role: m.role, content });
  }
  const t = tools?.map((td) => ({
    name: td.function.name,
    description: td.function.description,
    input_schema: td.function.parameters,
  }));
  return { system, messages: out, ...(t ? { tools: t } : {}) };
}

function toAnthropicBlock(c: NormalizedContent): Record<string, unknown> {
  switch (c.type) {
    case "text": return { type: "text", text: c.text };
    case "thinking": return { type: "thinking", thinking: c.text };
    case "tool_use": return { type: "tool_use", id: c.id, name: c.name, input: c.input };
    case "tool_result": return { type: "tool_result", tool_use_id: c.toolUseId, content: c.content };
    case "image": return { type: "image", source: { type: "base64", media_type: c.mediaType, data: c.data } };
  }
}

function toAnthropicToolChoice(choice: NonNullable<CompleteRequest["toolChoice"]>): unknown {
  if (choice === "auto" || choice === "none" || choice === "required") return { type: choice };
  return { type: "tool", name: choice.function.name };
}

function applyCacheBreakpoint(body: Record<string, unknown>): void {
  const sys = body.system;
  if (typeof sys === "string" && sys) {
    // Legacy single-string: wrap with cache_control
    body.system = { type: "text", text: sys, cache_control: { type: "ephemeral" } };
  } else if (Array.isArray(sys) && sys.length > 0) {
    // Multi-segment: apply cache_control only to the first (base) segment.
    // The base layer is the most stable; subsequent layers may be dynamic.
    const parts = sys as AnthropicSystemPart[];
    if (!parts[0].cache_control) {
      parts[0] = { ...parts[0], cache_control: { type: "ephemeral" } };
    }
    body.system = parts;
  }
}

// --- HTTP ---

async function anthropicFetch(
  fetchImpl: typeof fetch,
  baseUrl: string,
  path: string,
  apiKey: string,
  body: Record<string, unknown>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const res = await anthropicFetchRaw(fetchImpl, baseUrl, path, apiKey, body, timeoutMs, signal);
  const text = await res.text();
  if (!res.ok) throw providerHttpError(res);
  return JSON.parse(text) as Record<string, unknown>;
}

async function anthropicFetchRaw(
  fetchImpl: typeof fetch,
  baseUrl: string,
  path: string,
  apiKey: string,
  body: Record<string, unknown>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Response> {
  return fetchWithTimeout(fetchImpl, `${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  }, timeoutMs, "Anthropic", signal);
}

function parseAnthropicResponse(json: Record<string, unknown>): CompleteResponse {
  const content = (json.content as Array<Record<string, unknown>>) ?? [];
  let text = "";
  let thinking = "";
  const toolCalls: CompleteResponse["toolCalls"] = [];
  for (const block of content) {
    if (block.type === "text") text += block.text as string;
    else if (block.type === "thinking") thinking += block.thinking as string;
    else if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id as string,
        type: "function",
        function: { name: block.name as string, arguments: JSON.stringify(block.input ?? {}) },
      });
    }
  }
  const usage = json.usage as { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } | undefined;
  return {
    content: text || null,
    toolCalls,
    finishReason: (json.stop_reason as string) ?? "stop",
    ...(thinking ? { reasoningContent: thinking } : {}),
    cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage?.cache_creation_input_tokens ?? 0,
    ...(usage ? { usage: { inputTokens: usage.input_tokens ?? 0, outputTokens: usage.output_tokens ?? 0 } } : {}),
  };
}

async function* parseAnthropicStream(res: Response): AsyncIterable<StreamEvent> {
  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";
  const acc = { text: "", thinking: "", finish: "stop", cacheRead: 0, cacheWrite: 0 };
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      let evt: Record<string, unknown>;
      try { evt = JSON.parse(payload); } catch { continue; }
      const t = evt.type as string;
      if (t === "content_block_delta") {
        const delta = evt.delta as Record<string, unknown>;
        if (delta.type === "text_delta") { acc.text += delta.text; yield { type: "text_delta", text: delta.text as string }; }
        else if (delta.type === "thinking_delta") { acc.thinking += delta.thinking; yield { type: "thinking_delta", text: delta.thinking as string }; }
        else if (delta.type === "input_json_delta") {
          yield { type: "tool_call_delta", toolCallId: String(evt.index ?? ""), argumentsDelta: delta.partial_json as string };
        }
      } else if (t === "message_delta") {
        const d = evt.delta as Record<string, unknown>;
        if (d.stop_reason) acc.finish = d.stop_reason as string;
        const usage = evt.usage as Record<string, unknown> | undefined;
        if (usage?.cache_read_input_tokens) acc.cacheRead = usage.cache_read_input_tokens as number;
        if (usage?.cache_creation_input_tokens) acc.cacheWrite = usage.cache_creation_input_tokens as number;
      } else if (t === "message_stop") {
        yield { type: "done", response: { content: acc.text || null, toolCalls: [], finishReason: acc.finish, cacheReadTokens: acc.cacheRead, cacheWriteTokens: acc.cacheWrite } };
      }
    }
  }
}

function heuristicCount(messages: NormalizedMessage[], system?: string, tools?: ToolDefinition[]): number {
  let total = estimateTextTokens(system ?? "");
  for (const m of messages) {
    if (m.role === "system" || m.role === "tool") total += estimateTextTokens(m.content);
    else total += estimateTextTokens(m.content.map((c) => (c.type === "text" || c.type === "thinking" ? c.text : JSON.stringify(c))).join(""));
  }
  for (const t of tools ?? []) total += estimateTextTokens(JSON.stringify(t));
  return total;
}
