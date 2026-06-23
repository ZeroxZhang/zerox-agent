import { contextBridge, ipcRenderer } from "electron";
import type { AppMeta } from "../shared/appMeta";
import type {
  LoadAgentValidationResult,
  PrepareAgentResult,
  ValidateAgentResult,
} from "../shared/agentBootstrap";
import type {
  CancelChatMessageResult,
  ChatStreamEvent,
  ChatSessionListItem,
  ChatSessionOperationResult,
  ChatSessionRecord,
  ChatTaskStatusEvent,
  GoalProgressEvent,
  SendChatMessageInput,
  SendChatMessageResult,
  SkillInputResponse,
  SkillInputResponseResult,
} from "../shared/chat";
import type { DesktopRuntimeInfo } from "../shared/desktopRuntime";
import type { AgentEvalReport } from "../shared/agentEval";
import type {
  AgentEvalCandidate,
  AgentEvalCandidateListOptions,
  GenerateEvalCandidateForRunResult,
  PromoteEvalCandidateResult,
} from "../shared/agentEvalCandidate";
import type {
  ReadToolResultRefOptions,
  ReadToolResultRefResult,
} from "../shared/toolResultRefs";
import type {
  CreateMemoryResult,
  DeleteMemoryResult,
  MemoryInput,
  MemoryListOptions,
  MemoryRecord,
  MemorySearchOptions,
  MemorySearchResult,
  RunMemoryMaintenanceResult,
} from "../shared/memory";
import type { RunMemoryEvalResult } from "../shared/memoryEval";
import type { RunMemoryGovernanceResult } from "../shared/memoryGovernance";
import type {
  ReadMemoryProfileResult,
  SaveMemoryProfileResult,
} from "../shared/memoryProfile";
import type {
  AgentLearningCandidate,
  AgentLearningListOptions,
  ApplyAcceptedLearningReport,
} from "../shared/agentLearning";
import type {
  ModelSettingsInput,
  PublicModelSettings,
  SaveModelSettingsResult,
  TestModelConnectionResult,
} from "../shared/modelSettings";
import type { NavigationSection } from "../shared/navigation";
import type {
  AgentRunEvent,
  AgentRunRecord,
  CancelScheduledTaskRunResult,
  PauseAgentRunResult,
  RunScheduledTaskResult,
} from "../shared/agentRuns";
import type { AgentExecutionCheckpoint } from "../shared/agentExecution";
import type { AgentTrajectoryEvent } from "../shared/agentTrajectory";
import type { Goal, GoalBudget } from "../shared/agentGoal";
import type {
  GoalReviewDecision,
  GoalReviewPolicy,
} from "../shared/agentGoalReview";
import type {
  AgentWorkspace,
  AgentWorkspaceCleanup,
  MultiAgentSession,
} from "../shared/agentWorkspace";
import type {
  CreateScheduledTaskResult,
  DeleteScheduledTaskResult,
  ScheduledTask,
  ScheduledTaskInput,
  UpdateScheduledTaskEnabledResult,
} from "../shared/scheduledTasks";
import type { SkillDiscoveryResult } from "../shared/skills";
import type {
  AuthorizeTaskToolCallResult,
  ToolAuditEvent,
  ToolCallRequest,
} from "../shared/toolPermissions";
import type {
  ResolveToolApprovalInput,
  ToolApprovalDecisionPayload,
  ToolApprovalModeState,
  ToolApprovalRequestPayload,
} from "../shared/toolApproval";
import type { KernelEvent, PermissionRule } from "../shared/kernelContract";

const KERNEL_IPC = {
  event: "kernel:event",
  subscribe: "kernel:subscribe",
  resumeRun: "kernel:resumeRun",
  updatePermissionRules: "kernel:updatePermissionRules",
  respondPermission: "kernel:respondPermission",
} as const;

export type AgentRunsChangedEvent = {
  reason: "active_execution_changed" | "run_updated";
  runId?: string;
  taskId?: string;
  createdAt: string;
};

