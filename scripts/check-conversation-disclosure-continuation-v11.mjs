#!/usr/bin/env node

import { realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  CONTINUATION_V11_BASELINE_ARCHIVE_PATH,
  CONTINUATION_V11_CLOSURE_MANIFEST_PATH,
  CONTINUATION_V11_EXTERNAL_ATTESTATION_PATH,
  CONTINUATION_V11_LIFECYCLE_PROFILE_PHASES,
  CONTINUATION_V11_POLICY_PATH,
  CONTINUATION_V11_REVIEW_LANES,
  CONTINUATION_V11_REVIEW_SNAPSHOT_PATH,
  CONTINUATION_V11_ROUND10_REVIEW_REJECTION_PATH,
  hashCanonicalV11,
  pendingManifestDigestV11,
  selectLifecycleProfileV11,
  validateBaselineArchiveV11,
  validateContinuationClosureManifestV11,
  validateContinuationExternalAnchorV11,
  validateContinuationExternalAttestationV11,
  validateContinuationPolicyV11,
  validateContinuationReviewSetV11,
  validateContinuationReviewSnapshotV11,
  validateGovernanceTransitionStateV11,
  validateLifecycleStateV11,
  validateRound10ReviewRejectionV11,
  withCanonicalDigestV11,
} from "./conversation-disclosure-continuation-contract-v11.mjs";
import {
  capturePrivateEvidenceV11,
  captureRequiredAbsentV11,
  captureStableFileV11,
  createCaptureLedgerV11,
  postflightCaptureLedgerV11,
} from "./conversation-disclosure-continuation-runtime-io-v11.mjs";
import {
  PROGRAM_GOVERNANCE_V11_RULE_IDS,
  validateConversationDisclosureProgramGovernanceV11,
} from "./conversation-disclosure-program-governance-v11.mjs";

const PROGRAM_PATH = ".zerox/conversation-disclosure-program.json";
const FEATURE_LIST_PATH = ".zerox/feature_list.json";
const CHECKER_PATH = "scripts/check-conversation-disclosure-continuation-v11.mjs";
const RUNNER_PATH = "scripts/verify-conversation-disclosure-continuation-v11.mjs";
const CHECKER_RECEIPT_KIND = "cd03a-continuation-checker-v11-receipt";
const ORDINARY_PHASES = new Set(["anchored_planned", "authorized_active"]);
const POST_TRANSITION_PHASES = new Set([
  "review_post_transition",
  "anchored_planned",
  "authorized_active",
]);

