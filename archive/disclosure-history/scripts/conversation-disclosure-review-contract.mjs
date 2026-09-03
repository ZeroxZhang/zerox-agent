import { createHash } from "node:crypto";
import path from "node:path";

export const REVIEW_SNAPSHOT_KIND = "conversation-disclosure-review-snapshot";
export const REVIEW_RECEIPT_KIND = "conversation-disclosure-review-receipt";
export const CLOSURE_MANIFEST_KIND = "conversation-disclosure-closure-manifest";
export const EXTERNAL_ATTESTATION_KIND =
  "conversation-disclosure-external-closure-attestation";
export const EXTERNAL_ANCHOR_KIND =
  "conversation-disclosure-external-anchor";
// This is deliberately not a signature format. Its assurance comes from the
// caller keeping the anchor outside the candidate repository and separately
// pinning its canonical digest when the completed checker is invoked.
export const REVIEW_ALGORITHM = "sha256-canonical-json-v1";
export const CLOSURE_STATUS_PENDING =
  "review_passed_pending_external_anchor";
export const CLOSURE_STATUS_ATTESTED = "externally_attested";
export const REQUIRED_REVIEW_LANES = Object.freeze([
  "contract",
  "runtime",
  "governance",
]);
export const REQUIRED_EXECUTABLE_CLOSURE = Object.freeze({
  package: "package.json",
  checker: "scripts/check-conversation-disclosure-program.mjs",
  harness: "scripts/check-harness-state.mjs",
});
export const REQUIRED_EXTERNAL_RUNNER =
  "scripts/verify-conversation-disclosure-closure.mjs";

const SNAPSHOT_KEYS = Object.freeze([
  "algorithm",
  "claimsDigest",
  "completionContractDigest",
  "digest",
  "featureFileSetDigest",
  "featureId",
  "files",
  "kind",
  "programId",
  "round",
  "safetyContractDigest",
  "schemaVersion",
  "workstreamId",
]);
const SNAPSHOT_FILE_KEYS = Object.freeze(["path", "sha256"]);
const REVIEW_RECEIPT_KEYS = Object.freeze([
  "challenge",
  "completedAt",
  "completionContractDigest",
  "featureId",
  "findingCounts",
  "findings",
  "kind",
  "lane",
  "programId",
  "reviewAgentId",
  "reviewTaskPath",
  "round",
  "safetyContractDigest",
  "schemaVersion",
  "snapshotDigest",
  "snapshotFileCount",
  "transport",
  "verdict",
  "workstreamId",
]);
const FINDING_COUNTS_KEYS = Object.freeze(["critical", "major", "minor"]);
const FINDING_KEYS = Object.freeze(["evidence", "id", "severity", "summary"]);
const CLOSURE_MANIFEST_KEYS = Object.freeze([
  "digest",
  "executableClosure",
  "externalAttestation",
  "externalRunner",
  "featureId",
  "kind",
  "programId",
  "reviewReceipts",
  "round",
  "schemaVersion",
  "snapshot",
  "status",
  "workstreamId",
]);
const CLOSURE_SNAPSHOT_KEYS = Object.freeze(["digest", "path"]);
const CLOSURE_RECEIPT_KEYS = Object.freeze([
  "canonicalDigest",
  "lane",
  "path",
]);
const EXECUTABLE_CLOSURE_KEYS = Object.freeze(["kind", "path", "sha256"]);
const EXTERNAL_RUNNER_KEYS = Object.freeze(["path", "sha256"]);
const EXTERNAL_ATTESTATION_REFERENCE_KEYS = Object.freeze([
  "canonicalDigest",
  "path",
]);
const EXTERNAL_ATTESTATION_KEYS = Object.freeze([
  "candidateResults",
  "completedAt",
  "digest",
  "kind",
  "pendingManifestDigest",
  "repositoryRealpath",
  "reviewReceiptDigests",
  "runnerDigest",
  "schemaVersion",
  "snapshotDigest",
  "status",
  "subjectIdentityAssurance",
  "trustLevel",
]);
const EXTERNAL_RECEIPT_DIGEST_KEYS = Object.freeze([
  "canonicalDigest",
  "lane",
]);
const EXTERNAL_ANCHOR_KEYS = Object.freeze([
  "attestationDigest",
  "completedAt",
  "digest",
  "kind",
  "repositoryRealpath",
  "reviewReceipts",
  "runnerDigest",
  "schemaVersion",
  "snapshotDigest",
  "subjectIdentityAssurance",
  "trustLevel",
]);
const EXTERNAL_ANCHOR_RECEIPT_KEYS = Object.freeze([
  "canonicalDigest",
  "challenge",
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
  "kind",
  "snapshotDigest",
  "status",
]);

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

