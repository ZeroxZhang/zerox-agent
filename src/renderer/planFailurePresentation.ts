import type { PlanRecord } from "../shared/planMode";

export type PlanFailurePresentation = {
  title: string;
  detail: string;
  actionLabel: string;
};

export type ActivePlanPresentation = {
  statusMessage: string;
  taskTitle: string;
  taskDetail: string;
};

type PlanningStageKind = NonNullable<
  PlanRecord["planningStages"]
>[number]["kind"];

const planningStagePresentation: Record<
  PlanningStageKind,
  Pick<PlanFailurePresentation, "title" | "actionLabel">
> = {
  triage: {
    title: "任务分析阶段未完成",
    actionLabel: "重新运行任务分析",
  },
  investigation: {
    title: "规划调查未完成",
    actionLabel: "重新运行调查",
  },
  skill_route: {
    title: "Skill 路由未完成",
    actionLabel: "重新运行 Skill 路由",
  },
  contract: {
    title: "任务合同未完成",
    actionLabel: "重新运行任务合同",
  },
  generation: {
    title: "计划生成未完成",
    actionLabel: "重新运行计划生成",
  },
  review: {
    title: "计划审查未完成",
    actionLabel: "重新运行计划审查",
  },
  quality: {
    title: "质量门禁未通过",
    actionLabel: "重新运行质量门禁",
  },
};

export function getPlanFailurePresentation(
  plan: PlanRecord,
): PlanFailurePresentation | null {
  const failedRound = [...plan.rounds]
    .reverse()
    .find((round) => round.status === "failed");
  const failedStage = [...(plan.planningStages ?? [])]
    .reverse()
    .find((stage) => stage.status === "failed");
  const error = failedRound?.error ?? failedStage?.error;
  if (!error) return null;

  if (/\bturn_limit\b/i.test(error)) {
    return {
      title: "调查被旧版内部限制错误中断",
      detail: `模型服务商没有报告失败。旧版本在已收集 ${plan.evidence.length} 条证据后触发了内部轮次限制；当前版本已移除此限制，请重新运行调查。`,
      actionLabel: "重新运行调查",
    };
  }

  if (failedRound) {
    return {
      title: "规划模型未完成本轮",
      detail: error,
      actionLabel: "重新运行失败轮次",
    };
  }

  const stagePresentation = failedStage
    ? planningStagePresentation[failedStage.kind]
    : undefined;
  return {
    title: stagePresentation?.title ?? "规划阶段未完成",
    detail: error,
    actionLabel: stagePresentation?.actionLabel ?? "重新运行失败阶段",
  };
}

export function getActivePlanPresentation(
  plan: PlanRecord,
): ActivePlanPresentation {
  if (plan.status === "awaiting_confirmation") {
    return {
      statusMessage: "计划已生成，确认前不会执行",
      taskTitle: "等待确认终版计划",
      taskDetail:
        plan.finalArtifact?.title ??
        plan.taskContract.objective,
    };
  }
  if (plan.status === "awaiting_input") {
    return {
      statusMessage: "计划等待补充信息，尚未开始执行",
      taskTitle: "等待补充规划信息",
      taskDetail:
        plan.finalArtifact?.gateReason ??
        plan.taskContract.objective,
    };
  }

  const failure = getPlanFailurePresentation(plan);
  return {
    statusMessage: failure
      ? `${failure.title}：${failure.detail}`
      : "规划尚未完成，请查看计划卡片",
    taskTitle: failure?.title ?? "规划尚未完成",
    taskDetail:
      failure?.detail ??
      plan.finalArtifact?.title ??
      plan.taskContract.objective,
  };
}
