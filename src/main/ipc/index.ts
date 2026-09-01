import {
  BrowserWindow,
  dialog,
  ipcMain,
  type IpcMainInvokeEvent,
} from "electron";
import { randomUUID } from "node:crypto";
import type { AppContainer } from "../container";
import { IPC_CHANNELS } from "../../shared/ipcChannels";
import type {
  CancelChatMessageResult,
  ChatStreamEvent,
  ChatSessionOperationResult,
  ChatSessionTranscriptPageOptions,
  ChatTaskStatusEvent,
  SendChatMessageInput,
  SendChatMessageResult,
  SkillInputResponse,
  SkillInputResponseResult,
} from "../../shared/chat";
import { createPublicSkillDiscoveryResult } from "../../shared/skills";
import type {
  CancelScheduledTaskRunResult,
  OpenAgentRunSessionResult,
  PauseAgentRunResult,
  RunScheduledTaskResult,
} from "../../shared/agentRuns";
import type {
  CreateScheduledTaskResult,
  DeleteScheduledTaskResult,
  ScheduledTaskInput,
  UpdateScheduledTaskResult,
  UpdateScheduledTaskEnabledResult,
} from "../../shared/scheduledTasks";
import type { ToolCallRequest } from "../../shared/toolPermissions";
import type { ReadToolResultRefOptions } from "../../shared/toolResultRefs";
import type { ConversationSourcePageOptions } from "../../shared/conversationEvidence";
import type {
  CreateMemoryResult,
  DeleteMemoryResult,
  MemoryInput,
  MemoryListOptions,
  MemorySearchOptions,
  RunMemoryMaintenanceResult,
} from "../../shared/memory";
import type { RunMemoryEvalResult } from "../../shared/memoryEval";
import type { RunMemoryGovernanceResult } from "../../shared/memoryGovernance";
import type {
  ReadMemoryProfileResult,
  SaveMemoryProfileResult,
} from "../../shared/memoryProfile";
import type {
  RawHistoryAroundOptions,
  RawHistorySearchOptions,
} from "../../shared/rawHistory";
import type {
  AcceptMemoryIngestionCandidateResult,
  GetMemoryIngestionStatusResult,
  IngestRecentMemoryResult,
  ListMemoryIngestionCandidatesResult,
  MemoryIngestionScope,
  RejectMemoryIngestionCandidateResult,
} from "../../shared/memoryIngestion";
import type { AgentLearningListOptions } from "../../shared/agentLearning";
import type {
  AgentEvalCandidate,
  AgentEvalCandidateListOptions,
  GenerateEvalCandidateForRunResult,
  PromoteEvalCandidateResult,
} from "../../shared/agentEvalCandidate";
import type { Goal, GoalBudget } from "../../shared/agentGoal";
import type { GoalReviewDecision, GoalReviewPolicy } from "../../shared/agentGoalReview";
import type {
  GoalDraftConfirmResult,
  GoalDraftDiscardResult,
  GoalDraftEdit,
} from "../../shared/goalTranslation";
import type {
  LoadAgentValidationResult,
  PrepareAgentResult,
  ValidateAgentResult,
} from "../../shared/agentBootstrap";
import type {
  ModelProfileInput,
  ModelSettingsInput,
  ProviderConnectionInput,
  RevisionedModelResourceInput,
  SaveModelSettingsResult,
  TestAndSaveProviderConnectionResult,
  TestProviderConnectionInput,
} from "../../shared/modelSettings";
import type {
  AdoptGoalPlanInput,
  AdoptGoalPlanResult,
  ConfirmPlanInput,
  ConfirmPlanResult,
  CreateRuntimeGoalPlanResult,
  GoalAmendmentOperationResult,
  ProposeGoalAmendmentInput,
  PlanRecord,
} from "../../shared/planMode";
import type { AppUpdateActionResult, AppUpdateState } from "../../shared/appUpdate";
import { MemoryValidationError } from "../memoryStore";
import { ModelSettingsValidationError } from "../modelSettingsStore";
import { ScheduledTaskValidationError } from "../taskStore";
import { toChatSendMessageFailure } from "./chatSendMessageError";
import type { AppUpdateService } from "../appUpdateService";

type OpenProjectAgentWorkspaceInput = {
  mode?: "open" | "create";
};

type IpcInvokeHandler = Parameters<typeof ipcMain.handle>[1];

export type TrustedIpcInvocationObservation = {
  channel: string;
  ok: boolean;
};

const maximumGoalOperationIdChars = 128;
const safeGoalOperationIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
let trustedRendererSenderGuard:
  | ((event: IpcMainInvokeEvent) => boolean)
  | undefined;
let trustedInvocationObserver:
  | ((observation: TrustedIpcInvocationObservation) => void)
  | undefined;

export function registerAllIpcHandlers(
  container: AppContainer,
  options: {
    isTrustedSender: (event: IpcMainInvokeEvent) => boolean;
    appUpdateService?: AppUpdateService;
    onTrustedInvocation?: (
      observation: TrustedIpcInvocationObservation,
    ) => void;
  },
): void {
  trustedRendererSenderGuard = options.isTrustedSender;
  trustedInvocationObserver = options.onTrustedInvocation;
  registerAppIpcHandlers(container, options.appUpdateService);
  registerTasksIpcHandlers(container);
  registerToolsIpcHandlers(container);
  registerRunsIpcHandlers(container);
  registerWorkspacesIpcHandlers(container);
  registerMultiAgentIpcHandlers(container);
  registerGoalsIpcHandlers(container);
  registerPlansIpcHandlers(container);
  registerEvalsIpcHandlers(container);
  registerMemoryIpcHandlers(container);
  registerLearningIpcHandlers(container);
  registerModelSettingsIpcHandlers(container);
  registerChatIpcHandlers(container);
  registerGoalProgressBroadcaster(container);
  registerAgentRunsChangedBroadcaster(container);
}

