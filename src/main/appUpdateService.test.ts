import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createAppUpdateService } from "./appUpdateService";
import type { VerifiedUpdateManifest } from "./appUpdateManifest";
import type { UpdateHighWater, UpdateHighWaterStore } from "./appUpdateHighWater";

const sha512 = Buffer.alloc(64, 7).toString("base64");

function verifiedManifest(version = "3.7.2"): VerifiedUpdateManifest {
  const zip = `Zerox-Agent-${version}-arm64.zip`;
  return {
    version,
    files: [
      { url: zip, sha512, size: 100 },
      { url: `Zerox-Agent-${version}-arm64.dmg`, sha512, size: 200 },
    ],
    path: zip,
    sha512,
    keyId: "a".repeat(32),
    tag: `v${version}`,
    sequence: Number(version.split(".")[0]) * 1_000_000 +
      Number(version.split(".")[1]) * 1_000 +
      Number(version.split(".")[2]),
    issuedAt: "2026-07-14T00:00:00.000Z",
    expiresAt: "2027-07-14T00:00:00.000Z",
  };
}

function memoryHighWater(initial: UpdateHighWater | null = null): UpdateHighWaterStore {
  let value = initial;
  return {
    load: vi.fn(async () => value),
    save: vi.fn(async (manifest, acceptedAt) => {
      if (value && manifest.sequence < value.sequence) {
        throw new Error("已签名更新序号低于本地已接受版本");
      }
      value = {
        schema: 1,
        keyId: manifest.keyId,
        sequence: manifest.sequence,
        version: manifest.version,
        tag: manifest.tag,
        acceptedAt,
      };
    }),
  };
}

class FakeUpdater extends EventEmitter {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  allowPrerelease = true;
  allowDowngrade = true;
  disableDifferentialDownload = false;
  checkForUpdates = vi.fn(async () => ({
    isUpdateAvailable: false,
    updateInfo: verifiedManifest(),
  }));
  downloadUpdate = vi.fn(async (): Promise<string[]> => []);
  quitAndInstall = vi.fn();
}

