import {
  app,
  autoUpdater as nativeAutoUpdater,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Tray,
} from "electron";
import type {
  IpcMainInvokeEvent,
  MenuItemConstructorOptions,
  RenderProcessGoneDetails,
} from "electron";
import { autoUpdater } from "electron-updater";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { getAgentValidationModeOptions } from "./agentValidationMode";
import { createAppContainer } from "./container";
import { registerAllIpcHandlers, shutdownActiveChatMessages } from "./ipc";
import {
  createRendererCrashRecoveryTracker,
  getDefaultLoginItemSettings,
  getDisabledLoginItemSettings,
  getMainWindowOptions,
  getTrayTooltip,
  isTrustedRendererLocation,
  resolveTrustedRendererSource,
  shouldApplyLoginStartup,
  shouldCreateMainWindowAtStartup,
  shouldRecoverRendererProcess,
  shouldRestoreMainWindowOnActivate,
} from "./desktopLifecycle";
import { runDesktopAgentValidation } from "./desktopAgentValidator";
import { settleShutdownWithDeadline } from "./shutdownDeadline";
import { applyUserDataDirOverride } from "./userDataDirOverride";
import { getAppMeta } from "../shared/appMeta";
import { createToolApprovalCoordinator } from "./toolApprovalCoordinator";
import { createConversationCausalStore } from "./conversationCausalStore";
import { reconcileRequiredConversationSettlements } from "./conversationSettlementReconciler";
import { runStartupRecoverySequence } from "./startupRecoverySequence";
import type { ResolveToolApprovalInput } from "../shared/toolApproval";
import { KERNEL_IPC, type PermissionRule } from "../shared/kernelContract";
import {
  getSmokeModeOptions,
  getSmokeRendererPerformanceMessage,
  getSmokeRendererPerformanceScript,
  getSmokeRendererCheckScript,
  getSmokeRendererFailureMessage,
  isSmokeRendererPerformanceResult,
  isSmokeRendererCheckResult,
} from "./smokeMode";
import { setPromptBaseDir, loadModelPromptFile } from "./promptFileLoader";
import { setProfileContentLoader } from "../shared/systemPromptLayerProviders";
import { createAppUpdateService } from "./appUpdateService";
import {
  fetchVerifiedUpdateManifest,
  verifyDownloadedUpdateFiles,
} from "./appUpdateManifest";
import { createUpdateHighWaterStore } from "./appUpdateHighWater";
import {
  createProductionSmokeSettler,
  evaluateProductionSmokeAcceptance,
  type ProductionStorageSmokeEvidence,
} from "../shared/productionSmoke";
import { getConversationDisclosureAcceptanceMode } from "./conversationDisclosureAcceptanceMode";
import {
  createConversationDisclosureIpcRecorder,
  prepareConversationDisclosureScenario,
  runConversationDisclosureScenario,
} from "./conversationDisclosureAcceptanceDriver";
import { createConversationDisclosureScriptedClient } from "./conversationDisclosureScriptedClient";
import { assertSafeStoreEntityId } from "./storeEntityId";
import { assertSafePlanId } from "./planStore";
import { stringifyRedactedCredentials } from "../shared/credentialRedaction";
import { classifyPlanReplayReadFailure } from "../shared/planDiagnostics";

app.setName("Zerox Agent");
applyUserDataDirOverride({
  env: process.env,
  setPath: (name, value) => app.setPath(name, value),
});

// Prompt files live alongside skills/ in the app root.
setPromptBaseDir(path.join(app.getAppPath(), "prompts"));
setProfileContentLoader(loadModelPromptFile);

const rendererSource = resolveTrustedRendererSource({
  isPackaged: app.isPackaged,
  rendererUrl: process.env.ELECTRON_RENDERER_URL,
  rendererFile: path.join(__dirname, "../../dist/index.html"),
});
const appMeta = getAppMeta();
const smokeMode = getSmokeModeOptions(process.env);
const validationMode = getAgentValidationModeOptions(process.env);
const disclosureAcceptanceMode =
  getConversationDisclosureAcceptanceMode(process.env);
const disclosureAcceptanceIpc = createConversationDisclosureIpcRecorder();
const rendererCrashRecovery = createRendererCrashRecoveryTracker();

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let taskSchedulerTimer: NodeJS.Timeout | null = null;
let memoryMaintenanceTimer: NodeJS.Timeout | null = null;
let appUpdateTimer: NodeJS.Timeout | null = null;
let unsubscribeKernelEvents: (() => void) | null = null;
let startupComplete = false;

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (app.isReady() && startupComplete) createMainWindow();
  });
}

