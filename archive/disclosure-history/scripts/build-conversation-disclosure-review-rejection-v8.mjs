#!/usr/bin/env node

import { realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  CONTINUATION_V8_ALGORITHM,
  CONTINUATION_V8_FEATURE_ID,
  CONTINUATION_V8_REJECTED_ROUND,
  CONTINUATION_V8_REVIEW_REJECTION_KIND,
  CONTINUATION_V8_ROUND,
  CONTINUATION_V8_ROUND1_REJECTION_DIGEST,
  CONTINUATION_V8_ROUND2_REJECTION_TRUST_ROOT,
  CONTINUATION_V8_ROUND7_AGGREGATE_FINDING_COUNTS,
  CONTINUATION_V8_ROUND7_FINDING_IDS,
  CONTINUATION_V8_ROUND7_FINDING_SET_DIGEST,
  CONTINUATION_V8_ROUND7_POLICY_TRUST_ROOT,
  CONTINUATION_V8_ROUND7_RECEIPT_TRUST_ROOTS,
  CONTINUATION_V8_ROUND7_REPOSITORY_FORBIDDEN_OUTPUT_PATHS,
  CONTINUATION_V8_ROUND7_REVIEW_REJECTION_PATH,
  CONTINUATION_V8_ROUND7_SNAPSHOT_TRUST_ROOT,
  CONTINUATION_V8_WORKSTREAM_ID,
  canonicalJsonV8,
  expectedRejectedRound7AnchorRuleV8,
  serializeRound7ReviewRejectionV8,
  validateRound7ReviewRejectionV8,
  withCanonicalDigestV8,
} from "./conversation-disclosure-continuation-contract-v8.mjs";
import {
  capturePrivateEvidenceV8,
  captureRequiredAbsentV8,
  captureStableFileV8,
  createCaptureLedgerV8,
  postflightCaptureLedgerV8,
  publishPrivateExactV8,
} from "./conversation-disclosure-continuation-runtime-io-v8.mjs";
import {
  hashCanonicalV7,
  validateBaselineArchiveV7,
  validateContinuationPolicyV7,
  validateContinuationReviewReceiptV7,
  validateContinuationReviewSnapshotV7,
} from "./conversation-disclosure-continuation-contract-v7.mjs";

const ROUND7_ARCHIVE_PATH =
  ".zerox/verification/conversation-disclosure/CD03A-round7-baseline-archive.json";

