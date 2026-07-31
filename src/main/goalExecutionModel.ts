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

export async function resolveGoalExecutionModelBinding(
  goal: Pick<Goal, "executionModelBinding" | "sourcePlanRef">,
  getPlan: (planId: string) => Promise<PlanRecord | null>,
): Promise<ResolvedModelBinding | undefined> {
  if (goal.executionModelBinding) {
    return goal.executionModelBinding;
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
