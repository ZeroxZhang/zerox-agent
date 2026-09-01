#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { listPackage } from "@electron/asar";
import {
  computeLocalCandidateSourceManifest,
  computeTreeManifest,
} from "./local-candidate-source-manifest.mjs";
import {
  assertUnchangedUnsignedSafeFsHelper,
  inspectSafeFsHelper,
  inspectPinnedUnsignedSafeFsHelper,
  openPinnedSafeFsHelperCapability,
} from "./inspect-safe-fs-helper.mjs";
import { loadPinnedSafeFsToolchainPolicy } from "./safe-fs-toolchain-selection.mjs";

if (process.argv.includes("--self-test-failure-preservation")) {
  verifyFailurePreservationSelfTest();
  console.log(JSON.stringify({ failurePreservationSelfTest: "passed" }));
  process.exit(0);
}

const root = process.cwd();
const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
if (packageJson.version !== "3.9.2") {
  throw new Error("local candidate packaging requires package version 3.9.2");
}
const npmCliInput =
  process.env.ZEROX_LOCAL_CANDIDATE_NPM_CLI
  ?? process.env.npm_execpath;
if (!path.isAbsolute(npmCliInput ?? "")) {
  throw new Error("local candidate packaging requires an absolute npm CLI path");
}
const npmCli = realpathSync(npmCliInput);
const npmCliMetadata = lstatSync(npmCli);
if (!npmCliMetadata.isFile() || npmCliMetadata.isSymbolicLink()) {
  throw new Error("local candidate npm CLI must be a canonical regular file");
}
const npmCliDigest =
  `sha256:${createHash("sha256").update(readFileSync(npmCli)).digest("hex")}`;
const expectedNpmCliDigest =
  process.env.ZEROX_LOCAL_CANDIDATE_NPM_CLI_DIGEST;
const expectedGeneratedNativeCache = Object.freeze({
  digest:
    "sha256:b7f4e84fa1ea2aa002c607f0a9460387d2822918a88492c6a7a7f3111238e4ae",
  entryCount: 3,
});
if (
  expectedNpmCliDigest
  && npmCliDigest !== expectedNpmCliDigest
) {
  throw new Error("local candidate npm CLI digest does not match the caller pin");
}

async function run(command, args, options = {}) {
  await verifyExecutionInputs({
    checkNativeCache: options.checkNativeCacheBefore !== false,
    requireNativeCache: options.requireNativeCacheBefore === true,
  });
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: options.inheritDescriptor === undefined
      ? options.capture ? "pipe" : "inherit"
      : ["ignore", "inherit", "inherit", options.inheritDescriptor],
    env: { ...process.env, ...options.env },
  });
  const commandError = result.error
    ?? (
      result.status === 0 && !result.signal
        ? null
        : new Error(
          result.signal
            ? `${command} failed with signal ${result.signal}`
            : `${command} failed with status ${result.status}`,
        )
    );
  let postflightError = null;
  try {
    await verifyExecutionInputs({
      checkNativeCache: options.checkNativeCacheAfter !== false,
      requireNativeCache: options.requireNativeCacheAfter === true,
    });
  } catch (error) {
    postflightError = error;
  }
  throwCommandOrPostflightFailure(commandError, postflightError);
  return result.stdout ?? "";
}

const sourceManifest = await computeLocalCandidateSourceManifest(root);
const sourceDigest = sourceManifest.digest;
const safeFsToolchainPolicy = loadPinnedSafeFsToolchainPolicy(root);
const unsignedSafeFsHelperPath = path.join(
  root,
  `dist-native/darwin-${process.arch}/zerox-safe-fs`,
);
const callerSafeFsHelperPath =
  process.env.ZEROX_LOCAL_CANDIDATE_SAFE_FS_SOURCE;
if (
  callerSafeFsHelperPath
  && (
    !path.isAbsolute(callerSafeFsHelperPath)
    || callerSafeFsHelperPath === unsignedSafeFsHelperPath
    || callerSafeFsHelperPath.startsWith(`${root}${path.sep}`)
  )
) {
  throw new Error(
    "caller-owned safe-fs helper source must be absolute and outside the candidate",
  );
}

