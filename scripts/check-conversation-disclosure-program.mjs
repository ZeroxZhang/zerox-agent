import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
  CLOSURE_STATUS_ATTESTED,
  CLOSURE_STATUS_PENDING,
  hashCanonical as hashReviewCanonical,
  validateClosureManifest,
  validateExternalAnchor,
  validateExternalAttestation,
  validateReviewSet,
  validateReviewSnapshot,
} from "./conversation-disclosure-review-contract.mjs";

const root = process.cwd();
const canonicalRoot = await realpath(root);
const canonicalAcceptanceManifest =
  ".zerox/verification/conversation-disclosure/CD09-real-app-acceptance.json";
const canonicalCd03Artifact =
  ".zerox/verification/conversation-disclosure/CD03-causal-shadow.json";
const requiredCd03ReviewLanes = ["contract", "runtime", "governance"];
const requiredCd03CharacterizationIds = [
  "C01-global-request-claim",
  "C02-attempt-control",
  "C03-assistant-receipt-order",
  "C04-message-first-repair",
  "C05-required-settlement",
  "C06-ordinary-queue-drain",
  "C07-workspace-lifecycle",
  "C08-event-first-repair",
  "C09-approval-durability",
  "C10-approval-recovery",
  "C11-distinct-causal-identities",
  "C12-single-live-answer",
  "C13-safe-compatibility",
];
const requiredCd03VerificationIds = [
  "focused",
  "test_type_coverage",
  "full_verify",
  "production_smoke",
  "governance",
];
const requiredCd03ExecutableClosurePaths = [
  "package.json",
  "scripts/check-harness-state.mjs",
  "scripts/check-conversation-disclosure-program.mjs",
];
const freezeTransactionKeys = [
  "artifactPath",
  "digest",
  "kind",
  "mode",
  "originalArtifactDigest",
  "originalSnapshotDigest",
  "round",
  "schemaVersion",
  "snapshotPath",
  "status",
  "targetArtifactDigest",
  "targetSnapshotDigest",
];
const externalPublicationTransactionKeys = [
  "anchorOutputPath",
  "attestation",
  "attestationPath",
  "digest",
  "externalAnchor",
  "finalManifest",
  "kind",
  "manifestPath",
  "originalManifestDigest",
  "schemaVersion",
  "status",
  "targetAnchorDigest",
  "targetAttestationDigest",
  "targetManifestDigest",
];
const closureOptions = parseClosureOptions(process.argv.slice(2));
const errors = [...closureOptions.errors];

const [manifest, featureList] = await Promise.all([
  readInitialControlJson(
    ".zerox/conversation-disclosure-program.json",
    "conversation disclosure program control input",
  ),
  readInitialControlJson(
    ".zerox/feature_list.json",
    "Feature list control input",
  ),
]);

if (manifest.schemaVersion !== 1) {
  errors.push("conversation disclosure program schemaVersion must be 1");
}
if (manifest.status !== "active" && manifest.status !== "completed") {
  errors.push('conversation disclosure program status must be "active" or "completed"');
}
if (manifest.maxActiveFeatures !== 1) {
  errors.push("conversation disclosure maxActiveFeatures must remain 1");
}
if (!Array.isArray(manifest.invariants) || manifest.invariants.length < 5) {
  errors.push("conversation disclosure program must declare at least five invariants");
}
if (!Array.isArray(manifest.nonGoals) || manifest.nonGoals.length < 3) {
  errors.push("conversation disclosure program must declare nonGoals");
}
if (!Array.isArray(manifest.deferrals) || manifest.deferrals.length === 0) {
  errors.push("conversation disclosure program must declare deferrals");
}
if (!Array.isArray(manifest.workstreams) || manifest.workstreams.length === 0) {
  errors.push("conversation disclosure program must declare workstreams");
}
if (!Array.isArray(manifest.scenarioMatrix) || manifest.scenarioMatrix.length === 0) {
  errors.push("conversation disclosure program must declare scenarioMatrix");
}
if (!Array.isArray(featureList.features)) {
  errors.push("feature_list.json must declare features");
}

await requireFile(manifest.sourceReview, "sourceReview");
await requireFile(manifest.operatingGuide, "operatingGuide");
await requireFile(manifest.architectureDecision, "architectureDecision");
if (manifest.acceptanceManifest !== canonicalAcceptanceManifest) {
  errors.push(`acceptanceManifest must remain ${canonicalAcceptanceManifest}`);
}

const expectedFindings = new Set(
  Array.from({ length: 13 }, (_, index) => `D${index + 1}`),
);
const declaredFindings = new Set(manifest.rootFindings ?? []);
for (const finding of expectedFindings) {
  if (!declaredFindings.has(finding)) {
    errors.push(`conversation disclosure rootFindings is missing ${finding}`);
  }
}
for (const finding of declaredFindings) {
  if (!expectedFindings.has(finding)) {
    errors.push(`conversation disclosure rootFindings has unknown ${finding}`);
  }
}

const requiredScenarioCategories = new Set([
  "default",
  "expanded",
  "evidence",
  "failure",
  "approval",
  "recovery",
  "plan",
  "scheduled",
  "long_session",
  "accessibility",
  "secret_safety",
  "retry",
  "legacy",
  "guided_input",
  "goal_acceptance",
  "plan_confirmation",
  "cancel",
  "context_usage",
  "unknown_coverage",
]);
const scenarios = new Map();
const seenScenarioCategories = new Set();
for (const [index, scenario] of (manifest.scenarioMatrix ?? []).entries()) {
  const subject = `scenarioMatrix[${index}]`;
  if (!nonEmpty(scenario.id)) errors.push(`${subject}.id is required`);
  if (scenarios.has(scenario.id)) {
    errors.push(`duplicate scenario id ${JSON.stringify(scenario.id)}`);
  }
  scenarios.set(scenario.id, scenario);
  if (!requiredScenarioCategories.has(scenario.category)) {
    errors.push(`${subject}.category is invalid`);
  } else {
    seenScenarioCategories.add(scenario.category);
  }
  if (!nonEmpty(scenario.title)) errors.push(`${subject}.title is required`);
  if (!nonEmpty(scenario.surface)) errors.push(`${subject}.surface is required`);
  if (scenario.executor !== "browser" && scenario.executor !== "hybrid") {
    errors.push(`${subject}.executor must be browser or hybrid`);
  }
  if (!nonEmpty(scenario.fixture)) errors.push(`${subject}.fixture is required`);
  if (!nonEmpty(scenario.setup)) errors.push(`${subject}.setup is required`);
  if (!stringArray(scenario.actions)) {
    errors.push(`${subject}.actions must contain non-empty strings`);
  }
  if (!stringArray(scenario.expected)) {
    errors.push(`${subject}.expected must contain non-empty strings`);
  }
  if (!stringArray(scenario.evidenceRequirements)) {
    errors.push(`${subject}.evidenceRequirements must contain non-empty strings`);
  }
  if (!Array.isArray(scenario.acceptanceEvidence)) {
    errors.push(`${subject}.acceptanceEvidence must be an array`);
  }
}
for (const category of requiredScenarioCategories) {
  if (!seenScenarioCategories.has(category)) {
    errors.push(`scenarioMatrix is missing required category ${category}`);
  }
}

const deferralIds = new Set();
for (const [index, deferral] of (manifest.deferrals ?? []).entries()) {
  const subject = `deferrals[${index}]`;
  if (!nonEmpty(deferral.id)) errors.push(`${subject}.id is required`);
  if (deferralIds.has(deferral.id)) {
    errors.push(`duplicate deferral id ${JSON.stringify(deferral.id)}`);
  }
  deferralIds.add(deferral.id);
  if (deferral.status !== "kept_deferred") {
    errors.push(`${subject}.status must be "kept_deferred"`);
  }
  if (!nonEmpty(deferral.trigger)) errors.push(`${subject}.trigger is required`);
  if (!nonEmpty(deferral.prohibitedCurrentAction)) {
    errors.push(`${subject}.prohibitedCurrentAction is required`);
  }
}

