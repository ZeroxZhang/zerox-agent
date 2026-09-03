import { HistoryAttachmentReplayBudget } from "../chatService";
import { PersistedChatContinuation } from "../chatService";
import { ChatContinuationState } from "../chatService";
import { PendingSkillInputState } from "../chatService";
import { sanitizeRuntimeId } from "./moduleruntime";
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
export async function appendAssistantMessage(options: {
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

export type TaskRunDetection =
  | {
      ok: true;
      result: Extract<SendChatMessageResult, { ok: true }>;
    }
  | {
      ok: false;
      result: Extract<SendChatMessageResult, { ok: false }>;
    };

export type TaskCreationDetection =
  | {
      ok: true;
      result: Extract<SendChatMessageResult, { ok: true }>;
    }
  | {
      ok: false;
      result: Extract<SendChatMessageResult, { ok: false }>;
    };

export async function tryCreateTaskFromIntent(options: {
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

export async function tryRunTaskFromIntent(options: {
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

export function formatTaskRunReply(run: AgentRunRecord): string {
  return `已运行任务“${run.taskName}”，结果：${translateRunStatus(run.status)}。摘要：${run.summary}`;
}

export function translateRunStatus(status: AgentRunRecord["status"]): string {
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

export function createSkillUserInputRequest(options: {
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

export function createPendingSkillInputState(options: {
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

export function toInMemoryPendingSkillInputState(options: {
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

export function restoreAuthoritySkillInputRequest(
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

export async function findPersistedPendingSkillInputState(options: {
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

export function toPersistedChatContinuation(
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

export async function findPersistedChatContinuation(options: {
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

export async function findPersistedRequestTurn(
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

export function parsePersistedChatContinuation(value: unknown): ChatContinuationState | null {
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

export function isPersistedChatMessage(value: unknown): value is ChatMessage {
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

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export async function persistRequiredChatActivityEvent(
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

export function buildChatSystemPrompt(currentDate?: string, timeZone?: string): string {
  return getSystemPromptAssembler().assemble({
    mode: "chat",
    currentDate,
    timeZone,
  }).prompt;
}

export type RequestedSkillResolution =
  | { kind: "matched"; skill: SkillRecord }
  | { kind: "missing"; message: string };

export async function resolveRequestedSkill(options: {
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

export function injectSkillInvocationMessage(
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

export function buildSelectedSkillInstruction(
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

export function buildChatMessages(options: {
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

export function processCachedHistoryAttachments(
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

export type ProcessedHistoryAttachments = {
  images: NonNullable<ChatMessage["images"]>;
  textContext: string;
  unavailableCount: number;
};

export function emptyProcessedHistoryAttachments(): ProcessedHistoryAttachments {
  return { images: [], textContext: "", unavailableCount: 0 };
}

export function createHistoryAttachmentReplayBudget(
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

export function isChatAttachmentMetadata(
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

export function appendUnavailableHistoryAttachmentContext(
  content: string,
  unavailableCount: number,
): string {
  if (unavailableCount <= 0) {
    return content;
  }
  return `${content}\n\n<attachment_context>\n[本消息的 ${unavailableCount} 个历史附件内容已失效、不可用，或为控制本次请求大小已省略。不要猜测其内容；如当前问题依赖这些附件，请要求用户重新粘贴。]\n</attachment_context>`;
}

export function matchesAttachmentMetadata(
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

export function toHistoryAttachmentCacheKey(
  sessionId: string,
  attachmentId: string,
): string {
  return `${sessionId.length}:${sessionId}${attachmentId}`;
}

export function formatMemoryContext(results: MemorySearchResult[]): string | null {
  return formatMemoryRecallContext(results, {
    heading: "相关记忆：",
    maxCharsPerMemory: 240,
    maxTotalRecallChars: 1_200,
  });
}

export async function searchRelatedMemories(options: {
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

export function toChatSessionContextSnapshot(options: {
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

export function formatContextUsageStatus(context: ChatSessionContextSnapshot): string {
  const percent = Math.round(context.occupancyRatio * 100);
  return context.lastCompaction
    ? `上下文 ${percent}% · 已压缩 ${context.compactionCount} 次`
    : `上下文 ${percent}% · 当前会话已隔离`;
}

export function toChatSessionTokenUsage(
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

export function mergeChatSessionTokenUsage(
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

export function reconcileAgentLoopTokenUsage(
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

export function estimateChatTurnUsage(messages: ChatMessage[]): ChatSessionTokenUsage {
  return {
    totalTokens: Math.max(1, estimateMessageTokens(messages)),
    estimated: true,
  };
}

export async function recordSessionTokenUsage(options: {
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

export function normalizeTokenCount(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(0, Math.floor(value));
}

export function addOptionalTokenCounts(
  left: number | undefined,
  right: number | undefined,
): number | undefined {
  if (left === undefined && right === undefined) {
    return undefined;
  }
  return (left ?? 0) + (right ?? 0);
}

export async function writeSessionMemory(options: {
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

export function appendRawHistoryEntry(options: {
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

export async function writeAtomicMemories(options: {
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

export function truncateHistoryContent(value: string): string {
  const normalized = value.trim();
  if (normalized.length <= 4_000) {
    return normalized;
  }
  return `${normalized.slice(0, 4_000)}\n[truncated]`;
}

export function compactMessageIds(...ids: Array<string | null>): string[] {
  return ids.filter((id): id is string => Boolean(id));
}

export function toRelatedMemory(result: MemorySearchResult): ChatRelatedMemory {
  return {
    id: result.record.id,
    title: result.record.title,
    kind: result.record.kind,
    score: result.score,
  };
}

export function getNativeToolDescriptor(
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

export function getToolRegistrySource(
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

export function buildNativeToolEvidencePayload(
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

export function truncateText(value: string, maxLength: number): string {
  const normalized = value.trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1)}…`;
}

