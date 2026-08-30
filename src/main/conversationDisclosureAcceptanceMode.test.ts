import { describe, expect, it } from "vitest";
import { conversationDisclosureScenarioDigests } from "../shared/conversationDisclosureAcceptance";
import { getConversationDisclosureAcceptanceMode } from "./conversationDisclosureAcceptanceMode";

describe("conversation disclosure acceptance mode", () => {
  it("stays disabled without a scenario id", () => {
    expect(getConversationDisclosureAcceptanceMode({})).toEqual({
      enabled: false,
    });
  });

  it("accepts only a compiled scenario with exact digest and absolute outputs", () => {
    expect(getConversationDisclosureAcceptanceMode({
      ZEROX_CD09_SCENARIO_ID: "S01-default-narrative",
      ZEROX_CD09_SCENARIO_DIGEST:
        conversationDisclosureScenarioDigests["S01-default-narrative"],
      ZEROX_CD09_SCENARIO_EXPECTED:
        JSON.stringify(["one", "two", "three"]),
      ZEROX_CD09_SCENARIO_EVIDENCE_REQUIREMENTS:
        JSON.stringify(["browser", "authority"]),
      ZEROX_CD09_SCENARIO_OUTPUT: "/tmp/scenario.json",
      ZEROX_CD09_SCENARIO_SCREENSHOT: "/tmp/scenario.png",
    })).toEqual({
      enabled: true,
      scenarioId: "S01-default-narrative",
      scenarioDigest:
        conversationDisclosureScenarioDigests["S01-default-narrative"],
      expected: ["one", "two", "three"],
      evidenceRequirements: ["browser", "authority"],
      outputPath: "/tmp/scenario.json",
      screenshotPath: "/tmp/scenario.png",
      phase: "single",
    });
  });

  it("rejects unknown scenarios, drifted digests, and relative outputs", () => {
    expect(() => getConversationDisclosureAcceptanceMode({
      ZEROX_CD09_SCENARIO_ID: "S20-forged",
    })).toThrow("not a compiled scenario");
    expect(() => getConversationDisclosureAcceptanceMode({
      ZEROX_CD09_SCENARIO_ID: "S01-default-narrative",
      ZEROX_CD09_SCENARIO_DIGEST: `sha256:${"0".repeat(64)}`,
    })).toThrow("does not match");
    expect(() => getConversationDisclosureAcceptanceMode({
      ZEROX_CD09_SCENARIO_ID: "S01-default-narrative",
      ZEROX_CD09_SCENARIO_DIGEST:
        conversationDisclosureScenarioDigests["S01-default-narrative"],
      ZEROX_CD09_SCENARIO_EXPECTED:
        JSON.stringify(["one", "two", "three"]),
      ZEROX_CD09_SCENARIO_EVIDENCE_REQUIREMENTS:
        JSON.stringify(["browser", "authority"]),
      ZEROX_CD09_SCENARIO_OUTPUT: "relative.json",
      ZEROX_CD09_SCENARIO_SCREENSHOT: "/tmp/scenario.png",
    })).toThrow("must be an absolute path");
    expect(() => getConversationDisclosureAcceptanceMode({
      ZEROX_CD09_SCENARIO_ID: "S01-default-narrative",
      ZEROX_CD09_SCENARIO_DIGEST:
        conversationDisclosureScenarioDigests["S01-default-narrative"],
      ZEROX_CD09_SCENARIO_EXPECTED:
        JSON.stringify(["one", "two", "three"]),
      ZEROX_CD09_SCENARIO_EVIDENCE_REQUIREMENTS:
        JSON.stringify(["browser", "authority"]),
      ZEROX_CD09_SCENARIO_OUTPUT: "/tmp/scenario.json",
      ZEROX_CD09_SCENARIO_SCREENSHOT: "/tmp/scenario.png",
      ZEROX_CD09_SCENARIO_PHASE: "restart",
    })).toThrow("Only restart scenarios");
  });
});
