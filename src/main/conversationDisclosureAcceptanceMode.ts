import path from "node:path";
import {
  conversationDisclosureScenarioDigests,
  isConversationDisclosureScenarioId,
  type ConversationDisclosureScenarioId,
} from "../shared/conversationDisclosureAcceptance";

export type ConversationDisclosureAcceptanceEnabledMode = {
  enabled: true;
  scenarioId: ConversationDisclosureScenarioId;
  scenarioDigest: string;
  expected: string[];
  evidenceRequirements: string[];
  outputPath: string;
  screenshotPath: string;
  phase: "single" | "initial" | "restart";
};

export type ConversationDisclosureAcceptanceMode =
  | { enabled: false }
  | ConversationDisclosureAcceptanceEnabledMode;

export function getConversationDisclosureAcceptanceMode(
  env: NodeJS.ProcessEnv,
): ConversationDisclosureAcceptanceMode {
  const scenarioId = env.ZEROX_CD09_SCENARIO_ID?.trim() ?? "";
  if (!scenarioId) return { enabled: false };
  if (!isConversationDisclosureScenarioId(scenarioId)) {
    throw new Error("ZEROX_CD09_SCENARIO_ID is not a compiled scenario.");
  }
  const scenarioDigest = env.ZEROX_CD09_SCENARIO_DIGEST?.trim() ?? "";
  if (scenarioDigest !== conversationDisclosureScenarioDigests[scenarioId]) {
    throw new Error("ZEROX_CD09_SCENARIO_DIGEST does not match the compiled scenario.");
  }
  const outputPath = requireAbsolutePath(
    env.ZEROX_CD09_SCENARIO_OUTPUT,
    "ZEROX_CD09_SCENARIO_OUTPUT",
  );
  const expected = requireStringArray(
    env.ZEROX_CD09_SCENARIO_EXPECTED,
    "ZEROX_CD09_SCENARIO_EXPECTED",
    3,
  );
  const evidenceRequirements = requireStringArray(
    env.ZEROX_CD09_SCENARIO_EVIDENCE_REQUIREMENTS,
    "ZEROX_CD09_SCENARIO_EVIDENCE_REQUIREMENTS",
    2,
  );
  const screenshotPath = requireAbsolutePath(
    env.ZEROX_CD09_SCENARIO_SCREENSHOT,
    "ZEROX_CD09_SCENARIO_SCREENSHOT",
  );
  const phase = env.ZEROX_CD09_SCENARIO_PHASE?.trim() || "single";
  if (!["single", "initial", "restart"].includes(phase)) {
    throw new Error("ZEROX_CD09_SCENARIO_PHASE is invalid.");
  }
  if (
    phase !== "single"
    && scenarioId !== "S13-legacy-coverage"
    && scenarioId !== "S17-cancel-interruption"
  ) {
    throw new Error("Only restart scenarios may use a multi-process phase.");
  }
  return {
    enabled: true,
    scenarioId,
    scenarioDigest,
    expected,
    evidenceRequirements,
    outputPath,
    screenshotPath,
    phase: phase as "single" | "initial" | "restart",
  };
}

function requireStringArray(
  value: string | undefined,
  name: string,
  expectedLength: number,
): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value ?? "");
  } catch {
    throw new Error(`${name} must be valid JSON.`);
  }
  if (
    !Array.isArray(parsed)
    || parsed.length !== expectedLength
    || parsed.some(
      (entry) =>
        typeof entry !== "string"
        || entry.length === 0
        || entry.length > 1_024,
    )
  ) {
    throw new Error(`${name} must contain ${expectedLength} bounded strings.`);
  }
  return [...parsed];
}

function requireAbsolutePath(
  value: string | undefined,
  name: string,
): string {
  const candidate = value?.trim() ?? "";
  if (!path.isAbsolute(candidate)) {
    throw new Error(`${name} must be an absolute path.`);
  }
  return path.resolve(candidate);
}
