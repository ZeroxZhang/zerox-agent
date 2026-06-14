import { describe, expect, it } from "vitest";
import { createChatService } from "./chatService";
import type { AgentToolExecutor } from "./agentToolExecutor";
import type { AgentTrajectoryStore } from "./agentTrajectoryStore";
import { createDynamicToolRegistry } from "./dynamicToolRegistry";
import type { AppendChatMessageInput } from "./chatSessionStore";
import type { ChatClient, ChatMessage, ChatCompletionResponse } from "./openAiCompatibleClient";
import type { RunScheduledTaskResult } from "../shared/agentRuns";
import type { MemoryInput, MemoryRecord, MemorySearchResult } from "../shared/memory";
import type { ScheduledTask, ScheduledTaskInput } from "../shared/scheduledTasks";
import { getDefaultTaskPermissionPolicy } from "../shared/toolPermissions";
import type { ChatSessionGoalSummary, ChatTaskStatusEvent } from "../shared/chat";
import type { AgentTrajectoryEvent } from "../shared/agentTrajectory";
import { defineNativeToolDescriptor } from "../shared/nativeCapabilities";

function chatReply(content: string): ChatCompletionResponse {
  return { content, toolCalls: [], finishReason: "stop" };
}

function toolCallResponse(id: string, path: string): ChatCompletionResponse {
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

function shellToolCallResponse(
  id: string,
  command = "python script.py",
): ChatCompletionResponse {
  return {
    content: null,
    finishReason: "tool_calls",
    toolCalls: [
      {
        id,
        type: "function",
        function: {
          name: "shell_exec",
          arguments: JSON.stringify({ command }),
        },
      },
    ],
  };
}

describe("chat service", () => {
  it("returns a structured setup error when the model profile is incomplete", async () => {
    let completeCalled = false;
    const service = createChatService({
      chatClient: {
        async complete() {
          completeCalled = true;
          return chatReply("unused");
        },
      },
      getModelProfile: async () => {
        throw new Error("Model profile is incomplete.");
      },
      memoryStore: createMemoryStore(),
      createId: () => "chat_1",
      now: () => new Date("2026-06-06T08:00:00.000Z"),
    });

    await expect(
      service.sendMessage({ message: "帮我整理下载文件夹" }),
    ).resolves.toEqual({
      ok: false,
      message: "模型配置不完整：请先在设置中保存 base URL、对话模型和 API Key。",
    });
    expect(completeCalled).toBe(false);
  });

  it("sends memory-grounded chat messages to the model and stores session memory", async () => {
    const capturedMessages: ChatMessage[][] = [];
    const memoryWrites: MemoryInput[] = [];
    const chatMessages: AppendChatMessageInput[] = [];
    const service = createChatService({
      chatClient: {
        async complete(request) {
          capturedMessages.push(request.messages);
          return chatReply("我可以先检查任务和工具权限，然后运行文件整理 skill。");
        },
      },
      getModelProfile: async () => ({
        baseUrl: "https://api.example.com/v1",
        apiKey: "secret",
        model: "agent-model",
        temperature: 0.2,
        maxTokens: 8192,
      }),
      memoryStore: createMemoryStore({
        searchResults: [
          {
            record: createMemoryRecord({
              id: "mem_downloads",
              title: "下载目录整理偏好",
              content: "用户希望下载目录报告保存为 Markdown。",
              tags: ["downloads"],
            }),
            score: 4,
            matchedTerms: ["下载"],
          },
        ],
        memoryWrites,
      }),
      chatSessionStore: createChatSessionStore(chatMessages),
      createId: () => "chat_session_memory",
      now: () => new Date("2026-06-06T08:00:00.000Z"),
    });

    const result = await service.sendMessage({
      message: "帮我整理下载文件夹",
      history: [{ role: "assistant", content: "我已准备好。" }],
    });

    expect(result).toMatchObject({
      ok: true,
      reply: "我可以先检查任务和工具权限，然后运行文件整理 skill。",
      sessionId: "persisted_session",
      relatedMemories: [
        {
          id: "mem_downloads",
          title: "下载目录整理偏好",
          kind: "semantic",
          score: 4,
        },
      ],
    });
    expect(capturedMessages[0]).toEqual([
      expect.objectContaining({
        role: "system",
        content: expect.stringContaining("你是一个本地优先的桌面 Agent"),
      }),
      {
        role: "system",
        content:
          "相关记忆：\n- 下载目录整理偏好：用户希望下载目录报告保存为 Markdown。",
      },
      { role: "assistant", content: "我已准备好。" },
      { role: "user", content: "帮我整理下载文件夹" },
    ]);
    expect(memoryWrites).toEqual([
      {
        kind: "session",
        title: "会话：帮我整理下载文件夹",
        content:
          "用户：帮我整理下载文件夹\nAgent：我可以先检查任务和工具权限，然后运行文件整理 skill。",
        tags: ["chat", "session"],
        source: {
          type: "chat_session",
          sessionId: "persisted_session",
          messageIds: ["message_1", "message_2"],
        },
        importance: 2,
      },
    ]);
    expect(chatMessages).toEqual([
      {
        role: "user",
        content: "帮我整理下载文件夹",
      },
      {
        sessionId: "persisted_session",
        role: "assistant",
        content: "我可以先检查任务和工具权限，然后运行文件整理 skill。",
        relatedMemoryIds: ["mem_downloads"],
      },
    ]);
  });

  it("creates a session goal from an explicit goal-setting message", async () => {
    let completeCalled = false;
    const chatMessages: AppendChatMessageInput[] = [];
    const goalCreates: unknown[] = [];
    const attachedGoals: ChatSessionGoalSummary[] = [];
    const service = createChatService({
      chatClient: {
        async complete() {
          completeCalled = true;
          return chatReply("unused");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: createChatSessionStore(chatMessages, { attachedGoals }),
      goalService: createGoalService({ goalCreates }),
      createId: () => "chat_goal",
      now: () => new Date("2026-06-12T08:00:00.000Z"),
    });

    const result = await service.sendMessage({
      message: "把这轮设为目标：发布 v1.8.0，直到 GitHub Release 完成才算结束",
    });

    expect(result).toMatchObject({
      ok: true,
      activeGoal: {
        id: "goal_release",
        description: "发布 v1.8.0，直到 GitHub Release 完成才算结束",
        status: "planning",
      },
    });
    expect(goalCreates).toEqual([
      {
        sessionId: "persisted_session",
        originMessageId: "message_1",
        description: "发布 v1.8.0，直到 GitHub Release 完成才算结束",
      },
    ]);
    expect(attachedGoals).toEqual([
      {
        id: "goal_release",
        description: "发布 v1.8.0，直到 GitHub Release 完成才算结束",
        status: "planning",
      },
    ]);
    expect(chatMessages).toEqual([
      {
        role: "user",
        content: "把这轮设为目标：发布 v1.8.0，直到 GitHub Release 完成才算结束",
      },
      {
        sessionId: "persisted_session",
        role: "assistant",
        content:
          "已把这轮会话设为目标：发布 v1.8.0，直到 GitHub Release 完成才算结束。",
        goalId: "goal_release",
        goalEventRef: "goal_created",
      },
    ]);
    expect(completeCalled).toBe(false);
  });

  it("creates a session goal from a slash goal command", async () => {
    let completeCalled = false;
    const goalCreates: unknown[] = [];
    const service = createChatService({
      chatClient: {
        async complete() {
          completeCalled = true;
          return chatReply("unused");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: createChatSessionStore([]),
      goalService: createGoalService({ goalCreates }),
      createId: () => "chat_goal",
      now: () => new Date("2026-06-12T08:00:00.000Z"),
    });

    const result = await service.sendMessage({
      message: "/目标 发布 v1.8.0，直到 GitHub Release 完成才算结束",
    });

    expect(result).toMatchObject({
      ok: true,
      activeGoal: {
        id: "goal_release",
        description: "发布 v1.8.0，直到 GitHub Release 完成才算结束",
        status: "planning",
      },
    });
    expect(goalCreates).toEqual([
      {
        sessionId: "persisted_session",
        originMessageId: "message_1",
        description: "发布 v1.8.0，直到 GitHub Release 完成才算结束",
      },
    ]);
    expect(completeCalled).toBe(false);
  });

  it("continues the active session goal before ordinary chat continuation", async () => {
    let completeCalled = false;
    const resumes: string[] = [];
    const activeGoal: ChatSessionGoalSummary = {
      id: "goal_release",
      description: "发布",
      status: "executing",
    };
    const service = createChatService({
      chatClient: {
        async complete() {
          completeCalled = true;
          return chatReply("unused");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: createChatSessionStore([], { activeGoal }),
      goalService: createGoalService({ resumes }),
      createId: () => "chat_goal",
      now: () => new Date("2026-06-12T08:00:00.000Z"),
    });

    const result = await service.sendMessage({
      sessionId: "persisted_session",
      message: "继续",
    });

    expect(result).toMatchObject({
      ok: true,
      activeGoal: {
        id: "goal_release",
        description: "发布",
        status: "executing",
      },
    });
    expect(resumes).toEqual(["goal_release"]);
    expect(completeCalled).toBe(false);
  });

  it("recreates and starts a terminal session goal when continuing it", async () => {
    let completeCalled = false;
    const statusEvents: ChatTaskStatusEvent[] = [];
    const resumes: string[] = [];
    const goalCreates: unknown[] = [];
    const attachedGoals: ChatSessionGoalSummary[] = [];
    const activeGoal: ChatSessionGoalSummary = {
      id: "goal_failed",
      description: "深度调研 Serenity",
      status: "failed",
    };
    const service = createChatService({
      chatClient: {
        async complete() {
          completeCalled = true;
          return chatReply("unused");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: createChatSessionStore([], {
        activeGoal,
        attachedGoals,
      }),
      goalService: createGoalService({ goalCreates, resumes }),
      createId: () => "chat_goal",
      now: () => new Date("2026-06-13T08:00:00.000Z"),
    });

    const result = await service.sendMessage(
      {
        sessionId: "persisted_session",
        message: "继续这个目标",
      },
      {
        onStatusEvent(event) {
          statusEvents.push(event);
        },
      },
    );

    expect(result).toMatchObject({
      ok: true,
      reply: "已重新开始目标：发布。",
      activeGoal: {
        id: "goal_release",
        description: "发布",
        status: "executing",
      },
    });
    expect(goalCreates).toEqual([
      {
        sessionId: "persisted_session",
        originMessageId: "message_1",
        description: "深度调研 Serenity",
      },
    ]);
    expect(resumes).toEqual(["goal_release"]);
    expect(attachedGoals.at(-1)).toEqual({
      id: "goal_release",
      description: "发布",
      status: "executing",
    });
    expect(statusEvents.map((event) => event.message)).toContain(
      "正在重新开始目标执行",
    );
    expect(completeCalled).toBe(false);
  });

  it("pauses the active session goal from a chat command", async () => {
    let completeCalled = false;
    const pauses: string[] = [];
    const activeGoal: ChatSessionGoalSummary = {
      id: "goal_release",
      description: "发布",
      status: "executing",
    };
    const service = createChatService({
      chatClient: {
        async complete() {
          completeCalled = true;
          return chatReply("unused");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: createChatSessionStore([], { activeGoal }),
      goalService: createGoalService({ pauses }),
      createId: () => "chat_goal",
      now: () => new Date("2026-06-12T08:00:00.000Z"),
    });

    const result = await service.sendMessage({
      sessionId: "persisted_session",
      message: "暂停这个目标",
    });

    expect(result).toMatchObject({
      ok: true,
      reply: "已暂停目标：发布。",
      activeGoal: {
        id: "goal_release",
        description: "发布",
        status: "waiting_for_review",
      },
    });
    expect(pauses).toEqual(["goal_release"]);
    expect(completeCalled).toBe(false);
  });

  it("extracts preference-like chat turns into L1 memory and updates the persona profile", async () => {
    const memoryWrites: MemoryInput[] = [];
    const profileUpdates: MemoryRecord[][] = [];
    const service = createChatService({
      chatClient: {
        async complete() {
          return chatReply("好的，我会按这个偏好处理。");
        },
      },
      getModelProfile: async () => ({
        baseUrl: "https://api.example.com/v1",
        apiKey: "secret",
        model: "agent-model",
        temperature: 0.2,
        maxTokens: 8192,
      }),
      memoryStore: createMemoryStore({ memoryWrites }),
      chatSessionStore: createChatSessionStore([]),
      memoryProfileStore: {
        async updateFromMemories(memories) {
          profileUpdates.push(memories);
        },
      },
      createId: () => "chat_preference",
      now: () => new Date("2026-06-06T08:00:00.000Z"),
    });

    await service.sendMessage({
      message: "以后默认把报告保存成 Markdown",
    });

    expect(memoryWrites).toEqual([
      expect.objectContaining({
        kind: "session",
        title: "会话：以后默认把报告保存成 Markdown",
      }),
      {
        kind: "semantic",
        title: "用户偏好：以后默认把报告保存成 Markdown",
        content: "以后默认把报告保存成 Markdown",
        tags: ["l1", "chat", "preference"],
        source: {
          type: "chat_session",
          sessionId: "persisted_session",
          messageIds: ["message_1", "message_2"],
        },
        importance: 4,
      },
    ]);
    expect(profileUpdates).toHaveLength(1);
    expect(profileUpdates[0]).toMatchObject([
      {
        id: "created_memory_2",
        kind: "semantic",
        title: "用户偏好：以后默认把报告保存成 Markdown",
      },
    ]);
  });

  it("lets long tool-using chat tasks run beyond six model turns", async () => {
    let toolModelTurns = 0;
    const service = createChatService({
      chatClient: {
        async complete(request) {
          if (request.tools) {
            toolModelTurns += 1;
            if (toolModelTurns <= 7) {
              return toolCallResponse(
                `call_${toolModelTurns}`,
                `/tmp/long-task-${toolModelTurns}`,
              );
            }
          }

          return chatReply("长任务完成。");
        },
      },
      getModelProfile: async () => ({
        baseUrl: "https://api.example.com/v1",
        apiKey: "secret",
        model: "agent-model",
        temperature: 0.2,
        maxTokens: 8192,
      }),
      memoryStore: createMemoryStore(),
      toolExecutor: createToolExecutor(),
      createId: () => "chat_long_task",
      now: () => new Date("2026-06-06T08:00:00.000Z"),
    });

    const result = await service.sendMessage({
      message: "请执行一个需要多轮工具调用的长任务",
    });

    expect(toolModelTurns).toBe(8);
    expect(result).toMatchObject({
      ok: true,
      reply: expect.stringContaining("长任务完成。"),
    });
    expect(result.ok ? result.reply : "").not.toContain("已达到工具调用轮次上限");
  });

  it("pauses long chat tasks at a checkpoint and resumes after user confirmation", async () => {
    let toolModelTurns = 0;
    const requestMessageCounts: number[] = [];
    const service = createChatService({
      chatClient: {
        async complete(request) {
          if (request.tools) {
            toolModelTurns += 1;
            requestMessageCounts.push(request.messages.length);
            if (toolModelTurns <= 2) {
              return toolCallResponse(
                `call_${toolModelTurns}`,
                `/tmp/checkpoint-${toolModelTurns}`,
              );
            }
          }

          return chatReply("长任务完成。");
        },
      },
      getModelProfile: async () => ({
        baseUrl: "https://api.example.com/v1",
        apiKey: "secret",
        model: "agent-model",
        temperature: 0.2,
        maxTokens: 8192,
      }),
      memoryStore: createMemoryStore(),
      toolExecutor: createToolExecutor(),
      createId: () => "chat_checkpoint",
      now: () => new Date("2026-06-06T08:00:00.000Z"),
      agentLoopMaxTurns: 2,
    });

    const paused = await service.sendMessage({
      message: "请执行一个需要检查点确认的长任务",
    });

    expect(paused).toMatchObject({
      ok: true,
      sessionId: "chat_checkpoint",
      agentStatus: {
        state: "paused",
        reason: "turn_limit",
        maxTurns: 2,
        toolCallsExecuted: 2,
      },
    });
    expect(paused.ok ? paused.reply : "").toContain("等待你确认");
    expect(paused.ok ? paused.reply : "").not.toContain("请把任务拆小一点");

    const resumed = await service.sendMessage({
      sessionId: "chat_checkpoint",
      message: "继续",
    });

    expect(resumed).toMatchObject({
      ok: true,
      sessionId: "chat_checkpoint",
      reply: expect.stringContaining("长任务完成。"),
      agentStatus: {
        state: "completed",
        toolCallsExecuted: 2,
      },
    });
    expect(toolModelTurns).toBe(3);
    expect(requestMessageCounts[2]).toBeGreaterThan(requestMessageCounts[0]);
  });

  it("emits real chat task status events from model turns and tool calls", async () => {
    const statusEvents: ChatTaskStatusEvent[] = [];
    const service = createChatService({
      chatClient: {
        async complete(request) {
          if (request.tools) {
            return toolCallResponse("call_1", "/tmp/status-events");
          }

          return chatReply("状态事件已完成。");
        },
      },
      getModelProfile: async () => ({
        baseUrl: "https://api.example.com/v1",
        apiKey: "secret",
        model: "agent-model",
        temperature: 0.2,
        maxTokens: 8192,
      }),
      memoryStore: createMemoryStore(),
      toolExecutor: createToolExecutor(),
      createId: () => "chat_status_events",
      now: () => new Date("2026-06-06T08:00:00.000Z"),
    });

    const result = await service.sendMessage(
      {
        message: "检查目录并汇报真实执行状态",
      },
      {
        onStatusEvent(event) {
          statusEvents.push(event);
        },
      },
    );

    expect(result).toMatchObject({
      ok: true,
      reply: expect.stringContaining("状态事件已完成。"),
    });
    expect(statusEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sessionId: "chat_status_events",
          state: "started",
          message: "正在读取模型配置",
        }),
        expect.objectContaining({
          state: "memory",
          message: "正在检索相关记忆",
        }),
        expect.objectContaining({
          state: "model",
          turn: 1,
          message: "正在调用模型（第 1 轮）",
        }),
        expect.objectContaining({
          state: "tool_call",
          toolName: "file_list",
          message: "正在调用工具：file_list",
        }),
        expect.objectContaining({
          state: "tool_result",
          toolName: "file_list",
          ok: true,
          toolCallsExecuted: 1,
          message: "工具完成：file_list",
        }),
        expect.objectContaining({
          state: "completed",
          toolCallsExecuted: 1,
          message: "任务已完成",
        }),
      ]),
    );
  });

  it("emits trajectory evidence for chat tool runs", async () => {
    const trajectoryEvents: AgentTrajectoryEvent[] = [];
    const service = createChatService({
      chatClient: {
        async complete(request) {
          if (request.tools && !request.messages.some((message) => message.role === "tool")) {
            return toolCallResponse("call_1", "/tmp/evidence");
          }

          return chatReply("证据已记录。");
        },
      },
      getModelProfile: async () => ({
        baseUrl: "https://api.example.com/v1",
        apiKey: "secret",
        model: "agent-model",
        temperature: 0.2,
        maxTokens: 8192,
      }),
      memoryStore: createMemoryStore(),
      toolExecutor: createToolExecutor(),
      trajectoryStore: createMemoryTrajectoryStore(trajectoryEvents),
      createId: createSequentialId("chat_evidence"),
      now: createSteppedClock("2026-06-06T08:00:00.000Z"),
    });

    const result = await service.sendMessage({
      message: "检查目录并保留运行证据",
    });

    expect(result).toMatchObject({
      ok: true,
      agentStatus: {
        state: "completed",
        runId: "chat_evidence_2",
      },
    });
    expect(trajectoryEvents.map((event) => event.type)).toEqual([
      "model_request",
      "model_response",
      "tool_call",
      "tool_result",
      "model_request",
      "model_response",
      "final_summary",
    ]);
    expect(trajectoryEvents.every((event) => event.runId === "chat_evidence_2")).toBe(
      true,
    );
  });

  it("emits native trajectory evidence for chat tool runs", async () => {
    const trajectoryEvents: AgentTrajectoryEvent[] = [];
    const registry = createDynamicToolRegistry();
    registry.register(
      {
        type: "function",
        function: {
          name: "code_search",
          description: "Search code",
          parameters: {
            type: "object",
            properties: {
              workspaceRoot: { type: "string" },
              query: { type: "string" },
            },
            required: ["workspaceRoot", "query"],
          },
        },
      },
      async () => ({
        ok: true,
        result: { results: [{ relativePath: "src/main.ts" }] },
      }),
      "test",
      defineNativeToolDescriptor({
        id: "code_search",
        kind: "code",
        label: "Code Search",
        description: "Search code through native registry metadata.",
        riskLevel: "low",
        permissionScope: { files: "read", shell: "none", web: "none" },
        observableEvents: ["native_tool_invocation", "native_tool_observation"],
      }),
    );
    const service = createChatService({
      chatClient: {
        async complete(request) {
          if (request.tools && !request.messages.some((message) => message.role === "tool")) {
            return {
              content: null,
              finishReason: "tool_calls",
              toolCalls: [
                {
                  id: "call_native",
                  type: "function",
                  function: {
                    name: "code_search",
                    arguments: JSON.stringify({
                      workspaceRoot: "/repo",
                      query: "createChatService",
                    }),
                  },
                },
              ],
            };
          }

          return chatReply("代码证据已记录。");
        },
      },
      getModelProfile: async () => ({
        baseUrl: "https://api.example.com/v1",
        apiKey: "secret",
        model: "agent-model",
        temperature: 0.2,
        maxTokens: 8192,
      }),
      memoryStore: createMemoryStore(),
      toolExecutor: {
        async execute(request) {
          return registry.execute(request.toolName, request.args);
        },
        getRegistry() {
          return registry;
        },
        hasTool(toolName) {
          return registry.has(toolName);
        },
      },
      trajectoryStore: createMemoryTrajectoryStore(trajectoryEvents),
      createId: createSequentialId("chat_native"),
      now: createSteppedClock("2026-06-06T08:00:00.000Z"),
    });

    await service.sendMessage({
      message: "搜索代码并保留 native 运行证据",
    });

    expect(trajectoryEvents.map((event) => event.type)).toEqual([
      "model_request",
      "model_response",
      "tool_call",
      "native_tool_invocation",
      "native_tool_observation",
      "tool_result",
      "model_request",
      "model_response",
      "final_summary",
    ]);
    expect(trajectoryEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "native_tool_invocation",
          payload: expect.objectContaining({
            toolName: "code_search",
            nativeKind: "code",
            riskLevel: "low",
          }),
        }),
        expect.objectContaining({
          type: "native_tool_observation",
          payload: expect.objectContaining({
            toolName: "code_search",
            nativeKind: "code",
            riskLevel: "low",
            ok: true,
          }),
        }),
      ]),
    );
  });

  it("emits provider-supplied model reasoning as a real status event", async () => {
    const statusEvents: ChatTaskStatusEvent[] = [];
    const service = createChatService({
      chatClient: {
        async complete() {
          return {
            content: "推理后完成。",
            reasoningContent: "我正在比较用户目标与可用工具。",
            toolCalls: [],
            finishReason: "stop",
          };
        },
      },
      getModelProfile: async () => ({
        baseUrl: "https://api.example.com/v1",
        apiKey: "secret",
        model: "agent-model",
        temperature: 0.2,
        maxTokens: 8192,
      }),
      memoryStore: createMemoryStore(),
      toolExecutor: createToolExecutor(),
      createId: () => "chat_reasoning",
      now: () => new Date("2026-06-06T08:00:00.000Z"),
    });

    await service.sendMessage(
      { message: "需要披露模型思考摘要" },
      { onStatusEvent: (event) => statusEvents.push(event) },
    );

    expect(statusEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sessionId: "chat_reasoning",
          state: "reasoning",
          message: "我正在比较用户目标与可用工具。",
        }),
      ]),
    );
  });

  it("surfaces structured shell failure diagnostics in task status", async () => {
    const statusEvents: ChatTaskStatusEvent[] = [];
    const service = createChatService({
      chatClient: {
        async complete(request) {
          if (!request.messages.some((message) => message.role === "tool")) {
            return shellToolCallResponse("shell_call_1");
          }

          return chatReply("脚本失败，建议先检查入口参数。");
        },
      },
      getModelProfile: async () => ({
        baseUrl: "https://api.example.com/v1",
        apiKey: "secret",
        model: "agent-model",
        temperature: 0.2,
        maxTokens: 8192,
      }),
      memoryStore: createMemoryStore(),
      toolExecutor: createToolExecutor({
        ok: false,
        error: "shell_exec 失败：退出码 1，未产生 stdout/stderr。",
        errorDetails: {
          kind: "empty_exit",
          command: "python script.py",
          exitCode: 1,
          stdout: "",
          stderr: "",
        },
      }),
      createId: () => "chat_shell_failure",
      now: () => new Date("2026-06-06T08:00:00.000Z"),
    });

    await service.sendMessage(
      { message: "运行脚本" },
      { onStatusEvent: (event) => statusEvents.push(event) },
    );

    expect(statusEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sessionId: "chat_shell_failure",
          state: "tool_result",
          toolName: "shell_exec",
          ok: false,
          message: "工具失败：shell_exec（退出码 1，无 stdout/stderr）",
        }),
      ]),
    );
  });

  it("cancels an active chat request through the runtime abort signal", async () => {
    const controller = new AbortController();
    const statusEvents: ChatTaskStatusEvent[] = [];
    let observedAbort = false;
    const service = createChatService({
      chatClient: {
        async complete(request) {
          return new Promise<ChatCompletionResponse>((_resolve, reject) => {
            request.signal?.addEventListener("abort", () => {
              observedAbort = true;
              reject(new Error("aborted by test"));
            });
            controller.abort();
          });
        },
      },
      getModelProfile: async () => ({
        baseUrl: "https://api.example.com/v1",
        apiKey: "secret",
        model: "agent-model",
        temperature: 0.2,
        maxTokens: 8192,
      }),
      memoryStore: createMemoryStore(),
      createId: () => "chat_cancel",
      now: () => new Date("2026-06-06T08:00:00.000Z"),
    });

    const result = await service.sendMessage(
      { message: "执行一个我会中断的任务" },
      {
        signal: controller.signal,
        onStatusEvent: (event) => statusEvents.push(event),
      },
    );

    expect(observedAbort).toBe(true);
    expect(result).toEqual({
      ok: false,
      message: "已中断任务。",
    });
    expect(statusEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sessionId: "chat_cancel",
          state: "canceled",
          message: "任务已中断",
        }),
      ]),
    );
  });

  it("runs a matching local task directly from a chat command", async () => {
    let completeCalled = false;
    const executedTaskIds: string[] = [];
    const service = createChatService({
      chatClient: {
        async complete() {
          completeCalled = true;
          return chatReply("unused");
        },
      },
      getModelProfile: async () => ({
        baseUrl: "https://api.example.com/v1",
        apiKey: "secret",
        model: "agent-model",
        temperature: 0.2,
        maxTokens: 8192,
      }),
      memoryStore: createMemoryStore(),
      taskStore: createTaskStore([
        createTask({
          id: "task_downloads",
          name: "整理下载文件夹",
        }),
      ]),
      runScheduledTask: async (taskId) => {
        executedTaskIds.push(taskId);
        return {
          ok: true,
          run: {
            id: "run_from_chat",
            taskId,
            taskName: "整理下载文件夹",
            skillName: "local-file-organizer",
            status: "succeeded",
            summary: "已生成 Markdown 报告。",
            events: [],
            startedAt: "2026-06-06T08:00:00.000Z",
            finishedAt: "2026-06-06T08:00:02.000Z",
          },
        };
      },
      createId: () => "chat_task_session",
      now: () => new Date("2026-06-06T08:00:00.000Z"),
    });

    const result = await service.sendMessage({
      message: "请运行整理下载文件夹任务",
    });

    expect(result).toMatchObject({
      ok: true,
      reply:
        "已运行任务“整理下载文件夹”，结果：成功。摘要：已生成 Markdown 报告。",
      executedRun: {
        id: "run_from_chat",
        taskName: "整理下载文件夹",
        status: "succeeded",
      },
    });
    expect(executedTaskIds).toEqual(["task_downloads"]);
    expect(completeCalled).toBe(false);
  });

  it("creates a local scheduled task from a Chinese chat request", async () => {
    let completeCalled = false;
    const createdInputs: ScheduledTaskInput[] = [];
    const service = createChatService({
      chatClient: {
        async complete() {
          completeCalled = true;
          return chatReply("unused");
        },
      },
      getModelProfile: async () => ({
        baseUrl: "https://api.example.com/v1",
        apiKey: "secret",
        model: "agent-model",
        temperature: 0.2,
        maxTokens: 8192,
      }),
      memoryStore: createMemoryStore(),
      taskStore: createTaskStore([], createdInputs),
      createId: () => "chat_create_task",
      now: () => new Date("2026-06-06T08:00:00.000Z"),
    });

    const result = await service.sendMessage({
      message: "每天 9 点整理下载文件夹",
    });

    expect(result).toMatchObject({
      ok: true,
      reply:
        "已创建任务“整理下载文件夹”，调度：每天 09:00。你可以在“任务”页检查权限后运行。",
      createdTask: {
        id: "created_task",
        name: "整理下载文件夹",
        skillName: "local-file-organizer",
        schedule: { kind: "daily", time: "09:00" },
      },
    });
    expect(createdInputs).toEqual([
      {
        name: "整理下载文件夹",
        skillName: "local-file-organizer",
        enabled: true,
        schedule: { kind: "daily", time: "09:00" },
        input: { targetDir: "~/Downloads", reportName: "agent-report.md" },
        permissions: {
          files: { read: ["~/Downloads"], write: ["~/Downloads"] },
          web: { search: false, fetchDomains: [] },
          shell: { commands: [] },
          memory: { read: false, write: false },
        },
      },
    ]);
    expect(completeCalled).toBe(false);
  });

  it("asks for a target directory before creating a scheduled file task", async () => {
    let completeCalled = false;
    const createdInputs: ScheduledTaskInput[] = [];
    const chatMessages: AppendChatMessageInput[] = [];
    const service = createChatService({
      chatClient: {
        async complete() {
          completeCalled = true;
          return chatReply("unused");
        },
      },
      getModelProfile: async () => ({
        baseUrl: "https://api.example.com/v1",
        apiKey: "secret",
        model: "agent-model",
        temperature: 0.2,
        maxTokens: 8192,
      }),
      memoryStore: createMemoryStore(),
      chatSessionStore: createChatSessionStore(chatMessages),
      taskStore: createTaskStore([], createdInputs),
      createId: () => "chat_create_task_missing_target",
      now: () => new Date("2026-06-06T08:00:00.000Z"),
    });

    const result = await service.sendMessage({
      message: "每天 9 点整理文件",
    });

    expect(result).toMatchObject({
      ok: true,
      reply:
        "我可以创建这个定时任务。你想让我整理哪个文件夹？例如：下载、桌面、文档或项目。",
      sessionId: "persisted_session",
    });
    expect(createdInputs).toEqual([]);
    expect(completeCalled).toBe(false);
    expect(chatMessages).toEqual([
      {
        role: "user",
        content: "每天 9 点整理文件",
      },
      {
        sessionId: "persisted_session",
        role: "assistant",
        content:
          "我可以创建这个定时任务。你想让我整理哪个文件夹？例如：下载、桌面、文档或项目。",
      },
    ]);
  });
});

