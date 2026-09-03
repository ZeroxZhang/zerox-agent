#!/usr/bin/env node

import { realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  CONTINUATION_V11_ALGORITHM,
  CONTINUATION_V11_FEATURE_ID,
  CONTINUATION_V11_REJECTED_ROUND,
  CONTINUATION_V11_REVIEW_REJECTION_KIND,
  CONTINUATION_V11_ROUND,
  CONTINUATION_V11_ROUND1_REJECTION_DIGEST,
  CONTINUATION_V11_ROUND2_REJECTION_TRUST_ROOT,
  CONTINUATION_V11_ROUND10_AGGREGATE_FINDING_COUNTS,
  CONTINUATION_V11_ROUND10_FINDING_IDS,
  CONTINUATION_V11_ROUND10_FINDING_SET_DIGEST,
  CONTINUATION_V11_ROUND10_POLICY_TRUST_ROOT,
  CONTINUATION_V11_ROUND10_RECEIPT_TRUST_ROOTS,
  CONTINUATION_V11_ROUND10_REPOSITORY_FORBIDDEN_OUTPUT_PATHS,
  CONTINUATION_V11_ROUND10_REVIEW_REJECTION_PATH,
  CONTINUATION_V11_ROUND10_SNAPSHOT_TRUST_ROOT,
  CONTINUATION_V11_WORKSTREAM_ID,
  canonicalJsonV11,
  expectedRejectedRound10AnchorRuleV11,
  serializeRound10ReviewRejectionV11,
  validateRound10ReviewRejectionV11,
  withCanonicalDigestV11,
} from "./conversation-disclosure-continuation-contract-v11.mjs";
import {
  capturePrivateEvidenceV11,
  captureRequiredAbsentV11,
  captureStableFileV11,
  createCaptureLedgerV11,
  postflightCaptureLedgerV11,
  publishPrivateExactV11,
} from "./conversation-disclosure-continuation-runtime-io-v11.mjs";
import {
  hashCanonicalV10,
  validateBaselineArchiveV10,
  validateContinuationPolicyV10,
  validateContinuationReviewReceiptV10,
  validateContinuationReviewSnapshotV10,
} from "./conversation-disclosure-continuation-contract-v10.mjs";

const ROUND10_ARCHIVE_PATH =
  ".zerox/verification/conversation-disclosure/CD03A-round10-baseline-archive.json";

