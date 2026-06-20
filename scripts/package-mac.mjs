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

if (!existsSync(electronRebuildBin) || !existsSync(electronBuilderBin)) {
  console.error("Packaging requires local electron-rebuild and electron-builder binaries.");
  process.exit(1);
}

let status = run(npmBin, ["run", "build"]);

if (status === 0) {
  status = run(electronRebuildBin, ["-f", "-w", "better-sqlite3"]);
}

if (status === 0) {
  status = run(
    electronBuilderBin,
    ["--mac", ...targets],
    { CSC_IDENTITY_AUTO_DISCOVERY: "false" },
  );
}

const restoreStatus = run(npmBin, ["rebuild", "better-sqlite3"]);
process.exit(status === 0 ? restoreStatus : status);
