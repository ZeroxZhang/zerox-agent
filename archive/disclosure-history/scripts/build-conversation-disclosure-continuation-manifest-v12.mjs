#!/usr/bin/env node

import { realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  CONTINUATION_V12_CLOSURE_MANIFEST_PATH,
  CONTINUATION_V12_EXTERNAL_ATTESTATION_PATH,
  CONTINUATION_V12_FEATURE_ID,
  CONTINUATION_V12_MANIFEST_KIND,
  CONTINUATION_V12_POLICY_PATH,
  CONTINUATION_V12_REVIEW_LANES,
  CONTINUATION_V12_REVIEW_SNAPSHOT_PATH,
  CONTINUATION_V12_ROUND,
  CONTINUATION_V12_ROUND11_REVIEW_REJECTION_PATH,
  CONTINUATION_V12_WORKSTREAM_ID,
  hashCanonicalV12,
  pendingManifestDigestV12,
  sha256DigestV12,
  validateContinuationClosureManifestV12,
  validateContinuationPolicyV12,
  validateContinuationReviewSetV12,
  validateContinuationReviewSnapshotV12,
  validateRound11ReviewRejectionV12,
  withCanonicalDigestV12,
} from "./conversation-disclosure-continuation-contract-v12.mjs";
import {
  capturePrivateEvidenceV12,
  captureStableFileV12,
  createCaptureLedgerV12,
  postflightCaptureLedgerV12,
  publishPrivateExactV12,
} from "./conversation-disclosure-continuation-runtime-io-v12.mjs";

const CHECKER_PATH = "scripts/check-conversation-disclosure-continuation-v12.mjs";
const RUNNER_PATH = "scripts/verify-conversation-disclosure-continuation-v12.mjs";

