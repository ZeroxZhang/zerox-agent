import { describe, expect, it } from "vitest";
import { providerKinds } from "../../shared/modelSettings";
import {
  listProviderDescriptors,
  normalizeOllamaBaseUrl,
  providerSupportsEmbeddings,
  requireProviderDescriptor,
  validateProviderFields,
} from "./providerRegistry";
import {
  normalizeAnthropicBaseUrl,
  normalizeOpenAiBaseUrl,
} from "./providerFactory";

describe("provider descriptor registry", () => {
  it("registers every 3.8.1 provider exactly once", () => {
    const descriptors = listProviderDescriptors();
    expect(descriptors.map((descriptor) => descriptor.kind).sort()).toEqual(
      [...providerKinds].sort(),
    );
    expect(new Set(descriptors.map((descriptor) => descriptor.kind)).size).toBe(
      providerKinds.length,
    );
    expect(
      descriptors.every(
        (descriptor) =>
          descriptor.title &&
          descriptor.description &&
          Array.isArray(descriptor.fields),
      ),
    ).toBe(true);
  });

  it("describes conditional Bedrock and Vertex credentials without renderer secrets", () => {
    const bedrock = requireProviderDescriptor("bedrock");
    const vertex = requireProviderDescriptor("vertex");
    expect(
      bedrock.fields.find((field) => field.key === "awsSecretAccessKey"),
    ).toMatchObject({
      secret: true,
      showWhen: { authMethod: "iam" },
    });
    expect(
      vertex.fields.find((field) => field.key === "serviceAccountJson"),
    ).toMatchObject({
      secret: true,
      showWhen: { authMethod: "service_account" },
    });
  });

  it("validates visible required fields while allowing an existing secret", () => {
    const deepseek = requireProviderDescriptor("deepseek");
    expect(
      validateProviderFields(deepseek, {
        baseUrl: "https://api.deepseek.com",
      }),
    ).toMatchObject({ apiKey: expect.any(String) });
    expect(
      validateProviderFields(
        deepseek,
        { baseUrl: "https://api.deepseek.com" },
        { hasStoredSecret: true },
      ),
    ).toEqual({});
  });

  it("rejects unknown providers instead of falling back to OpenAI", () => {
    expect(() => requireProviderDescriptor("unknown-provider")).toThrow(
      /未知模型服务商/,
    );
  });

  it("normalizes Ollama endpoints to one /v1 suffix", () => {
    expect(normalizeOllamaBaseUrl("http://localhost:11434")).toBe(
      "http://localhost:11434/v1",
    );
    expect(normalizeOllamaBaseUrl("http://localhost:11434/v1/")).toBe(
      "http://localhost:11434/v1",
    );
  });

  it("registers Coding Plan separately from regular DashScope", () => {
    expect(requireProviderDescriptor("dashscope-coding")).toMatchObject({
      environmentKey: "DASHSCOPE_CODING_API_KEY",
      recommendedModel: "qwen3.7-plus",
    });
    expect(
      requireProviderDescriptor("dashscope-coding").fields.find(
        (field) => field.key === "baseUrl",
      ),
    ).toMatchObject({
      defaultValue: "https://coding.dashscope.aliyuncs.com/v1",
    });
  });

  it("requires an explicit protocol, base URL, key, and model for custom providers", () => {
    const custom = requireProviderDescriptor("custom");
    expect(custom.fields.map((field) => field.key)).toEqual([
      "protocol",
      "apiKey",
      "baseUrl",
      "modelId",
    ]);
    expect(custom.fields.find((field) => field.key === "protocol")?.choices)
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({ value: "openai" }),
          expect.objectContaining({ value: "anthropic" }),
        ]),
      );
  });

  it("accepts either a custom protocol base URL or its full completion endpoint", () => {
    expect(
      normalizeOpenAiBaseUrl(
        "https://gateway.example/v1/chat/completions/",
      ),
    ).toBe("https://gateway.example/v1");
    expect(
      normalizeAnthropicBaseUrl(
        "https://gateway.example/v1/messages/",
      ),
    ).toBe("https://gateway.example");
  });

  it("only advertises embedding paths implemented by the runtime", () => {
    expect(providerSupportsEmbeddings("openai", {})).toBe(true);
    expect(providerSupportsEmbeddings("ollama", {})).toBe(true);
    expect(
      providerSupportsEmbeddings("custom", { protocol: "openai" }),
    ).toBe(true);
    expect(
      providerSupportsEmbeddings("custom", { protocol: "anthropic" }),
    ).toBe(false);
    expect(providerSupportsEmbeddings("anthropic", {})).toBe(false);
    expect(providerSupportsEmbeddings("gemini", {})).toBe(false);
  });
});
