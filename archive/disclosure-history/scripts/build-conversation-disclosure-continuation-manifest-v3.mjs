#!/usr/bin/env node

import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import {
  CONTINUATION_V3_CLOSURE_MANIFEST_PATH,
  CONTINUATION_V3_BASELINE_ARCHIVE_PATH,
  CONTINUATION_V3_EXTERNAL_ATTESTATION_PATH,
  CONTINUATION_V3_FEATURE_ID,
  CONTINUATION_V3_MANIFEST_KIND,
  CONTINUATION_V3_POLICY_PATH,
  CONTINUATION_V3_RECEIPT_KIND,
  CONTINUATION_V3_REVIEW_LANES,
  CONTINUATION_V3_REVIEW_SNAPSHOT_PATH,
  CONTINUATION_V3_ROUND2_PREFREEZE_REJECTION_PATH,
  CONTINUATION_V3_ROUND,
  CONTINUATION_V3_WORKSTREAM_ID,
  hashCanonicalV3,
  sha256BytesV3,
  sha256DigestV3,
  validateBaselineArchiveV3,
  validateClosureManifestV3,
  validateContinuationPolicyV3,
  validateContinuationReviewSnapshotV3,
  validateLifecycleStateV3,
  selectLifecycleProfileV3,
  validateReviewSetV3,
  withCanonicalDigestV3,
} from "./conversation-disclosure-continuation-contract-v3.mjs";

const CHECKER_PATH = "scripts/check-conversation-disclosure-continuation-v3.mjs";
const EXTERNAL_RUNNER_PATH =
  "scripts/verify-conversation-disclosure-continuation-v3.mjs";
const PROGRAM_PATH = ".zerox/conversation-disclosure-program.json";
const FEATURE_LIST_PATH = ".zerox/feature_list.json";
const REVIEW_PHASE = "review_pre_transition";
const RECEIPT_PATHS = Object.freeze(Object.fromEntries(
  CONTINUATION_V3_REVIEW_LANES.map((lane) => [
    lane,
    `.zerox/verification/conversation-disclosure/CD03A-round3-${lane}-review.json`,
  ]),
));

