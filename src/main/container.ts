import { createStoresRuntime } from "./container/stores";
import { createTaskRunRuntime } from "./container/taskRuns";
import { createPlanOpsRuntime } from "./container/planOps";
import { createGoalOpsRuntime } from "./container/goalOps";
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

  const kernelRulesHolder = { value: [] as PermissionRule[] };
  let runtimeShuttingDown = false;
  let mcpInitializationPromise: Promise<void> | null = null;
  let mcpInitializationTail: Promise<void> = Promise.resolve();


  const stores = createStoresRuntime({
    configDir,
    skillsDir,
    appMeta,
    options,
    storage,
    storageBackend,
    activeSqliteStorage,
    kernelRules: kernelRulesHolder,
    scheduledTaskStore,
    toolAuditLog,
    modelConnectionService,
    agentValidationStore,
    modelSettingsStore: () => modelSettingsStore,
    createToolExecutor,
    processSandboxProvider,
    taskRuns: () => taskRuns,
    planOps: () => planOps,
    emitGoalProgressEvent,
    disclosure: { loadConversationDisclosureReadSet: (...a: Parameters<typeof disclosure.loadConversationDisclosureReadSet>) => disclosure.loadConversationDisclosureReadSet(...a), authorizeConversationEvidenceTarget: (...a: Parameters<typeof disclosure.authorizeConversationEvidenceTarget>) => disclosure.authorizeConversationEvidenceTarget(...a), resolveConversationEvidence: (...a: Parameters<typeof disclosure.resolveConversationEvidence>) => disclosure.resolveConversationEvidence(...a) },
  } as unknown as Parameters<typeof createStoresRuntime>[0]);
  const { toolAuthorizationService, kernelEventBus, productionKernelDriver, chatProductionKernelDriver, goalProductionKernelDriver, agentRunStore, agentExecutionStore, agentTrajectoryStore, agentGoalStore, agentWorkspaceStore, workspaceRunStore, conversationCausalStore, conversationDisclosureMaterializer, conversationEvidenceResolver, agentWorkspaceService, requestGitWorktreeAgentWorkspace, multiAgentSessionStore, planStore, planArtifactWriter, planDebateOrchestrator, memoryProfileStore, toolResultOffloadStore, agentLearningStore, agentEvalCandidateStore, promotedAgentEvalFixtureStore, chatSessionStore, memoryStore, historyIndexStore, agentLearningService, agentEvalCandidateService, multiAgentCoordinator, taskSchedulerService, getModelProfile, toRuntimeModelProfile, resolveGoalModelSettings, getGoalModelProfile, goalChatClient, getGoalProvider, chatClient, getProvider, modelRouter, shellAnalyzer, toolWorker, checkpointRepository, memoryRepository, compactionStrategy, runRepository, actorRuntime, checkpointWriterOrchestrator, workflowRuntime, sessionRepository, selfImprovementService, agentBootstrapService, agentRunnerService, agentGoalValidatorRegistry, agentGoalAcceptance, agentGoalController, goalChatService, agentGoalTranslator, goalDraftService, getAvailableToolNames, dedupeStrings, chatService, memoryIngestionService } = stores;
  const goalOps = createGoalOpsRuntime({
    runtimeShuttingDown: () => runtimeShuttingDown,
    trackRuntimeInvocation,
    planOps: () => planOps,
    goalDraftService,
    agentGoalStore,
    agentTrajectoryStore,
    toolResultOffloadStore,
    memoryStore,
    promotedAgentEvalFixtureStore,
  } as unknown as Parameters<typeof createGoalOpsRuntime>[0]);
  const { createGoalDraft, confirmGoalDraft, discardGoalDraft, runGoalOperation, readToolResultRef, runMemoryEvals, runAgentQualityEvals } = goalOps;
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


