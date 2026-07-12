import type { BrowserWindowConstructorOptions, Settings } from "electron";

export function getMainWindowOptions(): BrowserWindowConstructorOptions {
  return {
    width: 1120,
    height: 760,
    minWidth: 640,
    minHeight: 560,
    title: "Zerox Agent",
    backgroundColor: "#f8fbfd",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 18 },
  };
}

export function getDefaultLoginItemSettings(): Settings {
  return {
    openAtLogin: true,
    openAsHidden: true,
  };
}

export function getDisabledLoginItemSettings(): Settings {
  return {
    openAtLogin: false,
    openAsHidden: false,
  };
}

export function getTrayTooltip(productName: string): string {
  return `${productName} 正在后台运行`;
}

export function shouldApplyLoginStartup(
  isPackaged: boolean,
  env: Record<string, string | undefined>,
): boolean {
  return isPackaged && (
    env.ZEROX_ENABLE_LOGIN_STARTUP === "1" ||
    env.BUILDING_AGENT_ENABLE_LOGIN_STARTUP === "1"
  );
}

export function shouldCreateMainWindowAtStartup(
  wasOpenedAsHidden: boolean,
): boolean {
  return !wasOpenedAsHidden;
}

export function shouldRestoreMainWindowOnActivate(smokeModeEnabled: boolean): boolean {
  return !smokeModeEnabled;
}
