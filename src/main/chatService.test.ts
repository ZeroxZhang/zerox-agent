import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  buildDefaultChatShellTemplates,
  createLegacyChatRequestClaimFingerprint,
  createChatRequestClaimFingerprint,
  createRequiredChatEventFingerprint,
  createChatService as createProductionChatService,
  isMemoryVisibleToChatSession,
} from "./chatService";
import type { AgentToolExecutor } from "./agentToolExecutor";
import { runAgentLoop as runProductionAgentLoop } from "./agentLoop";
import type { AgentTrajectoryStore } from "./agentTrajectoryStore";
import {
  createWorkspaceRunStore,
  type WorkspaceRunStore,
} from "./workspaceRunStore";
import { createDynamicToolRegistry } from "./dynamicToolRegistry";
import type { AppendChatMessageInput } from "./chatSessionStore";
import type {
  ChatClient,
  ChatCompletionRequest,
  ChatMessage,
  ChatCompletionResponse,
  StreamingChatClient,
} from "./openAiCompatibleClient";
import type { AgentModelProfile } from "./agentRunnerService";
import type { RunScheduledTaskResult } from "../shared/agentRuns";
import type { MemoryInput, MemoryRecord, MemorySearchResult } from "../shared/memory";
import type { ScheduledTask, ScheduledTaskInput } from "../shared/scheduledTasks";
import type {
  SkillManifest,
  SkillPermissions,
  SkillRecord,
} from "../shared/skills";
import {
  authorizeToolCallWithinRunContext,
  getDefaultTaskPermissionPolicy,
} from "../shared/toolPermissions";
import type {
  ChatAttachmentMetadata,
  ChatSessionRecord,
  ChatSessionGoalSummary,
  ChatSessionTokenUsage,
  ChatStreamEvent,
  ChatTaskStatusEvent,
} from "../shared/chat";
import type { ChatOutputPart } from "../shared/chatOutput";
import type { AgentTrajectoryEvent } from "../shared/agentTrajectory";
import { buildPrimaryRunContext } from "../shared/agentWorkspace";
import { defineNativeToolDescriptor } from "../shared/nativeCapabilities";
import type {
  WorkspaceRun,
  WorkspaceRunEvent,
  WorkspaceRunEventInput,
  WorkspaceRunTerminalStatus,
} from "../shared/workspaceRunLedger";
import type { GoalDraft } from "../shared/goalTranslation";
import type { PlanRecord } from "../shared/planMode";
import { deriveChatSessionWork } from "../shared/chatSessionWork";
import { KernelEventBus } from "./kernel/eventBus";
import {
  createProductionKernelDriver,
  type ProductionKernelDriver,
  type ProductionKernelRunInput,
  type ProductionKernelSegment,
} from "./kernel/productionKernelDriver";
import type { ChatKernelSettlement } from "./kernel/chatKernelSegment";
import { createConversationCausalStore } from "./conversationCausalStore";
import { createConversationCausalAttemptId } from "../shared/conversationCausalSpine";

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

function actorToolCallResponse(
  id: string,
  task = "review the final diff",
): ChatCompletionResponse {
  return {
    content: null,
    finishReason: "tool_calls",
    toolCalls: [
      {
        id,
        type: "function",
        function: {
          name: "actor",
          arguments: JSON.stringify({ op: "run", task, contextMode: "state" }),
        },
      },
    ],
  };
}

function createChatService(
  options: Parameters<typeof createProductionChatService>[0],
) {
  const runAgentLoop = options.runAgentLoop ??
    ((messages, profile, loopOptions) =>
      runProductionAgentLoop(messages, profile, {
        ...loopOptions,
        taskId: loopOptions.taskId ?? "task_chat_service_test",
      }));
  return createProductionChatService({
    ...options,
    runAgentLoop,
    toolAuthorizationService: options.toolAuthorizationService ?? {
      async authorize(taskId, request) {
        return {
          ok: true as const,
          decision: {
            allowed: true,
            reason: "allowed by chat service test fixture",
          },
          auditEvent: {
            id: `audit_${request.toolName}`,
            taskId,
            request,
            decision: {
              allowed: true,
              reason: "allowed by chat service test fixture",
            },
            createdAt: "2026-07-12T00:00:00.000Z",
          },
        };
      },
    },
  });
}

describe("chat service", () => {
  it("serializes concurrent sends for the same persisted session", async () => {
    const firstStarted = createDeferred<void>();
    const releaseFirst = createDeferred<void>();
    let modelCalls = 0;
    const service = createChatService({
      chatClient: {
        async complete() {
          modelCalls += 1;
          if (modelCalls === 1) {
            firstStarted.resolve();
            await releaseFirst.promise;
          }
          return chatReply(`reply ${modelCalls}`);
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
    });

    const first = service.sendMessage({
      sessionId: "session_serial",
      requestId: "request_1",
      message: "first",
    });
    await firstStarted.promise;
    const second = service.sendMessage({
      sessionId: "session_serial",
      requestId: "request_2",
      message: "second",
    });
    await flushAsyncTasks();

    expect(modelCalls).toBe(1);
    releaseFirst.resolve();
    await expect(first).resolves.toMatchObject({ ok: true, reply: "reply 1" });
    await expect(second).resolves.toMatchObject({ ok: true, reply: "reply 2" });
    expect(modelCalls).toBe(2);
  });

  it("cancels a queued same-session request before it persists or reaches the model", async () => {
    const firstStarted = createDeferred<void>();
    const releaseFirst = createDeferred<void>();
    let modelCalls = 0;
    const chatSessionStore = createChatSessionStore([]);
    const service = createChatService({
      chatClient: {
        async complete() {
          modelCalls += 1;
          if (modelCalls === 1) {
            firstStarted.resolve();
            await releaseFirst.promise;
          }
          return chatReply(`reply ${modelCalls}`);
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore,
    });

    const first = service.sendMessage({
      sessionId: "session_queued_cancel",
      requestId: "request_1",
      message: "first",
    });
    await firstStarted.promise;
    const controller = new AbortController();
    const second = service.sendMessage(
      {
        sessionId: "session_queued_cancel",
        requestId: "request_2",
        message: "second must not persist",
      },
      { signal: controller.signal },
    );
    controller.abort();

    await expect(second).resolves.toEqual({
      ok: false,
      code: "CANCELED",
      retryable: true,
      message: "已中断任务。",
    });
    expect(modelCalls).toBe(1);
    expect(
      (await chatSessionStore.get("session_queued_cancel"))?.messages.some(
        (message) => message.content.includes("second must not persist"),
      ) ?? false,
    ).toBe(false);

    releaseFirst.resolve();
    await expect(first).resolves.toMatchObject({ ok: true });
  });

  it("keeps default chat shell grants to non-opaque local diagnostics", () => {
    const templates = buildDefaultChatShellTemplates();

    expect(templates).toContain("git *");
    expect(templates).toContain("rg * *");
    expect(templates).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^(?:npm|npx|pnpm|yarn|bun|open|node|python|bash|sh)\b/),
      ]),
    );
  });

  it("returns a structured result for unknown guided skill input responses", async () => {
    const service = createChatService({
      chatClient: {
        async complete() {
          return chatReply("unused");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
    });

    await expect(
      service.respondSkillInput({
        inputRequestId: "input_1",
        values: {
          targetPath: "/workspace/project",
        },
      }),
    ).resolves.toEqual({
      ok: false,
      code: "UNKNOWN_SKILL_INPUT",
      message: "Unknown skill input request.",
    });
  });

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

  it("streams chat status events with the request id while preserving status callbacks", async () => {
    const statusEvents: ChatTaskStatusEvent[] = [];
    const streamEvents: ChatStreamEvent[] = [];
    const service = createChatService({
      chatClient: {
        async complete() {
          return chatReply("status stream done");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      createId: () => "chat_stream_status",
      now: () => new Date("2026-06-23T08:00:00.000Z"),
    });

    const result = await service.sendMessage(
      {
        requestId: "request_stream_1",
        message: "stream status",
      },
      {
        onStatusEvent(event) {
          statusEvents.push(event);
        },
        onStreamEvent(event) {
          streamEvents.push(event);
        },
      },
    );

    expect(result).toMatchObject({
      ok: true,
      sessionId: "chat_stream_status",
    });
    expect(statusEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sessionId: "chat_stream_status",
          state: "started",
          message: "正在读取模型配置",
        }),
      ]),
    );
    expect(streamEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "status",
          sessionId: "chat_stream_status",
          requestId: "request_stream_1",
          status: statusEvents[0],
          createdAt: statusEvents[0].createdAt,
          sequence: 1,
          turnId: "turn-request_stream_1",
        }),
      ]),
    );
    expect(statusEvents.every((event) =>
      event.requestId === "request_stream_1" &&
      typeof event.sequence === "number" &&
      event.turnId === "turn-request_stream_1"
    )).toBe(true);
    const streamSequences = streamEvents.map((event) => event.sequence);
    expect(streamSequences).toEqual([...streamSequences].sort((left, right) => left - right));
    expect(new Set(streamSequences).size).toBe(streamSequences.length);
  });

  it("does not advertise or execute tools when the selected model disables tool use", async () => {
    const requests: ChatCompletionRequest[] = [];
    let toolExecutions = 0;
    const service = createChatService({
      chatClient: {
        async complete(request) {
          requests.push(request);
          return chatReply("纯文本模型回复");
        },
      },
      getModelProfile: async () => ({
        ...(await createCompleteProfile()),
        modelCapabilities: {
          tools: false,
          streaming: true,
          vision: false,
          pdf: false,
          parallelToolCalls: false,
        },
      }),
      memoryStore: createMemoryStore(),
      toolExecutor: {
        ...createToolExecutor(),
        async execute(request, options) {
          toolExecutions += 1;
          return createToolExecutor().execute(request, options);
        },
      },
    });

    await expect(service.sendMessage({ message: "只回答，不调用工具" }))
      .resolves.toMatchObject({ ok: true, reply: "纯文本模型回复" });
    expect(requests[0]?.tools).toEqual([]);
    expect(toolExecutions).toBe(0);
  });

  it("persists status activity even when observer callbacks throw", async () => {
    const statusThrowActivityEvents: ChatTaskStatusEvent[] = [];
    const streamThrowActivityEvents: ChatTaskStatusEvent[] = [];
    const statusThrowService = createChatService({
      chatClient: {
        async complete() {
          return chatReply("status observer failure ignored");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: createChatSessionStore([], {
        activityEvents: statusThrowActivityEvents,
      }),
      createId: () => "chat_status_throw",
      now: () => new Date("2026-06-23T08:00:00.000Z"),
    });
    const streamThrowService = createChatService({
      chatClient: {
        async complete() {
          return chatReply("stream observer failure ignored");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: createChatSessionStore([], {
        activityEvents: streamThrowActivityEvents,
      }),
      createId: () => "chat_stream_throw",
      now: () => new Date("2026-06-23T08:00:00.000Z"),
    });

    await expect(
      statusThrowService.sendMessage(
        { message: "status observer throws" },
        {
          onStatusEvent() {
            throw new Error("status observer failed");
          },
        },
      ),
    ).resolves.toMatchObject({
      ok: true,
      reply: "status observer failure ignored",
    });
    await expect(
      streamThrowService.sendMessage(
        { message: "stream observer throws" },
        {
          onStreamEvent() {
            throw new Error("stream observer failed");
          },
        },
      ),
    ).resolves.toMatchObject({
      ok: true,
      reply: "stream observer failure ignored",
    });

    expect(statusThrowActivityEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          state: "started",
          sessionId: "persisted_session",
        }),
      ]),
    );
    expect(streamThrowActivityEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          state: "started",
          sessionId: "persisted_session",
        }),
      ]),
    );
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
        role: "user",
        content: expect.stringContaining("<memory_context>"),
      },
      { role: "user", content: "帮我整理下载文件夹" },
    ]);
    expect(JSON.stringify(capturedMessages[0])).not.toContain("我已准备好。");
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
        requestId: "request_1780732800000",
        role: "user",
        content: "帮我整理下载文件夹",
      },
      expect.objectContaining({
        sessionId: "persisted_session",
        role: "assistant",
        content: "我可以先检查任务和工具权限，然后运行文件整理 skill。",
        relatedMemoryIds: ["mem_downloads"],
        outputParts: expect.arrayContaining([
          expect.objectContaining({
            type: "text",
            text: "我可以先检查任务和工具权限，然后运行文件整理 skill。",
          }),
        ]),
      }),
    ]);
  });

  it("keeps renderer-provided history out of a durable session context", async () => {
    const capturedMessages: ChatMessage[][] = [];
    const chatMessages: AppendChatMessageInput[] = [];
    const service = createChatService({
      chatClient: {
        async complete(request) {
          capturedMessages.push(request.messages);
          return chatReply("只使用当前会话回答");
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
    });

    await service.sendMessage({
      message: "这是当前会话",
      history: [
        { role: "assistant", content: "FOREIGN_SESSION_SECRET" },
      ],
    });

    expect(JSON.stringify(capturedMessages[0])).toContain("这是当前会话");
    expect(JSON.stringify(capturedMessages[0])).not.toContain(
      "FOREIGN_SESSION_SECRET",
    );
  });

  it("allows global memory and only the current session's session memory", () => {
    const currentSessionMemory = createMemoryRecord({
      id: "memory_current_session",
      title: "当前会话记忆",
      content: "只属于当前会话",
      kind: "session",
      source: {
        type: "chat_session",
        sessionId: "session_current",
        messageIds: [],
      },
    });
    const foreignSessionMemory = createMemoryRecord({
      id: "memory_foreign_session",
      title: "其他会话记忆",
      content: "不能进入当前会话",
      kind: "session",
      source: {
        type: "chat_session",
        sessionId: "session_foreign",
        messageIds: [],
      },
    });
    const globalMemory = createMemoryRecord({
      id: "memory_global",
      title: "全局记忆",
      content: "允许跨会话使用",
      kind: "semantic",
    });

    expect(isMemoryVisibleToChatSession(currentSessionMemory, "session_current")).toBe(true);
    expect(isMemoryVisibleToChatSession(foreignSessionMemory, "session_current")).toBe(false);
    expect(isMemoryVisibleToChatSession(globalMemory, "session_current")).toBe(true);
  });

  it("anchors chat prompt dates in the configured system timezone", async () => {
    const capturedMessages: ChatMessage[][] = [];
    const service = createChatService({
      chatClient: {
        async complete(request) {
          capturedMessages.push(request.messages);
          return chatReply("我会先按 2026-06-25 查询昨天的开奖结果。");
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
      chatSessionStore: createChatSessionStore([]),
      createId: () => "chat_session_timezone",
      now: () => new Date("2026-06-25T16:30:00.000Z"),
      systemTimeZone: "Asia/Shanghai",
    });

    await service.sendMessage({
      message: "帮我查一下昨天双色球的开奖结果",
    });

    const systemPrompt = capturedMessages[0]?.[0]?.content ?? "";
    expect(systemPrompt).toContain("今天 / today: 2026-06-26");
    expect(systemPrompt).toContain("昨天 / yesterday: 2026-06-25");
  });

  it("preserves authored newlines in the user message sent to the model", async () => {
    const capturedMessages: ChatMessage[][] = [];
    const chatMessages: AppendChatMessageInput[] = [];
    const rawMessage = "\n请比较两段内容：\n第一段\n\n第二段\n";
    const service = createChatService({
      chatClient: {
        async complete(request) {
          capturedMessages.push(request.messages);
          return chatReply("收到换行内容。");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: createChatSessionStore(chatMessages),
      createId: () => "chat_newline_message",
      now: () => new Date("2026-06-06T08:00:00.000Z"),
    });

    const result = await service.sendMessage({ message: rawMessage });

    expect(result).toMatchObject({
      ok: true,
      sessionId: "persisted_session",
      reply: "收到换行内容。",
    });
    expect(chatMessages[0]).toMatchObject({
      role: "user",
      content: rawMessage,
    });
    expect(capturedMessages[0]?.at(-1)).toEqual({
      role: "user",
      content: rawMessage,
    });
  });

  it("records provider token usage for a successful model reply", async () => {
    const chatMessages: AppendChatMessageInput[] = [];
    const tokenUsageWrites: Array<{
      sessionId: string;
      usage: ChatSessionTokenUsage;
    }> = [];
    const service = createChatService({
      chatClient: {
        async complete() {
          return {
            content: "已完成。",
            toolCalls: [],
            finishReason: "stop",
            usage: {
              inputTokens: 100,
              outputTokens: 25,
              promptTokens: 100,
              completionTokens: 25,
              totalTokens: 125,
            },
          };
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: createChatSessionStore(chatMessages, { tokenUsageWrites }),
      createId: () => "chat_usage",
      now: () => new Date("2026-06-20T08:00:00.000Z"),
    });

    await service.sendMessage({ message: "统计 token" });

    expect(tokenUsageWrites).toEqual([
      {
        sessionId: "persisted_session",
        usage: {
          totalTokens: 125,
          promptTokens: 100,
          completionTokens: 25,
          estimated: false,
        },
      },
    ]);
  });

  it("records estimated token usage when the provider omits usage", async () => {
    const chatMessages: AppendChatMessageInput[] = [];
    const tokenUsageWrites: Array<{
      sessionId: string;
      usage: ChatSessionTokenUsage;
    }> = [];
    const service = createChatService({
      chatClient: {
        async complete() {
          return chatReply("已完成。");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: createChatSessionStore(chatMessages, { tokenUsageWrites }),
      createId: () => "chat_usage_estimated",
      now: () => new Date("2026-06-20T08:00:00.000Z"),
    });

    await service.sendMessage({ message: "估算 token" });

    expect(tokenUsageWrites).toEqual([
      {
        sessionId: "persisted_session",
        usage: expect.objectContaining({
          totalTokens: expect.any(Number),
          estimated: true,
        }),
      },
    ]);
    expect(tokenUsageWrites[0].usage.totalTokens).toBeGreaterThan(0);
  });

  it("creates and immediately starts a session goal from an explicit goal-setting message", async () => {
    const streamEvents: ChatStreamEvent[] = [];
    let completeCalled = false;
    const chatMessages: AppendChatMessageInput[] = [];
    const goalCreates: unknown[] = [];
    const resumes: string[] = [];
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
      goalService: createGoalService({ goalCreates, resumes }),
      createId: () => "chat_goal",
      now: () => new Date("2026-06-12T08:00:00.000Z"),
    });

    const result = await service.sendMessage(
      {
        requestId: "request_goal_start",
        message: "把这轮设为目标：发布 v1.8.0，直到 GitHub Release 完成才算结束",
      },
      {
        onStreamEvent(event) {
          streamEvents.push(event);
        },
      },
    );

    expect(result).toMatchObject({
      ok: true,
      activeGoal: {
        id: "goal_release",
        description: "发布 v1.8.0，直到 GitHub Release 完成才算结束",
        status: "executing",
      },
    });
    expect(goalCreates).toEqual([
      {
        sessionId: "persisted_session",
        originMessageId: "message_1",
        description: "发布 v1.8.0，直到 GitHub Release 完成才算结束",
      },
    ]);
    expect(resumes).toEqual(["goal_release"]);
    expect(attachedGoals).toEqual([
      {
        id: "goal_release",
        description: "发布 v1.8.0，直到 GitHub Release 完成才算结束",
        status: "executing",
      },
    ]);
    expect(chatMessages).toEqual([
      {
        requestId: "request_goal_start",
        role: "user",
        content: "把这轮设为目标：发布 v1.8.0，直到 GitHub Release 完成才算结束",
      },
      expect.objectContaining({
        sessionId: "persisted_session",
        role: "assistant",
        content:
          "已设置并开始执行目标：发布 v1.8.0，直到 GitHub Release 完成才算结束。",
        goalId: "goal_release",
        goalEventRef: "goal_started",
        outputParts: [
          expect.objectContaining({
            type: "text",
            text:
              "已设置并开始执行目标：发布 v1.8.0，直到 GitHub Release 完成才算结束。",
            createdAt: "2026-06-12T08:00:00.000Z",
          }),
        ],
      }),
    ]);
    const completedIndex = streamEvents.findIndex(
      (event) => event.type === "completed",
    );
    const finalTextPartIndex = streamEvents.findIndex(
      (event) =>
        event.type === "output_part" &&
        event.part.type === "text" &&
        event.part.text ===
          "已设置并开始执行目标：发布 v1.8.0，直到 GitHub Release 完成才算结束。",
    );
    expect(finalTextPartIndex).toBe(-1);
    expect(completedIndex).toBeGreaterThanOrEqual(0);
    expect(completeCalled).toBe(false);
  });

  it("creates a goal draft without starting execution when Goal Mode is enabled", async () => {
    let completeCalled = false;
    const chatMessages: AppendChatMessageInput[] = [];
    const draftCreates: unknown[] = [];
    const resumes: string[] = [];
    const goalDraft = createGoalDraftFixture({
      id: "goal_draft_release",
      sessionId: "persisted_session",
      originMessageId: "message_1",
      sourceMessage: "发布 v1.8.0，直到 GitHub Release 完成才算结束",
      normalizedDescription: "发布 v1.8.0 并完成 GitHub Release",
    });
    const service = createChatService({
      chatClient: {
        async complete() {
          completeCalled = true;
          return chatReply("unused");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: createChatSessionStore(chatMessages),
      goalService: createGoalService({ resumes }),
      goalDraftService: {
        async createFromChat(input) {
          draftCreates.push(input);
          return goalDraft;
        },
      },
      createId: () => "chat_goal_draft",
      now: () => new Date("2026-07-05T08:00:00.000Z"),
    });

    const result = await service.sendMessage({
      requestId: "request_goal_draft",
      mode: "goal_draft",
      message: "发布 v1.8.0，直到 GitHub Release 完成才算结束",
    });

    expect(result).toMatchObject({
      ok: true,
      goalDraft: {
        id: "goal_draft_release",
        normalizedDescription: "发布 v1.8.0 并完成 GitHub Release",
      },
    });
    expect(draftCreates).toEqual([
      {
        sessionId: "persisted_session",
        originMessageId: "message_1",
        message: "发布 v1.8.0，直到 GitHub Release 完成才算结束",
      },
    ]);
    expect(resumes).toEqual([]);
    expect(chatMessages).toEqual([
      {
        requestId: "request_goal_draft",
        role: "user",
        content: "发布 v1.8.0，直到 GitHub Release 完成才算结束",
      },
      expect.objectContaining({
        sessionId: "persisted_session",
        role: "assistant",
        content:
          "已生成目标草案：发布 v1.8.0 并完成 GitHub Release。请确认或编辑后再开始执行。",
        goalEventRef: "goal_draft_created",
      }),
    ]);
    expect(completeCalled).toBe(false);
  });

  it("routes the next message into an awaiting-input plan before skills or writable chat tools", async () => {
    const persistedMessages: AppendChatMessageInput[] = [];
    const attachmentText = "附件补充：实现细节由规划 Agent 自主决定。";
    const awaitingInputPlan = createPlanFixture({
      id: "plan_waiting",
      sessionId: "persisted_session",
      status: "awaiting_input",
      actionGate: "needs_input",
    });
    const clarifiedPlan = createPlanFixture({
      ...awaitingInputPlan,
      status: "awaiting_confirmation",
      actionGate: "ready",
      revision: awaitingInputPlan.revision + 7,
      finalArtifact: {
        ...awaitingInputPlan.finalArtifact!,
        title: "Clarified plan",
        unresolvedQuestions: [],
        actionGate: "ready",
        gateReason: "用户已授权执行 Agent 自主决定实现细节。",
      },
    });
    let skillDiscoveryCalls = 0;
    let modelCalls = 0;
    const continuations: Array<{
      planId: string;
      userInput: string;
      autonomyMode?: string;
    }> = [];
    const service = createChatService({
      chatClient: {
        async complete() {
          modelCalls += 1;
          return chatReply("ordinary chat must not run");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: createChatSessionStore(persistedMessages),
      planService: {
        async createPlan() {
          throw new Error("new plan must not be created");
        },
        async getInputRoutingPlan(sessionId) {
          return sessionId === "persisted_session" ? awaitingInputPlan : null;
        },
        async continueWithInput(planId, userInput, _signal, autonomyMode) {
          continuations.push({ planId, userInput, autonomyMode });
          return {
            ok: true as const,
            plan: clarifiedPlan,
            message: "continued",
          };
        },
      },
      async discoverSkills() {
        skillDiscoveryCalls += 1;
        return { skills: [], errors: [] };
      },
      toolExecutor: createToolExecutor(),
      createId: () => "chat_plan_input",
      now: () => new Date("2026-07-30T11:02:33.000Z"),
    });

    const result = await service.sendMessage({
      sessionId: "persisted_session",
      message: "dbs skill 就在当前技能列表里，其他实现细节你自己决定",
      planAutonomyMode: "auto",
      selectedSkillName: "dbs",
      attachments: [
        {
          id: "plan_clarification",
          name: "clarification.txt",
          mediaType: "text/plain",
          size: Buffer.byteLength(attachmentText),
          kind: "text",
          dataBase64: Buffer.from(attachmentText).toString("base64"),
        },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      plan: {
        id: "plan_waiting",
        status: "awaiting_confirmation",
        actionGate: "ready",
      },
      reply: expect.stringContaining("确认前仍不会执行任何任务"),
    });
    expect(continuations).toEqual([
      expect.objectContaining({
        planId: "plan_waiting",
        autonomyMode: "auto",
        userInput: expect.stringContaining(
          "dbs skill 就在当前技能列表里，其他实现细节你自己决定",
        ),
      }),
    ]);
    expect(continuations[0]?.userInput).toContain("<attachment_context>");
    expect(continuations[0]?.userInput).toContain(attachmentText);
    expect(skillDiscoveryCalls).toBe(0);
    expect(modelCalls).toBe(0);
    expect(
      persistedMessages.filter((message) => message.role === "assistant"),
    ).toHaveLength(1);
  });

  it("creates a controlled Goal amendment instead of revising a pending runtime Plan", async () => {
    const activeGoal: ChatSessionGoalSummary = {
      id: "goal_runtime_plan",
      description: "原目标",
      status: "waiting_for_review",
    };
    const runtimePlan = createPlanFixture({
      id: "plan_runtime_v2",
      sessionId: "persisted_session",
      status: "awaiting_confirmation",
      actionGate: "ready",
      purpose: "runtime_replan",
      goalId: activeGoal.id,
      goalPlanVersion: 2,
    });
    const amendmentRequests: Array<{
      goalId: string;
      objective: string;
      reason: string;
    }> = [];
    let continuationCalls = 0;
    let modelCalls = 0;
    const service = createChatService({
      chatClient: {
        async complete() {
          modelCalls += 1;
          return chatReply("ordinary chat must not run");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: createChatSessionStore([], { activeGoal }),
      planService: {
        async createPlan() {
          throw new Error("new plan must not be created");
        },
        async getInputRoutingPlan() {
          return runtimePlan;
        },
        async continueWithInput() {
          continuationCalls += 1;
          throw new Error("runtime Plan must not absorb a Goal amendment");
        },
      },
      async proposeGoalAmendment(goalId, objective, reason) {
        amendmentRequests.push({ goalId, objective, reason });
        return {
          ok: true as const,
          proposal: { id: "goal_amendment_1" } as never,
          message: "目标修订提案已创建，等待明确批准。",
        };
      },
      createId: () => "chat_goal_amendment",
      now: () => new Date("2026-08-03T00:00:00.000Z"),
    });

    const result = await service.sendMessage({
      sessionId: "persisted_session",
      message: "修改目标：只生成本地报告，不再发布",
    });

    expect(result).toMatchObject({
      ok: true,
      plan: { id: runtimePlan.id, goalPlanVersion: 2 },
      reply: expect.stringContaining("当前 Goal 和活动 Plan 尚未改变"),
    });
    expect(amendmentRequests).toEqual([
      {
        goalId: activeGoal.id,
        objective: "只生成本地报告，不再发布",
        reason: "修改目标：只生成本地报告，不再发布",
      },
    ]);
    expect(continuationCalls).toBe(0);
    expect(modelCalls).toBe(0);
  });

  it("routes feedback on a ready plan into a new Plan revision instead of ordinary chat", async () => {
    const readyPlan = createPlanFixture({
      id: "plan_ready",
      sessionId: "persisted_session",
      status: "awaiting_confirmation",
      actionGate: "ready",
      finalArtifact: {
        ...createPlanFixture({
          id: "source",
          sessionId: "persisted_session",
          status: "awaiting_input",
          actionGate: "needs_input",
        }).finalArtifact!,
        title: "Ready v1",
        unresolvedQuestions: [],
        actionGate: "ready",
        gateReason: "可确认。",
      },
    });
    const revisedPlan = createPlanFixture({
      ...readyPlan,
      revision: readyPlan.revision + 3,
      finalArtifact: {
        ...readyPlan.finalArtifact!,
        title: "Ready v2",
      },
    });
    let modelCalls = 0;
    let skillDiscoveryCalls = 0;
    const continuations: string[] = [];
    const service = createChatService({
      chatClient: {
        async complete() {
          modelCalls += 1;
          return chatReply("ordinary chat must not run");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: createChatSessionStore([]),
      planService: {
        async createPlan() {
          throw new Error("new plan must not be created");
        },
        async getInputRoutingPlan() {
          return readyPlan;
        },
        async continueWithInput(_planId, userInput) {
          continuations.push(userInput);
          return {
            ok: true as const,
            plan: revisedPlan,
            message: "revised",
          };
        },
      },
      async discoverSkills() {
        skillDiscoveryCalls += 1;
        return { skills: [], errors: [] };
      },
      toolExecutor: createToolExecutor(),
      createId: () => "chat_ready_plan_feedback",
      now: () => new Date("2026-07-30T11:02:34.000Z"),
    });

    const result = await service.sendMessage({
      sessionId: "persisted_session",
      message: "把回滚演练加进验收标准",
      mode: "chat",
    });

    expect(result).toMatchObject({
      ok: true,
      plan: {
        id: "plan_ready",
        status: "awaiting_confirmation",
        finalArtifact: { title: "Ready v2" },
      },
    });
    expect(continuations).toEqual(["把回滚演练加进验收标准"]);
    expect(skillDiscoveryCalls).toBe(0);
    expect(modelCalls).toBe(0);
  });

  it("publishes a continued Plan pause only after Chat and Workspace settlement", async () => {
    const chatGate = createDeferred();
    const workspaceGate = createDeferred();
    const lifecycle: string[] = [];
    const published: ChatTaskStatusEvent[] = [];
    const plan = createPlanFixture({
      id: "plan_required_pause",
      sessionId: "plan_required_session",
      status: "awaiting_input",
      actionGate: "needs_input",
    });
    const baseChatStore = createChatSessionStore([]);
    const chatStore = {
      ...baseChatStore,
      async appendActivityEvent(sessionId: string, event: ChatTaskStatusEvent) {
        if (event.state === "paused") {
          lifecycle.push("chat_started");
          await chatGate.promise;
          lifecycle.push("chat_settled");
        }
        return baseChatStore.appendActivityEvent(sessionId, event);
      },
    };
    const baseWorkspaceStore = createMemoryWorkspaceRunStore({
      creates: [],
      events: [],
      finishes: [],
    });
    const workspaceStore = {
      ...baseWorkspaceStore,
      async settleLifecycle(input: Parameters<WorkspaceRunStore["settleLifecycle"]>[0]) {
        if (input.snapshotStatus === "paused") {
          lifecycle.push("workspace_started");
          await workspaceGate.promise;
          lifecycle.push("workspace_settled");
        }
        return baseWorkspaceStore.settleLifecycle(input);
      },
    };
    const service = createChatService({
      chatClient: { async complete() { return chatReply("must not run"); } },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: chatStore,
      planService: {
        async createPlan() { throw new Error("must continue the existing Plan"); },
        async getInputRoutingPlan() { return plan; },
        async continueWithInput() {
          return { ok: true as const, plan: { ...plan, revision: plan.revision + 1 }, message: "paused" };
        },
      },
      workspaceService: {
        async resolveRunContext() {
          return buildPrimaryRunContext({
            workspaceId: "workspace_plan_pause",
            workspaceRoot: "/workspace/plan-pause",
          });
        },
      },
      workspaceRunStore: workspaceStore,
    });
    const sending = service.sendMessage({
      sessionId: "plan_required_session",
      requestId: "plan_required_request",
      message: "补充 Plan 输入",
      workspaceId: "workspace_plan_pause",
    }, {
      onStatusEvent(event) { published.push(event); },
    });

    await waitFor(() => lifecycle.includes("chat_started"));
    expect(published.some((event) => event.state === "paused")).toBe(false);
    chatGate.resolve();
    await waitFor(() => lifecycle.includes("workspace_started"));
    expect(published.some((event) => event.state === "paused")).toBe(false);
    workspaceGate.resolve();
    await expect(sending).resolves.toMatchObject({
      ok: true,
      turnSettlementStatus: "paused",
      plan: { status: "awaiting_input" },
    });
    expect(published.some((event) => event.state === "paused")).toBe(true);
  });

  it("publishes a newly created Plan pause only after Chat and Workspace settlement", async () => {
    const chatGate = createDeferred();
    const workspaceGate = createDeferred();
    const lifecycle: string[] = [];
    const published: ChatTaskStatusEvent[] = [];
    const plan = createPlanFixture({
      id: "plan_created_required_pause",
      sessionId: "plan_created_required_session",
      status: "awaiting_input",
      actionGate: "needs_input",
    });
    const baseChatStore = createChatSessionStore([]);
    const chatStore = {
      ...baseChatStore,
      async appendActivityEvent(sessionId: string, event: ChatTaskStatusEvent) {
        if (event.state === "paused") {
          lifecycle.push("chat_started");
          await chatGate.promise;
          lifecycle.push("chat_settled");
        }
        return baseChatStore.appendActivityEvent(sessionId, event);
      },
    };
    const baseWorkspaceStore = createMemoryWorkspaceRunStore({
      creates: [],
      events: [],
      finishes: [],
    });
    const workspaceStore = {
      ...baseWorkspaceStore,
      async settleLifecycle(input: Parameters<WorkspaceRunStore["settleLifecycle"]>[0]) {
        if (input.snapshotStatus === "paused") {
          lifecycle.push("workspace_started");
          await workspaceGate.promise;
          lifecycle.push("workspace_settled");
        }
        return baseWorkspaceStore.settleLifecycle(input);
      },
    };
    const service = createChatService({
      chatClient: { async complete() { return chatReply("must not run"); } },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: chatStore,
      planService: {
        async createPlan() { return plan; },
        async getInputRoutingPlan() { return null; },
        async continueWithInput() { throw new Error("must create a new Plan"); },
      },
      workspaceService: {
        async resolveRunContext() {
          return buildPrimaryRunContext({
            workspaceId: "workspace_plan_created_pause",
            workspaceRoot: "/workspace/plan-created-pause",
          });
        },
      },
      workspaceRunStore: workspaceStore,
    });
    const sending = service.sendMessage({
      sessionId: "plan_created_required_session",
      requestId: "plan_created_required_request",
      message: "制定一个仍需补充输入的实施目标",
      mode: "goal_plan",
      workspaceId: "workspace_plan_created_pause",
    }, {
      onStatusEvent(event) { published.push(event); },
    });

    await waitFor(() => lifecycle.includes("chat_started"));
    expect(published.some((event) => event.state === "paused")).toBe(false);
    chatGate.resolve();
    await waitFor(() => lifecycle.includes("workspace_started"));
    expect(published.some((event) => event.state === "paused")).toBe(false);
    workspaceGate.resolve();
    await expect(sending).resolves.toMatchObject({
      ok: true,
      turnSettlementStatus: "paused",
      plan: { status: "awaiting_input" },
    });
    expect(published.some((event) => event.state === "paused")).toBe(true);
  });

  it("keeps a failed Plan locked until retry or discard and never falls through to AgentLoop", async () => {
    const failedPlan = createPlanFixture({
      id: "plan_failed_round",
      sessionId: "persisted_session",
      status: "paused",
      actionGate: "blocked",
      finalArtifact: undefined,
      rounds: [
        {
          id: "round_b1",
          kind: "b1",
          role: "b",
          ordinal: 1,
          runId: "run_b1",
          modelBinding: {
            profileId: "profile_b",
            connectionId: "connection_b",
            providerKind: "openai",
            modelId: "model_b",
            revision: 1,
            connectionRevision: 1,
            profileRevision: 1,
            capabilities: {
              tools: true,
              vision: false,
              pdf: false,
              streaming: true,
              parallelToolCalls: false,
            },
            generation: {
              temperature: 0.2,
              maxTokens: 4096,
              thinkingEnabled: false,
              thinkingBudgetTokens: 1024,
            },
          },
          status: "failed",
          publicInputRefs: ["a1"],
          error: "provider unavailable",
        },
      ],
    });
    let modelCalls = 0;
    let skillDiscoveryCalls = 0;
    let continuationCalls = 0;
    const service = createChatService({
      chatClient: {
        async complete() {
          modelCalls += 1;
          return chatReply("ordinary chat must not run");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: createChatSessionStore([]),
      planService: {
        async createPlan() {
          throw new Error("new plan must not be created");
        },
        async getInputRoutingPlan() {
          return failedPlan;
        },
        async continueWithInput() {
          continuationCalls += 1;
          throw new Error("failed Plan cannot accept composer input");
        },
      },
      async discoverSkills() {
        skillDiscoveryCalls += 1;
        return { skills: [], errors: [] };
      },
      toolExecutor: createToolExecutor(),
      createId: () => "chat_failed_plan_locked",
      now: () => new Date("2026-07-30T11:02:35.000Z"),
    });

    const result = await service.sendMessage({
      sessionId: "persisted_session",
      message: "继续普通执行",
      selectedSkillName: "dbs",
    });

    expect(result).toMatchObject({
      ok: true,
      plan: {
        id: "plan_failed_round",
        status: "paused",
      },
      reply: expect.stringContaining("没有启动普通 Agent 或任何写入工具"),
    });
    expect(result.ok ? result.reply : "").toContain("重试失败轮次");
    expect(continuationCalls).toBe(0);
    expect(skillDiscoveryCalls).toBe(0);
    expect(modelCalls).toBe(0);
  });

  it("keeps a canceled Plan locked until the user explicitly discards it", async () => {
    const canceledPlan = createPlanFixture({
      id: "plan_canceled",
      sessionId: "persisted_session",
      status: "canceled",
      actionGate: "blocked",
      finalArtifact: undefined,
    });
    let modelCalls = 0;
    let skillDiscoveryCalls = 0;
    let continuationCalls = 0;
    const service = createChatService({
      chatClient: {
        async complete() {
          modelCalls += 1;
          return chatReply("ordinary chat must not run");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: createChatSessionStore([]),
      planService: {
        async createPlan() {
          throw new Error("new plan must not be created");
        },
        async getInputRoutingPlan() {
          return canceledPlan;
        },
        async continueWithInput() {
          continuationCalls += 1;
          throw new Error("canceled Plan cannot accept composer input");
        },
      },
      async discoverSkills() {
        skillDiscoveryCalls += 1;
        return { skills: [], errors: [] };
      },
      toolExecutor: createToolExecutor(),
      createId: () => "chat_canceled_plan_locked",
      now: () => new Date("2026-07-30T11:02:35.500Z"),
    });

    const result = await service.sendMessage({
      sessionId: "persisted_session",
      message: "绕过计划继续执行",
      selectedSkillName: "dbs",
    });

    expect(result).toMatchObject({
      ok: true,
      plan: { id: "plan_canceled", status: "canceled" },
      reply: expect.stringContaining("没有启动普通 Agent 或任何写入工具"),
    });
    expect(continuationCalls).toBe(0);
    expect(skillDiscoveryCalls).toBe(0);
    expect(modelCalls).toBe(0);
  });

  it("reports Plan clarification cancellation as canceled instead of failed", async () => {
    const statusEvents: ChatTaskStatusEvent[] = [];
    const streamEvents: ChatStreamEvent[] = [];
    const controller = new AbortController();
    const awaitingInputPlan = createPlanFixture({
      id: "plan_cancel_input",
      sessionId: "persisted_session",
      status: "awaiting_input",
      actionGate: "needs_input",
    });
    const service = createChatService({
      chatClient: {
        async complete() {
          return chatReply("ordinary chat must not run");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: createChatSessionStore([]),
      planService: {
        async createPlan() {
          throw new Error("new plan must not be created");
        },
        async getInputRoutingPlan() {
          return awaitingInputPlan;
        },
        async continueWithInput() {
          controller.abort(
            new DOMException("用户取消规划。", "AbortError"),
          );
          throw controller.signal.reason;
        },
      },
      createId: () => "chat_plan_input_canceled",
      now: () => new Date("2026-07-30T11:02:36.000Z"),
    });

    const result = await service.sendMessage(
      {
        sessionId: "persisted_session",
        message: "补充后取消",
      },
      {
        signal: controller.signal,
        onStatusEvent(event) {
          statusEvents.push(event);
        },
        onStreamEvent(event) {
          streamEvents.push(event);
        },
      },
    );

    expect(result).toEqual({
      ok: false,
      code: "CANCELED",
      retryable: true,
      message: "已中断任务。",
    });
    expect(statusEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          state: "canceled",
          message: "规划已中断",
        }),
      ]),
    );
    expect(statusEvents.some((event) => event.state === "failed")).toBe(false);
    expect(streamEvents.at(-1)).toMatchObject({
      type: "canceled",
      message: "已中断任务。",
    });
  });

  it("reports initial Plan cancellation as canceled without loading the normal chat model", async () => {
    const streamEvents: ChatStreamEvent[] = [];
    const statusEvents: ChatTaskStatusEvent[] = [];
    const bus = new KernelEventBus();
    const controller = new AbortController();
    let modelCalls = 0;
    const service = createChatService({
      chatClient: {
        async complete() {
          modelCalls += 1;
          return chatReply("ordinary chat must not run");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: createChatSessionStore([]),
      productionKernelDriver: createProductionKernelDriver({ bus }),
      planService: {
        async createPlan() {
          controller.abort(
            new DOMException("用户取消规划。", "AbortError"),
          );
          throw controller.signal.reason;
        },
        async getInputRoutingPlan() {
          return null;
        },
        async continueWithInput() {
          throw new Error("no plan to continue");
        },
      },
      createId: () => "chat_plan_creation_canceled",
      now: () => new Date("2026-07-30T11:02:37.000Z"),
    });

    const result = await service.sendMessage(
      {
        sessionId: "persisted_session",
        message: "创建一个辩论计划",
        mode: "goal_plan",
        planMode: "debate",
      },
      {
        signal: controller.signal,
        onStatusEvent(event) {
          statusEvents.push(event);
        },
        onStreamEvent(event) {
          streamEvents.push(event);
        },
      },
    );

    expect(result).toEqual({
      ok: false,
      code: "CANCELED",
      retryable: true,
      message: "已中断任务。",
    });
    expect(streamEvents.at(-1)).toMatchObject({
      type: "canceled",
      message: "已中断任务。",
    });
    expect(statusEvents.some((event) => event.state === "failed")).toBe(false);
    expect(bus.history().at(-1)).toMatchObject({
      type: "run_end",
      status: "canceled",
    });
    expect(modelCalls).toBe(0);
  });

  it("keeps raw Debate creation errors out of user-visible replies and status", async () => {
    const rawError = "HTTP 429 provider_request_id=req-secret stack=orchestrator.ts:517";
    const statusEvents: ChatTaskStatusEvent[] = [];
    const service = createChatService({
      chatClient: {
        async complete() {
          return chatReply("ordinary chat must not run");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: createChatSessionStore([]),
      planService: {
        async createPlan() {
          throw new Error(rawError);
        },
        async getInputRoutingPlan() {
          return null;
        },
        async continueWithInput() {
          throw new Error("no plan to continue");
        },
      },
      createId: () => "chat_plan_creation_failed",
    });

    const result = await service.sendMessage(
      {
        sessionId: "persisted_session",
        message: "创建一个 Debate 计划",
        mode: "goal_plan",
        planMode: "debate",
      },
      {
        onStatusEvent(event) {
          statusEvents.push(event);
        },
      },
    );

    expect(result).toEqual({
      ok: false,
      message:
        "Debate 规划失败。请检查模型连接后重新尝试；你的目标描述已经保留。",
    });
    expect(
      JSON.stringify({
        reply: result.ok ? result.reply : result.message,
        statusEvents,
      }),
    ).not.toContain(rawError);
  });

  it("projects a failed Debate record into one outcome and one next action", async () => {
    const rawError = "invalid structured output at A2; raw_payload={...}";
    const statusEvents: ChatTaskStatusEvent[] = [];
    const planned = createPlanFixture({
      id: "plan_failed_for_user",
      sessionId: "persisted_session",
      status: "paused",
      actionGate: "blocked",
      finalArtifact: undefined,
      planningStages: [
        {
          id: "generation_failed",
          kind: "generation",
          runId: "generation_run",
          status: "failed",
          evidenceRefs: [],
          error: rawError,
        },
      ],
    });
    const service = createChatService({
      chatClient: {
        async complete() {
          return chatReply("ordinary chat must not run");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: createChatSessionStore([]),
      planService: {
        async createPlan() {
          return planned;
        },
        async getInputRoutingPlan() {
          return null;
        },
        async continueWithInput() {
          throw new Error("no plan to continue");
        },
      },
      createId: () => "chat_plan_failed_record",
    });

    const result = await service.sendMessage(
      {
        sessionId: "persisted_session",
        message: "规划一个目标",
        mode: "goal_plan",
        planMode: "debate",
      },
      {
        onStatusEvent(event) {
          statusEvents.push(event);
        },
      },
    );

    expect(result).toMatchObject({
      ok: true,
      reply:
        "Debate 规划失败。系统没有完成这次规划，但已完成的内容已经保留。 下一步：请选择一个可用模型后重新尝试，已完成的准备工作会保留。",
    });
    expect(
      JSON.stringify({
        reply: result.ok ? result.reply : result.message,
        statusEvents,
      }),
    ).not.toContain(rawError);
  });

  it("does not collect execution-time Skill inputs before creating a read-only Plan", async () => {
    const streamEvents: ChatStreamEvent[] = [];
    const planCreates: Array<{
      sessionId: string;
      sourceMessage: string;
      mode: string;
      autonomyMode?: string;
    }> = [];
    let agentLoopCalls = 0;
    const planned = createPlanFixture({
      id: "plan_with_skill_context",
      sessionId: "persisted_session",
      status: "awaiting_confirmation",
      actionGate: "ready",
      finalArtifact: {
        ...createPlanFixture({
          id: "source_skill_plan",
          sessionId: "persisted_session",
          status: "awaiting_input",
          actionGate: "needs_input",
        }).finalArtifact!,
        unresolvedQuestions: [],
        actionGate: "ready",
        gateReason: "Skill execution inputs are deferred to implementation.",
      },
    });
    const selectedSkill = createSkillRecord({
      name: "dbs",
      manifest: {
        inputs: [
          {
            name: "target",
            label: "目标",
            type: "string",
            required: true,
          },
        ],
      },
    });
    const service = createChatService({
      chatClient: {
        async complete() {
          return chatReply("ordinary chat must not run");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: createChatSessionStore([]),
      planService: {
        async createPlan(input) {
          planCreates.push(input);
          return planned;
        },
        async getInputRoutingPlan() {
          return null;
        },
        async continueWithInput() {
          throw new Error("no plan to continue");
        },
      },
      async discoverSkills() {
        return { skills: [selectedSkill], errors: [] };
      },
      toolExecutor: createToolExecutor(),
      async runAgentLoop() {
        agentLoopCalls += 1;
        return {
          status: "succeeded" as const,
          summary: "must not run",
          turns: 1,
          messages: [],
          toolCallsExecuted: 0,
        };
      },
      createId: () => "chat_plan_skill_context",
      now: () => new Date("2026-07-30T11:02:38.000Z"),
    });

    const result = await service.sendMessage(
      {
        sessionId: "persisted_session",
        message: "使用 @dbs 规划一个本地功能",
        selectedSkillName: "dbs",
        mode: "goal_plan",
        planMode: "debate",
        planAutonomyMode: "auto",
      },
      {
        onStreamEvent(event) {
          streamEvents.push(event);
        },
      },
    );

    expect(result).toMatchObject({
      ok: true,
      plan: {
        id: "plan_with_skill_context",
        status: "awaiting_confirmation",
      },
      selectedSkill: { name: "dbs" },
    });
    expect(planCreates).toEqual([
      expect.objectContaining({
        sessionId: "persisted_session",
        sourceMessage: "使用 @dbs 规划一个本地功能",
        mode: "debate",
        autonomyMode: "auto",
        selectedSkill: expect.objectContaining({
          manifest: expect.objectContaining({ name: "dbs" }),
        }),
      }),
    ]);
    expect(
      streamEvents.some((event) => event.type === "waiting_for_input"),
    ).toBe(false);
    expect(agentLoopCalls).toBe(0);
  });

  it("keeps text attachments on the read-only Goal Plan route", async () => {
    const attachmentText = "附件中的验收要求：不得执行任何写入。";
    const planCreates: Array<{ sourceMessage: string }> = [];
    let ordinaryModelCalls = 0;
    const planned = createPlanFixture({
      id: "plan_with_text_attachment",
      sessionId: "persisted_session",
      status: "awaiting_confirmation",
      actionGate: "ready",
    });
    const service = createChatService({
      chatClient: {
        async complete() {
          ordinaryModelCalls += 1;
          return chatReply("ordinary chat must not run");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: createChatSessionStore([]),
      planService: {
        async createPlan(input) {
          planCreates.push(input);
          return planned;
        },
        async getInputRoutingPlan() {
          return null;
        },
        async continueWithInput() {
          throw new Error("no plan to continue");
        },
      },
      createId: () => "chat_plan_text_attachment",
    });

    const result = await service.sendMessage({
      sessionId: "persisted_session",
      message: "请先规划这个目标",
      mode: "goal_plan",
      planMode: "debate",
      attachments: [
        {
          id: "plan_requirements",
          name: "requirements.txt",
          mediaType: "text/plain",
          size: Buffer.byteLength(attachmentText),
          kind: "text",
          dataBase64: Buffer.from(attachmentText).toString("base64"),
        },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      plan: { id: "plan_with_text_attachment" },
    });
    expect(planCreates).toHaveLength(1);
    expect(planCreates[0]?.sourceMessage).toContain("<attachment_context>");
    expect(planCreates[0]?.sourceMessage).toContain(attachmentText);
    expect(ordinaryModelCalls).toBe(0);
  });

  it("rejects image attachments before a Goal Plan can fall through to ordinary execution", async () => {
    const storedMessages: AppendChatMessageInput[] = [];
    let planCreates = 0;
    let ordinaryModelCalls = 0;
    const onePixelPng =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Wl5sAAAAASUVORK5CYII=";
    const service = createChatService({
      chatClient: {
        async complete() {
          ordinaryModelCalls += 1;
          return chatReply("ordinary chat must not run");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: createChatSessionStore(storedMessages),
      planService: {
        async createPlan() {
          planCreates += 1;
          throw new Error("image plan must be rejected before creation");
        },
        async getInputRoutingPlan() {
          return null;
        },
        async continueWithInput() {
          throw new Error("no plan to continue");
        },
      },
      createId: () => "chat_plan_image_attachment",
    });

    await expect(
      service.sendMessage({
        sessionId: "persisted_session",
        message: "根据截图创建计划",
        mode: "goal_plan",
        planMode: "debate",
        attachments: [
          {
            id: "plan_screenshot",
            name: "screen.png",
            mediaType: "image/png",
            size: 68,
            kind: "image",
            dataBase64: onePixelPng,
          },
        ],
      }),
    ).resolves.toEqual({
      ok: false,
      message:
        "只读 Plan Mode 暂不支持图片附件。请先移除图片，或把关键信息转为文本附件后再规划。",
    });
    expect(storedMessages).toHaveLength(0);
    expect(planCreates).toBe(0);
    expect(ordinaryModelCalls).toBe(0);
  });

  it("rejects image attachments before revising an existing read-only Plan", async () => {
    const storedMessages: AppendChatMessageInput[] = [];
    let continuations = 0;
    const activePlan = createPlanFixture({
      id: "plan_waiting_for_text",
      sessionId: "persisted_session",
      status: "awaiting_input",
      actionGate: "needs_input",
    });
    const service = createChatService({
      chatClient: {
        async complete() {
          return chatReply("ordinary chat must not run");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: createChatSessionStore(storedMessages),
      planService: {
        async createPlan() {
          throw new Error("new plan must not be created");
        },
        async getInputRoutingPlan() {
          return activePlan;
        },
        async continueWithInput() {
          continuations += 1;
          throw new Error("image must not revise the plan");
        },
      },
      createId: () => "chat_existing_plan_image",
    });

    await expect(
      service.sendMessage({
        sessionId: "persisted_session",
        message: "截图里是补充信息",
        attachments: [
          {
            id: "clarification_screenshot",
            name: "clarification.png",
            mediaType: "image/png",
            size: 68,
            kind: "image",
            dataBase64:
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Wl5sAAAAASUVORK5CYII=",
          },
        ],
      }),
    ).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("Plan Mode 暂不支持图片附件"),
    });
    expect(storedMessages).toHaveLength(0);
    expect(continuations).toBe(0);
  });

  it("invalidates an older pending Skill input when the session has since entered Plan Mode", async () => {
    const initialStreamEvents: ChatStreamEvent[] = [];
    const activePlan = createPlanFixture({
      id: "plan_after_skill_prompt",
      sessionId: "persisted_session",
      status: "awaiting_input",
      actionGate: "needs_input",
    });
    let planIsActive = false;
    let agentLoopCalls = 0;
    const selectedSkill = createSkillRecord({
      name: "dbs",
      manifest: {
        inputs: [
          {
            name: "target",
            label: "目标",
            type: "string",
            required: true,
          },
        ],
      },
    });
    const service = createChatService({
      chatClient: {
        async complete() {
          return chatReply("ordinary chat must not run");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: createChatSessionStore([]),
      planService: {
        async createPlan() {
          throw new Error("plan creation is external to this fixture");
        },
        async getInputRoutingPlan() {
          return planIsActive ? activePlan : null;
        },
        async continueWithInput() {
          throw new Error("old Skill input must not revise the Plan");
        },
      },
      async discoverSkills() {
        return { skills: [selectedSkill], errors: [] };
      },
      toolExecutor: createToolExecutor(),
      async runAgentLoop() {
        agentLoopCalls += 1;
        return {
          status: "succeeded" as const,
          summary: "must not run",
          turns: 1,
          messages: [],
          toolCallsExecuted: 0,
        };
      },
      createId: createSequentialId("stale_skill_plan_lock"),
      now: () => new Date("2026-07-30T11:02:39.000Z"),
    });

    await expect(
      service.sendMessage(
        {
          sessionId: "persisted_session",
          requestId: "request_old_skill",
          message: "使用 dbs",
          selectedSkillName: "dbs",
        },
        {
          onStreamEvent(event) {
            initialStreamEvents.push(event);
          },
        },
      ),
    ).resolves.toEqual({
      ok: false,
      code: "SKILL_INPUT_REQUIRED",
      message: "Skill input required.",
    });
    const inputRequest = initialStreamEvents.find(
      (event): event is Extract<ChatStreamEvent, { type: "waiting_for_input" }> =>
        event.type === "waiting_for_input",
    )?.inputRequest;
    expect(inputRequest).toBeTruthy();

    planIsActive = true;
    const result = await service.respondSkillInput({
      inputRequestId: inputRequest?.id ?? "",
      values: { target: "local" },
    });

    expect(result).toMatchObject({
      ok: true,
      plan: {
        id: "plan_after_skill_prompt",
        status: "awaiting_input",
      },
      reply: expect.stringContaining("更早的 Skill 输入已作废"),
    });
    expect(agentLoopCalls).toBe(0);
  });

  it("creates and immediately starts a session goal from a slash goal command", async () => {
    let completeCalled = false;
    const goalCreates: unknown[] = [];
    const resumes: string[] = [];
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
      goalService: createGoalService({ goalCreates, resumes }),
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
        status: "executing",
      },
    });
    expect(goalCreates).toEqual([
      {
        sessionId: "persisted_session",
        originMessageId: "message_1",
        description: "发布 v1.8.0，直到 GitHub Release 完成才算结束",
      },
    ]);
    expect(resumes).toEqual(["goal_release"]);
    expect(completeCalled).toBe(false);
  });

  it("keeps explicit slash goal routing when an agent skill is selected", async () => {
    let completeCalled = false;
    const goalCreates: unknown[] = [];
    const resumes: string[] = [];
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
      goalService: createGoalService({ goalCreates, resumes }),
      discoverSkills: async () => ({
        skills: [
          createSkillRecord({
            name: "onepager",
            body: "Onepager 技能流程：必须先做内容架构分析。",
          }),
        ],
        errors: [],
      }),
      createId: () => "chat_goal_skill",
      now: () => new Date("2026-06-12T08:00:00.000Z"),
    });

    const result = await service.sendMessage({
      message: "/目标 给这个项目生成一份可阅读 HTML 报告",
      selectedSkillName: "onepager",
    });

    expect(result).toMatchObject({
      ok: true,
      activeGoal: {
        id: "goal_release",
        description: "给这个项目生成一份可阅读 HTML 报告",
        status: "executing",
      },
      selectedSkill: {
        name: "onepager",
        displayName: "onepager",
      },
    });
    expect(goalCreates).toEqual([
      expect.objectContaining({
        sessionId: "persisted_session",
        originMessageId: "message_1",
        description: "给这个项目生成一份可阅读 HTML 报告",
        selectedSkill: expect.objectContaining({
          body: "Onepager 技能流程：必须先做内容架构分析。",
          manifest: expect.objectContaining({ name: "onepager" }),
        }),
      }),
    ]);
    expect(resumes).toEqual(["goal_release"]);
    expect(completeCalled).toBe(false);
  });

  it("routes huashu-design slash goals into durable Goal Mode with attached active summary", async () => {
    let completeCalled = false;
    const goalCreates: unknown[] = [];
    const resumes: string[] = [];
    const attachedGoals: ChatSessionGoalSummary[] = [];
    const statusEvents: ChatTaskStatusEvent[] = [];
    const service = createChatService({
      chatClient: {
        async complete() {
          completeCalled = true;
          return chatReply("unused");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: createChatSessionStore([], { attachedGoals }),
      goalService: createGoalService({ goalCreates, resumes }),
      discoverSkills: async () => ({
        skills: [
          createSkillRecord({
            name: "huashu-design",
            body: "Huashu Design 技能流程：必须先做设计假设、三版方向、截图验收。",
          }),
        ],
        errors: [],
      }),
      createId: () => "chat_goal_huashu_design",
      now: () => new Date("2026-06-30T08:00:00.000Z"),
    });

    const result = await service.sendMessage(
      {
        message:
          "/目标 派出仿写专家 subagent 分析长文，最后调用 @huashu-design 生成 HTML 仿写学习指南",
        selectedSkillName: "huashu-design",
      },
      { onStatusEvent: (event) => statusEvents.push(event) },
    );

    expect(result).toMatchObject({
      ok: true,
      activeGoal: {
        id: "goal_release",
        description:
          "派出仿写专家 subagent 分析长文，最后调用 @huashu-design 生成 HTML 仿写学习指南",
        status: "executing",
      },
      selectedSkill: {
        name: "huashu-design",
        displayName: "huashu-design",
      },
    });
    expect(goalCreates).toEqual([
      expect.objectContaining({
        sessionId: "persisted_session",
        originMessageId: "message_1",
        description:
          "派出仿写专家 subagent 分析长文，最后调用 @huashu-design 生成 HTML 仿写学习指南",
        selectedSkill: expect.objectContaining({
          body: "Huashu Design 技能流程：必须先做设计假设、三版方向、截图验收。",
          manifest: expect.objectContaining({ name: "huashu-design" }),
        }),
      }),
    ]);
    expect(attachedGoals.at(-1)).toEqual({
      id: "goal_release",
      description:
        "派出仿写专家 subagent 分析长文，最后调用 @huashu-design 生成 HTML 仿写学习指南",
      status: "executing",
    });
    expect(
      statusEvents.filter((event) => event.state === "requirement"),
    ).toEqual([
      expect.objectContaining({
        message: "子任务：派出仿写专家 subagent 分析长文",
        payload: expect.objectContaining({
          requirementId: "goal-requirement-1",
          label: "派出仿写专家 subagent 分析长文",
          status: "active",
        }),
      }),
      expect.objectContaining({
        message: "子任务：调用 @huashu-design 生成 HTML 仿写学习指南",
        payload: expect.objectContaining({
          requirementId: "goal-requirement-2",
          label: "调用 @huashu-design 生成 HTML 仿写学习指南",
          status: "pending",
        }),
      }),
    ]);
    expect(resumes).toEqual(["goal_release"]);
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

  it.each(["failed", "stopped_stalled"] as const)(
    "retries the same %s session goal for a natural-language continuation",
    async (status) => {
    let completeCalled = false;
    const statusEvents: ChatTaskStatusEvent[] = [];
    const retries: string[] = [];
    const goalCreates: unknown[] = [];
    const attachedGoals: ChatSessionGoalSummary[] = [];
    const activeGoal: ChatSessionGoalSummary = {
      id: "goal_recoverable",
      description: "深度调研 Serenity",
      status,
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
      goalService: createGoalService({ goalCreates, retries }),
      createId: () => "chat_goal",
      now: () => new Date("2026-06-13T08:00:00.000Z"),
    });

    const result = await service.sendMessage(
      {
        sessionId: "persisted_session",
        message: "按照你的建议，把接下来的工作推进完成。",
      },
      {
        onStatusEvent(event) {
          statusEvents.push(event);
        },
      },
    );

    expect(result).toMatchObject({
      ok: true,
      reply:
        "已恢复原目标并继续执行：深度调研 Serenity。原有 Plan、里程碑和验收记录保持关联。",
      activeGoal: {
        id: "goal_recoverable",
        description: "深度调研 Serenity",
        status: "executing",
      },
    });
    expect(goalCreates).toEqual([]);
    expect(retries).toEqual(["goal_recoverable"]);
    expect(attachedGoals.at(-1)).toEqual({
      id: "goal_recoverable",
      description: "深度调研 Serenity",
      status: "executing",
    });
    expect(statusEvents.map((event) => event.message)).toContain(
      "已恢复原目标执行",
    );
    expect(completeCalled).toBe(false);
    },
  );

  it("keeps legacy budget-stopped goals read-only from chat", async () => {
    let completeCalled = false;
    const resumes: string[] = [];
    const goalCreates: unknown[] = [];
    const activeGoal: ChatSessionGoalSummary = {
      id: "goal_release",
      description: "发布",
      status: "stopped_budget",
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
      goalService: createGoalService({ goalCreates, resumes }),
      createId: () => "chat_goal",
      now: () => new Date("2026-06-13T08:00:00.000Z"),
    });

    const result = await service.sendMessage({
      sessionId: "persisted_session",
      message: "继续这个目标",
    });

    expect(result).toMatchObject({
      ok: true,
      reply:
        "这是旧版本地预算机制留下的只读任务，不能继续执行。你仍可查看原结果和执行证据。",
      activeGoal: {
        id: "goal_release",
        description: "发布",
        status: "stopped_budget",
      },
    });
    expect(goalCreates).toEqual([]);
    expect(resumes).toEqual([]);
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

  it("routes an explicit objective change into a Goal amendment proposal", async () => {
    let completeCalled = false;
    const amendmentRequests: Array<{
      goalId: string;
      objective: string;
      reason: string;
    }> = [];
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
      goalService: createGoalService({}),
      async proposeGoalAmendment(goalId, objective, reason) {
        amendmentRequests.push({ goalId, objective, reason });
        return {
          ok: true as const,
          proposal: {
            id: "goal_amendment_chat",
            pausedExecution: true,
          } as never,
          message: "目标修订提案已创建，原执行路径已安全暂停并等待明确批准。",
        };
      },
      createId: () => "chat_goal_amendment",
      now: () => new Date("2026-08-03T00:00:00.000Z"),
    });

    const result = await service.sendMessage({
      sessionId: "persisted_session",
      message: "调整目标：仅完成本地构建",
    });

    expect(result).toMatchObject({
      ok: true,
      activeGoal: {
        id: activeGoal.id,
        description: "发布",
        status: "waiting_for_review",
      },
      reply: expect.stringContaining("GoalContract 和活动 Plan 尚未改变"),
    });
    expect(amendmentRequests).toEqual([
      {
        goalId: activeGoal.id,
        objective: "仅完成本地构建",
        reason: "用户请求修改目标：仅完成本地构建",
      },
    ]);
    expect(completeCalled).toBe(false);
  });

  it("routes a structural Plan adjustment into a runtime Direct Plan instead of ordinary chat", async () => {
    let completeCalled = false;
    const replanRequests: Array<{ goalId: string; instructions: string }> = [];
    const activeGoal: ChatSessionGoalSummary = {
      id: "goal_runtime_replan",
      description: "完成本地实现",
      status: "executing",
    };
    const runtimePlan = createPlanFixture({
      id: "plan_runtime_direct_v2",
      sessionId: "persisted_session",
      mode: "direct",
      purpose: "runtime_replan",
      goalId: activeGoal.id,
      goalPlanVersion: 2,
      status: "awaiting_confirmation",
      actionGate: "ready",
    });
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
      goalService: createGoalService({}),
      async runtimeReplanGoal(goalId, instructions) {
        replanRequests.push({ goalId, instructions });
        return {
          ok: true as const,
          plan: runtimePlan,
          message: "已生成运行期 Direct Plan。",
        };
      },
      createId: () => "chat_runtime_replan",
      now: () => new Date("2026-08-03T00:00:00.000Z"),
    });

    const result = await service.sendMessage({
      sessionId: "persisted_session",
      message: "调整目标计划：改用本地验证路径",
    });

    expect(result).toMatchObject({
      ok: true,
      plan: {
        id: runtimePlan.id,
        purpose: "runtime_replan",
        mode: "direct",
      },
      reply: expect.stringContaining("采用前不会覆盖当前 Goal"),
    });
    expect(replanRequests).toEqual([
      {
        goalId: activeGoal.id,
        instructions: "改用本地验证路径",
      },
    ]);
    expect(completeCalled).toBe(false);
  });

  it("clears the active chat goal link when review continuation achieves the goal", async () => {
    const attachedGoals: ChatSessionGoalSummary[] = [];
    const clearedGoals: Array<{ sessionId: string; goalId: string }> = [];
    const activeGoal: ChatSessionGoalSummary = {
      id: "goal_release",
      description: "发布",
      status: "waiting_for_review",
    };
    const service = createChatService({
      chatClient: {
        async complete() {
          return chatReply("unused");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: createChatSessionStore([], {
        activeGoal,
        attachedGoals,
        clearedGoals,
      }),
      goalService: createGoalService({ resolveStatus: "achieved" }),
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
        status: "achieved",
      },
    });
    expect(attachedGoals.at(-1)).toMatchObject({
      id: "goal_release",
      status: "achieved",
    });
    expect(clearedGoals).toEqual([
      { sessionId: "persisted_session", goalId: "goal_release" },
    ]);
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

  it("preserves an injected legacy budget failure as a read-only terminal record", async () => {
    const statusEvents: ChatTaskStatusEvent[] = [];
    const streamEvents: ChatStreamEvent[] = [];
    const persistedMessages: AppendChatMessageInput[] = [];
    const tokenUsageWrites: Array<{
      sessionId: string;
      usage: ChatSessionTokenUsage;
    }> = [];
    const service = createChatService({
      chatClient: {
        async complete() {
          return chatReply("unused");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: createChatSessionStore(persistedMessages, {
        activityEvents: statusEvents,
        tokenUsageWrites,
      }),
      toolExecutor: createToolExecutor(),
      async runAgentLoop() {
        return {
          summary:
            "Token budget exceeded: 68374 tokens consumed (limit: 65536). The agent loop aborted to prevent cost overrun.",
          status: "failed" as const,
          turns: 16,
          messages: [],
          toolCallsExecuted: 21,
          tokensConsumed: 68_374,
        };
      },
      createId: () => "chat_failed_budget",
      now: () => new Date("2026-07-30T11:03:21.000Z"),
    });

    const result = await service.sendMessage(
      { message: "执行长任务" },
      {
        onStatusEvent(event) {
          statusEvents.push(event);
        },
        onStreamEvent(event) {
          streamEvents.push(event);
        },
      },
    );

    expect(result).toMatchObject({
      ok: true,
      agentStatus: {
        state: "failed",
        toolCallsExecuted: 21,
        message: expect.stringContaining("Token budget exceeded"),
      },
    });
    expect(statusEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          state: "failed",
          message: "检测到旧版 Token 预算停止记录，任务未完成（只读）",
          toolCallsExecuted: 21,
        }),
      ]),
    );
    expect(statusEvents.some((event) => event.state === "completed")).toBe(false);
    expect(streamEvents.at(-1)).toMatchObject({
      type: "failed",
      message: expect.stringContaining("Token budget exceeded"),
    });
    expect(
      persistedMessages.find((message) => message.role === "assistant")?.content,
    ).toContain("Token budget exceeded");
    expect(tokenUsageWrites).toEqual([
      {
        sessionId: "persisted_session",
        usage: {
          totalTokens: 68_374,
          estimated: true,
        },
      },
    ]);
  });

  it("automatically continues long chat tasks across checkpoint intervals", async () => {
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

    const completed = await service.sendMessage({
      message: "请执行一个需要检查点确认的长任务",
    });

    expect(completed).toMatchObject({
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
          if (
            request.tools &&
            !request.messages.some((message) => message.role === "tool")
          ) {
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

  it("includes tool execution errors in task status events", async () => {
    const statusEvents: ChatTaskStatusEvent[] = [];
    const service = createChatService({
      chatClient: {
        async complete(request) {
          if (request.tools && !request.messages.some((message) => message.role === "tool")) {
            return toolCallResponse("call_missing", "/missing-path");
          }

          return chatReply("我会换一种路径继续。");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      toolExecutor: createToolExecutor({
        ok: false,
        error: "ENOENT: no such file or directory, scandir '/missing-path'",
      }),
      createId: () => "chat_tool_error_status",
      now: () => new Date("2026-06-20T10:00:00.000Z"),
    });

    const result = await service.sendMessage(
      {
        message: "检查一个不存在的路径",
      },
      {
        onStatusEvent(event) {
          statusEvents.push(event);
        },
      },
    );

    expect(result).toMatchObject({
      ok: true,
      reply: expect.stringContaining("我会换一种路径继续。"),
    });
    expect(statusEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          state: "tool_result",
          toolName: "file_list",
          ok: false,
          message:
            "工具失败：file_list（ENOENT: no such file or directory, scandir '/missing-path'）",
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
      "run_context_created",
      "model_request",
      "model_response",
      "tool_invocation",
      "tool_invocation",
      "tool_invocation",
      "tool_call",
      "tool_invocation",
      "tool_invocation",
      "tool_result",
      "model_request",
      "model_response",
      "final_summary",
    ]);
    expect(trajectoryEvents[0]).toMatchObject({
      type: "run_context_created",
      payload: {
        runtimeContextSnapshot: expect.objectContaining({
          surface: "chat",
          model: expect.objectContaining({
            modelId: "agent-model",
          }),
          permissions: expect.objectContaining({
            taskId: expect.stringContaining("chat:"),
            approvalMode: "manual",
          }),
        }),
        runtimeContextSnapshotSummary: expect.objectContaining({
          surface: "chat",
          visibleToolCount: expect.any(Number),
        }),
      },
    });
    expect(JSON.stringify(trajectoryEvents[0].payload)).not.toContain("secret");
    expect(
      trajectoryEvents
        .filter((event) => event.type === "tool_invocation")
        .map((event) => event.payload.invocationStatus),
    ).toEqual(["proposed", "visible", "authorized", "running", "completed"]);
    expect(trajectoryEvents.every((event) => event.runId === "chat_evidence_2")).toBe(
      true,
    );
  });

  it("resolves the selected workspace and passes run context into the agent loop", async () => {
    const resolvedWorkspaces: unknown[] = [];
    const chatMessages: AppendChatMessageInput[] = [];
    const statusEvents: ChatTaskStatusEvent[] = [];
    const workspaceRunCreates: unknown[] = [];
    const workspaceRunEvents: WorkspaceRunEventInput[] = [];
    const workspaceRunFinishes: Array<{
      workspaceRunId: string;
      status: WorkspaceRunTerminalStatus;
      summary?: string;
    }> = [];
    let observedLoopOptions: unknown = null;
    const service = createChatService({
      chatClient: {
        async complete() {
          return chatReply("unused");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: createChatSessionStore(chatMessages),
      workspaceService: {
        async resolveRunContext(input) {
          resolvedWorkspaces.push(input);
          return buildPrimaryRunContext({
            workspaceId: "workspace_project",
            workspaceRoot: "/workspace/project",
          });
        },
      },
      toolExecutor: createToolExecutor(),
      workspaceRunStore: createMemoryWorkspaceRunStore({
        creates: workspaceRunCreates,
        events: workspaceRunEvents,
        finishes: workspaceRunFinishes,
      }),
      async runAgentLoop(_messages, _profile, options) {
        observedLoopOptions = options;
        return {
          status: "succeeded",
          summary: "done",
          turns: 1,
          messages: [],
          toolCallsExecuted: 0,
        };
      },
      createId: () => "chat_workspace",
      now: () => new Date("2026-06-21T08:00:00.000Z"),
    });

    const result = await service.sendMessage(
      {
        sessionId: "chat_session_1",
        requestId: "request_1",
        message: "inspect project",
        workspaceId: "workspace_project",
      },
      {
        onStatusEvent(event) {
          statusEvents.push(event);
        },
      },
    );

    expect(result).toMatchObject({
      ok: true,
      reply: "done",
      sessionId: "chat_session_1",
    });
    expect(resolvedWorkspaces).toEqual([{ workspaceId: "workspace_project" }]);
    expect(chatMessages[0]).toMatchObject({
      role: "user",
      content: "inspect project",
      workspaceId: "workspace_project",
      workspaceSummary: {
        name: "project",
        rootPath: "/workspace/project",
        kind: "project",
        sandboxMode: "workspace_write",
      },
    });
    expect(statusEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          state: "workspace",
          workspaceId: "workspace_project",
          workspaceSummary: expect.objectContaining({
            rootPath: "/workspace/project",
          }),
        }),
      ]),
    );
    expect(observedLoopOptions).toMatchObject({
      taskId: "chat_chat_session_1_request_1",
      runContext: {
        workspaceId: "workspace_project",
        workspaceRoot: "/workspace/project",
        sessionId: "chat_session_1",
      },
      runtimeTask: {
        name: "Chat task",
        policyLabel: "chat workspace contract",
        permissions: {
          files: {
            read: ["/workspace/project"],
            write: ["/workspace/project"],
          },
          memory: {
            read: true,
            write: false,
          },
        },
      },
    });
    expect(workspaceRunCreates).toEqual([
      expect.objectContaining({
        workspaceRunId: "chat_run_chat_session_1_request_1",
        sessionId: "chat_session_1",
        requestId: "request_1",
        workspaceId: "workspace_project",
        workspaceRoot: "/workspace/project",
      }),
    ]);
    expect(workspaceRunEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "status",
          status: "running",
          message: "工作区：project",
        }),
        expect.objectContaining({
          type: "status",
          message: "Runtime context snapshot recorded.",
          payload: expect.objectContaining({
            runtimeContextSnapshotSummary: expect.objectContaining({
              surface: "chat",
              workspaceId: "workspace_project",
              workspaceRoot: "/workspace/project",
            }),
          }),
        }),
        expect.objectContaining({
          type: "status",
          status: "succeeded",
          message: "任务已完成",
        }),
      ]),
    );
    expect(workspaceRunFinishes).toEqual([
      {
        workspaceRunId: "chat_run_chat_session_1_request_1",
        status: "succeeded",
        summary: "任务已完成",
      },
    ]);
  });

  it("records provider tool_call ids in chat status and workspace run ledger events", async () => {
    const statusEvents: ChatTaskStatusEvent[] = [];
    const workspaceRunEvents: WorkspaceRunEventInput[] = [];
    const workspaceRunFinishes: Array<{
      workspaceRunId: string;
      status: WorkspaceRunTerminalStatus;
      summary?: string;
    }> = [];
    const service = createChatService({
      chatClient: {
        async complete(request) {
          if (request.tools && !request.messages.some((message) => message.role === "tool")) {
            return toolCallResponse("provider_call_ledger", "/workspace/project");
          }

          return chatReply("ledger done");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: createChatSessionStore([]),
      workspaceService: {
        async resolveRunContext() {
          return buildPrimaryRunContext({
            workspaceId: "workspace_project",
            workspaceRoot: "/workspace/project",
          });
        },
      },
      toolExecutor: createToolExecutor(),
      workspaceRunStore: createMemoryWorkspaceRunStore({
        creates: [],
        events: workspaceRunEvents,
        finishes: workspaceRunFinishes,
      }),
      createId: () => "chat_provider_tool_ids",
      now: createSteppedClock("2026-06-21T08:00:00.000Z"),
    });

    await service.sendMessage(
      {
        sessionId: "chat_session_ledger",
        requestId: "request_ledger",
        message: "record tool ids",
        workspaceId: "workspace_project",
      },
      {
        onStatusEvent(event) {
          statusEvents.push(event);
        },
      },
    );

    expect(statusEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          state: "tool_call",
          toolCallId: "provider_call_ledger",
        }),
        expect.objectContaining({
          state: "tool_result",
          toolCallId: "provider_call_ledger",
        }),
      ]),
    );
    expect(workspaceRunEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool_call",
          toolCallId: "provider_call_ledger",
        }),
        expect.objectContaining({
          type: "tool_result",
          toolCallId: "provider_call_ledger",
        }),
      ]),
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
      "run_context_created",
      "model_request",
      "model_response",
      "tool_invocation",
      "tool_invocation",
      "tool_invocation",
      "tool_call",
      "native_tool_invocation",
      "tool_invocation",
      "tool_invocation",
      "native_tool_observation",
      "tool_result",
      "model_request",
      "model_response",
      "final_summary",
    ]);
    expect(
      trajectoryEvents
        .filter((event) => event.type === "tool_invocation")
        .map((event) => event.payload.invocationStatus),
    ).toEqual(["proposed", "visible", "authorized", "running", "completed"]);
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

  it("emits streamed answer, thinking, and tool preview events without duplicating stored replies", async () => {
    const streamEvents: ChatStreamEvent[] = [];
    const chatMessages: AppendChatMessageInput[] = [];
    let streamCalls = 0;
    const chatClient: ChatClient & StreamingChatClient = {
      async complete() {
        throw new Error("non-streaming complete should not be used");
      },
      async *streamComplete() {
        streamCalls += 1;
        if (streamCalls === 1) {
          yield { type: "content_delta", text: "I will inspect. " };
          yield { type: "reasoning_delta", text: "Checking available tools." };
          yield {
            type: "tool_call_delta",
            id: "preview_call_1",
            name: "file_list",
            arguments: '{"path":"/tmp"}',
          };
          yield { type: "done", finishReason: "tool_calls" };
          return;
        }
        yield { type: "content_delta", text: "Final reply." };
        yield { type: "done", finishReason: "stop" };
      },
    };
    const service = createChatService({
      chatClient,
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: createChatSessionStore(chatMessages),
      toolExecutor: createToolExecutor(),
      createId: () => "chat_stream_model",
      now: () => new Date("2026-06-23T08:00:00.000Z"),
    });

    const result = await service.sendMessage(
      {
        requestId: "request_model_stream_1",
        message: "stream model deltas",
      },
      {
        onStreamEvent(event) {
          streamEvents.push(event);
        },
      },
    );

    expect(result).toMatchObject({
      ok: true,
      sessionId: "persisted_session",
      reply: expect.stringContaining("Final reply."),
    });
    expect(streamEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "answer_delta",
          text: "I will inspect. Final reply.",
          sessionId: "persisted_session",
          requestId: "request_model_stream_1",
          createdAt: "2026-06-23T08:00:00.000Z",
          turnId: "turn-request_model_stream_1",
        }),
        expect.objectContaining({
          type: "thinking_delta",
          text: "Checking available tools.",
          sessionId: "persisted_session",
          requestId: "request_model_stream_1",
          createdAt: "2026-06-23T08:00:00.000Z",
          turnId: "turn-request_model_stream_1",
        }),
        expect.objectContaining({
          type: "tool_call_preview",
          toolCallId: "preview_call_1",
          toolName: "file_list",
          sessionId: "persisted_session",
          requestId: "request_model_stream_1",
          createdAt: "2026-06-23T08:00:00.000Z",
          turnId: "turn-request_model_stream_1",
        }),
      ]),
    );
    expect(chatMessages.filter((message) => message.role === "assistant")).toEqual([
      expect.objectContaining({
        role: "assistant",
        content: expect.stringContaining("Final reply."),
        outputParts: expect.arrayContaining([
          expect.objectContaining({ type: "text" }),
          expect.objectContaining({
            type: "tool_call",
            toolCallId: "preview_call_1",
          }),
        ]),
      }),
    ]);
  });

  it("publishes durable retry controls and persists only the accepted stream attempt", async () => {
    vi.useFakeTimers();
    try {
      const streamEvents: ChatStreamEvent[] = [];
      const chatMessages: AppendChatMessageInput[] = [];
      let streamCalls = 0;
      const chatClient: ChatClient & StreamingChatClient = {
        async complete() {
          throw new Error("non-streaming complete should not be used");
        },
        async *streamComplete() {
          streamCalls += 1;
          if (streamCalls === 1) {
            yield { type: "content_delta", text: "rejected partial" };
            throw new Error("SSE stream idle timeout after 30 s");
          }
          yield { type: "content_delta", text: "accepted full" };
          yield { type: "done", finishReason: "stop" };
        },
      };
      const service = createChatService({
        chatClient,
        getModelProfile: createCompleteProfile,
        memoryStore: createMemoryStore(),
        chatSessionStore: createChatSessionStore(chatMessages),
        toolExecutor: createToolExecutor(),
        createId: createSequentialId("chat_retry_stream"),
        now: () => new Date("2026-08-18T08:00:00.000Z"),
      });

      const resultPromise = service.sendMessage(
        {
          requestId: "request_retry_stream",
          message: "retry one interrupted stream",
        },
        { onStreamEvent: (event) => streamEvents.push(event) },
      );
      await vi.advanceTimersByTimeAsync(2_100);
      await expect(resultPromise).resolves.toMatchObject({
        ok: true,
        reply: "accepted full",
      });

      expect(streamEvents
        .filter((event) => event.type === "attempt_control")
        .map((event) => event.type === "attempt_control"
          ? [event.operation, event.attempt, event.supersedesAttempt]
          : null))
        .toEqual([
          ["begin", 1, undefined],
          ["supersede", 2, 1],
          ["begin", 2, undefined],
          ["accepted", 2, undefined],
        ]);
      expect(streamEvents
        .filter((event) => event.type === "answer_delta")
        .map((event) => event.type === "answer_delta"
          ? [event.text, event.attempt]
          : null))
        .toEqual([
          ["rejected partial", 1],
          ["accepted full", 2],
        ]);
      const acceptedIndex = streamEvents.findIndex(
        (event) => event.type === "attempt_control" && event.operation === "accepted",
      );
      const completedIndex = streamEvents.findIndex((event) => event.type === "completed");
      expect(acceptedIndex).toBeGreaterThanOrEqual(0);
      expect(completedIndex).toBeGreaterThan(acceptedIndex);
      expect(chatMessages.filter((message) => message.role === "assistant"))
        .toEqual([
          expect.objectContaining({
            content: "accepted full",
            turnSettlementStatus: "succeeded",
            outputParts: expect.arrayContaining([
              expect.objectContaining({ type: "text", text: "accepted full" }),
            ]),
          }),
        ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("persists final assistant text and lifecycle output parts for tool-using turns", async () => {
    const streamEvents: ChatStreamEvent[] = [];
    const chatMessages: AppendChatMessageInput[] = [];
    const chatSessionStore = createChatSessionStore(chatMessages);
    const service = createChatService({
      chatClient: {
        async complete() {
          return chatReply("unused");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore,
      toolExecutor: createToolExecutor(),
      async runAgentLoop(messages, _profile, options) {
        options.onModelStreamEvent?.(
          { type: "content_delta", text: "Streaming draft." },
          1,
        );
        options.onToolCall?.("file_list", { path: "/tmp" }, { toolCallId: "tool_1" });
        options.onToolResult?.(
          "file_list",
          true,
          {
            ok: true,
            result: { files: ["a.txt", "b.txt"] },
          },
          { toolCallId: "tool_1", resultBytes: 24 },
        );
        return {
          status: "succeeded" as const,
          summary: "Final reply.",
          turns: 1,
          messages,
          toolCallsExecuted: 1,
        };
      },
      createId: () => "chat_tool_parts",
      now: () => new Date("2026-06-23T08:00:00.000Z"),
    });

    const result = await service.sendMessage(
      {
        requestId: "request_tool_parts_1",
        message: "run one tool",
      },
      {
        onStreamEvent(event) {
          streamEvents.push(event);
        },
      },
    );

    expect(result).toMatchObject({
      ok: true,
      reply: "🔧 使用了 1 个工具\n\nFinal reply.",
    });
    const persistedAssistant = (await chatSessionStore.get("persisted_session"))?.messages.at(-1);
    const completedIndex = streamEvents.findIndex(
      (event) => event.type === "completed",
    );
    const finalTextPartIndex = streamEvents.findIndex(
      (event) =>
        event.type === "output_part" &&
        event.part.type === "text" &&
        event.part.text === persistedAssistant?.content,
    );
    expect(persistedAssistant).toMatchObject({
      role: "assistant",
      content: "🔧 使用了 1 个工具\n\nFinal reply.",
      outputParts: expect.arrayContaining([
        expect.objectContaining({
          type: "text",
          text: "🔧 使用了 1 个工具\n\nFinal reply.",
        }),
        expect.objectContaining({
          type: "tool_result",
          toolCallId: "tool_1",
          ok: true,
          resultPreview: { files: ["a.txt", "b.txt"] },
        }),
        expect.objectContaining({
          type: "ledger_event",
        }),
      ]),
    });
    expect(finalTextPartIndex).toBe(-1);
    expect(completedIndex).toBeGreaterThanOrEqual(0);
    expect(streamEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "output_part",
          part: expect.objectContaining({
            type: "tool_result",
            toolCallId: "tool_1",
            ok: true,
          }),
        }),
        expect.objectContaining({
          type: "output_part",
          part: expect.objectContaining({
            type: "ledger_event",
          }),
        }),
      ]),
    );
  });

  it("preserves final assistant reply whitespace across persisted content and terminal stream text", async () => {
    const streamEvents: ChatStreamEvent[] = [];
    const chatMessages: AppendChatMessageInput[] = [];
    const chatSessionStore = createChatSessionStore(chatMessages);
    const exactReply = "  Normalized reply.   \n";
    const service = createChatService({
      chatClient: {
        async complete() {
          return chatReply(exactReply);
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore,
      createId: () => "chat_trimmed_reply",
      now: () => new Date("2026-06-26T08:00:00.000Z"),
    });

    const result = await service.sendMessage(
      {
        requestId: "request_trimmed_reply_1",
        message: "say hi",
      },
      {
        onStreamEvent(event) {
          streamEvents.push(event);
        },
      },
    );

    expect(result).toMatchObject({
      ok: true,
      reply: exactReply,
    });
    const persistedAssistant = (await chatSessionStore.get("persisted_session"))?.messages.at(-1);
    const finalTextPart = streamEvents.findLast(
      (event) => event.type === "output_part" && event.part.type === "text",
    );
    const completedEvent = streamEvents.findLast(
      (event) => event.type === "completed",
    );

    expect(persistedAssistant?.content).toBe(exactReply);
    expect(finalTextPart).toBeUndefined();
    expect(persistedAssistant?.outputParts).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "text", text: exactReply }),
    ]));
    expect(completedEvent).toMatchObject({
      type: "completed",
      message: exactReply,
    });
  });

  it("masks secrets in ledger events and other output parts for tool starts", async () => {
    const streamEvents: ChatStreamEvent[] = [];
    const chatMessages: AppendChatMessageInput[] = [];
    const chatSessionStore = createChatSessionStore(chatMessages);
    const service = createChatService({
      chatClient: {
        async complete() {
          return chatReply("unused");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore,
      toolExecutor: createToolExecutor(),
      async runAgentLoop(messages, _profile, options) {
        options.onModelStreamEvent?.(
          {
            type: "tool_call_delta",
            id: "tool_secret_1",
            name: "shell_exec",
            arguments:
              '{"command":"npm test","apiKey":"secret-value","authorization":"Bearer secret-auth","token":"secret-token","password":"secret-password"}',
          },
          1,
        );
        options.onToolCall?.(
          "shell_exec",
          {
            command: "npm test",
            apiKey: "secret-value",
            authorization: "Bearer secret-auth",
            token: "secret-token",
            password: "secret-password",
          },
          { toolCallId: "tool_secret_1" },
        );
        return {
          status: "succeeded" as const,
          summary: "Done.",
          turns: 1,
          messages,
          toolCallsExecuted: 1,
        };
      },
      createId: () => "chat_masked_ledger",
      now: () => new Date("2026-06-23T08:00:00.000Z"),
    });

    await service.sendMessage(
      {
        requestId: "request_masked_ledger",
        message: "run secret tool",
      },
      {
        onStreamEvent(event) {
          streamEvents.push(event);
        },
      },
    );

    const persistedAssistant = (await chatSessionStore.get("persisted_session"))?.messages.at(-1);
    const serializedOutput = JSON.stringify([
      ...streamEvents
        .filter(
          (event): event is Extract<ChatStreamEvent, { type: "output_part" }> =>
            event.type === "output_part",
        )
        .map((event) => event.part),
      ...(persistedAssistant?.outputParts ?? []),
    ]);

    expect(serializedOutput).not.toContain("secret-value");
    expect(serializedOutput).not.toContain("secret-auth");
    expect(serializedOutput).not.toContain("secret-token");
    expect(serializedOutput).not.toContain("secret-password");
    expect(serializedOutput).toContain('"apiKey":"****"');
    expect(serializedOutput).toContain('"authorization":"****"');
    expect(serializedOutput).toContain('"token":"****"');
    expect(serializedOutput).toContain('"password":"****"');
  });

  it("emits and persists approval request output parts for tool invocations waiting on approval", async () => {
    const streamEvents: ChatStreamEvent[] = [];
    const trajectoryEvents: AgentTrajectoryEvent[] = [];
    const chatSessionStore = createChatSessionStore([]);
    const service = createChatService({
      chatClient: {
        async complete() {
          return chatReply("unused");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore,
      toolExecutor: createToolExecutor(),
      trajectoryStore: createMemoryTrajectoryStore(trajectoryEvents),
      async runAgentLoop(messages, _profile, options) {
        await options.onToolInvocation?.({
          id: "approval_1",
          runId: "run_1",
          toolCallId: "tool_approval_1",
          toolName: "shell_exec",
          source: "native",
          approvalId: "approval_1",
          args: {
            command: "npm test",
            apiKey: "secret-value",
            nested: { password: "secret-password" },
          },
          status: "waiting_approval",
          createdAt: "2026-06-23T08:00:00.000Z",
          updatedAt: "2026-06-23T08:00:00.000Z",
          history: [
            {
              status: "waiting_approval",
              at: "2026-06-23T08:00:00.000Z",
              reason: "requires approval",
            },
          ],
        });
        return {
          status: "succeeded" as const,
          summary: "Approval requested.",
          turns: 1,
          messages,
          toolCallsExecuted: 0,
        };
      },
      createId: () => "chat_approval_parts",
      now: () => new Date("2026-06-23T08:00:00.000Z"),
    });

    await service.sendMessage(
      {
        requestId: "request_approval_parts",
        message: "run approval tool",
      },
      {
        onStreamEvent(event) {
          streamEvents.push(event);
        },
      },
    );

    const approvalStreamPart = streamEvents.find(
      (event): event is Extract<ChatStreamEvent, { type: "output_part" }> =>
        event.type === "output_part" &&
        event.part.type === "approval_request",
    )?.part;
    const persistedAssistant = (await chatSessionStore.get("persisted_session"))?.messages.at(-1);
    const persistedApprovalPart = persistedAssistant?.outputParts?.find(
      (part) => part.type === "approval_request",
    );
    const ledgerStreamPart = streamEvents.find(
      (event): event is Extract<ChatStreamEvent, { type: "output_part" }> =>
        event.type === "output_part" &&
        event.part.type === "ledger_event" &&
        event.part.status === "waiting",
    )?.part;
    const persistedLedgerPart = persistedAssistant?.outputParts?.find(
      (part) => part.type === "ledger_event" && part.status === "waiting",
    );

    expect(approvalStreamPart).toMatchObject({
      type: "approval_request",
      approvalId: "approval_1",
      toolName: "shell_exec",
      riskLevel: "high",
      argsPreview: {
        command: "npm test",
        apiKey: "****",
        nested: { password: "****" },
      },
    });
    expect(persistedApprovalPart).toEqual(approvalStreamPart);
    expect(JSON.stringify([approvalStreamPart, persistedApprovalPart])).not.toContain(
      "secret-value",
    );
    expect(JSON.stringify([approvalStreamPart, persistedApprovalPart])).not.toContain(
      "secret-password",
    );
    expect(ledgerStreamPart).toMatchObject({
      type: "ledger_event",
      status: "waiting",
      title: expect.stringContaining("shell_exec"),
      detail: expect.stringContaining("approval"),
      toolName: "shell_exec",
    });
    expect(persistedLedgerPart).toEqual(ledgerStreamPart);
    expect(trajectoryEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool_invocation",
          payload: expect.objectContaining({
            toolInvocationId: "approval_1",
            invocationStatus: "waiting_approval",
            approvalId: "approval_1",
          }),
        }),
      ]),
    );
  });

  it("redacts chunked tool-call argument previews until they become valid JSON", async () => {
    const streamEvents: ChatStreamEvent[] = [];
    const chatClient: ChatClient & StreamingChatClient = {
      async complete() {
        throw new Error("non-streaming complete should not be used");
      },
      async *streamComplete() {
        yield {
          type: "tool_call_delta",
          id: "chunked_secret_1",
          name: "shell_exec",
          arguments: '{"apiKey":"secret-value","authorization":"Bearer secret-auth"',
        };
        yield {
          type: "tool_call_delta",
          id: "chunked_secret_1",
          name: "shell_exec",
          arguments: ',"token":"secret-token","password":"secret-password"}',
        };
        yield { type: "done", finishReason: "tool_calls" };
      },
    };
    const service = createChatService({
      chatClient,
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: createChatSessionStore([]),
      toolExecutor: createToolExecutor(),
      createId: () => "chat_chunked_secret",
      now: () => new Date("2026-06-23T08:00:00.000Z"),
    });

    await service.sendMessage(
      {
        requestId: "request_chunked_secret",
        message: "stream chunked secret args",
      },
      {
        onStreamEvent(event) {
          streamEvents.push(event);
        },
      },
    );

    const toolCallParts = streamEvents.filter(
      (event): event is Extract<ChatStreamEvent, { type: "output_part" }> =>
        event.type === "output_part" && event.part.type === "tool_call",
    );
    expect(toolCallParts[0]?.part).toMatchObject({
      type: "tool_call",
      toolCallId: "chunked_secret_1",
      argsPreview: "[partial arguments redacted until valid JSON]",
    });
    expect(JSON.stringify(toolCallParts)).not.toContain("secret-value");
    expect(JSON.stringify(toolCallParts)).not.toContain("secret-auth");
    expect(JSON.stringify(toolCallParts)).not.toContain("secret-token");
    expect(JSON.stringify(toolCallParts)).not.toContain("secret-password");
    const previewEvents = streamEvents.filter(
      (event) => event.type === "tool_call_preview",
    );
    expect(previewEvents.length).toBeGreaterThanOrEqual(2);
    expect(previewEvents.every((event) => !("argumentsDelta" in event))).toBe(
      true,
    );
    expect(JSON.stringify(previewEvents)).not.toMatch(
      /secret-value|secret-auth|secret-token|secret-password/,
    );
    expect(toolCallParts.at(-1)?.part).toMatchObject({
      type: "tool_call",
      argsPreview: {
        apiKey: "****",
        authorization: "****",
        token: "****",
        password: "****",
      },
    });
  });

  it("preserves streamed output part order when finalizing assistant text", async () => {
    const chatMessages: AppendChatMessageInput[] = [];
    const chatSessionStore = createChatSessionStore(chatMessages);
    const service = createChatService({
      chatClient: {
        async complete() {
          return chatReply("unused");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore,
      toolExecutor: createToolExecutor(),
      async runAgentLoop(messages, _profile, options) {
        options.onModelStreamEvent?.({ type: "content_delta", text: "Start. " }, 1);
        options.onModelStreamEvent?.(
          {
            type: "tool_call_delta",
            id: "tool_order_1",
            name: "file_list",
            arguments: '{"path":"/tmp"}',
          },
          1,
        );
        options.onToolResult?.(
          "file_list",
          true,
          { ok: true, result: { files: ["a.txt"] } },
          { toolCallId: "tool_order_1" },
        );
        options.onModelStreamEvent?.({ type: "content_delta", text: "Finish." }, 1);
        return {
          status: "succeeded" as const,
          summary: "Final combined reply.",
          turns: 1,
          messages,
          toolCallsExecuted: 1,
        };
      },
      createId: () => "chat_ordered_parts",
      now: () => new Date("2026-06-23T08:00:00.000Z"),
    });

    await service.sendMessage({
      requestId: "request_ordered_parts",
      message: "preserve part order",
    });

    const outputParts =
      (await chatSessionStore.get("persisted_session"))?.messages.at(-1)?.outputParts ?? [];
    expect(outputParts.map((part) => part.type)).toEqual([
      "text",
      "tool_call",
      "tool_result",
      "ledger_event",
    ]);
    expect(outputParts[0]).toMatchObject({
      type: "text",
      text: "🔧 使用了 1 个工具\n\nFinal combined reply.",
    });
  });

  it("extracts typed structured parts from representative tool result payloads", async () => {
    const streamEvents: ChatStreamEvent[] = [];
    const chatMessages: AppendChatMessageInput[] = [];
    const chatSessionStore = createChatSessionStore(chatMessages);
    const service = createChatService({
      chatClient: {
        async complete() {
          return chatReply("unused");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore,
      toolExecutor: createToolExecutor(),
      async runAgentLoop(messages, _profile, options) {
        options.onToolResult?.(
          "shell_exec",
          true,
          {
            ok: true,
            result: {
              command: "npm test",
              cwd: "/workspace/project",
              exitCode: 0,
              stdout: "ok",
              stderr: "",
              elapsedMs: 1234,
            },
          },
          { toolCallId: "tool_cmd_1" },
        );
        options.onToolResult?.(
          "git_diff",
          true,
          {
            ok: true,
            result: {
              patch: "@@ -1 +1 @@\n-old\n+new",
              filePath: "src/app.ts",
              additions: 1,
              deletions: 1,
            },
          },
          { toolCallId: "tool_diff_1" },
        );
        options.onToolResult?.(
          "file_read",
          true,
          {
            ok: true,
            result: {
              path: "/workspace/project/README.md",
              content: "# hi",
            },
          },
          { toolCallId: "tool_read_1" },
        );
        options.onToolResult?.(
          "markdown_report_write",
          true,
          {
            ok: true,
            result: {
              path: "/workspace/project/report.md",
              title: "Task report",
              mediaType: "text/markdown",
              sizeBytes: 512,
              artifactId: "artifact_report_1",
            },
          },
          { toolCallId: "tool_write_1" },
        );
        options.onToolResult?.(
          "citation_record",
          true,
          {
            ok: true,
            result: {
              citations: [
                {
                  id: "c1",
                  label: "[1]",
                  sourceTitle: "Spec",
                  uri: "https://example.com/spec",
                },
              ],
            },
          },
          { toolCallId: "tool_cite_1" },
        );
        return {
          status: "succeeded" as const,
          summary: "Done.",
          turns: 1,
          messages,
          toolCallsExecuted: 5,
        };
      },
      createId: () => "chat_result_extract",
      now: () => new Date("2026-06-23T08:00:00.000Z"),
    });

    await service.sendMessage(
      {
        requestId: "request_result_extract",
        message: "extract result parts",
      },
      { onStreamEvent: (event) => streamEvents.push(event) },
    );

    const outputParts =
      (await chatSessionStore.get("persisted_session"))?.messages.at(-1)?.outputParts ?? [];
    const allSerialized = JSON.stringify([
      ...streamEvents
        .filter(
          (event): event is Extract<ChatStreamEvent, { type: "output_part" }> =>
            event.type === "output_part",
        )
        .map((event) => event.part),
      ...outputParts,
    ]);

    expect(outputParts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "command_output",
          command: "npm test",
          cwd: "/workspace/project",
          exitCode: 0,
          stdout: "ok",
          stderr: "",
          elapsedMs: 1234,
        }),
        expect.objectContaining({
          type: "file_diff",
          filePath: "src/app.ts",
          patch: "@@ -1 +1 @@\n-old\n+new",
          additions: 1,
          deletions: 1,
        }),
        expect.objectContaining({
          type: "file_ref",
          path: "/workspace/project/README.md",
          action: "read",
        }),
        expect.objectContaining({
          type: "file_ref",
          path: "/workspace/project/report.md",
          action: "wrote",
        }),
        expect.objectContaining({
          type: "artifact",
          artifactId: "artifact_report_1",
          title: "Task report",
          path: "/workspace/project/report.md",
          mediaType: "text/markdown",
          sizeBytes: 512,
        }),
        expect.objectContaining({
          type: "citation",
          citationId: "c1",
          label: "[1]",
          sourceTitle: "Spec",
          uri: "https://example.com/spec",
        }),
        expect.objectContaining({
          type: "tool_result",
          toolCallId: "tool_cmd_1",
          ok: true,
        }),
        expect.objectContaining({
          type: "ledger_event",
        }),
      ]),
    );
    expect(allSerialized).toContain("\"command_output\"");
    expect(allSerialized).toContain("\"file_diff\"");
    expect(allSerialized).toContain("\"artifact\"");
    expect(allSerialized).toContain("\"citation\"");
  });

  it("preserves input request field metadata in streamed and persisted output parts", async () => {
    const activityEvents: ChatTaskStatusEvent[] = [];
    const streamEvents: ChatStreamEvent[] = [];
    const chatMessages: AppendChatMessageInput[] = [];
    const service = createChatService({
      chatClient: {
        async complete() {
          return chatReply("unused");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: createChatSessionStore(chatMessages, { activityEvents }),
      workspaceService: {
        async resolveRunContext() {
          return buildPrimaryRunContext({
            workspaceId: "workspace_project",
            workspaceRoot: "/workspace/project",
          });
        },
      },
      discoverSkills: async () => ({
        skills: [
          createSkillRecord({
            name: "publisher",
            manifest: {
              inputs: [
                {
                  name: "format",
                  label: "Format",
                  type: "choice",
                  required: true,
                  description: "Choose the output format.",
                  defaultValue: "pdf",
                  choices: ["markdown", "html"],
                },
              ],
            },
          }),
        ],
        errors: [],
      }),
      createId: createSequentialId("input_request_metadata"),
      now: () => new Date("2026-06-23T08:00:00.000Z"),
    });

    await service.sendMessage(
      {
        sessionId: "session_1",
        requestId: "request_1",
        message: "publish this",
        selectedSkillName: "publisher",
        workspaceId: "workspace_project",
      },
      {
        onStreamEvent(event) {
          streamEvents.push(event);
        },
      },
    );

    const inputRequestPart = streamEvents.find(
      (event): event is Extract<ChatStreamEvent, { type: "output_part" }> =>
        event.type === "output_part" && event.part.type === "input_request",
    )?.part;
    expect(inputRequestPart).toMatchObject({
      type: "input_request",
      fields: [
        {
          name: "format",
          label: "Format",
          type: "choice",
          required: true,
          description: "Choose the output format.",
          defaultValue: "pdf",
          choices: ["markdown", "html"],
        },
      ],
    });
  });

  it("separates secret-safe guided-input projections from manifest authority", async () => {
    const canary = "guided-input-authority-canary";
    const activityEvents: ChatTaskStatusEvent[] = [];
    const streamEvents: ChatStreamEvent[] = [];
    const skill = createSkillRecord({
      name: "credential-publisher",
      manifest: {
        inputs: [{
          name: "api%255fkey",
          label: "Credential",
          type: "choice",
          required: true,
          description: `api_key=${canary}`,
          choices: [canary],
        }],
      },
    });
    const service = createChatService({
      chatClient: {
        async complete() {
          return chatReply("guided input accepted");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: createChatSessionStore([], { activityEvents }),
      discoverSkills: async () => ({ skills: [skill], errors: [] }),
      createId: createSequentialId("guided_secret_safe"),
      now: () => new Date("2026-08-24T00:00:00.000Z"),
    });

    await expect(service.sendMessage(
      {
        sessionId: "session_1",
        requestId: "request_guided_secret_safe",
        message: "publish with guided input",
        selectedSkillName: skill.manifest.name,
      },
      { onStreamEvent: (event) => streamEvents.push(event) },
    )).resolves.toMatchObject({ code: "SKILL_INPUT_REQUIRED" });

    const publicRequest = streamEvents.find(
      (event): event is Extract<ChatStreamEvent, { type: "waiting_for_input" }> =>
        event.type === "waiting_for_input",
    )?.inputRequest;
    expect(publicRequest).toBeTruthy();
    expect(JSON.stringify({ streamEvents, activityEvents })).not.toContain(canary);
    expect(skill.manifest.inputs[0]).toMatchObject({
      description: `api_key=${canary}`,
      choices: [canary],
    });

    await expect(service.respondSkillInput({
      inputRequestId: publicRequest?.id ?? "",
      values: { "api%255fkey": canary },
    })).resolves.toMatchObject({ ok: true, reply: "guided input accepted" });
  });

  it("uses answer deltas as the only live answer channel and persists assembled text", async () => {
    const streamEvents: ChatStreamEvent[] = [];
    const chatSessionStore = createChatSessionStore([]);
    const chatClient: ChatClient & StreamingChatClient = {
      async complete() {
        throw new Error("non-streaming complete should not be used");
      },
      async *streamComplete() {
        yield { type: "content_delta", text: "Hello " };
        yield { type: "content_delta", text: "world" };
        yield { type: "done", finishReason: "stop" };
      },
    };
    const service = createChatService({
      chatClient,
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore,
      toolExecutor: createToolExecutor(),
      createId: () => "chat_output_snapshot",
      now: () => new Date("2026-06-23T08:00:00.000Z"),
    });

    await service.sendMessage(
      {
        requestId: "request_output_snapshot",
        message: "snapshot text deltas",
      },
      {
        onStreamEvent(event) {
          streamEvents.push(event);
        },
      },
    );

    expect(streamEvents.filter((event) => event.type === "answer_delta"))
      .toEqual([
        expect.objectContaining({ text: "Hello world" }),
      ]);
    expect(streamEvents.some(
      (event) => event.type === "output_part" && event.part.type === "text",
    )).toBe(false);
    const persisted = await chatSessionStore.get("persisted_session");
    expect(persisted?.messages.at(-1)?.outputParts).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "text", text: "Hello world" }),
    ]));
  });

  it("redacts credentials split across answer deltas from all Chat surfaces", async () => {
    const canary = "provider-stream-canary";
    const streamEvents: ChatStreamEvent[] = [];
    const memoryWrites: MemoryInput[] = [];
    const chatSessionStore = createChatSessionStore([]);
    const chatClient: ChatClient & StreamingChatClient = {
      async complete() {
        throw new Error("non-streaming complete should not be used");
      },
      async *streamComplete() {
        yield { type: "content_delta", text: "api_" };
        yield { type: "content_delta", text: "key=provider-" };
        yield { type: "content_delta", text: "stream-canary" };
        yield { type: "done", finishReason: "stop" };
      },
    };
    const service = createChatService({
      chatClient,
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore({ memoryWrites }),
      chatSessionStore,
      toolExecutor: createToolExecutor(),
      createId: () => "chat_split_secret",
      now: () => new Date("2026-08-24T00:00:00.000Z"),
    });

    const result = await service.sendMessage(
      {
        requestId: "request_split_secret",
        message: "stream a secret safely",
      },
      {
        onStreamEvent(event) {
          streamEvents.push(event);
        },
      },
    );
    const persisted = await chatSessionStore.get("persisted_session");
    const serialized = JSON.stringify({
      result,
      streamEvents,
      persisted,
      memoryWrites,
    });
    expect(serialized).toContain("[redacted]");
    expect(serialized).not.toContain(canary);
    expect(streamEvents.filter((event) => event.type === "answer_delta"))
      .toEqual([expect.objectContaining({ text: "api_key=[redacted]" })]);
  });

  it("keeps answer and thinking redaction state across tool and status events", async () => {
    const canary = "interleaved-stream-canary";
    const streamEvents: ChatStreamEvent[] = [];
    const chatSessionStore = createChatSessionStore([]);
    let streamCalls = 0;
    const chatClient: ChatClient & StreamingChatClient = {
      async complete() {
        throw new Error("non-streaming complete should not be used");
      },
      async *streamComplete() {
        streamCalls += 1;
        if (streamCalls === 1) {
          yield { type: "content_delta", text: "api_key=" };
          yield { type: "reasoning_delta", text: "client_secret=" };
          yield {
            type: "tool_call_delta",
            id: "tool_between_secret_chunks",
            name: "file_list",
            arguments: '{"path":"."}',
          };
          yield { type: "done", finishReason: "tool_calls" };
          return;
        }
        yield { type: "content_delta", text: canary };
        yield { type: "reasoning_delta", text: canary };
        yield { type: "done", finishReason: "stop" };
      },
    };
    const service = createChatService({
      chatClient,
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore,
      toolExecutor: createToolExecutor(),
      createId: createSequentialId("chat_interleaved_secret"),
      now: () => new Date("2026-08-24T00:00:00.000Z"),
    });

    const result = await service.sendMessage(
      {
        requestId: "request_interleaved_secret",
        message: "stream across a tool boundary",
      },
      { onStreamEvent: (event) => streamEvents.push(event) },
    );
    const persisted = await chatSessionStore.get("persisted_session");
    const serialized = JSON.stringify({ result, streamEvents, persisted });
    expect(serialized).toContain("[redacted]");
    expect(serialized).not.toContain(canary);
    expect(streamEvents.filter((event) => event.type === "answer_delta"))
      .toEqual([expect.objectContaining({ text: "api_key=[redacted]" })]);
    expect(streamEvents.filter((event) => event.type === "thinking_delta"))
      .toEqual([expect.objectContaining({ text: "client_secret=[redacted]" })]);
    const answerIndex = streamEvents.findIndex(
      (event) => event.type === "answer_delta",
    );
    const acceptedIndex = streamEvents.findIndex(
      (event) => event.type === "attempt_control" && event.operation === "accepted",
    );
    expect(answerIndex).toBeGreaterThanOrEqual(0);
    expect(answerIndex).toBeLessThan(acceptedIndex);
  });

  it("redacts credentials from the simple non-agent provider response", async () => {
    const canary = "simple-fallback-canary";
    const memoryWrites: MemoryInput[] = [];
    const chatSessionStore = createChatSessionStore([]);
    const service = createChatService({
      chatClient: {
        async complete() {
          return chatReply(`api_key=${canary}`);
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore({ memoryWrites }),
      chatSessionStore,
      createId: () => "chat_simple_secret",
      now: () => new Date("2026-08-24T00:00:00.000Z"),
    });

    const result = await service.sendMessage({
      requestId: "request_simple_secret",
      message: "return a simple response",
    });
    const persisted = await chatSessionStore.get("persisted_session");
    const serialized = JSON.stringify({ result, persisted, memoryWrites });
    expect(serialized).toContain("[redacted]");
    expect(serialized).not.toContain(canary);
  });

  it("emits sequence-stable output parts and completes with the persisted assistant message id", async () => {
    const streamEvents: ChatStreamEvent[] = [];
    const chatMessages: AppendChatMessageInput[] = [];
    const chatSessionStore = createChatSessionStore(chatMessages);
    let streamCalls = 0;
    const chatClient: ChatClient & StreamingChatClient = {
      async complete() {
        throw new Error("non-streaming complete should not be used");
      },
      async *streamComplete() {
        streamCalls += 1;
        if (streamCalls === 1) {
          yield { type: "content_delta", text: "I will inspect. " };
          yield {
            type: "tool_call_delta",
            id: "preview_call_1",
            name: "shell_exec",
            arguments: '{"command":"npm test","apiKey":"secret"}',
          };
          yield { type: "done", finishReason: "tool_calls" };
          return;
        }

        yield { type: "content_delta", text: "Final reply." };
        yield { type: "done", finishReason: "stop" };
      },
    };
    const service = createChatService({
      chatClient,
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore,
      toolExecutor: createToolExecutor(),
      createId: () => "chat_stream_parts",
      now: () => new Date("2026-06-23T08:00:00.000Z"),
    });

    const result = await service.sendMessage(
      {
        requestId: "request_output_parts_1",
        message: "stream output parts",
      },
      {
        onStreamEvent(event) {
          streamEvents.push(event);
        },
      },
    );

    expect(result).toMatchObject({
      ok: true,
      sessionId: "persisted_session",
      reply: expect.stringContaining("Final reply."),
    });
    expect(streamEvents.map((event) => event.sequence)).toEqual(
      streamEvents.map((_, index) => index + 1),
    );
    expect(new Set(streamEvents.map((event) => event.turnId))).toEqual(
      new Set(["turn-request_output_parts_1"]),
    );
    expect(
      streamEvents.filter(
        (event): event is Extract<ChatStreamEvent, { type: "output_part" }> =>
          event.type === "output_part",
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "output_part",
          part: expect.objectContaining({
            type: "tool_call",
            toolCallId: "preview_call_1",
            toolName: "shell_exec",
            argsPreview: {
              command: "npm test",
              apiKey: "****",
            },
          }),
        }),
      ]),
    );
    expect(streamEvents.some(
      (event) => event.type === "output_part" && event.part.type === "text",
    )).toBe(false);
    const terminalEvents = streamEvents.filter((event) =>
      ["completed", "failed", "canceled"].includes(event.type),
    );
    expect(terminalEvents).toEqual([
      expect.objectContaining({
        type: "completed",
        finalMessageId: "message_2",
        assistantMessageId: "message_2",
      }),
    ]);

    const persistedSession = await chatSessionStore.get("persisted_session");
    expect(persistedSession?.messages.at(-1)).toEqual(
      expect.objectContaining({
        id: "message_2",
        role: "assistant",
        content: expect.stringContaining("Final reply."),
        outputParts: expect.arrayContaining([
          expect.objectContaining({ type: "text" }),
          expect.objectContaining({
            type: "tool_call",
            toolCallId: "preview_call_1",
            toolName: "shell_exec",
            argsPreview: {
              command: "npm test",
              apiKey: "****",
            },
          }),
        ]),
      }),
    );
  });

  it("emits indexed tool previews with a usable fallback id for idless chunks", async () => {
    const streamEvents: ChatStreamEvent[] = [];
    let streamCalls = 0;
    const chatClient: ChatClient & StreamingChatClient = {
      async complete() {
        throw new Error("non-streaming complete should not be used");
      },
      async *streamComplete() {
        streamCalls += 1;
        if (streamCalls > 1) {
          yield { type: "content_delta", text: "Preview complete." };
          yield { type: "done", finishReason: "stop" };
          return;
        }
        yield {
          type: "tool_call_delta",
          index: 1,
          id: "",
          name: "",
          arguments: '"}',
        };
        yield { type: "done", finishReason: "tool_calls" };
      },
    };
    const service = createChatService({
      chatClient,
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: createChatSessionStore([]),
      toolExecutor: createToolExecutor(),
      createId: () => "chat_indexed_preview",
      now: () => new Date("2026-06-23T08:00:00.000Z"),
    });

    await service.sendMessage(
      {
        requestId: "request_indexed_preview",
        message: "preview indexed idless tool chunk",
      },
      {
        onStreamEvent(event) {
          streamEvents.push(event);
        },
      },
    );

    expect(streamEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool_call_preview",
          toolCallId: "index:1",
          index: 1,
          sessionId: "persisted_session",
          requestId: "request_indexed_preview",
          createdAt: "2026-06-23T08:00:00.000Z",
          turnId: "turn-request_indexed_preview",
        }),
      ]),
    );
    const preview = streamEvents.find((event) => event.type === "tool_call_preview");
    expect(preview).toMatchObject({
      toolCallId: "index:1",
      index: 1,
    });
  });

  it("records user and assistant turns into raw history when configured", async () => {
    const rawHistoryEntries: Array<Record<string, unknown>> = [];
    const service = createChatService({
      chatClient: {
        async complete() {
          return chatReply("已完成。");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      historyIndexStore: {
        async append(entry) {
          rawHistoryEntries.push(entry);
        },
      },
      createId: createSequentialId("history_chat"),
      now: createSteppedClock("2026-06-25T00:00:00.000Z"),
    });

    const result = await service.sendMessage({
      sessionId: "session_history",
      requestId: "request_history",
      message: "记录 raw history",
    });

    expect(result).toMatchObject({ ok: true });
    expect(rawHistoryEntries).toEqual([
      expect.objectContaining({
        id: "history_chat_1",
        sessionId: "session_history",
        role: "user",
        content: "记录 raw history",
        source: "chat",
      }),
      expect.objectContaining({
        id: "history_chat_2",
        sessionId: "session_history",
        role: "assistant",
        content: "已完成。",
        source: "chat",
      }),
    ]);
  });

  it("redacts structured and prefixed tool credentials before raw-history writes", async () => {
    const rawHistoryEntries: Array<Record<string, unknown>> = [];
    const service = createChatService({
      chatClient: {
        async complete() {
          return chatReply("unused");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      historyIndexStore: {
        async append(entry) {
          rawHistoryEntries.push(entry);
        },
      },
      toolExecutor: createToolExecutor(),
      async runAgentLoop(messages, _profile, options) {
        options.onToolCall?.(
          "shell_exec",
          {
            command:
              "curl https://user:password@example.test/run?api_key=query-secret",
            nested: { authorization: "Bearer nested-secret" },
          },
          { toolCallId: "secret_call" },
        );
        options.onToolResult?.(
          "shell_exec",
          false,
          {
            ok: false,
            error:
              "Set-Cookie: session=cookie-secret; Path=/ Authorization: Bearer result-secret",
          },
          { toolCallId: "secret_call" },
        );
        return {
          status: "succeeded",
          summary: "done",
          turns: 1,
          messages,
          toolCallsExecuted: 1,
        };
      },
      createId: createSequentialId("history_secret"),
      now: createSteppedClock("2026-08-16T00:00:00.000Z"),
    });

    await service.sendMessage({
      sessionId: "session_history_secret",
      requestId: "request_history_secret",
      message: "run",
    });
    await flushAsyncTasks();

    const serialized = JSON.stringify(rawHistoryEntries);
    expect(serialized).toContain("[redacted]");
    expect(serialized).not.toMatch(
      /password@example|query-secret|nested-secret|cookie-secret|result-secret/,
    );
  });

  it("redacts raw tool failures across conversation evidence, status, and output parts", async () => {
    const trajectoryEvents: AgentTrajectoryEvent[] = [];
    const statusEvents: ChatTaskStatusEvent[] = [];
    const chatSessionStore = createChatSessionStore([]);
    const service = createChatService({
      chatClient: {
        async complete() {
          return chatReply("unused");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore,
      trajectoryStore: createMemoryTrajectoryStore(trajectoryEvents),
      toolExecutor: createToolExecutor(),
      async runAgentLoop(messages, _profile, options) {
        options.onToolCall?.(
          "shell_exec",
          {
            command:
              "curl --api-key chat-cli-flag-canary "
              + "https://example.test?api%5Fkey=chat-args-canary",
            apiKey: "chat-key-canary",
          },
          { toolCallId: "chat_secret_call" },
        );
        await options.onToolInvocation?.({
          id: "chat_secret_invocation",
          runId: "chat_secret_run",
          toolCallId: "chat_secret_call",
          toolName: "shell_exec",
          source: "built-in",
          args: {
            command: "Authorization: Bearer chat-invocation-canary",
          },
          status: "error",
          createdAt: "2026-08-24T00:00:00.000Z",
          updatedAt: "2026-08-24T00:00:01.000Z",
          error:
            'tool failed: payload={"client\\u005fsecret":"chat-prefixed-json-canary"}; X-Api-Key: "chat-quoted-value-canary"',
          history: [{
            status: "error",
            at: "2026-08-24T00:00:01.000Z",
            error: "password=chat-history-canary",
          }],
        });
        options.onToolResult?.(
          "shell_exec",
          false,
          {
            ok: false,
            error: "Authorization: Bearer chat-result-canary",
            errorDetails: {
              kind: "timeout",
              timeoutMs: "api_key=chat-detail-canary",
            } as never,
          },
          { toolCallId: "chat_secret_call" },
        );
        return {
          status: "succeeded" as const,
          summary: "Secret-safe completion.",
          turns: 1,
          messages,
          toolCallsExecuted: 1,
        };
      },
      createId: createSequentialId("chat_secret_boundary"),
      now: createSteppedClock("2026-08-24T00:00:00.000Z"),
    });

    await service.sendMessage(
      {
        sessionId: "session_secret_boundary",
        requestId: "request_secret_boundary",
        message: "run",
      },
      {
        onStatusEvent(event) {
          statusEvents.push(event);
        },
      },
    );
    await flushAsyncTasks();

    const persistedSession = await chatSessionStore.get("session_secret_boundary");
    const serialized = JSON.stringify({
      trajectoryEvents,
      statusEvents,
      persistedSession,
    });
    expect(serialized).toContain("[redacted]");
    expect(serialized).not.toMatch(
      /chat-args-canary|chat-cli-flag-canary|chat-key-canary|chat-invocation-canary|chat-prefixed-json-canary|chat-quoted-value-canary|chat-history-canary|chat-result-canary|chat-detail-canary/,
    );
  });

  it("loads and enforces an explicitly selected agent skill in chat", async () => {
    const capturedMessages: ChatMessage[][] = [];
    const statusEvents: ChatTaskStatusEvent[] = [];
    const trajectoryEvents: AgentTrajectoryEvent[] = [];
    const service = createChatService({
      chatClient: {
        async complete(request) {
          capturedMessages.push(request.messages);
          return chatReply("OnePage 已按技能流程生成。");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      toolExecutor: createToolExecutor(),
      discoverSkills: async () => ({
        skills: [createSkillRecord({ name: "onepager", body: "Onepager 技能流程：必须先做内容架构分析。" })],
        errors: [],
      }),
      trajectoryStore: createMemoryTrajectoryStore(trajectoryEvents),
      createId: createSequentialId("skill_chat"),
      now: createSteppedClock("2026-06-20T10:00:00.000Z"),
    });

    const result = await service.sendMessage(
      {
        message: "给这个项目生成一张 OnePage",
        selectedSkillName: "onepager",
      },
      { onStatusEvent: (event) => statusEvents.push(event) },
    );

    expect(result).toMatchObject({
      ok: true,
      selectedSkill: {
        name: "onepager",
        displayName: "onepager",
      },
    });
    const selectedSkillPrompt = capturedMessages.at(-1)?.map((message) => message.content).join("\n") ?? "";
    expect(selectedSkillPrompt).toContain("主进程已预加载技能正文");
    expect(selectedSkillPrompt).toContain("Onepager 技能流程：必须先做内容架构分析。");
    expect(selectedSkillPrompt).toContain("必须按技能正文执行");
    expect(selectedSkillPrompt).not.toContain("必须先调用 skill_resource_list");
    expect(statusEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          state: "skill",
          selectedSkillName: "onepager",
          message: "正在调用技能：onepager",
        }),
      ]),
    );
    expect(trajectoryEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "skill_invoked",
          payload: expect.objectContaining({ skillName: "onepager" }),
        }),
      ]),
    );
  });

  it("uses the selected skill maxTurns budget for chat agent runs", async () => {
    let observedMaxTurns: number | undefined;
    const service = createChatService({
      chatClient: {
        async complete() {
          return chatReply("unused");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      toolExecutor: createToolExecutor(),
      discoverSkills: async () => ({
        skills: [
          createSkillRecord({
            name: "onepager",
            manifest: {
              execution: {
                mode: "agent",
                entrypoint: null,
                maxTurns: 9,
              },
            },
          }),
        ],
        errors: [],
      }),
      async runAgentLoop(_messages, _profile, options) {
        observedMaxTurns = options.maxTurns;
        return {
          status: "succeeded",
          summary: "done",
          turns: 1,
          messages: [],
          toolCallsExecuted: 0,
        };
      },
      agentLoopMaxTurns: 2,
      createId: () => "skill_budget",
      now: () => new Date("2026-06-20T10:00:00.000Z"),
    });

    await service.sendMessage({
      message: "给这个项目生成一张 OnePage",
      selectedSkillName: "onepager",
    });

    expect(observedMaxTurns).toBe(9);
  });

  it("detects a natural language skill request before falling back to task routing", async () => {
    const capturedMessages: ChatMessage[][] = [];
    const service = createChatService({
      chatClient: {
        async complete(request) {
          capturedMessages.push(request.messages);
          return chatReply("已按 onepager 技能执行。");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      toolExecutor: createToolExecutor(),
      taskStore: createTaskStore([]),
      discoverSkills: async () => ({
        skills: [createSkillRecord({ name: "onepager", body: "Onepager 技能正文" })],
        errors: [],
      }),
      createId: () => "skill_natural",
      now: () => new Date("2026-06-20T10:00:00.000Z"),
    });

    const result = await service.sendMessage({
      message: "执行 onepager 技能，给这个项目生成一张图",
    });

    expect(result).toMatchObject({
      ok: true,
      selectedSkill: { name: "onepager" },
    });
    const selectedSkillPrompt = capturedMessages.at(-1)?.map((message) => message.content).join("\n") ?? "";
    expect(selectedSkillPrompt).toContain("主进程已预加载技能正文");
    expect(selectedSkillPrompt).toContain("Onepager 技能正文");
  });

  it("extends the active workspace sandbox with the selected skill read root", async () => {
    let observedLoopOptions: unknown = null;
    const service = createChatService({
      chatClient: {
        async complete() {
          return chatReply("unused");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      workspaceService: {
        async resolveRunContext() {
          return buildPrimaryRunContext({
            workspaceId: "workspace_project",
            workspaceRoot: "/workspace/project",
          });
        },
      },
      toolExecutor: createToolExecutor(),
      discoverSkills: async () => ({
        skills: [createSkillRecord({ name: "onepager", body: "Onepager 技能正文" })],
        errors: [],
      }),
      async runAgentLoop(_messages, _profile, options) {
        observedLoopOptions = options;
        return {
          status: "succeeded",
          summary: "done",
          turns: 1,
          messages: [],
          toolCallsExecuted: 0,
        };
      },
      createId: () => "skill_workspace",
      now: () => new Date("2026-06-20T10:00:00.000Z"),
    });

    const result = await service.sendMessage({
      message: "使用 @onepager 技能，给当前项目生成一张图",
      workspaceId: "workspace_project",
    });

    expect(result).toMatchObject({
      ok: true,
      selectedSkill: { name: "onepager" },
    });
    expect(observedLoopOptions).toMatchObject({
      runContext: {
        workspaceRoot: "/workspace/project",
        sandbox: {
          extraReadRoots: expect.arrayContaining(["/tmp/skills/onepager"]),
        },
      },
      runtimeTask: {
        permissions: {
          files: {
            read: expect.arrayContaining([
              "/workspace/project",
              "/tmp/skills/onepager",
            ]),
          },
          tools: {
            allowedNames: expect.arrayContaining([
              "skill_load",
              "skill_resource_list",
            ]),
          },
        },
      },
    });

    const loopOptions = observedLoopOptions as {
      runContext: Parameters<typeof authorizeToolCallWithinRunContext>[2];
      runtimeTask: {
        permissions: Parameters<typeof authorizeToolCallWithinRunContext>[0];
      };
    };
    expect(
      authorizeToolCallWithinRunContext(
        loopOptions.runtimeTask.permissions,
        {
          toolName: "file_list",
          args: { path: "/tmp/skills/onepager" },
        },
        loopOptions.runContext,
      ),
    ).toMatchObject({
      allowed: true,
    });
    expect(
      authorizeToolCallWithinRunContext(
        loopOptions.runtimeTask.permissions,
        {
          toolName: "skill_load",
          args: {
            skillName: "onepager",
            skillSnapshotSha256:
              loopOptions.runtimeTask.permissions.tools
                ?.allowedSkillSnapshotSha256ByName?.onepager,
          },
        },
        loopOptions.runContext,
      ),
    ).toMatchObject({
      allowed: true,
    });
  });

  it("pauses selected skills with missing guided input before model, memory, or tools run", async () => {
    let profileCalls = 0;
    let completeCalls = 0;
    let memorySearches = 0;
    let agentLoopCalls = 0;
    const statusEvents: ChatTaskStatusEvent[] = [];
    const streamEvents: ChatStreamEvent[] = [];
    const activityEvents: ChatTaskStatusEvent[] = [];
    const chatMessages: AppendChatMessageInput[] = [];
    const bus = new KernelEventBus();
    const service = createChatService({
      chatClient: {
        async complete() {
          completeCalls += 1;
          return chatReply("unused");
        },
      },
      async getModelProfile() {
        profileCalls += 1;
        return createCompleteProfile();
      },
      memoryStore: {
        async search() {
          memorySearches += 1;
          return [];
        },
        async create(input: MemoryInput) {
          return createMemoryRecord({
            id: "created_memory",
            title: input.title,
            content: input.content,
          });
        },
      },
      chatSessionStore: createChatSessionStore(chatMessages, { activityEvents }),
      productionKernelDriver: createProductionKernelDriver({ bus }),
      workspaceService: {
        async resolveRunContext() {
          return buildPrimaryRunContext({
            workspaceId: "workspace_project",
            workspaceRoot: "/workspace/project",
          });
        },
      },
      toolExecutor: createToolExecutor(),
      async runAgentLoop() {
        agentLoopCalls += 1;
        return {
          status: "succeeded",
          summary: "unused",
          turns: 1,
          messages: [],
          toolCallsExecuted: 0,
        };
      },
      discoverSkills: async () => ({
        skills: [
          createSkillRecord({
            name: "local-file-organizer",
            manifest: {
              inputs: [
                {
                  name: "targetDir",
                  label: "Target directory",
                  type: "path",
                  required: true,
                  description: "Workspace-local folder to organize.",
                },
              ],
            },
          }),
        ],
        errors: [],
      }),
      createId: createSequentialId("guided_missing"),
      now: () => new Date("2026-06-23T08:00:00.000Z"),
    });

    const result = await service.sendMessage(
      {
        sessionId: "session_1",
        requestId: "request_1",
        message: "organize files",
        selectedSkillName: "local-file-organizer",
        workspaceId: "workspace_project",
      },
      {
        onStatusEvent(event) {
          statusEvents.push(event);
        },
        onStreamEvent(event) {
          streamEvents.push(event);
        },
      },
    );

    expect(result).toEqual({
      ok: false,
      code: "SKILL_INPUT_REQUIRED",
      message: "Skill input required.",
    });
    expect(profileCalls).toBe(0);
    expect(completeCalls).toBe(0);
    expect(memorySearches).toBe(0);
    expect(agentLoopCalls).toBe(0);
    expect(chatMessages).toEqual([
      expect.objectContaining({
        role: "user",
        content: "organize files",
      }),
    ]);
    const waitingStatus = statusEvents.find(
      (event) => event.state === "waiting_for_input",
    );
    expect(waitingStatus).toMatchObject({
      sessionId: "session_1",
      selectedSkillName: "local-file-organizer",
      message: "Skill input required.",
      inputRequest: {
        sessionId: "session_1",
        requestId: "request_1",
        skillName: "local-file-organizer",
        fields: [
          {
            name: "targetDir",
            label: "Target directory",
            type: "path",
            required: true,
            description: "Workspace-local folder to organize.",
          },
        ],
      },
    });
    expect(streamEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "output_part",
          part: expect.objectContaining({
            type: "input_request",
            skillName: "local-file-organizer",
          }),
        }),
        expect.objectContaining({
          type: "waiting_for_input",
          sessionId: "session_1",
          requestId: "request_1",
          inputRequest: expect.objectContaining({
            skillName: "local-file-organizer",
          }),
        }),
      ]),
    );
    expect(activityEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          state: "waiting_for_input",
          inputRequest: expect.objectContaining({
            skillName: "local-file-organizer",
          }),
        }),
      ]),
    );
    expect(activityEvents.some((event) => event.state === "failed")).toBe(false);
    expect(bus.history().at(-1)).toMatchObject({
      type: "run_end",
      status: "paused",
    });
  });

  it("does not return a guided skill wait before the pending input event is persisted", async () => {
    const chatMessages: AppendChatMessageInput[] = [];
    const baseStore = createChatSessionStore(chatMessages);
    const persistGate = createDeferred<void>();
    let pendingPersistStarted = false;
    let sendSettled = false;
    const service = createChatService({
      chatClient: {
        async complete() {
          return chatReply("unused");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: {
        ...baseStore,
        async appendActivityEvent(sessionId, event) {
          if (event.pendingSkillInput?.status === "pending") {
            pendingPersistStarted = true;
            await persistGate.promise;
          }
          return baseStore.appendActivityEvent(sessionId, event);
        },
      },
      workspaceService: {
        async resolveRunContext() {
          return buildPrimaryRunContext({
            workspaceId: "workspace_project",
            workspaceRoot: "/workspace/project",
          });
        },
      },
      discoverSkills: async () => ({
        skills: [
          createSkillRecord({
            name: "local-file-organizer",
            manifest: {
              inputs: [
                {
                  name: "targetDir",
                  label: "Target directory",
                  type: "path",
                  required: true,
                },
              ],
            },
          }),
        ],
        errors: [],
      }),
      createId: createSequentialId("durable_wait"),
      now: () => new Date("2026-06-23T08:00:00.000Z"),
    });

    const sendPromise = service
      .sendMessage({
        sessionId: "session_1",
        requestId: "request_1",
        message: "organize files durably",
        selectedSkillName: "local-file-organizer",
        workspaceId: "workspace_project",
      })
      .then((result) => {
        sendSettled = true;
        return result;
      });

    await waitFor(() => pendingPersistStarted);
    await flushAsyncTasks();
    expect(sendSettled).toBe(false);

    persistGate.resolve();
    await expect(sendPromise).resolves.toEqual({
      ok: false,
      code: "SKILL_INPUT_REQUIRED",
      message: "Skill input required.",
    });
    expect(sendSettled).toBe(true);
  });

  it("returns failure and leaves no answerable pending request when durable skill wait persistence fails", async () => {
    const chatMessages: AppendChatMessageInput[] = [];
    const streamEvents: ChatStreamEvent[] = [];
    const baseStore = createChatSessionStore(chatMessages);
    const service = createChatService({
      chatClient: {
        async complete() {
          return chatReply("unused");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: {
        ...baseStore,
        async appendActivityEvent(sessionId, event) {
          if (event.pendingSkillInput?.status === "pending") {
            throw new Error("disk write failed");
          }
          return baseStore.appendActivityEvent(sessionId, event);
        },
      },
      workspaceService: {
        async resolveRunContext() {
          return buildPrimaryRunContext({
            workspaceId: "workspace_project",
            workspaceRoot: "/workspace/project",
          });
        },
      },
      discoverSkills: async () => ({
        skills: [
          createSkillRecord({
            name: "local-file-organizer",
            manifest: {
              inputs: [
                {
                  name: "targetDir",
                  label: "Target directory",
                  type: "path",
                  required: true,
                },
              ],
            },
          }),
        ],
        errors: [],
      }),
      createId: createSequentialId("durable_fail"),
      now: () => new Date("2026-06-23T08:00:00.000Z"),
    });

    await expect(
      service.sendMessage(
        {
          sessionId: "session_1",
          requestId: "request_1",
          message: "organize files but persistence fails",
          selectedSkillName: "local-file-organizer",
          workspaceId: "workspace_project",
        },
        {
          onStreamEvent(event) {
            streamEvents.push(event);
          },
        },
      ),
    ).resolves.toEqual({
      ok: false,
      message: "Failed to persist skill input request.",
    });
    expect(streamEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "output_part",
          part: expect.objectContaining({
            type: "diagnostic",
            severity: "error",
            message: "Failed to persist skill input request.",
          }),
        }),
      ]),
    );
    expect(streamEvents.some((event) => event.type === "waiting_for_input")).toBe(
      false,
    );
    await expect(
      service.respondSkillInput({
        inputRequestId: "skill_input_durable_fail_1",
        values: { targetDir: "/workspace/project/docs" },
      }),
    ).resolves.toEqual({
      ok: false,
      code: "UNKNOWN_SKILL_INPUT",
      message: "Unknown skill input request.",
    });
  });

  it("keeps waiting when a guided skill input response is invalid and does not run the model", async () => {
    let profileCalls = 0;
    let agentLoopCalls = 0;
    const initialStreamEvents: ChatStreamEvent[] = [];
    const responseStreamEvents: ChatStreamEvent[] = [];
    const activityEvents: ChatTaskStatusEvent[] = [];
    const service = createChatService({
      chatClient: {
        async complete() {
          throw new Error("model should not run for invalid input");
        },
      },
      async getModelProfile() {
        profileCalls += 1;
        return createCompleteProfile();
      },
      memoryStore: createMemoryStore(),
      chatSessionStore: createChatSessionStore([], { activityEvents }),
      workspaceService: {
        async resolveRunContext() {
          return buildPrimaryRunContext({
            workspaceId: "workspace_project",
            workspaceRoot: "/workspace/project",
          });
        },
      },
      toolExecutor: createToolExecutor(),
      async runAgentLoop() {
        agentLoopCalls += 1;
        return {
          status: "succeeded",
          summary: "unused",
          turns: 1,
          messages: [],
          toolCallsExecuted: 0,
        };
      },
      discoverSkills: async () => ({
        skills: [
          createSkillRecord({
            name: "local-file-organizer",
            manifest: {
              inputs: [
                {
                  name: "targetDir",
                  label: "Target directory",
                  type: "path",
                  required: true,
                },
              ],
              permissions: {
                ...createSkillPermissions(),
                files: { read: ["{{targetDir}}"], write: ["{{targetDir}}"] },
              },
            },
          }),
        ],
        errors: [],
      }),
      createId: createSequentialId("guided_invalid"),
      now: () => new Date("2026-06-23T08:00:00.000Z"),
    });

    await service.sendMessage(
      {
        sessionId: "session_1",
        requestId: "request_1",
        message: "organize files",
        selectedSkillName: "local-file-organizer",
        workspaceId: "workspace_project",
      },
      { onStreamEvent: (event) => initialStreamEvents.push(event) },
    );
    const inputRequest = initialStreamEvents.find(
      (event): event is Extract<ChatStreamEvent, { type: "waiting_for_input" }> =>
        event.type === "waiting_for_input",
    )?.inputRequest;

    const result = await service.respondSkillInput(
      {
        inputRequestId: inputRequest?.id ?? "",
        values: { targetDir: "/etc" },
      },
      {
        onStreamEvent(event) {
          responseStreamEvents.push(event);
        },
      },
    );

    expect(result).toEqual({
      ok: false,
      code: "SKILL_INPUT_REQUIRED",
      message: "Skill input required.",
    });
    expect(profileCalls).toBe(0);
    expect(agentLoopCalls).toBe(0);
    expect(responseStreamEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "waiting_for_input",
          requestId: "request_1",
          inputRequest: expect.objectContaining({
            fields: [
              expect.objectContaining({
                name: "targetDir",
                type: "path",
              }),
            ],
          }),
        }),
      ]),
    );
    expect(activityEvents.filter((event) => event.state === "waiting_for_input")).toHaveLength(2);
    expect(
      Math.min(...responseStreamEvents.map((event) => event.sequence)),
    ).toBeGreaterThan(
      Math.max(...initialStreamEvents.map((event) => event.sequence)),
    );
  });

  it("emits diagnostic output and a failed terminal event when guided input follow-up wait persistence fails", async () => {
    const initialStreamEvents: ChatStreamEvent[] = [];
    const responseStreamEvents: ChatStreamEvent[] = [];
    const baseStore = createChatSessionStore([]);
    let pendingPersistWrites = 0;
    const service = createChatService({
      chatClient: {
        async complete() {
          return chatReply("unused");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: {
        ...baseStore,
        async appendActivityEvent(sessionId, event) {
          if (event.pendingSkillInput?.status === "pending") {
            pendingPersistWrites += 1;
            if (pendingPersistWrites > 1) {
              throw new Error("follow-up wait write failed");
            }
          }
          return baseStore.appendActivityEvent(sessionId, event);
        },
      },
      discoverSkills: async () => ({
        skills: [
          createSkillRecord({
            name: "local-file-organizer",
            manifest: {
              inputs: [
                {
                  name: "targetDir",
                  label: "Target directory",
                  type: "path",
                  required: true,
                },
                {
                  name: "format",
                  label: "Format",
                  type: "choice",
                  required: true,
                  choices: ["markdown", "html"],
                },
              ],
            },
          }),
        ],
        errors: [],
      }),
      createId: createSequentialId("guided_followup_fail"),
      now: () => new Date("2026-06-23T08:00:00.000Z"),
    });

    await service.sendMessage(
      {
        sessionId: "session_1",
        requestId: "request_1",
        message: "organize files",
        selectedSkillName: "local-file-organizer",
      },
      { onStreamEvent: (event) => initialStreamEvents.push(event) },
    );
    const inputRequest = initialStreamEvents.find(
      (event): event is Extract<ChatStreamEvent, { type: "waiting_for_input" }> =>
        event.type === "waiting_for_input",
    )?.inputRequest;

    const result = await service.respondSkillInput(
      {
        inputRequestId: inputRequest?.id ?? "",
        values: { targetDir: "/workspace/project/docs" },
      },
      {
        onStreamEvent(event) {
          responseStreamEvents.push(event);
        },
      },
    );

    expect(result).toEqual({
      ok: false,
      message: "Failed to persist skill input request.",
    });
    expect(responseStreamEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "output_part",
          part: expect.objectContaining({
            type: "diagnostic",
            severity: "error",
            message: "Failed to persist skill input request.",
          }),
        }),
        expect.objectContaining({
          type: "failed",
          message: "Failed to persist skill input request.",
        }),
      ]),
    );
    expect(responseStreamEvents.some((event) => event.type === "waiting_for_input")).toBe(
      false,
    );
  });

  it("does not return an invalid guided input response before the next pending request is persisted", async () => {
    const initialStreamEvents: ChatStreamEvent[] = [];
    const baseStore = createChatSessionStore([]);
    const secondPendingPersistGate = createDeferred<void>();
    let pendingPersistCount = 0;
    let secondPendingPersistStarted = false;
    let responseSettled = false;
    const service = createChatService({
      chatClient: {
        async complete() {
          return chatReply("unused");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: {
        ...baseStore,
        async appendActivityEvent(sessionId, event) {
          if (event.pendingSkillInput?.status === "pending") {
            pendingPersistCount += 1;
            if (pendingPersistCount === 2) {
              secondPendingPersistStarted = true;
              await secondPendingPersistGate.promise;
            }
          }
          return baseStore.appendActivityEvent(sessionId, event);
        },
      },
      workspaceService: {
        async resolveRunContext() {
          return buildPrimaryRunContext({
            workspaceId: "workspace_project",
            workspaceRoot: "/workspace/project",
          });
        },
      },
      discoverSkills: async () => ({
        skills: [
          createSkillRecord({
            name: "local-file-organizer",
            manifest: {
              inputs: [
                {
                  name: "targetDir",
                  label: "Target directory",
                  type: "path",
                  required: true,
                },
              ],
            },
          }),
        ],
        errors: [],
      }),
      createId: createSequentialId("durable_invalid"),
      now: () => new Date("2026-06-23T08:00:00.000Z"),
    });

    await service.sendMessage(
      {
        sessionId: "session_1",
        requestId: "request_1",
        message: "organize files invalid durably",
        selectedSkillName: "local-file-organizer",
        workspaceId: "workspace_project",
      },
      { onStreamEvent: (event) => initialStreamEvents.push(event) },
    );
    const inputRequest = initialStreamEvents.find(
      (event): event is Extract<ChatStreamEvent, { type: "waiting_for_input" }> =>
        event.type === "waiting_for_input",
    )?.inputRequest;

    const responsePromise = service
      .respondSkillInput({
        inputRequestId: inputRequest?.id ?? "",
        values: { targetDir: "/etc" },
      })
      .then((result) => {
        responseSettled = true;
        return result;
      });

    await waitFor(() => secondPendingPersistStarted);
    await flushAsyncTasks();
    expect(responseSettled).toBe(false);

    secondPendingPersistGate.resolve();
    await expect(responsePromise).resolves.toEqual({
      ok: false,
      code: "SKILL_INPUT_REQUIRED",
      message: "Skill input required.",
    });
  });

  it("retires the original guided input request when retry wait persistence fails", async () => {
    const chatMessages: AppendChatMessageInput[] = [];
    const initialStreamEvents: ChatStreamEvent[] = [];
    const baseStore = createChatSessionStore(chatMessages);
    let pendingPersistCount = 0;
    let agentLoopCalls = 0;
    const service = createChatService({
      chatClient: {
        async complete() {
          return chatReply("unused");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: {
        ...baseStore,
        async appendActivityEvent(sessionId, event) {
          if (event.pendingSkillInput?.status === "pending") {
            pendingPersistCount += 1;
            if (pendingPersistCount === 2) {
              throw new Error("next wait persistence failed");
            }
          }
          return baseStore.appendActivityEvent(sessionId, event);
        },
      },
      workspaceService: {
        async resolveRunContext() {
          return buildPrimaryRunContext({
            workspaceId: "workspace_project",
            workspaceRoot: "/workspace/project",
          });
        },
      },
      toolExecutor: createToolExecutor(),
      async runAgentLoop(messages) {
        agentLoopCalls += 1;
        return {
          status: "succeeded",
          summary: "guided retry done",
          turns: 1,
          messages,
          toolCallsExecuted: 0,
        };
      },
      discoverSkills: async () => ({
        skills: [
          createSkillRecord({
            name: "local-file-organizer",
            manifest: {
              inputs: [
                {
                  name: "targetDir",
                  label: "Target directory",
                  type: "path",
                  required: true,
                },
              ],
            },
          }),
        ],
        errors: [],
      }),
      createId: createSequentialId("invalid_persist_fail"),
      now: () => new Date("2026-06-23T08:00:00.000Z"),
    });

    await service.sendMessage(
      {
        sessionId: "session_1",
        requestId: "request_1",
        message: "organize files retry after failed wait",
        selectedSkillName: "local-file-organizer",
        workspaceId: "workspace_project",
      },
      { onStreamEvent: (event) => initialStreamEvents.push(event) },
    );
    const inputRequest = initialStreamEvents.find(
      (event): event is Extract<ChatStreamEvent, { type: "waiting_for_input" }> =>
        event.type === "waiting_for_input",
    )?.inputRequest;

    await expect(
      service.respondSkillInput({
        inputRequestId: inputRequest?.id ?? "",
        values: { targetDir: "/etc" },
      }),
    ).resolves.toEqual({
      ok: false,
      message: "Failed to persist skill input request.",
    });
    expect(agentLoopCalls).toBe(0);

    await expect(
      service.respondSkillInput({
        inputRequestId: inputRequest?.id ?? "",
        values: { targetDir: "/workspace/project/docs" },
      }),
    ).resolves.toEqual({
      ok: false,
      code: "UNKNOWN_SKILL_INPUT",
      message: "Unknown skill input request.",
    });
    expect(agentLoopCalls).toBe(0);
    expect(chatMessages.filter((message) => message.role === "assistant"))
      .toHaveLength(0);
  });

  it("does not require a separate guided completion marker after a retry", async () => {
    const chatMessages: AppendChatMessageInput[] = [];
    const initialStreamEvents: ChatStreamEvent[] = [];
    const invalidResponseStreamEvents: ChatStreamEvent[] = [];
    const baseStore = createChatSessionStore(chatMessages);
    let completedMarkerWrites = 0;
    let agentLoopCalls = 0;
    const service = createChatService({
      chatClient: {
        async complete() {
          return chatReply("unused");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: {
        ...baseStore,
        async appendActivityEvent(sessionId, event) {
          if (event.pendingSkillInput?.status === "completed") {
            completedMarkerWrites += 1;
          }
          return baseStore.appendActivityEvent(sessionId, event);
        },
      },
      workspaceService: {
        async resolveRunContext() {
          return buildPrimaryRunContext({
            workspaceId: "workspace_project",
            workspaceRoot: "/workspace/project",
          });
        },
      },
      toolExecutor: createToolExecutor(),
      async runAgentLoop(messages) {
        agentLoopCalls += 1;
        return {
          status: "succeeded",
          summary: "guided retry after marker failure",
          turns: 1,
          messages,
          toolCallsExecuted: 0,
        };
      },
      discoverSkills: async () => ({
        skills: [
          createSkillRecord({
            name: "local-file-organizer",
            manifest: {
              inputs: [
                {
                  name: "targetDir",
                  label: "Target directory",
                  type: "path",
                  required: true,
                },
              ],
            },
          }),
        ],
        errors: [],
      }),
      createId: createSequentialId("invalid_completion_fail"),
      now: () => new Date("2026-06-23T08:00:00.000Z"),
    });

    await service.sendMessage(
      {
        sessionId: "session_1",
        requestId: "request_1",
        message: "organize files after invalid completion failure",
        selectedSkillName: "local-file-organizer",
        workspaceId: "workspace_project",
      },
      { onStreamEvent: (event) => initialStreamEvents.push(event) },
    );
    const inputRequest = initialStreamEvents.find(
      (event): event is Extract<ChatStreamEvent, { type: "waiting_for_input" }> =>
        event.type === "waiting_for_input",
    )?.inputRequest;

    await expect(
      service.respondSkillInput(
        {
          inputRequestId: inputRequest?.id ?? "",
          values: { targetDir: "/etc" },
        },
        { onStreamEvent: (event) => invalidResponseStreamEvents.push(event) },
      ),
    ).resolves.toEqual({
      ok: false,
      code: "SKILL_INPUT_REQUIRED",
      message: "Skill input required.",
    });

    const retryInputRequest = invalidResponseStreamEvents.find(
      (event): event is Extract<ChatStreamEvent, { type: "waiting_for_input" }> =>
        event.type === "waiting_for_input",
    )?.inputRequest;
    expect(retryInputRequest?.id).toBe(inputRequest?.id);
    await expect(
      service.respondSkillInput({
        inputRequestId: inputRequest?.id ?? "",
        values: { targetDir: "/workspace/project/docs" },
      }),
    ).resolves.toMatchObject({
      ok: true,
      reply: "guided retry after marker failure",
    });
    expect(agentLoopCalls).toBe(1);
    expect(completedMarkerWrites).toBe(0);
  });

  it("resumes a guided skill input response in the same session without duplicating the user message", async () => {
    const chatMessages: AppendChatMessageInput[] = [];
    const initialStreamEvents: ChatStreamEvent[] = [];
    const responseStreamEvents: ChatStreamEvent[] = [];
    const capturedMessages: ChatMessage[][] = [];
    let observedRuntimeTask: unknown = null;
    const service = createChatService({
      chatClient: {
        async complete() {
          return chatReply("unused");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: createChatSessionStore(chatMessages),
      workspaceService: {
        async resolveRunContext() {
          return buildPrimaryRunContext({
            workspaceId: "workspace_project",
            workspaceRoot: "/workspace/project",
          });
        },
      },
      toolExecutor: createToolExecutor(),
      async runAgentLoop(messages, _profile, options) {
        capturedMessages.push(messages);
        observedRuntimeTask = options.runtimeTask;
        return {
          status: "succeeded",
          summary: "guided skill done",
          turns: 1,
          messages,
          toolCallsExecuted: 0,
        };
      },
      discoverSkills: async () => ({
        skills: [
          createSkillRecord({
            name: "local-file-organizer",
            body: "Organize the target folder and write a concise report.",
            manifest: {
              inputs: [
                {
                  name: "targetDir",
                  label: "Target directory",
                  type: "path",
                  required: true,
                },
                {
                  name: "format",
                  label: "Format",
                  type: "choice",
                  required: true,
                  choices: ["markdown", "html"],
                },
                {
                  name: "includeResearch",
                  label: "Include research",
                  type: "boolean",
                  required: true,
                },
              ],
              permissions: {
                ...createSkillPermissions(),
                files: { read: ["{{targetDir}}"], write: ["{{targetDir}}"] },
              },
            },
          }),
        ],
        errors: [],
      }),
      createId: createSequentialId("guided_complete"),
      now: () => new Date("2026-06-23T08:00:00.000Z"),
    });

    await service.sendMessage(
      {
        sessionId: "session_1",
        requestId: "request_1",
        message: "organize files",
        selectedSkillName: "local-file-organizer",
        workspaceId: "workspace_project",
      },
      { onStreamEvent: (event) => initialStreamEvents.push(event) },
    );
    const inputRequest = initialStreamEvents.find(
      (event): event is Extract<ChatStreamEvent, { type: "waiting_for_input" }> =>
        event.type === "waiting_for_input",
    )?.inputRequest;

    const result = await service.respondSkillInput(
      {
        inputRequestId: inputRequest?.id ?? "",
        values: {
          targetDir: "docs",
          format: "markdown",
          includeResearch: false,
        },
      },
      {
        onStreamEvent(event) {
          responseStreamEvents.push(event);
        },
      },
    );

    expect(result).toMatchObject({
      ok: true,
      sessionId: "session_1",
      reply: "guided skill done",
      selectedSkill: { name: "local-file-organizer" },
    });
    expect(chatMessages.filter((message) => message.role === "user")).toEqual([
      expect.objectContaining({
        role: "user",
        content: "organize files",
      }),
    ]);
    expect(responseStreamEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "status",
          requestId: "request_1",
          status: expect.objectContaining({ state: "started" }),
        }),
      ]),
    );
    const skillPrompt = capturedMessages.at(-1)?.[0]?.content ?? "";
    expect(skillPrompt).toContain("已解析技能输入（JSON）：");
    expect(skillPrompt).toContain('"targetDir": "/workspace/project/docs"');
    expect(skillPrompt).not.toContain('"targetDir": "docs"');
    expect(skillPrompt).toContain('"format": "markdown"');
    expect(skillPrompt).toContain('"includeResearch": false');
    expect(observedRuntimeTask).toMatchObject({
      permissions: {
        files: {
          read: expect.arrayContaining(["/workspace/project/docs"]),
          write: expect.arrayContaining(["/workspace/project/docs"]),
        },
      },
    });
    expect(
      (observedRuntimeTask as { permissions: { files: { read: string[]; write: string[] } } })
        .permissions.files.read,
    ).not.toContain("{{targetDir}}");
  });

  it("does not resume execution when durable guided input claim persistence fails", async () => {
    const chatMessages: AppendChatMessageInput[] = [];
    const initialStreamEvents: ChatStreamEvent[] = [];
    const baseStore = createChatSessionStore(chatMessages);
    let agentLoopCalls = 0;
    const service = createChatService({
      chatClient: {
        async complete() {
          return chatReply("unused");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: {
        ...baseStore,
        async appendActivityEvent(sessionId, event) {
          if (event.pendingSkillInput?.status === "processing") {
            throw new Error("claim write failed");
          }
          return baseStore.appendActivityEvent(sessionId, event);
        },
      },
      workspaceService: {
        async resolveRunContext() {
          return buildPrimaryRunContext({
            workspaceId: "workspace_project",
            workspaceRoot: "/workspace/project",
          });
        },
      },
      toolExecutor: createToolExecutor(),
      async runAgentLoop(messages) {
        agentLoopCalls += 1;
        return {
          status: "succeeded",
          summary: "should not run",
          turns: 1,
          messages,
          toolCallsExecuted: 0,
        };
      },
      discoverSkills: async () => ({
        skills: [
          createSkillRecord({
            name: "local-file-organizer",
            manifest: {
              inputs: [
                {
                  name: "targetDir",
                  label: "Target directory",
                  type: "path",
                  required: true,
                },
              ],
            },
          }),
        ],
        errors: [],
      }),
      createId: createSequentialId("guided_claim_fail"),
      now: () => new Date("2026-06-23T08:00:00.000Z"),
    });

    await service.sendMessage(
      {
        sessionId: "session_1",
        requestId: "request_1",
        message: "organize files claim fail",
        selectedSkillName: "local-file-organizer",
        workspaceId: "workspace_project",
      },
      { onStreamEvent: (event) => initialStreamEvents.push(event) },
    );
    const inputRequest = initialStreamEvents.find(
      (event): event is Extract<ChatStreamEvent, { type: "waiting_for_input" }> =>
        event.type === "waiting_for_input",
    )?.inputRequest;

    await expect(
      service.respondSkillInput({
        inputRequestId: inputRequest?.id ?? "",
        values: { targetDir: "/workspace/project/docs" },
      }),
    ).resolves.toEqual({
      ok: false,
      message: "Failed to persist skill input processing claim.",
    });
    expect(agentLoopCalls).toBe(0);
    expect(chatMessages.filter((message) => message.role === "assistant")).toEqual(
      [],
    );
  });

  it("does not treat missing-session activity writes as durable guided input claims", async () => {
    const chatMessages: AppendChatMessageInput[] = [];
    const initialStreamEvents: ChatStreamEvent[] = [];
    const baseStore = createChatSessionStore(chatMessages);
    let agentLoopCalls = 0;
    const service = createChatService({
      chatClient: {
        async complete() {
          return chatReply("unused");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: {
        ...baseStore,
        async appendActivityEvent(sessionId, event, eventOptions) {
          if (event.pendingSkillInput?.status === "processing") {
            return null;
          }
          return baseStore.appendActivityEvent(sessionId, event, eventOptions);
        },
      },
      workspaceService: {
        async resolveRunContext() {
          return buildPrimaryRunContext({
            workspaceId: "workspace_project",
            workspaceRoot: "/workspace/project",
          });
        },
      },
      toolExecutor: createToolExecutor(),
      async runAgentLoop(messages) {
        agentLoopCalls += 1;
        return {
          status: "succeeded",
          summary: "should not run",
          turns: 1,
          messages,
          toolCallsExecuted: 0,
        };
      },
      discoverSkills: async () => ({
        skills: [
          createSkillRecord({
            name: "local-file-organizer",
            manifest: {
              inputs: [
                {
                  name: "targetDir",
                  label: "Target directory",
                  type: "path",
                  required: true,
                },
              ],
            },
          }),
        ],
        errors: [],
      }),
      createId: createSequentialId("guided_claim_null"),
      now: () => new Date("2026-06-23T08:00:00.000Z"),
    });

    await service.sendMessage(
      {
        sessionId: "session_1",
        requestId: "request_1",
        message: "organize files with missing claim session",
        selectedSkillName: "local-file-organizer",
        workspaceId: "workspace_project",
      },
      { onStreamEvent: (event) => initialStreamEvents.push(event) },
    );
    const inputRequest = initialStreamEvents.find(
      (event): event is Extract<ChatStreamEvent, { type: "waiting_for_input" }> =>
        event.type === "waiting_for_input",
    )?.inputRequest;

    await expect(
      service.respondSkillInput({
        inputRequestId: inputRequest?.id ?? "",
        values: { targetDir: "/workspace/project/docs" },
      }),
    ).resolves.toEqual({
      ok: false,
      message: "Failed to persist skill input processing claim.",
    });
    expect(agentLoopCalls).toBe(0);
    expect(chatMessages.filter((message) => message.role === "assistant")).toEqual(
      [],
    );
  });

  it("rejects concurrent guided input responses while the durable processing claim is in flight", async () => {
    const chatMessages: AppendChatMessageInput[] = [];
    const initialStreamEvents: ChatStreamEvent[] = [];
    const baseStore = createChatSessionStore(chatMessages);
    const claimGate = createDeferred<void>();
    let claimPersistStarted = false;
    let claimPersistCount = 0;
    let agentLoopCalls = 0;
    const service = createChatService({
      chatClient: {
        async complete() {
          return chatReply("unused");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: {
        ...baseStore,
        async appendActivityEvent(sessionId, event) {
          if (event.pendingSkillInput?.status === "processing") {
            claimPersistStarted = true;
            claimPersistCount += 1;
            await claimGate.promise;
          }
          return baseStore.appendActivityEvent(sessionId, event);
        },
      },
      workspaceService: {
        async resolveRunContext() {
          return buildPrimaryRunContext({
            workspaceId: "workspace_project",
            workspaceRoot: "/workspace/project",
          });
        },
      },
      toolExecutor: createToolExecutor(),
      async runAgentLoop(messages) {
        agentLoopCalls += 1;
        return {
          status: "succeeded",
          summary: "guided skill done once",
          turns: 1,
          messages,
          toolCallsExecuted: 0,
        };
      },
      discoverSkills: async () => ({
        skills: [
          createSkillRecord({
            name: "local-file-organizer",
            manifest: {
              inputs: [
                {
                  name: "targetDir",
                  label: "Target directory",
                  type: "path",
                  required: true,
                },
              ],
            },
          }),
        ],
        errors: [],
      }),
      createId: createSequentialId("guided_concurrent"),
      now: () => new Date("2026-06-23T08:00:00.000Z"),
    });

    await service.sendMessage(
      {
        sessionId: "session_1",
        requestId: "request_1",
        message: "organize files concurrently",
        selectedSkillName: "local-file-organizer",
        workspaceId: "workspace_project",
      },
      { onStreamEvent: (event) => initialStreamEvents.push(event) },
    );
    const inputRequest = initialStreamEvents.find(
      (event): event is Extract<ChatStreamEvent, { type: "waiting_for_input" }> =>
        event.type === "waiting_for_input",
    )?.inputRequest;

    const firstResponse = service.respondSkillInput({
      inputRequestId: inputRequest?.id ?? "",
      values: { targetDir: "/workspace/project/docs" },
    });
    await waitFor(() => claimPersistStarted);
    const secondResponse = service.respondSkillInput({
      inputRequestId: inputRequest?.id ?? "",
      values: { targetDir: "/workspace/project/docs" },
    });
    claimGate.resolve();

    await expect(firstResponse).resolves.toMatchObject({
      ok: true,
      reply: "guided skill done once",
    });
    await expect(secondResponse).resolves.toEqual({
      ok: false,
      message: "Skill input response already in progress.",
    });
    expect(claimPersistCount).toBe(1);
    expect(agentLoopCalls).toBe(1);
    expect(chatMessages.filter((message) => message.role === "assistant")).toHaveLength(
      1,
    );
  });

  it("does not re-execute a processing guided input after service restart", async () => {
    const chatMessages: AppendChatMessageInput[] = [];
    const initialStreamEvents: ChatStreamEvent[] = [];
    const responseStreamEvents: ChatStreamEvent[] = [];
    const capturedMessages: ChatMessage[][] = [];
    let observedRuntimeTask: unknown = null;
    const persistentStore = createChatSessionStore(chatMessages);
    const dependencies = {
      chatClient: {
        async complete() {
          return chatReply("unused");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: persistentStore,
      workspaceService: {
        async resolveRunContext() {
          return buildPrimaryRunContext({
            workspaceId: "workspace_project",
            workspaceRoot: "/workspace/project",
          });
        },
      },
      toolExecutor: createToolExecutor(),
      async runAgentLoop(messages: ChatMessage[], _profile: unknown, options: { runtimeTask?: unknown }) {
        capturedMessages.push(messages);
        observedRuntimeTask = options.runtimeTask;
        return {
          status: "succeeded" as const,
          summary: "recovered guided skill done",
          turns: 1,
          messages,
          toolCallsExecuted: 0,
        };
      },
      discoverSkills: async () => ({
        skills: [
          createSkillRecord({
            name: "local-file-organizer",
            body: "Organize recovered pending input.",
            manifest: {
              inputs: [
                {
                  name: "targetDir",
                  label: "Target directory",
                  type: "path",
                  required: true,
                },
              ],
              permissions: {
                ...createSkillPermissions(),
                files: { read: ["{{targetDir}}"], write: ["{{targetDir}}"] },
              },
            },
          }),
        ],
        errors: [],
      }),
      now: () => new Date("2026-06-23T08:00:00.000Z"),
    };
    const firstService = createChatService({
      ...dependencies,
      createId: createSequentialId("restart_first"),
    });

    await firstService.sendMessage(
      {
        sessionId: "session_1",
        requestId: "request_1",
        message: "organize files after restart",
        selectedSkillName: "local-file-organizer",
        workspaceId: "workspace_project",
      },
      { onStreamEvent: (event) => initialStreamEvents.push(event) },
    );
    const inputRequest = initialStreamEvents.find(
      (event): event is Extract<ChatStreamEvent, { type: "waiting_for_input" }> =>
        event.type === "waiting_for_input",
    )?.inputRequest;
    expect(inputRequest?.id).toBeTruthy();
    const pendingState = (await persistentStore.get("session_1"))
      ?.activity?.statusEvents
      .find((event) => event.pendingSkillInput)
      ?.pendingSkillInput;
    expect(pendingState?.status).toBe("pending");
    await persistentStore.appendActivityEvent("session_1", {
      sessionId: "session_1",
      requestId: "request_1",
      state: "checkpoint_boundary",
      message: "Skill input execution claimed.",
      createdAt: "2026-06-23T08:00:01.000Z",
      elapsedMs: 0,
      pendingSkillInput: {
        ...pendingState!,
        status: "processing",
      },
    });

    const freshService = createChatService({
      ...dependencies,
      createId: createSequentialId("restart_second"),
    });
    const result = await freshService.respondSkillInput(
      {
        inputRequestId: inputRequest?.id ?? "",
        values: { targetDir: "/workspace/project/docs" },
      },
      {
        onStreamEvent(event) {
          responseStreamEvents.push(event);
        },
      },
    );

    expect(result).toEqual({
      ok: false,
      code: "UNKNOWN_SKILL_INPUT",
      message: "Unknown skill input request.",
    });
    expect(chatMessages.filter((message) => message.role === "user")).toEqual([
      expect.objectContaining({
        role: "user",
        content: "organize files after restart",
      }),
    ]);
    expect(responseStreamEvents).toEqual([]);
    expect(capturedMessages).toEqual([]);
    expect(observedRuntimeTask).toBeNull();

    const secondFreshService = createChatService({
      ...dependencies,
      createId: createSequentialId("restart_third"),
    });
    await expect(
      secondFreshService.respondSkillInput({
        inputRequestId: inputRequest?.id ?? "",
        values: { targetDir: "/workspace/project/docs" },
      }),
    ).resolves.toEqual({
      ok: false,
      code: "UNKNOWN_SKILL_INPUT",
      message: "Unknown skill input request.",
    });
    expect(capturedMessages).toHaveLength(0);
  });

  it("recovers only an exact committed guided-input settlement after restart", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "chat-guided-committed-"));
    try {
      const chatStore = createChatSessionStore([]);
      const causalStore = createConversationCausalStore({ configDir });
      let modelCalls = 0;
      const dependencies = {
        chatClient: {
          async complete() {
            modelCalls += 1;
            return chatReply("committed guided input done");
          },
        },
        getModelProfile: createCompleteProfile,
        memoryStore: createMemoryStore(),
        chatSessionStore: chatStore,
        conversationCausalStore: causalStore,
        discoverSkills: async () => ({
          skills: [createSkillRecord({
            name: "committed-guided-skill",
            manifest: {
              inputs: [{
                name: "topic",
                label: "Topic",
                type: "string" as const,
                required: true,
              }],
            },
          })],
          errors: [],
        }),
        now: () => new Date("2026-08-24T00:00:00.000Z"),
      };
      const streamEvents: ChatStreamEvent[] = [];
      const firstService = createChatService({
        ...dependencies,
        createId: createSequentialId("guided_committed_first"),
      });
      await expect(firstService.sendMessage({
        sessionId: "guided_committed_session",
        requestId: "guided_committed_request",
        message: "run committed guided skill",
        selectedSkillName: "committed-guided-skill",
      }, {
        onStreamEvent: (event) => streamEvents.push(event),
      })).resolves.toMatchObject({
        ok: false,
        code: "SKILL_INPUT_REQUIRED",
      });
      const inputRequest = streamEvents.find(
        (event): event is Extract<ChatStreamEvent, { type: "waiting_for_input" }> =>
          event.type === "waiting_for_input",
      )?.inputRequest;
      expect(inputRequest?.id).toBeTruthy();

      const freshService = createChatService({
        ...dependencies,
        createId: createSequentialId("guided_committed_second"),
      });
      await expect(freshService.respondSkillInput({
        inputRequestId: inputRequest!.id,
        values: { topic: "causal ownership" },
      })).resolves.toMatchObject({
        ok: true,
        reply: "committed guided input done",
        sessionId: "guided_committed_session",
        domainStateAvailable: true,
      });
      expect(modelCalls).toBe(1);

      const acceptedBeforeReplay = await causalStore.getRequest(
        "guided_committed_request",
      );
      const acceptedReplayService = createChatService({
        ...dependencies,
        conversationCausalStore: createConversationCausalStore({ configDir }),
        createId: createSequentialId("guided_committed_third"),
      });
      await expect(acceptedReplayService.respondSkillInput({
        inputRequestId: inputRequest!.id,
        values: { topic: "must remain consumed" },
      })).resolves.toEqual({
        ok: false,
        code: "UNKNOWN_SKILL_INPUT",
        message: "Unknown skill input request.",
      });
      expect(modelCalls).toBe(1);
      const acceptedRecord = await causalStore.getRequest(
        "guided_committed_request",
      );
      expect(acceptedRecord?.attempts.at(-1)).toMatchObject({
        state: "accepted",
        assistantAcceptance: { state: "committed" },
      });
      expect(acceptedRecord?.coverage).toEqual(
        acceptedBeforeReplay?.coverage,
      );
      expect(
        (await chatStore.get("guided_committed_session"))
          ?.activity?.statusEvents.some(
            (event) => event.settlementId?.endsWith(":recovery-tombstone"),
          ),
      ).toBe(false);
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("does not recover a legacy committed guided-input row without exact event fingerprints", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "chat-guided-legacy-commit-"));
    try {
      const sessionId = "guided_legacy_commit_session";
      const requestId = "guided_legacy_commit_request";
      const inputRequestId = "guided_legacy_commit_input";
      const settlementId = "guided_legacy_commit_settlement";
      const chatStore = createChatSessionStore([]);
      const user = await chatStore.appendMessage({
        sessionId,
        requestId,
        turnId: `turn-${requestId}`,
        causalAttempt: 1,
        causalAttemptId: createConversationCausalAttemptId({
          requestId,
          turnId: `turn-${requestId}`,
          attempt: 1,
        }),
        role: "user",
        content: "run legacy committed guided input",
      });
      const inputRequest = {
        id: inputRequestId,
        executionId: "guided_legacy_commit_execution",
        sessionId,
        requestId,
        skillName: "guided-legacy-commit-skill",
        reason: "Need one value.",
        fields: [{
          name: "topic",
          label: "Topic",
          type: "string" as const,
          required: true,
        }],
        createdAt: "2026-08-24T00:00:00.000Z",
      };
      const pendingEvent: ChatTaskStatusEvent = {
        sessionId,
        settlementId,
        domainStateAvailable: true,
        requestId,
        turnId: `turn-${requestId}`,
        sequence: 1,
        state: "waiting_for_input",
        message: "Need one value.",
        createdAt: "2026-08-24T00:00:00.000Z",
        elapsedMs: 0,
        selectedSkillName: inputRequest.skillName,
        inputRequest,
        pendingSkillInput: {
          inputRequestId,
          status: "pending",
          settlementId,
          inputRequest,
          sessionId,
          requestId,
          userMessage: "run legacy committed guided input",
          userMessageId: user.message.id,
          selectedSkillName: inputRequest.skillName,
          partialValues: {},
        },
      };
      await chatStore.appendActivityEvent(sessionId, pendingEvent);

      const causalStore = createConversationCausalStore({ configDir });
      await causalStore.claimRequest({
        requestId,
        turnId: `turn-${requestId}`,
        inputFingerprint: "legacy-commit-fixture",
      });
      await causalStore.bindRequest({
        requestId,
        sessionId,
        userMessageId: user.message.id,
      });
      await causalStore.beginAttempt({ requestId, attempt: 1 });
      await causalStore.addRefs({
        requestId,
        refs: [{ kind: "guided_input", id: inputRequestId }],
      });
      const eventFingerprint = createRequiredChatEventFingerprint(pendingEvent);
      await causalStore.beginRequiredSettlement({
        requestId,
        id: settlementId,
        attempt: 1,
        sourceSequence: 1,
        targetState: "waiting_for_input",
        guidedInputRequestId: inputRequestId,
        requiredDomains: ["chat"],
        preparedChatEventFingerprint: eventFingerprint,
      });
      await causalStore.settleRequiredSettlement({
        requestId,
        id: settlementId,
        state: "committed",
        chatEventFingerprint: eventFingerprint,
      });

      const statePath = path.join(configDir, "conversation-causal", "state.json");
      const state = JSON.parse(await readFile(statePath, "utf8")) as {
        records: Array<{
          requiredSettlements?: Array<Record<string, unknown>>;
        }>;
      };
      const legacySettlement = state.records[0]?.requiredSettlements?.[0];
      delete legacySettlement?.preparedChatEventFingerprint;
      delete legacySettlement?.chatEventFingerprint;
      await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

      let modelCalls = 0;
      const freshService = createChatService({
        chatClient: {
          async complete() {
            modelCalls += 1;
            return chatReply("must not execute");
          },
        },
        getModelProfile: createCompleteProfile,
        memoryStore: createMemoryStore(),
        chatSessionStore: chatStore,
        conversationCausalStore: createConversationCausalStore({ configDir }),
        discoverSkills: async () => ({
          skills: [createSkillRecord({ name: inputRequest.skillName })],
          errors: [],
        }),
      });

      await expect(freshService.respondSkillInput({
        inputRequestId,
        values: { topic: "must not run" },
      })).resolves.toEqual({
        ok: false,
        code: "UNKNOWN_SKILL_INPUT",
        message: "Unknown skill input request.",
      });
      expect(modelCalls).toBe(0);
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("persists a failed guided-input tombstone and never replays after a partial cross-domain write", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "chat-guided-partial-"));
    try {
      const activityEvents: ChatTaskStatusEvent[] = [];
      const chatStore = createChatSessionStore([], { activityEvents });
      const causalStore = createConversationCausalStore({ configDir });
      const baseWorkspaceStore = createMemoryWorkspaceRunStore({
        creates: [],
        events: [],
        finishes: [],
      });
      let waitingWorkspaceWrites = 0;
      let workspaceSettlementCalls = 0;
      const workspaceStore = {
        ...baseWorkspaceStore,
        async settleLifecycle(
          input: Parameters<WorkspaceRunStore["settleLifecycle"]>[0],
        ) {
          workspaceSettlementCalls += 1;
          if (input.event.payload?.chatState === "waiting_for_input") {
            waitingWorkspaceWrites += 1;
            if (waitingWorkspaceWrites === 2) {
              throw new Error("workspace waiting settlement failed");
            }
          }
          return baseWorkspaceStore.settleLifecycle(input);
        },
      };
      let agentLoopCalls = 0;
      const dependencies = {
        chatClient: { async complete() { return chatReply("unused"); } },
        getModelProfile: createCompleteProfile,
        memoryStore: createMemoryStore(),
        chatSessionStore: chatStore,
        conversationCausalStore: causalStore,
        workspaceService: {
          async resolveRunContext() {
            return buildPrimaryRunContext({
              workspaceId: "workspace_guided_partial",
              workspaceRoot: "/workspace/guided-partial",
            });
          },
        },
        workspaceRunStore: workspaceStore,
        toolExecutor: createToolExecutor(),
        async runAgentLoop(messages: ChatMessage[]) {
          agentLoopCalls += 1;
          return {
            status: "succeeded" as const,
            summary: "must never run",
            turns: 1,
            messages,
            toolCallsExecuted: 0,
          };
        },
        discoverSkills: async () => ({
          skills: [createSkillRecord({
            name: "guided-partial-skill",
            manifest: {
              inputs: [{
                name: "targetDir",
                label: "Target directory",
                type: "path" as const,
                required: true,
              }],
            },
          })],
          errors: [],
        }),
        now: () => new Date("2026-08-24T01:00:00.000Z"),
      };
      const streamEvents: ChatStreamEvent[] = [];
      const firstService = createChatService({
        ...dependencies,
        createId: createSequentialId("guided_partial_first"),
      });
      await expect(firstService.sendMessage({
        sessionId: "guided_partial_session",
        requestId: "guided_partial_request",
        message: "run guided partial skill",
        selectedSkillName: "guided-partial-skill",
        workspaceId: "workspace_guided_partial",
      }, {
        onStreamEvent: (event) => streamEvents.push(event),
      })).resolves.toMatchObject({
        ok: false,
        code: "SKILL_INPUT_REQUIRED",
      });
      const inputRequest = streamEvents.find(
        (event): event is Extract<ChatStreamEvent, { type: "waiting_for_input" }> =>
          event.type === "waiting_for_input",
      )?.inputRequest;
      expect(inputRequest?.id).toBeTruthy();

      await expect(firstService.respondSkillInput({
        inputRequestId: inputRequest!.id,
        values: { targetDir: "/outside-workspace" },
      })).resolves.toEqual({
        ok: false,
        message: "Failed to persist skill input request.",
      });
      const causalRecord = await causalStore.getRequest("guided_partial_request");
      const failedSettlement = causalRecord?.requiredSettlements?.find(
        (settlement) =>
          settlement.guidedInputRequestId === inputRequest!.id
          && settlement.state === "failed",
      );
      expect(failedSettlement).toMatchObject({
        attempt: 1,
        requiredDomains: ["chat", "workspace"],
        failureCode: "WORKSPACE_SETTLEMENT_FAILED",
      });
      expect(causalRecord?.attempts.at(-1)).toMatchObject({
        attempt: 1,
        state: "interrupted",
      });
      expect(activityEvents.at(-1)).toMatchObject({
        state: "failed",
        settlementId: `${failedSettlement!.id}:tombstone`,
        pendingSkillInput: {
          inputRequestId: inputRequest!.id,
          status: "failed",
          settlementId: failedSettlement!.id,
        },
      });
      const callsBeforeRestart = workspaceSettlementCalls;

      const freshService = createChatService({
        ...dependencies,
        createId: createSequentialId("guided_partial_second"),
      });
      await expect(freshService.respondSkillInput({
        inputRequestId: inputRequest!.id,
        values: { targetDir: "/workspace/guided-partial/docs" },
      })).resolves.toEqual({
        ok: false,
        code: "UNKNOWN_SKILL_INPUT",
        message: "Unknown skill input request.",
      });
      expect(agentLoopCalls).toBe(0);
      expect(workspaceSettlementCalls).toBe(callsBeforeRestart);
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("turns a preparing guided-input journal into a restart tombstone without execution", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "chat-guided-preparing-"));
    const workspaceGate = createDeferred<void>();
    try {
      const activityEvents: ChatTaskStatusEvent[] = [];
      const chatStore = createChatSessionStore([], { activityEvents });
      const causalStore = createConversationCausalStore({ configDir });
      const baseWorkspaceStore = createMemoryWorkspaceRunStore({
        creates: [],
        events: [],
        finishes: [],
      });
      let waitingWorkspaceStarted = false;
      let workspaceSettlementCalls = 0;
      const workspaceStore = {
        ...baseWorkspaceStore,
        async settleLifecycle(
          input: Parameters<WorkspaceRunStore["settleLifecycle"]>[0],
        ) {
          workspaceSettlementCalls += 1;
          if (
            !waitingWorkspaceStarted
            && input.event.payload?.chatState === "waiting_for_input"
          ) {
            waitingWorkspaceStarted = true;
            await workspaceGate.promise;
          }
          return baseWorkspaceStore.settleLifecycle(input);
        },
      };
      let agentLoopCalls = 0;
      const dependencies = {
        chatClient: { async complete() { return chatReply("unused"); } },
        getModelProfile: createCompleteProfile,
        memoryStore: createMemoryStore(),
        chatSessionStore: chatStore,
        conversationCausalStore: causalStore,
        workspaceService: {
          async resolveRunContext() {
            return buildPrimaryRunContext({
              workspaceId: "workspace_guided_preparing",
              workspaceRoot: "/workspace/guided-preparing",
            });
          },
        },
        workspaceRunStore: workspaceStore,
        toolExecutor: createToolExecutor(),
        async runAgentLoop(messages: ChatMessage[]) {
          agentLoopCalls += 1;
          return {
            status: "succeeded" as const,
            summary: "must never run",
            turns: 1,
            messages,
            toolCallsExecuted: 0,
          };
        },
        discoverSkills: async () => ({
          skills: [createSkillRecord({
            name: "guided-preparing-skill",
            manifest: {
              inputs: [{
                name: "topic",
                label: "Topic",
                type: "string" as const,
                required: true,
              }],
            },
          })],
          errors: [],
        }),
        now: () => new Date("2026-08-24T01:30:00.000Z"),
      };
      const firstService = createChatService({
        ...dependencies,
        createId: createSequentialId("guided_preparing_first"),
      });
      const initialSend = firstService.sendMessage({
        sessionId: "guided_preparing_session",
        requestId: "guided_preparing_request",
        message: "run guided preparing skill",
        selectedSkillName: "guided-preparing-skill",
        workspaceId: "workspace_guided_preparing",
      });
      await waitFor(() =>
        waitingWorkspaceStarted
        && activityEvents.some(
          (event) => event.pendingSkillInput?.status === "pending",
        ),
      );
      const pendingEvent = activityEvents.findLast(
        (event) => event.pendingSkillInput?.status === "pending",
      );
      const inputRequestId = pendingEvent!.pendingSkillInput!.inputRequestId;
      const callsBeforeRecovery = workspaceSettlementCalls;

      const freshService = createChatService({
        ...dependencies,
        createId: createSequentialId("guided_preparing_second"),
      });
      await expect(freshService.respondSkillInput({
        inputRequestId,
        values: { topic: "must not execute" },
      })).resolves.toEqual({
        ok: false,
        code: "UNKNOWN_SKILL_INPUT",
        message: "Unknown skill input request.",
      });
      expect(agentLoopCalls).toBe(0);
      expect(workspaceSettlementCalls).toBe(callsBeforeRecovery);
      const causalRecord = await causalStore.getRequest(
        "guided_preparing_request",
      );
      const failedSettlement = causalRecord?.requiredSettlements?.find(
        (settlement) => settlement.id === pendingEvent!.settlementId,
      );
      expect(failedSettlement).toMatchObject({
        state: "failed",
        failureCode: "RECOVERY_INCOMPLETE",
        chatEventFingerprint: expect.any(String),
      });
      expect(activityEvents).toContainEqual(expect.objectContaining({
        settlementId: `${failedSettlement!.id}:recovery-tombstone`,
        state: "failed",
        domainStateAvailable: false,
        pendingSkillInput: expect.objectContaining({
          inputRequestId,
          status: "failed",
          settlementId: failedSettlement!.id,
        }),
      }));

      workspaceGate.resolve();
      await expect(initialSend).resolves.toMatchObject({ ok: false });
    } finally {
      workspaceGate.resolve();
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("does not let a legacy request claim resume through guided input", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "chat-legacy-guided-"));
    try {
      const sessionId = "legacy_guided_session";
      const requestId = "legacy_guided_request";
      const message = "organize legacy files";
      const selectedSkillName = "legacy-file-organizer";
      const workspaceId = "legacy_workspace";
      const streamEvents: ChatStreamEvent[] = [];
      const persistentStore = createChatSessionStore([]);
      let modelCalls = 0;
      const skill = createSkillRecord({
        name: selectedSkillName,
        manifest: {
          inputs: [{
            name: "targetDir",
            label: "Target directory",
            type: "path",
            required: true,
          }],
        },
      });
      const dependencies = {
        chatClient: { async complete() { return chatReply("unused"); } },
        getModelProfile: createCompleteProfile,
        memoryStore: createMemoryStore(),
        chatSessionStore: persistentStore,
        workspaceService: {
          async resolveRunContext() {
            return buildPrimaryRunContext({
              workspaceId,
              workspaceRoot: "/workspace/legacy",
            });
          },
        },
        toolExecutor: createToolExecutor(),
        async runAgentLoop(messages: ChatMessage[]) {
          modelCalls += 1;
          return {
            status: "succeeded" as const,
            summary: "must not execute",
            turns: 1,
            messages,
            toolCallsExecuted: 0,
          };
        },
        discoverSkills: async () => ({ skills: [skill], errors: [] }),
        now: () => new Date("2026-08-18T00:00:00.000Z"),
      };
      const firstService = createChatService({
        ...dependencies,
        conversationCausalStore: createConversationCausalStore({ configDir }),
        createId: createSequentialId("legacy_guided_first"),
      });
      await expect(firstService.sendMessage({
        sessionId,
        requestId,
        message,
        selectedSkillName,
        workspaceId,
      }, {
        onStreamEvent(event) { streamEvents.push(event); },
      })).resolves.toMatchObject({
        ok: false,
        code: "SKILL_INPUT_REQUIRED",
      });
      const inputRequest = streamEvents.find(
        (event): event is Extract<ChatStreamEvent, { type: "waiting_for_input" }> =>
          event.type === "waiting_for_input",
      )?.inputRequest;
      expect(inputRequest?.id).toBeTruthy();
      const pending = (await persistentStore.get(sessionId))
        ?.activity?.statusEvents.find((event) => event.pendingSkillInput)
        ?.pendingSkillInput;
      expect(pending).toBeTruthy();

      const statePath = path.join(configDir, "conversation-causal", "state.json");
      const state = JSON.parse(await readFile(statePath, "utf8")) as {
        records: Array<Record<string, unknown>>;
      };
      const record = state.records.find((entry) => entry.requestId === requestId);
      expect(record).toBeTruthy();
      if (!record) throw new Error("Expected causal request record.");
      record.inputFingerprint = createLegacyChatRequestClaimFingerprint({
        input: {
          message,
          selectedSkillName,
          workspaceId,
          ...(pending?.workspaceSummary
            ? { workspaceSummary: pending.workspaceSummary }
            : {}),
        },
        userMessage: message,
        validatedAttachments: [],
      });
      delete record.inputFingerprintVersion;
      await writeFile(statePath, JSON.stringify(state), "utf8");

      const freshService = createChatService({
        ...dependencies,
        conversationCausalStore: createConversationCausalStore({ configDir }),
        createId: createSequentialId("legacy_guided_second"),
      });
      await expect(freshService.respondSkillInput({
        inputRequestId: inputRequest?.id ?? "",
        values: { targetDir: "/workspace/legacy/docs" },
      })).resolves.toMatchObject({
        ok: false,
        code: "CONFLICT",
      });
      expect(modelCalls).toBe(0);
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("fails recovered guided input completion when durable activity persistence is unavailable", async () => {
    const chatMessages: AppendChatMessageInput[] = [];
    const initialStreamEvents: ChatStreamEvent[] = [];
    const persistentStore = createChatSessionStore(chatMessages);
    const storeWithoutActivityPersistence = {
      list: persistentStore.list,
      get: persistentStore.get,
      appendMessage: persistentStore.appendMessage,
      addTokenUsage: persistentStore.addTokenUsage,
      attachGoal: persistentStore.attachGoal,
      clearActiveGoal: persistentStore.clearActiveGoal,
    };
    let agentLoopCalls = 0;
    const dependencies = {
      chatClient: {
        async complete() {
          return chatReply("unused");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      workspaceService: {
        async resolveRunContext() {
          return buildPrimaryRunContext({
            workspaceId: "workspace_project",
            workspaceRoot: "/workspace/project",
          });
        },
      },
      toolExecutor: createToolExecutor(),
      discoverSkills: async () => ({
        skills: [
          createSkillRecord({
            name: "local-file-organizer",
            manifest: {
              inputs: [
                {
                  name: "targetDir",
                  label: "Target directory",
                  type: "path",
                  required: true,
                },
              ],
            },
          }),
        ],
        errors: [],
      }),
      now: () => new Date("2026-06-23T08:00:00.000Z"),
    };
    const firstService = createChatService({
      ...dependencies,
      chatSessionStore: persistentStore,
      createId: createSequentialId("missing_claim_writer_first"),
    });

    await firstService.sendMessage(
      {
        sessionId: "session_1",
        requestId: "request_1",
        message: "organize files after missing claim writer",
        selectedSkillName: "local-file-organizer",
        workspaceId: "workspace_project",
      },
      { onStreamEvent: (event) => initialStreamEvents.push(event) },
    );
    const inputRequest = initialStreamEvents.find(
      (event): event is Extract<ChatStreamEvent, { type: "waiting_for_input" }> =>
        event.type === "waiting_for_input",
    )?.inputRequest;

    const freshService = createChatService({
      ...dependencies,
      chatSessionStore: storeWithoutActivityPersistence,
      async runAgentLoop(messages) {
        agentLoopCalls += 1;
        return {
          status: "succeeded",
          summary: "should not run without durable claim writer",
          turns: 1,
          messages,
          toolCallsExecuted: 0,
        };
      },
      createId: createSequentialId("missing_claim_writer_second"),
    });

    await expect(
      freshService.respondSkillInput({
        inputRequestId: inputRequest?.id ?? "",
        values: { targetDir: "/workspace/project/docs" },
      }),
    ).resolves.toEqual({
      ok: false,
      code: "UNKNOWN_SKILL_INPUT",
      message: "Unknown skill input request.",
    });
    expect(agentLoopCalls).toBe(0);
    expect(chatMessages.filter((message) => message.role === "assistant")).toEqual(
      [],
    );
  });

  it("rejects a guided skill input response after the pending request was completed", async () => {
    const chatMessages: AppendChatMessageInput[] = [];
    const initialStreamEvents: ChatStreamEvent[] = [];
    let agentLoopCalls = 0;
    const persistentStore = createChatSessionStore(chatMessages);
    const service = createChatService({
      chatClient: {
        async complete() {
          return chatReply("unused");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: persistentStore,
      workspaceService: {
        async resolveRunContext() {
          return buildPrimaryRunContext({
            workspaceId: "workspace_project",
            workspaceRoot: "/workspace/project",
          });
        },
      },
      toolExecutor: createToolExecutor(),
      async runAgentLoop(messages) {
        agentLoopCalls += 1;
        return {
          status: "succeeded",
          summary: "guided skill done once",
          turns: 1,
          messages,
          toolCallsExecuted: 0,
        };
      },
      discoverSkills: async () => ({
        skills: [
          createSkillRecord({
            name: "local-file-organizer",
            manifest: {
              inputs: [
                {
                  name: "targetDir",
                  label: "Target directory",
                  type: "path",
                  required: true,
                },
              ],
            },
          }),
        ],
        errors: [],
      }),
      createId: createSequentialId("guided_complete_once"),
      now: () => new Date("2026-06-23T08:00:00.000Z"),
    });

    await service.sendMessage(
      {
        sessionId: "session_1",
        requestId: "request_1",
        message: "organize files once",
        selectedSkillName: "local-file-organizer",
        workspaceId: "workspace_project",
      },
      { onStreamEvent: (event) => initialStreamEvents.push(event) },
    );
    const inputRequest = initialStreamEvents.find(
      (event): event is Extract<ChatStreamEvent, { type: "waiting_for_input" }> =>
        event.type === "waiting_for_input",
    )?.inputRequest;

    await expect(
      service.respondSkillInput({
        inputRequestId: inputRequest?.id ?? "",
        values: { targetDir: "/workspace/project/docs" },
      }),
    ).resolves.toMatchObject({
      ok: true,
      reply: "guided skill done once",
    });
    await expect(
      service.respondSkillInput({
        inputRequestId: inputRequest?.id ?? "",
        values: { targetDir: "/workspace/project/docs" },
      }),
    ).resolves.toEqual({
      ok: false,
      code: "UNKNOWN_SKILL_INPUT",
      message: "Unknown skill input request.",
    });
    expect(agentLoopCalls).toBe(1);
  });

  it("preflights selected guided skills before goal intent routing", async () => {
    let completeCalled = false;
    let memorySearches = 0;
    const goalCreates: unknown[] = [];
    const resumes: string[] = [];
    const streamEvents: ChatStreamEvent[] = [];
    const service = createChatService({
      chatClient: {
        async complete() {
          completeCalled = true;
          return chatReply("unused");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: {
        async search() {
          memorySearches += 1;
          return [];
        },
        async create(input: MemoryInput) {
          return createMemoryRecord({
            id: "created_memory",
            title: input.title,
            content: input.content,
          });
        },
      },
      chatSessionStore: createChatSessionStore([]),
      goalService: createGoalService({ goalCreates, resumes }),
      workspaceService: {
        async resolveRunContext() {
          return buildPrimaryRunContext({
            workspaceId: "workspace_project",
            workspaceRoot: "/workspace/project",
          });
        },
      },
      discoverSkills: async () => ({
        skills: [
          createSkillRecord({
            name: "local-file-organizer",
            manifest: {
              inputs: [
                {
                  name: "targetDir",
                  label: "Target directory",
                  type: "path",
                  required: true,
                },
              ],
            },
          }),
        ],
        errors: [],
      }),
      createId: createSequentialId("guided_goal"),
      now: () => new Date("2026-06-23T08:00:00.000Z"),
    });

    const result = await service.sendMessage(
      {
        sessionId: "session_1",
        requestId: "request_1",
        message: "目标: 整理这个项目",
        selectedSkillName: "local-file-organizer",
        workspaceId: "workspace_project",
      },
      {
        onStreamEvent(event) {
          streamEvents.push(event);
        },
      },
    );

    expect(result).toEqual({
      ok: false,
      code: "SKILL_INPUT_REQUIRED",
      message: "Skill input required.",
    });
    expect(goalCreates).toEqual([]);
    expect(resumes).toEqual([]);
    expect(completeCalled).toBe(false);
    expect(memorySearches).toBe(0);
    expect(streamEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "waiting_for_input",
          inputRequest: expect.objectContaining({
            skillName: "local-file-organizer",
          }),
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

  it("emits structured actor status events from actor tool results", async () => {
    const statusEvents: ChatTaskStatusEvent[] = [];
    const service = createChatService({
      chatClient: {
        async complete(request) {
          if (!request.messages.some((message) => message.role === "tool")) {
            return actorToolCallResponse("actor_call_1", "审查最终 diff");
          }

          return chatReply("子代理审查完成。");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      toolExecutor: createToolExecutor({
        ok: true,
        result: {
          actorId: "actor_1",
          status: "done",
          summary: "ACCEPTED with evidence",
          filesTouched: [],
        },
      }),
      createId: () => "chat_actor_status",
      now: () => new Date("2026-06-30T08:00:00.000Z"),
    });

    await service.sendMessage(
      { message: "派出独立对抗性审查 subagent" },
      { onStatusEvent: (event) => statusEvents.push(event) },
    );

    expect(statusEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sessionId: "chat_actor_status",
          state: "actor_spawned",
          message: "子代理已启动：审查最终 diff",
          payload: expect.objectContaining({
            actorId: "actor_1",
            task: "审查最终 diff",
          }),
        }),
        expect.objectContaining({
          sessionId: "chat_actor_status",
          state: "actor_done",
          message: "子代理已完成：ACCEPTED with evidence",
          payload: expect.objectContaining({
            actorId: "actor_1",
            actorStatus: "done",
            summary: "ACCEPTED with evidence",
          }),
        }),
      ]),
    );
  });

  it("redacts actor task and completion text before status persistence", async () => {
    const statusEvents: ChatTaskStatusEvent[] = [];
    const chatSessionStore = createChatSessionStore([]);
    const service = createChatService({
      chatClient: {
        async complete(request) {
          if (!request.messages.some((message) => message.role === "tool")) {
            return actorToolCallResponse(
              "actor_call_secret_safe",
              "Authorization: Bearer actor-task-canary",
            );
          }
          return chatReply("子代理审查完成。");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore,
      toolExecutor: createToolExecutor({
        ok: true,
        result: {
          actorId: "api_key=actor-id-canary",
          status: "failed token=actor-status-canary",
          summary: "api_key=actor-summary-canary",
          filesTouched: [],
        },
      }),
      createId: () => "chat_actor_secret_safe",
      now: () => new Date("2026-08-24T00:00:00.000Z"),
    });

    await service.sendMessage(
      { message: "派出子代理" },
      { onStatusEvent: (event) => statusEvents.push(event) },
    );

    const persisted = await chatSessionStore.get("persisted_session");
    const serialized = JSON.stringify({ statusEvents, persisted });
    expect(serialized).toContain("[redacted]");
    expect(serialized).not.toMatch(
      /actor-task-canary|actor-id-canary|actor-status-canary|actor-summary-canary/,
    );
  });

  it("emits actor spawned status before the actor tool result when runtime starts the subagent", async () => {
    const statusEvents: ChatTaskStatusEvent[] = [];
    const service = createChatService({
      chatClient: {
        async complete(request) {
          if (!request.messages.some((message) => message.role === "tool")) {
            return actorToolCallResponse("actor_call_live", "审查运行时状态");
          }

          return chatReply("子代理审查完成。");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      toolExecutor: {
        async execute(_request, options) {
          options?.onRuntimeEvent?.({
            type: "actor_spawned",
            actorId: "actor_live",
            task: "审查运行时状态",
            status: "running",
          });
          return {
            ok: true as const,
            result: {
              actorId: "actor_live",
              status: "done",
              summary: "ACCEPTED live",
              filesTouched: [],
            },
          };
        },
        getRegistry() {
          return createToolExecutor().getRegistry();
        },
        hasTool() {
          return true;
        },
      },
      createId: () => "chat_actor_live_status",
      now: () => new Date("2026-06-30T08:00:00.000Z"),
    });

    await service.sendMessage(
      { message: "派出独立对抗性审查 subagent" },
      { onStatusEvent: (event) => statusEvents.push(event) },
    );

    const firstActorSpawnedIndex = statusEvents.findIndex(
      (event) => event.state === "actor_spawned",
    );
    const toolResultIndex = statusEvents.findIndex(
      (event) => event.state === "tool_result" && event.toolName === "actor",
    );
    const actorDoneIndex = statusEvents.findIndex(
      (event) => event.state === "actor_done",
    );

    expect(firstActorSpawnedIndex).toBeGreaterThanOrEqual(0);
    expect(toolResultIndex).toBeGreaterThanOrEqual(0);
    expect(firstActorSpawnedIndex).toBeLessThan(toolResultIndex);
    expect(actorDoneIndex).toBeGreaterThan(toolResultIndex);
    expect(statusEvents.filter((event) => event.state === "actor_spawned")).toHaveLength(1);
  });

  it("cancels an active chat request through the runtime abort signal", async () => {
    const controller = new AbortController();
    const statusEvents: ChatTaskStatusEvent[] = [];
    const streamEvents: ChatStreamEvent[] = [];
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
        onStreamEvent: (event) => streamEvents.push(event),
      },
    );

    expect(observedAbort).toBe(true);
    expect(result).toEqual({
      ok: false,
      code: "CANCELED",
      retryable: true,
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
    expect(streamEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "output_part",
          part: expect.objectContaining({
            type: "diagnostic",
            severity: "warning",
            message: "已中断任务。",
          }),
        }),
      ]),
    );
  });

  it("runs a matching local task directly from a chat command", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "chat-agent-run-ref-"));
    let completeCalled = false;
    const executedTaskIds: string[] = [];
    const causalStore = createConversationCausalStore({ configDir });
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
      chatSessionStore: createChatSessionStore([]),
      conversationCausalStore: causalStore,
      taskStore: createTaskStore([
        createTask({
          id: "task_downloads",
          name: "整理下载文件夹",
        }),
      ]),
      runScheduledTask: async (taskId, runOptions) => {
        const lease = await runOptions?.beforeExecution?.({
          runId: "run_from_chat",
          taskId,
          sessionId: "task_run_session",
        });
        executedTaskIds.push(taskId);
        await lease?.settle("succeeded");
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
      sessionId: "task_run_session",
      requestId: "task_run_request",
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
    await expect(causalStore.getRequest("task_run_request")).resolves.toMatchObject({
      refs: expect.arrayContaining([
        { kind: "agent_run", id: "run_from_chat" },
      ]),
    });
    await rm(configDir, { recursive: true, force: true });
  });

  it.each([
    { status: "paused" as const, resultOk: true, settlement: "paused" as const },
    { status: "failed" as const, resultOk: false, settlement: "failed" as const },
    { status: "canceled" as const, resultOk: false, settlement: "canceled" as const },
  ])("preserves Scheduled AgentRun $status across Chat and causal settlement", async ({
    status,
    resultOk,
    settlement,
  }) => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), `chat-task-${status}-`));
    try {
      const causalStore = createConversationCausalStore({ configDir });
      const chatMessages: AppendChatMessageInput[] = [];
      const statusEvents: ChatTaskStatusEvent[] = [];
      const service = createChatService({
        chatClient: { async complete() { return chatReply("unused"); } },
        getModelProfile: createCompleteProfile,
        memoryStore: createMemoryStore(),
        chatSessionStore: createChatSessionStore(chatMessages),
        conversationCausalStore: causalStore,
        taskStore: createTaskStore([
          createTask({ id: `task_${status}`, name: "整理下载文件夹" }),
        ]),
        async runScheduledTask(taskId, runOptions) {
          const runId = `run_${status}`;
          const lease = await runOptions?.beforeExecution?.({
            runId,
            taskId,
            sessionId: `task_${status}_session`,
            executionRevision: 1,
          });
          await lease?.settle(status, 1);
          return {
            ok: true,
            run: {
              id: runId,
              taskId,
              taskName: "整理下载文件夹",
              skillName: "local-file-organizer",
              status,
              summary: `scheduled ${status}`,
              events: [],
              executionRevision: 1,
              startedAt: "2026-08-24T00:00:00.000Z",
              finishedAt: "2026-08-24T00:00:01.000Z",
            },
          };
        },
      });
      const requestId = `task_${status}_request`;
      const result = await service.sendMessage({
        sessionId: `task_${status}_session`,
        requestId,
        message: "请运行整理下载文件夹任务",
      }, {
        onStatusEvent: (event) => statusEvents.push(event),
      });

      expect(result.ok).toBe(resultOk);
      expect(result).toMatchObject({
        executedRun: { id: `run_${status}`, status },
        turnSettlementStatus: settlement,
      });
      expect(chatMessages.filter((message) => message.role === "assistant")).toEqual([
        expect.objectContaining({
          executedRunId: `run_${status}`,
          turnSettlementStatus: settlement,
        }),
      ]);
      expect(statusEvents).toEqual(expect.arrayContaining([
        expect.objectContaining({
          state: status === "paused" ? "paused" : status,
          domainStateAvailable: true,
        }),
      ]));
      await expect(causalStore.getRequest(requestId)).resolves.toMatchObject({
        agentRunAdmissions: [expect.objectContaining({
          runId: `run_${status}`,
          executionRevision: 1,
          state: "settled",
          finalStatus: status,
        })],
        refs: expect.arrayContaining([{ kind: "agent_run", id: `run_${status}` }]),
        attempts: [expect.objectContaining({
          attempt: 1,
          state: status === "paused" ? "accepted" : "active",
        })],
        requiredSettlements: [expect.objectContaining({
          attempt: 1,
          targetState: status,
          state: "committed",
        })],
      });
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("does not start Scheduled AgentRun work until its causal ref admission settles", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "chat-agent-run-admission-"));
    try {
      const causalStore = createConversationCausalStore({ configDir });
      const admissionGate = createDeferred();
      let admissionStarted = false;
      const gatedCausalStore = {
        ...causalStore,
        async admitAgentRun(
          input: Parameters<typeof causalStore.admitAgentRun>[0],
        ) {
          admissionStarted = true;
          await admissionGate.promise;
          return causalStore.admitAgentRun(input);
        },
      };
      let runCalls = 0;
      const service = createChatService({
        chatClient: { async complete() { return chatReply("unused"); } },
        getModelProfile: createCompleteProfile,
        memoryStore: createMemoryStore(),
        chatSessionStore: createChatSessionStore([]),
        conversationCausalStore: gatedCausalStore,
        taskStore: createTaskStore([
          createTask({ id: "task_admission", name: "整理下载文件夹" }),
        ]),
        async runScheduledTask(taskId, runOptions) {
          const lease = await runOptions?.beforeExecution?.({
            runId: "run_after_admission",
            taskId,
            sessionId: "task_admission_session",
          });
          runCalls += 1;
          await lease?.settle("succeeded");
          return {
            ok: true,
            run: {
              id: "run_after_admission",
              taskId,
              taskName: "整理下载文件夹",
              skillName: "local-file-organizer",
              status: "succeeded",
              summary: "admitted",
              events: [],
              startedAt: "2026-08-24T00:00:00.000Z",
              finishedAt: "2026-08-24T00:00:01.000Z",
            },
          };
        },
      });

      const sending = service.sendMessage({
        sessionId: "task_admission_session",
        requestId: "task_admission_request",
        message: "请运行整理下载文件夹任务",
      });
      await waitFor(() => admissionStarted);
      expect(runCalls).toBe(0);
      admissionGate.resolve();
      await expect(sending).resolves.toMatchObject({
        ok: true,
        executedRun: { id: "run_after_admission" },
      });
      expect(runCalls).toBe(1);
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("records the owning AgentRun before assistant persistence can fail", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "chat-agent-run-crash-"));
    try {
      const causalStore = createConversationCausalStore({ configDir });
      const baseChatStore = createChatSessionStore([]);
      const chatStore = {
        ...baseChatStore,
        async appendMessage(input: AppendChatMessageInput) {
          if (input.role === "assistant") {
            throw new Error("assistant persistence failed");
          }
          return baseChatStore.appendMessage(input);
        },
      };
      let runCalls = 0;
      const service = createChatService({
        chatClient: {
          async complete() {
            return chatReply("must not run");
          },
        },
        getModelProfile: createCompleteProfile,
        memoryStore: createMemoryStore(),
        chatSessionStore: chatStore,
        conversationCausalStore: causalStore,
        taskStore: createTaskStore([
          createTask({
            id: "task_crash_after_run",
            name: "整理下载文件夹",
          }),
        ]),
        async runScheduledTask(taskId, runOptions) {
          const lease = await runOptions?.beforeExecution?.({
            runId: "run_before_assistant_crash",
            taskId,
            sessionId: "task_run_crash_session",
          });
          runCalls += 1;
          await lease?.settle("succeeded");
          return {
            ok: true,
            run: {
              id: "run_before_assistant_crash",
              taskId,
              taskName: "整理下载文件夹",
              skillName: "local-file-organizer",
              status: "succeeded",
              summary: "AgentRun is already durable.",
              events: [],
              startedAt: "2026-06-06T08:00:00.000Z",
              finishedAt: "2026-06-06T08:00:02.000Z",
            },
          };
        },
      });

      const input = {
        sessionId: "task_run_crash_session",
        requestId: "task_run_crash_request",
        message: "请运行整理下载文件夹任务",
      };
      await expect(service.sendMessage(input)).rejects.toThrow(
        "assistant persistence failed",
      );
      await expect(causalStore.getRequest(input.requestId)).resolves.toMatchObject({
        refs: expect.arrayContaining([
          { kind: "agent_run", id: "run_before_assistant_crash" },
        ]),
      });

      await expect(service.sendMessage(input)).resolves.toMatchObject({
        ok: false,
        retryable: true,
      });
      expect(runCalls).toBe(1);
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("fails Chat acceptance when the owning AgentRun causal ref cannot persist", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "chat-agent-run-ref-fail-"));
    try {
      const causalStore = createConversationCausalStore({ configDir });
      const rejectingCausalStore = {
        ...causalStore,
        async admitAgentRun(
          _input: Parameters<typeof causalStore.admitAgentRun>[0],
        ) {
          throw new Error("agent_run ref persistence failed");
        },
      };
      const chatStore = createChatSessionStore([]);
      let runCalls = 0;
      const service = createChatService({
        chatClient: {
          async complete() {
            return chatReply("must not run");
          },
        },
        getModelProfile: createCompleteProfile,
        memoryStore: createMemoryStore(),
        chatSessionStore: chatStore,
        conversationCausalStore: rejectingCausalStore,
        taskStore: createTaskStore([
          createTask({
            id: "task_agent_ref_failure",
            name: "整理下载文件夹",
          }),
        ]),
        async runScheduledTask(taskId, runOptions) {
          await runOptions?.beforeExecution?.({
            runId: "run_without_causal_ref",
            taskId,
            sessionId: "task_run_ref_failure_session",
          });
          runCalls += 1;
          return {
            ok: true,
            run: {
              id: "run_without_causal_ref",
              taskId,
              taskName: "整理下载文件夹",
              skillName: "local-file-organizer",
              status: "succeeded",
              summary: "Run completed before its causal ref failed.",
              events: [],
              startedAt: "2026-06-06T08:00:00.000Z",
              finishedAt: "2026-06-06T08:00:02.000Z",
            },
          };
        },
      });
      const input = {
        sessionId: "task_run_ref_failure_session",
        requestId: "task_run_ref_failure_request",
        message: "请运行整理下载文件夹任务",
      };

      await expect(service.sendMessage(input)).rejects.toThrow(
        "Scheduled AgentRun causal admission failed.",
      );
      await expect(chatStore.get(input.sessionId)).resolves.toMatchObject({
        messages: [expect.objectContaining({ role: "user" })],
      });
      await expect(causalStore.getRequest(input.requestId)).resolves.not.toMatchObject({
        refs: expect.arrayContaining([
          { kind: "agent_run", id: "run_without_causal_ref" },
        ]),
      });
      await expect(service.sendMessage(input)).resolves.toMatchObject({
        ok: false,
        retryable: true,
      });
      expect(runCalls).toBe(0);
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
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
        "已创建任务“整理下载文件夹”，调度：每天 09:00。保存后会按计划自动运行；你可以在“任务”页暂停或调整权限。",
      createdTask: {
        id: "created_task",
        name: "整理下载文件夹",
        skillName: "",
        schedule: { kind: "daily", time: "09:00" },
      },
    });
    expect(createdInputs).toEqual([
      {
        name: "整理下载文件夹",
        skillName: "",
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
        requestId: "request_1780732800000",
        role: "user",
        content: "每天 9 点整理文件",
      },
      expect.objectContaining({
        sessionId: "persisted_session",
        role: "assistant",
        content:
          "我可以创建这个定时任务。你想让我整理哪个文件夹？例如：下载、桌面、文档或项目。",
        outputParts: expect.arrayContaining([
          expect.objectContaining({
            type: "text",
            text:
              "我可以创建这个定时任务。你想让我整理哪个文件夹？例如：下载、桌面、文档或项目。",
          }),
        ]),
      }),
    ]);
  });

  it("persists guided-skill attachment bytes so the input can resume after restart", async () => {
    const capturedMessages: ChatMessage[][] = [];
    const storedMessages: AppendChatMessageInput[] = [];
    const activityEvents: ChatTaskStatusEvent[] = [];
    const streamEvents: ChatStreamEvent[] = [];
    const onePixelPng =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const service = createChatService({
      chatClient: {
        async complete(request) {
          capturedMessages.push(request.messages);
          return chatReply("技能附件已读取");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: createChatSessionStore(storedMessages, {
        activityEvents,
      }),
      discoverSkills: async () => ({
        skills: [
          createSkillRecord({
            name: "image-review",
            manifest: {
              inputs: [
                {
                  name: "focus",
                  label: "关注点",
                  type: "string",
                  required: true,
                },
              ],
            },
          }),
        ],
        errors: [],
      }),
      createId: createSequentialId("guided_attachment"),
      now: () => new Date("2026-07-14T15:30:00.000Z"),
    });

    await expect(
      service.sendMessage(
        {
          sessionId: "session_1",
          requestId: "request_1",
          message: "检查截图",
          selectedSkillName: "image-review",
          attachments: [
            {
              id: "attachment_image",
              name: "screen.png",
              mediaType: "image/png",
              size: 1,
              kind: "image",
              dataBase64: onePixelPng,
            },
          ],
        },
        { onStreamEvent: (event) => streamEvents.push(event) },
      ),
    ).resolves.toEqual({
      ok: false,
      code: "SKILL_INPUT_REQUIRED",
      message: "Skill input required.",
    });

    const inputRequest = streamEvents.find(
      (event): event is Extract<ChatStreamEvent, { type: "waiting_for_input" }> =>
        event.type === "waiting_for_input",
    )?.inputRequest;
    const pendingEvent = activityEvents.find(
      (event) => event.pendingSkillInput?.status === "pending",
    );
    expect(pendingEvent?.pendingSkillInput?.attachments).toEqual([
      expect.objectContaining({ id: "attachment_image", size: 68 }),
    ]);
    expect(pendingEvent?.pendingSkillInput?.attachmentPayloads).toEqual([
      expect.objectContaining({
        id: "attachment_image",
        dataBase64: onePixelPng,
      }),
    ]);

    await expect(
      service.respondSkillInput({
        inputRequestId: inputRequest?.id ?? "",
        values: { focus: "布局" },
      }),
    ).resolves.toMatchObject({ ok: true, reply: "技能附件已读取" });
    expect(capturedMessages[0]?.at(-1)).toMatchObject({
      role: "user",
      images: [{ mediaType: "image/png", data: onePixelPng }],
    });
  });

  it("rehydrates a guided-skill attachment from its durable checkpoint after memory TTL", async () => {
    const storedMessages: AppendChatMessageInput[] = [];
    const streamEvents: ChatStreamEvent[] = [];
    let chatCalls = 0;
    let nowMs = new Date("2026-07-14T15:30:00.000Z").getTime();
    const service = createChatService({
      chatClient: {
        async complete() {
          chatCalls += 1;
          return chatReply("should not run");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: createChatSessionStore(storedMessages),
      discoverSkills: async () => ({
        skills: [
          createSkillRecord({
            name: "image-review",
            manifest: {
              inputs: [
                {
                  name: "focus",
                  label: "关注点",
                  type: "string",
                  required: true,
                },
              ],
            },
          }),
        ],
        errors: [],
      }),
      createId: createSequentialId("expired_attachment"),
      now: () => new Date(nowMs),
    });

    await service.sendMessage(
      {
        sessionId: "session_1",
        requestId: "request_1",
        message: "检查截图",
        selectedSkillName: "image-review",
        attachments: [
          {
            id: "attachment_image",
            name: "screen.png",
            mediaType: "image/png",
            size: 1,
            kind: "image",
            dataBase64:
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          },
        ],
      },
      { onStreamEvent: (event) => streamEvents.push(event) },
    );
    const inputRequest = streamEvents.find(
      (event): event is Extract<ChatStreamEvent, { type: "waiting_for_input" }> =>
        event.type === "waiting_for_input",
    )?.inputRequest;
    nowMs += 61 * 60 * 1000;

    await expect(
      service.respondSkillInput({
        inputRequestId: inputRequest?.id ?? "",
        values: { focus: "布局" },
      }),
    ).resolves.toMatchObject({ ok: true, reply: "should not run" });
    expect(chatCalls).toBe(1);
  });

  it("passes pasted image bytes and fenced text attachments through the model pipeline", async () => {
    const capturedMessages: ChatMessage[][] = [];
    const storedMessages: AppendChatMessageInput[] = [];
    const onePixelPng =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const service = createChatService({
      chatClient: {
        async complete(request) {
          capturedMessages.push(request.messages);
          return chatReply("附件已读取");
        },
      },
      getModelProfile: async () => ({
        baseUrl: "https://api.example.com/v1",
        apiKey: "secret",
        model: "vision-model",
        temperature: 0.2,
        maxTokens: 8192,
      }),
      memoryStore: createMemoryStore(),
      chatSessionStore: createChatSessionStore(storedMessages),
      createId: () => "chat_attachment",
      now: () => new Date("2026-07-14T15:30:00.000Z"),
    });

    const result = await service.sendMessage({
      message: "总结图片和说明",
      attachments: [
        {
          id: "attachment_image",
          name: "screen.png",
          mediaType: "image/png",
          size: 68,
          kind: "image",
          dataBase64: onePixelPng,
        },
        {
          id: "attachment_text",
          name: "notes.md",
          mediaType: "text/markdown",
          size: 5,
          kind: "text",
          dataBase64: Buffer.from("hello").toString("base64"),
        },
      ],
    });

    expect(result).toMatchObject({ ok: true, reply: "附件已读取" });
    expect(capturedMessages[0]?.at(-1)).toMatchObject({
      role: "user",
      content: expect.stringContaining("<attachment_context>"),
      images: [{ mediaType: "image/png", data: onePixelPng }],
    });
    expect(storedMessages[0]).toMatchObject({
      role: "user",
      content: "总结图片和说明",
      attachments: [
        expect.objectContaining({
          id: "attachment_image",
          kind: "image",
          size: 68,
        }),
        expect.objectContaining({
          id: "attachment_text",
          kind: "text",
          size: 5,
        }),
      ],
    });
    expect(storedMessages[0]).not.toHaveProperty("attachments.0.dataBase64");
  });

  it("replays bounded in-memory attachment payloads for a later question in the same session", async () => {
    const capturedMessages: ChatMessage[][] = [];
    const onePixelPng =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const service = createChatService({
      chatClient: {
        async complete(request) {
          capturedMessages.push(request.messages);
          return chatReply(capturedMessages.length === 1 ? "附件已读取" : "按钮是更新");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: createChatSessionStore([]),
      createId: createSequentialId("history_attachment"),
      now: () => new Date("2026-07-14T15:30:00.000Z"),
    });
    const attachmentMetadata = [
      {
        id: "attachment_image_followup",
        name: "screen.png",
        mediaType: "image/png",
        size: 68,
        kind: "image" as const,
      },
      {
        id: "attachment_text_followup",
        name: "notes.md",
        mediaType: "text/markdown",
        size: 5,
        kind: "text" as const,
      },
    ];

    const first = await service.sendMessage({
      message: "看一下截图和说明",
      attachments: [
        { ...attachmentMetadata[0], dataBase64: onePixelPng },
        {
          ...attachmentMetadata[1],
          dataBase64: Buffer.from("hello").toString("base64"),
        },
      ],
    });
    expect(first.ok).toBe(true);

    const second = await service.sendMessage({
      sessionId: first.ok ? first.sessionId : "",
      message: "截图里的按钮叫什么？",
      history: [
        {
          role: "user",
          content: "看一下截图和说明",
          attachments: attachmentMetadata,
        },
        { role: "assistant", content: "附件已读取" },
      ],
    });

    expect(second).toMatchObject({ ok: true, reply: "按钮是更新" });
    expect(capturedMessages[1]?.[1]).toMatchObject({
      role: "user",
      content: expect.stringContaining("<attachment_context>"),
      images: [{ mediaType: "image/png", data: onePixelPng }],
    });
    expect(capturedMessages[1]?.at(-1)).toEqual({
      role: "user",
      content: "截图里的按钮叫什么？",
    });
  });

  it("marks historical attachments unavailable after the in-memory payload TTL", async () => {
    const capturedMessages: ChatMessage[][] = [];
    const onePixelPng =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    let nowMs = Date.parse("2026-07-14T15:30:00.000Z");
    const service = createChatService({
      chatClient: {
        async complete(request) {
          capturedMessages.push(request.messages);
          return chatReply("ok");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: createChatSessionStore([]),
      createId: createSequentialId("expired_history_attachment"),
      now: () => new Date(nowMs),
    });
    const metadata = {
      id: "attachment_image_expired_history",
      name: "screen.png",
      mediaType: "image/png",
      size: 68,
      kind: "image" as const,
    };

    const first = await service.sendMessage({
      message: "看一下截图",
      attachments: [{ ...metadata, dataBase64: onePixelPng }],
    });
    nowMs += 61 * 60 * 1000;
    await service.sendMessage({
      sessionId: first.ok ? first.sessionId : "",
      message: "继续说说",
      history: [
        { role: "user", content: "看一下截图", attachments: [metadata] },
        { role: "assistant", content: "ok" },
      ],
    });

    expect(capturedMessages[1]?.[1]).toMatchObject({
      role: "user",
      content: expect.stringContaining("历史附件内容已失效、不可用"),
    });
    expect(capturedMessages[1]?.[1]).not.toHaveProperty("images");
  });

  it("gives current retry attachments priority and never sends the same image twice", async () => {
    const capturedMessages: ChatMessage[][] = [];
    const onePixelPng =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const service = createChatService({
      chatClient: {
        async complete(request) {
          capturedMessages.push(request.messages);
          return chatReply("ok");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: createChatSessionStore([]),
      createId: createSequentialId("retry_attachment"),
    });
    const metadata = {
      id: "attachment_retry_once",
      name: "screen.png",
      mediaType: "image/png",
      size: 68,
      kind: "image" as const,
    };
    const payload = { ...metadata, dataBase64: onePixelPng };

    const first = await service.sendMessage({
      message: "分析截图",
      attachments: [payload],
    });
    await service.sendMessage({
      sessionId: first.ok ? first.sessionId : "",
      message: "分析截图",
      attachments: [payload],
      history: [
        { role: "user", content: "分析截图", attachments: [metadata] },
        { role: "assistant", content: "模型调用失败，请重试" },
      ],
    });

    const retryRequest = capturedMessages[1] ?? [];
    expect(
      retryRequest.reduce(
        (count, message) => count + (message.images?.length ?? 0),
        0,
      ),
    ).toBe(1);
    expect(retryRequest[1]).not.toHaveProperty("images");
    expect(retryRequest.at(-1)).toMatchObject({
      role: "user",
      images: [{ mediaType: "image/png", data: onePixelPng }],
    });
  });

  it("bounds all replayed history attachments to one 12 MiB model request budget", async () => {
    let callCount = 0;
    let finalRequest: ChatMessage[] = [];
    const service = createChatService({
      chatClient: {
        async complete(request) {
          callCount += 1;
          if (callCount === 4) {
            finalRequest = request.messages;
          }
          return chatReply("ok");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: createChatSessionStore([]),
      createId: createSequentialId("bounded_history_attachment"),
    });
    const imageSize = 5 * 1024 * 1024;
    const pngSignature = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    const payloads = [1, 2, 3].map((index) => {
      const bytes = Buffer.alloc(imageSize, index);
      pngSignature.copy(bytes, 0);
      return {
        id: `attachment_large_${index}`,
        name: `screen-${index}.png`,
        mediaType: "image/png",
        size: imageSize,
        kind: "image" as const,
        dataBase64: bytes.toString("base64"),
      };
    });

    let activeSessionId = "";
    for (const [index, payload] of payloads.entries()) {
      const result = await service.sendMessage({
        ...(activeSessionId ? { sessionId: activeSessionId } : {}),
        message: `第 ${index + 1} 张图`,
        attachments: [payload],
      });
      if (result.ok) {
        activeSessionId = result.sessionId;
      }
    }
    await service.sendMessage({
      sessionId: activeSessionId,
      message: "比较这些图",
      history: payloads.flatMap((payload, index) => [
        {
          role: "user" as const,
          content: `第 ${index + 1} 张图`,
          attachments: [
            {
              id: payload.id,
              name: payload.name,
              mediaType: payload.mediaType,
              size: payload.size,
              kind: payload.kind,
            },
          ],
        },
        { role: "assistant" as const, content: "ok" },
      ]),
    });

    const replayedImages = finalRequest.flatMap(
      (message) => message.images ?? [],
    );
    expect(replayedImages).toHaveLength(2);
    expect(replayedImages.map((image) => image.data)).toEqual([
      payloads[1]?.dataBase64,
      payloads[2]?.dataBase64,
    ]);
    expect(finalRequest[1]?.content).toContain("为控制本次请求大小已省略");
  });

  it("shares one 24,000-character text budget across current and historical attachments", async () => {
    let callCount = 0;
    const capturedRequests = new Map<number, ChatMessage[]>();
    const service = createChatService({
      chatClient: {
        async complete(request) {
          callCount += 1;
          if (callCount >= 3) {
            capturedRequests.set(callCount, request.messages);
          }
          return chatReply("ok");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: createChatSessionStore([]),
      createId: createSequentialId("bounded_text_history"),
    });
    const createTextPayload = (
      id: string,
      content: string,
    ) => {
      const bytes = Buffer.from(content);
      return {
        id,
        name: `${id}.txt`,
        mediaType: "text/plain",
        size: bytes.length,
        kind: "text" as const,
        dataBase64: bytes.toString("base64"),
      };
    };
    const historyPayloads = [
      createTextPayload("history_text_old", "甲".repeat(20_000)),
      createTextPayload("history_text_new", "乙".repeat(20_000)),
    ];
    const currentPayload = createTextPayload(
      "current_text",
      "丙".repeat(30_000),
    );
    let activeSessionId = "";
    for (const [index, payload] of historyPayloads.entries()) {
      const result = await service.sendMessage({
        ...(activeSessionId ? { sessionId: activeSessionId } : {}),
        message: `历史文本 ${index + 1}`,
        attachments: [payload],
      });
      if (result.ok) {
        activeSessionId = result.sessionId;
      }
    }
    const history = historyPayloads.flatMap((payload, index) => [
      {
        role: "user" as const,
        content: `历史文本 ${index + 1}`,
        attachments: [
          {
            id: payload.id,
            name: payload.name,
            mediaType: payload.mediaType,
            size: payload.size,
            kind: payload.kind,
          },
        ],
      },
      { role: "assistant" as const, content: "ok" },
    ]);

    await service.sendMessage({
      sessionId: activeSessionId,
      message: "比较历史文本",
      history,
    });
    await service.sendMessage({
      sessionId: activeSessionId,
      message: "优先分析当前文本",
      history,
      attachments: [currentPayload],
    });

    const historyOnlyText = (capturedRequests.get(3) ?? [])
      .map((message) => message.content)
      .join("\n");
    expect(historyOnlyText.match(/[甲乙]/gu)).toHaveLength(24_000);
    expect(historyOnlyText.match(/乙/gu)).toHaveLength(20_000);
    const currentPriorityText = (capturedRequests.get(4) ?? [])
      .map((message) => message.content)
      .join("\n");
    expect(currentPriorityText.match(/丙/gu)).toHaveLength(24_000);
    expect(currentPriorityText).not.toMatch(/[甲乙]/u);
  });

  it("fails closed on malformed historical attachment metadata from IPC", async () => {
    const capturedMessages: ChatMessage[][] = [];
    const service = createChatService({
      chatClient: {
        async complete(request) {
          capturedMessages.push(request.messages);
          return chatReply("ok");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      createId: createSequentialId("invalid_history_attachment"),
    });

    const result = await service.sendMessage({
      message: "继续",
      history: [
        {
          role: "user",
          content: "之前的附件",
          attachments: [null] as unknown as ChatAttachmentMetadata[],
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(capturedMessages[0]?.[1]?.content).toContain(
      "历史附件内容已失效、不可用",
    );
  });

  it("returns the persisted reply for a duplicate request without rerunning the model", async () => {
    const storedMessages: AppendChatMessageInput[] = [];
    const store = createChatSessionStore(storedMessages);
    let modelCalls = 0;
    const service = createChatService({
      chatClient: {
        async complete() {
          modelCalls += 1;
          return chatReply("只执行一次");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: store,
    });
    const input = {
      sessionId: "dedupe_session",
      requestId: "dedupe_request",
      message: "不要重复执行",
    };

    await expect(service.sendMessage(input)).resolves.toMatchObject({
      ok: true,
      reply: "只执行一次",
    });
    await expect(service.sendMessage(input)).resolves.toMatchObject({
      ok: true,
      reply: "只执行一次",
    });
    expect(modelCalls).toBe(1);
    expect(storedMessages.filter((message) => message.requestId === "dedupe_request"))
      .toHaveLength(2);
  });

  it("accepts a causal receipt only after the assistant message is durable and before terminal publication", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "chat-causal-order-"));
    try {
      const lifecycle: string[] = [];
      const causalStore = createConversationCausalStore({ configDir });
      const baseStore = createChatSessionStore([]);
      const chatStore = {
        ...baseStore,
        async appendMessage(input: AppendChatMessageInput) {
          const result = await baseStore.appendMessage(input);
          if (input.role === "assistant") lifecycle.push("assistant_persisted");
          return result;
        },
      };
      const service = createChatService({
        chatClient: {
          async complete() {
            return chatReply("durable causal answer");
          },
        },
        getModelProfile: createCompleteProfile,
        memoryStore: createMemoryStore(),
        chatSessionStore: chatStore,
        conversationCausalStore: {
          ...causalStore,
          async prepareAssistantAcceptance(input) {
            expect(lifecycle).toContain("assistant_persisted");
            const result = await causalStore.prepareAssistantAcceptance(input);
            lifecycle.push("receipt_prepared");
            return result;
          },
          async commitAssistantAcceptance(input) {
            const result = await causalStore.commitAssistantAcceptance(input);
            lifecycle.push("receipt_accepted");
            return result;
          },
        },
      });

      await expect(service.sendMessage(
        {
          sessionId: "causal_order_session",
          requestId: "causal_order_request",
          message: "persist then accept",
        },
        {
          onStreamEvent(event) {
            if (event.type === "completed") lifecycle.push("stream_completed");
          },
        },
      )).resolves.toMatchObject({ ok: true, reply: "durable causal answer" });
      expect(lifecycle).toEqual([
        "assistant_persisted",
        "receipt_prepared",
        "receipt_accepted",
        "stream_completed",
      ]);
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("does not execute the model twice for concurrent cross-session delivery of one request", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "chat-causal-race-"));
    try {
      const causalStore = createConversationCausalStore({ configDir });
      const modelGate = createDeferred();
      let modelCalls = 0;
      const service = createChatService({
        chatClient: {
          async complete() {
            modelCalls += 1;
            await modelGate.promise;
            return chatReply("single execution");
          },
        },
        getModelProfile: createCompleteProfile,
        memoryStore: createMemoryStore(),
        chatSessionStore: createChatSessionStore([]),
        conversationCausalStore: causalStore,
      });
      const first = service.sendMessage({
        sessionId: "race_session_a",
        requestId: "race_request",
        message: "execute once",
      });
      await waitFor(() => modelCalls === 1);
      await expect(service.sendMessage({
        sessionId: "race_session_b",
        requestId: "race_request",
        message: "execute once",
      })).resolves.toMatchObject({
        ok: false,
        retryable: true,
        message: "相同请求仍在处理中，未启动第二次执行。",
      });
      expect(modelCalls).toBe(1);
      modelGate.resolve();
      await expect(first).resolves.toMatchObject({
        ok: true,
        reply: "single execution",
        sessionId: "race_session_a",
      });
      await expect(causalStore.getRequest("race_request")).resolves.toMatchObject({
        attempts: [expect.objectContaining({ state: "accepted" })],
      });
      expect((await causalStore.getRequest("race_request"))?.requiredSettlements ?? [])
        .not.toContainEqual(expect.objectContaining({
          state: "committed",
          targetState: "failed",
        }));
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("fingerprints every execution-affecting request field and attachment bytes", () => {
    const attachment = {
      id: "attachment_1",
      name: "context.txt",
      mediaType: "text/plain",
      size: 2,
      kind: "text" as const,
      dataBase64: Buffer.from("aa").toString("base64"),
    };
    const baseline = createChatRequestClaimFingerprint({
      input: {
        message: "execute",
        mode: "goal_plan",
        planMode: "direct",
        planAutonomyMode: "standard",
        planModelAssignments: { direct: "model-a" },
        workspaceId: "workspace-a",
        workspaceSummary: {
          name: "Workspace A",
          rootPath: "/workspace/a",
          kind: "git",
          sandboxMode: "workspace-write",
          branch: "main",
        },
        history: [{ role: "user", content: "history-a" }],
      },
      userMessage: "execute",
      validatedAttachments: [attachment],
    });

    expect(createChatRequestClaimFingerprint({
      input: {
        message: "execute",
        mode: "goal_plan",
        planMode: "debate",
        planAutonomyMode: "auto",
        planModelAssignments: { direct: "model-b" },
        workspaceId: "workspace-a",
        workspaceSummary: {
          name: "Workspace B",
          rootPath: "/workspace/b",
          kind: "folder",
          sandboxMode: "read-only",
        },
        history: [{ role: "assistant", content: "history-b" }],
      },
      userMessage: "execute",
      validatedAttachments: [attachment],
    })).not.toBe(baseline);
    expect(createChatRequestClaimFingerprint({
      input: {
        message: "execute",
        mode: "goal_plan",
        planMode: "direct",
        planAutonomyMode: "standard",
        planModelAssignments: { direct: "model-a" },
        workspaceId: "workspace-a",
        workspaceSummary: {
          name: "Workspace A",
          rootPath: "/workspace/a",
          kind: "git",
          sandboxMode: "workspace-write",
          branch: "main",
        },
        history: [{ role: "user", content: "history-a" }],
      },
      userMessage: "execute",
      validatedAttachments: [{
        ...attachment,
        dataBase64: Buffer.from("bb").toString("base64"),
      }],
    })).not.toBe(baseline);
    const undefinedAssignment = createChatRequestClaimFingerprint({
      input: {
        message: "execute",
        planModelAssignments: { direct: undefined },
      },
      userMessage: "execute",
      validatedAttachments: [],
    });
    const stringAssignment = createChatRequestClaimFingerprint({
      input: {
        message: "execute",
        planModelAssignments: { direct: "[undefined]" },
      },
      userMessage: "execute",
      validatedAttachments: [],
    });
    expect(undefinedAssignment).not.toBe(stringAssignment);
    expect(baseline).toMatch(/^[0-9a-f]{64}$/);
  });

  it("fingerprints the complete normalized required Chat event without embedding attachment bytes", () => {
    const dataBase64 = Buffer.from("required settlement payload").toString("base64");
    const baseline: ChatTaskStatusEvent = {
      sessionId: "required_fingerprint_session",
      settlementId: "required_settlement_exact",
      domainStateAvailable: true,
      requestId: "required_fingerprint_request",
      turnId: "turn-required-fingerprint",
      sequence: 7,
      state: "waiting_for_input",
      message: "Need one exact value.",
      createdAt: "2026-08-24T00:00:00.000Z",
      elapsedMs: 12,
      selectedSkillName: "exact-skill",
      approvalId: "approval_exact",
      payload: { stage: "input", required: true },
      pendingSkillInput: {
        inputRequestId: "input_exact",
        status: "pending",
        settlementId: "required_settlement_exact",
        sessionId: "required_fingerprint_session",
        requestId: "required_fingerprint_request",
        userMessage: "run exact skill",
        userMessageId: "message_exact",
        selectedSkillName: "exact-skill",
        partialValues: { count: 1 },
        attachmentPayloads: [{
          id: "attachment_exact",
          name: "context.txt",
          mediaType: "text/plain",
          size: dataBase64.length,
          kind: "text",
          dataBase64,
        }],
      },
    };
    const fingerprint = createRequiredChatEventFingerprint(baseline);

    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(fingerprint).not.toContain(dataBase64);
    expect(createRequiredChatEventFingerprint({
      ...baseline,
      message: "Need a changed value.",
    })).not.toBe(fingerprint);
    expect(createRequiredChatEventFingerprint({
      ...baseline,
      elapsedMs: 13,
    })).not.toBe(fingerprint);
    expect(createRequiredChatEventFingerprint({
      ...baseline,
      approvalId: "approval_changed",
    })).not.toBe(fingerprint);
    expect(createRequiredChatEventFingerprint({
      ...baseline,
      pendingSkillInput: {
        ...baseline.pendingSkillInput!,
        attachmentPayloads: [{
          ...baseline.pendingSkillInput!.attachmentPayloads![0],
          dataBase64: Buffer.from("changed payload").toString("base64"),
        }],
      },
    })).not.toBe(fingerprint);
  });

  it("rejects global request replay when attachment bytes or Plan inputs change", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "chat-exact-claim-"));
    try {
      let modelCalls = 0;
      const service = createChatService({
        chatClient: {
          async complete() {
            modelCalls += 1;
            return chatReply("claimed once");
          },
        },
        getModelProfile: createCompleteProfile,
        memoryStore: createMemoryStore(),
        chatSessionStore: createChatSessionStore([]),
        conversationCausalStore: createConversationCausalStore({ configDir }),
      });
      const attachment = {
        id: "claim_attachment",
        name: "claim.txt",
        mediaType: "text/plain",
        size: 2,
        kind: "text" as const,
        dataBase64: Buffer.from("aa").toString("base64"),
      };
      await expect(service.sendMessage({
        sessionId: "claim_session_a",
        requestId: "exact_claim_request",
        message: "same visible input",
        planMode: "direct",
        attachments: [attachment],
      })).resolves.toMatchObject({ ok: true, reply: "claimed once" });
      await expect(service.sendMessage({
        sessionId: "claim_session_b",
        requestId: "exact_claim_request",
        message: "same visible input",
        planMode: "debate",
        attachments: [{
          ...attachment,
          dataBase64: Buffer.from("bb").toString("base64"),
        }],
      })).resolves.toMatchObject({
        ok: false,
        message: "相同 requestId 已绑定到不同输入，已拒绝冲突重放。",
      });
      expect(modelCalls).toBe(1);
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("fails closed when lossy Workspace ids collide across distinct request envelopes", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "chat-workspace-collision-"));
    try {
      const causalStore = createConversationCausalStore({ configDir });
      let modelCalls = 0;
      const service = createChatService({
        chatClient: {
          async complete() {
            modelCalls += 1;
            return chatReply("only first executes");
          },
        },
        getModelProfile: createCompleteProfile,
        memoryStore: createMemoryStore(),
        chatSessionStore: createChatSessionStore([]),
        conversationCausalStore: causalStore,
        workspaceService: {
          async resolveRunContext() {
            return buildPrimaryRunContext({
              workspaceId: "workspace_collision",
              workspaceRoot: "/workspace/collision",
            });
          },
        },
        workspaceRunStore: createWorkspaceRunStore({ configDir }),
      });

      await expect(service.sendMessage({
        sessionId: "collision_session",
        requestId: "request:a",
        message: "first envelope",
        workspaceId: "workspace_collision",
      })).resolves.toMatchObject({ ok: true });
      await expect(service.sendMessage({
        sessionId: "collision_session",
        requestId: "request?a",
        message: "second envelope",
        workspaceId: "workspace_collision",
      })).resolves.toMatchObject({
        ok: false,
        message: "工作区运行状态与当前请求不一致，已安全停止。",
      });
      expect(modelCalls).toBe(1);
      await expect(causalStore.getRequest("request?a")).resolves.toMatchObject({
        coverage: {
          state: "degraded",
          reasonCodes: expect.arrayContaining(["workspace_run_envelope_conflict"]),
        },
      });
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("fails closed in production Kernel before model execution when Workspace prepare fails", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "chat-workspace-init-failure-"));
    try {
      const causalStore = createConversationCausalStore({
        configDir: path.join(configDir, "causal"),
      });
      const baseWorkspaceStore = createWorkspaceRunStore({
        configDir: path.join(configDir, "workspace"),
      });
      const bus = new KernelEventBus();
      let modelCalls = 0;
      const service = createChatService({
        chatClient: {
          async complete() {
            modelCalls += 1;
            return chatReply("legacy chat remains available");
          },
        },
        getModelProfile: createCompleteProfile,
        memoryStore: createMemoryStore(),
        chatSessionStore: createChatSessionStore([]),
        conversationCausalStore: causalStore,
        workspaceService: {
          async resolveRunContext() {
            return buildPrimaryRunContext({
              workspaceId: "workspace_init_failure",
              workspaceRoot: "/workspace/init-failure",
            });
          },
        },
        workspaceRunStore: {
          ...baseWorkspaceStore,
          async ensureRun() {
            throw new Error("simulated workspace storage failure");
          },
        },
        productionKernelDriver: createProductionKernelDriver({ bus }),
      });

      await expect(service.sendMessage({
        sessionId: "workspace_init_session",
        requestId: "workspace_init_request",
        message: "continue safely",
        workspaceId: "workspace_init_failure",
      })).resolves.toMatchObject({
        ok: false,
        code: "INTERNAL_ERROR",
        message: "会话失败状态未能完整持久化，请重新加载后重试。",
      });
      expect(modelCalls).toBe(0);
      expect(bus.history().at(-1)).toMatchObject({
        type: "run_end",
        status: "failed",
      });
      await expect(baseWorkspaceStore.getRun(
        "chat_run_workspace_init_session_workspace_init_request",
      )).resolves.toBeNull();
      await expect(causalStore.getRequest("workspace_init_request")).resolves.toMatchObject({
        coverage: {
          state: "degraded",
          reasonCodes: expect.arrayContaining(["workspace_run_initialize_failed"]),
        },
      });
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("repairs a message-first crash into an accepted receipt and terminal Workspace snapshot", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "chat-causal-repair-"));
    try {
      const causalStore = createConversationCausalStore({ configDir });
      const storedMessages: AppendChatMessageInput[] = [];
      const chatStore = createChatSessionStore(storedMessages);
      const user = await chatStore.appendMessage({
        sessionId: "repair_session",
        requestId: "repair_request",
        role: "user",
        content: "repair me",
      });
      const assistant = await chatStore.appendMessage({
        sessionId: "repair_session",
        requestId: "repair_request",
        turnId: "turn-repair_request",
        causalAttempt: 1,
        causalAttemptId: createConversationCausalAttemptId({
          requestId: "repair_request",
          turnId: "turn-repair_request",
          attempt: 1,
        }),
        role: "assistant",
        content: "already durable",
        turnSettlementStatus: "succeeded",
      });
      await causalStore.claimRequest({
        requestId: "repair_request",
        turnId: "turn-repair_request",
        inputFingerprint: createChatRequestClaimFingerprint({
          input: { message: "repair me" },
          userMessage: "repair me",
          validatedAttachments: [],
        }),
      });
      await causalStore.bindRequest({
        requestId: "repair_request",
        sessionId: "repair_session",
        userMessageId: user.message.id,
      });
      await causalStore.beginAttempt({ requestId: "repair_request", attempt: 1 });
      await causalStore.addRefs({
        requestId: "repair_request",
        refs: [
          { kind: "workspace_run", id: "aaa_unrelated_workspace_run" },
          { kind: "workspace_run", id: "chat_run_repair_session_repair_request" },
        ],
      });
      const workspaceEvents: WorkspaceRunEventInput[] = [];
      const workspaceFinishes: Array<{
        workspaceRunId: string;
        status: WorkspaceRunTerminalStatus;
        summary?: string;
      }> = [];
      const workspaceStore = createMemoryWorkspaceRunStore({
        creates: [],
        events: workspaceEvents,
        finishes: workspaceFinishes,
      });
      await workspaceStore.ensureRun({
        workspaceRunId: "chat_run_repair_session_repair_request",
        sessionId: "repair_session",
        requestId: "repair_request",
      });
      await workspaceStore.ensureRun({
        workspaceRunId: "aaa_unrelated_workspace_run",
        sessionId: "unrelated_session",
        requestId: "unrelated_request",
      });
      let modelCalls = 0;
      const service = createChatService({
        chatClient: {
          async complete() {
            modelCalls += 1;
            return chatReply("must not run");
          },
        },
        getModelProfile: createCompleteProfile,
        memoryStore: createMemoryStore(),
        chatSessionStore: chatStore,
        conversationCausalStore: causalStore,
        workspaceRunStore: workspaceStore,
      });

      await expect(service.sendMessage({
        sessionId: "repair_session",
        requestId: "repair_request",
        message: "repair me",
      })).resolves.toMatchObject({
        ok: true,
        reply: "already durable",
      });
      expect(modelCalls).toBe(0);
      await expect(causalStore.getRequest("repair_request")).resolves.toMatchObject({
        attempts: [expect.objectContaining({
          state: "accepted",
          acceptedSettlement: expect.objectContaining({
            acceptedMessageId: assistant.message.id,
          }),
        })],
      });
      expect(workspaceFinishes).toEqual([
        expect.objectContaining({
          workspaceRunId: "chat_run_repair_session_repair_request",
          status: "succeeded",
        }),
      ]);
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("does not settle an unrelated Workspace run when replay ownership evidence is missing", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "chat-causal-owner-gap-"));
    try {
      const causalStore = createConversationCausalStore({ configDir });
      const chatStore = createChatSessionStore([]);
      const user = await chatStore.appendMessage({
        sessionId: "owner_gap_session",
        requestId: "owner_gap_request",
        role: "user",
        content: "replay safely",
      });
      await chatStore.appendMessage({
        sessionId: "owner_gap_session",
        requestId: "owner_gap_request",
        turnId: "turn-owner_gap_request",
        causalAttempt: 1,
        causalAttemptId: createConversationCausalAttemptId({
          requestId: "owner_gap_request",
          turnId: "turn-owner_gap_request",
          attempt: 1,
        }),
        role: "assistant",
        content: "already durable",
        turnSettlementStatus: "succeeded",
      });
      await causalStore.claimRequest({
        requestId: "owner_gap_request",
        turnId: "turn-owner_gap_request",
        inputFingerprint: createChatRequestClaimFingerprint({
          input: { message: "replay safely" },
          userMessage: "replay safely",
          validatedAttachments: [],
        }),
      });
      await causalStore.bindRequest({
        requestId: "owner_gap_request",
        sessionId: "owner_gap_session",
        userMessageId: user.message.id,
      });
      await causalStore.beginAttempt({ requestId: "owner_gap_request", attempt: 1 });
      await causalStore.addRefs({
        requestId: "owner_gap_request",
        refs: [{ kind: "workspace_run", id: "unrelated_workspace_run" }],
      });
      const workspaceFinishes: Array<{
        workspaceRunId: string;
        status: WorkspaceRunTerminalStatus;
        summary?: string;
      }> = [];
      const workspaceStore = createMemoryWorkspaceRunStore({
        creates: [],
        events: [],
        finishes: workspaceFinishes,
      });
      await workspaceStore.ensureRun({
        workspaceRunId: "unrelated_workspace_run",
        sessionId: "unrelated_session",
        requestId: "unrelated_request",
      });
      const service = createChatService({
        chatClient: {
          async complete() {
            throw new Error("model must not run during replay");
          },
        },
        getModelProfile: createCompleteProfile,
        memoryStore: createMemoryStore(),
        chatSessionStore: chatStore,
        conversationCausalStore: causalStore,
        workspaceRunStore: workspaceStore,
      });

      await expect(service.sendMessage({
        sessionId: "owner_gap_session",
        requestId: "owner_gap_request",
        message: "replay safely",
      })).resolves.toMatchObject({
        ok: true,
        reply: "already durable",
      });
      expect(workspaceFinishes).toEqual([]);
      await expect(causalStore.getRequest("owner_gap_request")).resolves.toMatchObject({
        coverage: {
          state: "degraded",
          reasonCodes: expect.arrayContaining(["workspace_owner_ref_missing"]),
        },
      });
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("durably settles a persisted assistant receipt conflict against the claim owner", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "chat-causal-receipt-conflict-"));
    try {
      const requestId = "receipt_conflict_request";
      const actualSessionId = "receipt_conflict_actual";
      const staleSessionId = "receipt_conflict_stale";
      const message = "reconcile the durable answer";
      const chatStore = createChatSessionStore([]);
      const user = await chatStore.appendMessage({
        sessionId: actualSessionId,
        requestId,
        role: "user",
        content: message,
      });
      await chatStore.appendMessage({
        sessionId: actualSessionId,
        requestId,
        role: "assistant",
        content: "actual durable answer",
        turnSettlementStatus: "succeeded",
      });
      await chatStore.appendMessage({
        sessionId: staleSessionId,
        requestId: "unrelated_stale_request",
        role: "user",
        content: "existing stale session",
      });
      const causalStore = createConversationCausalStore({ configDir });
      await causalStore.claimRequest({
        requestId,
        turnId: `turn-${requestId}`,
        inputFingerprint: createChatRequestClaimFingerprint({
          input: { message },
          userMessage: message,
          validatedAttachments: [],
        }),
      });
      await causalStore.bindRequest({
        requestId,
        sessionId: actualSessionId,
        userMessageId: user.message.id,
      });
      await causalStore.beginAttempt({ requestId, attempt: 1 });
      await causalStore.acceptAssistant({
        requestId,
        attempt: 1,
        persistedMessage: {
          id: "different_receipt_message",
          role: "assistant",
          requestId,
          turnId: `turn-${requestId}`,
          content: "different receipt content",
          turnSettlementStatus: "succeeded",
        },
      });
      let modelCalls = 0;
      const bus = new KernelEventBus();
      const streamEvents: ChatStreamEvent[] = [];
      const service = createChatService({
        chatClient: {
          async complete() {
            modelCalls += 1;
            return chatReply("must not run");
          },
        },
        getModelProfile: createCompleteProfile,
        memoryStore: createMemoryStore(),
        chatSessionStore: chatStore,
        conversationCausalStore: causalStore,
        productionKernelDriver: createProductionKernelDriver({ bus }),
      });

      await expect(service.sendMessage(
        {
          sessionId: staleSessionId,
          requestId,
          message,
        },
        { onStreamEvent: (event) => streamEvents.push(event) },
      )).resolves.toMatchObject({
        ok: false,
        code: "CONFLICT",
        message: expect.stringContaining("缺少可验证的尝试归属"),
      });
      expect(modelCalls).toBe(0);
      expect((await chatStore.get(actualSessionId))?.activity).toBeUndefined();
      await expect(chatStore.get(staleSessionId)).resolves.not.toMatchObject({
        activity: {
          statusEvents: expect.arrayContaining([
            expect.objectContaining({ requestId }),
          ]),
        },
      });
      expect(streamEvents).toEqual([]);
      expect(bus.history()).toEqual([]);
      await expect(causalStore.getRequest(requestId)).resolves.toMatchObject({
        refs: [],
        attempts: [expect.objectContaining({ state: "accepted" })],
      });
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("finishes an interactive task by transparently continuing provider output chunks", async () => {
    let modelCalls = 0;
    const service = createChatService({
      chatClient: {
        async complete() {
          modelCalls += 1;
          return modelCalls === 1
            ? {
                content: "服务商单次输出的前半段，",
                toolCalls: [],
                finishReason: "length",
              }
            : chatReply("自动续写后完成。 ");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: createChatSessionStore([]),
      toolExecutor: createToolExecutor(),
    });

    await expect(service.sendMessage({
      sessionId: "automatic_output_continuation",
      requestId: "automatic_output_continuation_request",
      message: "执行一个长任务",
    })).resolves.toMatchObject({
      ok: true,
      reply: expect.stringContaining(
        "服务商单次输出的前半段，自动续写后完成。",
      ),
      agentStatus: {
        state: "completed",
      },
    });
    expect(modelCalls).toBe(2);
  });

  it("starts a new evidence run when resuming a persisted continuation", async () => {
    const storedMessages: AppendChatMessageInput[] = [];
    const store = createChatSessionStore(storedMessages);
    const trajectoryEvents: AgentTrajectoryEvent[] = [];
    const trajectoryStore = createMemoryTrajectoryStore(trajectoryEvents);
    const createId = createSequentialId("continuation_evidence");
    let firstLoopRunId = "";
    const firstService = createChatService({
      chatClient: { async complete() { return chatReply("unused"); } },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: store,
      trajectoryStore,
      toolExecutor: createToolExecutor(),
      createId,
      async runAgentLoop(messages, _profile, options) {
        firstLoopRunId = options.runId ?? "";
        return {
          status: "paused",
          summary: "等待继续",
          turns: 1,
          messages: [...messages, { role: "assistant", content: "阶段结果" }],
          toolCallsExecuted: 1,
          continuation: {
            reason: "provider_output_limit",
            maxTurns: 4,
            toolCallsExecuted: 1,
          },
        };
      },
    });

    await expect(firstService.sendMessage({
      sessionId: "evidence_resume_session",
      requestId: "evidence_resume_first",
      message: "执行长任务",
    })).resolves.toMatchObject({
      ok: true,
      agentStatus: { state: "paused" },
    });

    let resumedLoopRunId = "";
    const restartedService = createChatService({
      chatClient: { async complete() { return chatReply("unused"); } },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: store,
      trajectoryStore,
      toolExecutor: createToolExecutor(),
      createId,
      async runAgentLoop(messages, _profile, options) {
        resumedLoopRunId = options.runId ?? "";
        expect(options.toolResultContinuationOwnerId).toBe(
          "chat:evidence_resume_session",
        );
        return {
          status: "succeeded",
          summary: "续跑完成",
          turns: 1,
          messages,
          toolCallsExecuted: 1,
        };
      },
    });

    await expect(restartedService.sendMessage({
      sessionId: "evidence_resume_session",
      requestId: "evidence_resume_second",
      message: "继续",
    })).resolves.toMatchObject({
      ok: true,
      reply: expect.stringContaining("续跑完成"),
      agentStatus: { state: "completed" },
    });

    expect(firstLoopRunId).not.toBe("");
    expect(resumedLoopRunId).not.toBe(firstLoopRunId);
    const resumedContext = trajectoryEvents.find((event) =>
      event.runId === resumedLoopRunId && event.type === "run_context_created"
    );
    expect(resumedContext).toMatchObject({
      payload: {
        runtimeContextSnapshot: {
          checkpoint: {
            checkpointId: firstLoopRunId,
            boundaryId: "evidence_resume_second",
          },
        },
        continuationLineage: {
          parentEvidenceRunId: firstLoopRunId,
          continuationRequestId: "evidence_resume_second",
        },
      },
    });
  });

  it("recovers a provider-paused agent continuation from the session store after restart", async () => {
    const canary = "chat-provider-notice-canary";
    const streamEvents: ChatStreamEvent[] = [];
    const storedMessages: AppendChatMessageInput[] = [];
    const store = createChatSessionStore(storedMessages);
    const firstService = createChatService({
      chatClient: {
        async complete() {
          return {
            content: "服务商截断前的部分结果",
            toolCalls: [],
            finishReason: "length",
            modelServiceNotice: {
              kind: "output_limit",
              provider: `api_key=${canary}`,
              model: `client_secret=${canary}`,
              rawReason: `password=${canary}`,
              message: `api%255fkey=${canary}`,
            },
          };
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: store,
      toolExecutor: createToolExecutor(),
    });
    const firstResult = await firstService.sendMessage(
      {
        sessionId: "restart_session",
        requestId: "restart_first",
        message: "执行长任务",
      },
      { onStreamEvent: (event) => streamEvents.push(event) },
    );
    expect(firstResult).toMatchObject({
      ok: true,
      agentStatus: {
        state: "paused",
        reason: "provider_output_limit",
        modelServiceNotice: { kind: "output_limit" },
      },
    });
    expect(JSON.stringify({
      firstResult,
      streamEvents,
      session: await store.get("restart_session"),
    })).toContain("[redacted]");
    expect(JSON.stringify({
      firstResult,
      streamEvents,
      session: await store.get("restart_session"),
    })).not.toContain(canary);

    const resumedRequests: ChatMessage[][] = [];
    const restartedService = createChatService({
      chatClient: {
        async complete(request) {
          resumedRequests.push(request.messages);
          return chatReply("重启后已继续完成");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: store,
      toolExecutor: createToolExecutor(),
      agentLoopMaxTurns: 2,
    });
    await expect(restartedService.sendMessage({
      sessionId: "restart_session",
      requestId: "restart_second",
      message: "继续",
    })).resolves.toMatchObject({
      ok: true,
      reply: expect.stringContaining("重启后已继续完成"),
    });
    expect(JSON.stringify(resumedRequests[0])).toContain("服务商截断前的部分结果");
    expect(JSON.stringify(resumedRequests[0])).toContain("用户已确认继续执行");

    const postCompletionRequests: ChatMessage[][] = [];
    const thirdService = createChatService({
      chatClient: {
        async complete(request) {
          postCompletionRequests.push(request.messages);
          return chatReply("这是新的普通对话");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: store,
    });
    await thirdService.sendMessage({
      sessionId: "restart_session",
      requestId: "restart_third",
      message: "继续",
    });
    expect(JSON.stringify(postCompletionRequests[0])).not.toContain(
      "用户已确认继续执行上一个已暂停的长任务",
    );
  });

  it("persists the assistant and stream terminal before Chat Kernel run_end", async () => {
    const lifecycle: string[] = [];
    const bus = new KernelEventBus();
    bus.subscribe((event) => {
      if (event.type === "run_end") lifecycle.push("run_end");
    });
    const storedMessages: AppendChatMessageInput[] = [];
    const baseStore = createChatSessionStore(storedMessages);
    const store = {
      ...baseStore,
      async appendMessage(input: AppendChatMessageInput) {
        const result = await baseStore.appendMessage(input);
        if (input.role === "assistant") lifecycle.push("assistant_persisted");
        return result;
      },
    };
    const service = createChatService({
      chatClient: {
        async complete() {
          return chatReply("unused");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: store,
      toolExecutor: createToolExecutor(),
      productionKernelDriver: createProductionKernelDriver({
        bus,
        now: () => "2026-08-14T12:00:00.000Z",
      }),
      async runAgentLoop(messages) {
        return {
          status: "succeeded",
          summary: "Kernel Chat complete.",
          turns: 1,
          messages,
          toolCallsExecuted: 0,
        };
      },
    });

    await expect(
      service.sendMessage(
        {
          sessionId: "kernel_chat_session",
          requestId: "kernel_chat_request",
          message: "use Kernel",
        },
        {
          onStreamEvent(event) {
            if (event.type === "completed") lifecycle.push("stream_completed");
          },
        },
      ),
    ).resolves.toMatchObject({
      ok: true,
      reply: "Kernel Chat complete.",
    });

    expect(lifecycle).toEqual([
      "assistant_persisted",
      "stream_completed",
      "run_end",
    ]);
    expect(bus.history().at(-1)).toMatchObject({
      type: "run_end",
      status: "succeeded",
    });
  });

  it("withholds production Kernel terminals until Chat, Workspace, and causal acceptance settle", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "chat-terminal-gates-"));
    try {
      const lifecycle: string[] = [];
      const chatGate = createDeferred<void>();
      const workspaceGate = createDeferred<void>();
      const causalGate = createDeferred<void>();
      const statusEvents: ChatTaskStatusEvent[] = [];
      const streamEvents: ChatStreamEvent[] = [];
      const bus = new KernelEventBus();
      const baseChatStore = createChatSessionStore([]);
      const chatStore = {
        ...baseChatStore,
        async appendActivityEvent(
          sessionId: string,
          event: ChatTaskStatusEvent,
        ) {
          if (event.state === "completed") {
            lifecycle.push("chat_started");
            await chatGate.promise;
            lifecycle.push("chat_settled");
          }
          return baseChatStore.appendActivityEvent(sessionId, event);
        },
      };
      const baseWorkspaceStore = createMemoryWorkspaceRunStore({
        creates: [],
        events: [],
        finishes: [],
      });
      const workspaceStore = {
        ...baseWorkspaceStore,
        async settleLifecycle(
          input: Parameters<WorkspaceRunStore["settleLifecycle"]>[0],
        ) {
          if (input.snapshotStatus === "succeeded") {
            lifecycle.push("workspace_started");
            await workspaceGate.promise;
            lifecycle.push("workspace_settled");
          }
          return baseWorkspaceStore.settleLifecycle(input);
        },
      };
      const causalStore = createConversationCausalStore({ configDir });
      const service = createChatService({
        chatClient: { async complete() { return chatReply("unused"); } },
        getModelProfile: createCompleteProfile,
        memoryStore: createMemoryStore(),
        chatSessionStore: chatStore,
        conversationCausalStore: {
          ...causalStore,
          async prepareAssistantAcceptance(input) {
            const result = await causalStore.prepareAssistantAcceptance(input);
            lifecycle.push("causal_prepared");
            return result;
          },
          async commitAssistantAcceptance(input) {
            lifecycle.push("causal_started");
            await causalGate.promise;
            const result = await causalStore.commitAssistantAcceptance(input);
            lifecycle.push("causal_settled");
            return result;
          },
        },
        workspaceService: {
          async resolveRunContext() {
            return buildPrimaryRunContext({
              workspaceId: "workspace_terminal_gates",
              workspaceRoot: "/workspace/terminal-gates",
            });
          },
        },
        workspaceRunStore: workspaceStore,
        toolExecutor: createToolExecutor(),
        productionKernelDriver: createProductionKernelDriver({ bus }),
        async runAgentLoop(messages) {
          return {
            status: "succeeded",
            summary: "Terminal only after all durable gates.",
            turns: 1,
            messages,
            toolCallsExecuted: 0,
          };
        },
      });
      const observedTerminals = () => [
        ...statusEvents.flatMap((event) =>
          event.state === "completed"
          || event.state === "failed"
          || event.state === "canceled"
            ? [`status:${event.state}`]
            : [],
        ),
        ...streamEvents.flatMap((event) => {
          if (
            event.type === "completed"
            || event.type === "failed"
            || event.type === "canceled"
          ) {
            return [`stream:${event.type}`];
          }
          return event.type === "status"
            && (
              event.status.state === "completed"
              || event.status.state === "failed"
              || event.status.state === "canceled"
            )
            ? [`stream-status:${event.status.state}`]
            : [];
        }),
      ];

      const sending = service.sendMessage(
        {
          sessionId: "terminal_gates_session",
          requestId: "terminal_gates_request",
          message: "publish only after all gates",
          workspaceId: "workspace_terminal_gates",
        },
        {
          onStatusEvent: (event) => statusEvents.push(event),
          onStreamEvent: (event) => streamEvents.push(event),
        },
      );

      await waitFor(() => lifecycle.includes("chat_started"));
      expect(observedTerminals()).toEqual([]);
      expect(bus.history().filter((event) => event.type === "run_end")).toEqual([]);
      chatGate.resolve();

      await waitFor(() => lifecycle.includes("workspace_started"));
      expect(observedTerminals()).toEqual([]);
      expect(bus.history().filter((event) => event.type === "run_end")).toEqual([]);
      workspaceGate.resolve();

      await waitFor(() => lifecycle.includes("causal_started"));
      expect(observedTerminals()).toEqual([]);
      expect(bus.history().filter((event) => event.type === "run_end")).toEqual([]);
      causalGate.resolve();

      await expect(sending).resolves.toMatchObject({
        ok: true,
        reply: "Terminal only after all durable gates.",
      });
      expect(lifecycle).toEqual([
        "chat_started",
        "chat_settled",
        "causal_prepared",
        "workspace_started",
        "workspace_settled",
        "causal_started",
        "causal_settled",
      ]);
      expect(observedTerminals()).toEqual([
        "status:completed",
        "stream-status:completed",
        "stream:completed",
      ]);
      expect(bus.history().filter((event) => event.type === "run_end"))
        .toEqual([expect.objectContaining({ status: "succeeded" })]);
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("publishes only a safe failed terminal when Workspace success finalization fails", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "chat-workspace-finalize-fail-"));
    try {
      const causalStore = createConversationCausalStore({ configDir });
      let prepareAssistantCalls = 0;
      let commitAssistantCalls = 0;
      const baseWorkspaceStore = createMemoryWorkspaceRunStore({
        creates: [],
        events: [],
        finishes: [],
      });
      const workspaceStore = {
        ...baseWorkspaceStore,
        async settleLifecycle(
          input: Parameters<WorkspaceRunStore["settleLifecycle"]>[0],
        ) {
          if (input.snapshotStatus === "succeeded") {
            throw new Error("private workspace finalize failure");
          }
          return baseWorkspaceStore.settleLifecycle(input);
        },
      };
      const bus = new KernelEventBus();
      const statusEvents: ChatTaskStatusEvent[] = [];
      const streamEvents: ChatStreamEvent[] = [];
      const service = createChatService({
        chatClient: { async complete() { return chatReply("unused"); } },
        getModelProfile: createCompleteProfile,
        memoryStore: createMemoryStore(),
        chatSessionStore: createChatSessionStore([]),
        conversationCausalStore: {
          ...causalStore,
          async prepareAssistantAcceptance(input) {
            prepareAssistantCalls += 1;
            return causalStore.prepareAssistantAcceptance(input);
          },
          async commitAssistantAcceptance(input) {
            commitAssistantCalls += 1;
            return causalStore.commitAssistantAcceptance(input);
          },
        },
        workspaceService: {
          async resolveRunContext() {
            return buildPrimaryRunContext({
              workspaceId: "workspace_finalize_failure",
              workspaceRoot: "/workspace/finalize-failure",
            });
          },
        },
        workspaceRunStore: workspaceStore,
        toolExecutor: createToolExecutor(),
        productionKernelDriver: createProductionKernelDriver({ bus }),
        async runAgentLoop(messages) {
          return {
            status: "succeeded",
            summary: "Must not become a completed terminal.",
            turns: 1,
            messages,
            toolCallsExecuted: 0,
          };
        },
      });

      await expect(service.sendMessage(
        {
          sessionId: "workspace_finalize_failure_session",
          requestId: "workspace_finalize_failure_request",
          message: "finish only after Workspace is durable",
          workspaceId: "workspace_finalize_failure",
        },
        {
          onStatusEvent: (event) => statusEvents.push(event),
          onStreamEvent: (event) => streamEvents.push(event),
        },
      )).resolves.toMatchObject({
        ok: false,
        message: "工作区状态持久化失败，已安全停止本次任务。",
      });

      expect(prepareAssistantCalls).toBe(1);
      expect(commitAssistantCalls).toBe(0);
      expect(statusEvents.filter((event) =>
        event.state === "completed"
        || event.state === "failed"
        || event.state === "canceled"
      )).toEqual([
        expect.objectContaining({
          state: "failed",
          message: "工作区状态持久化失败，已安全停止本次任务。",
        }),
      ]);
      expect(streamEvents.filter((event) =>
        event.type === "completed"
        || event.type === "failed"
        || event.type === "canceled"
      )).toEqual([
        expect.objectContaining({
          type: "failed",
          message: "工作区状态持久化失败，已安全停止本次任务。",
        }),
      ]);
      expect(bus.history().filter((event) => event.type === "run_end"))
        .toEqual([expect.objectContaining({ status: "failed" })]);
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it.each(["conflict", "throw"] as const)(
    "fails before Workspace success when causal acceptance prepare returns %s",
    async (failureMode) => {
      const configDir = await mkdtemp(path.join(os.tmpdir(), "chat-accept-prepare-fail-"));
      try {
        const causalStore = createConversationCausalStore({
          configDir: path.join(configDir, "causal"),
        });
        const workspaceStore = createWorkspaceRunStore({
          configDir: path.join(configDir, "workspace"),
        });
        const bus = new KernelEventBus();
        const service = createChatService({
          chatClient: { async complete() { return chatReply("unused"); } },
          getModelProfile: createCompleteProfile,
          memoryStore: createMemoryStore(),
          chatSessionStore: createChatSessionStore([]),
          conversationCausalStore: {
            ...causalStore,
            async prepareAssistantAcceptance(input) {
              if (failureMode === "throw") {
                throw new Error("private causal prepare failure");
              }
              const current = await causalStore.getRequest(input.requestId);
              return { disposition: "conflict" as const, value: current ?? undefined };
            },
          },
          workspaceService: {
            async resolveRunContext() {
              return buildPrimaryRunContext({
                workspaceId: `workspace_accept_prepare_${failureMode}`,
                workspaceRoot: `/workspace/accept-prepare-${failureMode}`,
              });
            },
          },
          workspaceRunStore: workspaceStore,
          toolExecutor: createToolExecutor(),
          productionKernelDriver: createProductionKernelDriver({ bus }),
          async runAgentLoop(messages) {
            return {
              status: "succeeded",
              summary: "prepare must fence Workspace success",
              turns: 1,
              messages,
              toolCallsExecuted: 0,
            };
          },
        });
        const requestId = `accept_prepare_${failureMode}_request`;
        const sessionId = `accept_prepare_${failureMode}_session`;

        await expect(service.sendMessage({
          sessionId,
          requestId,
          message: "prepare acceptance",
          workspaceId: `workspace_accept_prepare_${failureMode}`,
        })).resolves.toMatchObject({ ok: false });
        expect(bus.history().at(-1)).toMatchObject({
          type: "run_end",
          status: "failed",
        });
        const workspaceRunId = `chat_run_${sessionId}_${requestId}`;
        await expect(workspaceStore.getRun(workspaceRunId)).resolves.toMatchObject({
          status: "failed",
        });
        const causal = await causalStore.getRequest(requestId);
        expect(causal?.attempts.at(-1)).not.toMatchObject({ state: "accepted" });
      } finally {
        await rm(configDir, { recursive: true, force: true });
      }
    },
  );

  it.each(["before", "after", "persistent_after"] as const)(
    "recovers a Workspace success commit throw %s the authoritative write",
    async (failurePoint) => {
      const configDir = await mkdtemp(path.join(os.tmpdir(), "chat-workspace-commit-once-"));
      try {
        const causalStore = createConversationCausalStore({
          configDir: path.join(configDir, "causal"),
        });
        const baseWorkspaceStore = createWorkspaceRunStore({
          configDir: path.join(configDir, "workspace"),
        });
        let injected = false;
        const workspaceStore = {
          ...baseWorkspaceStore,
          async settleLifecycle(
            input: Parameters<WorkspaceRunStore["settleLifecycle"]>[0],
          ) {
            if (
              input.snapshotStatus === "succeeded"
              && (failurePoint === "persistent_after" || !injected)
            ) {
              injected = true;
              if (failurePoint === "after" || failurePoint === "persistent_after") {
                await baseWorkspaceStore.settleLifecycle(input);
              }
              throw new Error("private Workspace commit failure");
            }
            return baseWorkspaceStore.settleLifecycle(input);
          },
        };
        const bus = new KernelEventBus();
        const service = createChatService({
          chatClient: { async complete() { return chatReply("unused"); } },
          getModelProfile: createCompleteProfile,
          memoryStore: createMemoryStore(),
          chatSessionStore: createChatSessionStore([]),
          conversationCausalStore: causalStore,
          workspaceService: {
            async resolveRunContext() {
              return buildPrimaryRunContext({
                workspaceId: `workspace_commit_${failurePoint}`,
                workspaceRoot: `/workspace/commit-${failurePoint}`,
              });
            },
          },
          workspaceRunStore: workspaceStore,
          toolExecutor: createToolExecutor(),
          productionKernelDriver: createProductionKernelDriver({ bus }),
          async runAgentLoop(messages) {
            return {
              status: "succeeded",
              summary: "recover the Workspace commit",
              turns: 1,
              messages,
              toolCallsExecuted: 0,
            };
          },
        });
        const requestId = `workspace_commit_${failurePoint}_request`;
        const sessionId = `workspace_commit_${failurePoint}_session`;

        await expect(service.sendMessage({
          sessionId,
          requestId,
          message: "commit Workspace exactly once",
          workspaceId: `workspace_commit_${failurePoint}`,
        })).resolves.toMatchObject({ ok: true, turnSettlementStatus: "succeeded" });
        expect(bus.history().at(-1)).toMatchObject({
          type: "run_end",
          status: "succeeded",
        });
        await expect(causalStore.getRequest(requestId)).resolves.toMatchObject({
          attempts: [{
            state: "accepted",
            assistantAcceptance: { state: "committed" },
          }],
        });
        await expect(baseWorkspaceStore.getRun(
          `chat_run_${sessionId}_${requestId}`,
        )).resolves.toMatchObject({ status: "succeeded" });
      } finally {
        await rm(configDir, { recursive: true, force: true });
      }
    },
  );

  it.each(["before", "after"] as const)(
    "recovers a one-shot causal acceptance commit throw %s the authoritative write",
    async (failurePoint) => {
      const configDir = await mkdtemp(path.join(os.tmpdir(), "chat-causal-commit-once-"));
      try {
        const causalStore = createConversationCausalStore({
          configDir: path.join(configDir, "causal"),
        });
        const workspaceStore = createWorkspaceRunStore({
          configDir: path.join(configDir, "workspace"),
        });
        let injected = false;
        const causalWithFault = {
          ...causalStore,
          async commitAssistantAcceptance(
            input: Parameters<typeof causalStore.commitAssistantAcceptance>[0],
          ) {
            if (!injected) {
              injected = true;
              if (failurePoint === "after") {
                await causalStore.commitAssistantAcceptance(input);
              }
              throw new Error("private one-shot causal commit failure");
            }
            return causalStore.commitAssistantAcceptance(input);
          },
        };
        const bus = new KernelEventBus();
        const requestId = `causal_commit_${failurePoint}_request`;
        const sessionId = `causal_commit_${failurePoint}_session`;
        const service = createChatService({
          chatClient: { async complete() { return chatReply("unused"); } },
          getModelProfile: createCompleteProfile,
          memoryStore: createMemoryStore(),
          chatSessionStore: createChatSessionStore([]),
          conversationCausalStore: causalWithFault,
          workspaceService: {
            async resolveRunContext() {
              return buildPrimaryRunContext({
                workspaceId: `workspace_causal_commit_${failurePoint}`,
                workspaceRoot: `/workspace/causal-commit-${failurePoint}`,
              });
            },
          },
          workspaceRunStore: workspaceStore,
          toolExecutor: createToolExecutor(),
          productionKernelDriver: createProductionKernelDriver({ bus }),
          async runAgentLoop(messages) {
            return {
              status: "succeeded",
              summary: "recover the causal commit",
              turns: 1,
              messages,
              toolCallsExecuted: 0,
            };
          },
        });

        await expect(service.sendMessage({
          sessionId,
          requestId,
          message: "commit causal acceptance exactly once",
          workspaceId: `workspace_causal_commit_${failurePoint}`,
        })).resolves.toMatchObject({ ok: true, turnSettlementStatus: "succeeded" });
        expect(bus.history().at(-1)).toMatchObject({
          type: "run_end",
          status: "succeeded",
        });
        await expect(causalStore.getRequest(requestId)).resolves.toMatchObject({
          attempts: [{
            state: "accepted",
            assistantAcceptance: { state: "committed" },
          }],
        });
        await expect(workspaceStore.getRun(
          `chat_run_${sessionId}_${requestId}`,
        )).resolves.toMatchObject({ status: "succeeded" });
      } finally {
        await rm(configDir, { recursive: true, force: true });
      }
    },
  );

  it("treats post-commit token metering failure as a non-authoritative derivative", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "chat-post-commit-metering-"));
    try {
      const causalStore = createConversationCausalStore({
        configDir: path.join(configDir, "causal"),
      });
      const workspaceStore = createWorkspaceRunStore({
        configDir: path.join(configDir, "workspace"),
      });
      const baseChatStore = createChatSessionStore([]);
      const chatStore = {
        ...baseChatStore,
        async addTokenUsage() {
          throw new Error("private post-commit metering failure");
        },
      };
      const bus = new KernelEventBus();
      const service = createChatService({
        chatClient: { async complete() { return chatReply("unused"); } },
        getModelProfile: createCompleteProfile,
        memoryStore: createMemoryStore(),
        chatSessionStore: chatStore,
        conversationCausalStore: causalStore,
        workspaceService: {
          async resolveRunContext() {
            return buildPrimaryRunContext({
              workspaceId: "workspace_post_commit_metering",
              workspaceRoot: "/workspace/post-commit-metering",
            });
          },
        },
        workspaceRunStore: workspaceStore,
        toolExecutor: createToolExecutor(),
        productionKernelDriver: createProductionKernelDriver({ bus }),
        async runAgentLoop(messages) {
          return {
            status: "succeeded",
            summary: "accepted despite derivative failure",
            turns: 1,
            messages,
            toolCallsExecuted: 0,
          };
        },
      });
      const requestId = "post_commit_metering_request";
      const sessionId = "post_commit_metering_session";

      await expect(service.sendMessage({
        sessionId,
        requestId,
        message: "meter only after commit",
        workspaceId: "workspace_post_commit_metering",
      })).resolves.toMatchObject({ ok: true, turnSettlementStatus: "succeeded" });
      expect(bus.history().at(-1)).toMatchObject({
        type: "run_end",
        status: "succeeded",
      });
      await expect(causalStore.getRequest(requestId)).resolves.toMatchObject({
        attempts: [{ state: "accepted" }],
      });
      await expect(workspaceStore.getRun(
        `chat_run_${sessionId}_${requestId}`,
      )).resolves.toMatchObject({ status: "succeeded" });
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("keeps Kernel reconciliation-only when causal commit stays unavailable after Workspace success, then completes on restart replay", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "chat-causal-commit-restart-"));
    try {
      const causalDir = path.join(configDir, "causal");
      const workspaceDir = path.join(configDir, "workspace");
      const causalStore = createConversationCausalStore({ configDir: causalDir });
      const workspaceStore = createWorkspaceRunStore({ configDir: workspaceDir });
      const chatStore = createChatSessionStore([]);
      const firstBus = new KernelEventBus();
      const firstStatusEvents: ChatTaskStatusEvent[] = [];
      const firstStreamEvents: ChatStreamEvent[] = [];
      let firstModelCalls = 0;
      const firstService = createChatService({
        chatClient: { async complete() { return chatReply("unused"); } },
        getModelProfile: createCompleteProfile,
        memoryStore: createMemoryStore(),
        chatSessionStore: chatStore,
        conversationCausalStore: {
          ...causalStore,
          async commitAssistantAcceptance() {
            throw new Error("private persistent causal commit failure");
          },
        },
        workspaceService: {
          async resolveRunContext() {
            return buildPrimaryRunContext({
              workspaceId: "workspace_causal_commit_restart",
              workspaceRoot: "/workspace/causal-commit-restart",
            });
          },
        },
        workspaceRunStore: workspaceStore,
        toolExecutor: createToolExecutor(),
        productionKernelDriver: createProductionKernelDriver({ bus: firstBus }),
        async runAgentLoop(messages) {
          firstModelCalls += 1;
          return {
            status: "succeeded",
            summary: "durable reply awaiting causal commit",
            turns: 1,
            messages,
            toolCallsExecuted: 0,
          };
        },
      });
      const input = {
        sessionId: "causal_commit_restart_session",
        requestId: "causal_commit_restart_request",
        message: "commit after restart",
        workspaceId: "workspace_causal_commit_restart",
      };

      await expect(firstService.sendMessage(input, {
        onStatusEvent: (event) => firstStatusEvents.push(event),
        onStreamEvent: (event) => firstStreamEvents.push(event),
      })).resolves.toMatchObject({
        ok: false,
        code: "CONFLICT",
        turnSettlementStatus: "unknown",
      });
      expect(firstBus.history().at(-1)).toMatchObject({
        type: "run_end",
        status: "paused",
      });
      expect(firstStatusEvents.some((event) =>
        event.state === "completed"
        || event.state === "failed"
        || event.state === "canceled",
      )).toBe(false);
      expect(firstStreamEvents.some((event) =>
        event.type === "attempt_control" && event.operation === "accepted",
      )).toBe(false);
      const workspaceRunId =
        "chat_run_causal_commit_restart_session_causal_commit_restart_request";
      await expect(workspaceStore.getRun(workspaceRunId)).resolves.toMatchObject({
        status: "succeeded",
      });
      await expect(causalStore.getRequest(input.requestId)).resolves.toMatchObject({
        attempts: [{
          state: "active",
          assistantAcceptance: { state: "preparing" },
        }],
      });

      const reopenedCausalStore = createConversationCausalStore({ configDir: causalDir });
      const reopenedWorkspaceStore = createWorkspaceRunStore({ configDir: workspaceDir });
      await expect(reopenedCausalStore.interruptActiveAttempts()).resolves.toBe(0);
      const replayBus = new KernelEventBus();
      let replayModelCalls = 0;
      const replayService = createChatService({
        chatClient: { async complete() { return chatReply("unused"); } },
        getModelProfile: createCompleteProfile,
        memoryStore: createMemoryStore(),
        chatSessionStore: chatStore,
        conversationCausalStore: reopenedCausalStore,
        workspaceRunStore: reopenedWorkspaceStore,
        toolExecutor: createToolExecutor(),
        productionKernelDriver: createProductionKernelDriver({ bus: replayBus }),
        async runAgentLoop(messages) {
          replayModelCalls += 1;
          return {
            status: "succeeded",
            summary: "must not rerun",
            turns: 1,
            messages,
            toolCallsExecuted: 0,
          };
        },
      });
      await expect(replayService.sendMessage(input)).resolves.toMatchObject({
        ok: true,
        reply: "durable reply awaiting causal commit",
        turnSettlementStatus: "succeeded",
      });
      expect(firstModelCalls).toBe(1);
      expect(replayModelCalls).toBe(0);
      expect(replayBus.history()).toEqual([]);
      await expect(reopenedCausalStore.getRequest(input.requestId)).resolves.toMatchObject({
        attempts: [{
          state: "accepted",
          assistantAcceptance: { state: "committed" },
        }],
      });
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("does not fabricate Workspace success when success and failure compensation writes both fail", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "chat-workspace-compensation-fail-"));
    try {
      const causalStore = createConversationCausalStore({
        configDir: path.join(configDir, "causal"),
      });
      const baseWorkspaceStore = createWorkspaceRunStore({
        configDir: path.join(configDir, "workspace"),
      });
      const workspaceStore = {
        ...baseWorkspaceStore,
        async settleLifecycle(
          input: Parameters<WorkspaceRunStore["settleLifecycle"]>[0],
        ) {
          if (input.snapshotStatus === "succeeded" || input.snapshotStatus === "failed") {
            throw new Error("private Workspace terminal authority failure");
          }
          return baseWorkspaceStore.settleLifecycle(input);
        },
      };
      const bus = new KernelEventBus();
      const service = createChatService({
        chatClient: { async complete() { return chatReply("unused"); } },
        getModelProfile: createCompleteProfile,
        memoryStore: createMemoryStore(),
        chatSessionStore: createChatSessionStore([]),
        conversationCausalStore: causalStore,
        workspaceService: {
          async resolveRunContext() {
            return buildPrimaryRunContext({
              workspaceId: "workspace_compensation_failure",
              workspaceRoot: "/workspace/compensation-failure",
            });
          },
        },
        workspaceRunStore: workspaceStore,
        toolExecutor: createToolExecutor(),
        productionKernelDriver: createProductionKernelDriver({ bus }),
        async runAgentLoop(messages) {
          return {
            status: "succeeded",
            summary: "must fail without false success",
            turns: 1,
            messages,
            toolCallsExecuted: 0,
          };
        },
      });
      const requestId = "workspace_compensation_failure_request";
      const sessionId = "workspace_compensation_failure_session";

      await expect(service.sendMessage({
        sessionId,
        requestId,
        message: "fail both terminal writes",
        workspaceId: "workspace_compensation_failure",
      })).resolves.toMatchObject({ ok: false });
      expect(bus.history().at(-1)).toMatchObject({
        type: "run_end",
        status: "failed",
      });
      await expect(baseWorkspaceStore.getRun(
        `chat_run_${sessionId}_${requestId}`,
      )).resolves.toMatchObject({ status: "running" });
      const causal = await causalStore.getRequest(requestId);
      expect(causal?.attempts.at(-1)).not.toMatchObject({ state: "accepted" });
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("isolates concurrent Kernel runs even when routing ids sanitize identically", async () => {
    const bus = new KernelEventBus();
    const bothStarted = createDeferred<void>();
    let started = 0;
    const service = createChatService({
      chatClient: { async complete() { return chatReply("unused"); } },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: createChatSessionStore([]),
      toolExecutor: createToolExecutor(),
      productionKernelDriver: createProductionKernelDriver({ bus }),
      async runAgentLoop(messages) {
        started += 1;
        if (started === 2) bothStarted.resolve();
        await bothStarted.promise;
        return {
          status: "succeeded" as const,
          summary: `done:${messages.at(-1)?.content ?? ""}`,
          turns: 1,
          messages,
          toolCallsExecuted: 0,
        };
      },
      createId: createSequentialId("kernel_collision"),
    });

    const results = await Promise.all([
      service.sendMessage({
        sessionId: "s:a",
        requestId: "r:a",
        message: "first",
      }),
      service.sendMessage({
        sessionId: "s/a",
        requestId: "r/a",
        message: "second",
      }),
    ]);
    expect(results).toEqual([
      expect.objectContaining({ ok: true, reply: "done:first" }),
      expect.objectContaining({ ok: true, reply: "done:second" }),
    ]);
    const runEnds = bus.history().filter((event) => event.type === "run_end");
    expect(runEnds).toHaveLength(2);
    expect(new Set(runEnds.map((event) => event.runId)).size).toBe(2);
    expect(runEnds.every((event) => /^chat_kernel_[0-9a-f]{64}$/.test(event.runId)))
      .toBe(true);
  });

  it("keeps a completed Chat settlement when cancellation arrives after assistant persistence", async () => {
    const controller = new AbortController();
    const bus = new KernelEventBus();
    const storedMessages: AppendChatMessageInput[] = [];
    const streamEvents: ChatStreamEvent[] = [];
    const baseStore = createChatSessionStore(storedMessages);
    const store = {
      ...baseStore,
      async appendMessage(input: AppendChatMessageInput) {
        const result = await baseStore.appendMessage(input);
        if (input.role === "assistant") {
          controller.abort(new Error("late cancellation"));
        }
        return result;
      },
    };
    const service = createChatService({
      chatClient: {
        async complete() {
          return chatReply("unused");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: store,
      toolExecutor: createToolExecutor(),
      productionKernelDriver: createProductionKernelDriver({ bus }),
      async runAgentLoop(messages) {
        return {
          status: "succeeded",
          summary: "Committed Chat reply.",
          turns: 1,
          messages,
          toolCallsExecuted: 0,
        };
      },
    });

    await expect(
      service.sendMessage(
        {
          sessionId: "kernel_late_cancel_session",
          requestId: "kernel_late_cancel_request",
          message: "commit before cancellation",
        },
        {
          signal: controller.signal,
          onStreamEvent: (event) => streamEvents.push(event),
        },
      ),
    ).resolves.toMatchObject({
      ok: true,
      reply: "Committed Chat reply.",
    });

    expect(
      storedMessages.filter((message) => message.role === "assistant"),
    ).toHaveLength(1);
    expect(
      streamEvents.filter((event) =>
        ["completed", "failed", "canceled"].includes(event.type),
      ),
    ).toEqual([
      expect.objectContaining({ type: "completed" }),
    ]);
    expect(bus.history().at(-1)).toMatchObject({
      type: "run_end",
      status: "succeeded",
    });
  });

  it("persists paused continuation before Chat Kernel run_end", async () => {
    const lifecycle: string[] = [];
    const bus = new KernelEventBus();
    bus.subscribe((event) => {
      if (event.type === "run_end") lifecycle.push("run_end");
    });
    const storedMessages: AppendChatMessageInput[] = [];
    const baseStore = createChatSessionStore(storedMessages);
    const store = {
      ...baseStore,
      async appendActivityEvent(
        sessionId: string,
        event: ChatTaskStatusEvent,
      ) {
        if (event.state === "paused") lifecycle.push("continuation_persisted");
        return baseStore.appendActivityEvent(sessionId, event);
      },
    };
    const service = createChatService({
      chatClient: {
        async complete() {
          return chatReply("unused");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: store,
      toolExecutor: createToolExecutor(),
      productionKernelDriver: createProductionKernelDriver({ bus }),
      async runAgentLoop(messages) {
        return {
          status: "paused",
          summary: "Paused for review.",
          turns: 1,
          messages,
          toolCallsExecuted: 0,
          continuation: {
            reason: "tool_failure_loop",
            maxTurns: 8,
            toolCallsExecuted: 0,
          },
        };
      },
    });

    await expect(
      service.sendMessage({
        sessionId: "kernel_pause_session",
        requestId: "kernel_pause_request",
        message: "pause",
      }),
    ).resolves.toMatchObject({
      ok: true,
      agentStatus: { state: "paused" },
    });
    expect(lifecycle).toContain("continuation_persisted");
    expect(lifecycle.at(-1)).toBe("run_end");
    expect(bus.history().at(-1)).toMatchObject({
      type: "run_end",
      status: "paused",
    });
  });

  it("replays a durable paused assistant without promoting Workspace or Kernel", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "chat-paused-replay-"));
    try {
      const bus = new KernelEventBus();
      const workspaceEvents: WorkspaceRunEventInput[] = [];
      const workspaceFinishes: Array<{
        workspaceRunId: string;
        status: WorkspaceRunTerminalStatus;
        summary?: string;
      }> = [];
      const workspaceStore = createMemoryWorkspaceRunStore({
        creates: [],
        events: workspaceEvents,
        finishes: workspaceFinishes,
      });
      let modelCalls = 0;
      const service = createChatService({
        chatClient: { async complete() { return chatReply("unused"); } },
        getModelProfile: createCompleteProfile,
        memoryStore: createMemoryStore(),
        chatSessionStore: createChatSessionStore([]),
        conversationCausalStore: createConversationCausalStore({ configDir }),
        workspaceService: {
          async resolveRunContext() {
            return buildPrimaryRunContext({
              workspaceId: "workspace_paused_replay",
              workspaceRoot: "/workspace/paused-replay",
            });
          },
        },
        workspaceRunStore: workspaceStore,
        toolExecutor: createToolExecutor(),
        productionKernelDriver: createProductionKernelDriver({ bus }),
        async runAgentLoop(messages) {
          modelCalls += 1;
          return {
            status: "paused",
            summary: "Paused durable answer.",
            turns: 1,
            messages,
            toolCallsExecuted: 0,
            continuation: {
              reason: "tool_failure_loop",
              maxTurns: 8,
              toolCallsExecuted: 0,
            },
          };
        },
      });
      const input = {
        sessionId: "paused_replay_session",
        requestId: "paused_replay_request",
        message: "pause and replay",
        workspaceId: "workspace_paused_replay",
      };

      await expect(service.sendMessage(input)).resolves.toMatchObject({
        ok: true,
        turnSettlementStatus: "paused",
      });
      await expect(service.sendMessage(input)).resolves.toMatchObject({
        ok: true,
        turnSettlementStatus: "paused",
        reply: "Paused durable answer.",
      });
      expect(modelCalls).toBe(1);
      expect(workspaceFinishes).toEqual([]);
      expect(workspaceEvents).not.toContainEqual(expect.objectContaining({
        type: "status",
        status: "succeeded",
      }));
      expect(bus.history().filter((event) => event.type === "run_end"))
        .toEqual(expect.arrayContaining([
          expect.objectContaining({ status: "paused" }),
          expect.objectContaining({ status: "paused" }),
        ]));
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("rejects revival of a durable failed assistant without promoting Workspace or Kernel", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "chat-failed-replay-"));
    try {
      const bus = new KernelEventBus();
      const workspaceEvents: WorkspaceRunEventInput[] = [];
      const workspaceFinishes: Array<{
        workspaceRunId: string;
        status: WorkspaceRunTerminalStatus;
        summary?: string;
      }> = [];
      const workspaceStore = createMemoryWorkspaceRunStore({
        creates: [],
        events: workspaceEvents,
        finishes: workspaceFinishes,
      });
      const causalStore = createConversationCausalStore({ configDir });
      let modelCalls = 0;
      const service = createChatService({
        chatClient: { async complete() { return chatReply("unused"); } },
        getModelProfile: createCompleteProfile,
        memoryStore: createMemoryStore(),
        chatSessionStore: createChatSessionStore([]),
        conversationCausalStore: causalStore,
        workspaceService: {
          async resolveRunContext() {
            return buildPrimaryRunContext({
              workspaceId: "workspace_failed_replay",
              workspaceRoot: "/workspace/failed-replay",
            });
          },
        },
        workspaceRunStore: workspaceStore,
        toolExecutor: createToolExecutor(),
        productionKernelDriver: createProductionKernelDriver({ bus }),
        async runAgentLoop(messages) {
          modelCalls += 1;
          return {
            status: "failed",
            summary: "Durable failed answer.",
            turns: 1,
            messages,
            toolCallsExecuted: 0,
          };
        },
      });
      const input = {
        sessionId: "failed_replay_session",
        requestId: "failed_replay_request",
        message: "fail and replay",
        workspaceId: "workspace_failed_replay",
      };

      await expect(service.sendMessage(input)).resolves.toMatchObject({
        ok: true,
        turnSettlementStatus: "failed",
      });
      await expect(service.sendMessage(input)).resolves.toMatchObject({
        ok: false,
        code: "CONFLICT",
        message: "已持久化回复与因果收据冲突，未重放执行。",
      });
      expect(modelCalls).toBe(1);
      await expect(causalStore.getRequest(input.requestId)).resolves.toMatchObject({
        attempts: [expect.objectContaining({ state: "active" })],
        requiredSettlements: [expect.objectContaining({
          state: "committed",
          targetState: "failed",
        })],
      });
      expect(workspaceFinishes).not.toContainEqual(expect.objectContaining({
        status: "succeeded",
      }));
      expect(workspaceEvents).not.toContainEqual(expect.objectContaining({
        type: "status",
        status: "succeeded",
      }));
      expect(bus.history().filter((event) => event.type === "run_end"))
        .toEqual([expect.objectContaining({ status: "failed" })]);
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("keeps a succeeded durable assistant read-only when its required settlement failed", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "chat-failed-settlement-fence-"));
    try {
      const requestId = "failed_settlement_fence_request";
      const sessionId = "failed_settlement_fence_session";
      const turnId = `turn-${requestId}`;
      const input = {
        sessionId,
        requestId,
        message: "do not promote the failed settlement",
      };
      const chatStore = createChatSessionStore([]);
      const user = await chatStore.appendMessage({
        sessionId,
        requestId,
        role: "user",
        content: input.message,
      });
      await chatStore.appendMessage({
        sessionId,
        requestId,
        turnId,
        causalAttempt: 1,
        causalAttemptId: createConversationCausalAttemptId({
          requestId,
          turnId,
          attempt: 1,
        }),
        role: "assistant",
        content: "durable but not accepted",
        turnSettlementStatus: "succeeded",
      });
      const causalStore = createConversationCausalStore({ configDir });
      await causalStore.claimRequest({
        requestId,
        turnId,
        inputFingerprint: createChatRequestClaimFingerprint({
          input,
          userMessage: input.message,
          validatedAttachments: [],
        }),
      });
      await causalStore.bindRequest({
        requestId,
        sessionId,
        userMessageId: user.message.id,
      });
      await causalStore.beginAttempt({ requestId, attempt: 1 });
      await causalStore.beginRequiredSettlement({
        requestId,
        id: "settlement:synthetic-failed-fence",
        attempt: 1,
        sourceSequence: 1,
        targetState: "paused",
        requiredDomains: ["chat"],
        preparedChatEventFingerprint: "4".repeat(64),
      });
      await causalStore.settleRequiredSettlement({
        requestId,
        id: "settlement:synthetic-failed-fence",
        state: "failed",
        failureCode: "CHAT_SETTLEMENT_FAILED",
      });
      let modelCalls = 0;
      const service = createChatService({
        chatClient: {
          async complete() {
            modelCalls += 1;
            return chatReply("must not run");
          },
        },
        getModelProfile: createCompleteProfile,
        memoryStore: createMemoryStore(),
        chatSessionStore: chatStore,
        conversationCausalStore: causalStore,
      });

      await expect(service.sendMessage(input)).resolves.toMatchObject({
        ok: false,
        code: "CONFLICT",
        message: "已持久化回复与因果收据冲突，未重放执行。",
      });
      expect(modelCalls).toBe(0);
      await expect(causalStore.getRequest(requestId)).resolves.toMatchObject({
        attempts: [expect.objectContaining({ attempt: 1, state: "active" })],
        requiredSettlements: [expect.objectContaining({
          state: "failed",
          targetState: "paused",
        })],
        coverage: { state: "complete", reasonCodes: [] },
      });
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("keeps a legacy assistant without an accepted receipt read-only", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "chat-legacy-settlement-"));
    try {
      const requestId = "legacy_settlement_request";
      const sessionId = "legacy_settlement_session";
      const chatStore = createChatSessionStore([]);
      const user = await chatStore.appendMessage({
        sessionId,
        requestId,
        role: "user",
        content: "legacy durable request",
      });
      await chatStore.appendMessage({
        sessionId,
        requestId,
        role: "assistant",
        content: "legacy durable answer",
      });
      const causalStateDir = path.join(configDir, "conversation-causal");
      await mkdir(causalStateDir, { recursive: true });
      await writeFile(path.join(causalStateDir, "state.json"), JSON.stringify({
        schemaVersion: 1,
        records: [{
          schemaVersion: 1,
          requestId,
          turnId: `turn-${requestId}`,
          sessionId,
          userMessageId: user.message.id,
          inputFingerprint: createLegacyChatRequestClaimFingerprint({
            input: { message: "legacy durable request" },
            userMessage: "legacy durable request",
            validatedAttachments: [],
          }),
          revision: 1,
          attempts: [],
          refs: [{
            kind: "workspace_run",
            id: `chat_run_${sessionId}_${requestId}`,
          }],
          coverage: { state: "complete", reasonCodes: [] },
          createdAt: "2026-08-18T00:00:00.000Z",
          updatedAt: "2026-08-18T00:00:00.000Z",
        }],
        approvals: [],
      }), "utf8");
      const causalStore = createConversationCausalStore({ configDir });
      const workspaceFinishes: Array<{
        workspaceRunId: string;
        status: WorkspaceRunTerminalStatus;
        summary?: string;
      }> = [];
      const workspaceStore = createMemoryWorkspaceRunStore({
        creates: [],
        events: [],
        finishes: workspaceFinishes,
      });
      await workspaceStore.ensureRun({
        workspaceRunId: `chat_run_${sessionId}_${requestId}`,
        sessionId,
        requestId,
      });
      let modelCalls = 0;
      const bus = new KernelEventBus();
      let capturedSettlement: ChatKernelSettlement<unknown> | undefined;
      const baseKernelDriver = createProductionKernelDriver({ bus });
      const capturingKernelDriver: ProductionKernelDriver = {
        async run<TSegment extends ProductionKernelSegment>(
          runInput: ProductionKernelRunInput<TSegment>,
        ) {
          const outcome = await baseKernelDriver.run(runInput);
          capturedSettlement = outcome.segment as unknown as ChatKernelSettlement<unknown>;
          return outcome;
        },
      };
      const service = createChatService({
        chatClient: {
          async complete() {
            modelCalls += 1;
            return chatReply("must not run");
          },
        },
        getModelProfile: createCompleteProfile,
        memoryStore: createMemoryStore(),
        chatSessionStore: chatStore,
        conversationCausalStore: causalStore,
        workspaceRunStore: workspaceStore,
        productionKernelDriver: capturingKernelDriver,
      });

      await expect(service.sendMessage({
        sessionId,
        requestId,
        message: "legacy durable request",
      })).resolves.toMatchObject({
        ok: false,
        code: "CONFLICT",
        message: expect.stringContaining("缺少可验证的尝试归属"),
      });
      expect(modelCalls).toBe(0);
      expect(workspaceFinishes).toEqual([]);
      await expect(causalStore.getRequest(requestId)).resolves.toMatchObject({
        coverage: {
          state: "degraded",
          reasonCodes: expect.arrayContaining([
            "legacy_request_fingerprint",
            "assistant_attempt_witness_missing",
          ]),
        },
        refs: expect.arrayContaining([
          expect.objectContaining({ kind: "workspace_run" }),
        ]),
      });
      expect(bus.history().filter((event) => event.type === "run_end"))
        .toEqual([]);
      expect(capturedSettlement).toBeUndefined();
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("rejects invalid input before creating Kernel or causal runtime facts", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "chat-kernel-preflight-"));
    try {
      const causalStore = createConversationCausalStore({ configDir });
      const bus = new KernelEventBus();
      let modelCalls = 0;
      const service = createChatService({
        chatClient: {
          async complete() {
            modelCalls += 1;
            return chatReply("must not run");
          },
        },
        getModelProfile: createCompleteProfile,
        memoryStore: createMemoryStore(),
        chatSessionStore: createChatSessionStore([]),
        conversationCausalStore: causalStore,
        productionKernelDriver: createProductionKernelDriver({ bus }),
      });

      await expect(service.sendMessage({
        requestId: "preflight_empty_request",
        message: "   ",
      })).resolves.toEqual({
        ok: false,
        code: "EMPTY_MESSAGE",
        message: "消息不能为空。",
      });
      await expect(service.sendMessage({
        requestId: "preflight_attachment_request",
        message: "inspect invalid attachment",
        attachments: [{
          id: "invalid_attachment",
          name: "invalid.txt",
          mediaType: "text/plain",
          size: 1,
          kind: "text",
          dataBase64: "not-base64",
        }],
      })).resolves.toMatchObject({
        ok: false,
        message: expect.stringContaining("附件数据格式无效"),
      });

      expect(modelCalls).toBe(0);
      expect(bus.history()).toEqual([]);
      await expect(causalStore.getRequest("preflight_empty_request"))
        .resolves.toBeNull();
      await expect(causalStore.getRequest("preflight_attachment_request"))
        .resolves.toBeNull();
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("rechecks cancellation after asynchronous preflight before claiming or entering Kernel", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "chat-kernel-preflight-abort-"));
    try {
      const causalStore = createConversationCausalStore({ configDir });
      const bus = new KernelEventBus();
      const routingStarted = createDeferred<void>();
      const routingResult = createDeferred<PlanRecord | null>();
      const controller = new AbortController();
      let modelCalls = 0;
      const service = createChatService({
        chatClient: {
          async complete() {
            modelCalls += 1;
            return chatReply("must not run");
          },
        },
        getModelProfile: createCompleteProfile,
        memoryStore: createMemoryStore(),
        chatSessionStore: createChatSessionStore([]),
        conversationCausalStore: causalStore,
        productionKernelDriver: createProductionKernelDriver({ bus }),
        planService: {
          async createPlan() {
            throw new Error("must not create a Plan");
          },
          async getInputRoutingPlan() {
            routingStarted.resolve();
            return routingResult.promise;
          },
          async continueWithInput() {
            throw new Error("must not continue a Plan");
          },
        },
      });
      const requestId = "preflight_abort_request";
      const resultPromise = service.sendMessage(
        {
          sessionId: "preflight_abort_session",
          requestId,
          message: "stop while routing is loading",
        },
        { signal: controller.signal },
      );
      await routingStarted.promise;
      controller.abort();
      routingResult.resolve(null);

      await expect(resultPromise).resolves.toMatchObject({
        ok: false,
        code: "CANCELED",
      });
      expect(modelCalls).toBe(0);
      expect(bus.history()).toEqual([]);
      await expect(causalStore.getRequest(requestId)).resolves.toBeNull();
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("requires Kernel causal refs to commit before run admission", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "chat-kernel-ref-gate-"));
    try {
      const requestId = "kernel_ref_failure_request";
      const causalStore = createConversationCausalStore({ configDir });
      const failingStore = {
        ...causalStore,
        async addRefs() {
          throw new Error("causal ref persistence failed");
        },
      };
      const bus = new KernelEventBus();
      let modelCalls = 0;
      const service = createChatService({
        chatClient: {
          async complete() {
            modelCalls += 1;
            return chatReply("must not run");
          },
        },
        getModelProfile: createCompleteProfile,
        memoryStore: createMemoryStore(),
        chatSessionStore: createChatSessionStore([]),
        conversationCausalStore: failingStore,
        productionKernelDriver: createProductionKernelDriver({ bus }),
      });

      await expect(service.sendMessage({
        requestId,
        message: "ref must exist before Kernel",
      })).rejects.toThrow("causal ref persistence failed");
      expect(modelCalls).toBe(0);
      expect(bus.history()).toEqual([]);
      await expect(causalStore.getRequest(requestId)).resolves.toMatchObject({
        refs: [],
      });
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("does not adopt a caller session assistant for an unbound causal claim", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "chat-kernel-foreign-replay-"));
    try {
      const requestId = "unbound_foreign_request";
      const message = "execute the claimed input only";
      const causalStore = createConversationCausalStore({ configDir });
      await causalStore.claimRequest({
        requestId,
        turnId: `turn-${requestId}`,
        inputFingerprint: createChatRequestClaimFingerprint({
          input: { message },
          userMessage: message,
          validatedAttachments: [],
        }),
      });
      const chatStore = createChatSessionStore([]);
      const foreignSessionId = "foreign_request_session";
      await chatStore.appendMessage({
        sessionId: foreignSessionId,
        requestId,
        role: "user",
        content: "different foreign input",
      });
      await chatStore.appendMessage({
        sessionId: foreignSessionId,
        requestId,
        role: "assistant",
        content: "foreign durable answer",
      });
      const bus = new KernelEventBus();
      let modelCalls = 0;
      const service = createChatService({
        chatClient: {
          async complete() {
            modelCalls += 1;
            return chatReply("must not run");
          },
        },
        getModelProfile: createCompleteProfile,
        memoryStore: createMemoryStore(),
        chatSessionStore: chatStore,
        conversationCausalStore: causalStore,
        productionKernelDriver: createProductionKernelDriver({ bus }),
      });

      await expect(service.sendMessage({
        sessionId: foreignSessionId,
        requestId,
        message,
      })).resolves.toMatchObject({ ok: false, retryable: true });
      expect(modelCalls).toBe(0);
      const record = await causalStore.getRequest(requestId);
      expect(record).toMatchObject({ attempts: [] });
      expect(record?.sessionId).toBeUndefined();
      expect(bus.history().filter((event) => event.type === "run_end"))
        .toHaveLength(0);
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("does not bind or execute when causal storage exists without Chat persistence", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "chat-kernel-no-chat-store-"));
    try {
      const requestId = "no_chat_store_request";
      const message = "durability is required before execution";
      const causalStore = createConversationCausalStore({ configDir });
      const bus = new KernelEventBus();
      let modelCalls = 0;
      const service = createChatService({
        chatClient: {
          async complete() {
            modelCalls += 1;
            return chatReply("must not run");
          },
        },
        getModelProfile: createCompleteProfile,
        memoryStore: createMemoryStore(),
        conversationCausalStore: causalStore,
        productionKernelDriver: createProductionKernelDriver({ bus }),
      });

      for (let attempt = 0; attempt < 2; attempt += 1) {
        await expect(service.sendMessage({
          sessionId: "routing_only",
          requestId,
          message,
        })).resolves.toMatchObject({ ok: false, retryable: true });
      }
      expect(modelCalls).toBe(0);
      const runEndIds = bus.history().flatMap((event) =>
        event.type === "run_end" ? [event.runId] : [],
      );
      const record = await causalStore.getRequest(requestId);
      const refIds = record?.refs.flatMap((ref) =>
        ref.kind === "kernel_run" ? [ref.id] : [],
      ) ?? [];
      expect(record?.sessionId).toBeUndefined();
      expect(runEndIds).toHaveLength(0);
      expect([...refIds].sort()).toEqual([...runEndIds].sort());
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("settles unbound duplicate claims without adopting caller routing sessions", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "chat-kernel-unbound-"));
    try {
      const requestId = "unbound_duplicate_request";
      const message = "do not bind this request to caller routing";
      const causalStore = createConversationCausalStore({ configDir });
      await causalStore.claimRequest({
        requestId,
        turnId: `turn-${requestId}`,
        inputFingerprint: createChatRequestClaimFingerprint({
          input: { message },
          userMessage: message,
          validatedAttachments: [],
        }),
      });
      const chatStore = createChatSessionStore([]);
      await chatStore.appendMessage({
        sessionId: "existing_unrelated_caller",
        requestId: "unrelated_request",
        role: "user",
        content: "unrelated durable session",
      });
      const bus = new KernelEventBus();
      const streamEvents: ChatStreamEvent[] = [];
      let modelCalls = 0;
      const service = createChatService({
        chatClient: {
          async complete() {
            modelCalls += 1;
            return chatReply("must not run");
          },
        },
        getModelProfile: createCompleteProfile,
        memoryStore: createMemoryStore(),
        chatSessionStore: chatStore,
        conversationCausalStore: causalStore,
        productionKernelDriver: createProductionKernelDriver({ bus }),
      });

      for (const sessionId of ["missing_caller", "existing_unrelated_caller"]) {
        await expect(service.sendMessage(
          { sessionId, requestId, message },
          { onStreamEvent: (event) => streamEvents.push(event) },
        )).resolves.toMatchObject({
          ok: false,
          retryable: true,
        });
      }

      expect(modelCalls).toBe(0);
      await expect(chatStore.get("missing_caller")).resolves.toBeNull();
      await expect(chatStore.get("existing_unrelated_caller")).resolves.not.toMatchObject({
        activity: {
          statusEvents: expect.arrayContaining([
            expect.objectContaining({ requestId }),
          ]),
        },
      });
      expect(streamEvents).toEqual([]);
      const routeOnlyEvents = streamEvents.filter(
        (event) => event.requestId === requestId,
      );
      expect(routeOnlyEvents).toEqual([]);
      expect(
        routeOnlyEvents.every((event) => event.domainStateAvailable === false),
      ).toBe(true);
      const runEndIds = bus.history().flatMap((event) =>
        event.type === "run_end" ? [event.runId] : [],
      );
      const record = await causalStore.getRequest(requestId);
      const refIds = record?.refs.flatMap((ref) =>
        ref.kind === "kernel_run" ? [ref.id] : [],
      ) ?? [];
      expect(runEndIds).toHaveLength(0);
      expect([...refIds].sort()).toEqual([...runEndIds].sort());
      expect(record?.coverage).toMatchObject({
        state: "complete",
        reasonCodes: [],
      });
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("treats a legacy session-only claim as route-only even when matching Chat messages exist", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "chat-session-only-claim-"));
    try {
      const requestId = "session_only_claim_request";
      const sessionId = "session_only_claim_session";
      const message = "do not infer a durable binding";
      const chatStore = createChatSessionStore([]);
      await chatStore.appendMessage({ sessionId, requestId, role: "user", content: message });
      await chatStore.appendMessage({
        sessionId,
        requestId,
        role: "assistant",
        content: "must not replay",
      });
      const causalStateDir = path.join(configDir, "conversation-causal");
      await mkdir(causalStateDir, { recursive: true });
      await writeFile(path.join(causalStateDir, "state.json"), JSON.stringify({
        schemaVersion: 1,
        records: [{
          schemaVersion: 1,
          requestId,
          turnId: `turn-${requestId}`,
          sessionId,
          inputFingerprint: createChatRequestClaimFingerprint({
            input: { message },
            userMessage: message,
            validatedAttachments: [],
          }),
          inputFingerprintVersion: "sha256-type-tagged-v2",
          revision: 1,
          attempts: [],
          refs: [],
          coverage: { state: "complete", reasonCodes: [] },
          createdAt: "2026-08-24T00:00:00.000Z",
          updatedAt: "2026-08-24T00:00:00.000Z",
        }],
        approvals: [],
      }), "utf8");
      const causalStore = createConversationCausalStore({ configDir });
      const bus = new KernelEventBus();
      const statusEvents: ChatTaskStatusEvent[] = [];
      const streamEvents: ChatStreamEvent[] = [];
      let modelCalls = 0;
      const service = createChatService({
        chatClient: {
          async complete() {
            modelCalls += 1;
            return chatReply("must not run");
          },
        },
        getModelProfile: createCompleteProfile,
        memoryStore: createMemoryStore(),
        chatSessionStore: chatStore,
        conversationCausalStore: causalStore,
        productionKernelDriver: createProductionKernelDriver({ bus }),
      });

      await expect(service.sendMessage(
        { sessionId: "caller_route", requestId, message },
        {
          onStatusEvent: (event) => statusEvents.push(event),
          onStreamEvent: (event) => streamEvents.push(event),
        },
      )).resolves.toMatchObject({ ok: false, retryable: true });
      expect(modelCalls).toBe(0);
      expect(statusEvents).toEqual([]);
      expect(streamEvents).toEqual([]);
      const storedSession = await chatStore.get(sessionId);
      expect(storedSession).toMatchObject({
        messages: [
          expect.objectContaining({ role: "user" }),
          expect.objectContaining({ role: "assistant", content: "must not replay" }),
        ],
      });
      expect(storedSession?.activity?.statusEvents ?? []).toEqual([]);
      await expect(causalStore.getRequest(requestId)).resolves.toMatchObject({
        coverage: {
          state: "complete",
          reasonCodes: [],
        },
      });
      expect(bus.history().filter((event) => event.type === "run_end"))
        .toEqual([]);
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("marks an early workspace-resolution failure packet as route-only", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "chat-workspace-route-only-"));
    try {
      const causalStore = createConversationCausalStore({ configDir });
      const chatStore = createChatSessionStore([]);
      const streamEvents: ChatStreamEvent[] = [];
      const service = createChatService({
        chatClient: {
          async complete() {
            return chatReply("must not run");
          },
        },
        getModelProfile: createCompleteProfile,
        memoryStore: createMemoryStore(),
        chatSessionStore: chatStore,
        conversationCausalStore: causalStore,
        workspaceService: {
          async resolveRunContext() {
            throw new Error("workspace resolution failed before user persistence");
          },
        },
      });

      await expect(service.sendMessage(
        {
          sessionId: "workspace_route_only_session",
          requestId: "workspace_route_only_request",
          message: "resolve the missing workspace",
          workspaceId: "workspace_missing",
        },
        { onStreamEvent: (event) => streamEvents.push(event) },
      )).resolves.toMatchObject({ ok: false });

      expect(streamEvents.map((event) => event.type)).toEqual([
        "output_part",
        "failed",
      ]);
      expect(
        streamEvents.every((event) => event.domainStateAvailable === false),
      ).toBe(true);
      await expect(chatStore.get("workspace_route_only_session")).resolves.toBeNull();
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("settles an unbound duplicate without a Chat persistence adapter", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "chat-kernel-no-store-"));
    try {
      const requestId = "unbound_no_store_request";
      const message = "no Chat store must remain non-executing";
      const causalStore = createConversationCausalStore({ configDir });
      await causalStore.claimRequest({
        requestId,
        turnId: `turn-${requestId}`,
        inputFingerprint: createChatRequestClaimFingerprint({
          input: { message },
          userMessage: message,
          validatedAttachments: [],
        }),
      });
      const bus = new KernelEventBus();
      const streamEvents: ChatStreamEvent[] = [];
      let modelCalls = 0;
      const service = createChatService({
        chatClient: {
          async complete() {
            modelCalls += 1;
            return chatReply("must not run");
          },
        },
        getModelProfile: createCompleteProfile,
        memoryStore: createMemoryStore(),
        conversationCausalStore: causalStore,
        productionKernelDriver: createProductionKernelDriver({ bus }),
      });

      await expect(service.sendMessage(
        {
          sessionId: "routing_only_session",
          requestId,
          message,
        },
        { onStreamEvent: (event) => streamEvents.push(event) },
      )).resolves.toMatchObject({ ok: false, retryable: true });
      expect(modelCalls).toBe(0);
      expect(streamEvents).toEqual([]);
      const runEndIds = bus.history().flatMap((event) =>
        event.type === "run_end" ? [event.runId] : [],
      );
      const record = await causalStore.getRequest(requestId);
      expect(runEndIds).toHaveLength(0);
      expect(record?.refs).toEqual([]);
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("keeps Kernel settlement complete when user persistence leaves an unbound claim", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "chat-kernel-user-crash-"));
    try {
      const causalStore = createConversationCausalStore({ configDir });
      const baseChatStore = createChatSessionStore([]);
      let failUserAppend = true;
      const chatStore = {
        ...baseChatStore,
        async appendMessage(input: AppendChatMessageInput) {
          if (input.role === "user" && failUserAppend) {
            failUserAppend = false;
            throw new Error("user persistence failed");
          }
          return baseChatStore.appendMessage(input);
        },
      };
      const bus = new KernelEventBus();
      let modelCalls = 0;
      const service = createChatService({
        chatClient: {
          async complete() {
            modelCalls += 1;
            return chatReply("must not run");
          },
        },
        getModelProfile: createCompleteProfile,
        memoryStore: createMemoryStore(),
        chatSessionStore: chatStore,
        conversationCausalStore: causalStore,
        productionKernelDriver: createProductionKernelDriver({ bus }),
      });
      const input = {
        sessionId: "user_crash_routing_session",
        requestId: "user_crash_request",
        message: "persist once then recover without execution",
      };

      await expect(service.sendMessage(input)).resolves.toMatchObject({
        ok: false,
        code: "INTERNAL_ERROR",
      });
      await expect(service.sendMessage(input)).resolves.toMatchObject({
        ok: false,
        retryable: true,
      });

      expect(modelCalls).toBe(0);
      const runEndIds = bus.history().flatMap((event) =>
        event.type === "run_end" ? [event.runId] : [],
      );
      const record = await causalStore.getRequest(input.requestId);
      const refIds = record?.refs.flatMap((ref) =>
        ref.kind === "kernel_run" ? [ref.id] : [],
      ) ?? [];
      expect(runEndIds).toHaveLength(1);
      expect([...refIds].sort()).toEqual([...runEndIds].sort());
      expect(record?.sessionId).toBeUndefined();
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("journals a Kernel fallback failure across Chat and Workspace before run_end", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "chat-kernel-journal-"));
    try {
      const requestId = "kernel_journal_request";
      const sessionId = "kernel_journal_session";
      const activityEvents: ChatTaskStatusEvent[] = [];
      const baseChatStore = createChatSessionStore([], { activityEvents });
      const rawCanary = "assistant-write-secret-canary";
      const chatStore = {
        ...baseChatStore,
        async appendMessage(input: AppendChatMessageInput) {
          if (input.role === "assistant") throw new Error(rawCanary);
          return baseChatStore.appendMessage(input);
        },
      };
      const workspaceEvents: WorkspaceRunEventInput[] = [];
      const workspaceStore = createMemoryWorkspaceRunStore({
        creates: [],
        events: workspaceEvents,
        finishes: [],
      });
      const causalStore = createConversationCausalStore({ configDir });
      const bus = new KernelEventBus();
      let capturedSettlement: ChatKernelSettlement<unknown> | undefined;
      const baseKernelDriver = createProductionKernelDriver({ bus });
      const capturingKernelDriver: ProductionKernelDriver = {
        async run<TSegment extends ProductionKernelSegment>(
          runInput: ProductionKernelRunInput<TSegment>,
        ) {
          const outcome = await baseKernelDriver.run(runInput);
          capturedSettlement = outcome.segment as unknown as ChatKernelSettlement<unknown>;
          return outcome;
        },
      };
      const service = createChatService({
        chatClient: { async complete() { return chatReply("assistant reply"); } },
        getModelProfile: createCompleteProfile,
        memoryStore: createMemoryStore(),
        chatSessionStore: chatStore,
        conversationCausalStore: causalStore,
        workspaceService: {
          async resolveRunContext() {
            return buildPrimaryRunContext({
              workspaceId: "workspace_kernel_journal",
              workspaceRoot: "/workspace/kernel-journal",
            });
          },
        },
        workspaceRunStore: workspaceStore,
        productionKernelDriver: capturingKernelDriver,
      });

      const result = await service.sendMessage({
        sessionId,
        requestId,
        message: "exercise Kernel fallback journal",
        workspaceId: "workspace_kernel_journal",
      });
      expect(result).toMatchObject({
        ok: false,
        code: "INTERNAL_ERROR",
      });
      expect(JSON.stringify(result)).not.toContain(rawCanary);
      const causalRecord = await causalStore.getRequest(requestId);
      const failedSettlement = causalRecord?.requiredSettlements?.find(
        (settlement) =>
          settlement.targetState === "failed"
          && settlement.state === "committed",
      );
      expect(failedSettlement).toMatchObject({
        requiredDomains: ["chat", "workspace"],
        chatEventFingerprint: expect.any(String),
        workspaceEventId: expect.any(String),
      });
      expect(activityEvents).toContainEqual(expect.objectContaining({
        requestId,
        state: "failed",
        settlementId: failedSettlement!.id,
        domainStateAvailable: true,
      }));
      expect(workspaceEvents).toContainEqual(expect.objectContaining({
        type: "status",
        status: "failed",
      }));
      expect(causalRecord?.refs).toContainEqual({
        kind: "workspace_event",
        runId: `chat_run_${sessionId}_${requestId}`,
        eventId: failedSettlement!.workspaceEventId,
      });
      expect(capturedSettlement).toMatchObject({
        status: "failed",
        persistence: {
          requiredStatePersisted: true,
          terminalActivityPersisted: true,
        },
      });
      expect(JSON.stringify(capturedSettlement)).not.toContain(rawCanary);
      expect(bus.history().at(-1)).toMatchObject({
        type: "run_end",
        status: "failed",
      });
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("keeps duplicate claim handling transport-only when activity persistence is broken", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "chat-kernel-activity-fail-"));
    try {
      const requestId = "bound_activity_failure_request";
      const sessionId = "bound_activity_failure_session";
      const message = "do not lose Kernel settlement when activity fails";
      const causalStore = createConversationCausalStore({ configDir });
      const baseChatStore = createChatSessionStore([]);
      const user = await baseChatStore.appendMessage({
        sessionId,
        requestId,
        role: "user",
        content: message,
      });
      await causalStore.claimRequest({
        requestId,
        turnId: `turn-${requestId}`,
        inputFingerprint: createChatRequestClaimFingerprint({
          input: { message },
          userMessage: message,
          validatedAttachments: [],
        }),
      });
      await causalStore.bindRequest({
        requestId,
        sessionId,
        userMessageId: user.message.id,
      });
      const chatStore = {
        ...baseChatStore,
        async appendActivityEvent() {
          throw new Error("activity persistence failed");
        },
      };
      const bus = new KernelEventBus();
      const streamEvents: ChatStreamEvent[] = [];
      let modelCalls = 0;
      const service = createChatService({
        chatClient: {
          async complete() {
            modelCalls += 1;
            return chatReply("must not run");
          },
        },
        getModelProfile: createCompleteProfile,
        memoryStore: createMemoryStore(),
        chatSessionStore: chatStore,
        conversationCausalStore: causalStore,
        productionKernelDriver: createProductionKernelDriver({ bus }),
      });

      await expect(service.sendMessage(
        { sessionId, requestId, message },
        { onStreamEvent: (event) => streamEvents.push(event) },
      )).resolves.toMatchObject({ ok: false, retryable: true });
      expect(modelCalls).toBe(0);
      expect(streamEvents).toEqual([]);
      const runEndIds = bus.history().flatMap((event) =>
        event.type === "run_end" ? [event.runId] : [],
      );
      const record = await causalStore.getRequest(requestId);
      expect(runEndIds).toHaveLength(0);
      expect(record?.refs).toEqual([]);
      expect(record?.coverage).toMatchObject({
        state: "complete",
        reasonCodes: [],
      });
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("treats a real session named unpersisted as durable instead of a sentinel", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "chat-kernel-real-unpersisted-"));
    try {
      const requestId = "real_unpersisted_session_request";
      const sessionId = "unpersisted";
      const message = "this is a real durable session";
      const chatStore = createChatSessionStore([]);
      const user = await chatStore.appendMessage({
        sessionId,
        requestId,
        role: "user",
        content: message,
      });
      const causalStore = createConversationCausalStore({ configDir });
      await causalStore.claimRequest({
        requestId,
        turnId: `turn-${requestId}`,
        inputFingerprint: createChatRequestClaimFingerprint({
          input: { message },
          userMessage: message,
          validatedAttachments: [],
        }),
      });
      await causalStore.bindRequest({
        requestId,
        sessionId,
        userMessageId: user.message.id,
      });
      const bus = new KernelEventBus();
      const baseKernelDriver = createProductionKernelDriver({ bus });
      let capturedSettlement: ChatKernelSettlement<unknown> | undefined;
      const capturingKernelDriver: ProductionKernelDriver = {
        async run<TSegment extends ProductionKernelSegment>(
          runInput: ProductionKernelRunInput<TSegment>,
        ) {
          const outcome = await baseKernelDriver.run(runInput);
          capturedSettlement = outcome.segment as unknown as ChatKernelSettlement<unknown>;
          return outcome;
        },
      };
      let modelCalls = 0;
      const service = createChatService({
        chatClient: {
          async complete() {
            modelCalls += 1;
            return chatReply("must not run");
          },
        },
        getModelProfile: createCompleteProfile,
        memoryStore: createMemoryStore(),
        chatSessionStore: chatStore,
        conversationCausalStore: causalStore,
        productionKernelDriver: capturingKernelDriver,
      });

      await expect(service.sendMessage({
        sessionId,
        requestId,
        message,
      })).resolves.toMatchObject({ ok: false, retryable: true });
      expect(modelCalls).toBe(0);
      expect((await chatStore.get(sessionId))?.activity).toBeUndefined();
      expect(capturedSettlement).toBeUndefined();
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("settles a duplicate failure against the causal session instead of stale caller routing", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "chat-kernel-session-"));
    try {
      const requestId = "kernel_session_request";
      const actualSessionId = "kernel_session_actual";
      const staleSessionId = "kernel_session_stale";
      const message = "do not execute this duplicate";
      const chatStore = createChatSessionStore([]);
      const user = await chatStore.appendMessage({
        sessionId: actualSessionId,
        requestId,
        role: "user",
        content: message,
      });
      const causalStore = createConversationCausalStore({ configDir });
      await causalStore.claimRequest({
        requestId,
        turnId: `turn-${requestId}`,
        inputFingerprint: createChatRequestClaimFingerprint({
          input: { message },
          userMessage: message,
          validatedAttachments: [],
        }),
      });
      await causalStore.bindRequest({
        requestId,
        sessionId: actualSessionId,
        userMessageId: user.message.id,
      });
      let modelCalls = 0;
      const bus = new KernelEventBus();
      const service = createChatService({
        chatClient: {
          async complete() {
            modelCalls += 1;
            return chatReply("must not run");
          },
        },
        getModelProfile: createCompleteProfile,
        memoryStore: createMemoryStore(),
        chatSessionStore: chatStore,
        conversationCausalStore: causalStore,
        productionKernelDriver: createProductionKernelDriver({ bus }),
      });

      await expect(service.sendMessage({
        sessionId: staleSessionId,
        requestId,
        message,
      })).resolves.toMatchObject({
        ok: false,
        retryable: true,
      });
      expect(modelCalls).toBe(0);
      await expect(chatStore.get(staleSessionId)).resolves.toBeNull();
      const conflictingStaleSessionId = "kernel_session_conflicting_stale";
      await expect(service.sendMessage({
        sessionId: conflictingStaleSessionId,
        requestId,
        message: "different conflicting input",
      })).resolves.toMatchObject({
        ok: false,
        message: expect.stringContaining("不同输入"),
      });
      expect(modelCalls).toBe(0);
      await expect(chatStore.get(conflictingStaleSessionId)).resolves.toBeNull();
      expect((await chatStore.get(actualSessionId))?.activity).toBeUndefined();
      expect(bus.history()).toEqual([]);
      const kernelRunIds = bus.history().flatMap((event) =>
        event.type === "run_end" ? [event.runId] : [],
      );
      const causalRecord = await causalStore.getRequest(requestId);
      const causalKernelRunIds = causalRecord?.refs.flatMap((ref) =>
        ref.kind === "kernel_run" ? [ref.id] : [],
      ) ?? [];
      expect(kernelRunIds).toHaveLength(0);
      expect([...causalKernelRunIds].sort()).toEqual([...kernelRunIds].sort());
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("does not publish a required pause before both Chat and Workspace persistence settle", async () => {
    const chatGate = createDeferred();
    const workspaceGate = createDeferred();
    const lifecycle: string[] = [];
    const statusEvents: ChatTaskStatusEvent[] = [];
    const streamEvents: ChatStreamEvent[] = [];
    const baseChatStore = createChatSessionStore([]);
    const chatStore = {
      ...baseChatStore,
      async appendActivityEvent(
        sessionId: string,
        event: ChatTaskStatusEvent,
      ) {
        if (event.state === "paused") {
          lifecycle.push("chat_started");
          await chatGate.promise;
          lifecycle.push("chat_settled");
        }
        return baseChatStore.appendActivityEvent(sessionId, event);
      },
    };
    const baseWorkspaceStore = createMemoryWorkspaceRunStore({
      creates: [],
      events: [],
      finishes: [],
    });
    const workspaceStore = {
      ...baseWorkspaceStore,
      async settleLifecycle(
        input: Parameters<WorkspaceRunStore["settleLifecycle"]>[0],
      ) {
        if (input.event.type === "status" && input.event.status === "paused") {
          lifecycle.push("workspace_started");
          await workspaceGate.promise;
          lifecycle.push("workspace_settled");
        }
        return baseWorkspaceStore.settleLifecycle(input);
      },
    };
    const service = createChatService({
      chatClient: {
        async complete() {
          return chatReply("unused");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: chatStore,
      workspaceService: {
        async resolveRunContext() {
          return buildPrimaryRunContext({
            workspaceId: "workspace_pause",
            workspaceRoot: "/workspace/pause",
          });
        },
      },
      workspaceRunStore: workspaceStore,
      toolExecutor: createToolExecutor(),
      async runAgentLoop(messages) {
        return {
          status: "paused",
          summary: "Paused for review.",
          turns: 1,
          messages,
          toolCallsExecuted: 0,
          continuation: {
            reason: "tool_failure_loop",
            maxTurns: 8,
            toolCallsExecuted: 0,
          },
        };
      },
    });

    const sending = service.sendMessage(
      {
        sessionId: "required_pause_session",
        requestId: "required_pause_request",
        message: "pause after persistence",
        workspaceId: "workspace_pause",
      },
      { onStatusEvent: (event) => statusEvents.push(event) },
    );

    await waitFor(() => lifecycle.includes("chat_started"));
    expect(statusEvents.some((event) => event.state === "paused")).toBe(false);
    expect(lifecycle).not.toContain("workspace_started");

    chatGate.resolve();
    await waitFor(() => lifecycle.includes("workspace_started"));
    expect(statusEvents.some((event) => event.state === "paused")).toBe(false);

    workspaceGate.resolve();
    await expect(sending).resolves.toMatchObject({
      ok: true,
      agentStatus: { state: "paused" },
    });
    expect(lifecycle).toEqual([
      "chat_started",
      "chat_settled",
      "workspace_started",
      "workspace_settled",
    ]);
    expect(statusEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ state: "paused" }),
    ]));
  });

  it("fails closed and compensates when required Workspace pause settlement rejects", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "chat-required-pause-failure-"));
    try {
      const creates: unknown[] = [];
      const events: WorkspaceRunEventInput[] = [];
      const finishes: Array<{
        workspaceRunId: string;
        status: WorkspaceRunTerminalStatus;
        summary?: string;
      }> = [];
      const baseWorkspaceStore = createMemoryWorkspaceRunStore({
        creates,
        events,
        finishes,
      });
      const workspaceStore = {
        ...baseWorkspaceStore,
        async settleLifecycle(
          input: Parameters<WorkspaceRunStore["settleLifecycle"]>[0],
        ) {
          if (input.snapshotStatus === "paused") {
            throw new Error("forced required pause settlement failure");
          }
          return baseWorkspaceStore.settleLifecycle(input);
        },
      };
      const causalStore = createConversationCausalStore({ configDir });
      const chatStore = createChatSessionStore([]);
      const bus = new KernelEventBus();
      const statusEvents: ChatTaskStatusEvent[] = [];
      const streamEvents: ChatStreamEvent[] = [];
      const service = createChatService({
        chatClient: {
          async complete() {
            return chatReply("unused");
          },
        },
        getModelProfile: createCompleteProfile,
        memoryStore: createMemoryStore(),
        chatSessionStore: chatStore,
        conversationCausalStore: causalStore,
        workspaceService: {
          async resolveRunContext() {
            return buildPrimaryRunContext({
              workspaceId: "workspace_pause_failure",
              workspaceRoot: "/workspace/pause-failure",
            });
          },
        },
        workspaceRunStore: workspaceStore,
        productionKernelDriver: createProductionKernelDriver({ bus }),
        toolExecutor: createToolExecutor(),
        async runAgentLoop(messages) {
          return {
            status: "paused",
            summary: "Paused but not durably settled.",
            turns: 1,
            messages,
            toolCallsExecuted: 0,
            continuation: {
              reason: "tool_failure_loop",
              maxTurns: 8,
              toolCallsExecuted: 0,
            },
          };
        },
      });
      const requestId = "required_pause_failure_request";
      const sessionId = "required_pause_failure_session";

      await expect(service.sendMessage(
        {
          sessionId,
          requestId,
          message: "pause with a failing Workspace settlement",
          workspaceId: "workspace_pause_failure",
        },
        {
          onStatusEvent: (event) => statusEvents.push(event),
          onStreamEvent: (event) => streamEvents.push(event),
        },
      )).resolves.toMatchObject({ ok: false });

      expect(statusEvents.some((event) => event.state === "paused")).toBe(false);
      expect(statusEvents.at(-1)).toMatchObject({ state: "failed" });
      expect(streamEvents.filter((event) => event.type === "failed"))
        .toHaveLength(1);
      expect(streamEvents.some((event) => event.type === "completed")).toBe(false);
      await expect(chatStore.get(sessionId)).resolves.toMatchObject({
        messages: [expect.objectContaining({ role: "user" })],
        activity: {
          statusEvents: expect.arrayContaining([
            expect.objectContaining({ state: "failed" }),
          ]),
        },
      });
      expect(finishes).toEqual(expect.arrayContaining([
        expect.objectContaining({ status: "failed" }),
      ]));
      await expect(causalStore.getRequest(requestId)).resolves.toMatchObject({
        attempts: [expect.objectContaining({ state: "interrupted" })],
        coverage: {
          state: "degraded",
          reasonCodes: expect.arrayContaining([
            "required_conversation_settlement_failed",
          ]),
        },
      });
      expect(bus.history().filter((event) => event.type === "run_end"))
        .toEqual([expect.objectContaining({ status: "failed" })]);
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("keeps total required Chat settlement failure route-only and secret-safe", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "chat-required-total-failure-"));
    try {
      const privateMarker = "PRIVATE_SETTLEMENT_CANARY";
      const causalStore = createConversationCausalStore({ configDir });
      const baseChatStore = createChatSessionStore([]);
      const chatStore = {
        ...baseChatStore,
        async appendActivityEvent(sessionId: string, event: ChatTaskStatusEvent) {
          if (event.state === "paused" || event.state === "failed") {
            throw new Error(privateMarker);
          }
          return baseChatStore.appendActivityEvent(sessionId, event);
        },
      };
      const workspaceEvents: WorkspaceRunEventInput[] = [];
      const workspaceFinishes: Array<{
        workspaceRunId: string;
        status: WorkspaceRunTerminalStatus;
        summary?: string;
      }> = [];
      const workspaceStore = createMemoryWorkspaceRunStore({
        creates: [],
        events: workspaceEvents,
        finishes: workspaceFinishes,
      });
      const bus = new KernelEventBus();
      const statusEvents: ChatTaskStatusEvent[] = [];
      const streamEvents: ChatStreamEvent[] = [];
      const service = createChatService({
        chatClient: { async complete() { return chatReply("unused"); } },
        getModelProfile: createCompleteProfile,
        memoryStore: createMemoryStore(),
        chatSessionStore: chatStore,
        conversationCausalStore: causalStore,
        workspaceService: {
          async resolveRunContext() {
            return buildPrimaryRunContext({
              workspaceId: "workspace_total_failure",
              workspaceRoot: "/workspace/total-failure",
            });
          },
        },
        workspaceRunStore: workspaceStore,
        productionKernelDriver: createProductionKernelDriver({ bus }),
        toolExecutor: createToolExecutor(),
        async runAgentLoop(messages) {
          return {
            status: "paused",
            summary: "Pause requires durable settlement.",
            turns: 1,
            messages,
            toolCallsExecuted: 0,
            continuation: {
              reason: "tool_failure_loop",
              maxTurns: 8,
              toolCallsExecuted: 0,
            },
          };
        },
      });
      const requestId = "required_total_failure_request";
      const sessionId = "required_total_failure_session";

      const result = await service.sendMessage(
        {
          sessionId,
          requestId,
          message: "pause while Chat activity is unavailable",
          workspaceId: "workspace_total_failure",
        },
        {
          onStatusEvent: (event) => statusEvents.push(event),
          onStreamEvent: (event) => streamEvents.push(event),
        },
      );
      expect(result).toEqual({
        ok: false,
        code: "INTERNAL_ERROR",
        retryable: true,
        message: "会话失败状态未能完整持久化，请重新加载后重试。",
      });
      expect(statusEvents.some((event) => event.state === "paused")).toBe(false);
      expect(statusEvents.filter((event) => event.state === "failed"))
        .toEqual([expect.objectContaining({ domainStateAvailable: false })]);
      const failedPacket = streamEvents.filter((event) =>
        (event.type === "status" && event.status.state === "failed")
        || event.type === "output_part"
        || event.type === "failed"
      );
      expect(failedPacket.length).toBeGreaterThanOrEqual(3);
      expect(failedPacket.every((event) => event.domainStateAvailable === false)).toBe(true);
      expect(streamEvents.filter((event) => event.type === "failed")).toHaveLength(1);
      const record = await causalStore.getRequest(requestId);
      const persisted = await baseChatStore.get(sessionId);
      expect(JSON.stringify({
        result,
        statusEvents,
        streamEvents,
        workspaceEvents,
        workspaceFinishes,
        kernel: bus.history(),
        record,
        persisted,
      })).not.toContain(privateMarker);
      expect(workspaceFinishes).toEqual(expect.arrayContaining([
        expect.objectContaining({ status: "failed" }),
      ]));
      expect(record).toMatchObject({
        attempts: [expect.objectContaining({ state: "interrupted" })],
        coverage: {
          state: "degraded",
          reasonCodes: expect.arrayContaining([
            "required_conversation_settlement_failed",
            "required_chat_failure_compensation_failed",
          ]),
        },
      });
      expect(bus.history().filter((event) => event.type === "run_end"))
        .toEqual([expect.objectContaining({ status: "failed" })]);
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it("publishes ordinary progress live but does not settle the turn before its persistence queue drains", async () => {
    const chatGate = createDeferred();
    const workspaceGate = createDeferred();
    const lifecycle: string[] = [];
    const statusEvents: ChatTaskStatusEvent[] = [];
    const streamEvents: ChatStreamEvent[] = [];
    const baseChatStore = createChatSessionStore([]);
    const chatStore = {
      ...baseChatStore,
      async appendActivityEvent(
        sessionId: string,
        event: ChatTaskStatusEvent,
      ) {
        if (event.state === "model") {
          lifecycle.push("chat_started");
          await chatGate.promise;
          lifecycle.push("chat_settled");
        }
        return baseChatStore.appendActivityEvent(sessionId, event);
      },
    };
    const baseWorkspaceStore = createMemoryWorkspaceRunStore({
      creates: [],
      events: [],
      finishes: [],
    });
    const workspaceStore = {
      ...baseWorkspaceStore,
      async settleLifecycle(
        input: Parameters<WorkspaceRunStore["settleLifecycle"]>[0],
      ) {
        if (input.event.message === "正在调用模型（第 1 轮）") {
          lifecycle.push("workspace_started");
          await workspaceGate.promise;
          lifecycle.push("workspace_settled");
        }
        return baseWorkspaceStore.settleLifecycle(input);
      },
    };
    const service = createChatService({
      chatClient: {
        async complete() {
          return chatReply("ordinary persistence complete");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: chatStore,
      workspaceService: {
        async resolveRunContext() {
          return buildPrimaryRunContext({
            workspaceId: "workspace_ordinary",
            workspaceRoot: "/workspace/ordinary",
          });
        },
      },
      workspaceRunStore: workspaceStore,
      toolExecutor: createToolExecutor(),
    });
    let settled = false;
    const sending = service.sendMessage(
      {
        sessionId: "ordinary_session",
        requestId: "ordinary_request",
        message: "show progress while persisting",
        workspaceId: "workspace_ordinary",
      },
      {
        onStatusEvent: (event) => statusEvents.push(event),
        onStreamEvent: (event) => streamEvents.push(event),
      },
    ).finally(() => {
      settled = true;
    });

    await waitFor(() => lifecycle.includes("chat_started"));
    expect(statusEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ state: "model" }),
    ]));
    expect(settled).toBe(false);
    expect(lifecycle).not.toContain("workspace_started");

    chatGate.resolve();
    await waitFor(() => lifecycle.includes("workspace_started"));
    expect(settled).toBe(false);

    workspaceGate.resolve();
    await expect(sending).resolves.toMatchObject({
      ok: true,
      reply: "ordinary persistence complete",
      domainStateAvailable: true,
    });
    expect(statusEvents.length).toBeGreaterThan(0);
    expect(statusEvents.every((event) => event.domainStateAvailable === true))
      .toBe(true);
    expect(streamEvents.length).toBeGreaterThan(0);
    expect(streamEvents.every((event) => event.domainStateAvailable === true))
      .toBe(true);
    expect(lifecycle).toEqual([
      "chat_started",
      "chat_settled",
      "workspace_started",
      "workspace_settled",
    ]);
  });

  it("persists canceled activity before Chat Kernel run_end", async () => {
    const lifecycle: string[] = [];
    const bus = new KernelEventBus();
    bus.subscribe((event) => {
      if (event.type === "run_end") lifecycle.push("run_end");
    });
    const storedMessages: AppendChatMessageInput[] = [];
    const baseStore = createChatSessionStore(storedMessages);
    const store = {
      ...baseStore,
      async appendActivityEvent(
        sessionId: string,
        event: ChatTaskStatusEvent,
      ) {
        if (event.state === "canceled") lifecycle.push("canceled_persisted");
        return baseStore.appendActivityEvent(sessionId, event);
      },
    };
    const service = createChatService({
      chatClient: {
        async complete() {
          return chatReply("unused");
        },
      },
      getModelProfile: createCompleteProfile,
      memoryStore: createMemoryStore(),
      chatSessionStore: store,
      toolExecutor: createToolExecutor(),
      productionKernelDriver: createProductionKernelDriver({ bus }),
      async runAgentLoop(messages) {
        return {
          status: "canceled",
          summary: "canceled",
          turns: 1,
          messages,
          toolCallsExecuted: 0,
        };
      },
    });

    await expect(
      service.sendMessage({
        sessionId: "kernel_cancel_session",
        requestId: "kernel_cancel_request",
        message: "cancel",
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: "CANCELED",
    });
    expect(lifecycle).toContain("canceled_persisted");
    expect(
      lifecycle.filter((entry) => entry === "canceled_persisted"),
    ).toHaveLength(1);
    expect(lifecycle.at(-1)).toBe("run_end");
    expect(bus.history().at(-1)).toMatchObject({
      type: "run_end",
      status: "canceled",
    });
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
    clearedGoals?: Array<{ sessionId: string; goalId: string }>;
    tokenUsageWrites?: Array<{
      sessionId: string;
      usage: ChatSessionTokenUsage;
    }>;
    activityEvents?: ChatTaskStatusEvent[];
  } = {},
) {
  const sessions = new Map<string, ChatSessionRecord>();

  function buildSession(
    sessionId: string,
    summary: string,
    partial: Partial<ChatSessionRecord> = {},
  ): ChatSessionRecord {
    const existing = sessions.get(sessionId);
    return {
      id: sessionId,
      title: existing?.title ?? "会话",
      summary,
      messages: existing?.messages ?? [],
      ...(existing?.workspaceId ? { workspaceId: existing.workspaceId } : {}),
      ...(existing?.workspaceSummary
        ? { workspaceSummary: existing.workspaceSummary }
        : {}),
      ...(existing?.activity ? { activity: existing.activity } : {}),
      ...(options.activeGoal
        ? {
            activeGoalId: options.activeGoal.id,
            goalIds: [options.activeGoal.id],
            goalSummaries: [options.activeGoal],
          }
        : existing?.activeGoalId
          ? {
              activeGoalId: existing.activeGoalId,
              goalIds: existing.goalIds,
              goalSummaries: existing.goalSummaries,
            }
          : {}),
      createdAt: existing?.createdAt ?? "2026-06-06T08:00:00.000Z",
      updatedAt: "2026-06-06T08:00:00.000Z",
      ...partial,
    };
  }

  return {
    async list() {
      return [...sessions.values()].map((session) => ({
        id: session.id,
        title: session.title,
        summary: session.summary,
        messageCount: session.messages.length,
        ...(session.workspaceId ? { workspaceId: session.workspaceId } : {}),
        ...(session.workspaceSummary
          ? { workspaceSummary: session.workspaceSummary }
          : {}),
        work: deriveChatSessionWork(session),
        updatedAt: session.updatedAt,
      }));
    },
    async get(sessionId: string) {
      return sessions.get(sessionId) ?? null;
    },
    async appendMessage(input: AppendChatMessageInput) {
      messages.push(input);
      const sessionId = input.sessionId ?? "persisted_session";
      const inputWithOutputParts = input as AppendChatMessageInput & {
        outputParts?: ChatSessionRecord["messages"][number]["outputParts"];
      };
      const message = {
        id: `message_${messages.length}`,
        ...(input.requestId ? { requestId: input.requestId } : {}),
        ...(input.turnId ? { turnId: input.turnId } : {}),
        ...(input.causalAttempt !== undefined
          ? { causalAttempt: input.causalAttempt }
          : {}),
        ...(input.causalAttemptId ? { causalAttemptId: input.causalAttemptId } : {}),
        role: input.role,
        content: input.content,
        ...(input.attachments ? { attachments: input.attachments } : {}),
        ...(inputWithOutputParts.outputParts
          ? { outputParts: inputWithOutputParts.outputParts }
          : {}),
        ...(input.turnSettlementStatus
          ? { turnSettlementStatus: input.turnSettlementStatus }
          : {}),
        createdAt: "2026-06-06T08:00:00.000Z",
      } as const;
      const session = buildSession(sessionId, input.content, {
        messages: [...(sessions.get(sessionId)?.messages ?? []), message],
        ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
        ...(input.workspaceSummary ? { workspaceSummary: input.workspaceSummary } : {}),
      });
      sessions.set(sessionId, session);
      return {
        message,
        session,
      };
    },
    async addTokenUsage(sessionId: string, usage: ChatSessionTokenUsage) {
      options.tokenUsageWrites?.push({ sessionId, usage });
      return null;
    },
    async appendActivityEvent(
      sessionId: string,
      event: ChatTaskStatusEvent,
      _eventOptions?: { selectedSkillName?: string },
    ) {
      options.activityEvents?.push(event);
      const session = buildSession(sessionId, sessions.get(sessionId)?.summary ?? "会话", {
        activity: {
          updatedAt: event.createdAt,
          statusEvents: [
            ...(sessions.get(sessionId)?.activity?.statusEvents ?? []),
            event,
          ],
          ...(event.selectedSkillName
            ? { selectedSkillName: event.selectedSkillName }
            : sessions.get(sessionId)?.activity?.selectedSkillName
              ? {
                  selectedSkillName:
                    sessions.get(sessionId)?.activity?.selectedSkillName,
                }
              : {}),
        },
      });
      sessions.set(sessionId, session);
      return session;
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
    async clearActiveGoal(sessionId: string, goalId: string) {
      options.clearedGoals?.push({ sessionId, goalId });
      return null;
    },
  };
}

function createGoalService(options: {
  goalCreates?: unknown[];
  resumes?: string[];
  retries?: string[];
  pauses?: string[];
  resolveStatus?: ChatSessionGoalSummary["status"];
} = {}) {
  const goalDescriptions = new Map<string, string>();
  return {
    async createFromChat(input: {
      sessionId: string;
      originMessageId: string | null;
      description: string;
      selectedSkill?: SkillRecord;
      selectedSkillInputValues?: Record<string, string | number | boolean>;
    }): Promise<ChatSessionGoalSummary> {
      options.goalCreates?.push(input);
      goalDescriptions.set("goal_release", input.description);
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
        description: goalDescriptions.get(goalId) ?? "发布",
        status: "executing",
      };
    },
    async retry(goalId: string): Promise<ChatSessionGoalSummary> {
      options.retries?.push(goalId);
      return {
        id: goalId,
        description: goalDescriptions.get(goalId) ?? "深度调研 Serenity",
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
        status: options.resolveStatus ?? "executing",
      };
    },
  };
}

function createGoalDraftFixture(
  partial: Pick<
    GoalDraft,
    | "id"
    | "sessionId"
    | "originMessageId"
    | "sourceMessage"
    | "normalizedDescription"
  >,
): GoalDraft {
  return {
    ...partial,
    successCriteria: [
      {
        id: "criterion_1",
        description: "GitHub Release is complete.",
        acceptanceChecks: [
          {
            id: "criterion_1_review",
            kind: "model_review",
            description: "Evidence-backed release review passes.",
            params: {
              evidenceRefs: ["artifact:goalEvidence"],
            },
            requiresEvidence: true,
          },
        ],
      },
    ],
    acceptanceCoverage: {
      deterministicChecks: 0,
      modelReviewChecks: 1,
      totalChecks: 1,
      hasDeterministicCoverage: false,
      hasModelReviewCoverage: true,
    },
    warnings: [
      {
        code: "model_only_acceptance",
        severity: "warning",
        message: "当前验收主要依赖模型复核。",
      },
    ],
    status: "draft",
    createdAt: "2026-07-05T08:00:00.000Z",
    updatedAt: "2026-07-05T08:00:00.000Z",
  };
}

function createPlanFixture(
  partial: Partial<PlanRecord> &
    Pick<PlanRecord, "id" | "sessionId" | "status" | "actionGate">,
): PlanRecord {
  const {
    actionGate,
    id,
    sessionId,
    status,
    ...overrides
  } = partial;
  return {
    id,
    sessionId,
    sourceMessage: "生成一个调用 DBS skill 的本地计划。",
    mode: "debate",
    status,
    actionGate,
    revision: 5,
    taskContract: {
      objective: "生成一个调用 DBS skill 的本地计划。",
      audience: "用户",
      inScope: ["本地实现"],
      outOfScope: ["外部发布"],
      constraints: ["确认前不得执行"],
      successCriteria: ["计划可确认"],
      assumptions: [],
    },
    evidence: [],
    requestedModelAssignments: {},
    frozenModelAssignments: {},
    rounds: [],
    finalArtifact: {
      title: "Waiting plan",
      summary: "等待用户补充信息。",
      objective: "生成一个调用 DBS skill 的本地计划。",
      scope: { in: ["本地实现"], out: ["外部发布"] },
      assumptions: [],
      milestones: [],
      dependencies: [],
      risks: [],
      acceptanceCriteria: ["计划可确认"],
      claimLedger: [],
      unresolvedQuestions: ["DBS skill 在哪里？"],
      minorityOpinion: [],
      actionGate: "needs_input",
      gateReason: "需要用户补充 DBS skill 信息。",
      markdown: "# Waiting plan\n",
    },
    createdAt: "2026-07-30T11:00:00.000Z",
    updatedAt: "2026-07-30T11:01:00.000Z",
    ...overrides,
  };
}

async function createCompleteProfile() {
  return {
    baseUrl: "https://api.example.com/v1",
    apiKey: "secret",
    model: "agent-model",
    temperature: 0.2,
    maxTokens: 8192,
  } satisfies AgentModelProfile;
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

function createSkillRecord(
  partial: {
    name: string;
    body?: string;
    manifest?: Partial<SkillManifest>;
  },
): SkillRecord {
  const name = partial.name;
  return {
    rootDir: `/tmp/skills/${name}`,
    skillFile: `/tmp/skills/${name}/SKILL.md`,
    body: partial.body ?? "Skill body",
    manifest: {
      name,
      displayName: partial.manifest?.displayName ?? name,
      description: partial.manifest?.description ?? `${name} description`,
      version: partial.manifest?.version ?? "0.1.0",
      execution: partial.manifest?.execution ?? {
        mode: "agent",
        entrypoint: null,
      },
      inputs: partial.manifest?.inputs ?? [],
      permissions: partial.manifest?.permissions ?? createSkillPermissions(),
      ...(partial.manifest?.planning ? { planning: partial.manifest.planning } : {}),
      ...(partial.manifest?.tools ? { tools: partial.manifest.tools } : {}),
      ...(partial.manifest?.mcpServers ? { mcpServers: partial.manifest.mcpServers } : {}),
      ...(partial.manifest?.dependencies ? { dependencies: partial.manifest.dependencies } : {}),
    },
  };
}

function createToolExecutor(
  forcedResult?: Awaited<ReturnType<AgentToolExecutor["execute"]>>,
): AgentToolExecutor {
  const registry = createDynamicToolRegistry();
  registry.register(
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
    async () => ({
      ok: true,
      result: { files: ["a.txt", "b.txt"] },
    }),
    "test",
  );
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
      return registry;
    },
    hasTool() {
      return true;
    },
  };
}

function createMemoryWorkspaceRunStore(options: {
  creates: unknown[];
  events: WorkspaceRunEventInput[];
  finishes: Array<{
    workspaceRunId: string;
    status: WorkspaceRunTerminalStatus;
    summary?: string;
  }>;
}) {
  const runs = new Map<string, WorkspaceRun>();
  const eventsByRun = new Map<string, WorkspaceRunEvent[]>();
  return {
    async createRun(input: unknown): Promise<WorkspaceRun> {
      options.creates.push(input);
      const runInput = input as {
        workspaceRunId: string;
        sessionId: string;
        requestId: string;
        workspaceId?: string;
        workspaceRoot?: string;
        selectedSkillName?: string;
        status?: WorkspaceRun["status"];
        createdAt?: string;
      };
      const run: WorkspaceRun = {
        workspaceRunId: runInput.workspaceRunId,
        sessionId: runInput.sessionId,
        requestId: runInput.requestId,
        ...(runInput.workspaceId ? { workspaceId: runInput.workspaceId } : {}),
        ...(runInput.workspaceRoot ? { workspaceRoot: runInput.workspaceRoot } : {}),
        ...(runInput.selectedSkillName
          ? { selectedSkillName: runInput.selectedSkillName }
          : {}),
        status: runInput.status ?? "running",
        createdAt: runInput.createdAt ?? "2026-06-21T08:00:00.000Z",
        updatedAt: runInput.createdAt ?? "2026-06-21T08:00:00.000Z",
      };
      runs.set(run.workspaceRunId, run);
      eventsByRun.set(run.workspaceRunId, []);
      return run;
    },
    async ensureRun(input: Parameters<WorkspaceRunStore["ensureRun"]>[0]) {
      const existing = runs.get(input.workspaceRunId);
      if (existing) return { run: existing, disposition: "existing" as const };
      const run = await this.createRun(input);
      return { run, disposition: "created" as const };
    },
    async appendEvent(
      workspaceRunId: string,
      event: WorkspaceRunEventInput,
    ): Promise<WorkspaceRunEvent> {
      options.events.push(event);
      const stored = {
        ...event,
        id: event.id ?? `event_${options.events.length}`,
        workspaceRunId,
        sessionId: "chat_session_1",
        requestId: "request_1",
        seq: options.events.length,
        createdAt: event.createdAt ?? "2026-06-21T08:00:00.000Z",
      } as WorkspaceRunEvent;
      eventsByRun.set(workspaceRunId, [
        ...(eventsByRun.get(workspaceRunId) ?? []),
        stored,
      ]);
      return stored;
    },
    async getRun(workspaceRunId: string): Promise<WorkspaceRun | null> {
      return runs.get(workspaceRunId) ?? null;
    },
    async listEvents(workspaceRunId: string): Promise<WorkspaceRunEvent[]> {
      return [...(eventsByRun.get(workspaceRunId) ?? [])];
    },
    async finishRun(
      workspaceRunId: string,
      status: WorkspaceRunTerminalStatus,
      summary?: string,
    ): Promise<WorkspaceRun> {
      options.finishes.push({
        workspaceRunId,
        status,
        ...(summary ? { summary } : {}),
      });
      return {
        workspaceRunId,
        sessionId: "chat_session_1",
        requestId: "request_1",
        status,
        ...(summary ? { summary } : {}),
        createdAt: "2026-06-21T08:00:00.000Z",
        updatedAt: "2026-06-21T08:00:01.000Z",
        finishedAt: "2026-06-21T08:00:01.000Z",
      };
    },
    async settleLifecycle(input: Parameters<WorkspaceRunStore["settleLifecycle"]>[0]) {
      const existingEvent = (eventsByRun.get(input.workspaceRunId) ?? [])
        .find((event) => event.id === input.event.id);
      if (existingEvent) {
        return {
          event: existingEvent,
          run: runs.get(input.workspaceRunId)!,
          disposition: "duplicate" as const,
        };
      }
      const existing = runs.get(input.workspaceRunId)!;
      const status = input.snapshotStatus ?? existing.status;
      const event = await this.appendEvent(input.workspaceRunId, {
        ...input.event,
        lifecycleStatus: status,
      });
      const run: WorkspaceRun = {
        ...existing,
        status,
        ...(input.summary ? { summary: input.summary } : {}),
        updatedAt: input.event.createdAt,
        ...(status === "succeeded" || status === "failed" || status === "canceled"
          ? { finishedAt: input.event.createdAt }
          : {}),
      };
      runs.set(input.workspaceRunId, run);
      if (status === "succeeded" || status === "failed" || status === "canceled") {
        options.finishes.push({
          workspaceRunId: input.workspaceRunId,
          status,
          ...(input.summary ? { summary: input.summary } : {}),
        });
      }
      return { event, run, disposition: "applied" as const };
    },
  };
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
    async appendIfAbsent(_runId, _publicationKey, event) {
      const existing = events.find(
        (candidate) => candidate.id === event.id,
      );
      if (existing) {
        return { appended: false, event: existing };
      }
      events.push(structuredClone(event));
      return { appended: true, event };
    },
    async flushShadowWrites() {
      return;
    },
  };
}

function createSkillPermissions(): SkillPermissions {
  return {
    files: { read: [], write: [] },
    shell: { commands: [] },
    web: { search: false, fetchDomains: [] },
    memory: { read: false, write: false },
  };
}

function createSequentialId(prefix: string): () => string {
  let next = 1;
  return () => `${prefix}_${next++}`;
}

function createDeferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) {
      return;
    }
    await flushAsyncTasks();
  }
  throw new Error("Timed out waiting for condition.");
}

async function flushAsyncTasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
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
