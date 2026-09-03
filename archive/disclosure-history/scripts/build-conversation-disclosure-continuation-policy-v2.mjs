#!/usr/bin/env node

import { constants } from "node:fs";
import { lstat, open, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  CONTINUATION_V2_ALGORITHM,
  CONTINUATION_V2_BASELINE_ARCHIVE_PATH,
  CONTINUATION_V2_BOOKKEEPING_VALIDATORS,
  CONTINUATION_V2_EXECUTABLE_KINDS,
  CONTINUATION_V2_EXTERNAL_ATTESTATION_PATH,
  CONTINUATION_V2_EXTERNAL_EVIDENCE_ROLES,
  CONTINUATION_V2_FEATURE_ID,
  CONTINUATION_V2_GOVERNANCE_TRANSITIONS,
  CONTINUATION_V2_LIFECYCLE_PHASES,
  CONTINUATION_V2_POLICY_ID,
  CONTINUATION_V2_POLICY_KIND,
  CONTINUATION_V2_POLICY_PATH,
  CONTINUATION_V2_ROUND1_FORBIDDEN_OUTPUT_PATHS,
  CONTINUATION_V2_ROUND1_POLICY_PATH,
  CONTINUATION_V2_ROUND1_REJECTION_TRUST_ROOT,
  CONTINUATION_V2_ROUND1_SNAPSHOT_PATH,
  CONTINUATION_V2_REQUIRED_PARENT_REPOSITORY_PATHS,
  CONTINUATION_V2_REVIEW_LANES,
  CONTINUATION_V2_REVIEW_SNAPSHOT_PATH,
  CONTINUATION_V2_ROUND,
  CONTINUATION_V2_SUCCESSOR_FEATURE_ID,
  CONTINUATION_V2_SUCCESSOR_WORKSTREAM_ID,
  CONTINUATION_V2_WORKSTREAM_ID,
  canonicalJsonV2,
  hashCanonicalV2,
  repositoryPathV2,
  sha256BytesV2,
  sha256DigestV2,
  stableFeatureDefinitionV2,
  stableHistoricalFeatureDefinitionV2,
  stableProgramRootDefinitionV2,
  stableWorkstreamDefinitionV2,
  validateBaselineArchiveV2,
  validateContinuationPolicyV2,
  validateLifecycleStateV2,
  withCanonicalDigestV2,
} from "./conversation-disclosure-continuation-contract-v2.mjs";
import {
  validateContinuationPolicy as validateRound1Policy,
  validateContinuationReviewReceipt as validateRound1ReviewReceipt,
  validateContinuationReviewSnapshot as validateRound1ReviewSnapshot,
} from "./conversation-disclosure-continuation-contract.mjs";

const PROGRAM_PATH = ".zerox/conversation-disclosure-program.json";
const FEATURE_LIST_PATH = ".zerox/feature_list.json";
const ROUND1_POLICY_PATH = CONTINUATION_V2_ROUND1_POLICY_PATH;
const ROUND1_SNAPSHOT_PATH = CONTINUATION_V2_ROUND1_SNAPSHOT_PATH;
const ROUND23_ARTIFACT_PATH =
  ".zerox/verification/conversation-disclosure/CD03-causal-shadow.json";
const ROUND23_SNAPSHOT_PATH =
  ".zerox/verification/conversation-disclosure/CD03-round23-review-snapshot.json";
const ROUND23_MANIFEST_PATH =
  ".zerox/verification/conversation-disclosure/CD03-round23-closure-manifest.json";
const ROUND23_ATTESTATION_PATH =
  ".zerox/verification/conversation-disclosure/CD03-round23-external-attestation.json";
const ROUND23_VALIDATOR_PATH = "scripts/check-conversation-disclosure-program.mjs";
const ROUND23_RUNNER_PATH = "scripts/verify-conversation-disclosure-closure.mjs";

export const CONTINUATION_POLICY_V2_EXPECTED_WORKSTREAM_IDS = Object.freeze([
  "CD01", "CD02", "CD03", "CD03A", "CD04", "CD05", "CD06", "CD07", "CD08", "CD09",
]);
export const CONTINUATION_POLICY_V2_HISTORICAL_FEATURE_IDS_DIGEST =
  "sha256:ec8b970a130f1767b6c06c7eefe83c3c2d6f04330431c98ea5c6a818986f2400";
export const CONTINUATION_POLICY_V2_ADMISSION_FILE_COUNT = 55;
export const CONTINUATION_POLICY_V2_ADMISSION_FILE_SET_DIGEST =
  "sha256:cdaee01c09476d3657436f43447f7067b6acd10aeff2b7c7bbf76bf39f096447";
export const CONTINUATION_POLICY_V2_ADMISSION_FEATURE_DEFINITION_DIGEST =
  "sha256:eb19b5c3774f4e5801bec952331aafe24911a39797fe1381863bfee9b1e1191d";
export const CONTINUATION_POLICY_V2_ADMISSION_WORKSTREAM_DEFINITION_DIGEST =
  "sha256:c807b86cb9d82df9a4a17f21a3cb1dd2a5a00325920834012318f0bd4b685a51";

const TARGET_PATH_BY_LIVE_PATH = Object.freeze({
  "package.json":
    ".zerox/verification/conversation-disclosure/CD03A-round2-package.target.json",
  "scripts/check-harness-state.mjs":
    ".zerox/verification/conversation-disclosure/CD03A-round2-harness.target.mjs",
  "src/shared/conversationDisclosureProgram.test.ts":
    ".zerox/verification/conversation-disclosure/CD03A-round2-program-test.target.ts",
  "src/shared/packageScripts.test.ts":
    ".zerox/verification/conversation-disclosure/CD03A-round2-package-scripts-test.target.ts",
});

const EXECUTABLE_PATH_BY_KIND = Object.freeze({
  checker: "scripts/check-conversation-disclosure-continuation-v2.mjs",
  contract: "scripts/conversation-disclosure-continuation-contract-v2.mjs",
  freezer: "scripts/freeze-conversation-disclosure-continuation-v2.mjs",
  governance: "scripts/conversation-disclosure-program-governance-v2.mjs",
  runner: "scripts/verify-conversation-disclosure-continuation-v2.mjs",
});

const POST_REVIEW_MUTABLE_PATHS = Object.freeze([
  PROGRAM_PATH,
  FEATURE_LIST_PATH,
  ".zerox/progress.md",
  "findings.md",
  "progress.md",
  "task_plan.md",
]);

