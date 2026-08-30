#!/usr/bin/env node

import { constants } from "node:fs";
import { lstat, open, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  validateBaselineArchiveV2,
  validateContinuationPolicyV2,
} from "./conversation-disclosure-continuation-contract-v2.mjs";
import {
  CONTINUATION_V3_ALGORITHM,
  CONTINUATION_V3_BASELINE_ARCHIVE_PATH,
  CONTINUATION_V3_EXECUTABLE_KINDS,
  CONTINUATION_V3_EXECUTABLE_PATH_BY_KIND,
  CONTINUATION_V3_EXTERNAL_ATTESTATION_PATH,
  CONTINUATION_V3_FEATURE_ID,
  CONTINUATION_V3_LIFECYCLE_PHASES,
  CONTINUATION_V3_POLICY_ID,
  CONTINUATION_V3_POLICY_KIND,
  CONTINUATION_V3_POLICY_PATH,
  CONTINUATION_V3_PROGRAM_ROOT_DEFINITION_DIGEST,
  CONTINUATION_V3_REVIEW_LANES,
  CONTINUATION_V3_REVIEW_SNAPSHOT_PATH,
  CONTINUATION_V3_ROUND,
  CONTINUATION_V3_ROUND2_BASELINE_ARCHIVE_PATH,
  CONTINUATION_V3_ROUND2_POLICY_PATH,
  CONTINUATION_V3_ROUND2_POLICY_TRUST_ROOT,
  CONTINUATION_V3_ROUND2_PREFREEZE_REJECTION_PATH,
  CONTINUATION_V3_ROUND3_GOVERNANCE_TRANSITION_TRUST_ROOTS,
  CONTINUATION_V3_SUCCESSOR_FEATURE_ID,
  CONTINUATION_V3_SUCCESSOR_WORKSTREAM_ID,
  CONTINUATION_V3_WORKSTREAM_ID,
  buildAdmissionCoverageV3,
  canonicalJsonV3,
  hashCanonicalV3,
  repositoryPathV3,
  serializeRound2PrefreezeRejectionV3,
  sha256BytesV3,
  sha256DigestV3,
  stableFeatureDefinitionV3,
  stableHistoricalFeatureDefinitionV3,
  stableProgramRootDefinitionV3,
  stableWorkstreamDefinitionV3,
  validateBaselineArchiveV3,
  validateContinuationPolicyV3,
  validateLifecycleStateV3,
  validateRound2PrefreezeRejectionV3,
  withCanonicalDigestV3,
} from "./conversation-disclosure-continuation-contract-v3.mjs";

const PROGRAM_PATH = ".zerox/conversation-disclosure-program.json";
const FEATURE_LIST_PATH = ".zerox/feature_list.json";
const PRIVATE_MODE = 0o600;

export const CONTINUATION_POLICY_V3_EXPECTED_WORKSTREAM_IDS = Object.freeze([
  "CD01", "CD02", "CD03", "CD03A", "CD04", "CD05", "CD06", "CD07", "CD08", "CD09",
]);
export const CONTINUATION_POLICY_V3_HISTORICAL_FEATURE_IDS_DIGEST =
  "sha256:ec8b970a130f1767b6c06c7eefe83c3c2d6f04330431c98ea5c6a818986f2400";

// Exact Round3 live P107A/CD03A definitions, established before policy freeze.
export const CONTINUATION_POLICY_V3_ADMISSION_FILE_COUNT = 84;
export const CONTINUATION_POLICY_V3_ADMISSION_FILE_SET_DIGEST =
  "sha256:8fb3317ca67c5ba1393d73890c436e113f6a366cc921ab80994ee2f94528af0b";
export const CONTINUATION_POLICY_V3_ADMISSION_FEATURE_DEFINITION_DIGEST =
  "sha256:3b9bd616bde4b8b87dacd5c37fe29b94be0a5d12e01c18c90dce2c03446b2ec9";
export const CONTINUATION_POLICY_V3_ADMISSION_WORKSTREAM_DEFINITION_DIGEST =
  "sha256:75aff54b4e21b2d38a098f422ba4a16690cc4004d5193ad023b8390f6f97e075";