export async function buildPendingContinuationManifestV3(args = process.argv.slice(2)) {
  const options = parseOptions(args);
  const root = await realpath(process.cwd());
  const verifierNow = Date.now();

  const archive = await readRepositoryJson(
    root,
    CONTINUATION_V3_BASELINE_ARCHIVE_PATH,
    "baseline archive",
  );
  const policy = await readRepositoryJson(root, CONTINUATION_V3_POLICY_PATH, "policy");
  const snapshot = await readRepositoryJson(
    root,
    CONTINUATION_V3_REVIEW_SNAPSHOT_PATH,
    "snapshot",
  );
  const program = await readRepositoryJson(root, PROGRAM_PATH, "conversation program");
  const featureList = await readRepositoryJson(root, FEATURE_LIST_PATH, "Feature list");
  validateCanonicalInput(policy, options.expectedPolicyDigest, "policy");
  validateCanonicalInput(snapshot, options.expectedSnapshotDigest, "snapshot");
  requireNoErrors("policy schema", validateContinuationPolicyV3(policy, {
    expectedDigest: options.expectedPolicyDigest,
    baselineArchive: archive,
  }));
  requireNoErrors("baseline archive", validateBaselineArchiveV3(archive, policy));
  if (program?.programId !== policy.programId) {
    fail("conversation program identity differs from policy");
  }

  const lifecycleProfile = selectLifecycleProfileV3(policy, REVIEW_PHASE);
  if (!lifecycleProfile) fail("policy lacks the review_pre_transition lifecycle profile");
  const workstreams = Array.isArray(program?.workstreams) ? program.workstreams : [];
  const features = Array.isArray(featureList?.features) ? featureList.features : [];
  const liveLifecycle = {
    phase: REVIEW_PHASE,
    activeFeatureId: program?.activeFeatureId,
    nextFeatureId: program?.nextFeatureId,
    workstreams,
    features,
  };
  requireNoErrors(
    "review_pre_transition lifecycle",
    validateLifecycleStateV3(liveLifecycle, policy),
  );
  requireNoErrors("policy live binding", validateContinuationPolicyV3(policy, {
    expectedDigest: options.expectedPolicyDigest,
    baselineArchive: archive,
    lifecycleState: liveLifecycle,
    liveAdmissionFeature: features.find(
      (entry) => entry?.id === CONTINUATION_V3_FEATURE_ID,
    ),
    liveAdmissionWorkstream: workstreams.find(
      (entry) => entry?.id === CONTINUATION_V3_WORKSTREAM_ID,
    ),
  }));
  requireNoErrors(
    "snapshot schema",
    validateContinuationReviewSnapshotV3(snapshot, policy, { verifierNow }),
  );
  await validateLiveSnapshotBindings(root, policy, snapshot);

  const checkerCapture = await captureStableFile(
    path.join(root, CHECKER_PATH),
    "checker",
    root,
  );
  const runnerCapture = await captureStableFile(
    path.join(root, EXTERNAL_RUNNER_PATH),
    "external runner",
    root,
  );
  if (checkerCapture.digest !== options.expectedCheckerDigest
    || runnerCapture.digest !== options.expectedExternalRunnerDigest) {
    fail("checker or external runner bytes do not match caller pins");
  }
  validateExecutablePolicyBinding(
    policy,
    "checker",
    CHECKER_PATH,
    options.expectedCheckerDigest,
  );
  validateExecutablePolicyBinding(
    policy,
    "runner",
    EXTERNAL_RUNNER_PATH,
    options.expectedExternalRunnerDigest,
  );

  const receipts = [];
  const callerPins = {};
  for (const lane of CONTINUATION_V3_REVIEW_LANES) {
    const receipt = await readRepositoryJson(root, RECEIPT_PATHS[lane], `${lane} receipt`);
    receipts.push(receipt);
    callerPins[lane] = {
      canonicalDigest: options.receiptDigests.get(lane),
      challenge: options.challenges.get(lane),
    };
  }
  const reviewErrors = validateReviewSetV3(receipts, snapshot, policy, {
    verifierNow,
    callerPins,
  });
  if (reviewErrors.length > 0) {
    fail(`review set validation failed:\n${reviewErrors.join("\n")}`);
  }

  const manifest = withCanonicalDigestV3({
    schemaVersion: 3,
    kind: CONTINUATION_V3_MANIFEST_KIND,
    programId: policy.programId,
    workstreamId: CONTINUATION_V3_WORKSTREAM_ID,
    featureId: CONTINUATION_V3_FEATURE_ID,
    round: CONTINUATION_V3_ROUND,
    status: "review_passed_pending_external_anchor",
    parentEvidenceBundleDigest: policy.parentEvidence.bundleDigest,
    policy: {
      path: CONTINUATION_V3_POLICY_PATH,
      digest: policy.digest,
    },
    snapshot: {
      path: CONTINUATION_V3_REVIEW_SNAPSHOT_PATH,
      digest: snapshot.digest,
    },
    reviewReceipts: CONTINUATION_V3_REVIEW_LANES.map((lane, index) => ({
      lane,
      path: RECEIPT_PATHS[lane],
      canonicalDigest: hashCanonicalV3(receipts[index]),
      challenge: receipts[index].challenge,
    })),
    validator: {
      path: CHECKER_PATH,
      sha256: options.expectedCheckerDigest,
    },
    externalRunner: {
      path: EXTERNAL_RUNNER_PATH,
      sha256: options.expectedExternalRunnerDigest,
    },
    externalAttestation: {
      path: CONTINUATION_V3_EXTERNAL_ATTESTATION_PATH,
      canonicalDigest: null,
    },
  });
  const manifestErrors = validateClosureManifestV3(manifest, {
    policy,
    snapshot,
    receipts,
  });
  if (manifestErrors.length > 0) {
    fail(`pending manifest validation failed:\n${manifestErrors.join("\n")}`);
  }

  const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  if (options.output) {
    await writeExclusiveOrVerifyExact(options.output, bytes);
  } else {
    process.stdout.write(bytes);
  }
  return manifest;
}

