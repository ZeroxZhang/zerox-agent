#!/usr/bin/env node

import { constants } from "node:fs";
import { lstat, open, readdir, realpath, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  CONTINUATION_V2_BASELINE_ARCHIVE_PATH,
  CONTINUATION_V2_CLOSURE_MANIFEST_PATH,
  CONTINUATION_V2_EXTERNAL_ATTESTATION_PATH,
  CONTINUATION_V2_LIFECYCLE_PHASES,
  CONTINUATION_V2_POLICY_PATH,
  CONTINUATION_V2_REVIEW_LANES,
  CONTINUATION_V2_REVIEW_SNAPSHOT_PATH,
  CONTINUATION_V2_SUCCESSOR_FEATURE_ID,
  CONTINUATION_V2_SUCCESSOR_WORKSTREAM_ID,
  CONTINUATION_V2_FEATURE_ID,
  CONTINUATION_V2_WORKSTREAM_ID,
  canonicalJsonV2,
  hashCanonicalV2,
  repositoryPathV2,
  sha256BytesV2,
  sha256DigestV2,
  stableFeatureDefinitionV2,
  validateBaselineArchiveV2,
  validateContinuationExternalAnchorV2,
  validateContinuationExternalAttestationV2,
  validateContinuationPolicyV2,
  validateContinuationReviewSetV2,
  validateContinuationReviewSnapshotV2,
  validateContinuationClosureManifestV2,
  validateGovernanceTransitionStateV2,
  validateLifecycleStateV2,
  validateLiveProgramRootV2,
  selectLifecycleProfileV2,
} from "./conversation-disclosure-continuation-contract-v2.mjs";
import {
  PROGRAM_GOVERNANCE_V2_RULE_IDS,
  validateConversationDisclosureProgramGovernanceV2,
} from "./conversation-disclosure-program-governance-v2.mjs";

const PROGRAM_PATH = ".zerox/conversation-disclosure-program.json";
const FEATURE_LIST_PATH = ".zerox/feature_list.json";
const CHECKER_RECEIPT_KIND = "cd03a-continuation-checker-v2-receipt";
const BASE_ARTIFACT_ID = "CD03-causal-shadow";
const ORDINARY_PHASES = new Set([
  "anchored_planned",
  "authorized_active",
]);
const PRE_SUCCESSOR_PHASES = new Set([
  "review_pre_transition",
  "review_post_transition",
  "anchored_planned",
]);
const MAX_ARCHIVE_ENTRY_BYTES = 16 * 1024 * 1024;

