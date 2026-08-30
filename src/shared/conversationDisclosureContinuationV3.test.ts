import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";
import {
  CONTINUATION_V3_ALGORITHM,
  CONTINUATION_V3_BASELINE_ARCHIVE_KIND,
  CONTINUATION_V3_BASELINE_ARCHIVE_PATH,
  CONTINUATION_V3_EXECUTABLE_KINDS,
  CONTINUATION_V3_EXECUTABLE_PATH_BY_KIND,
  CONTINUATION_V3_FEATURE_ID,
  CONTINUATION_V3_POLICY_ID,
  CONTINUATION_V3_POLICY_KIND,
  CONTINUATION_V3_REVIEW_LANES,
  CONTINUATION_V3_REVIEW_SNAPSHOT_PATH,
  CONTINUATION_V3_ROUND,
  CONTINUATION_V3_ROUND2_FORBIDDEN_OUTPUT_PATHS,
  CONTINUATION_V3_ROUND2_PREFREEZE_REJECTION_PATH,
  CONTINUATION_V3_ROUND3_GOVERNANCE_TRANSITION_TRUST_ROOTS,
  CONTINUATION_V3_SNAPSHOT_KIND,
  CONTINUATION_V3_SUCCESSOR_CHECKER_VERIFICATION,
  CONTINUATION_V3_SUCCESSOR_HARNESS_VERIFICATION,
  CONTINUATION_V3_WORKSTREAM_ID,
  buildAdmissionCoverageV3,
  hashCanonicalV3,
  serializeRound2PrefreezeRejectionV3,
  sha256BytesV3,
  stableProgramRootDefinitionV3,
  stableWorkstreamDefinitionV3,
  validateAdmissionCoverageV3,
  validateBaselineArchiveV3,
  validateContinuationPolicyV3,
  validateReviewSnapshotV3,
  validateRound2PrefreezeRejectionV3,
  withCanonicalDigestV3,
// @ts-expect-error -- governance scripts are runtime-checked .mjs modules.
} from "../../scripts/conversation-disclosure-continuation-contract-v3.mjs";

const root = path.resolve(__dirname, "../..");
const zeroDigest = `sha256:${"0".repeat(64)}`;
const witnessBytes = readFileSync(path.join(
  root,
  CONTINUATION_V3_ROUND2_PREFREEZE_REJECTION_PATH,
));
const witness = JSON.parse(witnessBytes.toString("utf8"));
const v2Policy = JSON.parse(readFileSync(path.join(
  root,
  ".zerox/verification/conversation-disclosure/CD03A-round2-successor-evolution-policy.json",
), "utf8"));
const v2Archive = JSON.parse(readFileSync(path.join(
  root,
  ".zerox/verification/conversation-disclosure/CD03A-round2-baseline-archive.json",
), "utf8"));
const liveProgram = JSON.parse(readFileSync(path.join(
  root,
  ".zerox/conversation-disclosure-program.json",
), "utf8"));

function v3ReviewOutputs() {
  return [
    CONTINUATION_V3_REVIEW_SNAPSHOT_PATH,
    ...CONTINUATION_V3_REVIEW_LANES.map((lane: string) =>
      `.zerox/verification/conversation-disclosure/CD03A-round3-${lane}-review.json`),
    ".zerox/verification/conversation-disclosure/CD03A-round3-closure-manifest.json",
    ".zerox/verification/conversation-disclosure/CD03A-round3-external-attestation.json",
  ].sort();
}

