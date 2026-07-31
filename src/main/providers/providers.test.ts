import { describe, expect, it } from "vitest";
import { toNormalized, fromNormalized } from "./normalize";
import { buildCachePrefix, serializeCachePrefix } from "./cachePrefix";
import { createProvider } from "./providerFactory";
import { createProviderChatClient, createSettingsBackedChatClient } from "./providerChatClient";
import { createOpenAICompatibleProvider } from "./openAiCompatibleProvider";
import type { ChatMessage, ChatCompletionRequest } from "../openAiCompatibleClient";
import type { CompleteRequest, LLMProvider, NormalizedMessage, StreamEvent } from "./provider";
import type {
  ProviderKind,
  PublicModelSettings,
} from "../../shared/modelSettings";

describe("normalize round-trip", () => {
  it("preserves user image content across provider normalization", () => {
    const messages: ChatMessage[] = [
      {
        role: "user",
        content: "inspect",
        images: [{ mediaType: "image/webp", data: "d2VicA==" }],
      },
    ];
    const normalized = toNormalized(messages);
    expect(normalized[0]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "inspect" },
        { type: "image", mediaType: "image/webp", data: "d2VicA==" },
      ],
    });
    expect(fromNormalized(normalized)).toEqual(messages);
  });

  it("preserves system / user / assistant-with-tools / tool messages", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "You are an agent." },
      { role: "user", content: "List files." },
      { role: "assistant", content: "", tool_calls: [{ id: "call_1", type: "function", function: { name: "file_read", arguments: "{\"path\":\"/a\"}" } }] },
      { role: "tool", tool_call_id: "call_1", content: "file contents" },
      { role: "assistant", content: "Done." },
    ];
    const normalized = toNormalized(messages);
    expect(normalized[0]).toMatchObject({ role: "system", content: "You are an agent." });
    expect(normalized[2]).toMatchObject({ role: "assistant" });
    expect((normalized[2] as { toolCalls?: unknown }).toolCalls).toHaveLength(1);
    // Round-trip back to ChatMessage shape.
    const back = fromNormalized(normalized);
    expect(back.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool", "assistant"]);
    expect(back[2].tool_calls?.[0].function.name).toBe("file_read");
    expect(back[3].tool_call_id).toBe("call_1");
  });
});

describe("buildCachePrefix", () => {
  it("is a pure, byte-stable function", () => {
    const messages: NormalizedMessage[] = [
      { role: "system", content: "s" },
      { role: "user", content: [{ type: "text", text: "hello" }] },
      { role: "user", content: [{ type: "text", text: "world" }] },
    ];
    const a = buildCachePrefix(messages, { system: "s", tools: [], watermark: 2 });
    const b = buildCachePrefix(messages, { system: "s", tools: [], watermark: 2 });
    expect(serializeCachePrefix(a)).toBe(serializeCachePrefix(b));
    expect(a.watermark).toBe(2);
    expect(a.messages).toHaveLength(2);
  });

  it("watermark defaults to the full message list", () => {
    const messages: NormalizedMessage[] = [
      { role: "user", content: [{ type: "text", text: "a" }] },
      { role: "user", content: [{ type: "text", text: "b" }] },
    ];
    expect(buildCachePrefix(messages).messages).toHaveLength(2);
  });
});

