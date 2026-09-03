import { describe, expect, it } from "vitest";

const contract = await import(
  // @ts-expect-error TypeScript does not synthesize declarations for this local mjs module.
  "../../scripts/conversation-disclosure-continuation-contract.mjs"
);

const digest = (character: string) => `sha256:${character.repeat(64)}`;

describe("conversation disclosure continuation contract", () => {
  it("accepts one exact externally reviewable CD04/P108 admission policy", () => {
    const policy = createPolicy();

    expect(contract.validateContinuationPolicy(policy)).toEqual([]);
  });

  it("rejects a live Feature self-authorizing a trust root", () => {
    const policy = createPolicy();
    const feature = {
      ...createP108Feature(),
      files: [
        ...createP108Feature().files,
        "scripts/check-conversation-disclosure-continuation.mjs",
      ],
    };
    const forged = resign({
      ...policy,
      successor: {
        ...policy.successor,
        featureDefinition: contract.stableFeatureDefinition(feature),
        featureDefinitionDigest: contract.hashCanonical(
          contract.stableFeatureDefinition(feature),
        ),
        authorizedDriftPaths: [
          ...policy.successor.authorizedDriftPaths,
          {
            path: "scripts/check-conversation-disclosure-continuation.mjs",
            operation: "modify",
            baseSha256: digest("c"),
          },
        ].sort((left, right) => left.path.localeCompare(right.path)),
      },
    });

    expect(contract.validateContinuationPolicy(forged)).toContain(
      "authorizedDriftPaths[0].path is invalid or trust-root denied",
    );
  });

  it("rejects any mutation of the externally anchored Feature definition", () => {
    const policy = createPolicy();
    const liveFeature = {
      ...createP108Feature(),
      definitionOfDone: ["candidate enlarged its own authority"],
    };

    expect(contract.validateContinuationPolicy(policy, {
      feature: liveFeature,
    })).toContain("live P108 Feature definition does not match the frozen policy");
  });

  it("rejects package or harness transitions that do not become exact trust roots", () => {
    const policy = createPolicy();
    const forged = resign({
      ...policy,
      governanceTransitions: policy.governanceTransitions.map((entry) =>
        entry.path === "package.json"
          ? { ...entry, toSha256: digest("f") }
          : entry
      ),
    });

    expect(contract.validateContinuationPolicy(forged)).toContain(
      "governance transition target trust-root digest is inconsistent: package.json",
    );
  });

  it("rejects successor completion without a separately reviewed delta head", () => {
    const policy = createPolicy();
    const workstream = { ...createCd04Workstream(), state: "completed" };
    const feature = { ...createP108Feature(), status: "done" };

    expect(contract.validateContinuationPolicy(policy, {
      workstream,
      feature,
    })).toEqual([]);
    // The pure policy validates the stable definitions only. The live checker
    // owns the fail-closed lifecycle rule and requires a later P108 delta anchor.
    expect(policy.successor.workstreamDefinition).not.toHaveProperty("state");
    expect(policy.successor.featureDefinition).not.toHaveProperty("status");
  });

  it("binds the review snapshot to the policy and exact P107A file-set digest", () => {
    const policy = createPolicy();
    const snapshot = resign({
      schemaVersion: 1,
      kind: contract.CONTINUATION_REVIEW_SNAPSHOT_KIND,
      algorithm: contract.CONTINUATION_ALGORITHM,
      programId: policy.programId,
      workstreamId: contract.CONTINUATION_WORKSTREAM_ID,
      featureId: contract.CONTINUATION_FEATURE_ID,
      round: contract.CONTINUATION_ROUND,
      baseSnapshotDigest: contract.BASE_SNAPSHOT_DIGEST,
      baseExternalAnchorDigest: contract.BASE_EXTERNAL_ANCHOR_DIGEST,
      policyDigest: policy.digest,
      featureFileSetDigest: digest("7"),
      successorWorkstreamDefinitionDigest:
        policy.successor.workstreamDefinitionDigest,
      successorFeatureDefinitionDigest:
        policy.successor.featureDefinitionDigest,
      files: [
        { path: "scripts/check-conversation-disclosure-continuation.mjs", sha256: digest("8") },
      ],
    });

    expect(contract.validateContinuationReviewSnapshot(snapshot, policy)).toEqual([]);
    expect(contract.validateContinuationReviewSnapshot({
      ...snapshot,
      policyDigest: digest("9"),
    }, policy)).toEqual(expect.arrayContaining([
      "continuation review snapshot canonical digest is stale",
      "continuation review snapshot policy/base/successor binding is stale",
    ]));
  });
});

