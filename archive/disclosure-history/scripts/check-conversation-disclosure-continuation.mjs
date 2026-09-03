import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import * as continuationContract from "./conversation-disclosure-continuation-contract.mjs";

const root = process.cwd();
const canonicalRoot = await realpath(root);
const baseSnapshotPath =
  ".zerox/verification/conversation-disclosure/CD03-round23-review-snapshot.json";
const baseSnapshotDigest =
  "sha256:e1a5300d6015543e0a6a8e8f09f2a13fcb955111b87c08545e0f882bb786796b";
const baseAnchorDigest =
  "sha256:e81f0afb3d10b12976b74d1499870b837595ffbc3b452c7f1f78fff67be8f102";
const policyPath =
  ".zerox/verification/conversation-disclosure/CD03A-successor-evolution-policy.json";
const continuationManifestPath =
  ".zerox/verification/conversation-disclosure/CD03A-round1-closure-manifest.json";
const programPath = ".zerox/conversation-disclosure-program.json";
const featureListPath = ".zerox/feature_list.json";
const checkerPath = "scripts/check-conversation-disclosure-continuation.mjs";
const contractPath = "scripts/conversation-disclosure-continuation-contract.mjs";
const expectedProgramId = "conversation-progressive-disclosure-v3.9.2-2026-08";
const expectedSuccessorWorkstreamId = "CD04";
const expectedSuccessorFeatureId =
  "P108-conversation-disclosure-evidence-foundation";
const expectedAdmissionWorkstreamId = "CD03A";
const expectedAdmissionFeatureId =
  "P107A-conversation-disclosure-successor-admission";

const errors = [];
const captures = new Map();
const absoluteCaptures = new Map();
const options = parseOptions(process.argv.slice(2));
errors.push(...options.errors);

if (typeof continuationContract.hashCanonical !== "function"
  || typeof continuationContract.validateContinuationPolicy !== "function"
  || typeof continuationContract.validateContinuationExternalAnchor !== "function"
  || typeof continuationContract.stableWorkstreamDefinition !== "function"
  || typeof continuationContract.stableFeatureDefinition !== "function") {
  errors.push("continuation contract does not expose the required v1 checker API");
}

const baseAnchorCapture = await captureAbsolute(
  options.baseAnchorPath,
  "Round23 base external anchor",
);
const continuationAnchorCapture = options.bootstrapCandidate
  ? null
  : await captureAbsolute(
    options.continuationAnchorPath,
    "CD03A continuation external anchor",
  );
const baseAnchor = parseCapturedJson(
  baseAnchorCapture,
  "Round23 base external anchor",
);
const continuationAnchor = parseCapturedJson(
  continuationAnchorCapture,
  "CD03A continuation external anchor",
);

const initialPaths = [
  baseSnapshotPath,
  policyPath,
  continuationManifestPath,
  programPath,
  featureListPath,
  checkerPath,
  contractPath,
];
for (const relativePath of initialPaths) {
  await captureRepository(relativePath, `continuation control input ${relativePath}`);
}

const baseSnapshot = parseCapturedJson(
  captures.get(baseSnapshotPath),
  "Round23 historical review snapshot",
);
const policy = parseCapturedJson(
  captures.get(policyPath),
  "CD03A continuation policy",
);
const continuationManifest = parseCapturedJson(
  captures.get(continuationManifestPath),
  "CD03A continuation closure manifest",
);
const program = parseCapturedJson(
  captures.get(programPath),
  "conversation disclosure program",
);
const featureList = parseCapturedJson(
  captures.get(featureListPath),
  "Feature list",
);

validateBaseAnchor(baseAnchor);
validateBaseSnapshot(baseSnapshot);

const policyErrors = callValidator(
  "continuation policy",
  continuationContract.validateContinuationPolicy,
  policy,
  {
    baseAnchor,
    expectedProgramId,
    expectedDigest: options.bootstrapCandidate
      ? options.expectedPolicyDigest
      : undefined,
  },
);
errors.push(...policyErrors.map((error) => `CD03A ${error}`));

if (policy?.programId !== expectedProgramId) {
  errors.push(`continuation policy programId must be ${expectedProgramId}`);
}
if (policy?.parent?.externalAnchorDigest !== baseAnchorDigest
  || policy?.parent?.snapshotDigest !== baseSnapshotDigest
  || policy?.parent?.snapshotPath !== baseSnapshotPath
  || policy?.parent?.round !== 23
  || policy?.parent?.workstreamId !== "CD03"
  || policy?.parent?.featureId !== "P107-conversation-disclosure-domain-adapters") {
  errors.push("continuation policy parent must exactly bind the Round23 CD03/P107 head");
}
if (policy?.successor?.workstreamId !== expectedSuccessorWorkstreamId
  || policy?.successor?.featureId !== expectedSuccessorFeatureId) {
  errors.push("continuation policy must authorize exactly CD04/P108");
}

const baseFiles = validateBaseSnapshotFiles(baseSnapshot);
const authorizedEntries = validateAuthorizedEntries(policy, baseFiles);
const exactTargets = validateExactTargets(policy, baseFiles);

