import { describe, expect, it } from "vitest";
import {
  assertGoalTransition,
  canTransitionGoalStatus,
  hasGoalCompletedExecution,
  projectGoalStatusForInteraction,
  upgradeGoalAcceptanceProtocol,
  validateGoal,
  validateGoalDraft,
  type AcceptanceFailureClass,
  type AcceptanceRepairDirective,
  type AcceptanceVerdict,
  type Goal,
  type GoalAcceptanceCertificate,
  type GoalAcceptanceCheckResult,
  type GoalAcceptanceFailureRecord,
  type GoalAcceptanceState,
  type GoalEvidenceManifest,
  type SuccessCriterion,
} from "./agentGoal";

const deterministicCriterion: SuccessCriterion = {
  id: "criterion_done",
  description: "The requested artifact exists.",
  acceptanceChecks: [
    {
      id: "check_file",
      kind: "file_exists",
      description: "The artifact file exists.",
      params: { path: "artifact.md" },
      requiresEvidence: false,
    },
  ],
};

function createGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: "goal_1",
    description: "Prepare a local research report.",
    successCriteria: [deterministicCriterion],
    milestones: [
      {
        id: "milestone_1",
        description: "Write the report.",
        dependsOn: [],
        successCriteria: [deterministicCriterion],
        state: "ready",
        runIds: [],
        attempts: 0,
      },
    ],
    status: "planning",
    budget: {
      maxIterations: 8,
      maxToolCalls: 24,
      maxWallClockMs: 600_000,
      maxReplans: 2,
    },
    executionUsage: {
      iterations: 0,
      toolCalls: 0,
      wallClockMs: 0,
      tokens: 0,
      replans: 0,
    },
    reviewPolicy: "review_final_only",
    planVersion: 1,
    createdAt: "2026-06-12T00:00:00.000Z",
    updatedAt: "2026-06-12T00:00:00.000Z",
    ...overrides,
  };
}