function parseOptions(args) {
  const single = new Map([
    ["--expected-policy-digest", "expectedPolicyDigest"],
    ["--expected-snapshot-digest", "expectedSnapshotDigest"],
    ["--expected-external-runner-digest", "expectedExternalRunnerDigest"],
    ["--expected-checker-digest", "expectedCheckerDigest"],
    ["--output", "output"],
  ]);
  const values = {
    receiptDigests: new Map(),
    challenges: new Map(),
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (single.has(argument)) {
      const key = single.get(argument);
      if (values[key] !== undefined || args[index + 1] === undefined) {
        fail(`duplicate or valueless manifest builder option: ${argument}`);
      }
      values[key] = args[index + 1];
      index += 1;
      continue;
    }
    const target = argument === "--expected-review-receipt"
      ? values.receiptDigests
      : argument === "--expected-review-challenge"
        ? values.challenges
        : null;
    if (target) {
      const [lane, value, ...extra] = String(args[index + 1] ?? "").split("=");
      if (!lane || !value || extra.length > 0 || target.has(lane)) {
        fail(`${argument} requires one unique lane=sha256 pin`);
      }
      target.set(lane, value);
      index += 1;
      continue;
    }
    fail(`unknown manifest builder option: ${argument}`);
  }
  for (const key of [
    "expectedPolicyDigest",
    "expectedSnapshotDigest",
    "expectedExternalRunnerDigest",
    "expectedCheckerDigest",
  ]) {
    if (!sha256DigestV3(values[key])) fail(`missing or invalid ${key}`);
  }
  for (const [pins, label] of [
    [values.receiptDigests, "receipt"],
    [values.challenges, "challenge"],
  ]) {
    if (pins.size !== CONTINUATION_V3_REVIEW_LANES.length
      || CONTINUATION_V3_REVIEW_LANES.some((lane) => !sha256DigestV3(pins.get(lane)))) {
      fail(`caller must pin exactly three ordered-lane ${label} digests`);
    }
  }
  if (values.output !== undefined && !path.isAbsolute(values.output)) {
    fail("--output must be an absolute path");
  }
  return values;
}

function validateCanonicalInput(value, expectedDigest, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !sha256DigestV3(value.digest)) {
    fail(`${label} must contain a canonical digest`);
  }
  const withoutDigest = { ...value };
  delete withoutDigest.digest;
  if (value.digest !== hashCanonicalV3(withoutDigest)
    || value.digest !== expectedDigest) {
    fail(`${label} canonical digest does not match caller pin`);
  }
}

function requireNoErrors(label, errors) {
  if (errors.length > 0) {
    fail(`${label} validation failed:\n${errors.join("\n")}`);
  }
}

function validateExecutablePolicyBinding(policy, kind, expectedPath, expectedDigest) {
  const matches = (policy.continuationExecutables ?? []).filter(
    (entry) => entry?.kind === kind,
  );
  if (matches.length !== 1
    || matches[0].path !== expectedPath
    || matches[0].sha256 !== expectedDigest) {
    fail(`policy ${kind} executable binding is stale`);
  }
}

