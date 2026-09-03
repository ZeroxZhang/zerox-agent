#!/usr/bin/env node

import { realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  CONTINUATION_V9_ALGORITHM,
  CONTINUATION_V9_FEATURE_ID,
  CONTINUATION_V9_REJECTED_ROUND,
  CONTINUATION_V9_REVIEW_REJECTION_KIND,
  CONTINUATION_V9_ROUND,
  CONTINUATION_V9_ROUND1_REJECTION_DIGEST,
  CONTINUATION_V9_ROUND2_REJECTION_TRUST_ROOT,
  CONTINUATION_V9_ROUND8_AGGREGATE_FINDING_COUNTS,
  CONTINUATION_V9_ROUND8_FINDING_IDS,
  CONTINUATION_V9_ROUND8_FINDING_SET_DIGEST,
  CONTINUATION_V9_ROUND8_POLICY_TRUST_ROOT,
  CONTINUATION_V9_ROUND8_RECEIPT_TRUST_ROOTS,
  CONTINUATION_V9_ROUND8_REPOSITORY_FORBIDDEN_OUTPUT_PATHS,
  CONTINUATION_V9_ROUND8_REVIEW_REJECTION_PATH,
  CONTINUATION_V9_ROUND8_SNAPSHOT_TRUST_ROOT,
  CONTINUATION_V9_WORKSTREAM_ID,
  canonicalJsonV9,
  expectedRejectedRound8AnchorRuleV9,
  serializeRound8ReviewRejectionV9,
  validateRound8ReviewRejectionV9,
  withCanonicalDigestV9,
} from "./conversation-disclosure-continuation-contract-v9.mjs";
import {
  capturePrivateEvidenceV9,
  captureRequiredAbsentV9,
  captureStableFileV9,
  createCaptureLedgerV9,
  postflightCaptureLedgerV9,
  publishPrivateExactV9,
} from "./conversation-disclosure-continuation-runtime-io-v9.mjs";
import {
  hashCanonicalV8,
  validateBaselineArchiveV8,
  validateContinuationPolicyV8,
  validateContinuationReviewReceiptV8,
  validateContinuationReviewSnapshotV8,
} from "./conversation-disclosure-continuation-contract-v8.mjs";

const ROUND8_ARCHIVE_PATH =
  ".zerox/verification/conversation-disclosure/CD03A-round8-baseline-archive.json";

