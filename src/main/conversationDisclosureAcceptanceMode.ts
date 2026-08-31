import { existsSync, fstatSync, lstatSync, realpathSync } from "node:fs";
import os from "node:os";
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
  outputFd: number;
  screenshotFd: number;
  userDataPath: string;
  attemptNonce: string;
  secretCanary?: string;
  legacyFixtureDigest?: string;
  legacySourceCutId?: string;
  legacyIntentionalAbsences?: string[];
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
  if (env.ZEROX_CD09_ACCEPTANCE_MODE !== "1") {
    throw new Error("ZEROX_CD09_ACCEPTANCE_MODE must explicitly enable acceptance.");
  }
  const scenarioDigest = env.ZEROX_CD09_SCENARIO_DIGEST?.trim() ?? "";
  if (scenarioDigest !== conversationDisclosureScenarioDigests[scenarioId]) {
    throw new Error("ZEROX_CD09_SCENARIO_DIGEST does not match the compiled scenario.");
  }
  const isolation = requireIsolatedUserDataDir(env, scenarioId);
  const outputPath = requireScenarioArtifactPath(
    env.ZEROX_CD09_SCENARIO_OUTPUT,
    "ZEROX_CD09_SCENARIO_OUTPUT",
    isolation.scenarioRoot,
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
  const screenshotPath = requireScenarioArtifactPath(
    env.ZEROX_CD09_SCENARIO_SCREENSHOT,
    "ZEROX_CD09_SCENARIO_SCREENSHOT",
    isolation.scenarioRoot,
  );
  const outputFd = requireScenarioArtifactFd(
    env.ZEROX_CD09_SCENARIO_OUTPUT_FD,
    "ZEROX_CD09_SCENARIO_OUTPUT_FD",
  );
  const screenshotFd = requireScenarioArtifactFd(
    env.ZEROX_CD09_SCENARIO_SCREENSHOT_FD,
    "ZEROX_CD09_SCENARIO_SCREENSHOT_FD",
  );
  if (outputFd === screenshotFd) {
    throw new Error("CD09 acceptance artifact descriptors must be distinct.");
  }
  const attemptNonce = env.ZEROX_CD09_ATTEMPT_NONCE?.trim() ?? "";
  if (!/^[0-9a-f-]{36}$/.test(attemptNonce)) {
    throw new Error("ZEROX_CD09_ATTEMPT_NONCE must bind the child attempt.");
  }
  const secretCanary = env.ZEROX_CD09_SECRET_CANARY?.trim() ?? "";
  if (
    scenarioId === "S11-secret-safety"
    && !/^cd09_[a-f0-9]{32}$/.test(secretCanary)
  ) {
    throw new Error("S11 requires one bounded synthetic secret canary.");
  }
  const legacyFixtureDigest =
    env.ZEROX_CD09_LEGACY_FIXTURE_DIGEST?.trim() ?? "";
  if (
    scenarioId === "S13-legacy-coverage"
    && !/^sha256:[a-f0-9]{64}$/.test(legacyFixtureDigest)
  ) {
    throw new Error("S13 requires the immutable v3.9.1 fixture digest.");
  }
  const legacySourceCutId =
    env.ZEROX_CD09_LEGACY_SOURCE_CUT_ID?.trim() ?? "";
  if (
    scenarioId === "S13-legacy-coverage"
    && !/^v3\.9\.1@[a-f0-9]{40}#[a-f0-9]{40}$/.test(legacySourceCutId)
  ) {
    throw new Error("S13 requires the exact v3.9.1 source cut identity.");
  }
  const legacyIntentionalAbsences = scenarioId === "S13-legacy-coverage"
    ? requireStringArray(
        env.ZEROX_CD09_LEGACY_INTENTIONAL_ABSENCES,
        "ZEROX_CD09_LEGACY_INTENTIONAL_ABSENCES",
        4,
      )
    : [];
  if (
    new Set(legacyIntentionalAbsences).size !== legacyIntentionalAbsences.length
    || legacyIntentionalAbsences.some((entry) => !/^[a-z][a-z0-9_]*$/.test(entry))
  ) {
    throw new Error("S13 intentional absences must be unique stable domain ids.");
  }
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
    outputFd,
    screenshotFd,
    userDataPath: isolation.userDataPath,
    attemptNonce,
    ...(secretCanary ? { secretCanary } : {}),
    ...(legacyFixtureDigest ? { legacyFixtureDigest } : {}),
    ...(legacySourceCutId ? { legacySourceCutId } : {}),
    ...(legacyIntentionalAbsences.length > 0
      ? { legacyIntentionalAbsences }
      : {}),
    phase: phase as "single" | "initial" | "restart",
  };
}