export function validateReviewSnapshot(snapshot) {
  const errors = [];
  if (!plainObject(snapshot) || !exactKeys(snapshot, SNAPSHOT_KEYS)) {
    errors.push("review snapshot must contain the exact v1 keys");
    return errors;
  }
  if (snapshot.schemaVersion !== 1 || snapshot.kind !== REVIEW_SNAPSHOT_KIND) {
    errors.push("review snapshot identity is invalid");
  }
  if (snapshot.algorithm !== REVIEW_ALGORITHM) {
    errors.push("review snapshot algorithm is invalid");
  }
  validateSharedIdentity(snapshot, "review snapshot", errors);
  for (const key of [
    "claimsDigest",
    "completionContractDigest",
    "featureFileSetDigest",
    "safetyContractDigest",
    "digest",
  ]) {
    if (!sha256Digest(snapshot[key])) {
      errors.push(`review snapshot ${key} must be a SHA-256 digest`);
    }
  }
  if (!Array.isArray(snapshot.files) || snapshot.files.length === 0) {
    errors.push("review snapshot files must be a non-empty array");
  } else {
    const paths = [];
    for (const [index, entry] of snapshot.files.entries()) {
      if (!plainObject(entry) || !exactKeys(entry, SNAPSHOT_FILE_KEYS)) {
        errors.push(`review snapshot files[${index}] must contain exactly path and sha256`);
        continue;
      }
      if (!repositoryPath(entry.path)) {
        errors.push(`review snapshot files[${index}].path is invalid`);
      }
      if (!sha256Digest(entry.sha256)) {
        errors.push(`review snapshot files[${index}].sha256 is invalid`);
      }
      paths.push(entry.path);
    }
    if (new Set(paths).size !== paths.length) {
      errors.push("review snapshot file paths must be unique");
    }
    if (!sameOrderedStrings(paths, paths.slice().sort())) {
      errors.push("review snapshot file paths must be sorted");
    }
  }
  const withoutDigest = { ...snapshot };
  delete withoutDigest.digest;
  if (sha256Digest(snapshot.digest) && snapshot.digest !== hashCanonical(withoutDigest)) {
    errors.push("review snapshot digest is stale");
  }
  return errors;
}