function createPolicy() {
  const feature = createP108Feature();
  const workstream = createCd04Workstream();
  const featureDefinition = contract.stableFeatureDefinition(feature);
  const workstreamDefinition = contract.stableWorkstreamDefinition(workstream);
  const targetDigests = new Map<string, string>();
  contract.REQUIRED_HASHED_TRUST_ROOT_PATHS.forEach((path: string, index: number) => {
    targetDigests.set(path, digest(((index % 6) + 1).toString()));
  });
  targetDigests.set("package.json", digest("a"));
  targetDigests.set("scripts/check-harness-state.mjs", digest("b"));
  const continuationExecutables = Object.entries(
    contract.REQUIRED_CONTINUATION_EXECUTABLES,
  ).sort(([left], [right]) => left.localeCompare(right)).map(([kind, path]) => ({
    kind,
    path,
    sha256: targetDigests.get(path as string),
  }));
  return resign({
    schemaVersion: 1,
    kind: contract.CONTINUATION_POLICY_KIND,
    algorithm: contract.CONTINUATION_ALGORITHM,
    policyId: contract.CONTINUATION_POLICY_ID,
    programId: "conversation-progressive-disclosure-v3.9.2-2026-08",
    status: "frozen",
    parent: {
      workstreamId: contract.BASE_WORKSTREAM_ID,
      featureId: contract.BASE_FEATURE_ID,
      round: contract.BASE_ROUND,
      snapshotPath:
        ".zerox/verification/conversation-disclosure/CD03-round23-review-snapshot.json",
      snapshotDigest: contract.BASE_SNAPSHOT_DIGEST,
      externalAnchorDigest: contract.BASE_EXTERNAL_ANCHOR_DIGEST,
    },
    successor: {
      workstreamId: contract.SUCCESSOR_WORKSTREAM_ID,
      featureId: contract.SUCCESSOR_FEATURE_ID,
      workstreamDefinition,
      workstreamDefinitionDigest: contract.hashCanonical(workstreamDefinition),
      featureDefinition,
      featureDefinitionDigest: contract.hashCanonical(featureDefinition),
      authorizedDriftPaths: [
        {
          path: "src/main/chatSessionStore.ts",
          operation: "modify",
          baseSha256: digest("c"),
        },
      ],
    },
    trustRoots: contract.REQUIRED_HASHED_TRUST_ROOT_PATHS.map((path: string) => ({
      path,
      sha256: targetDigests.get(path),
    })),
    governanceTransitions: [
      {
        path: "package.json",
        kind: "package-structure-migration",
        fromSha256: digest("d"),
        toSha256: digest("a"),
      },
      {
        path: "scripts/check-harness-state.mjs",
        kind: "harness-delegation-migration",
        fromSha256: digest("e"),
        toSha256: digest("b"),
      },
    ],
    continuationExecutables,
    reviewSnapshot: {
      path: ".zerox/verification/conversation-disclosure/CD03A-round1-review-snapshot.json",
    },
  });
}

function createCd04Workstream() {
  return {
    id: "CD04",
    title: "Typed domain adapters snapshot cursor replay and bounded evidence foundation",
    state: "planned",
    featureId: "P108-conversation-disclosure-evidence-foundation",
    findings: ["D1", "D2"],
    dependsOn: ["CD03A"],
    architectureDecisionRequired: true,
    architectureDecision: ".zerox/decisions/CD04-conversation-domain-adapters.md",
    completionArtifacts: [
      ".zerox/verification/conversation-disclosure/CD04-shadow-parity.json",
    ],
    acceptanceScenarioIds: ["S03-evidence-handoff"],
    rollback: "Disable bounded adapters.",
    verification: ["focused tests"],
  };
}

function createP108Feature() {
  return {
    id: "P108-conversation-disclosure-evidence-foundation",
    priority: 139,
    status: "in_progress",
    title: "Build bounded domain adapters",
    files: [
      "src/main/chatSessionStore.ts",
      "src/shared/conversationDisclosureProgram.test.ts",
    ],
    definitionOfDone: ["bounded reads preserve authority"],
    verification: ["focused tests"],
  };
}

function resign<T extends Record<string, unknown>>(value: T): T & { digest: string } {
  const withoutDigest = { ...value } as Record<string, unknown>;
  delete withoutDigest.digest;
  return {
    ...withoutDigest,
    digest: contract.hashCanonical(withoutDigest),
  } as T & { digest: string };
}