describe("providerFactory", () => {
  it("dispatches by providerId and defaults to openai-compatible", () => {
    const oa = createProvider({ providerId: "openai-compatible", apiKey: "k", chatModel: "m" });
    const an = createProvider({ providerId: "anthropic", apiKey: "k", chatModel: "claude-3" });
    const ge = createProvider({ providerId: "gemini", apiKey: "k", chatModel: "gemini-1.5" });
    const def = createProvider({ apiKey: "k", chatModel: "m" });
    expect(oa.id).toBe("openai-compatible");
    expect(an.id).toBe("anthropic");
    expect(ge.id).toBe("gemini");
    expect(def.id).toBe("openai-compatible");
    expect(an.capabilities.promptCache).toBe(true);
    expect(an.capabilities.thinking).toBe(true);
    expect(oa.capabilities.promptCache).toBe(false);
  });

  it("routes custom providers through the selected official protocol shape", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      requests.push({ url: String(input), init });
      const isAnthropic = String(input).endsWith("/v1/messages");
      return new Response(
        JSON.stringify(
          isAnthropic
            ? {
                content: [{ type: "text", text: "OK" }],
                stop_reason: "end_turn",
                usage: { input_tokens: 1, output_tokens: 1 },
              }
            : {
                choices: [
                  {
                    message: { content: "OK" },
                    finish_reason: "stop",
                  },
                ],
              },
        ),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    const request = {
      model: "private-model",
      apiKey: "private-key",
      temperature: 0,
      maxTokens: 16,
      messages: [
        { role: "user" as const, content: [{ type: "text" as const, text: "hi" }] },
      ],
    };

    await createProvider(
      {
        providerKind: "custom",
        connectionValues: { protocol: "openai" },
        apiKey: "private-key",
        chatModel: "private-model",
      },
      { fetch: fetchImpl },
    ).complete({
      ...request,
      baseUrl: "https://openai-gateway.example/v1",
    });
    await createProvider(
      {
        providerKind: "custom",
        connectionValues: { protocol: "anthropic" },
        baseUrl: "https://anthropic-gateway.example/v1",
        apiKey: "private-key",
        chatModel: "private-model",
      },
      { fetch: fetchImpl },
    ).complete(request);

    expect(requests[0]?.url).toBe(
      "https://openai-gateway.example/v1/chat/completions",
    );
    expect(new Headers(requests[0]?.init?.headers).get("authorization")).toBe(
      "Bearer private-key",
    );
    expect(requests[1]?.url).toBe(
      "https://anthropic-gateway.example/v1/messages",
    );
    expect(new Headers(requests[1]?.init?.headers).get("x-api-key")).toBe(
      "private-key",
    );
    expect(
      new Headers(requests[1]?.init?.headers).get("anthropic-version"),
    ).toBe("2023-06-01");
  });

  it("maps semantic thinking controls to documented provider-specific fields", async () => {
    const cases: Array<{
      providerKind: ProviderKind;
      model?: string;
      expected: Record<string, unknown>;
      absent: string[];
    }> = [
      {
        providerKind: "deepseek",
        expected: { thinking: { type: "disabled" } },
        absent: ["enable_thinking", "reasoning", "reasoning_effort"],
      },
      {
        providerKind: "zai",
        expected: { thinking: { type: "disabled" } },
        absent: ["enable_thinking", "reasoning", "reasoning_effort"],
      },
      {
        providerKind: "kimi",
        expected: { thinking: { type: "disabled" } },
        absent: ["enable_thinking", "reasoning", "reasoning_effort"],
      },
      {
        providerKind: "qwen",
        expected: { enable_thinking: false },
        absent: ["thinking", "reasoning", "reasoning_effort"],
      },
      {
        providerKind: "dashscope-coding",
        expected: { enable_thinking: false },
        absent: ["thinking", "reasoning", "reasoning_effort"],
      },
      {
        providerKind: "openrouter",
        expected: { reasoning: { effort: "none" } },
        absent: ["thinking", "enable_thinking", "reasoning_effort"],
      },
      {
        providerKind: "openai",
        model: "gpt-5.6-sol",
        expected: { reasoning_effort: "none" },
        absent: ["thinking", "enable_thinking", "reasoning"],
      },
      {
        providerKind: "xai",
        model: "grok-4.3",
        expected: { reasoning_effort: "none" },
        absent: ["thinking", "enable_thinking", "reasoning"],
      },
      {
        providerKind: "openai",
        model: "gpt-4o",
        expected: {},
        absent: [
          "thinking",
          "enable_thinking",
          "reasoning",
          "reasoning_effort",
        ],
      },
      {
        providerKind: "custom",
        expected: {},
        absent: [
          "thinking",
          "enable_thinking",
          "reasoning",
          "reasoning_effort",
        ],
      },
      {
        providerKind: "minimax",
        expected: {},
        absent: [
          "thinking",
          "enable_thinking",
          "reasoning",
          "reasoning_effort",
        ],
      },
    ];

    for (const candidate of cases) {
      let body: Record<string, unknown> = {};
      const provider = createProvider(
        {
          providerKind: candidate.providerKind,
          apiKey: "key",
          chatModel: candidate.model ?? "model",
          ...(candidate.providerKind === "custom"
            ? { connectionValues: { protocol: "openai" } }
            : {}),
        },
        {
          fetch: (async (_url, init) => {
            body = JSON.parse(String(init?.body)) as Record<string, unknown>;
            return new Response(
              JSON.stringify({
                choices: [
                  { message: { content: "OK" }, finish_reason: "stop" },
                ],
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              },
            );
          }) as typeof fetch,
        },
      );

      await provider.complete({
        model: candidate.model ?? "model",
        apiKey: "key",
        baseUrl: "https://provider.example/v1",
        temperature: 0,
        maxTokens: 128,
        messages: [
          { role: "user", content: [{ type: "text", text: "hi" }] },
        ],
        thinking: { type: "disabled" },
      });

      expect(body).toMatchObject(candidate.expected);
      for (const field of candidate.absent) {
        expect(body).not.toHaveProperty(field);
      }
    }
  });
});

function mockFetch(
  response: unknown,
  status = 200,
  responseHeaders: Record<string, string> = {},
): typeof fetch {
  return (async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(responseHeaders),
    text: async () => (typeof response === "string" ? response : JSON.stringify(response)),
    json: async () => response,
    body: null,
  })) as unknown as typeof fetch;
}

function neverSettlingFetch(): typeof fetch {
  return (() => new Promise<Response>(() => {
    // Intentionally unresolved: provider timeout must settle the call.
  })) as unknown as typeof fetch;
}