export const CONTINUATION_POLICY_V3_PRESENT_BOOKKEEPING_PATHS = Object.freeze([
  PROGRAM_PATH,
  FEATURE_LIST_PATH,
  ".zerox/progress.md",
  "findings.md",
  "progress.md",
  "task_plan.md",
]);
export const CONTINUATION_POLICY_V3_ABSENT_BOOKKEEPING_PATHS = Object.freeze([
  ".zerox/reviews/CD04-shadow-parity-review.md",
  ".zerox/verification/conversation-disclosure/CD04-performance-baseline.json",
  ".zerox/verification/conversation-disclosure/CD04-shadow-parity.json",
]);
const POST_REVIEW_MUTABLE_PATHS = CONTINUATION_POLICY_V3_PRESENT_BOOKKEEPING_PATHS;
const REVIEW_OUTPUT_PATHS = Object.freeze([
  CONTINUATION_V3_REVIEW_SNAPSHOT_PATH,
  ...CONTINUATION_V3_REVIEW_LANES.map((lane) =>
    `.zerox/verification/conversation-disclosure/CD03A-round3-${lane}-review.json`),
  ".zerox/verification/conversation-disclosure/CD03A-round3-closure-manifest.json",
  CONTINUATION_V3_EXTERNAL_ATTESTATION_PATH,
].sort());

const V2_CHECKER_VERIFICATION =
  "node scripts/check-conversation-disclosure-continuation-v2.mjs --mode authorized_active --control-root CALLER_SUPPLIED_CONTROL_ROOT --subject-repository-realpath CALLER_SUPPLIED_SUBJECT_REPOSITORY_REALPATH --base-anchor CALLER_SUPPLIED_BASE_PATH --expected-base-anchor-digest CALLER_SUPPLIED_BASE_DIGEST --expected-policy-digest CALLER_SUPPLIED_POLICY_DIGEST --expected-snapshot-digest CALLER_SUPPLIED_SNAPSHOT_DIGEST --continuation-anchor CALLER_SUPPLIED_CONTINUATION_PATH --expected-continuation-anchor-digest CALLER_SUPPLIED_CONTINUATION_DIGEST";
const V2_HARNESS_VERIFICATION =
  "node scripts/check-harness-state.mjs --mode authorized_active --control-root CALLER_SUPPLIED_CONTROL_ROOT --subject-repository-realpath CALLER_SUPPLIED_SUBJECT_REPOSITORY_REALPATH --base-anchor CALLER_SUPPLIED_BASE_PATH --expected-base-anchor-digest CALLER_SUPPLIED_BASE_DIGEST --expected-policy-digest CALLER_SUPPLIED_POLICY_DIGEST --expected-snapshot-digest CALLER_SUPPLIED_SNAPSHOT_DIGEST --continuation-anchor CALLER_SUPPLIED_CONTINUATION_PATH --expected-continuation-anchor-digest CALLER_SUPPLIED_CONTINUATION_DIGEST";
const V3_ORDINARY_ARGUMENTS =
  "--mode authorized_active --control-root CALLER_SUPPLIED_CONTROL_ROOT --subject-repository-realpath CALLER_SUPPLIED_SUBJECT_REPOSITORY_REALPATH --base-anchor CALLER_SUPPLIED_BASE_PATH --expected-base-anchor-digest CALLER_SUPPLIED_BASE_DIGEST --expected-policy-digest CALLER_SUPPLIED_POLICY_DIGEST --expected-snapshot-digest CALLER_SUPPLIED_SNAPSHOT_DIGEST --continuation-anchor CALLER_SUPPLIED_CONTINUATION_PATH --expected-continuation-anchor-digest CALLER_SUPPLIED_CONTINUATION_DIGEST";
export const CONTINUATION_POLICY_V3_SUCCESSOR_CHECKER_VERIFICATION =
  `node scripts/check-conversation-disclosure-continuation-v3.mjs ${V3_ORDINARY_ARGUMENTS}`;
export const CONTINUATION_POLICY_V3_SUCCESSOR_HARNESS_VERIFICATION =
  `node scripts/check-harness-state.mjs ${V3_ORDINARY_ARGUMENTS}`;

