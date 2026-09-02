#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { constants, existsSync, realpathSync } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractFile, listPackage } from "@electron/asar";

import {
  CD04_DELTA_MANIFEST_PATH,
  CD04_DELTA_SNAPSHOT_PATH,
  hashCanonicalV13,
  sha256BytesV13,
} from "./conversation-disclosure-delta-contract-v13.mjs";
import {
  computeAcceptanceInputManifest,
  computeLocalCandidateSourceManifest,
  computeReviewCandidateManifest,
  computeTreeManifest,
} from "./local-candidate-source-manifest.mjs";
import { inspectSafeFsHelper } from "./inspect-safe-fs-helper.mjs";
import { validateProductionScenarioReceipt } from "./conversation-disclosure-acceptance-contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expectedCd04 = Object.freeze({
  snapshotDigest:
    "sha256:8ffc69be873f30d7ca8c0c4c35fd6139ece6292f6b9277ef52694d3edb626631",
  manifestDigest:
    "sha256:c13d8cea8a113deb20e75886fa55d2dcd1928a63904532cf51f26d08a607672f",
  parentAnchorDigest:
    "sha256:b1f5428cac931278b9c86f449e6b92cd4b6a40656aca4e002174647625d8c71a",
});
const expectedSuccessorFeatures = new Map([
  ["P109-chat-progressive-disclosure-surface", {
    priority: 140,
    digest: "sha256:17bfb7597fc6fc1efabba44259145c3b7e4ed0468ba538cba98ecec117ff60f5",
  }],
  ["P110-cross-surface-progressive-disclosure", {
    priority: 141,
    digest: "sha256:1e86690367b3835cc812f89da65f43f168cf0768085e55d93c8cb087432f8a9b",
  }],
  ["P111-conversation-evidence-inspector", {
    priority: 142,
    digest: "sha256:cc85bd9764c0f9dba932ce0c6fa55ba2132c3fc30f622b028220505ae8b0f408",
  }],
  ["P112-v3.9.2-disclosure-hardening", {
    priority: 143,
    digest: "sha256:b1529183ed1e952b2351ecad2eb6c2781711ea8cf97aff6b76915c08bdc8c4b1",
  }],
  ["P113-v3.9.2-disclosure-adversarial-acceptance", {
    priority: 144,
    digest: "sha256:dbd298d86aaa78858bbc95d4b096d93e4c8a0667e235fff22630ba9e8f0be8d3",
  }],
]);
const expectedScenarioIds = Array.from(
  { length: 19 },
  (_, index) => `S${String(index + 1).padStart(2, "0")}-${[
    "default-narrative",
    "inline-expansion",
    "evidence-handoff",
    "failure-attention",
    "approval-attention",
    "pause-reload-recovery",
    "plan-progress",
    "scheduled-progress",
    "long-session",
    "accessibility",
    "secret-safety",
    "retry-attempt",
    "legacy-coverage",
    "guided-input",
    "goal-acceptance",
    "plan-confirmation",
    "cancel-interruption",
    "context-usage",
    "unknown-coverage",
  ][index]}`,
);
const expectedScenarioMatrixDigest =
  "sha256:6f7d6618e08ea2d647e7f99c65b8329a60d93184f393403d3f1de2eab65399d7";
const expectedWorkstreamIds = [
  "CD01", "CD02", "CD03", "CD03A", "CD04",
  "CD05", "CD06", "CD07", "CD08", "CD09",
];
const expectedWorkstreamFeatures = new Map([
  ["CD01", "P105-conversation-disclosure-program-foundation"],
  ["CD02", "P106-conversation-disclosure-contract-foundation"],
  ["CD03", "P107-conversation-disclosure-domain-adapters"],
  ["CD03A", "P107A-conversation-disclosure-successor-admission"],
  ["CD04", "P108-conversation-disclosure-evidence-foundation"],
  ["CD05", "P109-chat-progressive-disclosure-surface"],
  ["CD06", "P110-cross-surface-progressive-disclosure"],
  ["CD07", "P111-conversation-evidence-inspector"],
  ["CD08", "P112-v3.9.2-disclosure-hardening"],
  ["CD09", "P113-v3.9.2-disclosure-adversarial-acceptance"],
]);
const expectedArtifactKinds = new Map([
  ["CD05-chat-browser.json", "cd05-chat-browser-acceptance"],
  ["CD06-cross-surface-browser.json", "cd06-cross-surface-browser-acceptance"],
  ["CD07-inspector-browser.json", "cd07-inspector-browser-acceptance"],
  ["CD08-hardening.json", "cd08-disclosure-hardening"],
  ["CD09-real-app-acceptance.json", "conversation-disclosure-real-app-acceptance"],
  ["CD09-code-review.json", "v3.9.2-adversarial-review-receipt"],
  ["CD09-security-review.json", "v3.9.2-adversarial-review-receipt"],
  ["CD09-local-package.json", "v3.9.2-local-candidate-package"],
]);
const expectedReviewReceiptKeys = [
  "schemaVersion",
  "kind",
  "lane",
  "reviewerAgentId",
  "challenge",
  "identityAssurance",
  "reviewedCandidateDigest",
  "reviewedCandidateFileCount",
  "verdict",
  "findingCounts",
  "reviewOutput",
  "reviewOutputDigest",
  "digest",
].sort();
const expectedCompletionArtifacts = new Map([
  ["CD05", [
    ".zerox/decisions/CD05-chat-disclosure-surface.md",
    ".zerox/verification/conversation-disclosure/CD05-chat-browser.json",
  ]],
  ["CD06", [
    ".zerox/decisions/CD06-cross-surface-disclosure.md",
    ".zerox/verification/conversation-disclosure/CD06-cross-surface-browser.json",
  ]],
  ["CD07", [
    ".zerox/decisions/CD07-evidence-inspector.md",
    ".zerox/verification/conversation-disclosure/CD07-inspector-browser.json",
  ]],
  ["CD08", [
    ".zerox/verification/conversation-disclosure/CD08-hardening.json",
    ".zerox/verification/conversation-disclosure/CD08-full-gates.md",
  ]],
  ["CD09", [
    ".zerox/verification/conversation-disclosure/CD09-real-app-acceptance.json",
    ".zerox/reviews/CD09-code-review.json",
    ".zerox/reviews/CD09-security-review.json",
    ".zerox/reviews/CD09-adversarial-acceptance.md",
    ".zerox/verification/conversation-disclosure/CD09-local-package.json",
  ]],
]);
const expectedFinalAnchorFiles = [
  ".zerox/conversation-disclosure-program.json",
  ".zerox/feature_list.json",
  ".zerox/verification/conversation-disclosure/CD05-chat-browser.json",
  ".zerox/verification/conversation-disclosure/CD05-chat-browser-compact.png",
  ".zerox/verification/conversation-disclosure/CD05-chat-browser-expanded.png",
  ".zerox/verification/conversation-disclosure/CD05-chat-browser-narrow.png",
  ".zerox/verification/conversation-disclosure/CD06-cross-surface-browser.json",
  ".zerox/verification/conversation-disclosure/CD06-cross-surface-desktop.png",
  ".zerox/verification/conversation-disclosure/CD06-cross-surface-narrow.png",
  ".zerox/verification/conversation-disclosure/CD07-inspector-browser.json",
  ".zerox/verification/conversation-disclosure/CD07-inspector-desktop.png",
  ".zerox/verification/conversation-disclosure/CD08-hardening.json",
  ".zerox/verification/conversation-disclosure/CD08-full-gates.md",
  ".zerox/verification/conversation-disclosure/CD04-performance-baseline.json",
  ".zerox/verification/conversation-disclosure/CD04-shadow-parity.json",
  ".zerox/verification/conversation-disclosure/CD09-real-app-acceptance.json",
  ...expectedScenarioIds.flatMap((scenarioId) => [
    `.zerox/verification/conversation-disclosure/CD09-scenarios/${scenarioId}.json`,
    `.zerox/verification/conversation-disclosure/CD09-scenarios/${scenarioId}.png`,
  ]),
  ...[
    "S13-legacy-coverage",
    "S17-cancel-interruption",
  ].map((scenarioId) =>
    `.zerox/verification/conversation-disclosure/CD09-scenarios/${scenarioId}.initial.png`
  ),
  ".zerox/verification/conversation-disclosure/CD09-local-package.json",
  ".zerox/verification/chat-resilience-local-package.json",
  ".zerox/verification/chat-resilience-local-package.png",
  ".zerox/verification/plan-resilience-local-package.json",
  ".zerox/reviews/CD09-code-review.json",
  ".zerox/reviews/CD09-security-review.json",
  ".zerox/reviews/CD09-adversarial-acceptance.md",
  "package.json",
  "package-lock.json",
  "scripts/check-conversation-disclosure-successor-program.mjs",
  "scripts/check-harness-state.mjs",
  "scripts/run-conversation-disclosure-acceptance.mjs",
  "scripts/run-conversation-disclosure-real-app.mjs",
  "scripts/conversation-disclosure-acceptance-contract.mjs",
  "scripts/package-local-candidate.mjs",
  "scripts/local-candidate-source-manifest.mjs",
  "scripts/build-v392-acceptance-anchor.mjs",
];
const expectedFinalAnchorKeys = [
  "schemaVersion",
  "kind",
  "status",
  "identityAssurance",
  "repositoryRealpath",
  "gitHead",
  "gitTree",
  "version",
  "cd04AnchorDigest",
  "runnerDigest",
  "nodeDigest",
  "npmCliDigest",
  "npmTreeDigest",
  "npmTreeEntryCount",
  "toolchainDigest",
  "toolchainEntryCount",
  "nativeNodeAddonDigest",
  "nodeHeadersDigest",
  "nodeHeadersEntryCount",
  "electronCacheDigest",
  "electronHeadersArchiveDigest",
  "electronHeadersDigest",
  "electronHeadersEntryCount",
  "reviewPins",
  "sourceDigest",
  "sourceFileCount",
  "unsignedSafeFsHelperDigest",
  "packagedSafeFsHelperDigest",
  "packagedSafeFsUnsignedCodeDigest",
  "packagedSafeFsCodeLimit",
  "controlDigests",
  "verification",
  "fileDigests",
  "fileModes",
  "digest",
].sort();
const expectedFinalVerification = {
  fullVerify: "split-equivalent-passed",
  nestedSandboxRegression: "passed",
  productionSmoke: "passed",
  productionAudit: "passed",
  dependencyTree: "passed",
  whitespace: "passed",
  realAppAcceptance: "passed",
  localPackage: "passed",
  nativeNodeRestore: "passed",
  codeSignature: "passed",
  packagedLaunch: "passed",
  packageSecretScan: "passed",
};
const releaseAttestationPath =
  ".zerox/verification/conversation-disclosure/CD09-release-attestation.json";
