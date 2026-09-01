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
  normalizeChatTaskStatusEventForPersistence,
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
  StreamEvent as ModelStreamEvent,
} from "./openAiCompatibleClient";
import type { ScheduledTaskStore } from "./taskStore";
import type {
  RuntimeToolAuthorizationTask,
  ToolAuthorizationService,
} from "./toolAuthorizationService";
import {
  sanitizeSkillUserInputRequest,
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
  redactCredentials,
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

function createChatRequestClaimPayload(
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

type CachedHistoryAttachmentPayload = {
  input: ChatAttachmentInput;
  lastAccessedAtMs: number;
};

// Electron enforces one main-process instance. Keep the per-session turn
// authority at process scope so independently constructed service adapters
// cannot concurrently consume the same persisted continuation.
const processChatSessionRequestTails = new Map<string, Promise<void>>();

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

type PreparedChatMessageInput = {
  processedAttachments: ProcessedChatAttachments;
  userMessage: string;
  modelUserMessage: string;
  hasAttachments: boolean;
  preexistingInputRoutingPlan: PlanRecord | null;
};

type ChatRequestClaim = Awaited<
  ReturnType<ConversationCausalStore["claimRequest"]>
>;

type ChatTurnInternalOptions = {
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

type ChatPublicationAuthority = {
  markDurable(sessionId: string, userMessageId: string): boolean;
  invalidate(reasonCode: string): void;
  durableSessionId(): string | undefined;
  domainStateAvailable(): boolean;
};

function createChatPublicationAuthority(): ChatPublicationAuthority {
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

class RequiredConversationSettlementError extends SecretSafeFailureError {
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

class AssistantAcceptanceRecoveryRequiredError extends Error {
  constructor(
    readonly result: SendChatMessageResult,
  ) {
    super("Assistant acceptance requires durable reconciliation.");
  }
}

function createAssistantAcceptanceRecoveryResult(): SendChatMessageResult {
  return {
    ok: false,
    code: "CONFLICT",
    retryable: true,
    message: "回复已持久化，跨域成功确认仍在恢复中。",
    turnSettlementStatus: "unknown",
  };
}

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
  initialSequence?: number;
  now?: () => Date;
  getDomainStateAvailable?: () => boolean;
  onStatusEvent?: (event: ChatTaskStatusEvent) => void;
  onStreamEvent?: (event: ChatStreamEvent) => void;
  onPersistEvent?: (event: ChatTaskStatusEvent) => void | Promise<void>;
  onRequiredPersistEvent?: (event: ChatTaskStatusEvent) => Promise<void>;
}) {
  let sessionId = options.sessionId;
  let assistantMessageId: string | undefined;
  let sequence = Math.max(0, options.initialSequence ?? 0);
  let currentAttempt = 1;
  let attemptControlSequence = 0;
  const turnId = `turn-${options.requestId}`;
  const bufferedTextEvents: Array<{
    type: "answer_delta" | "thinking_delta";
    text: string;
  }> = [];
  let persistenceQueue: Promise<void> = Promise.resolve();

  function enqueuePersistence(statusEvent: ChatTaskStatusEvent): Promise<void> {
    const operation = persistenceQueue.then(async () => {
      await options.onPersistEvent?.(statusEvent);
    });
    persistenceQueue = operation.catch(() => undefined);
    return operation;
  }

  function createStreamBase(createdAt: string) {
    return {
      sessionId,
      requestId: options.requestId,
      sequence: ++sequence,
      turnId,
      ...(assistantMessageId ? { assistantMessageId } : {}),
      attempt: currentAttempt,
      createdAt,
      domainStateAvailable: options.getDomainStateAvailable?.() === true,
    };
  }

  function createStatusEvent(
    event: Omit<ChatTaskStatusEvent, "sessionId" | "createdAt" | "elapsedMs">,
  ): ChatTaskStatusEvent {
    const safeEvent = redactCredentials(event) as typeof event;
    if (safeEvent.inputRequest) {
      safeEvent.inputRequest = sanitizeSkillUserInputRequest(
        safeEvent.inputRequest,
      );
    }
    if (safeEvent.pendingSkillInput?.inputRequest) {
      safeEvent.pendingSkillInput.inputRequest = sanitizeSkillUserInputRequest(
        safeEvent.pendingSkillInput.inputRequest,
      );
    }
    const nowMs = getNowMs(options.now);
    const createdAt = new Date(nowMs).toISOString();
    const streamBase = createStreamBase(createdAt);
    return {
      ...safeEvent,
      ...streamBase,
      domainStateAvailable:
        safeEvent.domainStateAvailable === false
          ? false
          : streamBase.domainStateAvailable,
      elapsedMs: Math.max(0, nowMs - options.startedAtMs),
    };
  }

  function publishStatusEvent(
    statusEvent: ChatTaskStatusEvent,
    optionsOverride: { persist: boolean },
  ) {
    if (optionsOverride.persist) {
      void enqueuePersistence(statusEvent).catch(() => undefined);
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
        domainStateAvailable: statusEvent.domainStateAvailable === true,
      });
    } catch {
      // Renderer observers are best-effort.
    }
  }

  function flushBufferedTextEvents() {
    const pending = bufferedTextEvents.splice(0);
    const orderedTypes = [
      ...new Set(pending.map((event) => event.type)),
    ];
    for (const type of orderedTypes) {
      const text = redactCredentialString(
        pending
          .filter((event) => event.type === type)
          .map((event) => event.text)
          .join(""),
      );
      if (!text) {
        continue;
      }
      const nowMs = getNowMs(options.now);
      try {
        options.onStreamEvent?.({
          type,
          text,
          ...createStreamBase(new Date(nowMs).toISOString()),
        });
      } catch {
        // Renderer observers are best-effort.
      }
    }
  }

  return {
    getSequence() {
      return sequence;
    },
    setSessionId(nextSessionId: string) {
      sessionId = nextSessionId;
    },
    send(event: Omit<ChatTaskStatusEvent, "sessionId" | "createdAt" | "elapsedMs">) {
      if (
        event.state === "paused"
        || event.state === "waiting_for_input"
        || (
          event.state === "tool_invocation"
          && event.invocationStatus === "waiting_approval"
        )
      ) {
        throw new Error(`Status ${event.state} requires durable publication.`);
      }
      publishStatusEvent(createStatusEvent(event), { persist: true });
    },
    sendPublishedOnly(
      event: Omit<ChatTaskStatusEvent, "sessionId" | "createdAt" | "elapsedMs">,
    ) {
      publishStatusEvent(createStatusEvent(event), { persist: false });
    },
    sendAttemptControl(event: {
      operation: "begin" | "supersede" | "reset" | "accepted";
      attempt: number;
      supersedesAttempt?: number;
    }) {
      flushBufferedTextEvents();
      currentAttempt = event.attempt;
      const nowMs = getNowMs(options.now);
      try {
        options.onStreamEvent?.({
          type: "attempt_control",
          operation: event.operation,
          controlSequence: ++attemptControlSequence,
          ...(event.supersedesAttempt
            ? { supersedesAttempt: event.supersedesAttempt }
            : {}),
          ...createStreamBase(new Date(nowMs).toISOString()),
        });
      } catch {
        // Renderer observers are best-effort.
      }
    },
    async sendWaitingForInput(
      inputRequest: SkillUserInputRequest,
      message: string,
      pendingSkillInput: SkillPendingInputState,
    ) {
      const publicInputRequest = sanitizeSkillUserInputRequest(inputRequest);
      const statusEvent = createStatusEvent({
        state: "waiting_for_input",
        message,
        selectedSkillName: publicInputRequest.skillName,
        inputRequest: publicInputRequest,
        pendingSkillInput,
      });
      if (!options.onRequiredPersistEvent) {
        throw new Error("Chat activity persistence is unavailable.");
      }
      await persistenceQueue;
      await options.onRequiredPersistEvent(statusEvent);
      if (statusEvent.pendingSkillInput?.settlementId) {
        pendingSkillInput.settlementId = statusEvent.pendingSkillInput.settlementId;
      }
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
          inputRequest: publicInputRequest,
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
        await enqueuePersistence(statusEvent);
        publishStatusEvent(statusEvent, { persist: false });
        return;
      }
      await persistenceQueue;
      await options.onRequiredPersistEvent(statusEvent);
      publishStatusEvent(statusEvent, { persist: false });
    },
    setAssistantMessageId(nextAssistantMessageId: string | null | undefined) {
      assistantMessageId = nextAssistantMessageId ?? undefined;
    },
    async drainPersistence() {
      await persistenceQueue;
    },
    sendStreamEvent(event: ChatModelStreamEventInput) {
      if (event.type === "answer_delta") {
        const previous = bufferedTextEvents.at(-1);
        if (previous?.type === event.type) previous.text += event.text;
        else bufferedTextEvents.push({ ...event });
        return;
      }
      if (event.type === "thinking_delta") {
        const previous = bufferedTextEvents.at(-1);
        if (previous?.type === event.type) previous.text += event.text;
        else bufferedTextEvents.push({ ...event });
        return;
      }
      const nowMs = getNowMs(options.now);
      try {
        const clonedEvent = cloneChatModelStreamEventInput(event);
        const safeEvent = event.type === "output_part"
          ? clonedEvent
          : redactCredentials(clonedEvent) as ChatModelStreamEventInput;
        options.onStreamEvent?.({
          ...safeEvent,
          ...createStreamBase(new Date(nowMs).toISOString()),
          ...(safeEvent.domainStateAvailable === false
            ? { domainStateAvailable: false as const }
            : {}),
        });
      } catch {
        // Renderer observers are best-effort.
      }
    },
    sendTerminalEvent(event: {
      type: "completed" | "failed" | "canceled";
      message?: string;
      finalMessageId?: string;
      domainStateAvailable?: false;
    }) {
      flushBufferedTextEvents();
      if (event.finalMessageId) {
        assistantMessageId = event.finalMessageId;
      }
      const nowMs = getNowMs(options.now);
      try {
        const safeEvent = redactCredentials(event) as typeof event;
        options.onStreamEvent?.({
          ...safeEvent,
          ...createStreamBase(new Date(nowMs).toISOString()),
          ...(safeEvent.domainStateAvailable === false
            ? { domainStateAvailable: false as const }
            : {}),
        });
      } catch {
        // Renderer observers are best-effort.
      }
    },
  };
}

