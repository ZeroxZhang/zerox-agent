import { access, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const manifestPath = path.join(
  root,
  ".zerox",
  "runtime-convergence-program.json",
);
const featureListPath = path.join(root, ".zerox", "feature_list.json");

const [manifest, featureList] = await Promise.all([
  readJson(manifestPath),
  readJson(featureListPath),
]);
const errors = [];

if (manifest.schemaVersion !== 1) {
  errors.push("program schemaVersion must be 1");
}
if (manifest.status !== "active" && manifest.status !== "completed") {
  errors.push('program status must be "active" or "completed"');
}
if (manifest.maxActiveFeatures !== 1) {
  errors.push("maxActiveFeatures must remain 1");
}
if (!Array.isArray(manifest.workstreams) || manifest.workstreams.length === 0) {
  errors.push("program must declare workstreams");
}
if (!Array.isArray(featureList.features)) {
  errors.push("feature_list.json must declare features");
}

await requireFile(manifest.sourceReview, "sourceReview");
await requireFile(manifest.operatingGuide, "operatingGuide");

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
  if (!nonEmpty(workstream.rollback)) {
    errors.push(`${subject}.rollback is required`);
  }
  if (!Array.isArray(workstream.verification)
    || workstream.verification.length === 0) {
    errors.push(`${subject}.verification must not be empty`);
  }
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

detectCycles(workstreams, errors);

const inProgress = [...workstreams.values()].filter(
  (workstream) => workstream.state === "in_progress",
);
if (inProgress.length > manifest.maxActiveFeatures) {
  errors.push(
    `program has ${inProgress.length} in-progress workstreams; maximum is ${manifest.maxActiveFeatures}`,
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
      errors.push("idle active program cannot contain an in_progress workstream");
    }
    const next = [...workstreams.values()].find(
      (workstream) => workstream.featureId === manifest.nextFeatureId,
    );
    if (!next || next.state !== "planned") {
      errors.push("idle active program must point nextFeatureId at planned work");
    } else {
      const unfinishedDependency = (next.dependsOn ?? []).find(
        (dependency) => workstreams.get(dependency)?.state !== "completed",
      );
      if (unfinishedDependency) {
        errors.push(
          `next workstream ${next.id} is blocked by ${unfinishedDependency}`,
        );
      }
    }
  } else {
    if (!active || active.state !== "in_progress") {
      errors.push("activeFeatureId must map to an in_progress workstream");
    }
    if (manifest.nextFeatureId !== manifest.activeFeatureId) {
      errors.push("while work is active, nextFeatureId must equal activeFeatureId");
    }
  }
} else {
  if (manifest.activeFeatureId !== null) {
    errors.push("completed program must clear activeFeatureId");
  }
  if ([...workstreams.values()].some(
    (workstream) => workstream.state !== "completed",
  )) {
    errors.push("completed program cannot contain unfinished workstreams");
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
if (active && !openFeatures.some((feature) => feature.id === active.featureId)) {
  errors.push(`active feature ${active.featureId} is not unfinished`);
}

const coveredFindings = new Set(
  [...workstreams.values()].flatMap((workstream) => workstream.findings ?? []),
);
for (let index = 1; index <= 10; index += 1) {
  const finding = `F${index}`;
  if (!coveredFindings.has(finding)) {
    errors.push(`program does not cover review finding ${finding}`);
  }
}

if (errors.length > 0) {
  console.error("Runtime convergence program check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `Runtime convergence program check passed (${workstreams.size} workstreams, `
  + `${inProgress.length} active).`,
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
      targetErrors.push(`workstream dependency cycle: ${[...chain, id].join(" -> ")}`);
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
