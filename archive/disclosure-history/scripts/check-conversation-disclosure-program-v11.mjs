#!/usr/bin/env node

import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  CONTINUATION_V11_FEATURE_ID,
  CONTINUATION_V11_GOVERNANCE_TRANSITION_TRUST_ROOTS,
  CONTINUATION_V11_POLICY_PATH,
  CONTINUATION_V11_REJECTED_OUTPUT_ABSENT_PATHS,
  CONTINUATION_V11_REVIEW_SNAPSHOT_PATH,
  CONTINUATION_V11_SUCCESSOR_FEATURE_ID,
  CONTINUATION_V11_SUCCESSOR_WORKSTREAM_ID,
  CONTINUATION_V11_WORKSTREAM_ID,
  canonicalJsonV11,
  sha256BytesV11,
} from "./conversation-disclosure-continuation-contract-v11.mjs";
import {
  P107A_V11_COMPLETION_ARTIFACTS,
} from "./conversation-disclosure-program-governance-v11.mjs";
import {
  runConversationDisclosureContinuationCheckerV11,
} from "./check-conversation-disclosure-continuation-v11.mjs";

export async function checkConversationDisclosureProgramV11({
  repositoryRoot = process.cwd(),
  baseAnchor = process.env.ZEROX_CD03A_BASE_ANCHOR,
  expectedBaseAnchorDigest = process.env.ZEROX_CD03A_BASE_ANCHOR_DIGEST,
  continuationAnchor = process.env.ZEROX_CD03A_CONTINUATION_ANCHOR,
  expectedContinuationAnchorDigest =
    process.env.ZEROX_CD03A_CONTINUATION_ANCHOR_DIGEST,
} = {}) {
  const root = await canonicalRepositoryRoot(repositoryRoot);
  const [program, featureList] = await Promise.all([
    readJson(root, ".zerox/conversation-disclosure-program.json", "Program"),
    readJson(root, ".zerox/feature_list.json", "Feature list"),
  ]);
  const workstream = program.workstreams?.find(
    (entry) => entry?.id === CONTINUATION_V11_WORKSTREAM_ID,
  );
  const successorWorkstream = program.workstreams?.find(
    (entry) => entry?.id === CONTINUATION_V11_SUCCESSOR_WORKSTREAM_ID,
  );
  const feature = featureList.features?.find(
    (entry) => entry?.id === CONTINUATION_V11_FEATURE_ID,
  );
  const successorFeature = featureList.features?.find(
    (entry) => entry?.id === CONTINUATION_V11_SUCCESSOR_FEATURE_ID,
  );
  const errors = [];

  if (canonicalJsonV11(workstream?.completionArtifacts)
    !== canonicalJsonV11(P107A_V11_COMPLETION_ARTIFACTS)) {
    errors.push("P107A completionArtifacts are not the exact Round11 closure set");
  }
  const rejected = new Set(CONTINUATION_V11_REJECTED_OUTPUT_ABSENT_PATHS);
  for (const relativePath of workstream?.completionArtifacts ?? []) {
    if (rejected.has(relativePath)) {
      errors.push(`P107A completionArtifact is a rejected output: ${relativePath}`);
    }
  }
  for (const relativePath of CONTINUATION_V11_REJECTED_OUTPUT_ABSENT_PATHS) {
    if (await exists(path.join(root, relativePath))) {
      errors.push(`rejected continuation output is present: ${relativePath}`);
    }
  }

  const reviewState = workstream?.state === "in_progress"
    && feature?.status === "in_progress"
    && successorWorkstream?.state === "planned"
    && successorFeature === undefined
    && program.activeFeatureId === CONTINUATION_V11_FEATURE_ID
    && program.nextFeatureId === CONTINUATION_V11_FEATURE_ID;
  const anchoredPlannedState = workstream?.state === "completed"
    && feature?.status === "done"
    && successorWorkstream?.state === "planned"
    && successorFeature === undefined
    && program.activeFeatureId === null
    && program.nextFeatureId === CONTINUATION_V11_SUCCESSOR_FEATURE_ID;
  const authorizedActiveState = workstream?.state === "completed"
    && feature?.status === "done"
    && successorWorkstream?.state === "in_progress"
    && successorFeature?.status === "in_progress"
    && program.activeFeatureId === CONTINUATION_V11_SUCCESSOR_FEATURE_ID
    && program.nextFeatureId === CONTINUATION_V11_SUCCESSOR_FEATURE_ID;
  if (!reviewState && !anchoredPlannedState && !authorizedActiveState) {
    errors.push("P107A/P108 lifecycle is not an admitted V11 state");
  }
  if (successorFeature?.status === "done") {
    errors.push("P108 completion requires a separately reviewed delta head");
  }
  if (reviewState) {
    for (const transition of CONTINUATION_V11_GOVERNANCE_TRANSITION_TRUST_ROOTS) {
      try {
        const live = await readFile(path.join(root, transition.path));
        const staged = await readFile(
          path.join(root, transition.stagedTargetPath),
        );
        if (sha256BytesV11(live) !== transition.fromSha256
          || sha256BytesV11(staged) !== transition.toSha256) {
          errors.push(`review transition bytes are not exact: ${transition.path}`);
        }
      } catch {
        errors.push(`review transition input is missing: ${transition.path}`);
      }
    }
  }

  if (workstream?.state === "completed") {
    for (const relativePath of P107A_V11_COMPLETION_ARTIFACTS) {
      try {
        const entry = await lstat(path.join(root, relativePath));
        if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1) {
          throw new Error("not a single-link regular file");
        }
        if (relativePath.endsWith(".json")) {
          JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
        }
      } catch {
        errors.push(`completed P107A artifact is missing or invalid: ${relativePath}`);
      }
    }
    if (!path.isAbsolute(baseAnchor ?? "")
      || !/^sha256:[0-9a-f]{64}$/.test(expectedBaseAnchorDigest ?? "")
      || !path.isAbsolute(continuationAnchor ?? "")
      || !/^sha256:[0-9a-f]{64}$/.test(
        expectedContinuationAnchorDigest ?? "",
      )) {
      errors.push(
        "completed P107A requires caller-pinned base and continuation anchor environment",
      );
    } else if (errors.length === 0) {
      const [policy, snapshot] = await Promise.all([
        readJson(root, CONTINUATION_V11_POLICY_PATH, "Round11 policy"),
        readJson(root, CONTINUATION_V11_REVIEW_SNAPSHOT_PATH, "Round11 snapshot"),
      ]);
      try {
        await runConversationDisclosureContinuationCheckerV11([
          "--mode",
          anchoredPlannedState ? "anchored_planned" : "authorized_active",
          "--control-root",
          root,
          "--subject-repository-realpath",
          root,
          "--base-anchor",
          baseAnchor,
          "--expected-base-anchor-digest",
          expectedBaseAnchorDigest,
          "--expected-policy-digest",
          policy.digest,
          "--expected-snapshot-digest",
          snapshot.digest,
          "--continuation-anchor",
          continuationAnchor,
          "--expected-continuation-anchor-digest",
          expectedContinuationAnchorDigest,
        ]);
      } catch (error) {
        errors.push(
          `completed P107A closure validation failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }
  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }
  return {
    status: "passed",
    phase: reviewState
      ? "review"
      : anchoredPlannedState
        ? "anchored_planned"
        : "authorized_active",
    completionArtifactCount: P107A_V11_COMPLETION_ARTIFACTS.length,
    rejectedOutputCount: CONTINUATION_V11_REJECTED_OUTPUT_ABSENT_PATHS.length,
  };
}

async function readJson(root, relativePath, label) {
  try {
    return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
  } catch {
    throw new Error(`${label} is missing or invalid`);
  }
}

async function exists(candidate) {
  try {
    await lstat(candidate);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function canonicalRepositoryRoot(candidate) {
  const resolved = path.resolve(candidate);
  const canonical = await realpath(resolved);
  if (canonical !== resolved) {
    throw new Error("repository root must be canonical");
  }
  return canonical;
}

if (process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  checkConversationDisclosureProgramV11().then((result) => {
    process.stdout.write(
      `Conversation disclosure program V11 check passed (${result.phase}, ${result.completionArtifactCount} completion artifacts, ${result.rejectedOutputCount} rejected outputs).\n`,
    );
  }).catch((error) => {
    process.stderr.write("Conversation disclosure program V11 check failed:\n");
    process.stderr.write(`- ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
