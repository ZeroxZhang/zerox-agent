import { describe, expect, it } from "vitest";
import {
  assertGoalTransition,
  canTransitionGoalStatus,
  validateGoalDraft,
  type Goal,
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
    budgetUsage: {
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
  it("allows the bounded goal status transitions", () => {
    expect(canTransitionGoalStatus("planning", "executing")).toBe(true);
    expect(canTransitionGoalStatus("executing", "waiting_for_review")).toBe(true);
    expect(canTransitionGoalStatus("waiting_for_review", "executing")).toBe(true);
    expect(canTransitionGoalStatus("executing", "achieved")).toBe(true);
    expect(canTransitionGoalStatus("executing", "stopped_budget")).toBe(true);
    expect(canTransitionGoalStatus("executing", "stopped_stalled")).toBe(true);
    expect(canTransitionGoalStatus("executing", "failed")).toBe(true);
    expect(canTransitionGoalStatus("executing", "canceled")).toBe(true);
    expect(canTransitionGoalStatus("waiting_for_review", "canceled")).toBe(true);
  });

  it("rejects transitions out of terminal goal states", () => {
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