const REVIEW_OUTPUT_PATHS = Object.freeze([
  CONTINUATION_V2_REVIEW_SNAPSHOT_PATH,
  ...CONTINUATION_V2_REVIEW_LANES.map((lane) =>
    `.zerox/verification/conversation-disclosure/CD03A-round2-${lane}-review.json`),
  ".zerox/verification/conversation-disclosure/CD03A-round2-closure-manifest.json",
  CONTINUATION_V2_EXTERNAL_ATTESTATION_PATH,
].sort());

const SUCCESSOR_LEGACY_TRANSITION_PATHS = Object.freeze([
  "package.json",
  "src/shared/conversationDisclosureProgram.test.ts",
  "src/shared/packageScripts.test.ts",
]);

const ROUND1_V1_CHECKER_VERIFICATION =
  "node scripts/check-conversation-disclosure-continuation.mjs --base-anchor CALLER_SUPPLIED_BASE_PATH --expected-base-anchor-digest sha256:e81f0afb3d10b12976b74d1499870b837595ffbc3b452c7f1f78fff67be8f102 --continuation-anchor CALLER_SUPPLIED_CONTINUATION_PATH --expected-continuation-anchor-digest CALLER_SUPPLIED_CONTINUATION_DIGEST";
const ROUND1_V1_HARNESS_VERIFICATION =
  "node scripts/check-harness-state.mjs --base-anchor CALLER_SUPPLIED_BASE_PATH --expected-base-anchor-digest sha256:e81f0afb3d10b12976b74d1499870b837595ffbc3b452c7f1f78fff67be8f102 --continuation-anchor CALLER_SUPPLIED_CONTINUATION_PATH --expected-continuation-anchor-digest CALLER_SUPPLIED_CONTINUATION_DIGEST";
const V2_ORDINARY_ARGUMENTS =
  "--mode authorized_active --control-root CALLER_SUPPLIED_CONTROL_ROOT --subject-repository-realpath CALLER_SUPPLIED_SUBJECT_REPOSITORY_REALPATH --base-anchor CALLER_SUPPLIED_BASE_PATH --expected-base-anchor-digest CALLER_SUPPLIED_BASE_DIGEST --expected-policy-digest CALLER_SUPPLIED_POLICY_DIGEST --expected-snapshot-digest CALLER_SUPPLIED_SNAPSHOT_DIGEST --continuation-anchor CALLER_SUPPLIED_CONTINUATION_PATH --expected-continuation-anchor-digest CALLER_SUPPLIED_CONTINUATION_DIGEST";
export const CONTINUATION_POLICY_V2_SUCCESSOR_CHECKER_VERIFICATION =
  `node scripts/check-conversation-disclosure-continuation-v2.mjs ${V2_ORDINARY_ARGUMENTS}`;
export const CONTINUATION_POLICY_V2_SUCCESSOR_HARNESS_VERIFICATION =
  `node scripts/check-harness-state.mjs ${V2_ORDINARY_ARGUMENTS}`;

const CD04_EVIDENCE_PATHS = new Set([
  ".zerox/verification/conversation-disclosure/CD04-performance-baseline.json",
  ".zerox/verification/conversation-disclosure/CD04-shadow-parity.json",
  ".zerox/reviews/CD04-shadow-parity-review.md",
]);

export async function buildConversationDisclosureContinuationPolicyV2({
  repositoryRoot = process.cwd(),
  baseAnchorPath,
  expectedBaseAnchorDigest,
  outputPath,
  expectedHistoricalFeatureIdsDigest =
    CONTINUATION_POLICY_V2_HISTORICAL_FEATURE_IDS_DIGEST,
  expectedWorkstreamIds = CONTINUATION_POLICY_V2_EXPECTED_WORKSTREAM_IDS,
} = {}) {
  const root = await canonicalDirectory(repositoryRoot, "repository root");
  if (!path.isAbsolute(baseAnchorPath ?? "")) {
    throw new Error("--base-anchor must be an absolute canonical path");
  }
  if (!sha256DigestV2(expectedBaseAnchorDigest)) {
    throw new Error("--expected-base-anchor-digest must be SHA-256");
  }
  const canonicalBaseAnchorPath = await realpath(baseAnchorPath);
  if (canonicalBaseAnchorPath !== baseAnchorPath) {
    throw new Error("--base-anchor must not traverse an alias or symlink");
  }
  if (isWithin(root, canonicalBaseAnchorPath)) {
    throw new Error("base anchor must remain outside the repository");
  }

  const repositoryCaptures = new Map();
  const readRepository = async (relativePath, label = relativePath) => {
    if (!repositoryPathV2(relativePath)) {
      throw new Error(`${label} is not a repository-relative path`);
    }
    if (!repositoryCaptures.has(relativePath)) {
      repositoryCaptures.set(relativePath, await readStableFile(
        path.join(root, relativePath),
        label,
        { expectedRoot: root },
      ));
    }
    return repositoryCaptures.get(relativePath);
  };
  const readRepositoryJson = async (relativePath, label = relativePath) =>
    parseJson((await readRepository(relativePath, label)).bytes, label);

  const [archive, program, featureList, round1Policy, round1Snapshot] = await Promise.all([
    readRepositoryJson(CONTINUATION_V2_BASELINE_ARCHIVE_PATH, "Round2 baseline archive"),
    readRepositoryJson(PROGRAM_PATH, "conversation disclosure program"),
    readRepositoryJson(FEATURE_LIST_PATH, "Feature list"),
    readRepositoryJson(ROUND1_POLICY_PATH, "Round1 continuation policy"),
    readRepositoryJson(ROUND1_SNAPSHOT_PATH, "Round1 continuation snapshot"),
  ]);
  assertCanonicalDigest(archive, "Round2 baseline archive");
  assertNoErrors(validateBaselineArchiveV2(archive), "Round2 baseline archive");
  assertCanonicalDigest(round1Policy, "Round1 continuation policy");

  const parentEvidence = await buildParentEvidenceV2({
    root,
    baseAnchorPath: canonicalBaseAnchorPath,
    expectedBaseAnchorDigest,
    readRepository,
    readRepositoryJson,
  });
  const round1Rejection = await buildRound1RejectionV2({
    root,
    round1Policy,
    round1Snapshot,
    readRepository,
    readRepositoryJson,
  });

  const transitions = await buildGovernanceTransitions({ archive, readRepository });
  const admission = buildAdmission({
    program,
    featureList,
    transitions,
  });
  const successor = await buildSuccessor({
    root,
    archive,
    program,
    round1Policy,
    transitions,
    readRepository,
  });
  const closedWorld = buildClosedWorld({
    program,
    featureList,
    admission,
    successor,
    expectedHistoricalFeatureIdsDigest,
    expectedWorkstreamIds,
  });
  const { continuationExecutables, trustRoots } = await buildTrustRoots({
    transitions,
    readRepository,
  });
  const baselineArchive = {
    path: CONTINUATION_V2_BASELINE_ARCHIVE_PATH,
    digest: archive.digest,
    entrySetDigest: archive.entrySetDigest,
  };
  const { pathAuthorities, ...successorDefinition } = successor;
  const policy = withCanonicalDigestV2({
    schemaVersion: 2,
    kind: CONTINUATION_V2_POLICY_KIND,
    algorithm: CONTINUATION_V2_ALGORITHM,
    policyId: CONTINUATION_V2_POLICY_ID,
    programId: program.programId,
    workstreamId: CONTINUATION_V2_WORKSTREAM_ID,
    featureId: CONTINUATION_V2_FEATURE_ID,
    round: CONTINUATION_V2_ROUND,
    status: "frozen",
    parentEvidence,
    round1Rejection,
    closedWorld,
    admission,
    successor: successorDefinition,
    pathAuthorities,
    trustRoots,
    governanceTransitions: transitions,
    continuationExecutables,
    baselineArchive,
    reviewSnapshot: { path: CONTINUATION_V2_REVIEW_SNAPSHOT_PATH },
    timePolicy: { futureToleranceMs: 0 },
  });
  assertNoErrors(validateContinuationPolicyV2(policy, {
    expectedDigest: policy.digest,
    baselineArchive: archive,
    liveAdmissionFeature: featureList.features.find(
      (entry) => entry?.id === CONTINUATION_V2_FEATURE_ID,
    ),
    liveAdmissionWorkstream: program.workstreams.find(
      (entry) => entry?.id === CONTINUATION_V2_WORKSTREAM_ID,
    ),
    liveProgram: program,
    lifecycleState: createLiveLifecycle(
      closedWorld.lifecycleProfiles[0],
      closedWorld,
      admission,
      successor,
    ),
    parentEvidence: {
      requiredRepositoryEvidence: parentEvidence.repositoryEvidence,
      requiredExternalEvidence: parentEvidence.externalEvidence,
    },
  }), "generated continuation policy v2");
  assertNoErrors(validateBaselineArchiveV2(archive, policy),
    "generated policy archive coverage");
  for (const profile of closedWorld.lifecycleProfiles) {
    assertNoErrors(validateLifecycleStateV2(
      createLiveLifecycle(profile, closedWorld, admission, successor),
      policy,
    ), `generated lifecycle ${profile.phase}`);
  }

  const bytes = Buffer.from(`${JSON.stringify(policy, null, 2)}\n`, "utf8");
  if (outputPath !== undefined) {
    const absoluteOutput = path.isAbsolute(outputPath)
      ? outputPath
      : path.join(root, outputPath);
    if (!isWithin(root, path.resolve(absoluteOutput))) {
      throw new Error("--output must remain inside the repository");
    }
    await publishExactNoOverwrite(absoluteOutput, bytes, root);
  }
  return { policy, bytes };
}

