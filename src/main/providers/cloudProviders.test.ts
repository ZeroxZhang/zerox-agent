import { ConverseCommand, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { CompleteRequest } from "./provider";
import {
  createBedrockProvider,
  enforceBedrockSdkResponseBudget,
} from "./bedrockProvider";
import { createProvider } from "./providerFactory";
import { createVertexProvider } from "./vertexProvider";
import { ResponseBodyLimitError } from "../fetchWithTimeout";
import { MODEL_RESPONSE_MAX_BODY_BYTES } from "../../shared/limits";

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
  it("rejects declared and chunked SDK bodies before deserialization", async () => {
    let declaredDestroyed = false;
    const declaredBody = {
      destroy() {
        declaredDestroyed = true;
      },
    };
    expect(() => enforceBedrockSdkResponseBudget({
      headers: {
        "Content-Length": String(MODEL_RESPONSE_MAX_BODY_BYTES + 1),
      },
      body: declaredBody,
    })).toThrow(ResponseBodyLimitError);
    expect(declaredDestroyed).toBe(true);

    let sourceClosed = false;
    const chunk = Buffer.alloc(1024 * 1024, 0x61);
    const body = Readable.from((async function* () {
      try {
        for (let index = 0; index < 33; index += 1) yield chunk;
      } finally {
        sourceClosed = true;
      }
    })());
    const response = { headers: {}, body: body as unknown };
    enforceBedrockSdkResponseBudget(response);

    const consume = async () => {
      for await (const _chunk of response.body as Readable) {
        // Smithy's deserializer consumes the bounded replacement body.
      }
    };
    await expect(consume()).rejects.toBeInstanceOf(ResponseBodyLimitError);
    expect(sourceClosed).toBe(true);
  });

  it("does not wait for a non-settling Web stream cancellation", async () => {
    const response = {
      headers: {},
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new Uint8Array(MODEL_RESPONSE_MAX_BODY_BYTES + 1),
          );
        },
        cancel() {
          return new Promise<void>(() => undefined);
        },
      }) as unknown,
    };
    enforceBedrockSdkResponseBudget(response);

    const read = async () => {
      const reader = (response.body as ReadableStream<Uint8Array>).getReader();
      await reader.read();
    };
    await expect(Promise.race([
      read(),
      new Promise<never>((_resolve, reject) => setTimeout(
        () => reject(new Error("Bedrock budget did not fail promptly")),
        250,
      )),
    ])).rejects.toBeInstanceOf(ResponseBodyLimitError);
  });

  it("rejects oversized Converse text, reasoning, and tool input", async () => {
    const oversized = "x".repeat(MODEL_RESPONSE_MAX_BODY_BYTES + 1);
    const responses = [
      { text: oversized },
      { reasoningContent: { reasoningText: { text: oversized } } },
      { toolUse: { toolUseId: "tool-1", name: "run", input: { value: oversized } } },
    ];
    for (const content of responses) {
      const provider = createBedrockProvider({
        region: "us-west-2",
        client: {
          send: async () => ({
            output: { message: { content: [content] } },
            stopReason: "end_turn",
          }),
        } as never,
      });
      await expect(provider.complete({
        ...request,
        model: "other/amazon.nova-2-pro-v1:0",
      })).rejects.toBeInstanceOf(ResponseBodyLimitError);
    }
  });

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

  it("clamps Claude thinking below max tokens and preserves reasoning separately", async () => {
    const send = vi.fn(async (command: unknown) => {
      expect(command).toBeInstanceOf(InvokeModelCommand);
      const input = (command as InvokeModelCommand).input;
      const body = JSON.parse(
        new TextDecoder().decode(input.body as Uint8Array),
      ) as Record<string, unknown>;
      expect(body.thinking).toEqual({
        type: "enabled",
        budget_tokens: 2047,
      });
      return {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [
              { type: "thinking", thinking: "private reasoning" },
              { type: "text", text: "Claude response" },
            ],
            stop_reason: "end_turn",
            usage: { input_tokens: 4, output_tokens: 20 },
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
        maxTokens: 2048,
        thinking: { type: "enabled", budgetTokens: 8192 },
        model: "claude/anthropic.claude-sonnet-4-6-v1:0",
      }),
    ).resolves.toMatchObject({
      content: "Claude response",
      reasoningContent: "private reasoning",
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

  it("surfaces Bedrock output limits through complete and stream", async () => {
    const send = vi.fn(async () => ({
      output: { message: { content: [{ text: "partial" }] } },
      stopReason: "max_tokens",
      usage: { inputTokens: 5, outputTokens: 512 },
    }));
    const provider = createBedrockProvider({
      region: "us-west-2",
      client: { send } as never,
    });
    const limitedRequest = {
      ...request,
      model: "other/amazon.nova-2-pro-v1:0",
    };

    await expect(provider.complete(limitedRequest)).resolves.toMatchObject({
      content: "partial",
      finishReason: "max_tokens",
      modelServiceNotice: {
        kind: "output_limit",
        provider: "bedrock",
      },
    });

    const events = [];
    for await (const event of provider.stream(limitedRequest)) {
      events.push(event);
    }
    expect(events.at(-1)).toMatchObject({
      type: "done",
      response: {
        finishReason: "max_tokens",
        modelServiceNotice: { kind: "output_limit" },
      },
    });
  });

  it("times out a Bedrock SDK call even when the client ignores abort", async () => {
    const provider = createBedrockProvider({
      region: "us-east-1",
      timeoutMs: 5,
      client: { send: () => new Promise(() => undefined) } as never,
    });
    await expect(provider.complete({
      ...request,
      model: "other/amazon.nova-2-pro-v1:0",
    })).rejects.toThrow("Bedrock request timed out after 5ms");
  });
});

describe("Vertex provider", () => {
  it("rejects an oversized successful HTTP body before JSON parsing", async () => {
    const provider = createVertexProvider({
      project: "project",
      location: "global",
      authMethod: "api_key",
      apiKey: "k",
      fetch: (async () => new Response("{}", {
        status: 200,
        headers: {
          "content-length": String(MODEL_RESPONSE_MAX_BODY_BYTES + 1),
        },
      })) as typeof fetch,
    });

    await expect(provider.complete({
      ...request,
      model: "gemini/gemini-3.6-flash",
    })).rejects.toBeInstanceOf(ResponseBodyLimitError);
  });

  it("times out access-token acquisition before starting the HTTP request", async () => {
    const fetchMock = vi.fn();
    const provider = createVertexProvider({
      project: "project",
      location: "global",
      timeoutMs: 5,
      getAccessToken: () => new Promise(() => undefined),
      fetch: fetchMock as typeof fetch,
    });
    await expect(provider.complete({
      ...request,
      model: "gemini/gemini-3.6-flash",
    })).rejects.toThrow("Vertex authentication timed out after 5ms");
    expect(fetchMock).not.toHaveBeenCalled();
  });

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
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 512,
          thinkingConfig: {
            thinkingLevel: "minimal",
            includeThoughts: false,
          },
        },
      });
      expect(body).not.toHaveProperty("thinkingConfig");
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  { text: "private reasoning", thought: true },
                  { text: "Gemini response" },
                ],
              },
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
        thinking: { type: "disabled" },
      }),
    ).resolves.toMatchObject({
      content: "Gemini response",
      reasoningContent: "private reasoning",
      usage: { inputTokens: 7, outputTokens: 4 },
    });
  });

  it("surfaces Vertex MAX_TOKENS through complete and stream", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: { parts: [{ text: "partial" }] },
              finishReason: "MAX_TOKENS",
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const provider = createVertexProvider({
      project: "project",
      location: "global",
      authMethod: "api_key",
      apiKey: "vertex-key",
      fetch: fetchMock as typeof fetch,
    });
    const limitedRequest = {
      ...request,
      model: "gemini/gemini-3.6-flash",
    };

    await expect(provider.complete(limitedRequest)).resolves.toMatchObject({
      content: "partial",
      finishReason: "MAX_TOKENS",
      modelServiceNotice: {
        kind: "output_limit",
        provider: "vertex",
      },
    });

    const events = [];
    for await (const event of provider.stream(limitedRequest)) {
      events.push(event);
    }
    expect(events.at(-1)).toMatchObject({
      type: "done",
      response: {
        finishReason: "MAX_TOKENS",
        modelServiceNotice: { kind: "output_limit" },
      },
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
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.thinking).toEqual({
        type: "enabled",
        budget_tokens: 2047,
      });
      return new Response(
        JSON.stringify({
          content: [
            { type: "thinking", thinking: "private reasoning" },
            { type: "text", text: "Vertex Claude" },
          ],
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
        maxTokens: 2048,
        model: "claude/claude-sonnet-4-6",
        thinking: { type: "enabled", budgetTokens: 8192 },
      }),
    ).resolves.toMatchObject({
      content: "Vertex Claude",
      reasoningContent: "private reasoning",
    });
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
