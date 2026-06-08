import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ScheduledTaskValidationError,
  createScheduledTaskStore,
} from "./taskStore";
import { getDefaultTaskPermissionPolicy } from "../shared/toolPermissions";

describe("scheduled task store", () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await mkdtemp(path.join(os.tmpdir(), "building-agent-tasks-"));
  });

  afterEach(async () => {
    await rm(configDir, { recursive: true, force: true });
  });

  it("returns an empty list when no task file exists", async () => {
    const store = createScheduledTaskStore({ configDir });

    await expect(store.list()).resolves.toEqual([]);
  });

  it("creates and persists a scheduled task", async () => {
    const store = createScheduledTaskStore({
      configDir,
      createId: () => "task_123",
      now: () => new Date("2026-06-05T08:00:00.000Z"),
    });

    const task = await store.create({
      name: "  Organize downloads  ",
      skillName: "local-file-organizer",
      enabled: true,
      schedule: { kind: "interval", every: 1, unit: "hours" },
      input: { targetDir: "/Users/demo/Downloads" },
    });

    expect(task).toMatchObject({
      id: "task_123",
      name: "Organize downloads",
      skillName: "local-file-organizer",
      permissions: getDefaultTaskPermissionPolicy(),
      nextRunAt: "2026-06-05T09:00:00.000Z",
      lastRunAt: null,
    });
    await expect(store.list()).resolves.toEqual([task]);

    const raw = await readFile(path.join(configDir, "scheduled-tasks.json"), {
      encoding: "utf8",
    });
    expect(JSON.parse(raw)).toEqual({
      schemaVersion: 1,
      tasks: [task],
    });
  });

  it("records a completed run and recomputes the next run", async () => {
    const store = createScheduledTaskStore({
      configDir,
      createId: () => "task_interval",
      now: () => new Date("2026-06-05T08:00:00.000Z"),
    });
    await store.create({
      name: "Organize downloads",
      skillName: "local-file-organizer",
      enabled: true,
      schedule: { kind: "interval", every: 30, unit: "minutes" },
      input: { targetDir: "/Users/demo/Downloads" },
    });

    const updated = await store.recordRun(
      "task_interval",
      new Date("2026-06-05T08:10:00.000Z"),
    );

    expect(updated).toMatchObject({
      id: "task_interval",
      lastRunAt: "2026-06-05T08:10:00.000Z",
      nextRunAt: "2026-06-05T08:40:00.000Z",
      updatedAt: "2026-06-05T08:10:00.000Z",
    });

    const reloaded = createScheduledTaskStore({ configDir });
    await expect(reloaded.get("task_interval")).resolves.toEqual(updated);
  });

  it("pauses and resumes a task while recomputing the next run", async () => {
    const store = createScheduledTaskStore({
      configDir,
      createId: () => "task_toggle",
      now: () => new Date("2026-06-05T08:00:00.000Z"),
    });
    await store.create({
      name: "Organize downloads",
      skillName: "local-file-organizer",
      enabled: true,
      schedule: { kind: "interval", every: 30, unit: "minutes" },
      input: { targetDir: "/Users/demo/Downloads" },
    });

    const paused = await store.setEnabled(
      "task_toggle",
      false,
      new Date("2026-06-05T08:10:00.000Z"),
    );
    expect(paused).toMatchObject({
      id: "task_toggle",
      enabled: false,
      nextRunAt: null,
      updatedAt: "2026-06-05T08:10:00.000Z",
    });

    const resumed = await store.setEnabled(
      "task_toggle",
      true,
      new Date("2026-06-05T08:20:00.000Z"),
    );
    expect(resumed).toMatchObject({
      id: "task_toggle",
      enabled: true,
      nextRunAt: "2026-06-05T08:50:00.000Z",
      updatedAt: "2026-06-05T08:20:00.000Z",
    });

    const reloaded = createScheduledTaskStore({ configDir });
    await expect(reloaded.get("task_toggle")).resolves.toEqual(resumed);
  });

  it("deletes a task from disk", async () => {
    const store = createScheduledTaskStore({
      configDir,
      createId: () => "task_delete",
      now: () => new Date("2026-06-05T08:00:00.000Z"),
    });
    await store.create({
      name: "Organize downloads",
      skillName: "local-file-organizer",
      enabled: true,
      schedule: { kind: "manual" },
      input: { targetDir: "/Users/demo/Downloads" },
    });

    await expect(store.delete("missing_task")).resolves.toBe(false);
    await expect(store.delete("task_delete")).resolves.toBe(true);
    await expect(store.get("task_delete")).resolves.toBeNull();
    await expect(store.list()).resolves.toEqual([]);
  });

  it("rejects invalid task input before writing", async () => {
    const store = createScheduledTaskStore({ configDir });

    await expect(
      store.create({
        name: "",
        skillName: "",
        enabled: true,
        schedule: { kind: "daily", time: "99:00" },
        input: {},
      }),
    ).rejects.toBeInstanceOf(ScheduledTaskValidationError);

    await expect(store.list()).resolves.toEqual([]);
  });

  it("creates and persists a task permission policy", async () => {
    const store = createScheduledTaskStore({
      configDir,
      createId: () => "task_permissions",
      now: () => new Date("2026-06-05T08:00:00.000Z"),
    });

    const task = await store.create({
      name: "Organize downloads",
      skillName: "local-file-organizer",
      enabled: true,
      schedule: { kind: "manual" },
      input: { targetDir: "/Users/demo/Downloads" },
      permissions: {
        files: {
          read: ["/Users/demo/Downloads"],
          write: ["/Users/demo/Downloads/reports"],
        },
        web: { search: false, fetchDomains: ["example.com"] },
        shell: { commands: ["find {{targetDir}} -maxdepth 1 -type f"] },
      },
    });

    expect(task.permissions).toEqual({
      files: {
        read: ["/Users/demo/Downloads"],
        write: ["/Users/demo/Downloads/reports"],
      },
      web: { search: false, fetchDomains: ["example.com"] },
      shell: { commands: ["find {{targetDir}} -maxdepth 1 -type f"] },
      memory: { read: false, write: false },
    });
    await expect(store.list()).resolves.toEqual([task]);
    await expect(store.get("task_permissions")).resolves.toEqual(task);
    await expect(store.get("missing_task")).resolves.toBeNull();
  });

  it("loads legacy tasks without permissions as default deny", async () => {
    const store = createScheduledTaskStore({ configDir });
    await writeFile(
      path.join(configDir, "scheduled-tasks.json"),
      JSON.stringify({
        schemaVersion: 1,
        tasks: [
          {
            name: "Legacy task",
            skillName: "local-file-organizer",
            enabled: true,
            schedule: { kind: "manual" },
            input: {},
            id: "legacy_task",
            createdAt: "2026-06-05T08:00:00.000Z",
            updatedAt: "2026-06-05T08:00:00.000Z",
            lastRunAt: null,
            nextRunAt: null,
          },
        ],
      }),
      { encoding: "utf8" },
    );

    await expect(store.list()).resolves.toEqual([
      {
        name: "Legacy task",
        skillName: "local-file-organizer",
        enabled: true,
        schedule: { kind: "manual" },
        input: {},
        permissions: getDefaultTaskPermissionPolicy(),
        id: "legacy_task",
        createdAt: "2026-06-05T08:00:00.000Z",
        updatedAt: "2026-06-05T08:00:00.000Z",
        lastRunAt: null,
        nextRunAt: null,
      },
    ]);
  });
});
