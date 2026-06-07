import type { RunScheduledTaskResult } from "../shared/agentRuns";
import type { ScheduledTask } from "../shared/scheduledTasks";
import type { ScheduledTaskStore } from "./taskStore";

export type TaskSchedulerReport = {
  checked: number;
  due: number;
  ran: number;
  failed: number;
  runIds: string[];
};

export type TaskSchedulerService = {
  runDueTasks(): Promise<TaskSchedulerReport>;
};

export function createTaskSchedulerService(options: {
  taskStore: Pick<ScheduledTaskStore, "list">;
  runScheduledTask: (taskId: string) => Promise<RunScheduledTaskResult>;
  now?: () => Date;
}): TaskSchedulerService {
  const now = options.now ?? (() => new Date());

  return {
    async runDueTasks() {
      const currentTime = now();
      const tasks = await options.taskStore.list();
      const dueTasks = tasks.filter((task) => isTaskDue(task, currentTime));
      const report: TaskSchedulerReport = {
        checked: tasks.length,
        due: dueTasks.length,
        ran: 0,
        failed: 0,
        runIds: [],
      };

      for (const task of dueTasks) {
        const result = await options.runScheduledTask(task.id);
        if (!result.ok) {
          report.failed += 1;
          continue;
        }

        report.ran += 1;
        report.runIds.push(result.run.id);
      }

      return report;
    },
  };
}

function isTaskDue(task: ScheduledTask, currentTime: Date): boolean {
  if (!task.enabled || task.schedule.kind === "manual" || !task.nextRunAt) {
    return false;
  }

  return new Date(task.nextRunAt).getTime() <= currentTime.getTime();
}