export async function buildConversationDisclosureContinuationPolicyV3({
  repositoryRoot = process.cwd(),
  baseAnchorPath,
  expectedBaseAnchorDigest,
  outputPath,
} = {}) {
  assertAdmissionTrustRootConfigured();
  const root = await canonicalDirectory(repositoryRoot, "repository root");
  if (!path.isAbsolute(baseAnchorPath ?? "")
    || !sha256DigestV3(expectedBaseAnchorDigest)) {
    throw new Error("caller must pin one absolute base anchor and SHA-256 digest");
  }
  const canonicalBaseAnchor = await realpath(baseAnchorPath);
  if (canonicalBaseAnchor !== baseAnchorPath || isWithin(root, canonicalBaseAnchor)) {
    throw new Error("base anchor must be canonical and outside the repository");
  }

  const captures = new Map();
  const readRepository = async (relativePath, label = relativePath, options = {}) => {
    if (!repositoryPathV3(relativePath)) {
      throw new Error(`${label} is not a repository-relative path`);
    }
    if (!captures.has(relativePath)) {
      captures.set(relativePath, await readStableFile(
        path.join(root, relativePath), label, { expectedRoot: root, ...options },
      ));
    }
    const capture = captures.get(relativePath);
    if (options.requirePrivate && capture.mode !== PRIVATE_MODE) {
      throw new Error(`${label} must be mode 0600`);
    }
    return capture;
  };
  const readJson = async (relativePath, label = relativePath, options = {}) =>
    parseJson((await readRepository(relativePath, label, options)).bytes, label);

  const [v2Policy, v2Archive, archive, program, featureList, witness] =
    await Promise.all([
      readJson(CONTINUATION_V3_ROUND2_POLICY_PATH, "Round2 rejected policy", {
        requirePrivate: true,
      }),
      readJson(CONTINUATION_V3_ROUND2_BASELINE_ARCHIVE_PATH, "Round2 baseline archive"),
      readJson(CONTINUATION_V3_BASELINE_ARCHIVE_PATH, "Round3 baseline archive"),
      readJson(PROGRAM_PATH, "conversation disclosure program"),
      readJson(FEATURE_LIST_PATH, "Feature list"),
      readJson(
        CONTINUATION_V3_ROUND2_PREFREEZE_REJECTION_PATH,
        "Round2 pre-freeze rejection witness",
        { requirePrivate: true },
      ),
    ]);
  const v2PolicyCapture = await readRepository(
    CONTINUATION_V3_ROUND2_POLICY_PATH,
    "Round2 rejected policy bytes",
  );
  if (v2PolicyCapture.digest !== CONTINUATION_V3_ROUND2_POLICY_TRUST_ROOT.byteSha256
    || v2Policy.digest !== CONTINUATION_V3_ROUND2_POLICY_TRUST_ROOT.canonicalDigest) {
    throw new Error("Round2 rejected policy differs from its hard trust root");
  }
  assertNoErrors(validateContinuationPolicyV2(v2Policy, {
    expectedDigest: CONTINUATION_V3_ROUND2_POLICY_TRUST_ROOT.canonicalDigest,
    baselineArchive: v2Archive,
  }), "Round2 rejected policy");
  assertNoErrors(validateBaselineArchiveV2(v2Archive, v2Policy),
    "Round2 baseline archive");
  assertNoErrors(validateRound2PrefreezeRejectionV3(witness),
    "Round2 pre-freeze rejection witness");
  const witnessCapture = await readRepository(
    CONTINUATION_V3_ROUND2_PREFREEZE_REJECTION_PATH,
    "Round2 pre-freeze rejection witness bytes",
    { requirePrivate: true },
  );
  if (!witnessCapture.bytes.equals(serializeRound2PrefreezeRejectionV3(witness))) {
    throw new Error("Round2 pre-freeze rejection witness bytes are non-deterministic");
  }
  assertNoErrors(validateBaselineArchiveV3(archive), "Round3 baseline archive");

  await revalidateParentEvidence({
    root,
    parentEvidence: v2Policy.parentEvidence,
    baseAnchorPath: canonicalBaseAnchor,
    expectedBaseAnchorDigest,
    readRepository,
  });

  const transitions = await buildGovernanceTransitions(readRepository);
  const admission = buildAdmission(program, featureList, transitions);
  const admissionCoverage = buildAdmissionCoverageV3(
    admission,
    transitions,
    witness.verifiedAbsentPaths,
  );
  admission.reviewCoverageDigest = hashCanonicalV3(admissionCoverage);
  const { continuationExecutables, trustRoots } = await buildTrustRoots(
    transitions,
    readRepository,
  );
  // Close the semantic Program/Feature world before binding any mutable live bytes.
  // The byte refresh below is evidence collection, never authorization of live semantics.
  const closedWorld = buildClosedWorld(program, featureList, admission);
  const reboundAuthorities = await rebindRound3BookkeepingBaselinesV3(
    v2Policy.pathAuthorities,
    {
      readPresentDigest: async (relativePath) =>
        (await readRepository(relativePath, `Round3 bookkeeping ${relativePath}`)).digest,
      assertAbsent: async (relativePath) =>
        assertRepositoryPathAbsent(root, relativePath, `Round3 bookkeeping ${relativePath}`),
    },
  );
  const successor = buildSuccessor(v2Policy.successor, reboundAuthorities,
    transitions, trustRoots);
  const baselineArchive = {
    path: CONTINUATION_V3_BASELINE_ARCHIVE_PATH,
    digest: archive.digest,
    entrySetDigest: archive.entrySetDigest,
  };
  const policy = withCanonicalDigestV3({
    schemaVersion: 3,
    kind: CONTINUATION_V3_POLICY_KIND,
    algorithm: CONTINUATION_V3_ALGORITHM,
    policyId: CONTINUATION_V3_POLICY_ID,
    programId: program.programId,
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
    successor: successor.definition,
    pathAuthorities: successor.pathAuthorities,
    trustRoots,
    governanceTransitions: transitions,
    continuationExecutables,
    baselineArchive,
    reviewSnapshot: { path: CONTINUATION_V3_REVIEW_SNAPSHOT_PATH },
    timePolicy: { futureToleranceMs: 0 },
  });
  assertNoErrors(validateContinuationPolicyV3(policy, {
    expectedDigest: policy.digest,
    baselineArchive: archive,
    liveAdmissionFeature: featureList.features.find(
      (entry) => entry?.id === CONTINUATION_V3_FEATURE_ID,
    ),
    liveAdmissionWorkstream: program.workstreams.find(
      (entry) => entry?.id === CONTINUATION_V3_WORKSTREAM_ID,
    ),
    liveProgram: program,
    lifecycleState: createLiveLifecycle(
      closedWorld.lifecycleProfiles[0], closedWorld, admission, successor.definition,
    ),
    parentEvidence: {
      requiredRepositoryEvidence: v2Policy.parentEvidence.repositoryEvidence,
      requiredExternalEvidence: v2Policy.parentEvidence.externalEvidence,
    },
  }), "generated continuation policy v3");
  for (const profile of closedWorld.lifecycleProfiles) {
    assertNoErrors(validateLifecycleStateV3(
      createLiveLifecycle(profile, closedWorld, admission, successor.definition),
      policy,
    ), `generated lifecycle ${profile.phase}`);
  }
  const bytes = Buffer.from(`${JSON.stringify(policy, null, 2)}\n`, "utf8");
  let publicationStatus = "not_requested";
  if (outputPath !== undefined) {
    const absoluteOutput = resolveRepositoryOutput(root, outputPath);
    if (absoluteOutput !== path.join(root, CONTINUATION_V3_POLICY_PATH)) {
      throw new Error("--output must be the exact Round3 continuation policy path");
    }
    publicationStatus = await publishPrivateNoReplace(absoluteOutput, bytes, root);
  }
  return { policy, bytes, publicationStatus };
}

