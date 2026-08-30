#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  captureStableFileV12,
  publishPrivateExactV12,
} from "./conversation-disclosure-continuation-runtime-io-v12.mjs";

import {
  CD04_DELTA_FEATURE_ID,
  CD04_DELTA_MANIFEST_PATH,
  CD04_DELTA_PROGRAM_ID,
  CD04_DELTA_RECEIPT_PATHS,
  CD04_DELTA_REVIEW_LANES,
  CD04_DELTA_REVIEW_OUTPUT_PATHS,
  CD04_DELTA_REVIEW_PATH,
  CD04_DELTA_SCHEMA_VERSION,
  CD04_DELTA_SNAPSHOT_PATH,
  CD04_DELTA_SUCCESSOR_FEATURE_ID,
  CD04_DELTA_SUCCESSOR_WORKSTREAM_ID,
  CD04_DELTA_WORKSTREAM_ID,
  hashCanonicalV13,
  sha256BytesV13,
  validateCd04DeltaAnchorV13,
  validateCd04DeltaManifestV13,
  validateCd04DeltaSnapshotV13,
  validateCd04ReviewArtifactV13,
  validateCd04ReviewOutputV13,
  validateCd04ReviewReceiptV13,
  withCanonicalDigestV13,
} from "./conversation-disclosure-delta-contract-v13.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function buildCd04DeltaAnchorV13(options) {
  const snapshot = (
    await readStableJson(path.join(root, CD04_DELTA_SNAPSHOT_PATH), true)
  ).value;
  const snapshotErrors = validateCd04DeltaSnapshotV13(snapshot);
  if (snapshotErrors.length > 0) {
    throw new Error(`invalid CD04 snapshot: ${snapshotErrors.join("; ")}`);
  }
  if (
    path.resolve(options.continuationAnchor) !== snapshot.parent.anchorPath
    || options.expectedContinuationAnchorDigest
      !== snapshot.parent.anchorDigest
  ) {
    throw new Error("caller continuation pin differs from the review snapshot");
  }
  const parentEvidence = (
    await readStableJson(path.resolve(options.continuationAnchor), true)
  ).value;
  const {
    digest: parentEvidenceDigest,
    ...parentEvidenceWithoutDigest
  } = parentEvidence;
  if (
    parentEvidenceDigest !== options.expectedContinuationAnchorDigest
    || parentEvidenceDigest !== snapshot.parent.anchorDigest
    || hashCanonicalV13(parentEvidenceWithoutDigest) !== parentEvidenceDigest
    || parentEvidence.policyDigest !== snapshot.parent.policyDigest
    || parentEvidence.snapshotDigest !== snapshot.parent.snapshotDigest
  ) {
    throw new Error("Round12 parent evidence differs from the caller pin");
  }
  await rehashSnapshot(snapshot);
  const receipts = Object.fromEntries(await Promise.all(
    CD04_DELTA_REVIEW_LANES.map(async (lane) => {
      const value = (
        await readStableJson(
          path.join(root, CD04_DELTA_RECEIPT_PATHS[lane]),
          true,
        )
      ).value;
      const reviewOutput = await readStableJson(path.join(
        root,
        CD04_DELTA_REVIEW_OUTPUT_PATHS[lane],
      ));
      const errors = [
        ...validateCd04ReviewOutputV13(
          reviewOutput.value,
          snapshot,
          lane,
        ),
        ...validateCd04ReviewReceiptV13(
          value,
          snapshot,
          lane,
          reviewOutput.value,
        ),
      ];
      if (errors.length > 0) {
        throw new Error(`${lane} receipt is invalid: ${errors.join("; ")}`);
      }
      if (
        reviewOutput.sha256 !== value.reviewOutputSha256
      ) {
        throw new Error(`${lane} receipt is not bound to its review output`);
      }
      return [lane, value];
    }),
  ));
  const reviewBytes = await readStableBytes(
    path.join(root, CD04_DELTA_REVIEW_PATH),
  );
  const reviewErrors = validateCd04ReviewArtifactV13(
    reviewBytes.toString("utf8"),
    snapshot,
    receipts,
  );
  if (reviewErrors.length > 0) {
    throw new Error(`invalid CD04 review artifact: ${reviewErrors.join("; ")}`);
  }
  const completedAt = options.completedAt ?? new Date().toISOString();
  const head = {
    kind: "reviewed-delta",
    status: "externally_attested",
    completedFeatureId: CD04_DELTA_FEATURE_ID,
    successorFeatureId: CD04_DELTA_SUCCESSOR_FEATURE_ID,
    successorWorkstreamId: CD04_DELTA_SUCCESSOR_WORKSTREAM_ID,
  };
  const manifest = withCanonicalDigestV13({
    schemaVersion: CD04_DELTA_SCHEMA_VERSION,
    kind: "conversation-disclosure-cd04-reviewed-delta-manifest",
    programId: CD04_DELTA_PROGRAM_ID,
    featureId: CD04_DELTA_FEATURE_ID,
    workstreamId: CD04_DELTA_WORKSTREAM_ID,
    completedAt,
    snapshotDigest: snapshot.digest,
    parentAnchorDigest: snapshot.parent.anchorDigest,
    parentEvidence,
    receiptDigests: Object.fromEntries(
      CD04_DELTA_REVIEW_LANES.map((lane) => [lane, receipts[lane].digest]),
    ),
    reviewArtifactSha256: sha256BytesV13(reviewBytes),
    transitionDigest: hashCanonicalV13(snapshot.transitions),
    head,
  });
  const manifestErrors = validateCd04DeltaManifestV13(
    manifest,
    snapshot,
    receipts,
  );
  if (manifestErrors.length > 0) {
    throw new Error(`invalid CD04 manifest: ${manifestErrors.join("; ")}`);
  }
  await publishPrivateJson(
    path.join(root, CD04_DELTA_MANIFEST_PATH),
    manifest,
  );
  const anchor = withCanonicalDigestV13({
    schemaVersion: CD04_DELTA_SCHEMA_VERSION,
    kind: "conversation-disclosure-cd04-external-delta-anchor",
    identityAssurance: "not-signed",
    reviewAssurance: "caller-attested-not-signed",
    repositoryRealpath: root,
    completedAt,
    snapshotDigest: snapshot.digest,
    manifestDigest: manifest.digest,
    parentAnchorDigest: snapshot.parent.anchorDigest,
    head,
  });
  const anchorErrors = validateCd04DeltaAnchorV13(
    anchor,
    manifest,
    snapshot,
  );
  if (anchorErrors.length > 0) {
    throw new Error(`invalid CD04 delta anchor: ${anchorErrors.join("; ")}`);
  }
  return { snapshot, receipts, manifest, anchor };
}