export async function buildConversationDisclosureReviewRejectionV8({
  repositoryRoot = process.cwd(),
  outputPath,
  verifierNow = Date.now(),
} = {}) {
  const root = await canonicalRepositoryRoot(repositoryRoot);
  const ledger = createCaptureLedgerV8();
  const captureRepository = async (
    relativePath,
    label,
    { privateEvidence = false } = {},
  ) => {
    const absolutePath = path.join(root, relativePath);
    return privateEvidence
      ? capturePrivateEvidenceV8(absolutePath, label, {
        expectedRoot: root,
        ledger,
      })
      : captureStableFileV8(absolutePath, label, {
        expectedRoot: root,
        ledger,
      });
  };

  const policyCapture = await captureRepository(
    CONTINUATION_V8_ROUND7_POLICY_TRUST_ROOT.path,
    "Round7 rejected policy",
    { privateEvidence: true },
  );
  const snapshotCapture = await captureRepository(
    CONTINUATION_V8_ROUND7_SNAPSHOT_TRUST_ROOT.path,
    "Round7 rejected snapshot",
    { privateEvidence: true },
  );
  const archiveCapture = await captureRepository(
    ROUND7_ARCHIVE_PATH,
    "Round7 baseline archive",
    { privateEvidence: true },
  );
  const receiptCaptures = [];
  for (const rootEntry of CONTINUATION_V8_ROUND7_RECEIPT_TRUST_ROOTS) {
    receiptCaptures.push(await captureRepository(
      rootEntry.path,
      `Round7 ${rootEntry.lane} completed receipt`,
      { privateEvidence: true },
    ));
  }

  assertByteRoot(
    policyCapture.digest,
    CONTINUATION_V8_ROUND7_POLICY_TRUST_ROOT.byteSha256,
    "Round7 policy",
  );
  assertByteRoot(
    snapshotCapture.digest,
    CONTINUATION_V8_ROUND7_SNAPSHOT_TRUST_ROOT.byteSha256,
    "Round7 snapshot",
  );
  const policy = parseJson(policyCapture.bytes, "Round7 policy");
  const snapshot = parseJson(snapshotCapture.bytes, "Round7 snapshot");
  const archive = parseJson(archiveCapture.bytes, "Round7 baseline archive");
  const receipts = receiptCaptures.map((capture, index) => {
    const expected = CONTINUATION_V8_ROUND7_RECEIPT_TRUST_ROOTS[index];
    assertByteRoot(
      capture.digest,
      expected.byteSha256,
      `Round7 ${expected.lane} receipt`,
    );
    return parseJson(capture.bytes, `Round7 ${expected.lane} receipt`);
  });

  assertNoErrors(validateContinuationPolicyV7(policy, {
    expectedDigest:
      CONTINUATION_V8_ROUND7_POLICY_TRUST_ROOT.canonicalDigest,
    baselineArchive: archive,
  }), "Round7 rejected policy");
  assertNoErrors(validateBaselineArchiveV7(archive, policy),
    "Round7 baseline archive");
  assertNoErrors(validateContinuationReviewSnapshotV7(snapshot, policy, {
    verifierNow,
  }), "Round7 rejected snapshot");
  if (snapshot.digest
    !== CONTINUATION_V8_ROUND7_SNAPSHOT_TRUST_ROOT.canonicalDigest
    || snapshot.frozenFiles?.length
      !== CONTINUATION_V8_ROUND7_SNAPSHOT_TRUST_ROOT.frozenFileCount
    || snapshot.transitionPayloadFiles?.length
      !== CONTINUATION_V8_ROUND7_SNAPSHOT_TRUST_ROOT.transitionPayloadFileCount
    || snapshot.baselineFiles?.length
      !== CONTINUATION_V8_ROUND7_SNAPSHOT_TRUST_ROOT.baselineFileCount) {
    throw new Error("Round7 snapshot differs from its hard rejection root");
  }

  for (let index = 0; index < receipts.length; index += 1) {
    const expected = CONTINUATION_V8_ROUND7_RECEIPT_TRUST_ROOTS[index];
    assertNoErrors(validateContinuationReviewReceiptV7(
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
    ), `Round7 ${expected.lane} completed receipt`);
    if (hashCanonicalV7(receipts[index]) !== expected.canonicalDigest) {
      throw new Error(`Round7 ${expected.lane} receipt canonical root is stale`);
    }
  }
  validateFindingAggregate(receipts);

  for (const relativePath of
    CONTINUATION_V8_ROUND7_REPOSITORY_FORBIDDEN_OUTPUT_PATHS) {
    await captureRequiredAbsentV8(
      path.join(root, relativePath),
      `Round7 forbidden output ${relativePath}`,
      { expectedRoot: root, ledger },
    );
  }

  const witness = withCanonicalDigestV8({
    schemaVersion: 8,
    kind: CONTINUATION_V8_REVIEW_REJECTION_KIND,
    algorithm: CONTINUATION_V8_ALGORITHM,
    programId: policy.programId,
    workstreamId: CONTINUATION_V8_WORKSTREAM_ID,
    featureId: CONTINUATION_V8_FEATURE_ID,
    rejectedRound: CONTINUATION_V8_REJECTED_ROUND,
    recoveryRound: CONTINUATION_V8_ROUND,
    status: "rejected_after_review",
    sourcePolicy: structuredClone(
      CONTINUATION_V8_ROUND7_POLICY_TRUST_ROOT,
    ),
    sourceSnapshot: structuredClone(
      CONTINUATION_V8_ROUND7_SNAPSHOT_TRUST_ROOT,
    ),
    completedReceipts: CONTINUATION_V8_ROUND7_RECEIPT_TRUST_ROOTS.map(
      (entry) => structuredClone(entry),
    ),
    findingIds: [...CONTINUATION_V8_ROUND7_FINDING_IDS],
    findingSetDigest: CONTINUATION_V8_ROUND7_FINDING_SET_DIGEST,
    aggregateFindingCounts: structuredClone(
      CONTINUATION_V8_ROUND7_AGGREGATE_FINDING_COUNTS,
    ),
    repositoryForbiddenOutputs: [
      ...CONTINUATION_V8_ROUND7_REPOSITORY_FORBIDDEN_OUTPUT_PATHS,
    ],
    externalAnchorRule: expectedRejectedRound7AnchorRuleV8(),
    priorRejections: {
      round1CanonicalDigest: CONTINUATION_V8_ROUND1_REJECTION_DIGEST,
      round2: structuredClone(
        CONTINUATION_V8_ROUND2_REJECTION_TRUST_ROOT,
      ),
    },
  });
  assertNoErrors(
    validateRound7ReviewRejectionV8(witness),
    "generated Round7 review-rejection witness",
  );
  const bytes = serializeRound7ReviewRejectionV8(witness);
  await postflightCaptureLedgerV8(ledger);

  let publicationStatus = "not_requested";
  if (outputPath !== undefined) {
    const absoluteOutput = resolveExactOutput(root, outputPath);
    publicationStatus = (await publishPrivateExactV8(
      absoluteOutput,
      bytes,
      {
        expectedRoot: root,
        label: "Round7 review-rejection witness",
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
  if (canonicalJsonV8(counts)
      !== canonicalJsonV8(CONTINUATION_V8_ROUND7_AGGREGATE_FINDING_COUNTS)
    || canonicalJsonV8(findingIds)
      !== canonicalJsonV8(CONTINUATION_V8_ROUND7_FINDING_IDS)) {
    throw new Error("Round7 receipt findings differ from the hard rejection set");
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
    CONTINUATION_V8_ROUND7_REVIEW_REJECTION_PATH,
  );
  if (resolved !== expected) {
    throw new Error(
      "--output must be the exact Round7 review-rejection witness path",
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
  buildConversationDisclosureReviewRejectionV8(
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
