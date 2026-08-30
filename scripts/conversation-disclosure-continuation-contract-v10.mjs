import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

import {
  CONTINUATION_V2_ROUND1_FORBIDDEN_OUTPUT_PATHS,
  validateAdmissionDefinitionV2,
  validateClosedWorldContractV2,
  validateGovernanceTransitionsV2,
  validateGovernanceTransitionStateV2,
  validateLifecycleStateV2,
  validateParentEvidenceBundleV1,
  validatePathAuthoritiesV2,
  validateRound1RejectionV2,
  validateSuccessorDefinitionV2,
} from "./conversation-disclosure-continuation-contract-v2.mjs";
import {
  canonicalJsonV3,
  hashCanonicalV3,
  repositoryPathV3,
  sha256BytesV3,
  sha256DigestV3,
  stableFeatureDefinitionV3,
  stableHistoricalFeatureDefinitionV3,
  stableProgramRootDefinitionV3,
  stableWorkstreamDefinitionV3,
  validateRound2PrefreezeRejectionV3,
  withCanonicalDigestV3,
} from "./conversation-disclosure-continuation-contract-v3.mjs";
import {
  CONTINUATION_V9_REJECTED_OUTPUT_ABSENT_PATHS,
} from "./conversation-disclosure-continuation-contract-v9.mjs";

export const CONTINUATION_V10_ALGORITHM = "sha256-canonical-json-v1";
export const CONTINUATION_V10_POLICY_KIND =
  "conversation-disclosure-continuation-policy";
export const CONTINUATION_V10_SNAPSHOT_KIND =
  "conversation-disclosure-continuation-review-snapshot";
export const CONTINUATION_V10_RECEIPT_KIND =
  "conversation-disclosure-continuation-review-receipt";
export const CONTINUATION_V10_MANIFEST_KIND =
  "conversation-disclosure-continuation-closure-manifest";
export const CONTINUATION_V10_ATTESTATION_KIND =
  "conversation-disclosure-continuation-external-attestation";
export const CONTINUATION_V10_ANCHOR_KIND =
  "conversation-disclosure-continuation-external-anchor";
export const CONTINUATION_V10_REVIEW_REJECTION_KIND =
  "conversation-disclosure-continuation-review-rejection";
export const CONTINUATION_V10_BASELINE_ARCHIVE_KIND =
  "conversation-disclosure-continuation-baseline-archive";

export const CONTINUATION_V10_POLICY_ID = "CD03A-round10-P108-admission-v10";
export const CONTINUATION_V10_WORKSTREAM_ID = "CD03A";
export const CONTINUATION_V10_FEATURE_ID =
  "P107A-conversation-disclosure-successor-admission";
export const CONTINUATION_V10_SUCCESSOR_WORKSTREAM_ID = "CD04";
export const CONTINUATION_V10_SUCCESSOR_FEATURE_ID =
  "P108-conversation-disclosure-evidence-foundation";
export const CONTINUATION_V10_ROUND = 10;
export const CONTINUATION_V10_REJECTED_ROUND = 9;

export const CONTINUATION_V10_POLICY_PATH =
  ".zerox/verification/conversation-disclosure/CD03A-round10-successor-evolution-policy.json";
export const CONTINUATION_V10_BASELINE_ARCHIVE_PATH =
  ".zerox/verification/conversation-disclosure/CD03A-round10-baseline-archive.json";
export const CONTINUATION_V10_REVIEW_SNAPSHOT_PATH =
  ".zerox/verification/conversation-disclosure/CD03A-round10-review-snapshot.json";
export const CONTINUATION_V10_CLOSURE_MANIFEST_PATH =
  ".zerox/verification/conversation-disclosure/CD03A-round10-closure-manifest.json";
export const CONTINUATION_V10_EXTERNAL_ATTESTATION_PATH =
  ".zerox/verification/conversation-disclosure/CD03A-round10-external-attestation.json";
export const CONTINUATION_V10_ROUND9_REVIEW_REJECTION_PATH =
  ".zerox/verification/conversation-disclosure/CD03A-round9-review-rejection.json";

export const CONTINUATION_V10_ROUND9_POLICY_PATH =
  ".zerox/verification/conversation-disclosure/CD03A-round9-successor-evolution-policy.json";
export const CONTINUATION_V10_ROUND9_SNAPSHOT_PATH =
  ".zerox/verification/conversation-disclosure/CD03A-round9-review-snapshot.json";
export const CONTINUATION_V10_ROUND9_CLOSURE_MANIFEST_PATH =
  ".zerox/verification/conversation-disclosure/CD03A-round9-closure-manifest.json";
export const CONTINUATION_V10_ROUND9_EXTERNAL_ATTESTATION_PATH =
  ".zerox/verification/conversation-disclosure/CD03A-round9-external-attestation.json";

export const CONTINUATION_V10_REVIEW_LANES = Object.freeze([
  "contract", "runtime", "governance",
]);
export const CONTINUATION_V10_LIFECYCLE_PHASES = Object.freeze([
  "rejection_recorded",
  "policy_draft",
  "policy_published",
  "review_pre_transition",
  "review_passed_pending_external_transaction",
  "review_post_transition",
  "anchored_planned",
  "authorized_active",
]);
export const CONTINUATION_V10_LIFECYCLE_PROFILE_PHASES = Object.freeze([
  "review_pre_transition",
  "review_post_transition",
  "anchored_planned",
  "authorized_active",
]);
export const CONTINUATION_V10_EXECUTABLE_KINDS = Object.freeze([
  "checker", "contract", "freezer", "governance", "runner",
]);
export const CONTINUATION_V10_ADMISSION_CLASSES = Object.freeze([
  "frozen_file",
  "transition_live",
  "transition_payload",
  "post_review_mutable",
  "review_output_absent",
  "rejected_output_absent",
]);
export const CONTINUATION_V10_ADMISSION_CLASS_SET_DIGEST =
  hashCanonicalV3(CONTINUATION_V10_ADMISSION_CLASSES);
export const CONTINUATION_V10_EXECUTABLE_PATH_BY_KIND = Object.freeze({
  checker: "scripts/check-conversation-disclosure-continuation-v10.mjs",
  contract: "scripts/conversation-disclosure-continuation-contract-v10.mjs",
  freezer: "scripts/freeze-conversation-disclosure-continuation-v10.mjs",
  governance: "scripts/conversation-disclosure-program-governance-v10.mjs",
  runner: "scripts/verify-conversation-disclosure-continuation-v10.mjs",
});
export const CONTINUATION_V10_GOVERNANCE_TRANSITIONS = Object.freeze({
  "package.json": "package-structure-migration",
  "scripts/check-harness-state.mjs": "harness-delegation-migration",
  "src/shared/conversationDisclosureProgram.test.ts": "program-test-migration",
  "src/shared/packageScripts.test.ts": "package-test-migration",
});
export const CONTINUATION_V10_TARGET_PATH_BY_LIVE_PATH = Object.freeze({
  "package.json":
    ".zerox/verification/conversation-disclosure/CD03A-round10-package.target.json",
  "scripts/check-harness-state.mjs":
    ".zerox/verification/conversation-disclosure/CD03A-round10-harness.target.mjs",
  "src/shared/conversationDisclosureProgram.test.ts":
    ".zerox/verification/conversation-disclosure/CD03A-round10-program-test.target.ts",
  "src/shared/packageScripts.test.ts":
    ".zerox/verification/conversation-disclosure/CD03A-round10-package-scripts-test.target.ts",
});
export const CONTINUATION_V10_GOVERNANCE_TRANSITION_TRUST_ROOTS = Object.freeze([
  Object.freeze({
    path: "package.json",
    kind: CONTINUATION_V10_GOVERNANCE_TRANSITIONS["package.json"],
    fromSha256:
      "sha256:560fb3e3b2829a32b4ac694c7781fce9e53941a9e20fc4ec1c08602d53c278b9",
    stagedTargetPath: CONTINUATION_V10_TARGET_PATH_BY_LIVE_PATH["package.json"],
    toSha256:
      "sha256:931294e32f710cf9ced70b2725d86899d00654c24c8ddcb502760f24ce2bd11f",
  }),
  Object.freeze({
    path: "scripts/check-harness-state.mjs",
    kind: CONTINUATION_V10_GOVERNANCE_TRANSITIONS["scripts/check-harness-state.mjs"],
    fromSha256:
      "sha256:231d28280f6891f50f5c714b4161d1b9d93cf171e0b67396de67ce7a36e06339",
    stagedTargetPath:
      CONTINUATION_V10_TARGET_PATH_BY_LIVE_PATH["scripts/check-harness-state.mjs"],
    toSha256:
      "sha256:80b866506c88f899cf3630dbe1e5d9922bf9f941cbe9de552729fbff502e27fe",
  }),
  Object.freeze({
    path: "src/shared/conversationDisclosureProgram.test.ts",
    kind: CONTINUATION_V10_GOVERNANCE_TRANSITIONS[
      "src/shared/conversationDisclosureProgram.test.ts"
    ],
    fromSha256:
      "sha256:087cff0ba7f208464bf62e41f3a10dfbb88f3f2461d46398187c0b4cfa16dd5c",
    stagedTargetPath:
      CONTINUATION_V10_TARGET_PATH_BY_LIVE_PATH[
        "src/shared/conversationDisclosureProgram.test.ts"
      ],
    toSha256:
      "sha256:171b20c690abaaec33d3bcfd05548f4924bee629005ec0355153f79856646680",
  }),
  Object.freeze({
    path: "src/shared/packageScripts.test.ts",
    kind: CONTINUATION_V10_GOVERNANCE_TRANSITIONS[
      "src/shared/packageScripts.test.ts"
    ],
    fromSha256:
      "sha256:2f30d10ebd5ccc408255813e0d10ca4e8bd145930bdbe263bc2a6e5d2fa61efe",
    stagedTargetPath:
      CONTINUATION_V10_TARGET_PATH_BY_LIVE_PATH["src/shared/packageScripts.test.ts"],
    toSha256:
      "sha256:135611103764f02882e5258bebc20d4778b52a68953ebfec802613eb7a455dd7",
  }),
]);
export const CONTINUATION_V10_CALLER_DISPATCH_ASSURANCE =
  "caller-attested-not-signed";
export const CONTINUATION_V10_IDENTITY_ASSURANCE = "not-signed";
export const CONTINUATION_V10_INDEPENDENCE_CLAIM =
  "caller-attested-distinct-review-contexts";
export const CONTINUATION_V10_CANDIDATE_RESULT_KINDS = Object.freeze([
  "checker",
  "harness",
]);
export const CONTINUATION_V10_CANDIDATE_PATH_BY_KIND = Object.freeze({
  checker: CONTINUATION_V10_EXECUTABLE_PATH_BY_KIND.checker,
  harness: "scripts/check-harness-state.mjs",
});