for (const [relativePath] of baseFiles) {
  await captureRepository(relativePath, `Round23 protected file ${relativePath}`);
}
for (const [relativePath, entry] of authorizedEntries) {
  await captureRepository(
    relativePath,
    `P108 admitted path ${relativePath}`,
    { allowMissing: entry.operation === "create" },
  );
}
for (const [relativePath] of exactTargets) {
  await captureRepository(relativePath, `continuation exact target ${relativePath}`);
}

const closureObjects = await loadContinuationClosure(
  continuationManifest,
  policy,
  { includeAttestation: !options.bootstrapCandidate },
);
validateContinuationClosure({
  ...closureObjects,
  manifest: continuationManifest,
  policy,
  continuationAnchor,
  bootstrapCandidate: options.bootstrapCandidate,
});

if (!options.bootstrapCandidate) {
  validateContinuationAnchorCallerBinding(continuationAnchor, policy);
}
validateExactTargetBytes(exactTargets);

const lifecycle = validateExternallyAnchoredDefinitions({
  program,
  featureList,
  policy,
  bootstrapCandidate: options.bootstrapCandidate,
});
const drift = validateLiveProtectedBytes({
  lifecycle,
  baseFiles,
  authorizedEntries,
  exactTargets,
});

await postflightRehash();

const uniqueErrors = [...new Set(errors)];
if (uniqueErrors.length > 0) {
  console.error("Conversation disclosure continuation check failed:");
  for (const error of uniqueErrors) console.error(`- ${error}`);
  process.exitCode = 1;
} else if (options.bootstrapCandidate) {
  console.log(JSON.stringify({
    kind: "cd03a-continuation-checker-receipt",
    status: "passed",
    baseExternalAnchorDigest: baseAnchorDigest,
    baseSnapshotDigest,
    policyDigest: policy.digest,
    snapshotDigest: closureObjects.snapshot.digest,
  }));
} else if (lifecycle === "active") {
  console.log(JSON.stringify({
    status: "authorized_unreviewed",
    programId: expectedProgramId,
    workstreamId: expectedSuccessorWorkstreamId,
    featureId: expectedSuccessorFeatureId,
    historicalBaseSnapshotDigest: baseSnapshotDigest,
    continuationPolicyDigest: policy.digest,
    continuationAnchorDigest: continuationAnchor.digest,
    drift,
  }));
} else {
  console.log(JSON.stringify({
    status: "passed",
    liveState: lifecycle,
    programId: expectedProgramId,
    historicalBaseSnapshotDigest: baseSnapshotDigest,
    continuationPolicyDigest: policy.digest,
    continuationAnchorDigest: continuationAnchor.digest,
    drift,
  }));
}

function validateBaseAnchor(anchor) {
  if (!plainObject(anchor)) {
    errors.push("Round23 base external anchor must be an object");
    return;
  }
  if (anchor.kind !== "conversation-disclosure-external-anchor"
    || anchor.schemaVersion !== 1
    || anchor.digest !== baseAnchorDigest
    || anchor.digest !== options.expectedBaseAnchorDigest
    || anchor.snapshotDigest !== baseSnapshotDigest
    || anchor.repositoryRealpath !== canonicalRoot) {
    errors.push("Round23 base external anchor identity/digest binding is stale");
  }
  const withoutDigest = { ...anchor };
  delete withoutDigest.digest;
  if (anchor.digest !== hashCanonical(withoutDigest)) {
    errors.push("Round23 base external anchor canonical digest is stale");
  }
}

function validateBaseSnapshot(snapshot) {
  if (!plainObject(snapshot)) {
    errors.push("Round23 historical review snapshot must be an object");
    return;
  }
  if (snapshot.kind !== "conversation-disclosure-review-snapshot"
    || snapshot.schemaVersion !== 1
    || snapshot.programId !== expectedProgramId
    || snapshot.workstreamId !== "CD03"
    || snapshot.featureId !== "P107-conversation-disclosure-domain-adapters"
    || snapshot.round !== 23
    || snapshot.digest !== baseSnapshotDigest) {
    errors.push("Round23 historical review snapshot identity/digest is stale");
  }
  const withoutDigest = { ...snapshot };
  delete withoutDigest.digest;
  if (snapshot.digest !== hashCanonical(withoutDigest)) {
    errors.push("Round23 historical review snapshot canonical digest is stale");
  }
  if (baseAnchor?.snapshotDigest !== snapshot.digest) {
    errors.push("Round23 base anchor does not bind the historical review snapshot");
  }
}

function validateBaseSnapshotFiles(snapshot) {
  const entries = Array.isArray(snapshot?.files) ? snapshot.files : [];
  const result = new Map();
  if (entries.length === 0) {
    errors.push("Round23 historical review snapshot must contain protected files");
    return result;
  }
  let previous = "";
  for (const [index, entry] of entries.entries()) {
    if (!plainObject(entry)
      || Object.keys(entry).sort().join(",") !== "path,sha256"
      || !repositoryRelativePath(entry.path)
      || !sha256Digest(entry.sha256)) {
      errors.push(`Round23 snapshot files[${index}] is invalid`);
      continue;
    }
    if (result.has(entry.path) || (index > 0 && entry.path <= previous)) {
      errors.push("Round23 snapshot file paths must be unique and sorted");
    }
    result.set(entry.path, entry.sha256);
    previous = entry.path;
  }
  return result;
}

