#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
  link,
  lstat,
  open,
  realpath,
  unlink,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  CONTINUATION_V2_ALGORITHM,
  CONTINUATION_V2_BASELINE_ARCHIVE_PATH,
  CONTINUATION_V2_FEATURE_ID,
  CONTINUATION_V2_POLICY_PATH,
  CONTINUATION_V2_REVIEW_SNAPSHOT_PATH,
  CONTINUATION_V2_ROUND,
  CONTINUATION_V2_SNAPSHOT_KIND,
  CONTINUATION_V2_WORKSTREAM_ID,
  hashCanonical,
  repositoryPathV2,
  selectLifecycleProfileV2,
  sha256Bytes,
  sha256DigestV2,
  validateBaselineArchiveV2,
  validateContinuationPolicyV2,
  validateLifecycleStateV2,
  validateReviewSnapshotV2,
} from "./conversation-disclosure-continuation-contract-v2.mjs";

const PROGRAM_PATH = ".zerox/conversation-disclosure-program.json";
const FEATURE_LIST_PATH = ".zerox/feature_list.json";
const REVIEW_PHASE = "review_pre_transition";
const PRIVATE_MODE = 0o600;

export class FreezeV2Failure extends Error {
  constructor(errors) {
    const uniqueErrors = [...new Set(Array.isArray(errors) ? errors : [errors])];
    super(uniqueErrors.join("\n"));
    this.name = "FreezeV2Failure";
    this.errors = uniqueErrors;
  }
}

export function parseContinuationFreezeOptionsV2(argv) {
  const options = { expectedPolicyDigest: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument !== "--expected-policy-digest") {
      throw new FreezeV2Failure(`unknown continuation freeze option: ${argument}`);
    }
    if (options.expectedPolicyDigest !== undefined) {
      throw new FreezeV2Failure("--expected-policy-digest must be supplied exactly once");
    }
    options.expectedPolicyDigest = argv[index + 1];
    index += 1;
  }
  if (!sha256DigestV2(options.expectedPolicyDigest)) {
    throw new FreezeV2Failure(
      "continuation freeze requires one caller-pinned --expected-policy-digest",
    );
  }
  return options;
}

export function assertFrozenAtV2(frozenAt, verifierNow) {
  if (!Number.isFinite(verifierNow)) {
    throw new FreezeV2Failure("continuation freeze requires one finite verifierNow");
  }
  const parsed = typeof frozenAt === "string" ? Date.parse(frozenAt) : Number.NaN;
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== frozenAt) {
    throw new FreezeV2Failure("continuation snapshot frozenAt must be canonical ISO time");
  }
  if (parsed > verifierNow) {
    throw new FreezeV2Failure("continuation snapshot frozenAt must not be in the future");
  }
}

export function classifyAdmissionFilesV2(policy, frozenPaths) {
  const files = policy?.admission?.featureDefinition?.files;
  if (!Array.isArray(files) || files.length === 0
    || new Set(files).size !== files.length
    || files.some((entry) => !repositoryPathV2(entry))) {
    throw new FreezeV2Failure("P107A exact file roster is invalid");
  }
  const frozen = frozenPaths instanceof Set ? frozenPaths : new Set(frozenPaths ?? []);
  const transitionLive = new Set((policy.governanceTransitions ?? [])
    .map((entry) => entry.path));
  const transitionTarget = new Set((policy.governanceTransitions ?? [])
    .map((entry) => entry.stagedTargetPath));
  const postReviewMutable = new Set(policy.admission?.postReviewMutablePaths ?? []);
  const reviewOutputAbsent = new Set(policy.admission?.reviewOutputPaths ?? []);
  const featureSet = new Set(files);
  const extraneousFrozen = [...frozen].filter((entry) => !featureSet.has(entry));
  if (extraneousFrozen.length > 0) {
    throw new FreezeV2Failure(
      extraneousFrozen.map((entry) => `unknown P107A frozen path: ${entry}`),
    );
  }
  const coverage = [];
  const byClass = {
    frozen_file: [],
    transition_live: [],
    transition_target: [],
    post_review_mutable: [],
    review_output_absent: [],
  };
  const errors = [];
  for (const relativePath of files) {
    const classes = [
      frozen.has(relativePath) ? "frozen_file" : null,
      transitionLive.has(relativePath) ? "transition_live" : null,
      transitionTarget.has(relativePath) ? "transition_target" : null,
      postReviewMutable.has(relativePath) ? "post_review_mutable" : null,
      reviewOutputAbsent.has(relativePath) ? "review_output_absent" : null,
    ].filter(Boolean);
    if (classes.length === 0) {
      errors.push(`P107A path has no review coverage class: ${relativePath}`);
      continue;
    }
    if (classes.length !== 1) {
      errors.push(`P107A path overlaps review coverage classes: ${relativePath}`);
      continue;
    }
    coverage.push({ path: relativePath, class: classes[0] });
    byClass[classes[0]].push(relativePath);
  }
  coverage.sort((left, right) => left.path.localeCompare(right.path));
  for (const values of Object.values(byClass)) values.sort();
  if (policy.admission?.reviewCoverageDigest !== hashCanonical(coverage)) {
    errors.push("P107A reviewCoverageDigest is invalid or stale");
  }
  if (errors.length > 0) throw new FreezeV2Failure(errors);
  return { coverage, byClass };
}

