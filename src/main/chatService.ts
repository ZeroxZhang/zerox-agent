import { randomUUID } from "node:crypto";
import type { AgentModelProfile } from "./agentRunnerService";
import type { AgentToolExecutor } from "./agentToolExecutor";
import { runAgentLoop } from "./agentLoop";
import type { AppendChatMessageResult, ChatSessionStore } from "./chatSessionStore";
import type { MemoryStore } from "./memoryStore";
import {
  formatMemoryRecallContext,
  recallMemoriesWithBudget,
} from "./memoryRecall";
import type { ChatClient, ChatMessage } from "./openAiCompatibleClient";
import type { ScheduledTaskStore } from "./taskStore";
import type { ToolAuthorizationService } from "./toolAuthorizationService";
import type {
  ChatRelatedMemory,
  SendChatMessageInput,
  SendChatMessageResult,
} from "../shared/chat";
import type { AgentRunRecord, RunScheduledTaskResult } from "../shared/agentRuns";
import type { MemoryRecord, MemorySearchResult } from "../shared/memory";
import {
  buildScheduledTaskInputFromIntent,
  classifyAgentIntent,
  matchTaskFromMessage,
  type AgentIntentRoute,
} from "../shared/agentIntent";
import { describeSchedule } from "../shared/scheduledTasks";

export type ChatService = {
  sendMessage(input: SendChatMessageInput): Promise<SendChatMessageResult>;
};

export function createChatService(options: {
  chatClient: ChatClient;
  getModelProfile: () => Promise<AgentModelProfile>;
  memoryStore: Pick<MemoryStore, "create" | "search">;
  chatSessionStore?: Pick<ChatSessionStore, "appendMessage">;
  taskStore?: Pick<ScheduledTaskStore, "create" | "list">;
  runScheduledTask?: (taskId: string) => Promise<RunScheduledTaskResult>;
  toolExecutor?: AgentToolExecutor;
  toolAuthorizationService?: ToolAuthorizationService;
  createId?: () => string;
  now?: () => Date;
  memoryLimit?: number;
  historyLimit?: number;
}): ChatService {
  const createId = options.createId ?? randomUUID;
  const memoryLimit = options.memoryLimit ?? 4;
  const historyLimit = options.historyLimit ?? 12;

  return {
    async sendMessage(input) {
      const userMessage = input.message.trim();
      if (!userMessage) {
        return { ok: false, message: "消息不能为空。" };
      }

      let sessionId = input.sessionId ?? createId();
      let userMessageId: string | null = null;
      if (options.chatSessionStore) {
        const appendResult = await options.chatSessionStore.appendMessage({
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          role: "user",
          content: userMessage,
        });
        sessionId = appendResult.session.id;
        userMessageId = appendResult.message.id;
      }
      const intentRoute = classifyAgentIntent(userMessage);
      const taskCreationResult = await tryCreateTaskFromIntent({
        route: intentRoute,
        taskStore: options.taskStore,
      });

      if (taskCreationResult) {
        if (!taskCreationResult.ok) {
          return taskCreationResult.result;
        }

        const assistantMessageId = await appendAssistantMessage({
          chatSessionStore: options.chatSessionStore,
          sessionId,
          content: taskCreationResult.result.reply,
        });
        const memoryId = await writeSessionMemory({
          memoryStore: options.memoryStore,
          sessionId,
          userMessage,
          reply: taskCreationResult.result.reply,
          messageIds: compactMessageIds(userMessageId, assistantMessageId),
        });

        return {
          ...taskCreationResult.result,
          sessionId,
          relatedMemories: [],
          memoryId,
        };
      }
      const taskRunResult = await tryRunTaskFromIntent({
        route: intentRoute,
        message: userMessage,
        taskStore: options.taskStore,
        runScheduledTask: options.runScheduledTask,
      });

      if (taskRunResult) {
        if (!taskRunResult.ok) {
          return taskRunResult.result;
        }

        const assistantMessageId = await appendAssistantMessage({
          chatSessionStore: options.chatSessionStore,
          sessionId,
          content: taskRunResult.result.reply,
          executedRunId: taskRunResult.result.executedRun?.id,
        });
        const memoryId = await writeSessionMemory({
          memoryStore: options.memoryStore,
          sessionId,
          userMessage,
          reply: taskRunResult.result.reply,
          messageIds: compactMessageIds(userMessageId, assistantMessageId),
        });

        return {
          ...taskRunResult.result,
          sessionId,
          relatedMemories: [],
          memoryId,
        };
      }

      let profile: AgentModelProfile;
      try {
        profile = await options.getModelProfile();
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("Model profile is incomplete")
        ) {
          return {
            ok: false,
            message:
              "模型配置不完整：请先在设置中保存 base URL、对话模型和 API Key。",
          };
        }

        return {
          ok: false,
          message:
            error instanceof Error ? error.message : "无法读取模型配置。",
        };
      }

      const relatedMemoryResults = await searchRelatedMemories({
        memoryStore: options.memoryStore,
        query: userMessage,
        limit: memoryLimit,
      });
      const chatMessages = buildChatMessages({
        userMessage,
        history: input.history ?? [],
        relatedMemoryResults,
        historyLimit,
      });

      let reply: string;
      let toolCallsUsed = 0;

      if (options.toolExecutor) {
        // Unified agent mode: chat goes through agent loop with tool access
        try {
          const loopResult = await runAgentLoop(
            chatMessages,
            profile,
            {
              chatClient: options.chatClient,
              toolExecutor: options.toolExecutor,
              toolAuthorizationService: options.toolAuthorizationService,
              systemPrompt: buildChatSystemPrompt(),
              maxTurns: 6,
              signal: undefined,
              tools: options.toolExecutor.getRegistry().getDefinitions(),
            },
          );
          reply = loopResult.summary;
          toolCallsUsed = loopResult.toolCallsExecuted;

          if (toolCallsUsed > 0) {
            reply = `🔧 使用了 ${toolCallsUsed} 个工具\n\n${reply}`;
          }
        } catch (error) {
          return {
            ok: false,
            message:
              error instanceof Error ? `Agent 执行失败：${error.message}` : "Agent 执行失败。",
          };
        }
      } else {
        // Fallback: simple LLM chat (no tools)
        try {
          const messages: ChatMessage[] = [
            { role: "system", content: buildChatSystemPrompt() },
            ...chatMessages,
          ];
          const response = await options.chatClient.complete({
            ...profile,
            messages,
          });
          reply = response.content ?? "";
        } catch (error) {
          return {
            ok: false,
            message:
              error instanceof Error ? `模型调用失败：${error.message}` : "模型调用失败。",
          };
        }
      }

      const assistantMessageId = await appendAssistantMessage({
        chatSessionStore: options.chatSessionStore,
        sessionId,
        content: reply,
        relatedMemoryIds: relatedMemoryResults.map((result) => result.record.id),
      });
      const memoryId = await writeSessionMemory({
        memoryStore: options.memoryStore,
        sessionId,
        userMessage,
        reply,
        messageIds: compactMessageIds(userMessageId, assistantMessageId),
      });

      return {
        ok: true,
        reply,
        sessionId,
        relatedMemories: relatedMemoryResults.map(toRelatedMemory),
        memoryId,
      };
    },
  };
}

