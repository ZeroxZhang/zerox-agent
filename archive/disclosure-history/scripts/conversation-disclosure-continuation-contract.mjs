import { createHash } from "node:crypto";
import path from "node:path";

export const CONTINUATION_POLICY_KIND =
  "conversation-disclosure-continuation-policy";
export const CONTINUATION_REVIEW_SNAPSHOT_KIND =
  "conversation-disclosure-continuation-review-snapshot";
export const CONTINUATION_REVIEW_RECEIPT_KIND =
  "conversation-disclosure-continuation-review-receipt";
export const CONTINUATION_CLOSURE_MANIFEST_KIND =
  "conversation-disclosure-continuation-closure-manifest";
export const CONTINUATION_EXTERNAL_ATTESTATION_KIND =
  "conversation-disclosure-continuation-external-attestation";
export const CONTINUATION_EXTERNAL_ANCHOR_KIND =
  "conversation-disclosure-continuation-external-anchor";
export const CONTINUATION_ALGORITHM = "sha256-canonical-json-v1";
export const CONTINUATION_POLICY_ID = "CD03A-round1-P108-admission";
export const CONTINUATION_WORKSTREAM_ID = "CD03A";
export const CONTINUATION_FEATURE_ID =
  "P107A-conversation-disclosure-successor-admission";
export const CONTINUATION_ROUND = 1;
export const SUCCESSOR_WORKSTREAM_ID = "CD04";
export const SUCCESSOR_FEATURE_ID =
  "P108-conversation-disclosure-evidence-foundation";
export const BASE_WORKSTREAM_ID = "CD03";
export const BASE_FEATURE_ID =
  "P107-conversation-disclosure-domain-adapters";
export const BASE_ROUND = 23;
export const BASE_SNAPSHOT_DIGEST =
  "sha256:e1a5300d6015543e0a6a8e8f09f2a13fcb955111b87c08545e0f882bb786796b";
export const BASE_EXTERNAL_ANCHOR_DIGEST =
  "sha256:e81f0afb3d10b12976b74d1499870b837595ffbc3b452c7f1f78fff67be8f102";
export const CONTINUATION_STATUS_PENDING =
  "review_passed_pending_external_anchor";
export const CONTINUATION_STATUS_ATTESTED = "externally_attested";
export const CONTINUATION_HEAD_KIND = "successor-admission";
export const REQUIRED_CONTINUATION_REVIEW_LANES = Object.freeze([
  "contract",
  "runtime",
  "governance",
]);

export const REQUIRED_CONTINUATION_EXECUTABLES = Object.freeze({
  checker: "scripts/check-conversation-disclosure-continuation.mjs",
  contract: "scripts/conversation-disclosure-continuation-contract.mjs",
  freezer: "scripts/freeze-conversation-disclosure-continuation.mjs",
  runner: "scripts/verify-conversation-disclosure-continuation.mjs",
});

export const REQUIRED_CONTINUATION_CANDIDATES = Object.freeze({
  checker: "scripts/check-conversation-disclosure-continuation.mjs",
  harness: "scripts/check-harness-state.mjs",
});

export const REQUIRED_HASHED_TRUST_ROOT_PATHS = Object.freeze([
  "package.json",
  "scripts/check-conversation-disclosure-continuation.mjs",
  "scripts/check-conversation-disclosure-program.mjs",
  "scripts/check-harness-state.mjs",
  "scripts/conversation-disclosure-continuation-contract.mjs",
  "scripts/conversation-disclosure-review-contract.mjs",
  "scripts/freeze-conversation-disclosure-continuation.mjs",
  "scripts/freeze-conversation-disclosure-review.mjs",
  "scripts/verify-conversation-disclosure-closure.mjs",
  "scripts/verify-conversation-disclosure-continuation.mjs",
]);

export const REQUIRED_TRUST_ROOT_DENYLIST = Object.freeze([
  ".zerox/conversation-disclosure-program.json",
  ".zerox/feature_list.json",
  ".zerox/verification/conversation-disclosure/CD03-round23-closure-manifest.json",
  ".zerox/verification/conversation-disclosure/CD03-round23-contract-review.json",
  ".zerox/verification/conversation-disclosure/CD03-round23-external-attestation.json",
  ".zerox/verification/conversation-disclosure/CD03-round23-governance-review.json",
  ".zerox/verification/conversation-disclosure/CD03-round23-review-snapshot.json",
  ".zerox/verification/conversation-disclosure/CD03-round23-runtime-review.json",
  ".zerox/verification/conversation-disclosure/CD03A-round1-closure-manifest.json",
  ".zerox/verification/conversation-disclosure/CD03A-round1-contract-review.json",
  ".zerox/verification/conversation-disclosure/CD03A-round1-external-attestation.json",
  ".zerox/verification/conversation-disclosure/CD03A-round1-governance-review.json",
  ".zerox/verification/conversation-disclosure/CD03A-round1-review-snapshot.json",
  ".zerox/verification/conversation-disclosure/CD03A-round1-runtime-review.json",
  ".zerox/verification/conversation-disclosure/CD03A-successor-evolution-policy.json",
  ...REQUIRED_HASHED_TRUST_ROOT_PATHS,
].sort());

const POLICY_KEYS = Object.freeze([
  "algorithm",
  "continuationExecutables",
  "digest",
  "governanceTransitions",
  "kind",
  "parent",
  "policyId",
  "programId",
  "reviewSnapshot",
  "schemaVersion",
  "status",
  "successor",
  "trustRoots",
]);
const POLICY_PARENT_KEYS = Object.freeze([
  "externalAnchorDigest",
  "featureId",
  "round",
  "snapshotDigest",
  "snapshotPath",
  "workstreamId",
]);
const POLICY_SUCCESSOR_KEYS = Object.freeze([
  "authorizedDriftPaths",
  "featureDefinition",
  "featureDefinitionDigest",
  "featureId",
  "workstreamDefinition",
  "workstreamDefinitionDigest",
  "workstreamId",
]);
const AUTHORIZED_DRIFT_KEYS = Object.freeze([
  "baseSha256",
  "operation",
  "path",
]);
const TRUST_ROOT_KEYS = Object.freeze(["path", "sha256"]);
const GOVERNANCE_TRANSITION_KEYS = Object.freeze([
  "fromSha256",
  "kind",
  "path",
  "toSha256",
]);
const CONTINUATION_EXECUTABLE_KEYS = Object.freeze([
  "kind",
  "path",
  "sha256",
]);
const REVIEW_SNAPSHOT_REFERENCE_KEYS = Object.freeze(["path"]);
const WORKSTREAM_LIVE_KEYS = Object.freeze([
  "acceptanceScenarioIds",
  "architectureDecision",
  "architectureDecisionRequired",
  "completionArtifacts",
  "dependsOn",
  "featureId",
  "findings",
  "id",
  "rollback",
  "state",
  "title",
  "verification",
]);
const WORKSTREAM_STABLE_KEYS = Object.freeze(
  WORKSTREAM_LIVE_KEYS.filter((key) => key !== "state"),
);
const FEATURE_LIVE_KEYS = Object.freeze([
  "definitionOfDone",
  "files",
  "id",
  "priority",
  "status",
  "title",
  "verification",
]);
const FEATURE_STABLE_KEYS = Object.freeze(
  FEATURE_LIVE_KEYS.filter((key) => key !== "status"),
);