function abortAwareNeverSettlingFetch(): typeof fetch {
  return ((_, init?: RequestInit) => new Promise<Response>((_, reject) => {
    const signal = init?.signal;
    const abort = () => {
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
  })) as unknown as typeof fetch;
}

async function expectRejectsBefore(
  promise: Promise<unknown>,
  timeoutMs: number,
  messagePattern: RegExp,
): Promise<void> {
  const outcome = await Promise.race([
    promise.then(
      () => ({ type: "resolved" as const }),
      (error) => ({ type: "rejected" as const, error }),
    ),
    new Promise<{ type: "pending" }>((resolve) => {
      setTimeout(() => resolve({ type: "pending" }), timeoutMs);
    }),
  ]);

  expect(outcome.type).toBe("rejected");
  if (outcome.type !== "rejected") {
    return;
  }
  expect(outcome.error).toBeInstanceOf(Error);
  expect((outcome.error as Error).message).toMatch(messagePattern);
}

describe("AnthropicProvider", () => {
  it("parses a native Messages response into CompleteResponse", async () => {
    const provider = createProvider(
      { providerId: "anthropic", apiKey: "k", chatModel: "claude-3-5-sonnet" },
      { fetch: mockFetch({ content: [{ type: "text", text: "Hello" }, { type: "tool_use", id: "tu1", name: "file_read", input: { path: "/a" } }], stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 } }) },
    );
    const res = await provider.complete({
      model: "claude-3-5-sonnet", apiKey: "k", temperature: 0, maxTokens: 100,
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    });
    expect(res.content).toBe("Hello");
    expect(res.toolCalls[0].function.name).toBe("file_read");
    expect(res.finishReason).toBe("tool_use");
    expect(res.cacheReadTokens).toBe(3);
    expect(res.cacheWriteTokens).toBe(2);
  });

  it("surfaces Anthropic max_tokens as an output-limit notice", async () => {
    const provider = createProvider(
      { providerId: "anthropic", apiKey: "k", chatModel: "claude-3-5-sonnet" },
      {
        fetch: mockFetch({
          content: [{ type: "text", text: "partial" }],
          stop_reason: "max_tokens",
          usage: { input_tokens: 10, output_tokens: 100 },
        }),
      },
    );

    await expect(
      provider.complete({
        model: "claude-3-5-sonnet",
        apiKey: "k",
        temperature: 0,
        maxTokens: 100,
        messages: [
          { role: "user", content: [{ type: "text", text: "hi" }] },
        ],
      }),
    ).resolves.toMatchObject({
      content: "partial",
      finishReason: "max_tokens",
      modelServiceNotice: {
        kind: "output_limit",
        provider: "anthropic",
        model: "claude-3-5-sonnet",
      },
    });
  });

  it("preserves native streaming tool ids, names, indexes, and arguments", async () => {
    const encoder = new TextEncoder();
    const provider = createProvider(
      { providerId: "anthropic", apiKey: "k", chatModel: "claude-sonnet-4-6" },
      {
        fetch: (async () => new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              const events = [
                {
                  type: "content_block_start",
                  index: 1,
                  content_block: {
                    type: "tool_use",
                    id: "toolu_real_1",
                    name: "file_read",
                    input: {},
                  },
                },
                {
                  type: "content_block_delta",
                  index: 1,
                  delta: { type: "input_json_delta", partial_json: '{"path":' },
                },
                {
                  type: "content_block_delta",
                  index: 1,
                  delta: { type: "input_json_delta", partial_json: '"/safe"}' },
                },
                {
                  type: "message_delta",
                  delta: { stop_reason: "tool_use" },
                },
                { type: "message_stop" },
              ];
              controller.enqueue(
                encoder.encode(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")),
              );
              controller.close();
            },
          }),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        )) as typeof fetch,
      },
    );
    const client = createProviderChatClient({ provider });
    const events = [];

    for await (const event of client.streamComplete({
      baseUrl: "",
      apiKey: "k",
      model: "claude-sonnet-4-6",
      temperature: 0,
      maxTokens: 100,
      messages: [{ role: "user", content: "read" }],
      tools: [{
        type: "function",
        function: {
          name: "file_read",
          description: "Read a file",
          parameters: { type: "object", properties: {} },
        },
      }],
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        type: "tool_call_delta",
        id: "toolu_real_1",
        index: 1,
        name: "file_read",
        arguments: "",
      },
      {
        type: "tool_call_delta",
        id: "toolu_real_1",
        index: 1,
        name: "file_read",
        arguments: '{"path":',
      },
      {
        type: "tool_call_delta",
        id: "toolu_real_1",
        index: 1,
        name: "file_read",
        arguments: '"/safe"}',
      },
      { type: "done", finishReason: "tool_use" },
    ]);
  });

  it("applies the same bounded thinking configuration to complete and stream requests", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const encoder = new TextEncoder();
    const provider = createProvider(
      {
        providerId: "anthropic",
        apiKey: "k",
        chatModel: "claude-sonnet-4-6",
      },
      {
        fetch: (async (_url, init) => {
          const body = JSON.parse(
            String(init?.body),
          ) as Record<string, unknown>;
          bodies.push(body);
          if (body.stream === true) {
            return new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({
                        type: "message_delta",
                        delta: { stop_reason: "end_turn" },
                      })}\n\n`,
                    ),
                  );
                  controller.close();
                },
              }),
              {
                status: 200,
                headers: { "content-type": "text/event-stream" },
              },
            );
          }
          return new Response(
            JSON.stringify({
              content: [{ type: "text", text: "OK" }],
              stop_reason: "end_turn",
              usage: { input_tokens: 1, output_tokens: 1 },
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }) as typeof fetch,
      },
    );
    const req: CompleteRequest = {
      model: "claude-sonnet-4-6",
      apiKey: "k",
      temperature: 0,
      maxTokens: 4096,
      messages: [
        { role: "user", content: [{ type: "text", text: "hi" }] },
      ],
      thinking: { type: "enabled", budgetTokens: 8192 },
    };

    await provider.complete(req);
    for await (const _event of provider.stream(req)) {
      // Drain the stream so the request body is exercised.
    }

    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toMatchObject({
      thinking: { type: "enabled", budget_tokens: 4095 },
    });
    expect(bodies[1]).toMatchObject({
      stream: true,
      thinking: { type: "enabled", budget_tokens: 4095 },
    });
  });

  it("normalizes errors to an HTTP status without retaining the response body", async () => {
    const provider = createProvider(
      { providerId: "anthropic", apiKey: "k", chatModel: "claude-3" },
      { fetch: mockFetch({ error: "overloaded" }, 529) },
    );
    await expect(
      provider.complete({ model: "claude-3", apiKey: "k", temperature: 0, maxTokens: 10, messages: [{ role: "user", content: [{ type: "text", text: "x" }] }] }),
    ).rejects.toThrow(/HTTP 529/);
  });

  it("exposes only structured retry metadata for an HTTP failure", async () => {
    const provider = createProvider(
      { providerId: "anthropic", apiKey: "k", chatModel: "claude-3" },
      {
        fetch: mockFetch(
          { error: "provider-body-secret" },
          429,
          { "retry-after": "45", "x-provider-secret": "do-not-copy" },
        ),
      },
    );

    const error = await provider.complete({
      model: "claude-3",
      apiKey: "k",
      temperature: 0,
      maxTokens: 10,
      messages: [{ role: "user", content: [{ type: "text", text: "x" }] }],
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      status: 429,
      statusCode: 429,
      responseHeaders: { "retry-after": "30" },
    });
    expect((error as Error).message).toBe("HTTP 429");
    expect(JSON.stringify(error)).not.toMatch(/provider-body-secret|do-not-copy/);
  });

  it("times out a fetch that never settles", async () => {
    const provider = createProvider(
      { providerId: "anthropic", apiKey: "k", chatModel: "claude-3" },
      { fetch: neverSettlingFetch(), timeoutMs: 5 },
    );

    await expectRejectsBefore(
      provider.complete({
        model: "claude-3",
        apiKey: "k",
        temperature: 0,
        maxTokens: 10,
        messages: [{ role: "user", content: [{ type: "text", text: "x" }] }],
      }),
      50,
      /Anthropic request timed out after 5 ms/,
    );
  });

  it("surfaces local timeout instead of AbortError when fetch rejects on abort", async () => {
    const provider = createProvider(
      { providerId: "anthropic", apiKey: "k", chatModel: "claude-3" },
      { fetch: abortAwareNeverSettlingFetch(), timeoutMs: 5 },
    );

    await expectRejectsBefore(
      provider.complete({
        model: "claude-3",
        apiKey: "k",
        temperature: 0,
        maxTokens: 10,
        messages: [{ role: "user", content: [{ type: "text", text: "x" }] }],
      }),
      50,
      /Anthropic request timed out after 5 ms/,
    );
  });

  it("surfaces external abort semantics instead of local timeout", async () => {
    const controller = new AbortController();
    const provider = createProvider(
      { providerId: "anthropic", apiKey: "k", chatModel: "claude-3" },
      { fetch: abortAwareNeverSettlingFetch(), timeoutMs: 1000 },
    );

    const completion = provider.complete({
      model: "claude-3",
      apiKey: "k",
      temperature: 0,
      maxTokens: 10,
      messages: [{ role: "user", content: [{ type: "text", text: "x" }] }],
      signal: controller.signal,
    });
    controller.abort();

    await expect(completion).rejects.toThrow(/abort/i);
    await expect(completion).rejects.not.toThrow(/timed out/i);
  });

  it("countTokens falls back to heuristic without credentials", async () => {
    const provider = createProvider({ providerId: "anthropic", apiKey: "", chatModel: "" }, { fetch: mockFetch({}) });
    const n = await provider.countTokens([{ role: "user", content: [{ type: "text", text: "hello world" }] }]);
    expect(n).toBeGreaterThan(0);
  });
});

describe("GeminiProvider", () => {
  it("parses a native generateContent response", async () => {
    const provider = createProvider(
      { providerId: "gemini", apiKey: "k", chatModel: "gemini-1.5-pro" },
      { fetch: mockFetch({ candidates: [{ content: { parts: [{ text: "Hi" }, { functionCall: { name: "file_read", args: { path: "/a" } } }], role: "model" }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 3, cachedContentTokenCount: 4 } }) },
    );
    const res = await provider.complete({
      model: "gemini-1.5-pro", apiKey: "k", temperature: 0, maxTokens: 100,
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    });
    expect(res.content).toBe("Hi");
    expect(res.toolCalls[0].function.name).toBe("file_read");
    expect(res.cacheReadTokens).toBe(4);
  });

  it("assigns unique ids to parallel calls of the same function", async () => {
    const provider = createProvider(
      { providerId: "gemini", apiKey: "k", chatModel: "gemini-2.5-pro" },
      {
        fetch: mockFetch({
          candidates: [{
            content: {
              parts: [
                { functionCall: { name: "file_read", args: { path: "/a" } } },
                { functionCall: { name: "file_read", args: { path: "/b" } } },
              ],
            },
            finishReason: "STOP",
          }],
        }),
      },
    );

    const response = await provider.complete({
      model: "gemini-2.5-pro",
      apiKey: "k",
      temperature: 0,
      maxTokens: 100,
      messages: [{ role: "user", content: [{ type: "text", text: "read both" }] }],
    });

    expect(response.toolCalls).toEqual([
      expect.objectContaining({
        id: "gemini_tool_call_1",
        function: { name: "file_read", arguments: '{"path":"/a"}' },
      }),
      expect.objectContaining({
        id: "gemini_tool_call_2",
        function: { name: "file_read", arguments: '{"path":"/b"}' },
      }),
    ]);
  });

  it("surfaces Gemini MAX_TOKENS as an output-limit notice", async () => {
    const provider = createProvider(
      { providerId: "gemini", apiKey: "k", chatModel: "gemini-2.5-pro" },
      {
        fetch: mockFetch({
          candidates: [
            {
              content: { parts: [{ text: "partial" }], role: "model" },
              finishReason: "MAX_TOKENS",
            },
          ],
        }),
      },
    );

    await expect(
      provider.complete({
        model: "gemini-2.5-pro",
        apiKey: "k",
        temperature: 0,
        maxTokens: 100,
        messages: [
          { role: "user", content: [{ type: "text", text: "hi" }] },
        ],
      }),
    ).resolves.toMatchObject({
      content: "partial",
      finishReason: "MAX_TOKENS",
      modelServiceNotice: {
        kind: "output_limit",
        provider: "gemini",
        model: "gemini-2.5-pro",
      },
    });
  });

  it("places thinking config inside generationConfig and separates thought summaries", async () => {
    let requestBody: Record<string, unknown> = {};
    const provider = createProvider(
      {
        providerId: "gemini",
        apiKey: "k",
        chatModel: "gemini-3.6-flash",
      },
      {
        fetch: (async (_url, init) => {
          requestBody = JSON.parse(
            String(init?.body),
          ) as Record<string, unknown>;
          return new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [
                      { text: "公开思考摘要", thought: true },
                      { text: "最终答案" },
                    ],
                  },
                  finishReason: "STOP",
                },
              ],
              usageMetadata: {
                promptTokenCount: 8,
                candidatesTokenCount: 5,
              },
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }) as typeof fetch,
      },
    );

    await expect(
      provider.complete({
        model: "gemini-3.6-flash",
        apiKey: "k",
        temperature: 0,
        maxTokens: 100,
        messages: [
          { role: "user", content: [{ type: "text", text: "hi" }] },
        ],
        thinking: { type: "disabled" },
      }),
    ).resolves.toMatchObject({
      content: "最终答案",
      reasoningContent: "公开思考摘要",
    });
    expect(requestBody).toMatchObject({
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 100,
        thinkingConfig: {
          thinkingLevel: "minimal",
          includeThoughts: false,
        },
      },
    });
    expect(requestBody).not.toHaveProperty("thinkingConfig");
  });

  it("uses Gemini 2.5 Pro's minimum valid budget when thinking cannot be disabled", async () => {
    let requestBody: Record<string, unknown> = {};
    const provider = createProvider(
      {
        providerId: "gemini",
        apiKey: "k",
        chatModel: "gemini-2.5-pro",
      },
      {
        fetch: (async (_url, init) => {
          requestBody = JSON.parse(
            String(init?.body),
          ) as Record<string, unknown>;
          return new Response(
            JSON.stringify({
              candidates: [
                {
                  content: { parts: [{ text: "最终答案" }] },
                  finishReason: "STOP",
                },
              ],
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }) as typeof fetch,
      },
    );

    await provider.complete({
      model: "gemini-2.5-pro",
      apiKey: "k",
      temperature: 0,
      maxTokens: 1024,
      messages: [
        { role: "user", content: [{ type: "text", text: "hi" }] },
      ],
      thinking: { type: "disabled" },
    });

    expect(requestBody).toMatchObject({
      generationConfig: {
        thinkingConfig: {
          thinkingBudget: 128,
          includeThoughts: false,
        },
      },
    });
  });

  it("preserves Gemini thinking configuration and deltas in streaming mode", async () => {
    let requestBody: Record<string, unknown> = {};
    const encoder = new TextEncoder();
    const provider = createProvider(
      {
        providerId: "gemini",
        apiKey: "k",
        chatModel: "gemini-3.6-flash",
      },
      {
        fetch: (async (_url, init) => {
          requestBody = JSON.parse(
            String(init?.body),
          ) as Record<string, unknown>;
          return new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      candidates: [
                        {
                          content: {
                            parts: [
                              { text: "摘要", thought: true },
                              { text: "答案" },
                            ],
                          },
                          finishReason: "STOP",
                        },
                      ],
                      usageMetadata: {
                        promptTokenCount: 4,
                        candidatesTokenCount: 3,
                      },
                    })}\n\n`,
                  ),
                );
                controller.close();
              },
            }),
            {
              status: 200,
              headers: { "content-type": "text/event-stream" },
            },
          );
        }) as typeof fetch,
      },
    );
    const events = [];

    for await (const event of provider.stream({
      model: "gemini-3.6-flash",
      apiKey: "k",
      temperature: 0,
      maxTokens: 100,
      messages: [
        { role: "user", content: [{ type: "text", text: "hi" }] },
      ],
      thinking: { type: "enabled", budgetTokens: 2048 },
    })) {
      events.push(event);
    }

    expect(requestBody).toMatchObject({
      generationConfig: {
        thinkingConfig: {
          thinkingLevel: "high",
          includeThoughts: true,
        },
      },
    });
    expect(events).toEqual([
      { type: "thinking_delta", text: "摘要" },
      { type: "text_delta", text: "答案" },
      {
        type: "done",
        response: {
          content: "答案",
          reasoningContent: "摘要",
          toolCalls: [],
          finishReason: "STOP",
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          usage: { inputTokens: 4, outputTokens: 3 },
        },
      },
    ]);
  });

  it("exposes bounded structured retry metadata for an HTTP failure", async () => {
    const provider = createProvider(
      { providerId: "gemini", apiKey: "k", chatModel: "gemini-1.5-pro" },
      {
        fetch: mockFetch(
          { error: "provider-body-secret" },
          503,
          { "retry-after-ms": "90000", "x-provider-secret": "do-not-copy" },
        ),
      },
    );

    const error = await provider.complete({
      model: "gemini-1.5-pro",
      apiKey: "k",
      temperature: 0,
      maxTokens: 10,
      messages: [{ role: "user", content: [{ type: "text", text: "x" }] }],
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      status: 503,
      statusCode: 503,
      responseHeaders: { "retry-after-ms": "30000" },
    });
    expect((error as Error).message).toBe("HTTP 503");
    expect(JSON.stringify(error)).not.toMatch(/provider-body-secret|do-not-copy/);
  });

  it("times out a fetch that never settles", async () => {
    const provider = createProvider(
      { providerId: "gemini", apiKey: "k", chatModel: "gemini-1.5-pro" },
      { fetch: neverSettlingFetch(), timeoutMs: 5 },
    );

    await expectRejectsBefore(
      provider.complete({
        model: "gemini-1.5-pro",
        apiKey: "k",
        temperature: 0,
        maxTokens: 10,
        messages: [{ role: "user", content: [{ type: "text", text: "x" }] }],
      }),
      50,
      /Gemini request timed out after 5 ms/,
    );
  });

  it("surfaces local timeout instead of AbortError when fetch rejects on abort", async () => {
    const provider = createProvider(
      { providerId: "gemini", apiKey: "k", chatModel: "gemini-1.5-pro" },
      { fetch: abortAwareNeverSettlingFetch(), timeoutMs: 5 },
    );

    await expectRejectsBefore(
      provider.complete({
        model: "gemini-1.5-pro",
        apiKey: "k",
        temperature: 0,
        maxTokens: 10,
        messages: [{ role: "user", content: [{ type: "text", text: "x" }] }],
      }),
      50,
      /Gemini request timed out after 5 ms/,
    );
  });
});

