import type { AgentRunEvent, AgentRunRecord } from "./agentRuns";

export type RunTimelineKind =
  | "error"
  | "memory"
  | "model"
  | "permission"
  | "system"
  | "tool";

export type RunTimelineItem = {
  id: string;
  kind: RunTimelineKind;
  level: AgentRunEvent["level"];
  title: string;
  detail: string | null;
  createdAt: string;
  data: Record<string, unknown> | null;
};

export type RunGuidance = {
  tone: "error" | "success" | "warn";
  title: string;
  action: string;
};

export type RunEventKindSummary = {
  model: number;
  permission: number;
  tool: number;
  memory: number;
  error: number;
};

export function buildRunTimeline(run: AgentRunRecord): RunTimelineItem[] {
  return run.events.map((event, index) => ({
    id: `${run.id}:${index}`,
    kind: classifyRunEvent(event),
    level: event.level,
    title: translateRunEventMessage(event.message),
    detail: getEventDetail(event),
    createdAt: event.createdAt,
    data: event.data ?? null,
  }));
}

export function summarizeRunEventKinds(
  run: AgentRunRecord,
): RunEventKindSummary {
  return buildRunTimeline(run).reduce<RunEventKindSummary>(
    (summary, item) => {
      if (item.kind === "model") {
        summary.model += 1;
      }
      if (item.kind === "permission") {
        summary.permission += 1;
      }
      if (item.kind === "tool") {
        summary.tool += 1;
      }
      if (item.kind === "memory") {
        summary.memory += 1;
      }
      if (item.kind === "error") {
        summary.error += 1;
      }

      return summary;
    },
    { model: 0, permission: 0, tool: 0, memory: 0, error: 0 },
  );
}

export function getRunGuidance(run: AgentRunRecord): RunGuidance {
  if (run.status === "succeeded") {
    return {
      tone: "success",
      title: "运行已完成",
      action: "再次调度前，检查时间线、输出摘要和记忆写入。",
    };
  }

  if (run.status === "canceled") {
    return {
      tone: "warn",
      title: "运行已停止",
      action: "这是一次主动停止。调整任务输入、权限或模型设置后，可以重新运行。",
    };
  }

  const summary = run.summary.toLowerCase();

  if (summary.includes("model profile is incomplete") || summary.includes("模型配置不完整")) {
    return {
      tone: "error",
      title: "模型配置不完整",
      action: "打开“设置”，保存 base URL、对话模型和 API Key。",
    };
  }

  if (summary.includes("tool call denied") || summary.includes("工具调用被拒绝")) {
    return {
      tone: "error",
      title: "工具权限被拒绝",
      action: "打开任务权限或“工具”审计日志，允许确切的目录、域名或命令模板。",
    };
  }

  if (summary.includes("valid json") || summary.includes("response type")) {
    return {
      tone: "warn",
      title: "模型响应格式问题",
      action: "降低 temperature，使用偏编程/工具调用的模型，或用更严格的技能提示词重试。",
    };
  }

  return {
    tone: "error",
    title: "运行失败",
    action: "打开时间线，检查第一个错误事件，修复原因后重试。",
  };
}

export function classifyRunEvent(event: AgentRunEvent): RunTimelineKind {
  const message = event.message.toLowerCase();

  if (event.level === "error" || message.includes("denied") || message.includes("被拒绝")) {
    return "error";
  }

  if (message.includes("model response") || message.includes("模型响应")) {
    return "model";
  }

  if (message.includes("authorized") || message.includes("已授权")) {
    return "permission";
  }

  if (message.includes("tool call") || message.includes("工具调用")) {
    return "tool";
  }

  if (message.includes("memory") || message.includes("记忆")) {
    return "memory";
  }

  return "system";
}

function getEventDetail(event: AgentRunEvent): string | null {
  const toolName = event.data?.toolName;
  if (typeof toolName === "string") {
    return toolName;
  }

  const memoryKind = event.data?.memoryKind;
  if (typeof memoryKind === "string") {
    return memoryKind;
  }

  const turn = event.data?.turn;
  if (typeof turn === "number") {
    return `turn ${turn + 1}`;
  }

  return null;
}

function translateRunEventMessage(message: string): string {
  const normalized = message.trim().toLowerCase();

  if (normalized === "agent run started.") {
    return "智能体运行开始";
  }

  if (normalized === "model response received.") {
    return "收到模型响应";
  }

  if (normalized === "tool call authorized.") {
    return "工具调用已授权";
  }

  if (normalized === "tool call executed.") {
    return "工具调用已执行";
  }

  if (normalized === "episodic memory written.") {
    return "已写入情景记忆";
  }

  if (normalized === "agent run finished.") {
    return "智能体运行结束";
  }

  if (normalized.startsWith("tool call denied")) {
    return message.replace("Tool call denied", "工具调用被拒绝");
  }

  return message;
}
