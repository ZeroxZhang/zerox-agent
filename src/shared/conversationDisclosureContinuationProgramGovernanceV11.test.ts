import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const governance = await import(
  // @ts-expect-error TypeScript does not synthesize declarations for this local mjs module.
  "../../scripts/conversation-disclosure-program-governance-v11.mjs"
);
const contract = await import(
  // @ts-expect-error TypeScript does not synthesize declarations for this local mjs module.
  "../../scripts/conversation-disclosure-continuation-contract-v11.mjs"
);
const completionChecker = await import(
  // @ts-expect-error TypeScript does not synthesize declarations for this local mjs module.
  "../../scripts/check-conversation-disclosure-program-v11.mjs"
);

const categories = [
  "default",
  "expanded",
  "evidence",
  "failure",
  "approval",
  "recovery",
  "plan",
  "scheduled",
  "long_session",
  "accessibility",
  "secret_safety",
  "retry",
  "legacy",
  "guided_input",
  "goal_acceptance",
  "plan_confirmation",
  "cancel",
  "context_usage",
  "unknown_coverage",
];

const digest = (character: string) => `sha256:${character.repeat(64)}`;

describe("conversation disclosure program governance v11", () => {
  it("accepts the closed-world P107A admission lifecycle and reports every rule", () => {
    const result = validate(createInput());

    expect(result.status).toBe("passed");
    expect(result.schemaVersion).toBe(11);
    expect(result.kind).toBe(governance.GOVERNANCE_V11_RESULT_KIND);
    expect(result.errors).toEqual([]);
    expect(result.ruleResults.map((rule: RuleResult) => rule.id)).toEqual(
      governance.PROGRAM_GOVERNANCE_V11_RULE_IDS,
    );
    expect(result.ruleResults.every((rule: RuleResult) => rule.status === "passed")).toBe(true);
  });

  it("accepts every exact review/planned/authorized-active lifecycle tuple", () => {
    for (const phase of [
      "review_post",
      "anchored_planned",
      "authorized_active",
    ]) {
      const input = createInput();
      applyLifecycleProfile(input, phase);
      expect(validate(input).status, phase).toBe("passed");
    }
  });

  it("accepts only the exact all-from or all-to governance target state", () => {
    const transitions = createTransitions();
    const staged = new Map(
      transitions.map((entry) => [entry.stagedTargetPath, entry.toSha256]),
    );
    const allFrom = new Map(
      transitions.map((entry) => [entry.path, entry.fromSha256]),
    );
    const allTo = new Map(
      transitions.map((entry) => [entry.path, entry.toSha256]),
    );
    const mixed = new Map(allTo);
    mixed.set(transitions[0].path, transitions[0].fromSha256);

    expect(contract.validateGovernanceTransitionStateV11(
      transitions,
      "review_pre_transition",
      allFrom,
      staged,
    )).toEqual([]);
    expect(contract.validateGovernanceTransitionStateV11(
      transitions,
      "review_post_transition",
      allTo,
      staged,
    )).toEqual([]);
    expect(contract.validateGovernanceTransitionStateV11(
      transitions,
      "review_post_transition",
      mixed,
      staged,
    )).toContain(
      `governance live digest is invalid for review_post_transition: ${transitions[0].path}`,
    );
  });

  it("keeps the Round11 harness diagnostic-only by default and identity claims not-signed", () => {
    const harnessSource = readFileSync(path.join(
      process.cwd(),
      ".zerox/verification/conversation-disclosure/CD03A-round11-harness.target.mjs",
    ), "utf8");
    expect(harnessSource).toContain("requestedArguments.length === 0");
    expect(harnessSource).toContain('status: "local_unpinned_diagnostic"');
    expect(harnessSource).toContain("authoritative: false");
    expect(harnessSource).toContain("authoritative: true");
    expect(harnessSource).toContain(
      'callerDispatchAssurance: "caller-attested-not-signed"',
    );
    expect(harnessSource).toContain('identityAssurance: "not-signed"');
    expect(harnessSource).toContain(
      'independenceClaim: "caller-attested-distinct-review-contexts"',
    );
    expect(harnessSource).toContain("platformIdentitySignature: null");
    expect(harnessSource).not.toContain('identityAssurance: "platform-signed"');
    expect(contract.CONTINUATION_V11_CALLER_DISPATCH_ASSURANCE).toBe(
      "caller-attested-not-signed",
    );
    expect(contract.CONTINUATION_V11_IDENTITY_ASSURANCE).toBe("not-signed");
    expect(contract.CONTINUATION_V11_INDEPENDENCE_CLAIM).toBe(
      "caller-attested-distinct-review-contexts",
    );
  });

  it("changes the Round10 package target only for V11 tests and authoritative program checking", () => {
    const round10 = JSON.parse(readFileSync(path.join(
      process.cwd(),
      ".zerox/verification/conversation-disclosure/CD03A-round10-package.target.json",
    ), "utf8"));
    const round11 = JSON.parse(readFileSync(path.join(
      process.cwd(),
      ".zerox/verification/conversation-disclosure/CD03A-round11-package.target.json",
    ), "utf8"));
    expect(round11).toEqual({
      ...round10,
      scripts: {
        ...round10.scripts,
        test: "node scripts/run-conversation-disclosure-tests-v11.mjs",
        "program:check":
          "node scripts/check-runtime-convergence-program.mjs && node scripts/check-kernel-migration-program.mjs && node scripts/check-storage-convergence-program.mjs && node scripts/check-release-program.mjs && node scripts/check-conversation-disclosure-program-v11.mjs && node scripts/check-harness-state.mjs --diagnostic-only",
      },
    });
  });

  it("keeps pre-freeze target tests on the published Round10 baseline archive", () => {
    const target = readFileSync(path.join(
      process.cwd(),
      ".zerox/verification/conversation-disclosure/CD03A-round11-program-test.target.ts",
    ), "utf8");
    expect(target).toContain("CD03A-round10-baseline-archive.json");
    expect(target).not.toContain("CD03A-round11-baseline-archive.json");
  });

  it.each([
    {
      name: "input contract schema",
      rule: "CDG4-001-input-contract",
      mutate(input: GovernanceInput) {
        input.closedWorld.schemaVersion = 2;
      },
    },
    {
      name: "program shape",
      rule: "CDG4-010-program-shape",
      mutate(input: GovernanceInput) {
        input.program.maxActiveFeatures = 2;
      },
    },
    {
      name: "stable Program root",
      rule: "CDG4-011-program-root-contract",
      mutate(input: GovernanceInput) {
        input.program.nonGoals[0] = "candidate replacement semantics";
      },
    },
    {
      name: "root findings",
      rule: "CDG4-020-root-findings",
      mutate(input: GovernanceInput) {
        input.program.rootFindings.pop();
      },
    },
    {
      name: "deferrals",
      rule: "CDG4-030-deferrals",
      mutate(input: GovernanceInput) {
        input.program.deferrals[0].status = "released";
      },
    },
    {
      name: "scenario schema",
      rule: "CDG4-040-scenario-schema",
      mutate(input: GovernanceInput) {
        input.program.scenarioMatrix[0].executor = "shell";
      },
    },
    {
      name: "scenario categories",
      rule: "CDG4-041-scenario-categories",
      mutate(input: GovernanceInput) {
        input.program.scenarioMatrix[0].category = "unknown";
      },
    },
    {
      name: "scenario coverage",
      rule: "CDG4-042-scenario-coverage",
      mutate(input: GovernanceInput) {
        for (const workstream of input.program.workstreams) {
          workstream.acceptanceScenarioIds = workstream.acceptanceScenarioIds.filter(
            (id) => id !== "S19",
          );
        }
      },
    },
    {
      name: "workstream schema",
      rule: "CDG4-050-workstream-schema",
      mutate(input: GovernanceInput) {
        input.program.workstreams[0].rollback = "";
      },
    },
    {
      name: "closed roster",
      rule: "CDG4-051-closed-roster",
      mutate(input: GovernanceInput) {
        input.program.workstreams.push(createWorkstream(
          "CD10",
          "P999-unknown-workstream",
          "planned",
          ["CD09"],
          ["D1"],
        ));
      },
    },
    {
      name: "dependency graph",
      rule: "CDG4-052-dependency-graph",
      mutate(input: GovernanceInput) {
        input.program.workstreams[0].dependsOn = ["CD09"];
      },
    },
    {
      name: "state boundary",
      rule: "CDG4-053-state-boundary",
      mutate(input: GovernanceInput) {
        input.program.workstreams.find((workstream) => workstream.id === "CD04")!.state = "completed";
      },
    },
    {
      name: "finding owners",
      rule: "CDG4-060-finding-owners",
      mutate(input: GovernanceInput) {
        const cd02 = input.program.workstreams.find((workstream) => workstream.id === "CD02")!;
        cd02.findings = cd02.findings.filter((finding) => finding !== "D13");
      },
    },
    {
      name: "implementation gates",
      rule: "CDG4-070-implementation-gates",
      mutate(input: GovernanceInput) {
        input.program.postImplementationGates = [];
      },
    },
    {
      name: "Feature status",
      rule: "CDG4-080-feature-status",
      mutate(input: GovernanceInput) {
        input.featureList.features.find((feature) => feature.id.startsWith("P107A-"))!.status = "done";
      },
    },
    {
      name: "active/next pointers",
      rule: "CDG4-081-active-next",
      mutate(input: GovernanceInput) {
        input.program.nextFeatureId = "P108-conversation-disclosure-evidence-foundation";
      },
    },
    {
      name: "P107A/P108 lifecycle",
      rule: "CDG4-090-p107a-p108-lifecycle",
      mutate(input: GovernanceInput) {
        input.lifecycleProfile.phase = "candidate_self_authorized";
      },
    },
    {
      name: "CD03 evidence references",
      rule: "CDG4-100-cd03-evidence-refs",
      mutate(input: GovernanceInput) {
        input.parentEvidence.externalAnchor.snapshotDigest = digest("9");
      },
    },
  ])("fails closed for a mutation of $name", ({ rule, mutate }) => {
    const input = createInput();
    mutate(input);

    expect(ruleResult(validate(input), rule).status).toBe("failed");
  });

  it("rejects an unknown required rule id", () => {
    const input = createInput();
    input.closedWorld.ruleIds.push("CDG4-666-candidate-rule");

    expect(ruleResult(validate(input), "CDG4-001-input-contract").message).toContain(
      "closedWorld.ruleIds must exactly match the known v11 ledger",
    );
  });

  it("rejects an unknown workstream even when its fields and dependency are valid", () => {
    const input = createInput();
    input.program.workstreams.push(createWorkstream(
      "CD10",
      "P999-candidate-extension",
      "planned",
      ["CD09"],
      ["D1"],
    ));

    expect(ruleResult(validate(input), "CDG4-051-closed-roster").status).toBe("failed");
  });

  it("rejects an unknown Feature even when it is already done", () => {
    const input = createInput();
    input.featureList.features.push({ id: "P999-candidate-extension", status: "done" });

    expect(ruleResult(validate(input), "CDG4-051-closed-roster").status).toBe("failed");
  });

  it("permits acceptance evidence growth but rejects scenario semantic replacement", () => {
    const evidenceOnly = createInput();
    (evidenceOnly.program.scenarioMatrix[0].acceptanceEvidence as string[])
      .push("new bounded evidence");
    expect(validate(evidenceOnly).status).toBe("passed");

    const semanticReplacement = createInput();
    semanticReplacement.program.scenarioMatrix[0].expected[0] = "candidate result";
    expect(ruleResult(
      validate(semanticReplacement),
      "CDG4-011-program-root-contract",
    ).status).toBe("failed");
  });

  it("rejects P108 done until CD04 publishes a next-version reviewed delta trust head", () => {
    const input = createInput();
    applyLifecycleProfile(input, "completed_pending_delta");

    expect(ruleResult(
      validate(input),
      "CDG4-090-p107a-p108-lifecycle",
    ).message).toContain(
      "P108 completion requires an independently reviewed next-version delta trust head",
    );
  });

  it("rejects unsatisfiable or incomplete P107A completion artifacts", () => {
    const input = createInput();
    const p107a = input.program.workstreams.find(
      (workstream) => workstream.id === "CD03A",
    )!;
    p107a.completionArtifacts = [
      ...governance.P107A_V11_COMPLETION_ARTIFACTS,
      ".zerox/verification/conversation-disclosure/CD03A-round10-closure-manifest.json",
    ];
    applyLifecycleProfile(input, "anchored_planned");

    const result = ruleResult(
      validate(input),
      "CDG4-054-completion-artifacts",
    );
    expect(result.status).toBe("failed");
    expect(result.message).toContain("exact satisfiable Round11 closure set");
    expect(result.message).toContain("cannot require a rejected output");
  });

  it("runs the authoritative completion checker in the current review state", async () => {
    await expect(
      completionChecker.checkConversationDisclosureProgramV11({
        repositoryRoot: process.cwd(),
      }),
    ).resolves.toMatchObject({
      status: "passed",
      phase: "review",
      completionArtifactCount: 79,
    });
    const source = readFileSync(path.join(
      process.cwd(),
      "scripts/check-conversation-disclosure-program-v11.mjs",
    ), "utf8");
    expect(source).toContain("ZEROX_CD03A_CONTINUATION_ANCHOR");
    expect(source).toContain("ZEROX_CD03A_BASE_ANCHOR");
    expect(source).toContain(
      "CONTINUATION_V11_GOVERNANCE_TRANSITION_TRUST_ROOTS",
    );
    expect(source).toContain(
      "runConversationDisclosureContinuationCheckerV11",
    );
    expect(source).toContain(
      "completed P107A requires caller-pinned base and continuation anchor environment",
    );
  });
});

