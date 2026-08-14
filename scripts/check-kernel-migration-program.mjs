import { access, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const manifestPath = path.join(
  root,
  ".zerox",
  "kernel-migration-program.json",
);
const featureListPath = path.join(root, ".zerox", "feature_list.json");
const [manifest, featureList] = await Promise.all([
  readJson(manifestPath),
  readJson(featureListPath),
]);
const errors = [];

if (manifest.schemaVersion !== 1) {
  errors.push("kernel migration schemaVersion must be 1");
}
if (manifest.status !== "active" && manifest.status !== "completed") {
  errors.push('kernel migration status must be "active" or "completed"');
}
if (manifest.maxActiveFeatures !== 1) {
  errors.push("kernel migration maxActiveFeatures must remain 1");
}
if (!Array.isArray(manifest.invariants) || manifest.invariants.length < 6) {
  errors.push("kernel migration must declare at least six invariants");
}
if (!Array.isArray(manifest.nonGoals) || manifest.nonGoals.length < 3) {
  errors.push("kernel migration must declare explicit nonGoals");
}
if (!Array.isArray(manifest.workstreams) || manifest.workstreams.length !== 9) {
  errors.push("kernel migration must declare exactly nine workstreams");
}
if (!Array.isArray(featureList.features)) {
  errors.push("feature_list.json must declare features");
}

await requireFile(manifest.sourceReview, "sourceReview");
await requireFile(manifest.operatingGuide, "operatingGuide");
await requireFile(manifest.architectureDecision, "architectureDecision");

const expectedWorkstreamIds = Array.from(
  { length: 9 },
  (_, index) => `KM${String(index + 1).padStart(2, "0")}`,
);
const workstreams = new Map();
const featureIds = new Set();
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
    errors.push(
      `duplicate workstream featureId ${JSON.stringify(workstream.featureId)}`,
    );
  } else {
    featureIds.add(workstream.featureId);
  }
  if (!["planned", "in_progress", "completed"].includes(workstream.state)) {
    errors.push(`${subject}.state is invalid`);
  }
  if (!Array.isArray(workstream.findings) || workstream.findings.length === 0) {
    errors.push(`${subject}.findings must not be empty`);
  }
  if (!Array.isArray(workstream.dependsOn)) {
    errors.push(`${subject}.dependsOn must be an array`);
  }
  if (typeof workstream.architectureDecisionRequired !== "boolean") {
    errors.push(`${subject}.architectureDecisionRequired must be boolean`);
  }
  if (!nonEmpty(workstream.rollback)) {
    errors.push(`${subject}.rollback is required`);
  }
  if (
    !Array.isArray(workstream.verification) ||
    workstream.verification.length === 0
  ) {
    errors.push(`${subject}.verification must not be empty`);
  }
}

if (
  JSON.stringify([...workstreams.keys()]) !==
  JSON.stringify(expectedWorkstreamIds)
) {
  errors.push(
    `kernel migration workstreams must be ordered ${expectedWorkstreamIds.join(", ")}`,
  );
}
if (manifest.migrationCompletionWorkstreamId !== "KM07") {
  errors.push("migrationCompletionWorkstreamId must remain KM07");
}
if (
  JSON.stringify(manifest.postMigrationGates) !==
  JSON.stringify(["KM08", "KM09"])
) {
  errors.push("postMigrationGates must remain KM08 then KM09");
}

for (const workstream of workstreams.values()) {
  for (const dependency of workstream.dependsOn ?? []) {
    if (!workstreams.has(dependency)) {
      errors.push(
        `${workstream.id} depends on unknown workstream ${JSON.stringify(dependency)}`,
      );
    }
  }
}
if (!workstreams.get("KM08")?.dependsOn?.includes("KM07")) {
  errors.push("KM08 must depend on migration completion KM07");
}
if (!workstreams.get("KM09")?.dependsOn?.includes("KM08")) {
  errors.push("KM09 must depend on post-migration review KM08");
}
detectCycles(workstreams, errors);

const inProgress = [...workstreams.values()].filter(
  (workstream) => workstream.state === "in_progress",
);
if (inProgress.length > manifest.maxActiveFeatures) {
  errors.push(
    `kernel migration has ${inProgress.length} in-progress workstreams; maximum is ${manifest.maxActiveFeatures}`,
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
      errors.push(
        "idle active kernel migration cannot contain an in_progress workstream",
      );
    }
    const next = [...workstreams.values()].find(
      (workstream) => workstream.featureId === manifest.nextFeatureId,
    );
    if (!next || next.state !== "planned") {
      errors.push(
        "idle active kernel migration must point nextFeatureId at planned work",
      );
    } else {
      const unfinishedDependency = (next.dependsOn ?? []).find(
        (dependency) => workstreams.get(dependency)?.state !== "completed",
      );
      if (unfinishedDependency) {
        errors.push(
          `next kernel migration workstream ${next.id} is blocked by ${unfinishedDependency}`,
        );
      }
    }
  } else {
    if (!active || active.state !== "in_progress") {
      errors.push(
        "kernel migration activeFeatureId must map to an in_progress workstream",
      );
    }
    if (manifest.nextFeatureId !== manifest.activeFeatureId) {
      errors.push(
        "while kernel migration work is active, nextFeatureId must equal activeFeatureId",
      );
    }
  }
} else {
  if (manifest.activeFeatureId !== null || manifest.nextFeatureId !== null) {
    errors.push(
      "completed kernel migration must clear activeFeatureId and nextFeatureId",
    );
  }
  if (
    [...workstreams.values()].some(
      (workstream) => workstream.state !== "completed",
    )
  ) {
    errors.push(
      "completed kernel migration cannot contain unfinished workstreams",
    );
  }
}

