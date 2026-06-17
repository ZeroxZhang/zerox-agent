import { describe, expect, it } from "vitest";
import { runAgentLoop } from "./agentLoop";
import type { AgentToolExecutor } from "./agentToolExecutor";
import type {
  ChatClient,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ToolDefinition,
} from "./openAiCompatibleClient";
import type {
  ToolResultOffloadStore,
  ToolResultOffloadWriteInput,
} from "./toolResultOffloadStore";
import type { ToolAuthorizationService } from "./toolAuthorizationService";
import { createDynamicToolRegistry } from "./dynamicToolRegistry";
import type { ToolCallRequest } from "../shared/toolPermissions";

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

describe("agent loop", () => {
  it("retries transient model request failures before failing the loop", async () => {
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
      status: "succeeded",
      summary: "重试后完成。",
    });
    expect(attempts).toBe(2);
    expect(retryEvents).toEqual([
      {
        attempt: 1,
        maxRetries: 2,
        delayMs: 0,
        error: "LLM request failed with status 500: overloaded",
      },
    ]);
  });

  it("compacts messages before model requests when the context exceeds budget", async () => {
    const requests: ChatCompletionRequest[] = [];
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
      { ...modelProfile, maxTokens: 128 },
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
      },
    );

    expect(result.status).toBe("succeeded");
    expect(requests[0].messages).toEqual([
      expect.objectContaining({ role: "system" }),
      { role: "user", content: "[之前对话摘要]\nold request -> old answer" },
      { role: "user", content: "current request" },
    ]);
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
        expect(JSON.parse(toolMessage?.content ?? "{}")).toEqual(
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

  it("asks the model for a final no-tool summary when tool turns reach the limit", async () => {
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

        expect(request.tools).toBeUndefined();
        expect(request.messages.at(-1)).toMatchObject({
          role: "system",
          content: expect.stringContaining("工具调用轮次已达到上限"),
        });
        return {
          content: "我已经检查了已有结果，建议把任务拆成更小步骤继续。",
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
      summary:
        "已达到工具调用轮次上限，我先基于已有结果给出阶段性总结：\n\n我已经检查了已有结果，建议把任务拆成更小步骤继续。",
      turns: 2,
      toolCallsExecuted: 2,
    });
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

  it("can pause at a turn checkpoint instead of ending the task", async () => {
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
      [{ role: "user", content: "检查这个目录并告诉我结果" }],
      modelProfile,
      {
        chatClient,
        toolExecutor: createToolExecutor(),
        maxTurns: 2,
        pauseOnTurnLimit: true,
        tools: testTools,
      },
    );

    expect(requests).toHaveLength(2);
    expect(result).toMatchObject({
      status: "paused",
      turns: 2,
      toolCallsExecuted: 2,
      continuation: {
        reason: "turn_limit",
        maxTurns: 2,
        toolCallsExecuted: 2,
      },
    });
    expect(result.summary).toContain("已到达长任务检查点");
    expect(result.summary).toContain("等待你确认");
    expect(result.summary).not.toContain("请把任务拆小一点");
  });

  it("pauses when the model keeps hitting the same class of tool failure", async () => {
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

    expect(requests).toHaveLength(3);
    expect(result).toMatchObject({
      status: "paused",
      turns: 2,
      toolCallsExecuted: 3,
      continuation: {
        reason: "tool_failure_loop",
        toolCallsExecuted: 3,
      },
    });
    expect(result.summary).toContain("连续 3 次工具失败");
    expect(result.summary).toContain("file_list");
  });

  it("passes dynamic registry source to tool authorization", async () => {
    const requests: ChatCompletionRequest[] = [];
    const authorizationRequests: ToolCallRequest[] = [];
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

function createDynamicSourceToolExecutor(source: string): AgentToolExecutor {
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
