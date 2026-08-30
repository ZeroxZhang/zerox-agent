#!/usr/bin/env node

import { realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  CONTINUATION_V7_BASELINE_ARCHIVE_PATH,
  CONTINUATION_V7_CLOSURE_MANIFEST_PATH,
  CONTINUATION_V7_EXTERNAL_ATTESTATION_PATH,
  CONTINUATION_V7_LIFECYCLE_PROFILE_PHASES,
  CONTINUATION_V7_POLICY_PATH,
  CONTINUATION_V7_REVIEW_LANES,
  CONTINUATION_V7_REVIEW_SNAPSHOT_PATH,
  CONTINUATION_V7_ROUND6_REVIEW_REJECTION_PATH,
  hashCanonicalV7,
  selectLifecycleProfileV7,
  validateBaselineArchiveV7,
  validateContinuationClosureManifestV7,
  validateContinuationExternalAnchorV7,
  validateContinuationExternalAttestationV7,
  validateContinuationPolicyV7,
  validateContinuationReviewSetV7,
  validateContinuationReviewSnapshotV7,
  validateGovernanceTransitionStateV7,
  validateLifecycleStateV7,
  validateRound6ReviewRejectionV7,
  withCanonicalDigestV7,
} from "./conversation-disclosure-continuation-contract-v7.mjs";
import {
  capturePrivateEvidenceV7,
  captureRequiredAbsentV7,
  captureStableFileV7,
  createCaptureLedgerV7,
  postflightCaptureLedgerV7,
} from "./conversation-disclosure-continuation-runtime-io-v7.mjs";
import {
  PROGRAM_GOVERNANCE_V7_RULE_IDS,
  validateConversationDisclosureProgramGovernanceV7,
} from "./conversation-disclosure-program-governance-v7.mjs";

const PROGRAM_PATH = ".zerox/conversation-disclosure-program.json";
const FEATURE_LIST_PATH = ".zerox/feature_list.json";
const CHECKER_RECEIPT_KIND = "cd03a-continuation-checker-v7-receipt";
const ORDINARY_PHASES = new Set(["anchored_planned", "authorized_active"]);
const POST_TRANSITION_PHASES = new Set([
  "review_post_transition",
  "anchored_planned",
  "authorized_active",
]);

