#!/usr/bin/env node

import { constants } from "node:fs";
import {
  lstat,
  open,
  realpath,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  hashCanonicalV2,
  validateBaselineArchiveV2,
  validateContinuationPolicyV2,
  validateGovernanceTransitionStateV2,
  validateReviewSnapshotV2,
  withCanonicalDigestV2,
} from "./conversation-disclosure-continuation-contract-v2.mjs";
import {
  CONTINUATION_V3_ALGORITHM,
  CONTINUATION_V3_FEATURE_ID,
  CONTINUATION_V3_PREFREEZE_REJECTION_KIND,
  CONTINUATION_V3_REJECTED_ROUND,
  CONTINUATION_V3_ROUND,
  CONTINUATION_V3_ROUND2_ARCHIVE_TRUST_ROOT,
  CONTINUATION_V3_ROUND2_BASELINE_ARCHIVE_PATH,
  CONTINUATION_V3_ROUND2_EXECUTABLE_TRUST_ROOTS,
  CONTINUATION_V3_ROUND2_FORBIDDEN_OUTPUT_PATHS,
  CONTINUATION_V3_ROUND2_POLICY_PATH,
  CONTINUATION_V3_ROUND2_POLICY_TRUST_ROOT,
  CONTINUATION_V3_ROUND2_PREFREEZE_REJECTION_PATH,
  CONTINUATION_V3_ROUND2_TRANSITION_TRUST_ROOTS,
  CONTINUATION_V3_WORKSTREAM_ID,
  expectedRound2ContradictionV3,
  repositoryPathV3,
  serializeRound2PrefreezeRejectionV3,
  sha256BytesV3,
  validateRound2PrefreezeRejectionV3,
  withCanonicalDigestV3,
} from "./conversation-disclosure-continuation-contract-v3.mjs";

const PRIVATE_MODE = 0o600;

