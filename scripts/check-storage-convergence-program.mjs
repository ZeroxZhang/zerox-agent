import { access, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const manifestPath = path.join(
  root,
  ".zerox",
  "storage-convergence-program.json",
);
const featureListPath = path.join(root, ".zerox", "feature_list.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const featureList = JSON.parse(await readFile(featureListPath, "utf8"));
const errors = [];

if (manifest.schemaVersion !== 1) {
  errors.push("storage convergence schemaVersion must be 1");
}
if (manifest.status !== "active" && manifest.status !== "completed") {
  errors.push("storage convergence status must be active or completed");
}
if (manifest.maxActiveFeatures !== 1) {
  errors.push("storage convergence maxActiveFeatures must be 1");
}

for (const relativePath of [
  manifest.operatingGuide,
  manifest.architectureDecision,
]) {
  if (typeof relativePath !== "string" || !relativePath) {
    errors.push("storage convergence artifact path is missing");
    continue;
  }
  try {
    await access(path.join(root, relativePath));
  } catch {
    errors.push(`storage convergence artifact is missing: ${relativePath}`);
  }
}

const expectedWorkstreams = Array.from(
  { length: 8 },
  (_, index) => `SC${String(index + 1).padStart(2, "0")}`,
);
const workstreams = new Map(
  (manifest.workstreams ?? []).map((workstream) => [
    workstream.id,
    workstream,
  ]),
);
if (
  expectedWorkstreams.some((id) => !workstreams.has(id)) ||
  workstreams.size !== expectedWorkstreams.length
) {
  errors.push("storage convergence must declare exactly SC01 through SC08");
}

for (const workstream of workstreams.values()) {
  if (!["planned", "in_progress", "completed"].includes(workstream.state)) {
    errors.push(`${workstream.id} has invalid state ${workstream.state}`);
  }
  if (!Array.isArray(workstream.dependsOn)) {
    errors.push(`${workstream.id} dependsOn must be an array`);
  }
  if (!workstream.rollback || !Array.isArray(workstream.verification)) {
    errors.push(`${workstream.id} requires rollback and verification`);
  }
  for (const dependency of workstream.dependsOn ?? []) {
    if (!workstreams.has(dependency)) {
      errors.push(`${workstream.id} depends on unknown ${dependency}`);
    }
    if (dependency >= workstream.id) {
      errors.push(`${workstream.id} dependency ${dependency} is not earlier`);
    }
  }
  if (workstream.state === "in_progress") {
    const unfinished = (workstream.dependsOn ?? []).find(
      (dependency) => workstreams.get(dependency)?.state !== "completed",
    );
    if (unfinished) {
      errors.push(`${workstream.id} started before ${unfinished} completed`);
    }
  }
}

const activeWorkstreams = [...workstreams.values()].filter(
  (workstream) => workstream.state === "in_progress",
);
if (manifest.status === "active") {
  if (activeWorkstreams.length !== 1) {
    errors.push("active storage convergence requires one in_progress workstream");
  }
  if (activeWorkstreams[0]?.id !== manifest.activeWorkstreamId) {
    errors.push("activeWorkstreamId must match the in_progress workstream");
  }
} else {
  if (activeWorkstreams.length !== 0) {
    errors.push("completed storage convergence cannot have active workstreams");
  }
  if (
    [...workstreams.values()].some(
      (workstream) => workstream.state !== "completed",
    )
  ) {
    errors.push("completed storage convergence requires all workstreams complete");
  }
  if (manifest.activeFeatureId !== null || manifest.activeWorkstreamId !== null) {
    errors.push("completed storage convergence must clear active ids");
  }
}

const expectedDomains = new Set([
  "goal",
  "execution_checkpoint",
  "memory",
  "workspace",
  "multi_agent_session",
  "learning_candidate",
  "eval_candidate",
  "promoted_eval_fixture",
]);
const domains = new Set(
  (manifest.domainAuthority ?? []).map((entry) => entry.domain),
);
for (const domain of expectedDomains) {
  if (!domains.has(domain)) {
    errors.push(`storage convergence is missing domain ${domain}`);
  }
}
for (const entry of manifest.domainAuthority ?? []) {
  if (entry.current !== "json" || entry.target !== "sqlite") {
    errors.push(`${entry.domain} must declare json to sqlite convergence`);
  }
  if (!workstreams.has(entry.workstream)) {
    errors.push(`${entry.domain} maps to unknown ${entry.workstream}`);
  }
}

const excludedDomains = new Set(
  (manifest.fileBackedExclusions ?? []).map((entry) => entry.domain),
);
for (const exclusion of [
  "model_settings_and_credentials",
  "tool_result_blobs",
  "workspace_run_ledger",
  "raw_history",
  "artifact_payloads",
]) {
  if (!excludedDomains.has(exclusion)) {
    errors.push(`storage convergence is missing exclusion ${exclusion}`);
  }
}

const features = featureList.features ?? [];
const openFeatures = features.filter((feature) => feature.status !== "done");
if (openFeatures.length > manifest.maxActiveFeatures) {
  errors.push(
    `feature_list has ${openFeatures.length} unfinished features; maximum is ${manifest.maxActiveFeatures}`,
  );
}
const activeFeature = features.find(
  (feature) => feature.id === manifest.activeFeatureId,
);
if (manifest.status === "active") {
  if (!activeFeature || activeFeature.status !== "in_progress") {
    errors.push("active P97 feature must be in_progress");
  }
  if (
    openFeatures.length !== 1 ||
    openFeatures[0]?.id !== manifest.activeFeatureId
  ) {
    errors.push("P97 must be the only unfinished Feature");
  }
} else {
  const p97 = features.find(
    (feature) => feature.id === "P97-sqlite-domain-storage-convergence",
  );
  if (p97?.status !== "done") {
    errors.push("completed storage convergence requires P97 done");
  }
}

if (errors.length > 0) {
  console.error("Storage convergence program check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `Storage convergence program check passed (${workstreams.size} workstreams, ${activeWorkstreams.length} active, ${domains.size} target domains).`,
);