const workstreams = new Map();
const featureIds = new Set();
const referencedScenarioIds = new Set();
for (const [index, workstream] of (manifest.workstreams ?? []).entries()) {
  const subject = `workstreams[${index}]`;
  if (!nonEmpty(workstream.id)) errors.push(`${subject}.id is required`);
  if (workstreams.has(workstream.id)) {
    errors.push(`duplicate workstream id ${JSON.stringify(workstream.id)}`);
  }
  workstreams.set(workstream.id, workstream);
  if (!nonEmpty(workstream.featureId)) {
    errors.push(`${subject}.featureId is required`);
  } else if (featureIds.has(workstream.featureId)) {
    errors.push(`duplicate workstream featureId ${JSON.stringify(workstream.featureId)}`);
  } else {
    featureIds.add(workstream.featureId);
  }
  if (!["planned", "in_progress", "completed"].includes(workstream.state)) {
    errors.push(`${subject}.state is invalid`);
  }
  if (!stringArray(workstream.findings)) {
    errors.push(`${subject}.findings must contain root finding ids`);
  } else {
    for (const finding of workstream.findings) {
      if (!expectedFindings.has(finding)) {
        errors.push(`${subject}.findings contains unknown ${finding}`);
      }
    }
  }
  if (!Array.isArray(workstream.dependsOn)) {
    errors.push(`${subject}.dependsOn must be an array`);
  }
  if (typeof workstream.architectureDecisionRequired !== "boolean") {
    errors.push(`${subject}.architectureDecisionRequired must be boolean`);
  }
  if (workstream.architectureDecisionRequired) {
    if (!nonEmpty(workstream.architectureDecision)) {
      errors.push(`${subject}.architectureDecision is required`);
    } else if (!repositoryPath(workstream.architectureDecision)) {
      errors.push(`${subject}.architectureDecision must stay inside the repository`);
    } else if (workstream.state !== "planned") {
      await requireFile(workstream.architectureDecision, `${subject}.architectureDecision`);
    }
  }
  if (!stringArray(workstream.completionArtifacts)) {
    errors.push(`${subject}.completionArtifacts must contain repository-relative paths`);
  } else {
    for (const artifactPath of workstream.completionArtifacts) {
      if (!repositoryPath(artifactPath)) {
        errors.push(`${subject}.completionArtifacts must stay inside the repository`);
      } else if (workstream.state === "completed") {
        await requireFile(artifactPath, `${subject}.completionArtifacts`);
        if (artifactPath.endsWith(".json")) {
          await requireJson(artifactPath, `${subject}.completionArtifacts`);
        }
      }
    }
  }
  if (!nonEmpty(workstream.rollback)) {
    errors.push(`${subject}.rollback is required`);
  }
  if (!stringArray(workstream.verification)) {
    errors.push(`${subject}.verification must contain non-empty strings`);
  }
  if (!stringArray(workstream.acceptanceScenarioIds)) {
    errors.push(`${subject}.acceptanceScenarioIds must contain scenario ids`);
  } else {
    for (const scenarioId of workstream.acceptanceScenarioIds) {
      referencedScenarioIds.add(scenarioId);
      if (!scenarios.has(scenarioId)) {
        errors.push(`${subject} references unknown scenario ${JSON.stringify(scenarioId)}`);
      }
    }
  }
}

for (const workstream of workstreams.values()) {
  for (const dependency of workstream.dependsOn ?? []) {
    if (!workstreams.has(dependency)) {
      errors.push(`${workstream.id} depends on unknown workstream ${JSON.stringify(dependency)}`);
    }
  }
}
detectCycles(workstreams, errors);

const orderedWorkstreams = [...workstreams.values()];
if ((orderedWorkstreams[0]?.dependsOn ?? []).length > 0) {
  errors.push(`${orderedWorkstreams[0].id} must be the dependency root`);
}
for (let index = 1; index < orderedWorkstreams.length; index += 1) {
  const previous = orderedWorkstreams[index - 1];
  const current = orderedWorkstreams[index];
  if (!dependsTransitively(current.id, previous.id, workstreams)) {
    errors.push(`${current.id} must depend transitively on preceding workstream ${previous.id}`);
  }
}

let observedActive = false;
let observedPlanned = false;
for (const workstream of orderedWorkstreams) {
  if (workstream.state === "completed" && (observedActive || observedPlanned)) {
    errors.push(`completed workstream ${workstream.id} cannot follow unfinished work`);
  } else if (workstream.state === "in_progress") {
    if (observedActive || observedPlanned) {
      errors.push(`in_progress workstream ${workstream.id} is outside the ordered active boundary`);
    }
    observedActive = true;
  } else if (workstream.state === "planned") {
    observedPlanned = true;
  }
  if (workstream.state !== "planned") {
    const unfinishedDependency = (workstream.dependsOn ?? []).find(
      (dependency) => workstreams.get(dependency)?.state !== "completed",
    );
    if (unfinishedDependency) {
      errors.push(`${workstream.id} is ${workstream.state} before dependency ${unfinishedDependency} completed`);
    }
  }
}

for (const scenarioId of scenarios.keys()) {
  if (!referencedScenarioIds.has(scenarioId)) {
    errors.push(`scenario ${scenarioId} is not referenced by any workstream`);
  }
}

const coveredFindings = new Set(
  [...workstreams.values()].flatMap((workstream) => workstream.findings ?? []),
);
for (const finding of expectedFindings) {
  if (!coveredFindings.has(finding)) {
    errors.push(`conversation disclosure program does not cover ${finding}`);
  }
}

const implementationCompletion = workstreams.get(
  manifest.implementationCompletionWorkstreamId,
);
if (!implementationCompletion) {
  errors.push("implementationCompletionWorkstreamId must identify a workstream");
}
if (!stringArray(manifest.postImplementationGates)) {
  errors.push("postImplementationGates must contain workstream ids");
} else {
  for (const workstreamId of manifest.postImplementationGates) {
    if (!workstreams.has(workstreamId)) {
      errors.push(`postImplementationGates contains unknown ${workstreamId}`);
    }
  }
}
const implementationIndex = orderedWorkstreams.findIndex(
  (workstream) => workstream.id === manifest.implementationCompletionWorkstreamId,
);
if (implementationIndex < 1 || implementationIndex >= orderedWorkstreams.length - 1) {
  errors.push("implementationCompletionWorkstreamId must follow the foundation and precede post-implementation gates");
} else if (Array.isArray(manifest.postImplementationGates)) {
  const expectedPostGates = orderedWorkstreams
    .slice(implementationIndex + 1)
    .map((workstream) => workstream.id);
  if (
    manifest.postImplementationGates.length !== expectedPostGates.length
    || manifest.postImplementationGates.some(
      (workstreamId, index) => workstreamId !== expectedPostGates[index],
    )
  ) {
    errors.push("postImplementationGates must equal the ordered workstreams after implementation completion");
  }
  for (const workstreamId of manifest.postImplementationGates) {
    if (
      workstreams.has(workstreamId)
      && !dependsTransitively(
        workstreamId,
        manifest.implementationCompletionWorkstreamId,
        workstreams,
      )
    ) {
      errors.push(`${workstreamId} must depend transitively on implementation completion ${manifest.implementationCompletionWorkstreamId}`);
    }
  }
}

if (implementationIndex >= 1) {
  const implementationFindings = new Set(
    orderedWorkstreams
      .slice(1, implementationIndex + 1)
      .flatMap((workstream) => workstream.findings ?? []),
  );
  for (const finding of expectedFindings) {
    if (!implementationFindings.has(finding)) {
      errors.push(`implementation workstreams do not own ${finding}`);
    }
  }
}
const mandatoryFindingOwners = new Map([
  ["D1", "CD02"],
  ["D2", "CD03"],
  ["D3", "CD03"],
  ["D4", "CD02"],
  ["D5", "CD04"],
  ["D6", "CD03"],
  ["D7", "CD04"],
  ["D8", "CD05"],
  ["D9", "CD03"],
  ["D10", "CD04"],
  ["D11", "CD06"],
  ["D12", "CD04"],
  ["D13", "CD02"],
]);
for (const [finding, ownerId] of mandatoryFindingOwners) {
  const owner = workstreams.get(ownerId);
  if (!owner || !(owner.findings ?? []).includes(finding)) {
    errors.push(`${ownerId} must own root finding ${finding}`);
  }
}
const acceptanceWorkstream = workstreams.get("CD09");
if (!(acceptanceWorkstream?.completionArtifacts ?? []).includes(
  canonicalAcceptanceManifest,
)) {
  errors.push("CD09 completionArtifacts must include the canonical acceptanceManifest");
}

const inProgress = [...workstreams.values()].filter(
  (workstream) => workstream.state === "in_progress",
);
if (inProgress.length > manifest.maxActiveFeatures) {
  errors.push(
    `conversation disclosure program has ${inProgress.length} in-progress workstreams; maximum is ${manifest.maxActiveFeatures}`,
  );
}

const active = manifest.activeFeatureId
  ? [...workstreams.values()].find(
      (workstream) => workstream.featureId === manifest.activeFeatureId,
    )
  : undefined;