const expectedAcceptedCd04AnchorDigest =
  "sha256:99b8b7af27e24d2c44e2bb3b2433ada877fd68aeac2d1de80427931de15c01ef";
const expectedUnsignedSafeFsHelperDigest =
  "sha256:58b2493f585d2bc814ff44092fdde3b3debb793ea715a4a14b7fc638b0c04ad6";
const expectedReleaseAttestationKeys = [
  "schemaVersion",
  "kind",
  "version",
  "status",
  "identityAssurance",
  "acceptanceAnchorDigest",
  "acceptedGitHead",
  "acceptedGitTree",
  "cd04AnchorDigest",
  "sourceDigest",
  "sourceFileCount",
  "reviewPins",
  "evidenceDigests",
  "verification",
  "digest",
].sort();
const releaseAttestationEvidencePaths = Object.freeze({
  codeReview: ".zerox/reviews/CD09-code-review.json",
  securityReview: ".zerox/reviews/CD09-security-review.json",
  realAppAcceptance:
    ".zerox/verification/conversation-disclosure/CD09-real-app-acceptance.json",
  localPackage:
    ".zerox/verification/conversation-disclosure/CD09-local-package.json",
  chatResilience: ".zerox/verification/chat-resilience-local-package.json",
  planResilience: ".zerox/verification/plan-resilience-local-package.json",
});
const expectedExternalControlFiles = [
  "package.json",
  "package-lock.json",
  "electron-builder.yml",
  "scripts/after-pack-mac.mjs",
  "scripts/check-conversation-disclosure-successor-program.mjs",
  "scripts/check-harness-state.mjs",
  "scripts/run-conversation-disclosure-acceptance.mjs",
  "scripts/run-conversation-disclosure-real-app.mjs",
  "scripts/conversation-disclosure-acceptance-contract.mjs",
  "scripts/capture-cd05-chat-browser.mjs",
  "scripts/capture-cd06-cross-surface-browser.mjs",
  "scripts/capture-cd07-inspector-browser.mjs",
  "scripts/run-conversation-disclosure-hardening.mjs",
  "scripts/run-conversation-disclosure-performance.mjs",
  "scripts/probe-native-sqlite.mjs",
  "scripts/package-local-candidate.mjs",
  "scripts/local-candidate-source-manifest.mjs",
];
if (
  expectedExternalControlFiles.length !== 17
  || expectedFinalAnchorFiles.length !== 73
) {
  throw new Error("v3.9.2 final acceptance roster invariant changed");
}
const expectedFocusedTestFiles = [
  "src/renderer/chatStreamReducer.test.ts",
  "src/renderer/materialDesign.test.ts",
  "src/renderer/toolApprovalProjection.test.ts",
  "src/renderer/toolApprovalVisibility.test.ts",
  "src/renderer/goalAcceptanceInteraction.test.ts",
  "src/renderer/goalTerminalTruth.test.ts",
  "src/renderer/chatTaskActivityRestore.test.ts",
  "src/main/conversationEvidenceResolver.test.ts",
  "src/main/planStore.test.ts",
  "src/main/chatSessionStore.test.ts",
  "src/main/jsonlRecovery.test.ts",
];
const expectedAcceptanceCommands = [
  // The external acceptance anchor always runs the suite with
  // ZEROX_V392_OUTER_SANDBOX=1, so the recorded Electron commands carry the
  // environment-adaptation flag --no-sandbox (see
  // scripts/run-conversation-disclosure-acceptance.mjs). The manifest records
  // the true executed argv; this roster binds to that canonical anchored form.
  "./node_modules/.bin/electron --no-sandbox scripts/capture-cd05-chat-browser.mjs",
  "./node_modules/.bin/electron --no-sandbox scripts/capture-cd06-cross-surface-browser.mjs",
  "./node_modules/.bin/electron --no-sandbox scripts/capture-cd07-inspector-browser.mjs",
  "scripts/run-conversation-disclosure-hardening.mjs",
  "scripts/run-production-smoke.mjs --skip-build",
  "scripts/run-conversation-disclosure-real-app.mjs",
  [
    "node_modules/vitest/vitest.mjs run --run",
    ...expectedFocusedTestFiles,
    "--maxWorkers=1",
    "--reporter=json",
  ].join(" "),
];
const expectedAcceptanceScenarioIds = new Map([
  ["CD05", [
    expectedScenarioIds[0], expectedScenarioIds[1], expectedScenarioIds[3],
    expectedScenarioIds[4], expectedScenarioIds[9], expectedScenarioIds[11],
    expectedScenarioIds[13], expectedScenarioIds[14], expectedScenarioIds[15],
    expectedScenarioIds[17],
  ]],
  ["CD06", [
    expectedScenarioIds[4], expectedScenarioIds[6], expectedScenarioIds[7],
    expectedScenarioIds[9], expectedScenarioIds[14], expectedScenarioIds[15],
    expectedScenarioIds[16], expectedScenarioIds[17],
  ]],
  ["CD07", [
    expectedScenarioIds[2], expectedScenarioIds[3], expectedScenarioIds[9],
    expectedScenarioIds[10], expectedScenarioIds[18],
  ]],
  ["CD08", [
    expectedScenarioIds[5], expectedScenarioIds[8], expectedScenarioIds[9],
    expectedScenarioIds[10], expectedScenarioIds[11], expectedScenarioIds[12],
    expectedScenarioIds[16], expectedScenarioIds[17], expectedScenarioIds[18],
  ]],
]);
const expectedScenarioAssertions = new Map([
  [expectedScenarioIds[0], [{ id: "compact-default", passed: true }]],
  [expectedScenarioIds[1], [
    { id: "manual-expand", passed: true },
    { id: "manual-collapse", passed: true },
  ]],
  [expectedScenarioIds[2], [
    { id: "exact-run-target", passed: true },
    { id: "stable-selection", passed: true },
  ]],
  [expectedScenarioIds[3], [{ id: "failure-prominent", passed: true }]],
  [expectedScenarioIds[4], [{
    id: "approval-projection-regression",
    passed: true,
    testFile: "src/renderer/toolApprovalProjection.test.ts",
    testName: "restores a pending request from a subscribe-first snapshot",
  }]],
  [expectedScenarioIds[5], [{ id: "historical-reconstruction", passed: true }]],
  [expectedScenarioIds[6], [{
    id: "plan-store-regression",
    passed: true,
    testFile: "src/main/planStore.test.ts",
    testName: "persists PlanRecord v3 lineage and rejects non-Direct runtime replans",
  }]],
  [expectedScenarioIds[7], [
    { id: "scheduled-stable-identity", passed: true },
    { id: "child-run-excluded", passed: true },
  ]],
  [expectedScenarioIds[8], [
    { id: "runtime-stress", passed: true },
    { id: "retained-ring", passed: true },
  ]],
  [expectedScenarioIds[9], [
    { id: "keyboard-state", passed: true },
    { id: "reduced-motion", passed: true },
  ]],
  [expectedScenarioIds[10], [
    { id: "secret-absent", passed: true },
    { id: "redaction-visible", passed: true },
  ]],
  [expectedScenarioIds[11], [{
    id: "attempt-reducer-regression",
    passed: true,
    testFile: "src/renderer/chatStreamReducer.test.ts",
    testName: "removes a superseded partial answer and rejects late deltas from the old attempt",
  }]],
  [expectedScenarioIds[12], [{ id: "legacy-default-off", passed: true }]],
  [expectedScenarioIds[13], [{
    id: "guided-input-regression",
    passed: true,
    testFile: "src/renderer/chatTaskActivityRestore.test.ts",
    testName: "does not present an interrupted processing claim as resumable input",
  }]],
  [expectedScenarioIds[14], [{
    id: "goal-acceptance-regression",
    passed: true,
    testFile: "src/renderer/goalAcceptanceInteraction.test.ts",
    testName: "only reports manual completion success for an attested completed-unverified result",
  }]],
  [expectedScenarioIds[15], [{
    id: "plan-confirmation-regression",
    passed: true,
    testFile: "src/main/planStore.test.ts",
    testName: "persists PlanRecord v3 lineage and rejects non-Direct runtime replans",
  }]],
  [expectedScenarioIds[16], [{ id: "cancel-stress", passed: true }]],
  [expectedScenarioIds[17], [{ id: "context-stress", passed: true }]],
  [expectedScenarioIds[18], [
    { id: "unknown-visible", passed: true },
    { id: "unknown-fallback-contract", passed: true },
  ]],
]);
const acceptanceArtifactPaths = new Map([
  ["CD05", ".zerox/verification/conversation-disclosure/CD05-chat-browser.json"],
  ["CD06", ".zerox/verification/conversation-disclosure/CD06-cross-surface-browser.json"],
  ["CD07", ".zerox/verification/conversation-disclosure/CD07-inspector-browser.json"],
  ["CD08", ".zerox/verification/conversation-disclosure/CD08-hardening.json"],
]);

