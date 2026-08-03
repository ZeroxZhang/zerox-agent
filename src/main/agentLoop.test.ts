import { describe, expect, it } from "vitest";
import { runAgentLoop as runProductionAgentLoop } from "./agentLoop";
import type { AgentLoopCheckpoint } from "./agentLoop";
import type { AgentToolExecutor } from "./agentToolExecutor";
import type {
  ChatClient,
  ChatCompletionRequest,
  ChatCompletionResponse,
  StreamingChatClient,
  StreamEvent,
  ToolDefinition,
} from "./openAiCompatibleClient";
import type {
  ToolResultOffloadStore,
  ToolResultOffloadWriteInput,
} from "./toolResultOffloadStore";

/** v3.6.0: Extract JSON content from XML-fenced tool result wrapper. */
function innerToolResultJson(content: string): string {
  return content.replace(/^<tool_result[^>]*>\n?/, "").replace(/\n?<\/tool_result>\s*$/, "");
}
import type { ToolAuthorizationService } from "./toolAuthorizationService";
import { createDynamicToolRegistry } from "./dynamicToolRegistry";
import type { ToolCallRequest } from "../shared/toolPermissions";
import type { ToolInvocationRecord } from "../shared/toolInvocationLedger";

const modelProfile = {
  baseUrl: "https://api.example.com/v1",
  apiKey: "secret",
  model: "agent-model",
  temperature: 0.2,
  maxTokens: 8192,
};

const testTools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "file_list",
      description: "List files",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
];