function handleTrustedIpc(
  channel: string,
  listener: IpcInvokeHandler,
): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!trustedRendererSenderGuard?.(event)) {
      throw new Error(`Rejected untrusted renderer IPC sender for ${channel}.`);
    }
    try {
      const result = listener(event, ...args);
      if (result && typeof result === "object" && "then" in result) {
        return Promise.resolve(result).then(
          (value) => {
            publishTrustedInvocation({ channel, ok: true });
            return value;
          },
          (error) => {
            publishTrustedInvocation({ channel, ok: false });
            throw error;
          },
        );
      }
      publishTrustedInvocation({ channel, ok: true });
      return result;
    } catch (error) {
      publishTrustedInvocation({ channel, ok: false });
      throw error;
    }
  });
}

function publishTrustedInvocation(
  observation: TrustedIpcInvocationObservation,
): void {
  try {
    trustedInvocationObserver?.(observation);
  } catch {
    // Observability cannot participate in IPC authority or settlement.
  }
}

function registerGoalProgressBroadcaster(container: AppContainer): void {
  container.onGoalProgressEvent((event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send("goal:progressEvent", event);
      }
    }
  });
}

function registerAgentRunsChangedBroadcaster(container: AppContainer): void {
  container.onAgentRunsChanged((event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send("agentRuns:changed", event);
      }
    }
  });
}

function registerAppIpcHandlers(
  container: AppContainer,
  appUpdateService?: AppUpdateService,
): void {
  handleTrustedIpc("app:getMeta", () => container.appMeta);
  handleTrustedIpc("app:getRuntimeInfo", () => container.buildDesktopRuntimeInfo());
  handleTrustedIpc("app:getUpdateState", (): AppUpdateState =>
    appUpdateService?.getState() ?? {
      phase: "disabled",
      currentVersion: container.buildDesktopRuntimeInfo().version,
      message: "当前运行环境未启用自动更新。",
    },
  );
  handleTrustedIpc("app:checkForUpdates", async (): Promise<AppUpdateState> =>
    appUpdateService?.checkForUpdates() ?? {
      phase: "disabled",
      currentVersion: container.buildDesktopRuntimeInfo().version,
      message: "当前运行环境未启用自动更新。",
    },
  );
  handleTrustedIpc(
    "app:installUpdate",
    async (): Promise<AppUpdateActionResult> => {
      if (appUpdateService) {
        return appUpdateService.installDownloadedUpdate();
      }
      const state: AppUpdateState = {
        phase: "disabled",
        currentVersion: container.buildDesktopRuntimeInfo().version,
        message: "当前运行环境未启用自动更新。",
      };
      return { ok: false, state, message: state.message ?? "无法更新。" };
    },
  );
  handleTrustedIpc("navigation:list", () => container.getNavigationSections());
  handleTrustedIpc(
    "agentBootstrap:prepare",
    async (): Promise<PrepareAgentResult> => {
      try {
        return {
          ok: true,
          report: await container.agentBootstrapService().prepare(),
        };
      } catch (error) {
        return {
          ok: false,
          message:
            error instanceof Error ? error.message : "无法准备本地智能体。",
        };
      }
    },
  );
  handleTrustedIpc(
    "agentBootstrap:validate",
    async (): Promise<ValidateAgentResult> => {
      try {
        const report = await container.agentBootstrapService().validate();
        const snapshot =
          (await container.agentBootstrapService().loadLastValidation()) ?? {
            report,
            validatedAt: new Date().toISOString(),
          };
        return {
          ok: true,
          report,
          snapshot,
        };
      } catch (error) {
        return {
          ok: false,
          message:
            error instanceof Error ? error.message : "无法验收运行本地智能体。",
        };
      }
    },
  );
  handleTrustedIpc(
    "agentBootstrap:loadValidation",
    async (): Promise<LoadAgentValidationResult> => {
      try {
        return {
          ok: true,
          snapshot: await container.agentBootstrapService().loadLastValidation(),
        };
      } catch (error) {
        return {
          ok: false,
          message:
            error instanceof Error ? error.message : "无法加载最近验收结果。",
        };
      }
    },
  );
  handleTrustedIpc("skills:list", async () =>
    createPublicSkillDiscoveryResult(await container.discoverSkills()),
  );
}

function registerTasksIpcHandlers(container: AppContainer): void {
  handleTrustedIpc("scheduledTasks:list", () => container.scheduledTaskStore().list());
  handleTrustedIpc(
    "scheduledTasks:create",
    async (
      _event,
      input: ScheduledTaskInput,
    ): Promise<CreateScheduledTaskResult> => {
      try {
        return {
          ok: true,
          task: await container.scheduledTaskStore().create(input),
        };
      } catch (error) {
        if (error instanceof ScheduledTaskValidationError) {
          return {
            ok: false,
            errors: error.errors,
            message: error.message,
          };
        }

        return {
          ok: false,
          errors: {},
          message: error instanceof Error ? error.message : "无法创建任务。",
        };
      }
    },
  );
  handleTrustedIpc(
    "scheduledTasks:setEnabled",
    async (
      _event,
      taskId: string,
      enabled: boolean,
    ): Promise<UpdateScheduledTaskEnabledResult> => {
      try {
        return {
          ok: true,
          task: await container.scheduledTaskStore().setEnabled(taskId, enabled),
        };
      } catch (error) {
        return {
          ok: false,
          message:
            error instanceof Error ? error.message : "无法更新任务状态。",
        };
      }
    },
  );
  handleTrustedIpc(
    "scheduledTasks:update",
    async (
      _event,
      taskId: string,
      input: ScheduledTaskInput,
    ): Promise<UpdateScheduledTaskResult> => {
      try {
        return {
          ok: true,
          task: await container.scheduledTaskStore().update(taskId, input),
        };
      } catch (error) {
        if (error instanceof ScheduledTaskValidationError) {
          return {
            ok: false,
            errors: error.errors,
            message: error.message,
          };
        }

        return {
          ok: false,
          errors: {},
          message: error instanceof Error ? error.message : "无法更新任务。",
        };
      }
    },
  );
  handleTrustedIpc(
    "scheduledTasks:delete",
    async (_event, taskId: string): Promise<DeleteScheduledTaskResult> => {
      try {
        return {
          ok: true,
          deleted: await container.scheduledTaskStore().delete(taskId),
        };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : "无法删除任务。",
        };
      }
    },
  );
}

