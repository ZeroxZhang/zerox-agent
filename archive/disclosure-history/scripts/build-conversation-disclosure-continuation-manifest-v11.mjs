#!/usr/bin/env node

import { realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  CONTINUATION_V11_CLOSURE_MANIFEST_PATH,
  CONTINUATION_V11_EXTERNAL_ATTESTATION_PATH,
  CONTINUATION_V11_FEATURE_ID,
  CONTINUATION_V11_MANIFEST_KIND,
  CONTINUATION_V11_POLICY_PATH,
  CONTINUATION_V11_REVIEW_LANES,
  CONTINUATION_V11_REVIEW_SNAPSHOT_PATH,
  CONTINUATION_V11_ROUND,
  CONTINUATION_V11_ROUND10_REVIEW_REJECTION_PATH,
  CONTINUATION_V11_WORKSTREAM_ID,
  hashCanonicalV11,
  pendingManifestDigestV11,
  sha256DigestV11,
  validateContinuationClosureManifestV11,
  validateContinuationPolicyV11,
  validateContinuationReviewSetV11,
  validateContinuationReviewSnapshotV11,
  validateRound10ReviewRejectionV11,
  withCanonicalDigestV11,
} from "./conversation-disclosure-continuation-contract-v11.mjs";
import {
  capturePrivateEvidenceV11,
  captureStableFileV11,
  createCaptureLedgerV11,
  postflightCaptureLedgerV11,
  publishPrivateExactV11,
} from "./conversation-disclosure-continuation-runtime-io-v11.mjs";

const CHECKER_PATH = "scripts/check-conversation-disclosure-continuation-v11.mjs";
const RUNNER_PATH = "scripts/verify-conversation-disclosure-continuation-v11.mjs";