export async function runConversationDisclosureContinuationCheckerV2(
  argv = process.argv.slice(2),
) {
  const options = parseOptionsV2(argv);
  const verifierNow = Date.now();
  const captures = [];
  const errors = [...options.errors];
  const controlRoot = await canonicalDirectory(options.controlRoot, "control root");
  const subjectRepositoryRealpath = await canonicalDirectory(
    options.subjectRepositoryRealpath,
    "subject repository",
  );

  const captureControl = (relativePath, label, captureOptions = {}) =>
    captureStableFileV2(path.join(controlRoot, relativePath), label, {
      expectedRoot: controlRoot,
      captures,
      ...captureOptions,
    });
  const captureControlJson = async (relativePath, label, captureOptions = {}) => {
    const capture = await captureControl(relativePath, label, captureOptions);
    return { capture, value: parseJsonV2(capture.bytes, label) };
  };

  requireContinuationAnchorForModeV2(options, errors);
  const baseAnchorCapture = await captureStableFileV2(
    options.baseAnchorPath,
    "Round23 external anchor",
    { captures, requirePrivate: true },
  );
  const baseAnchor = parseJsonV2(baseAnchorCapture.bytes, "Round23 external anchor");
  if (isWithin(subjectRepositoryRealpath, await realpath(options.baseAnchorPath))) {
    errors.push("Round23 external anchor must remain outside the subject repository");
  }
  validateCanonicalDigestObject(baseAnchor, "Round23 external anchor", errors);
  if (baseAnchor.digest !== options.expectedBaseAnchorDigest
    || baseAnchor.repositoryRealpath !== subjectRepositoryRealpath) {
    errors.push("Round23 external anchor does not match the caller/subject pins");
  }

  const { value: archive } = await captureControlJson(
    CONTINUATION_V2_BASELINE_ARCHIVE_PATH,
    "continuation baseline archive",
  );
  const { value: policy } = await captureControlJson(
    CONTINUATION_V2_POLICY_PATH,
    "continuation policy v2",
  );
  const { value: snapshot } = await captureControlJson(
    CONTINUATION_V2_REVIEW_SNAPSHOT_PATH,
    "continuation review snapshot v2",
  );
  const { value: program } = await captureControlJson(PROGRAM_PATH, "conversation program");
  const { value: featureList } = await captureControlJson(FEATURE_LIST_PATH, "Feature list");

  appendErrors(errors, "policy", validateContinuationPolicyV2(policy, {
    expectedDigest: options.expectedPolicyDigest,
    baselineArchive: archive,
  }));
  for (const reference of [
    policy.round1Rejection?.policy,
    policy.round1Rejection?.snapshot,
    ...(policy.round1Rejection?.receipts ?? []),
  ]) {
    if (!reference?.path) continue;
    const current = await captureControl(
      reference.path,
      `Round1 rejection evidence ${reference.path}`,
    );
    if (current.digest !== reference.byteSha256) {
      errors.push(`Round1 rejection evidence drift: ${reference.path}`);
    }
  }
  for (const relativePath of policy.round1Rejection?.forbiddenRepositoryOutputs ?? []) {
    await captureMissingFileV2(
      path.join(controlRoot, relativePath),
      `forbidden Round1 output ${relativePath}`,
      { captures, expectedRoot: controlRoot },
    );
  }
  appendErrors(errors, "snapshot", validateContinuationReviewSnapshotV2(
    snapshot,
    policy,
    { verifierNow },
  ));
  if (snapshot.digest !== options.expectedSnapshotDigest) {
    errors.push("continuation review snapshot does not match the caller pin");
  }
  appendErrors(errors, "archive", validateBaselineArchiveV2(archive, policy));
  const decodedArchive = decodeBaselineArchiveEntriesV2(archive, errors);
  validateArchiveCoverageV2(
    decodedArchive,
    [
      ...(policy.pathAuthorities ?? [])
        .filter((entry) => entry.class === "modify")
        .map((entry) => entry.path),
      ...(policy.governanceTransitions ?? []).map((entry) => entry.path),
    ],
    errors,
  );

  const parentEvidence = await validateRound23Evidence({
    policy,
    archive: decodedArchive,
    baseAnchor,
    baseAnchorPath: options.baseAnchorPath,
    controlRoot,
    captureControl,
    captureControlJson,
    captures,
    verifierNow,
    errors,
  });

  const transitionLiveDigests = new Map();
  const transitionStagedDigests = new Map();
  for (const transition of policy.governanceTransitions ?? []) {
    const live = await captureControl(transition.path, `live transition ${transition.path}`);
    const staged = await captureControl(
      transition.stagedTargetPath,
      `staged transition ${transition.stagedTargetPath}`,
    );
    transitionLiveDigests.set(transition.path, live.digest);
    transitionStagedDigests.set(transition.stagedTargetPath, staged.digest);
  }
  appendErrors(errors, "transition", validateGovernanceTransitionStateV2(
    policy.governanceTransitions,
    options.mode,
    transitionLiveDigests,
    transitionStagedDigests,
  ));

  for (const entry of snapshot.frozenFiles ?? []) {
    const frozen = await captureControl(entry.path, `frozen control ${entry.path}`);
    if (frozen.digest !== entry.sha256) errors.push(`frozen control hash drift: ${entry.path}`);
  }
  for (const trustRoot of policy.trustRoots ?? []) {
    const transition = policy.governanceTransitions?.find(
      (entry) => entry.path === trustRoot.path,
    );
    if (transition && options.mode === "review_pre_transition") continue;
    const trusted = await captureControl(trustRoot.path, `continuation trust root ${trustRoot.path}`);
    if (trusted.digest !== trustRoot.sha256) errors.push(`continuation trust-root drift: ${trustRoot.path}`);
  }

  await validateAuthorities({
    authorities: policy.pathAuthorities,
    mode: options.mode,
    captureControl,
    controlRoot,
    captures,
    errors,
  });

  const lifecycleProfile = selectLifecycleProfileV2(policy, options.mode);
  const governedPresentFeatureIds = (lifecycleProfile?.featureStates ?? [])
    .filter((entry) => entry.presence === "present")
    .map((entry) => entry.id);
  const featureById = new Map((featureList.features ?? []).map((feature) => [feature.id, feature]));
  errors.push(...validateLiveInventoryProjectionV2({
    workstreams: program.workstreams,
    features: featureList.features,
  }, lifecycleProfile, policy.closedWorld?.maxUnfinishedFeatures));
  const liveLifecycle = {
    phase: options.mode,
    activeFeatureId: program.activeFeatureId,
    nextFeatureId: program.nextFeatureId,
    workstreams: program.workstreams,
    features: governedPresentFeatureIds.map((featureId) => featureById.get(featureId)),
  };
  appendErrors(errors, "lifecycle", validateLifecycleStateV2(liveLifecycle, policy));
  appendErrors(errors, "program root", validateCheckerProgramRootV2(
    program,
    policy.closedWorld,
  ));
  const admissionFeature = featureList.features?.find(
    (feature) => feature?.id === CONTINUATION_V2_FEATURE_ID,
  );
  const admissionWorkstream = program.workstreams?.find(
    (workstream) => workstream?.id === CONTINUATION_V2_WORKSTREAM_ID,
  );
  appendErrors(errors, "policy live binding", validateContinuationPolicyV2(policy, {
    expectedDigest: options.expectedPolicyDigest,
    baselineArchive: archive,
    lifecycleState: liveLifecycle,
    liveAdmissionFeature: admissionFeature,
    liveAdmissionWorkstream: admissionWorkstream,
  }));
  validateAdmissionFileSetV2(policy.admission, admissionFeature, snapshot, errors);

  let continuationEvidence;
  if (ORDINARY_PHASES.has(options.mode)) {
    continuationEvidence = await validateOrdinaryContinuationEvidence({
      options,
      policy,
      snapshot,
      controlRoot,
      captureControlJson,
      captures,
      verifierNow,
      subjectRepositoryRealpath,
      errors,
    });
  }
  const governanceResult = validateConversationDisclosureProgramGovernanceV2({
    program,
    featureList,
    closedWorld: {
      schemaVersion: 2,
      programRootDefinition: policy.closedWorld?.programRootDefinition,
      programRootDefinitionDigest: policy.closedWorld?.programRootDefinitionDigest,
      ruleIds: [...PROGRAM_GOVERNANCE_V2_RULE_IDS],
      workstreamIds: (policy.closedWorld?.workstreams ?? []).map((entry) => entry.id),
    },
    lifecycleProfile: {
      phase: governancePhase(options.mode),
      featureIds: governedPresentFeatureIds,
      p107aWorkstreamId: CONTINUATION_V2_WORKSTREAM_ID,
      p107aFeatureId: CONTINUATION_V2_FEATURE_ID,
      p108WorkstreamId: CONTINUATION_V2_SUCCESSOR_WORKSTREAM_ID,
      p108FeatureId: CONTINUATION_V2_SUCCESSOR_FEATURE_ID,
    },
    parentEvidence,
  });
  if (governanceResult.status !== "passed"
    || governanceResult.ruleResults.length !== PROGRAM_GOVERNANCE_V2_RULE_IDS.length
    || governanceResult.ruleResults.some((rule) => rule.status !== "passed")) {
    errors.push(...governanceResult.errors.map((error) => `program governance: ${error}`));
  }

  await postflightCapturesV2(captures);
  const uniqueErrors = [...new Set(errors)];
  if (uniqueErrors.length > 0) throw new CheckerFailure(uniqueErrors);

  const receiptWithoutDigest = {
    schemaVersion: 2,
    kind: CHECKER_RECEIPT_KIND,
    status: "passed",
    mode: options.mode,
    subjectRepositoryRealpath,
    baseExternalAnchorDigest: baseAnchor.digest,
    baseSnapshotDigest: policy.parentEvidence?.snapshot?.digest,
    policyDigest: policy.digest,
    snapshotDigest: snapshot.digest,
    baselineArchiveDigest: archive.digest,
    baselineReconstructedFileCount: policy.parentEvidence?.snapshot?.fileCount,
    continuationAnchorDigest: continuationEvidence?.anchor?.digest ?? null,
    governanceRuleSetDigest: hashCanonicalV2(governanceResult.ruleResults),
  };
  return { ...receiptWithoutDigest, digest: hashCanonicalV2(receiptWithoutDigest) };
}

