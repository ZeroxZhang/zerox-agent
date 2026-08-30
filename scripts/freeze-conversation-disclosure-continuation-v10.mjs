#!/usr/bin/env node

import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  CONTINUATION_V10_ADMISSION_CLASSES,
  CONTINUATION_V10_BASELINE_ARCHIVE_PATH,
  CONTINUATION_V10_POLICY_PATH,
  CONTINUATION_V10_REVIEW_SNAPSHOT_PATH,
  CONTINUATION_V10_ROUND9_REVIEW_REJECTION_PATH,
  CONTINUATION_V10_SNAPSHOT_KIND,
  CONTINUATION_V10_ALGORITHM,
  CONTINUATION_V10_FEATURE_ID,
  CONTINUATION_V10_ROUND,
  CONTINUATION_V10_WORKSTREAM_ID,
  hashCanonicalV10,
  validateBaselineArchiveV10,
  validateContinuationPolicyV10,
  validateContinuationReviewSnapshotV10,
  validateGovernanceTransitionStateV10,
  validateRound9ReviewRejectionV10,
  withCanonicalDigestV10,
} from "./conversation-disclosure-continuation-contract-v10.mjs";
import {
  capturePrivateEvidenceV10,
  captureRequiredAbsentV10,
  captureStableFileV10,
  createCaptureLedgerV10,
  postflightCaptureLedgerV10,
  publishPrivateExactV10,
} from "./conversation-disclosure-continuation-runtime-io-v10.mjs";

