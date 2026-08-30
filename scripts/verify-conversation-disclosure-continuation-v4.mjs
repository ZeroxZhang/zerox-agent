#!/usr/bin/env node

// CD03A external closure runner v4. This file is intentionally self-contained:
// a caller pins these exact bytes and it imports Node builtins only. Candidate
// repository code is executed only after independent validation in an external
// staged control tree.

import { execFile as execFileCallback, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  realpath,
  rm,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { gunzipSync, gzipSync } from "node:zlib";

const execFile = promisify(execFileCallback);
const SELF_PATH = await realpath(fileURLToPath(import.meta.url));
const POLICY_PATH =
  ".zerox/verification/conversation-disclosure/CD03A-round4-successor-evolution-policy.json";
const SNAPSHOT_PATH =
  ".zerox/verification/conversation-disclosure/CD03A-round4-review-snapshot.json";
const BASELINE_ARCHIVE_PATH =
  ".zerox/verification/conversation-disclosure/CD03A-round4-baseline-archive.json";
const ROUND3_REVIEW_REJECTION_PATH =
  ".zerox/verification/conversation-disclosure/CD03A-round3-review-rejection.json";
const REQUIRED_LANES = Object.freeze(["contract", "runtime", "governance"]);
const ADMISSION_CLASSES = Object.freeze([
  "frozen_file", "transition_live", "transition_payload",
  "post_review_mutable", "review_output_absent", "rejected_output_absent",
]);
const ROUND3_POLICY_ROOT = Object.freeze({
  path:
    ".zerox/verification/conversation-disclosure/CD03A-round3-successor-evolution-policy.json",
  byteSha256:
    "sha256:4e4bb13182ba7b59753a62b98d02d249f7a8fe9dd1ffe924e211b477206c7223",
  canonicalDigest:
    "sha256:3eb5b7637bbab47f83cb3dcbe43cf2bcbb5eab0930eef9e8ff777442c5c2badc",
});
const ROUND3_SNAPSHOT_ROOT = Object.freeze({
  path:
    ".zerox/verification/conversation-disclosure/CD03A-round3-review-snapshot.json",
  byteSha256:
    "sha256:fe7bffa24348d88bfc42926a5ed0129391600d8abcc3daa2d8b1c6aa97b88bac",
  canonicalDigest:
    "sha256:cbec3496b39cb5637e40cd1276e370dc9245fd425552fd7e18fcf972d7816ced",
});
const ROUND3_RECEIPT_ROOTS = Object.freeze([
  Object.freeze({
    lane: "contract",
    path:
      ".zerox/verification/conversation-disclosure/CD03A-round3-contract-review.json",
    byteSha256:
      "sha256:291f94cbe0cc671af306897284575b361e0e44ea3e36160d2ec1cacf46b01e52",
    canonicalDigest:
      "sha256:1ccf5eb85e00d61533db2e7b59dd0563014d29543014b6be32a4838d4d9d67b1",
  }),
  Object.freeze({
    lane: "runtime",
    path:
      ".zerox/verification/conversation-disclosure/CD03A-round3-runtime-review.json",
    byteSha256:
      "sha256:000245a2376203580c71c6d2a446936bd5ad0fe594439b3b0ec00ac67d376fc5",
    canonicalDigest:
      "sha256:ed495d4e3c96d5fbfa8d52f87da3b17b777a27d655c1a15ba875178f09d14f28",
  }),
  Object.freeze({
    lane: "governance",
    path:
      ".zerox/verification/conversation-disclosure/CD03A-round3-governance-review.json",
    byteSha256:
      "sha256:3edeff95db07af8c6e3f6adaf7d278cb85a38205a435a5f84d0f44488089e56f",
    canonicalDigest:
      "sha256:7e9c70178da80da83c398b5716d44b79454c3f13a5dd71e3364d39cf5649923b",
  }),
]);
const ROUND3_FINDING_IDS = Object.freeze([
  "R3-CONTRACT-001", "R3-GOVERNANCE-001", "R3-RUNTIME-001",
  "R3-RUNTIME-002", "R3-RUNTIME-003", "R3-RUNTIME-004",
]);
const ROUND3_FINDING_SET_DIGEST =
  "sha256:d0fb938d663c7c54d823baefa9283b4d9f84562f53e0f65941e0ecddc08576ed";
const JOURNAL_KIND =
  "conversation-disclosure-continuation-publication-transaction-v4";
const ATTESTATION_KIND =
  "conversation-disclosure-continuation-external-attestation";
const ANCHOR_KIND = "conversation-disclosure-continuation-external-anchor";
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;
const SYSTEM_PYTHON_CANDIDATES = ["/usr/bin/python3", "/usr/local/bin/python3"];
const POLICY_KEYS = Object.freeze([
  "admission", "admissionClassSet", "admissionClassSetDigest",
  "admissionCoverage", "algorithm", "baselineArchive", "closedWorld",
  "continuationExecutables", "digest", "externalAnchorPolicy", "featureId",
  "governanceTransitions", "kind", "parentEvidence", "pathAuthorities",
  "policyId", "programId", "reviewAssurancePolicy", "reviewSnapshot", "round",
  "round1Rejection", "round2PrefreezeRejection", "round3ReviewRejection",
  "schemaVersion", "status", "successor", "timePolicy", "trustRoots",
  "workstreamId",
]);
const SNAPSHOT_KEYS = Object.freeze([
  "absentPaths", "admissionClassSetDigest", "admissionFeatureDefinitionDigest",
  "admissionFeatureFileSetDigest", "algorithm", "baselineArchive",
  "baselineFiles", "closedWorldDigest", "digest", "featureId", "frozenAt",
  "frozenFiles", "governanceTransitions", "kind",
  "parentEvidenceBundleDigest", "pathAuthorityDigest", "policyDigest",
  "programId", "reviewOutputAbsentPaths", "round",
  "round3ReviewRejectionDigest", "schemaVersion",
  "successorFeatureDefinitionDigest", "successorWorkstreamDefinitionDigest",
  "transitionPayloadFiles", "workstreamId",
]);
const MANIFEST_KEYS = Object.freeze([
  "callerDispatchSet", "digest", "externalAttestation", "externalRunner",
  "featureId", "kind", "parentEvidenceBundleDigest", "pendingManifestDigest",
  "policy", "programId", "reviewReceipts", "round", "round3ReviewRejection",
  "schemaVersion", "snapshot", "status", "validator", "workstreamId",
]);
const ARCHIVE_KEYS = Object.freeze([
  "algorithm", "digest", "entries", "entrySetDigest", "featureId", "kind",
  "programId", "round", "schemaVersion", "workstreamId",
]);
const ARCHIVE_ENTRY_KEYS = Object.freeze([
  "bytes", "encoding", "path", "sha256", "source",
]);
const JOURNAL_KEYS = Object.freeze([
  "algorithm", "baselineArchive", "callerPins", "candidateResults", "controlSet",
  "digest", "finalSetDigest", "governanceTransitions", "kind", "pendingManifest",
  "preparedAt", "publications", "repository", "reviewSnapshot", "runner",
  "schemaVersion", "status", "transactionId",
]);
const CONTROL_SET_KIND = "conversation-disclosure-continuation-control-set-v4";
const CONTROL_SET_KEYS = Object.freeze([
  "algorithm", "digest", "entries", "kind", "schemaVersion",
]);
const CONTROL_ENTRY_KEYS = Object.freeze([
  "dev", "ino", "mode", "nlink", "path", "sha256", "uid",
]);
const CANDIDATE_RESULT_KEYS = Object.freeze([
  "kind", "path", "receiptDigest", "status", "stderrDigest", "stdoutDigest",
]);
const RECEIPT_KEYS = Object.freeze([
  "admissionFeatureDefinitionDigest", "admissionFeatureFileSetDigest",
  "callerDispatchEntryDigest", "callerDispatchSetDigest", "challenge",
  "claimedReviewOrigin", "closedWorldDigest", "completedAt", "featureId",
  "findingCounts", "findings", "identityAssurance", "independenceClaim",
  "kind", "lane", "parentEvidenceBundleDigest", "pathAuthorityDigest",
  "policyDigest", "programId", "reviewedPhase", "round",
  "round3ReviewRejectionDigest", "schemaVersion", "snapshotDigest",
  "snapshotFileCount", "successorFeatureDefinitionDigest",
  "successorWorkstreamDefinitionDigest", "validatorDigest", "verdict",
  "workstreamId",
]);
const ATTESTATION_KEYS = Object.freeze([
  "callerDispatchSet", "candidateResults", "completedAt", "digest",
  "governancePhase", "identityAssurance", "kind",
  "parentEvidenceBundleDigest", "pendingManifestDigest", "policyDigest",
  "repositoryRealpath", "reviewAssurance", "round3ReviewRejectionDigest",
  "runnerDigest", "schemaVersion", "snapshotDigest", "status",
  "validatorDigest",
]);
const ANCHOR_KEYS = Object.freeze([
  "attestationDigest", "callerDispatchSet", "completedAt", "digest", "head",
  "identityAssurance", "kind", "parentEvidenceBundleDigest", "policyDigest",
  "repositoryRealpath", "reviewAssurance", "round3ReviewRejectionDigest",
  "runnerDigest", "schemaVersion", "snapshotDigest", "validatorDigest",
]);
let resolvedPython;

rejectPreloadEnvironment();
const options = parseOptions(process.argv.slice(2));
const repositoryRealpath = await realpath(options.repo);
if (repositoryRealpath !== options.expectedRepoRealpath) {
  fail("repository realpath does not match the caller pin");
}
if (pathIsWithin(repositoryRealpath, SELF_PATH)) {
  fail("runner must execute from a caller-pinned copy outside the repository");
}

const selfCapture = await captureAbsoluteFile(SELF_PATH, "external runner", {
  requirePrivate: false,
});
if (selfCapture.digest !== options.expectedRunnerDigest) {
  fail("external runner digest does not match the caller pin");
}
const nodeExecRealpath = await realpath(process.execPath);
const nodeCapture = await captureAbsoluteFile(
  nodeExecRealpath,
  "process.execPath",
  { requirePrivate: false },
);
if (nodeCapture.digest !== options.expectedNodeExecDigest) {
  fail("process.execPath digest does not match the caller pin");
}

assertOutsideRepository(options.baseAnchor, repositoryRealpath, "base anchor");
assertOutsideRepository(
  options.externalAnchorOutput,
  repositoryRealpath,
  "external anchor output",
);
assertOutsideRepository(options.journalOutput, repositoryRealpath, "journal output");
if (options.journalOutput !== `${options.externalAnchorOutput}.closure-v4.journal.json`) {
  fail("journal output must be the deterministic external-anchor journal path");
}
await assertPrivateOutputParent(options.externalAnchorOutput, "external anchor output");
await assertPrivateOutputParent(options.journalOutput, "journal output");

const existingJournal = await captureOptionalAbsoluteFile(
  options.journalOutput,
  "prepared transaction journal",
  { requirePrivate: true },
);
const existingMarkers = await captureCompletedMarkers(options.journalOutput);
if (existingMarkers.length > 1) {
  fail("multiple completed transaction markers are ambiguous");
}
const existingMarker = existingMarkers[0] ?? null;

if (existingMarker) {
  const completedJournal = parseJson(existingMarker.bytes, "completed transaction marker");
  validateJournal(completedJournal, options, repositoryRealpath, selfCapture.digest);
  validateCompletedMarkerIdentity(existingMarker, completedJournal, existingJournal);
  if (existingJournal && !existingJournal.bytes.equals(existingMarker.bytes)) {
    fail("journal and completed marker bytes disagree");
  }
  await revalidatePreparedJournalAgainstSources(completedJournal);
  await convergePreparedTransaction(completedJournal, {
    journalBytes: existingMarker.bytes,
    recovery: true,
    skipFaults: true,
  });
  if (existingJournal) {
    await retireExactFile(options.journalOutput, existingJournal.digest, "completed journal");
  }
  await validateCompletedState(completedJournal);
  printPublicationReceipt(completedJournal, true);
  process.exit(0);
}

if (existingJournal) {
  const prepared = parseJson(existingJournal.bytes, "prepared transaction journal");
  validateJournal(prepared, options, repositoryRealpath, selfCapture.digest);
  await revalidatePreparedJournalAgainstSources(prepared);
  await convergePreparedTransaction(prepared, {
    journalBytes: existingJournal.bytes,
    recovery: true,
    skipFaults: false,
  });
  await completeTransaction(prepared, existingJournal.bytes);
  printPublicationReceipt(prepared, true);
  process.exit(0);
}

const fresh = await buildFreshTransaction();
const journalBytes = prettyJsonBytes(fresh);
await convergeAbsoluteFile({
  absolutePath: options.journalOutput,
  original: null,
  targetBytes: journalBytes,
  targetMode: 0o600,
  label: "prepared transaction journal",
});
injectFault("after-journal");
await convergePreparedTransaction(fresh, {
  journalBytes,
  recovery: false,
  skipFaults: false,
});
await completeTransaction(fresh, journalBytes);
printPublicationReceipt(fresh, false);

async function buildFreshTransaction() {
  const baseAnchorCapture = await captureAbsoluteFile(options.baseAnchor, "base anchor", {
    requirePrivate: true,
  });
  const baseAnchor = parseJson(baseAnchorCapture.bytes, "base anchor");
  validateCanonicalObject(baseAnchor, "base anchor");
  if (baseAnchor.digest !== options.expectedBaseAnchorDigest
    || baseAnchor.repositoryRealpath !== repositoryRealpath) {
    fail("base anchor identity does not match the caller pins");
  }

  const policyCapture = await captureRepositoryFile(
    POLICY_PATH,
    "continuation policy",
    { requirePrivate: true },
  );
  const policy = parseJson(policyCapture.bytes, "continuation policy");
  validateCanonicalObject(policy, "continuation policy");
  if (!exactKeys(policy, POLICY_KEYS)
    || policy.schemaVersion !== 4
    || policy.kind !== "conversation-disclosure-continuation-policy"
    || policy.algorithm !== "sha256-canonical-json-v1"
    || policy.round !== 4
    || policy.status !== "frozen"
    || policy.digest !== options.expectedPolicyDigest) {
    fail("continuation policy does not match the caller pin");
  }
  if (policy.parentEvidence?.externalAnchor?.digest !== baseAnchor.digest
    || policy.parentEvidence?.snapshot?.digest !== baseAnchor.snapshotDigest) {
    fail("continuation policy parent binding is stale");
  }
  validateAdmissionCoverage(policy);
  await captureAndValidateRound3ReviewRejection(policy);

  const archive = await captureAndValidateBaselineArchive(policy);

  const snapshotPath = policy.reviewSnapshot?.path ?? SNAPSHOT_PATH;
  const snapshotCapture = await captureRepositoryFile(
    snapshotPath,
    "continuation review snapshot",
    { requirePrivate: true },
  );
  const snapshot = parseJson(snapshotCapture.bytes, "continuation review snapshot");
  validateCanonicalObject(snapshot, "continuation review snapshot");
  if (!exactKeys(snapshot, SNAPSHOT_KEYS)
    || snapshot.schemaVersion !== 4
    || snapshot.kind !== "conversation-disclosure-continuation-review-snapshot"
    || snapshot.round !== 4
    || snapshot.digest !== options.expectedSnapshotDigest
    || snapshot.policyDigest !== policy.digest
    || snapshot.admissionClassSetDigest !== policy.admissionClassSetDigest
    || snapshot.round3ReviewRejectionDigest
      !== policy.round3ReviewRejection?.digest
    || snapshot.parentEvidenceBundleDigest !== policy.parentEvidence?.bundleDigest
    || canonicalJson(snapshot.baselineArchive) !== canonicalJson(policy.baselineArchive)) {
    fail("continuation review snapshot binding is stale");
  }
  await validateSnapshotTransitionPayloadFiles(snapshot, policy);
  validateSnapshotReviewOutputCategories(snapshot, policy);
  for (const entry of snapshot.frozenFiles ?? []) {
    const capture = await captureRepositoryFile(entry.path, `snapshot file ${entry.path}`);
    if (capture.digest !== entry.sha256) fail(`snapshot file hash drift: ${entry.path}`);
  }
  for (const entry of snapshot.baselineFiles ?? []) {
    const archived = archive.decodedEntries.get(entry.path);
    if (archived) {
      if (archived.sha256 !== entry.sha256) {
        fail(`snapshot archived baseline hash drift: ${entry.path}`);
      }
    } else {
      const capture = await captureRepositoryFile(entry.path, `snapshot baseline ${entry.path}`);
      if (capture.digest !== entry.sha256) fail(`snapshot baseline hash drift: ${entry.path}`);
    }
  }
  for (const absentPath of snapshot.absentPaths ?? []) {
    if (await repositoryEntryExists(repositoryRealpath, absentPath)) {
      fail(`snapshot absent path exists: ${absentPath}`);
    }
  }

  const manifestCapture = await captureRepositoryFile(
    options.pendingManifest,
    "pending continuation manifest",
    { requirePrivate: true },
  );
  const manifest = parseJson(manifestCapture.bytes, "pending continuation manifest");
  validateCanonicalObject(manifest, "pending continuation manifest");
  if (!exactKeys(manifest, MANIFEST_KEYS)
    || manifest.schemaVersion !== 4
    || manifest.kind !== "conversation-disclosure-continuation-closure-manifest"
    || manifest.round !== 4
    || manifest.digest !== options.expectedPendingManifestDigest
    || manifest.status !== "review_passed_pending_external_transaction"
    || manifest.pendingManifestDigest !== pendingManifestDigest(manifest)
    || manifest.policy?.canonicalDigest !== policy.digest
    || manifest.snapshot?.canonicalDigest !== snapshot.digest
    || manifest.round3ReviewRejection?.canonicalDigest
      !== policy.round3ReviewRejection?.digest) {
    fail("pending continuation manifest binding is stale");
  }
  if (manifest.externalRunner?.sha256 !== selfCapture.digest) {
    fail("pending manifest does not bind this external runner");
  }

  const receipts = [];
  for (const entry of manifest.reviewReceipts ?? []) {
    const receiptCapture = await captureRepositoryFile(
      entry.path,
      `${entry.lane ?? "unknown"} review receipt`,
      { requirePrivate: true },
    );
    const receipt = parseJson(receiptCapture.bytes, `${entry.lane} review receipt`);
    const canonicalDigest = hashCanonical(receipt);
    if (entry.canonicalDigest !== canonicalDigest
      || options.receiptDigests.get(entry.lane) !== canonicalDigest
      || options.challenges.get(entry.lane) !== receipt.challenge) {
      fail(`review receipt caller binding is stale: ${entry.lane}`);
    }
    if (receipt.verdict !== "passed"
      || Object.values(receipt.findingCounts ?? {}).some((value) => value !== 0)
      || receipt.snapshotDigest !== snapshot.digest
      || receipt.policyDigest !== policy.digest) {
      fail(`review receipt is not a zero-finding PASS: ${entry.lane}`);
    }
    receipts.push(receipt);
  }
  validateReviewSet(receipts);
  validateCallerDispatchSet(manifest.callerDispatchSet, receipts);
  await validateCurrentReviewOutputRoles({
    snapshot,
    snapshotPath,
    manifest,
  });

  const transitions = Array.isArray(policy.governanceTransitions)
    ? policy.governanceTransitions
    : [];
  if (transitions.length !== 4) {
    fail("runner v4 requires exactly four governance transitions");
  }
  if (options.transitionTargets.size !== transitions.length) {
    fail("caller must supply one staged target for every governance transition");
  }
  const preparedTransitions = [];
  for (const [index, transition] of transitions.entries()) {
    const targetPath = options.transitionTargets.get(transition.path);
    if (!targetPath) fail(`missing transition target mapping: ${transition.path}`);
    if (targetPath !== transition.stagedTargetPath) {
      fail(`transition target must equal the policy stagedTargetPath: ${transition.path}`);
    }
    const original = await captureRepositoryFile(
      transition.path,
      `governance transition source ${transition.path}`,
    );
    const target = await captureRepositoryFile(
      targetPath,
      `governance transition target ${targetPath}`,
    );
    if (original.digest !== transition.fromSha256
      || target.digest !== transition.toSha256) {
      fail(`governance transition hash is stale: ${transition.path}`);
    }
    preparedTransitions.push({
      order: index,
      path: transition.path,
      kind: transition.kind,
      stagedTargetPath: transition.stagedTargetPath,
      original: identityRecord(original),
      target: payloadRecord(target.bytes, original.mode),
    });
  }

  const originalTree = await captureRepositoryTree(repositoryRealpath);
  const repositoryIdentity = await captureRepositoryIdentity("repository control root");
  for (const transition of preparedTransitions) {
    const controlled = originalTree.get(transition.path);
    if (!controlled || controlled.digest !== transition.original.sha256) {
      fail(`governance transition source changed before control capture: ${transition.path}`);
    }
    transition.original = identityRecord(controlled);
    transition.target.mode = controlled.mode;
  }
  const controlledSnapshot = originalTree.get(snapshotPath);
  const controlledManifest = originalTree.get(options.pendingManifest);
  if (!controlledSnapshot || controlledSnapshot.digest !== snapshotCapture.digest
    || !controlledManifest || controlledManifest.digest !== manifestCapture.digest) {
    fail("snapshot or pending manifest changed before control capture");
  }
  const stagedTree = new Map(originalTree);
  for (const transition of preparedTransitions) {
    stagedTree.set(transition.path, {
      ...stagedTree.get(transition.path),
      bytes: decodePayload(transition.target),
      digest: transition.target.sha256,
      mode: transition.target.mode,
    });
  }
  const controlSet = controlSetRecord(originalTree);
  const candidateResults = await executeCandidatesInStage({
    stagedTree,
    policy,
    baseAnchor,
    snapshot,
  });
  await assertRepositoryTreeUnchanged(originalTree, "pre-journal postflight");
  await assertRepositoryIdentity(repositoryIdentity, "pre-journal postflight");

  const completedAt = new Date().toISOString();
  const validatorDigest = policy.continuationExecutables?.find(
    (entry) => entry.kind === "checker",
  )?.sha256;
  if (!sha256Digest(validatorDigest)) fail("policy checker digest is unavailable");
  const receiptReferences = REQUIRED_LANES.map((lane) => {
    const receipt = receipts.find((candidate) => candidate.lane === lane);
    return {
      lane,
      canonicalDigest: hashCanonical(receipt),
      challenge: receipt.challenge,
    };
  });
  const attestation = withDigest({
    schemaVersion: 4,
    kind: ATTESTATION_KIND,
    status: "passed",
    governancePhase: "review_post_transition",
    identityAssurance: "not-signed",
    reviewAssurance: "caller-attested-not-signed",
    repositoryRealpath,
    completedAt,
    parentEvidenceBundleDigest: policy.parentEvidence.bundleDigest,
    pendingManifestDigest: manifest.pendingManifestDigest,
    policyDigest: policy.digest,
    snapshotDigest: snapshot.digest,
    round3ReviewRejectionDigest: policy.round3ReviewRejection.digest,
    validatorDigest,
    runnerDigest: selfCapture.digest,
    callerDispatchSet: manifest.callerDispatchSet,
    candidateResults,
  });
  const finalManifest = withDigest({
    ...withoutDigest(manifest),
    status: "externally_attested",
    externalAttestation: {
      path: manifest.externalAttestation.path,
      canonicalDigest: attestation.digest,
    },
  });
  const anchor = withDigest({
    schemaVersion: 4,
    kind: ANCHOR_KIND,
    identityAssurance: "not-signed",
    reviewAssurance: "caller-attested-not-signed",
    repositoryRealpath,
    completedAt,
    parentEvidenceBundleDigest: policy.parentEvidence.bundleDigest,
    policyDigest: policy.digest,
    snapshotDigest: snapshot.digest,
    round3ReviewRejectionDigest: policy.round3ReviewRejection.digest,
    validatorDigest,
    runnerDigest: selfCapture.digest,
    attestationDigest: attestation.digest,
    callerDispatchSet: manifest.callerDispatchSet,
    head: {
      kind: "successor-admission",
      status: "externally_attested",
      workstreamId: manifest.workstreamId,
      featureId: manifest.featureId,
      snapshotDigest: snapshot.digest,
      successorWorkstreamDefinitionDigest:
        policy.successor.workstreamDefinitionDigest,
      successorFeatureDefinitionDigest: policy.successor.featureDefinitionDigest,
    },
  });
  validateGeneratedEvidence({ attestation, finalManifest, anchor, manifest, policy, snapshot });

  const attestationPath = manifest.externalAttestation?.path;
  if (!repositoryPath(attestationPath)) fail("attestation path is invalid");
  const attestationParent = await captureAbsoluteParentIdentity(
    path.join(repositoryRealpath, attestationPath),
    "attestation parent",
  );
  const manifestParent = await captureAbsoluteParentIdentity(
    path.join(repositoryRealpath, options.pendingManifest),
    "manifest parent",
  );
  const anchorParent = await captureAbsoluteParentIdentity(
    options.externalAnchorOutput,
    "anchor parent",
  );
  const publications = [
    {
      order: 0,
      scope: "repository",
      kind: "attestation",
      path: attestationPath,
      original: null,
      target: payloadRecord(prettyJsonBytes(attestation), 0o600),
      parentIdentityDigest: hashCanonical(attestationParent.entries),
    },
    {
      order: 1,
      scope: "repository",
      kind: "manifest",
      path: options.pendingManifest,
      original: identityRecord(controlledManifest),
      target: payloadRecord(prettyJsonBytes(finalManifest), 0o600),
      parentIdentityDigest: hashCanonical(manifestParent.entries),
    },
    {
      order: 2,
      scope: "external",
      kind: "anchor",
      path: options.externalAnchorOutput,
      original: null,
      target: payloadRecord(prettyJsonBytes(anchor), 0o600),
      parentIdentityDigest: hashCanonical(anchorParent.entries),
    },
  ];
  const transactionWithoutDigest = {
    schemaVersion: 4,
    kind: JOURNAL_KIND,
    status: "prepared",
    algorithm: "sha256-canonical-json-v1",
    transactionId: hashCanonical({
      repositoryRealpath,
      policyDigest: policy.digest,
      snapshotDigest: snapshot.digest,
      pendingManifestDigest: manifest.digest,
      pendingManifestStateDigest: manifest.pendingManifestDigest,
      receiptReferences,
      baselineArchiveDigest: archive.digest,
      snapshotByteSha256: snapshotCapture.digest,
    }),
    preparedAt: completedAt,
    repository: repositoryIdentity,
    runner: {
      sha256: selfCapture.digest,
      nodeExecPath: process.execPath,
      nodeExecRealpath,
      nodeExecSha256: nodeCapture.digest,
    },
    callerPins: {
      baseAnchorPath: options.baseAnchor,
      baseAnchorDigest: baseAnchor.digest,
      policyDigest: policy.digest,
      snapshotDigest: snapshot.digest,
      snapshotByteSha256: snapshotCapture.digest,
      baselineArchiveDigest: archive.digest,
      baselineArchivePath: policy.baselineArchive.path,
      pendingManifestPath: options.pendingManifest,
      pendingManifestDigest: manifest.digest,
      receipts: REQUIRED_LANES.map((lane) => ({
        lane,
        digest: options.receiptDigests.get(lane),
        challenge: options.challenges.get(lane),
      })),
      anchorOutputPath: options.externalAnchorOutput,
      journalOutputPath: options.journalOutput,
      timeoutMs: options.timeoutMs,
    },
    baselineArchive: {
      path: policy.baselineArchive.path,
      digest: archive.digest,
      entrySetDigest: archive.entrySetDigest,
      entries: [...archive.decodedEntries.values()].map((entry) => ({
        path: entry.path,
        source: entry.source,
        sha256: entry.sha256,
      })),
    },
    reviewSnapshot: {
      path: snapshotPath,
      canonicalDigest: snapshot.digest,
      sourceIdentity: identityRecord(controlledSnapshot),
      bytes: payloadRecord(snapshotCapture.bytes, controlledSnapshot.mode),
    },
    pendingManifest: {
      path: options.pendingManifest,
      sourceIdentity: identityRecord(controlledManifest),
      bytes: payloadRecord(manifestCapture.bytes, controlledManifest.mode),
    },
    controlSet,
    candidateResults,
    governanceTransitions: preparedTransitions,
    publications,
    finalSetDigest: hashCanonical({
      transitions: preparedTransitions.map((entry) => [entry.path, entry.target.sha256]),
      publications: publications.map((entry) => [entry.kind, entry.target.sha256]),
    }),
  };
  return { ...transactionWithoutDigest, digest: hashCanonical(transactionWithoutDigest) };
}

async function captureAndValidateBaselineArchive(policy) {
  const reference = policy.baselineArchive;
  if (!exactKeys(reference, ["digest", "entrySetDigest", "path"])
    || reference.path !== BASELINE_ARCHIVE_PATH
    || reference.digest !== options.expectedBaselineArchiveDigest
    || !sha256Digest(reference.entrySetDigest)) {
    fail("continuation policy baseline archive reference is stale");
  }
  const capture = await captureRepositoryFile(
    reference.path,
    "baseline archive",
    { requirePrivate: true },
  );
  const archive = parseJson(capture.bytes, "baseline archive");
  validateCanonicalObject(archive, "baseline archive");
  if (!Array.isArray(archive.entries) || archive.entries.length === 0) {
    fail("baseline archive entries must be non-empty");
  }
  if (!exactKeys(archive, ARCHIVE_KEYS)
    || archive.schemaVersion !== 4
    || archive.kind !== "conversation-disclosure-continuation-baseline-archive"
    || archive.algorithm !== "sha256-canonical-json-v1"
    || archive.round !== 4
    || archive.programId !== policy.programId
    || archive.workstreamId !== policy.workstreamId
    || archive.featureId !== policy.featureId
    || archive.digest !== reference.digest
    || archive.entrySetDigest !== reference.entrySetDigest
    || archive.entrySetDigest !== hashCanonical(archive.entries)) {
    fail("baseline archive identity/digest binding is stale");
  }
  const decodedEntries = new Map();
  const actualCoverage = [];
  let previousPath = "";
  for (const [index, entry] of archive.entries.entries()) {
    if (!exactKeys(entry, ARCHIVE_ENTRY_KEYS)
      || !repositoryPath(entry.path)
      || !["round23_review_snapshot", "cd03a_review_snapshot",
        "governance_transition"].includes(entry.source)
      || !sha256Digest(entry.sha256)
      || entry.encoding !== "gzip-base64-v1"
      || typeof entry.bytes !== "string"
      || (index > 0 && entry.path.localeCompare(previousPath) <= 0)) {
      fail(`baseline archive entry is invalid or unsorted: ${index}`);
    }
    previousPath = entry.path;
    let decoded;
    try {
      const compressed = Buffer.from(entry.bytes, "base64");
      if (compressed.toString("base64") !== entry.bytes) throw new Error("base64");
      decoded = gunzipSync(compressed);
      if (gzipSync(decoded, { level: 9, mtime: 0 }).toString("base64") !== entry.bytes) {
        throw new Error("non-deterministic gzip");
      }
    } catch {
      fail(`baseline archive entry is not deterministic gzip-base64: ${entry.path}`);
    }
    if (sha256Bytes(decoded) !== entry.sha256) {
      fail(`baseline archive decoded hash is stale: ${entry.path}`);
    }
    decodedEntries.set(entry.path, {
      path: entry.path,
      source: entry.source,
      sha256: entry.sha256,
      bytes: decoded,
    });
    actualCoverage.push({ path: entry.path, source: entry.source, sha256: entry.sha256 });
  }
  const expectedCoverage = [];
  for (const authority of policy.pathAuthorities ?? []) {
    if (authority.class === "modify") {
      expectedCoverage.push({
        path: authority.path,
        source: authority.baseline?.source,
        sha256: authority.baseline?.sha256,
      });
    }
  }
  for (const transition of policy.governanceTransitions ?? []) {
    expectedCoverage.push({
      path: transition.path,
      source: "governance_transition",
      sha256: transition.fromSha256,
    });
  }
  expectedCoverage.sort((left, right) => left.path.localeCompare(right.path));
  if (canonicalJson(actualCoverage) !== canonicalJson(expectedCoverage)) {
    fail("baseline archive coverage differs from modify/transition authorities");
  }
  return { ...archive, decodedEntries };
}

function validateAdmissionCoverage(policy) {
  const coverage = policy.admissionCoverage;
  const allowedClasses = new Set(ADMISSION_CLASSES);
  if (!Array.isArray(coverage) || coverage.length === 0
    || canonicalJson(policy.admissionClassSet) !== canonicalJson(ADMISSION_CLASSES)
    || policy.admissionClassSetDigest !== hashCanonical(ADMISSION_CLASSES)
    || policy.admission?.reviewCoverageDigest !== hashCanonical(coverage)
    || canonicalJson(coverage.map((entry) => entry.path).sort())
      !== canonicalJson([...policy.admission.featureDefinition.files].sort())) {
    fail("continuation policy admissionCoverage digest binding is stale");
  }
  let previousPath = "";
  const indexed = new Map();
  for (const [index, entry] of coverage.entries()) {
    if (!exactKeys(entry, ["class", "path"])
      || !allowedClasses.has(entry.class)
      || !repositoryPath(entry.path)
      || (index > 0 && entry.path.localeCompare(previousPath) <= 0)) {
      fail(`continuation policy admissionCoverage entry is invalid or unsorted: ${index}`);
    }
    previousPath = entry.path;
    if (indexed.has(entry.path)) {
      fail(`continuation policy admissionCoverage path is duplicated: ${entry.path}`);
    }
    indexed.set(entry.path, entry.class);
  }
  for (const requiredClass of ADMISSION_CLASSES) {
    if (![...indexed.values()].includes(requiredClass)) {
      fail(`continuation policy admissionCoverage omits class: ${requiredClass}`);
    }
  }
  for (const transition of policy.governanceTransitions ?? []) {
    if (indexed.get(transition.path) !== "transition_live"
      || indexed.get(transition.stagedTargetPath) !== "transition_payload") {
      fail(`continuation policy admissionCoverage omits a transition pair: ${transition.path}`);
    }
  }
}

async function captureAndValidateRound3ReviewRejection(policy) {
  const embedded = policy.round3ReviewRejection;
  const capture = await captureRepositoryFile(
    ROUND3_REVIEW_REJECTION_PATH,
    "Round3 review-rejection witness",
    { requirePrivate: true },
  );
  const rejection = parseJson(capture.bytes, "Round3 review-rejection witness");
  validateCanonicalObject(rejection, "Round3 review-rejection witness");
  if (canonicalJson(rejection) !== canonicalJson(embedded)) {
    fail("continuation policy Round3 review-rejection binding is stale");
  }
  await validateRound3ReviewRejection(rejection, policy);
}

async function validateRound3ReviewRejection(rejection, policy) {
  const expectedKeys = [
    "aggregateFindingCounts", "algorithm", "digest", "externalAnchorRule",
    "failedReceipts", "featureId", "findingIds", "findingSetDigest", "kind",
    "priorRejections", "programId", "recoveryRound", "rejectedRound",
    "repositoryForbiddenOutputs", "schemaVersion", "sourcePolicy",
    "sourceSnapshot", "status", "workstreamId",
  ];
  if (!exactKeys(rejection, expectedKeys)
    || rejection.schemaVersion !== 4
    || rejection.kind !== "conversation-disclosure-continuation-review-rejection"
    || rejection.algorithm !== "sha256-canonical-json-v1"
    || rejection.programId !== policy.programId
    || rejection.workstreamId !== policy.workstreamId
    || rejection.featureId !== policy.featureId
    || rejection.recoveryRound !== 4
    || rejection.rejectedRound !== 3
    || rejection.status !== "rejected_after_review"
    || canonicalJson(rejection.sourcePolicy) !== canonicalJson(ROUND3_POLICY_ROOT)
    || canonicalJson(rejection.sourceSnapshot)
      !== canonicalJson({
        ...ROUND3_SNAPSHOT_ROOT,
        frozenFileCount: 58,
        transitionPayloadFileCount: 4,
        baselineFileCount: 12,
      })
    || canonicalJson(rejection.findingIds) !== canonicalJson(ROUND3_FINDING_IDS)
    || rejection.findingSetDigest !== ROUND3_FINDING_SET_DIGEST
    || !Array.isArray(rejection.failedReceipts)
    || rejection.failedReceipts.length !== 3) {
    fail("Round3 review-rejection schema or lifecycle binding is stale");
  }
  for (const expected of [
    ROUND3_POLICY_ROOT,
    ROUND3_SNAPSHOT_ROOT,
    ...ROUND3_RECEIPT_ROOTS,
  ]) {
    const current = await captureRepositoryFile(
      expected.path,
      `Round3 rejection source ${expected.path}`,
      { requirePrivate: expected === ROUND3_POLICY_ROOT
        || expected === ROUND3_SNAPSHOT_ROOT },
    );
    if (current.digest !== expected.byteSha256) {
      fail(`Round3 rejection source bytes drifted: ${expected.path}`);
    }
    const value = parseJson(current.bytes, `Round3 rejection source ${expected.path}`);
    const canonicalDigest = value.digest ?? hashCanonical(value);
    if (canonicalDigest !== expected.canonicalDigest) {
      fail(`Round3 rejection source canonical digest drifted: ${expected.path}`);
    }
  }
  for (let index = 0; index < ROUND3_RECEIPT_ROOTS.length; index += 1) {
    const actual = rejection.failedReceipts[index];
    const expected = ROUND3_RECEIPT_ROOTS[index];
    if (actual?.lane !== expected.lane
      || actual?.path !== expected.path
      || actual?.byteSha256 !== expected.byteSha256
      || actual?.canonicalDigest !== expected.canonicalDigest) {
      fail(`Round3 rejection receipt root is stale: ${expected.lane}`);
    }
  }
  for (const relativePath of rejection.repositoryForbiddenOutputs ?? []) {
    if (await repositoryEntryExists(repositoryRealpath, relativePath)) {
      fail(`Round3 forbidden repository output exists: ${relativePath}`);
    }
  }
}

async function validateSnapshotTransitionPayloadFiles(snapshot, policy) {
  const expected = (policy.governanceTransitions ?? []).map((transition) => ({
    path: transition.stagedTargetPath,
    sha256: transition.toSha256,
  })).sort((left, right) => left.path.localeCompare(right.path));
  const actual = snapshot.transitionPayloadFiles;
  if (!Array.isArray(actual) || actual.length !== 4
    || canonicalJson(actual) !== canonicalJson(expected)) {
    fail("snapshot transitionPayloadFiles differ from policy transition payloads");
  }
  const forbiddenCategories = [
    ...(snapshot.frozenFiles ?? []).map((entry) => entry.path),
    ...(snapshot.baselineFiles ?? []).map((entry) => entry.path),
    ...(snapshot.absentPaths ?? []),
    ...(snapshot.reviewOutputAbsentPaths ?? []),
  ];
  const forbidden = new Set(forbiddenCategories);
  for (const [index, entry] of actual.entries()) {
    if (!exactKeys(entry, ["path", "sha256"])
      || !repositoryPath(entry.path)
      || !sha256Digest(entry.sha256)
      || (index > 0
        && entry.path.localeCompare(actual[index - 1].path) <= 0)
      || forbidden.has(entry.path)) {
      fail(`snapshot transition payload entry is invalid or overlaps another category: ${index}`);
    }
    const capture = await captureRepositoryFile(
      entry.path,
      `snapshot transition payload ${entry.path}`,
    );
    if (capture.digest !== entry.sha256) {
      fail(`snapshot transition payload hash drift: ${entry.path}`);
    }
  }
}

function validateSnapshotReviewOutputCategories(snapshot, policy) {
  validateSnapshotReviewOutputPathArray(snapshot);
  const reviewOutputs = snapshot.reviewOutputAbsentPaths;
  const policyOutputs = policy.admission?.reviewOutputPaths;
  if (!Array.isArray(policyOutputs)
    || policyOutputs.some((entry) => !repositoryPath(entry))
    || new Set(policyOutputs).size !== policyOutputs.length
    || canonicalJson([...policyOutputs].sort()) !== canonicalJson(reviewOutputs)) {
    fail("snapshot reviewOutputAbsentPaths differ from policy admission outputs");
  }
}

function validateSnapshotReviewOutputPathArray(snapshot) {
  const reviewOutputs = snapshot.reviewOutputAbsentPaths;
  if (!Array.isArray(reviewOutputs)
    || reviewOutputs.some((entry) => !repositoryPath(entry))
    || new Set(reviewOutputs).size !== reviewOutputs.length
    || reviewOutputs.some((entry, index) =>
      index > 0 && entry.localeCompare(reviewOutputs[index - 1]) <= 0)) {
    fail("snapshot reviewOutputAbsentPaths must be sorted unique repository paths");
  }
  const frozen = new Set((snapshot.frozenFiles ?? []).map((entry) => entry.path));
  const baseline = new Set((snapshot.baselineFiles ?? []).map((entry) => entry.path));
  const absent = new Set(snapshot.absentPaths ?? []);
  for (const relativePath of reviewOutputs) {
    if (frozen.has(relativePath) || baseline.has(relativePath) || absent.has(relativePath)) {
      fail(`snapshot review output overlaps another category: ${relativePath}`);
    }
  }
}

async function validateCurrentReviewOutputRoles({ snapshot, snapshotPath, manifest }) {
  const receiptPaths = (manifest.reviewReceipts ?? []).map((entry) => entry.path);
  const externalAttestationPath = manifest.externalAttestation?.path;
  if (!repositoryPath(externalAttestationPath)
    || new Set(receiptPaths).size !== receiptPaths.length
    || receiptPaths.some((entry) => !repositoryPath(entry))
    || receiptPaths.includes(options.pendingManifest)
    || receiptPaths.includes(snapshotPath)
    || [options.pendingManifest, snapshotPath].includes(externalAttestationPath)
    || receiptPaths.includes(externalAttestationPath)) {
    fail("review evidence output roles overlap or contain invalid paths");
  }
  const knownRoles = new Set([
    snapshotPath,
    options.pendingManifest,
    externalAttestationPath,
    ...receiptPaths,
  ]);
  for (const relativePath of snapshot.reviewOutputAbsentPaths) {
    if (!knownRoles.has(relativePath)) {
      fail(`snapshot contains an unknown review output role: ${relativePath}`);
    }
  }
  if (await repositoryEntryExists(repositoryRealpath, externalAttestationPath)) {
    fail("external attestation must remain absent before prepared journal publication");
  }
}

async function convergePreparedTransaction(journal, { skipFaults }) {
  await validateRepositoryControlState(journal, {
    label: "prepared transaction preflight",
  });
  for (const [index, transition] of journal.governanceTransitions.entries()) {
    const requestedFault = skipFaults
      ? ""
      : process.env.ZEROX_CD03A_RUNNER_V4_TEST_FAULT ?? "";
    const fault = requestedFault === `partial-transition-${index + 1}`
      ? "partial-write"
      : requestedFault === `commit-transition-${index + 1}`
        ? "after-target-rename"
        : "none";
    await convergeRepositoryFile({
      relativePath: transition.path,
      original: transition.original,
      targetBytes: decodePayload(transition.target),
      targetMode: transition.target.mode,
      label: `governance transition ${transition.path}`,
      bridgeFault: fault,
    });
    if (fault !== "none") fail(`injected runner v4 fault: ${requestedFault}`);
    await validateRepositoryControlState(journal, {
      label: `governance transition ${index + 1} postflight`,
    });
    if (!skipFaults) injectFault(`after-transition-${index + 1}`);
  }
  for (const publication of journal.publications) {
    const absolutePath = publication.scope === "repository"
      ? path.join(repositoryRealpath, publication.path)
      : publication.path;
    const requestedFault = skipFaults
      ? ""
      : process.env.ZEROX_CD03A_RUNNER_V4_TEST_FAULT ?? "";
    const bridgeFault = requestedFault === `commit-${publication.kind}`
      ? "after-target-rename"
      : "none";
    await convergeAbsoluteFile({
      absolutePath,
      original: publication.original,
      targetBytes: decodePayload(publication.target),
      targetMode: publication.target.mode,
      label: `${publication.kind} publication`,
      bridgeFault,
    });
    if (bridgeFault !== "none") fail(`injected runner v4 fault: ${requestedFault}`);
    await validateRepositoryControlState(journal, {
      label: `${publication.kind} publication postflight`,
    });
    if (!skipFaults) injectFault(`after-${publication.kind}`);
  }
  await validateCompletedState(journal);
}

async function completeTransaction(journal, journalBytes) {
  const currentJournal = await captureAbsoluteFile(
    options.journalOutput,
    "prepared transaction journal",
    { requirePrivate: true },
  );
  if (!currentJournal.bytes.equals(journalBytes)) fail("journal changed before completion");
  const completedMarkerPath = completedMarkerPathFor(journal, currentJournal);
  const markerSet = await captureCompletedMarkers(options.journalOutput);
  if (markerSet.length > 1
    || (markerSet.length === 1 && markerSet[0].absolutePath !== completedMarkerPath)) {
    fail("completed marker set is ambiguous before publication");
  }
  await convergeAbsoluteFile({
    absolutePath: completedMarkerPath,
    original: markerSet[0] ? identityRecord(markerSet[0]) : null,
    targetBytes: journalBytes,
    targetMode: 0o600,
    label: "completed transaction marker",
  });
  injectFault("after-completed-marker");
  const journalBeforeRetirement = await captureOptionalAbsoluteFile(
    options.journalOutput,
    "prepared transaction journal",
    { requirePrivate: true },
  );
  if (journalBeforeRetirement) {
    if (!journalBeforeRetirement.bytes.equals(journalBytes)
      || journalBeforeRetirement.dev !== currentJournal.dev
      || journalBeforeRetirement.ino !== currentJournal.ino) {
      fail("journal changed identity before retirement");
    }
    await retireExactFile(
      options.journalOutput,
      journalBeforeRetirement.digest,
      "prepared journal",
    );
  }
  const marker = await captureAbsoluteFile(completedMarkerPath, "completed marker", {
    requirePrivate: true,
  });
  if (!marker.bytes.equals(journalBytes)) fail("completed marker bytes are stale");
  validateCompletedMarkerIdentity({ ...marker, absolutePath: completedMarkerPath }, journal, null);
  await validateCompletedState(journal);
}

function completedMarkerPathFor(journal, journalCapture) {
  return `${options.journalOutput}.completed-${journal.digest.slice(7)}-${
    journalCapture.dev}-${journalCapture.ino}.marker`;
}

async function captureCompletedMarkers(journalPath) {
  const parentCapture = await captureAbsoluteParentIdentity(
    journalPath,
    "completed marker directory",
  );
  const prefix = `${path.basename(journalPath)}.completed-`;
  const names = (await readdir(parentCapture.parentPath))
    .filter((entry) => entry.startsWith(prefix) && entry.endsWith(".marker"))
    .sort();
  await assertParentIdentity(parentCapture, "completed marker directory");
  const captures = [];
  for (const name of names) {
    if (!/^.+\.completed-[0-9a-f]{64}-[0-9]+-[0-9]+\.marker$/.test(name)) {
      fail("completed marker filename is malformed");
    }
    const absolutePath = path.join(parentCapture.parentPath, name);
    const capture = await captureAbsoluteFile(absolutePath, "completed transaction marker", {
      requirePrivate: true,
    });
    captures.push({ ...capture, absolutePath });
  }
  return captures;
}

function validateCompletedMarkerIdentity(marker, journal, existingJournalCapture) {
  const name = path.basename(marker.absolutePath);
  const prefix = `${path.basename(options.journalOutput)}.completed-`;
  const identity = name.slice(prefix.length, -".marker".length).split("-");
  if (identity.length !== 3
    || `sha256:${identity[0]}` !== journal.digest
    || !/^\d+$/.test(identity[1])
    || !/^\d+$/.test(identity[2])) {
    fail("completed marker does not bind the journal digest/dev/ino");
  }
  if (existingJournalCapture
    && (String(existingJournalCapture.dev) !== identity[1]
      || String(existingJournalCapture.ino) !== identity[2])) {
    fail("completed marker does not bind the live prepared journal identity");
  }
}

async function validateCompletedState(journal) {
  await validateRepositoryControlState(journal, {
    label: "completed transaction control set",
    completed: true,
    allowRecoveryArtifacts: false,
  });
  for (const transition of journal.governanceTransitions) {
    const capture = await captureRepositoryFile(
      transition.path,
      `completed transition ${transition.path}`,
    );
    if (capture.digest !== transition.target.sha256) {
      fail(`completed transition bytes are stale: ${transition.path}`);
    }
  }
  for (const publication of journal.publications) {
    const absolutePath = publication.scope === "repository"
      ? path.join(repositoryRealpath, publication.path)
      : publication.path;
    const capture = await captureAbsoluteFile(
      absolutePath,
      `completed ${publication.kind}`,
      { requirePrivate: true },
    );
    if (capture.digest !== publication.target.sha256) {
      fail(`completed publication bytes are stale: ${publication.kind}`);
    }
  }
}

async function executeCandidatesInStage({ stagedTree, policy, baseAnchor, snapshot }) {
  const stageRoot = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "zerox-cd03a-v4-stage-")),
  );
  const controlRoot = path.join(stageRoot, "repo");
  const childHome = path.join(stageRoot, "home");
  const childTmp = path.join(stageRoot, "tmp");
  try {
    await mkdir(controlRoot, { recursive: true, mode: 0o700 });
    await mkdir(childHome, { mode: 0o700 });
    await mkdir(childTmp, { mode: 0o700 });
    for (const [relativePath, capture] of stagedTree) {
      const target = path.join(controlRoot, relativePath);
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      const handle = await open(
        target,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        capture.mode ?? 0o600,
      );
      try {
        await handle.writeFile(capture.bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
    }
    const stagedBefore = await captureRepositoryTree(controlRoot);
    assertTreeDigests(stagedTree, stagedBefore, "staged pre-execution");
    const checkerPath = policy.continuationExecutables?.find(
      (entry) => entry.kind === "checker",
    )?.path;
    const harnessPath = "scripts/check-harness-state.mjs";
    const commonArgs = [
      "--mode", "review_post_transition",
      "--control-root", controlRoot,
      "--subject-repository-realpath", repositoryRealpath,
      "--base-anchor", options.baseAnchor,
      "--expected-base-anchor-digest", baseAnchor.digest,
      "--expected-policy-digest", policy.digest,
      "--expected-snapshot-digest", snapshot.digest,
    ];
    const results = [];
    for (const [kind, relativePath] of [["checker", checkerPath], ["harness", harnessPath]]) {
      if (!repositoryPath(relativePath) || !stagedTree.has(relativePath)) {
        fail(`${kind} candidate is absent from the staged control tree`);
      }
      const execution = await runNodeCandidate(
        path.join(controlRoot, relativePath),
        commonArgs,
        controlRoot,
        childHome,
        childTmp,
      );
      const lastLine = execution.stdout.split(/\r?\n/).filter(Boolean).at(-1);
      const receipt = (() => { try { return JSON.parse(lastLine); } catch { return null; } })();
      const receiptKind = kind === "checker"
        ? "cd03a-continuation-checker-v4-receipt"
        : "cd03a-continuation-harness-v4-receipt";
      if (!receipt || receipt.kind !== receiptKind || receipt.status !== "passed"
        || receipt.policyDigest !== policy.digest
        || receipt.snapshotDigest !== snapshot.digest) {
        fail(`${kind} candidate omitted its digest-bound receipt`);
      }
      if (receipt.digest !== undefined) validateCanonicalObject(receipt, `${kind} candidate receipt`);
      results.push({
        kind,
        path: relativePath,
        status: "passed",
        receiptDigest: receipt.digest ?? hashCanonical(receipt),
        stdoutDigest: sha256Bytes(Buffer.from(execution.stdout, "utf8")),
        stderrDigest: sha256Bytes(Buffer.from(execution.stderr, "utf8")),
      });
    }
    const stagedAfter = await captureRepositoryTree(controlRoot);
    assertTreeDigests(stagedBefore, stagedAfter, "staged post-execution");
    return results;
  } finally {
    await removeValidatedStageRoot(stageRoot, controlRoot);
  }
}

async function runNodeCandidate(scriptPath, args, cwd, childHome, childTmp) {
  try {
    return await execFile(process.execPath, [scriptPath, ...args], {
      cwd,
      encoding: "utf8",
      env: {
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
        HOME: childHome,
        TMPDIR: childTmp,
        LANG: "C",
        LC_ALL: "C",
        TZ: "UTC",
        NODE_OPTIONS: "",
      },
      timeout: options.timeoutMs,
      killSignal: "SIGKILL",
      maxBuffer: MAX_OUTPUT_BYTES,
    });
  } catch (error) {
    fail(`candidate process failed: ${safeProcessError(error)}`);
  }
}

async function removeValidatedStageRoot(stageRoot, controlRoot) {
  const temporaryRoot = await realpath(os.tmpdir());
  const stageRealpath = await realpath(stageRoot);
  const stageStat = await lstat(stageRealpath);
  if (path.dirname(stageRealpath) !== temporaryRoot
    || !path.basename(stageRealpath).startsWith("zerox-cd03a-v4-stage-")
    || !stageStat.isDirectory()
    || stageStat.isSymbolicLink()
    || stageStat.uid !== process.geteuid()
    || (stageStat.mode & 0o077) !== 0
    || pathIsWithin(repositoryRealpath, stageRealpath)
    || pathIsWithin(stageRealpath, repositoryRealpath)
    || pathIsWithin(stageRealpath, options.externalAnchorOutput)
    || pathIsWithin(stageRealpath, options.journalOutput)
    || !pathIsWithin(stageRealpath, path.resolve(controlRoot))) {
    fail("refusing to remove an unvalidated staged control tree");
  }
  await rm(stageRealpath, { recursive: true, force: false });
}

async function captureRepositoryTree(root) {
  const result = new Map();
  const excluded = new Set([
    ".git",
    "node_modules",
    "dist",
    "dist-electron",
    "release",
  ]);
  async function walk(relativeDirectory) {
    const absoluteDirectory = path.join(root, relativeDirectory);
    const entries = await readdir(absoluteDirectory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = relativeDirectory
        ? path.posix.join(relativeDirectory.split(path.sep).join(path.posix.sep), entry.name)
        : entry.name;
      if (!relativeDirectory && (excluded.has(entry.name) || entry.name.startsWith("release-test-"))) {
        continue;
      }
      const absolutePath = path.join(root, relativePath);
      const entryStat = await lstat(absolutePath);
      if (entryStat.isSymbolicLink()) fail(`repository tree contains symlink: ${relativePath}`);
      if (entryStat.isDirectory()) {
        await walk(relativePath);
      } else if (entryStat.isFile()) {
        const capture = await captureAbsoluteFile(
          absolutePath,
          `repository control ${relativePath}`,
          { requirePrivate: false, expectedRoot: root },
        );
        result.set(relativePath.split(path.sep).join(path.posix.sep), capture);
      } else {
        fail(`repository tree contains unsupported entry: ${relativePath}`);
      }
    }
  }
  await walk("");
  return result;
}

async function repositoryEntryExists(root, relativePath) {
  if (!repositoryPath(relativePath)) fail("repository existence check path is invalid");
  try {
    const entry = await lstat(path.join(root, relativePath));
    if (entry.isSymbolicLink()) fail(`repository path is a symlink: ${relativePath}`);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function assertRepositoryTreeUnchanged(expected, label) {
  const actual = await captureRepositoryTree(repositoryRealpath);
  assertTreeDigests(expected, actual, label);
}

function assertTreeDigests(expected, actual, label) {
  if (expected.size !== actual.size) fail(`${label} inventory changed`);
  for (const [relativePath, before] of expected) {
    const after = actual.get(relativePath);
    if (!after || before.digest !== after.digest) fail(`${label} byte drift: ${relativePath}`);
  }
}

function controlSetRecord(tree) {
  const entries = [...tree].map(([relativePath, capture]) => ({
    path: relativePath,
    sha256: capture.digest,
    dev: capture.dev,
    ino: capture.ino,
    nlink: capture.nlink,
    uid: capture.uid,
    mode: capture.mode,
  })).sort((left, right) => left.path.localeCompare(right.path));
  const withoutDigest = {
    schemaVersion: 4,
    kind: CONTROL_SET_KIND,
    algorithm: "sha256-canonical-json-v1",
    entries,
  };
  return { ...withoutDigest, digest: hashCanonical(withoutDigest) };
}

async function captureRepositoryIdentity(label) {
  const entry = await lstat(repositoryRealpath);
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    fail(`${label} must remain one real directory`);
  }
  if (await realpath(repositoryRealpath) !== repositoryRealpath) {
    fail(`${label} realpath changed`);
  }
  return { realpath: repositoryRealpath, dev: entry.dev, ino: entry.ino };
}

async function assertRepositoryIdentity(expected, label) {
  if (!exactKeys(expected, ["dev", "ino", "realpath"])
    || expected.realpath !== repositoryRealpath
    || !Number.isInteger(expected.dev)
    || !Number.isInteger(expected.ino)) {
    fail(`${label} journal repository identity is invalid`);
  }
  const current = await captureRepositoryIdentity(label);
  if (current.dev !== expected.dev || current.ino !== expected.ino) {
    fail(`${label} repository identity changed`);
  }
}

function validateControlSetRecord(controlSet) {
  if (!exactKeys(controlSet, CONTROL_SET_KEYS)
    || controlSet.schemaVersion !== 4
    || controlSet.kind !== CONTROL_SET_KIND
    || controlSet.algorithm !== "sha256-canonical-json-v1"
    || !Array.isArray(controlSet.entries)
    || controlSet.entries.length === 0) {
    fail("prepared transaction journal controlSet schema is invalid");
  }
  let previousPath = "";
  for (const [index, entry] of controlSet.entries.entries()) {
    if (!exactKeys(entry, CONTROL_ENTRY_KEYS)
      || !repositoryPath(entry.path)
      || !sha256Digest(entry.sha256)
      || !Number.isInteger(entry.dev)
      || !Number.isInteger(entry.ino)
      || entry.nlink !== 1
      || !Number.isInteger(entry.uid)
      || !Number.isInteger(entry.mode)
      || entry.mode < 0
      || entry.mode > 0o777
      || (index > 0 && entry.path.localeCompare(previousPath) <= 0)) {
      fail(`prepared transaction journal controlSet entry is invalid: ${index}`);
    }
    previousPath = entry.path;
  }
  const withoutDigest = { ...controlSet };
  delete withoutDigest.digest;
  if (!sha256Digest(controlSet.digest)
    || controlSet.digest !== hashCanonical(withoutDigest)) {
    fail("prepared transaction journal controlSet digest is stale");
  }
}

function identityMatchesCapture(expected, capture) {
  return capture?.digest === expected.sha256
    && capture.dev === expected.dev
    && capture.ino === expected.ino
    && capture.nlink === expected.nlink
    && capture.uid === expected.uid
    && capture.mode === expected.mode;
}

function targetMatchesCapture(target, capture, expectedUid) {
  return capture?.digest === target.sha256
    && capture.nlink === 1
    && capture.uid === expectedUid
    && capture.mode === target.mode;
}

function recoveryArtifactPaths(relativePath, targetDigest) {
  const directory = path.posix.dirname(relativePath);
  const basename = path.posix.basename(relativePath);
  const names = [
    `.${basename}.${targetDigest.slice(7, 31)}.tmp`,
    `.${basename}.discard`,
  ];
  return names.map((name) => directory === "." ? name : path.posix.join(directory, name));
}

function repositoryTransactionSubjects(journal) {
  const subjects = new Map();
  for (const transition of journal.governanceTransitions) {
    subjects.set(transition.path, {
      kind: "transition",
      original: transition.original,
      target: transition.target,
    });
  }
  for (const publication of journal.publications) {
    if (publication.scope !== "repository") continue;
    subjects.set(publication.path, {
      kind: "publication",
      original: publication.original,
      target: publication.target,
    });
  }
  return subjects;
}

async function validateRepositoryControlState(
  journal,
  { label, completed = false, allowRecoveryArtifacts = true } = {},
) {
  validateControlSetRecord(journal.controlSet);
  await assertRepositoryIdentity(journal.repository, label);
  const actualTree = await captureRepositoryTree(repositoryRealpath);
  const controlEntries = new Map(
    journal.controlSet.entries.map((entry) => [entry.path, entry]),
  );
  const subjects = repositoryTransactionSubjects(journal);
  const recoveryOwners = new Map();
  for (const [relativePath, subject] of subjects) {
    for (const artifactPath of recoveryArtifactPaths(relativePath, subject.target.sha256)) {
      recoveryOwners.set(artifactPath, relativePath);
    }
  }

  for (const relativePath of actualTree.keys()) {
    if (controlEntries.has(relativePath)) continue;
    const createdSubject = subjects.get(relativePath);
    if (createdSubject?.original === null) continue;
    if (!completed && allowRecoveryArtifacts && recoveryOwners.has(relativePath)) continue;
    fail(`${label} repository contains an unauthorized added path: ${relativePath}`);
  }

  for (const [relativePath, expected] of controlEntries) {
    const capture = actualTree.get(relativePath);
    const subject = subjects.get(relativePath);
    if (!subject) {
      if (!identityMatchesCapture(expected, capture)) {
        fail(`${label} non-transaction control drift: ${relativePath}`);
      }
      continue;
    }
    const targetUid = subject.original?.uid ?? process.geteuid();
    if (completed) {
      if (!targetMatchesCapture(subject.target, capture, targetUid)) {
        fail(`${label} completed transaction target drift: ${relativePath}`);
      }
      continue;
    }
    if (identityMatchesCapture(expected, capture)
      || targetMatchesCapture(subject.target, capture, targetUid)) {
      continue;
    }
    const hasRecoveryArtifact = recoveryArtifactPaths(
      relativePath,
      subject.target.sha256,
    ).some((artifactPath) => actualTree.has(artifactPath));
    if (!capture && allowRecoveryArtifacts && hasRecoveryArtifact) continue;
    fail(`${label} transaction path contains third-state bytes: ${relativePath}`);
  }

  for (const [relativePath, subject] of subjects) {
    if (subject.original !== null) continue;
    const capture = actualTree.get(relativePath);
    if (!capture) {
      if (!completed) continue;
      fail(`${label} completed created publication is absent: ${relativePath}`);
    }
    if (!targetMatchesCapture(subject.target, capture, process.geteuid())) {
      fail(`${label} created publication drift: ${relativePath}`);
    }
  }
  if (completed) {
    for (const artifactPath of recoveryOwners.keys()) {
      if (actualTree.has(artifactPath)) {
        fail(`${label} completed transaction retains recovery artifact: ${artifactPath}`);
      }
    }
  }
  await assertRepositoryIdentity(journal.repository, `${label} postflight`);
}

async function captureRepositoryFile(relativePath, label, captureOptions = {}) {
  if (!repositoryPath(relativePath)) fail(`${label} path must be repository-relative`);
  return captureAbsoluteFile(path.join(repositoryRealpath, relativePath), label, {
    requirePrivate: false,
    expectedRoot: repositoryRealpath,
    ...captureOptions,
  });
}

async function captureOptionalAbsoluteFile(absolutePath, label, optionsForCapture = {}) {
  try {
    await lstat(absolutePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  return captureAbsoluteFile(absolutePath, label, optionsForCapture);
}

async function captureAbsoluteFile(
  absolutePath,
  label,
  { requirePrivate = false, expectedRoot } = {},
) {
  if (!path.isAbsolute(absolutePath)) fail(`${label} path must be absolute`);
  const parent = await captureAbsoluteParentIdentity(absolutePath, label);
  const before = await lstat(absolutePath);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) {
    fail(`${label} must be one regular non-symlink file`);
  }
  if (requirePrivate && (before.uid !== process.geteuid() || (before.mode & 0o777) !== 0o600)) {
    fail(`${label} must be effective-user-owned mode 0600`);
  }
  const handle = await open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1
      || opened.dev !== before.dev || opened.ino !== before.ino) {
      fail(`${label} changed identity while opening`);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.nlink !== 1
      || after.size !== bytes.length || after.uid !== opened.uid
      || (after.mode & 0o777) !== (opened.mode & 0o777)) {
      fail(`${label} changed identity while reading`);
    }
    await assertParentIdentity(parent, label);
    const finalLeaf = await lstat(absolutePath);
    if (!finalLeaf.isFile() || finalLeaf.isSymbolicLink() || finalLeaf.nlink !== 1
      || finalLeaf.dev !== opened.dev || finalLeaf.ino !== opened.ino) {
      fail(`${label} changed pathname identity while reading`);
    }
    if (expectedRoot) {
      const canonical = await realpath(absolutePath);
      if (!pathIsWithin(expectedRoot, canonical)) fail(`${label} escaped its expected root`);
    }
    return {
      bytes,
      digest: sha256Bytes(bytes),
      dev: opened.dev,
      ino: opened.ino,
      nlink: opened.nlink,
      uid: opened.uid,
      mode: opened.mode & 0o777,
      parentIdentity: parent.entries,
    };
  } finally {
    await handle.close();
  }
}

async function captureAbsoluteParentIdentity(absolutePath, label) {
  const parentPath = path.dirname(absolutePath);
  const parsed = path.parse(parentPath);
  const segments = parentPath.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let cursor = parsed.root;
  const entries = [];
  for (const segment of segments) {
    cursor = path.join(cursor, segment);
    const entry = await lstat(cursor);
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      fail(`${label} parent must not traverse symlinks`);
    }
    entries.push({ path: cursor, dev: entry.dev, ino: entry.ino });
  }
  return { parentPath, entries };
}

