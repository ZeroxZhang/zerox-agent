export type SmokeModeOptions = {
  enabled: boolean;
  readySelector: string;
  requiredTexts: string[];
  requireDesktopApi: boolean;
  timeoutMs: number;
  viewport: { width: number; height: number } | null;
};

export type SmokeRendererCheckResult = {
  ok: boolean;
  hasReadyElement: boolean;
  hasRoot: boolean;
  hasDesktopApi: boolean;
  hasHorizontalOverflow: boolean;
  missingTexts: string[];
  scrollWidth: number;
  clientWidth: number;
  rootTextLength: number;
  title: string;
  locationHref: string;
};

const defaultSmokeTimeoutMs = 10_000;
const smokeRendererReadySelector = '[data-testid="agent-chat-panel"]';

export function getSmokeModeOptions(
  env: Record<string, string | undefined>,
): SmokeModeOptions {
  const timeoutMs = Number(env.BUILDING_AGENT_SMOKE_TIMEOUT_MS);

  return {
    enabled: env.BUILDING_AGENT_SMOKE === "1",
    readySelector:
      env.BUILDING_AGENT_SMOKE_READY_SELECTOR?.trim() ||
      smokeRendererReadySelector,
    requiredTexts: parseRequiredTexts(env.BUILDING_AGENT_SMOKE_REQUIRED_TEXTS),
    requireDesktopApi: env.BUILDING_AGENT_SMOKE_REQUIRE_DESKTOP_API !== "0",
    timeoutMs:
      Number.isFinite(timeoutMs) && timeoutMs > 0
        ? timeoutMs
        : defaultSmokeTimeoutMs,
    viewport: parseViewport(env.BUILDING_AGENT_SMOKE_VIEWPORT),
  };
}

export function getSmokeRendererCheckScript(
  options: Pick<
    SmokeModeOptions,
    "readySelector" | "requiredTexts" | "requireDesktopApi" | "timeoutMs"
  > =
    getSmokeModeOptions({}),
): string {
  return `(() => new Promise((resolve) => {
    const readySelector = ${JSON.stringify(options.readySelector)};
    const requiredTexts = ${JSON.stringify(options.requiredTexts)};
    const requireDesktopApi = ${JSON.stringify(options.requireDesktopApi)};
    const startedAt = Date.now();
    const timeoutMs = ${JSON.stringify(options.timeoutMs)};

    function snapshot() {
      const readyElement = document.querySelector(readySelector);
      const root = document.getElementById("root");
      const rootText = root?.textContent?.trim() ?? "";
      const missingTexts = requiredTexts.filter((text) => !rootText.includes(text));
      const hasDesktopApi = typeof window.buildingAgent === "object" && window.buildingAgent !== null;
      const scrollWidth = document.documentElement.scrollWidth;
      const clientWidth = document.documentElement.clientWidth;
      const hasHorizontalOverflow = scrollWidth > clientWidth;

      return {
        ok: Boolean(readyElement) && missingTexts.length === 0 && (!requireDesktopApi || hasDesktopApi) && !hasHorizontalOverflow,
        hasReadyElement: Boolean(readyElement),
        hasRoot: Boolean(root),
        hasDesktopApi,
        hasHorizontalOverflow,
        missingTexts,
        scrollWidth,
        clientWidth,
        rootTextLength: rootText.length,
        title: document.title,
        locationHref: window.location.href,
      };
    }

    function check() {
      const result = snapshot();
      if (result.ok || Date.now() - startedAt >= timeoutMs) {
        resolve(result);
        return;
      }
      window.setTimeout(check, 50);
    }

    check();
  }))()`;
}

export function isSmokeRendererCheckResult(
  value: unknown,
): value is SmokeRendererCheckResult {
  if (!value || typeof value !== "object") {
    return false;
  }

  const result = value as SmokeRendererCheckResult;
  return (
    typeof result.ok === "boolean" &&
    typeof result.hasReadyElement === "boolean" &&
    typeof result.hasRoot === "boolean" &&
    typeof result.hasDesktopApi === "boolean" &&
    typeof result.hasHorizontalOverflow === "boolean" &&
    Array.isArray(result.missingTexts) &&
    result.missingTexts.every((text) => typeof text === "string") &&
    typeof result.scrollWidth === "number" &&
    typeof result.clientWidth === "number" &&
    typeof result.rootTextLength === "number" &&
    typeof result.title === "string" &&
    typeof result.locationHref === "string"
  );
}

export function getSmokeRendererFailureMessage(result: unknown): string {
  if (!isSmokeRendererCheckResult(result)) {
    return `Smoke startup failed: renderer check returned an unexpected result: ${JSON.stringify(result)}`;
  }

  return [
    "Smoke startup failed: renderer did not render the agent chat panel.",
    `root=${result.hasRoot ? "present" : "missing"}`,
    `readyElement=${result.hasReadyElement ? "present" : "missing"}`,
    `desktopApi=${result.hasDesktopApi ? "present" : "missing"}`,
    `missingTexts=${result.missingTexts.join(",") || "none"}`,
    `horizontalOverflow=${result.hasHorizontalOverflow} scrollWidth=${result.scrollWidth} clientWidth=${result.clientWidth}`,
    `rootTextLength=${result.rootTextLength}`,
    `title=${result.title}`,
    `url=${result.locationHref}`,
  ].join(" ");
}

function parseRequiredTexts(value: string | undefined): string[] {
  return (value ?? "")
    .split("|")
    .map((text) => text.trim())
    .filter(Boolean);
}

function parseViewport(
  value: string | undefined,
): SmokeModeOptions["viewport"] {
  const match = value?.trim().match(/^(\d{2,5})x(\d{2,5})$/i);
  if (!match) {
    return null;
  }

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }

  return { width, height };
}