export async function checkConversationDisclosureSuccessorProgram(options = {}) {
  rejectInheritedGitEnvironment();
  const errors = [];
  const anchorPath = options.deltaAnchor
    ?? process.env.ZEROX_CD04_DELTA_ANCHOR;
  const expectedAnchorDigest = options.expectedDeltaAnchorDigest
    ?? process.env.ZEROX_CD04_DELTA_ANCHOR_DIGEST;
  const expectedReleaseAttestationDigest =
    options.expectedReleaseAttestationDigest
    ?? process.env.ZEROX_V392_RELEASE_ATTESTATION_DIGEST;

  const [canonicalRoot, snapshotCapture, manifestCapture, program, featureList] =
    await Promise.all([
      realpath(root),
      readCanonicalJson(path.join(root, CD04_DELTA_SNAPSHOT_PATH), errors),
      readCanonicalJson(path.join(root, CD04_DELTA_MANIFEST_PATH), errors),
      readCanonicalJson(
        path.join(root, ".zerox/conversation-disclosure-program.json"),
        errors,
      ),
      readCanonicalJson(path.join(root, ".zerox/feature_list.json"), errors),
    ]);
  const releaseReady = program?.value?.status === "completed";
  const hasPrivatePins = hasPrivateCallerPinMaterial(options);
  const useReleaseAttestation =
    releaseReady
    && !hasPrivatePins
    && /^sha256:[0-9a-f]{64}$/.test(
      expectedReleaseAttestationDigest ?? "",
    );
  const releaseAttestation = useReleaseAttestation
    ? await validateReleaseAttestation(
        canonicalRoot,
        expectedReleaseAttestationDigest,
        errors,
      )
    : null;
  const validationOptions = releaseAttestation
    ? withReleaseAttestationPins(options, releaseAttestation)
    : options;
  if (
    !useReleaseAttestation
    && (
      !path.isAbsolute(anchorPath ?? "")
      || !/^sha256:[0-9a-f]{64}$/.test(expectedAnchorDigest ?? "")
    )
  ) {
    errors.push("caller-pinned CD04 anchor path and digest are required");
  }
  if (releaseReady && !hasPrivatePins && !useReleaseAttestation) {
    errors.push(
      "completed v3.9.2 requires a caller-pinned release attestation digest",
    );
  }
  const anchorCapture = !useReleaseAttestation && path.isAbsolute(anchorPath ?? "")
    ? await readCanonicalJson(anchorPath, errors, true)
    : null;
  const snapshot = snapshotCapture?.value;
  const manifest = manifestCapture?.value;
  const anchor = anchorCapture?.value;

  if (snapshot?.digest !== expectedCd04.snapshotDigest) {
    errors.push("CD04 snapshot canonical digest changed");
  }
  if (manifest?.digest !== expectedCd04.manifestDigest) {
    errors.push("CD04 manifest canonical digest changed");
  }
  if (!useReleaseAttestation && anchor?.digest !== expectedAnchorDigest) {
    errors.push("CD04 external anchor self-digest differs from the caller pin");
  }
  if (!useReleaseAttestation && anchor?.repositoryRealpath !== canonicalRoot) {
    errors.push("CD04 external anchor repository identity changed");
  }
  if (
    !useReleaseAttestation
    && (
      anchor?.snapshotDigest !== expectedCd04.snapshotDigest
      || anchor?.manifestDigest !== expectedCd04.manifestDigest
      || anchor?.parentAnchorDigest !== expectedCd04.parentAnchorDigest
    )
  ) {
    errors.push("CD04 external anchor lineage changed");
  }
  if (
    manifest?.snapshotDigest !== expectedCd04.snapshotDigest
    || snapshot?.digest !== expectedCd04.snapshotDigest
  ) {
    errors.push("CD04 manifest and snapshot are not bound");
  }

  await validateFrozenPredecessor(
    snapshot,
    featureList?.value,
    errors,
  );
  await validateLifecycle(
    program?.value,
    featureList?.value,
    errors,
    validationOptions,
  );
  const finalAnchor = releaseReady && !useReleaseAttestation
    ? await validateFinalAcceptanceAnchor(validationOptions, canonicalRoot, errors)
    : null;
  if (errors.length > 0) {
    throw new Error(
      `Conversation disclosure successor check failed:\n- ${errors.join("\n- ")}`,
    );
  }
  const receipt = {
    schemaVersion: 1,
    kind: "conversation-disclosure-successor-program-receipt",
    status: "passed",
    programId: program.value.programId,
    activeFeatureId: program.value.activeFeatureId,
    nextFeatureId: program.value.nextFeatureId,
    cd04SnapshotDigest: expectedCd04.snapshotDigest,
    cd04ManifestDigest: expectedCd04.manifestDigest,
    cd04AnchorDigest: releaseAttestation?.cd04AnchorDigest
      ?? expectedAnchorDigest,
    releaseReady,
    ...(
      finalAnchor || releaseAttestation
        ? {
            acceptanceAnchorDigest: finalAnchor?.digest
              ?? releaseAttestation.acceptanceAnchorDigest,
          }
        : {}
    ),
    ...(releaseAttestation
      ? { releaseAttestationDigest: releaseAttestation.digest }
      : {}),
  };
  return { ...receipt, digest: hashCanonicalV13(receipt) };
}

async function validateReleaseAttestation(
  canonicalRoot,
  expectedDigest,
  errors,
) {
  const capture = await readCanonicalJson(
    path.join(root, releaseAttestationPath),
    errors,
  );
  const attestation = capture?.value;
  if (!attestation) return null;
  const source = await computeLocalCandidateSourceManifest(root);
  const evidenceCaptures = await Promise.all(
    Object.values(releaseAttestationEvidencePaths).map((relativePath) =>
      readBoundRegularFile(
        path.join(root, relativePath),
        errors,
        "release attestation evidence",
      )),
  );
  const evidenceDigests = Object.fromEntries(
    Object.keys(releaseAttestationEvidencePaths).map((name, index) => [
      name,
      evidenceCaptures[index]
        ? sha256BytesV13(evidenceCaptures[index].bytes)
        : null,
    ]),
  );
  const evidenceValues = evidenceCaptures.map((capture) => {
    try {
      return capture ? JSON.parse(capture.bytes.toString("utf8")) : null;
    } catch {
      return null;
    }
  });
  const [
    _codeReview,
    _securityReview,
    _realAppAcceptance,
    localPackage,
    chatResilience,
    planResilience,
  ] = evidenceValues;
  let acceptedTree = null;
  let acceptedIsAncestor = false;
  try {
    acceptedTree = runTrustedGitSync(
      canonicalRoot,
      ["rev-parse", "--verify", `${attestation.acceptedGitHead}^{tree}`],
    ).trim();
    runTrustedGitSync(
      canonicalRoot,
      ["merge-base", "--is-ancestor", attestation.acceptedGitHead, "HEAD"],
      { stdio: "ignore" },
    );
    acceptedIsAncestor = true;
  } catch {
    // Reported through the single attestation identity error below.
  }
  const evidenceKeys = Object.keys(attestation.evidenceDigests ?? {});
  const expectedEvidenceKeys = Object.keys(releaseAttestationEvidencePaths);
  if (
    JSON.stringify(Object.keys(attestation).sort())
      !== JSON.stringify(expectedReleaseAttestationKeys)
    || attestation.schemaVersion !== 1
    || attestation.kind !== "v3.9.2-release-attestation"
    || attestation.version !== "3.9.2"
    || attestation.status !== "accepted"
    || attestation.identityAssurance
      !== "caller-promoted-external-anchor-not-signed"
    || attestation.digest !== expectedDigest
    || !/^sha256:[0-9a-f]{64}$/.test(attestation.acceptanceAnchorDigest ?? "")
    || !/^[0-9a-f]{40}$/.test(attestation.acceptedGitHead ?? "")
    || !/^[0-9a-f]{40}$/.test(attestation.acceptedGitTree ?? "")
    || attestation.acceptedGitTree !== acceptedTree
    || !acceptedIsAncestor
    || attestation.cd04AnchorDigest !== expectedAcceptedCd04AnchorDigest
    || attestation.sourceDigest !== source.digest
    || attestation.sourceFileCount !== source.fileCount
    || !expectedReviewPins(withReleaseAttestationPins({}, attestation))
    || JSON.stringify(evidenceKeys) !== JSON.stringify(expectedEvidenceKeys)
    || JSON.stringify(attestation.evidenceDigests)
      !== JSON.stringify(evidenceDigests)
    || chatResilience?.package?.path !== localPackage?.appPath
    || chatResilience?.package?.appAsarSha256
      !== localPackage?.appAsarSha256
    || planResilience?.package?.path !== localPackage?.appPath
    || planResilience?.package?.appAsarSha256
      !== localPackage?.appAsarSha256
    || JSON.stringify(attestation.verification)
      !== JSON.stringify(expectedFinalVerification)
  ) {
    errors.push("tracked v3.9.2 release attestation is invalid or stale");
    return null;
  }
  return attestation;
}

