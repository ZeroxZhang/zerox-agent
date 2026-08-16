import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isProductionStorageSmokeEvidence } from "../shared/productionSmoke";
import { createStorageImpl } from "./storage/storageDb";
import { createScheduledTaskStore } from "./taskStore";
import { runProductionStorageSmokeProbe } from "./productionSmokeStorage";

describe("production storage smoke probe", () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await mkdtemp(
      path.join(os.tmpdir(), "zerox-production-storage-smoke-"),
    );
  });

  afterEach(async () => {
    await rm(configDir, { recursive: true, force: true });
  });

  it("executes a native SQLite write and observes the matching dual JSON shadow", async () => {
    const storage = createStorageImpl({
      dbPath: path.join(configDir, "zerox.db"),
    });
    const taskId = "production_smoke_task";
    const taskStore = createScheduledTaskStore({
      configDir,
      backend: "dual",
      storage,
      createId: () => taskId,
    });

    try {
      const evidence = await runProductionStorageSmokeProbe({
        configDir,
        requestedBackend: "dual",
        resolvedBackend: "dual",
        runtimeVersions: {
          electron: "42.9.0",
          modules: "146",
          node: "24.14.0",
        },
        storage,
        taskStore,
        createId: () => taskId,
      });

      expect(isProductionStorageSmokeEvidence(evidence)).toBe(true);
      expect(evidence).toMatchObject({
        requestedBackend: "dual",
        resolvedBackend: "dual",
        nativeRuntime: {
          runtime: "electron",
          modulesAbi: "146",
        },
        sqlite: {
          foreignKeys: 1,
          taskRowPersisted: true,
        },
        dual: {
          jsonShadowPersisted: true,
          taskId,
        },
      });
      expect(
        storage.db
          .prepare("SELECT COUNT(*) AS count FROM tasks WHERE id = ?")
          .get<{ count: number }>(taskId),
      ).toEqual({ count: 1 });
      const shadow = JSON.parse(
        await readFile(path.join(configDir, "scheduled-tasks.json"), "utf8"),
      ) as { tasks: Array<{ id: string }> };
      expect(shadow.tasks.map((task) => task.id)).toEqual([taskId]);
    } finally {
      storage.close();
    }
  });

  it("fails closed before writing when the container resolved JSON fallback", async () => {
    const storage = createStorageImpl({
      dbPath: path.join(configDir, "zerox.db"),
    });
    const taskStore = createScheduledTaskStore({
      configDir,
      backend: "dual",
      storage,
      createId: () => "must_not_write",
    });

    try {
      await expect(
        runProductionStorageSmokeProbe({
          configDir,
          requestedBackend: "dual",
          resolvedBackend: "json",
          runtimeVersions: {
            electron: "42.9.0",
            modules: "146",
            node: "24.14.0",
          },
          storage: null,
          taskStore,
        }),
      ).rejects.toThrow(/rejected storage fallback/);
      expect(
        storage.db.prepare("SELECT COUNT(*) AS count FROM tasks").get(),
      ).toEqual({ count: 0 });
    } finally {
      storage.close();
    }
  });
});