async function validateRound23Evidence({
  policy,
  archive,
  baseAnchor,
  baseAnchorPath,
  controlRoot,
  captureControl,
  captureControlJson,
  captures,
  verifierNow,
  errors,
}) {
  const references = policy.parentEvidence ?? {};
  const artifactCapture = await captureControl(
    references.artifact?.path,
    "Round23 accepted artifact",
  );
  const artifact = parseJsonV2(artifactCapture.bytes, "Round23 accepted artifact");
  if (artifactCapture.digest !== references.artifact?.byteSha256
    || artifact.artifactId !== BASE_ARTIFACT_ID || artifact.status !== "accepted") {
    errors.push("Round23 accepted artifact reference is stale");
  }

  const { capture: baseSnapshotCapture, value: baseSnapshot } = await captureControlJson(
    references.snapshot?.path,
    "Round23 review snapshot",
  );
  validateCanonicalDigestObject(baseSnapshot, "Round23 review snapshot", errors);
  if (baseSnapshot.digest !== references.snapshot?.digest
    || baseSnapshot.digest !== baseAnchor.snapshotDigest
    || baseSnapshot.files?.length !== references.snapshot?.fileCount
    || baseSnapshot.files?.length !== 101) {
    errors.push("Round23 review snapshot identity/count is stale");
  }
  const reconstructed = new Map();
  for (const entry of baseSnapshot.files ?? []) {
    const archived = archive.get(entry.path);
    if (archived) {
      if (archived.digest !== entry.sha256) {
        errors.push(`Round23 archive hash differs from snapshot: ${entry.path}`);
      }
      reconstructed.set(entry.path, archived.digest);
      continue;
    }
    const live = await captureControl(entry.path, `Round23 protected file ${entry.path}`);
    if (live.digest !== entry.sha256) errors.push(`Round23 protected file drift: ${entry.path}`);
    reconstructed.set(entry.path, live.digest);
  }
  if (reconstructed.size !== 101) errors.push("Round23 101-file reconstruction is incomplete");

  for (const evidence of references.repositoryEvidence ?? []) {
    const reconstructedDigest = reconstructed.get(evidence.path);
    if (reconstructedDigest !== undefined) {
      if (reconstructedDigest !== evidence.sha256) {
        errors.push(`Round23 repository evidence hash is stale: ${evidence.path}`);
      }
      continue;
    }
    const live = await captureControl(
      evidence.path,
      `Round23 repository evidence ${evidence.path}`,
    );
    if (live.digest !== evidence.sha256) {
      errors.push(`Round23 repository evidence hash is stale: ${evidence.path}`);
    }
  }

  const receiptObjects = [];
  for (const receiptReference of references.receipts ?? []) {
    const { value: receipt } = await captureControlJson(
      receiptReference.path,
      `Round23 ${receiptReference.lane} receipt`,
    );
    if (receipt.lane !== receiptReference.lane
      || hashCanonicalV2(receipt) !== receiptReference.canonicalDigest
      || receipt.challenge !== receiptReference.challenge
      || receipt.snapshotDigest !== baseSnapshot.digest || receipt.verdict !== "passed"
      || canonicalJsonV2(receipt.findingCounts) !== canonicalJsonV2({
        critical: 0,
        major: 0,
        minor: 0,
      })
      || !Array.isArray(receipt.findings) || receipt.findings.length !== 0) {
      errors.push(`Round23 ${receiptReference.lane} receipt binding is stale`);
    }
    validateEvidenceTimesV2([receipt], verifierNow, errors);
    receiptObjects.push(receipt);
  }

  const { value: closureManifest } = await captureControlJson(
    references.closureManifest?.path,
    "Round23 closure manifest",
  );
  validateCanonicalDigestObject(closureManifest, "Round23 closure manifest", errors);
  if (closureManifest.digest !== references.closureManifest?.canonicalDigest
    || closureManifest.status !== "externally_attested"
    || closureManifest.snapshot?.digest !== baseSnapshot.digest) {
    errors.push("Round23 closure manifest binding is stale");
  }
  for (const receipt of receiptObjects) {
    const reference = closureManifest.reviewReceipts?.find((entry) => entry.lane === receipt.lane);
    if (reference?.canonicalDigest !== hashCanonicalV2(receipt)) {
      errors.push(`Round23 manifest receipt binding is stale: ${receipt.lane}`);
    }
  }

  const { value: externalAttestation } = await captureControlJson(
    references.externalAttestation?.path,
    "Round23 external attestation",
  );
  validateCanonicalDigestObject(externalAttestation, "Round23 external attestation", errors);
  if (externalAttestation.digest !== references.externalAttestation?.canonicalDigest
    || closureManifest.externalAttestation?.canonicalDigest !== externalAttestation.digest
    || externalAttestation.snapshotDigest !== baseSnapshot.digest
    || externalAttestation.status !== "passed") {
    errors.push("Round23 external attestation binding is stale");
  }
  validateEvidenceTimesV2([externalAttestation, baseAnchor], verifierNow, errors);

  if (baseAnchor.attestationDigest !== externalAttestation.digest
    || baseAnchor.runnerDigest !== references.externalRunner?.sha256
    || baseAnchor.reviewReceipts?.length !== CONTINUATION_V2_REVIEW_LANES.length) {
    errors.push("Round23 external anchor evidence binding is stale");
  }
  for (const receipt of receiptObjects) {
    const anchorReceipt = baseAnchor.reviewReceipts?.find((entry) => entry.lane === receipt.lane);
    if (anchorReceipt?.canonicalDigest !== hashCanonicalV2(receipt)
      || anchorReceipt?.challenge !== receipt.challenge) {
      errors.push(`Round23 anchor receipt binding is stale: ${receipt.lane}`);
    }
  }
  const validatorCapture = await captureControl(
    references.validator?.path,
    "Round23 validator",
  );
  const runnerCapture = await captureControl(
    references.externalRunner?.path,
    "Round23 external runner",
  );
  if (validatorCapture.digest !== references.validator?.sha256
    || runnerCapture.digest !== references.externalRunner?.sha256) {
    errors.push("Round23 executable evidence binding is stale");
  }

  const freezeMarker = await captureUniqueMarker(
    path.dirname(path.join(controlRoot, references.snapshot?.path)),
    `${path.basename(references.snapshot?.path)}.freeze-transaction.json.remove.tombstone.completed-`,
    "Round23 freeze completed marker",
    { captures },
  );
  const freezeTransaction = parseJsonV2(freezeMarker.bytes, "Round23 freeze completed marker");
  validateCanonicalDigestObject(freezeTransaction, "Round23 freeze completed marker", errors);
  if (freezeTransaction.snapshotPath !== references.snapshot?.path
    || freezeTransaction.targetSnapshotDigest !== baseSnapshotCapture.digest) {
    errors.push("Round23 freeze completed marker binding is stale");
  }

  const manifestMarker = await captureUniqueMarker(
    path.dirname(path.join(controlRoot, references.closureManifest?.path)),
    `${path.basename(references.closureManifest?.path)}.atomic-`,
    "Round23 manifest atomic completed marker",
    { captures, suffix: ".marker" },
  );
  const pendingManifest = parseJsonV2(manifestMarker.bytes, "Round23 manifest marker");
  validateCanonicalDigestObject(pendingManifest, "Round23 manifest marker", errors);
  if (externalAttestation.pendingManifestDigest !== pendingManifest.digest) {
    errors.push("Round23 pending manifest/attestation binding is stale");
  }

  const publicationMarker = await captureUniqueMarker(
    path.dirname(baseAnchorPath),
    `${path.basename(baseAnchorPath)}.publication-transaction.json.remove.tombstone.completed-`,
    "Round23 external publication completed marker",
    { captures, requirePrivate: true },
  );
  const publication = parseJsonV2(publicationMarker.bytes, "Round23 publication marker");
  validateCanonicalDigestObject(publication, "Round23 publication marker", errors);
  if (publication.anchorOutputPath !== baseAnchorPath
    || canonicalJsonV2(publication.externalAnchor) !== canonicalJsonV2(baseAnchor)
    || canonicalJsonV2(publication.attestation) !== canonicalJsonV2(externalAttestation)
    || canonicalJsonV2(publication.finalManifest) !== canonicalJsonV2(closureManifest)) {
    errors.push("Round23 external publication marker binding is stale");
  }

  const externalEvidenceByRole = new Map(
    (references.externalEvidence ?? []).map((entry) => [entry.role, entry]),
  );
  const baseAnchorEvidence = externalEvidenceByRole.get("base_anchor");
  const publicationEvidence = externalEvidenceByRole.get(
    "base_anchor_publication_marker",
  );
  const capturedBase = captures.find(
    (entry) => entry.kind === "file" && entry.absolutePath === baseAnchorPath,
  );
  if (baseAnchorEvidence?.basename !== path.basename(baseAnchorPath)
    || baseAnchorEvidence?.sha256 !== capturedBase?.digest) {
    errors.push("Round23 external base-anchor evidence is stale");
  }
  if (publicationEvidence?.basename !== path.basename(publicationMarker.absolutePath)
    || publicationEvidence?.sha256 !== publicationMarker.digest) {
    errors.push("Round23 external publication-marker evidence is stale");
  }
  const runnerCopyEvidence = externalEvidenceByRole.get("external_runner_copy");
  if (runnerCopyEvidence) {
    const runnerCopy = await captureStableFileV2(
      path.join(path.dirname(baseAnchorPath), runnerCopyEvidence.basename),
      "Round23 external runner copy",
      { captures },
    );
    if (runnerCopy.digest !== runnerCopyEvidence.sha256
      || runnerCopy.digest !== references.externalRunner?.sha256) {
      errors.push("Round23 external runner-copy evidence is stale");
    }
  }

  return {
    artifact,
    closureManifest,
    closureManifestPath: references.closureManifest?.path,
    externalAnchor: baseAnchor,
    receipts: receiptObjects,
    externalAttestation,
  };
}