export function validateHistoricalFeatureRosterV2(
  featureList,
  expectedDigest = CONTINUATION_POLICY_V2_HISTORICAL_FEATURE_IDS_DIGEST,
) {
  const features = Array.isArray(featureList?.features) ? featureList.features : [];
  const ids = features.filter((entry) =>
    entry?.id !== CONTINUATION_V2_FEATURE_ID
      && entry?.id !== CONTINUATION_V2_SUCCESSOR_FEATURE_ID).map((entry) => entry?.id);
  if (new Set(ids).size !== ids.length || hashCanonicalV2(ids) !== expectedDigest) {
    throw new Error("historical Feature roster/order differs from the builder trust root");
  }
  return ids;
}

export function projectSuccessorVerificationV2(verification) {
  if (!Array.isArray(verification)) {
    throw new Error("Round1 P108 verification must be an array");
  }
  const checkerIndexes = verification.flatMap((entry, index) =>
    entry === ROUND1_V1_CHECKER_VERIFICATION ? [index] : []);
  const harnessIndexes = verification.flatMap((entry, index) =>
    entry === ROUND1_V1_HARNESS_VERIFICATION ? [index] : []);
  if (checkerIndexes.length !== 1 || harnessIndexes.length !== 1) {
    throw new Error(
      "Round1 P108 descriptor must contain exactly one v1 checker and one v1 harness command",
    );
  }
  const projected = verification.map((entry, index) => {
    if (index === checkerIndexes[0]) {
      return CONTINUATION_POLICY_V2_SUCCESSOR_CHECKER_VERIFICATION;
    }
    if (index === harnessIndexes[0]) {
      return CONTINUATION_POLICY_V2_SUCCESSOR_HARNESS_VERIFICATION;
    }
    return entry;
  });
  if (projected.some((entry) => typeof entry !== "string"
    || entry.includes("scripts/check-conversation-disclosure-continuation.mjs"))) {
    throw new Error("projected P108 verification retains an invalid or v1 checker command");
  }
  return projected;
}

