import { ConverseCommand, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { describe, expect, it, vi } from "vitest";
import type { CompleteRequest } from "./provider";
import { createBedrockProvider } from "./bedrockProvider";
import { createProvider } from "./providerFactory";
import { createVertexProvider } from "./vertexProvider";

const request: CompleteRequest = {
  baseUrl: "",
  apiKey: "",
  model: "",
  temperature: 0.2,
  maxTokens: 512,
  messages: [
    { role: "system", content: "System" },
    {
      role: "user",
      content: [{ type: "text", text: "Hello" }],
    },
  ],
};

describe("Bedrock provider", () => {
  it("routes Claude through Anthropic InvokeModel and strips the family prefix", async () => {
    const send = vi.fn(async (command: unknown) => {
      expect(command).toBeInstanceOf(InvokeModelCommand);
      expect((command as InvokeModelCommand).input.modelId).toBe(
        "anthropic.claude-sonnet-4-6-v1:0",
      );
      return {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [{ type: "text", text: "Claude response" }],
            stop_reason: "end_turn",
            usage: { input_tokens: 4, output_tokens: 2 },
          }),
        ),
      };
    });
    const provider = createBedrockProvider({
      region: "us-east-1",
      client: { send } as never,
    });

    await expect(
      provider.complete({
        ...request,
        model: "claude/anthropic.claude-sonnet-4-6-v1:0",
      }),
    ).resolves.toMatchObject({
      content: "Claude response",
      usage: { inputTokens: 4, outputTokens: 2 },
    });
  });

  it("routes non-Claude families through Converse", async () => {
    const send = vi.fn(async (command: unknown) => {
      expect(command).toBeInstanceOf(ConverseCommand);
      expect((command as ConverseCommand).input.modelId).toBe(
        "amazon.nova-2-pro-v1:0",
      );
      return {
        output: { message: { content: [{ text: "Nova response" }] } },
        stopReason: "end_turn",
        usage: { inputTokens: 5, outputTokens: 3 },
      };
    });
    const provider = createBedrockProvider({
      region: "us-west-2",
      client: { send } as never,
    });
    await expect(
      provider.complete({
        ...request,
        model: "other/amazon.nova-2-pro-v1:0",
      }),
    ).resolves.toMatchObject({
      content: "Nova response",
      usage: { inputTokens: 5, outputTokens: 3 },
    });
  });
});

describe("Vertex provider", () => {
  it("uses the global Gemini path and API key without a bearer token", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain("https://aiplatform.googleapis.com/v1/");
      expect(url).toContain(
        "publishers/google/models/gemini-3.6-flash:generateContent",
      );
      expect(url).not.toContain("vertex-key");
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBeNull();
      expect(headers.get("x-goog-api-key")).toBe("vertex-key");
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: { parts: [{ text: "Gemini response" }] },
              finishReason: "STOP",
            },
          ],
          usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 4 },
        }),
        { status: 200 },
      );
    });
    const provider = createVertexProvider({
      project: "project",
      location: "global",
      authMethod: "api_key",
      apiKey: "vertex-key",
      fetch: fetchMock as typeof fetch,
    });
    await expect(
      provider.complete({
        ...request,
        model: "gemini/gemini-3.6-flash",
      }),
    ).resolves.toMatchObject({
      content: "Gemini response",
      usage: { inputTokens: 7, outputTokens: 4 },
    });
  });

  it("routes Claude to rawPredict with an ADC bearer token", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain(
        "publishers/anthropic/models/claude-sonnet-4-6:rawPredict",
      );
      expect((init?.headers as Record<string, string>).authorization).toBe(
        "Bearer adc-token",
      );
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: "Vertex Claude" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 3, output_tokens: 2 },
        }),
        { status: 200 },
      );
    });
    const provider = createVertexProvider({
      project: "project",
      location: "us-east5",
      getAccessToken: async () => "adc-token",
      fetch: fetchMock as typeof fetch,
    });
    await expect(
      provider.complete({
        ...request,
        model: "claude/claude-sonnet-4-6",
      }),
    ).resolves.toMatchObject({ content: "Vertex Claude" });
  });
});

describe("provider factory", () => {
  it("routes every OpenAI-compatible preset under its own provider identity", () => {
    for (const providerKind of [
      "openai",
      "zai",
      "deepseek",
      "kimi",
      "minimax",
      "qwen",
      "xai",
      "mistral",
      "meta",
      "together",
      "fireworks",
      "openrouter",
      "ollama",
    ] as const) {
      expect(
        createProvider({
          providerKind,
          apiKey: "provider-specific-key",
          chatModel: "model",
        }).id,
      ).toBe(providerKind);
    }
  });

  it("fails closed for an unregistered provider", () => {
    expect(() =>
      createProvider({
        providerKind: "unknown" as never,
        apiKey: "secret",
        chatModel: "model",
      }),
    ).toThrow(/未知模型服务商/);
  });
});