function withReleaseAttestationPins(options, attestation) {
  return {
    ...options,
    releaseAttestation: attestation,
    expectedCodeReviewAgentId: attestation?.reviewPins?.code?.reviewerAgentId,
    expectedCodeReviewChallenge: attestation?.reviewPins?.code?.challenge,
    expectedCodeReviewReceiptDigest: attestation?.reviewPins?.code?.receiptDigest,
    expectedSecurityReviewAgentId:
      attestation?.reviewPins?.security?.reviewerAgentId,
    expectedSecurityReviewChallenge:
      attestation?.reviewPins?.security?.challenge,
    expectedSecurityReviewReceiptDigest:
      attestation?.reviewPins?.security?.receiptDigest,
  };
}

function hasPrivateCallerPinMaterial(options) {
  return [
    options.deltaAnchor,
    options.expectedDeltaAnchorDigest,
    options.acceptanceAnchor,
    options.expectedAcceptanceAnchorDigest,
    options.acceptanceRunner,
    options.expectedAcceptanceRunnerDigest,
    options.expectedNodeDigest,
    options.npmCli,
    options.expectedNpmCliDigest,
    options.electronCacheArchive,
    options.expectedElectronCacheDigest,
    options.electronHeadersArchive,
    options.expectedElectronHeadersDigest,
    options.expectedGitHead,
    options.expectedGitTree,
    options.expectedCodeReviewAgentId,
    options.expectedCodeReviewChallenge,
    options.expectedCodeReviewReceiptDigest,
    options.expectedSecurityReviewAgentId,
    options.expectedSecurityReviewChallenge,
    options.expectedSecurityReviewReceiptDigest,
    process.env.ZEROX_CD04_DELTA_ANCHOR,
    process.env.ZEROX_CD04_DELTA_ANCHOR_DIGEST,
    process.env.ZEROX_V392_ACCEPTANCE_ANCHOR,
    process.env.ZEROX_V392_ACCEPTANCE_ANCHOR_DIGEST,
    process.env.ZEROX_V392_ACCEPTANCE_RUNNER,
    process.env.ZEROX_V392_ACCEPTANCE_RUNNER_DIGEST,
    process.env.ZEROX_V392_ACCEPTANCE_NODE_DIGEST,
    process.env.ZEROX_V392_ACCEPTANCE_NPM_CLI,
    process.env.ZEROX_V392_ACCEPTANCE_NPM_CLI_DIGEST,
    process.env.ZEROX_V392_ELECTRON_CACHE_ARCHIVE,
    process.env.ZEROX_V392_ELECTRON_CACHE_DIGEST,
    process.env.ZEROX_V392_ELECTRON_HEADERS_ARCHIVE,
    process.env.ZEROX_V392_ELECTRON_HEADERS_DIGEST,
    process.env.ZEROX_V392_ACCEPTANCE_GIT_HEAD,
    process.env.ZEROX_V392_ACCEPTANCE_GIT_TREE,
    process.env.ZEROX_V392_CODE_REVIEW_AGENT_ID,
    process.env.ZEROX_V392_CODE_REVIEW_CHALLENGE,
    process.env.ZEROX_V392_CODE_REVIEW_RECEIPT_DIGEST,
    process.env.ZEROX_V392_SECURITY_REVIEW_AGENT_ID,
    process.env.ZEROX_V392_SECURITY_REVIEW_CHALLENGE,
    process.env.ZEROX_V392_SECURITY_REVIEW_RECEIPT_DIGEST,
  ].some((value) => value !== undefined && value !== null && value !== "");
}