describe("app update service", () => {
  it("stays disabled and offline outside packaged applications", async () => {
    const updater = new FakeUpdater();
    const service = createAppUpdateService({
      updater,
      enabled: false,
      currentVersion: "3.7.1",
    });

    await expect(service.start()).resolves.toMatchObject({ phase: "disabled" });
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    expect(service.getState()).toMatchObject({
      phase: "disabled",
      currentVersion: "3.7.1",
    });
  });

  it("checks automatically, downloads by default, and publishes bounded progress", async () => {
    const updater = new FakeUpdater();
    const states: string[] = [];
    const manifest = verifiedManifest();
    const verifyDownloadedUpdate = vi.fn(async () => undefined);
    updater.checkForUpdates.mockImplementation(async () => {
      updater.emit("update-available", manifest);
      return { isUpdateAvailable: true, updateInfo: manifest };
    });
    updater.downloadUpdate.mockImplementation(async () => {
      updater.emit("download-progress", { percent: 137.24 });
      updater.emit("update-downloaded", {
        ...manifest,
        downloadedFile: `/tmp/${manifest.path}`,
      });
      return [];
    });
    const service = createAppUpdateService({
      updater,
      enabled: true,
      currentVersion: "3.7.1",
      now: () => new Date("2026-07-14T15:20:00.000Z"),
      onStateChange: (state) => states.push(state.phase),
      loadVerifiedUpdateManifest: vi.fn(async () => manifest),
      updateHighWaterStore: memoryHighWater(),
      verifyDownloadedUpdate,
    });

    await service.start();

    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(updater.allowPrerelease).toBe(false);
    expect(updater.allowDowngrade).toBe(false);
    expect(updater.disableDifferentialDownload).toBe(true);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(verifyDownloadedUpdate).toHaveBeenCalledWith(
      `/tmp/${manifest.path}`,
      manifest,
    );
    expect(states).toContain("checking");
    expect(states).toContain("downloading");
    expect(service.getState()).toEqual({
      phase: "downloaded",
      currentVersion: "3.7.1",
      availableVersion: "3.7.2",
      progressPercent: 100,
      checkedAt: "2026-07-14T15:20:00.000Z",
      message: "新版本已下载，可立即更新。",
    });
    updater.emit("checking-for-update");
    updater.emit("update-available", manifest);
    updater.emit("update-not-available", manifest);
    expect(service.getState().phase).toBe("downloaded");
  });

  it("installs only after the update-downloaded event", async () => {
    const updater = new FakeUpdater();
    const onBeforeInstall = vi.fn();
    const manifest = verifiedManifest();
    let finishDownload!: () => void;
    updater.checkForUpdates.mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: manifest,
    });
    updater.downloadUpdate.mockImplementation(
      () => new Promise<string[]>((resolve) => {
        finishDownload = () => resolve([]);
      }),
    );
    const service = createAppUpdateService({
      updater,
      enabled: true,
      currentVersion: "3.7.1",
      onBeforeInstall,
      loadVerifiedUpdateManifest: vi.fn(async () => manifest),
      updateHighWaterStore: memoryHighWater(),
      verifyDownloadedUpdate: vi.fn(async () => undefined),
    });
    const startPromise = service.start();
    await vi.waitFor(() => expect(updater.downloadUpdate).toHaveBeenCalledTimes(1));

    await expect(service.installDownloadedUpdate()).resolves.toMatchObject({
      ok: false,
      message: "更新尚未下载完成。",
    });
    expect(updater.quitAndInstall).not.toHaveBeenCalled();

    updater.emit("update-downloaded", {
      ...manifest,
      downloadedFile: `/tmp/${manifest.path}`,
    });
    finishDownload();
    await startPromise;
    await expect(service.installDownloadedUpdate()).resolves.toMatchObject({
      ok: true,
      state: { phase: "installing", availableVersion: "3.7.2" },
    });
    expect(onBeforeInstall).toHaveBeenCalledTimes(1);
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true);
    expect(onBeforeInstall.mock.invocationCallOrder[0]).toBeLessThan(
      updater.quitAndInstall.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
  });

  it("sanitizes update errors and permits a later retry", async () => {
    const updater = new FakeUpdater();
    const service = createAppUpdateService({
      updater,
      enabled: true,
      currentVersion: "3.7.1",
      loadVerifiedUpdateManifest: vi.fn(async () => verifiedManifest()),
      updateHighWaterStore: memoryHighWater(),
      verifyDownloadedUpdate: vi.fn(async () => undefined),
    });
    await service.start();
    updater.emit(
      "error",
      new Error("GET https://updates.example.test/token-secret/latest.yml failed"),
    );

    expect(service.getState()).toMatchObject({
      phase: "error",
      message: expect.not.stringContaining("token-secret"),
    });
    await service.checkForUpdates();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it("refuses download when updater metadata differs from the signed manifest", async () => {
    const updater = new FakeUpdater();
    const manifest = verifiedManifest();
    updater.checkForUpdates.mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: {
        ...manifest,
        files: manifest.files.map((file, index) =>
          index === 0 ? { ...file, sha512: Buffer.alloc(64, 9).toString("base64") } : file,
        ),
      },
    });
    const service = createAppUpdateService({
      updater,
      enabled: true,
      currentVersion: "3.7.1",
      loadVerifiedUpdateManifest: vi.fn(async () => manifest),
      updateHighWaterStore: memoryHighWater(),
      verifyDownloadedUpdate: vi.fn(async () => undefined),
    });

    await expect(service.start()).resolves.toMatchObject({
      phase: "error",
      message: expect.stringContaining("哈希"),
    });
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
  });

  it("fails closed before contacting electron-updater when signature loading fails", async () => {
    const updater = new FakeUpdater();
    const service = createAppUpdateService({
      updater,
      enabled: true,
      currentVersion: "3.7.1",
      loadVerifiedUpdateManifest: vi.fn(async () => {
        throw new Error("更新清单签名验证失败");
      }),
      updateHighWaterStore: memoryHighWater(),
      verifyDownloadedUpdate: vi.fn(async () => undefined),
    });

    await expect(service.start()).resolves.toMatchObject({
      phase: "error",
      message: expect.stringContaining("签名验证失败"),
    });
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
  });

  it("treats an authenticated manifest for the current version as up to date", async () => {
    const updater = new FakeUpdater();
    const service = createAppUpdateService({
      updater,
      enabled: true,
      currentVersion: "3.7.1",
      loadVerifiedUpdateManifest: vi.fn(async () => verifiedManifest("3.7.1")),
      updateHighWaterStore: memoryHighWater(),
      verifyDownloadedUpdate: vi.fn(async () => undefined),
    });

    await expect(service.start()).resolves.toMatchObject({ phase: "up_to_date" });
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
  });

  it("rejects a replay below the persisted monotonic high-water mark", async () => {
    const updater = new FakeUpdater();
    const accepted = verifiedManifest("3.7.3");
    const store = memoryHighWater({
      schema: 1,
      keyId: accepted.keyId,
      sequence: accepted.sequence,
      version: accepted.version,
      tag: accepted.tag,
      acceptedAt: "2026-07-14T01:00:00.000Z",
    });
    const service = createAppUpdateService({
      updater,
      enabled: true,
      currentVersion: "3.7.1",
      loadVerifiedUpdateManifest: vi.fn(async () => verifiedManifest("3.7.2")),
      updateHighWaterStore: store,
      verifyDownloadedUpdate: vi.fn(async () => undefined),
    });

    await expect(service.start()).resolves.toMatchObject({
      phase: "error",
      message: expect.stringContaining("本地已接受版本"),
    });
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
  });

  it("requires full downloaded metadata from the same authorized attempt", async () => {
    const updater = new FakeUpdater();
    const manifest = verifiedManifest();
    updater.checkForUpdates.mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: manifest,
    });
    updater.downloadUpdate.mockImplementation(async () => {
      updater.emit("update-downloaded", { version: manifest.version });
      return [];
    });
    const service = createAppUpdateService({
      updater,
      enabled: true,
      currentVersion: "3.7.1",
      loadVerifiedUpdateManifest: vi.fn(async () => manifest),
      updateHighWaterStore: memoryHighWater(),
      verifyDownloadedUpdate: vi.fn(async () => undefined),
    });

    await expect(service.start()).resolves.toMatchObject({
      phase: "error",
      message: expect.stringContaining("下载完成事件"),
    });
    await expect(service.installDownloadedUpdate()).resolves.toMatchObject({ ok: false });
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });
});
