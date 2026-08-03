import { describe, expect, it } from "vitest";
import type { ChatSessionRecord } from "./chat";
import {
  deriveChatSessionWork,
  getActionableGoalSummary,
  getRecoveryGoalSummary,
} from "./chatSessionWork";

describe("chat session work projection", () => {
  it("keeps a live goal authoritative even when chat activity is newer", () => {
    const session = createSession({
      activeGoalId: "goal_live",
      goalSummaries: [
        {
          id: "goal_live",
          description: "发布版本",
          status: "executing",
          updatedAt: "2026-08-02T08:00:00.000Z",
        },
      ],
      activity: {
        updatedAt: "2026-08-02T08:05:00.000Z",
        statusEvents: [
          createStatusEvent("completed", "2026-08-02T08:05:00.000Z"),
        ],
      },
    });

    expect(deriveChatSessionWork(session)).toEqual({
      source: "goal",
      relationship: "active",
      goalId: "goal_live",
      status: "executing",
      updatedAt: "2026-08-02T08:00:00.000Z",
    });
  });

  it("shows a later independent Chat completion while retaining the stalled Goal as recovery context", () => {
    const session = createSession({
      goalSummaries: [
        {
          id: "goal_stalled",
          description: "构建 Skill 包",
          status: "stopped_stalled",
          updatedAt: "2026-08-02T07:50:00.000Z",
        },
      ],
      activity: {
        updatedAt: "2026-08-02T07:53:00.000Z",
        statusEvents: [
          createStatusEvent("completed", "2026-08-02T07:53:00.000Z"),
        ],
      },
    });

    expect(deriveChatSessionWork(session)).toEqual({
      source: "chat",
      status: "completed",
      updatedAt: "2026-08-02T07:53:00.000Z",
    });
    expect(getRecoveryGoalSummary(session)?.id).toBe("goal_stalled");
    expect(getActionableGoalSummary(session)?.id).toBe("goal_stalled");
  });

  it("projects a newer failed Goal as recovery when no later Chat run exists", () => {
    const session = createSession({
      goalSummaries: [
        {
          id: "goal_failed",
          description: "构建 Skill 包",
          status: "failed",
          updatedAt: "2026-08-02T08:10:00.000Z",
        },
      ],
      activity: {
        updatedAt: "2026-08-02T08:05:00.000Z",
        statusEvents: [
          createStatusEvent("completed", "2026-08-02T08:05:00.000Z"),
        ],
      },
    });

    expect(deriveChatSessionWork(session)).toMatchObject({
      source: "goal",
      relationship: "recovery",
      goalId: "goal_failed",
      status: "failed",
    });
  });
});

function createSession(
  partial: Partial<ChatSessionRecord>,
): ChatSessionRecord {
  return {
    id: "session_1",
    title: "测试会话",
    summary: "测试",
    messages: [],
    createdAt: "2026-08-02T07:00:00.000Z",
    updatedAt: "2026-08-02T08:10:00.000Z",
    ...partial,
  };
}

function createStatusEvent(
  state: "completed" | "failed",
  createdAt: string,
) {
  return {
    sessionId: "session_1",
    requestId: "request_1",
    sequence: 1,
    turnId: "turn_1",
    state,
    message: state === "completed" ? "任务完成" : "任务失败",
    createdAt,
    elapsedMs: 1,
  } as const;
}