export async function buildConversationDisclosureContinuationManifestV12({
  repositoryRoot = process.cwd(),
  dispatchSetPath,
  expectedDispatchSetDigest,
  expectedPolicyDigest,
  expectedSnapshotDigest,
  outputPath,
  verifierNow = Date.now(),
} = {}) {
  const root = await canonicalRepositoryRoot(repositoryRoot);
  if (!path.isAbsolute(dispatchSetPath ?? "")
    || !sha256DigestV12(expectedDispatchSetDigest)
    || !sha256DigestV12(expectedPolicyDigest)
    || !sha256DigestV12(expectedSnapshotDigest)) {
    throw new Error(
      "caller must pin dispatch set, policy, and snapshot digests",
    );
  }
  const canonicalDispatchPath = await realpath(dispatchSetPath);
  if (canonicalDispatchPath !== dispatchSetPath
    || isWithin(root, canonicalDispatchPath)) {
    throw new Error("dispatch set must be canonical and repository-external");
  }

  const ledger = createCaptureLedgerV12();
  const captureRepository = (relativePath, label, privateEvidence = false) => {
    const absolutePath = path.join(root, relativePath);
    return privateEvidence
      ? capturePrivateEvidenceV12(absolutePath, label, {
        expectedRoot: root,
        ledger,
      })
      : captureStableFileV12(absolutePath, label, {
        expectedRoot: root,
        ledger,
      });
  };
  const readRepositoryJson = async (relativePath, label, privateEvidence) =>
    parseJson(
      (await captureRepository(relativePath, label, privateEvidence)).bytes,
      label,
    );
  const dispatchSet = parseJson(
    (await capturePrivateEvidenceV12(
      canonicalDispatchPath,
      "Round12 caller dispatch set",
      { ledger },
    )).bytes,
    "Round12 caller dispatch set",
  );
  if (!Array.isArray(dispatchSet)
    || hashCanonicalV12(dispatchSet) !== expectedDispatchSetDigest) {
    throw new Error("caller dispatch set differs from its pinned digest");
  }

  const [policy, snapshot, rejection] = await Promise.all([
    readRepositoryJson(CONTINUATION_V12_POLICY_PATH, "Round12 policy", true),
    readRepositoryJson(
      CONTINUATION_V12_REVIEW_SNAPSHOT_PATH,
      "Round12 review snapshot",
      true,
    ),
    readRepositoryJson(
      CONTINUATION_V12_ROUND11_REVIEW_REJECTION_PATH,
      "Round11 review-rejection witness",
      true,
    ),
  ]);
  assertNoErrors(validateRound11ReviewRejectionV12(rejection),
    "Round11 review-rejection witness");
  assertNoErrors(validateContinuationPolicyV12(policy, {
    expectedDigest: expectedPolicyDigest,
  }), "Round12 policy");
  assertNoErrors(validateContinuationReviewSnapshotV12(snapshot, policy, {
    verifierNow: Date.now(),
  }), "Round12 review snapshot");
  if (snapshot.digest !== expectedSnapshotDigest) {
    throw new Error("Round12 snapshot differs from caller pin");
  }

  const receipts = [];
  const receiptReferences = [];
  for (const lane of CONTINUATION_V12_REVIEW_LANES) {
    const relativePath =
      `.zerox/verification/conversation-disclosure/CD03A-round12-${lane}-review.json`;
    const receipt = await readRepositoryJson(
      relativePath,
      `Round12 ${lane} review receipt`,
      true,
    );
    receipts.push(receipt);
    receiptReferences.push({
      lane,
      path: relativePath,
      challenge: receipt.challenge,
      canonicalDigest: hashCanonicalV12(receipt),
    });
  }
  assertNoErrors(validateContinuationReviewSetV12(
    receipts,
    dispatchSet,
    snapshot,
    policy,
    { verifierNow },
  ), "Round12 review set");

  const [policyCapture, snapshotCapture, rejectionCapture, checkerCapture,
    runnerCapture] = await Promise.all([
    captureRepository(CONTINUATION_V12_POLICY_PATH, "Round12 policy", true),
    captureRepository(
      CONTINUATION_V12_REVIEW_SNAPSHOT_PATH,
      "Round12 review snapshot",
      true,
    ),
    captureRepository(
      CONTINUATION_V12_ROUND11_REVIEW_REJECTION_PATH,
      "Round11 review-rejection witness",
      true,
    ),
    captureRepository(CHECKER_PATH, "Round12 checker"),
    captureRepository(RUNNER_PATH, "Round12 external runner"),
  ]);
  const manifestBase = {
    schemaVersion: 12,
    kind: CONTINUATION_V12_MANIFEST_KIND,
    programId: policy.programId,
    workstreamId: CONTINUATION_V12_WORKSTREAM_ID,
    featureId: CONTINUATION_V12_FEATURE_ID,
    round: CONTINUATION_V12_ROUND,
    status: "review_passed_pending_external_transaction",
    parentEvidenceBundleDigest: policy.parentEvidence.bundleDigest,
    policy: {
      path: CONTINUATION_V12_POLICY_PATH,
      byteSha256: policyCapture.digest,
      canonicalDigest: policy.digest,
    },
    snapshot: {
      path: CONTINUATION_V12_REVIEW_SNAPSHOT_PATH,
      byteSha256: snapshotCapture.digest,
      canonicalDigest: snapshot.digest,
    },
    round11ReviewRejection: {
      path: CONTINUATION_V12_ROUND11_REVIEW_REJECTION_PATH,
      byteSha256: rejectionCapture.digest,
      canonicalDigest: rejection.digest,
    },
    reviewReceipts: receiptReferences,
    callerDispatchSet: dispatchSet,
    validator: { path: CHECKER_PATH, sha256: checkerCapture.digest },
    externalRunner: { path: RUNNER_PATH, sha256: runnerCapture.digest },
    externalAttestation: {
      path: CONTINUATION_V12_EXTERNAL_ATTESTATION_PATH,
      canonicalDigest: null,
    },
  };
  const pendingManifestDigest = pendingManifestDigestV12(manifestBase);
  const manifest = withCanonicalDigestV12({
    ...manifestBase,
    pendingManifestDigest,
  });
  assertNoErrors(validateContinuationClosureManifestV12(manifest, {
    policy,
    policyReference: manifest.policy,
    snapshotReference: manifest.snapshot,
    round11ReviewRejectionReference: manifest.round11ReviewRejection,
    reviewReferences: manifest.reviewReceipts,
    callerDispatchSet: dispatchSet,
    validatorReference: manifest.validator,
    runnerReference: manifest.externalRunner,
  }), "generated Round12 pending manifest");
  const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await postflightCaptureLedgerV12(ledger);

  let publicationStatus = "not_requested";
  if (outputPath !== undefined) {
    publicationStatus = (await publishPrivateExactV12(
      resolveExactOutput(root, outputPath),
      bytes,
      { expectedRoot: root, label: "Round12 pending manifest" },
    )).status;
  }
  return {
    manifest,
    bytes,
    publicationStatus,
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
  const expected = path.join(root, CONTINUATION_V12_CLOSURE_MANIFEST_PATH);
  if (resolved !== expected) {
    throw new Error("--output must be the exact Round12 closure manifest path");
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

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === ""
    || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => argv[++index];
    if (argument === "--repository-root") options.repositoryRoot = value();
    else if (argument === "--dispatch-set") options.dispatchSetPath = value();
    else if (argument === "--expected-dispatch-set-digest") {
      options.expectedDispatchSetDigest = value();
    } else if (argument === "--expected-policy-digest") {
      options.expectedPolicyDigest = value();
    } else if (argument === "--expected-snapshot-digest") {
      options.expectedSnapshotDigest = value();
    } else if (argument === "--output") options.outputPath = value();
    else throw new Error(`unknown argument: ${argument}`);
  }
  return options;
}

if (process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  buildConversationDisclosureContinuationManifestV12(
    parseArguments(process.argv.slice(2)),
  ).then(({ manifest, publicationStatus, captureCount }) => {
    process.stdout.write(`${JSON.stringify({
      status: "passed",
      manifestDigest: manifest.digest,
      pendingManifestDigest: manifest.pendingManifestDigest,
      publicationStatus,
      captureCount,
    })}\n`);
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
