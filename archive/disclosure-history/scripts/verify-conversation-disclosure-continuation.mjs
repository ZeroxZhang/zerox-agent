import { createHash, randomBytes } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  open,
  readFile,
  realpath,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { promisify } from "node:util";
import {
  BASE_EXTERNAL_ANCHOR_DIGEST,
  BASE_SNAPSHOT_DIGEST,
  CONTINUATION_EXTERNAL_ANCHOR_KIND,
  CONTINUATION_EXTERNAL_ATTESTATION_KIND,
  CONTINUATION_FEATURE_ID,
  CONTINUATION_HEAD_KIND,
  CONTINUATION_ROUND,
  CONTINUATION_STATUS_ATTESTED,
  CONTINUATION_WORKSTREAM_ID,
  REQUIRED_CONTINUATION_REVIEW_LANES,
  hashCanonical,
  toPendingContinuationManifest,
  validateContinuationClosureManifest,
  validateContinuationExternalAnchor,
  validateContinuationExternalAttestation,
  validateContinuationPolicy,
  validateContinuationReviewReceipt,
  validateContinuationReviewSet,
  validateContinuationReviewSnapshot,
  withCanonicalDigest,
} from "./conversation-disclosure-continuation-contract.mjs";

const execFile = promisify(execFileCallback);
const root = process.cwd();
const canonicalRoot = await realpath(root);
const selfPath = await realpath(fileURLToPath(import.meta.url));
const options = parseOptions(process.argv.slice(2));
const errors = [...options.errors];
const policyPath =
  ".zerox/verification/conversation-disclosure/CD03A-successor-evolution-policy.json";
const snapshotPath =
  ".zerox/verification/conversation-disclosure/CD03A-round1-review-snapshot.json";
const manifestPath =
  ".zerox/verification/conversation-disclosure/CD03A-round1-closure-manifest.json";
const attestationPath =
  ".zerox/verification/conversation-disclosure/CD03A-round1-external-attestation.json";
const checkerPath = "scripts/check-conversation-disclosure-continuation.mjs";
const baseCheckerPath = "scripts/check-conversation-disclosure-program.mjs";
const harnessPath = "scripts/check-harness-state.mjs";
const transitionStages = new Map([
  ["package.json", ".zerox/verification/conversation-disclosure/CD03A-package-target.json"],
  [harnessPath, "scripts/check-harness-state-continuation.mjs"],
]);

if (selfPath === canonicalRoot || selfPath.startsWith(`${canonicalRoot}${path.sep}`)) {
  errors.push("continuation runner must execute from a caller-pinned copy outside the repository");
}
const selfBytes = await readFile(selfPath).catch(() => null);
const selfDigest = selfBytes ? sha256Bytes(selfBytes) : null;
if (selfDigest !== options.expectedRunnerDigest) {
  errors.push("external continuation runner digest does not match the caller pin");
}

const baseAnchorCapture = await readExternalPrivateFile(
  options.baseAnchorPath,
  "Round23 base anchor",
);
const baseAnchor = parseJson(baseAnchorCapture?.bytes, "Round23 base anchor");
if (baseAnchor?.digest !== BASE_EXTERNAL_ANCHOR_DIGEST
  || baseAnchor?.digest !== options.expectedBaseAnchorDigest
  || baseAnchor?.snapshotDigest !== BASE_SNAPSHOT_DIGEST
  || baseAnchor?.repositoryRealpath !== canonicalRoot
  || hashCanonical(withoutDigest(baseAnchor)) !== baseAnchor?.digest) {
  errors.push("Round23 base anchor identity or caller pin is stale");
}

const [policy, snapshot, manifest] = await Promise.all([
  readRepositoryJson(policyPath, "continuation policy"),
  readRepositoryJson(snapshotPath, "continuation review snapshot"),
  readRepositoryJson(manifestPath, "pending continuation manifest"),
]);
const receipts = [];
for (const entry of manifest?.reviewReceipts ?? []) {
  const receipt = await readRepositoryJson(
    entry?.path,
    `${entry?.lane ?? "unknown"} continuation review receipt`,
  );
  if (receipt) receipts.push(receipt);
}

errors.push(...validateContinuationPolicy(policy, {
  baseAnchor,
  expectedDigest: options.expectedPolicyDigest,
  expectedProgramId: "conversation-progressive-disclosure-v3.9.2-2026-08",
}).map((error) => `policy: ${error}`));
errors.push(...validateContinuationReviewSnapshot(snapshot, policy)
  .map((error) => `snapshot: ${error}`));