export async function buildConversationDisclosureReviewRejectionV11({
  repositoryRoot = process.cwd(),
  outputPath,
  verifierNow = Date.now(),
} = {}) {
  const root = await canonicalRepositoryRoot(repositoryRoot);
  const ledger = createCaptureLedgerV11();
  const captureRepository = async (
    relativePath,
    label,
    { privateEvidence = false } = {},
  ) => {
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

  const policyCapture = await captureRepository(
    CONTINUATION_V11_ROUND10_POLICY_TRUST_ROOT.path,
    "Round10 rejected policy",
    { privateEvidence: true },
  );
  const snapshotCapture = await captureRepository(
    CONTINUATION_V11_ROUND10_SNAPSHOT_TRUST_ROOT.path,
    "Round10 rejected snapshot",
    { privateEvidence: true },
  );
  const archiveCapture = await captureRepository(
    ROUND10_ARCHIVE_PATH,
    "Round10 baseline archive",
    { privateEvidence: true },
  );
  const receiptCaptures = [];
  for (const rootEntry of CONTINUATION_V11_ROUND10_RECEIPT_TRUST_ROOTS) {
    receiptCaptures.push(await captureRepository(
      rootEntry.path,
      `Round10 ${rootEntry.lane} completed receipt`,
      { privateEvidence: true },
    ));
  }

  assertByteRoot(
    policyCapture.digest,
    CONTINUATION_V11_ROUND10_POLICY_TRUST_ROOT.byteSha256,
    "Round10 policy",
  );
  assertByteRoot(
    snapshotCapture.digest,
    CONTINUATION_V11_ROUND10_SNAPSHOT_TRUST_ROOT.byteSha256,
    "Round10 snapshot",
  );
  const policy = parseJson(policyCapture.bytes, "Round10 policy");
  const snapshot = parseJson(snapshotCapture.bytes, "Round10 snapshot");
  const archive = parseJson(archiveCapture.bytes, "Round10 baseline archive");
  const receipts = receiptCaptures.map((capture, index) => {
    const expected = CONTINUATION_V11_ROUND10_RECEIPT_TRUST_ROOTS[index];
    assertByteRoot(
      capture.digest,
      expected.byteSha256,
      `Round10 ${expected.lane} receipt`,
    );
    return parseJson(capture.bytes, `Round10 ${expected.lane} receipt`);
  });

  assertNoErrors(validateContinuationPolicyV10(policy, {
    expectedDigest:
      CONTINUATION_V11_ROUND10_POLICY_TRUST_ROOT.canonicalDigest,
    baselineArchive: archive,
  }), "Round10 rejected policy");
  assertNoErrors(validateBaselineArchiveV10(archive, policy),
    "Round10 baseline archive");
  assertNoErrors(validateContinuationReviewSnapshotV10(snapshot, policy, {
    verifierNow,
  }), "Round10 rejected snapshot");
  if (snapshot.digest
    !== CONTINUATION_V11_ROUND10_SNAPSHOT_TRUST_ROOT.canonicalDigest
    || snapshot.frozenFiles?.length
      !== CONTINUATION_V11_ROUND10_SNAPSHOT_TRUST_ROOT.frozenFileCount
    || snapshot.transitionPayloadFiles?.length
      !== CONTINUATION_V11_ROUND10_SNAPSHOT_TRUST_ROOT.transitionPayloadFileCount
    || snapshot.baselineFiles?.length
      !== CONTINUATION_V11_ROUND10_SNAPSHOT_TRUST_ROOT.baselineFileCount) {
    throw new Error("Round10 snapshot differs from its hard rejection root");
  }

  for (let index = 0; index < receipts.length; index += 1) {
    const expected = CONTINUATION_V11_ROUND10_RECEIPT_TRUST_ROOTS[index];
    assertNoErrors(validateContinuationReviewReceiptV10(
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
    ), `Round10 ${expected.lane} completed receipt`);
    if (hashCanonicalV10(receipts[index]) !== expected.canonicalDigest) {
      throw new Error(`Round10 ${expected.lane} receipt canonical root is stale`);
    }
  }
  validateFindingAggregate(receipts);

  for (const relativePath of
    CONTINUATION_V11_ROUND10_REPOSITORY_FORBIDDEN_OUTPUT_PATHS) {
    await captureRequiredAbsentV11(
      path.join(root, relativePath),
      `Round10 forbidden output ${relativePath}`,
      { expectedRoot: root, ledger },
    );
  }

  const witness = withCanonicalDigestV11({
    schemaVersion: 11,
    kind: CONTINUATION_V11_REVIEW_REJECTION_KIND,
    algorithm: CONTINUATION_V11_ALGORITHM,
    programId: policy.programId,
    workstreamId: CONTINUATION_V11_WORKSTREAM_ID,
    featureId: CONTINUATION_V11_FEATURE_ID,
    rejectedRound: CONTINUATION_V11_REJECTED_ROUND,
    recoveryRound: CONTINUATION_V11_ROUND,
    status: "rejected_after_review",
    sourcePolicy: structuredClone(
      CONTINUATION_V11_ROUND10_POLICY_TRUST_ROOT,
    ),
    sourceSnapshot: structuredClone(
      CONTINUATION_V11_ROUND10_SNAPSHOT_TRUST_ROOT,
    ),
    completedReceipts: CONTINUATION_V11_ROUND10_RECEIPT_TRUST_ROOTS.map(
      (entry) => structuredClone(entry),
    ),
    findingIds: [...CONTINUATION_V11_ROUND10_FINDING_IDS],
    findingSetDigest: CONTINUATION_V11_ROUND10_FINDING_SET_DIGEST,
    aggregateFindingCounts: structuredClone(
      CONTINUATION_V11_ROUND10_AGGREGATE_FINDING_COUNTS,
    ),
    repositoryForbiddenOutputs: [
      ...CONTINUATION_V11_ROUND10_REPOSITORY_FORBIDDEN_OUTPUT_PATHS,
    ],
    externalAnchorRule: expectedRejectedRound10AnchorRuleV11(),
    priorRejections: {
      round1CanonicalDigest: CONTINUATION_V11_ROUND1_REJECTION_DIGEST,
      round2: structuredClone(
        CONTINUATION_V11_ROUND2_REJECTION_TRUST_ROOT,
      ),
    },
  });
  assertNoErrors(
    validateRound10ReviewRejectionV11(witness),
    "generated Round10 review-rejection witness",
  );
  const bytes = serializeRound10ReviewRejectionV11(witness);
  await postflightCaptureLedgerV11(ledger);

  let publicationStatus = "not_requested";
  if (outputPath !== undefined) {
    const absoluteOutput = resolveExactOutput(root, outputPath);
    publicationStatus = (await publishPrivateExactV11(
      absoluteOutput,
      bytes,
      {
        expectedRoot: root,
        label: "Round10 review-rejection witness",
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
  if (canonicalJsonV11(counts)
      !== canonicalJsonV11(CONTINUATION_V11_ROUND10_AGGREGATE_FINDING_COUNTS)
    || canonicalJsonV11(findingIds)
      !== canonicalJsonV11(CONTINUATION_V11_ROUND10_FINDING_IDS)) {
    throw new Error("Round10 receipt findings differ from the hard rejection set");
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
    CONTINUATION_V11_ROUND10_REVIEW_REJECTION_PATH,
  );
  if (resolved !== expected) {
    throw new Error(
      "--output must be the exact Round10 review-rejection witness path",
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
  buildConversationDisclosureReviewRejectionV11(
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
