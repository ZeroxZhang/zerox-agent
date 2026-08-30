#!/usr/bin/env node

import { realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  CONTINUATION_V12_ALGORITHM,
  CONTINUATION_V12_FEATURE_ID,
  CONTINUATION_V12_REJECTED_ROUND,
  CONTINUATION_V12_REVIEW_REJECTION_KIND,
  CONTINUATION_V12_ROUND,
  CONTINUATION_V12_ROUND1_REJECTION_DIGEST,
  CONTINUATION_V12_ROUND2_REJECTION_TRUST_ROOT,
  CONTINUATION_V12_ROUND11_AGGREGATE_FINDING_COUNTS,
  CONTINUATION_V12_ROUND11_FINDING_IDS,
  CONTINUATION_V12_ROUND11_FINDING_SET_DIGEST,
  CONTINUATION_V12_ROUND11_POLICY_TRUST_ROOT,
  CONTINUATION_V12_ROUND11_RECEIPT_TRUST_ROOTS,
  CONTINUATION_V12_ROUND11_REPOSITORY_FORBIDDEN_OUTPUT_PATHS,
  CONTINUATION_V12_ROUND11_REVIEW_REJECTION_PATH,
  CONTINUATION_V12_ROUND11_SNAPSHOT_TRUST_ROOT,
  CONTINUATION_V12_WORKSTREAM_ID,
  canonicalJsonV12,
  expectedRejectedRound11AnchorRuleV12,
  serializeRound11ReviewRejectionV12,
  validateRound11ReviewRejectionV12,
  withCanonicalDigestV12,
} from "./conversation-disclosure-continuation-contract-v12.mjs";
import {
  capturePrivateEvidenceV12,
  captureRequiredAbsentV12,
  captureStableFileV12,
  createCaptureLedgerV12,
  postflightCaptureLedgerV12,
  publishPrivateExactV12,
} from "./conversation-disclosure-continuation-runtime-io-v12.mjs";
import {
  hashCanonicalV11,
  validateBaselineArchiveV11,
  validateContinuationPolicyV11,
  validateContinuationReviewReceiptV11,
  validateContinuationReviewSnapshotV11,
} from "./conversation-disclosure-continuation-contract-v11.mjs";

const ROUND11_ARCHIVE_PATH =
  ".zerox/verification/conversation-disclosure/CD03A-round11-baseline-archive.json";