export async function captureStableRepositoryFileV2(
  repositoryRealpath,
  relativePath,
  label = relativePath,
) {
  requireRepositoryPath(relativePath, label);
  const parents = await captureParentRoster(repositoryRealpath, relativePath, label);
  const absolutePath = path.join(repositoryRealpath, relativePath);
  let before;
  try {
    before = await lstat(absolutePath, { bigint: true });
  } catch (error) {
    throw new FreezeV2Failure(`${label} is missing or inaccessible: ${error.code ?? "error"}`);
  }
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n) {
    throw new FreezeV2Failure(
      `${label} must be one non-symlink single-link regular file`,
    );
  }
  const handle = await open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat({ bigint: true });
    requireSameLeaf(before, opened, `${label} changed identity while opening`);
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    requireSameLeaf(opened, after, `${label} changed while reading`);
    if (after.size !== BigInt(bytes.length)) {
      throw new FreezeV2Failure(`${label} size changed while reading`);
    }
    const finalLeaf = await lstat(absolutePath, { bigint: true });
    requireSameLeaf(opened, finalLeaf, `${label} pathname identity changed while reading`);
    await assertParentRoster(parents, label);
    return {
      kind: "present",
      repositoryRealpath,
      relativePath,
      absolutePath,
      label,
      parents,
      identity: leafIdentity(opened),
      mode: Number(opened.mode & 0o777n),
      bytes,
      digest: sha256Bytes(bytes),
    };
  } finally {
    await handle.close();
  }
}

export async function captureAbsentRepositoryPathV2(
  repositoryRealpath,
  relativePath,
  label = relativePath,
) {
  requireRepositoryPath(relativePath, label);
  const parents = await captureParentRoster(repositoryRealpath, relativePath, label);
  const absolutePath = path.join(repositoryRealpath, relativePath);
  try {
    await lstat(absolutePath, { bigint: true });
    throw new FreezeV2Failure(`${label} must be absent before continuation freeze`);
  } catch (error) {
    if (error instanceof FreezeV2Failure) throw error;
    if (error?.code !== "ENOENT") {
      throw new FreezeV2Failure(`${label} absence cannot be established`);
    }
  }
  return {
    kind: "absent",
    repositoryRealpath,
    relativePath,
    absolutePath,
    label,
    parents,
  };
}

export async function postflightFreezeCapturesV2(captures) {
  for (const capture of captures) {
    if (capture.kind === "absent") {
      await assertParentRoster(capture.parents, capture.label);
      try {
        await lstat(capture.absolutePath, { bigint: true });
        throw new FreezeV2Failure(`${capture.label} appeared before publication`);
      } catch (error) {
        if (error instanceof FreezeV2Failure) throw error;
        if (error?.code !== "ENOENT") {
          throw new FreezeV2Failure(`${capture.label} absence changed before publication`);
        }
      }
      continue;
    }
    const current = await captureStableRepositoryFileV2(
      capture.repositoryRealpath,
      capture.relativePath,
      capture.label,
    );
    if (!sameIdentity(current.identity, capture.identity)
      || current.digest !== capture.digest
      || current.mode !== capture.mode
      || !current.bytes.equals(capture.bytes)) {
      throw new FreezeV2Failure(`${capture.label} changed before freeze postflight`);
    }
  }
}