export async function buildConversationDisclosureContinuationManifestV11({
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
    || !sha256DigestV11(expectedDispatchSetDigest)
    || !sha256DigestV11(expectedPolicyDigest)
    || !sha256DigestV11(expectedSnapshotDigest)) {
    throw new Error(
      "caller must pin dispatch set, policy, and snapshot digests",
    );
  }
  const canonicalDispatchPath = await realpath(dispatchSetPath);
  if (canonicalDispatchPath !== dispatchSetPath
    || isWithin(root, canonicalDispatchPath)) {
    throw new Error("dispatch set must be canonical and repository-external");
  }

  const ledger = createCaptureLedgerV11();
  const captureRepository = (relativePath, label, privateEvidence = false) => {
    const absolutePath = path.join(root, relativePath);
    return privateEvidence
      ? capturePrivateEvidenceV11(absolutePath, label, {
        expectedRoot: root,
        ledger,
      })
      : captureStableFileV11(absolutePath, label, {
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
    (await capturePrivateEvidenceV11(
      canonicalDispatchPath,
      "Round11 caller dispatch set",
      { ledger },
    )).bytes,
    "Round11 caller dispatch set",
  );
  if (!Array.isArray(dispatchSet)
    || hashCanonicalV11(dispatchSet) !== expectedDispatchSetDigest) {
    throw new Error("caller dispatch set differs from its pinned digest");
  }

  const [policy, snapshot, rejection] = await Promise.all([
    readRepositoryJson(CONTINUATION_V11_POLICY_PATH, "Round11 policy", true),
    readRepositoryJson(
      CONTINUATION_V11_REVIEW_SNAPSHOT_PATH,
      "Round11 review snapshot",
      true,
    ),
    readRepositoryJson(
      CONTINUATION_V11_ROUND10_REVIEW_REJECTION_PATH,
      "Round10 review-rejection witness",
      true,
    ),
  ]);
  assertNoErrors(validateRound10ReviewRejectionV11(rejection),
    "Round10 review-rejection witness");
  assertNoErrors(validateContinuationPolicyV11(policy, {
    expectedDigest: expectedPolicyDigest,
  }), "Round11 policy");
  assertNoErrors(validateContinuationReviewSnapshotV11(snapshot, policy, {
    verifierNow: Date.now(),
  }), "Round11 review snapshot");
  if (snapshot.digest !== expectedSnapshotDigest) {
    throw new Error("Round11 snapshot differs from caller pin");
  }

  const receipts = [];
  const receiptReferences = [];
  for (const lane of CONTINUATION_V11_REVIEW_LANES) {
    const relativePath =
      `.zerox/verification/conversation-disclosure/CD03A-round11-${lane}-review.json`;
    const receipt = await readRepositoryJson(
      relativePath,
      `Round11 ${lane} review receipt`,
      true,
    );
    receipts.push(receipt);
    receiptReferences.push({
      lane,
      path: relativePath,
      challenge: receipt.challenge,
      canonicalDigest: hashCanonicalV11(receipt),
    });
  }
  assertNoErrors(validateContinuationReviewSetV11(
    receipts,
    dispatchSet,
    snapshot,
    policy,
    { verifierNow },
  ), "Round11 review set");

  const [policyCapture, snapshotCapture, rejectionCapture, checkerCapture,
    runnerCapture] = await Promise.all([
    captureRepository(CONTINUATION_V11_POLICY_PATH, "Round11 policy", true),
    captureRepository(
      CONTINUATION_V11_REVIEW_SNAPSHOT_PATH,
      "Round11 review snapshot",
      true,
    ),
    captureRepository(
      CONTINUATION_V11_ROUND10_REVIEW_REJECTION_PATH,
      "Round10 review-rejection witness",
      true,
    ),
    captureRepository(CHECKER_PATH, "Round11 checker"),
    captureRepository(RUNNER_PATH, "Round11 external runner"),
  ]);
  const manifestBase = {
    schemaVersion: 11,
    kind: CONTINUATION_V11_MANIFEST_KIND,
    programId: policy.programId,
    workstreamId: CONTINUATION_V11_WORKSTREAM_ID,
    featureId: CONTINUATION_V11_FEATURE_ID,
    round: CONTINUATION_V11_ROUND,
    status: "review_passed_pending_external_transaction",
    parentEvidenceBundleDigest: policy.parentEvidence.bundleDigest,
    policy: {
      path: CONTINUATION_V11_POLICY_PATH,
      byteSha256: policyCapture.digest,
      canonicalDigest: policy.digest,
    },
    snapshot: {
      path: CONTINUATION_V11_REVIEW_SNAPSHOT_PATH,
      byteSha256: snapshotCapture.digest,
      canonicalDigest: snapshot.digest,
    },
    round10ReviewRejection: {
      path: CONTINUATION_V11_ROUND10_REVIEW_REJECTION_PATH,
      byteSha256: rejectionCapture.digest,
      canonicalDigest: rejection.digest,
    },
    reviewReceipts: receiptReferences,
    callerDispatchSet: dispatchSet,
    validator: { path: CHECKER_PATH, sha256: checkerCapture.digest },
    externalRunner: { path: RUNNER_PATH, sha256: runnerCapture.digest },
    externalAttestation: {
      path: CONTINUATION_V11_EXTERNAL_ATTESTATION_PATH,
      canonicalDigest: null,
    },
  };
  const pendingManifestDigest = pendingManifestDigestV11(manifestBase);
  const manifest = withCanonicalDigestV11({
    ...manifestBase,
    pendingManifestDigest,
  });
  assertNoErrors(validateContinuationClosureManifestV11(manifest, {
    policy,
    policyReference: manifest.policy,
    snapshotReference: manifest.snapshot,
    round10ReviewRejectionReference: manifest.round10ReviewRejection,
    reviewReferences: manifest.reviewReceipts,
    callerDispatchSet: dispatchSet,
    validatorReference: manifest.validator,
    runnerReference: manifest.externalRunner,
  }), "generated Round11 pending manifest");
  const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await postflightCaptureLedgerV11(ledger);

  let publicationStatus = "not_requested";
  if (outputPath !== undefined) {
    publicationStatus = (await publishPrivateExactV11(
      resolveExactOutput(root, outputPath),
      bytes,
      { expectedRoot: root, label: "Round11 pending manifest" },
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
  const expected = path.join(root, CONTINUATION_V11_CLOSURE_MANIFEST_PATH);
  if (resolved !== expected) {
    throw new Error("--output must be the exact Round11 closure manifest path");
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
  buildConversationDisclosureContinuationManifestV11(
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
