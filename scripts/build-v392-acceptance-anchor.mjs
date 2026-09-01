#!/usr/bin/env node

// Copy this self-contained runner outside the repository, pin its SHA-256, and
// invoke that copy. It imports Node builtins only and verifies candidate control
// bytes before and after executing acceptance or packaging code.

import {
  execFile as execFileCallback,
  spawn,
} from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants, watch } from "node:fs";
import {
  chmod,
  cp,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  symlink,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const SELF_PATH = await realpath(fileURLToPath(import.meta.url));
const SOURCE_BASELINE_GIT_HEAD =
  "942712279426601c1a5162dabc6fb9b663262e07";
const IMMUTABLE_COMMITTED_WHITESPACE_ALLOWLIST = Object.freeze({
  ".zerox/decisions/CD05-chat-disclosure-surface.md": Object.freeze({
    blob: "4925ab7ef0cc1270f26a6671ea137705e9345681",
    diagnostics: Object.freeze(["47: new blank line at EOF."]),
  }),
  ".zerox/decisions/CD06-cross-surface-disclosure.md": Object.freeze({
    blob: "5b3c58df15ae6a7c691a14ad231ddf19c65a408d",
    diagnostics: Object.freeze(["40: new blank line at EOF."]),
  }),
  ".zerox/decisions/CD07-evidence-inspector.md": Object.freeze({
    blob: "ce87fce7d172ea7041411c793338eb7982292ba0",
    diagnostics: Object.freeze(["25: new blank line at EOF."]),
  }),
  ".zerox/verification/conversation-disclosure/CD04-package-scripts-test.target.ts":
    Object.freeze({
      blob: "1861c7a4b59c7347303171ba9b80f6b8b38ec1d7",
      diagnostics: Object.freeze(["1065: new blank line at EOF."]),
    }),
  "src/shared/conversationDisclosureProgramGovernanceV3.test.ts": Object.freeze({
    blob: "250f1bdafcd4bb99f0065dcbb1912f93c9d9b1f2",
    diagnostics: Object.freeze(["525: new blank line at EOF."]),
  }),
});
const CD04_ANCHOR_DIGEST =
  "sha256:99b8b7af27e24d2c44e2bb3b2433ada877fd68aeac2d1de80427931de15c01ef";
const EXPECTED_NPM_CLI_DIGEST =
  "sha256:8e5f6f3429f8cdbe693cdc29904e9d5a7b127a494bd15c804bd54c7403bfcbe7";
const EXPECTED_NPM_TREE = Object.freeze({
  digest: "sha256:cca4eaae5fd8b8ffcc7e5e86c8168014bf40db083e5b7269eb6b5c4aa0beb290",
  entryCount: 2371,
});
const EXPECTED_TOOLCHAIN = Object.freeze({
  digest: "sha256:003bd9ede62e2762ee702f353189a1f26240a46258f6e02d2168a5f241d77f9e",
  entryCount: 21120,
});
const EXPECTED_NATIVE_NODE_ADDON_DIGEST =
  "sha256:259c51183118091e9b3b7591755ca89873e6d0145e9a0e80a7f68ef428ab6b95";
const EXPECTED_MACOS_COMPILER = Object.freeze({
  clang: "/Library/Developer/CommandLineTools/usr/bin/clang",
  clangXX: "/Library/Developer/CommandLineTools/usr/bin/clang++",
  digest: "sha256:f30550eab15fdf5ab8c0dc54c52679711241e5d4b636b027e18c09fef531775d",
});
const EXPECTED_MACOS_SDK = Object.freeze({
  alias: "/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk",
  canonicalPath: "/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk",
  digest: "sha256:3f7ce329454a71cfa9ca9a481b530a5fc8dbb1d4c0fea2fc0f50a6cecec6cfb1",
  entryCount: 49730,
  settingsDigest:
    "sha256:f8d005f09381389167f9e0aeaa169bc9e7dff162ef22ca2fd8e98df7ff1acafe",
});
const EXPECTED_UNSIGNED_SAFE_FS_HELPER_DIGEST =
  "sha256:58b2493f585d2bc814ff44092fdde3b3debb793ea715a4a14b7fc638b0c04ad6";
const PINNED_SAFE_FS_TOOLCHAIN_POLICY_NAME =
  ".v392-pinned-safe-fs-toolchain.json";
const EXPECTED_NODE_HEADERS = Object.freeze({
  digest: "sha256:608964880bdb0f636deeb9486ecbd08478625a291ac17f10613f1189016ee9fb",
  entryCount: 3325,
});
const EXPECTED_ELECTRON_CACHE = Object.freeze({
  digest: "sha256:d3ea4e248cdc22f5ac84207b01391bdeb3b52f1b41c8da89738c24d14a12c9a0",
  directory: "b0f2489e60f367b47fe1b6041d363a40ea0e3c0d17bff7e17803e80374dfeb00",
  file: "electron-v42.9.0-darwin-arm64.zip",
});
const EXPECTED_ELECTRON_HEADERS_ARCHIVE_DIGEST =
  "sha256:7bef173f1350b2c9622b56fcd5ea24a578d2294ab164fd0c55aefa842a0243a6";
const EXPECTED_ELECTRON_HEADERS = Object.freeze({
  digest: "sha256:1b7669eebf3528c504e0ba52768aef1b8fe8c7066defc049ade50f1dacec2238",
  entryCount: 131,
});
const EXPECTED_GENERATED_NATIVE_CACHE = Object.freeze({
  digest:
    "sha256:b7f4e84fa1ea2aa002c607f0a9460387d2822918a88492c6a7a7f3111238e4ae",
  entryCount: 3,
});
const CONTROL_DIGESTS = Object.freeze({
  "package.json":
    "sha256:61869c59a56cbba80cfe4fc327c0e5b542db4b01a06e3d4deec2ae350872e3ef",
  "package-lock.json":
    "sha256:c5cd81cff944c33d2a1bcd785cba49fd3a34f0c7279a701989e6fa9e3c448beb",
  "scripts/check-conversation-disclosure-successor-program.mjs":
    "sha256:cd70260a32a245bf2c08d658fbeed795248740aad45be1d4878069d618f6b9e2",
  "scripts/check-harness-state.mjs":
    "sha256:38637c82f9c7cccff3594130ab1a00937310d4a2c46dc4b5f4978c9415b4f92f",
  "scripts/run-conversation-disclosure-acceptance.mjs":
    "sha256:79c2e3034d86ca44d8cb15f3d6817edce0a36d77aaf4a4ac5e2e47a40dd5a02b",
  "scripts/run-conversation-disclosure-real-app.mjs":
    "sha256:8f8570d53afa1bb6489c6d50466a1944d02dc68eed0d11b5b279e6ae95e87ef8",
  "scripts/conversation-disclosure-acceptance-contract.mjs":
    "sha256:a4e57f3b768e95690bb116deb5b98887d4afbb6475d111ebf595a18d76cd4d45",
  "scripts/capture-cd05-chat-browser.mjs":
    "sha256:e6e66bb1c3329b6db2f01e238a0ced4f1cf0e0e833aff1cddaefb17ac48e2c54",
  "scripts/capture-cd06-cross-surface-browser.mjs":
    "sha256:7871f8b90963b1643abaf405cf700993ba59a90f52db735df4be7511cf94b97a",
  "scripts/capture-cd07-inspector-browser.mjs":
    "sha256:09fa1da1a04bc0df023673054ecbb22ca2aa1eafb93244304c31b53633bb0f9d",
  "scripts/run-conversation-disclosure-hardening.mjs":
    "sha256:437dcbd9d45b30f984b9cc56e467fd644ba9015fe4e74eb6731fd9aec565a82f",
  "scripts/run-conversation-disclosure-performance.mjs":
    "sha256:cdb63c468c0307ae0ff0b87d93ffede86d7df63ffe73fb7a75560c4197740652",
  "scripts/probe-native-sqlite.mjs":
    "sha256:41925fe9c348540d46abb43f275ffbf40ea86139304a27e33da465b4f220f34b",
  "scripts/package-local-candidate.mjs":
    "sha256:5dc447b6e7822e36b35b222f125e070db2ca8268f39d7640568839beacdef329",
  "scripts/local-candidate-source-manifest.mjs":
    "sha256:62198db25f2246fa45baba16534a4d912437e253d5d135690d3eb940a7ccbc91",
});
const CD09_SCENARIO_IDS = Object.freeze(
  Array.from({ length: 19 }, (_, index) => `S${
    String(index + 1).padStart(2, "0")
  }-${[
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
  ][index]}`),
);
const FINAL_FILES = Object.freeze([
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
  ...CD09_SCENARIO_IDS.flatMap((scenarioId) => [
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
]);
const LIFECYCLE_PUBLICATION_FILES = Object.freeze([
  ".zerox/conversation-disclosure-program.json",
  ".zerox/feature_list.json",
]);
const SYSTEM_SANDBOX_READ_ROOTS = Object.freeze([
  "/System",
  "/Library/Apple",
  "/Library/Developer/CommandLineTools",
  "/bin",
  "/sbin",
  "/usr",
  "/opt/homebrew",
  "/usr/local",
  "/dev",
  "/private/etc",
  "/private/var/db",
]);
const TRUSTED_SEATBELT_REQUIREMENTS = Object.freeze([
  "workspace-write",
  "adjacent-write-denied",
  "symlink-write-denied",
  "declared-read",
  "adjacent-read-denied",
  "private-temp-isolation",
  "electron-sibling-metadata-denied",
  "read-only-write-denied",
  "network-denied",
  "timeout-termination",
  "host-toolchain-command-success-isolation",
  "host-toolchain-command-failure-isolation",
  "host-toolchain-electron-success-isolation",
  "host-toolchain-electron-failure-isolation",
  "cleanup",
]);
const GENERATED_NATIVE_CACHE_PATH = path.join(
  "node_modules",
  "better-sqlite3",
  "bin",
);
const GENERATED_BUILD_DIRECTORIES = Object.freeze([
  "dist",
  "dist-electron",
  "dist-native",
]);
const GENERATED_PUBLICATION_FILES = Object.freeze(FINAL_FILES.filter(
  (relativePath) =>
    LIFECYCLE_PUBLICATION_FILES.includes(relativePath)
    || relativePath.startsWith(
      ".zerox/verification/conversation-disclosure/CD05-",
    )
    || relativePath.startsWith(
      ".zerox/verification/conversation-disclosure/CD06-",
    )
    || relativePath.startsWith(
      ".zerox/verification/conversation-disclosure/CD07-",
    )
    || relativePath ===
      ".zerox/verification/conversation-disclosure/CD08-hardening.json"
    || relativePath ===
      ".zerox/verification/conversation-disclosure/CD08-full-gates.md"
    || relativePath.startsWith(
      ".zerox/verification/conversation-disclosure/CD09-",
    ),
));
if (
  Object.keys(CONTROL_DIGESTS).length !== 15
  || FINAL_FILES.length !== 70
  || GENERATED_PUBLICATION_FILES.length !== 55
) {
  fail("v3.9.2 acceptance file roster invariant changed");
}

if (
  process.argv.length === 3
  && process.argv[2] === "--self-test-publication-journal"
) {
  await runPublicationJournalSelfTest();
  process.exit(0);
}
if (
  process.argv.length === 3
  && process.argv[2] === "--self-test-host-toolchain-isolation"
) {
  await runHostToolchainIsolationSelfTest();
  process.exit(0);
}
if (
  process.argv.length === 3
  && process.argv[2] === "--self-test-generated-build-boundary"
) {
  verifyGeneratedBuildBoundarySelfTest();
  process.exit(0);
}
if (
  process.argv.length === 3
  && process.argv[2] === "--self-test-safe-fs-package-identity"
) {
  verifySafeFsPackageIdentitySelfTest();
  process.exit(0);
}
if (
  process.argv.length === 3
  && process.argv[2] === "--self-test-safe-fs-toolchain-policy"
) {
  console.log(JSON.stringify(createPinnedSafeFsToolchainPolicy({
    clang: EXPECTED_MACOS_COMPILER.clang,
    canonicalPath: EXPECTED_MACOS_COMPILER.clang,
    digest: EXPECTED_MACOS_COMPILER.digest,
    sdkAlias: EXPECTED_MACOS_SDK.alias,
    sdkCanonicalPath: EXPECTED_MACOS_SDK.canonicalPath,
    sdkSettingsDigest: EXPECTED_MACOS_SDK.settingsDigest,
  })));
  process.exit(0);
}

rejectPreloadEnvironment();
const options = parseOptions(process.argv.slice(2));
const repositoryRealpath = await realpath(options.repository);
if (isWithin(repositoryRealpath, SELF_PATH)) {
  fail("acceptance runner must execute from a caller-pinned copy outside the repository");
}
assertDigest(options.expectedRunnerDigest, "runner digest");
assertDigest(options.expectedNodeDigest, "Node executable digest");
assertDigest(options.expectedNpmCliDigest, "npm CLI digest");
assertDigest(options.expectedElectronCacheDigest, "Electron cache digest");
assertDigest(
  options.expectedElectronHeadersDigest,
  "Electron headers archive digest",
);
assertDigest(options.expectedCodeReviewChallenge, "code review challenge");
assertDigest(options.expectedCodeReviewReceiptDigest, "code review receipt digest");
assertDigest(options.expectedSecurityReviewChallenge, "security review challenge");
assertDigest(
  options.expectedSecurityReviewReceiptDigest,
  "security review receipt digest",
);
if (
  options.expectedCodeReviewAgentId.length < 16
  || options.expectedSecurityReviewAgentId.length < 16
  || options.expectedCodeReviewAgentId === options.expectedSecurityReviewAgentId
  || options.expectedCodeReviewChallenge === options.expectedSecurityReviewChallenge
) {
  fail("caller-pinned review identities and challenges are invalid");
}
assertDigest(options.expectedSourceDigest, "source manifest digest");
assertGitObjectId(options.expectedGitHead, "Git HEAD");
assertGitObjectId(options.expectedGitTree, "Git tree");
const selfCapture = await captureRegularFile(SELF_PATH, "external acceptance runner");
if (selfCapture.digest !== options.expectedRunnerDigest) {
  fail("external acceptance runner digest does not match the caller pin");
}
const nodePath = await realpath(process.execPath);
const nodeCapture = await captureRegularFile(nodePath, "Node executable");
if (nodeCapture.digest !== options.expectedNodeDigest) {
  fail("Node executable digest does not match the caller pin");
}
const macosCompiler = await resolvePinnedMacosCompiler();
const npmCliPath = await realpath(options.npmCli);
assertOutsideRepository(npmCliPath, repositoryRealpath, "npm CLI");
const npmCliCapture = await captureRegularFile(npmCliPath, "npm CLI");
if (
  npmCliCapture.digest !== options.expectedNpmCliDigest
  || npmCliCapture.digest !== EXPECTED_NPM_CLI_DIGEST
) {
  fail("npm CLI digest does not match the caller-reviewed pin");
}
const electronCachePath = await realpath(options.electronCacheArchive);
assertOutsideRepository(
  electronCachePath,
  repositoryRealpath,
  "Electron cache archive",
);
const electronCacheCapture = await captureRegularFile(
  electronCachePath,
  "Electron cache archive",
);
if (
  electronCacheCapture.digest !== options.expectedElectronCacheDigest
  || electronCacheCapture.digest !== EXPECTED_ELECTRON_CACHE.digest
  || path.basename(electronCachePath) !== EXPECTED_ELECTRON_CACHE.file
  || path.basename(path.dirname(electronCachePath))
    !== EXPECTED_ELECTRON_CACHE.directory
) {
  fail("Electron cache archive does not match the caller-reviewed pin");
}
const electronHeadersArchivePath = await realpath(
  options.electronHeadersArchive,
);
assertOutsideRepository(
  electronHeadersArchivePath,
  repositoryRealpath,
  "Electron headers archive",
);
const electronHeadersArchiveCapture = await captureRegularFile(
  electronHeadersArchivePath,
  "Electron headers archive",
);
if (
  electronHeadersArchiveCapture.digest
    !== options.expectedElectronHeadersDigest
  || electronHeadersArchiveCapture.digest
    !== EXPECTED_ELECTRON_HEADERS_ARCHIVE_DIGEST
) {
  fail("Electron headers archive does not match the caller-reviewed pin");
}
const sourceNpmRoot = path.resolve(path.dirname(npmCliPath), "..");
const npmTree = await computeTreeManifest(sourceNpmRoot);
if (
  npmTree.digest !== EXPECTED_NPM_TREE.digest
  || npmTree.entryCount !== EXPECTED_NPM_TREE.entryCount
) {
  fail("npm installation tree differs from the caller-reviewed toolchain");
}
assertOutsideRepository(options.output, repositoryRealpath, "acceptance anchor");
assertOutsideRepository(options.cd04Anchor, repositoryRealpath, "CD04 anchor");
const outputParent = path.dirname(options.output);
const outputParentMetadata = await lstat(outputParent);
if (
  !outputParentMetadata.isDirectory()
  || outputParentMetadata.isSymbolicLink()
  || (outputParentMetadata.mode & 0o077) !== 0
  || await realpath(outputParent) !== outputParent
) {
  fail("acceptance anchor parent must be canonical");
}
const pinnedToolchainPolicyPath = path.join(
  outputParent,
  PINNED_SAFE_FS_TOOLCHAIN_POLICY_NAME,
);
await writePrivateFile(
  pinnedToolchainPolicyPath,
  Buffer.from(`${JSON.stringify(
    createPinnedSafeFsToolchainPolicy(macosCompiler),
    null,
    2,
  )}\n`),
);
const publicationJournalPath = `${options.output}.publication-transaction.json`;
const nodePrefix = path.dirname(path.dirname(nodePath));
if (
  path.basename(path.dirname(nodePath)) !== "bin"
  || path.dirname(nodePrefix) !== outputParent
) {
  fail("caller-pinned Node must be installed under a private runtime/bin directory");
}
const sourceNodePrefix = path.resolve(path.dirname(npmCliPath), "../../../..");
const sourceNodeHeadersRoot = path.join(sourceNodePrefix, "include");
const sourceNodeHeaders = await computeTreeManifest(sourceNodeHeadersRoot);
if (
  sourceNodeHeaders.digest !== EXPECTED_NODE_HEADERS.digest
  || sourceNodeHeaders.entryCount !== EXPECTED_NODE_HEADERS.entryCount
) {
  fail("Node headers differ from the caller-reviewed toolchain");
}
const cd04Capture = await captureRegularFile(options.cd04Anchor, "CD04 anchor");
const cd04Anchor = JSON.parse(cd04Capture.bytes.toString("utf8"));
const { digest: _cd04Digest, ...cd04DigestInput } = cd04Anchor;
if (
  (cd04Capture.metadata.mode & 0o077) !== 0
  || cd04Anchor.digest !== CD04_ANCHOR_DIGEST
  || hashCanonical(cd04DigestInput) !== CD04_ANCHOR_DIGEST
  || cd04Anchor.repositoryRealpath !== repositoryRealpath
) {
  fail("CD04 anchor does not match the caller-reviewed predecessor");
}

const repositoryRunner = await captureRepositoryFile(
  repositoryRealpath,
  "scripts/build-v392-acceptance-anchor.mjs",
);
if (repositoryRunner.digest !== selfCapture.digest) {
  fail("repository acceptance runner differs from the caller-pinned external copy");
}
const recoveredPublication = await recoverPublicationJournal({
  journalPath: publicationJournalPath,
  repositoryRoot: repositoryRealpath,
  outputPath: options.output,
  expectedSourceDigest: options.expectedSourceDigest,
  expectedRunnerDigest: selfCapture.digest,
  validateCommitted: async (anchor) => {
    await validateRecoveredCommittedAcceptance({
      anchor,
      repositoryRoot: repositoryRealpath,
      outputPath: options.output,
      options,
      selfCapture,
      nodeCapture,
      npmCliCapture,
      electronCacheCapture,
    });
  },
});
if (recoveredPublication?.status === "committed") {
  console.log(JSON.stringify({
    externalAnchorPath: options.output,
    externalAnchorDigest: recoveredPublication.anchor.digest,
    runnerDigest: selfCapture.digest,
    nodeDigest: nodeCapture.digest,
    recoveredCommittedPublication: true,
  }, null, 2));
  process.exit(0);
}
await verifyGitIdentity(repositoryRealpath, options);
await verifyCommittedWhitespace(
  repositoryRealpath,
  options.expectedGitHead,
);
await verifyControlSet(repositoryRealpath);
await verifyToolchain(repositoryRealpath);
await verifyNativeNodeAddon(repositoryRealpath);
await verifySourceManifest(repositoryRealpath, options);
const execution = await materializeExecutionSnapshot(
  repositoryRealpath,
  outputParent,
  npmCliPath,
  nodePath,
  sourceNodePrefix,
  electronCachePath,
  electronHeadersArchivePath,
  options,
);
const executionRoot = execution.repository;
const executionNpmCliPath = execution.npmCli;
const nativeCachePath = path.join(executionRoot, GENERATED_NATIVE_CACHE_PATH);
const commandSandboxProfile = path.join(
  outputParent,
  `.v392-command-sandbox-${process.pid}.sb`,
);
const auditSandboxProfile = path.join(
  outputParent,
  `.v392-audit-sandbox-${process.pid}.sb`,
);
const electronSandboxProfile = path.join(
  outputParent,
  `.v392-electron-sandbox-${process.pid}.sb`,
);
const repositoryCheckSandboxProfile = path.join(
  outputParent,
  `.v392-repository-check-sandbox-${process.pid}.sb`,
);
const sandboxReadableRoots = [
  executionRoot,
  execution.home,
  execution.temp,
  execution.nodePrefix,
  "/private/var/select",
  ...SYSTEM_SANDBOX_READ_ROOTS,
];
const sandboxWritableRoots = [
  executionRoot,
  execution.home,
  execution.temp,
];
const { stdout: darwinUserTempOutput } = await execFile(
  "/usr/bin/getconf",
  ["DARWIN_USER_TEMP_DIR"],
  { encoding: "utf8" },
);
const darwinUserTempAlias = path.resolve(darwinUserTempOutput.trim());
const darwinUserTempCanonical = await realpath(darwinUserTempAlias);
const darwinUserTempRoots = [...new Set([
  darwinUserTempAlias,
  darwinUserTempCanonical,
])];
const electronEphemeralPrefixes = darwinUserTempRoots.flatMap((root) => [
  path.join(root, "scoped_dir"),
]);
const electronSocketPrefixes = darwinUserTempRoots.map((root) =>
  path.join(root, "scoped_dir")
);
await writePrivateFile(
  commandSandboxProfile,
  Buffer.from(buildAcceptanceSandboxProfile({
    readableRoots: sandboxReadableRoots,
    readableFiles: [pinnedToolchainPolicyPath],
    metadataRoots: ["/Users"],
    writableRoots: sandboxWritableRoots,
    network: false,
  })),
);
await writePrivateFile(
  auditSandboxProfile,
  Buffer.from(buildAcceptanceSandboxProfile({
    readableRoots: sandboxReadableRoots,
    metadataRoots: ["/Users"],
    writableRoots: sandboxWritableRoots,
    network: true,
  })),
);
await writePrivateFile(
  electronSandboxProfile,
  Buffer.from(buildAcceptanceSandboxProfile({
    readableRoots: sandboxReadableRoots,
    readableFiles: [pinnedToolchainPolicyPath],
    readablePrefixes: electronEphemeralPrefixes,
    metadataRoots: ["/Users"],
    writableRoots: sandboxWritableRoots,
    writablePrefixes: electronEphemeralPrefixes,
    localSocketPrefixes: electronSocketPrefixes,
    network: false,
    allowMach: true,
  })),
);
const writeRepositoryCheckSandbox = async (acceptanceAnchorPath) => {
  await rm(repositoryCheckSandboxProfile, { force: true });
  await writePrivateFile(
    repositoryCheckSandboxProfile,
    Buffer.from(buildAcceptanceSandboxProfile({
      readableRoots: [
        repositoryRealpath,
        execution.home,
        execution.temp,
        execution.nodePrefix,
        sourceNpmRoot,
        sourceNodeHeadersRoot,
        "/private/var/select",
        ...SYSTEM_SANDBOX_READ_ROOTS,
      ],
      metadataRoots: ["/Users"],
      readableFiles: [
        SELF_PATH,
        electronCachePath,
        electronHeadersArchivePath,
        options.cd04Anchor,
        acceptanceAnchorPath,
      ],
      writableRoots: [execution.home, execution.temp],
      network: false,
    })),
  );
};
// The repository-check profile must exist before the first sandboxed
// repository-cwd command runs (codesign --verify right after the FINAL_FILES
// publication), long before the acceptance anchor itself is written. Create it
// eagerly against the final output path; it is rewritten with the temporary
// and published anchor paths at lines guarded by writeRepositoryCheckSandbox
// below.
await writeRepositoryCheckSandbox(options.output);
let executionMutation = null;
let allowedExecutionMutationPrefixes = Object.freeze([]);
let repositoryMutation = null;
let repositoryMutationMode = "none";
const repositoryWatcher = watch(
  repositoryRealpath,
  { recursive: true },
  (_eventType, filename) => {
    const relativePath = normalizeWatchRelativePath(filename);
    if (
      !relativePath
      || (
        repositoryMutationMode === "none"
        || !isAllowedRepositoryMutation(relativePath, repositoryMutationMode)
      )
    ) {
      repositoryMutation ??= relativePath || "<unknown-event>";
    }
  },
);
const executionWatcher = watch(
  executionRoot,
  { recursive: true },
  (_eventType, filename) => {
    const relativePath = normalizeWatchRelativePath(filename);
    if (
      !relativePath
      || !isAllowedExecutionMutation(
        relativePath,
        allowedExecutionMutationPrefixes,
      )
    ) {
      executionMutation ??= relativePath || "<unknown-event>";
    }
  },
);

const trustedEnvironment = {
  HOME: execution.home,
  LANG: process.env.LANG ?? "en_US.UTF-8",
  PATH: [
    path.dirname(nodePath),
    execution.commandBin,
    path.join(executionRoot, "node_modules/.bin"),
    "/Library/Developer/CommandLineTools/usr/bin",
    "/usr/bin",
    "/bin",
  ].join(path.delimiter),
  SHELL: "/bin/sh",
  TMPDIR: execution.temp,
  CC: macosCompiler.clang,
  CXX: macosCompiler.clangXX,
  AR: "/Library/Developer/CommandLineTools/usr/bin/ar",
  RANLIB: "/Library/Developer/CommandLineTools/usr/bin/ranlib",
  LD: "/Library/Developer/CommandLineTools/usr/bin/ld",
  LIBTOOL: "/Library/Developer/CommandLineTools/usr/bin/libtool",
  STRIP: "/Library/Developer/CommandLineTools/usr/bin/strip",
  SDKROOT: macosCompiler.sdkAlias,
  npm_config_nodedir: execution.electronHeaders,
  ZEROX_V392_OUTER_SANDBOX: "1",
  ZEROX_ACCEPTANCE_SECRET_CANARY:
    `zerox-acceptance-secret-${randomUUID()}`,
  ZEROX_NODE_HEADERS_DIR: execution.nodePrefix,
  electron_config_cache: execution.electronCacheRoot,
  ZEROX_LOCAL_CANDIDATE_NPM_CLI: executionNpmCliPath,
  ZEROX_LOCAL_CANDIDATE_NPM_CLI_DIGEST: npmCliCapture.digest,
  ZEROX_LOCAL_CANDIDATE_NODE_DIGEST: nodeCapture.digest,
  ZEROX_LOCAL_CANDIDATE_TOOLCHAIN_DIGEST: EXPECTED_TOOLCHAIN.digest,
  ZEROX_LOCAL_CANDIDATE_TOOLCHAIN_ENTRY_COUNT:
    String(EXPECTED_TOOLCHAIN.entryCount),
};
await verifyHostToolchainIsolation({
  profiles: [
    { label: "command", path: commandSandboxProfile },
    { label: "electron", path: electronSandboxProfile },
  ],
  nodePath,
  cwd: executionRoot,
  environment: trustedEnvironment,
  cacheRoot: darwinUserTempCanonical,
  compiler: macosCompiler,
  policyPath: pinnedToolchainPolicyPath,
});
await run(
  nodePath,
  [executionNpmCliPath, "run", "verify"],
  executionRoot,
  trustedEnvironment,
);
await runTrustedSeatbeltRegressionLane(outputParent);
await run(nodePath, [executionNpmCliPath, "run", "smoke:prod"], executionRoot, trustedEnvironment);
await run(nodePath, [executionNpmCliPath, "audit", "--omit=dev"], executionRoot, trustedEnvironment);
await run(nodePath, [executionNpmCliPath, "ls", "--all"], executionRoot, trustedEnvironment);
await verifyWhitespace(executionRoot, trustedEnvironment);
await run(
  nodePath,
  ["scripts/run-conversation-disclosure-acceptance.mjs"],
  executionRoot,
  trustedEnvironment,
);
await run(
  nodePath,
  ["scripts/package-local-candidate.mjs"],
  executionRoot,
  trustedEnvironment,
);
await run(
  nodePath,
  ["scripts/probe-native-sqlite.mjs", "--expect-runtime=node"],
  executionRoot,
  trustedEnvironment,
);
allowedExecutionMutationPrefixes = LIFECYCLE_PUBLICATION_FILES;
try {
  await completeExecutionLifecycle(executionRoot);
  await settleMutationWatchers();
} finally {
  allowedExecutionMutationPrefixes = Object.freeze([]);
}
if (executionMutation) {
  fail(`private execution source mutated during lifecycle closure: ${executionMutation}`);
}
const appPath = path.join(
  executionRoot,
  "release-local/mac-arm64/Zerox Agent.app",
);
await run(
  "/usr/bin/codesign",
  ["--verify", "--deep", "--strict", appPath],
  executionRoot,
  trustedEnvironment,
);
await verifyPackagedLaunch(appPath, execution.temp, trustedEnvironment);
await scanPathsForEnvironmentSecrets([
  appPath,
  ...FINAL_FILES.map((relativePath) => path.join(executionRoot, relativePath)),
], trustedEnvironment);
await verifyPinnedMacosSdkManifest(macosCompiler);
await assertExecutionQuiescent("before publication");
let publication;
let completedAnchor;
let temporaryOutput;
let published = false;
let publicationCommitted = false;
let outputParentHandle;
try {
  repositoryMutationMode = "publish";
  publication = await publishGeneratedOutputs(
    executionRoot,
    repositoryRealpath,
    publicationJournalPath,
    options.output,
    options.expectedSourceDigest,
    selfCapture.digest,
  );
  const publishedAppPath = path.join(
    repositoryRealpath,
    "release-local/mac-arm64/Zerox Agent.app",
  );
  await run(
    "/usr/bin/codesign",
    ["--verify", "--deep", "--strict", publishedAppPath],
    repositoryRealpath,
    trustedEnvironment,
  );
  await scanPathsForEnvironmentSecrets([
    publishedAppPath,
    ...FINAL_FILES.map((relativePath) =>
      path.join(repositoryRealpath, relativePath)),
  ], trustedEnvironment);

  await verifyControlSet(repositoryRealpath);
  await verifyExternalExecutionIdentityPostflight();
  await verifySourceManifest(repositoryRealpath, options);
  await verifyGitIdentity(repositoryRealpath, options);
  const fileDigests = {};
  for (const relativePath of FINAL_FILES) {
    fileDigests[relativePath] = (
      await captureRepositoryFile(repositoryRealpath, relativePath)
    ).digest;
  }
  const packageReceipt = JSON.parse((
    await captureRepositoryFile(
      repositoryRealpath,
      ".zerox/verification/conversation-disclosure/CD09-local-package.json",
    )
  ).bytes.toString("utf8"));
  const packagedSafeFsHelperDigest = packageReceipt.safeFsHelper?.sha256;
  if (
    !/^sha256:[0-9a-f]{64}$/.test(packagedSafeFsHelperDigest ?? "")
    || packagedSafeFsHelperDigest === EXPECTED_UNSIGNED_SAFE_FS_HELPER_DIGEST
  ) {
    fail("packaged safe-fs helper identity does not bind signed bytes");
  }
  const anchor = {
    schemaVersion: 1,
    kind: "v3.9.2-local-acceptance-external-anchor",
    status: "accepted",
    identityAssurance: "caller-held-not-signed",
    repositoryRealpath,
    gitHead: options.expectedGitHead,
    gitTree: options.expectedGitTree,
    version: "3.9.2",
    cd04AnchorDigest: CD04_ANCHOR_DIGEST,
    runnerDigest: selfCapture.digest,
    nodeDigest: nodeCapture.digest,
    npmCliDigest: npmCliCapture.digest,
    npmTreeDigest: EXPECTED_NPM_TREE.digest,
    npmTreeEntryCount: EXPECTED_NPM_TREE.entryCount,
    toolchainDigest: EXPECTED_TOOLCHAIN.digest,
    toolchainEntryCount: EXPECTED_TOOLCHAIN.entryCount,
    nativeNodeAddonDigest: EXPECTED_NATIVE_NODE_ADDON_DIGEST,
    nodeHeadersDigest: EXPECTED_NODE_HEADERS.digest,
    nodeHeadersEntryCount: EXPECTED_NODE_HEADERS.entryCount,
    electronCacheDigest: EXPECTED_ELECTRON_CACHE.digest,
    electronHeadersArchiveDigest: EXPECTED_ELECTRON_HEADERS_ARCHIVE_DIGEST,
    electronHeadersDigest: EXPECTED_ELECTRON_HEADERS.digest,
    electronHeadersEntryCount: EXPECTED_ELECTRON_HEADERS.entryCount,
    reviewPins: {
      code: {
        reviewerAgentId: options.expectedCodeReviewAgentId,
        challenge: options.expectedCodeReviewChallenge,
        receiptDigest: options.expectedCodeReviewReceiptDigest,
      },
      security: {
        reviewerAgentId: options.expectedSecurityReviewAgentId,
        challenge: options.expectedSecurityReviewChallenge,
        receiptDigest: options.expectedSecurityReviewReceiptDigest,
      },
    },
    sourceDigest: options.expectedSourceDigest,
    sourceFileCount: options.expectedSourceFileCount,
    unsignedSafeFsHelperDigest: EXPECTED_UNSIGNED_SAFE_FS_HELPER_DIGEST,
    packagedSafeFsHelperDigest,
    controlDigests: CONTROL_DIGESTS,
    verification: {
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
    },
    fileDigests,
  };
  completedAnchor = {
    ...anchor,
    digest: hashCanonical(anchor),
  };
  temporaryOutput =
    `${options.output}.partial-${publication.journal.transactionId}`;
  await rm(temporaryOutput, { force: true });
  const handle = await open(temporaryOutput, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(completedAnchor, null, 2)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }

  const anchorEnvironment = {
    HOME: trustedEnvironment.HOME,
    LANG: trustedEnvironment.LANG,
    PATH: trustedEnvironment.PATH,
    SHELL: trustedEnvironment.SHELL,
    TMPDIR: trustedEnvironment.TMPDIR,
    ZEROX_CD04_DELTA_ANCHOR: options.cd04Anchor,
    ZEROX_CD04_DELTA_ANCHOR_DIGEST: CD04_ANCHOR_DIGEST,
    ZEROX_V392_ACCEPTANCE_ANCHOR: temporaryOutput,
    ZEROX_V392_ACCEPTANCE_ANCHOR_DIGEST: completedAnchor.digest,
    ZEROX_V392_ACCEPTANCE_RUNNER: SELF_PATH,
    ZEROX_V392_ACCEPTANCE_RUNNER_DIGEST: selfCapture.digest,
    ZEROX_V392_ACCEPTANCE_NODE_DIGEST: nodeCapture.digest,
    ZEROX_V392_ACCEPTANCE_NPM_CLI: npmCliPath,
    ZEROX_V392_ACCEPTANCE_NPM_CLI_DIGEST: npmCliCapture.digest,
    ZEROX_V392_ELECTRON_CACHE_ARCHIVE: electronCachePath,
    ZEROX_V392_ELECTRON_CACHE_DIGEST: electronCacheCapture.digest,
    ZEROX_V392_ELECTRON_HEADERS_ARCHIVE: electronHeadersArchivePath,
    ZEROX_V392_ELECTRON_HEADERS_DIGEST:
      electronHeadersArchiveCapture.digest,
    ZEROX_V392_CODE_REVIEW_AGENT_ID: options.expectedCodeReviewAgentId,
    ZEROX_V392_CODE_REVIEW_CHALLENGE: options.expectedCodeReviewChallenge,
    ZEROX_V392_CODE_REVIEW_RECEIPT_DIGEST:
      options.expectedCodeReviewReceiptDigest,
    ZEROX_V392_SECURITY_REVIEW_AGENT_ID: options.expectedSecurityReviewAgentId,
    ZEROX_V392_SECURITY_REVIEW_CHALLENGE:
      options.expectedSecurityReviewChallenge,
    ZEROX_V392_SECURITY_REVIEW_RECEIPT_DIGEST:
      options.expectedSecurityReviewReceiptDigest,
    ZEROX_V392_ACCEPTANCE_GIT_HEAD: options.expectedGitHead,
    ZEROX_V392_ACCEPTANCE_GIT_TREE: options.expectedGitTree,
  };
  outputParentHandle = await open(outputParent, "r");
  const outputParentIdentity = await outputParentHandle.stat();
  await writeRepositoryCheckSandbox(temporaryOutput);
  await run(
    nodePath,
    ["scripts/check-conversation-disclosure-successor-program.mjs"],
    repositoryRealpath,
    anchorEnvironment,
  );
  await run(
    nodePath,
    ["scripts/check-harness-state.mjs"],
    repositoryRealpath,
    anchorEnvironment,
  );
  await link(temporaryOutput, options.output);
  published = true;
  await rm(temporaryOutput);
  await outputParentHandle.sync();
  const [publishedCapture, outputParentAfter] = await Promise.all([
    captureRegularFile(options.output, "published acceptance anchor"),
    lstat(outputParent),
  ]);
  if (
    publishedCapture.digest !== sha256(completedAnchorBytes(completedAnchor))
    || outputParentAfter.dev !== outputParentIdentity.dev
    || outputParentAfter.ino !== outputParentIdentity.ino
    || await realpath(outputParent) !== outputParent
  ) {
    fail("published acceptance anchor failed final path identity validation");
  }
  const publishedEnvironment = {
    ...anchorEnvironment,
    ZEROX_V392_ACCEPTANCE_ANCHOR: options.output,
  };
  await writeRepositoryCheckSandbox(options.output);
  await run(
    nodePath,
    ["scripts/check-conversation-disclosure-successor-program.mjs"],
    repositoryRealpath,
    publishedEnvironment,
  );
  await run(
    nodePath,
    ["scripts/check-harness-state.mjs"],
    repositoryRealpath,
    publishedEnvironment,
  );
  // Drain pending publish-mode watch events BEFORE flipping to "none": the
  // watcher callback evaluates the mode at delivery time, so without this
  // pre-flip settle a late-delivered legitimate publish write would be
  // misjudged under the strict "none" mode.
  await settleMutationWatchers();
  repositoryMutationMode = "none";
  await settleMutationWatchers();
  await verifyCanonicalRepositoryPostflight();
  await markPublicationCommitted(publication, completedAnchor.digest);
  publicationCommitted = true;
  await verifyCanonicalRepositoryPostflight();
  repositoryMutationMode = "cleanup";
  await finalizePublication(publication);
  await settleMutationWatchers();
  repositoryMutationMode = "none";
  await settleMutationWatchers();
  await verifyCanonicalRepositoryPostflight();
} catch (error) {
  // Always surface the primary failure before attempting rollback: a
  // rollback crash must never swallow the original error (B5 masking).
  console.error(
    `acceptance anchor publication failed: ${error?.stack ?? error}`,
  );
  if (temporaryOutput) await rm(temporaryOutput, { force: true });
  const durableCommitted = publication && (
    publicationCommitted
    || await publicationJournalIsCommitted(publication)
  );
  if (!durableCommitted) {
    if (published) await rm(options.output, { force: true });
    if (publication) {
      try {
        await rollbackPublication(publication);
      } catch (rollbackError) {
        console.error(
          `acceptance publication rollback also failed: ${rollbackError?.stack ?? rollbackError}`,
        );
        throw new Error(
          `acceptance anchor run failed (primary: ${error?.message ?? error}); `
            + `rollback also failed: ${rollbackError?.message ?? rollbackError}`,
          { cause: error },
        );
      }
    }
  }
  throw error;
} finally {
  await outputParentHandle?.close();
}
executionWatcher.close();
await Promise.all([
  rm(executionRoot, { recursive: true, force: true }),
  rm(execution.home, { recursive: true, force: true }),
  rm(execution.temp, { recursive: true, force: true }),
  rm(execution.npmRoot, { recursive: true, force: true }),
  rm(execution.nodeHeaders, { recursive: true, force: true }),
  rm(execution.electronHeaders, { recursive: true, force: true }),
  rm(execution.npmShim, { force: true }),
  rm(commandSandboxProfile, { force: true }),
  rm(auditSandboxProfile, { force: true }),
  rm(electronSandboxProfile, { force: true }),
  rm(repositoryCheckSandboxProfile, { force: true }),
  rm(pinnedToolchainPolicyPath, { force: true }),
]);
await settleMutationWatchers();
await verifyCanonicalRepositoryPostflight();
repositoryWatcher.close();
console.log(JSON.stringify({
  externalAnchorPath: options.output,
  externalAnchorDigest: completedAnchor.digest,
  runnerDigest: selfCapture.digest,
  nodeDigest: nodeCapture.digest,
}, null, 2));

async function verifyControlSet(repositoryRoot) {
  for (const [relativePath, expectedDigest] of Object.entries(CONTROL_DIGESTS)) {
    assertDigest(expectedDigest, `control digest for ${relativePath}`);
    const capture = await captureRepositoryFile(repositoryRoot, relativePath);
    if (capture.digest !== expectedDigest) {
      fail(`caller-reviewed control drift: ${relativePath}`);
    }
  }
}

async function verifyExternalExecutionIdentityPostflight() {
  const [
    currentRunner,
    repositoryRunner,
    currentNode,
    currentNpmCli,
    currentElectronCache,
    currentElectronHeadersArchive,
    currentNpmTree,
    currentNodeHeaders,
    currentCd04Anchor,
  ] = await Promise.all([
    captureRegularFile(SELF_PATH, "external acceptance runner"),
    captureRepositoryFile(
      repositoryRealpath,
      "scripts/build-v392-acceptance-anchor.mjs",
    ),
    captureRegularFile(nodePath, "Node executable"),
    captureRegularFile(npmCliPath, "npm CLI"),
    captureRegularFile(electronCachePath, "Electron cache archive"),
    captureRegularFile(
      electronHeadersArchivePath,
      "Electron headers archive",
    ),
    computeTreeManifest(path.resolve(path.dirname(npmCliPath), "..")),
    computeTreeManifest(path.join(sourceNodePrefix, "include")),
    captureRegularFile(options.cd04Anchor, "CD04 anchor"),
  ]);
  const currentCd04Value = JSON.parse(
    currentCd04Anchor.bytes.toString("utf8"),
  );
  const {
    digest: _currentCd04Digest,
    ...currentCd04DigestInput
  } = currentCd04Value;
  if (
    currentRunner.digest !== selfCapture.digest
    || repositoryRunner.digest !== selfCapture.digest
    || currentNode.digest !== nodeCapture.digest
    || currentNpmCli.digest !== npmCliCapture.digest
    || currentElectronCache.digest !== electronCacheCapture.digest
    || currentElectronHeadersArchive.digest
      !== electronHeadersArchiveCapture.digest
    || currentNpmTree.digest !== EXPECTED_NPM_TREE.digest
    || currentNpmTree.entryCount !== EXPECTED_NPM_TREE.entryCount
    || currentNodeHeaders.digest !== EXPECTED_NODE_HEADERS.digest
    || currentNodeHeaders.entryCount !== EXPECTED_NODE_HEADERS.entryCount
    || currentCd04Value.digest !== CD04_ANCHOR_DIGEST
    || hashCanonical(currentCd04DigestInput) !== CD04_ANCHOR_DIGEST
    || currentCd04Value.repositoryRealpath !== repositoryRealpath
  ) {
    fail("external execution identity changed during acceptance");
  }
  await verifyToolchain(repositoryRealpath);
  await verifyNativeNodeAddon(repositoryRealpath);
}

async function verifyCanonicalRepositoryPostflight() {
  if (repositoryMutation) {
    fail(`canonical repository mutated outside publication: ${repositoryMutation}`);
  }
  await verifyExternalExecutionIdentityPostflight();
  await verifySourceManifest(repositoryRealpath, options);
  await verifyControlSet(repositoryRealpath);
  await verifyGitIdentity(repositoryRealpath, options);
  if (!completedAnchor) {
    fail("completed acceptance anchor is unavailable at postflight");
  }
  await verifyCompletedOutputs(
    repositoryRealpath,
    completedAnchor,
    options.output,
  );
}

async function assertExecutionQuiescent(label) {
  await settleMutationWatchers();
  if (executionMutation) {
    fail(`private execution source mutated ${label}: ${executionMutation}`);
  }
  await verifyCommandIdentity(nodePath, [], executionRoot);
}

async function verifyCompletedOutputs(
  targetRepositoryRoot,
  anchor,
  outputPath,
) {
  const anchorPaths = Object.keys(anchor.fileDigests ?? {});
  if (
    anchorPaths.length !== FINAL_FILES.length
    || FINAL_FILES.some((relativePath, index) =>
      anchorPaths[index] !== relativePath)
  ) {
    fail("completed acceptance anchor file roster changed");
  }
  for (const relativePath of FINAL_FILES) {
    const capture = await captureRepositoryFile(
      targetRepositoryRoot,
      relativePath,
    );
    if (capture.digest !== anchor.fileDigests[relativePath]) {
      fail(`post-commit final file drift: ${relativePath}`);
    }
  }
  const packageReceiptCapture = await captureRepositoryFile(
    targetRepositoryRoot,
    ".zerox/verification/conversation-disclosure/CD09-local-package.json",
  );
  const packageReceipt = JSON.parse(
    packageReceiptCapture.bytes.toString("utf8"),
  );
  const publishedApp = await computeTreeManifest(path.join(
    targetRepositoryRoot,
    "release-local/mac-arm64/Zerox Agent.app",
  ));
  if (
    packageReceipt.appTreeSha256 !== publishedApp.digest
    || packageReceipt.appTreeEntryCount !== publishedApp.entryCount
  ) {
    fail("post-commit local package tree drifted");
  }
  const safeFsRelativePath =
    "release-local/mac-arm64/Zerox Agent.app/Contents/Resources/safe-fs/zerox-safe-fs";
  const safeFsCapture = await captureRepositoryFile(
    targetRepositoryRoot,
    safeFsRelativePath,
  );
  assertPackagedSafeFsIdentity({
    anchor,
    packageReceipt,
    safeFsCapture,
    safeFsRelativePath,
  });
  const anchorCapture = await captureRegularFile(
    outputPath,
    "post-commit acceptance anchor",
  );
  if (anchorCapture.digest !== sha256(completedAnchorBytes(anchor))) {
    fail("post-commit acceptance anchor drifted");
  }
}

function assertPackagedSafeFsIdentity({
  anchor,
  packageReceipt,
  safeFsCapture,
  safeFsRelativePath,
}) {
  if (
    anchor.unsignedSafeFsHelperDigest
      !== EXPECTED_UNSIGNED_SAFE_FS_HELPER_DIGEST
    || anchor.packagedSafeFsHelperDigest !== safeFsCapture.digest
    || anchor.packagedSafeFsHelperDigest
      === EXPECTED_UNSIGNED_SAFE_FS_HELPER_DIGEST
    || packageReceipt.safeFsHelper?.path !== safeFsRelativePath
    || packageReceipt.safeFsHelper?.bytes !== safeFsCapture.bytes.length
    || packageReceipt.safeFsHelper?.sha256 !== safeFsCapture.digest
    || packageReceipt.safeFsHelper?.mode !== "0755"
    || (safeFsCapture.metadata.mode & 0o777) !== 0o755
    || packageReceipt.safeFsHelper?.signatureVerified !== true
    || packageReceipt.safeFsHelper?.hardenedRuntime !== true
    || packageReceipt.safeFsHelper?.entitlements !== "empty"
  ) {
    fail("post-commit safe-fs helper receipt drifted");
  }
}

function verifySafeFsPackageIdentitySelfTest() {
  const safeFsRelativePath =
    "release-local/mac-arm64/Zerox Agent.app/Contents/Resources/safe-fs/zerox-safe-fs";
  const bytes = Buffer.from("signed-safe-fs-helper");
  const signedDigest = sha256(bytes);
  const anchor = {
    unsignedSafeFsHelperDigest: EXPECTED_UNSIGNED_SAFE_FS_HELPER_DIGEST,
    packagedSafeFsHelperDigest: signedDigest,
  };
  const packageReceipt = {
    safeFsHelper: {
      path: safeFsRelativePath,
      bytes: bytes.length,
      sha256: signedDigest,
      mode: "0755",
      signatureVerified: true,
      hardenedRuntime: true,
      entitlements: "empty",
    },
  };
  const safeFsCapture = {
    bytes,
    digest: signedDigest,
    metadata: { mode: 0o100755 },
  };
  assertPackagedSafeFsIdentity({
    anchor,
    packageReceipt,
    safeFsCapture,
    safeFsRelativePath,
  });

  let unsignedReuseRejected = false;
  try {
    assertPackagedSafeFsIdentity({
      anchor: {
        ...anchor,
        packagedSafeFsHelperDigest: EXPECTED_UNSIGNED_SAFE_FS_HELPER_DIGEST,
      },
      packageReceipt,
      safeFsCapture,
      safeFsRelativePath,
    });
  } catch (error) {
    unsignedReuseRejected =
      error?.message === "post-commit safe-fs helper receipt drifted";
  }
  let receiptDriftRejected = false;
  try {
    assertPackagedSafeFsIdentity({
      anchor,
      packageReceipt: {
        safeFsHelper: { ...packageReceipt.safeFsHelper, sha256: sha256(Buffer.from("drift")) },
      },
      safeFsCapture,
      safeFsRelativePath,
    });
  } catch (error) {
    receiptDriftRejected =
      error?.message === "post-commit safe-fs helper receipt drifted";
  }
  if (!unsignedReuseRejected || !receiptDriftRejected) {
    fail("safe-fs package identity self-test did not fail closed");
  }
  console.log(JSON.stringify({
    safeFsPackageIdentitySelfTest: "passed",
    unsignedReuseRejected,
    receiptDriftRejected,
  }));
}

async function validateRecoveredCommittedAcceptance({
  anchor,
  repositoryRoot,
  outputPath,
  options: expected,
  selfCapture: runner,
  nodeCapture: node,
  npmCliCapture: npmCli,
  electronCacheCapture: electronCache,
}) {
  const reviewPins = {
    code: {
      reviewerAgentId: expected.expectedCodeReviewAgentId,
      challenge: expected.expectedCodeReviewChallenge,
      receiptDigest: expected.expectedCodeReviewReceiptDigest,
    },
    security: {
      reviewerAgentId: expected.expectedSecurityReviewAgentId,
      challenge: expected.expectedSecurityReviewChallenge,
      receiptDigest: expected.expectedSecurityReviewReceiptDigest,
    },
  };
  const verification = {
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
  if (
    anchor?.schemaVersion !== 1
    || anchor?.kind !== "v3.9.2-local-acceptance-external-anchor"
    || anchor.status !== "accepted"
    || anchor.identityAssurance !== "caller-held-not-signed"
    || anchor.repositoryRealpath !== repositoryRoot
    || anchor.version !== "3.9.2"
    || anchor.cd04AnchorDigest !== CD04_ANCHOR_DIGEST
    || anchor.runnerDigest !== runner.digest
    || anchor.nodeDigest !== node.digest
    || anchor.npmCliDigest !== npmCli.digest
    || anchor.npmTreeDigest !== EXPECTED_NPM_TREE.digest
    || anchor.npmTreeEntryCount !== EXPECTED_NPM_TREE.entryCount
    || anchor.toolchainDigest !== EXPECTED_TOOLCHAIN.digest
    || anchor.toolchainEntryCount !== EXPECTED_TOOLCHAIN.entryCount
    || anchor.nativeNodeAddonDigest !== EXPECTED_NATIVE_NODE_ADDON_DIGEST
    || anchor.nodeHeadersDigest !== EXPECTED_NODE_HEADERS.digest
    || anchor.nodeHeadersEntryCount !== EXPECTED_NODE_HEADERS.entryCount
    || anchor.electronCacheDigest !== electronCache.digest
    || anchor.electronHeadersArchiveDigest
      !== EXPECTED_ELECTRON_HEADERS_ARCHIVE_DIGEST
    || anchor.electronHeadersDigest !== EXPECTED_ELECTRON_HEADERS.digest
    || anchor.electronHeadersEntryCount !== EXPECTED_ELECTRON_HEADERS.entryCount
    || anchor.sourceDigest !== expected.expectedSourceDigest
    || anchor.sourceFileCount !== expected.expectedSourceFileCount
    || anchor.unsignedSafeFsHelperDigest
      !== EXPECTED_UNSIGNED_SAFE_FS_HELPER_DIGEST
    || !/^sha256:[0-9a-f]{64}$/.test(
      anchor.packagedSafeFsHelperDigest ?? "",
    )
    || anchor.packagedSafeFsHelperDigest
      === EXPECTED_UNSIGNED_SAFE_FS_HELPER_DIGEST
    || anchor.gitHead !== expected.expectedGitHead
    || anchor.gitTree !== expected.expectedGitTree
    || JSON.stringify(anchor.reviewPins) !== JSON.stringify(reviewPins)
    || JSON.stringify(anchor.controlDigests) !== JSON.stringify(CONTROL_DIGESTS)
    || JSON.stringify(anchor.verification) !== JSON.stringify(verification)
    || anchor.digest !== hashCanonical(withoutDigest(anchor))
  ) {
    fail("recovered committed acceptance anchor does not match caller pins");
  }
  await verifyGitIdentity(repositoryRoot, expected);
  await verifyControlSet(repositoryRoot);
  await verifyExternalExecutionIdentityPostflight();
  await verifySourceManifest(repositoryRoot, expected);
  await verifyCompletedOutputs(repositoryRoot, anchor, outputPath);
}

async function settleMutationWatchers() {
  await new Promise((resolve) => setTimeout(resolve, 100));
}

async function completeExecutionLifecycle(repositoryRoot) {
  const programPath = path.join(
    repositoryRoot,
    ".zerox/conversation-disclosure-program.json",
  );
  const featureListPath = path.join(
    repositoryRoot,
    ".zerox/feature_list.json",
  );
  const [programCapture, featureListCapture] = await Promise.all([
    captureRegularFile(programPath, "active disclosure program"),
    captureRegularFile(featureListPath, "active Feature list"),
  ]);
  const program = JSON.parse(programCapture.bytes.toString("utf8"));
  const featureList = JSON.parse(featureListCapture.bytes.toString("utf8"));
  const cd09 = program.workstreams?.find((entry) => entry.id === "CD09");
  const p113 = featureList.features?.find(
    (entry) => entry.id === "P113-v3.9.2-disclosure-adversarial-acceptance",
  );
  if (
    program.status !== "active"
    || program.activeFeatureId !== p113?.id
    || program.nextFeatureId !== p113?.id
    || cd09?.state !== "in_progress"
    || cd09.featureId !== p113?.id
    || p113?.status !== "in_progress"
  ) {
    fail("v3.9.2 lifecycle is not at the reviewed completion boundary");
  }
  const completedAt = "2026-08-31T23:30:00.000+08:00";
  program.status = "completed";
  program.activeFeatureId = null;
  program.nextFeatureId = null;
  program.updatedAt = completedAt;
  cd09.state = "completed";
  featureList.updatedAt = completedAt;
  p113.status = "done";
  await Promise.all([
    writeExecutionLifecycleFile(
      programPath,
      programCapture.metadata.mode & 0o777,
      program,
    ),
    writeExecutionLifecycleFile(
      featureListPath,
      featureListCapture.metadata.mode & 0o777,
      featureList,
    ),
  ]);
}

async function writeExecutionLifecycleFile(filePath, mode, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  const handle = await open(
    filePath,
    constants.O_WRONLY | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(filePath, mode);
  const capture = await captureRegularFile(filePath, "completed lifecycle file");
  if (capture.digest !== sha256(bytes)) {
    fail("completed lifecycle file failed post-write verification");
  }
}

async function materializeExecutionSnapshot(
  repositoryRoot,
  privateRoot,
  sourceNpmCli,
  privateNode,
  sourceNodePrefix,
  electronCacheArchive,
  electronHeadersArchive,
  expected,
) {
  const executionRoot = await mkdtemp(path.join(privateRoot, "execution-"));
  const home = await mkdtemp(path.join(privateRoot, "home-"));
  const temp = await mkdtemp(path.join(privateRoot, "tmp-"));
  const nodePrefix = path.dirname(path.dirname(privateNode));
  const npmRoot = path.join(nodePrefix, "lib/node_modules/npm");
  const nodeHeaders = path.join(nodePrefix, "include");
  const electronHeaders = path.join(nodePrefix, "electron-headers");
  const electronCacheDirectory = path.join(
    home,
    "Library/Caches/electron",
    EXPECTED_ELECTRON_CACHE.directory,
  );
  const executionPaths = [...new Set([
    ...await listSourcePaths(repositoryRoot),
    ...LIFECYCLE_PUBLICATION_FILES,
  ])].sort();
  for (const relativePath of executionPaths) {
    const source = await captureRepositoryFile(repositoryRoot, relativePath);
    const destination = path.join(executionRoot, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    const handle = await open(destination, "wx", source.metadata.mode & 0o777);
    try {
      await handle.writeFile(source.bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await chmod(destination, source.metadata.mode & 0o777);
  }
  const gitEnvironment = {
    HOME: home,
    LANG: "en_US.UTF-8",
    PATH: "/usr/bin:/bin",
  };
  await execFile("/usr/bin/git", ["init", "-q"], {
    cwd: executionRoot,
    env: gitEnvironment,
  });
  await execFile("/usr/bin/git", ["add", "-f", "--all"], {
    cwd: executionRoot,
    env: gitEnvironment,
  });
  await execFile(
    "/usr/bin/git",
    [
      "-c", "user.name=Zerox Acceptance",
      "-c", "user.email=acceptance@localhost",
      "commit", "-q", "--no-gpg-sign", "-m", "reviewed candidate snapshot",
    ],
    { cwd: executionRoot, env: gitEnvironment },
  );
  await cp(
    path.join(repositoryRoot, "node_modules"),
    path.join(executionRoot, "node_modules"),
    { recursive: true, preserveTimestamps: true, verbatimSymlinks: true },
  );
  const sourceNpmRoot = path.resolve(path.dirname(sourceNpmCli), "..");
  await mkdir(path.dirname(npmRoot), { recursive: true });
  await cp(sourceNpmRoot, npmRoot, {
    recursive: true,
    preserveTimestamps: true,
    verbatimSymlinks: true,
  });
  await cp(path.join(sourceNodePrefix, "include"), nodeHeaders, {
    recursive: true,
    preserveTimestamps: true,
    verbatimSymlinks: true,
  });
  await mkdir(electronHeaders, { recursive: true, mode: 0o700 });
  await execFile(
    "/usr/bin/tar",
    [
      "-xzf",
      electronHeadersArchive,
      "-C",
      electronHeaders,
      "--strip-components=1",
    ],
    {
      cwd: privateRoot,
      env: { PATH: "/usr/bin:/bin" },
    },
  );
  await mkdir(electronCacheDirectory, { recursive: true, mode: 0o700 });
  const stagedElectronCache = path.join(
    electronCacheDirectory,
    EXPECTED_ELECTRON_CACHE.file,
  );
  await cp(electronCacheArchive, stagedElectronCache, {
    errorOnExist: true,
    force: false,
    preserveTimestamps: true,
  });
  const stagedNpmCli = path.join(npmRoot, "bin/npm-cli.js");
  const [
    sourceManifest,
    toolchain,
    nativeAddon,
    npmTree,
    npmCli,
    headers,
    electronHeadersTree,
    electronCache,
  ] =
    await Promise.all([
      computeSourceManifest(executionRoot),
      computeTreeManifest(path.join(executionRoot, "node_modules"), {
        excludeGeneratedNativeBuild: true,
      }),
      captureRepositoryFile(
        executionRoot,
        "node_modules/better-sqlite3/build/Release/better_sqlite3.node",
      ),
      computeTreeManifest(npmRoot),
      captureRegularFile(stagedNpmCli, "staged npm CLI"),
      computeTreeManifest(nodeHeaders),
      computeTreeManifest(electronHeaders),
      captureRegularFile(stagedElectronCache, "staged Electron cache archive"),
    ]);
  if (
    sourceManifest.digest !== expected.expectedSourceDigest
    || sourceManifest.fileCount !== expected.expectedSourceFileCount
    || toolchain.digest !== EXPECTED_TOOLCHAIN.digest
    || toolchain.entryCount !== EXPECTED_TOOLCHAIN.entryCount
    || nativeAddon.digest !== EXPECTED_NATIVE_NODE_ADDON_DIGEST
    || npmTree.digest !== EXPECTED_NPM_TREE.digest
    || npmTree.entryCount !== EXPECTED_NPM_TREE.entryCount
    || npmCli.digest !== EXPECTED_NPM_CLI_DIGEST
    || headers.digest !== EXPECTED_NODE_HEADERS.digest
    || headers.entryCount !== EXPECTED_NODE_HEADERS.entryCount
    || electronHeadersTree.digest !== EXPECTED_ELECTRON_HEADERS.digest
    || electronHeadersTree.entryCount !== EXPECTED_ELECTRON_HEADERS.entryCount
    || electronCache.digest !== EXPECTED_ELECTRON_CACHE.digest
  ) {
    fail("private execution snapshot differs from caller-reviewed inputs");
  }
  const commandBin = path.dirname(privateNode);
  const npmShimPath = path.join(commandBin, "npm");
  const npmShim = await open(npmShimPath, "wx", 0o500);
  try {
    await npmShim.writeFile(
      "#!/bin/sh\n"
      + `exec ${shellWord(privateNode)} ${shellWord(stagedNpmCli)} "$@"\n`,
    );
    await npmShim.sync();
  } finally {
    await npmShim.close();
  }
  return {
    repository: executionRoot,
    npmCli: stagedNpmCli,
    npmRoot,
    home,
    temp,
    commandBin,
    nodePrefix,
    nodeHeaders,
    electronHeaders,
    npmShim: npmShimPath,
    electronCacheRoot: path.join(home, "Library/Caches/electron"),
  };
}

async function publishGeneratedOutputs(
  executionRoot,
  repositoryRoot,
  journalPath,
  outputPath,
  sourceDigest,
  runnerDigest,
) {
  const transactionId = randomUUID();
  const stagedRelease = path.join(
    repositoryRoot,
    `release-test-v392-publish-${transactionId}`,
  );
  const publishedRelease = path.join(repositoryRoot, "release-local");
  const rollbackRelease = path.join(
    repositoryRoot,
    `release-test-v392-rollback-${transactionId}`,
  );
  const backupRoot = `${journalPath}.backup-${transactionId}`;
  const transaction = {
    repositoryRoot,
    journalPath,
    outputPath,
    backupRoot,
    generatedFiles: [],
    stagedRelease,
    publishedRelease,
    rollbackRelease,
    releaseWasPresent: false,
    releasePublished: false,
    journal: null,
  };
  try {
    if (await optionalLstat(outputPath)) {
      fail("acceptance anchor output must be absent before publication");
    }
    await mkdir(backupRoot, { mode: 0o700 });
    for (
      let index = 0;
      index < GENERATED_PUBLICATION_FILES.length;
      index += 1
    ) {
      const relativePath = GENERATED_PUBLICATION_FILES[index];
      const destination = path.join(repositoryRoot, relativePath);
      const next = await captureRepositoryFile(executionRoot, relativePath);
      const previous = await captureOptionalRegularFile(
        destination,
        `existing generated output ${relativePath}`,
      );
      const backupName = previous ? `${index}.bin` : null;
      if (previous) {
        await writePrivateFile(
          path.join(backupRoot, backupName),
          previous.bytes,
        );
      }
      transaction.generatedFiles.push({
        relativePath,
        destination,
        next,
        previous,
        backupName,
      });
    }
    await syncDirectory(backupRoot);
    const sourceTree = await computeTreeManifest(path.join(
      executionRoot,
      "release-local/mac-arm64/Zerox Agent.app",
    ));
    // Journal unit contract: previousRelease and nextRelease must both
    // describe the WHOLE release-local directory (the rollback granularity),
    // not the nested .app subtree. sourceTree stays scoped to the .app
    // payload for the staged/published payload equality checks below.
    const nextReleaseTree = await computeTreeManifest(path.join(
      executionRoot,
      "release-local",
    ));
    await assertExecutionQuiescent("after publication capture");
    const publishedMetadata = await optionalLstat(publishedRelease);
    let previousRelease = null;
    if (publishedMetadata) {
      if (
        publishedMetadata.isSymbolicLink()
        || !publishedMetadata.isDirectory()
      ) {
        fail("existing release-local must be a real directory");
      }
      previousRelease = await computeTreeManifest(publishedRelease);
    }
    transaction.journal = await writePublicationJournal(journalPath, {
      schemaVersion: 1,
      kind: "v3.9.2-publication-transaction",
      status: "prepared",
      repositoryRealpath: repositoryRoot,
      outputPath,
      sourceDigest,
      runnerDigest,
      transactionId,
      anchorDigest: null,
      generatedFiles: transaction.generatedFiles.map((entry) => ({
        relativePath: entry.relativePath,
        previousDigest: entry.previous?.digest ?? null,
        previousMode: entry.previous
          ? entry.previous.metadata.mode & 0o777
          : null,
        backupName: entry.backupName,
        nextDigest: entry.next.digest,
      })),
      previousRelease,
      nextRelease: nextReleaseTree,
    });
    await cp(path.join(executionRoot, "release-local"), stagedRelease, {
      recursive: true,
      preserveTimestamps: true,
      verbatimSymlinks: true,
      errorOnExist: true,
      force: false,
    });
    const stagedTree = await computeTreeManifest(path.join(
      stagedRelease,
      "mac-arm64/Zerox Agent.app",
    ));
    if (
      sourceTree.digest !== stagedTree.digest
      || sourceTree.entryCount !== stagedTree.entryCount
    ) {
      fail("staged local package differs from the private execution result");
    }
    for (const entry of transaction.generatedFiles) {
      await replaceFileAtomically(
        entry.next.bytes,
        entry.next.metadata.mode & 0o777,
        entry.destination,
        repositoryRoot,
      );
    }
    if (publishedMetadata) {
      await rename(publishedRelease, rollbackRelease);
      transaction.releaseWasPresent = true;
      await syncDirectory(repositoryRoot);
    }
    await rename(stagedRelease, publishedRelease);
    transaction.releasePublished = true;
    await syncDirectory(repositoryRoot);
    const publishedTree = await computeTreeManifest(path.join(
      publishedRelease,
      "mac-arm64/Zerox Agent.app",
    ));
    if (
      sourceTree.digest !== publishedTree.digest
      || sourceTree.entryCount !== publishedTree.entryCount
    ) {
      fail("published local package differs from the private execution result");
    }
    // Whole-directory check against the journal's nextRelease so any unit
    // drift fails at publish time instead of surfacing as a rollback-time
    // "third state" (B7 regression guard).
    const publishedWholeTree = await computeTreeManifest(publishedRelease);
    if (
      publishedWholeTree.digest !== nextReleaseTree.digest
      || publishedWholeTree.entryCount !== nextReleaseTree.entryCount
    ) {
      fail("published release-local tree differs from the publication journal");
    }
    return transaction;
  } catch (error) {
    const journalMayBePublished =
      Boolean(transaction.journal) || Boolean(await optionalLstat(journalPath));
    if (journalMayBePublished) {
      await rollbackPublication(transaction);
    } else {
      await Promise.all([
        rm(stagedRelease, { recursive: true, force: true }),
        rm(backupRoot, { recursive: true, force: true }),
      ]);
    }
    throw error;
  }
}

async function runPublicationJournalSelfTest() {
  const testRoot = await realpath(await mkdtemp(
    path.join(process.env.TMPDIR ?? "/private/tmp", "zerox-v392-journal-"),
  ));
  const repositoryRoot = path.join(testRoot, "repository");
  const privateRoot = path.join(testRoot, "private");
  const outputPath = path.join(privateRoot, "anchor.json");
  const journalPath = `${outputPath}.publication-transaction.json`;
  const sourceDigest = sha256(Buffer.from("self-test-source"));
  const runnerDigest = sha256(Buffer.from("self-test-runner"));
  try {
    await Promise.all([
      mkdir(repositoryRoot, { recursive: true, mode: 0o700 }),
      mkdir(privateRoot, { recursive: true, mode: 0o700 }),
    ]);
    const previousFiles = [];
    const nextFiles = [];
    for (
      let index = 0;
      index < GENERATED_PUBLICATION_FILES.length;
      index += 1
    ) {
      const relativePath = GENERATED_PUBLICATION_FILES[index];
      const destination = path.join(repositoryRoot, relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      const previousBytes = Buffer.from(`previous-${index}`);
      const nextBytes = Buffer.from(`next-${index}`);
      await writePrivateFile(destination, previousBytes);
      previousFiles.push({ relativePath, bytes: previousBytes });
      nextFiles.push({ relativePath, bytes: nextBytes });
    }
    const publishedRelease = path.join(repositoryRoot, "release-local");
    await writeSelfTestRelease(publishedRelease, "previous-release");
    let renameFaultObserved = false;
    try {
      await exercisePublicationRecoveryState({
        repositoryRoot,
        privateRoot,
        outputPath,
        journalPath,
        sourceDigest,
        runnerDigest,
        previousFiles,
        nextFiles,
        committed: false,
        afterJournalRename: () => {
          throw new Error("injected journal rename-before-fsync fault");
        },
      });
    } catch (error) {
      renameFaultObserved =
        error?.message === "injected journal rename-before-fsync fault";
    }
    if (!renameFaultObserved || !await optionalLstat(journalPath)) {
      fail("journal rename-before-fsync fault was not reproduced");
    }
    const renameFaultRecovery = await recoverPublicationJournal({
      journalPath,
      repositoryRoot,
      outputPath,
    });
    if (renameFaultRecovery?.status !== "rolled_back") {
      fail("journal rename-before-fsync fault did not recover");
    }
    const preparedRecovery = await exercisePublicationRecoveryState({
      repositoryRoot,
      privateRoot,
      outputPath,
      journalPath,
      sourceDigest,
      runnerDigest,
      previousFiles,
      nextFiles,
      committed: false,
    });
    if (preparedRecovery?.status !== "rolled_back") {
      fail("prepared journal did not report rollback");
    }
    for (const entry of previousFiles) {
      const capture = await captureRepositoryFile(
        repositoryRoot,
        entry.relativePath,
      );
      if (!capture.bytes.equals(entry.bytes)) {
        fail("prepared journal did not restore generated output");
      }
    }
    if (await optionalLstat(outputPath)) {
      fail("prepared journal did not remove uncommitted anchor");
    }
    const anchorLinkRecovery = await exercisePublicationRecoveryState({
      repositoryRoot,
      privateRoot,
      outputPath,
      journalPath,
      sourceDigest,
      runnerDigest,
      previousFiles,
      nextFiles,
      committed: false,
      leavePublishedAnchorHardlink: true,
    });
    if (anchorLinkRecovery?.status !== "rolled_back") {
      fail("acceptance anchor publication hardlink crash did not recover");
    }
    if (
      await optionalLstat(outputPath)
      || await optionalLstat(anchorLinkRecovery.anchorTemporaryPath)
    ) {
      fail("acceptance anchor publication hardlink recovery left links");
    }
    const rolledBackTransactionId = randomUUID();
    await writePublicationJournal(journalPath, {
      schemaVersion: 1,
      kind: "v3.9.2-publication-transaction",
      status: "rolled_back",
      repositoryRealpath: repositoryRoot,
      outputPath,
      sourceDigest,
      runnerDigest,
      transactionId: rolledBackTransactionId,
      anchorDigest: null,
      generatedFiles: await Promise.all(previousFiles.map(
        async (entry, index) => {
          const capture = await captureRepositoryFile(
            repositoryRoot,
            entry.relativePath,
          );
          return {
            relativePath: entry.relativePath,
            previousDigest: capture.digest,
            previousMode: capture.metadata.mode & 0o777,
            backupName: `${index}.bin`,
            nextDigest: sha256(nextFiles[index].bytes),
          };
        },
      )),
      previousRelease: await computeTreeManifest(publishedRelease),
      nextRelease: await computeTreeManifest(publishedRelease),
    });
    const rolledBackRecovery = await recoverPublicationJournal({
      journalPath,
      repositoryRoot,
      outputPath,
    });
    if (rolledBackRecovery?.status !== "rolled_back") {
      fail("rolled-back journal cleanup did not converge without backups");
    }
    const committedRecovery = await exercisePublicationRecoveryState({
      repositoryRoot,
      privateRoot,
      outputPath,
      journalPath,
      sourceDigest,
      runnerDigest,
      previousFiles,
      nextFiles,
      committed: true,
    });
    if (committedRecovery?.status !== "committed") {
      fail("committed journal did not return the accepted result");
    }
    const completedReplay = await recoverPublicationJournal({
      journalPath,
      repositoryRoot,
      outputPath,
      validateCommitted: async (anchor) => {
        if (
          anchor.sourceDigest !== sourceDigest
          || anchor.runnerDigest !== runnerDigest
        ) {
          fail("journal-free committed replay changed anchor identity");
        }
      },
    });
    if (completedReplay?.status !== "committed") {
      fail("journal-free committed replay did not return the accepted result");
    }
    for (const entry of nextFiles) {
      const capture = await captureRepositoryFile(
        repositoryRoot,
        entry.relativePath,
      );
      if (!capture.bytes.equals(entry.bytes)) {
        fail("committed journal did not preserve generated output");
      }
    }
    if (
      !await optionalLstat(outputPath)
      || await optionalLstat(journalPath)
    ) {
      fail("committed journal cleanup is incomplete");
    }
    await verifyRepositoryCheckSandboxSelfTest(testRoot);
    await runTrustedSeatbeltRegressionLane(testRoot);
    let commandOutputLeakRejected = false;
    try {
      assertCommandOutputDoesNotExposeEnvironmentSecrets(
        "self-test-secret-value",
        "",
        { ZEROX_SELF_TEST_API_KEY: "self-test-secret-value" },
      );
    } catch (error) {
      commandOutputLeakRejected =
        error?.message
          === "candidate command output exposed an environment credential";
    }
    if (!commandOutputLeakRejected) {
      fail("candidate command output secret leak was not rejected");
    }
    verifyCommandFailurePreservationSelfTest();
    await verifyOwnedCommandDrainSelfTest(testRoot);
    console.log(JSON.stringify({
      publicationJournalSelfTest: "passed",
      generatedFileCount: GENERATED_PUBLICATION_FILES.length,
    }, null, 2));
  } finally {
    await rm(testRoot, { recursive: true, force: true });
  }
}

async function verifyRepositoryCheckSandboxSelfTest(testRoot) {
  if (process.platform !== "darwin") return;
  const readableRepository = path.join(testRoot, "sandbox-repository");
  const readableNpmTree = path.join(testRoot, "sandbox-npm");
  const readableHeaders = path.join(testRoot, "sandbox-headers");
  const writableRoot = path.join(testRoot, "sandbox-writable");
  const externalRoot = path.join(testRoot, "sandbox-external");
  const profilePath = path.join(testRoot, "repository-check.sb");
  const readablePaths = [
    path.join(readableRepository, "repository.txt"),
    path.join(readableNpmTree, "npm.txt"),
    path.join(readableHeaders, "header.txt"),
    path.join(externalRoot, "runner.mjs"),
    path.join(externalRoot, "electron-cache.zip"),
    path.join(externalRoot, "cd04-anchor.json"),
    path.join(externalRoot, "acceptance-anchor.json"),
  ];
  const forbiddenPath = path.join(externalRoot, "unrelated-secret.txt");
  await Promise.all([
    mkdir(readableRepository, { recursive: true, mode: 0o700 }),
    mkdir(readableNpmTree, { recursive: true, mode: 0o700 }),
    mkdir(readableHeaders, { recursive: true, mode: 0o700 }),
    mkdir(writableRoot, { recursive: true, mode: 0o700 }),
    mkdir(externalRoot, { recursive: true, mode: 0o700 }),
  ]);
  await Promise.all([
    ...readablePaths.map((filePath) =>
      writePrivateFile(filePath, Buffer.from(path.basename(filePath)))
    ),
    writePrivateFile(forbiddenPath, Buffer.from("forbidden")),
  ]);
  await writePrivateFile(
    profilePath,
    Buffer.from(buildAcceptanceSandboxProfile({
      readableRoots: [
        readableRepository,
        readableNpmTree,
        readableHeaders,
        "/private/var/select",
      ],
      readableFiles: readablePaths.slice(3),
      writableRoots: [writableRoot],
      network: false,
    })),
  );
  await execFile(
    "/usr/bin/sandbox-exec",
    ["-f", profilePath, "/bin/cat", ...readablePaths],
    { cwd: readableRepository },
  );
  let forbiddenReadRejected = false;
  try {
    await execFile(
      "/usr/bin/sandbox-exec",
      ["-f", profilePath, "/bin/cat", forbiddenPath],
    );
  } catch {
    forbiddenReadRejected = true;
  }
  if (!forbiddenReadRejected) {
    fail("repository checker sandbox exposed an unrelated external file");
  }
}

async function resolvePinnedMacosCompiler(cwd = process.cwd()) {
  const clang = (await readCommandOutput(
    "/usr/bin/xcrun",
    ["--find", "clang"],
    cwd,
  )).trim();
  const clangXX = (await readCommandOutput(
    "/usr/bin/xcrun",
    ["--find", "clang++"],
    cwd,
  )).trim();
  const [canonicalClang, canonicalClangXX] = await Promise.all([
    realpath(clang),
    realpath(clangXX),
  ]);
  if (
    clang !== EXPECTED_MACOS_COMPILER.clang
    || clangXX !== EXPECTED_MACOS_COMPILER.clangXX
    || canonicalClang !== canonicalClangXX
  ) {
    fail("xcrun compiler resolution differs from the caller-reviewed paths");
  }
  const capture = await captureRegularFile(
    canonicalClang,
    "caller-resolved macOS compiler",
  );
  if (capture.digest !== EXPECTED_MACOS_COMPILER.digest) {
    fail("caller-resolved macOS compiler differs from the reviewed digest");
  }
  const sdkCanonicalPath = await realpath(EXPECTED_MACOS_SDK.alias);
  if (sdkCanonicalPath !== EXPECTED_MACOS_SDK.canonicalPath) {
    fail("macOS SDK canonical path differs from the caller-reviewed path");
  }
  const [sdkManifest, sdkSettings] = await Promise.all([
    computeTreeManifest(sdkCanonicalPath),
    captureRegularFile(
      path.join(sdkCanonicalPath, "SDKSettings.json"),
      "caller-resolved macOS SDK settings",
    ),
  ]);
  if (
    sdkManifest.digest !== EXPECTED_MACOS_SDK.digest
    || sdkManifest.entryCount !== EXPECTED_MACOS_SDK.entryCount
    || sdkSettings.digest !== EXPECTED_MACOS_SDK.settingsDigest
  ) {
    fail("caller-resolved macOS SDK differs from the reviewed manifest");
  }
  return Object.freeze({
    clang,
    clangXX,
    canonicalPath: canonicalClang,
    digest: capture.digest,
    sdkAlias: EXPECTED_MACOS_SDK.alias,
    sdkCanonicalPath,
    sdkDigest: sdkManifest.digest,
    sdkEntryCount: sdkManifest.entryCount,
    sdkSettingsDigest: sdkSettings.digest,
    resolutionCwd: cwd,
  });
}

async function verifyPinnedMacosToolchainFiles(expected) {
  const [compilerCanonicalPath, sdkCanonicalPath] = await Promise.all([
    realpath(expected.clang),
    realpath(expected.sdkAlias),
  ]);
  if (
    compilerCanonicalPath !== expected.canonicalPath
    || sdkCanonicalPath !== expected.sdkCanonicalPath
  ) {
    fail("caller-reviewed compiler or SDK canonical path changed");
  }
  const [compiler, sdkSettings] = await Promise.all([
    captureRegularFile(expected.canonicalPath, "macOS compiler postflight"),
    captureRegularFile(
      path.join(expected.sdkCanonicalPath, "SDKSettings.json"),
      "macOS SDK settings postflight",
    ),
  ]);
  if (
    compiler.digest !== expected.digest
    || sdkSettings.digest !== expected.sdkSettingsDigest
  ) {
    fail("caller-reviewed compiler or SDK file digest changed");
  }
}

async function verifyPinnedMacosSdkManifest(expected) {
  await verifyPinnedMacosToolchainFiles(expected);
  const sdkManifest = await computeTreeManifest(expected.sdkCanonicalPath);
  if (
    sdkManifest.digest !== expected.sdkDigest
    || sdkManifest.entryCount !== expected.sdkEntryCount
  ) {
    fail("caller-reviewed macOS SDK manifest changed during acceptance");
  }
}

function createPinnedSafeFsToolchainPolicy(toolchain) {
  const digestInput = {
    schemaVersion: 1,
    kind: "v3.9.2-pinned-safe-fs-toolchain",
    compiler: {
      configuredPath: toolchain.clang,
      canonicalPath: toolchain.canonicalPath,
      digest: toolchain.digest,
    },
    sdk: {
      configuredPath: toolchain.sdkAlias,
      canonicalPath: toolchain.sdkCanonicalPath,
      settingsDigest: toolchain.sdkSettingsDigest,
    },
    safeFsHelperDigest: EXPECTED_UNSIGNED_SAFE_FS_HELPER_DIGEST,
  };
  return { ...digestInput, digest: hashCanonical(digestInput) };
}

async function runHostToolchainIsolationSelfTest() {
  if (process.platform !== "darwin") {
    console.log(JSON.stringify({ hostToolchainIsolationSelfTest: "skipped" }));
    return;
  }
  const privateRoot = await realpath(await mkdtemp(
    "/private/tmp/zerox-host-xcrun-isolation-",
  ));
  const profilePath = path.join(privateRoot, "command.sb");
  try {
    const trustedNodePath = await realpath(process.execPath);
    const compiler = await resolvePinnedMacosCompiler(process.cwd());
    const { stdout: darwinUserTempOutput } = await execFile(
      "/usr/bin/getconf",
      ["DARWIN_USER_TEMP_DIR"],
      { encoding: "utf8" },
    );
    const cacheRoot = await realpath(darwinUserTempOutput.trim());
    const policyPath = path.join(
      privateRoot,
      PINNED_SAFE_FS_TOOLCHAIN_POLICY_NAME,
    );
    const writableRoot = path.join(privateRoot, "writable");
    await mkdir(writableRoot, { mode: 0o700 });
    await writePrivateFile(
      policyPath,
      Buffer.from(`${JSON.stringify(
        createPinnedSafeFsToolchainPolicy(compiler),
        null,
        2,
      )}\n`),
    );
    const electronProfilePath = path.join(privateRoot, "electron.sb");
    const readableRoots = [
      writableRoot,
      path.dirname(path.dirname(trustedNodePath)),
      ...SYSTEM_SANDBOX_READ_ROOTS,
    ];
    await Promise.all([
      writePrivateFile(
        profilePath,
        Buffer.from(buildAcceptanceSandboxProfile({
          readableRoots,
          readableFiles: [policyPath],
          writableRoots: [writableRoot],
          network: false,
        })),
      ),
      writePrivateFile(
        electronProfilePath,
        Buffer.from(buildAcceptanceSandboxProfile({
          readableRoots,
          readableFiles: [policyPath],
          writableRoots: [writableRoot],
          network: false,
          allowMach: true,
        })),
      ),
    ]);
    const environment = {
      HOME: privateRoot,
      LANG: "en_US.UTF-8",
      PATH: "/usr/bin:/bin",
      SHELL: "/bin/sh",
      TMPDIR: privateRoot,
    };
    await verifyHostToolchainIsolation({
      profiles: [
        { label: "command", path: profilePath },
        { label: "electron", path: electronProfilePath },
      ],
      nodePath: trustedNodePath,
      cwd: writableRoot,
      environment,
      cacheRoot,
      compiler,
      policyPath,
    });
    console.log(JSON.stringify({
      hostToolchainIsolationSelfTest: "passed",
      compilerDigest: compiler.digest,
    }));
  } finally {
    await rm(privateRoot, { recursive: true, force: true });
  }
}

async function verifyHostToolchainIsolation({
  profiles,
  nodePath: trustedNodePath,
  cwd,
  environment,
  cacheRoot,
  compiler,
  policyPath,
}) {
  await verifyExternalXcrunResolution(compiler);
  const baseline = await captureHostXcrunCacheState(cacheRoot);
  const exactCachePath = path.join(cacheRoot, "xcrun_db");
  const compilerPath = compiler.canonicalPath;
  const sdkSettingsPath = path.join(
    compiler.sdkCanonicalPath,
    "SDKSettings.json",
  );
  const hostileSource = [
    "const fs=require('node:fs');",
    "let denied=0;",
    "for(const target of process.argv.slice(1)){",
    "try{fs.writeFileSync(target,'zerox-hostile-xcrun-cache');}",
    "catch(error){if(error.code==='EPERM'||error.code==='EACCES')denied+=1;else throw error;}",
    "}",
    "if(denied!==5)process.exit(9);",
    "if(process.env.ZEROX_HOSTILE_FAILURE==='1')process.exit(17);",
  ].join("");
  const invokeHostileCandidate = (profilePath, hostilePrefixPath, failure) => execFile(
    "/usr/bin/sandbox-exec",
    [
      "-f",
      profilePath,
      trustedNodePath,
      "-e",
      hostileSource,
      hostilePrefixPath,
      exactCachePath,
      compilerPath,
      sdkSettingsPath,
      policyPath,
    ],
    {
      cwd,
      env: {
        ...environment,
        ZEROX_HOSTILE_FAILURE: failure ? "1" : "0",
      },
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      timeout: 5_000,
    },
  );

  for (const profile of profiles) {
    const hostilePrefixPath = path.join(
      cacheRoot,
      `xcrun_db-hostile-${profile.label}-${process.pid}-${randomUUID()}`,
    );
    await invokeHostileCandidate(profile.path, hostilePrefixPath, false);
    await assertHostXcrunStateUnchanged(
      cacheRoot,
      compiler,
      baseline,
      `${profile.label} success`,
    );
    let failureObserved = false;
    try {
      await invokeHostileCandidate(profile.path, hostilePrefixPath, true);
    } catch (error) {
      failureObserved = error?.code === 17;
    }
    if (!failureObserved) {
      fail(
        `hostile xcrun cache ${profile.label} failure lane did not preserve its exit status`,
      );
    }
    await assertHostXcrunStateUnchanged(
      cacheRoot,
      compiler,
      baseline,
      `${profile.label} failure`,
    );
  }
}

async function assertHostXcrunStateUnchanged(
  cacheRoot,
  compiler,
  baseline,
  lane,
) {
  await verifyExternalXcrunResolution(compiler);
  await verifyPinnedMacosToolchainFiles(compiler);
  const current = await captureHostXcrunCacheState(cacheRoot);
  if (JSON.stringify(current) !== JSON.stringify(baseline)) {
    fail(`host xcrun cache changed during hostile ${lane} lane`);
  }
}

async function verifyExternalXcrunResolution(expected) {
  const clang = (await readCommandOutput(
    "/usr/bin/xcrun",
    ["--find", "clang"],
    expected.resolutionCwd,
  )).trim();
  const clangXX = (await readCommandOutput(
    "/usr/bin/xcrun",
    ["--find", "clang++"],
    expected.resolutionCwd,
  )).trim();
  const [canonicalClang, canonicalClangXX] = await Promise.all([
    realpath(clang),
    realpath(clangXX),
  ]);
  if (
    clang !== expected.clang
    || clangXX !== expected.clangXX
    || canonicalClang !== expected.canonicalPath
    || canonicalClangXX !== expected.canonicalPath
  ) {
    fail("external xcrun compiler resolution changed");
  }
}

async function captureHostXcrunCacheState(cacheRoot) {
  const names = (await readdir(cacheRoot))
    .filter((name) => name === "xcrun_db" || name.startsWith("xcrun_db-"))
    .sort();
  const entries = [];
  for (const name of names) {
    const absolutePath = path.join(cacheRoot, name);
    const metadata = await lstat(absolutePath);
    if (metadata.isSymbolicLink()) {
      entries.push({
        name,
        kind: "symlink",
        mode: metadata.mode & 0o777,
        digest: sha256(Buffer.from(await readlink(absolutePath))),
      });
    } else if (metadata.isFile()) {
      entries.push({
        name,
        kind: "file",
        mode: metadata.mode & 0o777,
        digest: sha256(await readFile(absolutePath)),
      });
    } else if (metadata.isDirectory()) {
      const tree = await computeTreeManifest(absolutePath);
      entries.push({
        name,
        kind: "directory",
        mode: metadata.mode & 0o777,
        digest: tree.digest,
        entryCount: tree.entryCount,
      });
    } else {
      fail(`unsupported host xcrun cache entry: ${name}`);
    }
  }
  return {
    digest: hashCanonical(entries),
    entryCount: entries.length,
  };
}

async function exercisePublicationRecoveryState({
  repositoryRoot,
  privateRoot,
  outputPath,
  journalPath,
  sourceDigest,
  runnerDigest,
  previousFiles,
  nextFiles,
  committed,
  afterJournalRename,
  leavePublishedAnchorHardlink = false,
}) {
  const transactionId = randomUUID();
  const backupRoot = `${journalPath}.backup-${transactionId}`;
  const publishedRelease = path.join(repositoryRoot, "release-local");
  const rollbackRelease = path.join(
    repositoryRoot,
    `release-test-v392-rollback-${transactionId}`,
  );
  const nextReleaseTemplate = path.join(
    privateRoot,
    `next-release-${transactionId}`,
  );
  await mkdir(backupRoot, { mode: 0o700 });
  const generatedFiles = [];
  for (let index = 0; index < previousFiles.length; index += 1) {
    const previous = await captureRepositoryFile(
      repositoryRoot,
      previousFiles[index].relativePath,
    );
    await writePrivateFile(path.join(backupRoot, `${index}.bin`), previous.bytes);
    generatedFiles.push({
      relativePath: previousFiles[index].relativePath,
      previousDigest: previous.digest,
      previousMode: previous.metadata.mode & 0o777,
      backupName: `${index}.bin`,
      nextDigest: sha256(nextFiles[index].bytes),
    });
  }
  await syncDirectory(backupRoot);
  const previousRelease = await computeTreeManifest(publishedRelease);
  await writeSelfTestRelease(nextReleaseTemplate, "next-release");
  const nextRelease = await computeTreeManifest(nextReleaseTemplate);
  let journal = await writePublicationJournal(journalPath, {
    schemaVersion: 1,
    kind: "v3.9.2-publication-transaction",
    status: "prepared",
    repositoryRealpath: repositoryRoot,
    outputPath,
    sourceDigest,
    runnerDigest,
    transactionId,
    anchorDigest: null,
    generatedFiles,
    previousRelease,
    nextRelease,
  }, { afterRename: afterJournalRename });
  for (let index = 0; index < nextFiles.length; index += 1) {
    await replaceFileAtomically(
      nextFiles[index].bytes,
      0o600,
      path.join(repositoryRoot, nextFiles[index].relativePath),
      repositoryRoot,
    );
  }
  await rename(publishedRelease, rollbackRelease);
  await cp(nextReleaseTemplate, publishedRelease, {
    recursive: true,
    preserveTimestamps: true,
  });
  const anchorInput = {
    kind: "v3.9.2-local-acceptance-external-anchor",
    repositoryRealpath: repositoryRoot,
    sourceDigest,
    runnerDigest,
  };
  const anchor = { ...anchorInput, digest: hashCanonical(anchorInput) };
  const anchorTemporaryPath = `${outputPath}.partial-${transactionId}`;
  if (leavePublishedAnchorHardlink) {
    await writePrivateFile(anchorTemporaryPath, completedAnchorBytes(anchor));
    await link(anchorTemporaryPath, outputPath);
    const [outputMetadata, temporaryMetadata] = await Promise.all([
      lstat(outputPath),
      lstat(anchorTemporaryPath),
    ]);
    if (
      outputMetadata.dev !== temporaryMetadata.dev
      || outputMetadata.ino !== temporaryMetadata.ino
      || outputMetadata.nlink !== 2
      || temporaryMetadata.nlink !== 2
    ) {
      fail("acceptance anchor publication hardlink crash was not reproduced");
    }
  } else {
    await writePrivateFile(outputPath, completedAnchorBytes(anchor));
  }
  if (committed) {
    journal = await writePublicationJournal(journalPath, {
      ...withoutDigest(journal),
      status: "committed",
      anchorDigest: anchor.digest,
    });
  }
  const recovery = await recoverPublicationJournal({
    journalPath,
    repositoryRoot,
    outputPath,
  });
  return {
    ...recovery,
    anchorTemporaryPath,
  };
}

async function writeSelfTestRelease(releaseRoot, value) {
  const filePath = path.join(
    releaseRoot,
    "mac-arm64/Zerox Agent.app/Contents/value.txt",
  );
  await mkdir(path.dirname(filePath), { recursive: true });
  await writePrivateFile(filePath, Buffer.from(value));
}

async function markPublicationCommitted(transaction, anchorDigest) {
  transaction.journal = await writePublicationJournal(
    transaction.journalPath,
    {
      ...withoutDigest(transaction.journal),
      status: "committed",
      anchorDigest,
    },
  );
}

async function finalizePublication(transaction) {
  await recoverPublicationJournal({
    journalPath: transaction.journalPath,
    repositoryRoot: transaction.repositoryRoot,
    outputPath: transaction.outputPath,
  });
}

async function publicationJournalIsCommitted(transaction) {
  const capture = await captureOptionalRegularFile(
    transaction.journalPath,
    "publication transaction journal",
  );
  if (!capture) return false;
  const journal = JSON.parse(capture.bytes.toString("utf8"));
  validatePublicationJournal(
    journal,
    transaction.repositoryRoot,
    transaction.outputPath,
  );
  return journal.status === "committed";
}

async function rollbackPublication(transaction) {
  await recoverPublicationJournal({
    journalPath: transaction.journalPath,
    repositoryRoot: transaction.repositoryRoot,
    outputPath: transaction.outputPath,
  });
}

async function recoverPublicationJournal({
  journalPath,
  repositoryRoot,
  outputPath,
  expectedSourceDigest,
  expectedRunnerDigest,
  validateCommitted,
}) {
  const capture = await captureOptionalRegularFile(
    journalPath,
    "publication transaction journal",
  );
  if (!capture) {
    if (!validateCommitted) return;
    const existingAnchor = await captureOptionalRegularFile(
      outputPath,
      "existing committed acceptance anchor",
    );
    if (!existingAnchor) return;
    const anchor = JSON.parse(existingAnchor.bytes.toString("utf8"));
    await validateCommitted(anchor);
    return { status: "committed", anchor };
  }
  if ((capture.metadata.mode & 0o077) !== 0) {
    fail("publication transaction journal must be private");
  }
  let journal = JSON.parse(capture.bytes.toString("utf8"));
  validatePublicationJournal(journal, repositoryRoot, outputPath);
  if (
    expectedSourceDigest
    && journal.sourceDigest !== expectedSourceDigest
  ) {
    fail("publication transaction source digest differs from the caller pin");
  }
  if (
    expectedRunnerDigest
    && journal.runnerDigest !== expectedRunnerDigest
  ) {
    fail("publication transaction runner digest differs from the caller pin");
  }
  const backupRoot = `${journalPath}.backup-${journal.transactionId}`;
  const stagedRelease = path.join(
    repositoryRoot,
    `release-test-v392-publish-${journal.transactionId}`,
  );
  const rollbackRelease = path.join(
    repositoryRoot,
    `release-test-v392-rollback-${journal.transactionId}`,
  );
  const publishedRelease = path.join(repositoryRoot, "release-local");
  const anchorTemporaryPath =
    `${outputPath}.partial-${journal.transactionId}`;
  if (journal.status === "prepared") {
    const backupMetadata = await optionalLstat(backupRoot);
    if (
      !backupMetadata
      || backupMetadata.isSymbolicLink()
      || !backupMetadata.isDirectory()
      || (backupMetadata.mode & 0o077) !== 0
      || !isWithin(path.dirname(journalPath), await realpath(backupRoot))
    ) {
      fail("publication backup root is invalid");
    }
    const errors = [];
    for (const entry of [...journal.generatedFiles].reverse()) {
      try {
        const destination = path.join(repositoryRoot, entry.relativePath);
        const current = await captureOptionalRegularFile(
          destination,
          `recovering generated output ${entry.relativePath}`,
        );
        if (
          current
          && current.digest !== entry.nextDigest
          && current.digest !== entry.previousDigest
        ) {
          fail(`generated output has a third state: ${entry.relativePath}`);
        }
        if (entry.previousDigest) {
          const backup = await captureRegularFile(
            path.join(backupRoot, entry.backupName),
            `publication backup ${entry.relativePath}`,
          );
          if (backup.digest !== entry.previousDigest) {
            fail(`publication backup drifted: ${entry.relativePath}`);
          }
          await replaceFileAtomically(
            backup.bytes,
            entry.previousMode,
            destination,
            repositoryRoot,
          );
        } else if (current) {
          await rm(destination, { force: true });
          await syncDirectory(path.dirname(destination));
        }
      } catch (error) {
        errors.push(error);
      }
    }
    try {
      await recoverPublishedRelease({
        publishedRelease,
        rollbackRelease,
        stagedRelease,
        previousRelease: journal.previousRelease,
        nextRelease: journal.nextRelease,
      });
    } catch (error) {
      errors.push(error);
    }
    try {
      await normalizeRecoverableAnchorLinks(
        outputPath,
        anchorTemporaryPath,
      );
      const anchor = await captureOptionalRegularFile(
        outputPath,
        "uncommitted acceptance anchor",
      );
      if (anchor) {
        const value = JSON.parse(anchor.bytes.toString("utf8"));
        if (
          value.kind !== "v3.9.2-local-acceptance-external-anchor"
          || value.repositoryRealpath !== repositoryRoot
          || value.sourceDigest !== journal.sourceDigest
          || value.runnerDigest !== journal.runnerDigest
        ) {
          fail("uncommitted acceptance anchor has a third state");
        }
        await rm(outputPath, { force: true });
      }
    } catch (error) {
      errors.push(error);
    }
    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        "acceptance publication recovery failed",
      );
    }
    journal = await writePublicationJournal(journalPath, {
      ...withoutDigest(journal),
      status: "rolled_back",
      anchorDigest: null,
    });
  } else if (journal.status === "rolled_back") {
    await validateRolledBackPublication({
      journal,
      repositoryRoot,
      outputPath,
      publishedRelease,
    });
  } else {
    const anchor = await validateCommittedPublication({
      journal,
      repositoryRoot,
      outputPath,
      publishedRelease,
    });
    await validateCommitted?.(anchor);
  }
  await Promise.all([
    rm(stagedRelease, { recursive: true, force: true }),
    rm(rollbackRelease, { recursive: true, force: true }),
    rm(backupRoot, { recursive: true, force: true }),
    rm(anchorTemporaryPath, { force: true }),
  ]);
  await rm(journalPath, { force: true });
  await syncDirectory(path.dirname(journalPath));
  return journal.status === "committed"
    ? {
        status: "committed",
        anchor: JSON.parse(
          (await captureRegularFile(
            outputPath,
            "recovered committed acceptance anchor",
          )).bytes.toString("utf8"),
        ),
      }
    : { status: "rolled_back" };
}

async function validateRolledBackPublication({
  journal,
  repositoryRoot,
  outputPath,
  publishedRelease,
}) {
  if (await optionalLstat(outputPath)) {
    fail("rolled-back publication retained an acceptance anchor");
  }
  for (const entry of journal.generatedFiles) {
    const current = await captureOptionalRegularFile(
      path.join(repositoryRoot, entry.relativePath),
      `rolled-back generated output ${entry.relativePath}`,
    );
    if (
      entry.previousDigest
        ? !current
          || current.digest !== entry.previousDigest
          || (current.metadata.mode & 0o777) !== entry.previousMode
        : Boolean(current)
    ) {
      fail(`rolled-back generated output drifted: ${entry.relativePath}`);
    }
  }
  const published = await optionalTreeManifest(publishedRelease);
  if (
    journal.previousRelease
      ? !published
        || published.digest !== journal.previousRelease.digest
        || published.entryCount !== journal.previousRelease.entryCount
      : Boolean(published)
  ) {
    fail("rolled-back release-local differs from its previous state");
  }
}

async function normalizeRecoverableAnchorLinks(
  outputPath,
  anchorTemporaryPath,
) {
  const [outputMetadata, temporaryMetadata] = await Promise.all([
    optionalLstat(outputPath),
    optionalLstat(anchorTemporaryPath),
  ]);
  if (!temporaryMetadata) return;
  if (
    temporaryMetadata.isSymbolicLink()
    || !temporaryMetadata.isFile()
    || await realpath(anchorTemporaryPath) !== anchorTemporaryPath
  ) {
    fail("acceptance anchor temporary path is invalid");
  }
  if (!outputMetadata) {
    if (temporaryMetadata.nlink !== 1) {
      fail("unpublished acceptance anchor temporary link count changed");
    }
    await rm(anchorTemporaryPath, { force: true });
    await syncDirectory(path.dirname(anchorTemporaryPath));
    return;
  }
  if (
    outputMetadata.isSymbolicLink()
    || !outputMetadata.isFile()
    || outputMetadata.dev !== temporaryMetadata.dev
    || outputMetadata.ino !== temporaryMetadata.ino
    || outputMetadata.nlink !== 2
    || temporaryMetadata.nlink !== 2
    || await realpath(outputPath) !== outputPath
  ) {
    fail("acceptance anchor publication links have a third state");
  }
  await rm(anchorTemporaryPath);
  await syncDirectory(path.dirname(anchorTemporaryPath));
}

async function optionalTreeManifest(treeRoot) {
  const metadata = await optionalLstat(treeRoot);
  if (!metadata) return null;
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    fail(`tree root must be a real directory: ${treeRoot}`);
  }
  return computeTreeManifest(treeRoot);
}

async function validateCommittedPublication({
  journal,
  repositoryRoot,
  outputPath,
  publishedRelease,
}) {
  for (const entry of journal.generatedFiles) {
    const current = await captureRepositoryFile(
      repositoryRoot,
      entry.relativePath,
    );
    if (current.digest !== entry.nextDigest) {
      fail(`committed generated output drifted: ${entry.relativePath}`);
    }
  }
  const release = await captureOptionalTree(publishedRelease);
  if (
    !release
    || release.digest !== journal.nextRelease.digest
    || release.entryCount !== journal.nextRelease.entryCount
  ) {
    fail("committed release-local drifted");
  }
  const anchor = await captureRegularFile(
    outputPath,
    "committed acceptance anchor",
  );
  const value = JSON.parse(anchor.bytes.toString("utf8"));
  const { digest: _digest, ...digestInput } = value;
  if (
    value.digest !== journal.anchorDigest
    || hashCanonical(digestInput) !== journal.anchorDigest
    || value.repositoryRealpath !== repositoryRoot
    || value.sourceDigest !== journal.sourceDigest
    || value.runnerDigest !== journal.runnerDigest
  ) {
    fail("committed acceptance anchor drifted");
  }
  return value;
}

async function recoverPublishedRelease({
  publishedRelease,
  rollbackRelease,
  stagedRelease,
  previousRelease,
  nextRelease,
}) {
  const [published, rollback] = await Promise.all([
    captureOptionalTree(publishedRelease),
    captureOptionalTree(rollbackRelease),
  ]);
  if (rollback) {
    if (
      !previousRelease
      || rollback.digest !== previousRelease.digest
      || rollback.entryCount !== previousRelease.entryCount
      || (published && (
        published.digest !== nextRelease.digest
        || published.entryCount !== nextRelease.entryCount
      ))
    ) {
      fail("release publication rollback has a third state");
    }
    if (published) {
      await rm(publishedRelease, { recursive: true, force: true });
    }
    await rename(rollbackRelease, publishedRelease);
    await syncDirectory(path.dirname(publishedRelease));
  } else if (previousRelease) {
    if (
      !published
      || published.digest !== previousRelease.digest
      || published.entryCount !== previousRelease.entryCount
    ) {
      fail("previous release-local cannot be recovered");
    }
  } else if (published) {
    if (
      published.digest !== nextRelease.digest
      || published.entryCount !== nextRelease.entryCount
    ) {
      fail("new release-local has a third state");
    }
    await rm(publishedRelease, { recursive: true, force: true });
    await syncDirectory(path.dirname(publishedRelease));
  }
  await rm(stagedRelease, { recursive: true, force: true });
}

function validatePublicationJournal(journal, repositoryRoot, outputPath) {
  const digestInput = withoutDigest(journal);
  const expectedKeys = [
    "schemaVersion",
    "kind",
    "status",
    "repositoryRealpath",
    "outputPath",
    "sourceDigest",
    "runnerDigest",
    "transactionId",
    "anchorDigest",
    "generatedFiles",
    "previousRelease",
    "nextRelease",
    "digest",
  ].sort();
  if (
    JSON.stringify(Object.keys(journal ?? {}).sort())
      !== JSON.stringify(expectedKeys)
    || journal.schemaVersion !== 1
    || journal.kind !== "v3.9.2-publication-transaction"
    || !["prepared", "rolled_back", "committed"].includes(journal.status)
    || journal.repositoryRealpath !== repositoryRoot
    || journal.outputPath !== outputPath
    || !/^sha256:[0-9a-f]{64}$/.test(journal.sourceDigest ?? "")
    || !/^sha256:[0-9a-f]{64}$/.test(journal.runnerDigest ?? "")
    || (journal.status !== "committed"
      ? journal.anchorDigest !== null
      : !/^sha256:[0-9a-f]{64}$/.test(journal.anchorDigest ?? ""))
    || !/^[0-9a-f-]{36}$/.test(journal.transactionId ?? "")
    || journal.digest !== hashCanonical(digestInput)
    || !Array.isArray(journal.generatedFiles)
    || JSON.stringify(journal.generatedFiles.map((entry) => entry.relativePath))
      !== JSON.stringify(GENERATED_PUBLICATION_FILES)
    || !journal.nextRelease
  ) {
    fail("publication transaction journal is invalid");
  }
  for (
    let index = 0;
    index < journal.generatedFiles.length;
    index += 1
  ) {
    const entry = journal.generatedFiles[index];
    if (
      JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify([
        "backupName",
        "nextDigest",
        "previousDigest",
        "previousMode",
        "relativePath",
      ])
      || !/^sha256:[0-9a-f]{64}$/.test(entry.nextDigest ?? "")
      || (entry.previousDigest !== null
        && !/^sha256:[0-9a-f]{64}$/.test(entry.previousDigest ?? ""))
      || (entry.previousDigest === null
        ? entry.previousMode !== null || entry.backupName !== null
        : !Number.isInteger(entry.previousMode)
          || entry.backupName !== `${index}.bin`)
    ) {
      fail("publication transaction journal file entry is invalid");
    }
  }
  for (const tree of [journal.previousRelease, journal.nextRelease]) {
    if (
      tree !== null
      && (
        JSON.stringify(Object.keys(tree).sort())
          !== JSON.stringify(["digest", "entryCount"])
        || !/^sha256:[0-9a-f]{64}$/.test(tree.digest ?? "")
        || !Number.isInteger(tree.entryCount)
        || tree.entryCount <= 0
      )
    ) {
      fail("publication transaction journal tree entry is invalid");
    }
  }
}

async function writePublicationJournal(journalPath, value, hooks = {}) {
  const digestInput = withoutDigest(value);
  const journal = {
    ...digestInput,
    digest: hashCanonical(digestInput),
  };
  validatePublicationJournal(
    journal,
    journal.repositoryRealpath,
    journal.outputPath,
  );
  const existing = await captureOptionalRegularFile(
    journalPath,
    "existing publication transaction journal",
  );
  if (existing) {
    const previous = JSON.parse(existing.bytes.toString("utf8"));
    validatePublicationJournal(
      previous,
      journal.repositoryRealpath,
      journal.outputPath,
    );
    const previousIdentity = {
      ...withoutDigest(previous),
      status: "prepared",
      anchorDigest: null,
    };
    const nextIdentity = {
      ...withoutDigest(journal),
      status: "prepared",
      anchorDigest: null,
    };
    if (
      previous.status !== "prepared"
      || !["rolled_back", "committed"].includes(journal.status)
      || canonicalJson(previousIdentity) !== canonicalJson(nextIdentity)
    ) {
      fail("publication transaction journal contains a third state");
    }
  }
  const bytes = Buffer.from(`${JSON.stringify(journal, null, 2)}\n`);
  const temporaryPath =
    `${journalPath}.atomic-${process.pid}-${randomUUID()}`;
  try {
    const handle = await open(
      temporaryPath,
      constants.O_WRONLY
        | constants.O_CREAT
        | constants.O_EXCL
        | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, journalPath);
    await hooks.afterRename?.();
    await syncDirectory(path.dirname(journalPath));
  } finally {
    await rm(temporaryPath, { force: true });
  }
  return journal;
}

async function writePrivateFile(filePath, bytes) {
  const handle = await open(
    filePath,
    constants.O_WRONLY
      | constants.O_CREAT
      | constants.O_EXCL
      | (constants.O_NOFOLLOW ?? 0),
    0o600,
  );
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function captureOptionalTree(treeRoot) {
  const metadata = await optionalLstat(treeRoot);
  if (!metadata) return null;
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    fail(`tree root is not a real directory: ${treeRoot}`);
  }
  return computeTreeManifest(treeRoot);
}

async function syncDirectory(directory) {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function withoutDigest(value) {
  return Object.fromEntries(
    Object.entries(value ?? {}).filter(([key]) => key !== "digest"),
  );
}

async function replaceFileAtomically(bytes, mode, destination, repositoryRoot) {
  const parent = path.dirname(destination);
  const canonicalParent = await realpath(parent);
  if (!isWithin(repositoryRoot, destination)
    || !isWithin(repositoryRoot, canonicalParent)) {
    fail(`publication destination escapes repository: ${destination}`);
  }
  const parentLeaf = await lstat(parent);
  if (!parentLeaf.isDirectory() || parentLeaf.isSymbolicLink()) {
    fail(`publication parent is not a real directory: ${parent}`);
  }
  const parentHandle = await open(parent, "r");
  const parentBefore = await parentHandle.stat();
  const temporaryPath = path.join(
    parent,
    `.zerox-publish-${process.pid}-${randomUUID()}`,
  );
  try {
    const handle = await open(
      temporaryPath,
      constants.O_WRONLY
        | constants.O_CREAT
        | constants.O_EXCL
        | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await chmod(temporaryPath, mode);
    await rename(temporaryPath, destination);
    await parentHandle.sync();
    const [parentAfter, parentCurrent, destinationCapture] = await Promise.all([
      parentHandle.stat(),
      lstat(parent),
      captureRegularFile(destination, "published generated output"),
    ]);
    if (
      parentAfter.dev !== parentBefore.dev
      || parentAfter.ino !== parentBefore.ino
      || parentCurrent.dev !== parentBefore.dev
      || parentCurrent.ino !== parentBefore.ino
      || await realpath(parent) !== canonicalParent
      || destinationCapture.digest !== sha256(bytes)
    ) {
      fail(`publication path identity changed: ${destination}`);
    }
  } finally {
    await rm(temporaryPath, { force: true });
    await parentHandle.close();
  }
}

async function captureOptionalRegularFile(filePath, label) {
  try {
    return await captureRegularFile(filePath, label);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function optionalLstat(filePath) {
  try {
    return await lstat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function verifyToolchain(repositoryRoot) {
  const manifest = await computeTreeManifest(
    path.join(repositoryRoot, "node_modules"),
    { excludeGeneratedNativeBuild: true },
  );
  if (
    manifest.digest !== EXPECTED_TOOLCHAIN.digest
    || manifest.entryCount !== EXPECTED_TOOLCHAIN.entryCount
  ) {
    fail("installed node_modules tree differs from the caller-reviewed toolchain");
  }
}

async function verifyNativeNodeAddon(repositoryRoot) {
  const capture = await captureRepositoryFile(
    repositoryRoot,
    "node_modules/better-sqlite3/build/Release/better_sqlite3.node",
  );
  if (capture.digest !== EXPECTED_NATIVE_NODE_ADDON_DIGEST) {
    fail("Node-ABI better-sqlite3 binary differs from the caller-reviewed pin");
  }
}

async function verifyGitIdentity(repositoryRoot, expected) {
  const [head, tree] = await Promise.all([
    readCommandOutput("/usr/bin/git", ["rev-parse", "HEAD"], repositoryRoot),
    readCommandOutput(
      "/usr/bin/git",
      ["rev-parse", "--verify", "HEAD^{tree}"],
      repositoryRoot,
    ),
  ]);
  if (
    head.trim() !== expected.expectedGitHead
    || tree.trim() !== expected.expectedGitTree
  ) {
    fail("Git HEAD or tree differs from the caller-reviewed baseline");
  }
}

async function verifySourceManifest(repositoryRoot, expected) {
  const manifest = await computeSourceManifest(repositoryRoot);
  if (
    manifest.digest !== expected.expectedSourceDigest
    || manifest.fileCount !== expected.expectedSourceFileCount
  ) {
    fail("source manifest differs from the caller-reviewed source pin");
  }
}

async function computeSourceManifest(repositoryRoot) {
  const paths = await listSourcePaths(repositoryRoot);
  const hash = createHash("sha256");
  let fileCount = 0;
  for (const relativePath of paths) {
    const absolutePath = path.join(repositoryRoot, relativePath);
    const metadata = await lstat(absolutePath);
    if (metadata.isSymbolicLink()) {
      fail(`source manifest rejects symlinks: ${relativePath}`);
    }
    if (!metadata.isFile()) continue;
    const capture = await captureRegularFile(absolutePath, relativePath);
    const { bytes } = capture;
    fileCount += 1;
    hash.update(
      `${relativePath}\0file\0${capture.metadata.mode & 0o777}\0${bytes.length}\0`,
    );
    hash.update(bytes);
  }
  return {
    digest: `sha256:${hash.digest("hex")}`,
    fileCount,
  };
}

async function listSourcePaths(repositoryRoot) {
  const { stdout } = await execFile(
    "/usr/bin/git",
    [
      "-c", "core.fsmonitor=false",
      "-c", "core.untrackedCache=false",
      "ls-files", "--cached", "--others", "--exclude-standard", "-z",
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  return stdout
    .split("\0")
    .filter(Boolean)
    .filter((relativePath) => !isAcceptanceInputExcluded(relativePath))
    .sort();
}

async function verifyPackagedLaunch(appPath, writableTempRoot, env) {
  const executable = path.join(appPath, "Contents/MacOS/Zerox Agent");
  await captureRegularFile(executable, "packaged application executable");
  const smokeRoot = await mkdtemp(path.join(writableTempRoot, "packaged-smoke-"));
  const evidencePath = path.join(smokeRoot, "storage-evidence.json");
  const launchEnvironment = {
    ...env,
    BUILDING_AGENT_SMOKE: "1",
    BUILDING_AGENT_USER_DATA_DIR: path.join(smokeRoot, "user-data"),
    ZEROX_AGENT_USER_DATA_DIR: path.join(smokeRoot, "user-data"),
    ZEROX_PRODUCTION_SMOKE_EVIDENCE_FILE: evidencePath,
    ZEROX_PRODUCTION_SMOKE_REQUIRE_SQLITE: "1",
    ZEROX_STORAGE_BACKEND: "sqlite",
  };
  delete launchEnvironment.ELECTRON_RUN_AS_NODE;
  delete launchEnvironment.ELECTRON_RENDERER_URL;
  try {
    await run(executable, ["--no-sandbox"], appPath, launchEnvironment);
    const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
    if (
      evidence?.kind !== "production_storage_smoke"
      || evidence?.resolvedBackend !== "sqlite"
      || evidence?.authority?.domainRowsPersisted !== true
      || evidence?.authority?.legacyJsonShadowsAbsent !== true
    ) {
      fail("packaged application launch did not produce valid SQLite authority evidence");
    }
    await scanPathsForEnvironmentSecrets([smokeRoot], launchEnvironment);
  } finally {
    await rm(smokeRoot, { recursive: true, force: true });
  }
}

async function scanPathsForEnvironmentSecrets(roots, env) {
  const secrets = environmentSecretValues(env);
  if (secrets.length === 0) return;
  for (const rootPath of roots) {
    await walk(rootPath, rootPath);
  }

  async function walk(rootPath, currentPath) {
    const metadata = await lstat(currentPath);
    if (metadata.isSymbolicLink()) return;
    if (metadata.isDirectory()) {
      for (const name of await readdir(currentPath)) {
        await walk(rootPath, path.join(currentPath, name));
      }
      return;
    }
    if (!metadata.isFile()) return;
    const bytes = await readFile(currentPath);
    if (secrets.some((secret) => bytes.includes(secret))) {
      fail(`packaged application contains an environment credential: ${
        path.relative(rootPath, currentPath)
      }`);
    }
  }
}

function assertCommandOutputDoesNotExposeEnvironmentSecrets(stdout, stderr, env) {
  const secrets = environmentSecretValues(env);
  const outputs = [
    Buffer.from(stdout ?? ""),
    Buffer.from(stderr ?? ""),
  ];
  if (secrets.some((secret) => outputs.some((output) => output.includes(secret)))) {
    fail("candidate command output exposed an environment credential");
  }
}

function environmentSecretValues(env) {
  return [...new Set(
    Object.entries(env)
      .filter(([name, value]) =>
        /(API_KEY|AUTH|PASSWORD|PRIVATE_KEY|SECRET|TOKEN)/i.test(name)
        && typeof value === "string"
        && value.length >= 12
        && !value.startsWith("sha256:"))
      .map(([, value]) => Buffer.from(value)),
  )];
}

function buildAcceptanceSandboxProfile({
  readableRoots,
  readableFiles = [],
  readablePrefixes = [],
  metadataRoots = [],
  writableRoots,
  writablePrefixes = [],
  localSocketPrefixes = [],
  network,
  allowMach = false,
}) {
  const traversalRoots = new Set();
  for (const root of [
    ...readableRoots,
    ...readableFiles,
    ...readablePrefixes,
    ...metadataRoots,
    ...writablePrefixes,
    ...localSocketPrefixes,
  ]) {
    let current = path.resolve(root);
    while (true) {
      traversalRoots.add(current);
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  const forms = [
    "(version 1)",
    "(deny default)",
    '(import "system.sb")',
    "(allow process*)",
    "(allow signal (target same-sandbox))",
    ...(allowMach
      ? ["(allow mach*)", "(allow ipc*)", "(allow iokit*)", "(allow sysctl*)"]
      : []),
    `(allow file-read* (literal ${JSON.stringify("/dev/null")}))`,
    `(allow file-write* (literal ${JSON.stringify("/dev/null")}))`,
    `(allow file-read-metadata file-test-existence ${[...traversalRoots]
      .sort()
      .map((root) => `(literal ${JSON.stringify(root)})`)
      .join(" ")})`,
    ...(metadataRoots.length > 0
      ? [
        `(allow file-read-metadata file-test-existence ${metadataRoots
          .map((root) => `(subpath ${JSON.stringify(path.resolve(root))})`)
          .join(" ")})`,
      ]
      : []),
    `(allow file-read* file-test-existence ${readableRoots
      .flatMap((root) => {
        const resolved = JSON.stringify(path.resolve(root));
        return [`(literal ${resolved})`, `(subpath ${resolved})`];
      })
      .join(" ")})`,
    `(allow file-write* ${writableRoots
      .flatMap((root) => {
        const resolved = JSON.stringify(path.resolve(root));
        return [`(literal ${resolved})`, `(subpath ${resolved})`];
      })
      .join(" ")})`,
  ];
  if (readableFiles.length > 0) {
    forms.push(
      `(allow file-read* file-test-existence ${readableFiles
        .map((file) => `(literal ${JSON.stringify(path.resolve(file))})`)
        .join(" ")})`,
    );
  }
  if (readablePrefixes.length > 0) {
    forms.push(
      `(allow file-read* file-test-existence ${readablePrefixes
        .map((prefix) =>
          `(prefix ${JSON.stringify(path.resolve(prefix))})`)
        .join(" ")})`,
    );
  }
  if (writablePrefixes.length > 0) {
    forms.push(
      `(allow file-write* ${writablePrefixes
        .map((prefix) =>
          `(prefix ${JSON.stringify(path.resolve(prefix))})`)
        .join(" ")})`,
    );
  }
  if (localSocketPrefixes.length > 0) {
    const filters = localSocketPrefixes
      .map((prefix) =>
        `(prefix ${JSON.stringify(path.resolve(prefix))})`)
      .join(" ");
    forms.push(`(allow network-bind ${filters})`);
    forms.push(`(allow network-outbound ${filters})`);
  }
  forms.push(network ? "(allow network*)" : "(deny network*)");
  return `${forms.join("\n")}\n`;
}

async function verifyWhitespace(repositoryRoot, env) {
  await run("/usr/bin/git", ["diff", "--check"], repositoryRoot, env);
  await run("/usr/bin/git", ["diff", "--cached", "--check"], repositoryRoot, env);
  const { stdout } = await execFile(
    "/usr/bin/git",
    ["ls-files", "--others", "--exclude-standard", "-z"],
    { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  for (const relativePath of stdout.split("\0").filter(Boolean)) {
    if (isGeneratedOrPlanningPath(relativePath)) continue;
    const absolutePath = path.join(repositoryRoot, relativePath);
    const metadata = await lstat(absolutePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) continue;
    const bytes = await readFile(absolutePath);
    if (bytes.includes(0)) continue;
    const text = bytes.toString("utf8");
    if (text.split("\n").some((line) => /[ \t]+\r?$/.test(line))) {
      fail(`untracked source has trailing whitespace: ${relativePath}`);
    }
  }
}

async function verifyCommittedWhitespace(repositoryRoot, expectedGitHead) {
  const gitEnvironment = {
    HOME: "/var/empty",
    LANG: "en_US.UTF-8",
    PATH: "/usr/bin:/bin",
  };
  let failure;
  try {
    await execFile(
      "/usr/bin/git",
      [
        "diff",
        "--check",
        `${SOURCE_BASELINE_GIT_HEAD}...${expectedGitHead}`,
      ],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        env: gitEnvironment,
      },
    );
    return;
  } catch (error) {
    failure = error;
  }

  const diagnostics = `${failure?.stdout ?? ""}${failure?.stderr ?? ""}`
    .trim()
    .split("\n")
    .filter(Boolean);
  if (diagnostics.length === 0) {
    throw failure;
  }

  const verifiedPaths = new Set();
  for (const diagnostic of diagnostics) {
    const match = diagnostic.match(/^(.+?):(\d+): (.+)$/);
    const relativePath = match?.[1];
    const detail = match ? `${match[2]}: ${match[3]}` : "";
    const allowance = relativePath
      ? IMMUTABLE_COMMITTED_WHITESPACE_ALLOWLIST[relativePath]
      : undefined;
    if (!allowance?.diagnostics.includes(detail)) {
      fail(`unexpected committed whitespace: ${diagnostic}`);
    }
    if (verifiedPaths.has(relativePath)) continue;
    const { stdout } = await execFile(
      "/usr/bin/git",
      ["rev-parse", "--verify", `${expectedGitHead}:${relativePath}`],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
        env: gitEnvironment,
      },
    );
    if (stdout.trim() !== allowance.blob) {
      fail(`immutable whitespace allowlist blob changed: ${relativePath}`);
    }
    verifiedPaths.add(relativePath);
  }
}

async function computeTreeManifest(treeRoot, options = {}) {
  const canonicalRoot = await realpath(treeRoot);
  const entries = [];
  await walk(treeRoot, "");
  entries.sort((left, right) =>
    left.relativePath < right.relativePath ? -1 : 1);
  const hash = createHash("sha256");
  for (const entry of entries) {
    hash.update(
      `${entry.relativePath}\0${entry.kind}\0${entry.mode}\0${entry.bytes.length}\0`,
    );
    hash.update(entry.bytes);
  }
  return {
    digest: `sha256:${hash.digest("hex")}`,
    entryCount: entries.length,
  };

  async function walk(base, relativePath) {
    if (
      options.excludeGeneratedNativeBuild
      && (
        relativePath === ".vite"
        || relativePath.startsWith(`.vite${path.sep}`)
        || relativePath === "better-sqlite3/build"
        || relativePath.startsWith(`better-sqlite3/build${path.sep}`)
        || relativePath === "better-sqlite3/bin"
        || relativePath.startsWith(`better-sqlite3/bin${path.sep}`)
      )
    ) {
      return;
    }
    const absolutePath = path.join(base, relativePath);
    const metadata = await lstat(absolutePath);
    if (metadata.isSymbolicLink()) {
      const target = await readlink(absolutePath);
      const canonicalTarget = await realpath(
        path.resolve(path.dirname(absolutePath), target),
      );
      if (
        canonicalTarget !== canonicalRoot
        && !canonicalTarget.startsWith(`${canonicalRoot}${path.sep}`)
      ) {
        fail(`toolchain symlink escapes node_modules: ${relativePath}`);
      }
      entries.push({
        relativePath,
        kind: "symlink",
        mode: metadata.mode & 0o777,
        bytes: Buffer.from(target),
      });
      return;
    }
    if (metadata.isFile()) {
      const capture = await captureRegularFile(
        absolutePath,
        relativePath,
      );
      entries.push({
        relativePath,
        kind: "file",
        mode: capture.metadata.mode & 0o777,
        bytes: capture.bytes,
      });
      return;
    }
    if (!metadata.isDirectory()) return;
    entries.push({
      relativePath: relativePath || ".",
      kind: "directory",
      mode: metadata.mode & 0o777,
      bytes: Buffer.alloc(0),
    });
    for (const name of await readdir(absolutePath)) {
      await walk(base, path.join(relativePath, name));
    }
  }
}

async function captureRepositoryFile(repositoryRoot, relativePath) {
  const absolutePath = path.join(repositoryRoot, relativePath);
  if (!isWithin(repositoryRoot, absolutePath)) {
    fail(`repository path escapes root: ${relativePath}`);
  }
  return captureRegularFile(absolutePath, relativePath);
}

async function captureRegularFile(filePath, label) {
  const handle = await open(
    filePath,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1) {
      fail(`${label} must be a single-link canonical regular file`);
    }
    const bytes = await handle.readFile();
    const [after, leaf, canonicalPath] = await Promise.all([
      handle.stat(),
      lstat(filePath),
      realpath(filePath),
    ]);
    if (
      !after.isFile()
      || after.dev !== before.dev
      || after.ino !== before.ino
      || after.size !== before.size
      || after.mtimeMs !== before.mtimeMs
      || after.ctimeMs !== before.ctimeMs
      || !leaf.isFile()
      || leaf.isSymbolicLink()
      || leaf.dev !== before.dev
      || leaf.ino !== before.ino
      || canonicalPath !== filePath
    ) {
      fail(`${label} identity changed while reading`);
    }
    return { bytes, metadata: after, digest: sha256(bytes) };
  } finally {
    await handle.close();
  }
}

async function run(command, args, cwd, env = process.env) {
  await verifyCommandIdentity(command, args, cwd);
  allowedExecutionMutationPrefixes = Object.freeze(
    expectedCommandMutationPrefixes(args, cwd),
  );
  const sandboxed = command !== "/usr/bin/sandbox-exec";
  const sandboxProfile =
    args[0] === executionNpmCliPath
      && args[1] === "audit"
      && args[2] === "--omit=dev"
      && args.length === 3
      ? auditSandboxProfile
      : requiresElectronSandbox(command, args)
        ? electronSandboxProfile
      : isWithin(repositoryRealpath, cwd)
        ? repositoryCheckSandboxProfile
      : commandSandboxProfile;
  const executionCommand = sandboxed ? "/usr/bin/sandbox-exec" : command;
  const executionArgs = sandboxed
    ? ["-f", sandboxProfile, command, ...args]
    : args;
  let commandError = null;
  try {
    const result = await execOwnedFile(executionCommand, executionArgs, {
      cwd,
      env,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: 15 * 60 * 1000,
    });
    assertCommandOutputDoesNotExposeEnvironmentSecrets(
      result.stdout,
      result.stderr,
      env,
    );
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
  } catch (error) {
    commandError = error;
    try {
      assertCommandOutputDoesNotExposeEnvironmentSecrets(
        error.stdout,
        error.stderr,
        env,
      );
      process.stdout.write(error.stdout ?? "");
      process.stderr.write(error.stderr ?? "");
    } catch (outputError) {
      commandError = outputError;
    }
  }
  let postflightError = null;
  try {
    await new Promise((resolve) => setTimeout(resolve, 50));
  } catch (error) {
    postflightError = error;
  } finally {
    allowedExecutionMutationPrefixes = Object.freeze([]);
  }
  try {
    await verifyCommandIdentity(command, args, cwd);
  } catch (error) {
    postflightError ??= error;
  }
  throwCommandOrPostflightFailure(commandError, postflightError);
}

function execOwnedFile(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let spawnError = null;
    let timedOut = false;
    let outputExceeded = false;
    let settled = false;
    const append = (chunks, chunk, stream) => {
      const bytes = Buffer.from(chunk);
      if (stream === "stdout") stdoutBytes += bytes.length;
      else stderrBytes += bytes.length;
      if (stdoutBytes + stderrBytes > options.maxBuffer) {
        outputExceeded = true;
        terminateOwnedProcessGroup(child.pid);
        return;
      }
      chunks.push(bytes);
    };
    child.stdout.on("data", (chunk) => append(stdout, chunk, "stdout"));
    child.stderr.on("data", (chunk) => append(stderr, chunk, "stderr"));
    const timeout = setTimeout(() => {
      timedOut = true;
      terminateOwnedProcessGroup(child.pid);
    }, options.timeout);
    child.once("error", (error) => {
      spawnError = error;
    });
    child.once("close", (code, signal) => {
      void finish(code, signal);
    });

    async function finish(code, signal) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      await drainOwnedProcessGroup(child.pid);
      const result = {
        stdout: Buffer.concat(stdout).toString(options.encoding),
        stderr: Buffer.concat(stderr).toString(options.encoding),
      };
      if (
        !spawnError
        && !timedOut
        && !outputExceeded
        && code === 0
        && !signal
      ) {
        resolve(result);
        return;
      }
      const error = spawnError ?? new Error(
        timedOut
          ? `command timed out after ${options.timeout} ms`
          : outputExceeded
            ? `command output exceeded ${options.maxBuffer} bytes`
            : `command failed with status ${code ?? "unknown"}${
              signal ? ` and signal ${signal}` : ""
            }`,
      );
      Object.assign(error, {
        ...result,
        code: timedOut ? "ETIMEDOUT" : code,
        signal,
        killed: timedOut || outputExceeded,
      });
      reject(error);
    }
  });
}

async function drainOwnedProcessGroup(pid) {
  if (!pid || !processGroupAlive(pid)) return;
  terminateOwnedProcessGroup(pid, "SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (processGroupAlive(pid)) {
    terminateOwnedProcessGroup(pid, "SIGKILL");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (processGroupAlive(pid)) {
    fail(`candidate command process group ${pid} survived cleanup`);
  }
}

function terminateOwnedProcessGroup(pid, signal = "SIGTERM") {
  if (!pid) return;
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

function processGroupAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

function requiresElectronSandbox(command, args) {
  return (
    (
      args[0] === executionNpmCliPath
      && args[1] === "run"
      && args[2] === "smoke:prod"
    )
    || args[0] === "scripts/run-conversation-disclosure-acceptance.mjs"
    || command.endsWith(
      `${path.sep}Zerox Agent.app${path.sep}Contents${path.sep}MacOS${
        path.sep
      }Zerox Agent`,
    )
  );
}

async function runTrustedSeatbeltRegressionLane(privateRoot) {
  if (TRUSTED_SEATBELT_REQUIREMENTS.length !== 15) {
    fail("trusted Seatbelt requirement roster changed");
  }
  const testRoot = await realpath(await mkdtemp(
    path.join(privateRoot, "trusted-seatbelt-"),
  ));
  const workspace = path.join(testRoot, "workspace");
  const declaredRead = path.join(testRoot, "declared-read");
  const outside = path.join(testRoot, "outside");
  const privateTempA = path.join(testRoot, "private-a");
  const privateTempB = path.join(testRoot, "private-b");
  const electronTemp = path.join(testRoot, "electron-temp");
  const electronScopedDirectory = path.join(
    electronTemp,
    `scoped_dir-${randomUUID()}`,
  );
  const electronSibling = path.join(electronTemp, "unrelated.txt");
  const profilePath = path.join(testRoot, "workspace.sb");
  const readOnlyProfilePath = path.join(testRoot, "read-only.sb");
  const electronProfilePath = path.join(testRoot, "electron.sb");
  const trustedNodePath = await realpath(process.execPath);
  const outsideFile = path.join(outside, "outside.txt");
  const privateBFile = path.join(privateTempB, "private.txt");
  const environment = {
    HOME: workspace,
    LANG: "en_US.UTF-8",
    PATH: "/usr/bin:/bin",
    SHELL: "/bin/sh",
    TMPDIR: privateTempA,
  };
  try {
    await Promise.all([
      mkdir(workspace, { recursive: true, mode: 0o700 }),
      mkdir(declaredRead, { recursive: true, mode: 0o700 }),
      mkdir(outside, { recursive: true, mode: 0o700 }),
      mkdir(privateTempA, { recursive: true, mode: 0o700 }),
      mkdir(privateTempB, { recursive: true, mode: 0o700 }),
      mkdir(electronScopedDirectory, { recursive: true, mode: 0o700 }),
    ]);
    await Promise.all([
      writePrivateFile(
        path.join(declaredRead, "declared.txt"),
        Buffer.from("declared"),
      ),
      writePrivateFile(outsideFile, Buffer.from("outside")),
      writePrivateFile(privateBFile, Buffer.from("private")),
      writePrivateFile(
        path.join(electronScopedDirectory, "allowed.txt"),
        Buffer.from("allowed"),
      ),
      writePrivateFile(electronSibling, Buffer.from("unrelated")),
    ]);
    await symlink(outsideFile, path.join(workspace, "escape"));
    const runtimeRoot = path.dirname(path.dirname(trustedNodePath));
    await Promise.all([
      writePrivateFile(
        profilePath,
        Buffer.from(buildAcceptanceSandboxProfile({
          readableRoots: [
            workspace,
            declaredRead,
            privateTempA,
            runtimeRoot,
            ...SYSTEM_SANDBOX_READ_ROOTS,
          ],
          metadataRoots: [testRoot],
          writableRoots: [workspace, privateTempA],
          network: false,
        })),
      ),
      writePrivateFile(
        readOnlyProfilePath,
        Buffer.from(buildAcceptanceSandboxProfile({
          readableRoots: [
            workspace,
            declaredRead,
            privateTempA,
            runtimeRoot,
            ...SYSTEM_SANDBOX_READ_ROOTS,
          ],
          metadataRoots: [testRoot],
          writableRoots: [privateTempA],
          network: false,
        })),
      ),
      writePrivateFile(
        electronProfilePath,
        Buffer.from(buildAcceptanceSandboxProfile({
          readableRoots: [
            workspace,
            privateTempA,
            runtimeRoot,
            ...SYSTEM_SANDBOX_READ_ROOTS,
          ],
          readablePrefixes: [
            path.join(electronTemp, "scoped_dir"),
          ],
          metadataRoots: [],
          writableRoots: [workspace, privateTempA],
          writablePrefixes: [
            path.join(electronTemp, "scoped_dir"),
          ],
          localSocketPrefixes: [path.join(electronTemp, "scoped_dir")],
          network: false,
          allowMach: true,
        })),
      ),
    ]);

    await runTrustedSandboxCommand(
      profilePath,
      "/bin/sh",
      ["-c", `printf inside > ${shellWord(path.join(workspace, "inside.txt"))}`],
      workspace,
      environment,
    );
    await runTrustedSandboxCommand(
      profilePath,
      "/bin/cat",
      [path.join(declaredRead, "declared.txt")],
      workspace,
      environment,
    );
    await expectTrustedSandboxDenial(
      () => runTrustedSandboxCommand(
        profilePath,
        "/bin/sh",
        ["-c", `printf denied > ${shellWord(path.join(outside, "denied.txt"))}`],
        workspace,
        environment,
      ),
      "adjacent write",
    );
    await expectTrustedSandboxDenial(
      () => runTrustedSandboxCommand(
        profilePath,
        "/bin/sh",
        ["-c", `printf denied > ${shellWord(path.join(workspace, "escape"))}`],
        workspace,
        environment,
      ),
      "symlink write",
    );
    await expectTrustedSandboxDenial(
      () => runTrustedSandboxCommand(
        profilePath,
        "/bin/cat",
        [outsideFile],
        workspace,
        environment,
      ),
      "adjacent read",
    );
    await expectTrustedSandboxDenial(
      () => runTrustedSandboxCommand(
        profilePath,
        "/bin/cat",
        [privateBFile],
        workspace,
        environment,
      ),
      "private temp isolation",
    );
    await runTrustedSandboxCommand(
      electronProfilePath,
      trustedNodePath,
      [
        "-e",
        "require('node:fs').lstatSync(process.argv[1])",
        path.join(electronScopedDirectory, "allowed.txt"),
      ],
      workspace,
      environment,
    );
    await expectTrustedSandboxDenial(
      () => runTrustedSandboxCommand(
        electronProfilePath,
        trustedNodePath,
        [
          "-e",
          "require('node:fs').lstatSync(process.argv[1])",
          electronSibling,
        ],
        workspace,
        environment,
      ),
      "Electron sibling metadata",
    );
    await expectTrustedSandboxDenial(
      () => runTrustedSandboxCommand(
        readOnlyProfilePath,
        "/bin/sh",
        ["-c", `printf denied > ${shellWord(path.join(workspace, "read-only.txt"))}`],
        workspace,
        environment,
      ),
      "read-only write",
    );
    await runTrustedSandboxCommand(
      profilePath,
      trustedNodePath,
      [
        "-e",
        "const net=require('node:net');"
          + "const s=net.connect(9,'127.0.0.1');"
          + "s.on('error',e=>process.exit(e.code==='EPERM'?0:2));"
          + "setTimeout(()=>process.exit(3),500);",
      ],
      workspace,
      environment,
    );
    let timedOut = false;
    try {
      await runTrustedSandboxCommand(
        profilePath,
        "/bin/sleep",
        ["5"],
        workspace,
        environment,
        50,
      );
    } catch (error) {
      timedOut = error?.killed === true || error?.code === "ETIMEDOUT";
    }
    if (!timedOut) {
      fail("trusted Seatbelt timeout termination did not fire");
    }
    console.log(JSON.stringify({
      trustedSeatbeltRegression: "passed",
      requirementCount: TRUSTED_SEATBELT_REQUIREMENTS.length,
    }));
  } finally {
    await rm(testRoot, { recursive: true, force: true });
  }
  if (await optionalLstat(testRoot)) {
    fail("trusted Seatbelt regression cleanup failed");
  }
}

async function runTrustedSandboxCommand(
  profilePath,
  command,
  args,
  cwd,
  env,
  timeout = 5_000,
) {
  return execFile(
    "/usr/bin/sandbox-exec",
    ["-f", profilePath, command, ...args],
    {
      cwd,
      env,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      timeout,
    },
  );
}

async function expectTrustedSandboxDenial(action, label) {
  try {
    await action();
  } catch {
    return;
  }
  fail(`trusted Seatbelt probe did not deny ${label}`);
}

async function readCommandOutput(command, args, cwd) {
  const result = await execFile(command, args, {
    cwd,
    env: {
      HOME: process.env.HOME,
      LANG: process.env.LANG ?? "en_US.UTF-8",
      PATH: "/usr/bin:/bin",
    },
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  return result.stdout;
}

async function verifyCommandIdentity(command, args, cwd) {
  if (executionMutation) {
    fail(`private execution source mutated during acceptance: ${executionMutation}`);
  }
  if (command === nodePath) {
    const currentNode = await captureRegularFile(nodePath, "Node executable");
    if (currentNode.digest !== nodeCapture.digest) {
      fail("Node executable changed at a subprocess boundary");
    }
  }
  if (args[0] === npmCliPath || args[0] === executionNpmCliPath) {
    const currentNpmCli = await captureRegularFile(args[0], "npm CLI");
    if (currentNpmCli.digest !== npmCliCapture.digest) {
      fail("npm CLI changed at a subprocess boundary");
    }
  }
  await verifyPinnedMacosToolchainFiles(macosCompiler);
  await verifyNativeNodeAddon(
    isWithin(executionRoot, cwd) ? executionRoot : repositoryRealpath,
  );
  if (isWithin(executionRoot, cwd)) {
    await verifyGeneratedNativeCache();
    await verifySourceManifest(executionRoot, options);
    await verifyToolchain(executionRoot);
    await captureExecutionGeneratedState(executionRoot);
  }
}

function parseOptions(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || !value || values.has(key)) {
      fail("acceptance runner requires unique --key value arguments");
    }
    values.set(key, value);
  }
  const required = [
    "--repository",
    "--expected-runner-digest",
    "--expected-node-digest",
    "--npm-cli",
    "--expected-npm-cli-digest",
    "--electron-cache-archive",
    "--expected-electron-cache-digest",
    "--electron-headers-archive",
    "--expected-electron-headers-digest",
    "--expected-code-review-agent-id",
    "--expected-code-review-challenge",
    "--expected-code-review-receipt-digest",
    "--expected-security-review-agent-id",
    "--expected-security-review-challenge",
    "--expected-security-review-receipt-digest",
    "--expected-source-digest",
    "--expected-source-file-count",
    "--expected-git-head",
    "--expected-git-tree",
    "--cd04-anchor",
    "--output",
  ];
  for (const key of required) {
    if (!values.has(key)) fail(`missing required option ${key}`);
  }
  for (const key of values.keys()) {
    if (!required.includes(key)) fail(`unknown option ${key}`);
  }
  for (const key of [
    "--repository",
    "--npm-cli",
    "--electron-cache-archive",
    "--electron-headers-archive",
    "--cd04-anchor",
    "--output",
  ]) {
    if (!path.isAbsolute(values.get(key))) fail(`${key} must be absolute`);
  }
  const expectedSourceFileCount = Number(
    values.get("--expected-source-file-count"),
  );
  if (!Number.isInteger(expectedSourceFileCount) || expectedSourceFileCount <= 0) {
    fail("--expected-source-file-count must be a positive integer");
  }
  return {
    repository: values.get("--repository"),
    expectedRunnerDigest: values.get("--expected-runner-digest"),
    expectedNodeDigest: values.get("--expected-node-digest"),
    npmCli: values.get("--npm-cli"),
    expectedNpmCliDigest: values.get("--expected-npm-cli-digest"),
    electronCacheArchive: values.get("--electron-cache-archive"),
    expectedElectronCacheDigest:
      values.get("--expected-electron-cache-digest"),
    electronHeadersArchive: values.get("--electron-headers-archive"),
    expectedElectronHeadersDigest:
      values.get("--expected-electron-headers-digest"),
    expectedCodeReviewAgentId:
      values.get("--expected-code-review-agent-id"),
    expectedCodeReviewChallenge:
      values.get("--expected-code-review-challenge"),
    expectedCodeReviewReceiptDigest:
      values.get("--expected-code-review-receipt-digest"),
    expectedSecurityReviewAgentId:
      values.get("--expected-security-review-agent-id"),
    expectedSecurityReviewChallenge:
      values.get("--expected-security-review-challenge"),
    expectedSecurityReviewReceiptDigest:
      values.get("--expected-security-review-receipt-digest"),
    expectedSourceDigest: values.get("--expected-source-digest"),
    expectedSourceFileCount,
    expectedGitHead: values.get("--expected-git-head"),
    expectedGitTree: values.get("--expected-git-tree"),
    cd04Anchor: values.get("--cd04-anchor"),
    output: values.get("--output"),
  };
}

function assertOutsideRepository(candidate, repositoryRoot, label) {
  if (isWithin(repositoryRoot, path.resolve(candidate))) {
    fail(`${label} must remain outside the repository`);
  }
}

function assertGitObjectId(value, label) {
  if (!/^[0-9a-f]{40}$/.test(value ?? "")) {
    fail(`${label} must be a lowercase 40-character object id`);
  }
}

function shellWord(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function isGeneratedOrPlanningPath(relativePath) {
  return relativePath.startsWith("release-local/")
    || relativePath.startsWith("release/")
    || relativePath.startsWith("release-test-")
    || isGeneratedBuildPath(relativePath)
    || relativePath.startsWith(".zerox/")
    || relativePath === "task_plan.md"
    || relativePath === "findings.md"
    || relativePath === "progress.md";
}

function isAcceptanceInputExcluded(relativePath) {
  if (
    relativePath.startsWith("release-local/")
    || relativePath.startsWith("release/")
    || relativePath.startsWith("release-test-")
    || isGeneratedBuildPath(relativePath)
  ) {
    return true;
  }
  if (LIFECYCLE_PUBLICATION_FILES.includes(relativePath)) {
    return true;
  }
  if (!relativePath.startsWith(
    ".zerox/verification/conversation-disclosure/",
  )) {
    return false;
  }
  if (relativePath.startsWith(
    ".zerox/verification/conversation-disclosure/CD09-scenarios/",
  )) {
    return true;
  }
  const name = path.basename(relativePath);
  return name.startsWith("CD05-chat-browser")
    || name.startsWith("CD06-cross-surface")
    || name.startsWith("CD07-inspector")
    || name === "CD08-hardening.json"
    || name === "CD08-full-gates.md"
    || name.startsWith("CD09-");
}

function normalizeWatchRelativePath(filename) {
  if (filename === null || filename === undefined) return "";
  const value = String(filename).replaceAll("/", path.sep);
  if (!value || path.isAbsolute(value)) return "";
  const normalized = path.normalize(value);
  if (
    normalized === "."
    || normalized === ".."
    || normalized.startsWith(`..${path.sep}`)
  ) {
    return "";
  }
  return normalized;
}

function isGeneratedBuildPath(relativePath) {
  return GENERATED_BUILD_DIRECTORIES.some((directory) =>
    relativePath === directory
    || relativePath.startsWith(`${directory}${path.sep}`),
  );
}

function verifyGeneratedBuildBoundarySelfTest() {
  for (const directory of GENERATED_BUILD_DIRECTORIES) {
    for (const relativePath of [
      directory,
      path.join(directory, "self-test-artifact"),
    ]) {
      if (
        !isGeneratedBuildPath(relativePath)
        || !isGeneratedOrPlanningPath(relativePath)
        || !isAcceptanceInputExcluded(relativePath)
        || !isAllowedExecutionMutation(
          relativePath,
          GENERATED_BUILD_DIRECTORIES,
        )
      ) {
        fail(`generated build boundary is inconsistent: ${relativePath}`);
      }
    }
  }
  console.log(JSON.stringify({
    generatedBuildBoundarySelfTest: "passed",
    directories: GENERATED_BUILD_DIRECTORIES,
  }));
}

function isAllowedExecutionMutation(relativePath, allowedPrefixes) {
  return allowedPrefixes.some((prefix) =>
    relativePath === prefix
    || relativePath.startsWith(`${prefix}${path.sep}`)
    // A directory-level event on an ancestor of an allowed generated file
    // (e.g. creating ".zerox/verification/conversation-disclosure/CD09-scenarios"
    // before writing its children) is an expected side effect of producing
    // that allowed output, so treat allowed-prefix ancestors as allowed too.
    || prefix.startsWith(`${relativePath}${path.sep}`),
  );
}

function isAllowedRepositoryMutation(relativePath, mode) {
  const cleanupPath = relativePath.startsWith("release-test-v392-publish-")
    || relativePath.startsWith("release-test-v392-rollback-");
  // Publish-machinery scratch directories are sanctioned in EVERY mode,
  // including "none": their create/delete events are produced by the
  // transactional publish rehearsal itself, and macOS FSEvents can deliver
  // those events after the watch mode has flipped back to "none" (any
  // fixed-length settle remains a race). These paths are excluded from every
  // manifest, and the runner only ever consumes the single rollback dir it
  // created itself, so allowing them here cannot mask tampering with
  // attested inputs. (B11: postflight false positive on a late-delivered
  // rollback-dir event.)
  if (cleanupPath) return true;
  if (mode === "cleanup") return false;
  return false
    // Atomic generated-file publish stages through a sibling temporary file
    // named .zerox-publish-<pid>-<uuid> in the destination directory (see
    // replaceFileAtomically); its create/write/rename events are part of the
    // sanctioned publication writes.
    || path.basename(relativePath).startsWith(".zerox-publish-")
    || relativePath === "release-local"
    || relativePath.startsWith(`release-local${path.sep}`)
    || relativePath === ".zerox"
    || relativePath === path.join(".zerox", "verification")
    || relativePath === path.join(
      ".zerox",
      "verification",
      "conversation-disclosure",
    )
    || GENERATED_PUBLICATION_FILES.some((entry) =>
      relativePath === entry
      || entry.startsWith(`${relativePath}${path.sep}`)
    );
}

function expectedCommandMutationPrefixes(args, cwd) {
  if (!isWithin(executionRoot, cwd)) return [];
  const prefixes = [];
  const joined = args.join("\0");
  if (
    joined.includes("\0run\0verify")
    || joined.includes("\0run\0smoke:prod")
    || args[0] === "scripts/run-conversation-disclosure-acceptance.mjs"
    || args[0] === "scripts/package-local-candidate.mjs"
  ) {
    prefixes.push(...GENERATED_BUILD_DIRECTORIES, "node_modules/.vite");
  }
  if (commandMutatesNativeAddon(args, cwd)) {
    prefixes.push(
      "node_modules/better-sqlite3/build",
      GENERATED_NATIVE_CACHE_PATH,
    );
  }
  if (args[0] === "scripts/run-conversation-disclosure-acceptance.mjs") {
    prefixes.push(...GENERATED_PUBLICATION_FILES);
    // Real-app scenarios exercise the PlanStore, which atomically writes
    // (.tmp + rename) transient plan state under .zerox/plans. That directory
    // is git-ignored ephemeral runtime scratch (excluded from the source
    // manifest and never published), so its live watcher events are expected.
    prefixes.push(".zerox/plans");
  }
  if (args[0] === "scripts/package-local-candidate.mjs") {
    prefixes.push(
      "release-local",
      ".zerox/verification/conversation-disclosure/CD09-local-package.json",
    );
  }
  return [...new Set(prefixes.map((entry) => path.normalize(entry)))];
}

function commandMutatesNativeAddon(args, cwd) {
  if (!isWithin(executionRoot, cwd)) return false;
  const joined = args.join("\0");
  return joined.includes("\0run\0smoke:prod")
    || args[0] === "scripts/run-conversation-disclosure-acceptance.mjs"
    || args[0] === "scripts/package-local-candidate.mjs";
}

async function verifyGeneratedNativeCache() {
  const metadata = await optionalLstat(nativeCachePath);
  if (!metadata) return;
  if (
    metadata.isSymbolicLink()
    || !metadata.isDirectory()
    || await realpath(nativeCachePath) !== nativeCachePath
  ) {
    fail("generated native ABI cache must be a canonical directory");
  }
  const cache = await computeTreeManifest(nativeCachePath);
  if (
    cache.digest !== EXPECTED_GENERATED_NATIVE_CACHE.digest
    || cache.entryCount !== EXPECTED_GENERATED_NATIVE_CACHE.entryCount
  ) {
    fail("generated native ABI cache differs from the caller-reviewed output");
  }
}

function throwCommandOrPostflightFailure(commandError, postflightError) {
  if (commandError && postflightError) {
    throw new AggregateError(
      [commandError, postflightError],
      "candidate command failed and postflight cleanup also failed",
      { cause: commandError },
    );
  }
  if (commandError) throw commandError;
  if (postflightError) throw postflightError;
}

function verifyCommandFailurePreservationSelfTest() {
  const commandError = new Error("self-test command failure");
  const postflightError = new Error("self-test postflight failure");
  let combined = null;
  try {
    throwCommandOrPostflightFailure(commandError, postflightError);
  } catch (error) {
    combined = error;
  }
  if (
    !(combined instanceof AggregateError)
    || combined.cause !== commandError
    || combined.errors?.[0] !== commandError
    || combined.errors?.[1] !== postflightError
  ) {
    fail("candidate command primary failure was not preserved");
  }
  for (const error of [commandError, postflightError]) {
    let observed = null;
    try {
      throwCommandOrPostflightFailure(
        error === commandError ? commandError : null,
        error === postflightError ? postflightError : null,
      );
    } catch (caught) {
      observed = caught;
    }
    if (observed !== error) {
      fail("single command or postflight failure identity was not preserved");
    }
  }
}

async function verifyOwnedCommandDrainSelfTest(testRoot) {
  const marker = path.join(testRoot, "detached-child-marker");
  await execOwnedFile(
    "/bin/sh",
    [
      "-c",
      `(sleep 1; printf escaped > ${shellWord(marker)}) >/dev/null 2>&1 &`,
    ],
    {
      cwd: testRoot,
      env: { PATH: "/usr/bin:/bin" },
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      timeout: 5_000,
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 1_200));
  if (await optionalLstat(marker)) {
    fail("owned command left a detached child after completion");
  }
}

async function captureExecutionGeneratedState(repositoryRoot) {
  const entries = [];
  for (const relativePath of GENERATED_PUBLICATION_FILES) {
    const capture = await captureOptionalRegularFile(
      path.join(repositoryRoot, relativePath),
      `generated execution evidence ${relativePath}`,
    );
    entries.push({
      relativePath,
      digest: capture?.digest ?? null,
    });
  }
  for (const relativePath of [
    ...GENERATED_BUILD_DIRECTORIES,
    "release-local",
  ]) {
    const absolutePath = path.join(repositoryRoot, relativePath);
    const metadata = await optionalLstat(absolutePath);
    entries.push({
      relativePath,
      tree: metadata
        ? await computeTreeManifest(absolutePath)
        : null,
    });
  }
  return hashCanonical(entries);
}

function rejectPreloadEnvironment() {
  const prohibited = [
    "NODE_OPTIONS",
    "NODE_PATH",
    "ELECTRON_RUN_AS_NODE",
    "ELECTRON_RENDERER_URL",
    "NPM_CONFIG_SCRIPT_SHELL",
  ];
  for (const name of prohibited) {
    if (
      Object.entries(process.env).some(
        ([key, value]) => key.toUpperCase() === name && value,
      )
    ) {
      fail(`external acceptance runner rejects inherited ${name}`);
    }
  }
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (
    relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

function hashCanonical(value) {
  return sha256(Buffer.from(canonicalJson(value)));
}

function completedAnchorBytes(anchor) {
  return Buffer.from(`${JSON.stringify(anchor, null, 2)}\n`);
}

function canonicalJson(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    fail("canonical JSON rejects non-finite numbers");
  }
  return JSON.stringify(value);
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function assertDigest(value, label) {
  if (!/^sha256:[0-9a-f]{64}$/.test(value ?? "")) {
    fail(`${label} must be SHA-256`);
  }
}

function fail(message) {
  throw new Error(message);
}
