import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

const contract = await import(
  // @ts-expect-error TypeScript does not synthesize declarations for this local mjs module.
  "../../scripts/conversation-disclosure-continuation-contract-v2.mjs"
);

const verifierNow = Date.parse("2026-08-24T10:00:00.000Z");
const frozenAt = "2026-08-24T09:00:00.000Z";
const completedAt = "2026-08-24T09:10:00.000Z";

describe("conversation disclosure continuation v2 contract", () => {
  it("accepts one exact closed-world policy and its full proof chain", () => {
    const fixture = createFixture();

    expect(contract.validateBaselineArchiveV2(
      fixture.archive,
      fixture.policy,
    )).toEqual([]);
    expect(contract.validateContinuationPolicyV2(fixture.policy, {
      expectedDigest: fixture.policy.digest,
      baselineArchive: fixture.archive,
      lifecycleState: fixture.liveByPhase.anchored_planned,
      liveAdmissionFeature: fixture.liveByPhase.anchored_planned.features.find(
        (feature: { id: string }) => feature.id === contract.CONTINUATION_V2_FEATURE_ID,
      ),
      liveAdmissionWorkstream: fixture.liveByPhase.anchored_planned.workstreams.find(
        (workstream: { id: string }) =>
          workstream.id === contract.CONTINUATION_V2_WORKSTREAM_ID,
      ),
    })).toEqual([]);
    expect(contract.validateReviewSnapshotV2(
      fixture.snapshot,
      fixture.policy,
      { verifierNow },
    )).toEqual([]);
    expect(contract.validateReviewSetV2(
      fixture.receipts,
      fixture.snapshot,
      fixture.policy,
      { verifierNow, callerPins: fixture.callerPins },
    )).toEqual([]);
    expect(contract.validateClosureManifestV2(fixture.pendingManifest, {
      policy: fixture.policy,
      snapshot: fixture.snapshot,
      receipts: fixture.receipts,
    })).toEqual([]);
    expect(contract.validateClosureManifestV2(fixture.finalManifest, {
      policy: fixture.policy,
      snapshot: fixture.snapshot,
      receipts: fixture.receipts,
    })).toEqual([]);
    expect(contract.validateExternalAttestationV2(fixture.attestation, {
      verifierNow,
      manifest: fixture.finalManifest,
      policy: fixture.policy,
      snapshot: fixture.snapshot,
      receipts: fixture.receipts,
    })).toEqual([]);
    expect(contract.validateExternalAnchorV2(fixture.anchor, {
      verifierNow,
      expectedDigest: fixture.anchor.digest,
      attestation: fixture.attestation,
      policy: fixture.policy,
      snapshot: fixture.snapshot,
      receipts: fixture.receipts,
    })).toEqual([]);
  });

  it("rejects unknown workstreams and unfinished Features in the closed world", () => {
    const fixture = createFixture();
    const live = structuredClone(fixture.liveByPhase.anchored_planned);
    live.workstreams.push({
      id: "CD10",
      featureId: "P999",
      title: "candidate authority",
      dependsOn: [],
      state: "in_progress",
    });
    live.features.push(createLiveFeature(createStableFeature("P999", ["src/pwn.ts"]),
      "in_progress"));

    expect(contract.validateLifecycleStateV2(live, fixture.policy)).toEqual(
      expect.arrayContaining([
        "live workstream inventory differs from the closed world",
        "unknown live workstream: CD10",
        "live Feature inventory differs from the lifecycle profile",
        "unknown or absent live Feature: P999",
      ]),
    );
  });

  it("binds live inventories to anchored order and rejects duplicate ids", () => {
    const fixture = createFixture();
    const reversedWorkstreams = structuredClone(fixture.liveByPhase.anchored_planned);
    reversedWorkstreams.workstreams.reverse();
    const reversedFeatures = structuredClone(fixture.liveByPhase.anchored_planned);
    reversedFeatures.features.reverse();
    const duplicateFeatures = structuredClone(fixture.liveByPhase.anchored_planned);
    duplicateFeatures.features[1] = structuredClone(duplicateFeatures.features[0]);

    expect(contract.validateLifecycleStateV2(
      reversedWorkstreams,
      fixture.policy,
    )).toContain("live workstream ids must match the anchored order");
    expect(contract.validateLifecycleStateV2(
      reversedFeatures,
      fixture.policy,
    )).toContain("live Feature ids must match the anchored order");
    expect(contract.validateLifecycleStateV2(
      duplicateFeatures,
      fixture.policy,
    )).toEqual(expect.arrayContaining([
      "live Feature ids must be non-empty and unique",
      "live Feature ids must match the anchored order",
    ]));
    expect(fixture.liveByPhase.anchored_planned.features.map(
      (feature: { id: string }) => feature.id,
    )).toEqual([
      contract.CONTINUATION_V2_FEATURE_ID,
      "P107",
      "P105",
    ]);
    expect(fixture.liveByPhase.authorized_active.features.map(
      (feature: { id: string }) => feature.id,
    )).toEqual([
      contract.CONTINUATION_V2_SUCCESSOR_FEATURE_ID,
      contract.CONTINUATION_V2_FEATURE_ID,
      "P107",
      "P105",
    ]);
  });

  it("rejects profile state order drift from caller-anchored rosters", () => {
    const fixture = createFixture();
    const closedWorld = structuredClone(fixture.policy.closedWorld);
    closedWorld.lifecycleProfiles[0].workstreamStates.reverse();
    closedWorld.lifecycleProfiles[0].featureStates.reverse();
    closedWorld.digest = contract.hashCanonical(Object.fromEntries(
      Object.entries(closedWorld).filter(([key]) => key !== "digest"),
    ));
    const policy = resign({ ...fixture.policy, closedWorld });

    expect(contract.validateContinuationPolicyV2(policy)).toEqual(
      expect.arrayContaining([
        "lifecycleProfiles[0] workstream ids are not closed-world exact",
        "lifecycleProfiles[0] Feature ids are not closed-world exact",
      ]),
    );
  });

  it("binds the complete live P107A definition and file-set after completion", () => {
    const fixture = createFixture();
    const admissionFeature = fixture.liveByPhase.anchored_planned.features.find(
      (feature: { id: string }) => feature.id === contract.CONTINUATION_V2_FEATURE_ID,
    );
    const forged = {
      ...admissionFeature,
      files: [...admissionFeature.files, "scripts/candidate-self-authority.mjs"],
    };

    expect(contract.validateContinuationPolicyV2(fixture.policy, {
      liveAdmissionFeature: forged,
    })).toContain(
      "live P107A definition/file-set differs from the frozen admission",
    );
  });

  it("binds stable Program root semantics while permitting lifecycle and evidence updates", () => {
    const fixture = createFixture();
    const live = createLiveProgramRoot(
      fixture.policy.closedWorld.programRootDefinition,
      fixture.policy.closedWorld.lifecycleProfiles[0],
    );
    expect(contract.validateContinuationPolicyV2(fixture.policy, {
      liveProgram: live,
    })).toEqual([]);

    const replacedRoot = structuredClone(live);
    replacedRoot.nonGoals[0] = "candidate replacement semantics";
    expect(contract.validateContinuationPolicyV2(fixture.policy, {
      liveProgram: replacedRoot,
    })).toContain("live program stable root differs from the frozen program root");

    const replacedScenario = structuredClone(live);
    replacedScenario.scenarioMatrix[0].expected[0] = "candidate replacement result";
    expect(contract.validateContinuationPolicyV2(fixture.policy, {
      liveProgram: replacedScenario,
    })).toContain("live program stable root differs from the frozen program root");

    const lifecycleOnly = structuredClone(live);
    lifecycleOnly.updatedAt = "2026-08-25T00:00:00.000Z";
    lifecycleOnly.status = "completed";
    lifecycleOnly.activeFeatureId = null;
    lifecycleOnly.nextFeatureId = "P999-next-version";
    lifecycleOnly.workstreams[0].state = "completed";
    lifecycleOnly.scenarioMatrix[0].acceptanceEvidence = ["new evidence"];
    expect(contract.validateContinuationPolicyV2(fixture.policy, {
      liveProgram: lifecycleOnly,
    })).toEqual([]);
  });

  it("preserves historical Feature shapes without synthesizing optional fields", () => {
    const fixture = createFixture();
    const closedWorld: Record<string, any> = structuredClone(fixture.policy.closedWorld);
    const historical = closedWorld.historicalFeatures.find(
      (entry: { id: string }) => entry.id === "P105",
    ) as Record<string, any>;
    historical.stableDefinition = {
      id: "P105",
      priority: 0,
      definitionOfDone: ["historical completion remains anchored"],
    };
    historical.stableDefinitionDigest = contract.hashCanonical(
      historical.stableDefinition,
    );
    closedWorld.digest = contract.hashCanonical(Object.fromEntries(
      Object.entries(closedWorld).filter(([key]) => key !== "digest"),
    ));
    const policy = resign({ ...fixture.policy, closedWorld });
    const live: Record<string, any> = structuredClone(
      fixture.liveByPhase.anchored_planned,
    );
    const liveIndex = live.features.findIndex(
      (entry: { id: string }) => entry.id === "P105",
    );
    live.features[liveIndex] = {
      id: "P105",
      priority: 0,
      definitionOfDone: ["historical completion remains anchored"],
      status: "done",
    };

    expect(contract.validateContinuationPolicyV2(policy)).toEqual([]);
    expect(contract.validateLifecycleStateV2(live, policy)).toEqual([]);
    expect(contract.stableHistoricalFeatureDefinitionV2(
      live.features[liveIndex],
    )).toEqual(historical.stableDefinition);

    const unknownKey = structuredClone(live);
    unknownKey.features[liveIndex].candidateExtension = true;
    expect(contract.validateLifecycleStateV2(unknownKey, policy)).toContain(
      "live Feature is invalid: Live historical Feature contains unknown keys.",
    );

    const forgedFiles = structuredClone(live);
    forgedFiles.features[liveIndex].files = ["src/forged-history.ts"];
    expect(contract.validateLifecycleStateV2(forgedFiles, policy)).toContain(
      "live Feature definition drift: P105",
    );

    const negativePriority = structuredClone(live);
    negativePriority.features[liveIndex].priority = -1;
    expect(contract.validateLifecycleStateV2(negativePriority, policy)).toContain(
      "live Feature is invalid: Historical Feature priority is invalid",
    );

    const unknownClosedWorld = structuredClone(closedWorld);
    const unknownHistorical = unknownClosedWorld.historicalFeatures.find(
      (entry: { id: string }) => entry.id === "P105",
    );
    unknownHistorical.stableDefinition.candidateExtension = true;
    unknownHistorical.stableDefinitionDigest = contract.hashCanonical(
      unknownHistorical.stableDefinition,
    );
    unknownClosedWorld.digest = contract.hashCanonical(Object.fromEntries(
      Object.entries(unknownClosedWorld).filter(([key]) => key !== "digest"),
    ));
    expect(contract.validateContinuationPolicyV2(resign({
      ...policy,
      closedWorld: unknownClosedWorld,
    }))).toContain("closedWorld historical Feature[1] is invalid");
  });

  it("rejects incomplete or overlapping P108 path coverage", () => {
    const fixture = createFixture();
    const missing = resign({
      ...fixture.policy,
      pathAuthorities: fixture.policy.pathAuthorities.filter(
        (entry: { path: string }) => entry.path !== "src/main/new.ts",
      ),
    });
    const overlapping = resign({
      ...fixture.policy,
      trustRoots: [
        ...fixture.policy.trustRoots,
        { path: "src/main/new.ts", sha256: digestText("forged target") },
      ].sort((left, right) => left.path.localeCompare(right.path)),
    });

    expect(contract.validateContinuationPolicyV2(missing)).toContain(
      "P108 Feature paths are not covered exactly once",
    );
    expect(contract.validateContinuationPolicyV2(overlapping)).toEqual(
      expect.arrayContaining([
        "path authority overlaps trust or governance path: src/main/new.ts",
        "P108 Feature path coverage overlaps authority classes",
      ]),
    );
  });

  it("rejects missing and overlapping P107A review coverage", () => {
    const fixture = createFixture();
    const contractPath = "scripts/conversation-disclosure-continuation-contract-v2.mjs";
    const missing = resign({
      ...fixture.snapshot,
      frozenFiles: fixture.snapshot.frozenFiles.filter(
        (entry: { path: string }) => entry.path !== contractPath,
      ),
    });
    const overlapping = resign({
      ...fixture.snapshot,
      reviewOutputAbsentPaths: [
        ...fixture.snapshot.reviewOutputAbsentPaths,
        contractPath,
      ].sort(),
    });

    expect(contract.validateReviewSnapshotV2(
      missing,
      fixture.policy,
      { verifierNow },
    )).toContain(`P107A review coverage must classify exactly once: ${contractPath}`);
    expect(contract.validateReviewSnapshotV2(
      overlapping,
      fixture.policy,
      { verifierNow },
    )).toContain(`P107A review coverage must classify exactly once: ${contractPath}`);
  });

  it("distinguishes Round23 modify, CD03A modify, create, and bookkeeping", () => {
    const fixture = createFixture();
    const badModify: Array<Record<string, any>> = structuredClone(
      fixture.policy.pathAuthorities,
    );
    badModify.find((entry) => entry.path === "src/main/existing.ts")!
      .baseline.source = "round23_review_snapshot";
    const badCreate: Array<Record<string, any>> = structuredClone(
      fixture.policy.pathAuthorities,
    );
    const create = badCreate.find(
      (entry) => entry.path === "src/main/new.ts",
    )!;
    create.baseline.sha256 = digestText("not absent");
    const badBookkeeping: Array<Record<string, any>> = structuredClone(
      fixture.policy.pathAuthorities,
    );
    const bookkeeping = badBookkeeping.find(
      (entry) =>
        entry.path === ".zerox/conversation-disclosure-program.json",
    )!;
    bookkeeping.validator = "non_authoritative_progress_document_v1";

    expect(contract.validatePathAuthoritiesV2(badModify)).toEqual([]);
    // Source membership is bound by the baseline archive, not trusted from policy text.
    const policyWithBadModify = resign({ ...fixture.policy, pathAuthorities: badModify });
    expect(contract.validateBaselineArchiveV2(fixture.archive, policyWithBadModify)).toContain(
      "baseline archive coverage differs from modify/transition authorities",
    );
    expect(contract.validatePathAuthoritiesV2(badCreate)).toContain(
      "pathAuthorities[2] create authority is invalid",
    );
    expect(contract.validatePathAuthoritiesV2(badBookkeeping)).toContain(
      "pathAuthorities[0] bookkeeping authority is invalid",
    );
  });

  it("validates deterministic archive bytes and exact modify/transition coverage", () => {
    const fixture = createFixture();
    const byteTamper = structuredClone(fixture.archive);
    byteTamper.entries[0].bytes = gzipBase64(Buffer.from("changed historical bytes"));
    refreshArchive(byteTamper);
    const coverageTamper = structuredClone(fixture.archive);
    coverageTamper.entries.pop();
    refreshArchive(coverageTamper);

    expect(contract.validateBaselineArchiveV2(byteTamper, fixture.policy)).toContain(
      "baseline archive entries[0] decoded hash is stale",
    );
    expect(contract.validateBaselineArchiveV2(coverageTamper, fixture.policy)).toContain(
      "baseline archive coverage differs from modify/transition authorities",
    );
  });

  it("enforces distinct governance pre-transition and post-transition states", () => {
    const fixture = createFixture();
    const liveFrom = Object.fromEntries(fixture.policy.governanceTransitions.map(
      (entry: { path: string; fromSha256: string }) => [entry.path, entry.fromSha256],
    ));
    const liveTo = Object.fromEntries(fixture.policy.governanceTransitions.map(
      (entry: { path: string; toSha256: string }) => [entry.path, entry.toSha256],
    ));
    const staged = Object.fromEntries(fixture.policy.governanceTransitions.map(
      (entry: { stagedTargetPath: string; toSha256: string }) =>
        [entry.stagedTargetPath, entry.toSha256],
    ));
    const mixed = { ...liveTo, ["package.json"]: liveFrom["package.json"] };

    expect(contract.validateGovernanceTransitionStateV2(
      fixture.policy.governanceTransitions,
      "review_pre_transition",
      liveFrom,
      staged,
    )).toEqual([]);
    expect(contract.validateGovernanceTransitionStateV2(
      fixture.policy.governanceTransitions,
      "review_post_transition",
      liveTo,
      staged,
    )).toEqual([]);
    expect(contract.validateGovernanceTransitionStateV2(
      fixture.policy.governanceTransitions,
      "review_post_transition",
      mixed,
      staged,
    )).toContain(
      "governance live digest is invalid for review_post_transition: package.json",
    );
    expect(contract.validateGovernanceTransitionStateV2(
      fixture.policy.governanceTransitions,
      "anchored_planned",
      liveFrom,
      staged,
    )).toContain(
      "governance live digest is invalid for anchored_planned: package.json",
    );
  });

  it("requires caller-pinned receipt digests and unique challenges", () => {
    const fixture = createFixture();
    const missingPins = contract.validateReviewSetV2(
      fixture.receipts,
      fixture.snapshot,
      fixture.policy,
      { verifierNow },
    );
    const wrongPins = structuredClone(fixture.callerPins);
    wrongPins.contract.challenge = digestText("wrong external challenge");
    const replayed = structuredClone(fixture.receipts);
    replayed[1].challenge = replayed[0].challenge;
    const replayPins = createCallerPins(replayed);
    const staleValidator = structuredClone(fixture.receipts);
    staleValidator[0].validatorDigest = digestText("candidate validator");
    const staleValidatorPins = createCallerPins(staleValidator);

    expect(missingPins).toContain(
      "continuation review set requires exact caller pins for all lanes",
    );
    expect(contract.validateReviewSetV2(
      fixture.receipts,
      fixture.snapshot,
      fixture.policy,
      { verifierNow, callerPins: wrongPins },
    )).toContain(
      "continuation review receipt challenge does not match the caller pin",
    );
    expect(contract.validateReviewSetV2(
      replayed,
      fixture.snapshot,
      fixture.policy,
      { verifierNow, callerPins: replayPins },
    )).toContain("continuation review challenges must be unique");
    expect(contract.validateReviewSetV2(
      staleValidator,
      fixture.snapshot,
      fixture.policy,
      { verifierNow, callerPins: staleValidatorPins },
    )).toContain("continuation review receipt validatorDigest binding is stale");
  });

  it("uses one explicit verifierNow and rejects future evidence", () => {
    const fixture = createFixture();
    const futureSnapshot = resign({
      ...fixture.snapshot,
      frozenAt: "2026-08-24T10:00:00.001Z",
    });
    const futureReceipt = {
      ...fixture.receipts[0],
      completedAt: "2026-08-24T10:00:00.001Z",
    };
    const futurePin = {
      challenge: futureReceipt.challenge,
      canonicalDigest: contract.hashCanonical(futureReceipt),
    };
    const futureAttestation = resign({
      ...fixture.attestation,
      completedAt: "2026-08-24T10:00:00.001Z",
    });

    expect(contract.validateReviewSnapshotV2(
      fixture.snapshot,
      fixture.policy,
    )).toContain(
      "continuation review snapshot frozenAt requires one caller-supplied verifierNow",
    );
    expect(contract.validateReviewSnapshotV2(
      futureSnapshot,
      fixture.policy,
      { verifierNow },
    )).toContain("continuation review snapshot frozenAt must not be in the future");
    expect(contract.validateReviewReceiptV2(
      futureReceipt,
      fixture.snapshot,
      fixture.policy,
      {
        verifierNow,
        expectedChallenge: futurePin.challenge,
        expectedCanonicalDigest: futurePin.canonicalDigest,
      },
    )).toContain("continuation review receipt completedAt must not be in the future");
    expect(contract.validateExternalAttestationV2(futureAttestation, {
      verifierNow,
    })).toContain("continuation external attestation completedAt must not be in the future");
  });

  it("rejects exact-key extensions on every top-level proof object", () => {
    const fixture = createFixture();
    const probes = [
      [contract.validateContinuationPolicyV2, fixture.policy,
        "continuation policy must contain the exact v2 keys"],
      [contract.validateBaselineArchiveV2, fixture.archive,
        "baseline archive must contain the exact v2 keys"],
      [contract.validateReviewSnapshotV2, fixture.snapshot,
        "continuation review snapshot must contain the exact v2 keys"],
      [contract.validateReviewReceiptV2, fixture.receipts[0],
        "continuation review receipt must contain the exact v2 keys"],
      [contract.validateClosureManifestV2, fixture.finalManifest,
        "continuation closure manifest must contain the exact v2 keys"],
      [contract.validateExternalAttestationV2, fixture.attestation,
        "continuation external attestation must contain the exact v2 keys"],
      [contract.validateExternalAnchorV2, fixture.anchor,
        "continuation external anchor must contain the exact v2 keys"],
    ] as const;

    for (const [validator, value, expected] of probes) {
      expect(validator({ ...value, candidateExtension: true })).toContain(expected);
    }
  });
});