if (manifest.status === "active") {
  if (manifest.activeFeatureId === null) {
    if (inProgress.length > 0) {
      errors.push("idle active disclosure program cannot contain an in_progress workstream");
    }
    const next = [...workstreams.values()].find(
      (workstream) => workstream.featureId === manifest.nextFeatureId,
    );
    if (!next || next.state !== "planned") {
      errors.push("idle active disclosure program must point nextFeatureId at planned work");
    } else {
      const unfinishedDependency = (next.dependsOn ?? []).find(
        (dependency) => workstreams.get(dependency)?.state !== "completed",
      );
      if (unfinishedDependency) {
        errors.push(`next disclosure workstream ${next.id} is blocked by ${unfinishedDependency}`);
      }
    }
  } else {
    if (!active || active.state !== "in_progress") {
      errors.push("activeFeatureId must map to an in_progress disclosure workstream");
    }
    if (manifest.nextFeatureId !== manifest.activeFeatureId) {
      errors.push("while disclosure work is active nextFeatureId must equal activeFeatureId");
    }
  }
} else {
  if (manifest.activeFeatureId !== null || manifest.nextFeatureId !== null) {
    errors.push("completed disclosure program must clear activeFeatureId and nextFeatureId");
  }
  if ([...workstreams.values()].some((workstream) => workstream.state !== "completed")) {
    errors.push("completed disclosure program cannot contain unfinished workstreams");
  }
}

const featureMap = new Map(
  (featureList.features ?? []).map((feature) => [feature.id, feature]),
);
const seenFeatureIds = new Set();
for (const feature of featureList.features ?? []) {
  if (!nonEmpty(feature.id)) {
    errors.push("feature_list contains a Feature without an id");
  } else if (seenFeatureIds.has(feature.id)) {
    errors.push(`feature_list has duplicate feature id ${JSON.stringify(feature.id)}`);
  }
  seenFeatureIds.add(feature.id);
}
for (const workstream of workstreams.values()) {
  const feature = featureMap.get(workstream.featureId);
  if (workstream.state === "in_progress") {
    if (!feature) {
      errors.push(`in_progress workstream ${workstream.id} is missing feature ${workstream.featureId}`);
    } else if (feature.status !== "in_progress") {
      errors.push(`feature ${workstream.featureId} must be in_progress while ${workstream.id} is active`);
    }
  }
  if (workstream.state === "completed" && feature?.status !== "done") {
    errors.push(`completed workstream ${workstream.id} requires done feature ${workstream.featureId}`);
  }
  if (workstream.state === "planned" && feature) {
    errors.push(`planned workstream ${workstream.id} cannot already be registered as feature ${workstream.featureId}`);
  }
}

const validatedCd03SnapshotDigest = await validateReviewedShadowCompletion(
  workstreams.get("CD03"),
  featureMap.get(workstreams.get("CD03")?.featureId),
);
if (closureOptions.externalAnchorPath
  && workstreams.get("CD03")?.state !== "completed") {
  errors.push("CD03 external anchor is accepted only for completed CD03 validation");
}
if (closureOptions.closure) {
  if (workstreams.get("CD03")?.state !== "in_progress") {
    errors.push("CD03 closure mode requires an in_progress pending-attestation workstream");
  }
  if (
    validatedCd03SnapshotDigest
    && validatedCd03SnapshotDigest !== closureOptions.expectedSnapshotDigest
  ) {
    errors.push("CD03 closure snapshot digest does not match the externally expected digest");
  }
}

const openFeatures = (featureList.features ?? []).filter(
  (feature) => feature.status !== "done",
);
if (openFeatures.length > manifest.maxActiveFeatures) {
  errors.push(
    `feature_list has ${openFeatures.length} unfinished features; maximum is ${manifest.maxActiveFeatures}`,
  );
}
if (active && !openFeatures.some((feature) => feature.id === active.featureId)) {
  errors.push(`active disclosure feature ${active.featureId} is not unfinished`);
}

const acceptanceClosed = Array.isArray(manifest.postImplementationGates)
  && manifest.postImplementationGates.length > 0
  && manifest.postImplementationGates.every(
    (workstreamId) => workstreams.get(workstreamId)?.state === "completed",
  );
if (acceptanceClosed) {
  for (const scenario of scenarios.values()) {
    if (!stringArray(scenario.acceptanceEvidence)) {
      errors.push(`completed acceptance scenario ${scenario.id} requires evidence artifacts`);
      continue;
    }
    for (const evidencePath of scenario.acceptanceEvidence) {
      await requireFile(evidencePath, `scenario ${scenario.id} acceptanceEvidence`);
    }
  }
  await validateAcceptanceManifest();
}

if (errors.length > 0) {
  console.error("Conversation disclosure program check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `Conversation disclosure program check passed (${workstreams.size} workstreams, `
    + `${inProgress.length} active, ${scenarios.size} scenarios, `
    + `${coveredFindings.size} findings).`,
);
if (closureOptions.closure) {
  console.log(JSON.stringify({
    kind: "cd03-checker-receipt",
    status: "passed",
    snapshotDigest: validatedCd03SnapshotDigest,
  }));
}

async function readInitialControlJson(relativePath, label) {
  try {
    const bytes = await readFrozenRegularFile(relativePath, label);
    return bytes ? JSON.parse(bytes.toString("utf8")) : {};
  } catch {
    errors.push(`${label} must contain valid frozen JSON: ${relativePath}`);
    return {};
  }
}

async function requireJson(relativePath, label) {
  try {
    return JSON.parse(await readFile(path.resolve(root, relativePath), "utf8"));
  } catch {
    errors.push(`${label} must contain valid JSON: ${relativePath}`);
    return undefined;
  }
}

async function requireFrozenJson(relativePath, label, requirePrivate = false) {
  if (!repositoryPath(relativePath)) {
    errors.push(`${label} must use a repository-relative path`);
    return undefined;
  }
  try {
    const bytes = await readFrozenRegularFile(relativePath, label, requirePrivate);
    return bytes ? JSON.parse(bytes.toString("utf8")) : undefined;
  } catch {
    errors.push(`${label} must contain valid frozen JSON: ${relativePath}`);
    return undefined;
  }
}

async function requireGovernanceTransactionSettled(
  relativePath,
  label,
  validateTransaction,
) {
  if (!repositoryPath(relativePath)) {
    errors.push(`${label} path must be repository-relative`);
    return;
  }
  for (const candidatePath of [relativePath, `${relativePath}.remove.tombstone`]) {
    try {
      await lstat(path.resolve(root, candidatePath));
      errors.push(`${label} must be recovered and removed before closure validation`);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        errors.push(`${label} could not be inspected safely`);
      }
    }
  }
  await validateCompletedMarkerFiles({
    directoryPath: path.dirname(path.resolve(root, relativePath)),
    markerBase: `${path.basename(relativePath)}.remove.tombstone`,
    label,
    readCapture: async (markerName) => readFrozenRegularFile(
      path.posix.join(path.posix.dirname(relativePath), markerName),
      `${label} completed marker`,
      true,
      true,
    ),
    validateTransaction,
  });
}

async function validateCompletedMarkerFiles({
  directoryPath,
  markerBase,
  label,
  readCapture,
  validateTransaction,
}) {
  let markerNames;
  try {
    markerNames = (await readdir(directoryPath))
      .filter((entry) => entry.startsWith(`${markerBase}.completed-`)
        && entry.endsWith(".marker"))
      .sort();
  } catch {
    errors.push(`${label} completed markers could not be inspected safely`);
    return;
  }
  if (markerNames.length !== 1) {
    errors.push(`${label} must have exactly one immutable completed marker`);
    return;
  }
  const markerName = markerNames[0];
  const suffix = markerName.slice(
    `${markerBase}.completed-`.length,
    -".marker".length,
  );
  const match = suffix.match(/^([0-9a-f]{64})-([0-9]+)-([0-9]+)$/);
  const capture = await readCapture(markerName);
  if (!match || !capture) {
    errors.push(`${label} completed marker name/schema is invalid`);
    return;
  }
  if (`${capture.dev}` !== match[2] || `${capture.ino}` !== match[3]
    || createHash("sha256").update(capture.bytes).digest("hex") !== match[1]) {
    errors.push(`${label} completed marker identity/digest is stale`);
    return;
  }
  try {
    const value = JSON.parse(capture.bytes.toString("utf8"));
    for (const transactionError of validateTransaction(value)) {
      errors.push(`${label} completed marker ${transactionError}`);
    }
  } catch {
    errors.push(`${label} completed marker must contain valid JSON`);
  }
}