async function validateFinalAcceptanceAnchor(options, canonicalRoot, errors) {
  const anchorPath = options.acceptanceAnchor
    ?? process.env.ZEROX_V392_ACCEPTANCE_ANCHOR;
  const expectedDigest = options.expectedAcceptanceAnchorDigest
    ?? process.env.ZEROX_V392_ACCEPTANCE_ANCHOR_DIGEST;
  const runnerPath = options.acceptanceRunner
    ?? process.env.ZEROX_V392_ACCEPTANCE_RUNNER;
  const expectedRunnerDigest = options.expectedAcceptanceRunnerDigest
    ?? process.env.ZEROX_V392_ACCEPTANCE_RUNNER_DIGEST;
  const expectedNodeDigest = options.expectedNodeDigest
    ?? process.env.ZEROX_V392_ACCEPTANCE_NODE_DIGEST;
  const npmCliPath = options.npmCli
    ?? process.env.ZEROX_V392_ACCEPTANCE_NPM_CLI;
  const expectedNpmCliDigest = options.expectedNpmCliDigest
    ?? process.env.ZEROX_V392_ACCEPTANCE_NPM_CLI_DIGEST;
  const electronCachePath = options.electronCacheArchive
    ?? process.env.ZEROX_V392_ELECTRON_CACHE_ARCHIVE;
  const expectedElectronCacheDigest = options.expectedElectronCacheDigest
    ?? process.env.ZEROX_V392_ELECTRON_CACHE_DIGEST;
  const electronHeadersArchivePath = options.electronHeadersArchive
    ?? process.env.ZEROX_V392_ELECTRON_HEADERS_ARCHIVE;
  const expectedElectronHeadersDigest = options.expectedElectronHeadersDigest
    ?? process.env.ZEROX_V392_ELECTRON_HEADERS_DIGEST;
  const expectedGitHead = options.expectedGitHead
    ?? process.env.ZEROX_V392_ACCEPTANCE_GIT_HEAD;
  const expectedGitTree = options.expectedGitTree
    ?? process.env.ZEROX_V392_ACCEPTANCE_GIT_TREE;
  const reviewPins = expectedReviewPins(options);
  if (
    !path.isAbsolute(anchorPath ?? "")
    || !/^sha256:[0-9a-f]{64}$/.test(expectedDigest ?? "")
    || !path.isAbsolute(runnerPath ?? "")
    || !/^sha256:[0-9a-f]{64}$/.test(expectedRunnerDigest ?? "")
    || !/^sha256:[0-9a-f]{64}$/.test(expectedNodeDigest ?? "")
    || !path.isAbsolute(npmCliPath ?? "")
    || !/^sha256:[0-9a-f]{64}$/.test(expectedNpmCliDigest ?? "")
    || !path.isAbsolute(electronCachePath ?? "")
    || !/^sha256:[0-9a-f]{64}$/.test(expectedElectronCacheDigest ?? "")
    || !path.isAbsolute(electronHeadersArchivePath ?? "")
    || !/^sha256:[0-9a-f]{64}$/.test(expectedElectronHeadersDigest ?? "")
    || !/^[0-9a-f]{40}$/.test(expectedGitHead ?? "")
    || !/^[0-9a-f]{40}$/.test(expectedGitTree ?? "")
    || !reviewPins
  ) {
    errors.push(
      "completed v3.9.2 requires caller-pinned anchor runner Node and npm identities",
    );
    return null;
  }
  const canonicalNpmCliPath = await realpath(npmCliPath);
  const canonicalElectronCachePath = await realpath(electronCachePath);
  const canonicalElectronHeadersArchivePath = await realpath(
    electronHeadersArchivePath,
  );
  const [
    capture,
    runnerCapture,
    nodeCapture,
    npmCliCapture,
    npmTree,
    nodeHeaders,
    electronCache,
    electronHeadersArchive,
    toolchain,
    nativeNodeAddon,
    sourceManifest,
  ] =
    await Promise.all([
    readCanonicalJson(anchorPath, errors, true),
    readBoundRegularFile(runnerPath, errors, "external acceptance runner"),
    readBoundRegularFile(
      await realpath(process.execPath),
      errors,
      "Node executable",
    ),
    readBoundRegularFile(
      canonicalNpmCliPath,
      errors,
      "npm CLI",
    ),
    computeTreeManifest(path.resolve(path.dirname(canonicalNpmCliPath), "..")),
    computeTreeManifest(path.join(
      path.resolve(path.dirname(canonicalNpmCliPath), "../../../.."),
      "include",
    )),
    readBoundRegularFile(
      canonicalElectronCachePath,
      errors,
      "Electron cache archive",
    ),
    readBoundRegularFile(
      canonicalElectronHeadersArchivePath,
      errors,
      "Electron headers archive",
    ),
    computeTreeManifest(path.join(root, "node_modules"), {
      exclude: (relativePath) =>
        relativePath === ".vite"
        || relativePath.startsWith(`.vite${path.sep}`)
        || relativePath === "better-sqlite3/build"
        || relativePath.startsWith(`better-sqlite3/build${path.sep}`)
        || relativePath === "better-sqlite3/bin"
        || relativePath.startsWith(`better-sqlite3/bin${path.sep}`),
    }),
    readBoundRegularFile(
      path.join(
        root,
        "node_modules/better-sqlite3/build/Release/better_sqlite3.node",
      ),
      errors,
      "Node-ABI better-sqlite3 binary",
    ),
    computeAcceptanceInputManifest(root),
  ]);
  const gitHead = runTrustedGitSync(root, ["rev-parse", "HEAD"]).trim();
  const gitTree = runTrustedGitSync(
    root,
    ["rev-parse", "--verify", "HEAD^{tree}"],
  ).trim();
  const anchor = capture?.value;
  const anchorKeys = Object.keys(anchor ?? {}).sort();
  const controlPaths = Object.keys(anchor?.controlDigests ?? {});
  if (
    !runnerCapture
    || (runnerCapture.metadata.mode & 0o077) !== 0
    || runnerPath === canonicalRoot
    || runnerPath.startsWith(`${canonicalRoot}${path.sep}`)
    || sha256BytesV13(runnerCapture.bytes) !== expectedRunnerDigest
    || !nodeCapture
    || sha256BytesV13(nodeCapture.bytes) !== expectedNodeDigest
    || !npmCliCapture
    || canonicalNpmCliPath === canonicalRoot
    || canonicalNpmCliPath.startsWith(`${canonicalRoot}${path.sep}`)
    || sha256BytesV13(npmCliCapture.bytes) !== expectedNpmCliDigest
    || canonicalElectronCachePath === canonicalRoot
    || canonicalElectronCachePath.startsWith(`${canonicalRoot}${path.sep}`)
    || !electronCache
    || sha256BytesV13(electronCache.bytes) !== expectedElectronCacheDigest
    || canonicalElectronHeadersArchivePath === canonicalRoot
    || canonicalElectronHeadersArchivePath.startsWith(
      `${canonicalRoot}${path.sep}`,
    )
    || !electronHeadersArchive
    || sha256BytesV13(electronHeadersArchive.bytes)
      !== expectedElectronHeadersDigest
    || gitHead !== expectedGitHead
    || gitTree !== expectedGitTree
    || JSON.stringify(anchorKeys) !== JSON.stringify(expectedFinalAnchorKeys)
    || controlPaths.length !== expectedExternalControlFiles.length
    || expectedExternalControlFiles.some(
      (entry, index) => controlPaths[index] !== entry,
    )
    || Object.values(anchor?.controlDigests ?? {}).some(
      (digest) => !/^sha256:[0-9a-f]{64}$/.test(digest),
    )
  ) {
    errors.push("v3.9.2 caller-pinned execution identity is invalid");
  }
  if (
    anchor?.digest !== expectedDigest
    || anchor?.schemaVersion !== 1
    || anchor?.kind !== "v3.9.2-local-acceptance-external-anchor"
    || anchor?.status !== "accepted"
    || anchor?.identityAssurance !== "caller-held-not-signed"
    || anchor?.version !== "3.9.2"
    || anchor?.repositoryRealpath !== canonicalRoot
    || anchor?.gitHead !== expectedGitHead
    || anchor?.gitTree !== expectedGitTree
    || anchor?.runnerDigest !== expectedRunnerDigest
    || anchor?.nodeDigest !== expectedNodeDigest
    || anchor?.npmCliDigest !== expectedNpmCliDigest
    || anchor?.npmTreeDigest !== npmTree.digest
    || anchor?.npmTreeEntryCount !== npmTree.entryCount
    || anchor?.nodeHeadersDigest !== nodeHeaders.digest
    || anchor?.nodeHeadersEntryCount !== nodeHeaders.entryCount
    || anchor?.electronCacheDigest !== expectedElectronCacheDigest
    || !electronHeadersArchive
    || sha256BytesV13(electronHeadersArchive.bytes)
      !== expectedElectronHeadersDigest
    || anchor?.electronHeadersArchiveDigest
      !== expectedElectronHeadersDigest
    || anchor?.electronHeadersDigest
      !== "sha256:1b7669eebf3528c504e0ba52768aef1b8fe8c7066defc049ade50f1dacec2238"
    || anchor?.electronHeadersEntryCount !== 131
    || JSON.stringify(anchor?.reviewPins) !== JSON.stringify(reviewPins)
    || anchor?.toolchainDigest !== toolchain.digest
    || anchor?.toolchainEntryCount !== toolchain.entryCount
    || !nativeNodeAddon
    || anchor?.nativeNodeAddonDigest
      !== sha256BytesV13(nativeNodeAddon.bytes)
    || anchor?.sourceDigest !== sourceManifest.digest
    || anchor?.sourceFileCount !== sourceManifest.fileCount
    || anchor?.unsignedSafeFsHelperDigest
      !== expectedUnsignedSafeFsHelperDigest
    || !/^sha256:[0-9a-f]{64}$/.test(
      anchor?.packagedSafeFsHelperDigest ?? "",
    )
    || anchor?.packagedSafeFsHelperDigest
      === expectedUnsignedSafeFsHelperDigest
    || anchor?.packagedSafeFsUnsignedCodeDigest
      !== expectedUnsignedSafeFsHelperDigest
    || !Number.isInteger(anchor?.packagedSafeFsCodeLimit)
    || anchor.packagedSafeFsCodeLimit <= 0
    || JSON.stringify(anchor?.verification)
      !== JSON.stringify(expectedFinalVerification)
    || anchor?.fileDigests?.["scripts/build-v392-acceptance-anchor.mjs"]
      !== expectedRunnerDigest
    || anchor?.cd04AnchorDigest
      !== "sha256:99b8b7af27e24d2c44e2bb3b2433ada877fd68aeac2d1de80427931de15c01ef"
  ) {
    errors.push("v3.9.2 acceptance anchor identity is invalid");
    return null;
  }
  const paths = Object.keys(anchor.fileDigests ?? {});
  const modePaths = Object.keys(anchor.fileModes ?? {});
  if (
    paths.length !== expectedFinalAnchorFiles.length
    || modePaths.length !== expectedFinalAnchorFiles.length
    || expectedFinalAnchorFiles.some((entry, index) =>
      paths[index] !== entry || modePaths[index] !== entry)
  ) {
    errors.push("v3.9.2 acceptance anchor file roster changed");
    return null;
  }
  for (const relativePath of expectedFinalAnchorFiles) {
    const capture = await readBoundRegularFile(
      path.join(root, relativePath),
      errors,
      "acceptance anchor file",
    );
    if (
      capture
      && (
        anchor.fileDigests[relativePath] !== sha256BytesV13(capture.bytes)
        || anchor.fileModes[relativePath]
          !== (capture.metadata.mode & 0o777)
        || (
          [
            ".zerox/conversation-disclosure-program.json",
            ".zerox/feature_list.json",
          ].includes(relativePath)
          && anchor.fileModes[relativePath] !== 0o644
        )
      )
    ) {
      errors.push(`v3.9.2 acceptance anchor drift: ${relativePath}`);
    }
  }
  const [packageReceipt, packagedSafeFsHelper] = await Promise.all([
    readCanonicalJson(
      path.join(
        root,
        ".zerox/verification/conversation-disclosure/CD09-local-package.json",
      ),
      errors,
    ),
    readBoundRegularFile(
      path.join(
        root,
        "release-local/mac-arm64/Zerox Agent.app/Contents/Resources/safe-fs/zerox-safe-fs",
      ),
      errors,
      "packaged safe-fs helper",
    ),
  ]);
  if (
    !packageReceipt
    || !packagedSafeFsHelper
    || packageReceipt.value.safeFsHelper?.sha256
      !== anchor.packagedSafeFsHelperDigest
    || packageReceipt.value.safeFsHelper?.bytes
      !== packagedSafeFsHelper.bytes.length
    || anchor.packagedSafeFsHelperDigest
      !== sha256BytesV13(packagedSafeFsHelper.bytes)
    || (packagedSafeFsHelper.metadata.mode & 0o777) !== 0o755
  ) {
    errors.push("v3.9.2 packaged safe-fs helper identity is invalid");
  }
  for (const relativePath of expectedExternalControlFiles) {
    const controlCapture = await readBoundRegularFile(
      path.join(root, relativePath),
      errors,
      "acceptance control file",
    );
    if (
      controlCapture
      && anchor.controlDigests[relativePath]
        !== sha256BytesV13(controlCapture.bytes)
    ) {
      errors.push(`v3.9.2 acceptance control drift: ${relativePath}`);
    }
  }
  return anchor;
}

