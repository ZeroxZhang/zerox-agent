import { createHash } from "node:crypto";
import {
  DEFAULT_GOAL_RISK_POLICY,
  DEFAULT_GOAL_STOP_POLICY,
  canonicalizeGoalContract,
  type GoalConstraint,
  type GoalContractRef,
  type GoalContractSnapshot,
} from "../shared/goalPlanContract";
import type { Goal } from "../shared/agentGoal";
import type { PlanRecord, PlanTaskContract } from "../shared/planMode";

export function createGoalContractRef(
  snapshot: GoalContractSnapshot,
): GoalContractRef {
  return {
    id: snapshot.id,
    revision: snapshot.revision,
    sha256: createHash("sha256")
      .update(canonicalizeGoalContract(snapshot))
      .digest("hex"),
  };
}

export function goalContractMatchesRef(
  snapshot: GoalContractSnapshot,
  reference: GoalContractRef,
): boolean {
  const actual = createGoalContractRef(snapshot);
  return (
    actual.id === reference.id &&
    actual.revision === reference.revision &&
    actual.sha256 === reference.sha256
  );
}

export function deriveGoalContractFromPlan(args: {
  planId: string;
  taskContract: PlanTaskContract;
  createdAt: string;
  revision?: number;
  contractId?: string;
}): GoalContractSnapshot {
  const contract = args.taskContract;
  const successCriteria = uniqueStrings(contract.successCriteria);
  const constraints: GoalConstraint[] = uniqueStrings(contract.constraints).map(
    (description, index) => ({
      id: `constraint_${index + 1}`,
      dimension: inferConstraintDimension(description),
      strength: "hard",
      description,
    }),
  );
  return {
    schemaVersion: 1,
    id: args.contractId ?? `goal_contract_${args.planId}`,
    revision: args.revision ?? 1,
    source: { kind: "plan", ref: args.planId },
    objective: contract.objective.trim(),
    deliverables: uniqueStrings(contract.deliverables ?? []),
    scope: {
      in: uniqueStrings(contract.inScope),
      out: uniqueStrings(contract.outOfScope),
    },
    assumptions: uniqueStrings(contract.assumptions),
    constraints,
    successCriteria: (successCriteria.length > 0
      ? successCriteria
      : [contract.objective.trim() || "Complete the requested outcome"]
    ).map(
      (description, index) => ({
        id: `criterion_${index + 1}`,
        description,
      }),
    ),
    stopPolicy: { ...DEFAULT_GOAL_STOP_POLICY },
    riskPolicy: { ...DEFAULT_GOAL_RISK_POLICY },
    createdAt: args.createdAt,
  };
}

export function deriveLegacyGoalContract(goal: Goal): GoalContractSnapshot {
  const successCriteria = goal.successCriteria
    .filter((criterion) => criterion.description.trim().length > 0)
    .map((criterion) => ({
      id: criterion.id,
      description: criterion.description,
    }));
  return {
    schemaVersion: 1,
    id: `goal_contract_${goal.id}`,
    revision: 1,
    source: { kind: "legacy_derived", ref: goal.id },
    objective: goal.description.trim() || goal.originalDescription?.trim() || goal.id,
    deliverables: [],
    scope: { in: [], out: [] },
    assumptions: [],
    constraints: [],
    successCriteria:
      successCriteria.length > 0
        ? successCriteria
        : [
            {
              id: "criterion_legacy_outcome",
              description:
                goal.description.trim() ||
                goal.originalDescription?.trim() ||
                "Complete the legacy Goal outcome",
            },
          ],
    stopPolicy: { ...DEFAULT_GOAL_STOP_POLICY },
    riskPolicy: { ...DEFAULT_GOAL_RISK_POLICY },
    createdAt: goal.createdAt,
  };
}

export function ensurePlanGoalContract(plan: PlanRecord): PlanRecord {
  if (plan.goalContractSnapshot && plan.goalContractRef) return plan;
  const snapshot = deriveGoalContractFromPlan({
    planId: plan.id,
    taskContract: plan.taskContract,
    createdAt: plan.createdAt,
  });
  return {
    ...plan,
    goalContractSnapshot: snapshot,
    goalContractRef: createGoalContractRef(snapshot),
  };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function inferConstraintDimension(
  value: string,
): GoalConstraint["dimension"] {
  const normalized = value.toLowerCase();
  if (/quality|质量|准确|完整/.test(normalized)) return "quality";
  if (/time|deadline|时间|期限/.test(normalized)) return "time";
  if (/cost|budget|成本|预算/.test(normalized)) return "cost";
  if (/safe|risk|安全|风险/.test(normalized)) return "safety";
  if (/permission|auth|权限|授权/.test(normalized)) return "permission";
  if (/source|citation|来源|引用/.test(normalized)) return "source";
  if (/scope|范围/.test(normalized)) return "scope";
  return "other";
}
