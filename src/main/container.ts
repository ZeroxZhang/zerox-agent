import { createPlanOpsRuntime } from "./container/planOps";
import { createDisclosureRuntime } from "./container/disclosure";
import { createChatSessionsRuntime } from "./container/chatSessions";
import { prepareInterruptedGoalForResume } from "./container/helpers";
import { milestoneDefinitionHash } from "./container/helpers";
import { defaultSelectedSkillInputValues } from "./container/helpers";
import { buildGoalSuccessCriteriaFromPlan } from "./container/helpers";
import { planStatusForExecutionGoal } from "./container/helpers";
import { formatAgentRunSessionStatus } from "./container/helpers";
import { formatAgentRunSessionPrompt } from "./container/helpers";
import { formatScheduledTaskRunResult } from "./container/helpers";
import { formatScheduledTaskRunPrompt } from "./container/helpers";
import { toolEvidenceCandidatesConflict } from "./container/helpers";
import { toolEvidenceSemanticFingerprint } from "./container/helpers";
import { toolEvidenceIdentityFingerprint } from "./container/helpers";
import { toolEvidenceCandidateFingerprint } from "./container/helpers";
import { evidenceTargetRunId } from "./container/helpers";
import { approvalReferencesRun } from "./container/helpers";
import { kernelObservationStatus } from "./container/helpers";
import { toolInvocationFromTrajectoryEvent } from "./container/helpers";
import { toolCandidatesConflict } from "./container/helpers";
import { toolInvocationFromWorkspaceEvent } from "./container/helpers";
import { causalRecordReferencesRun } from "./container/helpers";
import { reconcileIrreversibleGoalProgressEvent } from "./container/helpers";
import { isLivePlanReference } from "./container/helpers";
import { app, BrowserWindow, safeStorage } from "electron";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import {
  createAgentExecutionStore,
  type AgentExecutionStore,
} from "./agentExecutionStore";
import {
  createAgentTrajectoryStore,
  type AgentTrajectoryStore,
} from "./agentTrajectoryStore";
import { createAgentLearningStore } from "./agentLearningStore";
import { createAgentLearningService } from "./agentLearningService";
import { createAgentEvalCandidateStore } from "./agentEvalCandidateStore";
import { createAgentEvalCandidateService } from "./agentEvalCandidateService";
import { createAgentWorkspaceStore } from "./agentWorkspaceStore";
import { createWorkspaceRunStore } from "./workspaceRunStore";
import { reconcileInterruptedToolApprovals } from "./interruptedToolApprovalReconciler";
import type { WorkspaceRunEvent } from "../shared/workspaceRunLedger";
import {
  createConversationCausalStore,
  type ConversationCausalStore,
} from "./conversationCausalStore";
import {
  createConversationDisclosureMaterializer,
  type ConversationDisclosureMaterializer,
} from "./conversationDisclosureMaterializer";
import type {
  ConversationContextObservation,
  ConversationGoalLedgerRead,
  ConversationUsageObservation,
} from "./conversationDisclosureAdapters";
import {
  createConversationEvidenceResolver,
  type ConversationEvidenceBackendResult,
  type TrustedConversationEvidenceContext,
} from "./conversationEvidenceResolver";
import {
  createAgentGoalStore,
  type AgentGoalStore,
} from "./agentGoalStore";
import { createAgentGoalController } from "./agentGoalController";
import {
  createAgentGoalAcceptance,
  createBuiltinGoalAcceptanceValidators,
} from "./agentGoalAcceptance";
import {
  createAgentGoalValidatorRegistry,
  type AcceptanceValidator,
} from "./agentGoalValidatorRegistry";
import { createAgentGoalContext } from "./agentGoalContext";
import { createAgentGoalPlanner } from "./agentGoalPlanner";
import { createGoalRuntimeEngine } from "./goalRuntimeEngine";
import {
  resolveGoalExecutionModelBinding,
  selectPlanExecutionModelBinding,
  selectRuntimeDirectProfileId,
} from "./goalExecutionModel";
import { createAuthorizedGoalAcceptanceToolExecutor } from "./agentGoalAcceptanceToolExecutor";
import { applyGoalOutputRootsToRunContext } from "./goalOutputRoots";
import {
  createGoalChatService,
  type GoalChatService,
} from "./goalChatService";
import { createAgentGoalTranslator } from "./agentGoalTranslator";
import { createGoalDraftService } from "./goalDraftService";
import {
  createAgentWorkspaceService,
  type AgentWorkspaceService,
  type CreateGitWorktreeWorkspaceInput,
} from "./agentWorkspaceService";
import { createMultiAgentSessionStore } from "./multiAgentSessionStore";
import { createMultiAgentCoordinator } from "./multiAgentCoordinator";
import { createAgentEvalFixtures } from "./eval/agentEvalFixtures";
import {
  createCombinedAgentEvalFixtures,
  createPromotedAgentEvalFixtureStore,
} from "./eval/agentPromotedEvalFixtures";
import { runAgentEvals } from "./eval/agentEvalRunner";
import { createAgentRunStore, type AgentRunStore } from "./agentRunStore";
import { createAgentRunnerService } from "./agentRunnerService";
import { runAgentLoop } from "./agentLoop";
import { createAgentBootstrapService } from "./agentBootstrapService";
import { createAgentValidationStore } from "./agentValidationStore";
import { createAgentToolExecutor } from "./agentToolExecutor";
import { createChatService } from "./chatService";
import {
  createChatSessionStore,
  type ChatSessionStore,
} from "./chatSessionStore";
import {
  createElectronSecretVault,
  createModelSettingsStore,
  type ModelSettingsStore,
} from "./modelSettingsStore";
import { createModelConnectionService } from "./modelConnectionService";
import { providerSupportsEmbeddings } from "./providers/providerRegistry";
import {
  createMemoryStore,
  type MemoryEmbeddingService,
  type MemoryStore,
} from "./memoryStore";
import { createMemoryProfileStore } from "./memoryProfileStore";
import { createHistoryIndexStore } from "./historyIndexStore";
import { createMemoryIngestionService } from "./memoryIngestionService";
import {
  createToolResultOffloadStore,
  issueToolResultRefReadCapability,
  type ToolResultOffloadReadScope,
} from "./toolResultOffloadStore";
import {
  createOpenAiCompatibleClient,
  createOpenAiCompatibleEmbeddingClient,
  type ChatClient,
  type StreamingChatClient,
} from "./openAiCompatibleClient";
import type { AgentModelProfile } from "./agentRunnerService";
import {
  discoverSkills,
  collectSkillMcpConfigs,
  readTrustedSkillMcpAllowlist,
  shouldAutoInitializeSkillMcp,
} from "./skillRegistry";
import type { McpClient } from "./mcpClient";
import { createSkillMcpClient } from "./skillMcpClient";
import { createMaxMode } from "./providers/maxMode";
import { createScheduledTaskStore } from "./taskStore";
import { createTaskSchedulerService } from "./taskSchedulerService";
import { createToolAuditLog } from "./toolAuditLog";
import { getDefaultTaskPermissionPolicy } from "../shared/toolPermissions";
import { KernelEventBus } from "./kernel/eventBus";
import { createProductionKernelDriver } from "./kernel/productionKernelDriver";
import { productionKernelCovers } from "./kernel/productionKernelScope";
import { createToolRuntime } from "./toolRuntime";
import { registerReadCodeTool } from "./readCodeTool";
import { createStorageImpl } from "./storage/storageDb";
import {
  requireStorageBackendAvailability,
  resolveStorageBackend,
} from "./storage/backendResolver";
import { bootstrapSqliteDomainAuthority } from "./storage/domainAuthorityBootstrap";
import {
  createProvider,
  resolveProviderBaseUrl,
} from "./providers/providerFactory";
import { createSettingsBackedChatClient } from "./providers/providerChatClient";
import { createModelRouter } from "./providers/modelRouter";
import { createPlanStore, PlanVersionConflictError } from "./planStore";
import { createPlanArtifactWriter } from "./planArtifactWriter";
import { createPlanDebateOrchestrator } from "./planDebateOrchestrator";
import { createPlanInvestigatorService } from "./planInvestigatorService";
import {
  createPlanQualityReport,
  derivePlanCriterionBindings,
} from "./plannerKernel";
import { resolveSkillInput } from "./skillExecutionService";
import { verifyPlanEvidence } from "./planEvidenceVerifier";
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
} from "../shared/planMode";
import {
  isGoalContractSnapshot,
  type GoalContractRef,
  type GoalContractSnapshot,
  type GoalPlanHistoryEntry,
  type GoalPlanRef,
} from "../shared/goalPlanContract";
import { createGoalContractRef } from "./goalPlanContractService";
import { validatePlanMilestoneGraph } from "../shared/planValidation";
import { toNormalized } from "./providers/normalize";
import { analyzeShell } from "./tools/shell/shellAnalyzer";
import { createToolWorker } from "./tools/toolWorker";
import { getToolWorkerOptions } from "./tools/toolWorkerOptions";
import {
  resolveCompactionFlag,
  selectCompactionStrategy,
} from "./kernel/compactionStrategy";
import { createContextManager } from "./contextManager";
import { replayContextSurface } from "./contextSurface";
import { createActorRuntime } from "./actors/actorRuntime";
import { createCheckpointWriterOrchestrator } from "./actors/checkpointWriterOrchestrator";
import { runCheckpointWriterActor } from "./actors/checkpointWriterActor";
import {
  createWorkflowActorHostHook,
  createWorkflowRuntime,
} from "./workflow/workflowRuntime";
import { registerDeepResearchWorkflow } from "./workflow/deepResearchWorkflow";
import { registerActorTool } from "./actors/actorTool";
import { readFeatureFlags } from "../shared/featureFlags";
import {
  createCheckpointRepository,
} from "./storage/repositories/checkpointRepository";
import { createRunRepository, createTrajectoryRepository } from "./storage/repositories/runRepository";
import { createMemoryRepository } from "./storage/repositories/memoryRepository";
import { createSessionRepository } from "./storage/repositories/sessionRepository";
import { createSelfImprovementService } from "./actors/selfImprovementService";
import { createProcessSandboxProvider } from "./processSandbox";
import { runProductionStorageSmokeProbe } from "./productionSmokeStorage";
import type { Storage } from "../shared/storageContract";
import {
  createToolAuthorizationService,
  type ToolUserApprovalResult,
  type ToolUserApprovalRequest,
  type ToolUserApprovalRequestOptions,
} from "./toolAuthorizationService";
import { getAppMeta } from "../shared/appMeta";
import { getNavigationSections } from "../shared/navigation";
import {
  projectGoalStatusForInteraction,
  upgradeGoalAcceptanceProtocol,
  type Goal,
  type GoalBudget,
  type GoalSelectedSkill,
  type SuccessCriterion,
} from "../shared/agentGoal";
import { verifySelectedSkillAuthority } from "./selectedSkillAuthority";
import type { GoalReviewPolicy } from "../shared/agentGoalReview";
import { compileAgentTaskContract } from "../shared/agentTaskContract";
import type {
  GoalDraftConfirmResult,
  GoalDraftDiscardResult,
  GoalDraft,
  GoalDraftEdit,
} from "../shared/goalTranslation";
import type {
  ChatSessionGoalSummary,
  ChatSessionListItem,
  ChatSessionOperationResult,
  ChatSessionRecord,
  ChatSessionTranscriptPage,
  ChatSessionTranscriptPageOptions,
  GoalProgressEvent,
} from "../shared/chat";
import {
  getActiveGoalSummary,
  getRecoveryGoalSummary,
  isLiveGoalStatus,
} from "../shared/chatSessionWork";
import { projectChatSessionTokenUsage } from "./chatSessionUsage";
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
} from "../shared/agentRuns";
import {
  createConversationRequestFingerprint,
  type ConversationCausalRecord,
  type ConversationAgentRunOwnerFact,
  type ToolApprovalIntent,
} from "../shared/conversationCausalSpine";
import { describeSchedule, type ScheduledTask } from "../shared/scheduledTasks";
import {
  isTerminalExecutionStatus,
  type AgentExecutionCheckpoint,
} from "../shared/agentExecution";
import {
  createDefaultMemoryEvalCases,
  runMemoryEvals as evaluateMemory,
  type MemoryEvalReport,
} from "../shared/memoryEval";
import type { AgentEvalReport } from "../shared/agentEval";
import { buildDesktopRuntimeInfo, type DesktopRuntimeInfo } from "../shared/desktopRuntime";
import {
  extractToolResultRef,
  isSafeToolResultRef,
  summarizeToolResultContent,
  type ReadToolResultRefOptions,
  type ReadToolResultRefResult,
} from "../shared/toolResultRefs";
import { projectChatSessionForTranscript } from "../shared/chatSessionProjection";
import type { KernelRunStatus, PermissionRule } from "../shared/kernelContract";
import type {
  ConversationDisclosureScope,
  ConversationEvidenceTarget,
} from "../shared/conversationDisclosure";
import type { ToolInvocationRecord } from "../shared/toolInvocationLedger";

export type AppContainer = ReturnType<typeof createAppContainer>;