const SNAPSHOT_KEYS = Object.freeze([
  "algorithm",
  "baseExternalAnchorDigest",
  "baseSnapshotDigest",
  "digest",
  "featureFileSetDigest",
  "featureId",
  "files",
  "kind",
  "policyDigest",
  "programId",
  "round",
  "schemaVersion",
  "successorFeatureDefinitionDigest",
  "successorWorkstreamDefinitionDigest",
  "workstreamId",
]);
const SNAPSHOT_FILE_KEYS = Object.freeze(["path", "sha256"]);
const REVIEW_RECEIPT_KEYS = Object.freeze([
  "baseExternalAnchorDigest",
  "baseSnapshotDigest",
  "challenge",
  "completedAt",
  "featureId",
  "findingCounts",
  "findings",
  "kind",
  "lane",
  "policyDigest",
  "programId",
  "reviewAgentId",
  "reviewTaskPath",
  "round",
  "schemaVersion",
  "snapshotDigest",
  "snapshotFileCount",
  "transport",
  "validatorDigest",
  "verdict",
  "workstreamId",
]);
const FINDING_COUNTS_KEYS = Object.freeze(["critical", "major", "minor"]);
const FINDING_KEYS = Object.freeze(["evidence", "id", "severity", "summary"]);

const MANIFEST_KEYS = Object.freeze([
  "digest",
  "externalAttestation",
  "externalRunner",
  "featureId",
  "kind",
  "parent",
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
const MANIFEST_PARENT_KEYS = Object.freeze([
  "externalAnchorDigest",
  "snapshotDigest",
]);
const PATH_DIGEST_REFERENCE_KEYS = Object.freeze(["digest", "path"]);
const PATH_SHA_REFERENCE_KEYS = Object.freeze(["path", "sha256"]);
const RECEIPT_REFERENCE_KEYS = Object.freeze([
  "canonicalDigest",
  "lane",
  "path",
]);
const ATTESTATION_REFERENCE_KEYS = Object.freeze([
  "canonicalDigest",
  "path",
]);

const ATTESTATION_KEYS = Object.freeze([
  "baseExternalAnchorDigest",
  "baseSnapshotDigest",
  "candidateResults",
  "completedAt",
  "digest",
  "kind",
  "pendingManifestDigest",
  "policyDigest",
  "repositoryRealpath",
  "reviewReceiptDigests",
  "runnerDigest",
  "schemaVersion",
  "snapshotDigest",
  "status",
  "subjectIdentityAssurance",
  "trustLevel",
  "validatorDigest",
]);
const ATTESTATION_RECEIPT_KEYS = Object.freeze([
  "canonicalDigest",
  "lane",
]);
const CANDIDATE_RESULT_KEYS = Object.freeze([
  "kind",
  "path",
  "receipt",
  "receiptDigest",
  "status",
  "stderrDigest",
  "stdoutDigest",
]);
const CANDIDATE_RECEIPT_KEYS = Object.freeze([
  "baseExternalAnchorDigest",
  "baseSnapshotDigest",
  "kind",
  "policyDigest",
  "snapshotDigest",
  "status",
]);

const EXTERNAL_ANCHOR_KEYS = Object.freeze([
  "attestationDigest",
  "baseExternalAnchorDigest",
  "baseSnapshotDigest",
  "completedAt",
  "digest",
  "head",
  "kind",
  "policyDigest",
  "repositoryRealpath",
  "reviewReceipts",
  "runnerDigest",
  "schemaVersion",
  "snapshotDigest",
  "subjectIdentityAssurance",
  "trustLevel",
  "validatorDigest",
]);
const EXTERNAL_ANCHOR_HEAD_KEYS = Object.freeze([
  "featureId",
  "kind",
  "snapshotDigest",
  "status",
  "successorFeatureDefinitionDigest",
  "successorWorkstreamDefinitionDigest",
  "workstreamId",
]);
const EXTERNAL_ANCHOR_RECEIPT_KEYS = Object.freeze([
  "canonicalDigest",
  "challenge",
  "lane",
]);

const REQUIRED_GOVERNANCE_TRANSITIONS = Object.freeze({
  "package.json": "package-structure-migration",
  "scripts/check-harness-state.mjs": "harness-delegation-migration",
});
const REQUIRED_REVIEW_SNAPSHOT_PATH =
  ".zerox/verification/conversation-disclosure/CD03A-round1-review-snapshot.json";
const REQUIRED_POLICY_PATH =
  ".zerox/verification/conversation-disclosure/CD03A-successor-evolution-policy.json";
const REQUIRED_ATTESTATION_PATH =
  ".zerox/verification/conversation-disclosure/CD03A-round1-external-attestation.json";

export function canonicalJson(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
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
        `${JSON.stringify(key)}:${canonicalJson(value[key])}`
      ).join(",")}}`;
    }
    default:
      throw new TypeError(`Canonical JSON does not support ${typeof value}.`);
  }
}

export function sha256Bytes(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function hashCanonical(value) {
  return sha256Bytes(canonicalJson(value));
}

export function withCanonicalDigest(value) {
  if (!plainObject(value)) {
    throw new TypeError("Canonical digest input must be a plain object.");
  }
  const withoutDigest = { ...value };
  delete withoutDigest.digest;
  return { ...withoutDigest, digest: hashCanonical(withoutDigest) };
}

export function stableWorkstreamDefinition(workstream) {
  if (!plainObject(workstream) || !exactKeys(workstream, WORKSTREAM_LIVE_KEYS)) {
    throw new TypeError("CD04 workstream must contain the exact live definition keys.");
  }
  const stable = { ...workstream };
  delete stable.state;
  const errors = validateStableWorkstreamDefinition(stable);
  if (errors.length > 0) {
    throw new TypeError(errors.join("; "));
  }
  return stable;
}

export function stableFeatureDefinition(feature) {
  if (!plainObject(feature) || !exactKeys(feature, FEATURE_LIVE_KEYS)) {
    throw new TypeError("P108 Feature must contain the exact live definition keys.");
  }
  const stable = { ...feature };
  delete stable.status;
  const errors = validateStableFeatureDefinition(stable);
  if (errors.length > 0) {
    throw new TypeError(errors.join("; "));
  }
  return stable;
}

export function validateContinuationPolicy(policy, bindings = {}) {
  const errors = [];
  if (!plainObject(policy) || !exactKeys(policy, POLICY_KEYS)) {
    return ["continuation policy must contain the exact v1 keys"];
  }
  if (policy.schemaVersion !== 1
    || policy.kind !== CONTINUATION_POLICY_KIND
    || policy.algorithm !== CONTINUATION_ALGORITHM
    || policy.policyId !== CONTINUATION_POLICY_ID
    || policy.status !== "frozen") {
    errors.push("continuation policy identity/status is invalid");
  }
  if (!nonEmpty(policy.programId)) {
    errors.push("continuation policy programId is required");
  }
  validatePolicyParent(policy.parent, errors);
  validatePolicySuccessor(policy.successor, errors);
  validateTrustRoots(policy.trustRoots, errors);
  validateGovernanceTransitions(policy.governanceTransitions, errors);
  validateContinuationExecutables(policy.continuationExecutables, errors);
  validatePolicyHashConsistency(policy, errors);
  if (!plainObject(policy.reviewSnapshot)
    || !exactKeys(policy.reviewSnapshot, REVIEW_SNAPSHOT_REFERENCE_KEYS)
    || policy.reviewSnapshot.path !== REQUIRED_REVIEW_SNAPSHOT_PATH) {
    errors.push("continuation policy reviewSnapshot reference is invalid");
  }
  validateOwnDigest(policy, "continuation policy", errors);

  const {
    baseAnchor,
    expectedDigest,
    expectedFeatureDefinitionDigest,
    expectedProgramId,
    expectedWorkstreamDefinitionDigest,
    feature,
    workstream,
  } = bindings;
  if (expectedProgramId !== undefined && policy.programId !== expectedProgramId) {
    errors.push("continuation policy programId does not match the caller pin");
  }
  if (expectedDigest !== undefined && policy.digest !== expectedDigest) {
    errors.push("continuation policy digest does not match the caller pin");
  }
  if (expectedFeatureDefinitionDigest !== undefined
    && policy.successor?.featureDefinitionDigest !== expectedFeatureDefinitionDigest) {
    errors.push("P108 Feature definition digest does not match the caller pin");
  }
  if (expectedWorkstreamDefinitionDigest !== undefined
    && policy.successor?.workstreamDefinitionDigest
      !== expectedWorkstreamDefinitionDigest) {
    errors.push("CD04 workstream definition digest does not match the caller pin");
  }
  if (plainObject(baseAnchor)) {
    if (baseAnchor.digest !== policy.parent?.externalAnchorDigest) {
      errors.push("continuation policy parent anchor digest is stale");
    }
    if (baseAnchor.snapshotDigest !== policy.parent?.snapshotDigest) {
      errors.push("continuation policy parent snapshot digest is stale");
    }
  }
  if (workstream !== undefined) {
    try {
      const stable = stableWorkstreamDefinition(workstream);
      if (hashCanonical(stable) !== policy.successor?.workstreamDefinitionDigest
        || canonicalJson(stable)
          !== canonicalJson(policy.successor?.workstreamDefinition)) {
        errors.push("live CD04 definition does not match the frozen policy");
      }
    } catch (error) {
      errors.push(`live CD04 definition is invalid: ${error.message}`);
    }
  }
  if (feature !== undefined) {
    try {
      const stable = stableFeatureDefinition(feature);
      if (hashCanonical(stable) !== policy.successor?.featureDefinitionDigest
        || canonicalJson(stable) !== canonicalJson(policy.successor?.featureDefinition)) {
        errors.push("live P108 Feature definition does not match the frozen policy");
      }
    } catch (error) {
      errors.push(`live P108 Feature definition is invalid: ${error.message}`);
    }
  }
  return errors;
}

export function validateContinuationReviewSnapshot(snapshot, policy) {
  const errors = [];
  if (!plainObject(snapshot) || !exactKeys(snapshot, SNAPSHOT_KEYS)) {
    return ["continuation review snapshot must contain the exact v1 keys"];
  }
  if (snapshot.schemaVersion !== 1
    || snapshot.kind !== CONTINUATION_REVIEW_SNAPSHOT_KIND
    || snapshot.algorithm !== CONTINUATION_ALGORITHM) {
    errors.push("continuation review snapshot identity is invalid");
  }
  validateContinuationIdentity(snapshot, "continuation review snapshot", errors);
  for (const key of [
    "baseExternalAnchorDigest",
    "baseSnapshotDigest",
    "featureFileSetDigest",
    "policyDigest",
    "successorFeatureDefinitionDigest",
    "successorWorkstreamDefinitionDigest",
    "digest",
  ]) {
    if (!sha256Digest(snapshot[key])) {
      errors.push(`continuation review snapshot ${key} must be a SHA-256 digest`);
    }
  }
  validateSnapshotFiles(snapshot.files, errors);
  validateOwnDigest(snapshot, "continuation review snapshot", errors);
  if (plainObject(policy)) {
    validateSnapshotPolicyBindings(snapshot, policy, errors);
  }
  return errors;
}

export function validateContinuationReviewReceipt(receipt, snapshot, policy) {
  const errors = [];
  if (!plainObject(receipt) || !exactKeys(receipt, REVIEW_RECEIPT_KEYS)) {
    return ["continuation review receipt must contain the exact v1 keys"];
  }
  if (receipt.schemaVersion !== 1
    || receipt.kind !== CONTINUATION_REVIEW_RECEIPT_KIND) {
    errors.push("continuation review receipt identity is invalid");
  }
  validateContinuationIdentity(receipt, "continuation review receipt", errors);
  if (!REQUIRED_CONTINUATION_REVIEW_LANES.includes(receipt.lane)) {
    errors.push("continuation review receipt lane is invalid");
  }
  if (receipt.transport !== "codex-collaboration") {
    errors.push("continuation review receipt transport must be codex-collaboration");
  }
  if (!nonEmpty(receipt.reviewTaskPath) || !nonEmpty(receipt.reviewAgentId)) {
    errors.push("continuation review receipt task and agent identity are required");
  }
  for (const key of [
    "baseExternalAnchorDigest",
    "baseSnapshotDigest",
    "challenge",
    "policyDigest",
    "snapshotDigest",
    "validatorDigest",
  ]) {
    if (!sha256Digest(receipt[key])) {
      errors.push(`continuation review receipt ${key} must be a SHA-256 digest`);
    }
  }
  if (!Number.isInteger(receipt.snapshotFileCount)
    || receipt.snapshotFileCount <= 0) {
    errors.push("continuation review receipt snapshotFileCount must be positive");
  }
  if (receipt.verdict !== "passed" && receipt.verdict !== "failed") {
    errors.push("continuation review receipt verdict is invalid");
  }
  validateFindings(receipt, errors);
  if (!isoTimestamp(receipt.completedAt)) {
    errors.push("continuation review receipt completedAt must be an exact ISO timestamp");
  }
  if (plainObject(snapshot)) {
    validateReceiptSnapshotBindings(receipt, snapshot, errors);
  }
  if (plainObject(policy)) {
    validateReceiptPolicyBindings(receipt, policy, errors);
  }
  return errors;
}

export function validateContinuationReviewSet(receipts, snapshot, policy) {
  const errors = [];
  if (!Array.isArray(receipts)
    || receipts.length !== REQUIRED_CONTINUATION_REVIEW_LANES.length) {
    return ["continuation review set must contain exactly three receipts"];
  }
  const lanes = new Set();
  const tasks = new Set();
  const agents = new Set();
  const challenges = new Set();
  for (const receipt of receipts) {
    errors.push(...validateContinuationReviewReceipt(receipt, snapshot, policy));
    lanes.add(receipt?.lane);
    tasks.add(receipt?.reviewTaskPath);
    agents.add(receipt?.reviewAgentId);
    challenges.add(receipt?.challenge);
    if (receipt?.verdict !== "passed"
      || Object.values(receipt?.findingCounts ?? {}).some((count) => count !== 0)) {
      errors.push(
        `continuation review receipt ${receipt?.lane ?? "unknown"} must pass with zero findings`,
      );
    }
  }
  if (!sameStringSet(REQUIRED_CONTINUATION_REVIEW_LANES, [...lanes])) {
    errors.push("continuation review lanes must be unique and complete");
  }
  if (tasks.size !== receipts.length || agents.size !== receipts.length
    || challenges.size !== receipts.length) {
    errors.push("continuation review task, agent, and challenge identities must be unique");
  }
  return errors;
}

export function validateContinuationClosureManifest(manifest, bindings = {}) {
  const errors = [];
  if (!plainObject(manifest) || !exactKeys(manifest, MANIFEST_KEYS)) {
    return ["continuation closure manifest must contain the exact v1 keys"];
  }
  if (manifest.schemaVersion !== 1
    || manifest.kind !== CONTINUATION_CLOSURE_MANIFEST_KIND) {
    errors.push("continuation closure manifest identity is invalid");
  }
  validateContinuationIdentity(manifest, "continuation closure manifest", errors);
  if (manifest.status !== CONTINUATION_STATUS_PENDING
    && manifest.status !== CONTINUATION_STATUS_ATTESTED) {
    errors.push("continuation closure manifest status is invalid");
  }
  if (!plainObject(manifest.parent)
    || !exactKeys(manifest.parent, MANIFEST_PARENT_KEYS)
    || manifest.parent.externalAnchorDigest !== BASE_EXTERNAL_ANCHOR_DIGEST
    || manifest.parent.snapshotDigest !== BASE_SNAPSHOT_DIGEST) {
    errors.push("continuation closure manifest parent is invalid");
  }
  validatePathDigestReference(manifest.policy, REQUIRED_POLICY_PATH,
    "continuation closure manifest policy", errors);
  validatePathDigestReference(manifest.snapshot, REQUIRED_REVIEW_SNAPSHOT_PATH,
    "continuation closure manifest snapshot", errors);
  validateReceiptReferences(manifest.reviewReceipts, errors);
  validatePathShaReference(
    manifest.validator,
    REQUIRED_CONTINUATION_EXECUTABLES.checker,
    "continuation closure manifest validator",
    errors,
  );
  validatePathShaReference(
    manifest.externalRunner,
    REQUIRED_CONTINUATION_EXECUTABLES.runner,
    "continuation closure manifest externalRunner",
    errors,
  );
  if (!plainObject(manifest.externalAttestation)
    || !exactKeys(manifest.externalAttestation, ATTESTATION_REFERENCE_KEYS)
    || manifest.externalAttestation.path !== REQUIRED_ATTESTATION_PATH) {
    errors.push("continuation closure manifest externalAttestation is invalid");
  } else if (manifest.status === CONTINUATION_STATUS_PENDING
    && manifest.externalAttestation.canonicalDigest !== null) {
    errors.push("pending continuation manifest must not claim an attestation digest");
  } else if (manifest.status === CONTINUATION_STATUS_ATTESTED
    && !sha256Digest(manifest.externalAttestation.canonicalDigest)) {
    errors.push("attested continuation manifest requires an attestation digest");
  }
  validateOwnDigest(manifest, "continuation closure manifest", errors);

  const { policy, snapshot } = bindings;
  if (plainObject(policy)) {
    if (manifest.programId !== policy.programId
      || manifest.policy?.digest !== policy.digest) {
      errors.push("continuation closure manifest policy binding is stale");
    }
    const checkerDigest = executableDigest(policy, "checker");
    const runnerDigest = executableDigest(policy, "runner");
    if (manifest.validator?.sha256 !== checkerDigest) {
      errors.push("continuation closure manifest validator digest is stale");
    }
    if (manifest.externalRunner?.sha256 !== runnerDigest) {
      errors.push("continuation closure manifest runner digest is stale");
    }
  }
  if (plainObject(snapshot) && manifest.snapshot?.digest !== snapshot.digest) {
    errors.push("continuation closure manifest snapshot digest is stale");
  }
  return errors;
}

export function toPendingContinuationManifest(manifest) {
  if (!plainObject(manifest)) {
    throw new TypeError("Continuation manifest must be a plain object.");
  }
  const pending = {
    ...manifest,
    status: CONTINUATION_STATUS_PENDING,
    externalAttestation: {
      ...manifest.externalAttestation,
      canonicalDigest: null,
    },
  };
  delete pending.digest;
  return { ...pending, digest: hashCanonical(pending) };
}

export function validateContinuationExternalAttestation(
  attestation,
  bindings = {},
) {
  const errors = [];
  if (!plainObject(attestation) || !exactKeys(attestation, ATTESTATION_KEYS)) {
    return ["continuation external attestation must contain the exact v1 keys"];
  }
  if (attestation.schemaVersion !== 1
    || attestation.kind !== CONTINUATION_EXTERNAL_ATTESTATION_KIND
    || attestation.status !== "passed") {
    errors.push("continuation external attestation identity/status is invalid");
  }
  if (attestation.trustLevel !== "external-anchor-consistency"
    || attestation.subjectIdentityAssurance !== "not-signed") {
    errors.push("continuation attestation must declare unsigned consistency assurance");
  }
  if (!path.isAbsolute(attestation.repositoryRealpath)) {
    errors.push("continuation attestation repositoryRealpath must be absolute");
  }
  for (const key of [
    "baseExternalAnchorDigest",
    "baseSnapshotDigest",
    "pendingManifestDigest",
    "policyDigest",
    "runnerDigest",
    "snapshotDigest",
    "validatorDigest",
    "digest",
  ]) {
    if (!sha256Digest(attestation[key])) {
      errors.push(`continuation external attestation ${key} must be a SHA-256 digest`);
    }
  }
  if (attestation.baseExternalAnchorDigest !== BASE_EXTERNAL_ANCHOR_DIGEST
    || attestation.baseSnapshotDigest !== BASE_SNAPSHOT_DIGEST) {
    errors.push("continuation external attestation parent binding is invalid");
  }
  if (!isoTimestamp(attestation.completedAt)) {
    errors.push("continuation attestation completedAt must be an exact ISO timestamp");
  }
  validateAttestationReceiptDigests(attestation.reviewReceiptDigests, errors);
  validateCandidateResults(attestation.candidateResults, attestation, errors);
  validateOwnDigest(attestation, "continuation external attestation", errors);

  const {
    manifest,
    policy,
    receipts,
    repositoryRealpath,
    runnerDigest,
    snapshot,
    validatorDigest,
  } = bindings;
  if (plainObject(manifest)) {
    if (manifest.status !== CONTINUATION_STATUS_ATTESTED
      || manifest.externalAttestation?.canonicalDigest !== attestation.digest) {
      errors.push("continuation manifest attestation binding is stale");
    }
    const pending = toPendingContinuationManifest(manifest);
    if (pending.digest !== attestation.pendingManifestDigest) {
      errors.push("continuation attestation pending manifest digest is stale");
    }
    compareLaneDigests(
      attestation.reviewReceiptDigests,
      manifest.reviewReceipts,
      "continuation attestation manifest receipt",
      errors,
    );
  }
  if (plainObject(policy) && attestation.policyDigest !== policy.digest) {
    errors.push("continuation attestation policy digest is stale");
  }
  if (plainObject(snapshot) && attestation.snapshotDigest !== snapshot.digest) {
    errors.push("continuation attestation snapshot digest is stale");
  }
  if (repositoryRealpath !== undefined
    && attestation.repositoryRealpath !== repositoryRealpath) {
    errors.push("continuation attestation repository realpath is stale");
  }
  if (runnerDigest !== undefined && attestation.runnerDigest !== runnerDigest) {
    errors.push("continuation attestation runner digest is stale");
  }
  if (validatorDigest !== undefined
    && attestation.validatorDigest !== validatorDigest) {
    errors.push("continuation attestation validator digest is stale");
  }
  bindReceiptDigestsAndTime(attestation, receipts, errors);
  return errors;
}

export function validateContinuationExternalAnchor(anchor, bindings = {}) {
  const errors = [];
  if (!plainObject(anchor) || !exactKeys(anchor, EXTERNAL_ANCHOR_KEYS)) {
    return ["continuation external anchor must contain the exact v1 keys"];
  }
  if (anchor.schemaVersion !== 1
    || anchor.kind !== CONTINUATION_EXTERNAL_ANCHOR_KIND) {
    errors.push("continuation external anchor identity is invalid");
  }
  if (anchor.trustLevel !== "external-caller-pinned-consistency"
    || anchor.subjectIdentityAssurance !== "not-signed") {
    errors.push("continuation anchor must declare unsigned caller-pinned assurance");
  }
  if (!path.isAbsolute(anchor.repositoryRealpath)) {
    errors.push("continuation anchor repositoryRealpath must be absolute");
  }
  for (const key of [
    "attestationDigest",
    "baseExternalAnchorDigest",
    "baseSnapshotDigest",
    "policyDigest",
    "runnerDigest",
    "snapshotDigest",
    "validatorDigest",
    "digest",
  ]) {
    if (!sha256Digest(anchor[key])) {
      errors.push(`continuation external anchor ${key} must be a SHA-256 digest`);
    }
  }
  if (anchor.baseExternalAnchorDigest !== BASE_EXTERNAL_ANCHOR_DIGEST
    || anchor.baseSnapshotDigest !== BASE_SNAPSHOT_DIGEST) {
    errors.push("continuation external anchor parent binding is invalid");
  }
  if (!isoTimestamp(anchor.completedAt)) {
    errors.push("continuation external anchor completedAt must be an exact ISO timestamp");
  }
  validateContinuationHead(anchor.head, anchor, errors);
  validateAnchorReceipts(anchor.reviewReceipts, errors);
  validateOwnDigest(anchor, "continuation external anchor", errors);

  const {
    attestation,
    expectedDigest,
    policy,
    receipts,
    repositoryRealpath,
    runnerDigest,
    snapshot,
    validatorDigest,
  } = bindings;
  if (expectedDigest !== undefined && anchor.digest !== expectedDigest) {
    errors.push("continuation external anchor digest does not match the caller pin");
  }
  if (plainObject(attestation)) {
    if (anchor.attestationDigest !== attestation.digest) {
      errors.push("continuation anchor attestation digest is stale");
    }
    if (anchor.completedAt !== attestation.completedAt) {
      errors.push("continuation anchor completedAt must exactly match the attestation");
    }
  }
  if (plainObject(policy)) {
    if (anchor.policyDigest !== policy.digest) {
      errors.push("continuation anchor policy digest is stale");
    }
    if (anchor.head?.successorWorkstreamDefinitionDigest
      !== policy.successor?.workstreamDefinitionDigest
      || anchor.head?.successorFeatureDefinitionDigest
        !== policy.successor?.featureDefinitionDigest) {
      errors.push("continuation anchor successor definition head is stale");
    }
  }
  if (plainObject(snapshot)) {
    if (anchor.snapshotDigest !== snapshot.digest
      || anchor.head?.snapshotDigest !== snapshot.digest) {
      errors.push("continuation anchor snapshot digest is stale");
    }
  }
  if (repositoryRealpath !== undefined
    && anchor.repositoryRealpath !== repositoryRealpath) {
    errors.push("continuation anchor repository realpath is stale");
  }
  if (runnerDigest !== undefined && anchor.runnerDigest !== runnerDigest) {
    errors.push("continuation anchor runner digest is stale");
  }
  if (validatorDigest !== undefined && anchor.validatorDigest !== validatorDigest) {
    errors.push("continuation anchor validator digest is stale");
  }
  bindAnchorReceiptsAndTime(anchor, receipts, errors);
  return errors;
}

export function repositoryPath(relativePath) {
  if (typeof relativePath !== "string" || !relativePath.trim()
    || path.isAbsolute(relativePath) || relativePath.includes("\\")) {
    return false;
  }
  const normalized = path.posix.normalize(relativePath);
  return normalized !== "."
    && normalized !== ".."
    && !normalized.startsWith("../")
    && normalized === relativePath;
}

export function sha256Digest(value) {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
}

export function isTrustRootPath(relativePath) {
  return REQUIRED_TRUST_ROOT_DENYLIST.includes(relativePath);
}

function validatePolicyParent(parent, errors) {
  if (!plainObject(parent) || !exactKeys(parent, POLICY_PARENT_KEYS)) {
    errors.push("continuation policy parent must contain the exact v1 keys");
    return;
  }
  if (parent.workstreamId !== BASE_WORKSTREAM_ID
    || parent.featureId !== BASE_FEATURE_ID
    || parent.round !== BASE_ROUND
    || parent.snapshotDigest !== BASE_SNAPSHOT_DIGEST
    || parent.externalAnchorDigest !== BASE_EXTERNAL_ANCHOR_DIGEST
    || parent.snapshotPath
      !== ".zerox/verification/conversation-disclosure/CD03-round23-review-snapshot.json") {
    errors.push("continuation policy parent does not bind the exact Round23 base");
  }
}

function validatePolicySuccessor(successor, errors) {
  if (!plainObject(successor) || !exactKeys(successor, POLICY_SUCCESSOR_KEYS)) {
    errors.push("continuation policy successor must contain the exact v1 keys");
    return;
  }
  if (successor.workstreamId !== SUCCESSOR_WORKSTREAM_ID
    || successor.featureId !== SUCCESSOR_FEATURE_ID) {
    errors.push("continuation policy successor identity is invalid");
  }
  const workstreamErrors = validateStableWorkstreamDefinition(
    successor.workstreamDefinition,
  );
  errors.push(...workstreamErrors);
  const featureErrors = validateStableFeatureDefinition(successor.featureDefinition);
  errors.push(...featureErrors);
  if (!sha256Digest(successor.workstreamDefinitionDigest)
    || successor.workstreamDefinitionDigest
      !== safeHashCanonical(successor.workstreamDefinition)) {
    errors.push("continuation policy CD04 definition digest is invalid or stale");
  }
  if (!sha256Digest(successor.featureDefinitionDigest)
    || successor.featureDefinitionDigest
      !== safeHashCanonical(successor.featureDefinition)) {
    errors.push("continuation policy P108 definition digest is invalid or stale");
  }
  validateAuthorizedDriftPaths(
    successor.authorizedDriftPaths,
    successor.featureDefinition,
    errors,
  );
}

function validateStableWorkstreamDefinition(definition) {
  const errors = [];
  if (!plainObject(definition) || !exactKeys(definition, WORKSTREAM_STABLE_KEYS)) {
    return ["CD04 stable workstream definition must contain the exact keys"];
  }
  if (definition.id !== SUCCESSOR_WORKSTREAM_ID
    || definition.featureId !== SUCCESSOR_FEATURE_ID
    || definition.dependsOn?.length !== 1
    || definition.dependsOn[0] !== CONTINUATION_WORKSTREAM_ID) {
    errors.push("CD04 stable workstream identity/dependency is invalid");
  }
  if (!nonEmpty(definition.title) || typeof definition.architectureDecisionRequired !== "boolean"
    || !repositoryPath(definition.architectureDecision)
    || !nonEmpty(definition.rollback)) {
    errors.push("CD04 stable workstream scalar fields are invalid");
  }
  for (const key of [
    "acceptanceScenarioIds",
    "completionArtifacts",
    "findings",
    "verification",
  ]) {
    if (!stringArray(definition[key])) {
      errors.push(`CD04 stable workstream ${key} must be a non-empty string array`);
    }
  }
  if (Array.isArray(definition.completionArtifacts)
    && definition.completionArtifacts.some((entry) => !repositoryPath(entry))) {
    errors.push("CD04 stable workstream completionArtifacts contain an invalid path");
  }
  return errors;
}

function validateStableFeatureDefinition(definition) {
  const errors = [];
  if (!plainObject(definition) || !exactKeys(definition, FEATURE_STABLE_KEYS)) {
    return ["P108 stable Feature definition must contain the exact keys"];
  }
  if (definition.id !== SUCCESSOR_FEATURE_ID
    || !Number.isInteger(definition.priority)
    || definition.priority <= 0
    || !nonEmpty(definition.title)) {
    errors.push("P108 stable Feature scalar identity is invalid");
  }
  for (const key of ["files", "definitionOfDone", "verification"]) {
    if (!stringArray(definition[key])) {
      errors.push(`P108 stable Feature ${key} must be a non-empty string array`);
    }
  }
  if (Array.isArray(definition.files)) {
    if (definition.files.some((entry) => !repositoryPath(entry))) {
      errors.push("P108 stable Feature files contain an invalid repository path");
    }
    if (new Set(definition.files).size !== definition.files.length) {
      errors.push("P108 stable Feature files must be unique");
    }
  }
  return errors;
}

function validateAuthorizedDriftPaths(entries, featureDefinition, errors) {
  if (!Array.isArray(entries) || entries.length === 0) {
    errors.push("continuation policy authorizedDriftPaths must be non-empty");
    return;
  }
  const paths = [];
  const featurePaths = new Set(featureDefinition?.files ?? []);
  for (const [index, entry] of entries.entries()) {
    if (!plainObject(entry) || !exactKeys(entry, AUTHORIZED_DRIFT_KEYS)) {
      errors.push(`authorizedDriftPaths[${index}] has invalid keys`);
      continue;
    }
    paths.push(entry.path);
    if (!repositoryPath(entry.path) || isTrustRootPath(entry.path)) {
      errors.push(`authorizedDriftPaths[${index}].path is invalid or trust-root denied`);
    }
    if (!featurePaths.has(entry.path)) {
      errors.push(`authorizedDriftPaths[${index}].path is outside frozen P108 files`);
    }
    if (entry.operation === "create") {
      if (entry.baseSha256 !== null) {
        errors.push(`authorizedDriftPaths[${index}] create must have null baseSha256`);
      }
    } else if (entry.operation === "modify") {
      if (!sha256Digest(entry.baseSha256)) {
        errors.push(`authorizedDriftPaths[${index}] modify requires baseSha256`);
      }
    } else {
      errors.push(`authorizedDriftPaths[${index}].operation is invalid`);
    }
  }
  if (new Set(paths).size !== paths.length) {
    errors.push("authorizedDriftPaths paths must be unique");
  }
  if (!sameOrderedStrings(paths, paths.slice().sort())) {
    errors.push("authorizedDriftPaths paths must be sorted");
  }
}

function validateTrustRoots(entries, errors) {
  if (!Array.isArray(entries)
    || entries.length !== REQUIRED_HASHED_TRUST_ROOT_PATHS.length) {
    errors.push("continuation policy trustRoots must contain every required trust root");
    return;
  }
  const paths = [];
  for (const [index, entry] of entries.entries()) {
    if (!plainObject(entry) || !exactKeys(entry, TRUST_ROOT_KEYS)) {
      errors.push(`continuation policy trustRoots[${index}] has invalid keys`);
      continue;
    }
    paths.push(entry.path);
    if (!sha256Digest(entry.sha256)) {
      errors.push(`continuation policy trustRoots[${index}].sha256 is invalid`);
    }
  }
  if (!sameOrderedStrings(paths, REQUIRED_HASHED_TRUST_ROOT_PATHS)) {
    errors.push("continuation policy trustRoots paths are not the exact denylisted set");
  }
}

function validateGovernanceTransitions(entries, errors) {
  const requiredPaths = Object.keys(REQUIRED_GOVERNANCE_TRANSITIONS).sort();
  if (!Array.isArray(entries) || entries.length !== requiredPaths.length) {
    errors.push("continuation policy must contain exactly package and harness transitions");
    return;
  }
  const paths = [];
  for (const [index, entry] of entries.entries()) {
    if (!plainObject(entry) || !exactKeys(entry, GOVERNANCE_TRANSITION_KEYS)) {
      errors.push(`governanceTransitions[${index}] has invalid keys`);
      continue;
    }
    paths.push(entry.path);
    if (entry.kind !== REQUIRED_GOVERNANCE_TRANSITIONS[entry.path]
      || !sha256Digest(entry.fromSha256)
      || !sha256Digest(entry.toSha256)
      || entry.fromSha256 === entry.toSha256) {
      errors.push(`governanceTransitions[${index}] is invalid`);
    }
  }
  if (!sameOrderedStrings(paths, requiredPaths)) {
    errors.push("governance transition paths must be exact and sorted");
  }
}

function validateContinuationExecutables(entries, errors) {
  const kinds = Object.keys(REQUIRED_CONTINUATION_EXECUTABLES).sort();
  if (!Array.isArray(entries) || entries.length !== kinds.length) {
    errors.push("continuation policy must contain exactly four continuation executables");
    return;
  }
  const seenKinds = [];
  for (const [index, entry] of entries.entries()) {
    if (!plainObject(entry) || !exactKeys(entry, CONTINUATION_EXECUTABLE_KEYS)) {
      errors.push(`continuationExecutables[${index}] has invalid keys`);
      continue;
    }
    seenKinds.push(entry.kind);
    if (entry.path !== REQUIRED_CONTINUATION_EXECUTABLES[entry.kind]
      || !sha256Digest(entry.sha256)) {
      errors.push(`continuationExecutables[${index}] is invalid`);
    }
  }
  if (!sameOrderedStrings(seenKinds, kinds)) {
    errors.push("continuation executable kinds must be exact and sorted");
  }
}

function validatePolicyHashConsistency(policy, errors) {
  const trustRootDigests = new Map((policy.trustRoots ?? []).map(
    (entry) => [entry?.path, entry?.sha256],
  ));
  for (const entry of policy.continuationExecutables ?? []) {
    if (trustRootDigests.get(entry?.path) !== entry?.sha256) {
      errors.push(
        `continuation executable trust-root digest is inconsistent: ${entry?.path ?? "unknown"}`,
      );
    }
  }
  for (const entry of policy.governanceTransitions ?? []) {
    if (trustRootDigests.get(entry?.path) !== entry?.toSha256) {
      errors.push(
        `governance transition target trust-root digest is inconsistent: ${entry?.path ?? "unknown"}`,
      );
    }
  }
}

function validateSnapshotFiles(files, errors) {
  if (!Array.isArray(files) || files.length === 0) {
    errors.push("continuation review snapshot files must be non-empty");
    return;
  }
  const paths = [];
  for (const [index, entry] of files.entries()) {
    if (!plainObject(entry) || !exactKeys(entry, SNAPSHOT_FILE_KEYS)) {
      errors.push(`continuation review snapshot files[${index}] has invalid keys`);
      continue;
    }
    paths.push(entry.path);
    if (!repositoryPath(entry.path) || !sha256Digest(entry.sha256)) {
      errors.push(`continuation review snapshot files[${index}] is invalid`);
    }
  }
  if (new Set(paths).size !== paths.length) {
    errors.push("continuation review snapshot file paths must be unique");
  }
  if (!sameOrderedStrings(paths, paths.slice().sort())) {
    errors.push("continuation review snapshot file paths must be sorted");
  }
}

function validateSnapshotPolicyBindings(snapshot, policy, errors) {
  if (snapshot.programId !== policy.programId
    || snapshot.policyDigest !== policy.digest
    || snapshot.baseExternalAnchorDigest !== policy.parent?.externalAnchorDigest
    || snapshot.baseSnapshotDigest !== policy.parent?.snapshotDigest
    || snapshot.successorFeatureDefinitionDigest
      !== policy.successor?.featureDefinitionDigest
    || snapshot.successorWorkstreamDefinitionDigest
      !== policy.successor?.workstreamDefinitionDigest) {
    errors.push("continuation review snapshot policy/base/successor binding is stale");
  }
}

function validateFindings(receipt, errors) {
  if (!plainObject(receipt.findingCounts)
    || !exactKeys(receipt.findingCounts, FINDING_COUNTS_KEYS)
    || Object.values(receipt.findingCounts).some(
      (count) => !Number.isInteger(count) || count < 0,
    )) {
    errors.push("continuation review receipt findingCounts is invalid");
  }
  if (!Array.isArray(receipt.findings)) {
    errors.push("continuation review receipt findings must be an array");
    return;
  }
  const counts = { critical: 0, major: 0, minor: 0 };
  const ids = new Set();
  for (const [index, finding] of receipt.findings.entries()) {
    if (!plainObject(finding) || !exactKeys(finding, FINDING_KEYS)) {
      errors.push(`continuation review receipt findings[${index}] has invalid keys`);
      continue;
    }
    if (!nonEmpty(finding.id) || ids.has(finding.id)) {
      errors.push(`continuation review receipt findings[${index}].id is invalid`);
    }
    ids.add(finding.id);
    if (!Object.hasOwn(counts, finding.severity)) {
      errors.push(`continuation review receipt findings[${index}].severity is invalid`);
    } else {
      counts[finding.severity] += 1;
    }
    if (!nonEmpty(finding.summary) || !stringArray(finding.evidence, true)) {
      errors.push(`continuation review receipt findings[${index}] content is invalid`);
    }
  }
  if (plainObject(receipt.findingCounts)) {
    for (const severity of Object.keys(counts)) {
      if (receipt.findingCounts[severity] !== counts[severity]) {
        errors.push(`continuation review receipt ${severity} count is stale`);
      }
    }
  }
}

function validateReceiptSnapshotBindings(receipt, snapshot, errors) {
  for (const key of ["programId", "workstreamId", "featureId", "round"]) {
    if (receipt[key] !== snapshot[key]) {
      errors.push(`continuation review receipt ${key} must match the snapshot`);
    }
  }
  if (receipt.snapshotDigest !== snapshot.digest
    || receipt.snapshotFileCount !== snapshot.files?.length
    || receipt.baseExternalAnchorDigest !== snapshot.baseExternalAnchorDigest
    || receipt.baseSnapshotDigest !== snapshot.baseSnapshotDigest
    || receipt.policyDigest !== snapshot.policyDigest) {
    errors.push("continuation review receipt snapshot/base/policy binding is stale");
  }
}

function validateReceiptPolicyBindings(receipt, policy, errors) {
  if (receipt.programId !== policy.programId
    || receipt.policyDigest !== policy.digest
    || receipt.baseExternalAnchorDigest !== policy.parent?.externalAnchorDigest
    || receipt.baseSnapshotDigest !== policy.parent?.snapshotDigest
    || receipt.validatorDigest !== executableDigest(policy, "checker")) {
    errors.push("continuation review receipt policy/validator binding is stale");
  }
}

function validateReceiptReferences(entries, errors) {
  if (!Array.isArray(entries)
    || entries.length !== REQUIRED_CONTINUATION_REVIEW_LANES.length) {
    errors.push("continuation closure manifest must reference exactly three receipts");
    return;
  }
  validateLaneEntries(
    entries,
    RECEIPT_REFERENCE_KEYS,
    "continuation closure manifest review receipt",
    errors,
    (entry) => repositoryPath(entry.path) && sha256Digest(entry.canonicalDigest),
  );
}

function validateAttestationReceiptDigests(entries, errors) {
  if (!Array.isArray(entries)
    || entries.length !== REQUIRED_CONTINUATION_REVIEW_LANES.length) {
    errors.push("continuation attestation must bind exactly three receipt digests");
    return;
  }
  validateLaneEntries(
    entries,
    ATTESTATION_RECEIPT_KEYS,
    "continuation attestation review receipt digest",
    errors,
    (entry) => sha256Digest(entry.canonicalDigest),
  );
}

function validateCandidateResults(results, attestation, errors) {
  if (!Array.isArray(results)
    || results.length !== Object.keys(REQUIRED_CONTINUATION_CANDIDATES).length) {
    errors.push("continuation attestation requires checker and harness results");
    return;
  }
  const kinds = [];
  for (const [index, result] of results.entries()) {
    if (!plainObject(result) || !exactKeys(result, CANDIDATE_RESULT_KEYS)) {
      errors.push(`continuation candidateResults[${index}] has invalid keys`);
      continue;
    }
    kinds.push(result.kind);
    const expectedReceiptKind = result.kind === "checker"
      ? "cd03a-continuation-checker-receipt"
      : result.kind === "harness"
        ? "cd03a-continuation-harness-receipt"
        : undefined;
    if (!expectedReceiptKind
      || result.path !== REQUIRED_CONTINUATION_CANDIDATES[result.kind]
      || result.status !== "passed") {
      errors.push(`continuation candidateResults[${index}] identity/status is invalid`);
    }
    if (!plainObject(result.receipt)
      || !exactKeys(result.receipt, CANDIDATE_RECEIPT_KEYS)
      || result.receipt.kind !== expectedReceiptKind
      || result.receipt.status !== "passed"
      || result.receipt.baseExternalAnchorDigest
        !== attestation.baseExternalAnchorDigest
      || result.receipt.baseSnapshotDigest !== attestation.baseSnapshotDigest
      || result.receipt.policyDigest !== attestation.policyDigest
      || result.receipt.snapshotDigest !== attestation.snapshotDigest) {
      errors.push(`continuation candidateResults[${index}] receipt is invalid`);
    }
    if (!sha256Digest(result.receiptDigest)
      || (plainObject(result.receipt)
        && result.receiptDigest !== safeHashCanonical(result.receipt))
      || !sha256Digest(result.stdoutDigest)
      || !sha256Digest(result.stderrDigest)) {
      errors.push(`continuation candidateResults[${index}] digests are invalid`);
    }
  }
  if (!sameStringSet(Object.keys(REQUIRED_CONTINUATION_CANDIDATES), kinds)) {
    errors.push("continuation candidate result kinds must be checker and harness");
  }
}

function validateContinuationHead(head, anchor, errors) {
  if (!plainObject(head) || !exactKeys(head, EXTERNAL_ANCHOR_HEAD_KEYS)) {
    errors.push("continuation external anchor head has invalid keys");
    return;
  }
  if (head.kind !== CONTINUATION_HEAD_KIND
    || head.status !== CONTINUATION_STATUS_ATTESTED
    || head.workstreamId !== CONTINUATION_WORKSTREAM_ID
    || head.featureId !== CONTINUATION_FEATURE_ID
    || head.snapshotDigest !== anchor.snapshotDigest
    || !sha256Digest(head.successorFeatureDefinitionDigest)
    || !sha256Digest(head.successorWorkstreamDefinitionDigest)) {
    errors.push("continuation external anchor head is invalid");
  }
}

function validateAnchorReceipts(entries, errors) {
  if (!Array.isArray(entries)
    || entries.length !== REQUIRED_CONTINUATION_REVIEW_LANES.length) {
    errors.push("continuation anchor must bind exactly three review receipts");
    return;
  }
  validateLaneEntries(
    entries,
    EXTERNAL_ANCHOR_RECEIPT_KEYS,
    "continuation external anchor review receipt",
    errors,
    (entry) => sha256Digest(entry.canonicalDigest)
      && sha256Digest(entry.challenge),
  );
}

function compareLaneDigests(left, right, subject, errors) {
  const rightDigests = new Map((right ?? []).map(
    (entry) => [entry?.lane, entry?.canonicalDigest],
  ));
  for (const entry of left ?? []) {
    if (rightDigests.get(entry?.lane) !== entry?.canonicalDigest) {
      errors.push(`${subject} digest is stale: ${entry?.lane}`);
    }
  }
}

function bindReceiptDigestsAndTime(subject, receipts, errors) {
  if (!Array.isArray(receipts) || receipts.length === 0) return;
  const receiptDigests = new Map(receipts.map(
    (receipt) => [receipt?.lane, safeHashCanonical(receipt)],
  ));
  for (const entry of subject.reviewReceiptDigests ?? []) {
    if (receiptDigests.get(entry?.lane) !== entry?.canonicalDigest) {
      errors.push(`continuation attestation receipt binding is stale: ${entry?.lane}`);
    }
  }
  validateCompletionAfterReceipts(subject.completedAt, receipts,
    "continuation attestation", errors);
}

function bindAnchorReceiptsAndTime(anchor, receipts, errors) {
  if (!Array.isArray(receipts) || receipts.length === 0) return;
  const receiptBindings = new Map(receipts.map((receipt) => [receipt?.lane, {
    canonicalDigest: safeHashCanonical(receipt),
    challenge: receipt?.challenge,
  }]));
  for (const entry of anchor.reviewReceipts ?? []) {
    const expected = receiptBindings.get(entry?.lane);
    if (expected?.canonicalDigest !== entry?.canonicalDigest) {
      errors.push(`continuation anchor receipt digest is stale: ${entry?.lane}`);
    }
    if (expected?.challenge !== entry?.challenge) {
      errors.push(`continuation anchor review challenge is stale: ${entry?.lane}`);
    }
  }
  validateCompletionAfterReceipts(anchor.completedAt, receipts,
    "continuation anchor", errors);
}

function validateCompletionAfterReceipts(completedAt, receipts, subject, errors) {
  const completedTime = Date.parse(completedAt);
  const receiptTimes = receipts.map((receipt) => Date.parse(receipt?.completedAt));
  if (Number.isFinite(completedTime)
    && receiptTimes.every((time) => Number.isFinite(time))
    && completedTime < Math.max(...receiptTimes)) {
    errors.push(`${subject} completedAt predates a bound review receipt`);
  }
}

function validatePathDigestReference(value, requiredPath, subject, errors) {
  if (!plainObject(value) || !exactKeys(value, PATH_DIGEST_REFERENCE_KEYS)
    || value.path !== requiredPath || !sha256Digest(value.digest)) {
    errors.push(`${subject} reference is invalid`);
  }
}

function validatePathShaReference(value, requiredPath, subject, errors) {
  if (!plainObject(value) || !exactKeys(value, PATH_SHA_REFERENCE_KEYS)
    || value.path !== requiredPath || !sha256Digest(value.sha256)) {
    errors.push(`${subject} reference is invalid`);
  }
}

function validateContinuationIdentity(value, subject, errors) {
  if (!nonEmpty(value.programId)
    || value.workstreamId !== CONTINUATION_WORKSTREAM_ID
    || value.featureId !== CONTINUATION_FEATURE_ID
    || value.round !== CONTINUATION_ROUND) {
    errors.push(`${subject} program/workstream/feature/round identity is invalid`);
  }
}

function validateLaneEntries(entries, keys, subject, errors, validateEntry) {
  const lanes = [];
  for (const [index, entry] of entries.entries()) {
    if (!plainObject(entry) || !exactKeys(entry, keys)) {
      errors.push(`${subject}[${index}] has invalid keys`);
      continue;
    }
    lanes.push(entry.lane);
    if (!REQUIRED_CONTINUATION_REVIEW_LANES.includes(entry.lane)
      || !validateEntry(entry)) {
      errors.push(`${subject}[${index}] is invalid`);
    }
  }
  if (!sameStringSet(REQUIRED_CONTINUATION_REVIEW_LANES, lanes)) {
    errors.push(`${subject} lanes must be unique and complete`);
  }
}

function executableDigest(policy, kind) {
  return policy.continuationExecutables?.find((entry) => entry.kind === kind)?.sha256;
}

function validateOwnDigest(value, subject, errors) {
  if (!sha256Digest(value.digest)) {
    errors.push(`${subject} digest must be a SHA-256 digest`);
    return;
  }
  const withoutDigest = { ...value };
  delete withoutDigest.digest;
  if (value.digest !== safeHashCanonical(withoutDigest)) {
    errors.push(`${subject} canonical digest is stale`);
  }
}

function safeHashCanonical(value) {
  try {
    return hashCanonical(value);
  } catch {
    return undefined;
  }
}

function exactKeys(value, keys) {
  return sameOrderedStrings(Object.keys(value).sort(), keys.slice().sort());
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
    && value.every((item) => nonEmpty(item));
}

function isoTimestamp(value) {
  if (typeof value !== "string") return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function sameOrderedStrings(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function sameStringSet(left, right) {
  return new Set(left).size === left.length && new Set(right).size === right.length
    && left.length === right.length && left.every((value) => right.includes(value));
}
