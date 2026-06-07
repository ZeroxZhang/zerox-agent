import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  safeStorage,
  Tray,
} from "electron";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getAgentValidationModeOptions } from "./agentValidationMode";
import {
  createAgentExecutionStore,
  type AgentExecutionStore,
} from "./agentExecutionStore";
import {
  createAgentTrajectoryStore,
  type AgentTrajectoryStore,
} from "./agentTrajectoryStore";
import {
  getDefaultLoginItemSettings,
  getMainWindowOptions,
  getTrayTooltip,
  shouldApplyLoginStartup,
} from "./desktopLifecycle";
import { createAgentRunStore, type AgentRunStore } from "./agentRunStore";
import {
  createAgentRunnerService,
  type AgentRunnerService,
} from "./agentRunnerService";
import {
  createAgentBootstrapService,
  type AgentBootstrapService,
} from "./agentBootstrapService";
import { runDesktopAgentValidation } from "./desktopAgentValidator";
import {
  createAgentValidationStore,
  type AgentValidationStore,
} from "./agentValidationStore";
import {
  createAgentToolExecutor,
  type AgentToolExecutor,
} from "./agentToolExecutor";
import { createChatService, type ChatService } from "./chatService";
import {
  createChatSessionStore,
  type ChatSessionStore,
} from "./chatSessionStore";
import {
  createElectronSecretVault,
  createModelSettingsStore,
  ModelSettingsValidationError,
  type ModelSettingsStore,
} from "./modelSettingsStore";
import {
  createModelConnectionService,
  type ModelConnectionService,
} from "./modelConnectionService";
import {
  createMemoryStore,
  MemoryValidationError,
  type MemoryStore,
} from "./memoryStore";
import {
  createOpenAiCompatibleClient,
  createOpenAiCompatibleEmbeddingClient,
} from "./openAiCompatibleClient";
import {
  discoverSkills,
  buildSkillGraph,
  collectSkillMcpConfigs,
} from "./skillRegistry";
import { createMcpClient, type McpClient } from "./mcpClient";
import { createSkillExecutor } from "./skillExecutor";
import {
  createScheduledTaskStore,
  ScheduledTaskValidationError,
  type ScheduledTaskStore,
} from "./taskStore";
import {
  createTaskSchedulerService,
  type TaskSchedulerService,
} from "./taskSchedulerService";
import { createToolAuditLog, type ToolAuditLog } from "./toolAuditLog";
import { buildToolApprovalDialogOptions } from "./toolApprovalDialog";
import {
  createToolAuthorizationService,
  type ToolUserApprovalRequest,
  type ToolAuthorizationService,
} from "./toolAuthorizationService";
import { getAppMeta } from "../shared/appMeta";
import { getNavigationSections } from "../shared/navigation";
import type {
  ModelSettingsInput,
  SaveModelSettingsResult,
  TestModelConnectionResult,
} from "../shared/modelSettings";
import type {
  CreateScheduledTaskResult,
  DeleteScheduledTaskResult,
  ScheduledTaskInput,
  UpdateScheduledTaskEnabledResult,
} from "../shared/scheduledTasks";
import type {
  CancelScheduledTaskRunResult,
  RunScheduledTaskResult,
} from "../shared/agentRuns";
import type {
  CreateMemoryResult,
  DeleteMemoryResult,
  MemoryInput,
  MemoryListOptions,
  MemorySearchOptions,
  RunMemoryMaintenanceResult,
} from "../shared/memory";
import type { ToolCallRequest } from "../shared/toolPermissions";
import type {
  ChatSessionListItem,
  ChatSessionRecord,
  SendChatMessageInput,
  SendChatMessageResult,
} from "../shared/chat";
import type {
  LoadAgentValidationResult,
  PrepareAgentResult,
  ValidateAgentResult,
} from "../shared/agentBootstrap";
import {
  buildDesktopRuntimeInfo,
  type DesktopRuntimeInfo,
} from "../shared/desktopRuntime";
import {
  getSmokeModeOptions,
  getSmokeRendererCheckScript,
  getSmokeRendererFailureMessage,
  isSmokeRendererCheckResult,
} from "./smokeMode";