function createMemoryStore(options: {
  searchResults?: MemorySearchResult[];
  memoryWrites?: MemoryInput[];
} = {}) {
  let createCount = 0;
  return {
    async search() {
      return options.searchResults ?? [];
    },
    async create(input: MemoryInput) {
      createCount += 1;
      options.memoryWrites?.push(input);
      return createMemoryRecord({
        id: `created_memory_${createCount}`,
        title: input.title,
        content: input.content,
        tags: input.tags ?? [],
        kind: input.kind === "session" ? "session" : "semantic",
        source: input.source,
      });
    },
  };
}

function createChatSessionStore(
  messages: AppendChatMessageInput[],
  options: {
    activeGoal?: ChatSessionGoalSummary;
    attachedGoals?: ChatSessionGoalSummary[];
  } = {},
) {
  return {
    async appendMessage(input: AppendChatMessageInput) {
      messages.push(input);
      return {
        message: {
          id: `message_${messages.length}`,
          role: input.role,
          content: input.content,
          createdAt: "2026-06-06T08:00:00.000Z",
        },
        session: {
          id: input.sessionId ?? "persisted_session",
          title: "会话",
          summary: input.content,
          messages: [],
          ...(options.activeGoal
            ? {
                activeGoalId: options.activeGoal.id,
                goalIds: [options.activeGoal.id],
                goalSummaries: [options.activeGoal],
              }
            : {}),
          createdAt: "2026-06-06T08:00:00.000Z",
          updatedAt: "2026-06-06T08:00:00.000Z",
        },
      };
    },
    async attachGoal(_sessionId: string, goal: ChatSessionGoalSummary) {
      options.attachedGoals?.push(goal);
      return {
        id: "persisted_session",
        title: "会话",
        summary: goal.description,
        messages: [],
        activeGoalId: goal.id,
        goalIds: [goal.id],
        goalSummaries: [goal],
        createdAt: "2026-06-06T08:00:00.000Z",
        updatedAt: "2026-06-06T08:00:00.000Z",
      };
    },
  };
}

