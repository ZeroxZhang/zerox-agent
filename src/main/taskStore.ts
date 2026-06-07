import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  computeNextRunAt,
  normalizeScheduledTaskInput,
  validateScheduledTaskInput,
  type ScheduledTask,
  type ScheduledTaskInput,
  type ScheduledTaskValidationErrors,
} from "../shared/scheduledTasks";

type StoredScheduledTasks = {
  schemaVersion: 1;
  tasks: ScheduledTask[];
};

export type ScheduledTaskStore = {
  list(): Promise<ScheduledTask[]>;
  get(taskId: string): Promise<ScheduledTask | null>;
  create(input: ScheduledTaskInput): Promise<ScheduledTask>;
  recordRun(taskId: string, completedAt: Date): Promise<ScheduledTask | null>;
  setEnabled(
    taskId: string,
    enabled: boolean,
    changedAt?: Date,
  ): Promise<ScheduledTask | null>;
  delete(taskId: string): Promise<boolean>;
};

export class ScheduledTaskValidationError extends Error {
  constructor(public readonly errors: ScheduledTaskValidationErrors) {
    super("Scheduled task is invalid.");
  }
}

export function createScheduledTaskStore(options: {
  configDir: string;
  createId?: () => string;
  now?: () => Date;
}): ScheduledTaskStore {
  const tasksPath = path.join(options.configDir, "scheduled-tasks.json");
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());

  async function readStoredTasks(): Promise<StoredScheduledTasks> {
    try {
      const raw = await readFile(tasksPath, { encoding: "utf8" });
      const stored = JSON.parse(raw) as StoredScheduledTasks;
      return {
        schemaVersion: 1,
        tasks: Array.isArray(stored.tasks)
          ? stored.tasks.map(normalizeStoredTask)
          : [],
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { schemaVersion: 1, tasks: [] };
      }

      throw error;
    }
  }

  async function writeStoredTasks(stored: StoredScheduledTasks) {
    await mkdir(options.configDir, { recursive: true });
    await writeFile(tasksPath, `${JSON.stringify(stored, null, 2)}\n`, {
      encoding: "utf8",
    });
  }

  return {
    async list() {
      const stored = await readStoredTasks();
      return stored.tasks;
    },

    async get(taskId) {
      const stored = await readStoredTasks();
      return stored.tasks.find((task) => task.id === taskId) ?? null;
    },

    async create(input) {
      const normalized = normalizeScheduledTaskInput(input);
      const validation = validateScheduledTaskInput(normalized);

      if (!validation.valid) {
        throw new ScheduledTaskValidationError(validation.errors);
      }

      const timestamp = now().toISOString();
      const task: ScheduledTask = {
        ...normalized,
        id: createId(),
        createdAt: timestamp,
        updatedAt: timestamp,
        lastRunAt: null,
        nextRunAt: normalized.enabled
          ? computeNextRunAt(normalized.schedule, new Date(timestamp))
          : null,
      };

      const stored = await readStoredTasks();
      const nextStored: StoredScheduledTasks = {
        schemaVersion: 1,
        tasks: [...stored.tasks, task],
      };
      await writeStoredTasks(nextStored);

      return task;
    },

    async recordRun(taskId, completedAt) {
      const stored = await readStoredTasks();
      const timestamp = completedAt.toISOString();
      let updatedTask: ScheduledTask | null = null;
      const nextTasks = stored.tasks.map((task) => {
        if (task.id !== taskId) {
          return task;
        }

        updatedTask = {
          ...task,
          lastRunAt: timestamp,
          nextRunAt: task.enabled
            ? computeNextRunAt(task.schedule, completedAt)
            : null,
          updatedAt: timestamp,
        };
        return updatedTask;
      });

      if (!updatedTask) {
        return null;
      }

      await writeStoredTasks({
        schemaVersion: 1,
        tasks: nextTasks,
      });

      return updatedTask;
    },

    async setEnabled(taskId, enabled, changedAt = now()) {
      const stored = await readStoredTasks();
      const timestamp = changedAt.toISOString();
      let updatedTask: ScheduledTask | null = null;
      const nextTasks = stored.tasks.map((task) => {
        if (task.id !== taskId) {
          return task;
        }

        updatedTask = {
          ...task,
          enabled,
          nextRunAt: enabled ? computeNextRunAt(task.schedule, changedAt) : null,
          updatedAt: timestamp,
        };
        return updatedTask;
      });

      if (!updatedTask) {
        return null;
      }

      await writeStoredTasks({
        schemaVersion: 1,
        tasks: nextTasks,
      });

      return updatedTask;
    },

    async delete(taskId) {
      const stored = await readStoredTasks();
      const nextTasks = stored.tasks.filter((task) => task.id !== taskId);

      if (nextTasks.length === stored.tasks.length) {
        return false;
      }

      await writeStoredTasks({
        schemaVersion: 1,
        tasks: nextTasks,
      });

      return true;
    },
  };
}

function normalizeStoredTask(task: ScheduledTask): ScheduledTask {
  return {
    ...task,
    ...normalizeScheduledTaskInput(task),
  };
}