export async function runConversationDisclosureContinuationCheckerV11(
  argv = process.argv.slice(2),
) {
  const options = parseOptionsV11(argv);
  if (options.errors.length > 0) {
    throw new Error(options.errors.join("; "));
  }
  const controlRoot = await canonicalDirectory(options.controlRoot, "control root");
  const subjectRepositoryRealpath = await canonicalDirectory(
    options.subjectRepositoryRealpath,
    "subject repository",
  );
  const ledger = createCaptureLedgerV11();
  const captureControl = (
    relativePath,
    label = relativePath,
    { privateEvidence = false } = {},
  ) => {
    const absolutePath = path.join(controlRoot, relativePath);
    return privateEvidence
      ? capturePrivateEvidenceV11(absolutePath, label, {
        expectedRoot: controlRoot,
        ledger,
      })
      : captureStableFileV11(absolutePath, label, {
        expectedRoot: controlRoot,
        ledger,
      });
  };
  const readControlJson = async (relativePath, label, captureOptions) =>
    parseJson(
      (await captureControl(relativePath, label, captureOptions)).bytes,
      label,
    );

  requireAnchorForMode(options);
  const canonicalBaseAnchor = await realpath(options.baseAnchorPath);
  if (canonicalBaseAnchor !== options.baseAnchorPath
    || isWithin(subjectRepositoryRealpath, canonicalBaseAnchor)) {
    throw new Error("Round23 base anchor must be canonical and repository-external");
  }
  const baseAnchor = parseJson(
    (await capturePrivateEvidenceV11(
      canonicalBaseAnchor,
      "Round23 external anchor",
      { ledger },
    )).bytes,
    "Round23 external anchor",
  );
  if (baseAnchor.digest !== options.expectedBaseAnchorDigest
    || baseAnchor.repositoryRealpath !== subjectRepositoryRealpath) {
    throw new Error("Round23 external anchor differs from caller/subject pins");
  }

  const [policy, archive, rejection, snapshot, program, featureList] =
    await Promise.all([
      readControlJson(CONTINUATION_V11_POLICY_PATH, "Round11 policy", {
        privateEvidence: true,
      }),
      readControlJson(
        CONTINUATION_V11_BASELINE_ARCHIVE_PATH,
        "Round11 baseline archive",
        { privateEvidence: true },
      ),
      readControlJson(
        CONTINUATION_V11_ROUND10_REVIEW_REJECTION_PATH,
        "Round10 review-rejection witness",
        { privateEvidence: true },
      ),
      readControlJson(
        CONTINUATION_V11_REVIEW_SNAPSHOT_PATH,
        "Round11 review snapshot",
        { privateEvidence: true },
      ),
      readControlJson(PROGRAM_PATH, "conversation disclosure program"),
      readControlJson(FEATURE_LIST_PATH, "Feature list"),
    ]);
  assertNoErrors(validateRound10ReviewRejectionV11(rejection),
    "Round10 review-rejection witness");
  assertNoErrors(validateContinuationPolicyV11(policy, {
    expectedDigest: options.expectedPolicyDigest,
    baselineArchive: archive,
  }), "Round11 policy");
  assertNoErrors(validateBaselineArchiveV11(archive, policy),
    "Round11 baseline archive");
  assertNoErrors(validateContinuationReviewSnapshotV11(snapshot, policy, {
    verifierNow: Date.now(),
  }), "Round11 review snapshot");
  if (snapshot.digest !== options.expectedSnapshotDigest) {
    throw new Error("Round11 snapshot differs from caller pin");
  }

  await validateParentEvidence({
    policy,
    baseAnchor,
    archive,
    captureControl,
    readControlJson,
  });
  for (const entry of snapshot.frozenFiles) {
    const capture = await captureControl(
      entry.path,
      `Round11 frozen subject ${entry.path}`,
      {
        privateEvidence: [
          CONTINUATION_V11_POLICY_PATH,
          CONTINUATION_V11_ROUND10_REVIEW_REJECTION_PATH,
          CONTINUATION_V11_BASELINE_ARCHIVE_PATH,
        ].includes(entry.path),
      },
    );
    if (capture.digest !== entry.sha256) {
      throw new Error(`Round11 frozen subject drifted: ${entry.path}`);
    }
  }
  for (const entry of snapshot.transitionPayloadFiles) {
    const capture = await captureControl(
      entry.path,
      `Round11 transition payload ${entry.path}`,
    );
    if (capture.digest !== entry.sha256) {
      throw new Error(`Round11 transition payload drifted: ${entry.path}`);
    }
  }

  const postReviewMutable = new Set(
    policy.admission.postReviewMutablePaths,
  );
  for (const entry of snapshot.baselineFiles) {
    if (POST_TRANSITION_PHASES.has(options.mode)
      && postReviewMutable.has(entry.path)) {
      await captureControl(entry.path, `Round11 mutable baseline ${entry.path}`);
      continue;
    }
    const capture = await captureControl(
      entry.path,
      `Round11 baseline ${entry.path}`,
    );
    if (capture.digest !== entry.sha256) {
      throw new Error(`Round11 baseline drifted: ${entry.path}`);
    }
  }

  const transitionLiveDigests = new Map();
  const transitionStagedDigests = new Map();
  for (const transition of policy.governanceTransitions) {
    const [live, staged] = await Promise.all([
      captureControl(transition.path, `Round11 transition live ${transition.path}`),
      captureControl(
        transition.stagedTargetPath,
        `Round11 transition staged ${transition.stagedTargetPath}`,
      ),
    ]);
    transitionLiveDigests.set(transition.path, live.digest);
    transitionStagedDigests.set(transition.stagedTargetPath, staged.digest);
  }
  assertNoErrors(validateGovernanceTransitionStateV11(
    policy.governanceTransitions,
    options.mode,
    transitionLiveDigests,
    transitionStagedDigests,
  ), "Round11 transition state");

  const authorityByPath = new Map(
    policy.pathAuthorities.map((entry) => [entry.path, entry]),
  );
  for (const relativePath of snapshot.absentPaths) {
    const authority = authorityByPath.get(relativePath);
    const allowedNow = authority?.allowedPhases?.includes(options.mode);
    if (options.mode === "authorized_active" && allowedNow) continue;
    await captureRequiredAbsentV11(
      path.join(controlRoot, relativePath),
      `Round11 required absence ${relativePath}`,
      { expectedRoot: controlRoot, ledger },
    );
  }

  let continuationEvidence = null;
  if (options.mode === "review_pre_transition") {
    for (const relativePath of snapshot.reviewOutputAbsentPaths) {
      if (relativePath === CONTINUATION_V11_REVIEW_SNAPSHOT_PATH) continue;
      await captureRequiredAbsentV11(
        path.join(controlRoot, relativePath),
        `Round11 pre-review output ${relativePath}`,
        { expectedRoot: controlRoot, ledger },
      );
    }
  } else {
    continuationEvidence = await validateContinuationEvidence({
      controlRoot,
      subjectRepositoryRealpath,
      policy,
      snapshot,
      rejection,
      options,
      readControlJson,
      captureControl,
      ledger,
    });
  }

  const lifecycleProfile = selectLifecycleProfileV11(policy, options.mode);
  if (!lifecycleProfile) {
    throw new Error(`Round11 lifecycle profile is missing: ${options.mode}`);
  }
  assertNoErrors(validateLifecycleStateV11({
    phase: options.mode,
    activeFeatureId: program.activeFeatureId,
    nextFeatureId: program.nextFeatureId,
    workstreams: program.workstreams,
    features: featureList.features,
  }, policy), "Round11 lifecycle state");
  const parentEvidence = await materializeParentEvidence(
    policy,
    baseAnchor,
    readControlJson,
  );
  const governance = validateConversationDisclosureProgramGovernanceV11({
    program,
    featureList,
    closedWorld: {
      schemaVersion: 11,
      programRootDefinition: policy.closedWorld.programRootDefinition,
      programRootDefinitionDigest:
        policy.closedWorld.programRootDefinitionDigest,
      ruleIds: [...PROGRAM_GOVERNANCE_V11_RULE_IDS],
      workstreamIds: policy.closedWorld.workstreams.map((entry) => entry.id),
    },
    lifecycleProfile: {
      phase: governancePhase(options.mode),
      featureIds: featureList.features.map((entry) => entry.id),
      p107aWorkstreamId: policy.workstreamId,
      p107aFeatureId: policy.featureId,
      p108WorkstreamId: policy.successor.workstreamDefinition.id,
      p108FeatureId: policy.successor.featureDefinition.id,
    },
    parentEvidence,
  });
  assertNoErrors(governance.errors, "Round11 program governance");
  await postflightCaptureLedgerV11(ledger);

  const receiptWithoutDigest = {
    schemaVersion: 11,
    kind: CHECKER_RECEIPT_KIND,
    status: "passed",
    authoritative: true,
    mode: options.mode,
    subjectRepositoryRealpath,
    baseExternalAnchorDigest: baseAnchor.digest,
    baseSnapshotDigest: policy.parentEvidence.snapshot.digest,
    policyDigest: policy.digest,
    snapshotDigest: snapshot.digest,
    baselineArchiveDigest: archive.digest,
    continuationAnchorDigest:
      continuationEvidence?.anchor?.digest ?? null,
    captureCount: ledger.entries.length,
  };
  return {
    ...receiptWithoutDigest,
    digest: hashCanonicalV11(receiptWithoutDigest),
  };
}

