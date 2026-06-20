import { describe, expect, it } from "vitest";
import {
  restoreChatTaskActivity,
} from "./chatTaskActivity";
import type { ChatSessionActivitySnapshot } from "../shared/chat";

describe("chat task activity restore", () => {
  it("rebuilds the right-side activity state from persisted session events", () => {
    const snapshot: ChatSessionActivitySnapshot = {
      updatedAt: "2026-06-20T10:00:03.000Z",
      statusEvents: [
        {
          sessionId: "session_1",
          state: "skill",
          message: "正在调用技能：onepager",
          selectedSkillName: "onepager",
          createdAt: "2026-06-20T10:00:01.000Z",
          elapsedMs: 1000,
        },
        {
          sessionId: "session_1",
          state: "completed",
          message: "任务已完成",
          toolCallsExecuted: 3,
          createdAt: "2026-06-20T10:00:03.000Z",
          elapsedMs: 3000,
        },
      ],
    };

    const restored = restoreChatTaskActivity(snapshot);

    expect(restored).toMatchObject({
      status: { kind: "ready", message: "任务已完成" },
      workPhase: "done",
      taskActivity: {
        kind: "done",
        title: "本轮已完成",
        detail: "任务已完成",
        toolCallsExecuted: 3,
      },
    });
    expect(restored?.taskProcessEvents).toHaveLength(2);
  });
});
