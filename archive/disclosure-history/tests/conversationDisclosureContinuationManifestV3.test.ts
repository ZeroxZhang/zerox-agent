import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const contract = await import(
  // @ts-expect-error TypeScript does not synthesize declarations for this local mjs module.
  "../../scripts/conversation-disclosure-continuation-contract-v3.mjs"
);
const contractV2 = await import(
  // @ts-expect-error TypeScript does not synthesize declarations for this local mjs module.
  "../../scripts/conversation-disclosure-continuation-contract-v2.mjs"
);

const execFileAsync = promisify(execFile);
const repositoryRoot = process.cwd();
const builderPath = path.join(
  repositoryRoot,
  "scripts/build-conversation-disclosure-continuation-manifest-v3.mjs",
);
const policyPath =
  ".zerox/verification/conversation-disclosure/CD03A-round3-successor-evolution-policy.json";
const snapshotPath =
  ".zerox/verification/conversation-disclosure/CD03A-round3-review-snapshot.json";
const checkerPath = "scripts/check-conversation-disclosure-continuation-v3.mjs";
const runnerPath = "scripts/verify-conversation-disclosure-continuation-v3.mjs";
const attestationPath =
  ".zerox/verification/conversation-disclosure/CD03A-round3-external-attestation.json";
const lanes = ["contract", "runtime", "governance"] as const;
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })));
});

