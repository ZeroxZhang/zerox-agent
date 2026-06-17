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
import { createAgentGoalStore } from "./agentGoalStore";
import { createAgentGoalController } from "./agentGoalController";
import { createAgentGoalAcceptance } from "./agentGoalAcceptance";
import { createAgentGoalContext } from "./agentGoalContext";
import { createAgentGoalPlanner } from "./agentGoalPlanner";
import { createGoalRuntimeEngine } from "./goalRuntimeEngine";
import { applyGoalOutputRootsToRunContext } from "./goalOutputRoots";
import { createGoalChatService } from "./goalChatService";
import { createAgentWorkspaceService } from "./agentWorkspaceService";
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
import { createToolResultOffloadStore } from "./toolResultOffloadStore";
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
import { createSkillExecutor } from "./skillExecutor";
import { createScheduledTaskStore } from "./taskStore";
import { createTaskSchedulerService } from "./taskSchedulerService";
import { createToolAuditLog } from "./toolAuditLog";
import { KernelEventBus } from "./kernel/eventBus";
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
  ChatSessionGoalSummary,
  ChatSessionListItem,
  ChatSessionRecord,
  GoalProgressEvent,
} from "../shared/chat";
import type {
  CancelScheduledTaskRunResult,
  PauseAgentRunResult,
  RunScheduledTaskResult,
} from "../shared/agentRuns";
import { isTerminalExecutionStatus } from "../shared/agentExecution";
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
import type { PermissionRule } from "../shared/kernelContract";

