#!/usr/bin/env node

import { lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  CONTINUATION_V9_BASELINE_ARCHIVE_PATH,
  CONTINUATION_V9_CALLER_DISPATCH_ASSURANCE,
  CONTINUATION_V9_POLICY_PATH,
  CONTINUATION_V9_REVIEW_LANES,
  CONTINUATION_V9_REVIEW_SNAPSHOT_PATH,
  CONTINUATION_V9_ROUND8_REVIEW_REJECTION_PATH,
  hashCanonicalV9,
  sha256BytesV9,
  sha256DigestV9,
  validateBaselineArchiveV9,
  validateContinuationPolicyV9,
  validateContinuationReviewSnapshotV9,
  validateRound8ReviewRejectionV9,
} from "./conversation-disclosure-continuation-contract-v9.mjs";
import {
  capturePrivateEvidenceV9,
  createCaptureLedgerV9,
  postflightCaptureLedgerV9,
  publishPrivateExactV9,
} from "./conversation-disclosure-continuation-runtime-io-v9.mjs";

const INSTRUCTION_FILE_BY_LANE = Object.freeze({
  contract: "contract.instruction.txt",
  runtime: "runtime.instruction.txt",
  governance: "governance.instruction.txt",
});
const LANE_SCOPE = Object.freeze({
  contract:
    "Audit exact V9 schemas and semantic bindings, including candidate results, trusted time, final-manifest projection, complete roots, the exact successor-admission head, and rejection of P108 done.",
  runtime:
    "Audit capture and publication I/O, absence semantics, checker bindings, staged candidate execution, fresh/replay/recovery behavior, TOCTOU resistance, and final publication ordering.",
  governance:
    "Audit the exact P107A roster, completion artifacts, six-class coverage, rejected-history preservation, transition roots, V3/V4 historical lanes, reviewer assurance, and P108 completion prohibition.",
});

export function buildReviewDispatchArtifactsV9({
  policy,
  snapshot,
  challenges,
}) {
  if (!sha256DigestV9(policy?.digest)
    || !sha256DigestV9(snapshot?.digest)
    || snapshot.policyDigest !== policy.digest
    || !sha256DigestV9(policy?.round8ReviewRejection?.digest)) {
    throw new Error("dispatch builder requires one bound V9 policy and snapshot");
  }
  const challengeMap = new Map(challenges ?? []);
  if (challengeMap.size !== CONTINUATION_V9_REVIEW_LANES.length
    || CONTINUATION_V9_REVIEW_LANES.some(
      (lane) => !sha256DigestV9(challengeMap.get(lane)),
    )
    || new Set(challengeMap.values()).size !== challengeMap.size) {
    throw new Error("dispatch builder requires three unique lane challenges");
  }

  const instructions = [];
  const entries = CONTINUATION_V9_REVIEW_LANES.map((lane) => {
    const challenge = challengeMap.get(lane);
    const reviewContextId = `round9-${lane}-${challenge.slice(7, 23)}`;
    const taskPath = `round9/${lane}`;
    const agentLabel = `round9-${lane}-reviewer`;
    const text = [
      "READ-ONLY independent Round9 review.",
      "Do not edit, publish, chmod, rename, or delete any file.",
      `Policy: ${policy.digest}`,
      `Snapshot: ${snapshot.digest}`,
      `Rejected parent witness: ${policy.round8ReviewRejection.digest}`,
      "Review phase: review_pre_transition.",
      "All live transition files must remain all-from.",
      `Lane: ${lane}`,
      `Challenge: ${challenge}`,
      LANE_SCOPE[lane],
      "Return only one JSON object with lane, verdict, findingCounts, and findings.",
      "A PASS verdict requires an empty findings array.",
      "",
    ].join("\n");
    const bytes = Buffer.from(text, "utf8");
    const instructionDigest = sha256BytesV9(bytes);
    instructions.push({
      lane,
      filename: INSTRUCTION_FILE_BY_LANE[lane],
      bytes,
      sha256: instructionDigest,
    });
    return {
      lane,
      assurance: CONTINUATION_V9_CALLER_DISPATCH_ASSURANCE,
      challenge,
      instructionDigest,
      reviewContextId,
      taskPath,
      agentLabel,
      transport: "codex-collaboration",
    };
  });
  return {
    entries,
    dispatchSetDigest: hashCanonicalV9(entries),
    instructions,
  };
}