function makePolicy() {
  const reviewOutputs = v3ReviewOutputs();
  const featureDefinition = structuredClone(v2Policy.admission.featureDefinition);
  featureDefinition.files = [...new Set([
    ...featureDefinition.files,
    CONTINUATION_V3_ROUND2_PREFREEZE_REJECTION_PATH,
    CONTINUATION_V3_BASELINE_ARCHIVE_PATH,
    ".zerox/verification/conversation-disclosure/CD03A-round3-successor-evolution-policy.json",
    ...Object.values(CONTINUATION_V3_EXECUTABLE_PATH_BY_KIND as Record<string, string>),
    ...CONTINUATION_V3_ROUND3_GOVERNANCE_TRANSITION_TRUST_ROOTS
      .map((entry: any) => entry.stagedTargetPath),
    ...reviewOutputs,
  ])];
  const admission = {
    workstreamDefinition: stableWorkstreamDefinitionV3(liveProgram.workstreams.find(
      (entry: any) => entry.id === CONTINUATION_V3_WORKSTREAM_ID,
    )),
    workstreamDefinitionDigest: zeroDigest,
    featureDefinition,
    featureDefinitionDigest: hashCanonicalV3(featureDefinition),
    featureFileSetDigest: hashCanonicalV3(featureDefinition.files),
    postReviewMutablePaths: structuredClone(v2Policy.admission.postReviewMutablePaths),
    reviewCoverageDigest: zeroDigest,
    reviewOutputPaths: reviewOutputs,
  };
  admission.workstreamDefinitionDigest = hashCanonicalV3(admission.workstreamDefinition);
  const transitions = CONTINUATION_V3_ROUND3_GOVERNANCE_TRANSITION_TRUST_ROOTS
    .map((entry: any) => ({ ...entry }));
  const admissionCoverage = buildAdmissionCoverageV3(
    admission,
    transitions,
    witness.verifiedAbsentPaths,
  );
  admission.reviewCoverageDigest = hashCanonicalV3(admissionCoverage);

  const continuationExecutables = CONTINUATION_V3_EXECUTABLE_KINDS.map((kind: string) => ({
    kind,
    path: CONTINUATION_V3_EXECUTABLE_PATH_BY_KIND[kind],
    sha256: `sha256:${String(CONTINUATION_V3_EXECUTABLE_KINDS.indexOf(kind) + 1)
      .repeat(64).slice(0, 64)}`,
  }));
  const trustRoots = [
    ...transitions.map((entry: any) => ({ path: entry.path, sha256: entry.toSha256 })),
    ...continuationExecutables.map(({
      path: executablePath,
      sha256,
    }: { path: string; sha256: string }) => ({
      path: executablePath,
      sha256,
    })),
  ].sort((left, right) => left.path.localeCompare(right.path));

  const successor = structuredClone(v2Policy.successor);
  successor.workstreamDefinition = stableWorkstreamDefinitionV3(
    liveProgram.workstreams.find((entry: any) => entry.id === "CD04"),
  );
  successor.workstreamDefinitionDigest = hashCanonicalV3(successor.workstreamDefinition);
  successor.featureDefinition.verification = successor.featureDefinition.verification
    .map((entry: string) => entry.includes("check-conversation-disclosure-continuation-v2.mjs")
      ? CONTINUATION_V3_SUCCESSOR_CHECKER_VERIFICATION
      : entry.startsWith("node scripts/check-harness-state.mjs --mode authorized_active")
        ? CONTINUATION_V3_SUCCESSOR_HARNESS_VERIFICATION
        : entry);
  successor.featureDefinitionDigest = hashCanonicalV3(successor.featureDefinition);
  const transitionPaths = new Set(transitions.map((entry: any) => entry.path));
  const successorCoverage = [
    ...v2Policy.pathAuthorities.map((entry: any) => ({
      path: entry.path,
      class: entry.class,
    })),
    ...trustRoots.filter((entry: any) => !transitionPaths.has(entry.path))
      .map((entry: any) => ({ path: entry.path, class: "trust_root" })),
    ...transitions.map((entry: any) => ({
      path: entry.path,
      class: "governance_transition",
    })),
  ].filter((entry: any) => successor.featureDefinition.files.includes(entry.path))
    .sort((left, right) => left.path.localeCompare(right.path));
  successor.pathCoverageDigest = hashCanonicalV3(successorCoverage);

  const closedWorld = structuredClone(v2Policy.closedWorld);
  closedWorld.workstreams = liveProgram.workstreams.map((entry: any) => {
    const stableDefinition = stableWorkstreamDefinitionV3(entry);
    return {
      id: entry.id,
      stableDefinition,
      stableDefinitionDigest: hashCanonicalV3(stableDefinition),
    };
  });
  closedWorld.programRootDefinition = stableProgramRootDefinitionV3(liveProgram);
  closedWorld.programRootDefinitionDigest = hashCanonicalV3(
    closedWorld.programRootDefinition,
  );
  delete closedWorld.digest;
  closedWorld.digest = hashCanonicalV3(closedWorld);
  return withCanonicalDigestV3({
    schemaVersion: 3,
    kind: CONTINUATION_V3_POLICY_KIND,
    algorithm: CONTINUATION_V3_ALGORITHM,
    policyId: CONTINUATION_V3_POLICY_ID,
    programId: v2Policy.programId,
    workstreamId: CONTINUATION_V3_WORKSTREAM_ID,
    featureId: CONTINUATION_V3_FEATURE_ID,
    round: CONTINUATION_V3_ROUND,
    status: "frozen",
    parentEvidence: structuredClone(v2Policy.parentEvidence),
    round1Rejection: structuredClone(v2Policy.round1Rejection),
    round2PrefreezeRejection: structuredClone(witness),
    closedWorld,
    admission,
    admissionCoverage,
    successor,
    pathAuthorities: structuredClone(v2Policy.pathAuthorities),
    trustRoots,
    governanceTransitions: transitions,
    continuationExecutables,
    baselineArchive: {
      path: CONTINUATION_V3_BASELINE_ARCHIVE_PATH,
      digest: zeroDigest,
      entrySetDigest: zeroDigest,
    },
    reviewSnapshot: { path: CONTINUATION_V3_REVIEW_SNAPSHOT_PATH },
    timePolicy: { futureToleranceMs: 0 },
  });
}