// Must be called before app.whenReady() for macOS menu bar name
app.setName("Zerox Agent");

const rendererUrl = process.env.ELECTRON_RENDERER_URL;
const appMeta = getAppMeta();
const smokeMode = getSmokeModeOptions(process.env);
const validationMode = getAgentValidationModeOptions(process.env);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let modelSettingsStore: ModelSettingsStore | null = null;
let scheduledTaskStore: ScheduledTaskStore | null = null;
let toolAuditLog: ToolAuditLog | null = null;
let toolAuthorizationService: ToolAuthorizationService | null = null;
let agentExecutionStore: AgentExecutionStore | null = null;
let agentTrajectoryStore: AgentTrajectoryStore | null = null;
let agentRunStore: AgentRunStore | null = null;
let agentRunnerService: AgentRunnerService | null = null;
let chatService: ChatService | null = null;
let chatSessionStore: ChatSessionStore | null = null;
let memoryStore: MemoryStore | null = null;
let taskSchedulerService: TaskSchedulerService | null = null;
let modelConnectionService: ModelConnectionService | null = null;
let agentBootstrapService: AgentBootstrapService | null = null;
let agentValidationStore: AgentValidationStore | null = null;
let taskSchedulerTimer: NodeJS.Timeout | null = null;
let memoryMaintenanceTimer: NodeJS.Timeout | null = null;
const activeTaskRunControllers = new Map<string, AbortController>();
const activeMcpClients: McpClient[] = [];
let mcpInitialized = false;

const memoryMaintenanceIntervalMs = 30 * 60 * 1000;
const taskSchedulerIntervalMs = 60 * 1000;

function createMainWindow(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }

  const windowInstance = new BrowserWindow({
    ...getMainWindowOptions(),
    title: appMeta.productName,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow = windowInstance;

  windowInstance.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      windowInstance.hide();
    }
  });

  windowInstance.on("closed", () => {
    if (mainWindow === windowInstance) {
      mainWindow = null;
    }
  });

  if (smokeMode.enabled) {
    attachSmokeModeLifecycle(windowInstance);
  }

  if (rendererUrl) {
    void windowInstance.loadURL(rendererUrl);
  } else {
    void windowInstance.loadFile(path.join(__dirname, "../../dist/index.html"));
  }

  return windowInstance;
}

function createTray(): Tray {
  if (tray) {
    return tray;
  }

  let trayIcon: Electron.NativeImage;
  try {
    const iconPath = path.join(app.getAppPath(), "logo.png");
    const loaded = nativeImage.createFromPath(iconPath);
    if (!loaded.isEmpty()) {
      trayIcon = loaded.resize({ width: 22, height: 22 });
    } else {
      trayIcon = nativeImage.createFromDataURL(createTrayIconDataUrl());
    }
  } catch {
    trayIcon = nativeImage.createFromDataURL(createTrayIconDataUrl());
  }
  trayIcon.setTemplateImage(true);
  tray = new Tray(trayIcon);
  tray.setToolTip(getTrayTooltip(appMeta.productName));
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: `显示 ${appMeta.productName}`,
        click: () => {
          createMainWindow();
        },
      },
      {
        label: "关于 Zerox Agent",
        click: () => {
          void dialog.showMessageBox({
            type: "info",
            title: appMeta.productName,
            message: "Zerox Agent 正在本地运行。",
            detail:
              "它会在后台保留定时任务、运行日志、工具权限和本地记忆。",
          });
        },
      },
      { type: "separator" },
      {
        label: "退出",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on("click", () => {
    createMainWindow();
  });

  return tray;
}

