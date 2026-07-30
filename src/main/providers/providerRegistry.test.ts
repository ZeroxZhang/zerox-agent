import { describe, expect, it } from "vitest";
import { providerKinds } from "../../shared/modelSettings";
import {
  listProviderDescriptors,
  normalizeOllamaBaseUrl,
  requireProviderDescriptor,
  validateProviderFields,
} from "./providerRegistry";

describe("provider descriptor registry", () => {
  it("registers every 3.8.0 provider exactly once", () => {
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
});