async function buildRound1RejectionV2({
  root,
  round1Policy,
  round1Snapshot,
  readRepository,
  readRepositoryJson,
}) {
  const policyCapture = await readRepository(
    ROUND1_POLICY_PATH,
    "Round1 continuation policy bytes",
  );
  const snapshotCapture = await readRepository(
    ROUND1_SNAPSHOT_PATH,
    "Round1 continuation snapshot bytes",
  );
  if (policyCapture.digest
      !== CONTINUATION_V2_ROUND1_REJECTION_TRUST_ROOT.policy.byteSha256
    || round1Policy.digest
      !== CONTINUATION_V2_ROUND1_REJECTION_TRUST_ROOT.policy.canonicalDigest
    || snapshotCapture.digest
      !== CONTINUATION_V2_ROUND1_REJECTION_TRUST_ROOT.snapshot.byteSha256
    || round1Snapshot.digest
      !== CONTINUATION_V2_ROUND1_REJECTION_TRUST_ROOT.snapshot.digest
    || round1Snapshot.files?.length
      !== CONTINUATION_V2_ROUND1_REJECTION_TRUST_ROOT.snapshot.fileCount) {
    throw new Error("Round1 policy/snapshot differs from the rejection trust root");
  }
  assertNoErrors(validateRound1Policy(round1Policy), "Round1 continuation policy");
  assertNoErrors(
    validateRound1ReviewSnapshot(round1Snapshot, round1Policy),
    "Round1 continuation snapshot",
  );

  const receipts = [];
  for (const lane of CONTINUATION_V2_REVIEW_LANES) {
    const relativePath =
      `.zerox/verification/conversation-disclosure/CD03A-round1-${lane}-review.json`;
    const [receipt, capture] = await Promise.all([
      readRepositoryJson(relativePath, `Round1 ${lane} failed receipt`),
      readRepository(relativePath, `Round1 ${lane} failed receipt bytes`),
    ]);
    assertNoErrors(
      validateRound1ReviewReceipt(receipt, round1Snapshot, round1Policy),
      `Round1 ${lane} failed receipt`,
    );
    const expected = CONTINUATION_V2_ROUND1_REJECTION_TRUST_ROOT.receipts[lane];
    if (receipt.lane !== lane || receipt.verdict !== "failed"
      || canonicalJsonV2(receipt.findingCounts) !== canonicalJsonV2(expected.findingCounts)
      || capture.digest !== expected.byteSha256
      || hashCanonicalV2(receipt) !== expected.canonicalDigest
      || Date.parse(receipt.completedAt) > Date.now()) {
      throw new Error(`Round1 ${lane} receipt differs from the failed trust root`);
    }
    receipts.push({
      lane,
      path: relativePath,
      verdict: "failed",
      findingCounts: expected.findingCounts,
      canonicalDigest: expected.canonicalDigest,
      byteSha256: expected.byteSha256,
    });
  }

  for (const relativePath of CONTINUATION_V2_ROUND1_FORBIDDEN_OUTPUT_PATHS) {
    const planted = await readOptionalStableFile(
      path.join(root, relativePath),
      `forbidden Round1 output ${relativePath}`,
      root,
    );
    if (planted) throw new Error(`forbidden Round1 output is present: ${relativePath}`);
  }

  return withCanonicalDigestV2({
    round: 1,
    status: "rejected",
    policy: {
      path: ROUND1_POLICY_PATH,
      canonicalDigest:
        CONTINUATION_V2_ROUND1_REJECTION_TRUST_ROOT.policy.canonicalDigest,
      byteSha256: CONTINUATION_V2_ROUND1_REJECTION_TRUST_ROOT.policy.byteSha256,
    },
    snapshot: {
      path: ROUND1_SNAPSHOT_PATH,
      digest: CONTINUATION_V2_ROUND1_REJECTION_TRUST_ROOT.snapshot.digest,
      fileCount: CONTINUATION_V2_ROUND1_REJECTION_TRUST_ROOT.snapshot.fileCount,
      byteSha256:
        CONTINUATION_V2_ROUND1_REJECTION_TRUST_ROOT.snapshot.byteSha256,
    },
    receipts,
    forbiddenRepositoryOutputs: [...CONTINUATION_V2_ROUND1_FORBIDDEN_OUTPUT_PATHS],
  });
}

function buildAdmission({ program, featureList, transitions }) {
  const feature = featureList.features?.find(
    (entry) => entry?.id === CONTINUATION_V2_FEATURE_ID,
  );
  const workstream = program.workstreams?.find(
    (entry) => entry?.id === CONTINUATION_V2_WORKSTREAM_ID,
  );
  if (!feature || feature.status !== "in_progress" || !workstream
    || workstream.state !== "in_progress") {
    throw new Error("live P107A admission Feature/workstream is unavailable");
  }
  const featureDefinition = stableFeatureDefinitionV2(feature);
  const workstreamDefinition = stableWorkstreamDefinitionV2(workstream);
  if (featureDefinition.files.length !== CONTINUATION_POLICY_V2_ADMISSION_FILE_COUNT
    || hashCanonicalV2(featureDefinition.files)
      !== CONTINUATION_POLICY_V2_ADMISSION_FILE_SET_DIGEST
    || hashCanonicalV2(featureDefinition)
      !== CONTINUATION_POLICY_V2_ADMISSION_FEATURE_DEFINITION_DIGEST
    || hashCanonicalV2(workstreamDefinition)
      !== CONTINUATION_POLICY_V2_ADMISSION_WORKSTREAM_DEFINITION_DIGEST) {
    throw new Error("live P107A admission differs from the closed-world builder trust root");
  }
  const files = new Set(featureDefinition.files);
  const transitionLive = new Set(transitions.map((entry) => entry.path));
  const transitionTargets = new Set(transitions.map((entry) => entry.stagedTargetPath));
  const postReviewMutable = new Set(POST_REVIEW_MUTABLE_PATHS);
  const reviewOutputs = new Set(REVIEW_OUTPUT_PATHS);
  for (const required of [
    ...transitionLive,
    ...transitionTargets,
    ...postReviewMutable,
    ...reviewOutputs,
    ...Object.values(EXECUTABLE_PATH_BY_KIND),
  ]) {
    if (!files.has(required)) {
      throw new Error(`P107A live Feature misses classified path: ${required}`);
    }
  }
  const coverage = featureDefinition.files.map((relativePath) => {
    const classes = [
      transitionLive.has(relativePath) ? "transition_live" : null,
      transitionTargets.has(relativePath) ? "transition_target" : null,
      postReviewMutable.has(relativePath) ? "post_review_mutable" : null,
      reviewOutputs.has(relativePath) ? "review_output_absent" : null,
    ].filter(Boolean);
    if (classes.length > 1) {
      throw new Error(`P107A path has overlapping admission classes: ${relativePath}`);
    }
    return { path: relativePath, class: classes[0] ?? "frozen_file" };
  }).sort(comparePath);
  return {
    workstreamDefinition,
    workstreamDefinitionDigest: hashCanonicalV2(workstreamDefinition),
    featureDefinition,
    featureDefinitionDigest: hashCanonicalV2(featureDefinition),
    featureFileSetDigest: hashCanonicalV2(featureDefinition.files),
    postReviewMutablePaths: [...POST_REVIEW_MUTABLE_PATHS],
    reviewCoverageDigest: hashCanonicalV2(coverage),
    reviewOutputPaths: [...REVIEW_OUTPUT_PATHS],
  };
}