async function validateParentEvidence({
  policy,
  baseAnchor,
  archive,
  captureControl,
}) {
  const archived = new Map(
    (archive.entries ?? []).map((entry) => [entry.path, entry.sha256]),
  );
  for (const entry of policy.parentEvidence.repositoryEvidence ?? []) {
    const capture = await captureControl(
      entry.path,
      `Round23 repository evidence ${entry.path}`,
    );
    if (capture.digest !== entry.sha256
      && archived.get(entry.path) !== entry.sha256) {
      throw new Error(`Round23 repository evidence drifted: ${entry.path}`);
    }
  }
  if (baseAnchor.digest !== policy.parentEvidence.externalAnchor.digest) {
    throw new Error("Round23 base anchor differs from policy parent evidence");
  }
}

async function materializeParentEvidence(
  policy,
  baseAnchor,
  readControlJson,
) {
  const artifact = await readControlJson(
    policy.parentEvidence.artifact.path,
    "Round23 causal shadow",
  );
  const closureManifest = await readControlJson(
    policy.parentEvidence.closureManifest.path,
    "Round23 closure manifest",
  );
  const externalAttestation = await readControlJson(
    policy.parentEvidence.externalAttestation.path,
    "Round23 external attestation",
  );
  const receipts = [];
  for (const reference of policy.parentEvidence.receipts) {
    receipts.push(await readControlJson(
      reference.path,
      `Round23 ${reference.lane} receipt`,
    ));
  }
  return {
    closureManifestPath: policy.parentEvidence.closureManifest.path,
    artifact,
    closureManifest,
    externalAnchor: baseAnchor,
    receipts,
    externalAttestation,
  };
}

