import type { PlanRecord, PlanningStageKind } from "./planMode";
import { redactCredentialString } from "./credentialRedaction";

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
  const rawError = failedRound?.error ?? failedStage?.error;
  const error = rawError ? redactCredentialString(rawError) : "";
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

  if (failedStage?.kind === "investigation") {
    const technicalDetail = [
      error,
      failedStage.revisionAttempted ? "系统已尝试一次 PlanningBrief 合同修复。" : "",
      failedStage.failureExcerpt
        ? `失败响应摘录：\n${redactCredentialString(failedStage.failureExcerpt)}`
        : "",
    ].filter(Boolean).join("\n\n");
    return {
      title: "规划调查未完成",
      detail: "规划调查未完成，但已完成的调查层级和收集到的证据都已保留。",
      nextAction: "点击继续后，系统只从失败的调查深度恢复，不会重新运行已经完成的调查层级。",
      actionLabel: "从失败调查阶段继续",
      technicalDetail,
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
    const runtimeReplan = plan.purpose === "runtime_replan";
    return {
      kind: "success",
      title: runtimeReplan
        ? `Direct Plan v${plan.goalPlanVersion ?? 1} 已就绪`
        : plan.mode === "debate"
          ? "Debate 规划成功"
          : "规划成功",
      detail: runtimeReplan
        ? "新的执行路径已经准备好，当前 Goal 尚未切换 Plan。"
        : "终版计划已经准备好，目前还没有执行任何操作。",
      nextAction:
        runtimeReplan
          ? "检查后点击“采用 Plan 并恢复 Goal”；如需调整，直接输入修改意见。"
          : "检查计划后点击“确认计划并开始执行”；如需调整，直接输入修改意见。",
    };
  }

  if (plan.status === "steps_completed") {
    return {
      kind: "pending",
      title: "当前路径已执行，目标尚未通过验收",
      detail: "活动 Plan 的里程碑已完成，Goal 正在等待或恢复最终验收。",
      nextAction: "继续 Goal 验收；只有有效验收证书才能将 Goal 标记为达成。",
    };
  }

  if (plan.status === "confirmed_pending_execution") {
    return {
      kind: "pending",
      title: "Plan 已确认，等待 Goal 启动",
      detail: "Plan 已通过确认与质量门禁，执行关联正在建立。",
      nextAction: "等待 Goal 进入执行；如长时间无进展，请查看 Goal 详情。",
    };
  }

  if (plan.status === "executing") {
    return {
      kind: "pending",
      title: "Plan 正在执行",
      detail: "当前活动路径正在由 Goal Controller 推进。",
      nextAction: "查看 Goal 进度、里程碑与执行证据。",
    };
  }

  if (plan.status === "paused" && plan.executionGoalId) {
    return {
      kind: "pending",
      title: "Plan 执行已暂停",
      detail: "该 Plan 仍是 Goal 的活动路径，但当前正在等待用户、模型或审核门。",
      nextAction: "根据 Goal 详情中的阻塞原因继续、重试或调整。",
    };
  }

  if (plan.status === "completed") {
    return {
      kind: "success",
      title: "Plan 已完成且 Goal 已达成",
      detail: "活动路径已执行，并已由 Goal 验收证书确认。",
      nextAction: "查看验收证书或 Plan 历史。",
    };
  }

  if (plan.status === "superseded") {
    return {
      kind: "pending",
      title: "Plan 已被新路径替代",
      detail: `该 Plan 的历史记录已保留${plan.supersededByPlanId ? `，当前由 ${plan.supersededByPlanId} 接续` : ""}。`,
      nextAction: "查看 Goal 的当前活动 Plan。",
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

  if (plan.status === "canceled" || plan.status === "discarded") {
    return {
      kind: "canceled",
      title: plan.status === "discarded" ? "Plan 未采用" : "规划已停止",
      detail:
        plan.status === "discarded"
          ? "该候选 Plan 已被丢弃，Goal 的活动路径未被它覆盖。"
          : "本次规划已经中断，目前还没有执行任何操作。",
      nextAction:
        plan.status === "discarded"
          ? "查看当前活动 Plan，或提出新的结构性调整。"
          : "重新尝试，或丢弃当前计划后重新选择规划方式。",
    };
  }

  if (plan.status === "failed") {
    return {
      kind: "failure",
      title: "Plan 执行未完成",
      detail: "当前活动路径没有完成 Goal 所需的执行或验收。",
      nextAction: "查看 Goal 的失败原因，再选择重试、修复或结构性重规划。",
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