async function appendAssistantMessage(options: {
  chatSessionStore: Pick<ChatSessionStore, "appendMessage"> | undefined;
  sessionId: string;
  content: string;
  relatedMemoryIds?: string[];
  executedRunId?: string;
}): Promise<string | null> {
  if (!options.chatSessionStore) {
    return null;
  }

  const appendResult: AppendChatMessageResult =
    await options.chatSessionStore.appendMessage({
      sessionId: options.sessionId,
      role: "assistant",
      content: options.content,
      ...(options.relatedMemoryIds?.length
        ? { relatedMemoryIds: options.relatedMemoryIds }
        : {}),
      ...(options.executedRunId ? { executedRunId: options.executedRunId } : {}),
    });
  return appendResult.message.id;
}

type TaskRunDetection =
  | {
      ok: true;
      result: Extract<SendChatMessageResult, { ok: true }>;
    }
  | {
      ok: false;
      result: Extract<SendChatMessageResult, { ok: false }>;
    };

type TaskCreationDetection =
  | {
      ok: true;
      result: Extract<SendChatMessageResult, { ok: true }>;
    }
  | {
      ok: false;
      result: Extract<SendChatMessageResult, { ok: false }>;
    };

async function tryCreateTaskFromIntent(options: {
  route: AgentIntentRoute;
  taskStore: Pick<ScheduledTaskStore, "create"> | undefined;
}): Promise<TaskCreationDetection | null> {
  if (options.route.kind !== "create_task") {
    return null;
  }

  if (!options.taskStore) {
    return null;
  }

  if (options.route.missingSlots.length > 0 && options.route.clarification) {
    return {
      ok: true,
      result: {
        ok: true,
        reply: options.route.clarification,
        sessionId: "",
        relatedMemories: [],
        memoryId: null,
      },
    };
  }

  const draft = buildScheduledTaskInputFromIntent(options.route);
  if (!draft) {
    return null;
  }

  try {
    const task = await options.taskStore.create(draft);
    return {
      ok: true,
      result: {
        ok: true,
        reply: `已创建任务“${task.name}”，调度：${describeSchedule(task.schedule)}。你可以在“任务”页检查权限后运行。`,
        sessionId: "",
        relatedMemories: [],
        memoryId: null,
        createdTask: task,
      },
    };
  } catch (error) {
    return {
      ok: false,
      result: {
        ok: false,
        message:
          error instanceof Error ? `创建任务失败：${error.message}` : "创建任务失败。",
      },
    };
  }
}

