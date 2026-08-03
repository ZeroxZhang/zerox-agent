import type { PlanRecord, PlanningStageKind } from "./planMode";

export type PlanOutcomeKind =
  | "success"
  | "needs_input"
  | "failure"
  | "canceled"
  | "pending";

export type PlanFailurePresentation = {
  title: string;
  detail: string;
  nextAction: string;
  actionLabel: string;
  technicalDetail: string;
};

export type PlanOutcomePresentation = {
  kind: PlanOutcomeKind;
  title: string;
  detail: string;
  nextAction: string;
};

export type ActivePlanPresentation = {
  statusMessage: string;
  taskTitle: string;
  taskDetail: string;
};

const planningStageGuidance: Record<PlanningStageKind, string> = {
  triage: "请重新尝试；如果仍然失败，可简化目标描述后再规划。",
  investigation: "请检查模型与网络连接后重新尝试，已收集的资料会保留。",
  skill_route: "请重新尝试；如果仍然失败，可明确指定要使用的 Skill。",
  contract: "请重新尝试；如果仍然失败，可补充交付物和验收要求。",
  generation: "请选择一个可用模型后重新尝试，已完成的准备工作会保留。",
  review: "请重新尝试，系统会保留已生成的计划并再次检查。",
  quality: "请重新检查计划；如果仍然失败，可补充验收要求后再规划。",
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

  const title = plan.mode === "debate" ? "Debate 规划失败" : "规划失败";
  if (/\bturn_limit\b/i.test(error)) {
    return {
      title,
      detail: "旧版本在规划过程中提前停止，当前版本已经修复这个问题。",
      nextAction: "点击“重新尝试”继续，已收集的资料不会丢失。",
      actionLabel: "重新尝试",
      technicalDetail: `旧版内部轮次限制在收集 ${plan.evidence.length} 条证据后中断了规划。原始错误：${error}`,
    };
  }

  if (failedRound) {
    return {
      title,
      detail: "模型没有完成这次规划，但已完成的内容已经保留。",
      nextAction: "选择一个可用模型，然后点击“更换模型并重试”。",
      actionLabel: "更换模型并重试",
      technicalDetail: error,
    };
  }

  return {
    title,
    detail: "系统没有完成这次规划，但已完成的内容已经保留。",
    nextAction:
      planningStageGuidance[failedStage?.kind ?? "generation"],
    actionLabel: "重新尝试",
    technicalDetail: error,
  };
}

export function getPlanOutcomePresentation(
  plan: PlanRecord,
): PlanOutcomePresentation {
  const failure = getPlanFailurePresentation(plan);
  if (failure) {
    return {
      kind: "failure",
      title: failure.title,
      detail: failure.detail,
      nextAction: failure.nextAction,
    };
  }

  if (plan.status === "awaiting_confirmation") {
    return {
      kind: "success",
      title: plan.mode === "debate" ? "Debate 规划成功" : "规划成功",
      detail: "终版计划已经准备好，目前还没有执行任何操作。",
      nextAction:
        "检查计划后点击“确认计划并开始执行”；如需调整，直接输入修改意见。",
    };
  }

  if (plan.status === "awaiting_input") {
    return {
      kind: "needs_input",
      title: "还需要你的信息",
      detail: "系统需要补充信息才能完成规划，目前还没有执行任何操作。",
      nextAction: "回答下方问题并提交，系统会继续规划。",
    };
  }

  if (plan.status === "canceled") {
    return {
      kind: "canceled",
      title: "规划已停止",
      detail: "本次规划已经中断，目前还没有执行任何操作。",
      nextAction: "重新尝试，或丢弃当前计划后重新选择规划方式。",
    };
  }

  return {
    kind: "pending",
    title: "规划尚未完成",
    detail: "系统正在等待恢复或下一步操作，目前还没有执行任何操作。",
    nextAction: "请使用计划卡片中的操作继续。",
  };
}

export function getActivePlanPresentation(
  plan: PlanRecord,
): ActivePlanPresentation {
  const outcome = getPlanOutcomePresentation(plan);
  return {
    statusMessage: `${outcome.title} · ${outcome.nextAction}`,
    taskTitle: outcome.title,
    taskDetail: outcome.nextAction,
  };
}