function createGoalService(options: {
  goalCreates?: unknown[];
  resumes?: string[];
  pauses?: string[];
} = {}) {
  return {
    async createFromChat(input: {
      sessionId: string;
      originMessageId: string | null;
      description: string;
    }): Promise<ChatSessionGoalSummary> {
      options.goalCreates?.push(input);
      return {
        id: "goal_release",
        description: input.description,
        status: "planning",
      };
    },
    async resume(goalId: string): Promise<ChatSessionGoalSummary> {
      options.resumes?.push(goalId);
      return {
        id: goalId,
        description: "发布",
        status: "executing",
      };
    },
    async pause(goalId: string): Promise<ChatSessionGoalSummary> {
      options.pauses?.push(goalId);
      return {
        id: goalId,
        description: "发布",
        status: "waiting_for_review",
      };
    },
    async cancel(goalId: string): Promise<ChatSessionGoalSummary> {
      return {
        id: goalId,
        description: "发布",
        status: "canceled",
      };
    },
    async resolveReview(goalId: string): Promise<ChatSessionGoalSummary> {
      return {
        id: goalId,
        description: "发布",
        status: "executing",
      };
    },
  };
}

async function createCompleteProfile() {
  return {
    baseUrl: "https://api.example.com/v1",
    apiKey: "secret",
    model: "agent-model",
    temperature: 0.2,
    maxTokens: 8192,
  };
}

