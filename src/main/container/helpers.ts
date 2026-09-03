import { app, BrowserWindow, safeStorage } from "electron";

import { createHash, randomUUID } from "node:crypto";

import path from "node:path";

import {
  createAgentExecutionStore,
  type AgentExecutionStore,
} from "../agentExecutionStore";

import {
  createAgentTrajectoryStore,
  type AgentTrajectoryStore,
} from "../agentTrajectoryStore";

import { createAgentLearningStore } from "../agentLearningStore";

import { createAgentLearningService } from "../agentLearningService";

import { createAgentEvalCandidateStore } from "../agentEvalCandidateStore";

import { createAgentEvalCandidateService } from "../agentEvalCandidateService";

import { createAgentWorkspaceStore } from "../agentWorkspaceStore";

import { createWorkspaceRunStore } from "../workspaceRunStore";

import { reconcileInterruptedToolApprovals } from "../interruptedToolApprovalReconciler";

import type { WorkspaceRunEvent } from "../../shared/workspaceRunLedger";

import {
  createConversationCausalStore,
  type ConversationCausalStore,
} from "../conversationCausalStore";

import {
  createConversationDisclosureMaterializer,
  type ConversationDisclosureMaterializer,
} from "../conversationDisclosureMaterializer";

import type {
  ConversationContextObservation,
  ConversationGoalLedgerRead,
  ConversationUsageObservation,
} from "../conversationDisclosureAdapters";

import {
  createConversationEvidenceResolver,
  type ConversationEvidenceBackendResult,
  type TrustedConversationEvidenceContext,
} from "../conversationEvidenceResolver";

import {
  createAgentGoalStore,
  type AgentGoalStore,
} from "../agentGoalStore";

import { createAgentGoalController } from "../agentGoalController";

import {
  createAgentGoalAcceptance,
  createBuiltinGoalAcceptanceValidators,
} from "../agentGoalAcceptance";

import {
  createAgentGoalValidatorRegistry,
  type AcceptanceValidator,
} from "../agentGoalValidatorRegistry";

import { createAgentGoalContext } from "../agentGoalContext";

import { createAgentGoalPlanner } from "../agentGoalPlanner";

import { createGoalRuntimeEngine } from "../goalRuntimeEngine";

import {
  resolveGoalExecutionModelBinding,
  selectPlanExecutionModelBinding,
  selectRuntimeDirectProfileId,
} from "../goalExecutionModel";

import { createAuthorizedGoalAcceptanceToolExecutor } from "../agentGoalAcceptanceToolExecutor";

import { applyGoalOutputRootsToRunContext } from "../goalOutputRoots";

import {
  createGoalChatService,
  type GoalChatService,
} from "../goalChatService";

import { createAgentGoalTranslator } from "../agentGoalTranslator";

import { createGoalDraftService } from "../goalDraftService";

import {
  createAgentWorkspaceService,
  type AgentWorkspaceService,
  type CreateGitWorktreeWorkspaceInput,
} from "../agentWorkspaceService";

import { createMultiAgentSessionStore } from "../multiAgentSessionStore";

import { createMultiAgentCoordinator } from "../multiAgentCoordinator";

import { createAgentEvalFixtures } from "../eval/agentEvalFixtures";

import {
  createCombinedAgentEvalFixtures,
  createPromotedAgentEvalFixtureStore,
} from "../eval/agentPromotedEvalFixtures";

import { runAgentEvals } from "../eval/agentEvalRunner";

import { createAgentRunStore, type AgentRunStore } from "../agentRunStore";

import { createAgentRunnerService } from "../agentRunnerService";

import { runAgentLoop } from "../agentLoop";

import { createAgentBootstrapService } from "../agentBootstrapService";

import { createAgentValidationStore } from "../agentValidationStore";

import { createAgentToolExecutor } from "../agentToolExecutor";

import { createChatService } from "../chatService";

import {
  createChatSessionStore,
  type ChatSessionStore,
} from "../chatSessionStore";

import {
  createElectronSecretVault,
  createModelSettingsStore,
  type ModelSettingsStore,
} from "../modelSettingsStore";