function makeSnapshot(policy: any) {
  const frozenFiles = policy.admissionCoverage
    .filter((entry: any) => entry.class === "frozen_file")
    .map((entry: any) => ({ path: entry.path, sha256: zeroDigest }));
  const frozenByPath = new Map<string, { path: string; sha256: string }>(
    frozenFiles.map((entry: any) => [entry.path, entry]),
  );
  for (const reference of [
    policy.round1Rejection.policy,
    policy.round1Rejection.snapshot,
    ...policy.round1Rejection.receipts,
  ]) frozenByPath.get(reference.path)!.sha256 = reference.byteSha256;
  frozenByPath.get(CONTINUATION_V3_ROUND2_PREFREEZE_REJECTION_PATH)!.sha256 =
    sha256BytesV3(serializeRound2PrefreezeRejectionV3(witness));
  frozenFiles.sort((left: any, right: any) => left.path.localeCompare(right.path));
  const baselineFiles: Array<{ path: string; sha256: string }> = [];
  const absentPaths = new Set<string>([
    ...policy.round1Rejection.forbiddenRepositoryOutputs,
    ...policy.round2PrefreezeRejection.verifiedAbsentPaths,
  ]);
  for (const authority of policy.pathAuthorities) {
    if (authority.class === "modify"
      && authority.baseline.source === "cd03a_review_snapshot") {
      baselineFiles.push({ path: authority.path, sha256: authority.baseline.sha256 });
    } else if (authority.class === "create") {
      absentPaths.add(authority.path);
    } else if (authority.class === "bookkeeping") {
      if (authority.baseline.presence === "present") {
        baselineFiles.push({ path: authority.path, sha256: authority.baseline.sha256 });
      } else absentPaths.add(authority.path);
    }
  }
  baselineFiles.sort((left, right) => left.path.localeCompare(right.path));
  return withCanonicalDigestV3({
    schemaVersion: 3,
    kind: CONTINUATION_V3_SNAPSHOT_KIND,
    algorithm: CONTINUATION_V3_ALGORITHM,
    programId: policy.programId,
    workstreamId: CONTINUATION_V3_WORKSTREAM_ID,
    featureId: CONTINUATION_V3_FEATURE_ID,
    round: CONTINUATION_V3_ROUND,
    frozenAt: "2026-08-24T00:00:00.000Z",
    parentEvidenceBundleDigest: policy.parentEvidence.bundleDigest,
    policyDigest: policy.digest,
    closedWorldDigest: policy.closedWorld.digest,
    pathAuthorityDigest: hashCanonicalV3(policy.pathAuthorities),
    admissionFeatureDefinitionDigest: policy.admission.featureDefinitionDigest,
    admissionFeatureFileSetDigest: policy.admission.featureFileSetDigest,
    successorWorkstreamDefinitionDigest: policy.successor.workstreamDefinitionDigest,
    successorFeatureDefinitionDigest: policy.successor.featureDefinitionDigest,
    baselineArchive: policy.baselineArchive,
    frozenFiles,
    transitionPayloadFiles: policy.governanceTransitions.map((entry: any) => ({
      path: entry.stagedTargetPath,
      sha256: entry.toSha256,
    })).sort((left: any, right: any) => left.path.localeCompare(right.path)),
    baselineFiles,
    absentPaths: [...absentPaths].sort(),
    reviewOutputAbsentPaths: [...policy.admission.reviewOutputPaths],
    governanceTransitions: policy.governanceTransitions,
  });
}