await run(process.execPath, [npmCli, "run", "build"]);
const builtUnsignedSafeFsHelper = inspectPinnedUnsignedSafeFsHelper(
  unsignedSafeFsHelperPath,
  safeFsToolchainPolicy,
);
let packagingError = null;
try {
  await run(path.join(root, "node_modules/.bin/electron-rebuild"), [
    "-f", "-w", "better-sqlite3",
  ], { requireNativeCacheAfter: true });
  const prePackageUnsignedSafeFsHelper = inspectPinnedUnsignedSafeFsHelper(
    unsignedSafeFsHelperPath,
    safeFsToolchainPolicy,
  );
  assertUnchangedUnsignedSafeFsHelper(
    builtUnsignedSafeFsHelper,
    prePackageUnsignedSafeFsHelper,
  );
  const packagingSourcePath =
    callerSafeFsHelperPath ?? unsignedSafeFsHelperPath;
  const safeFsCapability = openPinnedSafeFsHelperCapability(
    packagingSourcePath,
    safeFsToolchainPolicy ?? {
      safeFsHelperDigest: builtUnsignedSafeFsHelper.sha256,
    },
  );
  try {
    await run(path.join(root, "node_modules/.bin/electron-builder"), [
      "--mac", "dir",
      "--publish", "never",
    // Point electron-builder at the already-present, caller-reviewed unpacked
    // Electron distribution so it never invokes @electron/get, which (even on a
    // pre-staged cache hit) fetches SHASUMS256.txt fresh from github and breaks
    // the offline authoritative-anchor packaging gate. selectElectron treats a
    // directory without the default zip as an already-unpacked dist and copies
    // it directly (ElectronFramework.js:183-193) — fully offline.
    `--config.electronDist=${path.join(root, "node_modules/electron/dist")}`,
    "--config.directories.output=release-local",
    `--config.extraMetadata.buildCommit=workspace-${sourceDigest}`,
    "--config.extraMetadata.releaseMode=local-candidate",
    "--config.mac.identity=-",
    "--config.mac.hardenedRuntime=false",
      "--config.mac.notarize=false",
    ], {
      env: {
        CSC_IDENTITY_AUTO_DISCOVERY: "false",
        ZEROX_SAFE_FS_SOURCE: path.relative(root, "/dev/fd/3"),
      },
      inheritDescriptor: safeFsCapability.descriptor,
      requireNativeCacheBefore: true,
      requireNativeCacheAfter: true,
    });
  } finally {
    closeSync(safeFsCapability.descriptor);
  }
  assertUnchangedUnsignedSafeFsHelper(
    builtUnsignedSafeFsHelper,
    inspectPinnedUnsignedSafeFsHelper(
      unsignedSafeFsHelperPath,
      safeFsToolchainPolicy,
    ),
  );
} catch (error) {
  packagingError = error;
}
let restoreError = null;
try {
  // Restore the Node-ABI addon through the same pinned-headers path used by
  // the repo gates. A bare `npm rebuild better-sqlite3` would inherit
  // npm_config_nodedir=<electron headers> from the packaging environment and
  // compile the Node addon against Electron headers, breaking the
  // caller-reviewed Node-ABI binary pin.
  await run(
    process.execPath,
    [path.join(root, "scripts/rebuild-native-sqlite.mjs")],
    { checkNativeCacheBefore: false },
  );
} catch (error) {
  restoreError = error;
}
throwPackageOrRestoreFailure(packagingError, restoreError);

const finalSourceManifest = await computeLocalCandidateSourceManifest(root);
if (
  finalSourceManifest.digest !== sourceManifest.digest
  || finalSourceManifest.fileCount !== sourceManifest.fileCount
) {
  throw new Error("source tree changed while building the local candidate");
}

const appPath = path.join(root, "release-local/mac-arm64/Zerox Agent.app");
const asarPath = path.join(appPath, "Contents/Resources/app.asar");
const unpackedNativeCachePath = path.join(
  appPath,
  "Contents/Resources/app.asar.unpacked/node_modules/better-sqlite3/bin",
);
if (
  existsSync(unpackedNativeCachePath)
  || listPackage(asarPath).some((entry) =>
    entry.replaceAll("\\", "/").includes("/node_modules/better-sqlite3/bin/"))
) {
  throw new Error("local candidate package contains generated native ABI cache");
}
const asar = readFileSync(asarPath);
const appTree = await computeTreeManifest(appPath);
const safeFsHelper = inspectSafeFsHelper(path.join(
  appPath,
  "Contents/Resources/safe-fs/zerox-safe-fs",
), { requireSignature: true });
const receipt = {
  schemaVersion: 1,
  kind: "v3.9.2-local-candidate-package",
  status: "passed",
  version: packageJson.version,
  releaseMode: "local-candidate",
  publish: "never",
  npmCliSha256: npmCliDigest,
  sourceDigest,
  sourceFileCount: sourceManifest.fileCount,
  appPath: path.relative(root, appPath),
  appAsarBytes: statSync(asarPath).size,
  appAsarSha256: `sha256:${createHash("sha256").update(asar).digest("hex")}`,
  appTreeEntryCount: appTree.entryCount,
  appTreeSha256: appTree.digest,
  safeFsHelper: {
    ...safeFsHelper,
    path: path.relative(root, safeFsHelper.path),
  },
};
writeFileSync(
  path.join(
    root,
    ".zerox/verification/conversation-disclosure/CD09-local-package.json",
  ),
  `${JSON.stringify(receipt, null, 2)}\n`,
);
console.log(JSON.stringify(receipt, null, 2));