import { createModelConnectionService } from "../modelConnectionService";

import { providerSupportsEmbeddings } from "../providers/providerRegistry";

import {
  createMemoryStore,
  type MemoryEmbeddingService,
  type MemoryStore,
} from "../memoryStore";

import { createMemoryProfileStore } from "../memoryProfileStore";

import { createHistoryIndexStore } from "../historyIndexStore";

import { createMemoryIngestionService } from "../memoryIngestionService";

import {
  createToolResultOffloadStore,
  issueToolResultRefReadCapability,
  type ToolResultOffloadReadScope,
} from "../toolResultOffloadStore";

import {
  createOpenAiCompatibleClient,
  createOpenAiCompatibleEmbeddingClient,
  type ChatClient,
  type StreamingChatClient,
} from "../openAiCompatibleClient";

import type { AgentModelProfile } from "../agentRunnerService";

import {
  discoverSkills,
  collectSkillMcpConfigs,
  readTrustedSkillMcpAllowlist,
  shouldAutoInitializeSkillMcp,
} from "../skillRegistry";

import type { McpClient } from "../mcpClient";

import { createSkillMcpClient } from "../skillMcpClient";

import { createMaxMode } from "../providers/maxMode";

import { createScheduledTaskStore } from "../taskStore";

import { createTaskSchedulerService } from "../taskSchedulerService";

import { createToolAuditLog } from "../toolAuditLog";

import { getDefaultTaskPermissionPolicy } from "../../shared/toolPermissions";

import { KernelEventBus } from "../kernel/eventBus";

import { createProductionKernelDriver } from "../kernel/productionKernelDriver";

import { productionKernelCovers } from "../kernel/productionKernelScope";

import { createToolRuntime } from "../toolRuntime";

import { registerReadCodeTool } from "../readCodeTool";

import { createStorageImpl } from "../storage/storageDb";

import {
  requireStorageBackendAvailability,
  resolveStorageBackend,
} from "../storage/backendResolver";

import { bootstrapSqliteDomainAuthority } from "../storage/domainAuthorityBootstrap";

import {
  createProvider,
  resolveProviderBaseUrl,
} from "../providers/providerFactory";

import { createSettingsBackedChatClient } from "../providers/providerChatClient";

import { createModelRouter } from "../providers/modelRouter";

import { createPlanStore, PlanVersionConflictError } from "../planStore";

import { createPlanArtifactWriter } from "../planArtifactWriter";

import { createPlanDebateOrchestrator } from "../planDebateOrchestrator";

import { createPlanInvestigatorService } from "../planInvestigatorService";

import {
  createPlanQualityReport,
  derivePlanCriterionBindings,
} from "../plannerKernel";

import { resolveSkillInput } from "../skillExecutionService";

import { verifyPlanEvidence } from "../planEvidenceVerifier";

import {
  isPlanConfirmable,
  type AdoptGoalPlanInput,
  type AdoptGoalPlanResult,
  type ConfirmPlanInput,
  type ConfirmPlanResult,
  type CreateRuntimeGoalPlanResult,
  type GoalAmendmentOperationResult,
  type PlanArtifact,
  type PlanningStageKind,
  type PlanRecord,
  type PlanStatus,
  type ProposeGoalAmendmentInput,
} from "../../shared/planMode";

import {
  isGoalContractSnapshot,
  type GoalContractRef,
  type GoalContractSnapshot,
  type GoalPlanHistoryEntry,
  type GoalPlanRef,
} from "../../shared/goalPlanContract";

import { createGoalContractRef } from "../goalPlanContractService";

import { validatePlanMilestoneGraph } from "../../shared/planValidation";

import { toNormalized } from "../providers/normalize";

import { analyzeShell } from "../tools/shell/shellAnalyzer";

import { createToolWorker } from "../tools/toolWorker";

import { getToolWorkerOptions } from "../tools/toolWorkerOptions";

import {
  resolveCompactionFlag,
  selectCompactionStrategy,
} from "../kernel/compactionStrategy";

import { createContextManager } from "../contextManager";

import { replayContextSurface } from "../contextSurface";

import { createActorRuntime } from "../actors/actorRuntime";

