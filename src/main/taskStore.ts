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
import {
  createFailureVisibleSerialQueue,
  type PersistenceQueueDrainOptions,
} from "./failureVisibleSerialQueue";

type StoredScheduledTasks = {
  schemaVersion: 1;
  tasks: ScheduledTask[];
};

export type ScheduledTaskStore = {
  list(): Promise<ScheduledTask[]>;
  get(taskId: string): Promise<ScheduledTask | null>;
  create(input: ScheduledTaskInput): Promise<ScheduledTask>;
  update(
    taskId: string,
    input: ScheduledTaskInput,
    changedAt?: Date,
  ): Promise<ScheduledTask | null>;
  recordRun(taskId: string, completedAt: Date): Promise<ScheduledTask | null>;
  setEnabled(
    taskId: string,
    enabled: boolean,
    changedAt?: Date,
  ): Promise<ScheduledTask | null>;
  delete(taskId: string): Promise<boolean>;
  flushShadowWrites(options?: PersistenceQueueDrainOptions): Promise<void>;
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

    async update(taskId, input, changedAt = now()) {
      const normalized = normalizeScheduledTaskInput(input);
      const validation = validateScheduledTaskInput(normalized);

      if (!validation.valid) {
        throw new ScheduledTaskValidationError(validation.errors);
      }

      const stored = await readStoredTasks();
      const timestamp = changedAt.toISOString();
      let updatedTask: ScheduledTask | null = null;
      const nextTasks = stored.tasks.map((task) => {
        if (task.id !== taskId) {
          return task;
        }

        updatedTask = {
          ...task,
          ...normalized,
          id: task.id,
          createdAt: task.createdAt,
          lastRunAt: task.lastRunAt,
          updatedAt: timestamp,
          nextRunAt: normalized.enabled
            ? computeNextRunAt(normalized.schedule, changedAt)
            : null,
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
    async flushShadowWrites() {
      return;
    },
  };

  if (backend === "json" || !options.storage) {
    return jsonImpl;
  }

  // --- sqlite / dual ---
  const repo: TaskRepository = createTaskRepository(options.storage);
  const shadowQueue = createFailureVisibleSerialQueue();

  function validatedInput(input: ScheduledTaskInput): ScheduledTaskInput {
    const normalized = normalizeScheduledTaskInput(input);
    const validation = validateScheduledTaskInput(normalized);
    if (!validation.valid) {
      throw new ScheduledTaskValidationError(validation.errors);
    }
    return normalized;
  }

  function enqueueJsonShadow(): void {
    if (backend !== "dual") {
      return;
    }
    const snapshot: StoredScheduledTasks = {
      schemaVersion: 1,
      tasks: repo.list(),
    };
    void shadowQueue.enqueue(() => writeStoredTasks(snapshot));
  }

  return {
    async list() {
      return repo.list();
    },
    async get(taskId) {
      return repo.get(taskId);
    },
    async create(input) {
      shadowQueue.assertOpen();
      const normalized = validatedInput(input);
      const timestamp = now().toISOString();
      const task = repo.create({
        ...normalized,
        id: createId(),
        createdAt: timestamp,
        updatedAt: timestamp,
        lastRunAt: null,
        nextRunAt: normalized.enabled
          ? computeNextRunAt(normalized.schedule, new Date(timestamp))
          : null,
      });
      enqueueJsonShadow();
      return task;
    },
    async update(taskId, input, changedAt) {
      shadowQueue.assertOpen();
      const effectiveChangedAt = changedAt ?? now();
      const updated = repo.update(
        taskId,
        validatedInput(input),
        effectiveChangedAt,
      );
      if (updated) enqueueJsonShadow();
      return updated;
    },
    async recordRun(taskId, completedAt) {
      shadowQueue.assertOpen();
      const updated = repo.recordRun(taskId, completedAt);
      if (updated) enqueueJsonShadow();
      return updated;
    },
    async setEnabled(taskId, enabled, changedAt) {
      shadowQueue.assertOpen();
      const updated = repo.setEnabled(taskId, enabled, changedAt);
      if (updated) enqueueJsonShadow();
      return updated;
    },
    async delete(taskId) {
      shadowQueue.assertOpen();
      const removed = repo.delete(taskId);
      if (removed) enqueueJsonShadow();
      return removed;
    },
    async flushShadowWrites(flushOptions) {
      await shadowQueue.drain(flushOptions);
    },
  };
}

function normalizeStoredTask(task: ScheduledTask): ScheduledTask {
  return {
    ...task,
    ...normalizeScheduledTaskInput(task),
  };
}