async function buildSuccessor({
  root,
  archive,
  program,
  round1Policy,
  transitions,
  readRepository,
}) {
  const round1 = round1Policy?.successor;
  if (round1?.featureId !== CONTINUATION_V2_SUCCESSOR_FEATURE_ID
    || round1?.workstreamId !== CONTINUATION_V2_SUCCESSOR_WORKSTREAM_ID
    || hashCanonicalV2(round1.featureDefinition) !== round1.featureDefinitionDigest
    || hashCanonicalV2(round1.workstreamDefinition) !== round1.workstreamDefinitionDigest) {
    throw new Error("Round1 P108 descriptor identity is invalid");
  }
  const featureDefinition = structuredClone(round1.featureDefinition);
  featureDefinition.files = featureDefinition.files.filter(
    (relativePath) => !SUCCESSOR_LEGACY_TRANSITION_PATHS.includes(relativePath),
  );
  featureDefinition.verification = projectSuccessorVerificationV2(
    featureDefinition.verification,
  );
  if (featureDefinition.files.length !== 38) {
    throw new Error("Round1 P108 descriptor must project to exactly 38 paths");
  }
  const workstreamDefinition = structuredClone(round1.workstreamDefinition);
  const liveSuccessorWorkstream = program.workstreams?.find(
    (entry) => entry?.id === CONTINUATION_V2_SUCCESSOR_WORKSTREAM_ID,
  );
  if (canonicalJsonV2(stableWorkstreamDefinitionV2(liveSuccessorWorkstream))
    !== canonicalJsonV2(workstreamDefinition)) {
    throw new Error("Round1 P108 workstream differs from the live program definition");
  }
  const transitionPaths = new Set(transitions.map((entry) => entry.path));
  const modifyEntries = archive.entries.filter(
    (entry) => !transitionPaths.has(entry.path),
  );
  if (modifyEntries.length !== 17) {
    throw new Error("Round2 archive must bind exactly 17 modify paths");
  }
  const modifyPaths = new Set(modifyEntries.map((entry) => entry.path));
  const bookkeepingPaths = new Set(Object.keys(CONTINUATION_V2_BOOKKEEPING_VALIDATORS));
  const successorFiles = new Set(featureDefinition.files);
  const pathAuthorities = [];
  for (const relativePath of featureDefinition.files) {
    if (modifyPaths.has(relativePath)) {
      const archiveEntry = modifyEntries.find((entry) => entry.path === relativePath);
      const live = await readRepository(relativePath, `modify authority ${relativePath}`);
      if (live.digest !== archiveEntry.sha256) {
        throw new Error(`P108 modify path differs from its archived baseline: ${relativePath}`);
      }
      pathAuthorities.push({
        class: "modify",
        path: relativePath,
        baseline: { source: archiveEntry.source, sha256: archiveEntry.sha256 },
      });
      continue;
    }
    if (bookkeepingPaths.has(relativePath)) {
      const absolutePath = path.join(root, relativePath);
      const live = await readOptionalStableFile(absolutePath, `bookkeeping ${relativePath}`, root);
      pathAuthorities.push({
        class: "bookkeeping",
        path: relativePath,
        baseline: {
          source: "cd03a_review_snapshot",
          presence: live ? "present" : "absent",
          sha256: live?.digest ?? null,
        },
        validator: CONTINUATION_V2_BOOKKEEPING_VALIDATORS[relativePath],
        allowedPhases: CD04_EVIDENCE_PATHS.has(relativePath)
          ? ["authorized_active"]
          : [...CONTINUATION_V2_LIFECYCLE_PHASES],
      });
      continue;
    }
    const live = await readOptionalStableFile(
      path.join(root, relativePath),
      `create authority ${relativePath}`,
      root,
    );
    if (live) throw new Error(`P108 create path is preplanted: ${relativePath}`);
    pathAuthorities.push({
      class: "create",
      path: relativePath,
      baseline: { source: "cd03a_review_absence", sha256: null },
    });
  }
  for (const relativePath of [...modifyPaths, ...bookkeepingPaths]) {
    if (!successorFiles.has(relativePath)) {
      throw new Error(`P108 authority is outside its 38-file descriptor: ${relativePath}`);
    }
  }
  pathAuthorities.sort(comparePath);
  const counts = Object.fromEntries(["modify", "create", "bookkeeping"].map((kind) => [
    kind,
    pathAuthorities.filter((entry) => entry.class === kind).length,
  ]));
  if (counts.modify !== 17 || counts.create !== 12 || counts.bookkeeping !== 9) {
    throw new Error("P108 authorities must be exactly 17 modify, 12 create, and 9 bookkeeping");
  }
  const coverage = pathAuthorities.map((entry) => ({
    path: entry.path,
    class: entry.class,
  })).sort(comparePath);
  return {
    workstreamDefinition,
    workstreamDefinitionDigest: hashCanonicalV2(workstreamDefinition),
    featureDefinition,
    featureDefinitionDigest: hashCanonicalV2(featureDefinition),
    pathCoverageDigest: hashCanonicalV2(coverage),
    pathAuthorities,
  };
}

