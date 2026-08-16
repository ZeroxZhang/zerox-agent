export type SmokeModeOptions = {
  enabled: boolean;
  expectedHash: string | null;
  performanceEnabled: boolean;
  readySelector: string;
  requiredTexts: string[];
  requireDesktopApi: boolean;
  targetHash: string | null;
  timeoutMs: number;
  viewport: { width: number; height: number } | null;
  performanceThresholds: SmokePerformanceThresholds;
};

export type SmokeRendererCheckResult = {
  ok: boolean;
  hasReadyElement: boolean;
  hasRoot: boolean;
  hasDesktopApi: boolean;
  hasHorizontalOverflow: boolean;
  hash: string;
  hashMatches: boolean;
  missingTexts: string[];
  scrollWidth: number;
  clientWidth: number;
  rootTextLength: number;
  title: string;
  locationHref: string;
};

export type SmokePerformanceThresholds = {
  inputP95FrameMs: number;
  inputMaxFrameMs: number;
  sessionSwitchMs: number;
  getSessionMs: number;
  longTaskMaxMs: number;
};

export type SmokeRendererPerformanceResult = {
  ok: boolean;
  mode: "performance";
  failureReasons: string[];
  thresholds: SmokePerformanceThresholds;
  sessionCount: number;
  scannedSessionCount: number;
  selectedSessionId: string | null;
  alternateSessionId: string | null;
  selectedSessionBytes: number;
  selectedOutputPartBytes: number;
  selectedMessageCount: number;
  metrics: {
    listSessionsMs: number;
    scanSessionsMs: number;
    maxGetSessionMs: number;
    selectedGetSessionMs: number;
    sessionSwitchMs: number;
    alternateSessionSwitchMs: number;
    inputP95FrameMs: number;
    inputMaxFrameMs: number;
    inputAverageFrameMs: number;
    longTaskCount: number;
    longTaskMaxMs: number;
    archivedSessionCount: number;
    archiveExpanded: boolean;
    visibleSessionCount: number;
    testedSwitchCount: number;
    maxSessionSwitchMs: number;
    renderedMessageCount: number;
    rootTextLength: number;
  };
};

const defaultSmokeTimeoutMs = 10_000;
const smokeRendererReadySelector = '[data-testid="agent-chat-panel"]';
const defaultPerformanceThresholds: SmokePerformanceThresholds = {
  inputP95FrameMs: 50,
  inputMaxFrameMs: 100,
  sessionSwitchMs: 250,
  getSessionMs: 500,
  longTaskMaxMs: 120,
};

export function getSmokeModeOptions(
  env: Record<string, string | undefined>,
): SmokeModeOptions {
  const timeoutMs = Number(env.BUILDING_AGENT_SMOKE_TIMEOUT_MS);

  return {
    enabled: env.BUILDING_AGENT_SMOKE === "1",
    expectedHash: parseTargetHash(env.BUILDING_AGENT_SMOKE_EXPECTED_HASH),
    performanceEnabled: env.BUILDING_AGENT_PERF_SMOKE === "1",
    readySelector:
      env.BUILDING_AGENT_SMOKE_READY_SELECTOR?.trim() ||
      smokeRendererReadySelector,
    requiredTexts: parseRequiredTexts(env.BUILDING_AGENT_SMOKE_REQUIRED_TEXTS),
    requireDesktopApi: env.BUILDING_AGENT_SMOKE_REQUIRE_DESKTOP_API !== "0",
    targetHash: parseTargetHash(env.BUILDING_AGENT_SMOKE_HASH),
    timeoutMs:
      Number.isFinite(timeoutMs) && timeoutMs > 0
        ? timeoutMs
        : defaultSmokeTimeoutMs,
    viewport: parseViewport(env.BUILDING_AGENT_SMOKE_VIEWPORT),
    performanceThresholds: {
      inputP95FrameMs: parsePositiveNumber(
        env.BUILDING_AGENT_PERF_MAX_INPUT_P95_MS,
        defaultPerformanceThresholds.inputP95FrameMs,
      ),
      inputMaxFrameMs: parsePositiveNumber(
        env.BUILDING_AGENT_PERF_MAX_INPUT_MAX_MS,
        defaultPerformanceThresholds.inputMaxFrameMs,
      ),
      sessionSwitchMs: parsePositiveNumber(
        env.BUILDING_AGENT_PERF_MAX_SWITCH_MS,
        defaultPerformanceThresholds.sessionSwitchMs,
      ),
      getSessionMs: parsePositiveNumber(
        env.BUILDING_AGENT_PERF_MAX_GET_SESSION_MS,
        defaultPerformanceThresholds.getSessionMs,
      ),
      longTaskMaxMs: parsePositiveNumber(
        env.BUILDING_AGENT_PERF_MAX_LONG_TASK_MS,
        defaultPerformanceThresholds.longTaskMaxMs,
      ),
    },
  };
}

