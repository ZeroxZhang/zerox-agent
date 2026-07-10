import type { GoalReviewPolicy } from "./agentGoalReview";
import type { AgentTaskContract } from "./agentTaskContract";
import type { SkillRecord } from "./skills";

export type GoalStatus =
  | "planning"
  | "executing"
  | "waiting_for_review"
  | "achieved"
  | "stopped_budget"
  | "stopped_stalled"
  | "stopped_blocked"
  | "failed"
  | "canceled";

export type StopReason =
  | "goal_accepted"
  | "budget_exhausted"
  | "progress_stalled"
  | "review_rejected"
  | "user_canceled"
  | "unrecoverable_failure"
  | "external_blocked"
  | "goal_impossible"
  | "acceptance_unavailable";

export type BuiltinAcceptanceCheckKind =
  | "file_exists"
  | "command_exit_code"
  | "test_passes"
  | "assertion"
  | "model_review";

export type AcceptanceCheckKind =
  | BuiltinAcceptanceCheckKind
  | `validator:${string}`;

export type GoalAcceptanceProtocolVersion = 1 | 2;

export type AcceptanceVerdict =
  | "accepted"
  | "rejected_repairable"
  | "replan_required"
  | "blocked_external"
  | "impossible"
  | "acceptance_unavailable";

export type AcceptanceFailureClass =
  | "artifact_missing"
  | "artifact_invalid"
  | "artifact_outside_boundary"
  | "command_failed"
  | "test_failed"
  | "assertion_failed"
  | "semantic_evidence_insufficient"
  | "plan_structure_invalid"
  | "external_dependency_missing"
  | "goal_impossible"
  | "validator_unavailable"
  | "judge_unavailable"
  | "unknown";

export type GoalAcceptanceCheckResult = {
  checkId: string;
  kind: AcceptanceCheckKind;
  passed: boolean;
  code: string;
  failureClass?: AcceptanceFailureClass;
  evidenceRefs: string[];
  detail: string;
};

export type AcceptanceRepairDirective = {
  action:
    | "repair_same_milestone"
    | "retry_alternate_strategy"
    | "replan"
    | "stop_stalled"
    | "stop_blocked";
  summary: string;
  failedCheckIds: string[];
  fingerprint: string;
  occurrence: number;
  instructions: string[];
};

export type GoalAcceptanceFailureRecord = {
  at: string;
  targetKind: "milestone" | "goal";
  targetId: string;
  fingerprint: string;
  occurrence: number;
  verdict: Exclude<AcceptanceVerdict, "accepted">;
  failureClass: AcceptanceFailureClass;
  failedCheckIds: string[];
  evidenceRefs: string[];
  actionSignatures: string[];
};

export type GoalAcceptanceState = {
  protocolVersion: 2;
  phase:
    | "idle"
    | "validating"
    | "repairing"
    | "judging"
    | "blocked"
    | "certified";
  attempt: number;
  recentFailures: GoalAcceptanceFailureRecord[];
  lastDecision?: AcceptanceRepairDirective;
};

export type GoalEvidenceArtifact = {
  ref: string;
  path?: string;
  mediaType: string;
  sizeBytes?: number;
  modifiedAt?: string;
  sha256?: string;
  lineCount?: number;
  headings?: Array<{ depth: number; text: string; line: number }>;
  jsonKeys?: string[];
  tableShape?: { rows: number; columns: number; headers: string[] };
  imageSize?: { width: number; height: number };
  excerpts: Array<{
    label: string;
    startLine?: number;
    endLine?: number;
    text: string;
  }>;
};

export type GoalEvidenceManifest = {
  version: 1;
  generatedAt: string;
  artifacts: GoalEvidenceArtifact[];
  totalRenderedChars: number;
  truncated: boolean;
};

export type GoalAcceptanceCertificate = {
  version: 1;
  goalId: string;
  acceptedAt: string;
  protocolVersion: 2;
  criteriaHash: string;
  planVersion: number;
  runIds: string[];
  checkResults: GoalAcceptanceCheckResult[];
  evidence: Array<{
    ref: string;
    path?: string;
    sha256?: string;
    sizeBytes?: number;
    provenanceRefs: string[];
  }>;
  judge?: {
    providerId?: string;
    model: string;
    promptVersion: string;
    evaluatedMessageIds: string[];
  };
  certificateHash: string;
};

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

export type GoalSelectedSkill = Pick<
  SkillRecord,
  "manifest" | "body" | "rootDir" | "skillFile"
>;

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
  selectedSkill?: GoalSelectedSkill;
  selectedSkillInputValues?: Record<string, string | number | boolean>;
  acceptanceProtocolVersion?: GoalAcceptanceProtocolVersion;
  acceptanceState?: GoalAcceptanceState;
  acceptanceCertificate?: GoalAcceptanceCertificate;
  createdAt: string;
  updatedAt: string;
};

export function upgradeGoalAcceptanceProtocol(goal: Goal): Goal {
  if (goal.acceptanceProtocolVersion === 2 && goal.acceptanceState) {
    return goal;
  }

  return {
    ...goal,
    acceptanceProtocolVersion: 2,
    acceptanceState: {
      protocolVersion: 2,
      phase: "idle",
      attempt: 0,
      recentFailures: [],
    },
  };
}

const allowedTransitions: Record<GoalStatus, GoalStatus[]> = {
  planning: ["executing", "canceled"],
  executing: [
    "waiting_for_review",
    "achieved",
    "stopped_budget",
    "stopped_stalled",
    "stopped_blocked",
    "failed",
    "canceled",
  ],
  waiting_for_review: ["executing", "canceled"],
  achieved: [],
  stopped_budget: ["executing", "canceled"],
  stopped_stalled: [],
  stopped_blocked: ["executing", "canceled"],
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

export function validateGoal(goal: Goal): void {
  validateGoalDraft(goal);

  if (
    goal.acceptanceProtocolVersion === 2 &&
    goal.status === "achieved" &&
    !goal.acceptanceCertificate
  ) {
    throw new Error(
      "Protocol-v2 achieved goals require an acceptance certificate.",
    );
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

// Progress ledger event — appended to each goal's ledger JSONL. Moved to shared
// so the storage contract (src/shared/storageContract.ts) can reference it.
export type ProgressLedgerEvent = {
  at: string;
  kind:
    | "goal_planned"
    | "milestone_started"
    | "milestone_accepted"
    | "milestone_rejected"
    | "goal_replanned"
    | "review_requested"
    | "review_resolved"
    | "goal_stopped";
  milestoneId?: string;
  summary: string;
  evidenceRefs?: string[];
};