export const CONTINUATION_V10_ROUND9_POLICY_TRUST_ROOT = Object.freeze({
  path: CONTINUATION_V10_ROUND9_POLICY_PATH,
  byteSha256: "sha256:89ab2781cf8f31a483aba063f11839f0c2e382478c27684e7da093d84e586bce",
  canonicalDigest: "sha256:97c8b003b40d94eb76d0546dc59430d4162ad3618523a6ba2203881adfccc6d1",
});
export const CONTINUATION_V10_ROUND9_SNAPSHOT_TRUST_ROOT = Object.freeze({
  path: CONTINUATION_V10_ROUND9_SNAPSHOT_PATH,
  byteSha256: "sha256:db56d548fff3302d480123e7e231ed83c308ddfb6ea45660d3b448e25423b5b4",
  canonicalDigest: "sha256:ab22feba05bbb2eb4efe8ab58b129e2be3cd7bf203f206babf338b51658aec15",
  frozenFileCount: 258,
  transitionPayloadFileCount: 4,
  baselineFileCount: 12,
});

export const CONTINUATION_V10_ROUND9_RECEIPT_TRUST_ROOTS = Object.freeze([
  Object.freeze({
    lane: "contract",
    path: ".zerox/verification/conversation-disclosure/CD03A-round9-contract-review.json",
    byteSha256: "sha256:2c016a0a0ee7336be0fa0d8bca59be80c0628dd08ff574ebe23355b249b6cd02",
    canonicalDigest: "sha256:5ce894889d0c44db5755dc28d94b7a886a304111ac407eadd5d518d3a304e3bf",
    challenge: "sha256:fde0959cf0eccdee4abc4fddc3826df72920222ae9bddbc0bd6d419d7f5de9a0",
    verdict: "failed",
    findingCounts: Object.freeze({ critical: 0, major: 5, minor: 0 }),
  }),
  Object.freeze({
    lane: "governance",
    path: ".zerox/verification/conversation-disclosure/CD03A-round9-governance-review.json",
    byteSha256: "sha256:e6831b8f6837b139914c04b04f90b4a6384c1f937709180e83c56f882ddbeab2",
    canonicalDigest: "sha256:e07d67f1319d2c00cd4b482b2f92b2cd11511a3d93093111027e931ba52ab127",
    challenge: "sha256:2b913b16a55970cfbbf0d223636f14ecf93a80c89f41036dc62a0c8ee0cae8bf",
    verdict: "passed",
    findingCounts: Object.freeze({ critical: 0, major: 0, minor: 0 }),
  }),
]);

export const CONTINUATION_V10_ROUND9_FINDING_IDS = Object.freeze([
  "R9-CONTRACT-001",
  "R9-CONTRACT-002",
  "R9-CONTRACT-003",
  "R9-CONTRACT-004",
  "R9-CONTRACT-005",
]);
export const CONTINUATION_V10_ROUND9_FINDING_SET_DIGEST =
  "sha256:49875d7f1bfeaf06c5d46efde519c24b178adf0bf294c88fc77f5fb8859ba5c8";
export const CONTINUATION_V10_ROUND9_AGGREGATE_FINDING_COUNTS = Object.freeze({
  critical: 0,
  major: 5,
  minor: 0,
});
export const CONTINUATION_V10_ROUND1_REJECTION_DIGEST =
  "sha256:ec981e92f486ae75a56b3b4b393f95d095f6d684e6af54fe12cc7a9ba0fe1f99";
export const CONTINUATION_V10_ROUND2_REJECTION_TRUST_ROOT = Object.freeze({
  path: ".zerox/verification/conversation-disclosure/CD03A-round2-prefreeze-rejection.json",
  byteSha256: "sha256:f677b1fc8cb4113ebb0c69c3b187a8b229156002e7d769764ca4e2d29677e3b9",
  canonicalDigest: "sha256:75a01cdef04821f1d1ca447a5b2383d8d47be331bec7777017042bf90fcf6614",
});

export const CONTINUATION_V10_ROUND9_REPOSITORY_FORBIDDEN_OUTPUT_PATHS =
  Object.freeze([
    ".zerox/verification/conversation-disclosure/CD03A-round9-runtime-review.json",
    CONTINUATION_V10_ROUND9_CLOSURE_MANIFEST_PATH,
    CONTINUATION_V10_ROUND9_EXTERNAL_ATTESTATION_PATH,
  ].sort());
export const CONTINUATION_V10_ROUND1_REPOSITORY_FORBIDDEN_OUTPUT_PATHS =
  Object.freeze([...CONTINUATION_V2_ROUND1_FORBIDDEN_OUTPUT_PATHS].sort());
export const CONTINUATION_V10_REJECTED_OUTPUT_ABSENT_PATHS = Object.freeze([
  ...new Set([
    ...CONTINUATION_V2_ROUND1_FORBIDDEN_OUTPUT_PATHS,
    ...CONTINUATION_V9_REJECTED_OUTPUT_ABSENT_PATHS,
    ...CONTINUATION_V10_ROUND9_REPOSITORY_FORBIDDEN_OUTPUT_PATHS,
  ]),
].sort());
export const CONTINUATION_V10_REVIEW_OUTPUT_PATHS = Object.freeze([
  CONTINUATION_V10_REVIEW_SNAPSHOT_PATH,
  ...CONTINUATION_V10_REVIEW_LANES.map((lane) =>
    `.zerox/verification/conversation-disclosure/CD03A-round10-${lane}-review.json`),
  CONTINUATION_V10_CLOSURE_MANIFEST_PATH,
  CONTINUATION_V10_EXTERNAL_ATTESTATION_PATH,
].sort());

export const CONTINUATION_V10_RUNTIME_IO_INTERFACE = Object.freeze({
  schemaVersion: 1,
  methods: Object.freeze([
    "createCaptureLedgerV10",
    "captureStableFileV10",
    "capturePrivateEvidenceV10",
    "captureRequiredAbsentV10",
    "postflightCaptureLedgerV10",
    "publishPrivateExactV10",
  ]),
});

const ROUND9_REJECTION_KEYS = Object.freeze([
  "aggregateFindingCounts",
  "algorithm",
  "digest",
  "externalAnchorRule",
  "completedReceipts",
  "featureId",
  "findingIds",
  "findingSetDigest",
  "kind",
  "priorRejections",
  "programId",
  "recoveryRound",
  "rejectedRound",
  "repositoryForbiddenOutputs",
  "schemaVersion",
  "sourcePolicy",
  "sourceSnapshot",
  "status",
  "workstreamId",
]);
const POLICY_REFERENCE_KEYS = Object.freeze([
  "byteSha256", "canonicalDigest", "path",
]);
const SNAPSHOT_REFERENCE_KEYS = Object.freeze([
  "baselineFileCount", "byteSha256", "canonicalDigest", "frozenFileCount",
  "path", "transitionPayloadFileCount",
]);
const COMPLETED_RECEIPT_REFERENCE_KEYS = Object.freeze([
  "byteSha256", "canonicalDigest", "challenge", "findingCounts", "lane", "path",
  "verdict",
]);
const FINDING_COUNT_KEYS = Object.freeze(["critical", "major", "minor"]);
const EXTERNAL_ANCHOR_RULE_KEYS = Object.freeze([
  "admissibility", "externalAbsenceClaim", "policyDigest", "snapshotDigest",
]);
const PRIOR_REJECTION_KEYS = Object.freeze([
  "round1CanonicalDigest", "round2",
]);

const POLICY_KEYS = Object.freeze([
  "admission",
  "admissionClassSet",
  "admissionClassSetDigest",
  "admissionCoverage",
  "algorithm",
  "baselineArchive",
  "closedWorld",
  "continuationExecutables",
  "digest",
  "externalAnchorPolicy",
  "featureId",
  "governanceTransitions",
  "kind",
  "parentEvidence",
  "pathAuthorities",
  "policyId",
  "programId",
  "reviewAssurancePolicy",
  "reviewSnapshot",
  "round",
  "round1Rejection",
  "round2PrefreezeRejection",
  "round9ReviewRejection",
  "schemaVersion",
  "status",
  "successor",
  "timePolicy",
  "trustRoots",
  "workstreamId",
]);
const SNAPSHOT_KEYS = Object.freeze([
  "absentPaths",
  "admissionClassSetDigest",
  "admissionFeatureDefinitionDigest",
  "admissionFeatureFileSetDigest",
  "algorithm",
  "baselineArchive",
  "baselineFiles",
  "closedWorldDigest",
  "digest",
  "featureId",
  "frozenAt",
  "frozenFiles",
  "governanceTransitions",
  "kind",
  "parentEvidenceBundleDigest",
  "pathAuthorityDigest",
  "policyDigest",
  "programId",
  "reviewOutputAbsentPaths",
  "round",
  "round9ReviewRejectionDigest",
  "schemaVersion",
  "successorFeatureDefinitionDigest",
  "successorWorkstreamDefinitionDigest",
  "transitionPayloadFiles",
  "workstreamId",
]);
const ARCHIVE_KEYS = Object.freeze([
  "algorithm",
  "digest",
  "entries",
  "entrySetDigest",
  "featureId",
  "kind",
  "programId",
  "round",
  "schemaVersion",
  "workstreamId",
]);
const ARCHIVE_ENTRY_KEYS = Object.freeze([
  "bytes",
  "encoding",
  "path",
  "sha256",
  "source",
]);
const FILE_DIGEST_KEYS = Object.freeze(["path", "sha256"]);
const COVERAGE_KEYS = Object.freeze(["class", "path"]);
const RECEIPT_KEYS = Object.freeze([
  "admissionFeatureDefinitionDigest",
  "admissionFeatureFileSetDigest",
  "callerDispatchEntryDigest",
  "callerDispatchSetDigest",
  "challenge",
  "claimedReviewOrigin",
  "closedWorldDigest",
  "completedAt",
  "featureId",
  "findingCounts",
  "findings",
  "identityAssurance",
  "independenceClaim",
  "kind",
  "lane",
  "parentEvidenceBundleDigest",
  "pathAuthorityDigest",
  "policyDigest",
  "programId",
  "reviewedPhase",
  "round",
  "round9ReviewRejectionDigest",
  "schemaVersion",
  "snapshotDigest",
  "snapshotFileCount",
  "successorFeatureDefinitionDigest",
  "successorWorkstreamDefinitionDigest",
  "validatorDigest",
  "verdict",
  "workstreamId",
]);
const CLAIMED_ORIGIN_KEYS = Object.freeze(["agentLabel", "taskPath", "transport"]);
const FINDING_KEYS = Object.freeze(["evidence", "id", "severity", "summary"]);
const DISPATCH_SET_ENTRY_KEYS = Object.freeze([
  "agentLabel", "assurance", "challenge", "instructionDigest", "lane",
  "reviewContextId", "taskPath", "transport",
]);
const REVIEW_REFERENCE_KEYS = Object.freeze([
  "canonicalDigest", "challenge", "lane", "path",
]);
const MANIFEST_KEYS = Object.freeze([
  "callerDispatchSet",
  "digest",
  "externalAttestation",
  "externalRunner",
  "featureId",
  "kind",
  "parentEvidenceBundleDigest",
  "pendingManifestDigest",
  "policy",
  "programId",
  "reviewReceipts",
  "round",
  "round9ReviewRejection",
  "schemaVersion",
  "snapshot",
  "status",
  "validator",
  "workstreamId",
]);
const ATTESTATION_KEYS = Object.freeze([
  "callerDispatchSet",
  "candidateResults",
  "completedAt",
  "digest",
  "governancePhase",
  "identityAssurance",
  "kind",
  "parentEvidenceBundleDigest",
  "pendingManifestDigest",
  "policyDigest",
  "repositoryRealpath",
  "reviewAssurance",
  "round9ReviewRejectionDigest",
  "runnerDigest",
  "schemaVersion",
  "snapshotDigest",
  "status",
  "validatorDigest",
]);
const ANCHOR_KEYS = Object.freeze([
  "attestationDigest",
  "callerDispatchSet",
  "candidateResults",
  "completedAt",
  "digest",
  "head",
  "identityAssurance",
  "kind",
  "parentEvidenceBundleDigest",
  "policyDigest",
  "repositoryRealpath",
  "reviewAssurance",
  "round9ReviewRejectionDigest",
  "runnerDigest",
  "schemaVersion",
  "snapshotDigest",
  "validatorDigest",
]);
const CANDIDATE_RESULT_KEYS = Object.freeze([
  "kind", "path", "receiptDigest", "status", "stderrDigest", "stdoutDigest",
]);
const ANCHOR_HEAD_KEYS = Object.freeze([
  "featureId",
  "kind",
  "snapshotDigest",
  "status",
  "successorFeatureDefinitionDigest",
  "successorWorkstreamDefinitionDigest",
  "workstreamId",
]);

