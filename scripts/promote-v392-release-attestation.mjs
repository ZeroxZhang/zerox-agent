#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  hashCanonicalV13,
  sha256BytesV13,
} from "./conversation-disclosure-delta-contract-v13.mjs";
import { computeLocalCandidateSourceManifest } from "./local-candidate-source-manifest.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(
  root,
  ".zerox/verification/conversation-disclosure/CD09-release-attestation.json",
);
const expectedVerification = Object.freeze({
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
});
const evidencePaths = Object.freeze({
  codeReview: ".zerox/reviews/CD09-code-review.json",
  securityReview: ".zerox/reviews/CD09-security-review.json",
  realAppAcceptance:
    ".zerox/verification/conversation-disclosure/CD09-real-app-acceptance.json",
  localPackage:
    ".zerox/verification/conversation-disclosure/CD09-local-package.json",
  chatResilience: ".zerox/verification/chat-resilience-local-package.json",
  planResilience: ".zerox/verification/plan-resilience-local-package.json",
});

const options = parseOptions(process.argv.slice(2));
const anchor = await readJson(options.anchorPath);
const canonicalRoot = await realpath(root);
const gitHead = execFileSync("/usr/bin/git", ["rev-parse", "HEAD"], {
  cwd: canonicalRoot,
  encoding: "utf8",
}).trim();
const gitTree = execFileSync(
  "/usr/bin/git",
  ["rev-parse", "--verify", "HEAD^{tree}"],
  { cwd: canonicalRoot, encoding: "utf8" },
).trim();
const anchorDigestInput = Object.fromEntries(
  Object.entries(anchor).filter(([key]) => key !== "digest"),
);
if (
  anchor.schemaVersion !== 1
  || anchor.kind !== "v3.9.2-local-acceptance-external-anchor"
  || anchor.status !== "accepted"
  || anchor.identityAssurance !== "caller-held-not-signed"
  || anchor.version !== "3.9.2"
  || anchor.repositoryRealpath !== canonicalRoot
  || anchor.digest !== options.expectedDigest
  || anchor.digest !== hashCanonicalV13(anchorDigestInput)
  || !/^sha256:[0-9a-f]{64}$/.test(anchor.cd04AnchorDigest ?? "")
  || !/^sha256:[0-9a-f]{64}$/.test(anchor.sourceDigest ?? "")
  || !Number.isInteger(anchor.sourceFileCount)
  || anchor.sourceFileCount <= 0
  || !/^[0-9a-f]{40}$/.test(anchor.gitHead ?? "")
  || !/^[0-9a-f]{40}$/.test(anchor.gitTree ?? "")
  || anchor.gitHead !== gitHead
  || anchor.gitTree !== gitTree
  || !validReviewPins(anchor.reviewPins)
  || JSON.stringify(anchor.verification) !== JSON.stringify(expectedVerification)
) {
  throw new Error("caller-pinned v3.9.2 acceptance anchor is invalid");
}

const source = await computeLocalCandidateSourceManifest(root);
if (
  source.digest !== anchor.sourceDigest
  || source.fileCount !== anchor.sourceFileCount
) {
  throw new Error("current source does not match the accepted v3.9.2 anchor");
}

const evidence = {};
const evidenceValues = {};
for (const [name, relativePath] of Object.entries(evidencePaths)) {
  const bytes = await readFile(path.join(root, relativePath));
  evidence[name] = sha256BytesV13(bytes);
  evidenceValues[name] = JSON.parse(bytes.toString("utf8"));
}
if (
  evidenceValues.codeReview.digest !== anchor.reviewPins?.code?.receiptDigest
  || evidenceValues.securityReview.digest
    !== anchor.reviewPins?.security?.receiptDigest
  || evidenceValues.codeReview.verdict !== "passed"
  || evidenceValues.securityReview.verdict !== "passed"
  || evidenceValues.realAppAcceptance.status !== "passed"
  || evidenceValues.localPackage.status !== "passed"
  || evidenceValues.chatResilience.status !== "passed"
  || evidenceValues.planResilience.status !== "passed"
) {
  throw new Error("accepted v3.9.2 evidence set is incomplete or drifted");
}

