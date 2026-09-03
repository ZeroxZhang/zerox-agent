import { ChatContinuationState } from "../chatService";
import { appendAssistantMessage } from "./modulemessages";
import { ChatGoalRuntimeReplanService } from "../chatService";
import { ChatGoalAmendmentService } from "../chatService";
import { ChatPlanService } from "../chatService";
import { ChatGoalDraftService } from "../chatService";
import { ChatGoalService } from "../chatService";
import { GoalIntentRoute } from "../chatService";
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
export function getStatusEventToolCallId(event: ChatTaskStatusEvent): string {
  return [
    event.sessionId,
    event.createdAt,
    event.toolName ?? "tool",
    event.toolCallsExecuted ?? 0,
  ]
    .map((value) => sanitizeRuntimeId(String(value)))
    .join("_");
}

export async function resolveChatWorkspace(options: {
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

export function buildChatWorkspaceSummary(
  runContext: AgentRunContext,
): ChatWorkspaceSummary {
  return {
    name: path.basename(runContext.workspaceRoot) || runContext.workspaceRoot,
    rootPath: runContext.workspaceRoot,
    kind: "project",
    sandboxMode: runContext.sandbox.mode,
  };
}

export function buildRuntimeContextMemoryScopes(options: {
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

export function createChatRuntimeTask(options: {
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

export function extendRunContextForSelectedSkill(options: {
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

export function readSkillPermissionPaths(
  skill: SkillRecord | undefined,
  values?: Record<string, SkillInputValue>,
): string[] {
  return (skill?.manifest.permissions.files.read ?? []).map((permissionPath) =>
    resolveSkillPermissionPath(permissionPath, skill, values),
  );
}

export function writeSkillPermissionPaths(
  skill: SkillRecord | undefined,
  values?: Record<string, SkillInputValue>,
): string[] {
  return (skill?.manifest.permissions.files.write ?? []).map((permissionPath) =>
    resolveSkillPermissionPath(permissionPath, skill, values),
  );
}

export function resolveSkillPermissionPath(
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

export function sanitizeRuntimeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "run";
}

export function createChatWorkspaceRunId(sessionId: string, requestId: string): string {
  return `chat_run_${sanitizeRuntimeId(sessionId)}_${sanitizeRuntimeId(requestId)}`;
}

export function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function normalizeReasoningForStatus(reasoningContent: string): string {
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

export function buildToolResultStatusMessage(
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

export function emitActorToolStatusEvents(options: {
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

export function emitActorSpawnedStatusEvent(options: {
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

export function normalizeActorStatusId(value: string): string {
  if (!value) {
    return "";
  }
  return /^[a-zA-Z0-9_-]{1,160}$/.test(value)
    ? value
    : "actor_redacted";
}

export function normalizeActorStatus(
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

export function buildActorDoneStatusMessage(status: string, summary: string): string {
  if (status === "done") {
    return `子代理已完成：${summary}`;
  }
  if (status === "canceled") {
    return `子代理已取消：${summary}`;
  }
  return `子代理失败：${summary}`;
}

export function getActorToolResultPayload(
  result: Awaited<ReturnType<AgentToolExecutor["execute"]>>,
): Record<string, unknown> {
  if (result.ok) {
    return result.result;
  }
  return result.errorDetails ?? {};
}

export function readToolArgString(
  args: Record<string, unknown>,
  key: string,
): string {
  const value = args[key];
  return typeof value === "string" ? value : "";
}

export function summarizeToolError(error: string): string {
  const normalized = redactCredentialString(error).replace(/\s+/g, " ").trim();
  if (normalized.length <= 180) {
    return normalized || "未知错误";
  }
  return `${normalized.slice(0, 179)}…`;
}

export function isAbortError(error: unknown, signal: AbortSignal | undefined): boolean {
  if (signal?.aborted) {
    return true;
  }

  return error instanceof Error && /abort|aborted|cancel|canceled|cancelled|中断|取消/i.test(error.message);
}

export async function waitForTurnOrAbort(
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

export function isContinuationRequest(message: string): boolean {
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

export function detectGoalIntent(message: string): GoalIntentRoute {
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

export function extractExplicitGoalAmendmentObjective(message: string): string | null {
  const match = message
    .trim()
    .match(
      /^(?:目标改一下|修改目标|调整目标)(?:\s*[:：]\s*|\s+)(.+)$/,
    );
  return match?.[1]?.trim() || null;
}

export function extractGoalDescription(message: string): string {
  return (
    message
      .replace(/^(把这轮设为目标|这轮目标是|接下来目标是|目标)\s*[:：]?\s*/i, "")
      .trim() || message.trim()
  );
}

export function getActiveGoalSummary(
  session: AppendChatMessageResult["session"],
): ChatSessionGoalSummary | null {
  return getActionableGoalSummary(session) ?? null;
}

export function emitGoalRequirementStatusEvents(options: {
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

export function deriveGoalRequirementLabels(description: string): string[] {
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

export function formatPlanContinuationReply(plan: PlanRecord): string {
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

export function formatLockedPlanReply(plan: PlanRecord): string {
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

export function formatAgentLoopFailure(summary: string): string {
  if (summary.startsWith("Token budget exceeded:")) {
    return "检测到旧版 Token 预算停止记录，任务未完成（只读）";
  }
  if (summary.startsWith("Wall-clock budget exceeded")) {
    return "检测到旧版运行时间预算停止记录，任务未完成（只读）";
  }
  return "Agent 执行失败，任务未完成";
}

export function modelNoticeContinuationReason(
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

export async function tryRouteGoalIntent(options: {
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

export function isTerminalGoalStatus(status: ChatSessionGoalSummary["status"]): boolean {
  return (
    status === "achieved" ||
    status === "stopped_stalled" ||
    status === "failed" ||
    status === "canceled"
  );
}

export async function syncChatGoalSummary(
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

export function shouldClearActiveChatGoal(
  status: ChatSessionGoalSummary["status"],
): boolean {
  return !isLiveGoalStatus(status);
}

export function buildContinuationMessages(options: {
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