export const CONTINUATION_V10_POLICY_KEYS = POLICY_KEYS;
export const CONTINUATION_V10_SNAPSHOT_KEYS = SNAPSHOT_KEYS;
export const CONTINUATION_V10_BASELINE_ARCHIVE_KEYS = ARCHIVE_KEYS;
export const CONTINUATION_V10_REVIEW_REJECTION_KEYS = ROUND9_REJECTION_KEYS;
export const CONTINUATION_V10_RECEIPT_KEYS = RECEIPT_KEYS;
export const CONTINUATION_V10_MANIFEST_KEYS = MANIFEST_KEYS;

export const canonicalJsonV10 = canonicalJsonV3;
export const hashCanonicalV10 = hashCanonicalV3;
export const sha256BytesV10 = sha256BytesV3;
export const sha256DigestV10 = sha256DigestV3;
export const repositoryPathV10 = repositoryPathV3;
export const withCanonicalDigestV10 = withCanonicalDigestV3;
export const stableFeatureDefinitionV10 = stableFeatureDefinitionV3;
export const stableHistoricalFeatureDefinitionV10 =
  stableHistoricalFeatureDefinitionV3;
export const stableProgramRootDefinitionV10 = stableProgramRootDefinitionV3;
export const stableWorkstreamDefinitionV10 = stableWorkstreamDefinitionV3;

export function buildAdmissionCoverageV10(
  admission,
  transitions,
  rejectedOutputAbsentPaths = CONTINUATION_V10_REJECTED_OUTPUT_ABSENT_PATHS,
) {
  const files = admission?.featureDefinition?.files;
  if (!Array.isArray(files) || files.length === 0
    || new Set(files).size !== files.length
    || files.some((entry) => !repositoryPathV10(entry))) {
    throw new TypeError("P107A exact V10 file roster is invalid");
  }
  if (canonicalJsonV10(rejectedOutputAbsentPaths)
    !== canonicalJsonV10(CONTINUATION_V10_REJECTED_OUTPUT_ABSENT_PATHS)) {
    throw new TypeError("V10 rejected-output absence roster is not exact");
  }
  const byClass = new Map(CONTINUATION_V10_ADMISSION_CLASSES.map((entry) => [
    entry,
    new Set(),
  ]));
  for (const transition of transitions ?? []) {
    byClass.get("transition_live").add(transition.path);
    byClass.get("transition_payload").add(transition.stagedTargetPath);
  }
  for (const entry of admission.postReviewMutablePaths ?? []) {
    byClass.get("post_review_mutable").add(entry);
  }
  for (const entry of admission.reviewOutputPaths ?? []) {
    byClass.get("review_output_absent").add(entry);
  }
  for (const entry of rejectedOutputAbsentPaths) {
    byClass.get("rejected_output_absent").add(entry);
  }
  return files.map((relativePath) => {
    const classes = CONTINUATION_V10_ADMISSION_CLASSES.filter((entry) =>
      entry !== "frozen_file" && byClass.get(entry).has(relativePath));
    if (classes.length > 1) {
      throw new TypeError(`V10 path has overlapping admission classes: ${relativePath}`);
    }
    return { path: relativePath, class: classes[0] ?? "frozen_file" };
  }).sort(comparePath);
}

export function validateAdmissionCoverageV10(
  coverage,
  admission,
  transitions,
  rejectedOutputAbsentPaths = CONTINUATION_V10_REJECTED_OUTPUT_ABSENT_PATHS,
) {
  const errors = [];
  if (!Array.isArray(coverage) || coverage.length === 0) {
    return ["admissionCoverage must be a non-empty explicit array"];
  }
  const paths = [];
  for (const [index, entry] of coverage.entries()) {
    if (!plainObject(entry) || !exactKeys(entry, COVERAGE_KEYS)
      || !repositoryPathV10(entry.path)
      || !CONTINUATION_V10_ADMISSION_CLASSES.includes(entry.class)) {
      errors.push(`admissionCoverage[${index}] is invalid`);
      continue;
    }
    paths.push(entry.path);
  }
  validateSortedUnique(paths, "admissionCoverage paths", errors);
  let expected;
  try {
    expected = buildAdmissionCoverageV10(
      admission,
      transitions,
      rejectedOutputAbsentPaths,
    );
  } catch (error) {
    errors.push(error.message);
  }
  if (expected && canonicalJsonV10(coverage) !== canonicalJsonV10(expected)) {
    errors.push("admissionCoverage differs from the exact V10 classification");
  }
  if (admission?.reviewCoverageDigest !== safeHash(coverage)) {
    errors.push("admission reviewCoverageDigest differs from admissionCoverage");
  }
  for (const requiredClass of CONTINUATION_V10_ADMISSION_CLASSES) {
    if (!coverage.some((entry) => entry?.class === requiredClass)) {
      errors.push(`admissionCoverage omits required class ${requiredClass}`);
    }
  }
  return unique(errors);
}

export function validateRound9ReviewRejectionV10(witness) {
  const errors = [];
  if (!plainObject(witness) || !exactKeys(witness, ROUND9_REJECTION_KEYS)) {
    return ["Round9 review rejection must contain the exact V10 keys"];
  }
  if (witness.schemaVersion !== 10
    || witness.kind !== CONTINUATION_V10_REVIEW_REJECTION_KIND
    || witness.algorithm !== CONTINUATION_V10_ALGORITHM
    || witness.workstreamId !== CONTINUATION_V10_WORKSTREAM_ID
    || witness.featureId !== CONTINUATION_V10_FEATURE_ID
    || witness.rejectedRound !== CONTINUATION_V10_REJECTED_ROUND
    || witness.recoveryRound !== CONTINUATION_V10_ROUND
    || witness.status !== "rejected_after_review"
    || !nonEmpty(witness.programId)) {
    errors.push("Round9 review rejection identity/status is invalid");
  }
  if (!sameExactObject(witness.sourcePolicy,
    CONTINUATION_V10_ROUND9_POLICY_TRUST_ROOT, POLICY_REFERENCE_KEYS)) {
    errors.push("Round9 policy reference differs from both hard trust roots");
  }
  if (!sameExactObject(witness.sourceSnapshot,
    CONTINUATION_V10_ROUND9_SNAPSHOT_TRUST_ROOT, SNAPSHOT_REFERENCE_KEYS)) {
    errors.push("Round9 snapshot reference differs from both hard trust roots");
  }
  validateCompletedReceiptReferences(witness.completedReceipts, errors);
  if (!sameExactObject(witness.aggregateFindingCounts,
    CONTINUATION_V10_ROUND9_AGGREGATE_FINDING_COUNTS, FINDING_COUNT_KEYS)) {
    errors.push("Round9 aggregate finding counts differ from the completed receipts");
  }
  if (canonicalJsonV10(witness.findingIds)
    !== canonicalJsonV10(CONTINUATION_V10_ROUND9_FINDING_IDS)
    || witness.findingSetDigest !== CONTINUATION_V10_ROUND9_FINDING_SET_DIGEST) {
    errors.push("Round9 finding set differs from the hard rejection root");
  }
  if (canonicalJsonV10(witness.repositoryForbiddenOutputs)
    !== canonicalJsonV10(CONTINUATION_V10_ROUND9_REPOSITORY_FORBIDDEN_OUTPUT_PATHS)) {
    errors.push("Round9 repository forbidden-output set is not exact");
  }
  const expectedAnchorRule = expectedRejectedRound9AnchorRuleV10();
  if (!sameExactObject(witness.externalAnchorRule, expectedAnchorRule,
    EXTERNAL_ANCHOR_RULE_KEYS)) {
    errors.push("Round9 external anchor rule is invalid or asserts fictional absence");
  }
  const expectedPrior = {
    round1CanonicalDigest: CONTINUATION_V10_ROUND1_REJECTION_DIGEST,
    round2: CONTINUATION_V10_ROUND2_REJECTION_TRUST_ROOT,
  };
  if (!plainObject(witness.priorRejections)
    || !exactKeys(witness.priorRejections, PRIOR_REJECTION_KEYS)
    || witness.priorRejections.round1CanonicalDigest
      !== expectedPrior.round1CanonicalDigest
    || !sameExactObject(witness.priorRejections.round2,
      expectedPrior.round2, POLICY_REFERENCE_KEYS)) {
    errors.push("Round9 rejection does not bind the exact prior rejection chain");
  }
  validateCanonicalDigest(witness, "Round9 review rejection", errors);
  return unique(errors);
}

export function expectedRejectedRound9AnchorRuleV10() {
  return {
    policyDigest: CONTINUATION_V10_ROUND9_POLICY_TRUST_ROOT.canonicalDigest,
    snapshotDigest: CONTINUATION_V10_ROUND9_SNAPSHOT_TRUST_ROOT.canonicalDigest,
    admissibility: "forbidden",
    externalAbsenceClaim: "not_asserted",
  };
}

export function validateRejectedRound9AnchorSubjectV10(anchor) {
  if (!plainObject(anchor)) return ["external anchor candidate must be an object"];
  if (anchor.policyDigest === CONTINUATION_V10_ROUND9_POLICY_TRUST_ROOT.canonicalDigest
    && anchor.snapshotDigest
      === CONTINUATION_V10_ROUND9_SNAPSHOT_TRUST_ROOT.canonicalDigest) {
    return ["external anchor is bound to the rejected Round9 subject"];
  }
  return [];
}

