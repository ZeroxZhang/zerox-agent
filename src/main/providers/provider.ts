// Provider contract (contracts v1.4 §2, Exit Criteria for P5/P8).
//
// Frozen `LLMProvider` interface + `NormalizedMessage`/`NormalizedContent`
// (contract §2.1, verbatim) and the dependency types §2.1 referenced but did
// not define (ProviderId / CompleteRequest / CompleteResponse / StreamEvent /
// CachePrefix / ToolCall / ToolDefinition — §12 Patch 2/3 authoritative shape).
//
// P5 (checkpoint-writer fork agent) reuses `CachePrefix` + `buildCachePrefix`
// for byte-stable prompt-cache prefix reuse. P8 (streaming/max-mode) consumes
// `LLMProvider.stream()` + the `StreamEvent` variants. Both import from here.

import type { ProviderId } from "../../shared/modelSettings";
import type { ModelServiceNotice } from "../../shared/modelServiceNotice";

export type { ProviderId };

export interface ProviderCapabilities {
  toolUse: boolean; // native tool_use (not OpenAI tools-compat)
  thinking: boolean;
  vision: boolean;
  promptCache: boolean;
  streamingToolCalls: boolean;
}

export type NormalizedContent =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; toolUseId: string; content: string }
  | { type: "image"; mediaType: string; data: string };

export type NormalizedMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: NormalizedContent[] }
  | { role: "assistant"; content: NormalizedContent[]; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface CompleteRequest {
  model: string;
  apiKey: string;
  baseUrl?: string; // openai-compatible only
  temperature: number;
  maxTokens: number;
  messages: NormalizedMessage[];
  tools?: ToolDefinition[];
  toolChoice?: "auto" | "none" | "required" | { type: "function"; function: { name: string } };
  thinking?: { type: "enabled" | "disabled"; budgetTokens?: number };
  cachePrefix?: CachePrefix; // prompt cache
  signal?: AbortSignal;
}

export interface CompleteResponse {
  content: string | null;
  toolCalls: ToolCall[];
  finishReason: string;
  reasoningContent?: string; // thinking
  cacheReadTokens: number; // §2.3
  cacheWriteTokens: number; // §2.3
  usage?: { inputTokens: number; outputTokens: number };
  modelServiceNotice?: ModelServiceNotice;
}

// Contract StreamEvent (§12 Patch 2 / Patch 10 authoritative 5-variant shape).
// Distinct from the low-level openAiCompatibleClient.StreamEvent; providers map
// the low-level form to these variants at the boundary.
export type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; text: string }
  | { type: "tool_call_delta"; toolCallId: string; index?: number; name?: string; argumentsDelta?: string }
  | { type: "done"; finishReason?: string; response?: CompleteResponse }
  | { type: "error"; error: Error };

export interface CachePrefix {
  system: string;
  tools: ToolDefinition[];
  messages: NormalizedMessage[]; // prefix messages up to the watermark
  watermark: number; // §12 Patch 2: index of the last prefix message
}

export interface LLMProvider {
  readonly id: ProviderId;
  readonly capabilities: ProviderCapabilities;
  complete(req: CompleteRequest): Promise<CompleteResponse>;
  stream(req: CompleteRequest): AsyncIterable<StreamEvent>;
  countTokens(messages: NormalizedMessage[], opts?: { system?: string; tools?: ToolDefinition[] }): Promise<number>;
  buildCachePrefix(messages: NormalizedMessage[], opts?: { system?: string; tools?: ToolDefinition[] }): CachePrefix;
}

// Re-export the low-level types the adapter bridges to, for convenience.
export type { ChatMessage } from "../openAiCompatibleClient";
