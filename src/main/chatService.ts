import { randomUUID } from "node:crypto";
import type { AgentModelProfile } from "./agentRunnerService";
import type { AgentToolExecutor } from "./agentToolExecutor";
import { createChatAgentEvidenceRecorder } from "./chatAgentEvidence";
import type { AgentTrajectoryStore } from "./agentTrajectoryStore";
import { runAgentLoop } from "./agentLoop";
import type { AppendChatMessageResult, ChatSessionStore } from "./chatSessionStore";
import { extractAtomicMemoriesFromChatTurn } from "./memoryL1Extractor";
import type { MemoryProfileStore } from "./memoryProfileStore";
import type { MemoryStore } from "./memoryStore";
import type { ToolResultOffloadStore } from "./toolResultOffloadStore";
import {
  formatMemoryRecallContext,
  recallMemoriesWithBudget,
} from "./memoryRecall";
import type { ChatClient, ChatMessage } from "./openAiCompatibleClient";
import type { ScheduledTaskStore } from "./taskStore";
import type { ToolAuthorizationService } from "./toolAuthorizationService";
import type {
  ChatAgentStatus,
  ChatRelatedMemory,
  ChatSessionGoalSummary,
  ChatTaskStatusEvent,
  SendChatMessageInput,
  SendChatMessageResult,
} from "../shared/chat";
import type { GoalReviewDecision } from "../shared/agentGoalReview";
import type { AgentRunRecord, RunScheduledTaskResult } from "../shared/agentRuns";
import type { MemoryRecord, MemorySearchResult } from "../shared/memory";
import type { NativeToolDescriptor } from "../shared/nativeCapabilities";
import {
  buildScheduledTaskInputFromIntent,
  classifyAgentIntent,
  matchTaskFromMessage,
  type AgentIntentRoute,
} from "../shared/agentIntent";
import { describeSchedule } from "../shared/scheduledTasks";

export type ChatService = {
  sendMessage(
    input: SendChatMessageInput,
    options?: SendChatMessageRuntimeOptions,
  ): Promise<SendChatMessageResult>;
};

export type SendChatMessageRuntimeOptions = {
  signal?: AbortSignal;
  onStatusEvent?: (event: ChatTaskStatusEvent) => void;
};

type ChatContinuationState = {
  messages: ChatMessage[];
  maxTurns: number;
  toolCallsExecuted: number;
  evidenceRunId?: string;
};

type ChatGoalService = {
  createFromChat(input: {
    sessionId: string;
    originMessageId: string | null;
    description: string;
  }): Promise<ChatSessionGoalSummary>;
  resume(
    goalId: string,
    options?: { signal?: AbortSignal },
  ): Promise<ChatSessionGoalSummary>;
  pause(goalId: string): Promise<ChatSessionGoalSummary>;
  cancel(goalId: string): Promise<ChatSessionGoalSummary>;
  resolveReview(
    goalId: string,
    decision: GoalReviewDecision,
  ): Promise<ChatSessionGoalSummary>;
};

type GoalIntentRoute =
  | { kind: "set_goal"; description: string }
  | { kind: "continue_goal" }
  | { kind: "pause_goal" }
  | { kind: "cancel_goal" }
  | { kind: "modify_goal"; instructions: string }
  | { kind: "none" };

