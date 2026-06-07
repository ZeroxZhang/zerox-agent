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
    });
  });

  it("checks for rendered agent UI instead of only the document load event", () => {
    const script = getSmokeRendererCheckScript();

    expect(script).toContain("agent-chat-panel");
    expect(script).toContain("rootTextLength");
  });

  it("reports a useful failure when the renderer document is blank", () => {
    expect(
      getSmokeRendererFailureMessage({
        ok: false,
        hasReadyElement: false,
        hasRoot: true,
        rootTextLength: 0,
        title: "Zerox Agent",
        locationHref: "file:///app/dist/index.html",
      }),
    ).toContain("renderer did not render the agent chat panel");
  });
});