export async function buildConversationDisclosureReviewRejectionV9({
  repositoryRoot = process.cwd(),
  outputPath,
  verifierNow = Date.now(),
} = {}) {
  const root = await canonicalRepositoryRoot(repositoryRoot);
  const ledger = createCaptureLedgerV9();
  const captureRepository = async (
    relativePath,
    label,
    { privateEvidence = false } = {},
  ) => {
    const absolutePath = path.join(root, relativePath);
    return privateEvidence
      ? capturePrivateEvidenceV9(absolutePath, label, {
        expectedRoot: root,
        ledger,
      })
      : captureStableFileV9(absolutePath, label, {
        expectedRoot: root,
        ledger,
      });
  };

  const policyCapture = await captureRepository(
    CONTINUATION_V9_ROUND8_POLICY_TRUST_ROOT.path,
    "Round8 rejected policy",
    { privateEvidence: true },
  );
  const snapshotCapture = await captureRepository(
    CONTINUATION_V9_ROUND8_SNAPSHOT_TRUST_ROOT.path,
    "Round8 rejected snapshot",
    { privateEvidence: true },
  );
  const archiveCapture = await captureRepository(
    ROUND8_ARCHIVE_PATH,
    "Round8 baseline archive",
    { privateEvidence: true },
  );
  const receiptCaptures = [];
  for (const rootEntry of CONTINUATION_V9_ROUND8_RECEIPT_TRUST_ROOTS) {
    receiptCaptures.push(await captureRepository(
      rootEntry.path,
      `Round8 ${rootEntry.lane} completed receipt`,
      { privateEvidence: true },
    ));
  }

  assertByteRoot(
    policyCapture.digest,
    CONTINUATION_V9_ROUND8_POLICY_TRUST_ROOT.byteSha256,
    "Round8 policy",
  );
  assertByteRoot(
    snapshotCapture.digest,
    CONTINUATION_V9_ROUND8_SNAPSHOT_TRUST_ROOT.byteSha256,
    "Round8 snapshot",
  );
  const policy = parseJson(policyCapture.bytes, "Round8 policy");
  const snapshot = parseJson(snapshotCapture.bytes, "Round8 snapshot");
  const archive = parseJson(archiveCapture.bytes, "Round8 baseline archive");
  const receipts = receiptCaptures.map((capture, index) => {
    const expected = CONTINUATION_V9_ROUND8_RECEIPT_TRUST_ROOTS[index];
    assertByteRoot(
      capture.digest,
      expected.byteSha256,
      `Round8 ${expected.lane} receipt`,
    );
    return parseJson(capture.bytes, `Round8 ${expected.lane} receipt`);
  });

  assertNoErrors(validateContinuationPolicyV8(policy, {
    expectedDigest:
      CONTINUATION_V9_ROUND8_POLICY_TRUST_ROOT.canonicalDigest,
    baselineArchive: archive,
  }), "Round8 rejected policy");
  assertNoErrors(validateBaselineArchiveV8(archive, policy),
    "Round8 baseline archive");
  assertNoErrors(validateContinuationReviewSnapshotV8(snapshot, policy, {
    verifierNow,
  }), "Round8 rejected snapshot");
  if (snapshot.digest
    !== CONTINUATION_V9_ROUND8_SNAPSHOT_TRUST_ROOT.canonicalDigest
    || snapshot.frozenFiles?.length
      !== CONTINUATION_V9_ROUND8_SNAPSHOT_TRUST_ROOT.frozenFileCount
    || snapshot.transitionPayloadFiles?.length
      !== CONTINUATION_V9_ROUND8_SNAPSHOT_TRUST_ROOT.transitionPayloadFileCount
    || snapshot.baselineFiles?.length
      !== CONTINUATION_V9_ROUND8_SNAPSHOT_TRUST_ROOT.baselineFileCount) {
    throw new Error("Round8 snapshot differs from its hard rejection root");
  }

  for (let index = 0; index < receipts.length; index += 1) {
    const expected = CONTINUATION_V9_ROUND8_RECEIPT_TRUST_ROOTS[index];
    assertNoErrors(validateContinuationReviewReceiptV8(
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
    ), `Round8 ${expected.lane} completed receipt`);
    if (hashCanonicalV8(receipts[index]) !== expected.canonicalDigest) {
      throw new Error(`Round8 ${expected.lane} receipt canonical root is stale`);
    }
  }
  validateFindingAggregate(receipts);

  for (const relativePath of
    CONTINUATION_V9_ROUND8_REPOSITORY_FORBIDDEN_OUTPUT_PATHS) {
    await captureRequiredAbsentV9(
      path.join(root, relativePath),
      `Round8 forbidden output ${relativePath}`,
      { expectedRoot: root, ledger },
    );
  }

  const witness = withCanonicalDigestV9({
    schemaVersion: 9,
    kind: CONTINUATION_V9_REVIEW_REJECTION_KIND,
    algorithm: CONTINUATION_V9_ALGORITHM,
    programId: policy.programId,
    workstreamId: CONTINUATION_V9_WORKSTREAM_ID,
    featureId: CONTINUATION_V9_FEATURE_ID,
    rejectedRound: CONTINUATION_V9_REJECTED_ROUND,
    recoveryRound: CONTINUATION_V9_ROUND,
    status: "rejected_after_review",
    sourcePolicy: structuredClone(
      CONTINUATION_V9_ROUND8_POLICY_TRUST_ROOT,
    ),
    sourceSnapshot: structuredClone(
      CONTINUATION_V9_ROUND8_SNAPSHOT_TRUST_ROOT,
    ),
    completedReceipts: CONTINUATION_V9_ROUND8_RECEIPT_TRUST_ROOTS.map(
      (entry) => structuredClone(entry),
    ),
    findingIds: [...CONTINUATION_V9_ROUND8_FINDING_IDS],
    findingSetDigest: CONTINUATION_V9_ROUND8_FINDING_SET_DIGEST,
    aggregateFindingCounts: structuredClone(
      CONTINUATION_V9_ROUND8_AGGREGATE_FINDING_COUNTS,
    ),
    repositoryForbiddenOutputs: [
      ...CONTINUATION_V9_ROUND8_REPOSITORY_FORBIDDEN_OUTPUT_PATHS,
    ],
    externalAnchorRule: expectedRejectedRound8AnchorRuleV9(),
    priorRejections: {
      round1CanonicalDigest: CONTINUATION_V9_ROUND1_REJECTION_DIGEST,
      round2: structuredClone(
        CONTINUATION_V9_ROUND2_REJECTION_TRUST_ROOT,
      ),
    },
  });
  assertNoErrors(
    validateRound8ReviewRejectionV9(witness),
    "generated Round8 review-rejection witness",
  );
  const bytes = serializeRound8ReviewRejectionV9(witness);
  await postflightCaptureLedgerV9(ledger);

  let publicationStatus = "not_requested";
  if (outputPath !== undefined) {
    const absoluteOutput = resolveExactOutput(root, outputPath);
    publicationStatus = (await publishPrivateExactV9(
      absoluteOutput,
      bytes,
      {
        expectedRoot: root,
        label: "Round8 review-rejection witness",
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
  if (canonicalJsonV9(counts)
      !== canonicalJsonV9(CONTINUATION_V9_ROUND8_AGGREGATE_FINDING_COUNTS)
    || canonicalJsonV9(findingIds)
      !== canonicalJsonV9(CONTINUATION_V9_ROUND8_FINDING_IDS)) {
    throw new Error("Round8 receipt findings differ from the hard rejection set");
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
    CONTINUATION_V9_ROUND8_REVIEW_REJECTION_PATH,
  );
  if (resolved !== expected) {
    throw new Error(
      "--output must be the exact Round8 review-rejection witness path",
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
  buildConversationDisclosureReviewRejectionV9(
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
