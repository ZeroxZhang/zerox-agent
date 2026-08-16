import { describe, expect, it } from "vitest";
import { processStream } from "./streamProcessor";
import { createMaxMode, isMaxModeEnabled } from "./maxMode";
import { createMcpTransport, resolveTransportKind, type McpServerTransportConfig } from "../mcpTransport";
import { createAnthropicProvider } from "./anthropicProvider";
import { projectRunGraph } from "../../shared/runGraph";
import type { AgentRunRecord } from "../../shared/agentRuns";
import type { AgentTrajectoryEvent } from "../../shared/agentTrajectory";
import type { LLMProvider, CompleteRequest, StreamEvent } from "./provider";
import { createActorRuntime } from "../actors/actorRuntime";

// A fake provider whose stream yields a scripted sequence of StreamEvents.
function scriptedStreamProvider(events: StreamEvent[]): LLMProvider {
  return {
    id: "openai-compatible",
    capabilities: { toolUse: true, thinking: false, vision: false, promptCache: false, streamingToolCalls: true },
    async complete() { return { content: "", toolCalls: [], finishReason: "stop", cacheReadTokens: 0, cacheWriteTokens: 0 }; },
    async *stream() { for (const e of events) yield e; },
    async countTokens() { return 0; },
    buildCachePrefix(messages) { return { system: "", tools: [], messages, watermark: messages.length }; },
  };
}

describe("StreamProcessor", () => {
  it("aggregates text + tool_call deltas + done into a CompleteResponse", async () => {
    const provider = scriptedStreamProvider([
      { type: "text_delta", text: "Hello " },
      { type: "text_delta", text: "world" },
      { type: "tool_call_delta", toolCallId: "c1", name: "file_read", argumentsDelta: '{"path":"a"' },
      { type: "tool_call_delta", toolCallId: "c1", argumentsDelta: "}" },
      { type: "done", response: { content: "Hello world", toolCalls: [{ id: "c1", type: "function", function: { name: "file_read", arguments: '{"path":"a"}' } }], finishReason: "tool_calls", cacheReadTokens: 0, cacheWriteTokens: 0 } },
    ]);
    const req: CompleteRequest = { model: "m", apiKey: "k", temperature: 0, maxTokens: 10, messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] };
    const result = await processStream(provider, req);
    expect(result.response.content).toBe("Hello world");
    expect(result.response.toolCalls[0].function.name).toBe("file_read");
    expect(result.response.finishReason).toBe("tool_calls");
    expect(result.textDeltas).toBe(2);
    expect(result.toolCallDeltas).toBe(2);
  });

  it("synthesizes a response from deltas when no done.response is sent", async () => {
    const provider = scriptedStreamProvider([
      { type: "thinking_delta", text: "reasoning" },
      { type: "text_delta", text: "answer" },
      { type: "done" },
    ]);
    const req: CompleteRequest = { model: "m", apiKey: "k", temperature: 0, maxTokens: 10, messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] };
    const result = await processStream(provider, req);
    expect(result.response.content).toBe("answer");
    expect(result.response.reasoningContent).toBe("reasoning");
    expect(result.thinkingDeltas).toBe(1);
  });

  it("preserves accumulated thinking when done.response omits reasoningContent", async () => {
    const provider = scriptedStreamProvider([
      { type: "thinking_delta", text: "plan " },
      { type: "thinking_delta", text: "then answer" },
      { type: "text_delta", text: "answer" },
      {
        type: "done",
        response: {
          content: "answer",
          toolCalls: [],
          finishReason: "stop",
          cacheReadTokens: 3,
          cacheWriteTokens: 2,
        },
      },
    ]);
    const req: CompleteRequest = { model: "m", apiKey: "k", temperature: 0, maxTokens: 10, messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] };
    const result = await processStream(provider, req);
    expect(result.response).toMatchObject({
      content: "answer",
      reasoningContent: "plan then answer",
      cacheReadTokens: 3,
      cacheWriteTokens: 2,
    });
    expect(result.thinkingDeltas).toBe(2);
  });

  it("rethrows on an error variant", async () => {
    const provider = scriptedStreamProvider([{ type: "error", error: new Error("boom") }]);
    const req: CompleteRequest = { model: "m", apiKey: "k", temperature: 0, maxTokens: 10, messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] };
    await expect(processStream(provider, req)).rejects.toThrow("boom");
  });
});