function buildClosedWorld({
  program,
  featureList,
  admission,
  successor,
  expectedHistoricalFeatureIdsDigest,
  expectedWorkstreamIds,
}) {
  const liveFeatureIds = (featureList.features ?? []).map((entry) => entry?.id);
  if (new Set(liveFeatureIds).size !== liveFeatureIds.length
    || liveFeatureIds.filter((id) => id === CONTINUATION_V2_FEATURE_ID).length !== 1
    || liveFeatureIds.includes(CONTINUATION_V2_SUCCESSOR_FEATURE_ID)) {
    throw new Error("Feature list must contain one P107A and no preplanted P108");
  }
  const workstreamIds = (program.workstreams ?? []).map((entry) => entry?.id);
  if (canonicalJsonV2(workstreamIds) !== canonicalJsonV2(expectedWorkstreamIds)) {
    throw new Error("program workstream roster/order differs from the builder trust root");
  }
  const workstreams = program.workstreams.map((workstream) => {
    const stableDefinition = stableWorkstreamDefinitionV2(workstream);
    return {
      id: stableDefinition.id,
      stableDefinition,
      stableDefinitionDigest: hashCanonicalV2(stableDefinition),
    };
  });
  const programRootDefinition = stableProgramRootDefinitionV2(program);
  const programRootDefinitionDigest = hashCanonicalV2(programRootDefinition);
  const historicalIds = validateHistoricalFeatureRosterV2(
    featureList,
    expectedHistoricalFeatureIdsDigest,
  );
  const historicalFeatures = historicalIds.map((id) => {
    const live = featureList.features.find((entry) => entry.id === id);
    const stableDefinition = stableHistoricalFeatureDefinitionV2(live);
    return {
      id,
      stableDefinition,
      stableDefinitionDigest: hashCanonicalV2(stableDefinition),
      requiredStatus: "done",
    };
  });
  const knownIds = new Set([
    CONTINUATION_V2_FEATURE_ID,
    CONTINUATION_V2_SUCCESSOR_FEATURE_ID,
    ...historicalIds,
  ]);
  if (featureList.features.some((entry) => !knownIds.has(entry?.id))) {
    throw new Error("Feature list contains an unknown Feature");
  }
  if (featureList.features.filter((entry) => entry?.status !== "done").length !== 1) {
    throw new Error("Feature list must contain exactly one unfinished P107A Feature");
  }
  const baseWorkstreamStates = program.workstreams.map((entry) => ({
    id: entry.id,
    state: entry.state,
  }));
  const featureUniverse = [
    CONTINUATION_V2_SUCCESSOR_FEATURE_ID,
    CONTINUATION_V2_FEATURE_ID,
    ...historicalIds,
  ];
  const profile = ({
    phase,
    admissionState,
    successorState,
    admissionStatus,
    successorPresence,
    successorStatus,
    activeFeatureId,
    nextFeatureId,
  }) => ({
    phase,
    activeFeatureId,
    nextFeatureId,
    workstreamStates: baseWorkstreamStates.map((entry) => ({
      id: entry.id,
      state: entry.id === CONTINUATION_V2_WORKSTREAM_ID
        ? admissionState
        : entry.id === CONTINUATION_V2_SUCCESSOR_WORKSTREAM_ID
          ? successorState
          : entry.state,
    })),
    featureStates: featureUniverse.map((id) => {
      if (id === CONTINUATION_V2_SUCCESSOR_FEATURE_ID) {
        return { id, presence: successorPresence, status: successorStatus };
      }
      if (id === CONTINUATION_V2_FEATURE_ID) {
        return { id, presence: "present", status: admissionStatus };
      }
      return { id, presence: "present", status: "done" };
    }),
  });
  const lifecycleProfiles = [
    profile({ phase: "review_pre_transition", admissionState: "in_progress",
      successorState: "planned", admissionStatus: "in_progress",
      successorPresence: "absent", successorStatus: null,
      activeFeatureId: CONTINUATION_V2_FEATURE_ID,
      nextFeatureId: CONTINUATION_V2_FEATURE_ID }),
    profile({ phase: "review_post_transition", admissionState: "in_progress",
      successorState: "planned", admissionStatus: "in_progress",
      successorPresence: "absent", successorStatus: null,
      activeFeatureId: CONTINUATION_V2_FEATURE_ID,
      nextFeatureId: CONTINUATION_V2_FEATURE_ID }),
    profile({ phase: "anchored_planned", admissionState: "completed",
      successorState: "planned", admissionStatus: "done",
      successorPresence: "absent", successorStatus: null,
      activeFeatureId: null, nextFeatureId: CONTINUATION_V2_SUCCESSOR_FEATURE_ID }),
    profile({ phase: "authorized_active", admissionState: "completed",
      successorState: "in_progress", admissionStatus: "done",
      successorPresence: "present", successorStatus: "in_progress",
      activeFeatureId: CONTINUATION_V2_SUCCESSOR_FEATURE_ID,
      nextFeatureId: CONTINUATION_V2_SUCCESSOR_FEATURE_ID }),
  ];
  const withoutDigest = {
    workstreams,
    historicalFeatures,
    lifecycleProfiles,
    maxUnfinishedFeatures: 1,
    programRootDefinition,
    programRootDefinitionDigest,
  };
  return { ...withoutDigest, digest: hashCanonicalV2(withoutDigest) };
}

async function buildGovernanceTransitions({ archive, readRepository }) {
  const archiveByPath = new Map(archive.entries.map((entry) => [entry.path, entry]));
  const transitions = [];
  for (const livePath of Object.keys(CONTINUATION_V2_GOVERNANCE_TRANSITIONS).sort()) {
    const source = await readRepository(livePath, `transition source ${livePath}`);
    const targetPath = TARGET_PATH_BY_LIVE_PATH[livePath];
    const target = await readRepository(targetPath, `transition target ${targetPath}`);
    const archived = archiveByPath.get(livePath);
    if (archived?.source !== "governance_transition"
      || archived.sha256 !== source.digest) {
      throw new Error(`transition source/archive drift: ${livePath}`);
    }
    transitions.push({
      path: livePath,
      kind: CONTINUATION_V2_GOVERNANCE_TRANSITIONS[livePath],
      fromSha256: archived.sha256,
      stagedTargetPath: targetPath,
      toSha256: target.digest,
    });
  }
  return transitions;
}

async function buildTrustRoots({ transitions, readRepository }) {
  const continuationExecutables = [];
  for (const kind of CONTINUATION_V2_EXECUTABLE_KINDS) {
    const executablePath = EXECUTABLE_PATH_BY_KIND[kind];
    const executable = await readRepository(executablePath, `v2 ${kind} executable`);
    continuationExecutables.push({ kind, path: executablePath, sha256: executable.digest });
  }
  const trustRoots = [
    ...transitions.map((entry) => ({ path: entry.path, sha256: entry.toSha256 })),
    ...continuationExecutables.map(({ path: executablePath, sha256 }) => ({
      path: executablePath,
      sha256,
    })),
  ].sort(comparePath);
  if (new Set(trustRoots.map((entry) => entry.path)).size !== trustRoots.length) {
    throw new Error("continuation trust-root paths overlap");
  }
  return { continuationExecutables, trustRoots };
}