async function rehashSnapshot(snapshot) {
  for (const entry of snapshot.frozenEntries) {
    const bytes = await readStableBytes(path.join(root, entry.path));
    if (sha256BytesV13(bytes) !== entry.sha256) {
      throw new Error(`frozen P108 file drifted: ${entry.path}`);
    }
  }
  for (const transition of snapshot.transitions) {
    const [live, target] = await Promise.all([
      readStableBytes(path.join(root, transition.path)),
      readStableBytes(path.join(root, transition.targetPath)),
    ]);
    if (
      sha256BytesV13(live) !== transition.fromSha256
      || sha256BytesV13(target) !== transition.toSha256
    ) {
      throw new Error(`CD04 transition drifted: ${transition.path}`);
    }
  }
}

async function readStableJson(filePath, requirePrivate) {
  const bytes = await readStableBytes(filePath, requirePrivate);
  return {
    value: JSON.parse(bytes.toString("utf8")),
    sha256: sha256BytesV13(bytes),
  };
}

async function readStableBytes(filePath, requirePrivate = false) {
  const expectedRoot = filePath === root || filePath.startsWith(`${root}${path.sep}`)
    ? root
    : undefined;
  return (await captureStableFileV12(filePath, filePath, {
    expectedRoot,
    requirePrivate,
  })).bytes;
}

async function publishPrivateJson(filePath, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  try {
    const existing = await readStableBytes(filePath, true);
    if (existing.equals(bytes)) return;
    throw new Error(`refusing to replace CD04 evidence: ${filePath}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await publishPrivateExactV12(filePath, bytes, {
    expectedRoot: root,
    label: "CD04 reviewed delta manifest",
  });
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[++index];
    if (key === "--continuation-anchor") {
      options.continuationAnchor = value;
    } else if (key === "--expected-continuation-anchor-digest") {
      options.expectedContinuationAnchorDigest = value;
    } else if (key === "--completed-at") options.completedAt = value;
    else throw new Error(`unknown argument: ${key}`);
  }
  for (const key of [
    "continuationAnchor",
    "expectedContinuationAnchorDigest",
  ]) {
    if (!options[key]) throw new Error(`${key} is required`);
  }
  if (
    !path.isAbsolute(options.continuationAnchor)
  ) {
    throw new Error("all caller anchor paths must be absolute");
  }
  return options;
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    const result = await buildCd04DeltaAnchorV13(
      parseArguments(process.argv.slice(2)),
    );
    console.log(JSON.stringify({
      ok: true,
      snapshotDigest: result.snapshot.digest,
      manifestDigest: result.manifest.digest,
      anchorDigest: result.anchor.digest,
      externalAnchor: result.anchor,
    }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