function createTaskStore(
  tasks: ScheduledTask[],
  createdInputs: ScheduledTaskInput[] = [],
) {
  return {
    async list() {
      return tasks;
    },
    async create(input: ScheduledTaskInput) {
      createdInputs.push(input);
      return createTask({
        id: "created_task",
        name: input.name,
        skillName: input.skillName,
        schedule: input.schedule,
        input: input.input,
        permissions: input.permissions,
      });
    },
  };
}

function createTask(partial: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: "task_1",
    name: "Task",
    skillName: "local-file-organizer",
    enabled: true,
    schedule: { kind: "manual" },
    input: {},
    permissions: getDefaultTaskPermissionPolicy(),
    createdAt: "2026-06-06T08:00:00.000Z",
    updatedAt: "2026-06-06T08:00:00.000Z",
    lastRunAt: null,
    nextRunAt: null,
    ...partial,
  };
}

function createToolExecutor(
  forcedResult?: Awaited<ReturnType<AgentToolExecutor["execute"]>>,
): AgentToolExecutor {
  return {
    async execute() {
      if (forcedResult) {
        return forcedResult;
      }
      return {
        ok: true as const,
        result: { files: ["a.txt", "b.txt"] },
      };
    },
    getRegistry() {
      return {
        getDefinitions() {
          return [
            {
              type: "function" as const,
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
        },
      };
    },
    hasTool() {
      return true;
    },
  } as AgentToolExecutor;
}

function createMemoryTrajectoryStore(
  events: AgentTrajectoryEvent[],
): AgentTrajectoryStore {
  return {
    async append(_runId, event) {
      events.push(structuredClone(event));
      return event;
    },
    async list() {
      return events;
    },
  };
}

function createSequentialId(prefix: string): () => string {
  let next = 1;
  return () => `${prefix}_${next++}`;
}

function createSteppedClock(start: string): () => Date {
  let offset = 0;
  const startMs = new Date(start).getTime();
  return () => {
    const value = new Date(startMs + offset * 1000);
    offset += 1;
    return value;
  };
}

function createMemoryRecord(
  partial: Partial<MemoryRecord> & Pick<MemoryRecord, "id" | "title" | "content">,
): MemoryRecord {
  return {
    kind: "semantic",
    tags: [],
    source: partial.source ?? { type: "manual" },
    importance: 3,
    createdAt: "2026-06-06T08:00:00.000Z",
    updatedAt: "2026-06-06T08:00:00.000Z",
    ...partial,
  };
}
