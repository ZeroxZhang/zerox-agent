import { app, BrowserWindow, safeStorage } from "electron";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createAgentExecutionStore } from "./agentExecutionStore";
import { createAgentTrajectoryStore } from "./agentTrajectoryStore";
import { createAgentLearningStore } from "./agentLearningStore";
import { createAgentLearningService } from "./agentLearningService";
import { createAgentEvalCandidateStore } from "./agentEvalCandidateStore";
import { createAgentEvalCandidateService } from "./agentEvalCandidateService";
import { createAgentWorkspaceStore } from "./agentWorkspaceStore";
import { createWorkspaceRunStore } from "./workspaceRunStore";
import { createAgentGoalStore } from "./agentGoalStore";
import { createAgentGoalController } from "./agentGoalController";
import { createAgentGoalAcceptance } from "./agentGoalAcceptance";
import { createAgentGoalContext } from "./agentGoalContext";
import { createAgentGoalPlanner } from "./agentGoalPlanner";
import { createGoalRuntimeEngine } from "./goalRuntimeEngine";
import { applyGoalOutputRootsToRunContext } from "./goalOutputRoots";
import { createGoalChatService } from "./goalChatService";
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
import { createAgentRunStore } from "./agentRunStore";
import { createAgentRunnerService } from "./agentRunnerService";
import { createAgentBootstrapService } from "./agentBootstrapService";
import { createAgentValidationStore } from "./agentValidationStore";
import { createAgentToolExecutor } from "./agentToolExecutor";
import { createChatService } from "./chatService";
import { createChatSessionStore } from "./chatSessionStore";
import {
  createElectronSecretVault,
  createModelSettingsStore,
} from "./modelSettingsStore";
import { createModelConnectionService } from "./modelConnectionService";
import { createMemoryStore } from "./memoryStore";
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
  buildSkillGraph,
  collectSkillMcpConfigs,
} from "./skillRegistry";
import { createMcpClient } from "./mcpClient";
import { resolveTransportKind } from "./mcpTransport";
import { createMcpTransportClient } from "./mcpTransportClient";
import { createMaxMode } from "./providers/maxMode";
import { createSkillExecutor } from "./skillExecutor";
import { createScheduledTaskStore } from "./taskStore";
import { createTaskSchedulerService } from "./taskSchedulerService";
import { createToolAuditLog } from "./toolAuditLog";
import { KernelEventBus } from "./kernel/eventBus";
import { createStorageImpl } from "./storage/storageDb";
import { resolveStorageBackend } from "./storage/backendResolver";
import { createProvider } from "./providers/providerFactory";
import { createSettingsBackedChatClient } from "./providers/providerChatClient";
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
import { registerWorkflowTool } from "./workflow/workflowTool";
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
import type { Goal, GoalBudget, SuccessCriterion } from "../shared/agentGoal";
import type { GoalReviewPolicy } from "../shared/agentGoalReview";
import type {
  GoalDraftConfirmResult,
  GoalDraftDiscardResult,
  GoalDraftEdit,
} from "../shared/goalTranslation";
import type {
  ChatSessionGoalSummary,
  ChatSessionListItem,
  ChatSessionOperationResult,
  ChatSessionRecord,
  GoalProgressEvent,
} from "../shared/chat";
import type {
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

function isTerminalGoalStatus(status: Goal["status"]): boolean {
  return (
    status === "achieved" ||
    status === "stopped_budget" ||
    status === "stopped_stalled" ||
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

function formatGoalTerminalHeading(goal: Goal): string {
  switch (goal.status) {
    case "achieved":
      return `目标已达成：${goal.description}`;
    case "failed":
      return `目标执行失败：${goal.description}`;
    case "canceled":
      return `目标已取消：${goal.description}`;
    case "stopped_budget":
      return `目标因预算停止：${goal.description}`;
    case "stopped_stalled":
      return `目标因进展停滞停止：${goal.description}`;
    case "planning":
    case "executing":
    case "waiting_for_review":
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

export function createAppContainer(options: {
  requestToolApproval: (
    request: ToolUserApprovalRequest,
  ) => Promise<ToolUserApprovalResult>;
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
      try {
        storage(); // ensure the native module loads + migrates
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn(
          `[storage] SQLite backend unavailable (${String(error)}); falling back to json.`,
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

  const modelSettingsStore = createModelSettingsStore({
    configDir,
    vault: createElectronSecretVault(safeStorage),
  });
  let kernelPermissionRules: PermissionRule[] = [];

  const goalProgressListeners = new Set<(event: GoalProgressEvent) => void>();
  const agentRunsChangedListeners = new Set<(event: AgentRunsChangedEvent) => void>();
  let goalProgressDeliveryQueue = Promise.resolve();

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
    notifyGoalProgressListeners(canonicalEvent);
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
      session.activeGoalId === summary.id &&
      existingSummary?.description === summary.description &&
      existingSummary.status === summary.status
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
    if (session.messages.some((message) => message.goalEventRef === goalEventRef)) {
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
    };
  }

  function shouldClearActiveChatGoal(status: Goal["status"]): boolean {
    return status === "achieved" || status === "failed" || status === "canceled";
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
    if (shouldClearActiveChatGoal(summary.status)) {
      return undefined;
    }
    return summary;
  }

  async function listChatSessions(): Promise<ChatSessionListItem[]> {
    const sessions = await chatSessionStore().list();
    return Promise.all(
      sessions.map(async (session) => {
        const activeGoal = await reconcileChatSessionGoalSummary(
          session.id,
          session.activeGoal,
        );
        const sessionWithoutActiveGoal = { ...session };
        delete sessionWithoutActiveGoal.activeGoal;
        return {
          ...sessionWithoutActiveGoal,
          ...(activeGoal ? { activeGoal } : {}),
        };
      }),
    );
  }

  async function getChatSession(
    sessionId: string,
  ): Promise<ChatSessionRecord | null> {
    const session = await chatSessionStore().get(sessionId);
    if (!session?.activeGoalId) {
      return session ? projectChatSessionForTranscript(session) : session;
    }

    const activeGoal = session.goalSummaries?.find(
      (summary) => summary.id === session.activeGoalId,
    );
    const reconciledGoal = await reconcileChatSessionGoalSummary(
      session.id,
      activeGoal,
    );
    if (!reconciledGoal) {
      const repairedSession = await chatSessionStore().get(sessionId);
      return repairedSession
        ? projectChatSessionForTranscript(repairedSession)
        : repairedSession;
    }

    const repairedSession = await chatSessionStore().get(sessionId);
    return repairedSession
      ? projectChatSessionForTranscript(repairedSession)
      : repairedSession;
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
      // P6: register the actor + workflow tools on the dynamic registry so the
      // model can spawn sub-agents and run workflows (e.g. deep-research).
      const registry = executor.getRegistry();
      registerActorTool(registry, { actorRuntime: actorRuntime() });
      registerWorkflowTool(registry, { workflowRuntime: workflowRuntime() });
      void initializeMcpTools(executor);
      return executor;
    });
  }

  function modelConnectionService() {
    return lazy("modelConnectionService", () =>
      createModelConnectionService({
        modelSettingsStore,
        chatClient: chatClient(),
      }),
    );
  }

  function agentValidationStore() {
    return lazy("agentValidationStore", () =>
      createAgentValidationStore({ configDir, backend: storageBackend(), storage: storage() ?? undefined }),
    );
  }

  function scheduledTaskStore() {
    return lazy("scheduledTaskStore", () =>
      createScheduledTaskStore({ configDir, backend: storageBackend(), storage: storage() ?? undefined }),
    );
  }

  function toolAuditLog() {
    return lazy("toolAuditLog", () =>
      createToolAuditLog({ configDir, backend: storageBackend(), storage: storage() ?? undefined }),
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
      createAgentRunStore({ configDir, backend: storageBackend(), storage: storage() ?? undefined }),
    );
  }

  function agentExecutionStore() {
    return lazy("agentExecutionStore", () => createAgentExecutionStore({ configDir }));
  }

  function agentTrajectoryStore() {
    return lazy("agentTrajectoryStore", () =>
      createAgentTrajectoryStore({ configDir, backend: storageBackend(), storage: storage() ?? undefined }),
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

    if (approval.automatic) {
      throw new Error(
        "Git worktree creation requires explicit user approval; global automatic approval is not sufficient.",
      );
    }

    return agentWorkspaceService().createGitWorktreeWorkspace({
      name: input.name,
      repositoryRoot: input.repositoryRoot,
      branch: input.branch,
      approval: {
        kind: "explicit_user_approval",
        approvedAt: new Date().toISOString(),
        approvedBy: "user",
      },
    });
  }

  function multiAgentSessionStore() {
    return lazy("multiAgentSessionStore", () => createMultiAgentSessionStore({ configDir }));
  }

  function memoryProfileStore() {
    return lazy("memoryProfileStore", () =>
      createMemoryProfileStore({ configDir, backend: storageBackend(), storage: storage() ?? undefined }),
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
        embeddingService: {
          async embed(text: string) {
            const settings = await modelSettingsStore.load();
            const apiKey = await modelSettingsStore.getApiKey();

            if (!settings.embeddingModel || !apiKey) {
              return null;
            }

            const vector = await createOpenAiCompatibleEmbeddingClient().embed({
              baseUrl: settings.baseUrl,
              apiKey,
              model: settings.embeddingModel,
              input: text,
            });

            return {
              model: settings.embeddingModel,
              vector,
            };
          },
        },
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
      }),
    );
  }

  async function getModelProfile() {
    const settings = await modelSettingsStore.load();
    const apiKey = await modelSettingsStore.getApiKey();

    if (!settings.chatModel || !apiKey) {
      throw new Error("模型配置不完整。");
    }

    return {
      baseUrl: settings.baseUrl,
      apiKey,
      model: settings.chatModel,
      temperature: settings.temperature,
      maxTokens: settings.maxTokens,
      ...(settings.thinkingEnabled
        ? {
            thinking: {
              type: "enabled" as const,
              budgetTokens: settings.thinkingBudgetTokens,
            },
          }
        : {}),
    };
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
        fallback: createOpenAiCompatibleClient(),
      }),
    );
  }

  function getProvider() {
    return lazy("llmProvider", async () => {
      const settings = await modelSettingsStore.load();
      const apiKey = (await modelSettingsStore.getApiKey()) ?? "";
      return createProvider({
        providerId: settings.providerId ?? "openai-compatible",
        apiKey,
        chatModel: settings.chatModel,
        baseUrl: settings.baseUrl,
        thinkingEnabled: settings.thinkingEnabled,
        thinkingBudgetTokens: settings.thinkingBudgetTokens,
      });
    });
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
      const s = storage();
      return s ? createCheckpointRepository(s) : null;
    });
  }

  function memoryRepository() {
    return lazy("memoryRepository", () => {
      const s = storage();
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
      const s = storage();
      return s ? createRunRepository(s) : null;
    });
  }

  function actorRuntime() {
    return lazy("actorRuntime", () =>
      createActorRuntime({
        ...(storage() ? { storage: storage()! } : {}),
        deps: {
          runActor: async (input, forkContext, cancel) => {
            const s = storage();
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
      const s = storage();
      if (!s) return null;
      return createCheckpointWriterOrchestrator({
        storage: s,
        runRepository: createRunRepository(s),
        checkpointRepository: createCheckpointRepository(s),
      });
    });
  }

  // P6 workflow runtime. Host hooks delegate to the actor runtime + existing
  // webfetch/websearch tool handlers (wired when those tools are registered).
  // The built-in deep-research workflow is registered eagerly. P7 dream/distill
  // consumes this for multi-source fact gathering.
  function workflowRuntime() {
    return lazy("workflowRuntime", () => {
      const rt = createWorkflowRuntime({
        async spawnActor(input) {
          // Delegate to the actor runtime; voters are ephemeral.
          const runtime = actorRuntime();
          const handle = runtime.spawn(input);
          return runtime.wait(handle.actorId);
        },
        async webfetch(url) { return `[webfetch not wired in container: ${url}]`; },
        async websearch(q) { return [{ url: `https://example.com/${encodeURIComponent(q)}`, title: q, snippet: q }]; },
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
      const s = storage();
      return s ? createSessionRepository(s) : null;
    });
  }

  function selfImprovementService() {
    return lazy("selfImprovementService", () => {
      const s = storage();
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
    return lazy("agentRunnerService", () =>
      createAgentRunnerService({
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
        actorRuntimeForMaxMode: actorRuntime(),
      }),
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
          getModelProfile,
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
          onEvent(event) {
            for (const window of BrowserWindow.getAllWindows()) {
              if (!window.isDestroyed()) {
                window.webContents.send("goal:milestoneRunEvent", event);
              }
            }
          },
        }),
        acceptance: createAgentGoalAcceptance(),
        onProgress: emitGoalProgressEvent,
        planner: {
          async replan(goal, reason) {
            return createAgentGoalPlanner({
              chatClient: chatClient(),
              modelProfile: await getModelProfile(),
            }).replan(goal, reason);
          },
        },
        trajectoryStore: agentTrajectoryStore(),
        createAcceptanceContext: async (goal, milestone, runResult) => {
          const modelProfile = acceptanceContextNeedsModel(goal, milestone)
            ? await getModelProfile()
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
            toolExecutor,
            trajectoryStore: agentTrajectoryStore(),
            ...(modelProfile
              ? {
                  chatClient: chatClient(),
                  modelProfile,
                }
              : {}),
            transcriptMessages: runResult?.transcriptMessages,
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
      }),
    );
  }

  function agentGoalTranslator() {
    return lazy("agentGoalTranslator", () =>
      createAgentGoalTranslator({
        chatClient: chatClient(),
        getModelProfile,
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
  const activeMcpClients: Awaited<ReturnType<typeof createMcpClient>>[] = [];
  const activeTaskRunControllers = new Map<string, AbortController>();

  async function initializeMcpTools(
    toolExecutor: ReturnType<typeof createAgentToolExecutor>,
  ): Promise<void> {
    if (mcpInitialized) return;
    mcpInitialized = true;

    const skillExecutor = createSkillExecutor();

    try {
      const graph = await buildSkillGraph({ skillsDir });
      const mcpConfigs = await collectSkillMcpConfigs({ skillsDir });

      for (const config of mcpConfigs) {
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

          await client.connect();
          activeMcpClients.push(client);

          const mcpTools = await client.listTools();
          for (const tool of mcpTools) {
            try {
              toolExecutor.getRegistry().register(
                tool,
                async (args) => {
                  const result = await client.callTool(tool.function.name, args);
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

      for (const skillName of graph.order) {
        const skill = graph.skills.find((s) => s.manifest.name === skillName);
        if (!skill?.manifest.tools?.length) continue;

        for (const toolDef of skill.manifest.tools) {
          try {
            const handler = skillExecutor.getToolHandler(skill, toolDef);

            toolExecutor.getRegistry().register(
              {
                type: "function",
                function: {
                  name: toolDef.name,
                  description: toolDef.description,
                  parameters: toolDef.parameters,
                },
              },
              handler,
              `skill:${skill.manifest.name}`,
            );
          } catch {
            // Skip tools that conflict
          }
        }
      }
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

  async function runAgentTask(
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
    if (!task) {
      return {
        ok: false,
        message: "Scheduled task was not found.",
      };
    }

    const sessionId = await resolveTaskRunSessionId(task, runOptions);
    const controller = new AbortController();
    activeTaskRunControllers.set(taskId, controller);
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

  async function resumeAgentRun(runId: string): Promise<RunScheduledTaskResult> {
    const checkpoint = await agentExecutionStore().get(runId);

    if (!checkpoint) {
      return {
        ok: false,
        message: "运行检查点不存在，无法恢复。",
      };
    }

    if (activeTaskRunControllers.has(checkpoint.taskId)) {
      return {
        ok: false,
        message: "这个任务已经在运行中。",
      };
    }

    const controller = new AbortController();
    activeTaskRunControllers.set(checkpoint.taskId, controller);
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
    budget: GoalBudget;
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

    return {
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
      budget: input.budget,
      budgetUsage: {
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
    };
  }

  async function confirmGoalDraft(
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

  async function runGoalOperation(
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

  async function runGoalBudgetOperation(
    operation: () => Promise<ChatSessionGoalSummary>,
  ): Promise<{ ok: boolean; goal?: Goal; message?: string }> {
    return runGoalOperation(operation);
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
    goalChatService,
    agentGoalController,
    agentWorkspaceStore,
    workspaceRunStore,
    agentWorkspaceService,
    requestGitWorktreeAgentWorkspace,
    multiAgentSessionStore,
    multiAgentCoordinator,
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
    openAgentRunSession,
    resumeAgentRun,
    pauseAgentRun,
    createGoalDraft,
    goalDraftService,
    confirmGoalDraft,
    discardGoalDraft,
    runGoalOperation,
    runGoalBudgetOperation,
    increaseGoalBudget: (goalId: string, delta: Partial<GoalBudget>) =>
      runGoalBudgetOperation(() => goalChatService().increaseBudget(goalId, delta)),
    replanGoal: (goalId: string, instructions: string) =>
      runGoalOperation(() => goalChatService().replan(goalId, instructions)),
    retryGoal: (goalId: string) =>
      runGoalOperation(() => goalChatService().retry(goalId)),
    initializeMcpTools,
    getActiveMcpClients: () => activeMcpClients,
    getActiveTaskRunControllers: () => activeTaskRunControllers,
    readToolResultRef,
    runMemoryEvals,
    runAgentQualityEvals,
    selfImprovementService,
    onGoalProgressEvent,
    onAgentRunsChanged,
  };
}

export function reconcileIrreversibleGoalProgressEvent(
  event: GoalProgressEvent,
  goal: Goal | null,
): GoalProgressEvent {
  if (
    !goal ||
    goal.status === event.status ||
    (goal.status !== "achieved" && goal.status !== "canceled")
  ) {
    return event;
  }

  return {
    ...event,
    status: goal.status,
    event: "stopped",
    message: goal.status === "achieved" ? "目标已达成。" : "目标已取消。",
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