async function validateContinuationEvidence({
  controlRoot,
  subjectRepositoryRealpath,
  policy,
  snapshot,
  rejection,
  options,
  readControlJson,
  captureControl,
  ledger,
}) {
  const receipts = [];
  for (const lane of CONTINUATION_V11_REVIEW_LANES) {
    receipts.push(await readControlJson(
      `.zerox/verification/conversation-disclosure/CD03A-round11-${lane}-review.json`,
      `Round11 ${lane} receipt`,
      { privateEvidence: true },
    ));
  }
  const manifest = await readControlJson(
    CONTINUATION_V11_CLOSURE_MANIFEST_PATH,
    "Round11 closure manifest",
    { privateEvidence: true },
  );
  assertNoErrors(validateContinuationReviewSetV11(
    receipts,
    manifest.callerDispatchSet,
    snapshot,
    policy,
    { verifierNow: Date.now() },
  ), "Round11 review set");
  const [policyCapture, snapshotCapture, rejectionCapture, validatorCapture,
    runnerCapture] = await Promise.all([
    captureControl(CONTINUATION_V11_POLICY_PATH, "Round11 manifest policy", {
      privateEvidence: true,
    }),
    captureControl(
      CONTINUATION_V11_REVIEW_SNAPSHOT_PATH,
      "Round11 manifest snapshot",
      { privateEvidence: true },
    ),
    captureControl(
      CONTINUATION_V11_ROUND10_REVIEW_REJECTION_PATH,
      "Round10 manifest rejection",
      { privateEvidence: true },
    ),
    captureControl(CHECKER_PATH, "Round11 manifest validator"),
    captureControl(RUNNER_PATH, "Round11 manifest runner"),
  ]);
  const reviewReferences = receipts.map((receipt) => ({
    lane: receipt.lane,
    path:
      `.zerox/verification/conversation-disclosure/CD03A-round11-${receipt.lane}-review.json`,
    challenge: receipt.challenge,
    canonicalDigest: hashCanonicalV11(receipt),
  }));
  const manifestBindings = {
    policy,
    policyReference: {
      path: CONTINUATION_V11_POLICY_PATH,
      byteSha256: policyCapture.digest,
      canonicalDigest: policy.digest,
    },
    snapshotReference: {
      path: CONTINUATION_V11_REVIEW_SNAPSHOT_PATH,
      byteSha256: snapshotCapture.digest,
      canonicalDigest: snapshot.digest,
    },
    round10ReviewRejectionReference: {
      path: CONTINUATION_V11_ROUND10_REVIEW_REJECTION_PATH,
      byteSha256: rejectionCapture.digest,
      canonicalDigest: rejection.digest,
    },
    reviewReferences,
    callerDispatchSet: manifest.callerDispatchSet,
    validatorReference: {
      path: CHECKER_PATH,
      sha256: validatorCapture.digest,
    },
    runnerReference: {
      path: RUNNER_PATH,
      sha256: runnerCapture.digest,
    },
  };
  if (options.mode === "review_post_transition") {
    assertNoErrors(validateContinuationClosureManifestV11(
      manifest,
      manifestBindings,
    ), "Round11 pending closure manifest");
    if (manifest.status !== "review_passed_pending_external_transaction") {
      throw new Error("review_post_transition requires the pending manifest");
    }
    await captureRequiredAbsentV11(
      path.join(controlRoot, CONTINUATION_V11_EXTERNAL_ATTESTATION_PATH),
      "Round11 pre-transaction external attestation",
      { expectedRoot: controlRoot, ledger },
    );
    return { receipts, manifest, attestation: null, anchor: null };
  }
  if (manifest.status !== "externally_attested") {
    throw new Error("ordinary mode requires an externally attested manifest");
  }
  let anchor = null;
  if (ORDINARY_PHASES.has(options.mode)) {
    const canonicalAnchor = await realpath(options.continuationAnchorPath);
    if (canonicalAnchor !== options.continuationAnchorPath
      || isWithin(subjectRepositoryRealpath, canonicalAnchor)
      || isWithin(controlRoot, canonicalAnchor)) {
      throw new Error("Round11 continuation anchor must be canonical and external");
    }
    anchor = parseJson(
      (await capturePrivateEvidenceV11(
        canonicalAnchor,
        "Round11 continuation anchor",
        { ledger },
      )).bytes,
      "Round11 continuation anchor",
    );
  }
  const attestation = await readControlJson(
    CONTINUATION_V11_EXTERNAL_ATTESTATION_PATH,
    "Round11 external attestation",
    { privateEvidence: true },
  );
  const pendingManifest = buildExpectedPendingManifestV11({
    policy,
    policyReference: manifestBindings.policyReference,
    snapshotReference: manifestBindings.snapshotReference,
    round10ReviewRejectionReference:
      manifestBindings.round10ReviewRejectionReference,
    reviewReferences,
    callerDispatchSet: manifest.callerDispatchSet,
    validatorReference: manifestBindings.validatorReference,
    runnerReference: manifestBindings.runnerReference,
  });
  assertNoErrors(validateContinuationExternalAttestationV11(attestation, {
    policy,
    snapshot,
    round10ReviewRejection: rejection,
    pendingManifest,
    callerDispatchSet: manifest.callerDispatchSet,
    receipts,
    candidateResults: anchor?.candidateResults,
    repositoryRealpath: subjectRepositoryRealpath,
    verifierNow: Date.now(),
  }), "Round11 external attestation");
  assertNoErrors(validateContinuationClosureManifestV11(manifest, {
    ...manifestBindings,
    pendingManifest,
    externalAttestation: attestation,
  }), "Round11 final closure manifest");

  if (ORDINARY_PHASES.has(options.mode)) {
    assertNoErrors(validateContinuationExternalAnchorV11(anchor, {
      expectedDigest: options.expectedContinuationAnchorDigest,
      attestation,
      policy,
      snapshot,
      round10ReviewRejection: rejection,
      callerDispatchSet: manifest.callerDispatchSet,
      repositoryRealpath: subjectRepositoryRealpath,
      verifierNow: Date.now(),
    }), "Round11 continuation anchor");
    if (anchor.repositoryRealpath !== subjectRepositoryRealpath
      || anchor.policyDigest !== policy.digest
      || anchor.snapshotDigest !== snapshot.digest
      || anchor.attestationDigest !== attestation.digest) {
      throw new Error("Round11 continuation anchor bindings are stale");
    }
  }
  return { receipts, manifest, attestation, anchor };
}

