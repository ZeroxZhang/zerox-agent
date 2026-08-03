export type GoalContractSourceKind =
  | "user"
  | "plan"
  | "goal_amendment"
  | "legacy_derived";

export type GoalContractSource = {
  kind: GoalContractSourceKind;
  ref?: string;
  summary?: string;
};

export type GoalConstraintDimension =
  | "quality"
  | "time"
  | "cost"
  | "safety"
  | "permission"
  | "source"
  | "scope"
  | "other";

export type GoalConstraint = {
  id: string;
  dimension: GoalConstraintDimension;
  strength: "hard" | "preference";
  description: string;
};

export type GoalContractCriterion = {
  id: string;
  description: string;
};

export type GoalStopPolicy = {
  onSuccess: "acceptance_certificate";
  onUserCancel: "cancel";
  onExternalBlock: "await_input" | "stop_blocked";
  onImpossible: "propose_goal_amendment" | "stop_impossible";
  onSafetyBlock: "request_confirmation" | "stop_blocked";
};

export type GoalRiskPolicy = {
  ordinaryOperations: "auto_decide" | "request_confirmation";
  highRiskOperations: "request_confirmation";
  irreversibleOperations: "request_confirmation";
};

/**
 * Immutable semantic input to every planner working for one Goal revision.
 * Execution details belong to PlanRecord, not this snapshot.
 */
export type GoalContractSnapshot = {
  schemaVersion: 1;
  id: string;
  revision: number;
  source: GoalContractSource;
  objective: string;
  deliverables: string[];
  scope: {
    in: string[];
    out: string[];
  };
  assumptions: string[];
  constraints: GoalConstraint[];
  successCriteria: GoalContractCriterion[];
  stopPolicy: GoalStopPolicy;
  riskPolicy: GoalRiskPolicy;
  createdAt: string;
};

export type GoalContractRef = Pick<
  GoalContractSnapshot,
  "id" | "revision"
> & {
  sha256: string;
};

export type GoalPlanPurpose = "initial" | "runtime_replan";

export type GoalPlanTriggerKind =
  | "initial_request"
  | "user_adjustment"
  | "environment_feedback"
  | "acceptance_failure"
  | "structure_invalidated"
  | "goal_amendment"
  | "legacy_upgrade";

export type GoalPlanTrigger = {
  kind: GoalPlanTriggerKind;
  summary: string;
  evidenceRefs: string[];
  at: string;
};

export type GoalPlanRef = {
  planId: string;
  planRevision: number;
  goalPlanVersion: number;
  mode: "direct" | "debate" | "legacy";
  purpose: GoalPlanPurpose;
  goalContractRef: GoalContractRef;
};

export type GoalPlanAdoptionOutcome =
  | "candidate"
  | "active"
  | "superseded"
  | "rejected"
  | "legacy_compacted";

export type GoalPlanHistoryEntry = GoalPlanRef & {
  parentPlanRef?: GoalPlanRef;
  trigger: GoalPlanTrigger;
  outcome: GoalPlanAdoptionOutcome;
  adoptedAt?: string;
  supersededAt?: string;
};

export type PlanCriterionBinding = {
  criterionId: string;
  milestoneIds: string[];
  checkIds: string[];
};

export type GoalContractIssue = {
  id: string;
  severity: "warning" | "blocking";
  description: string;
  evidenceRefs: string[];
};

export type GoalAmendmentProposal = {
  id: string;
  goalId: string;
  baseContractRef: GoalContractRef;
  candidateContract: GoalContractSnapshot;
  candidateContractRef: GoalContractRef;
  reason: string;
  status: "pending" | "approved" | "applied" | "rejected";
  pausedExecution?: boolean;
  candidatePlanId?: string;
  createdAt: string;
  resolvedAt?: string;
  appliedAt?: string;
};

export const DEFAULT_GOAL_STOP_POLICY: GoalStopPolicy = {
  onSuccess: "acceptance_certificate",
  onUserCancel: "cancel",
  onExternalBlock: "await_input",
  onImpossible: "propose_goal_amendment",
  onSafetyBlock: "request_confirmation",
};

export const DEFAULT_GOAL_RISK_POLICY: GoalRiskPolicy = {
  ordinaryOperations: "auto_decide",
  highRiskOperations: "request_confirmation",
  irreversibleOperations: "request_confirmation",
};

export function canonicalizeGoalContract(
  snapshot: GoalContractSnapshot,
): string {
  return stableStringify(snapshot);
}

export function isGoalContractRef(value: unknown): value is GoalContractRef {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isPositiveInteger(value.revision) &&
    typeof value.sha256 === "string" &&
    /^[a-f0-9]{64}$/.test(value.sha256)
  );
}

export function isGoalContractSnapshot(
  value: unknown,
): value is GoalContractSnapshot {
  if (!isRecord(value) || !isRecord(value.source)) return false;
  if (!isRecord(value.scope) || !isRecord(value.stopPolicy)) return false;
  if (!isRecord(value.riskPolicy)) return false;
  return (
    value.schemaVersion === 1 &&
    isNonEmptyString(value.id) &&
    isPositiveInteger(value.revision) &&
    isNonEmptyString(value.objective) &&
    isNonEmptyString(value.createdAt) &&
    isStringArray(value.deliverables) &&
    isStringArray(value.scope.in) &&
    isStringArray(value.scope.out) &&
    isStringArray(value.assumptions) &&
    Array.isArray(value.constraints) &&
    value.constraints.every(isGoalConstraint) &&
    Array.isArray(value.successCriteria) &&
    value.successCriteria.length > 0 &&
    value.successCriteria.every(isGoalContractCriterion) &&
    isGoalContractSourceKind(value.source.kind) &&
    (value.source.ref === undefined || typeof value.source.ref === "string") &&
    (value.source.summary === undefined ||
      typeof value.source.summary === "string") &&
    value.stopPolicy.onSuccess === "acceptance_certificate" &&
    value.stopPolicy.onUserCancel === "cancel" &&
    (value.stopPolicy.onExternalBlock === "await_input" ||
      value.stopPolicy.onExternalBlock === "stop_blocked") &&
    (value.stopPolicy.onImpossible === "propose_goal_amendment" ||
      value.stopPolicy.onImpossible === "stop_impossible") &&
    (value.stopPolicy.onSafetyBlock === "request_confirmation" ||
      value.stopPolicy.onSafetyBlock === "stop_blocked") &&
    (value.riskPolicy.ordinaryOperations === "auto_decide" ||
      value.riskPolicy.ordinaryOperations === "request_confirmation") &&
    value.riskPolicy.highRiskOperations === "request_confirmation" &&
    value.riskPolicy.irreversibleOperations === "request_confirmation"
  );
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isGoalContractSourceKind(
  value: unknown,
): value is GoalContractSourceKind {
  return (
    value === "user" ||
    value === "plan" ||
    value === "goal_amendment" ||
    value === "legacy_derived"
  );
}

function isGoalConstraint(value: unknown): value is GoalConstraint {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isGoalConstraintDimension(value.dimension) &&
    (value.strength === "hard" || value.strength === "preference") &&
    isNonEmptyString(value.description)
  );
}

function isGoalConstraintDimension(
  value: unknown,
): value is GoalConstraintDimension {
  return (
    value === "quality" ||
    value === "time" ||
    value === "cost" ||
    value === "safety" ||
    value === "permission" ||
    value === "source" ||
    value === "scope" ||
    value === "other"
  );
}

function isGoalContractCriterion(
  value: unknown,
): value is GoalContractCriterion {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.description)
  );
}