async function validateOrdinaryContinuationEvidence({
  options,
  policy,
  snapshot,
  captureControlJson,
  captures,
  verifierNow,
  subjectRepositoryRealpath,
  errors,
}) {
  const anchorCapture = await captureStableFileV2(
    options.continuationAnchorPath,
    "continuation external anchor",
    { captures, requirePrivate: true },
  );
  const anchor = parseJsonV2(anchorCapture.bytes, "continuation external anchor");
  if (isWithin(subjectRepositoryRealpath, await realpath(options.continuationAnchorPath))) {
    errors.push("continuation external anchor must remain outside the subject repository");
  }
  const { value: manifest } = await captureControlJson(
    CONTINUATION_V2_CLOSURE_MANIFEST_PATH,
    "continuation closure manifest",
  );
  const receipts = [];
  const callerPins = {};
  for (const entry of manifest.reviewReceipts ?? []) {
    const { value: receipt } = await captureControlJson(
      entry.path,
      `continuation ${entry.lane} receipt`,
    );
    receipts.push(receipt);
    callerPins[entry.lane] = {
      canonicalDigest: entry.canonicalDigest,
      challenge: entry.challenge,
    };
  }
  const { value: attestation } = await captureControlJson(
    CONTINUATION_V2_EXTERNAL_ATTESTATION_PATH,
    "continuation external attestation",
  );
  appendErrors(errors, "continuation review set", validateContinuationReviewSetV2(
    receipts,
    snapshot,
    policy,
    { callerPins, verifierNow },
  ));
  appendErrors(errors, "continuation manifest", validateContinuationClosureManifestV2(
    manifest,
    { policy, snapshot, receipts },
  ));
  appendErrors(errors, "continuation attestation", validateContinuationExternalAttestationV2(
    attestation,
    {
      verifierNow,
      policy,
      snapshot,
      receipts,
      manifest,
      repositoryRealpath: subjectRepositoryRealpath,
    },
  ));
  appendErrors(errors, "continuation anchor", validateContinuationExternalAnchorV2(
    anchor,
    {
      verifierNow,
      expectedDigest: options.expectedContinuationAnchorDigest,
      policy,
      snapshot,
      receipts,
      attestation,
    },
  ));
  if (anchor.repositoryRealpath !== subjectRepositoryRealpath) {
    errors.push("continuation anchor repository identity is stale");
  }
  return { anchor, manifest, receipts, attestation };
}

