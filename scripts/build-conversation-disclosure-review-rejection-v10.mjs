#!/usr/bin/env node

import { realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  CONTINUATION_V10_ALGORITHM,
  CONTINUATION_V10_FEATURE_ID,
  CONTINUATION_V10_REJECTED_ROUND,
  CONTINUATION_V10_REVIEW_REJECTION_KIND,
  CONTINUATION_V10_ROUND,
  CONTINUATION_V10_ROUND1_REJECTION_DIGEST,
  CONTINUATION_V10_ROUND2_REJECTION_TRUST_ROOT,
  CONTINUATION_V10_ROUND9_AGGREGATE_FINDING_COUNTS,
  CONTINUATION_V10_ROUND9_FINDING_IDS,
  CONTINUATION_V10_ROUND9_FINDING_SET_DIGEST,
  CONTINUATION_V10_ROUND9_POLICY_TRUST_ROOT,
  CONTINUATION_V10_ROUND9_RECEIPT_TRUST_ROOTS,
  CONTINUATION_V10_ROUND9_REPOSITORY_FORBIDDEN_OUTPUT_PATHS,
  CONTINUATION_V10_ROUND9_REVIEW_REJECTION_PATH,
  CONTINUATION_V10_ROUND9_SNAPSHOT_TRUST_ROOT,
  CONTINUATION_V10_WORKSTREAM_ID,
  canonicalJsonV10,
  expectedRejectedRound9AnchorRuleV10,
  serializeRound9ReviewRejectionV10,
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
import {
  hashCanonicalV9,
  validateBaselineArchiveV9,
  validateContinuationPolicyV9,
  validateContinuationReviewReceiptV9,
  validateContinuationReviewSnapshotV9,
} from "./conversation-disclosure-continuation-contract-v9.mjs";

const ROUND9_ARCHIVE_PATH =
  ".zerox/verification/conversation-disclosure/CD03A-round9-baseline-archive.json";

export async function buildConversationDisclosureReviewRejectionV10({
  repositoryRoot = process.cwd(),
  outputPath,
  verifierNow = Date.now(),
} = {}) {
  const root = await canonicalRepositoryRoot(repositoryRoot);
  const ledger = createCaptureLedgerV10();
  const captureRepository = async (
    relativePath,
    label,
    { privateEvidence = false } = {},
  ) => {
    const absolutePath = path.join(root, relativePath);
    return privateEvidence
      ? capturePrivateEvidenceV10(absolutePath, label, {
        expectedRoot: root,
        ledger,
      })
      : captureStableFileV10(absolutePath, label, {
        expectedRoot: root,
        ledger,
      });
  };

  const policyCapture = await captureRepository(
    CONTINUATION_V10_ROUND9_POLICY_TRUST_ROOT.path,
    "Round9 rejected policy",
    { privateEvidence: true },
  );
  const snapshotCapture = await captureRepository(
    CONTINUATION_V10_ROUND9_SNAPSHOT_TRUST_ROOT.path,
    "Round9 rejected snapshot",
    { privateEvidence: true },
  );
  const archiveCapture = await captureRepository(
    ROUND9_ARCHIVE_PATH,
    "Round9 baseline archive",
    { privateEvidence: true },
  );
  const receiptCaptures = [];
  for (const rootEntry of CONTINUATION_V10_ROUND9_RECEIPT_TRUST_ROOTS) {
    receiptCaptures.push(await captureRepository(
      rootEntry.path,
      `Round9 ${rootEntry.lane} completed receipt`,
      { privateEvidence: true },
    ));
  }

  assertByteRoot(
    policyCapture.digest,
    CONTINUATION_V10_ROUND9_POLICY_TRUST_ROOT.byteSha256,
    "Round9 policy",
  );
  assertByteRoot(
    snapshotCapture.digest,
    CONTINUATION_V10_ROUND9_SNAPSHOT_TRUST_ROOT.byteSha256,
    "Round9 snapshot",
  );
  const policy = parseJson(policyCapture.bytes, "Round9 policy");
  const snapshot = parseJson(snapshotCapture.bytes, "Round9 snapshot");
  const archive = parseJson(archiveCapture.bytes, "Round9 baseline archive");
  const receipts = receiptCaptures.map((capture, index) => {
    const expected = CONTINUATION_V10_ROUND9_RECEIPT_TRUST_ROOTS[index];
    assertByteRoot(
      capture.digest,
      expected.byteSha256,
      `Round9 ${expected.lane} receipt`,
    );
    return parseJson(capture.bytes, `Round9 ${expected.lane} receipt`);
  });

  assertNoErrors(validateContinuationPolicyV9(policy, {
    expectedDigest:
      CONTINUATION_V10_ROUND9_POLICY_TRUST_ROOT.canonicalDigest,
    baselineArchive: archive,
  }), "Round9 rejected policy");
  assertNoErrors(validateBaselineArchiveV9(archive, policy),
    "Round9 baseline archive");
  assertNoErrors(validateContinuationReviewSnapshotV9(snapshot, policy, {
    verifierNow,
  }), "Round9 rejected snapshot");
  if (snapshot.digest
    !== CONTINUATION_V10_ROUND9_SNAPSHOT_TRUST_ROOT.canonicalDigest
    || snapshot.frozenFiles?.length
      !== CONTINUATION_V10_ROUND9_SNAPSHOT_TRUST_ROOT.frozenFileCount
    || snapshot.transitionPayloadFiles?.length
      !== CONTINUATION_V10_ROUND9_SNAPSHOT_TRUST_ROOT.transitionPayloadFileCount
    || snapshot.baselineFiles?.length
      !== CONTINUATION_V10_ROUND9_SNAPSHOT_TRUST_ROOT.baselineFileCount) {
    throw new Error("Round9 snapshot differs from its hard rejection root");
  }

  for (let index = 0; index < receipts.length; index += 1) {
    const expected = CONTINUATION_V10_ROUND9_RECEIPT_TRUST_ROOTS[index];
    assertNoErrors(validateContinuationReviewReceiptV9(
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
    ), `Round9 ${expected.lane} completed receipt`);
    if (hashCanonicalV9(receipts[index]) !== expected.canonicalDigest) {
      throw new Error(`Round9 ${expected.lane} receipt canonical root is stale`);
    }
  }
  validateFindingAggregate(receipts);

  for (const relativePath of
    CONTINUATION_V10_ROUND9_REPOSITORY_FORBIDDEN_OUTPUT_PATHS) {
    await captureRequiredAbsentV10(
      path.join(root, relativePath),
      `Round9 forbidden output ${relativePath}`,
      { expectedRoot: root, ledger },
    );
  }

  const witness = withCanonicalDigestV10({
    schemaVersion: 10,
    kind: CONTINUATION_V10_REVIEW_REJECTION_KIND,
    algorithm: CONTINUATION_V10_ALGORITHM,
    programId: policy.programId,
    workstreamId: CONTINUATION_V10_WORKSTREAM_ID,
    featureId: CONTINUATION_V10_FEATURE_ID,
    rejectedRound: CONTINUATION_V10_REJECTED_ROUND,
    recoveryRound: CONTINUATION_V10_ROUND,
    status: "rejected_after_review",
    sourcePolicy: structuredClone(
      CONTINUATION_V10_ROUND9_POLICY_TRUST_ROOT,
    ),
    sourceSnapshot: structuredClone(
      CONTINUATION_V10_ROUND9_SNAPSHOT_TRUST_ROOT,
    ),
    completedReceipts: CONTINUATION_V10_ROUND9_RECEIPT_TRUST_ROOTS.map(
      (entry) => structuredClone(entry),
    ),
    findingIds: [...CONTINUATION_V10_ROUND9_FINDING_IDS],
    findingSetDigest: CONTINUATION_V10_ROUND9_FINDING_SET_DIGEST,
    aggregateFindingCounts: structuredClone(
      CONTINUATION_V10_ROUND9_AGGREGATE_FINDING_COUNTS,
    ),
    repositoryForbiddenOutputs: [
      ...CONTINUATION_V10_ROUND9_REPOSITORY_FORBIDDEN_OUTPUT_PATHS,
    ],
    externalAnchorRule: expectedRejectedRound9AnchorRuleV10(),
    priorRejections: {
      round1CanonicalDigest: CONTINUATION_V10_ROUND1_REJECTION_DIGEST,
      round2: structuredClone(
        CONTINUATION_V10_ROUND2_REJECTION_TRUST_ROOT,
      ),
    },
  });
  assertNoErrors(
    validateRound9ReviewRejectionV10(witness),
    "generated Round9 review-rejection witness",
  );
  const bytes = serializeRound9ReviewRejectionV10(witness);
  await postflightCaptureLedgerV10(ledger);

  let publicationStatus = "not_requested";
  if (outputPath !== undefined) {
    const absoluteOutput = resolveExactOutput(root, outputPath);
    publicationStatus = (await publishPrivateExactV10(
      absoluteOutput,
      bytes,
      {
        expectedRoot: root,
        label: "Round9 review-rejection witness",
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
  if (canonicalJsonV10(counts)
      !== canonicalJsonV10(CONTINUATION_V10_ROUND9_AGGREGATE_FINDING_COUNTS)
    || canonicalJsonV10(findingIds)
      !== canonicalJsonV10(CONTINUATION_V10_ROUND9_FINDING_IDS)) {
    throw new Error("Round9 receipt findings differ from the hard rejection set");
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
    CONTINUATION_V10_ROUND9_REVIEW_REJECTION_PATH,
  );
  if (resolved !== expected) {
    throw new Error(
      "--output must be the exact Round9 review-rejection witness path",
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
  buildConversationDisclosureReviewRejectionV10(
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