export type AgentRunsChangedEvent = {
  reason: "active_execution_changed" | "run_updated";
  runId?: string;
  taskId?: string;
  createdAt: string;
};

export function acceptanceContextNeedsModel(
  goal: Goal,
  milestone?: Goal["milestones"][number],
): boolean {
  const criteria = [
    ...goal.successCriteria,
    ...(milestone?.successCriteria ?? []),
  ];
  return criteria.some((criterion) =>
    criterion.acceptanceChecks.some((check) => check.kind === "model_review"),
  );
}

export function isTerminalGoalStatus(status: Goal["status"]): boolean {
  return (
    status === "achieved" ||
    status === "completed_unverified" ||
    status === "stopped_budget" ||
    status === "stopped_stalled" ||
    status === "stopped_blocked" ||
    status === "failed" ||
    status === "canceled"
  );
}

export function formatGoalTerminalMessage(goal: Goal, eventMessage?: string): string {
  const lines = [formatGoalTerminalHeading(goal)];
  const summaries = collectGoalResultSummaries(goal);

  if (
    goal.status !== "achieved" &&
    goal.status !== "completed_unverified" &&
    eventMessage?.trim()
  ) {
    lines.push("", `停止原因：${formatGoalTerminalReason(goal, eventMessage)}`);
  }

  if (summaries.length > 0) {
    lines.push(
      "",
      "结果摘要：",
      ...summaries.slice(-5).map((summary) => `- ${summary}`),
    );
  } else if (eventMessage?.trim() && lines.length === 1) {
    lines.push("", eventMessage.trim());
  }

  return lines.join("\n");
}

export function formatGoalTerminalReason(goal: Goal, eventMessage: string): string {
  const directive = goal.acceptanceState?.lastDecision;
  if (goal.status === "stopped_stalled" && directive?.action === "stop_stalled") {
    const failedChecks = directive.failedCheckIds.length
      ? `失败检查：${directive.failedCheckIds.join("、")}。`
      : "";
    return `同一验收失败已连续出现 ${directive.occurrence} 次，自动修复已停止。${failedChecks}`;
  }
  return eventMessage.trim();
}

export function formatGoalTerminalHeading(goal: Goal): string {
  switch (goal.status) {
    case "achieved":
      return `目标已达成：${goal.description}`;
    case "completed_unverified":
      return `目标已手动完成（未经机器认证）：${goal.description}`;
    case "failed":
      return `目标执行失败：${goal.description}`;
    case "canceled":
      return `目标已取消：${goal.description}`;
    case "stopped_budget":
      return `旧版任务已停止（只读）：${goal.description}`;
    case "stopped_stalled":
      return `目标因进展停滞停止：${goal.description}`;
    case "stopped_blocked":
      switch (goal.stopReason) {
        case "external_blocked":
          return `目标因外部依赖受阻：${goal.description}`;
        case "goal_impossible":
          return `目标不可实现：${goal.description}`;
        case "acceptance_unavailable":
          return `目标验收暂不可用：${goal.description}`;
        default:
          return `目标已阻塞：${goal.description}`;
      }
    case "planning":
    case "executing":
    case "waiting_for_review":
    case "waiting_for_acceptance":
    case "waiting_for_model":
      return `目标状态更新：${goal.description}`;
  }
}

export function collectGoalResultSummaries(goal: Goal): string[] {
  const summaries: string[] = [];
  for (const milestone of goal.milestones) {
    const acceptanceSummary = milestone.lastAcceptanceSummary?.trim();
    const runSummary = milestone.lastRunSummary?.trim();
    const canonicalSummaries = (
      milestone.state === "rejected"
        ? [acceptanceSummary]
        : [runSummary, acceptanceSummary]
    ).filter((value): value is string => Boolean(value));
    const uniqueSummaries = [...new Set(canonicalSummaries)];
    if (uniqueSummaries.length === 0) {
      continue;
    }
    summaries.push(
      `${milestone.description}${
        milestone.state === "rejected" ? "（验收未通过）" : ""
      }：${uniqueSummaries.join("；")}`,
    );
  }
  return summaries;
}

export function createModelProfileEmbeddingService(options: {
  modelSettingsStore: Pick<
    ModelSettingsStore,
    "loadCatalog" | "resolveProfile"
  >;
  fetch?: typeof fetch;
}): MemoryEmbeddingService {
  return {
    async embed(text: string) {
      const catalog = await options.modelSettingsStore.loadCatalog();
      if (!catalog.defaultEmbeddingProfileId) {
        return null;
      }
      const resolved = await options.modelSettingsStore.resolveProfile(
        catalog.defaultEmbeddingProfileId,
      );
      if (
        !providerSupportsEmbeddings(
          resolved.binding.providerKind,
          resolved.connectionValues,
        )
      ) {
        return null;
      }
      const apiKey =
        resolved.secrets.apiKey ?? resolved.secrets.vertexApiKey ?? "";
      if (!apiKey && resolved.binding.providerKind !== "ollama") {
        return null;
      }
      const baseUrl = resolveProviderBaseUrl(
        resolved.binding.providerKind,
        resolved.connectionValues,
      );
      const vector = await createOpenAiCompatibleEmbeddingClient({
        fetch: options.fetch,
      }).embed({
        baseUrl: baseUrl ?? "",
        apiKey,
        model: resolved.binding.modelId,
        input: text,
      });
      return {
        model: resolved.binding.modelId,
        vector,
      };
    },
  };
}