async function validateLifecycle(program, featureList, errors, options) {
  const workstreamEntries = program?.workstreams ?? [];
  const workstreams = new Map(
    workstreamEntries.map((workstream) => [workstream.id, workstream]),
  );
  if (
    workstreams.size !== workstreamEntries.length
    || expectedWorkstreamIds.some(
      (id, index) => workstreamEntries[index]?.id !== id,
    )
    || workstreamEntries.length !== expectedWorkstreamIds.length
  ) {
    errors.push("conversation disclosure workstream roster changed");
  }
  const featureEntries = featureList?.features ?? [];
  const features = new Map(
    featureEntries.map((feature) => [feature.id, feature]),
  );
  if (features.size !== featureEntries.length) {
    errors.push("feature list contains duplicate ids");
  }
  const active = [...workstreams.values()].filter(
    (workstream) => workstream.state === "in_progress",
  );
  if (
    !Array.isArray(program?.scenarioMatrix)
    || program.scenarioMatrix.length !== 19
    || expectedScenarioIds.some(
      (id, index) => program.scenarioMatrix[index]?.id !== id,
    )
  ) {
    errors.push("conversation disclosure scenario matrix identity changed");
  }
  if (hashCanonicalV13(program?.scenarioMatrix ?? null)
    !== expectedScenarioMatrixDigest) {
    errors.push("conversation disclosure scenario semantics changed");
  }
  if (active.length > (program?.maxActiveFeatures ?? 0)) {
    errors.push("conversation disclosure exceeds the active work limit");
  }
  if (program?.status === "active") {
    if (active.length !== 1) {
      errors.push("active program requires exactly one in-progress workstream");
    }
    if (
      active[0]?.featureId !== program?.activeFeatureId
      || program?.nextFeatureId !== program?.activeFeatureId
    ) {
      errors.push("active program pointers do not match the in-progress workstream");
    }
  } else if (program?.status === "completed") {
    if (
      active.length !== 0
      || program.activeFeatureId !== null
      || program.nextFeatureId !== null
      || [...workstreams.values()].some(
        (workstream) => workstream.state !== "completed",
      )
    ) {
      errors.push("completed program requires every workstream closed and no active pointers");
    }
  } else {
    errors.push("conversation disclosure program status is invalid");
  }
  if (
    workstreams.get("CD04")?.state !== "completed"
    || features.get("P108-conversation-disclosure-evidence-foundation")?.status !== "done"
  ) {
    errors.push("CD04/P108 predecessor closure changed");
  }
  for (const workstream of workstreams.values()) {
    if (workstream.featureId !== expectedWorkstreamFeatures.get(workstream.id)) {
      errors.push(`${workstream.id} Feature binding changed`);
    }
    const expectedArtifacts = expectedCompletionArtifacts.get(workstream.id);
    if (
      expectedArtifacts
      && (
        workstream.completionArtifacts?.length !== expectedArtifacts.length
        || expectedArtifacts.some(
          (artifact, index) => workstream.completionArtifacts[index] !== artifact,
        )
      )
    ) {
      errors.push(`${workstream.id} completion artifact roster changed`);
    }
    const expectedScenarios = expectedAcceptanceScenarioIds.get(workstream.id);
    if (
      expectedScenarios
      && (
        workstream.acceptanceScenarioIds?.length !== expectedScenarios.length
        || expectedScenarios.some(
          (scenarioId, index) =>
            workstream.acceptanceScenarioIds[index] !== scenarioId,
        )
      )
    ) {
      errors.push(`${workstream.id} acceptance scenario ownership changed`);
    }
    for (const dependency of workstream.dependsOn ?? []) {
      if (!workstreams.has(dependency)) {
        errors.push(`${workstream.id} has unknown dependency ${dependency}`);
      }
      if (
        workstream.state !== "planned"
        && workstreams.get(dependency)?.state !== "completed"
      ) {
        errors.push(`${workstream.id} is blocked by ${dependency}`);
      }
    }
    const feature = features.get(workstream.featureId);
    if (workstream.state === "planned" && feature) {
      errors.push(`${workstream.id} planned Feature must not be registered`);
    }
    if (workstream.state === "in_progress" && feature?.status !== "in_progress") {
      errors.push(`${workstream.id} requires an in-progress Feature`);
    }
    if (workstream.state === "completed" && feature?.status !== "done") {
      errors.push(`${workstream.id} requires a done Feature`);
    }
    if (workstream.state === "completed") {
      if (!(workstream.completionArtifacts?.length > 0)) {
        errors.push(`${workstream.id} has no completion artifacts`);
      }
      for (const artifact of workstream.completionArtifacts ?? []) {
        if (
          typeof artifact !== "string"
          || path.isAbsolute(artifact)
          || artifact.startsWith("../")
          || artifact.includes("/../")
        ) {
          errors.push(`${workstream.id} has an invalid completion artifact path`);
          continue;
        }
        await validateCompletionArtifact(
          workstream.id,
          artifact,
          errors,
          program,
          options,
        );
      }
    }
  }
  for (const [id, expected] of expectedSuccessorFeatures) {
    const feature = features.get(id);
    if (!feature || feature.priority !== expected.priority) {
      errors.push(`successor Feature identity changed: ${id}`);
      continue;
    }
    const { status: _status, ...stable } = feature;
    if (hashCanonicalV13(stable) !== expected.digest) {
      errors.push(`successor Feature definition changed: ${id}`);
    }
  }
  const unknownSuccessors = [...features.values()].filter(
    (feature) =>
      Number(feature.priority) >= 140
      && !expectedSuccessorFeatures.has(feature.id),
  );
  if (unknownSuccessors.length > 0) {
    errors.push("unregistered successor Feature cannot authorize frozen-file drift");
  }
}

async function validateFrozenPredecessor(snapshot, featureList, errors) {
  const successorFiles = new Set(
    (featureList?.features ?? [])
      .filter((feature) => expectedSuccessorFeatures.has(feature.id))
      .flatMap((feature) => feature.files ?? []),
  );
  for (const entry of snapshot?.frozenEntries ?? []) {
    if (successorFiles.has(entry.path)) continue;
    const capture = await readBoundRegularFile(
      path.join(root, entry.path),
      errors,
      "frozen predecessor",
    );
    if (capture && sha256BytesV13(capture.bytes) !== entry.sha256) {
      errors.push(`unowned frozen predecessor drift: ${entry.path}`);
    }
  }
}

