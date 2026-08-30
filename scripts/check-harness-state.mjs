#!/usr/bin/env node

import { access, readFile } from "node:fs/promises";
import path from "node:path";

import {
  hashCanonicalV13,
} from "./conversation-disclosure-delta-contract-v13.mjs";
import {
  checkConversationDisclosureSuccessorProgram,
} from "./check-conversation-disclosure-successor-program.mjs";

const root = process.cwd();

const requiredFiles = [
  "AGENTS.md",
  "init.sh",
  ".zerox/feature_list.json",
  ".zerox/progress.md",
  ".zerox/conversation-disclosure-program.json",
  ".zerox/conversation-disclosure-program.md",
  "scripts/conversation-disclosure-delta-contract-v13.mjs",
  "scripts/check-conversation-disclosure-successor-program.mjs",
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

const checkerReceipt = await checkConversationDisclosureSuccessorProgram();
const receiptWithoutDigest = {
  schemaVersion: 1,
  kind: "conversation-disclosure-successor-harness-receipt",
  status: "passed",
  authoritative: checkerReceipt.releaseReady,
  callerDispatchAssurance: "caller-attested-not-signed",
  identityAssurance: "not-signed",
  independenceClaim: checkerReceipt.releaseReady
    ? "caller-attested-distinct-review-contexts"
    : "not-claimed-during-active-development",
  platformIdentitySignature: null,
  checkerReceiptDigest: checkerReceipt.digest,
  snapshotDigest: checkerReceipt.cd04SnapshotDigest,
  manifestDigest: checkerReceipt.cd04ManifestDigest,
  deltaAnchorDigest: checkerReceipt.cd04AnchorDigest,
  activeFeatureId: checkerReceipt.activeFeatureId,
};
console.log("Harness successor acceptance passed.");
console.log(JSON.stringify({
  ...receiptWithoutDigest,
  digest: hashCanonicalV13(receiptWithoutDigest),
}));
