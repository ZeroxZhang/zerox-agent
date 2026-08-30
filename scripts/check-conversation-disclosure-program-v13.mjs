#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  captureStableFileV12,
  createCaptureLedgerV12,
  postflightCaptureLedgerV12,
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

export async function checkConversationDisclosureProgramV13(options = {}) {
  const diagnosticOnly = options.diagnosticOnly ?? false;
  const captureLedger = createCaptureLedgerV12();
  const [snapshotCapture, featureList, program] = await Promise.all([
    readStableJson(CD04_DELTA_SNAPSHOT_PATH, true, false, captureLedger),
    readStableJson(".zerox/feature_list.json", false, false, captureLedger),
    readStableJson(
      ".zerox/conversation-disclosure-program.json",
      false,
      false,
      captureLedger,
    ),
  ]);
  const snapshot = snapshotCapture.value;
  const errors = validateCd04DeltaSnapshotV13(snapshot);
  await validateFrozenEntries(snapshot, errors, captureLedger);
  await validateArtifacts(snapshot, errors, captureLedger);
  const transitionState = await validateTransitionState(
    snapshot,
    errors,
    captureLedger,
  );
  validateLifecycle(program.value, featureList.value, transitionState, errors);

  let manifest;
  let anchor;
  let receipts;
  if (transitionState === "target") {
    if (!diagnosticOnly) {
      ({ manifest, anchor, receipts } = await validateClosure(
        snapshot,
        options,
        errors,
        captureLedger,
      ));
    }
  } else if (!diagnosticOnly) {
    errors.push("authoritative V13 checking requires the completed target state");
  }
  await readStableJson(
    CD04_DELTA_SNAPSHOT_PATH,
    true,
    false,
    captureLedger,
  );
  await validateFrozenEntries(snapshot, errors, captureLedger);
  await validateArtifacts(snapshot, errors, captureLedger);
  const postflightTransitionState = await validateTransitionState(
    snapshot,
    errors,
    captureLedger,
  );
  if (postflightTransitionState !== transitionState) {
    errors.push("CD04 transition state changed during V13 checking");
  }
  if (transitionState === "target" && !diagnosticOnly) {
    await validateClosure(snapshot, options, errors, captureLedger);
  }
  if (typeof options.beforeFinalPostflight === "function") {
    await options.beforeFinalPostflight();
  }
  await postflightCaptureLedgerV12(captureLedger);
  if (errors.length > 0) {
    throw new Error(`Conversation disclosure V13 check failed:\n- ${
      errors.join("\n- ")
    }`);
  }
  return withCanonicalDigestV13({
    schemaVersion: CD04_DELTA_SCHEMA_VERSION,
    kind: "conversation-disclosure-program-v13-receipt",
    status: "passed",
    authoritative: !diagnosticOnly,
    mode: diagnosticOnly ? "local_unpinned_diagnostic" : "authorized_active",
    programId: CD04_DELTA_PROGRAM_ID,
    featureId: transitionState === "target"
      ? CD04_DELTA_SUCCESSOR_FEATURE_ID
      : CD04_DELTA_FEATURE_ID,
    snapshotDigest: snapshot.digest,
    transitionState,
    ...(manifest ? { manifestDigest: manifest.digest } : {}),
    ...(anchor ? { deltaAnchorDigest: anchor.digest } : {}),
    ...(receipts
      ? {
          receiptDigests: Object.fromEntries(
            CD04_DELTA_REVIEW_LANES.map(
              (lane) => [lane, receipts[lane].digest],
            ),
          ),
        }
      : {}),
  });
}

