import { randomUUID } from "node:crypto";
import path from "node:path";
import type { AgentRunContext } from "../shared/agentWorkspace";
import type { AgentModelProfile } from "./agentRunnerService";
import type { AgentToolExecutor } from "./agentToolExecutor";
import type { AgentWorkspaceService } from "./agentWorkspaceService";
import { createChatAgentEvidenceRecorder } from "./chatAgentEvidence";
import { createChatOutputAssembler } from "./chatOutputAssembler";
import type { AgentTrajectoryStore } from "./agentTrajectoryStore";
import { runAgentLoop } from "./agentLoop";
import { estimateMessageTokens } from "./contextManager";
import type { CompactionStrategy } from "./kernel/compactionStrategy";
import type { AppendChatMessageResult, ChatSessionStore } from "./chatSessionStore";
import { extractAtomicMemoriesFromChatTurn } from "./memoryL1Extractor";
import type { MemoryProfileStore } from "./memoryProfileStore";
import type { MemoryStore } from "./memoryStore";
import type { HistoryIndexStore } from "./historyIndexStore";
import type { RawHistoryRole } from "../shared/rawHistory";
import type { ToolResultOffloadStore } from "./toolResultOffloadStore";
import type { WorkspaceRunStore } from "./workspaceRunStore";
import {
  formatMemoryRecallContext,
  recallMemoriesWithBudget,
} from "./memoryRecall";
import type {
  ChatClient,
  ChatCompletionResponse,
  ChatMessage,
  StreamEvent as ModelStreamEvent,
} from "./openAiCompatibleClient";
import type { ScheduledTaskStore } from "./taskStore";
import type {
  RuntimeToolAuthorizationTask,
  ToolAuthorizationService,
} from "./toolAuthorizationService";
import type {
  ChatAgentStatus,
  ChatRelatedMemory,
  ChatSessionListItem,
  ChatSessionRecord,
  ChatSessionGoalSummary,
  ChatSessionTokenUsage,
  ChatStreamEvent,
  ChatTaskStatusEvent,
  ChatWorkspaceSummary,
  SendChatMessageInput,
  SendChatMessageResult,
  SkillPendingInputState,
  SkillInputResponse,
  SkillInputResponseResult,
  SkillUserInputRequest,
} from "../shared/chat";
import { getSystemPromptAssembler } from "../shared/agentProtocol";
import type { GoalReviewDecision } from "../shared/agentGoalReview";
import type { AgentRunRecord, RunScheduledTaskResult } from "../shared/agentRuns";
import type { MemoryRecord, MemorySearchResult } from "../shared/memory";
import type { NativeToolDescriptor } from "../shared/nativeCapabilities";
import type { SkillDiscoveryResult, SkillRecord } from "../shared/skills";
import type {
  WorkspaceRunEventInput,
  WorkspaceRunStatus,
  WorkspaceRunTerminalStatus,
} from "../shared/workspaceRunLedger";
import {
  buildScheduledTaskInputFromIntent,
  classifyAgentIntent,
  matchTaskFromMessage,
  type AgentIntentRoute,
} from "../shared/agentIntent";
import { formatDateInTimeZone, getSystemTimeZone } from "../shared/dateContext";
import { maskPreviewSecrets, type ChatOutputPart } from "../shared/chatOutput";
import {
  extractRequestedSkillQuery,
  matchSkillMentionCandidates,
} from "../shared/skillMentions";
import { describeSchedule } from "../shared/scheduledTasks";
import type { TaskPermissionPolicy } from "../shared/toolPermissions";
import { resolveSkillInput } from "./skillExecutionService";
import type {
  SkillInputResolution,
  SkillInputValue,
} from "../shared/skillExecutionContract";

export type ChatService = {
  sendMessage(
    input: SendChatMessageInput,
    options?: SendChatMessageRuntimeOptions,
  ): Promise<SendChatMessageResult>;
  respondSkillInput(
    input: SkillInputResponse,
    options?: SendChatMessageRuntimeOptions,
  ): Promise<SkillInputResponseResult>;
};

export type SendChatMessageRuntimeOptions = {
  signal?: AbortSignal;
  onStatusEvent?: (event: ChatTaskStatusEvent) => void;
  onStreamEvent?: (event: ChatStreamEvent) => void;
};

type ChatContinuationState = {
  messages: ChatMessage[];
  maxTurns: number;
  toolCallsExecuted: number;
  evidenceRunId?: string;
};

type PendingSkillInputState = {
  persisted: SkillPendingInputState;
  sessionId: string;
  requestId: string;
  userMessage: string;
  userMessageId: string | null;
  selectedSkill: SkillRecord;
  workspaceId?: string;
  workspaceSummary?: ChatWorkspaceSummary;
  runContext?: AgentRunContext;
  partialValues: Record<string, SkillInputValue>;
};

