import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const targets = process.argv.slice(2);

if (targets.length === 0) {
  console.error("Usage: node scripts/package-mac.mjs <electron-builder target...>");
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

function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    env: { ...process.env, ...env },
    stdio: "inherit",
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
  status = run(electronBuilderBin, [
    "--mac",
    `--config.extraMetadata.buildCommit=${frozenCommit}`,
    ...targets,
  ]);
}

const restoreStatus = run(npmBin, ["rebuild", "better-sqlite3"]);
process.exit(status === 0 ? restoreStatus : status);