function validateAuthorizedEntries(candidatePolicy, baseFilesByPath) {
  const result = new Map();
  const entries = Array.isArray(candidatePolicy?.successor?.authorizedDriftPaths)
    ? candidatePolicy.successor.authorizedDriftPaths
    : [];
  for (const [index, entry] of entries.entries()) {
    if (!plainObject(entry) || !repositoryRelativePath(entry.path)
      || !["create", "modify"].includes(entry.operation)) {
      errors.push(`continuation policy authorizedDriftPaths[${index}] is invalid`);
      continue;
    }
    if (result.has(entry.path)) {
      errors.push(`continuation policy duplicates authorized path ${entry.path}`);
      continue;
    }
    const baseDigestForPath = baseFilesByPath.get(entry.path);
    if (entry.operation === "modify"
      && (!sha256Digest(entry.baseSha256)
        || entry.baseSha256 !== baseDigestForPath)) {
      errors.push(`authorized modify does not bind the Round23 hash: ${entry.path}`);
    }
    if (entry.operation === "create"
      && (entry.baseSha256 !== null || baseDigestForPath !== undefined)) {
      errors.push(`authorized create must be absent from Round23: ${entry.path}`);
    }
    result.set(entry.path, entry);
  }
  const featurePaths = Array.isArray(candidatePolicy?.successor?.featureDefinition?.files)
    ? new Set(candidatePolicy.successor.featureDefinition.files)
    : new Set();
  for (const relativePath of result.keys()) {
    if (!featurePaths.has(relativePath)) {
      errors.push(`authorized path is absent from the anchored P108 Feature: ${relativePath}`);
    }
  }
  for (const relativePath of featurePaths) {
    const trustRootDenied = typeof continuationContract.isTrustRootPath === "function"
      && continuationContract.isTrustRootPath(relativePath);
    if (!trustRootDenied && !result.has(relativePath)) {
      errors.push(`anchored P108 path lacks explicit create/modify admission: ${relativePath}`);
    }
  }
  return result;
}

function validateExactTargets(candidatePolicy, baseFilesByPath) {
  const result = new Map();
  const addTarget = (entry, digestKey, subject) => {
    if (!plainObject(entry) || !repositoryRelativePath(entry.path)
      || !sha256Digest(entry[digestKey])) {
      errors.push(`${subject} contains an invalid exact target`);
      return;
    }
    const existing = result.get(entry.path);
    if (existing && existing.digest !== entry[digestKey]) {
      errors.push(`continuation exact target conflicts for ${entry.path}`);
      return;
    }
    result.set(entry.path, { digest: entry[digestKey], subject });
  };
  for (const entry of candidatePolicy?.trustRoots ?? []) {
    addTarget(entry, "sha256", "continuation trustRoots");
  }
  for (const entry of candidatePolicy?.continuationExecutables ?? []) {
    addTarget(entry, "sha256", "continuationExecutables");
  }
  for (const entry of candidatePolicy?.governanceTransitions ?? []) {
    addTarget(entry, "toSha256", "governanceTransitions");
    const historicalDigest = baseFilesByPath.get(entry?.path);
    if (!sha256Digest(entry?.fromSha256)
      || historicalDigest !== entry.fromSha256) {
      errors.push(`governance transition does not bind Round23 bytes: ${entry?.path}`);
    }
  }
  const ownCheckerTarget = result.get(checkerPath)?.digest;
  const ownContractTarget = result.get(contractPath)?.digest;
  if (!ownCheckerTarget || !ownContractTarget) {
    errors.push("continuation checker and contract must be exact anchored executable targets");
  }
  for (const relativePath of authorizedEntries.keys()) {
    if (result.has(relativePath) || relativePath === policyPath
      || relativePath === baseSnapshotPath
      || relativePath === continuationManifestPath) {
      errors.push(`ordinary successor drift overlaps a continuation trust root: ${relativePath}`);
    }
  }
  return result;
}

function validateExactTargetBytes(targets) {
  for (const [relativePath, target] of targets) {
    const capture = captures.get(relativePath);
    if (!capture?.exists || capture.digest !== target.digest) {
      errors.push(`${target.subject} target hash is stale: ${relativePath}`);
    }
  }
}

async function loadContinuationClosure(
  manifest,
  candidatePolicy,
  { includeAttestation },
) {
  const snapshotPath = manifest?.snapshot?.path
    ?? candidatePolicy?.reviewSnapshot?.path;
  const snapshotCapture = await captureRepository(
    snapshotPath,
    "CD03A continuation review snapshot",
  );
  const snapshot = parseCapturedJson(snapshotCapture, "CD03A continuation review snapshot");
  for (const entry of snapshot?.files ?? []) {
    const frozenCapture = await captureRepository(
      entry?.path,
      `CD03A frozen continuation file ${entry?.path ?? "unknown"}`,
    );
    if (!frozenCapture?.exists || frozenCapture.digest !== entry?.sha256) {
      errors.push(`CD03A continuation review snapshot hash drift: ${entry?.path}`);
    }
  }
  const receipts = [];
  for (const entry of manifest?.reviewReceipts ?? []) {
    const receiptCapture = await captureRepository(
      entry?.path,
      `CD03A ${entry?.lane ?? "unknown"} continuation review receipt`,
    );
    const receipt = parseCapturedJson(
      receiptCapture,
      `CD03A ${entry?.lane ?? "unknown"} continuation review receipt`,
    );
    if (receipt) receipts.push(receipt);
  }
  let attestation = null;
  if (includeAttestation) {
    const attestationPath = manifest?.externalAttestation?.path;
    const attestationCapture = await captureRepository(
      attestationPath,
      "CD03A continuation external attestation",
    );
    attestation = parseCapturedJson(
      attestationCapture,
      "CD03A continuation external attestation",
    );
  }
  const runnerPath = manifest?.externalRunner?.path
    ?? (candidatePolicy?.continuationExecutables ?? [])
      .find((entry) => entry?.kind === "external_runner")?.path;
  const runnerCapture = await captureRepository(
    runnerPath,
    "CD03A continuation external runner",
  );
  return {
    snapshot,
    receipts,
    attestation,
    runnerDigest: runnerCapture?.digest,
  };
}

