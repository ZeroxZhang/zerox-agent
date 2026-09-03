#!/usr/bin/env node

import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  CONTINUATION_V4_ADMISSION_CLASSES,
  CONTINUATION_V4_BASELINE_ARCHIVE_PATH,
  CONTINUATION_V4_POLICY_PATH,
  CONTINUATION_V4_REVIEW_SNAPSHOT_PATH,
  CONTINUATION_V4_ROUND3_REVIEW_REJECTION_PATH,
  CONTINUATION_V4_SNAPSHOT_KIND,
  CONTINUATION_V4_ALGORITHM,
  CONTINUATION_V4_FEATURE_ID,
  CONTINUATION_V4_ROUND,
  CONTINUATION_V4_WORKSTREAM_ID,
  hashCanonicalV4,
  validateBaselineArchiveV4,
  validateContinuationPolicyV4,
  validateContinuationReviewSnapshotV4,
  validateGovernanceTransitionStateV4,
  validateRound3ReviewRejectionV4,
  withCanonicalDigestV4,
} from "./conversation-disclosure-continuation-contract-v4.mjs";
import {
  capturePrivateEvidenceV4,
  captureRequiredAbsentV4,
  captureStableFileV4,
  createCaptureLedgerV4,
  postflightCaptureLedgerV4,
  publishPrivateExactV4,
} from "./conversation-disclosure-continuation-runtime-io-v4.mjs";

