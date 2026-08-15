import type { AgentRunEvent } from "../shared/agentRuns";
import type { GoalProgressEvent } from "../shared/chat";

export type ActiveGoalEventContext = {
  activeGoalId: string | null;
  activeSessionId: string | null;
};

export function goalProgressEventMatchesActiveContext(
  event: GoalProgressEvent,
  context: ActiveGoalEventContext,
): boolean {
  if (context.activeGoalId) {
    return event.goalId === context.activeGoalId;
  }
  return Boolean(
    context.activeSessionId &&
      event.sessionId === context.activeSessionId,
  );
}

export function goalRunEventMatchesActiveContext(
  event: AgentRunEvent,
  context: ActiveGoalEventContext,
): boolean {
  const eventGoalId = readEventIdentity(event, "goalId");
  if (context.activeGoalId) {
    return eventGoalId === context.activeGoalId;
  }

  const eventSessionId = readEventIdentity(event, "chatSessionId");
  return Boolean(
    context.activeSessionId &&
      eventSessionId === context.activeSessionId,
  );
}

function readEventIdentity(
  event: AgentRunEvent,
  key: "goalId" | "chatSessionId",
): string | null {
  const value = event.data?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}
