import type { Milestone } from "./agentGoal";

export type GoalReviewPolicy =
  | "review_each_milestone"
  | "review_key_milestones"
  | "review_final_only"
  | "review_high_risk_only";

export type GoalReviewDecision =
  | { kind: "approve_continue" }
  | { kind: "modify_plan"; instructions: string }
  | { kind: "terminate" };

export function shouldRequestReview(
  policy: GoalReviewPolicy,
  milestone: Milestone,
  isFinal: boolean,
): boolean {
  if (policy === "review_each_milestone") {
    return true;
  }

  if (policy === "review_final_only") {
    return isFinal;
  }

  if (policy === "review_key_milestones") {
    return isFinal || getMilestoneMetadataFlag(milestone, "reviewRequired") === true;
  }

  // Policy B tool authorization is the only automatic safety confirmation gate.
  // Historical goals using review_high_risk_only must not create a second,
  // milestone-level Continue/Adjust prompt.
  return false;
}

function getMilestoneMetadataFlag(
  milestone: Milestone,
  key: "reviewRequired" | "riskLevel",
): unknown {
  return (milestone as Milestone & Record<string, unknown>)[key];
}