if (snapshot?.digest !== options.expectedSnapshotDigest) {
  errors.push("continuation snapshot digest does not match the caller pin");
}
for (const receipt of receipts) {
  errors.push(...validateContinuationReviewReceipt(receipt, snapshot, policy)
    .map((error) => `${receipt?.lane ?? "unknown"} receipt: ${error}`));
}
errors.push(...validateContinuationReviewSet(receipts, snapshot, policy)
  .map((error) => `review set: ${error}`));
errors.push(...validateContinuationClosureManifest(manifest, { policy, snapshot })
  .map((error) => `manifest: ${error}`));
if (manifest?.status !== "review_passed_pending_external_anchor") {
  errors.push("external continuation runner requires a pending manifest");
}
if (manifest?.digest !== toPendingContinuationManifest(manifest).digest) {
  errors.push("pending continuation manifest is not canonical");
}

const reviewReceiptDigests = new Map();
for (const receipt of receipts) {
  reviewReceiptDigests.set(receipt.lane, hashCanonical(receipt));
}
for (const entry of manifest?.reviewReceipts ?? []) {
  if (reviewReceiptDigests.get(entry?.lane) !== entry?.canonicalDigest) {
    errors.push(`manifest review receipt digest is stale: ${entry?.lane ?? "unknown"}`);
  }
}

await validatePackageTransition(policy);
const transitionCaptures = new Map();
for (const transition of policy?.governanceTransitions ?? []) {
  const live = await readRepositoryFile(transition.path, `transition source ${transition.path}`);
  const stagePath = transitionStages.get(transition.path);
  const staged = await readRepositoryFile(stagePath, `transition target ${stagePath}`);
  if (live?.digest !== transition.fromSha256) {
    errors.push(`transition source hash is stale: ${transition.path}`);
  }
  if (staged?.digest !== transition.toSha256) {
    errors.push(`transition target hash is stale: ${transition.path}`);
  }
  transitionCaptures.set(transition.path, { live, staged });
}

for (const entry of policy?.trustRoots ?? []) {
  const transition = transitionCaptures.get(entry.path);
  const capture = transition?.staged
    ?? await readRepositoryFile(entry.path, `trust root ${entry.path}`);
  if (capture?.digest !== entry.sha256) {
    errors.push(`continuation trust-root target is stale: ${entry.path}`);
  }
}
if (errors.length > 0) fail(errors);

await runBasePreflight();