export function createChatService(options: {
  chatClient: ChatClient;
  getModelProfile: () => Promise<AgentModelProfile>;
  memoryStore: Pick<MemoryStore, "create" | "search">;
  memoryProfileStore?: MemoryProfileStore;
  chatSessionStore?: Pick<
    ChatSessionStore,
    "appendMessage" | "attachGoal" | "clearActiveGoal"
  >;
  goalService?: ChatGoalService;
  taskStore?: Pick<ScheduledTaskStore, "create" | "list">;
  runScheduledTask?: (taskId: string) => Promise<RunScheduledTaskResult>;
  toolExecutor?: AgentToolExecutor;
  toolAuthorizationService?: ToolAuthorizationService;
  createId?: () => string;
  now?: () => Date;
  memoryLimit?: number;
  historyLimit?: number;
  agentLoopMaxTurns?: number;
  toolResultOffloadStore?: ToolResultOffloadStore;
  toolResultOffloadThreshold?: number;
  trajectoryStore?: AgentTrajectoryStore;
}): ChatService {
  const createId = options.createId ?? randomUUID;
  const memoryLimit = options.memoryLimit ?? 4;
  const historyLimit = options.historyLimit ?? 12;
  const agentLoopMaxTurns = normalizeAgentLoopMaxTurns(options.agentLoopMaxTurns);
  const pendingContinuations = new Map<string, ChatContinuationState>();

  return {
    async sendMessage(input, runtimeOptions = {}) {
      const userMessage = input.message.trim();
      if (!userMessage) {
        return { ok: false, message: "消息不能为空。" };
      }

      let sessionId = input.sessionId ?? createId();
      const startedAtMs = getNowMs(options.now);
      const emitStatus = createChatStatusEmitter({
        sessionId,
        startedAtMs,
        now: options.now,
        onStatusEvent: runtimeOptions.onStatusEvent,
      });
      let userMessageId: string | null = null;
      let activeGoal: ChatSessionGoalSummary | null = null;
      if (options.chatSessionStore) {
        const appendResult = await options.chatSessionStore.appendMessage({
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          role: "user",
          content: userMessage,
        });
        sessionId = appendResult.session.id;
        emitStatus.setSessionId(sessionId);
        userMessageId = appendResult.message.id;
        activeGoal = getActiveGoalSummary(appendResult.session);
      }

      const goalRoute = await tryRouteGoalIntent({
        route: detectGoalIntent(userMessage),
        activeGoal,
        chatSessionStore: options.chatSessionStore,
        goalService: options.goalService,
        originMessageId: userMessageId,
        sessionId,
        emitStatus,
        signal: runtimeOptions.signal,
      });

      if (goalRoute) {
        return goalRoute.result;
      }

      const pendingContinuation = pendingContinuations.get(sessionId);
      const continuationToResume =
        pendingContinuation && isContinuationRequest(userMessage)
          ? pendingContinuation
          : null;

      if (!continuationToResume && pendingContinuation) {
        pendingContinuations.delete(sessionId);
      }

      if (!continuationToResume) {
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
          await writeAtomicMemories({
            memoryStore: options.memoryStore,
            memoryProfileStore: options.memoryProfileStore,
            sessionId,
            userMessageId,
            assistantMessageId,
            userMessage,
            assistantReply: taskCreationResult.result.reply,
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
          await writeAtomicMemories({
            memoryStore: options.memoryStore,
            memoryProfileStore: options.memoryProfileStore,
            sessionId,
            userMessageId,
            assistantMessageId,
            userMessage,
            assistantReply: taskRunResult.result.reply,
          });

          return {
            ...taskRunResult.result,
            sessionId,
            relatedMemories: [],
            memoryId,
          };
        }
      }

      let profile: AgentModelProfile;
      try {
        emitStatus.send({
          state: "started",
          message: "正在读取模型配置",
        });
        profile = await options.getModelProfile();
      } catch (error) {
        emitStatus.send({
          state: "failed",
          message:
            error instanceof Error ? error.message : "无法读取模型配置。",
        });
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

      let relatedMemoryResults: MemorySearchResult[] = [];
      let chatMessages: ChatMessage[] = [];
      if (continuationToResume) {
        chatMessages = buildContinuationMessages({
          continuation: continuationToResume,
          userMessage,
        });
      } else {
        emitStatus.send({
          state: "memory",
          message: "正在检索相关记忆",
        });
        relatedMemoryResults = await searchRelatedMemories({
          memoryStore: options.memoryStore,
          query: userMessage,
          limit: memoryLimit,
        });
        chatMessages = buildChatMessages({
          userMessage,
          history: input.history ?? [],
          relatedMemoryResults,
          historyLimit,
        });
      }

      let reply: string;
      let toolCallsUsed = 0;
      let agentStatus: ChatAgentStatus | undefined;

      if (options.toolExecutor) {
        // Unified agent mode: chat goes through agent loop with tool access
        try {
          const toolExecutor = options.toolExecutor;
          let observedToolCallsExecuted =
            continuationToResume?.toolCallsExecuted ?? 0;
          const evidence = createChatAgentEvidenceRecorder({
            trajectoryStore: options.trajectoryStore,
            runId: continuationToResume?.evidenceRunId,
            createId,
            now: options.now,
          });
          const loopResult = await runAgentLoop(
            chatMessages,
            profile,
            {
              chatClient: options.chatClient,
              toolExecutor,
              toolAuthorizationService: options.toolAuthorizationService,
              systemPrompt: buildChatSystemPrompt(),
              maxTurns: agentLoopMaxTurns,
              signal: runtimeOptions.signal,
              tools: toolExecutor.getRegistry().getDefinitions(),
              toolResultOffloadStore: options.toolResultOffloadStore,
              toolResultOffloadThreshold: options.toolResultOffloadThreshold,
              pauseOnTurnLimit: true,
              pauseOnFailureLoop: true,
              ...(continuationToResume
                ? {
                    resumeMessages: chatMessages,
                    initialToolCallsExecuted:
                      continuationToResume.toolCallsExecuted,
                  }
                : {}),
              onTurn(turn, phase) {
                void evidence.append("model_request", {
                  turn: turn + 1,
                  phase,
                });
                if (phase === "executing") {
                  emitStatus.send({
                    state: "model",
                    message: `正在调用模型（第 ${turn + 1} 轮）`,
                    turn: turn + 1,
                    toolCallsExecuted: observedToolCallsExecuted,
                  });
                }
              },
              onModelResponse(response, turn) {
                void evidence.append("model_response", {
                  turn,
                  hasContent: Boolean(response.content),
                  toolCallCount: response.toolCalls.length,
                  finishReason: response.finishReason,
                });
              },
              onReasoning(reasoningContent) {
                emitStatus.send({
                  state: "reasoning",
                  message: normalizeReasoningForStatus(reasoningContent),
                  toolCallsExecuted: observedToolCallsExecuted,
                });
              },
              onToolCall(toolName, args) {
                void evidence.append("tool_call", { toolName, args });
                const nativeDescriptor = getNativeToolDescriptor(
                  toolExecutor,
                  toolName,
                );
                if (nativeDescriptor) {
                  void evidence.append("native_tool_invocation", {
                    ...buildNativeToolEvidencePayload(nativeDescriptor),
                  });
                }
                emitStatus.send({
                  state: "tool_call",
                  message: `正在调用工具：${toolName}`,
                  toolName,
                  toolCallsExecuted: observedToolCallsExecuted,
                });
              },
              onToolResult(toolName, ok, result) {
                observedToolCallsExecuted += 1;
                const nativeDescriptor = getNativeToolDescriptor(
                  toolExecutor,
                  toolName,
                );
                if (nativeDescriptor) {
                  void evidence.append("native_tool_observation", {
                    ...buildNativeToolEvidencePayload(nativeDescriptor),
                    ok,
                    ...(ok && result && typeof result === "object"
                      ? { resultKeys: Object.keys(result).slice(0, 10) }
                      : {}),
                  });
                }
                void evidence.append("tool_result", { toolName, ok });
                emitStatus.send({
                  state: "tool_result",
                  message: buildToolResultStatusMessage(toolName, result),
                  toolName,
                  ok,
                  toolCallsExecuted: observedToolCallsExecuted,
                });
              },
            },
          );
          reply = loopResult.summary;
          toolCallsUsed = loopResult.toolCallsExecuted;
          await evidence.append("final_summary", {
            status: loopResult.status,
            toolCallsExecuted: loopResult.toolCallsExecuted,
          });

          if (loopResult.status === "canceled") {
            emitStatus.send({
              state: "canceled",
              message: "任务已中断",
              toolCallsExecuted: loopResult.toolCallsExecuted,
            });
            return {
              ok: false,
              message: "已中断任务。",
            };
          }

          if (loopResult.status === "paused" && loopResult.continuation) {
            pendingContinuations.set(sessionId, {
              messages: loopResult.messages,
              maxTurns: loopResult.continuation.maxTurns,
              toolCallsExecuted: loopResult.continuation.toolCallsExecuted,
              evidenceRunId: evidence.runId,
            });
            agentStatus = {
              state: "paused",
              runId: evidence.runId,
              reason: loopResult.continuation.reason,
              maxTurns: loopResult.continuation.maxTurns,
              toolCallsExecuted: loopResult.continuation.toolCallsExecuted,
              message: loopResult.summary,
            };
            emitStatus.send({
              state: "paused",
              message:
                loopResult.continuation.reason === "tool_failure_loop"
                  ? "连续工具失败，等待确认"
                  : "已到达检查点，等待确认",
              maxTurns: loopResult.continuation.maxTurns,
              toolCallsExecuted: loopResult.continuation.toolCallsExecuted,
            });
          } else {
            pendingContinuations.delete(sessionId);
            agentStatus = {
              state: "completed",
              runId: evidence.runId,
              toolCallsExecuted: loopResult.toolCallsExecuted,
            };
            emitStatus.send({
              state: "completed",
              message: "任务已完成",
              toolCallsExecuted: loopResult.toolCallsExecuted,
            });
          }

          if (toolCallsUsed > 0) {
            reply = `🔧 使用了 ${toolCallsUsed} 个工具\n\n${reply}`;
          }
        } catch (error) {
          if (isAbortError(error, runtimeOptions.signal)) {
            emitStatus.send({
              state: "canceled",
              message: "任务已中断",
            });
            return {
              ok: false,
              message: "已中断任务。",
            };
          }
          emitStatus.send({
            state: "failed",
            message:
              error instanceof Error ? `Agent 执行失败：${error.message}` : "Agent 执行失败。",
          });
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
            ...(runtimeOptions.signal ? { signal: runtimeOptions.signal } : {}),
          });
          if (response.reasoningContent) {
            emitStatus.send({
              state: "reasoning",
              message: normalizeReasoningForStatus(response.reasoningContent),
              toolCallsExecuted: 0,
            });
          }
          reply = response.content ?? "";
          emitStatus.send({
            state: "completed",
            message: "任务已完成",
            toolCallsExecuted: 0,
          });
        } catch (error) {
          if (isAbortError(error, runtimeOptions.signal)) {
            emitStatus.send({
              state: "canceled",
              message: "任务已中断",
            });
            return {
              ok: false,
              message: "已中断任务。",
            };
          }
          emitStatus.send({
            state: "failed",
            message:
              error instanceof Error ? `模型调用失败：${error.message}` : "模型调用失败。",
          });
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
      await writeAtomicMemories({
        memoryStore: options.memoryStore,
        memoryProfileStore: options.memoryProfileStore,
        sessionId,
        userMessageId,
        assistantMessageId,
        userMessage,
        assistantReply: reply,
      });

      return {
        ok: true,
        reply,
        sessionId,
        relatedMemories: relatedMemoryResults.map(toRelatedMemory),
        memoryId,
        ...(agentStatus ? { agentStatus } : {}),
      };
    },
  };
}

const defaultChatAgentLoopMaxTurns = 48;

function normalizeAgentLoopMaxTurns(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return defaultChatAgentLoopMaxTurns;
  }

  return Math.max(1, Math.floor(value));
}

function createChatStatusEmitter(options: {
  sessionId: string;
  startedAtMs: number;
  now?: () => Date;
  onStatusEvent?: (event: ChatTaskStatusEvent) => void;
}) {
  let sessionId = options.sessionId;

  return {
    setSessionId(nextSessionId: string) {
      sessionId = nextSessionId;
    },
    send(event: Omit<ChatTaskStatusEvent, "sessionId" | "createdAt" | "elapsedMs">) {
      if (!options.onStatusEvent) {
        return;
      }

      const nowMs = getNowMs(options.now);
      options.onStatusEvent({
        ...event,
        sessionId,
        createdAt: new Date(nowMs).toISOString(),
        elapsedMs: Math.max(0, nowMs - options.startedAtMs),
      });
    },
  };
}

function getNowMs(now: (() => Date) | undefined): number {
  return now ? now().getTime() : Date.now();
}

function normalizeReasoningForStatus(reasoningContent: string): string {
  return reasoningContent
    .replace(/<\/?think>/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildToolResultStatusMessage(
  toolName: string,
  result: Awaited<ReturnType<AgentToolExecutor["execute"]>>,
): string {
  if (result.ok) {
    return `工具完成：${toolName}`;
  }

  const details = result.errorDetails;
  if (details?.kind === "timeout") {
    return `工具失败：${toolName}（超时 ${details.timeoutMs} ms）`;
  }
  if (details?.kind === "canceled") {
    return `工具中断：${toolName}`;
  }
  if (details?.kind === "empty_exit") {
    return `工具失败：${toolName}（退出码 ${details.exitCode ?? 1}，无 stdout/stderr）`;
  }
  if (typeof details?.exitCode === "number") {
    return `工具失败：${toolName}（退出码 ${details.exitCode}）`;
  }

  return `工具失败：${toolName}`;
}

function isAbortError(error: unknown, signal: AbortSignal | undefined): boolean {
  if (signal?.aborted) {
    return true;
  }

  return error instanceof Error && /abort|aborted|cancel|canceled|cancelled|中断|取消/i.test(error.message);
}

function isContinuationRequest(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  const compact = normalized.replace(/\s+/g, "");

  return (
    /^(继续|接着|续跑|继续执行|接着执行|继续吧|接着跑)/.test(compact) ||
    /^(continue|resume|go on)\b/.test(normalized)
  );
}

function detectGoalIntent(message: string): GoalIntentRoute {
  const compact = message.trim();
  if (!compact) {
    return { kind: "none" };
  }

  const slashGoalMatch = compact.match(/^\/(?:目标|goal)(?:\s+|$)(.*)$/i);
  if (slashGoalMatch) {
    return {
      kind: "set_goal",
      description: slashGoalMatch[1]?.trim() || compact,
    };
  }

  if (/^(把这轮设为目标|这轮目标是|接下来目标是|目标[:：])/i.test(compact)) {
    return { kind: "set_goal", description: extractGoalDescription(compact) };
  }

  if (/^(暂停这个目标|暂停目标)$/.test(compact)) {
    return { kind: "pause_goal" };
  }

  if (/^(取消这个目标|结束目标|终止目标|取消目标)/.test(compact)) {
    return { kind: "cancel_goal" };
  }

  const modifyMatch = compact.match(/^(目标改一下|修改计划|调整目标)[:：]?\s*(.*)$/);
  if (modifyMatch) {
    return {
      kind: "modify_goal",
      instructions: modifyMatch[2]?.trim() || compact,
    };
  }

  if (isContinuationRequest(compact)) {
    return { kind: "continue_goal" };
  }

  return { kind: "none" };
}

function extractGoalDescription(message: string): string {
  return (
    message
      .replace(/^(把这轮设为目标|这轮目标是|接下来目标是|目标)\s*[:：]?\s*/i, "")
      .trim() || message.trim()
  );
}

function getActiveGoalSummary(
  session: AppendChatMessageResult["session"],
): ChatSessionGoalSummary | null {
  if (!session.activeGoalId || !session.goalSummaries?.length) {
    return null;
  }

  return (
    session.goalSummaries.find((goal) => goal.id === session.activeGoalId) ??
    null
  );
}

async function tryRouteGoalIntent(options: {
  route: GoalIntentRoute;
  activeGoal: ChatSessionGoalSummary | null;
  chatSessionStore:
    | Pick<ChatSessionStore, "appendMessage" | "attachGoal" | "clearActiveGoal">
    | undefined;
  goalService: ChatGoalService | undefined;
  originMessageId: string | null;
  sessionId: string;
  emitStatus?: ReturnType<typeof createChatStatusEmitter>;
  signal?: AbortSignal;
}): Promise<{ result: SendChatMessageResult } | null> {
  if (options.route.kind === "none" || !options.goalService) {
    return null;
  }

  if (options.route.kind === "set_goal") {
    const createdGoal = await options.goalService.createFromChat({
      sessionId: options.sessionId,
      originMessageId: options.originMessageId,
      description: options.route.description,
    });
    const activeGoal = await options.goalService.resume(createdGoal.id, {
      ...(options.signal ? { signal: options.signal } : {}),
    });
    await options.chatSessionStore?.attachGoal(options.sessionId, activeGoal);
    const reply = `已设置并开始执行目标：${activeGoal.description}。`;
    options.emitStatus?.send({
      state: "completed",
      message: "目标已开始执行",
      toolCallsExecuted: 0,
    });
    await appendAssistantMessage({
      chatSessionStore: options.chatSessionStore,
      sessionId: options.sessionId,
      content: reply,
      goalId: activeGoal.id,
      goalEventRef: "goal_started",
    });
    return {
      result: {
        ok: true,
        reply,
        sessionId: options.sessionId,
        relatedMemories: [],
        memoryId: null,
        activeGoal,
      },
    };
  }

  if (!options.activeGoal) {
    return null;
  }

  if (options.route.kind === "continue_goal") {
    const restartingTerminalGoal = isTerminalGoalStatus(options.activeGoal.status);
    const goalToContinue = restartingTerminalGoal
      ? await options.goalService.createFromChat({
          sessionId: options.sessionId,
          originMessageId: options.originMessageId,
          description: options.activeGoal.description,
        })
      : options.activeGoal;

    const activeGoal =
      goalToContinue.status === "waiting_for_review"
        ? await options.goalService.resolveReview(goalToContinue.id, {
            kind: "approve_continue",
          })
        : await options.goalService.resume(goalToContinue.id, {
            ...(options.signal ? { signal: options.signal } : {}),
          });

    await options.chatSessionStore?.attachGoal(options.sessionId, activeGoal);
    const reply = restartingTerminalGoal
      ? formatTerminalGoalRestartReply(options.activeGoal.status, activeGoal.description)
      : `继续推进目标：${activeGoal.description}。`;
    options.emitStatus?.send({
      state: "completed",
      message: restartingTerminalGoal
        ? "已创建新一轮目标重试"
        : "目标执行已更新",
      toolCallsExecuted: 0,
    });
    await appendAssistantMessage({
      chatSessionStore: options.chatSessionStore,
      sessionId: options.sessionId,
      content: reply,
      goalId: activeGoal.id,
      goalEventRef: "goal_resumed",
    });
    return {
      result: {
        ok: true,
        reply,
        sessionId: options.sessionId,
        relatedMemories: [],
        memoryId: null,
        activeGoal,
      },
    };
  }

  if (options.route.kind === "pause_goal") {
    const activeGoal = await options.goalService.pause(options.activeGoal.id);
    await options.chatSessionStore?.attachGoal(options.sessionId, activeGoal);
    const reply = `已暂停目标：${activeGoal.description}。`;
    await appendAssistantMessage({
      chatSessionStore: options.chatSessionStore,
      sessionId: options.sessionId,
      content: reply,
      goalId: activeGoal.id,
      goalEventRef: "goal_paused",
    });
    return {
      result: {
        ok: true,
        reply,
        sessionId: options.sessionId,
        relatedMemories: [],
        memoryId: null,
        activeGoal,
      },
    };
  }

  if (options.route.kind === "cancel_goal") {
    const activeGoal = await options.goalService.cancel(options.activeGoal.id);
    await options.chatSessionStore?.attachGoal(options.sessionId, activeGoal);
    await options.chatSessionStore?.clearActiveGoal(
      options.sessionId,
      activeGoal.id,
    );
    const reply = `已结束目标：${activeGoal.description}。`;
    await appendAssistantMessage({
      chatSessionStore: options.chatSessionStore,
      sessionId: options.sessionId,
      content: reply,
      goalId: activeGoal.id,
      goalEventRef: "goal_canceled",
    });
    return {
      result: {
        ok: true,
        reply,
        sessionId: options.sessionId,
        relatedMemories: [],
        memoryId: null,
        activeGoal,
      },
    };
  }

  const activeGoal = await options.goalService.resolveReview(
    options.activeGoal.id,
    { kind: "modify_plan", instructions: options.route.instructions },
  );
  await options.chatSessionStore?.attachGoal(options.sessionId, activeGoal);
  const reply = `已记录目标调整：${options.route.instructions}`;
  await appendAssistantMessage({
    chatSessionStore: options.chatSessionStore,
    sessionId: options.sessionId,
    content: reply,
    goalId: activeGoal.id,
    goalEventRef: "goal_modified",
  });
  return {
    result: {
      ok: true,
      reply,
      sessionId: options.sessionId,
      relatedMemories: [],
      memoryId: null,
      activeGoal,
    },
  };
}

function isTerminalGoalStatus(status: ChatSessionGoalSummary["status"]): boolean {
  return (
    status === "achieved" ||
    status === "stopped_budget" ||
    status === "stopped_stalled" ||
    status === "failed" ||
    status === "canceled"
  );
}

function formatTerminalGoalRestartReply(
  status: ChatSessionGoalSummary["status"],
  description: string,
): string {
  if (status === "failed") {
    return `上一次目标已失败，已基于原描述创建新一轮重试：${description}。`;
  }

  return `上一次目标已结束，已基于原描述创建新一轮执行：${description}。`;
}

function buildContinuationMessages(options: {
  continuation: ChatContinuationState;
  userMessage: string;
}): ChatMessage[] {
  return [
    ...options.continuation.messages,
    {
      role: "user",
      content: [
        "用户已确认继续执行上一个已暂停的长任务。",
        `上次检查点：${options.continuation.maxTurns} 轮，已执行 ${options.continuation.toolCallsExecuted} 个工具。`,
        `确认内容：${options.userMessage}`,
        "请从已有工具结果和上下文接着推进；如果确认内容包含调整方向，请按新的方向继续。",
      ].join("\n"),
    },
  ];
}

async function appendAssistantMessage(options: {
  chatSessionStore: Pick<ChatSessionStore, "appendMessage"> | undefined;
  sessionId: string;
  content: string;
  relatedMemoryIds?: string[];
  executedRunId?: string;
  goalId?: string;
  goalEventRef?: string;
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
      ...(options.goalId ? { goalId: options.goalId } : {}),
      ...(options.goalEventRef ? { goalEventRef: options.goalEventRef } : {}),
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
    "你可以使用工具来帮助用户：查看文件、读取文件元信息、搜索文件、搜索网页、执行受权的 shell 命令。",
    "文件诊断优先使用 file_list、file_stat、file_search、file_read；只有原生工具无法完成时再使用 shell_exec。",
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

async function writeAtomicMemories(options: {
  memoryStore: Pick<MemoryStore, "create">;
  memoryProfileStore: MemoryProfileStore | undefined;
  sessionId: string;
  userMessageId: string | null;
  assistantMessageId: string | null;
  userMessage: string;
  assistantReply: string;
}) {
  const atomInputs = extractAtomicMemoriesFromChatTurn({
    sessionId: options.sessionId,
    userMessageId: options.userMessageId,
    assistantMessageId: options.assistantMessageId,
    userMessage: options.userMessage,
    assistantReply: options.assistantReply,
  });

  if (!atomInputs.length) {
    return;
  }

  try {
    const createdMemories = [];
    for (const atomInput of atomInputs) {
      createdMemories.push(await options.memoryStore.create(atomInput));
    }

    if (createdMemories.length) {
      await options.memoryProfileStore?.updateFromMemories(createdMemories);
    }
  } catch {
    // Atomic memory extraction must not block the visible chat response.
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

function getNativeToolDescriptor(
  toolExecutor: AgentToolExecutor,
  toolName: string,
): NativeToolDescriptor | null {
  const registry = toolExecutor.getRegistry() as {
    getNativeDescriptor?: (toolName: string) => NativeToolDescriptor | null;
  };
  if (typeof registry.getNativeDescriptor !== "function") {
    return null;
  }

  return registry.getNativeDescriptor(toolName);
}

function buildNativeToolEvidencePayload(
  descriptor: NativeToolDescriptor,
): Record<string, unknown> {
  return {
    toolName: descriptor.id,
    nativeKind: descriptor.kind,
    riskLevel: descriptor.riskLevel,
    permissionScope: descriptor.permissionScope,
    source: "registry",
    label: descriptor.label,
  };
}

function truncateText(value: string, maxLength: number): string {
  const normalized = value.trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1)}…`;
}
