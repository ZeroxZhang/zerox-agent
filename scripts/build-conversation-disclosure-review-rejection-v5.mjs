#!/usr/bin/env node

import { realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  CONTINUATION_V5_ALGORITHM,
  CONTINUATION_V5_FEATURE_ID,
  CONTINUATION_V5_REJECTED_ROUND,
  CONTINUATION_V5_REVIEW_REJECTION_KIND,
  CONTINUATION_V5_ROUND,
  CONTINUATION_V5_ROUND1_REJECTION_DIGEST,
  CONTINUATION_V5_ROUND2_REJECTION_TRUST_ROOT,
  CONTINUATION_V5_ROUND4_AGGREGATE_FINDING_COUNTS,
  CONTINUATION_V5_ROUND4_FINDING_IDS,
  CONTINUATION_V5_ROUND4_FINDING_SET_DIGEST,
  CONTINUATION_V5_ROUND4_POLICY_TRUST_ROOT,
  CONTINUATION_V5_ROUND4_RECEIPT_TRUST_ROOTS,
  CONTINUATION_V5_ROUND4_REPOSITORY_FORBIDDEN_OUTPUT_PATHS,
  CONTINUATION_V5_ROUND4_REVIEW_REJECTION_PATH,
  CONTINUATION_V5_ROUND4_SNAPSHOT_TRUST_ROOT,
  CONTINUATION_V5_WORKSTREAM_ID,
  canonicalJsonV5,
  expectedRejectedRound4AnchorRuleV5,
  serializeRound4ReviewRejectionV5,
  validateRound4ReviewRejectionV5,
  withCanonicalDigestV5,
} from "./conversation-disclosure-continuation-contract-v5.mjs";
import {
  capturePrivateEvidenceV5,
  captureRequiredAbsentV5,
  captureStableFileV5,
  createCaptureLedgerV5,
  postflightCaptureLedgerV5,
  publishPrivateExactV5,
} from "./conversation-disclosure-continuation-runtime-io-v5.mjs";
import {
  hashCanonicalV4,
  validateBaselineArchiveV4,
  validateContinuationPolicyV4,
  validateContinuationReviewReceiptV4,
  validateContinuationReviewSnapshotV4,
} from "./conversation-disclosure-continuation-contract-v4.mjs";

const ROUND4_ARCHIVE_PATH =
  ".zerox/verification/conversation-disclosure/CD03A-round4-baseline-archive.json";