describe("conversation disclosure continuation manifest v3 builder", () => {
  it("builds one deterministic pending manifest on stdout", async () => {
    const fixture = await createFixture();

    const first = await runBuilder(fixture);
    const second = await runBuilder(fixture);
    const manifest = JSON.parse(first);

    expect(second).toBe(first);
    expect(manifest).toMatchObject({
      schemaVersion: 3,
      kind: "conversation-disclosure-continuation-closure-manifest",
      status: "review_passed_pending_external_anchor",
      policy: { path: policyPath, digest: fixture.policy.digest },
      snapshot: { path: snapshotPath, digest: fixture.snapshot.digest },
      validator: { path: checkerPath, sha256: fixture.checkerDigest },
      externalRunner: { path: runnerPath, sha256: fixture.runnerDigest },
      externalAttestation: { path: attestationPath, canonicalDigest: null },
    });
    expect(manifest.reviewReceipts.map((entry: { lane: string }) => entry.lane))
      .toEqual(lanes);
    expect(manifest.digest).toBe(hashCanonical(withoutDigest(manifest)));
  });

  it("rejects a failed receipt with a nonzero finding", async () => {
    const fixture = await createFixture({ failedLane: "runtime" });

    await expect(runBuilder(fixture)).rejects.toContain(
      "continuation review lane runtime must pass with zero findings",
    );
  });

  it.each(["lane", "task", "agent", "challenge"] as const)(
    "rejects non-independent %s identities",
    async (duplicate) => {
      const fixture = await createFixture({ duplicate });

      await expect(runBuilder(fixture)).rejects.toContain("review set validation failed");
    },
  );

  it("rejects review evidence completed in the future", async () => {
    const fixture = await createFixture({ futureLane: "governance" });

    await expect(runBuilder(fixture)).rejects.toContain(
      "continuation review receipt completedAt is later than trusted verifier time",
    );
  });

  it("rejects stale caller pins", async () => {
    const fixture = await createFixture();
    const args = replaceOption(
      fixture.args,
      "--expected-policy-digest",
      digest("f"),
    );

    await expect(runBuilder(fixture, args)).rejects.toContain(
      "policy canonical digest does not match caller pin",
    );
  });

  it("rejects a canonical but structurally incomplete policy", async () => {
    const fixture = await createFixture();
    const incomplete = structuredClone(fixture.policy);
    delete incomplete.closedWorld;
    const resigned = resign(incomplete);
    await writeRepoJson(fixture.root, policyPath, resigned);
    const args = replaceOption(
      fixture.args,
      "--expected-policy-digest",
      resigned.digest,
    );

    await expect(runBuilder(fixture, args)).rejects.toContain(
      "continuation policy must contain the exact v3 keys",
    );
  });

  it("rejects a canonical but structurally incomplete snapshot", async () => {
    const fixture = await createFixture();
    const incomplete = structuredClone(fixture.snapshot);
    delete incomplete.governanceTransitions;
    const resigned = resign(incomplete);
    await writeRepoJson(fixture.root, snapshotPath, resigned);
    const args = replaceOption(
      fixture.args,
      "--expected-snapshot-digest",
      resigned.digest,
    );

    await expect(runBuilder(fixture, args)).rejects.toContain(
      "continuation review snapshot must contain the exact v3 keys",
    );
  });

  it("rejects a stale baseline archive binding", async () => {
    const fixture = await createFixture();
    const staleArchive = resign({
      ...fixture.archive,
      programId: "stale-program",
    });
    await writeRepoJson(
      fixture.root,
      contract.CONTINUATION_V3_BASELINE_ARCHIVE_PATH,
      staleArchive,
    );

    await expect(runBuilder(fixture)).rejects.toContain(
      "baseline archive policy reference is stale",
    );
  });

  it("rejects stale live Feature and lifecycle bindings", async () => {
    const fixture = await createFixture();
    const staleFeatureList = structuredClone(fixture.featureList);
    const admission = staleFeatureList.features.find(
      (entry: { id: string }) => entry.id === contract.CONTINUATION_V3_FEATURE_ID,
    );
    admission.files = [...admission.files, "scripts/unreviewed-authority.mjs"];
    await writeRepoJson(fixture.root, ".zerox/feature_list.json", staleFeatureList);

    await expect(runBuilder(fixture)).rejects.toContain(
      "live Feature definition drift",
    );

    await writeRepoJson(fixture.root, ".zerox/feature_list.json", fixture.featureList);
    const staleProgram = {
      ...fixture.program,
      activeFeatureId: null,
    };
    await writeRepoJson(
      fixture.root,
      ".zerox/conversation-disclosure-program.json",
      staleProgram,
    );
    await expect(runBuilder(fixture)).rejects.toContain(
      "live lifecycle active/next Feature ids differ from the profile",
    );
  });

  it("rejects transition payload drift after snapshot review", async () => {
    const fixture = await createFixture();
    const payloadPath = fixture.policy.governanceTransitions[0].stagedTargetPath;
    await writeRepoFile(fixture.root, payloadPath, "drifted payload\n");

    await expect(runBuilder(fixture)).rejects.toContain(
      `transition payload drift: ${payloadPath}`,
    );
  });

  it("rejects a reviewed baseline file tamper before manifest creation", async () => {
    const fixture = await createFixture();
    const baselinePath = "src/main/existing.ts";
    await writeRepoFile(fixture.root, baselinePath, "tampered reviewed baseline\n");

    await expect(runBuilder(fixture)).rejects.toContain(
      `snapshot baseline file drift: ${baselinePath}`,
    );
  });

  it("rechecks every Round2 witness reference before manifest creation", async () => {
    const fixture = await createFixture();
    const sourcePolicyPath = fixture.policy.round2PrefreezeRejection.sourcePolicy.path;
    await writeRepoFile(fixture.root, sourcePolicyPath, "drifted source policy\n");

    await expect(runBuilder(fixture)).rejects.toContain(
      `Round2 rejection witness reference drift: ${sourcePolicyPath}`,
    );
  });

  it("creates a private output idempotently and rejects third-state bytes", async () => {
    const fixture = await createFixture();
    const output = path.join(fixture.root, "pending-manifest.json");
    const args = [...fixture.args, "--output", output];

    await expect(runBuilder(fixture, args)).resolves.toBe("");
    expect((await stat(output)).mode & 0o777).toBe(0o600);
    const exact = await readFile(output);
    await expect(runBuilder(fixture, args)).resolves.toBe("");
    expect(await readFile(output)).toEqual(exact);

    await writeFile(output, "third-state bytes\n");
    await chmod(output, 0o600);
    await expect(runBuilder(fixture, args)).rejects.toContain(
      "output contains third-state bytes",
    );
    expect(await readFile(output, "utf8")).toBe("third-state bytes\n");
  });
});

type Lane = typeof lanes[number];
type FixtureOptions = {
  failedLane?: Lane;
  futureLane?: Lane;
  duplicate?: "lane" | "task" | "agent" | "challenge";
};
type TransitionFixture = {
  path: string;
  kind: string;
  stagedTargetPath: string;
  fromSha256: string;
  toSha256: string;
};
type Fixture = {
  root: string;
  args: string[];
  archive: Record<string, any> & { digest: string };
  policy: Record<string, any> & { digest: string };
  snapshot: Record<string, any> & { digest: string };
  program: Record<string, any>;
  featureList: Record<string, any>;
  checkerDigest: string;
  runnerDigest: string;
};

