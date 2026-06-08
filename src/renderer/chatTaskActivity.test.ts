import { describe, expect, it } from "vitest";
import {
  buildTaskActivityDetail,
  buildTaskProcessItems,
  createTaskActivity,
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
