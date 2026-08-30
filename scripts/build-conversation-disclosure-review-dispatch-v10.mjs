#!/usr/bin/env node

import { lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  CONTINUATION_V10_BASELINE_ARCHIVE_PATH,
  CONTINUATION_V10_CALLER_DISPATCH_ASSURANCE,
  CONTINUATION_V10_POLICY_PATH,
  CONTINUATION_V10_REVIEW_LANES,
  CONTINUATION_V10_REVIEW_SNAPSHOT_PATH,
  CONTINUATION_V10_ROUND9_REVIEW_REJECTION_PATH,
  hashCanonicalV10,
  sha256BytesV10,
  sha256DigestV10,
  validateBaselineArchiveV10,
  validateContinuationPolicyV10,
  validateContinuationReviewSnapshotV10,
  validateRound9ReviewRejectionV10,
} from "./conversation-disclosure-continuation-contract-v10.mjs";
import {
  capturePrivateEvidenceV10,
  createCaptureLedgerV10,
  postflightCaptureLedgerV10,
  publishPrivateExactV10,
} from "./conversation-disclosure-continuation-runtime-io-v10.mjs";

const INSTRUCTION_FILE_BY_LANE = Object.freeze({
  contract: "contract.instruction.txt",
  runtime: "runtime.instruction.txt",
  governance: "governance.instruction.txt",
});
const LANE_SCOPE = Object.freeze({
  contract:
    "Audit exact V10 schemas and semantic bindings, including candidate results, trusted time, final-manifest projection, complete roots, the exact successor-admission head, and rejection of P108 done.",
  runtime:
    "Audit capture and publication I/O, absence semantics, checker bindings, staged candidate execution, fresh/replay/recovery behavior, TOCTOU resistance, and final publication ordering.",
  governance:
    "Audit the exact P107A roster, completion artifacts, six-class coverage, rejected-history preservation, transition roots, V3/V4 historical lanes, reviewer assurance, and P108 completion prohibition.",
});

export function buildReviewDispatchArtifactsV10({
  policy,
  snapshot,
  challenges,
}) {
  if (!sha256DigestV10(policy?.digest)
    || !sha256DigestV10(snapshot?.digest)
    || snapshot.policyDigest !== policy.digest
    || !sha256DigestV10(policy?.round9ReviewRejection?.digest)) {
    throw new Error("dispatch builder requires one bound V10 policy and snapshot");
  }
  const challengeMap = new Map(challenges ?? []);
  if (challengeMap.size !== CONTINUATION_V10_REVIEW_LANES.length
    || CONTINUATION_V10_REVIEW_LANES.some(
      (lane) => !sha256DigestV10(challengeMap.get(lane)),
    )
    || new Set(challengeMap.values()).size !== challengeMap.size) {
    throw new Error("dispatch builder requires three unique lane challenges");
  }

  const instructions = [];
  const entries = CONTINUATION_V10_REVIEW_LANES.map((lane) => {
    const challenge = challengeMap.get(lane);
    const reviewContextId = `round10-${lane}-${challenge.slice(7, 23)}`;
    const taskPath = `round10/${lane}`;
    const agentLabel = `round10-${lane}-reviewer`;
    const text = [
      "READ-ONLY independent Round10 review.",
      "Do not edit, publish, chmod, rename, or delete any file.",
      `Policy: ${policy.digest}`,
      `Snapshot: ${snapshot.digest}`,
      `Rejected parent witness: ${policy.round9ReviewRejection.digest}`,
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
    const instructionDigest = sha256BytesV10(bytes);
    instructions.push({
      lane,
      filename: INSTRUCTION_FILE_BY_LANE[lane],
      bytes,
      sha256: instructionDigest,
    });
    return {
      lane,
      assurance: CONTINUATION_V10_CALLER_DISPATCH_ASSURANCE,
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
    dispatchSetDigest: hashCanonicalV10(entries),
    instructions,
  };
}

export async function buildConversationDisclosureReviewDispatchV10({
  repositoryRoot = process.cwd(),
  outputDirectory,
  challenges,
} = {}) {
  const root = await canonicalRepositoryRoot(repositoryRoot);
  const outputRoot = await preparePrivateExternalDirectory(
    root,
    outputDirectory,
  );
  const ledger = createCaptureLedgerV10();
  const readPrivateJson = async (relativePath, label) =>
    JSON.parse((await capturePrivateEvidenceV10(
      path.join(root, relativePath),
      label,
      { expectedRoot: root, ledger },
    )).bytes.toString("utf8"));
  const [policy, archive, rejection, snapshot] = await Promise.all([
    readPrivateJson(CONTINUATION_V10_POLICY_PATH, "Round10 policy"),
    readPrivateJson(CONTINUATION_V10_BASELINE_ARCHIVE_PATH, "Round10 archive"),
    readPrivateJson(
      CONTINUATION_V10_ROUND9_REVIEW_REJECTION_PATH,
      "Round9 review rejection",
    ),
    readPrivateJson(CONTINUATION_V10_REVIEW_SNAPSHOT_PATH, "Round10 snapshot"),
  ]);
  assertNoErrors(validateRound9ReviewRejectionV10(rejection),
    "Round9 review rejection");
  assertNoErrors(validateContinuationPolicyV10(policy, {
    expectedDigest: policy.digest,
    baselineArchive: archive,
  }), "Round10 policy");
  assertNoErrors(validateBaselineArchiveV10(archive, policy), "Round10 archive");
  assertNoErrors(validateContinuationReviewSnapshotV10(snapshot, policy, {
    verifierNow: Date.now(),
  }), "Round10 snapshot");
  await postflightCaptureLedgerV10(ledger);

  const artifacts = buildReviewDispatchArtifactsV10({
    policy,
    snapshot,
    challenges,
  });
  const publications = [];
  for (const instruction of artifacts.instructions) {
    publications.push(await publishPrivateExactV10(
      path.join(outputRoot, instruction.filename),
      instruction.bytes,
      { label: `Round10 ${instruction.lane} review instruction` },
    ));
  }
  const dispatchPath = path.join(outputRoot, "dispatch-set.json");
  publications.push(await publishPrivateExactV10(
    dispatchPath,
    Buffer.from(`${JSON.stringify(artifacts.entries, null, 2)}\n`, "utf8"),
    { label: "Round10 caller dispatch set" },
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
  buildConversationDisclosureReviewDispatchV10(
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
