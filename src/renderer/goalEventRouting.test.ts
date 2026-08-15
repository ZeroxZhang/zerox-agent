import { describe, expect, it } from "vitest";
import type { AgentRunEvent } from "../shared/agentRuns";
import type { GoalProgressEvent } from "../shared/chat";
import {
  goalProgressEventMatchesActiveContext,
  goalRunEventMatchesActiveContext,
} from "./goalEventRouting";

describe("Goal event routing", () => {
  const context = {
    activeGoalId: "goal_current",
    activeSessionId: "session_shared",
  };

  it("rejects a late progress event from an older Goal in the same session", () => {
    expect(
      goalProgressEventMatchesActiveContext(
        progressEvent({
          goalId: "goal_old",
          sessionId: "session_shared",
        }),
        context,
      ),
    ).toBe(false);
    expect(
      goalProgressEventMatchesActiveContext(
        progressEvent({
          goalId: "goal_current",
          sessionId: "session_shared",
        }),
        context,
      ),
    ).toBe(true);
  });

  it("uses the session only while the active Goal identity is not known", () => {
    expect(
      goalProgressEventMatchesActiveContext(
        progressEvent({
          goalId: "goal_new",
          sessionId: "session_shared",
        }),
        {
          activeGoalId: null,
          activeSessionId: "session_shared",
        },
      ),
    ).toBe(true);
  });

  it("filters globally broadcast milestone events by Goal identity", () => {
    expect(
      goalRunEventMatchesActiveContext(
        runEvent("goal_old", "session_shared"),
        context,
      ),
    ).toBe(false);
    expect(
      goalRunEventMatchesActiveContext(
        runEvent("goal_current", "session_shared"),
        context,
      ),
    ).toBe(true);
  });

  it("rejects legacy milestone events without routing identity", () => {
    expect(
      goalRunEventMatchesActiveContext(
        {
          level: "info",
          message: "legacy",
          createdAt: "2026-08-15T00:00:00.000Z",
        },
        context,
      ),
    ).toBe(false);
  });
});

function progressEvent(
  input: Pick<GoalProgressEvent, "goalId" | "sessionId">,
): GoalProgressEvent {
  return {
    kind: "goal_progress",
    goalId: input.goalId,
    sessionId: input.sessionId,
    status: "executing",
    event: "milestone_started",
    message: "running",
    timestamp: "2026-08-15T00:00:00.000Z",
  };
}

function runEvent(goalId: string, chatSessionId: string): AgentRunEvent {
  return {
    level: "info",
    phase: "executing",
    message: "running",
    data: { goalId, chatSessionId },
    createdAt: "2026-08-15T00:00:00.000Z",
  };
}
