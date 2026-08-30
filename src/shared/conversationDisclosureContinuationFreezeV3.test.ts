import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";

const freezer = await import(
  // @ts-expect-error TypeScript does not synthesize declarations for this local mjs module.
  "../../scripts/freeze-conversation-disclosure-continuation-v3.mjs"
);
const contract = await import(
  // @ts-expect-error TypeScript does not synthesize declarations for this local mjs module.
  "../../scripts/conversation-disclosure-continuation-contract-v3.mjs"
);
const contractV2 = await import(
  // @ts-expect-error TypeScript does not synthesize declarations for this local mjs module.
  "../../scripts/conversation-disclosure-continuation-contract-v2.mjs"
);

const roots: string[] = [];
const verifierNow = Date.parse("2026-08-24T10:00:00.000Z");
type TransitionFixture = {
  path: string;
  kind: string;
  stagedTargetPath: string;
  fromSha256: string;
  toSha256: string;
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })));
});

describe("conversation disclosure continuation freezer v3", () => {
  it("publishes once and accepts only an exact idempotent rerun", async () => {
    const fixture = await createRepositoryFixture();
    const args = ["--expected-policy-digest", fixture.policy.digest];

    const first = await freezer.runContinuationFreezeV3(args, {
      cwd: fixture.root,
      verifierNow,
    });
    const second = await freezer.runContinuationFreezeV3(args, {
      cwd: fixture.root,
      verifierNow: verifierNow + 60_000,
    });
    const snapshotPath = path.join(
      fixture.root,
      contract.CONTINUATION_V3_REVIEW_SNAPSHOT_PATH,
    );

    expect(first.publicationStatus).toBe("published");
    expect(second.publicationStatus).toBe("idempotent");
    expect(second.snapshotDigest).toBe(first.snapshotDigest);
    expect((await stat(snapshotPath)).mode & 0o777).toBe(0o600);
    const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
    expect(snapshot.transitionPayloadFiles).toHaveLength(4);
    expect(snapshot.frozenFiles.some((entry: { path: string }) =>
      snapshot.transitionPayloadFiles.some(
        (payload: { path: string }) => payload.path === entry.path,
      ))).toBe(false);
    expect(contract.validateContinuationReviewSnapshotV3(
      snapshot,
      fixture.policy,
      { verifierNow: verifierNow + 60_000 },
    )).toEqual([]);
  });

  it("requires the caller policy pin and rejects unknown CLI options", () => {
    expect(() => freezer.parseContinuationFreezeOptionsV3([])).toThrow(
      "requires one caller-pinned --expected-policy-digest",
    );
    expect(() => freezer.parseContinuationFreezeOptionsV3([
      "--expected-policy-digest",
      digestText("policy"),
      "--repo",
      "/tmp/candidate",
    ])).toThrow("unknown continuation freeze option: --repo");
  });

  it("rejects incomplete and duplicate authoritative P107A coverage", () => {
    const unknownPolicy = coveragePolicy({ files: ["src/a.ts"] });
    unknownPolicy.admissionCoverage = [];
    expect(() => freezer.classifyAdmissionFilesV3(
      unknownPolicy,
      new Set(),
    )).toThrow("must exactly classify the sorted P107A file roster");

    const overlapPolicy = coveragePolicy({
      files: ["src/a.ts"],
    });
    overlapPolicy.admissionCoverage.push({
      path: "src/a.ts",
      class: "post_review_mutable",
    });
    expect(() => freezer.classifyAdmissionFilesV3(
      overlapPolicy,
      new Set(["src/a.ts"]),
    )).toThrow("must exactly classify the sorted P107A file roster");
  });

  it("rejects a preplanted receipt or review output", async () => {
    const fixture = await createRepositoryFixture();
    await writeRepositoryFile(fixture.root, fixture.receiptPath, "preplanted\n");

    await expect(freezer.runContinuationFreezeV3([
      "--expected-policy-digest",
      fixture.policy.digest,
    ], { cwd: fixture.root, verifierNow })).rejects.toThrow(
      `review output ${fixture.receiptPath} must be absent before continuation freeze`,
    );
  });

  it("rejects transition drift before publication", async () => {
    const fixture = await createRepositoryFixture();
    await writeRepositoryFile(fixture.root, "package.json", "transition drift\n");

    await expect(freezer.runContinuationFreezeV3([
      "--expected-policy-digest",
      fixture.policy.digest,
    ], { cwd: fixture.root, verifierNow })).rejects.toThrow(
      "Round2 rejection witness drift: package.json",
    );
  });

  it("rejects bookkeeping baseline byte tamper before publication", async () => {
    const fixture = await createRepositoryFixture();
    const programPath = ".zerox/conversation-disclosure-program.json";
    const bytes = await readFile(path.join(fixture.root, programPath));
    await writeRepositoryFile(
      fixture.root,
      programPath,
      Buffer.concat([bytes, Buffer.from(" ")]),
    );

    await expect(freezer.runContinuationFreezeV3([
      "--expected-policy-digest",
      fixture.policy.digest,
    ], { cwd: fixture.root, verifierNow })).rejects.toThrow(
      `bookkeeping baseline digest drift: ${programPath}`,
    );
  });

  it.each([
    {
      name: "unknown completed Feature",
      mutate: async (root: string) => {
        const featureList = await readRepositoryJson(root, ".zerox/feature_list.json");
        featureList.features.push({
          id: "P999-completed-candidate",
          definitionOfDone: ["candidate"],
          status: "done",
        });
        await writeRepositoryJson(root, ".zerox/feature_list.json", featureList);
      },
      expected: "unknown or absent live Feature: P999-completed-candidate",
    },
    {
      name: "unknown unfinished Feature",
      mutate: async (root: string) => {
        const featureList = await readRepositoryJson(root, ".zerox/feature_list.json");
        featureList.features.push({
          id: "P999-unfinished-candidate",
          definitionOfDone: ["candidate"],
          status: "in_progress",
        });
        await writeRepositoryJson(root, ".zerox/feature_list.json", featureList);
      },
      expected: "unknown or absent live Feature: P999-unfinished-candidate",
    },
    {
      name: "unknown workstream",
      mutate: async (root: string) => {
        const program = await readRepositoryJson(
          root,
          ".zerox/conversation-disclosure-program.json",
        );
        program.workstreams.push({
          id: "CD99",
          featureId: "P999",
          title: "candidate workstream",
          dependsOn: [],
          state: "completed",
        });
        await writeRepositoryJson(
          root,
          ".zerox/conversation-disclosure-program.json",
          program,
        );
      },
      expected: "unknown live workstream: CD99",
    },
    {
      name: "reordered Feature roster",
      mutate: async (root: string) => {
        const featureList = await readRepositoryJson(root, ".zerox/feature_list.json");
        featureList.features.reverse();
        await writeRepositoryJson(root, ".zerox/feature_list.json", featureList);
      },
      expected: "live Feature ids must match the anchored order",
    },
    {
      name: "duplicate Feature roster",
      mutate: async (root: string) => {
        const featureList = await readRepositoryJson(root, ".zerox/feature_list.json");
        featureList.features.push(structuredClone(featureList.features[0]));
        await writeRepositoryJson(root, ".zerox/feature_list.json", featureList);
      },
      expected: "live Feature ids must be non-empty and unique",
    },
  ])("rejects raw live inventory drift: $name", async ({ mutate, expected }) => {
    const fixture = await createRepositoryFixture();
    await mutate(fixture.root);

    await expect(freezer.runContinuationFreezeV3([
      "--expected-policy-digest",
      fixture.policy.digest,
    ], { cwd: fixture.root, verifierNow })).rejects.toThrow(expected);
  });

  it("rejects symlink capture and postflight inode replacement", async () => {
    const fixture = await createRepositoryFixture();
    const frozenPath = path.join(fixture.root, "src/frozen.ts");
    const targetPath = path.join(fixture.root, "src/symlink-target.ts");
    await writeFile(targetPath, "target\n");
    await rm(frozenPath);
    await symlink(targetPath, frozenPath);
    await expect(freezer.captureStableRepositoryFileV3(
      fixture.root,
      "src/frozen.ts",
    )).rejects.toThrow("must be one non-symlink single-link regular file");

    await rm(frozenPath);
    await writeFile(frozenPath, "stable bytes\n");
    const capture = await freezer.captureStableRepositoryFileV3(
      fixture.root,
      "src/frozen.ts",
    );
    const replacement = path.join(fixture.root, "src/replacement.ts");
    await writeFile(replacement, "stable bytes\n");
    await rename(replacement, frozenPath);
    await expect(freezer.postflightFreezeCapturesV3([capture])).rejects.toThrow(
      "changed before freeze postflight",
    );
  });

  it("fails closed on existing third-state snapshot bytes", async () => {
    const fixture = await createRepositoryFixture();
    const args = ["--expected-policy-digest", fixture.policy.digest];
    await freezer.runContinuationFreezeV3(args, { cwd: fixture.root, verifierNow });
    const snapshotPath = path.join(
      fixture.root,
      contract.CONTINUATION_V3_REVIEW_SNAPSHOT_PATH,
    );
    const bytes = await readFile(snapshotPath);
    await writeFile(snapshotPath, Buffer.concat([bytes, Buffer.from(" ")]));
    await chmod(snapshotPath, 0o600);

    await expect(freezer.runContinuationFreezeV3(args, {
      cwd: fixture.root,
      verifierNow: verifierNow + 1,
    })).rejects.toThrow("existing continuation snapshot has third-state bytes");
  });

  it("rejects a future snapshot timestamp", () => {
    expect(() => freezer.assertFrozenAtV3(
      new Date(verifierNow + 1).toISOString(),
      verifierNow,
    )).toThrow("continuation snapshot frozenAt must not be in the future");
  });
});