describe("MaxMode", () => {
  it("runs N propose-only candidates, judges, and returns the winner", async () => {
    let callCount = 0;
    const provider: LLMProvider = {
      id: "openai-compatible",
      capabilities: { toolUse: true, thinking: false, vision: false, promptCache: false, streamingToolCalls: false },
      async complete(req) {
        callCount += 1;
        // The judge call (temperature 0, maxTokens 16, "Pick the best") returns "2".
        if (req.maxTokens === 16) return { content: "2", toolCalls: [], finishReason: "stop", cacheReadTokens: 0, cacheWriteTokens: 0 };
        return {
          content: `candidate ${callCount}`,
          toolCalls: [], finishReason: "stop", cacheReadTokens: 0, cacheWriteTokens: 0,
          usage: { inputTokens: 10, outputTokens: 5 },
        };
      },
      async *stream() { yield { type: "done" }; },
      async countTokens() { return 0; },
      buildCachePrefix(m) { return { system: "", tools: [], messages: m, watermark: m.length }; },
    };
    const maxMode = createMaxMode(provider);
    const req: CompleteRequest = { model: "m", apiKey: "k", temperature: 0.7, maxTokens: 100, messages: [{ role: "user", content: [{ type: "text", text: "write a poem" }] }] };
    const result = await maxMode.runStep(req, { candidates: 3, judgeModel: "judge-m" });
    expect(result.candidatesTried).toBe(3);
    expect(result.winner.content).toContain("candidate");
    expect(result.ensembleTokens.input).toBe(30); // 3 × 10
    expect(result.judgeModel).toBe("judge-m");
  });

  it("returns winner tool calls without replaying side effects in an actor", async () => {
    const provider: LLMProvider = {
      id: "openai-compatible",
      capabilities: { toolUse: true, thinking: false, vision: false, promptCache: false, streamingToolCalls: false },
      async complete() {
        return { content: null, toolCalls: [{ id: "c1", type: "function", function: { name: "file_write", arguments: "{}" } }], finishReason: "tool_calls", cacheReadTokens: 0, cacheWriteTokens: 0 };
      },
      async *stream() { yield { type: "done" }; },
      async countTokens() { return 0; },
      buildCachePrefix(m) { return { system: "", tools: [], messages: m, watermark: m.length }; },
    };
    let actorRuns = 0;
    const actorRuntime = createActorRuntime({ deps: { runActor: async () => {
      actorRuns += 1;
      return { status: "done", summary: "replayed", filesTouched: ["/tmp/x"] };
    } } });
    const maxMode = createMaxMode(provider);
    const req: CompleteRequest = { model: "m", apiKey: "k", temperature: 0, maxTokens: 100, messages: [{ role: "user", content: [{ type: "text", text: "x" }] }] };
    const result = await maxMode.runStep(req, { candidates: 1, judgeModel: "j", actorRuntime, parentRunId: "run-1" });
    expect(result.winner.toolCalls).toHaveLength(1);
    expect(actorRuns).toBe(0);
  });

  it("isMaxModeEnabled defaults off", () => {
    expect(isMaxModeEnabled({})).toBe(false);
    expect(isMaxModeEnabled({ ZEROX_MAX_MODE: "on" })).toBe(true);
    expect(isMaxModeEnabled({ ZEROX_MAX_MODE: "true" })).toBe(false);
  });
});

describe("MCP transports", () => {
  it("resolveTransportKind defaults to stdio", () => {
    expect(resolveTransportKind(undefined)).toBe("stdio");
    expect(resolveTransportKind("http")).toBe("http");
    expect(resolveTransportKind("sse")).toBe("sse");
  });

  it("http transport sends a JSON-RPC request and returns the matching response", async () => {
    const config: McpServerTransportConfig = { name: "svc", transport: "http", url: "https://mcp.example.com/rpc" };
    const fakeFetch = (async (url: string, init: RequestInit) => {
      expect(url).toBe("https://mcp.example.com/rpc");
      const body = JSON.parse(init.body as string);
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools: [] } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    const transport = createMcpTransport(config, {
      fetch: fakeFetch,
      resolveHostname: async () => ["93.184.216.34"],
    });
    await transport.start();
    const res = await transport.send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(res.id).toBe(1);
    expect(res.result).toEqual({ tools: [] });
    await transport.close();
  });

  it("stdio transport preserves the legacy path (throws, directing to existing mcpClient)", () => {
    expect(() => createMcpTransport({ name: "s", transport: "stdio", command: "x" })).toThrow("existing mcpClient");
  });
});

describe("runGraph model_response + totalUsage (P8 cost model)", () => {
  it("projects model_response nodes and aggregates totalUsage", () => {
    const run: AgentRunRecord = { id: "run-c", taskId: "t", taskName: "T", skillName: "s", status: "running", summary: "", events: [], startedAt: "2026-06-19T00:00:00.000Z", finishedAt: "" };
    const ev = (id: string, seq: number, payload: Record<string, unknown>): AgentTrajectoryEvent => ({
      id, runId: "run-c", type: "model_response", sequence: seq, payload,
      redaction: { containsApiKey: false, containsFileContent: false, containsUserText: false },
      createdAt: `2026-06-19T00:00:0${seq}.000Z`,
    });
    const graph = projectRunGraph({ run, trajectoryEvents: [
      ev("e1", 1, { usage: { inputTokens: 100, outputTokens: 50 }, cacheReadTokens: 20, cacheWriteTokens: 5 }),
      ev("e2", 2, { usage: { inputTokens: 80, outputTokens: 40 }, cacheReadTokens: 10, cacheWriteTokens: 0 }),
    ] });
    const kinds = graph.nodes.map((n) => n.kind);
    expect(kinds).toContain("model_response");
    expect(graph.totalUsage).toEqual({ inputTokens: 180, outputTokens: 90, cacheReadTokens: 30, cacheWriteTokens: 5 });
  });
});