describe("agent goal model", () => {
  it("projects a legacy acceptance-only block as waiting for final acceptance", () => {
    const goal = createGoal({
      status: "stopped_blocked",
      stopReason: "acceptance_unavailable",
      milestones: createGoal().milestones.map((milestone) => ({
        ...milestone,
        state: "accepted" as const,
      })),
    });

    expect(hasGoalCompletedExecution(goal)).toBe(true);
    expect(projectGoalStatusForInteraction(goal)).toBe(
      "waiting_for_acceptance",
    );
    expect(goal.status).toBe("stopped_blocked");
  });

  it("does not hide a real execution block behind final-acceptance UI", () => {
    const goal = createGoal({
      status: "stopped_blocked",
      stopReason: "acceptance_unavailable",
    });

    expect(hasGoalCompletedExecution(goal)).toBe(false);
    expect(projectGoalStatusForInteraction(goal)).toBe("stopped_blocked");
  });

  it("allows the bounded goal status transitions", () => {
    expect(canTransitionGoalStatus("planning", "executing")).toBe(true);
    expect(canTransitionGoalStatus("executing", "waiting_for_review")).toBe(true);
    expect(canTransitionGoalStatus("waiting_for_review", "executing")).toBe(true);
    expect(canTransitionGoalStatus("executing", "achieved")).toBe(true);
    expect(canTransitionGoalStatus("executing", "stopped_budget")).toBe(false);
    expect(canTransitionGoalStatus("executing", "stopped_stalled")).toBe(true);
    expect(canTransitionGoalStatus("executing", "stopped_blocked")).toBe(true);
    expect(canTransitionGoalStatus("executing", "failed")).toBe(true);
    expect(canTransitionGoalStatus("executing", "canceled")).toBe(true);
    expect(canTransitionGoalStatus("waiting_for_review", "canceled")).toBe(true);
    expect(canTransitionGoalStatus("stopped_budget", "executing")).toBe(false);
    expect(canTransitionGoalStatus("stopped_blocked", "executing")).toBe(true);
    expect(canTransitionGoalStatus("stopped_blocked", "canceled")).toBe(true);
  });

  it("supports recoverable acceptance waiting and unverified completion", () => {
    expect(canTransitionGoalStatus("executing", "waiting_for_model")).toBe(true);
    expect(canTransitionGoalStatus("waiting_for_model", "executing")).toBe(true);
    expect(canTransitionGoalStatus("executing", "waiting_for_acceptance")).toBe(true);
    expect(canTransitionGoalStatus("waiting_for_acceptance", "executing")).toBe(true);
    expect(
      canTransitionGoalStatus(
        "waiting_for_acceptance",
        "completed_unverified",
      ),
    ).toBe(true);
    expect(canTransitionGoalStatus("waiting_for_acceptance", "canceled")).toBe(
      true,
    );
    expect(canTransitionGoalStatus("completed_unverified", "executing")).toBe(
      false,
    );
    expect(canTransitionGoalStatus("completed_unverified", "achieved")).toBe(
      false,
    );
  });

  it("preserves retry state and manual attestation during protocol upgrade", () => {
    const upgraded = upgradeGoalAcceptanceProtocol(
      createGoal({
        status: "waiting_for_acceptance",
        acceptanceRetryState: {
          cycle: 2,
          attempt: 3,
          maxAttempts: 3,
          lastCode: "judge_timeout",
          lastDetail: "Final judge timed out.",
          evidenceFingerprint: "a".repeat(64),
          resumeFrom: "final_judge",
        },
      }),
    );

    expect(upgraded.acceptanceRetryState?.resumeFrom).toBe("final_judge");
    expect(upgraded.acceptanceState?.phase).toBeDefined();
  });

  it("upgrades a legacy nonterminal goal without mutating the stored input", () => {
    const legacy = createGoal({ status: "executing" });

    const upgraded = upgradeGoalAcceptanceProtocol(legacy);

    expect(legacy.acceptanceProtocolVersion).toBeUndefined();
    expect(legacy.acceptanceState).toBeUndefined();
    expect(upgraded).not.toBe(legacy);
    expect(upgraded.acceptanceProtocolVersion).toBe(2);
    expect(upgraded.acceptanceState).toEqual({
      protocolVersion: 2,
      phase: "idle",
      attempt: 0,
      recentFailures: [],
    });
  });

  it("preserves a goal that already has protocol-v2 acceptance state", () => {
    const state: GoalAcceptanceState = {
      protocolVersion: 2,
      phase: "repairing",
      attempt: 2,
      recentFailures: [],
    };
    const current = createGoal({
      status: "executing",
      acceptanceProtocolVersion: 2,
      acceptanceState: state,
    });

    expect(upgradeGoalAcceptanceProtocol(current)).toBe(current);
  });

  it("accepts a backward-compatible bounded runtime checkpoint", () => {
    const goal = createGoal({
      runtimeCheckpoint: {
        milestoneId: "milestone_1",
        transcriptMessages: [
          { role: "assistant", content: "Continue from this action." },
          { role: "tool", tool_call_id: "call_1", content: "result" },
        ],
        nextAction: "Run the focused test.",
        updatedAt: "2026-07-11T19:20:00.000Z",
      },
    });

    expect(() => validateGoal(goal)).not.toThrow();
  });

  it("requires a certificate for a protocol-v2 achieved goal", () => {
    expect(() =>
      validateGoal(
        createGoal({ status: "achieved", acceptanceProtocolVersion: 2 }),
      ),
    ).toThrow(/certificate/i);
  });

  it("accepts a structurally certified protocol-v2 achieved goal", () => {
    const certificate: GoalAcceptanceCertificate = {
      version: 1,
      goalId: "goal_1",
      acceptedAt: "2026-06-12T00:00:00.000Z",
      protocolVersion: 2,
      criteriaHash: "criteria_sha256",
      planVersion: 1,
      runIds: ["run_1"],
      checkResults: [],
      evidence: [],
      certificateHash: "certificate_sha256",
    };

    expect(() =>
      validateGoal(
        createGoal({
          status: "achieved",
          acceptanceProtocolVersion: 2,
          acceptanceCertificate: certificate,
        }),
      ),
    ).not.toThrow();
  });

  it("exposes the exact protocol-v2 shared result discriminants", () => {
    const verdicts: AcceptanceVerdict[] = [
      "accepted",
      "rejected_repairable",
      "replan_required",
      "blocked_external",
      "impossible",
      "acceptance_unavailable",
    ];
    const failureClasses: AcceptanceFailureClass[] = [
      "artifact_missing",
      "artifact_invalid",
      "artifact_outside_boundary",
      "command_failed",
      "test_failed",
      "assertion_failed",
      "semantic_evidence_insufficient",
      "plan_structure_invalid",
      "external_dependency_missing",
      "goal_impossible",
      "validator_unavailable",
      "judge_unavailable",
      "unknown",
    ];
    const checkResult: GoalAcceptanceCheckResult = {
      checkId: "custom_check",
      kind: "validator:local/schema",
      passed: false,
      code: "schema_mismatch",
      failureClass: "artifact_invalid",
      evidenceRefs: ["artifact:report.json"],
      detail: "The report does not match the schema.",
    };
    const directive: AcceptanceRepairDirective = {
      action: "repair_same_milestone",
      summary: "Repair the report schema.",
      failedCheckIds: [checkResult.checkId],
      fingerprint: "failure_sha256",
      occurrence: 1,
      instructions: ["Add the required field."],
    };
    const failure: GoalAcceptanceFailureRecord = {
      at: "2026-06-12T00:00:00.000Z",
      targetKind: "goal",
      targetId: "goal_1",
      fingerprint: directive.fingerprint,
      occurrence: directive.occurrence,
      verdict: "rejected_repairable",
      failureClass: "artifact_invalid",
      failedCheckIds: directive.failedCheckIds,
      evidenceRefs: checkResult.evidenceRefs,
      actionSignatures: ["markdown_report_write:{}"],
    };
    const manifest: GoalEvidenceManifest = {
      version: 1,
      generatedAt: "2026-06-12T00:00:00.000Z",
      artifacts: [
        {
          ref: "artifact:report.json",
          mediaType: "application/json",
          jsonKeys: ["summary"],
          excerpts: [{ label: "tail", text: '{"summary":"draft"}' }],
        },
      ],
      totalRenderedChars: 19,
      truncated: false,
    };

    expect(verdicts).toHaveLength(6);
    expect(failureClasses).toHaveLength(13);
    expect(checkResult.kind).toBe("validator:local/schema");
    expect(failure.verdict).not.toBe("accepted");
    expect(manifest.artifacts[0]?.jsonKeys).toEqual(["summary"]);
  });

  it("rejects transitions out of completed terminal goal states", () => {
    expect(canTransitionGoalStatus("achieved", "executing")).toBe(false);
    expect(() => assertGoalTransition("achieved", "executing")).toThrow(
      'Cannot transition goal from "achieved" to "executing".',
    );
  });

  it("validates goals and milestones require acceptance checks", () => {
    expect(() => validateGoalDraft(createGoal())).not.toThrow();

    expect(() =>
      validateGoalDraft(createGoal({ successCriteria: [] })),
    ).toThrow("Goal must have at least one success criterion.");

    expect(() =>
      validateGoalDraft(
        createGoal({
          milestones: [
            {
              id: "milestone_empty",
              description: "No acceptance.",
              dependsOn: [],
              successCriteria: [],
              state: "pending",
              runIds: [],
              attempts: 0,
            },
          ],
        }),
      ),
    ).toThrow('Milestone "milestone_empty" must have at least one success criterion.');

    expect(() =>
      validateGoalDraft(
        createGoal({
          successCriteria: [
            {
              id: "criterion_empty",
              description: "No checks.",
              acceptanceChecks: [],
            },
          ],
        }),
      ),
    ).toThrow('Success criterion "criterion_empty" must have at least one acceptance check.');
  });

  it("requires model-review checks to cite evidence", () => {
    expect(() =>
      validateGoalDraft(
        createGoal({
          successCriteria: [
            {
              id: "criterion_review",
              description: "Reviewer accepts the work.",
              acceptanceChecks: [
                {
                  id: "check_review",
                  kind: "model_review",
                  description: "Review the evidence.",
                  params: { rubric: "complete" },
                  requiresEvidence: false,
                },
              ],
            },
          ],
        }),
      ),
    ).toThrow('Model review check "check_review" must require evidence.');
  });
});