function buildAdmission(program, featureList, transitions) {
  const feature = featureList.features?.find(
    (entry) => entry?.id === CONTINUATION_V3_FEATURE_ID,
  );
  const workstream = program.workstreams?.find(
    (entry) => entry?.id === CONTINUATION_V3_WORKSTREAM_ID,
  );
  if (!feature || feature.status !== "in_progress"
    || !workstream || workstream.state !== "in_progress") {
    throw new Error("live P107A/CD03A admission is not in_progress");
  }
  const featureDefinition = stableFeatureDefinitionV3(feature);
  const workstreamDefinition = stableWorkstreamDefinitionV3(workstream);
  if (featureDefinition.files.length !== CONTINUATION_POLICY_V3_ADMISSION_FILE_COUNT
    || hashCanonicalV3(featureDefinition.files)
      !== CONTINUATION_POLICY_V3_ADMISSION_FILE_SET_DIGEST
    || hashCanonicalV3(featureDefinition)
      !== CONTINUATION_POLICY_V3_ADMISSION_FEATURE_DEFINITION_DIGEST
    || hashCanonicalV3(workstreamDefinition)
      !== CONTINUATION_POLICY_V3_ADMISSION_WORKSTREAM_DEFINITION_DIGEST) {
    throw new Error("live P107A/CD03A differs from the Round3 hard admission trust root");
  }
  const files = new Set(featureDefinition.files);
  for (const required of [
    CONTINUATION_V3_ROUND2_PREFREEZE_REJECTION_PATH,
    CONTINUATION_V3_BASELINE_ARCHIVE_PATH,
    CONTINUATION_V3_POLICY_PATH,
    ...Object.values(CONTINUATION_V3_EXECUTABLE_PATH_BY_KIND),
    ...transitions.flatMap((entry) => [entry.path, entry.stagedTargetPath]),
    ...POST_REVIEW_MUTABLE_PATHS,
    ...REVIEW_OUTPUT_PATHS,
  ]) {
    if (!files.has(required)) {
      throw new Error(`P107A hard roster misses required Round3 path: ${required}`);
    }
  }
  return {
    workstreamDefinition,
    workstreamDefinitionDigest: hashCanonicalV3(workstreamDefinition),
    featureDefinition,
    featureDefinitionDigest: hashCanonicalV3(featureDefinition),
    featureFileSetDigest: hashCanonicalV3(featureDefinition.files),
    postReviewMutablePaths: [...POST_REVIEW_MUTABLE_PATHS],
    reviewCoverageDigest: null,
    reviewOutputPaths: [...REVIEW_OUTPUT_PATHS],
  };
}