type ChatModelStreamEventInput = { domainStateAvailable?: false } & (
  | { type: "answer_delta"; text: string }
  | { type: "thinking_delta"; text: string }
  | { type: "output_part"; part: ChatOutputPart }
  | {
      type: "tool_call_preview";
      toolCallId: string;
      toolName?: string;
      argumentsDelta?: string;
    }
);

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
    outputAssembler.appendText(event.text);
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
      // Raw streaming argument chunks are not independently redactable: a
      // credential key/value can straddle chunk boundaries. The accompanying
      // output_part is assembled and sanitized before renderer publication.
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

function toRequiredSettlementTarget(
  event: ChatTaskStatusEvent,
):
  | "waiting_for_input"
  | "waiting_for_approval"
  | "checkpoint_boundary"
  | "paused"
  | "failed"
  | "canceled"
  | null {
  if (event.state === "waiting_for_input") return "waiting_for_input";
  if (
    event.state === "tool_invocation"
    && event.invocationStatus === "waiting_approval"
  ) {
    return "waiting_for_approval";
  }
  if (event.state === "checkpoint_boundary") return "checkpoint_boundary";
  if (event.state === "paused") return "paused";
  if (event.state === "failed") return "failed";
  if (event.state === "canceled") return "canceled";
  return null;
}

