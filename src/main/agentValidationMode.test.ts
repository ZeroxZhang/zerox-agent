import { describe, expect, it } from "vitest";
import { getAgentValidationModeOptions } from "./agentValidationMode";

describe("agent validation mode", () => {
  it("is disabled by default", () => {
    expect(getAgentValidationModeOptions({})).toEqual({
      enabled: false,
      timeoutMs: 180_000,
      apiInfoPath: ".api_info.md",
    });
  });

  it("enables full desktop validation from the environment", () => {
    expect(
      getAgentValidationModeOptions({
        BUILDING_AGENT_VALIDATE: "1",
        BUILDING_AGENT_VALIDATE_TIMEOUT_MS: "60000",
        BUILDING_AGENT_API_INFO_PATH: "local.api.md",
      }),
    ).toEqual({
      enabled: true,
      timeoutMs: 60_000,
      apiInfoPath: "local.api.md",
    });
  });

  it("keeps safe defaults when validation environment values are invalid", () => {
    expect(
      getAgentValidationModeOptions({
        BUILDING_AGENT_VALIDATE: "1",
        BUILDING_AGENT_VALIDATE_TIMEOUT_MS: "bad",
        BUILDING_AGENT_API_INFO_PATH: "",
      }),
    ).toEqual({
      enabled: true,
      timeoutMs: 180_000,
      apiInfoPath: ".api_info.md",
    });
  });
});