export async function rebindRound3BookkeepingBaselinesV3(
  sourceAuthorities,
  { readPresentDigest, assertAbsent } = {},
) {
  if (!Array.isArray(sourceAuthorities)
    || typeof readPresentDigest !== "function"
    || typeof assertAbsent !== "function") {
    throw new TypeError("Round3 bookkeeping rebinding requires authorities and readers");
  }
  const authorities = structuredClone(sourceAuthorities);
  const bookkeeping = authorities.filter((entry) => entry?.class === "bookkeeping");
  const presentPaths = bookkeeping.filter((entry) => entry.baseline?.presence === "present")
    .map((entry) => entry.path).sort();
  const absentPaths = bookkeeping.filter((entry) => entry.baseline?.presence === "absent")
    .map((entry) => entry.path).sort();
  if (canonicalJsonV3(presentPaths)
      !== canonicalJsonV3([...CONTINUATION_POLICY_V3_PRESENT_BOOKKEEPING_PATHS].sort())
    || canonicalJsonV3(absentPaths)
      !== canonicalJsonV3([...CONTINUATION_POLICY_V3_ABSENT_BOOKKEEPING_PATHS].sort())
    || bookkeeping.length !== presentPaths.length + absentPaths.length) {
    throw new Error("Round2 bookkeeping presence roster differs from the Round3 closed world");
  }
  for (const authority of bookkeeping) {
    if (authority.baseline.presence === "present") {
      const digest = await readPresentDigest(authority.path);
      if (!sha256DigestV3(digest)) {
        throw new Error(`Round3 bookkeeping digest is invalid: ${authority.path}`);
      }
      authority.baseline.sha256 = digest;
    } else {
      await assertAbsent(authority.path);
    }
  }
  return authorities;
}

function buildSuccessor(source, sourceAuthorities, transitions, trustRoots) {
  const featureDefinition = structuredClone(source.featureDefinition);
  const verification = featureDefinition.verification;
  const checkerIndexes = verification.flatMap((entry, index) =>
    entry === V2_CHECKER_VERIFICATION ? [index] : []);
  const harnessIndexes = verification.flatMap((entry, index) =>
    entry === V2_HARNESS_VERIFICATION ? [index] : []);
  if (checkerIndexes.length !== 1 || harnessIndexes.length !== 1) {
    throw new Error("Round2 successor must contain exact v2 checker/harness commands");
  }
  verification[checkerIndexes[0]] = CONTINUATION_POLICY_V3_SUCCESSOR_CHECKER_VERIFICATION;
  verification[harnessIndexes[0]] = CONTINUATION_POLICY_V3_SUCCESSOR_HARNESS_VERIFICATION;
  const workstreamDefinition = structuredClone(source.workstreamDefinition);
  const pathAuthorities = structuredClone(sourceAuthorities);
  const transitionPaths = new Set(transitions.map((entry) => entry.path));
  const coverage = [
    ...pathAuthorities.map((entry) => ({ path: entry.path, class: entry.class })),
    ...trustRoots.filter((entry) => !transitionPaths.has(entry.path))
      .map((entry) => ({ path: entry.path, class: "trust_root" })),
    ...transitions.map((entry) => ({ path: entry.path, class: "governance_transition" })),
  ].filter((entry) => featureDefinition.files.includes(entry.path)).sort(comparePath);
  if (coverage.length !== featureDefinition.files.length
    || new Set(coverage.map((entry) => entry.path)).size !== coverage.length) {
    throw new Error("Round3 successor path authority coverage is not exact-once");
  }
  return {
    definition: {
      workstreamDefinition,
      workstreamDefinitionDigest: hashCanonicalV3(workstreamDefinition),
      featureDefinition,
      featureDefinitionDigest: hashCanonicalV3(featureDefinition),
      pathCoverageDigest: hashCanonicalV3(coverage),
    },
    pathAuthorities,
  };
}