describe("conversation disclosure continuation contract v3", () => {
  test("accepts the deterministic Round2 pre-freeze witness and rejects old-byte drift", () => {
    expect(serializeRound2PrefreezeRejectionV3(witness)).toEqual(witnessBytes);
    expect(validateRound2PrefreezeRejectionV3(witness)).toEqual([]);
    const drifted = structuredClone(witness);
    drifted.transitionPayloadFiles[0].sha256 = zeroDigest;
    drifted.digest = hashCanonicalV3(Object.fromEntries(
      Object.entries(drifted).filter(([key]) => key !== "digest"),
    ));
    expect(validateRound2PrefreezeRejectionV3(drifted).join("\n"))
      .toContain("exact four transition payloads");
  });

  test("makes admission coverage explicit and classifies every Round3 target only as transition_payload", () => {
    const policy = makePolicy();
    expect(validateAdmissionCoverageV3(
      policy.admissionCoverage,
      policy.admission,
      policy.governanceTransitions,
      policy.round2PrefreezeRejection.verifiedAbsentPaths,
    )).toEqual([]);
    for (const transition of policy.governanceTransitions) {
      expect(policy.admissionCoverage.filter((entry: any) =>
        entry.path === transition.stagedTargetPath)).toEqual([{
        path: transition.stagedTargetPath,
        class: "transition_payload",
      }]);
    }
    expect(policy.admissionCoverage.filter((entry: any) =>
      entry.class === "rejected_output_absent").map((entry: any) => entry.path))
      .toEqual(CONTINUATION_V3_ROUND2_FORBIDDEN_OUTPUT_PATHS);
    expect(validateContinuationPolicyV3(policy)).toEqual([]);
  });

  test("rejects the Round2 target double-classification regression", () => {
    const policy = makePolicy();
    const target = policy.governanceTransitions[0].stagedTargetPath;
    policy.admissionCoverage.find((entry: any) => entry.path === target).class =
      "frozen_file";
    policy.admission.reviewCoverageDigest = hashCanonicalV3(policy.admissionCoverage);
    policy.digest = hashCanonicalV3(Object.fromEntries(
      Object.entries(policy).filter(([key]) => key !== "digest"),
    ));
    expect(validateContinuationPolicyV3(policy).join("\n"))
      .toContain("transition target must be classified only as transition_payload");
  });

  test("rejects reclassifying rejected Round2 outputs as frozen or current review outputs", () => {
    for (const invalidClass of ["frozen_file", "review_output_absent"]) {
      const policy = makePolicy();
      const rejectedPath = policy.round2PrefreezeRejection.verifiedAbsentPaths[0];
      policy.admissionCoverage.find((entry: any) => entry.path === rejectedPath).class =
        invalidClass;
      policy.admission.reviewCoverageDigest = hashCanonicalV3(policy.admissionCoverage);
      policy.digest = hashCanonicalV3(Object.fromEntries(
        Object.entries(policy).filter(([key]) => key !== "digest"),
      ));
      expect(validateContinuationPolicyV3(policy).join("\n"))
        .toContain("witness absence set");
    }
  });

  test("round-trips the production policy shape into a snapshot with a separate transitionPayloadFiles category", () => {
    const policy = makePolicy();
    const snapshot = makeSnapshot(policy);
    expect(validateReviewSnapshotV3(snapshot, policy, {
      verifierNow: Date.parse(snapshot.frozenAt),
    })).toEqual([]);
    const payloadPaths = new Set(snapshot.transitionPayloadFiles
      .map((entry: any) => entry.path));
    expect(snapshot.frozenFiles.some((entry: any) => payloadPaths.has(entry.path)))
      .toBe(false);
  });

  test("rejects payload overlap and Round2 absence drift", () => {
    const policy = makePolicy();
    const overlap = makeSnapshot(policy);
    overlap.frozenFiles.push(structuredClone(overlap.transitionPayloadFiles[0]));
    overlap.frozenFiles.sort((left: any, right: any) => left.path.localeCompare(right.path));
    overlap.digest = hashCanonicalV3(Object.fromEntries(
      Object.entries(overlap).filter(([key]) => key !== "digest"),
    ));
    expect(validateReviewSnapshotV3(overlap, policy, {
      verifierNow: Date.parse(overlap.frozenAt),
    }).join("\n")).toContain("overlaps");

    const absenceDrift = makeSnapshot(policy);
    absenceDrift.absentPaths = absenceDrift.absentPaths.slice(1);
    absenceDrift.digest = hashCanonicalV3(Object.fromEntries(
      Object.entries(absenceDrift).filter(([key]) => key !== "digest"),
    ));
    expect(validateReviewSnapshotV3(absenceDrift, policy, {
      verifierNow: Date.parse(absenceDrift.frozenAt),
    }).join("\n")).toContain("rejection absence");
  });

  test("accepts the deterministic v2-to-v3 baseline archive migration shape", () => {
    const archive = structuredClone(v2Archive);
    archive.schemaVersion = 3;
    archive.kind = CONTINUATION_V3_BASELINE_ARCHIVE_KIND;
    archive.round = 3;
    delete archive.digest;
    archive.digest = hashCanonicalV3(archive);
    expect(validateBaselineArchiveV3(archive)).toEqual([]);
  });
});
