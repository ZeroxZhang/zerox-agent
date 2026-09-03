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
  CONTINUATION_V3_ALGORITHM,
  CONTINUATION_V3_BASELINE_ARCHIVE_PATH,
  CONTINUATION_V3_FEATURE_ID,
  CONTINUATION_V3_POLICY_PATH,
  CONTINUATION_V3_REVIEW_SNAPSHOT_PATH,
  CONTINUATION_V3_ROUND2_PREFREEZE_REJECTION_PATH,
  CONTINUATION_V3_ROUND,
  CONTINUATION_V3_SNAPSHOT_KIND,
  CONTINUATION_V3_WORKSTREAM_ID,
  hashCanonical,
  repositoryPathV3,
  selectLifecycleProfileV3,
  sha256Bytes,
  sha256DigestV3,
  validateBaselineArchiveV3,
  validateContinuationPolicyV3,
  validateLifecycleStateV3,
  validateReviewSnapshotV3,
} from "./conversation-disclosure-continuation-contract-v3.mjs";

const PROGRAM_PATH = ".zerox/conversation-disclosure-program.json";
const FEATURE_LIST_PATH = ".zerox/feature_list.json";
const REVIEW_PHASE = "review_pre_transition";
const PRIVATE_MODE = 0o600;

export class FreezeV3Failure extends Error {
  constructor(errors) {
    const uniqueErrors = [...new Set(Array.isArray(errors) ? errors : [errors])];
    super(uniqueErrors.join("\n"));
    this.name = "FreezeV3Failure";
    this.errors = uniqueErrors;
  }
}

export function parseContinuationFreezeOptionsV3(argv) {
  const options = { expectedPolicyDigest: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument !== "--expected-policy-digest") {
      throw new FreezeV3Failure(`unknown continuation freeze option: ${argument}`);
    }
    if (options.expectedPolicyDigest !== undefined) {
      throw new FreezeV3Failure("--expected-policy-digest must be supplied exactly once");
    }
    options.expectedPolicyDigest = argv[index + 1];
    index += 1;
  }
  if (!sha256DigestV3(options.expectedPolicyDigest)) {
    throw new FreezeV3Failure(
      "continuation freeze requires one caller-pinned --expected-policy-digest",
    );
  }
  return options;
}

export function assertFrozenAtV3(frozenAt, verifierNow) {
  if (!Number.isFinite(verifierNow)) {
    throw new FreezeV3Failure("continuation freeze requires one finite verifierNow");
  }
  const parsed = typeof frozenAt === "string" ? Date.parse(frozenAt) : Number.NaN;
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== frozenAt) {
    throw new FreezeV3Failure("continuation snapshot frozenAt must be canonical ISO time");
  }
  if (parsed > verifierNow) {
    throw new FreezeV3Failure("continuation snapshot frozenAt must not be in the future");
  }
}

export function classifyAdmissionFilesV3(policy, frozenPaths) {
  const files = policy?.admission?.featureDefinition?.files;
  if (!Array.isArray(files) || files.length === 0
    || new Set(files).size !== files.length
    || files.some((entry) => !repositoryPathV3(entry))) {
    throw new FreezeV3Failure("P107A exact file roster is invalid");
  }
  const frozen = frozenPaths instanceof Set ? frozenPaths : new Set(frozenPaths ?? []);
  const featureSet = new Set(files);
  const coverage = Array.isArray(policy?.admissionCoverage)
    ? policy.admissionCoverage.map((entry) => ({ ...entry }))
    : [];
  const byClass = {
    frozen_file: [],
    transition_live: [],
    transition_payload: [],
    post_review_mutable: [],
    review_output_absent: [],
    rejected_output_absent: [],
  };
  const errors = [];
  if (coverage.length !== files.length
    || coverage.some((entry, index) => entry?.path !== [...files].sort()[index]
      || !Object.hasOwn(byClass, entry?.class))
    || new Set(coverage.map((entry) => entry.path)).size !== files.length
    || coverage.some((entry) => !featureSet.has(entry.path))) {
    errors.push("policy admissionCoverage must exactly classify the sorted P107A file roster");
  }
  for (const entry of coverage) {
    if (Object.hasOwn(byClass, entry?.class)) byClass[entry.class].push(entry.path);
  }
  for (const values of Object.values(byClass)) values.sort();
  if (policy.admission?.reviewCoverageDigest !== hashCanonical(coverage)) {
    errors.push("P107A reviewCoverageDigest does not bind policy.admissionCoverage");
  }
  const expectedFrozen = new Set(byClass.frozen_file);
  if (frozen.size !== expectedFrozen.size
    || [...frozen].some((relativePath) => !expectedFrozen.has(relativePath))) {
    errors.push("observed frozen admission files differ from policy.admissionCoverage");
  }
  if (errors.length > 0) throw new FreezeV3Failure(errors);
  return { coverage, byClass };
}