const chromeBookmarkTools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "chrome_bookmarks_read",
      description: "Read Chrome bookmarks",
      parameters: {
        type: "object",
        properties: { maxBookmarks: { type: "number" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "tool_result_read",
      description: "Read offloaded result",
      parameters: {
        type: "object",
        properties: { ref: { type: "string" } },
        required: ["ref"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "file_read",
      description: "Read file",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "file_stat",
      description: "Stat file",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "shell_exec",
      description: "Execute shell",
      parameters: {
        type: "object",
        properties: { command: { type: "string" } },
        required: ["command"],
      },
    },
  },
];

function runAgentLoop(...args: Parameters<typeof runProductionAgentLoop>) {
  const [messages, profile, options] = args;
  const allowAllAuthorization: ToolAuthorizationService = {
    async authorize(taskId, request) {
      return {
        ok: true,
        decision: { allowed: true, reason: "allowed by agent loop test fixture" },
        auditEvent: {
          id: `audit_${request.toolName}`,
          taskId,
          request,
          decision: {
            allowed: true,
            reason: "allowed by agent loop test fixture",
          },
          createdAt: "2026-07-12T00:00:00.000Z",
        },
      };
    },
  };
  return runProductionAgentLoop(messages, profile, {
    toolAuthorizationService: allowAllAuthorization,
    taskId: "task_agent_loop_test",
    ...options,
  });
}

describe("agent loop", () => {
  it("fails closed when a tool call has no authorization dependencies", async () => {
    let executed = false;
    let modelCalls = 0;
    const chatClient: ChatClient = {
      async complete(request) {
        modelCalls += 1;
        if (modelCalls === 1) {
          return {
            content: null,
            finishReason: "tool_calls",
            toolCalls: [
              {
                id: "call_unauthorized",
                type: "function",
                function: {
                  name: "file_list",
                  arguments: JSON.stringify({ path: "/tmp/workspace" }),
                },
              },
            ],
          };
        }

        expect(
          request.messages.some(
            (message) =>
              message.role === "tool" &&
              message.content.includes("工具授权服务未配置，已拒绝执行"),
          ),
        ).toBe(true);
        return {
          content: "工具未执行。",
          finishReason: "stop",
          toolCalls: [],
        };
      },
    };

    const result = await runProductionAgentLoop(
      [{ role: "user", content: "list files" }],
      modelProfile,
      {
        chatClient,
        toolExecutor: createToolExecutor(() => {
          executed = true;
        }),
        tools: testTools,
      },
    );

    expect(result.status).toBe("succeeded");
    expect(executed).toBe(false);
  });

  it("surfaces provider HTTP failures without an automatic retry", async () => {
    let attempts = 0;
    const retryEvents: Array<{ attempt: number; delayMs: number; error: string }> = [];
    const chatClient: ChatClient = {
      async complete() {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("LLM request failed with status 500: overloaded");
        }
        return {
          content: "重试后完成。",
          toolCalls: [],
          finishReason: "stop",
        };
      },
    };

    const result = await runAgentLoop(
      [{ role: "user", content: "总结一下" }],
      modelProfile,
      {
        chatClient,
        toolExecutor: createToolExecutor(),
        tools: testTools,
        modelRetry: { maxRetries: 2, baseDelayMs: 0, maxDelayMs: 0 },
        onModelRetry(event) {
          retryEvents.push(event);
        },
      },
    );

    expect(result).toMatchObject({
      status: "paused",
      summary: "模型服务商返回错误（HTTP 500），请根据服务商状态检查后手动重试。",
      modelServiceNotice: {
        kind: "provider_stop",
        statusCode: 500,
        rawReason: "HTTP 500",
      },
    });
    expect(attempts).toBe(1);
    expect(retryEvents).toEqual([]);
  });

  it("compacts messages before model requests when the context exceeds budget", async () => {
    const requests: ChatCompletionRequest[] = [];
    const contextUsageEvents: Array<{
      tokenBudget: number;
      compactionCount: number;
      messageCount: number;
    }> = [];
    const compactionEvents: Array<{
      tokenBudget: number;
      estimatedTokens: number;
      compactedTokens: number;
      strategy: string;
    }> = [];
    const chatClient: ChatClient = {
      async complete(request) {
        requests.push(request);
        return {
          content: "压缩后完成。",
          toolCalls: [],
          finishReason: "stop",
        };
      },
    };

    const result = await runAgentLoop(
      [
        { role: "user", content: "old request" },
        { role: "assistant", content: "old answer" },
        { role: "user", content: "current request" },
      ],
      { ...modelProfile, maxTokens: 128, contextWindow: 300 },
      {
        chatClient,
        toolExecutor: createToolExecutor(),
        tools: testTools,
        contextManager: {
          estimateTokens(messages) {
            return messages.length * 100;
          },
          compressMessages(messages) {
            return [
              messages[0],
              { role: "user", content: "[之前对话摘要]\nold request -> old answer" },
              messages.at(-1),
            ].filter(Boolean) as ChatCompletionRequest["messages"];
          },
        },
        onContextUsage(usage) {
          contextUsageEvents.push(usage);
        },
        onContextCompacted(event) {
          compactionEvents.push(event);
        },
      },
    );

    expect(result.status).toBe("succeeded");
    expect(requests[0].messages).toEqual([
      expect.objectContaining({ role: "system" }),
      { role: "user", content: "[之前对话摘要]\nold request -> old answer" },
      { role: "user", content: "current request" },
    ]);
    expect(compactionEvents).toEqual([
      expect.objectContaining({
        tokenBudget: 154,
        estimatedTokens: 400,
        compactedTokens: 300,
        strategy: "summarize",
      }),
    ]);
    expect(contextUsageEvents.at(-1)).toMatchObject({
      tokenBudget: 154,
      compactionCount: 1,
      messageCount: 3,
    });
    expect(result.contextUsage).toMatchObject({
      tokenBudget: 154,
      compactionCount: 1,
      lastCompaction: expect.objectContaining({
        beforeTokens: 400,
        afterTokens: 300,
      }),
    });
  });

  it("routes overflow compaction through the injected strategy when provided (P2)", async () => {
    const requests: ChatCompletionRequest[] = [];
    const chatClient: ChatClient = {
      async complete(request) {
        requests.push(request);
        return { content: "done", toolCalls: [], finishReason: "stop" };
      },
    };
    let strategyCalled = false;
    let compactedRunId = "";
    const compactionStrategy = {
      id: "rebuild" as const,
      shouldCompact: () => true,
      async compact(input: { runId: string }) {
        strategyCalled = true;
        compactedRunId = input.runId;
        return {
          messages: [{ role: "system", content: "[Goal continuity checkpoint - never compact]\nrebuilt prefix" }, { role: "user", content: "current request" }],
          compacted: true,
          beforeTokens: 500,
          afterTokens: 50,
          strategy: "rebuild" as const,
          rebuilt: true,
          checkpointRef: "checkpoints/r/x",
          memoryHits: [],
          microcompactedRefs: [],
        };
      },
    };

    const result = await runAgentLoop(
      [
        { role: "user", content: "old request" },
        { role: "assistant", content: "old answer" },
        { role: "user", content: "current request" },
      ],
      { ...modelProfile, maxTokens: 128 },
      {
        chatClient,
        toolExecutor: createToolExecutor(),
        tools: testTools,
        runId: "run_compaction",
        compactionStrategy: compactionStrategy as never,
        contextManager: {
          estimateTokens: () => 500, // exceeds budget → triggers compaction
          compressMessages: () => { throw new Error("legacy compress should not run when strategy provided"); },
        },
      },
    );

    expect(result.status).toBe("succeeded");
    expect(strategyCalled).toBe(true);
    expect(compactedRunId).toBe("run_compaction");
    expect(requests[0].messages.some((m) => m.content.includes("rebuilt prefix"))).toBe(true);
  });

  it("offloads oversized tool results before the next model turn", async () => {
    const largeContent = "x".repeat(1000);
    const requests: ChatCompletionRequest[] = [];
    const store = createRecordingOffloadStore();
    const chatClient: ChatClient = {
      async complete(request) {
        requests.push(request);
        if (requests.length === 1) {
          return toolCallResponse("tool_call_1");
        }

        const toolMessage = request.messages.find(
          (message) => message.role === "tool",
        );
        expect(toolMessage).toBeDefined();
        expect(toolMessage?.content).not.toContain(largeContent);
        // v3.6.0: content is XML-fenced; extract inner JSON for assertion
        const innerJson = innerToolResultJson(toolMessage?.content ?? "{}");
        expect(JSON.parse(innerJson)).toEqual(
          expect.objectContaining({
            type: "tool_result",
            tool: "file_list",
            ok: true,
            offloaded: true,
            result_ref: "tool-result-refs/ref_1.json",
          }),
        );

        return {
          content: "我已经基于引用化工具结果完成总结。",
          toolCalls: [],
          finishReason: "stop",
        };
      },
    };

    const result = await runAgentLoop(
      [{ role: "user", content: "检查这个目录并告诉我结果" }],
      modelProfile,
      {
        chatClient,
        toolExecutor: createToolExecutor(() => undefined, {
          content: largeContent,
        }),
        maxTurns: 4,
        tools: testTools,
        toolResultOffloadStore: store,
        toolResultOffloadThreshold: 120,
      },
    );

    expect(result).toMatchObject({
      status: "succeeded",
      toolCallsExecuted: 1,
    });
    expect(store.writes).toHaveLength(1);
    expect(store.writes[0].content).toContain(largeContent);
  });

  it("finalizes instead of executing a repeated identical tool call", async () => {
    const requests: ChatCompletionRequest[] = [];
    const chatClient: ChatClient = {
      async complete(request) {
        requests.push(request);
        if (requests.length <= 2) {
          return toolCallResponse(`tool_call_${requests.length}`);
        }

        expect(request.tools).toBeUndefined();
        expect(request.messages.at(-1)).toMatchObject({
          role: "system",
          content: expect.stringContaining("检测到模型重复请求相同工具"),
        });
        return {
          content: "我已经基于第一次目录结果完成总结。",
          toolCalls: [],
          finishReason: "stop",
        };
      },
    };
    let executions = 0;

    const result = await runAgentLoop(
      [{ role: "user", content: "检查这个目录并告诉我结果" }],
      modelProfile,
      {
        chatClient,
        toolExecutor: createToolExecutor(() => {
          executions += 1;
        }),
        maxTurns: 6,
        tools: testTools,
      },
    );

    expect(requests).toHaveLength(3);
    expect(executions).toBe(1);
    expect(result).toMatchObject({
      status: "succeeded",
      summary:
        "检测到模型重复请求相同工具，我先基于已有结果给出阶段性总结：\n\n我已经基于第一次目录结果完成总结。",
      turns: 1,
      toolCallsExecuted: 1,
    });
  });

  it("continues a direct execution segment after its checkpoint interval", async () => {
    const requests: ChatCompletionRequest[] = [];
    const chatClient: ChatClient = {
      async complete(request) {
        requests.push(request);
        if (requests.length <= 2) {
          return toolCallResponse(
            `tool_call_${requests.length}`,
            `/tmp/path_${requests.length}`,
          );
        }

        expect(request.tools).toEqual(testTools);
        return {
          content: "我已经检查完已有结果。",
          toolCalls: [],
          finishReason: "stop",
        };
      },
    };

    const result = await runAgentLoop(
      [{ role: "user", content: "检查这个目录并告诉我结果" }],
      modelProfile,
      {
        chatClient,
        toolExecutor: createToolExecutor(),
        maxTurns: 2,
        tools: testTools,
      },
    );

    expect(requests).toHaveLength(3);
    expect(result).toMatchObject({
      status: "succeeded",
      turns: 2,
      toolCallsExecuted: 2,
      summary: "我已经检查完已有结果。",
    });
    expect(result.continuation).toBeUndefined();
  });

  it("emits a strategy guard event when repeated single-tool calls fragment work", async () => {
    const guardEvents: Array<{ code: string; toolName?: string; count?: number }> = [];
    const requests: ChatCompletionRequest[] = [];
    const chatClient: ChatClient = {
      async complete(request) {
        requests.push(request);
        if (requests.length <= 4) {
          return toolCallResponse(
            `tool_call_${requests.length}`,
            `/tmp/path_${requests.length}`,
          );
        }

        return {
          content: "目录检查完成。",
          toolCalls: [],
          finishReason: "stop",
        };
      },
    };

    const result = await runAgentLoop(
      [{ role: "user", content: "递归检查这个目录" }],
      modelProfile,
      {
        chatClient,
        toolExecutor: createToolExecutor(),
        maxTurns: 6,
        tools: testTools,
        onStrategyGuard(event) {
          guardEvents.push(event);
        },
      },
    );

    expect(result.status).toBe("succeeded");
    expect(guardEvents).toEqual([
      {
        code: "FRAGMENTED_TOOL_CALLS",
        severity: "warn",
        message:
          "file_list has been called 4 times in one loop; switch to a batch or recursive strategy.",
        toolName: "file_list",
        count: 4,
      },
    ]);
    expect(
      requests[4]?.messages.some(
        (message) =>
          message.role === "system" &&
          message.content.includes("Strategy guard warning") &&
          message.content.includes("inventory"),
      ),
    ).toBe(true);
  });

  it("can pause instead of continuing after a strategy guard event", async () => {
    const requests: ChatCompletionRequest[] = [];
    const chatClient: ChatClient = {
      async complete(request) {
        requests.push(request);
        return toolCallResponse(
          `tool_call_${requests.length}`,
          `/tmp/path_${requests.length}`,
        );
      },
    };

    const result = await runAgentLoop(
      [{ role: "user", content: "把这个目录整理一下" }],
      modelProfile,
      {
        chatClient,
        toolExecutor: createToolExecutor(),
        maxTurns: 6,
        pauseOnStrategyGuard: true,
        tools: testTools,
      },
    );

    expect(requests).toHaveLength(4);
    expect(result).toMatchObject({
      status: "paused",
      turns: 3,
      toolCallsExecuted: 4,
      continuation: {
        reason: "strategy_guard",
        toolName: "file_list",
        strategyGuardCode: "FRAGMENTED_TOOL_CALLS",
        toolCallsExecuted: 4,
      },
    });
    expect(result.summary).toContain("策略守护触发");
    expect(result.summary).toContain("file_list");
    expect(result.summary).toContain("批量或递归策略");
  });

  it("nudges the model and emits a guard when exploration repeats across turns", async () => {
    const explorationTools: ToolDefinition[] = [
      testTools[0]!,
      {
        type: "function",
        function: {
          name: "file_read",
          description: "Read file",
          parameters: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
          },
        },
      },
    ];
    const guardEvents: Array<{ code: string; toolName?: string; count?: number }> = [];
    const requests: ChatCompletionRequest[] = [];
    // Alternating targets so the immediate-repeat finalizer never fires;
    // duplicates: turn 3 list(A)=1, turn 4 read(B)=2, turn 5 list(A)=3.
    const plannedCalls = [
      { name: "file_list", args: { path: "/tmp/project" } },
      { name: "file_read", args: { path: "/tmp/project/a.txt" } },
      { name: "file_list", args: { path: "/tmp/project" } },
      { name: "file_read", args: { path: "/tmp/project/a.txt" } },
      { name: "file_list", args: { path: "/tmp/project" } },
    ];
    const chatClient: ChatClient = {
      async complete(request) {
        requests.push(request);
        const planned = plannedCalls[requests.length - 1];
        if (planned) {
          return {
            content: null,
            finishReason: "tool_calls",
            toolCalls: [
              {
                id: `dedup_call_${requests.length}`,
                type: "function",
                function: {
                  name: planned.name,
                  arguments: JSON.stringify(planned.args),
                },
              },
            ],
          };
        }

        return {
          content: "探索完成。",
          toolCalls: [],
          finishReason: "stop",
        };
      },
    };

    const result = await runAgentLoop(
      [{ role: "user", content: "探索这个项目" }],
      modelProfile,
      {
        chatClient,
        toolExecutor: createToolExecutor(),
        maxTurns: 8,
        tools: explorationTools,
        onStrategyGuard(event) {
          guardEvents.push(event);
        },
      },
    );

    expect(result.status).toBe("succeeded");
    expect(result.toolCallsExecuted).toBe(5);
    // Every duplicate executes (never blocked), and the run never pauses.
    expect(result.continuation).toBeUndefined();
    // The request after the first duplicate carries the dedup nudge,
    // including a digest of the earlier read result so the model can
    // actually reuse it even if the original scrolled out of context.
    expect(
      requests[3]?.messages.some(
        (message) =>
          message.role === "system" &&
          message.content.includes("探索去重提示") &&
          message.content.includes("file_list /tmp/project") &&
          message.content.includes("a.txt"),
      ),
    ).toBe(true);
    // Third duplicate escalates to an observable guard event.
    expect(guardEvents).toEqual([
      {
        code: "REPEATED_EXPLORATION",
        severity: "warn",
        message:
          "The model has re-read already-explored targets 3 times in this run; reuse the existing evidence and focus on unexplored areas or the deliverable.",
        toolName: "file_list",
        count: 3,
      },
    ]);
  });

  it("treats re-reads after a successful write as fresh, not duplicates", async () => {
    const readWriteTools: ToolDefinition[] = [
      testTools[0]!,
      {
        type: "function",
        function: {
          name: "file_write",
          description: "Write file",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string" },
              content: { type: "string" },
            },
            required: ["path", "content"],
          },
        },
      },
    ];
    const requests: ChatCompletionRequest[] = [];
    const plannedCalls = [
      { name: "file_list", args: { path: "/tmp/project" } },
      { name: "file_write", args: { path: "/tmp/project/new.txt", content: "x" } },
      { name: "file_list", args: { path: "/tmp/project" } },
    ];
    const chatClient: ChatClient = {
      async complete(request) {
        requests.push(request);
        const planned = plannedCalls[requests.length - 1];
        if (planned) {
          return {
            content: null,
            finishReason: "tool_calls",
            toolCalls: [
              {
                id: `fresh_call_${requests.length}`,
                type: "function",
                function: {
                  name: planned.name,
                  arguments: JSON.stringify(planned.args),
                },
              },
            ],
          };
        }

        return {
          content: "完成。",
          toolCalls: [],
          finishReason: "stop",
        };
      },
    };

    const result = await runAgentLoop(
      [{ role: "user", content: "写入一个新文件再确认目录" }],
      modelProfile,
      {
        chatClient,
        toolExecutor: createToolExecutor(),
        maxTurns: 6,
        tools: readWriteTools,
      },
    );

    expect(result.status).toBe("succeeded");
    expect(result.toolCallsExecuted).toBe(3);
    // The final request must NOT contain a dedup nudge: the write
    // invalidated the earlier read, so the re-list was legitimate.
    expect(
      requests[3]?.messages.some(
        (message) =>
          message.role === "system" && message.content.includes("探索去重提示"),
      ) ?? false,
    ).toBe(false);
  });

  it("does not pause normal multi-file code generation after four file writes", async () => {
    let requests = 0;
    const guardEvents: string[] = [];
    const fileWriteTool: ToolDefinition = {
      type: "function",
      function: {
        name: "file_write",
        description: "Write one project file",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string" },
            content: { type: "string" },
          },
          required: ["path", "content"],
        },
      },
    };
    const chatClient: ChatClient = {
      async complete() {
        requests += 1;
        if (requests <= 4) {
          return {
            content: null,
            finishReason: "tool_calls",
            toolCalls: [
              {
                id: `write_${requests}`,
                type: "function",
                function: {
                  name: "file_write",
                  arguments: JSON.stringify({
                    path: `/tmp/project/file_${requests}.ts`,
                    content: `export const value${requests} = ${requests};`,
                  }),
                },
              },
            ],
          };
        }
        return {
          content: "四个项目文件已经生成并验证。",
          finishReason: "stop",
          toolCalls: [],
        };
      },
    };

    const result = await runAgentLoop(
      [{ role: "user", content: "实现一个包含四个源码文件的功能" }],
      modelProfile,
      {
        chatClient,
        toolExecutor: createToolExecutor(),
        maxTurns: 6,
        pauseOnStrategyGuard: true,
        tools: [fileWriteTool],
        onStrategyGuard(event) {
          guardEvents.push(event.code);
        },
      },
    );

    expect(result).toMatchObject({
      status: "succeeded",
      toolCallsExecuted: 4,
      summary: "四个项目文件已经生成并验证。",
    });
    expect(guardEvents).toEqual([]);
  });

  it("keeps paused multi-tool histories provider-valid by not leaving unmatched tool calls", async () => {
    const requests: ChatCompletionRequest[] = [];
    const chatClient: ChatClient = {
      async complete(request) {
        requests.push(request);
        if (requests.length <= 3) {
          return toolCallResponse(
            `warmup_call_${requests.length}`,
            `/tmp/warmup-${requests.length}`,
          );
        }

        return {
          content: null,
          finishReason: "tool_calls",
          toolCalls: [
            {
              id: "provider_call_first",
              type: "function",
              function: {
                name: "file_list",
                arguments: JSON.stringify({ path: "/tmp/first" }),
              },
            },
            {
              id: "provider_call_second",
              type: "function",
              function: {
                name: "file_list",
                arguments: JSON.stringify({ path: "/tmp/second" }),
              },
            },
          ],
        };
      },
    };

    const result = await runAgentLoop(
      [{ role: "user", content: "检查多个目录，但在策略守护触发时暂停" }],
      modelProfile,
      {
        chatClient,
        toolExecutor: createToolExecutor(),
        maxTurns: 6,
        pauseOnStrategyGuard: true,
        tools: testTools,
      },
    );

    expect(result.status).toBe("paused");
    expect(result.toolCallsExecuted).toBe(4);
    expect(everyAssistantToolCallHasResult(result.messages)).toBe(true);
  });

  it("blocks shell fallback after chrome_bookmarks_read has returned structured data", async () => {
    const requests: ChatCompletionRequest[] = [];
    const executedTools: string[] = [];
    const authorizedTools: string[] = [];
    const chatClient: ChatClient = {
      async complete(request) {
        requests.push(request);
        if (requests.length === 1) {
          return {
            content: null,
            finishReason: "tool_calls",
            toolCalls: [
              {
                id: "tool_call_bookmarks",
                type: "function",
                function: {
                  name: "chrome_bookmarks_read",
                  arguments: JSON.stringify({ maxBookmarks: 10000 }),
                },
              },
            ],
          };
        }
        if (requests.length === 2) {
          return {
            content: null,
            finishReason: "tool_calls",
            toolCalls: [
              {
                id: "tool_call_shell",
                type: "function",
                function: {
                  name: "shell_exec",
                  arguments: JSON.stringify({
                    command:
                      'cat "/Users/demo/Library/Application Support/Google/Chrome/Default/Bookmarks" | python3 parse.py',
                  }),
                },
              },
            ],
          };
        }
        return {
          content: "Chrome 书签：\\n- OpenAI - https://openai.com/",
          finishReason: "stop",
          toolCalls: [],
        };
      },
    };
    const toolExecutor: AgentToolExecutor = {
      async execute(request) {
        executedTools.push(request.toolName);
        return {
          ok: true,
          result: {
            answerPreview: "Chrome 书签：\\n- OpenAI - https://openai.com/",
            bookmarkCount: 1,
          },
        };
      },
      getRegistry() {
        throw new Error("not used");
      },
      hasTool() {
        return true;
      },
    };
    const toolAuthorizationService: ToolAuthorizationService = {
      async authorize(_taskId, request) {
        authorizedTools.push(request.toolName);
        return {
          ok: true,
          decision: { allowed: true, reason: "allowed" },
          auditEvent: {
            id: `audit_${authorizedTools.length}`,
            taskId: "task_chrome",
            request,
            decision: { allowed: true, reason: "allowed" },
            createdAt: "2026-06-16T00:00:00.000Z",
          },
        };
      },
    };

    const result = await runAgentLoop(
      [{ role: "user", content: "看一下 Chrome 浏览器的书签" }],
      modelProfile,
      {
        chatClient,
        toolExecutor,
        toolAuthorizationService,
        taskId: "task_chrome",
        tools: chromeBookmarkTools,
      },
    );

    expect(result.status).toBe("succeeded");
    expect(executedTools).toEqual(["chrome_bookmarks_read"]);
    expect(authorizedTools).toEqual(["chrome_bookmarks_read"]);
    expect(requests).toHaveLength(3);
    expect(JSON.stringify(requests[2].messages)).toContain(
      "chrome_bookmarks_read already returned structured Chrome bookmark data",
    );
  });

  it("self-finalizes after chrome_bookmarks_read returns an answer preview and artifacts", async () => {
    const requests: ChatCompletionRequest[] = [];
    const executedTools: string[] = [];
    const chatClient: ChatClient = {
      async complete(request) {
        requests.push(request);
        return {
          content: null,
          finishReason: "tool_calls",
          toolCalls: [
            {
              id: "tool_call_bookmarks",
              type: "function",
              function: {
                name: "chrome_bookmarks_read",
                arguments: JSON.stringify({ maxBookmarks: 10000 }),
              },
            },
          ],
        };
      },
    };
    const toolExecutor: AgentToolExecutor = {
      async execute(request) {
        executedTools.push(request.toolName);
        return {
          ok: true,
          result: {
            answerPreview:
              "Chrome 书签：共找到 335 个书签，完整清单已写入 bookmark_list.md。",
            artifactRef: "artifact:bookmark_list",
            artifactPath:
              "/Users/demo/Zerox Agent/workspaces/default/bookmark_list.md",
            goalEvidenceRef: "artifact:goalEvidence",
          },
        };
      },
      getRegistry() {
        throw new Error("not used");
      },
      hasTool() {
        return true;
      },
    };

    const result = await runAgentLoop(
      [{ role: "user", content: "看一下 Chrome 浏览器的书签" }],
      modelProfile,
      {
        chatClient,
        toolExecutor,
        tools: chromeBookmarkTools,
      },
    );

    expect(result).toMatchObject({
      status: "succeeded",
      turns: 0,
      toolCallsExecuted: 1,
      summary:
        "Chrome 书签：共找到 335 个书签，完整清单已写入 bookmark_list.md。",
    });
    expect(requests).toHaveLength(1);
    expect(executedTools).toEqual(["chrome_bookmarks_read"]);
  });

  it("emits tool invocation ledger states during authorized execution", async () => {
    const invocations: ToolInvocationRecord[] = [];
    const chatClient: ChatClient = {
      async complete(request) {
        if (!request.messages.some((message) => message.role === "tool")) {
          return {
            content: null,
            finishReason: "tool_calls",
            toolCalls: [
              {
                id: "tool_call_files",
                type: "function",
                function: {
                  name: "file_list",
                  arguments: JSON.stringify({ path: "/tmp/workspace" }),
                },
              },
            ],
          };
        }
        return {
          content: "done",
          finishReason: "stop",
          toolCalls: [],
        };
      },
    };
    const toolExecutor: AgentToolExecutor = {
      async execute() {
        return { ok: true, result: { entries: [] } };
      },
      getRegistry() {
        return createDynamicToolRegistry();
      },
      hasTool() {
        return true;
      },
    };
    const toolAuthorizationService: ToolAuthorizationService = {
      async authorize(_taskId, request) {
        return {
          ok: true,
          decision: { allowed: true, reason: "allowed" },
          auditEvent: {
            id: "audit_1",
            taskId: "task_files",
            request,
            decision: { allowed: true, reason: "allowed" },
            createdAt: "2026-06-25T00:00:00.000Z",
          },
        };
      },
    };

    const result = await runAgentLoop(
      [{ role: "user", content: "list files" }],
      modelProfile,
      {
        chatClient,
        toolExecutor,
        toolAuthorizationService,
        taskId: "task_files",
        tools: testTools,
        onToolInvocation(record) {
          invocations.push(record);
        },
      },
    );

    expect(result.status).toBe("succeeded");
    expect(invocations.map((record) => record.status)).toEqual([
      "proposed",
      "visible",
      "authorized",
      "running",
      "completed",
    ]);
    expect(invocations.at(-1)).toMatchObject({
      toolCallId: "tool_call_files",
      toolName: "file_list",
      ok: true,
    });
  });

  it("blocks raw Chrome Bookmarks file probes after chrome_bookmarks_read succeeds", async () => {
    const requests: ChatCompletionRequest[] = [];
    const executedTools: string[] = [];
    const authorizedTools: string[] = [];
    const chatClient: ChatClient = {
      async complete(request) {
        requests.push(request);
        if (requests.length === 1) {
          return {
            content: null,
            finishReason: "tool_calls",
            toolCalls: [
              {
                id: "tool_call_bookmarks",
                type: "function",
                function: {
                  name: "chrome_bookmarks_read",
                  arguments: JSON.stringify({ maxBookmarks: 10000 }),
                },
              },
            ],
          };
        }
        if (requests.length === 2) {
          return {
            content: null,
            finishReason: "tool_calls",
            toolCalls: [
              {
                id: "tool_call_stat",
                type: "function",
                function: {
                  name: "file_stat",
                  arguments: JSON.stringify({
                    path:
                      "/Users/demo/Library/Application Support/Google/Chrome/Default/Bookmarks",
                  }),
                },
              },
            ],
          };
        }
        return {
          content: "Chrome 书签：\\n- OpenAI - https://openai.com/",
          finishReason: "stop",
          toolCalls: [],
        };
      },
    };
    const toolExecutor: AgentToolExecutor = {
      async execute(request) {
        executedTools.push(request.toolName);
        return {
          ok: true,
          result: {
            answerPreview: "Chrome 书签：\\n- OpenAI - https://openai.com/",
            bookmarkCount: 1,
          },
        };
      },
      getRegistry() {
        throw new Error("not used");
      },
      hasTool() {
        return true;
      },
    };
    const toolAuthorizationService: ToolAuthorizationService = {
      async authorize(_taskId, request) {
        authorizedTools.push(request.toolName);
        return {
          ok: true,
          decision: { allowed: true, reason: "allowed" },
          auditEvent: {
            id: `audit_${authorizedTools.length}`,
            taskId: "task_chrome",
            request,
            decision: { allowed: true, reason: "allowed" },
            createdAt: "2026-06-16T00:00:00.000Z",
          },
        };
      },
    };

    const result = await runAgentLoop(
      [{ role: "user", content: "看一下 Chrome 浏览器的书签" }],
      modelProfile,
      {
        chatClient,
        toolExecutor,
        toolAuthorizationService,
        taskId: "task_chrome",
        tools: chromeBookmarkTools,
      },
    );

    expect(result.status).toBe("succeeded");
    expect(executedTools).toEqual(["chrome_bookmarks_read"]);
    expect(authorizedTools).toEqual(["chrome_bookmarks_read"]);
    expect(JSON.stringify(requests[2].messages)).toContain(
      "Do not inspect the raw Chrome Bookmarks path",
    );
  });

  it("blocks shell inspection of the bookmark artifact after chrome_bookmarks_read succeeds", async () => {
    const requests: ChatCompletionRequest[] = [];
    const executedTools: string[] = [];
    const authorizedTools: string[] = [];
    const chatClient: ChatClient = {
      async complete(request) {
        requests.push(request);
        if (requests.length === 1) {
          return {
            content: null,
            finishReason: "tool_calls",
            toolCalls: [
              {
                id: "tool_call_bookmarks",
                type: "function",
                function: {
                  name: "chrome_bookmarks_read",
                  arguments: JSON.stringify({ maxBookmarks: 10000 }),
                },
              },
            ],
          };
        }
        if (requests.length === 2) {
          return {
            content: null,
            finishReason: "tool_calls",
            toolCalls: [
              {
                id: "tool_call_read_artifact",
                type: "function",
                function: {
                  name: "file_read",
                  arguments: JSON.stringify({
                    path:
                      "/Users/demo/Zerox Agent/workspaces/default/bookmark_list.md",
                  }),
                },
              },
              {
                id: "tool_call_result_artifact",
                type: "function",
                function: {
                  name: "tool_result_read",
                  arguments: JSON.stringify({ ref: "artifact:bookmark_list" }),
                },
              },
              {
                id: "tool_call_shell_artifact",
                type: "function",
                function: {
                  name: "shell_exec",
                  arguments: JSON.stringify({
                    command:
                      'wc -l "/Users/demo/Zerox Agent/workspaces/default/bookmark_list.md" && head -5 "/Users/demo/Zerox Agent/workspaces/default/bookmark_list.md"',
                  }),
                },
              },
            ],
          };
        }
        return {
          content: "Chrome 书签完整清单已写入 bookmark_list.md。",
          finishReason: "stop",
          toolCalls: [],
        };
      },
    };
    const toolExecutor: AgentToolExecutor = {
      async execute(request) {
        executedTools.push(request.toolName);
        return {
          ok: true,
          result: {
            artifactRef: "artifact:bookmark_list",
            artifactPath:
              "/Users/demo/Zerox Agent/workspaces/default/bookmark_list.md",
          },
        };
      },
      getRegistry() {
        throw new Error("not used");
      },
      hasTool() {
        return true;
      },
    };
    const toolAuthorizationService: ToolAuthorizationService = {
      async authorize(_taskId, request) {
        authorizedTools.push(request.toolName);
        return {
          ok: true,
          decision: { allowed: true, reason: "allowed" },
          auditEvent: {
            id: `audit_${authorizedTools.length}`,
            taskId: "task_chrome",
            request,
            decision: { allowed: true, reason: "allowed" },
            createdAt: "2026-06-16T00:00:00.000Z",
          },
        };
      },
    };

    const result = await runAgentLoop(
      [{ role: "user", content: "看一下 Chrome 浏览器的书签" }],
      modelProfile,
      {
        chatClient,
        toolExecutor,
        toolAuthorizationService,
        taskId: "task_chrome",
        tools: chromeBookmarkTools,
      },
    );

    expect(result.status).toBe("succeeded");
    expect(executedTools).toEqual(["chrome_bookmarks_read"]);
    expect(authorizedTools).toEqual(["chrome_bookmarks_read"]);
    expect(JSON.stringify(requests[2].messages)).toContain(
      "bookmark_list artifact was already written",
    );
    expect(JSON.stringify(requests[2].messages)).toContain(
      "Do not read bookmark_list.md back into the model",
    );
    expect(JSON.stringify(requests[2].messages)).toContain(
      "artifact refs are evidence references, not tool_result_read refs",
    );
  });

  it("saves a turn checkpoint and continues automatically", async () => {
    const requests: ChatCompletionRequest[] = [];
    const checkpoints: AgentLoopCheckpoint[] = [];
    const chatClient: ChatClient = {
      async complete(request) {
        requests.push(request);
        if (requests.length > 2) {
          return {
            content: "目录检查完成。",
            toolCalls: [],
            finishReason: "stop",
          };
        }
        return toolCallResponse(
          `tool_call_${requests.length}`,
          `/tmp/path_${requests.length}`,
        );
      },
    };

    const result = await runAgentLoop(
      [{ role: "user", content: "检查这个目录并告诉我结果" }],
      modelProfile,
      {
        chatClient,
        toolExecutor: createToolExecutor(),
        maxTurns: 2,
        pauseOnTurnLimit: true,
        tools: testTools,
        onCheckpoint(checkpoint) {
          checkpoints.push(checkpoint);
        },
      },
    );

    expect(requests).toHaveLength(3);
    expect(result).toMatchObject({
      status: "succeeded",
      turns: 2,
      toolCallsExecuted: 2,
      summary: "目录检查完成。",
    });
    expect(result.continuation).toBeUndefined();
    expect(checkpoints.at(-1)).toMatchObject({
      turns: 2,
      toolCallsExecuted: 2,
      nextAction:
        "Checkpoint interval reached; state saved and execution continues automatically.",
    });
  });

  it("pauses when the model keeps hitting the same class of tool failure after recovery", async () => {
    const requests: ChatCompletionRequest[] = [];
    const chatClient: ChatClient = {
      async complete(request) {
        requests.push(request);
        return toolCallResponse(
          `tool_call_${requests.length}`,
          `/tmp/path_${requests.length}`,
        );
      },
    };

    const result = await runAgentLoop(
      [{ role: "user", content: "运行一个会静默失败的脚本" }],
      modelProfile,
      {
        chatClient,
        toolExecutor: createToolExecutor(undefined, undefined, {
          ok: false,
          error: "shell_exec 失败：退出码 1，未产生 stdout/stderr。",
          errorDetails: {
            kind: "empty_exit",
            tool: "shell_exec",
            exitCode: 1,
          },
        }),
        maxTurns: 6,
        pauseOnFailureLoop: true,
        tools: testTools,
      },
    );

    expect(requests).toHaveLength(6);
    expect(result).toMatchObject({
      status: "paused",
      turns: 5,
      toolCallsExecuted: 6,
      continuation: {
        reason: "tool_failure_loop",
        toolCallsExecuted: 6,
      },
    });
    expect(result.summary).toContain("连续 3 次工具失败");
    expect(result.summary).toContain("file_list");
  });

  it("reports the last tool failure when the model returns an empty follow-up response", async () => {
    const chatClient: ChatClient = {
      async complete(request) {
        if (request.messages.some((message) => message.role === "tool")) {
          return {
            content: null,
            finishReason: "stop",
            toolCalls: [],
          };
        }
        return toolCallResponse("tool_call_missing_url", "/missing-url");
      },
    };

    const result = await runAgentLoop(
      [{ role: "user", content: "查一下昨天双色球开奖结果" }],
      modelProfile,
      {
        chatClient,
        toolExecutor: createToolExecutor(undefined, undefined, {
          ok: false,
          error: "web_fetch URL must be a valid http(s) URL.",
        }),
        maxTurns: 3,
        tools: testTools,
      },
    );

    expect(result).toMatchObject({
      status: "failed",
      toolCallsExecuted: 1,
    });
    expect(result.summary).toContain("模型没有返回可用回复");
    expect(result.summary).toContain("file_list");
    expect(result.summary).toContain("web_fetch URL must be a valid http(s) URL.");
    expect(result.summary).not.toContain("Agent did not produce a response.");
  });

  it("uses reasoning content as the final reply when the model omits formal content after tool success", async () => {
    const chatClient: ChatClient = {
      async complete(request) {
        if (request.messages.some((message) => message.role === "tool")) {
          return {
            content: null,
            reasoningContent:
              "## 🏆 一等奖（6+1）\n- 中奖注数：4注\n- 单注奖金：8,287,457元\n- 地区分布：浙江、广东、山东、湖南各1注",
            finishReason: "stop",
            toolCalls: [],
          };
        }
        return toolCallResponse("tool_call_search", "/search-result");
      },
    };

    const result = await runAgentLoop(
      [{ role: "user", content: "查一下昨天双色球开奖结果" }],
      modelProfile,
      {
        chatClient,
        toolExecutor: createToolExecutor(),
        maxTurns: 3,
        tools: testTools,
      },
    );

    expect(result).toMatchObject({
      status: "succeeded",
      toolCallsExecuted: 1,
    });
    expect(result.summary).toContain("一等奖（6+1）");
    expect(result.summary).toContain("中奖注数：4注");
    expect(result.summary).not.toContain("模型没有返回可用回复");
  });

  it("asks the model to recover once from repeated tool failures before pausing", async () => {
    const requests: ChatCompletionRequest[] = [];
    const chatClient: ChatClient = {
      async complete(request) {
        requests.push(request);
        if (requests.length === 1) {
          return {
            content: null,
            finishReason: "tool_calls",
            toolCalls: [1, 2, 3].map((index) => ({
              id: `tool_call_${index}`,
              type: "function" as const,
              function: {
                name: "file_list",
                arguments: JSON.stringify({ path: `/missing-${index}` }),
              },
            })),
          };
        }

        expect(request.messages.at(-1)).toMatchObject({
          role: "system",
          content: expect.stringContaining("连续 3 次工具失败"),
        });
        expect(request.messages.at(-1)?.content).toContain("/missing-3");
        return {
          content: "我会基于已有结果继续，不再猜测不存在的路径。",
          toolCalls: [],
          finishReason: "stop",
        };
      },
    };

    const result = await runAgentLoop(
      [{ role: "user", content: "深度理解项目后生成 onepage" }],
      modelProfile,
      {
        chatClient,
        toolExecutor: createToolExecutor(undefined, undefined, {
          ok: false,
          error: "ENOENT: no such file or directory, scandir '/missing-3'",
        }),
        maxTurns: 6,
        pauseOnFailureLoop: true,
        tools: testTools,
      },
    );

    expect(requests).toHaveLength(2);
    expect(result).toMatchObject({
      status: "succeeded",
      toolCallsExecuted: 3,
      summary: "我会基于已有结果继续，不再猜测不存在的路径。",
    });
  });

  it("runs beyond 64 iterations and tool calls without enforcing legacy budgets", async () => {
    const baseExecutor = createToolExecutor();
    let executed = 0;
    let modelCalls = 0;
    let checkpointToolCalls = 0;
    const result = await runAgentLoop(
      [{ role: "user", content: "inspect many paths" }],
      modelProfile,
      {
        chatClient: {
          async complete() {
            modelCalls += 1;
            if (modelCalls > 65) {
              return {
                content: "all paths inspected",
                finishReason: "stop",
                toolCalls: [],
              };
            }
            return {
              content: null,
              finishReason: "tool_calls",
              toolCalls: [{
                id: `call_${modelCalls}`,
                type: "function" as const,
                function: {
                  name: "file_list",
                  arguments: JSON.stringify({ path: `/tmp/${modelCalls}` }),
                },
              }],
            };
          },
        },
        toolExecutor: {
          ...baseExecutor,
          async execute(request, options) {
            executed += 1;
            return baseExecutor.execute(request, options);
          },
        },
        tools: testTools,
        maxTurns: 2,
        maxToolCalls: 1,
        async onCheckpoint(checkpoint) {
          checkpointToolCalls = checkpoint.toolCallsExecuted;
        },
      },
    );

    expect(modelCalls).toBe(66);
    expect(executed).toBe(65);
    expect(result.toolCallsExecuted).toBe(65);
    expect(checkpointToolCalls).toBe(65);
    expect(result).toMatchObject({
      status: "succeeded",
      summary: "all paths inspected",
      turns: 65,
    });
  });

  it("does not abort a model request because of the legacy wall-clock budget", async () => {
    const result = await runAgentLoop(
      [{ role: "user", content: "wait forever" }],
      modelProfile,
      {
        chatClient: {
          async complete() {
            await new Promise((resolve) => setTimeout(resolve, 20));
            return {
              content: "completed after the legacy deadline",
              toolCalls: [],
              finishReason: "stop",
            };
          },
        },
        toolExecutor: createToolExecutor(),
        tools: testTools,
        maxTurns: 2,
        maxWallClockMs: 10,
      },
    );

    expect(result.status).toBe("succeeded");
    expect(result.summary).toContain("completed after the legacy deadline");
  });

  it("records token telemetry without enforcing the legacy token budget", async () => {
    const result = await runAgentLoop(
      [{ role: "user", content: "produce a long answer" }],
      modelProfile,
      {
        chatClient: {
          async complete() {
            return {
              content: "budgeted ".repeat(200),
              toolCalls: [],
              finishReason: "stop",
            };
          },
        },
        toolExecutor: createToolExecutor(),
        tools: testTools,
        maxTurns: 2,
        tokenBudget: 8,
      },
    );

    expect(result.status).toBe("succeeded");
    expect(result.summary).toContain("budgeted");
    expect(result.tokensConsumed).toBeGreaterThanOrEqual(8);
  });

  it("passes dynamic registry source to tool authorization", async () => {
    const requests: ChatCompletionRequest[] = [];
    const authorizationRequests: ToolCallRequest[] = [];
    const executionRequests: ToolCallRequest[] = [];
    const chatClient: ChatClient = {
      async complete(request) {
        requests.push(request);
        if (requests.length === 1) {
          return dynamicToolCallResponse("tool_call_1");
        }

        return {
          content: "动态工具已经执行。",
          toolCalls: [],
          finishReason: "stop",
        };
      },
    };
    const toolAuthorizationService: ToolAuthorizationService = {
      async authorize(_taskId, request) {
        authorizationRequests.push(request);
        return {
          ok: true,
          decision: { allowed: true, reason: "allowed" },
          auditEvent: {
            id: "audit_1",
            taskId: "task_1",
            request,
            decision: { allowed: true, reason: "allowed" },
            createdAt: "2026-06-11T00:00:00.000Z",
          },
        };
      },
    };

    const result = await runAgentLoop(
      [{ role: "user", content: "查一下来源" }],
      modelProfile,
      {
        chatClient,
        toolExecutor: createDynamicSourceToolExecutor(
          "mcp:research-writer:source-fetcher",
          executionRequests,
        ),
        toolAuthorizationService,
        taskId: "task_1",
        maxTurns: 4,
        tools: [
          {
            type: "function",
            function: {
              name: "remote_source_lookup",
              description: "Lookup source",
              parameters: { type: "object", properties: {}, required: [] },
            },
          },
        ],
      },
    );

    expect(result.status).toBe("succeeded");
    expect(authorizationRequests).toEqual([
      {
        toolName: "remote_source_lookup",
        source: "mcp:research-writer:source-fetcher",
        args: { query: "agent eval" },
      },
    ]);
    expect(executionRequests[0]?.source).toBe(
      "mcp:research-writer:source-fetcher",
    );
  });

  it("streams model deltas while aggregating the final tool call before authorization", async () => {
    const modelEvents: StreamEvent[] = [];
    const previewSnapshots: Array<{ authorized: number; executed: number }> = [];
    const authorizationRequests: ToolCallRequest[] = [];
    const executedTools: string[] = [];
    let completeCalls = 0;
    let streamCalls = 0;
    const chatClient: ChatClient & StreamingChatClient = {
      async complete() {
        completeCalls += 1;
        throw new Error("non-streaming complete should not be used");
      },
      async *streamComplete() {
        streamCalls += 1;
        if (streamCalls === 1) {
          yield { type: "content_delta", text: "I will inspect. " };
          yield { type: "reasoning_delta", text: "Need a directory listing." };
          yield {
            type: "tool_call_delta",
            id: "stream_call_1",
            name: "file_list",
            arguments: '{"path"',
          };
          yield {
            type: "tool_call_delta",
            id: "stream_call_1",
            name: "",
            arguments: ':"/denied"}',
          };
          yield { type: "done", finishReason: "tool_calls" };
          return;
        }
        yield { type: "content_delta", text: "I cannot access that path." };
        yield { type: "done", finishReason: "stop" };
      },
    };
    const toolAuthorizationService: ToolAuthorizationService = {
      async authorize(_taskId, request) {
        authorizationRequests.push(request);
        return {
          ok: true,
          decision: { allowed: false, reason: "permission denied" },
          auditEvent: {
            id: "audit_stream_1",
            taskId: "task_stream",
            request,
            decision: { allowed: false, reason: "permission denied" },
            createdAt: "2026-06-23T00:00:00.000Z",
          },
        };
      },
    };

    const result = await runAgentLoop(
      [{ role: "user", content: "list /denied" }],
      modelProfile,
      {
        chatClient,
        toolExecutor: createToolExecutor(() => {
          executedTools.push("file_list");
        }),
        toolAuthorizationService,
        taskId: "task_stream",
        tools: testTools,
        onModelStreamEvent(event) {
          modelEvents.push(event);
          if (event.type === "tool_call_delta") {
            previewSnapshots.push({
              authorized: authorizationRequests.length,
              executed: executedTools.length,
            });
          }
        },
      },
    );

    expect(result).toMatchObject({
      status: "succeeded",
      summary: "I cannot access that path.",
      toolCallsExecuted: 0,
    });
    expect(completeCalls).toBe(0);
    expect(streamCalls).toBe(2);
    expect(modelEvents).toEqual(
      expect.arrayContaining([
        { type: "content_delta", text: "I will inspect. " },
        { type: "reasoning_delta", text: "Need a directory listing." },
        expect.objectContaining({
          type: "tool_call_delta",
          id: "stream_call_1",
          name: "file_list",
        }),
      ]),
    );
    expect(previewSnapshots).toEqual([
      { authorized: 0, executed: 0 },
      { authorized: 0, executed: 0 },
    ]);
    expect(authorizationRequests).toEqual([
      {
        toolName: "file_list",
        args: { path: "/denied" },
      },
    ]);
    expect(executedTools).toEqual([]);
  });

  it("falls back to complete when streaming fails before any model delta", async () => {
    let completeCalls = 0;
    let streamCalls = 0;
    let executions = 0;
    const chatClient: ChatClient & StreamingChatClient = {
      async complete() {
        completeCalls += 1;
        return {
          content: "fallback complete response",
          toolCalls: [],
          finishReason: "stop",
        };
      },
      async *streamComplete() {
        streamCalls += 1;
        throw new Error("stream endpoint unavailable");
      },
    };

    const result = await runAgentLoop(
      [{ role: "user", content: "summarize without tools" }],
      modelProfile,
      {
        chatClient,
        toolExecutor: createToolExecutor(() => {
          executions += 1;
        }),
        tools: testTools,
      },
    );

    expect(result).toMatchObject({
      status: "succeeded",
      summary: "fallback complete response",
      toolCallsExecuted: 0,
    });
    expect(streamCalls).toBe(1);
    expect(completeCalls).toBe(1);
    expect(executions).toBe(0);
  });

  it("preserves partial streamed output and pauses on an output limit", async () => {
    let completeCalls = 0;
    const chatClient: ChatClient & StreamingChatClient = {
      async complete() {
        completeCalls += 1;
        throw new Error("output-limit streams must not fall back to complete");
      },
      async *streamComplete() {
        yield { type: "content_delta", text: "partial answer" };
        yield {
          type: "done",
          finishReason: "length",
          modelServiceNotice: {
            kind: "output_limit",
            provider: "test-provider",
            model: "agent-model",
            rawReason: "length",
            message: "模型输出达到限制。",
          },
        };
      },
    };

    const result = await runAgentLoop(
      [{ role: "user", content: "write a long answer" }],
      modelProfile,
      {
        chatClient,
        toolExecutor: createToolExecutor(),
        tools: testTools,
      },
    );

    expect(result).toMatchObject({
      status: "paused",
      summary: "partial answer",
      continuation: { reason: "provider_output_limit" },
      modelServiceNotice: { kind: "output_limit" },
    });
    expect(result.messages.at(-1)).toEqual({
      role: "assistant",
      content: "partial answer",
    });
    expect(completeCalls).toBe(0);
  });

  it("does not fall back or auto-retry when a stream is rate limited", async () => {
    let completeCalls = 0;
    let streamCalls = 0;
    const chatClient: ChatClient & StreamingChatClient = {
      async complete() {
        completeCalls += 1;
        return {
          content: "unexpected retry",
          toolCalls: [],
          finishReason: "stop",
        };
      },
      async *streamComplete() {
        streamCalls += 1;
        throw Object.assign(new Error("HTTP 429"), {
          statusCode: 429,
          code: "rate_limit_exceeded",
          responseHeaders: { "retry-after-ms": "500" },
        });
      },
    };

    const result = await runAgentLoop(
      [{ role: "user", content: "retry only when I ask" }],
      modelProfile,
      {
        chatClient,
        toolExecutor: createToolExecutor(),
        tools: testTools,
        modelRetry: { maxRetries: 3, sleep: async () => undefined },
      },
    );

    expect(result).toMatchObject({
      status: "paused",
      continuation: { reason: "provider_rate_limit" },
      modelServiceNotice: {
        kind: "rate_limit",
        statusCode: 429,
        retryAfterMs: 500,
      },
    });
    expect(streamCalls).toBe(1);
    expect(completeCalls).toBe(0);
  });

  it("does not fall back to complete after a streamed answer delta", async () => {
    let completeCalls = 0;
    const modelEvents: StreamEvent[] = [];
    const chatClient: ChatClient & StreamingChatClient = {
      async complete() {
        completeCalls += 1;
        return {
          content: "duplicate fallback response",
          toolCalls: [],
          finishReason: "stop",
        };
      },
      async *streamComplete() {
        yield { type: "content_delta", text: "partial answer" };
        throw new Error("stream broke after partial answer");
      },
    };

    const result = await runAgentLoop(
      [{ role: "user", content: "stream then fail" }],
      modelProfile,
      {
        chatClient,
        toolExecutor: createToolExecutor(),
        tools: testTools,
        onModelStreamEvent(event) {
          modelEvents.push(event);
        },
      },
    );

    expect(result).toMatchObject({
      status: "failed",
      summary: "stream broke after partial answer",
      toolCallsExecuted: 0,
    });
    expect(modelEvents).toEqual([
      { type: "content_delta", text: "partial answer" },
    ]);
    expect(completeCalls).toBe(0);
  });

  it("retries an idle-timed-out stream instead of failing the run", async () => {
    let streamCalls = 0;
    let completeCalls = 0;
    const retryEvents: Array<{ attempt: number; error: string }> = [];
    const chatClient: ChatClient & StreamingChatClient = {
      async complete() {
        completeCalls += 1;
        throw new Error("complete must not replace a retryable stream");
      },
      async *streamComplete() {
        streamCalls += 1;
        if (streamCalls === 1) {
          // Thinking-style models pause; the 30s per-read idle budget fires
          // mid-generation. This must be retried, not fatal.
          yield { type: "content_delta", text: "partial thinking" };
          throw new Error("SSE stream idle timeout after 30 s");
        }
        yield { type: "content_delta", text: "full answer" };
        yield { type: "done", finishReason: "stop" };
      },
    };

    const result = await runAgentLoop(
      [{ role: "user", content: "stream stalls once" }],
      modelProfile,
      {
        chatClient,
        toolExecutor: createToolExecutor(),
        tools: testTools,
        onModelRetry(event) {
          retryEvents.push({ attempt: event.attempt, error: event.error });
        },
      },
    );

    expect(result).toMatchObject({
      status: "succeeded",
      summary: "full answer",
      toolCallsExecuted: 0,
    });
    expect(streamCalls).toBe(2);
    expect(completeCalls).toBe(0);
    expect(retryEvents).toHaveLength(1);
    expect(retryEvents[0]!.error).toContain("idle timeout");
  });

  it("fails after repeated mid-stream idle timeouts", async () => {
    let streamCalls = 0;
    const chatClient: ChatClient & StreamingChatClient = {
      async complete() {
        throw new Error("complete must not run");
      },
      async *streamComplete() {
        streamCalls += 1;
        yield { type: "content_delta", text: "partial" };
        throw new Error("SSE stream idle timeout after 30 s");
      },
    };

    const result = await runAgentLoop(
      [{ role: "user", content: "stream always stalls" }],
      modelProfile,
      {
        chatClient,
        toolExecutor: createToolExecutor(),
        tools: testTools,
      },
    );

    expect(result.status).toBe("failed");
    expect(result.summary).toContain("idle timeout");
    expect(streamCalls).toBe(3);
  }, 15_000);

  it("repairs an interrupted tool batch in the transcript it returns", async () => {
    // Simulate a provider that issues two tool calls; the executor throws
    // unexpectedly on the first one, escaping the batch before the second
    // tool_call is answered. The returned transcript must still satisfy the
    // provider pairing invariant (unanswered calls trimmed).
    let modelCalls = 0;
    const chatClient: ChatClient = {
      async complete() {
        modelCalls += 1;
        return {
          content: null,
          toolCalls: [
            {
              id: "call_explode",
              type: "function" as const,
              function: { name: "file_list", arguments: '{"path":"/a"}' },
            },
            {
              id: "call_unanswered",
              type: "function" as const,
              function: { name: "file_list", arguments: '{"path":"/b"}' },
            },
          ],
          finishReason: "tool_calls",
        };
      },
    };
    const toolExecutor: AgentToolExecutor = {
      async execute() {
        throw new Error("executor exploded unexpectedly");
      },
      getRegistry() {
        return createDynamicToolRegistry();
      },
      hasTool() {
        return true;
      },
    } as unknown as AgentToolExecutor;

    const result = await runAgentLoop(
      [{ role: "user", content: "explode" }],
      modelProfile,
      {
        chatClient,
        toolExecutor,
        tools: testTools,
      },
    );

    expect(modelCalls).toBe(1);
    expect(result.status).toBe("failed");
    // The transcript must not contain an unanswered tool_call.
    const assistant = result.messages.find(
      (message) => message.role === "assistant" && message.tool_calls?.length,
    );
    const openIds = new Set(
      (assistant?.tool_calls ?? []).map((call) => call.id),
    );
    const answered = result.messages.filter(
      (message) =>
        message.role === "tool" && openIds.has(message.tool_call_id ?? ""),
    );
    expect(openIds.size).toBe(answered.length);
    expect(openIds.has("call_unanswered")).toBe(false);
  });

  it("assembles concurrent indexed streamed tool calls before authorization", async () => {
    let streamCalls = 0;
    const authorizationRequests: ToolCallRequest[] = [];
    const executions: Array<{ toolName: string; args: Record<string, unknown> }> = [];
    const chatClient: ChatClient & StreamingChatClient = {
      async complete() {
        throw new Error("complete should not run for indexed streaming tools");
      },
      async *streamComplete() {
        streamCalls += 1;
        if (streamCalls === 1) {
          yield {
            type: "tool_call_delta",
            index: 0,
            id: "call_0",
            name: "file_list",
            arguments: '{"path":"/alpha',
          };
          yield {
            type: "tool_call_delta",
            index: 1,
            id: "call_1",
            name: "file_list",
            arguments: '{"path":"/beta',
          };
          yield {
            type: "tool_call_delta",
            index: 0,
            id: "",
            name: "",
            arguments: '"}',
          };
          yield {
            type: "tool_call_delta",
            index: 1,
            id: "",
            name: "",
            arguments: '"}',
          };
          yield { type: "done", finishReason: "tool_calls" };
          return;
        }
        yield { type: "content_delta", text: "indexed tools done" };
        yield { type: "done", finishReason: "stop" };
      },
    };
    const toolAuthorizationService: ToolAuthorizationService = {
      async authorize(_taskId, request) {
        authorizationRequests.push(request);
        return {
          ok: true,
          decision: { allowed: true, reason: "allowed" },
          auditEvent: {
            id: `audit_indexed_${authorizationRequests.length}`,
            taskId: "task_indexed",
            request,
            decision: { allowed: true, reason: "allowed" },
            createdAt: "2026-06-23T00:00:00.000Z",
          },
        };
      },
    };
    const toolExecutor: AgentToolExecutor = {
      async execute(request) {
        executions.push(request);
        return {
          ok: true,
          result: { path: request.args.path },
        };
      },
      getRegistry() {
        throw new Error("not used");
      },
      hasTool() {
        return true;
      },
    };

    const result = await runAgentLoop(
      [{ role: "user", content: "list two directories" }],
      modelProfile,
      {
        chatClient,
        toolExecutor,
        toolAuthorizationService,
        taskId: "task_indexed",
        tools: testTools,
      },
    );

    expect(result).toMatchObject({
      status: "succeeded",
      summary: "indexed tools done",
      toolCallsExecuted: 2,
    });
    expect(authorizationRequests).toEqual([
      { toolName: "file_list", args: { path: "/alpha" } },
      { toolName: "file_list", args: { path: "/beta" } },
    ]);
    expect(executions).toEqual([
      { toolName: "file_list", args: { path: "/alpha" } },
      { toolName: "file_list", args: { path: "/beta" } },
    ]);
  });

  it("does not fall back to complete for an abort-style stream failure before deltas", async () => {
    const controller = new AbortController();
    let completeCalls = 0;
    const chatClient: ChatClient & StreamingChatClient = {
      async complete() {
        completeCalls += 1;
        return {
          content: "complete should not run after abort",
          toolCalls: [],
          finishReason: "stop",
        };
      },
      async *streamComplete() {
        controller.abort();
        throw new Error("aborted by stream");
      },
    };

    const result = await runAgentLoop(
      [{ role: "user", content: "abort streaming" }],
      modelProfile,
      {
        chatClient,
        toolExecutor: createToolExecutor(),
        tools: testTools,
        signal: controller.signal,
      },
    );

    expect(result).toMatchObject({
      status: "canceled",
      summary: "Agent loop canceled.",
      toolCallsExecuted: 0,
    });
    expect(completeCalls).toBe(0);
  });

  it("honors explicit cancellation when a model request ignores the abort signal", async () => {
    const controller = new AbortController();
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const resultPromise = runAgentLoop(
      [{ role: "user", content: "等待后取消" }],
      modelProfile,
      {
        chatClient: {
          async complete() {
            markStarted?.();
            return new Promise<ChatCompletionResponse>(() => undefined);
          },
        },
        toolExecutor: createToolExecutor(),
        tools: testTools,
        signal: controller.signal,
        maxWallClockMs: 1,
      },
    );

    await started;
    controller.abort(new Error("user canceled"));

    await expect(resultPromise).resolves.toMatchObject({
      status: "canceled",
      summary: "Agent loop canceled.",
      toolCallsExecuted: 0,
    });
  });
});