function validateCompletedFreezeTransaction(transaction, bindings) {
  if (!exactObjectKeys(transaction, freezeTransactionKeys)
    || transaction.schemaVersion !== 1
    || transaction.kind !== "conversation-disclosure-review-freeze-transaction"
    || transaction.status !== "prepared") {
    return ["must contain the exact prepared v1 freeze transaction schema"];
  }
  const transactionErrors = [];
  if (!["created", "replaced_pending"].includes(transaction.mode)) {
    transactionErrors.push("mode is invalid");
  }
  if (transaction.round !== bindings.round
    || transaction.snapshotPath !== bindings.snapshotPath
    || transaction.artifactPath !== bindings.artifactPath) {
    transactionErrors.push("identity/path bindings are stale");
  }
  if (!sha256Digest(transaction.targetSnapshotDigest)
    || !sha256Digest(transaction.targetArtifactDigest)
    || (transaction.originalSnapshotDigest !== null
      && !sha256Digest(transaction.originalSnapshotDigest))
    || !sha256Digest(transaction.originalArtifactDigest)) {
    transactionErrors.push("digest fields are invalid");
  }
  if (bindings.targetSnapshotDigest
    && transaction.targetSnapshotDigest !== bindings.targetSnapshotDigest) {
    transactionErrors.push("targetSnapshotDigest binding is stale");
  }
  if (bindings.targetArtifactDigest
    && transaction.targetArtifactDigest !== bindings.targetArtifactDigest) {
    transactionErrors.push("targetArtifactDigest binding is stale");
  }
  const withoutDigest = { ...transaction };
  delete withoutDigest.digest;
  if (transaction.digest !== hashCanonical(withoutDigest)) {
    transactionErrors.push("canonical digest is stale");
  }
  return transactionErrors;
}

function validateCompletedExternalPublicationTransaction(transaction, bindings) {
  if (!exactObjectKeys(transaction, externalPublicationTransactionKeys)
    || transaction.schemaVersion !== 1
    || transaction.kind !== "conversation-disclosure-external-publication-transaction"
    || transaction.status !== "prepared") {
    return ["must contain the exact prepared v1 external publication transaction schema"];
  }
  const transactionErrors = [];
  if (transaction.manifestPath !== bindings.manifestPath
    || transaction.attestationPath !== bindings.attestationPath
    || transaction.anchorOutputPath !== bindings.anchorOutputPath) {
    transactionErrors.push("output path bindings are stale");
  }
  if (canonicalJson(transaction.attestation) !== canonicalJson(bindings.attestation)
    || canonicalJson(transaction.finalManifest) !== canonicalJson(bindings.finalManifest)
    || canonicalJson(transaction.externalAnchor) !== canonicalJson(bindings.externalAnchor)) {
    transactionErrors.push("embedded output bindings are stale");
  }
  for (const [key, value] of [
    ["targetAttestationDigest", transaction.attestation],
    ["targetManifestDigest", transaction.finalManifest],
    ["targetAnchorDigest", transaction.externalAnchor],
  ]) {
    const expected = sha256Bytes(Buffer.from(`${canonicalJson(value)}\n`, "utf8"));
    if (transaction[key] !== expected) {
      transactionErrors.push(`${key} is stale`);
    }
  }
  if (!sha256Digest(transaction.originalManifestDigest)) {
    transactionErrors.push("originalManifestDigest is invalid");
  }
  const withoutDigest = { ...transaction };
  delete withoutDigest.digest;
  if (transaction.digest !== hashCanonical(withoutDigest)) {
    transactionErrors.push("canonical digest is stale");
  }
  return transactionErrors;
}

async function requireExternalAnchorJson(absolutePath, transactionBindings) {
  const label = "CD03 repository-external closure anchor";
  try {
    const requestedPath = path.resolve(absolutePath);
    const requestedEntry = await lstat(requestedPath);
    if (requestedEntry.isSymbolicLink() || !requestedEntry.isFile()
      || requestedEntry.nlink !== 1) {
      errors.push(`${label} must be a unique regular non-symlink file`);
      return undefined;
    }
    const canonicalParent = await realpath(path.dirname(requestedPath));
    const canonicalPath = path.join(canonicalParent, path.basename(requestedPath));
    if (canonicalPath === canonicalRoot
      || canonicalPath.startsWith(`${canonicalRoot}${path.sep}`)) {
      errors.push(`${label} must stay outside the candidate repository`);
      return undefined;
    }
    for (const transactionPath of [
      `${canonicalPath}.publication-transaction.json`,
      `${canonicalPath}.publication-transaction.json.remove.tombstone`,
    ]) {
      try {
        await lstat(transactionPath);
        errors.push(
          "CD03 external publication transaction must be recovered and removed before closure validation",
        );
        return undefined;
      } catch (error) {
        if (error?.code !== "ENOENT") {
          errors.push("CD03 external publication transaction could not be inspected safely");
          return undefined;
        }
      }
    }
    const bytes = await readFrozenAbsoluteFile(canonicalPath, label);
    if (!bytes) return undefined;
    const externalAnchor = JSON.parse(bytes.toString("utf8"));
    await validateCompletedMarkerFiles({
      directoryPath: path.dirname(canonicalPath),
      markerBase: `${path.basename(canonicalPath)}.publication-transaction.json.remove.tombstone`,
      label: "CD03 external publication transaction",
      readCapture: async (markerName) => readFrozenAbsoluteFile(
        path.join(path.dirname(canonicalPath), markerName),
        "CD03 external publication transaction completed marker",
        true,
      ),
      validateTransaction: (transaction) =>
        validateCompletedExternalPublicationTransaction(transaction, {
          ...transactionBindings,
          anchorOutputPath: canonicalPath,
          externalAnchor,
        }),
    });
    return externalAnchor;
  } catch {
    errors.push(`${label} must contain valid frozen JSON: ${absolutePath}`);
    return undefined;
  }
}

async function validateAcceptanceManifest() {
  await requireFile(manifest.acceptanceManifest, "acceptanceManifest");
  const acceptance = await requireJson(
    manifest.acceptanceManifest,
    "acceptanceManifest",
  );
  if (!acceptance) return;
  if (acceptance.schemaVersion !== 1) {
    errors.push("acceptanceManifest schemaVersion must be 1");
  }
  if (acceptance.programId !== manifest.programId) {
    errors.push("acceptanceManifest programId must match the disclosure program");
  }
  if (
    acceptance.app?.version !== "3.9.2"
    || !/^[0-9a-f]{7,40}$/.test(acceptance.app?.buildCommit ?? "")
    || !/^sha256:[0-9a-f]{64}$/.test(acceptance.app?.sourceTreeDigest ?? "")
    || acceptance.app?.platform !== "darwin-arm64"
  ) {
    errors.push("acceptanceManifest app must identify the v3.9.2 darwin-arm64 build commit and source tree digest");
  }
  if (acceptance.runner?.kind !== "browser"
    || !nonEmpty(acceptance.runner?.name)
    || !nonEmpty(acceptance.runner?.version)) {
    errors.push("acceptanceManifest runner must identify the browser automation runtime");
  }
  await validatePassedEvidenceGroup(
    acceptance.app,
    "acceptanceManifest.app",
    "identityEvidenceRefs",
  );
  await validateBuildIdentity(acceptance.app);
  await validatePassedEvidenceGroup(
    acceptance.secretScan,
    "acceptanceManifest.secretScan",
  );
  await validatePassedEvidenceGroup(
    acceptance.independentReview,
    "acceptanceManifest.independentReview",
  );

  if (!Array.isArray(acceptance.scenarioResults)) {
    errors.push("acceptanceManifest scenarioResults must be an array");
    return;
  }
  const resultMap = new Map();
  const evidenceOwners = new Map();
  for (const [index, result] of acceptance.scenarioResults.entries()) {
    const subject = `acceptanceManifest.scenarioResults[${index}]`;
    if (!nonEmpty(result.scenarioId)) {
      errors.push(`${subject}.scenarioId is required`);
      continue;
    }
    if (resultMap.has(result.scenarioId)) {
      errors.push(`acceptanceManifest has duplicate scenario result ${result.scenarioId}`);
      continue;
    }
    resultMap.set(result.scenarioId, result);
    if (stringArray(result.evidenceRefs)) {
      for (const evidenceRef of new Set(result.evidenceRefs)) {
        const owners = evidenceOwners.get(evidenceRef) ?? new Set();
        owners.add(result.scenarioId);
        evidenceOwners.set(evidenceRef, owners);
      }
    }
  }
  for (const resultId of resultMap.keys()) {
    if (!scenarios.has(resultId)) {
      errors.push(`acceptanceManifest contains unknown scenario result ${resultId}`);
    }
  }
  for (const scenario of scenarios.values()) {
    const result = resultMap.get(scenario.id);
    const subject = `acceptance scenario ${scenario.id}`;
    if (!result) {
      errors.push(`${subject} is missing from acceptanceManifest`);
      continue;
    }
    if (result.executor !== scenario.executor) {
      errors.push(`${subject} executor must match the frozen scenario`);
    }
    if (result.fixture !== scenario.fixture) {
      errors.push(`${subject} fixture must match the frozen scenario`);
    }
    if (result.status !== "passed") {
      errors.push(`${subject} status must be passed`);
    }
    if (!stringArray(result.evidenceRefs)) {
      errors.push(`${subject} evidenceRefs must contain artifact paths`);
    } else {
      if (!sameStringSet(result.evidenceRefs, scenario.acceptanceEvidence)) {
        errors.push(`${subject} evidenceRefs must match scenario acceptanceEvidence`);
      }
      for (const evidenceRef of result.evidenceRefs) {
        await requireFile(evidenceRef, `${subject} evidenceRefs`);
      }
      if (!result.evidenceRefs.some(
        (evidenceRef) => evidenceOwners.get(evidenceRef)?.size === 1,
      )) {
        errors.push(`${subject} must include at least one scenario-specific evidence ref`);
      }
    }
    if (!Array.isArray(result.requirementResults)) {
      errors.push(`${subject} requirementResults must be an array`);
      continue;
    }
    const requirementMap = new Map();
    for (const requirementResult of result.requirementResults) {
      if (!nonEmpty(requirementResult.requirement)) continue;
      if (requirementMap.has(requirementResult.requirement)) {
        errors.push(`${subject} has duplicate requirement result ${requirementResult.requirement}`);
      }
      requirementMap.set(requirementResult.requirement, requirementResult);
    }
    for (const requirement of scenario.evidenceRequirements) {
      const requirementResult = requirementMap.get(requirement);
      if (!requirementResult) {
        errors.push(`${subject} is missing requirement result ${requirement}`);
        continue;
      }
      if (requirementResult.status !== "passed") {
        errors.push(`${subject} requirement must pass: ${requirement}`);
      }
      if (!stringArray(requirementResult.evidenceRefs)) {
        errors.push(`${subject} requirement needs evidence refs: ${requirement}`);
      } else {
        for (const evidenceRef of requirementResult.evidenceRefs) {
          if (!result.evidenceRefs.includes(evidenceRef)) {
            errors.push(`${subject} requirement evidence must belong to the scenario result`);
          }
          await requireFile(evidenceRef, `${subject} requirement evidenceRefs`);
        }
      }
    }
    for (const requirement of requirementMap.keys()) {
      if (!scenario.evidenceRequirements.includes(requirement)) {
        errors.push(`${subject} contains unknown requirement result ${requirement}`);
      }
    }
  }
}