import { createCheckpointWriterOrchestrator } from "../actors/checkpointWriterOrchestrator";

import { runCheckpointWriterActor } from "../actors/checkpointWriterActor";

import {
  createWorkflowActorHostHook,
  createWorkflowRuntime,
} from "../workflow/workflowRuntime";

import { registerDeepResearchWorkflow } from "../workflow/deepResearchWorkflow";

import { registerActorTool } from "../actors/actorTool";

import { readFeatureFlags } from "../../shared/featureFlags";

import {
  createCheckpointRepository,
} from "../storage/repositories/checkpointRepository";

import { createRunRepository, createTrajectoryRepository } from "../storage/repositories/runRepository";

import { createMemoryRepository } from "../storage/repositories/memoryRepository";

import { createSessionRepository } from "../storage/repositories/sessionRepository";

import { createSelfImprovementService } from "../actors/selfImprovementService";

import { createProcessSandboxProvider } from "../processSandbox";

import { runProductionStorageSmokeProbe } from "../productionSmokeStorage";

import type { Storage } from "../../shared/storageContract";

import {
  createToolAuthorizationService,
  type ToolUserApprovalResult,
  type ToolUserApprovalRequest,
  type ToolUserApprovalRequestOptions,
} from "../toolAuthorizationService";

import { getAppMeta } from "../../shared/appMeta";

import { getNavigationSections } from "../../shared/navigation";

import {
  projectGoalStatusForInteraction,
  upgradeGoalAcceptanceProtocol,
  type Goal,
  type GoalBudget,
  type GoalSelectedSkill,
  type SuccessCriterion,
} from "../../shared/agentGoal";

import { verifySelectedSkillAuthority } from "../selectedSkillAuthority";

import type { GoalReviewPolicy } from "../../shared/agentGoalReview";

import { compileAgentTaskContract } from "../../shared/agentTaskContract";

import type {
  GoalDraftConfirmResult,
  GoalDraftDiscardResult,
  GoalDraft,
  GoalDraftEdit,
} from "../../shared/goalTranslation";

import type {
  ChatSessionGoalSummary,
  ChatSessionListItem,
  ChatSessionOperationResult,
  ChatSessionRecord,
  ChatSessionTranscriptPage,
  ChatSessionTranscriptPageOptions,
  GoalProgressEvent,
} from "../../shared/chat";

import {
  getActiveGoalSummary,
  getRecoveryGoalSummary,
  isLiveGoalStatus,
} from "../../shared/chatSessionWork";

import { projectChatSessionTokenUsage } from "../chatSessionUsage";

import {
  AgentRunRevisionConflictError,
  resolveAgentRunExecutionRevision,
  type AgentRunAdmissionCandidate,
  type AgentRunEvent,
  type AgentRunRecord,
  type AgentRunStatus,
  type CancelScheduledTaskRunResult,
  type OpenAgentRunSessionResult,
  type PauseAgentRunResult,
  type RunScheduledTaskResult,
} from "../../shared/agentRuns";

import {
  createConversationRequestFingerprint,
  type ConversationCausalRecord,
  type ConversationAgentRunOwnerFact,
  type ToolApprovalIntent,
} from "../../shared/conversationCausalSpine";

import { describeSchedule, type ScheduledTask } from "../../shared/scheduledTasks";

import {
  isTerminalExecutionStatus,
  type AgentExecutionCheckpoint,
} from "../../shared/agentExecution";

import {
  createDefaultMemoryEvalCases,
  runMemoryEvals as evaluateMemory,
  type MemoryEvalReport,
} from "../../shared/memoryEval";

import type { AgentEvalReport } from "../../shared/agentEval";

import { buildDesktopRuntimeInfo, type DesktopRuntimeInfo } from "../../shared/desktopRuntime";

import {
  extractToolResultRef,
  isSafeToolResultRef,
  summarizeToolResultContent,
  type ReadToolResultRefOptions,
  type ReadToolResultRefResult,
} from "../../shared/toolResultRefs";

import { projectChatSessionForTranscript } from "../../shared/chatSessionProjection";

