import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, open, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const historicalChecker = "scripts/check-conversation-disclosure-program.mjs";
const historicalCheckerSha256 =
  "sha256:162c6165d8f831b9a6e4c94fd2627527bc038da79cc8d9bde91bce7852cf754d";
const requiredFiles = [
  "AGENTS.md",
  "init.sh",
  ".zerox/feature_list.json",
  ".zerox/progress.md",
  ".zerox/golden-principles.md",
  ".zerox/runtime-convergence-program.json",
  ".zerox/runtime-convergence-program.md",
  ".zerox/kernel-migration-program.json",
  ".zerox/kernel-migration-program.md",
  ".zerox/storage-convergence-program.json",
  ".zerox/storage-convergence-program.md",
  ".zerox/release-program.json",
  ".zerox/conversation-disclosure-program.json",
  ".zerox/conversation-disclosure-program.md",
  ".zerox/verification/conversation-disclosure/CD03-causal-shadow.json",
  ".zerox/verification/conversation-disclosure/CD03A-successor-evolution-policy.json",
  "docs/superpowers/specs/2026-06-09-harness-engineering-iteration-spec.md",
  "docs/superpowers/plans/2026-06-09-harness-engineering-iteration.md",
];
const requiredScripts = [
  "test",
  "build",
  "verify",
  "smoke:providers",
  "smoke:prod",
  "eval:agent",
  "eval:memory",
  "harness:check",
  "program:check",
  "conversation-disclosure:baseline",
];
const errors = [];

for (const file of requiredFiles) {
  try {
    await access(path.join(root, file));
  } catch {
    errors.push(`${file} is required`);
  }
}

let packageJson;
try {
  packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
} catch {
  errors.push("package.json must contain valid JSON");
}
for (const scriptName of requiredScripts) {
  if (!packageJson?.scripts?.[scriptName]) {
    errors.push(`package.json scripts.${scriptName}`);
  }
}

const historicalCheckerBytes = await readStableRegularFile(
  historicalChecker,
  "historical Round23 checker",
);
if (historicalCheckerBytes
  && sha256Bytes(historicalCheckerBytes) !== historicalCheckerSha256) {
  errors.push(`${historicalChecker} no longer matches the Round23 historical checker`);
}

if (errors.length > 0) fail();

await import("./check-conversation-disclosure-continuation.mjs");
await import("./check-runtime-convergence-program.mjs");
await import("./check-kernel-migration-program.mjs");
await import("./check-storage-convergence-program.mjs");
await import("./check-release-program.mjs");

console.log("Harness continuation check passed.");
if (process.argv.includes("--bootstrap-candidate")) {
  console.log(JSON.stringify({
    kind: "cd03a-continuation-harness-receipt",
    status: "passed",
    baseExternalAnchorDigest:
      "sha256:e81f0afb3d10b12976b74d1499870b837595ffbc3b452c7f1f78fff67be8f102",
    baseSnapshotDigest:
      "sha256:e1a5300d6015543e0a6a8e8f09f2a13fcb955111b87c08545e0f882bb786796b",
    policyDigest: requiredOption("--expected-policy-digest"),
    snapshotDigest: requiredOption("--expected-snapshot-digest"),
  }));
}

async function readStableRegularFile(relativePath, label) {
  if (!repositoryPath(relativePath)) {
    errors.push(`${label} must use a repository-relative path`);
    return null;
  }
  const segments = relativePath.split("/");
  const parentIdentities = [];
  let cursor = root;
  let leafStat;
  try {
    for (let index = 0; index < segments.length; index += 1) {
      cursor = path.join(cursor, segments[index]);
      const entry = await lstat(cursor);
      if (entry.isSymbolicLink()) {
        errors.push(`${label} must not contain symbolic links: ${relativePath}`);
        return null;
      }
      if (index < segments.length - 1) {
        if (!entry.isDirectory()) {
          errors.push(`${label} parent must be a directory: ${relativePath}`);
          return null;
        }
        parentIdentities.push({ path: cursor, dev: entry.dev, ino: entry.ino });
      } else {
        if (!entry.isFile() || entry.nlink !== 1) {
          errors.push(`${label} must be one single-link regular file: ${relativePath}`);
          return null;
        }
        leafStat = entry;
      }
    }
    const handle = await open(path.join(root, relativePath), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.nlink !== 1
        || opened.dev !== leafStat.dev || opened.ino !== leafStat.ino) {
        errors.push(`${label} changed identity while opening: ${relativePath}`);
        return null;
      }
      const bytes = await handle.readFile();
      const after = await handle.stat();
      if (after.dev !== opened.dev || after.ino !== opened.ino
        || after.nlink !== 1 || after.size !== bytes.length) {
        errors.push(`${label} changed identity while reading: ${relativePath}`);
        return null;
      }
      for (const expected of parentIdentities) {
        const current = await lstat(expected.path);
        if (!current.isDirectory() || current.isSymbolicLink()
          || current.dev !== expected.dev || current.ino !== expected.ino) {
          errors.push(`${label} parent identity changed: ${relativePath}`);
          return null;
        }
      }
      const finalLeaf = await lstat(path.join(root, relativePath));
      if (!finalLeaf.isFile() || finalLeaf.isSymbolicLink() || finalLeaf.nlink !== 1
        || finalLeaf.dev !== opened.dev || finalLeaf.ino !== opened.ino) {
        errors.push(`${label} changed path identity while reading: ${relativePath}`);
        return null;
      }
      return bytes;
    } finally {
      await handle.close();
    }
  } catch {
    errors.push(`${label} does not exist or changed identity: ${relativePath}`);
    return null;
  }
}

function repositoryPath(value) {
  return typeof value === "string"
    && value.length > 0
    && !path.isAbsolute(value)
    && !value.includes("\\")
    && value.split("/").every((segment) => segment && segment !== "." && segment !== "..");
}

function sha256Bytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function fail() {
  console.error("Harness continuation check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

function requiredOption(name) {
  const equals = process.argv.find((argument) => argument.startsWith(`${name}=`));
  if (equals) return equals.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  errors.push(`${name} is required for bootstrap receipt publication`);
  fail();
}