const attestation = {
  schemaVersion: 1,
  kind: "v3.9.2-release-attestation",
  version: "3.9.2",
  status: "accepted",
  identityAssurance: "caller-promoted-external-anchor-not-signed",
  acceptanceAnchorDigest: anchor.digest,
  acceptedGitHead: anchor.gitHead,
  acceptedGitTree: anchor.gitTree,
  cd04AnchorDigest: anchor.cd04AnchorDigest,
  sourceDigest: anchor.sourceDigest,
  sourceFileCount: anchor.sourceFileCount,
  reviewPins: anchor.reviewPins,
  evidenceDigests: evidence,
  verification: anchor.verification,
};
const completed = {
  ...attestation,
  digest: hashCanonicalV13(attestation),
};
await writeAtomicJson(outputPath, completed);
console.log(JSON.stringify({
  status: "passed",
  outputPath: path.relative(root, outputPath),
  digest: completed.digest,
  sourceDigest: completed.sourceDigest,
}, null, 2));

function parseOptions(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || !value || values.has(key)) {
      throw new Error("usage: --anchor /absolute/path --expected-digest sha256:...");
    }
    values.set(key, value);
  }
  const anchorPath = values.get("--anchor");
  const expectedDigest = values.get("--expected-digest");
  if (
    values.size !== 2
    || !path.isAbsolute(anchorPath ?? "")
    || !/^sha256:[0-9a-f]{64}$/.test(expectedDigest ?? "")
  ) {
    throw new Error("usage: --anchor /absolute/path --expected-digest sha256:...");
  }
  return { anchorPath, expectedDigest };
}

async function readJson(filePath) {
  const [canonicalPath, leaf] = await Promise.all([
    realpath(filePath),
    lstat(filePath),
  ]);
  if (
    canonicalPath !== filePath
    || canonicalPath === root
    || canonicalPath.startsWith(`${root}${path.sep}`)
    || !leaf.isFile()
    || leaf.isSymbolicLink()
  ) {
    throw new Error("external acceptance anchor path is unsafe");
  }
  const handle = await open(
    filePath,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const before = await handle.stat();
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      !before.isFile()
      || before.nlink !== 1
      || before.dev !== after.dev
      || before.ino !== after.ino
      || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs
      || before.ctimeMs !== after.ctimeMs
      || (before.mode & 0o077) !== 0
    ) {
      throw new Error("external acceptance anchor path is unsafe");
    }
    return JSON.parse(bytes.toString("utf8"));
  } finally {
    await handle.close();
  }
}

function validReviewPins(reviewPins) {
  const lanes = Object.keys(reviewPins ?? {});
  if (JSON.stringify(lanes) !== JSON.stringify(["code", "security"])) {
    return false;
  }
  return lanes.every((lane) => {
    const pin = reviewPins[lane];
    return Object.keys(pin ?? {}).join(",")
      === "reviewerAgentId,challenge,receiptDigest"
      && typeof pin.reviewerAgentId === "string"
      && pin.reviewerAgentId.length >= 16
      && /^sha256:[0-9a-f]{64}$/.test(pin.challenge ?? "")
      && /^sha256:[0-9a-f]{64}$/.test(pin.receiptDigest ?? "");
  }) && reviewPins.code.reviewerAgentId !== reviewPins.security.reviewerAgentId
    && reviewPins.code.challenge !== reviewPins.security.challenge;
}

async function writeAtomicJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.atomic-${process.pid}`;
  await rm(temporaryPath, { force: true });
  const handle = await open(
    temporaryPath,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
    0o644,
  );
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporaryPath, filePath);
}
