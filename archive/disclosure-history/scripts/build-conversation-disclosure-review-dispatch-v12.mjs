#!/usr/bin/env node

import { lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  CONTINUATION_V12_BASELINE_ARCHIVE_PATH,
  CONTINUATION_V12_CALLER_DISPATCH_ASSURANCE,
  CONTINUATION_V12_POLICY_PATH,
  CONTINUATION_V12_REVIEW_LANES,
  CONTINUATION_V12_REVIEW_SNAPSHOT_PATH,
  CONTINUATION_V12_ROUND11_REVIEW_REJECTION_PATH,
  hashCanonicalV12,
  sha256BytesV12,
  sha256DigestV12,
  validateBaselineArchiveV12,
  validateContinuationPolicyV12,
  validateContinuationReviewSnapshotV12,
  validateRound11ReviewRejectionV12,
} from "./conversation-disclosure-continuation-contract-v12.mjs";
import {
  capturePrivateEvidenceV12,
  createCaptureLedgerV12,
  postflightCaptureLedgerV12,
  publishPrivateExactV12,
} from "./conversation-disclosure-continuation-runtime-io-v12.mjs";

const INSTRUCTION_FILE_BY_LANE = Object.freeze({
  contract: "contract.instruction.txt",
  runtime: "runtime.instruction.txt",
  governance: "governance.instruction.txt",
});
const LANE_SCOPE = Object.freeze({
  contract:
    "Audit exact V12 schemas and semantic bindings, including candidate results, trusted time, final-manifest projection, complete roots, the exact successor-admission head, and rejection of P108 done.",
  runtime:
    "Audit capture and publication I/O, absence semantics, checker bindings, staged candidate execution, fresh/replay/recovery behavior, TOCTOU resistance, and final publication ordering.",
  governance:
    "Audit the exact P107A roster, completion artifacts, six-class coverage, rejected-history preservation, transition roots, V3/V4 historical lanes, reviewer assurance, and P108 completion prohibition.",
});

export function buildReviewDispatchArtifactsV12({
  policy,
  snapshot,
  challenges,
}) {
  if (!sha256DigestV12(policy?.digest)
    || !sha256DigestV12(snapshot?.digest)
    || snapshot.policyDigest !== policy.digest
    || !sha256DigestV12(policy?.round11ReviewRejection?.digest)) {
    throw new Error("dispatch builder requires one bound V12 policy and snapshot");
  }
  const challengeMap = new Map(challenges ?? []);
  if (challengeMap.size !== CONTINUATION_V12_REVIEW_LANES.length
    || CONTINUATION_V12_REVIEW_LANES.some(
      (lane) => !sha256DigestV12(challengeMap.get(lane)),
    )
    || new Set(challengeMap.values()).size !== challengeMap.size) {
    throw new Error("dispatch builder requires three unique lane challenges");
  }

  const instructions = [];
  const entries = CONTINUATION_V12_REVIEW_LANES.map((lane) => {
    const challenge = challengeMap.get(lane);
    const reviewContextId = `round12-${lane}-${challenge.slice(7, 23)}`;
    const taskPath = `round12/${lane}`;
    const agentLabel = `round12-${lane}-reviewer`;
    const text = [
      "READ-ONLY independent Round12 review.",
      "Do not edit, publish, chmod, rename, or delete any file.",
      `Policy: ${policy.digest}`,
      `Snapshot: ${snapshot.digest}`,
      `Rejected parent witness: ${policy.round11ReviewRejection.digest}`,
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
    const instructionDigest = sha256BytesV12(bytes);
    instructions.push({
      lane,
      filename: INSTRUCTION_FILE_BY_LANE[lane],
      bytes,
      sha256: instructionDigest,
    });
    return {
      lane,
      assurance: CONTINUATION_V12_CALLER_DISPATCH_ASSURANCE,
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
    dispatchSetDigest: hashCanonicalV12(entries),
    instructions,
  };
}

export async function buildConversationDisclosureReviewDispatchV12({
  repositoryRoot = process.cwd(),
  outputDirectory,
  challenges,
} = {}) {
  const root = await canonicalRepositoryRoot(repositoryRoot);
  const outputRoot = await preparePrivateExternalDirectory(
    root,
    outputDirectory,
  );
  const ledger = createCaptureLedgerV12();
  const readPrivateJson = async (relativePath, label) =>
    JSON.parse((await capturePrivateEvidenceV12(
      path.join(root, relativePath),
      label,
      { expectedRoot: root, ledger },
    )).bytes.toString("utf8"));
  const [policy, archive, rejection, snapshot] = await Promise.all([
    readPrivateJson(CONTINUATION_V12_POLICY_PATH, "Round12 policy"),
    readPrivateJson(CONTINUATION_V12_BASELINE_ARCHIVE_PATH, "Round12 archive"),
    readPrivateJson(
      CONTINUATION_V12_ROUND11_REVIEW_REJECTION_PATH,
      "Round11 review rejection",
    ),
    readPrivateJson(CONTINUATION_V12_REVIEW_SNAPSHOT_PATH, "Round12 snapshot"),
  ]);
  assertNoErrors(validateRound11ReviewRejectionV12(rejection),
    "Round11 review rejection");
  assertNoErrors(validateContinuationPolicyV12(policy, {
    expectedDigest: policy.digest,
    baselineArchive: archive,
  }), "Round12 policy");
  assertNoErrors(validateBaselineArchiveV12(archive, policy), "Round12 archive");
  assertNoErrors(validateContinuationReviewSnapshotV12(snapshot, policy, {
    verifierNow: Date.now(),
  }), "Round12 snapshot");
  await postflightCaptureLedgerV12(ledger);

  const artifacts = buildReviewDispatchArtifactsV12({
    policy,
    snapshot,
    challenges,
  });
  const publications = [];
  for (const instruction of artifacts.instructions) {
    publications.push(await publishPrivateExactV12(
      path.join(outputRoot, instruction.filename),
      instruction.bytes,
      { label: `Round12 ${instruction.lane} review instruction` },
    ));
  }
  const dispatchPath = path.join(outputRoot, "dispatch-set.json");
  publications.push(await publishPrivateExactV12(
    dispatchPath,
    Buffer.from(`${JSON.stringify(artifacts.entries, null, 2)}\n`, "utf8"),
    { label: "Round12 caller dispatch set" },
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
  buildConversationDisclosureReviewDispatchV12(
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