const memoryMaintenanceIntervalMs = 30 * 60 * 1000;
const taskSchedulerIntervalMs = 60 * 1000;
const appUpdateIntervalMs = 4 * 60 * 60 * 1000;

const conversationCausalStore = createConversationCausalStore({
  configDir: path.join(app.getPath("userData"), "config"),
});
const processEpoch = `main_${randomUUID()}`;

const toolApprovalCoordinator = createToolApprovalCoordinator({
  store: conversationCausalStore,
  processEpoch,
  ...(disclosureAcceptanceMode.enabled
    ? { createId: () => `approval-${disclosureAcceptanceMode.scenarioId}` }
    : {}),
  sendToRenderers(channel, payload) {
    for (const windowInstance of BrowserWindow.getAllWindows()) {
      if (!windowInstance.isDestroyed()) {
        windowInstance.webContents.send(channel, payload);
      }
    }
  },
});

const container = createAppContainer({
  requestToolApproval: toolApprovalCoordinator.requestUserApproval,
  setGoalActive: toolApprovalCoordinator.setGoalActive,
  conversationCausalStore,
  ...(disclosureAcceptanceMode.enabled
    ? {
        chatClientOverride: createConversationDisclosureScriptedClient(
          disclosureAcceptanceMode.scenarioId,
          { secretCanary: disclosureAcceptanceMode.secretCanary },
        ),
        modelProfileOverride: {
          baseUrl: "http://127.0.0.1/unused",
          apiKey: "acceptance-not-a-secret",
          model: "cd09-scripted",
          providerId: "openai-compatible",
          profile: "default",
          temperature: 0,
          maxTokens:
            disclosureAcceptanceMode.scenarioId === "S18-context-usage"
              ? 256
              : 1024,
          contextWindow:
            disclosureAcceptanceMode.scenarioId === "S18-context-usage"
              ? 1024
              : 8192,
          contextWindowSource: {
            kind: "provider_metadata",
            label: "CD09 local scripted acceptance profile",
          },
          thinking: { type: "disabled" },
          modelCapabilities: {
            tools: true,
            vision: false,
            pdf: false,
            streaming: true,
            parallelToolCalls: false,
          },
        },
      }
    : {}),
});

const appUpdateService = createAppUpdateService({
  updater: autoUpdater,
  enabled:
    app.isPackaged &&
    !smokeMode.enabled &&
    !validationMode.enabled &&
    !disclosureAcceptanceMode.enabled &&
    process.env.ZEROX_DISABLE_AUTO_UPDATE !== "1",
  currentVersion: app.getVersion(),
  loadVerifiedUpdateManifest: () =>
    fetchVerifiedUpdateManifest({ resourcesPath: process.resourcesPath }),
  updateHighWaterStore: createUpdateHighWaterStore(
    path.join(app.getPath("userData"), "config", "update-high-water.json"),
  ),
  verifyDownloadedUpdate: verifyDownloadedUpdateFiles,
  onStateChange(state) {
    sendToRendererWindows("app:updateStateChanged", state);
  },
  onBeforeInstall() {
    isQuitting = true;
  },
});