export function validateReviewReceipt(receipt, snapshot) {
  const errors = [];
  if (!plainObject(receipt) || !exactKeys(receipt, REVIEW_RECEIPT_KEYS)) {
    errors.push("review receipt must contain the exact v1 keys");
    return errors;
  }
  if (receipt.schemaVersion !== 1 || receipt.kind !== REVIEW_RECEIPT_KIND) {
    errors.push("review receipt identity is invalid");
  }
  validateSharedIdentity(receipt, "review receipt", errors);
  if (!REQUIRED_REVIEW_LANES.includes(receipt.lane)) {
    errors.push("review receipt lane is invalid");
  }
  if (receipt.transport !== "codex-collaboration") {
    errors.push("review receipt transport must be codex-collaboration");
  }
  if (!nonEmpty(receipt.reviewTaskPath) || !nonEmpty(receipt.reviewAgentId)) {
    errors.push("review receipt task and agent identity are required");
  }
  if (!sha256Digest(receipt.challenge)) {
    errors.push("review receipt challenge must be a SHA-256 digest");
  }
  for (const key of [
    "snapshotDigest",
    "completionContractDigest",
    "safetyContractDigest",
  ]) {
    if (!sha256Digest(receipt[key])) {
      errors.push(`review receipt ${key} must be a SHA-256 digest`);
    }
  }
  if (!Number.isInteger(receipt.snapshotFileCount) || receipt.snapshotFileCount <= 0) {
    errors.push("review receipt snapshotFileCount must be a positive integer");
  }
  if (receipt.verdict !== "passed" && receipt.verdict !== "failed") {
    errors.push("review receipt verdict is invalid");
  }
  if (!plainObject(receipt.findingCounts)
    || !exactKeys(receipt.findingCounts, FINDING_COUNTS_KEYS)
    || Object.values(receipt.findingCounts).some(
      (count) => !Number.isInteger(count) || count < 0,
    )) {
    errors.push("review receipt findingCounts is invalid");
  }
  if (!Array.isArray(receipt.findings)) {
    errors.push("review receipt findings must be an array");
  } else {
    const counts = { critical: 0, major: 0, minor: 0 };
    const ids = new Set();
    for (const [index, finding] of receipt.findings.entries()) {
      if (!plainObject(finding) || !exactKeys(finding, FINDING_KEYS)) {
        errors.push(`review receipt findings[${index}] has invalid keys`);
        continue;
      }
      if (!nonEmpty(finding.id) || ids.has(finding.id)) {
        errors.push(`review receipt findings[${index}].id must be non-empty and unique`);
      }
      ids.add(finding.id);
      if (!Object.hasOwn(counts, finding.severity)) {
        errors.push(`review receipt findings[${index}].severity is invalid`);
      } else {
        counts[finding.severity] += 1;
      }
      if (!nonEmpty(finding.summary) || !stringArray(finding.evidence, true)) {
        errors.push(`review receipt findings[${index}] summary/evidence is invalid`);
      }
    }
    if (plainObject(receipt.findingCounts)) {
      for (const severity of Object.keys(counts)) {
        if (receipt.findingCounts[severity] !== counts[severity]) {
          errors.push(`review receipt ${severity} count does not match findings`);
        }
      }
    }
  }
  if (!isoTimestamp(receipt.completedAt)) {
    errors.push("review receipt completedAt must be an exact ISO timestamp");
  } else if (Date.parse(receipt.completedAt) > Date.now()) {
    errors.push("review receipt completedAt must not be in the future");
  }
  if (snapshot && plainObject(snapshot)) {
    for (const key of ["programId", "workstreamId", "featureId", "round"]) {
      if (receipt[key] !== snapshot[key]) {
        errors.push(`review receipt ${key} must match the snapshot`);
      }
    }
    if (receipt.snapshotDigest !== snapshot.digest) {
      errors.push("review receipt snapshotDigest must match the snapshot");
    }
    if (receipt.snapshotFileCount !== snapshot.files?.length) {
      errors.push("review receipt snapshotFileCount must match the snapshot");
    }
    if (receipt.completionContractDigest !== snapshot.completionContractDigest) {
      errors.push("review receipt completionContractDigest must match the snapshot");
    }
    if (receipt.safetyContractDigest !== snapshot.safetyContractDigest) {
      errors.push("review receipt safetyContractDigest must match the snapshot");
    }
  }
  return errors;
}

