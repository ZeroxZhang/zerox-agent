import { describe, expect, it } from "vitest";
import {
  buildDefaultChatShellTemplates,
  createChatService as createProductionChatService,
} from "./chatService";
import type { AgentToolExecutor } from "./agentToolExecutor";
import { runAgentLoop as runProductionAgentLoop } from "./agentLoop";
import type { AgentTrajectoryStore } from "./agentTrajectoryStore";
import { createDynamicToolRegistry } from "./dynamicToolRegistry";
import type { AppendChatMessageInput } from "./chatSessionStore";
import type { ChatClient, ChatMessage, ChatCompletionResponse, StreamingChatClient } from "./openAiCompatibleClient";
import type { RunScheduledTaskResult } from "../shared/agentRuns";
import type { MemoryInput, MemoryRecord, MemorySearchResult } from "../shared/memory";
import type { ScheduledTask, ScheduledTaskInput } from "../shared/scheduledTasks";
import type { SkillRecord } from "../shared/skills";
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

    await expect(second).resolves.toEqual({ ok: false, message: "已中断任务。" });
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
    expect(finalTextPartIndex).toBeGreaterThanOrEqual(0);
    expect(completedIndex).toBeGreaterThan(finalTextPartIndex);
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
    const continuations: Array<{ planId: string; userInput: string }> = [];
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
        async continueWithInput(planId, userInput) {
          continuations.push({ planId, userInput });
          return {
            ok: true as const,
            plan: clarifiedPlan,
            message: "continued",
          };
        },
      },
      async discoverSkills() {
        skillDiscoveryCalls += 1;
        return { skills: [], warnings: [] };
      },
      toolExecutor: createToolExecutor(),
      createId: () => "chat_plan_input",
      now: () => new Date("2026-07-30T11:02:33.000Z"),
    });

    const result = await service.sendMessage({
      sessionId: "persisted_session",
      message: "dbs skill 就在当前技能列表里，其他实现细节你自己决定",
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
        return { skills: [], warnings: [] };
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
        return { skills: [], warnings: [] };
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
        return { skills: [], warnings: [] };
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

    expect(result).toEqual({ ok: false, message: "已中断任务。" });
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
        onStreamEvent(event) {
          streamEvents.push(event);
        },
      },
    );

    expect(result).toEqual({ ok: false, message: "已中断任务。" });
    expect(streamEvents.at(-1)).toMatchObject({
      type: "canceled",
      message: "已中断任务。",
    });
    expect(modelCalls).toBe(0);
  });

  it("does not collect execution-time Skill inputs before creating a read-only Plan", async () => {
    const streamEvents: ChatStreamEvent[] = [];
    const planCreates: Array<{
      sessionId: string;
      sourceMessage: string;
      mode: string;
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
    ).resolves.toEqual({ ok: false, message: "Skill input required." });
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

  it("creates a new retry attempt for a terminal session goal when continuing it", async () => {
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
      reply: "上一次目标已失败，已基于原描述创建新一轮重试：深度调研 Serenity。",
      activeGoal: {
        id: "goal_release",
        description: "深度调研 Serenity",
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
      description: "深度调研 Serenity",
      status: "executing",
    });
    expect(statusEvents.map((event) => event.message)).toContain(
      "已创建新一轮目标重试",
    );
    expect(completeCalled).toBe(false);
  });

  it("continues legacy budget-stopped goals without creating a new retry attempt", async () => {
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
      reply: "继续推进目标：发布。",
      activeGoal: {
        id: "goal_release",
        description: "发布",
        status: "executing",
      },
    });
    expect(goalCreates).toEqual([]);
    expect(resumes).toEqual(["goal_release"]);
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

  it("preserves a failed agent-loop terminal state instead of reporting task completion", async () => {
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
          message: "Token 预算已用尽，任务未完成",
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
          text: "I will inspect. ",
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
          argumentsDelta: '{"path":"/tmp"}',
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
    expect(finalTextPartIndex).toBeGreaterThanOrEqual(0);
    expect(completedIndex).toBeGreaterThan(finalTextPartIndex);
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
    expect(finalTextPart).toMatchObject({
      type: "output_part",
      part: expect.objectContaining({
        type: "text",
        text: exactReply,
      }),
    });
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
      async runAgentLoop(messages, _profile, options) {
        options.onToolInvocation?.({
          id: "approval_1",
          runId: "run_1",
          toolCallId: "tool_approval_1",
          toolName: "shell_exec",
          source: "native",
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

  it("emits immutable output part snapshots for repeated text deltas", async () => {
    const streamEvents: ChatStreamEvent[] = [];
    let retainedFirstTextPart:
      | Extract<ChatOutputPart, { type: "text" }>
      | undefined;
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
      chatSessionStore: createChatSessionStore([]),
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
          if (
            event.type === "output_part" &&
            event.part.type === "text" &&
            !retainedFirstTextPart
          ) {
            retainedFirstTextPart = event.part;
          }
        },
      },
    );

    const latestTextPart = streamEvents
      .filter(
        (event): event is Extract<ChatStreamEvent, { type: "output_part" }> =>
          event.type === "output_part" && event.part.type === "text",
      )
      .at(-1)?.part;
    expect(retainedFirstTextPart).toMatchObject({
      type: "text",
      text: "Hello ",
    });
    expect(latestTextPart).toMatchObject({
      type: "text",
      text: "Hello world",
    });
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
            type: "text",
          }),
        }),
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
    const chatClient: ChatClient & StreamingChatClient = {
      async complete() {
        throw new Error("non-streaming complete should not be used");
      },
      async *streamComplete() {
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
          argumentsDelta: '"}',
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
          args: { skillName: "onepager" },
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
                ...getDefaultTaskPermissionPolicy(),
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
      message: "Skill input required.",
    });
  });

  it("keeps the original guided input request answerable when invalid retry wait persistence fails", async () => {
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
    ).resolves.toMatchObject({
      ok: true,
      reply: "guided retry done",
    });
    expect(agentLoopCalls).toBe(1);
    expect(chatMessages.filter((message) => message.role === "assistant")).toHaveLength(
      1,
    );
  });

  it("does not create a second answerable guided input request when invalid retry completion persistence fails", async () => {
    const chatMessages: AppendChatMessageInput[] = [];
    const initialStreamEvents: ChatStreamEvent[] = [];
    const invalidResponseStreamEvents: ChatStreamEvent[] = [];
    const baseStore = createChatSessionStore(chatMessages);
    let rejectCompletedDuringInvalidRetry = true;
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
          if (
            rejectCompletedDuringInvalidRetry &&
            event.pendingSkillInput?.status === "completed"
          ) {
            throw new Error("completion marker failed");
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
      message: "Skill input required.",
    });

    const retryInputRequest = invalidResponseStreamEvents.find(
      (event): event is Extract<ChatStreamEvent, { type: "waiting_for_input" }> =>
        event.type === "waiting_for_input",
    )?.inputRequest;
    expect(retryInputRequest?.id).toBe(inputRequest?.id);
    rejectCompletedDuringInvalidRetry = false;

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
                ...getDefaultTaskPermissionPolicy(),
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
          if (event.pendingSkillInput?.status === "completed") {
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
      message: "Failed to persist skill input completion.",
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
          if (event.pendingSkillInput?.status === "completed") {
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
      message: "Failed to persist skill input completion.",
    });
    expect(agentLoopCalls).toBe(0);
    expect(chatMessages.filter((message) => message.role === "assistant")).toEqual(
      [],
    );
  });

  it("rejects concurrent guided input responses while the durable completion claim is in flight", async () => {
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
          if (event.pendingSkillInput?.status === "completed") {
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

  it("recovers pending guided skill input from persisted session activity after service restart", async () => {
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
                ...getDefaultTaskPermissionPolicy(),
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

    expect(result).toMatchObject({
      ok: true,
      sessionId: "session_1",
      reply: "recovered guided skill done",
      selectedSkill: { name: "local-file-organizer" },
    });
    expect(chatMessages.filter((message) => message.role === "user")).toEqual([
      expect.objectContaining({
        role: "user",
        content: "organize files after restart",
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
    expect(capturedMessages.at(-1)?.[0]?.content ?? "").toContain(
      '"targetDir": "/workspace/project/docs"',
    );
    expect(observedRuntimeTask).toMatchObject({
      permissions: {
        files: {
          read: expect.arrayContaining(["/workspace/project/docs"]),
          write: expect.arrayContaining(["/workspace/project/docs"]),
        },
      },
    });

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
      message: "Unknown skill input request.",
    });
    expect(capturedMessages).toHaveLength(1);
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
      message: "Failed to persist skill input completion.",
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

  it("keeps guided-skill attachment bytes in bounded memory while persisting metadata only", async () => {
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
    ).resolves.toEqual({ ok: false, message: "Skill input required." });

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
    expect(JSON.stringify(pendingEvent)).not.toContain("dataBase64");

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

  it("expires a guided-skill attachment payload before responding after its TTL", async () => {
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
    ).resolves.toEqual({
      ok: false,
      message:
        "附件内容在应用重启或长时间等待后已失效，请重新发送消息并粘贴附件。",
    });
    expect(chatCalls).toBe(0);
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
        role: input.role,
        content: input.content,
        ...(inputWithOutputParts.outputParts
          ? { outputParts: inputWithOutputParts.outputParts }
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
    async appendActivityEvent(sessionId: string, event: ChatTaskStatusEvent) {
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
  return {
    id: partial.id,
    sessionId: partial.sessionId,
    sourceMessage: "生成一个调用 DBS skill 的本地计划。",
    mode: "debate",
    status: partial.status,
    actionGate: partial.actionGate,
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
    ...partial,
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

function createSkillRecord(
  partial: Partial<SkillRecord> & Pick<SkillRecord["manifest"], "name"> & { body?: string },
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
      permissions: partial.manifest?.permissions ?? getDefaultTaskPermissionPolicy(),
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

function createMemoryWorkspaceRunStore(options: {
  creates: unknown[];
  events: WorkspaceRunEventInput[];
  finishes: Array<{
    workspaceRunId: string;
    status: WorkspaceRunTerminalStatus;
    summary?: string;
  }>;
}) {
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
      return {
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
    },
    async appendEvent(
      workspaceRunId: string,
      event: WorkspaceRunEventInput,
    ): Promise<WorkspaceRunEvent> {
      options.events.push(event);
      return {
        ...event,
        id: `event_${options.events.length}`,
        workspaceRunId,
        sessionId: "chat_session_1",
        requestId: "request_1",
        seq: options.events.length,
        createdAt: event.createdAt ?? "2026-06-21T08:00:00.000Z",
      } as WorkspaceRunEvent;
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
  for (let attempt = 0; attempt < 20; attempt += 1) {
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