function validate(input: GovernanceInput) {
  return governance.validateConversationDisclosureProgramGovernanceV11(input);
}

function ruleResult(result: GovernanceResult, id: string): RuleResult {
  return result.ruleResults.find((rule: RuleResult) => rule.id === id)!;
}

function createInput() {
  const scenarios = categories.map((category, index) => ({
    id: `S${index + 1}`,
    category,
    title: `Scenario ${index + 1}`,
    surface: "chat",
    executor: index % 2 === 0 ? "browser" : "hybrid",
    fixture: `fixture-${index + 1}`,
    setup: "prepare fixture",
    actions: ["act"],
    expected: ["observe"],
    evidenceRequirements: ["bounded evidence"],
    acceptanceEvidence: [],
  }));
  const allScenarioIds = scenarios.map((scenario) => scenario.id);
  const workstreams = [
    createWorkstream("CD01", "P105-conversation-disclosure-program-foundation", "completed", [], ["D1"]),
    createWorkstream("CD02", "P106-conversation-disclosure-contract-foundation", "completed", ["CD01"], ["D1", "D4", "D13"]),
    createCd03Workstream(),
    createWorkstream("CD03A", "P107A-conversation-disclosure-successor-admission", "in_progress", ["CD03"], ["D1"]),
    createWorkstream("CD04", "P108-conversation-disclosure-evidence-foundation", "planned", ["CD03A"], ["D5", "D7", "D10", "D12"]),
    createWorkstream("CD05", "P109-chat-progressive-disclosure-surface", "planned", ["CD04"], ["D8"]),
    createWorkstream("CD06", "P110-cross-surface-progressive-disclosure", "planned", ["CD05"], ["D11"]),
    createWorkstream("CD07", "P111-conversation-evidence-inspector", "planned", ["CD06"], ["D1"]),
    createWorkstream("CD08", "P112-v11.9.2-disclosure-hardening", "planned", ["CD07"], ["D1"]),
    createWorkstream("CD09", "P113-v11.9.2-disclosure-adversarial-acceptance", "planned", ["CD08"], ["D1"]),
  ];
  workstreams[3].completionArtifacts = [
    ...governance.P107A_V11_COMPLETION_ARTIFACTS,
  ];
  workstreams[0].acceptanceScenarioIds = allScenarioIds;
  const features = [
    { id: workstreams[0].featureId, status: "done" },
    { id: workstreams[1].featureId, status: "done" },
    { id: workstreams[2].featureId, status: "done" },
    { id: workstreams[3].featureId, status: "in_progress" },
  ];
  const manifestDigest = digest("4");
  const attestationDigest = digest("5");
  const snapshotDigest = digest("6");
  const closureManifestPath =
    ".zerox/verification/conversation-disclosure/CD03-round23-closure-manifest.json";
  const program = {
      schemaVersion: 1,
      programId: "conversation-progressive-disclosure-v11.9.2-2026-08",
      status: "active",
      maxActiveFeatures: 1,
      activeFeatureId: workstreams[3].featureId as string | null,
      nextFeatureId: workstreams[3].featureId as string | null,
      sourceReview: ".zerox/research/P104-conversation-progressive-disclosure-study.md",
      operatingGuide: "AGENTS.md",
      architectureDecision: ".zerox/decisions/CD01-conversation-disclosure-program.md",
      acceptanceManifest:
        ".zerox/verification/conversation-disclosure/CD09-real-app-acceptance.json",
      invariants: ["i1", "i2", "i3", "i4", "i5"],
      nonGoals: ["n1", "n2", "n3"],
      deferrals: [{
        id: "private_reasoning",
        status: "kept_deferred",
        trigger: "separate approved contract",
        prohibitedCurrentAction: "do not persist private reasoning",
      }],
      rootFindings: Array.from({ length: 13 }, (_, index) => `D${index + 1}`),
      scenarioMatrix: scenarios,
      workstreams,
      implementationCompletionWorkstreamId: "CD08",
      postImplementationGates: ["CD09"],
  };
  const programRootBinding = governance.createProgramRootBindingV11(program);
  return {
    program,
    featureList: { features },
    closedWorld: {
      schemaVersion: 11,
      ...programRootBinding,
      ruleIds: [...governance.PROGRAM_GOVERNANCE_V11_RULE_IDS],
      workstreamIds: workstreams.map((workstream) => workstream.id),
    },
    lifecycleProfile: {
      phase: "review_pre",
      featureIds: features.map((feature) => feature.id),
      p107aWorkstreamId: "CD03A",
      p107aFeatureId: "P107A-conversation-disclosure-successor-admission",
      p108WorkstreamId: "CD04",
      p108FeatureId: "P108-conversation-disclosure-evidence-foundation",
    },
    parentEvidence: {
      closureManifestPath,
      artifact: {
        schemaVersion: 1,
        artifactId: "CD03-causal-shadow",
        programId: "conversation-progressive-disclosure-v11.9.2-2026-08",
        featureId: "P107-conversation-disclosure-domain-adapters",
        status: "accepted",
        independentReview: {
          closureManifestPath,
          history: [],
          round: 23,
          status: "passed",
        },
      },
      closureManifest: {
        schemaVersion: 1,
        kind: "conversation-disclosure-closure-manifest",
        programId: "conversation-progressive-disclosure-v11.9.2-2026-08",
        workstreamId: "CD03",
        featureId: "P107-conversation-disclosure-domain-adapters",
        round: 23,
        status: "externally_attested",
        digest: manifestDigest,
        snapshot: {
          path: ".zerox/verification/conversation-disclosure/CD03-round23-review-snapshot.json",
          digest: snapshotDigest,
        },
        reviewReceipts: ["contract", "runtime", "governance"].map((lane, index) => ({
          lane,
          path: `.zerox/verification/conversation-disclosure/CD03-round23-${lane}-review.json`,
          canonicalDigest: digest(String(index + 1)),
        })),
        externalAttestation: {
          path: ".zerox/verification/conversation-disclosure/CD03-round23-external-attestation.json",
          canonicalDigest: attestationDigest,
        },
      },
      externalAnchor: {
        digest: digest("7"),
        attestationDigest,
        snapshotDigest,
        reviewReceipts: ["contract", "runtime", "governance"].map((lane, index) => ({
          lane,
          canonicalDigest: digest(String(index + 1)),
          challenge: digest(String(index + 7)),
        })),
      },
      receipts: ["contract", "runtime", "governance"].map((lane, index) => ({
        lane,
        verdict: "passed",
        snapshotDigest,
        challenge: digest(String(index + 7)),
      })),
      externalAttestation: {
        status: "passed",
        digest: attestationDigest,
        snapshotDigest,
        reviewReceiptDigests: ["contract", "runtime", "governance"].map(
          (lane, index) => ({ lane, canonicalDigest: digest(String(index + 1)) }),
        ),
      },
    },
  };
}