export function validateRejectedOutputAbsenceCapturesV10(captures) {
  const errors = [];
  if (!Array.isArray(captures)) return ["absence captures must be an array"];
  const expected = CONTINUATION_V10_REJECTED_OUTPUT_ABSENT_PATHS.map((entry) => ({
    path: entry,
    presence: "absent",
  }));
  for (const [index, capture] of captures.entries()) {
    if (!plainObject(capture)
      || !exactKeys(capture, ["path", "presence"])
      || !repositoryPathV10(capture.path)
      || capture.presence !== "absent") {
      errors.push(`absence capture[${index}] is invalid`);
    }
  }
  if (canonicalJsonV10(captures) !== canonicalJsonV10(expected)) {
    errors.push("absence captures differ from the exact rejected-output roster");
  }
  return unique(errors);
}

export function validateRuntimeIoCaptureAdapterV10(adapter) {
  if (adapter === null || (typeof adapter !== "object"
    && typeof adapter !== "function")) {
    return ["runtime I/O adapter must be an object"];
  }
  return CONTINUATION_V10_RUNTIME_IO_INTERFACE.methods
    .filter((method) => typeof adapter[method] !== "function")
    .map((method) => `runtime I/O adapter misses ${method}`);
}

export function validateContinuationPolicyV10(policy, bindings = {}) {
  const errors = [];
  if (!plainObject(policy) || !exactKeys(policy, POLICY_KEYS)) {
    return ["continuation policy must contain the exact V10 keys"];
  }
  if (policy.schemaVersion !== 10
    || policy.kind !== CONTINUATION_V10_POLICY_KIND
    || policy.algorithm !== CONTINUATION_V10_ALGORITHM
    || policy.policyId !== CONTINUATION_V10_POLICY_ID
    || policy.workstreamId !== CONTINUATION_V10_WORKSTREAM_ID
    || policy.featureId !== CONTINUATION_V10_FEATURE_ID
    || policy.round !== CONTINUATION_V10_ROUND
    || policy.status !== "frozen"
    || !nonEmpty(policy.programId)) {
    errors.push("continuation policy V10 identity/status is invalid");
  }
  if (canonicalJsonV10(policy.admissionClassSet)
      !== canonicalJsonV10(CONTINUATION_V10_ADMISSION_CLASSES)
    || policy.admissionClassSetDigest
      !== CONTINUATION_V10_ADMISSION_CLASS_SET_DIGEST
    || policy.admissionClassSetDigest !== safeHash(policy.admissionClassSet)) {
    errors.push("continuation policy admission class set is invalid or stale");
  }
  errors.push(...validateParentEvidenceBundleV1(
    policy.parentEvidence,
    bindings.parentEvidence ?? {},
  ));
  errors.push(...validateRound1RejectionV2(policy.round1Rejection));
  errors.push(...validateRound2PrefreezeRejectionV3(
    policy.round2PrefreezeRejection,
  ));
  errors.push(...validateRound9ReviewRejectionV10(policy.round9ReviewRejection));
  errors.push(...validateAdmissionDefinitionV2(policy.admission));
  errors.push(...validateAdmissionCoverageV10(
    policy.admissionCoverage,
    policy.admission,
    policy.governanceTransitions,
  ));
  errors.push(...validateSuccessorDefinitionV2(policy.successor));
  errors.push(...validateClosedWorldContractV2(policy.closedWorld, {
    admission: policy.admission,
    successor: policy.successor,
  }));
  if (policy.programId !== policy.closedWorld?.programRootDefinition?.programId) {
    errors.push("continuation policy programId differs from the closed-world Program root");
  }
  if (canonicalJsonV10(policy.governanceTransitions)
    !== canonicalJsonV10(CONTINUATION_V10_GOVERNANCE_TRANSITION_TRUST_ROOTS)) {
    errors.push("V10 governance transitions differ from the Round10 target trust root");
  }
  errors.push(...validateGovernanceTransitionsV2(policy.governanceTransitions));
  errors.push(...validatePathAuthoritiesV2(policy.pathAuthorities, {
    trustRoots: policy.trustRoots,
    governanceTransitions: policy.governanceTransitions,
  }));
  validateReviewAssurancePolicy(policy.reviewAssurancePolicy, errors);
  if (!sameExactObject(policy.externalAnchorPolicy,
    expectedRejectedRound9AnchorRuleV10(), EXTERNAL_ANCHOR_RULE_KEYS)) {
    errors.push("policy externalAnchorPolicy does not forbid the rejected Round9 subject");
  }
  if (!plainObject(policy.reviewSnapshot)
    || !exactKeys(policy.reviewSnapshot, ["path"])
    || policy.reviewSnapshot.path !== CONTINUATION_V10_REVIEW_SNAPSHOT_PATH) {
    errors.push("policy reviewSnapshot path is invalid");
  }
  validateBaselineArchiveReferenceV10(
    policy.baselineArchive,
    "policy baselineArchive",
    errors,
  );
  if (!plainObject(policy.timePolicy)
    || !exactKeys(policy.timePolicy, ["futureToleranceMs"])
    || policy.timePolicy.futureToleranceMs !== 0) {
    errors.push("policy timePolicy must fail closed at zero future tolerance");
  }
  validateExecutableRoots(policy, errors);
  const rejectedCoverage = policy.admissionCoverage
    ?.filter((entry) => entry?.class === "rejected_output_absent")
    .map((entry) => entry.path);
  if (canonicalJsonV10(rejectedCoverage)
    !== canonicalJsonV10(CONTINUATION_V10_REJECTED_OUTPUT_ABSENT_PATHS)) {
    errors.push("policy does not keep every rejected downstream output absent");
  }
  validateCanonicalDigest(policy, "continuation policy", errors);
  if (bindings.expectedDigest !== undefined
    && policy.digest !== bindings.expectedDigest) {
    errors.push("continuation policy digest does not match caller pin");
  }
  if (bindings.expectedAdmissionRoots !== undefined) {
    const roots = bindings.expectedAdmissionRoots;
    if (!plainObject(roots)
      || !exactKeys(roots, [
        "featureDefinitionDigest", "featureFileSetDigest",
        "programRootDefinitionDigest", "workstreamDefinitionDigest",
      ])) {
      errors.push("expected admission roots must contain exact keys");
    } else {
      for (const [key, actual] of [
        ["featureDefinitionDigest", policy.admission?.featureDefinitionDigest],
        ["featureFileSetDigest", policy.admission?.featureFileSetDigest],
        ["workstreamDefinitionDigest", policy.admission?.workstreamDefinitionDigest],
        ["programRootDefinitionDigest", policy.closedWorld?.programRootDefinitionDigest],
      ]) {
        if (!sha256DigestV10(roots[key]) || roots[key] !== actual) {
          errors.push(`policy ${key} differs from the caller planning pin`);
        }
      }
    }
  }
  if (bindings.baselineArchive !== undefined) {
    errors.push(...validateBaselineArchiveV10(bindings.baselineArchive, policy));
  }
  if (bindings.lifecycleState !== undefined) {
    errors.push(...validateLifecycleStateV10(bindings.lifecycleState, policy));
  }
  return unique(errors);
}

export function validateBaselineArchiveV10(archive, policy) {
  const errors = [];
  if (!plainObject(archive) || !exactKeys(archive, ARCHIVE_KEYS)) {
    return ["baseline archive must contain the exact V10 keys"];
  }
  if (archive.schemaVersion !== 10
    || archive.kind !== CONTINUATION_V10_BASELINE_ARCHIVE_KIND
    || archive.algorithm !== CONTINUATION_V10_ALGORITHM
    || archive.workstreamId !== CONTINUATION_V10_WORKSTREAM_ID
    || archive.featureId !== CONTINUATION_V10_FEATURE_ID
    || archive.round !== CONTINUATION_V10_ROUND
    || !nonEmpty(archive.programId)) {
    errors.push("baseline archive V10 identity is invalid");
  }
  if (!Array.isArray(archive.entries) || archive.entries.length === 0) {
    errors.push("baseline archive entries must be non-empty");
  }
  const paths = [];
  for (const [index, entry] of (archive.entries ?? []).entries()) {
    if (!plainObject(entry) || !exactKeys(entry, ARCHIVE_ENTRY_KEYS)
      || !repositoryPathV10(entry.path)
      || !["round23_review_snapshot", "cd03a_review_snapshot",
        "governance_transition"].includes(entry.source)
      || !sha256DigestV10(entry.sha256)
      || entry.encoding !== "gzip-base64-v1"
      || typeof entry.bytes !== "string") {
      errors.push(`baseline archive entries[${index}] is invalid`);
      continue;
    }
    paths.push(entry.path);
    try {
      const compressed = Buffer.from(entry.bytes, "base64");
      if (compressed.toString("base64") !== entry.bytes) throw new Error("base64");
      const decoded = gunzipSync(compressed);
      const deterministic = gzipSync(decoded, { level: 9, mtime: 0 })
        .toString("base64");
      if (deterministic !== entry.bytes) throw new Error("deterministic gzip");
      if (sha256BytesV10(decoded) !== entry.sha256) throw new Error("digest");
    } catch {
      errors.push(`baseline archive entries[${index}] bytes are invalid or stale`);
    }
  }
  validateSortedUnique(paths, "baseline archive entry paths", errors);
  if (archive.entrySetDigest !== safeHash(archive.entries)) {
    errors.push("baseline archive entrySetDigest is invalid or stale");
  }
  validateCanonicalDigest(archive, "baseline archive", errors);
  if (plainObject(policy)) {
    if (archive.programId !== policy.programId
      || archive.digest !== policy.baselineArchive?.digest
      || archive.entrySetDigest !== policy.baselineArchive?.entrySetDigest) {
      errors.push("baseline archive policy reference is stale");
    }
    const expected = [];
    for (const authority of policy.pathAuthorities ?? []) {
      if (authority.class === "modify") {
        expected.push({
          path: authority.path,
          source: authority.baseline.source,
          sha256: authority.baseline.sha256,
        });
      }
    }
    for (const transition of policy.governanceTransitions ?? []) {
      expected.push({
        path: transition.path,
        source: "governance_transition",
        sha256: transition.fromSha256,
      });
    }
    expected.sort(comparePath);
    const actual = (archive.entries ?? []).map((entry) => ({
      path: entry.path,
      source: entry.source,
      sha256: entry.sha256,
    }));
    if (canonicalJsonV10(actual) !== canonicalJsonV10(expected)) {
      errors.push("baseline archive coverage differs from modify/transition authorities");
    }
  }
  return unique(errors);
}