type ChatTurnInternalOptions = {
  skipUserMessageAppend?: boolean;
  userMessageId?: string | null;
  forcedSkill?: SkillRecord;
  resolvedSkillInput?: SkillInputResolution;
  preResolvedRunContext?: AgentRunContext;
  preResolvedWorkspaceSummary?: ChatWorkspaceSummary;
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
    "appendMessage" | "attachGoal" | "clearActiveGoal" | "addTokenUsage"
  > &
    Partial<Pick<ChatSessionStore, "appendActivityEvent" | "get" | "list">>;
  goalService?: ChatGoalService;
  taskStore?: Pick<ScheduledTaskStore, "create" | "list">;
  runScheduledTask?: (taskId: string) => Promise<RunScheduledTaskResult>;
  discoverSkills?: () => Promise<SkillDiscoveryResult>;
  workspaceService?: Pick<AgentWorkspaceService, "resolveRunContext">;
  toolExecutor?: AgentToolExecutor;
  toolAuthorizationService?: ToolAuthorizationService;
  runAgentLoop?: typeof runAgentLoop;
  createId?: () => string;
  now?: () => Date;
  systemTimeZone?: string;
  memoryLimit?: number;
  historyLimit?: number;
  agentLoopMaxTurns?: number;
  toolResultOffloadStore?: ToolResultOffloadStore;
  toolResultOffloadThreshold?: number;
  trajectoryStore?: AgentTrajectoryStore;
  workspaceRunStore?: Pick<
    WorkspaceRunStore,
    "createRun" | "appendEvent" | "finishRun"
  >;
  historyIndexStore?: Pick<HistoryIndexStore, "append">;
  /** P2: overflow compaction strategy passed through to the chat agent loop. */
  compactionStrategy?: CompactionStrategy;
}): ChatService {
  const createId = options.createId ?? randomUUID;
  const memoryLimit = options.memoryLimit ?? 4;
  const historyLimit = options.historyLimit ?? 12;
  const agentLoopMaxTurns = normalizeAgentLoopMaxTurns(options.agentLoopMaxTurns);
  const pendingContinuations = new Map<string, ChatContinuationState>();
  const pendingSkillInputRequests = new Map<string, PendingSkillInputState>();
  const inFlightSkillInputResponses = new Set<string>();

  async function recoverPendingSkillInputState(
    inputRequestId: string,
  ): Promise<PendingSkillInputState | null> {
    const persisted = await findPersistedPendingSkillInputState({
      inputRequestId,
      chatSessionStore: options.chatSessionStore,
    });
    if (!persisted || persisted.status !== "pending") {
      return null;
    }

    const requestedSkill = await resolveRequestedSkill({
      message: "",
      selectedSkillName: persisted.selectedSkillName,
      discoverSkills: options.discoverSkills,
    });
    if (requestedSkill?.kind !== "matched") {
      return null;
    }

    const workspaceResolution = await resolveChatWorkspace({
      workspaceService: options.workspaceService,
      workspaceId: persisted.workspaceId,
    });
    if (!workspaceResolution.ok) {
      return null;
    }

    const recovered = toInMemoryPendingSkillInputState({
      persisted,
      selectedSkill: requestedSkill.skill,
      ...(workspaceResolution.runContext
        ? {
            runContext: {
              ...workspaceResolution.runContext,
              sessionId: persisted.sessionId,
            },
          }
        : {}),
    });
    pendingSkillInputRequests.set(inputRequestId, recovered);
    return recovered;
  }

  async function markPersistedSkillInputCompleted(pending: PendingSkillInputState) {
    if (!options.chatSessionStore?.appendActivityEvent) {
      throw new Error("Chat session activity persistence is unavailable.");
    }

    const record = await options.chatSessionStore.appendActivityEvent(pending.sessionId, {
      sessionId: pending.sessionId,
      state: "completed",
      message: "Skill input completed.",
      createdAt: new Date(getNowMs(options.now)).toISOString(),
      elapsedMs: 0,
      selectedSkillName: pending.selectedSkill.manifest.name,
      pendingSkillInput: {
        ...pending.persisted,
        status: "completed",
      },
    });
    if (!record) {
      throw new Error("Chat session activity persistence did not update a session.");
    }
  }

  async function sendMessageInternal(
    input: SendChatMessageInput,
    runtimeOptions: SendChatMessageRuntimeOptions = {},
    internalOptions: ChatTurnInternalOptions = {},
  ): Promise<SendChatMessageResult> {
      const userMessage = input.message.trim();
      if (!userMessage) {
        return { ok: false, message: "消息不能为空。" };
      }

      let sessionId = input.sessionId ?? createId();
      const startedAtMs = getNowMs(options.now);
      const requestId = input.requestId ?? `request_${startedAtMs}`;
      let workspaceRunRecorder: ChatWorkspaceRunRecorder | null = null;
      const chatTimeZone = options.systemTimeZone ?? getSystemTimeZone();
      // Anchor date to turn start, interpreted in the user's system timezone.
      const chatDate = formatDateInTimeZone(new Date(startedAtMs), chatTimeZone);
      const emitStatus = createChatStatusEmitter({
        sessionId,
        requestId,
        startedAtMs,
        now: options.now,
        onStatusEvent: runtimeOptions.onStatusEvent,
        onStreamEvent: runtimeOptions.onStreamEvent,
        onPersistEvent(event) {
          try {
            const sessionActivityWrite =
              options.chatSessionStore?.appendActivityEvent?.(
                event.sessionId,
                event,
              );
            void sessionActivityWrite?.catch(() => undefined);
          } catch {
            // Observability writes must not fail the user-facing chat turn.
          }
          try {
            const workspaceRunWrite = workspaceRunRecorder?.appendStatusEvent(event);
            void workspaceRunWrite?.catch(() => undefined);
          } catch {
            // Observability writes must not fail the user-facing chat turn.
          }
        },
        async onRequiredPersistEvent(event) {
          await persistRequiredChatActivityEvent(options.chatSessionStore, event);
        },
      });
      const outputAssembler = createChatOutputAssembler(() =>
        new Date(getNowMs(options.now)).toISOString(),
      );
      let terminalStreamEventSent = false;

      function getAssistantOutputParts(content: string): ChatOutputPart[] | undefined {
        outputAssembler.setFinalText(content);
        const textOnlyParts = outputAssembler.parts();
        return textOnlyParts.length > 0 ? textOnlyParts : undefined;
      }

      function emitOutputPart(part: ChatOutputPart) {
        emitStatus.sendStreamEvent({
          type: "output_part",
          part,
        });
      }

      function emitTerminalStreamEvent(event: {
        type: "completed" | "failed" | "canceled";
        message?: string;
        finalMessageId?: string;
      }) {
        if (terminalStreamEventSent) {
          return;
        }
        if (
          event.message &&
          (event.type === "failed" || event.type === "canceled")
        ) {
          emitOutputPart(
            outputAssembler.appendDiagnostic({
              severity: event.type === "failed" ? "error" : "warning",
              title: event.type === "failed" ? "请求失败" : "请求已取消",
              message: event.message,
            }),
          );
        }
        terminalStreamEventSent = true;
        emitStatus.sendTerminalEvent(event);
      }

      async function persistAssistantReply(input: {
        content: string;
        relatedMemoryIds?: string[];
        executedRunId?: string;
        goalId?: string;
        goalEventRef?: string;
      }): Promise<string | null> {
        const assistantMessageId = await appendAssistantMessage({
          chatSessionStore: options.chatSessionStore,
          sessionId,
          content: input.content,
          outputParts: getAssistantOutputParts(input.content),
          ...(input.relatedMemoryIds?.length
            ? { relatedMemoryIds: input.relatedMemoryIds }
            : {}),
          ...(input.executedRunId ? { executedRunId: input.executedRunId } : {}),
          ...(input.goalId ? { goalId: input.goalId } : {}),
          ...(input.goalEventRef ? { goalEventRef: input.goalEventRef } : {}),
        });
        emitStatus.setAssistantMessageId(assistantMessageId);
        emitTerminalStreamEvent({
          type: "completed",
          message: input.content,
          ...(assistantMessageId ? { finalMessageId: assistantMessageId } : {}),
        });
        return assistantMessageId;
      }

      const workspaceResolution = internalOptions.preResolvedRunContext
        ? { ok: true as const, runContext: internalOptions.preResolvedRunContext }
        : await resolveChatWorkspace({
            workspaceService: options.workspaceService,
            workspaceId: input.workspaceId,
          });
      if (!workspaceResolution.ok) {
        emitTerminalStreamEvent({
          type: "failed",
          message: workspaceResolution.message,
        });
        return {
          ok: false,
          message: workspaceResolution.message,
        };
      }
      let chatRunContext = workspaceResolution.runContext;
      const workspaceSummary =
        internalOptions.preResolvedWorkspaceSummary ??
        (chatRunContext ? buildChatWorkspaceSummary(chatRunContext) : input.workspaceSummary);
      let userMessageId: string | null = null;
      let activeGoal: ChatSessionGoalSummary | null = null;
      if (options.chatSessionStore && !internalOptions.skipUserMessageAppend) {
        const appendResult = await options.chatSessionStore.appendMessage({
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          role: "user",
          content: userMessage,
          ...(chatRunContext?.workspaceId || input.workspaceId
            ? { workspaceId: chatRunContext?.workspaceId ?? input.workspaceId }
            : {}),
          ...(workspaceSummary ? { workspaceSummary } : {}),
        });
        sessionId = appendResult.session.id;
        emitStatus.setSessionId(sessionId);
        userMessageId = appendResult.message.id;
        activeGoal = getActiveGoalSummary(appendResult.session);
      } else if (internalOptions.skipUserMessageAppend) {
        userMessageId = internalOptions.userMessageId ?? null;
      }
      if (chatRunContext) {
        chatRunContext = {
          ...chatRunContext,
          sessionId,
        };
        workspaceRunRecorder = await createChatWorkspaceRunRecorder({
          workspaceRunStore: options.workspaceRunStore,
          sessionId,
          requestId,
          runContext: chatRunContext,
          ...(input.selectedSkillName
            ? { selectedSkillName: input.selectedSkillName }
            : {}),
          createdAt: new Date(startedAtMs).toISOString(),
        });
        emitStatus.send({
          state: "workspace",
          message: `工作区：${workspaceSummary?.name ?? chatRunContext.workspaceRoot}`,
          workspaceId: chatRunContext.workspaceId,
          ...(workspaceSummary ? { workspaceSummary } : {}),
        });
      }
      appendRawHistoryEntry({
        historyIndexStore: options.historyIndexStore,
        createId,
        sessionId,
        requestId,
        role: "user",
        content: userMessage,
        workspaceId: chatRunContext?.workspaceId ?? input.workspaceId,
        createdAt: new Date(startedAtMs).toISOString(),
      });

      const pendingContinuation = pendingContinuations.get(sessionId);
      const continuationToResume =
        pendingContinuation && isContinuationRequest(userMessage)
          ? pendingContinuation
          : null;

      if (!continuationToResume && pendingContinuation) {
        pendingContinuations.delete(sessionId);
      }

      const requestedSkill = internalOptions.forcedSkill
        ? ({ kind: "matched", skill: internalOptions.forcedSkill } as const)
        : !continuationToResume
          ? await resolveRequestedSkill({
              message: userMessage,
              selectedSkillName: input.selectedSkillName,
              discoverSkills: options.discoverSkills,
            })
          : null;
      if (requestedSkill?.kind === "missing") {
        emitTerminalStreamEvent({
          type: "failed",
          message: requestedSkill.message,
        });
        return {
          ok: false,
          message: requestedSkill.message,
        };
      }

      if (requestedSkill?.kind === "matched") {
        emitStatus.send({
          state: "skill",
          message: `正在调用技能：${requestedSkill.skill.manifest.name}`,
          selectedSkillName: requestedSkill.skill.manifest.name,
        });
      }

      let resolvedSkillInput = internalOptions.resolvedSkillInput;
      if (
        requestedSkill?.kind === "matched" &&
        !continuationToResume &&
        !resolvedSkillInput
      ) {
        const inputResolution = resolveSkillInput({
          skill: requestedSkill.skill,
          values: {},
          runContext: chatRunContext,
        });
        if (inputResolution.status !== "complete") {
          const inputRequest = createSkillUserInputRequest({
            createId,
            sessionId,
            requestId,
            skill: requestedSkill.skill,
            inputResolution,
            createdAt: new Date(getNowMs(options.now)).toISOString(),
          });
          const persisted = createPendingSkillInputState({
            inputRequest,
            sessionId,
            requestId,
            userMessage,
            userMessageId,
            selectedSkillName: requestedSkill.skill.manifest.name,
            ...(chatRunContext?.workspaceId ? { workspaceId: chatRunContext.workspaceId } : {}),
            ...(workspaceSummary ? { workspaceSummary } : {}),
            partialValues: inputResolution.values,
          });
          try {
            await emitStatus.sendWaitingForInput(
              inputRequest,
              "Skill input required.",
              persisted,
            );
            emitOutputPart(outputAssembler.appendInputRequest(inputRequest));
          } catch {
            emitTerminalStreamEvent({
              type: "failed",
              message: "Failed to persist skill input request.",
            });
            return {
              ok: false,
              message: "Failed to persist skill input request.",
            };
          }
          pendingSkillInputRequests.set(inputRequest.id, {
            ...toInMemoryPendingSkillInputState({
              persisted,
              selectedSkill: requestedSkill.skill,
              ...(chatRunContext ? { runContext: chatRunContext } : {}),
            }),
          });
          return {
            ok: false,
            message: "Skill input required.",
          };
        }
        resolvedSkillInput = inputResolution;
      }

      if (!requestedSkill) {
        const goalRoute = await tryRouteGoalIntent({
          route: detectGoalIntent(userMessage),
          activeGoal,
          chatSessionStore: options.chatSessionStore,
          goalService: options.goalService,
          originMessageId: userMessageId,
          sessionId,
          emitStatus,
          now: options.now,
          signal: runtimeOptions.signal,
        });

        if (goalRoute) {
          return goalRoute.result;
        }
      }

      if (!continuationToResume) {
        const intentRoute = classifyAgentIntent(userMessage);
        const taskCreationResult = requestedSkill
          ? null
          : await tryCreateTaskFromIntent({
              route: intentRoute,
              taskStore: options.taskStore,
            });

        if (taskCreationResult) {
          if (!taskCreationResult.ok) {
            emitTerminalStreamEvent({
              type: "failed",
              message: taskCreationResult.result.message,
            });
            return taskCreationResult.result;
          }

          const assistantMessageId = await persistAssistantReply({
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
        const taskRunResult = requestedSkill
          ? null
          : await tryRunTaskFromIntent({
              route: intentRoute,
              message: userMessage,
              taskStore: options.taskStore,
              runScheduledTask: options.runScheduledTask,
            });

        if (taskRunResult) {
          if (!taskRunResult.ok) {
            emitTerminalStreamEvent({
              type: "failed",
              message: taskRunResult.result.message,
            });
            return taskRunResult.result;
          }

          const assistantMessageId = await persistAssistantReply({
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
          emitTerminalStreamEvent({
            type: "failed",
            message:
              "模型配置不完整：请先在设置中保存 base URL、对话模型和 API Key。",
          });
          return {
            ok: false,
            message:
              "模型配置不完整：请先在设置中保存 base URL、对话模型和 API Key。",
          };
        }

        emitTerminalStreamEvent({
          type: "failed",
          message: error instanceof Error ? error.message : "无法读取模型配置。",
        });
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
        if (requestedSkill?.kind === "matched") {
          chatMessages = injectSkillInvocationMessage(
            chatMessages,
            requestedSkill.skill,
            resolvedSkillInput,
          );
        }
      }

      let reply: string;
      let toolCallsUsed = 0;
      let agentStatus: ChatAgentStatus | undefined;
      let accumulatedUsage: ChatSessionTokenUsage | null = null;

      if (options.toolExecutor) {
        // Unified agent mode: chat goes through agent loop with tool access
        try {
          const toolExecutor = options.toolExecutor;
          const selectedSkill =
            requestedSkill?.kind === "matched" ? requestedSkill.skill : undefined;
          const agentRunContext =
            chatRunContext && selectedSkill
              ? extendRunContextForSelectedSkill({
                  runContext: chatRunContext,
                  selectedSkill,
                  ...(resolvedSkillInput?.status === "complete"
                    ? { skillInputValues: resolvedSkillInput.values }
                    : {}),
                })
              : chatRunContext;
          const loopMaxTurns =
            typeof selectedSkill?.manifest.execution.maxTurns === "number"
              ? normalizeAgentLoopMaxTurns(
                  selectedSkill.manifest.execution.maxTurns,
                )
              : agentLoopMaxTurns;
          const chatRuntimeTask = agentRunContext
            ? createChatRuntimeTask({
                sessionId,
                requestId,
                runContext: agentRunContext,
                selectedSkill,
                ...(resolvedSkillInput?.status === "complete"
                  ? { skillInputValues: resolvedSkillInput.values }
                  : {}),
              })
            : null;
          let observedToolCallsExecuted =
            continuationToResume?.toolCallsExecuted ?? 0;
          const evidence = createChatAgentEvidenceRecorder({
            trajectoryStore: options.trajectoryStore,
            runId: continuationToResume?.evidenceRunId,
            createId,
            now: options.now,
          });
          if (requestedSkill?.kind === "matched") {
            void evidence.append("skill_invoked", {
              skillName: requestedSkill.skill.manifest.name,
              displayName: requestedSkill.skill.manifest.displayName,
            });
          }
          const executeAgentLoop = options.runAgentLoop ?? runAgentLoop;
          const loopResult = await executeAgentLoop(
            chatMessages,
            profile,
            {
              chatClient: options.chatClient,
              toolExecutor,
              toolAuthorizationService: options.toolAuthorizationService,
              ...(chatRuntimeTask ? { taskId: chatRuntimeTask.taskId } : {}),
              ...(agentRunContext ? { runContext: agentRunContext } : {}),
              ...(chatRuntimeTask
                ? { runtimeTask: chatRuntimeTask.runtimeTask }
                : {}),
              systemPrompt: buildChatSystemPrompt(chatDate, chatTimeZone),
              maxTurns: loopMaxTurns,
              signal: runtimeOptions.signal,
              tools: toolExecutor.getRegistry().getDefinitions(),
              toolResultOffloadStore: options.toolResultOffloadStore,
              toolResultOffloadThreshold: options.toolResultOffloadThreshold,
              requestId,
              ...(workspaceRunRecorder?.workspaceRunId
                ? { workspaceRunId: workspaceRunRecorder.workspaceRunId }
                : {}),
              ...(options.compactionStrategy
                ? { compactionStrategy: options.compactionStrategy }
                : {}),
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
                accumulatedUsage = mergeChatSessionTokenUsage(
                  accumulatedUsage,
                  toChatSessionTokenUsage(response.usage),
                );
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
              onModelStreamEvent(event) {
                emitModelStreamEvent(emitStatus, outputAssembler, event);
              },
              onToolCall(toolName, args, event) {
                void evidence.append("tool_call", {
                  toolName,
                  args,
                  toolCallId: event.toolCallId,
                });
                appendRawHistoryEntry({
                  historyIndexStore: options.historyIndexStore,
                  createId,
                  sessionId,
                  requestId,
                  role: "tool",
                  toolName,
                  content: `Tool call ${toolName}: ${truncateHistoryContent(JSON.stringify(args))}`,
                  workspaceId: agentRunContext?.workspaceId,
                  createdAt: new Date(getNowMs(options.now)).toISOString(),
                });
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
                  toolCallId: event.toolCallId,
                  toolCallsExecuted: observedToolCallsExecuted,
                });
                emitOutputPart(
                  outputAssembler.appendLedgerEvent({
                    status: "running",
                    title: `正在调用工具：${toolName}`,
                    detail: JSON.stringify(maskPreviewSecrets(args)),
                    toolName,
                  }),
                );
              },
              onToolInvocation(record) {
                void evidence.append("tool_invocation", {
                  toolInvocationId: record.id,
                  toolCallId: record.toolCallId,
                  toolName: record.toolName,
                  toolSource: record.source,
                  invocationStatus: record.status,
                  args: record.args,
                  ...(typeof record.ok === "boolean" ? { ok: record.ok } : {}),
                  ...(record.resultRef ? { resultRef: record.resultRef } : {}),
                  ...(record.error ? { error: record.error } : {}),
                  history: record.history,
                });
                emitStatus.send({
                  state: "tool_invocation",
                  message: `工具状态：${record.toolName} ${record.status}`,
                  toolInvocationId: record.id,
                  toolCallId: record.toolCallId,
                  toolName: record.toolName,
                  toolSource: record.source,
                  invocationStatus: record.status,
                  ...(record.resultRef ? { resultRef: record.resultRef } : {}),
                  ...(typeof record.ok === "boolean" ? { ok: record.ok } : {}),
                  toolCallsExecuted: observedToolCallsExecuted,
                });
                if (record.status === "waiting_approval") {
                  emitOutputPart(
                    outputAssembler.appendApprovalRequest({
                      approvalId: record.id,
                      toolName: record.toolName,
                      riskLevel: inferApprovalRiskLevel({
                        toolName: record.toolName,
                        source: record.source,
                      }),
                      argsPreview: record.args,
                    }),
                  );
                }
              },
              onToolResult(toolName, ok, result, event) {
                observedToolCallsExecuted += 1;
                appendRawHistoryEntry({
                  historyIndexStore: options.historyIndexStore,
                  createId,
                  sessionId,
                  requestId,
                  role: "tool",
                  toolName,
                  content: `Tool result ${toolName}: ${ok ? "ok" : "error"} ${truncateHistoryContent(JSON.stringify(result))}`,
                  workspaceId: agentRunContext?.workspaceId,
                  createdAt: new Date(getNowMs(options.now)).toISOString(),
                });
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
                void evidence.append("tool_result", {
                  toolName,
                  ok,
                  toolCallId: event.toolCallId,
                  ...(event.resultRef ? { resultRef: event.resultRef } : {}),
                });
                emitStatus.send({
                  state: "tool_result",
                  message: buildToolResultStatusMessage(toolName, result),
                  toolName,
                  toolCallId: event.toolCallId,
                  ...(event.resultRef ? { resultRef: event.resultRef } : {}),
                  ...(typeof event.resultBytes === "number"
                    ? { resultBytes: event.resultBytes }
                    : {}),
                  ok,
                  toolCallsExecuted: observedToolCallsExecuted,
                });
                for (const part of outputAssembler.appendToolResult({
                  toolCallId: event.toolCallId,
                  toolName,
                  ok,
                  ...(ok && result && typeof result === "object" && "result" in result
                    ? {
                        resultPreview: (
                          result as { result: Record<string, unknown> }
                        ).result,
                      }
                    : {}),
                  ...(!ok && result && typeof result === "object" && "error" in result
                    ? {
                        error: (result as { error: string }).error,
                        ...("errorDetails" in result &&
                        (result as { errorDetails?: Record<string, unknown> })
                          .errorDetails
                          ? {
                              resultPreview: (
                                result as {
                                  errorDetails: Record<string, unknown>;
                                }
                              ).errorDetails,
                            }
                          : {}),
                      }
                    : {}),
                })) {
                  emitOutputPart(part);
                }
                emitOutputPart(
                  outputAssembler.appendLedgerEvent({
                    status: ok ? "completed" : "failed",
                    title: buildToolResultStatusMessage(toolName, result),
                    ...(toolName ? { toolName } : {}),
                  }),
                );
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
            emitTerminalStreamEvent({
              type: "canceled",
              message: "已中断任务。",
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
                  : loopResult.continuation.reason === "strategy_guard"
                    ? "策略守护触发，等待确认"
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
            emitTerminalStreamEvent({
              type: "canceled",
              message: "已中断任务。",
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
          emitTerminalStreamEvent({
            type: "failed",
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
            { role: "system", content: buildChatSystemPrompt(chatDate, chatTimeZone) },
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
          accumulatedUsage = mergeChatSessionTokenUsage(
            accumulatedUsage,
            toChatSessionTokenUsage(response.usage),
          );
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
            emitTerminalStreamEvent({
              type: "canceled",
              message: "已中断任务。",
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
          emitTerminalStreamEvent({
            type: "failed",
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

      const assistantMessageId = await persistAssistantReply({
        content: reply,
        relatedMemoryIds: relatedMemoryResults.map((result) => result.record.id),
      });
      appendRawHistoryEntry({
        historyIndexStore: options.historyIndexStore,
        createId,
        sessionId,
        requestId,
        role: "assistant",
        content: reply,
        workspaceId: chatRunContext?.workspaceId ?? input.workspaceId,
        createdAt: new Date(getNowMs(options.now)).toISOString(),
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
      await recordSessionTokenUsage({
        chatSessionStore: options.chatSessionStore,
        sessionId,
        usage:
          accumulatedUsage ??
          estimateChatTurnUsage([
            { role: "system", content: buildChatSystemPrompt(chatDate, chatTimeZone) },
            ...chatMessages,
            { role: "assistant", content: reply },
          ]),
      });

      return {
        ok: true,
        reply,
        sessionId,
        relatedMemories: relatedMemoryResults.map(toRelatedMemory),
        memoryId,
        ...(agentStatus ? { agentStatus } : {}),
        ...(requestedSkill?.kind === "matched"
          ? {
              selectedSkill: {
                name: requestedSkill.skill.manifest.name,
                displayName: requestedSkill.skill.manifest.displayName,
              },
            }
          : {}),
      };
  }

  async function respondSkillInputOnce(
    input: SkillInputResponse,
    runtimeOptions: SendChatMessageRuntimeOptions,
  ): Promise<SkillInputResponseResult> {
    const pending =
      pendingSkillInputRequests.get(input.inputRequestId) ??
      (await recoverPendingSkillInputState(input.inputRequestId));
    if (!pending) {
      return {
        ok: false,
        message: "Unknown skill input request.",
      };
    }

    const mergedValues = {
      ...pending.partialValues,
      ...input.values,
    };
    const inputResolution = resolveSkillInput({
      skill: pending.selectedSkill,
      values: mergedValues,
      runContext: pending.runContext,
    });
    if (inputResolution.status !== "complete") {
      const inputRequest = createSkillUserInputRequest({
        createId,
        inputRequestId: input.inputRequestId,
        sessionId: pending.sessionId,
        requestId: pending.requestId,
        skill: pending.selectedSkill,
        inputResolution,
        createdAt: new Date(getNowMs(options.now)).toISOString(),
      });
      const persisted = createPendingSkillInputState({
        inputRequest,
        sessionId: pending.sessionId,
        requestId: pending.requestId,
        userMessage: pending.userMessage,
        userMessageId: pending.userMessageId,
        selectedSkillName: pending.selectedSkill.manifest.name,
        ...(pending.workspaceId ? { workspaceId: pending.workspaceId } : {}),
        ...(pending.workspaceSummary
          ? { workspaceSummary: pending.workspaceSummary }
          : {}),
        partialValues: inputResolution.values,
      });
      const emitStatus = createChatStatusEmitter({
        sessionId: pending.sessionId,
        requestId: pending.requestId,
        startedAtMs: getNowMs(options.now),
        now: options.now,
        onStatusEvent: runtimeOptions.onStatusEvent,
        onStreamEvent: runtimeOptions.onStreamEvent,
        onPersistEvent(event) {
          try {
            const sessionActivityWrite =
              options.chatSessionStore?.appendActivityEvent?.(
                event.sessionId,
                event,
              );
            void sessionActivityWrite?.catch(() => undefined);
          } catch {
            // Observability writes must not fail the response.
          }
        },
        async onRequiredPersistEvent(event) {
          await persistRequiredChatActivityEvent(options.chatSessionStore, event);
        },
      });
      try {
        await emitStatus.sendWaitingForInput(
          inputRequest,
          "Skill input required.",
          persisted,
        );
        emitStatus.sendStreamEvent({
          type: "output_part",
          part: createChatOutputAssembler(() =>
            new Date(getNowMs(options.now)).toISOString(),
          ).appendInputRequest(inputRequest),
        });
      } catch {
        const outputAssembler = createChatOutputAssembler(() =>
          new Date(getNowMs(options.now)).toISOString(),
        );
        emitStatus.sendStreamEvent({
          type: "output_part",
          part: outputAssembler.appendDiagnostic({
            severity: "error",
            title: "请求失败",
            message: "Failed to persist skill input request.",
          }),
        });
        emitStatus.sendTerminalEvent({
          type: "failed",
          message: "Failed to persist skill input request.",
        });
        return {
          ok: false,
          message: "Failed to persist skill input request.",
        };
      }
      pendingSkillInputRequests.set(inputRequest.id, {
        ...toInMemoryPendingSkillInputState({
          persisted,
          selectedSkill: pending.selectedSkill,
          ...(pending.runContext ? { runContext: pending.runContext } : {}),
        }),
      });
      return {
        ok: false,
        message: "Skill input required.",
      };
    }

    try {
      await markPersistedSkillInputCompleted(pending);
    } catch {
      return {
        ok: false,
        message: "Failed to persist skill input completion.",
      };
    }
    pendingSkillInputRequests.delete(input.inputRequestId);
    const result = await sendMessageInternal(
      {
        sessionId: pending.sessionId,
        requestId: pending.requestId,
        message: pending.userMessage,
        selectedSkillName: pending.selectedSkill.manifest.name,
        ...(pending.workspaceId ? { workspaceId: pending.workspaceId } : {}),
        ...(pending.workspaceSummary
          ? { workspaceSummary: pending.workspaceSummary }
          : {}),
      },
      runtimeOptions,
      {
        skipUserMessageAppend: true,
        userMessageId: pending.userMessageId,
        forcedSkill: pending.selectedSkill,
        resolvedSkillInput: inputResolution,
        ...(pending.runContext ? { preResolvedRunContext: pending.runContext } : {}),
        ...(pending.workspaceSummary
          ? { preResolvedWorkspaceSummary: pending.workspaceSummary }
          : {}),
      },
    );
    return result;
  }

  return {
    async respondSkillInput(input, runtimeOptions = {}) {
      if (inFlightSkillInputResponses.has(input.inputRequestId)) {
        return {
          ok: false,
          message: "Skill input response already in progress.",
        };
      }

      inFlightSkillInputResponses.add(input.inputRequestId);
      try {
        return await respondSkillInputOnce(input, runtimeOptions);
      } finally {
        inFlightSkillInputResponses.delete(input.inputRequestId);
      }
    },
    sendMessage: sendMessageInternal,
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
  requestId: string;
  startedAtMs: number;
  now?: () => Date;
  onStatusEvent?: (event: ChatTaskStatusEvent) => void;
  onStreamEvent?: (event: ChatStreamEvent) => void;
  onPersistEvent?: (event: ChatTaskStatusEvent) => void;
  onRequiredPersistEvent?: (event: ChatTaskStatusEvent) => Promise<void>;
}) {
  let sessionId = options.sessionId;
  let assistantMessageId: string | undefined;
  let sequence = 0;
  const turnId = `turn-${options.requestId}`;

  function createStreamBase(createdAt: string) {
    return {
      sessionId,
      requestId: options.requestId,
      sequence: ++sequence,
      turnId,
      ...(assistantMessageId ? { assistantMessageId } : {}),
      createdAt,
    };
  }

  function createStatusEvent(
    event: Omit<ChatTaskStatusEvent, "sessionId" | "createdAt" | "elapsedMs">,
  ): ChatTaskStatusEvent {
    const nowMs = getNowMs(options.now);
    return {
      ...event,
      sessionId,
      createdAt: new Date(nowMs).toISOString(),
      elapsedMs: Math.max(0, nowMs - options.startedAtMs),
    };
  }

  function publishStatusEvent(
    statusEvent: ChatTaskStatusEvent,
    optionsOverride: { persist: boolean },
  ) {
    if (optionsOverride.persist) {
      try {
        options.onPersistEvent?.(statusEvent);
      } catch {
        // Persistence observers are best-effort.
      }
    }
    try {
      options.onStatusEvent?.(statusEvent);
    } catch {
      // Renderer observers are best-effort.
    }
    try {
      options.onStreamEvent?.({
        type: "status",
        status: statusEvent,
        ...createStreamBase(statusEvent.createdAt),
      });
    } catch {
      // Renderer observers are best-effort.
    }
  }

  return {
    setSessionId(nextSessionId: string) {
      sessionId = nextSessionId;
    },
    send(event: Omit<ChatTaskStatusEvent, "sessionId" | "createdAt" | "elapsedMs">) {
      publishStatusEvent(createStatusEvent(event), { persist: true });
    },
    async sendWaitingForInput(
      inputRequest: SkillUserInputRequest,
      message: string,
      pendingSkillInput: SkillPendingInputState,
    ) {
      const statusEvent = createStatusEvent({
        state: "waiting_for_input",
        message,
        selectedSkillName: inputRequest.skillName,
        inputRequest,
        pendingSkillInput,
      });
      if (!options.onRequiredPersistEvent) {
        throw new Error("Chat activity persistence is unavailable.");
      }
      await options.onRequiredPersistEvent(statusEvent);
      publishStatusEvent(statusEvent, { persist: false });
      const nowMs = getNowMs(options.now);
      try {
        options.onStreamEvent?.({
          type: "waiting_for_input",
          inputRequest,
          ...createStreamBase(new Date(nowMs).toISOString()),
        });
      } catch {
        // Renderer observers are best-effort.
      }
    },
    setAssistantMessageId(nextAssistantMessageId: string | null | undefined) {
      assistantMessageId = nextAssistantMessageId ?? undefined;
    },
    sendStreamEvent(event: ChatModelStreamEventInput) {
      const nowMs = getNowMs(options.now);
      try {
        options.onStreamEvent?.({
          ...cloneChatModelStreamEventInput(event),
          ...createStreamBase(new Date(nowMs).toISOString()),
        });
      } catch {
        // Renderer observers are best-effort.
      }
    },
    sendTerminalEvent(event: {
      type: "completed" | "failed" | "canceled";
      message?: string;
      finalMessageId?: string;
    }) {
      if (event.finalMessageId) {
        assistantMessageId = event.finalMessageId;
      }
      const nowMs = getNowMs(options.now);
      try {
        options.onStreamEvent?.({
          ...event,
          ...createStreamBase(new Date(nowMs).toISOString()),
        });
      } catch {
        // Renderer observers are best-effort.
      }
    },
  };
}

type ChatModelStreamEventInput =
  | { type: "answer_delta"; text: string }
  | { type: "thinking_delta"; text: string }
  | { type: "output_part"; part: ChatOutputPart }
  | {
      type: "tool_call_preview";
      toolCallId: string;
      toolName?: string;
      argumentsDelta?: string;
    };

function cloneChatModelStreamEventInput(
  event: ChatModelStreamEventInput,
): ChatModelStreamEventInput {
  if (event.type !== "output_part") {
    return event;
  }

  return {
    ...event,
    part: structuredClone(event.part),
  };
}

function emitModelStreamEvent(
  emitter: ReturnType<typeof createChatStatusEmitter>,
  outputAssembler: ReturnType<typeof createChatOutputAssembler>,
  event: ModelStreamEvent,
) {
  if (event.type === "content_delta") {
    emitter.sendStreamEvent({ type: "answer_delta", text: event.text });
    const textPart = outputAssembler.appendText(event.text);
    if (textPart) {
      emitter.sendStreamEvent({ type: "output_part", part: textPart });
    }
    return;
  }

  if (event.type === "reasoning_delta") {
    emitter.sendStreamEvent({ type: "thinking_delta", text: event.text });
    return;
  }

  if (event.type === "tool_call_delta") {
    const index = normalizeToolCallPreviewIndex(event.index);
    const toolCallId = event.id || (index !== undefined ? `index:${index}` : "");
    emitter.sendStreamEvent({
      type: "tool_call_preview",
      toolCallId,
      ...(index !== undefined ? { index } : {}),
      ...(event.name ? { toolName: event.name } : {}),
      ...(event.arguments ? { argumentsDelta: event.arguments } : {}),
    });
    emitter.sendStreamEvent({
      type: "output_part",
      part: outputAssembler.appendToolCall({
        toolCallId,
        ...(event.name ? { toolName: event.name } : {}),
        ...(event.arguments ? { argumentsText: event.arguments } : {}),
      }),
    });
  }
}

function normalizeToolCallPreviewIndex(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(0, Math.floor(value));
}

function getNowMs(now: (() => Date) | undefined): number {
  return now ? now().getTime() : Date.now();
}

function inferApprovalRiskLevel(input: {
  toolName: string;
  source?: string;
}): "medium" | "high" {
  const normalized = `${input.toolName} ${input.source ?? ""}`.toLowerCase();
  if (
    normalized.includes("shell") ||
    normalized.includes("file_write") ||
    normalized.includes("markdown_report_write") ||
    (normalized.includes("markdown") && normalized.includes("write"))
  ) {
    return "high";
  }
  return "medium";
}

type ChatWorkspaceRunRecorder = {
  workspaceRunId: string;
  appendStatusEvent(event: ChatTaskStatusEvent): Promise<void>;
};

async function createChatWorkspaceRunRecorder(options: {
  workspaceRunStore:
    | Pick<WorkspaceRunStore, "createRun" | "appendEvent" | "finishRun">
    | undefined;
  sessionId: string;
  requestId: string;
  runContext: AgentRunContext;
  selectedSkillName?: string;
  createdAt: string;
}): Promise<ChatWorkspaceRunRecorder | null> {
  if (!options.workspaceRunStore) {
    return null;
  }

  const workspaceRunStore = options.workspaceRunStore;
  const workspaceRunId = `chat_run_${sanitizeRuntimeId(
    options.sessionId,
  )}_${sanitizeRuntimeId(options.requestId)}`;
  let finished = false;

  try {
    await workspaceRunStore.createRun({
      workspaceRunId,
      sessionId: options.sessionId,
      requestId: options.requestId,
      workspaceId: options.runContext.workspaceId,
      workspaceRoot: options.runContext.workspaceRoot,
      ...(options.selectedSkillName
        ? { selectedSkillName: options.selectedSkillName }
        : {}),
      status: "running",
      createdAt: options.createdAt,
    });
  } catch {
    return null;
  }

  return {
    workspaceRunId,
    async appendStatusEvent(event) {
      const ledgerEvent = toWorkspaceRunEventInput(event);
      if (!ledgerEvent) {
        return;
      }

      try {
        await workspaceRunStore.appendEvent(workspaceRunId, ledgerEvent);
        const terminalStatus = toWorkspaceRunTerminalStatus(event);
        if (terminalStatus && !finished) {
          finished = true;
          await workspaceRunStore.finishRun(
            workspaceRunId,
            terminalStatus,
            event.message,
          );
        }
      } catch {
        // Observability writes must not fail the user-facing chat turn.
      }
    },
  };
}

function toWorkspaceRunEventInput(
  event: ChatTaskStatusEvent,
): WorkspaceRunEventInput | null {
  const payload = {
    chatState: event.state,
    ...(typeof event.turn === "number" ? { turn: event.turn } : {}),
    ...(event.toolCallId ? { toolCallId: event.toolCallId } : {}),
    ...(event.toolInvocationId ? { toolInvocationId: event.toolInvocationId } : {}),
    ...(event.toolSource ? { toolSource: event.toolSource } : {}),
    ...(event.resultRef ? { resultRef: event.resultRef } : {}),
    ...(typeof event.resultBytes === "number"
      ? { resultBytes: event.resultBytes }
      : {}),
    ...(typeof event.toolCallsExecuted === "number"
      ? { toolCallsExecuted: event.toolCallsExecuted }
      : {}),
    ...(typeof event.maxTurns === "number" ? { maxTurns: event.maxTurns } : {}),
  };

  if (event.state === "reasoning") {
    return {
      type: "reasoning",
      content: event.message,
      message: event.message,
      payload,
      createdAt: event.createdAt,
    };
  }

  if (event.state === "skill") {
    return {
      type: "skill_stage",
      skillName: event.selectedSkillName,
      stage: "invoked",
      message: event.message,
      payload,
      createdAt: event.createdAt,
    };
  }

  if (event.state === "tool_call") {
    return {
      type: "tool_call",
      toolCallId: event.toolCallId ?? getStatusEventToolCallId(event),
      toolName: event.toolName ?? "unknown",
      message: event.message,
      payload,
      createdAt: event.createdAt,
    };
  }

  if (event.state === "tool_result") {
    return {
      type: "tool_result",
      toolCallId: event.toolCallId ?? getStatusEventToolCallId(event),
      toolName: event.toolName,
      ok: event.ok,
      ...(event.resultRef ? { resultRef: event.resultRef } : {}),
      ...(typeof event.resultBytes === "number"
        ? { resultBytes: event.resultBytes }
        : {}),
      message: event.message,
      payload,
      createdAt: event.createdAt,
    };
  }

  if (event.state === "tool_invocation") {
    return {
      type: "tool_invocation",
      toolInvocationId:
        event.toolInvocationId ??
        `tool_invocation_${event.toolCallId ?? "unknown"}`,
      toolCallId: event.toolCallId ?? getStatusEventToolCallId(event),
      toolName: event.toolName ?? "unknown",
      toolSource: event.toolSource ?? "unknown",
      invocationStatus:
        typeof event.invocationStatus === "string"
          ? event.invocationStatus
          : "proposed",
      ...(typeof event.ok === "boolean" ? { ok: event.ok } : {}),
      ...(event.resultRef ? { resultRef: event.resultRef } : {}),
      ...(typeof event.resultBytes === "number"
        ? { resultBytes: event.resultBytes }
        : {}),
      message: event.message,
      payload,
      createdAt: event.createdAt,
    };
  }

  return {
    type: "status",
    status: toWorkspaceRunStatus(event),
    message: event.message,
    payload,
    createdAt: event.createdAt,
  };
}

function toWorkspaceRunStatus(event: ChatTaskStatusEvent): WorkspaceRunStatus {
  if (event.state === "paused") return "paused";
  if (event.state === "failed") return "failed";
  if (event.state === "canceled") return "canceled";
  if (event.state === "completed") return "succeeded";
  return "running";
}

function toWorkspaceRunTerminalStatus(
  event: ChatTaskStatusEvent,
): WorkspaceRunTerminalStatus | null {
  if (event.state === "completed") return "succeeded";
  if (event.state === "failed") return "failed";
  if (event.state === "canceled") return "canceled";
  return null;
}

function getStatusEventToolCallId(event: ChatTaskStatusEvent): string {
  return [
    event.sessionId,
    event.createdAt,
    event.toolName ?? "tool",
    event.toolCallsExecuted ?? 0,
  ]
    .map((value) => sanitizeRuntimeId(String(value)))
    .join("_");
}

async function resolveChatWorkspace(options: {
  workspaceService?: Pick<AgentWorkspaceService, "resolveRunContext">;
  workspaceId?: string;
}): Promise<
  | { ok: true; runContext?: AgentRunContext }
  | { ok: false; message: string }
> {
  if (!options.workspaceService) {
    return { ok: true };
  }

  try {
    const runContext = await options.workspaceService.resolveRunContext({
      ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
    });
    return { ok: true, runContext };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? `无法解析工作区：${error.message}`
          : "无法解析工作区。",
    };
  }
}

function buildChatWorkspaceSummary(
  runContext: AgentRunContext,
): ChatWorkspaceSummary {
  return {
    name: path.basename(runContext.workspaceRoot) || runContext.workspaceRoot,
    rootPath: runContext.workspaceRoot,
    kind: "project",
    sandboxMode: runContext.sandbox.mode,
  };
}

function createChatRuntimeTask(options: {
  sessionId: string;
  requestId: string;
  runContext: AgentRunContext;
  selectedSkill?: SkillRecord;
  skillInputValues?: Record<string, SkillInputValue>;
}): {
  taskId: string;
  runtimeTask: RuntimeToolAuthorizationTask;
} {
  const taskId = `chat_${sanitizeRuntimeId(options.sessionId)}_${sanitizeRuntimeId(
    options.requestId,
  )}`;
  const skillReadRoots = options.selectedSkill
    ? [options.selectedSkill.rootDir]
    : [];
  const permissions: TaskPermissionPolicy = {
    files: {
      read: uniqueStrings([
        options.runContext.workspaceRoot,
        ...options.runContext.sandbox.extraReadRoots,
        ...skillReadRoots,
        ...readSkillPermissionPaths(options.selectedSkill, options.skillInputValues),
      ]),
      write:
        options.runContext.sandbox.mode === "read_only"
          ? []
          : uniqueStrings([
              options.runContext.workspaceRoot,
              ...options.runContext.sandbox.extraWriteRoots,
              ...writeSkillPermissionPaths(
                options.selectedSkill,
                options.skillInputValues,
              ),
            ]),
    },
    web: {
      search: Boolean(options.selectedSkill?.manifest.permissions.web.search),
      fetchDomains: [
        ...(options.selectedSkill?.manifest.permissions.web.fetchDomains ?? []),
      ],
    },
    shell: {
      commands: uniqueStrings([
        ...buildDefaultChatShellTemplates(),
        ...(options.selectedSkill?.manifest.permissions.shell.commands ?? []),
      ]),
    },
    memory: {
      read: true,
      write: false,
    },
    tools: {
      allowedNames: options.selectedSkill
        ? uniqueStrings([
            "skill_resource_list",
            "skill_load",
            ...(options.selectedSkill.manifest.tools?.map((tool) => tool.name) ?? []),
          ])
        : [],
      allowedSkillNames: options.selectedSkill
        ? [options.selectedSkill.manifest.name]
        : [],
      allowedSources: options.selectedSkill
        ? [
            ...(options.selectedSkill.manifest.tools?.length
              ? [`skill:${options.selectedSkill.manifest.name}`]
              : []),
            ...(options.selectedSkill.manifest.mcpServers?.map(
              (server) =>
                `mcp:${options.selectedSkill?.manifest.name}:${server.name}`,
            ) ?? []),
          ]
        : [],
    },
  };

  return {
    taskId,
    runtimeTask: {
      name: options.selectedSkill
        ? `Chat skill: ${options.selectedSkill.manifest.name}`
        : "Chat task",
      permissions,
      policyLabel: "chat workspace contract",
    },
  };
}

function extendRunContextForSelectedSkill(options: {
  runContext: AgentRunContext;
  selectedSkill: SkillRecord;
  skillInputValues?: Record<string, SkillInputValue>;
}): AgentRunContext {
  const skillReadRoots = [
    options.selectedSkill.rootDir,
    ...readSkillPermissionPaths(options.selectedSkill, options.skillInputValues),
  ];
  const skillWriteRoots = writeSkillPermissionPaths(
    options.selectedSkill,
    options.skillInputValues,
  );

  return {
    ...options.runContext,
    sandbox: {
      ...options.runContext.sandbox,
      extraReadRoots: uniqueStrings([
        ...options.runContext.sandbox.extraReadRoots,
        ...skillReadRoots,
      ]),
      extraWriteRoots: uniqueStrings([
        ...options.runContext.sandbox.extraWriteRoots,
        ...skillWriteRoots,
      ]),
    },
  };
}

function readSkillPermissionPaths(
  skill: SkillRecord | undefined,
  values?: Record<string, SkillInputValue>,
): string[] {
  return (skill?.manifest.permissions.files.read ?? []).map((permissionPath) =>
    resolveSkillPermissionPath(permissionPath, skill, values),
  );
}

function writeSkillPermissionPaths(
  skill: SkillRecord | undefined,
  values?: Record<string, SkillInputValue>,
): string[] {
  return (skill?.manifest.permissions.files.write ?? []).map((permissionPath) =>
    resolveSkillPermissionPath(permissionPath, skill, values),
  );
}

function resolveSkillPermissionPath(
  permissionPath: string,
  skill: SkillRecord | undefined,
  values?: Record<string, SkillInputValue>,
): string {
  if (!skill) {
    return permissionPath;
  }
  const withSkillPaths = permissionPath
    .replaceAll("{{skillRoot}}", skill.rootDir)
    .replaceAll("{{skillDir}}", skill.rootDir);
  return withSkillPaths.replace(/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g, (match, name) => {
    const value = values?.[name];
    return value === undefined ? match : String(value);
  });
}

function buildDefaultChatShellTemplates(): string[] {
  const commands = [
    "bash",
    "cat",
    "file",
    "find",
    "git",
    "ls",
    "mkdir",
    "node",
    "npm",
    "npx",
    "open",
    "python",
    "python3",
    "rg",
    "sed",
    "sh",
    "stat",
  ];
  const templates: string[] = [];
  for (const command of commands) {
    for (let argCount = 1; argCount <= 8; argCount += 1) {
      templates.push(`${command} ${Array(argCount).fill("*").join(" ")}`);
    }
  }
  return templates;
}

function sanitizeRuntimeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "run";
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
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

  return `工具失败：${toolName}（${summarizeToolError(result.error)}）`;
}

function summarizeToolError(error: string): string {
  const normalized = error.replace(/\s+/g, " ").trim();
  if (normalized.length <= 180) {
    return normalized || "未知错误";
  }
  return `${normalized.slice(0, 179)}…`;
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
  now?: () => Date;
  signal?: AbortSignal;
}): Promise<{ result: SendChatMessageResult } | null> {
  async function appendGoalReply(input: {
    content: string;
    goalId: string;
    goalEventRef: string;
  }) {
    const goalOutputAssembler = createChatOutputAssembler(() =>
      new Date(getNowMs(options.now)).toISOString(),
    );
    goalOutputAssembler.setFinalText(input.content);
    const assistantMessageId = await appendAssistantMessage({
      chatSessionStore: options.chatSessionStore,
      sessionId: options.sessionId,
      content: input.content,
      outputParts: goalOutputAssembler.parts(),
      goalId: input.goalId,
      goalEventRef: input.goalEventRef,
    });
    options.emitStatus?.setAssistantMessageId(assistantMessageId);
    options.emitStatus?.sendTerminalEvent({
      type: "completed",
      message: input.content,
      ...(assistantMessageId ? { finalMessageId: assistantMessageId } : {}),
    });
  }

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
    await syncChatGoalSummary(
      options.chatSessionStore,
      options.sessionId,
      activeGoal,
    );
    const reply = `已设置并开始执行目标：${activeGoal.description}。`;
    options.emitStatus?.send({
      state: "completed",
      message: "目标已开始执行",
      toolCallsExecuted: 0,
    });
    await appendGoalReply({
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

    await syncChatGoalSummary(
      options.chatSessionStore,
      options.sessionId,
      activeGoal,
    );
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
    await appendGoalReply({
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
    await syncChatGoalSummary(
      options.chatSessionStore,
      options.sessionId,
      activeGoal,
    );
    const reply = `已暂停目标：${activeGoal.description}。`;
    await appendGoalReply({
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
    await syncChatGoalSummary(
      options.chatSessionStore,
      options.sessionId,
      activeGoal,
    );
    const reply = `已结束目标：${activeGoal.description}。`;
    await appendGoalReply({
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
  await syncChatGoalSummary(
    options.chatSessionStore,
    options.sessionId,
    activeGoal,
  );
  const reply = `已记录目标调整：${options.route.instructions}`;
  await appendGoalReply({
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
    status === "stopped_stalled" ||
    status === "failed" ||
    status === "canceled"
  );
}

async function syncChatGoalSummary(
  chatSessionStore:
    | Pick<ChatSessionStore, "appendMessage" | "attachGoal" | "clearActiveGoal">
    | undefined,
  sessionId: string,
  goal: ChatSessionGoalSummary,
) {
  await chatSessionStore?.attachGoal(sessionId, goal);
  if (shouldClearActiveChatGoal(goal.status)) {
    await chatSessionStore?.clearActiveGoal(sessionId, goal.id);
  }
}

function shouldClearActiveChatGoal(
  status: ChatSessionGoalSummary["status"],
): boolean {
  return status === "achieved" || status === "failed" || status === "canceled";
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
  outputParts?: ChatOutputPart[];
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
      ...(options.outputParts?.length ? { outputParts: options.outputParts } : {}),
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

function createSkillUserInputRequest(options: {
  createId: () => string;
  inputRequestId?: string;
  sessionId: string;
  requestId: string;
  skill: SkillRecord;
  inputResolution: SkillInputResolution;
  createdAt: string;
}): SkillUserInputRequest {
  const unresolvedFieldNames = new Set([
    ...options.inputResolution.missingFields,
    ...options.inputResolution.invalidFields,
  ]);
  const requestedFields = options.skill.manifest.inputs.filter(
    (field) => unresolvedFieldNames.size === 0 || unresolvedFieldNames.has(field.name),
  );
  const fields = (requestedFields.length > 0
    ? requestedFields
    : options.skill.manifest.inputs
  ).map((field) => ({
    name: field.name,
    label: field.label,
    type: field.type,
    required: field.required,
    ...(field.description ? { description: field.description } : {}),
    ...(field.defaultValue !== undefined ? { defaultValue: field.defaultValue } : {}),
    ...(field.choices?.length ? { choices: field.choices } : {}),
  }));

  return {
    id: options.inputRequestId ?? `skill_input_${sanitizeRuntimeId(options.createId())}`,
    executionId: `skill_exec_${sanitizeRuntimeId(options.sessionId)}_${sanitizeRuntimeId(
      options.requestId,
    )}_${sanitizeRuntimeId(options.skill.manifest.name)}`,
    sessionId: options.sessionId,
    requestId: options.requestId,
    skillName: options.skill.manifest.name,
    reason:
      options.inputResolution.status === "invalid"
        ? "Invalid skill input."
        : "Skill input required.",
    fields,
    createdAt: options.createdAt,
  };
}

function createPendingSkillInputState(options: {
  inputRequest: SkillUserInputRequest;
  sessionId: string;
  requestId: string;
  userMessage: string;
  userMessageId: string | null;
  selectedSkillName: string;
  workspaceId?: string;
  workspaceSummary?: ChatWorkspaceSummary;
  partialValues: Record<string, SkillInputValue>;
}): SkillPendingInputState {
  return {
    inputRequestId: options.inputRequest.id,
    status: "pending",
    sessionId: options.sessionId,
    requestId: options.requestId,
    userMessage: options.userMessage,
    ...(options.userMessageId ? { userMessageId: options.userMessageId } : {}),
    selectedSkillName: options.selectedSkillName,
    ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
    ...(options.workspaceSummary ? { workspaceSummary: options.workspaceSummary } : {}),
    partialValues: options.partialValues,
  };
}

function toInMemoryPendingSkillInputState(options: {
  persisted: SkillPendingInputState;
  selectedSkill: SkillRecord;
  runContext?: AgentRunContext;
}): PendingSkillInputState {
  return {
    persisted: options.persisted,
    sessionId: options.persisted.sessionId,
    requestId: options.persisted.requestId,
    userMessage: options.persisted.userMessage,
    userMessageId: options.persisted.userMessageId ?? null,
    selectedSkill: options.selectedSkill,
    ...(options.persisted.workspaceId
      ? { workspaceId: options.persisted.workspaceId }
      : {}),
    ...(options.persisted.workspaceSummary
      ? { workspaceSummary: options.persisted.workspaceSummary }
      : {}),
    ...(options.runContext ? { runContext: options.runContext } : {}),
    partialValues: options.persisted.partialValues,
  };
}

async function findPersistedPendingSkillInputState(options: {
  inputRequestId: string;
  chatSessionStore:
    | (Partial<Pick<ChatSessionStore, "get" | "list">>)
    | undefined;
}): Promise<SkillPendingInputState | null> {
  if (!options.chatSessionStore?.list || !options.chatSessionStore.get) {
    return null;
  }

  let latest: SkillPendingInputState | null = null;
  const sessions: ChatSessionListItem[] = await options.chatSessionStore.list();
  for (const session of sessions) {
    const record: ChatSessionRecord | null =
      await options.chatSessionStore.get(session.id);
    for (const event of record?.activity?.statusEvents ?? []) {
      if (event.pendingSkillInput?.inputRequestId === options.inputRequestId) {
        latest = event.pendingSkillInput;
      }
    }
  }

  return latest?.status === "pending" ? latest : null;
}

async function persistRequiredChatActivityEvent(
  chatSessionStore:
    | (Partial<Pick<ChatSessionStore, "appendActivityEvent">>)
    | undefined,
  event: ChatTaskStatusEvent,
): Promise<void> {
  if (!chatSessionStore?.appendActivityEvent) {
    throw new Error("Chat session activity persistence is unavailable.");
  }

  const record = await chatSessionStore.appendActivityEvent(event.sessionId, event);
  if (!record) {
    throw new Error("Chat session activity persistence did not update a session.");
  }
}

function buildChatSystemPrompt(currentDate?: string, timeZone?: string): string {
  return getSystemPromptAssembler().assemble({
    mode: "chat",
    currentDate,
    timeZone,
  }).prompt;
}

type RequestedSkillResolution =
  | { kind: "matched"; skill: SkillRecord }
  | { kind: "missing"; message: string };

async function resolveRequestedSkill(options: {
  message: string;
  selectedSkillName?: string;
  discoverSkills?: () => Promise<SkillDiscoveryResult>;
}): Promise<RequestedSkillResolution | null> {
  const explicitQuery =
    options.selectedSkillName ?? extractRequestedSkillQuery(options.message);
  if (!explicitQuery) {
    return null;
  }

  if (!options.discoverSkills) {
    return options.selectedSkillName
      ? {
          kind: "missing",
          message: `无法读取技能库，不能调用技能“${options.selectedSkillName}”。`,
        }
      : null;
  }

  const { skills } = await options.discoverSkills();
  const exactSkill = skills.find(
    (skill) => skill.manifest.name.toLowerCase() === explicitQuery.toLowerCase(),
  );
  if (exactSkill) {
    return { kind: "matched", skill: exactSkill };
  }

  const matched = matchSkillMentionCandidates(
    skills.map((skill) => ({
      name: skill.manifest.name,
      displayName: skill.manifest.displayName,
      description: skill.manifest.description,
    })),
    explicitQuery,
  );
  if (matched.length === 1) {
    const skill = skills.find((candidate) => candidate.manifest.name === matched[0].name);
    if (skill) {
      return { kind: "matched", skill };
    }
  }

  if (matched.length > 1) {
    return {
      kind: "missing",
      message: `找到多个匹配“${explicitQuery}”的技能：${matched
        .map((skill) => skill.name)
        .join("、")}。请用 @ 选择一个具体技能。`,
    };
  }

  return {
    kind: "missing",
    message: `没有找到技能“${explicitQuery}”。请确认技能名称，或输入 @ 后从列表中选择。`,
  };
}

function injectSkillInvocationMessage(
  messages: ChatMessage[],
  skill: SkillRecord,
  inputResolution?: SkillInputResolution,
): ChatMessage[] {
  return [
    {
      role: "system",
      content: buildSelectedSkillInstruction(skill, inputResolution),
    },
    ...messages,
  ];
}

function buildSelectedSkillInstruction(
  skill: SkillRecord,
  inputResolution?: SkillInputResolution,
): string {
  const lines = [
    "本轮用户显式选择了一个 Agent Skill。主进程已预加载技能正文，你必须把它当作本轮任务的执行规范，而不是普通参考资料。",
    `技能名称：${skill.manifest.name}`,
    `技能显示名：${skill.manifest.displayName}`,
    `技能描述：${skill.manifest.description}`,
    `技能位置：${skill.skillFile}`,
  ];

  if (inputResolution?.status === "complete") {
    lines.splice(
      4,
      0,
      "",
      "已解析技能输入（JSON）：",
      JSON.stringify(inputResolution.values, null, 2),
    );
  }

  lines.push(
    "",
    "执行要求：",
    "- 必须按技能正文执行；不要把技能正文当作可选参考。",
    "- 如果技能要求渐进式交互、配置菜单、质量检查、验证命令或特定输出格式，不得跳过。",
    "- 如果技能正文指向额外文件，必须按正文中的路由说明读取相关文件后再行动。",
    "- 最终回复需要说明已使用该技能。",
    "",
    "技能正文：",
    "```markdown",
    skill.body.trim() || "(技能正文为空)",
    "```",
  );

  return lines.join("\n");
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

function toChatSessionTokenUsage(
  usage: ChatCompletionResponse["usage"] | undefined,
): ChatSessionTokenUsage | null {
  if (!usage) {
    return null;
  }

  const promptTokens = normalizeTokenCount(usage.promptTokens ?? usage.inputTokens);
  const completionTokens = normalizeTokenCount(
    usage.completionTokens ?? usage.outputTokens,
  );
  const totalTokens = normalizeTokenCount(
    usage.totalTokens ?? (promptTokens ?? 0) + (completionTokens ?? 0),
  );
  if (totalTokens === undefined || totalTokens <= 0) {
    return null;
  }

  return {
    totalTokens,
    ...(promptTokens !== undefined ? { promptTokens } : {}),
    ...(completionTokens !== undefined ? { completionTokens } : {}),
    estimated: false,
  };
}

function mergeChatSessionTokenUsage(
  current: ChatSessionTokenUsage | null,
  next: ChatSessionTokenUsage | null,
): ChatSessionTokenUsage | null {
  if (!next) {
    return current;
  }
  if (!current) {
    return next;
  }

  const promptTokens = addOptionalTokenCounts(
    current.promptTokens,
    next.promptTokens,
  );
  const completionTokens = addOptionalTokenCounts(
    current.completionTokens,
    next.completionTokens,
  );

  return {
    totalTokens: current.totalTokens + next.totalTokens,
    ...(promptTokens !== undefined ? { promptTokens } : {}),
    ...(completionTokens !== undefined ? { completionTokens } : {}),
    estimated: current.estimated || next.estimated,
  };
}

function estimateChatTurnUsage(messages: ChatMessage[]): ChatSessionTokenUsage {
  return {
    totalTokens: Math.max(1, estimateMessageTokens(messages)),
    estimated: true,
  };
}

async function recordSessionTokenUsage(options: {
  chatSessionStore: Pick<ChatSessionStore, "addTokenUsage"> | undefined;
  sessionId: string;
  usage: ChatSessionTokenUsage;
}): Promise<void> {
  await options.chatSessionStore?.addTokenUsage(options.sessionId, options.usage);
}

function normalizeTokenCount(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(0, Math.floor(value));
}

function addOptionalTokenCounts(
  left: number | undefined,
  right: number | undefined,
): number | undefined {
  if (left === undefined && right === undefined) {
    return undefined;
  }
  return (left ?? 0) + (right ?? 0);
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

function appendRawHistoryEntry(options: {
  historyIndexStore: Pick<HistoryIndexStore, "append"> | undefined;
  createId: () => string;
  sessionId: string;
  requestId: string;
  role: RawHistoryRole;
  content: string;
  workspaceId?: string;
  toolName?: string;
  createdAt: string;
}) {
  if (!options.historyIndexStore) {
    return;
  }

  void options.historyIndexStore
    .append({
      id: options.createId(),
      sessionId: options.sessionId,
      runId: options.requestId,
      ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
      role: options.role,
      ...(options.toolName ? { toolName: options.toolName } : {}),
      content: truncateHistoryContent(options.content),
      createdAt: options.createdAt,
      source: options.role === "tool" ? "tool" : "chat",
    })
    .catch(() => undefined);
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

function truncateHistoryContent(value: string): string {
  const normalized = value.trim();
  if (normalized.length <= 4_000) {
    return normalized;
  }
  return `${normalized.slice(0, 4_000)}\n[truncated]`;
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