function createRequiredSettlementId(input: {
  requestId: string;
  attempt: number;
  sourceSequence: number;
  targetState: string;
}): string {
  return `required_settlement_${createConversationRequestFingerprint({
    schemaVersion: 1,
    ...input,
  })}`;
}

export function createRequiredChatEventFingerprint(
  event: ChatTaskStatusEvent,
): string {
  const persistedEvent = normalizeChatTaskStatusEventForPersistence(event);
  const pendingSkillInput = persistedEvent.pendingSkillInput
    ? {
        ...persistedEvent.pendingSkillInput,
        ...(persistedEvent.pendingSkillInput.attachmentPayloads
          ? {
              attachmentPayloads: persistedEvent.pendingSkillInput.attachmentPayloads.map(
                ({ dataBase64, ...metadata }) => ({
                  ...metadata,
                  dataFingerprint: createConversationRequestFingerprint(dataBase64),
                }),
              ),
            }
          : {}),
      }
    : undefined;
  return createConversationRequestFingerprint({
    schemaVersion: 2,
    event: {
      ...persistedEvent,
      ...(pendingSkillInput ? { pendingSkillInput } : {}),
    },
  });
}

function createChatKernelRunId(requestId: string): string {
  return `chat_kernel_${createConversationRequestFingerprint({
    schemaVersion: 1,
    requestId,
    invocationId: randomUUID(),
  })}`;
}

function toChatKernelStatus(
  result: SendChatMessageResult,
  terminal: Extract<
    ChatStreamEvent,
    { type: "completed" | "failed" | "canceled" }
  > | undefined,
  statusEvent: ChatTaskStatusEvent | undefined,
): ChatKernelSettlement<unknown>["status"] {
  if (terminal?.type === "canceled") return "canceled";
  if (terminal?.type === "failed") return "failed";
  if (result.turnSettlementStatus === "unknown") return "paused";
  if (!result.ok) {
    if (statusEvent?.state === "waiting_for_input" || statusEvent?.state === "paused") {
      return "paused";
    }
    if (statusEvent?.state === "canceled") return "canceled";
    if (statusEvent?.state === "failed") return "failed";
    return result.code === "CANCELED" ? "canceled" : "failed";
  }
  if (result.turnSettlementStatus === "paused") return "paused";
  if (result.turnSettlementStatus === "failed") return "failed";
  if (result.agentStatus?.state === "paused") return "paused";
  if (result.agentStatus?.state === "failed") return "failed";
  return "succeeded";
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
  appendStatusEvent(event: ChatTaskStatusEvent): Promise<{
    eventId?: string;
    deferredTerminal?: boolean;
  }>;
  finalizeAccepted(
    acceptance?: ConversationAssistantAcceptance,
  ): Promise<{
    eventId?: string;
    disposition: "committed" | "recovery_required";
  }>;
};

type RequiredSettlementCoordinatorResult = {
  settlementId?: string;
  chatEventFingerprint: string;
  workspaceEventId?: string;
  disposition: "committed" | "reconciled";
};