export async function buildConversationDisclosureReviewRejectionV5({
  repositoryRoot = process.cwd(),
  outputPath,
  verifierNow = Date.now(),
} = {}) {
  const root = await canonicalRepositoryRoot(repositoryRoot);
  const ledger = createCaptureLedgerV5();
  const captureRepository = async (
    relativePath,
    label,
    { privateEvidence = false } = {},
  ) => {
    const absolutePath = path.join(root, relativePath);
    return privateEvidence
      ? capturePrivateEvidenceV5(absolutePath, label, {
        expectedRoot: root,
        ledger,
      })
      : captureStableFileV5(absolutePath, label, {
        expectedRoot: root,
        ledger,
      });
  };

  const policyCapture = await captureRepository(
    CONTINUATION_V5_ROUND4_POLICY_TRUST_ROOT.path,
    "Round4 rejected policy",
    { privateEvidence: true },
  );
  const snapshotCapture = await captureRepository(
    CONTINUATION_V5_ROUND4_SNAPSHOT_TRUST_ROOT.path,
    "Round4 rejected snapshot",
    { privateEvidence: true },
  );
  const archiveCapture = await captureRepository(
    ROUND4_ARCHIVE_PATH,
    "Round4 baseline archive",
    { privateEvidence: true },
  );
  const receiptCaptures = [];
  for (const rootEntry of CONTINUATION_V5_ROUND4_RECEIPT_TRUST_ROOTS) {
    receiptCaptures.push(await captureRepository(
      rootEntry.path,
      `Round4 ${rootEntry.lane} failed receipt`,
      { privateEvidence: true },
    ));
  }

  assertByteRoot(
    policyCapture.digest,
    CONTINUATION_V5_ROUND4_POLICY_TRUST_ROOT.byteSha256,
    "Round4 policy",
  );
  assertByteRoot(
    snapshotCapture.digest,
    CONTINUATION_V5_ROUND4_SNAPSHOT_TRUST_ROOT.byteSha256,
    "Round4 snapshot",
  );
  const policy = parseJson(policyCapture.bytes, "Round4 policy");
  const snapshot = parseJson(snapshotCapture.bytes, "Round4 snapshot");
  const archive = parseJson(archiveCapture.bytes, "Round4 baseline archive");
  const receipts = receiptCaptures.map((capture, index) => {
    const expected = CONTINUATION_V5_ROUND4_RECEIPT_TRUST_ROOTS[index];
    assertByteRoot(
      capture.digest,
      expected.byteSha256,
      `Round4 ${expected.lane} receipt`,
    );
    return parseJson(capture.bytes, `Round4 ${expected.lane} receipt`);
  });

  assertNoErrors(validateContinuationPolicyV4(policy, {
    expectedDigest:
      CONTINUATION_V5_ROUND4_POLICY_TRUST_ROOT.canonicalDigest,
    baselineArchive: archive,
  }), "Round4 rejected policy");
  assertNoErrors(validateBaselineArchiveV4(archive, policy),
    "Round4 baseline archive");
  assertNoErrors(validateContinuationReviewSnapshotV4(snapshot, policy, {
    verifierNow,
  }), "Round4 rejected snapshot");
  if (snapshot.digest
    !== CONTINUATION_V5_ROUND4_SNAPSHOT_TRUST_ROOT.canonicalDigest
    || snapshot.frozenFiles?.length
      !== CONTINUATION_V5_ROUND4_SNAPSHOT_TRUST_ROOT.frozenFileCount
    || snapshot.transitionPayloadFiles?.length
      !== CONTINUATION_V5_ROUND4_SNAPSHOT_TRUST_ROOT.transitionPayloadFileCount
    || snapshot.baselineFiles?.length
      !== CONTINUATION_V5_ROUND4_SNAPSHOT_TRUST_ROOT.baselineFileCount) {
    throw new Error("Round4 snapshot differs from its hard rejection root");
  }

  for (let index = 0; index < receipts.length; index += 1) {
    const expected = CONTINUATION_V5_ROUND4_RECEIPT_TRUST_ROOTS[index];
    assertNoErrors(validateContinuationReviewReceiptV4(
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
    ), `Round4 ${expected.lane} failed receipt`);
    if (hashCanonicalV4(receipts[index]) !== expected.canonicalDigest) {
      throw new Error(`Round4 ${expected.lane} receipt canonical root is stale`);
    }
  }
  validateFindingAggregate(receipts);

  for (const relativePath of
    CONTINUATION_V5_ROUND4_REPOSITORY_FORBIDDEN_OUTPUT_PATHS) {
    await captureRequiredAbsentV5(
      path.join(root, relativePath),
      `Round4 forbidden output ${relativePath}`,
      { expectedRoot: root, ledger },
    );
  }

  const witness = withCanonicalDigestV5({
    schemaVersion: 5,
    kind: CONTINUATION_V5_REVIEW_REJECTION_KIND,
    algorithm: CONTINUATION_V5_ALGORITHM,
    programId: policy.programId,
    workstreamId: CONTINUATION_V5_WORKSTREAM_ID,
    featureId: CONTINUATION_V5_FEATURE_ID,
    rejectedRound: CONTINUATION_V5_REJECTED_ROUND,
    recoveryRound: CONTINUATION_V5_ROUND,
    status: "rejected_after_review",
    sourcePolicy: structuredClone(
      CONTINUATION_V5_ROUND4_POLICY_TRUST_ROOT,
    ),
    sourceSnapshot: structuredClone(
      CONTINUATION_V5_ROUND4_SNAPSHOT_TRUST_ROOT,
    ),
    failedReceipts: CONTINUATION_V5_ROUND4_RECEIPT_TRUST_ROOTS.map(
      (entry) => structuredClone(entry),
    ),
    findingIds: [...CONTINUATION_V5_ROUND4_FINDING_IDS],
    findingSetDigest: CONTINUATION_V5_ROUND4_FINDING_SET_DIGEST,
    aggregateFindingCounts: structuredClone(
      CONTINUATION_V5_ROUND4_AGGREGATE_FINDING_COUNTS,
    ),
    repositoryForbiddenOutputs: [
      ...CONTINUATION_V5_ROUND4_REPOSITORY_FORBIDDEN_OUTPUT_PATHS,
    ],
    externalAnchorRule: expectedRejectedRound4AnchorRuleV5(),
    priorRejections: {
      round1CanonicalDigest: CONTINUATION_V5_ROUND1_REJECTION_DIGEST,
      round2: structuredClone(
        CONTINUATION_V5_ROUND2_REJECTION_TRUST_ROOT,
      ),
    },
  });
  assertNoErrors(
    validateRound4ReviewRejectionV5(witness),
    "generated Round4 review-rejection witness",
  );
  const bytes = serializeRound4ReviewRejectionV5(witness);
  await postflightCaptureLedgerV5(ledger);

  let publicationStatus = "not_requested";
  if (outputPath !== undefined) {
    const absoluteOutput = resolveExactOutput(root, outputPath);
    publicationStatus = (await publishPrivateExactV5(
      absoluteOutput,
      bytes,
      {
        expectedRoot: root,
        label: "Round4 review-rejection witness",
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
  if (canonicalJsonV5(counts)
      !== canonicalJsonV5(CONTINUATION_V5_ROUND4_AGGREGATE_FINDING_COUNTS)
    || canonicalJsonV5(findingIds)
      !== canonicalJsonV5(CONTINUATION_V5_ROUND4_FINDING_IDS)) {
    throw new Error("Round4 receipt findings differ from the hard rejection set");
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
    CONTINUATION_V5_ROUND4_REVIEW_REJECTION_PATH,
  );
  if (resolved !== expected) {
    throw new Error(
      "--output must be the exact Round4 review-rejection witness path",
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
  buildConversationDisclosureReviewRejectionV5(
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
