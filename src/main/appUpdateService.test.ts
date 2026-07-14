import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createAppUpdateService } from "./appUpdateService";

class FakeUpdater extends EventEmitter {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  allowPrerelease = true;
  checkForUpdates = vi.fn(async () => null);
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
    const service = createAppUpdateService({
      updater,
      enabled: true,
      currentVersion: "3.7.1",
      now: () => new Date("2026-07-14T15:20:00.000Z"),
      onStateChange: (state) => states.push(state.phase),
    });

    await service.start();
    updater.emit("update-available", { version: "3.7.2" });
    updater.emit("download-progress", { percent: 137.24 });
    updater.emit("update-downloaded", { version: "3.7.2" });

    expect(updater.autoDownload).toBe(true);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(updater.allowPrerelease).toBe(false);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
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
  });

  it("installs only after the update-downloaded event", async () => {
    const updater = new FakeUpdater();
    const onBeforeInstall = vi.fn();
    const service = createAppUpdateService({
      updater,
      enabled: true,
      currentVersion: "3.7.1",
      onBeforeInstall,
    });
    await service.start();

    await expect(service.installDownloadedUpdate()).resolves.toMatchObject({
      ok: false,
      message: "更新尚未下载完成。",
    });
    expect(updater.quitAndInstall).not.toHaveBeenCalled();

    updater.emit("update-downloaded", { version: "3.7.2" });
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
});
