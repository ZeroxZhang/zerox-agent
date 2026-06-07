import { contextBridge, ipcRenderer } from "electron";
import type { AppMeta } from "../shared/appMeta";
import type {
  LoadAgentValidationResult,
  PrepareAgentResult,
  ValidateAgentResult,
} from "../shared/agentBootstrap";
import type {
  ChatSessionListItem,
  ChatSessionRecord,
  SendChatMessageInput,
  SendChatMessageResult,
} from "../shared/chat";
import type { DesktopRuntimeInfo } from "../shared/desktopRuntime";
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
  RunScheduledTaskResult,
} from "../shared/agentRuns";
import type { AgentExecutionCheckpoint } from "../shared/agentExecution";
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
  listToolAuditEvents: (): Promise<ToolAuditEvent[]> =>
    ipcRenderer.invoke("toolAudit:list"),
  listAgentRuns: (): Promise<AgentRunRecord[]> =>
    ipcRenderer.invoke("agentRuns:list"),
  listActiveAgentExecutions: (): Promise<AgentExecutionCheckpoint[]> =>
    ipcRenderer.invoke("agentRuns:listActiveExecutions"),
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
  cancelScheduledTaskRun: (
    taskId: string,
  ): Promise<CancelScheduledTaskRunResult> =>
    ipcRenderer.invoke("agentRuns:cancelTask", taskId),
  retryAgentRun: (runId: string): Promise<RunScheduledTaskResult> =>
    ipcRenderer.invoke("agentRuns:retry", runId),
  resumeAgentRun: (runId: string): Promise<RunScheduledTaskResult> =>
    ipcRenderer.invoke("agentRuns:resume", runId),
  sendChatMessage: (
    input: SendChatMessageInput,
  ): Promise<SendChatMessageResult> =>
    ipcRenderer.invoke("chat:sendMessage", input),
  listChatSessions: (): Promise<ChatSessionListItem[]> =>
    ipcRenderer.invoke("chatSessions:list"),
  getChatSession: (sessionId: string): Promise<ChatSessionRecord | null> =>
    ipcRenderer.invoke("chatSessions:get", sessionId),
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
  runMemoryMaintenance: (): Promise<RunMemoryMaintenanceResult> =>
    ipcRenderer.invoke("memory:maintain"),
};

contextBridge.exposeInMainWorld("buildingAgent", buildingAgent);

export type BuildingAgentApi = typeof buildingAgent;