import type { KernelRunStatus, PermissionRule } from "../../shared/kernelContract";

import type {
  ConversationDisclosureScope,
  ConversationEvidenceTarget,
} from "../../shared/conversationDisclosure";

import type { ToolInvocationRecord } from "../../shared/toolInvocationLedger";

export function evidenceTargetRunId(
  target: ConversationEvidenceTarget,
): string | undefined {
  switch (target.kind) {
    case "agent_run_event":
    case "trajectory_event":
    case "tool_invocation":
    case "checkpoint":
      return target.runId;
    case "goal_record":
    case "plan_record":
    case "contributor_page":
    case "generic_source":
      return undefined;
  }
}

export function causalRecordReferencesRun(
  record: ConversationCausalRecord,
  runId: string,
): boolean {
  return Boolean(
    record.agentRunAdmissions?.some((entry) => entry.runId === runId)
    || record.refs.some((entry) =>
      entry.kind === "tool_invocation"
        ? entry.runId === runId
        : (
            entry.kind === "agent_run"
            || entry.kind === "trajectory_run"
            || entry.kind === "workspace_run"
          )
          && entry.id === runId),
  );
}

export function approvalReferencesRun(
  approval: ToolApprovalIntent,
  runId: string,
): boolean {
  return [
    approval.causalRef.agentRunId,
    approval.causalRef.trajectoryRunId,
    approval.causalRef.workspaceRunId,
    approval.causalRef.kernelRunId,
    approval.causalRef.toolInvocationRunId,
  ].includes(runId);
}

export function kernelObservationStatus(
  event: ReturnType<KernelEventBus["history"]>[number],
): KernelRunStatus {
  return event.type === "run_end" ? event.status : "running";
}

export function toolInvocationFromTrajectoryEvent(
  event: import("../../shared/agentTrajectory").AgentTrajectoryEvent,
  invocationId: string,
): ToolInvocationRecord | null {
  const rawStatus = event.payload.invocationStatus;
  const status = typeof rawStatus === "string"
    && isToolInvocationStatus(rawStatus)
    ? rawStatus
    : event.type === "tool_result"
      ? event.payload.ok === false
        ? "error"
        : "completed"
      : event.type === "tool_invocation"
        || event.type === "native_tool_invocation"
        ? "running"
        : null;
  if (!status) return null;
  const toolCallId = typeof event.payload.toolCallId === "string"
    ? event.payload.toolCallId
    : invocationId;
  const toolName = typeof event.payload.toolName === "string"
    ? event.payload.toolName
    : "tool";
  return {
    id: invocationId,
    runId: event.runId,
    toolCallId,
    toolName,
    source: "trajectory",
    args: {},
    status,
    createdAt: event.createdAt,
    updatedAt: event.createdAt,
    ...(typeof event.payload.ok === "boolean"
      ? { ok: event.payload.ok }
      : {}),
    history: [{
      status,
      at: event.createdAt,
      ...(typeof event.payload.ok === "boolean"
        ? { ok: event.payload.ok }
        : {}),
    }],
  };
}

export function toolInvocationFromWorkspaceEvent(
  event: WorkspaceRunEvent,
): ToolInvocationRecord | null {
  if (
    event.type !== "tool_invocation"
    || !isToolInvocationStatus(event.invocationStatus)
  ) {
    return null;
  }
  const payloadRunId = event.payload?.runId;
  const runId = typeof payloadRunId === "string" && payloadRunId
    ? payloadRunId
    : event.workspaceRunId;
  return {
    id: event.toolInvocationId,
    runId,
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    source: event.toolSource ?? "workspace_run",
    args: {},
    status: event.invocationStatus,
    createdAt: event.createdAt,
    updatedAt: event.createdAt,
    ...(typeof event.ok === "boolean" ? { ok: event.ok } : {}),
    ...(event.resultRef ? { resultRef: event.resultRef } : {}),
    ...(event.error ? { error: event.error } : {}),
    ...(event.approvalId ? { approvalId: event.approvalId } : {}),
    history: [{
      status: event.invocationStatus,
      at: event.createdAt,
      ...(typeof event.ok === "boolean" ? { ok: event.ok } : {}),
      ...(event.resultRef ? { resultRef: event.resultRef } : {}),
      ...(event.error ? { error: event.error } : {}),
      ...(event.approvalId ? { approvalId: event.approvalId } : {}),
    }],
  };
}