async function validateBuildIdentity(app) {
  if (!nonEmpty(app?.identityManifest)
    || !(app.identityEvidenceRefs ?? []).includes(app.identityManifest)) {
    errors.push("acceptanceManifest.app identityManifest must be included in identityEvidenceRefs");
    return;
  }
  await requireFile(app.identityManifest, "acceptanceManifest.app.identityManifest");
  const identity = await requireJson(
    app.identityManifest,
    "acceptanceManifest.app.identityManifest",
  );
  if (!identity) return;
  if (
    identity.schemaVersion !== 1
    || identity.version !== app.version
    || identity.buildCommit !== app.buildCommit
    || identity.sourceTreeDigest !== app.sourceTreeDigest
    || identity.platform !== app.platform
    || identity.signatureStatus !== "passed"
    || identity.launchStatus !== "passed"
    || !/^[0-9a-f]{64}$/.test(identity.packageSha256 ?? "")
  ) {
    errors.push("acceptanceManifest app identityManifest must match the signed launched package identity");
  }
}

async function validateReviewedShadowCompletion(workstream, feature) {
  const subject = "CD03 completionContract";
  const contract = workstream?.completionContract;
  if (!contract) {
    errors.push(`${subject} is required`);
    return;
  }
  const validContract = contract.schemaVersion === 1
    && contract.kind === "reviewed_shadow"
    && repositoryPath(contract.primaryArtifact)
    && Number.isInteger(contract.minimumIndependentPasses)
    && contract.minimumIndependentPasses >= 3
    && stringArray(contract.requiredReviewLanes)
    && stringArray(contract.requiredCharacterizationIds)
    && contract.requiredSafety
    && typeof contract.requiredSafety === "object"
    && stringArray(contract.requiredVerificationIds)
    && stringArray(contract.requiredExecutableClosurePaths)
    && stringArray(contract.postReviewMutablePaths);
  if (!validContract) {
    errors.push(`${subject} is invalid`);
    return;
  }
  if (!(workstream.completionArtifacts ?? []).includes(contract.primaryArtifact)) {
    errors.push(`${subject}.primaryArtifact must be a CD03 completion artifact`);
  }
  if (contract.primaryArtifact !== canonicalCd03Artifact) {
    errors.push(`${subject}.primaryArtifact must remain ${canonicalCd03Artifact}`);
  }
  if (!sameStringSet(requiredCd03ReviewLanes, contract.requiredReviewLanes)) {
    errors.push(`${subject}.requiredReviewLanes must cover contract runtime governance`);
  }
  if (
    !sameStringSet(
      requiredCd03CharacterizationIds,
      contract.requiredCharacterizationIds,
    )
  ) {
    errors.push(`${subject}.requiredCharacterizationIds must preserve C01-C13`);
  }
  if (!sameStringSet(requiredCd03VerificationIds, contract.requiredVerificationIds)) {
    errors.push(`${subject}.requiredVerificationIds must preserve all closure gates`);
  }
  if (
    !sameStringSet(
      requiredCd03ExecutableClosurePaths,
      contract.requiredExecutableClosurePaths,
    )
  ) {
    errors.push(`${subject}.requiredExecutableClosurePaths must freeze the executable harness chain`);
  }
  const requiredMutablePaths = [
    contract.primaryArtifact,
    ".zerox/conversation-disclosure-program.json",
    ".zerox/feature_list.json",
    ".zerox/progress.md",
    "task_plan.md",
    "findings.md",
    "progress.md",
  ];
  const governanceMutablePaths = contract.postReviewMutablePaths.filter(
    (relativePath) => !requiredMutablePaths.includes(relativePath),
  );
  const governancePathPattern =
    /^\.zerox\/verification\/conversation-disclosure\/CD03-round([1-9][0-9]*)-(review-snapshot|closure-manifest|contract-review|runtime-review|governance-review|external-attestation)\.json$/;
  const governanceMatches = governanceMutablePaths.map(
    (relativePath) => relativePath.match(governancePathPattern),
  );
  const governanceKinds = governanceMatches.map((match) => match?.[2]);
  const governanceRounds = new Set(governanceMatches.map((match) => match?.[1]));
  const requiredGovernanceKinds = [
    "review-snapshot",
    "closure-manifest",
    "contract-review",
    "runtime-review",
    "governance-review",
  ];
  if (!requiredMutablePaths.every(
    (relativePath) => contract.postReviewMutablePaths.includes(relativePath),
  )
    || new Set(contract.postReviewMutablePaths).size
      !== contract.postReviewMutablePaths.length
    || governanceMatches.some((match) => !match)
    || governanceRounds.size !== 1
    || !requiredGovernanceKinds.every((kind) => governanceKinds.includes(kind))
    || governanceKinds.some(
      (kind, index) => governanceKinds.indexOf(kind) !== index,
    )
    || governanceKinds.length > requiredGovernanceKinds.length + 1) {
    errors.push(`${subject}.postReviewMutablePaths may contain governance and progress files only`);
  }
  if (new Set(contract.requiredReviewLanes).size !== contract.requiredReviewLanes.length) {
    errors.push(`${subject}.requiredReviewLanes must be unique`);
  }
  if (
    new Set(contract.requiredCharacterizationIds).size
    !== contract.requiredCharacterizationIds.length
  ) {
    errors.push(`${subject}.requiredCharacterizationIds must be unique`);
  }
  if (
    Object.values(contract.requiredSafety).some(
      (value) => typeof value !== "boolean",
    )
  ) {
    errors.push(`${subject}.requiredSafety values must be boolean`);
  }
  for (const executablePath of contract.requiredExecutableClosurePaths) {
    if (contract.postReviewMutablePaths.includes(executablePath)) {
      errors.push(`${subject} executable closure must not be post-review mutable: ${executablePath}`);
    }
  }
  const validatesPendingExternalCandidate = closureOptions.closure;
  if (workstream.state !== "completed" && !validatesPendingExternalCandidate) return;
  const requiredFeatureStatus = validatesPendingExternalCandidate
    ? "in_progress"
    : "done";
  if (!feature || feature.status !== requiredFeatureStatus || !stringArray(feature.files)) {
    errors.push(
      validatesPendingExternalCandidate
        ? "CD03 closure mode requires an in_progress P107 Feature with a frozen file allowlist"
        : "completed CD03 requires a done P107 Feature with a frozen file allowlist",
    );
    return;
  }
  for (const executablePath of contract.requiredExecutableClosurePaths) {
    if (!feature.files.includes(executablePath)) {
      errors.push(`completed CD03 Feature must include executable closure path ${executablePath}`);
    }
  }

  const artifact = await requireJson(contract.primaryArtifact, "CD03 primaryArtifact");
  if (!artifact) return;
  if (
    artifact.schemaVersion !== 1
    || artifact.artifactId !== "CD03-causal-shadow"
    || artifact.programId !== manifest.programId
    || artifact.featureId !== workstream.featureId
  ) {
    errors.push("CD03 primaryArtifact identity does not match the program and Feature");
  }
  const requiredArtifactStatus = validatesPendingExternalCandidate
    ? "review_pending"
    : "accepted";
  if (artifact.status !== requiredArtifactStatus) {
    errors.push(
      validatesPendingExternalCandidate
        ? "CD03 closure mode primaryArtifact status must remain review_pending"
        : "completed CD03 primaryArtifact status must be accepted",
    );
  }

  const characterizationMap = new Map();
  for (const characterization of artifact.characterizations ?? []) {
    if (!nonEmpty(characterization?.id)) continue;
    if (characterizationMap.has(characterization.id)) {
      errors.push(`CD03 primaryArtifact has duplicate characterization ${characterization.id}`);
    }
    characterizationMap.set(characterization.id, characterization);
  }
  for (const id of contract.requiredCharacterizationIds) {
    const characterization = characterizationMap.get(id);
    if (
      characterization?.result !== "passed"
      || !nonEmpty(characterization?.evidence)
    ) {
      errors.push(`CD03 characterization ${id} must pass with evidence`);
    }
  }
  for (const [key, expected] of Object.entries(contract.requiredSafety)) {
    if (artifact.safety?.[key] !== expected) {
      errors.push(`CD03 safety ${key} must equal ${expected}`);
    }
  }
  if (
    !artifact.safety
    || typeof artifact.safety !== "object"
    || !sameStringSet(
      Object.keys(contract.requiredSafety),
      Object.keys(artifact.safety),
    )
  ) {
    errors.push("CD03 primaryArtifact safety keys must exactly match the completion contract");
  }
  if (
    Object.values(artifact.safety ?? {}).some(
      (value) => typeof value !== "boolean",
    )
  ) {
    errors.push("CD03 primaryArtifact safety values must be boolean");
  }

  const verificationMap = new Map();
  for (const verification of artifact.verification ?? []) {
    if (!nonEmpty(verification?.id)) continue;
    if (verificationMap.has(verification.id)) {
      errors.push(`CD03 primaryArtifact has duplicate verification ${verification.id}`);
    }
    verificationMap.set(verification.id, verification);
  }
  for (const id of contract.requiredVerificationIds) {
    const verification = verificationMap.get(id);
    if (verification?.result !== "passed" || !nonEmpty(verification?.command)) {
      errors.push(`CD03 verification ${id} must pass with a command`);
    }
  }

  const snapshot = artifact.reviewSnapshot;
  const snapshotErrors = validateReviewSnapshot(snapshot);
  if (snapshotErrors.length > 0) {
    errors.push(...snapshotErrors.map((error) => `CD03 ${error}`));
    return;
  }
  if (
    snapshot.programId !== manifest.programId
    || snapshot.workstreamId !== workstream.id
    || snapshot.featureId !== feature.id
  ) {
    errors.push("CD03 reviewSnapshot identity must match program/workstream/Feature");
  }
  const expectedImmutablePaths = feature.files
    .filter((filePath) => !contract.postReviewMutablePaths.includes(filePath))
    .slice()
    .sort();
  const snapshotPaths = snapshot.files.map((entry) => entry?.path);
  if (
    new Set(feature.files).size !== feature.files.length
    || !sameOrderedStrings(snapshotPaths, expectedImmutablePaths)
  ) {
    errors.push("CD03 reviewSnapshot files must exactly match the immutable P107 allowlist");
  }
  for (const entry of snapshot.files) {
    const entryKeys = entry && typeof entry === "object"
      ? Object.keys(entry).sort()
      : [];
    if (!sameOrderedStrings(entryKeys, ["path", "sha256"])) {
      errors.push("CD03 reviewSnapshot file entries must contain exactly path and sha256");
      continue;
    }
    if (!repositoryPath(entry.path) || !sha256Digest(entry.sha256)) {
      errors.push("CD03 reviewSnapshot contains an invalid file entry");
      continue;
    }
    try {
      const bytes = await readFrozenRegularFile(
        entry.path,
        `CD03 reviewSnapshot file ${entry.path}`,
      );
      if (!bytes) continue;
      if (`sha256:${createHash("sha256").update(bytes).digest("hex")}` !== entry.sha256) {
        errors.push(`CD03 reviewSnapshot hash drift: ${entry.path}`);
      }
    } catch {
      // requireFile already records the path failure.
    }
  }
  const claims = {
    implementationBoundary: artifact.implementationBoundary,
    sources: artifact.sources,
    characterizations: artifact.characterizations,
    verification: artifact.verification,
    safety: artifact.safety,
    rollback: artifact.rollback,
  };
  if (snapshot.completionContractDigest !== hashCanonical(contract)) {
    errors.push("CD03 reviewSnapshot completionContractDigest is stale");
  }
  if (snapshot.safetyContractDigest !== hashCanonical(contract.requiredSafety)) {
    errors.push("CD03 reviewSnapshot safetyContractDigest is stale");
  }
  if (snapshot.featureFileSetDigest !== hashCanonical(feature.files)) {
    errors.push("CD03 reviewSnapshot featureFileSetDigest is stale");
  }
  if (snapshot.claimsDigest !== hashCanonical(claims)) {
    errors.push("CD03 reviewSnapshot claimsDigest is stale");
  }
  const snapshotWithoutDigest = { ...snapshot };
  delete snapshotWithoutDigest.digest;
  if (snapshot.digest !== hashReviewCanonical(snapshotWithoutDigest)) {
    errors.push("CD03 reviewSnapshot digest is stale");
  }

  const review = artifact.independentReview;
  const reviewKeys = review && typeof review === "object" && !Array.isArray(review)
    ? Object.keys(review).sort()
    : [];
  if (
    !sameOrderedStrings(
      reviewKeys,
      ["closureManifestPath", "history", "round", "status"],
    )
    || !Array.isArray(review.history)
  ) {
    errors.push("CD03 independentReview must contain the exact external-review keys");
    return;
  }
  const requiredReviewStatus = validatesPendingExternalCandidate
    ? "passed_pending_external_attestation"
    : "passed";
  if (
    review?.status !== requiredReviewStatus
    || review.round !== snapshot.round
    || !repositoryPath(review.closureManifestPath)
  ) {
    errors.push(
      validatesPendingExternalCandidate
        ? "CD03 closure mode requires one pending external-attestation manifest reference"
        : "completed CD03 requires one current externally attested closure manifest reference",
    );
    return;
  }
  const closureManifest = await requireFrozenJson(
    review.closureManifestPath,
    "CD03 external closure manifest",
    !validatesPendingExternalCandidate,
  );
  if (!closureManifest) return;
  errors.push(...validateClosureManifest(closureManifest, snapshot)
    .map((error) => `CD03 ${error}`));
  const requiredClosureStatus = validatesPendingExternalCandidate
    ? CLOSURE_STATUS_PENDING
    : CLOSURE_STATUS_ATTESTED;
  if (closureManifest.status !== requiredClosureStatus) {
    errors.push(
      validatesPendingExternalCandidate
        ? "CD03 closure mode requires a pending external-attestation manifest"
        : "completed CD03 requires an externally_attested closure manifest",
    );
  }
  const externalSnapshot = await requireFrozenJson(
    closureManifest.snapshot?.path,
    "CD03 external review snapshot",
  );
  if (!externalSnapshot) return;
  errors.push(...validateReviewSnapshot(externalSnapshot)
    .map((error) => `CD03 external ${error}`));
  if (
    externalSnapshot.digest !== snapshot.digest
    || hashReviewCanonical(externalSnapshot)
      !== hashReviewCanonical(snapshot)
  ) {
    errors.push("CD03 external review snapshot must exactly match the accepted artifact snapshot");
  }
  const externalSnapshotBytes = await readFrozenRegularFile(
    closureManifest.snapshot?.path,
    "CD03 external review snapshot transaction binding",
  );
  await requireGovernanceTransactionSettled(
    `${closureManifest.snapshot?.path}.freeze-transaction.json`,
    "CD03 review freeze transaction",
    (transaction) => validateCompletedFreezeTransaction(transaction, {
      round: snapshot.round,
      snapshotPath: closureManifest.snapshot?.path,
      artifactPath: contract.primaryArtifact,
      targetSnapshotDigest: externalSnapshotBytes
        ? sha256Bytes(externalSnapshotBytes)
        : undefined,
    }),
  );
  const receipts = [];
  const closureReceiptEntries = Array.isArray(closureManifest.reviewReceipts)
    ? closureManifest.reviewReceipts
    : [];
  for (const entry of closureReceiptEntries) {
    const receipt = await requireFrozenJson(
      entry?.path,
      `CD03 ${entry?.lane ?? "unknown"} review receipt`,
    );
    if (!receipt) continue;
    receipts.push(receipt);
    if (hashReviewCanonical(receipt) !== entry.canonicalDigest) {
      errors.push(`CD03 ${entry?.lane ?? "unknown"} review receipt digest is stale`);
    }
  }
  errors.push(...validateReviewSet(receipts, snapshot)
    .map((error) => `CD03 ${error}`));
  if (receipts.length < contract.minimumIndependentPasses) {
    errors.push("completed CD03 requires the minimum current independent PASS receipts");
  }
  const runnerSnapshotEntries = snapshot.files.filter(
    (entry) => entry.path === closureManifest.externalRunner?.path,
  );
  if (runnerSnapshotEntries.length !== 1
    || runnerSnapshotEntries[0]?.sha256 !== closureManifest.externalRunner?.sha256) {
    errors.push("CD03 external closure runner must be exactly frozen by the review snapshot");
  }
  const runnerBytes = await readFrozenRegularFile(
    closureManifest.externalRunner?.path,
    "CD03 external closure runner",
  );
  const runnerDigest = runnerBytes
    ? `sha256:${createHash("sha256").update(runnerBytes).digest("hex")}`
    : undefined;
  if (runnerDigest && runnerDigest !== closureManifest.externalRunner?.sha256) {
    errors.push("CD03 external closure runner digest is stale");
  }

  if (validatesPendingExternalCandidate) {
    if (!contract.postReviewMutablePaths.includes(
      closureManifest.externalAttestation?.path,
    )) {
      errors.push("CD03 pending external attestation path must be declared post-review mutable");
    }
    return snapshot.digest;
  }

  if (!contract.postReviewMutablePaths.includes(
    closureManifest.externalAttestation?.path,
  )) {
    errors.push("completed CD03 external attestation path must be declared post-review mutable");
    return snapshot.digest;
  }
  const externalAttestation = await requireFrozenJson(
    closureManifest.externalAttestation?.path,
    "CD03 external closure attestation",
    true,
  );
  if (!externalAttestation) return snapshot.digest;
  errors.push(...validateExternalAttestation(externalAttestation, {
    manifest: closureManifest,
    snapshot,
    receipts,
    repositoryRealpath: canonicalRoot,
    runnerDigest,
  }).map((error) => `CD03 ${error}`));
  if (!closureOptions.externalAnchorPath
    || !closureOptions.expectedExternalAnchorDigest) {
    errors.push(
      "completed CD03 requires an explicit repository-external closure anchor",
    );
    return snapshot.digest;
  }
  const externalAnchor = await requireExternalAnchorJson(
    closureOptions.externalAnchorPath,
    {
      manifestPath: review.closureManifestPath,
      attestationPath: closureManifest.externalAttestation?.path,
      finalManifest: closureManifest,
      attestation: externalAttestation,
    },
  );
  if (!externalAnchor) return snapshot.digest;
  if (externalAnchor.digest !== closureOptions.expectedExternalAnchorDigest) {
    errors.push("CD03 external anchor digest does not match the caller-pinned digest");
  }
  errors.push(...validateExternalAnchor(externalAnchor, {
    attestation: externalAttestation,
    snapshot,
    receipts,
    repositoryRealpath: canonicalRoot,
    runnerDigest,
  }).map((error) => `CD03 ${error}`));
  return snapshot.digest;
}