function validateContinuationClosure({
  manifest,
  policy: candidatePolicy,
  snapshot,
  receipts,
  attestation,
  runnerDigest,
  continuationAnchor: anchor,
  bootstrapCandidate,
}) {
  errors.push(...callValidator(
    "continuation review snapshot",
    continuationContract.validateContinuationReviewSnapshot,
    snapshot,
    candidatePolicy,
  ).map((error) => `CD03A ${error}`));
  errors.push(...callValidator(
    "continuation closure manifest",
    continuationContract.validateContinuationClosureManifest,
    manifest,
    { policy: candidatePolicy, snapshot },
  ).map((error) => `CD03A ${error}`));
  for (const receipt of receipts) {
    errors.push(...callValidator(
      "continuation review receipt",
      continuationContract.validateContinuationReviewReceipt,
      receipt,
      snapshot,
      candidatePolicy,
    ).map((error) => `CD03A ${error}`));
  }
  errors.push(...callValidator(
    "continuation review set",
    continuationContract.validateContinuationReviewSet,
    receipts,
    snapshot,
    candidatePolicy,
  ).map((error) => `CD03A ${error}`));
  if (bootstrapCandidate) {
    if (candidatePolicy?.status !== "frozen"
      || candidatePolicy?.digest !== options.expectedPolicyDigest) {
      errors.push("bootstrap candidate requires the caller-pinned frozen policy");
    }
    if (snapshot?.digest !== options.expectedSnapshotDigest) {
      errors.push("bootstrap candidate snapshot digest does not match the caller pin");
    }
    if (manifest?.status !== continuationContract.CONTINUATION_STATUS_PENDING) {
      errors.push("bootstrap candidate requires a pending continuation manifest");
    }
    return;
  }
  const validatorDigest = captures.get(checkerPath)?.digest;
  errors.push(...callValidator(
    "continuation external attestation",
    continuationContract.validateContinuationExternalAttestation,
    attestation,
    {
      manifest,
      policy: candidatePolicy,
      snapshot,
      receipts,
      repositoryRealpath: canonicalRoot,
      runnerDigest,
      validatorDigest,
    },
  ).map((error) => `CD03A ${error}`));
  errors.push(...callValidator(
    "continuation external anchor",
    continuationContract.validateContinuationExternalAnchor,
    anchor,
    {
      policy: candidatePolicy,
      snapshot,
      attestation,
      receipts,
      repositoryRealpath: canonicalRoot,
      runnerDigest,
      validatorDigest,
      expectedDigest: options.expectedContinuationAnchorDigest,
    },
  ).map((error) => `CD03A ${error}`));
}

function validateContinuationAnchorCallerBinding(anchor, candidatePolicy) {
  if (!plainObject(anchor)) {
    errors.push("CD03A continuation external anchor must be an object");
    return;
  }
  if (anchor.digest !== options.expectedContinuationAnchorDigest
    || anchor.policyDigest !== candidatePolicy?.digest
    || anchor.baseExternalAnchorDigest !== baseAnchorDigest
    || anchor.baseSnapshotDigest !== baseSnapshotDigest
    || anchor.repositoryRealpath !== canonicalRoot) {
    errors.push("CD03A continuation anchor caller/policy/base binding is stale");
  }
  const withoutDigest = { ...anchor };
  delete withoutDigest.digest;
  if (anchor.digest !== hashCanonical(withoutDigest)) {
    errors.push("CD03A continuation external anchor canonical digest is stale");
  }
  if (anchor.head?.kind !== "successor-admission"
    || anchor.head?.status !== "externally_attested"
    || anchor.head?.workstreamId !== expectedAdmissionWorkstreamId
    || anchor.head?.featureId !== expectedAdmissionFeatureId
    || anchor.head?.successorWorkstreamDefinitionDigest
      !== candidatePolicy?.successor?.workstreamDefinitionDigest
    || anchor.head?.successorFeatureDefinitionDigest
      !== candidatePolicy?.successor?.featureDefinitionDigest) {
    errors.push("CD03A continuation anchor does not bind the exact CD04/P108 admission head");
  }
}