let transitioned = false;
try {
  for (const [relativePath, capture] of transitionCaptures) {
    await atomicReplace(
      relativePath,
      capture.live,
      capture.staged.bytes,
      capture.staged.digest,
    );
  }
  transitioned = true;

  const bootstrapArgs = [
    "--bootstrap-candidate",
    "--base-anchor", options.baseAnchorPath,
    "--expected-base-anchor-digest", options.expectedBaseAnchorDigest,
    "--expected-policy-digest", options.expectedPolicyDigest,
    "--expected-snapshot-digest", options.expectedSnapshotDigest,
  ];
  const checkerResult = await runCandidate("checker", checkerPath, bootstrapArgs);
  const harnessResult = await runCandidate("harness", harnessPath, bootstrapArgs);
  const completedAt = new Date().toISOString();
  const validatorDigest = policy.continuationExecutables.find(
    (entry) => entry.kind === "checker",
  ).sha256;
  const pendingManifestDigest = manifest.digest;
  const receiptReferences = REQUIRED_CONTINUATION_REVIEW_LANES.map((lane) => {
    const receipt = receipts.find((candidate) => candidate.lane === lane);
    return { lane, canonicalDigest: hashCanonical(receipt) };
  });
  const attestation = withCanonicalDigest({
    schemaVersion: 1,
    kind: CONTINUATION_EXTERNAL_ATTESTATION_KIND,
    status: "passed",
    trustLevel: "external-anchor-consistency",
    subjectIdentityAssurance: "not-signed",
    repositoryRealpath: canonicalRoot,
    completedAt,
    baseExternalAnchorDigest: BASE_EXTERNAL_ANCHOR_DIGEST,
    baseSnapshotDigest: BASE_SNAPSHOT_DIGEST,
    pendingManifestDigest,
    policyDigest: policy.digest,
    snapshotDigest: snapshot.digest,
    validatorDigest,
    runnerDigest: selfDigest,
    reviewReceiptDigests: receiptReferences,
    candidateResults: [checkerResult, harnessResult],
  });
  const finalManifest = withCanonicalDigest({
    ...withoutDigest(manifest),
    status: CONTINUATION_STATUS_ATTESTED,
    externalAttestation: {
      path: attestationPath,
      canonicalDigest: attestation.digest,
    },
  });
  const externalAnchor = withCanonicalDigest({
    schemaVersion: 1,
    kind: CONTINUATION_EXTERNAL_ANCHOR_KIND,
    trustLevel: "external-caller-pinned-consistency",
    subjectIdentityAssurance: "not-signed",
    repositoryRealpath: canonicalRoot,
    completedAt,
    baseExternalAnchorDigest: BASE_EXTERNAL_ANCHOR_DIGEST,
    baseSnapshotDigest: BASE_SNAPSHOT_DIGEST,
    policyDigest: policy.digest,
    snapshotDigest: snapshot.digest,
    validatorDigest,
    runnerDigest: selfDigest,
    attestationDigest: attestation.digest,
    reviewReceipts: REQUIRED_CONTINUATION_REVIEW_LANES.map((lane) => {
      const receipt = receipts.find((candidate) => candidate.lane === lane);
      return {
        lane,
        canonicalDigest: hashCanonical(receipt),
        challenge: receipt.challenge,
      };
    }),
    head: {
      kind: CONTINUATION_HEAD_KIND,
      status: CONTINUATION_STATUS_ATTESTED,
      workstreamId: CONTINUATION_WORKSTREAM_ID,
      featureId: CONTINUATION_FEATURE_ID,
      snapshotDigest: snapshot.digest,
      successorWorkstreamDefinitionDigest:
        policy.successor.workstreamDefinitionDigest,
      successorFeatureDefinitionDigest:
        policy.successor.featureDefinitionDigest,
    },
  });
  errors.push(...validateContinuationExternalAttestation(attestation, {
    manifest: finalManifest,
    policy,
    snapshot,
    receipts,
    repositoryRealpath: canonicalRoot,
    runnerDigest: selfDigest,
    validatorDigest,
  }).map((error) => `attestation: ${error}`));
  errors.push(...validateContinuationClosureManifest(finalManifest, { policy, snapshot })
    .map((error) => `final manifest: ${error}`));
  errors.push(...validateContinuationExternalAnchor(externalAnchor, {
    attestation,
    policy,
    snapshot,
    receipts,
    repositoryRealpath: canonicalRoot,
    runnerDigest: selfDigest,
    validatorDigest,
  }).map((error) => `external anchor: ${error}`));
  if (errors.length > 0) throw new Error(errors.join("\n"));

  await publishRepositoryFile(attestationPath, attestation, { replace: false });
  await publishRepositoryFile(manifestPath, finalManifest, {
    replace: true,
    expectedDigest: pendingManifestDigest,
  });
  await publishExternalFile(options.externalAnchorOutput, externalAnchor);

  console.log(JSON.stringify({
    kind: "cd03a-external-publication-receipt",
    status: "passed",
    policyDigest: policy.digest,
    snapshotDigest: snapshot.digest,
    attestationDigest: attestation.digest,
    manifestDigest: finalManifest.digest,
    externalAnchorPath: options.externalAnchorOutput,
    externalAnchorDigest: externalAnchor.digest,
  }));
} catch (error) {
  if (transitioned) {
    for (const [relativePath, capture] of [...transitionCaptures].reverse()) {
      try {
        const current = await readRepositoryFile(relativePath, `rollback ${relativePath}`);
        await atomicReplace(
          relativePath,
          current,
          capture.live.bytes,
          capture.live.digest,
        );
      } catch (rollbackError) {
        errors.push(`rollback failed for ${relativePath}: ${rollbackError.message}`);
      }
    }
  }
  errors.push(error?.message ?? "unknown external continuation failure");
  fail(errors);
}

async function runBasePreflight() {
  const args = [
    "--external-anchor", options.baseAnchorPath,
    "--expected-external-anchor-digest", options.expectedBaseAnchorDigest,
  ];
  for (const commandPath of [baseCheckerPath, harnessPath]) {
    try {
      await execFile(process.execPath, [commandPath, ...args], {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
      });
    } catch (error) {
      fail([`Round23 preflight failed at ${commandPath}`, safeProcessError(error)]);
    }
  }
}

async function runCandidate(kind, commandPath, args) {
  let result;
  try {
    result = await execFile(process.execPath, [commandPath, ...args], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (error) {
    throw new Error(`${kind} bootstrap candidate failed: ${safeProcessError(error)}`);
  }
  const receiptKind = kind === "checker"
    ? "cd03a-continuation-checker-receipt"
    : "cd03a-continuation-harness-receipt";
  const receipt = result.stdout.split(/\r?\n/).filter(Boolean).reverse()
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    }).find((candidate) => candidate?.kind === receiptKind);
  if (!receipt || receipt.status !== "passed") {
    throw new Error(`${kind} bootstrap candidate omitted its digest-bound receipt`);
  }
  return {
    kind,
    path: commandPath,
    status: "passed",
    receipt,
    receiptDigest: hashCanonical(receipt),
    stdoutDigest: sha256Bytes(Buffer.from(result.stdout, "utf8")),
    stderrDigest: sha256Bytes(Buffer.from(result.stderr, "utf8")),
  };
}

