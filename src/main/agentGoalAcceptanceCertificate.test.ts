import { createHash } from "node:crypto";
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
  GoalAcceptanceCertificateInputError,
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

  it("keeps legitimate tokenBudget params meaningful in the criteria hash", () => {
    const left = withCheckMutation(createGoal(), (check) => ({
      ...check,
      params: { ...check.params, tokenBudget: 1_000 },
    }));
    const right = withCheckMutation(createGoal(), (check) => ({
      ...check,
      params: { ...check.params, tokenBudget: 2_000 },
    }));

    expect(createGoalCriteriaHash(left)).not.toBe(createGoalCriteriaHash(right));
  });

  it.each([
    "apiKey",
    "accessToken",
    "authorization",
    "password",
    "secret",
    "cookie",
    "credential",
    "privateKey",
    "providerApiKey",
    "openai_access_token",
    "clientSecret",
  ])("rejects raw secret-bearing criterion param key %s", (secretKey) => {
    const goal = createGoal();
    goal.successCriteria[0]!.acceptanceChecks[0]!.params = {
      safe: true,
      nested: { [secretKey]: "must-not-be-hashed" },
    };

    expect(() => createGoalCriteriaHash(goal)).toThrowError(
      GoalAcceptanceCertificateInputError,
    );
    expect(() => createGoalCriteriaHash(goal)).toThrow(secretKey);
  });

  it("turns secret-bearing criteria into a typed verification failure", () => {
    const goal = certifiedGoal();
    goal.successCriteria[0]!.acceptanceChecks[0]!.params = {
      apiKey: "must-not-be-hashed",
    };

    expect(() => verifyGoalAcceptanceCertificate(goal)).not.toThrow();
    expect(verifyGoalAcceptanceCertificate(goal)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("apiKey"),
    });
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

  it.each(["providerApiKey", "unexpectedField"])(
    "rejects undeclared top-level certificate input property %s",
    (property) => {
      const input = validInput() as ReturnType<typeof validInput> &
        Record<string, unknown>;
      input[property] = "must-not-be-accepted";

      expect(() => createGoalAcceptanceCertificate(input)).toThrowError(
        GoalAcceptanceCertificateInputError,
      );
      expect(() => createGoalAcceptanceCertificate(input)).toThrow(property);
    },
  );

  it.each(["apiKey", "unexpectedField"])(
    "rejects undeclared judge property %s",
    (property) => {
      const input = validInput();
      (input.judge as Record<string, unknown>)[property] =
        "must-not-be-accepted";

      expect(() => createGoalAcceptanceCertificate(input)).toThrowError(
        GoalAcceptanceCertificateInputError,
      );
      expect(() => createGoalAcceptanceCertificate(input)).toThrow(property);
    },
  );

  it("rejects proxy and getter certificate input envelopes without raw exceptions", () => {
    const proxied = new Proxy(validInput(), {});
    expect(() => createGoalAcceptanceCertificate(proxied)).toThrowError(
      GoalAcceptanceCertificateInputError,
    );

    const getterInput = validInput();
    Object.defineProperty(getterInput, "runIds", {
      enumerable: true,
      get() {
        throw new Error("RAW_INPUT_GETTER_ERROR");
      },
    });
    expect(() => createGoalAcceptanceCertificate(getterInput)).toThrowError(
      GoalAcceptanceCertificateInputError,
    );

    const judgeGetter = validInput();
    Object.defineProperty(judgeGetter.judge!, "model", {
      enumerable: true,
      get() {
        throw new Error("RAW_JUDGE_GETTER_ERROR");
      },
    });
    expect(() => createGoalAcceptanceCertificate(judgeGetter)).toThrowError(
      GoalAcceptanceCertificateInputError,
    );
  });

  it("accepts a normal full Goal inside the declared goal envelope", () => {
    const input = validInput();

    expect(input.goal).toHaveProperty("budget");
    expect(() => createGoalAcceptanceCertificate(input)).not.toThrow();
  });

  it("verifies a valid complete protocol-v2 certificate", () => {
    expect(verifyGoalAcceptanceCertificate(certifiedGoal())).toEqual({ ok: true });
  });

  it("rejects dangling non-manifest refs instead of synthesizing evidence", () => {
    const input = validInput();
    input.evidenceManifest.artifacts = input.evidenceManifest.artifacts.filter(
      (artifact) => artifact.ref !== "artifact:semantic",
    );
    delete input.provenanceRefs["artifact:semantic"];

    expect(() => createGoalAcceptanceCertificate(input)).toThrowError(
      GoalAcceptanceCertificateInputError,
    );
    expect(() => createGoalAcceptanceCertificate(input)).toThrow(
      /not grounded|does not resolve/i,
    );
  });

  it("keeps certificate evidence limited to actual manifest artifacts", () => {
    const input = validInput();
    const certificate = createGoalAcceptanceCertificate(input);

    expect(certificate.evidence.map((entry) => entry.ref)).toEqual([
      "artifact:report",
      "artifact:semantic",
    ]);
    expect(verifyGoalAcceptanceCertificate(
      goalWithCertificate(input.goal, certificate),
    )).toEqual({ ok: true });
  });

  it("resolves result evidence through the owning entry provenance refs", () => {
    const input = validInput();
    input.checkResults[1]!.evidenceRefs = ["trajectory_z"];

    const certificate = createGoalAcceptanceCertificate(input);

    expect(certificate.evidence).not.toContainEqual(
      expect.objectContaining({ ref: "trajectory_z" }),
    );
    expect(verifyGoalAcceptanceCertificate(
      goalWithCertificate(input.goal, certificate),
    )).toEqual({ ok: true });
  });

  it("grounds semantic result evidence in evaluated judge message identity", () => {
    const input = validInput();
    input.checkResults[1]!.evidenceRefs = ["message_a"];

    const certificate = createGoalAcceptanceCertificate(input);

    expect(certificate.evidence.map((entry) => entry.ref)).toEqual([
      "artifact:report",
      "artifact:semantic",
    ]);
    expect(verifyGoalAcceptanceCertificate(
      goalWithCertificate(input.goal, certificate),
    )).toEqual({ ok: true });
  });

  it("grounds result evidence in an explicitly prefixed certificate run id", () => {
    const input = validInput();
    input.checkResults[0]!.evidenceRefs = ["run:run_a"];

    const certificate = createGoalAcceptanceCertificate(input);

    expect(verifyGoalAcceptanceCertificate(
      goalWithCertificate(input.goal, certificate),
    )).toEqual({ ok: true });
  });

  it("rejects a required-evidence check with no result evidence refs", () => {
    const input = validInput();
    input.checkResults[0]!.evidenceRefs = [];
    expect(() => createGoalAcceptanceCertificate(input)).toThrowError(
      GoalAcceptanceCertificateInputError,
    );

    const goal = certifiedGoal();
    goal.acceptanceCertificate!.checkResults[0]!.evidenceRefs = [];
    resignCertificate(goal);
    expect(verifyGoalAcceptanceCertificate(goal)).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/requires evidence|missing evidence/i),
    });
  });

  it("rejects an evidence ref that ambiguously resolves to multiple entries", () => {
    const input = validInput();
    input.checkResults[1]!.evidenceRefs = ["trajectory_shared"];
    input.provenanceRefs["artifact:report"] = ["trajectory_shared"];
    input.provenanceRefs["artifact:semantic"] = ["trajectory_shared"];
    expect(() => createGoalAcceptanceCertificate(input)).toThrowError(
      GoalAcceptanceCertificateInputError,
    );
    expect(() => createGoalAcceptanceCertificate(input)).toThrow(/ambiguous/);

    const goal = certifiedGoal();
    goal.acceptanceCertificate!.checkResults[1]!.evidenceRefs = [
      "trajectory_shared",
    ];
    goal.acceptanceCertificate!.evidence[0]!.provenanceRefs.push(
      "trajectory_shared",
    );
    goal.acceptanceCertificate!.evidence[1]!.provenanceRefs.push(
      "trajectory_shared",
    );
    resignCertificate(goal);
    expect(verifyGoalAcceptanceCertificate(goal)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("ambiguous"),
    });
  });

  it("rejects a dangling result evidence ref even with a matching digest", () => {
    const goal = certifiedGoal();
    goal.acceptanceCertificate!.checkResults[1]!.evidenceRefs = [
      "trajectory_dangling",
    ];
    resignCertificate(goal);

    expect(verifyGoalAcceptanceCertificate(goal)).toMatchObject({
      ok: false,
      reason: expect.stringContaining("does not resolve"),
    });
  });

  it("requires nonempty run identity at certificate creation and verification", () => {
    const input = validInput();
    input.runIds = [];

    expect(() => createGoalAcceptanceCertificate(input)).toThrowError(
      GoalAcceptanceCertificateInputError,
    );
    expect(() => createGoalAcceptanceCertificate(input)).toThrow(/run id/i);

    const goal = certifiedGoal();
    goal.acceptanceCertificate!.runIds = [];
    resignCertificate(goal);
    expect(verifyGoalAcceptanceCertificate(goal)).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/nonempty run|run identity/i),
    });
  });

  it("requires semantic judge metadata with evaluated message identity", () => {
    const missingJudge = validInput();
    delete (missingJudge as Partial<typeof missingJudge>).judge;
    expect(() => createGoalAcceptanceCertificate(missingJudge)).toThrowError(
      GoalAcceptanceCertificateInputError,
    );

    const noMessages = validInput();
    noMessages.judge!.evaluatedMessageIds = [];
    expect(() => createGoalAcceptanceCertificate(noMessages)).toThrowError(
      GoalAcceptanceCertificateInputError,
    );
    expect(() => createGoalAcceptanceCertificate(noMessages)).toThrow(
      /evaluated message/i,
    );
  });

  it("allows a deterministic-only certificate without judge metadata", () => {
    const input = validInput();
    input.goal.successCriteria = input.goal.successCriteria.slice(0, 1);
    input.checkResults = input.checkResults.slice(0, 1);
    input.evidenceManifest.artifacts = input.evidenceManifest.artifacts.slice(0, 1);
    delete (input as Partial<typeof input>).judge;

    const certificate = createGoalAcceptanceCertificate(input);

    expect(certificate.judge).toBeUndefined();
    expect(verifyGoalAcceptanceCertificate(
      goalWithCertificate(input.goal, certificate),
    )).toEqual({ ok: true });
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
    ["run id", (goal: Goal) => {
      goal.acceptanceCertificate!.runIds = [""];
    }],
    ["evidence ref", (goal: Goal) => {
      goal.acceptanceCertificate!.evidence[0]!.ref = "";
    }],
    ["evidence hash", (goal: Goal) => {
      goal.acceptanceCertificate!.evidence[0]!.sha256 = "not-sha256";
    }],
    ["evidence size", (goal: Goal) => {
      goal.acceptanceCertificate!.evidence[0]!.sizeBytes = -1;
    }],
    ["provenance", (goal: Goal) => {
      goal.acceptanceCertificate!.evidence[0]!.provenanceRefs = [""];
    }],
    ["judge", (goal: Goal) => {
      goal.acceptanceCertificate!.judge!.model = "";
    }],
  ] as const)("rejects malformed %s structure", (reason, mutate) => {
    const goal = certifiedGoal();
    mutate(goal);
    resignCertificate(goal);

    expect(verifyGoalAcceptanceCertificate(goal)).toMatchObject({
      ok: false,
      reason: expect.stringContaining(reason),
    });
  });

  it.each([
    ["Date", () => new Date("2026-07-11T00:00:00.000Z")],
    ["class instance", () => new (class CriterionParam { value = 1; })()],
    ["getter", () => {
      const value = {};
      Object.defineProperty(value, "unsafe", {
        enumerable: true,
        get() {
          throw new Error("RAW_GETTER_ERROR");
        },
      });
      return value;
    }],
    ["function", () => (() => true)],
    ["symbol", () => Symbol("unsafe")],
    ["undefined", () => undefined],
    ["nonfinite", () => Number.POSITIVE_INFINITY],
    ["cycle", () => {
      const value: Record<string, unknown> = {};
      value.self = value;
      return value;
    }],
    ["proxy", () => new Proxy({ safe: true }, {
      ownKeys() {
        throw new Error("RAW_PROXY_ERROR");
      },
    })],
  ] as Array<[string, () => unknown]>)(
    "rejects non-JSON-safe %s values with a typed error",
    (_name, value) => {
      const goal = createGoal();
      goal.successCriteria[0]!.acceptanceChecks[0]!.params = {
        unsafe: value(),
      };

      expect(() => createGoalCriteriaHash(goal)).toThrowError(
        GoalAcceptanceCertificateInputError,
      );
    },
  );

  it.each([
    ["depth", () => nestedValue(80)],
    ["node", () => Object.fromEntries(
      Array.from({ length: 20_100 }, (_, index) => [`key_${index}`, index]),
    )],
    ["array", () => Array.from({ length: 10_100 }, (_, index) => index)],
    ["string", () => "x".repeat(300_000)],
    ["byte", () => Array.from({ length: 5_000 }, () => "x".repeat(256))],
  ] as const)("enforces the canonical %s bound", (bound, value) => {
    const goal = createGoal();
    goal.successCriteria[0]!.acceptanceChecks[0]!.params = {
      bounded: value(),
    };

    expect(() => createGoalCriteriaHash(goal)).toThrowError(
      GoalAcceptanceCertificateInputError,
    );
    expect(() => createGoalCriteriaHash(goal)).toThrow(bound);
  });

  it("turns hostile certificate proxies into typed verification failures", () => {
    const goal = certifiedGoal();
    goal.acceptanceCertificate = new Proxy(goal.acceptanceCertificate!, {
      ownKeys() {
        throw new Error("RAW_PROXY_ERROR");
      },
    });

    expect(() => verifyGoalAcceptanceCertificate(goal)).not.toThrow();
    expect(verifyGoalAcceptanceCertificate(goal)).toMatchObject({
      ok: false,
      reason: expect.not.stringContaining("RAW_PROXY_ERROR"),
    });
  });

  it("rejects certificate accessors even when JSON rest syntax would ignore them", () => {
    const goal = certifiedGoal();
    Object.defineProperty(goal.acceptanceCertificate!, "ignoredAccessor", {
      enumerable: false,
      get() {
        throw new Error("RAW_CERTIFICATE_GETTER_ERROR");
      },
    });

    expect(() => verifyGoalAcceptanceCertificate(goal)).not.toThrow();
    expect(verifyGoalAcceptanceCertificate(goal)).toMatchObject({
      ok: false,
      reason: expect.not.stringContaining("RAW_CERTIFICATE_GETTER_ERROR"),
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

function resignCertificate(goal: Goal): void {
  const certificate = goal.acceptanceCertificate!;
  const { certificateHash: _certificateHash, ...unsigned } = certificate;
  certificate.certificateHash = createHash("sha256")
    .update(stableJsonForTest(unsigned))
    .digest("hex");
}

function stableJsonForTest(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJsonForTest).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort(compareCodeUnitsForTest)
      .map((key) => `${JSON.stringify(key)}:${stableJsonForTest(
        (value as Record<string, unknown>)[key],
      )}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function compareCodeUnitsForTest(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function nestedValue(depth: number): Record<string, unknown> {
  let value: Record<string, unknown> = { leaf: true };
  for (let index = 0; index < depth; index += 1) {
    value = { child: value };
  }
  return value;
}