for (const workstream of workstreams.values()) {
  const unfinishedDependency = (workstream.dependsOn ?? []).find(
    (dependency) => workstreams.get(dependency)?.state !== "completed",
  );
  if (workstream.state === "in_progress" && unfinishedDependency) {
    errors.push(
      `${workstream.id} is in_progress before dependency ${unfinishedDependency} completed`,
    );
  }
}

const featureMap = new Map(
  (featureList.features ?? []).map((feature) => [feature.id, feature]),
);
for (const workstream of workstreams.values()) {
  const feature = featureMap.get(workstream.featureId);
  if (workstream.state === "in_progress") {
    if (!feature) {
      errors.push(
        `in_progress workstream ${workstream.id} is missing feature ${workstream.featureId}`,
      );
    } else if (feature.status !== "in_progress") {
      errors.push(
        `feature ${workstream.featureId} must be in_progress while ${workstream.id} is active`,
      );
    }
  }
  if (workstream.state === "completed" && feature?.status !== "done") {
    errors.push(
      `completed workstream ${workstream.id} requires done feature ${workstream.featureId}`,
    );
  }
  if (workstream.state === "planned" && feature?.status === "in_progress") {
    errors.push(
      `planned workstream ${workstream.id} cannot have an in_progress feature`,
    );
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
if (
  active &&
  (openFeatures.length !== 1 || openFeatures[0]?.id !== active.featureId)
) {
  errors.push(
    `active kernel migration feature ${active.featureId} must be the only unfinished Feature`,
  );
}

const expectedDeferrals = new Set([
  "context_event_compaction",
  "external_subagent_provider",
  "arbitrary_code_mode",
]);
const deferrals = new Map();
for (const [index, deferral] of (
  manifest.deferredCapabilities ?? []
).entries()) {
  const subject = `deferredCapabilities[${index}]`;
  if (!expectedDeferrals.has(deferral.id)) {
    errors.push(`${subject}.id is not an approved deferral`);
  }
  if (deferrals.has(deferral.id)) {
    errors.push(`duplicate deferred capability ${JSON.stringify(deferral.id)}`);
  }
  deferrals.set(deferral.id, deferral);
  if (!nonEmpty(deferral.status)) errors.push(`${subject}.status is required`);
  if (deferral.decisionGate !== "KM09") {
    errors.push(`${subject}.decisionGate must be KM09`);
  }
  for (const field of [
    "currentEvidence",
    "trigger",
    "prohibitedCurrentAction",
  ]) {
    if (!nonEmpty(deferral[field])) {
      errors.push(`${subject}.${field} is required`);
    }
  }
}
for (const id of expectedDeferrals) {
  if (!deferrals.has(id)) {
    errors.push(`missing deferred capability ${JSON.stringify(id)}`);
  }
}

const km09Completed = workstreams.get("KM09")?.state === "completed";
for (const deferral of deferrals.values()) {
  if (
    !km09Completed &&
    !String(deferral.status).startsWith("deferred_")
  ) {
    errors.push(
      `${deferral.id} cannot leave deferred status before KM09 completes`,
    );
  }
  if (
    km09Completed &&
    !["kept_deferred", "approved_for_independent_program"].includes(
      deferral.status,
    )
  ) {
    errors.push(
      `${deferral.id} needs an explicit KM09 decision before program closure`,
    );
  }
}

if (errors.length > 0) {
  console.error("Kernel migration program check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `Kernel migration program check passed (${workstreams.size} workstreams, `
  + `${inProgress.length} active, ${deferrals.size} deferred capabilities).`,
);

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function requireFile(relativePath, label) {
  if (!nonEmpty(relativePath)) {
    errors.push(`${label} must be a repository-relative path`);
    return;
  }
  const target = path.resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    errors.push(`${label} must stay inside the repository`);
    return;
  }
  try {
    await access(target);
  } catch {
    errors.push(`${label} does not exist: ${relativePath}`);
  }
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function detectCycles(nodes, targetErrors) {
  const visiting = new Set();
  const visited = new Set();

  function visit(id, chain) {
    if (visiting.has(id)) {
      targetErrors.push(
        `kernel migration dependency cycle: ${[...chain, id].join(" -> ")}`,
      );
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
