export type SmokeModeOptions = {
  enabled: boolean;
  timeoutMs: number;
};

export type SmokeRendererCheckResult = {
  ok: boolean;
  hasReadyElement: boolean;
  hasRoot: boolean;
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
    timeoutMs:
      Number.isFinite(timeoutMs) && timeoutMs > 0
        ? timeoutMs
        : defaultSmokeTimeoutMs,
  };
}

export function getSmokeRendererCheckScript(): string {
  return `(() => new Promise((resolve) => {
    const readySelector = ${JSON.stringify(smokeRendererReadySelector)};
    const startedAt = Date.now();
    const timeoutMs = 4000;

    function snapshot() {
      const readyElement = document.querySelector(readySelector);
      const root = document.getElementById("root");
      const rootText = root?.textContent?.trim() ?? "";

      return {
        ok: Boolean(readyElement),
        hasReadyElement: Boolean(readyElement),
        hasRoot: Boolean(root),
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
    `rootTextLength=${result.rootTextLength}`,
    `title=${result.title}`,
    `url=${result.locationHref}`,
  ].join(" ");
}