function toolCallResponse(id: string, path = "/tmp"): ChatCompletionResponse {
  return {
    content: null,
    finishReason: "tool_calls",
    toolCalls: [
      {
        id,
        type: "function",
        function: {
          name: "file_list",
          arguments: JSON.stringify({ path }),
        },
      },
    ],
  };
}

function dynamicToolCallResponse(id: string): ChatCompletionResponse {
  return {
    content: null,
    finishReason: "tool_calls",
    toolCalls: [
      {
        id,
        type: "function",
        function: {
          name: "remote_source_lookup",
          arguments: JSON.stringify({ query: "agent eval" }),
        },
      },
    ],
  };
}

function everyAssistantToolCallHasResult(
  messages: ChatCompletionRequest["messages"],
): boolean {
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role !== "assistant" || !message.tool_calls?.length) {
      continue;
    }

    const toolResultIds = new Set<string>();
    for (let nextIndex = index + 1; nextIndex < messages.length; nextIndex += 1) {
      const nextMessage = messages[nextIndex];
      if (nextMessage.role === "assistant") {
        break;
      }
      if (nextMessage.role === "tool" && nextMessage.tool_call_id) {
        toolResultIds.add(nextMessage.tool_call_id);
      }
    }

    if (!message.tool_calls.every((toolCall) => toolResultIds.has(toolCall.id))) {
      return false;
    }
  }

  return true;
}