export async function captureStableRepositoryFileV3(
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
    throw new FreezeV3Failure(`${label} is missing or inaccessible: ${error.code ?? "error"}`);
  }
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n) {
    throw new FreezeV3Failure(
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
      throw new FreezeV3Failure(`${label} size changed while reading`);
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

export async function captureAbsentRepositoryPathV3(
  repositoryRealpath,
  relativePath,
  label = relativePath,
) {
  requireRepositoryPath(relativePath, label);
  const parents = await captureParentRoster(repositoryRealpath, relativePath, label);
  const absolutePath = path.join(repositoryRealpath, relativePath);
  try {
    await lstat(absolutePath, { bigint: true });
    throw new FreezeV3Failure(`${label} must be absent before continuation freeze`);
  } catch (error) {
    if (error instanceof FreezeV3Failure) throw error;
    if (error?.code !== "ENOENT") {
      throw new FreezeV3Failure(`${label} absence cannot be established`);
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

export async function postflightFreezeCapturesV3(captures) {
  for (const capture of captures) {
    if (capture.kind === "absent") {
      await assertParentRoster(capture.parents, capture.label);
      try {
        await lstat(capture.absolutePath, { bigint: true });
        throw new FreezeV3Failure(`${capture.label} appeared before publication`);
      } catch (error) {
        if (error instanceof FreezeV3Failure) throw error;
        if (error?.code !== "ENOENT") {
          throw new FreezeV3Failure(`${capture.label} absence changed before publication`);
        }
      }
      continue;
    }
    const current = await captureStableRepositoryFileV3(
      capture.repositoryRealpath,
      capture.relativePath,
      capture.label,
    );
    if (!sameIdentity(current.identity, capture.identity)
      || current.digest !== capture.digest
      || current.mode !== capture.mode
      || !current.bytes.equals(capture.bytes)) {
      throw new FreezeV3Failure(`${capture.label} changed before freeze postflight`);
    }
  }
}

export async function publishPrivateNoReplaceV3(
  repositoryRealpath,
  relativePath,
  bytes,
) {
  requireRepositoryPath(relativePath, relativePath);
  if (!Buffer.isBuffer(bytes)) {
    throw new FreezeV3Failure("continuation snapshot publication requires Buffer bytes");
  }
  const absolutePath = path.join(repositoryRealpath, relativePath);
  try {
    const existing = await captureStableRepositoryFileV3(
      repositoryRealpath,
      relativePath,
      "existing continuation snapshot",
    );
    if (!existing.bytes.equals(bytes) || existing.mode !== PRIVATE_MODE) {
      throw new FreezeV3Failure(
        "existing continuation snapshot has third-state bytes or permissions",
      );
    }
    return { status: "idempotent", digest: existing.digest };
  } catch (error) {
    if (!(error instanceof FreezeV3Failure)
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
        throw new FreezeV3Failure(
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
    const published = await captureStableRepositoryFileV3(
      repositoryRealpath,
      relativePath,
      "published continuation snapshot",
    );
    if (!published.bytes.equals(bytes) || published.mode !== PRIVATE_MODE) {
      throw new FreezeV3Failure("continuation snapshot atomic publication verification failed");
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

export async function runContinuationFreezeV3(argv, runtime = {}) {
  const options = parseContinuationFreezeOptionsV3(argv);
  const requestedRoot = path.resolve(runtime.cwd ?? process.cwd());
  const repositoryRealpath = await realpath(requestedRoot);
  if (repositoryRealpath !== requestedRoot) {
    throw new FreezeV3Failure("continuation freeze cwd must be the canonical repository path");
  }
  const verifierNow = runtime.verifierNow ?? Date.now();
  if (!Number.isFinite(verifierNow)) {
    throw new FreezeV3Failure("continuation freeze verifierNow is invalid");
  }
  const captures = [];
  const captureByPath = new Map();
  const capture = async (relativePath, label) => {
    if (captureByPath.has(relativePath)) return captureByPath.get(relativePath);
    const value = await captureStableRepositoryFileV3(
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
      throw new FreezeV3Failure(`${label} overlaps a required present capture`);
    }
    const value = await captureAbsentRepositoryPathV3(
      repositoryRealpath,
      relativePath,
      label,
    );
    captures.push(value);
    return value;
  };

  const policyCapture = await capture(CONTINUATION_V3_POLICY_PATH, "continuation policy v3");
  const archiveCapture = await capture(
    CONTINUATION_V3_BASELINE_ARCHIVE_PATH,
    "continuation baseline archive v3",
  );
  const programCapture = await capture(PROGRAM_PATH, "conversation disclosure program");
  const featureListCapture = await capture(FEATURE_LIST_PATH, "Feature list");
  const policy = parseCapturedJson(policyCapture);
  const archive = parseCapturedJson(archiveCapture);
  const program = parseCapturedJson(programCapture);
  const featureList = parseCapturedJson(featureListCapture);

  requireNoErrors("policy", validateContinuationPolicyV3(policy, {
    expectedDigest: options.expectedPolicyDigest,
    baselineArchive: archive,
  }));
  requireNoErrors("archive", validateBaselineArchiveV3(archive, policy));
  if (policy.programId !== program?.programId) {
    throw new FreezeV3Failure("program identity differs from continuation policy");
  }
  const lifecycleProfile = selectLifecycleProfileV3(policy, REVIEW_PHASE);
  if (!lifecycleProfile) {
    throw new FreezeV3Failure("continuation policy lacks review_pre_transition profile");
  }
  const liveLifecycle = {
    phase: REVIEW_PHASE,
    activeFeatureId: program?.activeFeatureId,
    nextFeatureId: program?.nextFeatureId,
    workstreams: program?.workstreams,
    features: featureList?.features,
  };
  requireNoErrors("review_pre lifecycle", validateLifecycleStateV3(liveLifecycle, policy));
  const admissionFeature = liveLifecycle.features.find(
    (entry) => entry?.id === CONTINUATION_V3_FEATURE_ID,
  );
  const admissionWorkstream = liveLifecycle.workstreams.find(
    (entry) => entry?.id === CONTINUATION_V3_WORKSTREAM_ID,
  );
  requireNoErrors("policy live binding", validateContinuationPolicyV3(policy, {
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
      throw new FreezeV3Failure(`Round1 rejection evidence drift: ${reference.path}`);
    }
  }
  const round1ForbiddenAbsentPaths = new Set();
  for (const relativePath of policy.round1Rejection.forbiddenRepositoryOutputs) {
    await captureAbsence(relativePath, `forbidden Round1 output ${relativePath}`);
    round1ForbiddenAbsentPaths.add(relativePath);
  }
  const round2Witness = policy.round2PrefreezeRejection;
  const witnessCapture = await capture(
    CONTINUATION_V3_ROUND2_PREFREEZE_REJECTION_PATH,
    "Round2 deterministic rejection witness",
  );
  const expectedWitnessBytes = Buffer.from(
    `${JSON.stringify(round2Witness, null, 2)}\n`,
    "utf8",
  );
  if (!witnessCapture.bytes.equals(expectedWitnessBytes)
    || witnessCapture.mode !== PRIVATE_MODE) {
    throw new FreezeV3Failure(
      "Round2 deterministic rejection witness bytes/mode differ from policy",
    );
  }
  const round2References = [
    round2Witness.sourcePolicy,
    round2Witness.baselineArchive,
    ...round2Witness.continuationExecutables,
    ...round2Witness.liveTransitionFiles,
    ...round2Witness.transitionPayloadFiles,
  ];
  for (const reference of round2References) {
    const current = await capture(reference.path, `Round2 rejection witness ${reference.path}`);
    const expectedDigest = reference.byteSha256 ?? reference.sha256;
    if (current.digest !== expectedDigest) {
      throw new FreezeV3Failure(`Round2 rejection witness drift: ${reference.path}`);
    }
  }
  const round2VerifiedAbsentPaths = new Set(round2Witness.verifiedAbsentPaths);

  const transitionLivePaths = new Set(policy.governanceTransitions
    .map((entry) => entry.path));
  const transitionTargetPaths = new Set(policy.governanceTransitions
    .map((entry) => entry.stagedTargetPath));
  const postReviewMutablePaths = new Set(policy.admission.postReviewMutablePaths);
  const reviewOutputPaths = new Set(policy.admission.reviewOutputPaths);
  const authoritativeClassByPath = new Map(
    policy.admissionCoverage.map((entry) => [entry.path, entry.class]),
  );
  const frozenAdmissionPaths = new Set();
  for (const relativePath of policy.admission.featureDefinition.files) {
    if (authoritativeClassByPath.get(relativePath) === "frozen_file") {
      try {
        await capture(relativePath, `P107A frozen file ${relativePath}`);
      } catch (error) {
        throw new FreezeV3Failure(
          `P107A path has no valid frozen_file capture: ${relativePath}: ${error.message}`,
        );
      }
      frozenAdmissionPaths.add(relativePath);
    }
  }
  const admissionCoverage = classifyAdmissionFilesV3(policy, frozenAdmissionPaths);
  if (admissionCoverage.byClass.transition_live.some(
    (relativePath) => !transitionLivePaths.has(relativePath),
  ) || admissionCoverage.byClass.transition_payload.some(
    (relativePath) => !transitionTargetPaths.has(relativePath),
  ) || admissionCoverage.byClass.post_review_mutable.some(
    (relativePath) => !postReviewMutablePaths.has(relativePath),
  ) || admissionCoverage.byClass.review_output_absent.some(
    (relativePath) => !reviewOutputPaths.has(relativePath),
  ) || admissionCoverage.byClass.rejected_output_absent.length
      !== round2VerifiedAbsentPaths.size
    || admissionCoverage.byClass.rejected_output_absent.some(
      (relativePath) => !round2VerifiedAbsentPaths.has(relativePath),
  )) {
    throw new FreezeV3Failure("policy admissionCoverage conflicts with its bound declarations");
  }
  for (const relativePath of admissionCoverage.byClass.rejected_output_absent) {
    await captureAbsence(relativePath, `verified absent Round2 output ${relativePath}`);
  }

  let existingSnapshot = null;
  for (const relativePath of [...reviewOutputPaths].sort()) {
    if (relativePath === CONTINUATION_V3_REVIEW_SNAPSHOT_PATH) {
      const absolutePath = path.join(repositoryRealpath, relativePath);
      try {
        await lstat(absolutePath, { bigint: true });
        existingSnapshot = await capture(relativePath, "existing continuation snapshot");
      } catch (error) {
        if (error instanceof FreezeV3Failure || error?.code !== "ENOENT") throw error;
        await captureAbsence(relativePath, "continuation snapshot output");
      }
    } else {
      await captureAbsence(relativePath, `review output ${relativePath}`);
    }
  }
  if (!reviewOutputPaths.has(CONTINUATION_V3_REVIEW_SNAPSHOT_PATH)) {
    throw new FreezeV3Failure("P107A review outputs must include the exact snapshot path");
  }

  const frozenFiles = new Map();
  for (const relativePath of admissionCoverage.byClass.frozen_file) {
    const entry = await capture(relativePath, `P107A frozen file ${relativePath}`);
    frozenFiles.set(relativePath, entry.digest);
  }
  const transitionPayloadFiles = new Map();
  for (const transition of policy.governanceTransitions) {
    const live = await capture(transition.path, `transition live ${transition.path}`);
    const staged = await capture(
      transition.stagedTargetPath,
      `transition target ${transition.stagedTargetPath}`,
    );
    if (live.digest !== transition.fromSha256) {
      throw new FreezeV3Failure(`transition live digest drift: ${transition.path}`);
    }
    if (staged.digest !== transition.toSha256) {
      throw new FreezeV3Failure(`transition target digest drift: ${transition.path}`);
    }
    transitionPayloadFiles.set(transition.stagedTargetPath, staged.digest);
  }

  const baselineFiles = new Map();
  const absentPaths = new Set([
    ...round1ForbiddenAbsentPaths,
    ...round2VerifiedAbsentPaths,
  ]);
  for (const authority of policy.pathAuthorities) {
    if (authority.class === "modify") {
      const current = await capture(authority.path, `modify baseline ${authority.path}`);
      if (current.digest !== authority.baseline.sha256) {
        throw new FreezeV3Failure(`modify baseline digest drift: ${authority.path}`);
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
          throw new FreezeV3Failure(`bookkeeping baseline digest drift: ${authority.path}`);
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
  assertFrozenAtV3(frozenAt, verifierNow);
  const snapshotWithoutDigest = {
    schemaVersion: 3,
    kind: CONTINUATION_V3_SNAPSHOT_KIND,
    algorithm: CONTINUATION_V3_ALGORITHM,
    programId: policy.programId,
    workstreamId: CONTINUATION_V3_WORKSTREAM_ID,
    featureId: CONTINUATION_V3_FEATURE_ID,
    round: CONTINUATION_V3_ROUND,
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
    transitionPayloadFiles: [...transitionPayloadFiles]
      .map(([filePath, sha256]) => ({ path: filePath, sha256 }))
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
  if (snapshot.transitionPayloadFiles.length !== 4
    || snapshot.transitionPayloadFiles.some((entry) =>
      snapshot.frozenFiles.some((frozen) => frozen.path === entry.path))) {
    throw new FreezeV3Failure(
      "snapshot transitionPayloadFiles must contain exactly four non-frozen targets",
    );
  }
  requireNoErrors("snapshot", validateReviewSnapshotV3(snapshot, policy, { verifierNow }));
  if (admissionCoverage.coverage.length
      !== policy.admission.featureDefinition.files.length) {
    throw new FreezeV3Failure("P107A review coverage is not exact-once");
  }
  const snapshotBytes = Buffer.from(`${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  if (existingSnapshot
    && (!existingSnapshot.bytes.equals(snapshotBytes)
      || existingSnapshot.mode !== PRIVATE_MODE)) {
    throw new FreezeV3Failure(
      "existing continuation snapshot has third-state bytes or permissions",
    );
  }
  await postflightFreezeCapturesV3(captures);
  const publication = existingSnapshot
    ? { status: "idempotent", digest: existingSnapshot.digest }
    : await publishPrivateNoReplaceV3(
      repositoryRealpath,
      CONTINUATION_V3_REVIEW_SNAPSHOT_PATH,
      snapshotBytes,
    );
  return {
    kind: "cd03a-continuation-freeze-v3-receipt",
    status: "passed",
    publicationStatus: publication.status,
    repositoryRealpath,
    policyDigest: policy.digest,
    baselineArchiveDigest: archive.digest,
    snapshotPath: CONTINUATION_V3_REVIEW_SNAPSHOT_PATH,
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
      throw new FreezeV3Failure(`${label} parent is missing: ${error.code ?? "error"}`);
    }
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new FreezeV3Failure(`${label} parent must not traverse aliases or symlinks`);
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
      throw new FreezeV3Failure(`${label} parent identity changed`);
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
    throw new FreezeV3Failure(message);
  }
}

function requireRepositoryPath(relativePath, label) {
  if (!repositoryPathV3(relativePath)) {
    throw new FreezeV3Failure(`${label} must use a normalized repository path`);
  }
}

function parseCapturedJson(capture) {
  try {
    return JSON.parse(capture.bytes.toString("utf8"));
  } catch {
    throw new FreezeV3Failure(`${capture.label} must contain valid JSON`);
  }
}

function requireNoErrors(subject, errors) {
  if (errors.length > 0) {
    throw new FreezeV3Failure(errors.map((error) => `${subject}: ${error}`));
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const receipt = await runContinuationFreezeV3(process.argv.slice(2));
    console.log(JSON.stringify(receipt));
  } catch (error) {
    const messages = error instanceof FreezeV3Failure
      ? error.errors
      : [error instanceof Error ? error.message : String(error)];
    for (const message of messages) console.error(`continuation freeze v3: ${message}`);
    process.exitCode = 1;
  }
}
