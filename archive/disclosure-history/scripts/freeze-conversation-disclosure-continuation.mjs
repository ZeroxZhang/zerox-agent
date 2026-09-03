import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  link,
  lstat,
  open,
  readFile,
  realpath,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import {
  BASE_EXTERNAL_ANCHOR_DIGEST,
  BASE_SNAPSHOT_DIGEST,
  CONTINUATION_ALGORITHM,
  CONTINUATION_FEATURE_ID,
  CONTINUATION_REVIEW_SNAPSHOT_KIND,
  CONTINUATION_ROUND,
  CONTINUATION_WORKSTREAM_ID,
  hashCanonical,
  validateContinuationPolicy,
  validateContinuationReviewSnapshot,
} from "./conversation-disclosure-continuation-contract.mjs";

const root = process.cwd();
const canonicalRoot = await realpath(root);
const programPath = ".zerox/conversation-disclosure-program.json";
const featureListPath = ".zerox/feature_list.json";
const policyPath =
  ".zerox/verification/conversation-disclosure/CD03A-successor-evolution-policy.json";
const snapshotPath =
  ".zerox/verification/conversation-disclosure/CD03A-round1-review-snapshot.json";
const excludedPaths = new Set([
  ".zerox/conversation-disclosure-program.json",
  ".zerox/feature_list.json",
  ".zerox/progress.md",
  ".zerox/verification/conversation-disclosure/CD03A-round1-review-snapshot.json",
  ".zerox/verification/conversation-disclosure/CD03A-round1-closure-manifest.json",
  ".zerox/verification/conversation-disclosure/CD03A-round1-contract-review.json",
  ".zerox/verification/conversation-disclosure/CD03A-round1-runtime-review.json",
  ".zerox/verification/conversation-disclosure/CD03A-round1-governance-review.json",
  ".zerox/verification/conversation-disclosure/CD03A-round1-external-attestation.json",
  "task_plan.md",
  "findings.md",
  "progress.md",
]);

const [program, featureList, policy] = await Promise.all([
  readJson(programPath, "conversation disclosure program"),
  readJson(featureListPath, "Feature list"),
  readJson(policyPath, "CD03A continuation policy"),
]);
const feature = featureList?.features?.find(
  (candidate) => candidate?.id === CONTINUATION_FEATURE_ID,
);
const admissionWorkstream = program?.workstreams?.find(
  (candidate) => candidate?.id === CONTINUATION_WORKSTREAM_ID,
);
const successorWorkstream = program?.workstreams?.find(
  (candidate) => candidate?.id === "CD04",
);
const errors = [];

if (program?.programId !== policy?.programId) {
  errors.push("program and continuation policy identities differ");
}
if (admissionWorkstream?.state !== "in_progress"
  || admissionWorkstream?.featureId !== CONTINUATION_FEATURE_ID
  || feature?.status !== "in_progress") {
  errors.push("CD03A freeze requires one active P107A Feature");
}
if (!Array.isArray(feature?.files) || feature.files.length === 0
  || new Set(feature.files).size !== feature.files.length) {
  errors.push("P107A Feature must contain one unique ordered file allowlist");
}
errors.push(...validateContinuationPolicy(policy, {
  expectedProgramId: program?.programId,
  workstream: successorWorkstream,
}).map((error) => `policy: ${error}`));

const immutablePaths = Array.isArray(feature?.files)
  ? feature.files.filter((relativePath) => !excludedPaths.has(relativePath)).slice().sort()
  : [];
const files = [];
for (const relativePath of immutablePaths) {
  const capture = await readStableRepositoryFile(relativePath, `P107A file ${relativePath}`);
  if (capture) files.push({ path: relativePath, sha256: capture.digest });
}

const snapshotWithoutDigest = {
  schemaVersion: 1,
  kind: CONTINUATION_REVIEW_SNAPSHOT_KIND,
  algorithm: CONTINUATION_ALGORITHM,
  programId: program?.programId,
  workstreamId: CONTINUATION_WORKSTREAM_ID,
  featureId: CONTINUATION_FEATURE_ID,
  round: CONTINUATION_ROUND,
  baseSnapshotDigest: BASE_SNAPSHOT_DIGEST,
  baseExternalAnchorDigest: BASE_EXTERNAL_ANCHOR_DIGEST,
  policyDigest: policy?.digest,
  featureFileSetDigest: hashCanonical(feature?.files),
  successorWorkstreamDefinitionDigest:
    policy?.successor?.workstreamDefinitionDigest,
  successorFeatureDefinitionDigest:
    policy?.successor?.featureDefinitionDigest,
  files,
};
const snapshot = {
  ...snapshotWithoutDigest,
  digest: hashCanonical(snapshotWithoutDigest),
};
errors.push(...validateContinuationReviewSnapshot(snapshot, policy)
  .map((error) => `snapshot: ${error}`));