function createTrayIconDataUrl(): string {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <rect x="3" y="3" width="26" height="26" rx="7" fill="#2563eb"/>
      <path d="M10 21V10h5.2c2.4 0 3.8 1.2 3.8 3.1 0 1-.5 1.9-1.4 2.4 1.3.4 2.1 1.3 2.1 2.7 0 2.1-1.6 2.8-4.1 2.8H10zm2.6-6.5h2.1c1.1 0 1.7-.4 1.7-1.2s-.6-1.1-1.7-1.1h-2.1v2.3zm0 4.2h2.7c1.2 0 1.8-.4 1.8-1.2 0-.9-.6-1.3-1.9-1.3h-2.6v2.5z" fill="white"/>
      <path d="M21 21l3.7-11h2.4l3.8 11h-2.6l-.7-2.2h-3.5l-.7 2.2H21zm3.7-4.3h2.2l-1.1-3.7-1.1 3.7z" fill="white" transform="translate(-1.8 0)"/>
    </svg>`;

  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function attachSmokeModeLifecycle(windowInstance: BrowserWindow) {
  let timeout: NodeJS.Timeout | null = null;

  const exit = (code: number, message: string) => {
    isQuitting = true;
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
    if (code === 0) {
      console.log(message);
    } else {
      console.error(message);
    }
    app.exit(code);
  };

  timeout = setTimeout(() => {
    exit(1, `Smoke startup timed out after ${smokeMode.timeoutMs}ms.`);
  }, smokeMode.timeoutMs);
  timeout.unref?.();

  windowInstance.webContents.once("did-finish-load", () => {
    void windowInstance.webContents
      .executeJavaScript(getSmokeRendererCheckScript(), true)
      .then((result: unknown) => {
        if (isSmokeRendererCheckResult(result) && result.ok) {
          exit(0, "Smoke startup passed: renderer rendered agent chat UI.");
          return;
        }

        exit(1, getSmokeRendererFailureMessage(result));
      })
      .catch((error: unknown) => {
        exit(
          1,
          `Smoke startup failed while checking renderer: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
  });

  windowInstance.webContents.once(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL) => {
      exit(
        1,
        `Smoke startup failed (${errorCode}): ${errorDescription} ${validatedURL}`,
      );
    },
  );
}

