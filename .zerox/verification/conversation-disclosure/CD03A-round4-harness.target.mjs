import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, open, readFile } from "node:fs/promises";
import path from "node:path";
import {
  hashCanonicalV4,
} from "./conversation-disclosure-continuation-contract-v4.mjs";
import {
  runConversationDisclosureContinuationCheckerV4,
} from "./check-conversation-disclosure-continuation-v4.mjs";

const root = process.cwd();
const requestedArguments = process.argv.slice(2);
const diagnosticOnly = requestedArguments.length === 0
  || (requestedArguments.length === 1 && requestedArguments[0] === "--diagnostic-only");
if (requestedArguments.includes("--diagnostic-only") && !diagnosticOnly) {
  console.error("Harness continuation v4 check failed:");
  console.error("- --diagnostic-only cannot be combined with authoritative caller pins");
  process.exit(1);
}
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
  ".zerox/verification/conversation-disclosure/CD03A-round4-baseline-archive.json",
  ".zerox/verification/conversation-disclosure/CD03A-round3-review-rejection.json",
  ".zerox/verification/conversation-disclosure/CD03A-round4-successor-evolution-policy.json",
  ".zerox/verification/conversation-disclosure/CD03A-round4-review-snapshot.json",
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

for (const relativePath of requiredFiles) {
  try {
    await access(path.join(root, relativePath));
  } catch {
    errors.push(`${relativePath} is required`);
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

await import("./check-runtime-convergence-program.mjs");
await import("./check-kernel-migration-program.mjs");
await import("./check-storage-convergence-program.mjs");
await import("./check-release-program.mjs");

if (diagnosticOnly) {
  const diagnosticWithoutDigest = {
    schemaVersion: 4,
    kind: "cd03a-continuation-harness-v4-local-diagnostic",
    status: "local_unpinned_diagnostic",
    authoritative: false,
    historicalCheckerSha256,
    policyPath:
      ".zerox/verification/conversation-disclosure/CD03A-round4-successor-evolution-policy.json",
    snapshotPath:
      ".zerox/verification/conversation-disclosure/CD03A-round4-review-snapshot.json",
  };
  console.log("Harness local diagnostic passed; caller-pinned continuation acceptance was not run.");
  console.log(JSON.stringify({
    ...diagnosticWithoutDigest,
    digest: hashCanonicalV4(diagnosticWithoutDigest),
  }));
} else {
  const checkerReceipt = await runConversationDisclosureContinuationCheckerV4(
    requestedArguments,
  );
  const receiptWithoutDigest = {
    schemaVersion: 4,
    kind: "cd03a-continuation-harness-v4-receipt",
    status: "passed",
    authoritative: true,
    callerDispatchAssurance: "caller-attested-not-signed",
    identityAssurance: "not-signed",
    independenceClaim: "caller-attested-distinct-review-contexts",
    platformIdentitySignature: null,
    mode: checkerReceipt.mode,
    subjectRepositoryRealpath: checkerReceipt.subjectRepositoryRealpath,
    baseExternalAnchorDigest: checkerReceipt.baseExternalAnchorDigest,
    baseSnapshotDigest: checkerReceipt.baseSnapshotDigest,
    policyDigest: checkerReceipt.policyDigest,
    snapshotDigest: checkerReceipt.snapshotDigest,
    baselineArchiveDigest: checkerReceipt.baselineArchiveDigest,
    continuationAnchorDigest: checkerReceipt.continuationAnchorDigest,
    checkerReceiptDigest: checkerReceipt.digest,
  };
  console.log("Harness continuation v4 check passed.");
  console.log(JSON.stringify({
    ...receiptWithoutDigest,
    digest: hashCanonicalV4(receiptWithoutDigest),
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
    const handle = await open(
      path.join(root, relativePath),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
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
  console.error("Harness continuation v4 check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
