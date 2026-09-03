#!/usr/bin/env node

import { realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  CONTINUATION_V7_CLOSURE_MANIFEST_PATH,
  CONTINUATION_V7_EXTERNAL_ATTESTATION_PATH,
  CONTINUATION_V7_FEATURE_ID,
  CONTINUATION_V7_MANIFEST_KIND,
  CONTINUATION_V7_POLICY_PATH,
  CONTINUATION_V7_REVIEW_LANES,
  CONTINUATION_V7_REVIEW_SNAPSHOT_PATH,
  CONTINUATION_V7_ROUND,
  CONTINUATION_V7_ROUND6_REVIEW_REJECTION_PATH,
  CONTINUATION_V7_WORKSTREAM_ID,
  hashCanonicalV7,
  pendingManifestDigestV7,
  sha256DigestV7,
  validateContinuationClosureManifestV7,
  validateContinuationPolicyV7,
  validateContinuationReviewSetV7,
  validateContinuationReviewSnapshotV7,
  validateRound6ReviewRejectionV7,
  withCanonicalDigestV7,
} from "./conversation-disclosure-continuation-contract-v7.mjs";
import {
  capturePrivateEvidenceV7,
  captureStableFileV7,
  createCaptureLedgerV7,
  postflightCaptureLedgerV7,
  publishPrivateExactV7,
} from "./conversation-disclosure-continuation-runtime-io-v7.mjs";

const CHECKER_PATH = "scripts/check-conversation-disclosure-continuation-v7.mjs";
const RUNNER_PATH = "scripts/verify-conversation-disclosure-continuation-v7.mjs";