;
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

  function setKernelPermissionRules(rules: PermissionRule[]): {
    ok: true;
    count: number;
  } {
    kernelRulesHolder.value = [...rules];
    return { ok: true, count: kernelRulesHolder.value.length };
  }
  const initializedMcpServers = new Set<string>();
  const activeMcpClients: McpClient[] = [];
  const activeTaskRunControllers = new Map<string, AbortController>();
  const activeTaskRunCompletions = new Map<string, Promise<void>>();
  const activeRuntimeInvocationCompletions = new Set<Promise<unknown>>();
  const executionReservations = new Set<string>();
  function trackRuntimeInvocation<T>(operation: () => Promise<T>): Promise<T> {
    const invocation = operation();
    activeRuntimeInvocationCompletions.add(invocation);
    void invocation.then(
      () => activeRuntimeInvocationCompletions.delete(invocation),
      () => activeRuntimeInvocationCompletions.delete(invocation),
    );
    return invocation;
  }

  const taskRuns = createTaskRunRuntime({
    agentExecutionStore,
    agentRunStore,
    agentRunnerService,
    agentWorkspaceService,
    chatSessionStore,
    conversationCausalStore,
    scheduledTaskStore,
    activeTaskRunControllers: () => activeTaskRunControllers,
    activeTaskRunCompletions: () => activeTaskRunCompletions,
    executionReservations: () => executionReservations,
    emitAgentRunsChanged: (payload: unknown) => emitAgentRunsChanged(payload as never),
    trackRuntimeInvocation,
    runtimeShuttingDown: () => runtimeShuttingDown,
  } as unknown as Parameters<typeof createTaskRunRuntime>[0]);

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
    const goalService = goalChatService() as
      | GoalChatService
      | undefined;
    const goalClose = goalService?.shutdown() ?? Promise.resolve();

    const initialMcpCloses = activeMcpClients
      .splice(0)
      .map((client) => client.disconnect());
    (selfImprovementService() as
      | ReturnType<typeof createSelfImprovementService>
      | undefined)?.stop();
    const workerClose = (toolWorker() as
      | ReturnType<typeof createToolWorker>
      | undefined)?.close() ?? Promise.resolve();
    const actorClose = (actorRuntime() as
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
      (agentRunStore() as AgentRunStore | undefined)
        ?.flushShadowWrites({ close: true }) ?? Promise.resolve(),
      (agentExecutionStore() as AgentExecutionStore | undefined)
        ?.flushShadowWrites({ close: true }) ?? Promise.resolve(),
      (agentTrajectoryStore() as AgentTrajectoryStore | undefined)
        ?.flushShadowWrites({ close: true }) ?? Promise.resolve(),
      (agentGoalStore() as AgentGoalStore | undefined)
        ?.flushShadowWrites({ close: true }) ?? Promise.resolve(),
      (agentWorkspaceStore() as
        | ReturnType<typeof createAgentWorkspaceStore>
        | undefined)?.flushShadowWrites({ close: true }) ?? Promise.resolve(),
      (multiAgentSessionStore() as
        | ReturnType<typeof createMultiAgentSessionStore>
        | undefined)?.flushShadowWrites({ close: true }) ?? Promise.resolve(),
      (agentLearningStore() as
        | ReturnType<typeof createAgentLearningStore>
        | undefined)?.flushShadowWrites({ close: true }) ?? Promise.resolve(),
      (agentEvalCandidateStore() as
        | ReturnType<typeof createAgentEvalCandidateStore>
        | undefined)?.flushShadowWrites({ close: true }) ?? Promise.resolve(),
      (promotedAgentEvalFixtureStore() as
        | ReturnType<typeof createPromotedAgentEvalFixtureStore>
        | undefined)?.flushShadowWrites({ close: true }) ?? Promise.resolve(),
      (lazyStore.get("scheduledTaskStore") as
        | ReturnType<typeof createScheduledTaskStore>
        | undefined)?.flushShadowWrites({ close: true }) ?? Promise.resolve(),
      (lazyStore.get("agentValidationStore") as
        | ReturnType<typeof createAgentValidationStore>
        | undefined)?.flushShadowWrites({ close: true }) ?? Promise.resolve(),
      (memoryProfileStore() as
        | ReturnType<typeof createMemoryProfileStore>
        | undefined)?.flushShadowWrites({ close: true }) ?? Promise.resolve(),
      (memoryStore() as MemoryStore | undefined)
        ?.flushShadowWrites({ close: true }) ?? Promise.resolve(),
      (lazyStore.get("toolAuditLog") as
        | ReturnType<typeof createToolAuditLog>
        | undefined)?.flushShadowWrites({ close: true }) ?? Promise.resolve(),
      (chatSessionStore() as ChatSessionStore | undefined)
        ?.flush() ?? Promise.resolve(),
      (conversationDisclosureMaterializer() as
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
    runAgentTask: taskRuns.runAgentTask,
    runAgentTaskStreaming: taskRuns.runAgentTaskStreaming,
    openAgentRunSession: taskRuns.openAgentRunSession,
    resumeAgentRun: taskRuns.resumeAgentRun,
    pauseAgentRun: taskRuns.pauseAgentRun,
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






export type AppContainerOptions = {
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
};