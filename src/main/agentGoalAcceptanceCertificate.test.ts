import { describe, expect, it } from "vitest";
import type {
  Goal,
  GoalAcceptanceCheckResult,
  GoalEvidenceManifest,
  SuccessCriterion,
} from "../shared/agentGoal";
import {
  createGoalAcceptanceCertificate,
  createGoalCriteriaHash,
  verifyGoalAcceptanceCertificate,
} from "./agentGoalAcceptanceCertificate";

describe("goal acceptance certificate", () => {
  it("keeps criteria hashes stable across recursive object-key and definition order", () => {
    const left = createGoal();
    const right = createGoal();
    right.successCriteria = [...right.successCriteria].reverse().map((criterion) => ({
      ...criterion,
      acceptanceChecks: [...criterion.acceptanceChecks].reverse().map((check) => ({
        requiresEvidence: check.requiresEvidence,
        params: reverseObjectKeys(check.params),
        description: check.description,
        kind: check.kind,
        id: check.id,
      })),
    }));

    expect(createGoalCriteriaHash(right)).toBe(createGoalCriteriaHash(left));
  });

  it("changes criteria hashes for meaningful criterion and check edits", () => {
    const goal = createGoal();
    const baseline = createGoalCriteriaHash(goal);
    const mutations: Goal[] = [
      withCriterionMutation(goal, (criterion) => ({
        ...criterion,
        description: "A materially different outcome.",
      })),
      withCheckMutation(goal, (check) => ({ ...check, kind: "test_passes" })),
      withCheckMutation(goal, (check) => ({
        ...check,
        params: { ...check.params, path: "different.md" },
      })),
      withCheckMutation(goal, (check) => ({
        ...check,
        requiresEvidence: !check.requiresEvidence,
      })),
    ];

    for (const mutated of mutations) {
      expect(createGoalCriteriaHash(mutated)).not.toBe(baseline);
    }
  });

  it("redacts secret-like criterion settings before hashing", () => {
    const left = withCheckMutation(createGoal(), (check) => ({
      ...check,
      params: { ...check.params, apiKey: "provider-secret-left" },
    }));
    const right = withCheckMutation(createGoal(), (check) => ({
      ...check,
      params: { ...check.params, apiKey: "provider-secret-right" },
    }));

    expect(createGoalCriteriaHash(left)).toBe(createGoalCriteriaHash(right));
  });

  it("creates a deterministic sorted certificate without mutating its input", () => {
    const left = validInput();
    left.runIds = ["run_z", "run_a", "run_z"];
    left.checkResults = [
      left.checkResults[1]!,
      left.checkResults[0]!,
      structuredClone(left.checkResults[1]!),
    ];
    left.evidenceManifest.artifacts = [
      left.evidenceManifest.artifacts[1]!,
      left.evidenceManifest.artifacts[0]!,
      structuredClone(left.evidenceManifest.artifacts[1]!),
    ];
    left.provenanceRefs = {
      "artifact:semantic": ["trajectory_z", "trajectory_a", "trajectory_z"],
      "artifact:report": ["trajectory_b", "trajectory_a", "trajectory_b"],
    };
    left.judge = {
      ...left.judge!,
      evaluatedMessageIds: ["message_z", "message_a", "message_z"],
    };
    const snapshot = structuredClone(left);

    const right = structuredClone(left);
    right.runIds.reverse();
    right.checkResults.reverse();
    right.evidenceManifest.artifacts.reverse();
    right.provenanceRefs = {
      "artifact:report": ["trajectory_a", "trajectory_b"],
      "artifact:semantic": ["trajectory_a", "trajectory_z"],
    };
    right.judge!.evaluatedMessageIds.reverse();

    const leftCertificate = createGoalAcceptanceCertificate(left);
    const rightCertificate = createGoalAcceptanceCertificate(right);

    expect(left).toEqual(snapshot);
    expect(leftCertificate).toEqual(rightCertificate);
    expect(leftCertificate.runIds).toEqual(["run_a", "run_z"]);
    expect(leftCertificate.checkResults.map((result) => result.checkId)).toEqual([
      "check_file",
      "check_semantic",
    ]);
    expect(leftCertificate.evidence.map((entry) => entry.ref)).toEqual([
      "artifact:report",
      "artifact:semantic",
    ]);
    expect(leftCertificate.evidence[0]?.provenanceRefs).toEqual([
      "trajectory_a",
      "trajectory_b",
    ]);
    expect(leftCertificate.judge?.evaluatedMessageIds).toEqual([
      "message_a",
      "message_z",
    ]);
    expect(leftCertificate.certificateHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("does not copy undeclared raw provider secrets into the certificate", () => {
    const input = validInput() as ReturnType<typeof validInput> & {
      providerApiKey: string;
      judge: NonNullable<ReturnType<typeof validInput>["judge"]> & {
        apiKey: string;
      };
    };
    input.providerApiKey = "top-level-secret";
    input.judge.apiKey = "judge-secret";

    const serialized = JSON.stringify(createGoalAcceptanceCertificate(input));

    expect(serialized).not.toContain("top-level-secret");
    expect(serialized).not.toContain("judge-secret");
    expect(serialized).not.toContain("apiKey");
  });

  it("verifies a valid complete protocol-v2 certificate", () => {
    expect(verifyGoalAcceptanceCertificate(certifiedGoal())).toEqual({ ok: true });
  });

  it.each([
    ["plan", (certificate: Goal["acceptanceCertificate"]) => {
      certificate!.planVersion += 1;
    }],
    ["check", (certificate: Goal["acceptanceCertificate"]) => {
      certificate!.checkResults[0]!.detail = "tampered check detail";
    }],
    ["evidence", (certificate: Goal["acceptanceCertificate"]) => {
      certificate!.evidence[0]!.sizeBytes = 99;
    }],
    ["judge", (certificate: Goal["acceptanceCertificate"]) => {
      certificate!.judge!.model = "tampered-model";
    }],
    ["run", (certificate: Goal["acceptanceCertificate"]) => {
      certificate!.runIds.push("run_tampered");
    }],
  ] as const)("detects %s-field tampering", (_field, tamper) => {
    const goal = certifiedGoal();
    tamper(goal.acceptanceCertificate);

    expect(verifyGoalAcceptanceCertificate(goal)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("hash"),
    });
  });

  it("detects a certificate whose evidence hash was modified", () => {
    const goal = certifiedGoal();
    goal.acceptanceCertificate!.evidence[0]!.sha256 = "0".repeat(64);

    expect(verifyGoalAcceptanceCertificate(goal)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("hash"),
    });
  });

  it("rejects failed, missing, duplicate, unknown, and wrong-kind check coverage", () => {
    const cases: Array<[string, ReturnType<typeof validInput>]> = [];

    const failed = validInput();
    failed.checkResults[0]!.passed = false;
    cases.push(["failed", failed]);

    const missing = validInput();
    missing.checkResults = missing.checkResults.slice(0, 1);
    cases.push(["missing", missing]);

    const duplicate = validInput();
    duplicate.checkResults.push({
      ...duplicate.checkResults[0]!,
      kind: "test_passes",
    });
    cases.push(["duplicate", duplicate]);

    const unknown = validInput();
    unknown.checkResults.push({
      ...unknown.checkResults[0]!,
      checkId: "check_unknown",
    });
    cases.push(["unknown", unknown]);

    const wrongKind = validInput();
    wrongKind.checkResults[0] = {
      ...wrongKind.checkResults[0]!,
      kind: "test_passes",
    };
    cases.push(["kind", wrongKind]);

    for (const [reason, input] of cases) {
      const goal = goalWithCertificate(
        input.goal,
        createGoalAcceptanceCertificate(input),
      );
      expect(verifyGoalAcceptanceCertificate(goal)).toMatchObject({
        ok: false,
        reason: expect.stringContaining(reason),
      });
    }
  });

  it("does not let an empty certificate certify a nonempty goal", () => {
    const input = validInput();
    input.checkResults = [];

    expect(
      verifyGoalAcceptanceCertificate(
        goalWithCertificate(input.goal, createGoalAcceptanceCertificate(input)),
      ),
    ).toMatchObject({ ok: false, reason: expect.stringContaining("missing") });
  });

  it.each([
    ["goal", (goal: Goal) => {
      goal.id = "goal_other";
    }],
    ["protocol", (goal: Goal) => {
      goal.acceptanceProtocolVersion = 1;
    }],
    ["plan", (goal: Goal) => {
      goal.planVersion += 1;
    }],
    ["criteria", (goal: Goal) => {
      goal.successCriteria[0]!.description = "Changed after certification.";
    }],
  ] as const)("rejects a %s mismatch", (reason, mutate) => {
    const goal = certifiedGoal();
    mutate(goal);

    expect(verifyGoalAcceptanceCertificate(goal)).toMatchObject({
      ok: false,
      reason: expect.stringContaining(reason),
    });
  });

  it.each([
    ["run id", (input: ReturnType<typeof validInput>) => {
      input.runIds = [""];
    }],
    ["evidence ref", (input: ReturnType<typeof validInput>) => {
      input.evidenceManifest.artifacts[0]!.ref = "";
    }],
    ["evidence hash", (input: ReturnType<typeof validInput>) => {
      input.evidenceManifest.artifacts[0]!.sha256 = "not-sha256";
    }],
    ["evidence size", (input: ReturnType<typeof validInput>) => {
      input.evidenceManifest.artifacts[0]!.sizeBytes = -1;
    }],
    ["provenance", (input: ReturnType<typeof validInput>) => {
      input.provenanceRefs["artifact:report"] = [""];
    }],
    ["judge", (input: ReturnType<typeof validInput>) => {
      input.judge!.model = "";
    }],
  ] as const)("rejects malformed %s structure", (reason, mutate) => {
    const input = validInput();
    mutate(input);
    const goal = goalWithCertificate(
      input.goal,
      createGoalAcceptanceCertificate(input),
    );

    expect(verifyGoalAcceptanceCertificate(goal)).toMatchObject({
      ok: false,
      reason: expect.stringContaining(reason),
    });
  });
});

function validInput() {
  const goal = createGoal();
  return {
    goal,
    acceptedAt: "2026-07-11T01:00:00.000Z",
    runIds: ["run_a", "run_z"],
    checkResults: validCheckResults(),
    evidenceManifest: validEvidenceManifest(),
    provenanceRefs: {
      "artifact:report": ["trajectory_a", "trajectory_b"],
      "artifact:semantic": ["trajectory_z"],
    } as Record<string, string[]>,
    judge: {
      providerId: "local-provider",
      model: "local-model",
      promptVersion: "goal-acceptance-v2",
      evaluatedMessageIds: ["message_a", "message_z"],
    },
  };
}

function certifiedGoal(): Goal {
  const input = validInput();
  return goalWithCertificate(
    input.goal,
    createGoalAcceptanceCertificate(input),
  );
}

function goalWithCertificate(
  goal: Goal,
  acceptanceCertificate: Goal["acceptanceCertificate"],
): Goal {
  return {
    ...structuredClone(goal),
    status: "achieved",
    stopReason: "goal_accepted",
    acceptanceState: {
      protocolVersion: 2,
      phase: "certified",
      attempt: 1,
      recentFailures: [],
    },
    acceptanceCertificate,
  };
}

function createGoal(): Goal {
  return {
    id: "goal_certificate",
    description: "Create and verify a local report.",
    successCriteria: criteria(),
    milestones: [],
    status: "executing",
    budget: {
      maxIterations: 8,
      maxToolCalls: 24,
      maxWallClockMs: 600_000,
      maxReplans: 2,
    },
    budgetUsage: {
      iterations: 1,
      toolCalls: 2,
      wallClockMs: 100,
      tokens: 0,
      replans: 0,
    },
    reviewPolicy: "review_final_only",
    planVersion: 3,
    acceptanceProtocolVersion: 2,
    acceptanceState: {
      protocolVersion: 2,
      phase: "judging",
      attempt: 1,
      recentFailures: [],
    },
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T01:00:00.000Z",
  };
}

function criteria(): SuccessCriterion[] {
  return [
    {
      id: "criterion_file",
      description: "The report exists and is complete.",
      acceptanceChecks: [
        {
          id: "check_file",
          kind: "file_exists",
          description: "The report file exists.",
          params: {
            destination: { path: "report.md", kind: "workspace" },
            path: "report.md",
          },
          requiresEvidence: true,
        },
      ],
    },
    {
      id: "criterion_semantic",
      description: "The report satisfies the requested meaning.",
      acceptanceChecks: [
        {
          id: "check_semantic",
          kind: "model_review",
          description: "Review the report against the requested outcome.",
          params: { condition: "The conclusion is supported by evidence." },
          requiresEvidence: true,
        },
      ],
    },
  ];
}

function validCheckResults(): GoalAcceptanceCheckResult[] {
  return [
    {
      checkId: "check_file",
      kind: "file_exists",
      passed: true,
      code: "file_exists",
      evidenceRefs: ["artifact:report"],
      detail: "The report exists.",
    },
    {
      checkId: "check_semantic",
      kind: "model_review",
      passed: true,
      code: "judge_accepted",
      evidenceRefs: ["artifact:semantic"],
      detail: "The report satisfies the requested meaning.",
    },
  ];
}

function validEvidenceManifest(): GoalEvidenceManifest {
  return {
    version: 1,
    generatedAt: "2026-07-11T00:59:00.000Z",
    totalRenderedChars: 200,
    truncated: false,
    artifacts: [
      {
        ref: "artifact:report",
        path: "/workspace/report.md",
        mediaType: "text/markdown",
        sizeBytes: 42,
        sha256: "a".repeat(64),
        excerpts: [],
      },
      {
        ref: "artifact:semantic",
        mediaType: "application/json",
        sizeBytes: 21,
        sha256: "b".repeat(64),
        excerpts: [],
      },
    ],
  };
}

function reverseObjectKeys(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, entry]) => [
        key,
        entry && typeof entry === "object" && !Array.isArray(entry)
          ? reverseObjectKeys(entry as Record<string, unknown>)
          : entry,
      ]),
  );
}

function withCriterionMutation(
  goal: Goal,
  mutate: (criterion: SuccessCriterion) => SuccessCriterion,
): Goal {
  const clone = structuredClone(goal);
  clone.successCriteria[0] = mutate(clone.successCriteria[0]!);
  return clone;
}

function withCheckMutation(
  goal: Goal,
  mutate: (
    check: SuccessCriterion["acceptanceChecks"][number],
  ) => SuccessCriterion["acceptanceChecks"][number],
): Goal {
  const clone = structuredClone(goal);
  clone.successCriteria[0]!.acceptanceChecks[0] = mutate(
    clone.successCriteria[0]!.acceptanceChecks[0]!,
  );
  return clone;
}