async function validateAuthorities({
  authorities,
  mode,
  captureControl,
  controlRoot,
  captures,
  errors,
}) {
  for (const authority of authorities ?? []) {
    let liveState;
    try {
      const live = await captureControl(authority.path, `authority ${authority.path}`);
      liveState = { present: true, digest: live.digest };
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await captureMissingFileV2(
        path.join(controlRoot, authority.path),
        `authority absence ${authority.path}`,
        { captures, expectedRoot: controlRoot },
      );
      liveState = { present: false, digest: null };
    }
    errors.push(...validateAuthorityPhaseValueV2(authority, mode, liveState));
    const allowed = authority.class === "bookkeeping"
      && authority.allowedPhases?.includes(mode);
    if (authority.class === "modify") {
      // The common authority model above validates presence and phase digest.
    } else if (authority.class === "create") {
      // Create absence/presence is likewise owned by the common authority model.
    } else if (authority.class === "bookkeeping") {
      const baseline = authority.baseline ?? {};
      if (allowed) {
        if (liveState.present && authority.validator === "cd04_evidence_schema_v1") {
          const live = await captureControl(authority.path, `bookkeeping schema ${authority.path}`);
          try {
            const parsed = JSON.parse(live.bytes.toString("utf8"));
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
              errors.push(`bookkeeping evidence is not an object: ${authority.path}`);
            }
          } catch {
            errors.push(`bookkeeping evidence is invalid JSON: ${authority.path}`);
          }
        }
      } else if (baseline.presence === "present") {
        // Baseline equality is checked by the common authority model.
      }
    }
  }
}

