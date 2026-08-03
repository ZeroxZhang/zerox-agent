import type { Goal } from "../shared/agentGoal";
import type { ResolvedModelBinding } from "../shared/modelSettings";
import type { PlanRecord } from "../shared/planMode";

export function selectPlanExecutionModelBinding(
  plan: Pick<PlanRecord, "frozenModelAssignments">,
): ResolvedModelBinding | undefined {
  return (
    plan.frozenModelAssignments.c ??
    plan.frozenModelAssignments.direct ??
    plan.frozenModelAssignments.a ??
    plan.frozenModelAssignments.b
  );
}

export function selectRuntimeDirectProfileId(
  parentPlan: Pick<PlanRecord, "mode" | "frozenModelAssignments">,
  goal: Pick<Goal, "executionModelBinding">,
): string | undefined {
  return parentPlan.mode === "debate"
    ? parentPlan.frozenModelAssignments.c?.profileId
    : parentPlan.frozenModelAssignments.direct?.profileId ??
        goal.executionModelBinding?.profileId;
}

export async function resolveGoalExecutionModelBinding(
  goal: Pick<
    Goal,
    "executionModelBinding" | "sourcePlanRef" | "activePlanRef"
  >,
  getPlan: (planId: string) => Promise<PlanRecord | null>,
): Promise<ResolvedModelBinding | undefined> {
  if (goal.executionModelBinding) {
    return goal.executionModelBinding;
  }
  if (goal.activePlanRef) {
    const activePlan = await getPlan(goal.activePlanRef.planId);
    if (
      activePlan &&
      activePlan.goalPlanVersion === goal.activePlanRef.goalPlanVersion &&
      activePlan.goalContractRef?.sha256 ===
        goal.activePlanRef.goalContractRef.sha256
    ) {
      return selectPlanExecutionModelBinding(activePlan);
    }
  }
  if (!goal.sourcePlanRef) {
    return undefined;
  }

  const plan = await getPlan(goal.sourcePlanRef.planId);
  if (
    !plan ||
    plan.projection?.sha256 !== goal.sourcePlanRef.sha256
  ) {
    return undefined;
  }
  return selectPlanExecutionModelBinding(plan);
}
