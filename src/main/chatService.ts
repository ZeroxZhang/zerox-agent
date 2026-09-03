import { waitForTurnOrAbort } from "./chatService/moduleruntime";
import { toRelatedMemory } from "./chatService/modulemessages";
import { estimateChatTurnUsage } from "./chatService/modulemessages";
import { recordSessionTokenUsage } from "./chatService/modulemessages";
import { modelNoticeContinuationReason } from "./chatService/moduleruntime";
import { formatAgentLoopFailure } from "./chatService/moduleruntime";
import { toPersistedChatContinuation } from "./chatService/modulemessages";
import { reconcileAgentLoopTokenUsage } from "./chatService/modulemessages";
import { normalizeReasoningForStatus } from "./chatService/moduleruntime";
import { emitActorToolStatusEvents } from "./chatService/moduleruntime";
import { buildToolResultStatusMessage } from "./chatService/moduleruntime";
import { emitActorSpawnedStatusEvent } from "./chatService/moduleruntime";
import { inferApprovalRiskLevel } from "./chatService/modulesettlement";
import { buildNativeToolEvidencePayload } from "./chatService/modulemessages";
import { getNativeToolDescriptor } from "./chatService/modulemessages";
import { truncateHistoryContent } from "./chatService/modulemessages";
import { readToolArgString } from "./chatService/moduleruntime";
import { formatContextUsageStatus } from "./chatService/modulemessages";
import { toChatSessionContextSnapshot } from "./chatService/modulemessages";
import { toChatSessionTokenUsage } from "./chatService/modulemessages";
import { mergeChatSessionTokenUsage } from "./chatService/modulemessages";
import { buildChatSystemPrompt } from "./chatService/modulemessages";
import { buildRuntimeContextMemoryScopes } from "./chatService/moduleruntime";
import { getToolRegistrySource } from "./chatService/modulemessages";
import { createChatRuntimeTask } from "./chatService/moduleruntime";
import { extendRunContextForSelectedSkill } from "./chatService/moduleruntime";
import { injectSkillInvocationMessage } from "./chatService/modulemessages";
import { createHistoryAttachmentReplayBudget } from "./chatService/modulemessages";
import { buildChatMessages } from "./chatService/modulemessages";
import { searchRelatedMemories } from "./chatService/modulemessages";
import { buildContinuationMessages } from "./chatService/moduleruntime";
import { tryRunTaskFromIntent } from "./chatService/modulemessages";
import { writeAtomicMemories } from "./chatService/modulemessages";
import { compactMessageIds } from "./chatService/modulemessages";
import { writeSessionMemory } from "./chatService/modulemessages";
import { tryCreateTaskFromIntent } from "./chatService/modulemessages";
import { detectGoalIntent } from "./chatService/moduleruntime";
import { extractGoalDescription } from "./chatService/moduleruntime";
import { tryRouteGoalIntent } from "./chatService/moduleruntime";
import { createPendingSkillInputState } from "./chatService/modulemessages";
import { createSkillUserInputRequest } from "./chatService/modulemessages";
import { isContinuationRequest } from "./chatService/moduleruntime";
import { findPersistedChatContinuation } from "./chatService/modulemessages";
import { formatPlanContinuationReply } from "./chatService/moduleruntime";
import { isAbortError } from "./chatService/moduleruntime";
import { formatLockedPlanReply } from "./chatService/moduleruntime";
import { extractExplicitGoalAmendmentObjective } from "./chatService/moduleruntime";
import { appendRawHistoryEntry } from "./chatService/modulemessages";
import { getActiveGoalSummary } from "./chatService/moduleruntime";
import { buildChatWorkspaceSummary } from "./chatService/moduleruntime";
import { appendAssistantMessage } from "./chatService/modulemessages";
import { createChatWorkspaceRunId } from "./chatService/moduleruntime";
import { commitPreparedAssistantAcceptance } from "./chatService/modulesettlement";
import { settlePreparedWorkspaceAssistantAcceptance } from "./chatService/modulesettlement";
import { findPersistedRequestTurn } from "./chatService/modulemessages";
import { persistRequiredConversationSettlement } from "./chatService/modulesettlement";
import { createChatWorkspaceRunRecorder } from "./chatService/modulesettlement";
import { toInMemoryPendingSkillInputState } from "./chatService/modulemessages";
import { resolveChatWorkspace } from "./chatService/moduleruntime";
import { resolveRequestedSkill } from "./chatService/modulemessages";
import { findPersistedPendingSkillInputState } from "./chatService/modulemessages";
import { persistRequiredChatActivityEvent } from "./chatService/modulemessages";
import { matchesAttachmentMetadata } from "./chatService/modulemessages";
import { toHistoryAttachmentCacheKey } from "./chatService/modulemessages";
import { ChatWorkspaceRunRecorder } from "./chatService/modulesettlement";
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
import {
  redactChatMessagesCredentials,
  sanitizeChatMessages,
} from "./messageIntegrity";
import { isMaxModeEnabled, type MaxMode } from "./providers/maxMode";
import {
  toChatCompletionResponse,
  toCompleteRequest,
} from "./providers/normalize";
import { estimateMessageTokens } from "./contextManager";
import type { CompactionStrategy } from "./kernel/compactionStrategy";
import type { ProductionKernelDriver } from "./kernel/productionKernelDriver";
import {
  runChatKernelSegment,
  type ChatKernelSettlement,
} from "./kernel/chatKernelSegment";
import {
  type AppendChatMessageResult,
  type ChatSessionStore,
} from "./chatSessionStore";
import { extractAtomicMemoriesFromChatTurn } from "./memoryL1Extractor";
import type { MemoryProfileStore } from "./memoryProfileStore";
import type { MemoryStore } from "./memoryStore";
import type { HistoryIndexStore } from "./historyIndexStore";
import type { RawHistoryRole } from "../shared/rawHistory";
import type { ToolResultOffloadStore } from "./toolResultOffloadStore";
import {
  WorkspaceRunEnvelopeConflictError,
  type WorkspaceRunStore,
} from "./workspaceRunStore";
import type { ConversationCausalStore } from "./conversationCausalStore";
import {
  createConversationRequestFingerprint,
  createLegacyConversationRequestFingerprint,
  CONVERSATION_REQUEST_FINGERPRINT_VERSION,
  LEGACY_CONVERSATION_REQUEST_FINGERPRINT_VERSION,
  resolveDurableConversationBinding,
  resolveConversationRequestFingerprintVersion,
  createConversationCausalAttemptId,
  createConversationTurnId,
  type ConversationAssistantAcceptance,
} from "../shared/conversationCausalSpine";
import {
  formatMemoryRecallContext,
  recallMemoriesWithBudget,
} from "./memoryRecall";
import type {
  ChatClient,
  ChatCompletionResponse,
  ChatMessage,
} from "./openAiCompatibleClient";
import type { ScheduledTaskStore } from "./taskStore";
import type {
  RuntimeToolAuthorizationTask,
  ToolAuthorizationService,
} from "./toolAuthorizationService";
import {
  type ChatAgentStatus,
  type ChatAttachmentInput,
  type ChatAttachmentMetadata,
  type ChatHistoryMessage,
  type ChatMessageRecord,
  type ChatRelatedMemory,
  type ChatSessionContextSnapshot,
  type ChatSessionListItem,
  type ChatSessionRecord,
  type ChatSessionGoalSummary,
  type ChatSessionTokenUsage,
  type ChatStreamEvent,
  type ChatTaskStatusEvent,
  type ChatTurnSettlementStatus,
  type ChatWorkspaceSummary,
  type SendChatMessageInput,
  type SendChatMessageResult,
  type SkillPendingInputState,
  type SkillInputResponse,
  type SkillInputResponseResult,
  type SkillUserInputRequest,
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
import type {
  AgentRunAdmissionGate,
  AgentRunRecord,
  RunScheduledTaskResult,
} from "../shared/agentRuns";
import type { ExecutionContextMemoryScope } from "../shared/executionContextPackage";
import type { MemoryRecord, MemorySearchResult } from "../shared/memory";
import type { AgentContextUsage } from "../shared/contextUsage";
import type { NativeToolDescriptor } from "../shared/nativeCapabilities";
import {
  createPublicSkillSnapshotSha256,
  type SkillDiscoveryResult,
  type SkillRecord,
} from "../shared/skills";
import type {
  WorkspaceRunEventInput,
  WorkspaceRunEvent,
  WorkspaceRunStatus,
} from "../shared/workspaceRunLedger";
import {
  buildScheduledTaskInputFromIntent,
  classifyAgentIntent,
  matchTaskFromMessage,
  type AgentIntentRoute,
} from "../shared/agentIntent";
import { formatDateInTimeZone, getSystemTimeZone } from "../shared/dateContext";
import {
  stringifyMaskedPreview,
  type ChatOutputPart,
} from "../shared/chatOutput";
import {
  redactCredentialString,
  stringifyRedactedCredentials,
} from "../shared/credentialRedaction";
import {
  summarizeAgentRuntimeContextSnapshot,
} from "../shared/agentRuntimeContext";
import {
  modelServiceNoticeFromError,
  sanitizeModelServiceNotice,
  type ModelServiceNotice,
} from "../shared/modelServiceNotice";
import { throwIfResponseBodyLimitError } from "./fetchWithTimeout";
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
  type ProcessedChatAttachments,
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
import {
  SecretSafeFailureError,
  toSecretSafeFailure,
} from "../shared/secretSafeFailure";
import {
  createChatStatusEmitter,
  emitModelStreamEvent,
  getNowMs,
  normalizeAgentLoopMaxTurns,
} from "./chatService/streamingStatus";
import {
  createChatKernelRunId,
  createRequiredChatEventFingerprint,
  createRequiredSettlementId,
  toChatKernelStatus,
  toRequiredSettlementTarget,
} from "./chatService/kernelSettlement";
export { createRequiredChatEventFingerprint } from "./chatService/kernelSettlement";
export {
  createWorkspaceStatusEventId,
  toWorkspaceRunEventInput,
  toWorkspaceRunStatus,
} from "./chatService/modulesettlement";
export { buildDefaultChatShellTemplates } from "./chatService/moduleruntime";
export { isMemoryVisibleToChatSession } from "./chatService/modulemessages";

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

/**
 * Fingerprint the normalized execution input before acquiring the global
 * request claim. Raw attachment payloads are reduced to content fingerprints
 * so the causal store can distinguish different bytes without retaining them.
 */
export function createChatRequestClaimFingerprint(options: {
  input: SendChatMessageInput;
  userMessage: string;
  validatedAttachments: ChatAttachmentInput[];
}): string {
  return createConversationRequestFingerprint(createChatRequestClaimPayload(
    options,
    createConversationRequestFingerprint,
  ));
}

export function createLegacyChatRequestClaimFingerprint(options: {
  input: SendChatMessageInput;
  userMessage: string;
  validatedAttachments: ChatAttachmentInput[];
}): string {
  return createLegacyConversationRequestFingerprint(createChatRequestClaimPayload(
    options,
    createLegacyConversationRequestFingerprint,
  ));
}

export function createChatRequestClaimPayload(
  options: {
    input: SendChatMessageInput;
    userMessage: string;
    validatedAttachments: ChatAttachmentInput[];
  },
  fingerprintAttachmentContent: (value: unknown) => string,
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    message: options.userMessage,
    mode: options.input.mode ?? "chat",
    planMode: options.input.planMode ?? "direct",
    planAutonomyMode: options.input.planAutonomyMode ?? "standard",
    planModelAssignments: options.input.planModelAssignments ?? {},
    selectedSkillName: options.input.selectedSkillName ?? null,
    workspaceId: options.input.workspaceId ?? null,
    workspaceSummary: options.input.workspaceSummary ?? null,
    history: options.input.history ?? [],
    attachments: options.validatedAttachments.map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      mediaType: attachment.mediaType,
      size: attachment.size,
      kind: attachment.kind,
      contentFingerprint: fingerprintAttachmentContent({
        dataBase64: attachment.dataBase64,
      }),
    })),
  };
}

export type ChatContinuationState = {
  messages: ChatMessage[];
  maxTurns: number;
  toolCallsExecuted: number;
  evidenceRunId?: string;
  /** v3.6.0: Creation timestamp for TTL-based eviction (CONC-08). */
  createdAt: number;
};

export type PersistedChatContinuation = ChatContinuationState & {
  version: 1;
};

export type PendingSkillInputState = {
  persisted: SkillPendingInputState;
  inputRequest?: SkillUserInputRequest;
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
  streamSequence: number;
};

export type CachedHistoryAttachmentPayload = {
  input: ChatAttachmentInput;
  lastAccessedAtMs: number;
};

// Electron enforces one main-process instance. Keep the per-session turn
// authority at process scope so independently constructed service adapters
// cannot concurrently consume the same persisted continuation.
export const processChatSessionRequestTails = new Map<string, Promise<void>>();

export type HistoryAttachmentReplayBudget = {
  remainingBytes: number;
  remainingCount: number;
  remainingTextContextChars: number;
  seenIds: Set<string>;
};

export const PENDING_ATTACHMENT_PAYLOAD_TTL_MS = 60 * 60 * 1000;
export const PENDING_ATTACHMENT_PAYLOAD_MAX_BYTES = 40 * 1024 * 1024;
export const HISTORY_ATTACHMENT_PAYLOAD_TTL_MS = 60 * 60 * 1000;
export const HISTORY_ATTACHMENT_PAYLOAD_MAX_BYTES = 40 * 1024 * 1024;
export const EXPIRED_PENDING_ATTACHMENT_MESSAGE =
  "附件内容在应用重启或长时间等待后已失效，请重新发送消息并粘贴附件。";

export type PreparedChatMessageInput = {
  processedAttachments: ProcessedChatAttachments;
  userMessage: string;
  modelUserMessage: string;
  hasAttachments: boolean;
  preexistingInputRoutingPlan: PlanRecord | null;
};

export type ChatRequestClaim = Awaited<
  ReturnType<ConversationCausalStore["claimRequest"]>
>;

