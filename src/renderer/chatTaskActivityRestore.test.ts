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

  it("restores the latest pending guided skill input after reload", () => {
    const snapshot: ChatSessionActivitySnapshot = {
      updatedAt: "2026-06-23T08:00:05.000Z",
      statusEvents: [
        {
          sessionId: "session_1",
          state: "streaming",
          message: "正在输出回复",
          createdAt: "2026-06-23T08:00:04.000Z",
          elapsedMs: 1000,
        },
        {
          sessionId: "session_1",
          state: "waiting_for_input",
          message: "Skill input required.",
          createdAt: "2026-06-23T08:00:05.000Z",
          elapsedMs: 2000,
          inputRequest: {
            id: "input_1",
            executionId: "execution_1",
            sessionId: "session_1",
            requestId: "request_1",
            skillName: "research",
            reason: "Missing topic.",
            fields: [
              {
                name: "topic",
                label: "Topic",
                type: "string",
                required: true,
              },
            ],
            createdAt: "2026-06-23T08:00:05.000Z",
          },
        },
      ],
    };

    const restored = restoreChatTaskActivity(snapshot);

    expect(restored).toMatchObject({
      status: { kind: "paused", message: "Skill input required." },
      workPhase: "paused",
      taskActivity: {
        kind: "paused",
        title: "等待技能输入",
      },
      pendingInputRequest: {
        id: "input_1",
        requestId: "request_1",
        skillName: "research",
      },
    });
  });
});
