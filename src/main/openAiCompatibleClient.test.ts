import { describe, expect, it } from "vitest";
import {
  createOpenAiCompatibleClient,
  createOpenAiCompatibleEmbeddingClient,
} from "./openAiCompatibleClient";

describe("OpenAI-compatible chat client", () => {
  it("serializes pasted images as OpenAI multimodal user content", async () => {
    const calls: RequestInit[] = [];
    const client = createOpenAiCompatibleClient({
      fetch: async (_url, init) => {
        calls.push(init ?? {});
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "seen" }, finish_reason: "stop" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    await client.complete({
      baseUrl: "https://api.example.com/v1",
      apiKey: "secret-key",
      model: "vision-model",
      temperature: 0.2,
      maxTokens: 100,
      messages: [
        {
          role: "user",
          content: "What is shown?",
          images: [{ mediaType: "image/png", data: "aW1hZ2U=" }],
        },
      ],
    });

    const body = JSON.parse(String(calls[0]?.body));
    expect(body.messages[0].content).toEqual([
      { type: "text", text: "What is shown?" },
      {
        type: "image_url",
        image_url: { url: "data:image/png;base64,aW1hZ2U=" },
      },
    ]);
  });

  it("posts chat completions to baseUrl/chat/completions and returns message content", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = createOpenAiCompatibleClient({
      fetch: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: "OK",
                },
                finish_reason: "stop",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    const result = await client.complete({
      baseUrl: "https://api.example.com/v1",
      apiKey: "secret-key",
      model: "agent-model",
      temperature: 0.2,
      maxTokens: 8192,
      messages: [{ role: "system", content: "You are an agent." }],
    });

    expect(result).toEqual({
      content: "OK",
      toolCalls: [],
      finishReason: "stop",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.example.com/v1/chat/completions");
    expect(calls[0].init.headers).toMatchObject({
      Authorization: "Bearer secret-key",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      model: "agent-model",
      messages: [{ role: "system", content: "You are an agent." }],
      temperature: 0.2,
      max_tokens: 8192,
    });
  });

  it("includes tools and tool_choice in the request body when provided", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = createOpenAiCompatibleClient({
      fetch: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: "call_1",
                      type: "function",
                      function: {
                        name: "file_list",
                        arguments: '{"path":"/tmp"}',
                      },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    const tools = [
      {
        type: "function" as const,
        function: {
          name: "file_list",
          description: "List directory contents",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string", description: "Directory path" },
            },
            required: ["path"],
          },
        },
      },
    ];

    const result = await client.complete({
      baseUrl: "https://api.example.com/v1",
      apiKey: "secret-key",
      model: "agent-model",
      temperature: 0.2,
      maxTokens: 8192,
      messages: [{ role: "user", content: "List /tmp" }],
      tools,
      tool_choice: "auto",
    });

    expect(result).toEqual({
      content: null,
      toolCalls: [
        {
          id: "call_1",
          type: "function",
          function: {
            name: "file_list",
            arguments: '{"path":"/tmp"}',
          },
        },
      ],
      finishReason: "tool_calls",
    });

    const body = JSON.parse(String(calls[0].init.body));
    expect(body.tools).toEqual(tools);
    expect(body.tool_choice).toBe("auto");
  });

  it("returns provider-supplied reasoning content when present", async () => {
    const client = createOpenAiCompatibleClient({
      fetch: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  reasoning_content: "我正在比较用户目标与可用工具。",
                  content: "OK",
                },
                finish_reason: "stop",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    });

    await expect(
      client.complete({
        baseUrl: "https://api.example.com/v1",
        apiKey: "secret-key",
        model: "agent-model",
        temperature: 0.2,
        maxTokens: 8192,
        messages: [{ role: "user", content: "Run" }],
      }),
    ).resolves.toEqual({
      content: "OK",
      toolCalls: [],
      finishReason: "stop",
      reasoningContent: "我正在比较用户目标与可用工具。",
    });
  });

  it("returns reasoning-only responses so upper layers can recover or finalize them", async () => {
    const client = createOpenAiCompatibleClient({
      fetch: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  reasoning_content: "已完成推理，但正式答案被输出上限截断。",
                  content: null,
                },
                finish_reason: "length",
              },
            ],
            usage: {
              prompt_tokens: 40,
              completion_tokens: 8192,
              total_tokens: 8232,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    });

    await expect(
      client.complete({
        baseUrl: "https://api.example.com/v1",
        apiKey: "secret-key",
        model: "reasoning-model",
        temperature: 0.2,
        maxTokens: 8192,
        messages: [{ role: "user", content: "Run" }],
      }),
    ).resolves.toMatchObject({
      content: null,
      toolCalls: [],
      finishReason: "length",
      reasoningContent: "已完成推理，但正式答案被输出上限截断。",
      usage: {
        inputTokens: 40,
        outputTokens: 8192,
      },
    });
  });

  it("serializes documented provider thinking wire formats without conflating them", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const client = createOpenAiCompatibleClient({
      fetch: async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });
    const request = {
      baseUrl: "https://api.example.com/v1",
      apiKey: "secret-key",
      model: "agent-model",
      temperature: 0.2,
      maxTokens: 8192,
      messages: [{ role: "user" as const, content: "Run" }],
    };

    await client.complete({
      ...request,
      thinking: { type: "disabled" },
      thinkingWireFormat: "thinking-object",
    });
    await client.complete({
      ...request,
      thinking: { type: "enabled", budgetTokens: 2048 },
      thinkingWireFormat: "enable-thinking",
    });
    await client.complete({
      ...request,
      thinking: { type: "disabled" },
      thinkingWireFormat: "reasoning-object",
    });
    await client.complete({
      ...request,
      thinking: { type: "disabled" },
      thinkingWireFormat: "reasoning-effort",
    });
    await client.complete({
      ...request,
      thinking: { type: "enabled", budgetTokens: 2048 },
      thinkingWireFormat: "omit",
    });
    await client.complete({
      ...request,
      thinking: { type: "enabled", budgetTokens: 2048 },
    });

    expect(bodies[0]).toMatchObject({
      thinking: { type: "disabled" },
    });
    expect(bodies[0]).not.toHaveProperty("thinking.budget_tokens");
    expect(bodies[1]).toMatchObject({
      enable_thinking: true,
      thinking_budget: 2048,
    });
    expect(bodies[1]).not.toHaveProperty("thinking");
    expect(bodies[2]).toMatchObject({
      reasoning: { effort: "none" },
    });
    expect(bodies[3]).toMatchObject({
      reasoning_effort: "none",
    });
    expect(bodies[4]).not.toHaveProperty("thinking");
    expect(bodies[4]).not.toHaveProperty("enable_thinking");
    expect(bodies[4]).not.toHaveProperty("reasoning");
    expect(bodies[4]).not.toHaveProperty("reasoning_effort");
    expect(bodies[5]).toMatchObject({
      thinking: { type: "enabled", budget_tokens: 2048 },
    });
  });

  it("returns an output-limit notice instead of misreporting an empty response", async () => {
    const client = createOpenAiCompatibleClient({
      fetch: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: { content: null },
                finish_reason: "length",
              },
            ],
            usage: { completion_tokens: 8192 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    });

    await expect(
      client.complete({
        baseUrl: "https://api.example.com/v1",
        apiKey: "secret-key",
        model: "agent-model",
        temperature: 0.2,
        maxTokens: 8192,
        messages: [{ role: "user", content: "Run" }],
      }),
    ).resolves.toMatchObject({
      content: null,
      finishReason: "length",
      modelServiceNotice: {
        kind: "output_limit",
        model: "agent-model",
        rawReason: "length",
      },
    });
  });

  it("streams provider reasoning deltas from SSE chunks", async () => {
    const encoder = new TextEncoder();
    const client = createOpenAiCompatibleClient({
      fetch: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "plan " } }] })}\n\n`));
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "answer" } }] })}\n\n`));
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
            },
          }),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        ),
    });

    const events = [];
    for await (const event of client.streamComplete({
      baseUrl: "https://api.example.com/v1",
      apiKey: "secret-key",
      model: "agent-model",
      temperature: 0.2,
      maxTokens: 8192,
      messages: [{ role: "user", content: "Run" }],
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "reasoning_delta", text: "plan " },
      { type: "content_delta", text: "answer" },
      { type: "done", finishReason: "stop" },
    ]);
  });

  it("accepts SSE data fields without an optional space", async () => {
    const encoder = new TextEncoder();
    const client = createOpenAiCompatibleClient({
      fetch: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  `data:${JSON.stringify({ choices: [{ delta: { content: "answer" } }] })}\n\n`,
                ),
              );
              controller.enqueue(encoder.encode("data:[DONE]\n\n"));
              controller.close();
            },
          }),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        ),
    });
    const events = [];

    for await (const event of client.streamComplete({
      baseUrl: "https://api.example.com/v1",
      apiKey: "secret-key",
      model: "agent-model",
      temperature: 0,
      maxTokens: 10,
      messages: [{ role: "user", content: "Run" }],
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "content_delta", text: "answer" },
      { type: "done", finishReason: "stop" },
    ]);
  });

  it("fails the stream instead of silently dropping malformed JSON", async () => {
    const encoder = new TextEncoder();
    const client = createOpenAiCompatibleClient({
      fetch: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(encoder.encode("data: {not-json}\n\n"));
              controller.close();
            },
          }),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        ),
    });

    await expect(async () => {
      for await (const _event of client.streamComplete({
        baseUrl: "https://api.example.com/v1",
        apiKey: "secret-key",
        model: "agent-model",
        temperature: 0,
        maxTokens: 10,
        messages: [{ role: "user", content: "Run" }],
      })) {
        // Drain.
      }
    }).rejects.toThrow("LLM stream returned malformed JSON.");
  });

  it("preserves a streamed length finish reason when a later [DONE] arrives", async () => {
    const encoder = new TextEncoder();
    const client = createOpenAiCompatibleClient({
      fetch: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    choices: [
                      {
                        delta: { content: "partial answer" },
                        finish_reason: "length",
                      },
                    ],
                  })}\n\n`,
                ),
              );
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    choices: [
                      {
                        delta: {},
                        finish_reason: "stop",
                      },
                    ],
                  })}\n\n`,
                ),
              );
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
            },
          }),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        ),
    });

    const events = [];
    for await (const event of client.streamComplete({
      baseUrl: "https://api.example.com/v1",
      apiKey: "secret-key",
      model: "agent-model",
      temperature: 0,
      maxTokens: 10,
      messages: [{ role: "user", content: "Run" }],
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "content_delta", text: "partial answer" },
      {
        type: "done",
        finishReason: "length",
        modelServiceNotice: expect.objectContaining({
          kind: "output_limit",
          rawReason: "length",
        }),
      },
    ]);
  });

  it("streams tool call indexes from SSE chunks", async () => {
    const encoder = new TextEncoder();
    const client = createOpenAiCompatibleClient({
      fetch: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                choices: [
                  {
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: "call_0",
                          type: "function",
                          function: { name: "file_list", arguments: '{"path":"/a' },
                        },
                        {
                          index: 1,
                          id: "call_1",
                          type: "function",
                          function: { name: "file_list", arguments: '{"path":"/b' },
                        },
                      ],
                    },
                  },
                ],
              })}\n\n`));
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                choices: [
                  {
                    delta: {
                      tool_calls: [
                        { index: 0, function: { arguments: '"}' } },
                        { index: 1, function: { arguments: '"}' } },
                      ],
                    },
                  },
                ],
              })}\n\n`));
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
            },
          }),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        ),
    });

    const events = [];
    for await (const event of client.streamComplete({
      baseUrl: "https://api.example.com/v1",
      apiKey: "secret-key",
      model: "agent-model",
      temperature: 0.2,
      maxTokens: 8192,
      messages: [{ role: "user", content: "Run" }],
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        type: "tool_call_delta",
        index: 0,
        id: "call_0",
        name: "file_list",
        arguments: '{"path":"/a',
      },
      {
        type: "tool_call_delta",
        index: 1,
        id: "call_1",
        name: "file_list",
        arguments: '{"path":"/b',
      },
      {
        type: "tool_call_delta",
        index: 0,
        id: "",
        name: "",
        arguments: '"}',
      },
      {
        type: "tool_call_delta",
        index: 1,
        id: "",
        name: "",
        arguments: '"}',
      },
      { type: "done", finishReason: "stop" },
    ]);
  });

  it("returns provider token usage when present", async () => {
    const client = createOpenAiCompatibleClient({
      fetch: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: "OK",
                },
                finish_reason: "stop",
              },
            ],
            usage: {
              prompt_tokens: 12,
              completion_tokens: 5,
              total_tokens: 17,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    });

    await expect(
      client.complete({
        baseUrl: "https://api.example.com/v1",
        apiKey: "secret-key",
        model: "agent-model",
        temperature: 0.2,
        maxTokens: 8192,
        messages: [{ role: "user", content: "Hi" }],
      }),
    ).resolves.toEqual({
      content: "OK",
      toolCalls: [],
      finishReason: "stop",
      usage: {
        inputTokens: 12,
        outputTokens: 5,
        promptTokens: 12,
        completionTokens: 5,
        totalTokens: 17,
      },
    });
  });

  it("throws a compact error when the provider returns a non-2xx response", async () => {
    const client = createOpenAiCompatibleClient({
      fetch: async () =>
        new Response(JSON.stringify({ error: { message: "bad key" } }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
    });

    const error = await client
      .complete({
        baseUrl: "https://api.example.com/v1",
        apiKey: "secret-key",
        model: "agent-model",
        temperature: 0.2,
        maxTokens: 8192,
        messages: [],
      })
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ status: 401 });
    expect((error as Error).message).toBe("HTTP 401");
    expect(JSON.stringify(error)).not.toContain("bad key");
    expect(JSON.stringify(error)).not.toContain("secret-key");
  });

  it("does not parse or expose a non-JSON provider error body", async () => {
    const sentinel = "sentinel-secret-echo";
    const client = createOpenAiCompatibleClient({
      fetch: async () =>
        new Response(`<html>${sentinel}</html>`, {
          status: 401,
          headers: { "content-type": "text/html" },
        }),
    });

    const error = await client
      .complete({
        baseUrl: "https://api.example.com/v1",
        apiKey: "secret-key",
        model: "agent-model",
        temperature: 0.2,
        maxTokens: 8192,
        messages: [],
      })
      .catch((caught: unknown) => caught);

    expect((error as Error).message).toBe("HTTP 401");
    expect(JSON.stringify(error)).not.toContain(sentinel);
  });

  it("aborts a chat completion request when it exceeds the configured timeout", async () => {
    let aborted = false;
    const client = createOpenAiCompatibleClient({
      timeoutMs: 5,
      fetch: async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("aborted by test signal"));
          });
        }),
    });

    await expect(
      client.complete({
        baseUrl: "https://api.example.com/v1",
        apiKey: "secret-key",
        model: "agent-model",
        temperature: 0.2,
        maxTokens: 8192,
        messages: [],
      }),
    ).rejects.toThrow("LLM request timed out after 5 ms.");
    expect(aborted).toBe(true);
  });

  it("aborts a chat completion request when the external signal fires", async () => {
    const controller = new AbortController();
    let observedAbort = false;
    const client = createOpenAiCompatibleClient({
      fetch: async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            observedAbort = true;
            reject(new Error("aborted by external signal"));
          });
          controller.abort();
        }),
    });

    await expect(
      client.complete({
        baseUrl: "https://api.example.com/v1",
        apiKey: "secret-key",
        model: "agent-model",
        temperature: 0.2,
        maxTokens: 8192,
        messages: [],
        signal: controller.signal,
      }),
    ).rejects.toThrow("aborted by external signal");
    expect(observedAbort).toBe(true);
  });
});

