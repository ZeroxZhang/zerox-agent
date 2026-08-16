import type { BrowserWindowConstructorOptions, Settings } from "electron";
import { pathToFileURL } from "node:url";

export type TrustedRendererSource =
  | Readonly<{
      kind: "file";
      filePath: string;
      url: string;
    }>
  | Readonly<{
      kind: "development_url";
      url: string;
      origin: string;
    }>;

export type RendererCrashRecoveryDecision = Readonly<{
  recover: boolean;
  crashCount: number;
}>;

export type RendererCrashRecoveryTracker = {
  recordCrash(nowMs?: number): RendererCrashRecoveryDecision;
};

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

export function resolveTrustedRendererSource(input: {
  isPackaged: boolean;
  rendererUrl?: string;
  rendererFile: string;
}): TrustedRendererSource {
  if (!input.isPackaged && input.rendererUrl) {
    const url = new URL(input.rendererUrl);
    if (!isLoopbackDevelopmentUrl(url)) {
      throw new Error(
        `ELECTRON_RENDERER_URL must use an http(s) loopback origin: ${url.origin}`,
      );
    }
    return Object.freeze({
      kind: "development_url" as const,
      url: url.toString(),
      origin: url.origin,
    });
  }

  return Object.freeze({
    kind: "file" as const,
    filePath: input.rendererFile,
    url: pathToFileURL(input.rendererFile).toString(),
  });
}

export function isTrustedRendererLocation(
  location: string,
  source: TrustedRendererSource,
): boolean {
  try {
    const url = new URL(location);
    if (source.kind === "development_url") {
      return url.origin === source.origin && isLoopbackDevelopmentUrl(url);
    }
    return url.protocol === "file:" && url.href.split("#", 1)[0] === source.url;
  } catch {
    return false;
  }
}

export function shouldRecoverRendererProcess(reason: string): boolean {
  return reason !== "clean-exit";
}

export function createRendererCrashRecoveryTracker(options?: {
  maxRecoveries?: number;
  windowMs?: number;
}): RendererCrashRecoveryTracker {
  const maxRecoveries = positiveInteger(options?.maxRecoveries ?? 3);
  const windowMs = positiveInteger(options?.windowMs ?? 60_000);
  let crashes: number[] = [];

  return {
    recordCrash(nowMs = Date.now()) {
      crashes = crashes.filter((timestamp) => nowMs - timestamp <= windowMs);
      crashes.push(nowMs);
      return Object.freeze({
        recover: crashes.length <= maxRecoveries,
        crashCount: crashes.length,
      });
    },
  };
}

function isLoopbackDevelopmentUrl(url: URL): boolean {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return false;
  }
  const hostname = url.hostname.toLowerCase();
  return (
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname)
  );
}

function positiveInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("Renderer crash recovery limits must be positive integers.");
  }
  return value;
}
