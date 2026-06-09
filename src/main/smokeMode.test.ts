import { describe, expect, it } from "vitest";
import {
  getSmokeModeOptions,
  getSmokeRendererCheckScript,
  getSmokeRendererFailureMessage,
} from "./smokeMode";

describe("smoke mode", () => {
  it("is disabled by default", () => {
    expect(getSmokeModeOptions({})).toEqual({
      enabled: false,
      timeoutMs: 10_000,
      readySelector: '[data-testid="agent-chat-panel"]',
      requiredTexts: [],
      viewport: null,
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
      timeoutMs: 2_500,
      readySelector: '[data-testid="agent-chat-panel"]',
      requiredTexts: [],
      viewport: null,
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
      timeoutMs: 10_000,
      readySelector: '[data-testid="agent-chat-panel"]',
      requiredTexts: [],
      viewport: null,
    });
  });

  it("accepts a custom selector and required text checks for targeted QA", () => {
    expect(
      getSmokeModeOptions({
        BUILDING_AGENT_SMOKE: "1",
        BUILDING_AGENT_SMOKE_READY_SELECTOR: ".overview-panel",
        BUILDING_AGENT_SMOKE_REQUIRED_TEXTS:
          "Harness|Agent Capability|native tools",
        BUILDING_AGENT_SMOKE_VIEWPORT: "390x844",
      }),
    ).toEqual({
      enabled: true,
      timeoutMs: 10_000,
      readySelector: ".overview-panel",
      requiredTexts: ["Harness", "Agent Capability", "native tools"],
      viewport: { width: 390, height: 844 },
    });
  });

  it("checks for rendered agent UI instead of only the document load event", () => {
    const script = getSmokeRendererCheckScript(
      getSmokeModeOptions({
        BUILDING_AGENT_SMOKE_READY_SELECTOR: ".overview-panel",
        BUILDING_AGENT_SMOKE_REQUIRED_TEXTS:
          "Harness|Agent Capability|native tools",
      }),
    );

    expect(script).toContain(".overview-panel");
    expect(script).toContain("Agent Capability");
    expect(script).toContain("hasHorizontalOverflow");
    expect(script).toContain("rootTextLength");
  });

  it("reports a useful failure when the renderer document is blank", () => {
    expect(
      getSmokeRendererFailureMessage({
        ok: false,
        hasReadyElement: false,
        hasRoot: true,
        hasHorizontalOverflow: false,
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
        hasHorizontalOverflow: false,
        scrollWidth: 390,
        clientWidth: 390,
        rootTextLength: 200,
        missingTexts: ["Agent Capability"],
        title: "Zerox Agent",
        locationHref: "http://127.0.0.1:5173/#overview",
      }),
    ).toContain("missingTexts=Agent Capability");
  });

  it("reports horizontal overflow in targeted smoke checks", () => {
    expect(
      getSmokeRendererFailureMessage({
        ok: false,
        hasReadyElement: true,
        hasRoot: true,
        hasHorizontalOverflow: true,
        scrollWidth: 420,
        clientWidth: 390,
        rootTextLength: 200,
        missingTexts: [],
        title: "Zerox Agent",
        locationHref: "http://127.0.0.1:5173/#overview",
      }),
    ).toContain("horizontalOverflow=true scrollWidth=420 clientWidth=390");
  });
});
