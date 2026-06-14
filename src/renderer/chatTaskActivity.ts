import type { ChatTaskStatusEvent } from "../shared/chat";
import type { GoalStatus } from "../shared/agentGoal";
import type { AgentWorkPhase } from "./agentWorkStatus";

export type TaskActivityKind = "idle" | "working" | "paused" | "done" | "error";
export type GoalUiStatusKind = "ready" | "working" | "paused" | "error";

export type GoalUiSyncState = {
  statusKind: GoalUiStatusKind;
  workPhase: AgentWorkPhase;
  shouldClearActiveRequest: boolean;
};

export type TaskActivityState = {
  kind: TaskActivityKind;
  title: string;
  detail: string;
  updatedAt: number;
  lastEventAt: number;
  startedAt?: number;
  toolCallsExecuted?: number;
  maxTurns?: number;
};

export type TaskProcessItem = {
  id: string;
  label: string;
  message: string;
  time: string;
  meta?: string;
};

const staleStatusThresholdMs = 90_000;

export const idleTaskActivity: TaskActivityState = {
  kind: "idle",
  title: "当前没有任务运行",
  detail: "待命，等待下一次任务",
  updatedAt: 0,
  lastEventAt: 0,
};

export function createTaskActivity(options: {
  kind: TaskActivityKind;
  title: string;
  detail: string;
  now?: number;
  startedAt?: number;
  lastEventAt?: number;
  toolCallsExecuted?: number;
  maxTurns?: number;
}): TaskActivityState {
  const now = options.now ?? Date.now();

  return {
    kind: options.kind,
    title: options.title,
    detail: options.detail,
    updatedAt: now,
    lastEventAt: options.lastEventAt ?? now,
    ...(options.kind === "working"
      ? { startedAt: options.startedAt ?? now }
      : options.startedAt
        ? { startedAt: options.startedAt }
        : {}),
    ...(typeof options.toolCallsExecuted === "number"
      ? { toolCallsExecuted: options.toolCallsExecuted }
      : {}),
    ...(typeof options.maxTurns === "number" ? { maxTurns: options.maxTurns } : {}),
  };
}

export function buildGoalTaskActivity(options: {
  status: GoalStatus;
  description: string;
  now?: number;
}): TaskActivityState {
  if (options.status === "executing") {
    return createTaskActivity({
      kind: "working",
      title: "目标执行中",
      detail: options.description,
      now: options.now,
    });
  }

  if (options.status === "waiting_for_review") {
    return createTaskActivity({
      kind: "paused",
      title: "目标等待审核",
      detail: options.description,
      now: options.now,
    });
  }

  if (
    options.status === "failed" ||
    options.status === "stopped_budget" ||
    options.status === "stopped_stalled"
  ) {
    return createTaskActivity({
      kind: "error",
      title:
        options.status === "stopped_budget"
          ? "目标预算停止"
          : options.status === "stopped_stalled"
            ? "目标停滞停止"
            : "目标执行失败",
      detail: options.description,
      now: options.now,
    });
  }

  if (options.status === "achieved") {
    return createTaskActivity({
      kind: "done",
      title: "目标已达成",
      detail: options.description,
      now: options.now,
    });
  }

  if (options.status === "canceled") {
    return createTaskActivity({
      kind: "done",
      title: "目标已取消",
      detail: options.description,
      now: options.now,
    });
  }

  return createTaskActivity({
    kind: "done",
    title: "目标已记录",
    detail: options.description,
    now: options.now,
  });
}

export function getGoalUiSyncState(status: GoalStatus): GoalUiSyncState {
  if (status === "executing") {
    return {
      statusKind: "working",
      workPhase: "tool",
      shouldClearActiveRequest: false,
    };
  }

  if (status === "waiting_for_review") {
    return {
      statusKind: "paused",
      workPhase: "paused",
      shouldClearActiveRequest: true,
    };
  }

  if (
    status === "failed" ||
    status === "stopped_budget" ||
    status === "stopped_stalled"
  ) {
    return {
      statusKind: "error",
      workPhase: "error",
      shouldClearActiveRequest: true,
    };
  }

  if (status === "planning") {
    return {
      statusKind: "ready",
      workPhase: "done",
      shouldClearActiveRequest: true,
    };
  }

  return {
    statusKind: "ready",
    workPhase: "done",
    shouldClearActiveRequest: true,
  };
}

export function buildTaskActivityDetail(
  activity: TaskActivityState,
  now: number,
): string {
  if (activity.kind !== "working" || activity.startedAt === undefined) {
    return activity.detail;
  }

  const elapsedSeconds = toWholeSeconds(now - activity.startedAt);
  const staleSeconds = toWholeSeconds(now - activity.lastEventAt);
  const staleCopy =
    now - activity.lastEventAt >= staleStatusThresholdMs
      ? ` · ${staleSeconds} 秒无新状态，可能仍在等待模型或工具返回`
      : "";

  return `${activity.detail} · 已运行 ${elapsedSeconds} 秒${staleCopy}`;
}

function toWholeSeconds(ms: number): number {
  return Math.max(0, Math.floor(ms / 1000));
}

export function buildTaskProcessItems(
  events: ChatTaskStatusEvent[],
): TaskProcessItem[] {
  return [...events].reverse().map((event, index) => ({
    id: `${event.createdAt}-${event.state}-${index}`,
    label: getProcessLabel(event),
    message: event.message,
    time: formatEventTime(event.createdAt),
    ...(getProcessMeta(event) ? { meta: getProcessMeta(event) } : {}),
  }));
}

function getProcessLabel(event: ChatTaskStatusEvent): string {
  if (event.state === "started") return "启动";
  if (event.state === "memory") return "记忆";
  if (event.state === "model") return "模型";
  if (event.state === "reasoning") return "思考";
  if (event.state === "tool_call" || event.state === "tool_result") return "工具";
  if (event.state === "paused") return "暂停";
  if (event.state === "canceled") return "中断";
  if (event.state === "completed") return "完成";
  return "异常";
}

function getProcessMeta(event: ChatTaskStatusEvent): string | undefined {
  if (event.turn) return `第 ${event.turn} 轮`;
  if (event.toolName) return event.toolName;
  if (typeof event.toolCallsExecuted === "number") {
    return `工具 ${event.toolCallsExecuted}`;
  }
  return undefined;
}

function formatEventTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(date);
}
