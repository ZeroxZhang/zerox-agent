import { describe, expect, it } from "vitest";
import {
  getDefaultLoginItemSettings,
  getMainWindowOptions,
  getTrayTooltip,
  shouldApplyLoginStartup,
} from "./desktopLifecycle";

describe("desktop lifecycle helpers", () => {
  it("uses a readable desktop window size with sensible minimums", () => {
    expect(getMainWindowOptions()).toMatchObject({
      width: 1120,
      height: 760,
      minWidth: 960,
      minHeight: 640,
      title: "Zerox Agent",
      backgroundColor: "#f5f1ea",
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

  it("uses the branded desktop tray copy for the local agent", () => {
    expect(getTrayTooltip("Zerox Agent")).toBe("Zerox Agent 正在后台运行");
  });

  it("only applies login startup automatically for packaged builds or explicit dev opt-in", () => {
    expect(shouldApplyLoginStartup(false, {})).toBe(false);
    expect(shouldApplyLoginStartup(true, {})).toBe(true);
    expect(
      shouldApplyLoginStartup(false, {
        BUILDING_AGENT_ENABLE_LOGIN_STARTUP: "1",
      }),
    ).toBe(true);
  });
});