export async function buildConversationDisclosureReviewDispatchV9({
  repositoryRoot = process.cwd(),
  outputDirectory,
  challenges,
} = {}) {
  const root = await canonicalRepositoryRoot(repositoryRoot);
  const outputRoot = await preparePrivateExternalDirectory(
    root,
    outputDirectory,
  );
  const ledger = createCaptureLedgerV9();
  const readPrivateJson = async (relativePath, label) =>
    JSON.parse((await capturePrivateEvidenceV9(
      path.join(root, relativePath),
      label,
      { expectedRoot: root, ledger },
    )).bytes.toString("utf8"));
  const [policy, archive, rejection, snapshot] = await Promise.all([
    readPrivateJson(CONTINUATION_V9_POLICY_PATH, "Round9 policy"),
    readPrivateJson(CONTINUATION_V9_BASELINE_ARCHIVE_PATH, "Round9 archive"),
    readPrivateJson(
      CONTINUATION_V9_ROUND8_REVIEW_REJECTION_PATH,
      "Round8 review rejection",
    ),
    readPrivateJson(CONTINUATION_V9_REVIEW_SNAPSHOT_PATH, "Round9 snapshot"),
  ]);
  assertNoErrors(validateRound8ReviewRejectionV9(rejection),
    "Round8 review rejection");
  assertNoErrors(validateContinuationPolicyV9(policy, {
    expectedDigest: policy.digest,
    baselineArchive: archive,
  }), "Round9 policy");
  assertNoErrors(validateBaselineArchiveV9(archive, policy), "Round9 archive");
  assertNoErrors(validateContinuationReviewSnapshotV9(snapshot, policy, {
    verifierNow: Date.now(),
  }), "Round9 snapshot");
  await postflightCaptureLedgerV9(ledger);

  const artifacts = buildReviewDispatchArtifactsV9({
    policy,
    snapshot,
    challenges,
  });
  const publications = [];
  for (const instruction of artifacts.instructions) {
    publications.push(await publishPrivateExactV9(
      path.join(outputRoot, instruction.filename),
      instruction.bytes,
      { label: `Round9 ${instruction.lane} review instruction` },
    ));
  }
  const dispatchPath = path.join(outputRoot, "dispatch-set.json");
  publications.push(await publishPrivateExactV9(
    dispatchPath,
    Buffer.from(`${JSON.stringify(artifacts.entries, null, 2)}\n`, "utf8"),
    { label: "Round9 caller dispatch set" },
  ));
  return {
    ...artifacts,
    outputDirectory: outputRoot,
    dispatchPath,
    publicationStatuses: publications.map((entry) => entry.status),
    captureCount: ledger.entries.length,
  };
}

async function preparePrivateExternalDirectory(root, candidate) {
  if (!path.isAbsolute(candidate ?? "")) {
    throw new Error("dispatch output directory must be absolute");
  }
  await mkdir(candidate, { recursive: true, mode: 0o700 });
  const canonical = await realpath(candidate);
  const relative = path.relative(root, canonical);
  if (canonical === root
    || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new Error("dispatch output directory must be repository-external");
  }
  const entry = await lstat(canonical);
  if (!entry.isDirectory() || entry.isSymbolicLink()
    || entry.uid !== process.geteuid() || (entry.mode & 0o077) !== 0) {
    throw new Error("dispatch output directory must be current-user-owned and private");
  }
  return canonical;
}

function canonicalRepositoryRoot(candidate) {
  const resolved = path.resolve(candidate);
  return realpath(resolved).then((canonical) => {
    if (canonical !== resolved) {
      throw new Error("repository root must be canonical");
    }
    return canonical;
  });
}

function assertNoErrors(errors, label) {
  if (errors.length > 0) {
    throw new Error(`${label} is invalid: ${errors.join("; ")}`);
  }
}

function parseArguments(argv) {
  const options = { challenges: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--repository-root") {
      options.repositoryRoot = argv[++index];
    } else if (argument === "--output-directory") {
      options.outputDirectory = argv[++index];
    } else if (argument === "--challenge") {
      const [lane, digest, ...extra] = String(argv[++index] ?? "").split("=");
      if (!lane || !digest || extra.length > 0) {
        throw new Error("--challenge requires lane=sha256:<64 hex>");
      }
      options.challenges.push([lane, digest]);
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  return options;
}

if (process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  buildConversationDisclosureReviewDispatchV9(
    parseArguments(process.argv.slice(2)),
  ).then((result) => {
    process.stdout.write(`${JSON.stringify({
      status: "passed",
      outputDirectory: result.outputDirectory,
      dispatchPath: result.dispatchPath,
      dispatchSetDigest: result.dispatchSetDigest,
      instructionDigests: Object.fromEntries(
        result.instructions.map((entry) => [entry.lane, entry.sha256]),
      ),
      publicationStatuses: result.publicationStatuses,
      captureCount: result.captureCount,
    })}\n`);
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
