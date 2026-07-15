import { randomUUID } from "node:crypto";
import type { AppUpdateActionResult, AppUpdateState } from "../shared/appUpdate";
import {
  assertUpdateInfoMatchesManifest,
  type VerifiedUpdateManifest,
  updateSequenceForVersion,
} from "./appUpdateManifest";
import type { UpdateHighWaterStore } from "./appUpdateHighWater";

type UpdateInfoLike = {
  version?: string;
  files?: Array<{
    url?: string;
    sha512?: string;
    size?: number;
    sha2?: unknown;
    packageInfo?: unknown;
    packages?: unknown;
    blockMapSize?: unknown;
    isAdminRightsRequired?: unknown;
  }>;
  path?: string;
  sha512?: string;
  tag?: string;
  packages?: unknown;
  sha2?: unknown;
  downloadedFile?: string;
};

type UpdateCheckResultLike = {
  isUpdateAvailable?: boolean;
  updateInfo?: UpdateInfoLike;
};

type DownloadProgressLike = {
  percent?: number;
};

export type AppUpdaterAdapter = {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
  disableDifferentialDownload: boolean;
  checkForUpdates(): Promise<UpdateCheckResultLike | null>;
  downloadUpdate(): Promise<string[]>;
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
  loadVerifiedUpdateManifest?: () => Promise<VerifiedUpdateManifest>;
  updateHighWaterStore?: UpdateHighWaterStore;
  verifyDownloadedUpdate?: (
    downloadedPath: string,
    manifest: VerifiedUpdateManifest,
  ) => Promise<void>;
}) {
  const now = options.now ?? (() => new Date());
  let started = false;
  let checkPromise: Promise<AppUpdateState> | null = null;
  let authorizedAttempt: {
    id: string;
    manifest: VerifiedUpdateManifest;
    updateInfo: UpdateInfoLike;
    downloadedInfo: UpdateInfoLike | null;
    downloadedFile: string | null;
    downloadedAttemptId: string | null;
  } | null = null;
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

  function clearAuthorization(): void {
    authorizedAttempt = null;
  }

  function bindUpdaterEvents(): void {
    options.updater.on("checking-for-update", () => {
      if (state.phase !== "checking" || authorizedAttempt) return;
      update({ phase: "checking", message: "正在检查新版本…" });
    });
    options.updater.on("update-available", (info) => {
      if (state.phase !== "checking" || authorizedAttempt) return;
      update({
        phase: "checking",
        availableVersion: normalizeVersion(info.version),
        message: "发现新版本，正在验证发布签名…",
      });
    });
    // The awaited check result is authoritative. Ignoring this advisory event
    // prevents a delayed event from revoking a newer active download attempt.
    options.updater.on("update-not-available", () => undefined);
    options.updater.on("download-progress", (progress) => {
      if (!authorizedAttempt || state.phase !== "downloading") return;
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
      const attempt = authorizedAttempt;
      try {
        if (!attempt || state.phase !== "downloading") {
          throw new Error("没有有效的下载授权");
        }
        assertUpdateInfoMatchesManifest(info, attempt.manifest);
      } catch {
        clearAuthorization();
        update({
          phase: "error",
          checkedAt: now().toISOString(),
          message: "更新下载结果与已验证的发布签名不一致。",
        });
        return;
      }
      attempt.downloadedInfo = cloneUpdateInfo(info);
      attempt.downloadedFile =
        typeof info.downloadedFile === "string" ? info.downloadedFile : null;
    });
    // checkForUpdates/downloadUpdate both reject after emitting `error`; their
    // awaited catch path owns state so a late event cannot corrupt a new phase.
    options.updater.on("error", () => undefined);
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
        if (!options.loadVerifiedUpdateManifest) {
          throw new Error("更新签名验证器不可用");
        }
        const manifest = await options.loadVerifiedUpdateManifest();
        if (!options.updateHighWaterStore) {
          throw new Error("更新防重放存储不可用");
        }
        const highWater = await options.updateHighWaterStore.load();
        if (highWater && highWater.keyId !== manifest.keyId) {
          throw new Error("更新签名密钥与本地防重放状态不一致");
        }
        if (manifest.sequence < updateSequenceForVersion(options.currentVersion)) {
          throw new Error("已签名更新序号低于当前应用版本");
        }
        if (highWater && manifest.sequence < highWater.sequence) {
          throw new Error("已签名更新序号低于本地已接受版本");
        }
        const versionOrder = compareStableVersions(
          manifest.version,
          options.currentVersion,
        );
        if (versionOrder < 0) {
          throw new Error("已签名更新版本低于当前版本");
        }
        if (versionOrder === 0) {
          await options.updateHighWaterStore.save(
            manifest,
            now().toISOString(),
          );
          clearAuthorization();
          update({
            phase: "up_to_date",
            checkedAt: now().toISOString(),
            message: "当前已是最新版本。",
          });
          return { ...state };
        }
        const result = await options.updater.checkForUpdates();
        if (!result?.isUpdateAvailable || !result.updateInfo) {
          throw new Error("更新服务器结果与已签名的新版本不一致");
        }
        assertUpdateInfoMatchesManifest(result.updateInfo, manifest);
        await options.updateHighWaterStore.save(
          manifest,
          now().toISOString(),
        );
        authorizedAttempt = {
          id: randomUUID(),
          manifest,
          updateInfo: cloneUpdateInfo(result.updateInfo),
          downloadedInfo: null,
          downloadedFile: null,
          downloadedAttemptId: null,
        };
        update({
          phase: "downloading",
          availableVersion: manifest.version,
          progressPercent: 0,
          message: "发布签名验证通过，正在后台下载…",
        });
        if (!options.verifyDownloadedUpdate) {
          throw new Error("更新下载文件验证器不可用");
        }
        const attemptId = authorizedAttempt.id;
        await options.updater.downloadUpdate();
        const completedAttempt = authorizedAttempt;
        if (
          !completedAttempt ||
          completedAttempt.id !== attemptId ||
          !completedAttempt.downloadedInfo ||
          !completedAttempt.downloadedFile
        ) {
          throw new Error("更新下载完成事件不属于当前授权尝试");
        }
        assertUpdateInfoMatchesManifest(
          completedAttempt.downloadedInfo,
          completedAttempt.manifest,
        );
        await options.verifyDownloadedUpdate(
          completedAttempt.downloadedFile,
          completedAttempt.manifest,
        );
        if (authorizedAttempt?.id !== attemptId) {
          throw new Error("更新下载授权在文件验证期间已失效");
        }
        completedAttempt.downloadedAttemptId = attemptId;
        update({
          phase: "downloaded",
          availableVersion: completedAttempt.manifest.version,
          progressPercent: 100,
          checkedAt: now().toISOString(),
          message: "新版本已下载，可立即更新。",
        });
      } catch (error) {
        clearAuthorization();
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
    options.updater.autoDownload = false;
    options.updater.autoInstallOnAppQuit = false;
    options.updater.allowPrerelease = false;
    options.updater.allowDowngrade = false;
    options.updater.disableDifferentialDownload = true;
    bindUpdaterEvents();
    return checkForUpdates();
  }

  async function installDownloadedUpdate(): Promise<AppUpdateActionResult> {
    const attempt = authorizedAttempt;
    if (
      state.phase !== "downloaded" ||
      !attempt ||
      attempt.downloadedAttemptId !== attempt.id ||
      !attempt.downloadedInfo
    ) {
      return {
        ok: false,
        state: { ...state },
        message: "更新尚未下载完成。",
      };
    }
    try {
      assertUpdateInfoMatchesManifest(attempt.updateInfo, attempt.manifest);
      assertUpdateInfoMatchesManifest(attempt.downloadedInfo, attempt.manifest);
    } catch {
      clearAuthorization();
      const rejectedState = update({
        phase: "error",
        checkedAt: now().toISOString(),
        message: "更新安装授权与已验证的发布签名不一致。",
      });
      return {
        ok: false,
        state: rejectedState,
        message: rejectedState.message ?? "更新安装授权无效。",
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

function cloneUpdateInfo(info: UpdateInfoLike): UpdateInfoLike {
  return {
    version: info.version,
    tag: info.tag,
    path: info.path,
    sha512: info.sha512,
    files: info.files?.map((file) => ({ ...file })),
  };
}

function compareStableVersions(left: string, right: string): number {
  const parse = (value: string) => {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value.trim().replace(/^v/i, ""));
    if (!match) throw new Error("应用版本格式无效");
    return match.slice(1).map((part) => Number(part));
  };
  const leftParts = parse(left);
  const rightParts = parse(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
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
