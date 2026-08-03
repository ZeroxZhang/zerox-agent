import type { Goal } from "../shared/agentGoal";

export type GoalTerminalTruthNotice = {
  title: string;
  detail: string;
};

/**
 * Persisted assistant text is audit history and is never rewritten. When an
 * older terminal message contains a model self-assessment that conflicts with
 * the canonical Goal, render this current deterministic verdict alongside it.
 */
export function getGoalTerminalTruthNotice(
  goal: Goal | null,
): GoalTerminalTruthNotice | null {
  if (
    !goal ||
    !["stopped_stalled", "stopped_blocked", "failed"].includes(goal.status)
  ) {
    return null;
  }
  const rejected = goal.milestones.filter(
    (milestone) => milestone.state === "rejected" || milestone.state === "failed",
  );
  if (rejected.length === 0) return null;

  const failedCheckIds = goal.acceptanceState?.lastDecision?.failedCheckIds ?? [];
  const milestoneSummary = rejected
    .slice(0, 3)
    .map((milestone) => milestone.description)
    .join("、");
  const omitted = Math.max(0, rejected.length - 3);
  return {
    title: "当前确定性结论：目标未通过验收",
    detail: [
      `未通过里程碑：${milestoneSummary}${omitted ? ` 等 ${rejected.length} 项` : ""}。`,
      failedCheckIds.length
        ? `失败检查：${failedCheckIds.join("、")}。`
        : "",
      "下方原消息中的模型执行摘要属于历史自评，不能覆盖验收器结果。",
    ]
      .filter(Boolean)
      .join(" "),
  };
}
