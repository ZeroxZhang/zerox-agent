import { app, BrowserWindow, safeStorage } from "electron";
import { createHash, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createAgentExecutionStore } from "./agentExecutionStore";
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
import { createAgentGoalStore } from "./agentGoalStore";
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
} from "./memoryStore";
import { createMemoryProfileStore } from "./memoryProfileStore";
import { createHistoryIndexStore } from "./historyIndexStore";
import { createMemoryIngestionService } from "./memoryIngestionService";
import {
  createToolResultOffloadStore,
  type ToolResultOffloadReadScope,
} from "./toolResultOffloadStore";
import {
  createOpenAiCompatibleClient,
  createOpenAiCompatibleEmbeddingClient,
} from "./openAiCompatibleClient";
import {
  discoverSkills,
  collectSkillMcpConfigs,
  shouldAutoInitializeSkillMcp,
} from "./skillRegistry";
import { createMcpClient } from "./mcpClient";
import { resolveTransportKind } from "./mcpTransport";
import { createMcpTransportClient } from "./mcpTransportClient";
import { createMaxMode } from "./providers/maxMode";
import { createScheduledTaskStore } from "./taskStore";
import { createTaskSchedulerService } from "./taskSchedulerService";
import { createToolAuditLog } from "./toolAuditLog";
import { KernelEventBus } from "./kernel/eventBus";
import { createProductionKernelDriver } from "./kernel/productionKernelDriver";
import { createToolRuntime } from "./toolRuntime";
import { registerReadCodeTool } from "./readCodeTool";
import { createStorageImpl } from "./storage/storageDb";
import { resolveStorageBackend } from "./storage/backendResolver";
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
import type { Storage } from "../shared/storageContract";
import {
  createToolAuthorizationService,
  type ToolUserApprovalResult,
  type ToolUserApprovalRequest,
} from "./toolAuthorizationService";
import { getAppMeta } from "../shared/appMeta";
import { getNavigationSections } from "../shared/navigation";
import {
  projectGoalStatusForInteraction,
  upgradeGoalAcceptanceProtocol,
  type Goal,
  type GoalBudget,
  type SuccessCriterion,
} from "../shared/agentGoal";
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
  GoalProgressEvent,
} from "../shared/chat";
import {
  getActiveGoalSummary,
  getRecoveryGoalSummary,
  isLiveGoalStatus,
} from "../shared/chatSessionWork";
import { projectChatSessionTokenUsage } from "./chatSessionUsage";
import type {
  AgentRunEvent,
  AgentRunRecord,
  AgentRunStatus,
  CancelScheduledTaskRunResult,
  OpenAgentRunSessionResult,
  PauseAgentRunResult,
  RunScheduledTaskResult,
} from "../shared/agentRuns";
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
  isSafeToolResultRef,
  summarizeToolResultContent,
  type ReadToolResultRefResult,
} from "../shared/toolResultRefs";
import { projectChatSessionForTranscript } from "../shared/chatSessionProjection";
import type { PermissionRule } from "../shared/kernelContract";

export type AppContainer = ReturnType<typeof createAppContainer>;

export type AgentRunsChangedEvent = {
  reason: "active_execution_changed" | "run_updated";
  runId?: string;
  taskId?: string;
  createdAt: string;
};

