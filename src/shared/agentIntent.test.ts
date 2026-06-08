import { describe, expect, it } from "vitest";
import {
  buildScheduledTaskInputFromIntent,
  classifyAgentIntent,
  matchTaskFromMessage,
} from "./agentIntent";
import type { ScheduledTask } from "./scheduledTasks";
import { getDefaultTaskPermissionPolicy } from "./toolPermissions";

describe("agent intent router", () => {
  it("routes a Chinese scheduled downloads request to create_task", () => {
    const route = classifyAgentIntent("每天 9 点整理下载文件夹");

    expect(route).toEqual({
      kind: "create_task",
      confidence: 0.95,
      slots: {
        schedule: { kind: "daily", time: "09:00" },
        targetDir: "~/Downloads",
        taskName: "整理下载文件夹",
      },
      missingSlots: [],
      reason: "scheduled_file_task_with_target",
    });
  });

  it("routes an English scheduled desktop request to create_task", () => {
    const route = classifyAgentIntent("daily at 18:45 organize desktop folder");

    expect(route).toMatchObject({
      kind: "create_task",
      confidence: 0.95,
      slots: {
        schedule: { kind: "daily", time: "18:45" },
        targetDir: "~/Desktop",
        taskName: "整理桌面文件夹",
      },
      missingSlots: [],
    });
  });

  it("asks for targetDir when a scheduled file task omits the folder", () => {
    const route = classifyAgentIntent("每天 9 点整理文件");

    expect(route).toMatchObject({
      kind: "create_task",
      confidence: 0.72,
      slots: {
        schedule: { kind: "daily", time: "09:00" },
      },
      missingSlots: ["targetDir"],
      clarification:
        "我可以创建这个定时任务。你想让我整理哪个文件夹？例如：下载、桌面、文档或项目。",
    });
  });

  it("routes an explicit task execution command to run_task", () => {
    const route = classifyAgentIntent("请运行整理下载文件夹任务");

    expect(route).toMatchObject({
      kind: "run_task",
      confidence: 0.9,
      slots: {
        targetDir: "~/Downloads",
        taskName: "整理下载文件夹",
      },
      missingSlots: [],
    });
  });

  it("keeps ordinary chat as chat", () => {
    expect(classifyAgentIntent("你觉得当前项目还有哪些优化空间？")).toEqual({
      kind: "chat",
      confidence: 0.4,
      slots: {},
      missingSlots: [],
      reason: "no_action_intent_detected",
    });
  });

  it("does not treat casual run wording as a task execution command", () => {
    expect(classifyAgentIntent("I went for a run this morning")).toMatchObject({
      kind: "chat",
      reason: "no_action_intent_detected",
    });
  });

  it("builds the scheduled task input from a complete create_task route", () => {
    const input = buildScheduledTaskInputFromIntent(
      classifyAgentIntent("每天 9 点整理桌面文件夹"),
    );

    expect(input).toEqual({
      name: "整理桌面文件夹",
      skillName: "local-file-organizer",
      enabled: true,
      schedule: { kind: "daily", time: "09:00" },
      input: { targetDir: "~/Desktop", reportName: "agent-report.md" },
      permissions: {
        ...getDefaultTaskPermissionPolicy(),
        files: { read: ["~/Desktop"], write: ["~/Desktop"] },
      },
    });
  });

  it("matches explicit task names and falls back to the only task", () => {
    const tasks = [
      createTask({ id: "task_downloads", name: "整理下载文件夹" }),
      createTask({ id: "task_desktop", name: "整理桌面文件夹" }),
    ];

    expect(matchTaskFromMessage("请运行整理桌面文件夹任务", tasks)?.id).toBe(
      "task_desktop",
    );
    expect(
      matchTaskFromMessage("请运行任务", [createTask({ id: "only_task" })])?.id,
    ).toBe("only_task");
  });
});

function createTask(partial: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: "task_1",
    name: "Task",
    skillName: "local-file-organizer",
    enabled: true,
    schedule: { kind: "manual" },
    input: {},
    permissions: getDefaultTaskPermissionPolicy(),
    createdAt: "2026-06-06T08:00:00.000Z",
    updatedAt: "2026-06-06T08:00:00.000Z",
    lastRunAt: null,
    nextRunAt: null,
    ...partial,
  };
}
