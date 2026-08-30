import { createHash } from "node:crypto";

export const CD04_DELTA_SCHEMA_VERSION = 13;
export const CD04_DELTA_PROGRAM_ID =
  "conversation-progressive-disclosure-v3.9.2-2026-08";
export const CD04_DELTA_FEATURE_ID =
  "P108-conversation-disclosure-evidence-foundation";
export const CD04_DELTA_WORKSTREAM_ID = "CD04";
export const CD04_DELTA_SUCCESSOR_FEATURE_ID =
  "P109-chat-progressive-disclosure-surface";
export const CD04_DELTA_SUCCESSOR_WORKSTREAM_ID = "CD05";
export const CD04_DELTA_SNAPSHOT_PATH =
  ".zerox/verification/conversation-disclosure/CD04-delta-review-snapshot-v9.json";
export const CD04_DELTA_MANIFEST_PATH =
  ".zerox/verification/conversation-disclosure/CD04-reviewed-delta-manifest.json";
export const CD04_DELTA_REVIEW_PATH =
  ".zerox/reviews/CD04-shadow-parity-review.md";
export const CD04_DELTA_RECEIPT_PATHS = Object.freeze({
  replay: ".zerox/verification/conversation-disclosure/CD04-replay-review.json",
  security:
    ".zerox/verification/conversation-disclosure/CD04-security-review.json",
  integration:
    ".zerox/verification/conversation-disclosure/CD04-integration-review.json",
});
export const CD04_DELTA_REVIEW_OUTPUT_PATHS = Object.freeze({
  replay: ".zerox/reviews/CD04-replay-review-output.json",
  security: ".zerox/reviews/CD04-security-review-output.json",
  integration: ".zerox/reviews/CD04-integration-review-output.json",
});
export const CD04_DELTA_REVIEW_LANES = Object.freeze(
  Object.keys(CD04_DELTA_RECEIPT_PATHS),
);
export const CD04_DELTA_TRANSITIONS = Object.freeze([
  Object.freeze({
    path: "package.json",
    targetPath:
      ".zerox/verification/conversation-disclosure/CD04-package.target.json",
  }),
  Object.freeze({
    path: "scripts/check-harness-state.mjs",
    targetPath:
      ".zerox/verification/conversation-disclosure/CD04-harness.target.mjs",
  }),
  Object.freeze({
    path: "src/shared/packageScripts.test.ts",
    targetPath:
      ".zerox/verification/conversation-disclosure/CD04-package-scripts-test.target.ts",
  }),
  Object.freeze({
    path: ".zerox/feature_list.json",
    targetPath:
      ".zerox/verification/conversation-disclosure/CD04-feature-list.target.json",
  }),
  Object.freeze({
    path: ".zerox/conversation-disclosure-program.json",
    targetPath:
      ".zerox/verification/conversation-disclosure/CD04-program.target.json",
  }),
]);

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SNAPSHOT_KEYS = Object.freeze([
  "artifacts",
  "digest",
  "featureId",
  "frozenAt",
  "frozenEntries",
  "kind",
  "parent",
  "programId",
  "requiredAbsentPaths",
  "reviewChallenges",
  "reviewLanes",
  "schemaVersion",
  "transitions",
  "workstreamId",
]);

export function canonicalJsonV13(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJsonV13(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJsonV13(value[key])}`).join(",")}}`;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite canonical number");
    return JSON.stringify(value);
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  throw new Error(`unsupported canonical value: ${typeof value}`);
}

