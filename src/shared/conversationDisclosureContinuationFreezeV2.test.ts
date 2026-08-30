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
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";

const freezer = await import(
  // @ts-expect-error TypeScript does not synthesize declarations for this local mjs module.
  "../../scripts/freeze-conversation-disclosure-continuation-v2.mjs"
);
const contract = await import(
  // @ts-expect-error TypeScript does not synthesize declarations for this local mjs module.
  "../../scripts/conversation-disclosure-continuation-contract-v2.mjs"
);

const roots: string[] = [];
const verifierNow = Date.parse("2026-08-24T10:00:00.000Z");

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })));
});

describe("conversation disclosure continuation freezer v2", () => {
  it("publishes once and accepts only an exact idempotent rerun", async () => {
    const fixture = await createRepositoryFixture();
    const args = ["--expected-policy-digest", fixture.policy.digest];

    const first = await freezer.runContinuationFreezeV2(args, {
      cwd: fixture.root,
      verifierNow,
    });
    const second = await freezer.runContinuationFreezeV2(args, {
      cwd: fixture.root,
      verifierNow: verifierNow + 60_000,
    });
    const snapshotPath = path.join(
      fixture.root,
      contract.CONTINUATION_V2_REVIEW_SNAPSHOT_PATH,
    );

    expect(first.publicationStatus).toBe("published");
    expect(second.publicationStatus).toBe("idempotent");
    expect(second.snapshotDigest).toBe(first.snapshotDigest);
    expect((await stat(snapshotPath)).mode & 0o777).toBe(0o600);
  });

  it("requires the caller policy pin and rejects unknown CLI options", () => {
    expect(() => freezer.parseContinuationFreezeOptionsV2([])).toThrow(
      "requires one caller-pinned --expected-policy-digest",
    );
    expect(() => freezer.parseContinuationFreezeOptionsV2([
      "--expected-policy-digest",
      digestText("policy"),
      "--repo",
      "/tmp/candidate",
    ])).toThrow("unknown continuation freeze option: --repo");
  });

  it("rejects unknown and overlapping P107A coverage", () => {
    const unknownPolicy = coveragePolicy({ files: ["src/a.ts"] });
    expect(() => freezer.classifyAdmissionFilesV2(
      unknownPolicy,
      new Set(),
    )).toThrow("P107A path has no review coverage class: src/a.ts");

    const overlapPolicy = coveragePolicy({
      files: ["src/a.ts"],
      postReviewMutablePaths: ["src/a.ts"],
    });
    expect(() => freezer.classifyAdmissionFilesV2(
      overlapPolicy,
      new Set(["src/a.ts"]),
    )).toThrow("P107A path overlaps review coverage classes: src/a.ts");
  });

  it("rejects a preplanted receipt or review output", async () => {
    const fixture = await createRepositoryFixture();
    await writeRepositoryFile(fixture.root, fixture.receiptPath, "preplanted\n");

    await expect(freezer.runContinuationFreezeV2([
      "--expected-policy-digest",
      fixture.policy.digest,
    ], { cwd: fixture.root, verifierNow })).rejects.toThrow(
      `review output ${fixture.receiptPath} must be absent before continuation freeze`,
    );
  });

  it("rejects transition drift before publication", async () => {
    const fixture = await createRepositoryFixture();
    await writeRepositoryFile(fixture.root, "package.json", "transition drift\n");

    await expect(freezer.runContinuationFreezeV2([
      "--expected-policy-digest",
      fixture.policy.digest,
    ], { cwd: fixture.root, verifierNow })).rejects.toThrow(
      "transition live digest drift: package.json",
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

    await expect(freezer.runContinuationFreezeV2([
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
    await expect(freezer.captureStableRepositoryFileV2(
      fixture.root,
      "src/frozen.ts",
    )).rejects.toThrow("must be one non-symlink single-link regular file");

    await rm(frozenPath);
    await writeFile(frozenPath, "stable bytes\n");
    const capture = await freezer.captureStableRepositoryFileV2(
      fixture.root,
      "src/frozen.ts",
    );
    const replacement = path.join(fixture.root, "src/replacement.ts");
    await writeFile(replacement, "stable bytes\n");
    await rename(replacement, frozenPath);
    await expect(freezer.postflightFreezeCapturesV2([capture])).rejects.toThrow(
      "changed before freeze postflight",
    );
  });

  it("fails closed on existing third-state snapshot bytes", async () => {
    const fixture = await createRepositoryFixture();
    const args = ["--expected-policy-digest", fixture.policy.digest];
    await freezer.runContinuationFreezeV2(args, { cwd: fixture.root, verifierNow });
    const snapshotPath = path.join(
      fixture.root,
      contract.CONTINUATION_V2_REVIEW_SNAPSHOT_PATH,
    );
    const bytes = await readFile(snapshotPath);
    await writeFile(snapshotPath, Buffer.concat([bytes, Buffer.from(" ")]));
    await chmod(snapshotPath, 0o600);

    await expect(freezer.runContinuationFreezeV2(args, {
      cwd: fixture.root,
      verifierNow: verifierNow + 1,
    })).rejects.toThrow("existing continuation snapshot has third-state bytes");
  });

  it("rejects a future snapshot timestamp", () => {
    expect(() => freezer.assertFrozenAtV2(
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
  const created = await mkdtemp(path.join(os.tmpdir(), "cd03a-freezer-v2-"));
  const root = await realpath(created);
  roots.push(root);
  const programId = "conversation-progressive-disclosure-v3.9.2-test";
  const receiptPath =
    ".zerox/verification/conversation-disclosure/CD03A-round2-contract-review.json";
  const admissionWorkstream = stableWorkstream(
    contract.CONTINUATION_V2_WORKSTREAM_ID,
    contract.CONTINUATION_V2_FEATURE_ID,
    ["CD03"],
  );
  const historicalWorkstream = stableWorkstream("CD03", "P107", []);
  const successorWorkstream = stableWorkstream(
    contract.CONTINUATION_V2_SUCCESSOR_WORKSTREAM_ID,
    contract.CONTINUATION_V2_SUCCESSOR_FEATURE_ID,
    [contract.CONTINUATION_V2_WORKSTREAM_ID],
  );
  const transitions = createTransitions();
  for (const [index, transition] of transitions.entries()) {
    await writeRepositoryFile(root, transition.path, `transition-live-${index}\n`);
    await writeRepositoryFile(root, transition.stagedTargetPath,
      `transition-target-${index}\n`);
    transition.fromSha256 = digestBytes(Buffer.from(`transition-live-${index}\n`));
    transition.toSha256 = digestBytes(Buffer.from(`transition-target-${index}\n`));
  }
  await writeRepositoryFile(root, "src/frozen.ts", "stable bytes\n");
  await writeRepositoryFile(root, "src/existing.ts", "existing baseline\n");
  const round1EvidencePaths = [
    contract.CONTINUATION_V2_ROUND1_POLICY_PATH,
    contract.CONTINUATION_V2_ROUND1_SNAPSHOT_PATH,
    ...contract.CONTINUATION_V2_REVIEW_LANES.map(
      (lane: string) =>
        `.zerox/verification/conversation-disclosure/CD03A-round1-${lane}-review.json`,
    ),
  ];
  for (const relativePath of round1EvidencePaths) {
    await writeRepositoryFile(
      root,
      relativePath,
      await readFile(path.join(process.cwd(), relativePath)),
    );
  }

  const admissionFiles = [
    contract.CONTINUATION_V2_POLICY_PATH,
    contract.CONTINUATION_V2_BASELINE_ARCHIVE_PATH,
    ...round1EvidencePaths,
    "src/frozen.ts",
    "package.json",
    ".zerox/conversation-disclosure-program.json",
    ".zerox/feature_list.json",
    contract.CONTINUATION_V2_REVIEW_SNAPSHOT_PATH,
    receiptPath,
  ];
  const admissionFeature = stableFeature(
    contract.CONTINUATION_V2_FEATURE_ID,
    admissionFiles,
  );
  const historicalFeature = {
    id: "P107",
    definitionOfDone: ["historical completion remains anchored"],
  };
  const liveAdmissionFeature = { ...admissionFeature, status: "in_progress" };
  const liveHistoricalFeature = { ...historicalFeature, status: "done" };
  const workstreams = [
    { ...admissionWorkstream, state: "in_progress" },
    { ...historicalWorkstream, state: "completed" },
    { ...successorWorkstream, state: "planned" },
  ];
  const program = {
    programId,
    activeFeatureId: contract.CONTINUATION_V2_FEATURE_ID,
    nextFeatureId: contract.CONTINUATION_V2_FEATURE_ID,
    workstreams,
  };
  const featureList = { features: [liveAdmissionFeature, liveHistoricalFeature] };
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
      allowedPhases: [...contract.CONTINUATION_V2_LIFECYCLE_PHASES],
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
    contract.CONTINUATION_V2_SUCCESSOR_FEATURE_ID,
    successorFiles,
  );
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
    contract.CONTINUATION_V2_REVIEW_SNAPSHOT_PATH,
  ].sort();
  const transitionLivePaths = new Set(transitions.map((entry) => entry.path));
  const reviewCoverage = admissionFiles.map((entry) => ({
    path: entry,
    class: transitionLivePaths.has(entry)
      ? "transition_live"
      : postReviewMutablePaths.includes(entry)
        ? "post_review_mutable"
        : reviewOutputPaths.includes(entry)
          ? "review_output_absent"
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
    historicalWorkstream,
    historicalFeature,
    programId,
  });
  const archive = createArchive(programId, pathAuthorities, transitions);
  await writeRepositoryJson(
    root,
    contract.CONTINUATION_V2_BASELINE_ARCHIVE_PATH,
    archive,
  );
  const baselineArchive = {
    path: contract.CONTINUATION_V2_BASELINE_ARCHIVE_PATH,
    digest: archive.digest,
    entrySetDigest: archive.entrySetDigest,
  };
  const executablePaths = {
    checker: "scripts/check-conversation-disclosure-continuation-v2.mjs",
    contract: "scripts/conversation-disclosure-continuation-contract-v2.mjs",
    freezer: "scripts/freeze-conversation-disclosure-continuation-v2.mjs",
    governance: "scripts/conversation-disclosure-program-governance-v2.mjs",
    runner: "scripts/verify-conversation-disclosure-continuation-v2.mjs",
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
    schemaVersion: 2,
    kind: contract.CONTINUATION_V2_POLICY_KIND,
    algorithm: contract.CONTINUATION_V2_ALGORITHM,
    policyId: contract.CONTINUATION_V2_POLICY_ID,
    programId,
    workstreamId: contract.CONTINUATION_V2_WORKSTREAM_ID,
    featureId: contract.CONTINUATION_V2_FEATURE_ID,
    round: contract.CONTINUATION_V2_ROUND,
    status: "frozen",
    parentEvidence,
    round1Rejection: createRound1Rejection(),
    closedWorld,
    admission,
    successor,
    pathAuthorities,
    trustRoots,
    governanceTransitions: transitions,
    continuationExecutables,
    baselineArchive,
    reviewSnapshot: { path: contract.CONTINUATION_V2_REVIEW_SNAPSHOT_PATH },
    timePolicy: { futureToleranceMs: 0 },
  });
  await writeRepositoryJson(root, contract.CONTINUATION_V2_POLICY_PATH, policy);
  return { root, policy, receiptPath };
}

function createClosedWorld({
  admission,
  successor,
  historicalWorkstream,
  historicalFeature,
  programId,
}: Record<string, any>) {
  const workstreamDefinitions = [
    admission.workstreamDefinition,
    historicalWorkstream,
    successor.workstreamDefinition,
  ];
  const workstreams = workstreamDefinitions.map((stableDefinition) => ({
    id: stableDefinition.id,
    stableDefinition,
    stableDefinitionDigest: contract.hashCanonical(stableDefinition),
  }));
  const historicalFeatures = [{
    id: historicalFeature.id,
    stableDefinition: historicalFeature,
    stableDefinitionDigest: contract.hashCanonical(historicalFeature),
    requiredStatus: "done",
  }];
  const featureIds = [
    contract.CONTINUATION_V2_SUCCESSOR_FEATURE_ID,
    contract.CONTINUATION_V2_FEATURE_ID,
    historicalFeature.id,
  ];
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
    workstreamStates: workstreams.map((entry) => ({
      id: entry.id,
      state: entry.id === contract.CONTINUATION_V2_WORKSTREAM_ID
        ? admissionState
        : entry.id === contract.CONTINUATION_V2_SUCCESSOR_WORKSTREAM_ID
          ? successorState
          : "completed",
    })),
    featureStates: featureIds.map((id) => id === contract.CONTINUATION_V2_FEATURE_ID
      ? { id, presence: "present", status: admissionStatus }
      : id === contract.CONTINUATION_V2_SUCCESSOR_FEATURE_ID
        ? { id, presence: successorPresence, status: successorStatus }
        : { id, presence: "present", status: "done" }),
  });
  const programRootDefinition = {
    programId,
    scenarioMatrix: [],
    workstreams: workstreamDefinitions,
  };
  const withoutDigest = {
    workstreams,
    historicalFeatures,
    lifecycleProfiles: [
      profile("review_pre_transition", "in_progress", "planned", "in_progress",
        "absent", null, contract.CONTINUATION_V2_FEATURE_ID,
        contract.CONTINUATION_V2_FEATURE_ID),
      profile("review_post_transition", "in_progress", "planned", "in_progress",
        "absent", null, contract.CONTINUATION_V2_FEATURE_ID,
        contract.CONTINUATION_V2_FEATURE_ID),
      profile("anchored_planned", "completed", "planned", "done",
        "absent", null, null, contract.CONTINUATION_V2_SUCCESSOR_FEATURE_ID),
      profile("authorized_active", "completed", "in_progress", "done",
        "present", "in_progress", contract.CONTINUATION_V2_SUCCESSOR_FEATURE_ID,
        contract.CONTINUATION_V2_SUCCESSOR_FEATURE_ID),
    ],
    maxUnfinishedFeatures: 1,
    programRootDefinition,
    programRootDefinitionDigest: contract.hashCanonical(programRootDefinition),
  };
  return { ...withoutDigest, digest: contract.hashCanonical(withoutDigest) };
}

function createArchive(
  programId: string,
  pathAuthorities: Array<Record<string, any>>,
  transitions: Array<Record<string, any>>,
) {
  const entries = [
    ...pathAuthorities.filter((entry) => entry.class === "modify").map((entry) => ({
      path: entry.path,
      source: entry.baseline.source,
      sha256: entry.baseline.sha256,
      encoding: "gzip-base64-v1",
      bytes: gzipBase64(Buffer.from("existing baseline\n")),
    })),
    ...transitions.map((entry, index) => ({
      path: entry.path,
      source: "governance_transition",
      sha256: entry.fromSha256,
      encoding: "gzip-base64-v1",
      bytes: gzipBase64(Buffer.from(`transition-live-${index}\n`)),
    })),
  ].sort((left, right) => left.path.localeCompare(right.path));
  const withoutDigest = {
    schemaVersion: 2,
    kind: contract.CONTINUATION_V2_BASELINE_ARCHIVE_KIND,
    algorithm: contract.CONTINUATION_V2_ALGORITHM,
    programId,
    workstreamId: contract.CONTINUATION_V2_WORKSTREAM_ID,
    featureId: contract.CONTINUATION_V2_FEATURE_ID,
    round: contract.CONTINUATION_V2_ROUND,
    entries,
    entrySetDigest: contract.hashCanonical(entries),
  };
  return { ...withoutDigest, digest: contract.hashCanonical(withoutDigest) };
}

function createParentEvidence() {
  const receipts = contract.CONTINUATION_V2_REVIEW_LANES.map((lane: string) => ({
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
    ...contract.CONTINUATION_V2_REQUIRED_PARENT_REPOSITORY_PATHS,
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

function createTransitions() {
  return Object.entries(contract.CONTINUATION_V2_GOVERNANCE_TRANSITIONS)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([livePath, kind], index) => ({
      path: livePath,
      kind,
      stagedTargetPath:
        `.zerox/verification/conversation-disclosure/freezer-target-${index}.bin`,
      fromSha256: digestText(`placeholder-from-${index}`),
      toSha256: digestText(`placeholder-to-${index}`),
    }));
}

function stableWorkstream(id: string, featureId: string, dependsOn: string[]) {
  return { id, featureId, title: `${id} workstream`, dependsOn };
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
  const trustRoot = contract.CONTINUATION_V2_ROUND1_REJECTION_TRUST_ROOT;
  const withoutDigest = {
    round: 1,
    status: "rejected",
    policy: {
      path: contract.CONTINUATION_V2_ROUND1_POLICY_PATH,
      ...trustRoot.policy,
    },
    snapshot: {
      path: contract.CONTINUATION_V2_ROUND1_SNAPSHOT_PATH,
      ...trustRoot.snapshot,
    },
    receipts: contract.CONTINUATION_V2_REVIEW_LANES.map((lane: string) => ({
      lane,
      path: `.zerox/verification/conversation-disclosure/CD03A-round1-${lane}-review.json`,
      verdict: "failed",
      findingCounts: trustRoot.receipts[lane].findingCounts,
      canonicalDigest: trustRoot.receipts[lane].canonicalDigest,
      byteSha256: trustRoot.receipts[lane].byteSha256,
    })),
    forbiddenRepositoryOutputs: [
      ...contract.CONTINUATION_V2_ROUND1_FORBIDDEN_OUTPUT_PATHS,
    ],
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
