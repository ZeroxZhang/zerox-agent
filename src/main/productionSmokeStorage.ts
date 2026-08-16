import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ScheduledTaskStore } from "./taskStore";
import type {
  Storage,
  StorageBackend,
} from "../shared/storageContract";
import type { ProductionStorageSmokeEvidence } from "../shared/productionSmoke";

type RuntimeVersions = {
  electron?: string;
  modules?: string;
  node?: string;
};

export async function runProductionStorageSmokeProbe(options: {
  configDir: string;
  requestedBackend: StorageBackend;
  resolvedBackend: StorageBackend;
  runtimeVersions: RuntimeVersions;
  storage: Storage | null;
  taskStore: ScheduledTaskStore;
  createId?: () => string;
}): Promise<ProductionStorageSmokeEvidence> {
  if (options.requestedBackend !== "dual") {
    throw new Error(
      `Production storage smoke requires requested backend "dual"; received "${options.requestedBackend}".`,
    );
  }
  if (options.resolvedBackend !== "dual" || !options.storage) {
    throw new Error(
      `Production storage smoke rejected storage fallback: requested=dual resolved=${options.resolvedBackend}.`,
    );
  }
  if (!options.runtimeVersions.electron) {
    throw new Error("Production storage smoke must execute inside Electron.");
  }

  const taskId = options.createId?.() ?? `production_smoke_${Date.now()}`;
  const taskName = `Production SQLite smoke ${taskId}`;
  const task = await options.taskStore.create({
    name: taskName,
    skillName: "",
    enabled: false,
    schedule: { kind: "manual" },
    input: {
      productionSmoke: true,
      taskId,
    },
  });
  if (options.createId && task.id !== taskId) {
    throw new Error(
      `Production storage smoke task identity mismatch: expected=${taskId} actual=${task.id}.`,
    );
  }

  await options.taskStore.flushShadowWrites();

  const sqliteRow = options.storage.db
    .prepare("SELECT payload FROM tasks WHERE id = ?")
    .get<{ payload: string }>(task.id);
  const sqliteTask = sqliteRow
    ? (JSON.parse(sqliteRow.payload) as { id?: string; name?: string })
    : null;
  const journal = options.storage.db
    .prepare("PRAGMA journal_mode")
    .get<{ journal_mode?: string }>();
  const foreignKeys = options.storage.db
    .prepare("PRAGMA foreign_keys")
    .get<{ foreign_keys?: number }>();
  const migrations = options.storage.db
    .prepare("SELECT COUNT(*) AS count FROM __zerox_migrations")
    .get<{ count?: number }>();

  const shadowPath = path.join(options.configDir, "scheduled-tasks.json");
  const shadow = JSON.parse(await readFile(shadowPath, "utf8")) as {
    tasks?: Array<{ id?: string; name?: string }>;
  };
  const jsonTask = shadow.tasks?.find((candidate) => candidate.id === task.id);

  const taskRowPersisted =
    sqliteTask?.id === task.id && sqliteTask.name === taskName;
  const jsonShadowPersisted =
    jsonTask?.id === task.id && jsonTask.name === taskName;
  const migrationCount = Number(migrations?.count ?? 0);
  if (
    !taskRowPersisted ||
    !jsonShadowPersisted ||
    foreignKeys?.foreign_keys !== 1 ||
    journal?.journal_mode?.toLowerCase() !== "wal" ||
    migrationCount <= 0
  ) {
    throw new Error(
      "Production storage smoke did not observe matching SQLite and JSON shadow evidence.",
    );
  }

  return {
    schemaVersion: 1,
    kind: "production_storage_smoke",
    requestedBackend: options.requestedBackend,
    resolvedBackend: options.resolvedBackend,
    nativeRuntime: {
      runtime: "electron",
      electronVersion: options.runtimeVersions.electron,
      modulesAbi: options.runtimeVersions.modules ?? "unknown",
      nodeVersion: options.runtimeVersions.node ?? "unknown",
    },
    sqlite: {
      foreignKeys: 1,
      journalMode: "wal",
      migrationCount,
      taskRowPersisted: true,
    },
    dual: {
      jsonShadowPersisted: true,
      taskId: task.id,
      taskName,
    },
  };
}