describe("ProviderChatClient adapter", () => {
  it("routes complete through the provider and maps the response back", async () => {
    const provider = createProvider(
      { providerId: "anthropic", apiKey: "k", chatModel: "claude-3" },
      { fetch: mockFetch({ content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }) },
    );
    const client = createProviderChatClient({ provider });
    const res = await client.complete({
      baseUrl: "", apiKey: "k", model: "claude-3", temperature: 0, maxTokens: 10,
      messages: [{ role: "user", content: "hi" }],
    });
    expect(res.content).toBe("ok");
    expect(res.finishReason).toBe("end_turn");
    expect(res.usage).toMatchObject({
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
    });
  });

  it("falls back to the raw client when no provider is configured", async () => {
    const fakeClient = {
      async complete() { return { content: "fallback", toolCalls: [], finishReason: "stop" }; },
      async *streamComplete() { yield { type: "done", finishReason: "stop" } as never; },
    };
    const client = createProviderChatClient({ fallback: fakeClient as never });
    const res = await client.complete({ baseUrl: "", apiKey: "", model: "m", temperature: 0, maxTokens: 1, messages: [] });
    expect(res.content).toBe("fallback");
  });

  it("maps provider thinking deltas to low-level reasoning deltas", async () => {
    const provider = scriptedProvider([
      { type: "thinking_delta", text: "check tools" },
      { type: "text_delta", text: "answer" },
      { type: "done", response: { content: "answer", toolCalls: [], finishReason: "stop", cacheReadTokens: 0, cacheWriteTokens: 0 } },
    ]);
    const client = createProviderChatClient({ provider });
    const events = [];

    for await (const event of client.streamComplete({
      baseUrl: "",
      apiKey: "k",
      model: "m",
      temperature: 0,
      maxTokens: 10,
      messages: [{ role: "user", content: "hi" }],
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "reasoning_delta", text: "check tools" },
      { type: "content_delta", text: "answer" },
      { type: "done", finishReason: "stop" },
    ]);
  });

  it("passes provider tool call indexes through low-level stream events", async () => {
    const provider = scriptedProvider([
      {
        type: "tool_call_delta",
        index: 2,
        toolCallId: "call_indexed",
        name: "file_list",
        argumentsDelta: '{"path":"/tmp"}',
      },
      { type: "done" },
    ]);
    const client = createProviderChatClient({ provider });
    const events = [];

    for await (const event of client.streamComplete({
      baseUrl: "",
      apiKey: "k",
      model: "m",
      temperature: 0,
      maxTokens: 10,
      messages: [{ role: "user", content: "hi" }],
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        type: "tool_call_delta",
        index: 2,
        id: "call_indexed",
        name: "file_list",
        arguments: '{"path":"/tmp"}',
      },
      { type: "done", finishReason: "stop" },
    ]);
  });

  it("emits one final done event without letting a trailing stop hide output truncation", async () => {
    const provider = scriptedProvider([
      { type: "text_delta", text: "partial" },
      { type: "done", finishReason: "MAX_TOKENS" },
      { type: "done", finishReason: "stop" },
    ]);
    const client = createProviderChatClient({ provider });
    const events = [];

    for await (const event of client.streamComplete({
      baseUrl: "",
      apiKey: "k",
      model: "m",
      temperature: 0,
      maxTokens: 10,
      messages: [{ role: "user", content: "hi" }],
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "content_delta", text: "partial" },
      {
        type: "done",
        finishReason: "MAX_TOKENS",
        modelServiceNotice: expect.objectContaining({
          kind: "output_limit",
          rawReason: "MAX_TOKENS",
        }),
      },
    ]);
  });

  it("uses complete-derived tool calls for native provider streams when tools are present", async () => {
    let completeCalls = 0;
    let streamCalls = 0;
    const provider: LLMProvider = {
      id: "anthropic",
      // v3.6.0: streamingToolCalls: false — this test exercises the complete()
      // fallback for providers that DON'T support native streaming tool calls.
      capabilities: { toolUse: true, thinking: true, vision: false, promptCache: true, streamingToolCalls: false },
      async complete() {
        completeCalls += 1;
        return {
          content: null,
          finishReason: "tool_use",
          reasoningContent: "native tool planning",
          toolCalls: [
            {
              id: "toolu_real",
              type: "function",
              function: {
                name: "file_list",
                arguments: '{"path":"/safe"}',
              },
            },
          ],
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        };
      },
      async *stream() {
        streamCalls += 1;
        yield {
          type: "tool_call_delta",
          toolCallId: "0",
          argumentsDelta: '{"path":"/unsafe"}',
        };
        yield {
          type: "done",
          response: {
            content: null,
            toolCalls: [],
            finishReason: "tool_use",
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
          },
        };
      },
      async countTokens() {
        return 0;
      },
      buildCachePrefix(messages) {
        return { system: "", tools: [], messages, watermark: messages.length };
      },
    };
    const client = createProviderChatClient({ provider });
    const events = [];

    for await (const event of client.streamComplete({
      baseUrl: "",
      apiKey: "k",
      model: "claude-3",
      temperature: 0,
      maxTokens: 10,
      messages: [{ role: "user", content: "list" }],
      tools: [
        {
          type: "function",
          function: {
            name: "file_list",
            description: "List files",
            parameters: { type: "object", properties: {}, required: [] },
          },
        },
      ],
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "reasoning_delta", text: "native tool planning" },
      {
        type: "tool_call_delta",
        id: "toolu_real",
        name: "file_list",
        arguments: '{"path":"/safe"}',
      },
      { type: "done", finishReason: "tool_use" },
    ]);
    expect(completeCalls).toBe(1);
    expect(streamCalls).toBe(0);
  });
});

