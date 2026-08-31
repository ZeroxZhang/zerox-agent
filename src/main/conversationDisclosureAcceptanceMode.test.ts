import {
  closeSync,
  mkdtempSync,
  openSync,
  realpathSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { conversationDisclosureScenarioDigests } from "../shared/conversationDisclosureAcceptance";
import { getConversationDisclosureAcceptanceMode } from "./conversationDisclosureAcceptanceMode";

describe("conversation disclosure acceptance mode", () => {
  const descriptorRoot = mkdtempSync(path.join(os.tmpdir(), "cd09-fds-"));
  const outputFd = openSync(path.join(descriptorRoot, "output.json"), "wx", 0o600);
  const screenshotFd = openSync(path.join(descriptorRoot, "screenshot.png"), "wx", 0o600);
  const isolatedUserData = path.join(
    realpathSync(os.tmpdir()),
    "zerox-cd09-S01-default-narrative-test",
    "user-data",
  );
  const isolatedRoot = path.dirname(isolatedUserData);
  const attemptNonce = "11111111-1111-4111-8111-111111111111";

  afterAll(() => {
    closeSync(outputFd);
    closeSync(screenshotFd);
    rmSync(descriptorRoot, { recursive: true, force: true });
  });

  it("stays disabled without a scenario id", () => {
    expect(getConversationDisclosureAcceptanceMode({})).toEqual({
      enabled: false,
    });
  });

  it("accepts only a compiled scenario with exact digest and absolute outputs", () => {
    expect(getConversationDisclosureAcceptanceMode({
      ZEROX_CD09_SCENARIO_ID: "S01-default-narrative",
      ZEROX_CD09_ACCEPTANCE_MODE: "1",
      ZEROX_CD09_SCENARIO_DIGEST:
        conversationDisclosureScenarioDigests["S01-default-narrative"],
      ZEROX_CD09_SCENARIO_EXPECTED:
        JSON.stringify(["one", "two", "three"]),
      ZEROX_CD09_SCENARIO_EVIDENCE_REQUIREMENTS:
        JSON.stringify(["browser", "authority"]),
      ZEROX_CD09_SCENARIO_OUTPUT: path.join(isolatedRoot, "scenario.json"),
      ZEROX_CD09_SCENARIO_SCREENSHOT: path.join(isolatedRoot, "scenario.png"),
      ZEROX_CD09_SCENARIO_OUTPUT_FD: String(outputFd),
      ZEROX_CD09_SCENARIO_SCREENSHOT_FD: String(screenshotFd),
      ZEROX_CD09_ATTEMPT_NONCE: attemptNonce,
      ZEROX_AGENT_USER_DATA_DIR: isolatedUserData,
    })).toEqual({
      enabled: true,
      scenarioId: "S01-default-narrative",
      scenarioDigest:
        conversationDisclosureScenarioDigests["S01-default-narrative"],
      expected: ["one", "two", "three"],
      evidenceRequirements: ["browser", "authority"],
      outputPath: path.join(isolatedRoot, "scenario.json"),
      screenshotPath: path.join(isolatedRoot, "scenario.png"),
      outputFd,
      screenshotFd,
      userDataPath: isolatedUserData,
      attemptNonce,
      phase: "single",
    });
  });

  it("binds S13 to the exact multidomain fixture source cut and absence roster", () => {
    const scenarioId = "S13-legacy-coverage";
    const scenarioUserData = path.join(
      realpathSync(os.tmpdir()),
      `zerox-cd09-${scenarioId}-test`,
      "user-data",
    );
    const scenarioRoot = path.dirname(scenarioUserData);
    const baseEnv = {
      ZEROX_CD09_SCENARIO_ID: scenarioId,
      ZEROX_CD09_ACCEPTANCE_MODE: "1",
      ZEROX_CD09_SCENARIO_DIGEST:
        conversationDisclosureScenarioDigests[scenarioId],
      ZEROX_CD09_SCENARIO_EXPECTED:
        JSON.stringify(["one", "two", "three"]),
      ZEROX_CD09_SCENARIO_EVIDENCE_REQUIREMENTS:
        JSON.stringify(["browser", "authority"]),
      ZEROX_CD09_SCENARIO_OUTPUT: path.join(scenarioRoot, "scenario.json"),
      ZEROX_CD09_SCENARIO_SCREENSHOT: path.join(scenarioRoot, "scenario.png"),
      ZEROX_CD09_SCENARIO_OUTPUT_FD: String(outputFd),
      ZEROX_CD09_SCENARIO_SCREENSHOT_FD: String(screenshotFd),
      ZEROX_CD09_ATTEMPT_NONCE: attemptNonce,
      ZEROX_AGENT_USER_DATA_DIR: scenarioUserData,
      ZEROX_CD09_LEGACY_FIXTURE_DIGEST: `sha256:${"1".repeat(64)}`,
      ZEROX_CD09_LEGACY_SOURCE_CUT_ID:
        `v3.9.1@${"2".repeat(40)}#${"3".repeat(40)}`,
      ZEROX_CD09_LEGACY_INTENTIONAL_ABSENCES: JSON.stringify([
        "conversation_causal_records",
        "workspace_run_records",
        "kernel_records",
        "projection_cursors",
      ]),
      ZEROX_CD09_SCENARIO_PHASE: "restart",
    };
    expect(getConversationDisclosureAcceptanceMode(baseEnv)).toMatchObject({
      enabled: true,
      scenarioId,
      legacyFixtureDigest: `sha256:${"1".repeat(64)}`,
      legacySourceCutId: `v3.9.1@${"2".repeat(40)}#${"3".repeat(40)}`,
      legacyIntentionalAbsences: [
        "conversation_causal_records",
        "workspace_run_records",
        "kernel_records",
        "projection_cursors",
      ],
      phase: "restart",
    });
    expect(() => getConversationDisclosureAcceptanceMode({
      ...baseEnv,
      ZEROX_CD09_LEGACY_INTENTIONAL_ABSENCES:
        JSON.stringify(["kernel_records"]),
    })).toThrow("must contain 4 bounded strings");
    expect(() => getConversationDisclosureAcceptanceMode({
      ...baseEnv,
      ZEROX_CD09_LEGACY_SOURCE_CUT_ID: "chat-sessions:v3.9.1",
    })).toThrow("exact v3.9.1 source cut");
  });

  it("requires an explicit isolated userData directory before acceptance can mutate stores", () => {
    const baseEnv = {
      ZEROX_CD09_SCENARIO_ID: "S01-default-narrative",
      ZEROX_CD09_ACCEPTANCE_MODE: "1",
      ZEROX_CD09_SCENARIO_DIGEST:
        conversationDisclosureScenarioDigests["S01-default-narrative"],
      ZEROX_CD09_SCENARIO_EXPECTED:
        JSON.stringify(["one", "two", "three"]),
      ZEROX_CD09_SCENARIO_EVIDENCE_REQUIREMENTS:
        JSON.stringify(["browser", "authority"]),
      ZEROX_CD09_SCENARIO_OUTPUT: path.join(isolatedRoot, "scenario.json"),
      ZEROX_CD09_SCENARIO_SCREENSHOT: path.join(isolatedRoot, "scenario.png"),
      ZEROX_CD09_SCENARIO_OUTPUT_FD: String(outputFd),
      ZEROX_CD09_SCENARIO_SCREENSHOT_FD: String(screenshotFd),
      ZEROX_CD09_ATTEMPT_NONCE: attemptNonce,
    };
    expect(() => getConversationDisclosureAcceptanceMode(baseEnv))
      .toThrow("isolated userData");
    expect(() => getConversationDisclosureAcceptanceMode({
      ...baseEnv,
      ZEROX_AGENT_USER_DATA_DIR: "relative-user-data",
    })).toThrow("isolated userData");
    expect(() => getConversationDisclosureAcceptanceMode({
      ...baseEnv,
      ZEROX_AGENT_USER_DATA_DIR: isolatedUserData,
      BUILDING_AGENT_USER_DATA_DIR: path.join(
        realpathSync(os.tmpdir()),
        "zerox-cd09-S01-default-narrative-other",
        "user-data",
      ),
    })).toThrow("aliases");
    expect(() => getConversationDisclosureAcceptanceMode({
      ...baseEnv,
      ZEROX_AGENT_USER_DATA_DIR: path.join(
        path.parse(isolatedUserData).root,
        "normal-app-user-data",
      ),
    })).toThrow("system temporary root");
  });

  it("rejects unknown scenarios, drifted digests, and relative outputs", () => {
    expect(() => getConversationDisclosureAcceptanceMode({
      ZEROX_CD09_SCENARIO_ID: "S20-forged",
    })).toThrow("not a compiled scenario");
    expect(() => getConversationDisclosureAcceptanceMode({
      ZEROX_CD09_SCENARIO_ID: "S01-default-narrative",
      ZEROX_CD09_ACCEPTANCE_MODE: "1",
      ZEROX_CD09_SCENARIO_DIGEST: `sha256:${"0".repeat(64)}`,
    })).toThrow("does not match");
    expect(() => getConversationDisclosureAcceptanceMode({
      ZEROX_CD09_SCENARIO_ID: "S01-default-narrative",
      ZEROX_CD09_ACCEPTANCE_MODE: "1",
      ZEROX_CD09_SCENARIO_DIGEST:
        conversationDisclosureScenarioDigests["S01-default-narrative"],
      ZEROX_CD09_SCENARIO_EXPECTED:
        JSON.stringify(["one", "two", "three"]),
      ZEROX_CD09_SCENARIO_EVIDENCE_REQUIREMENTS:
        JSON.stringify(["browser", "authority"]),
      ZEROX_CD09_SCENARIO_OUTPUT: "relative.json",
      ZEROX_CD09_SCENARIO_SCREENSHOT: path.join(isolatedRoot, "scenario.png"),
      ZEROX_CD09_ATTEMPT_NONCE: attemptNonce,
      ZEROX_AGENT_USER_DATA_DIR: isolatedUserData,
    })).toThrow("must be an absolute path");
    expect(() => getConversationDisclosureAcceptanceMode({
      ZEROX_CD09_SCENARIO_ID: "S01-default-narrative",
      ZEROX_CD09_ACCEPTANCE_MODE: "1",
      ZEROX_CD09_SCENARIO_DIGEST:
        conversationDisclosureScenarioDigests["S01-default-narrative"],
      ZEROX_CD09_SCENARIO_EXPECTED:
        JSON.stringify(["one", "two", "three"]),
      ZEROX_CD09_SCENARIO_EVIDENCE_REQUIREMENTS:
        JSON.stringify(["browser", "authority"]),
      ZEROX_CD09_SCENARIO_OUTPUT: path.join(isolatedRoot, "scenario.json"),
      ZEROX_CD09_SCENARIO_SCREENSHOT: path.join(isolatedRoot, "scenario.png"),
      ZEROX_CD09_SCENARIO_OUTPUT_FD: String(outputFd),
      ZEROX_CD09_SCENARIO_SCREENSHOT_FD: String(screenshotFd),
      ZEROX_CD09_ATTEMPT_NONCE: attemptNonce,
      ZEROX_CD09_SCENARIO_PHASE: "restart",
      ZEROX_AGENT_USER_DATA_DIR: isolatedUserData,
    })).toThrow("Only restart scenarios");
  });
});