export async function buildConversationDisclosurePrefreezeRejectionV3({
  repositoryRoot = process.cwd(),
  outputPath,
} = {}) {
  const root = await canonicalDirectory(repositoryRoot, "repository root");
  const captures = new Map();
  const readRepository = async (relativePath, label = relativePath) => {
    if (!repositoryPathV3(relativePath)) {
      throw new Error(`${label} is not a repository-relative path`);
    }
    if (!captures.has(relativePath)) {
      captures.set(relativePath, await readStableFile(
        path.join(root, relativePath),
        label,
        root,
      ));
    }
    return captures.get(relativePath);
  };
  const readJson = async (relativePath, label = relativePath) =>
    parseJson((await readRepository(relativePath, label)).bytes, label);

  const [policyCapture, archiveCapture, policy, archive] = await Promise.all([
    readRepository(CONTINUATION_V3_ROUND2_POLICY_PATH, "Round2 rejected policy bytes"),
    readRepository(
      CONTINUATION_V3_ROUND2_BASELINE_ARCHIVE_PATH,
      "Round2 rejected archive bytes",
    ),
    readJson(CONTINUATION_V3_ROUND2_POLICY_PATH, "Round2 rejected policy"),
    readJson(CONTINUATION_V3_ROUND2_BASELINE_ARCHIVE_PATH, "Round2 rejected archive"),
  ]);
  if (policyCapture.digest !== CONTINUATION_V3_ROUND2_POLICY_TRUST_ROOT.byteSha256
    || policy.digest !== CONTINUATION_V3_ROUND2_POLICY_TRUST_ROOT.canonicalDigest) {
    throw new Error("Round2 policy bytes differ from the hard rejection trust root");
  }
  if (archiveCapture.digest !== CONTINUATION_V3_ROUND2_ARCHIVE_TRUST_ROOT.byteSha256
    || archive.digest !== CONTINUATION_V3_ROUND2_ARCHIVE_TRUST_ROOT.digest
    || archive.entrySetDigest
      !== CONTINUATION_V3_ROUND2_ARCHIVE_TRUST_ROOT.entrySetDigest) {
    throw new Error("Round2 archive bytes differ from the hard rejection trust root");
  }
  assertNoErrors(validateContinuationPolicyV2(policy, {
    expectedDigest: CONTINUATION_V3_ROUND2_POLICY_TRUST_ROOT.canonicalDigest,
    baselineArchive: archive,
  }), "Round2 rejected policy");
  assertNoErrors(validateBaselineArchiveV2(archive, policy),
    "Round2 rejected archive");
  if (canonical(policy.continuationExecutables)
    !== canonical(CONTINUATION_V3_ROUND2_EXECUTABLE_TRUST_ROOTS)
    || canonical(policy.governanceTransitions)
      !== canonical(CONTINUATION_V3_ROUND2_TRANSITION_TRUST_ROOTS)) {
    throw new Error("Round2 executable/transition roster differs from hard rejection roots");
  }

  const continuationExecutables = [];
  for (const expected of CONTINUATION_V3_ROUND2_EXECUTABLE_TRUST_ROOTS) {
    const capture = await readRepository(expected.path,
      `Round2 ${expected.kind} executable`);
    if (capture.digest !== expected.sha256) {
      throw new Error(`Round2 ${expected.kind} executable bytes drifted`);
    }
    continuationExecutables.push({ ...expected });
  }

  const liveTransitionFiles = [];
  const transitionPayloadFiles = [];
  const liveDigests = new Map();
  const stagedDigests = new Map();
  for (const transition of CONTINUATION_V3_ROUND2_TRANSITION_TRUST_ROOTS) {
    const [live, payload] = await Promise.all([
      readRepository(transition.path, `Round2 transition live ${transition.path}`),
      readRepository(
        transition.stagedTargetPath,
        `Round2 transition payload ${transition.stagedTargetPath}`,
      ),
    ]);
    if (live.digest !== transition.fromSha256) {
      throw new Error(`Round2 transition is not at fromSha256: ${transition.path}`);
    }
    if (payload.digest !== transition.toSha256) {
      throw new Error(`Round2 transition payload bytes drifted: ${transition.stagedTargetPath}`);
    }
    liveDigests.set(transition.path, live.digest);
    stagedDigests.set(transition.stagedTargetPath, payload.digest);
    liveTransitionFiles.push({ path: transition.path, sha256: live.digest });
    transitionPayloadFiles.push({
      path: transition.stagedTargetPath,
      sha256: payload.digest,
    });
  }
  liveTransitionFiles.sort(comparePath);
  transitionPayloadFiles.sort(comparePath);
  assertNoErrors(validateGovernanceTransitionStateV2(
    policy.governanceTransitions,
    "review_pre_transition",
    liveDigests,
    stagedDigests,
  ), "Round2 pre-transition state");

  for (const relativePath of CONTINUATION_V3_ROUND2_FORBIDDEN_OUTPUT_PATHS) {
    if (await readOptionalStableFile(path.join(root, relativePath), relativePath, root)) {
      throw new Error(`Round2 forbidden output is present: ${relativePath}`);
    }
  }

  const contradiction = await reproduceRound2Contradiction({
    policy,
    root,
    readRepository,
  });
  const witness = withCanonicalDigestV3({
    schemaVersion: 3,
    kind: CONTINUATION_V3_PREFREEZE_REJECTION_KIND,
    algorithm: CONTINUATION_V3_ALGORITHM,
    programId: policy.programId,
    workstreamId: CONTINUATION_V3_WORKSTREAM_ID,
    featureId: CONTINUATION_V3_FEATURE_ID,
    rejectedRound: CONTINUATION_V3_REJECTED_ROUND,
    recoveryRound: CONTINUATION_V3_ROUND,
    status: "rejected_pre_freeze",
    sourcePolicy: {
      path: CONTINUATION_V3_ROUND2_POLICY_PATH,
      ...CONTINUATION_V3_ROUND2_POLICY_TRUST_ROOT,
    },
    baselineArchive: {
      path: CONTINUATION_V3_ROUND2_BASELINE_ARCHIVE_PATH,
      ...CONTINUATION_V3_ROUND2_ARCHIVE_TRUST_ROOT,
    },
    continuationExecutables,
    governanceTransitions: CONTINUATION_V3_ROUND2_TRANSITION_TRUST_ROOTS
      .map((entry) => ({ ...entry })),
    liveTransitionFiles,
    transitionPayloadFiles,
    verifiedAbsentPaths: [...CONTINUATION_V3_ROUND2_FORBIDDEN_OUTPUT_PATHS],
    contradiction,
  });
  assertNoErrors(validateRound2PrefreezeRejectionV3(witness),
    "generated Round2 pre-freeze rejection witness");
  const bytes = serializeRound2PrefreezeRejectionV3(witness);
  let publicationStatus = "not_requested";
  if (outputPath !== undefined) {
    const absoluteOutput = resolveRepositoryOutput(root, outputPath);
    if (absoluteOutput !== path.join(root,
      CONTINUATION_V3_ROUND2_PREFREEZE_REJECTION_PATH)) {
      throw new Error("--output must be the exact Round2 pre-freeze rejection path");
    }
    publicationStatus = await publishPrivateNoReplace(absoluteOutput, bytes, root);
  }
  return { witness, bytes, publicationStatus };
}

