import type { AppUpdateActionResult, AppUpdateState } from "../shared/appUpdate";

type UpdateInfoLike = {
  version?: string;
};

type DownloadProgressLike = {
  percent?: number;
};

export type AppUpdaterAdapter = {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: "checking-for-update", listener: () => void): unknown;
  on(event: "update-available", listener: (info: UpdateInfoLike) => void): unknown;
  on(event: "update-not-available", listener: (info: UpdateInfoLike) => void): unknown;
  on(event: "download-progress", listener: (progress: DownloadProgressLike) => void): unknown;
  on(event: "update-downloaded", listener: (info: UpdateInfoLike) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
};

export type AppUpdateService = ReturnType<typeof createAppUpdateService>;

export function createAppUpdateService(options: {
  updater: AppUpdaterAdapter;
  enabled: boolean;
  currentVersion: string;
  now?: () => Date;
  onStateChange?: (state: AppUpdateState) => void;
  onBeforeInstall?: () => void;
}) {
  const now = options.now ?? (() => new Date());
  let started = false;
  let checkPromise: Promise<AppUpdateState> | null = null;
  let state: AppUpdateState = {
    phase: options.enabled ? "idle" : "disabled",
    currentVersion: options.currentVersion,
    ...(!options.enabled
      ? { message: "自动更新仅在已安装的正式应用中启用。" }
      : {}),
  };

  function publish(next: AppUpdateState): AppUpdateState {
    state = next;
    options.onStateChange?.({ ...state });
    return { ...state };
  }

  function update(
    patch: Omit<Partial<AppUpdateState>, "currentVersion"> &
      Pick<AppUpdateState, "phase">,
  ): AppUpdateState {
    return publish({
      currentVersion: options.currentVersion,
      ...patch,
    });
  }

  function bindUpdaterEvents(): void {
    options.updater.on("checking-for-update", () => {
      update({ phase: "checking", message: "正在检查新版本…" });
    });
    options.updater.on("update-available", (info) => {
      update({
        phase: "downloading",
        availableVersion: normalizeVersion(info.version),
        progressPercent: 0,
        message: "发现新版本，正在后台下载…",
      });
    });
    options.updater.on("update-not-available", () => {
      update({
        phase: "up_to_date",
        checkedAt: now().toISOString(),
        message: "当前已是最新版本。",
      });
    });
    options.updater.on("download-progress", (progress) => {
      update({
        phase: "downloading",
        ...(state.availableVersion
          ? { availableVersion: state.availableVersion }
          : {}),
        progressPercent: clampPercent(progress.percent),
        message: "正在后台下载新版本…",
      });
    });
    options.updater.on("update-downloaded", (info) => {
      update({
        phase: "downloaded",
        availableVersion:
          normalizeVersion(info.version) ?? state.availableVersion,
        progressPercent: 100,
        checkedAt: now().toISOString(),
        message: "新版本已下载，可立即更新。",
      });
    });
    options.updater.on("error", (error) => {
      update({
        phase: "error",
        checkedAt: now().toISOString(),
        message: sanitizeUpdateError(error),
      });
    });
  }

  async function checkForUpdates(): Promise<AppUpdateState> {
    if (!options.enabled) {
      return { ...state };
    }
    if (checkPromise) {
      return checkPromise;
    }
    if (
      state.phase === "downloading" ||
      state.phase === "downloaded" ||
      state.phase === "installing"
    ) {
      return { ...state };
    }

    checkPromise = (async () => {
      update({ phase: "checking", message: "正在检查新版本…" });
      try {
        await options.updater.checkForUpdates();
      } catch (error) {
        update({
          phase: "error",
          checkedAt: now().toISOString(),
          message: sanitizeUpdateError(error),
        });
      }
      return { ...state };
    })().finally(() => {
      checkPromise = null;
    });
    return checkPromise;
  }

  async function start(): Promise<AppUpdateState> {
    if (started || !options.enabled) {
      return { ...state };
    }
    started = true;
    options.updater.autoDownload = true;
    options.updater.autoInstallOnAppQuit = false;
    options.updater.allowPrerelease = false;
    bindUpdaterEvents();
    return checkForUpdates();
  }

  async function installDownloadedUpdate(): Promise<AppUpdateActionResult> {
    if (state.phase !== "downloaded") {
      return {
        ok: false,
        state: { ...state },
        message: "更新尚未下载完成。",
      };
    }
    const installingState = update({
      phase: "installing",
      ...(state.availableVersion
        ? { availableVersion: state.availableVersion }
        : {}),
      progressPercent: 100,
      message: "正在安装更新并重新打开应用…",
    });
    options.onBeforeInstall?.();
    options.updater.quitAndInstall(false, true);
    return { ok: true, state: installingState };
  }

  return {
    start,
    checkForUpdates,
    installDownloadedUpdate,
    getState: () => ({ ...state }),
  };
}
function normalizeVersion(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().replace(/^v/i, "");
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(normalized)
    ? normalized
    : undefined;
}

function clampPercent(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.round(Math.min(100, Math.max(0, value)) * 10) / 10;
}

function sanitizeUpdateError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const withoutUrls = raw.replace(/https?:\/\/\S+/gi, "更新服务器");
  const compact = withoutUrls.replace(/\s+/g, " ").trim().slice(0, 160);
  return compact
    ? `检查更新失败：${compact}`
    : "检查更新失败，请稍后重试。";
}
