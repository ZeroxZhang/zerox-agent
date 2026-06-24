import type {
  ChatSessionActivitySnapshot,
  ChatTaskStatusEvent,
  SkillUserInputRequest,
} from "../shared/chat";
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

export type RestoredChatTaskActivity = {
  status: {
    kind: GoalUiStatusKind;
    message: string;
  };
  workPhase: AgentWorkPhase;
  taskActivity: TaskActivityState;
  taskProcessEvents: ChatTaskStatusEvent[];
  pendingInputRequest?: SkillUserInputRequest;
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

  if (options.status === "stopped_budget") {
    return createTaskActivity({
      kind: "paused",
      title: "目标可继续",
      detail: options.description,
      now: options.now,
    });
  }

  if (options.status === "failed" || options.status === "stopped_stalled") {
    return createTaskActivity({
      kind: "error",
      title:
        options.status === "stopped_stalled"
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

  if (status === "stopped_budget") {
    return {
      statusKind: "paused",
      workPhase: "paused",
      shouldClearActiveRequest: true,
    };
  }

  if (status === "failed" || status === "stopped_stalled") {
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

export function restoreChatTaskActivity(
  snapshot: ChatSessionActivitySnapshot | undefined,
): RestoredChatTaskActivity | null {
  if (!snapshot?.statusEvents.length) {
    return null;
  }

  const events = snapshot.statusEvents;
  const latestEvent = events[events.length - 1];
  return {
    status: {
      kind: getChatStatusKindFromStatusEvent(latestEvent),
      message: latestEvent.message,
    },
    workPhase: getWorkPhaseFromChatStatusEvent(latestEvent),
    taskActivity: buildTaskActivityFromStatusEvent(latestEvent),
    taskProcessEvents: events,
    ...(latestEvent.state === "waiting_for_input" && latestEvent.inputRequest
      ? { pendingInputRequest: latestEvent.inputRequest }
      : {}),
  };
}

export function buildTaskActivityFromStatusEvent(
  event: ChatTaskStatusEvent,
): TaskActivityState {
  const eventTime = parseEventTime(event.createdAt);
  const startedAt = eventTime - event.elapsedMs;
  const kind =
    event.state === "paused" || event.state === "waiting_for_input"
      ? "paused"
      : event.state === "completed" || event.state === "canceled"
        ? "done"
        : event.state === "failed"
          ? "error"
          : "working";

  return createTaskActivity({
    kind,
    title: getTaskActivityTitleFromStatusEvent(event),
    detail: event.message,
    now: eventTime,
    startedAt,
    lastEventAt: eventTime,
    toolCallsExecuted: event.toolCallsExecuted,
    maxTurns: event.maxTurns,
  });
}

export function getChatStatusKindFromStatusEvent(
  event: ChatTaskStatusEvent,
): GoalUiStatusKind {
  if (event.state === "paused" || event.state === "waiting_for_input") {
    return "paused";
  }
  if (event.state === "failed") return "error";
  if (event.state === "canceled") return "ready";
  if (event.state === "completed") return "ready";
  return "working";
}

export function getWorkPhaseFromChatStatusEvent(
  event: ChatTaskStatusEvent,
): AgentWorkPhase {
  if (event.state === "started") return "planning";
  if (event.state === "workspace") return "planning";
  if (event.state === "skill") return "planning";
  if (event.state === "memory") return "memory";
  if (
    event.state === "model" ||
    event.state === "reasoning" ||
    event.state === "streaming"
  ) {
    return "model";
  }
  if (event.state === "tool_call" || event.state === "tool_result") return "tool";
  if (event.state === "paused" || event.state === "waiting_for_input") {
    return "paused";
  }
  if (event.state === "failed") return "error";
  return "done";
}

function getProcessLabel(event: ChatTaskStatusEvent): string {
  if (event.state === "started") return "启动";
  if (event.state === "workspace") return "工作区";
  if (event.state === "skill") return "技能";
  if (event.state === "memory") return "记忆";
  if (event.state === "model") return "模型";
  if (event.state === "reasoning") return "思考";
  if (event.state === "streaming") return "输出";
  if (event.state === "tool_call" || event.state === "tool_result") return "工具";
  if (event.state === "waiting_for_input") return "输入";
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

function getTaskActivityTitleFromStatusEvent(event: ChatTaskStatusEvent): string {
  if (event.state === "started") return "正在启动任务";
  if (event.state === "workspace") return "正在确定工作区";
  if (event.state === "skill") return "正在调用技能";
  if (event.state === "memory") return "正在检索记忆";
  if (event.state === "model") return "正在调用模型";
  if (event.state === "reasoning") return "模型思考";
  if (event.state === "streaming") return "正在输出回复";
  if (event.state === "tool_call") return "正在执行工具";
  if (event.state === "tool_result") return "工具结果已返回";
  if (event.state === "waiting_for_input") return "等待技能输入";
  if (event.state === "paused") return "长任务等待确认";
  if (event.state === "canceled") return "任务已中断";
  if (event.state === "completed") return "本轮已完成";
  return "执行遇到问题";
}

function parseEventTime(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}
