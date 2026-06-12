export type GoalReviewPolicy =
  | "review_each_milestone"
  | "review_key_milestones"
  | "review_final_only"
  | "review_high_risk_only";

export type GoalReviewDecision =
  | { kind: "approve_continue" }
  | { kind: "modify_plan"; instructions: string }
  | { kind: "terminate" };