function createFixture() {
  const programId = "conversation-progressive-disclosure-v3.9.2-2026-08";
  const transitions = createTransitions();
  const implementationBytes = {
    "src/main/existing.ts": Buffer.from("existing non-Round23 source\n"),
    "src/shared/base.ts": Buffer.from("Round23 protected source\n"),
  };
  const pathAuthorities = [
    {
      class: "bookkeeping",
      path: ".zerox/conversation-disclosure-program.json",
      baseline: {
        source: "cd03a_review_snapshot",
        presence: "present",
        sha256: digestText("program baseline"),
      },
      validator: "conversation_program_projection_v2",
      allowedPhases: [...contract.CONTINUATION_V2_LIFECYCLE_PHASES],
    },
    {
      class: "modify",
      path: "src/main/existing.ts",
      baseline: {
        source: "cd03a_review_snapshot",
        sha256: digestBytes(implementationBytes["src/main/existing.ts"]),
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
        sha256: digestBytes(implementationBytes["src/shared/base.ts"]),
      },
    },
  ];
  const executablePaths = {
    checker: "scripts/check-conversation-disclosure-continuation-v2.mjs",
    contract: "scripts/conversation-disclosure-continuation-contract-v2.mjs",
    freezer: "scripts/freeze-conversation-disclosure-continuation-v2.mjs",
    governance: "scripts/conversation-disclosure-continuation-governance-v2.mjs",
    runner: "scripts/verify-conversation-disclosure-continuation-v2.mjs",
  };
  const targetDigestByPath = new Map<string, string>();
  for (const transition of transitions) targetDigestByPath.set(transition.path, transition.toSha256);
  for (const executablePath of Object.values(executablePaths)) {
    targetDigestByPath.set(executablePath, digestText(`trust:${executablePath}`));
  }
  const trustRoots = [...targetDigestByPath].map(([path, sha256]) => ({ path, sha256 }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const continuationExecutables = Object.entries(executablePaths)
    .map(([kind, path]) => ({ kind, path, sha256: targetDigestByPath.get(path) }))
    .sort((left, right) => left.kind.localeCompare(right.kind));

  const successorFiles = [
    ".zerox/conversation-disclosure-program.json",
    "package.json",
    "scripts/check-harness-state.mjs",
    "src/main/existing.ts",
    "src/main/new.ts",
    "src/shared/conversationDisclosureProgram.test.ts",
    "src/shared/packageScripts.test.ts",
    "src/shared/base.ts",
  ];
  const admissionFeature = createStableFeature(
    contract.CONTINUATION_V2_FEATURE_ID,
    [
      contract.CONTINUATION_V2_BASELINE_ARCHIVE_PATH,
      contract.CONTINUATION_V2_POLICY_PATH,
      contract.CONTINUATION_V2_ROUND1_POLICY_PATH,
      contract.CONTINUATION_V2_ROUND1_SNAPSHOT_PATH,
      ...contract.CONTINUATION_V2_REVIEW_LANES.map(
        (lane: string) => `.zerox/verification/conversation-disclosure/CD03A-round1-${lane}-review.json`,
      ),
      contract.CONTINUATION_V2_REVIEW_SNAPSHOT_PATH,
      "scripts/conversation-disclosure-continuation-contract-v2.mjs",
      "src/shared/conversationDisclosureContinuationV2.test.ts",
    ],
  );
  const successorFeature = createStableFeature(
    contract.CONTINUATION_V2_SUCCESSOR_FEATURE_ID,
    successorFiles,
  );
  const admissionWorkstream = createStableWorkstream(
    contract.CONTINUATION_V2_WORKSTREAM_ID,
    contract.CONTINUATION_V2_FEATURE_ID,
    ["CD03"],
  );
  const successorWorkstream = createStableWorkstream(
    contract.CONTINUATION_V2_SUCCESSOR_WORKSTREAM_ID,
    contract.CONTINUATION_V2_SUCCESSOR_FEATURE_ID,
    [contract.CONTINUATION_V2_WORKSTREAM_ID],
  );

  const coverage = [
    ...pathAuthorities.map((entry) => ({ path: entry.path, class: entry.class })),
    ...transitions.map((entry) => ({ path: entry.path, class: "governance_transition" })),
  ].filter((entry) => successorFiles.includes(entry.path))
    .sort((left, right) => left.path.localeCompare(right.path));
  const admissionPostReviewMutablePaths: string[] = [];
  const admissionReviewOutputPaths = [contract.CONTINUATION_V2_REVIEW_SNAPSHOT_PATH];
  const admissionReviewCoverage = admissionFeature.files.map((path: string) => ({
    path,
    class: admissionReviewOutputPaths.includes(path)
      ? "review_output_absent"
      : "frozen_file",
  })).sort((left: { path: string }, right: { path: string }) =>
    left.path.localeCompare(right.path));
  const admission = {
    workstreamDefinition: admissionWorkstream,
    workstreamDefinitionDigest: contract.hashCanonical(admissionWorkstream),
    featureDefinition: admissionFeature,
    featureDefinitionDigest: contract.hashCanonical(admissionFeature),
    featureFileSetDigest: contract.hashCanonical(admissionFeature.files),
    postReviewMutablePaths: admissionPostReviewMutablePaths,
    reviewCoverageDigest: contract.hashCanonical(admissionReviewCoverage),
    reviewOutputPaths: admissionReviewOutputPaths,
  };
  const successor = {
    workstreamDefinition: successorWorkstream,
    workstreamDefinitionDigest: contract.hashCanonical(successorWorkstream),
    featureDefinition: successorFeature,
    featureDefinitionDigest: contract.hashCanonical(successorFeature),
    pathCoverageDigest: contract.hashCanonical(coverage),
  };
  const closedWorld = createClosedWorld(admission, successor);
  const parentEvidence = createParentEvidence();
  const archive = createArchive(programId, pathAuthorities, transitions,
    implementationBytes);
  const baselineArchive = {
    path: contract.CONTINUATION_V2_BASELINE_ARCHIVE_PATH,
    digest: archive.digest,
    entrySetDigest: archive.entrySetDigest,
  };
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

  const frozenFiles = [
    ...admissionFeature.files.filter((path: string) =>
      !admissionReviewOutputPaths.includes(path)).map((path: string) => ({
      path,
      sha256: round1EvidenceByteDigest(path)
        ?? digestText(`frozen admission file:${path}`),
    })),
    ...transitions.map((entry) => ({
      path: entry.stagedTargetPath,
      sha256: entry.toSha256,
    })),
  ].sort((left, right) => left.path.localeCompare(right.path));
  const baselineFiles = [
    {
      path: ".zerox/conversation-disclosure-program.json",
      sha256: pathAuthorities[0].baseline.sha256,
    },
    {
      path: "src/main/existing.ts",
      sha256: pathAuthorities[1].baseline.sha256,
    },
  ];
  const snapshot = resign({
    schemaVersion: 2,
    kind: contract.CONTINUATION_V2_SNAPSHOT_KIND,
    algorithm: contract.CONTINUATION_V2_ALGORITHM,
    programId,
    workstreamId: contract.CONTINUATION_V2_WORKSTREAM_ID,
    featureId: contract.CONTINUATION_V2_FEATURE_ID,
    round: contract.CONTINUATION_V2_ROUND,
    frozenAt,
    parentEvidenceBundleDigest: parentEvidence.bundleDigest,
    policyDigest: policy.digest,
    closedWorldDigest: closedWorld.digest,
    pathAuthorityDigest: contract.hashCanonical(pathAuthorities),
    admissionFeatureDefinitionDigest: admission.featureDefinitionDigest,
    admissionFeatureFileSetDigest: admission.featureFileSetDigest,
    successorWorkstreamDefinitionDigest: successor.workstreamDefinitionDigest,
    successorFeatureDefinitionDigest: successor.featureDefinitionDigest,
    baselineArchive,
    frozenFiles,
    baselineFiles,
    absentPaths: [
      ...contract.CONTINUATION_V2_ROUND1_FORBIDDEN_OUTPUT_PATHS,
      "src/main/new.ts",
    ].sort(),
    reviewOutputAbsentPaths: admissionReviewOutputPaths,
    governanceTransitions: transitions,
  });
  const receipts = contract.CONTINUATION_V2_REVIEW_LANES.map(
    (lane: string, index: number) => ({
      schemaVersion: 2,
      kind: contract.CONTINUATION_V2_RECEIPT_KIND,
      programId,
      workstreamId: contract.CONTINUATION_V2_WORKSTREAM_ID,
      featureId: contract.CONTINUATION_V2_FEATURE_ID,
      round: contract.CONTINUATION_V2_ROUND,
      lane,
      transport: "codex-collaboration",
      reviewTaskPath: `/root/cd03a_round2_${lane}`,
      reviewAgentId: `agent-${index}`,
      challenge: digestText(`external challenge:${lane}`),
      completedAt,
      snapshotDigest: snapshot.digest,
      snapshotFileCount: frozenFiles.length + baselineFiles.length,
      policyDigest: policy.digest,
      parentEvidenceBundleDigest: parentEvidence.bundleDigest,
      closedWorldDigest: closedWorld.digest,
      pathAuthorityDigest: contract.hashCanonical(pathAuthorities),
      admissionFeatureDefinitionDigest: admission.featureDefinitionDigest,
      admissionFeatureFileSetDigest: admission.featureFileSetDigest,
      successorWorkstreamDefinitionDigest: successor.workstreamDefinitionDigest,
      successorFeatureDefinitionDigest: successor.featureDefinitionDigest,
      reviewedPhase: "review_pre_transition",
      validatorDigest: targetDigestByPath.get(executablePaths.checker),
      verdict: "passed",
      findingCounts: { critical: 0, major: 0, minor: 0 },
      findings: [],
    }),
  );
  const callerPins = createCallerPins(receipts);
  const receiptReferences = receipts.map((receipt: { lane: string; challenge: string }) => ({
    lane: receipt.lane,
    path: `.zerox/verification/conversation-disclosure/CD03A-round2-${receipt.lane}-review.json`,
    canonicalDigest: contract.hashCanonical(receipt),
    challenge: receipt.challenge,
  }));
  const pendingManifest = resign({
    schemaVersion: 2,
    kind: contract.CONTINUATION_V2_MANIFEST_KIND,
    programId,
    workstreamId: contract.CONTINUATION_V2_WORKSTREAM_ID,
    featureId: contract.CONTINUATION_V2_FEATURE_ID,
    round: contract.CONTINUATION_V2_ROUND,
    status: "review_passed_pending_external_anchor",
    parentEvidenceBundleDigest: parentEvidence.bundleDigest,
    policy: { path: contract.CONTINUATION_V2_POLICY_PATH, digest: policy.digest },
    snapshot: {
      path: contract.CONTINUATION_V2_REVIEW_SNAPSHOT_PATH,
      digest: snapshot.digest,
    },
    reviewReceipts: receiptReferences,
    validator: {
      path: executablePaths.checker,
      sha256: targetDigestByPath.get(executablePaths.checker),
    },
    externalRunner: {
      path: executablePaths.runner,
      sha256: targetDigestByPath.get(executablePaths.runner),
    },
    externalAttestation: {
      path: contract.CONTINUATION_V2_EXTERNAL_ATTESTATION_PATH,
      canonicalDigest: null,
    },
  });
  const receiptBindings = receipts.map((receipt: { lane: string; challenge: string }) => ({
    lane: receipt.lane,
    canonicalDigest: contract.hashCanonical(receipt),
    challenge: receipt.challenge,
  }));
  const attestationWithoutDigest = {
    schemaVersion: 2,
    kind: contract.CONTINUATION_V2_ATTESTATION_KIND,
    status: "passed",
    trustLevel: "external-anchor-consistency",
    subjectIdentityAssurance: "not-signed",
    governancePhase: "review_post_transition",
    repositoryRealpath: "/tmp/zerox-v2-fixture",
    completedAt,
    parentEvidenceBundleDigest: parentEvidence.bundleDigest,
    pendingManifestDigest: pendingManifest.digest,
    policyDigest: policy.digest,
    snapshotDigest: snapshot.digest,
    validatorDigest: targetDigestByPath.get(executablePaths.checker),
    runnerDigest: targetDigestByPath.get(executablePaths.runner),
    reviewReceiptBindings: receiptBindings,
    candidateResults: [
      {
        kind: "checker",
        path: executablePaths.checker,
        status: "passed",
        receiptDigest: digestText("checker receipt"),
        stdoutDigest: digestText("checker stdout"),
        stderrDigest: digestText("checker stderr"),
      },
      {
        kind: "harness",
        path: "scripts/check-harness-state.mjs",
        status: "passed",
        receiptDigest: digestText("harness receipt"),
        stdoutDigest: digestText("harness stdout"),
        stderrDigest: digestText("harness stderr"),
      },
    ],
  };
  const provisionalAttestation = resign(attestationWithoutDigest);
  const finalManifest = resign({
    ...pendingManifest,
    status: "externally_attested",
    externalAttestation: {
      path: contract.CONTINUATION_V2_EXTERNAL_ATTESTATION_PATH,
      canonicalDigest: provisionalAttestation.digest,
    },
  });
  const attestation = provisionalAttestation;
  const anchor = resign({
    schemaVersion: 2,
    kind: contract.CONTINUATION_V2_ANCHOR_KIND,
    trustLevel: "external-caller-pinned-consistency",
    subjectIdentityAssurance: "not-signed",
    repositoryRealpath: attestation.repositoryRealpath,
    completedAt,
    parentEvidenceBundleDigest: parentEvidence.bundleDigest,
    policyDigest: policy.digest,
    snapshotDigest: snapshot.digest,
    attestationDigest: attestation.digest,
    validatorDigest: attestation.validatorDigest,
    runnerDigest: attestation.runnerDigest,
    reviewReceiptBindings: receiptBindings,
    head: {
      kind: "successor-admission",
      status: "externally_attested",
      workstreamId: contract.CONTINUATION_V2_WORKSTREAM_ID,
      featureId: contract.CONTINUATION_V2_FEATURE_ID,
      snapshotDigest: snapshot.digest,
      successorWorkstreamDefinitionDigest: successor.workstreamDefinitionDigest,
      successorFeatureDefinitionDigest: successor.featureDefinitionDigest,
    },
  });
  const liveByPhase = Object.fromEntries(closedWorld.lifecycleProfiles.map(
    (profile: { phase: string }) => [profile.phase,
      createLiveLifecycle(profile, closedWorld, admission, successor)],
  ));

  return {
    archive,
    policy,
    snapshot,
    receipts,
    callerPins,
    pendingManifest,
    finalManifest,
    attestation,
    anchor,
    liveByPhase,
  };
}

function createParentEvidence() {
  const lanes = contract.CONTINUATION_V2_REVIEW_LANES;
  const artifact = {
    path: ".zerox/verification/conversation-disclosure/CD03-causal-shadow.json",
    byteSha256: digestText("Round23 artifact"),
  };
  const snapshot = {
    path: ".zerox/verification/conversation-disclosure/CD03-round23-review-snapshot.json",
    digest: digestText("Round23 snapshot"),
    fileCount: 101,
  };
  const receipts = lanes.map((lane: string) => ({
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
    ...contract.CONTINUATION_V2_REQUIRED_PARENT_REPOSITORY_PATHS,
    ...receipts.map((entry: { path: string }) => entry.path),
    ...Array.from({ length: 5 }, (_, index) =>
      `.zerox/verification/conversation-disclosure/CD03-round23-transaction-${index}.completed-${index}.marker`),
  ].sort();
  const repositoryEvidence = [...new Set(repositoryPaths)].map((path) => ({
    path,
    sha256: path === artifact.path
      ? artifact.byteSha256
      : path === validator.path
        ? validator.sha256
        : path === externalRunner.path
          ? externalRunner.sha256
          : digestText(`repository evidence:${path}`),
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
    externalAnchor: { digest: digestText("Round23 external anchor") },
    validator,
    externalRunner,
    repositoryEvidence,
    externalEvidence,
  };
  return { ...withoutDigest, bundleDigest: contract.hashCanonical(withoutDigest) };
}

function createClosedWorld(admission: Record<string, any>, successor: Record<string, any>) {
  const historicalWorkstreams = [
    createStableWorkstream("CD03", "P107", ["CD01"]),
    createStableWorkstream("CD01", "P105", []),
  ];
  const workstreamDefinitions = [
    admission.workstreamDefinition,
    ...historicalWorkstreams,
    successor.workstreamDefinition,
  ];
  const workstreams = workstreamDefinitions.map((stableDefinition) => ({
    id: stableDefinition.id,
    stableDefinition,
    stableDefinitionDigest: contract.hashCanonical(stableDefinition),
  }));
  const historicalDefinitions = [
    createStableFeature("P107", ["src/p107.ts"]),
    createStableFeature("P105", ["src/p105.ts"]),
  ];
  const historicalFeatures = historicalDefinitions.map((stableDefinition) => ({
    id: stableDefinition.id,
    stableDefinition,
    stableDefinitionDigest: contract.hashCanonical(stableDefinition),
    requiredStatus: "done",
  }));
  const featureIds = [
    contract.CONTINUATION_V2_SUCCESSOR_FEATURE_ID,
    contract.CONTINUATION_V2_FEATURE_ID,
    ...historicalFeatures.map((entry) => entry.id),
  ];
  const baseWorkstreamStates = workstreams.map((entry) => ({
    id: entry.id,
    state: ["CD01", "CD03"].includes(entry.id) ? "completed" : "planned",
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
    workstreamStates: baseWorkstreamStates.map((entry) => ({
      ...entry,
      state: entry.id === contract.CONTINUATION_V2_WORKSTREAM_ID
        ? admissionState
        : entry.id === contract.CONTINUATION_V2_SUCCESSOR_WORKSTREAM_ID
          ? successorState
          : entry.state,
    })),
    featureStates: featureIds.map((id) => {
      if (id === contract.CONTINUATION_V2_FEATURE_ID) {
        return { id, presence: "present", status: admissionStatus };
      }
      if (id === contract.CONTINUATION_V2_SUCCESSOR_FEATURE_ID) {
        return { id, presence: successorPresence, status: successorStatus };
      }
      return { id, presence: "present", status: "done" };
    }),
  });
  const programRootDefinition = {
    schemaVersion: 1,
    programId: "conversation-progressive-disclosure-v3.9.2-2026-08",
    maxActiveFeatures: 1,
    invariants: ["stable invariant"],
    nonGoals: ["stable non-goal"],
    scenarioMatrix: [{
      id: "S1",
      category: "default",
      actions: ["act"],
      expected: ["observe"],
    }],
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

function createLiveProgramRoot(
  stable: Record<string, any>,
  profile: Record<string, any>,
): Record<string, any> {
  return {
    ...structuredClone(stable),
    updatedAt: "2026-08-24T00:00:00.000Z",
    status: "active",
    activeFeatureId: profile.activeFeatureId,
    nextFeatureId: profile.nextFeatureId,
    workstreams: stable.workstreams.map((entry: Record<string, any>) => ({
      ...structuredClone(entry),
      state: profile.workstreamStates.find(
        (state: { id: string }) => state.id === entry.id,
      ).state,
    })),
    scenarioMatrix: stable.scenarioMatrix.map((entry: Record<string, any>) => ({
      ...structuredClone(entry),
      acceptanceEvidence: [],
    })),
  };
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
    [contract.CONTINUATION_V2_FEATURE_ID, admission.featureDefinition],
    [contract.CONTINUATION_V2_SUCCESSOR_FEATURE_ID, successor.featureDefinition],
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

function createArchive(
  programId: string,
  pathAuthorities: Array<Record<string, any>>,
  transitions: Array<Record<string, any>>,
  implementationBytes: Record<string, Buffer>,
) {
  const rawByPath = new Map<string, Buffer>();
  for (const authority of pathAuthorities) {
    if (authority.class === "modify") rawByPath.set(authority.path, implementationBytes[authority.path]);
  }
  for (const transition of transitions) {
    rawByPath.set(transition.path, Buffer.from(`historical:${transition.path}\n`));
    transition.fromSha256 = digestBytes(rawByPath.get(transition.path)!);
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

function refreshArchive(archive: Record<string, any>) {
  archive.entrySetDigest = contract.hashCanonical(archive.entries);
  delete archive.digest;
  archive.digest = contract.hashCanonical(archive);
}

function createTransitions() {
  return Object.entries(contract.CONTINUATION_V2_GOVERNANCE_TRANSITIONS)
    .map(([path, kind]) => ({
      path,
      kind,
      fromSha256: digestText(`historical:${path}\n`),
      stagedTargetPath: `.zerox/verification/conversation-disclosure/staged/${path.replaceAll("/", "__")}`,
      toSha256: digestText(`target:${path}\n`),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function createStableWorkstream(id: string, featureId: string, dependsOn: string[]) {
  return { id, featureId, title: `${id} workstream`, dependsOn };
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

function createLiveFeature(definition: Record<string, unknown>, status: string) {
  return { ...definition, status };
}

function createCallerPins(receipts: Array<Record<string, any>>) {
  return Object.fromEntries(receipts.map((receipt) => [receipt.lane, {
    challenge: receipt.challenge,
    canonicalDigest: contract.hashCanonical(receipt),
  }]));
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

function round1EvidenceByteDigest(relativePath: string): string | undefined {
  const rejection = createRound1Rejection();
  return [rejection.policy, rejection.snapshot, ...rejection.receipts]
    .find((entry) => entry.path === relativePath)?.byteSha256;
}

function resign<T extends Record<string, any>>(value: T): T & { digest: string } {
  const withoutDigest = { ...value };
  delete withoutDigest.digest;
  return { ...withoutDigest, digest: contract.hashCanonical(withoutDigest) };
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
