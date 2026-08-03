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
import { sanitizeChatMessages } from "./messageIntegrity";
import { isMaxModeEnabled, type MaxMode } from "./providers/maxMode";
import {
  toChatCompletionResponse,
  toCompleteRequest,
} from "./providers/normalize";
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
  ChatAttachmentInput,
  ChatAttachmentMetadata,
  ChatHistoryMessage,
  ChatRelatedMemory,
  ChatSessionContextSnapshot,
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
import {
  getActionableGoalSummary,
  isLiveGoalStatus,
  isRecoverableGoalStatus,
} from "../shared/chatSessionWork";
import { getSystemPromptAssembler } from "../shared/agentProtocol";
import type { GoalReviewDecision } from "../shared/agentGoalReview";
import type { GoalDraft } from "../shared/goalTranslation";
import type {
  CreatePlanInput,
  CreateRuntimeGoalPlanResult,
  GoalAmendmentOperationResult,
  PlanMode,
  PlanModelAssignments,
  PlanRecord,
} from "../shared/planMode";
import { getPlanOutcomePresentation } from "../shared/planOutcome";
import type { AgentRunRecord, RunScheduledTaskResult } from "../shared/agentRuns";
import type { ExecutionContextMemoryScope } from "../shared/executionContextPackage";
import type { MemoryRecord, MemorySearchResult } from "../shared/memory";
import type { AgentContextUsage } from "../shared/contextUsage";
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
import {
  maskPreviewSecrets,
  stringifyMaskedPreview,
  type ChatOutputPart,
} from "../shared/chatOutput";
import {
  summarizeAgentRuntimeContextSnapshot,
} from "../shared/agentRuntimeContext";
import {
  modelServiceNoticeFromError,
  type ModelServiceNotice,
} from "../shared/modelServiceNotice";
import {
  extractRequestedSkillQuery,
  matchSkillMentionCandidates,
} from "../shared/skillMentions";
import { describeSchedule } from "../shared/scheduledTasks";
import type { TaskPermissionPolicy } from "../shared/toolPermissions";
import { resolveSkillInput } from "./skillExecutionService";
import {
  appendChatAttachmentContext,
  ChatAttachmentValidationError,
  processChatAttachments,
} from "./chatAttachmentProcessor";
import type {
  SkillInputResolution,
  SkillInputValue,
} from "../shared/skillExecutionContract";
import {
  CHAT_ATTACHMENT_MAX_COUNT,
  CHAT_ATTACHMENT_MAX_TEXT_CONTEXT_CHARS,
  CHAT_ATTACHMENT_MAX_TOTAL_BYTES,
} from "../shared/chatAttachments";
import { createRuntimeContextSnapshotForRun } from "./runtimeContextFactory";

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
  /** v3.6.0: Creation timestamp for TTL-based eviction (CONC-08). */
  createdAt: number;
};

type PersistedChatContinuation = ChatContinuationState & {
  version: 1;
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
  attachments?: SendChatMessageInput["attachments"];
  createdAtMs: number;
};

type CachedHistoryAttachmentPayload = {
  input: ChatAttachmentInput;
  lastAccessedAtMs: number;
};

type HistoryAttachmentReplayBudget = {
  remainingBytes: number;
  remainingCount: number;
  remainingTextContextChars: number;
  seenIds: Set<string>;
};

const PENDING_ATTACHMENT_PAYLOAD_TTL_MS = 60 * 60 * 1000;
const PENDING_ATTACHMENT_PAYLOAD_MAX_BYTES = 40 * 1024 * 1024;
const HISTORY_ATTACHMENT_PAYLOAD_TTL_MS = 60 * 60 * 1000;
const HISTORY_ATTACHMENT_PAYLOAD_MAX_BYTES = 40 * 1024 * 1024;
const EXPIRED_PENDING_ATTACHMENT_MESSAGE =
  "附件内容在应用重启或长时间等待后已失效，请重新发送消息并粘贴附件。";

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
    workspaceId?: string;
    originMessageId: string | null;
    description: string;
    selectedSkill?: SkillRecord;
    selectedSkillInputValues?: Record<string, SkillInputValue>;
  }): Promise<ChatSessionGoalSummary>;
  resume(
    goalId: string,
    options?: { signal?: AbortSignal },
  ): Promise<ChatSessionGoalSummary>;
  retry(goalId: string): Promise<ChatSessionGoalSummary>;
  pause(goalId: string): Promise<ChatSessionGoalSummary>;
  cancel(goalId: string): Promise<ChatSessionGoalSummary>;
  resolveReview(
    goalId: string,
    decision: GoalReviewDecision,
  ): Promise<ChatSessionGoalSummary>;
};

type ChatGoalDraftService = {
  createFromChat(input: {
    sessionId: string;
    workspaceId?: string;
    originMessageId: string | null;
    message: string;
    selectedSkill?: SkillRecord;
    selectedSkillInputValues?: Record<string, SkillInputValue>;
    signal?: AbortSignal;
  }): Promise<GoalDraft>;
};

type ChatPlanService = {
  createPlan(input: {
    sessionId: string;
    workspaceId?: string;
    workspaceRoot?: string;
    sourceMessage: string;
    mode: PlanMode;
    autonomyMode?: CreatePlanInput["autonomyMode"];
    modelAssignments?: PlanModelAssignments;
    signal?: AbortSignal;
  }): Promise<PlanRecord>;
  getInputRoutingPlan(sessionId: string): Promise<PlanRecord | null>;
  continueWithInput(
    planId: string,
    userInput: string,
    signal?: AbortSignal,
    autonomyMode?: CreatePlanInput["autonomyMode"],
  ): Promise<
    | { ok: true; plan: PlanRecord; message: string }
    | { ok: false; message: string; plan?: PlanRecord }
  >;
};

type ChatGoalAmendmentService = (
  goalId: string,
  objective: string,
  reason: string,
) => Promise<GoalAmendmentOperationResult>;

type ChatGoalRuntimeReplanService = (
  goalId: string,
  instructions: string,
) => Promise<CreateRuntimeGoalPlanResult>;

