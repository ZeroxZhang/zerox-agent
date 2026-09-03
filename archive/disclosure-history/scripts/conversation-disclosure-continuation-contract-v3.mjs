import { createHash } from "node:crypto";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

import {
  CONTINUATION_V2_BOOKKEEPING_VALIDATORS,
  CONTINUATION_V2_REVIEW_LANES,
  canonicalJsonV2,
  hashCanonicalV2,
  repositoryPathV2,
  sha256BytesV2,
  sha256DigestV2,
  stableFeatureDefinitionV2,
  stableHistoricalFeatureDefinitionV2,
  stableProgramRootDefinitionV2,
  stableWorkstreamDefinitionV2,
  validateAdmissionDefinitionV2,
  validateClosedWorldContractV2,
  validateGovernanceTransitionsV2,
  validateGovernanceTransitionStateV2,
  validateLifecycleStateV2,
  validateLiveProgramRootV2,
  validateParentEvidenceBundleV1,
  validatePathAuthoritiesV2,
  validateRound1RejectionV2,
  validateSuccessorDefinitionV2,
  withCanonicalDigestV2,
} from "./conversation-disclosure-continuation-contract-v2.mjs";

export const CONTINUATION_V3_ALGORITHM = "sha256-canonical-json-v1";
export const CONTINUATION_V3_POLICY_KIND =
  "conversation-disclosure-continuation-policy";
export const CONTINUATION_V3_SNAPSHOT_KIND =
  "conversation-disclosure-continuation-review-snapshot";
export const CONTINUATION_V3_RECEIPT_KIND =
  "conversation-disclosure-continuation-review-receipt";
export const CONTINUATION_V3_MANIFEST_KIND =
  "conversation-disclosure-continuation-closure-manifest";
export const CONTINUATION_V3_ATTESTATION_KIND =
  "conversation-disclosure-continuation-external-attestation";
export const CONTINUATION_V3_ANCHOR_KIND =
  "conversation-disclosure-continuation-external-anchor";
export const CONTINUATION_V3_PREFREEZE_REJECTION_KIND =
  "conversation-disclosure-continuation-prefreeze-rejection";
export const CONTINUATION_V3_BASELINE_ARCHIVE_KIND =
  "conversation-disclosure-continuation-baseline-archive";
export const CONTINUATION_V3_POLICY_ID = "CD03A-round3-P108-admission-v3";
export const CONTINUATION_V3_WORKSTREAM_ID = "CD03A";
export const CONTINUATION_V3_FEATURE_ID =
  "P107A-conversation-disclosure-successor-admission";
export const CONTINUATION_V3_SUCCESSOR_WORKSTREAM_ID = "CD04";
export const CONTINUATION_V3_SUCCESSOR_FEATURE_ID =
  "P108-conversation-disclosure-evidence-foundation";
export const CONTINUATION_V3_ROUND = 3;
export const CONTINUATION_V3_REJECTED_ROUND = 2;

export const CONTINUATION_V3_POLICY_PATH =
  ".zerox/verification/conversation-disclosure/CD03A-round3-successor-evolution-policy.json";
export const CONTINUATION_V3_BASELINE_ARCHIVE_PATH =
  ".zerox/verification/conversation-disclosure/CD03A-round3-baseline-archive.json";
export const CONTINUATION_V3_REVIEW_SNAPSHOT_PATH =
  ".zerox/verification/conversation-disclosure/CD03A-round3-review-snapshot.json";
export const CONTINUATION_V3_CLOSURE_MANIFEST_PATH =
  ".zerox/verification/conversation-disclosure/CD03A-round3-closure-manifest.json";
export const CONTINUATION_V3_EXTERNAL_ATTESTATION_PATH =
  ".zerox/verification/conversation-disclosure/CD03A-round3-external-attestation.json";
export const CONTINUATION_V3_ROUND2_PREFREEZE_REJECTION_PATH =
  ".zerox/verification/conversation-disclosure/CD03A-round2-prefreeze-rejection.json";
export const CONTINUATION_V3_ROUND2_POLICY_PATH =
  ".zerox/verification/conversation-disclosure/CD03A-round2-successor-evolution-policy.json";
export const CONTINUATION_V3_ROUND2_BASELINE_ARCHIVE_PATH =
  ".zerox/verification/conversation-disclosure/CD03A-round2-baseline-archive.json";

export const CONTINUATION_V3_REVIEW_LANES = CONTINUATION_V2_REVIEW_LANES;
export const CONTINUATION_V3_LIFECYCLE_PHASES = Object.freeze([
  "review_pre_transition",
  "review_post_transition",
  "anchored_planned",
  "authorized_active",
]);
export const CONTINUATION_V3_EXECUTABLE_KINDS = Object.freeze([
  "checker",
  "contract",
  "freezer",
  "governance",
  "runner",
]);
export const CONTINUATION_V3_ADMISSION_CLASSES = Object.freeze([
  "frozen_file",
  "transition_live",
  "transition_payload",
  "post_review_mutable",
  "review_output_absent",
  "rejected_output_absent",
]);

export const CONTINUATION_V3_EXECUTABLE_PATH_BY_KIND = Object.freeze({
  checker: "scripts/check-conversation-disclosure-continuation-v3.mjs",
  contract: "scripts/conversation-disclosure-continuation-contract-v3.mjs",
  freezer: "scripts/freeze-conversation-disclosure-continuation-v3.mjs",
  governance: "scripts/conversation-disclosure-program-governance-v3.mjs",
  runner: "scripts/verify-conversation-disclosure-continuation-v3.mjs",
});

export const CONTINUATION_V3_ROUND2_FORBIDDEN_OUTPUT_PATHS = Object.freeze([
  ".zerox/verification/conversation-disclosure/CD03A-round2-review-snapshot.json",
  ".zerox/verification/conversation-disclosure/CD03A-round2-contract-review.json",
  ".zerox/verification/conversation-disclosure/CD03A-round2-runtime-review.json",
  ".zerox/verification/conversation-disclosure/CD03A-round2-governance-review.json",
  ".zerox/verification/conversation-disclosure/CD03A-round2-closure-manifest.json",
  ".zerox/verification/conversation-disclosure/CD03A-round2-external-attestation.json",
].sort());

export const CONTINUATION_V3_ROUND2_POLICY_TRUST_ROOT = Object.freeze({
  byteSha256: "sha256:0f082ee8000cf58a428073bfcd10151919ddb3eecc46dea6531422b01865e3ff",
  canonicalDigest: "sha256:aa9fa6893b20b16ccab49cbe41af65a46b9719a334691ef6174722ffb1f2edc7",
});
export const CONTINUATION_V3_ROUND2_ARCHIVE_TRUST_ROOT = Object.freeze({
  byteSha256: "sha256:52aca7ea73e9bd365b7beaa13814b25d618dac4c67bf9230ca9f392b49ab2797",
  digest: "sha256:eed3ca13a9ed9bc20ee952eaacf3e75a16e55845ac5b27929cb046e8b08b2970",
  entrySetDigest: "sha256:c1378e52f4e100cdada35b0e4c80b53d47e99031ddb6f7d076550388fd85383b",
});

export const CONTINUATION_V3_ROUND2_EXECUTABLE_TRUST_ROOTS = Object.freeze([
  Object.freeze({
    kind: "checker",
    path: "scripts/check-conversation-disclosure-continuation-v2.mjs",
    sha256: "sha256:3e983796487d4b1b2ab96e17724f85e4970f28f5212b5926b10e8f56c04c241c",
  }),
  Object.freeze({
    kind: "contract",
    path: "scripts/conversation-disclosure-continuation-contract-v2.mjs",
    sha256: "sha256:4f6f997b9a01dedbcba5865ac0f7d009dfd1f7c380951465e85922e5b29e7bee",
  }),
  Object.freeze({
    kind: "freezer",
    path: "scripts/freeze-conversation-disclosure-continuation-v2.mjs",
    sha256: "sha256:3fe4a400d5d57d06187520aeda8de32d43b40970fb0ed3cc6b54ccca7f3b4605",
  }),
  Object.freeze({
    kind: "governance",
    path: "scripts/conversation-disclosure-program-governance-v2.mjs",
    sha256: "sha256:501958850caa4f9b9a10440e62d9555ae7aca3565d12d254581157c7d7b88269",
  }),
  Object.freeze({
    kind: "runner",
    path: "scripts/verify-conversation-disclosure-continuation-v2.mjs",
    sha256: "sha256:563a647b70ea53f84948aec0398dce0162153c4fb199597a9d0a242e9824a990",
  }),
]);