export type ChatTurnInternalOptions = {
  skipUserMessageAppend?: boolean;
  userMessageId?: string | null;
  forcedSkill?: SkillRecord;
  resolvedSkillInput?: SkillInputResolution;
  preResolvedRunContext?: AgentRunContext;
  preResolvedWorkspaceSummary?: ChatWorkspaceSummary;
  initialStreamSequence?: number;
  preparedInput?: PreparedChatMessageInput;
  requestClaim?: ChatRequestClaim | null;
  publicationAuthority?: ChatPublicationAuthority;
  onDurableSessionResolved?: (sessionId: string) => void;
  onDomainStateUnavailable?: () => void;
  onWorkspaceRunRecorderResolved?: (
    recorder: ChatWorkspaceRunRecorder | null,
  ) => void;
};

export type ChatPublicationAuthority = {
  markDurable(sessionId: string, userMessageId: string): boolean;
  invalidate(reasonCode: string): void;
  durableSessionId(): string | undefined;
  domainStateAvailable(): boolean;
};

export function createChatPublicationAuthority(): ChatPublicationAuthority {
  let state:
    | { kind: "route_only" }
    | { kind: "durable"; sessionId: string; userMessageId: string }
    | { kind: "invalidated"; reasonCode: string } = { kind: "route_only" };
  return {
    markDurable(sessionId, userMessageId) {
      if (state.kind === "invalidated") return false;
      const normalizedSessionId = sessionId.trim();
      const normalizedUserMessageId = userMessageId.trim();
      if (!normalizedSessionId || !normalizedUserMessageId) return false;
      if (
        state.kind === "durable"
        && (
          state.sessionId !== normalizedSessionId
          || state.userMessageId !== normalizedUserMessageId
        )
      ) {
        state = { kind: "invalidated", reasonCode: "durable_binding_conflict" };
        return false;
      }
      state = {
        kind: "durable",
        sessionId: normalizedSessionId,
        userMessageId: normalizedUserMessageId,
      };
      return true;
    },
    invalidate(reasonCode) {
      if (state.kind !== "invalidated") {
        state = { kind: "invalidated", reasonCode };
      }
    },
    durableSessionId() {
      return state.kind === "durable" ? state.sessionId : undefined;
    },
    domainStateAvailable() {
      return state.kind === "durable";
    },
  };
}

export class RequiredConversationSettlementError extends SecretSafeFailureError {
  readonly code = "CONVERSATION_SETTLEMENT_FAILED" as const;
  constructor(
    readonly failureStatusPersisted: boolean,
    cause?: unknown,
    readonly failureCode:
      | "CHAT_SETTLEMENT_FAILED"
      | "WORKSPACE_SETTLEMENT_FAILED"
      | "CROSS_DOMAIN_SETTLEMENT_FAILED" = "CROSS_DOMAIN_SETTLEMENT_FAILED",
  ) {
    super(failureCode, cause);
    this.name = "RequiredConversationSettlementError";
  }
}

export class AssistantAcceptanceRecoveryRequiredError extends Error {
  constructor(
    readonly result: SendChatMessageResult,
  ) {
    super("Assistant acceptance requires durable reconciliation.");
  }
}

export function createAssistantAcceptanceRecoveryResult(): SendChatMessageResult {
  return {
    ok: false,
    code: "CONFLICT",
    retryable: true,
    message: "回复已持久化，跨域成功确认仍在恢复中。",
    turnSettlementStatus: "unknown",
  };
}

