import { createHash } from "node:crypto";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

export const CONTINUATION_V2_ALGORITHM = "sha256-canonical-json-v1";
export const CONTINUATION_V2_POLICY_KIND =
  "conversation-disclosure-continuation-policy";
export const CONTINUATION_V2_SNAPSHOT_KIND =
  "conversation-disclosure-continuation-review-snapshot";
export const CONTINUATION_V2_RECEIPT_KIND =
  "conversation-disclosure-continuation-review-receipt";
export const CONTINUATION_V2_MANIFEST_KIND =
  "conversation-disclosure-continuation-closure-manifest";
export const CONTINUATION_V2_ATTESTATION_KIND =
  "conversation-disclosure-continuation-external-attestation";
export const CONTINUATION_V2_ANCHOR_KIND =
  "conversation-disclosure-continuation-external-anchor";
export const CONTINUATION_V2_POLICY_ID =
  "CD03A-round2-P108-admission-v2";
export const CONTINUATION_V2_WORKSTREAM_ID = "CD03A";
export const CONTINUATION_V2_FEATURE_ID =
  "P107A-conversation-disclosure-successor-admission";
export const CONTINUATION_V2_SUCCESSOR_WORKSTREAM_ID = "CD04";
export const CONTINUATION_V2_SUCCESSOR_FEATURE_ID =
  "P108-conversation-disclosure-evidence-foundation";
export const CONTINUATION_V2_ROUND = 2;
export const CONTINUATION_V2_REVIEW_SNAPSHOT_PATH =
  ".zerox/verification/conversation-disclosure/CD03A-round2-review-snapshot.json";
export const CONTINUATION_V2_POLICY_PATH =
  ".zerox/verification/conversation-disclosure/CD03A-round2-successor-evolution-policy.json";
export const CONTINUATION_V2_BASELINE_ARCHIVE_PATH =
  ".zerox/verification/conversation-disclosure/CD03A-round2-baseline-archive.json";
export const CONTINUATION_V2_CLOSURE_MANIFEST_PATH =
  ".zerox/verification/conversation-disclosure/CD03A-round2-closure-manifest.json";
export const CONTINUATION_V2_EXTERNAL_ATTESTATION_PATH =
  ".zerox/verification/conversation-disclosure/CD03A-round2-external-attestation.json";
export const CONTINUATION_V2_BASELINE_ARCHIVE_KIND =
  "conversation-disclosure-continuation-baseline-archive";
export const CONTINUATION_V2_ROUND1_POLICY_PATH =
  ".zerox/verification/conversation-disclosure/CD03A-successor-evolution-policy.json";
export const CONTINUATION_V2_ROUND1_SNAPSHOT_PATH =
  ".zerox/verification/conversation-disclosure/CD03A-round1-review-snapshot.json";
export const CONTINUATION_V2_ROUND1_FORBIDDEN_OUTPUT_PATHS = Object.freeze([
  ".zerox/verification/conversation-disclosure/CD03A-round1-closure-manifest.json",
  ".zerox/verification/conversation-disclosure/CD03A-round1-external-anchor.json",
  ".zerox/verification/conversation-disclosure/CD03A-round1-external-attestation.json",
]);
export const CONTINUATION_V2_ROUND1_REJECTION_TRUST_ROOT = Object.freeze({
  policy: Object.freeze({
    byteSha256: "sha256:e1701afcd0f8cf0e43924e6d307520e78eb7ce0e995e19f2ed7a795794fd11cf",
    canonicalDigest: "sha256:e8493e3ad8cb5ce250d6bb7e9d0c9c8cc58fba460bb0f940a25f546a1d18f050",
  }),
  snapshot: Object.freeze({
    byteSha256: "sha256:9bf3ae4a69caf816481af725fbf1230769a5247d14112a9991a42a01be779002",
    digest: "sha256:e8f82a943cae4e6c06732936986229a2e85f7783e6b283cf0b6b431b4f1ff7e5",
    fileCount: 19,
  }),
  receipts: Object.freeze({
    contract: Object.freeze({
      byteSha256: "sha256:702d8c1ae706f3f48253926a268d3f67e7df0c9665f24914ca87d21e601ecf1e",
      canonicalDigest: "sha256:5062cd1e4482ab2fffedc56d667fc23aaa56a9ef75ea1226fcb1d8d2dc44de25",
      findingCounts: Object.freeze({ critical: 1, major: 4, minor: 0 }),
    }),
    runtime: Object.freeze({
      byteSha256: "sha256:a8f35271528760a90a856c4be6c7491b3cf9b5cccceb583263d855e4f878b847",
      canonicalDigest: "sha256:d5a05396d2c27dc1c9d1d67ddbe9cbd141906cca0f4e9826b8eebb3e8ac4cf87",
      findingCounts: Object.freeze({ critical: 2, major: 5, minor: 0 }),
    }),
    governance: Object.freeze({
      byteSha256: "sha256:c9265b41cdf58101b0683608cfa4d7765d3a3c55f3a7ece0ccf9eccd51175e87",
      canonicalDigest: "sha256:39ad365204a7e2334ad3d030bcf99445404456a1fd8fbf76c68b11d49968a104",
      findingCounts: Object.freeze({ critical: 3, major: 9, minor: 0 }),
    }),
  }),
});

export const CONTINUATION_V2_REVIEW_LANES = Object.freeze([
  "contract",
  "runtime",
  "governance",
]);

export const CONTINUATION_V2_LIFECYCLE_PHASES = Object.freeze([
  "review_pre_transition",
  "review_post_transition",
  "anchored_planned",
  "authorized_active",
]);

export const CONTINUATION_V2_EXECUTABLE_KINDS = Object.freeze([
  "checker",
  "contract",
  "freezer",
  "governance",
  "runner",
]);

export const CONTINUATION_V2_EXTERNAL_EVIDENCE_ROLES = Object.freeze([
  "base_anchor",
  "base_anchor_publication_marker",
  "external_runner_copy",
]);

export const CONTINUATION_V2_REQUIRED_PARENT_REPOSITORY_PATHS = Object.freeze([
  ".zerox/verification/conversation-disclosure/CD03-causal-shadow.json",
  ".zerox/verification/conversation-disclosure/CD03-round23-closure-manifest.json",
  ".zerox/verification/conversation-disclosure/CD03-round23-contract-review.json",
  ".zerox/verification/conversation-disclosure/CD03-round23-external-attestation.json",
  ".zerox/verification/conversation-disclosure/CD03-round23-governance-review.json",
  ".zerox/verification/conversation-disclosure/CD03-round23-review-snapshot.json",
  ".zerox/verification/conversation-disclosure/CD03-round23-runtime-review.json",
  "scripts/check-conversation-disclosure-program.mjs",
  "scripts/check-harness-state.mjs",
  "scripts/conversation-disclosure-review-contract.mjs",
  "scripts/freeze-conversation-disclosure-review.mjs",
  "scripts/verify-conversation-disclosure-closure.mjs",
]);

export const CONTINUATION_V2_GOVERNANCE_TRANSITIONS = Object.freeze({
  "package.json": "package-structure-migration",
  "scripts/check-harness-state.mjs": "harness-delegation-migration",
  "src/shared/conversationDisclosureProgram.test.ts": "program-test-migration",
  "src/shared/packageScripts.test.ts": "package-test-migration",
});

export const CONTINUATION_V2_BOOKKEEPING_VALIDATORS = Object.freeze({
  ".zerox/conversation-disclosure-program.json":
    "conversation_program_projection_v2",
  ".zerox/feature_list.json": "feature_list_projection_v2",
  ".zerox/progress.md": "non_authoritative_progress_document_v1",
  ".zerox/verification/conversation-disclosure/CD04-performance-baseline.json":
    "cd04_evidence_schema_v1",
  ".zerox/verification/conversation-disclosure/CD04-shadow-parity.json":
    "cd04_evidence_schema_v1",
  ".zerox/reviews/CD04-shadow-parity-review.md":
    "non_authoritative_progress_document_v1",
  "findings.md": "non_authoritative_progress_document_v1",
  "progress.md": "non_authoritative_progress_document_v1",
  "task_plan.md": "non_authoritative_progress_document_v1",
});

const POLICY_KEYS = Object.freeze([
  "admission",
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
  "schemaVersion",
  "status",
  "successor",
  "timePolicy",
  "trustRoots",
  "workstreamId",
]);
const PARENT_EVIDENCE_KEYS = Object.freeze([
  "artifact",
  "bundleDigest",
  "closureManifest",
  "externalAnchor",
  "externalAttestation",
  "externalEvidence",
  "externalRunner",
  "featureId",
  "receipts",
  "repositoryEvidence",
  "round",
  "schemaVersion",
  "snapshot",
  "validator",
  "workstreamId",
]);
const ARTIFACT_REFERENCE_KEYS = Object.freeze(["byteSha256", "path"]);
const PARENT_SNAPSHOT_KEYS = Object.freeze(["digest", "fileCount", "path"]);
const PARENT_RECEIPT_KEYS = Object.freeze([
  "canonicalDigest",
  "challenge",
  "lane",
  "path",
]);
const PARENT_MANIFEST_KEYS = Object.freeze([
  "canonicalDigest",
  "path",
  "status",
]);
const CANONICAL_REFERENCE_KEYS = Object.freeze(["canonicalDigest", "path"]);
const DIGEST_REFERENCE_KEYS = Object.freeze(["digest"]);
const EXECUTABLE_REFERENCE_KEYS = Object.freeze(["path", "sha256"]);
const REPOSITORY_EVIDENCE_KEYS = Object.freeze(["path", "sha256"]);
const EXTERNAL_EVIDENCE_KEYS = Object.freeze(["basename", "role", "sha256"]);
const ROUND1_REJECTION_KEYS = Object.freeze([
  "digest",
  "forbiddenRepositoryOutputs",
  "policy",
  "receipts",
  "round",
  "snapshot",
  "status",
]);
const ROUND1_POLICY_REFERENCE_KEYS = Object.freeze([
  "byteSha256",
  "canonicalDigest",
  "path",
]);
const ROUND1_SNAPSHOT_REFERENCE_KEYS = Object.freeze([
  "byteSha256",
  "digest",
  "fileCount",
  "path",
]);
const ROUND1_RECEIPT_REFERENCE_KEYS = Object.freeze([
  "byteSha256",
  "canonicalDigest",
  "findingCounts",
  "lane",
  "path",
  "verdict",
]);

const CLOSED_WORLD_KEYS = Object.freeze([
  "digest",
  "historicalFeatures",
  "lifecycleProfiles",
  "maxUnfinishedFeatures",
  "programRootDefinition",
  "programRootDefinitionDigest",
  "workstreams",
]);
const CLOSED_WORKSTREAM_KEYS = Object.freeze([
  "id",
  "stableDefinition",
  "stableDefinitionDigest",
]);
const HISTORICAL_FEATURE_KEYS = Object.freeze([
  "id",
  "requiredStatus",
  "stableDefinition",
  "stableDefinitionDigest",
]);
const LIFECYCLE_PROFILE_KEYS = Object.freeze([
  "activeFeatureId",
  "featureStates",
  "nextFeatureId",
  "phase",
  "workstreamStates",
]);
const WORKSTREAM_STATE_KEYS = Object.freeze(["id", "state"]);
const FEATURE_STATE_KEYS = Object.freeze(["id", "presence", "status"]);

const ADMISSION_KEYS = Object.freeze([
  "featureDefinition",
  "featureDefinitionDigest",
  "featureFileSetDigest",
  "postReviewMutablePaths",
  "reviewCoverageDigest",
  "reviewOutputPaths",
  "workstreamDefinition",
  "workstreamDefinitionDigest",
]);
const SUCCESSOR_KEYS = Object.freeze([
  "featureDefinition",
  "featureDefinitionDigest",
  "pathCoverageDigest",
  "workstreamDefinition",
  "workstreamDefinitionDigest",
]);
const FEATURE_STABLE_KEYS = Object.freeze([
  "definitionOfDone",
  "files",
  "id",
  "priority",
  "title",
  "verification",
]);
const FEATURE_LIVE_KEYS = Object.freeze([...FEATURE_STABLE_KEYS, "status"]);
const HISTORICAL_FEATURE_STABLE_KEYS = Object.freeze([
  "definitionOfDone",
  "files",
  "id",
  "priority",
  "title",
  "verification",
]);
const HISTORICAL_FEATURE_REQUIRED_KEYS = Object.freeze([
  "definitionOfDone",
  "id",
]);