function buildExpectedPendingManifestV11({
  policy,
  policyReference,
  snapshotReference,
  round10ReviewRejectionReference,
  reviewReferences,
  callerDispatchSet,
  validatorReference,
  runnerReference,
}) {
  const base = {
    schemaVersion: 11,
    kind: "conversation-disclosure-continuation-closure-manifest",
    programId: policy.programId,
    workstreamId: policy.workstreamId,
    featureId: policy.featureId,
    round: 11,
    status: "review_passed_pending_external_transaction",
    parentEvidenceBundleDigest: policy.parentEvidence.bundleDigest,
    policy: policyReference,
    snapshot: snapshotReference,
    round10ReviewRejection: round10ReviewRejectionReference,
    reviewReceipts: reviewReferences,
    callerDispatchSet,
    validator: validatorReference,
    externalRunner: runnerReference,
    externalAttestation: {
      path: CONTINUATION_V11_EXTERNAL_ATTESTATION_PATH,
      canonicalDigest: null,
    },
  };
  return withCanonicalDigestV11({
    ...base,
    pendingManifestDigest: pendingManifestDigestV11(base),
  });
}

function parseOptionsV11(argv) {
  const options = {
    errors: [],
  };
  const map = new Map([
    ["--mode", "mode"],
    ["--control-root", "controlRoot"],
    ["--subject-repository-realpath", "subjectRepositoryRealpath"],
    ["--base-anchor", "baseAnchorPath"],
    ["--expected-base-anchor-digest", "expectedBaseAnchorDigest"],
    ["--expected-policy-digest", "expectedPolicyDigest"],
    ["--expected-snapshot-digest", "expectedSnapshotDigest"],
    ["--continuation-anchor", "continuationAnchorPath"],
    ["--expected-continuation-anchor-digest",
      "expectedContinuationAnchorDigest"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const key = map.get(argv[index]);
    if (!key) {
      options.errors.push(`unknown checker argument: ${argv[index]}`);
      continue;
    }
    options[key] = argv[++index];
  }
  for (const key of [
    "mode",
    "controlRoot",
    "subjectRepositoryRealpath",
    "baseAnchorPath",
    "expectedBaseAnchorDigest",
    "expectedPolicyDigest",
    "expectedSnapshotDigest",
  ]) {
    if (!options[key]) options.errors.push(`checker option is required: ${key}`);
  }
  if (!CONTINUATION_V11_LIFECYCLE_PROFILE_PHASES.includes(options.mode)) {
    options.errors.push("checker V11 --mode is invalid");
  }
  return options;
}

function requireAnchorForMode(options) {
  if (ORDINARY_PHASES.has(options.mode)) {
    if (!options.continuationAnchorPath
      || !options.expectedContinuationAnchorDigest) {
      throw new Error("ordinary mode requires a caller-pinned continuation anchor");
    }
  } else if (options.continuationAnchorPath
    || options.expectedContinuationAnchorDigest) {
    throw new Error("review mode must not accept a continuation anchor");
  }
}

async function canonicalDirectory(candidate, label) {
  if (!path.isAbsolute(candidate ?? "")) {
    throw new Error(`${label} must be absolute`);
  }
  const resolved = path.resolve(candidate);
  const canonical = await realpath(resolved);
  if (canonical !== resolved) {
    throw new Error(`${label} must be canonical`);
  }
  return canonical;
}

function governancePhase(mode) {
  if (mode === "review_pre_transition") return "review_pre";
  if (mode === "review_post_transition") return "review_post";
  return mode;
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

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === ""
    || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

if (process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runConversationDisclosureContinuationCheckerV11()
    .then((receipt) => {
      process.stdout.write("Conversation disclosure continuation v11 check passed.\n");
      process.stdout.write(`${JSON.stringify(receipt)}\n`);
    })
    .catch((error) => {
      process.stderr.write("Conversation disclosure continuation v11 check failed:\n");
      process.stderr.write(`- ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