function createToolExecutor(
  onExecute?: () => void,
  result: Record<string, unknown> | undefined = { files: ["a.txt", "b.txt"] },
  forcedResult?: Awaited<ReturnType<AgentToolExecutor["execute"]>>,
): AgentToolExecutor {
  return {
    async execute() {
      onExecute?.();
      if (forcedResult) {
        return forcedResult;
      }
      return {
        ok: true,
        result: result ?? {},
      };
    },
    getRegistry() {
      throw new Error("not used");
    },
    hasTool() {
      return true;
    },
  };
}

function createDynamicSourceToolExecutor(
  source: string,
  requests: ToolCallRequest[] = [],
): AgentToolExecutor {
  const registry = createDynamicToolRegistry();
  registry.register(
    {
      type: "function",
      function: {
        name: "remote_source_lookup",
        description: "Lookup source",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    async () => ({ ok: true, result: { sourceCount: 1 } }),
    source,
  );

  return {
    async execute(request) {
      requests.push(request);
      return registry.execute(request.toolName, request.args);
    },
    getRegistry() {
      return registry;
    },
    hasTool(toolName) {
      return registry.has(toolName);
    },
  };
}

function createRecordingOffloadStore(): ToolResultOffloadStore & {
  writes: ToolResultOffloadWriteInput[];
} {
  const writes: ToolResultOffloadWriteInput[] = [];

  return {
    writes,
    async write(input) {
      writes.push(input);
      return {
        refId: "ref_1",
        relativePath: "tool-result-refs/ref_1.json",
        absolutePath: "/tmp/tool-result-refs/ref_1.json",
        bytesWritten: Buffer.byteLength(input.content, "utf8"),
      };
    },
    async read() {
      return null;
    },
  };
}