async function validateCompletionArtifact(
  workstreamId,
  artifact,
  errors,
  program,
  options,
) {
  const filePath = path.join(root, artifact);
  const capture = await readBoundRegularFile(
    filePath,
    errors,
    `${workstreamId} completion artifact`,
  );
  if (!capture) {
    return;
  }
  const { bytes } = capture;
  if (bytes.length === 0) {
    errors.push(`${workstreamId} completion artifact is empty: ${artifact}`);
    return;
  }
  if (
    workstreamId === "CD09"
    && artifact.endsWith(".md")
    && !await validateReviewSummary(bytes, errors)
  ) {
    errors.push("CD09 adversarial review is not a zero-finding closure");
  }
  if (!artifact.endsWith(".json") || !/^CD0[5-9]$/.test(workstreamId)) return;
  try {
    const value = JSON.parse(bytes.toString("utf8"));
    const expectedKind = expectedArtifactKinds.get(path.basename(artifact));
    if (value.kind !== expectedKind) {
      errors.push(`${workstreamId} completion artifact kind changed: ${artifact}`);
      return;
    }
    const isLocalPackage =
      workstreamId === "CD09"
      && value.kind === "v3.9.2-local-candidate-package";
    const isReviewReceipt =
      workstreamId === "CD09"
      && value.kind === "v3.9.2-adversarial-review-receipt";
    if (isReviewReceipt) {
      await validateReviewReceipt(value, artifact, errors, options);
      return;
    }
    if (
      isLocalPackage
        ? value.status !== "passed"
          || value.version !== "3.9.2"
          || value.releaseMode !== "local-candidate"
          || value.publish !== "never"
          || !/^sha256:[0-9a-f]{64}$/.test(value.npmCliSha256 ?? "")
          || !/^sha256:[0-9a-f]{64}$/.test(value.appAsarSha256 ?? "")
        : value.accepted !== true
          || !["passed", undefined].includes(value.status)
    ) {
      errors.push(`${workstreamId} completion artifact is not accepted: ${artifact}`);
    }
    if (
      workstreamId === "CD05"
      && (
        value.viewportEvidence?.compact?.operationsExpanded !== "false"
        || value.viewportEvidence?.expanded?.operationsExpanded !== "true"
        || value.viewportEvidence?.collapsedAgain?.operationsExpanded !== "false"
        || value.viewportEvidence?.narrow?.horizontalOverflow !== false
      )
    ) {
      errors.push("CD05 browser artifact lacks required interaction evidence");
    }
    if (
      workstreamId === "CD06"
      && (
        value.desktop?.failedExpanded !== true
        || value.desktop?.duplicateDisclosureIds !== 0
        || value.desktop?.childRunProjected !== false
        || value.narrow?.horizontalOverflow !== false
      )
    ) {
      errors.push("CD06 browser artifact lacks required cross-surface evidence");
    }
    if (
      workstreamId === "CD07"
      && (
        !value.initial?.runId
        || value.selected?.selectedLabel !== value.reloaded?.selectedLabel
        || value.initial?.previewContainsSecret !== false
        || value.initial?.previewContainsRedaction !== true
      )
    ) {
      errors.push("CD07 browser artifact lacks required Inspector evidence");
    }
    if (
      workstreamId === "CD08"
      && (
        value.checks?.length !== 15
        || value.checks.some((entry) => entry.passed !== true)
        || value.runtimeStress?.length !== 6
      )
    ) {
      errors.push("CD08 hardening artifact lacks required checks");
    }
    if (isLocalPackage) {
      const sourceManifest = await computeLocalCandidateSourceManifest(root);
      if (
        value.sourceDigest !== sourceManifest.digest
        || value.sourceFileCount !== sourceManifest.fileCount
      ) {
        errors.push("CD09 local package source manifest is stale");
      }
      if (!options.releaseAttestation) {
        const appPath = path.resolve(root, value.appPath ?? "");
        const expectedAppRoot = path.join(root, "release-local");
        if (
          !appPath.startsWith(`${expectedAppRoot}${path.sep}`)
          || !appPath.endsWith(".app")
        ) {
          errors.push("CD09 local package path is outside release-local");
        } else {
          const asarPath = path.join(appPath, "Contents/Resources/app.asar");
          try {
            const [asar, appMetadata, canonicalAppPath] = await Promise.all([
              readFile(asarPath),
              lstat(appPath),
              realpath(appPath),
            ]);
            if (
              !appMetadata.isDirectory()
              || appMetadata.isSymbolicLink()
              || canonicalAppPath !== appPath
            ) {
              errors.push("CD09 local package app root is not a real directory");
            }
            const appTree = await computeTreeManifest(appPath);
            const safeFsHelper = inspectSafeFsHelper(path.join(
              appPath,
              "Contents/Resources/safe-fs/zerox-safe-fs",
            ), { requireSignature: true });
            const safeFsReceipt = {
              ...safeFsHelper,
              path: path.relative(root, safeFsHelper.path),
            };
            const packagedNativeCache =
              "node_modules/better-sqlite3/bin/";
            const embeddedPackage = JSON.parse(
              extractFile(asarPath, "package.json").toString("utf8"),
            );
            if (
              value.appAsarBytes !== asar.byteLength
              || value.appAsarSha256 !== sha256BytesV13(asar)
              || value.appTreeEntryCount !== appTree.entryCount
              || value.appTreeSha256 !== appTree.digest
              || JSON.stringify(value.safeFsHelper) !== JSON.stringify(safeFsReceipt)
              || embeddedPackage.version !== "3.9.2"
              || embeddedPackage.buildCommit !== `workspace-${value.sourceDigest}`
              || embeddedPackage.releaseMode !== "local-candidate"
              || listPackage(asarPath).some((entry) =>
                entry.replaceAll("\\", "/").includes(packagedNativeCache))
              || existsSync(path.join(
                appPath,
                "Contents/Resources/app.asar.unpacked",
                packagedNativeCache,
              ))
            ) {
              errors.push("CD09 local package app tree digest changed");
            }
          } catch {
            errors.push("CD09 local package app.asar is missing");
          }
        }
      }
    }
    if (
      workstreamId === "CD09"
      && value.kind === "conversation-disclosure-real-app-acceptance"
      && (
        value.programId !== program.programId
        || value.version !== "3.9.2"
        || value.status !== "passed"
        || value.accepted !== true
        || value.scenarioCount !== 19
        || value.passedScenarioCount !== 19
        || !Array.isArray(value.commandResults)
        || value.commandResults.length !== 7
        || value.commandResults.some((result, index) =>
          result.status !== "passed"
          || !/^sha256:[0-9a-f]{64}$/.test(result.stdoutSha256 ?? "")
          || !/^sha256:[0-9a-f]{64}$/.test(result.stderrSha256 ?? "")
          || !result.command?.endsWith(expectedAcceptanceCommands[index]))
        || expectedFocusedTestFiles.some(
          (file, index) =>
            value.commandResults.at(-1)?.testFiles?.[index] !== file,
        )
        || value.commandResults.at(-1)?.testFiles?.length
          !== expectedFocusedTestFiles.length
        || !Array.isArray(value.commandResults.at(-1)?.passedTests)
        || [...expectedScenarioAssertions.values()].flat().some(
          (assertion) =>
            assertion.testFile
            && !value.commandResults.at(-1).passedTests.some(
              (passed) =>
                passed.testFile === assertion.testFile
                && passed.fullName.endsWith(assertion.testName),
            ),
        )
        || !Array.isArray(value.scenarios)
        || value.scenarios.length !== 19
        || new Set(value.scenarios.map((scenario) => scenario.id)).size !== 19
        || expectedScenarioIds.some(
          (id, index) => value.scenarios[index]?.id !== id,
        )
        || value.scenarios.some((scenario, index) => {
          const source = program.scenarioMatrix[index];
          return scenario.scenarioDigest !== hashCanonicalV13(source)
            || scenario.title !== source.title
            || scenario.executor !== source.executor
            || JSON.stringify(scenario.fixture) !== JSON.stringify(source.fixture)
            || JSON.stringify(scenario.evidenceRequirements)
              !== JSON.stringify(source.evidenceRequirements)
            || JSON.stringify(scenario.expected) !== JSON.stringify(source.expected)
            || scenario.runtimeEvidence?.kind
              !== "production-electron-main-preload-scenario"
            || scenario.runtimeEvidence?.commandIndex !== 5
            || scenario.runtimeEvidence?.passed !== true
            || scenario.runtimeEvidence?.receipt
              !== `.zerox/verification/conversation-disclosure/CD09-scenarios/${scenario.id}.json`
            || scenario.runtimeEvidence?.screenshot
              !== `.zerox/verification/conversation-disclosure/CD09-scenarios/${scenario.id}.png`
            || !/^sha256:[0-9a-f]{64}$/.test(
              scenario.runtimeEvidence?.receiptDigest ?? "",
            )
            || typeof scenario.runtimeEvidence?.executionId !== "string"
            || !Array.isArray(scenario.runtimeEvidence?.processEpochs)
            || scenario.runtimeEvidence.processEpochs.length < 1
            || JSON.stringify(scenario.runtimeEvidence?.validationErrors)
              !== "[]"
            || JSON.stringify(scenario.assertions)
              !== JSON.stringify(expectedScenarioAssertions.get(scenario.id))
            || JSON.stringify(scenario.evidence)
              !== JSON.stringify(expectedScenarioEvidence(scenario.id));
        })
        || value.scenarios.some((scenario) => scenario.status !== "passed")
      )
    ) {
      errors.push("CD09 acceptance manifest lacks 19 scenario-bound passes");
    }
    if (
      workstreamId === "CD09"
      && value.kind === "conversation-disclosure-real-app-acceptance"
      && Array.isArray(value.scenarios)
    ) {
      const executionIds = new Set();
      const receiptDigests = new Set();
      for (let index = 0; index < program.scenarioMatrix.length; index += 1) {
        const source = program.scenarioMatrix[index];
        const expectedReceiptPath =
          `.zerox/verification/conversation-disclosure/CD09-scenarios/${source.id}.json`;
        const expectedScreenshotPath =
          `.zerox/verification/conversation-disclosure/CD09-scenarios/${source.id}.png`;
        const [receiptCapture, screenshotCapture] = await Promise.all([
          readBoundRegularFile(
            path.join(root, expectedReceiptPath),
            errors,
            `CD09 scenario receipt ${source.id}`,
          ),
          readBoundRegularFile(
            path.join(root, expectedScreenshotPath),
            errors,
            `CD09 scenario screenshot ${source.id}`,
          ),
        ]);
        if (!receiptCapture || !screenshotCapture) continue;
        let receipt;
        try {
          receipt = JSON.parse(receiptCapture.bytes.toString("utf8"));
        } catch {
          errors.push(`CD09 scenario receipt is not JSON: ${source.id}`);
          continue;
        }
        const validation = validateProductionScenarioReceipt(receipt, source);
        const manifestScenario = value.scenarios[index];
        const initialScreenshotCapture = [
          "S13-legacy-coverage",
          "S17-cancel-interruption",
        ].includes(source.id)
          ? await readBoundRegularFile(
              path.join(
                root,
                `.zerox/verification/conversation-disclosure/CD09-scenarios/${source.id}.initial.png`,
              ),
              errors,
              `CD09 initial scenario screenshot ${source.id}`,
            )
          : null;
        if (
          !validation.ok
          || receipt.screenshotDigests?.[0]
            !== sha256BytesV13(screenshotCapture.bytes)
          || (
            initialScreenshotCapture
            && receipt.screenshotDigests?.[1]
              !== sha256BytesV13(initialScreenshotCapture.bytes)
          )
          || manifestScenario?.runtimeEvidence?.receiptDigest !== receipt.digest
          || manifestScenario?.runtimeEvidence?.executionId
            !== receipt.executionId
          || JSON.stringify(manifestScenario?.runtimeEvidence?.processEpochs)
            !== JSON.stringify(receipt.processEpochs)
        ) {
          errors.push(
            `CD09 direct scenario evidence is invalid: ${source.id}`,
          );
        }
        executionIds.add(receipt.executionId);
        receiptDigests.add(receipt.digest);
      }
      if (
        executionIds.size !== expectedScenarioIds.length
        || receiptDigests.size !== expectedScenarioIds.length
      ) {
        errors.push("CD09 scenario receipts are not unique");
      }
    }
  } catch {
    errors.push(`${workstreamId} completion artifact is invalid JSON: ${artifact}`);
  }
}

async function validateReviewReceipt(value, artifact, errors, options) {
  const expectedLane = path.basename(artifact).includes("-code-")
    ? "code"
    : "security";
  const candidate = await computeReviewCandidateManifest(root);
  const pins = expectedReviewPins(options)?.[expectedLane];
  const expectedOutput = [
    `Agent run ID: ${value?.reviewerAgentId}`,
    `Challenge: ${value?.challenge}`,
    `Lane: ${expectedLane}`,
    `Candidate manifest: ${candidate.digest}`,
    `Candidate file count: ${candidate.fileCount}`,
    "FINAL_VERDICT: PASS",
    "FINAL_COUNTS: 0C/0M/0m",
    "",
  ].join("\n");
  const keys = Object.keys(value ?? {}).sort();
  const digestInput = Object.fromEntries(
    Object.entries(value ?? {}).filter(([key]) => key !== "digest"),
  );
  if (
    JSON.stringify(keys) !== JSON.stringify(expectedReviewReceiptKeys)
    || value.schemaVersion !== 1
    || value.kind !== "v3.9.2-adversarial-review-receipt"
    || value.lane !== expectedLane
    || !pins
    || value.reviewerAgentId !== pins.reviewerAgentId
    || value.challenge !== pins.challenge
    || value.digest !== pins.receiptDigest
    || typeof value.reviewerAgentId !== "string"
    || value.reviewerAgentId.length < 16
    || !/^sha256:[0-9a-f]{64}$/.test(value.challenge ?? "")
    || value.identityAssurance !== "platform-task-id-not-signed"
    || value.reviewedCandidateDigest !== candidate.digest
    || value.reviewedCandidateFileCount !== candidate.fileCount
    || value.verdict !== "passed"
    || JSON.stringify(value.findingCounts)
      !== JSON.stringify({ critical: 0, major: 0, minor: 0 })
    || value.reviewOutput !== expectedOutput
    || !/^sha256:[0-9a-f]{64}$/.test(value.reviewOutputDigest ?? "")
    || value.reviewOutputDigest
      !== sha256BytesV13(Buffer.from(value.reviewOutput))
    || value.digest !== hashCanonicalV13(digestInput)
  ) {
    errors.push(`CD09 ${expectedLane} review receipt is invalid`);
  }
}

function expectedReviewPins(options) {
  const pins = {
    code: {
      reviewerAgentId: options.expectedCodeReviewAgentId
        ?? process.env.ZEROX_V392_CODE_REVIEW_AGENT_ID,
      challenge: options.expectedCodeReviewChallenge
        ?? process.env.ZEROX_V392_CODE_REVIEW_CHALLENGE,
      receiptDigest: options.expectedCodeReviewReceiptDigest
        ?? process.env.ZEROX_V392_CODE_REVIEW_RECEIPT_DIGEST,
    },
    security: {
      reviewerAgentId: options.expectedSecurityReviewAgentId
        ?? process.env.ZEROX_V392_SECURITY_REVIEW_AGENT_ID,
      challenge: options.expectedSecurityReviewChallenge
        ?? process.env.ZEROX_V392_SECURITY_REVIEW_CHALLENGE,
      receiptDigest: options.expectedSecurityReviewReceiptDigest
        ?? process.env.ZEROX_V392_SECURITY_REVIEW_RECEIPT_DIGEST,
    },
  };
  return Object.values(pins).every((entry) =>
    typeof entry.reviewerAgentId === "string"
    && entry.reviewerAgentId.length >= 16
    && /^sha256:[0-9a-f]{64}$/.test(entry.challenge ?? "")
    && /^sha256:[0-9a-f]{64}$/.test(entry.receiptDigest ?? ""))
    ? pins
    : null;
}

