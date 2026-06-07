import type { BrowserWindowConstructorOptions, Settings } from "electron";

export function getMainWindowOptions(): BrowserWindowConstructorOptions {
  return {
    width: 1120,
    height: 760,
    minWidth: 960,
    minHeight: 640,
    title: "Zerox Agent",
    backgroundColor: "#f8fafc",
  };
}

export function getDefaultLoginItemSettings(): Settings {
  return {
    openAtLogin: true,
    openAsHidden: true,
  };
}

export function getTrayTooltip(productName: string): string {
  return `${productName} 正在后台运行`;
}

export function shouldApplyLoginStartup(
  isPackaged: boolean,
  env: Record<string, string | undefined>,
): boolean {
  return isPackaged || env.BUILDING_AGENT_ENABLE_LOGIN_STARTUP === "1";
}