export function getSmokeRendererCheckScript(
  options: Pick<
    SmokeModeOptions,
    "readySelector" | "requiredTexts" | "requireDesktopApi" | "timeoutMs"
    | "targetHash"
    | "expectedHash"
  > =
    getSmokeModeOptions({}),
): string {
  return `(() => new Promise((resolve) => {
    const readySelector = ${JSON.stringify(options.readySelector)};
    const requiredTexts = ${JSON.stringify(options.requiredTexts)};
    const requireDesktopApi = ${JSON.stringify(options.requireDesktopApi)};
    const expectedHash = ${JSON.stringify(options.expectedHash ?? options.targetHash)};
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
      const hash = window.location.hash;
      const hashMatches = !expectedHash || hash === expectedHash;

      return {
        ok: Boolean(readyElement) && missingTexts.length === 0 && (!requireDesktopApi || hasDesktopApi) && !hasHorizontalOverflow && hashMatches,
        hasReadyElement: Boolean(readyElement),
        hasRoot: Boolean(root),
        hasDesktopApi,
        hasHorizontalOverflow,
        hash,
        hashMatches,
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
    typeof result.locationHref === "string" &&
    typeof result.hash === "string" &&
    typeof result.hashMatches === "boolean"
  );
}

export function getSmokeRendererPerformanceScript(
  options: Pick<
    SmokeModeOptions,
    "readySelector" | "timeoutMs" | "performanceThresholds"
  > =
    getSmokeModeOptions({}),
): string {
  return `(() => new Promise((resolve) => {
    const readySelector = ${JSON.stringify(options.readySelector)};
    const timeoutMs = ${JSON.stringify(options.timeoutMs)};
    const thresholds = ${JSON.stringify(options.performanceThresholds)};
    const startedAt = performance.now();
    const deadlineMs = Math.max(1_000, timeoutMs - 1_500);
    let stage = "init";
    const longTasks = [];
    function mark(nextStage) {
      stage = nextStage;
    }
    const observer = typeof PerformanceObserver === "function"
      ? new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            longTasks.push(entry.duration);
          }
        })
      : null;
    try {
      observer?.observe({ type: "longtask" });
    } catch {
      // Long task timing may be unavailable in some Electron builds.
    }

    function wait(ms) {
      return new Promise((resolveWait) => window.setTimeout(resolveWait, ms));
    }

    function nextFrames(count = 2) {
      return new Promise((resolveFrames) => {
        let resolved = false;
        const timeoutId = window.setTimeout(() => {
          if (!resolved) {
            resolved = true;
            resolveFrames();
          }
        }, Math.max(80, count * 80));
        function step(remaining) {
          if (resolved) {
            return;
          }
          if (remaining <= 0) {
            resolved = true;
            window.clearTimeout(timeoutId);
            resolveFrames();
            return;
          }
          requestAnimationFrame(() => step(remaining - 1));
        }
        step(count);
      });
    }

    async function waitFor(predicate, label) {
      mark("wait:" + label);
      while (performance.now() - startedAt < deadlineMs) {
        const value = predicate();
        if (value) {
          return value;
        }
        await wait(25);
      }
      throw new Error("Timed out waiting for " + label);
    }

    async function withTimeout(label, operation, operationTimeoutMs = 5_000) {
      mark(label);
      let timeoutId;
      try {
        return await Promise.race([
          operation(),
          new Promise((_, reject) => {
            timeoutId = window.setTimeout(() => {
              reject(new Error(label + " timed out after " + operationTimeoutMs + "ms"));
            }, operationTimeoutMs);
          }),
        ]);
      } finally {
        if (timeoutId) {
          window.clearTimeout(timeoutId);
        }
      }
    }

    async function measure(label, operation, operationTimeoutMs = 5_000) {
      const start = performance.now();
      const value = await withTimeout(label, operation, operationTimeoutMs);
      return { value, ms: performance.now() - start };
    }

    function serializedBytes(value) {
      try {
        return new TextEncoder().encode(JSON.stringify(value ?? null)).length;
      } catch {
        return 0;
      }
    }

    function outputPartBytes(session) {
      return (session?.messages ?? []).reduce((total, message) => {
        return total + serializedBytes(message.outputParts ?? []);
      }, 0);
    }

    function percentile(values, ratio) {
      if (!values.length) return 0;
      const sorted = [...values].sort((left, right) => left - right);
      return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
    }

    function round(value) {
      return Math.round(value * 10) / 10;
    }

    function collectVisibleSessionIds() {
      return Array.from(
        document.querySelectorAll(".sidebar-session-item[data-session-id]"),
      )
        .map((item) => item.getAttribute("data-session-id"))
        .filter(Boolean);
    }

    async function clickSession(sessionId, expectedMessageId) {
      const selector = '.sidebar-session-item[data-session-id="' + CSS.escape(sessionId) + '"]';
      const row = await waitFor(() => document.querySelector(selector), "session row " + sessionId);
      const start = performance.now();
      row.click();
      if (expectedMessageId) {
        const messageSelector = '.chat-message[data-message-id="' + CSS.escape(expectedMessageId) + '"]';
        await waitFor(() => document.querySelector(messageSelector), "message " + expectedMessageId);
      } else {
        await waitFor(() => document.querySelector(".chat-message"), "chat messages");
      }
      await nextFrames(3);
      return performance.now() - start;
    }

    async function expandArchiveGroup(archivedSessionCount) {
      if (archivedSessionCount <= 0) {
        return false;
      }
      const archiveToggle = await waitFor(
        () => document.querySelector(".sidebar-archive-toggle"),
        "archive toggle",
      );
      if (
        archiveToggle.getAttribute("aria-expanded") === "true" ||
        archiveToggle.classList.contains("is-open")
      ) {
        return true;
      }
      const previousRowCount = collectVisibleSessionIds().length;
      archiveToggle.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window,
      }));
      await waitFor(
        () => {
          const latestArchiveToggle = document.querySelector(".sidebar-archive-toggle");
          const hasExpandedArchive =
            latestArchiveToggle?.getAttribute("aria-expanded") === "true" ||
            Boolean(document.querySelector(".sidebar-archive-list"));
          return hasExpandedArchive &&
            collectVisibleSessionIds().length > previousRowCount;
        },
        "archive session rows",
      );
      await nextFrames(3);
      return true;
    }

    async function measureInputFrames() {
      const textarea = await waitFor(() => document.querySelector(".composer textarea"), "composer textarea");
      mark("input:focus");
      textarea.focus();
      await nextFrames(2);
      mark("input:initialFrames");
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      const characters = "性能验收输入abcdefghijklmnopqrstuvwxyz0123456789";
      const frameDurations = [];
      for (let index = 0; index < characters.length; index += 1) {
        const character = characters[index];
        const nextValue = textarea.value + character;
        const start = performance.now();
        if (setter) {
          setter.call(textarea, nextValue);
        } else {
          textarea.value = nextValue;
        }
        textarea.dispatchEvent(new InputEvent("input", {
          bubbles: true,
          cancelable: true,
          data: character,
          inputType: "insertText",
        }));
        frameDurations.push(performance.now() - start);
        if ((index + 1) % 5 === 0 || index === characters.length - 1) {
          mark("input:typed:" + (index + 1));
        }
      }
      return {
        p95: percentile(frameDurations, 0.95),
        max: frameDurations.length ? Math.max(...frameDurations) : 0,
        average: frameDurations.reduce((total, value) => total + value, 0) /
          Math.max(1, frameDurations.length),
      };
    }

    (async () => {
      mark("start");
      await waitFor(() => document.querySelector(readySelector), "ready selector");
      const api = window.buildingAgent;
      if (!api?.listChatSessions || !api?.getChatSession) {
        throw new Error("Desktop chat session API is unavailable.");
      }

      const listed = await measure("listChatSessions", () => api.listChatSessions());
      mark("listed:" + listed.value.length);
      const listedSessionIds = listed.value
        .map((session) => session.id)
        .filter(Boolean);
      const archivedSessionCount = listed.value.filter(
        (session) => Boolean(session.archivedAt),
      ).length;
      const archiveExpanded = await expandArchiveGroup(archivedSessionCount);
      const expectedSwitchCount = Math.min(6, listedSessionIds.length);
      const visibleSessionIds = listedSessionIds.length
        ? await waitFor(() => {
            const realIds = collectVisibleSessionIds().filter((id) =>
              listedSessionIds.includes(id),
            );
            if (realIds.length >= expectedSwitchCount) {
              return realIds;
            }
            return null;
          }, "real expanded session rows")
        : collectVisibleSessionIds();
      mark("visibleRows:" + visibleSessionIds.length);
      const candidateIds = listedSessionIds.length
        ? listedSessionIds
        : visibleSessionIds;

      const scanned = [];
      let maxGetSessionMs = 0;
      const scanStart = performance.now();
      for (const sessionId of candidateIds) {
        const loaded = await measure(
          "getChatSession:" + sessionId,
          () => api.getChatSession(sessionId),
        );
        maxGetSessionMs = Math.max(maxGetSessionMs, loaded.ms);
        if (loaded.value) {
          scanned.push({
            session: loaded.value,
            getSessionMs: loaded.ms,
            bytes: serializedBytes(loaded.value),
            outputPartBytes: outputPartBytes(loaded.value),
          });
        }
      }
      mark("scanned:" + scanned.length);
      const scanSessionsMs = performance.now() - scanStart;
      scanned.sort((left, right) => right.bytes - left.bytes);
      const selected =
        scanned.find((item) => visibleSessionIds.includes(item.session.id)) ??
        null;
      const alternate =
        scanned.find((item) =>
          item.session.id !== selected?.session.id &&
          visibleSessionIds.includes(item.session.id)
        ) ?? null;
      const selectedSession = selected?.session ?? null;
      const selectedMessages = selectedSession?.messages ?? [];
      const selectedLastMessage = selectedMessages[selectedMessages.length - 1] ?? null;
      const alternateMessages = alternate?.session?.messages ?? [];
      const alternateLastMessage = alternateMessages[alternateMessages.length - 1] ?? null;

      const scannedById = new Map(scanned.map((item) => [item.session.id, item]));
      const switchTargets = visibleSessionIds
        .map((sessionId) => scannedById.get(sessionId))
        .filter(Boolean)
        .slice(0, 6);
      longTasks.length = 0;
      const switchDurations = [];
      for (const target of switchTargets) {
        const targetMessages = target.session.messages ?? [];
        const targetLastMessage = targetMessages[targetMessages.length - 1] ?? null;
        switchDurations.push(
          await clickSession(target.session.id, targetLastMessage?.id),
        );
        mark("switched:" + target.session.id);
      }
      const alternateSessionSwitchMs = switchDurations[1] ?? 0;
      const sessionSwitchMs =
        switchDurations.length > 0 ? Math.max(...switchDurations) : 0;
      const inputFrames = await measureInputFrames();
      mark("inputMeasured");
      const renderedMessageCount = document.querySelectorAll(".chat-message").length;
      const rootTextLength = document.getElementById("root")?.textContent?.length ?? 0;
      observer?.disconnect();

      const metrics = {
        listSessionsMs: round(listed.ms),
        scanSessionsMs: round(scanSessionsMs),
        maxGetSessionMs: round(maxGetSessionMs),
        selectedGetSessionMs: round(selected?.getSessionMs ?? 0),
        sessionSwitchMs: round(sessionSwitchMs),
        alternateSessionSwitchMs: round(alternateSessionSwitchMs),
        inputP95FrameMs: round(inputFrames.p95),
        inputMaxFrameMs: round(inputFrames.max),
        inputAverageFrameMs: round(inputFrames.average),
        longTaskCount: longTasks.length,
        longTaskMaxMs: round(longTasks.length ? Math.max(...longTasks) : 0),
        archivedSessionCount,
        archiveExpanded,
        visibleSessionCount: visibleSessionIds.length,
        testedSwitchCount: switchDurations.length,
        maxSessionSwitchMs: round(sessionSwitchMs),
        renderedMessageCount,
        rootTextLength,
      };
      const failureReasons = [];
      if (metrics.inputP95FrameMs > thresholds.inputP95FrameMs) {
        failureReasons.push("input p95 frame " + metrics.inputP95FrameMs + "ms > " + thresholds.inputP95FrameMs + "ms");
      }
      if (metrics.inputMaxFrameMs > thresholds.inputMaxFrameMs) {
        failureReasons.push("input max frame " + metrics.inputMaxFrameMs + "ms > " + thresholds.inputMaxFrameMs + "ms");
      }
      if (metrics.sessionSwitchMs > thresholds.sessionSwitchMs) {
        failureReasons.push("session switch " + metrics.sessionSwitchMs + "ms > " + thresholds.sessionSwitchMs + "ms");
      }
      if (metrics.maxGetSessionMs > thresholds.getSessionMs) {
        failureReasons.push("getSession max " + metrics.maxGetSessionMs + "ms > " + thresholds.getSessionMs + "ms");
      }
      if (metrics.longTaskMaxMs > thresholds.longTaskMaxMs) {
        failureReasons.push("long task max " + metrics.longTaskMaxMs + "ms > " + thresholds.longTaskMaxMs + "ms");
      }
      if (archivedSessionCount > 0 && !archiveExpanded) {
        failureReasons.push("archive group was not expanded for performance coverage");
      }
      if (metrics.visibleSessionCount < expectedSwitchCount) {
        failureReasons.push("visible session rows " + metrics.visibleSessionCount + " < expected " + expectedSwitchCount);
      }
      if (metrics.testedSwitchCount < expectedSwitchCount) {
        failureReasons.push("tested switch count " + metrics.testedSwitchCount + " < expected " + expectedSwitchCount);
      }
      if (listed.value.length < 6) {
        failureReasons.push("performance smoke requires at least 6 sessions");
      }
      if (selectedMessages.length < 400) {
        failureReasons.push("performance smoke requires a transcript with at least 400 messages");
      }
      if (metrics.renderedMessageCount > 80) {
        failureReasons.push("initial rendered messages " + metrics.renderedMessageCount + " > 80");
      }

      resolve({
        ok: failureReasons.length === 0,
        mode: "performance",
        failureReasons,
        thresholds,
        sessionCount: listed.value.length,
        scannedSessionCount: scanned.length,
        selectedSessionId: selectedSession?.id ?? null,
        alternateSessionId: alternate?.session.id ?? null,
        selectedSessionBytes: selected?.bytes ?? 0,
        selectedOutputPartBytes: selected?.outputPartBytes ?? 0,
        selectedMessageCount: selectedMessages.length,
        metrics,
      });
    })().catch((error) => {
      observer?.disconnect();
      resolve({
        ok: false,
        mode: "performance",
        failureReasons: [
          stage + ": " + (error instanceof Error ? error.message : String(error)),
        ],
        thresholds,
        sessionCount: 0,
        scannedSessionCount: 0,
        selectedSessionId: null,
        alternateSessionId: null,
        selectedSessionBytes: 0,
        selectedOutputPartBytes: 0,
        selectedMessageCount: 0,
        metrics: {
          listSessionsMs: 0,
          scanSessionsMs: 0,
          maxGetSessionMs: 0,
          selectedGetSessionMs: 0,
          sessionSwitchMs: 0,
          alternateSessionSwitchMs: 0,
          inputP95FrameMs: 0,
          inputMaxFrameMs: 0,
          inputAverageFrameMs: 0,
          longTaskCount: longTasks.length,
          longTaskMaxMs: round(longTasks.length ? Math.max(...longTasks) : 0),
          archivedSessionCount: 0,
          archiveExpanded: false,
          visibleSessionCount: 0,
          testedSwitchCount: 0,
          maxSessionSwitchMs: 0,
          renderedMessageCount: document.querySelectorAll(".chat-message").length,
          rootTextLength: document.getElementById("root")?.textContent?.length ?? 0,
        },
      });
    });
  }))()`;
}

export function isSmokeRendererPerformanceResult(
  value: unknown,
): value is SmokeRendererPerformanceResult {
  if (!value || typeof value !== "object") {
    return false;
  }
  const result = value as SmokeRendererPerformanceResult;
  return (
    result.mode === "performance" &&
    typeof result.ok === "boolean" &&
    Array.isArray(result.failureReasons) &&
    typeof result.sessionCount === "number" &&
    typeof result.scannedSessionCount === "number" &&
    typeof result.selectedSessionBytes === "number" &&
    typeof result.selectedOutputPartBytes === "number" &&
    typeof result.selectedMessageCount === "number" &&
    typeof result.metrics === "object"
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
    `hash=${result.hash || "none"} hashMatches=${result.hashMatches}`,
    `rootTextLength=${result.rootTextLength}`,
    `title=${result.title}`,
    `url=${result.locationHref}`,
  ].join(" ");
}

export function getSmokeRendererPerformanceMessage(
  result: unknown,
): string {
  if (!isSmokeRendererPerformanceResult(result)) {
    return `Performance smoke failed: renderer check returned an unexpected result: ${JSON.stringify(result)}`;
  }

  const prefix = result.ok ? "Performance smoke passed" : "Performance smoke failed";
  return `${prefix}: ${JSON.stringify(result)}`;
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

function parseTargetHash(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
