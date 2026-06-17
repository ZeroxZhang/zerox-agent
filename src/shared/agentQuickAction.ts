import type {
  ResolvedReference,
  RuntimeStrategy,
  StrategyPlanStep,
  TaskFrame,
} from "./agentTaskStrategy";
import {
  buildWorkflowStrategyPlan,
  selectWorkflowForTask,
  type WorkflowId,
} from "./agentWorkflowCatalog";

export type QuickActionPlan = {
  id: string;
  workflowId: WorkflowId;
  description: string;
  runtime: Extract<RuntimeStrategy, "quick_action">;
  confirmationRequired: boolean;
  targetRefs: ResolvedReference[];
  review?: {
    gateId: string;
    beforeStepId: string;
    reason: string;
  };
  recoveryTools: string[];
  steps: QuickActionStep[];
};

export type QuickActionStep = Pick<
  StrategyPlanStep,
  "id" | "operation" | "toolName" | "toolClass" | "risk" | "batchExpected"
>;

export function createQuickActionPlan(
  description: string,
  frame: TaskFrame,
): QuickActionPlan | null {
  const workflow = selectWorkflowForTask(frame);
  if (!workflow || workflow.preferredRuntime !== "quick_action") {
    return null;
  }

  const strategyPlan = buildWorkflowStrategyPlan(frame, workflow);
  const [reviewGate] = strategyPlan.confirmationGates;

  return {
    id: `quick_${workflow.id}`,
    workflowId: workflow.id,
    description,
    runtime: "quick_action",
    confirmationRequired:
      frame.needsConfirmation || strategyPlan.confirmationGates.length > 0,
    targetRefs: frame.targetRefs,
    recoveryTools: workflow.recoveryTools ?? [],
    ...(reviewGate
      ? {
          review: {
            gateId: reviewGate.id,
            beforeStepId: reviewGate.beforeStepId,
            reason: reviewGate.reason,
          },
        }
      : {}),
    steps: strategyPlan.steps.map((step) => ({
      id: step.id,
      operation: step.operation,
      toolName: step.toolName,
      toolClass: step.toolClass,
      risk: step.risk,
      batchExpected: step.batchExpected,
    })),
  };
}