export async function buildConversationDisclosureReviewRejectionV12({
  repositoryRoot = process.cwd(),
  outputPath,
  verifierNow = Date.now(),
} = {}) {
  const root = await canonicalRepositoryRoot(repositoryRoot);
  const ledger = createCaptureLedgerV12();
  const captureRepository = async (
    relativePath,
    label,
    { privateEvidence = false } = {},
  ) => {
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

  const policyCapture = await captureRepository(
    CONTINUATION_V12_ROUND11_POLICY_TRUST_ROOT.path,
    "Round11 rejected policy",
    { privateEvidence: true },
  );
  const snapshotCapture = await captureRepository(
    CONTINUATION_V12_ROUND11_SNAPSHOT_TRUST_ROOT.path,
    "Round11 rejected snapshot",
    { privateEvidence: true },
  );
  const archiveCapture = await captureRepository(
    ROUND11_ARCHIVE_PATH,
    "Round11 baseline archive",
    { privateEvidence: true },
  );
  const receiptCaptures = [];
  for (const rootEntry of CONTINUATION_V12_ROUND11_RECEIPT_TRUST_ROOTS) {
    receiptCaptures.push(await captureRepository(
      rootEntry.path,
      `Round11 ${rootEntry.lane} completed receipt`,
      { privateEvidence: true },
    ));
  }

  assertByteRoot(
    policyCapture.digest,
    CONTINUATION_V12_ROUND11_POLICY_TRUST_ROOT.byteSha256,
    "Round11 policy",
  );
  assertByteRoot(
    snapshotCapture.digest,
    CONTINUATION_V12_ROUND11_SNAPSHOT_TRUST_ROOT.byteSha256,
    "Round11 snapshot",
  );
  const policy = parseJson(policyCapture.bytes, "Round11 policy");
  const snapshot = parseJson(snapshotCapture.bytes, "Round11 snapshot");
  const archive = parseJson(archiveCapture.bytes, "Round11 baseline archive");
  const receipts = receiptCaptures.map((capture, index) => {
    const expected = CONTINUATION_V12_ROUND11_RECEIPT_TRUST_ROOTS[index];
    assertByteRoot(
      capture.digest,
      expected.byteSha256,
      `Round11 ${expected.lane} receipt`,
    );
    return parseJson(capture.bytes, `Round11 ${expected.lane} receipt`);
  });

  assertNoErrors(validateContinuationPolicyV11(policy, {
    expectedDigest:
      CONTINUATION_V12_ROUND11_POLICY_TRUST_ROOT.canonicalDigest,
    baselineArchive: archive,
  }), "Round11 rejected policy");
  assertNoErrors(validateBaselineArchiveV11(archive, policy),
    "Round11 baseline archive");
  assertNoErrors(validateContinuationReviewSnapshotV11(snapshot, policy, {
    verifierNow,
  }), "Round11 rejected snapshot");
  if (snapshot.digest
    !== CONTINUATION_V12_ROUND11_SNAPSHOT_TRUST_ROOT.canonicalDigest
    || snapshot.frozenFiles?.length
      !== CONTINUATION_V12_ROUND11_SNAPSHOT_TRUST_ROOT.frozenFileCount
    || snapshot.transitionPayloadFiles?.length
      !== CONTINUATION_V12_ROUND11_SNAPSHOT_TRUST_ROOT.transitionPayloadFileCount
    || snapshot.baselineFiles?.length
      !== CONTINUATION_V12_ROUND11_SNAPSHOT_TRUST_ROOT.baselineFileCount) {
    throw new Error("Round11 snapshot differs from its hard rejection root");
  }

  for (let index = 0; index < receipts.length; index += 1) {
    const expected = CONTINUATION_V12_ROUND11_RECEIPT_TRUST_ROOTS[index];
    assertNoErrors(validateContinuationReviewReceiptV11(
      receipts[index],
      snapshot,
      policy,
      {
        callerPin: {
          challenge: expected.challenge,
          dispatchEntryDigest: receipts[index].callerDispatchEntryDigest,
          dispatchSetDigest: receipts[index].callerDispatchSetDigest,
        },
        verifierNow,
      },
    ), `Round11 ${expected.lane} completed receipt`);
    if (hashCanonicalV11(receipts[index]) !== expected.canonicalDigest) {
      throw new Error(`Round11 ${expected.lane} receipt canonical root is stale`);
    }
  }
  validateFindingAggregate(receipts);

  for (const relativePath of
    CONTINUATION_V12_ROUND11_REPOSITORY_FORBIDDEN_OUTPUT_PATHS) {
    await captureRequiredAbsentV12(
      path.join(root, relativePath),
      `Round11 forbidden output ${relativePath}`,
      { expectedRoot: root, ledger },
    );
  }

  const witness = withCanonicalDigestV12({
    schemaVersion: 12,
    kind: CONTINUATION_V12_REVIEW_REJECTION_KIND,
    algorithm: CONTINUATION_V12_ALGORITHM,
    programId: policy.programId,
    workstreamId: CONTINUATION_V12_WORKSTREAM_ID,
    featureId: CONTINUATION_V12_FEATURE_ID,
    rejectedRound: CONTINUATION_V12_REJECTED_ROUND,
    recoveryRound: CONTINUATION_V12_ROUND,
    status: "rejected_after_review",
    sourcePolicy: structuredClone(
      CONTINUATION_V12_ROUND11_POLICY_TRUST_ROOT,
    ),
    sourceSnapshot: structuredClone(
      CONTINUATION_V12_ROUND11_SNAPSHOT_TRUST_ROOT,
    ),
    completedReceipts: CONTINUATION_V12_ROUND11_RECEIPT_TRUST_ROOTS.map(
      (entry) => structuredClone(entry),
    ),
    findingIds: [...CONTINUATION_V12_ROUND11_FINDING_IDS],
    findingSetDigest: CONTINUATION_V12_ROUND11_FINDING_SET_DIGEST,
    aggregateFindingCounts: structuredClone(
      CONTINUATION_V12_ROUND11_AGGREGATE_FINDING_COUNTS,
    ),
    repositoryForbiddenOutputs: [
      ...CONTINUATION_V12_ROUND11_REPOSITORY_FORBIDDEN_OUTPUT_PATHS,
    ],
    externalAnchorRule: expectedRejectedRound11AnchorRuleV12(),
    priorRejections: {
      round1CanonicalDigest: CONTINUATION_V12_ROUND1_REJECTION_DIGEST,
      round2: structuredClone(
        CONTINUATION_V12_ROUND2_REJECTION_TRUST_ROOT,
      ),
    },
  });
  assertNoErrors(
    validateRound11ReviewRejectionV12(witness),
    "generated Round11 review-rejection witness",
  );
  const bytes = serializeRound11ReviewRejectionV12(witness);
  await postflightCaptureLedgerV12(ledger);

  let publicationStatus = "not_requested";
  if (outputPath !== undefined) {
    const absoluteOutput = resolveExactOutput(root, outputPath);
    publicationStatus = (await publishPrivateExactV12(
      absoluteOutput,
      bytes,
      {
        expectedRoot: root,
        label: "Round11 review-rejection witness",
      },
    )).status;
  }
  return {
    witness,
    bytes,
    publicationStatus,
    captureCount: ledger.entries.length,
  };
}

function validateFindingAggregate(receipts) {
  const counts = { critical: 0, major: 0, minor: 0 };
  const findingIds = [];
  for (const receipt of receipts) {
    for (const severity of Object.keys(counts)) {
      counts[severity] += receipt.findingCounts[severity];
    }
    findingIds.push(...receipt.findings.map((finding) => finding.id));
  }
  findingIds.sort();
  if (canonicalJsonV12(counts)
      !== canonicalJsonV12(CONTINUATION_V12_ROUND11_AGGREGATE_FINDING_COUNTS)
    || canonicalJsonV12(findingIds)
      !== canonicalJsonV12(CONTINUATION_V12_ROUND11_FINDING_IDS)) {
    throw new Error("Round11 receipt findings differ from the hard rejection set");
  }
}

async function canonicalRepositoryRoot(candidate) {
  const resolved = path.resolve(candidate);
  const canonical = await realpath(resolved);
  if (canonical !== resolved) {
    throw new Error("repository root must be canonical");
  }
  return canonical;
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

function assertByteRoot(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} bytes differ from the hard rejection root`);
  }
}

function assertNoErrors(errors, label) {
  if (errors.length > 0) {
    throw new Error(`${label} is invalid: ${errors.join("; ")}`);
  }
}

function resolveExactOutput(root, outputPath) {
  const resolved = path.resolve(root, outputPath);
  const expected = path.join(
    root,
    CONTINUATION_V12_ROUND11_REVIEW_REJECTION_PATH,
  );
  if (resolved !== expected) {
    throw new Error(
      "--output must be the exact Round11 review-rejection witness path",
    );
  }
  return resolved;
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--repository-root") {
      options.repositoryRoot = argv[++index];
    } else if (argument === "--output") {
      options.outputPath = argv[++index];
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  return options;
}

if (process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  buildConversationDisclosureReviewRejectionV12(
    parseArguments(process.argv.slice(2)),
  ).then(({ witness, publicationStatus, captureCount }) => {
    process.stdout.write(`${JSON.stringify({
      status: "passed",
      digest: witness.digest,
      publicationStatus,
      captureCount,
    })}\n`);
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