async function validateClosure(snapshot, options, errors, captureLedger) {
  if (
    !path.isAbsolute(options.deltaAnchor ?? "")
    || !/^sha256:[0-9a-f]{64}$/.test(
      options.expectedDeltaAnchorDigest ?? "",
    )
  ) {
    errors.push("caller-pinned CD04 delta anchor path and digest are required");
    return {};
  }
  const receiptEntries = await Promise.all(
    CD04_DELTA_REVIEW_LANES.map(async (lane) => {
      const receipt = (
        await readStableJson(
          CD04_DELTA_RECEIPT_PATHS[lane],
          true,
          false,
          captureLedger,
        )
      ).value;
      const reviewOutput = await readStableJson(
        CD04_DELTA_REVIEW_OUTPUT_PATHS[lane],
        false,
        false,
        captureLedger,
      );
      errors.push(...validateCd04ReviewOutputV13(
        reviewOutput.value,
        snapshot,
        lane,
      ));
      errors.push(...validateCd04ReviewReceiptV13(
        receipt,
        snapshot,
        lane,
        reviewOutput.value,
      ));
      if (
        reviewOutput.sha256 !== receipt.reviewOutputSha256
      ) {
        errors.push(`${lane} receipt is not bound to its review output`);
      }
      return [lane, receipt];
    }),
  );
  const receipts = Object.fromEntries(receiptEntries);
  const [manifestCapture, reviewBytes, anchorCapture] = await Promise.all([
    readStableJson(
      CD04_DELTA_MANIFEST_PATH,
      true,
      false,
      captureLedger,
    ),
    readStableBytes(
      path.join(root, CD04_DELTA_REVIEW_PATH),
      false,
      captureLedger,
    ),
    readStableJson(options.deltaAnchor, true, true, captureLedger),
  ]);
  const manifest = manifestCapture.value;
  errors.push(...validateCd04ReviewArtifactV13(
    reviewBytes.toString("utf8"),
    snapshot,
    receipts,
  ));
  if (manifest.reviewArtifactSha256 !== sha256BytesV13(reviewBytes)) {
    errors.push("CD04 review artifact digest differs from the manifest");
  }
  errors.push(
    ...validateCd04DeltaManifestV13(manifest, snapshot, receipts),
  );
  const anchor = anchorCapture.value;
  errors.push(...validateCd04DeltaAnchorV13(anchor, manifest, snapshot));
  if (
    anchor.digest !== options.expectedDeltaAnchorDigest
    || anchor.repositoryRealpath !== root
  ) {
    errors.push("caller-pinned CD04 delta anchor does not match this repository");
  }
  return { manifest, anchor, receipts };
}

async function validateFrozenEntries(snapshot, errors, captureLedger) {
  for (const entry of snapshot.frozenEntries ?? []) {
    try {
      const bytes = await readStableBytes(
        path.join(root, entry.path),
        false,
        captureLedger,
      );
      if (sha256BytesV13(bytes) !== entry.sha256) {
        errors.push(`frozen P108 file drifted: ${entry.path}`);
      }
    } catch {
      errors.push(`frozen P108 file is unavailable: ${entry.path}`);
    }
  }
}

async function validateArtifacts(snapshot, errors, captureLedger) {
  for (const [name, artifact] of Object.entries(snapshot.artifacts ?? {})) {
    try {
      const capture = await readStableJson(
        artifact.path,
        true,
        false,
        captureLedger,
      );
      if (
        capture.sha256 !== artifact.sha256
        || capture.value.digest !== artifact.canonicalDigest
        || capture.value.accepted !== true
      ) {
        errors.push(`${name} artifact no longer matches the reviewed snapshot`);
      }
    } catch {
      errors.push(`${name} artifact is unavailable`);
    }
  }
}

async function validateTransitionState(snapshot, errors, captureLedger) {
  const states = [];
  for (const transition of snapshot.transitions ?? []) {
    try {
      const [live, target] = await Promise.all([
        readStableBytes(
          path.join(root, transition.path),
          false,
          captureLedger,
        ),
        readStableBytes(
          path.join(root, transition.targetPath),
          false,
          captureLedger,
        ),
      ]);
      const liveDigest = sha256BytesV13(live);
      const targetDigest = sha256BytesV13(target);
      if (targetDigest !== transition.toSha256) {
        errors.push(`transition target drifted: ${transition.targetPath}`);
      }
      states.push(
        liveDigest === transition.fromSha256
          ? "source"
          : liveDigest === transition.toSha256
            ? "target"
            : "third",
      );
    } catch {
      errors.push(`transition input is unavailable: ${transition.path}`);
      states.push("third");
    }
  }
  if (states.every((state) => state === "source")) return "source";
  if (states.every((state) => state === "target")) return "target";
  errors.push("CD04 governance transitions are mixed or third-state");
  return "mixed";
}