function buildClosedWorld(program, featureList, admission) {
  if (canonicalJsonV3(program.workstreams.map((entry) => entry.id))
    !== canonicalJsonV3(CONTINUATION_POLICY_V3_EXPECTED_WORKSTREAM_IDS)) {
    throw new Error("live workstream roster/order differs from Round3 hard root");
  }
  const workstreams = program.workstreams.map((workstream) => {
    const stableDefinition = stableWorkstreamDefinitionV3(workstream);
    return {
      id: stableDefinition.id,
      stableDefinition,
      stableDefinitionDigest: hashCanonicalV3(stableDefinition),
    };
  });
  const historical = featureList.features.filter((entry) =>
    entry.id !== CONTINUATION_V3_FEATURE_ID
      && entry.id !== CONTINUATION_V3_SUCCESSOR_FEATURE_ID);
  if (hashCanonicalV3(historical.map((entry) => entry.id))
    !== CONTINUATION_POLICY_V3_HISTORICAL_FEATURE_IDS_DIGEST) {
    throw new Error("historical Feature roster/order differs from Round3 hard root");
  }
  if (featureList.features.filter((entry) => entry.status !== "done").length !== 1
    || featureList.features.some((entry) => entry.id === CONTINUATION_V3_SUCCESSOR_FEATURE_ID)) {
    throw new Error("Feature list must contain only one unfinished P107A and no P108");
  }
  const historicalFeatures = historical.map((feature) => {
    const stableDefinition = stableHistoricalFeatureDefinitionV3(feature);
    return {
      id: feature.id,
      stableDefinition,
      stableDefinitionDigest: hashCanonicalV3(stableDefinition),
      requiredStatus: "done",
    };
  });
  const programRootDefinition = stableProgramRootDefinitionV3(program);
  if (hashCanonicalV3(programRootDefinition)
    !== CONTINUATION_V3_PROGRAM_ROOT_DEFINITION_DIGEST) {
    throw new Error("live stable Program root differs from the Round3 hard trust root");
  }
  const baseWorkstreamStates = program.workstreams.map((entry) => ({
    id: entry.id,
    state: entry.state,
  }));
  const featureIds = [
    CONTINUATION_V3_SUCCESSOR_FEATURE_ID,
    CONTINUATION_V3_FEATURE_ID,
    ...historicalFeatures.map((entry) => entry.id),
  ];
  const profile = ({ phase, admissionState, successorState, admissionStatus,
    successorPresence, successorStatus, activeFeatureId, nextFeatureId }) => ({
    phase,
    activeFeatureId,
    nextFeatureId,
    workstreamStates: baseWorkstreamStates.map((entry) => ({
      id: entry.id,
      state: entry.id === CONTINUATION_V3_WORKSTREAM_ID
        ? admissionState
        : entry.id === CONTINUATION_V3_SUCCESSOR_WORKSTREAM_ID
          ? successorState
          : entry.state,
    })),
    featureStates: featureIds.map((id) => {
      if (id === CONTINUATION_V3_SUCCESSOR_FEATURE_ID) {
        return { id, presence: successorPresence, status: successorStatus };
      }
      if (id === CONTINUATION_V3_FEATURE_ID) {
        return { id, presence: "present", status: admissionStatus };
      }
      return { id, presence: "present", status: "done" };
    }),
  });
  const lifecycleProfiles = [
    profile({ phase: "review_pre_transition", admissionState: "in_progress",
      successorState: "planned", admissionStatus: "in_progress",
      successorPresence: "absent", successorStatus: null,
      activeFeatureId: CONTINUATION_V3_FEATURE_ID,
      nextFeatureId: CONTINUATION_V3_FEATURE_ID }),
    profile({ phase: "review_post_transition", admissionState: "in_progress",
      successorState: "planned", admissionStatus: "in_progress",
      successorPresence: "absent", successorStatus: null,
      activeFeatureId: CONTINUATION_V3_FEATURE_ID,
      nextFeatureId: CONTINUATION_V3_FEATURE_ID }),
    profile({ phase: "anchored_planned", admissionState: "completed",
      successorState: "planned", admissionStatus: "done",
      successorPresence: "absent", successorStatus: null,
      activeFeatureId: null, nextFeatureId: CONTINUATION_V3_SUCCESSOR_FEATURE_ID }),
    profile({ phase: "authorized_active", admissionState: "completed",
      successorState: "in_progress", admissionStatus: "done",
      successorPresence: "present", successorStatus: "in_progress",
      activeFeatureId: CONTINUATION_V3_SUCCESSOR_FEATURE_ID,
      nextFeatureId: CONTINUATION_V3_SUCCESSOR_FEATURE_ID }),
  ];
  const withoutDigest = {
    workstreams,
    historicalFeatures,
    lifecycleProfiles,
    maxUnfinishedFeatures: 1,
    programRootDefinition,
    programRootDefinitionDigest: hashCanonicalV3(programRootDefinition),
  };
  return { ...withoutDigest, digest: hashCanonicalV3(withoutDigest) };
}