function requireScenarioArtifactFd(
  value: string | undefined,
  name: string,
): number {
  if (!/^(?:[3-9]|[1-9]\d+)$/.test(value ?? "")) {
    throw new Error(`${name} must identify an inherited artifact descriptor.`);
  }
  const fd = Number(value);
  if (!Number.isSafeInteger(fd) || fd > 255) {
    throw new Error(`${name} is outside the accepted descriptor range.`);
  }
  let stats;
  try {
    stats = fstatSync(fd);
  } catch {
    throw new Error(`${name} is not an open inherited descriptor.`);
  }
  const currentUid = typeof process.getuid === "function" ? process.getuid() : null;
  if (
    !stats.isFile()
    || stats.size !== 0
    || stats.nlink !== 1
    || (stats.mode & 0o777) !== 0o600
    || (currentUid !== null && stats.uid !== currentUid)
  ) {
    throw new Error(`${name} must bind one empty regular artifact file.`);
  }
  return fd;
}

function requireIsolatedUserDataDir(
  env: NodeJS.ProcessEnv,
  scenarioId: ConversationDisclosureScenarioId,
): { userDataPath: string; scenarioRoot: string } {
  const primary = env.ZEROX_AGENT_USER_DATA_DIR?.trim() ?? "";
  const legacy = env.BUILDING_AGENT_USER_DATA_DIR?.trim() ?? "";
  const candidate = primary || legacy;
  const resolved = path.resolve(candidate);
  const temporaryRoot = realpathSync(os.tmpdir());
  const attemptRoot = path.dirname(resolved);
  const directRootName = path.basename(attemptRoot);
  const ownerRoot = directRootName.startsWith(`zerox-cd09-${scenarioId}-`)
    ? attemptRoot
    : path.dirname(attemptRoot);
  const scenarioRootName = path.basename(ownerRoot);
  if (
    !path.isAbsolute(candidate)
    || path.parse(candidate).root === resolved
    || (
      resolved !== temporaryRoot
      && !resolved.startsWith(`${temporaryRoot}${path.sep}`)
    )
    || path.basename(resolved) !== "user-data"
    || !scenarioRootName.startsWith(`zerox-cd09-${scenarioId}-`)
    || (
      ownerRoot !== attemptRoot
      && !/^attempt-\d+-[a-zA-Z0-9_-]+$/.test(directRootName)
    )
  ) {
    throw new Error(
      "CD09 acceptance requires a scenario-bound isolated userData directory under the system temporary root.",
    );
  }
  if (
    primary
    && legacy
    && path.resolve(primary) !== path.resolve(legacy)
  ) {
    throw new Error("CD09 acceptance userData aliases must identify the same directory.");
  }
  assertNoSymlinkComponents(temporaryRoot, ownerRoot);
  assertNoSymlinkComponents(ownerRoot, attemptRoot);
  assertNoSymlinkComponents(attemptRoot, resolved);
  return { userDataPath: resolved, scenarioRoot: attemptRoot };
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

function requireScenarioArtifactPath(
  value: string | undefined,
  name: string,
  scenarioRoot: string,
): string {
  const candidate = value?.trim() ?? "";
  if (!path.isAbsolute(candidate)) {
    throw new Error(`${name} must be an absolute path.`);
  }
  const resolved = path.resolve(candidate);
  if (
    resolved === scenarioRoot
    || !resolved.startsWith(`${scenarioRoot}${path.sep}`)
  ) {
    throw new Error(`${name} must stay inside the scenario isolation root.`);
  }
  assertNoSymlinkComponents(scenarioRoot, resolved);
  return resolved;
}

function assertNoSymlinkComponents(root: string, target: string): void {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  if (
    resolvedTarget !== resolvedRoot
    && !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    throw new Error("CD09 acceptance path escaped its isolation root.");
  }
  const relative = path.relative(resolvedRoot, resolvedTarget);
  let cursor = resolvedRoot;
  for (const segment of relative ? relative.split(path.sep) : []) {
    cursor = path.join(cursor, segment);
    if (!existsSync(cursor)) continue;
    const stats = lstatSync(cursor);
    if (stats.isSymbolicLink()) {
      throw new Error("CD09 acceptance isolation rejects symbolic links.");
    }
  }
  if (existsSync(resolvedRoot)) {
    const rootStats = lstatSync(resolvedRoot);
    if (rootStats.isSymbolicLink()) {
      throw new Error("CD09 acceptance isolation rejects symbolic links.");
    }
  }
}
