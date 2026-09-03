#!/usr/bin/env node

import { realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

import {
  CONTINUATION_V9_ADMISSION_CLASSES,
  CONTINUATION_V9_ADMISSION_CLASS_SET_DIGEST,
  CONTINUATION_V9_ALGORITHM,
  CONTINUATION_V9_BASELINE_ARCHIVE_KIND,
  CONTINUATION_V9_BASELINE_ARCHIVE_PATH,
  CONTINUATION_V9_EXECUTABLE_KINDS,
  CONTINUATION_V9_EXECUTABLE_PATH_BY_KIND,
  CONTINUATION_V9_FEATURE_ID,
  CONTINUATION_V9_GOVERNANCE_TRANSITION_TRUST_ROOTS,
  CONTINUATION_V9_POLICY_ID,
  CONTINUATION_V9_POLICY_KIND,
  CONTINUATION_V9_POLICY_PATH,
  CONTINUATION_V9_REJECTED_OUTPUT_ABSENT_PATHS,
  CONTINUATION_V9_REVIEW_OUTPUT_PATHS,
  CONTINUATION_V9_REVIEW_SNAPSHOT_PATH,
  CONTINUATION_V9_ROUND,
  CONTINUATION_V9_ROUND8_POLICY_TRUST_ROOT,
  CONTINUATION_V9_ROUND8_REVIEW_REJECTION_PATH,
  CONTINUATION_V9_SUCCESSOR_FEATURE_ID,
  CONTINUATION_V9_SUCCESSOR_WORKSTREAM_ID,
  CONTINUATION_V9_WORKSTREAM_ID,
  buildAdmissionCoverageV9,
  expectedRejectedRound8AnchorRuleV9,
  hashCanonicalV9,
  serializeRound8ReviewRejectionV9,
  sha256DigestV9,
  stableFeatureDefinitionV9,
  stableProgramRootDefinitionV9,
  stableWorkstreamDefinitionV9,
  validateBaselineArchiveV9,
  validateContinuationPolicyV9,
  validateGovernanceTransitionStateV9,
  validateRound8ReviewRejectionV9,
  withCanonicalDigestV9,
} from "./conversation-disclosure-continuation-contract-v9.mjs";
import {
  capturePrivateEvidenceV9,
  captureRequiredAbsentV9,
  captureStableFileV9,
  createCaptureLedgerV9,
  postflightCaptureLedgerV9,
  publishPrivateExactV9,
} from "./conversation-disclosure-continuation-runtime-io-v9.mjs";
import {
  validateBaselineArchiveV8,
  validateContinuationPolicyV8,
} from "./conversation-disclosure-continuation-contract-v8.mjs";

const PROGRAM_PATH = ".zerox/conversation-disclosure-program.json";
const FEATURE_LIST_PATH = ".zerox/feature_list.json";
const ROUND8_ARCHIVE_PATH =
  ".zerox/verification/conversation-disclosure/CD03A-round8-baseline-archive.json";

export const CONTINUATION_POLICY_V9_PRESENT_BOOKKEEPING_PATHS = Object.freeze([
  PROGRAM_PATH,
  FEATURE_LIST_PATH,
  ".zerox/progress.md",
  "findings.md",
  "progress.md",
  "task_plan.md",
]);
export const CONTINUATION_POLICY_V9_ABSENT_BOOKKEEPING_PATHS = Object.freeze([
  ".zerox/reviews/CD04-shadow-parity-review.md",
  ".zerox/verification/conversation-disclosure/CD04-performance-baseline.json",
  ".zerox/verification/conversation-disclosure/CD04-shadow-parity.json",
]);
export const CONTINUATION_POLICY_V9_REQUIRED_ROSTER_PATHS = Object.freeze([
  ".zerox/decisions/CD03A-round9-descriptor-transaction-trust-head.md",
  "HANDOFF-v3.9.2-conversation-disclosure-round9.md",
  CONTINUATION_V9_ROUND8_REVIEW_REJECTION_PATH,
  CONTINUATION_V9_BASELINE_ARCHIVE_PATH,
  CONTINUATION_V9_POLICY_PATH,
  "scripts/build-conversation-disclosure-review-dispatch-v9.mjs",
  "scripts/build-conversation-disclosure-review-rejection-v9.mjs",
  "scripts/build-conversation-disclosure-continuation-policy-v9.mjs",
  "scripts/build-conversation-disclosure-continuation-manifest-v9.mjs",
  "scripts/run-conversation-disclosure-tests-v9.mjs",
  "scripts/conversation-disclosure-continuation-runtime-io-v9.mjs",
  "scripts/check-conversation-disclosure-program-v9.mjs",
  "src/shared/conversationDisclosureContinuationRuntimeIoV9.test.ts",
  "src/shared/conversationDisclosureContinuationProgramGovernanceV9.test.ts",
  "src/shared/conversationDisclosureReviewDispatchV9.test.ts",
  "src/shared/conversationDisclosureContinuationV9.test.ts",
  "src/shared/conversationDisclosureFinalEvidenceV9.test.ts",
  "src/shared/conversationDisclosureContinuationPolicyV9.test.ts",
  "src/shared/conversationDisclosureContinuationFreezeV9.test.ts",
  "src/shared/conversationDisclosureContinuationCheckerV9.test.ts",
  "src/shared/conversationDisclosureContinuationManifestV9.test.ts",
  "src/shared/conversationDisclosureContinuationRunnerV9.test.ts",
  "src/shared/conversationDisclosureTestOrchestratorV9.test.ts",
  ...Object.values(CONTINUATION_V9_EXECUTABLE_PATH_BY_KIND),
  ...CONTINUATION_V9_GOVERNANCE_TRANSITION_TRUST_ROOTS.map(
    (entry) => entry.stagedTargetPath,
  ),
  ...CONTINUATION_V9_REVIEW_OUTPUT_PATHS,
  ...CONTINUATION_V9_REJECTED_OUTPUT_ABSENT_PATHS,
  ...CONTINUATION_POLICY_V9_PRESENT_BOOKKEEPING_PATHS,
].sort());

export const CONTINUATION_POLICY_V9_SUCCESSOR_CHECKER_VERIFICATION =
  "node scripts/check-conversation-disclosure-continuation-v9.mjs --mode authorized_active --control-root CALLER_SUPPLIED_CONTROL_ROOT --subject-repository-realpath CALLER_SUPPLIED_SUBJECT_REPOSITORY_REALPATH --base-anchor CALLER_SUPPLIED_BASE_PATH --expected-base-anchor-digest CALLER_SUPPLIED_BASE_DIGEST --expected-policy-digest CALLER_SUPPLIED_POLICY_DIGEST --expected-snapshot-digest CALLER_SUPPLIED_SNAPSHOT_DIGEST --continuation-anchor CALLER_SUPPLIED_CONTINUATION_PATH --expected-continuation-anchor-digest CALLER_SUPPLIED_CONTINUATION_DIGEST";
export const CONTINUATION_POLICY_V9_SUCCESSOR_HARNESS_VERIFICATION =
  "node scripts/check-harness-state.mjs --mode authorized_active --control-root CALLER_SUPPLIED_CONTROL_ROOT --subject-repository-realpath CALLER_SUPPLIED_SUBJECT_REPOSITORY_REALPATH --base-anchor CALLER_SUPPLIED_BASE_PATH --expected-base-anchor-digest CALLER_SUPPLIED_BASE_DIGEST --expected-policy-digest CALLER_SUPPLIED_POLICY_DIGEST --expected-snapshot-digest CALLER_SUPPLIED_SNAPSHOT_DIGEST --continuation-anchor CALLER_SUPPLIED_CONTINUATION_PATH --expected-continuation-anchor-digest CALLER_SUPPLIED_CONTINUATION_DIGEST";

export function createConversationDisclosureContinuationPolicyV9({
  program,
  featureList,
  parentPolicy,
  round8ReviewRejection,
  baselineArchive,
  pathAuthorities,
  continuationExecutables,
  governanceTransitions =
    CONTINUATION_V9_GOVERNANCE_TRANSITION_TRUST_ROOTS,
}) {
  const feature = featureList?.features?.find(
    (entry) => entry?.id === CONTINUATION_V9_FEATURE_ID,
  );
  const workstream = program?.workstreams?.find(
    (entry) => entry?.id === CONTINUATION_V9_WORKSTREAM_ID,
  );
  if (!feature || feature.status !== "in_progress"
    || !workstream || workstream.state !== "in_progress") {
    throw new Error("live P107A/CD03A admission must be in_progress");
  }
  const featureDefinition = stableFeatureDefinitionV9(feature);
  const featurePaths = new Set(featureDefinition.files);
  for (const requiredPath of CONTINUATION_POLICY_V9_REQUIRED_ROSTER_PATHS) {
    if (!featurePaths.has(requiredPath)) {
      throw new Error(`P107A V9 roster misses required path: ${requiredPath}`);
    }
  }
  const workstreamDefinition = stableWorkstreamDefinitionV9(workstream);
  const admission = {
    workstreamDefinition,
    workstreamDefinitionDigest: hashCanonicalV9(workstreamDefinition),
    featureDefinition,
    featureDefinitionDigest: hashCanonicalV9(featureDefinition),
    featureFileSetDigest: hashCanonicalV9(featureDefinition.files),
    postReviewMutablePaths: [
      ...CONTINUATION_POLICY_V9_PRESENT_BOOKKEEPING_PATHS,
    ],
    reviewCoverageDigest: null,
    reviewOutputPaths: [...CONTINUATION_V9_REVIEW_OUTPUT_PATHS],
  };
  const admissionCoverage = buildAdmissionCoverageV9(
    admission,
    governanceTransitions,
  );
  admission.reviewCoverageDigest = hashCanonicalV9(admissionCoverage);

  const trustRoots = [
    ...governanceTransitions.map((entry) => ({
      path: entry.path,
      sha256: entry.toSha256,
    })),
    ...continuationExecutables.map((entry) => ({
      path: entry.path,
      sha256: entry.sha256,
    })),
  ].sort(comparePath);
  const successor = buildSuccessorV9(
    parentPolicy.successor,
    program,
    pathAuthorities,
    trustRoots,
    governanceTransitions,
  );
  const closedWorld = buildClosedWorldV9(
    parentPolicy.closedWorld,
    program,
  );
  const policy = withCanonicalDigestV9({
    schemaVersion: 9,
    kind: CONTINUATION_V9_POLICY_KIND,
    algorithm: CONTINUATION_V9_ALGORITHM,
    policyId: CONTINUATION_V9_POLICY_ID,
    programId: program.programId,
    workstreamId: CONTINUATION_V9_WORKSTREAM_ID,
    featureId: CONTINUATION_V9_FEATURE_ID,
    round: CONTINUATION_V9_ROUND,
    status: "frozen",
    parentEvidence: structuredClone(parentPolicy.parentEvidence),
    round1Rejection: structuredClone(parentPolicy.round1Rejection),
    round2PrefreezeRejection: structuredClone(
      parentPolicy.round2PrefreezeRejection,
    ),
    round8ReviewRejection: structuredClone(round8ReviewRejection),
    closedWorld,
    admission,
    admissionClassSet: [...CONTINUATION_V9_ADMISSION_CLASSES],
    admissionClassSetDigest: CONTINUATION_V9_ADMISSION_CLASS_SET_DIGEST,
    admissionCoverage,
    successor,
    pathAuthorities: structuredClone(pathAuthorities),
    trustRoots,
    governanceTransitions: governanceTransitions.map((entry) => ({
      ...entry,
    })),
    continuationExecutables: continuationExecutables.map((entry) => ({
      ...entry,
    })),
    baselineArchive: {
      path: CONTINUATION_V9_BASELINE_ARCHIVE_PATH,
      digest: baselineArchive.digest,
      entrySetDigest: baselineArchive.entrySetDigest,
    },
    reviewSnapshot: { path: CONTINUATION_V9_REVIEW_SNAPSHOT_PATH },
    reviewAssurancePolicy: {
      callerDispatchAssurance:
        "caller-attested-not-signed",
      identityAssurance: "not-signed",
      independenceClaim: "caller-attested-distinct-review-contexts",
      localIdentityProof: false,
    },
    externalAnchorPolicy: expectedRejectedRound8AnchorRuleV9(),
    timePolicy: { futureToleranceMs: 0 },
  });
  assertNoErrors(validateContinuationPolicyV9(policy, {
    expectedDigest: policy.digest,
    expectedAdmissionRoots: {
      featureDefinitionDigest: admission.featureDefinitionDigest,
      featureFileSetDigest: admission.featureFileSetDigest,
      workstreamDefinitionDigest: admission.workstreamDefinitionDigest,
      programRootDefinitionDigest: closedWorld.programRootDefinitionDigest,
    },
  }), "generated continuation policy V9");
  return policy;
}

export async function buildConversationDisclosureContinuationPolicyV9({
  repositoryRoot = process.cwd(),
  baseAnchorPath,
  expectedBaseAnchorDigest,
  archiveOutputPath,
  outputPath,
} = {}) {
  const root = await canonicalRepositoryRoot(repositoryRoot);
  if (!path.isAbsolute(baseAnchorPath ?? "")
    || !sha256DigestV9(expectedBaseAnchorDigest)) {
    throw new Error("caller must pin one absolute base anchor and digest");
  }
  const canonicalBaseAnchor = await realpath(baseAnchorPath);
  if (canonicalBaseAnchor !== baseAnchorPath
    || isWithin(root, canonicalBaseAnchor)) {
    throw new Error("base anchor must be canonical and outside the repository");
  }

  const ledger = createCaptureLedgerV9();
  const captures = new Map();
  const captureRepository = async (
    relativePath,
    label = relativePath,
    { privateEvidence = false } = {},
  ) => {
    if (!captures.has(relativePath)) {
      const absolutePath = path.join(root, relativePath);
      captures.set(
        relativePath,
        privateEvidence
          ? await capturePrivateEvidenceV9(absolutePath, label, {
            expectedRoot: root,
            ledger,
          })
          : await captureStableFileV9(absolutePath, label, {
            expectedRoot: root,
            ledger,
          }),
      );
    }
    return captures.get(relativePath);
  };
  const readJson = async (relativePath, label, options) =>
    parseJson((await captureRepository(relativePath, label, options)).bytes, label);

  const baseAnchorCapture = await capturePrivateEvidenceV9(
    canonicalBaseAnchor,
    "Round23 caller-pinned base anchor",
    { ledger },
  );
  const baseAnchor = parseJson(baseAnchorCapture.bytes, "Round23 base anchor");
  if (baseAnchor.digest !== expectedBaseAnchorDigest) {
    throw new Error("base anchor canonical digest differs from caller pin");
  }

  const [parentPolicy, round8Archive, rejection, program, featureList] =
    await Promise.all([
      readJson(
        CONTINUATION_V9_ROUND8_POLICY_TRUST_ROOT.path,
        "Round8 rejected policy",
        { privateEvidence: true },
      ),
      readJson(ROUND8_ARCHIVE_PATH, "Round8 baseline archive", {
        privateEvidence: true,
      }),
      readJson(
        CONTINUATION_V9_ROUND8_REVIEW_REJECTION_PATH,
        "Round8 review-rejection witness",
        { privateEvidence: true },
      ),
      readJson(PROGRAM_PATH, "conversation disclosure program"),
      readJson(FEATURE_LIST_PATH, "Feature list"),
    ]);
  const parentPolicyCapture = await captureRepository(
    CONTINUATION_V9_ROUND8_POLICY_TRUST_ROOT.path,
    "Round8 rejected policy",
    { privateEvidence: true },
  );
  if (parentPolicyCapture.digest
      !== CONTINUATION_V9_ROUND8_POLICY_TRUST_ROOT.byteSha256
    || parentPolicy.digest
      !== CONTINUATION_V9_ROUND8_POLICY_TRUST_ROOT.canonicalDigest
    || parentPolicy.parentEvidence?.externalAnchor?.digest
      !== expectedBaseAnchorDigest) {
    throw new Error("Round8 policy/base anchor differs from the caller trust root");
  }
  assertNoErrors(validateContinuationPolicyV8(parentPolicy, {
    expectedDigest:
      CONTINUATION_V9_ROUND8_POLICY_TRUST_ROOT.canonicalDigest,
    baselineArchive: round8Archive,
  }), "Round8 rejected policy");
  assertNoErrors(validateBaselineArchiveV8(round8Archive, parentPolicy),
    "Round8 baseline archive");
  assertNoErrors(validateRound8ReviewRejectionV9(rejection),
    "Round8 review-rejection witness");
  if (!(await captureRepository(
    CONTINUATION_V9_ROUND8_REVIEW_REJECTION_PATH,
    "Round8 review-rejection witness",
    { privateEvidence: true },
  )).bytes.equals(serializeRound8ReviewRejectionV9(rejection))) {
    throw new Error("Round8 review-rejection serialization is not deterministic");
  }

  const transitions = [];
  const liveDigests = new Map();
  const stagedDigests = new Map();
  for (const expected of CONTINUATION_V9_GOVERNANCE_TRANSITION_TRUST_ROOTS) {
    const [live, target] = await Promise.all([
      captureRepository(expected.path, `V9 transition live ${expected.path}`),
      captureRepository(
        expected.stagedTargetPath,
        `V9 transition target ${expected.stagedTargetPath}`,
      ),
    ]);
    if (live.digest !== expected.fromSha256
      || target.digest !== expected.toSha256) {
      throw new Error(`V9 transition bytes drifted: ${expected.path}`);
    }
    liveDigests.set(expected.path, live.digest);
    stagedDigests.set(expected.stagedTargetPath, target.digest);
    transitions.push({ ...expected });
  }
  assertNoErrors(validateGovernanceTransitionStateV9(
    transitions,
    "review_pre_transition",
    liveDigests,
    stagedDigests,
  ), "V9 pre-transition state");

  const continuationExecutables = [];
  for (const kind of CONTINUATION_V9_EXECUTABLE_KINDS) {
    const executablePath = CONTINUATION_V9_EXECUTABLE_PATH_BY_KIND[kind];
    const capture = await captureRepository(
      executablePath,
      `V9 ${kind} executable`,
    );
    continuationExecutables.push({
      kind,
      path: executablePath,
      sha256: capture.digest,
    });
  }
  const pathAuthorities = await rebindRound9BookkeepingBaselinesV9(
    parentPolicy.pathAuthorities,
    {
      readPresentDigest: async (relativePath) =>
        (await captureRepository(
          relativePath,
          `V9 bookkeeping ${relativePath}`,
        )).digest,
      assertAbsent: async (relativePath) => captureRequiredAbsentV9(
        path.join(root, relativePath),
        `V9 absent bookkeeping ${relativePath}`,
        { expectedRoot: root, ledger },
      ),
    },
  );
  const baselineArchive = await createBaselineArchiveV9({
    programId: program.programId,
    pathAuthorities,
    transitions,
    captureRepository,
  });
  const policy = createConversationDisclosureContinuationPolicyV9({
    program,
    featureList,
    parentPolicy,
    round8ReviewRejection: rejection,
    baselineArchive,
    pathAuthorities,
    continuationExecutables,
    governanceTransitions: transitions,
  });
  assertNoErrors(validateBaselineArchiveV9(baselineArchive, policy),
    "generated V9 baseline archive");
  assertNoErrors(validateContinuationPolicyV9(policy, {
    expectedDigest: policy.digest,
    baselineArchive,
  }), "generated V9 policy");
  await postflightCaptureLedgerV9(ledger);

  const archiveBytes = Buffer.from(
    `${JSON.stringify(baselineArchive, null, 2)}\n`,
    "utf8",
  );
  const policyBytes = Buffer.from(`${JSON.stringify(policy, null, 2)}\n`, "utf8");
  let archivePublicationStatus = "not_requested";
  let publicationStatus = "not_requested";
  if (archiveOutputPath !== undefined) {
    archivePublicationStatus = (await publishPrivateExactV9(
      resolveExactOutput(root, archiveOutputPath, CONTINUATION_V9_BASELINE_ARCHIVE_PATH),
      archiveBytes,
      { expectedRoot: root, label: "Round9 baseline archive" },
    )).status;
  }
  if (outputPath !== undefined) {
    publicationStatus = (await publishPrivateExactV9(
      resolveExactOutput(root, outputPath, CONTINUATION_V9_POLICY_PATH),
      policyBytes,
      { expectedRoot: root, label: "Round9 continuation policy" },
    )).status;
  }
  return {
    policy,
    policyBytes,
    baselineArchive,
    archiveBytes,
    archivePublicationStatus,
    publicationStatus,
    captureCount: ledger.entries.length,
  };
}

export async function rebindRound9BookkeepingBaselinesV9(
  source,
  { readPresentDigest, assertAbsent },
) {
  const present = new Set(CONTINUATION_POLICY_V9_PRESENT_BOOKKEEPING_PATHS);
  const absent = new Set(CONTINUATION_POLICY_V9_ABSENT_BOOKKEEPING_PATHS);
  const observedPresent = [];
  const observedAbsent = [];
  const output = [];
  for (const authority of source ?? []) {
    const clone = structuredClone(authority);
    if (clone.class === "bookkeeping" && present.has(clone.path)) {
      clone.baseline = {
        source: "cd03a_review_snapshot",
        presence: "present",
        sha256: await readPresentDigest(clone.path),
      };
      observedPresent.push(clone.path);
    } else if (clone.class === "bookkeeping" && absent.has(clone.path)) {
      await assertAbsent(clone.path);
      clone.baseline = {
        source: clone.baseline.source,
        presence: "absent",
        sha256: null,
      };
      observedAbsent.push(clone.path);
    }
    output.push(clone);
  }
  assertExactSet(observedPresent, present, "present bookkeeping");
  assertExactSet(observedAbsent, absent, "absent bookkeeping");
  return output;
}

async function createBaselineArchiveV9({
  programId,
  pathAuthorities,
  transitions,
  captureRepository,
}) {
  const subjects = [];
  for (const authority of pathAuthorities) {
    if (authority.class === "modify") {
      subjects.push({
        path: authority.path,
        source: authority.baseline.source,
        sha256: authority.baseline.sha256,
      });
    }
  }
  for (const transition of transitions) {
    subjects.push({
      path: transition.path,
      source: "governance_transition",
      sha256: transition.fromSha256,
    });
  }
  subjects.sort(comparePath);
  const entries = [];
  for (const subject of subjects) {
    const capture = await captureRepository(
      subject.path,
      `V9 baseline ${subject.path}`,
    );
    if (capture.digest !== subject.sha256) {
      throw new Error(`V9 baseline bytes drifted: ${subject.path}`);
    }
    entries.push({
      path: subject.path,
      source: subject.source,
      sha256: capture.digest,
      encoding: "gzip-base64-v1",
      bytes: gzipSync(capture.bytes, { level: 9, mtime: 0 })
        .toString("base64"),
    });
  }
  return withCanonicalDigestV9({
    schemaVersion: 9,
    kind: CONTINUATION_V9_BASELINE_ARCHIVE_KIND,
    algorithm: CONTINUATION_V9_ALGORITHM,
    programId,
    workstreamId: CONTINUATION_V9_WORKSTREAM_ID,
    featureId: CONTINUATION_V9_FEATURE_ID,
    round: CONTINUATION_V9_ROUND,
    entries,
    entrySetDigest: hashCanonicalV9(entries),
  });
}

function buildClosedWorldV9(source, program) {
  const closedWorld = structuredClone(source);
  closedWorld.workstreams = program.workstreams.map((entry) => {
    const stableDefinition = stableWorkstreamDefinitionV9(entry);
    return {
      id: entry.id,
      stableDefinition,
      stableDefinitionDigest: hashCanonicalV9(stableDefinition),
    };
  });
  closedWorld.programRootDefinition = stableProgramRootDefinitionV9(program);
  closedWorld.programRootDefinitionDigest = hashCanonicalV9(
    closedWorld.programRootDefinition,
  );
  delete closedWorld.digest;
  closedWorld.digest = hashCanonicalV9(closedWorld);
  return closedWorld;
}

function buildSuccessorV9(
  source,
  program,
  pathAuthorities,
  trustRoots,
  transitions,
) {
  const successor = structuredClone(source);
  const workstream = program.workstreams.find(
    (entry) => entry.id === CONTINUATION_V9_SUCCESSOR_WORKSTREAM_ID,
  );
  if (!workstream || workstream.state !== "planned"
    || successor.featureDefinition.id !== CONTINUATION_V9_SUCCESSOR_FEATURE_ID) {
    throw new Error("P108/CD04 successor definition is invalid");
  }
  successor.workstreamDefinition = stableWorkstreamDefinitionV9(workstream);
  successor.workstreamDefinitionDigest = hashCanonicalV9(
    successor.workstreamDefinition,
  );
  successor.featureDefinition.verification =
    successor.featureDefinition.verification.map((entry) => {
      if (/^node scripts\/check-conversation-disclosure-continuation-v\d+\.mjs --mode authorized_active\b/
        .test(entry)) {
        return CONTINUATION_POLICY_V9_SUCCESSOR_CHECKER_VERIFICATION;
      }
      if (entry.startsWith(
        "node scripts/check-harness-state.mjs --mode authorized_active",
      )) {
        return CONTINUATION_POLICY_V9_SUCCESSOR_HARNESS_VERIFICATION;
      }
      return entry;
    });
  successor.featureDefinitionDigest = hashCanonicalV9(
    successor.featureDefinition,
  );
  const transitionPaths = new Set(transitions.map((entry) => entry.path));
  const coverage = [
    ...pathAuthorities.map((entry) => ({
      path: entry.path,
      class: entry.class,
    })),
    ...trustRoots
      .filter((entry) => !transitionPaths.has(entry.path))
      .map((entry) => ({ path: entry.path, class: "trust_root" })),
    ...transitions.map((entry) => ({
      path: entry.path,
      class: "governance_transition",
    })),
  ].filter((entry) => successor.featureDefinition.files.includes(entry.path))
    .sort(comparePath);
  if (coverage.length !== successor.featureDefinition.files.length
    || new Set(coverage.map((entry) => entry.path)).size !== coverage.length) {
    throw new Error("P108 successor paths are not covered exactly once");
  }
  successor.pathCoverageDigest = hashCanonicalV9(coverage);
  return successor;
}

async function canonicalRepositoryRoot(candidate) {
  const resolved = path.resolve(candidate);
  const canonical = await realpath(resolved);
  if (canonical !== resolved) {
    throw new Error("repository root must be canonical");
  }
  return canonical;
}

function resolveExactOutput(root, candidate, expectedRelativePath) {
  const resolved = path.resolve(root, candidate);
  if (resolved !== path.join(root, expectedRelativePath)) {
    throw new Error(`output must be the exact path ${expectedRelativePath}`);
  }
  return resolved;
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

function assertNoErrors(errors, label) {
  if (errors.length > 0) {
    throw new Error(`${label} is invalid: ${errors.join("; ")}`);
  }
}

function assertExactSet(actual, expected, label) {
  const values = [...new Set(actual)].sort();
  if (values.length !== expected.size
    || values.some((entry) => !expected.has(entry))) {
    throw new Error(`${label} roster is not exact`);
  }
}

function comparePath(left, right) {
  return left.path.localeCompare(right.path);
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === ""
    || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => argv[++index];
    if (argument === "--repository-root") options.repositoryRoot = value();
    else if (argument === "--base-anchor") options.baseAnchorPath = value();
    else if (argument === "--expected-base-anchor-digest") {
      options.expectedBaseAnchorDigest = value();
    } else if (argument === "--archive-output") {
      options.archiveOutputPath = value();
    } else if (argument === "--output") options.outputPath = value();
    else throw new Error(`unknown argument: ${argument}`);
  }
  return options;
}

if (process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  buildConversationDisclosureContinuationPolicyV9(
    parseArguments(process.argv.slice(2)),
  ).then((result) => {
    process.stdout.write(`${JSON.stringify({
      status: "passed",
      policyDigest: result.policy.digest,
      archiveDigest: result.baselineArchive.digest,
      archivePublicationStatus: result.archivePublicationStatus,
      publicationStatus: result.publicationStatus,
      captureCount: result.captureCount,
    })}\n`);
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