export function validateClosureManifest(manifest, snapshot) {
  const errors = [];
  if (!plainObject(manifest) || !exactKeys(manifest, CLOSURE_MANIFEST_KEYS)) {
    errors.push("closure manifest must contain the exact v1 keys");
    return errors;
  }
  if (manifest.schemaVersion !== 1 || manifest.kind !== CLOSURE_MANIFEST_KIND) {
    errors.push("closure manifest identity is invalid");
  }
  validateSharedIdentity(manifest, "closure manifest", errors);
  if (manifest.status !== CLOSURE_STATUS_PENDING
    && manifest.status !== CLOSURE_STATUS_ATTESTED) {
    errors.push("closure manifest status is invalid");
  }
  if (!plainObject(manifest.snapshot)
    || !exactKeys(manifest.snapshot, CLOSURE_SNAPSHOT_KEYS)
    || !repositoryPath(manifest.snapshot.path)
    || !sha256Digest(manifest.snapshot.digest)) {
    errors.push("closure manifest snapshot reference is invalid");
  }
  if (!Array.isArray(manifest.reviewReceipts)
    || manifest.reviewReceipts.length !== REQUIRED_REVIEW_LANES.length) {
    errors.push("closure manifest must reference exactly three review receipts");
  } else {
    validateLaneEntries(
      manifest.reviewReceipts,
      CLOSURE_RECEIPT_KEYS,
      "closure manifest review receipt",
      errors,
      (entry) => repositoryPath(entry.path) && sha256Digest(entry.canonicalDigest),
    );
  }
  if (!Array.isArray(manifest.executableClosure)
    || manifest.executableClosure.length !== Object.keys(REQUIRED_EXECUTABLE_CLOSURE).length) {
    errors.push("closure manifest executableClosure is invalid");
  } else {
    const kinds = new Set();
    for (const [index, entry] of manifest.executableClosure.entries()) {
      if (!plainObject(entry) || !exactKeys(entry, EXECUTABLE_CLOSURE_KEYS)) {
        errors.push(`closure manifest executableClosure[${index}] has invalid keys`);
        continue;
      }
      kinds.add(entry.kind);
      if (REQUIRED_EXECUTABLE_CLOSURE[entry.kind] !== entry.path
        || !sha256Digest(entry.sha256)) {
        errors.push(`closure manifest executableClosure[${index}] is invalid`);
      }
    }
    if (kinds.size !== Object.keys(REQUIRED_EXECUTABLE_CLOSURE).length) {
      errors.push("closure manifest executableClosure kinds must be unique and complete");
    }
  }
  if (!plainObject(manifest.externalRunner)
    || !exactKeys(manifest.externalRunner, EXTERNAL_RUNNER_KEYS)
    || manifest.externalRunner.path !== REQUIRED_EXTERNAL_RUNNER
    || !sha256Digest(manifest.externalRunner.sha256)) {
    errors.push("closure manifest externalRunner is invalid");
  }
  if (!plainObject(manifest.externalAttestation)
    || !exactKeys(
      manifest.externalAttestation,
      EXTERNAL_ATTESTATION_REFERENCE_KEYS,
    )
    || !repositoryPath(manifest.externalAttestation.path)) {
    errors.push("closure manifest externalAttestation reference is invalid");
  } else if (manifest.status === CLOSURE_STATUS_PENDING
    && manifest.externalAttestation.canonicalDigest !== null) {
    errors.push("pending closure manifest must not claim an external attestation digest");
  } else if (manifest.status === CLOSURE_STATUS_ATTESTED
    && !sha256Digest(manifest.externalAttestation.canonicalDigest)) {
    errors.push("externally attested closure manifest requires an attestation digest");
  }
  if (!sha256Digest(manifest.digest)) {
    errors.push("closure manifest digest must be a SHA-256 digest");
  } else {
    const withoutDigest = { ...manifest };
    delete withoutDigest.digest;
    if (manifest.digest !== hashCanonical(withoutDigest)) {
      errors.push("closure manifest digest is stale");
    }
  }
  if (snapshot && plainObject(snapshot)) {
    for (const key of ["programId", "workstreamId", "featureId", "round"]) {
      if (manifest[key] !== snapshot[key]) {
        errors.push(`closure manifest ${key} must match the snapshot`);
      }
    }
    if (manifest.snapshot?.digest !== snapshot.digest) {
      errors.push("closure manifest snapshot digest must match the snapshot");
    }
  }
  return errors;
}