function applyLifecycleProfile(input: GovernanceInput, phase: string) {
  const p107a = input.program.workstreams.find((workstream) => workstream.id === "CD03A")!;
  const p108 = input.program.workstreams.find((workstream) => workstream.id === "CD04")!;
  const p107aFeature = input.featureList.features.find(
    (feature) => feature.id === p107a.featureId,
  )!;
  input.lifecycleProfile.phase = phase;
  if (phase === "review_post") return;

  p107a.state = "completed";
  p107aFeature.status = "done";
  input.program.activeFeatureId = null;
  input.program.nextFeatureId = p108.featureId;
  if (phase === "anchored_planned") return;

  const p108Feature = {
    id: p108.featureId,
    status: phase === "authorized_active" ? "in_progress" : "done",
  };
  input.featureList.features.push(p108Feature);
  input.lifecycleProfile.featureIds.push(p108.featureId);
  if (phase === "authorized_active") {
    p108.state = "in_progress";
    input.program.activeFeatureId = p108.featureId;
    input.program.nextFeatureId = p108.featureId;
    return;
  }
  p108.state = "completed";
  input.program.nextFeatureId = input.program.workstreams.find(
    (workstream) => workstream.id === "CD05",
  )!.featureId;
}

function createWorkstream(
  id: string,
  featureId: string,
  state: string,
  dependsOn: string[],
  findings: string[],
) {
  return {
    id,
    title: id,
    featureId,
    state,
    findings,
    dependsOn,
    architectureDecisionRequired: true,
    architectureDecision: `.zerox/decisions/${id}.md`,
    completionArtifacts: [`.zerox/verification/conversation-disclosure/${id}.json`],
    acceptanceScenarioIds: ["S1"],
    rollback: `rollback ${id}`,
    verification: [`verify ${id}`],
  };
}

