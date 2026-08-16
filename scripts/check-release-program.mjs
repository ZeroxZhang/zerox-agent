import { access, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const manifest = JSON.parse(
  await readFile(path.join(root, ".zerox", "release-program.json"), "utf8"),
);
const featureList = JSON.parse(
  await readFile(path.join(root, ".zerox", "feature_list.json"), "utf8"),
);
const packageJson = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
);
const errors = [];

if (manifest.schemaVersion !== 1) {
  errors.push("release program schemaVersion must be 1");
}
if (manifest.version !== "3.9.1" || manifest.tag !== "v3.9.1") {
  errors.push("release program identity must be v3.9.1");
}
if (!["active", "completed"].includes(manifest.status)) {
  errors.push("release program status must be active or completed");
}
if (manifest.maxActiveFeatures !== 1) {
  errors.push("release program maxActiveFeatures must be 1");
}
if (
  !/^[a-f0-9]{40}$/.test(manifest.sourceBaseline?.commit ?? "") ||
  !/^\d+$/.test(manifest.sourceBaseline?.verifyRun ?? "")
) {
  errors.push("release program requires a verified source commit and run");
}

const expectedWorkstreams = ["R01", "R02", "R03", "R04", "R05"];
const workstreams = new Map(
  (manifest.workstreams ?? []).map((workstream) => [
    workstream.id,
    workstream,
  ]),
);
if (
  workstreams.size !== expectedWorkstreams.length ||
  expectedWorkstreams.some((id) => !workstreams.has(id))
) {
  errors.push("release program must declare exactly R01 through R05");
}

for (const workstream of workstreams.values()) {
  if (!["planned", "in_progress", "completed"].includes(workstream.state)) {
    errors.push(`${workstream.id} has invalid state ${workstream.state}`);
  }
  if (
    !Array.isArray(workstream.dependsOn) ||
    !Array.isArray(workstream.verification)
  ) {
    errors.push(`${workstream.id} requires dependency and verification arrays`);
  }
  for (const dependency of workstream.dependsOn ?? []) {
    if (!workstreams.has(dependency) || dependency >= workstream.id) {
      errors.push(`${workstream.id} has invalid dependency ${dependency}`);
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
const features = featureList.features ?? [];
const p97 = features.find(
  (feature) => feature.id === "P97-sqlite-domain-storage-convergence",
);
const p98 = features.find(
  (feature) => feature.id === "P98-v3.9.0-release",
);
const p102 = features.find(
  (feature) => feature.id === "P102-adaptive-context-orchestration",
);
const p103 = features.find(
  (feature) =>
    feature.id === "P103-v3.9.1-context-orchestration-hotfix-release",
);
const openFeatures = features.filter((feature) => feature.status !== "done");

if (p97?.status !== "done") {
  errors.push("P97 must be done before P98 release work");
}
if (p98?.status !== "done" || p102?.status !== "done") {
  errors.push("P98 and P102 must be done before v3.9.1 release work");
}
if (openFeatures.length > manifest.maxActiveFeatures) {
  errors.push("release program allows at most one unfinished Feature");
}

if (manifest.status === "active") {
  if (
    activeWorkstreams.length !== 1 ||
    activeWorkstreams[0]?.id !== manifest.activeWorkstreamId
  ) {
    errors.push("active release program requires one matching workstream");
  }
  if (
    manifest.activeFeatureId !==
      "P103-v3.9.1-context-orchestration-hotfix-release" ||
    p103?.status !== "in_progress" ||
    openFeatures.length !== 1 ||
    openFeatures[0]?.id !== p103.id
  ) {
    errors.push("P103 must be the only active release Feature");
  }
} else {
  if (
    activeWorkstreams.length !== 0 ||
    [...workstreams.values()].some(
      (workstream) => workstream.state !== "completed",
    )
  ) {
    errors.push("completed release program requires all workstreams complete");
  }
  if (
    manifest.activeFeatureId !== null ||
    manifest.activeWorkstreamId !== null ||
    p103?.status !== "done"
  ) {
    errors.push("completed release program must clear active ids and close P103");
  }
}

if (workstreams.get("R01")?.state === "completed") {
  if (packageJson.version !== manifest.version) {
    errors.push("completed R01 requires package version 3.9.1");
  }
  for (const relativePath of [
    ".github/release-notes/v3.9.1.md",
    "README.md",
  ]) {
    try {
      await access(path.join(root, relativePath));
    } catch {
      errors.push(`completed R01 is missing ${relativePath}`);
    }
  }
}

if (errors.length > 0) {
  console.error("Release program check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `Release program check passed (${workstreams.size} workstreams, ${activeWorkstreams.length} active, ${manifest.tag}).`,
);