async function buildParentEvidenceV2({
  root,
  baseAnchorPath,
  expectedBaseAnchorDigest,
  readRepository,
  readRepositoryJson,
}) {
  const [artifactCapture, artifact, snapshot, manifest, attestation] = await Promise.all([
    readRepository(ROUND23_ARTIFACT_PATH, "Round23 accepted artifact"),
    readRepositoryJson(ROUND23_ARTIFACT_PATH, "Round23 accepted artifact"),
    readRepositoryJson(ROUND23_SNAPSHOT_PATH, "Round23 snapshot"),
    readRepositoryJson(ROUND23_MANIFEST_PATH, "Round23 closure manifest"),
    readRepositoryJson(ROUND23_ATTESTATION_PATH, "Round23 external attestation"),
  ]);
  const baseCapture = await readStableFile(baseAnchorPath, "Round23 external anchor", {
    requirePrivate: true,
  });
  const baseAnchor = parseJson(baseCapture.bytes, "Round23 external anchor");
  for (const [value, label] of [
    [snapshot, "Round23 snapshot"],
    [manifest, "Round23 closure manifest"],
    [attestation, "Round23 external attestation"],
    [baseAnchor, "Round23 external anchor"],
  ]) assertCanonicalDigest(value, label);
  if (baseAnchor.digest !== expectedBaseAnchorDigest
    || baseAnchor.repositoryRealpath !== root
    || baseAnchor.snapshotDigest !== snapshot.digest
    || baseAnchor.attestationDigest !== attestation.digest
    || baseAnchor.runnerDigest !== manifest.externalRunner?.sha256
    || attestation.repositoryRealpath !== root) {
    throw new Error("Round23 base anchor does not match the caller/repository evidence");
  }
  if (artifact.status !== "accepted" || artifact.artifactId !== "CD03-causal-shadow"
    || artifact.independentReview?.round !== 23
    || artifact.independentReview?.status !== "passed") {
    throw new Error("Round23 artifact is not accepted");
  }
  if (snapshot.files?.length !== 101 || manifest.status !== "externally_attested"
    || manifest.snapshot?.digest !== snapshot.digest
    || manifest.externalAttestation?.canonicalDigest !== attestation.digest
    || attestation.status !== "passed" || attestation.snapshotDigest !== snapshot.digest) {
    throw new Error("Round23 snapshot/manifest/attestation chain is stale");
  }
  const receiptObjects = [];
  const receipts = [];
  for (const lane of CONTINUATION_V2_REVIEW_LANES) {
    const reference = manifest.reviewReceipts?.find((entry) => entry.lane === lane);
    const receipt = await readRepositoryJson(reference?.path, `Round23 ${lane} receipt`);
    const canonicalDigest = hashCanonicalV2(receipt);
    const anchorReference = baseAnchor.reviewReceipts?.find((entry) => entry.lane === lane);
    const attestationReference = attestation.reviewReceiptDigests?.find(
      (entry) => entry.lane === lane,
    );
    if (receipt.lane !== lane || receipt.verdict !== "passed"
      || receipt.snapshotDigest !== snapshot.digest || receipt.findings?.length !== 0
      || Object.values(receipt.findingCounts ?? {}).some((value) => value !== 0)
      || reference.canonicalDigest !== canonicalDigest
      || anchorReference?.canonicalDigest !== canonicalDigest
      || anchorReference?.challenge !== receipt.challenge
      || attestationReference?.canonicalDigest !== canonicalDigest) {
      throw new Error(`Round23 ${lane} review chain is stale`);
    }
    receiptObjects.push(receipt);
    receipts.push({ lane, path: reference.path, canonicalDigest, challenge: receipt.challenge });
  }
  const validator = await readRepository(ROUND23_VALIDATOR_PATH, "Round23 validator");
  const runner = await readRepository(ROUND23_RUNNER_PATH, "Round23 external runner");
  const executableChecker = manifest.executableClosure?.find(
    (entry) => entry.kind === "checker",
  );
  if (executableChecker?.path !== ROUND23_VALIDATOR_PATH
    || executableChecker?.sha256 !== validator.digest
    || manifest.externalRunner?.path !== ROUND23_RUNNER_PATH
    || manifest.externalRunner?.sha256 !== runner.digest
    || attestation.runnerDigest !== runner.digest) {
    throw new Error("Round23 executable evidence is stale");
  }

  const evidenceDirectory = path.join(root, path.dirname(ROUND23_SNAPSHOT_PATH));
  const directoryNames = await readdir(evidenceDirectory);
  const markerNames = directoryNames.filter((name) =>
    (name.startsWith("CD03-causal-shadow.json.atomic-")
      || name.startsWith("CD03-round23-review-snapshot.json.freeze-transaction.json.remove.tombstone.completed-")
      || name.startsWith("CD03-round23-closure-manifest.json.atomic-"))
      && name.endsWith(".marker"));
  if (markerNames.length !== 5) {
    throw new Error("Round23 repository evidence must contain exactly five closure markers");
  }
  const repositoryPaths = [...new Set([
    ...CONTINUATION_V2_REQUIRED_PARENT_REPOSITORY_PATHS,
    ...markerNames.map((name) => `${path.dirname(ROUND23_SNAPSHOT_PATH)}/${name}`),
  ])].sort();
  if (repositoryPaths.length !== 17) {
    throw new Error("Round23 repository evidence must contain exactly 17 paths");
  }
  const repositoryEvidence = [];
  for (const relativePath of repositoryPaths) {
    const capture = await readRepository(relativePath, `Round23 evidence ${relativePath}`);
    repositoryEvidence.push({ path: relativePath, sha256: capture.digest });
  }

  const externalDirectory = path.dirname(baseAnchorPath);
  const publicationNames = (await readdir(externalDirectory)).filter((name) =>
    name.startsWith(`${path.basename(baseAnchorPath)}.publication-transaction.json.remove.tombstone.completed-`)
      && name.endsWith(".marker"));
  if (publicationNames.length !== 1) {
    throw new Error("Round23 external publication marker is missing or ambiguous");
  }
  const publication = await readStableFile(
    path.join(externalDirectory, publicationNames[0]),
    "Round23 external publication marker",
    { requirePrivate: true },
  );
  const publicationObject = parseJson(
    publication.bytes,
    "Round23 external publication marker",
  );
  assertCanonicalDigest(publicationObject, "Round23 external publication marker");
  if (publicationObject.anchorOutputPath !== baseAnchorPath
    || canonicalJsonV2(publicationObject.externalAnchor) !== canonicalJsonV2(baseAnchor)
    || canonicalJsonV2(publicationObject.attestation) !== canonicalJsonV2(attestation)
    || canonicalJsonV2(publicationObject.finalManifest) !== canonicalJsonV2(manifest)) {
    throw new Error("Round23 external publication transaction is stale");
  }
  const runnerCopyPath = path.join(externalDirectory, path.basename(ROUND23_RUNNER_PATH));
  const runnerCopy = await readStableFile(runnerCopyPath, "Round23 external runner copy");
  if (runnerCopy.digest !== runner.digest) {
    throw new Error("Round23 external runner copy is stale");
  }
  const externalEvidenceByRole = {
    base_anchor: {
      role: "base_anchor",
      basename: path.basename(baseAnchorPath),
      sha256: baseCapture.digest,
    },
    base_anchor_publication_marker: {
      role: "base_anchor_publication_marker",
      basename: publicationNames[0],
      sha256: publication.digest,
    },
    external_runner_copy: {
      role: "external_runner_copy",
      basename: path.basename(runnerCopyPath),
      sha256: runnerCopy.digest,
    },
  };
  const externalEvidence = CONTINUATION_V2_EXTERNAL_EVIDENCE_ROLES.map(
    (role) => externalEvidenceByRole[role],
  );
  const withoutDigest = {
    schemaVersion: 1,
    workstreamId: "CD03",
    featureId: "P107-conversation-disclosure-domain-adapters",
    round: 23,
    artifact: { path: ROUND23_ARTIFACT_PATH, byteSha256: artifactCapture.digest },
    snapshot: { path: ROUND23_SNAPSHOT_PATH, digest: snapshot.digest, fileCount: 101 },
    receipts,
    closureManifest: {
      path: ROUND23_MANIFEST_PATH,
      canonicalDigest: manifest.digest,
      status: manifest.status,
    },
    externalAttestation: {
      path: ROUND23_ATTESTATION_PATH,
      canonicalDigest: attestation.digest,
    },
    externalAnchor: { digest: baseAnchor.digest },
    validator: { path: ROUND23_VALIDATOR_PATH, sha256: validator.digest },
    externalRunner: { path: ROUND23_RUNNER_PATH, sha256: runner.digest },
    repositoryEvidence,
    externalEvidence,
  };
  return { ...withoutDigest, bundleDigest: hashCanonicalV2(withoutDigest) };
}