export function toolEvidenceCandidateFingerprint(
  invocation: ToolInvocationRecord,
): string {
  return createHash("sha256").update(JSON.stringify({
    id: invocation.id,
    runId: invocation.runId,
    toolCallId: invocation.toolCallId,
    toolName: invocation.toolName,
    source: invocation.source,
    status: invocation.status,
    createdAt: invocation.createdAt,
    updatedAt: invocation.updatedAt,
    ok: invocation.ok ?? null,
    resultRef: invocation.resultRef ?? null,
    error: invocation.error ?? null,
    approvalId: invocation.approvalId ?? null,
  })).digest("hex");
}

export function toolEvidenceSemanticFingerprint(
  invocation: ToolInvocationRecord,
): string {
  return createHash("sha256").update(JSON.stringify({
    id: invocation.id,
    runId: invocation.runId,
    toolCallId: invocation.toolCallId,
    toolName: invocation.toolName,
    status: invocation.status,
    updatedAt: invocation.updatedAt,
    ok: invocation.ok ?? null,
  })).digest("hex");
}

export function toolEvidenceIdentityFingerprint(
  invocation: ToolInvocationRecord,
): string {
  return createHash("sha256").update(JSON.stringify({
    id: invocation.id,
    runId: invocation.runId,
    toolCallId: invocation.toolCallId,
    toolName: invocation.toolName,
  })).digest("hex");
}

export function toolEvidenceCandidatesConflict(
  candidates: readonly {
    sourceAuthority: string;
    bodyFingerprint: string;
    semanticFingerprint: string;
  }[],
): boolean {
  if (
    new Set(candidates.map((candidate) => candidate.semanticFingerprint)).size
      > 1
  ) {
    return true;
  }
  const bodiesBySource = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    const bodies = bodiesBySource.get(candidate.sourceAuthority) ?? new Set();
    bodies.add(candidate.bodyFingerprint);
    bodiesBySource.set(candidate.sourceAuthority, bodies);
  }
  return [...bodiesBySource.values()].some((bodies) => bodies.size > 1);
}

export function toolCandidatesConflict(
  invocations: readonly ToolInvocationRecord[],
): boolean {
  const bodiesByRevision = new Map<string, string>();
  for (const invocation of invocations) {
    const revision = invocation.updatedAt;
    const fingerprint = toolEvidenceCandidateFingerprint(invocation);
    const existing = bodiesByRevision.get(revision);
    if (existing && existing !== fingerprint) return true;
    bodiesByRevision.set(revision, fingerprint);
  }
  return false;
}

export function isToolInvocationStatus(
  value: string,
): value is ToolInvocationRecord["status"] {
  return [
    "proposed",
    "visible",
    "authorized",
    "waiting_approval",
    "running",
    "completed",
    "error",
    "recovered",
    "aborted",
  ].includes(value);
}

export function prepareInterruptedGoalForResume(goal: Goal): Goal {
  if (
    goal.status === "executing" &&
    goal.acceptanceState?.phase === "retrying" &&
    goal.acceptanceRetryState?.resumeFrom === "final_judge"
  ) {
    const { nextRetryAt: _nextRetryAt, ...retryState } =
      goal.acceptanceRetryState;
    return {
      ...goal,
      status: "waiting_for_acceptance",
      stopReason: undefined,
      acceptanceState: {
        ...goal.acceptanceState,
        phase: "awaiting_user",
      },
      acceptanceRetryState: retryState,
    };
  }

  let changed = false;
  const milestones = goal.milestones.map((milestone) => {
    if (milestone.state !== "running") {
      return milestone;
    }
    changed = true;
    return { ...milestone, state: "ready" as const };
  });
  if (goal.status === "executing") {
    changed = true;
    return {
      ...goal,
      milestones,
      status: "stopped_blocked" as const,
      stopReason: "external_blocked" as const,
    };
  }
  return changed ? { ...goal, milestones } : goal;
}

