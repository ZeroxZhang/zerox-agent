// Provider factory (contracts v1.4 §2.2).
//
// Dispatches to the concrete provider by `providerId`. Default
// `openai-compatible` preserves the legacy single-path behavior (zero
// regression). P5/P8 construct providers through this factory.

import { createOpenAICompatibleProvider } from "./openAiCompatibleProvider";
import { createAnthropicProvider } from "./anthropicProvider";
import { createGeminiProvider } from "./geminiProvider";
import type { LLMProvider, ProviderId } from "./provider";

export interface ProviderSettings {
  providerId?: ProviderId;
  apiKey: string;
  chatModel: string;
  baseUrl?: string;
  thinkingEnabled?: boolean;
  thinkingBudgetTokens?: number;
}

export interface ProviderDeps {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export function createProvider(
  settings: ProviderSettings,
  deps: ProviderDeps = {},
): LLMProvider {
  const id = (settings.providerId ?? "openai-compatible").toLowerCase() as ProviderId;
  switch (id) {
    case "anthropic":
      return createAnthropicProvider({
        ...(deps.fetch ? { fetch: deps.fetch } : {}),
        ...(deps.timeoutMs ? { timeoutMs: deps.timeoutMs } : {}),
        ...(settings.baseUrl ? { baseUrl: settings.baseUrl } : {}),
        apiKey: settings.apiKey,
        model: settings.chatModel,
      });
    case "gemini":
      return createGeminiProvider({
        ...(deps.fetch ? { fetch: deps.fetch } : {}),
        ...(deps.timeoutMs ? { timeoutMs: deps.timeoutMs } : {}),
        ...(settings.baseUrl ? { baseUrl: settings.baseUrl } : {}),
        apiKey: settings.apiKey,
        model: settings.chatModel,
      });
    case "openai-compatible":
    default:
      return createOpenAICompatibleProvider({
        ...(deps.fetch ? { fetch: deps.fetch } : {}),
        ...(deps.timeoutMs ? { timeoutMs: deps.timeoutMs } : {}),
      });
  }
}
