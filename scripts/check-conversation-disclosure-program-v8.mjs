#!/usr/bin/env node

import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  CONTINUATION_V8_FEATURE_ID,
  CONTINUATION_V8_POLICY_PATH,
  CONTINUATION_V8_REJECTED_OUTPUT_ABSENT_PATHS,
  CONTINUATION_V8_REVIEW_SNAPSHOT_PATH,
  CONTINUATION_V8_SUCCESSOR_FEATURE_ID,
  CONTINUATION_V8_SUCCESSOR_WORKSTREAM_ID,
  CONTINUATION_V8_WORKSTREAM_ID,
  canonicalJsonV8,
} from "./conversation-disclosure-continuation-contract-v8.mjs";
import {
  P107A_V8_COMPLETION_ARTIFACTS,
} from "./conversation-disclosure-program-governance-v8.mjs";
import {
  runConversationDisclosureContinuationCheckerV8,
} from "./check-conversation-disclosure-continuation-v8.mjs";

const BASE_ANCHOR =
  "/private/tmp/zerox-cd03-r23.YkhhKk/CD03-round23-external-anchor.json";
const BASE_ANCHOR_DIGEST =
  "sha256:e81f0afb3d10b12976b74d1499870b837595ffbc3b452c7f1f78fff67be8f102";

export async function checkConversationDisclosureProgramV8({
  repositoryRoot = process.cwd(),
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
    (entry) => entry?.id === CONTINUATION_V8_WORKSTREAM_ID,
  );
  const successorWorkstream = program.workstreams?.find(
    (entry) => entry?.id === CONTINUATION_V8_SUCCESSOR_WORKSTREAM_ID,
  );
  const feature = featureList.features?.find(
    (entry) => entry?.id === CONTINUATION_V8_FEATURE_ID,
  );
  const successorFeature = featureList.features?.find(
    (entry) => entry?.id === CONTINUATION_V8_SUCCESSOR_FEATURE_ID,
  );
  const errors = [];

  if (canonicalJsonV8(workstream?.completionArtifacts)
    !== canonicalJsonV8(P107A_V8_COMPLETION_ARTIFACTS)) {
    errors.push("P107A completionArtifacts are not the exact Round8 closure set");
  }
  const rejected = new Set(CONTINUATION_V8_REJECTED_OUTPUT_ABSENT_PATHS);
  for (const relativePath of workstream?.completionArtifacts ?? []) {
    if (rejected.has(relativePath)) {
      errors.push(`P107A completionArtifact is a rejected output: ${relativePath}`);
    }
  }
  for (const relativePath of CONTINUATION_V8_REJECTED_OUTPUT_ABSENT_PATHS) {
    if (await exists(path.join(root, relativePath))) {
      errors.push(`rejected continuation output is present: ${relativePath}`);
    }
  }

  const reviewState = workstream?.state === "in_progress"
    && feature?.status === "in_progress"
    && successorWorkstream?.state === "planned"
    && successorFeature === undefined
    && program.activeFeatureId === CONTINUATION_V8_FEATURE_ID
    && program.nextFeatureId === CONTINUATION_V8_FEATURE_ID;
  const anchoredPlannedState = workstream?.state === "completed"
    && feature?.status === "done"
    && successorWorkstream?.state === "planned"
    && successorFeature === undefined
    && program.activeFeatureId === null
    && program.nextFeatureId === CONTINUATION_V8_SUCCESSOR_FEATURE_ID;
  const authorizedActiveState = workstream?.state === "completed"
    && feature?.status === "done"
    && successorWorkstream?.state === "in_progress"
    && successorFeature?.status === "in_progress"
    && program.activeFeatureId === CONTINUATION_V8_SUCCESSOR_FEATURE_ID
    && program.nextFeatureId === CONTINUATION_V8_SUCCESSOR_FEATURE_ID;
  if (!reviewState && !anchoredPlannedState && !authorizedActiveState) {
    errors.push("P107A/P108 lifecycle is not an admitted V8 state");
  }
  if (successorFeature?.status === "done") {
    errors.push("P108 completion requires a separately reviewed delta head");
  }

  if (workstream?.state === "completed") {
    for (const relativePath of P107A_V8_COMPLETION_ARTIFACTS) {
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
    if (!path.isAbsolute(continuationAnchor ?? "")
      || !/^sha256:[0-9a-f]{64}$/.test(
        expectedContinuationAnchorDigest ?? "",
      )) {
      errors.push(
        "completed P107A requires caller-pinned continuation anchor environment",
      );
    } else if (errors.length === 0) {
      const [policy, snapshot] = await Promise.all([
        readJson(root, CONTINUATION_V8_POLICY_PATH, "Round8 policy"),
        readJson(root, CONTINUATION_V8_REVIEW_SNAPSHOT_PATH, "Round8 snapshot"),
      ]);
      try {
        await runConversationDisclosureContinuationCheckerV8([
          "--mode",
          anchoredPlannedState ? "anchored_planned" : "authorized_active",
          "--control-root",
          root,
          "--subject-repository-realpath",
          root,
          "--base-anchor",
          BASE_ANCHOR,
          "--expected-base-anchor-digest",
          BASE_ANCHOR_DIGEST,
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
    completionArtifactCount: P107A_V8_COMPLETION_ARTIFACTS.length,
    rejectedOutputCount: CONTINUATION_V8_REJECTED_OUTPUT_ABSENT_PATHS.length,
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
  checkConversationDisclosureProgramV8().then((result) => {
    process.stdout.write(
      `Conversation disclosure program V8 check passed (${result.phase}, ${result.completionArtifactCount} completion artifacts, ${result.rejectedOutputCount} rejected outputs).\n`,
    );
  }).catch((error) => {
    process.stderr.write("Conversation disclosure program V8 check failed:\n");
    process.stderr.write(`- ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
