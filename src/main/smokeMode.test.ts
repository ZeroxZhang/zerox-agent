import { describe, expect, it } from "vitest";
import {
  getSmokeModeOptions,
  getSmokeRendererPerformanceMessage,
  getSmokeRendererPerformanceScript,
  getSmokeRendererCheckScript,
  getSmokeRendererFailureMessage,
} from "./smokeMode";

describe("smoke mode", () => {
  it("is disabled by default", () => {
    expect(getSmokeModeOptions({})).toEqual({
      enabled: false,
      expectedHash: null,
      performanceEnabled: false,
      timeoutMs: 10_000,
      readySelector: '[data-testid="agent-chat-panel"]',
      requiredTexts: [],
      requireDesktopApi: true,
      targetHash: null,
      viewport: null,
      performanceThresholds: {
        inputP95FrameMs: 50,
        inputMaxFrameMs: 100,
        sessionSwitchMs: 250,
        getSessionMs: 500,
        longTaskMaxMs: 120,
      },
    });
  });

  it("enables automatic production startup checks from the environment", () => {
    expect(
      getSmokeModeOptions({
        BUILDING_AGENT_SMOKE: "1",
        BUILDING_AGENT_SMOKE_TIMEOUT_MS: "2500",
      }),
    ).toEqual({
      enabled: true,
      expectedHash: null,
      performanceEnabled: false,
      timeoutMs: 2_500,
      readySelector: '[data-testid="agent-chat-panel"]',
      requiredTexts: [],
      requireDesktopApi: true,
      targetHash: null,
      viewport: null,
      performanceThresholds: {
        inputP95FrameMs: 50,
        inputMaxFrameMs: 100,
        sessionSwitchMs: 250,
        getSessionMs: 500,
        longTaskMaxMs: 120,
      },
    });
  });

  it("keeps a safe timeout when the environment timeout is invalid", () => {
    expect(
      getSmokeModeOptions({
        BUILDING_AGENT_SMOKE: "1",
        BUILDING_AGENT_SMOKE_TIMEOUT_MS: "bad",
      }),
    ).toEqual({
      enabled: true,
      expectedHash: null,
      performanceEnabled: false,
      timeoutMs: 10_000,
      readySelector: '[data-testid="agent-chat-panel"]',
      requiredTexts: [],
      requireDesktopApi: true,
      targetHash: null,
      viewport: null,
      performanceThresholds: {
        inputP95FrameMs: 50,
        inputMaxFrameMs: 100,
        sessionSwitchMs: 250,
        getSessionMs: 500,
        longTaskMaxMs: 120,
      },
    });
  });

  it("accepts a custom selector and required text checks for targeted QA", () => {
    expect(
      getSmokeModeOptions({
        BUILDING_AGENT_SMOKE: "1",
        BUILDING_AGENT_SMOKE_READY_SELECTOR: ".overview-panel",
        BUILDING_AGENT_SMOKE_REQUIRED_TEXTS:
          "本地基线分|智能体能力分|本地工具",
        BUILDING_AGENT_SMOKE_HASH: "overview",
        BUILDING_AGENT_SMOKE_EXPECTED_HASH: "system-overview",
        BUILDING_AGENT_SMOKE_VIEWPORT: "390x844",
      }),
    ).toEqual({
      enabled: true,
      expectedHash: "#system-overview",
      performanceEnabled: false,
      timeoutMs: 10_000,
      readySelector: ".overview-panel",
      requiredTexts: ["本地基线分", "智能体能力分", "本地工具"],
      requireDesktopApi: true,
      targetHash: "#overview",
      viewport: { width: 390, height: 844 },
      performanceThresholds: {
        inputP95FrameMs: 50,
        inputMaxFrameMs: 100,
        sessionSwitchMs: 250,
        getSessionMs: 500,
        longTaskMaxMs: 120,
      },
    });
  });

  it("checks for rendered agent UI instead of only the document load event", () => {
    const script = getSmokeRendererCheckScript(
      getSmokeModeOptions({
        BUILDING_AGENT_SMOKE_READY_SELECTOR: ".overview-panel",
        BUILDING_AGENT_SMOKE_REQUIRED_TEXTS:
          "本地基线分|智能体能力分|本地工具",
      }),
    );

    expect(script).toContain(".overview-panel");
    expect(script).toContain("智能体能力分");
    expect(script).toContain("hasDesktopApi");
    expect(script).toContain("hasHorizontalOverflow");
    expect(script).toContain("rootTextLength");
  });

  it("passes the configured smoke timeout into renderer readiness polling", () => {
    const script = getSmokeRendererCheckScript(
      getSmokeModeOptions({
        BUILDING_AGENT_SMOKE_TIMEOUT_MS: "2500",
      }),
    );

    expect(script).toContain("const timeoutMs = 2500;");
    expect(script).not.toContain("const timeoutMs = 4000;");
  });

  it("allows targeted smoke checks to opt out of desktop API checks", () => {
    expect(
      getSmokeModeOptions({
        BUILDING_AGENT_SMOKE_REQUIRE_DESKTOP_API: "0",
      }),
    ).toMatchObject({
      requireDesktopApi: false,
    });
  });

  it("enables production performance smoke checks with explicit thresholds", () => {
    expect(
      getSmokeModeOptions({
        BUILDING_AGENT_SMOKE: "1",
        BUILDING_AGENT_PERF_SMOKE: "1",
        BUILDING_AGENT_PERF_MAX_INPUT_P95_MS: "35",
        BUILDING_AGENT_PERF_MAX_INPUT_MAX_MS: "80",
        BUILDING_AGENT_PERF_MAX_SWITCH_MS: "900",
        BUILDING_AGENT_PERF_MAX_GET_SESSION_MS: "250",
        BUILDING_AGENT_PERF_MAX_LONG_TASK_MS: "90",
      }),
    ).toMatchObject({
      enabled: true,
      performanceEnabled: true,
      performanceThresholds: {
        inputP95FrameMs: 35,
        inputMaxFrameMs: 80,
        sessionSwitchMs: 900,
        getSessionMs: 250,
        longTaskMaxMs: 90,
      },
    });
  });

  it("generates a renderer performance probe for session switching and input latency", () => {
    const script = getSmokeRendererPerformanceScript(
      getSmokeModeOptions({
        BUILDING_AGENT_SMOKE: "1",
        BUILDING_AGENT_PERF_SMOKE: "1",
      }),
    );

    expect(script).toContain("listChatSessions");
    expect(script).toContain("getChatSession");
    expect(script).toContain("listedSessionIds");
    expect(script).toContain("data-session-id");
    expect(script).toContain("data-message-id");
    expect(script).toContain("sidebar-archive-toggle");
    expect(script).toContain("expectedSwitchCount");
    expect(script).toContain("archiveExpanded");
    expect(script).toContain("visibleSessionCount");
    expect(script).toContain("tested switch count");
    expect(script).toContain("longTaskMaxMs");
    expect(script).toContain("inputP95FrameMs");
    expect(script).toContain("PerformanceObserver");
  });

  it("reports a useful failure when the renderer document is blank", () => {
    expect(
      getSmokeRendererFailureMessage({
        ok: false,
        hasReadyElement: false,
        hasRoot: true,
        hasDesktopApi: false,
        hasHorizontalOverflow: false,
        hash: "",
        hashMatches: true,
        scrollWidth: 1200,
        clientWidth: 1200,
        rootTextLength: 0,
        missingTexts: [],
        title: "Zerox Agent",
        locationHref: "file:///app/dist/index.html",
      }),
    ).toContain("renderer did not render the agent chat panel");
  });

  it("reports missing required texts in targeted smoke checks", () => {
    expect(
      getSmokeRendererFailureMessage({
        ok: false,
        hasReadyElement: true,
        hasRoot: true,
        hasDesktopApi: true,
        hasHorizontalOverflow: false,
        hash: "#overview",
        hashMatches: true,
        scrollWidth: 390,
        clientWidth: 390,
        rootTextLength: 200,
        missingTexts: ["Agent Capability"],
        title: "Zerox Agent",
        locationHref: "http://127.0.0.1:5173/#overview",
      }),
    ).toContain("missingTexts=Agent Capability");
  });

  it("requires targeted smoke hashes to survive renderer startup", () => {
    const script = getSmokeRendererCheckScript(
      getSmokeModeOptions({
        BUILDING_AGENT_SMOKE_HASH: "tools",
      }),
    );

    expect(script).toContain('const expectedHash = "#tools";');
    expect(script).toContain("hashMatches");
  });

  it("can load a compatibility hash and require a canonical hash", () => {
    const script = getSmokeRendererCheckScript(
      getSmokeModeOptions({
        BUILDING_AGENT_SMOKE_HASH: "overview",
        BUILDING_AGENT_SMOKE_EXPECTED_HASH: "system-overview",
      }),
    );

    expect(script).toContain('const expectedHash = "#system-overview";');
    expect(script).toContain("hashMatches");
  });

  it("reports production performance smoke metrics", () => {
    expect(
      getSmokeRendererPerformanceMessage({
        ok: false,
        mode: "performance",
        failureReasons: ["input p95 frame 120ms > 50ms"],
        thresholds: {
          inputP95FrameMs: 50,
          inputMaxFrameMs: 100,
          sessionSwitchMs: 250,
          getSessionMs: 500,
          longTaskMaxMs: 120,
        },
        sessionCount: 2,
        scannedSessionCount: 2,
        selectedSessionId: "session_1",
        alternateSessionId: "session_2",
        selectedSessionBytes: 5_000_000,
        selectedOutputPartBytes: 4_800_000,
        selectedMessageCount: 480,
        metrics: {
          listSessionsMs: 10,
          scanSessionsMs: 20,
          maxGetSessionMs: 30,
          selectedGetSessionMs: 30,
          sessionSwitchMs: 1400,
          alternateSessionSwitchMs: 100,
          inputP95FrameMs: 120,
          inputMaxFrameMs: 180,
          inputAverageFrameMs: 80,
          longTaskCount: 2,
          longTaskMaxMs: 160,
          archivedSessionCount: 1,
          archiveExpanded: true,
          visibleSessionCount: 2,
          testedSwitchCount: 6,
          maxSessionSwitchMs: 1400,
          renderedMessageCount: 9,
          rootTextLength: 1000,
        },
      }),
    ).toContain("Performance smoke failed");
  });

  it("reports horizontal overflow in targeted smoke checks", () => {
    expect(
      getSmokeRendererFailureMessage({
        ok: false,
        hasReadyElement: true,
        hasRoot: true,
        hasDesktopApi: true,
        hasHorizontalOverflow: true,
        hash: "#overview",
        hashMatches: true,
        scrollWidth: 420,
        clientWidth: 390,
        rootTextLength: 200,
        missingTexts: [],
        title: "Zerox Agent",
        locationHref: "http://127.0.0.1:5173/#overview",
      }),
    ).toContain("horizontalOverflow=true scrollWidth=420 clientWidth=390");
  });

  it("reports when the desktop preload bridge is missing", () => {
    expect(
      getSmokeRendererFailureMessage({
        ok: false,
        hasReadyElement: true,
        hasRoot: true,
        hasDesktopApi: false,
        hasHorizontalOverflow: false,
        hash: "#chat",
        hashMatches: true,
        scrollWidth: 1120,
        clientWidth: 1120,
        rootTextLength: 347,
        missingTexts: [],
        title: "Zerox Agent",
        locationHref: "file:///app/dist/index.html#chat",
      }),
    ).toContain("desktopApi=missing");
  });
});