export function validateExternalAttestation(attestation, bindings = {}) {
  const errors = [];
  if (!plainObject(attestation)
    || !exactKeys(attestation, EXTERNAL_ATTESTATION_KEYS)) {
    return ["external attestation must contain the exact v1 keys"];
  }
  if (attestation.schemaVersion !== 1
    || attestation.kind !== EXTERNAL_ATTESTATION_KIND
    || attestation.status !== "passed") {
    errors.push("external attestation identity/status is invalid");
  }
  if (attestation.trustLevel !== "external-anchor-consistency"
    || attestation.subjectIdentityAssurance !== "not-signed") {
    errors.push("external attestation must honestly declare unsigned consistency assurance");
  }
  if (!path.isAbsolute(attestation.repositoryRealpath)) {
    errors.push("external attestation repositoryRealpath must be absolute");
  }
  for (const key of [
    "runnerDigest",
    "snapshotDigest",
    "pendingManifestDigest",
    "digest",
  ]) {
    if (!sha256Digest(attestation[key])) {
      errors.push(`external attestation ${key} must be a SHA-256 digest`);
    }
  }
  if (!isoTimestamp(attestation.completedAt)) {
    errors.push("external attestation completedAt must be an exact ISO timestamp");
  } else if (Date.parse(attestation.completedAt) > Date.now()) {
    errors.push("external attestation completedAt must not be in the future");
  }
  if (!Array.isArray(attestation.reviewReceiptDigests)
    || attestation.reviewReceiptDigests.length !== REQUIRED_REVIEW_LANES.length) {
    errors.push("external attestation must bind exactly three review receipt digests");
  } else {
    validateLaneEntries(
      attestation.reviewReceiptDigests,
      EXTERNAL_RECEIPT_DIGEST_KEYS,
      "external attestation review receipt digest",
      errors,
      (entry) => sha256Digest(entry.canonicalDigest),
    );
  }
  if (!Array.isArray(attestation.candidateResults)
    || attestation.candidateResults.length !== 2) {
    errors.push("external attestation must contain checker and harness candidate results");
  } else {
    const kinds = [];
    for (const [index, result] of attestation.candidateResults.entries()) {
      if (!plainObject(result) || !exactKeys(result, CANDIDATE_RESULT_KEYS)) {
        errors.push(`external attestation candidateResults[${index}] has invalid keys`);
        continue;
      }
      kinds.push(result.kind);
      const expectedReceiptKind = result.kind === "checker"
        ? "cd03-checker-receipt"
        : result.kind === "harness"
          ? "cd03-harness-receipt"
          : undefined;
      if (!expectedReceiptKind
        || result.path !== REQUIRED_EXECUTABLE_CLOSURE[result.kind]
        || result.status !== "passed") {
        errors.push(`external attestation candidateResults[${index}] identity/status is invalid`);
      }
      if (!plainObject(result.receipt)
        || !exactKeys(result.receipt, CANDIDATE_RECEIPT_KEYS)
        || result.receipt.kind !== expectedReceiptKind
        || result.receipt.status !== "passed"
        || result.receipt.snapshotDigest !== attestation.snapshotDigest) {
        errors.push(`external attestation candidateResults[${index}] receipt is invalid`);
      }
      if (!sha256Digest(result.receiptDigest)
        || (plainObject(result.receipt)
          && result.receiptDigest !== hashCanonical(result.receipt))
        || !sha256Digest(result.stdoutDigest)
        || !sha256Digest(result.stderrDigest)) {
        errors.push(`external attestation candidateResults[${index}] result digests are invalid`);
      }
    }
    if (!sameStringSet(["checker", "harness"], kinds)) {
      errors.push("external attestation candidate result kinds must be checker and harness");
    }
  }
  const withoutDigest = { ...attestation };
  delete withoutDigest.digest;
  if (sha256Digest(attestation.digest)
    && attestation.digest !== hashCanonical(withoutDigest)) {
    errors.push("external attestation canonical digest is stale");
  }

  const { manifest, snapshot, repositoryRealpath, runnerDigest, receipts } = bindings;
  const attestedReceiptDigests = Array.isArray(attestation.reviewReceiptDigests)
    ? attestation.reviewReceiptDigests
    : [];
  if (manifest && plainObject(manifest)) {
    if (manifest.status !== CLOSURE_STATUS_ATTESTED) {
      errors.push("completed closure manifest must be externally_attested");
    }
    if (manifest.externalAttestation?.canonicalDigest !== attestation.digest) {
      errors.push("closure manifest external attestation digest is stale");
    }
    if (manifest.externalRunner?.sha256 !== attestation.runnerDigest) {
      errors.push("external attestation runner digest does not match the closure manifest");
    }
    const pendingManifest = toPendingClosureManifest(manifest);
    if (attestation.pendingManifestDigest !== pendingManifest.digest) {
      errors.push("external attestation pending manifest digest is stale");
    }
    const manifestReceiptDigests = new Map(
      (manifest.reviewReceipts ?? []).map(
        (entry) => [entry?.lane, entry?.canonicalDigest],
      ),
    );
    for (const entry of attestedReceiptDigests) {
      if (manifestReceiptDigests.get(entry?.lane) !== entry?.canonicalDigest) {
        errors.push(`external attestation review receipt digest is stale: ${entry?.lane}`);
      }
    }
  }
  if (snapshot && plainObject(snapshot)
    && attestation.snapshotDigest !== snapshot.digest) {
    errors.push("external attestation snapshot digest is stale");
  }
  if (repositoryRealpath !== undefined
    && attestation.repositoryRealpath !== repositoryRealpath) {
    errors.push("external attestation repository realpath is stale");
  }
  if (runnerDigest !== undefined && attestation.runnerDigest !== runnerDigest) {
    errors.push("external attestation runner digest is stale");
  }
  if (Array.isArray(receipts) && receipts.length > 0) {
    const receiptDigests = new Map(
      receipts.map((receipt) => [receipt?.lane, hashCanonical(receipt)]),
    );
    for (const entry of attestedReceiptDigests) {
      if (receiptDigests.get(entry?.lane) !== entry?.canonicalDigest) {
        errors.push(`external attestation receipt binding is stale: ${entry?.lane}`);
      }
    }
    const latestReceiptTime = Math.max(
      ...receipts.map((receipt) => Date.parse(receipt?.completedAt)),
    );
    if (Number.isFinite(latestReceiptTime)
      && Date.parse(attestation.completedAt) < latestReceiptTime) {
      errors.push("external attestation completedAt predates a bound review receipt");
    }
  }
  return errors;
}