export function validateContinuationReviewSnapshotV10(
  snapshot,
  policy,
  bindings = {},
) {
  const errors = [];
  if (!plainObject(snapshot) || !exactKeys(snapshot, SNAPSHOT_KEYS)) {
    return ["continuation review snapshot must contain the exact V10 keys"];
  }
  if (snapshot.schemaVersion !== 10
    || snapshot.kind !== CONTINUATION_V10_SNAPSHOT_KIND
    || snapshot.algorithm !== CONTINUATION_V10_ALGORITHM
    || snapshot.workstreamId !== CONTINUATION_V10_WORKSTREAM_ID
    || snapshot.featureId !== CONTINUATION_V10_FEATURE_ID
    || snapshot.round !== CONTINUATION_V10_ROUND
    || !nonEmpty(snapshot.programId)) {
    errors.push("continuation review snapshot V10 identity is invalid");
  }
  validateTimestampV10(
    snapshot.frozenAt,
    bindings.verifierNow,
    "continuation review snapshot frozenAt",
    errors,
  );
  validateBaselineArchiveReferenceV10(
    snapshot.baselineArchive,
    "continuation review snapshot baselineArchive",
    errors,
  );
  for (const [key, label] of [
    ["frozenFiles", "snapshot frozenFiles"],
    ["transitionPayloadFiles", "snapshot transitionPayloadFiles"],
    ["baselineFiles", "snapshot baselineFiles"],
  ]) validateFileDigestArrayV10(snapshot[key], label, errors);
  validateStringPathsV10(snapshot.absentPaths, "snapshot absentPaths", errors);
  validateStringPathsV10(
    snapshot.reviewOutputAbsentPaths,
    "snapshot reviewOutputAbsentPaths",
    errors,
  );
  const categories = new Map();
  for (const [name, entries] of [
    ["frozenFiles", snapshot.frozenFiles],
    ["transitionPayloadFiles", snapshot.transitionPayloadFiles],
    ["baselineFiles", snapshot.baselineFiles],
    ["absentPaths", snapshot.absentPaths],
    ["reviewOutputAbsentPaths", snapshot.reviewOutputAbsentPaths],
  ]) {
    for (const entry of entries ?? []) {
      const relativePath = typeof entry === "string" ? entry : entry?.path;
      if (!relativePath) continue;
      const prior = categories.get(relativePath);
      if (prior) {
        errors.push(`snapshot subject path overlaps ${prior}/${name}: ${relativePath}`);
      } else {
        categories.set(relativePath, name);
      }
    }
  }
  errors.push(...validateGovernanceTransitionsV2(snapshot.governanceTransitions));
  if (plainObject(policy)) {
    const expectedBindings = {
      programId: policy.programId,
      parentEvidenceBundleDigest: policy.parentEvidence?.bundleDigest,
      policyDigest: policy.digest,
      closedWorldDigest: policy.closedWorld?.digest,
      pathAuthorityDigest: safeHash(policy.pathAuthorities),
      admissionClassSetDigest: policy.admissionClassSetDigest,
      admissionFeatureDefinitionDigest: policy.admission?.featureDefinitionDigest,
      admissionFeatureFileSetDigest: policy.admission?.featureFileSetDigest,
      successorWorkstreamDefinitionDigest:
        policy.successor?.workstreamDefinitionDigest,
      successorFeatureDefinitionDigest: policy.successor?.featureDefinitionDigest,
      round9ReviewRejectionDigest: policy.round9ReviewRejection?.digest,
    };
    for (const [key, value] of Object.entries(expectedBindings)) {
      if (snapshot[key] !== value) {
        errors.push(`continuation review snapshot ${key} binding is stale`);
      }
    }
    if (canonicalJsonV10(snapshot.governanceTransitions)
      !== canonicalJsonV10(policy.governanceTransitions)) {
      errors.push("snapshot governance transitions differ from policy");
    }
    if (canonicalJsonV10(snapshot.baselineArchive)
      !== canonicalJsonV10(policy.baselineArchive)) {
      errors.push("snapshot baselineArchive differs from policy");
    }
    validateSnapshotAdmissionSubjectsV10(snapshot, policy, errors);
    validateSnapshotAuthoritySubjectsV10(snapshot, policy, errors);
  }
  validateCanonicalDigest(snapshot, "continuation review snapshot", errors);
  return unique(errors);
}

export function validateGovernanceTransitionStateV10(
  transitions,
  phase,
  liveDigests,
  stagedDigests,
) {
  const errors = [];
  const pathKinds = Object.fromEntries((transitions ?? []).map((entry) => [
    entry?.path,
    entry?.kind,
  ]));
  if (canonicalJsonV10(pathKinds)
    !== canonicalJsonV10(CONTINUATION_V10_GOVERNANCE_TRANSITIONS)) {
    errors.push("V10 governance transition path/kind set is not exact");
  }
  errors.push(...validateGovernanceTransitionStateV2(
    transitions,
    phase,
    liveDigests,
    stagedDigests,
  ));
  return unique(errors);
}

export function validateLifecycleStateV10(live, policy) {
  return validateLifecycleStateV2(live, policy);
}

export function selectLifecycleProfileV10(policy, phase) {
  if (!CONTINUATION_V10_LIFECYCLE_PROFILE_PHASES.includes(phase)) {
    return undefined;
  }
  const matches = (policy?.closedWorld?.lifecycleProfiles ?? [])
    .filter((entry) => entry?.phase === phase);
  return matches.length === 1 ? matches[0] : undefined;
}

export function validateContinuationReviewReceiptV10(
  receipt,
  snapshot,
  policy,
  bindings = {},
) {
  const errors = [];
  if (!plainObject(receipt) || !exactKeys(receipt, RECEIPT_KEYS)) {
    return ["continuation review receipt must contain the exact V10 keys"];
  }
  if (receipt.schemaVersion !== 10
    || receipt.kind !== CONTINUATION_V10_RECEIPT_KIND
    || receipt.workstreamId !== CONTINUATION_V10_WORKSTREAM_ID
    || receipt.featureId !== CONTINUATION_V10_FEATURE_ID
    || receipt.round !== CONTINUATION_V10_ROUND
    || !CONTINUATION_V10_REVIEW_LANES.includes(receipt.lane)
    || receipt.reviewedPhase !== "review_pre_transition"
    || receipt.identityAssurance !== CONTINUATION_V10_IDENTITY_ASSURANCE
    || receipt.independenceClaim !== CONTINUATION_V10_INDEPENDENCE_CLAIM
    || !nonEmpty(receipt.programId)) {
    errors.push("continuation review receipt V10 identity/assurance is invalid");
  }
  if (!plainObject(receipt.claimedReviewOrigin)
    || !exactKeys(receipt.claimedReviewOrigin, CLAIMED_ORIGIN_KEYS)
    || receipt.claimedReviewOrigin.transport !== "codex-collaboration"
    || !nonEmpty(receipt.claimedReviewOrigin.taskPath)
    || !nonEmpty(receipt.claimedReviewOrigin.agentLabel)) {
    errors.push("receipt claimedReviewOrigin is invalid diagnostic metadata");
  }
  for (const key of [
    "admissionFeatureDefinitionDigest",
    "admissionFeatureFileSetDigest",
    "callerDispatchEntryDigest",
    "callerDispatchSetDigest",
    "challenge",
    "closedWorldDigest",
    "parentEvidenceBundleDigest",
    "pathAuthorityDigest",
    "policyDigest",
    "round9ReviewRejectionDigest",
    "snapshotDigest",
    "successorFeatureDefinitionDigest",
    "successorWorkstreamDefinitionDigest",
    "validatorDigest",
  ]) {
    if (!sha256DigestV10(receipt[key])) errors.push(`receipt ${key} must be SHA-256`);
  }
  validateFindings(receipt, errors);
  const completedAt = validateTimestampV10(
    receipt.completedAt,
    bindings.verifierNow,
    "receipt completedAt",
    errors,
  );
  if (!Number.isFinite(bindings.verifierNow)) {
    errors.push("review receipt requires caller trusted verifier time");
  }
  if (!["passed", "failed"].includes(receipt.verdict)) {
    errors.push("receipt verdict is invalid");
  }
  if (plainObject(snapshot) && plainObject(policy)) {
    const frozenAt = Date.parse(snapshot.frozenAt);
    if (completedAt !== null && Number.isFinite(frozenAt)
      && completedAt < frozenAt) {
      errors.push("review receipt predates its frozen snapshot");
    }
    const validator = policy.continuationExecutables?.find(
      (entry) => entry?.kind === "checker"
        && entry?.path === CONTINUATION_V10_EXECUTABLE_PATH_BY_KIND.checker,
    );
    const expected = {
      programId: policy.programId,
      snapshotDigest: snapshot.digest,
      snapshotFileCount:
        (snapshot.frozenFiles?.length ?? 0)
        + (snapshot.transitionPayloadFiles?.length ?? 0)
        + (snapshot.baselineFiles?.length ?? 0),
      policyDigest: policy.digest,
      parentEvidenceBundleDigest: policy.parentEvidence?.bundleDigest,
      closedWorldDigest: policy.closedWorld?.digest,
      pathAuthorityDigest: safeHash(policy.pathAuthorities),
      admissionFeatureDefinitionDigest: policy.admission?.featureDefinitionDigest,
      admissionFeatureFileSetDigest: policy.admission?.featureFileSetDigest,
      successorWorkstreamDefinitionDigest: policy.successor?.workstreamDefinitionDigest,
      successorFeatureDefinitionDigest: policy.successor?.featureDefinitionDigest,
      round9ReviewRejectionDigest: policy.round9ReviewRejection?.digest,
      validatorDigest: validator?.sha256,
    };
    for (const [key, value] of Object.entries(expected)) {
      if (receipt[key] !== value) errors.push(`receipt ${key} binding is stale`);
    }
  }
  if (!plainObject(bindings.callerPin)
    || !exactKeys(bindings.callerPin, [
      "challenge", "dispatchEntryDigest", "dispatchSetDigest",
    ])
    || receipt.challenge !== bindings.callerPin.challenge
    || receipt.callerDispatchEntryDigest
      !== bindings.callerPin.dispatchEntryDigest
    || receipt.callerDispatchSetDigest
      !== bindings.callerPin.dispatchSetDigest) {
    errors.push("receipt requires exact caller-pinned dispatch and challenge");
  }
  return unique(errors);
}

export function validateContinuationReviewSetV10(
  receipts,
  callerDispatchSet,
  snapshot,
  policy,
  bindings = {},
) {
  const errors = [];
  if (!Array.isArray(receipts)
    || receipts.length !== CONTINUATION_V10_REVIEW_LANES.length
    || !Array.isArray(callerDispatchSet)
    || callerDispatchSet.length !== CONTINUATION_V10_REVIEW_LANES.length) {
    return ["V10 review set requires exactly three receipts and dispatch-set entries"];
  }
  const contextIds = [];
  const dispatchSetDigest = hashCanonicalV10(callerDispatchSet);
  for (let index = 0; index < CONTINUATION_V10_REVIEW_LANES.length; index += 1) {
    const lane = CONTINUATION_V10_REVIEW_LANES[index];
    const receipt = receipts[index];
    const caller = callerDispatchSet[index];
    if (!plainObject(caller) || !exactKeys(caller, DISPATCH_SET_ENTRY_KEYS)
      || caller.lane !== lane
      || caller.assurance !== CONTINUATION_V10_CALLER_DISPATCH_ASSURANCE
      || caller.transport !== "codex-collaboration"
      || !sha256DigestV10(caller.challenge)
      || !sha256DigestV10(caller.instructionDigest)
      || !nonEmpty(caller.reviewContextId)
      || !nonEmpty(caller.taskPath)
      || !nonEmpty(caller.agentLabel)) {
      errors.push(`caller dispatch-set entry is invalid for lane ${lane}`);
      continue;
    }
    contextIds.push(caller.reviewContextId);
    errors.push(...validateContinuationReviewReceiptV10(receipt, snapshot, policy, {
      callerPin: {
        challenge: caller.challenge,
        dispatchEntryDigest: hashCanonicalV10(caller),
        dispatchSetDigest,
      },
      verifierNow: bindings.verifierNow,
    }));
    if (receipt?.claimedReviewOrigin?.taskPath !== caller.taskPath
      || receipt?.claimedReviewOrigin?.agentLabel !== caller.agentLabel
      || receipt?.claimedReviewOrigin?.transport !== caller.transport) {
      errors.push(`review lane ${lane} claimed origin differs from caller dispatch`);
    }
    if (receipt?.lane !== lane
      || receipt?.verdict !== "passed"
      || receipt?.findings?.length !== 0
      || Object.values(receipt?.findingCounts ?? {}).some((entry) => entry !== 0)) {
      errors.push(`review lane ${lane} must pass with zero findings`);
    }
  }
  if (new Set(contextIds).size !== CONTINUATION_V10_REVIEW_LANES.length) {
    errors.push("caller must attest three distinct reviewContextId values");
  }
  return unique(errors);
}

