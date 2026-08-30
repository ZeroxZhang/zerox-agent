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
      status: {
        kind: "ready",
        message: "本轮已完成。你可以查看结果，或继续提出下一步。",
      },
      workPhase: "done",
      taskActivity: {
        kind: "done",
        title: "本轮已完成",
        detail: "本轮已完成。你可以查看结果，或继续提出下一步。",
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

  it("restores a failed terminal event as incomplete with usage counters", () => {
    const snapshot: ChatSessionActivitySnapshot = {
      updatedAt: "2026-07-30T10:00:03.000Z",
      statusEvents: [
        {
          sessionId: "session_failed",
          state: "reasoning",
          message: "正在执行目标",
          createdAt: "2026-07-30T10:00:01.000Z",
          elapsedMs: 1_000,
        },
        {
          sessionId: "session_failed",
          state: "failed",
          message: "Token 预算已用尽，任务未完成",
          toolCallsExecuted: 21,
          createdAt: "2026-07-30T10:00:03.000Z",
          elapsedMs: 3_000,
        },
      ],
    };

    const restored = restoreChatTaskActivity(snapshot);

    expect(restored).toMatchObject({
      status: {
        kind: "error",
        message: "本轮未完成。请根据对话中的恢复建议处理后重试。",
      },
      workPhase: "error",
      taskActivity: {
        kind: "error",
        title: "执行遇到问题",
        detail: "本轮未完成。请根据对话中的恢复建议处理后重试。",
        toolCallsExecuted: 21,
      },
    });
  });

  it("does not present an interrupted processing claim as resumable input", () => {
    const inputRequest = {
      id: "input_processing",
      executionId: "execution_processing",
      sessionId: "session_processing",
      requestId: "request_processing",
      skillName: "research",
      reason: "Confirm the source path.",
      fields: [
        {
          name: "source",
          label: "Source",
          type: "path" as const,
          required: true,
        },
      ],
      createdAt: "2026-08-15T00:00:00.000Z",
    };
    const pendingSkillInput = {
      inputRequestId: inputRequest.id,
      status: "processing" as const,
      inputRequest,
      sessionId: inputRequest.sessionId,
      requestId: inputRequest.requestId,
      userMessage: "research this",
      selectedSkillName: "research",
      partialValues: { source: "/workspace/docs" },
    };
    const snapshot: ChatSessionActivitySnapshot = {
      updatedAt: "2026-08-15T00:00:02.000Z",
      statusEvents: [
        {
          sessionId: inputRequest.sessionId,
          requestId: inputRequest.requestId,
          state: "checkpoint_boundary",
          message: "Skill input execution claimed.",
          inputRequest,
          pendingSkillInput,
          createdAt: "2026-08-15T00:00:01.000Z",
          elapsedMs: 1_000,
        },
        {
          sessionId: inputRequest.sessionId,
          requestId: inputRequest.requestId,
          state: "started",
          message: "Runtime context snapshot recorded.",
          createdAt: "2026-08-15T00:00:02.000Z",
          elapsedMs: 2_000,
        },
      ],
    };

    const restored = restoreChatTaskActivity(snapshot);

    expect(restored).toMatchObject({
      status: {
        kind: "error",
        message: "上次运行已中断，可以重新发送或恢复任务。",
      },
      workPhase: "error",
      taskActivity: {
        kind: "error",
        title: "上次运行已中断",
      },
    });
    expect(restored?.pendingInputRequest).toBeUndefined();
  });
});