describe("OpenAI-compatible embedding client", () => {
  it("posts embeddings to baseUrl/embeddings and returns the first vector", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = createOpenAiCompatibleEmbeddingClient({
      fetch: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return new Response(
          JSON.stringify({
            data: [{ embedding: [0.1, 0.2, 0.3] }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    await expect(
      client.embed({
        baseUrl: "https://api.example.com/v1/",
        apiKey: "secret-key",
        model: "text-embedding-example",
        input: "Agent memory architecture",
      }),
    ).resolves.toEqual([0.1, 0.2, 0.3]);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.example.com/v1/embeddings");
    expect(calls[0].init.headers).toMatchObject({
      Authorization: "Bearer secret-key",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      model: "text-embedding-example",
      input: "Agent memory architecture",
    });
  });

  it("throws a compact error when the embedding provider rejects the request", async () => {
    const client = createOpenAiCompatibleEmbeddingClient({
      fetch: async () =>
        new Response(JSON.stringify({ error: { message: "model missing" } }), {
          status: 404,
          headers: { "content-type": "application/json" },
        }),
    });

    await expect(
      client.embed({
        baseUrl: "https://api.example.com/v1",
        apiKey: "secret-key",
        model: "text-embedding-example",
        input: "Agent memory architecture",
      }),
    ).rejects.toThrow("HTTP 404");
  });

  it("does not parse or expose a non-JSON embedding error body", async () => {
    const sentinel = "embedding-sentinel-secret";
    const client = createOpenAiCompatibleEmbeddingClient({
      fetch: async () =>
        new Response(`<html>${sentinel}</html>`, {
          status: 500,
          headers: { "content-type": "text/html" },
        }),
    });

    const error = await client
      .embed({
        baseUrl: "https://api.example.com/v1",
        apiKey: "secret-key",
        model: "text-embedding-example",
        input: "Agent memory architecture",
      })
      .catch((caught: unknown) => caught);

    expect((error as Error).message).toBe("HTTP 500");
    expect(JSON.stringify(error)).not.toContain(sentinel);
  });

  it("aborts an embedding request when it exceeds the configured timeout", async () => {
    let aborted = false;
    const client = createOpenAiCompatibleEmbeddingClient({
      timeoutMs: 5,
      fetch: async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("aborted by test signal"));
          });
        }),
    });

    await expect(
      client.embed({
        baseUrl: "https://api.example.com/v1",
        apiKey: "secret-key",
        model: "text-embedding-example",
        input: "Agent memory architecture",
      }),
    ).rejects.toThrow("Embedding request timed out after 5 ms.");
    expect(aborted).toBe(true);
  });
});