export function sha256BytesV13(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function hashCanonicalV13(value) {
  return sha256BytesV13(canonicalJsonV13(value));
}

export function withCanonicalDigestV13(value) {
  return {
    ...value,
    digest: hashCanonicalV13(value),
  };
}

export function validateCd04DeltaSnapshotV13(snapshot) {
  const errors = [];
  if (!plainObject(snapshot)) return ["snapshot must be an object"];
  if (!sameStrings(Object.keys(snapshot).sort(), SNAPSHOT_KEYS)) {
    errors.push("snapshot keys are not exact");
  }
  if (
    snapshot.schemaVersion !== CD04_DELTA_SCHEMA_VERSION
    || snapshot.kind !== "conversation-disclosure-cd04-delta-review-snapshot"
    || snapshot.programId !== CD04_DELTA_PROGRAM_ID
    || snapshot.featureId !== CD04_DELTA_FEATURE_ID
    || snapshot.workstreamId !== CD04_DELTA_WORKSTREAM_ID
  ) {
    errors.push("snapshot identity is invalid");
  }
  if (!validDate(snapshot.frozenAt)) errors.push("snapshot frozenAt is invalid");
  validateParent(snapshot.parent, errors);
  validateArtifacts(snapshot.artifacts, errors);
  validateEntries(snapshot.frozenEntries, "frozenEntries", errors);
  validateTransitions(snapshot.transitions, errors);
  if (!sameStrings(snapshot.reviewLanes, CD04_DELTA_REVIEW_LANES)) {
    errors.push("snapshot review lanes are not exact");
  }
  if (
    !plainObject(snapshot.reviewChallenges)
    || !sameStrings(
      Object.keys(snapshot.reviewChallenges).sort(),
      [...CD04_DELTA_REVIEW_LANES].sort(),
    )
    || CD04_DELTA_REVIEW_LANES.some(
      (lane) => !validDigest(snapshot.reviewChallenges[lane]),
    )
  ) {
    errors.push("snapshot review challenges are invalid");
  }
  const expectedAbsent = [
    CD04_DELTA_REVIEW_PATH,
    ...Object.values(CD04_DELTA_RECEIPT_PATHS),
    ...Object.values(CD04_DELTA_REVIEW_OUTPUT_PATHS),
    CD04_DELTA_MANIFEST_PATH,
  ].sort();
  if (!sameStrings(snapshot.requiredAbsentPaths, expectedAbsent)) {
    errors.push("snapshot required absent paths are not exact");
  }
  const { digest, ...withoutDigest } = snapshot;
  if (!validDigest(digest) || digest !== hashCanonicalV13(withoutDigest)) {
    errors.push("snapshot digest is invalid");
  }
  return errors;
}

export function validateCd04ReviewOutputV13(output, snapshot, lane) {
  const errors = [];
  if (!plainObject(output)) return [`${lane} review output must be an object`];
  const expectedKeys = [
    "challenge",
    "counts",
    "digest",
    "findings",
    "kind",
    "lane",
    "rawOutput",
    "schemaVersion",
    "snapshotDigest",
    "verdict",
  ].sort();
  if (!sameStrings(Object.keys(output).sort(), expectedKeys)) {
    errors.push(`${lane} review output keys are not exact`);
  }
  if (
    output.schemaVersion !== CD04_DELTA_SCHEMA_VERSION
    || output.kind !== "conversation-disclosure-cd04-review-output"
    || output.lane !== lane
    || output.challenge !== snapshot.reviewChallenges?.[lane]
    || output.snapshotDigest !== snapshot.digest
    || output.verdict !== "PASS"
    || typeof output.rawOutput !== "string"
    || !output.rawOutput.includes(output.challenge)
  ) {
    errors.push(`${lane} review output identity or verdict is invalid`);
  }
  const trailer = parseReviewOutputTrailer(output.rawOutput);
  if (
    !trailer
    || trailer.verdict !== output.verdict
    || canonicalJsonV13(trailer.counts)
      !== canonicalJsonV13(output.counts)
  ) {
    errors.push(`${lane} raw review trailer contradicts structured fields`);
  }
  if (
    !plainObject(output.counts)
    || output.counts.critical !== 0
    || output.counts.major !== 0
    || !Number.isSafeInteger(output.counts.minor)
    || output.counts.minor < 0
    || !Array.isArray(output.findings)
    || output.findings.length !== (
      output.counts.critical + output.counts.major + output.counts.minor
    )
  ) {
    errors.push(`${lane} review output findings are invalid`);
  }
  const { digest, ...withoutDigest } = output;
  if (!validDigest(digest) || digest !== hashCanonicalV13(withoutDigest)) {
    errors.push(`${lane} review output digest is invalid`);
  }
  return errors;
}

export function validateCd04ReviewArtifactV13(
  content,
  snapshot,
  receipts,
) {
  const errors = [];
  if (typeof content !== "string") {
    return ["CD04 review artifact must be text"];
  }
  if (!content.includes(`Snapshot: ${snapshot.digest}`)) {
    errors.push("CD04 review artifact snapshot binding is invalid");
  }
  for (const lane of CD04_DELTA_REVIEW_LANES) {
    if (
      !receipts?.[lane]
      || !content.includes(
        `${lane}: ${receipts[lane].digest}`,
      )
      || !content.includes(snapshot.reviewChallenges?.[lane] ?? "")
    ) {
      errors.push(`CD04 review artifact ${lane} binding is invalid`);
    }
  }
  const trailer = parseReviewOutputTrailer(content);
  if (
    !trailer
    || trailer.verdict !== "PASS"
    || trailer.counts.critical !== 0
    || trailer.counts.major !== 0
    || trailer.counts.minor !== 0
  ) {
    errors.push("CD04 review artifact final verdict is invalid");
  }
  return errors;
}

function parseReviewOutputTrailer(rawOutput) {
  const match = rawOutput.trim().match(
    /FINAL_VERDICT: (PASS|FAIL)\nFINAL_COUNTS: (\d+)C\/(\d+)M\/(\d+)m$/,
  );
  if (!match) return null;
  return {
    verdict: match[1],
    counts: {
      critical: Number(match[2]),
      major: Number(match[3]),
      minor: Number(match[4]),
    },
  };
}

export function validateCd04ReviewReceiptV13(
  receipt,
  snapshot,
  lane,
  output,
) {
  const errors = [];
  if (!plainObject(receipt)) return [`${lane} receipt must be an object`];
  const expectedKeys = [
    "assurance",
    "completedAt",
    "counts",
    "digest",
    "kind",
    "lane",
    "reviewOutputDigest",
    "reviewOutputPath",
    "reviewOutputSha256",
    "schemaVersion",
    "snapshotDigest",
    "challenge",
    "verdict",
  ];
  if (!sameStrings(Object.keys(receipt).sort(), expectedKeys.sort())) {
    errors.push(`${lane} receipt keys are not exact`);
  }
  if (
    receipt.schemaVersion !== CD04_DELTA_SCHEMA_VERSION
    || receipt.kind !== "conversation-disclosure-cd04-review-receipt"
    || receipt.lane !== lane
    || receipt.assurance !== "caller-attested-not-signed"
    || receipt.verdict !== "PASS"
    || receipt.snapshotDigest !== snapshot.digest
    || receipt.challenge !== snapshot.reviewChallenges?.[lane]
    || receipt.reviewOutputPath !== CD04_DELTA_REVIEW_OUTPUT_PATHS[lane]
    || receipt.reviewOutputDigest !== output?.digest
    || receipt.verdict !== output?.verdict
    || canonicalJsonV13(receipt.counts)
      !== canonicalJsonV13(output?.counts)
  ) {
    errors.push(`${lane} receipt identity or verdict is invalid`);
  }
  if (
    !plainObject(receipt.counts)
    || receipt.counts.critical !== 0
    || receipt.counts.major !== 0
    || !Number.isSafeInteger(receipt.counts.minor)
    || receipt.counts.minor < 0
  ) {
    errors.push(`${lane} receipt finding counts are invalid`);
  }
  if (
    !validDate(receipt.completedAt)
    || Date.parse(receipt.completedAt) < Date.parse(snapshot.frozenAt)
  ) {
    errors.push(`${lane} receipt completion time is invalid`);
  }
  if (
    !validDigest(receipt.reviewOutputDigest)
    || !validDigest(receipt.reviewOutputSha256)
  ) {
    errors.push(`${lane} review output digest is invalid`);
  }
  const { digest, ...withoutDigest } = receipt;
  if (!validDigest(digest) || digest !== hashCanonicalV13(withoutDigest)) {
    errors.push(`${lane} receipt digest is invalid`);
  }
  return errors;
}

export function validateCd04DeltaManifestV13(
  manifest,
  snapshot,
  receipts,
) {
  const errors = [];
  if (!plainObject(manifest)) return ["delta manifest must be an object"];
  const expectedKeys = [
    "completedAt",
    "digest",
    "featureId",
    "head",
    "kind",
    "parentAnchorDigest",
    "parentEvidence",
    "programId",
    "receiptDigests",
    "reviewArtifactSha256",
    "schemaVersion",
    "snapshotDigest",
    "transitionDigest",
    "workstreamId",
  ];
  if (!sameStrings(Object.keys(manifest).sort(), expectedKeys)) {
    errors.push("delta manifest keys are not exact");
  }
  if (
    manifest.schemaVersion !== CD04_DELTA_SCHEMA_VERSION
    || manifest.kind !== "conversation-disclosure-cd04-reviewed-delta-manifest"
    || manifest.programId !== CD04_DELTA_PROGRAM_ID
    || manifest.featureId !== CD04_DELTA_FEATURE_ID
    || manifest.workstreamId !== CD04_DELTA_WORKSTREAM_ID
    || manifest.snapshotDigest !== snapshot.digest
    || manifest.parentAnchorDigest !== snapshot.parent.anchorDigest
  ) {
    errors.push("delta manifest identity is invalid");
  }
  const parentReceipt = manifest.parentEvidence;
  if (
    !plainObject(parentReceipt)
    || parentReceipt.schemaVersion !== 12
    || parentReceipt.kind
      !== "conversation-disclosure-continuation-external-anchor"
    || parentReceipt.identityAssurance !== "not-signed"
    || parentReceipt.reviewAssurance !== "caller-attested-not-signed"
    || parentReceipt.policyDigest !== snapshot.parent.policyDigest
    || parentReceipt.snapshotDigest !== snapshot.parent.snapshotDigest
    || parentReceipt.digest !== snapshot.parent.anchorDigest
  ) {
    errors.push("delta manifest parent evidence is invalid");
  } else {
    const { digest, ...withoutDigest } = parentReceipt;
    if (!validDigest(digest) || digest !== hashCanonicalV13(withoutDigest)) {
      errors.push("delta manifest parent evidence digest is invalid");
    }
  }
  const expectedReceipts = Object.fromEntries(
    CD04_DELTA_REVIEW_LANES.map((lane) => [lane, receipts[lane]?.digest]),
  );
  if (canonicalJsonV13(manifest.receiptDigests)
    !== canonicalJsonV13(expectedReceipts)) {
    errors.push("delta manifest receipt digests are invalid");
  }
  if (
    !validDigest(manifest.reviewArtifactSha256)
    || manifest.transitionDigest !== hashCanonicalV13(snapshot.transitions)
  ) {
    errors.push("delta manifest artifact or transition digest is invalid");
  }
  if (
    !plainObject(manifest.head)
    || manifest.head.kind !== "reviewed-delta"
    || manifest.head.status !== "externally_attested"
    || manifest.head.completedFeatureId !== CD04_DELTA_FEATURE_ID
    || manifest.head.successorFeatureId !== CD04_DELTA_SUCCESSOR_FEATURE_ID
    || manifest.head.successorWorkstreamId
      !== CD04_DELTA_SUCCESSOR_WORKSTREAM_ID
  ) {
    errors.push("delta manifest head is invalid");
  }
  if (!validDate(manifest.completedAt)) {
    errors.push("delta manifest completedAt is invalid");
  } else if (
    Date.parse(manifest.completedAt) < Date.parse(snapshot.frozenAt)
    || CD04_DELTA_REVIEW_LANES.some((lane) =>
      !validDate(receipts[lane]?.completedAt)
      || Date.parse(manifest.completedAt)
        < Date.parse(receipts[lane].completedAt))
  ) {
    errors.push("delta manifest chronology is invalid");
  }
  const { digest, ...withoutDigest } = manifest;
  if (!validDigest(digest) || digest !== hashCanonicalV13(withoutDigest)) {
    errors.push("delta manifest digest is invalid");
  }
  return errors;
}

export function validateCd04DeltaAnchorV13(
  anchor,
  manifest,
  snapshot,
) {
  const errors = [];
  if (!plainObject(anchor)) return ["delta anchor must be an object"];
  const expectedKeys = [
    "completedAt",
    "digest",
    "head",
    "identityAssurance",
    "kind",
    "manifestDigest",
    "parentAnchorDigest",
    "repositoryRealpath",
    "reviewAssurance",
    "schemaVersion",
    "snapshotDigest",
  ];
  if (!sameStrings(Object.keys(anchor).sort(), expectedKeys)) {
    errors.push("delta anchor keys are not exact");
  }
  if (
    anchor.schemaVersion !== CD04_DELTA_SCHEMA_VERSION
    || anchor.kind !== "conversation-disclosure-cd04-external-delta-anchor"
    || anchor.identityAssurance !== "not-signed"
    || anchor.reviewAssurance !== "caller-attested-not-signed"
    || anchor.snapshotDigest !== snapshot.digest
    || anchor.manifestDigest !== manifest.digest
    || anchor.parentAnchorDigest !== snapshot.parent.anchorDigest
    || canonicalJsonV13(anchor.head) !== canonicalJsonV13(manifest.head)
  ) {
    errors.push("delta anchor identity is invalid");
  }
  if (!validDate(anchor.completedAt) || !anchor.repositoryRealpath) {
    errors.push("delta anchor completion identity is invalid");
  } else if (
    !validDate(manifest.completedAt)
    || Date.parse(anchor.completedAt) < Date.parse(manifest.completedAt)
  ) {
    errors.push("delta anchor chronology is invalid");
  }
  const { digest, ...withoutDigest } = anchor;
  if (!validDigest(digest) || digest !== hashCanonicalV13(withoutDigest)) {
    errors.push("delta anchor digest is invalid");
  }
  return errors;
}

function validateParent(parent, errors) {
  if (
    !plainObject(parent)
    || typeof parent.anchorPath !== "string"
    || !validDigest(parent.anchorDigest)
    || !validDigest(parent.policyDigest)
    || !validDigest(parent.snapshotDigest)
  ) {
    errors.push("snapshot parent anchor is invalid");
  }
}

function validateArtifacts(artifacts, errors) {
  const expectedKeys = ["parity", "performance"];
  if (!plainObject(artifacts)
    || !sameStrings(Object.keys(artifacts).sort(), expectedKeys)) {
    errors.push("snapshot artifact set is invalid");
    return;
  }
  for (const key of expectedKeys) {
    const artifact = artifacts[key];
    if (
      !plainObject(artifact)
      || typeof artifact.path !== "string"
      || !validDigest(artifact.canonicalDigest)
      || !validDigest(artifact.sha256)
    ) {
      errors.push(`snapshot ${key} artifact is invalid`);
    }
  }
}

function validateEntries(entries, label, errors) {
  if (!Array.isArray(entries) || entries.length === 0) {
    errors.push(`${label} must be non-empty`);
    return;
  }
  const paths = entries.map((entry) => entry?.path);
  if (
    new Set(paths).size !== paths.length
    || !sameStrings(paths, [...paths].sort())
  ) {
    errors.push(`${label} paths must be unique and sorted`);
  }
  for (const entry of entries) {
    if (!plainObject(entry) || !repositoryPath(entry.path)
      || !validDigest(entry.sha256)) {
      errors.push(`${label} contains an invalid entry`);
    }
  }
}

function validateTransitions(transitions, errors) {
  if (!Array.isArray(transitions)
    || transitions.length !== CD04_DELTA_TRANSITIONS.length) {
    errors.push("snapshot transition set is invalid");
    return;
  }
  for (let index = 0; index < CD04_DELTA_TRANSITIONS.length; index += 1) {
    const expected = CD04_DELTA_TRANSITIONS[index];
    const transition = transitions[index];
    if (
      !plainObject(transition)
      || transition.path !== expected.path
      || transition.targetPath !== expected.targetPath
      || !validDigest(transition.fromSha256)
      || !validDigest(transition.toSha256)
    ) {
      errors.push(`snapshot transition ${index} is invalid`);
    }
  }
}

function repositoryPath(value) {
  return typeof value === "string"
    && value.length > 0
    && !value.startsWith("/")
    && !value.includes("\\")
    && value.split("/").every(
      (segment) => segment && segment !== "." && segment !== "..",
    );
}

function validDigest(value) {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function validDate(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function plainObject(value) {
  return Boolean(
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype,
  );
}

function sameStrings(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}