export function decodeBaselineArchiveEntriesV2(archive, errors = []) {
  const decoded = new Map();
  for (const [index, entry] of (archive?.entries ?? []).entries()) {
    try {
      const compressed = Buffer.from(entry.bytes, "base64");
      if (compressed.toString("base64") !== entry.bytes) throw new Error("base64");
      const bytes = gunzipSync(compressed, { maxOutputLength: MAX_ARCHIVE_ENTRY_BYTES });
      if (gzipSync(bytes, { level: 9, mtime: 0 }).toString("base64") !== entry.bytes) {
        throw new Error("non-deterministic gzip");
      }
      const digest = sha256BytesV2(bytes);
      if (digest !== entry.sha256 || decoded.has(entry.path)) throw new Error("digest/duplicate");
      decoded.set(entry.path, { bytes, digest, source: entry.source });
    } catch {
      errors.push(`baseline archive entry is corrupt: ${entry?.path ?? index}`);
    }
  }
  return decoded;
}

export function validateArchiveCoverageV2(decoded, expectedPaths, errors = []) {
  const actual = [...decoded.keys()].sort();
  const expected = [...new Set(expectedPaths)].sort();
  if (canonicalJsonV2(actual) !== canonicalJsonV2(expected)) {
    errors.push("baseline archive decoded coverage is incomplete or contains extra paths");
  }
  return errors;
}

export function validateAuthorityPhaseValueV2(authority, mode, live) {
  const errors = [];
  if (authority?.class === "modify") {
    if (!live?.present) errors.push(`modify authority is missing: ${authority?.path}`);
    if (PRE_SUCCESSOR_PHASES.has(mode) && live?.digest !== authority?.baseline?.sha256) {
      errors.push(`modify authority changed before authorization: ${authority?.path}`);
    }
  } else if (authority?.class === "create") {
    if (PRE_SUCCESSOR_PHASES.has(mode) && live?.present) {
      errors.push(`create authority was preplanted before authorization: ${authority?.path}`);
    }
  } else if (authority?.class === "bookkeeping") {
    const allowed = authority.allowedPhases?.includes(mode);
    if (!allowed) {
      const baseline = authority.baseline ?? {};
      if (baseline.presence === "present"
        && (!live?.present || live?.digest !== baseline.sha256)) {
        errors.push(`bookkeeping path changed outside its allowed phase: ${authority?.path}`);
      }
      if (baseline.presence === "absent" && live?.present) {
        errors.push(`bookkeeping path appeared outside its allowed phase: ${authority?.path}`);
      }
    }
  }
  return errors;
}

export function validateAdmissionFileSetV2(admission, feature, snapshot, errors = []) {
  try {
    const stable = stableFeatureDefinitionV2(feature);
    if (hashCanonicalV2(stable) !== admission?.featureDefinitionDigest
      || hashCanonicalV2(stable.files) !== admission?.featureFileSetDigest
      || snapshot?.admissionFeatureDefinitionDigest !== admission?.featureDefinitionDigest
      || snapshot?.admissionFeatureFileSetDigest !== admission?.featureFileSetDigest) {
      errors.push("live P107A definition/file-set digest is stale");
    }
  } catch {
    errors.push("live P107A Feature is absent or invalid");
  }
  return errors;
}

export function validateEvidenceTimesV2(values, verifierNow, errors = []) {
  for (const value of values) {
    const timestamp = Date.parse(value?.completedAt ?? value?.frozenAt ?? "");
    if (!Number.isFinite(timestamp)
      || new Date(timestamp).toISOString() !== (value?.completedAt ?? value?.frozenAt)
      || timestamp > verifierNow) {
      errors.push("review/attestation/anchor evidence timestamp is invalid or future-dated");
    }
  }
  return errors;
}