async function buildGovernanceTransitions(readRepository) {
  const transitions = [];
  for (const expected of CONTINUATION_V3_ROUND3_GOVERNANCE_TRANSITION_TRUST_ROOTS) {
    if (!sha256DigestV3(expected.toSha256)) {
      throw new Error("Round3 governance transition trust root is unconfigured");
    }
    const [live, target] = await Promise.all([
      readRepository(expected.path, `Round3 transition live ${expected.path}`),
      readRepository(expected.stagedTargetPath,
        `Round3 transition target ${expected.stagedTargetPath}`),
    ]);
    if (live.digest !== expected.fromSha256 || target.digest !== expected.toSha256) {
      throw new Error(`Round3 transition source/target bytes drifted: ${expected.path}`);
    }
    transitions.push({ ...expected });
  }
  return transitions;
}

async function buildTrustRoots(transitions, readRepository) {
  const continuationExecutables = [];
  for (const kind of CONTINUATION_V3_EXECUTABLE_KINDS) {
    const executablePath = CONTINUATION_V3_EXECUTABLE_PATH_BY_KIND[kind];
    const capture = await readRepository(executablePath, `v3 ${kind} executable`);
    continuationExecutables.push({ kind, path: executablePath, sha256: capture.digest });
  }
  const trustRoots = [
    ...transitions.map((entry) => ({ path: entry.path, sha256: entry.toSha256 })),
    ...continuationExecutables.map(({ path: executablePath, sha256 }) => ({
      path: executablePath,
      sha256,
    })),
  ].sort(comparePath);
  if (new Set(trustRoots.map((entry) => entry.path)).size !== trustRoots.length) {
    throw new Error("Round3 trust-root paths overlap");
  }
  return { continuationExecutables, trustRoots };
}

async function revalidateParentEvidence({
  root,
  parentEvidence,
  baseAnchorPath,
  expectedBaseAnchorDigest,
  readRepository,
}) {
  for (const reference of parentEvidence.repositoryEvidence) {
    const capture = await readRepository(reference.path,
      `Round23 parent evidence ${reference.path}`);
    if (capture.digest !== reference.sha256) {
      throw new Error(`Round23 parent repository evidence drifted: ${reference.path}`);
    }
  }
  const baseAnchorCapture = await readStableFile(baseAnchorPath, "Round23 base anchor", {
    requirePrivate: true,
  });
  const baseAnchor = parseJson(baseAnchorCapture.bytes, "Round23 base anchor");
  if (baseAnchor.digest !== expectedBaseAnchorDigest
    || baseAnchor.digest !== parentEvidence.externalAnchor.digest
    || baseAnchor.repositoryRealpath !== root) {
    throw new Error("Round23 base anchor differs from caller/parent evidence");
  }
  const externalDirectory = path.dirname(baseAnchorPath);
  for (const reference of parentEvidence.externalEvidence) {
    const absolutePath = path.join(externalDirectory, reference.basename);
    const capture = await readStableFile(absolutePath,
      `Round23 external evidence ${reference.role}`);
    if (capture.digest !== reference.sha256) {
      throw new Error(`Round23 external evidence drifted: ${reference.role}`);
    }
  }
}