export async function freezeConversationDisclosureContinuationV4({
  repositoryRoot = process.cwd(),
  expectedPolicyDigest,
  frozenAt,
  outputPath = CONTINUATION_V4_REVIEW_SNAPSHOT_PATH,
} = {}) {
  const root = await canonicalRepositoryRoot(repositoryRoot);
  if (!validTimestamp(frozenAt)) {
    throw new Error("caller must supply one canonical --frozen-at timestamp");
  }
  const ledger = createCaptureLedgerV4();
  const captures = new Map();
  const captureRepository = async (
    relativePath,
    label = relativePath,
    { privateEvidence = false } = {},
  ) => {
    if (!captures.has(relativePath)) {
      const absolutePath = path.join(root, relativePath);
      captures.set(
        relativePath,
        privateEvidence
          ? await capturePrivateEvidenceV4(absolutePath, label, {
            expectedRoot: root,
            ledger,
          })
          : await captureStableFileV4(absolutePath, label, {
            expectedRoot: root,
            ledger,
          }),
      );
    }
    return captures.get(relativePath);
  };
  const readJson = async (relativePath, label, options) =>
    parseJson((await captureRepository(relativePath, label, options)).bytes, label);

  const [policy, rejection, archive] = await Promise.all([
    readJson(CONTINUATION_V4_POLICY_PATH, "Round4 policy", {
      privateEvidence: true,
    }),
    readJson(
      CONTINUATION_V4_ROUND3_REVIEW_REJECTION_PATH,
      "Round3 review-rejection witness",
      { privateEvidence: true },
    ),
    readJson(CONTINUATION_V4_BASELINE_ARCHIVE_PATH, "Round4 baseline archive", {
      privateEvidence: true,
    }),
  ]);
  assertNoErrors(validateRound3ReviewRejectionV4(rejection),
    "Round3 review-rejection witness");
  assertNoErrors(validateContinuationPolicyV4(policy, {
    expectedDigest: expectedPolicyDigest,
    baselineArchive: archive,
  }), "Round4 policy");
  assertNoErrors(validateBaselineArchiveV4(archive, policy),
    "Round4 baseline archive");

  const outputAbsolute = resolveExactOutput(root, outputPath);
  let existingSnapshot;
  try {
    await lstat(outputAbsolute);
    existingSnapshot = parseJson(
      (await capturePrivateEvidenceV4(
        outputAbsolute,
        "Round4 review snapshot",
        { expectedRoot: root, ledger },
      )).bytes,
      "Round4 review snapshot",
    );
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const byClass = new Map(
    CONTINUATION_V4_ADMISSION_CLASSES.map((entry) => [entry, []]),
  );
  for (const entry of policy.admissionCoverage) {
    byClass.get(entry.class).push(entry.path);
  }
  const frozenFiles = [];
  for (const relativePath of byClass.get("frozen_file")) {
    const privateEvidence = [
      CONTINUATION_V4_POLICY_PATH,
      CONTINUATION_V4_ROUND3_REVIEW_REJECTION_PATH,
      CONTINUATION_V4_BASELINE_ARCHIVE_PATH,
    ].includes(relativePath);
    const capture = await captureRepository(
      relativePath,
      `Round4 frozen subject ${relativePath}`,
      { privateEvidence },
    );
    frozenFiles.push({ path: relativePath, sha256: capture.digest });
  }
  frozenFiles.sort(comparePath);

  const transitionPayloadFiles = [];
  const liveDigests = new Map();
  const stagedDigests = new Map();
  for (const transition of policy.governanceTransitions) {
    const [live, payload] = await Promise.all([
      captureRepository(
        transition.path,
        `Round4 transition live ${transition.path}`,
      ),
      captureRepository(
        transition.stagedTargetPath,
        `Round4 transition payload ${transition.stagedTargetPath}`,
      ),
    ]);
    liveDigests.set(transition.path, live.digest);
    stagedDigests.set(transition.stagedTargetPath, payload.digest);
    transitionPayloadFiles.push({
      path: transition.stagedTargetPath,
      sha256: payload.digest,
    });
  }
  transitionPayloadFiles.sort(comparePath);
  assertNoErrors(validateGovernanceTransitionStateV4(
    policy.governanceTransitions,
    "review_pre_transition",
    liveDigests,
    stagedDigests,
  ), "Round4 pre-transition state");

  const baselineFiles = [];
  const absentPaths = new Set();
  for (const authority of policy.pathAuthorities) {
    if (authority.class === "modify"
      && authority.baseline.source === "cd03a_review_snapshot") {
      const capture = await captureRepository(
        authority.path,
        `Round4 authority baseline ${authority.path}`,
      );
      if (capture.digest !== authority.baseline.sha256) {
        throw new Error(`Round4 authority baseline drifted: ${authority.path}`);
      }
      baselineFiles.push({ path: authority.path, sha256: capture.digest });
    } else if (authority.class === "create") {
      absentPaths.add(authority.path);
    } else if (authority.class === "bookkeeping") {
      if (authority.baseline.presence === "present") {
        const capture = await captureRepository(
          authority.path,
          `Round4 bookkeeping baseline ${authority.path}`,
        );
        if (capture.digest !== authority.baseline.sha256) {
          throw new Error(`Round4 bookkeeping baseline drifted: ${authority.path}`);
        }
        baselineFiles.push({ path: authority.path, sha256: capture.digest });
      } else {
        absentPaths.add(authority.path);
      }
    }
  }
  for (const relativePath of byClass.get("rejected_output_absent")) {
    absentPaths.add(relativePath);
  }
  for (const relativePath of [...absentPaths].sort()) {
    await captureRequiredAbsentV4(
      path.join(root, relativePath),
      `Round4 required absence ${relativePath}`,
      { expectedRoot: root, ledger },
    );
  }
  baselineFiles.sort(comparePath);

  const reviewOutputAbsentPaths = [...byClass.get("review_output_absent")].sort();
  for (const relativePath of reviewOutputAbsentPaths) {
    if (relativePath === CONTINUATION_V4_REVIEW_SNAPSHOT_PATH
      && existingSnapshot) {
      continue;
    }
    await captureRequiredAbsentV4(
      path.join(root, relativePath),
      `Round4 review output absence ${relativePath}`,
      { expectedRoot: root, ledger },
    );
  }

  const snapshot = withCanonicalDigestV4({
    schemaVersion: 4,
    kind: CONTINUATION_V4_SNAPSHOT_KIND,
    algorithm: CONTINUATION_V4_ALGORITHM,
    programId: policy.programId,
    workstreamId: CONTINUATION_V4_WORKSTREAM_ID,
    featureId: CONTINUATION_V4_FEATURE_ID,
    round: CONTINUATION_V4_ROUND,
    frozenAt,
    parentEvidenceBundleDigest: policy.parentEvidence.bundleDigest,
    policyDigest: policy.digest,
    closedWorldDigest: policy.closedWorld.digest,
    pathAuthorityDigest: hashCanonicalV4(policy.pathAuthorities),
    admissionClassSetDigest: policy.admissionClassSetDigest,
    admissionFeatureDefinitionDigest:
      policy.admission.featureDefinitionDigest,
    admissionFeatureFileSetDigest: policy.admission.featureFileSetDigest,
    successorWorkstreamDefinitionDigest:
      policy.successor.workstreamDefinitionDigest,
    successorFeatureDefinitionDigest:
      policy.successor.featureDefinitionDigest,
    round3ReviewRejectionDigest: rejection.digest,
    baselineArchive: policy.baselineArchive,
    frozenFiles,
    transitionPayloadFiles,
    baselineFiles,
    absentPaths: [...absentPaths].sort(),
    reviewOutputAbsentPaths,
    governanceTransitions: policy.governanceTransitions,
  });
  assertNoErrors(validateContinuationReviewSnapshotV4(
    snapshot,
    policy,
    { verifierNow: Date.parse(frozenAt) },
  ), "generated Round4 review snapshot");
  const bytes = Buffer.from(`${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  if (existingSnapshot
    && !Buffer.from(`${JSON.stringify(existingSnapshot, null, 2)}\n`, "utf8")
      .equals(bytes)) {
    throw new Error("existing Round4 snapshot differs from deterministic bytes");
  }
  await postflightCaptureLedgerV4(ledger);
  const publication = await publishPrivateExactV4(outputAbsolute, bytes, {
    expectedRoot: root,
    label: "Round4 review snapshot",
  });
  return {
    snapshot,
    bytes,
    publicationStatus: publication.status,
    captureCount: ledger.entries.length,
  };
}

async function canonicalRepositoryRoot(candidate) {
  const resolved = path.resolve(candidate);
  const canonical = await realpath(resolved);
  if (canonical !== resolved) {
    throw new Error("repository root must be canonical");
  }
  return canonical;
}

function resolveExactOutput(root, outputPath) {
  const resolved = path.resolve(root, outputPath);
  const expected = path.join(root, CONTINUATION_V4_REVIEW_SNAPSHOT_PATH);
  if (resolved !== expected) {
    throw new Error("--output must be the exact Round4 review snapshot path");
  }
  return resolved;
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

function assertNoErrors(errors, label) {
  if (errors.length > 0) {
    throw new Error(`${label} is invalid: ${errors.join("; ")}`);
  }
}

function validTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function comparePath(left, right) {
  return left.path.localeCompare(right.path);
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => argv[++index];
    if (argument === "--repository-root") options.repositoryRoot = value();
    else if (argument === "--expected-policy-digest") {
      options.expectedPolicyDigest = value();
    } else if (argument === "--frozen-at") options.frozenAt = value();
    else if (argument === "--output") options.outputPath = value();
    else throw new Error(`unknown argument: ${argument}`);
  }
  return options;
}

if (process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  freezeConversationDisclosureContinuationV4(
    parseArguments(process.argv.slice(2)),
  ).then(({ snapshot, publicationStatus, captureCount }) => {
    process.stdout.write(`${JSON.stringify({
      status: "passed",
      snapshotDigest: snapshot.digest,
      publicationStatus,
      captureCount,
    })}\n`);
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