export function validateLiveInventoryProjectionV2(live, profile, maxUnfinished = 1) {
  const errors = [];
  const expectedWorkstreams = (profile?.workstreamStates ?? []).map((entry) => entry.id);
  const liveWorkstreams = (live?.workstreams ?? []).map((entry) => entry.id);
  if (canonicalJsonV2(liveWorkstreams) !== canonicalJsonV2(expectedWorkstreams)) {
    errors.push("unknown or missing live workstream");
  }
  const expectedFeatures = (profile?.featureStates ?? [])
    .filter((entry) => entry.presence === "present").map((entry) => entry.id);
  const liveFeatures = (live?.features ?? []).map((entry) => entry.id);
  if (canonicalJsonV2(liveFeatures) !== canonicalJsonV2(expectedFeatures)) {
    errors.push("unknown or missing live Feature");
  }
  if ((live?.features ?? []).filter((entry) => entry.status !== "done").length > maxUnfinished) {
    errors.push("unfinished Feature count exceeds the closed-world maximum");
  }
  return errors;
}

export function requireContinuationAnchorForModeV2(options, errors = []) {
  const ordinary = ORDINARY_PHASES.has(options.mode);
  if (ordinary && (!path.isAbsolute(options.continuationAnchorPath ?? "")
    || !sha256DigestV2(options.expectedContinuationAnchorDigest))) {
    errors.push("ordinary continuation mode requires a caller-pinned continuation anchor");
  }
  if (!ordinary && (options.continuationAnchorPath !== undefined
    || options.expectedContinuationAnchorDigest !== undefined)) {
    errors.push("review transition mode must not accept a continuation anchor");
  }
  return errors;
}

export async function captureStableFileV2(
  absolutePath,
  label,
  { expectedRoot, captures = [], requirePrivate = false } = {},
) {
  if (!path.isAbsolute(absolutePath)) throw new Error(`${label} path must be absolute`);
  const parentIdentities = await captureParentIdentities(absolutePath, label);
  const before = await lstat(absolutePath);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) {
    throw new Error(`${label} must be one non-symlink single-link regular file`);
  }
  if (requirePrivate && (before.uid !== process.geteuid() || (before.mode & 0o777) !== 0o600)) {
    throw new Error(`${label} must be effective-user-owned mode 0600`);
  }
  const handle = await open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1
      || opened.dev !== before.dev || opened.ino !== before.ino) {
      throw new Error(`${label} changed identity while opening`);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.nlink !== 1
      || after.size !== bytes.length || after.uid !== opened.uid
      || (after.mode & 0o777) !== (opened.mode & 0o777)) {
      throw new Error(`${label} changed identity while reading`);
    }
    await assertParentIdentities(parentIdentities, label);
    const finalLeaf = await lstat(absolutePath);
    if (!finalLeaf.isFile() || finalLeaf.isSymbolicLink() || finalLeaf.nlink !== 1
      || finalLeaf.dev !== opened.dev || finalLeaf.ino !== opened.ino) {
      throw new Error(`${label} changed pathname identity while reading`);
    }
    if (expectedRoot && !isWithin(expectedRoot, await realpath(absolutePath))) {
      throw new Error(`${label} escaped the expected root`);
    }
    const capture = {
      kind: "file",
      absolutePath,
      label,
      bytes,
      digest: sha256BytesV2(bytes),
      dev: opened.dev,
      ino: opened.ino,
      nlink: opened.nlink,
      uid: opened.uid,
      mode: opened.mode & 0o777,
      parentIdentities,
    };
    captures.push(capture);
    return capture;
  } finally {
    await handle.close();
  }
}

