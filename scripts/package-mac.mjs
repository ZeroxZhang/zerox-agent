import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, closeSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openPinnedSafeFsHelperCapability } from "./inspect-safe-fs-helper.mjs";
import { EXPECTED_SAFE_FS_HELPER_DIGEST } from "./safe-fs-toolchain-selection.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const targets = process.argv.slice(2);
const requestedReleaseMode = process.env.ZEROX_RELEASE_MODE?.trim() ?? "";
const releaseMode = requestedReleaseMode || "developer-id";

if (targets.length === 0) {
  console.error("Usage: node scripts/package-mac.mjs <electron-builder target...>");
  process.exit(1);
}

if (releaseMode !== "developer-id" && releaseMode !== "legacy-adhoc") {
  console.error(
    "ZEROX_RELEASE_MODE must be unset, developer-id, or legacy-adhoc.",
  );
  process.exit(1);
}

const isWindows = process.platform === "win32";
const npmBin = isWindows ? "npm.cmd" : "npm";
const gitBin = "/usr/bin/git";
const binSuffix = isWindows ? ".cmd" : "";
const electronRebuildBin = resolve(
  rootDir,
  "node_modules",
  ".bin",
  `electron-rebuild${binSuffix}`,
);
const electronBuilderBin = resolve(
  rootDir,
  "node_modules",
  ".bin",
  `electron-builder${binSuffix}`,
);
const finalizeMacZipScript = resolve(rootDir, "scripts", "finalize-mac-zip.mjs");

function run(command, args, env = {}, inheritDescriptor) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    env: { ...process.env, ...env },
    stdio: inheritDescriptor === undefined
      ? "inherit"
      : ["ignore", "inherit", "inherit", inheritDescriptor],
  });

  if (result.error) {
    console.error(result.error.message);
    return 1;
  }

  if (result.signal) {
    console.error(`${command} exited with signal ${result.signal}`);
    return 1;
  }

  return result.status ?? 0;
}

function sanitizedGitEnvironment() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_")) delete env[key];
  }
  return env;
}

function readFrozenGitCommit() {
  const env = sanitizedGitEnvironment();
  const commonArgs = [
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.untrackedCache=false",
    "-C",
    rootDir,
  ];
  const commitResult = spawnSync(
    gitBin,
    [...commonArgs, "rev-parse", "--verify", "HEAD^{commit}"],
    { cwd: rootDir, encoding: "utf8", env },
  );
  const commit = commitResult.stdout?.trim() ?? "";
  if (commitResult.status !== 0 || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit)) {
    console.error("Packaging requires a valid frozen Git HEAD commit.");
    return null;
  }

  const statusResult = spawnSync(
    gitBin,
    [...commonArgs, "status", "--porcelain", "--untracked-files=all"],
    { cwd: rootDir, encoding: "utf8", env },
  );
  if (statusResult.status !== 0 || statusResult.stdout.trim().length > 0) {
    console.error("Packaging requires a clean working tree.");
    return null;
  }
  return commit;
}

if (!existsSync(electronRebuildBin) || !existsSync(electronBuilderBin)) {
  console.error("Packaging requires local electron-rebuild and electron-builder binaries.");
  process.exit(1);
}

const frozenCommit = readFrozenGitCommit();
if (!frozenCommit) {
  process.exit(1);
}

let status = run(npmBin, ["run", "build"]);

if (status === 0) {
  status = run(electronRebuildBin, ["-f", "-w", "better-sqlite3"]);
}

if (status === 0) {
  const currentCommit = readFrozenGitCommit();
  if (currentCommit !== frozenCommit) {
    console.error("Git HEAD or working tree changed while packaging; refusing stale artifacts.");
    status = 1;
  }
}

if (status === 0) {
  // Overlay the caller-reviewed unsigned helper bytes so release packaging
  // never depends on the host compiler reproducing the pinned digest (CI
  // runners use a different CommandLineTools/SDK than the acceptance host).
  const helperPath = resolve(rootDir, `dist-native/darwin-${process.arch}/zerox-safe-fs`);
  const pinnedHelperPath = resolve(rootDir, `native/zerox-safe-fs-darwin-${process.arch}`);
  try {
    const pinnedBytes = readFileSync(pinnedHelperPath);
    const digest = `sha256:${createHash("sha256").update(pinnedBytes).digest("hex")}`;
    if (digest !== EXPECTED_SAFE_FS_HELPER_DIGEST) {
      throw new Error("pinned safe-fs helper digest mismatch");
    }
    writeFileSync(helperPath, pinnedBytes);
    chmodSync(helperPath, 0o755);
  } catch (error) {
    console.error(`Failed to stage the caller-reviewed safe-fs helper: ${error instanceof Error ? error.message : String(error)}`);
    status = 1;
  }
}

if (status === 0) {
  const safeFsCapability = openPinnedSafeFsHelperCapability(
    resolve(rootDir, `dist-native/darwin-${process.arch}/zerox-safe-fs`),
    { safeFsHelperDigest: EXPECTED_SAFE_FS_HELPER_DIGEST },
  );
  const builderArgs = [
    "--mac",
    ...targets,
    "--publish",
    "never",
    `--config.extraMetadata.buildCommit=${frozenCommit}`,
    `--config.extraMetadata.releaseMode=${releaseMode}`,
    ...(releaseMode === "legacy-adhoc"
      ? [
          "--config.mac.identity=-",
          "--config.mac.hardenedRuntime=false",
          "--config.mac.notarize=false",
        ]
      : []),
  ];
  try {
    status = run(
      electronBuilderBin,
      builderArgs,
      {
        ...(releaseMode === "legacy-adhoc"
          ? { CSC_IDENTITY_AUTO_DISCOVERY: "false" }
          : {}),
        ZEROX_SAFE_FS_SOURCE: relative(rootDir, "/dev/fd/3"),
      },
      safeFsCapability.descriptor,
    );
  } finally {
    closeSync(safeFsCapability.descriptor);
  }
}

if (status === 0 && targets.includes("zip")) {
  // electron-builder 26's 7-Zip archive path dereferences macOS framework
  // symlinks, invalidating the signed bundle. ditto preserves the exact app
  // topology expected by macOS and Squirrel.Mac.
  status = run(process.execPath, [finalizeMacZipScript]);
}

if (status === 0) {
  const finalCommit = readFrozenGitCommit();
  if (finalCommit !== frozenCommit) {
    console.error("Git HEAD or working tree changed during artifact creation; refusing artifacts.");
    status = 1;
  }
}

const restoreStatus = run(npmBin, ["rebuild", "better-sqlite3"]);
process.exit(status === 0 ? restoreStatus : status);