async function validateReviewSummary(bytes, errors) {
  const captures = await Promise.all([
    readCanonicalJson(
      path.join(root, ".zerox/reviews/CD09-code-review.json"),
      errors,
    ),
    readCanonicalJson(
      path.join(root, ".zerox/reviews/CD09-security-review.json"),
      errors,
    ),
  ]);
  const [code, security] = captures.map((capture) => capture?.value);
  const text = bytes.toString("utf8");
  const expectedText = code && security
    ? [
      "# CD09 Adversarial Acceptance",
      "",
      `Code receipt: ${code.digest}`,
      `Security receipt: ${security.digest}`,
      "",
      "FINAL_VERDICT: PASS",
      "FINAL_COUNTS: 0C/0M/0m",
      "",
    ].join("\n")
    : "";
  return Boolean(
    code
    && security
    && code.reviewerAgentId !== security.reviewerAgentId
    && code.challenge !== security.challenge
    && text === expectedText,
  );
}

function expectedScenarioEvidence(scenarioId) {
  return [...expectedAcceptanceScenarioIds.entries()]
    .filter(([, scenarioIds]) => scenarioIds.includes(scenarioId))
    .map(([workstreamId]) => ({
      workstreamId,
      artifact: acceptanceArtifactPaths.get(workstreamId),
      accepted: true,
    }));
}

async function readCanonicalJson(filePath, errors, requirePrivate = false) {
  const capture = await readBoundRegularFile(filePath, errors, "evidence");
  if (!capture) return null;
  try {
    const { bytes, metadata } = capture;
    if (requirePrivate && (metadata.mode & 0o077) !== 0) {
      errors.push(`external anchor must be private: ${filePath}`);
    }
    const value = JSON.parse(bytes.toString("utf8"));
    const digestInput = Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== "digest"),
    );
    if (value.digest && value.digest !== hashCanonicalV13(digestInput)) {
      errors.push(`canonical self-digest mismatch: ${filePath}`);
    }
    return { value, sha256: sha256BytesV13(bytes) };
  } catch (error) {
    errors.push(`cannot read evidence ${filePath}: ${error.message}`);
    return null;
  }
}

async function readBoundRegularFile(filePath, errors, label) {
  let handle;
  try {
    handle = await open(
      filePath,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const before = await handle.stat();
    const bytes = await handle.readFile();
    const [metadata, leaf, canonicalPath] = await Promise.all([
      handle.stat(),
      lstat(filePath),
      realpath(filePath),
    ]);
    if (
      !metadata.isFile()
      || metadata.nlink !== 1
      || metadata.dev !== before.dev
      || metadata.ino !== before.ino
      || metadata.size !== before.size
      || metadata.mtimeMs !== before.mtimeMs
      || metadata.ctimeMs !== before.ctimeMs
      || !leaf.isFile()
      || leaf.isSymbolicLink()
      || leaf.dev !== before.dev
      || leaf.ino !== before.ino
      || canonicalPath !== filePath
    ) {
      errors.push(`unsafe ${label} path: ${filePath}`);
      return null;
    }
    return { bytes, metadata };
  } catch (error) {
    errors.push(`cannot read ${label} ${filePath}: ${error.message}`);
    return null;
  } finally {
    await handle?.close();
  }
}

function rejectInheritedGitEnvironment() {
  const inherited = Object.entries(process.env).find(
    ([key, value]) => isRejectedGitEnvironmentVariable(key) && value,
  );
  if (inherited) {
    throw new Error(`successor program rejects inherited ${inherited[0]}`);
  }
}

function isRejectedGitEnvironmentVariable(name) {
  const normalized = name.toUpperCase();
  return normalized.startsWith("GIT_") && normalized !== "GIT_PAGER";
}

function trustedGitEnvironment() {
  return {
    HOME: "/var/empty",
    LANG: "en_US.UTF-8",
    PATH: "/usr/bin:/bin",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_COUNT: "0",
    GIT_OPTIONAL_LOCKS: "0",
  };
}

function runTrustedGitSync(repositoryRoot, args, options = {}) {
  const canonicalRoot = realpathSync(repositoryRoot);
  const gitDirectory = realpathSync(execFileSync(
    "/usr/bin/git",
    ["--no-replace-objects", "rev-parse", "--absolute-git-dir"],
    {
      cwd: canonicalRoot,
      env: trustedGitEnvironment(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    },
  ).trim());
  return execFileSync(
    "/usr/bin/git",
    [
      "--no-replace-objects",
      "--literal-pathspecs",
      `--git-dir=${gitDirectory}`,
      `--work-tree=${canonicalRoot}`,
      ...args,
    ],
    {
      cwd: canonicalRoot,
      env: trustedGitEnvironment(),
      encoding: options.encoding ?? "utf8",
      stdio: options.stdio ?? ["ignore", "pipe", "ignore"],
    },
  );
}

async function runSuccessorTrustedGitSelfTest() {
  const testRoot = await realpath(await mkdtemp(
    path.join(
      process.env.TMPDIR ?? "/private/tmp",
      "zerox-successor-trusted-git-",
    ),
  ));
  const repositoryRoot = path.join(testRoot, "repository");
  const hostileRoot = path.join(testRoot, "hostile");
  const originalEnvironment = new Map(
    [
      "GIT_DIR",
      "GIT_OBJECT_DIRECTORY",
      "GIT_REPLACE_REF_BASE",
      "GIT_CONFIG_PARAMETERS",
      "GIT_PAGER",
    ].map(
      (name) => [name, process.env[name]],
    ),
  );
  const git = (cwd, args) => execFileSync(
    "/usr/bin/git",
    ["--no-replace-objects", ...args],
    {
      cwd,
      env: trustedGitEnvironment(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  try {
    await Promise.all([
      mkdir(repositoryRoot, { recursive: true }),
      mkdir(hostileRoot, { recursive: true }),
    ]);
    git(repositoryRoot, ["init", "-q"]);
    await writeFile(path.join(repositoryRoot, "value.txt"), "reviewed\n");
    git(repositoryRoot, ["add", "--all"]);
    git(repositoryRoot, [
      "-c", "user.name=Zerox Acceptance",
      "-c", "user.email=acceptance@invalid.local",
      "commit", "-q", "-m", "reviewed",
    ]);
    const reviewedHead = git(repositoryRoot, ["rev-parse", "HEAD"]).trim();
    const reviewedTree = git(
      repositoryRoot,
      ["rev-parse", "--verify", `${reviewedHead}^{tree}`],
    ).trim();
    await writeFile(path.join(repositoryRoot, "value.txt"), "replacement\n");
    git(repositoryRoot, ["add", "--all"]);
    git(repositoryRoot, [
      "-c", "user.name=Zerox Acceptance",
      "-c", "user.email=acceptance@invalid.local",
      "commit", "-q", "-m", "replacement",
    ]);
    const replacementHead = git(repositoryRoot, ["rev-parse", "HEAD"]).trim();
    git(repositoryRoot, ["checkout", "-q", reviewedHead]);
    git(repositoryRoot, ["replace", reviewedHead, replacementHead]);
    git(hostileRoot, ["init", "-q"]);
    process.env.GIT_PAGER = "cat";
    let benignGitAccepted = true;
    try {
      rejectInheritedGitEnvironment();
    } catch {
      benignGitAccepted = false;
    }
    process.env.GIT_CONFIG_PARAMETERS = "'core.excludesFile=/dev/null'";
    let configInjectionRejected = false;
    try {
      rejectInheritedGitEnvironment();
    } catch {
      configInjectionRejected = true;
    }
    delete process.env.GIT_CONFIG_PARAMETERS;
    process.env.GIT_DIR = path.join(hostileRoot, ".git");
    process.env.GIT_OBJECT_DIRECTORY = path.join(hostileRoot, "objects");
    process.env.GIT_REPLACE_REF_BASE = "refs/replace/hostile";
    let inheritedGitRejected = false;
    try {
      rejectInheritedGitEnvironment();
    } catch {
      inheritedGitRejected = true;
    }
    const trustedTree = runTrustedGitSync(
      repositoryRoot,
      ["rev-parse", "--verify", `${reviewedHead}^{tree}`],
    ).trim();
    runTrustedGitSync(
      repositoryRoot,
      ["merge-base", "--is-ancestor", reviewedHead, "HEAD"],
      { stdio: "ignore" },
    );
    if (
      !benignGitAccepted
      || !configInjectionRejected
      || !inheritedGitRejected
      || trustedTree !== reviewedTree
    ) {
      throw new Error("successor trusted Git self-test accepted injected authority");
    }
    console.log(JSON.stringify({
      successorTrustedGitSelfTest: "passed",
      benignGitAccepted,
      configInjectionRejected,
      inheritedGitRejected,
      replacementIgnored: true,
    }));
  } finally {
    for (const [name, value] of originalEnvironment) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await rm(testRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--self-test-trusted-git") {
    await runSuccessorTrustedGitSelfTest();
  } else {
    const receipt = await checkConversationDisclosureSuccessorProgram();
    console.log("Conversation disclosure successor program check passed.");
    console.log(JSON.stringify(receipt));
  }
}