function createCd03Workstream() {
  return {
    ...createWorkstream(
      "CD03",
      "P107-conversation-disclosure-domain-adapters",
      "completed",
      ["CD02"],
      ["D2", "D3", "D6", "D9"],
    ),
    completionArtifacts: [
      ".zerox/verification/conversation-disclosure/CD03-causal-shadow.json",
    ],
    completionContract: {
      schemaVersion: 1,
      kind: "reviewed_shadow",
      primaryArtifact:
        ".zerox/verification/conversation-disclosure/CD03-causal-shadow.json",
      minimumIndependentPasses: 3,
      requiredReviewLanes: ["contract", "runtime", "governance"],
      requiredCharacterizationIds: [
        "C01-global-request-claim",
        "C02-attempt-control",
        "C03-assistant-receipt-order",
        "C04-message-first-repair",
        "C05-required-settlement",
        "C06-ordinary-queue-drain",
        "C07-workspace-lifecycle",
        "C08-event-first-repair",
        "C09-approval-durability",
        "C10-approval-recovery",
        "C11-distinct-causal-identities",
        "C12-single-live-answer",
        "C13-safe-compatibility",
      ],
      requiredSafety: { rawPrivateReasoningPersisted: false },
      requiredVerificationIds: [
        "focused",
        "test_type_coverage",
        "full_verify",
        "production_smoke",
        "governance",
      ],
      requiredExecutableClosurePaths: [
        "package.json",
        "scripts/check-harness-state.mjs",
        "scripts/check-conversation-disclosure-program.mjs",
      ],
      postReviewMutablePaths: [
        ".zerox/verification/conversation-disclosure/CD03-causal-shadow.json",
      ],
    },
  };
}

function createTransitions() {
  return Object.entries(
    contract.CONTINUATION_V11_GOVERNANCE_TRANSITIONS as Record<string, string>,
  )
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([livePath, kind], index) => ({
      path: livePath,
      kind,
      stagedTargetPath:
        `.zerox/verification/conversation-disclosure/CD03A-round11-target-${index}`,
      fromSha256: digest(String(index + 1)),
      toSha256: digest(String(index + 5)),
    }));
}

type GovernanceInput = ReturnType<typeof createInput>;
type GovernanceResult = ReturnType<typeof governance.validateConversationDisclosureProgramGovernanceV11>;
type RuleResult = GovernanceResult["ruleResults"][number];