async function createFixture(options: FixtureOptions = {}): Promise<Fixture> {
  const created = await mkdtemp(path.join(os.tmpdir(), "cd03a-manifest-v3-test-"));
  const root = await realpath(created);
  roots.push(root);

  const checkerBytes = "export const checker = 'fixture';\n";
  const runnerBytes = "export const runner = 'fixture';\n";
  await writeRepoFile(root, checkerPath, checkerBytes);
  await writeRepoFile(root, runnerPath, runnerBytes);
  const checkerDigest = sha256(checkerBytes);
  const runnerDigest = sha256(runnerBytes);

  const sourceProgram = JSON.parse(await readFile(
    path.join(repositoryRoot, ".zerox/conversation-disclosure-program.json"),
    "utf8",
  ));
  const sourceFeatureList = JSON.parse(await readFile(
    path.join(repositoryRoot, ".zerox/feature_list.json"),
    "utf8",
  ));
  const programId = sourceProgram.programId;
  const round1Rejection = createRound1Rejection();
  const round2PrefreezeRejection = createRound2PrefreezeRejection(programId);
  const transitions = createTransitions();
  const archivedTransitionBytes = await loadArchivedTransitionBytes(transitions);
  for (const transition of transitions) {
    await writeRepoFile(
      root,
      transition.path,
      archivedTransitionBytes.get(transition.path)!,
    );
    await writeRepoFile(
      root,
      transition.stagedTargetPath,
      await readFile(path.join(repositoryRoot, transition.stagedTargetPath)),
    );
  }
  const rejectionReferencePaths = [
    round1Rejection.policy.path,
    round1Rejection.snapshot.path,
    ...round1Rejection.receipts.map((entry: { path: string }) => entry.path),
    round2PrefreezeRejection.sourcePolicy.path,
    round2PrefreezeRejection.baselineArchive.path,
    ...round2PrefreezeRejection.continuationExecutables
      .map((entry: { path: string }) => entry.path),
    ...round2PrefreezeRejection.liveTransitionFiles
      .map((entry: { path: string }) => entry.path),
    ...round2PrefreezeRejection.transitionPayloadFiles
      .map((entry: { path: string }) => entry.path),
  ];
  for (const relativePath of [...new Set(rejectionReferencePaths)]) {
    await writeRepoFile(
      root,
      relativePath,
      archivedTransitionBytes.get(relativePath)
        ?? await readFile(path.join(repositoryRoot, relativePath)),
    );
  }
  await writeRepoFile(
    root,
    contract.CONTINUATION_V3_ROUND2_PREFREEZE_REJECTION_PATH,
    `${JSON.stringify(round2PrefreezeRejection, null, 2)}\n`,
  );
  await chmod(
    path.join(root, contract.CONTINUATION_V3_ROUND2_PREFREEZE_REJECTION_PATH),
    0o600,
  );
  const implementationBytes: Record<string, Buffer> = {
    "src/main/existing.ts": Buffer.from("existing non-Round23 source\n"),
    "src/shared/base.ts": Buffer.from("Round23 protected source\n"),
  };
  for (const [relativePath, bytes] of Object.entries(implementationBytes)) {
    await writeRepoFile(root, relativePath, bytes);
  }
  const pathAuthorities: Array<Record<string, any>> = [
    {
      class: "modify",
      path: "src/main/existing.ts",
      baseline: {
        source: "cd03a_review_snapshot",
        sha256: sha256(implementationBytes["src/main/existing.ts"]!),
      },
    },
    {
      class: "create",
      path: "src/main/new.ts",
      baseline: { source: "cd03a_review_absence", sha256: null },
    },
    {
      class: "modify",
      path: "src/shared/base.ts",
      baseline: {
        source: "round23_review_snapshot",
        sha256: sha256(implementationBytes["src/shared/base.ts"]!),
      },
    },
  ];
  const executablePaths: Record<string, string> = {
    checker: checkerPath,
    contract: "scripts/conversation-disclosure-continuation-contract-v3.mjs",
    freezer: "scripts/freeze-conversation-disclosure-continuation-v3.mjs",
    governance: "scripts/conversation-disclosure-program-governance-v3.mjs",
    runner: runnerPath,
  };
  const targetDigestByPath = new Map<string, string>();
  for (const transition of transitions) {
    targetDigestByPath.set(transition.path, transition.toSha256);
  }
  for (const executablePath of Object.values(executablePaths)) {
    targetDigestByPath.set(
      executablePath,
      executablePath === checkerPath
        ? checkerDigest
        : executablePath === runnerPath
          ? runnerDigest
          : digestText(`trust:${executablePath}`),
    );
  }
  const trustRoots = [...targetDigestByPath]
    .map(([entryPath, sha256Value]) => ({ path: entryPath, sha256: sha256Value }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const continuationExecutables = Object.entries(executablePaths)
    .map(([kind, entryPath]) => ({
      kind,
      path: entryPath,
      sha256: targetDigestByPath.get(entryPath),
    }))
    .sort((left, right) => left.kind.localeCompare(right.kind));

  const successorFiles = [
    "package.json",
    "scripts/check-harness-state.mjs",
    "src/main/existing.ts",
    "src/main/new.ts",
    "src/shared/conversationDisclosureProgram.test.ts",
    "src/shared/packageScripts.test.ts",
    "src/shared/base.ts",
  ];
  const admissionFeature = createStableFeature(
    contract.CONTINUATION_V3_FEATURE_ID,
    [
      round1Rejection.policy.path,
      round1Rejection.snapshot.path,
      ...round1Rejection.receipts.map((entry: { path: string }) => entry.path),
      contract.CONTINUATION_V3_ROUND2_PREFREEZE_REJECTION_PATH,
      ...contract.CONTINUATION_V3_ROUND2_FORBIDDEN_OUTPUT_PATHS,
      ...transitions.map((entry) => entry.stagedTargetPath),
      contract.CONTINUATION_V3_REVIEW_SNAPSHOT_PATH,
    ],
  );
  const successorFeature = createStableFeature(
    contract.CONTINUATION_V3_SUCCESSOR_FEATURE_ID,
    successorFiles,
  );
  successorFeature.verification = [
    contract.CONTINUATION_V3_SUCCESSOR_CHECKER_VERIFICATION,
    contract.CONTINUATION_V3_SUCCESSOR_HARNESS_VERIFICATION,
  ];
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
  const coverage: Array<{ path: string; class: string }> = [
    ...pathAuthorities.map((entry) => ({ path: entry.path, class: entry.class })),
    ...transitions.map((entry) => ({
      path: entry.path,
      class: "governance_transition",
    })),
  ].filter((entry) => successorFiles.includes(entry.path))
    .sort((left, right) => left.path.localeCompare(right.path));
  const reviewOutputPaths = [contract.CONTINUATION_V3_REVIEW_SNAPSHOT_PATH];
  const transitionPayloadPaths = new Set(
    transitions.map((entry) => entry.stagedTargetPath),
  );
  const rejectedOutputPaths = new Set(
    contract.CONTINUATION_V3_ROUND2_FORBIDDEN_OUTPUT_PATHS,
  );
  const reviewCoverage = admissionFeature.files.map((entryPath: string) => ({
    path: entryPath,
    class: reviewOutputPaths.includes(entryPath)
      ? "review_output_absent"
      : transitionPayloadPaths.has(entryPath)
        ? "transition_payload"
        : rejectedOutputPaths.has(entryPath)
          ? "rejected_output_absent"
      : "frozen_file",
  })).sort((left: { path: string }, right: { path: string }) =>
    left.path.localeCompare(right.path));
  const admission = {
    workstreamDefinition: admissionWorkstream,
    workstreamDefinitionDigest: hashCanonical(admissionWorkstream),
    featureDefinition: admissionFeature,
    featureDefinitionDigest: hashCanonical(admissionFeature),
    featureFileSetDigest: hashCanonical(admissionFeature.files),
    postReviewMutablePaths: [],
    reviewCoverageDigest: hashCanonical(reviewCoverage),
    reviewOutputPaths,
  };
  const successor = {
    workstreamDefinition: successorWorkstream,
    workstreamDefinitionDigest: hashCanonical(successorWorkstream),
    featureDefinition: successorFeature,
    featureDefinitionDigest: hashCanonical(successorFeature),
    pathCoverageDigest: hashCanonical(coverage),
  };
  const rootFeatureList = {
    ...sourceFeatureList,
    features: sourceFeatureList.features.map((entry: Record<string, any>) =>
      entry.id === contract.CONTINUATION_V3_FEATURE_ID
        ? { ...admissionFeature, status: "in_progress" }
        : { ...entry }),
  };
  const closedWorld = createClosedWorld(admission, successor, sourceProgram, rootFeatureList);
  const parentEvidence = createParentEvidence();
  const archive = await createArchive(
    programId,
    pathAuthorities,
    transitions,
    implementationBytes,
    archivedTransitionBytes,
  );
  const baselineArchive = {
    path: contract.CONTINUATION_V3_BASELINE_ARCHIVE_PATH,
    digest: archive.digest,
    entrySetDigest: archive.entrySetDigest,
  };
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
    round1Rejection,
    round2PrefreezeRejection,
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
  const frozenAtMs = Date.now() - 60_000;
  const frozenFiles = [
    ...reviewCoverage.filter((entry: { class: string }) => entry.class === "frozen_file")
      .map((entry: { path: string }) => entry.path)
      .map((entryPath: string) => ({
      path: entryPath,
      sha256: round1EvidenceByteDigest(entryPath)
        ?? (entryPath === contract.CONTINUATION_V3_ROUND2_PREFREEZE_REJECTION_PATH
          ? sha256(`${JSON.stringify(round2PrefreezeRejection, null, 2)}\n`)
          : digestText(`frozen admission file:${entryPath}`)),
    })),
  ].sort((left, right) => left.path.localeCompare(right.path));
  const transitionPayloadFiles: Array<{ path: string; sha256: string }> = transitions.map((entry) => ({
    path: entry.stagedTargetPath,
    sha256: entry.toSha256,
  })).sort((left, right) => left.path.localeCompare(right.path));
  const baselineFiles = [
    {
      path: "src/main/existing.ts",
      sha256: pathAuthorities[0]!.baseline.sha256,
    },
  ];
  const snapshot = resign({
    schemaVersion: 3,
    kind: contract.CONTINUATION_V3_SNAPSHOT_KIND,
    algorithm: contract.CONTINUATION_V3_ALGORITHM,
    programId,
    workstreamId: contract.CONTINUATION_V3_WORKSTREAM_ID,
    featureId: contract.CONTINUATION_V3_FEATURE_ID,
    round: contract.CONTINUATION_V3_ROUND,
    frozenAt: new Date(frozenAtMs).toISOString(),
    policyDigest: policy.digest,
    parentEvidenceBundleDigest: parentEvidence.bundleDigest,
    closedWorldDigest: closedWorld.digest,
    pathAuthorityDigest: hashCanonical(pathAuthorities),
    admissionFeatureDefinitionDigest: admission.featureDefinitionDigest,
    admissionFeatureFileSetDigest: admission.featureFileSetDigest,
    successorWorkstreamDefinitionDigest: successor.workstreamDefinitionDigest,
    successorFeatureDefinitionDigest: successor.featureDefinitionDigest,
    baselineArchive,
    frozenFiles,
    transitionPayloadFiles,
    baselineFiles,
    absentPaths: [
      ...contractV2.CONTINUATION_V2_ROUND1_FORBIDDEN_OUTPUT_PATHS,
      ...contract.CONTINUATION_V3_ROUND2_FORBIDDEN_OUTPUT_PATHS,
      "src/main/new.ts",
    ].sort(),
    reviewOutputAbsentPaths: reviewOutputPaths,
    governanceTransitions: transitions,
  });
  const reviewProfile = closedWorld.lifecycleProfiles[0];
  const live = createLiveLifecycle(reviewProfile, closedWorld, admission, successor);
  const program = {
    ...sourceProgram,
    activeFeatureId: live.activeFeatureId,
    nextFeatureId: live.nextFeatureId,
    workstreams: live.workstreams,
  };
  const featureList = {
    ...sourceFeatureList,
    updatedAt: new Date(frozenAtMs).toISOString(),
    features: live.features,
  };
  await writeRepoJson(root, contract.CONTINUATION_V3_BASELINE_ARCHIVE_PATH, archive);
  await writeRepoJson(root, policyPath, policy);
  await writeRepoJson(root, snapshotPath, snapshot);
  await writeRepoJson(root, ".zerox/conversation-disclosure-program.json", program);
  await writeRepoJson(root, ".zerox/feature_list.json", featureList);

  const receiptByExpectedLane = new Map<Lane, Record<string, unknown>>();
  for (const [index, expectedLane] of lanes.entries()) {
    const lane = options.duplicate === "lane" && expectedLane === "governance"
      ? "runtime"
      : expectedLane;
    const duplicateIdentity = index === 2;
    const challengeCharacters = ["8", "9", "a"];
    const challenge = options.duplicate === "challenge" && duplicateIdentity
      ? digest("8")
      : digest(challengeCharacters[index]!);
    const failed = options.failedLane === expectedLane;
    const completedAt = options.futureLane === expectedLane
      ? new Date(Date.now() + 86_400_000).toISOString()
      : new Date(frozenAtMs + 30_000).toISOString();
    const receipt = {
      schemaVersion: 3,
      kind: contract.CONTINUATION_V3_RECEIPT_KIND,
      programId,
      workstreamId: contract.CONTINUATION_V3_WORKSTREAM_ID,
      featureId: contract.CONTINUATION_V3_FEATURE_ID,
      round: contract.CONTINUATION_V3_ROUND,
      lane,
      transport: "codex-collaboration",
      reviewTaskPath: options.duplicate === "task" && duplicateIdentity
        ? "/root/review_contract"
        : `/root/review_${expectedLane}`,
      reviewAgentId: options.duplicate === "agent" && duplicateIdentity
        ? "agent-contract"
        : `agent-${expectedLane}`,
      challenge,
      completedAt,
      snapshotDigest: snapshot.digest,
      snapshotFileCount: frozenFiles.length
        + transitionPayloadFiles.length + baselineFiles.length,
      policyDigest: policy.digest,
      parentEvidenceBundleDigest: parentEvidence.bundleDigest,
      closedWorldDigest: closedWorld.digest,
      pathAuthorityDigest: hashCanonical(pathAuthorities),
      admissionFeatureDefinitionDigest: admission.featureDefinitionDigest,
      admissionFeatureFileSetDigest: admission.featureFileSetDigest,
      successorWorkstreamDefinitionDigest: successor.workstreamDefinitionDigest,
      successorFeatureDefinitionDigest: successor.featureDefinitionDigest,
      reviewedPhase: "review_pre_transition",
      validatorDigest: checkerDigest,
      verdict: failed ? "failed" : "passed",
      findingCounts: { critical: 0, major: failed ? 1 : 0, minor: 0 },
      findings: failed ? [{
        id: "M-1",
        severity: "major",
        summary: "fixture finding",
        evidence: ["fixture:1"],
      }] : [],
    };
    receiptByExpectedLane.set(expectedLane, receipt);
    await writeRepoJson(
      root,
      `.zerox/verification/conversation-disclosure/CD03A-round3-${expectedLane}-review.json`,
      receipt,
    );
  }

  const args = [
    "--expected-policy-digest", policy.digest,
    "--expected-snapshot-digest", snapshot.digest,
    "--expected-external-runner-digest", runnerDigest,
    "--expected-checker-digest", checkerDigest,
    ...lanes.flatMap((lane) => {
      const receipt = receiptByExpectedLane.get(lane)!;
      return [
        "--expected-review-receipt", `${lane}=${hashCanonical(receipt)}`,
        "--expected-review-challenge", `${lane}=${String(receipt.challenge)}`,
      ];
    }),
  ];
  return {
    root,
    args,
    archive,
    policy,
    snapshot,
    program,
    featureList,
    checkerDigest,
    runnerDigest,
  };
}

function createParentEvidence() {
  const artifact = {
    path: ".zerox/verification/conversation-disclosure/CD03-causal-shadow.json",
    byteSha256: digestText("Round23 artifact"),
  };
  const parentSnapshot = {
    path: ".zerox/verification/conversation-disclosure/CD03-round23-review-snapshot.json",
    digest: digestText("Round23 snapshot"),
    fileCount: 101,
  };
  const receipts = lanes.map((lane) => ({
    lane,
    path: `.zerox/verification/conversation-disclosure/CD03-round23-${lane}-review.json`,
    canonicalDigest: digestText(`Round23 receipt:${lane}`),
    challenge: digestText(`Round23 challenge:${lane}`),
  }));
  const closureManifest = {
    path: ".zerox/verification/conversation-disclosure/CD03-round23-closure-manifest.json",
    canonicalDigest: digestText("Round23 manifest"),
    status: "externally_attested",
  };
  const externalAttestation = {
    path: ".zerox/verification/conversation-disclosure/CD03-round23-external-attestation.json",
    canonicalDigest: digestText("Round23 attestation"),
  };
  const validator = {
    path: "scripts/check-conversation-disclosure-program.mjs",
    sha256: digestText("Round23 validator"),
  };
  const externalRunner = {
    path: "scripts/verify-conversation-disclosure-closure.mjs",
    sha256: digestText("Round23 runner"),
  };
  const repositoryPaths = [
    ...contractV2.CONTINUATION_V2_REQUIRED_PARENT_REPOSITORY_PATHS,
    ...receipts.map((entry) => entry.path),
    ...Array.from({ length: 5 }, (_, index) =>
      `.zerox/verification/conversation-disclosure/CD03-round23-transaction-${index}.completed-${index}.marker`),
  ].sort();
  const repositoryEvidence = [...new Set(repositoryPaths)].map((entryPath) => ({
    path: entryPath,
    sha256: entryPath === artifact.path
      ? artifact.byteSha256
      : entryPath === validator.path
        ? validator.sha256
        : entryPath === externalRunner.path
          ? externalRunner.sha256
          : digestText(`repository evidence:${entryPath}`),
  }));
  const externalEvidence = [
    {
      role: "base_anchor",
      basename: "CD03-round23-external-anchor.json",
      sha256: digestText("external base anchor bytes"),
    },
    {
      role: "base_anchor_publication_marker",
      basename: "CD03-round23-anchor.completed.marker",
      sha256: digestText("external publication marker bytes"),
    },
    {
      role: "external_runner_copy",
      basename: "verify-conversation-disclosure-closure.mjs",
      sha256: externalRunner.sha256,
    },
  ];
  const withoutBundleDigest = {
    schemaVersion: 1,
    workstreamId: "CD03",
    featureId: "P107-conversation-disclosure-domain-adapters",
    round: 23,
    artifact,
    snapshot: parentSnapshot,
    receipts,
    closureManifest,
    externalAttestation,
    externalAnchor: { digest: digestText("Round23 external anchor") },
    validator,
    externalRunner,
    repositoryEvidence,
    externalEvidence,
  };
  return {
    ...withoutBundleDigest,
    bundleDigest: hashCanonical(withoutBundleDigest),
  };
}

function createRound1Rejection() {
  const trustRoot = contractV2.CONTINUATION_V2_ROUND1_REJECTION_TRUST_ROOT;
  const withoutDigestValue = {
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
    receipts: lanes.map((lane) => ({
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
  return { ...withoutDigestValue, digest: hashCanonical(withoutDigestValue) };
}

function round1EvidenceByteDigest(relativePath: string): string | undefined {
  const rejection = createRound1Rejection();
  return [rejection.policy, rejection.snapshot, ...rejection.receipts]
    .find((entry) => entry.path === relativePath)?.byteSha256;
}

function createRound2PrefreezeRejection(programId: string) {
  const withoutDigestValue = {
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
      })).sort(comparePath),
    transitionPayloadFiles: contract.CONTINUATION_V3_ROUND2_TRANSITION_TRUST_ROOTS
      .map((entry: { stagedTargetPath: string; toSha256: string }) => ({
        path: entry.stagedTargetPath,
        sha256: entry.toSha256,
      })).sort(comparePath),
    verifiedAbsentPaths: [...contract.CONTINUATION_V3_ROUND2_FORBIDDEN_OUTPUT_PATHS],
    contradiction: contract.expectedRound2ContradictionV3(),
  };
  return { ...withoutDigestValue, digest: hashCanonical(withoutDigestValue) };
}

function comparePath(left: { path: string }, right: { path: string }) {
  return left.path.localeCompare(right.path);
}

function createClosedWorld(
  admission: Record<string, any>,
  successor: Record<string, any>,
  program: Record<string, any>,
  featureList: Record<string, any>,
) {
  const workstreams = program.workstreams.map((entry: Record<string, any>) => {
    const stableDefinition = contract.stableWorkstreamDefinitionV3(entry);
    return {
      id: stableDefinition.id,
      stableDefinition,
      stableDefinitionDigest: hashCanonical(stableDefinition),
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
      stableDefinitionDigest: hashCanonical(stableDefinition),
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
      ...entry,
      state: entry.id === contract.CONTINUATION_V3_WORKSTREAM_ID
        ? admissionState
        : entry.id === contract.CONTINUATION_V3_SUCCESSOR_WORKSTREAM_ID
          ? successorState
          : entry.state,
    })),
    featureStates: featureIds.map((id: string) => {
      if (id === contract.CONTINUATION_V3_FEATURE_ID) {
        return { id, presence: "present", status: admissionStatus };
      }
      if (id === contract.CONTINUATION_V3_SUCCESSOR_FEATURE_ID) {
        return { id, presence: successorPresence, status: successorStatus };
      }
      return { id, presence: "present", status: "done" };
    }),
  });
  const programRootDefinition = contract.stableProgramRootDefinitionV3(program);
  const withoutDigestValue = {
    workstreams,
    historicalFeatures,
    lifecycleProfiles: [
      profile(
        "review_pre_transition",
        "in_progress",
        "planned",
        "in_progress",
        "absent",
        null,
        contract.CONTINUATION_V3_FEATURE_ID,
        contract.CONTINUATION_V3_FEATURE_ID,
      ),
      profile(
        "review_post_transition",
        "in_progress",
        "planned",
        "in_progress",
        "absent",
        null,
        contract.CONTINUATION_V3_FEATURE_ID,
        contract.CONTINUATION_V3_FEATURE_ID,
      ),
      profile(
        "anchored_planned",
        "completed",
        "planned",
        "done",
        "absent",
        null,
        null,
        contract.CONTINUATION_V3_SUCCESSOR_FEATURE_ID,
      ),
      profile(
        "authorized_active",
        "completed",
        "in_progress",
        "done",
        "present",
        "in_progress",
        contract.CONTINUATION_V3_SUCCESSOR_FEATURE_ID,
        contract.CONTINUATION_V3_SUCCESSOR_FEATURE_ID,
      ),
    ],
    maxUnfinishedFeatures: 1,
    programRootDefinition,
    programRootDefinitionDigest: hashCanonical(programRootDefinition),
  };
  return { ...withoutDigestValue, digest: hashCanonical(withoutDigestValue) };
}

function createLiveLifecycle(
  profile: Record<string, any>,
  closedWorld: Record<string, any>,
  admission: Record<string, any>,
  successor: Record<string, any>,
) {
  const featureDefinitions = new Map([
    ...closedWorld.historicalFeatures.map((entry: Record<string, any>) =>
      [entry.id, entry.stableDefinition]),
    [contract.CONTINUATION_V3_FEATURE_ID, admission.featureDefinition],
    [contract.CONTINUATION_V3_SUCCESSOR_FEATURE_ID, successor.featureDefinition],
  ]);
  return {
    phase: profile.phase,
    activeFeatureId: profile.activeFeatureId,
    nextFeatureId: profile.nextFeatureId,
    workstreams: closedWorld.workstreams.map((entry: Record<string, any>) => ({
      ...entry.stableDefinition,
      state: profile.workstreamStates.find(
        (state: { id: string }) => state.id === entry.id,
      ).state,
    })),
    features: profile.featureStates.filter(
      (state: { presence: string }) => state.presence === "present",
    ).map((state: { id: string; status: string }) => ({
      ...(featureDefinitions.get(state.id) as Record<string, any>),
      status: state.status,
    })),
  };
}

async function loadArchivedTransitionBytes(
  transitions: TransitionFixture[],
): Promise<Map<string, Buffer>> {
  const archive = JSON.parse(await readFile(path.join(
    repositoryRoot,
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
    if (sha256(bytes) !== transition.fromSha256) {
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
  implementationBytes: Record<string, Buffer>,
  archivedTransitionBytes: Map<string, Buffer>,
) {
  const rawByPath = new Map<string, Buffer>();
  for (const authority of pathAuthorities) {
    if (authority.class === "modify") {
      rawByPath.set(authority.path, implementationBytes[authority.path]!);
    }
  }
  for (const transition of transitions) {
    rawByPath.set(transition.path, archivedTransitionBytes.get(transition.path)!);
  }
  const entries = [
    ...pathAuthorities.filter((entry) => entry.class === "modify").map((entry) => ({
      path: entry.path,
      source: entry.baseline.source,
      sha256: entry.baseline.sha256,
      encoding: "gzip-base64-v1",
      bytes: gzipBase64(rawByPath.get(entry.path)!),
    })),
    ...transitions.map((entry) => ({
      path: entry.path,
      source: "governance_transition",
      sha256: entry.fromSha256,
      encoding: "gzip-base64-v1",
      bytes: gzipBase64(rawByPath.get(entry.path)!),
    })),
  ].sort((left, right) => left.path.localeCompare(right.path));
  const withoutDigestValue = {
    schemaVersion: 3,
    kind: contract.CONTINUATION_V3_BASELINE_ARCHIVE_KIND,
    algorithm: contract.CONTINUATION_V3_ALGORITHM,
    programId,
    workstreamId: contract.CONTINUATION_V3_WORKSTREAM_ID,
    featureId: contract.CONTINUATION_V3_FEATURE_ID,
    round: contract.CONTINUATION_V3_ROUND,
    entries,
    entrySetDigest: hashCanonical(entries),
  };
  return { ...withoutDigestValue, digest: hashCanonical(withoutDigestValue) };
}

function createTransitions(): TransitionFixture[] {
  return contract.CONTINUATION_V3_ROUND3_GOVERNANCE_TRANSITION_TRUST_ROOTS
    .map((entry: TransitionFixture) => ({ ...entry }));
}

function createStableFeature(id: string, files: string[]) {
  return {
    id,
    priority: 100,
    title: `${id} Feature`,
    files,
    definitionOfDone: ["exact contract passes"],
    verification: ["focused tests pass"],
  };
}

function gzipBase64(bytes: Buffer) {
  return gzipSync(bytes, { level: 9 }).toString("base64");
}

function digestText(value: string) {
  return sha256(Buffer.from(value));
}

async function runBuilder(fixture: Fixture, args = fixture.args) {
  try {
    const result = await execFileAsync(process.execPath, [builderPath, ...args], {
      cwd: fixture.root,
      encoding: "utf8",
      timeout: 20_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return result.stdout;
  } catch (error) {
    const value = error as { message?: string; stdout?: string; stderr?: string };
    throw [value.message, value.stdout, value.stderr].filter(Boolean).join("\n");
  }
}

function replaceOption(args: string[], option: string, value: string) {
  const copy = [...args];
  const index = copy.indexOf(option);
  copy[index + 1] = value;
  return copy;
}

async function writeRepoFile(root: string, relativePath: string, bytes: string | Buffer) {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, bytes);
}

async function writeRepoJson(root: string, relativePath: string, value: unknown) {
  await writeRepoFile(root, relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

function withoutDigest(value: Record<string, unknown>) {
  const copy = { ...value };
  delete copy.digest;
  return copy;
}

function resign<T extends Record<string, unknown>>(value: T): T & { digest: string } {
  const body = { ...value };
  delete body.digest;
  return { ...body, digest: hashCanonical(body) } as T & { digest: string };
}

function hashCanonical(value: unknown) {
  return sha256(canonicalJson(value));
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string | Buffer) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function digest(character: string) {
  return `sha256:${character.repeat(64)}`;
}
