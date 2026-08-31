import { access, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const manifest = await readJson(".zerox/release-program.json");
const featureList = await readJson(".zerox/feature_list.json");
const packageJson = await readJson("package.json");
const conversationProgram = await readJson(
  ".zerox/conversation-disclosure-program.json",
);
const errors = [];

if (manifest.schemaVersion !== 1) {
  errors.push("release program schemaVersion must be 1");
}
if (![
  "v3.9.1-context-hotfix-release-2026-08",
  "v3.9.2-resilience-release-2026-08",
].includes(manifest.programId)) {
  errors.push("release program identity is unknown");
}
if (![
  ["3.9.1", "v3.9.1"],
  ["3.9.2", "v3.9.2"],
].some(([version, tag]) => manifest.version === version && manifest.tag === tag)) {
  errors.push("release program version and tag are inconsistent");
}
if (!["active", "completed"].includes(manifest.status)) {
  errors.push("release program status must be active or completed");
}
if (manifest.maxActiveFeatures !== 1) {
  errors.push("release program maxActiveFeatures must be 1");
}
if (!/^[a-f0-9]{40}$/.test(manifest.sourceBaseline?.commit ?? "")) {
  errors.push("release program requires an exact source commit");
}

const expectedWorkstreams = ["R01", "R02", "R03", "R04", "R05"];
const workstreamEntries = manifest.workstreams ?? [];
const workstreams = new Map(
  workstreamEntries.map((workstream) => [workstream.id, workstream]),
);
if (
  workstreams.size !== expectedWorkstreams.length
  || workstreamEntries.length !== expectedWorkstreams.length
  || expectedWorkstreams.some(
    (id, index) => workstreamEntries[index]?.id !== id,
  )
) {
  errors.push("release program must declare ordered R01 through R05");
}

for (const workstream of workstreams.values()) {
  if (!["planned", "in_progress", "completed"].includes(workstream.state)) {
    errors.push(`${workstream.id} has invalid state ${workstream.state}`);
  }
  if (
    !Array.isArray(workstream.dependsOn)
    || !Array.isArray(workstream.verification)
  ) {
    errors.push(`${workstream.id} requires dependency and verification arrays`);
  }
  for (const dependency of workstream.dependsOn ?? []) {
    if (!workstreams.has(dependency) || dependency >= workstream.id) {
      errors.push(`${workstream.id} has invalid dependency ${dependency}`);
    }
    if (
      workstream.state !== "planned"
      && workstreams.get(dependency)?.state !== "completed"
    ) {
      errors.push(`${workstream.id} started before ${dependency} completed`);
    }
  }
}

const activeWorkstreams = [...workstreams.values()].filter(
  (workstream) => workstream.state === "in_progress",
);
const features = featureList.features ?? [];
const feature = (id) => features.find((entry) => entry.id === id);
const p97 = feature("P97-sqlite-domain-storage-convergence");
const p98 = feature("P98-v3.9.0-release");
const p102 = feature("P102-adaptive-context-orchestration");
const p103 = feature("P103-v3.9.1-context-orchestration-hotfix-release");
const p113 = feature("P113-v3.9.2-disclosure-adversarial-acceptance");
const p114 = feature("P114-v3.9.2-resilience-release");
const openFeatures = features.filter((entry) => entry.status !== "done");

if (p97?.status !== "done" || p98?.status !== "done" || p102?.status !== "done") {
  errors.push("v3.9.x release predecessors P97, P98, and P102 must be done");
}
if (openFeatures.length > manifest.maxActiveFeatures) {
  errors.push("release program allows at most one unfinished Feature");
}

if (manifest.version === "3.9.1") {
  validateHistoricalV391();
} else if (manifest.version === "3.9.2") {
  await validateV392();
}

if (workstreams.get("R01")?.state === "completed") {
  for (const relativePath of [
    `.github/release-notes/v${manifest.version}.md`,
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

function validateHistoricalV391() {
  if (
    manifest.programId !== "v3.9.1-context-hotfix-release-2026-08"
    || manifest.status !== "completed"
    || manifest.activeFeatureId !== null
    || manifest.activeWorkstreamId !== null
    || activeWorkstreams.length !== 0
    || [...workstreams.values()].some(
      (workstream) => workstream.state !== "completed",
    )
    || p103?.status !== "done"
    || !/^\d+$/.test(manifest.sourceBaseline?.verifyRun ?? "")
  ) {
    errors.push("historical v3.9.1 release closure changed");
  }
  const governedV392Successor =
    packageJson.version === "3.9.2"
    && conversationProgram.programId
      === "conversation-progressive-disclosure-v3.9.2-2026-08"
    && ["active", "completed"].includes(conversationProgram.status)
    && ["in_progress", "done"].includes(p113?.status);
  if (packageJson.version !== "3.9.1" && !governedV392Successor) {
    errors.push("v3.9.1 history may only yield to the governed v3.9.2 successor");
  }
  if (
    openFeatures.length > 0
    && (
      openFeatures.length !== 1
      || openFeatures[0]?.id !== p113?.id
      || conversationProgram.activeFeatureId !== p113.id
    )
  ) {
    errors.push("historical release closure may only coexist with active P113");
  }
}

async function validateV392() {
  if (
    manifest.programId !== "v3.9.2-resilience-release-2026-08"
    || packageJson.version !== "3.9.2"
    || conversationProgram.status !== "completed"
    || conversationProgram.activeFeatureId !== null
    || conversationProgram.nextFeatureId !== null
    || conversationProgram.workstreams?.find(
      (workstream) => workstream.id === "CD09",
    )?.state !== "completed"
    || p113?.status !== "done"
  ) {
    errors.push("v3.9.2 release requires completed P113 disclosure acceptance");
  }
  let attestation;
  try {
    attestation = await readJson(
      ".zerox/verification/conversation-disclosure/CD09-release-attestation.json",
    );
  } catch {
    errors.push("v3.9.2 release attestation is missing");
  }
  if (
    attestation
    && (
      attestation.kind !== "v3.9.2-release-attestation"
      || attestation.version !== "3.9.2"
      || attestation.status !== "accepted"
      || attestation.acceptedGitHead !== manifest.sourceBaseline?.commit
      || attestation.digest !== manifest.sourceBaseline?.releaseAttestationDigest
    )
  ) {
    errors.push("v3.9.2 release source baseline is not attested");
  }
  if (
    workstreams.get("R02")?.state === "completed"
    && !/^sha256:[0-9a-f]{64}$/.test(
      manifest.sourceBaseline?.releaseAttestationDigest ?? "",
    )
  ) {
    errors.push("completed R02 requires the promoted acceptance attestation");
  }
  if (
    workstreams.get("R03")?.state === "completed"
    && !/^\d+$/.test(manifest.sourceBaseline?.verifyRun ?? "")
  ) {
    errors.push("completed R03 requires the remote verification run id");
  }
  if (manifest.status === "active") {
    if (
      activeWorkstreams.length !== 1
      || activeWorkstreams[0]?.id !== manifest.activeWorkstreamId
      || manifest.activeFeatureId !== p114?.id
      || p114?.status !== "in_progress"
      || openFeatures.length !== 1
      || openFeatures[0]?.id !== p114.id
    ) {
      errors.push("P114 must be the only active v3.9.2 release Feature");
    }
  } else if (
    activeWorkstreams.length !== 0
    || [...workstreams.values()].some(
      (workstream) => workstream.state !== "completed",
    )
    || manifest.activeFeatureId !== null
    || manifest.activeWorkstreamId !== null
    || p114?.status !== "done"
  ) {
    errors.push("completed v3.9.2 release program must close P114 and all gates");
  }
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}
