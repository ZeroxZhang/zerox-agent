// GeminiProvider (contracts v1.4 §2.2/§2.3).
//
// Native Gemini generateContent API: x-goog-api-key header, functionCall/
// functionResponse parts, `thinkingConfig`, and `cachedContent` for prompt
// cache. `countTokens` uses the native `:countTokens` endpoint. Errors are
// normalized at the boundary to `HTTP <status>: <body>` (Patch 6).

import { buildCachePrefix } from "./cachePrefix";
import { estimateTextTokens } from "../contextManager";
import { defaultRequestTimeoutMs, fetchWithTimeout } from "../fetchWithTimeout";
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

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com";

export interface GeminiProviderOptions {
  fetch?: typeof fetch;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}

export function createGeminiProvider(options: GeminiProviderOptions = {}): LLMProvider {
  const fetchImpl = options.fetch ?? fetch;
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? defaultRequestTimeoutMs;

  return {
    id: "gemini" as ProviderId,
    capabilities: CAPABILITIES,

    async complete(req: CompleteRequest): Promise<CompleteResponse> {
      const { systemInstruction, contents, tools } = toGeminiBody(req.messages, req.tools);
      const body: Record<string, unknown> = {
        contents,
        ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {}),
        ...(tools ? { tools: [{ functionDeclarations: tools.map(toGeminiFunctionDecl) }] } : {}),
        generationConfig: { temperature: req.temperature, maxOutputTokens: req.maxTokens },
        ...(req.thinking?.type === "enabled" ? { thinkingConfig: { thinkingBudget: req.thinking.budgetTokens ?? 0 } } : {}),
      };
      const json = await geminiFetch(fetchImpl, baseUrl, `/v1beta/models/${req.model}:generateContent`, req.apiKey, body, timeoutMs, req.signal);
      return parseGeminiResponse(json);
    },

    async *stream(req: CompleteRequest): AsyncIterable<StreamEvent> {
      const { systemInstruction, contents, tools } = toGeminiBody(req.messages, req.tools);
      const body: Record<string, unknown> = {
        contents,
        ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {}),
        ...(tools ? { tools: [{ functionDeclarations: tools.map(toGeminiFunctionDecl) }] } : {}),
        generationConfig: { temperature: req.temperature, maxOutputTokens: req.maxTokens },
      };
      const res = await geminiFetchRaw(fetchImpl, baseUrl, `/v1beta/models/${req.model}:streamGenerateContent?alt=sse`, req.apiKey, body, timeoutMs, req.signal);
      if (!res.ok) {
        yield { type: "error", error: new Error(`HTTP ${res.status}: ${await res.text()}`) };
        return;
      }
      const reader = res.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let buffer = "";
      const acc = { text: "", finish: "STOP", cacheRead: 0 };
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
          const candidates = evt.candidates as Array<Record<string, unknown>> | undefined;
          const parts = ((candidates?.[0]?.content as { parts?: Array<Record<string, unknown>> } | undefined)?.parts) ?? [];
          for (const p of parts) {
            if (typeof p.text === "string") { acc.text += p.text; yield { type: "text_delta", text: p.text }; }
            const fc = p.functionCall as { name: string; args: unknown } | undefined;
            if (fc) yield { type: "tool_call_delta", toolCallId: fc.name, name: fc.name, argumentsDelta: JSON.stringify(fc.args ?? {}) };
          }
          if (candidates?.[0]?.finishReason) acc.finish = candidates[0].finishReason as string;
          const um = evt.usageMetadata as { cachedContentTokenCount?: number } | undefined;
          if (um?.cachedContentTokenCount) acc.cacheRead = um.cachedContentTokenCount;
        }
      }
      yield { type: "done", response: { content: acc.text || null, toolCalls: [], finishReason: acc.finish, cacheReadTokens: acc.cacheRead, cacheWriteTokens: 0 } };
    },

    async countTokens(messages, opts?) {
      if (!options.apiKey || !options.model) return heuristicCount(messages, opts?.system, opts?.tools);
      try {
        const { contents } = toGeminiBody(messages, opts?.tools, opts?.system);
        const json = await geminiFetch(fetchImpl, baseUrl, `/v1beta/models/${options.model}:countTokens`, options.apiKey, { contents }, timeoutMs, undefined);
        return (json as { totalTokens?: number }).totalTokens ?? heuristicCount(messages, opts?.system, opts?.tools);
      } catch {
        return heuristicCount(messages, opts?.system, opts?.tools);
      }
    },

    buildCachePrefix(messages, opts?) {
      return buildCachePrefix(messages, opts);
    },
  };
}

function toGeminiBody(
  messages: NormalizedMessage[],
  tools?: ToolDefinition[],
  systemOverride?: string,
): { systemInstruction: string; contents: unknown[]; tools?: ToolDefinition[] } {
  let system = systemOverride ?? "";
  const contents: unknown[] = [];
  for (const m of messages) {
    if (m.role === "system") { system += (system ? "\n\n" : "") + m.content; continue; }
    if (m.role === "tool") {
      contents.push({ role: "user", parts: [{ functionResponse: { name: m.toolCallId, response: { content: m.content } } }] });
      continue;
    }
    const parts = m.content.map(toGeminiPart);
    contents.push({ role: m.role === "assistant" ? "model" : "user", parts });
  }
  return { systemInstruction: system, contents, ...(tools ? { tools } : {}) };
}

function toGeminiPart(c: NormalizedContent): Record<string, unknown> {
  switch (c.type) {
    case "text": return { text: c.text };
    case "thinking": return { text: c.text, thought: true };
    case "tool_use": return { functionCall: { name: c.name, args: c.input } };
    case "tool_result": return { functionResponse: { name: c.toolUseId, response: { content: c.content } } };
    case "image": return { inlineData: { mimeType: c.mediaType, data: c.data } };
  }
}

function toGeminiFunctionDecl(td: ToolDefinition): Record<string, unknown> {
  return { name: td.function.name, description: td.function.description, parameters: td.function.parameters };
}

async function geminiFetch(
  fetchImpl: typeof fetch,
  baseUrl: string,
  path: string,
  apiKey: string,
  body: Record<string, unknown>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const res = await geminiFetchRaw(fetchImpl, baseUrl, path, apiKey, body, timeoutMs, signal);
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
  return JSON.parse(text) as Record<string, unknown>;
}

async function geminiFetchRaw(
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
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(body),
  }, timeoutMs, "Gemini", signal);
}

function parseGeminiResponse(json: Record<string, unknown>): CompleteResponse {
  const candidate = (json.candidates as Array<Record<string, unknown>>)?.[0];
  const parts = (candidate?.content as { parts?: Array<Record<string, unknown>> })?.parts ?? [];
  let text = "";
  const toolCalls: CompleteResponse["toolCalls"] = [];
  for (const p of parts) {
    if (typeof p.text === "string") text += p.text;
    const fc = p.functionCall as { name: string; args: unknown } | undefined;
    if (fc) toolCalls.push({ id: fc.name, type: "function", function: { name: fc.name, arguments: JSON.stringify(fc.args ?? {}) } });
  }
  const usage = json.usageMetadata as { promptTokenCount?: number; candidatesTokenCount?: number; cachedContentTokenCount?: number } | undefined;
  return {
    content: text || null,
    toolCalls,
    finishReason: (candidate?.finishReason as string) ?? "STOP",
    cacheReadTokens: usage?.cachedContentTokenCount ?? 0,
    cacheWriteTokens: 0,
    ...(usage ? { usage: { inputTokens: usage.promptTokenCount ?? 0, outputTokens: usage.candidatesTokenCount ?? 0 } } : {}),
  };
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