async function validatePackageTransition(candidatePolicy) {
  const current = await readRepositoryJson("package.json", "current package");
  const target = await readRepositoryJson(
    transitionStages.get("package.json"),
    "target package",
  );
  if (!current || !target) return;
  const expected = structuredClone(current);
  expected.scripts["program:check"] =
    "node scripts/check-runtime-convergence-program.mjs && node scripts/check-kernel-migration-program.mjs && node scripts/check-storage-convergence-program.mjs && node scripts/check-release-program.mjs && node scripts/check-conversation-disclosure-continuation.mjs";
  expected.scripts["conversation-disclosure:baseline"] =
    "node scripts/run-conversation-disclosure-performance.mjs";
  if (hashCanonical(expected) !== hashCanonical(target)) {
    errors.push("package target changes fields outside the exact reviewed migration");
  }
  for (const key of ["preinstall", "install", "postinstall", "prepare", "prepublish", "prepublishOnly"] ) {
    if (target.scripts?.[key] !== current.scripts?.[key]) {
      errors.push(`package target changes forbidden lifecycle script ${key}`);
    }
  }
  const transition = candidatePolicy?.governanceTransitions?.find(
    (entry) => entry.path === "package.json",
  );
  const targetCapture = await readRepositoryFile(
    transitionStages.get("package.json"),
    "package target bytes",
  );
  if (targetCapture?.digest !== transition?.toSha256) {
    errors.push("structured package target does not match the policy target hash");
  }
}

async function atomicReplace(relativePath, expected, targetBytes, targetDigest) {
  const absolutePath = path.join(root, relativePath);
  const current = await readRepositoryFile(relativePath, `replace preflight ${relativePath}`);
  if (!current || current.digest !== expected.digest
    || current.dev !== expected.dev || current.ino !== expected.ino) {
    throw new Error(`${relativePath} changed before exact transition`);
  }
  const directory = path.dirname(absolutePath);
  const tempPath = path.join(
    directory,
    `.${path.basename(relativePath)}.${process.pid}.${randomBytes(12).toString("hex")}.tmp`,
  );
  const handle = await open(tempPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, expected.mode);
  try {
    await handle.writeFile(targetBytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(tempPath, absolutePath);
    await chmod(absolutePath, expected.mode);
    const directoryHandle = await open(directory, constants.O_RDONLY);
    try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
  } catch (error) {
    try { await unlink(tempPath); } catch {}
    throw error;
  }
  const after = await readRepositoryFile(relativePath, `replace postflight ${relativePath}`);
  if (after?.digest !== targetDigest) {
    throw new Error(`${relativePath} exact transition target hash is stale after publication`);
  }
}

async function publishRepositoryFile(relativePath, value, { replace, expectedDigest } = {}) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  const absolutePath = path.join(root, relativePath);
  if (replace) {
    const current = await readRepositoryFile(relativePath, `publication preflight ${relativePath}`);
    if (current?.digest !== expectedDigest) {
      throw new Error(`${relativePath} changed before external publication`);
    }
    await atomicReplace(relativePath, current, bytes, sha256Bytes(bytes));
    await chmod(absolutePath, 0o600);
    return;
  }
  await publishNewPrivateFile(absolutePath, bytes);
}

async function publishExternalFile(absolutePath, value) {
  if (!path.isAbsolute(absolutePath)
    || absolutePath === canonicalRoot
    || absolutePath.startsWith(`${canonicalRoot}${path.sep}`)) {
    throw new Error("external anchor output must be an absolute path outside the repository");
  }
  await publishNewPrivateFile(
    absolutePath,
    Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"),
  );
}

async function publishNewPrivateFile(absolutePath, bytes) {
  const handle = await open(
    absolutePath,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    0o600,
  );
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(absolutePath, 0o600);
  const directoryHandle = await open(path.dirname(absolutePath), constants.O_RDONLY);
  try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
}

async function readRepositoryJson(relativePath, label) {
  const capture = await readRepositoryFile(relativePath, label);
  return parseJson(capture?.bytes, label);
}