async function persistRequiredConversationSettlement(options: {
  requestId: string;
  attempt: number;
  event: ChatTaskStatusEvent;
  chatSessionStore:
    | Partial<Pick<ChatSessionStore, "appendActivityEvent">>
    | undefined;
  conversationCausalStore?: Pick<
    ConversationCausalStore,
    "beginRequiredSettlement" | "settleRequiredSettlement" | "addRefs"
  >;
  workspaceRunRecorder?: ChatWorkspaceRunRecorder | null;
  workspaceUnavailableReasonCode?: string;
  failureReasonCode?: string;
}): Promise<RequiredSettlementCoordinatorResult> {
  const targetState = toRequiredSettlementTarget(options.event);
  if (!targetState) {
    throw new RequiredConversationSettlementError(
      false,
      undefined,
      "CROSS_DOMAIN_SETTLEMENT_FAILED",
    );
  }
  const causalStore = options.conversationCausalStore;
  if (!causalStore) {
    const chatEventFingerprint = createRequiredChatEventFingerprint(options.event);
    let chatPersisted = false;
    try {
      await persistRequiredChatActivityEvent(
        options.chatSessionStore,
        options.event,
      );
      chatPersisted = true;
      const recorded = await options.workspaceRunRecorder?.appendStatusEvent(
        options.event,
      );
      if (options.workspaceRunRecorder && !recorded?.eventId) {
        throw new Error("Workspace required settlement did not return a receipt.");
      }
      return {
        chatEventFingerprint,
        ...(recorded?.eventId ? { workspaceEventId: recorded.eventId } : {}),
        disposition: "committed",
      };
    } catch (error) {
      throw new RequiredConversationSettlementError(
        false,
        error,
        chatPersisted
          ? "WORKSPACE_SETTLEMENT_FAILED"
          : "CHAT_SETTLEMENT_FAILED",
      );
    }
  }

  const settlementId = createRequiredSettlementId({
    requestId: options.requestId,
    attempt: options.attempt,
    sourceSequence: options.event.sequence ?? 0,
    targetState,
  });
  options.event.settlementId = settlementId;
  if (options.event.pendingSkillInput) {
    options.event.pendingSkillInput.settlementId = settlementId;
  }
  const chatEventFingerprint = createRequiredChatEventFingerprint(options.event);
  const preparedWorkspaceEventId = options.workspaceRunRecorder
    ? createWorkspaceStatusEventId(options.event)
    : undefined;
  const preparing = await causalStore.beginRequiredSettlement({
    requestId: options.requestId,
    id: settlementId,
    attempt: options.attempt,
    sourceSequence: options.event.sequence ?? 0,
    targetState,
    ...(options.event.pendingSkillInput?.inputRequestId
      ? {
          guidedInputRequestId:
            options.event.pendingSkillInput.inputRequestId,
        }
      : {}),
    requiredDomains: options.workspaceRunRecorder
      ? ["chat", "workspace"]
      : ["chat"],
    ...(options.workspaceRunRecorder && preparedWorkspaceEventId
      ? {
          workspaceRunId: options.workspaceRunRecorder.workspaceRunId,
          preparedWorkspaceEventId,
        }
      : {}),
    preparedChatEventFingerprint: chatEventFingerprint,
  });
  if (
    preparing.disposition !== "applied"
    && preparing.disposition !== "duplicate"
  ) {
    throw new RequiredConversationSettlementError(
      false,
      undefined,
      "CROSS_DOMAIN_SETTLEMENT_FAILED",
    );
  }
  const existingSettlement = preparing.value?.requiredSettlements?.find(
    (candidate) => candidate.id === settlementId,
  );
  if (
    preparing.disposition === "duplicate"
    && existingSettlement?.state === "committed"
  ) {
    if (
      !existingSettlement.preparedChatEventFingerprint
      || existingSettlement.chatEventFingerprint !== chatEventFingerprint
      || (
        existingSettlement.requiredDomains.includes("workspace")
        && (
          !existingSettlement.workspaceEventId
          || existingSettlement.workspaceEventId
            !== existingSettlement.preparedWorkspaceEventId
        )
      )
    ) {
      throw new RequiredConversationSettlementError(
        false,
        undefined,
        "CROSS_DOMAIN_SETTLEMENT_FAILED",
      );
    }
    return {
      settlementId,
      chatEventFingerprint,
      ...(existingSettlement.workspaceEventId
        ? { workspaceEventId: existingSettlement.workspaceEventId }
        : {}),
      disposition: "reconciled",
    };
  }
  if (
    preparing.disposition === "duplicate"
    && existingSettlement?.state === "failed"
  ) {
    throw new RequiredConversationSettlementError(
      false,
      undefined,
      "CROSS_DOMAIN_SETTLEMENT_FAILED",
    );
  }

  let chatPersisted = false;
  let workspaceEventId: string | undefined;
  try {
    await persistRequiredChatActivityEvent(
      options.chatSessionStore,
      options.event,
    );
    chatPersisted = true;
    if (options.workspaceRunRecorder) {
      const recorded = await options.workspaceRunRecorder.appendStatusEvent(
        options.event,
      );
      workspaceEventId = recorded.eventId;
      if (!workspaceEventId) {
        throw new Error("Workspace required settlement did not return a receipt.");
      }
      const refs = await causalStore.addRefs({
        requestId: options.requestId,
        refs: [
          { kind: "workspace_run", id: options.workspaceRunRecorder.workspaceRunId },
          {
            kind: "workspace_event",
            runId: options.workspaceRunRecorder.workspaceRunId,
            eventId: workspaceEventId,
          },
        ],
      });
      if (refs.disposition !== "applied" && refs.disposition !== "duplicate") {
        throw new Error("Workspace required settlement refs conflicted.");
      }
    } else if (options.workspaceUnavailableReasonCode) {
      await causalStore.addRefs({
        requestId: options.requestId,
        refs: [],
        coverage: {
          state: "partial",
          reasonCodes: [options.workspaceUnavailableReasonCode],
        },
      }).catch(() => undefined);
    }
    const committed = await causalStore.settleRequiredSettlement({
      requestId: options.requestId,
      id: settlementId,
      state: "committed",
      chatEventFingerprint,
      ...(workspaceEventId ? { workspaceEventId } : {}),
    });
    if (
      committed.disposition !== "applied"
      && committed.disposition !== "duplicate"
    ) {
      throw new Error("Required settlement commit conflicted.");
    }
    return {
      settlementId,
      chatEventFingerprint,
      ...(workspaceEventId ? { workspaceEventId } : {}),
      disposition:
        preparing.disposition === "duplicate" ? "reconciled" : "committed",
    };
  } catch (error) {
    const failureCode = chatPersisted
      ? "WORKSPACE_SETTLEMENT_FAILED" as const
      : "CHAT_SETTLEMENT_FAILED" as const;
    await causalStore.settleRequiredSettlement({
      requestId: options.requestId,
      id: settlementId,
      state: "failed",
      ...(chatPersisted ? { chatEventFingerprint } : {}),
      ...(workspaceEventId ? { workspaceEventId } : {}),
      failureCode,
    }).catch(() => undefined);
    await causalStore.addRefs({
      requestId: options.requestId,
      refs: options.workspaceRunRecorder
        ? [{ kind: "workspace_run", id: options.workspaceRunRecorder.workspaceRunId }]
        : [],
      coverage: {
        state: "degraded",
        reasonCodes: [
          options.failureReasonCode
          ?? "required_conversation_settlement_write_failed",
        ],
      },
    }).catch(() => undefined);
    throw new RequiredConversationSettlementError(
      false,
      error,
      failureCode,
    );
  }
}