function validateExternallyAnchoredDefinitions({
  program: candidateProgram,
  featureList: candidateFeatureList,
  policy: candidatePolicy,
  bootstrapCandidate,
}) {
  if (candidateProgram?.programId !== expectedProgramId) {
    errors.push(`conversation disclosure programId must remain ${expectedProgramId}`);
  }
  const workstreams = Array.isArray(candidateProgram?.workstreams)
    ? candidateProgram.workstreams
    : [];
  const successorWorkstreams = workstreams.filter(
    (workstream) => workstream?.id === expectedSuccessorWorkstreamId,
  );
  if (successorWorkstreams.length !== 1) {
    errors.push("live program must contain exactly one CD04 workstream");
    return "invalid";
  }
  const workstream = successorWorkstreams[0];
  const stableWorkstream = callProjection(
    "stable CD04 workstream definition",
    continuationContract.stableWorkstreamDefinition,
    workstream,
  );
  if (!stableWorkstream
    || !plainObject(candidatePolicy?.successor?.workstreamDefinition)
    || canonicalJson(stableWorkstream)
      !== canonicalJson(candidatePolicy?.successor?.workstreamDefinition)
    || hashCanonical(stableWorkstream)
      !== candidatePolicy?.successor?.workstreamDefinitionDigest) {
    errors.push("live CD04 definition differs from the externally anchored definition");
  }

  const allFeatures = Array.isArray(candidateFeatureList?.features)
    ? candidateFeatureList.features
    : [];
  const successorFeatures = allFeatures.filter(
    (feature) => feature?.id === expectedSuccessorFeatureId,
  );
  if (successorFeatures.length > 1) {
    errors.push("live Feature list contains duplicate P108 definitions");
  }
  const feature = successorFeatures[0];
  if (feature) {
    const stableFeature = callProjection(
      "stable P108 Feature definition",
      continuationContract.stableFeatureDefinition,
      feature,
    );
    if (!stableFeature
      || !plainObject(candidatePolicy?.successor?.featureDefinition)
      || canonicalJson(stableFeature)
        !== canonicalJson(candidatePolicy?.successor?.featureDefinition)
      || hashCanonical(stableFeature)
        !== candidatePolicy?.successor?.featureDefinitionDigest) {
      errors.push("live P108 definition differs from the externally anchored definition");
    }
  }

  const admissionWorkstream = workstreams.find(
    (candidate) => candidate?.id === expectedAdmissionWorkstreamId,
  );
  const baseWorkstream = workstreams.find((candidate) => candidate?.id === "CD03");
  const admissionFeature = allFeatures.find(
    (candidate) => candidate?.id === expectedAdmissionFeatureId,
  );
  if (baseWorkstream?.state !== "completed") {
    errors.push("CD03 must remain completed before continuation validation");
  }
  if (bootstrapCandidate) {
    if (admissionWorkstream?.state !== "in_progress"
      || admissionFeature?.status !== "in_progress") {
      errors.push("bootstrap candidate requires CD03A/P107A to remain in_progress");
    }
  } else if (admissionWorkstream?.state !== "completed"
    || admissionFeature?.status !== "done") {
    errors.push("CD03A/P107A must be completed before live successor validation");
  }
  const downstreamActive = workstreams.filter((candidate) =>
    ["CD05", "CD06", "CD07", "CD08", "CD09"].includes(candidate?.id)
      && candidate.state !== "planned");
  if (downstreamActive.length > 0) {
    errors.push("CD05-CD09 must remain planned behind the CD04 continuation head");
  }

  if (workstream.state === "planned") {
    if (feature !== undefined) {
      errors.push("planned CD04 must not register P108");
    }
    if (bootstrapCandidate) {
      if (candidateProgram.activeFeatureId !== expectedAdmissionFeatureId
        || candidateProgram.nextFeatureId !== expectedAdmissionFeatureId) {
        errors.push(
          "bootstrap candidate requires P107A as activeFeatureId and nextFeatureId",
        );
      }
      return "bootstrap";
    }
    if (candidateProgram.activeFeatureId !== null
      || candidateProgram.nextFeatureId !== expectedSuccessorFeatureId) {
      errors.push("planned CD04 requires no active Feature and P108 as nextFeatureId");
    }
    return "planned";
  }
  if (bootstrapCandidate) {
    errors.push("bootstrap candidate requires CD04 planned and P108 unregistered");
    return "invalid";
  }
  if (workstream.state === "in_progress") {
    if (feature?.status !== "in_progress") {
      errors.push("active CD04 requires exactly one in_progress P108 Feature");
    }
    if (candidateProgram.activeFeatureId !== expectedSuccessorFeatureId
      || candidateProgram.nextFeatureId !== expectedSuccessorFeatureId) {
      errors.push("active CD04 requires P108 as activeFeatureId and nextFeatureId");
    }
    return "active";
  }
  if (workstream.state === "completed") {
    if (feature?.status !== "done") {
      errors.push("completed CD04 requires exactly one done P108 Feature");
    }
    errors.push(
      "completed CD04 requires a separately reviewed P108 delta anchor; "
      + "a CD03A successor-admission anchor cannot prove completed live bytes",
    );
    return "completed_unanchored";
  }
  errors.push("CD04 lifecycle state is invalid");
  return "invalid";
}