export type AppContainer = ReturnType<typeof createAppContainer>;

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

  const modelSettingsStore = createModelSettingsStore({
    configDir,
    vault: createElectronSecretVault(safeStorage),
  });
  let kernelPermissionRules: PermissionRule[] = [];

  const goalProgressListeners = new Set<(event: GoalProgressEvent) => void>();

  function onGoalProgressEvent(callback: (event: GoalProgressEvent) => void) {
    goalProgressListeners.add(callback);
    return () => {
      goalProgressListeners.delete(callback);
    };
  }

  function emitGoalProgressEvent(event: GoalProgressEvent) {
    void syncGoalProgressToChatSession(event)
      .catch(() => undefined)
      .finally(() => {
        notifyGoalProgressListeners(event);
      });
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

  async function syncGoalProgressToChatSession(event: GoalProgressEvent) {
    if (!event.sessionId) {
      return;
    }

    const goal = await agentGoalStore().get(event.goalId);
    if (!goal) {
      return;
    }

    const syncedGoal =
      goal.status === event.status ? goal : { ...goal, status: event.status };
    await attachGoalSummaryIfChanged(
      event.sessionId,
      toChatGoalSummary(syncedGoal),
    );
    await appendGoalTerminalMessageIfNeeded(event.sessionId, syncedGoal, event);
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
      return false;
    }

    await chatSessionStore().attachGoal(sessionId, summary);
    return true;
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
        return {
          ...session,
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
      return session;
    }

    const activeGoal = session.goalSummaries?.find(
      (summary) => summary.id === session.activeGoalId,
    );
    const reconciledGoal = await reconcileChatSessionGoalSummary(
      session.id,
      activeGoal,
    );
    if (!reconciledGoal) {
      return session;
    }

    return chatSessionStore().get(sessionId);
  }

  function createToolExecutor() {
    const executor = createAgentToolExecutor({
      memoryStore: memoryStore(),
      chatSessionStore: chatSessionStore(),
      toolResultOffloadStore: toolResultOffloadStore(),
    });
    void initializeMcpTools(executor);
    return executor;
  }

  function modelConnectionService() {
    return lazy("modelConnectionService", () =>
      createModelConnectionService({
        modelSettingsStore,
        chatClient: createOpenAiCompatibleClient(),
      }),
    );
  }

  function agentValidationStore() {
    return lazy("agentValidationStore", () =>
      createAgentValidationStore({ configDir }),
    );
  }

  function scheduledTaskStore() {
    return lazy("scheduledTaskStore", () => createScheduledTaskStore({ configDir }));
  }

  function toolAuditLog() {
    return lazy("toolAuditLog", () => createToolAuditLog({ configDir }));
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
    return lazy("agentRunStore", () => createAgentRunStore({ configDir }));
  }

  function agentExecutionStore() {
    return lazy("agentExecutionStore", () => createAgentExecutionStore({ configDir }));
  }

  function agentTrajectoryStore() {
    return lazy("agentTrajectoryStore", () => createAgentTrajectoryStore({ configDir }));
  }

  function agentGoalStore() {
    return lazy("agentGoalStore", () => createAgentGoalStore({ configDir }));
  }

  function agentWorkspaceStore() {
    return lazy("agentWorkspaceStore", () => createAgentWorkspaceStore({ configDir }));
  }

  function agentWorkspaceService() {
    return lazy("agentWorkspaceService", () =>
      createAgentWorkspaceService({
        workspaceStore: agentWorkspaceStore(),
        workspaceRoot: path.join(app.getPath("userData"), "workspaces"),
      }),
    );
  }

  function multiAgentSessionStore() {
    return lazy("multiAgentSessionStore", () => createMultiAgentSessionStore({ configDir }));
  }

  function memoryProfileStore() {
    return lazy("memoryProfileStore", () => createMemoryProfileStore({ configDir }));
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

  function agentBootstrapService() {
    return lazy("agentBootstrapService", () =>
      createAgentBootstrapService({
        modelSettingsStore,
        taskStore: scheduledTaskStore(),
        discoverSkills: () => discoverSkills({ skillsDir }),
        testModelConnection: () => modelConnectionService().testConnection(),
        runScheduledTask: (taskId: string) => runAgentTask(taskId),
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
        chatClient: createOpenAiCompatibleClient(),
        getModelProfile,
        toolAuthorizationService: toolAuthorizationService(),
        toolExecutor: createToolExecutor(),
        executionStore: agentExecutionStore(),
        workspaceService: agentWorkspaceService(),
        trajectoryStore: agentTrajectoryStore(),
        learningStore: agentLearningStore(),
        memoryStore: memoryStore(),
        toolResultOffloadStore: toolResultOffloadStore(),
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
          chatClient: createOpenAiCompatibleClient(),
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
              chatClient: createOpenAiCompatibleClient(),
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
                  chatClient: createOpenAiCompatibleClient(),
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
              chatClient: createOpenAiCompatibleClient(),
              modelProfile: await getModelProfile(),
            }).plan(description, {
              ...planOptions,
              availableTools,
            });
          },
          async replan(goal, reason) {
            return createAgentGoalPlanner({
              chatClient: createOpenAiCompatibleClient(),
              modelProfile: await getModelProfile(),
            }).replan(goal, reason);
          },
        },
        getAvailableTools: getAvailableToolNames,
        onProgress: emitGoalProgressEvent,
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
        chatClient: createOpenAiCompatibleClient(),
        getModelProfile,
        memoryStore: memoryStore(),
        memoryProfileStore: memoryProfileStore(),
        chatSessionStore: chatSessionStore(),
        goalService: goalChatService(),
        taskStore: scheduledTaskStore(),
        runScheduledTask: (taskId: string) => runAgentTask(taskId),
        toolExecutor: createToolExecutor(),
        toolAuthorizationService: toolAuthorizationService(),
        toolResultOffloadStore: toolResultOffloadStore(),
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
          const client = createMcpClient({
            name: config.name,
            transport: "stdio",
            command: config.command,
            args: config.args,
            env: config.env,
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

  async function runAgentTask(taskId: string): Promise<RunScheduledTaskResult> {
    if (activeTaskRunControllers.has(taskId)) {
      return {
        ok: false,
        message: "这个任务已经在运行中。",
      };
    }

    const controller = new AbortController();
    activeTaskRunControllers.set(taskId, controller);

    try {
      return await agentRunnerService().runTask(taskId, {
        signal: controller.signal,
      });
    } finally {
      if (activeTaskRunControllers.get(taskId) === controller) {
        activeTaskRunControllers.delete(taskId);
      }
    }
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

    try {
      return await agentRunnerService().resumeRun(runId, {
        signal: controller.signal,
      });
    } finally {
      if (activeTaskRunControllers.get(checkpoint.taskId) === controller) {
        activeTaskRunControllers.delete(checkpoint.taskId);
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

    return {
      ok: true,
      message: "运行已标记为可恢复。",
    };
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

  async function readToolResultRef(ref: string): Promise<ReadToolResultRefResult> {
    if (!isSafeToolResultRef(ref)) {
      return {
        ok: false,
        message: "工具结果引用无效。",
      };
    }

    const content = await toolResultOffloadStore().read(ref);
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
    agentRunStore,
    agentExecutionStore,
    agentTrajectoryStore,
    agentGoalStore,
    goalChatService,
    agentGoalController,
    agentWorkspaceStore,
    agentWorkspaceService,
    multiAgentSessionStore,
    multiAgentCoordinator,
    memoryStore,
    memoryProfileStore,
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
    chatService,
    taskSchedulerService,
    runAgentTask,
    resumeAgentRun,
    pauseAgentRun,
    createGoalDraft,
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
    onGoalProgressEvent,
  };
}
