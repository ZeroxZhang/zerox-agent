#!/usr/bin/env node

import { access, readFile } from "node:fs/promises";
import path from "node:path";

import {
  CD04_DELTA_MANIFEST_PATH,
  CD04_DELTA_REVIEW_PATH,
  CD04_DELTA_SCHEMA_VERSION,
  CD04_DELTA_SNAPSHOT_PATH,
  hashCanonicalV13,
} from "./conversation-disclosure-delta-contract-v13.mjs";
import {
  checkConversationDisclosureProgramV13,
} from "./check-conversation-disclosure-program-v13.mjs";

const root = process.cwd();
const requestedArguments = process.argv.slice(2);
const diagnosticOnly = requestedArguments.length === 1
  && requestedArguments[0] === "--diagnostic-only";
if (requestedArguments.includes("--diagnostic-only") && !diagnosticOnly) {
  throw new Error(
    "--diagnostic-only cannot be combined with authoritative caller pins",
  );
}

const requiredFiles = [
  "AGENTS.md",
  "init.sh",
  ".zerox/feature_list.json",
  ".zerox/progress.md",
  ".zerox/conversation-disclosure-program.json",
  ".zerox/conversation-disclosure-program.md",
  CD04_DELTA_SNAPSHOT_PATH,
  "scripts/conversation-disclosure-delta-contract-v13.mjs",
  "scripts/check-conversation-disclosure-program-v13.mjs",
  "scripts/run-conversation-disclosure-tests-v13.mjs",
];
for (const relativePath of requiredFiles) {
  await access(path.join(root, relativePath));
}
const packageJson = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
);
for (const scriptName of [
  "test",
  "build",
  "verify",
  "smoke:prod",
  "harness:check",
  "program:check",
  "conversation-disclosure:baseline",
]) {
  if (!packageJson.scripts?.[scriptName]) {
    throw new Error(`package.json scripts.${scriptName} is required`);
  }
}

await import("./check-runtime-convergence-program.mjs");
await import("./check-kernel-migration-program.mjs");
await import("./check-storage-convergence-program.mjs");
await import("./check-release-program.mjs");

const checkerReceipt = await checkConversationDisclosureProgramV13(
  diagnosticOnly
    ? { diagnosticOnly: true }
    : parseAuthoritativeArguments(requestedArguments),
);
if (!diagnosticOnly) {
  await access(path.join(root, CD04_DELTA_MANIFEST_PATH));
  await access(path.join(root, CD04_DELTA_REVIEW_PATH));
}
const receiptWithoutDigest = {
  schemaVersion: CD04_DELTA_SCHEMA_VERSION,
  kind: diagnosticOnly
    ? "conversation-disclosure-harness-v13-local-diagnostic"
    : "conversation-disclosure-harness-v13-receipt",
  status: diagnosticOnly ? "local_unpinned_diagnostic" : "passed",
  authoritative: !diagnosticOnly,
  callerDispatchAssurance: "caller-attested-not-signed",
  identityAssurance: "not-signed",
  independenceClaim: "caller-attested-distinct-review-contexts",
  platformIdentitySignature: null,
  checkerReceiptDigest: checkerReceipt.digest,
  snapshotDigest: checkerReceipt.snapshotDigest,
  transitionState: checkerReceipt.transitionState,
  ...(checkerReceipt.manifestDigest
    ? { manifestDigest: checkerReceipt.manifestDigest }
    : {}),
  ...(checkerReceipt.deltaAnchorDigest
    ? { deltaAnchorDigest: checkerReceipt.deltaAnchorDigest }
    : {}),
};
console.log(
  diagnosticOnly
    ? "Harness V13 local diagnostic passed; caller-pinned CD04 delta acceptance was not run."
    : "Harness V13 caller-pinned acceptance passed.",
);
console.log(JSON.stringify({
  ...receiptWithoutDigest,
  digest: hashCanonicalV13(receiptWithoutDigest),
}));

function parseAuthoritativeArguments(argv) {
  const options = {
    diagnosticOnly: false,
    deltaAnchor: process.env.ZEROX_CD04_DELTA_ANCHOR,
    expectedDeltaAnchorDigest:
      process.env.ZEROX_CD04_DELTA_ANCHOR_DIGEST,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--delta-anchor") {
      options.deltaAnchor = argv[++index];
    } else if (value === "--expected-delta-anchor-digest") {
      options.expectedDeltaAnchorDigest = argv[++index];
    } else {
      throw new Error(`unknown argument: ${value}`);
    }
  }
  return options;
}
