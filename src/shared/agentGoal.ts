import type { GoalReviewPolicy } from "./agentGoalReview";
import type { AgentTaskContract } from "./agentTaskContract";

export type GoalStatus =
  | "planning"
  | "executing"
  | "waiting_for_review"
  | "achieved"
  | "stopped_budget"
  | "stopped_stalled"
  | "failed"
  | "canceled";

export type StopReason =
  | "goal_accepted"
  | "budget_exhausted"
  | "progress_stalled"
  | "review_rejected"
  | "user_canceled"
  | "unrecoverable_failure";

export type AcceptanceCheckKind =
  | "file_exists"
  | "command_exit_code"
  | "test_passes"
  | "assertion"
  | "model_review";

export type AcceptanceCheck = {
  id: string;
  kind: AcceptanceCheckKind;
  description: string;
  params: Record<string, unknown>;
  requiresEvidence: boolean;
};

export type SuccessCriterion = {
  id: string;
  description: string;
  acceptanceChecks: AcceptanceCheck[];
};

export type MilestoneState =
  | "pending"
  | "ready"
  | "running"
  | "accepted"
  | "rejected"
  | "skipped"
  | "failed";

export type Milestone = {
  id: string;
  description: string;
  dependsOn: string[];
  successCriteria: SuccessCriterion[];
  state: MilestoneState;
  runIds: string[];
  attempts: number;
  lastAcceptanceSummary?: string;
  lastRunStatus?: "succeeded" | "failed" | "canceled" | "paused";
  lastRunSummary?: string;
};

export type GoalBudget = {
  maxIterations: number;
  maxToolCalls: number;
  maxWallClockMs: number;
  maxTokens?: number;
  maxReplans: number;
};

export type GoalBudgetUsage = {
  iterations: number;
  toolCalls: number;
  wallClockMs: number;
  tokens: number;
  replans: number;
};

export type Goal = {
  id: string;
  chatSessionId?: string;
  originMessageId?: string;
  description: string;
  successCriteria: SuccessCriterion[];
  milestones: Milestone[];
  status: GoalStatus;
  stopReason?: StopReason;
  budget: GoalBudget;
  budgetUsage: GoalBudgetUsage;
  reviewPolicy: GoalReviewPolicy;
  planVersion: number;
  workspaceId?: string;
  taskContract?: AgentTaskContract;
  createdAt: string;
  updatedAt: string;
};

const allowedTransitions: Record<GoalStatus, GoalStatus[]> = {
  planning: ["executing", "canceled"],
  executing: [
    "waiting_for_review",
    "achieved",
    "stopped_budget",
    "stopped_stalled",
    "failed",
    "canceled",
  ],
  waiting_for_review: ["executing", "canceled"],
  achieved: [],
  stopped_budget: ["executing", "canceled"],
  stopped_stalled: [],
  failed: [],
  canceled: [],
};

export function canTransitionGoalStatus(
  from: GoalStatus,
  to: GoalStatus,
): boolean {
  if (from === to) {
    return true;
  }

  return allowedTransitions[from].includes(to);
}

export function assertGoalTransition(from: GoalStatus, to: GoalStatus): void {
  if (!canTransitionGoalStatus(from, to)) {
    throw new Error(`Cannot transition goal from "${from}" to "${to}".`);
  }
}

export function validateGoalDraft(
  goal: Pick<Goal, "successCriteria" | "milestones">,
): void {
  if (goal.successCriteria.length === 0) {
    throw new Error("Goal must have at least one success criterion.");
  }

  for (const criterion of goal.successCriteria) {
    validateSuccessCriterion(criterion);
  }

  for (const milestone of goal.milestones) {
    if (milestone.successCriteria.length === 0) {
      throw new Error(
        `Milestone "${milestone.id}" must have at least one success criterion.`,
      );
    }

    for (const criterion of milestone.successCriteria) {
      validateSuccessCriterion(criterion);
    }
  }
}

function validateSuccessCriterion(criterion: SuccessCriterion): void {
  if (criterion.acceptanceChecks.length === 0) {
    throw new Error(
      `Success criterion "${criterion.id}" must have at least one acceptance check.`,
    );
  }

  for (const check of criterion.acceptanceChecks) {
    if (check.kind === "model_review" && !check.requiresEvidence) {
      throw new Error(`Model review check "${check.id}" must require evidence.`);
    }
  }
}