function validateLiveProtectedBytes({
  lifecycle,
  baseFiles: baseFilesByPath,
  authorizedEntries: authorizedByPath,
  exactTargets: targets,
}) {
  const drift = [];
  for (const [relativePath, baseDigestForPath] of baseFilesByPath) {
    const current = captures.get(relativePath);
    const exactTarget = targets.get(relativePath);
    const authorized = authorizedByPath.get(relativePath);
    if (!current?.exists) {
      errors.push(`Round23 protected file is missing: ${relativePath}`);
      continue;
    }
    if (exactTarget) {
      if (current.digest !== exactTarget.digest) {
        errors.push(`continuation trust/transition target drift: ${relativePath}`);
      }
      if (current.digest !== baseDigestForPath) {
        drift.push({
          path: relativePath,
          before: baseDigestForPath,
          after: current.digest,
          authority: "externally_reviewed_trust_transition",
        });
      }
      continue;
    }
    if (lifecycle === "active" && authorized?.operation === "modify") {
      if (current.digest !== baseDigestForPath) {
        drift.push({
          path: relativePath,
          before: baseDigestForPath,
          after: current.digest,
          authority: "authorized_unreviewed",
        });
      }
      continue;
    }
    if (current.digest !== baseDigestForPath) {
      errors.push(`unauthorized Round23 protected-file drift: ${relativePath}`);
    }
  }
  for (const [relativePath, authorized] of authorizedByPath) {
    if (authorized.operation !== "create") continue;
    const current = captures.get(relativePath);
    if (lifecycle === "planned" || lifecycle === "bootstrap") {
      if (current?.exists) {
        errors.push(
          `planned CD04 must not pre-create admitted P108 path: ${relativePath}`,
        );
      }
      continue;
    }
    if (lifecycle === "active" && current?.exists) {
      drift.push({
        path: relativePath,
        before: null,
        after: current.digest,
        authority: "authorized_unreviewed",
      });
    }
  }
  return drift.sort((left, right) => left.path.localeCompare(right.path));
}

async function postflightRehash() {
  for (const [relativePath, before] of captures) {
    if (!before || typeof relativePath !== "string") {
      errors.push("continuation control set contains an unreadable path");
      continue;
    }
    const after = await secureReadRepositoryFile(
      relativePath,
      `postflight control file ${relativePath}`,
      { allowMissing: !before.exists },
    );
    if (!sameCapture(before, after)) {
      errors.push(`continuation control file changed during validation: ${relativePath}`);
    }
  }
  for (const [absolutePath, before] of absoluteCaptures) {
    if (!before || typeof absolutePath !== "string") {
      errors.push("external anchor control set contains an unreadable path");
      continue;
    }
    const after = await secureReadAbsoluteFile(
      absolutePath,
      `postflight external anchor ${absolutePath}`,
    );
    if (!sameCapture(before, after)) {
      errors.push(`external anchor changed during validation: ${absolutePath}`);
    }
  }
}

async function captureRepository(relativePath, label, options = {}) {
  if (captures.has(relativePath)) return captures.get(relativePath);
  const capture = await secureReadRepositoryFile(relativePath, label, options);
  captures.set(relativePath, capture);
  return capture;
}

async function captureAbsolute(absolutePath, label) {
  if (!path.isAbsolute(absolutePath ?? "")) return null;
  if (absoluteCaptures.has(absolutePath)) return absoluteCaptures.get(absolutePath);
  const capture = await secureReadAbsoluteFile(absolutePath, label);
  absoluteCaptures.set(absolutePath, capture);
  return capture;
}

async function secureReadRepositoryFile(relativePath, label, { allowMissing = false } = {}) {
  if (!repositoryRelativePath(relativePath)) {
    errors.push(`${label} must be a normalized repository-relative path`);
    return null;
  }
  return secureReadFile(path.resolve(root, relativePath), label, {
    allowMissing,
    expectedInsideRoot: true,
    requirePrivate: false,
  });
}

async function secureReadAbsoluteFile(absolutePath, label) {
  if (!path.isAbsolute(absolutePath ?? "")) {
    errors.push(`${label} path must be absolute`);
    return null;
  }
  try {
    const requestedPath = path.resolve(absolutePath);
    const requestedEntry = await lstat(requestedPath);
    if (requestedEntry.isSymbolicLink() || !requestedEntry.isFile()
      || requestedEntry.nlink !== 1) {
      errors.push(`${label} must be a unique regular non-symlink file`);
      return null;
    }
    // macOS exposes /tmp as a stable parent alias. Resolve the parent once,
    // then apply the no-symlink/inode checks to the canonical path and compare
    // the canonical leaf with the originally requested leaf.
    const canonicalParent = await realpath(path.dirname(requestedPath));
    const canonicalPath = path.join(canonicalParent, path.basename(requestedPath));
    if (canonicalPath === canonicalRoot
      || canonicalPath.startsWith(`${canonicalRoot}${path.sep}`)) {
      errors.push(`${label} must remain outside the candidate repository`);
      return null;
    }
    const capture = await secureReadFile(canonicalPath, label, {
      allowMissing: false,
      expectedInsideRoot: false,
      requirePrivate: true,
    });
    if (capture?.exists && (capture.dev !== requestedEntry.dev
      || capture.ino !== requestedEntry.ino)) {
      errors.push(`${label} requested and canonical leaf identities differ`);
      return null;
    }
    return capture;
  } catch {
    errors.push(`${label} does not exist or changed identity`);
    return null;
  }
}

