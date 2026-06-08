import { describe, expect, it } from "vitest";
import { createChatService } from "./chatService";
import type { AppendChatMessageInput } from "./chatSessionStore";
import type { ChatClient, ChatMessage, ChatCompletionResponse } from "./openAiCompatibleClient";
import type { RunScheduledTaskResult } from "../shared/agentRuns";
import type { MemoryInput, MemoryRecord, MemorySearchResult } from "../shared/memory";
import type { ScheduledTask, ScheduledTaskInput } from "../shared/scheduledTasks";
import { getDefaultTaskPermissionPolicy } from "../shared/toolPermissions";

function chatReply(content: string): ChatCompletionResponse {
  return { content, toolCalls: [], finishReason: "stop" };
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
        source: { type: "system" },
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
  return {
    async search() {
      return options.searchResults ?? [];
    },
    async create(input: MemoryInput) {
      options.memoryWrites?.push(input);
      return createMemoryRecord({
        id: "created_memory",
        title: input.title,
        content: input.content,
        tags: input.tags ?? [],
        kind: input.kind === "session" ? "session" : "semantic",
      });
    },
  };
}

function createChatSessionStore(messages: AppendChatMessageInput[]) {
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
          createdAt: "2026-06-06T08:00:00.000Z",
          updatedAt: "2026-06-06T08:00:00.000Z",
        },
      };
    },
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

function createMemoryRecord(
  partial: Partial<MemoryRecord> & Pick<MemoryRecord, "id" | "title" | "content">,
): MemoryRecord {
  return {
    kind: "semantic",
    tags: [],
    source: { type: "manual" },
    importance: 3,
    createdAt: "2026-06-06T08:00:00.000Z",
    updatedAt: "2026-06-06T08:00:00.000Z",
    ...partial,
  };
}