type GoalIntentRoute =
  | { kind: "set_goal"; description: string }
  | { kind: "continue_goal" }
  | { kind: "pause_goal" }
  | { kind: "cancel_goal" }
  | { kind: "modify_plan"; instructions: string }
  | { kind: "amend_goal"; objective: string }
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
  goalDraftService?: ChatGoalDraftService;
  planService?: ChatPlanService;
  proposeGoalAmendment?: ChatGoalAmendmentService;
  runtimeReplanGoal?: ChatGoalRuntimeReplanService;
  taskStore?: Pick<ScheduledTaskStore, "create" | "list">;
  runScheduledTask?: (
    taskId: string,
    options?: { sessionId?: string },
  ) => Promise<RunScheduledTaskResult>;
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
  maxMode?: MaxMode;
}): ChatService {
  const createId = options.createId ?? randomUUID;
  const memoryLimit = options.memoryLimit ?? 4;
  const historyLimit = options.historyLimit ?? 12;
  const agentLoopMaxTurns = normalizeAgentLoopMaxTurns(options.agentLoopMaxTurns);
  const pendingContinuations = new Map<string, ChatContinuationState>();
  const pendingSkillInputRequests = new Map<string, PendingSkillInputState>();
  const historyAttachmentPayloads = new Map<
    string,
    CachedHistoryAttachmentPayload
  >();
  const inFlightSkillInputResponses = new Set<string>();
  const sessionRequestTails = new Map<string, Promise<void>>();

  function cachePendingSkillInput(
    inputRequestId: string,
    pending: PendingSkillInputState,
  ): void {
    pendingSkillInputRequests.set(inputRequestId, pending);
    prunePendingAttachmentPayloads(getNowMs(options.now));
  }

  function prunePendingAttachmentPayloads(nowMs: number): void {
    for (const entry of pendingSkillInputRequests.values()) {
      if (
        entry.attachments?.length &&
        nowMs - entry.createdAtMs > PENDING_ATTACHMENT_PAYLOAD_TTL_MS
      ) {
        entry.attachments = undefined;
      }
    }
    const entriesWithPayload = [...pendingSkillInputRequests.values()]
      .filter((entry) => entry.attachments?.length)
      .sort((left, right) => left.createdAtMs - right.createdAtMs);
    let totalBytes = entriesWithPayload.reduce(
      (sum, entry) =>
        sum +
        (entry.attachments ?? []).reduce(
          (attachmentSum, attachment) => attachmentSum + attachment.size,
          0,
        ),
      0,
    );
    for (const entry of entriesWithPayload) {
      if (totalBytes <= PENDING_ATTACHMENT_PAYLOAD_MAX_BYTES) {
        break;
      }
      totalBytes -= (entry.attachments ?? []).reduce(
        (sum, attachment) => sum + attachment.size,
        0,
      );
      entry.attachments = undefined;
    }
  }

  function cacheHistoryAttachmentPayloads(
    sessionId: string,
    attachments: ChatAttachmentInput[],
    nowMs: number,
  ): void {
    pruneHistoryAttachmentPayloads(nowMs);
    for (const attachment of attachments) {
      const key = toHistoryAttachmentCacheKey(sessionId, attachment.id);
      const existing = historyAttachmentPayloads.get(key);
      if (
        existing &&
        existing.input.dataBase64 !== attachment.dataBase64
      ) {
        // Attachment identifiers are expected to be unique. Fail closed on a
        // collision so an older turn can never be rebound to different bytes.
        historyAttachmentPayloads.delete(key);
        continue;
      }
      historyAttachmentPayloads.set(key, {
        input: attachment,
        lastAccessedAtMs: nowMs,
      });
    }
    pruneHistoryAttachmentPayloads(nowMs);
  }

  function pruneHistoryAttachmentPayloads(nowMs: number): void {
    for (const [key, entry] of historyAttachmentPayloads) {
      if (
        nowMs - entry.lastAccessedAtMs >
        HISTORY_ATTACHMENT_PAYLOAD_TTL_MS
      ) {
        historyAttachmentPayloads.delete(key);
      }
    }
    const entries = [...historyAttachmentPayloads.entries()].sort(
      ([, left], [, right]) => left.lastAccessedAtMs - right.lastAccessedAtMs,
    );
    let totalBytes = entries.reduce(
      (sum, [, entry]) => sum + entry.input.size,
      0,
    );
    for (const [key, entry] of entries) {
      if (totalBytes <= HISTORY_ATTACHMENT_PAYLOAD_MAX_BYTES) {
        break;
      }
      totalBytes -= entry.input.size;
      historyAttachmentPayloads.delete(key);
    }
  }

  function resolveHistoryAttachmentPayload(
    sessionId: string,
    metadata: ChatAttachmentMetadata,
    nowMs: number,
  ): ChatAttachmentInput | undefined {
    const entry = historyAttachmentPayloads.get(
      toHistoryAttachmentCacheKey(sessionId, metadata.id),
    );
    if (!entry || !matchesAttachmentMetadata(entry.input, metadata)) {
      return undefined;
    }
    entry.lastAccessedAtMs = nowMs;
    return entry.input;
  }

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
      createdAtMs: getNowMs(options.now),
      ...(persisted.attachmentPayloads?.length
        ? { attachments: persisted.attachmentPayloads }
        : {}),
      ...(workspaceResolution.runContext
        ? {
            runContext: {
              ...workspaceResolution.runContext,
              sessionId: persisted.sessionId,
            },
          }
        : {}),
    });
    cachePendingSkillInput(inputRequestId, recovered);
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
        attachmentPayloads: undefined,
      },
    });
    if (!record) {
      throw new Error("Chat session activity persistence did not update a session.");
    }
  }

  async function executeMessageInternal(
    input: SendChatMessageInput,
    runtimeOptions: SendChatMessageRuntimeOptions = {},
    internalOptions: ChatTurnInternalOptions = {},
  ): Promise<SendChatMessageResult> {
      if (runtimeOptions.signal?.aborted) {
        return { ok: false, code: "CANCELED", retryable: true, message: "已中断任务。" };
      }
      let processedAttachments;
      try {
        processedAttachments = processChatAttachments(input.attachments);
      } catch (error) {
        return {
          ok: false,
          message:
            error instanceof ChatAttachmentValidationError
              ? error.message
              : "无法读取粘贴的附件。",
        };
      }
      const userMessage = input.message.trim()
        ? input.message
        : processedAttachments.metadata.length
          ? "请分析这些附件。"
          : input.message;
      if (!userMessage.trim()) {
        return { ok: false, code: "EMPTY_MESSAGE", message: "消息不能为空。" };
      }
      const modelUserMessage = appendChatAttachmentContext(
        userMessage,
        processedAttachments.textContext,
      );
      const hasAttachments = processedAttachments.metadata.length > 0;
      const preexistingInputRoutingPlan =
        options.planService && input.sessionId
          ? await options.planService.getInputRoutingPlan(input.sessionId)
          : null;
      if (
        processedAttachments.images.length > 0 &&
        (input.mode === "goal_plan" || preexistingInputRoutingPlan)
      ) {
        return {
          ok: false,
          message:
            "只读 Plan Mode 暂不支持图片附件。请先移除图片，或把关键信息转为文本附件后再规划。",
        };
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
        ...(options.chatSessionStore?.appendActivityEvent
          ? {
              async onRequiredPersistEvent(event: ChatTaskStatusEvent) {
                await persistRequiredChatActivityEvent(options.chatSessionStore, event);
              },
            }
          : {}),
      });
      const outputAssembler = createChatOutputAssembler(() =>
        new Date(getNowMs(options.now)).toISOString(),
      );
      let terminalStreamEventSent = false;

      function finalizeAssistantOutput(content: string): {
        outputParts?: ChatOutputPart[];
        finalTextPart?: ChatOutputPart;
      } {
        const finalTextPart = outputAssembler.setFinalText(content);
        const outputParts = outputAssembler.parts();
        return {
          ...(outputParts.length > 0 ? { outputParts } : {}),
          ...(finalTextPart ? { finalTextPart } : {}),
        };
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

      const persistedRequestTurn =
        input.sessionId && input.requestId && options.chatSessionStore?.get
          ? await findPersistedRequestTurn(
              options.chatSessionStore,
              input.sessionId,
              input.requestId,
            )
          : null;
      if (persistedRequestTurn?.assistant) {
        emitStatus.setAssistantMessageId(persistedRequestTurn.assistant.id);
        emitTerminalStreamEvent({
          type: "completed",
          message: persistedRequestTurn.assistant.content,
          finalMessageId: persistedRequestTurn.assistant.id,
        });
        return {
          ok: true,
          reply: persistedRequestTurn.assistant.content,
          sessionId: input.sessionId!,
          relatedMemories: [],
          memoryId: null,
        };
      }

      async function persistAssistantReply(input: {
        content: string;
        relatedMemoryIds?: string[];
        executedRunId?: string;
        goalId?: string;
        goalEventRef?: string;
        terminalType?: "completed" | "failed";
      }): Promise<string | null> {
        const finalizedOutput = finalizeAssistantOutput(input.content);
        const assistantMessageId = await appendAssistantMessage({
          chatSessionStore: options.chatSessionStore,
          sessionId,
          requestId,
          content: input.content,
          outputParts: finalizedOutput.outputParts,
          ...(input.relatedMemoryIds?.length
            ? { relatedMemoryIds: input.relatedMemoryIds }
            : {}),
          ...(input.executedRunId ? { executedRunId: input.executedRunId } : {}),
          ...(input.goalId ? { goalId: input.goalId } : {}),
          ...(input.goalEventRef ? { goalEventRef: input.goalEventRef } : {}),
        });
        emitStatus.setAssistantMessageId(assistantMessageId);
        if (finalizedOutput.finalTextPart) {
          emitOutputPart(finalizedOutput.finalTextPart);
        }
        emitTerminalStreamEvent({
          type: input.terminalType ?? "completed",
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
      let authoritativeHistory: ChatHistoryMessage[] | null = null;
      let sessionMessageCount = 0;
      let sessionCompactionBaseline = 0;
      let activeGoal: ChatSessionGoalSummary | null = null;
      if (
        options.chatSessionStore &&
        !internalOptions.skipUserMessageAppend &&
        !persistedRequestTurn?.user
      ) {
        const appendResult = await options.chatSessionStore.appendMessage({
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          role: "user",
          requestId,
          content: userMessage,
          ...(processedAttachments.metadata.length
            ? { attachments: processedAttachments.metadata }
            : {}),
          ...(chatRunContext?.workspaceId || input.workspaceId
            ? { workspaceId: chatRunContext?.workspaceId ?? input.workspaceId }
            : {}),
          ...(workspaceSummary ? { workspaceSummary } : {}),
        });
        sessionId = appendResult.session.id;
        emitStatus.setSessionId(sessionId);
        userMessageId = appendResult.message.id;
        authoritativeHistory = appendResult.session.messages
          .filter((message) => message.id !== userMessageId)
          .map((message) => ({
            role: message.role,
            content: message.content,
            ...(message.attachments?.length
              ? { attachments: message.attachments }
              : {}),
          }));
        sessionMessageCount = appendResult.session.messages.length;
        sessionCompactionBaseline =
          appendResult.session.context?.compactionCount ?? 0;
        activeGoal = getActiveGoalSummary(appendResult.session);
      } else if (persistedRequestTurn?.user && input.sessionId) {
        sessionId = input.sessionId;
        emitStatus.setSessionId(sessionId);
        userMessageId = persistedRequestTurn.user.id;
        authoritativeHistory = persistedRequestTurn.session.messages
          .filter((message) => message.id !== persistedRequestTurn.user?.id)
          .map((message) => ({
            role: message.role,
            content: message.content,
            ...(message.attachments?.length
              ? { attachments: message.attachments }
              : {}),
          }));
        sessionMessageCount = persistedRequestTurn.session.messages.length;
        sessionCompactionBaseline =
          persistedRequestTurn.session.context?.compactionCount ?? 0;
      } else if (internalOptions.skipUserMessageAppend) {
        userMessageId = internalOptions.userMessageId ?? null;
        const storedSession =
          options.chatSessionStore?.get && input.sessionId
            ? await options.chatSessionStore.get(input.sessionId)
            : null;
        if (storedSession) {
          authoritativeHistory = storedSession.messages
            .filter((message) => message.id !== userMessageId)
            .map((message) => ({
              role: message.role,
              content: message.content,
              ...(message.attachments?.length
                ? { attachments: message.attachments }
                : {}),
            }));
          sessionMessageCount = storedSession.messages.length;
          sessionCompactionBaseline =
            storedSession.context?.compactionCount ?? 0;
        }
      }
      if (processedAttachments.validatedInputs.length) {
        cacheHistoryAttachmentPayloads(
          sessionId,
          processedAttachments.validatedInputs,
          startedAtMs,
        );
      } else {
        pruneHistoryAttachmentPayloads(startedAtMs);
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

      if (options.planService) {
        const inputRoutingPlan =
          preexistingInputRoutingPlan ??
          (await options.planService.getInputRoutingPlan(sessionId));
        if (inputRoutingPlan) {
          if (internalOptions.skipUserMessageAppend) {
            const reply =
              "当前会话已进入只读 Plan Mode，这个更早的 Skill 输入已作废；没有启动 Skill、普通 Agent 或写入工具。请直接在 Plan 输入框补充要求。";
            emitStatus.send({
              state: "paused",
              message: "旧 Skill 输入已作废，当前会话保持只读规划",
              toolCallsExecuted: 0,
            });
            await persistAssistantReply({
              content: reply,
              goalEventRef: `plan-invalidated-skill-input:${inputRoutingPlan.id}:${inputRoutingPlan.revision}`,
            });
            return {
              ok: true,
              reply,
              sessionId,
              relatedMemories: [],
              memoryId: null,
              plan: inputRoutingPlan,
            };
          }
          const amendmentObjective = extractExplicitGoalAmendmentObjective(
            userMessage,
          );
          if (
            amendmentObjective &&
            inputRoutingPlan.purpose === "runtime_replan" &&
            inputRoutingPlan.goalId
          ) {
            if (!options.proposeGoalAmendment) {
              return {
                ok: false,
                message: "当前运行时未启用受控 Goal 修订服务。",
              };
            }
            emitStatus.send({
              state: "reasoning",
              message: "正在创建目标修订提案，当前 Goal 和活动 Plan 保持不变",
              toolCallsExecuted: 0,
            });
            const amendment = await options.proposeGoalAmendment(
              inputRoutingPlan.goalId,
              amendmentObjective,
              userMessage,
            );
            if (!amendment.ok) {
              emitStatus.send({
                state: "failed",
                message: amendment.message,
                toolCallsExecuted: 0,
              });
              return { ok: false, message: amendment.message };
            }
            const reply = `${amendment.message} 当前 Goal 和活动 Plan 尚未改变；请在 Goal 详情中批准或拒绝。`;
            emitStatus.send({
              state: "paused",
              message: "目标修订提案等待明确批准",
              toolCallsExecuted: 0,
            });
            await persistAssistantReply({
              content: reply,
              goalEventRef: `goal-amendment:${amendment.proposal.id}`,
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
            return {
              ok: true,
              reply,
              sessionId,
              relatedMemories: [],
              memoryId: null,
              plan: inputRoutingPlan,
              ...(activeGoal?.id === inputRoutingPlan.goalId
                ? { activeGoal }
                : {}),
            };
          }
          const canRevisePlan =
            inputRoutingPlan.status === "awaiting_input" ||
            inputRoutingPlan.status === "awaiting_confirmation" ||
            (inputRoutingPlan.status === "paused" &&
              Boolean(inputRoutingPlan.finalArtifact));
          if (!canRevisePlan) {
            const reply = formatLockedPlanReply(inputRoutingPlan);
            emitStatus.send({
              state: "paused",
              message: "计划仍处于只读状态，请先处理计划恢复入口",
              toolCallsExecuted: 0,
            });
            await persistAssistantReply({
              content: reply,
              goalEventRef: `plan-locked:${inputRoutingPlan.id}:${inputRoutingPlan.revision}`,
            });
            return {
              ok: true,
              reply,
              sessionId,
              relatedMemories: [],
              memoryId: null,
              plan: inputRoutingPlan,
            };
          }
          emitStatus.send({
            state: "reasoning",
            message: "正在把补充或修改意见纳入只读计划并重新执行规划辩论",
            toolCallsExecuted: 0,
          });
          let continuation;
          try {
            continuation = await options.planService.continueWithInput(
              inputRoutingPlan.id,
              modelUserMessage,
              runtimeOptions.signal,
              input.planAutonomyMode,
            );
          } catch (error) {
            if (isAbortError(error, runtimeOptions.signal)) {
              emitStatus.send({
                state: "canceled",
                message: "规划已中断",
                toolCallsExecuted: 0,
              });
              emitTerminalStreamEvent({
                type: "canceled",
                message: "已中断任务。",
              });
              return { ok: false, code: "CANCELED", retryable: true, message: "已中断任务。" };
            }
            const message =
              error instanceof Error
                ? `继续规划失败：${error.message}`
                : "继续规划失败。";
            emitStatus.send({
              state: "failed",
              message,
              toolCallsExecuted: 0,
            });
            emitTerminalStreamEvent({ type: "failed", message });
            return { ok: false, message };
          }
          if (!continuation.ok) {
            emitStatus.send({
              state: "failed",
              message: continuation.message,
              toolCallsExecuted: 0,
            });
            emitTerminalStreamEvent({
              type: "failed",
              message: continuation.message,
            });
            return { ok: false, message: continuation.message };
          }
          const plan = continuation.plan;
          const reply = formatPlanContinuationReply(plan);
          emitStatus.send({
            state:
              plan.status === "awaiting_confirmation" ? "completed" : "paused",
            message:
              plan.status === "awaiting_confirmation"
                ? "计划已更新，等待确认"
                : "计划仍需补充信息或处理门禁",
            toolCallsExecuted: 0,
          });
          await persistAssistantReply({
            content: reply,
            goalEventRef: `plan-input:${plan.id}:${plan.revision}`,
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
          return {
            ok: true,
            reply,
            sessionId,
            relatedMemories: [],
            memoryId: null,
            plan,
          };
        }
      }

      const pendingContinuation =
        pendingContinuations.get(sessionId) ??
        (await findPersistedChatContinuation({
          sessionId,
          chatSessionStore: options.chatSessionStore,
        }));
      const continuationToResume =
        pendingContinuation &&
        isContinuationRequest(userMessage)
          ? pendingContinuation
          : null;

      if (!continuationToResume && pendingContinuation) {
        pendingContinuations.delete(sessionId);
        await emitStatus.sendRequired({
          state: "checkpoint_boundary",
          message: "新的用户指令已替代上一个暂停检查点。",
          payload: { continuationCleared: true },
        });
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
        input.mode !== "goal_plan" &&
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
            ...(processedAttachments.metadata.length
              ? { attachments: processedAttachments.metadata }
              : {}),
            ...(processedAttachments.validatedInputs.length
              ? { attachmentPayloads: processedAttachments.validatedInputs }
              : {}),
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
          cachePendingSkillInput(inputRequest.id, {
            ...toInMemoryPendingSkillInputState({
              persisted,
              selectedSkill: requestedSkill.skill,
              createdAtMs: startedAtMs,
              ...(processedAttachments.validatedInputs.length
                ? { attachments: processedAttachments.validatedInputs }
                : {}),
              ...(chatRunContext ? { runContext: chatRunContext } : {}),
            }),
          });
          return {
            ok: false,
            code: "SKILL_INPUT_REQUIRED",
            message: "Skill input required.",
          };
        }
        resolvedSkillInput = inputResolution;
      }

      const selectedSkillForGoal =
        requestedSkill?.kind === "matched" ? requestedSkill.skill : undefined;
      const selectedSkillInputValuesForGoal =
        resolvedSkillInput?.status === "complete"
          ? resolvedSkillInput.values
          : undefined;
      const goalRoute = await tryRouteGoalIntent({
        route:
          input.mode === "goal_draft" || input.mode === "goal_plan"
            ? {
                kind: "set_goal",
                description: extractGoalDescription(
                  input.mode === "goal_plan" ? modelUserMessage : userMessage,
                ),
              }
            : hasAttachments
              ? { kind: "none" }
              : detectGoalIntent(userMessage),
        activeGoal,
        chatSessionStore: options.chatSessionStore,
        goalService: options.goalService,
        goalDraftService: options.goalDraftService,
        planService: options.planService,
        proposeGoalAmendment: options.proposeGoalAmendment,
        runtimeReplanGoal: options.runtimeReplanGoal,
        usePlanMode: input.mode === "goal_plan",
        planMode: input.planMode ?? "direct",
        planAutonomyMode: input.planAutonomyMode,
        planModelAssignments: input.planModelAssignments,
        originMessageId: userMessageId,
        sessionId,
        emitStatus,
        now: options.now,
        signal: runtimeOptions.signal,
        workspaceId: chatRunContext?.workspaceId ?? input.workspaceId,
        workspaceRoot: chatRunContext?.workspaceRoot,
        selectedSkill: selectedSkillForGoal,
        selectedSkillInputValues: selectedSkillInputValuesForGoal,
      });

      if (goalRoute) {
        return goalRoute.result;
      }

      if (!continuationToResume && !hasAttachments) {
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
              sessionId,
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
          userMessage: modelUserMessage,
          images: processedAttachments.images,
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
          sessionId,
        });
        chatMessages = buildChatMessages({
          userMessage: modelUserMessage,
          images: processedAttachments.images,
          // Durable main-process state is authoritative. A renderer can be
          // stale during New Chat or session switches, so its history is used
          // only by compatibility callers that have no session store.
          history: options.chatSessionStore
            ? authoritativeHistory ?? []
            : input.history ?? [],
          relatedMemoryResults,
          historyLimit,
          historyAttachmentReplayBudget:
            createHistoryAttachmentReplayBudget(
              processedAttachments.validatedInputs,
              processedAttachments.textContextCharsUsed,
            ),
          resolveHistoryAttachment(metadata) {
            return resolveHistoryAttachmentPayload(
              sessionId,
              metadata,
              startedAtMs,
            );
          },
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
          const actorToolTasks = new Map<string, string>();
          const emittedActorSpawnIds = new Set<string>();
          const evidence = createChatAgentEvidenceRecorder({
            trajectoryStore: options.trajectoryStore,
            runId: continuationToResume?.evidenceRunId,
            ...(agentRunContext ? { runContext: agentRunContext } : {}),
            createId,
            now: options.now,
          });
          const toolDefinitions =
            profile.modelCapabilities?.tools === false
              ? []
              : toolExecutor.getRegistry().getDefinitions();
          const runtimeContextSnapshot = createRuntimeContextSnapshotForRun({
            surface: "chat",
            runId: evidence.runId,
            ...(agentRunContext ? { runContext: agentRunContext } : {}),
            modelProfile: profile,
            tools: toolDefinitions,
            getToolSource: (toolName) =>
              getToolRegistrySource(toolExecutor, toolName),
            ...(selectedSkill ? { selectedSkill } : {}),
            permission: {
              taskId:
                chatRuntimeTask?.taskId ?? `chat:${sessionId}:${requestId}`,
              runtimeTaskId:
                chatRuntimeTask?.taskId ?? `chat:${sessionId}:${requestId}`,
              approvalMode: "manual",
              policyLabel:
                chatRuntimeTask?.runtimeTask.policyLabel ??
                "chat workspace contract",
            },
            memory: {
              scopes: buildRuntimeContextMemoryScopes({
                sessionId,
                runContext: agentRunContext,
                selectedSkill,
              }),
              recallBudgetTokens: memoryLimit,
              rawHistoryEnabled: Boolean(options.historyIndexStore),
            },
            checkpoint: {
              strategy: options.compactionStrategy ? "rebuild" : "summarize",
              preserveToolPairs: true,
              protectSkillLoads: true,
            },
            trajectory: {
              ...(workspaceRunRecorder?.workspaceRunId
                ? { workspaceRunId: workspaceRunRecorder.workspaceRunId }
                : {}),
              sessionId,
              requestId,
            },
            createId: () => `runtime_snapshot_${evidence.runId}`,
            now: () => new Date(startedAtMs).toISOString(),
            systemTimeZone: chatTimeZone,
          });
          const runtimeContextSnapshotSummary =
            summarizeAgentRuntimeContextSnapshot(runtimeContextSnapshot);
          await evidence.append(
            "run_context_created",
            {
              runtimeContextSnapshot,
              runtimeContextSnapshotSummary,
            },
            {
              containsApiKey: false,
              containsFileContent: false,
              containsUserText: false,
            },
          );
          emitStatus.send({
            state: "started",
            message: "Runtime context snapshot recorded.",
            payload: {
              runtimeContextSnapshotSummary,
            },
          });
          if (requestedSkill?.kind === "matched") {
            void evidence.append("skill_invoked", {
              skillName: requestedSkill.skill.manifest.name,
              displayName: requestedSkill.skill.manifest.displayName,
            });
          }
          const executeAgentLoop = options.runAgentLoop ?? runAgentLoop;
          // Session history can contain interrupted tool batches from
          // earlier turns (aborts, mid-batch crashes). Repair pair
          // integrity before replaying it to the provider so a stale
          // session can never produce tool_call pairing HTTP 400s.
          const { messages: loopInputMessages } = sanitizeChatMessages(
            chatMessages,
            { unresolvedToolCalls: "trim" },
          );
          const loopResult = await executeAgentLoop(
            loopInputMessages,
            profile,
            {
              chatClient: options.chatClient,
              toolExecutor,
              toolAuthorizationService: options.toolAuthorizationService,
              ...(chatRuntimeTask ? { taskId: chatRuntimeTask.taskId } : {}),
              runId: evidence.runId,
              ...(agentRunContext ? { runContext: agentRunContext } : {}),
              ...(chatRuntimeTask
                ? { runtimeTask: chatRuntimeTask.runtimeTask }
                : {}),
              systemPrompt: buildChatSystemPrompt(chatDate, chatTimeZone),
              maxTurns: loopMaxTurns,
              signal: runtimeOptions.signal,
              tools: toolDefinitions,
              toolResultOffloadStore: options.toolResultOffloadStore,
              toolResultOffloadThreshold: options.toolResultOffloadThreshold,
              requestId,
              ...(workspaceRunRecorder?.workspaceRunId
                ? { workspaceRunId: workspaceRunRecorder.workspaceRunId }
                : {}),
              ...(options.compactionStrategy
                ? { compactionStrategy: options.compactionStrategy }
                : {}),
              pauseOnTurnLimit: false,
              pauseOnFailureLoop: true,
              ...(options.maxMode && isMaxModeEnabled()
                ? {
                    modelRequestExecutor: async (request: import("./openAiCompatibleClient").ChatCompletionRequest) => {
                      try {
                        const result = await options.maxMode!.runStep(
                          toCompleteRequest(request),
                          {
                            candidates: 3,
                            judgeModel: profile.model,
                            parentRunId: evidence.runId,
                            ...(runtimeOptions.signal
                              ? { signal: runtimeOptions.signal }
                              : {}),
                          },
                        );
                        return toChatCompletionResponse(result.winner, {
                          provider: profile.providerId,
                          model: profile.model,
                        });
                      } catch {
                        return options.chatClient.complete(request);
                      }
                    },
                  }
                : {}),
              ...(continuationToResume
                ? {
                    resumeMessages: loopInputMessages,
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
              onContextUsage(usage) {
                const context = toChatSessionContextSnapshot({
                  usage,
                  sessionMessageCount,
                  historyMessageCount: authoritativeHistory?.length ?? 0,
                  relatedMemoryResults,
                  sessionCompactionBaseline,
                });
                emitStatus.send({
                  state: "context",
                  message: formatContextUsageStatus(context),
                  context,
                  toolCallsExecuted: observedToolCallsExecuted,
                });
              },
              onContextCompacted(event) {
                void evidence.append("context_compacted", event);
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
                if (toolName === "actor") {
                  actorToolTasks.set(
                    event.toolCallId,
                    readToolArgString(args, "task") || "subagent",
                  );
                }
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
                    detail: stringifyMaskedPreview(args),
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
                  emitOutputPart(
                    outputAssembler.appendLedgerEvent({
                      status: "waiting",
                      title: `Waiting for approval: ${record.toolName}`,
                      detail: `Tool ${record.toolName} is waiting for approval.`,
                      toolName: record.toolName,
                    }),
                  );
                }
              },
              onToolRuntimeEvent(toolName, runtimeEvent, event) {
                if (toolName !== "actor") {
                  return;
                }
                if (runtimeEvent.type === "actor_spawned") {
                  actorToolTasks.set(event.toolCallId, runtimeEvent.task);
                  emitActorSpawnedStatusEvent({
                    emitStatus,
                    actorId: runtimeEvent.actorId,
                    task: runtimeEvent.task,
                    toolCallId: event.toolCallId,
                    toolCallsExecuted: observedToolCallsExecuted,
                    emittedActorSpawnIds,
                  });
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
                if (toolName === "actor") {
                  emitActorToolStatusEvents({
                    emitStatus,
                    result,
                    toolCallId: event.toolCallId,
                    task:
                      actorToolTasks.get(event.toolCallId) ?? "subagent",
                    toolCallsExecuted: observedToolCallsExecuted,
                    emittedActorSpawnIds,
                  });
                }
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
          const finalToolCallsExecuted = Math.max(
            loopResult.toolCallsExecuted,
            observedToolCallsExecuted,
          );
          toolCallsUsed = finalToolCallsExecuted;
          accumulatedUsage = reconcileAgentLoopTokenUsage(
            accumulatedUsage,
            loopResult.tokensConsumed,
          );
          await evidence.append("final_summary", {
            status: loopResult.status,
            toolCallsExecuted: finalToolCallsExecuted,
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
              code: "CANCELED",
              retryable: true,
              message: "已中断任务。",
            };
          }

          if (loopResult.status === "paused" && loopResult.continuation) {
            pendingContinuations.set(sessionId, {
              messages: loopResult.messages,
              maxTurns: loopResult.continuation.maxTurns,
              toolCallsExecuted: loopResult.continuation.toolCallsExecuted,
              evidenceRunId: evidence.runId,
              createdAt: Date.now(),
            });
            agentStatus = {
              state: "paused",
              runId: evidence.runId,
              reason: loopResult.continuation.reason,
              maxTurns: loopResult.continuation.maxTurns,
              toolCallsExecuted: finalToolCallsExecuted,
              message: loopResult.summary,
              ...(loopResult.modelServiceNotice
                ? { modelServiceNotice: loopResult.modelServiceNotice }
                : {}),
            };
            if (loopResult.modelServiceNotice) {
              emitOutputPart(
                outputAssembler.appendDiagnostic({
                  severity: "warning",
                  title:
                    loopResult.modelServiceNotice.kind === "output_limit"
                      ? "模型输出未完成"
                      : "模型服务暂不可用",
                  message: loopResult.modelServiceNotice.message,
                }),
              );
            }
            await emitStatus.sendRequired({
              state: "paused",
              message:
                loopResult.modelServiceNotice
                  ? loopResult.modelServiceNotice.kind === "output_limit"
                    ? "模型输出被服务商截断，等待你继续"
                    : "模型服务返回限制，等待你重试"
                  : loopResult.continuation.reason === "tool_failure_loop"
                  ? "连续工具失败，等待确认"
                  : loopResult.continuation.reason === "strategy_guard"
                    ? "策略守护触发，等待确认"
                  : "已到达检查点，等待确认",
              maxTurns: loopResult.continuation.maxTurns,
              toolCallsExecuted: finalToolCallsExecuted,
              payload: {
                chatContinuation: toPersistedChatContinuation(
                  pendingContinuations.get(sessionId)!,
                ),
              },
            });
          } else if (loopResult.status === "failed") {
            pendingContinuations.delete(sessionId);
            agentStatus = {
              state: "failed",
              runId: evidence.runId,
              toolCallsExecuted: finalToolCallsExecuted,
              message: loopResult.summary,
            };
            emitStatus.send({
              state: "failed",
              message: formatAgentLoopFailure(loopResult.summary),
              toolCallsExecuted: finalToolCallsExecuted,
            });
          } else {
            pendingContinuations.delete(sessionId);
            agentStatus = {
              state: "completed",
              runId: evidence.runId,
              toolCallsExecuted: finalToolCallsExecuted,
            };
            emitStatus.send({
              state: "completed",
              message: "任务已完成",
              toolCallsExecuted: finalToolCallsExecuted,
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
              code: "CANCELED",
              retryable: true,
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
        const messages: ChatMessage[] = [
          { role: "system", content: buildChatSystemPrompt(chatDate, chatTimeZone) },
          ...chatMessages,
        ];
        try {
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
          if (response.modelServiceNotice) {
            const notice = response.modelServiceNotice;
            const continuationReason =
              modelNoticeContinuationReason(notice);
            pendingContinuations.set(sessionId, {
              messages: [
                ...messages,
                ...(reply
                  ? [{ role: "assistant" as const, content: reply }]
                  : []),
              ],
              maxTurns: 1,
              toolCallsExecuted: 0,
              evidenceRunId: requestId,
              createdAt: Date.now(),
            });
            agentStatus = {
              state: "paused",
              runId: requestId,
              reason: continuationReason,
              maxTurns: 1,
              toolCallsExecuted: 0,
              message: notice.message,
              modelServiceNotice: notice,
            };
            emitOutputPart(
              outputAssembler.appendDiagnostic({
                severity: "warning",
                title:
                  notice.kind === "output_limit"
                    ? "模型输出未完成"
                    : "模型服务暂不可用",
                message: notice.message,
              }),
            );
            await emitStatus.sendRequired({
              state: "paused",
              message:
                notice.kind === "output_limit"
                  ? "模型输出被服务商截断，等待你继续"
                  : "模型服务返回限制，等待你重试",
              maxTurns: 1,
              toolCallsExecuted: 0,
              payload: {
                chatContinuation: toPersistedChatContinuation(
                  pendingContinuations.get(sessionId)!,
                ),
              },
            });
          } else {
            pendingContinuations.delete(sessionId);
            emitStatus.send({
              state: "completed",
              message: "任务已完成",
              toolCallsExecuted: 0,
            });
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
              code: "CANCELED",
              retryable: true,
              message: "已中断任务。",
            };
          }
          const notice = modelServiceNoticeFromError(error, {
            provider: profile.providerId,
            model: profile.model,
          });
          if (notice) {
            reply = notice.message;
            pendingContinuations.set(sessionId, {
              messages,
              maxTurns: 1,
              toolCallsExecuted: 0,
              evidenceRunId: requestId,
              createdAt: Date.now(),
            });
            agentStatus = {
              state: "paused",
              runId: requestId,
              reason: modelNoticeContinuationReason(notice),
              maxTurns: 1,
              toolCallsExecuted: 0,
              message: notice.message,
              modelServiceNotice: notice,
            };
            emitOutputPart(
              outputAssembler.appendDiagnostic({
                severity: "warning",
                title: "模型服务暂不可用",
                message: notice.message,
              }),
            );
            await emitStatus.sendRequired({
              state: "paused",
              message: "模型服务返回限制，等待你重试",
              maxTurns: 1,
              toolCallsExecuted: 0,
              payload: {
                chatContinuation: toPersistedChatContinuation(
                  pendingContinuations.get(sessionId)!,
                ),
              },
            });
          } else {
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
      }

      if (
        continuationToResume &&
        agentStatus?.state !== "paused"
      ) {
        pendingContinuations.delete(sessionId);
        await emitStatus.sendRequired({
          state: "checkpoint_boundary",
          message: "暂停检查点已成功消费。",
          payload: { continuationCleared: true },
        });
      }

      const assistantMessageId = await persistAssistantReply({
        content: reply,
        relatedMemoryIds: relatedMemoryResults.map((result) => result.record.id),
        ...(agentStatus?.state === "failed"
          ? { terminalType: "failed" as const }
          : {}),
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

  async function sendMessageInternal(
    input: SendChatMessageInput,
    runtimeOptions: SendChatMessageRuntimeOptions = {},
    internalOptions: ChatTurnInternalOptions = {},
  ): Promise<SendChatMessageResult> {
    const sessionKey = input.sessionId?.trim();
    if (!sessionKey) {
      return executeMessageInternal(input, runtimeOptions, internalOptions);
    }

    const previous = sessionRequestTails.get(sessionKey) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => gate);
    sessionRequestTails.set(sessionKey, tail);
    try {
      const ready = await waitForTurnOrAbort(previous, runtimeOptions.signal);
      if (!ready) {
        return { ok: false, code: "CANCELED", retryable: true, message: "已中断任务。" };
      }
      return await executeMessageInternal(input, runtimeOptions, internalOptions);
    } finally {
      release();
      void tail.finally(() => {
        if (sessionRequestTails.get(sessionKey) === tail) {
          sessionRequestTails.delete(sessionKey);
        }
      });
    }
  }

  async function respondSkillInputOnce(
    input: SkillInputResponse,
    runtimeOptions: SendChatMessageRuntimeOptions,
  ): Promise<SkillInputResponseResult> {
    prunePendingAttachmentPayloads(getNowMs(options.now));
    const pending =
      pendingSkillInputRequests.get(input.inputRequestId) ??
      (await recoverPendingSkillInputState(input.inputRequestId));
    if (!pending) {
      return {
        ok: false,
        code: "UNKNOWN_SKILL_INPUT",
        message: "Unknown skill input request.",
      };
    }
    if (
      !pending.attachments?.length &&
      pending.persisted.attachmentPayloads?.length
    ) {
      pending.attachments = structuredClone(
        pending.persisted.attachmentPayloads,
      );
    }
    if (
      pending.persisted.attachments?.length &&
      !pending.attachments?.length
    ) {
      try {
        await markPersistedSkillInputCompleted(pending);
      } catch {
        return {
          ok: false,
          message: "Failed to persist skill input completion.",
        };
      }
      pendingSkillInputRequests.delete(input.inputRequestId);
      return {
        ok: false,
        code: "ATTACHMENT_EXPIRED",
        message: EXPIRED_PENDING_ATTACHMENT_MESSAGE,
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
        ...(pending.persisted.attachments?.length
          ? { attachments: pending.persisted.attachments }
          : {}),
        ...(pending.attachments?.length
          ? { attachmentPayloads: pending.attachments }
          : {}),
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
      cachePendingSkillInput(inputRequest.id, {
        ...toInMemoryPendingSkillInputState({
          persisted,
          selectedSkill: pending.selectedSkill,
          createdAtMs: pending.createdAtMs,
          ...(pending.attachments?.length
            ? { attachments: pending.attachments }
            : {}),
          ...(pending.runContext ? { runContext: pending.runContext } : {}),
        }),
      });
      return {
        ok: false,
        code: "SKILL_INPUT_REQUIRED",
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
        ...(pending.attachments?.length
          ? { attachments: pending.attachments }
          : {}),
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
  const bufferedTextEvents: Array<{
    type: "answer_delta" | "thinking_delta";
    text: string;
  }> = [];
  let textFlushTimer: ReturnType<typeof setTimeout> | undefined;

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
    const createdAt = new Date(nowMs).toISOString();
    return {
      ...event,
      ...createStreamBase(createdAt),
      elapsedMs: Math.max(0, nowMs - options.startedAtMs),
    };
  }

  function publishStatusEvent(
    statusEvent: ChatTaskStatusEvent,
    optionsOverride: { persist: boolean },
  ) {
    flushBufferedTextEvents();
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
        sessionId: statusEvent.sessionId,
        requestId: statusEvent.requestId ?? options.requestId,
        sequence:
          statusEvent.sequence ?? createStreamBase(statusEvent.createdAt).sequence,
        turnId: statusEvent.turnId ?? turnId,
        ...(assistantMessageId ? { assistantMessageId } : {}),
        createdAt: statusEvent.createdAt,
      });
    } catch {
      // Renderer observers are best-effort.
    }
  }

  function flushBufferedTextEvents() {
    if (textFlushTimer) {
      clearTimeout(textFlushTimer);
      textFlushTimer = undefined;
    }
    for (const event of bufferedTextEvents.splice(0)) {
      const nowMs = getNowMs(options.now);
      try {
        options.onStreamEvent?.({
          ...event,
          ...createStreamBase(new Date(nowMs).toISOString()),
        });
      } catch {
        // Renderer observers are best-effort.
      }
    }
  }

  function scheduleTextFlush() {
    if (textFlushTimer) return;
    textFlushTimer = setTimeout(flushBufferedTextEvents, 16);
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
      publishStatusEvent(
        {
          ...statusEvent,
          pendingSkillInput: statusEvent.pendingSkillInput
            ? { ...statusEvent.pendingSkillInput, attachmentPayloads: undefined }
            : undefined,
        },
        { persist: false },
      );
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
    async sendRequired(
      event: Omit<ChatTaskStatusEvent, "sessionId" | "createdAt" | "elapsedMs">,
    ) {
      const statusEvent = createStatusEvent(event);
      if (!options.onRequiredPersistEvent) {
        publishStatusEvent(statusEvent, { persist: true });
        return;
      }
      await options.onRequiredPersistEvent(statusEvent);
      publishStatusEvent(statusEvent, { persist: false });
    },
    setAssistantMessageId(nextAssistantMessageId: string | null | undefined) {
      assistantMessageId = nextAssistantMessageId ?? undefined;
    },
    sendStreamEvent(event: ChatModelStreamEventInput) {
      if (event.type === "answer_delta") {
        const previous = bufferedTextEvents.at(-1);
        if (previous?.type === event.type) previous.text += event.text;
        else bufferedTextEvents.push({ ...event });
        scheduleTextFlush();
        return;
      }
      if (event.type === "thinking_delta") {
        const previous = bufferedTextEvents.at(-1);
        if (previous?.type === event.type) previous.text += event.text;
        else bufferedTextEvents.push({ ...event });
        scheduleTextFlush();
        return;
      }
      flushBufferedTextEvents();
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
      flushBufferedTextEvents();
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
    ...(event.payload ?? {}),
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

function buildRuntimeContextMemoryScopes(options: {
  sessionId: string;
  runContext?: AgentRunContext;
  selectedSkill?: SkillRecord;
}): ExecutionContextMemoryScope[] {
  return [
    { kind: "session", id: options.sessionId },
    ...(options.runContext?.workspaceId
      ? [{ kind: "workspace" as const, id: options.runContext.workspaceId }]
      : []),
    ...(options.selectedSkill?.manifest.name
      ? [{ kind: "skill" as const, id: options.selectedSkill.manifest.name }]
      : []),
  ];
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

export function buildDefaultChatShellTemplates(): string[] {
  const commands = [
    "cat",
    "file",
    "find",
    "git",
    "ls",
    "mkdir",
    "rg",
    "sed",
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
  const normalized = reasoningContent
    .replace(/<\/?think>/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return "已完成本轮分析，正在整理下一步。";
  }
  const sentences = normalized
    .split(/(?<=[。！？.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const summary = sentences.at(-1) ?? normalized;
  return summary.length > 180 ? `${summary.slice(0, 177)}...` : summary;
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

function emitActorToolStatusEvents(options: {
  emitStatus: ReturnType<typeof createChatStatusEmitter>;
  result: Awaited<ReturnType<AgentToolExecutor["execute"]>>;
  toolCallId: string;
  task: string;
  toolCallsExecuted: number;
  emittedActorSpawnIds: Set<string>;
}): void {
  const payload = getActorToolResultPayload(options.result);
  const actorId = readToolArgString(payload, "actorId");
  if (!actorId) {
    return;
  }

  const actorStatus =
    readToolArgString(payload, "status") ||
    readToolArgString(payload, "actorStatus");
  const summary =
    readToolArgString(payload, "summary") ||
    readToolArgString(payload, "error") ||
    "";

  emitActorSpawnedStatusEvent({
    emitStatus: options.emitStatus,
    actorId,
    task: options.task,
    toolCallId: options.toolCallId,
    toolCallsExecuted: options.toolCallsExecuted,
    emittedActorSpawnIds: options.emittedActorSpawnIds,
  });

  if (!actorStatus || actorStatus === "running") {
    return;
  }

  options.emitStatus.send({
    state: "actor_done",
    message: buildActorDoneStatusMessage(actorStatus, summary || actorId),
    toolCallId: options.toolCallId,
    toolName: "actor",
    toolCallsExecuted: options.toolCallsExecuted,
    ok: actorStatus === "done",
    payload: {
      actorId,
      actorStatus,
      summary,
      task: options.task,
    },
  });
}

function emitActorSpawnedStatusEvent(options: {
  emitStatus: ReturnType<typeof createChatStatusEmitter>;
  actorId: string;
  task: string;
  toolCallId: string;
  toolCallsExecuted: number;
  emittedActorSpawnIds: Set<string>;
}): void {
  if (options.emittedActorSpawnIds.has(options.actorId)) {
    return;
  }
  options.emittedActorSpawnIds.add(options.actorId);

  options.emitStatus.send({
    state: "actor_spawned",
    message: `子代理已启动：${options.task}`,
    toolCallId: options.toolCallId,
    toolName: "actor",
    toolCallsExecuted: options.toolCallsExecuted,
    payload: {
      actorId: options.actorId,
      task: options.task,
    },
  });
}

function buildActorDoneStatusMessage(status: string, summary: string): string {
  if (status === "done") {
    return `子代理已完成：${summary}`;
  }
  if (status === "canceled") {
    return `子代理已取消：${summary}`;
  }
  return `子代理失败：${summary}`;
}

function getActorToolResultPayload(
  result: Awaited<ReturnType<AgentToolExecutor["execute"]>>,
): Record<string, unknown> {
  if (result.ok) {
    return result.result;
  }
  return result.errorDetails ?? {};
}

function readToolArgString(
  args: Record<string, unknown>,
  key: string,
): string {
  const value = args[key];
  return typeof value === "string" ? value : "";
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

async function waitForTurnOrAbort(
  previous: Promise<unknown>,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  if (!signal) {
    await previous.catch(() => undefined);
    return true;
  }
  if (signal.aborted) return false;

  let abortHandler: (() => void) | undefined;
  try {
    return await Promise.race([
      previous.catch(() => undefined).then(() => true),
      new Promise<false>((resolve) => {
        abortHandler = () => resolve(false);
        signal.addEventListener("abort", abortHandler, { once: true });
      }),
    ]);
  } finally {
    if (abortHandler) signal.removeEventListener("abort", abortHandler);
  }
}

function isContinuationRequest(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  const compact = normalized.replace(/\s+/g, "");

  return (
    /^(继续|接着|续跑|继续执行|接着执行|继续吧|接着跑)/.test(compact) ||
    /(?:把|将)?(?:接下来|剩下|剩余|后续|未完成|收尾)(?:的)?(?:工作|部分|任务|事项)?.{0,10}(?:继续|推进|完成|做完|收尾)/.test(
      compact,
    ) ||
    /(?:按照|按).{0,12}(?:建议|方案|计划).{0,12}(?:继续|推进|完成|做完|收尾)/.test(
      compact,
    ) ||
    /(?:继续|接着|推进).{0,10}(?:这个|该|当前|原有|原来的)?(?:目标|任务|工作)/.test(
      compact,
    ) ||
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

  const modifyPlanMatch = compact.match(
    /^(?:修改计划|调整目标计划)\s*[:：]?\s*(.*)$/,
  );
  if (modifyPlanMatch) {
    return {
      kind: "modify_plan",
      instructions: modifyPlanMatch[1]?.trim() || compact,
    };
  }

  const amendmentObjective = extractExplicitGoalAmendmentObjective(compact);
  if (amendmentObjective) {
    return { kind: "amend_goal", objective: amendmentObjective };
  }

  if (isContinuationRequest(compact)) {
    return { kind: "continue_goal" };
  }

  return { kind: "none" };
}

function extractExplicitGoalAmendmentObjective(message: string): string | null {
  const match = message
    .trim()
    .match(
      /^(?:目标改一下|修改目标|调整目标)(?:\s*[:：]\s*|\s+)(.+)$/,
    );
  return match?.[1]?.trim() || null;
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
  return getActionableGoalSummary(session) ?? null;
}

function emitGoalRequirementStatusEvents(options: {
  emitStatus?: ReturnType<typeof createChatStatusEmitter>;
  description: string;
}): void {
  if (!options.emitStatus) {
    return;
  }

  const labels = deriveGoalRequirementLabels(options.description);
  labels.forEach((label, index) => {
    options.emitStatus?.send({
      state: "requirement",
      message: `子任务：${label}`,
      toolCallsExecuted: 0,
      payload: {
        requirementId: `goal-requirement-${index + 1}`,
        label,
        status: index === 0 ? "active" : "pending",
      },
    });
  });
}

function deriveGoalRequirementLabels(description: string): string[] {
  const normalized = description
    .replace(/\r\n/g, "\n")
    .replace(/[；;。]/g, "\n")
    .replace(/[，,]\s*(然后|最后|再|并且|同时)/g, "\n")
    .replace(/\n\s*\d+[.、)]\s*/g, "\n")
    .replace(/^\s*\d+[.、)]\s*/, "")
    .trim();
  const labels = normalized
    .split(/\n+/)
    .map((item) =>
      item
        .replace(/^(然后|最后|再|并且|同时)\s*/i, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);
  const uniqueLabels = [...new Set(labels)];
  return uniqueLabels.length ? uniqueLabels.slice(0, 12) : [description.trim()];
}

function formatPlanContinuationReply(plan: PlanRecord): string {
  const title =
    plan.finalArtifact?.title ?? plan.taskContract.objective ?? "未命名计划";
  if (plan.status === "awaiting_confirmation") {
    return `已根据你的补充信息重新生成计划「${title}」，确认前仍不会执行任何任务。`;
  }
  if (plan.status === "awaiting_input") {
    const reason =
      plan.finalArtifact?.gateReason?.trim() ||
      plan.finalArtifact?.unresolvedQuestions[0]?.trim() ||
      "仍有必要信息需要补充。";
    return `已将补充信息纳入规划，但仍需确认：${reason}`;
  }
  const failedRound = [...plan.rounds]
    .reverse()
    .find((round) => round.status === "failed");
  return `已将补充信息纳入规划，但计划尚未通过门禁：${
    failedRound?.error ?? plan.finalArtifact?.gateReason ?? "请检查计划详情。"
  }`;
}

function formatLockedPlanReply(plan: PlanRecord): string {
  const failedRound = [...plan.rounds]
    .reverse()
    .find((round) => round.status === "failed");
  if (failedRound) {
    return `当前计划仍停在 ${failedRound.kind.toUpperCase()} 失败轮次。为避免绕过只读 Plan Mode，本条消息没有启动普通 Agent 或任何写入工具；请使用“重试失败轮次”，或先丢弃计划再开始普通对话。`;
  }
  if (plan.status === "drafting") {
    return "当前计划仍处于生成状态。为避免绕过只读 Plan Mode，本条消息没有启动普通 Agent 或任何写入工具；请等待规划完成，或丢弃后重新开始。";
  }
  return "当前计划尚未退出只读 Plan Mode。本条消息没有启动普通 Agent 或任何写入工具；请先处理计划卡片中的恢复或丢弃操作。";
}

function formatAgentLoopFailure(summary: string): string {
  if (summary.startsWith("Token budget exceeded:")) {
    return "检测到旧版 Token 预算停止记录，任务未完成（只读）";
  }
  if (summary.startsWith("Wall-clock budget exceeded")) {
    return "检测到旧版运行时间预算停止记录，任务未完成（只读）";
  }
  return "Agent 执行失败，任务未完成";
}

function modelNoticeContinuationReason(
  notice: ModelServiceNotice,
): Extract<ChatAgentStatus, { state: "paused" }>["reason"] {
  switch (notice.kind) {
    case "output_limit":
      return "provider_output_limit";
    case "rate_limit":
      return "provider_rate_limit";
    case "quota_exhausted":
      return "provider_quota";
    case "provider_stop":
      return "provider_stop";
  }
}

async function tryRouteGoalIntent(options: {
  route: GoalIntentRoute;
  activeGoal: ChatSessionGoalSummary | null;
  chatSessionStore:
    | Pick<ChatSessionStore, "appendMessage" | "attachGoal" | "clearActiveGoal">
    | undefined;
  goalService: ChatGoalService | undefined;
  goalDraftService: ChatGoalDraftService | undefined;
  planService: ChatPlanService | undefined;
  proposeGoalAmendment: ChatGoalAmendmentService | undefined;
  runtimeReplanGoal: ChatGoalRuntimeReplanService | undefined;
  usePlanMode: boolean;
  planMode: PlanMode;
  planAutonomyMode?: CreatePlanInput["autonomyMode"];
  planModelAssignments?: PlanModelAssignments;
  originMessageId: string | null;
  sessionId: string;
  emitStatus?: ReturnType<typeof createChatStatusEmitter>;
  now?: () => Date;
  signal?: AbortSignal;
  workspaceId?: string;
  workspaceRoot?: string;
  selectedSkill?: SkillRecord;
  selectedSkillInputValues?: Record<string, SkillInputValue>;
}): Promise<{ result: SendChatMessageResult } | null> {
  async function appendGoalReply(input: {
    content: string;
    goalId?: string;
    goalEventRef?: string;
  }) {
    const goalOutputAssembler = createChatOutputAssembler(() =>
      new Date(getNowMs(options.now)).toISOString(),
    );
    const finalTextPart = goalOutputAssembler.setFinalText(input.content);
    const assistantMessageId = await appendAssistantMessage({
      chatSessionStore: options.chatSessionStore,
      sessionId: options.sessionId,
      content: input.content,
      outputParts: goalOutputAssembler.parts(),
      ...(input.goalId ? { goalId: input.goalId } : {}),
      ...(input.goalEventRef ? { goalEventRef: input.goalEventRef } : {}),
    });
    options.emitStatus?.setAssistantMessageId(assistantMessageId);
    if (finalTextPart) {
      options.emitStatus?.sendStreamEvent({
        type: "output_part",
        part: finalTextPart,
      });
    }
    options.emitStatus?.sendTerminalEvent({
      type: "completed",
      message: input.content,
      ...(assistantMessageId ? { finalMessageId: assistantMessageId } : {}),
    });
  }

  if (options.route.kind === "none") {
    return null;
  }

  if (options.route.kind === "set_goal") {
    if (options.usePlanMode && options.planService) {
      options.emitStatus?.send({
        state: "reasoning",
        message:
          options.planMode === "debate"
            ? "正在执行 A1 → B1 → A2 → B2 → C 规划辩论"
            : "正在生成直接计划",
        toolCallsExecuted: 0,
      });
      let plan: PlanRecord;
      try {
        plan = await options.planService.createPlan({
          sessionId: options.sessionId,
          ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
          ...(options.workspaceRoot ? { workspaceRoot: options.workspaceRoot } : {}),
          sourceMessage: options.route.description,
          ...(options.selectedSkill
            ? { selectedSkill: options.selectedSkill }
            : {}),
          mode: options.planMode,
          ...(options.planAutonomyMode
            ? { autonomyMode: options.planAutonomyMode }
            : {}),
          ...(options.planModelAssignments
            ? { modelAssignments: options.planModelAssignments }
            : {}),
          ...(options.signal ? { signal: options.signal } : {}),
        });
      } catch (error) {
        if (isAbortError(error, options.signal)) {
          options.emitStatus?.send({
            state: "canceled",
            message: "规划已中断",
            toolCallsExecuted: 0,
          });
          options.emitStatus?.sendTerminalEvent({
            type: "canceled",
            message: "已中断任务。",
          });
          return {
            result: {
              ok: false,
              message: "已中断任务。",
            },
          };
        }
        const message =
          options.planMode === "debate"
            ? "Debate 规划失败。请检查模型连接后重新尝试；你的目标描述已经保留。"
            : "规划失败。请检查模型连接后重新尝试；你的目标描述已经保留。";
        options.emitStatus?.send({
          state: "failed",
          message,
          toolCallsExecuted: 0,
        });
        options.emitStatus?.sendTerminalEvent({
          type: "failed",
          message,
        });
        return {
          result: {
            ok: false,
            message,
          },
        };
      }
      const outcome = getPlanOutcomePresentation(plan);
      const reply = `${outcome.title}。${outcome.detail} 下一步：${outcome.nextAction}`;
      options.emitStatus?.send({
        state:
          plan.status === "awaiting_confirmation" ? "completed" : "paused",
        message: `${outcome.title} · ${outcome.nextAction}`,
        toolCallsExecuted: 0,
      });
      await appendGoalReply({
        content: reply,
        goalEventRef: `plan_created:${plan.id}`,
      });
      return {
        result: {
          ok: true,
          reply,
          sessionId: options.sessionId,
          relatedMemories: [],
          memoryId: null,
          plan,
          ...(options.selectedSkill
            ? {
                selectedSkill: {
                  name: options.selectedSkill.manifest.name,
                  displayName: options.selectedSkill.manifest.displayName,
                },
              }
            : {}),
        },
      };
    }

    if (options.goalDraftService) {
      const goalDraft = await options.goalDraftService.createFromChat({
        sessionId: options.sessionId,
        ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
        originMessageId: options.originMessageId,
        message: options.route.description,
        ...(options.selectedSkill ? { selectedSkill: options.selectedSkill } : {}),
        ...(options.selectedSkillInputValues
          ? { selectedSkillInputValues: options.selectedSkillInputValues }
          : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      });
      const reply = `已生成目标草案：${goalDraft.normalizedDescription}。请确认或编辑后再开始执行。`;
      options.emitStatus?.send({
        state: "completed",
        message: "目标草案已生成，等待确认",
        toolCallsExecuted: 0,
      });
      await appendGoalReply({
        content: reply,
        goalEventRef: "goal_draft_created",
      });
      return {
        result: {
          ok: true,
          reply,
          sessionId: options.sessionId,
          relatedMemories: [],
          memoryId: null,
          goalDraft,
          ...(options.selectedSkill
            ? {
                selectedSkill: {
                  name: options.selectedSkill.manifest.name,
                  displayName: options.selectedSkill.manifest.displayName,
                },
              }
            : {}),
        },
      };
    }

    if (!options.goalService) {
      return null;
    }

    const createdGoal = await options.goalService.createFromChat({
      sessionId: options.sessionId,
      ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
      originMessageId: options.originMessageId,
      description: options.route.description,
      ...(options.selectedSkill ? { selectedSkill: options.selectedSkill } : {}),
      ...(options.selectedSkillInputValues
        ? { selectedSkillInputValues: options.selectedSkillInputValues }
        : {}),
    });
    const activeGoal = await options.goalService.resume(createdGoal.id, {
      ...(options.signal ? { signal: options.signal } : {}),
    });
    await syncChatGoalSummary(
      options.chatSessionStore,
      options.sessionId,
      activeGoal,
    );
    emitGoalRequirementStatusEvents({
      emitStatus: options.emitStatus,
      description: options.route.description,
    });
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
        ...(options.selectedSkill
          ? {
              selectedSkill: {
                name: options.selectedSkill.manifest.name,
                displayName: options.selectedSkill.manifest.displayName,
              },
            }
          : {}),
      },
    };
  }

  if (!options.goalService) {
    return null;
  }

  if (!options.activeGoal) {
    return null;
  }

  if (options.route.kind === "amend_goal") {
    if (!options.proposeGoalAmendment) {
      return {
        result: {
          ok: false,
          message: "当前运行时未启用受控 Goal 修订服务。",
        },
      };
    }
    const amendment = await options.proposeGoalAmendment(
      options.activeGoal.id,
      options.route.objective,
      `用户请求修改目标：${options.route.objective}`,
    );
    if (!amendment.ok) {
      return { result: { ok: false, message: amendment.message } };
    }
    const amendedGoalSummary = amendment.proposal.pausedExecution
      ? {
          ...options.activeGoal,
          status: "waiting_for_review" as const,
        }
      : options.activeGoal;
    await syncChatGoalSummary(
      options.chatSessionStore,
      options.sessionId,
      amendedGoalSummary,
    );
    const reply = `${amendment.message} GoalContract 和活动 Plan 尚未改变；请在 Goal 详情中批准或拒绝。`;
    options.emitStatus?.send({
      state: "paused",
      message: "目标修订提案等待明确批准",
      toolCallsExecuted: 0,
    });
    await appendGoalReply({
      content: reply,
      goalId: options.activeGoal.id,
      goalEventRef: `goal-amendment:${amendment.proposal.id}`,
    });
    return {
      result: {
        ok: true,
        reply,
        sessionId: options.sessionId,
        relatedMemories: [],
        memoryId: null,
        activeGoal: amendedGoalSummary,
      },
    };
  }

  if (options.route.kind === "continue_goal") {
    if (options.activeGoal.status === "stopped_budget") {
      const reply =
        "这是旧版本地预算机制留下的只读任务，不能继续执行。你仍可查看原结果和执行证据。";
      options.emitStatus?.send({
        state: "paused",
        message: "旧版任务已停止（只读）",
        toolCallsExecuted: 0,
      });
      await appendGoalReply({
        content: reply,
        goalId: options.activeGoal.id,
        goalEventRef: "legacy_goal_read_only",
      });
      return {
        result: {
          ok: true,
          reply,
          sessionId: options.sessionId,
          relatedMemories: [],
          memoryId: null,
          activeGoal: options.activeGoal,
        },
      };
    }
    const recoveringGoal = isRecoverableGoalStatus(options.activeGoal.status);
    const activeGoal = recoveringGoal
      ? await options.goalService.retry(options.activeGoal.id)
      : options.activeGoal.status === "waiting_for_review"
        ? await options.goalService.resolveReview(options.activeGoal.id, {
            kind: "approve_continue",
          })
        : await options.goalService.resume(options.activeGoal.id, {
            ...(options.signal ? { signal: options.signal } : {}),
          });

    await syncChatGoalSummary(
      options.chatSessionStore,
      options.sessionId,
      activeGoal,
    );
    const reply = recoveringGoal
      ? `已恢复原目标并继续执行：${activeGoal.description}。原有 Plan、里程碑和验收记录保持关联。`
      : `继续推进目标：${activeGoal.description}。`;
    options.emitStatus?.send({
      state: "completed",
      message: recoveringGoal
        ? "已恢复原目标执行"
        : "目标执行已更新",
      toolCallsExecuted: 0,
    });
    await appendGoalReply({
      content: reply,
      goalId: activeGoal.id,
      goalEventRef: recoveringGoal ? "goal_retried" : "goal_resumed",
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

  if (!options.runtimeReplanGoal) {
    return {
      result: {
        ok: false,
        message: "当前运行时未启用结构性 Goal 重规划服务。",
      },
    };
  }
  options.emitStatus?.send({
    state: "reasoning",
    message: "正在基于你的调整意见生成运行期 Direct Plan",
    toolCallsExecuted: 0,
  });
  const replanned = await options.runtimeReplanGoal(
    options.activeGoal.id,
    options.route.instructions,
  );
  if (!replanned.ok) {
    return { result: { ok: false, message: replanned.message } };
  }
  const reply = `已生成运行期 Direct Plan：${options.route.instructions}。采用前不会覆盖当前 Goal。`;
  await appendGoalReply({
    content: reply,
    goalId: options.activeGoal.id,
    goalEventRef: `goal-runtime-plan:${replanned.plan.id}`,
  });
  return {
    result: {
      ok: true,
      reply,
      sessionId: options.sessionId,
      relatedMemories: [],
      memoryId: null,
      plan: replanned.plan,
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
  return !isLiveGoalStatus(status);
}

function buildContinuationMessages(options: {
  continuation: ChatContinuationState;
  userMessage: string;
  images?: ChatMessage["images"];
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
      ...(options.images?.length ? { images: options.images } : {}),
    },
  ];
}

async function appendAssistantMessage(options: {
  chatSessionStore: Pick<ChatSessionStore, "appendMessage"> | undefined;
  sessionId: string;
  requestId?: string;
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
      ...(options.requestId ? { requestId: options.requestId } : {}),
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
        reply: `已创建任务“${task.name}”，调度：${describeSchedule(task.schedule)}。保存后会按计划自动运行；你可以在“任务”页暂停或调整权限。`,
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
  sessionId: string;
  taskStore: Pick<ScheduledTaskStore, "list"> | undefined;
  runScheduledTask:
    | ((taskId: string, options?: { sessionId?: string }) => Promise<RunScheduledTaskResult>)
    | undefined;
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

  const runResult = await options.runScheduledTask(matchedTask.id, {
    sessionId: options.sessionId,
  });
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
  attachments?: ChatAttachmentMetadata[];
  attachmentPayloads?: ChatAttachmentInput[];
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
    ...(options.attachments?.length ? { attachments: options.attachments } : {}),
    ...(options.attachmentPayloads?.length
      ? { attachmentPayloads: options.attachmentPayloads }
      : {}),
  };
}

function toInMemoryPendingSkillInputState(options: {
  persisted: SkillPendingInputState;
  selectedSkill: SkillRecord;
  runContext?: AgentRunContext;
  attachments?: SendChatMessageInput["attachments"];
  createdAtMs: number;
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
    createdAtMs: options.createdAtMs,
    ...(options.attachments?.length
      ? { attachments: options.attachments }
      : {}),
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

function toPersistedChatContinuation(
  continuation: ChatContinuationState,
): PersistedChatContinuation {
  return {
    version: 1,
    messages: structuredClone(continuation.messages),
    maxTurns: continuation.maxTurns,
    toolCallsExecuted: continuation.toolCallsExecuted,
    ...(continuation.evidenceRunId
      ? { evidenceRunId: continuation.evidenceRunId }
      : {}),
    createdAt: continuation.createdAt,
  };
}

async function findPersistedChatContinuation(options: {
  sessionId: string;
  chatSessionStore:
    | Partial<Pick<ChatSessionStore, "get">>
    | undefined;
}): Promise<ChatContinuationState | null> {
  if (!options.chatSessionStore?.get) {
    return null;
  }
  const record = await options.chatSessionStore.get(options.sessionId);
  const events = record?.activity?.statusEvents ?? [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    const continuation = parsePersistedChatContinuation(
      event.payload?.chatContinuation,
    );
    if (continuation) {
      return continuation;
    }
    if (
      event.payload?.continuationCleared === true ||
      event.state === "started" ||
      event.state === "completed" ||
      event.state === "failed" ||
      event.state === "canceled"
    ) {
      return null;
    }
  }
  return null;
}

async function findPersistedRequestTurn(
  chatSessionStore: Partial<Pick<ChatSessionStore, "get">>,
  sessionId: string,
  requestId: string,
): Promise<{
  session: ChatSessionRecord;
  user: ChatSessionRecord["messages"][number] | null;
  assistant: ChatSessionRecord["messages"][number] | null;
} | null> {
  if (!chatSessionStore.get) {
    return null;
  }
  const session = await chatSessionStore.get(sessionId);
  if (!session) {
    return null;
  }
  const requestMessages = session.messages.filter(
    (message) => message.requestId === requestId,
  );
  const user = requestMessages.find((message) => message.role === "user") ?? null;
  const assistant =
    [...requestMessages].reverse().find((message) => message.role === "assistant") ?? null;
  return user || assistant ? { session, user, assistant } : null;
}

function parsePersistedChatContinuation(value: unknown): ChatContinuationState | null {
  if (!isObjectRecord(value) || value.version !== 1) {
    return null;
  }
  if (
    !Array.isArray(value.messages) ||
    !value.messages.every(isPersistedChatMessage) ||
    !isPositiveInteger(value.maxTurns) ||
    !isNonNegativeInteger(value.toolCallsExecuted) ||
    typeof value.createdAt !== "number" ||
    !Number.isFinite(value.createdAt)
  ) {
    return null;
  }
  return {
    messages: structuredClone(value.messages),
    maxTurns: value.maxTurns,
    toolCallsExecuted: value.toolCallsExecuted,
    ...(typeof value.evidenceRunId === "string" && value.evidenceRunId
      ? { evidenceRunId: value.evidenceRunId }
      : {}),
    createdAt: value.createdAt,
  };
}

function isPersistedChatMessage(value: unknown): value is ChatMessage {
  if (!isObjectRecord(value)) {
    return false;
  }
  return (
    (value.role === "system" ||
      value.role === "user" ||
      value.role === "assistant" ||
      value.role === "tool") &&
    typeof value.content === "string"
  );
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
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
  // v3.6.0: Inject skill instruction as user role (not system) wrapped in
  // XML fences, matching the memory context pattern (SEC-14). User-installed
  // skills can contain arbitrary markdown/instructions and must be treated
  // as untrusted data.
  return [
    {
      role: "user",
      content: `<skill_context>\n${buildSelectedSkillInstruction(skill, inputResolution)}\n</skill_context>`,
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
  images?: ChatMessage["images"];
  history: SendChatMessageInput["history"];
  relatedMemoryResults: MemorySearchResult[];
  historyLimit: number;
  historyAttachmentReplayBudget?: HistoryAttachmentReplayBudget;
  resolveHistoryAttachment?: (
    metadata: ChatAttachmentMetadata,
  ) => ChatAttachmentInput | undefined;
}): ChatMessage[] {
  const messages: ChatMessage[] = [];
  const memoryContext = formatMemoryContext(options.relatedMemoryResults);

  if (memoryContext) {
    // v3.6.0: Inject memory as user role (not system) wrapped in unambiguous
    // XML fences to structurally separate external data from system instructions
    // (SEC-13). The system prompt instructs the model that fenced content is
    // untrusted data. Sanitize the content to prevent fence-breaking via
    // injection of a closing tag inside stored memory text.
    const safeMemoryContext = memoryContext.replace(/<\/memory_context>/gi, "<\\/memory_context>");
    messages.push({ role: "user", content: `<memory_context>\n${safeMemoryContext}\n</memory_context>` });
  }

  const history = (options.history ?? []).slice(-options.historyLimit);
  const replayBudget =
    options.historyAttachmentReplayBudget ??
    createHistoryAttachmentReplayBudget([]);
  const preparedAttachments = history.map(() =>
    emptyProcessedHistoryAttachments(),
  );
  // Allocate the shared request budget newest-first so a follow-up question
  // retains the most recent attachment context when older turns are evicted.
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (message?.role === "user") {
      preparedAttachments[index] = processCachedHistoryAttachments(
        message.attachments,
        options.resolveHistoryAttachment,
        replayBudget,
      );
    }
  }

  for (let index = 0; index < history.length; index += 1) {
    const message = history[index];
    if (!message) {
      continue;
    }
    const historicalAttachments =
      preparedAttachments[index] ?? emptyProcessedHistoryAttachments();
    const content = appendUnavailableHistoryAttachmentContext(
      appendChatAttachmentContext(
        message.content,
        historicalAttachments.textContext,
      ),
      historicalAttachments.unavailableCount,
    );
    messages.push({
      role: message.role,
      content,
      ...(historicalAttachments.images.length
        ? { images: historicalAttachments.images }
        : {}),
    });
  }

  messages.push({
    role: "user",
    content: options.userMessage,
    ...(options.images?.length ? { images: options.images } : {}),
  });
  return messages;
}

function processCachedHistoryAttachments(
  metadata: ChatAttachmentMetadata[] | undefined,
  resolveAttachment:
    | ((metadata: ChatAttachmentMetadata) => ChatAttachmentInput | undefined)
    | undefined,
  replayBudget: HistoryAttachmentReplayBudget,
): ProcessedHistoryAttachments {
  if (!Array.isArray(metadata) || metadata.length === 0) {
    return emptyProcessedHistoryAttachments();
  }
  const candidates = metadata.slice(0, CHAT_ATTACHMENT_MAX_COUNT) as unknown[];
  const resolved: ChatAttachmentInput[] = [];
  let unavailableCount = Math.max(0, metadata.length - candidates.length);
  for (const candidate of candidates) {
    if (!isChatAttachmentMetadata(candidate)) {
      unavailableCount += 1;
      continue;
    }
    if (replayBudget.seenIds.has(candidate.id)) {
      unavailableCount += 1;
      continue;
    }
    const payload = resolveAttachment?.(candidate);
    if (!payload) {
      unavailableCount += 1;
      continue;
    }
    replayBudget.seenIds.add(candidate.id);
    if (
      replayBudget.remainingCount <= 0 ||
      payload.size > replayBudget.remainingBytes
    ) {
      unavailableCount += 1;
      continue;
    }
    replayBudget.remainingCount -= 1;
    replayBudget.remainingBytes -= payload.size;
    resolved.push(payload);
  }
  try {
    const processed = processChatAttachments(resolved, {
      maxTextContextChars: replayBudget.remainingTextContextChars,
    });
    replayBudget.remainingTextContextChars = Math.max(
      0,
      replayBudget.remainingTextContextChars -
        processed.textContextCharsUsed,
    );
    return {
      images: processed.images,
      textContext: processed.textContext,
      unavailableCount,
    };
  } catch {
    return {
      images: [],
      textContext: "",
      unavailableCount: metadata.length,
    };
  }
}

type ProcessedHistoryAttachments = {
  images: NonNullable<ChatMessage["images"]>;
  textContext: string;
  unavailableCount: number;
};

function emptyProcessedHistoryAttachments(): ProcessedHistoryAttachments {
  return { images: [], textContext: "", unavailableCount: 0 };
}

function createHistoryAttachmentReplayBudget(
  currentAttachments: ChatAttachmentInput[],
  currentTextContextCharsUsed = 0,
): HistoryAttachmentReplayBudget {
  return {
    remainingBytes: Math.max(
      0,
      CHAT_ATTACHMENT_MAX_TOTAL_BYTES -
        currentAttachments.reduce(
          (sum, attachment) => sum + attachment.size,
          0,
        ),
    ),
    remainingCount: Math.max(
      0,
      CHAT_ATTACHMENT_MAX_COUNT - currentAttachments.length,
    ),
    remainingTextContextChars: Math.max(
      0,
      CHAT_ATTACHMENT_MAX_TEXT_CONTEXT_CHARS -
        currentTextContextCharsUsed,
    ),
    seenIds: new Set(currentAttachments.map((attachment) => attachment.id)),
  };
}

function isChatAttachmentMetadata(
  value: unknown,
): value is ChatAttachmentMetadata {
  if (!value || typeof value !== "object") {
    return false;
  }
  const metadata = value as Partial<ChatAttachmentMetadata>;
  return (
    typeof metadata.id === "string" &&
    typeof metadata.name === "string" &&
    typeof metadata.mediaType === "string" &&
    typeof metadata.size === "number" &&
    Number.isFinite(metadata.size) &&
    metadata.size > 0 &&
    (metadata.kind === "image" || metadata.kind === "text")
  );
}

function appendUnavailableHistoryAttachmentContext(
  content: string,
  unavailableCount: number,
): string {
  if (unavailableCount <= 0) {
    return content;
  }
  return `${content}\n\n<attachment_context>\n[本消息的 ${unavailableCount} 个历史附件内容已失效、不可用，或为控制本次请求大小已省略。不要猜测其内容；如当前问题依赖这些附件，请要求用户重新粘贴。]\n</attachment_context>`;
}

function matchesAttachmentMetadata(
  input: ChatAttachmentInput,
  metadata: ChatAttachmentMetadata,
): boolean {
  return (
    input.id === metadata.id &&
    input.name === metadata.name &&
    input.mediaType === metadata.mediaType &&
    input.size === metadata.size &&
    input.kind === metadata.kind
  );
}

function toHistoryAttachmentCacheKey(
  sessionId: string,
  attachmentId: string,
): string {
  return `${sessionId.length}:${sessionId}${attachmentId}`;
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
  sessionId: string;
}): Promise<MemorySearchResult[]> {
  const results = await recallMemoriesWithBudget({
    memoryStore: options.memoryStore,
    query: options.query,
    kind: "all",
    sessionId: options.sessionId,
    limit: options.limit,
  });
  return results
    .filter((result) =>
      isMemoryVisibleToChatSession(result.record, options.sessionId),
    )
    .slice(0, options.limit);
}

export function isMemoryVisibleToChatSession(
  memory: MemoryRecord,
  sessionId: string,
): boolean {
  if (memory.kind !== "session") {
    return true;
  }
  return (
    memory.source.type === "chat_session" &&
    memory.source.sessionId === sessionId
  );
}

function toChatSessionContextSnapshot(options: {
  usage: AgentContextUsage;
  sessionMessageCount: number;
  historyMessageCount: number;
  relatedMemoryResults: MemorySearchResult[];
  sessionCompactionBaseline: number;
}): ChatSessionContextSnapshot {
  const recalledSessionMemories = options.relatedMemoryResults.filter(
    (result) => result.record.kind === "session",
  ).length;
  return {
    ...options.usage,
    compactionCount:
      options.sessionCompactionBaseline + options.usage.compactionCount,
    isolation: "session_plus_global_memory",
    sessionMessageCount: Math.max(0, options.sessionMessageCount),
    historyMessageCount: Math.max(0, options.historyMessageCount),
    recalledSessionMemories,
    recalledGlobalMemories:
      options.relatedMemoryResults.length - recalledSessionMemories,
  };
}

function formatContextUsageStatus(context: ChatSessionContextSnapshot): string {
  const percent = Math.round(context.occupancyRatio * 100);
  return context.lastCompaction
    ? `上下文 ${percent}% · 已压缩 ${context.compactionCount} 次`
    : `上下文 ${percent}% · 当前会话已隔离`;
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

function reconcileAgentLoopTokenUsage(
  current: ChatSessionTokenUsage | null,
  tokensConsumed: number | undefined,
): ChatSessionTokenUsage | null {
  const normalized = normalizeTokenCount(tokensConsumed);
  if (normalized === undefined || normalized <= (current?.totalTokens ?? 0)) {
    return current;
  }
  return {
    ...(current ?? {}),
    totalTokens: normalized,
    estimated: current?.estimated ?? true,
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

  // v3.6.0: Mask secrets in raw history content before persisting (SEC-17).
  let safeContent: string;
  try {
    const parsed = JSON.parse(options.content);
    const masked = maskPreviewSecrets(parsed);
    safeContent = truncateHistoryContent(typeof masked === "string" ? masked : JSON.stringify(masked));
  } catch {
    safeContent = truncateHistoryContent(options.content);
  }
  void options.historyIndexStore
    .append({
      id: options.createId(),
      sessionId: options.sessionId,
      runId: options.requestId,
      ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
      role: options.role,
      ...(options.toolName ? { toolName: options.toolName } : {}),
      content: safeContent,
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

function getToolRegistrySource(
  toolExecutor: AgentToolExecutor,
  toolName: string,
): string | null {
  const registry = toolExecutor.getRegistry() as {
    getSource?: (toolName: string) => string | null;
  };
  if (typeof registry.getSource !== "function") {
    return null;
  }

  return registry.getSource(toolName);
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