const MODIFY_AUTHORITY_KEYS = Object.freeze(["baseline", "class", "path"]);
const MODIFY_BASELINE_KEYS = Object.freeze(["sha256", "source"]);
const CREATE_AUTHORITY_KEYS = MODIFY_AUTHORITY_KEYS;
const CREATE_BASELINE_KEYS = MODIFY_BASELINE_KEYS;
const BOOKKEEPING_AUTHORITY_KEYS = Object.freeze([
  "allowedPhases",
  "baseline",
  "class",
  "path",
  "validator",
]);
const BOOKKEEPING_BASELINE_KEYS = Object.freeze([
  "presence",
  "sha256",
  "source",
]);
const TRUST_ROOT_KEYS = Object.freeze(["path", "sha256"]);
const GOVERNANCE_TRANSITION_KEYS = Object.freeze([
  "fromSha256",
  "kind",
  "path",
  "stagedTargetPath",
  "toSha256",
]);
const CONTINUATION_EXECUTABLE_KEYS = Object.freeze([
  "kind",
  "path",
  "sha256",
]);
const REVIEW_SNAPSHOT_REFERENCE_KEYS = Object.freeze(["path"]);
const TIME_POLICY_KEYS = Object.freeze(["futureToleranceMs"]);
const BASELINE_ARCHIVE_REFERENCE_KEYS = Object.freeze([
  "digest",
  "entrySetDigest",
  "path",
]);
const BASELINE_ARCHIVE_KEYS = Object.freeze([
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
const BASELINE_ARCHIVE_ENTRY_KEYS = Object.freeze([
  "bytes",
  "encoding",
  "path",
  "sha256",
  "source",
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
  "workstreamId",
]);
const FILE_DIGEST_KEYS = Object.freeze(["path", "sha256"]);

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
const FINDING_COUNTS_KEYS = Object.freeze(["critical", "major", "minor"]);
const FINDING_KEYS = Object.freeze(["evidence", "id", "severity", "summary"]);
const CALLER_PIN_KEYS = Object.freeze(["canonicalDigest", "challenge"]);

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
const PATH_DIGEST_KEYS = Object.freeze(["digest", "path"]);
const REVIEW_REFERENCE_KEYS = Object.freeze([
  "canonicalDigest",
  "challenge",
  "lane",
  "path",
]);
const NULLABLE_CANONICAL_REFERENCE_KEYS = CANONICAL_REFERENCE_KEYS;

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

const LIVE_LIFECYCLE_KEYS = Object.freeze([
  "activeFeatureId",
  "features",
  "nextFeatureId",
  "phase",
  "workstreams",
]);

export function canonicalJsonV2(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJsonV2(item)).join(",")}]`;
  }
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) {
        throw new TypeError("Canonical JSON does not support non-finite numbers.");
      }
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "object": {
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError("Canonical JSON accepts plain objects only.");
      }
      const keys = Object.keys(value).sort();
      return `{${keys.map((key) =>
        `${JSON.stringify(key)}:${canonicalJsonV2(value[key])}`
      ).join(",")}}`;
    }
    default:
      throw new TypeError(`Canonical JSON does not support ${typeof value}.`);
  }
}

export function sha256BytesV2(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function hashCanonicalV2(value) {
  return sha256BytesV2(canonicalJsonV2(value));
}

export function withCanonicalDigestV2(value) {
  if (!plainObject(value)) {
    throw new TypeError("Canonical digest input must be a plain object.");
  }
  const withoutDigest = { ...value };
  delete withoutDigest.digest;
  return { ...withoutDigest, digest: hashCanonicalV2(withoutDigest) };
}

export function stableWorkstreamDefinitionV2(workstream) {
  if (!plainObject(workstream) || !Object.hasOwn(workstream, "state")) {
    throw new TypeError("Live workstream must be an object with state.");
  }
  if (!nonEmpty(workstream.id) || !nonEmpty(workstream.featureId)
    || !["planned", "in_progress", "completed"].includes(workstream.state)) {
    throw new TypeError("Live workstream identity/state is invalid.");
  }
  const stable = { ...workstream };
  delete stable.state;
  canonicalJsonV2(stable);
  return stable;
}

export function stableProgramRootDefinitionV2(program) {
  if (!plainObject(program) || !nonEmpty(program.programId)
    || !Object.hasOwn(program, "status")
    || !Object.hasOwn(program, "activeFeatureId")
    || !Object.hasOwn(program, "nextFeatureId")
    || !Array.isArray(program.workstreams)
    || !Array.isArray(program.scenarioMatrix)) {
    throw new TypeError(
      "Live program must contain identity, lifecycle pointers, workstreams, and scenarioMatrix.",
    );
  }
  const stable = { ...program };
  for (const lifecycleKey of [
    "updatedAt",
    "status",
    "activeFeatureId",
    "nextFeatureId",
  ]) {
    delete stable[lifecycleKey];
  }
  stable.workstreams = program.workstreams.map(stableWorkstreamDefinitionV2);
  stable.scenarioMatrix = program.scenarioMatrix.map((scenario) => {
    if (!plainObject(scenario) || !Object.hasOwn(scenario, "acceptanceEvidence")) {
      throw new TypeError(
        "Live program scenarios must be objects with acceptanceEvidence.",
      );
    }
    const projected = { ...scenario };
    delete projected.acceptanceEvidence;
    canonicalJsonV2(projected);
    return projected;
  });
  canonicalJsonV2(stable);
  return stable;
}

export function validateLiveProgramRootV2(program, closedWorld) {
  const errors = [];
  let stable;
  try {
    stable = stableProgramRootDefinitionV2(program);
  } catch (error) {
    return [`live program root is invalid: ${error instanceof Error ? error.message : String(error)}`];
  }
  if (canonicalJsonV2(stable)
      !== safeCanonicalJson(closedWorld?.programRootDefinition)) {
    errors.push("live program stable root differs from the frozen program root");
  }
  if (closedWorld?.programRootDefinitionDigest !== hashCanonicalV2(stable)) {
    errors.push("live program stable root digest differs from the frozen program root");
  }
  return unique(errors);
}

export function stableFeatureDefinitionV2(feature) {
  if (!plainObject(feature) || !exactKeys(feature, FEATURE_LIVE_KEYS)) {
    throw new TypeError("Live Feature must contain the exact v2 keys.");
  }
  if (!["done", "in_progress"].includes(feature.status)) {
    throw new TypeError("Live Feature status is invalid.");
  }
  const stable = { ...feature };
  delete stable.status;
  const errors = validateStableFeatureDefinition(stable, feature.id);
  if (errors.length > 0) throw new TypeError(errors.join("; "));
  return stable;
}

export function stableHistoricalFeatureDefinitionV2(feature) {
  if (!plainObject(feature) || feature.status !== "done") {
    throw new TypeError("Live historical Feature must be a done object.");
  }
  const liveKeys = Object.keys(feature);
  if (!liveKeys.includes("status")
    || liveKeys.some((key) => key !== "status"
      && !HISTORICAL_FEATURE_STABLE_KEYS.includes(key))) {
    throw new TypeError("Live historical Feature contains unknown keys.");
  }
  const stable = { ...feature };
  delete stable.status;
  const errors = validateHistoricalFeatureDefinition(stable, feature.id);
  if (errors.length > 0) throw new TypeError(errors.join("; "));
  return stable;
}

export function validateParentEvidenceBundleV1(bundle, bindings = {}) {
  const errors = [];
  if (!plainObject(bundle) || !exactKeys(bundle, PARENT_EVIDENCE_KEYS)) {
    return ["parent evidence bundle must contain the exact v1 keys"];
  }
  if (bundle.schemaVersion !== 1
    || bundle.workstreamId !== "CD03"
    || bundle.featureId !== "P107-conversation-disclosure-domain-adapters"
    || bundle.round !== 23) {
    errors.push("parent evidence bundle identity is invalid");
  }
  validatePathSha(bundle.artifact, ARTIFACT_REFERENCE_KEYS, "parent artifact", errors,
    "byteSha256");
  if (!plainObject(bundle.snapshot) || !exactKeys(bundle.snapshot, PARENT_SNAPSHOT_KEYS)
    || !repositoryPathV2(bundle.snapshot.path) || !sha256DigestV2(bundle.snapshot.digest)
    || !Number.isInteger(bundle.snapshot.fileCount) || bundle.snapshot.fileCount <= 0) {
    errors.push("parent snapshot reference is invalid");
  }
  validateLaneArray(bundle.receipts, PARENT_RECEIPT_KEYS, "parent receipt", errors,
    (entry) => repositoryPathV2(entry.path)
      && sha256DigestV2(entry.canonicalDigest) && sha256DigestV2(entry.challenge));
  if (Array.isArray(bundle.receipts)
    && new Set(bundle.receipts.map((entry) => entry?.challenge)).size
      !== bundle.receipts.length) {
    errors.push("parent receipt challenges must be unique");
  }
  if (!plainObject(bundle.closureManifest)
    || !exactKeys(bundle.closureManifest, PARENT_MANIFEST_KEYS)
    || !repositoryPathV2(bundle.closureManifest.path)
    || !sha256DigestV2(bundle.closureManifest.canonicalDigest)
    || bundle.closureManifest.status !== "externally_attested") {
    errors.push("parent closure manifest reference is invalid");
  }
  validatePathSha(bundle.externalAttestation, CANONICAL_REFERENCE_KEYS,
    "parent external attestation", errors, "canonicalDigest");
  if (!plainObject(bundle.externalAnchor)
    || !exactKeys(bundle.externalAnchor, DIGEST_REFERENCE_KEYS)
    || !sha256DigestV2(bundle.externalAnchor.digest)) {
    errors.push("parent external anchor reference is invalid");
  }
  validatePathSha(bundle.validator, EXECUTABLE_REFERENCE_KEYS,
    "parent validator", errors, "sha256");
  validatePathSha(bundle.externalRunner, EXECUTABLE_REFERENCE_KEYS,
    "parent external runner", errors, "sha256");
  validateParentRepositoryEvidence(bundle.repositoryEvidence, bundle, bindings, errors);
  validateParentExternalEvidence(bundle.externalEvidence, bundle, bindings, errors);
  if (!sha256DigestV2(bundle.bundleDigest)
    || bundle.bundleDigest !== hashWithoutKey(bundle, "bundleDigest")) {
    errors.push("parent evidence bundle digest is invalid or stale");
  }
  return errors;
}

export function validateClosedWorldContractV2(closedWorld, bindings = {}) {
  const errors = [];
  if (!plainObject(closedWorld) || !exactKeys(closedWorld, CLOSED_WORLD_KEYS)) {
    return ["closedWorld must contain the exact v2 keys"];
  }
  validateClosedWorldDefinitions(closedWorld.workstreams, CLOSED_WORKSTREAM_KEYS,
    "closedWorld workstream", errors, (entry) => {
      if (!nonEmpty(entry.id) || !plainObject(entry.stableDefinition)
        || entry.stableDefinition.id !== entry.id
        || Object.hasOwn(entry.stableDefinition, "state")
        || !sha256DigestV2(entry.stableDefinitionDigest)
        || entry.stableDefinitionDigest !== safeHash(entry.stableDefinition)) {
        return false;
      }
      return true;
    });
  validateClosedWorldDefinitions(closedWorld.historicalFeatures,
    HISTORICAL_FEATURE_KEYS, "closedWorld historical Feature", errors, (entry) => {
      if (!nonEmpty(entry.id) || entry.requiredStatus !== "done"
        || !plainObject(entry.stableDefinition)
        || entry.stableDefinition.id !== entry.id
        || Object.hasOwn(entry.stableDefinition, "status")
        || !sha256DigestV2(entry.stableDefinitionDigest)
        || entry.stableDefinitionDigest !== safeHash(entry.stableDefinition)) {
        return false;
      }
      return validateHistoricalFeatureDefinition(
        entry.stableDefinition,
        entry.id,
      ).length === 0;
    });
  if (!plainObject(closedWorld.programRootDefinition)
    || !nonEmpty(closedWorld.programRootDefinition.programId)
    || !Array.isArray(closedWorld.programRootDefinition.workstreams)
    || !Array.isArray(closedWorld.programRootDefinition.scenarioMatrix)
    || ["updatedAt", "status", "activeFeatureId", "nextFeatureId"].some(
      (key) => Object.hasOwn(closedWorld.programRootDefinition, key),
    )
    || closedWorld.programRootDefinition.workstreams.some(
      (entry) => !plainObject(entry) || Object.hasOwn(entry, "state"),
    )
    || closedWorld.programRootDefinition.scenarioMatrix.some(
      (entry) => !plainObject(entry) || Object.hasOwn(entry, "acceptanceEvidence"),
    )) {
    errors.push("closedWorld programRootDefinition is invalid");
  }
  if (!sha256DigestV2(closedWorld.programRootDefinitionDigest)
    || closedWorld.programRootDefinitionDigest
      !== safeHash(closedWorld.programRootDefinition)) {
    errors.push("closedWorld programRootDefinitionDigest is invalid or stale");
  }
  const stableWorkstreams = Array.isArray(closedWorld.workstreams)
    ? closedWorld.workstreams.map((entry) => entry?.stableDefinition)
    : [];
  if (safeCanonicalJson(closedWorld.programRootDefinition?.workstreams)
      !== safeCanonicalJson(stableWorkstreams)) {
    errors.push("closedWorld program root workstreams differ from stable workstream definitions");
  }
  if (closedWorld.maxUnfinishedFeatures !== 1) {
    errors.push("closedWorld maxUnfinishedFeatures must equal one");
  }
  validateLifecycleProfiles(closedWorld, bindings, errors);
  if (!sha256DigestV2(closedWorld.digest)
    || closedWorld.digest !== hashWithoutKey(closedWorld, "digest")) {
    errors.push("closedWorld digest is invalid or stale");
  }
  return errors;
}

export function validateAdmissionDefinitionV2(admission) {
  const errors = [];
  if (!plainObject(admission) || !exactKeys(admission, ADMISSION_KEYS)) {
    return ["admission must contain the exact v2 keys"];
  }
  validateDefinitionBinding(admission.workstreamDefinition,
    admission.workstreamDefinitionDigest, CONTINUATION_V2_WORKSTREAM_ID,
    CONTINUATION_V2_FEATURE_ID, "admission workstream", errors);
  const featureErrors = validateStableFeatureDefinition(
    admission.featureDefinition,
    CONTINUATION_V2_FEATURE_ID,
  );
  errors.push(...featureErrors.map((error) => `admission ${error}`));
  if (!sha256DigestV2(admission.featureDefinitionDigest)
    || admission.featureDefinitionDigest !== safeHash(admission.featureDefinition)) {
    errors.push("admission Feature definition digest is invalid or stale");
  }
  if (!sha256DigestV2(admission.featureFileSetDigest)
    || admission.featureFileSetDigest
      !== safeHash(admission.featureDefinition?.files)) {
    errors.push("admission Feature file-set digest is invalid or stale");
  }
  if (!sha256DigestV2(admission.reviewCoverageDigest)) {
    errors.push("admission reviewCoverageDigest must be SHA-256");
  }
  validateStringPaths(admission.postReviewMutablePaths,
    "admission postReviewMutablePaths", errors);
  validateStringPaths(admission.reviewOutputPaths,
    "admission reviewOutputPaths", errors);
  const admissionFiles = new Set(admission.featureDefinition?.files ?? []);
  const classified = [
    ...(admission.postReviewMutablePaths ?? []),
    ...(admission.reviewOutputPaths ?? []),
  ];
  if (new Set(classified).size !== classified.length
    || classified.some((relativePath) => !admissionFiles.has(relativePath))) {
    errors.push("admission mutable/output paths must be disjoint P107A files");
  }
  return errors;
}

export function validateSuccessorDefinitionV2(successor) {
  const errors = [];
  if (!plainObject(successor) || !exactKeys(successor, SUCCESSOR_KEYS)) {
    return ["successor must contain the exact v2 keys"];
  }
  validateDefinitionBinding(successor.workstreamDefinition,
    successor.workstreamDefinitionDigest, CONTINUATION_V2_SUCCESSOR_WORKSTREAM_ID,
    CONTINUATION_V2_SUCCESSOR_FEATURE_ID, "successor workstream", errors);
  const featureErrors = validateStableFeatureDefinition(
    successor.featureDefinition,
    CONTINUATION_V2_SUCCESSOR_FEATURE_ID,
  );
  errors.push(...featureErrors.map((error) => `successor ${error}`));
  if (!sha256DigestV2(successor.featureDefinitionDigest)
    || successor.featureDefinitionDigest !== safeHash(successor.featureDefinition)) {
    errors.push("successor Feature definition digest is invalid or stale");
  }
  if (!sha256DigestV2(successor.pathCoverageDigest)) {
    errors.push("successor pathCoverageDigest must be SHA-256");
  }
  return errors;
}

export function validatePathAuthoritiesV2(entries, bindings = {}) {
  const errors = [];
  if (!Array.isArray(entries) || entries.length === 0) {
    return ["pathAuthorities must be a non-empty array"];
  }
  const paths = [];
  for (const [index, entry] of entries.entries()) {
    if (!plainObject(entry)) {
      errors.push(`pathAuthorities[${index}] must be an object`);
      continue;
    }
    paths.push(entry.path);
    if (!repositoryPathV2(entry.path)) {
      errors.push(`pathAuthorities[${index}].path is invalid`);
    }
    if (entry.class === "modify") {
      if (!exactKeys(entry, MODIFY_AUTHORITY_KEYS)
        || !plainObject(entry.baseline)
        || !exactKeys(entry.baseline, MODIFY_BASELINE_KEYS)
        || !["round23_review_snapshot", "cd03a_review_snapshot"]
          .includes(entry.baseline.source)
        || !sha256DigestV2(entry.baseline.sha256)) {
        errors.push(`pathAuthorities[${index}] modify authority is invalid`);
      }
    } else if (entry.class === "create") {
      if (!exactKeys(entry, CREATE_AUTHORITY_KEYS)
        || !plainObject(entry.baseline)
        || !exactKeys(entry.baseline, CREATE_BASELINE_KEYS)
        || entry.baseline.source !== "cd03a_review_absence"
        || entry.baseline.sha256 !== null) {
        errors.push(`pathAuthorities[${index}] create authority is invalid`);
      }
    } else if (entry.class === "bookkeeping") {
      const expectedValidator = CONTINUATION_V2_BOOKKEEPING_VALIDATORS[entry.path];
      if (!exactKeys(entry, BOOKKEEPING_AUTHORITY_KEYS)
        || !plainObject(entry.baseline)
        || !exactKeys(entry.baseline, BOOKKEEPING_BASELINE_KEYS)
        || entry.baseline.source !== "cd03a_review_snapshot"
        || !["present", "absent"].includes(entry.baseline.presence)
        || (entry.baseline.presence === "present"
          ? !sha256DigestV2(entry.baseline.sha256)
          : entry.baseline.sha256 !== null)
        || !expectedValidator || entry.validator !== expectedValidator
        || !orderedSubset(entry.allowedPhases, CONTINUATION_V2_LIFECYCLE_PHASES)) {
        errors.push(`pathAuthorities[${index}] bookkeeping authority is invalid`);
      }
    } else {
      errors.push(`pathAuthorities[${index}].class is invalid`);
    }
  }
  validateSortedUnique(paths, "pathAuthorities paths", errors);
  const forbidden = new Set([
    ...(bindings.trustRoots ?? []).map((entry) => entry?.path),
    ...(bindings.governanceTransitions ?? []).map((entry) => entry?.path),
  ]);
  for (const relativePath of paths) {
    if (forbidden.has(relativePath)) {
      errors.push(`path authority overlaps trust or governance path: ${relativePath}`);
    }
  }
  return errors;
}

export function validateGovernanceTransitionsV2(entries) {
  const errors = [];
  const requiredPaths = Object.keys(CONTINUATION_V2_GOVERNANCE_TRANSITIONS).sort();
  if (!Array.isArray(entries) || entries.length !== requiredPaths.length) {
    return ["governanceTransitions must contain the exact four v2 transitions"];
  }
  const paths = [];
  const stagedPaths = [];
  for (const [index, entry] of entries.entries()) {
    if (!plainObject(entry) || !exactKeys(entry, GOVERNANCE_TRANSITION_KEYS)) {
      errors.push(`governanceTransitions[${index}] has invalid keys`);
      continue;
    }
    paths.push(entry.path);
    stagedPaths.push(entry.stagedTargetPath);
    if (entry.kind !== CONTINUATION_V2_GOVERNANCE_TRANSITIONS[entry.path]
      || !repositoryPathV2(entry.path)
      || !repositoryPathV2(entry.stagedTargetPath)
      || entry.path === entry.stagedTargetPath
      || !sha256DigestV2(entry.fromSha256)
      || !sha256DigestV2(entry.toSha256)
      || entry.fromSha256 === entry.toSha256) {
      errors.push(`governanceTransitions[${index}] is invalid`);
    }
  }
  if (!sameOrderedStrings(paths, requiredPaths)) {
    errors.push("governance transition paths must be exact and sorted");
  }
  if (new Set(stagedPaths).size !== stagedPaths.length
    || stagedPaths.some((stage) => paths.includes(stage))) {
    errors.push("governance staged target paths must be unique and non-live");
  }
  return errors;
}

export function validateGovernanceTransitionStateV2(
  transitions,
  phase,
  liveDigests,
  stagedDigests,
) {
  const errors = validateGovernanceTransitionsV2(transitions);
  if (!CONTINUATION_V2_LIFECYCLE_PHASES.includes(phase)) {
    errors.push("governance transition phase is invalid");
    return errors;
  }
  const expectsFrom = phase === "review_pre_transition";
  for (const entry of transitions ?? []) {
    const expectedLive = expectsFrom ? entry.fromSha256 : entry.toSha256;
    if (lookupDigest(liveDigests, entry.path) !== expectedLive) {
      errors.push(`governance live digest is invalid for ${phase}: ${entry.path}`);
    }
    if (lookupDigest(stagedDigests, entry.stagedTargetPath) !== entry.toSha256) {
      errors.push(`governance staged target digest is stale: ${entry.stagedTargetPath}`);
    }
  }
  return errors;
}

export function validateRound1RejectionV2(rejection) {
  const errors = [];
  if (!plainObject(rejection) || !exactKeys(rejection, ROUND1_REJECTION_KEYS)) {
    return ["round1Rejection must contain the exact v2 keys"];
  }
  if (rejection.round !== 1 || rejection.status !== "rejected") {
    errors.push("round1Rejection identity/status is invalid");
  }
  if (!plainObject(rejection.policy)
    || !exactKeys(rejection.policy, ROUND1_POLICY_REFERENCE_KEYS)
    || rejection.policy.path !== CONTINUATION_V2_ROUND1_POLICY_PATH
    || !sha256DigestV2(rejection.policy.byteSha256)
    || !sha256DigestV2(rejection.policy.canonicalDigest)
    || canonicalJsonV2(rejection.policy)
      !== canonicalJsonV2({
        path: CONTINUATION_V2_ROUND1_POLICY_PATH,
        ...CONTINUATION_V2_ROUND1_REJECTION_TRUST_ROOT.policy,
      })) {
    errors.push("round1Rejection policy reference is invalid");
  }
  if (!plainObject(rejection.snapshot)
    || !exactKeys(rejection.snapshot, ROUND1_SNAPSHOT_REFERENCE_KEYS)
    || rejection.snapshot.path !== CONTINUATION_V2_ROUND1_SNAPSHOT_PATH
    || rejection.snapshot.fileCount !== 19
    || !sha256DigestV2(rejection.snapshot.byteSha256)
    || !sha256DigestV2(rejection.snapshot.digest)
    || canonicalJsonV2(rejection.snapshot)
      !== canonicalJsonV2({
        path: CONTINUATION_V2_ROUND1_SNAPSHOT_PATH,
        ...CONTINUATION_V2_ROUND1_REJECTION_TRUST_ROOT.snapshot,
      })) {
    errors.push("round1Rejection snapshot reference is invalid");
  }
  if (!Array.isArray(rejection.receipts)
    || rejection.receipts.length !== CONTINUATION_V2_REVIEW_LANES.length) {
    errors.push("round1Rejection must bind exactly three failed receipts");
  } else {
    for (const [index, lane] of CONTINUATION_V2_REVIEW_LANES.entries()) {
      const receipt = rejection.receipts[index];
      const expectedPath =
        `.zerox/verification/conversation-disclosure/CD03A-round1-${lane}-review.json`;
      const expected = CONTINUATION_V2_ROUND1_REJECTION_TRUST_ROOT.receipts[lane];
      if (!plainObject(receipt)
        || !exactKeys(receipt, ROUND1_RECEIPT_REFERENCE_KEYS)
        || receipt.lane !== lane
        || receipt.path !== expectedPath
        || receipt.verdict !== "failed"
        || !sha256DigestV2(receipt.byteSha256)
        || !sha256DigestV2(receipt.canonicalDigest)
        || !plainObject(receipt.findingCounts)
        || !exactKeys(receipt.findingCounts, ["critical", "major", "minor"])
        || canonicalJsonV2(receipt.findingCounts)
          !== canonicalJsonV2(expected.findingCounts)
        || receipt.byteSha256 !== expected.byteSha256
        || receipt.canonicalDigest !== expected.canonicalDigest) {
        errors.push(`round1Rejection ${lane} failed receipt reference is invalid`);
      }
    }
  }
  if (canonicalJsonV2(rejection.forbiddenRepositoryOutputs)
    !== canonicalJsonV2(CONTINUATION_V2_ROUND1_FORBIDDEN_OUTPUT_PATHS)) {
    errors.push("round1Rejection forbidden outputs differ from the closed world");
  }
  if (!sha256DigestV2(rejection.digest)
    || rejection.digest !== hashWithoutKey(rejection, "digest")) {
    errors.push("round1Rejection digest is invalid or stale");
  }
  return unique(errors);
}

export function validateContinuationPolicyV2(policy, bindings = {}) {
  const errors = [];
  if (!plainObject(policy) || !exactKeys(policy, POLICY_KEYS)) {
    return ["continuation policy must contain the exact v2 keys"];
  }
  if (policy.schemaVersion !== 2
    || policy.kind !== CONTINUATION_V2_POLICY_KIND
    || policy.algorithm !== CONTINUATION_V2_ALGORITHM
    || policy.policyId !== CONTINUATION_V2_POLICY_ID
    || policy.workstreamId !== CONTINUATION_V2_WORKSTREAM_ID
    || policy.featureId !== CONTINUATION_V2_FEATURE_ID
    || policy.round !== CONTINUATION_V2_ROUND
    || policy.status !== "frozen"
    || !nonEmpty(policy.programId)) {
    errors.push("continuation policy v2 identity/status is invalid");
  }
  errors.push(...validateParentEvidenceBundleV1(
    policy.parentEvidence,
    bindings.parentEvidence ?? {},
  ));
  errors.push(...validateRound1RejectionV2(policy.round1Rejection));
  errors.push(...validateAdmissionDefinitionV2(policy.admission));
  errors.push(...validateSuccessorDefinitionV2(policy.successor));
  errors.push(...validateClosedWorldContractV2(policy.closedWorld, {
    admission: policy.admission,
    successor: policy.successor,
  }));
  if (policy.programId !== policy.closedWorld?.programRootDefinition?.programId) {
    errors.push("continuation policy programId differs from the frozen program root");
  }
  errors.push(...validateGovernanceTransitionsV2(policy.governanceTransitions));
  validateBaselineArchiveReference(policy.baselineArchive,
    "continuation policy baselineArchive", errors);
  errors.push(...validatePathAuthoritiesV2(policy.pathAuthorities, {
    trustRoots: policy.trustRoots,
    governanceTransitions: policy.governanceTransitions,
  }));
  validateTrustRootsAndExecutables(policy, errors);
  validateCoverage(policy, errors);
  if (bindings.baselineArchive !== undefined) {
    errors.push(...validateBaselineArchiveV2(bindings.baselineArchive, policy));
    if (policy.baselineArchive?.digest !== bindings.baselineArchive?.digest
      || policy.baselineArchive?.entrySetDigest
        !== bindings.baselineArchive?.entrySetDigest) {
      errors.push("continuation policy baselineArchive binding is stale");
    }
  }
  if (!plainObject(policy.reviewSnapshot)
    || !exactKeys(policy.reviewSnapshot, REVIEW_SNAPSHOT_REFERENCE_KEYS)
    || policy.reviewSnapshot.path !== CONTINUATION_V2_REVIEW_SNAPSHOT_PATH) {
    errors.push("continuation policy reviewSnapshot reference is invalid");
  }
  if (!plainObject(policy.timePolicy)
    || !exactKeys(policy.timePolicy, TIME_POLICY_KEYS)
    || policy.timePolicy.futureToleranceMs !== 0) {
    errors.push("continuation policy timePolicy must fail closed at zero future tolerance");
  }
  if (!sha256DigestV2(policy.digest)
    || policy.digest !== hashWithoutKey(policy, "digest")) {
    errors.push("continuation policy digest is invalid or stale");
  }
  if (bindings.expectedDigest !== undefined
    && policy.digest !== bindings.expectedDigest) {
    errors.push("continuation policy digest does not match the caller pin");
  }
  if (bindings.lifecycleState !== undefined) {
    errors.push(...validateLifecycleStateV2(bindings.lifecycleState, policy));
  }
  if (bindings.liveAdmissionFeature !== undefined) {
    bindLiveFeature(bindings.liveAdmissionFeature, policy.admission,
      "live P107A", errors);
  }
  if (bindings.liveAdmissionWorkstream !== undefined) {
    bindLiveWorkstream(bindings.liveAdmissionWorkstream,
      policy.admission.workstreamDefinition,
      policy.admission.workstreamDefinitionDigest, "live CD03A", errors);
  }
  if (bindings.liveProgram !== undefined) {
    errors.push(...validateLiveProgramRootV2(bindings.liveProgram, policy.closedWorld));
  }
  return unique(errors);
}

export function validateLifecycleStateV2(live, policy) {
  const errors = [];
  if (!plainObject(live) || !exactKeys(live, LIVE_LIFECYCLE_KEYS)) {
    return ["live lifecycle state must contain the exact v2 keys"];
  }
  const profile = policy?.closedWorld?.lifecycleProfiles?.find(
    (entry) => entry?.phase === live.phase,
  );
  if (!profile) return ["live lifecycle phase is not in the closed world"];
  if (live.activeFeatureId !== profile.activeFeatureId
    || live.nextFeatureId !== profile.nextFeatureId) {
    errors.push("live lifecycle active/next Feature ids differ from the profile");
  }
  const expectedWorkstreams = policy.closedWorld.workstreams ?? [];
  if (!Array.isArray(live.workstreams)
    || live.workstreams.length !== expectedWorkstreams.length) {
    errors.push("live workstream inventory differs from the closed world");
  }
  const liveWorkstreamIds = [];
  for (const workstream of live.workstreams ?? []) {
    liveWorkstreamIds.push(workstream?.id);
    const expected = expectedWorkstreams.find((entry) => entry.id === workstream?.id);
    if (!expected) {
      errors.push(`unknown live workstream: ${workstream?.id ?? "unknown"}`);
      continue;
    }
    try {
      const stable = stableWorkstreamDefinitionV2(workstream);
      if (canonicalJsonV2(stable) !== canonicalJsonV2(expected.stableDefinition)
        || hashCanonicalV2(stable) !== expected.stableDefinitionDigest) {
        errors.push(`live workstream definition drift: ${workstream.id}`);
      }
    } catch (error) {
      errors.push(`live workstream is invalid: ${error.message}`);
    }
    const expectedState = profile.workstreamStates.find(
      (entry) => entry.id === workstream?.id,
    )?.state;
    if (workstream?.state !== expectedState) {
      errors.push(`live workstream state differs from profile: ${workstream?.id}`);
    }
  }
  validateAnchoredUniqueIds(
    liveWorkstreamIds,
    expectedWorkstreams.map((entry) => entry.id),
    "live workstream ids",
    errors,
  );

  const stableFeatureById = new Map([
    ...(policy.closedWorld.historicalFeatures ?? []).map((entry) => [
      entry.id,
      {
        definition: entry.stableDefinition,
        digest: entry.stableDefinitionDigest,
        projection: "historical",
      },
    ]),
    [CONTINUATION_V2_FEATURE_ID, {
      definition: policy.admission.featureDefinition,
      digest: policy.admission.featureDefinitionDigest,
      projection: "strict",
    }],
    [CONTINUATION_V2_SUCCESSOR_FEATURE_ID, {
      definition: policy.successor.featureDefinition,
      digest: policy.successor.featureDefinitionDigest,
      projection: "strict",
    }],
  ]);
  const expectedPresent = profile.featureStates.filter(
    (entry) => entry.presence === "present",
  );
  if (!Array.isArray(live.features) || live.features.length !== expectedPresent.length) {
    errors.push("live Feature inventory differs from the lifecycle profile");
  }
  const liveFeatureIds = [];
  for (const feature of live.features ?? []) {
    liveFeatureIds.push(feature?.id);
    const expectedState = profile.featureStates.find((entry) => entry.id === feature?.id);
    const expectedStable = stableFeatureById.get(feature?.id);
    if (!expectedState || expectedState.presence !== "present" || !expectedStable) {
      errors.push(`unknown or absent live Feature: ${feature?.id ?? "unknown"}`);
      continue;
    }
    try {
      const stable = expectedStable.projection === "historical"
        ? stableHistoricalFeatureDefinitionV2(feature)
        : stableFeatureDefinitionV2(feature);
      if (canonicalJsonV2(stable) !== canonicalJsonV2(expectedStable.definition)
        || hashCanonicalV2(stable) !== expectedStable.digest) {
        errors.push(`live Feature definition drift: ${feature.id}`);
      }
    } catch (error) {
      errors.push(`live Feature is invalid: ${error.message}`);
    }
    if (feature.status !== expectedState.status) {
      errors.push(`live Feature status differs from profile: ${feature.id}`);
    }
  }
  validateAnchoredUniqueIds(
    liveFeatureIds,
    expectedPresent.map((entry) => entry.id),
    "live Feature ids",
    errors,
  );
  const unfinished = (live.features ?? []).filter((feature) => feature?.status !== "done");
  const expectedUnfinished = expectedPresent.filter((entry) => entry.status !== "done");
  if (unfinished.length !== expectedUnfinished.length
    || unfinished.length > policy.closedWorld.maxUnfinishedFeatures) {
    errors.push("live unfinished Feature set differs from the closed-world profile");
  }
  return unique(errors);
}

export function selectLifecycleProfileV2(policy, phase) {
  if (!CONTINUATION_V2_LIFECYCLE_PHASES.includes(phase)) return undefined;
  const profiles = policy?.closedWorld?.lifecycleProfiles;
  if (!Array.isArray(profiles)) return undefined;
  const matches = profiles.filter((entry) => entry?.phase === phase);
  return matches.length === 1 ? matches[0] : undefined;
}

export function validateContinuationReviewSnapshotV2(snapshot, policy, bindings = {}) {
  const errors = [];
  if (!plainObject(snapshot) || !exactKeys(snapshot, SNAPSHOT_KEYS)) {
    return ["continuation review snapshot must contain the exact v2 keys"];
  }
  if (snapshot.schemaVersion !== 2
    || snapshot.kind !== CONTINUATION_V2_SNAPSHOT_KIND
    || snapshot.algorithm !== CONTINUATION_V2_ALGORITHM
    || snapshot.workstreamId !== CONTINUATION_V2_WORKSTREAM_ID
    || snapshot.featureId !== CONTINUATION_V2_FEATURE_ID
    || snapshot.round !== CONTINUATION_V2_ROUND
    || !nonEmpty(snapshot.programId)) {
    errors.push("continuation review snapshot v2 identity is invalid");
  }
  validateTimestampAtOrBefore(snapshot.frozenAt, bindings.verifierNow,
    "continuation review snapshot frozenAt", errors);
  validateBaselineArchiveReference(snapshot.baselineArchive,
    "continuation review snapshot baselineArchive", errors);
  validateFileDigestArray(snapshot.frozenFiles, "snapshot frozenFiles", errors);
  validateFileDigestArray(snapshot.baselineFiles, "snapshot baselineFiles", errors);
  validateStringPaths(snapshot.absentPaths, "snapshot absentPaths", errors);
  validateStringPaths(snapshot.reviewOutputAbsentPaths,
    "snapshot reviewOutputAbsentPaths", errors);
  const frozenPaths = new Set((snapshot.frozenFiles ?? []).map((entry) => entry.path));
  const baselinePaths = new Set((snapshot.baselineFiles ?? []).map((entry) => entry.path));
  const absentPaths = new Set(snapshot.absentPaths ?? []);
  const reviewOutputAbsentPaths = new Set(snapshot.reviewOutputAbsentPaths ?? []);
  for (const relativePath of frozenPaths) {
    if (baselinePaths.has(relativePath) || absentPaths.has(relativePath)) {
      errors.push(`snapshot subject path overlaps categories: ${relativePath}`);
    }
  }
  for (const relativePath of baselinePaths) {
    if (absentPaths.has(relativePath)) {
      errors.push(`snapshot baseline path is also absent: ${relativePath}`);
    }
  }
  for (const relativePath of reviewOutputAbsentPaths) {
    if (frozenPaths.has(relativePath) || baselinePaths.has(relativePath)
      || absentPaths.has(relativePath)) {
      errors.push(`snapshot review output overlaps another category: ${relativePath}`);
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
    if (canonicalJsonV2(snapshot.governanceTransitions)
      !== canonicalJsonV2(policy.governanceTransitions)) {
      errors.push("snapshot governance transitions differ from policy");
    }
    if (canonicalJsonV2(snapshot.baselineArchive)
      !== canonicalJsonV2(policy.baselineArchive)) {
      errors.push("snapshot baselineArchive differs from policy");
    }
    validateSnapshotAuthoritySubjects(snapshot, policy, errors);
    validateAdmissionReviewCoverage(snapshot, policy, errors);
  }
  if (!sha256DigestV2(snapshot.digest)
    || snapshot.digest !== hashWithoutKey(snapshot, "digest")) {
    errors.push("continuation review snapshot digest is invalid or stale");
  }
  return unique(errors);
}

export function validateBaselineArchiveV2(archive, policy) {
  const errors = [];
  if (!plainObject(archive) || !exactKeys(archive, BASELINE_ARCHIVE_KEYS)) {
    return ["baseline archive must contain the exact v2 keys"];
  }
  if (archive.schemaVersion !== 2
    || archive.kind !== CONTINUATION_V2_BASELINE_ARCHIVE_KIND
    || archive.algorithm !== CONTINUATION_V2_ALGORITHM
    || archive.workstreamId !== CONTINUATION_V2_WORKSTREAM_ID
    || archive.featureId !== CONTINUATION_V2_FEATURE_ID
    || archive.round !== CONTINUATION_V2_ROUND
    || !nonEmpty(archive.programId)) {
    errors.push("baseline archive v2 identity is invalid");
  }
  if (!Array.isArray(archive.entries) || archive.entries.length === 0) {
    errors.push("baseline archive entries must be non-empty");
  }
  const paths = [];
  for (const [index, entry] of (archive.entries ?? []).entries()) {
    if (!plainObject(entry) || !exactKeys(entry, BASELINE_ARCHIVE_ENTRY_KEYS)
      || !repositoryPathV2(entry.path)
      || !["round23_review_snapshot", "cd03a_review_snapshot",
        "governance_transition"].includes(entry.source)
      || !sha256DigestV2(entry.sha256)
      || entry.encoding !== "gzip-base64-v1"
      || typeof entry.bytes !== "string") {
      errors.push(`baseline archive entries[${index}] is invalid`);
      continue;
    }
    paths.push(entry.path);
    let decoded;
    try {
      const compressed = Buffer.from(entry.bytes, "base64");
      if (compressed.toString("base64") !== entry.bytes) throw new Error("base64");
      decoded = gunzipSync(compressed);
      const deterministic = gzipSync(decoded, { level: 9, mtime: 0 }).toString("base64");
      if (deterministic !== entry.bytes) throw new Error("non-deterministic");
    } catch {
      errors.push(`baseline archive entries[${index}] bytes are not deterministic gzip-base64`);
      continue;
    }
    if (sha256BytesV2(decoded) !== entry.sha256) {
      errors.push(`baseline archive entries[${index}] decoded hash is stale`);
    }
  }
  validateSortedUnique(paths, "baseline archive entry paths", errors);
  if (!sha256DigestV2(archive.entrySetDigest)
    || archive.entrySetDigest !== safeHash(archive.entries)) {
    errors.push("baseline archive entrySetDigest is invalid or stale");
  }
  if (!sha256DigestV2(archive.digest)
    || archive.digest !== hashWithoutKey(archive, "digest")) {
    errors.push("baseline archive digest is invalid or stale");
  }
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
    expected.sort((left, right) => left.path.localeCompare(right.path));
    const actual = (archive.entries ?? []).map((entry) => ({
      path: entry.path,
      source: entry.source,
      sha256: entry.sha256,
    }));
    if (canonicalJsonV2(actual) !== canonicalJsonV2(expected)) {
      errors.push("baseline archive coverage differs from modify/transition authorities");
    }
  }
  return unique(errors);
}

export function validateContinuationReviewReceiptV2(
  receipt,
  snapshot,
  policy,
  bindings = {},
) {
  const errors = [];
  if (!plainObject(receipt) || !exactKeys(receipt, RECEIPT_KEYS)) {
    return ["continuation review receipt must contain the exact v2 keys"];
  }
  if (receipt.schemaVersion !== 2
    || receipt.kind !== CONTINUATION_V2_RECEIPT_KIND
    || receipt.workstreamId !== CONTINUATION_V2_WORKSTREAM_ID
    || receipt.featureId !== CONTINUATION_V2_FEATURE_ID
    || receipt.round !== CONTINUATION_V2_ROUND
    || !CONTINUATION_V2_REVIEW_LANES.includes(receipt.lane)
    || receipt.transport !== "codex-collaboration"
    || receipt.reviewedPhase !== "review_pre_transition"
    || !nonEmpty(receipt.programId)
    || !nonEmpty(receipt.reviewTaskPath)
    || !nonEmpty(receipt.reviewAgentId)) {
    errors.push("continuation review receipt v2 identity is invalid");
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
    if (!sha256DigestV2(receipt[key])) {
      errors.push(`continuation review receipt ${key} must be SHA-256`);
    }
  }
  const completedAtMs = validateTimestampAtOrBefore(
    receipt.completedAt,
    bindings.verifierNow,
    "continuation review receipt completedAt",
    errors,
  );
  const frozenAtMs = parseIso(snapshot?.frozenAt);
  if (completedAtMs !== null && frozenAtMs !== null && completedAtMs < frozenAtMs) {
    errors.push("continuation review receipt predates the frozen snapshot");
  }
  if (!Number.isInteger(receipt.snapshotFileCount) || receipt.snapshotFileCount <= 0) {
    errors.push("continuation review receipt snapshotFileCount must be positive");
  }
  validateFindings(receipt, errors);
  if (receipt.verdict !== "passed" && receipt.verdict !== "failed") {
    errors.push("continuation review receipt verdict is invalid");
  }
  if (plainObject(snapshot) && plainObject(policy)) {
    const expected = {
      programId: snapshot.programId,
      snapshotDigest: snapshot.digest,
      snapshotFileCount: (snapshot.frozenFiles?.length ?? 0)
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
    if (hashCanonicalV2(receipt) !== bindings.expectedCanonicalDigest) {
      errors.push("continuation review receipt digest does not match the caller pin");
    }
  }
  return unique(errors);
}

export function validateContinuationReviewSetV2(
  receipts,
  snapshot,
  policy,
  bindings = {},
) {
  const errors = [];
  if (!Array.isArray(receipts)
    || receipts.length !== CONTINUATION_V2_REVIEW_LANES.length) {
    return ["continuation review set must contain exactly three receipts"];
  }
  if (!plainObject(bindings.callerPins)
    || !exactKeys(bindings.callerPins, CONTINUATION_V2_REVIEW_LANES)) {
    return ["continuation review set requires exact caller pins for all lanes"];
  }
  const lanes = [];
  const challenges = [];
  const tasks = [];
  const agents = [];
  for (const receipt of receipts) {
    const pin = bindings.callerPins[receipt?.lane];
    if (!plainObject(pin) || !exactKeys(pin, CALLER_PIN_KEYS)
      || !sha256DigestV2(pin.challenge) || !sha256DigestV2(pin.canonicalDigest)) {
      errors.push(`caller pin is invalid for lane ${receipt?.lane ?? "unknown"}`);
      continue;
    }
    errors.push(...validateContinuationReviewReceiptV2(receipt, snapshot, policy, {
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
  if (!sameOrderedStrings(lanes, CONTINUATION_V2_REVIEW_LANES)) {
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

export function validateContinuationClosureManifestV2(
  manifest,
  bindings = {},
) {
  const errors = [];
  if (!plainObject(manifest) || !exactKeys(manifest, MANIFEST_KEYS)) {
    return ["continuation closure manifest must contain the exact v2 keys"];
  }
  if (manifest.schemaVersion !== 2
    || manifest.kind !== CONTINUATION_V2_MANIFEST_KIND
    || manifest.workstreamId !== CONTINUATION_V2_WORKSTREAM_ID
    || manifest.featureId !== CONTINUATION_V2_FEATURE_ID
    || manifest.round !== CONTINUATION_V2_ROUND
    || !["review_passed_pending_external_anchor", "externally_attested"]
      .includes(manifest.status)) {
    errors.push("continuation closure manifest v2 identity/status is invalid");
  }
  if (!sha256DigestV2(manifest.parentEvidenceBundleDigest)) {
    errors.push("continuation closure manifest parent bundle digest is invalid");
  }
  validatePathDigest(manifest.policy, "manifest policy", errors);
  validatePathDigest(manifest.snapshot, "manifest snapshot", errors);
  validateLaneArray(manifest.reviewReceipts, REVIEW_REFERENCE_KEYS,
    "manifest review receipt", errors, (entry) => repositoryPathV2(entry.path)
      && sha256DigestV2(entry.canonicalDigest) && sha256DigestV2(entry.challenge));
  validatePathSha(manifest.validator, EXECUTABLE_REFERENCE_KEYS,
    "manifest validator", errors, "sha256");
  validatePathSha(manifest.externalRunner, EXECUTABLE_REFERENCE_KEYS,
    "manifest external runner", errors, "sha256");
  if (!plainObject(manifest.externalAttestation)
    || !exactKeys(manifest.externalAttestation, NULLABLE_CANONICAL_REFERENCE_KEYS)
    || !repositoryPathV2(manifest.externalAttestation.path)
    || (manifest.status === "review_passed_pending_external_anchor"
      ? manifest.externalAttestation.canonicalDigest !== null
      : !sha256DigestV2(manifest.externalAttestation.canonicalDigest))) {
    errors.push("manifest external attestation reference is invalid for status");
  }
  bindManifestInputs(manifest, bindings, errors);
  if (!sha256DigestV2(manifest.digest)
    || manifest.digest !== hashWithoutKey(manifest, "digest")) {
    errors.push("continuation closure manifest digest is invalid or stale");
  }
  return unique(errors);
}

export function toPendingContinuationManifestV2(manifest) {
  const pending = {
    ...manifest,
    status: "review_passed_pending_external_anchor",
    externalAttestation: {
      ...manifest.externalAttestation,
      canonicalDigest: null,
    },
  };
  delete pending.digest;
  return { ...pending, digest: hashCanonicalV2(pending) };
}

export function validateContinuationExternalAttestationV2(
  attestation,
  bindings = {},
) {
  const errors = [];
  if (!plainObject(attestation) || !exactKeys(attestation, ATTESTATION_KEYS)) {
    return ["continuation external attestation must contain the exact v2 keys"];
  }
  if (attestation.schemaVersion !== 2
    || attestation.kind !== CONTINUATION_V2_ATTESTATION_KIND
    || attestation.status !== "passed"
    || attestation.trustLevel !== "external-anchor-consistency"
    || attestation.subjectIdentityAssurance !== "not-signed"
    || attestation.governancePhase !== "review_post_transition"
    || !path.isAbsolute(attestation.repositoryRealpath)) {
    errors.push("continuation external attestation v2 identity is invalid");
  }
  for (const key of [
    "parentEvidenceBundleDigest",
    "pendingManifestDigest",
    "policyDigest",
    "snapshotDigest",
    "validatorDigest",
    "runnerDigest",
  ]) {
    if (!sha256DigestV2(attestation[key])) {
      errors.push(`continuation external attestation ${key} is invalid`);
    }
  }
  const completedAtMs = validateTimestampAtOrBefore(attestation.completedAt,
    bindings.verifierNow, "continuation external attestation completedAt", errors);
  validateReceiptBindings(attestation.reviewReceiptBindings,
    "attestation receipt binding", errors);
  validateCandidateResults(attestation.candidateResults, errors);
  bindAttestationInputs(attestation, bindings, completedAtMs, errors);
  if (!sha256DigestV2(attestation.digest)
    || attestation.digest !== hashWithoutKey(attestation, "digest")) {
    errors.push("continuation external attestation digest is invalid or stale");
  }
  return unique(errors);
}

export function validateContinuationExternalAnchorV2(anchor, bindings = {}) {
  const errors = [];
  if (!plainObject(anchor) || !exactKeys(anchor, ANCHOR_KEYS)) {
    return ["continuation external anchor must contain the exact v2 keys"];
  }
  if (anchor.schemaVersion !== 2
    || anchor.kind !== CONTINUATION_V2_ANCHOR_KIND
    || anchor.trustLevel !== "external-caller-pinned-consistency"
    || anchor.subjectIdentityAssurance !== "not-signed"
    || !path.isAbsolute(anchor.repositoryRealpath)) {
    errors.push("continuation external anchor v2 identity is invalid");
  }
  for (const key of [
    "attestationDigest",
    "parentEvidenceBundleDigest",
    "policyDigest",
    "snapshotDigest",
    "validatorDigest",
    "runnerDigest",
  ]) {
    if (!sha256DigestV2(anchor[key])) {
      errors.push(`continuation external anchor ${key} is invalid`);
    }
  }
  validateTimestampAtOrBefore(anchor.completedAt, bindings.verifierNow,
    "continuation external anchor completedAt", errors);
  validateReceiptBindings(anchor.reviewReceiptBindings,
    "anchor receipt binding", errors);
  if (!plainObject(anchor.head) || !exactKeys(anchor.head, ANCHOR_HEAD_KEYS)
    || anchor.head.kind !== "successor-admission"
    || anchor.head.status !== "externally_attested"
    || anchor.head.workstreamId !== CONTINUATION_V2_WORKSTREAM_ID
    || anchor.head.featureId !== CONTINUATION_V2_FEATURE_ID
    || anchor.head.snapshotDigest !== anchor.snapshotDigest
    || !sha256DigestV2(anchor.head.successorWorkstreamDefinitionDigest)
    || !sha256DigestV2(anchor.head.successorFeatureDefinitionDigest)) {
    errors.push("continuation external anchor head is invalid");
  }
  bindAnchorInputs(anchor, bindings, errors);
  if (!sha256DigestV2(anchor.digest)
    || anchor.digest !== hashWithoutKey(anchor, "digest")) {
    errors.push("continuation external anchor digest is invalid or stale");
  }
  if (bindings.expectedDigest === undefined
    || anchor.digest !== bindings.expectedDigest) {
    errors.push("continuation external anchor digest does not match the caller pin");
  }
  return unique(errors);
}

function validateClosedWorldDefinitions(entries, keys, subject, errors, predicate) {
  if (!Array.isArray(entries) || entries.length === 0) {
    errors.push(`${subject} entries must be non-empty`);
    return;
  }
  const ids = [];
  for (const [index, entry] of entries.entries()) {
    if (!plainObject(entry) || !exactKeys(entry, keys) || !predicate(entry)) {
      errors.push(`${subject}[${index}] is invalid`);
      continue;
    }
    ids.push(entry.id);
  }
  validateAnchoredRosterIds(ids, `${subject} ids`, errors);
}

function validateLifecycleProfiles(closedWorld, bindings, errors) {
  const profiles = closedWorld.lifecycleProfiles;
  if (!Array.isArray(profiles)
    || profiles.length !== CONTINUATION_V2_LIFECYCLE_PHASES.length) {
    errors.push("closedWorld must contain the exact four lifecycle profiles");
    return;
  }
  const phases = [];
  const workstreamIds = (closedWorld.workstreams ?? []).map((entry) => entry.id);
  const historicalFeatureIds = (closedWorld.historicalFeatures ?? [])
    .map((entry) => entry.id);
  const allFeatureIds = [
    CONTINUATION_V2_SUCCESSOR_FEATURE_ID,
    CONTINUATION_V2_FEATURE_ID,
    ...historicalFeatureIds,
  ];
  if (new Set(allFeatureIds).size !== allFeatureIds.length) {
    errors.push("closedWorld historical Feature roster overlaps continuation ids");
  }
  for (const [index, profile] of profiles.entries()) {
    if (!plainObject(profile) || !exactKeys(profile, LIFECYCLE_PROFILE_KEYS)) {
      errors.push(`lifecycleProfiles[${index}] has invalid keys`);
      continue;
    }
    phases.push(profile.phase);
    if (!nonEmpty(profile.nextFeatureId)
      || !(profile.activeFeatureId === null || nonEmpty(profile.activeFeatureId))) {
      errors.push(`lifecycleProfiles[${index}] active/next ids are invalid`);
    }
    validateStateArray(profile.workstreamStates, WORKSTREAM_STATE_KEYS,
      workstreamIds, "workstream", index, errors, (entry) =>
        ["planned", "in_progress", "completed"].includes(entry.state));
    validateStateArray(profile.featureStates, FEATURE_STATE_KEYS,
      allFeatureIds, "Feature", index, errors, (entry) =>
        ["present", "absent"].includes(entry.presence)
          && (entry.presence === "absent"
            ? entry.status === null
            : ["done", "in_progress"].includes(entry.status)));
    for (const historicalFeatureId of historicalFeatureIds) {
      const historicalState = profile.featureStates?.find(
        (entry) => entry?.id === historicalFeatureId,
      );
      if (historicalState?.presence !== "present"
        || historicalState?.status !== "done") {
        errors.push(
          `lifecycleProfiles[${index}] historical Feature must remain present/done: ${historicalFeatureId}`,
        );
      }
    }
    validateRequiredProfileSemantics(profile, errors);
  }
  if (!sameOrderedStrings(phases, CONTINUATION_V2_LIFECYCLE_PHASES)) {
    errors.push("lifecycle profile phases must be exact and ordered");
  }
  if (bindings.admission && bindings.successor) {
    const admissionWorkstream = closedWorld.workstreams?.find(
      (entry) => entry.id === CONTINUATION_V2_WORKSTREAM_ID,
    );
    const successorWorkstream = closedWorld.workstreams?.find(
      (entry) => entry.id === CONTINUATION_V2_SUCCESSOR_WORKSTREAM_ID,
    );
    if (admissionWorkstream?.stableDefinitionDigest
        !== bindings.admission.workstreamDefinitionDigest
      || successorWorkstream?.stableDefinitionDigest
        !== bindings.successor.workstreamDefinitionDigest) {
      errors.push("closedWorld admission/successor workstream definitions are stale");
    }
  }
}

function validateRequiredProfileSemantics(profile, errors) {
  const workstreamState = new Map((profile.workstreamStates ?? [])
    .map((entry) => [entry.id, entry.state]));
  const featureState = new Map((profile.featureStates ?? [])
    .map((entry) => [entry.id, entry]));
  const admissionFeature = featureState.get(CONTINUATION_V2_FEATURE_ID);
  const successorFeature = featureState.get(CONTINUATION_V2_SUCCESSOR_FEATURE_ID);
  const admissionWorkstream = workstreamState.get(CONTINUATION_V2_WORKSTREAM_ID);
  const successorWorkstream = workstreamState.get(
    CONTINUATION_V2_SUCCESSOR_WORKSTREAM_ID,
  );
  if (["review_pre_transition", "review_post_transition"].includes(profile.phase)) {
    if (admissionWorkstream !== "in_progress" || successorWorkstream !== "planned"
      || admissionFeature?.presence !== "present"
      || admissionFeature?.status !== "in_progress"
      || successorFeature?.presence !== "absent"
      || profile.activeFeatureId !== CONTINUATION_V2_FEATURE_ID
      || profile.nextFeatureId !== CONTINUATION_V2_FEATURE_ID) {
      errors.push(`${profile.phase} lifecycle semantics are invalid`);
    }
  } else if (profile.phase === "anchored_planned") {
    if (admissionWorkstream !== "completed" || successorWorkstream !== "planned"
      || admissionFeature?.status !== "done"
      || successorFeature?.presence !== "absent"
      || profile.activeFeatureId !== null
      || profile.nextFeatureId !== CONTINUATION_V2_SUCCESSOR_FEATURE_ID) {
      errors.push("anchored_planned lifecycle semantics are invalid");
    }
  } else if (profile.phase === "authorized_active") {
    if (admissionWorkstream !== "completed" || successorWorkstream !== "in_progress"
      || admissionFeature?.status !== "done"
      || successorFeature?.presence !== "present"
      || successorFeature?.status !== "in_progress"
      || profile.activeFeatureId !== CONTINUATION_V2_SUCCESSOR_FEATURE_ID
      || profile.nextFeatureId !== CONTINUATION_V2_SUCCESSOR_FEATURE_ID) {
      errors.push("authorized_active lifecycle semantics are invalid");
    }
  }
}

function validateStateArray(entries, keys, exactIds, subject, profileIndex, errors,
  predicate) {
  if (!Array.isArray(entries) || entries.length !== exactIds.length) {
    errors.push(`lifecycleProfiles[${profileIndex}] ${subject} inventory is incomplete`);
    return;
  }
  const ids = [];
  for (const entry of entries) {
    if (!plainObject(entry) || !exactKeys(entry, keys) || !predicate(entry)) {
      errors.push(`lifecycleProfiles[${profileIndex}] ${subject} state is invalid`);
      continue;
    }
    ids.push(entry.id);
  }
  if (!sameOrderedStrings(ids, exactIds)) {
    errors.push(`lifecycleProfiles[${profileIndex}] ${subject} ids are not closed-world exact`);
  }
}

function validateStableFeatureDefinition(definition, expectedId) {
  const errors = [];
  if (!plainObject(definition) || !exactKeys(definition, FEATURE_STABLE_KEYS)) {
    return ["Feature definition must contain the exact stable v2 keys"];
  }
  if (definition.id !== expectedId || !Number.isInteger(definition.priority)
    || definition.priority <= 0 || !nonEmpty(definition.title)) {
    errors.push("Feature definition scalar identity is invalid");
  }
  for (const key of ["files", "definitionOfDone", "verification"]) {
    if (!stringArray(definition[key])) {
      errors.push(`Feature definition ${key} must be a non-empty string array`);
    }
  }
  if (Array.isArray(definition.files)) {
    if (definition.files.some((entry) => !repositoryPathV2(entry))) {
      errors.push("Feature definition files contain an invalid path");
    }
    if (new Set(definition.files).size !== definition.files.length) {
      errors.push("Feature definition files must be unique");
    }
  }
  return errors;
}

function validateHistoricalFeatureDefinition(definition, expectedId) {
  const errors = [];
  if (!plainObject(definition)) {
    return ["Historical Feature definition must be an object"];
  }
  const keys = Object.keys(definition);
  if (HISTORICAL_FEATURE_REQUIRED_KEYS.some((key) => !keys.includes(key))
    || keys.some((key) => !HISTORICAL_FEATURE_STABLE_KEYS.includes(key))) {
    return ["Historical Feature definition contains an unknown or missing key"];
  }
  if (definition.id !== expectedId || !nonEmpty(definition.id)) {
    errors.push("Historical Feature id is invalid");
  }
  if (!stringArray(definition.definitionOfDone)) {
    errors.push("Historical Feature definitionOfDone must be a non-empty string array");
  }
  if (Object.hasOwn(definition, "priority")
    && (!Number.isInteger(definition.priority) || definition.priority < 0)) {
    errors.push("Historical Feature priority is invalid");
  }
  if (Object.hasOwn(definition, "title") && !nonEmpty(definition.title)) {
    errors.push("Historical Feature title is invalid");
  }
  if (Object.hasOwn(definition, "verification")
    && !stringArray(definition.verification)) {
    errors.push("Historical Feature verification must be a non-empty string array");
  }
  if (Object.hasOwn(definition, "files")) {
    if (!stringArray(definition.files)
      || definition.files.some((entry) => !repositoryPathV2(entry))
      || new Set(definition.files).size !== definition.files.length) {
      errors.push("Historical Feature files must be non-empty, unique repository paths");
    }
  }
  return errors;
}

function validateDefinitionBinding(definition, digest, expectedId,
  expectedFeatureId, subject, errors) {
  if (!plainObject(definition) || Object.hasOwn(definition, "state")
    || definition.id !== expectedId || definition.featureId !== expectedFeatureId
    || !sha256DigestV2(digest) || digest !== safeHash(definition)) {
    errors.push(`${subject} definition/digest is invalid or stale`);
  }
}

function validateTrustRootsAndExecutables(policy, errors) {
  if (!Array.isArray(policy.trustRoots) || policy.trustRoots.length === 0) {
    errors.push("trustRoots must be non-empty");
    return;
  }
  const trustPaths = [];
  const trustDigests = new Map();
  for (const [index, entry] of policy.trustRoots.entries()) {
    if (!plainObject(entry) || !exactKeys(entry, TRUST_ROOT_KEYS)
      || !repositoryPathV2(entry.path) || !sha256DigestV2(entry.sha256)) {
      errors.push(`trustRoots[${index}] is invalid`);
      continue;
    }
    trustPaths.push(entry.path);
    trustDigests.set(entry.path, entry.sha256);
  }
  validateSortedUnique(trustPaths, "trustRoot paths", errors);
  if (!Array.isArray(policy.continuationExecutables)
    || policy.continuationExecutables.length
      !== CONTINUATION_V2_EXECUTABLE_KINDS.length) {
    errors.push("continuationExecutables must contain exact v2 kinds");
    return;
  }
  const kinds = [];
  for (const [index, entry] of policy.continuationExecutables.entries()) {
    if (!plainObject(entry) || !exactKeys(entry, CONTINUATION_EXECUTABLE_KEYS)
      || !CONTINUATION_V2_EXECUTABLE_KINDS.includes(entry.kind)
      || !repositoryPathV2(entry.path) || !sha256DigestV2(entry.sha256)
      || trustDigests.get(entry.path) !== entry.sha256) {
      errors.push(`continuationExecutables[${index}] is invalid or not a trust root`);
      continue;
    }
    kinds.push(entry.kind);
  }
  if (!sameOrderedStrings(kinds, CONTINUATION_V2_EXECUTABLE_KINDS)) {
    errors.push("continuation executable kinds must be exact and ordered");
  }
  for (const transition of policy.governanceTransitions ?? []) {
    if (trustDigests.get(transition.path) !== transition.toSha256) {
      errors.push(`governance target is not the exact trust root: ${transition.path}`);
    }
  }
}

function validateCoverage(policy, errors) {
  const coverage = [];
  const transitionPaths = new Set((policy.governanceTransitions ?? [])
    .map((entry) => entry.path));
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
  const coverageForFeature = coverage.filter((entry) =>
    successorFiles.includes(entry.path));
  const coveragePaths = coverageForFeature.map((entry) => entry.path).sort();
  if (!sameOrderedStrings(coveragePaths, successorFiles.slice().sort())) {
    errors.push("P108 Feature paths are not covered exactly once");
  }
  if (new Set(coveragePaths).size !== coveragePaths.length) {
    errors.push("P108 Feature path coverage overlaps authority classes");
  }
  const canonicalCoverage = coverageForFeature.slice()
    .sort((left, right) => left.path.localeCompare(right.path));
  if (policy.successor?.pathCoverageDigest !== safeHash(canonicalCoverage)) {
    errors.push("successor pathCoverageDigest is invalid or stale");
  }
  const admissionFiles = new Set(policy.admission?.featureDefinition?.files ?? []);
  const requiredRound1Evidence = [
    policy.round1Rejection?.policy?.path,
    policy.round1Rejection?.snapshot?.path,
    ...(policy.round1Rejection?.receipts ?? []).map((entry) => entry?.path),
  ];
  if (requiredRound1Evidence.some((relativePath) => !admissionFiles.has(relativePath))
    || (policy.round1Rejection?.forbiddenRepositoryOutputs ?? [])
      .some((relativePath) => admissionFiles.has(relativePath))) {
    errors.push("P107A admission must bind all Round1 rejection evidence and no forbidden output");
  }
}

function validateAdmissionReviewCoverage(snapshot, policy, errors) {
  const admission = policy.admission;
  const admissionFiles = admission?.featureDefinition?.files ?? [];
  const frozen = new Map((snapshot.frozenFiles ?? [])
    .map((entry) => [entry.path, entry.sha256]));
  const transitionLive = new Set((policy.governanceTransitions ?? [])
    .map((entry) => entry.path));
  const transitionTarget = new Set((policy.governanceTransitions ?? [])
    .map((entry) => entry.stagedTargetPath));
  const postReviewMutable = new Set(admission?.postReviewMutablePaths ?? []);
  const reviewOutput = new Set(snapshot.reviewOutputAbsentPaths ?? []);
  if (!sameStringSet([...reviewOutput], admission?.reviewOutputPaths ?? [])) {
    errors.push("snapshot reviewOutputAbsentPaths differ from admission outputs");
  }
  const coverage = [];
  for (const relativePath of admissionFiles) {
    const classifications = [
      frozen.has(relativePath) ? "frozen_file" : null,
      transitionLive.has(relativePath) ? "transition_live" : null,
      transitionTarget.has(relativePath) ? "transition_target" : null,
      postReviewMutable.has(relativePath) ? "post_review_mutable" : null,
      reviewOutput.has(relativePath) ? "review_output_absent" : null,
    ].filter(Boolean);
    if (classifications.length !== 1) {
      errors.push(
        `P107A review coverage must classify exactly once: ${relativePath}`,
      );
      continue;
    }
    coverage.push({ path: relativePath, class: classifications[0] });
  }
  coverage.sort((left, right) => left.path.localeCompare(right.path));
  if (admission?.reviewCoverageDigest !== safeHash(coverage)) {
    errors.push("admission reviewCoverageDigest is invalid or stale");
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
}

function validateSnapshotAuthoritySubjects(snapshot, policy, errors) {
  const baseline = new Map((snapshot.baselineFiles ?? [])
    .map((entry) => [entry.path, entry.sha256]));
  const absent = new Set(snapshot.absentPaths ?? []);
  const expectedBaseline = new Map();
  const expectedAbsent = new Set();
  for (const entry of policy.pathAuthorities ?? []) {
    if (entry.class === "modify" && entry.baseline.source === "cd03a_review_snapshot") {
      expectedBaseline.set(entry.path, entry.baseline.sha256);
    } else if (entry.class === "create") {
      expectedAbsent.add(entry.path);
    } else if (entry.class === "bookkeeping") {
      if (entry.baseline.presence === "present") {
        expectedBaseline.set(entry.path, entry.baseline.sha256);
      } else {
        expectedAbsent.add(entry.path);
      }
    }
  }
  for (const relativePath of policy.round1Rejection?.forbiddenRepositoryOutputs ?? []) {
    expectedAbsent.add(relativePath);
  }
  if (!sameMap(expectedBaseline, baseline)) {
    errors.push("snapshot baselineFiles do not exactly bind CD03A baselines");
  }
  if (!sameStringSet([...expectedAbsent], [...absent])) {
    errors.push(
      "snapshot absentPaths do not exactly bind create/bookkeeping/Round1 forbidden absence",
    );
  }
  const frozen = new Map((snapshot.frozenFiles ?? [])
    .map((entry) => [entry.path, entry.sha256]));
  for (const transition of policy.governanceTransitions ?? []) {
    if (frozen.has(transition.path)) {
      errors.push(`snapshot must not freeze live transition path: ${transition.path}`);
    }
    if (frozen.get(transition.stagedTargetPath) !== transition.toSha256) {
      errors.push(`snapshot does not freeze transition stage target: ${transition.path}`);
    }
  }
}

function bindLiveFeature(feature, definition, subject, errors) {
  try {
    const stable = stableFeatureDefinitionV2(feature);
    if (canonicalJsonV2(stable) !== canonicalJsonV2(definition.featureDefinition)
      || hashCanonicalV2(stable) !== definition.featureDefinitionDigest
      || hashCanonicalV2(stable.files) !== definition.featureFileSetDigest) {
      errors.push(`${subject} definition/file-set differs from the frozen admission`);
    }
  } catch (error) {
    errors.push(`${subject} is invalid: ${error.message}`);
  }
}

function bindLiveWorkstream(workstream, definition, digest, subject, errors) {
  try {
    const stable = stableWorkstreamDefinitionV2(workstream);
    if (canonicalJsonV2(stable) !== canonicalJsonV2(definition)
      || hashCanonicalV2(stable) !== digest) {
      errors.push(`${subject} definition differs from the frozen admission`);
    }
  } catch (error) {
    errors.push(`${subject} is invalid: ${error.message}`);
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
      || !repositoryPathV2(entry.path) || !sha256DigestV2(entry.sha256)) {
      errors.push(`${subject}[${index}] is invalid`);
      continue;
    }
    paths.push(entry.path);
  }
  validateSortedUnique(paths, `${subject} paths`, errors);
}

function validateStringPaths(entries, subject, errors) {
  if (!Array.isArray(entries) || entries.some((entry) => !repositoryPathV2(entry))) {
    errors.push(`${subject} must contain repository paths`);
    return;
  }
  validateSortedUnique(entries, subject, errors);
}

function validateFindings(receipt, errors) {
  if (!plainObject(receipt.findingCounts)
    || !exactKeys(receipt.findingCounts, FINDING_COUNTS_KEYS)
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

function bindManifestInputs(manifest, bindings, errors) {
  const { policy, snapshot, receipts } = bindings;
  if (plainObject(policy)) {
    if (manifest.programId !== policy.programId
      || manifest.parentEvidenceBundleDigest !== policy.parentEvidence?.bundleDigest
      || manifest.policy?.digest !== policy.digest) {
      errors.push("manifest policy/parent binding is stale");
    }
  }
  if (plainObject(snapshot) && manifest.snapshot?.digest !== snapshot.digest) {
    errors.push("manifest snapshot binding is stale");
  }
  if (Array.isArray(receipts)) {
    compareReceiptReferences(manifest.reviewReceipts, receipts,
      "manifest receipt", errors);
  }
}

function bindAttestationInputs(attestation, bindings, completedAtMs, errors) {
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
    const pending = toPendingContinuationManifestV2(manifest);
    if (attestation.pendingManifestDigest !== pending.digest
      || manifest.externalAttestation?.canonicalDigest !== attestation.digest) {
      errors.push("attestation manifest binding is stale");
    }
  }
  if (Array.isArray(receipts)) {
    compareReceiptBindings(attestation.reviewReceiptBindings, receipts,
      "attestation receipt", errors);
    for (const receipt of receipts) {
      const receiptMs = parseIso(receipt.completedAt);
      if (completedAtMs !== null && receiptMs !== null && completedAtMs < receiptMs) {
        errors.push(`attestation predates receipt lane ${receipt.lane}`);
      }
    }
  }
}

function bindAnchorInputs(anchor, bindings, errors) {
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
  if (plainObject(attestation)) {
    if (anchor.attestationDigest !== attestation.digest
      || anchor.completedAt !== attestation.completedAt
      || anchor.repositoryRealpath !== attestation.repositoryRealpath
      || anchor.runnerDigest !== attestation.runnerDigest
      || anchor.validatorDigest !== attestation.validatorDigest) {
      errors.push("anchor attestation binding is stale");
    }
  }
  if (Array.isArray(receipts)) {
    compareReceiptBindings(anchor.reviewReceiptBindings, receipts,
      "anchor receipt", errors);
  }
}

function validateReceiptBindings(entries, subject, errors) {
  validateLaneArray(entries, RECEIPT_BINDING_KEYS, subject, errors,
    (entry) => sha256DigestV2(entry.canonicalDigest)
      && sha256DigestV2(entry.challenge));
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
      || !repositoryPathV2(entry.path) || entry.status !== "passed"
      || !sha256DigestV2(entry.receiptDigest)
      || !sha256DigestV2(entry.stdoutDigest)
      || !sha256DigestV2(entry.stderrDigest)) {
      errors.push(`attestation candidateResults[${index}] is invalid`);
      continue;
    }
    kinds.push(entry.kind);
  }
  if (!sameOrderedStrings(kinds, ["checker", "harness"])) {
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

function validateLaneArray(entries, keys, subject, errors, predicate) {
  if (!Array.isArray(entries) || entries.length !== CONTINUATION_V2_REVIEW_LANES.length) {
    errors.push(`${subject} must contain exactly three lanes`);
    return;
  }
  const lanes = [];
  for (const [index, entry] of entries.entries()) {
    if (!plainObject(entry) || !exactKeys(entry, keys)
      || !CONTINUATION_V2_REVIEW_LANES.includes(entry.lane)
      || !predicate(entry)) {
      errors.push(`${subject}[${index}] is invalid`);
      continue;
    }
    lanes.push(entry.lane);
  }
  if (!sameOrderedStrings(lanes, CONTINUATION_V2_REVIEW_LANES)) {
    errors.push(`${subject} lanes must be exact and ordered`);
  }
}

function validatePathDigest(reference, subject, errors) {
  if (!plainObject(reference) || !exactKeys(reference, PATH_DIGEST_KEYS)
    || !repositoryPathV2(reference.path) || !sha256DigestV2(reference.digest)) {
    errors.push(`${subject} reference is invalid`);
  }
}

function validateParentRepositoryEvidence(entries, bundle, bindings, errors) {
  if (!Array.isArray(entries) || entries.length === 0) {
    errors.push("parent repositoryEvidence must be non-empty");
    return;
  }
  const paths = [];
  for (const [index, entry] of entries.entries()) {
    if (!plainObject(entry) || !exactKeys(entry, REPOSITORY_EVIDENCE_KEYS)
      || !repositoryPathV2(entry.path) || !sha256DigestV2(entry.sha256)) {
      errors.push(`parent repositoryEvidence[${index}] is invalid`);
      continue;
    }
    paths.push(entry.path);
  }
  validateSortedUnique(paths, "parent repositoryEvidence paths", errors);
  const typedPaths = [
    bundle.artifact?.path,
    bundle.snapshot?.path,
    ...(bundle.receipts ?? []).map((entry) => entry?.path),
    bundle.closureManifest?.path,
    bundle.externalAttestation?.path,
    bundle.validator?.path,
    bundle.externalRunner?.path,
    ...CONTINUATION_V2_REQUIRED_PARENT_REPOSITORY_PATHS,
  ].filter(nonEmpty);
  for (const requiredPath of new Set(typedPaths)) {
    if (!paths.includes(requiredPath)) {
      errors.push(`parent repositoryEvidence is missing required path: ${requiredPath}`);
    }
  }
  const markers = paths.filter((relativePath) =>
    relativePath.includes(".completed-") && relativePath.endsWith(".marker"));
  if (markers.length < 5) {
    errors.push("parent repositoryEvidence must contain all five repository completed markers");
  }
  if (Array.isArray(bindings.requiredRepositoryEvidence)) {
    const expected = bindings.requiredRepositoryEvidence;
    if (canonicalJsonV2(entries) !== canonicalJsonV2(expected)) {
      errors.push("parent repositoryEvidence differs from the caller-required set");
    }
  } else if (Array.isArray(bindings.requiredRepositoryEvidencePaths)) {
    for (const requiredPath of bindings.requiredRepositoryEvidencePaths) {
      if (!paths.includes(requiredPath)) {
        errors.push(`parent repositoryEvidence misses caller-required path: ${requiredPath}`);
      }
    }
  }
}

function validateParentExternalEvidence(entries, bundle, bindings, errors) {
  if (!Array.isArray(entries)
    || entries.length !== CONTINUATION_V2_EXTERNAL_EVIDENCE_ROLES.length) {
    errors.push("parent externalEvidence must contain the exact three external roles");
    return;
  }
  const roles = [];
  const basenames = [];
  for (const [index, entry] of entries.entries()) {
    if (!plainObject(entry) || !exactKeys(entry, EXTERNAL_EVIDENCE_KEYS)
      || !CONTINUATION_V2_EXTERNAL_EVIDENCE_ROLES.includes(entry.role)
      || !nonEmpty(entry.basename) || path.basename(entry.basename) !== entry.basename
      || !sha256DigestV2(entry.sha256)) {
      errors.push(`parent externalEvidence[${index}] is invalid`);
      continue;
    }
    roles.push(entry.role);
    basenames.push(entry.basename);
  }
  if (!sameOrderedStrings(roles, CONTINUATION_V2_EXTERNAL_EVIDENCE_ROLES)) {
    errors.push("parent externalEvidence roles must be exact and ordered");
  }
  if (new Set(basenames).size !== basenames.length) {
    errors.push("parent externalEvidence basenames must be unique");
  }
  const runnerCopy = entries.find((entry) => entry?.role === "external_runner_copy");
  if (runnerCopy?.sha256 !== bundle.externalRunner?.sha256) {
    errors.push("parent external runner copy digest differs from the typed runner reference");
  }
  if (Array.isArray(bindings.requiredExternalEvidence)
    && canonicalJsonV2(entries) !== canonicalJsonV2(bindings.requiredExternalEvidence)) {
    errors.push("parent externalEvidence differs from the caller-required set");
  }
}

function validateBaselineArchiveReference(reference, subject, errors) {
  if (!plainObject(reference)
    || !exactKeys(reference, BASELINE_ARCHIVE_REFERENCE_KEYS)
    || reference.path !== CONTINUATION_V2_BASELINE_ARCHIVE_PATH
    || !sha256DigestV2(reference.digest)
    || !sha256DigestV2(reference.entrySetDigest)) {
    errors.push(`${subject} reference is invalid`);
  }
}

function validatePathSha(reference, keys, subject, errors, digestKey) {
  if (!plainObject(reference) || !exactKeys(reference, keys)
    || !repositoryPathV2(reference.path)
    || !sha256DigestV2(reference[digestKey])) {
    errors.push(`${subject} reference is invalid`);
  }
}

function validateTimestampAtOrBefore(value, verifierNow, subject, errors) {
  if (!Number.isFinite(verifierNow)) {
    errors.push(`${subject} requires one caller-supplied verifierNow`);
    return null;
  }
  const timestamp = parseIso(value);
  if (timestamp === null) {
    errors.push(`${subject} must be a canonical ISO timestamp`);
    return null;
  }
  if (timestamp > verifierNow) {
    errors.push(`${subject} must not be in the future`);
  }
  return timestamp;
}

function parseIso(value) {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    return null;
  }
  return timestamp;
}

function orderedSubset(values, orderedUniverse) {
  if (!Array.isArray(values) || values.length === 0
    || new Set(values).size !== values.length
    || values.some((value) => !orderedUniverse.includes(value))) {
    return false;
  }
  return sameOrderedStrings(values,
    orderedUniverse.filter((value) => values.includes(value)));
}

function validateSortedUnique(values, subject, errors) {
  if (values.some((value) => !nonEmpty(value))
    || new Set(values).size !== values.length
    || !sameOrderedStrings(values, values.slice().sort())) {
    errors.push(`${subject} must be non-empty, unique, and sorted`);
  }
}

function validateAnchoredUniqueIds(values, anchoredIds, subject, errors) {
  if (values.some((value) => !nonEmpty(value))
    || new Set(values).size !== values.length) {
    errors.push(`${subject} must be non-empty and unique`);
  }
  if (!sameOrderedStrings(values, anchoredIds)) {
    errors.push(`${subject} must match the anchored order`);
  }
}

function validateAnchoredRosterIds(values, subject, errors) {
  if (values.some((value) => !nonEmpty(value))
    || new Set(values).size !== values.length) {
    errors.push(`${subject} must be non-empty and unique`);
  }
}

function lookupDigest(collection, key) {
  if (collection instanceof Map) return collection.get(key);
  return plainObject(collection) ? collection[key] : undefined;
}

function sameMap(left, right) {
  if (left.size !== right.size) return false;
  for (const [key, value] of left) {
    if (right.get(key) !== value) return false;
  }
  return true;
}

function sameStringSet(left, right) {
  return left.length === right.length
    && left.every((value) => right.includes(value));
}

function sameOrderedStrings(left, right) {
  return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function hashWithoutKey(value, key) {
  const copy = { ...value };
  delete copy[key];
  return safeHash(copy);
}

function safeHash(value) {
  try {
    return hashCanonicalV2(value);
  } catch {
    return null;
  }
}

function safeCanonicalJson(value) {
  try {
    return canonicalJsonV2(value);
  } catch {
    return null;
  }
}

function exactKeys(value, keys) {
  return plainObject(value)
    && sameOrderedStrings(Object.keys(value).sort(), keys.slice().sort());
}

function plainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function stringArray(value, allowEmpty = false) {
  return Array.isArray(value) && (allowEmpty || value.length > 0)
    && value.every((entry) => nonEmpty(entry));
}

export function repositoryPathV2(value) {
  if (!nonEmpty(value) || path.isAbsolute(value) || value.includes("\\")
    || value.normalize("NFC") !== value) {
    return false;
  }
  const normalized = path.posix.normalize(value);
  return normalized === value && normalized !== "." && normalized !== ".."
    && !normalized.startsWith("../");
}

export function sha256DigestV2(value) {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
}

function unique(values) {
  return [...new Set(values)];
}

// Stable export names consumed by the v2 checker/freezer/runner. The suffixed
// implementations remain exported for explicit versioned unit tests.
export const canonicalJson = canonicalJsonV2;
export const hashCanonical = hashCanonicalV2;
export const sha256Bytes = sha256BytesV2;
export const stableWorkstreamDefinition = stableWorkstreamDefinitionV2;
export const stableProgramRootDefinition = stableProgramRootDefinitionV2;
export const stableFeatureDefinition = stableFeatureDefinitionV2;
export const stableHistoricalFeatureDefinition =
  stableHistoricalFeatureDefinitionV2;
export const validateReviewSnapshotV2 = validateContinuationReviewSnapshotV2;
export const validateReviewReceiptV2 = validateContinuationReviewReceiptV2;
export const validateReviewSetV2 = validateContinuationReviewSetV2;
export const validateClosureManifestV2 = validateContinuationClosureManifestV2;
export const validateExternalAttestationV2 =
  validateContinuationExternalAttestationV2;
export const validateExternalAnchorV2 = validateContinuationExternalAnchorV2;