export function validateContinuationClosureManifestV10(manifest, bindings = {}) {
  const errors = [];
  if (!plainObject(manifest) || !exactKeys(manifest, MANIFEST_KEYS)) {
    return ["continuation closure manifest must contain the exact V10 keys"];
  }
  if (manifest.schemaVersion !== 10
    || manifest.kind !== CONTINUATION_V10_MANIFEST_KIND
    || manifest.workstreamId !== CONTINUATION_V10_WORKSTREAM_ID
    || manifest.featureId !== CONTINUATION_V10_FEATURE_ID
    || manifest.round !== CONTINUATION_V10_ROUND
    || !["review_passed_pending_external_transaction", "externally_attested"]
      .includes(manifest.status)) {
    errors.push("continuation closure manifest V10 identity/status is invalid");
  }
  if (plainObject(bindings.policy)
    && manifest.programId !== bindings.policy.programId) {
    errors.push("manifest programId differs from the frozen policy");
  }
  validatePathDigest(manifest.policy, "manifest policy", errors);
  validatePathDigest(manifest.snapshot, "manifest snapshot", errors);
  validatePathDigest(manifest.round9ReviewRejection,
    "manifest Round9 rejection", errors);
  validatePathSha(manifest.validator, "manifest validator", errors);
  validatePathSha(manifest.externalRunner, "manifest external runner", errors);
  if (manifest.policy?.path !== CONTINUATION_V10_POLICY_PATH
    || manifest.snapshot?.path !== CONTINUATION_V10_REVIEW_SNAPSHOT_PATH
    || manifest.round9ReviewRejection?.path
      !== CONTINUATION_V10_ROUND9_REVIEW_REJECTION_PATH
    || manifest.validator?.path
      !== CONTINUATION_V10_EXECUTABLE_PATH_BY_KIND.checker
    || manifest.externalRunner?.path
      !== CONTINUATION_V10_EXECUTABLE_PATH_BY_KIND.runner) {
    errors.push("manifest evidence paths differ from canonical Round10 roots");
  }
  validateReviewReferences(manifest.reviewReceipts, errors);
  errors.push(...validateCallerDispatchSetShape(manifest.callerDispatchSet));
  if (!sha256DigestV10(manifest.parentEvidenceBundleDigest)
    || !sha256DigestV10(manifest.pendingManifestDigest)) {
    errors.push("manifest parent/pending digest is invalid");
  }
  if (manifest.pendingManifestDigest !== pendingManifestDigestV10(manifest)) {
    errors.push("manifest pendingManifestDigest is invalid or stale");
  }
  if (!plainObject(manifest.externalAttestation)
    || !exactKeys(manifest.externalAttestation, ["canonicalDigest", "path"])
    || manifest.externalAttestation.path
      !== CONTINUATION_V10_EXTERNAL_ATTESTATION_PATH
    || (manifest.status === "review_passed_pending_external_transaction"
      ? manifest.externalAttestation.canonicalDigest !== null
      : !sha256DigestV10(manifest.externalAttestation.canonicalDigest))) {
    errors.push("manifest external attestation reference is invalid");
  }
  if (plainObject(bindings.policy)
    && (manifest.policy?.canonicalDigest !== bindings.policy.digest
      || manifest.round9ReviewRejection?.canonicalDigest
        !== bindings.policy.round9ReviewRejection?.digest)) {
    errors.push("manifest policy/rejection binding is stale");
  }
  for (const [key, expected] of [
    ["policy", bindings.policyReference],
    ["snapshot", bindings.snapshotReference],
    ["round9ReviewRejection", bindings.round9ReviewRejectionReference],
    ["validator", bindings.validatorReference],
    ["externalRunner", bindings.runnerReference],
  ]) {
    if (!plainObject(expected)
      || canonicalJsonV10(manifest[key]) !== canonicalJsonV10(expected)) {
      errors.push(`manifest ${key} does not match its complete expected reference`);
    }
  }
  if (!Array.isArray(bindings.reviewReferences)
    || canonicalJsonV10(manifest.reviewReceipts)
      !== canonicalJsonV10(bindings.reviewReferences)) {
    errors.push("manifest review receipt references are incomplete or stale");
  }
  if (!Array.isArray(bindings.callerDispatchSet)
    || canonicalJsonV10(manifest.callerDispatchSet)
      !== canonicalJsonV10(bindings.callerDispatchSet)) {
    errors.push("manifest caller dispatch set is incomplete or stale");
  }
  if (!plainObject(bindings.policy)
    || manifest.parentEvidenceBundleDigest
      !== bindings.policy.parentEvidence?.bundleDigest) {
    errors.push("manifest parent evidence binding is stale");
  }
  if (manifest.status === "externally_attested") {
    if (!plainObject(bindings.pendingManifest)
      || !plainObject(bindings.externalAttestation)
      || bindings.pendingManifest.status
        !== "review_passed_pending_external_transaction"
      || manifest.pendingManifestDigest !== bindings.pendingManifest.pendingManifestDigest
      || manifest.externalAttestation?.canonicalDigest
        !== bindings.externalAttestation.digest
      || canonicalJsonV10(finalManifestProjectionV10(
        bindings.pendingManifest,
        bindings.externalAttestation.digest,
      )) !== canonicalJsonV10(withoutDigestV10(manifest))) {
      errors.push("final manifest is not the exact attested pending-manifest projection");
    }
  } else if (bindings.pendingManifest !== undefined
    || bindings.externalAttestation !== undefined) {
    errors.push("pending manifest must not accept final-evidence bindings");
  }
  validateCanonicalDigest(manifest, "closure manifest", errors);
  return unique(errors);
}

export function pendingManifestDigestV10(manifest) {
  if (!plainObject(manifest)) return null;
  const projected = structuredClone(manifest);
  delete projected.digest;
  delete projected.pendingManifestDigest;
  projected.status = "review_passed_pending_external_transaction";
  if (plainObject(projected.externalAttestation)) {
    projected.externalAttestation.canonicalDigest = null;
  }
  return safeHash(projected);
}

export function finalManifestProjectionV10(pendingManifest, attestationDigest) {
  const projected = withoutDigestV10(pendingManifest);
  projected.status = "externally_attested";
  projected.externalAttestation = {
    ...projected.externalAttestation,
    canonicalDigest: attestationDigest,
  };
  return projected;
}

export function validateContinuationExternalAttestationV10(
  attestation,
  bindings = {},
) {
  const errors = [];
  if (!plainObject(attestation) || !exactKeys(attestation, ATTESTATION_KEYS)) {
    return ["external attestation must contain the exact V10 keys"];
  }
  if (attestation.schemaVersion !== 10
    || attestation.kind !== CONTINUATION_V10_ATTESTATION_KIND
    || attestation.status !== "passed"
    || attestation.governancePhase !== "review_post_transition"
    || attestation.identityAssurance !== CONTINUATION_V10_IDENTITY_ASSURANCE
    || attestation.reviewAssurance !== CONTINUATION_V10_CALLER_DISPATCH_ASSURANCE
    || !path.isAbsolute(attestation.repositoryRealpath)) {
    errors.push("external attestation V10 identity/assurance is invalid");
  }
  for (const key of [
    "parentEvidenceBundleDigest", "pendingManifestDigest", "policyDigest",
    "round9ReviewRejectionDigest", "runnerDigest", "snapshotDigest", "validatorDigest",
  ]) if (!sha256DigestV10(attestation[key])) errors.push(`attestation ${key} is invalid`);
  errors.push(...validateCallerDispatchSetShape(attestation.callerDispatchSet));
  validateCandidateResultsV10(
    attestation.candidateResults,
    bindings.policy,
    errors,
  );
  const completedAt = validateTimestampV10(
    attestation.completedAt,
    bindings.verifierNow,
    "external attestation completedAt",
    errors,
  );
  if (!Number.isFinite(bindings.verifierNow)) {
    errors.push("external attestation requires caller trusted verifier time");
  }
  const lowerBounds = [
    bindings.snapshot?.frozenAt,
    ...(bindings.receipts ?? []).map((receipt) => receipt?.completedAt),
  ].map((value) => Date.parse(value)).filter(Number.isFinite);
  if (completedAt !== null && lowerBounds.some((value) => completedAt < value)) {
    errors.push("external attestation predates frozen snapshot or review receipt");
  }
  if (!plainObject(bindings.policy)
    || !plainObject(bindings.snapshot)
    || !plainObject(bindings.round9ReviewRejection)
    || !plainObject(bindings.pendingManifest)
    || !Array.isArray(bindings.callerDispatchSet)
    || !Array.isArray(bindings.receipts)
    || !Array.isArray(bindings.candidateResults)) {
    errors.push("external attestation requires complete semantic bindings");
  } else {
    const expected = {
      parentEvidenceBundleDigest: bindings.policy.parentEvidence?.bundleDigest,
      pendingManifestDigest: bindings.pendingManifest.pendingManifestDigest,
      policyDigest: bindings.policy.digest,
      round9ReviewRejectionDigest: bindings.round9ReviewRejection.digest,
      snapshotDigest: bindings.snapshot.digest,
      validatorDigest: bindings.pendingManifest.validator?.sha256,
      runnerDigest: bindings.pendingManifest.externalRunner?.sha256,
    };
    for (const [key, value] of Object.entries(expected)) {
      if (attestation[key] !== value) {
        errors.push(`external attestation ${key} binding is stale`);
      }
    }
    if (attestation.repositoryRealpath !== bindings.repositoryRealpath) {
      errors.push("external attestation repository binding is stale");
    }
    if (canonicalJsonV10(attestation.callerDispatchSet)
      !== canonicalJsonV10(bindings.callerDispatchSet)) {
      errors.push("external attestation dispatch binding is stale");
    }
    if (canonicalJsonV10(attestation.candidateResults)
      !== canonicalJsonV10(bindings.candidateResults)) {
      errors.push("external attestation candidate results differ from runner evidence");
    }
  }
  validateCanonicalDigest(attestation, "external attestation", errors);
  return unique(errors);
}