function registerToolsIpcHandlers(container: AppContainer): void {
  handleTrustedIpc(
    "toolPermissions:authorize",
    (_event, taskId: string, request: ToolCallRequest) =>
      container.toolAuthorizationService().authorize(taskId, request),
  );
  handleTrustedIpc("toolAudit:list", () => container.toolAuditLog().list({ limit: 50 }));
  handleTrustedIpc(
    "toolResults:readRef",
    async (_event, ref: string, options?: unknown) => {
      const trustedEvidence = sanitizeReadToolResultRefOptions(options);
      if (!trustedEvidence?.runId || !trustedEvidence.trajectoryEventId) {
        return { ok: false as const, message: "工具结果引用缺少受信轨迹证据。" };
      }
      return container.readToolResultRef(ref, trustedEvidence);
    },
  );
}

function sanitizeReadToolResultRefOptions(
  options: unknown,
): ReadToolResultRefOptions | undefined {
  if (!options || typeof options !== "object") {
    return undefined;
  }

  const input = options as Record<string, unknown>;
  const sanitized: ReadToolResultRefOptions = {};
  for (const key of [
    "runId",
    "sessionId",
    "requestId",
    "workspaceRunId",
    "trajectoryEventId",
  ] as const) {
    if (typeof input[key] === "string") {
      sanitized[key] = input[key];
    }
  }

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function registerRunsIpcHandlers(container: AppContainer): void {
  handleTrustedIpc("agentRuns:list", () => container.agentRunStore().list({ limit: 50 }));
  handleTrustedIpc("agentRuns:listActiveExecutions", () =>
    container.agentExecutionStore().listActive(),
  );
  handleTrustedIpc(
    "agentRuns:listTrajectory",
    (_event, runId: string) => container.agentTrajectoryStore().list(runId),
  );
  handleTrustedIpc(
    "agentRuns:getTrajectoryPage",
    (_event, runId: string, options?: unknown) => {
      const store = container.agentTrajectoryStore();
      if (!store.getPage) {
        throw new Error("Agent trajectory paging is unavailable.");
      }
      return store.getPage(runId, sanitizeTrajectoryPageOptions(options));
    },
  );
  handleTrustedIpc(
    "agentRuns:openSession",
    async (_event, runId: string): Promise<OpenAgentRunSessionResult> =>
      container.openAgentRunSession(runId),
  );
  handleTrustedIpc(
    "agentRuns:runTask",
    async (_event, taskId: string): Promise<RunScheduledTaskResult> =>
      container.runAgentTask(taskId),
  );
  handleTrustedIpc(
    "agentRuns:runTaskStreaming",
    async (event: IpcMainInvokeEvent, taskId: string) => {
      const sender = event.sender;

      try {
        for await (const streamEvent of container.runAgentTaskStreaming(taskId)) {
          if (sender.isDestroyed()) break;
          sender.send("agent:streamEvent", streamEvent);
        }
      } catch (error) {
        if (!sender.isDestroyed()) {
          sender.send("agent:streamEvent", {
            level: "error" as const,
            message: error instanceof Error ? error.message : "流式运行失败",
            createdAt: new Date().toISOString(),
          });
        }
      }
    },
  );
  handleTrustedIpc(
    "agentRuns:cancelTask",
    (_event, taskId: string): CancelScheduledTaskRunResult => {
      const controller = container.getActiveTaskRunControllers().get(taskId);

      if (!controller) {
        return {
          ok: false,
          message: "这个任务当前没有正在运行。",
        };
      }

      controller.abort();
      return {
        ok: true,
        message: "已请求停止运行。",
      };
    },
  );
  handleTrustedIpc(
    "agentRuns:retry",
    async (_event, runId: string): Promise<RunScheduledTaskResult> => {
      const run = await container.agentRunStore().get(runId);

      if (!run) {
        return {
          ok: false,
          message: "运行记录不存在，无法重试。",
        };
      }

      return container.runAgentTask(run.taskId);
    },
  );
  handleTrustedIpc(
    "agentRuns:resume",
    async (_event, runId: string): Promise<RunScheduledTaskResult> =>
      container.resumeAgentRun(runId),
  );
  handleTrustedIpc(
    "agentRuns:pause",
    async (_event, runId: string): Promise<PauseAgentRunResult> =>
      container.pauseAgentRun(runId),
  );
}

function sanitizeTrajectoryPageOptions(
  options: unknown,
): ConversationSourcePageOptions | undefined {
  if (!options || typeof options !== "object") return undefined;
  const input = options as Record<string, unknown>;
  const sanitized: ConversationSourcePageOptions = {};
  if (typeof input.cursor === "string") {
    sanitized.cursor = input.cursor;
  }
  if (typeof input.limit === "number" && Number.isFinite(input.limit)) {
    sanitized.limit = input.limit;
  }
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function registerWorkspacesIpcHandlers(container: AppContainer): void {
  handleTrustedIpc("agentWorkspaces:list", () =>
    container.agentWorkspaceService().listWorkspaces(),
  );
  handleTrustedIpc("agentWorkspaces:createTemporary", (_event, input) =>
    container.agentWorkspaceService().createTemporaryWorkspace(input),
  );
  handleTrustedIpc(
    "agentWorkspaces:openProject",
    async (_event, input?: OpenProjectAgentWorkspaceInput) => {
      const isCreateMode = input?.mode === "create";
      const result = await dialog.showOpenDialog({
        title: isCreateMode ? "新建工作区" : "打开工作区",
        buttonLabel: isCreateMode ? "选择工作区" : "打开工作区",
        properties: [
          "openDirectory",
          "createDirectory",
          "promptToCreate",
        ],
      });
      const rootPath = result.filePaths[0];
      if (result.canceled || !rootPath) {
        return null;
      }

      return container.agentWorkspaceService().createProjectWorkspace({
        rootPath,
      });
    },
  );
  handleTrustedIpc("agentWorkspaces:requestGitWorktree", (_event, input) =>
    container.requestGitWorktreeAgentWorkspace(input),
  );
}

function registerMultiAgentIpcHandlers(container: AppContainer): void {
  handleTrustedIpc("multiAgentSessions:list", () => container.multiAgentSessionStore().list());
}

function registerGoalsIpcHandlers(container: AppContainer): void {
  handleTrustedIpc("goal:listActive", () => container.agentGoalStore().listActive());
  handleTrustedIpc("goal:get", (_event, goalId: string) =>
    container.agentGoalStore().get(goalId),
  );
  handleTrustedIpc(
    "goal:create",
    async (
      _event,
      input: {
        description: string;
        successCriteria: string[];
        /** @deprecated Ignored by the runtime. */
        budget?: GoalBudget;
        reviewPolicy: GoalReviewPolicy;
      },
    ): Promise<{ ok: boolean; goal?: Goal; message?: string }> => {
      try {
        const goal = container.createGoalDraft(input);
        await container.agentGoalStore().save(goal);
        await container.agentGoalStore().appendLedger(goal.id, {
          at: goal.createdAt,
          kind: "goal_planned",
          summary: "Goal created and ready for planning.",
        });
        return { ok: true, goal };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : "无法创建目标。",
        };
      }
    },
  );
  handleTrustedIpc("goal:start", async (_event, goalId: string) =>
    container.runGoalOperation(goalId, () => container.goalChatService().start(goalId)),
  );
  handleTrustedIpc(
    "goalDraft:confirm",
    async (
      _event,
      draftId: string,
      edit?: GoalDraftEdit,
    ): Promise<GoalDraftConfirmResult> =>
      container.confirmGoalDraft(draftId, edit),
  );
  handleTrustedIpc(
    "goalDraft:discard",
    async (_event, draftId: string): Promise<GoalDraftDiscardResult> =>
      container.discardGoalDraft(draftId),
  );
  handleTrustedIpc("goal:pause", async (_event, goalId: string) =>
    container.runGoalOperation(goalId, () => container.goalChatService().pause(goalId)),
  );
  handleTrustedIpc("goal:resume", async (_event, goalId: string) =>
    container.runGoalOperation(goalId, () => container.goalChatService().resume(goalId)),
  );
  handleTrustedIpc("goal:cancel", async (_event, goalId: string) =>
    container.runGoalOperation(
      goalId,
      () => container.goalChatService().cancel(goalId),
      { preempt: true },
    ),
  );
  handleTrustedIpc(
    "goal:resolveReview",
    async (
      _event,
      goalId: string,
      decision: GoalReviewDecision,
    ): Promise<{ ok: boolean; goal?: Goal; message?: string }> => {
      return container.runGoalOperation(goalId, () =>
        container.goalChatService().resolveReview(goalId, decision),
      );
    },
  );
  handleTrustedIpc(
    "goal:increaseBudget",
    async (): Promise<{ ok: false; message: string }> => ({
      ok: false,
      message: "budget_control_removed",
    }),
  );
  handleTrustedIpc(
    "goal:replan",
    async (
      _event,
      goalId: string,
      instructions: string,
    ): Promise<CreateRuntimeGoalPlanResult> => {
      return container.replanGoal(goalId, instructions);
    },
  );
  handleTrustedIpc(
    "goal:retry",
    async (_event, goalId: string): Promise<{ ok: boolean; goal?: Goal; message?: string }> => {
      return container.retryGoal(goalId);
    },
  );
  handleTrustedIpc(
    "goal:proposeAmendment",
    (
      _event,
      input: ProposeGoalAmendmentInput,
    ): Promise<GoalAmendmentOperationResult> =>
      container.proposeGoalAmendment(input),
  );
  handleTrustedIpc(
    "goal:resolveAmendment",
    (
      _event,
      goalId: string,
      proposalId: string,
      decision: "approve" | "reject",
    ): Promise<GoalAmendmentOperationResult> =>
      container.resolveGoalAmendment(goalId, proposalId, decision),
  );
  handleTrustedIpc(
    "goal:continueAcceptance",
    async (
      _event,
      goalId: unknown,
    ): Promise<{ ok: boolean; goal?: Goal; message?: string }> => {
      if (!isSafeGoalOperationId(goalId)) {
        return invalidGoalOperationIdResult();
      }
      return container.continueGoalAcceptance(goalId);
    },
  );
  handleTrustedIpc(
    "goal:markCompletedUnverified",
    async (
      _event,
      goalId: unknown,
    ): Promise<{ ok: boolean; goal?: Goal; message?: string }> => {
      if (!isSafeGoalOperationId(goalId)) {
        return invalidGoalOperationIdResult();
      }
      return container.markGoalCompletedUnverified(goalId);
    },
  );
}

function registerPlansIpcHandlers(container: AppContainer): void {
  handleContentFreePlanIpc(
    "plans:get",
    (_event, planId: string) => container.planStore().get(planId),
    "计划存储读取失败。",
  );
  handleContentFreePlanIpc(
    "plans:getLatestBySession",
    async (_event, sessionId: string) => {
      const plan = await container.planStore().getLatestBySession(sessionId);
      if (
        plan &&
        (plan.status === "awaiting_confirmation" ||
          plan.status === "awaiting_input")
      ) {
        await persistPlanStatusSummaryIfNeeded(container, plan, false);
      }
      return plan;
    },
    "计划存储读取失败。",
  );
  handleContentFreePlanIpc(
    "plans:retryFailedRound",
    async (
      _event,
      planId: string,
      replacementProfileId?: string,
      autonomyMode?: PlanRecord["autonomyMode"],
    ) => {
      const result = await container
        .planDebateOrchestrator()
        .retryFailedRound(
          planId,
          replacementProfileId,
          undefined,
          autonomyMode,
        );
      if (!result.ok) {
        return result;
      }

      await persistPlanStatusSummaryIfNeeded(container, result.plan, true);
      return result;
    },
  );
  handleContentFreePlanIpc(
    "plans:discard",
    (_event, planId: string, expectedRevision: number) =>
      container.discardPlan(planId, expectedRevision),
  );
  handleContentFreePlanIpc(
    "plans:confirm",
    (
      _event,
      input: ConfirmPlanInput,
    ): Promise<ConfirmPlanResult> => container.confirmPlan(input),
  );
  handleContentFreePlanIpc(
    "plans:adoptGoalPlan",
    (
      _event,
      input: AdoptGoalPlanInput,
    ): Promise<AdoptGoalPlanResult> => container.adoptGoalPlan(input),
  );
}

function handleContentFreePlanIpc(
  channel: string,
  listener: IpcInvokeHandler,
  failureMessage = "计划操作失败。",
): void {
  handleTrustedIpc(channel, async (event, ...args) => {
    try {
      return await listener(event, ...args);
    } catch {
      throw new Error(failureMessage);
    }
  });
}

async function persistPlanStatusSummaryIfNeeded(
  container: AppContainer,
  plan: PlanRecord,
  force: boolean,
): Promise<boolean> {
  const goalEventRef = `plan-retry:${plan.id}:${plan.revision}`;
  const session = await container.chatSessionStore().get(plan.sessionId);
  if (
    !session ||
    session.messages.some((message) => message.goalEventRef === goalEventRef)
  ) {
    return false;
  }
  const latestAssistant = [...session.messages]
    .reverse()
    .find((message) => message.role === "assistant");
  const hasStaleFailure =
    latestAssistant?.content.includes("计划已暂停") ||
    latestAssistant?.content.includes("规划输出缺少");
  if (!force && !hasStaleFailure) {
    return false;
  }

  await container.chatSessionStore().appendMessage({
    sessionId: plan.sessionId,
    role: "assistant",
    content: formatPlanRetryMessage(plan),
    goalEventRef,
  });
  return true;
}

function formatPlanRetryMessage(plan: PlanRecord): string {
  const title =
    plan.finalArtifact?.title?.trim() ||
    plan.taskContract.objective.trim() ||
    "当前计划";
  if (plan.status === "awaiting_confirmation") {
    return `规划已恢复，终版计划「${title}」已就绪，等待确认后开始执行。`;
  }
  if (plan.status === "awaiting_input") {
    const reason =
      plan.finalArtifact?.gateReason?.trim() ||
      plan.finalArtifact?.unresolvedQuestions[0]?.trim() ||
      "仍有必要信息需要补充。";
    return `规划辩论已完成，仍需补充信息：${reason}`;
  }
  if (plan.status === "paused" || plan.status === "failed") {
    return "计划重试后仍暂停；原始诊断内容未写入聊天记录，请检查失败轮次后再次重试。";
  }
  return `已从失败轮次继续规划：${title}。`;
}

function isSafeGoalOperationId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumGoalOperationIdChars &&
    value === value.trim() &&
    !value.includes("..") &&
    safeGoalOperationIdPattern.test(value)
  );
}

