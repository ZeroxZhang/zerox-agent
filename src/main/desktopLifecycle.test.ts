import { describe, expect, it } from "vitest";
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

describe("desktop lifecycle helpers", () => {
  it("uses a readable desktop window size with sensible minimums", () => {
    expect(getMainWindowOptions()).toMatchObject({
      width: 1120,
      height: 760,
      minWidth: 640,
      minHeight: 560,
      title: "Zerox Agent",
      backgroundColor: "#f8fbfd",
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 18, y: 18 },
    });
  });

  it("starts hidden at login so the runtime can stay alive in the tray", () => {
    expect(getDefaultLoginItemSettings()).toEqual({
      openAtLogin: true,
      openAsHidden: true,
    });
  });

  it("can explicitly clear a login item left enabled by an earlier release", () => {
    expect(getDisabledLoginItemSettings()).toEqual({
      openAtLogin: false,
      openAsHidden: false,
    });
  });

  it("uses the branded desktop tray copy for the local agent", () => {
    expect(getTrayTooltip("Zerox Agent")).toBe("Zerox Agent 正在后台运行");
  });

  it("only applies login startup after explicit opt-in", () => {
    expect(shouldApplyLoginStartup(false, {})).toBe(false);
    expect(shouldApplyLoginStartup(true, {})).toBe(false);
    expect(
      shouldApplyLoginStartup(true, {
        ZEROX_ENABLE_LOGIN_STARTUP: "1",
      }),
    ).toBe(true);
    expect(
      shouldApplyLoginStartup(false, {
        BUILDING_AGENT_ENABLE_LOGIN_STARTUP: "1",
      }),
    ).toBe(false);
  });

  it("does not show the main window for a hidden login-item launch", () => {
    expect(shouldCreateMainWindowAtStartup(false)).toBe(true);
    expect(shouldCreateMainWindowAtStartup(true)).toBe(false);
  });

  it("restores the main window on app activation outside smoke mode", () => {
    expect(shouldRestoreMainWindowOnActivate(false)).toBe(true);
    expect(shouldRestoreMainWindowOnActivate(true)).toBe(false);
  });

  it("ignores renderer URL overrides in packaged builds", () => {
    const source = resolveTrustedRendererSource({
      isPackaged: true,
      rendererUrl: "https://attacker.invalid/app",
      rendererFile: "/Applications/Zerox Agent.app/dist/index.html",
    });

    expect(source).toEqual({
      kind: "file",
      filePath: "/Applications/Zerox Agent.app/dist/index.html",
      url: "file:///Applications/Zerox%20Agent.app/dist/index.html",
    });
    expect(isTrustedRendererLocation(`${source.url}#runs`, source)).toBe(true);
    expect(
      isTrustedRendererLocation("file:///tmp/untrusted.html", source),
    ).toBe(false);
  });

  it("allows only loopback http(s) development renderer origins", () => {
    const source = resolveTrustedRendererSource({
      isPackaged: false,
      rendererUrl: "http://127.0.0.1:5173/app",
      rendererFile: "/repo/dist/index.html",
    });

    expect(source).toMatchObject({
      kind: "development_url",
      origin: "http://127.0.0.1:5173",
    });
    expect(
      isTrustedRendererLocation("http://127.0.0.1:5173/#settings", source),
    ).toBe(true);
    expect(
      isTrustedRendererLocation("http://localhost:5173/#settings", source),
    ).toBe(false);
    expect(
      resolveTrustedRendererSource({
        isPackaged: false,
        rendererUrl: "http://[::1]:5173",
        rendererFile: "/repo/dist/index.html",
      }),
    ).toMatchObject({ kind: "development_url" });
    expect(() =>
      resolveTrustedRendererSource({
        isPackaged: false,
        rendererUrl: "https://renderer.example.com",
        rendererFile: "/repo/dist/index.html",
      }),
    ).toThrow("loopback origin");
  });

  it("bounds renderer crash recovery within a rolling window", () => {
    const tracker = createRendererCrashRecoveryTracker({
      maxRecoveries: 2,
      windowMs: 1_000,
    });

    expect(tracker.recordCrash(0)).toEqual({ recover: true, crashCount: 1 });
    expect(tracker.recordCrash(500)).toEqual({ recover: true, crashCount: 2 });
    expect(tracker.recordCrash(900)).toEqual({ recover: false, crashCount: 3 });
    expect(tracker.recordCrash(2_000)).toEqual({
      recover: true,
      crashCount: 1,
    });
    expect(shouldRecoverRendererProcess("crashed")).toBe(true);
    expect(shouldRecoverRendererProcess("clean-exit")).toBe(false);
  });
});