export function createAppContainer(options: {
  requestToolApproval: (
    request: ToolUserApprovalRequest,
    options?: ToolUserApprovalRequestOptions,
  ) => Promise<ToolUserApprovalResult>;
  setGoalActive?: (goalId: string, active: boolean) => void;
  /** Advanced consent switch getter (default OFF): policy_deny auto-lift. */
  policyDenyOverrideEnabled?: () => boolean;
  conversationCausalStore?: ConversationCausalStore;
  acceptanceValidators?: AcceptanceValidator[];
  chatClientOverride?: ChatClient & StreamingChatClient;
  modelProfileOverride?: AgentModelProfile;
}) {
  const configDir = path.join(app.getPath("userData"), "config");
  const skillsDir = path.join(app.getAppPath(), "skills");
  const appMeta = getAppMeta();

  // SQLite is the release authority. An unavailable native module must fail
  // startup for sqlite/dual; silently writing legacy JSON would fork authority.
  let storageBackendCache: "json" | "sqlite" | "dual" | null = null;
  function storageBackend(): "json" | "sqlite" | "dual" {
    if (storageBackendCache) return storageBackendCache;
    const resolved = resolveStorageBackend();
    storageBackendCache = requireStorageBackendAvailability(
      resolved,
      resolved === "json" || storage() !== null,
    );
    return resolved;
  }

  function storage(): Storage | null {
    return lazy<Storage | null>("storage", () => {
      try {
        // createStorageImpl runs migrations synchronously at construction, so
        // the schema is ready before any store write.
        return createStorageImpl({ dbPath: path.join(configDir, "zerox.db") });
      } catch (error) {
        console.error(
          `[storage] could not open SQLite authority (${String(error)}).`,
        );
        return null;
      }
    });
  }

  function activeSqliteStorage(): Storage | null {
    return storageBackend() === "json" ? null : storage();
  }

  async function runProductionStorageSmoke() {
    const requestedBackend = resolveStorageBackend();
    const resolvedBackend = storageBackend();
    return runProductionStorageSmokeProbe({
      configDir,
      requestedBackend,
      resolvedBackend,
      runtimeVersions: process.versions,
      storage: resolvedBackend === "json" ? null : storage(),
      taskStore: scheduledTaskStore(),
      goalStore: agentGoalStore(),
      executionStore: agentExecutionStore(),
      memoryStore: memoryStore(),
      workspaceStore: agentWorkspaceStore(),
      multiAgentSessionStore: multiAgentSessionStore(),
      learningStore: agentLearningStore(),
      evalCandidateStore: agentEvalCandidateStore(),
      promotedFixtureStore: promotedAgentEvalFixtureStore(),
    });
  }

  async function initializeStorageConvergence() {
    const result = storageBackend() === "json"
      ? { imported: [], existing: [] }
      : storage()
        ? await bootstrapSqliteDomainAuthority({
            configDir,
            storage: storage()!,
          })
        : { imported: [], existing: [] };
    if (storageBackend() === "dual") {
      await agentRunStore().list({ limit: Number.MAX_SAFE_INTEGER });
    }
    return result;
  }

  async function reconcileAgentRunAdmissions() {
    const owners = new Map<string, ConversationAgentRunOwnerFact>();
    for (const run of await agentRunStore().list({
      limit: Number.MAX_SAFE_INTEGER,
    })) {
      const status = run.status === "waiting_for_approval"
        ? "paused"
        : run.status;
      if (
        status !== "succeeded"
        && status !== "paused"
        && status !== "failed"
        && status !== "canceled"
      ) {
        continue;
      }
      const candidate: ConversationAgentRunOwnerFact = {
        runId: run.id,
        taskId: run.taskId,
        executionRevision: resolveAgentRunExecutionRevision(run),
        status,
      };
      const current = owners.get(run.id);
      if (
        !current
        || resolveAgentRunExecutionRevision(candidate)
          > resolveAgentRunExecutionRevision(current)
      ) {
        owners.set(run.id, candidate);
      }
    }
    return conversationCausalStore().reconcileAgentRunAdmissions(owners);
  }

  async function reconcileInterruptedApprovals(
    approvals: readonly ToolApprovalIntent[],
  ) {
    return reconcileInterruptedToolApprovals({
      approvals,
      trajectoryStore: agentTrajectoryStore(),
      workspaceRunStore: workspaceRunStore(),
      chatSessionStore: chatSessionStore(),
    });
  }

  const modelSettingsStore = createModelSettingsStore({
    configDir,
    vault: createElectronSecretVault(safeStorage),
    isConnectionReferenced: async (connectionId) =>
      (await planStore().listAll()).some(
        (plan) =>
          isLivePlanReference(plan.status) &&
          Object.values(plan.frozenModelAssignments).some(
            (binding) => binding?.connectionId === connectionId,
          ),
      ),
    isProfileReferenced: async (profileId) =>
      (await planStore().listAll()).some(
        (plan) =>
          isLivePlanReference(plan.status) &&
          Object.values(plan.frozenModelAssignments).some(
            (binding) => binding?.profileId === profileId,
          ),
      ),
  });
  let kernelPermissionRules: PermissionRule[] = [];

  const goalProgressListeners = new Set<(event: GoalProgressEvent) => void>();
  const agentRunsChangedListeners = new Set<(event: AgentRunsChangedEvent) => void>();
  let goalProgressDeliveryQueue = Promise.resolve();
  const planConfirmationQueues = new Map<string, Promise<void>>();
  const goalReplanQueues = new Map<string, Promise<void>>();
  const goalAmendmentQueues = new Map<string, Promise<void>>();



  const disclosure = createDisclosureRuntime({
    agentExecutionStore,
    agentGoalStore,
    agentRunStore,
    agentTrajectoryStore,
    chatSessionStore,
    conversationCausalStore,
    conversationDisclosureMaterializer,
    kernelEventBus,
    planStore,
    scheduledTaskStore,
    workspaceRunStore,
  });


  const planOps = createPlanOpsRuntime({
    agentGoalStore,
    agentGoalValidatorRegistry,
    chatSessionStore,
    goalChatService,
    goalDraftService,
    planArtifactWriter,
    planDebateOrchestrator,
    planStore,
    agentWorkspaceService,
    createToolExecutor,
    processSandboxProvider,
    serializePlanConfirmation,
    serializeGoalReplan,
    serializeGoalAmendment,
    trackRuntimeInvocation,
    runGoalOperation,
    skillsDir,
    runtimeShuttingDown: () => runtimeShuttingDown,
    goalProgressDeliveryQueue: () => goalProgressDeliveryQueue,
    setGoalProgressDeliveryQueue: (next: Promise<void>) => {
      goalProgressDeliveryQueue = next;
    },
  } as unknown as Parameters<typeof createPlanOpsRuntime>[0]);
  const chatSessions = createChatSessionsRuntime({
    agentGoalStore,
    chatSessionStore,
    planStore,
  });

  function serializePlanConfirmation<T>(
    planId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = planConfirmationQueues.get(planId) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    planConfirmationQueues.set(planId, tail);
    void tail.finally(() => {
      if (planConfirmationQueues.get(planId) === tail) {
        planConfirmationQueues.delete(planId);
      }
    });
    return result;
  }

  function serializeGoalReplan<T>(
    goalId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = goalReplanQueues.get(goalId) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    goalReplanQueues.set(goalId, tail);
    void tail.finally(() => {
      if (goalReplanQueues.get(goalId) === tail) {
        goalReplanQueues.delete(goalId);
      }
    });
    return result;
  }

  function serializeGoalAmendment<T>(
    goalId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = goalAmendmentQueues.get(goalId) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    goalAmendmentQueues.set(goalId, tail);
    void tail.finally(() => {
      if (goalAmendmentQueues.get(goalId) === tail) {
        goalAmendmentQueues.delete(goalId);
      }
    });
    return result;
  }

  function onGoalProgressEvent(callback: (event: GoalProgressEvent) => void) {
    goalProgressListeners.add(callback);
    return () => {
      goalProgressListeners.delete(callback);
    };
  }

  function emitGoalProgressEvent(event: GoalProgressEvent) {
    const delivery = goalProgressDeliveryQueue.then(
      () => deliverGoalProgressEvent(event),
      () => deliverGoalProgressEvent(event),
    );
    goalProgressDeliveryQueue = delivery.then(
      () => undefined,
      () => undefined,
    );
  }

  async function deliverGoalProgressEvent(event: GoalProgressEvent) {
    let canonicalEvent = await reconcileGoalProgressEventFromStore(event);
    await chatSessions.syncGoalProgressToChatSession(canonicalEvent).catch(() => undefined);

    const latestEvent = await reconcileGoalProgressEventFromStore(canonicalEvent);
    if (
      latestEvent.status !== canonicalEvent.status ||
      latestEvent.event !== canonicalEvent.event ||
      latestEvent.message !== canonicalEvent.message
    ) {
      canonicalEvent = latestEvent;
      await chatSessions.syncGoalProgressToChatSession(canonicalEvent).catch(() => undefined);
    }
    await syncSourcePlanFromGoal(canonicalEvent).catch(() => undefined);
    notifyGoalProgressListeners(canonicalEvent);
  }

  async function syncSourcePlanFromGoal(event: GoalProgressEvent) {
    const goal = await agentGoalStore().get(event.goalId);
    const sourcePlan = goal?.activePlanRef
      ? await planStore().get(goal.activePlanRef.planId)
      : (await planStore().listAll()).find(
          (plan) => plan.executionGoalId === event.goalId,
        );
    if (!sourcePlan) {
      return;
    }
    if (sourcePlan.executionGoalId !== event.goalId) {
      return;
    }
    await serializePlanConfirmation(sourcePlan.id, async () => {
      const canonicalGoal = await agentGoalStore().get(event.goalId);
      if (
        canonicalGoal?.activePlanRef?.planId &&
        canonicalGoal.activePlanRef.planId !== sourcePlan.id
      ) {
        return;
      }
      const runId = canonicalGoal?.milestones
        .flatMap((milestone) => milestone.runIds)
        .at(-1);
      const terminalStatus: PlanStatus | null =
        event.status === "achieved"
          ? "completed"
          : event.status === "completed_unverified" ||
              event.status === "waiting_for_acceptance" ||
              Boolean(
                canonicalGoal?.milestones.length &&
                  canonicalGoal.milestones.every(
                    (milestone) =>
                      milestone.state === "accepted" ||
                      milestone.state === "skipped",
                  ),
              )
            ? "steps_completed"
          : event.status === "canceled"
            ? "canceled"
            : event.status === "failed" ||
                event.status === "stopped_budget" ||
                event.status === "stopped_stalled" ||
                event.status === "stopped_blocked"
              ? "failed"
              : null;
      const nextStatus =
        terminalStatus ??
        (event.status === "waiting_for_review" ||
        event.status === "waiting_for_model"
          ? "paused"
          : "executing");
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const canonicalPlan = await planStore().get(sourcePlan.id);
        if (!canonicalPlan || canonicalPlan.executionGoalId !== event.goalId) {
          return;
        }
        if (
          nextStatus === canonicalPlan.status &&
          (!runId || canonicalPlan.executionRunId === runId)
        ) {
          return;
        }
        try {
          await planStore().save(
            {
              ...canonicalPlan,
              status: nextStatus,
              ...(runId ? { executionRunId: runId } : {}),
            },
            canonicalPlan.revision,
            terminalStatus ? "plan_execution_finished" : "plan_execution_linked",
            {
              goalId: event.goalId,
              ...(runId ? { runId } : {}),
              status: nextStatus,
            },
          );
          return;
        } catch (error) {
          if (!(error instanceof PlanVersionConflictError) || attempt === 2) {
            throw error;
          }
        }
      }
    });
  }

  async function reconcileGoalProgressEventFromStore(
    event: GoalProgressEvent,
  ): Promise<GoalProgressEvent> {
    const goal = await agentGoalStore().get(event.goalId).catch(() => null);
    return reconcileIrreversibleGoalProgressEvent(event, goal);
  }

  function notifyGoalProgressListeners(event: GoalProgressEvent) {
    for (const listener of goalProgressListeners) {
      try {
        listener(event);
      } catch {
        // Subscriber errors must not break the goal runtime.
      }
    }
  }

  function onAgentRunsChanged(callback: (event: AgentRunsChangedEvent) => void) {
    agentRunsChangedListeners.add(callback);
    return () => {
      agentRunsChangedListeners.delete(callback);
    };
  }

  function emitAgentRunsChanged(
    event: Omit<AgentRunsChangedEvent, "createdAt">,
  ) {
    const nextEvent: AgentRunsChangedEvent = {
      ...event,
      createdAt: new Date().toISOString(),
    };
    for (const listener of agentRunsChangedListeners) {
      try {
        listener(nextEvent);
      } catch {
        // Subscriber errors must not break agent execution.
      }
    }
  }


  function processSandboxProvider() {
    return lazy("processSandboxProvider", () =>
      createProcessSandboxProvider({
        mode: readFeatureFlags().ZEROX_PROCESS_SANDBOX,
      }),
    );
  }

  function createToolExecutor() {
    return lazy("agentToolExecutor", () => {
      const executor = createAgentToolExecutor({
        memoryStore: memoryStore(),
        chatSessionStore: chatSessionStore(),
        toolResultOffloadStore: toolResultOffloadStore(),
        discoverSkills: () => discoverSkills({ skillsDir, forceRefresh: true }),
        historyIndexStore: historyIndexStore(),
        processSandbox: processSandboxProvider(),
      });
      // Actor execution depends on the SQLite checkpoint graph. Do not
      // advertise a model-callable tool when the active JSON backend cannot
      // execute it. Workflow networking remains disabled below until its
      // permission path is complete.
      const registry = executor.getRegistry();
      if (readFeatureFlags().ZEROX_READ_CODE_MODE === "on") {
        const subcallRuntime = createToolRuntime({
          authorizationService: toolAuthorizationService(),
          toolExecutor: executor,
        });
        registerReadCodeTool(registry, {
          executeSubcall(input) {
            return subcallRuntime.execute({
              taskId: input.taskId,
              request: input.request,
              authorizationOptions: {
                ...(input.runtimeTask
                  ? { runtimeTask: input.runtimeTask }
                  : {}),
              },
              executionOptions: {
                signal: input.signal,
                ...(input.runContext
                  ? { runContext: input.runContext }
                  : {}),
                ...(input.toolResultReadScope
                  ? {
                      toolResultReadScope:
                        input.toolResultReadScope,
                    }
                  : {}),
              },
              onStage: input.onStage,
            });
          },
        });
      }
      if (activeSqliteStorage()) {
        registerActorTool(registry, { actorRuntime: actorRuntime() });
      }
      // v3.6.0: Track MCP initialization promise so errors are surfaced
      // instead of silently swallowed (CONC-01).
      if (shouldAutoInitializeSkillMcp(process.env)) {
        const initialization = initializeMcpTools(executor);
        const trackedInitialization = initialization.finally(() => {
          if (mcpInitializationPromise === trackedInitialization) {
            mcpInitializationPromise = null;
          }
        });
        mcpInitializationPromise = trackedInitialization;
        mcpInitializationPromise.catch((error: unknown) => {
          console.error(
            "[mcp] Background MCP tool initialization failed:",
            error instanceof Error ? error.message : String(error),
          );
        });
      }
      return executor;
    });
  }

  function modelConnectionService() {
    return lazy("modelConnectionService", () =>
      createModelConnectionService({
        modelSettingsStore,
        chatClient: chatClient(),
        modelRouter: modelRouter(),
      }),
    );
  }

  function agentValidationStore() {
    return lazy("agentValidationStore", () =>
      createAgentValidationStore({ configDir, backend: storageBackend(), storage: activeSqliteStorage() ?? undefined }),
    );
  }

  function scheduledTaskStore() {
    return lazy("scheduledTaskStore", () =>
      createScheduledTaskStore({ configDir, backend: storageBackend(), storage: activeSqliteStorage() ?? undefined }),
    );
  }

  function toolAuditLog() {
    return lazy("toolAuditLog", () =>
      createToolAuditLog({ configDir, backend: storageBackend(), storage: activeSqliteStorage() ?? undefined }),
    );
  }

  function toolAuthorizationService() {
    return lazy("toolAuthorizationService", () =>
      createToolAuthorizationService({
        taskStore: scheduledTaskStore(),
        auditLog: toolAuditLog(),
        permissionRules: () => kernelPermissionRules,
        requestUserApproval: options.requestToolApproval,
        ...(options.policyDenyOverrideEnabled
          ? { policyDenyOverrideEnabled: options.policyDenyOverrideEnabled }
          : {}),
      }),
    );
  }

  function kernelEventBus() {
    return lazy("kernelEventBus", () => new KernelEventBus());
  }

  function productionKernelDriver(
    mode: "scheduled_task" | "chat" | "goal" = "scheduled_task",
  ) {
    if (!productionKernelCovers(
      readFeatureFlags().ZEROX_PRODUCTION_KERNEL,
      mode,
    )) {
      return undefined;
    }
    return lazy("productionKernelDriver", () =>
      createProductionKernelDriver({
        bus: kernelEventBus(),
      }),
    );
  }

  function chatProductionKernelDriver() {
    return productionKernelDriver("chat");
  }

  function goalProductionKernelDriver() {
    return productionKernelDriver("goal");
  }

  function setKernelPermissionRules(rules: PermissionRule[]): {
    ok: true;
    count: number;
  } {
    kernelPermissionRules = [...rules];
    return { ok: true, count: kernelPermissionRules.length };
  }

  function agentRunStore() {
    return lazy("agentRunStore", () =>
      createAgentRunStore({ configDir, backend: storageBackend(), storage: activeSqliteStorage() ?? undefined }),
    );
  }

  function agentExecutionStore() {
    return lazy("agentExecutionStore", () =>
      createAgentExecutionStore({
        configDir,
        backend: storageBackend(),
        storage: activeSqliteStorage() ?? undefined,
      }),
    );
  }

  function agentTrajectoryStore() {
    return lazy("agentTrajectoryStore", () =>
      createAgentTrajectoryStore({ configDir, backend: storageBackend(), storage: activeSqliteStorage() ?? undefined }),
    );
  }

  function agentGoalStore() {
    return lazy("agentGoalStore", () =>
      createAgentGoalStore({
        configDir,
        backend: storageBackend(),
        storage: activeSqliteStorage() ?? undefined,
      }),
    );
  }

  function agentWorkspaceStore() {
    return lazy("agentWorkspaceStore", () =>
      createAgentWorkspaceStore({
        configDir,
        backend: storageBackend(),
        storage: activeSqliteStorage() ?? undefined,
      }),
    );
  }

  function workspaceRunStore() {
    return lazy("workspaceRunStore", () => createWorkspaceRunStore({ configDir }));
  }

  function conversationCausalStore() {
    return options.conversationCausalStore
      ?? lazy("conversationCausalStore", () =>
        createConversationCausalStore({ configDir }),
      );
  }

  function conversationDisclosureMaterializer() {
    return lazy("conversationDisclosureMaterializer", () =>
      createConversationDisclosureMaterializer({
        load: disclosure.loadConversationDisclosureReadSet,
      }));
  }

  function conversationEvidenceResolver() {
    return lazy("conversationEvidenceResolver", () =>
      createConversationEvidenceResolver({
        getCurrentSnapshot: async (scope) =>
          (await conversationDisclosureMaterializer().refresh(scope)).snapshot,
        canResolve: disclosure.authorizeConversationEvidenceTarget,
        backend: {
          resolve: disclosure.resolveConversationEvidence,
        },
      }));
  }

  function agentWorkspaceService() {
    return lazy("agentWorkspaceService", () =>
      createAgentWorkspaceService({
        workspaceStore: agentWorkspaceStore(),
        workspaceRoot: path.join(app.getPath("userData"), "workspaces"),
        consumeToolAuthorizationReceipt: (input) =>
          toolAuditLog().consumeAuthorizationReceipt(input),
      }),
    );
  }

  async function requestGitWorktreeAgentWorkspace(
    input: CreateGitWorktreeWorkspaceInput,
  ) {
    const canonicalInput = {
      name: input.name,
      repositoryRoot: path.resolve(input.repositoryRoot),
      branch: input.branch,
    };
    let createdWorkspace: Awaited<
      ReturnType<AgentWorkspaceService["createGitWorktreeWorkspace"]>
    > | null = null;
    const worktreeRuntime = createToolRuntime({
      authorizationService: toolAuthorizationService(),
      toolExecutor: {
        async execute(request, executionOptions) {
          const receipt = executionOptions?.authorizationReceipt;
          if (!receipt) {
            return {
              ok: false as const,
              error: "Git worktree dispatch is missing its authorization receipt.",
            };
          }
          createdWorkspace = await agentWorkspaceService().createGitWorktreeWorkspace({
            name: String(request.args.name ?? ""),
            repositoryRoot: String(request.args.repositoryRoot ?? ""),
            branch: String(request.args.branch ?? ""),
            approval: {
              kind: "tool_authorization_receipt",
              auditEventId: receipt.auditEventId,
            },
          });
          return {
            ok: true as const,
            result: { workspaceId: createdWorkspace.id },
          };
        },
      },
    });
    const outcome = await worktreeRuntime.execute({
      taskId: "agent_workspaces",
      request: {
        toolName: "git_worktree_add",
        args: {
          name: canonicalInput.name,
          repositoryRoot: canonicalInput.repositoryRoot,
          branch: canonicalInput.branch,
        },
      },
      authorizationOptions: {
        runtimeTask: {
          name: "Create Git worktree workspace",
          permissions: getDefaultTaskPermissionPolicy(),
          policyLabel: "Git worktree creation authority",
        },
      },
    });

    if (!outcome.result.ok) {
      throw new Error(outcome.result.error);
    }
    if (!createdWorkspace) {
      throw new Error("Git worktree dispatch completed without a workspace result.");
    }
    return createdWorkspace;
  }

  function multiAgentSessionStore() {
    return lazy("multiAgentSessionStore", () =>
      createMultiAgentSessionStore({
        configDir,
        backend: storageBackend(),
        storage: activeSqliteStorage() ?? undefined,
      }),
    );
  }

  function planStore() {
    return lazy("planStore", () =>
      createPlanStore({
        configDir,
        ...(activeSqliteStorage()
          ? { storage: activeSqliteStorage()! }
          : {}),
      }),
    );
  }

  function planArtifactWriter() {
    return lazy("planArtifactWriter", () => createPlanArtifactWriter());
  }

  function planDebateOrchestrator() {
    return lazy("planDebateOrchestrator", () =>
      createPlanDebateOrchestrator({
        planStore: planStore(),
        artifactWriter: planArtifactWriter(),
        modelRouter: modelRouter(),
        investigator: createPlanInvestigatorService({
          toolExecutor: createToolExecutor(),
          toolAuthorizationService: toolAuthorizationService(),
          discoverSkills: () => discoverSkills({ skillsDir, forceRefresh: true }),
        }),
        discoverSkills: () => discoverSkills({ skillsDir, forceRefresh: true }),
        availableToolNames: () =>
          createToolExecutor()
            .getRegistry()
            .getDefinitions()
            .map((definition) => definition.function.name),
        availableAcceptanceKinds: () =>
          agentGoalValidatorRegistry().listKinds(),
        enableDirectReview: true,
        processSandbox: processSandboxProvider(),
      }),
    );
  }

  function memoryProfileStore() {
    return lazy("memoryProfileStore", () =>
      createMemoryProfileStore({ configDir, backend: storageBackend(), storage: activeSqliteStorage() ?? undefined }),
    );
  }

  function toolResultOffloadStore() {
    return lazy("toolResultOffloadStore", () => createToolResultOffloadStore({ configDir }));
  }

  function agentLearningStore() {
    return lazy("agentLearningStore", () =>
      createAgentLearningStore({
        configDir,
        backend: storageBackend(),
        storage: activeSqliteStorage() ?? undefined,
      }),
    );
  }

  function agentEvalCandidateStore() {
    return lazy("agentEvalCandidateStore", () =>
      createAgentEvalCandidateStore({
        configDir,
        backend: storageBackend(),
        storage: activeSqliteStorage() ?? undefined,
      }),
    );
  }

  function promotedAgentEvalFixtureStore() {
    return lazy("promotedAgentEvalFixtureStore", () =>
      createPromotedAgentEvalFixtureStore({
        configDir,
        backend: storageBackend(),
        storage: activeSqliteStorage() ?? undefined,
      }),
    );
  }

  function chatSessionStore() {
    return lazy("chatSessionStore", () => {
      const sqlite = storage();
      if (sqlite) {
        return createChatSessionStore({
          configDir,
          backend: "sqlite",
          storage: sqlite,
        });
      }
      // SQLite open failure is the only runtime degradation path. The legacy
      // JSON store remains available without pretending parity succeeded.
      return createChatSessionStore({ configDir, backend: "json" });
    });
  }

  function memoryStore() {
    return lazy("memoryStore", () =>
      createMemoryStore({
        configDir,
        backend: storageBackend(),
        storage: activeSqliteStorage() ?? undefined,
        embeddingService: createModelProfileEmbeddingService({
          modelSettingsStore,
        }),
      }),
    );
  }

  function historyIndexStore() {
    return lazy("historyIndexStore", () =>
      createHistoryIndexStore({
        filePath: path.join(configDir, "raw-history.jsonl"),
      }),
    );
  }

  function agentLearningService() {
    return lazy("agentLearningService", () =>
      createAgentLearningService({
        learningStore: agentLearningStore(),
        memoryStore: memoryStore(),
      }),
    );
  }

  function agentEvalCandidateService() {
    return lazy("agentEvalCandidateService", () =>
      createAgentEvalCandidateService({
        runStore: agentRunStore(),
        trajectoryStore: agentTrajectoryStore(),
        candidateStore: agentEvalCandidateStore(),
        promotedFixtureStore: promotedAgentEvalFixtureStore(),
      }),
    );
  }

  function multiAgentCoordinator() {
    return lazy("multiAgentCoordinator", () =>
      createMultiAgentCoordinator({
        sessionStore: multiAgentSessionStore(),
        trajectoryStore: agentTrajectoryStore(),
      }),
    );
  }

  function taskSchedulerService() {
    return lazy("taskSchedulerService", () =>
      createTaskSchedulerService({
        taskStore: scheduledTaskStore(),
        runScheduledTask: (taskId: string) => runAgentTask(taskId),
        async listActiveTaskIds() {
          return new Set(
            (await agentExecutionStore().listActive()).map(
              (checkpoint) => checkpoint.taskId,
            ),
          );
        },
      }),
    );
  }

  async function getModelProfile() {
    if (options.modelProfileOverride) {
      return structuredClone(options.modelProfileOverride);
    }
    const resolved = await modelSettingsStore.resolveProfile();
    return toRuntimeModelProfile(resolved);
  }

  function toRuntimeModelProfile(
    resolved: Awaited<ReturnType<ModelSettingsStore["resolveProfile"]>>,
  ) {
    const apiKey =
      resolved.secrets.apiKey ??
      resolved.secrets.bedrockApiKey ??
      resolved.secrets.vertexApiKey ??
      "";
    const baseUrl = resolveProviderBaseUrl(
      resolved.binding.providerKind,
      resolved.connectionValues,
    );

    return {
      baseUrl: baseUrl ?? "",
      apiKey,
      model: resolved.binding.modelId,
      providerId: resolved.binding.providerKind,
      profile: resolved.binding.profileId,
      temperature: resolved.binding.generation.temperature,
      maxTokens: resolved.binding.generation.maxTokens,
      ...(resolved.binding.contextWindow
        ? { contextWindow: resolved.binding.contextWindow }
        : {}),
      ...(resolved.binding.contextWindowSource
        ? { contextWindowSource: { ...resolved.binding.contextWindowSource } }
        : {}),
      thinking: resolved.binding.generation.thinkingEnabled
        ? {
            type: "enabled" as const,
            budgetTokens:
              resolved.binding.generation.thinkingBudgetTokens,
          }
        : { type: "disabled" as const },
      modelCapabilities: { ...resolved.binding.capabilities },
    };
  }

  async function resolveGoalModelSettings(goal: Goal) {
    const binding = await resolveGoalExecutionModelBinding(
      goal,
      (planId) => planStore().get(planId),
    );
    return binding
      ? modelSettingsStore.resolveBinding(binding)
      : modelSettingsStore.resolveProfile();
  }

  async function getGoalModelProfile(goal: Goal) {
    if (options.modelProfileOverride) {
      return structuredClone(options.modelProfileOverride);
    }
    return toRuntimeModelProfile(await resolveGoalModelSettings(goal));
  }

  function goalChatClient(goal: Goal) {
    if (options.chatClientOverride) return options.chatClientOverride;
    return createSettingsBackedChatClient({
      loadSettings: () => modelSettingsStore.load(),
      getApiKey: () => modelSettingsStore.getApiKey(),
      resolveProfile: () => resolveGoalModelSettings(goal),
      fallback: createOpenAiCompatibleClient(),
    });
  }

  async function getGoalProvider(goal: Goal) {
    const resolved = await resolveGoalModelSettings(goal);
    const apiKey =
      resolved.secrets.apiKey ??
      resolved.secrets.bedrockApiKey ??
      resolved.secrets.vertexApiKey ??
      "";
    return createProvider({
      providerKind: resolved.binding.providerKind,
      apiKey,
      chatModel: resolved.binding.modelId,
      baseUrl: resolveProviderBaseUrl(
        resolved.binding.providerKind,
        resolved.connectionValues,
      ),
      connectionValues: resolved.connectionValues,
      secrets: resolved.secrets,
      thinkingEnabled: resolved.binding.generation.thinkingEnabled,
      thinkingBudgetTokens:
        resolved.binding.generation.thinkingBudgetTokens,
    });
  }

  // P3 provider abstraction. Returns the LLMProvider for the current model
  // settings (dispatched by `providerId`, default `openai-compatible`). P5
  // (checkpoint-writer fork agent) and P8 (streaming/max-mode) consume this.
  // Existing ChatClient consumers are unchanged (gradual migration via the
  // ProviderChatClient adapter — zero regression).
  function chatClient() {
    if (options.chatClientOverride) return options.chatClientOverride;
    // Settings-backed: openai-compatible (default) routes to the raw client
    // (byte-identical to legacy); anthropic/gemini route to a native provider.
    return lazy("chatClient", () =>
      createSettingsBackedChatClient({
        loadSettings: () => modelSettingsStore.load(),
        getApiKey: () => modelSettingsStore.getApiKey(),
        resolveProfile: () => modelSettingsStore.resolveProfile(),
        fallback: createOpenAiCompatibleClient(),
      }),
    );
  }

  async function getProvider() {
    const resolved = await modelSettingsStore.resolveProfile();
    const apiKey =
      resolved.secrets.apiKey ??
      resolved.secrets.bedrockApiKey ??
      resolved.secrets.vertexApiKey ??
      "";
    return createProvider({
      providerKind: resolved.binding.providerKind,
      apiKey,
      chatModel: resolved.binding.modelId,
      baseUrl: resolveProviderBaseUrl(
        resolved.binding.providerKind,
        resolved.connectionValues,
      ),
      connectionValues: resolved.connectionValues,
      secrets: resolved.secrets,
      thinkingEnabled: resolved.binding.generation.thinkingEnabled,
      thinkingBudgetTokens:
        resolved.binding.generation.thinkingBudgetTokens,
    });
  }

  function modelRouter() {
    return lazy("modelRouter", () =>
      createModelRouter({
        modelSettingsStore,
        fallback: createOpenAiCompatibleClient(),
      }),
    );
  }

  // P4 shell analyzer + tool worker. Exposed for P5 (checkpoint-writer fork
  // agent) and P6 (actor isolation) to consume. ZEROX_TOOL_WORKER controls the
  // isolation mode while keeping explicit in-process mode available for
  // development and focused tests.
  function shellAnalyzer() {
    return { analyze: analyzeShell };
  }

  function toolWorker() {
    return lazy("toolWorker", () => {
      const opts = getToolWorkerOptions();
      return createToolWorker({ mode: opts.worker });
    });
  }

  // P2 context rebuild. Repositories + compaction strategy selector are exposed
  // for the runtime loops to consume (activation cutover lands with P5, when
  // markdown checkpoints exist; default `auto` degrades to summarize = current
  // behavior, so wiring is zero-regression).
  function checkpointRepository() {
    return lazy("checkpointRepository", () => {
      const s = activeSqliteStorage();
      return s ? createCheckpointRepository(s) : null;
    });
  }

  function memoryRepository() {
    return lazy("memoryRepository", () => {
      const s = activeSqliteStorage();
      return s ? createMemoryRepository(s) : null;
    });
  }

  function compactionStrategy() {
    return lazy("compactionStrategy", () => {
      const flag = resolveCompactionFlag();
      const orchestrator = checkpointWriterOrchestrator();
      return selectCompactionStrategy(flag, {
        contextManager: createContextManager(),
        ...(checkpointRepository() ? { checkpointRepository: checkpointRepository()! } : {}),
        ...(memoryRepository() ? { memoryRepository: memoryRepository()! } : {}),
        // P5: trigger the fork-agent checkpoint writer before a rebuild so a
        // fresh markdown checkpoint exists. Adapter converts ChatMessage[] →
        // NormalizedMessage[] for the orchestrator.
        ...(orchestrator
          ? {
              checkpointWriter: {
                async maybeWriteCheckpoint(input: { parentRunId: string; parentMessages: import("./openAiCompatibleClient").ChatMessage[] }) {
                  return orchestrator.maybeWriteCheckpoint({
                    parentRunId: input.parentRunId,
                    parentMessages: toNormalized(input.parentMessages),
                  });
                },
              },
            }
          : {}),
      });
    });
  }

  // P5 actor runtime + checkpoint-writer orchestrator. Exposed for P6 (actor
  // model extends this v0) and P8 (max-mode replay via actor). The fork-agent
  // writer is wired but not yet triggered from the runtime loops (activation
  // cutover is incremental; default flag `p5-fork` is honored when triggered).
  function runRepository() {
    return lazy("runRepository", () => {
      const s = activeSqliteStorage();
      return s ? createRunRepository(s) : null;
    });
  }

  function actorRuntime() {
    return lazy("actorRuntime", () =>
      createActorRuntime({
        ...(activeSqliteStorage() ? { storage: activeSqliteStorage()! } : {}),
        deps: {
          runActor: async (input, forkContext, cancel) => {
            const s = activeSqliteStorage();
            if (!s) return { status: "error", summary: "no storage", filesTouched: [] };
            return runCheckpointWriterActor(input, forkContext, cancel, {
              runRepository: createRunRepository(s),
              checkpointRepository: createCheckpointRepository(s),
            });
          },
        },
      }),
    );
  }

  function checkpointWriterOrchestrator() {
    return lazy("checkpointWriterOrchestrator", () => {
      const s = activeSqliteStorage();
      if (!s) return null;
      return createCheckpointWriterOrchestrator({
        storage: s,
        runRepository: createRunRepository(s),
        checkpointRepository: createCheckpointRepository(s),
      });
    });
  }

  // P6 workflow runtime. The built-in workflow is retained for explicit
  // experiments, but network host hooks fail closed until they share the normal
  // permission and outbound-policy path. The tool is therefore not registered.
  function workflowRuntime() {
    return lazy("workflowRuntime", () => {
      if (readFeatureFlags().ZEROX_WORKFLOW_RUNTIME !== "on") {
        throw new Error(
          "Workflow runtime is disabled until permissioned network hooks are configured.",
        );
      }
      const spawnActor = createWorkflowActorHostHook(actorRuntime());
      const rt = createWorkflowRuntime({
        spawnActor,
        async webfetch() {
          throw new Error("Workflow webfetch is unavailable until permission wiring is configured.");
        },
        async websearch() {
          throw new Error("Workflow websearch is unavailable until permission wiring is configured.");
        },
      });
      registerDeepResearchWorkflow(rt.register.bind(rt));
      return rt;
    });
  }

  // P7: self-improvement scheduler (dream + distill). Default OFF
  // (ZEROX_SELF_IMPROVEMENT=off) — background LLM cost; users opt in. Wired
  // alongside the memory-maintenance timer; runNow() supports /dream /distill.
  function sessionRepository() {
    return lazy("sessionRepository", () => {
      const s = activeSqliteStorage();
      return s ? createSessionRepository(s) : null;
    });
  }

  function selfImprovementService() {
    return lazy("selfImprovementService", () => {
      const flags = readFeatureFlags();
      if (
        flags.ZEROX_SELF_IMPROVEMENT !== "on" ||
        flags.ZEROX_WORKFLOW_RUNTIME !== "on"
      ) {
        return null;
      }
      const s = activeSqliteStorage();
      if (!s) return null;
      return createSelfImprovementService({
        storage: s,
        memoryRepository: createMemoryRepository(s),
        runRepository: createRunRepository(s),
        trajectoryRepository: createTrajectoryRepository(s),
        sessionRepository: createSessionRepository(s),
        workflowRuntime: workflowRuntime(),
        skillsDir,
      });
    });
  }

  function agentBootstrapService() {
    return lazy("agentBootstrapService", () =>
      createAgentBootstrapService({
        modelSettingsStore,
        taskStore: scheduledTaskStore(),
        discoverSkills: () => discoverSkills({ skillsDir, forceRefresh: true }),
        testModelConnection: () => modelConnectionService().testConnection(),
        runScheduledTask: (taskId: string) =>
          runAgentTask(taskId, { writeChatTranscript: false }),
        validationStore: agentValidationStore(),
      }),
    );
  }

  function agentRunnerService() {
    return lazy("agentRunnerService", () => {
      const maxModeActorRuntime = activeSqliteStorage() ? actorRuntime() : undefined;
      return createAgentRunnerService({
        taskStore: scheduledTaskStore(),
        runStore: agentRunStore(),
        resolveSkill: async (skillName: string) => {
          const result = await discoverSkills({ skillsDir, forceRefresh: true });
          return (
            result.skills.find((skill) => skill.manifest.name === skillName) ?? null
          );
        },
        chatClient: chatClient(),
        getModelProfile,
        toolAuthorizationService: toolAuthorizationService(),
        toolExecutor: createToolExecutor(),
        executionStore: agentExecutionStore(),
        workspaceService: agentWorkspaceService(),
        trajectoryStore: agentTrajectoryStore(),
        learningStore: agentLearningStore(),
        memoryStore: memoryStore(),
        toolResultOffloadStore: toolResultOffloadStore(),
        compactionStrategy: compactionStrategy(),
        // P8: max-mode (best-of-N) — opt-in via ZEROX_MAX_MODE. runStep
        // resolves the provider lazily on first call (getProvider is async).
        maxMode: {
          async runStep(req, opts) {
            const provider = await getProvider();
            return createMaxMode(provider).runStep(req, opts);
          },
        },
        ...(maxModeActorRuntime
          ? { actorRuntimeForMaxMode: maxModeActorRuntime }
          : {}),
        runAgentLoop,
        ...(productionKernelDriver()
          ? {
              productionKernelDriver:
                productionKernelDriver()!,
            }
          : {}),
      });
    });
  }

  function agentGoalValidatorRegistry() {
    return lazy("agentGoalValidatorRegistry", () =>
      createAgentGoalValidatorRegistry({
        validators: [
          ...createBuiltinGoalAcceptanceValidators(),
          ...(options.acceptanceValidators ?? []),
        ],
      }),
    );
  }

  function agentGoalAcceptance() {
    return lazy("agentGoalAcceptance", () =>
      createAgentGoalAcceptance({ registry: agentGoalValidatorRegistry() }),
    );
  }

  function agentGoalController() {
    return lazy("agentGoalController", () => {
      const toolExecutor = createToolExecutor();
      let sequence = 0;
      const nextGoalTrajectorySequence = () => {
        sequence += 1;
        return sequence;
      };

      return createAgentGoalController({
        goalStore: agentGoalStore(),
        runtimeEngine: createGoalRuntimeEngine({
          workspaceService: agentWorkspaceService(),
          chatClient: chatClient(),
          getChatClient: goalChatClient,
          getModelProfile: getGoalModelProfile,
          toolExecutor,
          toolAuthorizationService: toolAuthorizationService(),
          runStore: agentRunStore(),
          trajectoryStore: agentTrajectoryStore(),
          toolResultOffloadStore: toolResultOffloadStore(),
          goalContext: createAgentGoalContext({
            trajectoryStore: {
              append(runId, event, appendOptions) {
                const store = agentTrajectoryStore();
                return store.appendNext
                  ? store.appendNext(runId, event, appendOptions)
                  : store.append(runId, event, appendOptions);
              },
            },
            createId: () => `goal_context_${randomUUID()}`,
            now: () => new Date().toISOString(),
          }),
          createId: () => `goal_run_${randomUUID()}`,
          nextSequence: nextGoalTrajectorySequence,
          now: () => new Date().toISOString(),
          onProgress: emitGoalProgressEvent,
          ...(goalProductionKernelDriver()
            ? {
                productionKernelDriver:
                  goalProductionKernelDriver()!,
              }
            : {}),
          maxMode: {
            async runStep(req, opts) {
              const provider = await getProvider();
              return createMaxMode(provider).runStep(req, opts);
            },
          },
          getMaxMode: async (goal) =>
            createMaxMode(await getGoalProvider(goal)),
          resolveSelectedSkill: async (goal) => {
            const skillAuthority = verifySelectedSkillAuthority({
              selectedSkill: goal.selectedSkill,
              discoveredSkills: (
                await discoverSkills({ skillsDir, forceRefresh: true })
              ).skills,
            });
            if (!skillAuthority.ok) {
              throw new Error(
                skillAuthority.reason === "missing"
                  ? "Goal 绑定的 Skill 已不存在，请重新规划。"
                  : "Goal 绑定的 Skill 快照已漂移，请重新规划。",
              );
            }
            if (skillAuthority.selectedSkill) {
              const runContext = await agentWorkspaceService().resolveRunContext({
                workspaceId: goal.workspaceId,
                ...(goal.chatSessionId
                  ? { sessionId: goal.chatSessionId }
                  : {}),
              });
              const inputResolution = resolveSkillInput({
                skill: skillAuthority.selectedSkill,
                values: goal.selectedSkillInputValues,
                runContext,
              });
              if (inputResolution.status !== "complete") {
                throw new Error(
                  "Goal 绑定的 Skill 输入缺失或已失效，请重新规划。",
                );
              }
            }
            return skillAuthority.selectedSkill;
          },
          onEvent(event) {
            for (const window of BrowserWindow.getAllWindows()) {
              if (!window.isDestroyed()) {
                window.webContents.send("goal:milestoneRunEvent", event);
              }
            }
          },
        }),
        acceptance: agentGoalAcceptance(),
        onProgress: emitGoalProgressEvent,
        onActiveGoalChange: options.setGoalActive,
        planner: {
          async replan(goal, reason) {
            return createAgentGoalPlanner({
              chatClient: goalChatClient(goal),
              modelProfile: await getGoalModelProfile(goal),
            }).replan(goal, reason);
          },
        },
        trajectoryStore: agentTrajectoryStore(),
        createAcceptanceContext: async (goal, milestone, runResult) => {
          const modelProfile = acceptanceContextNeedsModel(goal, milestone)
            ? await getGoalModelProfile(goal)
            : undefined;
          const runContext = applyGoalOutputRootsToRunContext(
            await agentWorkspaceService().resolveRunContext({
              workspaceId: goal.workspaceId,
              ...(goal.chatSessionId ? { sessionId: goal.chatSessionId } : {}),
            }),
            goal,
          );
          const acceptedMilestones = goal.milestones
            .filter(
              (candidate) =>
                candidate.state === "accepted" || candidate.state === "skipped",
            )
            .map((candidate) => ({
              id: candidate.id,
              description: candidate.description,
              state: candidate.state,
              summary:
                candidate.lastAcceptanceSummary ?? candidate.lastRunSummary ?? null,
              runIds: candidate.runIds,
            }));
          const currentMilestone = milestone
            ? {
                id: milestone.id,
                description: milestone.description,
                state: milestone.state,
                status: milestone.lastRunStatus ?? null,
                summary: milestone.lastRunSummary ?? null,
                acceptanceSummary: milestone.lastAcceptanceSummary ?? null,
                runIds: milestone.runIds,
              }
            : null;
          return {
            runId: milestone?.runIds.at(-1) ?? goal.id,
            goalId: goal.id,
            ...(milestone ? { milestoneId: milestone.id } : {}),
            workspacePath: runContext.workspaceRoot,
            extraReadRoots: runContext.sandbox.extraReadRoots,
            extraWriteRoots: runContext.sandbox.extraWriteRoots,
            toolExecutor: createAuthorizedGoalAcceptanceToolExecutor({
              taskId: `goal_acceptance:${goal.id}:${milestone?.id ?? "final"}`,
              goal,
              runContext,
              toolExecutor,
              toolAuthorizationService: toolAuthorizationService(),
            }),
            trajectoryStore: {
              append(runId, event, appendOptions) {
                const store = agentTrajectoryStore();
                return store.appendNext
                  ? store.appendNext(runId, event, appendOptions)
                  : store.append(runId, event, appendOptions);
              },
            },
            ...(modelProfile
              ? {
                  chatClient: goalChatClient(goal),
                  modelProfile,
                }
              : {}),
            transcriptMessages:
              runResult?.transcriptMessages ??
              goal.runtimeCheckpoint?.transcriptMessages,
            artifacts: {
              goalEvidence: {
                condition: goal.description,
                status: goal.status,
                currentMilestone,
                acceptedMilestones,
                progress: {
                  acceptedCount: acceptedMilestones.length,
                  totalCount: goal.milestones.length,
                  allMilestonesAccepted:
                    goal.milestones.length > 0 &&
                    acceptedMilestones.length === goal.milestones.length,
                },
              },
              milestoneProgress: {
                hasRun: Boolean(
                  milestone?.runIds.length &&
                    (milestone.lastRunStatus ?? "succeeded") === "succeeded",
                ),
                runCount: milestone?.runIds.length ?? 0,
                status: milestone?.lastRunStatus ?? null,
                summary: milestone?.lastRunSummary ?? null,
              },
              goalProgress: {
                acceptedCount: goal.milestones.filter(
                  (candidate) =>
                    candidate.state === "accepted" || candidate.state === "skipped",
                ).length,
                totalCount: goal.milestones.length,
                allMilestonesAccepted:
                  goal.milestones.length > 0 &&
                  goal.milestones.every(
                    (candidate) =>
                      candidate.state === "accepted" || candidate.state === "skipped",
                  ),
              },
            },
          };
        },
        createId: () => `goal_event_${randomUUID()}`,
        nextSequence: nextGoalTrajectorySequence,
        now: () => new Date().toISOString(),
      });
    });
  }

  function goalChatService() {
    return lazy("goalChatService", () =>
      createGoalChatService({
        controller: agentGoalController(),
        goalStore: agentGoalStore(),
        planner: {
          async plan(description, planOptions) {
            const availableTools = dedupeStrings([
              ...planOptions.availableTools,
              ...getAvailableToolNames(),
            ]);
            return createAgentGoalPlanner({
              chatClient: chatClient(),
              modelProfile: await getModelProfile(),
            }).plan(description, {
              ...planOptions,
              availableTools,
            });
          },
          async replan(goal, reason) {
            return createAgentGoalPlanner({
              chatClient: chatClient(),
              modelProfile: await getModelProfile(),
            }).replan(goal, reason);
          },
        },
        getAvailableTools: getAvailableToolNames,
        onProgress: emitGoalProgressEvent,
        onDiagnostic(event) {
          console.warn(`[goal:${event.phase}] ${event.message}`, event.error);
        },
      }),
    );
  }

  function agentGoalTranslator() {
    return lazy("agentGoalTranslator", () =>
      createAgentGoalTranslator({
        chatClient: chatClient(),
        getModelProfile,
        onDiagnostic(event) {
          console.warn(`[goal:translation] ${event.message}`, event.error);
        },
      }),
    );
  }

  function goalDraftService() {
    return lazy("goalDraftService", () =>
      createGoalDraftService({
        translator: agentGoalTranslator(),
      }),
    );
  }

  function getAvailableToolNames(): string[] {
    return createToolExecutor()
      .getRegistry()
      .getDefinitions()
      .map((definition) => definition.function.name);
  }

  function dedupeStrings(values: string[]): string[] {
    return [...new Set(values)];
  }

  function chatService() {
    return lazy("chatService", () =>
      createChatService({
        chatClient: chatClient(),
        getModelProfile,
        memoryStore: memoryStore(),
        memoryProfileStore: memoryProfileStore(),
        chatSessionStore: chatSessionStore(),
        goalService: goalChatService(),
        goalDraftService: goalDraftService(),
        planService: planDebateOrchestrator(),
        proposeGoalAmendment: planOps.proposeGoalObjectiveAmendment,
        runtimeReplanGoal: planOps.createRuntimeGoalPlan,
        taskStore: scheduledTaskStore(),
        runScheduledTask: (taskId: string, taskRunOptions) =>
          runAgentTask(taskId, {
            ...taskRunOptions,
            writeChatTranscript: false,
          }),
        discoverSkills: () => discoverSkills({ skillsDir, forceRefresh: true }),
        workspaceService: agentWorkspaceService(),
        toolExecutor: createToolExecutor(),
        toolAuthorizationService: toolAuthorizationService(),
        trajectoryStore: agentTrajectoryStore(),
        workspaceRunStore: workspaceRunStore(),
        conversationCausalStore: conversationCausalStore(),
        historyIndexStore: historyIndexStore(),
        toolResultOffloadStore: toolResultOffloadStore(),
        compactionStrategy: compactionStrategy(),
        ...(chatProductionKernelDriver()
          ? {
              productionKernelDriver:
                chatProductionKernelDriver()!,
            }
          : {}),
        maxMode: {
          async runStep(req, opts) {
            const provider = await getProvider();
            return createMaxMode(provider).runStep(req, opts);
          },
        },
      }),
    );
  }

  function memoryIngestionService() {
    return lazy("memoryIngestionService", () =>
      createMemoryIngestionService({
        configDir,
        historyIndexStore: historyIndexStore(),
        memoryStore: memoryStore(),
        chatSessionStore: chatSessionStore(),
        chatClient: chatClient(),
        getModelProfile,
      }),
    );
  }

  let runtimeShuttingDown = false;
  let mcpInitializationPromise: Promise<void> | null = null;
  let mcpInitializationTail: Promise<void> = Promise.resolve();
  const initializedMcpServers = new Set<string>();
  const activeMcpClients: McpClient[] = [];
  const activeTaskRunControllers = new Map<string, AbortController>();
  const activeTaskRunCompletions = new Map<string, Promise<void>>();
  const activeRuntimeInvocationCompletions = new Set<Promise<unknown>>();
  const executionReservations = new Set<string>();
  const goalOperationStates = new Map<string, {
    epoch: number;
    pending: number;
    tail: Promise<void>;
  }>();

  function trackRuntimeInvocation<T>(operation: () => Promise<T>): Promise<T> {
    const invocation = operation();
    activeRuntimeInvocationCompletions.add(invocation);
    void invocation.then(
      () => activeRuntimeInvocationCompletions.delete(invocation),
      () => activeRuntimeInvocationCompletions.delete(invocation),
    );
    return invocation;
  }

  function initializeMcpTools(
    toolExecutor: ReturnType<typeof createAgentToolExecutor>,
  ): Promise<void> {
    const operation = mcpInitializationTail
      .catch(() => undefined)
      .then(() => initializeMcpToolsOnce(toolExecutor));
    mcpInitializationTail = operation.catch(() => undefined);
    return operation;
  }

  async function initializeMcpToolsOnce(
    toolExecutor: ReturnType<typeof createAgentToolExecutor>,
  ): Promise<void> {
    if (runtimeShuttingDown) return;
    try {
      const mcpConfigs = await collectSkillMcpConfigs({
        skillsDir,
        trustedServers: readTrustedSkillMcpAllowlist(process.env),
      });

      for (const config of mcpConfigs) {
        if (runtimeShuttingDown) break;
        const serverKey = `${config.sourceSkill}\0${config.name}`;
        if (initializedMcpServers.has(serverKey)) continue;
        let client: McpClient | undefined;
        try {
          client = await createSkillMcpClient(config, {
            configDir,
            processSandbox: processSandboxProvider(),
          });
          const activeClient = client;

          activeMcpClients.push(activeClient);
          await activeClient.connect();
          if (runtimeShuttingDown) {
            await activeClient.disconnect();
            removeActiveMcpClient(activeClient);
            continue;
          }

          const mcpTools = await activeClient.listTools();
          for (const tool of mcpTools) {
            try {
              toolExecutor.getRegistry().register(
                tool,
                async (args, executionOptions) => {
                  const result = await activeClient.callTool(
                    tool.function.name,
                    args,
                    executionOptions?.signal
                      ? { signal: executionOptions.signal }
                      : undefined,
                  );
                  if (result.ok) return result;
                  return { ok: false, error: result.error };
                },
                `mcp:${config.sourceSkill}:${config.name}`,
              );
            } catch {
              // Skip tools that conflict with already registered ones
            }
          }
          initializedMcpServers.add(serverKey);

          console.log(
            `MCP server "${config.name}" initialized with ${mcpTools.length} tools (from skill: ${config.sourceSkill})`,
          );
        } catch (error) {
          let cleanupError: unknown;
          if (client) {
            removeActiveMcpClient(client);
            try {
              await client.disconnect();
            } catch (disconnectError) {
              cleanupError = disconnectError;
            }
          }
          console.error(
            `Failed to initialize MCP server "${config.name}": ${
              error instanceof Error ? error.message : "Unknown error"
            }`,
          );
          if (cleanupError) {
            console.error(
              `Failed to clean up MCP server "${config.name}" after initialization error: ${
                cleanupError instanceof Error
                  ? cleanupError.message
                  : String(cleanupError)
              }`,
            );
          }
        }
      }

      // Script-backed manifest tools are intentionally not registered here.
      // They require a separate activation that maps each manifest permission
      // into ProcessSandboxPolicy and ToolRuntime guards. Merely having the
      // provider must not silently expose arbitrary Node entrypoints.
    } catch (error) {
      console.error(
        `MCP initialization failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }

  function removeActiveMcpClient(client: McpClient): void {
    const index = activeMcpClients.indexOf(client);
    if (index >= 0) {
      activeMcpClients.splice(index, 1);
    }
  }

  type RunAgentTaskOptions = {
    sessionId?: string;
    writeChatTranscript?: boolean;
    beforeExecution?: import("../shared/agentRuns").AgentRunAdmissionGate;
  };

  function runAgentTask(
    taskId: string,
    runOptions?: RunAgentTaskOptions,
  ): Promise<RunScheduledTaskResult> {
    if (runtimeShuttingDown) {
      return Promise.resolve({
        ok: false,
        message: "应用正在退出，未启动新的任务运行。",
      });
    }
    const reservation = `task:${taskId}`;
    if (executionReservations.has(reservation)) {
      return Promise.resolve({
        ok: false,
        message: "这个任务已经在运行中。",
      });
    }
    executionReservations.add(reservation);
    const invocation = trackRuntimeInvocation(() =>
      runAgentTaskAccepted(taskId, runOptions),
    );
    void invocation.then(
      () => executionReservations.delete(reservation),
      () => executionReservations.delete(reservation),
    );
    return invocation;
  }

  async function* runAgentTaskStreaming(
    taskId: string,
  ): AsyncIterable<AgentRunEvent> {
    if (runtimeShuttingDown) {
      yield {
        level: "error",
        message: "应用正在退出，未启动新的任务运行。",
        createdAt: new Date().toISOString(),
      };
      return;
    }
    const reservation = `task:${taskId}`;
    if (
      executionReservations.has(reservation) ||
      activeTaskRunControllers.has(taskId)
    ) {
      yield {
        level: "error",
        message: "这个任务已经在运行中。",
        createdAt: new Date().toISOString(),
      };
      return;
    }

    executionReservations.add(reservation);
    const controller = new AbortController();
    let settleCompletion: (() => void) | undefined;
    let admittedCandidate: AgentRunAdmissionCandidate | undefined;
    const completion = new Promise<void>((resolve) => {
      settleCompletion = resolve;
    });

    try {
      for await (const event of agentRunnerService().runTaskStreaming(taskId, {
        signal: controller.signal,
        onExecutionAdmitted(candidate) {
          if (candidate.taskId !== taskId) {
            throw new Error("AgentRun admission callback task identity changed.");
          }
          admittedCandidate = candidate;
          activeTaskRunControllers.set(taskId, controller);
          activeTaskRunCompletions.set(taskId, completion);
          emitAgentRunsChanged({
            reason: "active_execution_changed",
            runId: candidate.runId,
            taskId,
          });
        },
      })) {
        yield event;
      }
    } finally {
      if (!controller.signal.aborted) {
        controller.abort("stream_consumer_detached");
      }
      executionReservations.delete(reservation);
      if (admittedCandidate && activeTaskRunControllers.get(taskId) === controller) {
        activeTaskRunControllers.delete(taskId);
      }
      if (admittedCandidate) settleCompletion?.();
      if (admittedCandidate && activeTaskRunCompletions.get(taskId) === completion) {
        activeTaskRunCompletions.delete(taskId);
      }
      if (admittedCandidate) {
        emitAgentRunsChanged({
          reason: "active_execution_changed",
          runId: admittedCandidate.runId,
          taskId,
        });
      }
    }
  }

  async function runAgentTaskAccepted(
    taskId: string,
    runOptions?: RunAgentTaskOptions,
  ): Promise<RunScheduledTaskResult> {
    if (activeTaskRunControllers.has(taskId)) {
      return {
        ok: false,
        message: "这个任务已经在运行中。",
      };
    }

    const task = await scheduledTaskStore().get(taskId);
    if (runtimeShuttingDown) {
      return { ok: false, message: "应用正在退出，任务运行已取消。" };
    }
    if (!task) {
      return {
        ok: false,
        message: "Scheduled task was not found.",
      };
    }

    const sessionId = await resolveTaskRunSessionId(task, runOptions);
    if (runtimeShuttingDown) {
      return { ok: false, message: "应用正在退出，任务运行已取消。" };
    }
    const controller = new AbortController();
    let settleCompletion: (() => void) | undefined;
    let admittedCandidate: AgentRunAdmissionCandidate | undefined;
    const completion = new Promise<void>((resolve) => {
      settleCompletion = resolve;
    });

    try {
      const result = await agentRunnerService().runTask(taskId, {
        signal: controller.signal,
        ...(sessionId ? { sessionId } : {}),
        ...(runOptions?.beforeExecution
          ? { beforeExecution: runOptions.beforeExecution }
          : {}),
        onExecutionAdmitted(candidate) {
          if (candidate.taskId !== taskId) {
            throw new Error("AgentRun admission callback task identity changed.");
          }
          admittedCandidate = candidate;
          activeTaskRunControllers.set(taskId, controller);
          activeTaskRunCompletions.set(taskId, completion);
          emitAgentRunsChanged({
            reason: "active_execution_changed",
            runId: candidate.runId,
            taskId,
          });
        },
      });
      if (sessionId && shouldWriteTaskRunTranscript(runOptions)) {
        await appendTaskRunChatResult(sessionId, result);
      }
      emitAgentRunsChanged({
        reason: "run_updated",
        taskId,
        ...(result.ok ? { runId: result.run.id } : {}),
      });
      return result;
    } finally {
      if (admittedCandidate && activeTaskRunControllers.get(taskId) === controller) {
        activeTaskRunControllers.delete(taskId);
      }
      if (admittedCandidate) settleCompletion?.();
      if (admittedCandidate && activeTaskRunCompletions.get(taskId) === completion) {
        activeTaskRunCompletions.delete(taskId);
      }
      if (admittedCandidate) {
        emitAgentRunsChanged({
          reason: "active_execution_changed",
          runId: admittedCandidate.runId,
          taskId,
        });
      }
    }
  }

  async function resolveTaskRunSessionId(
    task: ScheduledTask,
    runOptions: RunAgentTaskOptions | undefined,
  ): Promise<string | undefined> {
    if (runOptions?.sessionId) {
      return runOptions.sessionId;
    }

    if (!shouldWriteTaskRunTranscript(runOptions)) {
      return undefined;
    }

    const created = await chatSessionStore().appendMessage({
      role: "user",
      content: formatScheduledTaskRunPrompt(task),
    });
    return created.session.id;
  }

  function shouldWriteTaskRunTranscript(
    runOptions: RunAgentTaskOptions | undefined,
  ): boolean {
    return runOptions?.writeChatTranscript ?? !runOptions?.sessionId;
  }

  async function appendTaskRunChatResult(
    sessionId: string,
    result: RunScheduledTaskResult,
  ): Promise<void> {
    await chatSessionStore().appendMessage({
      sessionId,
      role: "assistant",
      content: formatScheduledTaskRunResult(result),
      ...(result.ok ? { executedRunId: result.run.id } : {}),
    });
  }

  function resumeAgentRun(runId: string): Promise<RunScheduledTaskResult> {
    if (runtimeShuttingDown) {
      return Promise.resolve({
        ok: false,
        message: "应用正在退出，未恢复任务运行。",
      });
    }
    const runReservation = `run:${runId}`;
    if (executionReservations.has(runReservation)) {
      return Promise.resolve({ ok: false, message: "这个运行已经在恢复中。" });
    }
    executionReservations.add(runReservation);
    const reservations = [runReservation];
    const invocation = trackRuntimeInvocation(() =>
      resumeAgentRunAccepted(runId, reservations),
    );
    void invocation.then(
      () => reservations.forEach((reservation) => executionReservations.delete(reservation)),
      () => reservations.forEach((reservation) => executionReservations.delete(reservation)),
    );
    return invocation;
  }

  async function resumeAgentRunAccepted(
    runId: string,
    reservations: string[],
  ): Promise<RunScheduledTaskResult> {
    const checkpoint = await agentExecutionStore().get(runId);
    if (runtimeShuttingDown) {
      return { ok: false, message: "应用正在退出，任务恢复已取消。" };
    }

    if (!checkpoint) {
      return {
        ok: false,
        message: "运行检查点不存在，无法恢复。",
      };
    }

    const taskReservation = `task:${checkpoint.taskId}`;
    if (
      executionReservations.has(taskReservation) ||
      activeTaskRunControllers.has(checkpoint.taskId)
    ) {
      return {
        ok: false,
        message: "这个任务已经在运行中。",
      };
    }
    executionReservations.add(taskReservation);
    reservations.push(taskReservation);

    const controller = new AbortController();
    let settleCompletion: (() => void) | undefined;
    let admittedCandidate: AgentRunAdmissionCandidate | undefined;
    const completion = new Promise<void>((resolve) => {
      settleCompletion = resolve;
    });

    try {
      const result = await agentRunnerService().resumeRun(runId, {
        signal: controller.signal,
        async beforeExecution(candidate) {
          if (!candidate.executionEnvelope) {
            throw new AgentRunRevisionConflictError();
          }
          const executionEnvelopeFingerprint =
            createConversationRequestFingerprint(candidate.executionEnvelope);
          const begun = await conversationCausalStore().beginAgentRunResume({
            runId: candidate.runId,
            taskId: candidate.taskId,
            executionEnvelopeFingerprint,
          });
          if (begun.disposition === "not_found") {
            throw new AgentRunRevisionConflictError();
          }
          if (begun.disposition !== "applied" || !begun.value) {
            throw new AgentRunRevisionConflictError();
          }
          const claim = begun.value;
          if (
            claim.executionEnvelopeFingerprint
              !== executionEnvelopeFingerprint
          ) {
            throw new AgentRunRevisionConflictError();
          }
          return {
            runId: claim.runId,
            taskId: claim.taskId,
            executionRevision: claim.executionRevision,
            executionEnvelope: candidate.executionEnvelope,
            async settle(status, expectedExecutionRevision) {
              if (expectedExecutionRevision !== claim.executionRevision) {
                throw new AgentRunRevisionConflictError();
              }
              const finalStatus = status === "waiting_for_approval"
                ? "paused"
                : status;
              if (
                finalStatus !== "succeeded"
                && finalStatus !== "paused"
                && finalStatus !== "failed"
                && finalStatus !== "canceled"
              ) {
                throw new AgentRunRevisionConflictError();
              }
              const settled = await conversationCausalStore()
                .settleAgentRunAdmission({
                  requestId: claim.requestId,
                  runId: claim.runId,
                  expectedExecutionRevision,
                  state: "settled",
                  finalStatus,
                });
              if (
                settled.disposition !== "applied"
                && settled.disposition !== "duplicate"
              ) {
                throw new AgentRunRevisionConflictError();
              }
            },
          };
        },
        onExecutionAdmitted(candidate) {
          if (
            candidate.runId !== runId
            || candidate.taskId !== checkpoint.taskId
          ) {
            throw new AgentRunRevisionConflictError();
          }
          admittedCandidate = candidate;
          activeTaskRunControllers.set(checkpoint.taskId, controller);
          activeTaskRunCompletions.set(checkpoint.taskId, completion);
          emitAgentRunsChanged({
            reason: "active_execution_changed",
            runId,
            taskId: checkpoint.taskId,
          });
        },
      });
      emitAgentRunsChanged({
        reason: "run_updated",
        runId: result.ok ? result.run.id : runId,
        taskId: checkpoint.taskId,
      });
      return result;
    } finally {
      if (
        admittedCandidate
        && activeTaskRunControllers.get(checkpoint.taskId) === controller
      ) {
        activeTaskRunControllers.delete(checkpoint.taskId);
      }
      if (admittedCandidate) settleCompletion?.();
      if (
        admittedCandidate
        && activeTaskRunCompletions.get(checkpoint.taskId) === completion
      ) {
        activeTaskRunCompletions.delete(checkpoint.taskId);
      }
      if (admittedCandidate) {
        emitAgentRunsChanged({
          reason: "active_execution_changed",
          runId,
          taskId: checkpoint.taskId,
        });
      }
    }
  }

  async function pauseAgentRun(runId: string): Promise<PauseAgentRunResult> {
    const checkpoint = await agentExecutionStore().get(runId);

    if (!checkpoint) {
      return {
        ok: false,
        message: "运行检查点不存在，无法暂停。",
      };
    }

    if (isTerminalExecutionStatus(checkpoint.status)) {
      return {
        ok: false,
        message: "运行已结束，无法暂停。",
      };
    }

    const controller = activeTaskRunControllers.get(checkpoint.taskId);
    if (controller) {
      controller.abort("pause");
      return {
        ok: true,
        message: "已请求暂停运行。",
      };
    }

    await agentExecutionStore().save({
      ...checkpoint,
      status: "paused",
      updatedAt: new Date().toISOString(),
    });
    emitAgentRunsChanged({
      reason: "active_execution_changed",
      runId,
      taskId: checkpoint.taskId,
    });

    return {
      ok: true,
      message: "运行已标记为可恢复。",
    };
  }

  async function openAgentRunSession(
    runId: string,
  ): Promise<OpenAgentRunSessionResult> {
    const [run, checkpoint] = await Promise.all([
      agentRunStore().get(runId),
      agentExecutionStore().get(runId),
    ]);

    if (!run && !checkpoint) {
      return {
        ok: false,
        message: "运行记录不存在，无法打开会话。",
      };
    }

    const existingSessionId =
      run?.runContext?.sessionId ?? checkpoint?.runContext?.sessionId;
    if (existingSessionId) {
      const session = await chatSessionStore().get(existingSessionId);
      if (session) {
        return { ok: true, sessionId: existingSessionId };
      }
    }

    const taskId = checkpoint?.taskId ?? run?.taskId;
    const task = taskId ? await scheduledTaskStore().get(taskId) : null;
    const created = await chatSessionStore().appendMessage({
      role: "user",
      content: formatAgentRunSessionPrompt(task, run, checkpoint),
    });
    await chatSessionStore().appendMessage({
      sessionId: created.session.id,
      role: "assistant",
      content: formatAgentRunSessionStatus(task, run, checkpoint),
      ...(run ? { executedRunId: run.id } : {}),
    });

    if (checkpoint) {
      const runContext = checkpoint.runContext
        ? { ...checkpoint.runContext, sessionId: created.session.id }
        : await agentWorkspaceService().resolveRunContext({
            sessionId: created.session.id,
          });
      await agentExecutionStore().save({
        ...checkpoint,
        runContext,
        updatedAt: new Date().toISOString(),
      });
      emitAgentRunsChanged({
        reason: "active_execution_changed",
        runId: checkpoint.runId,
        taskId: checkpoint.taskId,
      });
    }

    return { ok: true, sessionId: created.session.id };
  }

  function createGoalDraft(input: {
    description: string;
    successCriteria: string[];
    /** @deprecated Ignored. Kept for IPC compatibility. */
    budget?: GoalBudget;
    reviewPolicy: GoalReviewPolicy;
  }): Goal {
    const now = new Date().toISOString();
    const goalCondition = input.description.trim() || "Goal must be accepted with evidence.";
    const criteria = input.successCriteria
      .filter((description) => description.trim())
      .map((description, index): SuccessCriterion => ({
        id: `criterion_${index + 1}`,
        description: description.trim(),
        acceptanceChecks: [
          {
            id: `criterion_${index + 1}_review`,
            kind: "model_review",
            description: "Evidence-backed review is required.",
            params: {
              condition: description.trim(),
              evidenceRefs: ["artifact:goalEvidence"],
            },
            requiresEvidence: true,
          },
        ],
      }));

    return upgradeGoalAcceptanceProtocol({
      id: `goal_${randomUUID()}`,
      description: input.description.trim(),
      successCriteria: criteria.length
        ? criteria
        : [
            {
              id: "criterion_1",
              description: "Goal must be accepted with evidence.",
              acceptanceChecks: [
                {
                  id: "criterion_1_review",
                  kind: "model_review",
                  description: "Evidence-backed review is required.",
                  params: {
                    condition: goalCondition,
                    evidenceRefs: ["artifact:goalEvidence"],
                  },
                  requiresEvidence: true,
                },
              ],
            },
          ],
      milestones: [],
      status: "planning",
      executionUsage: {
        iterations: 0,
        toolCalls: 0,
        wallClockMs: 0,
        tokens: 0,
        replans: 0,
      },
      reviewPolicy: input.reviewPolicy,
      planVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
  }

  function confirmGoalDraft(
    draftId: string,
    edit?: GoalDraftEdit,
  ): Promise<GoalDraftConfirmResult> {
    if (runtimeShuttingDown) {
      return Promise.resolve({ ok: false, message: "应用正在退出，未启动目标。" });
    }
    return trackRuntimeInvocation(() => planOps.confirmGoalDraftAccepted(draftId, edit));
  }

  function discardGoalDraft(draftId: string): GoalDraftDiscardResult {
    return goalDraftService().discard(draftId);
  }

  function runGoalOperation(
    goalId: string,
    operation: () => Promise<ChatSessionGoalSummary>,
    options?: { preempt?: boolean },
  ): Promise<{ ok: boolean; goal?: Goal; message?: string }> {
    if (runtimeShuttingDown) {
      return Promise.resolve({ ok: false, message: "应用正在退出，未启动目标操作。" });
    }
    const state = goalOperationStates.get(goalId) ?? {
      epoch: 0,
      pending: 0,
      tail: Promise.resolve(),
    };
    if (!goalOperationStates.has(goalId)) {
      goalOperationStates.set(goalId, state);
    }
    state.pending += 1;
    if (options?.preempt) {
      // A preempting cancel runs immediately, invalidates older queued work,
      // and becomes the barrier that every later mutation must await.
      state.epoch += 1;
      const invocation = trackRuntimeInvocation(() =>
        runGoalOperationAccepted(operation),
      );
      const tail = invocation.then(
        () => undefined,
        () => undefined,
      );
      state.tail = tail;
      finishGoalOperationState(goalId, state, tail);
      return invocation;
    }

    const operationEpoch = state.epoch;
    const previous = state.tail;
    const invocation = trackRuntimeInvocation(async () => {
      await previous.catch(() => undefined);
      if (runtimeShuttingDown) {
        return { ok: false, message: "应用正在退出，目标操作已取消。" };
      }
      if (operationEpoch !== state.epoch) {
        return { ok: false, message: "目标操作已被更高优先级的取消请求取代。" };
      }
      return runGoalOperationAccepted(operation);
    });
    const tail = invocation.then(
      () => undefined,
      () => undefined,
    );
    state.tail = tail;
    finishGoalOperationState(goalId, state, tail);
    return invocation;
  }

  function finishGoalOperationState(
    goalId: string,
    state: { epoch: number; pending: number; tail: Promise<void> },
    completion: Promise<void>,
  ): void {
    void completion.finally(() => {
      state.pending -= 1;
      if (
        state.pending === 0 &&
        goalOperationStates.get(goalId) === state
      ) {
        goalOperationStates.delete(goalId);
      }
    });
  }

  async function runGoalOperationAccepted(
    operation: () => Promise<ChatSessionGoalSummary>,
  ): Promise<{ ok: boolean; goal?: Goal; message?: string }> {
    try {
      const summary = await operation();
      const goal = await agentGoalStore().get(summary.id);
      if (!goal) {
        return { ok: false, message: "目标不存在。" };
      }

      return { ok: true, goal };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "无法更新目标状态。",
      };
    }
  }

  async function readToolResultRef(
    ref: string,
    options?: ReadToolResultRefOptions & Pick<ToolResultOffloadReadScope, "capability">,
  ): Promise<ReadToolResultRefResult> {
    if (!isSafeToolResultRef(ref)) {
      return {
        ok: false,
        message: "工具结果引用无效。",
      };
    }

    let readScope: ToolResultOffloadReadScope | undefined = options;
    if (options?.trajectoryEventId) {
      if (!options.runId) {
        return { ok: false, message: "工具结果引用缺少受信轨迹归属。" };
      }
      const event = (await agentTrajectoryStore().list(options.runId)).find(
        (candidate) => candidate.id === options.trajectoryEventId,
      );
      if (
        !event
        || event.runId !== options.runId
        || extractToolResultRef(event.payload) !== ref
      ) {
        return { ok: false, message: "工具结果引用与轨迹证据不匹配。" };
      }
      readScope = {
        capability: issueToolResultRefReadCapability({
          ref,
          issuedByRunId: event.runId,
        }),
      };
    }

    const content = await toolResultOffloadStore().read(ref, readScope);
    if (!content) {
      return {
        ok: false,
        message: "没有找到这个工具结果引用。",
      };
    }

    return {
      ok: true,
      ref,
      content,
      summary: summarizeToolResultContent(content),
    };
  }

  async function runMemoryEvals(): Promise<
    | { ok: true; report: MemoryEvalReport }
    | { ok: false; message: string }
  > {
    try {
      const records = await memoryStore().list({
        kind: "all",
        includeArchived: false,
        limit: 500,
      });
      return {
        ok: true,
        report: evaluateMemory(records, createDefaultMemoryEvalCases(records)),
      };
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error ? error.message : "无法评估记忆检索质量。",
      };
    }
  }

  async function runAgentQualityEvals(): Promise<AgentEvalReport> {
    return runAgentEvals(
      createCombinedAgentEvalFixtures(
        createAgentEvalFixtures(),
        await promotedAgentEvalFixtureStore().list(),
      ),
    );
  }

  const lazyStore = new Map<string, unknown>();

  function lazy<T>(key: string, factory: () => T): T {
    if (!lazyStore.has(key)) {
      lazyStore.set(key, factory());
    }
    return lazyStore.get(key) as T;
  }

  async function shutdownRuntime(): Promise<void> {
    runtimeShuttingDown = true;
    for (const controller of activeTaskRunControllers.values()) {
      if (!controller.signal.aborted) {
        controller.abort("application_shutdown");
      }
    }
    const goalService = lazyStore.get("goalChatService") as
      | GoalChatService
      | undefined;
    const goalClose = goalService?.shutdown() ?? Promise.resolve();

    const initialMcpCloses = activeMcpClients
      .splice(0)
      .map((client) => client.disconnect());
    (lazyStore.get("selfImprovementService") as
      | ReturnType<typeof createSelfImprovementService>
      | undefined)?.stop();
    const workerClose = (lazyStore.get("toolWorker") as
      | ReturnType<typeof createToolWorker>
      | undefined)?.close() ?? Promise.resolve();
    const actorClose = (lazyStore.get("actorRuntime") as
      | ReturnType<typeof createActorRuntime>
      | undefined)?.shutdown?.() ?? Promise.resolve();
    const drainResults = await Promise.allSettled([
      ...activeTaskRunCompletions.values(),
      ...activeRuntimeInvocationCompletions,
      goalClose,
      ...initialMcpCloses,
      mcpInitializationPromise ?? Promise.resolve(),
      mcpInitializationTail,
      workerClose,
      actorClose,
    ]);
    const lateMcpCloses = activeMcpClients
      .splice(0)
      .map((client) => client.disconnect());
    const lateMcpResults = await Promise.allSettled(lateMcpCloses);
    const flushResults = await Promise.allSettled([
      goalProgressDeliveryQueue,
      (lazyStore.get("agentRunStore") as AgentRunStore | undefined)
        ?.flushShadowWrites({ close: true }) ?? Promise.resolve(),
      (lazyStore.get("agentExecutionStore") as AgentExecutionStore | undefined)
        ?.flushShadowWrites({ close: true }) ?? Promise.resolve(),
      (lazyStore.get("agentTrajectoryStore") as AgentTrajectoryStore | undefined)
        ?.flushShadowWrites({ close: true }) ?? Promise.resolve(),
      (lazyStore.get("agentGoalStore") as AgentGoalStore | undefined)
        ?.flushShadowWrites({ close: true }) ?? Promise.resolve(),
      (lazyStore.get("agentWorkspaceStore") as
        | ReturnType<typeof createAgentWorkspaceStore>
        | undefined)?.flushShadowWrites({ close: true }) ?? Promise.resolve(),
      (lazyStore.get("multiAgentSessionStore") as
        | ReturnType<typeof createMultiAgentSessionStore>
        | undefined)?.flushShadowWrites({ close: true }) ?? Promise.resolve(),
      (lazyStore.get("agentLearningStore") as
        | ReturnType<typeof createAgentLearningStore>
        | undefined)?.flushShadowWrites({ close: true }) ?? Promise.resolve(),
      (lazyStore.get("agentEvalCandidateStore") as
        | ReturnType<typeof createAgentEvalCandidateStore>
        | undefined)?.flushShadowWrites({ close: true }) ?? Promise.resolve(),
      (lazyStore.get("promotedAgentEvalFixtureStore") as
        | ReturnType<typeof createPromotedAgentEvalFixtureStore>
        | undefined)?.flushShadowWrites({ close: true }) ?? Promise.resolve(),
      (lazyStore.get("scheduledTaskStore") as
        | ReturnType<typeof createScheduledTaskStore>
        | undefined)?.flushShadowWrites({ close: true }) ?? Promise.resolve(),
      (lazyStore.get("agentValidationStore") as
        | ReturnType<typeof createAgentValidationStore>
        | undefined)?.flushShadowWrites({ close: true }) ?? Promise.resolve(),
      (lazyStore.get("memoryProfileStore") as
        | ReturnType<typeof createMemoryProfileStore>
        | undefined)?.flushShadowWrites({ close: true }) ?? Promise.resolve(),
      (lazyStore.get("memoryStore") as MemoryStore | undefined)
        ?.flushShadowWrites({ close: true }) ?? Promise.resolve(),
      (lazyStore.get("toolAuditLog") as
        | ReturnType<typeof createToolAuditLog>
        | undefined)?.flushShadowWrites({ close: true }) ?? Promise.resolve(),
      (lazyStore.get("chatSessionStore") as ChatSessionStore | undefined)
        ?.flush() ?? Promise.resolve(),
      (lazyStore.get("conversationDisclosureMaterializer") as
        | ConversationDisclosureMaterializer
        | undefined)?.close() ?? Promise.resolve(),
    ]);
    let storageCloseError: unknown;
    try {
      (lazyStore.get("storage") as Storage | null | undefined)?.close();
    } catch (error) {
      storageCloseError = error;
    }
    const failed = [...drainResults, ...lateMcpResults, ...flushResults].find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failed || storageCloseError) {
      throw failed?.reason ?? storageCloseError;
    }
  }

  return {
    appMeta,
    initializeStorageConvergence,
    reconcileAgentRunAdmissions,
    reconcileInterruptedApprovals,
    getNavigationSections,
    buildDesktopRuntimeInfo: () =>
      buildDesktopRuntimeInfo({
        appPath: app.getAppPath(),
        isPackaged: app.isPackaged,
        productName: appMeta.productName,
        rendererMode:
          !app.isPackaged && process.env.ELECTRON_RENDERER_URL
            ? "development"
            : "production",
        userDataPath: app.getPath("userData"),
        version: app.getVersion(),
      }),
    discoverSkills: () => discoverSkills({ skillsDir, forceRefresh: true }),
    modelSettingsStore,
    modelConnectionService,
    modelRouter,
    agentBootstrapService,
    agentValidationStore,
    scheduledTaskStore,
    runProductionStorageSmoke,
    kernelEventBus,
    setKernelPermissionRules,
    toolAuditLog,
    toolAuthorizationService,
    toolWorker,
    agentRunStore,
    agentExecutionStore,
    agentTrajectoryStore,
    agentGoalStore,
    agentGoalValidatorRegistry,
    agentGoalAcceptance,
    goalChatService,
    agentGoalController,
    agentWorkspaceStore,
    workspaceRunStore,
    conversationCausalStore,
    conversationDisclosureMaterializer,
    conversationEvidenceResolver,
    agentWorkspaceService,
    requestGitWorktreeAgentWorkspace,
    multiAgentSessionStore,
    multiAgentCoordinator,
    planStore,
    planArtifactWriter,
    planDebateOrchestrator,
    memoryStore,
    memoryProfileStore,
    memoryIngestionService,
    historyIndexStore,
    toolResultOffloadStore,
    agentLearningStore,
    agentLearningService,
    agentEvalCandidateStore,
    promotedAgentEvalFixtureStore,
    agentEvalCandidateService,
    agentRunnerService,
    chatSessionStore,
    listChatSessions: chatSessions.listChatSessions,
    getChatSession: chatSessions.getChatSession,
    getChatSessionTranscriptPage: chatSessions.getChatSessionTranscriptPage,
    archiveChatSession: chatSessions.archiveChatSession,
    restoreChatSession: chatSessions.restoreChatSession,
    renameChatSession: chatSessions.renameChatSession,
    deleteChatSession: chatSessions.deleteChatSession,
    chatService,
    taskSchedulerService,
    runAgentTask,
    runAgentTaskStreaming,
    openAgentRunSession,
    resumeAgentRun,
    pauseAgentRun,
    createGoalDraft,
    goalDraftService,
    confirmGoalDraft,
    discardGoalDraft,
    confirmPlan: planOps.confirmPlan,
    discardPlan: planOps.discardPlan,
    createRuntimeGoalPlan: planOps.createRuntimeGoalPlan,
    adoptGoalPlan: planOps.adoptGoalPlan,
    proposeGoalAmendment: planOps.proposeGoalAmendment,
    resolveGoalAmendment: planOps.resolveGoalAmendment,
    runGoalOperation,
    replanGoal: planOps.createRuntimeGoalPlan,
    retryGoal: (goalId: string) =>
      runGoalOperation(goalId, () => goalChatService().retry(goalId)),
    continueGoalAcceptance: (goalId: string) =>
      runGoalOperation(goalId, () => goalChatService().continueAcceptance(goalId)),
    markGoalCompletedUnverified: (goalId: string) =>
      runGoalOperation(goalId, () => goalChatService().markCompletedUnverified(goalId)),
    resumeInterruptedGoals() {
      if (runtimeShuttingDown) return Promise.resolve(0);
      return trackRuntimeInvocation(async () => {
        const activeGoals = await agentGoalStore().listActive();
        const interrupted = activeGoals.filter(
          (goal) => goal.status === "executing",
        );
        let recovered = 0;
        for (const goal of interrupted) {
          try {
            const prepared = prepareInterruptedGoalForResume(goal);
            if (prepared !== goal) {
              await agentGoalStore().save(prepared);
              recovered += 1;
            }
          } catch (error) {
            console.error(`Failed to recover interrupted goal ${goal.id}:`, error);
          }
        }
        return recovered;
      });
    },
    initializeMcpTools: () => initializeMcpTools(createToolExecutor()),
    getActiveMcpClients: () => activeMcpClients,
    getActiveTaskRunControllers: () => activeTaskRunControllers,
    shutdownRuntime,
    readToolResultRef,
    runMemoryEvals,
    runAgentQualityEvals,
    selfImprovementService,
    onGoalProgressEvent,
    onAgentRunsChanged,
  };
}


export {
  prepareInterruptedGoalForResume,
  reconcileIrreversibleGoalProgressEvent,
} from "./container/helpers";



