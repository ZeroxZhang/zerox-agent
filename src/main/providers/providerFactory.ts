// Provider factory (contracts v1.4 §2.2).
//
// Dispatches to the concrete provider by `providerId`. Default
// `openai-compatible` preserves the legacy single-path behavior (zero
// regression). P5/P8 construct providers through this factory.

import { createOpenAICompatibleProvider } from "./openAiCompatibleProvider";
import { createAnthropicProvider } from "./anthropicProvider";
import { createBedrockProvider } from "./bedrockProvider";
import { createGeminiProvider } from "./geminiProvider";
import { createVertexProvider } from "./vertexProvider";
import type { LLMProvider, ProviderId } from "./provider";
import {
  isProviderKind,
  type ProviderKind,
} from "../../shared/modelSettings";
import { normalizeOllamaBaseUrl } from "./providerRegistry";

export interface ProviderSettings {
  providerId?: ProviderId;
  providerKind?: ProviderKind;
  apiKey: string;
  chatModel: string;
  baseUrl?: string;
  thinkingEnabled?: boolean;
  thinkingBudgetTokens?: number;
  connectionValues?: Record<string, string>;
  secrets?: Record<string, string>;
}

export interface ProviderDeps {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export function createProvider(
  settings: ProviderSettings,
  deps: ProviderDeps = {},
): LLMProvider {
  if (settings.providerKind === undefined) {
    switch (settings.providerId ?? "openai-compatible") {
      case "openai-compatible":
        return createOpenAICompatibleProvider({
          ...(deps.fetch ? { fetch: deps.fetch } : {}),
          ...(deps.timeoutMs ? { timeoutMs: deps.timeoutMs } : {}),
        });
    }
  }
  const kind = resolveProviderKind(settings);
  const values = settings.connectionValues ?? {};
  const secrets: Record<string, string | undefined> = {
    ...(settings.secrets ?? {}),
    ...(settings.apiKey ? { apiKey: settings.apiKey } : {}),
  };
  switch (kind) {
    case "anthropic":
      return createAnthropicProvider({
        ...(deps.fetch ? { fetch: deps.fetch } : {}),
        ...(deps.timeoutMs ? { timeoutMs: deps.timeoutMs } : {}),
        ...(settings.baseUrl ? { baseUrl: settings.baseUrl } : {}),
        apiKey: secrets.apiKey,
        model: settings.chatModel,
      });
    case "gemini":
      return createGeminiProvider({
        ...(deps.fetch ? { fetch: deps.fetch } : {}),
        ...(deps.timeoutMs ? { timeoutMs: deps.timeoutMs } : {}),
        ...(settings.baseUrl ? { baseUrl: settings.baseUrl } : {}),
        apiKey: secrets.apiKey,
        model: settings.chatModel,
      });
    case "bedrock":
      return createBedrockProvider({
        region: values.region || "us-east-1",
        authMethod: normalizeBedrockAuthMethod(values.authMethod),
        bedrockApiKey: secrets.bedrockApiKey,
        awsProfile: values.awsProfile,
        awsAccessKeyId: values.awsAccessKeyId,
        awsSecretAccessKey: secrets.awsSecretAccessKey,
        awsSessionToken: secrets.awsSessionToken,
      });
    case "vertex":
      return createVertexProvider({
        project: values.project ?? "",
        location: values.location || "global",
        authMethod: normalizeVertexAuthMethod(values.authMethod),
        serviceAccountJson: secrets.serviceAccountJson,
        apiKey: secrets.vertexApiKey,
        ...(deps.fetch ? { fetch: deps.fetch } : {}),
        ...(deps.timeoutMs ? { timeoutMs: deps.timeoutMs } : {}),
      });
    case "ollama":
      return withProviderId(
        createOpenAICompatibleProvider({
          ...(deps.fetch ? { fetch: deps.fetch } : {}),
          ...(deps.timeoutMs ? { timeoutMs: deps.timeoutMs } : {}),
        }),
        "ollama",
      );
    case "custom":
      if (values.protocol === "anthropic") {
        return withProviderId(
          createAnthropicProvider({
            ...(deps.fetch ? { fetch: deps.fetch } : {}),
            ...(deps.timeoutMs ? { timeoutMs: deps.timeoutMs } : {}),
            ...(settings.baseUrl
              ? { baseUrl: normalizeAnthropicBaseUrl(settings.baseUrl) }
              : {}),
            apiKey: secrets.apiKey,
            model: settings.chatModel,
          }),
          "custom",
        );
      }
      return withProviderId(
        createOpenAICompatibleProvider({
          ...(deps.fetch ? { fetch: deps.fetch } : {}),
          ...(deps.timeoutMs ? { timeoutMs: deps.timeoutMs } : {}),
        }),
        "custom",
      );
    case "openai":
    case "zai":
    case "deepseek":
    case "kimi":
    case "minimax":
    case "qwen":
    case "dashscope-coding":
    case "xai":
    case "mistral":
    case "meta":
    case "together":
    case "fireworks":
    case "openrouter":
      return withProviderId(
        createOpenAICompatibleProvider({
          ...(deps.fetch ? { fetch: deps.fetch } : {}),
          ...(deps.timeoutMs ? { timeoutMs: deps.timeoutMs } : {}),
        }),
        kind,
      );
  }
}

export function resolveProviderBaseUrl(
  kind: ProviderKind,
  values: Record<string, string>,
): string | undefined {
  if (kind === "ollama") {
    return normalizeOllamaBaseUrl(values.baseUrl);
  }
  if (kind === "custom" && values.protocol === "anthropic") {
    return normalizeAnthropicBaseUrl(values.baseUrl);
  }
  if (kind === "custom") {
    return normalizeOpenAiBaseUrl(values.baseUrl);
  }
  return values.baseUrl || undefined;
}

export function normalizeAnthropicBaseUrl(value: string | undefined): string {
  return (value?.trim() || "https://api.anthropic.com")
    .replace(/\/+$/, "")
    .replace(/\/v1\/messages$/, "")
    .replace(/\/v1$/, "");
}

export function normalizeOpenAiBaseUrl(value: string | undefined): string {
  return (value?.trim() || "")
    .replace(/\/+$/, "")
    .replace(/\/chat\/completions$/, "");
}

function resolveProviderKind(settings: ProviderSettings): ProviderKind {
  if (settings.providerKind) {
    if (isProviderKind(settings.providerKind)) {
      return settings.providerKind;
    }
    throw new Error(`未知模型服务商：${String(settings.providerKind)}`);
  }
  const legacy = String(settings.providerId ?? "openai-compatible").toLowerCase();
  if (legacy === "openai-compatible") {
    return "openai";
  }
  if (isProviderKind(legacy)) {
    return legacy;
  }
  throw new Error(`未知模型服务商：${legacy}`);
}

function withProviderId(provider: LLMProvider, id: ProviderId): LLMProvider {
  return {
    ...provider,
    id,
  };
}

function normalizeBedrockAuthMethod(
  value: string | undefined,
): "api_key" | "profile" | "iam" {
  return value === "profile" || value === "iam" ? value : "api_key";
}

function normalizeVertexAuthMethod(
  value: string | undefined,
): "adc" | "service_account" | "api_key" {
  return value === "service_account" || value === "api_key" ? value : "adc";
}