function invalidGoalOperationIdResult(): { ok: false; message: string } {
  return { ok: false, message: "目标 ID 无效。" };
}

function registerEvalsIpcHandlers(container: AppContainer): void {
  handleTrustedIpc(
    "agentEvalCandidates:list",
    (_event, options?: AgentEvalCandidateListOptions): Promise<AgentEvalCandidate[]> =>
      container.agentEvalCandidateStore().list(options),
  );
  handleTrustedIpc(
    "agentEvalCandidates:generateForRun",
    (_event, runId: string): Promise<GenerateEvalCandidateForRunResult> =>
      container.agentEvalCandidateService().generateForRun(runId),
  );
  handleTrustedIpc(
    "agentEvalCandidates:accept",
    (_event, candidateId: string) =>
      container.agentEvalCandidateService().acceptCandidate(candidateId),
  );
  handleTrustedIpc(
    "agentEvalCandidates:reject",
    (_event, candidateId: string) =>
      container.agentEvalCandidateService().rejectCandidate(candidateId),
  );
  handleTrustedIpc(
    "agentEvalCandidates:promote",
    (_event, candidateId: string): Promise<PromoteEvalCandidateResult> =>
      container.agentEvalCandidateService().promoteAccepted(candidateId),
  );
  handleTrustedIpc("agentQuality:getEvalReport", async () =>
    container.runAgentQualityEvals(),
  );
}

