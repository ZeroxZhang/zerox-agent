import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isProductionStorageSmokeEvidence } from "../shared/productionSmoke";
import { createAgentEvalCandidateStore } from "./agentEvalCandidateStore";
import { createAgentExecutionStore } from "./agentExecutionStore";
import { createAgentGoalStore } from "./agentGoalStore";
import { createAgentLearningStore } from "./agentLearningStore";
import { createAgentWorkspaceStore } from "./agentWorkspaceStore";
import { createPromotedAgentEvalFixtureStore } from "./eval/agentPromotedEvalFixtures";
import { createMemoryStore } from "./memoryStore";
import { createMultiAgentSessionStore } from "./multiAgentSessionStore";
import type { Storage } from "../shared/storageContract";
import { bootstrapSqliteDomainAuthority } from "./storage/domainAuthorityBootstrap";
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

  it("proves all P97 domains are SQLite-authoritative inside Electron", async () => {
    const storage = createStorageImpl({
      dbPath: path.join(configDir, "zerox.db"),
    });
    const taskId = "production_smoke_task";
    const stores = createSmokeStores(configDir, storage, taskId);

    try {
      await bootstrapSqliteDomainAuthority({ configDir, storage });
      const evidence = await runProductionStorageSmokeProbe({
        configDir,
        requestedBackend: "sqlite",
        resolvedBackend: "sqlite",
        runtimeVersions: {
          electron: "42.9.0",
          modules: "146",
          node: "24.14.0",
        },
        storage,
        ...stores,
        createId: () => taskId,
      });

      expect(isProductionStorageSmokeEvidence(evidence)).toBe(true);
      expect(evidence).toMatchObject({
        requestedBackend: "sqlite",
        resolvedBackend: "sqlite",
        nativeRuntime: {
          runtime: "electron",
          modulesAbi: "146",
        },
        sqlite: {
          foreignKeys: 1,
          taskRowPersisted: true,
          taskId,
        },
        authority: {
          markerCount: 8,
          domainRowsPersisted: true,
          legacyJsonShadowsAbsent: true,
        },
      });
      expect(
        storage.db
          .prepare("SELECT COUNT(*) AS count FROM tasks WHERE id = ?")
          .get<{ count: number }>(taskId),
      ).toEqual({ count: 1 });
      expect(
        storage.db
          .prepare("SELECT COUNT(*) AS count FROM domain_authority_state")
          .get<{ count: number }>(),
      ).toEqual({ count: 8 });
      await expect(
        access(path.join(configDir, "scheduled-tasks.json")),
      ).rejects.toMatchObject({ code: "ENOENT" });
      await expect(
        access(path.join(configDir, "memory-records.json")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      storage.close();
    }
  });

  it("fails closed before writing when the container resolved JSON fallback", async () => {
    const storage = createStorageImpl({
      dbPath: path.join(configDir, "zerox.db"),
    });
    const stores = createSmokeStores(configDir, storage, "must_not_write");

    try {
      await expect(
        runProductionStorageSmokeProbe({
          configDir,
          requestedBackend: "sqlite",
          resolvedBackend: "json",
          runtimeVersions: {
            electron: "42.9.0",
            modules: "146",
            node: "24.14.0",
          },
          storage: null,
          ...stores,
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

function createSmokeStores(
  configDir: string,
  storage: Storage,
  taskId: string,
) {
  const options = {
    configDir,
    backend: "sqlite" as const,
    storage,
  };
  return {
    taskStore: createScheduledTaskStore({
      ...options,
      createId: () => taskId,
    }),
    goalStore: createAgentGoalStore(options),
    executionStore: createAgentExecutionStore(options),
    memoryStore: createMemoryStore({
      ...options,
      createId: () => `memory_${taskId}`,
    }),
    workspaceStore: createAgentWorkspaceStore({
      ...options,
      createId: () => `workspace_${taskId}`,
    }),
    multiAgentSessionStore: createMultiAgentSessionStore({
      ...options,
      createId: () => `session_${taskId}`,
    }),
    learningStore: createAgentLearningStore({
      ...options,
      createId: () => `learning_${taskId}`,
    }),
    evalCandidateStore: createAgentEvalCandidateStore(options),
    promotedFixtureStore: createPromotedAgentEvalFixtureStore(options),
  };
}