function validateLifecycle(program, featureList, transitionState, errors) {
  if (
    program.programId !== CD04_DELTA_PROGRAM_ID
    || program.status !== "active"
    || program.maxActiveFeatures !== 1
  ) {
    errors.push("conversation disclosure program identity is invalid");
    return;
  }
  const cd04 = program.workstreams?.find(
    (entry) => entry.id === CD04_DELTA_WORKSTREAM_ID,
  );
  const cd05 = program.workstreams?.find(
    (entry) => entry.id === CD04_DELTA_SUCCESSOR_WORKSTREAM_ID,
  );
  const p108 = featureList.features?.find(
    (entry) => entry.id === CD04_DELTA_FEATURE_ID,
  );
  const p109 = featureList.features?.find(
    (entry) => entry.id === CD04_DELTA_SUCCESSOR_FEATURE_ID,
  );
  if (transitionState === "source") {
    if (
      cd04?.state !== "in_progress"
      || cd05?.state !== "planned"
      || p108?.status !== "in_progress"
      || p109 !== undefined
      || program.activeFeatureId !== CD04_DELTA_FEATURE_ID
      || program.nextFeatureId !== CD04_DELTA_FEATURE_ID
    ) {
      errors.push("P108 pre-transition lifecycle is invalid");
    }
    return;
  }
  if (transitionState === "target") {
    if (
      cd04?.state !== "completed"
      || cd05?.state !== "in_progress"
      || p108?.status !== "done"
      || p109?.status !== "in_progress"
      || program.activeFeatureId !== CD04_DELTA_SUCCESSOR_FEATURE_ID
      || program.nextFeatureId !== CD04_DELTA_SUCCESSOR_FEATURE_ID
    ) {
      errors.push("P108/P109 post-transition lifecycle is invalid");
    }
  }
}

async function readStableJson(
  relativeOrAbsolute,
  requirePrivate,
  absolute,
  captureLedger,
) {
  const filePath = absolute
    ? relativeOrAbsolute
    : path.join(root, relativeOrAbsolute);
  const bytes = await readStableBytes(
    filePath,
    requirePrivate,
    captureLedger,
  );
  return {
    value: JSON.parse(bytes.toString("utf8")),
    sha256: sha256BytesV13(bytes),
  };
}

async function readStableBytes(
  filePath,
  requirePrivate = false,
  captureLedger,
) {
  const expectedRoot = filePath === root || filePath.startsWith(`${root}${path.sep}`)
    ? root
    : undefined;
  const capture = await captureStableFileV12(filePath, filePath, {
    expectedRoot,
    ledger: captureLedger,
    requirePrivate,
  });
  return capture.bytes;
}

function parseArguments(argv) {
  const options = {
    diagnosticOnly: false,
    deltaAnchor: process.env.ZEROX_CD04_DELTA_ANCHOR,
    expectedDeltaAnchorDigest:
      process.env.ZEROX_CD04_DELTA_ANCHOR_DIGEST,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--diagnostic-only") {
      options.diagnosticOnly = true;
    } else if (value === "--delta-anchor") {
      options.deltaAnchor = argv[++index];
    } else if (value === "--expected-delta-anchor-digest") {
      options.expectedDeltaAnchorDigest = argv[++index];
    } else {
      throw new Error(`unknown argument: ${value}`);
    }
  }
  if (
    options.diagnosticOnly
    && (options.deltaAnchor || options.expectedDeltaAnchorDigest)
  ) {
    throw new Error(
      "--diagnostic-only cannot be combined with authoritative caller pins",
    );
  }
  return options;
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    const receipt = await checkConversationDisclosureProgramV13(
      parseArguments(process.argv.slice(2)),
    );
    console.log("Conversation disclosure program V13 check passed.");
    console.log(JSON.stringify(receipt));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