ipcMain.handle("app:getMeta", () => getAppMeta());
ipcMain.handle("app:getRuntimeInfo", (): DesktopRuntimeInfo =>
  buildDesktopRuntimeInfo({
    appPath: app.getAppPath(),
    isPackaged: app.isPackaged,
    productName: appMeta.productName,
    rendererMode: rendererUrl ? "development" : "production",
    userDataPath: app.getPath("userData"),
    version: app.getVersion(),
  }),
);
ipcMain.handle("navigation:list", () => getNavigationSections());
ipcMain.handle(
  "agentBootstrap:prepare",
  async (): Promise<PrepareAgentResult> => {
    try {
      return {
        ok: true,
        report: await getAgentBootstrapService().prepare(),
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
      const report = await getAgentBootstrapService().validate();
      const snapshot =
        (await getAgentBootstrapService().loadLastValidation()) ?? {
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
        snapshot: await getAgentBootstrapService().loadLastValidation(),
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
ipcMain.handle("skills:list", () =>
  discoverSkills({ skillsDir: path.join(app.getAppPath(), "skills") }),
);
ipcMain.handle("scheduledTasks:list", () => getScheduledTaskStore().list());
ipcMain.handle(
  "scheduledTasks:create",
  async (
    _event,
    input: ScheduledTaskInput,
  ): Promise<CreateScheduledTaskResult> => {
    try {
      return {
        ok: true,
        task: await getScheduledTaskStore().create(input),
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
        message:
          error instanceof Error ? error.message : "无法创建任务。",
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
        task: await getScheduledTaskStore().setEnabled(taskId, enabled),
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
        deleted: await getScheduledTaskStore().delete(taskId),
      };
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error ? error.message : "无法删除任务。",
      };
    }
  },
);
ipcMain.handle(
  "toolPermissions:authorize",
  (_event, taskId: string, request: ToolCallRequest) =>
    getToolAuthorizationService().authorize(taskId, request),
);
ipcMain.handle("toolAudit:list", () => getToolAuditLog().list({ limit: 50 }));
ipcMain.handle("agentRuns:list", () => getAgentRunStore().list({ limit: 50 }));
ipcMain.handle("agentRuns:listActiveExecutions", () =>
  getAgentExecutionStore().listActive(),
);
ipcMain.handle(
  "agentRuns:runTask",
  async (_event, taskId: string): Promise<RunScheduledTaskResult> =>
    runAgentTask(taskId),
);
ipcMain.handle(
  "agentRuns:runTaskStreaming",
  async (event, taskId: string) => {
    const sender = event.sender;

    try {
      const runner = getAgentRunnerService();
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
    const controller = activeTaskRunControllers.get(taskId);

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
    const run = await getAgentRunStore().get(runId);

    if (!run) {
      return {
        ok: false,
        message: "运行记录不存在，无法重试。",
      };
    }

    return runAgentTask(run.taskId);
  },
);
ipcMain.handle(
  "agentRuns:resume",
  async (_event, runId: string): Promise<RunScheduledTaskResult> =>
    resumeAgentRun(runId),
);
ipcMain.handle(
  "chat:sendMessage",
  async (
    _event,
    input: SendChatMessageInput,
  ): Promise<SendChatMessageResult> => getChatService().sendMessage(input),
);
ipcMain.handle(
  "chatSessions:list",
  (): Promise<ChatSessionListItem[]> => getChatSessionStore().list(),
);
ipcMain.handle(
  "chatSessions:get",
  (_event, sessionId: string): Promise<ChatSessionRecord | null> =>
    getChatSessionStore().get(sessionId),
);
ipcMain.handle("memory:list", (_event, options?: MemoryListOptions) =>
  getMemoryStore().list(options),
);
ipcMain.handle("memory:search", (_event, options: MemorySearchOptions) =>
  getMemoryStore().search(options),
);
ipcMain.handle(
  "memory:create",
  async (_event, input: MemoryInput): Promise<CreateMemoryResult> => {
    try {
      return {
        ok: true,
        memory: await getMemoryStore().create(input),
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
        message:
          error instanceof Error ? error.message : "无法创建记忆。",
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
        deleted: await getMemoryStore().delete(memoryId),
      };
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error ? error.message : "无法删除记忆。",
      };
    }
  },
);
ipcMain.handle("memory:export", () => getMemoryStore().export());
ipcMain.handle(
  "memory:maintain",
  async (): Promise<RunMemoryMaintenanceResult> => {
    try {
      return {
        ok: true,
        report: await getMemoryStore().runMaintenance(),
      };
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "无法运行记忆整理。",
      };
    }
  },
);
ipcMain.handle("modelSettings:load", () => getModelSettingsStore().load());
ipcMain.handle(
  "modelSettings:testConnection",
  (): Promise<TestModelConnectionResult> =>
    getModelConnectionService().testConnection(),
);
ipcMain.handle(
  "modelSettings:save",
  async (_event, input: ModelSettingsInput): Promise<SaveModelSettingsResult> => {
    try {
      return {
        ok: true,
        settings: await getModelSettingsStore().save(input),
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
          error instanceof Error
            ? error.message
            : "无法保存模型配置。",
      };
    }
  },
);

function getModelSettingsStore(): ModelSettingsStore {
  if (!modelSettingsStore) {
    modelSettingsStore = createModelSettingsStore({
      configDir: path.join(app.getPath("userData"), "config"),
      vault: createElectronSecretVault(safeStorage),
    });
  }

  return modelSettingsStore;
}

function getModelConnectionService(): ModelConnectionService {
  if (!modelConnectionService) {
    modelConnectionService = createModelConnectionService({
      modelSettingsStore: getModelSettingsStore(),
      chatClient: createOpenAiCompatibleClient(),
    });
  }

  return modelConnectionService;
}

function getAgentBootstrapService(): AgentBootstrapService {
  if (!agentBootstrapService) {
    agentBootstrapService = createAgentBootstrapService({
      modelSettingsStore: getModelSettingsStore(),
      taskStore: getScheduledTaskStore(),
      discoverSkills: () =>
        discoverSkills({ skillsDir: path.join(app.getAppPath(), "skills") }),
      testModelConnection: () => getModelConnectionService().testConnection(),
      runScheduledTask: (taskId) => runAgentTask(taskId),
      validationStore: getAgentValidationStore(),
    });
  }

  return agentBootstrapService;
}

function getAgentValidationStore(): AgentValidationStore {
  if (!agentValidationStore) {
    agentValidationStore = createAgentValidationStore({
      configDir: path.join(app.getPath("userData"), "config"),
    });
  }

  return agentValidationStore;
}

function getScheduledTaskStore(): ScheduledTaskStore {
  if (!scheduledTaskStore) {
    scheduledTaskStore = createScheduledTaskStore({
      configDir: path.join(app.getPath("userData"), "config"),
    });
  }

  return scheduledTaskStore;
}

function getToolAuditLog(): ToolAuditLog {
  if (!toolAuditLog) {
    toolAuditLog = createToolAuditLog({
      configDir: path.join(app.getPath("userData"), "config"),
    });
  }

  return toolAuditLog;
}

function getToolAuthorizationService(): ToolAuthorizationService {
  if (!toolAuthorizationService) {
    toolAuthorizationService = createToolAuthorizationService({
      taskStore: getScheduledTaskStore(),
      auditLog: getToolAuditLog(),
      requestUserApproval: requestToolApprovalWithDialog,
    });
  }

  return toolAuthorizationService;
}

async function requestToolApprovalWithDialog(
  request: ToolUserApprovalRequest,
) {
  const windowInstance = ensureVisibleApprovalWindow();
  const result = await dialog.showMessageBox(
    windowInstance,
    buildToolApprovalDialogOptions(request),
  );

  return result.response === 0
    ? {
        approved: true,
        reason: `用户已在弹窗中授权本次 ${request.request.toolName}。`,
      }
    : {
        approved: false,
        reason: `用户拒绝授权本次 ${request.request.toolName}。`,
      };
}

function ensureVisibleApprovalWindow(): BrowserWindow {
  const windowInstance = createMainWindow();

  if (windowInstance.isMinimized()) {
    windowInstance.restore();
  }
  windowInstance.show();
  windowInstance.focus();

  return windowInstance;
}

function getAgentRunStore(): AgentRunStore {
  if (!agentRunStore) {
    agentRunStore = createAgentRunStore({
      configDir: path.join(app.getPath("userData"), "config"),
    });
  }

  return agentRunStore;
}

function getAgentExecutionStore(): AgentExecutionStore {
  if (!agentExecutionStore) {
    agentExecutionStore = createAgentExecutionStore({
      configDir: path.join(app.getPath("userData"), "config"),
    });
  }

  return agentExecutionStore;
}

function getAgentTrajectoryStore(): AgentTrajectoryStore {
  if (!agentTrajectoryStore) {
    agentTrajectoryStore = createAgentTrajectoryStore({
      configDir: path.join(app.getPath("userData"), "config"),
    });
  }

  return agentTrajectoryStore;
}

function getMemoryStore(): MemoryStore {
  if (!memoryStore) {
    memoryStore = createMemoryStore({
      configDir: path.join(app.getPath("userData"), "config"),
      embeddingService: {
        async embed(text) {
          const settings = await getModelSettingsStore().load();
          const apiKey = await getModelSettingsStore().getApiKey();

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
    });
  }

  return memoryStore;
}

function getAgentRunnerService(): AgentRunnerService {
  if (!agentRunnerService) {
    const toolExecutor = createAgentToolExecutor();

    // Register skill-defined tools and MCP tools
    void initializeMcpTools(toolExecutor);

    agentRunnerService = createAgentRunnerService({
      taskStore: getScheduledTaskStore(),
      runStore: getAgentRunStore(),
      resolveSkill: async (skillName) => {
        const result = await discoverSkills({
          skillsDir: path.join(app.getAppPath(), "skills"),
        });
        return (
          result.skills.find((skill) => skill.manifest.name === skillName) ??
          null
        );
      },
      chatClient: createOpenAiCompatibleClient(),
      getModelProfile: async () => {
        const settings = await getModelSettingsStore().load();
        const apiKey = await getModelSettingsStore().getApiKey();

        if (!settings.chatModel || !apiKey) {
          throw new Error("模型配置不完整。");
        }

        return {
          baseUrl: settings.baseUrl,
          apiKey,
          model: settings.chatModel,
          temperature: settings.temperature,
          maxTokens: settings.maxTokens,
        };
      },
      toolAuthorizationService: getToolAuthorizationService(),
      toolExecutor,
      executionStore: getAgentExecutionStore(),
      trajectoryStore: getAgentTrajectoryStore(),
      memoryStore: getMemoryStore(),
    });
  }

  return agentRunnerService;
}

async function initializeMcpTools(
  toolExecutor: AgentToolExecutor,
): Promise<void> {
  if (mcpInitialized) return;
  mcpInitialized = true;

  const skillsDir = path.join(app.getAppPath(), "skills");
  const skillExecutor = createSkillExecutor();

  try {
    const graph = await buildSkillGraph({ skillsDir });
    const mcpConfigs = await collectSkillMcpConfigs({ skillsDir });

    // Initialize MCP clients and register their tools
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
                const result = await client.callTool(
                  tool.function.name,
                  args,
                );
                if (result.ok) return result;
                return { ok: false, error: result.error };
              },
              `mcp:${config.name}`,
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

    // Register skill-defined tools
    for (const skillName of graph.order) {
      const skill = graph.skills.find(
        (s) => s.manifest.name === skillName,
      );
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

function getChatSessionStore(): ChatSessionStore {
  if (!chatSessionStore) {
    chatSessionStore = createChatSessionStore({
      configDir: path.join(app.getPath("userData"), "config"),
    });
  }

  return chatSessionStore;
}

function getChatService(): ChatService {
  if (!chatService) {
    const toolExecutor = createAgentToolExecutor();
    void initializeMcpTools(toolExecutor);

    chatService = createChatService({
      chatClient: createOpenAiCompatibleClient(),
      getModelProfile: async () => {
        const settings = await getModelSettingsStore().load();
        const apiKey = await getModelSettingsStore().getApiKey();

        if (!settings.chatModel || !apiKey) {
          throw new Error("模型配置不完整。");
        }

        return {
          baseUrl: settings.baseUrl,
          apiKey,
          model: settings.chatModel,
          temperature: settings.temperature,
          maxTokens: settings.maxTokens,
        };
      },
      memoryStore: getMemoryStore(),
      chatSessionStore: getChatSessionStore(),
      taskStore: getScheduledTaskStore(),
      runScheduledTask: (taskId) => getAgentRunnerService().runTask(taskId),
      toolExecutor,
      toolAuthorizationService: getToolAuthorizationService(),
    });
  }

  return chatService;
}

function getTaskSchedulerService(): TaskSchedulerService {
  if (!taskSchedulerService) {
    taskSchedulerService = createTaskSchedulerService({
      taskStore: getScheduledTaskStore(),
      runScheduledTask: (taskId) => runAgentTask(taskId),
    });
  }

  return taskSchedulerService;
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
    return await getAgentRunnerService().runTask(taskId, {
      signal: controller.signal,
    });
  } finally {
    if (activeTaskRunControllers.get(taskId) === controller) {
      activeTaskRunControllers.delete(taskId);
    }
  }
}

async function resumeAgentRun(runId: string): Promise<RunScheduledTaskResult> {
  const checkpoint = await getAgentExecutionStore().get(runId);

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
    return await getAgentRunnerService().resumeRun(runId, {
      signal: controller.signal,
    });
  } finally {
    if (activeTaskRunControllers.get(checkpoint.taskId) === controller) {
      activeTaskRunControllers.delete(checkpoint.taskId);
    }
  }
}

function startTaskScheduler() {
  if (taskSchedulerTimer) {
    return;
  }

  void getTaskSchedulerService().runDueTasks().catch(() => {
    // Background task scheduling is best-effort; run logs surface failures.
  });
  taskSchedulerTimer = setInterval(() => {
    void getTaskSchedulerService().runDueTasks().catch(() => {
      // Background task scheduling is best-effort; run logs surface failures.
    });
  }, taskSchedulerIntervalMs);
  taskSchedulerTimer.unref?.();
}

function stopTaskScheduler() {
  if (!taskSchedulerTimer) {
    return;
  }

  clearInterval(taskSchedulerTimer);
  taskSchedulerTimer = null;
}

function startMemoryMaintenanceScheduler() {
  if (memoryMaintenanceTimer) {
    return;
  }

  memoryMaintenanceTimer = setInterval(() => {
    void getMemoryStore().runMaintenance().catch(() => {
      // Background maintenance is best-effort; manual runs surface errors in UI.
    });
  }, memoryMaintenanceIntervalMs);
  memoryMaintenanceTimer.unref?.();
}

function stopMemoryMaintenanceScheduler() {
  if (!memoryMaintenanceTimer) {
    return;
  }

  clearInterval(memoryMaintenanceTimer);
  memoryMaintenanceTimer = null;
}

app.whenReady().then(() => {
  if (validationMode.enabled) {
    void runValidationModeAndExit();
    return;
  }

  if (shouldApplyLoginStartup(app.isPackaged, process.env)) {
    app.setLoginItemSettings(getDefaultLoginItemSettings());
  }
  // Set app icon (macOS dock)
  try {
    const iconPath = path.resolve(app.getAppPath(), "logo.png");
    const appIcon = nativeImage.createFromPath(iconPath);
    if (!appIcon.isEmpty() && process.platform === "darwin" && app.dock) {
      app.dock.setIcon(appIcon);
    }
  } catch {
    // Icon is cosmetic; don't block startup on failure
  }
  createMainWindow();

  if (!smokeMode.enabled) {
    createTray();
    startTaskScheduler();
    startMemoryMaintenanceScheduler();
  }

  app.on("activate", () => {
    if (smokeMode.enabled) {
      return;
    }

    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("before-quit", () => {
  isQuitting = true;
  stopTaskScheduler();
  stopMemoryMaintenanceScheduler();
  for (const client of activeMcpClients) {
    try {
      client.disconnect();
    } catch {
      // Best-effort cleanup
    }
  }
  activeMcpClients.length = 0;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

async function runValidationModeAndExit() {
  let timeout: NodeJS.Timeout | null = null;

  const exit = (code: number) => {
    isQuitting = true;
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
    app.exit(code);
  };

  timeout = setTimeout(() => {
    console.error(
      `桌面端完整验收超时：${validationMode.timeoutMs} ms。`,
    );
    exit(1);
  }, validationMode.timeoutMs);
  timeout.unref?.();

  try {
    const apiInfoPath = path.resolve(process.cwd(), validationMode.apiInfoPath);
    const apiInfoMarkdown = await readFile(apiInfoPath, "utf8");
    const result = await runDesktopAgentValidation({
      apiInfoMarkdown,
      modelSettingsStore: getModelSettingsStore(),
      validateAgent: () => getAgentBootstrapService().validate(),
    });

    console.log(JSON.stringify(result, null, 2));
    exit(result.ok ? 0 : 1);
  } catch (error) {
    console.error(
      error instanceof Error
        ? `桌面端完整验收失败：${error.message}`
        : "桌面端完整验收失败。",
    );
    exit(1);
  }
}