export async function runConversationDisclosureContinuationCheckerV7(
  argv = process.argv.slice(2),
) {
  const options = parseOptionsV7(argv);
  if (options.errors.length > 0) {
    throw new Error(options.errors.join("; "));
  }
  const controlRoot = await canonicalDirectory(options.controlRoot, "control root");
  const subjectRepositoryRealpath = await canonicalDirectory(
    options.subjectRepositoryRealpath,
    "subject repository",
  );
  const ledger = createCaptureLedgerV7();
  const captureControl = (
    relativePath,
    label = relativePath,
    { privateEvidence = false } = {},
  ) => {
    const absolutePath = path.join(controlRoot, relativePath);
    return privateEvidence
      ? capturePrivateEvidenceV7(absolutePath, label, {
        expectedRoot: controlRoot,
        ledger,
      })
      : captureStableFileV7(absolutePath, label, {
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
    (await capturePrivateEvidenceV7(
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
      readControlJson(CONTINUATION_V7_POLICY_PATH, "Round7 policy", {
        privateEvidence: true,
      }),
      readControlJson(
        CONTINUATION_V7_BASELINE_ARCHIVE_PATH,
        "Round7 baseline archive",
        { privateEvidence: true },
      ),
      readControlJson(
        CONTINUATION_V7_ROUND6_REVIEW_REJECTION_PATH,
        "Round6 review-rejection witness",
        { privateEvidence: true },
      ),
      readControlJson(
        CONTINUATION_V7_REVIEW_SNAPSHOT_PATH,
        "Round7 review snapshot",
        { privateEvidence: true },
      ),
      readControlJson(PROGRAM_PATH, "conversation disclosure program"),
      readControlJson(FEATURE_LIST_PATH, "Feature list"),
    ]);
  assertNoErrors(validateRound6ReviewRejectionV7(rejection),
    "Round6 review-rejection witness");
  assertNoErrors(validateContinuationPolicyV7(policy, {
    expectedDigest: options.expectedPolicyDigest,
    baselineArchive: archive,
  }), "Round7 policy");
  assertNoErrors(validateBaselineArchiveV7(archive, policy),
    "Round7 baseline archive");
  assertNoErrors(validateContinuationReviewSnapshotV7(snapshot, policy, {
    verifierNow: Date.now(),
  }), "Round7 review snapshot");
  if (snapshot.digest !== options.expectedSnapshotDigest) {
    throw new Error("Round7 snapshot differs from caller pin");
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
      `Round7 frozen subject ${entry.path}`,
      {
        privateEvidence: [
          CONTINUATION_V7_POLICY_PATH,
          CONTINUATION_V7_ROUND6_REVIEW_REJECTION_PATH,
          CONTINUATION_V7_BASELINE_ARCHIVE_PATH,
        ].includes(entry.path),
      },
    );
    if (capture.digest !== entry.sha256) {
      throw new Error(`Round7 frozen subject drifted: ${entry.path}`);
    }
  }
  for (const entry of snapshot.transitionPayloadFiles) {
    const capture = await captureControl(
      entry.path,
      `Round7 transition payload ${entry.path}`,
    );
    if (capture.digest !== entry.sha256) {
      throw new Error(`Round7 transition payload drifted: ${entry.path}`);
    }
  }

  const postReviewMutable = new Set(
    policy.admission.postReviewMutablePaths,
  );
  for (const entry of snapshot.baselineFiles) {
    if (POST_TRANSITION_PHASES.has(options.mode)
      && postReviewMutable.has(entry.path)) {
      await captureControl(entry.path, `Round7 mutable baseline ${entry.path}`);
      continue;
    }
    const capture = await captureControl(
      entry.path,
      `Round7 baseline ${entry.path}`,
    );
    if (capture.digest !== entry.sha256) {
      throw new Error(`Round7 baseline drifted: ${entry.path}`);
    }
  }

  const transitionLiveDigests = new Map();
  const transitionStagedDigests = new Map();
  for (const transition of policy.governanceTransitions) {
    const [live, staged] = await Promise.all([
      captureControl(transition.path, `Round7 transition live ${transition.path}`),
      captureControl(
        transition.stagedTargetPath,
        `Round7 transition staged ${transition.stagedTargetPath}`,
      ),
    ]);
    transitionLiveDigests.set(transition.path, live.digest);
    transitionStagedDigests.set(transition.stagedTargetPath, staged.digest);
  }
  assertNoErrors(validateGovernanceTransitionStateV7(
    policy.governanceTransitions,
    options.mode,
    transitionLiveDigests,
    transitionStagedDigests,
  ), "Round7 transition state");

  const authorityByPath = new Map(
    policy.pathAuthorities.map((entry) => [entry.path, entry]),
  );
  for (const relativePath of snapshot.absentPaths) {
    const authority = authorityByPath.get(relativePath);
    const allowedNow = authority?.allowedPhases?.includes(options.mode);
    if (options.mode === "authorized_active" && allowedNow) continue;
    await captureRequiredAbsentV7(
      path.join(controlRoot, relativePath),
      `Round7 required absence ${relativePath}`,
      { expectedRoot: controlRoot, ledger },
    );
  }

  let continuationEvidence = null;
  if (options.mode === "review_pre_transition") {
    for (const relativePath of snapshot.reviewOutputAbsentPaths) {
      if (relativePath === CONTINUATION_V7_REVIEW_SNAPSHOT_PATH) continue;
      await captureRequiredAbsentV7(
        path.join(controlRoot, relativePath),
        `Round7 pre-review output ${relativePath}`,
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

  const lifecycleProfile = selectLifecycleProfileV7(policy, options.mode);
  if (!lifecycleProfile) {
    throw new Error(`Round7 lifecycle profile is missing: ${options.mode}`);
  }
  assertNoErrors(validateLifecycleStateV7({
    phase: options.mode,
    activeFeatureId: program.activeFeatureId,
    nextFeatureId: program.nextFeatureId,
    workstreams: program.workstreams,
    features: featureList.features,
  }, policy), "Round7 lifecycle state");
  const parentEvidence = await materializeParentEvidence(
    policy,
    baseAnchor,
    readControlJson,
  );
  const governance = validateConversationDisclosureProgramGovernanceV7({
    program,
    featureList,
    closedWorld: {
      schemaVersion: 7,
      programRootDefinition: policy.closedWorld.programRootDefinition,
      programRootDefinitionDigest:
        policy.closedWorld.programRootDefinitionDigest,
      ruleIds: [...PROGRAM_GOVERNANCE_V7_RULE_IDS],
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
  assertNoErrors(governance.errors, "Round7 program governance");
  await postflightCaptureLedgerV7(ledger);

  const receiptWithoutDigest = {
    schemaVersion: 7,
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
    digest: hashCanonicalV7(receiptWithoutDigest),
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
  for (const lane of CONTINUATION_V7_REVIEW_LANES) {
    receipts.push(await readControlJson(
      `.zerox/verification/conversation-disclosure/CD03A-round7-${lane}-review.json`,
      `Round7 ${lane} receipt`,
      { privateEvidence: true },
    ));
  }
  const manifest = await readControlJson(
    CONTINUATION_V7_CLOSURE_MANIFEST_PATH,
    "Round7 closure manifest",
    { privateEvidence: true },
  );
  assertNoErrors(validateContinuationReviewSetV7(
    receipts,
    manifest.callerDispatchSet,
    snapshot,
    policy,
  ), "Round7 review set");
  const [policyCapture, snapshotCapture, rejectionCapture, validatorCapture,
    runnerCapture] = await Promise.all([
    captureControl(CONTINUATION_V7_POLICY_PATH, "Round7 manifest policy", {
      privateEvidence: true,
    }),
    captureControl(
      CONTINUATION_V7_REVIEW_SNAPSHOT_PATH,
      "Round7 manifest snapshot",
      { privateEvidence: true },
    ),
    captureControl(
      CONTINUATION_V7_ROUND6_REVIEW_REJECTION_PATH,
      "Round6 manifest rejection",
      { privateEvidence: true },
    ),
    captureControl(manifest.validator?.path, "Round7 manifest validator"),
    captureControl(manifest.externalRunner?.path, "Round7 manifest runner"),
  ]);
  const reviewReferences = receipts.map((receipt) => ({
    lane: receipt.lane,
    path:
      `.zerox/verification/conversation-disclosure/CD03A-round7-${receipt.lane}-review.json`,
    challenge: receipt.challenge,
    canonicalDigest: hashCanonicalV7(receipt),
  }));
  const manifestBindings = {
    policy,
    policyReference: {
      path: CONTINUATION_V7_POLICY_PATH,
      byteSha256: policyCapture.digest,
      canonicalDigest: policy.digest,
    },
    snapshotReference: {
      path: CONTINUATION_V7_REVIEW_SNAPSHOT_PATH,
      byteSha256: snapshotCapture.digest,
      canonicalDigest: snapshot.digest,
    },
    round6ReviewRejectionReference: {
      path: CONTINUATION_V7_ROUND6_REVIEW_REJECTION_PATH,
      byteSha256: rejectionCapture.digest,
      canonicalDigest: rejection.digest,
    },
    reviewReferences,
    callerDispatchSet: manifest.callerDispatchSet,
    validatorReference: {
      path: manifest.validator?.path,
      sha256: validatorCapture.digest,
    },
    runnerReference: {
      path: manifest.externalRunner?.path,
      sha256: runnerCapture.digest,
    },
  };
  if (options.mode === "review_post_transition") {
    assertNoErrors(validateContinuationClosureManifestV7(
      manifest,
      manifestBindings,
    ), "Round7 pending closure manifest");
    if (manifest.status !== "review_passed_pending_external_transaction") {
      throw new Error("review_post_transition requires the pending manifest");
    }
    await captureRequiredAbsentV7(
      path.join(controlRoot, CONTINUATION_V7_EXTERNAL_ATTESTATION_PATH),
      "Round7 pre-transaction external attestation",
      { expectedRoot: controlRoot, ledger },
    );
    return { receipts, manifest, attestation: null, anchor: null };
  }
  if (manifest.status !== "externally_attested") {
    throw new Error("ordinary mode requires an externally attested manifest");
  }
  const attestation = await readControlJson(
    CONTINUATION_V7_EXTERNAL_ATTESTATION_PATH,
    "Round7 external attestation",
    { privateEvidence: true },
  );
  const pendingManifest = reconstructPendingManifestV7(manifest);
  assertNoErrors(validateContinuationExternalAttestationV7(attestation, {
    policy,
    snapshot,
    round6ReviewRejection: rejection,
    pendingManifest,
    callerDispatchSet: manifest.callerDispatchSet,
    receipts,
    repositoryRealpath: subjectRepositoryRealpath,
    verifierNow: Date.now(),
  }), "Round7 external attestation");
  assertNoErrors(validateContinuationClosureManifestV7(manifest, {
    ...manifestBindings,
    pendingManifest,
    externalAttestation: attestation,
  }), "Round7 final closure manifest");

  let anchor = null;
  if (ORDINARY_PHASES.has(options.mode)) {
    const canonicalAnchor = await realpath(options.continuationAnchorPath);
    if (canonicalAnchor !== options.continuationAnchorPath
      || isWithin(subjectRepositoryRealpath, canonicalAnchor)
      || isWithin(controlRoot, canonicalAnchor)) {
      throw new Error("Round7 continuation anchor must be canonical and external");
    }
    anchor = parseJson(
      (await capturePrivateEvidenceV7(
        canonicalAnchor,
        "Round7 continuation anchor",
        { ledger },
      )).bytes,
      "Round7 continuation anchor",
    );
    assertNoErrors(validateContinuationExternalAnchorV7(anchor, {
      expectedDigest: options.expectedContinuationAnchorDigest,
      attestation,
      policy,
      snapshot,
      round6ReviewRejection: rejection,
      callerDispatchSet: manifest.callerDispatchSet,
      repositoryRealpath: subjectRepositoryRealpath,
      verifierNow: Date.now(),
    }), "Round7 continuation anchor");
    if (anchor.repositoryRealpath !== subjectRepositoryRealpath
      || anchor.policyDigest !== policy.digest
      || anchor.snapshotDigest !== snapshot.digest
      || anchor.attestationDigest !== attestation.digest) {
      throw new Error("Round7 continuation anchor bindings are stale");
    }
  }
  return { receipts, manifest, attestation, anchor };
}

function reconstructPendingManifestV7(finalManifest) {
  const projected = structuredClone(finalManifest);
  delete projected.digest;
  projected.status = "review_passed_pending_external_transaction";
  projected.externalAttestation = {
    ...projected.externalAttestation,
    canonicalDigest: null,
  };
  return withCanonicalDigestV7(projected);
}

function parseOptionsV7(argv) {
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
  if (!CONTINUATION_V7_LIFECYCLE_PROFILE_PHASES.includes(options.mode)) {
    options.errors.push("checker V7 --mode is invalid");
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
  runConversationDisclosureContinuationCheckerV7()
    .then((receipt) => {
      process.stdout.write("Conversation disclosure continuation v7 check passed.\n");
      process.stdout.write(`${JSON.stringify(receipt)}\n`);
    })
    .catch((error) => {
      process.stderr.write("Conversation disclosure continuation v7 check failed:\n");
      process.stderr.write(`- ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