async function reproduceRound2Contradiction({ policy, root, readRepository }) {
  const admissionFiles = policy.admission.featureDefinition.files;
  const transitionLive = new Set(policy.governanceTransitions
    .map((entry) => entry.path));
  const transitionTarget = new Set(policy.governanceTransitions
    .map((entry) => entry.stagedTargetPath));
  const postReviewMutable = new Set(policy.admission.postReviewMutablePaths);
  const reviewOutputs = new Set(policy.admission.reviewOutputPaths);
  const frozenFiles = [];
  for (const relativePath of admissionFiles) {
    if (transitionLive.has(relativePath) || postReviewMutable.has(relativePath)
      || reviewOutputs.has(relativePath)) continue;
    const capture = await readRepository(relativePath,
      `Round2 snapshot frozen subject ${relativePath}`);
    frozenFiles.push({ path: relativePath, sha256: capture.digest });
  }
  for (const transition of policy.governanceTransitions) {
    if (!transitionTarget.has(transition.stagedTargetPath)) {
      throw new Error("Round2 transition target roster is internally inconsistent");
    }
  }
  frozenFiles.sort(comparePath);
  const baselineFiles = [];
  const absentPaths = new Set(policy.round1Rejection.forbiddenRepositoryOutputs);
  for (const authority of policy.pathAuthorities) {
    if (authority.class === "modify"
      && authority.baseline.source === "cd03a_review_snapshot") {
      baselineFiles.push({ path: authority.path, sha256: authority.baseline.sha256 });
    } else if (authority.class === "create") {
      absentPaths.add(authority.path);
    } else if (authority.class === "bookkeeping") {
      if (authority.baseline.presence === "present") {
        baselineFiles.push({ path: authority.path, sha256: authority.baseline.sha256 });
      } else {
        absentPaths.add(authority.path);
      }
    }
  }
  baselineFiles.sort(comparePath);
  const withoutDigest = {
    schemaVersion: 2,
    kind: "conversation-disclosure-continuation-review-snapshot",
    algorithm: "sha256-canonical-json-v1",
    programId: policy.programId,
    workstreamId: policy.workstreamId,
    featureId: policy.featureId,
    round: 2,
    frozenAt: "1970-01-01T00:00:00.000Z",
    parentEvidenceBundleDigest: policy.parentEvidence.bundleDigest,
    policyDigest: policy.digest,
    closedWorldDigest: policy.closedWorld.digest,
    pathAuthorityDigest: hashCanonicalV2(policy.pathAuthorities),
    admissionFeatureDefinitionDigest: policy.admission.featureDefinitionDigest,
    admissionFeatureFileSetDigest: policy.admission.featureFileSetDigest,
    successorWorkstreamDefinitionDigest:
      policy.successor.workstreamDefinitionDigest,
    successorFeatureDefinitionDigest: policy.successor.featureDefinitionDigest,
    baselineArchive: policy.baselineArchive,
    frozenFiles,
    baselineFiles,
    absentPaths: [...absentPaths].sort(),
    reviewOutputAbsentPaths: [...reviewOutputs].sort(),
    governanceTransitions: policy.governanceTransitions,
  };
  const candidate = withCanonicalDigestV2(withoutDigest);
  const exactErrors = validateReviewSnapshotV2(candidate, policy, { verifierNow: 0 });
  const expected = expectedRound2ContradictionV3(policy.governanceTransitions);
  if (canonical(exactErrors) !== canonical(expected.errors)) {
    throw new Error(
      `Round2 contradiction reproduction changed: ${exactErrors.join("; ")}`,
    );
  }
  return expected;
}