function registerMemoryIpcHandlers(container: AppContainer): void {
  handleTrustedIpc("memory:list", (_event, options?: MemoryListOptions) =>
    container.memoryStore().list(options),
  );
  handleTrustedIpc("memory:search", (_event, options: MemorySearchOptions) =>
    container.memoryStore().search(options),
  );
  handleTrustedIpc(
    "memory:ingestRecent",
    (_event, scope?: MemoryIngestionScope): Promise<IngestRecentMemoryResult> =>
      container.memoryIngestionService().ingestRecent(scope),
  );
  handleTrustedIpc(
    "memory:getIngestionStatus",
    (): Promise<GetMemoryIngestionStatusResult> =>
      container.memoryIngestionService().getStatus(),
  );
  handleTrustedIpc(
    "memory:listIngestionCandidates",
    (): Promise<ListMemoryIngestionCandidatesResult> =>
      container.memoryIngestionService().listCandidates(),
  );
  handleTrustedIpc(
    "memory:acceptIngestionCandidate",
    (
      _event,
      candidateId: string,
    ): Promise<AcceptMemoryIngestionCandidateResult> =>
      container.memoryIngestionService().acceptCandidate(candidateId),
  );
  handleTrustedIpc(
    "memory:rejectIngestionCandidate",
    (
      _event,
      candidateId: string,
    ): Promise<RejectMemoryIngestionCandidateResult> =>
      container.memoryIngestionService().rejectCandidate(candidateId),
  );
  handleTrustedIpc("history:search", (_event, options: RawHistorySearchOptions) =>
    hasRawHistoryScope(options)
      ? container.historyIndexStore().search(options)
      : [],
  );
  handleTrustedIpc("history:around", (_event, options: RawHistoryAroundOptions) =>
    hasRawHistoryScope(options)
      ? container.historyIndexStore().around(options)
      : null,
  );
  handleTrustedIpc(
    "memory:create",
    async (_event, input: MemoryInput): Promise<CreateMemoryResult> => {
      try {
        return {
          ok: true,
          memory: await container.memoryStore().create(input),
        };
      } catch (error) {
        if (error instanceof MemoryValidationError) {
          return {
            ok: false,
            errors: error.errors,
            message: error.message,
          };
        }

        return {
          ok: false,
          errors: {},
          message: error instanceof Error ? error.message : "无法创建记忆。",
        };
      }
    },
  );
  handleTrustedIpc(
    "memory:delete",
    async (_event, memoryId: string): Promise<DeleteMemoryResult> => {
      try {
        return {
          ok: true,
          deleted: await container.memoryStore().delete(memoryId),
        };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : "无法删除记忆。",
        };
      }
    },
  );
  handleTrustedIpc("memory:export", () => container.memoryStore().export());
  handleTrustedIpc("memory:evaluate", async (): Promise<RunMemoryEvalResult> => {
    const result = await container.runMemoryEvals();
    if (result.ok) {
      return result;
    }
    return {
      ok: false,
      message: result.message,
    };
  });
  handleTrustedIpc("memory:governance", async (): Promise<RunMemoryGovernanceResult> => {
    try {
      return {
        ok: true,
        report: await container.memoryStore().reviewGovernance(),
      };
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error ? error.message : "无法生成记忆治理报告。",
      };
    }
  });
  handleTrustedIpc(
    "memoryProfile:read",
    async (): Promise<ReadMemoryProfileResult> => {
      try {
        return {
          ok: true,
          profile: await container.memoryProfileStore().read(),
        };
      } catch (error) {
        return {
          ok: false,
          message:
            error instanceof Error ? error.message : "无法读取记忆画像。",
        };
      }
    },
  );
  handleTrustedIpc(
    "memoryProfile:save",
    async (_event, content: string): Promise<SaveMemoryProfileResult> => {
      try {
        return {
          ok: true,
          profile: await container.memoryProfileStore().save(content),
        };
      } catch (error) {
        return {
          ok: false,
          message:
            error instanceof Error ? error.message : "无法保存记忆画像。",
        };
      }
    },
  );
  handleTrustedIpc(
    "memory:maintain",
    async (): Promise<RunMemoryMaintenanceResult> => {
      try {
        return {
          ok: true,
          report: await container.memoryStore().runMaintenance(),
        };
      } catch (error) {
        return {
          ok: false,
          message:
            error instanceof Error ? error.message : "无法运行记忆整理。",
        };
      }
    },
  );
}

