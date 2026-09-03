import { getStatusEventToolCallId } from "./moduleruntime";
import { createChatWorkspaceRunId } from "./moduleruntime";
import { persistRequiredChatActivityEvent } from "./modulemessages";
import { RequiredConversationSettlementError } from "../chatService";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { AgentRunContext } from "../../shared/agentWorkspace";
import type { AgentModelProfile } from "../agentRunnerService";
import type { AgentToolExecutor } from "../agentToolExecutor";
import type { AgentWorkspaceService } from "../agentWorkspaceService";
import { createChatAgentEvidenceRecorder } from "../chatAgentEvidence";
import { createChatOutputAssembler } from "../chatOutputAssembler";
import type { AgentTrajectoryStore } from "../agentTrajectoryStore";
import { runAgentLoop } from "../agentLoop";
import {
  redactChatMessagesCredentials,
  sanitizeChatMessages,
} from "../messageIntegrity";
import { isMaxModeEnabled, type MaxMode } from "../providers/maxMode";
import {
  toChatCompletionResponse,
  toCompleteRequest,
} from "../providers/normalize";
import { estimateMessageTokens } from "../contextManager";
import type { CompactionStrategy } from "../kernel/compactionStrategy";
import type { ProductionKernelDriver } from "../kernel/productionKernelDriver";
import {
  runChatKernelSegment,
  type ChatKernelSettlement,
} from "../kernel/chatKernelSegment";
import {
  type AppendChatMessageResult,
  type ChatSessionStore,
} from "../chatSessionStore";
import { extractAtomicMemoriesFromChatTurn } from "../memoryL1Extractor";
import type { MemoryProfileStore } from "../memoryProfileStore";
import type { MemoryStore } from "../memoryStore";
import type { HistoryIndexStore } from "../historyIndexStore";
import type { RawHistoryRole } from "../../shared/rawHistory";
import type { ToolResultOffloadStore } from "../toolResultOffloadStore";
import {
  WorkspaceRunEnvelopeConflictError,
  type WorkspaceRunStore,
} from "../workspaceRunStore";
import type { ConversationCausalStore } from "../conversationCausalStore";
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
} from "../../shared/conversationCausalSpine";
import {
  formatMemoryRecallContext,
  recallMemoriesWithBudget,
} from "../memoryRecall";
import type {
  ChatClient,
  ChatCompletionResponse,
  ChatMessage,
} from "../openAiCompatibleClient";
import type { ScheduledTaskStore } from "../taskStore";
import type {
  RuntimeToolAuthorizationTask,
  ToolAuthorizationService,
} from "../toolAuthorizationService";
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
} from "../../shared/chat";
import {
  getActionableGoalSummary,
  isLiveGoalStatus,
  isRecoverableGoalStatus,
} from "../../shared/chatSessionWork";
import { getSystemPromptAssembler } from "../../shared/agentProtocol";
import type { GoalReviewDecision } from "../../shared/agentGoalReview";
import type { GoalDraft } from "../../shared/goalTranslation";
import type {
  CreatePlanInput,
  CreateRuntimeGoalPlanResult,
  GoalAmendmentOperationResult,
  PlanMode,
  PlanModelAssignments,
  PlanRecord,
} from "../../shared/planMode";
import { getPlanOutcomePresentation } from "../../shared/planOutcome";
import type {
  AgentRunAdmissionGate,
  AgentRunRecord,
  RunScheduledTaskResult,
} from "../../shared/agentRuns";
import type { ExecutionContextMemoryScope } from "../../shared/executionContextPackage";
import type { MemoryRecord, MemorySearchResult } from "../../shared/memory";
import type { AgentContextUsage } from "../../shared/contextUsage";
import type { NativeToolDescriptor } from "../../shared/nativeCapabilities";
import {
  createPublicSkillSnapshotSha256,
  type SkillDiscoveryResult,
  type SkillRecord,
} from "../../shared/skills";
import type {
  WorkspaceRunEventInput,
  WorkspaceRunEvent,
  WorkspaceRunStatus,
} from "../../shared/workspaceRunLedger";
import {
  buildScheduledTaskInputFromIntent,
  classifyAgentIntent,
  matchTaskFromMessage,
  type AgentIntentRoute,
} from "../../shared/agentIntent";
import { formatDateInTimeZone, getSystemTimeZone } from "../../shared/dateContext";
import {
  stringifyMaskedPreview,
  type ChatOutputPart,
} from "../../shared/chatOutput";
import {
  redactCredentialString,
  stringifyRedactedCredentials,
} from "../../shared/credentialRedaction";
import {
  summarizeAgentRuntimeContextSnapshot,
} from "../../shared/agentRuntimeContext";
import {
  modelServiceNoticeFromError,
  sanitizeModelServiceNotice,
  type ModelServiceNotice,
} from "../../shared/modelServiceNotice";
import { throwIfResponseBodyLimitError } from "../fetchWithTimeout";
import {
  extractRequestedSkillQuery,
  matchSkillMentionCandidates,
} from "../../shared/skillMentions";
import { describeSchedule } from "../../shared/scheduledTasks";
import type { TaskPermissionPolicy } from "../../shared/toolPermissions";
import { resolveSkillInput } from "../skillExecutionService";
import {
  appendChatAttachmentContext,
  ChatAttachmentValidationError,
  processChatAttachments,
  type ProcessedChatAttachments,
} from "../chatAttachmentProcessor";
import type {
  SkillInputResolution,
  SkillInputValue,
} from "../../shared/skillExecutionContract";
import {
  CHAT_ATTACHMENT_MAX_COUNT,
  CHAT_ATTACHMENT_MAX_TEXT_CONTEXT_CHARS,
  CHAT_ATTACHMENT_MAX_TOTAL_BYTES,
} from "../../shared/chatAttachments";
import { createRuntimeContextSnapshotForRun } from "../runtimeContextFactory";
import {
  SecretSafeFailureError,
  toSecretSafeFailure,
} from "../../shared/secretSafeFailure";
import {
  createChatStatusEmitter,
  emitModelStreamEvent,
  getNowMs,
  normalizeAgentLoopMaxTurns,
} from "./streamingStatus";
import {
  createChatKernelRunId,
  createRequiredChatEventFingerprint,
  createRequiredSettlementId,
  toChatKernelStatus,
  toRequiredSettlementTarget,
} from "./kernelSettlement";
export function inferApprovalRiskLevel(input: {
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

export type ChatWorkspaceRunRecorder = {
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

export type RequiredSettlementCoordinatorResult = {
  settlementId?: string;
  chatEventFingerprint: string;
  workspaceEventId?: string;
  disposition: "committed" | "reconciled";
};

export async function persistRequiredConversationSettlement(options: {
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

export async function createChatWorkspaceRunRecorder(options: {
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

export const WORKSPACE_ASSISTANT_ACCEPTANCE_MESSAGE =
  "Durable assistant reply accepted.";

export async function commitPreparedAssistantAcceptance(options: {
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

export function conversationAssistantAcceptanceCommitted(
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

export async function settlePreparedWorkspaceAssistantAcceptance(options: {
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

export function workspaceAssistantAcceptanceEventMatches(
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