export function reconcileIrreversibleGoalProgressEvent(
  event: GoalProgressEvent,
  goal: Goal | null,
): GoalProgressEvent {
  if (
    !goal ||
    (goal.status !== "achieved" &&
      goal.status !== "completed_unverified" &&
      goal.status !== "canceled")
  ) {
    return event;
  }

  if (
    event.status === goal.status &&
    (event.event === "stopped" ||
      (goal.status === "achieved" && event.event === "acceptance_certified"))
  ) {
    return event;
  }

  return {
    ...event,
    status: goal.status,
    event: "stopped",
    message:
      goal.status === "achieved"
        ? "目标已达成。"
        : goal.status === "completed_unverified"
          ? "目标已手动完成（未经机器认证）。"
          : "目标已取消。",
  };
}

export function formatScheduledTaskRunPrompt(task: ScheduledTask): string {
  const request =
    typeof task.input.request === "string" ? task.input.request.trim() : "";
  const lines = [
    `定时任务：${task.name}`,
    "",
    request || `执行本地任务“${task.name}”。`,
    "",
    `调度：${describeSchedule(task.schedule)}`,
  ];

  return lines.join("\n");
}

export function formatAgentRunSessionPrompt(
  task: ScheduledTask | null,
  run: AgentRunRecord | null,
  checkpoint: AgentExecutionCheckpoint | null,
): string {
  if (task) {
    return formatScheduledTaskRunPrompt(task);
  }

  const title = run?.taskName ?? checkpoint?.taskId ?? "未知任务";
  return [
    `任务运行：${title}`,
    "",
    "打开这次任务的执行上下文。",
  ].join("\n");
}

export function formatAgentRunSessionStatus(
  task: ScheduledTask | null,
  run: AgentRunRecord | null,
  checkpoint: AgentExecutionCheckpoint | null,
): string {
  const title = task?.name ?? run?.taskName ?? checkpoint?.taskId ?? "未知任务";

  if (checkpoint) {
    const lines = [
      `已打开任务运行：${title}`,
      `状态：${translateExecutionStatus(checkpoint.status)}`,
    ];
    const currentStep =
      checkpoint.steps.find((step) => step.id === checkpoint.currentStepId) ??
      checkpoint.steps[0];
    if (currentStep) {
      lines.push(
        `当前步骤：${currentStep.description || currentStep.id}`,
        `步骤状态：${translateExecutionStepState(currentStep.state)}`,
      );
      if (currentStep.failureMessage) {
        lines.push(`失败原因：${currentStep.failureMessage}`);
      }
    }
    lines.push("", "你可以在这里继续查看这次定时任务的上下文。");
    return lines.join("\n");
  }

  if (run) {
    return [
      `已打开任务运行：${title}`,
      `状态：${formatRunStatusForChat(run.status)}`,
      "",
      run.summary || "这次运行没有摘要。",
    ].join("\n");
  }

  return `已打开任务运行：${title}`;
}

export function translateExecutionStatus(
  status: AgentExecutionCheckpoint["status"],
): string {
  const labels: Record<AgentExecutionCheckpoint["status"], string> = {
    canceled: "已取消",
    failed: "失败",
    paused: "已暂停",
    queued: "排队中",
    running: "运行中",
    succeeded: "成功",
    waiting_for_approval: "等待授权",
  };

  return labels[status];
}

export function translateExecutionStepState(
  state: AgentExecutionCheckpoint["steps"][number]["state"],
): string {
  const labels: Record<
    AgentExecutionCheckpoint["steps"][number]["state"],
    string
  > = {
    completed: "已完成",
    failed: "失败",
    pending: "等待开始",
    running: "运行中",
    skipped: "已跳过",
    waiting_for_approval: "等待授权",
    waiting_for_tool: "等待工具",
  };

  return labels[state];
}

export function formatScheduledTaskRunResult(result: RunScheduledTaskResult): string {
  if (!result.ok) {
    return `定时任务没有启动：${result.message}`;
  }

  return [
    `定时任务运行完成：${formatRunStatusForChat(result.run.status)}。`,
    "",
    result.run.summary || "没有生成摘要。",
  ].join("\n");
}