function hasRawHistoryScope(
  options: Partial<RawHistorySearchOptions & RawHistoryAroundOptions> | undefined,
): boolean {
  return Boolean(options?.workspaceId || options?.sessionId);
}

function registerLearningIpcHandlers(container: AppContainer): void {
  handleTrustedIpc(
    "learning:listCandidates",
    (_event, options?: AgentLearningListOptions) =>
      container.agentLearningStore().list(options),
  );
  handleTrustedIpc("learning:acceptCandidate", (_event, candidateId: string) =>
    container.agentLearningStore().setStatus(candidateId, "accepted"),
  );
  handleTrustedIpc("learning:rejectCandidate", (_event, candidateId: string) =>
    container.agentLearningStore().setStatus(candidateId, "rejected"),
  );
  handleTrustedIpc("learning:applyAccepted", () =>
    container.agentLearningService().applyAcceptedLearning(),
  );
}

function registerModelSettingsIpcHandlers(container: AppContainer): void {
  handleTrustedIpc("modelSettings:load", () => container.modelSettingsStore.load());
  handleTrustedIpc("modelCatalog:load", async () =>
    container
      .modelConnectionService()
      .enrichCatalog(await container.modelSettingsStore.loadCatalog()),
  );
  handleTrustedIpc(
    "modelCatalog:saveConnection",
    async (_event, input: ProviderConnectionInput) => {
      const result = await container.modelSettingsStore.saveConnection(input);
      if (result.ok) {
        container.modelRouter().invalidate(result.connection.id);
        return {
          ...result,
          catalog: await container
            .modelConnectionService()
            .enrichCatalog(result.catalog),
        };
      }
      return result;
    },
  );
  handleTrustedIpc(
    "modelCatalog:testAndSaveConnection",
    async (
      _event,
      input: ProviderConnectionInput,
    ): Promise<TestAndSaveProviderConnectionResult> => {
      const result = await container
        .modelConnectionService()
        .testAndSaveProvider(input);
      if (result.ok) {
        container.modelRouter().invalidate(result.connection.id);
      }
      return result;
    },
  );
  handleTrustedIpc(
    "modelCatalog:clearConnectionCredential",
    async (_event, input: RevisionedModelResourceInput) => {
      const result =
        await container.modelSettingsStore.clearConnectionCredential(
          input,
        );
      if (result.ok) {
        container.modelRouter().invalidate(input.id);
        return {
          ...result,
          catalog: await container
            .modelConnectionService()
            .enrichCatalog(result.catalog),
        };
      }
      return result;
    },
  );
  handleTrustedIpc(
    "modelCatalog:deleteConnection",
    async (_event, input: RevisionedModelResourceInput) => {
      const result =
        await container.modelSettingsStore.deleteConnection(input);
      if (result.ok) {
        container.modelRouter().invalidate(input.id);
      }
      return result.ok
        ? {
            ...result,
            catalog: await container
              .modelConnectionService()
              .enrichCatalog(result.catalog),
          }
        : result;
    },
  );
  handleTrustedIpc(
    "modelCatalog:saveProfile",
    async (_event, input: ModelProfileInput) => {
      const result = await container.modelSettingsStore.saveProfile(input);
      if (result.ok) {
        container.modelRouter().invalidate(
          result.catalog.connections.find(
            (connection) => connection.id === result.profile.connectionId,
          )?.id,
        );
        return {
          ...result,
          catalog: await container
            .modelConnectionService()
            .enrichCatalog(result.catalog),
        };
      }
      return result;
    },
  );
  handleTrustedIpc(
    "modelCatalog:deleteProfile",
    async (_event, input: RevisionedModelResourceInput) => {
      const result = await container.modelSettingsStore.deleteProfile(input);
      return result.ok
        ? {
            ...result,
            catalog: await container
              .modelConnectionService()
              .enrichCatalog(result.catalog),
          }
        : result;
    },
  );
  handleTrustedIpc(
    "modelCatalog:setDefaultProfile",
    async (
      _event,
      purpose: "chat" | "embedding",
      profileId: string | null,
    ) => {
      const result = await container.modelSettingsStore.setDefaultProfile(
        purpose,
        profileId,
      );
      return result.ok
        ? {
            ...result,
            catalog: await container
              .modelConnectionService()
              .enrichCatalog(result.catalog),
          }
        : result;
    },
  );
  handleTrustedIpc(
    "modelCatalog:setModelHidden",
    async (_event, routedModelId: string, hidden: boolean) => {
      const result = await container.modelSettingsStore.setModelHidden(
        routedModelId,
        hidden,
      );
      return result.ok
        ? {
            ...result,
            catalog: await container
              .modelConnectionService()
              .enrichCatalog(result.catalog),
          }
        : result;
    },
  );
  handleTrustedIpc(
    "modelCatalog:testProvider",
    (_event, input: TestProviderConnectionInput) =>
      container.modelConnectionService().testProvider(input),
  );
  handleTrustedIpc(
    "modelSettings:testConnection",
    () => container.modelConnectionService().testConnection(),
  );
  handleTrustedIpc(
    "modelSettings:save",
    async (_event, input: ModelSettingsInput): Promise<SaveModelSettingsResult> => {
      try {
        return {
          ok: true,
          settings: await container.modelSettingsStore.save(input),
        };
      } catch (error) {
        if (error instanceof ModelSettingsValidationError) {
          return {
            ok: false,
            errors: error.errors,
            message: error.message,
          };
        }

        return {
          ok: false,
          errors: {},
          message:
            error instanceof Error ? error.message : "无法保存模型配置。",
        };
      }
    },
  );
}

