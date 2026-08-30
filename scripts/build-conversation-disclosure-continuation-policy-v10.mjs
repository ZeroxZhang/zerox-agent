#!/usr/bin/env node

import { realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

import {
  CONTINUATION_V10_ADMISSION_CLASSES,
  CONTINUATION_V10_ADMISSION_CLASS_SET_DIGEST,
  CONTINUATION_V10_ALGORITHM,
  CONTINUATION_V10_BASELINE_ARCHIVE_KIND,
  CONTINUATION_V10_BASELINE_ARCHIVE_PATH,
  CONTINUATION_V10_EXECUTABLE_KINDS,
  CONTINUATION_V10_EXECUTABLE_PATH_BY_KIND,
  CONTINUATION_V10_FEATURE_ID,
  CONTINUATION_V10_GOVERNANCE_TRANSITION_TRUST_ROOTS,
  CONTINUATION_V10_POLICY_ID,
  CONTINUATION_V10_POLICY_KIND,
  CONTINUATION_V10_POLICY_PATH,
  CONTINUATION_V10_REJECTED_OUTPUT_ABSENT_PATHS,
  CONTINUATION_V10_REVIEW_OUTPUT_PATHS,
  CONTINUATION_V10_REVIEW_SNAPSHOT_PATH,
  CONTINUATION_V10_ROUND,
  CONTINUATION_V10_ROUND9_POLICY_TRUST_ROOT,
  CONTINUATION_V10_ROUND9_REVIEW_REJECTION_PATH,
  CONTINUATION_V10_SUCCESSOR_FEATURE_ID,
  CONTINUATION_V10_SUCCESSOR_WORKSTREAM_ID,
  CONTINUATION_V10_WORKSTREAM_ID,
  buildAdmissionCoverageV10,
  expectedRejectedRound9AnchorRuleV10,
  hashCanonicalV10,
  serializeRound9ReviewRejectionV10,
  sha256DigestV10,
  stableFeatureDefinitionV10,
  stableProgramRootDefinitionV10,
  stableWorkstreamDefinitionV10,
  validateBaselineArchiveV10,
  validateContinuationPolicyV10,
  validateGovernanceTransitionStateV10,
  validateRound9ReviewRejectionV10,
  withCanonicalDigestV10,
} from "./conversation-disclosure-continuation-contract-v10.mjs";
import {
  capturePrivateEvidenceV10,
  captureRequiredAbsentV10,
  captureStableFileV10,
  createCaptureLedgerV10,
  postflightCaptureLedgerV10,
  publishPrivateExactV10,
} from "./conversation-disclosure-continuation-runtime-io-v10.mjs";
import {
  validateBaselineArchiveV9,
  validateContinuationPolicyV9,
} from "./conversation-disclosure-continuation-contract-v9.mjs";

const PROGRAM_PATH = ".zerox/conversation-disclosure-program.json";
const FEATURE_LIST_PATH = ".zerox/feature_list.json";
const ROUND9_ARCHIVE_PATH =
  ".zerox/verification/conversation-disclosure/CD03A-round9-baseline-archive.json";

export const CONTINUATION_POLICY_V10_PRESENT_BOOKKEEPING_PATHS = Object.freeze([
  PROGRAM_PATH,
  FEATURE_LIST_PATH,
  ".zerox/progress.md",
  "findings.md",
  "progress.md",
  "task_plan.md",
]);
export const CONTINUATION_POLICY_V10_ABSENT_BOOKKEEPING_PATHS = Object.freeze([
  ".zerox/reviews/CD04-shadow-parity-review.md",
  ".zerox/verification/conversation-disclosure/CD04-performance-baseline.json",
  ".zerox/verification/conversation-disclosure/CD04-shadow-parity.json",
]);
export const CONTINUATION_POLICY_V10_REQUIRED_ROSTER_PATHS = Object.freeze([
  ".zerox/decisions/CD03A-round10-final-evidence-binding-trust-head.md",
  "HANDOFF-v3.9.2-conversation-disclosure-round10.md",
  CONTINUATION_V10_ROUND9_REVIEW_REJECTION_PATH,
  CONTINUATION_V10_BASELINE_ARCHIVE_PATH,
  CONTINUATION_V10_POLICY_PATH,
  "scripts/build-conversation-disclosure-review-dispatch-v10.mjs",
  "scripts/build-conversation-disclosure-review-rejection-v10.mjs",
  "scripts/build-conversation-disclosure-continuation-policy-v10.mjs",
  "scripts/build-conversation-disclosure-continuation-manifest-v10.mjs",
  "scripts/run-conversation-disclosure-tests-v10.mjs",
  "scripts/conversation-disclosure-continuation-runtime-io-v10.mjs",
  "scripts/check-conversation-disclosure-program-v10.mjs",
  "src/shared/conversationDisclosureContinuationRuntimeIoV10.test.ts",
  "src/shared/conversationDisclosureContinuationProgramGovernanceV10.test.ts",
  "src/shared/conversationDisclosureReviewDispatchV10.test.ts",
  "src/shared/conversationDisclosureContinuationV10.test.ts",
  "src/shared/conversationDisclosureFinalEvidenceV10.test.ts",
  "src/shared/conversationDisclosureContinuationPolicyV10.test.ts",
  "src/shared/conversationDisclosureContinuationFreezeV10.test.ts",
  "src/shared/conversationDisclosureContinuationCheckerV10.test.ts",
  "src/shared/conversationDisclosureContinuationManifestV10.test.ts",
  "src/shared/conversationDisclosureContinuationRunnerV10.test.ts",
  "src/shared/conversationDisclosureTestOrchestratorV10.test.ts",
  ...Object.values(CONTINUATION_V10_EXECUTABLE_PATH_BY_KIND),
  ...CONTINUATION_V10_GOVERNANCE_TRANSITION_TRUST_ROOTS.map(
    (entry) => entry.stagedTargetPath,
  ),
  ...CONTINUATION_V10_REVIEW_OUTPUT_PATHS,
  ...CONTINUATION_V10_REJECTED_OUTPUT_ABSENT_PATHS,
  ...CONTINUATION_POLICY_V10_PRESENT_BOOKKEEPING_PATHS,
].sort());

export const CONTINUATION_POLICY_V10_SUCCESSOR_CHECKER_VERIFICATION =
  "node scripts/check-conversation-disclosure-continuation-v10.mjs --mode authorized_active --control-root CALLER_SUPPLIED_CONTROL_ROOT --subject-repository-realpath CALLER_SUPPLIED_SUBJECT_REPOSITORY_REALPATH --base-anchor CALLER_SUPPLIED_BASE_PATH --expected-base-anchor-digest CALLER_SUPPLIED_BASE_DIGEST --expected-policy-digest CALLER_SUPPLIED_POLICY_DIGEST --expected-snapshot-digest CALLER_SUPPLIED_SNAPSHOT_DIGEST --continuation-anchor CALLER_SUPPLIED_CONTINUATION_PATH --expected-continuation-anchor-digest CALLER_SUPPLIED_CONTINUATION_DIGEST";
export const CONTINUATION_POLICY_V10_SUCCESSOR_HARNESS_VERIFICATION =
  "node scripts/check-harness-state.mjs --mode authorized_active --control-root CALLER_SUPPLIED_CONTROL_ROOT --subject-repository-realpath CALLER_SUPPLIED_SUBJECT_REPOSITORY_REALPATH --base-anchor CALLER_SUPPLIED_BASE_PATH --expected-base-anchor-digest CALLER_SUPPLIED_BASE_DIGEST --expected-policy-digest CALLER_SUPPLIED_POLICY_DIGEST --expected-snapshot-digest CALLER_SUPPLIED_SNAPSHOT_DIGEST --continuation-anchor CALLER_SUPPLIED_CONTINUATION_PATH --expected-continuation-anchor-digest CALLER_SUPPLIED_CONTINUATION_DIGEST";

export function createConversationDisclosureContinuationPolicyV10({
  program,
  featureList,
  parentPolicy,
  round9ReviewRejection,
  baselineArchive,
  pathAuthorities,
  continuationExecutables,
  governanceTransitions =
    CONTINUATION_V10_GOVERNANCE_TRANSITION_TRUST_ROOTS,
}) {
  const feature = featureList?.features?.find(
    (entry) => entry?.id === CONTINUATION_V10_FEATURE_ID,
  );
  const workstream = program?.workstreams?.find(
    (entry) => entry?.id === CONTINUATION_V10_WORKSTREAM_ID,
  );
  if (!feature || feature.status !== "in_progress"
    || !workstream || workstream.state !== "in_progress") {
    throw new Error("live P107A/CD03A admission must be in_progress");
  }
  const featureDefinition = stableFeatureDefinitionV10(feature);
  const featurePaths = new Set(featureDefinition.files);
  for (const requiredPath of CONTINUATION_POLICY_V10_REQUIRED_ROSTER_PATHS) {
    if (!featurePaths.has(requiredPath)) {
      throw new Error(`P107A V10 roster misses required path: ${requiredPath}`);
    }
  }
  const workstreamDefinition = stableWorkstreamDefinitionV10(workstream);
  const admission = {
    workstreamDefinition,
    workstreamDefinitionDigest: hashCanonicalV10(workstreamDefinition),
    featureDefinition,
    featureDefinitionDigest: hashCanonicalV10(featureDefinition),
    featureFileSetDigest: hashCanonicalV10(featureDefinition.files),
    postReviewMutablePaths: [
      ...CONTINUATION_POLICY_V10_PRESENT_BOOKKEEPING_PATHS,
    ],
    reviewCoverageDigest: null,
    reviewOutputPaths: [...CONTINUATION_V10_REVIEW_OUTPUT_PATHS],
  };
  const admissionCoverage = buildAdmissionCoverageV10(
    admission,
    governanceTransitions,
  );
  admission.reviewCoverageDigest = hashCanonicalV10(admissionCoverage);

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
  const successor = buildSuccessorV10(
    parentPolicy.successor,
    program,
    pathAuthorities,
    trustRoots,
    governanceTransitions,
  );
  const closedWorld = buildClosedWorldV10(
    parentPolicy.closedWorld,
    program,
  );
  const policy = withCanonicalDigestV10({
    schemaVersion: 10,
    kind: CONTINUATION_V10_POLICY_KIND,
    algorithm: CONTINUATION_V10_ALGORITHM,
    policyId: CONTINUATION_V10_POLICY_ID,
    programId: program.programId,
    workstreamId: CONTINUATION_V10_WORKSTREAM_ID,
    featureId: CONTINUATION_V10_FEATURE_ID,
    round: CONTINUATION_V10_ROUND,
    status: "frozen",
    parentEvidence: structuredClone(parentPolicy.parentEvidence),
    round1Rejection: structuredClone(parentPolicy.round1Rejection),
    round2PrefreezeRejection: structuredClone(
      parentPolicy.round2PrefreezeRejection,
    ),
    round9ReviewRejection: structuredClone(round9ReviewRejection),
    closedWorld,
    admission,
    admissionClassSet: [...CONTINUATION_V10_ADMISSION_CLASSES],
    admissionClassSetDigest: CONTINUATION_V10_ADMISSION_CLASS_SET_DIGEST,
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
      path: CONTINUATION_V10_BASELINE_ARCHIVE_PATH,
      digest: baselineArchive.digest,
      entrySetDigest: baselineArchive.entrySetDigest,
    },
    reviewSnapshot: { path: CONTINUATION_V10_REVIEW_SNAPSHOT_PATH },
    reviewAssurancePolicy: {
      callerDispatchAssurance:
        "caller-attested-not-signed",
      identityAssurance: "not-signed",
      independenceClaim: "caller-attested-distinct-review-contexts",
      localIdentityProof: false,
    },
    externalAnchorPolicy: expectedRejectedRound9AnchorRuleV10(),
    timePolicy: { futureToleranceMs: 0 },
  });
  assertNoErrors(validateContinuationPolicyV10(policy, {
    expectedDigest: policy.digest,
    expectedAdmissionRoots: {
      featureDefinitionDigest: admission.featureDefinitionDigest,
      featureFileSetDigest: admission.featureFileSetDigest,
      workstreamDefinitionDigest: admission.workstreamDefinitionDigest,
      programRootDefinitionDigest: closedWorld.programRootDefinitionDigest,
    },
  }), "generated continuation policy V10");
  return policy;
}