async function assertParentIdentity(capture, label) {
  for (const expected of capture.entries) {
    const current = await lstat(expected.path);
    if (!current.isDirectory() || current.isSymbolicLink()
      || current.dev !== expected.dev || current.ino !== expected.ino) {
      fail(`${label} parent directory identity changed`);
    }
  }
}

async function assertPrivateOutputParent(absolutePath, label) {
  const capture = await captureAbsoluteParentIdentity(absolutePath, label);
  const parent = await lstat(capture.parentPath);
  if (parent.uid !== process.geteuid() || (parent.mode & 0o077) !== 0) {
    fail(`${label} parent must be effective-user-owned and private`);
  }
}

async function convergeRepositoryFile(input) {
  return convergeAbsoluteFile({
    ...input,
    absolutePath: path.join(repositoryRealpath, input.relativePath),
  });
}

async function convergeAbsoluteFile({
  absolutePath,
  original,
  targetBytes,
  targetMode,
  label,
  bridgeFault = "none",
}) {
  const parent = await openAnchoredParent(absolutePath, label);
  try {
    const current = await captureOptionalAbsoluteFile(absolutePath, label, {
      requirePrivate: false,
    });
    const originalDigest = original?.sha256 ?? "absent";
    const targetDigest = sha256Bytes(targetBytes);
    if (current && current.digest !== originalDigest && current.digest !== targetDigest) {
      fail(`${label} contains third-state bytes`);
    }
    await runFilesystemBridge({
      operation: "converge",
      parent,
      target: path.basename(absolutePath),
      originalDigest,
      targetDigest,
      targetBytes,
      targetMode,
      fault: bridgeFault,
      label,
    });
    await assertOpenedParent(parent, label);
    await assertParentIdentity(parent.capture, label);
    const finalCapture = await captureAbsoluteFile(absolutePath, label, {
      requirePrivate: targetMode === 0o600,
    });
    if (finalCapture.digest !== targetDigest || finalCapture.nlink !== 1
      || finalCapture.mode !== targetMode) {
      fail(`${label} did not converge to target bytes or exact target mode`);
    }
  } finally {
    await parent.handle.close();
  }
}

