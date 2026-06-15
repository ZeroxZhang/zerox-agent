import type {
  Goal,
  GoalStatus,
  Milestone,
  MilestoneState,
} from "../shared/agentGoal";
import type { ChatSessionGoalSummary } from "../shared/chat";

export type GoalProgressMetricCard = {
  label: string;
  value: string;
};

export type GoalProgressMilestoneRow = {
  id: string;
  description: string;
  state: MilestoneState;
  stateLabel: string;
  attempts: number;
  runCount: number;
  lastAcceptanceSummary?: string;
};

export type GoalProgressViewModel = {
  status: GoalStatus;
  statusLabel: string;
  statusDetail: string;
  nextActionLabel: string;
  nextActionDetail: string;
  progressText: string;
  metricCards: GoalProgressMetricCard[];
  milestoneRows: GoalProgressMilestoneRow[];
};

export function buildGoalProgressViewModel(
  summary: ChatSessionGoalSummary,
  goal: Goal | null,
): GoalProgressViewModel {
  const status = goal?.status ?? summary.status;
  const milestones = goal?.milestones ?? [];
  const acceptedCount = milestones.filter((milestone) =>
    milestone.state === "accepted" || milestone.state === "skipped"
  ).length;
  const totalCount = milestones.length;
  const nextMilestone = findCurrentMilestone(milestones);

  return {
    status,
    ...describeGoalStatus(status, nextMilestone),
    progressText: totalCount > 0
      ? `${acceptedCount}/${totalCount} 已完成`
      : "尚未生成里程碑",
    metricCards: buildMetricCards(goal),
    milestoneRows: milestones.map(toMilestoneRow),
  };
}

function describeGoalStatus(
  status: GoalStatus,
  milestone: Milestone | null,
): Pick<
  GoalProgressViewModel,
  "statusLabel" | "statusDetail" | "nextActionLabel" | "nextActionDetail"
> {
  const milestoneDetail = milestone
    ? `Milestone ${milestone.id}：${milestone.description}`
    : "还没有可执行的里程碑。";

  switch (status) {
    case "planning":
      return {
        statusLabel: "已规划，待启动",
        statusDetail:
          "目标已经记录，还没有开始执行。点击“开始执行”后，智能体会按里程碑推进。",
        nextActionLabel: "开始执行",
        nextActionDetail: milestoneDetail,
      };
    case "executing":
      return {
        statusLabel: "执行中",
        statusDetail: "智能体正在按里程碑推进目标，进度会随运行和验收更新。",
        nextActionLabel: "当前阶段",
        nextActionDetail: milestoneDetail,
      };
    case "waiting_for_review":
      return {
        statusLabel: "等待审核",
        statusDetail: "目标已暂停在审核门，需要你决定继续、修改计划或终止。",
        nextActionLabel: "需要你处理",
        nextActionDetail: milestoneDetail,
      };
    case "achieved":
      return {
        statusLabel: "已达成",
        statusDetail: "目标验收已通过，当前目标已经结束。",
        nextActionLabel: "完成状态",
        nextActionDetail: "无需继续执行。",
      };
    case "stopped_budget":
      return {
        statusLabel: "可继续",
        statusDetail:
          "这是旧版本预算停止状态；当前版本不会再用系统预算拦截目标推进，可以直接继续执行。",
        nextActionLabel: "继续执行",
        nextActionDetail: milestoneDetail,
      };
    case "stopped_stalled":
      return {
        statusLabel: "停滞停止",
        statusDetail: "目标因为没有可推进的里程碑停止，需要重新规划。",
        nextActionLabel: "停止原因",
        nextActionDetail: "没有 ready 里程碑可执行。",
      };
    case "failed":
      return {
        statusLabel: "失败",
        statusDetail: "目标执行遇到不可恢复的问题，需要查看运行证据后处理。",
        nextActionLabel: "恢复路径",
        nextActionDetail:
          "使用下方“重试目标”或“结束目标”处理，失败记录会保留用于排查。",
      };
    case "canceled":
      return {
        statusLabel: "已取消",
        statusDetail: "目标已经由用户取消，不会继续执行。",
        nextActionLabel: "结束状态",
        nextActionDetail: "无需继续执行。",
      };
  }
}

function buildMetricCards(goal: Goal | null): GoalProgressMetricCard[] {
  if (!goal) {
    return [
      { label: "状态", value: "加载中" },
      { label: "运行", value: "待加载" },
    ];
  }

  return [
    {
      label: "迭代",
      value: String(goal.budgetUsage.iterations),
    },
    {
      label: "工具调用",
      value: String(goal.budgetUsage.toolCalls),
    },
    {
      label: "运行时间",
      value: `${formatMinutes(goal.budgetUsage.wallClockMs)} 分钟`,
    },
    {
      label: "重规划",
      value: String(goal.budgetUsage.replans),
    },
  ];
}

function findCurrentMilestone(milestones: Milestone[]): Milestone | null {
  return (
    milestones.find((milestone) => milestone.state === "running") ??
    milestones.find((milestone) => milestone.state === "ready") ??
    milestones.find((milestone) => milestone.state === "pending") ??
    milestones[0] ??
    null
  );
}

function toMilestoneRow(milestone: Milestone): GoalProgressMilestoneRow {
  return {
    id: milestone.id,
    description: milestone.description,
    state: milestone.state,
    stateLabel: translateMilestoneState(milestone.state),
    attempts: milestone.attempts,
    runCount: milestone.runIds.length,
    ...(milestone.lastAcceptanceSummary
      ? { lastAcceptanceSummary: milestone.lastAcceptanceSummary }
      : {}),
  };
}

function translateMilestoneState(state: MilestoneState): string {
  const labels: Record<MilestoneState, string> = {
    pending: "等待前置",
    ready: "待执行",
    running: "执行中",
    accepted: "已完成",
    rejected: "验收未通过",
    skipped: "已跳过",
    failed: "失败",
  };
  return labels[state];
}

function formatMinutes(milliseconds: number): string {
  const minutes = milliseconds / 60_000;
  if (Number.isInteger(minutes)) {
    return String(minutes);
  }
  return minutes.toFixed(1);
}