export function validateContinuationExternalAnchorV10(anchor, bindings = {}) {
  const errors = [];
  if (!plainObject(anchor) || !exactKeys(anchor, ANCHOR_KEYS)) {
    return ["external anchor must contain the exact V10 keys"];
  }
  if (anchor.schemaVersion !== 10
    || anchor.kind !== CONTINUATION_V10_ANCHOR_KIND
    || anchor.identityAssurance !== CONTINUATION_V10_IDENTITY_ASSURANCE
    || anchor.reviewAssurance !== CONTINUATION_V10_CALLER_DISPATCH_ASSURANCE
    || !path.isAbsolute(anchor.repositoryRealpath)) {
    errors.push("external anchor V10 identity/assurance is invalid");
  }
  for (const key of [
    "attestationDigest", "parentEvidenceBundleDigest", "policyDigest",
    "round9ReviewRejectionDigest", "runnerDigest", "snapshotDigest", "validatorDigest",
  ]) if (!sha256DigestV10(anchor[key])) errors.push(`anchor ${key} is invalid`);
  errors.push(...validateCallerDispatchSetShape(anchor.callerDispatchSet));
  validateCandidateResultsV10(anchor.candidateResults, bindings.policy, errors);
  if (!plainObject(anchor.head) || !exactKeys(anchor.head, ANCHOR_HEAD_KEYS)) {
    errors.push("anchor head must contain exact keys");
  }
  const completedAt = validateTimestampV10(
    anchor.completedAt,
    bindings.verifierNow,
    "external anchor completedAt",
    errors,
  );
  if (!Number.isFinite(bindings.verifierNow)) {
    errors.push("external anchor requires caller trusted verifier time");
  }
  if (!plainObject(bindings.attestation)
    || !plainObject(bindings.policy)
    || !plainObject(bindings.snapshot)
    || !plainObject(bindings.round9ReviewRejection)
    || !Array.isArray(bindings.callerDispatchSet)) {
    errors.push("external anchor requires complete semantic bindings");
  } else {
    const attestationTime = Date.parse(bindings.attestation.completedAt);
    if (completedAt !== null && Number.isFinite(attestationTime)
      && completedAt < attestationTime) {
      errors.push("external anchor predates its attestation");
    }
    const expected = {
      attestationDigest: bindings.attestation.digest,
      parentEvidenceBundleDigest: bindings.policy.parentEvidence?.bundleDigest,
      policyDigest: bindings.policy.digest,
      round9ReviewRejectionDigest: bindings.round9ReviewRejection.digest,
      runnerDigest: bindings.attestation.runnerDigest,
      snapshotDigest: bindings.snapshot.digest,
      validatorDigest: bindings.attestation.validatorDigest,
    };
    for (const [key, value] of Object.entries(expected)) {
      if (anchor[key] !== value) errors.push(`external anchor ${key} binding is stale`);
    }
    if (anchor.repositoryRealpath !== bindings.repositoryRealpath) {
      errors.push("external anchor repository binding is stale");
    }
    if (canonicalJsonV10(anchor.callerDispatchSet)
      !== canonicalJsonV10(bindings.callerDispatchSet)) {
      errors.push("external anchor dispatch binding is stale");
    }
    if (canonicalJsonV10(anchor.candidateResults)
      !== canonicalJsonV10(bindings.attestation.candidateResults)) {
      errors.push("external anchor candidate results differ from attestation");
    }
    const expectedHead = {
      kind: "successor-admission",
      status: "externally_attested",
      workstreamId: CONTINUATION_V10_WORKSTREAM_ID,
      featureId: CONTINUATION_V10_FEATURE_ID,
      snapshotDigest: bindings.snapshot.digest,
      successorWorkstreamDefinitionDigest:
        bindings.policy.successor?.workstreamDefinitionDigest,
      successorFeatureDefinitionDigest:
        bindings.policy.successor?.featureDefinitionDigest,
    };
    if (canonicalJsonV10(anchor.head) !== canonicalJsonV10(expectedHead)) {
      errors.push("external anchor head is not the exact P107A successor-admission head");
    }
  }
  errors.push(...validateRejectedRound9AnchorSubjectV10(anchor));
  validateCanonicalDigest(anchor, "external anchor", errors);
  if (bindings.expectedDigest === undefined
    || anchor.digest !== bindings.expectedDigest) {
    errors.push("external anchor digest does not match caller pin");
  }
  return unique(errors);
}

export function serializeRound9ReviewRejectionV10(witness) {
  const errors = validateRound9ReviewRejectionV10(witness);
  if (errors.length > 0) throw new TypeError(errors.join("; "));
  return Buffer.from(`${JSON.stringify(witness, null, 2)}\n`, "utf8");
}

function validateCandidateResultsV10(results, policy, errors) {
  if (!Array.isArray(results)
    || results.length !== CONTINUATION_V10_CANDIDATE_RESULT_KINDS.length) {
    errors.push("attestation candidateResults must contain checker and harness exactly");
    return;
  }
  const policyCheckerPath = policy?.continuationExecutables?.find(
    (entry) => entry?.kind === "checker",
  )?.path;
  const expectedPaths = {
    ...CONTINUATION_V10_CANDIDATE_PATH_BY_KIND,
    checker: policyCheckerPath
      ?? CONTINUATION_V10_CANDIDATE_PATH_BY_KIND.checker,
  };
  for (let index = 0;
    index < CONTINUATION_V10_CANDIDATE_RESULT_KINDS.length;
    index += 1) {
    const result = results[index];
    const kind = CONTINUATION_V10_CANDIDATE_RESULT_KINDS[index];
    if (!plainObject(result)
      || !exactKeys(result, CANDIDATE_RESULT_KEYS)
      || result.kind !== kind
      || result.path !== expectedPaths[kind]
      || result.status !== "passed"
      || !sha256DigestV10(result.receiptDigest)
      || !sha256DigestV10(result.stdoutDigest)
      || !sha256DigestV10(result.stderrDigest)) {
      errors.push(`attestation candidateResults[${index}] is not exact ${kind} PASS evidence`);
    }
  }
}

function withoutDigestV10(value) {
  const projected = structuredClone(value);
  delete projected.digest;
  return projected;
}

function validateSnapshotAdmissionSubjectsV10(snapshot, policy, errors) {
  const byClass = new Map(
    CONTINUATION_V10_ADMISSION_CLASSES.map((value) => [value, []]),
  );
  for (const entry of policy.admissionCoverage ?? []) {
    byClass.get(entry.class)?.push(entry.path);
  }
  const frozen = new Map((snapshot.frozenFiles ?? [])
    .map((entry) => [entry.path, entry.sha256]));
  const payload = new Map((snapshot.transitionPayloadFiles ?? [])
    .map((entry) => [entry.path, entry.sha256]));
  if (!sameStringSet([...frozen.keys()], byClass.get("frozen_file") ?? [])) {
    errors.push(
      "snapshot frozenFiles differ from explicit frozen_file admission coverage",
    );
  }
  if (!sameStringSet(
    [...payload.keys()],
    byClass.get("transition_payload") ?? [],
  )) {
    errors.push(
      "snapshot transitionPayloadFiles differ from explicit transition_payload coverage",
    );
  }
  const expectedPayload = new Map((policy.governanceTransitions ?? [])
    .map((entry) => [entry.stagedTargetPath, entry.toSha256]));
  if (!sameMap(payload, expectedPayload)) {
    errors.push("snapshot transition payload bytes differ from governance targets");
  }
  if (!sameStringSet(
    snapshot.reviewOutputAbsentPaths ?? [],
    byClass.get("review_output_absent") ?? [],
  )) {
    errors.push("snapshot review outputs differ from explicit admission coverage");
  }
  const absent = new Set(snapshot.absentPaths ?? []);
  if (!(byClass.get("rejected_output_absent") ?? [])
    .every((relativePath) => absent.has(relativePath))) {
    errors.push("snapshot does not preserve rejected_output_absent coverage");
  }
  for (const transition of policy.governanceTransitions ?? []) {
    if (frozen.has(transition.stagedTargetPath)) {
      errors.push(
        `transition payload must not also be frozen_file: ${transition.stagedTargetPath}`,
      );
    }
  }
  for (const reference of [
    CONTINUATION_V10_ROUND9_POLICY_TRUST_ROOT,
    CONTINUATION_V10_ROUND9_SNAPSHOT_TRUST_ROOT,
    ...CONTINUATION_V10_ROUND9_RECEIPT_TRUST_ROOTS,
  ]) {
    if (frozen.get(reference.path) !== reference.byteSha256) {
      errors.push(`snapshot does not freeze Round9 rejection evidence: ${reference.path}`);
    }
  }
  const rejectionBytes = sha256BytesV10(
    serializeRound9ReviewRejectionV10(policy.round9ReviewRejection),
  );
  if (frozen.get(CONTINUATION_V10_ROUND9_REVIEW_REJECTION_PATH)
    !== rejectionBytes) {
    errors.push("snapshot does not freeze exact Round9 review-rejection bytes");
  }
}

function validateSnapshotAuthoritySubjectsV10(snapshot, policy, errors) {
  const baseline = new Map((snapshot.baselineFiles ?? [])
    .map((entry) => [entry.path, entry.sha256]));
  const absent = new Set(snapshot.absentPaths ?? []);
  const expectedBaseline = new Map();
  const expectedAbsent = new Set(CONTINUATION_V10_REJECTED_OUTPUT_ABSENT_PATHS);
  for (const authority of policy.pathAuthorities ?? []) {
    if (authority.class === "modify"
      && authority.baseline.source === "cd03a_review_snapshot") {
      expectedBaseline.set(authority.path, authority.baseline.sha256);
    } else if (authority.class === "create") {
      expectedAbsent.add(authority.path);
    } else if (authority.class === "bookkeeping") {
      if (authority.baseline.presence === "present") {
        expectedBaseline.set(authority.path, authority.baseline.sha256);
      } else {
        expectedAbsent.add(authority.path);
      }
    }
  }
  if (!sameMap(baseline, expectedBaseline)) {
    errors.push("snapshot baselineFiles do not exactly bind V10 baselines");
  }
  if (!sameStringSet([...absent], [...expectedAbsent])) {
    errors.push(
      "snapshot absentPaths do not exactly bind create/bookkeeping/rejected absence",
    );
  }
}

function validateBaselineArchiveReferenceV10(reference, subject, errors) {
  if (!plainObject(reference)
    || !exactKeys(reference, ["digest", "entrySetDigest", "path"])
    || reference.path !== CONTINUATION_V10_BASELINE_ARCHIVE_PATH
    || !sha256DigestV10(reference.digest)
    || !sha256DigestV10(reference.entrySetDigest)) {
    errors.push(`${subject} is invalid`);
  }
}