async function tryRunTaskFromIntent(options: {
  route: AgentIntentRoute;
  message: string;
  taskStore: Pick<ScheduledTaskStore, "list"> | undefined;
  runScheduledTask: ((taskId: string) => Promise<RunScheduledTaskResult>) | undefined;
}): Promise<TaskRunDetection | null> {
  if (options.route.kind !== "run_task") {
    return null;
  }

  if (!options.taskStore || !options.runScheduledTask) {
    return null;
  }

  const tasks = await options.taskStore.list();
  const matchedTask = matchTaskFromMessage(options.message, tasks);

  if (!matchedTask) {
    return {
      ok: false,
      result: {
        ok: false,
        message: "没有找到匹配的本地任务。请先在“任务”里创建任务，或在消息里写清楚任务名称。",
      },
    };
  }

  const runResult = await options.runScheduledTask(matchedTask.id);
  if (!runResult.ok) {
    return {
      ok: false,
      result: {
        ok: false,
        message: `任务“${matchedTask.name}”没有运行成功：${runResult.message}`,
      },
    };
  }

  return {
    ok: true,
    result: {
      ok: true,
      reply: formatTaskRunReply(runResult.run),
      sessionId: "",
      relatedMemories: [],
      memoryId: null,
      executedRun: runResult.run,
    },
  };
}

function formatTaskRunReply(run: AgentRunRecord): string {
  return `已运行任务“${run.taskName}”，结果：${translateRunStatus(run.status)}。摘要：${run.summary}`;
}

function translateRunStatus(status: AgentRunRecord["status"]): string {
  if (status === "succeeded") {
    return "成功";
  }

  if (status === "canceled") {
    return "已取消";
  }

  return "失败";
}

function buildChatSystemPrompt(): string {
  return [
    "你是一个本地优先的桌面 Agent，运行在用户的电脑上。",
    "默认使用中文回答。",
    "你可以使用工具来帮助用户：查看文件、搜索网页、执行受权的 shell 命令。",
    "涉及文件、网页或命令行的操作，直接调用工具执行，并在回复中说明你做了什么。",
    "回答要直接、可执行，避免空泛寒暄。",
    "如果有相关记忆，优先参考记忆中的信息。",
  ].join("\n");
}

function buildChatMessages(options: {
  userMessage: string;
  history: SendChatMessageInput["history"];
  relatedMemoryResults: MemorySearchResult[];
  historyLimit: number;
}): ChatMessage[] {
  const messages: ChatMessage[] = [];
  const memoryContext = formatMemoryContext(options.relatedMemoryResults);

  if (memoryContext) {
    messages.push({ role: "system", content: memoryContext });
  }

  for (const message of (options.history ?? []).slice(-options.historyLimit)) {
    messages.push({
      role: message.role,
      content: message.content,
    });
  }

  messages.push({ role: "user", content: options.userMessage });
  return messages;
}

function formatMemoryContext(results: MemorySearchResult[]): string | null {
  return formatMemoryRecallContext(results, {
    heading: "相关记忆：",
    maxCharsPerMemory: 240,
    maxTotalRecallChars: 1_200,
  });
}

async function searchRelatedMemories(options: {
  memoryStore: Pick<MemoryStore, "search">;
  query: string;
  limit: number;
}): Promise<MemorySearchResult[]> {
  return recallMemoriesWithBudget({
    memoryStore: options.memoryStore,
    query: options.query,
    kind: "all",
    limit: options.limit,
  });
}

async function writeSessionMemory(options: {
  memoryStore: Pick<MemoryStore, "create">;
  sessionId: string;
  userMessage: string;
  reply: string;
  messageIds: string[];
}): Promise<string | null> {
  try {
    const memory = await options.memoryStore.create({
      kind: "session",
      title: `会话：${truncateText(options.userMessage, 28)}`,
      content: `用户：${options.userMessage}\nAgent：${options.reply}`,
      tags: ["chat", "session"],
      source: options.messageIds.length
        ? {
            type: "chat_session",
            sessionId: options.sessionId,
            messageIds: options.messageIds,
          }
        : { type: "system" },
      importance: 2,
    });
    return memory.id;
  } catch {
    return null;
  }
}

function compactMessageIds(...ids: Array<string | null>): string[] {
  return ids.filter((id): id is string => Boolean(id));
}

function toRelatedMemory(result: MemorySearchResult): ChatRelatedMemory {
  return {
    id: result.record.id,
    title: result.record.title,
    kind: result.record.kind,
    score: result.score,
  };
}

function truncateText(value: string, maxLength: number): string {
  const normalized = value.trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1)}…`;
}