function acceptanceContextNeedsModel(
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

function formatGoalTerminalReason(goal: Goal, eventMessage: string): string {
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

function collectGoalResultSummaries(goal: Goal): string[] {
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
    options?: { signal?: AbortSignal },
  ) => Promise<ToolUserApprovalResult>;
  setGoalActive?: (goalId: string, active: boolean) => void;
  acceptanceValidators?: AcceptanceValidator[];
}) {
  const configDir = path.join(app.getPath("userData"), "config");
  const skillsDir = path.join(app.getAppPath(), "skills");
  const appMeta = getAppMeta();

  // P1 SQLite storage. The Storage singleton is created lazily and is
  // fault-tolerant: if better-sqlite3 fails to load (e.g. an Electron ABI
  // mismatch before @electron/rebuild runs), the container falls back to the
  // `json` backend so the app still starts. Stores that have been converted to
  // dual-write proxies (agentRunStore, agentTrajectoryStore) consume this.
  let storageBackendCache: "json" | "sqlite" | "dual" | null = null;
  function storageBackend(): "json" | "sqlite" | "dual" {
    if (storageBackendCache) return storageBackendCache;
    const resolved = resolveStorageBackend();
    if (resolved !== "json") {
      const opened = storage(); // ensure the native module loads + migrates
      if (!opened) {
        // eslint-disable-next-line no-console
        console.warn(
          "[storage] SQLite backend unavailable; falling back to json.",
        );
        storageBackendCache = "json";
        return "json";
      }
    }
    storageBackendCache = resolved;
    return resolved;
  }

  function storage(): Storage | null {
    return lazy<Storage | null>("storage", () => {
      try {
        // createStorageImpl runs migrations synchronously at construction, so
        // the schema is ready before any store write.
        return createStorageImpl({ dbPath: path.join(configDir, "zerox.db") });
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn(
          `[storage] could not open SQLite (${String(error)}); continuing on JSON.`,
        );
        return null;
      }
    });
  }

  function activeSqliteStorage(): Storage | null {
    return storageBackend() === "json" ? null : storage();
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
    await syncGoalProgressToChatSession(canonicalEvent).catch(() => undefined);

    const latestEvent = await reconcileGoalProgressEventFromStore(canonicalEvent);
    if (
      latestEvent.status !== canonicalEvent.status ||
      latestEvent.event !== canonicalEvent.event ||
      latestEvent.message !== canonicalEvent.message
    ) {
      canonicalEvent = latestEvent;
      await syncGoalProgressToChatSession(canonicalEvent).catch(() => undefined);
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

  async function syncGoalProgressToChatSession(event: GoalProgressEvent) {
    if (!event.sessionId) {
      return;
    }

    const goal = await agentGoalStore().get(event.goalId);
    if (!goal) {
      return;
    }

    const reconciledEvent = reconcileIrreversibleGoalProgressEvent(event, goal);
    const syncedGoal =
      goal.status === reconciledEvent.status
        ? goal
        : { ...goal, status: reconciledEvent.status };
    await attachGoalSummaryIfChanged(
      reconciledEvent.sessionId!,
      toChatGoalSummary(syncedGoal),
    );
    await appendGoalTerminalMessageIfNeeded(
      reconciledEvent.sessionId!,
      syncedGoal,
      reconciledEvent,
    );
  }

  async function attachGoalSummaryIfChanged(
    sessionId: string,
    summary: ChatSessionGoalSummary,
  ): Promise<boolean> {
    const session = await chatSessionStore().get(sessionId);
    if (!session) {
      return false;
    }

    const existingSummary = session.goalSummaries?.find(
      (candidate) => candidate.id === summary.id,
    );
    if (
      existingSummary?.description === summary.description &&
      existingSummary.status === summary.status &&
      Boolean(existingSummary.updatedAt)
    ) {
      await clearActiveChatGoalIfTerminal(sessionId, summary);
      return false;
    }

    await chatSessionStore().attachGoal(sessionId, summary);
    await clearActiveChatGoalIfTerminal(sessionId, summary);
    return true;
  }

  async function clearActiveChatGoalIfTerminal(
    sessionId: string,
    summary: ChatSessionGoalSummary,
  ) {
    if (shouldClearActiveChatGoal(summary.status)) {
      await chatSessionStore().clearActiveGoal(sessionId, summary.id);
    }
  }

  async function appendGoalTerminalMessageIfNeeded(
    sessionId: string,
    goal: Goal,
    event: GoalProgressEvent,
  ) {
    if (!isTerminalGoalStatus(goal.status)) {
      return;
    }

    const goalEventRef = `goal-terminal:${goal.id}:${goal.status}`;
    const session = await chatSessionStore().get(sessionId);
    if (!session) {
      return;
    }
    if (
      session.messages.some((message) => message.goalEventRef === goalEventRef)
    ) {
      return;
    }

    await chatSessionStore().appendMessage({
      sessionId,
      role: "assistant",
      content: formatGoalTerminalMessage(goal, event.message),
      goalId: goal.id,
      goalEventRef,
    });
  }

  function toChatGoalSummary(goal: Goal): ChatSessionGoalSummary {
    return {
      id: goal.id,
      description: goal.description,
      status: projectGoalStatusForInteraction(goal),
      updatedAt: goal.updatedAt,
    };
  }

  function shouldClearActiveChatGoal(status: Goal["status"]): boolean {
    return !isLiveGoalStatus(status);
  }

  async function reconcileChatSessionGoalSummary(
    sessionId: string,
    activeGoal: ChatSessionGoalSummary | undefined,
  ): Promise<ChatSessionGoalSummary | undefined> {
    if (!activeGoal) {
      return undefined;
    }

    const goal = await agentGoalStore().get(activeGoal.id);
    if (!goal) {
      return activeGoal;
    }

    const summary = toChatGoalSummary(goal);
    await attachGoalSummaryIfChanged(sessionId, summary);
    return isLiveGoalStatus(summary.status) ? summary : undefined;
  }

  async function listChatSessions(): Promise<ChatSessionListItem[]> {
    const sessions = await chatSessionStore().list();
    await Promise.all(
      sessions.map(async (session) => {
        const record = await chatSessionStore().get(session.id);
        if (!record) return;
        const activeGoal = getActiveGoalSummary(record);
        const recoveryGoal = getRecoveryGoalSummary(record);
        if (activeGoal) {
          await reconcileChatSessionGoalSummary(session.id, activeGoal);
        }
        if (recoveryGoal && recoveryGoal.id !== activeGoal?.id) {
          await reconcileChatSessionGoalSummary(session.id, recoveryGoal);
        }
      }),
    );
    return Promise.all(
      (await chatSessionStore().list()).map(enrichChatSessionListItemUsage),
    );
  }

  async function enrichChatSessionListItemUsage(
    session: ChatSessionListItem,
  ): Promise<ChatSessionListItem> {
    const record = await chatSessionStore().get(session.id);
    if (!record) return session;
    const [plans, goals] = await Promise.all([
      planStore().listBySession(session.id),
      Promise.all(
        (record.goalIds ?? []).map((goalId) => agentGoalStore().get(goalId)),
      ),
    ]);
    const tokenUsage = projectChatSessionTokenUsage({
      chatUsage: record.tokenUsage,
      plans,
      goals: goals.filter((goal): goal is Goal => Boolean(goal)),
    });
    return {
      ...session,
      ...(tokenUsage ? { tokenUsage } : {}),
    };
  }

  async function getChatSession(
    sessionId: string,
  ): Promise<ChatSessionRecord | null> {
    const session = await chatSessionStore().get(sessionId);
    if (!session) return null;
    const activeGoal = getActiveGoalSummary(session);
    const recoveryGoal = getRecoveryGoalSummary(session);
    if (activeGoal) {
      await reconcileChatSessionGoalSummary(session.id, activeGoal);
    }
    if (recoveryGoal && recoveryGoal.id !== activeGoal?.id) {
      await reconcileChatSessionGoalSummary(session.id, recoveryGoal);
    }

    const repairedSession = await chatSessionStore().get(sessionId);
    if (!repairedSession) return repairedSession;
    const [plans, goals] = await Promise.all([
      planStore().listBySession(sessionId),
      Promise.all(
        (repairedSession.goalIds ?? []).map((goalId) =>
          agentGoalStore().get(goalId),
        ),
      ),
    ]);
    const tokenUsage = projectChatSessionTokenUsage({
      chatUsage: repairedSession.tokenUsage,
      plans,
      goals: goals.filter((goal): goal is Goal => Boolean(goal)),
    });
    return projectChatSessionForTranscript({
      ...repairedSession,
      ...(tokenUsage ? { tokenUsage } : {}),
    });
  }

  async function archiveChatSession(
    sessionId: string,
  ): Promise<ChatSessionOperationResult> {
    try {
      const session = await chatSessionStore().archive(sessionId);
      if (!session) {
        return { ok: false, message: "会话不存在，无法归档。" };
      }

      return { ok: true, session };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "无法归档会话。",
      };
    }
  }

  async function restoreChatSession(
    sessionId: string,
  ): Promise<ChatSessionOperationResult> {
    try {
      const session = await chatSessionStore().restore(sessionId);
      if (!session) {
        return { ok: false, message: "会话不存在，无法恢复。" };
      }

      return { ok: true, session };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "无法恢复会话。",
      };
    }
  }

  async function renameChatSession(
    sessionId: string,
    title: string,
  ): Promise<ChatSessionOperationResult> {
    try {
      const session = await chatSessionStore().rename(sessionId, title);
      if (!session) {
        return {
          ok: false,
          message: "会话不存在。",
        };
      }
      return { ok: true, session };
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error ? error.message : "无法重命名会话。",
      };
    }
  }

  async function deleteChatSession(
    sessionId: string,
  ): Promise<ChatSessionOperationResult> {
    try {
      const deleted = await chatSessionStore().delete(sessionId);
      if (!deleted) {
        return { ok: false, message: "会话不存在，无法删除。" };
      }

      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "无法删除会话。",
      };
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
        discoverSkills: () => discoverSkills({ skillsDir }),
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
      }),
    );
  }

  function kernelEventBus() {
    return lazy("kernelEventBus", () => new KernelEventBus());
  }

  function productionKernelDriver() {
    if (
      readFeatureFlags().ZEROX_PRODUCTION_KERNEL === "off"
    ) {
      return undefined;
    }
    return lazy("productionKernelDriver", () =>
      createProductionKernelDriver({
        bus: kernelEventBus(),
      }),
    );
  }

  function chatProductionKernelDriver() {
    return readFeatureFlags().ZEROX_PRODUCTION_KERNEL === "scheduled_chat"
      ? productionKernelDriver()
      : undefined;
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
    return lazy("agentExecutionStore", () => createAgentExecutionStore({ configDir }));
  }

  function agentTrajectoryStore() {
    return lazy("agentTrajectoryStore", () =>
      createAgentTrajectoryStore({ configDir, backend: storageBackend(), storage: activeSqliteStorage() ?? undefined }),
    );
  }

  function agentGoalStore() {
    return lazy("agentGoalStore", () => createAgentGoalStore({ configDir }));
  }

  function agentWorkspaceStore() {
    return lazy("agentWorkspaceStore", () => createAgentWorkspaceStore({ configDir }));
  }

  function workspaceRunStore() {
    return lazy("workspaceRunStore", () => createWorkspaceRunStore({ configDir }));
  }

  function agentWorkspaceService() {
    return lazy("agentWorkspaceService", () =>
      createAgentWorkspaceService({
        workspaceStore: agentWorkspaceStore(),
        workspaceRoot: path.join(app.getPath("userData"), "workspaces"),
      }),
    );
  }

  async function requestGitWorktreeAgentWorkspace(
    input: CreateGitWorktreeWorkspaceInput,
  ) {
    const approval = await options.requestToolApproval({
      taskId: "agent_workspaces",
      taskName: "Create Git worktree workspace",
      request: {
        toolName: "git_worktree_add",
        args: {
          name: input.name,
          repositoryRoot: input.repositoryRoot,
          branch: input.branch,
        },
      },
      deniedReason:
        "Creating a Git worktree runs git worktree add against a renderer-provided repository path.",
    });

    if (!approval.approved) {
      throw new Error(approval.reason ?? "Git worktree creation was not approved.");
    }

    return agentWorkspaceService().createGitWorktreeWorkspace({
      name: input.name,
      repositoryRoot: input.repositoryRoot,
      branch: input.branch,
      approval: approval.automatic
        ? {
            kind: "session_auto_approval",
            approvedAt: new Date().toISOString(),
          }
        : {
            kind: "explicit_user_approval",
            approvedAt: new Date().toISOString(),
            approvedBy: "user",
          },
    });
  }

  function multiAgentSessionStore() {
    return lazy("multiAgentSessionStore", () => createMultiAgentSessionStore({ configDir }));
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
          discoverSkills: () => discoverSkills({ skillsDir }),
        }),
        discoverSkills: () => discoverSkills({ skillsDir }),
        availableToolNames: () =>
          createToolExecutor()
            .getRegistry()
            .getDefinitions()
            .map((definition) => definition.function.name),
        availableAcceptanceKinds: () =>
          agentGoalValidatorRegistry().listKinds(),
        enableDirectReview: true,
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
    return lazy("agentLearningStore", () => createAgentLearningStore({ configDir }));
  }

  function agentEvalCandidateStore() {
    return lazy("agentEvalCandidateStore", () => createAgentEvalCandidateStore({ configDir }));
  }

  function promotedAgentEvalFixtureStore() {
    return lazy("promotedAgentEvalFixtureStore", () =>
      createPromotedAgentEvalFixtureStore({ configDir }),
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
    return toRuntimeModelProfile(await resolveGoalModelSettings(goal));
  }

  function goalChatClient(goal: Goal) {
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
        discoverSkills: () => discoverSkills({ skillsDir }),
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
          const result = await discoverSkills({ skillsDir });
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
            trajectoryStore: agentTrajectoryStore(),
            createId: () => `goal_context_${randomUUID()}`,
            now: () => new Date().toISOString(),
          }),
          createId: () => `goal_run_${randomUUID()}`,
          nextSequence: nextGoalTrajectorySequence,
          now: () => new Date().toISOString(),
          onProgress: emitGoalProgressEvent,
          maxMode: {
            async runStep(req, opts) {
              const provider = await getProvider();
              return createMaxMode(provider).runStep(req, opts);
            },
          },
          getMaxMode: async (goal) =>
            createMaxMode(await getGoalProvider(goal)),
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
            trajectoryStore: agentTrajectoryStore(),
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
        proposeGoalAmendment: proposeGoalObjectiveAmendment,
        runtimeReplanGoal: createRuntimeGoalPlan,
        taskStore: scheduledTaskStore(),
        runScheduledTask: (taskId: string, taskRunOptions) =>
          runAgentTask(taskId, {
            ...taskRunOptions,
            writeChatTranscript: false,
          }),
        discoverSkills: () => discoverSkills({ skillsDir }),
        workspaceService: agentWorkspaceService(),
        toolExecutor: createToolExecutor(),
        toolAuthorizationService: toolAuthorizationService(),
        trajectoryStore: agentTrajectoryStore(),
        workspaceRunStore: workspaceRunStore(),
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

  let mcpInitialized = false;
  let runtimeShuttingDown = false;
  let mcpInitializationPromise: Promise<void> | null = null;
  const activeMcpClients: Awaited<ReturnType<typeof createMcpClient>>[] = [];
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

  async function initializeMcpTools(
    toolExecutor: ReturnType<typeof createAgentToolExecutor>,
  ): Promise<void> {
    if (mcpInitialized || runtimeShuttingDown) return;
    mcpInitialized = true;

    try {
      const mcpConfigs = await collectSkillMcpConfigs({ skillsDir });

      for (const config of mcpConfigs) {
        if (runtimeShuttingDown) break;
        try {
          // P8: resolve the MCP transport kind (default stdio for backward
          // compat). http/sse configs route through the transport-backed
          // McpClient; stdio keeps the existing process-based mcpClient.
          const transportKind = resolveTransportKind(
            (config as { transport?: string }).transport,
          );
          const stdioSandboxRoot =
            transportKind === "stdio"
              ? path.join(
                  configDir,
                  "mcp-process-sandbox",
                  createHash("sha256")
                    .update(
                      JSON.stringify([
                        config.sourceSkill,
                        config.name,
                        config.command,
                        config.args ?? [],
                      ]),
                    )
                    .digest("hex")
                    .slice(0, 24),
                )
              : null;
          if (stdioSandboxRoot) {
            await mkdir(stdioSandboxRoot, { recursive: true });
          }
          const client =
            transportKind === "stdio"
              ? createMcpClient({
                  name: config.name,
                  transport: "stdio",
                  command: config.command,
                  args: config.args,
                  env: config.env,
                  processSandbox: processSandboxProvider(),
                  sandboxPolicy: {
                    mode: "workspace_write",
                    workspaceRoot: stdioSandboxRoot!,
                    network: "allow",
                  },
                })
              : createMcpTransportClient({
                  name: config.name,
                  transport: transportKind,
                  url: (config as { url?: string }).url,
                  headers: (config as { headers?: Record<string, string> }).headers,
                });

          activeMcpClients.push(client);
          await client.connect();
          if (runtimeShuttingDown) {
            await client.disconnect();
            continue;
          }

          const mcpTools = await client.listTools();
          for (const tool of mcpTools) {
            try {
              toolExecutor.getRegistry().register(
                tool,
                async (args, executionOptions) => {
                  const result = await client.callTool(
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

          console.log(
            `MCP server "${config.name}" initialized with ${mcpTools.length} tools (from skill: ${config.sourceSkill})`,
          );
        } catch (error) {
          console.error(
            `Failed to initialize MCP server "${config.name}": ${
              error instanceof Error ? error.message : "Unknown error"
            }`,
          );
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

  type RunAgentTaskOptions = {
    sessionId?: string;
    writeChatTranscript?: boolean;
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
    const completion = new Promise<void>((resolve) => {
      settleCompletion = resolve;
    });
    activeTaskRunControllers.set(taskId, controller);
    activeTaskRunCompletions.set(taskId, completion);
    emitAgentRunsChanged({ reason: "active_execution_changed", taskId });

    try {
      for await (const event of agentRunnerService().runTaskStreaming(taskId, {
        signal: controller.signal,
      })) {
        yield event;
      }
    } finally {
      if (!controller.signal.aborted) {
        controller.abort("stream_consumer_detached");
      }
      executionReservations.delete(reservation);
      if (activeTaskRunControllers.get(taskId) === controller) {
        activeTaskRunControllers.delete(taskId);
      }
      settleCompletion?.();
      if (activeTaskRunCompletions.get(taskId) === completion) {
        activeTaskRunCompletions.delete(taskId);
      }
      emitAgentRunsChanged({ reason: "active_execution_changed", taskId });
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
    const completion = new Promise<void>((resolve) => {
      settleCompletion = resolve;
    });
    activeTaskRunControllers.set(taskId, controller);
    activeTaskRunCompletions.set(taskId, completion);
    emitAgentRunsChanged({ reason: "active_execution_changed", taskId });

    try {
      const result = await agentRunnerService().runTask(taskId, {
        signal: controller.signal,
        ...(sessionId ? { sessionId } : {}),
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
      if (activeTaskRunControllers.get(taskId) === controller) {
        activeTaskRunControllers.delete(taskId);
      }
      settleCompletion?.();
      if (activeTaskRunCompletions.get(taskId) === completion) {
        activeTaskRunCompletions.delete(taskId);
      }
      emitAgentRunsChanged({ reason: "active_execution_changed", taskId });
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
    const completion = new Promise<void>((resolve) => {
      settleCompletion = resolve;
    });
    activeTaskRunControllers.set(checkpoint.taskId, controller);
    activeTaskRunCompletions.set(checkpoint.taskId, completion);
    emitAgentRunsChanged({
      reason: "active_execution_changed",
      runId,
      taskId: checkpoint.taskId,
    });

    try {
      const result = await agentRunnerService().resumeRun(runId, {
        signal: controller.signal,
      });
      emitAgentRunsChanged({
        reason: "run_updated",
        runId: result.ok ? result.run.id : runId,
        taskId: checkpoint.taskId,
      });
      return result;
    } finally {
      if (activeTaskRunControllers.get(checkpoint.taskId) === controller) {
        activeTaskRunControllers.delete(checkpoint.taskId);
      }
      settleCompletion?.();
      if (activeTaskRunCompletions.get(checkpoint.taskId) === completion) {
        activeTaskRunCompletions.delete(checkpoint.taskId);
      }
      emitAgentRunsChanged({
        reason: "active_execution_changed",
        runId,
        taskId: checkpoint.taskId,
      });
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
    return trackRuntimeInvocation(() => confirmGoalDraftAccepted(draftId, edit));
  }

  async function confirmPlan(
    input: ConfirmPlanInput,
  ): Promise<ConfirmPlanResult> {
    if (runtimeShuttingDown) {
      return { ok: false, message: "应用正在退出，未启动计划执行。" };
    }
    return trackRuntimeInvocation(async () => {
      const result = await serializePlanConfirmation<ConfirmPlanResult>(input.planId, async () => {
      let plan = await planStore().get(input.planId);
      if (!plan) {
        return { ok: false, message: "计划不存在。" };
      }
      if (plan.executionGoalId) {
        const existingGoal = await agentGoalStore().get(plan.executionGoalId);
        if (!existingGoal) {
          return { ok: false, message: "计划引用的执行目标不存在。", plan };
        }
        if (plan.status === "confirmed_pending_execution") {
          const resumedGoal = await goalChatService().resume(existingGoal.id);
          const latestPlan = (await planStore().get(plan.id)) ?? plan;
          if (latestPlan.status === "confirmed_pending_execution") {
            const nextStatus = planStatusForExecutionGoal(resumedGoal.status);
            plan = await planStore().save(
              {
                ...latestPlan,
                status: nextStatus,
              },
              latestPlan.revision,
              nextStatus === "executing"
                ? "plan_execution_started"
                : "plan_execution_finished",
              { goalId: resumedGoal.id, status: nextStatus },
            );
          } else {
            plan = latestPlan;
          }
          await attachConfirmedPlanGoal(plan, resumedGoal);
          return { ok: true, plan, activeGoal: resumedGoal };
        }
        if (plan.status === "executing") {
          const nextStatus = planStatusForExecutionGoal(existingGoal.status);
          if (nextStatus !== plan.status) {
            plan = await planStore().save(
              {
                ...plan,
                status: nextStatus,
              },
              plan.revision,
              "plan_execution_finished",
              { goalId: existingGoal.id, status: nextStatus },
            );
          }
        }
        return {
          ok: true,
          plan,
          activeGoal: {
            id: existingGoal.id,
            description: existingGoal.description,
            status: existingGoal.status,
          },
        };
      }
      const recovering =
        plan.status === "confirmed_pending_execution" &&
        !plan.executionGoalId;
      if (!recovering && plan.revision !== input.expectedRevision) {
        return { ok: false, message: "计划版本已变化，请刷新后重试。", plan };
      }
      if (!recovering && !isPlanConfirmable(plan)) {
        return {
          ok: false,
          message: "只有通过门禁且状态为 Ready 的计划可以确认。",
          plan,
        };
      }
      if (!plan.finalArtifact || !plan.projection) {
        return { ok: false, message: "计划终版或投影不存在。", plan };
      }
      const artifact = plan.finalArtifact;
      const projection = plan.projection;
      const confirmedCriterionBindings =
        plan.criterionBindings?.length || !plan.goalContractSnapshot
          ? plan.criterionBindings ?? []
          : derivePlanCriterionBindings(artifact, plan.goalContractSnapshot);
      const confirmedPlanRevision = plan.confirmedRevision ?? plan.revision;
      if (!(await planArtifactWriter().verify(plan))) {
        return {
          ok: false,
          message: "计划 Markdown 投影已变化，请重新生成后确认。",
          plan,
        };
      }
      const evidenceVerification = await verifyPlanEvidence(plan);
      if (!evidenceVerification.ok) {
        return {
          ok: false,
          message: `工作区证据已漂移（${evidenceVerification.driftedEvidenceIds.join(
            "、",
          )}），请重新规划后再确认。`,
          plan,
        };
      }
      if ((plan.schemaVersion ?? 1) >= 2) {
        if (!plan.taskProfile || !plan.planningBrief || !plan.qualityReport) {
          return {
            ok: false,
            message: "v2 计划缺少任务画像、调查摘要或质量报告，请重新规划。",
            plan,
          };
        }
        const completedStageKinds = new Set(
          (plan.planningStages ?? [])
            .filter((stage) => stage.status === "completed")
            .map((stage) => stage.kind),
        );
        const requiredStageKinds: PlanningStageKind[] = [
          "triage",
          "investigation",
          "skill_route",
          "contract",
          "generation",
        ];
        if (plan.mode === "direct") requiredStageKinds.push("review");
        requiredStageKinds.push("quality");
        const missingStageKinds = requiredStageKinds.filter(
          (kind) => !completedStageKinds.has(kind),
        );
        if (missingStageKinds.length > 0) {
          return {
            ok: false,
            message: `v2 计划缺少已完成阶段：${missingStageKinds.join("、")}。`,
            plan,
          };
        }
        const completedReviewStage = [...(plan.planningStages ?? [])]
          .reverse()
          .find(
            (stage) =>
              stage.kind === "review" &&
              stage.status === "completed",
          );
        if (
          plan.mode === "direct" &&
          typeof completedReviewStage?.reviewApproved !== "boolean"
        ) {
          return {
            ok: false,
            message: "v2 Direct 计划缺少独立审查结论，请重新规划。",
            plan,
          };
        }
        const refreshedQuality = createPlanQualityReport({
          artifact,
          profile: plan.taskProfile,
          brief: plan.planningBrief,
          evidence: plan.evidence,
          skillDecision: plan.skillDecision,
          workspaceRoot: plan.workspaceRoot,
          availableToolNames: [
            ...createToolExecutor()
              .getRegistry()
              .getDefinitions()
              .map((definition) => definition.function.name),
            ...(plan.selectedSkill?.manifest.tools?.map(
              (tool) => tool.name,
            ) ?? []),
          ],
          reviewApproved: completedReviewStage?.reviewApproved,
          reviewIssues: completedReviewStage?.reviewIssues,
          goalContractSnapshot: plan.goalContractSnapshot,
          goalContractRef: plan.goalContractRef,
          criterionBindings: confirmedCriterionBindings,
          goalContractIssues: plan.goalContractIssues,
          availableAcceptanceKinds:
            agentGoalValidatorRegistry().listKinds(),
          now: new Date().toISOString(),
        });
        if (refreshedQuality.status !== "ready") {
          return {
            ok: false,
            message: `计划质量门禁已失效：${refreshedQuality.blockingIssues
              .map((issue) => issue.message)
              .join(" ")}`,
            plan,
          };
        }
        if (
          plan.skillDecision?.selectedSkillName !==
          plan.selectedSkill?.manifest.name
        ) {
          return {
            ok: false,
            message: "计划中的 Skill 决策与绑定快照不一致，请重新规划。",
            plan,
          };
        }
        if (
          plan.selectedSkill &&
          !plan.skillDecision?.snapshotSha256
        ) {
          return {
            ok: false,
            message: "计划绑定的 Skill 缺少快照哈希，请重新规划。",
            plan,
          };
        }
        if (plan.selectedSkill && plan.skillDecision?.snapshotSha256) {
          const selectedSkillName = plan.selectedSkill.manifest.name;
          const currentSkill = (await discoverSkills({ skillsDir })).skills.find(
            (skill) => skill.manifest.name === selectedSkillName,
          );
          if (!currentSkill) {
            return {
              ok: false,
              message: "计划绑定的 Skill 已不存在，请重新规划后再确认。",
              plan,
            };
          }
          const currentSkillHash = createHash("sha256")
            .update(
              JSON.stringify(currentSkill.manifest) + currentSkill.body,
            )
            .digest("hex");
          if (currentSkillHash !== plan.skillDecision.snapshotSha256) {
            return {
              ok: false,
              message: "计划绑定的 Skill 快照已漂移，请重新规划后再确认。",
              plan,
            };
          }
          const inputResolution = resolveSkillInput({
            skill: plan.selectedSkill,
            values: plan.selectedSkillInputValues,
            runContext: plan.workspaceRoot
              ? {
                  workspaceId: plan.workspaceId ?? "planner-workspace",
                  workspaceRoot: plan.workspaceRoot,
                  runMode: "plan",
                  agentRole: "planner",
                  depth: 0,
                  sandbox: {
                    mode: "read_only",
                    network: "none",
                    shell: "disabled",
                    allowWorkspaceEscape: false,
                    extraReadRoots: [],
                    extraWriteRoots: [],
                  },
                }
              : undefined,
          });
          if (inputResolution.status !== "complete") {
            return {
              ok: false,
              message: "计划绑定的 Skill 输入缺失或已失效，请补充信息后重新规划。",
              plan,
            };
          }
        }
      }
      let milestoneGraph: ReturnType<typeof validatePlanMilestoneGraph>;
      try {
        milestoneGraph = validatePlanMilestoneGraph(artifact.milestones);
      } catch (error) {
        return {
          ok: false,
          message: `计划执行图无效：${
            error instanceof Error ? error.message : "无法验证里程碑依赖。"
          }`,
          plan,
        };
      }
      if (!recovering) {
        plan = await planStore().save(
          {
            ...plan,
            status: "confirmed_pending_execution",
            confirmedRevision: confirmedPlanRevision,
            confirmedAt: new Date().toISOString(),
          },
          plan.revision,
          "plan_confirmed",
        );
      }

      const goalId = `goal_from_${plan.id}`;
      const criteria = artifact.acceptanceCriteria.length
        ? artifact.acceptanceCriteria
        : [`完成计划目标：${artifact.objective}`];
      const goalSuccessCriteria = plan.goalContractSnapshot
        ? buildGoalSuccessCriteriaFromPlan({
            ...plan,
            criterionBindings: confirmedCriterionBindings,
          })
        : (plan.schemaVersion ?? 1) >= 2 && artifact.acceptanceChecks?.length
          ? artifact.acceptanceChecks.map((check, index) => ({
              id: `criterion_${index + 1}`,
              description: check.description,
              acceptanceChecks: [structuredClone(check)],
            }))
          : criteria.map((description, index) => ({
              id: `criterion_${index + 1}`,
              description,
              acceptanceChecks: [
                {
                  id: `criterion_${index + 1}_review`,
                  kind: "model_review" as const,
                  description: "根据执行轨迹和产物验证计划验收条件。",
                  params: {
                    condition: description,
                    evidenceRefs: ["artifact:goalEvidence"],
                  },
                  requiresEvidence: true,
                },
              ],
            }));
      const milestoneChecks = artifact.milestones.flatMap(
        (milestone) => milestone.acceptanceChecks ?? [],
      );
      const confirmedPlanSchemaVersion = plan.schemaVersion;
      const allPlanChecks = [
        ...goalSuccessCriteria.flatMap(
          (criterion) => criterion.acceptanceChecks,
        ),
        ...milestoneChecks,
      ];
      const deterministicCheckCount = allPlanChecks.filter(
        (check) => check.kind !== "model_review",
      ).length;
      const modelReviewCheckCount = allPlanChecks.filter(
        (check) => check.kind === "model_review",
      ).length;
      const draft: GoalDraft = {
        id: plan.id,
        sessionId: plan.sessionId,
        ...(plan.workspaceId ? { workspaceId: plan.workspaceId } : {}),
        sourceMessage: plan.sourceMessage,
        ...(plan.selectedSkill
          ? { selectedSkill: structuredClone(plan.selectedSkill) }
          : {}),
        ...((plan.schemaVersion ?? 1) >= 2
          ? plan.selectedSkillInputValues &&
            Object.keys(plan.selectedSkillInputValues).length > 0
            ? {
                selectedSkillInputValues: structuredClone(
                  plan.selectedSkillInputValues,
                ),
              }
            : {}
          : defaultSelectedSkillInputValues(plan)),
        normalizedDescription:
          plan.goalContractSnapshot?.objective ?? artifact.objective,
        sourcePlanRef: {
          planId: plan.id,
          revision: confirmedPlanRevision,
          sha256: projection.sha256,
        },
        ...(plan.goalContractSnapshot && plan.goalContractRef
          ? {
              goalContractSnapshot: structuredClone(
                plan.goalContractSnapshot,
              ),
              goalContractRef: structuredClone(plan.goalContractRef),
              activePlanRef: {
                planId: plan.id,
                planRevision: confirmedPlanRevision,
                goalPlanVersion: plan.goalPlanVersion ?? 1,
                mode: plan.mode,
                purpose: plan.purpose ?? "initial",
                goalContractRef: structuredClone(plan.goalContractRef),
              },
              planHistory: [
                {
                  planId: plan.id,
                  planRevision: confirmedPlanRevision,
                  goalPlanVersion: plan.goalPlanVersion ?? 1,
                  mode: plan.mode,
                  purpose: plan.purpose ?? "initial",
                  goalContractRef: structuredClone(plan.goalContractRef),
                  trigger: structuredClone(
                    plan.trigger ?? {
                      kind: "initial_request" as const,
                      summary: "Initial confirmed plan.",
                      evidenceRefs: [],
                      at: plan.createdAt,
                    },
                  ),
                  outcome: "active" as const,
                  adoptedAt: new Date().toISOString(),
                },
              ],
            }
          : {}),
        ...(selectPlanExecutionModelBinding(plan)
          ? {
              executionModelBinding: structuredClone(
                selectPlanExecutionModelBinding(plan)!,
              ),
            }
          : {}),
        successCriteria: goalSuccessCriteria,
        acceptanceCoverage: {
          deterministicChecks: deterministicCheckCount,
          modelReviewChecks: modelReviewCheckCount,
          totalChecks: allPlanChecks.length,
          hasDeterministicCoverage: deterministicCheckCount > 0,
          hasModelReviewCoverage: modelReviewCheckCount > 0,
        },
        warnings: [],
        milestones: artifact.milestones.map((milestone) => ({
          id: milestone.id,
          description: `${milestone.title}：${milestone.description}`,
          state: milestoneGraph.rootIds.has(milestone.id) ? "ready" : "pending",
          successCriteria:
            (confirmedPlanSchemaVersion ?? 1) >= 2 &&
            milestone.acceptanceChecks?.length
              ? milestone.acceptanceChecks.map((check, criterionIndex) => ({
                  id: `${milestone.id}_criterion_${criterionIndex + 1}`,
                  description: check.description,
                  acceptanceChecks: [structuredClone(check)],
                }))
              : milestone.acceptanceCriteria.map(
                  (description, criterionIndex) => ({
                    id: `${milestone.id}_criterion_${criterionIndex + 1}`,
                    description,
                    acceptanceChecks: [
                      {
                        id: `${milestone.id}_criterion_${criterionIndex + 1}_review`,
                        kind: "model_review" as const,
                        description: "根据里程碑执行证据验证条件。",
                        params: {
                          condition: description,
                          evidenceRefs: ["artifact:goalEvidence"],
                        },
                        requiresEvidence: true,
                      },
                    ],
                  }),
                ),
          runIds: [],
          attempts: 0,
          dependsOn: milestoneGraph.dependenciesById.get(milestone.id) ?? [],
        })),
        status: "confirmed",
        createdAt: plan.createdAt,
        updatedAt: new Date().toISOString(),
      };
      const createdGoal = await goalChatService().createFromDraft({
        draft,
        goalId,
      });
      plan = await planStore().save(
        {
          ...plan,
          status: "confirmed_pending_execution",
          goalId: createdGoal.id,
          executionGoalId: createdGoal.id,
        },
        plan.revision,
        "plan_execution_goal_created",
        { goalId: createdGoal.id },
      );
      const activeGoal = await goalChatService().resume(createdGoal.id);
      const latestPlan = (await planStore().get(plan.id)) ?? plan;
      if (latestPlan.status === "confirmed_pending_execution") {
        const nextStatus = planStatusForExecutionGoal(activeGoal.status);
        plan = await planStore().save(
          {
            ...latestPlan,
            status: nextStatus,
          },
          latestPlan.revision,
          nextStatus === "executing"
            ? "plan_execution_started"
            : "plan_execution_finished",
          { goalId: activeGoal.id, status: nextStatus },
        );
      } else {
        plan = latestPlan;
      }
      await attachConfirmedPlanGoal(plan, activeGoal);
      return { ok: true, plan, activeGoal };
      });
      await goalProgressDeliveryQueue;
      return result;
    });
  }

  type RuntimeGoalPlanOptions = {
    amendmentId?: string;
    goalContractSnapshot?: GoalContractSnapshot;
    goalContractRef?: GoalContractRef;
  };

  function createRuntimeGoalPlan(
    goalId: string,
    instructions: string,
    runtimeOptions?: RuntimeGoalPlanOptions,
  ): Promise<CreateRuntimeGoalPlanResult> {
    return serializeGoalReplan(goalId, () =>
      createRuntimeGoalPlanAccepted(goalId, instructions, runtimeOptions),
    );
  }

  async function createRuntimeGoalPlanAccepted(
    goalId: string,
    instructions: string,
    runtimeOptions?: RuntimeGoalPlanOptions,
  ): Promise<CreateRuntimeGoalPlanResult> {
    if (runtimeShuttingDown) {
      return { ok: false, message: "应用正在退出，未创建运行期 Plan。" };
    }
    const requestedChange = instructions.trim();
    if (!requestedChange) {
      return { ok: false, message: "调整计划的说明不能为空。" };
    }
    try {
      let goal = await agentGoalStore().get(goalId);
      if (!goal) return { ok: false, message: "目标不存在。" };
      if (goal.status === "achieved" || goal.status === "canceled") {
        return { ok: false, message: `已 ${goal.status} 的目标不能调整计划。` };
      }
      if (!goal.goalContractSnapshot || !goal.goalContractRef) {
        return { ok: false, message: "目标缺少可验证的 GoalContract。" };
      }
      if (
        !runtimeOptions?.amendmentId &&
        (goal.pendingGoalAmendment?.status === "pending" ||
          goal.pendingGoalAmendment?.status === "approved")
      ) {
        return {
          ok: false,
          message: "Goal 存在待处理的目标修订，请先完成或撤销修订。",
        };
      }
      const canonicalGoalId = goal.id;
      const amendment = runtimeOptions?.amendmentId
        ? goal.pendingGoalAmendment
        : undefined;
      if (runtimeOptions?.amendmentId) {
        if (
          !amendment ||
          amendment.id !== runtimeOptions.amendmentId ||
          amendment.status !== "approved" ||
          amendment.baseContractRef.sha256 !== goal.goalContractRef.sha256 ||
          amendment.candidateContractRef.sha256 !==
            runtimeOptions.goalContractRef?.sha256 ||
          amendment.candidateContractRef.revision !==
            runtimeOptions.goalContractRef?.revision
        ) {
          return {
            ok: false,
            message: "目标修订状态已变化，不能基于过期契约生成 Plan。",
          };
        }
      }
      const currentGoalContractRef = structuredClone(goal.goalContractRef);
      const goalContractSnapshot = structuredClone(
        runtimeOptions?.goalContractSnapshot ?? goal.goalContractSnapshot,
      );
      const goalContractRef = structuredClone(
        runtimeOptions?.goalContractRef ?? goal.goalContractRef,
      );
      const parentPlanId =
        goal.activePlanRef?.planId ?? goal.sourcePlanRef?.planId;
      const parentPlan = parentPlanId
        ? await planStore().get(parentPlanId)
        : null;
      if (!parentPlan && goal.activePlanRef?.mode !== "legacy") {
        return { ok: false, message: "当前目标缺少可追溯的活动 Plan。" };
      }
      const inheritedProfileId = parentPlan
        ? selectRuntimeDirectProfileId(parentPlan, goal)
        : goal.executionModelBinding?.profileId;
      if (!inheritedProfileId) {
        return {
          ok: false,
          message: "无法解析运行期 Direct 综合模型；未静默切换其他模型。",
        };
      }
      if (goal.status === "executing") {
        const paused = await runGoalOperation(
          canonicalGoalId,
          () => goalChatService().pause(canonicalGoalId),
          { preempt: true },
        );
        if (!paused.ok) {
          return { ok: false, message: paused.message ?? "无法暂停当前目标。" };
        }
        goal = (await agentGoalStore().get(canonicalGoalId)) ?? goal;
      }
      const ledger = await agentGoalStore().readLedger(goal.id);
      let workspaceRoot = parentPlan?.workspaceRoot;
      if (!workspaceRoot) {
        try {
          workspaceRoot = (
            await agentWorkspaceService().resolveRunContext({
              workspaceId: goal.workspaceId,
              ...(goal.chatSessionId ? { sessionId: goal.chatSessionId } : {}),
            })
          ).workspaceRoot;
        } catch {
          workspaceRoot = undefined;
        }
      }
      const createdAt = new Date().toISOString();
      const feedbackEvidence = [
        {
          id: "evidence_goal_runtime_state",
          kind: "user" as const,
          title: "Current Goal runtime state",
          summary: JSON.stringify({
            status: goal.status,
            stopReason: goal.stopReason,
            planVersion: goal.planVersion,
            milestones: goal.milestones.map((milestone) => ({
              id: milestone.id,
              state: milestone.state,
              attempts: milestone.attempts,
              lastAcceptanceSummary: milestone.lastAcceptanceSummary,
            })),
          }).slice(0, 24_000),
          sha256: createHash("sha256")
            .update(JSON.stringify(goal.milestones))
            .digest("hex"),
        },
        {
          id: "evidence_goal_ledger",
          kind: "user" as const,
          title: "Recent Goal ledger",
          summary: JSON.stringify(ledger.slice(-40)).slice(0, 32_000),
          sha256: createHash("sha256")
            .update(JSON.stringify(ledger.slice(-40)))
            .digest("hex"),
        },
        {
          id: "evidence_parent_plan_outcome",
          kind: "user" as const,
          title: "Parent Plan outcome",
          summary: JSON.stringify({
            id: parentPlan?.id ?? goal.activePlanRef?.planId,
            mode: parentPlan?.mode ?? "legacy",
            status: parentPlan?.status ?? "legacy_compacted",
            qualityReport: parentPlan?.qualityReport,
            finalArtifact: parentPlan?.finalArtifact,
          }).slice(0, 32_000),
          sha256: createHash("sha256")
            .update(
              JSON.stringify({
                status: parentPlan?.status ?? "legacy_compacted",
                qualityReport: parentPlan?.qualityReport,
                finalArtifact: parentPlan?.finalArtifact,
              }),
            )
            .digest("hex"),
        },
      ];
      const parentPlanRef: GoalPlanRef = goal.activePlanRef
        ? structuredClone(goal.activePlanRef)
        : {
            planId: parentPlan!.id,
            planRevision: parentPlan!.revision,
            goalPlanVersion: goal.planVersion,
            mode: parentPlan!.mode,
            purpose: parentPlan!.purpose ?? "initial",
            goalContractRef: currentGoalContractRef,
          };
      const existingCandidate = (await planStore().listBySession(
        goal.chatSessionId ?? parentPlan?.sessionId ?? goal.id,
      )).find(
        (candidate) =>
          candidate.purpose === "runtime_replan" &&
          candidate.goalId === goal.id &&
          candidate.parentPlanRef?.planId === parentPlanRef.planId &&
          candidate.goalPlanVersion === goal.planVersion + 1 &&
          candidate.goalContractRef?.sha256 === goalContractRef.sha256 &&
          candidate.trigger?.summary === requestedChange &&
          candidate.status !== "discarded" &&
          candidate.status !== "superseded",
      );
      if (existingCandidate) {
        await recordGoalPlanCandidate(
          existingCandidate,
          runtimeOptions?.amendmentId,
        );
        return {
          ok: true,
          plan: existingCandidate,
          message: "已存在同一契约和反馈生成的运行期 Direct Plan。",
        };
      }
      const plan = await planDebateOrchestrator().createPlan({
        sessionId: goal.chatSessionId ?? parentPlan?.sessionId ?? goal.id,
        ...(goal.workspaceId ? { workspaceId: goal.workspaceId } : {}),
        ...(workspaceRoot ? { workspaceRoot } : {}),
        sourceMessage: `调整当前 Goal 的执行路径：${requestedChange}`,
        mode: "direct",
        autonomyMode: parentPlan?.autonomyMode,
        modelAssignments: { direct: inheritedProfileId },
        purpose: "runtime_replan",
        goalId: goal.id,
        parentPlanRef,
        goalPlanVersion: goal.planVersion + 1,
        goalContractSnapshot,
        goalContractRef,
        trigger: {
          kind: amendment ? "goal_amendment" : "user_adjustment",
          summary: requestedChange,
          evidenceRefs: feedbackEvidence.map((item) => item.id),
          at: createdAt,
        },
        feedbackEvidence,
      });
      await recordGoalPlanCandidate(plan, runtimeOptions?.amendmentId);
      await agentGoalStore().appendLedger(goal.id, {
        at: createdAt,
        kind: "goal_replanned",
        summary: `Created runtime Direct Plan ${plan.id} v${plan.goalPlanVersion}.`,
      });
      return {
        ok: true,
        plan,
        message: "已生成运行期 Direct Plan，采用前不会覆盖当前 Goal。",
      };
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error ? error.message : "无法生成运行期 Direct Plan。",
      };
    }
  }

  function toGoalPlanHistoryEntry(
    plan: PlanRecord,
    outcome: GoalPlanHistoryEntry["outcome"],
  ): GoalPlanHistoryEntry {
    if (
      !plan.goalContractRef ||
      !plan.parentPlanRef ||
      !plan.goalPlanVersion ||
      !plan.trigger
    ) {
      throw new Error("运行期 Plan 缺少可记录的 Goal 谱系字段。");
    }
    return {
      planId: plan.id,
      planRevision: plan.revision,
      goalPlanVersion: plan.goalPlanVersion,
      mode: plan.mode,
      purpose: plan.purpose ?? "runtime_replan",
      goalContractRef: structuredClone(plan.goalContractRef),
      parentPlanRef: structuredClone(plan.parentPlanRef),
      trigger: structuredClone(plan.trigger),
      outcome,
    };
  }

  async function recordGoalPlanCandidate(
    plan: PlanRecord,
    amendmentId?: string,
  ): Promise<void> {
    if (!plan.goalId) return;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const goal = await agentGoalStore().get(plan.goalId);
      if (!goal || goal.status === "achieved" || goal.status === "canceled") {
        return;
      }
      const entry = toGoalPlanHistoryEntry(plan, "candidate");
      const existingIndex = (goal.planHistory ?? []).findIndex(
        (candidate) => candidate.planId === plan.id,
      );
      const planHistory = [...(goal.planHistory ?? [])];
      if (existingIndex >= 0) {
        planHistory[existingIndex] = {
          ...planHistory[existingIndex]!,
          ...entry,
          outcome:
            planHistory[existingIndex]!.outcome === "active"
              ? "active"
              : "candidate",
        };
      } else {
        planHistory.push(entry);
      }
      const pendingGoalAmendment =
        amendmentId &&
        goal.pendingGoalAmendment?.id === amendmentId &&
        goal.pendingGoalAmendment.status === "approved"
          ? {
              ...goal.pendingGoalAmendment,
              candidatePlanId: plan.id,
            }
          : goal.pendingGoalAmendment;
      const saved = await agentGoalStore().saveIfPlanVersion(
        {
          ...goal,
          planHistory,
          ...(pendingGoalAmendment ? { pendingGoalAmendment } : {}),
          updatedAt: new Date().toISOString(),
        },
        goal.planVersion,
        goal.activePlanRef?.planId,
      );
      if (saved.saved) return;
    }
    throw new Error("Goal 状态持续变化，未能记录运行期 Plan 候选谱系。");
  }

  async function recordGoalPlanRejected(plan: PlanRecord): Promise<void> {
    if (!plan.goalId) return;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const goal = await agentGoalStore().get(plan.goalId);
      if (!goal || goal.activePlanRef?.planId === plan.id) return;
      const rejectedEntry = toGoalPlanHistoryEntry(plan, "rejected");
      const existingIndex = (goal.planHistory ?? []).findIndex(
        (candidate) => candidate.planId === plan.id,
      );
      const planHistory = [...(goal.planHistory ?? [])];
      if (existingIndex >= 0) {
        planHistory[existingIndex] = {
          ...planHistory[existingIndex]!,
          ...rejectedEntry,
          outcome: "rejected",
        };
      } else {
        planHistory.push(rejectedEntry);
      }
      let pendingGoalAmendment = goal.pendingGoalAmendment;
      if (
        pendingGoalAmendment?.status === "approved" &&
        pendingGoalAmendment.candidatePlanId === plan.id
      ) {
        const amendmentWithoutCandidate = structuredClone(
          pendingGoalAmendment,
        );
        delete amendmentWithoutCandidate.candidatePlanId;
        pendingGoalAmendment = amendmentWithoutCandidate;
      }
      const saved = await agentGoalStore().saveIfPlanVersion(
        {
          ...goal,
          planHistory,
          ...(pendingGoalAmendment ? { pendingGoalAmendment } : {}),
          updatedAt: new Date().toISOString(),
        },
        goal.planVersion,
        goal.activePlanRef?.planId,
      );
      if (saved.saved) return;
    }
  }

  async function discardPlan(planId: string, expectedRevision: number) {
    const result = await planDebateOrchestrator().discard(
      planId,
      expectedRevision,
    );
    if (result.ok && result.plan.purpose === "runtime_replan") {
      await recordGoalPlanRejected(result.plan);
    }
    return result;
  }

  function proposeGoalAmendment(
    input: ProposeGoalAmendmentInput,
  ): Promise<GoalAmendmentOperationResult> {
    return serializeGoalAmendment(input.goalId, () =>
      proposeGoalAmendmentAccepted(input),
    );
  }

  async function proposeGoalAmendmentAccepted(
    input: ProposeGoalAmendmentInput,
  ): Promise<GoalAmendmentOperationResult> {
    let goal = await agentGoalStore().get(input.goalId);
    if (!goal) return { ok: false, message: "目标不存在。" };
    if (goal.status === "achieved" || goal.status === "canceled") {
      return { ok: false, message: "终态 Goal 不允许修改。" };
    }
    if (
      goal.pendingGoalAmendment?.status === "pending" ||
      goal.pendingGoalAmendment?.status === "approved"
    ) {
      return {
        ok: false,
        message: "当前 Goal 已有待处理的修订提案，请先批准、拒绝或撤销该提案。",
      };
    }
    if (!goal.goalContractRef || !isGoalContractSnapshot(input.candidateContract)) {
      return { ok: false, message: "候选 GoalContract 非法。" };
    }
    if (
      input.candidateContract.id !== goal.goalContractRef.id ||
      input.candidateContract.revision !== goal.goalContractRef.revision + 1
    ) {
      return { ok: false, message: "候选 GoalContract 必须基于当前契约递增一个 revision。" };
    }
    const pausedExecution = goal.status === "executing";
    if (pausedExecution) {
      const goalId = goal.id;
      const paused = await runGoalOperation(
        goalId,
        () => goalChatService().pause(goalId),
        { preempt: true },
      );
      if (!paused.ok || !paused.goal) {
        return {
          ok: false,
          message: paused.message ?? "创建目标修订前无法暂停当前 Goal。",
        };
      }
      goal = paused.goal;
      if (
        goal.goalContractRef?.id !== input.candidateContract.id ||
        goal.goalContractRef.revision + 1 !== input.candidateContract.revision
      ) {
        return {
          ok: false,
          message: "暂停 Goal 期间目标契约已变化，请基于最新状态重新提出修订。",
        };
      }
    }
    if (!goal.goalContractRef) {
      return {
        ok: false,
        message: "目标缺少可验证的当前 GoalContract 引用。",
      };
    }
    const createdAt = new Date().toISOString();
    const candidateContractRef = createGoalContractRef(input.candidateContract);
    const proposal = {
      id: `goal_amendment_${randomUUID()}`,
      goalId: goal.id,
      baseContractRef: structuredClone(goal.goalContractRef),
      candidateContract: structuredClone(input.candidateContract),
      candidateContractRef,
      reason: input.reason.trim() || "User requested a Goal amendment.",
      status: "pending" as const,
      ...(pausedExecution ? { pausedExecution: true } : {}),
      createdAt,
    };
    const saved = await agentGoalStore().saveIfPlanVersion(
      {
        ...goal,
        pendingGoalAmendment: proposal,
        updatedAt: createdAt,
      },
      goal.planVersion,
      goal.activePlanRef?.planId,
    );
    if (
      !saved.saved ||
      saved.goal?.pendingGoalAmendment?.id !== proposal.id
    ) {
      return {
        ok: false,
        message: "Goal 状态已并发变化，目标修订提案未写入。",
      };
    }
    await agentGoalStore().appendLedger(goal.id, {
      at: createdAt,
      kind: "goal_replanned",
      summary: `Goal amendment ${proposal.id} proposed; no semantics changed yet.`,
    });
    return {
      ok: true,
      proposal,
      message: pausedExecution
        ? "目标修订提案已创建，原执行路径已安全暂停并等待明确批准。"
        : "目标修订提案已创建，等待明确批准。",
    };
  }

  async function proposeGoalObjectiveAmendment(
    goalId: string,
    objective: string,
    reason: string,
  ): Promise<GoalAmendmentOperationResult> {
    const goal = await agentGoalStore().get(goalId);
    if (!goal?.goalContractSnapshot) {
      return { ok: false, message: "目标缺少可修订的 GoalContract。" };
    }
    const normalizedObjective = objective.trim();
    if (!normalizedObjective) {
      return { ok: false, message: "修改后的目标结果不能为空。" };
    }
    const createdAt = new Date().toISOString();
    return proposeGoalAmendment({
      goalId,
      reason,
      candidateContract: {
        ...structuredClone(goal.goalContractSnapshot),
        revision: goal.goalContractSnapshot.revision + 1,
        source: {
          kind: "goal_amendment",
          ref: goalId,
          summary: reason,
        },
        objective: normalizedObjective,
        createdAt,
      },
    });
  }

  function resolveGoalAmendment(
    goalId: string,
    proposalId: string,
    decision: "approve" | "reject",
  ): Promise<GoalAmendmentOperationResult> {
    return serializeGoalAmendment(goalId, () =>
      resolveGoalAmendmentAccepted(goalId, proposalId, decision),
    );
  }

  async function resolveGoalAmendmentAccepted(
    goalId: string,
    proposalId: string,
    decision: "approve" | "reject",
  ): Promise<GoalAmendmentOperationResult> {
    let goal = await agentGoalStore().get(goalId);
    let proposal = goal?.pendingGoalAmendment;
    if (
      !goal ||
      !proposal ||
      proposal.id !== proposalId ||
      proposal.status === "applied" ||
      proposal.status === "rejected"
    ) {
      return { ok: false, message: "待处理的目标修订提案不存在。" };
    }
    if (goal.status === "achieved" || goal.status === "canceled") {
      return { ok: false, message: "终态 Goal 不允许修改。" };
    }
    const resolvedAt = new Date().toISOString();
    if (decision === "reject") {
      const shouldResumePreviousPlan =
        proposal.pausedExecution === true &&
        goal.status === "waiting_for_review";
      const resolvedProposal = {
        ...proposal,
        status: "rejected" as const,
        resolvedAt,
      };
      const saved = await agentGoalStore().saveIfPlanVersion(
        {
          ...goal,
          pendingGoalAmendment: resolvedProposal,
          updatedAt: resolvedAt,
        },
        goal.planVersion,
        goal.activePlanRef?.planId,
      );
      const savedGoal = saved.goal;
      if (
        !saved.saved ||
        !savedGoal ||
        savedGoal.pendingGoalAmendment?.id !== proposal.id ||
        savedGoal.pendingGoalAmendment.status !== "rejected"
      ) {
        return {
          ok: false,
          message: "Goal 状态已并发变化，目标修订拒绝结果未写入。",
        };
      }
      await agentGoalStore().appendLedger(goal.id, {
        at: resolvedAt,
        kind: "review_resolved",
        summary: `Goal amendment ${proposal.id} rejected; active contract and Plan retained.`,
      });
      if (proposal.candidatePlanId) {
        const candidatePlan = await planStore().get(proposal.candidatePlanId);
        if (
          candidatePlan &&
          !candidatePlan.executionGoalId &&
          candidatePlan.status !== "discarded" &&
          candidatePlan.status !== "superseded"
        ) {
          await discardPlan(candidatePlan.id, candidatePlan.revision).catch(
            () => undefined,
          );
        }
      }
      let resumedPreviousPlan = false;
      if (shouldResumePreviousPlan) {
        const goalId = goal.id;
        const resumed = await runGoalOperation(
          goalId,
          () => goalChatService().resume(goalId),
        );
        resumedPreviousPlan = resumed.ok && resumed.goal?.status === "executing";
      }
      return {
        ok: true,
        proposal: resolvedProposal,
        message: resumedPreviousPlan
          ? "已撤销目标修订，并恢复原 Goal 与活动 Plan。"
          : "已拒绝目标修订，当前 Goal 和活动 Plan 保持不变。",
      };
    }

    if (proposal.status === "pending") {
      const pausedExecutionForApproval = goal.status === "executing";
      if (pausedExecutionForApproval) {
        const goalId = goal.id;
        const paused = await runGoalOperation(
          goalId,
          () => goalChatService().pause(goalId),
          { preempt: true },
        );
        if (!paused.ok) {
          return {
            ok: false,
            message: paused.message ?? "批准修订前无法暂停当前 Goal。",
          };
        }
        goal = (await agentGoalStore().get(goalId)) ?? goal;
        proposal = goal.pendingGoalAmendment;
        if (!proposal || proposal.id !== proposalId || proposal.status !== "pending") {
          return {
            ok: false,
            message: "暂停 Goal 期间修订提案已变化，请刷新后重试。",
          };
        }
      }
      const approvedProposal = {
        ...proposal,
        status: "approved" as const,
        pausedExecution:
          proposal.pausedExecution === true || pausedExecutionForApproval,
        resolvedAt,
      };
      const saved = await agentGoalStore().saveIfPlanVersion(
        {
          ...goal,
          pendingGoalAmendment: approvedProposal,
          updatedAt: resolvedAt,
        },
        goal.planVersion,
        goal.activePlanRef?.planId,
      );
      const approvedGoal = saved.goal;
      if (
        !saved.saved ||
        !approvedGoal ||
        approvedGoal.pendingGoalAmendment?.id !== proposal.id ||
        approvedGoal.pendingGoalAmendment.status !== "approved" ||
        approvedGoal.goalContractRef?.sha256 !== proposal.baseContractRef.sha256
      ) {
        return {
          ok: false,
          message: "Goal 状态已并发变化，目标修订批准结果未写入。",
        };
      }
      goal = approvedGoal;
      proposal = approvedGoal.pendingGoalAmendment;
    }

    if (!proposal) {
      return {
        ok: false,
        message: "目标修订状态已变化，请刷新后重试。",
      };
    }

    const planned = await createRuntimeGoalPlan(
      goal.id,
      `已批准目标修订：${proposal.reason}`,
      {
        amendmentId: proposal.id,
        goalContractSnapshot: proposal.candidateContract,
        goalContractRef: proposal.candidateContractRef,
      },
    );
    if (!planned.ok) {
      return {
        ok: true,
        proposal,
        message: `目标修订已批准，但尚未应用；新 Direct Plan 暂未生成：${planned.message}`,
      };
    }
    const latestGoal = await agentGoalStore().get(goal.id);
    const latestProposal = latestGoal?.pendingGoalAmendment ?? proposal;
    return {
      ok: true,
      proposal: latestProposal,
      plan: planned.plan,
      message: "目标修订已批准但尚未应用；新的 Direct Plan 已生成并等待采用。",
    };
  }

  async function adoptGoalPlan(
    input: AdoptGoalPlanInput,
  ): Promise<AdoptGoalPlanResult> {
    return serializePlanConfirmation(input.planId, async () => {
      let plan = await planStore().get(input.planId);
      if (!plan) return { ok: false, message: "Plan 不存在。" };
      if (
        plan.purpose !== "runtime_replan" ||
        plan.mode !== "direct" ||
        !plan.goalId ||
        !plan.parentPlanRef ||
        !plan.goalPlanVersion ||
        !plan.goalContractSnapshot ||
        !plan.goalContractRef ||
        !plan.trigger ||
        !plan.finalArtifact ||
        !plan.projection
      ) {
        return { ok: false, message: "该记录不是可采用的运行期 Direct Plan。", plan };
      }
      let goal = await agentGoalStore().get(plan.goalId);
      if (!goal) return { ok: false, message: "Plan 关联的 Goal 不存在。", plan };
      const recoveringAdoption = goal.activePlanRef?.planId === plan.id;
      if (
        plan.goalPlanVersion !== input.expectedGoalPlanVersion ||
        (!recoveringAdoption && plan.revision !== input.expectedRevision)
      ) {
        return { ok: false, message: "Plan 或 Goal 版本已变化，请刷新后重试。", plan };
      }
      if (
        (!recoveringAdoption && !isPlanConfirmable(plan)) ||
        plan.qualityReport?.status !== "ready"
      ) {
        return { ok: false, message: "Plan 尚未通过确认与质量门禁。", plan };
      }
      if (!(await planArtifactWriter().verify(plan))) {
        return { ok: false, message: "Plan 投影已漂移，请重新生成。", plan };
      }
      const evidenceVerification = await verifyPlanEvidence(plan);
      if (!evidenceVerification.ok) {
        return { ok: false, message: "Plan 反馈证据已漂移，请重新规划。", plan };
      }
      if (
        !recoveringAdoption &&
        (goal.status === "achieved" || goal.status === "canceled")
      ) {
        return { ok: false, message: "终态 Goal 不允许采用新 Plan。", plan };
      }
      const currentContractMatchesPlan =
        goal.goalContractRef?.sha256 === plan.goalContractRef.sha256 &&
        goal.goalContractRef?.id === plan.goalContractRef.id &&
        goal.goalContractRef?.revision === plan.goalContractRef.revision;
      const amendment = goal.pendingGoalAmendment;
      const adoptingApprovedAmendment =
        !currentContractMatchesPlan &&
        plan.trigger?.kind === "goal_amendment" &&
        amendment?.status === "approved" &&
        amendment.candidatePlanId === plan.id &&
        amendment.baseContractRef.sha256 === goal.goalContractRef?.sha256 &&
        amendment.candidateContractRef.sha256 === plan.goalContractRef.sha256 &&
        amendment.candidateContractRef.revision ===
          plan.goalContractRef.revision;
      if (
        !recoveringAdoption &&
        (amendment?.status === "pending" ||
          (amendment?.status === "approved" && !adoptingApprovedAmendment))
      ) {
        return {
          ok: false,
          message: "Goal 存在尚未处理完成的目标修订，不能采用其他候选 Plan。",
          plan,
        };
      }
      if (!currentContractMatchesPlan && !adoptingApprovedAmendment) {
        return { ok: false, message: "GoalContract 已变化，不能采用旧候选 Plan。", plan };
      }
      if (
        !recoveringAdoption &&
        (goal.planVersion !== input.expectedGoalPlanVersion - 1 ||
          (goal.activePlanRef?.planId !== plan.parentPlanRef.planId ||
            goal.activePlanRef.goalPlanVersion !==
              plan.parentPlanRef.goalPlanVersion))
      ) {
        return { ok: false, message: "Goal 活动 Plan 已变化，采用冲突。", plan };
      }
      const adoptedAt = new Date().toISOString();
      if (!recoveringAdoption) {
        const milestoneGraph = validatePlanMilestoneGraph(
          plan.finalArtifact.milestones,
        );
        const nextMilestones = plan.finalArtifact.milestones.map(
          (milestone) => ({
            id: milestone.id,
            description: `${milestone.title}：${milestone.description}`,
            dependsOn:
              milestoneGraph.dependenciesById.get(milestone.id) ?? [],
            successCriteria: (milestone.acceptanceChecks ?? []).map(
              (check, index) => ({
                id: `${milestone.id}_criterion_${index + 1}`,
                description: check.description,
                acceptanceChecks: [structuredClone(check)],
              }),
            ),
            state: milestoneGraph.rootIds.has(milestone.id)
              ? ("ready" as const)
              : ("pending" as const),
            runIds: [],
            attempts: 0,
          }),
        );
        const oldMilestones = new Map(
          goal.milestones.map((milestone) => [milestone.id, milestone]),
        );
        const reusableMilestones = nextMilestones.map((milestone) => {
          const previous = oldMilestones.get(milestone.id);
          return previous?.state === "accepted" &&
            milestoneDefinitionHash(previous) ===
              milestoneDefinitionHash(milestone)
            ? structuredClone(previous)
            : milestone;
        });
        const activePlanRef: GoalPlanRef = {
          planId: plan.id,
          planRevision: plan.revision,
          goalPlanVersion: plan.goalPlanVersion,
          mode: "direct",
          purpose: "runtime_replan",
          goalContractRef: structuredClone(plan.goalContractRef),
        };
        const adoptedContract = adoptingApprovedAmendment && amendment
          ? structuredClone(amendment.candidateContract)
          : structuredClone(plan.goalContractSnapshot);
        const adoptedPlanId = plan.id;
        const adoptedPlanVersion = plan.goalPlanVersion;
        const adoptedParentPlanRef = structuredClone(plan.parentPlanRef);
        const adoptedTrigger = structuredClone(plan.trigger);
        const nextPlanHistory = (goal.planHistory ?? []).map((entry) => {
          if (entry.planId === adoptedPlanId) {
            return {
              ...entry,
              ...activePlanRef,
              parentPlanRef: structuredClone(adoptedParentPlanRef),
              trigger: structuredClone(adoptedTrigger),
              outcome: "active" as const,
              adoptedAt,
            };
          }
          if (
            entry.outcome === "candidate" &&
            entry.goalPlanVersion === adoptedPlanVersion &&
            entry.parentPlanRef?.planId === adoptedParentPlanRef.planId
          ) {
            return {
              ...entry,
              outcome: "rejected" as const,
              supersededAt: adoptedAt,
            };
          }
          return entry.outcome === "active"
            ? {
                ...entry,
                outcome: "superseded" as const,
                supersededAt: adoptedAt,
              }
            : entry;
        });
        if (!nextPlanHistory.some((entry) => entry.planId === adoptedPlanId)) {
          nextPlanHistory.push({
            ...activePlanRef,
            parentPlanRef: structuredClone(adoptedParentPlanRef),
            trigger: structuredClone(adoptedTrigger),
            outcome: "active",
            adoptedAt,
          });
        }
        const candidate: Goal = {
          ...goal,
          description: adoptedContract.objective,
          goalContractSnapshot: adoptedContract,
          goalContractRef: structuredClone(plan.goalContractRef),
          activePlanRef,
          planHistory: nextPlanHistory,
          ...(adoptingApprovedAmendment && amendment
            ? {
                pendingGoalAmendment: {
                  ...amendment,
                  status: "applied" as const,
                  candidatePlanId: plan.id,
                  appliedAt: adoptedAt,
                },
              }
            : {}),
          successCriteria: buildGoalSuccessCriteriaFromPlan(plan),
          taskContract: compileAgentTaskContract({
            description: adoptedContract.objective,
            ...(goal.chatSessionId ? { chatSessionId: goal.chatSessionId } : {}),
            ...(goal.originMessageId
              ? { originMessageId: goal.originMessageId }
              : {}),
          }),
          planVersion: plan.goalPlanVersion,
          milestones: reusableMilestones,
          status: "planning",
          stopReason: undefined,
          runtimeCheckpoint: undefined,
          executionModelBinding: selectPlanExecutionModelBinding(plan),
          ...(plan.selectedSkill
            ? { selectedSkill: structuredClone(plan.selectedSkill) }
            : {}),
          selectedSkillInputValues: plan.selectedSkillInputValues,
          executionUsage: {
            ...goal.executionUsage,
            replans: goal.executionUsage.replans + 1,
          },
          acceptanceState: goal.acceptanceState
            ? { ...goal.acceptanceState, phase: "idle", lastDecision: undefined }
            : goal.acceptanceState,
          acceptanceRetryState: undefined,
          manualCompletionAttestation: undefined,
          acceptanceCertificate: undefined,
          updatedAt: adoptedAt,
        };
        await agentGoalStore().appendLedgerIfAbsent(
          goal.id,
          `goal-plan-adoption-started:${plan.id}`,
          {
            at: adoptedAt,
            kind: "goal_replanned",
            summary: `Adopting Plan ${plan.id} v${plan.goalPlanVersion}.`,
          },
        );
        const savedGoal = await agentGoalStore().saveIfPlanVersion(
          candidate,
          goal.planVersion,
          plan.parentPlanRef.planId,
        );
        if (!savedGoal.saved || !savedGoal.goal) {
          return { ok: false, message: "Goal 版本并发冲突，未采用 Plan。", plan };
        }
        goal = savedGoal.goal;
      }
      const parentPlan = await planStore().get(plan.parentPlanRef.planId);
      if (parentPlan && parentPlan.status !== "superseded") {
        await planStore().save(
          {
            ...parentPlan,
            status: "superseded",
            supersededByPlanId: plan.id,
            supersededAt: adoptedAt,
          },
          parentPlan.revision,
          "plan_superseded",
          { supersededByPlanId: plan.id, goalId: goal.id },
        );
      }
      if (
        plan.executionGoalId !== goal.id ||
        plan.status === "awaiting_confirmation"
      ) {
        plan = await planStore().save(
          {
            ...plan,
            status: "confirmed_pending_execution",
            executionGoalId: goal.id,
            executionRunId: undefined,
            confirmedRevision: plan.confirmedRevision ?? plan.revision,
            confirmedAt: plan.confirmedAt ?? adoptedAt,
          },
          plan.revision,
          recoveringAdoption
            ? "goal_plan_adoption_link_recovered"
            : "goal_plan_adopted",
          { goalId: goal.id, goalPlanVersion: plan.goalPlanVersion },
        );
      }
      const resumed =
        goal.status === "executing" ||
        goal.status === "achieved" ||
        goal.status === "canceled"
          ? { id: goal.id, description: goal.description, status: goal.status }
          : await goalChatService().resume(goal.id);
      goal = (await agentGoalStore().get(goal.id)) ?? goal;
      const nextPlanStatus = planStatusForExecutionGoal(resumed.status);
      if (plan.status !== nextPlanStatus) {
        plan = await planStore().save(
          { ...plan, status: nextPlanStatus },
          plan.revision,
          recoveringAdoption
            ? "goal_plan_adoption_recovered"
            : "plan_execution_started",
          { goalId: goal.id },
        );
      }
      await agentGoalStore().appendLedgerIfAbsent(
        goal.id,
        `goal-plan-adopted:${plan.id}`,
        {
          at: new Date().toISOString(),
          kind: "goal_replanned",
          summary: `Adopted Plan ${plan.id} v${plan.goalPlanVersion}; execution resumed.`,
        },
      );
      return {
        ok: true,
        plan,
        goal,
        message: recoveringAdoption
          ? "已恢复完成 Plan 采用事务。"
          : "已采用新的 Direct Plan 并恢复 Goal。",
      };
    });
  }

  async function attachConfirmedPlanGoal(
    plan: PlanRecord,
    activeGoal: ChatSessionGoalSummary,
  ): Promise<void> {
    const session = await chatSessionStore().attachGoal(
      plan.sessionId,
      activeGoal,
    );
    const goalEventRef = `plan-confirmed:${plan.id}`;
    if (session.messages.some((message) => message.goalEventRef === goalEventRef)) {
      return;
    }
    await chatSessionStore().appendMessage({
      sessionId: plan.sessionId,
      role: "assistant",
      content: `计划已确认，开始执行目标：${activeGoal.description}。`,
      goalId: activeGoal.id,
      goalEventRef,
    });
  }

  async function confirmGoalDraftAccepted(
    draftId: string,
    edit?: GoalDraftEdit,
  ): Promise<GoalDraftConfirmResult> {
    try {
      const draft = goalDraftService().markConfirmed(draftId, edit);
      if (!draft) {
        return { ok: false, message: "目标草案不存在或已处理。" };
      }

      const draftSession = await chatSessionStore().get(draft.sessionId);
      const draftWithWorkspace =
        !draft.workspaceId && draftSession?.workspaceId
          ? { ...draft, workspaceId: draftSession.workspaceId }
          : draft;
      const createdGoal = await goalChatService().createFromDraft({
        draft: draftWithWorkspace,
      });
      const activeGoal = await goalChatService().resume(createdGoal.id);
      await chatSessionStore().attachGoal(draft.sessionId, activeGoal);
      await chatSessionStore().appendMessage({
        sessionId: draft.sessionId,
        role: "assistant",
        content: `已确认并开始执行目标：${activeGoal.description}。`,
        goalId: activeGoal.id,
        goalEventRef: "goal_started",
      });

      return {
        ok: true,
        draft,
        activeGoal,
      };
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error ? error.message : "无法确认目标草案。",
      };
    }
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
    options?: ToolResultOffloadReadScope,
  ): Promise<ReadToolResultRefResult> {
    if (!isSafeToolResultRef(ref)) {
      return {
        ok: false,
        message: "工具结果引用无效。",
      };
    }

    const content = await toolResultOffloadStore().read(ref, options);
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
      Promise.allSettled([...activeTaskRunCompletions.values()]),
      Promise.allSettled([...activeRuntimeInvocationCompletions]),
      goalClose,
      Promise.allSettled(initialMcpCloses),
      mcpInitializationPromise ?? Promise.resolve(),
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
        ?.flushShadowWrites() ?? Promise.resolve(),
      (lazyStore.get("agentTrajectoryStore") as AgentTrajectoryStore | undefined)
        ?.flushShadowWrites() ?? Promise.resolve(),
      (lazyStore.get("chatSessionStore") as ChatSessionStore | undefined)
        ?.flush() ?? Promise.resolve(),
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
    getNavigationSections,
    buildDesktopRuntimeInfo: () =>
      buildDesktopRuntimeInfo({
        appPath: app.getAppPath(),
        isPackaged: app.isPackaged,
        productName: appMeta.productName,
        rendererMode: process.env.ELECTRON_RENDERER_URL ? "development" : "production",
        userDataPath: app.getPath("userData"),
        version: app.getVersion(),
      }),
    discoverSkills: () => discoverSkills({ skillsDir }),
    modelSettingsStore,
    modelConnectionService,
    modelRouter,
    agentBootstrapService,
    agentValidationStore,
    scheduledTaskStore,
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
    listChatSessions,
    getChatSession,
    archiveChatSession,
    restoreChatSession,
    renameChatSession,
    deleteChatSession,
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
    confirmPlan,
    discardPlan,
    createRuntimeGoalPlan,
    adoptGoalPlan,
    proposeGoalAmendment,
    resolveGoalAmendment,
    runGoalOperation,
    replanGoal: createRuntimeGoalPlan,
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
    initializeMcpTools,
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

function formatScheduledTaskRunPrompt(task: ScheduledTask): string {
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

function formatAgentRunSessionPrompt(
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

function formatAgentRunSessionStatus(
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

function translateExecutionStatus(
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

function translateExecutionStepState(
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

function formatScheduledTaskRunResult(result: RunScheduledTaskResult): string {
  if (!result.ok) {
    return `定时任务没有启动：${result.message}`;
  }

  return [
    `定时任务运行完成：${formatRunStatusForChat(result.run.status)}。`,
    "",
    result.run.summary || "没有生成摘要。",
  ].join("\n");
}

function formatRunStatusForChat(status: AgentRunStatus): string {
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

function isLivePlanReference(status: PlanStatus): boolean {
  return (
    status === "drafting" ||
    status === "paused" ||
    status === "awaiting_input" ||
    status === "awaiting_confirmation" ||
    status === "confirmed_pending_execution" ||
    status === "executing"
  );
}

function planStatusForExecutionGoal(
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

function buildGoalSuccessCriteriaFromPlan(plan: PlanRecord): SuccessCriterion[] {
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

function milestoneDefinitionHash(
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

function defaultSelectedSkillInputValues(
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