function createLiveLifecycle(profile, closedWorld, admission, successor) {
  const featureDefinitions = new Map([
    ...closedWorld.historicalFeatures.map((entry) => [entry.id, entry.stableDefinition]),
    [CONTINUATION_V2_FEATURE_ID, admission.featureDefinition],
    [CONTINUATION_V2_SUCCESSOR_FEATURE_ID, successor.featureDefinition],
  ]);
  return {
    phase: profile.phase,
    activeFeatureId: profile.activeFeatureId,
    nextFeatureId: profile.nextFeatureId,
    workstreams: closedWorld.workstreams.map((entry) => ({
      ...entry.stableDefinition,
      state: profile.workstreamStates.find((state) => state.id === entry.id).state,
    })),
    features: profile.featureStates.filter((state) => state.presence === "present")
      .map((state) => ({ ...featureDefinitions.get(state.id), status: state.status })),
  };
}

async function publishExactNoOverwrite(absolutePath, bytes, root) {
  const resolved = path.resolve(absolutePath);
  const parent = await realpath(path.dirname(resolved));
  if (!isWithin(root, parent) || path.join(parent, path.basename(resolved)) !== resolved) {
    throw new Error("--output parent must be canonical and inside the repository");
  }
  let handle;
  try {
    handle = await open(resolved, constants.O_WRONLY | constants.O_CREAT
      | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await handle.writeFile(bytes);
    await handle.chmod(0o600);
    await handle.sync();
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = await readStableFile(resolved, "existing policy output", {
      expectedRoot: root,
      requirePrivate: true,
    });
    if (!existing.bytes.equals(bytes)) {
      throw new Error("--output already exists with different bytes");
    }
    return "idempotent";
  } finally {
    await handle?.close();
  }
  const published = await readStableFile(resolved, "published policy output", {
    expectedRoot: root,
    requirePrivate: true,
  });
  if (!published.bytes.equals(bytes)) throw new Error("published policy bytes changed");
  return "created";
}

async function readOptionalStableFile(absolutePath, label, expectedRoot) {
  try {
    return await readStableFile(absolutePath, label, { expectedRoot });
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function readStableFile(
  absolutePath,
  label,
  { expectedRoot, requirePrivate = false } = {},
) {
  if (!path.isAbsolute(absolutePath)) throw new Error(`${label} path must be absolute`);
  const before = await lstat(absolutePath);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) {
    throw new Error(`${label} must be a single-link regular file`);
  }
  if (requirePrivate && (before.mode & 0o777) !== 0o600) {
    throw new Error(`${label} must be mode 0600`);
  }
  const handle = await open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (opened.dev !== before.dev || opened.ino !== before.ino
      || after.dev !== opened.dev || after.ino !== opened.ino
      || after.nlink !== 1 || after.size !== bytes.length) {
      throw new Error(`${label} changed while reading`);
    }
    const canonical = await realpath(absolutePath);
    if (canonical !== absolutePath || (expectedRoot && !isWithin(expectedRoot, canonical))) {
      throw new Error(`${label} traverses an alias or escaped its root`);
    }
    return { absolutePath, bytes, digest: sha256BytesV2(bytes), mode: after.mode & 0o777 };
  } finally {
    await handle.close();
  }
}

async function canonicalDirectory(value, label) {
  if (!path.isAbsolute(value ?? "")) throw new Error(`${label} must be absolute`);
  const canonical = await realpath(value);
  if (!(await stat(canonical)).isDirectory()) throw new Error(`${label} must be a directory`);
  return canonical;
}

function assertCanonicalDigest(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !sha256DigestV2(value.digest)) {
    throw new Error(`${label} has no canonical digest`);
  }
  const withoutDigest = { ...value };
  delete withoutDigest.digest;
  if (value.digest !== hashCanonicalV2(withoutDigest)) {
    throw new Error(`${label} canonical digest is stale`);
  }
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} must contain valid JSON`);
  }
}

function assertNoErrors(errors, label) {
  if (errors.length > 0) throw new Error(`${label}: ${errors.join("; ")}`);
}

function comparePath(left, right) {
  return left.path.localeCompare(right.path);
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function parseOptions(args) {
  const options = { repositoryRoot: process.cwd() };
  const keys = new Map([
    ["--base-anchor", "baseAnchorPath"],
    ["--expected-base-anchor-digest", "expectedBaseAnchorDigest"],
    ["--output", "outputPath"],
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const key = keys.get(args[index]);
    if (!key || options[key] !== undefined || args[index + 1] === undefined) {
      throw new Error(`unknown, duplicate, or valueless option: ${args[index]}`);
    }
    options[key] = args[index + 1];
    index += 1;
  }
  return options;
}

async function cli() {
  try {
    const { bytes } = await buildConversationDisclosureContinuationPolicyV2(
      parseOptions(process.argv.slice(2)),
    );
    process.stdout.write(bytes);
  } catch (error) {
    console.error(`Continuation policy v2 builder failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await cli();
}