async function secureReadFile(
  targetPath,
  label,
  { allowMissing, expectedInsideRoot, requirePrivate },
) {
  const parsed = path.parse(targetPath);
  const segments = targetPath.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let cursor = parsed.root;
  const parentIdentity = [];
  let filePathStat;
  try {
    for (const [index, segment] of segments.entries()) {
      cursor = path.join(cursor, segment);
      let entry;
      try {
        entry = await lstat(cursor);
      } catch (error) {
        if (allowMissing && error?.code === "ENOENT") {
          return {
            exists: false,
            digest: null,
            bytes: null,
            dev: null,
            ino: null,
            mode: null,
            uid: null,
            parentIdentity,
            missingAt: cursor,
          };
        }
        throw error;
      }
      const isLeaf = index === segments.length - 1;
      if (entry.isSymbolicLink()) {
        errors.push(`${label} must not traverse a symbolic link`);
        return null;
      }
      if (!isLeaf) {
        if (!entry.isDirectory()) {
          errors.push(`${label} parent must remain a directory`);
          return null;
        }
        parentIdentity.push({ path: cursor, dev: entry.dev, ino: entry.ino });
      } else {
        if (!entry.isFile() || entry.nlink !== 1) {
          errors.push(`${label} must be a unique regular non-symlink file`);
          return null;
        }
        filePathStat = entry;
      }
    }
    const handle = await open(targetPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.nlink !== 1
        || opened.dev !== filePathStat.dev || opened.ino !== filePathStat.ino) {
        errors.push(`${label} changed identity while opening`);
        return null;
      }
      if (requirePrivate && (opened.uid !== process.geteuid()
        || (opened.mode & 0o777) !== 0o600)) {
        errors.push(`${label} must be effective-user-owned mode 0600`);
        return null;
      }
      const bytes = await handle.readFile();
      const after = await handle.stat();
      if (after.dev !== opened.dev || after.ino !== opened.ino
        || after.nlink !== 1 || after.size !== bytes.length
        || after.uid !== opened.uid
        || (after.mode & 0o777) !== (opened.mode & 0o777)) {
        errors.push(`${label} changed identity or bytes while reading`);
        return null;
      }
      for (const parent of parentIdentity) {
        const current = await lstat(parent.path);
        if (current.isSymbolicLink() || !current.isDirectory()
          || current.dev !== parent.dev || current.ino !== parent.ino) {
          errors.push(`${label} parent identity changed while reading`);
          return null;
        }
      }
      const leaf = await lstat(targetPath);
      if (leaf.isSymbolicLink() || !leaf.isFile() || leaf.nlink !== 1
        || leaf.dev !== opened.dev || leaf.ino !== opened.ino) {
        errors.push(`${label} pathname identity changed while reading`);
        return null;
      }
      if (expectedInsideRoot) {
        const canonicalTarget = await realpath(targetPath);
        if (canonicalTarget === canonicalRoot
          || !canonicalTarget.startsWith(`${canonicalRoot}${path.sep}`)) {
          errors.push(`${label} must resolve inside the repository`);
          return null;
        }
      }
      return {
        exists: true,
        bytes,
        digest: sha256Bytes(bytes),
        dev: opened.dev,
        ino: opened.ino,
        mode: opened.mode & 0o777,
        uid: opened.uid,
        parentIdentity,
        missingAt: null,
      };
    } finally {
      await handle.close();
    }
  } catch {
    errors.push(`${label} does not exist or changed identity`);
    return null;
  }
}

function sameCapture(left, right) {
  if (!left || !right || left.exists !== right.exists) return false;
  if (!left.exists) {
    return left.missingAt === right.missingAt
      && sameParentIdentity(left.parentIdentity, right.parentIdentity);
  }
  return left.digest === right.digest
    && left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.uid === right.uid
    && sameParentIdentity(left.parentIdentity, right.parentIdentity);
}

function sameParentIdentity(left, right) {
  return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length
    && left.every((entry, index) => entry.path === right[index]?.path
      && entry.dev === right[index]?.dev && entry.ino === right[index]?.ino);
}

function parseCapturedJson(capture, label) {
  if (!capture?.exists || !capture.bytes) return null;
  try {
    return JSON.parse(capture.bytes.toString("utf8"));
  } catch {
    errors.push(`${label} must contain valid JSON`);
    return null;
  }
}

function callValidator(label, validator, ...args) {
  if (typeof validator !== "function") {
    errors.push(`${label} validator is unavailable`);
    return [];
  }
  try {
    const result = validator(...args);
    if (!Array.isArray(result)) {
      errors.push(`${label} validator must return an error array`);
      return [];
    }
    return result;
  } catch {
    errors.push(`${label} validator threw while checking untrusted input`);
    return [];
  }
}

function callProjection(label, projection, value) {
  if (typeof projection !== "function") {
    errors.push(`${label} projection is unavailable`);
    return null;
  }
  try {
    return projection(value);
  } catch {
    errors.push(`${label} projection rejected the live definition`);
    return null;
  }
}