export function validateExternalAnchor(anchor, bindings = {}) {
  const errors = [];
  if (!plainObject(anchor) || !exactKeys(anchor, EXTERNAL_ANCHOR_KEYS)) {
    return ["external anchor must contain the exact v1 keys"];
  }
  if (anchor.schemaVersion !== 1 || anchor.kind !== EXTERNAL_ANCHOR_KIND) {
    errors.push("external anchor identity is invalid");
  }
  if (anchor.trustLevel !== "external-caller-pinned-consistency"
    || anchor.subjectIdentityAssurance !== "not-signed") {
    errors.push("external anchor must honestly declare unsigned caller-pinned assurance");
  }
  if (!path.isAbsolute(anchor.repositoryRealpath)) {
    errors.push("external anchor repositoryRealpath must be absolute");
  }
  for (const key of [
    "attestationDigest",
    "runnerDigest",
    "snapshotDigest",
    "digest",
  ]) {
    if (!sha256Digest(anchor[key])) {
      errors.push(`external anchor ${key} must be a SHA-256 digest`);
    }
  }
  if (!isoTimestamp(anchor.completedAt)) {
    errors.push("external anchor completedAt must be an exact ISO timestamp");
  } else if (Date.parse(anchor.completedAt) > Date.now()) {
    errors.push("external anchor completedAt must not be in the future");
  }
  if (!Array.isArray(anchor.reviewReceipts)
    || anchor.reviewReceipts.length !== REQUIRED_REVIEW_LANES.length) {
    errors.push("external anchor must bind exactly three review receipts");
  } else {
    validateLaneEntries(
      anchor.reviewReceipts,
      EXTERNAL_ANCHOR_RECEIPT_KEYS,
      "external anchor review receipt",
      errors,
      (entry) => sha256Digest(entry.canonicalDigest)
        && sha256Digest(entry.challenge),
    );
  }
  const withoutDigest = { ...anchor };
  delete withoutDigest.digest;
  if (sha256Digest(anchor.digest)
    && anchor.digest !== hashCanonical(withoutDigest)) {
    errors.push("external anchor canonical digest is stale");
  }

  const {
    attestation,
    repositoryRealpath,
    runnerDigest,
    snapshot,
    receipts,
  } = bindings;
  if (plainObject(attestation)) {
    if (anchor.attestationDigest !== attestation.digest) {
      errors.push("external anchor attestation digest is stale");
    }
    if (anchor.completedAt !== attestation.completedAt) {
      errors.push("external anchor completedAt must exactly match the attestation");
    }
  }
  if (repositoryRealpath !== undefined
    && anchor.repositoryRealpath !== repositoryRealpath) {
    errors.push("external anchor repository realpath is stale");
  }
  if (runnerDigest !== undefined && anchor.runnerDigest !== runnerDigest) {
    errors.push("external anchor runner digest is stale");
  }
  if (plainObject(snapshot) && anchor.snapshotDigest !== snapshot.digest) {
    errors.push("external anchor snapshot digest is stale");
  }
  if (Array.isArray(receipts) && receipts.length > 0) {
    const receiptBindings = new Map(receipts.map((receipt) => [
      receipt?.lane,
      {
        canonicalDigest: hashCanonical(receipt),
        challenge: receipt?.challenge,
      },
    ]));
    for (const entry of anchor.reviewReceipts ?? []) {
      const expected = receiptBindings.get(entry?.lane);
      if (expected?.canonicalDigest !== entry?.canonicalDigest) {
        errors.push(`external anchor receipt digest is stale: ${entry?.lane}`);
      }
      if (expected?.challenge !== entry?.challenge) {
        errors.push(`external anchor review challenge is stale: ${entry?.lane}`);
      }
    }
    const latestReceiptTime = Math.max(
      ...receipts.map((receipt) => Date.parse(receipt?.completedAt)),
    );
    if (Number.isFinite(latestReceiptTime)
      && Date.parse(anchor.completedAt) < latestReceiptTime) {
      errors.push("external anchor completedAt predates a bound review receipt");
    }
  }
  return errors;
}

