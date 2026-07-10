import { describe, expect, it } from "vitest";
import {
  buildGoalTaskActivity,
  buildRequirementProcessItems,
  buildSubagentProcessItems,
  buildTaskActivityFromStatusEvent,
  buildTaskActivityDetail,
  buildTaskProcessItems,
  createTaskActivity,
  getChatStatusKindFromStatusEvent,
  getGoalUiSyncState,
  getWorkPhaseFromChatStatusEvent,
} from "./chatTaskActivity";
import type { ChatTaskStatusEvent } from "../shared/chat";

describe("chat task activity", () => {
  it("keeps the latest real status message instead of rotating fake copy", () => {
    const activity = createTaskActivity({
      kind: "working",
      title: "正在调用工具",
      detail: "正在调用工具：file_list",
      now: 1_000,
    });

    expect(buildTaskActivityDetail(activity, 15_000)).toBe(
      "正在调用工具：file_list · 已运行 14 秒",
    );
    expect(buildTaskActivityDetail(activity, 31_000)).toBe(
      "正在调用工具：file_list · 已运行 30 秒",
    );
  });

  it("surfaces long periods without new backend status events", () => {
    const activity = createTaskActivity({
      kind: "working",
      title: "正在等待模型返回",
      detail: "正在调用模型（第 2 轮）",
      now: 0,
    });

    expect(buildTaskActivityDetail(activity, 1_000_000)).toBe(
      "正在调用模型（第 2 轮） · 已运行 1000 秒 · 1000 秒无新状态，可能仍在等待模型或工具返回",
    );
  });

  it("formats real backend status events as a latest-first process trail", () => {
    const events: ChatTaskStatusEvent[] = [
      createStatusEvent({
        state: "model",
        message: "正在调用模型（第 1 轮）",
        createdAt: "2026-06-08T14:00:00.000Z",
        elapsedMs: 1000,
        turn: 1,
      }),
      createStatusEvent({
        state: "reasoning",
        message: "我正在比较用户目标与可用工具。",
        createdAt: "2026-06-08T14:00:02.000Z",
        elapsedMs: 3000,
      }),
      createStatusEvent({
        state: "canceled",
        message: "任务已中断",
        createdAt: "2026-06-08T14:00:04.000Z",
        elapsedMs: 5000,
      }),
    ];

    expect(buildTaskProcessItems(events)).toEqual([
      {
        id: "2026-06-08T14:00:04.000Z-canceled-0",
        label: "中断",
        message: "任务已中断",
        time: "22:00:04",
      },
      {
        id: "2026-06-08T14:00:02.000Z-reasoning-1",
        label: "思考",
        message: "我正在比较用户目标与可用工具。",
        time: "22:00:02",
      },
      {
        id: "2026-06-08T14:00:00.000Z-model-2",
        label: "模型",
        message: "正在调用模型（第 1 轮）",
        time: "22:00:00",
        meta: "第 1 轮",
      },
    ]);
  });

  it("keeps the bottom activity in a running state while a goal is executing", () => {
    const activity = buildGoalTaskActivity({
      status: "executing",
      description: "调研 Serenity",
      now: 1_000,
    });

    expect(activity).toMatchObject({
      kind: "working",
      title: "目标执行中",
      detail: "调研 Serenity",
      startedAt: 1_000,
    });
    expect(buildTaskActivityDetail(activity, 16_000)).toBe(
      "调研 Serenity · 已运行 15 秒",
    );
  });

  it("moves completed goals out of the running UI state", () => {
    const activity = buildGoalTaskActivity({
      status: "achieved",
      description: "回复固定验收短句",
      now: 2_000,
    });

    expect(activity).toMatchObject({
      kind: "done",
      title: "目标已达成",
      detail: "回复固定验收短句",
    });
    expect(activity.startedAt).toBeUndefined();
    expect(getGoalUiSyncState("achieved")).toEqual({
      statusKind: "ready",
      workPhase: "done",
      shouldClearActiveRequest: true,
    });
  });

  it("maps budget-stopped goals to an explicit non-running paused state", () => {
    const activity = buildGoalTaskActivity({
      status: "stopped_budget",
      description: "发布 v2.1.1",
      now: 3_000,
    });

    expect(activity).toMatchObject({
      kind: "paused",
      title: "目标预算已用尽",
      detail: "发布 v2.1.1",
    });
    expect(getGoalUiSyncState("stopped_budget")).toEqual({
      statusKind: "paused",
      workPhase: "paused",
      shouldClearActiveRequest: true,
    });
  });

  it("maps blocked goals to an explicit paused state, never completed or ready", () => {
    const activity = buildGoalTaskActivity({
      status: "stopped_blocked",
      description: "等待外部依赖",
      now: 4_000,
    });

    expect(activity).toMatchObject({
      kind: "paused",
      title: "目标受阻",
      detail: "等待外部依赖",
    });
    expect(activity.kind).not.toBe("done");
    expect(getGoalUiSyncState("stopped_blocked")).toEqual({
      statusKind: "paused",
      workPhase: "paused",
      shouldClearActiveRequest: true,
    });
  });

  it("maps guided input waits to paused input state instead of an error fallback", () => {
    const waitingEvent = createStatusEvent({
      state: "waiting_for_input",
      message: "Skill input required.",
      createdAt: "2026-06-23T08:00:05.000Z",
      elapsedMs: 2000,
      inputRequest: {
        id: "input_1",
        executionId: "execution_1",
        sessionId: "session_1",
        requestId: "request_1",
        skillName: "onepager",
        reason: "Pick a source file.",
        fields: [
          {
            name: "source",
            label: "Source",
            type: "path",
            required: true,
          },
        ],
        createdAt: "2026-06-23T08:00:05.000Z",
      },
    });

    expect(getChatStatusKindFromStatusEvent(waitingEvent)).toBe("paused");
    expect(getWorkPhaseFromChatStatusEvent(waitingEvent)).toBe("paused");
    expect(buildTaskActivityFromStatusEvent(waitingEvent)).toMatchObject({
      kind: "paused",
      title: "等待技能输入",
      detail: "Skill input required.",
    });
    expect(buildTaskProcessItems([waitingEvent])[0]?.label).toBe("输入");
  });

  it("maps v2.8 orchestration statuses into readable process labels", () => {
    const events: ChatTaskStatusEvent[] = [
      createStatusEvent({
        state: "skill_load",
        message: "已加载技能：onepager",
        createdAt: "2026-06-25T00:00:00.000Z",
        elapsedMs: 100,
        selectedSkillName: "onepager",
      }),
      createStatusEvent({
        state: "tool_invocation",
        message: "工具等待授权：skill_load",
        createdAt: "2026-06-25T00:00:01.000Z",
        elapsedMs: 200,
        toolName: "skill_load",
        invocationStatus: "waiting_approval",
      }),
      createStatusEvent({
        state: "checkpoint_boundary",
        message: "已重建 checkpoint boundary",
        createdAt: "2026-06-25T00:00:02.000Z",
        elapsedMs: 300,
        checkpointId: "checkpoint_1",
      }),
      createStatusEvent({
        state: "memory_scope",
        message: "已注入 scoped memory",
        createdAt: "2026-06-25T00:00:03.000Z",
        elapsedMs: 400,
        memoryScopes: ["session:session_1"],
      }),
      createStatusEvent({
        state: "history",
        message: "已检索 raw history",
        createdAt: "2026-06-25T00:00:04.000Z",
        elapsedMs: 500,
        historyOperation: "searched",
      }),
    ];

    expect(events.map(getWorkPhaseFromChatStatusEvent)).toEqual([
      "planning",
      "tool",
      "memory",
      "memory",
      "memory",
    ]);
    expect(buildTaskProcessItems(events).map((item) => item.label)).toEqual([
      "历史",
      "记忆",
      "检查点",
      "工具",
      "技能",
    ]);
  });

  it("maps streaming status to working model output state", () => {
    const streamingEvent = createStatusEvent({
      state: "streaming",
      message: "正在输出回复",
      createdAt: "2026-06-23T08:00:04.000Z",
      elapsedMs: 1500,
    });

    expect(getChatStatusKindFromStatusEvent(streamingEvent)).toBe("working");
    expect(getWorkPhaseFromChatStatusEvent(streamingEvent)).toBe("model");
    expect(buildTaskActivityFromStatusEvent(streamingEvent)).toMatchObject({
      kind: "working",
      title: "正在输出回复",
      detail: "正在输出回复",
    });
    expect(buildTaskProcessItems([streamingEvent])[0]?.label).toBe("输出");
  });

  it("projects requirement progress as stable subtask rows", () => {
    const events: ChatTaskStatusEvent[] = [
      createStatusEvent({
        state: "requirement",
        message: "识别全部用户要求",
        createdAt: "2026-06-30T00:00:00.000Z",
        elapsedMs: 100,
        payload: {
          requirementId: "intent",
          label: "识别全部用户要求",
          status: "done",
        },
      }),
      createStatusEvent({
        state: "requirement",
        message: "启动仿写专家 subagent",
        createdAt: "2026-06-30T00:00:01.000Z",
        elapsedMs: 200,
        payload: {
          requirementId: "subagent",
          label: "启动仿写专家 subagent",
          status: "active",
        },
      }),
      createStatusEvent({
        state: "requirement",
        message: "调用 huashu-design",
        createdAt: "2026-06-30T00:00:02.000Z",
        elapsedMs: 300,
        payload: {
          requirementId: "skill",
          label: "调用 huashu-design",
          status: "pending",
        },
      }),
      createStatusEvent({
        state: "requirement",
        message: "subagent 已完成",
        createdAt: "2026-06-30T00:00:03.000Z",
        elapsedMs: 400,
        payload: {
          requirementId: "subagent",
          label: "启动仿写专家 subagent",
          status: "done",
        },
      }),
    ];

    expect(buildRequirementProcessItems(events)).toEqual([
      {
        id: "intent",
        label: "识别全部用户要求",
        message: "识别全部用户要求",
        status: "done",
        time: "08:00:00",
      },
      {
        id: "subagent",
        label: "启动仿写专家 subagent",
        message: "subagent 已完成",
        status: "done",
        time: "08:00:03",
      },
      {
        id: "skill",
        label: "调用 huashu-design",
        message: "调用 huashu-design",
        status: "pending",
        time: "08:00:02",
      },
    ]);
  });

  it("projects subagent status from actor lifecycle events", () => {
    const events: ChatTaskStatusEvent[] = [
      createStatusEvent({
        state: "actor_spawned",
        message: "仿写专家 subagent 已启动",
        createdAt: "2026-06-30T00:01:00.000Z",
        elapsedMs: 100,
        payload: {
          actorId: "actor_1",
          task: "分析长文风格",
        },
      }),
      createStatusEvent({
        state: "actor_spawned",
        message: "对抗审查 subagent 已启动",
        createdAt: "2026-06-30T00:01:01.000Z",
        elapsedMs: 200,
        payload: {
          actorId: "actor_2",
          task: "审查最终 diff",
        },
      }),
      createStatusEvent({
        state: "actor_done",
        message: "仿写专家 subagent 完成",
        createdAt: "2026-06-30T00:01:02.000Z",
        elapsedMs: 300,
        payload: {
          actorId: "actor_1",
          actorStatus: "done",
          summary: "已完成风格分析",
        },
      }),
      createStatusEvent({
        state: "actor_done",
        message: "对抗审查 subagent 失败",
        createdAt: "2026-06-30T00:01:03.000Z",
        elapsedMs: 400,
        payload: {
          actorId: "actor_2",
          actorStatus: "error",
          summary: "发现关键问题",
        },
      }),
    ];

    expect(buildSubagentProcessItems(events)).toEqual([
      {
        id: "actor_1",
        label: "分析长文风格",
        message: "已完成风格分析",
        status: "done",
        time: "08:01:02",
      },
      {
        id: "actor_2",
        label: "审查最终 diff",
        message: "发现关键问题",
        status: "error",
        time: "08:01:03",
      },
    ]);
  });
});

function createStatusEvent(
  partial: Partial<ChatTaskStatusEvent> &
    Pick<ChatTaskStatusEvent, "state" | "message">,
): ChatTaskStatusEvent {
  return {
    sessionId: "session_1",
    createdAt: "2026-06-08T14:00:00.000Z",
    elapsedMs: 0,
    ...partial,
  };
}
