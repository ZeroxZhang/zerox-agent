import { describe, expect, it } from "vitest";
import { providerKinds } from "../../shared/modelSettings";
import {
  capabilitiesForModel,
  listModelCatalogEntries,
  modelsForProvider,
} from "./modelMatrix";

describe("curated model matrix", () => {
  it("uses stable provider:model display identifiers with no duplicates", () => {
    const entries = listModelCatalogEntries();
    expect(new Set(entries.map((entry) => entry.routedModelId)).size).toBe(
      entries.length,
    );
    for (const entry of entries) {
      expect(entry.routedModelId).toBe(
        `${entry.providerKind}:${entry.modelId}`,
      );
      expect(entry.verified).toBe(true);
      expect(entry.capabilities.streaming).toBe(true);
    }
  });

  it("covers every configured provider with at least one curated model", () => {
    for (const kind of providerKinds) {
      expect(modelsForProvider(kind).length, kind).toBeGreaterThan(0);
    }
  });

  it("matches the complete curated OpenWorker f96ad4c8 model surface", () => {
    const routedIds = new Set(
      listModelCatalogEntries().map((entry) => entry.routedModelId),
    );
    for (const routedId of [
      "openai:gpt-5.6-luna",
      "anthropic:claude-opus-4-8",
      "anthropic:claude-haiku-4-5",
      "gemini:gemini-2.5-pro",
      "gemini:gemini-2.5-flash",
      "together:moonshotai/Kimi-K2.7-Code",
      "together:deepseek-ai/DeepSeek-V4-Pro",
      "together:meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
      "fireworks:accounts/fireworks/models/deepseek-v4-pro",
      "fireworks:accounts/fireworks/models/llama4-maverick-instruct-basic",
      "openrouter:deepseek/deepseek-v4-pro",
      "openrouter:meta-llama/llama-4-maverick",
      "bedrock:claude/anthropic.claude-haiku-4-5-v1:0",
      "bedrock:other/mistral.mistral-large-3-v1:0",
      "bedrock:other/nvidia.nemotron-super-3-120b",
      "vertex:gemini/gemini-3.1-pro-preview",
      "vertex:claude/claude-haiku-4-5",
      "vertex:openweight/meta/llama-4-maverick-17b-128e-instruct-maas",
    ]) {
      expect(routedIds.has(routedId), routedId).toBe(true);
    }
    expect(
      capabilitiesForModel("meta", "muse-spark-1.1"),
    ).toMatchObject({ vision: true, pdf: false });
    expect(
      capabilitiesForModel(
        "bedrock",
        "other/nvidia.nemotron-super-3-120b",
      ),
    ).toMatchObject({ parallelToolCalls: false });
  });

  it("uses conservative capabilities for custom model ids", () => {
    expect(capabilitiesForModel("openai", "private-unknown-model")).toEqual({
      tools: false,
      vision: false,
      pdf: false,
      streaming: true,
      parallelToolCalls: false,
    });
  });
});
