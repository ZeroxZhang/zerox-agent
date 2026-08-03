import { app, BrowserWindow, safeStorage } from "electron";
import { createHash, randomUUID } from "node:crypto";
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
import { createStorageImpl } from "./storage/storageDb";
import { resolveStorageBackend } from "./storage/backendResolver";
import {
  createProvider,
  resolveProviderBaseUrl,
} from "./providers/providerFactory";
import { createSettingsBackedChatClient } from "./providers/providerChatClient";
import { createModelRouter } from "./providers/modelRouter";
import { createPlanStore } from "./planStore";
import { createPlanArtifactWriter } from "./planArtifactWriter";
import { createPlanDebateOrchestrator } from "./planDebateOrchestrator";
import { createPlanInvestigatorService } from "./planInvestigatorService";
import { createPlanQualityReport } from "./plannerKernel";
import { resolveSkillInput } from "./skillExecutionService";
import { verifyPlanEvidence } from "./planEvidenceVerifier";
import {
  isPlanConfirmable,
  type ConfirmPlanInput,
  type ConfirmPlanResult,
  type PlanArtifact,
  type PlanningStageKind,
  type PlanRecord,
  type PlanStatus,
} from "../shared/planMode";
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
import { createWorkflowRuntime } from "./workflow/workflowRuntime";
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
import type { Storage } from "../shared/storageContract";
import {
  createToolAuthorizationService,
  type ToolUserApprovalResult,
  type ToolUserApprovalRequest,
} from "./toolAuthorizationService";
import { getAppMeta } from "../shared/appMeta";
import { getNavigationSections } from "../shared/navigation";
import {
  upgradeGoalAcceptanceProtocol,
  type Goal,
  type GoalBudget,
  type SuccessCriterion,
} from "../shared/agentGoal";
import type { GoalReviewPolicy } from "../shared/agentGoalReview";
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

function formatGoalTerminalMessage(goal: Goal, eventMessage?: string): string {
  const lines = [formatGoalTerminalHeading(goal)];
  const summaries = collectGoalResultSummaries(goal);

  if (summaries.length > 0) {
    lines.push(
      "",
      "结果摘要：",
      ...summaries.slice(-5).map((summary) => `- ${summary}`),
    );
  } else if (eventMessage?.trim()) {
    lines.push("", eventMessage.trim());
  }

  return lines.join("\n");
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
    const details = [
      milestone.lastRunSummary?.trim(),
      milestone.lastAcceptanceSummary?.trim(),
    ].filter((value): value is string => Boolean(value));
    const uniqueDetails = [...new Set(details)];
    if (uniqueDetails.length === 0) {
      continue;
    }
    summaries.push(`${milestone.description}：${uniqueDetails.join("；")}`);
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
    const sourcePlan = (await planStore().listAll()).find(
      (plan) => plan.executionGoalId === event.goalId,
    );
    if (!sourcePlan) {
      return;
    }
    await serializePlanConfirmation(sourcePlan.id, async () => {
      const canonicalPlan = await planStore().get(sourcePlan.id);
      if (!canonicalPlan || canonicalPlan.executionGoalId !== event.goalId) {
        return;
      }
      const goal = await agentGoalStore().get(event.goalId);
      const runId = goal?.milestones
        .flatMap((milestone) => milestone.runIds)
        .at(-1);
      const terminalStatus: PlanStatus | null =
        event.status === "achieved" ||
        event.status === "completed_unverified"
          ? "completed"
          : event.status === "canceled"
            ? "canceled"
            : event.status === "failed" ||
                event.status === "stopped_budget" ||
                event.status === "stopped_stalled" ||
                event.status === "stopped_blocked"
              ? "failed"
              : null;
      const nextStatus = terminalStatus ?? "executing";
      if (
        nextStatus === canonicalPlan.status &&
        (!runId || canonicalPlan.executionRunId === runId)
      ) {
        return;
      }
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
      status: goal.status,
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

  function createToolExecutor() {
    return lazy("agentToolExecutor", () => {
      const executor = createAgentToolExecutor({
        memoryStore: memoryStore(),
        chatSessionStore: chatSessionStore(),
        toolResultOffloadStore: toolResultOffloadStore(),
        discoverSkills: () => discoverSkills({ skillsDir }),
        historyIndexStore: historyIndexStore(),
      });
      // Actor execution depends on the SQLite checkpoint graph. Do not
      // advertise a model-callable tool when the active JSON backend cannot
      // execute it. Workflow networking remains disabled below until its
      // permission path is complete.
      const registry = executor.getRegistry();
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
    return lazy("chatSessionStore", () => createChatSessionStore({ configDir }));
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
      const rt = createWorkflowRuntime({
        async spawnActor(input) {
          // Delegate to the actor runtime; voters are ephemeral.
          const runtime = actorRuntime();
          const handle = runtime.spawn(input);
          return runtime.wait(handle.actorId);
        },
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
          const client =
            transportKind === "stdio"
              ? createMcpClient({
                  name: config.name,
                  transport: "stdio",
                  command: config.command,
                  args: config.args,
                  env: config.env,
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
      // A child process alone is not a filesystem/network sandbox; exposing
      // arbitrary Node entrypoints would bypass the manifest permission model.
      // They remain unavailable until an OS-enforced capability sandbox exists.
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
    return trackRuntimeInvocation(() =>
      serializePlanConfirmation(input.planId, async () => {
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
      if (plan.schemaVersion === 2) {
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
      const goalSuccessCriteria =
        plan.schemaVersion === 2 && artifact.acceptanceChecks?.length
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
        ...(plan.schemaVersion === 2
          ? plan.selectedSkillInputValues &&
            Object.keys(plan.selectedSkillInputValues).length > 0
            ? {
                selectedSkillInputValues: structuredClone(
                  plan.selectedSkillInputValues,
                ),
              }
            : {}
          : defaultSelectedSkillInputValues(plan)),
        normalizedDescription: artifact.objective,
        sourcePlanRef: {
          planId: plan.id,
          revision: confirmedPlanRevision,
          sha256: projection.sha256,
        },
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
            confirmedPlanSchemaVersion === 2 &&
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
      }),
    );
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
    runGoalOperation,
    replanGoal: (goalId: string, instructions: string) =>
      runGoalOperation(goalId, () => goalChatService().replan(goalId, instructions)),
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
  if (status === "achieved" || status === "completed_unverified") {
    return "completed";
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
  return "executing";
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