export function toPendingClosureManifest(manifest) {
  const withoutDigest = {
    ...manifest,
    status: CLOSURE_STATUS_PENDING,
    externalAttestation: {
      ...manifest.externalAttestation,
      canonicalDigest: null,
    },
  };
  delete withoutDigest.digest;
  return {
    ...withoutDigest,
    digest: hashCanonical(withoutDigest),
  };
}

export function validateReviewSet(receipts, snapshot) {
  const errors = [];
  if (!Array.isArray(receipts) || receipts.length !== REQUIRED_REVIEW_LANES.length) {
    return ["review set must contain exactly three receipts"];
  }
  const lanes = new Set();
  const tasks = new Set();
  const agents = new Set();
  const challenges = new Set();
  for (const receipt of receipts) {
    errors.push(...validateReviewReceipt(receipt, snapshot));
    lanes.add(receipt?.lane);
    tasks.add(receipt?.reviewTaskPath);
    agents.add(receipt?.reviewAgentId);
    challenges.add(receipt?.challenge);
    if (receipt?.verdict !== "passed"
      || receipt?.findingCounts?.critical !== 0
      || receipt?.findingCounts?.major !== 0) {
      errors.push(`review receipt ${receipt?.lane ?? "unknown"} must pass with zero Critical/Major findings`);
    }
  }
  if (!sameStringSet(REQUIRED_REVIEW_LANES, [...lanes])) {
    errors.push("review set must contain the exact contract/runtime/governance lanes");
  }
  if (tasks.size !== receipts.length || agents.size !== receipts.length
    || challenges.size !== receipts.length) {
    errors.push("review task, agent, and challenge identities must be unique");
  }
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

function validateSharedIdentity(value, subject, errors) {
  if (!nonEmpty(value.programId) || value.workstreamId !== "CD03"
    || !nonEmpty(value.featureId) || !Number.isInteger(value.round)
    || value.round <= 0) {
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
    if (!REQUIRED_REVIEW_LANES.includes(entry.lane) || !validateEntry(entry)) {
      errors.push(`${subject}[${index}] is invalid`);
    }
  }
  if (!sameStringSet(REQUIRED_REVIEW_LANES, lanes)) {
    errors.push(`${subject} lanes must be unique and complete`);
  }
}

function exactKeys(value, keys) {
  return sameOrderedStrings(Object.keys(value).sort(), keys.slice().sort());
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