async function retireExactFile(absolutePath, expectedDigest, label) {
  const parent = await openAnchoredParent(absolutePath, label);
  try {
    await runFilesystemBridge({
      operation: "retire",
      parent,
      target: path.basename(absolutePath),
      originalDigest: expectedDigest,
      targetDigest: "-",
      targetBytes: Buffer.alloc(0),
      targetMode: 0o600,
      fault: "none",
      label,
    });
    await assertOpenedParent(parent, label);
    await assertParentIdentity(parent.capture, label);
    if (await captureOptionalAbsoluteFile(absolutePath, label)) fail(`${label} retirement failed`);
  } finally {
    await parent.handle.close();
  }
}

async function openAnchoredParent(absolutePath, label) {
  const capture = await captureAbsoluteParentIdentity(absolutePath, label);
  const handle = await open(
    capture.parentPath,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  const opened = await handle.stat();
  const expected = capture.entries.at(-1);
  if (!expected || opened.dev !== expected.dev || opened.ino !== expected.ino) {
    await handle.close();
    fail(`${label} parent changed while opening`);
  }
  return { capture, handle, stat: opened };
}

async function assertOpenedParent(parent, label) {
  const current = await parent.handle.stat();
  if (!current.isDirectory() || current.dev !== parent.stat.dev || current.ino !== parent.stat.ino) {
    fail(`${label} opened parent identity changed`);
  }
}

function filesystemBridge() {
  return String.raw`
import hashlib, os, stat, sys
op, target, original, replacement, mode_text, expected_dev, expected_ino, fault = sys.argv[1:]
dir_fd = 3
payload = sys.stdin.buffer.read()

def die(message, code=2):
    sys.stderr.write(message + "\n")
    raise SystemExit(code)

directory = os.fstat(dir_fd)
if not stat.S_ISDIR(directory.st_mode) or str(directory.st_dev) != expected_dev or str(directory.st_ino) != expected_ino:
    die("anchored parent identity mismatch")

def inspect(name):
    try:
        flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
        fd = os.open(name, flags, dir_fd=dir_fd)
    except FileNotFoundError:
        return None
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            die("leaf is not a single-link regular file")
        chunks = []
        while True:
            chunk = os.read(fd, 1024 * 1024)
            if not chunk:
                break
            chunks.append(chunk)
        data = b"".join(chunks)
        return {
            "digest": "sha256:" + hashlib.sha256(data).hexdigest(),
            "bytes": data,
            "mode": stat.S_IMODE(info.st_mode),
            "uid": info.st_uid,
        }
    finally:
        os.close(fd)

if op == "retire":
    current = inspect(target)
    if current is None or current["digest"] != original:
        die("retire target digest mismatch")
    os.unlink(target, dir_fd=dir_fd)
    os.fsync(dir_fd)
    raise SystemExit(0)

if op != "converge":
    die("unsupported operation")
if "sha256:" + hashlib.sha256(payload).hexdigest() != replacement:
    die("replacement payload digest mismatch")

temp = "." + target + "." + replacement[7:31] + ".tmp"
discard = "." + target + ".discard"
current = inspect(target)
temp_state = inspect(temp)
discard_state = inspect(discard)
if discard_state is not None:
    if original == "absent" or discard_state["digest"] != original:
        die("recovery discard digest mismatch")
    if current is None:
        if temp_state is not None and temp_state["digest"] == replacement:
            os.rename(temp, target, src_dir_fd=dir_fd, dst_dir_fd=dir_fd)
            temp_state = None
            current = inspect(target)
        else:
            os.rename(discard, target, src_dir_fd=dir_fd, dst_dir_fd=dir_fd)
            os.fsync(dir_fd)
            current = inspect(target)
            discard_state = None
    if current is not None and current["digest"] == replacement:
        os.unlink(discard, dir_fd=dir_fd)
        os.fsync(dir_fd)
        discard_state = None
    elif discard_state is not None:
        die("recovery discard coexists with a non-replacement target")
if current is not None and current["digest"] == replacement:
    if current["mode"] != int(mode_text, 8):
        die("completed target mode mismatch")
    if temp_state is not None:
        if temp_state["digest"] not in (original, replacement):
            die("completed target has unknown recovery temp")
        os.unlink(temp, dir_fd=dir_fd)
    os.fsync(dir_fd)
    raise SystemExit(0)
if (current is None and original != "absent") or (current is not None and current["digest"] != original):
    die("target is neither original nor replacement")

if temp_state is None:
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(temp, flags, int(mode_text, 8), dir_fd=dir_fd)
    try:
        os.fchmod(fd, int(mode_text, 8))
        limit = max(1, len(payload) // 2) if fault == "partial-write" else len(payload)
        view = memoryview(payload)[:limit]
        while view:
            count = os.write(fd, view)
            view = view[count:]
        if fault == "partial-write":
            os.fsync(fd)
            raise SystemExit(97)
        os.fsync(fd)
    finally:
        os.close(fd)
else:
    if not payload.startswith(temp_state["bytes"]):
        die("temporary bytes are not a recoverable prefix")
    if temp_state["mode"] != int(mode_text, 8):
        die("temporary mode is stale")
    fd = os.open(temp, os.O_WRONLY | os.O_APPEND | getattr(os, "O_NOFOLLOW", 0), dir_fd=dir_fd)
    try:
        os.fchmod(fd, int(mode_text, 8))
        remaining = payload[len(temp_state["bytes"]):]
        view = memoryview(remaining)
        while view:
            count = os.write(fd, view)
            view = view[count:]
        os.fsync(fd)
    finally:
        os.close(fd)

current = inspect(target)
if (current is None and original != "absent") or (current is not None and current["digest"] != original):
    die("target changed before commit")
if original == "absent":
    os.rename(temp, target, src_dir_fd=dir_fd, dst_dir_fd=dir_fd)
    if fault == "after-target-rename":
        raise SystemExit(98)
else:
    try:
        os.rename(target, discard, src_dir_fd=dir_fd, dst_dir_fd=dir_fd)
        os.rename(temp, target, src_dir_fd=dir_fd, dst_dir_fd=dir_fd)
        if fault == "after-target-rename":
            raise SystemExit(98)
    except BaseException:
        if inspect(target) is None and inspect(discard) is not None:
            os.rename(discard, target, src_dir_fd=dir_fd, dst_dir_fd=dir_fd)
        raise
    old = inspect(discard)
    if old is None or old["digest"] != original:
        die("discarded original digest mismatch")
    os.unlink(discard, dir_fd=dir_fd)
os.fsync(dir_fd)
final = inspect(target)
if final is None or final["digest"] != replacement or final["mode"] != int(mode_text, 8):
    die("committed replacement digest mismatch")
`;
}

async function runFilesystemBridge({
  operation,
  parent,
  target,
  originalDigest,
  targetDigest,
  targetBytes,
  targetMode,
  fault,
  label,
}) {
  const python = await resolveSystemPython();
  const child = spawn(python, [
    "-I", "-c", filesystemBridge(),
    operation,
    target,
    originalDigest,
    targetDigest,
    targetMode.toString(8),
    String(parent.stat.dev),
    String(parent.stat.ino),
    fault,
  ], {
    env: { PATH: "/usr/bin:/bin" },
    stdio: ["pipe", "pipe", "pipe", parent.handle.fd],
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
  child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
  child.stdin.end(targetBytes);
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  if (code !== 0) {
    if ((fault === "partial-write" && code === 97)
      || (fault === "after-target-rename" && code === 98)) return;
    fail(`${label} anchored filesystem operation failed: ${
      Buffer.concat(stderr).toString("utf8").trim() || `exit ${code}`
    }`);
  }
}

async function resolveSystemPython() {
  if (resolvedPython) return resolvedPython;
  for (const candidate of SYSTEM_PYTHON_CANDIDATES) {
    try {
      const canonical = await realpath(candidate);
      const entry = await lstat(canonical);
      if (entry.isFile() && entry.uid === 0 && (entry.mode & 0o022) === 0) {
        resolvedPython = canonical;
        return canonical;
      }
    } catch {}
  }
  fail("a root-owned immutable system Python is required for descriptor-anchored publication");
}

function validateJournal(journal, caller, repoRealpath, runnerDigest) {
  validateCanonicalObject(journal, "prepared transaction journal");
  if (!exactKeys(journal, JOURNAL_KEYS)
    || journal.schemaVersion !== 4 || journal.kind !== JOURNAL_KIND
    || journal.status !== "prepared" || journal.repository?.realpath !== repoRealpath
    || journal.runner?.sha256 !== runnerDigest
    || journal.runner?.nodeExecSha256 !== caller.expectedNodeExecDigest
    || journal.callerPins?.baseAnchorPath !== caller.baseAnchor
    || journal.callerPins?.baseAnchorDigest !== caller.expectedBaseAnchorDigest
    || journal.callerPins?.policyDigest !== caller.expectedPolicyDigest
    || journal.callerPins?.snapshotDigest !== caller.expectedSnapshotDigest
    || !sha256Digest(journal.callerPins?.snapshotByteSha256)
    || journal.callerPins?.baselineArchiveDigest !== caller.expectedBaselineArchiveDigest
    || journal.callerPins?.baselineArchivePath !== BASELINE_ARCHIVE_PATH
    || journal.callerPins?.pendingManifestPath !== caller.pendingManifest
    || journal.callerPins?.pendingManifestDigest !== caller.expectedPendingManifestDigest
    || journal.callerPins?.anchorOutputPath !== caller.externalAnchorOutput
    || journal.callerPins?.journalOutputPath !== caller.journalOutput) {
    fail("prepared transaction journal caller binding is stale");
  }
  if (!exactKeys(journal.runner, [
    "nodeExecPath", "nodeExecRealpath", "nodeExecSha256", "sha256",
  ])
    || journal.runner.nodeExecPath !== process.execPath
    || journal.runner.nodeExecRealpath !== nodeExecRealpath
    || !exactKeys(journal.callerPins, [
      "anchorOutputPath", "baseAnchorDigest", "baseAnchorPath",
      "baselineArchiveDigest", "baselineArchivePath", "journalOutputPath",
      "pendingManifestDigest", "pendingManifestPath", "policyDigest", "receipts",
      "snapshotByteSha256", "snapshotDigest", "timeoutMs",
    ])
    || journal.callerPins.timeoutMs !== caller.timeoutMs
    || !Array.isArray(journal.callerPins.receipts)
    || journal.callerPins.receipts.length !== REQUIRED_LANES.length) {
    fail("prepared transaction journal runner/caller schema is invalid");
  }
  if (!exactKeys(journal.repository, ["dev", "ino", "realpath"])
    || !Number.isInteger(journal.repository.dev)
    || !Number.isInteger(journal.repository.ino)) {
    fail("prepared transaction journal repository identity is invalid");
  }
  validateControlSetRecord(journal.controlSet);
  if (journal.governanceTransitions?.length !== 4 || journal.publications?.length !== 3) {
    fail("prepared transaction journal has an invalid transition/publication set");
  }
  if (journal.baselineArchive?.path !== BASELINE_ARCHIVE_PATH
    || journal.baselineArchive?.digest !== caller.expectedBaselineArchiveDigest
    || !sha256Digest(journal.baselineArchive?.entrySetDigest)
    || !Array.isArray(journal.baselineArchive?.entries)) {
    fail("prepared transaction journal baseline archive binding is stale");
  }
  if (journal.reviewSnapshot?.path !== SNAPSHOT_PATH
    || journal.reviewSnapshot?.canonicalDigest !== caller.expectedSnapshotDigest
    || !validIdentityRecord(journal.reviewSnapshot?.sourceIdentity)) {
    fail("prepared transaction journal review snapshot binding is stale");
  }
  const embeddedSnapshotBytes = decodePayload(journal.reviewSnapshot.bytes);
  if (sha256Bytes(embeddedSnapshotBytes) !== journal.callerPins.snapshotByteSha256
    || journal.reviewSnapshot.bytes.mode !== journal.reviewSnapshot.sourceIdentity.mode) {
    fail("prepared transaction journal review snapshot bytes are stale");
  }
  const embeddedSnapshot = parseJson(
    embeddedSnapshotBytes,
    "prepared transaction journal review snapshot",
  );
  validateCanonicalObject(embeddedSnapshot, "prepared transaction journal review snapshot");
  if (!exactKeys(embeddedSnapshot, SNAPSHOT_KEYS)
    || embeddedSnapshot.schemaVersion !== 4
    || embeddedSnapshot.kind !== "conversation-disclosure-continuation-review-snapshot"
    || embeddedSnapshot.digest !== caller.expectedSnapshotDigest) {
    fail("prepared transaction journal embedded snapshot schema/binding is stale");
  }
  validateSnapshotReviewOutputPathArray(embeddedSnapshot);
  if (!exactKeys(journal.pendingManifest, ["bytes", "path", "sourceIdentity"])
    || journal.pendingManifest.path !== caller.pendingManifest
    || !validIdentityRecord(journal.pendingManifest.sourceIdentity)) {
    fail("prepared transaction journal pending manifest binding is stale");
  }
  const embeddedPendingManifestBytes = decodePayload(journal.pendingManifest.bytes);
  if (sha256Bytes(embeddedPendingManifestBytes)
      !== journal.pendingManifest.sourceIdentity.sha256
    || journal.pendingManifest.bytes.mode !== journal.pendingManifest.sourceIdentity.mode) {
    fail("prepared transaction journal pending manifest bytes are stale");
  }
  const embeddedPendingManifest = parseJson(
    embeddedPendingManifestBytes,
    "prepared transaction journal pending manifest",
  );
  validateCanonicalObject(
    embeddedPendingManifest,
    "prepared transaction journal pending manifest",
  );
  if (!exactKeys(embeddedPendingManifest, MANIFEST_KEYS)
    || embeddedPendingManifest.digest !== caller.expectedPendingManifestDigest
    || embeddedPendingManifest.status
      !== "review_passed_pending_external_transaction") {
    fail("prepared transaction journal embedded pending manifest is stale");
  }
  const transitionPaths = new Set();
  for (const [index, transition] of journal.governanceTransitions.entries()) {
    const stagedPath = caller.transitionTargets.get(transition.path);
    if (!exactKeys(transition, [
      "kind", "order", "original", "path", "stagedTargetPath", "target",
    ])
      || transition.order !== index
      || transition.stagedTargetPath !== stagedPath
      || !repositoryPath(transition.path)
      || !repositoryPath(transition.stagedTargetPath)
      || transitionPaths.has(transition.path)
      || !validIdentityRecord(transition.original)
      || !exactKeys(transition.target, ["bytesBase64", "mode", "sha256"])
      || !Number.isInteger(transition.target.mode)) {
      fail("prepared transaction journal governance transition is invalid");
    }
    transitionPaths.add(transition.path);
    decodePayload(transition.target);
  }
  if (transitionPaths.size !== caller.transitionTargets.size) {
    fail("prepared transaction journal governance transition coverage is stale");
  }
  const publicationKinds = journal.publications.map((entry) => entry.kind);
  if (canonicalJson(publicationKinds) !== canonicalJson(["attestation", "manifest", "anchor"])) {
    fail("prepared transaction journal publication order is invalid");
  }
  const publicationEvidence = new Map();
  for (const [index, publication] of journal.publications.entries()) {
    if (!exactKeys(publication, [
      "kind", "order", "original", "parentIdentityDigest", "path", "scope", "target",
    ])
      || publication.order !== index
      || !["repository", "external"].includes(publication.scope)
      || !(publication.original === null || validIdentityRecord(publication.original))
      || !sha256Digest(publication.parentIdentityDigest)
      || !exactKeys(publication.target, ["bytesBase64", "mode", "sha256"])
      || !Number.isInteger(publication.target.mode)) {
      fail("prepared transaction journal publication entry is invalid");
    }
    const bytes = decodePayload(publication.target);
    const evidence = parseJson(bytes, `journal ${publication.kind} payload`);
    validateCanonicalObject(evidence, `journal ${publication.kind} payload`);
    publicationEvidence.set(publication.kind, evidence);
    if (publication.kind === "manifest"
      && (publication.scope !== "repository" || publication.path !== caller.pendingManifest)) {
      fail("prepared transaction journal manifest target is stale");
    }
    if (publication.kind === "anchor"
      && (publication.scope !== "external" || publication.path !== caller.externalAnchorOutput)) {
      fail("prepared transaction journal anchor target is stale");
    }
    if (publication.kind === "attestation"
      && (publication.scope !== "repository" || !repositoryPath(publication.path))) {
      fail("prepared transaction journal attestation target is invalid");
    }
  }
  const attestation = publicationEvidence.get("attestation");
  const manifest = publicationEvidence.get("manifest");
  const anchor = publicationEvidence.get("anchor");
  if (!exactKeys(manifest, MANIFEST_KEYS)
    || manifest.schemaVersion !== 4
    || manifest.kind !== "conversation-disclosure-continuation-closure-manifest"
    || manifest.status !== "externally_attested"
    || manifest.policy?.canonicalDigest !== caller.expectedPolicyDigest
    || manifest.snapshot?.canonicalDigest !== caller.expectedSnapshotDigest
    || manifest.pendingManifestDigest
      !== embeddedPendingManifest.pendingManifestDigest
    || manifest.externalRunner?.sha256 !== runnerDigest
    || manifest.externalAttestation?.canonicalDigest !== attestation?.digest
    || journal.publications[0].path !== manifest.externalAttestation?.path) {
    fail("prepared transaction journal final manifest binding is stale");
  }
  if (!exactKeys(attestation, ATTESTATION_KEYS)
    || attestation?.schemaVersion !== 4
    || attestation?.kind !== ATTESTATION_KIND
    || attestation?.status !== "passed"
    || attestation?.governancePhase !== "review_post_transition"
    || attestation?.identityAssurance !== "not-signed"
    || attestation?.reviewAssurance !== "caller-attested-not-signed"
    || attestation?.repositoryRealpath !== repoRealpath
    || attestation?.pendingManifestDigest
      !== embeddedPendingManifest.pendingManifestDigest
    || attestation?.policyDigest !== caller.expectedPolicyDigest
    || attestation?.snapshotDigest !== caller.expectedSnapshotDigest
    || attestation?.round3ReviewRejectionDigest
      !== embeddedPendingManifest.round3ReviewRejection?.canonicalDigest
    || canonicalJson(attestation?.callerDispatchSet)
      !== canonicalJson(embeddedPendingManifest.callerDispatchSet)
    || attestation?.runnerDigest !== runnerDigest) {
    fail("prepared transaction journal attestation binding is stale");
  }
  if (!exactKeys(anchor, ANCHOR_KEYS)
    || anchor?.schemaVersion !== 4
    || anchor?.kind !== ANCHOR_KIND
    || anchor?.identityAssurance !== "not-signed"
    || anchor?.reviewAssurance !== "caller-attested-not-signed"
    || anchor?.repositoryRealpath !== repoRealpath
    || anchor?.policyDigest !== caller.expectedPolicyDigest
    || anchor?.snapshotDigest !== caller.expectedSnapshotDigest
    || anchor?.round3ReviewRejectionDigest
      !== embeddedPendingManifest.round3ReviewRejection?.canonicalDigest
    || canonicalJson(anchor?.callerDispatchSet)
      !== canonicalJson(embeddedPendingManifest.callerDispatchSet)
    || anchor?.runnerDigest !== runnerDigest
    || anchor?.attestationDigest !== attestation.digest) {
    fail("prepared transaction journal external anchor binding is stale");
  }
  for (const lane of REQUIRED_LANES) {
    const pin = journal.callerPins.receipts?.find((entry) => entry.lane === lane);
    if (pin?.digest !== caller.receiptDigests.get(lane)
      || pin?.challenge !== caller.challenges.get(lane)) {
      fail(`prepared transaction journal receipt binding is stale: ${lane}`);
    }
  }
  validateCandidateResultSet(journal.candidateResults);
  const expectedFinalSetDigest = hashCanonical({
    transitions: journal.governanceTransitions.map((entry) => [
      entry.path,
      entry.target.sha256,
    ]),
    publications: journal.publications.map((entry) => [
      entry.kind,
      entry.target.sha256,
    ]),
  });
  if (journal.finalSetDigest !== expectedFinalSetDigest) {
    fail("prepared transaction journal finalSetDigest is stale");
  }
}

async function revalidatePreparedJournalAgainstSources(journal) {
  await validateRepositoryControlState(journal, {
    label: "prepared journal source revalidation",
  });

  const baseAnchorCapture = await captureAbsoluteFile(options.baseAnchor, "base anchor", {
    requirePrivate: true,
  });
  const baseAnchor = parseJson(baseAnchorCapture.bytes, "base anchor");
  validateCanonicalObject(baseAnchor, "base anchor");
  if (baseAnchor.digest !== journal.callerPins.baseAnchorDigest
    || baseAnchor.repositoryRealpath !== repositoryRealpath) {
    fail("prepared journal base anchor source binding is stale");
  }

  const policyCapture = await captureRepositoryFile(
    POLICY_PATH,
    "continuation policy",
    { requirePrivate: true },
  );
  const policy = parseJson(policyCapture.bytes, "continuation policy");
  validateCanonicalObject(policy, "continuation policy");
  if (!exactKeys(policy, POLICY_KEYS)
    || policy.schemaVersion !== 4
    || policy.kind !== "conversation-disclosure-continuation-policy"
    || policy.status !== "frozen"
    || policy.digest !== journal.callerPins.policyDigest
    || policy.parentEvidence?.externalAnchor?.digest !== baseAnchor.digest) {
    fail("prepared journal policy source binding is stale");
  }
  validateAdmissionCoverage(policy);
  await captureAndValidateRound3ReviewRejection(policy);

  const archiveCapture = await captureRepositoryFile(
    BASELINE_ARCHIVE_PATH,
    "baseline archive",
    { requirePrivate: true },
  );
  const archive = parseJson(archiveCapture.bytes, "baseline archive");
  validateCanonicalObject(archive, "baseline archive");
  if (archive.digest !== journal.callerPins.baselineArchiveDigest
    || archive.entrySetDigest !== journal.baselineArchive.entrySetDigest) {
    fail("prepared journal baseline archive source binding is stale");
  }

  const snapshotCapture = await captureRepositoryFile(
    SNAPSHOT_PATH,
    "review snapshot",
    { requirePrivate: true },
  );
  if (!snapshotCapture.bytes.equals(decodePayload(journal.reviewSnapshot.bytes))) {
    fail("prepared journal review snapshot source bytes changed");
  }
  const snapshot = parseJson(snapshotCapture.bytes, "review snapshot");
  validateCanonicalObject(snapshot, "review snapshot");
  if (!exactKeys(snapshot, SNAPSHOT_KEYS)
    || snapshot.digest !== journal.callerPins.snapshotDigest
    || snapshot.policyDigest !== policy.digest) {
    fail("prepared journal review snapshot source binding is stale");
  }
  await validateSnapshotTransitionPayloadFiles(snapshot, policy);

  const pendingManifestBytes = decodePayload(journal.pendingManifest.bytes);
  const pendingManifest = parseJson(pendingManifestBytes, "embedded pending manifest");
  validateCanonicalObject(pendingManifest, "embedded pending manifest");
  if (!exactKeys(pendingManifest, MANIFEST_KEYS)
    || pendingManifest.digest !== journal.callerPins.pendingManifestDigest
    || pendingManifest.pendingManifestDigest
      !== pendingManifestDigest(pendingManifest)
    || pendingManifest.policy?.canonicalDigest !== policy.digest
    || pendingManifest.snapshot?.canonicalDigest !== snapshot.digest
    || pendingManifest.externalRunner?.sha256 !== selfCapture.digest) {
    fail("prepared journal pending manifest source binding is stale");
  }

  const receipts = [];
  for (const reference of pendingManifest.reviewReceipts ?? []) {
    const receiptCapture = await captureRepositoryFile(
      reference.path,
      `${reference.lane ?? "unknown"} review receipt`,
      { requirePrivate: true },
    );
    const receipt = parseJson(receiptCapture.bytes, `${reference.lane} review receipt`);
    const canonicalDigest = hashCanonical(receipt);
    const callerPin = journal.callerPins.receipts?.find(
      (entry) => entry.lane === reference.lane,
    );
    if (reference.canonicalDigest !== canonicalDigest
      || callerPin?.digest !== canonicalDigest
      || reference.challenge !== receipt.challenge
      || callerPin?.challenge !== receipt.challenge
      || receipt.verdict !== "passed"
      || receipt.reviewedPhase !== "review_pre_transition"
      || receipt.policyDigest !== policy.digest
      || receipt.snapshotDigest !== snapshot.digest
      || receipt.validatorDigest !== pendingManifest.validator?.sha256
      || Object.values(receipt.findingCounts ?? {}).some((value) => value !== 0)) {
      fail(`prepared journal review receipt source binding is stale: ${reference.lane}`);
    }
    receipts.push(receipt);
  }
  validateReviewSet(receipts);
  validateCallerDispatchSet(pendingManifest.callerDispatchSet, receipts);

  const policyTransitions = Array.isArray(policy.governanceTransitions)
    ? policy.governanceTransitions
    : [];
  if (policyTransitions.length !== journal.governanceTransitions.length) {
    fail("prepared journal policy transition coverage is stale");
  }
  const currentTree = await captureRepositoryTree(repositoryRealpath);
  const controlEntries = new Map(
    journal.controlSet.entries.map((entry) => [entry.path, entry]),
  );
  const stagedTree = new Map();
  const journalTransitions = new Map(
    journal.governanceTransitions.map((entry) => [entry.path, entry]),
  );
  const manifestPublication = journal.publications.find((entry) => entry.kind === "manifest");
  const attestationPublication = journal.publications.find(
    (entry) => entry.kind === "attestation",
  );
  const anchorPublication = journal.publications.find((entry) => entry.kind === "anchor");
  const snapshotControl = controlEntries.get(SNAPSHOT_PATH);
  const manifestControl = controlEntries.get(options.pendingManifest);
  if (!snapshotControl || !manifestControl
    || canonicalJson(journal.reviewSnapshot.sourceIdentity)
      !== canonicalJson(withShaIdentity(snapshotControl))
    || canonicalJson(journal.pendingManifest.sourceIdentity)
      !== canonicalJson(withShaIdentity(manifestControl))
    || canonicalJson(manifestPublication?.original)
      !== canonicalJson(withShaIdentity(manifestControl))
    || journal.pendingManifest.bytes.mode !== manifestControl.mode
    || manifestPublication?.target?.mode !== 0o600
    || attestationPublication?.original !== null
    || attestationPublication?.path !== pendingManifest.externalAttestation?.path
    || attestationPublication?.target?.mode !== 0o600
    || anchorPublication?.original !== null
    || anchorPublication?.path !== options.externalAnchorOutput
    || anchorPublication?.target?.mode !== 0o600) {
    fail("prepared journal snapshot/manifest publication identity is stale");
  }
  for (const controlEntry of journal.controlSet.entries) {
    const transition = journalTransitions.get(controlEntry.path);
    if (transition) {
      const targetCapture = await captureRepositoryFile(
        transition.stagedTargetPath,
        `staged transition target ${transition.stagedTargetPath}`,
      );
      stagedTree.set(controlEntry.path, {
        ...targetCapture,
        bytes: decodePayload(transition.target),
        digest: transition.target.sha256,
        mode: transition.target.mode,
      });
      continue;
    }
    if (controlEntry.path === manifestPublication?.path) {
      stagedTree.set(controlEntry.path, {
        ...journal.pendingManifest.sourceIdentity,
        bytes: pendingManifestBytes,
        digest: journal.pendingManifest.bytes.sha256,
        mode: journal.pendingManifest.bytes.mode,
      });
      continue;
    }
    const current = currentTree.get(controlEntry.path);
    if (!current) {
      fail(`prepared journal staged reconstruction is missing ${controlEntry.path}`);
    }
    stagedTree.set(controlEntry.path, current);
  }
  if (attestationPublication?.path) stagedTree.delete(attestationPublication.path);

  for (const [index, policyTransition] of policyTransitions.entries()) {
    const journalTransition = journal.governanceTransitions[index];
    const controlledOriginal = controlEntries.get(policyTransition.path);
    const targetCapture = await captureRepositoryFile(
      policyTransition.stagedTargetPath,
      `policy staged target ${policyTransition.stagedTargetPath}`,
    );
    if (!controlledOriginal
      || journalTransition.path !== policyTransition.path
      || journalTransition.kind !== policyTransition.kind
      || journalTransition.stagedTargetPath !== policyTransition.stagedTargetPath
      || journalTransition.original.sha256 !== policyTransition.fromSha256
      || canonicalJson(journalTransition.original)
        !== canonicalJson(withShaIdentity(controlledOriginal))
      || journalTransition.target.sha256 !== policyTransition.toSha256
      || journalTransition.target.mode !== controlledOriginal.mode
      || targetCapture.digest !== policyTransition.toSha256
      || !targetCapture.bytes.equals(decodePayload(journalTransition.target))) {
      fail(`prepared journal policy transition binding is stale: ${policyTransition.path}`);
    }
  }

  const candidateResults = await executeCandidatesInStage({
    stagedTree,
    policy,
    baseAnchor,
    snapshot,
  });
  if (canonicalJson(candidateResults) !== canonicalJson(journal.candidateResults)) {
    fail("prepared journal candidate results do not revalidate");
  }

  const attestation = parseJson(
    decodePayload(attestationPublication.target),
    "journal attestation payload",
  );
  const finalManifest = parseJson(
    decodePayload(manifestPublication.target),
    "journal final manifest payload",
  );
  const anchor = parseJson(decodePayload(anchorPublication.target), "journal anchor payload");
  const expectedFinalManifest = withDigest({
    ...withoutDigest(pendingManifest),
    status: "externally_attested",
    externalAttestation: {
      path: pendingManifest.externalAttestation.path,
      canonicalDigest: attestation.digest,
    },
  });
  if (canonicalJson(finalManifest) !== canonicalJson(expectedFinalManifest)
    || canonicalJson(attestation.candidateResults) !== canonicalJson(candidateResults)) {
    fail("prepared journal generated evidence differs from revalidated sources");
  }
  validateGeneratedEvidence({
    attestation,
    finalManifest,
    anchor,
    manifest: pendingManifest,
    policy,
    snapshot,
  });
}

function validateCandidateResultSet(results) {
  if (!Array.isArray(results) || results.length !== 2) {
    fail("prepared transaction journal candidate result set is invalid");
  }
  const expectedKinds = ["checker", "harness"];
  for (const [index, result] of results.entries()) {
    if (!exactKeys(result, CANDIDATE_RESULT_KEYS)
      || result.kind !== expectedKinds[index]
      || !repositoryPath(result.path)
      || result.status !== "passed"
      || !sha256Digest(result.receiptDigest)
      || !sha256Digest(result.stdoutDigest)
      || !sha256Digest(result.stderrDigest)) {
      fail(`prepared transaction journal candidate result is invalid: ${index}`);
    }
  }
}

function validateReviewSet(receipts) {
  if (receipts.length !== 3
    || new Set(receipts.map((receipt) => receipt.lane)).size !== 3
    || new Set(receipts.map((receipt) => receipt.challenge)).size !== 3
    || receipts.some((receipt) =>
      !exactKeys(receipt, RECEIPT_KEYS)
      || receipt.schemaVersion !== 4
      || receipt.kind !== "conversation-disclosure-continuation-review-receipt"
      || receipt.round !== 4
      || receipt.reviewedPhase !== "review_pre_transition"
      || receipt.identityAssurance !== "not-signed"
      || receipt.independenceClaim
        !== "caller-attested-distinct-review-contexts"
      || !plainObject(receipt.claimedReviewOrigin)
      || receipt.verdict !== "passed"
      || receipt.findings?.length !== 0
      || Object.values(receipt.findingCounts ?? {}).some((value) => value !== 0))) {
    fail("review set must contain three ordered zero-finding not-signed lanes");
  }
  for (const lane of REQUIRED_LANES) {
    if (!receipts.some((receipt) => receipt.lane === lane)) fail(`missing review lane: ${lane}`);
  }
}

function validateCallerDispatchSet(entries, receipts) {
  const entryKeys = [
    "agentLabel", "assurance", "challenge", "instructionDigest", "lane",
    "reviewContextId", "taskPath", "transport",
  ];
  if (!Array.isArray(entries) || entries.length !== REQUIRED_LANES.length) {
    fail("caller dispatch set must contain exactly three entries");
  }
  const setDigest = hashCanonical(entries);
  const contexts = new Set();
  const challenges = new Set();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const receipt = receipts[index];
    if (!exactKeys(entry, entryKeys)
      || entry.lane !== REQUIRED_LANES[index]
      || entry.assurance !== "caller-attested-not-signed"
      || entry.transport !== "codex-collaboration"
      || !sha256Digest(entry.challenge)
      || !sha256Digest(entry.instructionDigest)
      || typeof entry.reviewContextId !== "string"
      || entry.reviewContextId.length === 0
      || receipt?.lane !== entry.lane
      || receipt?.challenge !== entry.challenge
      || receipt?.callerDispatchSetDigest !== setDigest
      || receipt?.callerDispatchEntryDigest !== hashCanonical(entry)
      || receipt?.claimedReviewOrigin?.taskPath !== entry.taskPath
      || receipt?.claimedReviewOrigin?.agentLabel !== entry.agentLabel
      || receipt?.claimedReviewOrigin?.transport !== entry.transport) {
      fail(`caller dispatch binding is stale: ${REQUIRED_LANES[index]}`);
    }
    contexts.add(entry.reviewContextId);
    challenges.add(entry.challenge);
  }
  if (contexts.size !== entries.length || challenges.size !== entries.length) {
    fail("caller dispatch contexts and challenges must be unique");
  }
}

function validateGeneratedEvidence({ attestation, finalManifest, anchor, manifest, policy, snapshot }) {
  for (const [label, value] of [["attestation", attestation], ["manifest", finalManifest], ["anchor", anchor]]) {
    validateCanonicalObject(value, `generated ${label}`);
  }
  if (!exactKeys(attestation, ATTESTATION_KEYS)
    || !exactKeys(finalManifest, MANIFEST_KEYS)
    || !exactKeys(anchor, ANCHOR_KEYS)
    || attestation.pendingManifestDigest !== manifest.pendingManifestDigest
    || finalManifest.externalAttestation?.canonicalDigest !== attestation.digest
    || anchor.attestationDigest !== attestation.digest
    || anchor.policyDigest !== policy.digest
    || anchor.snapshotDigest !== snapshot.digest
    || anchor.round3ReviewRejectionDigest
      !== policy.round3ReviewRejection.digest
    || canonicalJson(anchor.callerDispatchSet)
      !== canonicalJson(manifest.callerDispatchSet)) {
    fail("generated continuation evidence bindings are stale");
  }
}

function parseOptions(args) {
  const singleNames = new Map([
    ["--repo", "repo"],
    ["--expected-repo-realpath", "expectedRepoRealpath"],
    ["--base-anchor", "baseAnchor"],
    ["--expected-base-anchor-digest", "expectedBaseAnchorDigest"],
    ["--expected-policy-digest", "expectedPolicyDigest"],
    ["--expected-snapshot-digest", "expectedSnapshotDigest"],
    ["--expected-baseline-archive-digest", "expectedBaselineArchiveDigest"],
    ["--pending-manifest", "pendingManifest"],
    ["--expected-pending-manifest-digest", "expectedPendingManifestDigest"],
    ["--expected-runner-digest", "expectedRunnerDigest"],
    ["--expected-node-exec-digest", "expectedNodeExecDigest"],
    ["--external-anchor-output", "externalAnchorOutput"],
    ["--journal-output", "journalOutput"],
    ["--candidate-timeout-ms", "timeoutMs"],
  ]);
  const values = {
    receiptDigests: new Map(),
    challenges: new Map(),
    transitionTargets: new Map(),
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (singleNames.has(argument)) {
      const key = singleNames.get(argument);
      if (values[key] !== undefined) fail(`${argument} may appear only once`);
      values[key] = args[index + 1];
      index += 1;
      continue;
    }
    const repeated = new Map([
      ["--expected-review-receipt", values.receiptDigests],
      ["--expected-review-challenge", values.challenges],
      ["--transition-target", values.transitionTargets],
    ]).get(argument);
    if (repeated) {
      const [key, value, ...extra] = String(args[index + 1] ?? "").split("=");
      if (!key || !value || extra.length > 0 || repeated.has(key)) {
        fail(`${argument} requires one unique key=value`);
      }
      repeated.set(key, value);
      index += 1;
      continue;
    }
    fail(`unknown runner v4 option: ${argument}`);
  }
  for (const key of [
    "repo", "expectedRepoRealpath", "baseAnchor", "expectedBaseAnchorDigest",
    "expectedPolicyDigest", "expectedSnapshotDigest", "expectedBaselineArchiveDigest",
    "pendingManifest",
    "expectedPendingManifestDigest", "expectedRunnerDigest", "expectedNodeExecDigest",
    "externalAnchorOutput", "journalOutput",
  ]) {
    if (!values[key]) fail(`missing required runner v4 option: ${key}`);
  }
  values.timeoutMs = values.timeoutMs === undefined
    ? DEFAULT_TIMEOUT_MS
    : Number(values.timeoutMs);
  if (!Number.isInteger(values.timeoutMs) || values.timeoutMs < 1 || values.timeoutMs > 120_000) {
    fail("candidate timeout must be an integer between 1 and 120000 milliseconds");
  }
  for (const digestValue of [
    values.expectedBaseAnchorDigest,
    values.expectedPolicyDigest,
    values.expectedSnapshotDigest,
    values.expectedBaselineArchiveDigest,
    values.expectedPendingManifestDigest,
    values.expectedRunnerDigest,
    values.expectedNodeExecDigest,
    ...values.receiptDigests.values(),
    ...values.challenges.values(),
  ]) {
    if (!sha256Digest(digestValue)) fail("every caller digest pin must be sha256:<64 hex>");
  }
  if (values.receiptDigests.size !== 3 || values.challenges.size !== 3
    || REQUIRED_LANES.some((lane) => !values.receiptDigests.has(lane)
      || !values.challenges.has(lane))) {
    fail("caller must pin exactly three receipt digests and challenges");
  }
  if (![values.repo, values.expectedRepoRealpath, values.baseAnchor,
    values.externalAnchorOutput, values.journalOutput].every(path.isAbsolute)) {
    fail("runner, anchor, journal, and repository paths must be absolute");
  }
  if (!repositoryPath(values.pendingManifest)) fail("pending manifest path must be repository-relative");
  for (const [target, source] of values.transitionTargets) {
    if (!repositoryPath(target) || !repositoryPath(source)) {
      fail("transition target mappings must use repository-relative paths");
    }
  }
  return values;
}

function rejectPreloadEnvironment() {
  const forbiddenEnv = Object.entries(process.env).filter(([name, value]) => value
    && (name === "NODE_OPTIONS" || name === "NODE_PATH" || name === "LD_PRELOAD"
      || name.startsWith("DYLD_")));
  const forbiddenExecArg = process.execArgv.find((argument) =>
    /^(?:-r|--require|--import|--loader|--experimental-loader|--inspect|--eval|-e)(?:=|$)/.test(argument)
  );
  if (forbiddenEnv.length > 0 || forbiddenExecArg) {
    fail("preload, loader, require, import, inspect, and eval injection are forbidden");
  }
}

function injectFault(point) {
  if (process.env.ZEROX_CD03A_RUNNER_V4_TEST_FAULT === point) {
    fail(`injected runner v4 fault: ${point}`);
  }
}

function validateCanonicalObject(value, label) {
  if (!plainObject(value) || !sha256Digest(value.digest)) fail(`${label} canonical digest is missing`);
  const without = withoutDigest(value);
  if (hashCanonical(without) !== value.digest) fail(`${label} canonical digest is stale`);
}

function identityRecord(capture) {
  return {
    sha256: capture.digest,
    dev: capture.dev,
    ino: capture.ino,
    nlink: capture.nlink,
    uid: capture.uid,
    mode: capture.mode,
  };
}

function withShaIdentity(controlEntry) {
  return {
    sha256: controlEntry.sha256,
    dev: controlEntry.dev,
    ino: controlEntry.ino,
    nlink: controlEntry.nlink,
    uid: controlEntry.uid,
    mode: controlEntry.mode,
  };
}

function validIdentityRecord(value) {
  return plainObject(value) && sha256Digest(value.sha256)
    && Number.isInteger(value.dev) && Number.isInteger(value.ino)
    && value.nlink === 1 && Number.isInteger(value.uid)
    && Number.isInteger(value.mode) && value.mode >= 0 && value.mode <= 0o777;
}

function payloadRecord(bytes, mode) {
  return { sha256: sha256Bytes(bytes), mode, bytesBase64: bytes.toString("base64") };
}

function decodePayload(payload) {
  if (!exactKeys(payload, ["bytesBase64", "mode", "sha256"])
    || !sha256Digest(payload.sha256)
    || !Number.isInteger(payload.mode)
    || payload.mode < 0
    || payload.mode > 0o777
    || typeof payload.bytesBase64 !== "string") {
    fail("journal target payload schema is invalid");
  }
  const bytes = Buffer.from(payload.bytesBase64, "base64");
  if (bytes.toString("base64") !== payload.bytesBase64
    || sha256Bytes(bytes) !== payload.sha256) {
    fail("journal target payload digest is stale");
  }
  return bytes;
}

function parseJson(bytes, label) {
  try { return JSON.parse(bytes.toString("utf8")); }
  catch { fail(`${label} must contain valid JSON`); }
}

function prettyJsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function canonicalJson(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    if (!plainObject(value)) throw new TypeError("canonical JSON accepts plain objects only");
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    ).join(",")}}`;
  }
  if (["string", "boolean", "number"].includes(typeof value)) return JSON.stringify(value);
  throw new TypeError(`canonical JSON does not support ${typeof value}`);
}

function sha256Bytes(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function hashCanonical(value) {
  return sha256Bytes(canonicalJson(value));
}

function withDigest(value) {
  const without = withoutDigest(value);
  return { ...without, digest: hashCanonical(without) };
}

function pendingManifestDigest(manifest) {
  const projected = withoutDigest(manifest);
  delete projected.pendingManifestDigest;
  projected.status = "review_passed_pending_external_transaction";
  if (plainObject(projected.externalAttestation)) {
    projected.externalAttestation = {
      ...projected.externalAttestation,
      canonicalDigest: null,
    };
  }
  return hashCanonical(projected);
}

function withoutDigest(value) {
  const copy = { ...value };
  delete copy.digest;
  return copy;
}

function repositoryPath(value) {
  return typeof value === "string" && value.length > 0 && !path.posix.isAbsolute(value)
    && !value.includes("\\") && value.normalize("NFC") === value
    && path.posix.normalize(value) === value && value !== "." && !value.startsWith("../");
}

function pathIsWithin(root, target) {
  return target === root || target.startsWith(`${root}${path.sep}`);
}

function assertOutsideRepository(target, root, label) {
  if (!path.isAbsolute(target) || pathIsWithin(root, path.resolve(target))) {
    fail(`${label} must remain outside the repository`);
  }
}

function sha256Digest(value) {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function exactKeys(value, expected) {
  return plainObject(value)
    && canonicalJson(Object.keys(value).sort()) === canonicalJson([...expected].sort());
}

function safeProcessError(error) {
  return [error?.message, error?.stdout, error?.stderr].filter(Boolean).join("\n").slice(0, 8000);
}

function printPublicationReceipt(journal, recovered) {
  const anchorPublication = journal.publications.find((entry) => entry.kind === "anchor");
  const manifestPublication = journal.publications.find((entry) => entry.kind === "manifest");
  const attestationPublication = journal.publications.find((entry) => entry.kind === "attestation");
  const anchor = parseJson(decodePayload(anchorPublication.target), "published anchor receipt");
  const manifest = parseJson(decodePayload(manifestPublication.target), "published manifest receipt");
  const attestation = parseJson(
    decodePayload(attestationPublication.target),
    "published attestation receipt",
  );
  const receiptWithoutDigest = {
    kind: "cd03a-external-publication-v4-receipt",
    status: "passed",
    recovered,
    transactionDigest: journal.digest,
    policyDigest: journal.callerPins.policyDigest,
    snapshotDigest: journal.callerPins.snapshotDigest,
    baselineArchiveDigest: journal.callerPins.baselineArchiveDigest,
    attestationDigest: attestation.digest,
    manifestDigest: manifest.digest,
    externalAnchorPath: anchorPublication.path,
    externalAnchorDigest: anchor.digest,
  };
  console.log(JSON.stringify({
    ...receiptWithoutDigest,
    digest: hashCanonical(receiptWithoutDigest),
  }));
}

function fail(message) {
  console.error("CD03A external continuation runner v4 failed:");
  console.error(`- ${message}`);
  process.exit(1);
}