export async function buildConversationDisclosureContinuationManifestV7({
  repositoryRoot = process.cwd(),
  dispatchSetPath,
  expectedDispatchSetDigest,
  expectedPolicyDigest,
  expectedSnapshotDigest,
  outputPath,
} = {}) {
  const root = await canonicalRepositoryRoot(repositoryRoot);
  if (!path.isAbsolute(dispatchSetPath ?? "")
    || !sha256DigestV7(expectedDispatchSetDigest)
    || !sha256DigestV7(expectedPolicyDigest)
    || !sha256DigestV7(expectedSnapshotDigest)) {
    throw new Error(
      "caller must pin dispatch set, policy, and snapshot digests",
    );
  }
  const canonicalDispatchPath = await realpath(dispatchSetPath);
  if (canonicalDispatchPath !== dispatchSetPath
    || isWithin(root, canonicalDispatchPath)) {
    throw new Error("dispatch set must be canonical and repository-external");
  }

  const ledger = createCaptureLedgerV7();
  const captureRepository = (relativePath, label, privateEvidence = false) => {
    const absolutePath = path.join(root, relativePath);
    return privateEvidence
      ? capturePrivateEvidenceV7(absolutePath, label, {
        expectedRoot: root,
        ledger,
      })
      : captureStableFileV7(absolutePath, label, {
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
    (await capturePrivateEvidenceV7(
      canonicalDispatchPath,
      "Round7 caller dispatch set",
      { ledger },
    )).bytes,
    "Round7 caller dispatch set",
  );
  if (!Array.isArray(dispatchSet)
    || hashCanonicalV7(dispatchSet) !== expectedDispatchSetDigest) {
    throw new Error("caller dispatch set differs from its pinned digest");
  }

  const [policy, snapshot, rejection] = await Promise.all([
    readRepositoryJson(CONTINUATION_V7_POLICY_PATH, "Round7 policy", true),
    readRepositoryJson(
      CONTINUATION_V7_REVIEW_SNAPSHOT_PATH,
      "Round7 review snapshot",
      true,
    ),
    readRepositoryJson(
      CONTINUATION_V7_ROUND6_REVIEW_REJECTION_PATH,
      "Round6 review-rejection witness",
      true,
    ),
  ]);
  assertNoErrors(validateRound6ReviewRejectionV7(rejection),
    "Round6 review-rejection witness");
  assertNoErrors(validateContinuationPolicyV7(policy, {
    expectedDigest: expectedPolicyDigest,
  }), "Round7 policy");
  assertNoErrors(validateContinuationReviewSnapshotV7(snapshot, policy, {
    verifierNow: Date.now(),
  }), "Round7 review snapshot");
  if (snapshot.digest !== expectedSnapshotDigest) {
    throw new Error("Round7 snapshot differs from caller pin");
  }

  const receipts = [];
  const receiptReferences = [];
  for (const lane of CONTINUATION_V7_REVIEW_LANES) {
    const relativePath =
      `.zerox/verification/conversation-disclosure/CD03A-round7-${lane}-review.json`;
    const receipt = await readRepositoryJson(
      relativePath,
      `Round7 ${lane} review receipt`,
      true,
    );
    receipts.push(receipt);
    receiptReferences.push({
      lane,
      path: relativePath,
      challenge: receipt.challenge,
      canonicalDigest: hashCanonicalV7(receipt),
    });
  }
  assertNoErrors(validateContinuationReviewSetV7(
    receipts,
    dispatchSet,
    snapshot,
    policy,
  ), "Round7 review set");

  const [policyCapture, snapshotCapture, rejectionCapture, checkerCapture,
    runnerCapture] = await Promise.all([
    captureRepository(CONTINUATION_V7_POLICY_PATH, "Round7 policy", true),
    captureRepository(
      CONTINUATION_V7_REVIEW_SNAPSHOT_PATH,
      "Round7 review snapshot",
      true,
    ),
    captureRepository(
      CONTINUATION_V7_ROUND6_REVIEW_REJECTION_PATH,
      "Round6 review-rejection witness",
      true,
    ),
    captureRepository(CHECKER_PATH, "Round7 checker"),
    captureRepository(RUNNER_PATH, "Round7 external runner"),
  ]);
  const manifestBase = {
    schemaVersion: 7,
    kind: CONTINUATION_V7_MANIFEST_KIND,
    programId: policy.programId,
    workstreamId: CONTINUATION_V7_WORKSTREAM_ID,
    featureId: CONTINUATION_V7_FEATURE_ID,
    round: CONTINUATION_V7_ROUND,
    status: "review_passed_pending_external_transaction",
    parentEvidenceBundleDigest: policy.parentEvidence.bundleDigest,
    policy: {
      path: CONTINUATION_V7_POLICY_PATH,
      byteSha256: policyCapture.digest,
      canonicalDigest: policy.digest,
    },
    snapshot: {
      path: CONTINUATION_V7_REVIEW_SNAPSHOT_PATH,
      byteSha256: snapshotCapture.digest,
      canonicalDigest: snapshot.digest,
    },
    round6ReviewRejection: {
      path: CONTINUATION_V7_ROUND6_REVIEW_REJECTION_PATH,
      byteSha256: rejectionCapture.digest,
      canonicalDigest: rejection.digest,
    },
    reviewReceipts: receiptReferences,
    callerDispatchSet: dispatchSet,
    validator: { path: CHECKER_PATH, sha256: checkerCapture.digest },
    externalRunner: { path: RUNNER_PATH, sha256: runnerCapture.digest },
    externalAttestation: {
      path: CONTINUATION_V7_EXTERNAL_ATTESTATION_PATH,
      canonicalDigest: null,
    },
  };
  const pendingManifestDigest = pendingManifestDigestV7(manifestBase);
  const manifest = withCanonicalDigestV7({
    ...manifestBase,
    pendingManifestDigest,
  });
  assertNoErrors(validateContinuationClosureManifestV7(manifest, {
    policy,
    policyReference: manifest.policy,
    snapshotReference: manifest.snapshot,
    round6ReviewRejectionReference: manifest.round6ReviewRejection,
    reviewReferences: manifest.reviewReceipts,
    callerDispatchSet: dispatchSet,
    validatorReference: manifest.validator,
    runnerReference: manifest.externalRunner,
  }), "generated Round7 pending manifest");
  const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await postflightCaptureLedgerV7(ledger);

  let publicationStatus = "not_requested";
  if (outputPath !== undefined) {
    publicationStatus = (await publishPrivateExactV7(
      resolveExactOutput(root, outputPath),
      bytes,
      { expectedRoot: root, label: "Round7 pending manifest" },
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
  const expected = path.join(root, CONTINUATION_V7_CLOSURE_MANIFEST_PATH);
  if (resolved !== expected) {
    throw new Error("--output must be the exact Round7 closure manifest path");
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
  buildConversationDisclosureContinuationManifestV7(
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