async function publishPrivateNoReplace(absolutePath, bytes, root) {
  let handle;
  try {
    handle = await open(
      absolutePath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      PRIVATE_MODE,
    );
    await handle.chmod(PRIVATE_MODE);
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = await readStableFile(absolutePath, "existing rejection witness", root);
    if (existing.mode !== PRIVATE_MODE || !existing.bytes.equals(bytes)) {
      throw new Error("existing rejection witness has third-state bytes or permissions");
    }
    return "idempotent";
  } finally {
    await handle?.close();
  }
  const directoryHandle = await open(
    path.dirname(absolutePath),
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    await directoryHandle.sync();
  } finally {
    await directoryHandle.close();
  }
  const published = await readStableFile(absolutePath, "published rejection witness", root);
  if (published.mode !== PRIVATE_MODE || !published.bytes.equals(bytes)) {
    throw new Error("published rejection witness bytes or permissions changed");
  }
  return "created";
}

async function readOptionalStableFile(absolutePath, label, root) {
  try {
    return await readStableFile(absolutePath, label, root);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function readStableFile(absolutePath, label, root) {
  const before = await lstat(absolutePath);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) {
    throw new Error(`${label} must be a non-symlink single-link regular file`);
  }
  const handle = await open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (opened.dev !== before.dev || opened.ino !== before.ino
      || after.dev !== opened.dev || after.ino !== opened.ino
      || after.nlink !== 1 || after.size !== bytes.length) {
      throw new Error(`${label} changed while reading`);
    }
    const canonicalPath = await realpath(absolutePath);
    if (canonicalPath !== absolutePath || !isWithin(root, canonicalPath)) {
      throw new Error(`${label} traverses an alias or escaped the repository`);
    }
    return {
      bytes,
      digest: sha256BytesV3(bytes),
      mode: after.mode & 0o777,
    };
  } finally {
    await handle.close();
  }
}

async function canonicalDirectory(value, label) {
  if (!path.isAbsolute(value ?? "")) throw new Error(`${label} must be absolute`);
  const canonicalPath = await realpath(value);
  if (canonicalPath !== value || !(await stat(canonicalPath)).isDirectory()) {
    throw new Error(`${label} must be one canonical directory`);
  }
  return canonicalPath;
}

function resolveRepositoryOutput(root, value) {
  const absolutePath = path.isAbsolute(value) ? value : path.join(root, value);
  const resolved = path.resolve(absolutePath);
  if (!isWithin(root, resolved)) throw new Error("--output must remain in repository");
  return resolved;
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} must contain valid JSON`);
  }
}

function assertNoErrors(errors, label) {
  if (errors.length > 0) throw new Error(`${label}: ${errors.join("; ")}`);
}

function canonical(value) {
  return JSON.stringify(value);
}

function comparePath(left, right) {
  return left.path.localeCompare(right.path);
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function parseOptions(argv) {
  const options = { repositoryRoot: process.cwd() };
  for (let index = 0; index < argv.length; index += 2) {
    if (argv[index] !== "--output" || argv[index + 1] === undefined
      || options.outputPath !== undefined) {
      throw new Error(`unknown, duplicate, or valueless option: ${argv[index]}`);
    }
    options.outputPath = argv[index + 1];
  }
  return options;
}

async function cli() {
  try {
    const result = await buildConversationDisclosurePrefreezeRejectionV3(
      parseOptions(process.argv.slice(2)),
    );
    process.stdout.write(`${JSON.stringify({
      kind: "cd03a-round2-prefreeze-rejection-builder-v3-receipt",
      status: "passed",
      publicationStatus: result.publicationStatus,
      witnessDigest: result.witness.digest,
      outputPath: CONTINUATION_V3_ROUND2_PREFREEZE_REJECTION_PATH,
    })}\n`);
  } catch (error) {
    console.error(`Pre-freeze rejection v3 builder failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await cli();
}
