#!/usr/bin/env node

import { realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  CONTINUATION_V4_ALGORITHM,
  CONTINUATION_V4_FEATURE_ID,
  CONTINUATION_V4_REJECTED_ROUND,
  CONTINUATION_V4_REVIEW_REJECTION_KIND,
  CONTINUATION_V4_ROUND,
  CONTINUATION_V4_ROUND1_REJECTION_DIGEST,
  CONTINUATION_V4_ROUND2_REJECTION_TRUST_ROOT,
  CONTINUATION_V4_ROUND3_AGGREGATE_FINDING_COUNTS,
  CONTINUATION_V4_ROUND3_FINDING_IDS,
  CONTINUATION_V4_ROUND3_FINDING_SET_DIGEST,
  CONTINUATION_V4_ROUND3_POLICY_TRUST_ROOT,
  CONTINUATION_V4_ROUND3_RECEIPT_TRUST_ROOTS,
  CONTINUATION_V4_ROUND3_REPOSITORY_FORBIDDEN_OUTPUT_PATHS,
  CONTINUATION_V4_ROUND3_REVIEW_REJECTION_PATH,
  CONTINUATION_V4_ROUND3_SNAPSHOT_TRUST_ROOT,
  CONTINUATION_V4_WORKSTREAM_ID,
  canonicalJsonV4,
  expectedRejectedRound3AnchorRuleV4,
  serializeRound3ReviewRejectionV4,
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
import {
  validateBaselineArchiveV3,
  validateContinuationPolicyV3,
  validateContinuationReviewReceiptV3,
  validateContinuationReviewSnapshotV3,
} from "./conversation-disclosure-continuation-contract-v3.mjs";

const ROUND3_ARCHIVE_PATH =
  ".zerox/verification/conversation-disclosure/CD03A-round3-baseline-archive.json";

export async function buildConversationDisclosureReviewRejectionV4({
  repositoryRoot = process.cwd(),
  outputPath,
  verifierNow = Date.now(),
} = {}) {
  const root = await canonicalRepositoryRoot(repositoryRoot);
  const ledger = createCaptureLedgerV4();
  const captureRepository = async (
    relativePath,
    label,
    { privateEvidence = false } = {},
  ) => {
    const absolutePath = path.join(root, relativePath);
    return privateEvidence
      ? capturePrivateEvidenceV4(absolutePath, label, {
        expectedRoot: root,
        ledger,
      })
      : captureStableFileV4(absolutePath, label, {
        expectedRoot: root,
        ledger,
      });
  };

  const policyCapture = await captureRepository(
    CONTINUATION_V4_ROUND3_POLICY_TRUST_ROOT.path,
    "Round3 rejected policy",
    { privateEvidence: true },
  );
  const snapshotCapture = await captureRepository(
    CONTINUATION_V4_ROUND3_SNAPSHOT_TRUST_ROOT.path,
    "Round3 rejected snapshot",
    { privateEvidence: true },
  );
  const archiveCapture = await captureRepository(
    ROUND3_ARCHIVE_PATH,
    "Round3 baseline archive",
  );
  const receiptCaptures = [];
  for (const rootEntry of CONTINUATION_V4_ROUND3_RECEIPT_TRUST_ROOTS) {
    receiptCaptures.push(await captureRepository(
      rootEntry.path,
      `Round3 ${rootEntry.lane} failed receipt`,
    ));
  }

  assertByteRoot(
    policyCapture.digest,
    CONTINUATION_V4_ROUND3_POLICY_TRUST_ROOT.byteSha256,
    "Round3 policy",
  );
  assertByteRoot(
    snapshotCapture.digest,
    CONTINUATION_V4_ROUND3_SNAPSHOT_TRUST_ROOT.byteSha256,
    "Round3 snapshot",
  );
  const policy = parseJson(policyCapture.bytes, "Round3 policy");
  const snapshot = parseJson(snapshotCapture.bytes, "Round3 snapshot");
  const archive = parseJson(archiveCapture.bytes, "Round3 baseline archive");
  const receipts = receiptCaptures.map((capture, index) => {
    const expected = CONTINUATION_V4_ROUND3_RECEIPT_TRUST_ROOTS[index];
    assertByteRoot(
      capture.digest,
      expected.byteSha256,
      `Round3 ${expected.lane} receipt`,
    );
    return parseJson(capture.bytes, `Round3 ${expected.lane} receipt`);
  });

  assertNoErrors(validateContinuationPolicyV3(policy, {
    expectedDigest:
      CONTINUATION_V4_ROUND3_POLICY_TRUST_ROOT.canonicalDigest,
    baselineArchive: archive,
  }), "Round3 rejected policy");
  assertNoErrors(validateBaselineArchiveV3(archive, policy),
    "Round3 baseline archive");
  assertNoErrors(validateContinuationReviewSnapshotV3(snapshot, policy, {
    verifierNow,
  }), "Round3 rejected snapshot");
  if (snapshot.digest
    !== CONTINUATION_V4_ROUND3_SNAPSHOT_TRUST_ROOT.canonicalDigest
    || snapshot.frozenFiles?.length
      !== CONTINUATION_V4_ROUND3_SNAPSHOT_TRUST_ROOT.frozenFileCount
    || snapshot.transitionPayloadFiles?.length
      !== CONTINUATION_V4_ROUND3_SNAPSHOT_TRUST_ROOT.transitionPayloadFileCount
    || snapshot.baselineFiles?.length
      !== CONTINUATION_V4_ROUND3_SNAPSHOT_TRUST_ROOT.baselineFileCount) {
    throw new Error("Round3 snapshot differs from its hard rejection root");
  }

  for (let index = 0; index < receipts.length; index += 1) {
    const expected = CONTINUATION_V4_ROUND3_RECEIPT_TRUST_ROOTS[index];
    assertNoErrors(validateContinuationReviewReceiptV3(
      receipts[index],
      snapshot,
      policy,
      {
        expectedChallenge: expected.challenge,
        expectedCanonicalDigest: expected.canonicalDigest,
        verifierNow,
      },
    ), `Round3 ${expected.lane} failed receipt`);
  }
  validateFindingAggregate(receipts);

  for (const relativePath of
    CONTINUATION_V4_ROUND3_REPOSITORY_FORBIDDEN_OUTPUT_PATHS) {
    await captureRequiredAbsentV4(
      path.join(root, relativePath),
      `Round3 forbidden output ${relativePath}`,
      { expectedRoot: root, ledger },
    );
  }

  const witness = withCanonicalDigestV4({
    schemaVersion: 4,
    kind: CONTINUATION_V4_REVIEW_REJECTION_KIND,
    algorithm: CONTINUATION_V4_ALGORITHM,
    programId: policy.programId,
    workstreamId: CONTINUATION_V4_WORKSTREAM_ID,
    featureId: CONTINUATION_V4_FEATURE_ID,
    rejectedRound: CONTINUATION_V4_REJECTED_ROUND,
    recoveryRound: CONTINUATION_V4_ROUND,
    status: "rejected_after_review",
    sourcePolicy: structuredClone(
      CONTINUATION_V4_ROUND3_POLICY_TRUST_ROOT,
    ),
    sourceSnapshot: structuredClone(
      CONTINUATION_V4_ROUND3_SNAPSHOT_TRUST_ROOT,
    ),
    failedReceipts: CONTINUATION_V4_ROUND3_RECEIPT_TRUST_ROOTS.map(
      (entry) => structuredClone(entry),
    ),
    findingIds: [...CONTINUATION_V4_ROUND3_FINDING_IDS],
    findingSetDigest: CONTINUATION_V4_ROUND3_FINDING_SET_DIGEST,
    aggregateFindingCounts: structuredClone(
      CONTINUATION_V4_ROUND3_AGGREGATE_FINDING_COUNTS,
    ),
    repositoryForbiddenOutputs: [
      ...CONTINUATION_V4_ROUND3_REPOSITORY_FORBIDDEN_OUTPUT_PATHS,
    ],
    externalAnchorRule: expectedRejectedRound3AnchorRuleV4(),
    priorRejections: {
      round1CanonicalDigest: CONTINUATION_V4_ROUND1_REJECTION_DIGEST,
      round2: structuredClone(
        CONTINUATION_V4_ROUND2_REJECTION_TRUST_ROOT,
      ),
    },
  });
  assertNoErrors(
    validateRound3ReviewRejectionV4(witness),
    "generated Round3 review-rejection witness",
  );
  const bytes = serializeRound3ReviewRejectionV4(witness);
  await postflightCaptureLedgerV4(ledger);

  let publicationStatus = "not_requested";
  if (outputPath !== undefined) {
    const absoluteOutput = resolveExactOutput(root, outputPath);
    publicationStatus = (await publishPrivateExactV4(
      absoluteOutput,
      bytes,
      {
        expectedRoot: root,
        label: "Round3 review-rejection witness",
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
  if (canonicalJsonV4(counts)
      !== canonicalJsonV4(CONTINUATION_V4_ROUND3_AGGREGATE_FINDING_COUNTS)
    || canonicalJsonV4(findingIds)
      !== canonicalJsonV4(CONTINUATION_V4_ROUND3_FINDING_IDS)) {
    throw new Error("Round3 receipt findings differ from the hard rejection set");
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
    CONTINUATION_V4_ROUND3_REVIEW_REJECTION_PATH,
  );
  if (resolved !== expected) {
    throw new Error(
      "--output must be the exact Round3 review-rejection witness path",
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
  buildConversationDisclosureReviewRejectionV4(
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
