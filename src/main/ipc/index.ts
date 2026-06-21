import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from "electron";
import { randomUUID } from "node:crypto";
import type { AppContainer } from "../container";
import type {
  CancelChatMessageResult,
  ChatSessionOperationResult,
  ChatTaskStatusEvent,
  SendChatMessageInput,
  SendChatMessageResult,
} from "../../shared/chat";
import type {
  CancelScheduledTaskRunResult,
  PauseAgentRunResult,
  RunScheduledTaskResult,
} from "../../shared/agentRuns";
import type {
  CreateScheduledTaskResult,
  DeleteScheduledTaskResult,
  ScheduledTaskInput,
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
  LoadAgentValidationResult,
  PrepareAgentResult,
  ValidateAgentResult,
} from "../../shared/agentBootstrap";
import type { ModelSettingsInput, SaveModelSettingsResult } from "../../shared/modelSettings";
import { MemoryValidationError } from "../memoryStore";
import { ModelSettingsValidationError } from "../modelSettingsStore";
import { ScheduledTaskValidationError } from "../taskStore";
import { toChatSendMessageFailure } from "./chatSendMessageError";

export function registerAllIpcHandlers(container: AppContainer): void {
  registerAppIpcHandlers(container);
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

function registerAppIpcHandlers(container: AppContainer): void {
  ipcMain.handle("app:getMeta", () => container.appMeta);
  ipcMain.handle("app:getRuntimeInfo", () => container.buildDesktopRuntimeInfo());
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
    container.runGoalOperation(() => container.goalChatService().start(goalId)),
  );
  ipcMain.handle("goal:pause", async (_event, goalId: string) =>
    container.runGoalOperation(() => container.goalChatService().pause(goalId)),
  );
  ipcMain.handle("goal:resume", async (_event, goalId: string) =>
    container.runGoalOperation(() => container.goalChatService().resume(goalId)),
  );
  ipcMain.handle("goal:cancel", async (_event, goalId: string) =>
    container.runGoalOperation(() => container.goalChatService().cancel(goalId)),
  );
  ipcMain.handle(
    "goal:resolveReview",
    async (
      _event,
      goalId: string,
      decision: GoalReviewDecision,
    ): Promise<{ ok: boolean; goal?: Goal; message?: string }> => {
      return container.runGoalOperation(() =>
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

function registerChatIpcHandlers(container: AppContainer): void {
  const activeChatMessageControllers = new Map<string, AbortController>();

  ipcMain.handle(
    "chat:sendMessage",
    async (
      event: IpcMainInvokeEvent,
      input: SendChatMessageInput,
    ): Promise<SendChatMessageResult> => {
      const sender = event.sender;
      const requestId = input.requestId ?? randomUUID();
      const controller = new AbortController();
      activeChatMessageControllers.set(requestId, controller);

      try {
        return await container.chatService().sendMessage(input, {
          signal: controller.signal,
          onStatusEvent(statusEvent: ChatTaskStatusEvent) {
            if (!sender.isDestroyed()) {
              sender.send("chat:statusEvent", statusEvent);
            }
          },
        });
      } catch (error) {
        return toChatSendMessageFailure(error);
      } finally {
        activeChatMessageControllers.delete(requestId);
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
    "chatSessions:delete",
    (_event, sessionId: string): Promise<ChatSessionOperationResult> =>
      container.deleteChatSession(sessionId),
  );
}