export type CreateGoalInput = {
  description: string;
  successCriteria: string[];
  budget: GoalBudget;
  reviewPolicy: GoalReviewPolicy;
};

export type GoalOperationResult = {
  ok: boolean;
  goal?: Goal;
  message?: string;
};

const buildingAgent = {
  getAppMeta: (): Promise<AppMeta> => ipcRenderer.invoke("app:getMeta"),
  getRuntimeInfo: (): Promise<DesktopRuntimeInfo> =>
    ipcRenderer.invoke("app:getRuntimeInfo"),
  listNavigationSections: (): Promise<NavigationSection[]> =>
    ipcRenderer.invoke("navigation:list"),
  prepareAgent: (): Promise<PrepareAgentResult> =>
    ipcRenderer.invoke("agentBootstrap:prepare"),
  validateAgent: (): Promise<ValidateAgentResult> =>
    ipcRenderer.invoke("agentBootstrap:validate"),
  loadAgentValidation: (): Promise<LoadAgentValidationResult> =>
    ipcRenderer.invoke("agentBootstrap:loadValidation"),
  loadModelSettings: (): Promise<PublicModelSettings> =>
    ipcRenderer.invoke("modelSettings:load"),
  saveModelSettings: (
    input: ModelSettingsInput,
  ): Promise<SaveModelSettingsResult> =>
    ipcRenderer.invoke("modelSettings:save", input),
  testModelConnection: (): Promise<TestModelConnectionResult> =>
    ipcRenderer.invoke("modelSettings:testConnection"),
  listSkills: (): Promise<SkillDiscoveryResult> =>
    ipcRenderer.invoke("skills:list"),
  listScheduledTasks: (): Promise<ScheduledTask[]> =>
    ipcRenderer.invoke("scheduledTasks:list"),
  createScheduledTask: (
    input: ScheduledTaskInput,
  ): Promise<CreateScheduledTaskResult> =>
    ipcRenderer.invoke("scheduledTasks:create", input),
  setScheduledTaskEnabled: (
    taskId: string,
    enabled: boolean,
  ): Promise<UpdateScheduledTaskEnabledResult> =>
    ipcRenderer.invoke("scheduledTasks:setEnabled", taskId, enabled),
  deleteScheduledTask: (taskId: string): Promise<DeleteScheduledTaskResult> =>
    ipcRenderer.invoke("scheduledTasks:delete", taskId),
  authorizeToolCall: (
    taskId: string,
    request: ToolCallRequest,
  ): Promise<AuthorizeTaskToolCallResult> =>
    ipcRenderer.invoke("toolPermissions:authorize", taskId, request),
  getToolApprovalMode: (): Promise<ToolApprovalModeState> =>
    ipcRenderer.invoke("toolApproval:getMode"),
  setToolAutoApprovalEnabled: (
    enabled: boolean,
  ): Promise<ToolApprovalModeState> =>
    ipcRenderer.invoke("toolApproval:setAutoApprovalEnabled", enabled),
  resolveToolApproval: (input: ResolveToolApprovalInput): Promise<boolean> =>
    ipcRenderer.invoke("toolApproval:resolve", input),
  onToolApprovalRequest: (
    callback: (request: ToolApprovalRequestPayload) => void,
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: ToolApprovalRequestPayload,
    ) => callback(data);
    ipcRenderer.on("toolApproval:request", handler);
    return () => {
      ipcRenderer.removeListener("toolApproval:request", handler);
    };
  },
  onToolApprovalDecision: (
    callback: (decision: ToolApprovalDecisionPayload) => void,
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: ToolApprovalDecisionPayload,
    ) => callback(data);
    ipcRenderer.on("toolApproval:decision", handler);
    return () => {
      ipcRenderer.removeListener("toolApproval:decision", handler);
    };
  },
  onToolApprovalModeChanged: (
    callback: (state: ToolApprovalModeState) => void,
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: ToolApprovalModeState,
    ) => callback(data);
    ipcRenderer.on("toolApproval:modeChanged", handler);
    return () => {
      ipcRenderer.removeListener("toolApproval:modeChanged", handler);
    };
  },
  listToolAuditEvents: (): Promise<ToolAuditEvent[]> =>
    ipcRenderer.invoke("toolAudit:list"),
  listAgentRuns: (): Promise<AgentRunRecord[]> =>
    ipcRenderer.invoke("agentRuns:list"),
  listActiveAgentExecutions: (): Promise<AgentExecutionCheckpoint[]> =>
    ipcRenderer.invoke("agentRuns:listActiveExecutions"),
  listAgentWorkspaces: (): Promise<AgentWorkspace[]> =>
    ipcRenderer.invoke("agentWorkspaces:list"),
  createTemporaryAgentWorkspace: (input?: {
    name?: string;
    cleanup?: AgentWorkspaceCleanup;
  }): Promise<AgentWorkspace> =>
    ipcRenderer.invoke("agentWorkspaces:createTemporary", input),
  createGitWorktreeAgentWorkspace: (input: {
    name: string;
    repositoryRoot: string;
    branch: string;
  }): Promise<AgentWorkspace> =>
    ipcRenderer.invoke("agentWorkspaces:requestGitWorktree", input),
  listMultiAgentSessions: (): Promise<MultiAgentSession[]> =>
    ipcRenderer.invoke("multiAgentSessions:list"),
  listAgentRunTrajectory: (runId: string): Promise<AgentTrajectoryEvent[]> =>
    ipcRenderer.invoke("agentRuns:listTrajectory", runId),
  createGoal: (input: CreateGoalInput): Promise<GoalOperationResult> =>
    ipcRenderer.invoke("goal:create", input),
  startGoal: (goalId: string): Promise<GoalOperationResult> =>
    ipcRenderer.invoke("goal:start", goalId),
  pauseGoal: (goalId: string): Promise<GoalOperationResult> =>
    ipcRenderer.invoke("goal:pause", goalId),
  resumeGoal: (goalId: string): Promise<GoalOperationResult> =>
    ipcRenderer.invoke("goal:resume", goalId),
  resolveGoalReview: (
    goalId: string,
    decision: GoalReviewDecision,
  ): Promise<GoalOperationResult> =>
    ipcRenderer.invoke("goal:resolveReview", goalId, decision),
  cancelGoal: (goalId: string): Promise<GoalOperationResult> =>
    ipcRenderer.invoke("goal:cancel", goalId),
  increaseGoalBudget: (
    goalId: string,
    delta: Partial<GoalBudget>,
  ): Promise<GoalOperationResult> =>
    ipcRenderer.invoke("goal:increaseBudget", goalId, delta),
  replanGoal: (
    goalId: string,
    instructions: string,
  ): Promise<GoalOperationResult> =>
    ipcRenderer.invoke("goal:replan", goalId, instructions),
  retryGoal: (goalId: string): Promise<GoalOperationResult> =>
    ipcRenderer.invoke("goal:retry", goalId),
  getGoal: (goalId: string): Promise<Goal | null> =>
    ipcRenderer.invoke("goal:get", goalId),
  listActiveGoals: (): Promise<Goal[]> => ipcRenderer.invoke("goal:listActive"),
  readToolResultRef: (
    ref: string,
    options?: ReadToolResultRefOptions,
  ): Promise<ReadToolResultRefResult> =>
    ipcRenderer.invoke("toolResults:readRef", ref, options),
  getAgentEvalReport: (): Promise<AgentEvalReport> =>
    ipcRenderer.invoke("agentQuality:getEvalReport"),
  listEvalCandidates: (
    options?: AgentEvalCandidateListOptions,
  ): Promise<AgentEvalCandidate[]> =>
    ipcRenderer.invoke("agentEvalCandidates:list", options),
  generateEvalCandidateForRun: (
    runId: string,
  ): Promise<GenerateEvalCandidateForRunResult> =>
    ipcRenderer.invoke("agentEvalCandidates:generateForRun", runId),
  acceptEvalCandidate: (
    candidateId: string,
  ): Promise<AgentEvalCandidate | null> =>
    ipcRenderer.invoke("agentEvalCandidates:accept", candidateId),
  rejectEvalCandidate: (
    candidateId: string,
  ): Promise<AgentEvalCandidate | null> =>
    ipcRenderer.invoke("agentEvalCandidates:reject", candidateId),
  promoteEvalCandidate: (
    candidateId: string,
  ): Promise<PromoteEvalCandidateResult> =>
    ipcRenderer.invoke("agentEvalCandidates:promote", candidateId),
  runScheduledTask: (taskId: string): Promise<RunScheduledTaskResult> =>
    ipcRenderer.invoke("agentRuns:runTask", taskId),
  runScheduledTaskStreaming: (taskId: string): Promise<void> =>
    ipcRenderer.invoke("agentRuns:runTaskStreaming", taskId),
  onAgentStreamEvent: (callback: (event: AgentRunEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: AgentRunEvent) =>
      callback(data);
    ipcRenderer.on("agent:streamEvent", handler);
    return () => {
      ipcRenderer.removeListener("agent:streamEvent", handler);
    };
  },
  onAgentRunsChanged: (callback: (event: AgentRunsChangedEvent) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: AgentRunsChangedEvent,
    ) => callback(data);
    ipcRenderer.on("agentRuns:changed", handler);
    return () => {
      ipcRenderer.removeListener("agentRuns:changed", handler);
    };
  },
  onKernelEvent: (callback: (event: KernelEvent) => void) => {
    let active = true;
    const handler = (_event: Electron.IpcRendererEvent, data: KernelEvent) => {
      if (active) {
        callback(data);
      }
    };

    ipcRenderer.on(KERNEL_IPC.event, handler);
    void ipcRenderer
      .invoke(KERNEL_IPC.subscribe)
      .then((events: KernelEvent[]) => {
        if (!active || !Array.isArray(events)) {
          return;
        }

        for (const event of events) {
          callback(event);
        }
      })
      .catch(() => undefined);

    return () => {
      active = false;
      ipcRenderer.removeListener(KERNEL_IPC.event, handler);
    };
  },
  resumeKernelRun: (checkpointRef: string): Promise<RunScheduledTaskResult> =>
    ipcRenderer.invoke(KERNEL_IPC.resumeRun, checkpointRef),
  updateKernelPermissionRules: (rules: PermissionRule[]) =>
    ipcRenderer.invoke(KERNEL_IPC.updatePermissionRules, rules),
  respondKernelPermission: (
    permissionId: string,
    decision: "allow" | "deny",
  ) =>
    ipcRenderer.invoke(KERNEL_IPC.respondPermission, {
      id: permissionId,
      decision,
    }),
  cancelScheduledTaskRun: (
    taskId: string,
  ): Promise<CancelScheduledTaskRunResult> =>
    ipcRenderer.invoke("agentRuns:cancelTask", taskId),
  retryAgentRun: (runId: string): Promise<RunScheduledTaskResult> =>
    ipcRenderer.invoke("agentRuns:retry", runId),
  resumeAgentRun: (runId: string): Promise<RunScheduledTaskResult> =>
    ipcRenderer.invoke("agentRuns:resume", runId),
  pauseAgentRun: (runId: string): Promise<PauseAgentRunResult> =>
    ipcRenderer.invoke("agentRuns:pause", runId),
  sendChatMessage: (
    input: SendChatMessageInput,
  ): Promise<SendChatMessageResult> =>
    ipcRenderer.invoke("chat:sendMessage", input),
  cancelChatMessage: (
    requestId?: string,
  ): Promise<CancelChatMessageResult> =>
    ipcRenderer.invoke("chat:cancelMessage", requestId),
  onChatStreamEvent: (callback: (event: ChatStreamEvent) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: ChatStreamEvent,
    ) => callback(data);
    ipcRenderer.on("chat:streamEvent", handler);
    return () => {
      ipcRenderer.removeListener("chat:streamEvent", handler);
    };
  },
  respondSkillInput: (
    input: SkillInputResponse,
  ): Promise<SkillInputResponseResult> =>
    ipcRenderer.invoke("chat:respondSkillInput", input),
  onChatTaskStatusEvent: (callback: (event: ChatTaskStatusEvent) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: ChatTaskStatusEvent,
    ) => callback(data);
    ipcRenderer.on("chat:statusEvent", handler);
    return () => {
      ipcRenderer.removeListener("chat:statusEvent", handler);
    };
  },
  onGoalProgressEvent: (callback: (event: GoalProgressEvent) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: GoalProgressEvent,
    ) => callback(data);
    ipcRenderer.on("goal:progressEvent", handler);
    return () => {
      ipcRenderer.removeListener("goal:progressEvent", handler);
    };
  },
  onGoalMilestoneRunEvent: (callback: (event: AgentRunEvent) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: AgentRunEvent,
    ) => callback(data);
    ipcRenderer.on("goal:milestoneRunEvent", handler);
    return () => {
      ipcRenderer.removeListener("goal:milestoneRunEvent", handler);
    };
  },
  listChatSessions: (): Promise<ChatSessionListItem[]> =>
    ipcRenderer.invoke("chatSessions:list"),
  getChatSession: (sessionId: string): Promise<ChatSessionRecord | null> =>
    ipcRenderer.invoke("chatSessions:get", sessionId),
  archiveChatSession: (
    sessionId: string,
  ): Promise<ChatSessionOperationResult> =>
    ipcRenderer.invoke("chatSessions:archive", sessionId),
  restoreChatSession: (
    sessionId: string,
  ): Promise<ChatSessionOperationResult> =>
    ipcRenderer.invoke("chatSessions:restore", sessionId),
  deleteChatSession: (
    sessionId: string,
  ): Promise<ChatSessionOperationResult> =>
    ipcRenderer.invoke("chatSessions:delete", sessionId),
  listMemories: (options?: MemoryListOptions): Promise<MemoryRecord[]> =>
    ipcRenderer.invoke("memory:list", options),
  searchMemories: (
    options: MemorySearchOptions,
  ): Promise<MemorySearchResult[]> => ipcRenderer.invoke("memory:search", options),
  createMemory: (input: MemoryInput): Promise<CreateMemoryResult> =>
    ipcRenderer.invoke("memory:create", input),
  deleteMemory: (memoryId: string): Promise<DeleteMemoryResult> =>
    ipcRenderer.invoke("memory:delete", memoryId),
  exportMemories: (): Promise<string> => ipcRenderer.invoke("memory:export"),
  runMemoryEval: (): Promise<RunMemoryEvalResult> =>
    ipcRenderer.invoke("memory:evaluate"),
  reviewMemoryGovernance: (): Promise<RunMemoryGovernanceResult> =>
    ipcRenderer.invoke("memory:governance"),
  readMemoryProfile: (): Promise<ReadMemoryProfileResult> =>
    ipcRenderer.invoke("memoryProfile:read"),
  saveMemoryProfile: (content: string): Promise<SaveMemoryProfileResult> =>
    ipcRenderer.invoke("memoryProfile:save", content),
  runMemoryMaintenance: (): Promise<RunMemoryMaintenanceResult> =>
    ipcRenderer.invoke("memory:maintain"),
  listLearningCandidates: (
    options?: AgentLearningListOptions,
  ): Promise<AgentLearningCandidate[]> =>
    ipcRenderer.invoke("learning:listCandidates", options),
  acceptLearningCandidate: (
    candidateId: string,
  ): Promise<AgentLearningCandidate | null> =>
    ipcRenderer.invoke("learning:acceptCandidate", candidateId),
  rejectLearningCandidate: (
    candidateId: string,
  ): Promise<AgentLearningCandidate | null> =>
    ipcRenderer.invoke("learning:rejectCandidate", candidateId),
  applyAcceptedLearning: (): Promise<ApplyAcceptedLearningReport> =>
    ipcRenderer.invoke("learning:applyAccepted"),
};

contextBridge.exposeInMainWorld("buildingAgent", buildingAgent);

export type BuildingAgentApi = typeof buildingAgent;
