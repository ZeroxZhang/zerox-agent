import { describe, expect, it } from "vitest";
import {
  getDefaultLoginItemSettings,
  getDisabledLoginItemSettings,
  getMainWindowOptions,
  getTrayTooltip,
  shouldApplyLoginStartup,
  shouldCreateMainWindowAtStartup,
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
});