export type ChatGoalService = {
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

export type ChatGoalDraftService = {
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

export type ChatPlanService = {
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

export type ChatGoalAmendmentService = (
  goalId: string,
  objective: string,
  reason: string,
) => Promise<GoalAmendmentOperationResult>;

export type ChatGoalRuntimeReplanService = (
  goalId: string,
  instructions: string,
) => Promise<CreateRuntimeGoalPlanResult>;

export type GoalIntentRoute =
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
  memoryProfileStore?: Pick<
    MemoryProfileStore,
    "updateFromMemories"
  >;
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
    options?: { sessionId?: string; beforeExecution?: AgentRunAdmissionGate },
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
    "ensureRun" | "settleLifecycle" | "getRun" | "listEvents"
  >;
  conversationCausalStore?: Pick<
    ConversationCausalStore,
    | "claimRequest"
    | "bindRequest"
    | "beginAttempt"
    | "settleAttempt"
    | "acceptAssistant"
    | "prepareAssistantAcceptance"
    | "commitAssistantAcceptance"
    | "reconcileAssistant"
    | "addRefs"
    | "beginRequiredSettlement"
    | "settleRequiredSettlement"
    | "admitAgentRun"
    | "settleAgentRunAdmission"
    | "getRequest"
  >;
  historyIndexStore?: Pick<HistoryIndexStore, "append">;
  /** P2: overflow compaction strategy passed through to the chat agent loop. */
  compactionStrategy?: CompactionStrategy;
  productionKernelDriver?: ProductionKernelDriver;
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

  async function hasDurableGuidedInputOwnership(
    persisted: SkillPendingInputState,
  ): Promise<boolean> {
    if (
      !options.conversationCausalStore
      || !options.chatSessionStore?.get
      || !persisted.userMessageId
      || !persisted.settlementId
    ) {
      return false;
    }
    const causalRecord = await options.conversationCausalStore.getRequest(
      persisted.requestId,
    ).catch(() => null);
    const binding = resolveDurableConversationBinding(causalRecord);
    const settlement = causalRecord?.requiredSettlements?.find(
      (candidate) => candidate.id === persisted.settlementId,
    );
    const session = await options.chatSessionStore.get(
      persisted.sessionId,
    ).catch(() => null);
    const sourceEvent = session?.activity?.statusEvents.find(
      (event) => event.settlementId === persisted.settlementId,
    );
    const sourceFingerprint = sourceEvent
      ? createRequiredChatEventFingerprint(sourceEvent)
      : undefined;
    return Boolean(
      binding
      && binding.sessionId === persisted.sessionId
      && binding.userMessageId === persisted.userMessageId
      && settlement?.state === "committed"
      && Boolean(settlement.preparedChatEventFingerprint)
      && settlement.chatEventFingerprint === settlement.preparedChatEventFingerprint
      && sourceFingerprint === settlement.preparedChatEventFingerprint
      && settlement.targetState === "waiting_for_input"
      && settlement.guidedInputRequestId === persisted.inputRequestId
      && causalRecord?.refs.some(
        (ref) => ref.kind === "guided_input" && ref.id === persisted.inputRequestId,
      ),
    );
  }

  async function compensateUnrecoverableGuidedInputSettlement(
    persisted: SkillPendingInputState,
  ): Promise<void> {
    if (
      !options.conversationCausalStore
      || !options.chatSessionStore?.get
      || !persisted.userMessageId
      || !persisted.settlementId
    ) {
      return;
    }
    const causalRecord = await options.conversationCausalStore.getRequest(
      persisted.requestId,
    ).catch(() => null);
    const binding = resolveDurableConversationBinding(causalRecord);
    const settlement = causalRecord?.requiredSettlements?.find(
      (candidate) =>
        candidate.id === persisted.settlementId
        && candidate.guidedInputRequestId === persisted.inputRequestId,
    );
    const owningAttempt = settlement
      ? causalRecord?.attempts.find(
          (candidate) => candidate.attempt === settlement.attempt,
        )
      : undefined;
    if (
      owningAttempt?.state === "accepted"
      && owningAttempt.assistantAcceptance?.state === "committed"
      && owningAttempt.acceptedSettlement
    ) {
      return;
    }
    if (
      !causalRecord
      || binding?.sessionId !== persisted.sessionId
      || binding.userMessageId !== persisted.userMessageId
      || !settlement
      || !causalRecord.refs.some(
        (ref) =>
          ref.kind === "guided_input"
          && ref.id === persisted.inputRequestId,
      )
    ) {
      return;
    }
    const session = await options.chatSessionStore.get(
      persisted.sessionId,
    ).catch(() => null);
    const events = session?.activity?.statusEvents ?? [];
    const sourceEvent = [...events].reverse().find(
      (event) =>
        event.settlementId === settlement.id
        && event.pendingSkillInput?.inputRequestId === persisted.inputRequestId,
    );
    if (settlement.state === "preparing") {
      const sourceFingerprint = sourceEvent
        ? createRequiredChatEventFingerprint(sourceEvent)
        : undefined;
      await options.conversationCausalStore.settleRequiredSettlement({
        requestId: persisted.requestId,
        id: settlement.id,
        state: "failed",
        ...(sourceFingerprint === settlement.preparedChatEventFingerprint
          ? {
              chatEventFingerprint: sourceFingerprint,
            }
          : {}),
        failureCode: "RECOVERY_INCOMPLETE",
      }).catch(() => undefined);
    }
    const tombstoneId = `${settlement.id}:recovery-tombstone`;
    if (!events.some((event) => event.settlementId === tombstoneId)) {
      const sequence = Math.max(
        settlement.sourceSequence,
        ...events
          .filter((event) => event.requestId === persisted.requestId)
          .map((event) => event.sequence ?? 0),
      ) + 1;
      await persistRequiredChatActivityEvent(options.chatSessionStore, {
        sessionId: persisted.sessionId,
        requestId: persisted.requestId,
        turnId: causalRecord.turnId,
        sequence,
        settlementId: tombstoneId,
        state: "failed",
        message: "Guided input recovery found an incomplete settlement.",
        createdAt: new Date(getNowMs(options.now)).toISOString(),
        elapsedMs: 0,
        domainStateAvailable: false,
        selectedSkillName: persisted.selectedSkillName,
        pendingSkillInput: {
          ...persisted,
          status: "failed",
          settlementId: settlement.id,
          attachmentPayloads: undefined,
        },
      }).catch(() => undefined);
    }
    await options.conversationCausalStore.settleAttempt({
      requestId: persisted.requestId,
      attempt: settlement.attempt,
      state: "interrupted",
    }).catch(() => undefined);
    await options.conversationCausalStore.addRefs({
      requestId: persisted.requestId,
      refs: [],
      coverage: {
        state: "degraded",
        reasonCodes: ["guided_input_recovery_incomplete"],
      },
    }).catch(() => undefined);
  }

  async function ensureGuidedInputCausalAttempt(
    persisted: SkillPendingInputState,
  ): Promise<number | null> {
    if (!options.conversationCausalStore) return 1;
    const record = await options.conversationCausalStore.getRequest(persisted.requestId);
    const lastAttempt = record?.attempts.at(-1);
    if (!lastAttempt) return null;
    if (lastAttempt.state === "active") return lastAttempt.attempt;
    if (
      lastAttempt.state !== "interrupted"
      && lastAttempt.state !== "reset"
      && lastAttempt.state !== "superseded"
    ) {
      return null;
    }
    const nextAttempt = lastAttempt.attempt + 1;
    const begun = await options.conversationCausalStore.beginAttempt({
      requestId: persisted.requestId,
      attempt: nextAttempt,
    });
    return begun.disposition === "applied" || begun.disposition === "duplicate"
      ? nextAttempt
      : null;
  }

  async function recoverPendingSkillInputState(
    inputRequestId: string,
  ): Promise<PendingSkillInputState | null> {
    const persisted = await findPersistedPendingSkillInputState({
      inputRequestId,
      chatSessionStore: options.chatSessionStore,
    });
    if (!persisted) {
      return null;
    }
    if (persisted.status === "processing") {
      await compensateUnrecoverableGuidedInputSettlement(persisted);
      return null;
    }
    if (persisted.status !== "pending") return null;
    if (!(await hasDurableGuidedInputOwnership(persisted))) {
      await compensateUnrecoverableGuidedInputSettlement(persisted);
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

  async function persistSkillInputLifecycleState(
    pending: PendingSkillInputState,
    status: "processing" | "canceled",
    attempt: number,
  ): Promise<void> {
    const persistedSession = options.chatSessionStore?.get
      ? await options.chatSessionStore.get(pending.sessionId)
      : null;
    const nextSequence = Math.max(
      pending.streamSequence,
      ...(persistedSession?.activity?.statusEvents
        .filter((event) => event.requestId === pending.requestId)
        .map((event) => event.sequence ?? 0)
        ?? [0]),
    ) + 1;
    const event: ChatTaskStatusEvent = {
      sessionId: pending.sessionId,
      requestId: pending.requestId,
      turnId: createConversationTurnId(pending.requestId),
      sequence: nextSequence,
      state: status === "canceled" ? "canceled" : "checkpoint_boundary",
      message:
        status === "canceled"
          ? "Skill input request retired."
          : "Skill input execution claimed.",
      createdAt: new Date(getNowMs(options.now)).toISOString(),
      elapsedMs: 0,
      domainStateAvailable: true,
      selectedSkillName: pending.selectedSkill.manifest.name,
      ...(pending.inputRequest
        ? { inputRequest: pending.inputRequest }
        : {}),
      pendingSkillInput: {
        ...pending.persisted,
        status,
        ...(status === "canceled" ? { attachmentPayloads: undefined } : {}),
      },
    };
    let workspaceRunRecorder: ChatWorkspaceRunRecorder | null = null;
    try {
      workspaceRunRecorder = pending.runContext
        ? await createChatWorkspaceRunRecorder({
            workspaceRunStore: options.workspaceRunStore,
            sessionId: pending.sessionId,
            requestId: pending.requestId,
            runContext: pending.runContext,
            selectedSkillName: pending.selectedSkill.manifest.name,
            createdAt: event.createdAt,
          })
        : null;
      await persistRequiredConversationSettlement({
        requestId: pending.requestId,
        attempt,
        event,
        chatSessionStore: options.chatSessionStore,
        conversationCausalStore: options.conversationCausalStore,
        workspaceRunRecorder,
        workspaceUnavailableReasonCode:
          "guided_input_workspace_run_unavailable",
        failureReasonCode: "guided_input_lifecycle_settlement_failed",
      });
      pending.streamSequence = nextSequence;
    } catch (error) {
      const settlementId = event.settlementId
        ?? createRequiredSettlementId({
          requestId: pending.requestId,
          attempt,
          sourceSequence: nextSequence,
          targetState: toRequiredSettlementTarget(event) ?? "failed",
        });
      const tombstone: ChatTaskStatusEvent = {
        ...event,
        sequence: nextSequence + 1,
        settlementId: `${settlementId}:tombstone`,
        state: "failed",
        message: "Guided input lifecycle settlement failed.",
        pendingSkillInput: {
          ...pending.persisted,
          status: "failed",
          settlementId,
          attachmentPayloads: undefined,
        },
      };
      await persistRequiredChatActivityEvent(
        options.chatSessionStore,
        tombstone,
      ).catch(() => undefined);
      await workspaceRunRecorder?.appendStatusEvent(tombstone).catch(() => undefined);
      await options.conversationCausalStore?.settleAttempt({
        requestId: pending.requestId,
        attempt,
        state: "interrupted",
      }).catch(() => undefined);
      pendingSkillInputRequests.delete(pending.persisted.inputRequestId);
      throw error;
    }
  }

  function markPersistedSkillInputProcessing(
    pending: PendingSkillInputState,
    attempt: number,
  ) {
    return persistSkillInputLifecycleState(pending, "processing", attempt);
  }

  function markPersistedSkillInputCanceled(
    pending: PendingSkillInputState,
    attempt: number,
  ) {
    return persistSkillInputLifecycleState(pending, "canceled", attempt);
  }

  async function prepareChatMessageInput(
    input: SendChatMessageInput,
    runtimeOptions: SendChatMessageRuntimeOptions,
  ): Promise<
    | { ok: true; value: PreparedChatMessageInput }
    | { ok: false; result: Extract<SendChatMessageResult, { ok: false }> }
  > {
    if (runtimeOptions.signal?.aborted) {
      return {
        ok: false,
        result: {
          ok: false,
          code: "CANCELED",
          retryable: true,
          message: "已中断任务。",
        },
      };
    }
    let processedAttachments: ProcessedChatAttachments;
    try {
      processedAttachments = processChatAttachments(input.attachments);
    } catch (error) {
      return {
        ok: false,
        result: {
          ok: false,
          message:
            error instanceof ChatAttachmentValidationError
              ? error.message
              : "无法读取粘贴的附件。",
        },
      };
    }
    const userMessage = input.message.trim()
      ? input.message
      : processedAttachments.metadata.length
        ? "请分析这些附件。"
        : input.message;
    if (!userMessage.trim()) {
      return {
        ok: false,
        result: { ok: false, code: "EMPTY_MESSAGE", message: "消息不能为空。" },
      };
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
    if (runtimeOptions.signal?.aborted) {
      return {
        ok: false,
        result: {
          ok: false,
          code: "CANCELED",
          retryable: true,
          message: "已中断任务。",
        },
      };
    }
    if (
      processedAttachments.images.length > 0
      && (input.mode === "goal_plan" || preexistingInputRoutingPlan)
    ) {
      return {
        ok: false,
        result: {
          ok: false,
          message:
            "只读 Plan Mode 暂不支持图片附件。请先移除图片，或把关键信息转为文本附件后再规划。",
        },
      };
    }
    return {
      ok: true,
      value: {
        processedAttachments,
        userMessage,
        modelUserMessage,
        hasAttachments,
        preexistingInputRoutingPlan,
      },
    };
  }

  function claimChatRequest(input: {
    requestId: string;
    turnId: string;
    messageInput: SendChatMessageInput;
    preparedInput: PreparedChatMessageInput;
    createdAt: string;
  }): Promise<ChatRequestClaim | null> {
    if (!options.conversationCausalStore) {
      return Promise.resolve(null);
    }
    return options.conversationCausalStore.claimRequest({
      requestId: input.requestId,
      turnId: input.turnId,
      inputFingerprint: createChatRequestClaimFingerprint({
        input: input.messageInput,
        userMessage: input.preparedInput.userMessage,
        validatedAttachments:
          input.preparedInput.processedAttachments.validatedInputs,
      }),
      inputFingerprintVersion: CONVERSATION_REQUEST_FINGERPRINT_VERSION,
      legacyInputFingerprint: createLegacyChatRequestClaimFingerprint({
        input: input.messageInput,
        userMessage: input.preparedInput.userMessage,
        validatedAttachments:
          input.preparedInput.processedAttachments.validatedInputs,
      }),
      coverage: options.workspaceRunStore
        ? { state: "complete", reasonCodes: [] }
        : {
            state: "partial",
            reasonCodes: ["workspace_run_adapter_unavailable"],
          },
      createdAt: input.createdAt,
    });
  }

  async function executeMessageInternal(
    input: SendChatMessageInput,
    runtimeOptions: SendChatMessageRuntimeOptions = {},
    internalOptions: ChatTurnInternalOptions = {},
  ): Promise<SendChatMessageResult> {
      if (runtimeOptions.signal?.aborted) {
        return {
          ok: false,
          code: "CANCELED",
          retryable: true,
          message: "已中断任务。",
        };
      }
      const preparation = internalOptions.preparedInput
        ? { ok: true as const, value: internalOptions.preparedInput }
        : await prepareChatMessageInput(input, runtimeOptions);
      if (!preparation.ok) {
        return preparation.result;
      }
      const {
        processedAttachments,
        userMessage,
        modelUserMessage,
        hasAttachments,
        preexistingInputRoutingPlan,
      } = preparation.value;

      let sessionId = input.sessionId ?? createId();
      const startedAtMs = getNowMs(options.now);
      const requestId = input.requestId ?? `request_${startedAtMs}`;
      let workspaceRunRecorder: ChatWorkspaceRunRecorder | null = null;
      let currentCausalAttempt = 0;
      const publicationAuthority =
        internalOptions.publicationAuthority ?? createChatPublicationAuthority();

      function invalidatePublicationAuthority(reasonCode: string): void {
        publicationAuthority.invalidate(reasonCode);
        internalOptions.onDomainStateUnavailable?.();
      }

      async function interruptRequiredSettlementAttempt(): Promise<void> {
        pendingContinuations.delete(sessionId);
        if (!options.conversationCausalStore || currentCausalAttempt < 1) return;
        try {
          const settled = await options.conversationCausalStore.settleAttempt({
            requestId,
            attempt: currentCausalAttempt,
            state: "interrupted",
          });
          if (
            settled.disposition !== "applied"
            && settled.disposition !== "duplicate"
          ) {
            await options.conversationCausalStore.addRefs({
              requestId,
              refs: [],
              coverage: {
                state: "degraded",
                reasonCodes: ["required_settlement_attempt_interrupt_conflict"],
              },
            }).catch(() => undefined);
          }
        } catch {
          await options.conversationCausalStore.addRefs({
            requestId,
            refs: [],
            coverage: {
              state: "degraded",
              reasonCodes: ["required_settlement_attempt_interrupt_failed"],
            },
          }).catch(() => undefined);
        }
      }

      async function compensateRequiredSettlementFailure(
        event: ChatTaskStatusEvent,
      ): Promise<boolean> {
        const {
          payload: _payload,
          inputRequest: _inputRequest,
          pendingSkillInput,
          maxTurns: _maxTurns,
          ...safeEvent
        } = event;
        const failureEvent: ChatTaskStatusEvent = {
          ...safeEvent,
          ...(event.settlementId
            ? { settlementId: `${event.settlementId}:tombstone` }
            : {}),
          state: "failed",
          message: "Required conversation settlement failed.",
          ...(pendingSkillInput
            ? {
                pendingSkillInput: {
                  ...pendingSkillInput,
                  status: "failed",
                  attachmentPayloads: undefined,
                },
              }
            : {}),
        };
        const [chatCompensation, workspaceCompensation] = await Promise.allSettled([
          persistRequiredChatActivityEvent(options.chatSessionStore, failureEvent),
          workspaceRunRecorder
            ? workspaceRunRecorder.appendStatusEvent(failureEvent)
            : Promise.resolve(null),
        ]);
        const reasonCodes = ["required_conversation_settlement_failed"];
        if (chatCompensation.status === "rejected") {
          reasonCodes.push("required_chat_failure_compensation_failed");
          invalidatePublicationAuthority("required_chat_failure_compensation_failed");
        }
        if (workspaceCompensation.status === "rejected") {
          reasonCodes.push("required_workspace_failure_compensation_failed");
        }
        const recorded = workspaceCompensation.status === "fulfilled"
          ? workspaceCompensation.value
          : null;
        await options.conversationCausalStore?.addRefs({
          requestId,
          refs: [
            ...(workspaceRunRecorder
              ? [{ kind: "workspace_run" as const, id: workspaceRunRecorder.workspaceRunId }]
              : []),
            ...(recorded?.eventId && workspaceRunRecorder
              ? [{
                  kind: "workspace_event" as const,
                  runId: workspaceRunRecorder.workspaceRunId,
                  eventId: recorded.eventId,
                }]
              : []),
          ],
          coverage: { state: "degraded", reasonCodes },
        }).catch(() => undefined);
        await interruptRequiredSettlementAttempt();
        return chatCompensation.status === "fulfilled";
      }

      async function persistChatStatusEvent(
        event: ChatTaskStatusEvent,
        requiredChat: boolean,
      ): Promise<void> {
        if (!requiredChat) {
          if (options.chatSessionStore?.appendActivityEvent) {
            try {
              await options.chatSessionStore.appendActivityEvent(event.sessionId, event);
            } catch {
              await options.conversationCausalStore?.addRefs({
                requestId,
                refs: [],
                coverage: {
                  state: "degraded",
                  reasonCodes: ["chat_activity_write_failed"],
                },
              }).catch(() => undefined);
            }
          }
          if (!workspaceRunRecorder) {
            await options.conversationCausalStore?.addRefs({
              requestId,
              refs: [],
              coverage: {
                state: "partial",
                reasonCodes: ["workspace_run_unavailable"],
              },
            }).catch(() => undefined);
            return;
          }
          try {
            const recorded = await workspaceRunRecorder.appendStatusEvent(event);
            await options.conversationCausalStore?.addRefs({
              requestId,
              refs: [
                { kind: "workspace_run", id: workspaceRunRecorder.workspaceRunId },
                ...(recorded.eventId
                  ? [{
                      kind: "workspace_event" as const,
                      runId: workspaceRunRecorder.workspaceRunId,
                      eventId: recorded.eventId,
                    }]
                  : []),
              ],
            }).catch(() => undefined);
          } catch {
            await options.conversationCausalStore?.addRefs({
              requestId,
              refs: [{ kind: "workspace_run", id: workspaceRunRecorder.workspaceRunId }],
              coverage: {
                state: "degraded",
                reasonCodes: ["workspace_run_write_failed"],
              },
            }).catch(() => undefined);
          }
          return;
        }
        try {
          await persistRequiredConversationSettlement({
            requestId,
            attempt: currentCausalAttempt,
            event,
            chatSessionStore: options.chatSessionStore,
            conversationCausalStore: options.conversationCausalStore,
            workspaceRunRecorder,
            workspaceUnavailableReasonCode: "workspace_run_unavailable",
          });
        } catch (error) {
          const failureStatusPersisted =
            await compensateRequiredSettlementFailure(event);
          throw new RequiredConversationSettlementError(
            failureStatusPersisted,
            error,
            error instanceof RequiredConversationSettlementError
              ? error.failureCode
              : "CROSS_DOMAIN_SETTLEMENT_FAILED",
          );
        }
      }
      const chatTimeZone = options.systemTimeZone ?? getSystemTimeZone();
      // Anchor date to turn start, interpreted in the user's system timezone.
      const chatDate = formatDateInTimeZone(new Date(startedAtMs), chatTimeZone);
      const emitStatus = createChatStatusEmitter({
        sessionId,
        requestId,
        startedAtMs,
        initialSequence: internalOptions.initialStreamSequence,
        now: options.now,
        onStatusEvent: runtimeOptions.onStatusEvent,
        onStreamEvent: runtimeOptions.onStreamEvent,
        getDomainStateAvailable: () => publicationAuthority.domainStateAvailable(),
        onPersistEvent(event) {
          return persistChatStatusEvent(event, false);
        },
        async onRequiredPersistEvent(event: ChatTaskStatusEvent) {
          await persistChatStatusEvent(event, true);
        },
      });
      const outputAssembler = createChatOutputAssembler(() =>
        new Date(getNowMs(options.now)).toISOString(),
      );
      let accumulatedReasoningProjection = "";
      let terminalStreamEventSent = false;

      function finalizeAssistantOutput(content: string): {
        outputParts?: ChatOutputPart[];
      } {
        outputAssembler.setFinalText(redactCredentialString(content));
        const outputParts = outputAssembler.parts();
        return {
          ...(outputParts.length > 0 ? { outputParts } : {}),
        };
      }

      function emitOutputPart(
        part: ChatOutputPart,
        provenance: { domainStateAvailable?: false } = {},
      ) {
        emitStatus.sendStreamEvent({
          type: "output_part",
          part,
          ...provenance,
        });
      }

      const causalTurnId = createConversationTurnId(requestId);
      const requestClaim = internalOptions.requestClaim !== undefined
        ? internalOptions.requestClaim
        : await claimChatRequest({
            requestId,
            turnId: causalTurnId,
            messageInput: input,
            preparedInput: preparation.value,
            createdAt: new Date(startedAtMs).toISOString(),
          });
      const claimBinding = resolveDurableConversationBinding(requestClaim?.value);
      const legacyRequestClaim = Boolean(
        requestClaim?.value
        && resolveConversationRequestFingerprintVersion(requestClaim.value)
          === LEGACY_CONVERSATION_REQUEST_FINGERPRINT_VERSION,
      );
      if (legacyRequestClaim) {
        await options.conversationCausalStore?.addRefs({
          requestId,
          refs: [],
          coverage: {
            state: "degraded",
            reasonCodes: ["legacy_request_fingerprint"],
          },
        }).catch(() => undefined);
      }
      currentCausalAttempt = requestClaim?.value?.attempts.at(-1)?.attempt ?? 0;

      async function ensureCausalAttempt(): Promise<void> {
        if (!options.conversationCausalStore) {
          currentCausalAttempt = Math.max(1, currentCausalAttempt);
          return;
        }
        const current = await options.conversationCausalStore.getRequest(requestId);
        const last = current?.attempts.at(-1);
        if (last?.state === "accepted") {
          currentCausalAttempt = last.attempt;
          return;
        }
        if (last?.state === "active") {
          currentCausalAttempt = last.attempt;
          return;
        }
        const nextAttempt = (last?.attempt ?? 0) + 1;
        const begun = await options.conversationCausalStore.beginAttempt({
          requestId,
          attempt: nextAttempt,
        });
        if (begun.disposition !== "applied" && begun.disposition !== "duplicate") {
          throw new Error("Conversation causal attempt could not be started.");
        }
        currentCausalAttempt = nextAttempt;
      }

      async function emitTerminalStreamEvent(event: {
        type: "completed" | "failed" | "canceled";
        message?: string;
        finalMessageId?: string;
        domainStateAvailable?: false;
      }) {
        if (terminalStreamEventSent) {
          return;
        }
        const domainStateAvailable =
          event.domainStateAvailable === false
            || !publicationAuthority.domainStateAvailable()
            ? false as const
            : undefined;
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
            domainStateAvailable === false
              ? { domainStateAvailable: false }
              : {},
          );
        }
        terminalStreamEventSent = true;
        await emitStatus.drainPersistence();
        emitStatus.sendTerminalEvent({
          ...event,
          ...(domainStateAvailable === false
            ? { domainStateAvailable: false as const }
            : {}),
        });
      }

      async function settleClaimOwnedFailure(message: string): Promise<void> {
        const durableSessionId = publicationAuthority.durableSessionId();
        if (durableSessionId && options.chatSessionStore?.appendActivityEvent) {
          try {
            await emitStatus.sendRequired({
              state: "failed",
              message,
              toolCallsExecuted: 0,
            });
            await emitTerminalStreamEvent({
              type: "failed",
              message,
            });
            return;
          } catch (error) {
            if (
              !(error instanceof RequiredConversationSettlementError)
              || !error.failureStatusPersisted
            ) {
              invalidatePublicationAuthority("claim_terminal_activity_write_failed");
            }
            await options.conversationCausalStore?.addRefs({
              requestId,
              refs: [],
              coverage: {
                state: "degraded",
                reasonCodes: ["claim_terminal_activity_write_failed"],
              },
            }).catch(() => undefined);
            emitStatus.sendPublishedOnly({
              state: "failed",
              message,
              toolCallsExecuted: 0,
            });
          }
        } else {
          invalidatePublicationAuthority(
            durableSessionId
              ? "chat_activity_adapter_unavailable"
              : "session_binding_unproven",
          );
          await options.conversationCausalStore?.addRefs({
            requestId,
            refs: [],
            coverage: {
              state: "degraded",
              reasonCodes: [
                durableSessionId
                  ? "chat_activity_adapter_unavailable"
                  : "session_binding_unproven",
              ],
            },
          }).catch(() => undefined);
          emitStatus.sendPublishedOnly({
            state: "failed",
            message,
            toolCallsExecuted: 0,
          });
        }
        await emitTerminalStreamEvent({
          type: "failed",
          message,
          domainStateAvailable: false,
        });
      }

      const replaySessionId = options.conversationCausalStore
        ? claimBinding?.sessionId
        : sessionId;
      const persistedRequestTurnCandidate =
        replaySessionId && input.requestId && options.chatSessionStore?.get
          ? await findPersistedRequestTurn(
              options.chatSessionStore,
              replaySessionId,
              input.requestId,
            )
          : null;
      if (
        claimBinding
        && persistedRequestTurnCandidate?.user?.id !== claimBinding.userMessageId
      ) {
        await settleClaimOwnedFailure(
          "持久化会话消息与 request 因果归属不一致，已拒绝重放。",
        );
        return {
          ok: false,
          code: "CONFLICT",
          message: "持久化会话消息与 request 因果归属不一致，已拒绝重放。",
        };
      }
      const persistedRequestTurn = claimBinding
        ? persistedRequestTurnCandidate?.user?.id === claimBinding.userMessageId
          ? persistedRequestTurnCandidate
          : null
        : options.conversationCausalStore
          ? null
          : persistedRequestTurnCandidate;
      if (persistedRequestTurn?.user) {
        sessionId = persistedRequestTurn.session.id;
        if (!publicationAuthority.markDurable(sessionId, persistedRequestTurn.user.id)) {
          invalidatePublicationAuthority("durable_binding_conflict");
        }
        emitStatus.setSessionId(sessionId);
        internalOptions.onDurableSessionResolved?.(sessionId);
      } else if (requestClaim?.value?.sessionId && !claimBinding) {
        await options.conversationCausalStore?.addRefs({
          requestId,
          refs: [],
          coverage: {
            state: "degraded",
            reasonCodes: ["session_binding_unproven"],
          },
        }).catch(() => undefined);
      }
      if (requestClaim?.disposition === "conflict") {
        await settleClaimOwnedFailure(
          "相同 requestId 已绑定到不同输入，已拒绝冲突重放。",
        );
        return {
          ok: false,
          message: "相同 requestId 已绑定到不同输入，已拒绝冲突重放。",
        };
      }
      if (persistedRequestTurn?.assistant) {
        const persistedAssistant = persistedRequestTurn.assistant;
        const replaySettlementStatus =
          persistedAssistant.turnSettlementStatus ?? "unknown";
        const persistedMessage = {
          id: persistedAssistant.id,
          role: persistedAssistant.role,
          requestId,
          turnId: causalTurnId,
          content: persistedAssistant.content,
          turnSettlementStatus: persistedAssistant.turnSettlementStatus,
        };
        let accepted;
        if (options.conversationCausalStore) {
          const witnessedAttempt = persistedAssistant.causalAttempt;
          const expectedAttemptId = witnessedAttempt !== undefined
            ? createConversationCausalAttemptId({
                requestId,
                turnId: causalTurnId,
                attempt: witnessedAttempt,
              })
            : null;
          const hasExactAttemptWitness =
            persistedAssistant.requestId === requestId
            && persistedAssistant.turnId === causalTurnId
            && witnessedAttempt !== undefined
            && witnessedAttempt > 0
            && persistedAssistant.causalAttemptId === expectedAttemptId;
          if (
            replaySettlementStatus === "failed"
            || replaySettlementStatus === "canceled"
          ) {
            currentCausalAttempt = Math.max(1, witnessedAttempt ?? 1);
            return {
              ok: false,
              code: "CONFLICT",
              message: "已持久化回复与因果收据冲突，未重放执行。",
            };
          }
          const receiptOwnedAttempt = hasExactAttemptWitness
            ? requestClaim?.value?.attempts.find((attempt) =>
                attempt.attempt === witnessedAttempt,
              )
            : requestClaim?.value?.attempts.find((attempt) =>
                (
                  attempt.state === "accepted"
                  && attempt.acceptedSettlement?.acceptedMessageId
                    === persistedAssistant.id
                )
                || attempt.assistantAcceptance?.acceptedSettlement.acceptedMessageId
                  === persistedAssistant.id,
              );
          if (!receiptOwnedAttempt) {
            await options.conversationCausalStore.addRefs({
              requestId,
              refs: [],
              coverage: {
                state: "degraded",
                reasonCodes: ["assistant_attempt_witness_missing"],
              },
            }).catch(() => undefined);
            return {
              ok: false,
              code: "CONFLICT",
              message: "已持久化回复缺少可验证的尝试归属，只能作为历史记录读取。",
            };
          }
          currentCausalAttempt = receiptOwnedAttempt.attempt;
          if (receiptOwnedAttempt.assistantAcceptance?.state === "preparing") {
            const prepared = await options.conversationCausalStore
              .prepareAssistantAcceptance({
                requestId,
                attempt: receiptOwnedAttempt.attempt,
                persistedMessage,
                ...(receiptOwnedAttempt.assistantAcceptance.workspaceRunId
                  ? {
                      workspaceRunId:
                        receiptOwnedAttempt.assistantAcceptance.workspaceRunId,
                    }
                  : {}),
              });
            if (
              prepared.disposition !== "applied"
              && prepared.disposition !== "duplicate"
            ) {
              return {
                ok: false,
                code: "CONFLICT",
                message: "已持久化回复与因果准备记录冲突，未发布成功。",
              };
            }
            const preparation = prepared.value?.attempts.find((attempt) =>
              attempt.attempt === receiptOwnedAttempt.attempt,
            )?.assistantAcceptance;
            if (!preparation) {
              throw new AssistantAcceptanceRecoveryRequiredError(
                createAssistantAcceptanceRecoveryResult(),
              );
            }
            let workspaceEventId: string | undefined;
            if (preparation.requiredDomains.includes("workspace")) {
              if (!options.workspaceRunStore || !preparation.workspaceRunId) {
                throw new AssistantAcceptanceRecoveryRequiredError(
                  createAssistantAcceptanceRecoveryResult(),
                );
              }
              const workspaceSettlement =
                await settlePreparedWorkspaceAssistantAcceptance({
                  workspaceRunStore: options.workspaceRunStore,
                  workspaceRunId: preparation.workspaceRunId,
                  acceptance: preparation,
                });
              workspaceEventId = workspaceSettlement.eventId;
              if (workspaceSettlement.disposition === "recovery_required") {
                throw new AssistantAcceptanceRecoveryRequiredError(
                  createAssistantAcceptanceRecoveryResult(),
                );
              }
            }
            const committed = await commitPreparedAssistantAcceptance({
              conversationCausalStore: options.conversationCausalStore,
              requestId,
              attempt: receiptOwnedAttempt.attempt,
              acceptance: preparation,
              workspaceEventId,
            });
            if (committed === "recovery_required") {
              throw new AssistantAcceptanceRecoveryRequiredError(
                createAssistantAcceptanceRecoveryResult(),
              );
            }
            accepted = {
              disposition: "duplicate" as const,
              value: await options.conversationCausalStore.getRequest(requestId)
                ?? undefined,
            };
          } else if (hasExactAttemptWitness) {
            currentCausalAttempt = witnessedAttempt;
            accepted = await options.conversationCausalStore.reconcileAssistant({
              requestId,
              attempt: witnessedAttempt,
              causalAttemptId: expectedAttemptId!,
              persistedMessage,
            });
          } else {
            accepted = await options.conversationCausalStore.acceptAssistant({
              requestId,
              attempt: receiptOwnedAttempt.attempt,
              persistedMessage,
            });
          }
        } else {
          currentCausalAttempt = Math.max(1, persistedAssistant.causalAttempt ?? 1);
        }
        if (
          accepted
          && accepted.disposition !== "applied"
          && accepted.disposition !== "duplicate"
        ) {
          return {
            ok: false,
            code: "CONFLICT",
            message: "已持久化回复与因果收据冲突，未重放执行。",
          };
        }
        const acceptedAttempt = accepted?.value?.attempts.find((attempt) =>
          attempt.acceptedSettlement?.acceptedMessageId === persistedAssistant.id
          || attempt.assistantAcceptance?.acceptedSettlement.acceptedMessageId
            === persistedAssistant.id,
        );
        const expectedWorkspaceRunId =
          acceptedAttempt?.assistantAcceptance?.workspaceRunId
          ?? createChatWorkspaceRunId(sessionId, requestId);
        const persistedWorkspaceRunId = accepted?.value?.refs.some(
          (ref) =>
            ref.kind === "workspace_run"
            && ref.id === expectedWorkspaceRunId,
        )
          ? expectedWorkspaceRunId
          : undefined;
        const expectsWorkspaceReconciliation = Boolean(
          options.workspaceRunStore
          || acceptedAttempt?.assistantAcceptance?.workspaceRunId
          || accepted?.value?.refs.some((ref) => ref.kind === "workspace_run"),
        );
        if (
          persistedWorkspaceRunId
          && options.workspaceRunStore
          && replaySettlementStatus === "succeeded"
        ) {
          const repairEventId = `chat_status_${createConversationRequestFingerprint({
            requestId,
            state: "completed",
            acceptedMessageId: persistedAssistant.id,
          })}`;
          try {
            await options.workspaceRunStore.settleLifecycle({
              workspaceRunId: persistedWorkspaceRunId,
              event: {
                id: repairEventId,
                createdAt: persistedAssistant.createdAt,
                type: "status",
                status: "succeeded",
                message: "Recovered accepted assistant reply.",
                causalRef: {
                  turnId: causalTurnId,
                  sourceSequence: 0,
                },
              },
              snapshotStatus: "succeeded",
              summary: "Recovered accepted assistant reply.",
            });
          } catch {
            await options.conversationCausalStore?.addRefs({
              requestId,
              refs: [{ kind: "workspace_run", id: persistedWorkspaceRunId }],
              coverage: {
                state: "degraded",
                reasonCodes: ["workspace_accept_reconcile_failed"],
              },
            }).catch(() => undefined);
          }
        } else if (
          replaySettlementStatus === "succeeded"
          && accepted?.value
          && expectsWorkspaceReconciliation
        ) {
          await options.conversationCausalStore?.addRefs({
            requestId,
            refs: [],
            coverage: {
              state: "degraded",
              reasonCodes: [
                persistedWorkspaceRunId
                  ? "workspace_accept_reconcile_unavailable"
                  : "workspace_owner_ref_missing",
              ],
            },
          }).catch(() => undefined);
        } else if (replaySettlementStatus === "unknown") {
          await options.conversationCausalStore?.addRefs({
            requestId,
            refs: persistedWorkspaceRunId
              ? [{ kind: "workspace_run", id: persistedWorkspaceRunId }]
              : [],
            coverage: {
              state: "degraded",
              reasonCodes: ["legacy_turn_settlement_unknown"],
            },
          }).catch(() => undefined);
        }
        emitStatus.setAssistantMessageId(persistedAssistant.id);
        emitStatus.sendAttemptControl({
          operation: "accepted",
          attempt: Math.max(1, currentCausalAttempt),
        });
        await emitTerminalStreamEvent({
          type:
            replaySettlementStatus === "failed"
              ? "failed"
              : replaySettlementStatus === "canceled"
                ? "canceled"
                : "completed",
          message: persistedAssistant.content,
          finalMessageId: persistedAssistant.id,
        });
        return {
          ok: true,
          reply: persistedAssistant.content,
          sessionId,
          relatedMemories: [],
          memoryId: null,
          turnSettlementStatus: replaySettlementStatus,
        };
      }
      if (legacyRequestClaim) {
        await settleClaimOwnedFailure(
          "旧版请求记录只能读取已持久化结果，无法安全恢复执行；请重新发送为新请求。",
        );
        return {
          ok: false,
          code: "CONFLICT",
          message:
            "旧版请求记录只能读取已持久化结果，无法安全恢复执行；请重新发送为新请求。",
        };
      }
      if (
        requestClaim?.disposition === "duplicate"
        && !internalOptions.skipUserMessageAppend
      ) {
        return {
          ok: false,
          retryable: true,
          message: "相同请求仍在处理中，未启动第二次执行。",
        };
      }

      async function persistAssistantReply(input: {
        content: string;
        relatedMemoryIds?: string[];
        executedRunId?: string;
        goalId?: string;
        goalEventRef?: string;
        terminalType?: "completed" | "failed" | "canceled";
        settlementStatus?: ChatTurnSettlementStatus;
      }): Promise<string | null> {
        const settlementStatus = input.settlementStatus ?? "succeeded";
        const safeContent = redactCredentialString(input.content);
        const finalizedOutput = finalizeAssistantOutput(safeContent);
        const assistantMessage = await appendAssistantMessage({
          chatSessionStore: options.chatSessionStore,
          sessionId,
          requestId,
          turnId: causalTurnId,
          causalAttempt: currentCausalAttempt,
          causalAttemptId: createConversationCausalAttemptId({
            requestId,
            turnId: causalTurnId,
            attempt: currentCausalAttempt,
          }),
          content: safeContent,
          turnSettlementStatus: settlementStatus,
          outputParts: finalizedOutput.outputParts,
          ...(input.relatedMemoryIds?.length
            ? { relatedMemoryIds: input.relatedMemoryIds }
            : {}),
          ...(input.executedRunId ? { executedRunId: input.executedRunId } : {}),
          ...(input.goalId ? { goalId: input.goalId } : {}),
          ...(input.goalEventRef ? { goalEventRef: input.goalEventRef } : {}),
        });
        const assistantMessageId = assistantMessage?.id ?? null;
        await emitStatus.drainPersistence();
        const assistantRequiresAcceptance = settlementStatus !== "failed"
          && settlementStatus !== "canceled";
        if (
          assistantMessage
          && assistantRequiresAcceptance
          && options.conversationCausalStore
        ) {
          const persistedMessage = {
            id: assistantMessage.id,
            role: assistantMessage.role,
            requestId,
            turnId: causalTurnId,
            content: assistantMessage.content,
            turnSettlementStatus: assistantMessage.turnSettlementStatus,
          };
          const prepared = await options.conversationCausalStore
            .prepareAssistantAcceptance({
              requestId,
              attempt: currentCausalAttempt,
              persistedMessage,
              ...(workspaceRunRecorder && settlementStatus === "succeeded"
                ? { workspaceRunId: workspaceRunRecorder.workspaceRunId }
                : {}),
            });
          if (
            prepared.disposition !== "applied"
            && prepared.disposition !== "duplicate"
          ) {
            throw new Error("Durable assistant message conflicts with causal receipt.");
          }
          const acceptance = prepared.value?.attempts.find((attempt) =>
            attempt.attempt === currentCausalAttempt,
          )?.assistantAcceptance;
          if (!acceptance) {
            throw new Error("Durable assistant acceptance was not prepared.");
          }
          let workspaceEventId: string | undefined;
          if (workspaceRunRecorder && settlementStatus === "succeeded") {
            let finalized;
            try {
              finalized = await workspaceRunRecorder.finalizeAccepted(acceptance);
            } catch (error) {
              await options.conversationCausalStore.addRefs({
                requestId,
                refs: [{ kind: "workspace_run", id: workspaceRunRecorder.workspaceRunId }],
                coverage: {
                  state: "degraded",
                  reasonCodes: ["workspace_terminal_settlement_failed"],
                },
              }).catch(() => undefined);
              throw error instanceof SecretSafeFailureError
                ? error
                : new SecretSafeFailureError("WORKSPACE_SETTLEMENT_FAILED", error);
            }
            workspaceEventId = finalized.eventId;
            if (finalized.disposition === "recovery_required") {
              throw new AssistantAcceptanceRecoveryRequiredError(
                createAssistantAcceptanceRecoveryResult(),
              );
            }
          }
          const committed = await commitPreparedAssistantAcceptance({
            conversationCausalStore: options.conversationCausalStore,
            requestId,
            attempt: currentCausalAttempt,
            acceptance,
            workspaceEventId,
          });
          if (committed === "recovery_required") {
            throw new AssistantAcceptanceRecoveryRequiredError(
              createAssistantAcceptanceRecoveryResult(),
            );
          }
        } else if (workspaceRunRecorder && settlementStatus === "succeeded") {
          await workspaceRunRecorder.finalizeAccepted();
        }
        if (assistantMessage && assistantRequiresAcceptance) {
          emitStatus.sendAttemptControl({
            operation: "accepted",
            attempt: Math.max(1, currentCausalAttempt),
          });
        }
        emitStatus.setAssistantMessageId(assistantMessageId);
        await emitTerminalStreamEvent({
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
        await emitTerminalStreamEvent({
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
        userMessageId = appendResult.message.id;
        if (!publicationAuthority.markDurable(sessionId, userMessageId)) {
          invalidatePublicationAuthority("durable_binding_conflict");
          throw new Error("Conversation publication authority rejected the durable user message.");
        }
        emitStatus.setSessionId(sessionId);
        internalOptions.onDurableSessionResolved?.(sessionId);
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
      } else if (persistedRequestTurn?.user) {
        sessionId = persistedRequestTurn.session.id;
        userMessageId = persistedRequestTurn.user.id;
        if (!publicationAuthority.markDurable(sessionId, userMessageId)) {
          invalidatePublicationAuthority("durable_binding_conflict");
          throw new Error("Conversation publication authority rejected the persisted user message.");
        }
        emitStatus.setSessionId(sessionId);
        internalOptions.onDurableSessionResolved?.(sessionId);
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
        const expectedUserMessageId = internalOptions.userMessageId ?? null;
        const storedSession =
          options.chatSessionStore?.get && input.sessionId
            ? await options.chatSessionStore.get(input.sessionId)
            : null;
        const storedUserMessage = expectedUserMessageId
          ? storedSession?.messages.find(
              (message) =>
                message.id === expectedUserMessageId && message.role === "user",
            )
          : null;
        if (storedSession && storedUserMessage) {
          sessionId = storedSession.id;
          userMessageId = storedUserMessage.id;
          if (!publicationAuthority.markDurable(sessionId, userMessageId)) {
            invalidatePublicationAuthority("durable_binding_conflict");
            throw new Error("Conversation publication authority rejected the guided-input user message.");
          }
          emitStatus.setSessionId(sessionId);
          internalOptions.onDurableSessionResolved?.(sessionId);
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
      if (options.conversationCausalStore) {
        if (!userMessageId) {
          await settleClaimOwnedFailure(
            "用户消息尚未持久化，无法安全开始或恢复执行。",
          );
          return {
            ok: false,
            retryable: true,
            message: "用户消息尚未持久化，无法安全开始或恢复执行。",
          };
        }
        const bound = await options.conversationCausalStore.bindRequest({
          requestId,
          sessionId,
          userMessageId,
        });
        if (bound.disposition === "conflict" || bound.disposition === "not_found") {
          await settleClaimOwnedFailure(
            "会话消息与 request 因果绑定冲突，已停止执行。",
          );
          return {
            ok: false,
            message: "会话消息与 request 因果绑定冲突，已停止执行。",
          };
        }
        const boundBinding = resolveDurableConversationBinding(bound.value);
        if (!boundBinding || boundBinding.userMessageId !== userMessageId) {
          invalidatePublicationAuthority("causal_binding_missing_user_message");
          throw new Error("Conversation causal binding did not return a durable session.");
        }
        sessionId = boundBinding.sessionId;
        if (!publicationAuthority.markDurable(sessionId, boundBinding.userMessageId)) {
          invalidatePublicationAuthority("durable_binding_conflict");
          throw new Error("Conversation publication authority rejected the causal binding.");
        }
        emitStatus.setSessionId(sessionId);
        internalOptions.onDurableSessionResolved?.(sessionId);
      }
      await ensureCausalAttempt();
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
        try {
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
          internalOptions.onWorkspaceRunRecorderResolved?.(workspaceRunRecorder);
        } catch (error) {
          if (error instanceof WorkspaceRunEnvelopeConflictError) {
            await options.conversationCausalStore?.addRefs({
              requestId,
              refs: [],
              coverage: {
                state: "degraded",
                reasonCodes: ["workspace_run_envelope_conflict"],
              },
            }).catch(() => undefined);
            await emitTerminalStreamEvent({
              type: "failed",
              message: "工作区运行状态与当前请求不一致，已安全停止。",
            });
            return {
              ok: false,
              code: "CONFLICT",
              message: "工作区运行状态与当前请求不一致，已安全停止。",
            };
          }
          const failure = toSecretSafeFailure(
            error,
            "WORKSPACE_RUN_INITIALIZATION_FAILED",
          );
          invalidatePublicationAuthority("workspace_run_initialize_failed");
          await options.conversationCausalStore?.addRefs({
            requestId,
            refs: [],
            coverage: {
              state: "degraded",
              reasonCodes: [...failure.coverageReasonCodes],
            },
          }).catch(() => undefined);
          emitStatus.sendPublishedOnly({
            state: "failed",
            message: failure.publicMessage,
          });
          await emitTerminalStreamEvent({
            type: "failed",
            message: failure.publicMessage,
            domainStateAvailable: false,
          });
          return {
            ok: false,
            code: "INTERNAL_ERROR",
            retryable: failure.retryable,
            message: failure.publicMessage,
            domainStateAvailable: false,
          };
        }
        if (options.workspaceRunStore && !workspaceRunRecorder) {
          await options.conversationCausalStore?.addRefs({
            requestId,
            refs: [],
            coverage: {
              state: "degraded",
              reasonCodes: ["workspace_run_initialize_failed"],
            },
          }).catch(() => undefined);
        }
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
            await emitStatus.sendRequired({
              state: "paused",
              message: "旧 Skill 输入已作废，当前会话保持只读规划",
              toolCallsExecuted: 0,
            });
            await persistAssistantReply({
              content: reply,
              goalEventRef: `plan-invalidated-skill-input:${inputRoutingPlan.id}:${inputRoutingPlan.revision}`,
              settlementStatus: "paused",
            });
            return {
              ok: true,
              reply,
              sessionId,
              relatedMemories: [],
              memoryId: null,
              turnSettlementStatus: "paused",
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
              await emitTerminalStreamEvent({
                type: "failed",
                message: amendment.message,
              });
              return { ok: false, message: amendment.message };
            }
            const reply = `${amendment.message} 当前 Goal 和活动 Plan 尚未改变；请在 Goal 详情中批准或拒绝。`;
            await emitStatus.sendRequired({
              state: "paused",
              message: "目标修订提案等待明确批准",
              toolCallsExecuted: 0,
            });
            await persistAssistantReply({
              content: reply,
              goalEventRef: `goal-amendment:${amendment.proposal.id}`,
              settlementStatus: "paused",
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
              turnSettlementStatus: "paused",
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
            await emitStatus.sendRequired({
              state: "paused",
              message: "计划仍处于只读状态，请先处理计划恢复入口",
              toolCallsExecuted: 0,
            });
            await persistAssistantReply({
              content: reply,
              goalEventRef: `plan-locked:${inputRoutingPlan.id}:${inputRoutingPlan.revision}`,
              settlementStatus: "paused",
            });
            return {
              ok: true,
              reply,
              sessionId,
              relatedMemories: [],
              memoryId: null,
              turnSettlementStatus: "paused",
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
              await emitTerminalStreamEvent({
                type: "canceled",
                message: "已中断任务。",
              });
              return { ok: false, code: "CANCELED", retryable: true, message: "已中断任务。" };
            }
            const message = "继续规划失败，已安全停止。";
            emitStatus.send({
              state: "failed",
              message,
              toolCallsExecuted: 0,
            });
            await emitTerminalStreamEvent({ type: "failed", message });
            return { ok: false, message };
          }
          if (!continuation.ok) {
            emitStatus.send({
              state: "failed",
              message: continuation.message,
              toolCallsExecuted: 0,
            });
            await emitTerminalStreamEvent({
              type: "failed",
              message: continuation.message,
            });
            return { ok: false, message: continuation.message };
          }
          const plan = continuation.plan;
          const reply = formatPlanContinuationReply(plan);
          const planContinuationState =
            plan.status === "awaiting_confirmation" ? "completed" : "paused";
          const planContinuationEvent: Omit<
            ChatTaskStatusEvent,
            "sessionId" | "createdAt" | "elapsedMs"
          > = {
            state: planContinuationState,
            message:
              plan.status === "awaiting_confirmation"
                ? "计划已更新，等待确认"
                : "计划仍需补充信息或处理门禁",
            toolCallsExecuted: 0,
          };
          if (planContinuationState === "paused") {
            await emitStatus.sendRequired(planContinuationEvent);
          } else {
            emitStatus.send(planContinuationEvent);
          }
          await persistAssistantReply({
            content: reply,
            goalEventRef: `plan-input:${plan.id}:${plan.revision}`,
            settlementStatus:
              plan.status === "awaiting_confirmation" ? "succeeded" : "paused",
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
            turnSettlementStatus:
              plan.status === "awaiting_confirmation" ? "succeeded" : "paused",
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
        await emitTerminalStreamEvent({
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
          if (options.conversationCausalStore) {
            const guidedRef = await options.conversationCausalStore.addRefs({
              requestId,
              refs: [{ kind: "guided_input", id: inputRequest.id }],
            });
            if (
              guidedRef.disposition !== "applied"
              && guidedRef.disposition !== "duplicate"
            ) {
              await emitTerminalStreamEvent({
                type: "failed",
                message: "Failed to establish guided input ownership.",
              });
              return {
                ok: false,
                code: "INTERNAL_ERROR",
                message: "Failed to establish guided input ownership.",
              };
            }
          }
          try {
            await emitStatus.sendWaitingForInput(
              inputRequest,
              "Skill input required.",
              persisted,
            );
            emitOutputPart(outputAssembler.appendInputRequest(inputRequest));
          } catch {
            await emitTerminalStreamEvent({
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
            streamSequence: emitStatus.getSequence(),
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
        requestId,
        persistAssistantReply,
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
            await emitTerminalStreamEvent({
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
        let admittedAgentRunId: string | undefined;
        const beforeAgentRunExecution: AgentRunAdmissionGate | undefined =
          options.conversationCausalStore
            ? async (candidate) => {
                if (
                  admittedAgentRunId
                  && admittedAgentRunId !== candidate.runId
                ) {
                  throw new Error("Scheduled AgentRun changed its admitted identity.");
                }
                if (candidate.sessionId !== sessionId) {
                  throw new Error("Scheduled AgentRun session admission mismatch.");
                }
                const executionRevision = candidate.executionRevision ?? 1;
                if (
                  !Number.isSafeInteger(executionRevision)
                  || executionRevision < 1
                ) {
                  throw new Error("Scheduled AgentRun execution revision is invalid.");
                }
                let linked;
                try {
                  linked = await options.conversationCausalStore!.admitAgentRun({
                    requestId,
                    runId: candidate.runId,
                    taskId: candidate.taskId,
                    sessionId,
                    executionRevision,
                  });
                } catch {
                  throw new Error("Scheduled AgentRun causal admission failed.");
                }
                if (
                  linked.disposition !== "applied"
                  && linked.disposition !== "duplicate"
                ) {
                  throw new Error("Scheduled AgentRun causal admission failed.");
                }
                admittedAgentRunId = candidate.runId;
                const started = await options.conversationCausalStore!
                  .settleAgentRunAdmission({
                    requestId,
                    runId: candidate.runId,
                    expectedExecutionRevision: executionRevision,
                    state: "started",
                  });
                if (
                  started.disposition !== "applied"
                  && started.disposition !== "duplicate"
                ) {
                  throw new Error("Scheduled AgentRun causal start failed.");
                }
                return {
                  runId: candidate.runId,
                  taskId: candidate.taskId,
                  executionRevision,
                  async settle(status, expectedExecutionRevision = executionRevision) {
                    if (expectedExecutionRevision !== executionRevision) {
                      throw new Error(
                        "Scheduled AgentRun settlement revision does not match its lease.",
                      );
                    }
                    const finalStatus =
                      status === "waiting_for_approval" ? "paused" : status;
                    if (
                      finalStatus !== "succeeded"
                      && finalStatus !== "paused"
                      && finalStatus !== "failed"
                      && finalStatus !== "canceled"
                    ) {
                      throw new Error("Scheduled AgentRun settled with a non-terminal status.");
                    }
                    const settled = await options.conversationCausalStore!
                      .settleAgentRunAdmission({
                        requestId,
                        runId: candidate.runId,
                        expectedExecutionRevision,
                        state: "settled",
                        finalStatus,
                      });
                    if (
                      settled.disposition !== "applied"
                      && settled.disposition !== "duplicate"
                    ) {
                      throw new Error("Scheduled AgentRun causal settlement failed.");
                    }
                  },
                };
              }
            : undefined;
        const taskRunResult = requestedSkill
          ? null
          : await tryRunTaskFromIntent({
              route: intentRoute,
              message: userMessage,
              sessionId,
              taskStore: options.taskStore,
              runScheduledTask: options.runScheduledTask,
              beforeExecution: beforeAgentRunExecution,
            });

        if (taskRunResult) {
          const settledRun = taskRunResult.result.executedRun;
          const executedRunId = settledRun?.id;
          if (
            options.conversationCausalStore
            && (admittedAgentRunId || executedRunId)
          ) {
            if (!executedRunId || admittedAgentRunId !== executedRunId) {
              throw new Error("Scheduled runner bypassed causal admission.");
            }
            const settledAdmission = (
              await options.conversationCausalStore.getRequest(requestId)
            )?.agentRunAdmissions?.find(
              (admission) => admission.runId === executedRunId,
            );
            const expectedFinalStatus =
              settledRun?.status === "waiting_for_approval"
                ? "paused"
                : settledRun?.status;
            if (
              settledAdmission?.state !== "settled"
              || settledAdmission.finalStatus !== expectedFinalStatus
            ) {
              throw new Error("Scheduled runner returned before causal settlement.");
            }
          }
          if (!taskRunResult.ok) {
            const failedRun = taskRunResult.result.executedRun;
            if (failedRun) {
              await emitStatus.sendRequired({
                state: failedRun.status === "canceled" ? "canceled" : "failed",
                message: taskRunResult.result.message,
                toolCallsExecuted: 0,
              });
              await persistAssistantReply({
                content: taskRunResult.result.message,
                executedRunId: failedRun.id,
                settlementStatus:
                  failedRun.status === "canceled" ? "canceled" : "failed",
                terminalType:
                  failedRun.status === "canceled" ? "canceled" : "failed",
              });
            } else {
              await emitTerminalStreamEvent({
                type: "failed",
                message: taskRunResult.result.message,
              });
            }
            return taskRunResult.result;
          }

          if (taskRunResult.result.turnSettlementStatus === "paused") {
            await emitStatus.sendRequired({
              state: "paused",
              message: taskRunResult.result.reply,
              toolCallsExecuted: 0,
            });
          }
          const assistantMessageId = await persistAssistantReply({
            content: taskRunResult.result.reply,
            executedRunId,
            settlementStatus:
              taskRunResult.result.turnSettlementStatus === "paused"
                ? "paused"
                : "succeeded",
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
        const incompleteProfile =
          error instanceof Error
          && error.message.includes("Model profile is incomplete");
        const failureMessage = incompleteProfile
          ? "模型配置不完整：请先在设置中保存 base URL、对话模型和 API Key。"
          : "无法读取模型配置，请检查设置后重试。";
        emitStatus.send({
          state: "failed",
          message: failureMessage,
        });
        if (incompleteProfile) {
          await emitTerminalStreamEvent({
            type: "failed",
            message: failureMessage,
          });
          return {
            ok: false,
            message: failureMessage,
          };
        }

        await emitTerminalStreamEvent({
          type: "failed",
          message: failureMessage,
        });
        return {
          ok: false,
          message: failureMessage,
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
          const parentEvidenceRunId = continuationToResume?.evidenceRunId;
          const evidence = createChatAgentEvidenceRecorder({
            trajectoryStore: options.trajectoryStore,
            ...(agentRunContext ? { runContext: agentRunContext } : {}),
            createId,
            now: options.now,
          });
          await options.conversationCausalStore?.addRefs({
            requestId,
            refs: [{ kind: "trajectory_run", id: evidence.runId }],
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
              ...(parentEvidenceRunId
                ? {
                    checkpointId: parentEvidenceRunId,
                    boundaryId: requestId,
                  }
                : {}),
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
          const runtimeContextEvidence = await evidence.append(
            "run_context_created",
            {
              runtimeContextSnapshot,
              runtimeContextSnapshotSummary,
              ...(parentEvidenceRunId
                ? {
                    continuationLineage: {
                      parentEvidenceRunId,
                      continuationRequestId: requestId,
                    },
                  }
                : {}),
            },
            {
              containsApiKey: false,
              containsFileContent: false,
              containsUserText: false,
            },
          );
          if (runtimeContextEvidence) {
            await options.conversationCausalStore?.addRefs({
              requestId,
              refs: [{
                kind: "trajectory_event",
                runId: evidence.runId,
                eventId: runtimeContextEvidence.id,
              }],
            });
          }
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
              toolResultContinuationOwnerId: `chat:${sessionId}`,
              requestId,
              ...(workspaceRunRecorder?.workspaceRunId
                ? { workspaceRunId: workspaceRunRecorder.workspaceRunId }
                : {}),
              ...(options.compactionStrategy
                ? { compactionStrategy: options.compactionStrategy }
                : {}),
              pauseOnTurnLimit: false,
              pauseOnFailureLoop: true,
              autoContinueOutputLimit: true,
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
                      } catch (error) {
                        throwIfResponseBodyLimitError(error);
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
              async onModelAttempt(event) {
                if (!options.conversationCausalStore) {
                  if (
                    event.operation === "supersede"
                    || event.operation === "reset"
                  ) {
                    outputAssembler.resetText();
                    accumulatedReasoningProjection = "";
                  }
                  currentCausalAttempt = event.attempt;
                  emitStatus.sendAttemptControl(event);
                  return;
                }
                if (event.operation === "supersede") {
                  const settled = await options.conversationCausalStore.settleAttempt({
                    requestId,
                    attempt: event.supersedesAttempt,
                    state: "superseded",
                    supersedesAttempt: event.supersedesAttempt,
                  });
                  if (
                    settled.disposition !== "applied"
                    && settled.disposition !== "duplicate"
                  ) {
                    throw new Error("Conversation retry supersede conflicted.");
                  }
                  outputAssembler.resetText();
                  accumulatedReasoningProjection = "";
                  currentCausalAttempt = event.attempt;
                  emitStatus.sendAttemptControl(event);
                  return;
                }
                if (event.operation === "reset") {
                  const settled = await options.conversationCausalStore.settleAttempt({
                    requestId,
                    attempt: event.attempt,
                    state: "reset",
                  });
                  if (
                    settled.disposition !== "applied"
                    && settled.disposition !== "duplicate"
                  ) {
                    throw new Error("Conversation attempt reset conflicted.");
                  }
                  outputAssembler.resetText();
                  accumulatedReasoningProjection = "";
                  emitStatus.sendAttemptControl(event);
                  return;
                }
                const begun = await options.conversationCausalStore.beginAttempt({
                  requestId,
                  attempt: event.attempt,
                });
                if (begun.disposition !== "applied" && begun.disposition !== "duplicate") {
                  throw new Error("Conversation retry begin conflicted.");
                }
                currentCausalAttempt = event.attempt;
                emitStatus.sendAttemptControl(event);
              },
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
                accumulatedReasoningProjection += reasoningContent;
              },
              onModelStreamEvent(event) {
                emitModelStreamEvent(emitStatus, outputAssembler, event);
              },
              onToolCall(toolName, args, event) {
                if (toolName === "actor") {
                  actorToolTasks.set(
                    event.toolCallId,
                    redactCredentialString(
                      readToolArgString(args, "task") || "subagent",
                    ),
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
                  content:
                    `Tool call ${toolName}: ` +
                    truncateHistoryContent(
                      stringifyRedactedCredentials(args),
                    ),
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
              async onToolInvocation(record) {
                if (options.conversationCausalStore) {
                  const causalRefWrite = await options.conversationCausalStore.addRefs({
                    requestId,
                    refs: [
                      {
                        kind: "tool_invocation",
                        runId: record.runId,
                        id: record.id,
                      },
                      ...(record.approvalId
                        ? [{ kind: "approval" as const, id: record.approvalId }]
                        : []),
                    ],
                  });
                  if (
                    causalRefWrite.disposition !== "applied"
                    && causalRefWrite.disposition !== "duplicate"
                  ) {
                    throw new Error(
                      "Tool Invocation requires durable causal references before dispatch.",
                    );
                  }
                }
                await evidence.append("tool_invocation", {
                  toolInvocationId: record.id,
                  toolCallId: record.toolCallId,
                  toolName: record.toolName,
                  toolSource: record.source,
                  invocationStatus: record.status,
                  ...(record.approvalId ? { approvalId: record.approvalId } : {}),
                  args: record.args,
                  ...(typeof record.ok === "boolean" ? { ok: record.ok } : {}),
                  ...(record.resultRef ? { resultRef: record.resultRef } : {}),
                  ...(record.error ? { error: record.error } : {}),
                  history: record.history,
                });
                const invocationStatusEvent = {
                  state: "tool_invocation",
                  message: `工具状态：${record.toolName} ${record.status}`,
                  toolInvocationId: record.id,
                  ...(record.approvalId ? { approvalId: record.approvalId } : {}),
                  toolCallId: record.toolCallId,
                  toolName: record.toolName,
                  toolSource: record.source,
                  invocationStatus: record.status,
                  ...(record.resultRef ? { resultRef: record.resultRef } : {}),
                  ...(typeof record.ok === "boolean" ? { ok: record.ok } : {}),
                  toolCallsExecuted: observedToolCallsExecuted,
                } as const;
                if (record.status === "waiting_approval") {
                  await emitStatus.sendRequired(invocationStatusEvent);
                } else {
                  emitStatus.send(invocationStatusEvent);
                }
                if (record.status === "waiting_approval") {
                  emitOutputPart(
                    outputAssembler.appendApprovalRequest({
                      approvalId: record.approvalId ?? record.id,
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
                  const safeTask = redactCredentialString(runtimeEvent.task);
                  actorToolTasks.set(event.toolCallId, safeTask);
                  emitActorSpawnedStatusEvent({
                    emitStatus,
                    actorId: runtimeEvent.actorId,
                    task: safeTask,
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
                  content:
                    `Tool result ${toolName}: ${ok ? "ok" : "error"} ` +
                    truncateHistoryContent(
                      stringifyRedactedCredentials(result),
                    ),
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
          if (accumulatedReasoningProjection) {
            emitStatus.send({
              state: "reasoning",
              message: normalizeReasoningForStatus(
                accumulatedReasoningProjection,
              ),
              toolCallsExecuted: observedToolCallsExecuted,
            });
          }
          reply = outputAssembler.setFinalText(loopResult.summary)?.text
            ?? redactCredentialString(loopResult.summary);
          const finalToolCallsExecuted = Math.max(
            loopResult.toolCallsExecuted,
            observedToolCallsExecuted,
          );
          toolCallsUsed = finalToolCallsExecuted;
          accumulatedUsage = reconcileAgentLoopTokenUsage(
            accumulatedUsage,
            loopResult.tokensConsumed,
          );
          const finalSummaryEvidence = await evidence.append("final_summary", {
            status: loopResult.status,
            toolCallsExecuted: finalToolCallsExecuted,
          });
          await evidence.drain();
          if (finalSummaryEvidence) {
            await options.conversationCausalStore?.addRefs({
              requestId,
              refs: [{
                kind: "trajectory_event",
                runId: evidence.runId,
                eventId: finalSummaryEvidence.id,
              }],
            });
          }

          if (loopResult.status === "canceled") {
            emitStatus.send({
              state: "canceled",
              message: "任务已中断",
              toolCallsExecuted: loopResult.toolCallsExecuted,
            });
            await emitTerminalStreamEvent({
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
              message: redactCredentialString(loopResult.summary),
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
              message: redactCredentialString(loopResult.summary),
            };
            await emitStatus.sendRequired({
              state: "failed",
              message: formatAgentLoopFailure(
                redactCredentialString(loopResult.summary),
              ),
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
            await emitTerminalStreamEvent({
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
          const failureMessage = toSecretSafeFailure(
            error,
            "AGENT_RUN_EXECUTION_FAILED",
          ).publicMessage;
          const publishFailureStatus = error instanceof RequiredConversationSettlementError
            ? emitStatus.sendPublishedOnly
            : emitStatus.send;
          publishFailureStatus({
            state: "failed",
            message: failureMessage,
          });
          await emitTerminalStreamEvent({
            type: "failed",
            message: failureMessage,
          });
          return {
            ok: false,
            ...(error instanceof RequiredConversationSettlementError
              ? { code: "INTERNAL_ERROR" as const }
              : {}),
            message: failureMessage,
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
          reply = redactCredentialString(response.content ?? "");
          if (response.modelServiceNotice) {
            const notice = sanitizeModelServiceNotice(
              response.modelServiceNotice,
            );
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
            await emitTerminalStreamEvent({
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
            const failureMessage = toSecretSafeFailure(
              error,
              "INTERNAL_FAILURE",
            ).publicMessage;
            const publishFailureStatus = error instanceof RequiredConversationSettlementError
              ? emitStatus.sendPublishedOnly
              : emitStatus.send;
            publishFailureStatus({
              state: "failed",
              message: failureMessage,
            });
            await emitTerminalStreamEvent({
              type: "failed",
              message: failureMessage,
            });
            return {
              ok: false,
              ...(error instanceof RequiredConversationSettlementError
                ? { code: "INTERNAL_ERROR" as const }
                : {}),
              message: failureMessage,
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

      reply = redactCredentialString(reply);
      const assistantMessageId = await persistAssistantReply({
        content: reply,
        relatedMemoryIds: relatedMemoryResults.map((result) => result.record.id),
        settlementStatus:
          agentStatus?.state === "paused"
            ? "paused"
            : agentStatus?.state === "failed"
              ? "failed"
              : "succeeded",
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
        turnSettlementStatus:
          agentStatus?.state === "paused"
            ? "paused"
            : agentStatus?.state === "failed"
              ? "failed"
              : "succeeded",
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

  async function executeMessageWithKernel(
    input: SendChatMessageInput,
    runtimeOptions: SendChatMessageRuntimeOptions,
    internalOptions: ChatTurnInternalOptions,
  ): Promise<SendChatMessageResult> {
    const preparation = await prepareChatMessageInput(
      input,
      runtimeOptions,
    );
    if (!preparation.ok) {
      return preparation.result;
    }
    if (runtimeOptions.signal?.aborted) {
      return {
        ok: false,
        code: "CANCELED",
        retryable: true,
        message: "已中断任务。",
      };
    }
    if (!options.productionKernelDriver) {
      const publicationAuthority =
        internalOptions.publicationAuthority ?? createChatPublicationAuthority();
      let result: SendChatMessageResult;
      try {
        result = await executeMessageInternal(
          input,
          runtimeOptions,
          {
            ...internalOptions,
            preparedInput: preparation.value,
            publicationAuthority,
          },
        );
      } catch (error) {
        if (!(error instanceof AssistantAcceptanceRecoveryRequiredError)) {
          throw error;
        }
        result = error.result;
      }
      return result.ok
        ? {
            ...result,
            domainStateAvailable:
              result.domainStateAvailable === false
                ? false
                : publicationAuthority.domainStateAvailable(),
          }
        : result;
    }

    const requestId =
      input.requestId ?? `request_${getNowMs(options.now)}`;
    const normalizedInput = { ...input, requestId };
    const runId = createChatKernelRunId(requestId);
    const requestClaim: ChatRequestClaim | null = (
      internalOptions.skipUserMessageAppend
      && options.conversationCausalStore
    )
      ? await options.conversationCausalStore.getRequest(requestId).then(
          (record): ChatRequestClaim =>
            record
              ? { disposition: "duplicate", value: record }
              : { disposition: "not_found" },
        )
      : await claimChatRequest({
          requestId,
          turnId: createConversationTurnId(requestId),
          messageInput: normalizedInput,
          preparedInput: preparation.value,
          createdAt: new Date(getNowMs(options.now)).toISOString(),
        });
    const claimedRecord = requestClaim?.value;
    const claimedBinding = resolveDurableConversationBinding(claimedRecord);
    const latestClaimAttempt = claimedRecord?.attempts.at(-1);

    if (requestClaim?.disposition === "conflict") {
      return {
        ok: false,
        code: "CONFLICT",
        message: "相同 requestId 已绑定到不同输入，未改变原请求状态。",
      };
    }
    if (requestClaim && !claimedRecord) {
      return {
        ok: false,
        code: "CONFLICT",
        message: "请求归属无法确认，未开始执行。",
      };
    }
    if (options.conversationCausalStore && !options.chatSessionStore) {
      return {
        ok: false,
        code: "CONFLICT",
        retryable: true,
        message: "Chat persistence is unavailable, so execution was not admitted.",
      };
    }
    if (requestClaim?.disposition === "duplicate" && !claimedBinding) {
      return {
        ok: false,
        code: "CONFLICT",
        retryable: true,
        message: claimedRecord?.sessionId
          ? "旧版请求缺少持久化用户消息证明，请使用新的 requestId 重新发送。"
          : "相同请求仍在处理中，未启动第二次执行。",
      };
    }
    if (
      requestClaim?.disposition === "duplicate"
      && internalOptions.skipUserMessageAppend
      && (
        !claimedBinding
        || claimedBinding.sessionId !== normalizedInput.sessionId
        || claimedBinding.userMessageId !== internalOptions.userMessageId
      )
    ) {
      return {
        ok: false,
        code: "CONFLICT",
        message: "引导输入与原请求的持久化归属不一致，未恢复执行。",
      };
    }
    if (
      requestClaim?.disposition === "duplicate"
      && !internalOptions.skipUserMessageAppend
    ) {
      const durableReplayTurn =
        claimedBinding && options.chatSessionStore?.get
          ? await findPersistedRequestTurn(
              options.chatSessionStore,
              claimedBinding.sessionId,
              requestId,
            )
          : null;
      if (
        latestClaimAttempt?.state === "accepted"
        || Boolean(durableReplayTurn?.assistant)
      ) {
        const replayAuthority = createChatPublicationAuthority();
        if (claimedBinding) {
          replayAuthority.markDurable(
            claimedBinding.sessionId,
            claimedBinding.userMessageId,
          );
        }
        let replayResult: SendChatMessageResult;
        try {
          replayResult = await executeMessageInternal(normalizedInput, runtimeOptions, {
            ...internalOptions,
            preparedInput: preparation.value,
            requestClaim,
            publicationAuthority: replayAuthority,
          });
        } catch (error) {
          if (!(error instanceof AssistantAcceptanceRecoveryRequiredError)) {
            throw error;
          }
          replayResult = error.result;
        }
        return replayResult.ok
          ? {
              ...replayResult,
              domainStateAvailable:
                replayResult.domainStateAvailable === false
                  ? false
                  : replayAuthority.domainStateAvailable(),
            }
          : replayResult;
      }
      return {
        ok: false,
        code: "CONFLICT",
        retryable: true,
        message: "相同请求仍在处理中，未启动第二次执行。",
      };
    }
    if (options.conversationCausalStore) {
      const refMutation = await options.conversationCausalStore.addRefs({
        requestId,
        refs: [{ kind: "kernel_run", id: runId }],
      });
      if (
        refMutation.disposition !== "applied"
        && refMutation.disposition !== "duplicate"
      ) {
        throw new Error(
          "Chat Kernel admission requires a durable causal run reference.",
        );
      }
    }

    const publicationAuthority = createChatPublicationAuthority();
    let kernelWorkspaceRunRecorder: ChatWorkspaceRunRecorder | null = null;
    const preparedInternalOptions: ChatTurnInternalOptions = {
      ...internalOptions,
      preparedInput: preparation.value,
      requestClaim,
      publicationAuthority,
      onDurableSessionResolved(sessionId) {
        internalOptions.onDurableSessionResolved?.(sessionId);
      },
      onDomainStateUnavailable() {
        internalOptions.onDomainStateUnavailable?.();
        publicationAuthority.invalidate("domain_state_unavailable");
      },
      onWorkspaceRunRecorderResolved(recorder) {
        kernelWorkspaceRunRecorder = recorder;
        internalOptions.onWorkspaceRunRecorderResolved?.(recorder);
      },
    };

    const terminalEvents: Array<
      Extract<
        ChatStreamEvent,
        { type: "completed" | "failed" | "canceled" }
      >
    > = [];
    let bufferedTerminalStatusEvents: ChatTaskStatusEvent[] = [];
    let publishedTerminalEvent = false;
    let lastStreamEvent: ChatStreamEvent | undefined;
    let lastStatusEvent: ChatTaskStatusEvent | undefined;
    const isTerminalStatusEvent = (event: ChatTaskStatusEvent) =>
      event.state === "completed"
      || event.state === "failed"
      || event.state === "canceled";
    const publishStatusObserver = (event: ChatTaskStatusEvent) => {
      try {
        runtimeOptions.onStatusEvent?.(event);
      } catch {
        // User observers are not part of Kernel settlement.
      }
      try {
        runtimeOptions.onStreamEvent?.({
          type: "status",
          status: event,
          sessionId: event.sessionId,
          requestId: event.requestId ?? requestId,
          sequence: event.sequence ?? 0,
          turnId: event.turnId ?? createConversationTurnId(requestId),
          createdAt: event.createdAt,
          domainStateAvailable: event.domainStateAvailable === true,
        });
      } catch {
        // User observers are not part of Kernel settlement.
      }
    };
    const publishTerminalObserver = (
      event: Extract<ChatStreamEvent, { type: "completed" | "failed" | "canceled" }>,
    ) => {
      if (publishedTerminalEvent) return;
      publishedTerminalEvent = true;
      try {
        runtimeOptions.onStreamEvent?.(event);
      } catch {
        // User observers are not part of Kernel settlement.
      }
    };
    const wrappedRuntimeOptions: SendChatMessageRuntimeOptions = {
      ...runtimeOptions,
      onStatusEvent(event) {
        lastStatusEvent = event;
        if (isTerminalStatusEvent(event)) {
          bufferedTerminalStatusEvents.push(event);
          return;
        }
        publishStatusObserver(event);
      },
      onStreamEvent(event) {
        lastStreamEvent = event;
        if (event.type === "status" && isTerminalStatusEvent(event.status)) {
          return;
        }
        if (
          event.type === "completed" ||
          event.type === "failed" ||
          event.type === "canceled"
        ) {
          terminalEvents.push(event);
          return;
        }
        try {
          runtimeOptions.onStreamEvent?.(event);
        } catch {
          // User observers are not part of Kernel settlement.
        }
      },
    };
    const persistTerminalActivity = async (
      status: "paused" | "failed" | "canceled",
      message: string,
      sessionId: string | undefined,
    ): Promise<ChatTaskStatusEvent | null> => {
      if (!sessionId) return null;
      if (!options.chatSessionStore?.appendActivityEvent) {
        throw new Error(
          "Chat Kernel terminal activity persistence is unavailable.",
        );
      }
      const persistedSession = options.chatSessionStore.get
        ? await options.chatSessionStore.get(sessionId)
        : null;
      const causalRecord = options.conversationCausalStore
        ? await options.conversationCausalStore.getRequest(requestId)
        : null;
      const binding = resolveDurableConversationBinding(causalRecord);
      if (options.conversationCausalStore && binding?.sessionId !== sessionId) {
        throw new Error(
          "Chat Kernel terminal settlement lacks an exact durable binding.",
        );
      }
      const existingEvent = [
        ...(persistedSession?.activity?.statusEvents ?? []),
      ].reverse().find(
        (event) => event.requestId === requestId && event.state === status,
      );
      if (existingEvent) {
        if (!options.conversationCausalStore) return existingEvent;
        const existingSettlement = causalRecord?.requiredSettlements?.find(
          (candidate) =>
            candidate.id === existingEvent.settlementId
            && candidate.state === "committed"
            && Boolean(candidate.preparedChatEventFingerprint)
            && candidate.chatEventFingerprint
              === candidate.preparedChatEventFingerprint
            && createRequiredChatEventFingerprint(existingEvent)
              === candidate.preparedChatEventFingerprint,
        );
        if (existingSettlement) return existingEvent;
      }
      const activeAttempt = [...(causalRecord?.attempts ?? [])].reverse().find(
        (attempt) => attempt.state === "active",
      );
      if (options.conversationCausalStore && !activeAttempt) {
        throw new Error(
          "Chat Kernel terminal settlement lacks an active causal attempt.",
        );
      }
      const persistedSequence = persistedSession?.activity?.statusEvents.reduce(
        (highest, event) =>
          event.requestId === requestId
            ? Math.max(highest, event.sequence ?? 0)
            : highest,
        0,
      ) ?? 0;
      const event: ChatTaskStatusEvent = {
        sessionId,
        requestId,
        turnId:
          lastStatusEvent?.turnId
          ?? lastStreamEvent?.turnId
          ?? createConversationTurnId(requestId),
        sequence: Math.max(
          persistedSequence,
          lastStatusEvent?.sequence ?? 0,
          lastStreamEvent?.sequence ?? 0,
        ) + 1,
        state: status,
        message,
        createdAt: new Date(getNowMs(options.now)).toISOString(),
        elapsedMs: 0,
        domainStateAvailable: true,
      };
      await persistRequiredConversationSettlement({
        requestId,
        attempt: activeAttempt?.attempt ?? 1,
        event,
        chatSessionStore: options.chatSessionStore,
        conversationCausalStore: options.conversationCausalStore,
        workspaceRunRecorder: kernelWorkspaceRunRecorder,
        workspaceUnavailableReasonCode: "workspace_run_unavailable",
        failureReasonCode: "kernel_terminal_settlement_failed",
      });
      return event;
    };

    const stageSyntheticTerminal = (
      type: "completed" | "failed" | "canceled",
      message: string,
      sessionId: string | undefined,
    ) => {
      const event: Extract<
        ChatStreamEvent,
        { type: "completed" | "failed" | "canceled" }
      > = {
        type,
        sessionId:
          sessionId
          ?? lastStatusEvent?.sessionId
          ?? lastStreamEvent?.sessionId
          ?? normalizedInput.sessionId
          ?? `runtime_${runId}`,
        requestId,
        sequence: (lastStreamEvent?.sequence ?? 0) + 1,
        turnId: lastStreamEvent?.turnId ?? `turn-${requestId}`,
        createdAt: new Date(getNowMs(options.now)).toISOString(),
        message,
        domainStateAvailable: Boolean(sessionId),
      };
      terminalEvents.push(event);
      lastStreamEvent = event;
      return event;
    };

    const settleResult = async (
      result: SendChatMessageResult,
    ): Promise<ChatKernelSettlement<SendChatMessageResult>> => {
      const terminalBeforeSettlement = terminalEvents.at(-1);
      const status = toChatKernelStatus(
        result,
        terminalBeforeSettlement,
        lastStatusEvent,
      );
      const message = result.ok ? result.reply : result.message;
      const sessionId = publicationAuthority.durableSessionId();
      if (terminalEvents.length === 0) {
        stageSyntheticTerminal(
          status === "failed"
            ? "failed"
            : status === "canceled"
              ? "canceled"
              : "completed",
          message,
          sessionId,
        );
      }
      const terminal = terminalEvents.at(-1)!;
      const needsTerminalActivity =
        status === "failed" || status === "canceled";
      const terminalActivityEvent = needsTerminalActivity
        ? await persistTerminalActivity(status, message, sessionId)
        : null;
      if (needsTerminalActivity && !terminalActivityEvent) {
        throw new SecretSafeFailureError("SETTLEMENT_COMPENSATION_INCOMPLETE");
      }
      const assistantMessageId = terminal.finalMessageId?.trim();

      if (terminalActivityEvent) {
        bufferedTerminalStatusEvents = [];
        publishStatusObserver(terminalActivityEvent);
      } else {
        const publishableStatusEvents = result.turnSettlementStatus === "unknown"
          ? bufferedTerminalStatusEvents.splice(0).filter((event) =>
              event.state !== "completed"
              && event.state !== "failed"
              && event.state !== "canceled",
            )
          : bufferedTerminalStatusEvents.splice(0);
        for (const event of publishableStatusEvents) {
          publishStatusObserver(event);
        }
      }
      publishTerminalObserver(terminal);

      return {
        status,
        summary: message,
        result,
        persistence: {
          requiredStatePersisted: true,
          ...(assistantMessageId ? { assistantMessageId } : {}),
          ...(status === "paused"
            ? result.turnSettlementStatus === "unknown"
              ? { reconciliationRequired: true as const }
              : { continuationPersisted: true as const }
            : {}),
          ...(terminalActivityEvent
            ? { terminalActivityPersisted: true as const }
            : {}),
          ...(!sessionId && !requestClaim && !options.conversationCausalStore
            ? { noDomainStateCreated: true as const }
            : {}),
        },
        streamTerminals: [terminal],
      };
    };

    const outcome = await runChatKernelSegment<SendChatMessageResult>({
      driver: options.productionKernelDriver,
      runId,
      async execute() {
        try {
          return settleResult(
            await executeMessageInternal(
              normalizedInput,
              wrappedRuntimeOptions,
              preparedInternalOptions,
            ),
          );
        } catch (error) {
          if (!(error instanceof AssistantAcceptanceRecoveryRequiredError)) {
            throw error;
          }
          return settleResult(error.result);
        }
      },
      async settleAborted() {
        throw new Error(
          "Chat Kernel wrapper does not own surface cancellation.",
        );
      },
      async settleFailed(error) {
        let failure = toSecretSafeFailure(error, "INTERNAL_FAILURE");
        let sessionId = publicationAuthority.durableSessionId();
        let terminalActivityEvent: ChatTaskStatusEvent | null = null;
        try {
          terminalActivityEvent = await persistTerminalActivity(
            failure.terminal,
            failure.publicMessage,
            sessionId,
          );
        } catch {
          publicationAuthority.invalidate("kernel_failure_activity_write_failed");
          internalOptions.onDomainStateUnavailable?.();
          failure = toSecretSafeFailure(
            new SecretSafeFailureError("SETTLEMENT_COMPENSATION_INCOMPLETE"),
          );
          await options.conversationCausalStore?.addRefs({
            requestId,
            refs: [],
            coverage: {
              state: "degraded",
              reasonCodes: [...failure.coverageReasonCodes],
            },
          }).catch(() => undefined);
        }
        terminalEvents.length = 0;
        bufferedTerminalStatusEvents = [];
        const safeTerminal = stageSyntheticTerminal(
          failure.terminal,
          failure.publicMessage,
          terminalActivityEvent ? sessionId : undefined,
        );
        if (terminalActivityEvent) {
          publishStatusObserver(terminalActivityEvent);
        } else {
          publishStatusObserver({
            sessionId:
              lastStatusEvent?.sessionId
              ?? normalizedInput.sessionId
              ?? `runtime_${runId}`,
            requestId,
            turnId: lastStatusEvent?.turnId ?? createConversationTurnId(requestId),
            sequence: Math.max(lastStatusEvent?.sequence ?? 0, safeTerminal.sequence),
            state: "failed",
            message: failure.publicMessage,
            createdAt: safeTerminal.createdAt,
            elapsedMs: 0,
            domainStateAvailable: false,
          });
        }
        publishTerminalObserver(safeTerminal);
        return {
          status: "failed",
          summary: failure.publicMessage,
          failure,
          result: {
            ok: false as const,
            code: "INTERNAL_ERROR" as const,
            retryable: failure.retryable,
            message: failure.publicMessage,
          },
          persistence: {
            ...(terminalActivityEvent
              ? {
                  requiredStatePersisted: true as const,
                  terminalActivityPersisted: true as const,
                }
              : {
                  requiredStatePersisted: false as const,
                  settlementRecoveryRequired: true as const,
                  settlementFailureCode: failure.code,
                }),
          },
          streamTerminals: [terminalEvents.at(-1)!],
        };
      },
    });
    return outcome.settlement.result.ok
      ? {
          ...outcome.settlement.result,
          domainStateAvailable:
            outcome.settlement.result.domainStateAvailable === false
              ? false
              : publicationAuthority.domainStateAvailable(),
        }
      : outcome.settlement.result;
  }

  async function sendMessageInternal(
    input: SendChatMessageInput,
    runtimeOptions: SendChatMessageRuntimeOptions = {},
    internalOptions: ChatTurnInternalOptions = {},
  ): Promise<SendChatMessageResult> {
    const sessionKey = input.sessionId?.trim();
    if (!sessionKey) {
      return executeMessageWithKernel(input, runtimeOptions, internalOptions);
    }

    const previous = processChatSessionRequestTails.get(sessionKey)
      ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => gate);
    processChatSessionRequestTails.set(sessionKey, tail);
    try {
      const ready = await waitForTurnOrAbort(previous, runtimeOptions.signal);
      if (!ready) {
        return { ok: false, code: "CANCELED", retryable: true, message: "已中断任务。" };
      }
      return await executeMessageWithKernel(
        input,
        runtimeOptions,
        internalOptions,
      );
    } finally {
      release();
      void tail.finally(() => {
        if (processChatSessionRequestTails.get(sessionKey) === tail) {
          processChatSessionRequestTails.delete(sessionKey);
        }
      });
    }
  }

  async function respondSkillInputOnce(
    input: SkillInputResponse,
    runtimeOptions: SendChatMessageRuntimeOptions,
  ): Promise<SkillInputResponseResult> {
    prunePendingAttachmentPayloads(getNowMs(options.now));
    const cachedPending = pendingSkillInputRequests.get(input.inputRequestId);
    const pending =
      cachedPending ?? (await recoverPendingSkillInputState(input.inputRequestId));
    if (!pending) {
      return {
        ok: false,
        code: "UNKNOWN_SKILL_INPUT",
        message: "Unknown skill input request.",
      };
    }
    if (
      options.conversationCausalStore
      && !(await hasDurableGuidedInputOwnership(pending.persisted))
    ) {
      pendingSkillInputRequests.delete(input.inputRequestId);
      return {
        ok: false,
        code: "CONFLICT",
        message: "Guided input ownership could not be verified.",
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
      const expiryAttempt = await ensureGuidedInputCausalAttempt(
        pending.persisted,
      );
      if (!expiryAttempt) {
        pendingSkillInputRequests.delete(input.inputRequestId);
        return {
          ok: false,
          code: "CONFLICT",
          message: "Guided input expiration could not be settled.",
          domainStateAvailable: false,
        };
      }
      try {
        await markPersistedSkillInputCanceled(pending, expiryAttempt);
      } catch {
        return {
          ok: false,
          message: "Failed to persist skill input retirement.",
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
      const guidedAttempt = await ensureGuidedInputCausalAttempt(pending.persisted);
      if (!guidedAttempt) {
        pendingSkillInputRequests.delete(input.inputRequestId);
        return {
          ok: false,
          code: "CONFLICT",
          message: "Guided input attempt could not be admitted.",
          domainStateAvailable: false,
        };
      }
      const admittedGuidedAttempt = guidedAttempt;
      const guidedPublicationAuthority = createChatPublicationAuthority();
      if (
        !pending.userMessageId
        || !guidedPublicationAuthority.markDurable(
          pending.sessionId,
          pending.userMessageId,
        )
      ) {
        pendingSkillInputRequests.delete(input.inputRequestId);
        return {
          ok: false,
          code: "CONFLICT",
          message: "Guided input durable publication could not be established.",
          domainStateAvailable: false,
        };
      }
      const skillWorkspaceRunRecorder = pending.runContext
        ? await createChatWorkspaceRunRecorder({
            workspaceRunStore: options.workspaceRunStore,
            sessionId: pending.sessionId,
            requestId: pending.requestId,
            runContext: pending.runContext,
            selectedSkillName: pending.selectedSkill.manifest.name,
            createdAt: inputRequest.createdAt,
          })
        : null;
      const guidedRefs = await options.conversationCausalStore?.addRefs({
        requestId: pending.requestId,
        refs: [
          { kind: "guided_input", id: inputRequest.id },
          ...(skillWorkspaceRunRecorder
            ? [{
                kind: "workspace_run" as const,
                id: skillWorkspaceRunRecorder.workspaceRunId,
              }]
            : []),
        ],
        ...(!skillWorkspaceRunRecorder
          ? {
              coverage: {
                state: "partial" as const,
                reasonCodes: ["guided_input_workspace_run_unavailable"],
              },
            }
          : {}),
      });
      if (
        guidedRefs
        && guidedRefs.disposition !== "applied"
        && guidedRefs.disposition !== "duplicate"
      ) {
        guidedPublicationAuthority.invalidate("guided_input_ref_conflict");
        pendingSkillInputRequests.delete(input.inputRequestId);
        return {
          ok: false,
          code: "CONFLICT",
          message: "Guided input references could not be established.",
          domainStateAvailable: false,
        };
      }
      const guidedInputRequestId = pending.requestId;
      async function persistGuidedInputStatus(
        event: ChatTaskStatusEvent,
        required: boolean,
      ) {
        if (!required) {
          await options.chatSessionStore?.appendActivityEvent?.(event.sessionId, event);
          if (skillWorkspaceRunRecorder) {
            await skillWorkspaceRunRecorder.appendStatusEvent(event);
          }
          return;
        }
        try {
          await persistRequiredConversationSettlement({
            requestId: guidedInputRequestId,
            attempt: admittedGuidedAttempt,
            event,
            chatSessionStore: options.chatSessionStore,
            conversationCausalStore: options.conversationCausalStore,
            workspaceRunRecorder: skillWorkspaceRunRecorder,
            workspaceUnavailableReasonCode:
              "guided_input_workspace_run_unavailable",
            failureReasonCode: "guided_input_required_settlement_failed",
          });
        } catch (error) {
          const targetState = toRequiredSettlementTarget(event);
          const settlementId = event.settlementId ?? (
            targetState
              ? createRequiredSettlementId({
                  requestId: guidedInputRequestId,
                  attempt: admittedGuidedAttempt,
                  sourceSequence: event.sequence ?? 0,
                  targetState,
                })
              : `required_settlement_unavailable_${guidedInputRequestId}`
          );
          const failedPending = event.pendingSkillInput
            ? {
                ...event.pendingSkillInput,
                status: "failed" as const,
                settlementId,
                attachmentPayloads: undefined,
              }
            : undefined;
          const tombstone: ChatTaskStatusEvent = {
            ...event,
            settlementId: `${settlementId}:tombstone`,
            state: "failed",
            message: "Guided input settlement failed.",
            ...(failedPending ? { pendingSkillInput: failedPending } : {}),
          };
          await persistRequiredChatActivityEvent(
            options.chatSessionStore,
            tombstone,
          ).catch(() => undefined);
          await skillWorkspaceRunRecorder?.appendStatusEvent(tombstone).catch(() => undefined);
          await options.conversationCausalStore?.settleAttempt({
            requestId: guidedInputRequestId,
            attempt: admittedGuidedAttempt,
            state: "interrupted",
          }).catch(() => undefined);
          await options.conversationCausalStore?.addRefs({
            requestId: guidedInputRequestId,
            refs: [],
            coverage: {
              state: "degraded",
              reasonCodes: ["guided_input_required_settlement_failed"],
            },
          }).catch(() => undefined);
          guidedPublicationAuthority.invalidate("guided_input_required_settlement_failed");
          pendingSkillInputRequests.delete(input.inputRequestId);
          throw new SecretSafeFailureError(
            error instanceof RequiredConversationSettlementError
              ? error.failureCode
              : "CROSS_DOMAIN_SETTLEMENT_FAILED",
            error,
          );
        }
      }
      const emitStatus = createChatStatusEmitter({
        sessionId: pending.sessionId,
        requestId: pending.requestId,
        startedAtMs: getNowMs(options.now),
        initialSequence: pending.streamSequence,
        now: options.now,
        onStatusEvent: runtimeOptions.onStatusEvent,
        onStreamEvent: runtimeOptions.onStreamEvent,
        getDomainStateAvailable: () =>
          guidedPublicationAuthority.domainStateAvailable(),
        onPersistEvent(event) {
          return persistGuidedInputStatus(event, false);
        },
        async onRequiredPersistEvent(event) {
          await persistGuidedInputStatus(event, true);
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
        guidedPublicationAuthority.invalidate("guided_input_publish_failed");
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
        streamSequence: emitStatus.getSequence(),
      });
      return {
        ok: false,
        code: "SKILL_INPUT_REQUIRED",
        message: "Skill input required.",
      };
    }

    const executionAttempt = await ensureGuidedInputCausalAttempt(pending.persisted);
    if (!executionAttempt) {
      pendingSkillInputRequests.delete(input.inputRequestId);
      return {
        ok: false,
        code: "CONFLICT",
        message: "Guided input execution could not be admitted.",
        domainStateAvailable: false,
      };
    }
    try {
      await markPersistedSkillInputProcessing(pending, executionAttempt);
    } catch {
      return {
        ok: false,
        message: "Failed to persist skill input processing claim.",
      };
    }
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
        initialStreamSequence: pending.streamSequence,
      },
    );
    pendingSkillInputRequests.delete(input.inputRequestId);
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