const activeChatMessageControllers = new Map<string, AbortController>();
const activeChatMessageOwnerIds = new Map<string, number>();
const activeChatMessageCompletions = new Map<
  string,
  Promise<unknown>
>();
let acceptingChatMessages = true;

export async function shutdownActiveChatMessages(): Promise<number> {
  acceptingChatMessages = false;
  const controllers = [...activeChatMessageControllers.values()];
  for (const controller of controllers) {
    if (!controller.signal.aborted) {
      controller.abort("application_shutdown");
    }
  }
  await Promise.allSettled([...activeChatMessageCompletions.values()]);
  return controllers.length;
}

function registerChatIpcHandlers(container: AppContainer): void {
  acceptingChatMessages = true;

  handleTrustedIpc(
    IPC_CHANNELS.chatSendMessage,
    async (
      event: IpcMainInvokeEvent,
      input: SendChatMessageInput,
    ): Promise<SendChatMessageResult> => {
      if (!isSendChatMessageInput(input)) {
        return {
          ok: false,
          code: "INTERNAL_ERROR",
          message: "消息请求格式无效。",
        };
      }
      const sender = event.sender;
      const requestId = input.requestId ?? randomUUID();
      if (!acceptingChatMessages) {
        return { ok: false, message: "应用正在退出，未接收新的会话请求。" };
      }
      if (activeChatMessageControllers.has(requestId)) {
        return {
          ok: false,
          message: `请求 ${requestId} 已在执行，请等待完成或先取消。`,
        };
      }
      const controller = new AbortController();
      activeChatMessageControllers.set(requestId, controller);
      activeChatMessageOwnerIds.set(requestId, sender.id);

      try {
        const completion = container.chatService().sendMessage({
          ...input,
          requestId,
        }, {
          signal: controller.signal,
          onStatusEvent(statusEvent: ChatTaskStatusEvent) {
            if (!sender.isDestroyed()) {
              sender.send(IPC_CHANNELS.chatStatusEvent, statusEvent);
            }
          },
          onStreamEvent(streamEvent: ChatStreamEvent) {
            if (!sender.isDestroyed()) {
              sender.send(IPC_CHANNELS.chatStreamEvent, streamEvent);
            }
          },
        });
        activeChatMessageCompletions.set(requestId, completion);
        return await completion;
      } catch (error) {
        return toChatSendMessageFailure(error);
      } finally {
        activeChatMessageControllers.delete(requestId);
        activeChatMessageOwnerIds.delete(requestId);
        activeChatMessageCompletions.delete(requestId);
      }
    },
  );
  handleTrustedIpc(
    IPC_CHANNELS.chatCancelMessage,
    (event, requestId?: string): CancelChatMessageResult => {
      if (typeof requestId === "string" && requestId.trim()) {
        const controller = activeChatMessageControllers.get(requestId);
        const ownerId = activeChatMessageOwnerIds.get(requestId);
        if (controller && ownerId === event.sender.id) {
          controller.abort();
          return {
            ok: true,
            message: "已请求中断任务。",
          };
        }
        return {
          ok: false,
          message: `没有找到请求 ${requestId}。`,
        };
      }

      return {
        ok: false,
        message: "缺少要中断的请求 ID，未停止任何任务。",
      };
    },
  );
  handleTrustedIpc(
    IPC_CHANNELS.chatRespondSkillInput,
    async (
      event: IpcMainInvokeEvent,
      input: SkillInputResponse,
    ): Promise<SkillInputResponseResult> => {
      if (!isSkillInputResponse(input)) {
        return {
          ok: false,
          code: "INTERNAL_ERROR",
          message: "技能输入响应格式无效。",
        };
      }
      const sender = event.sender;
      const requestId = input.requestId?.trim() || `skill-input:${input.inputRequestId}`;
      if (!acceptingChatMessages) {
        return { ok: false, message: "应用正在退出，未接收新的技能续跑请求。" };
      }
      if (activeChatMessageControllers.has(requestId)) {
        return {
          ok: false,
          message: "Skill input response already in progress.",
        };
      }
      const controller = new AbortController();
      activeChatMessageControllers.set(requestId, controller);
      activeChatMessageOwnerIds.set(requestId, sender.id);
      try {
        const completion = container.chatService().respondSkillInput(input, {
          signal: controller.signal,
          onStatusEvent(statusEvent: ChatTaskStatusEvent) {
            if (!sender.isDestroyed()) {
              sender.send(IPC_CHANNELS.chatStatusEvent, statusEvent);
            }
          },
          onStreamEvent(streamEvent: ChatStreamEvent) {
            if (!sender.isDestroyed()) {
              sender.send(IPC_CHANNELS.chatStreamEvent, streamEvent);
            }
          },
        });
        activeChatMessageCompletions.set(requestId, completion);
        return await completion;
      } catch (error) {
        return toChatSendMessageFailure(error);
      } finally {
        activeChatMessageControllers.delete(requestId);
        activeChatMessageOwnerIds.delete(requestId);
        activeChatMessageCompletions.delete(requestId);
      }
    },
  );
  handleTrustedIpc("chatSessions:list", () => container.listChatSessions());
  handleTrustedIpc("chatSessions:get", (_event, sessionId: string) =>
    container.getChatSession(sessionId),
  );
  handleTrustedIpc(
    "chatSessions:getTranscriptPage",
    (
      _event,
      sessionId: string,
      options?: ChatSessionTranscriptPageOptions,
    ) => container.getChatSessionTranscriptPage(sessionId, options),
  );
  handleTrustedIpc(
    "chatSessions:archive",
    (_event, sessionId: string): Promise<ChatSessionOperationResult> =>
      container.archiveChatSession(sessionId),
  );
  handleTrustedIpc(
    "chatSessions:restore",
    (_event, sessionId: string): Promise<ChatSessionOperationResult> =>
      container.restoreChatSession(sessionId),
  );
  handleTrustedIpc(
    "chatSessions:rename",
    (_event, sessionId: string, title: string): Promise<ChatSessionOperationResult> =>
      container.renameChatSession(sessionId, title),
  );
  handleTrustedIpc(
    "chatSessions:delete",
    (_event, sessionId: string): Promise<ChatSessionOperationResult> =>
      container.deleteChatSession(sessionId),
  );
}

function isSendChatMessageInput(value: unknown): value is SendChatMessageInput {
  if (!isPlainRecord(value) || typeof value.message !== "string") {
    return false;
  }
  for (const key of ["sessionId", "requestId", "selectedSkillName", "workspaceId"] as const) {
    if (value[key] !== undefined && typeof value[key] !== "string") {
      return false;
    }
  }
  if (value.history !== undefined && !Array.isArray(value.history)) {
    return false;
  }
  if (value.attachments !== undefined && !Array.isArray(value.attachments)) {
    return false;
  }
  return true;
}

function isSkillInputResponse(value: unknown): value is SkillInputResponse {
  return (
    isPlainRecord(value) &&
    typeof value.inputRequestId === "string" &&
    (value.requestId === undefined || typeof value.requestId === "string") &&
    isPlainRecord(value.values) &&
    Object.values(value.values).every(
      (entry) =>
        typeof entry === "string" ||
        typeof entry === "boolean" ||
        (typeof entry === "number" && Number.isFinite(entry)),
    )
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