export const CONTINUATION_V3_ROUND2_TRANSITION_TRUST_ROOTS = Object.freeze([
  Object.freeze({
    path: "package.json",
    kind: "package-structure-migration",
    fromSha256: "sha256:560fb3e3b2829a32b4ac694c7781fce9e53941a9e20fc4ec1c08602d53c278b9",
    stagedTargetPath:
      ".zerox/verification/conversation-disclosure/CD03A-round2-package.target.json",
    toSha256: "sha256:cf1b85c49d6b3999e15711207dea97732ce3e95a3a8367a98524f55a483ffe9a",
  }),
  Object.freeze({
    path: "scripts/check-harness-state.mjs",
    kind: "harness-delegation-migration",
    fromSha256: "sha256:231d28280f6891f50f5c714b4161d1b9d93cf171e0b67396de67ce7a36e06339",
    stagedTargetPath:
      ".zerox/verification/conversation-disclosure/CD03A-round2-harness.target.mjs",
    toSha256: "sha256:03e72284a7c23612aadcadb437e05c53c60392b2c29096c8eed11c36bdc08797",
  }),
  Object.freeze({
    path: "src/shared/conversationDisclosureProgram.test.ts",
    kind: "program-test-migration",
    fromSha256: "sha256:087cff0ba7f208464bf62e41f3a10dfbb88f3f2461d46398187c0b4cfa16dd5c",
    stagedTargetPath:
      ".zerox/verification/conversation-disclosure/CD03A-round2-program-test.target.ts",
    toSha256: "sha256:18eab102934a3af3da8ea5b9e0687db746ac342c835fa16f848974d752651bd2",
  }),
  Object.freeze({
    path: "src/shared/packageScripts.test.ts",
    kind: "package-test-migration",
    fromSha256: "sha256:2f30d10ebd5ccc408255813e0d10ca4e8bd145930bdbe263bc2a6e5d2fa61efe",
    stagedTargetPath:
      ".zerox/verification/conversation-disclosure/CD03A-round2-package-scripts-test.target.ts",
    toSha256: "sha256:56dd4ead037332c8c7ec0b25359d489a0a44deec9e41fe529ca4dbb9a76da947",
  }),
]);

export const CONTINUATION_V3_ROUND3_TARGET_PATH_BY_LIVE_PATH = Object.freeze({
  "package.json":
    ".zerox/verification/conversation-disclosure/CD03A-round3-package.target.json",
  "scripts/check-harness-state.mjs":
    ".zerox/verification/conversation-disclosure/CD03A-round3-harness.target.mjs",
  "src/shared/conversationDisclosureProgram.test.ts":
    ".zerox/verification/conversation-disclosure/CD03A-round3-program-test.target.ts",
  "src/shared/packageScripts.test.ts":
    ".zerox/verification/conversation-disclosure/CD03A-round3-package-scripts-test.target.ts",
});

// Exact Round3 target bytes are independently staged and hard-rooted here.
export const CONTINUATION_V3_ROUND3_GOVERNANCE_TRANSITION_TRUST_ROOTS = Object.freeze([
  Object.freeze({
    path: "package.json",
    kind: "package-structure-migration",
    fromSha256: "sha256:560fb3e3b2829a32b4ac694c7781fce9e53941a9e20fc4ec1c08602d53c278b9",
    stagedTargetPath: CONTINUATION_V3_ROUND3_TARGET_PATH_BY_LIVE_PATH["package.json"],
    toSha256: "sha256:cf1b85c49d6b3999e15711207dea97732ce3e95a3a8367a98524f55a483ffe9a",
  }),
  Object.freeze({
    path: "scripts/check-harness-state.mjs",
    kind: "harness-delegation-migration",
    fromSha256: "sha256:231d28280f6891f50f5c714b4161d1b9d93cf171e0b67396de67ce7a36e06339",
    stagedTargetPath:
      CONTINUATION_V3_ROUND3_TARGET_PATH_BY_LIVE_PATH["scripts/check-harness-state.mjs"],
    toSha256: "sha256:4d78ee6fef889aeba5a66669eab6409bb5ee2ac6ebb245ea751a05b6c2606876",
  }),
  Object.freeze({
    path: "src/shared/conversationDisclosureProgram.test.ts",
    kind: "program-test-migration",
    fromSha256: "sha256:087cff0ba7f208464bf62e41f3a10dfbb88f3f2461d46398187c0b4cfa16dd5c",
    stagedTargetPath:
      CONTINUATION_V3_ROUND3_TARGET_PATH_BY_LIVE_PATH[
        "src/shared/conversationDisclosureProgram.test.ts"
      ],
    toSha256: "sha256:7b7f40e9946c786a472b7ba6d38fd15191cb1eff03de026b0ba0f7415f8b0282",
  }),
  Object.freeze({
    path: "src/shared/packageScripts.test.ts",
    kind: "package-test-migration",
    fromSha256: "sha256:2f30d10ebd5ccc408255813e0d10ca4e8bd145930bdbe263bc2a6e5d2fa61efe",
    stagedTargetPath:
      CONTINUATION_V3_ROUND3_TARGET_PATH_BY_LIVE_PATH["src/shared/packageScripts.test.ts"],
    toSha256: "sha256:1b22f79fbcdbca9f6e90a2a791c9a140b1edffcb6964cecd0689e2292321d7ae",
  }),
]);
export const CONTINUATION_V3_GOVERNANCE_TRANSITIONS = Object.freeze({
  "package.json": "package-structure-migration",
  "scripts/check-harness-state.mjs": "harness-delegation-migration",
  "src/shared/conversationDisclosureProgram.test.ts": "program-test-migration",
  "src/shared/packageScripts.test.ts": "package-test-migration",
});
export const CONTINUATION_V3_PROGRAM_ROOT_DEFINITION_DIGEST =
  "sha256:a1daf95f2bfe85ec7810c5b35ffe272204b896121a53a134b558993f34d33638";
export const CONTINUATION_V3_ORDINARY_ARGUMENTS =
  "--mode authorized_active --control-root CALLER_SUPPLIED_CONTROL_ROOT --subject-repository-realpath CALLER_SUPPLIED_SUBJECT_REPOSITORY_REALPATH --base-anchor CALLER_SUPPLIED_BASE_PATH --expected-base-anchor-digest CALLER_SUPPLIED_BASE_DIGEST --expected-policy-digest CALLER_SUPPLIED_POLICY_DIGEST --expected-snapshot-digest CALLER_SUPPLIED_SNAPSHOT_DIGEST --continuation-anchor CALLER_SUPPLIED_CONTINUATION_PATH --expected-continuation-anchor-digest CALLER_SUPPLIED_CONTINUATION_DIGEST";
export const CONTINUATION_V3_SUCCESSOR_CHECKER_VERIFICATION =
  `node scripts/check-conversation-disclosure-continuation-v3.mjs ${CONTINUATION_V3_ORDINARY_ARGUMENTS}`;
export const CONTINUATION_V3_SUCCESSOR_HARNESS_VERIFICATION =
  `node scripts/check-harness-state.mjs ${CONTINUATION_V3_ORDINARY_ARGUMENTS}`;

export const CONTINUATION_V3_ROUND2_CONTRADICTION_CODE =
  "round2-transition-target-double-classification";