function parseClosureOptions(args) {
  let closure = false;
  let expectedSnapshotDigest;
  let externalAnchorPath;
  let expectedExternalAnchorDigest;
  const optionErrors = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--closure") {
      if (closure) optionErrors.push("CD03 closure mode may be specified only once");
      closure = true;
      continue;
    }
    if (argument === "--expected-snapshot-digest") {
      if (expectedSnapshotDigest !== undefined) {
        optionErrors.push("CD03 expected snapshot digest may be specified only once");
      }
      expectedSnapshotDigest = args[index + 1];
      index += 1;
      continue;
    }
    if (argument.startsWith("--expected-snapshot-digest=")) {
      if (expectedSnapshotDigest !== undefined) {
        optionErrors.push("CD03 expected snapshot digest may be specified only once");
      }
      expectedSnapshotDigest = argument.slice("--expected-snapshot-digest=".length);
      continue;
    }
    if (argument === "--external-anchor") {
      if (externalAnchorPath !== undefined) {
        optionErrors.push("CD03 external anchor may be specified only once");
      }
      externalAnchorPath = args[index + 1];
      index += 1;
      continue;
    }
    if (argument.startsWith("--external-anchor=")) {
      if (externalAnchorPath !== undefined) {
        optionErrors.push("CD03 external anchor may be specified only once");
      }
      externalAnchorPath = argument.slice("--external-anchor=".length);
      continue;
    }
    if (argument === "--expected-external-anchor-digest") {
      if (expectedExternalAnchorDigest !== undefined) {
        optionErrors.push("CD03 expected external anchor digest may be specified only once");
      }
      expectedExternalAnchorDigest = args[index + 1];
      index += 1;
      continue;
    }
    if (argument.startsWith("--expected-external-anchor-digest=")) {
      if (expectedExternalAnchorDigest !== undefined) {
        optionErrors.push("CD03 expected external anchor digest may be specified only once");
      }
      expectedExternalAnchorDigest = argument.slice(
        "--expected-external-anchor-digest=".length,
      );
      continue;
    }
    optionErrors.push(`unknown conversation disclosure checker option: ${argument}`);
  }
  if (expectedSnapshotDigest !== undefined && !closure) {
    optionErrors.push("CD03 expected snapshot digest requires --closure");
  }
  if (closure && !sha256Digest(expectedSnapshotDigest)) {
    optionErrors.push("CD03 closure mode requires --expected-snapshot-digest sha256:<64 hex>");
  }
  if (externalAnchorPath !== undefined && !path.isAbsolute(externalAnchorPath)) {
    optionErrors.push("CD03 external anchor path must be absolute");
  }
  if (expectedExternalAnchorDigest !== undefined
    && !sha256Digest(expectedExternalAnchorDigest)) {
    optionErrors.push("CD03 expected external anchor digest must be sha256:<64 hex>");
  }
  if ((externalAnchorPath === undefined)
    !== (expectedExternalAnchorDigest === undefined)) {
    optionErrors.push("CD03 external anchor path and expected digest must be supplied together");
  }
  if (closure && externalAnchorPath !== undefined) {
    optionErrors.push("CD03 pending closure mode must not accept a completion anchor");
  }
  return {
    closure,
    expectedSnapshotDigest,
    externalAnchorPath,
    expectedExternalAnchorDigest,
    errors: optionErrors,
  };
}