async function readRepositoryFile(relativePath, label) {
  if (!repositoryPath(relativePath)) {
    errors.push(`${label} must use a normalized repository-relative path`);
    return null;
  }
  return readStableFile(path.join(root, relativePath), label, false);
}

async function readExternalPrivateFile(absolutePath, label) {
  if (!path.isAbsolute(absolutePath ?? "")
    || absolutePath === canonicalRoot
    || absolutePath.startsWith(`${canonicalRoot}${path.sep}`)) {
    errors.push(`${label} must remain outside the repository`);
    return null;
  }
  return readStableFile(absolutePath, label, true);
}

async function readStableFile(absolutePath, label, requirePrivate) {
  let before;
  try {
    before = await lstat(absolutePath);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) {
      throw new Error("not one regular file");
    }
    if (requirePrivate && (before.uid !== process.geteuid()
      || (before.mode & 0o777) !== 0o600)) {
      throw new Error("not caller-private");
    }
    const handle = await open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = await handle.stat();
      if (opened.dev !== before.dev || opened.ino !== before.ino || opened.nlink !== 1) {
        throw new Error("identity changed while opening");
      }
      const bytes = await handle.readFile();
      const after = await handle.stat();
      const leaf = await lstat(absolutePath);
      if (after.dev !== opened.dev || after.ino !== opened.ino
        || after.size !== bytes.length || after.nlink !== 1
        || leaf.dev !== opened.dev || leaf.ino !== opened.ino
        || leaf.isSymbolicLink() || leaf.nlink !== 1) {
        throw new Error("identity changed while reading");
      }
      return {
        bytes,
        digest: sha256Bytes(bytes),
        dev: opened.dev,
        ino: opened.ino,
        mode: opened.mode & 0o777,
      };
    } finally {
      await handle.close();
    }
  } catch (error) {
    errors.push(`${label} is missing, aliased, non-private, or unstable`);
    return null;
  }
}

function parseOptions(args) {
  const values = {
    baseAnchorPath: undefined,
    expectedBaseAnchorDigest: undefined,
    expectedPolicyDigest: undefined,
    expectedSnapshotDigest: undefined,
    expectedRunnerDigest: undefined,
    externalAnchorOutput: undefined,
    errors: [],
  };
  const names = new Map([
    ["--base-anchor", "baseAnchorPath"],
    ["--expected-base-anchor-digest", "expectedBaseAnchorDigest"],
    ["--expected-policy-digest", "expectedPolicyDigest"],
    ["--expected-snapshot-digest", "expectedSnapshotDigest"],
    ["--expected-runner-digest", "expectedRunnerDigest"],
    ["--external-anchor-output", "externalAnchorOutput"],
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const key = names.get(args[index]);
    if (!key) {
      values.errors.push(`unknown continuation runner option: ${args[index]}`);
      continue;
    }
    if (values[key] !== undefined) values.errors.push(`${args[index]} may appear only once`);
    values[key] = args[index + 1];
    index += 1;
  }
  for (const [name, key] of names) {
    if (!values[key]) values.errors.push(`${name} is required`);
  }
  if (values.expectedBaseAnchorDigest
    && values.expectedBaseAnchorDigest !== BASE_EXTERNAL_ANCHOR_DIGEST) {
    values.errors.push("base anchor digest must remain the accepted Round23 caller pin");
  }
  for (const key of [
    "expectedBaseAnchorDigest",
    "expectedPolicyDigest",
    "expectedSnapshotDigest",
    "expectedRunnerDigest",
  ]) {
    if (values[key] && !/^sha256:[0-9a-f]{64}$/.test(values[key])) {
      values.errors.push(`${key} must be sha256:<64 hex>`);
    }
  }
  return values;
}

function parseJson(bytes, label) {
  if (!bytes) return null;
  try { return JSON.parse(bytes.toString("utf8")); }
  catch { errors.push(`${label} must contain valid JSON`); return null; }
}

function withoutDigest(value) {
  if (!value || typeof value !== "object") return value;
  const copy = { ...value };
  delete copy.digest;
  return copy;
}

function repositoryPath(value) {
  return typeof value === "string" && value.length > 0
    && !path.isAbsolute(value) && !value.includes("\\")
    && value.normalize("NFC") === value
    && path.posix.normalize(value) === value
    && value !== "." && !value.startsWith("../");
}

function sha256Bytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function safeProcessError(error) {
  return [error?.message, error?.stdout, error?.stderr].filter(Boolean).join("\n").slice(0, 8000);
}

function fail(messages) {
  console.error("CD03A external continuation verification failed:");
  for (const message of [...new Set(messages.filter(Boolean))]) {
    console.error(`- ${message}`);
  }
  process.exit(1);
}