async function validateLiveSnapshotBindings(root, policy, snapshot) {
  const frozenPaths = new Set();
  for (const entry of snapshot.frozenFiles ?? []) {
    const capture = await captureStableFile(
      path.join(root, entry.path),
      `frozen snapshot file ${entry.path}`,
      root,
    );
    if (capture.digest !== entry.sha256) {
      fail(`frozen snapshot file drift: ${entry.path}`);
    }
    frozenPaths.add(entry.path);
  }
  const payloadPaths = new Set();
  for (const entry of snapshot.transitionPayloadFiles ?? []) {
    const capture = await captureStableFile(
      path.join(root, entry.path),
      `transition payload ${entry.path}`,
      root,
    );
    if (capture.digest !== entry.sha256) {
      fail(`transition payload drift: ${entry.path}`);
    }
    payloadPaths.add(entry.path);
  }
  if (payloadPaths.size !== 4
    || [...payloadPaths].some((relativePath) => frozenPaths.has(relativePath))) {
    fail("snapshot must bind exactly four disjoint transition payload files");
  }
  for (const entry of snapshot.baselineFiles ?? []) {
    const capture = await captureStableFile(
      path.join(root, entry.path),
      `snapshot baseline file ${entry.path}`,
      root,
    );
    if (capture.digest !== entry.sha256) {
      fail(`snapshot baseline file drift: ${entry.path}`);
    }
  }
  for (const relativePath of snapshot.absentPaths ?? []) {
    await requireMissingRepositoryPath(root, relativePath, `snapshot absence ${relativePath}`);
  }
  const transitionByPayload = new Map(
    (policy.governanceTransitions ?? []).map((entry) => [entry.stagedTargetPath, entry]),
  );
  for (const relativePath of payloadPaths) {
    const transition = transitionByPayload.get(relativePath);
    if (!transition) fail(`unknown transition payload path: ${relativePath}`);
    const live = await captureStableFile(
      path.join(root, transition.path),
      `pre-transition live file ${transition.path}`,
      root,
    );
    if (live.digest !== transition.fromSha256) {
      fail(`pre-transition live file drift: ${transition.path}`);
    }
  }
  const witnessPath = CONTINUATION_V3_ROUND2_PREFREEZE_REJECTION_PATH;
  const witness = await captureStableFile(
    path.join(root, witnessPath),
    "Round2 deterministic rejection witness",
    root,
  );
  const expectedWitnessBytes = Buffer.from(
    `${JSON.stringify(policy.round2PrefreezeRejection, null, 2)}\n`,
    "utf8",
  );
  if (!witness.bytes.equals(expectedWitnessBytes) || witness.mode !== 0o600) {
    fail("Round2 deterministic rejection witness bytes/mode differ from policy");
  }
  for (const reference of [
    policy.round2PrefreezeRejection?.sourcePolicy,
    policy.round2PrefreezeRejection?.baselineArchive,
    ...(policy.round2PrefreezeRejection?.continuationExecutables ?? []),
    ...(policy.round2PrefreezeRejection?.liveTransitionFiles ?? []),
    ...(policy.round2PrefreezeRejection?.transitionPayloadFiles ?? []),
  ]) {
    const capture = await captureStableFile(
      path.join(root, reference.path),
      `Round2 rejection witness reference ${reference.path}`,
      root,
    );
    if (capture.digest !== (reference.byteSha256 ?? reference.sha256)) {
      fail(`Round2 rejection witness reference drift: ${reference.path}`);
    }
  }
  for (const relativePath of policy.round2PrefreezeRejection?.verifiedAbsentPaths ?? []) {
    await requireMissingRepositoryPath(
      root,
      relativePath,
      `verified absent Round2 output ${relativePath}`,
    );
  }
}

async function requireMissingRepositoryPath(root, relativePath, label) {
  if (typeof relativePath !== "string" || relativePath.startsWith("/")
    || relativePath.includes("\\") || relativePath.split("/").some(
      (segment) => !segment || segment === "." || segment === "..",
    )) {
    fail(`${label} has an invalid repository path`);
  }
  try {
    await lstat(path.join(root, relativePath));
    fail(`${label} must remain absent`);
  } catch (error) {
    if (error?.message?.includes("must remain absent")) throw error;
    if (error?.code !== "ENOENT") fail(`${label} absence cannot be established`);
  }
}

