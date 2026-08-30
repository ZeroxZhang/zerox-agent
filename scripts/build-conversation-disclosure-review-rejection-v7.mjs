#!/usr/bin/env node

import { realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  CONTINUATION_V7_ALGORITHM,
  CONTINUATION_V7_FEATURE_ID,
  CONTINUATION_V7_REJECTED_ROUND,
  CONTINUATION_V7_REVIEW_REJECTION_KIND,
  CONTINUATION_V7_ROUND,
  CONTINUATION_V7_ROUND1_REJECTION_DIGEST,
  CONTINUATION_V7_ROUND2_REJECTION_TRUST_ROOT,
  CONTINUATION_V7_ROUND6_AGGREGATE_FINDING_COUNTS,
  CONTINUATION_V7_ROUND6_FINDING_IDS,
  CONTINUATION_V7_ROUND6_FINDING_SET_DIGEST,
  CONTINUATION_V7_ROUND6_POLICY_TRUST_ROOT,
  CONTINUATION_V7_ROUND6_RECEIPT_TRUST_ROOTS,
  CONTINUATION_V7_ROUND6_REPOSITORY_FORBIDDEN_OUTPUT_PATHS,
  CONTINUATION_V7_ROUND6_REVIEW_REJECTION_PATH,
  CONTINUATION_V7_ROUND6_SNAPSHOT_TRUST_ROOT,
  CONTINUATION_V7_WORKSTREAM_ID,
  canonicalJsonV7,
  expectedRejectedRound6AnchorRuleV7,
  serializeRound6ReviewRejectionV7,
  validateRound6ReviewRejectionV7,
  withCanonicalDigestV7,
} from "./conversation-disclosure-continuation-contract-v7.mjs";
import {
  capturePrivateEvidenceV7,
  captureRequiredAbsentV7,
  captureStableFileV7,
  createCaptureLedgerV7,
  postflightCaptureLedgerV7,
  publishPrivateExactV7,
} from "./conversation-disclosure-continuation-runtime-io-v7.mjs";
import {
  hashCanonicalV6,
  validateBaselineArchiveV6,
  validateContinuationPolicyV6,
  validateContinuationReviewReceiptV6,
  validateContinuationReviewSnapshotV6,
} from "./conversation-disclosure-continuation-contract-v6.mjs";

const ROUND6_ARCHIVE_PATH =
  ".zerox/verification/conversation-disclosure/CD03A-round6-baseline-archive.json";

