import { describe, expect, it } from "vitest";
import { shouldRequestReview } from "./agentGoalReview";
import type { Milestone } from "./agentGoal";

describe("agent goal review policy", () => {
  it("requests review for every milestone when configured", () => {
    expect(shouldRequestReview("review_each_milestone", milestone(), false)).toBe(true);
    expect(shouldRequestReview("review_each_milestone", milestone(), true)).toBe(true);
  });

  it("requests review for key milestones and final milestones", () => {
    expect(shouldRequestReview("review_key_milestones", milestone(), false)).toBe(false);
    expect(
      shouldRequestReview(
        "review_key_milestones",
        { ...milestone(), reviewRequired: true } as Milestone & {
          reviewRequired: boolean;
        },
        false,
      ),
    ).toBe(true);
    expect(shouldRequestReview("review_key_milestones", milestone(), true)).toBe(true);
  });

  it("requests final-only reviews only for final acceptance", () => {
    expect(shouldRequestReview("review_final_only", milestone(), false)).toBe(false);
    expect(shouldRequestReview("review_final_only", milestone(), true)).toBe(true);
  });

  it("delegates high-risk confirmation to Policy B instead of goal review", () => {
    expect(shouldRequestReview("review_high_risk_only", milestone(), false)).toBe(false);
    expect(
      shouldRequestReview(
        "review_high_risk_only",
        { ...milestone(), riskLevel: "high" } as Milestone & {
          riskLevel: string;
        },
        false,
      ),
    ).toBe(false);
  });
});

function milestone(): Milestone {
  return {
    id: "milestone_1",
    description: "Do work.",
    dependsOn: [],
    successCriteria: [
      {
        id: "criterion",
        description: "Done.",
        acceptanceChecks: [
          {
            id: "check",
            kind: "assertion",
            description: "Done.",
            params: {},
            requiresEvidence: false,
          },
        ],
      },
    ],
    state: "ready",
    runIds: [],
    attempts: 0,
  };
}
