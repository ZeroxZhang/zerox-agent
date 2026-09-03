import { createLegacyTurnRuntime } from "./chatService/legacyTurn";
import { createKernelTurnRuntime } from "./chatService/kernelTurn";
import { createGuidedInputRuntime } from "./chatService/guidedInput";
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


const guidedInput = createGuidedInputRuntime({
  sendMessageInternal: (input, runtimeOptions, extra) =>
    kernelTurn.sendMessageInternal(input as never, runtimeOptions as never, extra as never),
    options,
    createId,
    state: {
      pendingSkillInputRequests,
      historyAttachmentPayloads,
    },
  })

  const kernelTurn = createKernelTurnRuntime({
  options,
  guidedInput,
  processChatSessionRequestTails,
  inFlightSkillInputResponses,
  executeMessageInternal: (input: unknown, runtimeOptions: unknown, extra?: unknown) =>
    legacyTurn.executeMessageInternal(input as never, runtimeOptions as never, extra as never) as Promise<SendChatMessageResult>,
});

const legacyTurn = createLegacyTurnRuntime({
  options,
  createId,
  memoryLimit,
  historyLimit,
  agentLoopMaxTurns,
  state: { pendingContinuations },
  guidedInput,
});

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
        return await guidedInput.respondSkillInputOnce(input, runtimeOptions);
      } finally {
        inFlightSkillInputResponses.delete(input.inputRequestId);
      }
    },
    sendMessage: kernelTurn.sendMessageInternal,
  };
}




export type ChatServiceOptions = Parameters<typeof createChatService>[0];


