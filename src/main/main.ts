import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Tray,
} from "electron";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getAgentValidationModeOptions } from "./agentValidationMode";
import { createAppContainer } from "./container";
import { registerAllIpcHandlers } from "./ipc";
import {
  getDefaultLoginItemSettings,
  getMainWindowOptions,
  getTrayTooltip,
  shouldApplyLoginStartup,
} from "./desktopLifecycle";
import { runDesktopAgentValidation } from "./desktopAgentValidator";
import { getAppMeta } from "../shared/appMeta";
import { createToolApprovalCoordinator } from "./toolApprovalCoordinator";
import type { ResolveToolApprovalInput } from "../shared/toolApproval";
import { KERNEL_IPC, type PermissionRule } from "../shared/kernelContract";
import {
  getSmokeModeOptions,
  getSmokeRendererCheckScript,
  getSmokeRendererFailureMessage,
  isSmokeRendererCheckResult,
} from "./smokeMode";

app.setName("Zerox Agent");

const rendererUrl = process.env.ELECTRON_RENDERER_URL;
const appMeta = getAppMeta();
const smokeMode = getSmokeModeOptions(process.env);
const validationMode = getAgentValidationModeOptions(process.env);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let taskSchedulerTimer: NodeJS.Timeout | null = null;
let memoryMaintenanceTimer: NodeJS.Timeout | null = null;
let unsubscribeKernelEvents: (() => void) | null = null;

const memoryMaintenanceIntervalMs = 30 * 60 * 1000;
const taskSchedulerIntervalMs = 60 * 1000;

const toolApprovalCoordinator = createToolApprovalCoordinator({
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
    },
  });
  mainWindow = windowInstance;

  if (smokeMode.viewport) {
    windowInstance.setSize(
      smokeMode.viewport.width,
      smokeMode.viewport.height,
      false,
    );
  }

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
      .executeJavaScript(getSmokeRendererCheckScript(smokeMode), true)
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

function startTaskScheduler() {
  if (taskSchedulerTimer) {
    return;
  }

  void container.taskSchedulerService().runDueTasks().catch(() => {
    // Background task scheduling is best-effort; run logs surface failures.
  });
  taskSchedulerTimer = setInterval(() => {
    void container.taskSchedulerService().runDueTasks().catch(() => {
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
    void container.memoryStore().runMaintenance().catch(() => {
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
  registerAllIpcHandlers(container);
  registerToolApprovalIpcHandlers();
  registerKernelIpcHandlers();

  if (validationMode.enabled) {
    void runValidationModeAndExit();
    return;
  }

  if (shouldApplyLoginStartup(app.isPackaged, process.env)) {
    app.setLoginItemSettings(getDefaultLoginItemSettings());
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
  createMainWindow();

  if (!smokeMode.enabled) {
    createTray();
    startTaskScheduler();
    startMemoryMaintenanceScheduler();
    // P7: start the self-improvement scheduler (dream + distill). Default OFF
    // (ZEROX_SELF_IMPROVEMENT=off); a no-op start() when disabled.
    container.selfImprovementService()?.start();
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

function registerToolApprovalIpcHandlers() {
  ipcMain.handle("toolApproval:getMode", () =>
    toolApprovalCoordinator.getAutoApprovalState(),
  );
  ipcMain.handle(
    "toolApproval:setAutoApprovalEnabled",
    (_event, enabled: boolean) =>
      toolApprovalCoordinator.setAutoApprovalEnabled(Boolean(enabled)),
  );
  ipcMain.handle(
    "toolApproval:resolve",
    (_event, input: ResolveToolApprovalInput) =>
    toolApprovalCoordinator.resolveApproval(input),
  );
}

function registerKernelIpcHandlers() {
  const kernelEventBus = container.kernelEventBus();
  unsubscribeKernelEvents = kernelEventBus.subscribe((event) => {
    sendToRendererWindows(KERNEL_IPC.event, event);
  });

  ipcMain.handle(KERNEL_IPC.subscribe, () => kernelEventBus.history());
  ipcMain.handle(KERNEL_IPC.resumeRun, (_event, checkpointRef: string) =>
    container.resumeAgentRun(extractRunIdFromCheckpointRef(checkpointRef)),
  );
  ipcMain.handle(KERNEL_IPC.updatePermissionRules, (_event, rules: unknown) =>
    container.setKernelPermissionRules(normalizePermissionRules(rules)),
  );
  ipcMain.handle(KERNEL_IPC.respondPermission, (_event, input: unknown) =>
    resolveKernelPermission(input),
  );
}

function sendToRendererWindows(channel: string, payload: unknown) {
  for (const windowInstance of BrowserWindow.getAllWindows()) {
    if (!windowInstance.isDestroyed()) {
      windowInstance.webContents.send(channel, payload);
    }
  }
}

function extractRunIdFromCheckpointRef(checkpointRef: string): string {
  const parts = String(checkpointRef).split(/[\\/]/).filter(Boolean);
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

function resolveKernelPermission(input: unknown): {
  ok: boolean;
  message: string;
} {
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

  const resolved = toolApprovalCoordinator.resolveApproval({ id, approved });
  return resolved
    ? { ok: true, message: "Permission decision recorded." }
    : { ok: false, message: "No pending permission request matched." };
}

app.on("before-quit", () => {
  isQuitting = true;
  unsubscribeKernelEvents?.();
  unsubscribeKernelEvents = null;
  stopTaskScheduler();
  stopMemoryMaintenanceScheduler();
  for (const client of container.getActiveMcpClients()) {
    try {
      client.disconnect();
    } catch {
      // Best-effort cleanup
    }
  }
  container.getActiveMcpClients().length = 0;
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
