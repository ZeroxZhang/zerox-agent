import type { AgentTrajectoryEvent } from "./agentTrajectory";

export type AgentTrajectoryInsight = {
  eventId: string;
  tone: "info" | "warn" | "error" | "success";
  title: string;
  detail: string;
};

export function summarizeTrajectoryInsights(
  events: AgentTrajectoryEvent[],
): AgentTrajectoryInsight[] {
  return events
    .map(summarizeTrajectoryEvent)
    .filter((insight): insight is AgentTrajectoryInsight => Boolean(insight));
}

export function summarizeTrajectoryEvent(
  event: AgentTrajectoryEvent,
): AgentTrajectoryInsight | null {
  if (event.type === "reflection_added") {
    const retryAllowed = event.payload.retryAllowed === true;
    return {
      eventId: event.id,
      tone: retryAllowed ? "warn" : "warn",
      title: retryAllowed ? "恢复建议" : "恢复停止",
      detail: `${readString(event.payload.toolName, "tool")}: ${readString(
        event.payload.failureClass,
        "tool_failed",
      )} -> ${readString(event.payload.suggestion, "retry")}`,
    };
  }

  if (event.type === "model_retry") {
    return {
      eventId: event.id,
      tone: "info",
      title: "模型重试",
      detail: `第 ${readNumber(event.payload.attempt)}/${readNumber(
        event.payload.maxRetries,
      )} 次重试，等待 ${readNumber(event.payload.delayMs)}ms`,
    };
  }

  if (event.type === "context_compacted") {
    return {
      eventId: event.id,
      tone: "info",
      title: "上下文压缩",
      detail: `${readNumber(event.payload.originalMessageCount)} -> ${readNumber(
        event.payload.compactedMessageCount,
      )} 条消息，${readNumber(event.payload.estimatedTokens)}/${readNumber(
        event.payload.tokenBudget,
      )} tokens`,
    };
  }

  return null;
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