export async function captureMissingFileV2(
  absolutePath,
  label,
  { expectedRoot, captures = [] } = {},
) {
  if (!path.isAbsolute(absolutePath)) throw new Error(`${label} path must be absolute`);
  const parentIdentities = await captureParentIdentities(absolutePath, label);
  if (expectedRoot && !isWithin(expectedRoot, path.dirname(absolutePath))) {
    throw new Error(`${label} absence escaped the expected root`);
  }
  try {
    await lstat(absolutePath);
    return false;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  captures.push({ kind: "missing", absolutePath, label, parentIdentities });
  return true;
}

export async function postflightCapturesV2(captures) {
  for (const capture of captures) {
    await assertParentIdentities(capture.parentIdentities, capture.label);
    if (capture.kind === "missing") {
      try {
        await lstat(capture.absolutePath);
        throw new Error(`${capture.label} appeared after preflight`);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      continue;
    }
    const after = await lstat(capture.absolutePath);
    if (!after.isFile() || after.isSymbolicLink() || after.nlink !== 1
      || after.dev !== capture.dev || after.ino !== capture.ino
      || after.uid !== capture.uid || (after.mode & 0o777) !== capture.mode) {
      throw new Error(`${capture.label} changed identity before postflight`);
    }
    const handle = await open(capture.absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = await handle.stat();
      const bytes = await handle.readFile();
      if (opened.dev !== capture.dev || opened.ino !== capture.ino
        || sha256BytesV2(bytes) !== capture.digest) {
        throw new Error(`${capture.label} changed bytes/identity before postflight`);
      }
    } finally {
      await handle.close();
    }
  }
}

async function captureUniqueMarker(
  directory,
  prefix,
  label,
  { captures = [], suffix = ".marker", requirePrivate = false } = {},
) {
  const directoryIdentity = await lstat(directory);
  if (!directoryIdentity.isDirectory() || directoryIdentity.isSymbolicLink()) {
    throw new Error(`${label} directory is invalid`);
  }
  const matches = (await readdir(directory)).filter(
    (entry) => entry.startsWith(prefix) && entry.endsWith(suffix),
  );
  if (matches.length !== 1) throw new Error(`${label} must have exactly one marker`);
  return captureStableFileV2(path.join(directory, matches[0]), label, {
    captures,
    requirePrivate,
  });
}

async function captureParentIdentities(absolutePath, label) {
  const parentPath = path.dirname(absolutePath);
  const parsed = path.parse(parentPath);
  const segments = parentPath.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let cursor = parsed.root;
  const identities = [];
  for (const segment of segments) {
    cursor = path.join(cursor, segment);
    const entry = await lstat(cursor);
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new Error(`${label} parent must not traverse aliases/symlinks`);
    }
    identities.push({ path: cursor, dev: entry.dev, ino: entry.ino });
  }
  return identities;
}

async function assertParentIdentities(identities, label) {
  for (const expected of identities) {
    const current = await lstat(expected.path);
    if (!current.isDirectory() || current.isSymbolicLink()
      || current.dev !== expected.dev || current.ino !== expected.ino) {
      throw new Error(`${label} parent identity changed`);
    }
  }
}

async function canonicalDirectory(value, label) {
  if (!path.isAbsolute(value ?? "")) throw new Error(`${label} must be absolute`);
  const canonical = await realpath(value);
  const entry = await stat(canonical);
  if (!entry.isDirectory()) throw new Error(`${label} must be a directory`);
  return canonical;
}

function parseOptionsV2(args) {
  const names = new Map([
    ["--mode", "mode"],
    ["--control-root", "controlRoot"],
    ["--subject-repository-realpath", "subjectRepositoryRealpath"],
    ["--base-anchor", "baseAnchorPath"],
    ["--expected-base-anchor-digest", "expectedBaseAnchorDigest"],
    ["--expected-policy-digest", "expectedPolicyDigest"],
    ["--expected-snapshot-digest", "expectedSnapshotDigest"],
    ["--continuation-anchor", "continuationAnchorPath"],
    ["--expected-continuation-anchor-digest", "expectedContinuationAnchorDigest"],
  ]);
  const options = { errors: [] };
  for (let index = 0; index < args.length; index += 1) {
    const key = names.get(args[index]);
    if (!key || options[key] !== undefined) {
      options.errors.push(`unknown or duplicate checker v2 option: ${args[index]}`);
      continue;
    }
    options[key] = args[index + 1];
    index += 1;
  }
  options.controlRoot ??= process.cwd();
  validateRequestedContinuationModeV2(options.mode, options.errors);
  for (const key of [
    "controlRoot",
    "subjectRepositoryRealpath",
    "baseAnchorPath",
  ]) {
    if (!path.isAbsolute(options[key] ?? "")) options.errors.push(`${key} must be absolute`);
  }
  for (const key of [
    "expectedBaseAnchorDigest",
    "expectedPolicyDigest",
    "expectedSnapshotDigest",
  ]) {
    if (!sha256DigestV2(options[key])) options.errors.push(`${key} must be SHA-256`);
  }
  return options;
}

export function validateRequestedContinuationModeV2(mode, errors = []) {
  if (mode === "completed_pending_delta") {
    errors.push(
      "completed_pending_delta is not authorized by the P107A trust head; "
        + "P108 done requires a CD04 next-version independently reviewed delta trust head",
    );
  } else if (!CONTINUATION_V2_LIFECYCLE_PHASES.includes(mode)) {
    errors.push("checker v2 --mode is invalid");
  }
  return errors;
}

export function validateCheckerProgramRootV2(program, closedWorld) {
  return validateLiveProgramRootV2(program, closedWorld);
}

function validateCanonicalDigestObject(value, label, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !sha256DigestV2(value.digest)) {
    errors.push(`${label} has no canonical digest`);
    return;
  }
  const withoutDigest = { ...value };
  delete withoutDigest.digest;
  if (value.digest !== hashCanonicalV2(withoutDigest)) {
    errors.push(`${label} canonical digest is stale`);
  }
}

function parseJsonV2(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} must contain valid JSON`);
  }
}

function appendErrors(target, subject, values) {
  target.push(...values.map((value) => `${subject}: ${value}`));
}

function governancePhase(mode) {
  if (mode === "review_pre_transition") return "review_pre";
  if (mode === "review_post_transition") return "review_post";
  return mode;
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

class CheckerFailure extends Error {
  constructor(errors) {
    super(errors.join("\n"));
    this.errors = errors;
  }
}

async function cli() {
  try {
    const receipt = await runConversationDisclosureContinuationCheckerV2();
    console.log(JSON.stringify(receipt));
  } catch (error) {
    const errors = error instanceof CheckerFailure ? error.errors : [error.message];
    console.error("Conversation disclosure continuation checker v2 failed:");
    for (const item of errors) console.error(`- ${item}`);
    process.exitCode = 1;
  }
}

if (process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await cli();
}