function validateFileDigestArrayV10(entries, subject, errors) {
  if (!Array.isArray(entries) || entries.length === 0) {
    errors.push(`${subject} must be non-empty`);
    return;
  }
  const paths = [];
  for (const [index, entry] of entries.entries()) {
    if (!plainObject(entry) || !exactKeys(entry, FILE_DIGEST_KEYS)
      || !repositoryPathV10(entry.path) || !sha256DigestV10(entry.sha256)) {
      errors.push(`${subject}[${index}] is invalid`);
      continue;
    }
    paths.push(entry.path);
  }
  validateSortedUnique(paths, `${subject} paths`, errors);
}

function validateStringPathsV10(entries, subject, errors) {
  if (!Array.isArray(entries)) {
    errors.push(`${subject} must be an array`);
    return;
  }
  if (entries.some((entry) => !repositoryPathV10(entry))) {
    errors.push(`${subject} contains an invalid path`);
  }
  validateSortedUnique(entries, subject, errors);
}

function validateTimestampV10(value, verifierNow, subject, errors) {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    errors.push(`${subject} must be canonical ISO time`);
    return null;
  }
  if (verifierNow !== undefined
    && (!Number.isFinite(verifierNow) || parsed > verifierNow)) {
    errors.push(`${subject} is later than trusted verifier time`);
  }
  return parsed;
}

function validateCompletedReceiptReferences(receipts, errors) {
  if (!Array.isArray(receipts)
    || receipts.length !== CONTINUATION_V10_ROUND9_RECEIPT_TRUST_ROOTS.length) {
    errors.push("Round9 rejection must bind every completed review receipt");
    return;
  }
  for (let index = 0; index < receipts.length; index += 1) {
    const actual = receipts[index];
    const expected = CONTINUATION_V10_ROUND9_RECEIPT_TRUST_ROOTS[index];
    if (!plainObject(actual) || !exactKeys(actual, COMPLETED_RECEIPT_REFERENCE_KEYS)
      || actual.lane !== expected.lane
      || actual.path !== expected.path
      || actual.byteSha256 !== expected.byteSha256
      || actual.canonicalDigest !== expected.canonicalDigest
      || actual.challenge !== expected.challenge
      || actual.verdict !== expected.verdict
      || !sameExactObject(actual.findingCounts, expected.findingCounts,
        FINDING_COUNT_KEYS)) {
      errors.push(`Round9 completed receipt root differs for lane ${expected.lane}`);
    }
  }
}

function validateReviewAssurancePolicy(value, errors) {
  const keys = [
    "callerDispatchAssurance", "identityAssurance", "independenceClaim",
    "localIdentityProof",
  ];
  if (!plainObject(value) || !exactKeys(value, keys)
    || value.callerDispatchAssurance !== CONTINUATION_V10_CALLER_DISPATCH_ASSURANCE
    || value.identityAssurance !== CONTINUATION_V10_IDENTITY_ASSURANCE
    || value.independenceClaim !== CONTINUATION_V10_INDEPENDENCE_CLAIM
    || value.localIdentityProof !== false) {
    errors.push("review assurance policy must be honest caller-attested/not-signed");
  }
}

function validateExecutableRoots(policy, errors) {
  if (!Array.isArray(policy.continuationExecutables)
    || canonicalJsonV10(policy.continuationExecutables.map((entry) => entry?.kind))
      !== canonicalJsonV10(CONTINUATION_V10_EXECUTABLE_KINDS)) {
    errors.push("continuationExecutables must contain the exact ordered V10 kinds");
    return;
  }
  for (const [index, entry] of policy.continuationExecutables.entries()) {
    if (!plainObject(entry) || !exactKeys(entry, ["kind", "path", "sha256"])
      || entry.path !== CONTINUATION_V10_EXECUTABLE_PATH_BY_KIND[entry.kind]
      || !repositoryPathV10(entry.path) || !sha256DigestV10(entry.sha256)) {
      errors.push(`continuationExecutables[${index}] is invalid`);
    }
  }
  const expectedTrustRoots = [
    ...policy.governanceTransitions.map((entry) => ({
      path: entry.path,
      sha256: entry.toSha256,
    })),
    ...policy.continuationExecutables.map((entry) => ({
      path: entry.path,
      sha256: entry.sha256,
    })),
  ].sort(comparePath);
  const actualSubset = policy.trustRoots?.filter((entry) =>
    expectedTrustRoots.some((expected) => expected.path === entry?.path));
  if (canonicalJsonV10(actualSubset) !== canonicalJsonV10(expectedTrustRoots)) {
    errors.push("trustRoots do not bind every V10 transition and executable byte");
  }
}

function validateCallerDispatchSetShape(entries) {
  const errors = [];
  if (!Array.isArray(entries)
    || entries.length !== CONTINUATION_V10_REVIEW_LANES.length) {
    return ["external caller-pinned dispatch set must contain exactly three lanes"];
  }
  const challenges = [];
  const contextIds = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!plainObject(entry) || !exactKeys(entry, DISPATCH_SET_ENTRY_KEYS)
      || entry.lane !== CONTINUATION_V10_REVIEW_LANES[index]
      || entry.assurance !== CONTINUATION_V10_CALLER_DISPATCH_ASSURANCE
      || entry.transport !== "codex-collaboration"
      || !sha256DigestV10(entry.challenge)
      || !sha256DigestV10(entry.instructionDigest)
      || !nonEmpty(entry.reviewContextId)
      || !nonEmpty(entry.taskPath)
      || !nonEmpty(entry.agentLabel)) {
      errors.push(`dispatch-set entry[${index}] is invalid`);
      continue;
    }
    challenges.push(entry.challenge);
    contextIds.push(entry.reviewContextId);
  }
  if (new Set(challenges).size !== entries.length
    || new Set(contextIds).size !== entries.length) {
    errors.push("dispatch-set challenges and review contexts must be unique");
  }
  return errors;
}

function validateReviewReferences(entries, errors) {
  if (!Array.isArray(entries)
    || entries.length !== CONTINUATION_V10_REVIEW_LANES.length) {
    errors.push("manifest reviewReceipts must contain exactly three lanes");
    return;
  }
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!plainObject(entry) || !exactKeys(entry, REVIEW_REFERENCE_KEYS)
      || entry.lane !== CONTINUATION_V10_REVIEW_LANES[index]
      || !repositoryPathV10(entry.path)
      || !sha256DigestV10(entry.challenge)
      || !sha256DigestV10(entry.canonicalDigest)) {
      errors.push(`manifest review receipt[${index}] is invalid`);
    }
  }
}

function validateFindings(receipt, errors) {
  if (!plainObject(receipt.findingCounts)
    || !exactKeys(receipt.findingCounts, FINDING_COUNT_KEYS)
    || Object.values(receipt.findingCounts).some((entry) =>
      !Number.isInteger(entry) || entry < 0)) {
    errors.push("receipt findingCounts is invalid");
    return;
  }
  if (!Array.isArray(receipt.findings)) {
    errors.push("receipt findings must be an array");
    return;
  }
  const actual = { critical: 0, major: 0, minor: 0 };
  for (const [index, finding] of receipt.findings.entries()) {
    if (!plainObject(finding) || !exactKeys(finding, FINDING_KEYS)
      || !nonEmpty(finding.id) || !nonEmpty(finding.summary)
      || !["critical", "major", "minor"].includes(finding.severity)
      || !Array.isArray(finding.evidence)
      || finding.evidence.some((entry) => !nonEmpty(entry))) {
      errors.push(`receipt finding[${index}] is invalid`);
      continue;
    }
    actual[finding.severity] += 1;
  }
  if (canonicalJsonV10(actual) !== canonicalJsonV10(receipt.findingCounts)) {
    errors.push("receipt findingCounts do not match findings");
  }
}

function validatePathDigest(value, label, errors) {
  if (!plainObject(value)
    || !exactKeys(value, ["byteSha256", "canonicalDigest", "path"])
    || !repositoryPathV10(value.path)
    || !sha256DigestV10(value.byteSha256)
    || !sha256DigestV10(value.canonicalDigest)) {
    errors.push(`${label} is invalid`);
  }
}

function validatePathSha(value, label, errors) {
  if (!plainObject(value) || !exactKeys(value, ["path", "sha256"])
    || !repositoryPathV10(value.path) || !sha256DigestV10(value.sha256)) {
    errors.push(`${label} is invalid`);
  }
}

function validateCanonicalDigest(value, label, errors) {
  if (!sha256DigestV10(value?.digest)) {
    errors.push(`${label} digest must be SHA-256`);
    return;
  }
  const withoutDigest = { ...value };
  delete withoutDigest.digest;
  if (hashCanonicalV10(withoutDigest) !== value.digest) {
    errors.push(`${label} digest is invalid or stale`);
  }
}

function sameExactObject(actual, expected, keys) {
  return plainObject(actual)
    && exactKeys(actual, keys)
    && canonicalJsonV10(actual) === canonicalJsonV10(expected);
}

function exactKeys(value, expected) {
  if (!plainObject(value)) return false;
  return canonicalJsonV10(Object.keys(value).sort())
    === canonicalJsonV10([...expected].sort());
}

function plainObject(value) {
  return value !== null && typeof value === "object"
    && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function nonEmpty(value) {
  return typeof value === "string" && value.length > 0;
}

function safeHash(value) {
  try {
    return hashCanonicalV10(value);
  } catch {
    return null;
  }
}

function validateSortedUnique(values, label, errors) {
  const sorted = [...values].sort((left, right) => left.localeCompare(right));
  if (new Set(values).size !== values.length
    || canonicalJsonV10(values) !== canonicalJsonV10(sorted)) {
    errors.push(`${label} must be sorted and unique`);
  }
}

function sameStringSet(left, right) {
  return canonicalJsonV10([...new Set(left)].sort())
    === canonicalJsonV10([...new Set(right)].sort());
}

function sameMap(left, right) {
  const project = (value) =>
    [...value.entries()].sort(([a], [b]) => a.localeCompare(b));
  return canonicalJsonV10(project(left)) === canonicalJsonV10(project(right));
}

function comparePath(left, right) {
  return left.path.localeCompare(right.path);
}

function unique(errors) {
  return [...new Set(errors)];
}

export const canonicalJson = canonicalJsonV10;
export const hashCanonical = hashCanonicalV10;
export const sha256Bytes = sha256BytesV10;
export const validateRound9ReviewRejection = validateRound9ReviewRejectionV10;
export const validateAdmissionCoverage = validateAdmissionCoverageV10;
export const validateContinuationPolicy = validateContinuationPolicyV10;
export const validateBaselineArchive = validateBaselineArchiveV10;
export const validateReviewSnapshotV10 = validateContinuationReviewSnapshotV10;
export const validateReviewSnapshot = validateContinuationReviewSnapshotV10;
export const validateReviewReceiptV10 = validateContinuationReviewReceiptV10;
export const validateReviewSetV10 = validateContinuationReviewSetV10;
export const validateClosureManifestV10 = validateContinuationClosureManifestV10;
export const validateExternalAttestationV10 =
  validateContinuationExternalAttestationV10;
export const validateExternalAnchorV10 = validateContinuationExternalAnchorV10;
