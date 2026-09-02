#!/usr/bin/env node
// release-acceptance-preflight — fail-fast, read-only environment check for
// the v3.9.2+ authoritative acceptance. Run BEFORE launching the acceptance
// runner so machine-state problems surface in seconds instead of after a
// 25-minute full run. Mirrors the pinned governance constants; it is a local
// helper and is NOT part of the acceptance proof itself.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRIVATE_ROOT = "/private/tmp/zerox-v392-release";
const PINS = {
  nodeAddon: "sha256:259c51183118091e9b3b7591755ca89873e6d0145e9a0e80a7f68ef428ab6b95",
  electronZip: "sha256:d3ea4e248cdc22f5ac84207b01391bdeb3b52f1b41c8da89738c24d14a12c9a0",
};
const ELECTRON_ZIP = path.join(
  process.env.HOME ?? "/Users/zeorx",
  "Library/Caches/electron/b0f2489e60f367b47fe1b6041d363a40ea0e3c0d17bff7e17803e80374dfeb00/electron-v42.9.0-darwin-arm64.zip",
);

const failures = [];
const warnings = [];
const pass = [];

function fail(msg) { failures.push(msg); }
function warn(msg) { warnings.push(msg); }
function ok(msg) { pass.push(msg); }

function run(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], ...opts });
  } catch (error) {
    if (opts.allowFailure) return "";
    throw error;
  }
}

function sha256(filePath) {
  return "sha256:" + createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function pgrepFound(pattern) {
  try {
    run("/usr/bin/pgrep", ["-f", pattern]);
    return true;
  } catch {
    return false;
  }
}

// 1. clean working tree
const status = run("/usr/bin/git", ["status", "--porcelain", "--untracked-files=all"], { cwd: root });
if (status.trim().length > 0) {
  fail("working tree is not clean; acceptance and packaging require a clean tree");
} else {
  ok("working tree is clean");
}

// 2. no leftover acceptance processes
if (pgrepFound("zerox-v392-release/(execution-|home-|tmp-)") || pgrepFound("build-v392-acceptance-anchor.mjs")) {
  fail("leftover acceptance processes found — kill with: pkill -9 -f 'zerox-v392-release/execution-'");
} else {
  ok("no leftover acceptance processes");
}

// 3. private staging root is clean
if (existsSync(PRIVATE_ROOT)) {
  const leftovers = [];
  for (const entry of readdirSync(PRIVATE_ROOT)) {
    if (/^(execution-|home-|tmp-)/.test(entry) || entry.startsWith(".v392-") || entry.endsWith(".sb") || entry === "v392-acceptance-anchor.json") leftovers.push(entry);
  }
  for (const entry of ["runtime/lib", "runtime/include", "runtime/electron-headers", "runtime/bin/npm"]) {
    if (existsSync(path.join(PRIVATE_ROOT, entry))) leftovers.push(entry);
  }
  if (leftovers.length > 0) {
    fail("private staging has leftovers: " + leftovers.join(", ") + " — clean before launching");
  } else {
    ok("private staging root is clean");
  }
} else {
  ok("private staging root does not exist yet (will be created by the runner)");
}

// 4. IDE git-watcher warning (last-gate .git/index.lock interference)
const idePatterns = ["Trae CN", "Codex Framework", "ChatGPT.app", "Cursor"];
const activeIdes = idePatterns.filter((p) => pgrepFound(p));
if (activeIdes.length > 0) {
  warn("IDEs that may watch this repository are running: " + activeIdes.join(", ") + " — closing them avoids .git/index.lock flakiness at the final gate");
} else {
  ok("no known IDE watchers detected");
}

// 5. Node-ABI native addon matches the caller-reviewed pin
const addonPath = path.join(root, "node_modules/better-sqlite3/build/Release/better_sqlite3.node");
if (!existsSync(addonPath)) {
    fail("better-sqlite3 native addon missing — restore with node-gyp rebuild --release (see runbook)");
} else if (sha256(addonPath) !== PINS.nodeAddon) {
    fail("better-sqlite3 addon digest != caller-reviewed pin (electron rebuild left it dirty?); restore with node-gyp rebuild --release");
} else {
    ok("better-sqlite3 Node-ABI addon matches pin");
}

// 6. electron cache archive available with the pinned digest
if (!existsSync(ELECTRON_ZIP)) {
  warn("electron cache archive not found at the pinned path; acceptance will need it");
} else if (sha256(ELECTRON_ZIP) !== PINS.electronZip) {
  warn("electron cache archive digest differs from the pinned value");
} else {
  ok("electron cache archive matches pin");
}

// 7. macOS pinned toolchain present
const clang = "/Library/Developer/CommandLineTools/usr/bin/clang";
if (existsSync(clang)) {
  ok("pinned CommandLineTools clang present");
} else {
  fail("pinned CommandLineTools clang missing: " + clang);
}

// 8. .zerox governance mode layout matches the CI normalization contract
const lifecycleFiles = [".zerox/conversation-disclosure-program.json", ".zerox/feature_list.json"];
for (const rel of lifecycleFiles) {
  const p = path.join(root, rel);
  if (!existsSync(p)) { fail(rel + " is missing"); continue; }
  if ((statSync(p).mode & 0o777) !== 0o644) fail(rel + " must be 0644");
}
const roundEvidenceRoot = path.join(root, ".zerox/verification/conversation-disclosure");
let roundEvidenceMode = null;
if (existsSync(roundEvidenceRoot)) {
  for (const name of readdirSync(roundEvidenceRoot)) {
    if (!name.startsWith("CD03A-round")) continue;
    const p = path.join(roundEvidenceRoot, name);
    const mode = statSync(p).mode & 0o777;
    if (mode !== 0o600) {
      roundEvidenceMode = mode;
      break;
    }
  }
}
if (roundEvidenceMode !== null && roundEvidenceMode !== 0o600) {
  fail("CD03A-round* evidence must be 0600 (CI normalization contract) — run: find .zerox -type f -exec chmod 0644 {} + && chmod 0600 .zerox/verification/conversation-disclosure/CD03A-round*");
} else if (roundEvidenceMode === 0o600) {
  ok("CD03A-round* evidence is 0600 as required");
}

// 9. lifecycle state guidance
let lifecycleNote = "";
try {
  const program = JSON.parse(readFileSync(path.join(root, ".zerox/conversation-disclosure-program.json"), "utf8"));
  if (program.status === "completed") {
    lifecycleNote = "conversation program is SEALED (completed) — acceptance must run on an active tree: commit a reopen first";
  } else if (program.status === "active") {
    lifecycleNote = "conversation program is active (ready for acceptance)";
  }
} catch {}
if (lifecycleNote.includes("SEALED")) warn(lifecycleNote); else if (lifecycleNote) ok(lifecycleNote);

console.log("\n=== release acceptance preflight ===");
for (const line of pass) console.log("  PASS  " + line);
for (const line of warnings) console.log("  WARN  " + line);
for (const line of failures) console.log("  FAIL  " + line);
console.log("=== " + pass.length + " pass, " + warnings.length + " warn, " + failures.length + " fail ===\n");
if (failures.length > 0) process.exit(1);