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
import type { StorageBackend, Storage, TaskRepository } from "../shared/storageContract";
import { createTaskRepository } from "./storage/repositories/index";

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

export interface ScheduledTaskStoreOptions {
  configDir: string;
  createId?: () => string;
  now?: () => Date;
  /** Storage backend (default "json" — legacy behavior, zero regression). */
  backend?: StorageBackend;
  /** Storage instance required when backend is sqlite/dual. */
  storage?: Storage;
}

function shadowWriteError(error: unknown): void {
  // eslint-disable-next-line no-console
  console.warn("[storage] dual-write JSON shadow write failed:", String(error));
}

export function createScheduledTaskStore(options: ScheduledTaskStoreOptions): ScheduledTaskStore {
  const backend: StorageBackend = options.backend ?? "json";
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

  const jsonImpl: ScheduledTaskStore = {
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

  if (backend === "json" || !options.storage) {
    return jsonImpl;
  }

  // --- sqlite / dual ---
  // Validation + normalization stay on the JSON impl's create path (it throws
  // ScheduledTaskValidationError); the repository persists + reads. For
  // recordRun/setEnabled/delete we re-use jsonImpl to compute the updated task
  // then mirror to the repo.
  const repo: TaskRepository = createTaskRepository(options.storage);

  async function jsonCreate(input: ScheduledTaskInput): Promise<ScheduledTask> {
    return jsonImpl.create(input);
  }

  return {
    async list() {
      return repo.list();
    },
    async get(taskId) {
      return repo.get(taskId);
    },
    async create(input) {
      const task = await jsonCreate(input); // validates + normalizes + writes JSON
      repo.create(task);
      return task;
    },
    async recordRun(taskId, completedAt) {
      const updated = await jsonImpl.recordRun(taskId, completedAt);
      if (updated) repo.recordRun(taskId, completedAt);
      return updated;
    },
    async setEnabled(taskId, enabled, changedAt) {
      const updated = await jsonImpl.setEnabled(taskId, enabled, changedAt);
      if (updated) repo.setEnabled(taskId, enabled, changedAt);
      return updated;
    },
    async delete(taskId) {
      const removed = await jsonImpl.delete(taskId);
      if (removed) repo.delete(taskId);
      return removed;
    },
  };
}

function normalizeStoredTask(task: ScheduledTask): ScheduledTask {
  return {
    ...task,
    ...normalizeScheduledTaskInput(task),
  };
}

export { shadowWriteError };