nativeAutoUpdater.on("before-quit-for-update", () => {
  isQuitting = true;
});

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
      sandbox: true,
      ...(process.argv.includes("--zerox-chat-disclosure=projected")
        ? { additionalArguments: ["--zerox-chat-disclosure=projected"] }
        : {}),
    },
  });
  mainWindow = windowInstance;
  installRendererTrustPolicy(windowInstance);

  if (smokeMode.viewport) {
    windowInstance.setSize(
      smokeMode.viewport.width,
      smokeMode.viewport.height,
      false,
    );
  }

  windowInstance.on("close", (event) => {
    if (!isQuitting && mainWindow === windowInstance) {
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

  if (rendererSource.kind === "development_url") {
    const url = new URL(rendererSource.url);
    if (smokeMode.targetHash) {
      url.hash = smokeMode.targetHash;
    }
    void windowInstance.loadURL(url.toString());
  } else {
    void windowInstance.loadFile(rendererSource.filePath, {
      hash: smokeMode.targetHash?.replace(/^#/, ""),
    });
  }

  return windowInstance;
}

function installRendererTrustPolicy(windowInstance: BrowserWindow): void {
  windowInstance.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  windowInstance.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });
  windowInstance.webContents.on("will-redirect", (event) => {
    event.preventDefault();
  });
  windowInstance.webContents.on(
    "render-process-gone",
    (_event, details: RenderProcessGoneDetails) => {
      handleRendererProcessGone(windowInstance, details);
    },
  );
}

function handleRendererProcessGone(
  windowInstance: BrowserWindow,
  details: RenderProcessGoneDetails,
): void {
  console.error("[renderer] render process gone", {
    reason: details.reason,
    exitCode: details.exitCode,
  });
  if (isQuitting || !shouldRecoverRendererProcess(details.reason)) {
    return;
  }

  const decision = rendererCrashRecovery.recordCrash();
  if (mainWindow === windowInstance) {
    mainWindow = null;
  }
  if (!windowInstance.isDestroyed()) {
    windowInstance.destroy();
  }

  if (!decision.recover) {
    dialog.showErrorBox(
      `${appMeta.productName} renderer repeatedly crashed`,
      `The renderer crashed ${decision.crashCount} times within one minute. ` +
        "The application will shut down so runtime work can drain safely.",
    );
    app.quit();
    return;
  }

  const retry = setTimeout(() => {
    if (!isQuitting && !mainWindow) {
      createMainWindow();
    }
  }, 250);
  retry.unref?.();
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
        label: "后台运行中",
        enabled: false,
      },
      {
        label: `显示 ${appMeta.productName}`,
        click: () => {
          createMainWindow();
        },
      },
      { type: "separator" },
      {
        label: "打开任务记录",
        click: () => navigateRendererTo("runs"),
      },
      {
        label: "打开自动任务",
        click: () => navigateRendererTo("scheduled-tasks"),
      },
      {
        label: "打开设置",
        click: () => navigateRendererTo("model-settings"),
      },
      { type: "separator" },
      {
        label: "关于 Zerox Agent",
        click: () => {
          void dialog.showMessageBox({
            type: "info",
            title: appMeta.productName,
            message: "Zerox Agent 正在本地运行。",
            detail:
              `版本 ${app.getVersion()}。它会在后台保留定时任务、运行日志、工具权限和本地记忆。`,
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

function installApplicationMenu() {
  const appMenu: MenuItemConstructorOptions[] =
    process.platform === "darwin"
      ? [
          {
            label: appMeta.productName,
            submenu: [
              { role: "about" },
              { type: "separator" },
              {
                label: "设置...",
                accelerator: "Command+,",
                click: () => navigateRendererTo("model-settings"),
              },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : [];

  const template: MenuItemConstructorOptions[] = [
    ...appMenu,
    {
      label: "文件",
      submenu: [
        {
          label: "打开会话",
          accelerator: "CmdOrCtrl+1",
          click: () => navigateRendererTo("chat"),
        },
        {
          label: "打开任务记录",
          accelerator: "CmdOrCtrl+2",
          click: () => navigateRendererTo("runs"),
        },
        {
          label: "打开自动任务",
          accelerator: "CmdOrCtrl+3",
          click: () => navigateRendererTo("scheduled-tasks"),
        },
        { type: "separator" },
        { role: "close" },
      ],
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "视图",
      submenu: [
        {
          label: "会话",
          click: () => navigateRendererTo("chat"),
        },
        {
          label: "任务记录",
          click: () => navigateRendererTo("runs"),
        },
        {
          label: "设置",
          click: () => navigateRendererTo("model-settings"),
        },
        { type: "separator" },
        ...(app.isPackaged
          ? []
          : ([
              { role: "reload" },
              { role: "toggleDevTools" },
              { type: "separator" },
            ] satisfies MenuItemConstructorOptions[])),
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "窗口",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(process.platform === "darwin"
          ? ([{ type: "separator" }, { role: "front" }] satisfies MenuItemConstructorOptions[])
          : ([{ role: "close" }] satisfies MenuItemConstructorOptions[])),
      ],
    },
    {
      label: "帮助",
      submenu: [
        {
          label: "显示 Zerox Agent",
          click: () => createMainWindow(),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function navigateRendererTo(hash: string) {
  const windowInstance = createMainWindow();
  const nextHash = hash.startsWith("#") ? hash : `#${hash}`;
  const script = `window.location.hash = ${JSON.stringify(nextHash)}`;
  const applyHash = () => {
    void windowInstance.webContents.executeJavaScript(script, true).catch(() => {
      // Navigation is best-effort; the visible app can still be used manually.
    });
  };

  if (windowInstance.webContents.isLoading()) {
    windowInstance.webContents.once("did-finish-load", applyHash);
  } else {
    applyHash();
  }
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

  const settle = createProductionSmokeSettler(({ code, message }) => {
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
  });
  const exit = (code: number, message: string) => {
    settle({ code, message });
  };

  timeout = setTimeout(() => {
    exit(1, `Smoke startup timed out after ${smokeMode.timeoutMs}ms.`);
  }, smokeMode.timeoutMs);
  timeout.unref?.();

  windowInstance.webContents.once("did-finish-load", () => {
    const script = smokeMode.performanceEnabled
      ? getSmokeRendererPerformanceScript(smokeMode)
      : getSmokeRendererCheckScript(smokeMode);
    void Promise.all([
      windowInstance.webContents.executeJavaScript(script, true),
      runProductionStorageSmokeCheck(),
    ])
      .then(([result, storageCheck]: [unknown, ProductionStorageSmokeCheck]) => {
        const rendererPassed =
          (isSmokeRendererPerformanceResult(result) && result.ok) ||
          (isSmokeRendererCheckResult(result) && result.ok);
        const acceptance = evaluateProductionSmokeAcceptance({
          rendererPassed,
          storageRequired: storageCheck.required,
          storagePassed: storageCheck.passed,
        });
        if (!acceptance.ok && acceptance.failedChecks.includes("storage")) {
          exit(1, `Production storage smoke failed: ${storageCheck.message}`);
          return;
        }
        if (isSmokeRendererPerformanceResult(result)) {
          exit(
            result.ok ? 0 : 1,
            `${getSmokeRendererPerformanceMessage(result)}${storageCheck.message}`,
          );
          return;
        }
        if (isSmokeRendererCheckResult(result) && result.ok) {
          exit(
            0,
            `Smoke startup passed: renderer rendered agent chat UI.${storageCheck.message}`,
          );
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

type ProductionStorageSmokeCheck = {
  required: boolean;
  passed: boolean;
  message: string;
  evidence?: ProductionStorageSmokeEvidence;
};

async function runProductionStorageSmokeCheck(): Promise<ProductionStorageSmokeCheck> {
  if (process.env.ZEROX_PRODUCTION_SMOKE_REQUIRE_SQLITE !== "1") {
    return { required: false, passed: true, message: "" };
  }

  try {
    const evidencePath =
      process.env.ZEROX_PRODUCTION_SMOKE_EVIDENCE_FILE?.trim();
    if (!evidencePath) {
      throw new Error("ZEROX_PRODUCTION_SMOKE_EVIDENCE_FILE is required.");
    }
    const evidence = await container.runProductionStorageSmoke();
    await mkdir(path.dirname(evidencePath), { recursive: true });
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    console.log(`[smoke:storage] ${JSON.stringify(evidence)}`);
    return {
      required: true,
      passed: true,
      message:
        ` Native SQLite authority passed (Electron ABI ${evidence.nativeRuntime.modulesAbi}, ` +
        `migrations=${evidence.sqlite.migrationCount}, domains=${evidence.authority.markerCount}, ` +
        `task=${evidence.sqlite.taskId}).`,
      evidence,
    };
  } catch (error) {
    return {
      required: true,
      passed: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function startTaskScheduler() {
  if (taskSchedulerTimer) {
    return;
  }

  void container.taskSchedulerService().runDueTasks().catch((error: unknown) => {
    console.warn("[lifecycle] taskScheduler initial runDueTasks failed:", error);
  });
  taskSchedulerTimer = setInterval(() => {
    void container.taskSchedulerService().runDueTasks().catch((error: unknown) => {
      console.warn("[lifecycle] taskScheduler runDueTasks failed:", error);
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
    void container.memoryStore().runMaintenance().catch((error: unknown) => {
      console.warn("[lifecycle] memoryMaintenance failed:", error);
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

function startAppUpdateScheduler() {
  if (appUpdateTimer) {
    return;
  }
  void appUpdateService.start();
  appUpdateTimer = setInterval(() => {
    void appUpdateService.checkForUpdates();
  }, appUpdateIntervalMs);
  appUpdateTimer.unref?.();
}

/**
 * Env-driven end-to-end goal replay driver (debug/acceptance aid).
 *
 * When ZEROX_AGENT_REPLAY_GOAL_ID is set, retries that goal through the
 * fully wired production container, polls its persisted state from disk,
 * logs [GOAL-REPLAY] progress lines, and quits on a terminal status or on
 * ZEROX_AGENT_REPLAY_TIMEOUT_MS (default 10 minutes). Used to replay
 * historically failed goals against the live provider for acceptance.
 */
function startGoalReplayDriver() {
  const goalId = process.env.ZEROX_AGENT_REPLAY_GOAL_ID?.trim();
  if (!goalId) return;
  assertSafeStoreEntityId(goalId, "Agent replay goal id");
  const timeoutMs = Math.max(
    60_000,
    Number(process.env.ZEROX_AGENT_REPLAY_TIMEOUT_MS ?? 600_000) || 600_000,
  );
  const goalFile = path.join(
    app.getPath("userData"),
    "config",
    "agent-goals",
    `${goalId}.json`,
  );
  const startedAt = Date.now();
  const log = (message: string, extra?: unknown) => {
    const suffix = extra === undefined ? "" : ` ${stringifyRedactedCredentials(extra)}`;
    console.log(`[GOAL-REPLAY] ${message}${suffix}`);
  };
  const readGoalState = async () => {
    try {
      const raw = await readFile(goalFile, "utf8");
      const goal = JSON.parse(raw) as {
        status: string;
        stopReason?: string;
        milestones?: Array<{
          id: string;
          state?: string;
          attempts?: number;
          lastRunStatus?: string;
          lastRunSummary?: string;
        }>;
      };
      return goal;
    } catch (error) {
      log("无法读取目标状态文件", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  };
  const isTerminal = (status: string) =>
    [
      "achieved",
      "completed_unverified",
      "stopped_budget",
      "stopped_stalled",
      "stopped_blocked",
      "failed",
      "canceled",
    ].includes(status);

  log("回放驱动已启动", { goalId, timeoutMs });
  setTimeout(() => {
    void (async () => {
      try {
        log("触发 retryGoal", { goalId });
        const summary = await container.retryGoal(goalId);
        log("retryGoal 已受理", summary as unknown as Record<string, unknown>);
      } catch (error) {
        log("retryGoal 失败", {
          error: error instanceof Error ? error.message : String(error),
        });
        app.exit(2);
      }
    })();
  }, 3_000);

  const poller = setInterval(() => {
    void (async () => {
      const elapsed = Date.now() - startedAt;
      const goal = await readGoalState();
      if (goal) {
        log("状态轮询", {
          elapsedMs: elapsed,
          status: goal.status,
          stopReason: goal.stopReason,
          milestones: (goal.milestones ?? []).map((milestone) => ({
            id: milestone.id,
            state: milestone.state,
            attempts: milestone.attempts,
            lastRunStatus: milestone.lastRunStatus,
            lastRunSummary: milestone.lastRunSummary?.slice(0, 160),
          })),
        });
        if (isTerminal(goal.status)) {
          clearInterval(poller);
          log("目标到达终态，即将退出", {
            status: goal.status,
            stopReason: goal.stopReason,
          });
          setTimeout(() => app.exit(0), 5_000);
        }
      }
      if (elapsed >= timeoutMs) {
        clearInterval(poller);
        log("回放超时，即将退出", { timeoutMs });
        setTimeout(() => app.exit(3), 5_000);
      }
    })();
  }, 15_000);
  poller.unref?.();
}

/**
 * Env-driven plan replay driver (debug/acceptance aid).
 *
 * When ZEROX_AGENT_REPLAY_PLAN_ID is set, reruns that paused plan from its
 * failed round through the fully wired production container
 * (`retryFailedRound`), logs [PLAN-REPLAY] lines including persisted
 * failure excerpts, and exits 0 when the plan leaves the paused/failed
 * state, 3 when it stays paused, 2 on driver error, 4 on timeout
 * (ZEROX_AGENT_REPLAY_TIMEOUT_MS, default 10 minutes).
 */
function startPlanReplayDriver() {
  const planId = process.env.ZEROX_AGENT_REPLAY_PLAN_ID?.trim();
  if (!planId) return;
  assertSafePlanId(planId);
  const timeoutMs = Math.max(
    60_000,
    Number(process.env.ZEROX_AGENT_REPLAY_TIMEOUT_MS ?? 600_000) || 600_000,
  );
  const planFile = path.join(
    app.getPath("userData"),
    "config",
    "plans",
    `${planId}.json`,
  );
  const log = (message: string, extra?: unknown) => {
    const suffix = extra === undefined ? "" : ` ${stringifyRedactedCredentials(extra)}`;
    console.log(`[PLAN-REPLAY] ${message}${suffix}`);
  };
  const readPlan = async () => {
    try {
      const raw = await readFile(planFile, "utf8");
      return JSON.parse(raw) as {
        status: string;
        rounds?: Array<{
          kind: string;
          status: string;
          error?: string;
          failureExcerpt?: string;
        }>;
        planningStages?: Array<{ kind: string; status: string; error?: string }>;
      };
    } catch (error) {
      log("无法读取计划文件", {
        category: classifyPlanReplayReadFailure(error),
      });
      return null;
    }
  };
  const logPlanDetail = async (heading: string) => {
    const plan = await readPlan();
    if (!plan) return;
    log(heading, { status: plan.status });
    for (const round of plan.rounds ?? []) {
      log("轮次状态", {
        kind: round.kind,
        status: round.status,
        diagnosticOmitted: Boolean(round.error || round.failureExcerpt),
      });
    }
    for (const stage of plan.planningStages ?? []) {
      if (stage.status === "failed") {
        log("阶段失败", {
          kind: stage.kind,
          diagnosticOmitted: Boolean(stage.error),
        });
      }
    }
  };

  log("回放驱动已启动", { planId, timeoutMs });
  const timeout = setTimeout(() => {
    log("回放超时，即将退出", { timeoutMs });
    app.exit(4);
  }, timeoutMs);
  timeout.unref?.();

  setTimeout(() => {
    void (async () => {
      try {
        await logPlanDetail("重试前状态");
        log("触发 retryFailedRound", { planId });
        const result = await container
          .planDebateOrchestrator()
          .retryFailedRound(planId);
        log("retryFailedRound 完成", {
          ok: result.ok,
          message: result.message,
          status: result.plan?.status,
        });
        await logPlanDetail("重试后状态");
        clearTimeout(timeout);
        const terminal =
          result.plan?.status && result.plan.status !== "paused";
        app.exit(terminal ? 0 : 3);
      } catch (error) {
        log("retryFailedRound 失败", {
          category: classifyPlanReplayReadFailure(error),
        });
        clearTimeout(timeout);
        app.exit(2);
      }
    })();
  }, 3_000);
}

function stopAppUpdateScheduler() {
  if (!appUpdateTimer) {
    return;
  }
  clearInterval(appUpdateTimer);
  appUpdateTimer = null;
}

app.whenReady().then(async () => {
  await runStartupRecoverySequence({
    initializeStorageConvergence: () => container.initializeStorageConvergence(),
    reconcileRequiredConversationSettlements: () =>
      reconcileRequiredConversationSettlements({
        conversationCausalStore,
        chatSessionStore: container.chatSessionStore(),
        workspaceRunStore: container.workspaceRunStore(),
      }),
    reconcileAgentRunAdmissions: () => container.reconcileAgentRunAdmissions(),
    interruptPriorProcessApprovals: () => toolApprovalCoordinator.initialize(
      (approvals) => container.reconcileInterruptedApprovals(approvals),
    ),
    interruptActiveCausalAttempts: () =>
      conversationCausalStore.interruptActiveAttempts(),
  });
  const preparedDisclosureScenario = disclosureAcceptanceMode.enabled
    ? await prepareConversationDisclosureScenario(
        container,
        disclosureAcceptanceMode,
        processEpoch,
      )
    : null;
  registerAllIpcHandlers(container, {
    appUpdateService,
    isTrustedSender: isTrustedRendererIpcEvent,
    ...(disclosureAcceptanceMode.enabled
      ? { onTrustedInvocation: disclosureAcceptanceIpc.observe }
      : {}),
  });
  registerToolApprovalIpcHandlers();
  registerKernelIpcHandlers();

  if (validationMode.enabled) {
    void runValidationModeAndExit();
    return;
  }
  if (disclosureAcceptanceMode.enabled && preparedDisclosureScenario) {
    startupComplete = true;
    const windowInstance = createMainWindow();
    try {
      const receipt = await runConversationDisclosureScenario({
        container,
        window: windowInstance,
        mode: disclosureAcceptanceMode,
        processEpoch,
        ipcInvocations: disclosureAcceptanceIpc.snapshot,
        prepared: preparedDisclosureScenario,
        approvalCoordinator: toolApprovalCoordinator,
      });
      console.log(`[cd09:scenario] ${JSON.stringify(receipt)}`);
      isQuitting = true;
      app.exit(0);
    } catch (error) {
      console.error(
        `[cd09:scenario] ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      isQuitting = true;
      app.exit(1);
    }
    return;
  }
  installApplicationMenu();
  if (smokeMode.performanceEnabled) {
    await seedPerformanceSmokeSessions();
  }

  if (app.isPackaged) {
    app.setLoginItemSettings(
      shouldApplyLoginStartup(true, process.env)
        ? getDefaultLoginItemSettings()
        : getDisabledLoginItemSettings(),
    );
  }
  try {
    const iconPath = path.resolve(app.getAppPath(), "logo.png");
    const appIcon = nativeImage.createFromPath(iconPath);
    if (!appIcon.isEmpty() && process.platform === "darwin" && app.dock) {
      app.dock.setIcon(appIcon);
    }
  } catch {
    // Icon is cosmetic; don't block startup on failure
  }
  startupComplete = true;
  if (
    shouldCreateMainWindowAtStartup(
      Boolean(app.getLoginItemSettings().wasOpenedAsHidden),
    )
  ) {
    createMainWindow();
  }

  if (!smokeMode.enabled) {
    void container.resumeInterruptedGoals().catch((error) => {
      console.error("Failed to resume interrupted goals:", error);
    });
    startGoalReplayDriver();
    startPlanReplayDriver();
    createTray();
    startTaskScheduler();
    startMemoryMaintenanceScheduler();
    startAppUpdateScheduler();
    // P7: start the self-improvement scheduler (dream + distill). Default OFF
    // (ZEROX_SELF_IMPROVEMENT=off); a no-op start() when disabled.
    container.selfImprovementService()?.start();
  }

  app.on("activate", () => {
    if (shouldRestoreMainWindowOnActivate(smokeMode.enabled)) {
      createMainWindow();
    }
  });
}).catch((error: unknown) => {
  console.error(
    `[lifecycle] Application startup failed: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  app.exit(1);
});

async function seedPerformanceSmokeSessions(): Promise<void> {
  const store = container.chatSessionStore();
  const existing = await store.list();
  if (
    existing.length >= 6 &&
    existing.some((session) => session.messageCount >= 400)
  ) {
    return;
  }

  for (let sessionIndex = 0; sessionIndex < 6; sessionIndex += 1) {
    let sessionId: string | undefined;
    const messageCount = sessionIndex === 0 ? 480 : 12;
    for (let messageIndex = 0; messageIndex < messageCount; messageIndex += 1) {
      const appended = await store.appendMessage({
        ...(sessionId ? { sessionId } : {}),
        role: messageIndex % 2 === 0 ? "user" : "assistant",
        content:
          `Performance smoke session ${sessionIndex + 1}, message ${messageIndex + 1}. ` +
          "Bounded transcript payload verifies SQLite paging, IPC cloning, and renderer windowing.",
      });
      sessionId = appended.session.id;
    }
    if (sessionId && sessionIndex >= 4) {
      await store.archive(sessionId);
    }
  }
}

function registerToolApprovalIpcHandlers() {
  ipcMain.handle("toolApproval:listPending", (event) => {
    assertTrustedRendererIpcEvent(event);
    return observeAcceptanceIpc(
      "toolApproval:listPending",
      () => toolApprovalCoordinator.pendingSnapshot(),
    );
  });
  ipcMain.handle("toolApproval:getMode", (event) => {
    assertTrustedRendererIpcEvent(event);
    return observeAcceptanceIpc(
      "toolApproval:getMode",
      () => toolApprovalCoordinator.getAutoApprovalState(),
    );
  });
  ipcMain.handle(
    "toolApproval:setAutoApprovalEnabled",
    (event, enabled: boolean) => {
      assertTrustedRendererIpcEvent(event);
      return observeAcceptanceIpc(
        "toolApproval:setAutoApprovalEnabled",
        () => toolApprovalCoordinator.setAutoApprovalEnabled(Boolean(enabled)),
      );
    },
  );
  ipcMain.handle(
    "toolApproval:setGoalModeEnabled",
    (event, enabled: boolean) => {
      assertTrustedRendererIpcEvent(event);
      return observeAcceptanceIpc(
        "toolApproval:setGoalModeEnabled",
        () => toolApprovalCoordinator.setGoalModeEnabled(Boolean(enabled)),
      );
    },
  );
  ipcMain.handle(
    "toolApproval:resolve",
    (event, input: ResolveToolApprovalInput) => {
      assertTrustedRendererIpcEvent(event);
      return observeAcceptanceIpc(
        "toolApproval:resolve",
        () => toolApprovalCoordinator.resolveApproval(input),
      );
    },
  );
}

function observeAcceptanceIpc<T>(
  channel: string,
  operation: () => T | Promise<T>,
): T | Promise<T> {
  try {
    const result = operation();
    if (result && typeof result === "object" && "then" in result) {
      return Promise.resolve(result).then(
        (value) => {
          disclosureAcceptanceIpc.observe({ channel, ok: true });
          return value;
        },
        (error) => {
          disclosureAcceptanceIpc.observe({ channel, ok: false });
          throw error;
        },
      );
    }
    disclosureAcceptanceIpc.observe({ channel, ok: true });
    return result;
  } catch (error) {
    disclosureAcceptanceIpc.observe({ channel, ok: false });
    throw error;
  }
}

function registerKernelIpcHandlers() {
  const kernelEventBus = container.kernelEventBus();
  unsubscribeKernelEvents = kernelEventBus.subscribe((event) => {
    sendToRendererWindows(KERNEL_IPC.event, event);
  });

  ipcMain.handle(KERNEL_IPC.subscribe, (event) => {
    assertTrustedRendererIpcEvent(event);
    return kernelEventBus.history();
  });
  ipcMain.handle(KERNEL_IPC.resumeRun, (event, checkpointRef: string) => {
    assertTrustedRendererIpcEvent(event);
    return container.resumeAgentRun(extractRunIdFromCheckpointRef(checkpointRef));
  });
  ipcMain.handle(KERNEL_IPC.updatePermissionRules, (event, rules: unknown) => {
    assertTrustedRendererIpcEvent(event);
    return container.setKernelPermissionRules(normalizePermissionRules(rules));
  });
  ipcMain.handle(KERNEL_IPC.respondPermission, (event, input: unknown) => {
    assertTrustedRendererIpcEvent(event);
    return resolveKernelPermission(input);
  });
}

function sendToRendererWindows(channel: string, payload: unknown) {
  for (const windowInstance of BrowserWindow.getAllWindows()) {
    if (!windowInstance.isDestroyed()) {
      windowInstance.webContents.send(channel, payload);
    }
  }
}

function isTrustedRendererIpcEvent(event: IpcMainInvokeEvent): boolean {
  const windowInstance = mainWindow;
  if (
    !windowInstance ||
    windowInstance.isDestroyed() ||
    event.sender !== windowInstance.webContents
  ) {
    return false;
  }
  const location = event.senderFrame?.url || event.sender.getURL();
  return isTrustedRendererLocation(location, rendererSource);
}

function assertTrustedRendererIpcEvent(event: IpcMainInvokeEvent): void {
  if (!isTrustedRendererIpcEvent(event)) {
    throw new Error("Rejected untrusted renderer IPC sender.");
  }
}

function extractRunIdFromCheckpointRef(checkpointRef: string): string {
  const parts = String(checkpointRef).split(/[\\/]/).filter(Boolean);
  if (parts.length >= 3 && parts.at(-3) === "agent-executions") {
    return parts.at(-2) ?? checkpointRef;
  }
  if (parts.length >= 3 && parts.at(-3) === "kernel-checkpoints") {
    return parts.at(-2) ?? checkpointRef;
  }

  return checkpointRef;
}

function normalizePermissionRules(rules: unknown): PermissionRule[] {
  if (!Array.isArray(rules)) {
    return [];
  }

  return rules.flatMap((rule): PermissionRule[] => {
    if (!rule || typeof rule !== "object") {
      return [];
    }

    const pattern = "pattern" in rule ? String(rule.pattern).trim() : "";
    const action = "action" in rule ? rule.action : "";
    if (!pattern || !isPermissionRuleAction(action)) {
      return [];
    }

    return [{ pattern, action }];
  });
}

function isPermissionRuleAction(
  action: unknown,
): action is PermissionRule["action"] {
  return action === "allow" || action === "deny" || action === "ask";
}

async function resolveKernelPermission(input: unknown): Promise<{
  ok: boolean;
  message: string;
}> {
  const payload =
    input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const id =
    typeof payload.id === "string"
      ? payload.id
      : typeof payload.permissionId === "string"
        ? payload.permissionId
        : "";
  const approved =
    payload.decision === "allow"
      ? true
      : payload.decision === "deny"
        ? false
        : null;

  if (!id || approved === null) {
    return { ok: false, message: "Permission decision payload is invalid." };
  }

  const resolved = await toolApprovalCoordinator.resolveApproval({ id, approved });
  return resolved
    ? { ok: true, message: "Permission decision recorded." }
    : { ok: false, message: "No pending permission request matched." };
}

let shutdownStarted = false;
let shutdownComplete = false;
const shutdownDeadlineMs = 15_000;

app.on("before-quit", (event) => {
  isQuitting = true;
  if (shutdownComplete) {
    return;
  }
  event.preventDefault();
  if (shutdownStarted) {
    return;
  }
  shutdownStarted = true;
  unsubscribeKernelEvents?.();
  unsubscribeKernelEvents = null;
  stopTaskScheduler();
  stopMemoryMaintenanceScheduler();
  stopAppUpdateScheduler();
  const drain = (async () => {
    await toolApprovalCoordinator.rejectAllPending();
    const results = await Promise.allSettled([
      shutdownActiveChatMessages(),
      container.shutdownRuntime(),
    ]);
    const failures = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failures.length > 0) {
      throw new AggregateError(
        failures.map((failure) => failure.reason),
        "One or more shutdown resources failed.",
      );
    }
  })();
  void settleShutdownWithDeadline(drain, shutdownDeadlineMs).then((result) => {
    if (result === "timed_out") {
      console.error(
        `[lifecycle] Shutdown drain exceeded ${shutdownDeadlineMs}ms; forcing application exit.`,
      );
    } else if (result === "failed") {
      console.error("[lifecycle] Shutdown drain failed; forcing application exit.");
    }
    shutdownComplete = true;
    app.quit();
  });
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
      modelSettingsStore: container.modelSettingsStore,
      validateAgent: () => container.agentBootstrapService().validate(),
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
