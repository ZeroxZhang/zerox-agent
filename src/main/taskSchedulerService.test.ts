import { describe, expect, it } from "vitest";
import { createTaskSchedulerService } from "./taskSchedulerService";
import type { ScheduledTaskStore } from "./taskStore";
import type { RunScheduledTaskResult } from "../shared/agentRuns";
import type { ScheduledTask, ScheduledTaskInput } from "../shared/scheduledTasks";
import { getDefaultTaskPermissionPolicy } from "../shared/toolPermissions";

describe("task scheduler service", () => {
  it("runs due enabled tasks and leaves run bookkeeping to the runner", async () => {
    const completedRuns: Array<{ taskId: string; completedAt: string }> = [];
    const taskStore = createTaskStore([
      createTask({
        id: "due_task",
        enabled: true,
        schedule: { kind: "interval", every: 30, unit: "minutes" },
        nextRunAt: "2026-06-06T08:00:00.000Z",
      }),
      createTask({
        id: "future_task",
        enabled: true,
        schedule: { kind: "interval", every: 30, unit: "minutes" },
        nextRunAt: "2026-06-06T09:00:00.000Z",
      }),
      createTask({
        id: "disabled_task",
        enabled: false,
        schedule: { kind: "interval", every: 30, unit: "minutes" },
        nextRunAt: "2026-06-06T08:00:00.000Z",
      }),
      createTask({
        id: "manual_task",
        enabled: true,
        schedule: { kind: "manual" },
        nextRunAt: null,
      }),
    ], completedRuns);
    const runTaskIds: string[] = [];
    const service = createTaskSchedulerService({
      taskStore,
      runScheduledTask: async (taskId) => {
        runTaskIds.push(taskId);
        return createRunResult(taskId);
      },
      now: () => new Date("2026-06-06T08:05:00.000Z"),
    });

    const result = await service.runDueTasks();

    expect(result).toEqual({
      checked: 4,
      due: 1,
      ran: 1,
      failed: 0,
      runIds: ["run_due_task"],
    });
    expect(runTaskIds).toEqual(["due_task"]);
    expect(completedRuns).toEqual([]);
  });

  it("counts failed due runs without recording a completed run", async () => {
    const completedRuns: Array<{ taskId: string; completedAt: string }> = [];
    const taskStore = createTaskStore(
      [
        createTask({
          id: "due_task",
          enabled: true,
          schedule: { kind: "daily", time: "08:00" },
          nextRunAt: "2026-06-06T08:00:00.000Z",
        }),
      ],
      completedRuns,
    );
    const service = createTaskSchedulerService({
      taskStore,
      runScheduledTask: async () => ({
        ok: false,
        message: "Model profile is incomplete.",
      }),
      now: () => new Date("2026-06-06T08:05:00.000Z"),
    });

    await expect(service.runDueTasks()).resolves.toEqual({
      checked: 1,
      due: 1,
      ran: 0,
      failed: 1,
      runIds: [],
    });
    expect(completedRuns).toEqual([]);
  });
});

function createTaskStore(
  tasks: ScheduledTask[],
  completedRuns: Array<{ taskId: string; completedAt: string }>,
): ScheduledTaskStore {
  return {
    async list() {
      return tasks;
    },
    async get(taskId) {
      return tasks.find((task) => task.id === taskId) ?? null;
    },
    async create(_input: ScheduledTaskInput) {
      throw new Error("Not needed in this test.");
    },
    async recordRun(taskId, completedAt) {
      completedRuns.push({ taskId, completedAt: completedAt.toISOString() });
      return tasks.find((task) => task.id === taskId) ?? null;
    },
  };
}

function createTask(partial: Partial<ScheduledTask>): ScheduledTask {
  return {
    id: "task_1",
    name: "Task",
    skillName: "local-file-organizer",
    enabled: true,
    schedule: { kind: "interval", every: 30, unit: "minutes" },
    input: {},
    permissions: getDefaultTaskPermissionPolicy(),
    createdAt: "2026-06-06T07:00:00.000Z",
    updatedAt: "2026-06-06T07:00:00.000Z",
    lastRunAt: null,
    nextRunAt: "2026-06-06T08:00:00.000Z",
    ...partial,
  };
}

function createRunResult(taskId: string): RunScheduledTaskResult {
  return {
    ok: true,
    run: {
      id: `run_${taskId}`,
      taskId,
      taskName: "Task",
      skillName: "local-file-organizer",
      status: "succeeded",
      summary: "Done",
      events: [],
      startedAt: "2026-06-06T08:05:00.000Z",
      finishedAt: "2026-06-06T08:05:00.000Z",
    },
  };
}
