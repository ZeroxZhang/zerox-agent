import { describe, expect, it } from "vitest";
import { toNormalized, fromNormalized } from "./normalize";
import { buildCachePrefix, serializeCachePrefix } from "./cachePrefix";
import { createProvider } from "./providerFactory";
import { createProviderChatClient, createSettingsBackedChatClient } from "./providerChatClient";
import { createOpenAICompatibleProvider } from "./openAICompatibleProvider";
import type { ChatMessage, ChatCompletionRequest } from "../openAiCompatibleClient";
import type { CompleteRequest, LLMProvider, NormalizedMessage, StreamEvent } from "./provider";
import type { PublicModelSettings } from "../../shared/modelSettings";

describe("normalize round-trip", () => {
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
});

function mockFetch(response: unknown, status = 200): typeof fetch {
  return (async () => ({
    ok: status >= 200 && status < 300,
    status,
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

  it("normalizes errors to HTTP <status>: <body>", async () => {
    const provider = createProvider(
      { providerId: "anthropic", apiKey: "k", chatModel: "claude-3" },
      { fetch: mockFetch({ error: "overloaded" }, 529) },
    );
    await expect(
      provider.complete({ model: "claude-3", apiKey: "k", temperature: 0, maxTokens: 10, messages: [{ role: "user", content: [{ type: "text", text: "x" }] }] }),
    ).rejects.toThrow(/HTTP 529/);
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

  it("uses complete-derived tool calls for native provider streams when tools are present", async () => {
    let completeCalls = 0;
    let streamCalls = 0;
    const provider: LLMProvider = {
      id: "anthropic",
      capabilities: { toolUse: true, thinking: true, vision: false, promptCache: true, streamingToolCalls: true },
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
  it("reports zero cache tokens (no OpenAI cache reporting)", async () => {
    const provider = createOpenAICompatibleProvider({
      fetch: mockFetch({ choices: [{ message: { content: "hi" }, finish_reason: "stop" }] }) as never,
    });
    const req: CompleteRequest = {
      model: "gpt-4", apiKey: "k", baseUrl: "https://api.openai.com/v1",
      temperature: 0, maxTokens: 10, messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    };
    const res = await provider.complete(req);
    expect(res.content).toBe("hi");
    expect(res.cacheReadTokens).toBe(0);
    expect(res.cacheWriteTokens).toBe(0);
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
      { type: "done" },
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
});