export async function freezeConversationDisclosureContinuationV10({
  repositoryRoot = process.cwd(),
  expectedPolicyDigest,
  frozenAt,
  outputPath = CONTINUATION_V10_REVIEW_SNAPSHOT_PATH,
} = {}) {
  const root = await canonicalRepositoryRoot(repositoryRoot);
  if (!validTimestamp(frozenAt)) {
    throw new Error("caller must supply one canonical --frozen-at timestamp");
  }
  const ledger = createCaptureLedgerV10();
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
          ? await capturePrivateEvidenceV10(absolutePath, label, {
            expectedRoot: root,
            ledger,
          })
          : await captureStableFileV10(absolutePath, label, {
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
    readJson(CONTINUATION_V10_POLICY_PATH, "Round10 policy", {
      privateEvidence: true,
    }),
    readJson(
      CONTINUATION_V10_ROUND9_REVIEW_REJECTION_PATH,
      "Round9 review-rejection witness",
      { privateEvidence: true },
    ),
    readJson(CONTINUATION_V10_BASELINE_ARCHIVE_PATH, "Round10 baseline archive", {
      privateEvidence: true,
    }),
  ]);
  assertNoErrors(validateRound9ReviewRejectionV10(rejection),
    "Round9 review-rejection witness");
  assertNoErrors(validateContinuationPolicyV10(policy, {
    expectedDigest: expectedPolicyDigest,
    baselineArchive: archive,
  }), "Round10 policy");
  assertNoErrors(validateBaselineArchiveV10(archive, policy),
    "Round10 baseline archive");

  const outputAbsolute = resolveExactOutput(root, outputPath);
  let existingSnapshot;
  try {
    await lstat(outputAbsolute);
    existingSnapshot = parseJson(
      (await capturePrivateEvidenceV10(
        outputAbsolute,
        "Round10 review snapshot",
        { expectedRoot: root, ledger },
      )).bytes,
      "Round10 review snapshot",
    );
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const byClass = new Map(
    CONTINUATION_V10_ADMISSION_CLASSES.map((entry) => [entry, []]),
  );
  for (const entry of policy.admissionCoverage) {
    byClass.get(entry.class).push(entry.path);
  }
  const frozenFiles = [];
  for (const relativePath of byClass.get("frozen_file")) {
    const privateEvidence = [
      CONTINUATION_V10_POLICY_PATH,
      CONTINUATION_V10_ROUND9_REVIEW_REJECTION_PATH,
      CONTINUATION_V10_BASELINE_ARCHIVE_PATH,
    ].includes(relativePath);
    const capture = await captureRepository(
      relativePath,
      `Round10 frozen subject ${relativePath}`,
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
        `Round10 transition live ${transition.path}`,
      ),
      captureRepository(
        transition.stagedTargetPath,
        `Round10 transition payload ${transition.stagedTargetPath}`,
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
  assertNoErrors(validateGovernanceTransitionStateV10(
    policy.governanceTransitions,
    "review_pre_transition",
    liveDigests,
    stagedDigests,
  ), "Round10 pre-transition state");

  const baselineFiles = [];
  const absentPaths = new Set();
  for (const authority of policy.pathAuthorities) {
    if (authority.class === "modify"
      && authority.baseline.source === "cd03a_review_snapshot") {
      const capture = await captureRepository(
        authority.path,
        `Round10 authority baseline ${authority.path}`,
      );
      if (capture.digest !== authority.baseline.sha256) {
        throw new Error(`Round10 authority baseline drifted: ${authority.path}`);
      }
      baselineFiles.push({ path: authority.path, sha256: capture.digest });
    } else if (authority.class === "create") {
      absentPaths.add(authority.path);
    } else if (authority.class === "bookkeeping") {
      if (authority.baseline.presence === "present") {
        const capture = await captureRepository(
          authority.path,
          `Round10 bookkeeping baseline ${authority.path}`,
        );
        if (capture.digest !== authority.baseline.sha256) {
          throw new Error(`Round10 bookkeeping baseline drifted: ${authority.path}`);
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
    await captureRequiredAbsentV10(
      path.join(root, relativePath),
      `Round10 required absence ${relativePath}`,
      { expectedRoot: root, ledger },
    );
  }
  baselineFiles.sort(comparePath);

  const reviewOutputAbsentPaths = [...byClass.get("review_output_absent")].sort();
  for (const relativePath of reviewOutputAbsentPaths) {
    if (relativePath === CONTINUATION_V10_REVIEW_SNAPSHOT_PATH
      && existingSnapshot) {
      continue;
    }
    await captureRequiredAbsentV10(
      path.join(root, relativePath),
      `Round10 review output absence ${relativePath}`,
      { expectedRoot: root, ledger },
    );
  }

  const snapshot = withCanonicalDigestV10({
    schemaVersion: 10,
    kind: CONTINUATION_V10_SNAPSHOT_KIND,
    algorithm: CONTINUATION_V10_ALGORITHM,
    programId: policy.programId,
    workstreamId: CONTINUATION_V10_WORKSTREAM_ID,
    featureId: CONTINUATION_V10_FEATURE_ID,
    round: CONTINUATION_V10_ROUND,
    frozenAt,
    parentEvidenceBundleDigest: policy.parentEvidence.bundleDigest,
    policyDigest: policy.digest,
    closedWorldDigest: policy.closedWorld.digest,
    pathAuthorityDigest: hashCanonicalV10(policy.pathAuthorities),
    admissionClassSetDigest: policy.admissionClassSetDigest,
    admissionFeatureDefinitionDigest:
      policy.admission.featureDefinitionDigest,
    admissionFeatureFileSetDigest: policy.admission.featureFileSetDigest,
    successorWorkstreamDefinitionDigest:
      policy.successor.workstreamDefinitionDigest,
    successorFeatureDefinitionDigest:
      policy.successor.featureDefinitionDigest,
    round9ReviewRejectionDigest: rejection.digest,
    baselineArchive: policy.baselineArchive,
    frozenFiles,
    transitionPayloadFiles,
    baselineFiles,
    absentPaths: [...absentPaths].sort(),
    reviewOutputAbsentPaths,
    governanceTransitions: policy.governanceTransitions,
  });
  assertNoErrors(validateContinuationReviewSnapshotV10(
    snapshot,
    policy,
    { verifierNow: Date.parse(frozenAt) },
  ), "generated Round10 review snapshot");
  const bytes = Buffer.from(`${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  if (existingSnapshot
    && !Buffer.from(`${JSON.stringify(existingSnapshot, null, 2)}\n`, "utf8")
      .equals(bytes)) {
    throw new Error("existing Round10 snapshot differs from deterministic bytes");
  }
  await postflightCaptureLedgerV10(ledger);
  const publication = await publishPrivateExactV10(outputAbsolute, bytes, {
    expectedRoot: root,
    label: "Round10 review snapshot",
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
  const expected = path.join(root, CONTINUATION_V10_REVIEW_SNAPSHOT_PATH);
  if (resolved !== expected) {
    throw new Error("--output must be the exact Round10 review snapshot path");
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
  freezeConversationDisclosureContinuationV10(
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