function createLiveLifecycle(profile, closedWorld, admission, successor) {
  const definitions = new Map([
    ...closedWorld.historicalFeatures.map((entry) => [entry.id, entry.stableDefinition]),
    [CONTINUATION_V3_FEATURE_ID, admission.featureDefinition],
    [CONTINUATION_V3_SUCCESSOR_FEATURE_ID, successor.featureDefinition],
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
      .map((state) => ({ ...definitions.get(state.id), status: state.status })),
  };
}

function assertAdmissionTrustRootConfigured() {
  const values = [
    CONTINUATION_POLICY_V3_ADMISSION_FILE_COUNT,
    CONTINUATION_POLICY_V3_ADMISSION_FILE_SET_DIGEST,
    CONTINUATION_POLICY_V3_ADMISSION_FEATURE_DEFINITION_DIGEST,
    CONTINUATION_POLICY_V3_ADMISSION_WORKSTREAM_DEFINITION_DIGEST,
  ];
  if (!Number.isInteger(values[0]) || values[0] <= 0
    || values.slice(1).some((value) => !sha256DigestV3(value))) {
    throw new Error("Round3 admission hard constants are unconfigured");
  }
}

async function publishPrivateNoReplace(absolutePath, bytes, root) {
  let handle;
  try {
    handle = await open(absolutePath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      PRIVATE_MODE);
    await handle.chmod(PRIVATE_MODE);
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = await readStableFile(absolutePath, "existing Round3 policy", {
      expectedRoot: root,
      requirePrivate: true,
    });
    if (!existing.bytes.equals(bytes)) {
      throw new Error("existing Round3 policy has third-state bytes");
    }
    return "idempotent";
  } finally {
    await handle?.close();
  }
  const directoryHandle = await open(path.dirname(absolutePath),
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    await directoryHandle.sync();
  } finally {
    await directoryHandle.close();
  }
  const published = await readStableFile(absolutePath, "published Round3 policy", {
    expectedRoot: root,
    requirePrivate: true,
  });
  if (!published.bytes.equals(bytes)) throw new Error("published policy bytes changed");
  return "created";
}

async function readStableFile(
  absolutePath,
  label,
  { expectedRoot, requirePrivate = false } = {},
) {
  const before = await lstat(absolutePath);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) {
    throw new Error(`${label} must be a non-symlink single-link regular file`);
  }
  const mode = before.mode & 0o777;
  if (requirePrivate && mode !== PRIVATE_MODE) {
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
    const canonicalPath = await realpath(absolutePath);
    if (canonicalPath !== absolutePath
      || (expectedRoot && !isWithin(expectedRoot, canonicalPath))) {
      throw new Error(`${label} traverses an alias or escaped its root`);
    }
    return { bytes, digest: sha256BytesV3(bytes), mode };
  } finally {
    await handle.close();
  }
}

async function assertRepositoryPathAbsent(root, relativePath, label) {
  const absolutePath = path.join(root, relativePath);
  const parentPath = path.dirname(absolutePath);
  const canonicalParent = await realpath(parentPath);
  if (canonicalParent !== parentPath || !isWithin(root, canonicalParent)) {
    throw new Error(`${label} parent traverses an alias or escaped its root`);
  }
  try {
    await lstat(absolutePath);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`${label} expected-absent path is preplanted`);
}

async function canonicalDirectory(value, label) {
  if (!path.isAbsolute(value ?? "")) throw new Error(`${label} must be absolute`);
  const canonicalPath = await realpath(value);
  if (canonicalPath !== value || !(await stat(canonicalPath)).isDirectory()) {
    throw new Error(`${label} must be one canonical directory`);
  }
  return canonicalPath;
}

function resolveRepositoryOutput(root, value) {
  const resolved = path.resolve(path.isAbsolute(value) ? value : path.join(root, value));
  if (!isWithin(root, resolved)) throw new Error("--output must remain in repository");
  return resolved;
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

function parseOptions(argv) {
  const options = { repositoryRoot: process.cwd() };
  const keys = new Map([
    ["--base-anchor", "baseAnchorPath"],
    ["--expected-base-anchor-digest", "expectedBaseAnchorDigest"],
    ["--output", "outputPath"],
  ]);
  for (let index = 0; index < argv.length; index += 2) {
    const key = keys.get(argv[index]);
    if (!key || options[key] !== undefined || argv[index + 1] === undefined) {
      throw new Error(`unknown, duplicate, or valueless option: ${argv[index]}`);
    }
    options[key] = argv[index + 1];
  }
  return options;
}

async function cli() {
  try {
    const result = await buildConversationDisclosureContinuationPolicyV3(
      parseOptions(process.argv.slice(2)),
    );
    process.stdout.write(`${JSON.stringify({
      kind: "cd03a-continuation-policy-v3-builder-receipt",
      status: "passed",
      publicationStatus: result.publicationStatus,
      policyDigest: result.policy.digest,
      outputPath: CONTINUATION_V3_POLICY_PATH,
    })}\n`);
  } catch (error) {
    console.error(`Continuation policy v3 builder failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await cli();
}