async function createChatWorkspaceRunRecorder(options: {
  workspaceRunStore:
    | Pick<
        WorkspaceRunStore,
        "ensureRun" | "settleLifecycle" | "getRun" | "listEvents"
      >
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
  const workspaceRunId = createChatWorkspaceRunId(
    options.sessionId,
    options.requestId,
  );
  let pendingCompletedEvent: ChatTaskStatusEvent | null = null;
  let lastWorkspaceStatus: WorkspaceRunStatus = "running";

  try {
    await workspaceRunStore.ensureRun({
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
  } catch (error) {
    if (error instanceof WorkspaceRunEnvelopeConflictError) {
      throw error;
    }
    throw new SecretSafeFailureError(
      "WORKSPACE_RUN_INITIALIZATION_FAILED",
      error,
    );
  }

  return {
    workspaceRunId,
    async appendStatusEvent(event) {
      lastWorkspaceStatus = toWorkspaceRunStatus(event);
      if (event.state === "completed") {
        pendingCompletedEvent = structuredClone(event);
        return { deferredTerminal: true };
      }
      const ledgerEvent = toWorkspaceRunEventInput(event);
      if (!ledgerEvent) {
        return {};
      }
      const eventId = createWorkspaceStatusEventId(event);
      const settled = await workspaceRunStore.settleLifecycle({
        workspaceRunId,
        event: {
          ...ledgerEvent,
          id: eventId,
          createdAt: event.createdAt,
          causalRef: {
            turnId: event.turnId ?? createConversationTurnId(event.requestId ?? options.requestId),
            sourceSequence: event.sequence ?? 0,
          },
        },
        snapshotStatus: toWorkspaceRunStatus(event),
        summary: event.message,
      });
      return { eventId: settled.event.id };
    },
    async finalizeAccepted(acceptance) {
      if (acceptance) {
        if (
          acceptance.workspaceRunId !== workspaceRunId
          || !acceptance.preparedWorkspaceEventId
        ) {
          throw new SecretSafeFailureError("WORKSPACE_SETTLEMENT_FAILED");
        }
        const result = await settlePreparedWorkspaceAssistantAcceptance({
          workspaceRunStore,
          workspaceRunId,
          acceptance,
        });
        if (result.disposition === "committed") {
          pendingCompletedEvent = null;
        }
        return result;
      }
      const event = pendingCompletedEvent ?? (
        lastWorkspaceStatus !== "running"
          ? null
          : {
              sessionId: options.sessionId,
              requestId: options.requestId,
              turnId: createConversationTurnId(options.requestId),
              sequence: 0,
              state: "completed" as const,
              message: "Durable assistant reply accepted.",
              createdAt: options.createdAt,
              elapsedMs: 0,
            }
      );
      if (!event) return { disposition: "committed" as const };
      const ledgerEvent = toWorkspaceRunEventInput(event);
      if (!ledgerEvent) return { disposition: "committed" as const };
      const eventId = createWorkspaceStatusEventId(event);
      const settled = await workspaceRunStore.settleLifecycle({
        workspaceRunId,
        event: {
          ...ledgerEvent,
          id: eventId,
          createdAt: event.createdAt,
          causalRef: {
            turnId: event.turnId ?? createConversationTurnId(event.requestId ?? options.requestId),
            sourceSequence: event.sequence ?? 0,
          },
        },
        snapshotStatus: "succeeded",
        summary: event.message,
      });
      if (pendingCompletedEvent === event) {
        pendingCompletedEvent = null;
      }
      return { eventId: settled.event.id, disposition: "committed" as const };
    },
  };
}

const WORKSPACE_ASSISTANT_ACCEPTANCE_MESSAGE =
  "Durable assistant reply accepted.";

async function commitPreparedAssistantAcceptance(options: {
  conversationCausalStore: Pick<
    ConversationCausalStore,
    "commitAssistantAcceptance" | "getRequest"
  >;
  requestId: string;
  attempt: number;
  acceptance: ConversationAssistantAcceptance;
  workspaceEventId?: string;
}): Promise<"committed" | "recovery_required"> {
  const receiptFingerprint =
    options.acceptance.acceptedSettlement.acceptanceReceiptFingerprint;
  for (let commitAttempt = 0; commitAttempt < 2; commitAttempt += 1) {
    try {
      const committed = await options.conversationCausalStore
        .commitAssistantAcceptance({
          requestId: options.requestId,
          attempt: options.attempt,
          acceptanceReceiptFingerprint: receiptFingerprint,
          ...(options.workspaceEventId
            ? { workspaceEventId: options.workspaceEventId }
            : {}),
        });
      if (
        (committed.disposition === "applied"
          || committed.disposition === "duplicate")
        && conversationAssistantAcceptanceCommitted(
          committed.value,
          options.attempt,
          receiptFingerprint,
          options.workspaceEventId,
        )
      ) {
        return "committed";
      }
    } catch {
      // The commit can be ambiguous after the causal file replacement. Retry
      // once, then classify from the owning store instead of emitting failure.
    }
  }
  try {
    const record = await options.conversationCausalStore.getRequest(options.requestId);
    if (
      conversationAssistantAcceptanceCommitted(
        record,
        options.attempt,
        receiptFingerprint,
        options.workspaceEventId,
      )
    ) {
      return "committed";
    }
  } catch {
    // An unavailable causal authority is unresolved, never a failed success.
  }
  return "recovery_required";
}

function conversationAssistantAcceptanceCommitted(
  record: Awaited<ReturnType<ConversationCausalStore["getRequest"]>> | undefined,
  attempt: number,
  receiptFingerprint: string,
  workspaceEventId: string | undefined,
): boolean {
  const target = record?.attempts.find((candidate) => candidate.attempt === attempt);
  return target?.state === "accepted"
    && target.acceptedSettlement?.acceptanceReceiptFingerprint === receiptFingerprint
    && target.assistantAcceptance?.state === "committed"
    && target.assistantAcceptance.workspaceEventId === workspaceEventId;
}

async function settlePreparedWorkspaceAssistantAcceptance(options: {
  workspaceRunStore: Pick<
    WorkspaceRunStore,
    "settleLifecycle" | "getRun" | "listEvents"
  >;
  workspaceRunId: string;
  acceptance: ConversationAssistantAcceptance;
}): Promise<{
  eventId: string;
  disposition: "committed" | "recovery_required";
}> {
  const eventId = options.acceptance.preparedWorkspaceEventId;
  if (
    !eventId
    || options.acceptance.workspaceRunId !== options.workspaceRunId
    || !options.acceptance.requiredDomains.includes("workspace")
    || (
      options.acceptance.state === "committed"
      && options.acceptance.workspaceEventId !== eventId
    )
  ) {
    throw new SecretSafeFailureError("WORKSPACE_SETTLEMENT_FAILED");
  }
  const eventInput = {
    id: eventId,
    createdAt: options.acceptance.createdAt,
    type: "status" as const,
    status: "succeeded" as const,
    message: WORKSPACE_ASSISTANT_ACCEPTANCE_MESSAGE,
    causalRef: {
      turnId: options.acceptance.acceptedSettlement.turnId,
      sourceSequence: options.acceptance.acceptedSettlement.lastSequence,
    },
  };
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const settled = await options.workspaceRunStore.settleLifecycle({
        workspaceRunId: options.workspaceRunId,
        event: eventInput,
        snapshotStatus: "succeeded",
        summary: WORKSPACE_ASSISTANT_ACCEPTANCE_MESSAGE,
      });
      if (settled.event.id !== eventId || settled.run.status !== "succeeded") {
        throw new Error("Workspace assistant acceptance receipt is incomplete.");
      }
      return { eventId, disposition: "committed" };
    } catch (error) {
      lastError = error;
    }
  }

  try {
    const [run, events] = await Promise.all([
      options.workspaceRunStore.getRun(options.workspaceRunId),
      options.workspaceRunStore.listEvents(options.workspaceRunId),
    ]);
    const storedEvent = events.find((event) => event.id === eventId);
    if (storedEvent && !workspaceAssistantAcceptanceEventMatches(storedEvent, eventInput)) {
      throw new SecretSafeFailureError("WORKSPACE_SETTLEMENT_FAILED");
    }
    if (storedEvent && run?.status === "succeeded") {
      return { eventId, disposition: "committed" };
    }
    if (!storedEvent && run?.status !== "succeeded") {
      throw new SecretSafeFailureError(
        "WORKSPACE_SETTLEMENT_FAILED",
        lastError,
      );
    }
  } catch (error) {
    if (error instanceof SecretSafeFailureError) throw error;
    return { eventId, disposition: "recovery_required" };
  }
  return { eventId, disposition: "recovery_required" };
}

function workspaceAssistantAcceptanceEventMatches(
  stored: WorkspaceRunEvent,
  expected: WorkspaceRunEventInput & { id: string; createdAt: string },
): boolean {
  return stored.id === expected.id
    && stored.type === "status"
    && stored.status === "succeeded"
    && stored.lifecycleStatus === "succeeded"
    && stored.message === expected.message
    && stored.createdAt === expected.createdAt
    && stored.causalRef?.turnId === expected.causalRef?.turnId
    && stored.causalRef?.sourceSequence === expected.causalRef?.sourceSequence;
}

export function createWorkspaceStatusEventId(event: ChatTaskStatusEvent): string {
  return `chat_status_${createConversationRequestFingerprint({
    sessionId: event.sessionId,
    requestId: event.requestId,
    turnId: event.turnId,
    sequence: event.sequence,
    state: event.state,
  })}`;
}

export function toWorkspaceRunEventInput(
  event: ChatTaskStatusEvent,
): WorkspaceRunEventInput | null {
  const payload = {
    ...(event.payload ?? {}),
    chatState: event.state,
    ...(typeof event.turn === "number" ? { turn: event.turn } : {}),
    ...(event.toolCallId ? { toolCallId: event.toolCallId } : {}),
    ...(event.toolInvocationId ? { toolInvocationId: event.toolInvocationId } : {}),
    ...(event.approvalId ? { approvalId: event.approvalId } : {}),
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
      ...(event.approvalId ? { approvalId: event.approvalId } : {}),
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

export function toWorkspaceRunStatus(event: ChatTaskStatusEvent): WorkspaceRunStatus {
  if (event.state === "waiting_for_input") return "waiting_for_user";
  if (
    event.state === "tool_invocation"
    && event.invocationStatus === "waiting_approval"
  ) {
    return "waiting_for_approval";
  }
  if (event.state === "paused") return "paused";
  if (event.state === "failed") return "failed";
  if (event.state === "canceled") return "canceled";
  if (event.state === "completed") return "succeeded";
  return "running";
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
  } catch {
    return {
      ok: false,
      message: "无法解析工作区，已安全停止本次任务。",
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
      allowedSkillSnapshotSha256ByName: options.selectedSkill
        ? {
            [options.selectedSkill.manifest.name]:
              createPublicSkillSnapshotSha256(options.selectedSkill),
          }
        : {},
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

function createChatWorkspaceRunId(sessionId: string, requestId: string): string {
  return `chat_run_${sanitizeRuntimeId(sessionId)}_${sanitizeRuntimeId(requestId)}`;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeReasoningForStatus(reasoningContent: string): string {
  const normalized = redactCredentialString(reasoningContent)
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
    const timeoutMs =
      typeof details.timeoutMs === "number" && Number.isFinite(details.timeoutMs)
        ? details.timeoutMs
        : undefined;
    return timeoutMs === undefined
      ? `工具失败：${toolName}（超时）`
      : `工具失败：${toolName}（超时 ${timeoutMs} ms）`;
  }
  if (details?.kind === "canceled") {
    return `工具中断：${toolName}`;
  }
  if (details?.kind === "empty_exit") {
    const exitCode =
      typeof details.exitCode === "number" && Number.isFinite(details.exitCode)
        ? details.exitCode
        : 1;
    return `工具失败：${toolName}（退出码 ${exitCode}，无 stdout/stderr）`;
  }
  if (
    typeof details?.exitCode === "number"
    && Number.isFinite(details.exitCode)
  ) {
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
  const actorId = normalizeActorStatusId(
    readToolArgString(payload, "actorId"),
  );
  if (!actorId) {
    return;
  }

  const actorStatus = normalizeActorStatus(
    readToolArgString(payload, "status") ||
    readToolArgString(payload, "actorStatus"),
  );
  const summary =
    readToolArgString(payload, "summary") ||
    readToolArgString(payload, "error") ||
    "";
  const safeSummary = redactCredentialString(summary);
  const safeTask = redactCredentialString(options.task);

  emitActorSpawnedStatusEvent({
    emitStatus: options.emitStatus,
    actorId,
    task: safeTask,
    toolCallId: options.toolCallId,
    toolCallsExecuted: options.toolCallsExecuted,
    emittedActorSpawnIds: options.emittedActorSpawnIds,
  });

  if (!actorStatus || actorStatus === "running") {
    return;
  }

  options.emitStatus.send({
    state: "actor_done",
    message: buildActorDoneStatusMessage(actorStatus, safeSummary || actorId),
    toolCallId: options.toolCallId,
    toolName: "actor",
    toolCallsExecuted: options.toolCallsExecuted,
    ok: actorStatus === "done",
    payload: {
      actorId,
      actorStatus,
      summary: safeSummary,
      task: safeTask,
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
  const safeActorId = normalizeActorStatusId(options.actorId);
  if (options.emittedActorSpawnIds.has(safeActorId)) {
    return;
  }
  options.emittedActorSpawnIds.add(safeActorId);
  const safeTask = redactCredentialString(options.task);

  options.emitStatus.send({
    state: "actor_spawned",
    message: `子代理已启动：${safeTask}`,
    toolCallId: options.toolCallId,
    toolName: "actor",
    toolCallsExecuted: options.toolCallsExecuted,
    payload: {
      actorId: safeActorId,
      task: safeTask,
    },
  });
}

function normalizeActorStatusId(value: string): string {
  if (!value) {
    return "";
  }
  return /^[a-zA-Z0-9_-]{1,160}$/.test(value)
    ? value
    : "actor_redacted";
}

function normalizeActorStatus(
  value: string,
): "running" | "done" | "failed" | "canceled" | "" {
  if (
    value === "running"
    || value === "done"
    || value === "failed"
    || value === "canceled"
  ) {
    return value;
  }
  return value ? "failed" : "";
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
  const normalized = redactCredentialString(error).replace(/\s+/g, " ").trim();
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
  const emitStatus = options.emitStatus;

  const labels = deriveGoalRequirementLabels(options.description);
  labels.forEach((label, index) => {
    emitStatus.send({
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
  return "已将补充信息纳入规划，但计划尚未通过门禁；原始诊断内容未写入聊天记录，请检查计划详情。";
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
  requestId: string;
  persistAssistantReply?: (input: {
    content: string;
    goalId?: string;
    goalEventRef?: string;
    settlementStatus?: ChatTurnSettlementStatus;
  }) => Promise<string | null>;
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
    settlementStatus?: ChatTurnSettlementStatus;
  }) {
    if (options.persistAssistantReply) {
      await options.persistAssistantReply(input);
      return;
    }
    const goalOutputAssembler = createChatOutputAssembler(() =>
      new Date(getNowMs(options.now)).toISOString(),
    );
    goalOutputAssembler.setFinalText(input.content);
    const assistantMessage = await appendAssistantMessage({
      chatSessionStore: options.chatSessionStore,
      sessionId: options.sessionId,
      requestId: options.requestId,
      content: input.content,
      turnSettlementStatus: input.settlementStatus ?? "succeeded",
      outputParts: goalOutputAssembler.parts(),
      ...(input.goalId ? { goalId: input.goalId } : {}),
      ...(input.goalEventRef ? { goalEventRef: input.goalEventRef } : {}),
    });
    const assistantMessageId = assistantMessage?.id ?? null;
    options.emitStatus?.setAssistantMessageId(assistantMessageId);
    await options.emitStatus?.drainPersistence();
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
          await options.emitStatus?.drainPersistence();
          options.emitStatus?.sendTerminalEvent({
            type: "canceled",
            message: "已中断任务。",
          });
          return {
            result: {
              ok: false,
              code: "CANCELED",
              retryable: true,
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
        await options.emitStatus?.drainPersistence();
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
      const planCreationState =
        plan.status === "awaiting_confirmation" ? "completed" : "paused";
      const planCreationEvent: Omit<
        ChatTaskStatusEvent,
        "sessionId" | "createdAt" | "elapsedMs"
      > = {
        state: planCreationState,
        message: `${outcome.title} · ${outcome.nextAction}`,
        toolCallsExecuted: 0,
      };
      if (planCreationState === "paused") {
        await options.emitStatus?.sendRequired(planCreationEvent);
      } else {
        options.emitStatus?.send(planCreationEvent);
      }
      await appendGoalReply({
        content: reply,
        goalEventRef: `plan_created:${plan.id}`,
        settlementStatus:
          plan.status === "awaiting_confirmation" ? "succeeded" : "paused",
      });
      return {
        result: {
          ok: true,
          reply,
          sessionId: options.sessionId,
          relatedMemories: [],
          memoryId: null,
          turnSettlementStatus:
            plan.status === "awaiting_confirmation" ? "succeeded" : "paused",
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
    await options.emitStatus?.sendRequired({
      state: "paused",
      message: "目标修订提案等待明确批准",
      toolCallsExecuted: 0,
    });
    await appendGoalReply({
      content: reply,
      goalId: options.activeGoal.id,
      goalEventRef: `goal-amendment:${amendment.proposal.id}`,
      settlementStatus: "paused",
    });
    return {
      result: {
        ok: true,
        reply,
        sessionId: options.sessionId,
        relatedMemories: [],
        memoryId: null,
        turnSettlementStatus: "paused",
        activeGoal: amendedGoalSummary,
      },
    };
  }

  if (options.route.kind === "continue_goal") {
    if (options.activeGoal.status === "stopped_budget") {
      const reply =
        "这是旧版本地预算机制留下的只读任务，不能继续执行。你仍可查看原结果和执行证据。";
      await options.emitStatus?.sendRequired({
        state: "paused",
        message: "旧版任务已停止（只读）",
        toolCallsExecuted: 0,
      });
      await appendGoalReply({
        content: reply,
        goalId: options.activeGoal.id,
        goalEventRef: "legacy_goal_read_only",
        settlementStatus: "paused",
      });
      return {
        result: {
          ok: true,
          reply,
          sessionId: options.sessionId,
          relatedMemories: [],
          memoryId: null,
          turnSettlementStatus: "paused",
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
  turnId?: string;
  causalAttempt?: number;
  causalAttemptId?: string;
  content: string;
  outputParts?: ChatOutputPart[];
  relatedMemoryIds?: string[];
  executedRunId?: string;
  goalId?: string;
  goalEventRef?: string;
  turnSettlementStatus?: ChatTurnSettlementStatus;
}): Promise<ChatMessageRecord | null> {
  if (!options.chatSessionStore) {
    return null;
  }

  const appendResult: AppendChatMessageResult =
    await options.chatSessionStore.appendMessage({
      sessionId: options.sessionId,
      ...(options.requestId ? { requestId: options.requestId } : {}),
      ...(options.turnId ? { turnId: options.turnId } : {}),
      ...(options.causalAttempt !== undefined
        ? { causalAttempt: options.causalAttempt }
        : {}),
      ...(options.causalAttemptId ? { causalAttemptId: options.causalAttemptId } : {}),
      role: "assistant",
      content: options.content,
      ...(options.outputParts?.length ? { outputParts: options.outputParts } : {}),
      ...(options.relatedMemoryIds?.length
        ? { relatedMemoryIds: options.relatedMemoryIds }
        : {}),
      ...(options.executedRunId ? { executedRunId: options.executedRunId } : {}),
      ...(options.goalId ? { goalId: options.goalId } : {}),
      ...(options.goalEventRef ? { goalEventRef: options.goalEventRef } : {}),
      ...(options.turnSettlementStatus
        ? { turnSettlementStatus: options.turnSettlementStatus }
        : {}),
    });
  return appendResult.message;
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
  } catch {
    return {
      ok: false,
      result: {
        ok: false,
        message: "创建任务失败，未保存不完整的任务。",
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
    | ((
        taskId: string,
        options?: { sessionId?: string; beforeExecution?: AgentRunAdmissionGate },
      ) => Promise<RunScheduledTaskResult>)
    | undefined;
  beforeExecution?: AgentRunAdmissionGate;
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
    ...(options.beforeExecution ? { beforeExecution: options.beforeExecution } : {}),
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

  if (runResult.run.status === "failed" || runResult.run.status === "canceled") {
    return {
      ok: false,
      result: {
        ok: false,
        code:
          runResult.run.status === "canceled" ? "CANCELED" : "INTERNAL_ERROR",
        retryable: runResult.run.status === "canceled",
        message: formatTaskRunReply(runResult.run),
        executedRun: runResult.run,
        turnSettlementStatus: runResult.run.status,
      },
    };
  }

  if (
    runResult.run.status === "queued"
    || runResult.run.status === "running"
  ) {
    return {
      ok: false,
      result: {
        ok: false,
        code: "INTERNAL_ERROR",
        message: "任务运行未返回可结算的最终状态。",
        executedRun: runResult.run,
        turnSettlementStatus: "failed",
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
      turnSettlementStatus:
        runResult.run.status === "paused"
        || runResult.run.status === "waiting_for_approval"
          ? "paused"
          : "succeeded",
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

  if (status === "paused" || status === "waiting_for_approval") {
    return "已暂停";
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
    inputRequest: options.inputRequest,
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
  streamSequence?: number;
}): PendingSkillInputState {
  const authorityInputRequest = restoreAuthoritySkillInputRequest(
    options.persisted.inputRequest,
    options.selectedSkill,
  );
  return {
    persisted: options.persisted,
    ...(authorityInputRequest
      ? { inputRequest: authorityInputRequest }
      : {}),
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
    streamSequence: Math.max(0, options.streamSequence ?? 0),
    ...(options.attachments?.length
      ? { attachments: options.attachments }
      : {}),
  };
}

function restoreAuthoritySkillInputRequest(
  persisted: SkillUserInputRequest | undefined,
  selectedSkill: SkillRecord,
): SkillUserInputRequest | undefined {
  if (!persisted) {
    return undefined;
  }
  const requestedNames = new Set(persisted.fields.map((field) => field.name));
  const authorityFields = selectedSkill.manifest.inputs.filter(
    (field) => requestedNames.size === 0 || requestedNames.has(field.name),
  );
  return {
    ...persisted,
    skillName: selectedSkill.manifest.name,
    fields: authorityFields.map((field) => ({
      name: field.name,
      label: field.label,
      type: field.type,
      required: field.required,
      ...(field.description ? { description: field.description } : {}),
      ...(field.defaultValue !== undefined
        ? { defaultValue: field.defaultValue }
        : {}),
      ...(field.choices?.length ? { choices: [...field.choices] } : {}),
    })),
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

  return latest && (
    latest.status === "pending"
    || latest.status === "processing"
  )
    ? latest
    : null;
}

function toPersistedChatContinuation(
  continuation: ChatContinuationState,
): PersistedChatContinuation {
  return {
    version: 1,
    messages: redactChatMessagesCredentials(continuation.messages),
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
    messages: redactChatMessagesCredentials(value.messages),
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
  try {
    await options.chatSessionStore?.addTokenUsage(options.sessionId, options.usage);
  } catch {
    // Usage is a derivative projection. Once assistant/Workspace/causal
    // acceptance has committed, a metering write cannot reverse the turn.
  }
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

  const safeContent = truncateHistoryContent(
    redactCredentialString(options.content),
  );
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
  memoryProfileStore:
    | Pick<MemoryProfileStore, "updateFromMemories">
    | undefined;
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