function sha256Digest(value) {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
}

function sha256Bytes(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function exactObjectKeys(value, expectedKeys) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && sameOrderedStrings(Object.keys(value).sort(), expectedKeys.slice().sort());
}

function hashCanonical(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sameOrderedStrings(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

async function validatePassedEvidenceGroup(group, subject, refsField = "evidenceRefs") {
  if (group?.status !== "passed") {
    errors.push(`${subject}.status must be passed`);
  }
  if (!stringArray(group?.[refsField])) {
    errors.push(`${subject}.${refsField} must contain artifact paths`);
    return;
  }
  for (const evidenceRef of group[refsField]) {
    await requireFile(evidenceRef, `${subject}.${refsField}`);
  }
}

async function readFrozenRegularFile(
  relativePath,
  label,
  requirePrivate = false,
  captureIdentity = false,
) {
  if (!repositoryPath(relativePath)) {
    errors.push(`${label} must be a repository-relative path`);
    return null;
  }
  const segments = relativePath.split(/[\\/]+/).filter(Boolean);
  let cursor = root;
  const parentIdentity = [];
  let pathStat;
  try {
    for (let index = 0; index < segments.length; index += 1) {
      cursor = path.join(cursor, segments[index]);
      const entry = await lstat(cursor);
      if (entry.isSymbolicLink()) {
        errors.push(`${label} must not contain symbolic links: ${relativePath}`);
        return null;
      }
      if (index < segments.length - 1 && !entry.isDirectory()) {
        errors.push(`${label} parent must be a directory: ${relativePath}`);
        return null;
      }
      if (index < segments.length - 1) {
        parentIdentity.push({ path: cursor, dev: entry.dev, ino: entry.ino });
      }
      if (index === segments.length - 1 && !entry.isFile()) {
        errors.push(`${label} must be a regular file: ${relativePath}`);
        return null;
      }
      if (index === segments.length - 1) {
        if (entry.nlink !== 1) {
          errors.push(`${label} must have exactly one hard link: ${relativePath}`);
          return null;
        }
        pathStat = entry;
      }
    }
    const handle = await open(
      path.resolve(root, relativePath),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const handleStat = await handle.stat();
      if (!handleStat.isFile() || handleStat.nlink !== 1) {
        errors.push(`${label} must be a regular file: ${relativePath}`);
        return null;
      }
      if (requirePrivate && (handleStat.uid !== process.geteuid()
        || (handleStat.mode & 0o777) !== 0o600)) {
        errors.push(`${label} must be owned by the effective user with mode 0600`);
        return null;
      }
      if (handleStat.dev !== pathStat.dev || handleStat.ino !== pathStat.ino) {
        errors.push(`${label} changed identity while opening: ${relativePath}`);
        return null;
      }
      const bytes = await handle.readFile();
      const afterStat = await handle.stat();
      if (afterStat.dev !== handleStat.dev || afterStat.ino !== handleStat.ino
        || afterStat.nlink !== 1 || afterStat.size !== bytes.length
        || afterStat.uid !== handleStat.uid
        || (afterStat.mode & 0o777) !== (handleStat.mode & 0o777)
        || (requirePrivate && (afterStat.uid !== process.geteuid()
          || (afterStat.mode & 0o777) !== 0o600))) {
        errors.push(`${label} changed identity while reading: ${relativePath}`);
        return null;
      }
      for (const expected of parentIdentity) {
        const entry = await lstat(expected.path);
        if (entry.isSymbolicLink() || !entry.isDirectory()
          || entry.dev !== expected.dev || entry.ino !== expected.ino) {
          errors.push(`${label} parent directory identity changed: ${relativePath}`);
          return null;
        }
      }
      const finalStat = await lstat(path.resolve(root, relativePath));
      if (finalStat.isSymbolicLink() || !finalStat.isFile()
        || finalStat.nlink !== 1 || finalStat.dev !== handleStat.dev
        || finalStat.ino !== handleStat.ino
        || (requirePrivate && (finalStat.uid !== process.geteuid()
          || (finalStat.mode & 0o777) !== 0o600))) {
        errors.push(`${label} changed path identity while reading: ${relativePath}`);
        return null;
      }
      return captureIdentity
        ? { bytes, dev: handleStat.dev, ino: handleStat.ino }
        : bytes;
    } finally {
      await handle.close();
    }
  } catch {
    errors.push(`${label} does not exist or changed identity: ${relativePath}`);
    return null;
  }
}

async function readFrozenAbsoluteFile(absolutePath, label, captureIdentity = false) {
  const parentPath = path.dirname(absolutePath);
  const parsed = path.parse(parentPath);
  const segments = parentPath.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let cursor = parsed.root;
  const parentIdentity = [];
  try {
    for (const segment of segments) {
      cursor = path.join(cursor, segment);
      const entry = await lstat(cursor);
      if (entry.isSymbolicLink() || !entry.isDirectory()) {
        errors.push(`${label} parent must be a real directory`);
        return null;
      }
      parentIdentity.push({ path: cursor, dev: entry.dev, ino: entry.ino });
    }
    const pathStat = await lstat(absolutePath);
    if (pathStat.isSymbolicLink() || !pathStat.isFile() || pathStat.nlink !== 1) {
      errors.push(`${label} must be a unique regular non-symlink file`);
      return null;
    }
    if (pathStat.uid !== process.geteuid() || (pathStat.mode & 0o777) !== 0o600) {
      errors.push(`${label} must be owned by the effective user with mode 0600`);
      return null;
    }
    const handle = await open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const handleStat = await handle.stat();
      if (!handleStat.isFile() || handleStat.nlink !== 1
        || handleStat.dev !== pathStat.dev || handleStat.ino !== pathStat.ino) {
        errors.push(`${label} changed identity while opening`);
        return null;
      }
      const bytes = await handle.readFile();
      const afterStat = await handle.stat();
      if (afterStat.dev !== handleStat.dev || afterStat.ino !== handleStat.ino
        || afterStat.nlink !== 1 || afterStat.size !== bytes.length
        || afterStat.uid !== handleStat.uid
        || (afterStat.mode & 0o777) !== (handleStat.mode & 0o777)
        || afterStat.uid !== process.geteuid()
        || (afterStat.mode & 0o777) !== 0o600) {
        errors.push(`${label} changed identity while reading`);
        return null;
      }
      for (const expected of parentIdentity) {
        const entry = await lstat(expected.path);
        if (entry.isSymbolicLink() || !entry.isDirectory()
          || entry.dev !== expected.dev || entry.ino !== expected.ino) {
          errors.push(`${label} parent directory identity changed`);
          return null;
        }
      }
      const finalStat = await lstat(absolutePath);
      if (finalStat.isSymbolicLink() || !finalStat.isFile()
        || finalStat.nlink !== 1 || finalStat.dev !== handleStat.dev
        || finalStat.ino !== handleStat.ino
        || finalStat.uid !== process.geteuid()
        || (finalStat.mode & 0o777) !== 0o600) {
        errors.push(`${label} changed path identity while reading`);
        return null;
      }
      return captureIdentity
        ? { bytes, dev: handleStat.dev, ino: handleStat.ino }
        : bytes;
    } finally {
      await handle.close();
    }
  } catch {
    errors.push(`${label} does not exist or changed identity`);
    return null;
  }
}

async function requireFile(relativePath, label) {
  if (!repositoryPath(relativePath)) {
    errors.push(`${label} must be a repository-relative path`);
    return;
  }
  const target = path.resolve(root, relativePath);
  try {
    const [targetStat, canonicalTarget, pathEntry] = await Promise.all([
      stat(target),
      realpath(target),
      lstat(target),
    ]);
    if (!targetStat.isFile() || !pathEntry.isFile() || pathEntry.isSymbolicLink()) {
      errors.push(`${label} must be a regular file: ${relativePath}`);
    }
    if (targetStat.nlink !== 1 || pathEntry.nlink !== 1) {
      errors.push(`${label} must have exactly one hard link: ${relativePath}`);
    }
    if (
      canonicalTarget !== canonicalRoot
      && !canonicalTarget.startsWith(`${canonicalRoot}${path.sep}`)
    ) {
      errors.push(`${label} must resolve inside the repository`);
    }
  } catch {
    errors.push(`${label} does not exist: ${relativePath}`);
  }
}

function repositoryPath(relativePath) {
  if (!nonEmpty(relativePath) || path.isAbsolute(relativePath)) return false;
  const target = path.resolve(root, relativePath);
  return target !== root && target.startsWith(`${root}${path.sep}`);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function stringArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every(nonEmpty);
}

function sameStringSet(left, right) {
  if (!Array.isArray(right)) return false;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return leftSet.size === rightSet.size
    && [...leftSet].every((value) => rightSet.has(value));
}

function detectCycles(nodes, targetErrors) {
  const visiting = new Set();
  const visited = new Set();

  function visit(id, chain) {
    if (visiting.has(id)) {
      targetErrors.push(`conversation disclosure dependency cycle: ${[...chain, id].join(" -> ")}`);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    const node = nodes.get(id);
    for (const dependency of node?.dependsOn ?? []) {
      if (nodes.has(dependency)) visit(dependency, [...chain, id]);
    }
    visiting.delete(id);
    visited.add(id);
  }

  for (const id of nodes.keys()) visit(id, []);
}

function dependsTransitively(fromId, targetId, nodes, visited = new Set()) {
  if (fromId === targetId) return true;
  if (visited.has(fromId)) return false;
  visited.add(fromId);
  const node = nodes.get(fromId);
  return (node?.dependsOn ?? []).some(
    (dependency) => dependency === targetId
      || dependsTransitively(dependency, targetId, nodes, visited),
  );
}