export async function buildConversationDisclosureContinuationPolicyV10({
  repositoryRoot = process.cwd(),
  baseAnchorPath,
  expectedBaseAnchorDigest,
  archiveOutputPath,
  outputPath,
} = {}) {
  const root = await canonicalRepositoryRoot(repositoryRoot);
  if (!path.isAbsolute(baseAnchorPath ?? "")
    || !sha256DigestV10(expectedBaseAnchorDigest)) {
    throw new Error("caller must pin one absolute base anchor and digest");
  }
  const canonicalBaseAnchor = await realpath(baseAnchorPath);
  if (canonicalBaseAnchor !== baseAnchorPath
    || isWithin(root, canonicalBaseAnchor)) {
    throw new Error("base anchor must be canonical and outside the repository");
  }

  const ledger = createCaptureLedgerV10();
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
          ? await capturePrivateEvidenceV10(absolutePath, label, {
            expectedRoot: root,
            ledger,
          })
          : await captureStableFileV10(absolutePath, label, {
            expectedRoot: root,
            ledger,
          }),
      );
    }
    return captures.get(relativePath);
  };
  const readJson = async (relativePath, label, options) =>
    parseJson((await captureRepository(relativePath, label, options)).bytes, label);

  const baseAnchorCapture = await capturePrivateEvidenceV10(
    canonicalBaseAnchor,
    "Round23 caller-pinned base anchor",
    { ledger },
  );
  const baseAnchor = parseJson(baseAnchorCapture.bytes, "Round23 base anchor");
  if (baseAnchor.digest !== expectedBaseAnchorDigest) {
    throw new Error("base anchor canonical digest differs from caller pin");
  }

  const [parentPolicy, round9Archive, rejection, program, featureList] =
    await Promise.all([
      readJson(
        CONTINUATION_V10_ROUND9_POLICY_TRUST_ROOT.path,
        "Round9 rejected policy",
        { privateEvidence: true },
      ),
      readJson(ROUND9_ARCHIVE_PATH, "Round9 baseline archive", {
        privateEvidence: true,
      }),
      readJson(
        CONTINUATION_V10_ROUND9_REVIEW_REJECTION_PATH,
        "Round9 review-rejection witness",
        { privateEvidence: true },
      ),
      readJson(PROGRAM_PATH, "conversation disclosure program"),
      readJson(FEATURE_LIST_PATH, "Feature list"),
    ]);
  const parentPolicyCapture = await captureRepository(
    CONTINUATION_V10_ROUND9_POLICY_TRUST_ROOT.path,
    "Round9 rejected policy",
    { privateEvidence: true },
  );
  if (parentPolicyCapture.digest
      !== CONTINUATION_V10_ROUND9_POLICY_TRUST_ROOT.byteSha256
    || parentPolicy.digest
      !== CONTINUATION_V10_ROUND9_POLICY_TRUST_ROOT.canonicalDigest
    || parentPolicy.parentEvidence?.externalAnchor?.digest
      !== expectedBaseAnchorDigest) {
    throw new Error("Round9 policy/base anchor differs from the caller trust root");
  }
  assertNoErrors(validateContinuationPolicyV9(parentPolicy, {
    expectedDigest:
      CONTINUATION_V10_ROUND9_POLICY_TRUST_ROOT.canonicalDigest,
    baselineArchive: round9Archive,
  }), "Round9 rejected policy");
  assertNoErrors(validateBaselineArchiveV9(round9Archive, parentPolicy),
    "Round9 baseline archive");
  assertNoErrors(validateRound9ReviewRejectionV10(rejection),
    "Round9 review-rejection witness");
  if (!(await captureRepository(
    CONTINUATION_V10_ROUND9_REVIEW_REJECTION_PATH,
    "Round9 review-rejection witness",
    { privateEvidence: true },
  )).bytes.equals(serializeRound9ReviewRejectionV10(rejection))) {
    throw new Error("Round9 review-rejection serialization is not deterministic");
  }

  const transitions = [];
  const liveDigests = new Map();
  const stagedDigests = new Map();
  for (const expected of CONTINUATION_V10_GOVERNANCE_TRANSITION_TRUST_ROOTS) {
    const [live, target] = await Promise.all([
      captureRepository(expected.path, `V10 transition live ${expected.path}`),
      captureRepository(
        expected.stagedTargetPath,
        `V10 transition target ${expected.stagedTargetPath}`,
      ),
    ]);
    if (live.digest !== expected.fromSha256
      || target.digest !== expected.toSha256) {
      throw new Error(`V10 transition bytes drifted: ${expected.path}`);
    }
    liveDigests.set(expected.path, live.digest);
    stagedDigests.set(expected.stagedTargetPath, target.digest);
    transitions.push({ ...expected });
  }
  assertNoErrors(validateGovernanceTransitionStateV10(
    transitions,
    "review_pre_transition",
    liveDigests,
    stagedDigests,
  ), "V10 pre-transition state");

  const continuationExecutables = [];
  for (const kind of CONTINUATION_V10_EXECUTABLE_KINDS) {
    const executablePath = CONTINUATION_V10_EXECUTABLE_PATH_BY_KIND[kind];
    const capture = await captureRepository(
      executablePath,
      `V10 ${kind} executable`,
    );
    continuationExecutables.push({
      kind,
      path: executablePath,
      sha256: capture.digest,
    });
  }
  const pathAuthorities = await rebindRound10BookkeepingBaselinesV10(
    parentPolicy.pathAuthorities,
    {
      readPresentDigest: async (relativePath) =>
        (await captureRepository(
          relativePath,
          `V10 bookkeeping ${relativePath}`,
        )).digest,
      assertAbsent: async (relativePath) => captureRequiredAbsentV10(
        path.join(root, relativePath),
        `V10 absent bookkeeping ${relativePath}`,
        { expectedRoot: root, ledger },
      ),
    },
  );
  const baselineArchive = await createBaselineArchiveV10({
    programId: program.programId,
    pathAuthorities,
    transitions,
    captureRepository,
  });
  const policy = createConversationDisclosureContinuationPolicyV10({
    program,
    featureList,
    parentPolicy,
    round9ReviewRejection: rejection,
    baselineArchive,
    pathAuthorities,
    continuationExecutables,
    governanceTransitions: transitions,
  });
  assertNoErrors(validateBaselineArchiveV10(baselineArchive, policy),
    "generated V10 baseline archive");
  assertNoErrors(validateContinuationPolicyV10(policy, {
    expectedDigest: policy.digest,
    baselineArchive,
  }), "generated V10 policy");
  await postflightCaptureLedgerV10(ledger);

  const archiveBytes = Buffer.from(
    `${JSON.stringify(baselineArchive, null, 2)}\n`,
    "utf8",
  );
  const policyBytes = Buffer.from(`${JSON.stringify(policy, null, 2)}\n`, "utf8");
  let archivePublicationStatus = "not_requested";
  let publicationStatus = "not_requested";
  if (archiveOutputPath !== undefined) {
    archivePublicationStatus = (await publishPrivateExactV10(
      resolveExactOutput(root, archiveOutputPath, CONTINUATION_V10_BASELINE_ARCHIVE_PATH),
      archiveBytes,
      { expectedRoot: root, label: "Round10 baseline archive" },
    )).status;
  }
  if (outputPath !== undefined) {
    publicationStatus = (await publishPrivateExactV10(
      resolveExactOutput(root, outputPath, CONTINUATION_V10_POLICY_PATH),
      policyBytes,
      { expectedRoot: root, label: "Round10 continuation policy" },
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

export async function rebindRound10BookkeepingBaselinesV10(
  source,
  { readPresentDigest, assertAbsent },
) {
  const present = new Set(CONTINUATION_POLICY_V10_PRESENT_BOOKKEEPING_PATHS);
  const absent = new Set(CONTINUATION_POLICY_V10_ABSENT_BOOKKEEPING_PATHS);
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

async function createBaselineArchiveV10({
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
      `V10 baseline ${subject.path}`,
    );
    if (capture.digest !== subject.sha256) {
      throw new Error(`V10 baseline bytes drifted: ${subject.path}`);
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
  return withCanonicalDigestV10({
    schemaVersion: 10,
    kind: CONTINUATION_V10_BASELINE_ARCHIVE_KIND,
    algorithm: CONTINUATION_V10_ALGORITHM,
    programId,
    workstreamId: CONTINUATION_V10_WORKSTREAM_ID,
    featureId: CONTINUATION_V10_FEATURE_ID,
    round: CONTINUATION_V10_ROUND,
    entries,
    entrySetDigest: hashCanonicalV10(entries),
  });
}

function buildClosedWorldV10(source, program) {
  const closedWorld = structuredClone(source);
  closedWorld.workstreams = program.workstreams.map((entry) => {
    const stableDefinition = stableWorkstreamDefinitionV10(entry);
    return {
      id: entry.id,
      stableDefinition,
      stableDefinitionDigest: hashCanonicalV10(stableDefinition),
    };
  });
  closedWorld.programRootDefinition = stableProgramRootDefinitionV10(program);
  closedWorld.programRootDefinitionDigest = hashCanonicalV10(
    closedWorld.programRootDefinition,
  );
  delete closedWorld.digest;
  closedWorld.digest = hashCanonicalV10(closedWorld);
  return closedWorld;
}

function buildSuccessorV10(
  source,
  program,
  pathAuthorities,
  trustRoots,
  transitions,
) {
  const successor = structuredClone(source);
  const workstream = program.workstreams.find(
    (entry) => entry.id === CONTINUATION_V10_SUCCESSOR_WORKSTREAM_ID,
  );
  if (!workstream || workstream.state !== "planned"
    || successor.featureDefinition.id !== CONTINUATION_V10_SUCCESSOR_FEATURE_ID) {
    throw new Error("P108/CD04 successor definition is invalid");
  }
  successor.workstreamDefinition = stableWorkstreamDefinitionV10(workstream);
  successor.workstreamDefinitionDigest = hashCanonicalV10(
    successor.workstreamDefinition,
  );
  successor.featureDefinition.verification =
    successor.featureDefinition.verification.map((entry) => {
      if (/^node scripts\/check-conversation-disclosure-continuation-v\d+\.mjs --mode authorized_active\b/
        .test(entry)) {
        return CONTINUATION_POLICY_V10_SUCCESSOR_CHECKER_VERIFICATION;
      }
      if (entry.startsWith(
        "node scripts/check-harness-state.mjs --mode authorized_active",
      )) {
        return CONTINUATION_POLICY_V10_SUCCESSOR_HARNESS_VERIFICATION;
      }
      return entry;
    });
  successor.featureDefinitionDigest = hashCanonicalV10(
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
  successor.pathCoverageDigest = hashCanonicalV10(coverage);
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
  buildConversationDisclosureContinuationPolicyV10(
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