export async function publishPrivateNoReplaceV2(
  repositoryRealpath,
  relativePath,
  bytes,
) {
  requireRepositoryPath(relativePath, relativePath);
  if (!Buffer.isBuffer(bytes)) {
    throw new FreezeV2Failure("continuation snapshot publication requires Buffer bytes");
  }
  const absolutePath = path.join(repositoryRealpath, relativePath);
  try {
    const existing = await captureStableRepositoryFileV2(
      repositoryRealpath,
      relativePath,
      "existing continuation snapshot",
    );
    if (!existing.bytes.equals(bytes) || existing.mode !== PRIVATE_MODE) {
      throw new FreezeV2Failure(
        "existing continuation snapshot has third-state bytes or permissions",
      );
    }
    return { status: "idempotent", digest: existing.digest };
  } catch (error) {
    if (!(error instanceof FreezeV2Failure)
      || !error.message.includes("is missing or inaccessible: ENOENT")) {
      throw error;
    }
  }
  const parents = await captureParentRoster(repositoryRealpath, relativePath,
    "continuation snapshot publication parent");
  const directory = path.dirname(absolutePath);
  const basename = path.basename(absolutePath);
  const temporaryPath = path.join(
    directory,
    `.${basename}.${process.pid}.${randomBytes(12).toString("hex")}.tmp`,
  );
  let temporaryCreated = false;
  try {
    const handle = await open(
      temporaryPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      PRIVATE_MODE,
    );
    temporaryCreated = true;
    try {
      await handle.chmod(PRIVATE_MODE);
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await assertParentRoster(parents, "continuation snapshot publication parent");
    try {
      await link(temporaryPath, absolutePath);
    } catch (error) {
      if (error?.code === "EEXIST") {
        throw new FreezeV2Failure(
          "continuation snapshot appeared before atomic no-overwrite publication",
        );
      }
      throw error;
    }
    await unlink(temporaryPath);
    temporaryCreated = false;
    const directoryHandle = await open(
      directory,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
    const published = await captureStableRepositoryFileV2(
      repositoryRealpath,
      relativePath,
      "published continuation snapshot",
    );
    if (!published.bytes.equals(bytes) || published.mode !== PRIVATE_MODE) {
      throw new FreezeV2Failure("continuation snapshot atomic publication verification failed");
    }
    return { status: "published", digest: published.digest };
  } finally {
    if (temporaryCreated) {
      try {
        await unlink(temporaryPath);
      } catch {}
    }
  }
}

export async function runContinuationFreezeV2(argv, runtime = {}) {
  const options = parseContinuationFreezeOptionsV2(argv);
  const requestedRoot = path.resolve(runtime.cwd ?? process.cwd());
  const repositoryRealpath = await realpath(requestedRoot);
  if (repositoryRealpath !== requestedRoot) {
    throw new FreezeV2Failure("continuation freeze cwd must be the canonical repository path");
  }
  const verifierNow = runtime.verifierNow ?? Date.now();
  if (!Number.isFinite(verifierNow)) {
    throw new FreezeV2Failure("continuation freeze verifierNow is invalid");
  }
  const captures = [];
  const captureByPath = new Map();
  const capture = async (relativePath, label) => {
    if (captureByPath.has(relativePath)) return captureByPath.get(relativePath);
    const value = await captureStableRepositoryFileV2(
      repositoryRealpath,
      relativePath,
      label,
    );
    captures.push(value);
    captureByPath.set(relativePath, value);
    return value;
  };
  const captureAbsence = async (relativePath, label) => {
    const existing = captureByPath.get(relativePath);
    if (existing) {
      throw new FreezeV2Failure(`${label} overlaps a required present capture`);
    }
    const value = await captureAbsentRepositoryPathV2(
      repositoryRealpath,
      relativePath,
      label,
    );
    captures.push(value);
    return value;
  };

  const policyCapture = await capture(CONTINUATION_V2_POLICY_PATH, "continuation policy v2");
  const archiveCapture = await capture(
    CONTINUATION_V2_BASELINE_ARCHIVE_PATH,
    "continuation baseline archive v2",
  );
  const programCapture = await capture(PROGRAM_PATH, "conversation disclosure program");
  const featureListCapture = await capture(FEATURE_LIST_PATH, "Feature list");
  const policy = parseCapturedJson(policyCapture);
  const archive = parseCapturedJson(archiveCapture);
  const program = parseCapturedJson(programCapture);
  const featureList = parseCapturedJson(featureListCapture);

  requireNoErrors("policy", validateContinuationPolicyV2(policy, {
    expectedDigest: options.expectedPolicyDigest,
    baselineArchive: archive,
  }));
  requireNoErrors("archive", validateBaselineArchiveV2(archive, policy));
  if (policy.programId !== program?.programId) {
    throw new FreezeV2Failure("program identity differs from continuation policy");
  }
  const lifecycleProfile = selectLifecycleProfileV2(policy, REVIEW_PHASE);
  if (!lifecycleProfile) {
    throw new FreezeV2Failure("continuation policy lacks review_pre_transition profile");
  }
  const liveLifecycle = {
    phase: REVIEW_PHASE,
    activeFeatureId: program?.activeFeatureId,
    nextFeatureId: program?.nextFeatureId,
    workstreams: program?.workstreams,
    features: featureList?.features,
  };
  requireNoErrors("review_pre lifecycle", validateLifecycleStateV2(liveLifecycle, policy));
  const admissionFeature = liveLifecycle.features.find(
    (entry) => entry?.id === CONTINUATION_V2_FEATURE_ID,
  );
  const admissionWorkstream = liveLifecycle.workstreams.find(
    (entry) => entry?.id === CONTINUATION_V2_WORKSTREAM_ID,
  );
  requireNoErrors("policy live binding", validateContinuationPolicyV2(policy, {
    expectedDigest: options.expectedPolicyDigest,
    baselineArchive: archive,
    lifecycleState: liveLifecycle,
    liveAdmissionFeature: admissionFeature,
    liveAdmissionWorkstream: admissionWorkstream,
  }));

  const round1References = [
    policy.round1Rejection.policy,
    policy.round1Rejection.snapshot,
    ...policy.round1Rejection.receipts,
  ];
  for (const reference of round1References) {
    const current = await capture(reference.path, `Round1 rejection evidence ${reference.path}`);
    if (current.digest !== reference.byteSha256) {
      throw new FreezeV2Failure(`Round1 rejection evidence drift: ${reference.path}`);
    }
  }
  const round1ForbiddenAbsentPaths = new Set();
  for (const relativePath of policy.round1Rejection.forbiddenRepositoryOutputs) {
    await captureAbsence(relativePath, `forbidden Round1 output ${relativePath}`);
    round1ForbiddenAbsentPaths.add(relativePath);
  }

  const transitionLivePaths = new Set(policy.governanceTransitions
    .map((entry) => entry.path));
  const transitionTargetPaths = new Set(policy.governanceTransitions
    .map((entry) => entry.stagedTargetPath));
  const postReviewMutablePaths = new Set(policy.admission.postReviewMutablePaths);
  const reviewOutputPaths = new Set(policy.admission.reviewOutputPaths);
  const frozenAdmissionPaths = new Set();
  for (const relativePath of policy.admission.featureDefinition.files) {
    const explicitClasses = [
      transitionLivePaths.has(relativePath),
      transitionTargetPaths.has(relativePath),
      postReviewMutablePaths.has(relativePath),
      reviewOutputPaths.has(relativePath),
    ].filter(Boolean).length;
    if (explicitClasses === 0) {
      try {
        await capture(relativePath, `P107A frozen file ${relativePath}`);
      } catch (error) {
        throw new FreezeV2Failure(
          `P107A path has no valid frozen_file capture: ${relativePath}: ${error.message}`,
        );
      }
      frozenAdmissionPaths.add(relativePath);
    }
  }
  const admissionCoverage = classifyAdmissionFilesV2(policy, frozenAdmissionPaths);

  let existingSnapshot = null;
  for (const relativePath of [...reviewOutputPaths].sort()) {
    if (relativePath === CONTINUATION_V2_REVIEW_SNAPSHOT_PATH) {
      const absolutePath = path.join(repositoryRealpath, relativePath);
      try {
        await lstat(absolutePath, { bigint: true });
        existingSnapshot = await capture(relativePath, "existing continuation snapshot");
      } catch (error) {
        if (error instanceof FreezeV2Failure || error?.code !== "ENOENT") throw error;
        await captureAbsence(relativePath, "continuation snapshot output");
      }
    } else {
      await captureAbsence(relativePath, `review output ${relativePath}`);
    }
  }
  if (!reviewOutputPaths.has(CONTINUATION_V2_REVIEW_SNAPSHOT_PATH)) {
    throw new FreezeV2Failure("P107A review outputs must include the exact snapshot path");
  }

  const frozenFiles = new Map();
  for (const relativePath of admissionCoverage.byClass.frozen_file) {
    const entry = await capture(relativePath, `P107A frozen file ${relativePath}`);
    frozenFiles.set(relativePath, entry.digest);
  }
  for (const transition of policy.governanceTransitions) {
    const live = await capture(transition.path, `transition live ${transition.path}`);
    const staged = await capture(
      transition.stagedTargetPath,
      `transition target ${transition.stagedTargetPath}`,
    );
    if (live.digest !== transition.fromSha256) {
      throw new FreezeV2Failure(`transition live digest drift: ${transition.path}`);
    }
    if (staged.digest !== transition.toSha256) {
      throw new FreezeV2Failure(`transition target digest drift: ${transition.path}`);
    }
    frozenFiles.set(transition.stagedTargetPath, staged.digest);
  }

  const baselineFiles = new Map();
  const absentPaths = new Set(round1ForbiddenAbsentPaths);
  for (const authority of policy.pathAuthorities) {
    if (authority.class === "modify") {
      const current = await capture(authority.path, `modify baseline ${authority.path}`);
      if (current.digest !== authority.baseline.sha256) {
        throw new FreezeV2Failure(`modify baseline digest drift: ${authority.path}`);
      }
      if (authority.baseline.source === "cd03a_review_snapshot") {
        baselineFiles.set(authority.path, current.digest);
      }
    } else if (authority.class === "create") {
      await captureAbsence(authority.path, `create baseline ${authority.path}`);
      absentPaths.add(authority.path);
    } else if (authority.class === "bookkeeping") {
      if (authority.baseline.presence === "present") {
        const current = await capture(authority.path,
          `bookkeeping baseline ${authority.path}`);
        if (current.digest !== authority.baseline.sha256) {
          throw new FreezeV2Failure(`bookkeeping baseline digest drift: ${authority.path}`);
        }
        baselineFiles.set(authority.path, current.digest);
      } else {
        await captureAbsence(authority.path, `bookkeeping baseline ${authority.path}`);
        absentPaths.add(authority.path);
      }
    }
  }

  const frozenAt = existingSnapshot
    ? parseCapturedJson(existingSnapshot)?.frozenAt
    : new Date(verifierNow).toISOString();
  assertFrozenAtV2(frozenAt, verifierNow);
  const snapshotWithoutDigest = {
    schemaVersion: 2,
    kind: CONTINUATION_V2_SNAPSHOT_KIND,
    algorithm: CONTINUATION_V2_ALGORITHM,
    programId: policy.programId,
    workstreamId: CONTINUATION_V2_WORKSTREAM_ID,
    featureId: CONTINUATION_V2_FEATURE_ID,
    round: CONTINUATION_V2_ROUND,
    frozenAt,
    parentEvidenceBundleDigest: policy.parentEvidence.bundleDigest,
    policyDigest: policy.digest,
    closedWorldDigest: policy.closedWorld.digest,
    pathAuthorityDigest: hashCanonical(policy.pathAuthorities),
    admissionFeatureDefinitionDigest: policy.admission.featureDefinitionDigest,
    admissionFeatureFileSetDigest: policy.admission.featureFileSetDigest,
    successorWorkstreamDefinitionDigest:
      policy.successor.workstreamDefinitionDigest,
    successorFeatureDefinitionDigest: policy.successor.featureDefinitionDigest,
    baselineArchive: policy.baselineArchive,
    frozenFiles: [...frozenFiles].map(([filePath, sha256]) => ({ path: filePath, sha256 }))
      .sort((left, right) => left.path.localeCompare(right.path)),
    baselineFiles: [...baselineFiles].map(([filePath, sha256]) => ({ path: filePath, sha256 }))
      .sort((left, right) => left.path.localeCompare(right.path)),
    absentPaths: [...absentPaths].sort(),
    reviewOutputAbsentPaths: [...reviewOutputPaths].sort(),
    governanceTransitions: policy.governanceTransitions,
  };
  const snapshot = {
    ...snapshotWithoutDigest,
    digest: hashCanonical(snapshotWithoutDigest),
  };
  requireNoErrors("snapshot", validateReviewSnapshotV2(snapshot, policy, { verifierNow }));
  if (admissionCoverage.coverage.length
      !== policy.admission.featureDefinition.files.length) {
    throw new FreezeV2Failure("P107A review coverage is not exact-once");
  }
  const snapshotBytes = Buffer.from(`${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  if (existingSnapshot
    && (!existingSnapshot.bytes.equals(snapshotBytes)
      || existingSnapshot.mode !== PRIVATE_MODE)) {
    throw new FreezeV2Failure(
      "existing continuation snapshot has third-state bytes or permissions",
    );
  }
  await postflightFreezeCapturesV2(captures);
  const publication = existingSnapshot
    ? { status: "idempotent", digest: existingSnapshot.digest }
    : await publishPrivateNoReplaceV2(
      repositoryRealpath,
      CONTINUATION_V2_REVIEW_SNAPSHOT_PATH,
      snapshotBytes,
    );
  return {
    kind: "cd03a-continuation-freeze-v2-receipt",
    status: "passed",
    publicationStatus: publication.status,
    repositoryRealpath,
    policyDigest: policy.digest,
    baselineArchiveDigest: archive.digest,
    snapshotPath: CONTINUATION_V2_REVIEW_SNAPSHOT_PATH,
    snapshotDigest: snapshot.digest,
    frozenFileCount: snapshot.frozenFiles.length,
    baselineFileCount: snapshot.baselineFiles.length,
    absentPathCount: snapshot.absentPaths.length,
    reviewOutputAbsentPathCount: snapshot.reviewOutputAbsentPaths.length,
  };
}

async function captureParentRoster(repositoryRealpath, relativePath, label) {
  const parents = [];
  let cursor = repositoryRealpath;
  const segments = relativePath.split("/");
  for (const segment of segments.slice(0, -1)) {
    cursor = path.join(cursor, segment);
    let entry;
    try {
      entry = await lstat(cursor, { bigint: true });
    } catch (error) {
      throw new FreezeV2Failure(`${label} parent is missing: ${error.code ?? "error"}`);
    }
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new FreezeV2Failure(`${label} parent must not traverse aliases or symlinks`);
    }
    parents.push({ absolutePath: cursor, dev: entry.dev, ino: entry.ino });
  }
  return parents;
}

async function assertParentRoster(parents, label) {
  for (const expected of parents) {
    const current = await lstat(expected.absolutePath, { bigint: true });
    if (!current.isDirectory() || current.isSymbolicLink()
      || current.dev !== expected.dev || current.ino !== expected.ino) {
      throw new FreezeV2Failure(`${label} parent identity changed`);
    }
  }
}

function leafIdentity(entry) {
  return {
    dev: entry.dev,
    ino: entry.ino,
    nlink: entry.nlink,
    size: entry.size,
    mtimeNs: entry.mtimeNs,
    ctimeNs: entry.ctimeNs,
  };
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino
    && left.nlink === right.nlink && left.size === right.size
    && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

function requireSameLeaf(expected, current, message) {
  if (!current.isFile() || current.isSymbolicLink() || current.nlink !== 1n
    || !sameIdentity(leafIdentity(expected), leafIdentity(current))) {
    throw new FreezeV2Failure(message);
  }
}

function requireRepositoryPath(relativePath, label) {
  if (!repositoryPathV2(relativePath)) {
    throw new FreezeV2Failure(`${label} must use a normalized repository path`);
  }
}

function parseCapturedJson(capture) {
  try {
    return JSON.parse(capture.bytes.toString("utf8"));
  } catch {
    throw new FreezeV2Failure(`${capture.label} must contain valid JSON`);
  }
}

function requireNoErrors(subject, errors) {
  if (errors.length > 0) {
    throw new FreezeV2Failure(errors.map((error) => `${subject}: ${error}`));
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const receipt = await runContinuationFreezeV2(process.argv.slice(2));
    console.log(JSON.stringify(receipt));
  } catch (error) {
    const messages = error instanceof FreezeV2Failure
      ? error.errors
      : [error instanceof Error ? error.message : String(error)];
    for (const message of messages) console.error(`continuation freeze v2: ${message}`);
    process.exitCode = 1;
  }
}