if (errors.length > 0) fail(errors);

const bytes = Buffer.from(`${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
await publishPrivateFile(snapshotPath, bytes);
console.log(JSON.stringify({
  kind: "cd03a-freeze-receipt",
  status: "passed",
  repositoryRealpath: canonicalRoot,
  snapshotPath,
  snapshotDigest: snapshot.digest,
  fileCount: files.length,
  featureFileSetDigest: snapshot.featureFileSetDigest,
}));

async function readJson(relativePath, label) {
  const capture = await readStableRepositoryFile(relativePath, label);
  if (!capture) return null;
  try {
    return JSON.parse(capture.bytes.toString("utf8"));
  } catch {
    fail([`${label} must contain valid JSON`]);
  }
}

async function readStableRepositoryFile(relativePath, label) {
  if (!repositoryPath(relativePath)) {
    errors.push(`${label} must use a normalized repository-relative path`);
    return null;
  }
  const absolutePath = path.join(root, relativePath);
  const segments = relativePath.split("/");
  const parentIdentity = [];
  let cursor = root;
  let leaf;
  try {
    for (const [index, segment] of segments.entries()) {
      cursor = path.join(cursor, segment);
      const entry = await lstat(cursor);
      if (entry.isSymbolicLink()) throw new Error("symlink");
      if (index < segments.length - 1) {
        if (!entry.isDirectory()) throw new Error("non-directory parent");
        parentIdentity.push({ path: cursor, dev: entry.dev, ino: entry.ino });
      } else {
        if (!entry.isFile() || entry.nlink !== 1) throw new Error("non-unique file");
        leaf = entry;
      }
    }
    const handle = await open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.nlink !== 1
        || opened.dev !== leaf.dev || opened.ino !== leaf.ino) {
        throw new Error("open identity mismatch");
      }
      const bytes = await handle.readFile();
      const after = await handle.stat();
      if (after.dev !== opened.dev || after.ino !== opened.ino
        || after.nlink !== 1 || after.size !== bytes.length) {
        throw new Error("read identity mismatch");
      }
      for (const expected of parentIdentity) {
        const current = await lstat(expected.path);
        if (!current.isDirectory() || current.isSymbolicLink()
          || current.dev !== expected.dev || current.ino !== expected.ino) {
          throw new Error("parent identity mismatch");
        }
      }
      const finalLeaf = await lstat(absolutePath);
      if (!finalLeaf.isFile() || finalLeaf.isSymbolicLink() || finalLeaf.nlink !== 1
        || finalLeaf.dev !== opened.dev || finalLeaf.ino !== opened.ino) {
        throw new Error("pathname identity mismatch");
      }
      return {
        bytes,
        digest: `sha256:${await sha256(bytes)}`,
      };
    } finally {
      await handle.close();
    }
  } catch {
    errors.push(`${label} is missing, aliased, or changed while freezing`);
    return null;
  }
}

async function publishPrivateFile(relativePath, bytes) {
  const absolutePath = path.join(root, relativePath);
  const directory = path.dirname(absolutePath);
  const basename = path.basename(absolutePath);
  try {
    const existing = await readFile(absolutePath);
    if (!existing.equals(bytes)) {
      fail([`${relativePath} already exists with different bytes; start a new round`]);
    }
    await chmod(absolutePath, 0o600);
    return;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const tempPath = path.join(
    directory,
    `.${basename}.${process.pid}.${randomBytes(12).toString("hex")}.tmp`,
  );
  const temp = await open(tempPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try {
    await temp.writeFile(bytes);
    await temp.sync();
  } finally {
    await temp.close();
  }
  try {
    await link(tempPath, absolutePath);
    await unlink(tempPath);
    const directoryHandle = await open(directory, constants.O_RDONLY);
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  } catch (error) {
    try {
      await unlink(tempPath);
    } catch {}
    throw error;
  }
  const published = await lstat(absolutePath);
  if (!published.isFile() || published.isSymbolicLink()
    || published.nlink !== 1 || (published.mode & 0o777) !== 0o600) {
    fail([`${relativePath} publication did not produce one private regular file`]);
  }
}

async function sha256(bytes) {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(bytes).digest("hex");
}

function repositoryPath(value) {
  return typeof value === "string" && value.length > 0
    && !path.isAbsolute(value) && !value.includes("\\")
    && value.normalize("NFC") === value
    && path.posix.normalize(value) === value
    && value !== "." && !value.startsWith("../");
}

function fail(messages) {
  console.error("CD03A continuation freeze failed:");
  for (const message of messages) console.error(`- ${message}`);
  process.exit(1);
}