function parseOptions(args) {
  const values = {
    bootstrapCandidate: false,
    baseAnchorPath: undefined,
    expectedBaseAnchorDigest: undefined,
    continuationAnchorPath: undefined,
    expectedContinuationAnchorDigest: undefined,
    expectedPolicyDigest: undefined,
    expectedSnapshotDigest: undefined,
    errors: [],
  };
  const names = new Map([
    ["--base-anchor", "baseAnchorPath"],
    ["--expected-base-anchor-digest", "expectedBaseAnchorDigest"],
    ["--continuation-anchor", "continuationAnchorPath"],
    ["--expected-continuation-anchor-digest", "expectedContinuationAnchorDigest"],
    ["--expected-policy-digest", "expectedPolicyDigest"],
    ["--expected-snapshot-digest", "expectedSnapshotDigest"],
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--bootstrap-candidate") {
      if (values.bootstrapCandidate) {
        values.errors.push("--bootstrap-candidate may be supplied only once");
      }
      values.bootstrapCandidate = true;
      continue;
    }
    let matched = false;
    for (const [name, key] of names) {
      if (argument === name) {
        if (values[key] !== undefined) {
          values.errors.push(`${name} may be supplied only once`);
        }
        values[key] = args[index + 1];
        index += 1;
        matched = true;
        break;
      }
      if (argument.startsWith(`${name}=`)) {
        if (values[key] !== undefined) {
          values.errors.push(`${name} may be supplied only once`);
        }
        values[key] = argument.slice(name.length + 1);
        matched = true;
        break;
      }
    }
    if (!matched) values.errors.push(`unknown continuation checker option: ${argument}`);
  }
  for (const [name, key] of [
    ["--base-anchor", "baseAnchorPath"],
    ["--expected-base-anchor-digest", "expectedBaseAnchorDigest"],
  ]) {
    if (values[key] === undefined || values[key] === "") {
      values.errors.push(`${name} is required`);
    }
  }
  if (values.bootstrapCandidate) {
    for (const [name, key] of [
      ["--expected-policy-digest", "expectedPolicyDigest"],
      ["--expected-snapshot-digest", "expectedSnapshotDigest"],
    ]) {
      if (values[key] === undefined || values[key] === "") {
        values.errors.push(`${name} is required with --bootstrap-candidate`);
      }
    }
    if (values.continuationAnchorPath !== undefined
      || values.expectedContinuationAnchorDigest !== undefined) {
      values.errors.push(
        "--bootstrap-candidate forbids continuation anchor path/digest arguments",
      );
    }
  } else {
    for (const [name, key] of [
      ["--continuation-anchor", "continuationAnchorPath"],
      ["--expected-continuation-anchor-digest", "expectedContinuationAnchorDigest"],
    ]) {
      if (values[key] === undefined || values[key] === "") {
        values.errors.push(`${name} is required`);
      }
    }
    if (values.expectedPolicyDigest !== undefined
      || values.expectedSnapshotDigest !== undefined) {
      values.errors.push(
        "policy/snapshot caller pins are accepted only with --bootstrap-candidate",
      );
    }
  }
  if (values.baseAnchorPath !== undefined && !path.isAbsolute(values.baseAnchorPath)) {
    values.errors.push("--base-anchor must be an absolute path");
  }
  if (values.continuationAnchorPath !== undefined
    && !path.isAbsolute(values.continuationAnchorPath)) {
    values.errors.push("--continuation-anchor must be an absolute path");
  }
  if (!sha256Digest(values.expectedBaseAnchorDigest)) {
    values.errors.push("--expected-base-anchor-digest must be sha256:<64 hex>");
  }
  if (!values.bootstrapCandidate
    && !sha256Digest(values.expectedContinuationAnchorDigest)) {
    values.errors.push("--expected-continuation-anchor-digest must be sha256:<64 hex>");
  }
  if (values.bootstrapCandidate && !sha256Digest(values.expectedPolicyDigest)) {
    values.errors.push("--expected-policy-digest must be sha256:<64 hex>");
  }
  if (values.bootstrapCandidate && !sha256Digest(values.expectedSnapshotDigest)) {
    values.errors.push("--expected-snapshot-digest must be sha256:<64 hex>");
  }
  if (values.expectedBaseAnchorDigest !== undefined
    && values.expectedBaseAnchorDigest !== baseAnchorDigest) {
    values.errors.push("caller-pinned base digest must be the accepted Round23 anchor digest");
  }
  if (values.baseAnchorPath && values.continuationAnchorPath
    && path.resolve(values.baseAnchorPath) === path.resolve(values.continuationAnchorPath)) {
    values.errors.push("base and continuation anchors must use distinct files");
  }
  return values;
}

function hashCanonical(value) {
  if (typeof continuationContract.hashCanonical === "function") {
    return continuationContract.hashCanonical(value);
  }
  return sha256Bytes(Buffer.from(canonicalJson(value), "utf8"));
}

function canonicalJson(value) {
  if (typeof continuationContract.canonicalJson === "function") {
    return continuationContract.canonicalJson(value);
  }
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256Bytes(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function sha256Digest(value) {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
}

function repositoryRelativePath(value) {
  if (typeof value !== "string" || value.length === 0 || path.isAbsolute(value)) {
    return false;
  }
  if (value.includes("\\") || value.normalize("NFC") !== value) return false;
  const normalized = path.posix.normalize(value);
  if (normalized !== value || normalized === "." || normalized.startsWith("../")) {
    return false;
  }
  const target = path.resolve(root, value);
  return target !== root && target.startsWith(`${root}${path.sep}`);
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