async function verifyExecutionInputs(options = {}) {
  const expectedNodeDigest =
    process.env.ZEROX_LOCAL_CANDIDATE_NODE_DIGEST;
  const expectedToolchainDigest =
    process.env.ZEROX_LOCAL_CANDIDATE_TOOLCHAIN_DIGEST;
  const expectedToolchainEntryCount = Number(
    process.env.ZEROX_LOCAL_CANDIDATE_TOOLCHAIN_ENTRY_COUNT,
  );
  if (!expectedNodeDigest && !expectedToolchainDigest) return;
  if (
    !/^sha256:[0-9a-f]{64}$/.test(expectedNodeDigest ?? "")
    || !/^sha256:[0-9a-f]{64}$/.test(expectedToolchainDigest ?? "")
    || !Number.isInteger(expectedToolchainEntryCount)
    || expectedToolchainEntryCount <= 0
  ) {
    throw new Error("external package execution pins are incomplete");
  }
  const nodeDigest =
    `sha256:${createHash("sha256").update(readFileSync(process.execPath)).digest("hex")}`;
  const toolchain = await computeTreeManifest(path.join(root, "node_modules"), {
    exclude: (relativePath) =>
      relativePath === ".vite"
      || relativePath.startsWith(`.vite${path.sep}`)
      || relativePath === "better-sqlite3/build"
      || relativePath.startsWith(`better-sqlite3/build${path.sep}`)
      || relativePath === "better-sqlite3/bin"
      || relativePath.startsWith(`better-sqlite3/bin${path.sep}`),
  });
  if (
    nodeDigest !== expectedNodeDigest
    || toolchain.digest !== expectedToolchainDigest
    || toolchain.entryCount !== expectedToolchainEntryCount
  ) {
    throw new Error("external package execution identity changed");
  }
  if (options.checkNativeCache === false) return;
  const nativeCachePath = path.join(
    root,
    "node_modules/better-sqlite3/bin",
  );
  if (!existsSync(nativeCachePath)) {
    if (options.requireNativeCache) {
      throw new Error("generated native ABI cache is missing");
    }
    return;
  }
  const metadata = lstatSync(nativeCachePath);
  if (
    metadata.isSymbolicLink()
    || !metadata.isDirectory()
    || realpathSync(nativeCachePath) !== nativeCachePath
  ) {
    throw new Error("generated native ABI cache must be a canonical directory");
  }
  const nativeCache = await computeTreeManifest(nativeCachePath);
  if (
    nativeCache.digest !== expectedGeneratedNativeCache.digest
    || nativeCache.entryCount !== expectedGeneratedNativeCache.entryCount
  ) {
    throw new Error(
      "generated native ABI cache differs from the caller-reviewed output",
    );
  }
}

function throwCommandOrPostflightFailure(commandError, postflightError) {
  if (commandError && postflightError) {
    throw new AggregateError(
      [commandError, postflightError],
      "local package command failed and its postflight also failed",
      { cause: commandError },
    );
  }
  if (commandError) throw commandError;
  if (postflightError) throw postflightError;
}

function throwPackageOrRestoreFailure(packagingError, restoreError) {
  if (packagingError && restoreError) {
    throw new AggregateError(
      [packagingError, restoreError],
      "local package build failed and Node ABI restoration also failed",
      { cause: packagingError },
    );
  }
  if (packagingError) throw packagingError;
  if (restoreError) throw restoreError;
}

function verifyFailurePreservationSelfTest() {
  const packagingError = new Error("self-test package failure");
  const restoreError = new Error("self-test restore failure");
  const commandError = new Error("self-test command failure");
  const postflightError = new Error("self-test command postflight failure");
  let commandCombined = null;
  try {
    throwCommandOrPostflightFailure(commandError, postflightError);
  } catch (error) {
    commandCombined = error;
  }
  if (
    !(commandCombined instanceof AggregateError)
    || commandCombined.cause !== commandError
    || commandCombined.errors?.[0] !== commandError
    || commandCombined.errors?.[1] !== postflightError
  ) {
    throw new Error("package command failure preservation self-test failed");
  }
  let combined = null;
  try {
    throwPackageOrRestoreFailure(packagingError, restoreError);
  } catch (error) {
    combined = error;
  }
  if (
    !(combined instanceof AggregateError)
    || combined.cause !== packagingError
    || combined.errors?.[0] !== packagingError
    || combined.errors?.[1] !== restoreError
  ) {
    throw new Error("package failure preservation self-test failed");
  }
  for (const error of [packagingError, restoreError]) {
    let observed = null;
    try {
      throwPackageOrRestoreFailure(
        error === packagingError ? packagingError : null,
        error === restoreError ? restoreError : null,
      );
    } catch (caught) {
      observed = caught;
    }
    if (observed !== error) {
      throw new Error("single package failure identity was not preserved");
    }
  }
}
