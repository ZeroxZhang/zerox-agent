import {
  BrowserWindow,
  dialog,
  ipcMain,
  type IpcMainInvokeEvent,
} from "electron";
import { randomUUID } from "node:crypto";
import type { AppContainer } from "../container";
import type {
  CancelChatMessageResult,
  ChatStreamEvent,
  ChatSessionOperationResult,
  ChatTaskStatusEvent,
  SendChatMessageInput,
  SendChatMessageResult,
  SkillInputResponse,
  SkillInputResponseResult,
} from "../../shared/chat";
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
import type { ModelSettingsInput, SaveModelSettingsResult } from "../../shared/modelSettings";
import type { AppUpdateActionResult, AppUpdateState } from "../../shared/appUpdate";
import { MemoryValidationError } from "../memoryStore";
import { ModelSettingsValidationError } from "../modelSettingsStore";
import { ScheduledTaskValidationError } from "../taskStore";
import { toChatSendMessageFailure } from "./chatSendMessageError";
import type { AppUpdateService } from "../appUpdateService";

type OpenProjectAgentWorkspaceInput = {
  mode?: "open" | "create";
};

const maximumGoalOperationIdChars = 128;
const safeGoalOperationIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export function registerAllIpcHandlers(
  container: AppContainer,
  options: { appUpdateService?: AppUpdateService } = {},
): void {
  registerAppIpcHandlers(container, options.appUpdateService);
  registerTasksIpcHandlers(container);
  registerToolsIpcHandlers(container);
  registerRunsIpcHandlers(container);
  registerWorkspacesIpcHandlers(container);
  registerMultiAgentIpcHandlers(container);
  registerGoalsIpcHandlers(container);
  registerEvalsIpcHandlers(container);
  registerMemoryIpcHandlers(container);
  registerLearningIpcHandlers(container);
  registerModelSettingsIpcHandlers(container);
  registerChatIpcHandlers(container);
  registerGoalProgressBroadcaster(container);
  registerAgentRunsChangedBroadcaster(container);
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
  ipcMain.handle("app:getMeta", () => container.appMeta);
  ipcMain.handle("app:getRuntimeInfo", () => container.buildDesktopRuntimeInfo());
  ipcMain.handle("app:getUpdateState", (): AppUpdateState =>
    appUpdateService?.getState() ?? {
      phase: "disabled",
      currentVersion: container.buildDesktopRuntimeInfo().version,
      message: "当前运行环境未启用自动更新。",
    },
  );
  ipcMain.handle("app:checkForUpdates", async (): Promise<AppUpdateState> =>
    appUpdateService?.checkForUpdates() ?? {
      phase: "disabled",
      currentVersion: container.buildDesktopRuntimeInfo().version,
      message: "当前运行环境未启用自动更新。",
    },
  );
  ipcMain.handle(
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
  ipcMain.handle("navigation:list", () => container.getNavigationSections());
  ipcMain.handle(
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
  ipcMain.handle(
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
  ipcMain.handle(
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
  ipcMain.handle("skills:list", () => container.discoverSkills());
}

function registerTasksIpcHandlers(container: AppContainer): void {
  ipcMain.handle("scheduledTasks:list", () => container.scheduledTaskStore().list());
  ipcMain.handle(
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
  ipcMain.handle(
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
  ipcMain.handle(
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
  ipcMain.handle(
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
  ipcMain.handle(
    "toolPermissions:authorize",
    (_event, taskId: string, request: ToolCallRequest) =>
      container.toolAuthorizationService().authorize(taskId, request),
  );
  ipcMain.handle("toolAudit:list", () => container.toolAuditLog().list({ limit: 50 }));
  ipcMain.handle(
    "toolResults:readRef",
    async (_event, ref: string, options?: unknown) =>
      container.readToolResultRef(ref, sanitizeReadToolResultRefOptions(options)),
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
  ] as const) {
    if (typeof input[key] === "string") {
      sanitized[key] = input[key];
    }
  }

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function registerRunsIpcHandlers(container: AppContainer): void {
  ipcMain.handle("agentRuns:list", () => container.agentRunStore().list({ limit: 50 }));
  ipcMain.handle("agentRuns:listActiveExecutions", () =>
    container.agentExecutionStore().listActive(),
  );
  ipcMain.handle(
    "agentRuns:listTrajectory",
    (_event, runId: string) => container.agentTrajectoryStore().list(runId),
  );
  ipcMain.handle(
    "agentRuns:openSession",
    async (_event, runId: string): Promise<OpenAgentRunSessionResult> =>
      container.openAgentRunSession(runId),
  );
  ipcMain.handle(
    "agentRuns:runTask",
    async (_event, taskId: string): Promise<RunScheduledTaskResult> =>
      container.runAgentTask(taskId),
  );
  ipcMain.handle(
    "agentRuns:runTaskStreaming",
    async (event: IpcMainInvokeEvent, taskId: string) => {
      const sender = event.sender;

      try {
        const runner = container.agentRunnerService();
        for await (const streamEvent of runner.runTaskStreaming(taskId)) {
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
  ipcMain.handle(
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
  ipcMain.handle(
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
  ipcMain.handle(
    "agentRuns:resume",
    async (_event, runId: string): Promise<RunScheduledTaskResult> =>
      container.resumeAgentRun(runId),
  );
  ipcMain.handle(
    "agentRuns:pause",
    async (_event, runId: string): Promise<PauseAgentRunResult> =>
      container.pauseAgentRun(runId),
  );
}

function registerWorkspacesIpcHandlers(container: AppContainer): void {
  ipcMain.handle("agentWorkspaces:list", () =>
    container.agentWorkspaceService().listWorkspaces(),
  );
  ipcMain.handle("agentWorkspaces:createTemporary", (_event, input) =>
    container.agentWorkspaceService().createTemporaryWorkspace(input),
  );
  ipcMain.handle(
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
  ipcMain.handle("agentWorkspaces:requestGitWorktree", (_event, input) =>
    container.requestGitWorktreeAgentWorkspace(input),
  );
}

function registerMultiAgentIpcHandlers(container: AppContainer): void {
  ipcMain.handle("multiAgentSessions:list", () => container.multiAgentSessionStore().list());
}

function registerGoalsIpcHandlers(container: AppContainer): void {
  ipcMain.handle("goal:listActive", () => container.agentGoalStore().listActive());
  ipcMain.handle("goal:get", (_event, goalId: string) =>
    container.agentGoalStore().get(goalId),
  );
  ipcMain.handle(
    "goal:create",
    async (
      _event,
      input: {
        description: string;
        successCriteria: string[];
        budget: GoalBudget;
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
  ipcMain.handle("goal:start", async (_event, goalId: string) =>
    container.runGoalOperation(goalId, () => container.goalChatService().start(goalId)),
  );
  ipcMain.handle(
    "goalDraft:confirm",
    async (
      _event,
      draftId: string,
      edit?: GoalDraftEdit,
    ): Promise<GoalDraftConfirmResult> =>
      container.confirmGoalDraft(draftId, edit),
  );
  ipcMain.handle(
    "goalDraft:discard",
    async (_event, draftId: string): Promise<GoalDraftDiscardResult> =>
      container.discardGoalDraft(draftId),
  );
  ipcMain.handle("goal:pause", async (_event, goalId: string) =>
    container.runGoalOperation(goalId, () => container.goalChatService().pause(goalId)),
  );
  ipcMain.handle("goal:resume", async (_event, goalId: string) =>
    container.runGoalOperation(goalId, () => container.goalChatService().resume(goalId)),
  );
  ipcMain.handle("goal:cancel", async (_event, goalId: string) =>
    container.runGoalOperation(
      goalId,
      () => container.goalChatService().cancel(goalId),
      { preempt: true },
    ),
  );
  ipcMain.handle(
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
  ipcMain.handle(
    "goal:increaseBudget",
    async (
      _event,
      goalId: string,
      delta: Partial<GoalBudget>,
    ): Promise<{ ok: boolean; goal?: Goal; message?: string }> => {
      return container.increaseGoalBudget(goalId, delta);
    },
  );
  ipcMain.handle(
    "goal:replan",
    async (
      _event,
      goalId: string,
      instructions: string,
    ): Promise<{ ok: boolean; goal?: Goal; message?: string }> => {
      return container.replanGoal(goalId, instructions);
    },
  );
  ipcMain.handle(
    "goal:retry",
    async (_event, goalId: string): Promise<{ ok: boolean; goal?: Goal; message?: string }> => {
      return container.retryGoal(goalId);
    },
  );
  ipcMain.handle(
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
  ipcMain.handle(
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
  ipcMain.handle(
    "agentEvalCandidates:list",
    (_event, options?: AgentEvalCandidateListOptions): Promise<AgentEvalCandidate[]> =>
      container.agentEvalCandidateStore().list(options),
  );
  ipcMain.handle(
    "agentEvalCandidates:generateForRun",
    (_event, runId: string): Promise<GenerateEvalCandidateForRunResult> =>
      container.agentEvalCandidateService().generateForRun(runId),
  );
  ipcMain.handle(
    "agentEvalCandidates:accept",
    (_event, candidateId: string) =>
      container.agentEvalCandidateService().acceptCandidate(candidateId),
  );
  ipcMain.handle(
    "agentEvalCandidates:reject",
    (_event, candidateId: string) =>
      container.agentEvalCandidateService().rejectCandidate(candidateId),
  );
  ipcMain.handle(
    "agentEvalCandidates:promote",
    (_event, candidateId: string): Promise<PromoteEvalCandidateResult> =>
      container.agentEvalCandidateService().promoteAccepted(candidateId),
  );
  ipcMain.handle("agentQuality:getEvalReport", async () =>
    container.runAgentQualityEvals(),
  );
}

function registerMemoryIpcHandlers(container: AppContainer): void {
  ipcMain.handle("memory:list", (_event, options?: MemoryListOptions) =>
    container.memoryStore().list(options),
  );
  ipcMain.handle("memory:search", (_event, options: MemorySearchOptions) =>
    container.memoryStore().search(options),
  );
  ipcMain.handle(
    "memory:ingestRecent",
    (_event, scope?: MemoryIngestionScope): Promise<IngestRecentMemoryResult> =>
      container.memoryIngestionService().ingestRecent(scope),
  );
  ipcMain.handle(
    "memory:getIngestionStatus",
    (): Promise<GetMemoryIngestionStatusResult> =>
      container.memoryIngestionService().getStatus(),
  );
  ipcMain.handle(
    "memory:listIngestionCandidates",
    (): Promise<ListMemoryIngestionCandidatesResult> =>
      container.memoryIngestionService().listCandidates(),
  );
  ipcMain.handle(
    "memory:acceptIngestionCandidate",
    (
      _event,
      candidateId: string,
    ): Promise<AcceptMemoryIngestionCandidateResult> =>
      container.memoryIngestionService().acceptCandidate(candidateId),
  );
  ipcMain.handle(
    "memory:rejectIngestionCandidate",
    (
      _event,
      candidateId: string,
    ): Promise<RejectMemoryIngestionCandidateResult> =>
      container.memoryIngestionService().rejectCandidate(candidateId),
  );
  ipcMain.handle("history:search", (_event, options: RawHistorySearchOptions) =>
    hasRawHistoryScope(options)
      ? container.historyIndexStore().search(options)
      : [],
  );
  ipcMain.handle("history:around", (_event, options: RawHistoryAroundOptions) =>
    hasRawHistoryScope(options)
      ? container.historyIndexStore().around(options)
      : null,
  );
  ipcMain.handle(
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
  ipcMain.handle(
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
  ipcMain.handle("memory:export", () => container.memoryStore().export());
  ipcMain.handle("memory:evaluate", async (): Promise<RunMemoryEvalResult> => {
    const result = await container.runMemoryEvals();
    if (result.ok) {
      return result;
    }
    return {
      ok: false,
      message: result.message,
    };
  });
  ipcMain.handle("memory:governance", async (): Promise<RunMemoryGovernanceResult> => {
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
  ipcMain.handle(
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
  ipcMain.handle(
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
  ipcMain.handle(
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
  ipcMain.handle(
    "learning:listCandidates",
    (_event, options?: AgentLearningListOptions) =>
      container.agentLearningStore().list(options),
  );
  ipcMain.handle("learning:acceptCandidate", (_event, candidateId: string) =>
    container.agentLearningStore().setStatus(candidateId, "accepted"),
  );
  ipcMain.handle("learning:rejectCandidate", (_event, candidateId: string) =>
    container.agentLearningStore().setStatus(candidateId, "rejected"),
  );
  ipcMain.handle("learning:applyAccepted", () =>
    container.agentLearningService().applyAcceptedLearning(),
  );
}

function registerModelSettingsIpcHandlers(container: AppContainer): void {
  ipcMain.handle("modelSettings:load", () => container.modelSettingsStore.load());
  ipcMain.handle(
    "modelSettings:testConnection",
    () => container.modelConnectionService().testConnection(),
  );
  ipcMain.handle(
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

  ipcMain.handle(
    "chat:sendMessage",
    async (
      event: IpcMainInvokeEvent,
      input: SendChatMessageInput,
    ): Promise<SendChatMessageResult> => {
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

      try {
        const completion = container.chatService().sendMessage({
          ...input,
          requestId,
        }, {
          signal: controller.signal,
          onStatusEvent(statusEvent: ChatTaskStatusEvent) {
            if (!sender.isDestroyed()) {
              sender.send("chat:statusEvent", statusEvent);
            }
          },
          onStreamEvent(streamEvent: ChatStreamEvent) {
            if (!sender.isDestroyed()) {
              sender.send("chat:streamEvent", streamEvent);
            }
          },
        });
        activeChatMessageCompletions.set(requestId, completion);
        return await completion;
      } catch (error) {
        return toChatSendMessageFailure(error);
      } finally {
        activeChatMessageControllers.delete(requestId);
        activeChatMessageCompletions.delete(requestId);
      }
    },
  );
  ipcMain.handle(
    "chat:cancelMessage",
    (_event, requestId?: string): CancelChatMessageResult => {
      if (requestId) {
        const controller = activeChatMessageControllers.get(requestId);
        if (controller) {
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

      let canceledCount = 0;
      for (const controller of activeChatMessageControllers.values()) {
        if (!controller.signal.aborted) {
          controller.abort();
          canceledCount += 1;
        }
      }

      if (canceledCount === 0) {
        return {
          ok: false,
          message: "没有正在运行的会话任务。",
        };
      }

      return {
        ok: true,
        message: `已请求中断 ${canceledCount} 个任务。`,
      };
    },
  );
  ipcMain.handle(
    "chat:respondSkillInput",
    async (
      event: IpcMainInvokeEvent,
      input: SkillInputResponse,
    ): Promise<SkillInputResponseResult> => {
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
      try {
        const completion = container.chatService().respondSkillInput(input, {
          signal: controller.signal,
          onStatusEvent(statusEvent: ChatTaskStatusEvent) {
            if (!sender.isDestroyed()) {
              sender.send("chat:statusEvent", statusEvent);
            }
          },
          onStreamEvent(streamEvent: ChatStreamEvent) {
            if (!sender.isDestroyed()) {
              sender.send("chat:streamEvent", streamEvent);
            }
          },
        });
        activeChatMessageCompletions.set(requestId, completion);
        return await completion;
      } catch (error) {
        return toChatSendMessageFailure(error);
      } finally {
        activeChatMessageControllers.delete(requestId);
        activeChatMessageCompletions.delete(requestId);
      }
    },
  );
  ipcMain.handle("chatSessions:list", () => container.listChatSessions());
  ipcMain.handle("chatSessions:get", (_event, sessionId: string) =>
    container.getChatSession(sessionId),
  );
  ipcMain.handle(
    "chatSessions:archive",
    (_event, sessionId: string): Promise<ChatSessionOperationResult> =>
      container.archiveChatSession(sessionId),
  );
  ipcMain.handle(
    "chatSessions:restore",
    (_event, sessionId: string): Promise<ChatSessionOperationResult> =>
      container.restoreChatSession(sessionId),
  );
  ipcMain.handle(
    "chatSessions:rename",
    (_event, sessionId: string, title: string): Promise<ChatSessionOperationResult> =>
      container.renameChatSession(sessionId, title),
  );
  ipcMain.handle(
    "chatSessions:delete",
    (_event, sessionId: string): Promise<ChatSessionOperationResult> =>
      container.deleteChatSession(sessionId),
  );
}