function coveragePolicy({
  files,
  postReviewMutablePaths = [],
  reviewOutputPaths = [],
}: {
  files: string[];
  postReviewMutablePaths?: string[];
  reviewOutputPaths?: string[];
}) {
  const coverage = files.map((entry) => ({
    path: entry,
    class: postReviewMutablePaths.includes(entry)
      ? "post_review_mutable"
      : reviewOutputPaths.includes(entry)
        ? "review_output_absent"
        : "frozen_file",
  })).sort((left, right) => left.path.localeCompare(right.path));
  return {
    admissionCoverage: coverage,
    admission: {
      featureDefinition: { files },
      postReviewMutablePaths,
      reviewOutputPaths,
      reviewCoverageDigest: contract.hashCanonical(coverage),
    },
    governanceTransitions: [],
  };
}

async function createRepositoryFixture() {
  const created = await mkdtemp(path.join(os.tmpdir(), "cd03a-freezer-v3-"));
  const root = await realpath(created);
  roots.push(root);
  const sourceProgram = JSON.parse(await readFile(
    path.join(process.cwd(), ".zerox/conversation-disclosure-program.json"),
    "utf8",
  ));
  const sourceFeatureList = JSON.parse(await readFile(
    path.join(process.cwd(), ".zerox/feature_list.json"),
    "utf8",
  ));
  const programId = sourceProgram.programId;
  const receiptPath =
    ".zerox/verification/conversation-disclosure/CD03A-round3-contract-review.json";
  const admissionWorkstream = contract.stableWorkstreamDefinitionV3(
    sourceProgram.workstreams.find(
      (entry: { id: string }) => entry.id === contract.CONTINUATION_V3_WORKSTREAM_ID,
    ),
  );
  const successorWorkstream = contract.stableWorkstreamDefinitionV3(
    sourceProgram.workstreams.find(
      (entry: { id: string }) => entry.id === contract.CONTINUATION_V3_SUCCESSOR_WORKSTREAM_ID,
    ),
  );
  const transitions = createTransitions();
  const archivedTransitionBytes = await loadArchivedTransitionBytes(transitions);
  for (const transition of transitions) {
    await writeRepositoryFile(
      root,
      transition.path,
      archivedTransitionBytes.get(transition.path)!,
    );
    await writeRepositoryFile(
      root,
      transition.stagedTargetPath,
      await readFile(path.join(process.cwd(), transition.stagedTargetPath)),
    );
  }
  await writeRepositoryFile(root, "src/frozen.ts", "stable bytes\n");
  await writeRepositoryFile(root, "src/existing.ts", "existing baseline\n");
  const round1EvidencePaths = [
    contractV2.CONTINUATION_V2_ROUND1_POLICY_PATH,
    contractV2.CONTINUATION_V2_ROUND1_SNAPSHOT_PATH,
    ...contract.CONTINUATION_V3_REVIEW_LANES.map(
      (lane: string) =>
        `.zerox/verification/conversation-disclosure/CD03A-round1-${lane}-review.json`,
    ),
  ];
  const round2Witness = createRound2PrefreezeRejection(programId);
  const round2ReferencePaths = [
    round2Witness.sourcePolicy.path,
    round2Witness.baselineArchive.path,
    ...round2Witness.continuationExecutables.map((entry: { path: string }) => entry.path),
    ...round2Witness.liveTransitionFiles.map((entry: { path: string }) => entry.path),
    ...round2Witness.transitionPayloadFiles.map((entry: { path: string }) => entry.path),
  ];
  for (const relativePath of [...new Set([
    ...round1EvidencePaths,
    ...round2ReferencePaths,
  ])]) {
    await writeRepositoryFile(
      root,
      relativePath,
      archivedTransitionBytes.get(relativePath)
        ?? await readFile(path.join(process.cwd(), relativePath)),
    );
  }
  await writeRepositoryFile(
    root,
    contract.CONTINUATION_V3_ROUND2_PREFREEZE_REJECTION_PATH,
    `${JSON.stringify(round2Witness, null, 2)}\n`,
  );
  await chmod(
    path.join(root, contract.CONTINUATION_V3_ROUND2_PREFREEZE_REJECTION_PATH),
    0o600,
  );

  const admissionFiles = [...new Set([
    contract.CONTINUATION_V3_POLICY_PATH,
    contract.CONTINUATION_V3_BASELINE_ARCHIVE_PATH,
    ...round1EvidencePaths,
    ...round2ReferencePaths,
    contract.CONTINUATION_V3_ROUND2_PREFREEZE_REJECTION_PATH,
    ...contract.CONTINUATION_V3_ROUND2_FORBIDDEN_OUTPUT_PATHS,
    "src/frozen.ts",
    ...transitions.flatMap((entry) => [entry.path, entry.stagedTargetPath]),
    ".zerox/conversation-disclosure-program.json",
    ".zerox/feature_list.json",
    contract.CONTINUATION_V3_REVIEW_SNAPSHOT_PATH,
    receiptPath,
  ])].sort();
  const admissionFeature = stableFeature(
    contract.CONTINUATION_V3_FEATURE_ID,
    admissionFiles,
  );
  const liveAdmissionFeature = { ...admissionFeature, status: "in_progress" };
  const program = {
    ...sourceProgram,
    activeFeatureId: contract.CONTINUATION_V3_FEATURE_ID,
    nextFeatureId: contract.CONTINUATION_V3_FEATURE_ID,
    workstreams: sourceProgram.workstreams.map((entry: Record<string, any>) => ({ ...entry })),
  };
  const featureList = {
    ...sourceFeatureList,
    features: sourceFeatureList.features.map((entry: Record<string, any>) =>
      entry.id === contract.CONTINUATION_V3_FEATURE_ID ? liveAdmissionFeature : { ...entry }),
  };
  const programBytes = await writeRepositoryJson(
    root,
    ".zerox/conversation-disclosure-program.json",
    program,
  );
  await writeRepositoryJson(root, ".zerox/feature_list.json", featureList);

  const pathAuthorities = [
    {
      class: "bookkeeping",
      path: ".zerox/conversation-disclosure-program.json",
      baseline: {
        source: "cd03a_review_snapshot",
        presence: "present",
        sha256: digestBytes(programBytes),
      },
      validator: "conversation_program_projection_v2",
      allowedPhases: [...contract.CONTINUATION_V3_LIFECYCLE_PHASES],
    },
    {
      class: "create",
      path: "src/new.ts",
      baseline: { source: "cd03a_review_absence", sha256: null },
    },
    {
      class: "modify",
      path: "src/existing.ts",
      baseline: {
        source: "cd03a_review_snapshot",
        sha256: digestText("existing baseline\n"),
      },
    },
  ].sort((left, right) => left.path.localeCompare(right.path));
  const successorFiles = [
    ...pathAuthorities.map((entry) => entry.path),
    ...transitions.map((entry) => entry.path),
  ].sort();
  const successorFeature = stableFeature(
    contract.CONTINUATION_V3_SUCCESSOR_FEATURE_ID,
    successorFiles,
  );
  successorFeature.verification = [
    contract.CONTINUATION_V3_SUCCESSOR_CHECKER_VERIFICATION,
    contract.CONTINUATION_V3_SUCCESSOR_HARNESS_VERIFICATION,
  ];
  const successorCoverage = [
    ...pathAuthorities.map((entry) => ({ path: entry.path, class: entry.class })),
    ...transitions.map((entry) => ({ path: entry.path, class: "governance_transition" })),
  ].sort((left, right) => left.path.localeCompare(right.path));
  const postReviewMutablePaths = [
    ".zerox/conversation-disclosure-program.json",
    ".zerox/feature_list.json",
  ];
  const reviewOutputPaths = [
    receiptPath,
    contract.CONTINUATION_V3_REVIEW_SNAPSHOT_PATH,
  ].sort();
  const transitionLivePaths = new Set(transitions.map((entry) => entry.path));
  const transitionPayloadPaths = new Set(
    transitions.map((entry) => entry.stagedTargetPath),
  );
  const rejectedOutputPaths = new Set(
    contract.CONTINUATION_V3_ROUND2_FORBIDDEN_OUTPUT_PATHS,
  );
  const reviewCoverage = admissionFiles.map((entry) => ({
    path: entry,
    class: transitionLivePaths.has(entry)
      ? "transition_live"
      : transitionPayloadPaths.has(entry)
        ? "transition_payload"
      : postReviewMutablePaths.includes(entry)
        ? "post_review_mutable"
        : reviewOutputPaths.includes(entry)
          ? "review_output_absent"
          : rejectedOutputPaths.has(entry)
            ? "rejected_output_absent"
          : "frozen_file",
  })).sort((left, right) => left.path.localeCompare(right.path));
  const admission = {
    workstreamDefinition: admissionWorkstream,
    workstreamDefinitionDigest: contract.hashCanonical(admissionWorkstream),
    featureDefinition: admissionFeature,
    featureDefinitionDigest: contract.hashCanonical(admissionFeature),
    featureFileSetDigest: contract.hashCanonical(admissionFeature.files),
    postReviewMutablePaths,
    reviewCoverageDigest: contract.hashCanonical(reviewCoverage),
    reviewOutputPaths,
  };
  const successor = {
    workstreamDefinition: successorWorkstream,
    workstreamDefinitionDigest: contract.hashCanonical(successorWorkstream),
    featureDefinition: successorFeature,
    featureDefinitionDigest: contract.hashCanonical(successorFeature),
    pathCoverageDigest: contract.hashCanonical(successorCoverage),
  };
  const closedWorld = createClosedWorld({
    admission,
    successor,
    program,
    featureList,
  });
  const archive = await createArchive(
    programId,
    pathAuthorities,
    transitions,
    archivedTransitionBytes,
  );
  await writeRepositoryJson(
    root,
    contract.CONTINUATION_V3_BASELINE_ARCHIVE_PATH,
    archive,
  );
  const baselineArchive = {
    path: contract.CONTINUATION_V3_BASELINE_ARCHIVE_PATH,
    digest: archive.digest,
    entrySetDigest: archive.entrySetDigest,
  };
  const executablePaths = {
    checker: "scripts/check-conversation-disclosure-continuation-v3.mjs",
    contract: "scripts/conversation-disclosure-continuation-contract-v3.mjs",
    freezer: "scripts/freeze-conversation-disclosure-continuation-v3.mjs",
    governance: "scripts/conversation-disclosure-program-governance-v3.mjs",
    runner: "scripts/verify-conversation-disclosure-continuation-v3.mjs",
  };
  const trustDigestByPath = new Map<string, string>();
  for (const transition of transitions) {
    trustDigestByPath.set(transition.path, transition.toSha256);
  }
  for (const executablePath of Object.values(executablePaths)) {
    trustDigestByPath.set(executablePath, digestText(`trust:${executablePath}`));
  }
  const trustRoots = [...trustDigestByPath]
    .map(([entryPath, sha256]) => ({ path: entryPath, sha256 }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const continuationExecutables = Object.entries(executablePaths).map(
    ([kind, entryPath]) => ({
      kind,
      path: entryPath,
      sha256: trustDigestByPath.get(entryPath),
    }),
  );
  const parentEvidence = createParentEvidence();
  const policy = resign({
    schemaVersion: 3,
    kind: contract.CONTINUATION_V3_POLICY_KIND,
    algorithm: contract.CONTINUATION_V3_ALGORITHM,
    policyId: contract.CONTINUATION_V3_POLICY_ID,
    programId,
    workstreamId: contract.CONTINUATION_V3_WORKSTREAM_ID,
    featureId: contract.CONTINUATION_V3_FEATURE_ID,
    round: contract.CONTINUATION_V3_ROUND,
    status: "frozen",
    parentEvidence,
    round1Rejection: createRound1Rejection(),
    round2PrefreezeRejection: round2Witness,
    admissionCoverage: reviewCoverage,
    closedWorld,
    admission,
    successor,
    pathAuthorities,
    trustRoots,
    governanceTransitions: transitions,
    continuationExecutables,
    baselineArchive,
    reviewSnapshot: { path: contract.CONTINUATION_V3_REVIEW_SNAPSHOT_PATH },
    timePolicy: { futureToleranceMs: 0 },
  });
  await writeRepositoryJson(root, contract.CONTINUATION_V3_POLICY_PATH, policy);
  return { root, policy, receiptPath };
}

function createClosedWorld({
  admission,
  successor,
  program,
  featureList,
}: Record<string, any>) {
  const workstreams = program.workstreams.map((entry: Record<string, any>) => {
    const stableDefinition = contract.stableWorkstreamDefinitionV3(entry);
    return {
    id: stableDefinition.id,
    stableDefinition,
    stableDefinitionDigest: contract.hashCanonical(stableDefinition),
    };
  });
  const historicalFeatures = featureList.features.filter(
    (entry: Record<string, any>) => entry.id !== contract.CONTINUATION_V3_FEATURE_ID
      && entry.id !== contract.CONTINUATION_V3_SUCCESSOR_FEATURE_ID,
  ).map((entry: Record<string, any>) => {
    const stableDefinition = contract.stableHistoricalFeatureDefinitionV3(entry);
    return {
      id: entry.id,
      stableDefinition,
      stableDefinitionDigest: contract.hashCanonical(stableDefinition),
      requiredStatus: "done",
    };
  });
  const featureIds = [
    contract.CONTINUATION_V3_SUCCESSOR_FEATURE_ID,
    contract.CONTINUATION_V3_FEATURE_ID,
    ...historicalFeatures.map((entry: { id: string }) => entry.id),
  ];
  const baseWorkstreamStates = program.workstreams.map((entry: Record<string, any>) => ({
    id: entry.id,
    state: entry.state,
  }));
  const profile = (
    phase: string,
    admissionState: string,
    successorState: string,
    admissionStatus: string,
    successorPresence: string,
    successorStatus: string | null,
    activeFeatureId: string | null,
    nextFeatureId: string,
  ) => ({
    phase,
    activeFeatureId,
    nextFeatureId,
    workstreamStates: baseWorkstreamStates.map((entry: { id: string; state: string }) => ({
      id: entry.id,
      state: entry.id === contract.CONTINUATION_V3_WORKSTREAM_ID
        ? admissionState
        : entry.id === contract.CONTINUATION_V3_SUCCESSOR_WORKSTREAM_ID
          ? successorState
          : entry.state,
    })),
    featureStates: featureIds.map((id) => id === contract.CONTINUATION_V3_FEATURE_ID
      ? { id, presence: "present", status: admissionStatus }
      : id === contract.CONTINUATION_V3_SUCCESSOR_FEATURE_ID
        ? { id, presence: successorPresence, status: successorStatus }
        : { id, presence: "present", status: "done" }),
  });
  const programRootDefinition = contract.stableProgramRootDefinitionV3(program);
  const withoutDigest = {
    workstreams,
    historicalFeatures,
    lifecycleProfiles: [
      profile("review_pre_transition", "in_progress", "planned", "in_progress",
        "absent", null, contract.CONTINUATION_V3_FEATURE_ID,
        contract.CONTINUATION_V3_FEATURE_ID),
      profile("review_post_transition", "in_progress", "planned", "in_progress",
        "absent", null, contract.CONTINUATION_V3_FEATURE_ID,
        contract.CONTINUATION_V3_FEATURE_ID),
      profile("anchored_planned", "completed", "planned", "done",
        "absent", null, null, contract.CONTINUATION_V3_SUCCESSOR_FEATURE_ID),
      profile("authorized_active", "completed", "in_progress", "done",
        "present", "in_progress", contract.CONTINUATION_V3_SUCCESSOR_FEATURE_ID,
        contract.CONTINUATION_V3_SUCCESSOR_FEATURE_ID),
    ],
    maxUnfinishedFeatures: 1,
    programRootDefinition,
    programRootDefinitionDigest: contract.hashCanonical(programRootDefinition),
  };
  return { ...withoutDigest, digest: contract.hashCanonical(withoutDigest) };
}

async function loadArchivedTransitionBytes(
  transitions: TransitionFixture[],
): Promise<Map<string, Buffer>> {
  const archive = JSON.parse(await readFile(path.join(
    process.cwd(),
    contract.CONTINUATION_V3_BASELINE_ARCHIVE_PATH,
  ), "utf8"));
  const validationErrors = contract.validateBaselineArchiveV3(archive);
  if (validationErrors.length > 0) {
    throw new Error(`Round3 baseline archive is invalid: ${validationErrors.join("; ")}`);
  }
  const entries = archive.entries.filter(
    (entry: { source: string }) => entry.source === "governance_transition",
  );
  const expectedPaths = transitions.map((entry) => entry.path).sort();
  const archivedPaths = entries.map((entry: { path: string }) => entry.path).sort();
  if (JSON.stringify(archivedPaths) !== JSON.stringify(expectedPaths)) {
    throw new Error("Round3 archive governance-transition coverage is not exact");
  }
  const result = new Map<string, Buffer>();
  for (const transition of transitions) {
    const entry = entries.find(
      (candidate: { path: string }) => candidate.path === transition.path,
    );
    if (!entry || entry.encoding !== "gzip-base64-v1"
      || entry.sha256 !== transition.fromSha256) {
      throw new Error(`Round3 archived transition trust root drift: ${transition.path}`);
    }
    const bytes = gunzipSync(Buffer.from(entry.bytes, "base64"));
    if (digestBytes(bytes) !== transition.fromSha256) {
      throw new Error(`Round3 archived transition bytes are stale: ${transition.path}`);
    }
    result.set(transition.path, bytes);
  }
  return result;
}

async function createArchive(
  programId: string,
  pathAuthorities: Array<Record<string, any>>,
  transitions: Array<Record<string, any>>,
  archivedTransitionBytes: Map<string, Buffer>,
) {
  const entries = [
    ...pathAuthorities.filter((entry) => entry.class === "modify").map((entry) => ({
      path: entry.path,
      source: entry.baseline.source,
      sha256: entry.baseline.sha256,
      encoding: "gzip-base64-v1",
      bytes: gzipBase64(Buffer.from("existing baseline\n")),
    })),
    ...transitions.map((entry) => ({
      path: entry.path,
      source: "governance_transition",
      sha256: entry.fromSha256,
      encoding: "gzip-base64-v1",
      bytes: gzipBase64(archivedTransitionBytes.get(entry.path)!),
    })),
  ].sort((left, right) => left.path.localeCompare(right.path));
  const withoutDigest = {
    schemaVersion: 3,
    kind: contract.CONTINUATION_V3_BASELINE_ARCHIVE_KIND,
    algorithm: contract.CONTINUATION_V3_ALGORITHM,
    programId,
    workstreamId: contract.CONTINUATION_V3_WORKSTREAM_ID,
    featureId: contract.CONTINUATION_V3_FEATURE_ID,
    round: contract.CONTINUATION_V3_ROUND,
    entries,
    entrySetDigest: contract.hashCanonical(entries),
  };
  return { ...withoutDigest, digest: contract.hashCanonical(withoutDigest) };
}

function createParentEvidence() {
  const receipts = contract.CONTINUATION_V3_REVIEW_LANES.map((lane: string) => ({
    lane,
    path: `.zerox/verification/conversation-disclosure/CD03-round23-${lane}-review.json`,
    canonicalDigest: digestText(`parent receipt:${lane}`),
    challenge: digestText(`parent challenge:${lane}`),
  }));
  const artifact = {
    path: ".zerox/verification/conversation-disclosure/CD03-causal-shadow.json",
    byteSha256: digestText("parent artifact"),
  };
  const snapshot = {
    path: ".zerox/verification/conversation-disclosure/CD03-round23-review-snapshot.json",
    digest: digestText("parent snapshot"),
    fileCount: 1,
  };
  const closureManifest = {
    path: ".zerox/verification/conversation-disclosure/CD03-round23-closure-manifest.json",
    canonicalDigest: digestText("parent manifest"),
    status: "externally_attested",
  };
  const externalAttestation = {
    path: ".zerox/verification/conversation-disclosure/CD03-round23-external-attestation.json",
    canonicalDigest: digestText("parent attestation"),
  };
  const validator = {
    path: "scripts/check-conversation-disclosure-program.mjs",
    sha256: digestText("parent validator"),
  };
  const externalRunner = {
    path: "scripts/verify-conversation-disclosure-closure.mjs",
    sha256: digestText("parent runner"),
  };
  const paths = [...new Set([
    ...contractV2.CONTINUATION_V2_REQUIRED_PARENT_REPOSITORY_PATHS,
    artifact.path,
    snapshot.path,
    ...receipts.map((entry: { path: string }) => entry.path),
    closureManifest.path,
    externalAttestation.path,
    validator.path,
    externalRunner.path,
    ...Array.from({ length: 5 }, (_, index) =>
      `.zerox/verification/conversation-disclosure/parent.completed-${index}.marker`),
  ])].sort();
  const repositoryEvidence = paths.map((entryPath) => ({
    path: entryPath,
    sha256: entryPath === artifact.path
      ? artifact.byteSha256
      : entryPath === validator.path
        ? validator.sha256
        : entryPath === externalRunner.path
          ? externalRunner.sha256
          : digestText(`parent evidence:${entryPath}`),
  }));
  const externalEvidence = [
    { role: "base_anchor", basename: "base-anchor.json", sha256: digestText("base") },
    {
      role: "base_anchor_publication_marker",
      basename: "base.completed.marker",
      sha256: digestText("marker"),
    },
    {
      role: "external_runner_copy",
      basename: "runner.mjs",
      sha256: externalRunner.sha256,
    },
  ];
  const withoutDigest = {
    schemaVersion: 1,
    workstreamId: "CD03",
    featureId: "P107-conversation-disclosure-domain-adapters",
    round: 23,
    artifact,
    snapshot,
    receipts,
    closureManifest,
    externalAttestation,
    externalAnchor: { digest: digestText("parent anchor") },
    validator,
    externalRunner,
    repositoryEvidence,
    externalEvidence,
  };
  return { ...withoutDigest, bundleDigest: contract.hashCanonical(withoutDigest) };
}

function createTransitions(): TransitionFixture[] {
  return contract.CONTINUATION_V3_ROUND3_GOVERNANCE_TRANSITION_TRUST_ROOTS
    .map((source: TransitionFixture) => ({ ...source }));
}

function stableFeature(id: string, files: string[]) {
  return {
    id,
    priority: 100,
    title: `${id} Feature`,
    files,
    definitionOfDone: ["exact contract passes"],
    verification: ["focused tests pass"],
  };
}

function createRound1Rejection() {
  const trustRoot = contractV2.CONTINUATION_V2_ROUND1_REJECTION_TRUST_ROOT;
  const withoutDigest = {
    round: 1,
    status: "rejected",
    policy: {
      path: contractV2.CONTINUATION_V2_ROUND1_POLICY_PATH,
      ...trustRoot.policy,
    },
    snapshot: {
      path: contractV2.CONTINUATION_V2_ROUND1_SNAPSHOT_PATH,
      ...trustRoot.snapshot,
    },
    receipts: contract.CONTINUATION_V3_REVIEW_LANES.map((lane: string) => ({
      lane,
      path: `.zerox/verification/conversation-disclosure/CD03A-round1-${lane}-review.json`,
      verdict: "failed",
      findingCounts: trustRoot.receipts[lane].findingCounts,
      canonicalDigest: trustRoot.receipts[lane].canonicalDigest,
      byteSha256: trustRoot.receipts[lane].byteSha256,
    })),
    forbiddenRepositoryOutputs: [
      ...contractV2.CONTINUATION_V2_ROUND1_FORBIDDEN_OUTPUT_PATHS,
    ],
  };
  return { ...withoutDigest, digest: contract.hashCanonical(withoutDigest) };
}

function createRound2PrefreezeRejection(programId: string) {
  const withoutDigest = {
    schemaVersion: 3,
    kind: contract.CONTINUATION_V3_PREFREEZE_REJECTION_KIND,
    algorithm: contract.CONTINUATION_V3_ALGORITHM,
    programId,
    workstreamId: contract.CONTINUATION_V3_WORKSTREAM_ID,
    featureId: contract.CONTINUATION_V3_FEATURE_ID,
    rejectedRound: 2,
    recoveryRound: 3,
    status: "rejected_pre_freeze",
    sourcePolicy: {
      path: contract.CONTINUATION_V3_ROUND2_POLICY_PATH,
      ...contract.CONTINUATION_V3_ROUND2_POLICY_TRUST_ROOT,
    },
    baselineArchive: {
      path: contract.CONTINUATION_V3_ROUND2_BASELINE_ARCHIVE_PATH,
      ...contract.CONTINUATION_V3_ROUND2_ARCHIVE_TRUST_ROOT,
    },
    continuationExecutables: contract.CONTINUATION_V3_ROUND2_EXECUTABLE_TRUST_ROOTS
      .map((entry: Record<string, unknown>) => ({ ...entry })),
    governanceTransitions: contract.CONTINUATION_V3_ROUND2_TRANSITION_TRUST_ROOTS
      .map((entry: Record<string, unknown>) => ({ ...entry })),
    liveTransitionFiles: contract.CONTINUATION_V3_ROUND2_TRANSITION_TRUST_ROOTS
      .map((entry: { path: string; fromSha256: string }) => ({
        path: entry.path,
        sha256: entry.fromSha256,
      })).sort((left: { path: string }, right: { path: string }) =>
        left.path.localeCompare(right.path)),
    transitionPayloadFiles: contract.CONTINUATION_V3_ROUND2_TRANSITION_TRUST_ROOTS
      .map((entry: { stagedTargetPath: string; toSha256: string }) => ({
        path: entry.stagedTargetPath,
        sha256: entry.toSha256,
      })).sort((left: { path: string }, right: { path: string }) =>
        left.path.localeCompare(right.path)),
    verifiedAbsentPaths: [...contract.CONTINUATION_V3_ROUND2_FORBIDDEN_OUTPUT_PATHS],
    contradiction: contract.expectedRound2ContradictionV3(),
  };
  return { ...withoutDigest, digest: contract.hashCanonical(withoutDigest) };
}

function resign(value: Record<string, any>) {
  const withoutDigest = { ...value };
  delete withoutDigest.digest;
  return { ...withoutDigest, digest: contract.hashCanonical(withoutDigest) };
}

async function writeRepositoryJson(root: string, relativePath: string, value: unknown) {
  return writeRepositoryFile(root, relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function readRepositoryJson(root: string, relativePath: string) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

async function writeRepositoryFile(
  root: string,
  relativePath: string,
  value: string | Buffer,
) {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
  await writeFile(absolutePath, bytes);
  return bytes;
}

function gzipBase64(bytes: Buffer) {
  return gzipSync(bytes, { level: 9 }).toString("base64");
}

function digestText(value: string) {
  return digestBytes(Buffer.from(value));
}

function digestBytes(value: Buffer) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