function scriptedProvider(events: StreamEvent[]): LLMProvider {
  return {
    id: "openai-compatible",
    capabilities: { toolUse: true, thinking: true, vision: false, promptCache: false, streamingToolCalls: true },
    async complete() {
      return { content: "unused", toolCalls: [], finishReason: "stop", cacheReadTokens: 0, cacheWriteTokens: 0 };
    },
    async *stream() {
      for (const event of events) yield event;
    },
    async countTokens() {
      return 0;
    },
    buildCachePrefix(messages) {
      return { system: "", tools: [], messages, watermark: messages.length };
    },
  };
}

describe("OpenAICompatibleProvider", () => {
  it("propagates OpenAI-compatible usage and reported prompt-cache tokens", async () => {
    const provider = createOpenAICompatibleProvider({
      fetch: mockFetch({
        choices: [{ message: { content: "hi" }, finish_reason: "stop" }],
        usage: {
          prompt_tokens: 7,
          completion_tokens: 3,
          total_tokens: 10,
          prompt_tokens_details: { cached_tokens: 2 },
        },
      }) as never,
    });
    const req: CompleteRequest = {
      model: "gpt-4", apiKey: "k", baseUrl: "https://api.openai.com/v1",
      temperature: 0, maxTokens: 10, messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    };
    const res = await provider.complete(req);
    expect(res.content).toBe("hi");
    expect(res.cacheReadTokens).toBe(2);
    expect(res.cacheWriteTokens).toBe(0);
    expect(res.usage).toEqual({ inputTokens: 7, outputTokens: 3 });
  });

  it("maps low-level streaming reasoning deltas to provider thinking deltas", async () => {
    const encoder = new TextEncoder();
    const provider = createOpenAICompatibleProvider({
      fetch: (async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "stream thought" } }] })}\n\n`));
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
            },
          }),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        )) as never,
    });
    const events = [];

    for await (const event of provider.stream({
      model: "gpt-4",
      apiKey: "k",
      baseUrl: "https://api.openai.com/v1",
      temperature: 0,
      maxTokens: 10,
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "thinking_delta", text: "stream thought" },
      { type: "done", finishReason: "stop" },
    ]);
  });

  it("countTokens uses the heuristic", async () => {
    const provider = createOpenAICompatibleProvider({ fetch: mockFetch({}) as never });
    const n = await provider.countTokens([{ role: "user", content: [{ type: "text", text: "hello" }] }]);
    expect(n).toBeGreaterThan(0);
  });
});

describe("createSettingsBackedChatClient (P3 activation)", () => {
  const baseSettings: PublicModelSettings = {
    baseUrl: "https://api.openai.com/v1", chatModel: "gpt-4", embeddingModel: "",
    temperature: 0.2, maxTokens: 8192, thinkingEnabled: false, thinkingBudgetTokens: 8192,
    hasApiKey: true, updatedAt: null,
  };
  const req: ChatCompletionRequest = { baseUrl: "", apiKey: "k", model: "m", temperature: 0, maxTokens: 10, messages: [{ role: "user", content: "hi" }] };

  it("uses the raw fallback for providerId openai-compatible (zero regression)", async () => {
    let fallbackCalled = false;
    const fallback = {
      async complete() { fallbackCalled = true; return { content: "fallback", toolCalls: [], finishReason: "stop" }; },
      async *streamComplete() { yield { type: "done" as const, finishReason: "stop" }; },
    };
    const client = createSettingsBackedChatClient({
      loadSettings: async () => baseSettings,
      getApiKey: async () => "k",
      fallback: fallback as never,
    });
    const res = await client.complete(req);
    expect(res.content).toBe("fallback");
    expect(fallbackCalled).toBe(true);
  });

  it("routes to a native anthropic provider when providerId=anthropic", async () => {
    const fallback = { async complete() { return { content: "FALLBACK_SHOULD_NOT_BE_USED", toolCalls: [], finishReason: "stop" }; }, async *streamComplete() { yield { type: "done" as const, finishReason: "stop" }; } };
    const client = createSettingsBackedChatClient({
      loadSettings: async () => ({ ...baseSettings, providerId: "anthropic", chatModel: "claude-3-5-sonnet", baseUrl: "https://api.anthropic.com" }),
      getApiKey: async () => "k",
      fallback: fallback as never,
      fetch: mockFetch({ content: [{ type: "text", text: "from anthropic" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }),
    });
    const res = await client.complete({ ...req, model: "claude-3-5-sonnet" });
    expect(res.content).toBe("from anthropic");
  });

  it("enforces a resolved profile's disabled thinking semantics on every request", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const client = createSettingsBackedChatClient({
      loadSettings: async () => baseSettings,
      getApiKey: async () => "legacy-key",
      resolveProfile: async () => ({
        binding: {
          profileId: "deepseek-chat",
          connectionId: "deepseek-primary",
          providerKind: "deepseek",
          modelId: "deepseek-v4-flash",
          revision: 3,
          capabilities: {
            tools: true,
            vision: false,
            pdf: false,
            streaming: true,
            parallelToolCalls: true,
          },
          generation: {
            temperature: 0.3,
            maxTokens: 4096,
            thinkingEnabled: false,
            thinkingBudgetTokens: 8192,
          },
        },
        connectionValues: { baseUrl: "https://api.deepseek.com" },
        secrets: { apiKey: "profile-key" },
      }),
      fallback: {
        async complete() {
          throw new Error("fallback must not be used");
        },
        async *streamComplete() {
          throw new Error("fallback must not be used");
        },
      },
      fetch: (async (_input, init) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(
          JSON.stringify({
            choices: [
              { message: { content: "OK" }, finish_reason: "stop" },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }) as typeof fetch,
    });

    await expect(
      client.complete({
        ...req,
        model: "caller-model",
        apiKey: "caller-key",
        thinking: { type: "enabled", budgetTokens: 9999 },
      }),
    ).resolves.toMatchObject({ content: "OK" });
    expect(bodies).toEqual([
      expect.objectContaining({
        model: "deepseek-v4-flash",
        temperature: 0.3,
        max_tokens: 4096,
        thinking: { type: "disabled" },
      }),
    ]);
  });
});