async function readRepositoryJson(root, relativePath, label) {
  const capture = await captureStableFile(path.join(root, relativePath), label, root);
  try {
    return JSON.parse(capture.bytes.toString("utf8"));
  } catch {
    fail(`${label} must contain valid JSON`);
  }
}

async function captureStableFile(absolutePath, label, expectedRoot) {
  const before = await lstat(absolutePath);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) {
    fail(`${label} must be a single-link regular file`);
  }
  const handle = await open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1
      || opened.dev !== before.dev || opened.ino !== before.ino) {
      fail(`${label} changed identity while opening`);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (after.dev !== opened.dev || after.ino !== opened.ino
      || after.nlink !== 1 || after.size !== bytes.length) {
      fail(`${label} changed identity while reading`);
    }
    const finalLeaf = await lstat(absolutePath);
    if (!finalLeaf.isFile() || finalLeaf.isSymbolicLink() || finalLeaf.nlink !== 1
      || finalLeaf.dev !== opened.dev || finalLeaf.ino !== opened.ino) {
      fail(`${label} changed pathname identity while reading`);
    }
    const canonical = await realpath(absolutePath);
    if (canonical !== expectedRoot
      && !canonical.startsWith(`${expectedRoot}${path.sep}`)) {
      fail(`${label} escaped the repository root`);
    }
    return { bytes, digest: sha256BytesV3(bytes), mode: opened.mode & 0o777 };
  } finally {
    await handle.close();
  }
}

async function writeExclusiveOrVerifyExact(absolutePath, bytes) {
  let handle;
  let createdIdentity;
  try {
    handle = await open(
      absolutePath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = await capturePrivateOutput(absolutePath);
    if (!existing.bytes.equals(bytes)) fail("output contains third-state bytes");
    return;
  }
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    const created = await handle.stat();
    if (!created.isFile() || created.nlink !== 1
      || created.uid !== process.geteuid() || (created.mode & 0o777) !== 0o600
      || created.size !== bytes.length) {
      fail("exclusive output descriptor identity/mode is invalid");
    }
    createdIdentity = { dev: created.dev, ino: created.ino };
  } finally {
    await handle.close();
  }
  const created = await capturePrivateOutput(absolutePath);
  if (!created.bytes.equals(bytes)
    || created.dev !== createdIdentity.dev || created.ino !== createdIdentity.ino) {
    fail("exclusive output bytes or identity changed after creation");
  }
}

async function capturePrivateOutput(absolutePath) {
  const before = await lstat(absolutePath);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1
    || before.uid !== process.geteuid() || (before.mode & 0o777) !== 0o600) {
    fail("output must be effective-user-owned single-link mode 0600");
  }
  const handle = await open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.nlink !== 1) {
      fail("output changed identity while opening");
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (after.dev !== opened.dev || after.ino !== opened.ino
      || after.nlink !== 1 || after.size !== bytes.length) {
      fail("output changed identity while reading");
    }
    const finalLeaf = await lstat(absolutePath);
    if (!finalLeaf.isFile() || finalLeaf.isSymbolicLink() || finalLeaf.nlink !== 1
      || finalLeaf.dev !== opened.dev || finalLeaf.ino !== opened.ino) {
      fail("output changed pathname identity while reading");
    }
    return { bytes, dev: opened.dev, ino: opened.ino };
  } finally {
    await handle.close();
  }
}

function fail(message) {
  throw new Error(message);
}

async function cli() {
  try {
    await buildPendingContinuationManifestV3();
  } catch (error) {
    console.error("Conversation disclosure continuation manifest builder v3 failed:");
    console.error(`- ${error?.message ?? String(error)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await cli();
}

export const CONTINUATION_V3_MANIFEST_OUTPUT_PATH =
  CONTINUATION_V3_CLOSURE_MANIFEST_PATH;
export const CONTINUATION_V3_REVIEW_RECEIPT_PATHS = RECEIPT_PATHS;
export const CONTINUATION_V3_REVIEW_RECEIPT_KIND = CONTINUATION_V3_RECEIPT_KIND;