export function formatRunStatusForChat(status: AgentRunStatus): string {
  switch (status) {
    case "succeeded":
      return "成功";
    case "failed":
      return "失败";
    case "canceled":
      return "已取消";
    case "paused":
      return "已暂停";
    case "waiting_for_approval":
      return "等待授权";
    case "running":
      return "正在运行";
    case "queued":
      return "排队中";
  }
}

export function isLivePlanReference(status: PlanStatus): boolean {
  return (
    status === "drafting" ||
    status === "paused" ||
    status === "awaiting_input" ||
    status === "awaiting_confirmation" ||
    status === "confirmed_pending_execution" ||
    status === "executing"
  );
}

export function planStatusForExecutionGoal(
  status: ChatSessionGoalSummary["status"],
): PlanStatus {
  if (status === "achieved") {
    return "completed";
  }
  if (status === "completed_unverified" || status === "waiting_for_acceptance") {
    return "steps_completed";
  }
  if (status === "canceled") {
    return "canceled";
  }
  if (
    status === "failed" ||
    status === "stopped_budget" ||
    status === "stopped_stalled" ||
    status === "stopped_blocked"
  ) {
    return "failed";
  }
  if (status === "waiting_for_review" || status === "waiting_for_model") {
    return "paused";
  }
  return "executing";
}

export function buildGoalSuccessCriteriaFromPlan(plan: PlanRecord): SuccessCriterion[] {
  const artifact = plan.finalArtifact;
  const contract = plan.goalContractSnapshot;
  if (!artifact || !contract) {
    throw new Error("运行期 Plan 缺少 Goal 成功标准投影。");
  }
  const bindings =
    plan.criterionBindings?.length
      ? plan.criterionBindings
      : derivePlanCriterionBindings(artifact, contract);
  const checksById = new Map(
    [
      ...(artifact.acceptanceChecks ?? []),
      ...artifact.milestones.flatMap(
        (milestone) => milestone.acceptanceChecks ?? [],
      ),
    ].map((check) => [check.id, check]),
  );
  const bindingsByCriterion = new Map(
    bindings.map((binding) => [binding.criterionId, binding]),
  );
  return contract.successCriteria.map((criterion) => {
    const acceptanceChecks = (
      bindingsByCriterion.get(criterion.id)?.checkIds ?? []
    ).flatMap((checkId) => {
      const check = checksById.get(checkId);
      return check ? [structuredClone(check)] : [];
    });
    return {
      id: criterion.id,
      description: criterion.description,
      acceptanceChecks:
        acceptanceChecks.length > 0
          ? acceptanceChecks
          : [
              {
                id: `${criterion.id}_review`,
                kind: "model_review" as const,
                description: "根据执行轨迹和产物验证 GoalContract 成功标准。",
                params: {
                  condition: criterion.description,
                  evidenceRefs: ["artifact:goalEvidence"],
                },
                requiresEvidence: true,
              },
            ],
    };
  });
}

export function milestoneDefinitionHash(
  milestone: Pick<Goal["milestones"][number], "id" | "description" | "dependsOn" | "successCriteria">,
): string {
  const canonical = {
    id: milestone.id,
    description: milestone.description,
    dependsOn: [...milestone.dependsOn].sort(),
    successCriteria: milestone.successCriteria.map((criterion) => ({
      id: criterion.id,
      description: criterion.description,
      acceptanceChecks: criterion.acceptanceChecks.map((check) => ({
        id: check.id,
        kind: check.kind,
        description: check.description,
        params: check.params,
        requiresEvidence: check.requiresEvidence,
      })),
    })),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function defaultSelectedSkillInputValues(
  plan: PlanRecord,
): Pick<GoalDraft, "selectedSkillInputValues"> {
  const entries =
    plan.selectedSkill?.manifest.inputs.flatMap((input) =>
      input.defaultValue === undefined
        ? []
        : [[input.name, input.defaultValue] as const],
    ) ?? [];
  return entries.length > 0
    ? { selectedSkillInputValues: Object.fromEntries(entries) }
    : {};
}