export async function buildConversationDisclosureReviewRejectionV7({
  repositoryRoot = process.cwd(),
  outputPath,
  verifierNow = Date.now(),
} = {}) {
  const root = await canonicalRepositoryRoot(repositoryRoot);
  const ledger = createCaptureLedgerV7();
  const captureRepository = async (
    relativePath,
    label,
    { privateEvidence = false } = {},
  ) => {
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

  const policyCapture = await captureRepository(
    CONTINUATION_V7_ROUND6_POLICY_TRUST_ROOT.path,
    "Round6 rejected policy",
    { privateEvidence: true },
  );
  const snapshotCapture = await captureRepository(
    CONTINUATION_V7_ROUND6_SNAPSHOT_TRUST_ROOT.path,
    "Round6 rejected snapshot",
    { privateEvidence: true },
  );
  const archiveCapture = await captureRepository(
    ROUND6_ARCHIVE_PATH,
    "Round6 baseline archive",
    { privateEvidence: true },
  );
  const receiptCaptures = [];
  for (const rootEntry of CONTINUATION_V7_ROUND6_RECEIPT_TRUST_ROOTS) {
    receiptCaptures.push(await captureRepository(
      rootEntry.path,
      `Round6 ${rootEntry.lane} failed receipt`,
      { privateEvidence: true },
    ));
  }

  assertByteRoot(
    policyCapture.digest,
    CONTINUATION_V7_ROUND6_POLICY_TRUST_ROOT.byteSha256,
    "Round6 policy",
  );
  assertByteRoot(
    snapshotCapture.digest,
    CONTINUATION_V7_ROUND6_SNAPSHOT_TRUST_ROOT.byteSha256,
    "Round6 snapshot",
  );
  const policy = parseJson(policyCapture.bytes, "Round6 policy");
  const snapshot = parseJson(snapshotCapture.bytes, "Round6 snapshot");
  const archive = parseJson(archiveCapture.bytes, "Round6 baseline archive");
  const receipts = receiptCaptures.map((capture, index) => {
    const expected = CONTINUATION_V7_ROUND6_RECEIPT_TRUST_ROOTS[index];
    assertByteRoot(
      capture.digest,
      expected.byteSha256,
      `Round6 ${expected.lane} receipt`,
    );
    return parseJson(capture.bytes, `Round6 ${expected.lane} receipt`);
  });

  assertNoErrors(validateContinuationPolicyV6(policy, {
    expectedDigest:
      CONTINUATION_V7_ROUND6_POLICY_TRUST_ROOT.canonicalDigest,
    baselineArchive: archive,
  }), "Round6 rejected policy");
  assertNoErrors(validateBaselineArchiveV6(archive, policy),
    "Round6 baseline archive");
  assertNoErrors(validateContinuationReviewSnapshotV6(snapshot, policy, {
    verifierNow,
  }), "Round6 rejected snapshot");
  if (snapshot.digest
    !== CONTINUATION_V7_ROUND6_SNAPSHOT_TRUST_ROOT.canonicalDigest
    || snapshot.frozenFiles?.length
      !== CONTINUATION_V7_ROUND6_SNAPSHOT_TRUST_ROOT.frozenFileCount
    || snapshot.transitionPayloadFiles?.length
      !== CONTINUATION_V7_ROUND6_SNAPSHOT_TRUST_ROOT.transitionPayloadFileCount
    || snapshot.baselineFiles?.length
      !== CONTINUATION_V7_ROUND6_SNAPSHOT_TRUST_ROOT.baselineFileCount) {
    throw new Error("Round6 snapshot differs from its hard rejection root");
  }

  for (let index = 0; index < receipts.length; index += 1) {
    const expected = CONTINUATION_V7_ROUND6_RECEIPT_TRUST_ROOTS[index];
    assertNoErrors(validateContinuationReviewReceiptV6(
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
    ), `Round6 ${expected.lane} failed receipt`);
    if (hashCanonicalV6(receipts[index]) !== expected.canonicalDigest) {
      throw new Error(`Round6 ${expected.lane} receipt canonical root is stale`);
    }
  }
  validateFindingAggregate(receipts);

  for (const relativePath of
    CONTINUATION_V7_ROUND6_REPOSITORY_FORBIDDEN_OUTPUT_PATHS) {
    await captureRequiredAbsentV7(
      path.join(root, relativePath),
      `Round6 forbidden output ${relativePath}`,
      { expectedRoot: root, ledger },
    );
  }

  const witness = withCanonicalDigestV7({
    schemaVersion: 7,
    kind: CONTINUATION_V7_REVIEW_REJECTION_KIND,
    algorithm: CONTINUATION_V7_ALGORITHM,
    programId: policy.programId,
    workstreamId: CONTINUATION_V7_WORKSTREAM_ID,
    featureId: CONTINUATION_V7_FEATURE_ID,
    rejectedRound: CONTINUATION_V7_REJECTED_ROUND,
    recoveryRound: CONTINUATION_V7_ROUND,
    status: "rejected_after_review",
    sourcePolicy: structuredClone(
      CONTINUATION_V7_ROUND6_POLICY_TRUST_ROOT,
    ),
    sourceSnapshot: structuredClone(
      CONTINUATION_V7_ROUND6_SNAPSHOT_TRUST_ROOT,
    ),
    failedReceipts: CONTINUATION_V7_ROUND6_RECEIPT_TRUST_ROOTS.map(
      (entry) => structuredClone(entry),
    ),
    findingIds: [...CONTINUATION_V7_ROUND6_FINDING_IDS],
    findingSetDigest: CONTINUATION_V7_ROUND6_FINDING_SET_DIGEST,
    aggregateFindingCounts: structuredClone(
      CONTINUATION_V7_ROUND6_AGGREGATE_FINDING_COUNTS,
    ),
    repositoryForbiddenOutputs: [
      ...CONTINUATION_V7_ROUND6_REPOSITORY_FORBIDDEN_OUTPUT_PATHS,
    ],
    externalAnchorRule: expectedRejectedRound6AnchorRuleV7(),
    priorRejections: {
      round1CanonicalDigest: CONTINUATION_V7_ROUND1_REJECTION_DIGEST,
      round2: structuredClone(
        CONTINUATION_V7_ROUND2_REJECTION_TRUST_ROOT,
      ),
    },
  });
  assertNoErrors(
    validateRound6ReviewRejectionV7(witness),
    "generated Round6 review-rejection witness",
  );
  const bytes = serializeRound6ReviewRejectionV7(witness);
  await postflightCaptureLedgerV7(ledger);

  let publicationStatus = "not_requested";
  if (outputPath !== undefined) {
    const absoluteOutput = resolveExactOutput(root, outputPath);
    publicationStatus = (await publishPrivateExactV7(
      absoluteOutput,
      bytes,
      {
        expectedRoot: root,
        label: "Round6 review-rejection witness",
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
  if (canonicalJsonV7(counts)
      !== canonicalJsonV7(CONTINUATION_V7_ROUND6_AGGREGATE_FINDING_COUNTS)
    || canonicalJsonV7(findingIds)
      !== canonicalJsonV7(CONTINUATION_V7_ROUND6_FINDING_IDS)) {
    throw new Error("Round6 receipt findings differ from the hard rejection set");
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
    CONTINUATION_V7_ROUND6_REVIEW_REJECTION_PATH,
  );
  if (resolved !== expected) {
    throw new Error(
      "--output must be the exact Round6 review-rejection witness path",
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
  buildConversationDisclosureReviewRejectionV7(
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