const POLICY_KEYS = Object.freeze([
  "admission",
  "admissionCoverage",
  "algorithm",
  "baselineArchive",
  "closedWorld",
  "continuationExecutables",
  "digest",
  "featureId",
  "governanceTransitions",
  "kind",
  "parentEvidence",
  "pathAuthorities",
  "policyId",
  "programId",
  "reviewSnapshot",
  "round",
  "round1Rejection",
  "round2PrefreezeRejection",
  "schemaVersion",
  "status",
  "successor",
  "timePolicy",
  "trustRoots",
  "workstreamId",
]);
const SNAPSHOT_KEYS = Object.freeze([
  "absentPaths",
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
const PREFREEZE_REJECTION_KEYS = Object.freeze([
  "algorithm",
  "baselineArchive",
  "contradiction",
  "continuationExecutables",
  "digest",
  "featureId",
  "governanceTransitions",
  "kind",
  "liveTransitionFiles",
  "programId",
  "recoveryRound",
  "rejectedRound",
  "schemaVersion",
  "sourcePolicy",
  "status",
  "transitionPayloadFiles",
  "verifiedAbsentPaths",
  "workstreamId",
]);
const FILE_DIGEST_KEYS = Object.freeze(["path", "sha256"]);
const EXECUTABLE_KEYS = Object.freeze(["kind", "path", "sha256"]);
const COVERAGE_KEYS = Object.freeze(["class", "path"]);
const POLICY_REFERENCE_KEYS = Object.freeze([
  "byteSha256",
  "canonicalDigest",
  "path",
]);
const ARCHIVE_REFERENCE_KEYS = Object.freeze([
  "byteSha256",
  "digest",
  "entrySetDigest",
  "path",
]);
const RECEIPT_KEYS = Object.freeze([
  "admissionFeatureDefinitionDigest",
  "admissionFeatureFileSetDigest",
  "challenge",
  "closedWorldDigest",
  "completedAt",
  "featureId",
  "findingCounts",
  "findings",
  "kind",
  "lane",
  "parentEvidenceBundleDigest",
  "pathAuthorityDigest",
  "policyDigest",
  "programId",
  "reviewAgentId",
  "reviewTaskPath",
  "reviewedPhase",
  "round",
  "schemaVersion",
  "snapshotDigest",
  "snapshotFileCount",
  "successorFeatureDefinitionDigest",
  "successorWorkstreamDefinitionDigest",
  "transport",
  "validatorDigest",
  "verdict",
  "workstreamId",
]);
const FINDING_KEYS = Object.freeze(["evidence", "id", "severity", "summary"]);
const MANIFEST_KEYS = Object.freeze([
  "digest",
  "externalAttestation",
  "externalRunner",
  "featureId",
  "kind",
  "parentEvidenceBundleDigest",
  "policy",
  "programId",
  "reviewReceipts",
  "round",
  "schemaVersion",
  "snapshot",
  "status",
  "validator",
  "workstreamId",
]);
const ATTESTATION_KEYS = Object.freeze([
  "candidateResults",
  "completedAt",
  "digest",
  "governancePhase",
  "kind",
  "parentEvidenceBundleDigest",
  "pendingManifestDigest",
  "policyDigest",
  "repositoryRealpath",
  "reviewReceiptBindings",
  "runnerDigest",
  "schemaVersion",
  "snapshotDigest",
  "status",
  "subjectIdentityAssurance",
  "trustLevel",
  "validatorDigest",
]);
const ANCHOR_KEYS = Object.freeze([
  "attestationDigest",
  "completedAt",
  "digest",
  "head",
  "kind",
  "parentEvidenceBundleDigest",
  "policyDigest",
  "repositoryRealpath",
  "reviewReceiptBindings",
  "runnerDigest",
  "schemaVersion",
  "snapshotDigest",
  "subjectIdentityAssurance",
  "trustLevel",
  "validatorDigest",
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
const REVIEW_REFERENCE_KEYS = Object.freeze([
  "canonicalDigest",
  "challenge",
  "lane",
  "path",
]);
const RECEIPT_BINDING_KEYS = Object.freeze([
  "canonicalDigest",
  "challenge",
  "lane",
]);
const CANDIDATE_RESULT_KEYS = Object.freeze([
  "kind",
  "path",
  "receiptDigest",
  "status",
  "stderrDigest",
  "stdoutDigest",
]);

export const CONTINUATION_V3_POLICY_KEYS = POLICY_KEYS;
export const CONTINUATION_V3_SNAPSHOT_KEYS = SNAPSHOT_KEYS;
export const CONTINUATION_V3_BASELINE_ARCHIVE_KEYS = ARCHIVE_KEYS;
export const CONTINUATION_V3_PREFREEZE_REJECTION_KEYS = PREFREEZE_REJECTION_KEYS;

export const canonicalJsonV3 = canonicalJsonV2;
export const hashCanonicalV3 = hashCanonicalV2;
export const sha256BytesV3 = sha256BytesV2;
export const sha256DigestV3 = sha256DigestV2;
export const withCanonicalDigestV3 = withCanonicalDigestV2;
export const repositoryPathV3 = repositoryPathV2;
export const stableFeatureDefinitionV3 = stableFeatureDefinitionV2;
export const stableHistoricalFeatureDefinitionV3 =
  stableHistoricalFeatureDefinitionV2;
export const stableProgramRootDefinitionV3 = stableProgramRootDefinitionV2;
export const stableWorkstreamDefinitionV3 = stableWorkstreamDefinitionV2;
export const validateLiveProgramRootV3 = validateLiveProgramRootV2;
export const CONTINUATION_V3_BOOKKEEPING_VALIDATORS =
  CONTINUATION_V2_BOOKKEEPING_VALIDATORS;

export function expectedRound2ContradictionV3(transitions =
  CONTINUATION_V3_ROUND2_TRANSITION_TRUST_ROOTS) {
  const targetClassifications = transitions.map((entry) => ({
    path: entry.stagedTargetPath,
    classes: ["frozen_file", "transition_target"],
  }));
  return {
    code: CONTINUATION_V3_ROUND2_CONTRADICTION_CODE,
    errors: [
      ...targetClassifications.map((entry) =>
        `P107A review coverage must classify exactly once: ${entry.path}`),
      "admission reviewCoverageDigest is invalid or stale",
    ],
    targetClassifications,
  };
}

export function validateRound2PrefreezeRejectionV3(witness) {
  const errors = [];
  if (!plainObject(witness) || !exactKeys(witness, PREFREEZE_REJECTION_KEYS)) {
    return ["round2PrefreezeRejection must contain the exact v3 witness keys"];
  }
  if (witness.schemaVersion !== 3
    || witness.kind !== CONTINUATION_V3_PREFREEZE_REJECTION_KIND
    || witness.algorithm !== CONTINUATION_V3_ALGORITHM
    || witness.workstreamId !== CONTINUATION_V3_WORKSTREAM_ID
    || witness.featureId !== CONTINUATION_V3_FEATURE_ID
    || witness.rejectedRound !== CONTINUATION_V3_REJECTED_ROUND
    || witness.recoveryRound !== CONTINUATION_V3_ROUND
    || witness.status !== "rejected_pre_freeze"
    || !nonEmpty(witness.programId)) {
    errors.push("Round2 pre-freeze rejection identity/status is invalid");
  }
  const expectedPolicy = {
    path: CONTINUATION_V3_ROUND2_POLICY_PATH,
    ...CONTINUATION_V3_ROUND2_POLICY_TRUST_ROOT,
  };
  if (!plainObject(witness.sourcePolicy)
    || !exactKeys(witness.sourcePolicy, POLICY_REFERENCE_KEYS)
    || canonicalJsonV3(witness.sourcePolicy) !== canonicalJsonV3(expectedPolicy)) {
    errors.push("Round2 rejected policy reference differs from the hard trust root");
  }
  const expectedArchive = {
    path: CONTINUATION_V3_ROUND2_BASELINE_ARCHIVE_PATH,
    ...CONTINUATION_V3_ROUND2_ARCHIVE_TRUST_ROOT,
  };
  if (!plainObject(witness.baselineArchive)
    || !exactKeys(witness.baselineArchive, ARCHIVE_REFERENCE_KEYS)
    || canonicalJsonV3(witness.baselineArchive) !== canonicalJsonV3(expectedArchive)) {
    errors.push("Round2 rejected archive reference differs from the hard trust root");
  }
  if (canonicalJsonV3(witness.continuationExecutables)
    !== canonicalJsonV3(CONTINUATION_V3_ROUND2_EXECUTABLE_TRUST_ROOTS)) {
    errors.push("Round2 rejected executable bytes differ from the hard trust root");
  }
  if (canonicalJsonV3(witness.governanceTransitions)
    !== canonicalJsonV3(CONTINUATION_V3_ROUND2_TRANSITION_TRUST_ROOTS)) {
    errors.push("Round2 rejected governance transitions differ from the hard trust root");
  }
  const expectedLive = CONTINUATION_V3_ROUND2_TRANSITION_TRUST_ROOTS
    .map((entry) => ({ path: entry.path, sha256: entry.fromSha256 }))
    .sort(comparePath);
  const expectedPayload = CONTINUATION_V3_ROUND2_TRANSITION_TRUST_ROOTS
    .map((entry) => ({ path: entry.stagedTargetPath, sha256: entry.toSha256 }))
    .sort(comparePath);
  if (canonicalJsonV3(witness.liveTransitionFiles)
    !== canonicalJsonV3(expectedLive)) {
    errors.push("Round2 witness does not prove all transition live files at fromSha256");
  }
  if (canonicalJsonV3(witness.transitionPayloadFiles)
    !== canonicalJsonV3(expectedPayload)) {
    errors.push("Round2 witness does not freeze the exact four transition payloads");
  }
  if (canonicalJsonV3(witness.verifiedAbsentPaths)
    !== canonicalJsonV3(CONTINUATION_V3_ROUND2_FORBIDDEN_OUTPUT_PATHS)) {
    errors.push("Round2 witness absence set is not exact");
  }
  if (canonicalJsonV3(witness.contradiction)
    !== canonicalJsonV3(expectedRound2ContradictionV3())) {
    errors.push("Round2 witness does not deterministically reproduce the v2 contradiction");
  }
  validateCanonicalDigest(witness, "Round2 pre-freeze rejection", errors);
  return unique(errors);
}

export function buildAdmissionCoverageV3(
  admission,
  transitions,
  rejectedOutputAbsentPaths,
) {
  const files = admission?.featureDefinition?.files;
  if (!Array.isArray(files) || files.length === 0
    || new Set(files).size !== files.length
    || files.some((entry) => !repositoryPathV3(entry))) {
    throw new TypeError("P107A exact file roster is invalid");
  }
  const transitionLive = new Set((transitions ?? []).map((entry) => entry.path));
  const transitionPayload = new Set(
    (transitions ?? []).map((entry) => entry.stagedTargetPath),
  );
  const postReviewMutable = new Set(admission.postReviewMutablePaths ?? []);
  const reviewOutputAbsent = new Set(admission.reviewOutputPaths ?? []);
  if (!Array.isArray(rejectedOutputAbsentPaths)
    || canonicalJsonV3(rejectedOutputAbsentPaths)
      !== canonicalJsonV3(CONTINUATION_V3_ROUND2_FORBIDDEN_OUTPUT_PATHS)) {
    throw new TypeError(
      "admission coverage requires the exact rejected witness absence set",
    );
  }
  const rejectedOutputAbsent = new Set(rejectedOutputAbsentPaths);
  const coverage = files.map((relativePath) => {
    const classes = [
      transitionLive.has(relativePath) ? "transition_live" : null,
      transitionPayload.has(relativePath) ? "transition_payload" : null,
      postReviewMutable.has(relativePath) ? "post_review_mutable" : null,
      reviewOutputAbsent.has(relativePath) ? "review_output_absent" : null,
      rejectedOutputAbsent.has(relativePath) ? "rejected_output_absent" : null,
    ].filter(Boolean);
    if (classes.length > 1) {
      throw new TypeError(`P107A path has overlapping admission classes: ${relativePath}`);
    }
    return { path: relativePath, class: classes[0] ?? "frozen_file" };
  }).sort(comparePath);
  return coverage;
}

export function validateAdmissionCoverageV3(
  coverage,
  admission,
  transitions,
  rejectedOutputAbsentPaths,
) {
  const errors = [];
  if (!Array.isArray(coverage) || coverage.length === 0) {
    return ["admissionCoverage must be a non-empty explicit array"];
  }
  const paths = [];
  for (const [index, entry] of coverage.entries()) {
    if (!plainObject(entry) || !exactKeys(entry, COVERAGE_KEYS)
      || !repositoryPathV3(entry.path)
      || !CONTINUATION_V3_ADMISSION_CLASSES.includes(entry.class)) {
      errors.push(`admissionCoverage[${index}] is invalid`);
      continue;
    }
    paths.push(entry.path);
  }
  validateSortedUnique(paths, "admissionCoverage paths", errors);
  let expected;
  try {
    expected = buildAdmissionCoverageV3(
      admission,
      transitions,
      rejectedOutputAbsentPaths,
    );
  } catch (error) {
    errors.push(error.message);
  }
  if (expected && canonicalJsonV3(coverage) !== canonicalJsonV3(expected)) {
    errors.push("admissionCoverage differs from the exact P107A classification");
  }
  if (admission?.reviewCoverageDigest !== safeHash(coverage)) {
    errors.push("admission reviewCoverageDigest differs from explicit admissionCoverage");
  }
  for (const transition of transitions ?? []) {
    const matches = coverage.filter((entry) => entry.path === transition.stagedTargetPath);
    if (matches.length !== 1 || matches[0].class !== "transition_payload") {
      errors.push(
        `transition target must be classified only as transition_payload: ${transition.stagedTargetPath}`,
      );
    }
  }
  const rejectedCoveragePaths = coverage
    .filter((entry) => entry?.class === "rejected_output_absent")
    .map((entry) => entry.path);
  if (!sameStringSet(rejectedCoveragePaths, rejectedOutputAbsentPaths ?? [])) {
    errors.push(
      "rejected_output_absent coverage differs from the exact witness absence set",
    );
  }
  return unique(errors);
}

export function validateContinuationPolicyV3(policy, bindings = {}) {
  const errors = [];
  if (!plainObject(policy) || !exactKeys(policy, POLICY_KEYS)) {
    return ["continuation policy must contain the exact v3 keys"];
  }
  if (policy.schemaVersion !== 3
    || policy.kind !== CONTINUATION_V3_POLICY_KIND
    || policy.algorithm !== CONTINUATION_V3_ALGORITHM
    || policy.policyId !== CONTINUATION_V3_POLICY_ID
    || policy.workstreamId !== CONTINUATION_V3_WORKSTREAM_ID
    || policy.featureId !== CONTINUATION_V3_FEATURE_ID
    || policy.round !== CONTINUATION_V3_ROUND
    || policy.status !== "frozen"
    || !nonEmpty(policy.programId)) {
    errors.push("continuation policy v3 identity/status is invalid");
  }
  errors.push(...validateParentEvidenceBundleV1(
    policy.parentEvidence,
    bindings.parentEvidence ?? {},
  ));
  errors.push(...validateRound1RejectionV2(policy.round1Rejection));
  errors.push(...validateRound2PrefreezeRejectionV3(
    policy.round2PrefreezeRejection,
  ));
  errors.push(...validateAdmissionDefinitionV2(policy.admission));
  errors.push(...validateAdmissionCoverageV3(
    policy.admissionCoverage,
    policy.admission,
    policy.governanceTransitions,
    policy.round2PrefreezeRejection?.verifiedAbsentPaths,
  ));
  errors.push(...validateSuccessorDefinitionV2(policy.successor));
  const successorVerification = policy.successor?.featureDefinition?.verification ?? [];
  if (successorVerification.filter((entry) =>
    entry === CONTINUATION_V3_SUCCESSOR_CHECKER_VERIFICATION).length !== 1
    || successorVerification.filter((entry) =>
      entry === CONTINUATION_V3_SUCCESSOR_HARNESS_VERIFICATION).length !== 1
    || successorVerification.some((entry) => typeof entry !== "string"
      || entry.includes("check-conversation-disclosure-continuation-v2.mjs"))) {
    errors.push("successor verification must contain exact v3 checker/harness commands only");
  }
  errors.push(...validateClosedWorldContractV2(policy.closedWorld, {
    admission: policy.admission,
    successor: policy.successor,
  }));
  if (policy.programId !== policy.closedWorld?.programRootDefinition?.programId
    || policy.programId !== policy.round2PrefreezeRejection?.programId) {
    errors.push("continuation policy program identity is inconsistent");
  }
  if (policy.closedWorld?.programRootDefinitionDigest
    !== CONTINUATION_V3_PROGRAM_ROOT_DEFINITION_DIGEST) {
    errors.push("frozen Program root differs from the Round3 hard trust root");
  }
  if (canonicalJsonV3(policy.governanceTransitions)
    !== canonicalJsonV3(CONTINUATION_V3_ROUND3_GOVERNANCE_TRANSITION_TRUST_ROOTS)) {
    errors.push("v3 governance transitions differ from the Round3 target trust root");
  }
  errors.push(...validateGovernanceTransitionsV2(policy.governanceTransitions));
  errors.push(...validatePathAuthoritiesV2(policy.pathAuthorities, {
    trustRoots: policy.trustRoots,
    governanceTransitions: policy.governanceTransitions,
  }));
  validateBaselineArchiveReference(policy.baselineArchive,
    "continuation policy baselineArchive", errors);
  validateTrustRootsAndExecutables(policy, errors);
  validateSuccessorCoverage(policy, errors);
  if (!plainObject(policy.reviewSnapshot)
    || !exactKeys(policy.reviewSnapshot, ["path"])
    || policy.reviewSnapshot.path !== CONTINUATION_V3_REVIEW_SNAPSHOT_PATH) {
    errors.push("continuation policy reviewSnapshot reference is invalid");
  }
  if (!plainObject(policy.timePolicy)
    || !exactKeys(policy.timePolicy, ["futureToleranceMs"])
    || policy.timePolicy.futureToleranceMs !== 0) {
    errors.push("continuation policy timePolicy must fail closed at zero future tolerance");
  }
  validateCanonicalDigest(policy, "continuation policy", errors);
  if (bindings.expectedDigest !== undefined
    && policy.digest !== bindings.expectedDigest) {
    errors.push("continuation policy digest does not match the caller pin");
  }
  if (bindings.baselineArchive !== undefined) {
    errors.push(...validateBaselineArchiveV3(bindings.baselineArchive, policy));
  }
  if (bindings.lifecycleState !== undefined) {
    errors.push(...validateLifecycleStateV3(bindings.lifecycleState, policy));
  }
  if (bindings.liveAdmissionFeature !== undefined) {
    bindLiveFeature(bindings.liveAdmissionFeature, policy.admission,
      "live P107A", errors);
  }
  if (bindings.liveAdmissionWorkstream !== undefined) {
    bindLiveWorkstream(bindings.liveAdmissionWorkstream,
      policy.admission.workstreamDefinition,
      policy.admission.workstreamDefinitionDigest,
      "live CD03A", errors);
  }
  if (bindings.liveProgram !== undefined) {
    try {
      const stable = stableProgramRootDefinitionV3(bindings.liveProgram);
      if (canonicalJsonV3(stable)
          !== canonicalJsonV3(policy.closedWorld?.programRootDefinition)
        || hashCanonicalV3(stable)
          !== policy.closedWorld?.programRootDefinitionDigest) {
        errors.push("live program stable root differs from the frozen program root");
      }
    } catch (error) {
      errors.push(`live program root is invalid: ${error.message}`);
    }
  }
  return unique(errors);
}

export function validateBaselineArchiveV3(archive, policy) {
  const errors = [];
  if (!plainObject(archive) || !exactKeys(archive, ARCHIVE_KEYS)) {
    return ["baseline archive must contain the exact v3 keys"];
  }
  if (archive.schemaVersion !== 3
    || archive.kind !== CONTINUATION_V3_BASELINE_ARCHIVE_KIND
    || archive.algorithm !== CONTINUATION_V3_ALGORITHM
    || archive.workstreamId !== CONTINUATION_V3_WORKSTREAM_ID
    || archive.featureId !== CONTINUATION_V3_FEATURE_ID
    || archive.round !== CONTINUATION_V3_ROUND
    || !nonEmpty(archive.programId)) {
    errors.push("baseline archive v3 identity is invalid");
  }
  if (!Array.isArray(archive.entries) || archive.entries.length === 0) {
    errors.push("baseline archive entries must be non-empty");
  }
  const paths = [];
  for (const [index, entry] of (archive.entries ?? []).entries()) {
    if (!plainObject(entry) || !exactKeys(entry, ARCHIVE_ENTRY_KEYS)
      || !repositoryPathV3(entry.path)
      || !["round23_review_snapshot", "cd03a_review_snapshot",
        "governance_transition"].includes(entry.source)
      || !sha256DigestV3(entry.sha256)
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
      if (sha256BytesV3(decoded) !== entry.sha256) throw new Error("digest");
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
    if (canonicalJsonV3(actual) !== canonicalJsonV3(expected)) {
      errors.push("baseline archive coverage differs from modify/transition authorities");
    }
  }
  return unique(errors);
}

export function validateContinuationReviewSnapshotV3(snapshot, policy, bindings = {}) {
  const errors = [];
  if (!plainObject(snapshot) || !exactKeys(snapshot, SNAPSHOT_KEYS)) {
    return ["continuation review snapshot must contain the exact v3 keys"];
  }
  if (snapshot.schemaVersion !== 3
    || snapshot.kind !== CONTINUATION_V3_SNAPSHOT_KIND
    || snapshot.algorithm !== CONTINUATION_V3_ALGORITHM
    || snapshot.workstreamId !== CONTINUATION_V3_WORKSTREAM_ID
    || snapshot.featureId !== CONTINUATION_V3_FEATURE_ID
    || snapshot.round !== CONTINUATION_V3_ROUND
    || !nonEmpty(snapshot.programId)) {
    errors.push("continuation review snapshot v3 identity is invalid");
  }
  validateTimestamp(snapshot.frozenAt, bindings.verifierNow,
    "continuation review snapshot frozenAt", errors);
  validateBaselineArchiveReference(snapshot.baselineArchive,
    "continuation review snapshot baselineArchive", errors);
  for (const [key, label] of [
    ["frozenFiles", "snapshot frozenFiles"],
    ["transitionPayloadFiles", "snapshot transitionPayloadFiles"],
    ["baselineFiles", "snapshot baselineFiles"],
  ]) validateFileDigestArray(snapshot[key], label, errors);
  validateStringPaths(snapshot.absentPaths, "snapshot absentPaths", errors);
  validateStringPaths(snapshot.reviewOutputAbsentPaths,
    "snapshot reviewOutputAbsentPaths", errors);
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
      if (prior) errors.push(`snapshot subject path overlaps ${prior}/${name}: ${relativePath}`);
      else categories.set(relativePath, name);
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
      admissionFeatureDefinitionDigest: policy.admission?.featureDefinitionDigest,
      admissionFeatureFileSetDigest: policy.admission?.featureFileSetDigest,
      successorWorkstreamDefinitionDigest:
        policy.successor?.workstreamDefinitionDigest,
      successorFeatureDefinitionDigest: policy.successor?.featureDefinitionDigest,
    };
    for (const [key, value] of Object.entries(expectedBindings)) {
      if (snapshot[key] !== value) {
        errors.push(`continuation review snapshot ${key} binding is stale`);
      }
    }
    if (canonicalJsonV3(snapshot.governanceTransitions)
      !== canonicalJsonV3(policy.governanceTransitions)) {
      errors.push("snapshot governance transitions differ from policy");
    }
    if (canonicalJsonV3(snapshot.baselineArchive)
      !== canonicalJsonV3(policy.baselineArchive)) {
      errors.push("snapshot baselineArchive differs from policy");
    }
    validateSnapshotAdmissionSubjects(snapshot, policy, errors);
    validateSnapshotAuthoritySubjects(snapshot, policy, errors);
  }
  validateCanonicalDigest(snapshot, "continuation review snapshot", errors);
  return unique(errors);
}

export function validateContinuationReviewReceiptV3(
  receipt,
  snapshot,
  policy,
  bindings = {},
) {
  const errors = [];
  if (!plainObject(receipt) || !exactKeys(receipt, RECEIPT_KEYS)) {
    return ["continuation review receipt must contain the exact v3 keys"];
  }
  if (receipt.schemaVersion !== 3
    || receipt.kind !== CONTINUATION_V3_RECEIPT_KIND
    || receipt.workstreamId !== CONTINUATION_V3_WORKSTREAM_ID
    || receipt.featureId !== CONTINUATION_V3_FEATURE_ID
    || receipt.round !== CONTINUATION_V3_ROUND
    || !CONTINUATION_V3_REVIEW_LANES.includes(receipt.lane)
    || receipt.transport !== "codex-collaboration"
    || receipt.reviewedPhase !== "review_pre_transition"
    || !nonEmpty(receipt.programId)
    || !nonEmpty(receipt.reviewTaskPath)
    || !nonEmpty(receipt.reviewAgentId)) {
    errors.push("continuation review receipt v3 identity is invalid");
  }
  for (const key of [
    "challenge",
    "snapshotDigest",
    "policyDigest",
    "parentEvidenceBundleDigest",
    "closedWorldDigest",
    "pathAuthorityDigest",
    "admissionFeatureDefinitionDigest",
    "admissionFeatureFileSetDigest",
    "successorWorkstreamDefinitionDigest",
    "successorFeatureDefinitionDigest",
    "validatorDigest",
  ]) {
    if (!sha256DigestV3(receipt[key])) {
      errors.push(`continuation review receipt ${key} must be SHA-256`);
    }
  }
  const completedAt = validateTimestamp(receipt.completedAt, bindings.verifierNow,
    "continuation review receipt completedAt", errors);
  const frozenAt = parseIso(snapshot?.frozenAt);
  if (completedAt !== null && frozenAt !== null && completedAt < frozenAt) {
    errors.push("continuation review receipt predates the frozen snapshot");
  }
  validateFindings(receipt, errors);
  if (!["passed", "failed"].includes(receipt.verdict)) {
    errors.push("continuation review receipt verdict is invalid");
  }
  if (plainObject(snapshot) && plainObject(policy)) {
    const expected = {
      programId: snapshot.programId,
      snapshotDigest: snapshot.digest,
      snapshotFileCount: (snapshot.frozenFiles?.length ?? 0)
        + (snapshot.transitionPayloadFiles?.length ?? 0)
        + (snapshot.baselineFiles?.length ?? 0),
      policyDigest: policy.digest,
      parentEvidenceBundleDigest: policy.parentEvidence?.bundleDigest,
      closedWorldDigest: policy.closedWorld?.digest,
      pathAuthorityDigest: safeHash(policy.pathAuthorities),
      admissionFeatureDefinitionDigest: policy.admission?.featureDefinitionDigest,
      admissionFeatureFileSetDigest: policy.admission?.featureFileSetDigest,
      successorWorkstreamDefinitionDigest:
        policy.successor?.workstreamDefinitionDigest,
      successorFeatureDefinitionDigest: policy.successor?.featureDefinitionDigest,
      validatorDigest: policy.continuationExecutables?.find(
        (entry) => entry?.kind === "checker",
      )?.sha256,
    };
    for (const [key, value] of Object.entries(expected)) {
      if (receipt[key] !== value) {
        errors.push(`continuation review receipt ${key} binding is stale`);
      }
    }
  }
  if (bindings.expectedChallenge === undefined
    || bindings.expectedCanonicalDigest === undefined) {
    errors.push("continuation review receipt requires caller-pinned challenge and digest");
  } else {
    if (receipt.challenge !== bindings.expectedChallenge) {
      errors.push("continuation review receipt challenge does not match the caller pin");
    }
    if (hashCanonicalV3(receipt) !== bindings.expectedCanonicalDigest) {
      errors.push("continuation review receipt digest does not match the caller pin");
    }
  }
  return unique(errors);
}

export function validateContinuationReviewSetV3(
  receipts,
  snapshot,
  policy,
  bindings = {},
) {
  const errors = [];
  if (!Array.isArray(receipts)
    || receipts.length !== CONTINUATION_V3_REVIEW_LANES.length) {
    return ["continuation review set must contain exactly three receipts"];
  }
  if (!plainObject(bindings.callerPins)
    || !exactKeys(bindings.callerPins, CONTINUATION_V3_REVIEW_LANES)) {
    return ["continuation review set requires exact caller pins for all lanes"];
  }
  const lanes = [];
  const challenges = [];
  const tasks = [];
  const agents = [];
  for (const receipt of receipts) {
    const pin = bindings.callerPins[receipt?.lane];
    if (!plainObject(pin)
      || !exactKeys(pin, ["canonicalDigest", "challenge"])
      || !sha256DigestV3(pin.challenge)
      || !sha256DigestV3(pin.canonicalDigest)) {
      errors.push(`caller pin is invalid for lane ${receipt?.lane ?? "unknown"}`);
      continue;
    }
    errors.push(...validateContinuationReviewReceiptV3(receipt, snapshot, policy, {
      verifierNow: bindings.verifierNow,
      expectedChallenge: pin.challenge,
      expectedCanonicalDigest: pin.canonicalDigest,
    }));
    lanes.push(receipt.lane);
    challenges.push(receipt.challenge);
    tasks.push(receipt.reviewTaskPath);
    agents.push(receipt.reviewAgentId);
    if (receipt.verdict !== "passed"
      || Object.values(receipt.findingCounts ?? {}).some((value) => value !== 0)
      || receipt.findings?.length !== 0) {
      errors.push(`continuation review lane ${receipt.lane} must pass with zero findings`);
    }
  }
  if (canonicalJsonV3(lanes) !== canonicalJsonV3(CONTINUATION_V3_REVIEW_LANES)) {
    errors.push("continuation review lanes must be exact and ordered");
  }
  for (const [values, subject] of [
    [challenges, "challenges"],
    [tasks, "tasks"],
    [agents, "agents"],
  ]) {
    if (new Set(values).size !== receipts.length) {
      errors.push(`continuation review ${subject} must be unique`);
    }
  }
  return unique(errors);
}

export function validateContinuationClosureManifestV3(manifest, bindings = {}) {
  const errors = [];
  if (!plainObject(manifest) || !exactKeys(manifest, MANIFEST_KEYS)) {
    return ["continuation closure manifest must contain the exact v3 keys"];
  }
  if (manifest.schemaVersion !== 3
    || manifest.kind !== CONTINUATION_V3_MANIFEST_KIND
    || manifest.workstreamId !== CONTINUATION_V3_WORKSTREAM_ID
    || manifest.featureId !== CONTINUATION_V3_FEATURE_ID
    || manifest.round !== CONTINUATION_V3_ROUND
    || !["review_passed_pending_external_anchor", "externally_attested"]
      .includes(manifest.status)) {
    errors.push("continuation closure manifest v3 identity/status is invalid");
  }
  if (!sha256DigestV3(manifest.parentEvidenceBundleDigest)) {
    errors.push("continuation closure manifest parent bundle digest is invalid");
  }
  validatePathDigest(manifest.policy, "manifest policy", errors);
  validatePathDigest(manifest.snapshot, "manifest snapshot", errors);
  validateLaneArray(manifest.reviewReceipts, REVIEW_REFERENCE_KEYS,
    "manifest review receipt", errors, (entry) => repositoryPathV3(entry.path)
      && sha256DigestV3(entry.canonicalDigest)
      && sha256DigestV3(entry.challenge));
  validatePathSha(manifest.validator, "manifest validator", errors);
  validatePathSha(manifest.externalRunner, "manifest external runner", errors);
  if (!plainObject(manifest.externalAttestation)
    || !exactKeys(manifest.externalAttestation, ["canonicalDigest", "path"])
    || !repositoryPathV3(manifest.externalAttestation.path)
    || (manifest.status === "review_passed_pending_external_anchor"
      ? manifest.externalAttestation.canonicalDigest !== null
      : !sha256DigestV3(manifest.externalAttestation.canonicalDigest))) {
    errors.push("manifest external attestation reference is invalid for status");
  }
  const { policy, snapshot, receipts } = bindings;
  if (plainObject(policy)
    && (manifest.programId !== policy.programId
      || manifest.parentEvidenceBundleDigest !== policy.parentEvidence?.bundleDigest
      || manifest.policy?.digest !== policy.digest)) {
    errors.push("manifest policy/parent binding is stale");
  }
  if (plainObject(snapshot) && manifest.snapshot?.digest !== snapshot.digest) {
    errors.push("manifest snapshot binding is stale");
  }
  if (Array.isArray(receipts)) {
    compareReceiptReferences(manifest.reviewReceipts, receipts,
      "manifest receipt", errors);
  }
  validateCanonicalDigest(manifest, "continuation closure manifest", errors);
  return unique(errors);
}

export function toPendingContinuationManifestV3(manifest) {
  const pending = {
    ...manifest,
    status: "review_passed_pending_external_anchor",
    externalAttestation: {
      ...manifest.externalAttestation,
      canonicalDigest: null,
    },
  };
  delete pending.digest;
  return { ...pending, digest: hashCanonicalV3(pending) };
}

export function validateContinuationExternalAttestationV3(
  attestation,
  bindings = {},
) {
  const errors = [];
  if (!plainObject(attestation) || !exactKeys(attestation, ATTESTATION_KEYS)) {
    return ["continuation external attestation must contain the exact v3 keys"];
  }
  if (attestation.schemaVersion !== 3
    || attestation.kind !== CONTINUATION_V3_ATTESTATION_KIND
    || attestation.status !== "passed"
    || attestation.trustLevel !== "external-anchor-consistency"
    || attestation.subjectIdentityAssurance !== "not-signed"
    || attestation.governancePhase !== "review_post_transition"
    || !path.isAbsolute(attestation.repositoryRealpath)) {
    errors.push("continuation external attestation v3 identity is invalid");
  }
  for (const key of [
    "parentEvidenceBundleDigest",
    "pendingManifestDigest",
    "policyDigest",
    "snapshotDigest",
    "validatorDigest",
    "runnerDigest",
  ]) {
    if (!sha256DigestV3(attestation[key])) {
      errors.push(`continuation external attestation ${key} is invalid`);
    }
  }
  const completedAt = validateTimestamp(attestation.completedAt,
    bindings.verifierNow, "continuation external attestation completedAt", errors);
  validateReceiptBindings(attestation.reviewReceiptBindings,
    "attestation receipt binding", errors);
  validateCandidateResults(attestation.candidateResults, errors);
  const { manifest, policy, snapshot, receipts } = bindings;
  if (plainObject(policy)
    && (attestation.policyDigest !== policy.digest
      || attestation.parentEvidenceBundleDigest !== policy.parentEvidence?.bundleDigest)) {
    errors.push("attestation policy/parent binding is stale");
  }
  if (plainObject(snapshot) && attestation.snapshotDigest !== snapshot.digest) {
    errors.push("attestation snapshot binding is stale");
  }
  if (plainObject(manifest)) {
    const pending = toPendingContinuationManifestV3(manifest);
    if (attestation.pendingManifestDigest !== pending.digest
      || manifest.externalAttestation?.canonicalDigest !== attestation.digest) {
      errors.push("attestation manifest binding is stale");
    }
  }
  if (Array.isArray(receipts)) {
    compareReceiptBindings(attestation.reviewReceiptBindings, receipts,
      "attestation receipt", errors);
    for (const receipt of receipts) {
      const receiptAt = parseIso(receipt.completedAt);
      if (completedAt !== null && receiptAt !== null && completedAt < receiptAt) {
        errors.push(`attestation predates receipt lane ${receipt.lane}`);
      }
    }
  }
  validateCanonicalDigest(attestation, "continuation external attestation", errors);
  return unique(errors);
}

export function validateContinuationExternalAnchorV3(anchor, bindings = {}) {
  const errors = [];
  if (!plainObject(anchor) || !exactKeys(anchor, ANCHOR_KEYS)) {
    return ["continuation external anchor must contain the exact v3 keys"];
  }
  if (anchor.schemaVersion !== 3
    || anchor.kind !== CONTINUATION_V3_ANCHOR_KIND
    || anchor.trustLevel !== "external-caller-pinned-consistency"
    || anchor.subjectIdentityAssurance !== "not-signed"
    || !path.isAbsolute(anchor.repositoryRealpath)) {
    errors.push("continuation external anchor v3 identity is invalid");
  }
  for (const key of [
    "attestationDigest",
    "parentEvidenceBundleDigest",
    "policyDigest",
    "snapshotDigest",
    "validatorDigest",
    "runnerDigest",
  ]) {
    if (!sha256DigestV3(anchor[key])) {
      errors.push(`continuation external anchor ${key} is invalid`);
    }
  }
  validateTimestamp(anchor.completedAt, bindings.verifierNow,
    "continuation external anchor completedAt", errors);
  validateReceiptBindings(anchor.reviewReceiptBindings,
    "anchor receipt binding", errors);
  if (!plainObject(anchor.head) || !exactKeys(anchor.head, ANCHOR_HEAD_KEYS)
    || anchor.head.kind !== "successor-admission"
    || anchor.head.status !== "externally_attested"
    || anchor.head.workstreamId !== CONTINUATION_V3_WORKSTREAM_ID
    || anchor.head.featureId !== CONTINUATION_V3_FEATURE_ID
    || anchor.head.snapshotDigest !== anchor.snapshotDigest
    || !sha256DigestV3(anchor.head.successorWorkstreamDefinitionDigest)
    || !sha256DigestV3(anchor.head.successorFeatureDefinitionDigest)) {
    errors.push("continuation external anchor head is invalid");
  }
  const { attestation, policy, snapshot, receipts } = bindings;
  if (plainObject(policy)
    && (anchor.policyDigest !== policy.digest
      || anchor.parentEvidenceBundleDigest !== policy.parentEvidence?.bundleDigest
      || anchor.head?.successorFeatureDefinitionDigest
        !== policy.successor?.featureDefinitionDigest
      || anchor.head?.successorWorkstreamDefinitionDigest
        !== policy.successor?.workstreamDefinitionDigest)) {
    errors.push("anchor policy/parent/successor binding is stale");
  }
  if (plainObject(snapshot) && anchor.snapshotDigest !== snapshot.digest) {
    errors.push("anchor snapshot binding is stale");
  }
  if (plainObject(attestation)
    && (anchor.attestationDigest !== attestation.digest
      || anchor.completedAt !== attestation.completedAt
      || anchor.repositoryRealpath !== attestation.repositoryRealpath
      || anchor.runnerDigest !== attestation.runnerDigest
      || anchor.validatorDigest !== attestation.validatorDigest)) {
    errors.push("anchor attestation binding is stale");
  }
  if (Array.isArray(receipts)) {
    compareReceiptBindings(anchor.reviewReceiptBindings, receipts,
      "anchor receipt", errors);
  }
  validateCanonicalDigest(anchor, "continuation external anchor", errors);
  if (bindings.expectedDigest === undefined
    || anchor.digest !== bindings.expectedDigest) {
    errors.push("continuation external anchor digest does not match the caller pin");
  }
  return unique(errors);
}

export function validateGovernanceTransitionStateV3(
  transitions,
  phase,
  liveDigests,
  stagedDigests,
) {
  return validateGovernanceTransitionStateV2(
    transitions,
    phase,
    liveDigests,
    stagedDigests,
  );
}

export function validateLifecycleStateV3(live, policy) {
  return validateLifecycleStateV2(live, policy);
}

export function selectLifecycleProfileV3(policy, phase) {
  if (!CONTINUATION_V3_LIFECYCLE_PHASES.includes(phase)) return undefined;
  const matches = (policy?.closedWorld?.lifecycleProfiles ?? [])
    .filter((entry) => entry?.phase === phase);
  return matches.length === 1 ? matches[0] : undefined;
}

export function serializeRound2PrefreezeRejectionV3(witness) {
  const errors = validateRound2PrefreezeRejectionV3(witness);
  if (errors.length > 0) throw new TypeError(errors.join("; "));
  return Buffer.from(`${JSON.stringify(witness, null, 2)}\n`, "utf8");
}

function validateSnapshotAdmissionSubjects(snapshot, policy, errors) {
  const byClass = new Map(CONTINUATION_V3_ADMISSION_CLASSES.map((value) => [value, []]));
  for (const entry of policy.admissionCoverage ?? []) byClass.get(entry.class)?.push(entry.path);
  const frozen = new Map((snapshot.frozenFiles ?? []).map((entry) => [entry.path, entry.sha256]));
  const payload = new Map((snapshot.transitionPayloadFiles ?? [])
    .map((entry) => [entry.path, entry.sha256]));
  if (!sameStringSet([...frozen.keys()], byClass.get("frozen_file") ?? [])) {
    errors.push("snapshot frozenFiles differ from explicit frozen_file admission coverage");
  }
  if (!sameStringSet([...payload.keys()], byClass.get("transition_payload") ?? [])) {
    errors.push(
      "snapshot transitionPayloadFiles differ from explicit transition_payload coverage",
    );
  }
  const expectedPayload = new Map((policy.governanceTransitions ?? [])
    .map((entry) => [entry.stagedTargetPath, entry.toSha256]));
  if (!sameMap(payload, expectedPayload)) {
    errors.push("snapshot transition payload bytes differ from governance targets");
  }
  const reviewOutputs = snapshot.reviewOutputAbsentPaths ?? [];
  if (!sameStringSet(reviewOutputs, byClass.get("review_output_absent") ?? [])) {
    errors.push("snapshot review outputs differ from explicit admission coverage");
  }
  const absent = new Set(snapshot.absentPaths ?? []);
  if (!(byClass.get("rejected_output_absent") ?? [])
    .every((relativePath) => absent.has(relativePath))) {
    errors.push("snapshot does not preserve explicit rejected_output_absent coverage");
  }
  for (const transition of policy.governanceTransitions ?? []) {
    if (frozen.has(transition.stagedTargetPath)) {
      errors.push(`transition payload must not also be frozen_file: ${transition.stagedTargetPath}`);
    }
  }
  for (const reference of [
    policy.round1Rejection?.policy,
    policy.round1Rejection?.snapshot,
    ...(policy.round1Rejection?.receipts ?? []),
  ]) {
    if (reference?.path && frozen.get(reference.path) !== reference.byteSha256) {
      errors.push(`snapshot does not freeze Round1 rejection evidence: ${reference.path}`);
    }
  }
  const witnessDigest = sha256BytesV3(
    serializeRound2PrefreezeRejectionV3(policy.round2PrefreezeRejection),
  );
  if (frozen.get(CONTINUATION_V3_ROUND2_PREFREEZE_REJECTION_PATH)
    !== witnessDigest) {
    errors.push("snapshot does not freeze the exact Round2 pre-freeze witness bytes");
  }
}

function validateSnapshotAuthoritySubjects(snapshot, policy, errors) {
  const baseline = new Map((snapshot.baselineFiles ?? [])
    .map((entry) => [entry.path, entry.sha256]));
  const absent = new Set(snapshot.absentPaths ?? []);
  const expectedBaseline = new Map();
  const expectedAbsent = new Set();
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
  for (const relativePath of policy.round1Rejection?.forbiddenRepositoryOutputs ?? []) {
    expectedAbsent.add(relativePath);
  }
  for (const relativePath of policy.round2PrefreezeRejection?.verifiedAbsentPaths ?? []) {
    expectedAbsent.add(relativePath);
  }
  if (!sameMap(baseline, expectedBaseline)) {
    errors.push("snapshot baselineFiles do not exactly bind v3 baselines");
  }
  if (!sameStringSet([...absent], [...expectedAbsent])) {
    errors.push("snapshot absentPaths do not exactly bind create/bookkeeping/rejection absence");
  }
}

function validateTrustRootsAndExecutables(policy, errors) {
  const trust = new Map();
  const trustPaths = [];
  for (const [index, entry] of (policy.trustRoots ?? []).entries()) {
    if (!plainObject(entry) || !exactKeys(entry, FILE_DIGEST_KEYS)
      || !repositoryPathV3(entry.path) || !sha256DigestV3(entry.sha256)) {
      errors.push(`trustRoots[${index}] is invalid`);
      continue;
    }
    trust.set(entry.path, entry.sha256);
    trustPaths.push(entry.path);
  }
  validateSortedUnique(trustPaths, "trustRoot paths", errors);
  const executables = policy.continuationExecutables;
  if (!Array.isArray(executables)
    || executables.length !== CONTINUATION_V3_EXECUTABLE_KINDS.length) {
    errors.push("continuationExecutables must contain exact v3 kinds");
    return;
  }
  const kinds = [];
  for (const [index, entry] of executables.entries()) {
    if (!plainObject(entry) || !exactKeys(entry, EXECUTABLE_KEYS)
      || entry.kind !== CONTINUATION_V3_EXECUTABLE_KINDS[index]
      || entry.path !== CONTINUATION_V3_EXECUTABLE_PATH_BY_KIND[entry.kind]
      || !sha256DigestV3(entry.sha256)
      || trust.get(entry.path) !== entry.sha256) {
      errors.push(`continuationExecutables[${index}] is invalid or not a trust root`);
    }
    kinds.push(entry?.kind);
  }
  if (canonicalJsonV3(kinds) !== canonicalJsonV3(CONTINUATION_V3_EXECUTABLE_KINDS)) {
    errors.push("continuation executable kinds must be exact and ordered");
  }
  for (const transition of policy.governanceTransitions ?? []) {
    if (trust.get(transition.path) !== transition.toSha256) {
      errors.push(`governance target is not the exact trust root: ${transition.path}`);
    }
  }
}

function validateSuccessorCoverage(policy, errors) {
  const transitionPaths = new Set((policy.governanceTransitions ?? [])
    .map((entry) => entry.path));
  const coverage = [];
  for (const entry of policy.pathAuthorities ?? []) {
    coverage.push({ path: entry.path, class: entry.class });
  }
  for (const entry of policy.trustRoots ?? []) {
    if (!transitionPaths.has(entry.path)) {
      coverage.push({ path: entry.path, class: "trust_root" });
    }
  }
  for (const entry of policy.governanceTransitions ?? []) {
    coverage.push({ path: entry.path, class: "governance_transition" });
  }
  const successorFiles = policy.successor?.featureDefinition?.files ?? [];
  const actual = coverage.filter((entry) => successorFiles.includes(entry.path))
    .sort(comparePath);
  if (actual.length !== successorFiles.length
    || new Set(actual.map((entry) => entry.path)).size !== actual.length
    || !sameStringSet(actual.map((entry) => entry.path), successorFiles)) {
    errors.push("P108 Feature paths are not covered exactly once");
  }
  if (policy.successor?.pathCoverageDigest !== safeHash(actual)) {
    errors.push("successor pathCoverageDigest is invalid or stale");
  }
}

function bindLiveFeature(feature, definition, subject, errors) {
  try {
    const stable = stableFeatureDefinitionV3(feature);
    if (canonicalJsonV3(stable) !== canonicalJsonV3(definition.featureDefinition)
      || hashCanonicalV3(stable) !== definition.featureDefinitionDigest
      || hashCanonicalV3(stable.files) !== definition.featureFileSetDigest) {
      errors.push(`${subject} definition/file-set differs from the frozen admission`);
    }
  } catch (error) {
    errors.push(`${subject} is invalid: ${error.message}`);
  }
}

function bindLiveWorkstream(workstream, definition, digest, subject, errors) {
  try {
    const stable = stableWorkstreamDefinitionV3(workstream);
    if (canonicalJsonV3(stable) !== canonicalJsonV3(definition)
      || hashCanonicalV3(stable) !== digest) {
      errors.push(`${subject} definition differs from the frozen admission`);
    }
  } catch (error) {
    errors.push(`${subject} is invalid: ${error.message}`);
  }
}

function validateBaselineArchiveReference(reference, subject, errors) {
  if (!plainObject(reference)
    || !exactKeys(reference, ["digest", "entrySetDigest", "path"])
    || reference.path !== CONTINUATION_V3_BASELINE_ARCHIVE_PATH
    || !sha256DigestV3(reference.digest)
    || !sha256DigestV3(reference.entrySetDigest)) {
    errors.push(`${subject} is invalid`);
  }
}

function validateFileDigestArray(entries, subject, errors) {
  if (!Array.isArray(entries) || entries.length === 0) {
    errors.push(`${subject} must be non-empty`);
    return;
  }
  const paths = [];
  for (const [index, entry] of entries.entries()) {
    if (!plainObject(entry) || !exactKeys(entry, FILE_DIGEST_KEYS)
      || !repositoryPathV3(entry.path) || !sha256DigestV3(entry.sha256)) {
      errors.push(`${subject}[${index}] is invalid`);
      continue;
    }
    paths.push(entry.path);
  }
  validateSortedUnique(paths, `${subject} paths`, errors);
}

function validateStringPaths(entries, subject, errors) {
  if (!Array.isArray(entries)) {
    errors.push(`${subject} must be an array`);
    return;
  }
  if (entries.some((entry) => !repositoryPathV3(entry))) {
    errors.push(`${subject} contains an invalid path`);
  }
  validateSortedUnique(entries, subject, errors);
}

function validateFindings(receipt, errors) {
  if (!plainObject(receipt.findingCounts)
    || !exactKeys(receipt.findingCounts, ["critical", "major", "minor"])
    || Object.values(receipt.findingCounts).some(
      (value) => !Number.isInteger(value) || value < 0)) {
    errors.push("continuation review findingCounts is invalid");
  }
  if (!Array.isArray(receipt.findings)) {
    errors.push("continuation review findings must be an array");
    return;
  }
  const counts = { critical: 0, major: 0, minor: 0 };
  const ids = [];
  for (const [index, finding] of receipt.findings.entries()) {
    if (!plainObject(finding) || !exactKeys(finding, FINDING_KEYS)
      || !nonEmpty(finding.id) || !Object.hasOwn(counts, finding.severity)
      || !nonEmpty(finding.summary) || !stringArray(finding.evidence, true)) {
      errors.push(`continuation review finding[${index}] is invalid`);
      continue;
    }
    ids.push(finding.id);
    counts[finding.severity] += 1;
  }
  if (new Set(ids).size !== ids.length) {
    errors.push("continuation review finding ids must be unique");
  }
  for (const severity of Object.keys(counts)) {
    if (receipt.findingCounts?.[severity] !== counts[severity]) {
      errors.push(`continuation review ${severity} count is stale`);
    }
  }
}

function validateLaneArray(entries, keys, subject, errors, predicate) {
  if (!Array.isArray(entries)
    || entries.length !== CONTINUATION_V3_REVIEW_LANES.length) {
    errors.push(`${subject} must contain exactly three lanes`);
    return;
  }
  const lanes = [];
  for (const [index, entry] of entries.entries()) {
    if (!plainObject(entry) || !exactKeys(entry, keys)
      || !CONTINUATION_V3_REVIEW_LANES.includes(entry.lane)
      || !predicate(entry)) {
      errors.push(`${subject}[${index}] is invalid`);
      continue;
    }
    lanes.push(entry.lane);
  }
  if (canonicalJsonV3(lanes) !== canonicalJsonV3(CONTINUATION_V3_REVIEW_LANES)) {
    errors.push(`${subject} lanes must be exact and ordered`);
  }
}

function validatePathDigest(reference, subject, errors) {
  if (!plainObject(reference) || !exactKeys(reference, ["digest", "path"])
    || !repositoryPathV3(reference.path) || !sha256DigestV3(reference.digest)) {
    errors.push(`${subject} reference is invalid`);
  }
}

function validatePathSha(reference, subject, errors) {
  if (!plainObject(reference) || !exactKeys(reference, ["path", "sha256"])
    || !repositoryPathV3(reference.path) || !sha256DigestV3(reference.sha256)) {
    errors.push(`${subject} reference is invalid`);
  }
}

function validateReceiptBindings(entries, subject, errors) {
  validateLaneArray(entries, RECEIPT_BINDING_KEYS, subject, errors,
    (entry) => sha256DigestV3(entry.canonicalDigest)
      && sha256DigestV3(entry.challenge));
  if (Array.isArray(entries)
    && new Set(entries.map((entry) => entry.challenge)).size !== entries.length) {
    errors.push(`${subject} challenges must be unique`);
  }
}

function validateCandidateResults(entries, errors) {
  if (!Array.isArray(entries) || entries.length !== 2) {
    errors.push("attestation candidateResults must contain checker and harness");
    return;
  }
  const kinds = [];
  for (const [index, entry] of entries.entries()) {
    if (!plainObject(entry) || !exactKeys(entry, CANDIDATE_RESULT_KEYS)
      || !["checker", "harness"].includes(entry.kind)
      || !repositoryPathV3(entry.path) || entry.status !== "passed"
      || !sha256DigestV3(entry.receiptDigest)
      || !sha256DigestV3(entry.stdoutDigest)
      || !sha256DigestV3(entry.stderrDigest)) {
      errors.push(`attestation candidateResults[${index}] is invalid`);
      continue;
    }
    kinds.push(entry.kind);
  }
  if (canonicalJsonV3(kinds) !== canonicalJsonV3(["checker", "harness"])) {
    errors.push("attestation candidate result kinds must be exact and ordered");
  }
}

function compareReceiptReferences(references, receipts, subject, errors) {
  const expected = new Map(receipts.map((receipt) => [receipt.lane, {
    canonicalDigest: safeHash(receipt),
    challenge: receipt.challenge,
  }]));
  for (const reference of references ?? []) {
    const match = expected.get(reference.lane);
    if (reference.canonicalDigest !== match?.canonicalDigest
      || reference.challenge !== match?.challenge) {
      errors.push(`${subject} binding is stale: ${reference.lane}`);
    }
  }
}

function compareReceiptBindings(bindings, receipts, subject, errors) {
  compareReceiptReferences(bindings, receipts, subject, errors);
}

function validateTimestamp(value, verifierNow, subject, errors) {
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

function parseIso(value) {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
    ? parsed
    : null;
}

function validateCanonicalDigest(value, subject, errors) {
  if (!sha256DigestV3(value?.digest)
    || value.digest !== hashWithoutKey(value, "digest")) {
    errors.push(`${subject} digest is invalid or stale`);
  }
}

function hashWithoutKey(value, key) {
  if (!plainObject(value)) return undefined;
  const projected = { ...value };
  delete projected[key];
  return hashCanonicalV3(projected);
}

function safeHash(value) {
  try {
    return hashCanonicalV3(value);
  } catch {
    return undefined;
  }
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype
      || Object.getPrototypeOf(value) === null);
}

function exactKeys(value, keys) {
  return plainObject(value)
    && canonicalJsonV3(Object.keys(value).sort())
      === canonicalJsonV3([...keys].sort());
}

function nonEmpty(value) {
  return typeof value === "string" && value.length > 0;
}

function stringArray(value, allowEmpty = false) {
  return Array.isArray(value) && (allowEmpty || value.length > 0)
    && value.every(nonEmpty);
}

function comparePath(left, right) {
  return left.path.localeCompare(right.path);
}

function validateSortedUnique(values, subject, errors) {
  if (!Array.isArray(values)
    || values.some((entry) => typeof entry !== "string")
    || new Set(values).size !== values.length
    || values.some((entry, index) => index > 0 && values[index - 1] >= entry)) {
    errors.push(`${subject} must be sorted and unique`);
  }
}

function sameStringSet(left, right) {
  return canonicalJsonV3([...new Set(left)].sort())
    === canonicalJsonV3([...new Set(right)].sort());
}

function sameMap(left, right) {
  const project = (value) => [...value.entries()].sort(([a], [b]) => a.localeCompare(b));
  return canonicalJsonV3(project(left)) === canonicalJsonV3(project(right));
}

function unique(errors) {
  return [...new Set(errors)];
}

// Compatibility aliases keep v3 freezer/checker/runner imports explicit.
export const canonicalJson = canonicalJsonV3;
export const hashCanonical = hashCanonicalV3;
export const sha256Bytes = sha256BytesV3;
export const validateReviewSnapshotV3 = validateContinuationReviewSnapshotV3;
export const validateReviewSnapshot = validateContinuationReviewSnapshotV3;
export const validateBaselineArchive = validateBaselineArchiveV3;
export const validateReviewReceiptV3 = validateContinuationReviewReceiptV3;
export const validateReviewSetV3 = validateContinuationReviewSetV3;
export const validateClosureManifestV3 = validateContinuationClosureManifestV3;
export const validateExternalAttestationV3 =
  validateContinuationExternalAttestationV3;
export const validateExternalAnchorV3 = validateContinuationExternalAnchorV3;

// Kept local to make accidental algorithm replacement visible to review tooling.
export function sha256RawHexV3(value) {
  return createHash("sha256").update(value).digest("hex");
}
