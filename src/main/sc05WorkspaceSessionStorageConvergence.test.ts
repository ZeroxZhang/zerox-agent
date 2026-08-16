import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  Storage,
  StorageBackend,
} from "../shared/storageContract";
import { createAgentWorkspaceStore } from "./agentWorkspaceStore";
import { createMultiAgentSessionStore } from "./multiAgentSessionStore";
import { createSessionRepository } from "./storage/repositories/sessionRepository";
import {
  createInMemoryStorage,
  createStorageImpl,
} from "./storage/storageDb";

const backends = ["json", "sqlite", "dual"] satisfies StorageBackend[];
const roots: string[] = [];
const storages = new Set<Storage>();

afterEach(async () => {
  for (const storage of storages) {
    storage.close();
  }
  storages.clear();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe.each(backends)("SC05 workspace %s contract", (backend) => {
  it("keeps identity and clocks in the store and preserves CRUD ordering", async () => {
    const root = await createRoot();
    const storage = await createBackendStorage(backend);
    const dates = [
      "2026-08-16T01:00:00.000Z",
      "2026-08-16T01:01:00.000Z",
      "2026-08-16T01:02:00.000Z",
    ];
    let clockIndex = 0;
    let idIndex = 0;
    const store = createAgentWorkspaceStore({
      configDir: root,
      backend,
      ...(storage ? { storage } : {}),
      createId: () => `workspace_${++idIndex}`,
      now: () => new Date(dates[clockIndex++] ?? dates.at(-1)!),
    });

    const first = await store.create({
      name: "First",
      rootPath: "/tmp/first",
      kind: "project",
      cleanup: "keep",
    });
    const second = await store.create({
      name: "Second",
      rootPath: "/tmp/second",
      kind: "temporary",
      cleanup: "delete_on_completion",
    });
    expect(first).toMatchObject({
      id: "workspace_1",
      createdAt: dates[0],
      updatedAt: dates[0],
    });
    await expect(store.touch(first.id)).resolves.toMatchObject({
      id: first.id,
      lastUsedAt: dates[2],
      updatedAt: dates[2],
    });
    await expect(store.list()).resolves.toEqual([
      expect.objectContaining({ id: first.id }),
      expect.objectContaining({ id: second.id }),
    ]);
    await expect(store.delete(second.id)).resolves.toBe(true);
    await expect(store.delete(second.id)).resolves.toBe(false);
    await expect(store.get(second.id)).resolves.toBeNull();

    await store.flushShadowWrites({ close: true });
    if (backend === "dual") {
      const shadow = JSON.parse(
        await readFile(path.join(root, "agent-workspaces.json"), "utf8"),
      ) as { workspaces: Array<{ id: string }> };
      expect(shadow.workspaces.map((workspace) => workspace.id)).toEqual([
        first.id,
      ]);
    }
  });
});

describe.each(backends)("SC05 multi-agent session %s contract", (backend) => {
  it("keeps 100 concurrent child runs across instances and deduplicates repeats", async () => {
    const root = await createRoot();
    const firstStorage = await createFileBackendStorage(backend, root);
    const secondStorage = await createFileBackendStorage(backend, root);
    const first = createMultiAgentSessionStore({
      configDir: root,
      backend,
      ...(firstStorage ? { storage: firstStorage } : {}),
      createId: () => "session_concurrent",
      now: () => new Date("2026-08-16T02:00:00.000Z"),
    });
    const second = createMultiAgentSessionStore({
      configDir: root,
      backend,
      ...(secondStorage ? { storage: secondStorage } : {}),
      now: () => new Date("2026-08-16T02:01:00.000Z"),
    });
    await first.create({
      title: "Concurrent session",
      workspaceId: "workspace_1",
      rootRunId: "run_root",
    });

    await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        (index % 2 ? first : second).appendChildRun(
          "session_concurrent",
          `run_${index}`,
          index % 2 ? "planner" : "executor",
        ),
      ),
    );
    const beforeDuplicate = await first.get("session_concurrent");
    await second.appendChildRun(
      "session_concurrent",
      "run_0",
      "executor",
    );
    expect(await first.get("session_concurrent")).toEqual(beforeDuplicate);
    await second.setStatus("session_concurrent", "paused");

    const stored = await first.get("session_concurrent");
    expect(stored).toMatchObject({
      id: "session_concurrent",
      rootRunId: "run_root",
      status: "paused",
    });
    expect(stored?.childRunIds).toHaveLength(100);
    expect(new Set(stored?.childRunIds)).toEqual(
      new Set(Array.from({ length: 100 }, (_, index) => `run_${index}`)),
    );
    expect(Object.keys(stored?.roles ?? {})).toHaveLength(100);

    if (firstStorage) {
      expect(
        createSessionRepository(firstStorage).getSession("session_concurrent"),
      ).toMatchObject({
        childRunIds: expect.arrayContaining(["run_0", "run_99"]),
        roles: {
          run_0: "executor",
          run_99: "planner",
        },
      });
    }

    await Promise.all([
      first.flushShadowWrites({ close: true }),
      second.flushShadowWrites({ close: true }),
    ]);
    if (backend === "dual") {
      const shadow = JSON.parse(
        await readFile(path.join(root, "multi-agent-sessions.json"), "utf8"),
      ) as {
        sessions: Array<{
          childRunIds: string[];
          roles: Record<string, string>;
        }>;
      };
      expect(shadow.sessions).toHaveLength(1);
      expect(shadow.sessions[0]?.childRunIds).toHaveLength(100);
      expect(Object.keys(shadow.sessions[0]?.roles ?? {})).toHaveLength(100);
    }
  });
});

describe("SC05 SQLite authority recovery", () => {
  it("does not mutate a Chat row through Multi-Agent session operations", async () => {
    const root = await createRoot();
    const storage = trackStorage(await createInMemoryStorage());
    const repository = createSessionRepository(storage);
    repository.createSession({
      id: "shared_session_id",
      kind: "chat",
      title: "Chat authority",
      status: "running",
      payload: { id: "shared_session_id", messages: [] },
      createdAt: "2026-08-16T02:00:00.000Z",
      updatedAt: "2026-08-16T02:00:00.000Z",
    });
    const store = createMultiAgentSessionStore({
      configDir: root,
      backend: "sqlite",
      storage,
    });

    await expect(
      store.appendChildRun("shared_session_id", "run_wrong", "reviewer"),
    ).resolves.toBeNull();
    await expect(
      store.setStatus("shared_session_id", "failed"),
    ).resolves.toBeNull();
    const collidingStore = createMultiAgentSessionStore({
      configDir: root,
      backend: "sqlite",
      storage,
      createId: () => "shared_session_id",
    });
    await expect(
      collidingStore.create({
        title: "Must not replace Chat",
        workspaceId: "workspace_wrong",
      }),
    ).rejects.toThrow(/already belongs to "chat"/);
    expect(repository.getSession("shared_session_id")).toMatchObject({
      kind: "chat",
      status: "running",
      payload: { id: "shared_session_id", messages: [] },
    });
  });

  it.each(["sqlite", "dual"] satisfies StorageBackend[])(
    "recovers workspace and session state from %s after restart",
    async (backend) => {
      const root = await createRoot();
      const dbPath = path.join(root, "zerox.db");
      const firstStorage = trackStorage(createStorageImpl({ dbPath }));
      const workspaceStore = createAgentWorkspaceStore({
        configDir: root,
        backend,
        storage: firstStorage,
        createId: () => "workspace_restart",
      });
      const sessionStore = createMultiAgentSessionStore({
        configDir: root,
        backend,
        storage: firstStorage,
        createId: () => "session_restart",
      });
      await workspaceStore.create({
        name: "Restart workspace",
        rootPath: "/tmp/restart",
        kind: "project",
        cleanup: "keep",
      });
      await sessionStore.create({
        title: "Restart session",
        workspaceId: "workspace_restart",
      });
      await sessionStore.appendChildRun(
        "session_restart",
        "run_restart",
        "reviewer",
      );
      await Promise.all([
        workspaceStore.flushShadowWrites({ close: true }),
        sessionStore.flushShadowWrites({ close: true }),
      ]);
      closeStorage(firstStorage);

      if (backend === "dual") {
        await writeFile(
          path.join(root, "agent-workspaces.json"),
          '{"schemaVersion":1,"workspaces":[]}\n',
          "utf8",
        );
        await writeFile(
          path.join(root, "multi-agent-sessions.json"),
          '{"schemaVersion":1,"sessions":[]}\n',
          "utf8",
        );
      }

      const restartedStorage = trackStorage(createStorageImpl({ dbPath }));
      const restartedWorkspaceStore = createAgentWorkspaceStore({
        configDir: root,
        backend,
        storage: restartedStorage,
      });
      const restartedSessionStore = createMultiAgentSessionStore({
        configDir: root,
        backend,
        storage: restartedStorage,
      });
      await expect(
        restartedWorkspaceStore.get("workspace_restart"),
      ).resolves.toMatchObject({ name: "Restart workspace" });
      await expect(
        restartedSessionStore.get("session_restart"),
      ).resolves.toMatchObject({
        childRunIds: ["run_restart"],
        roles: { run_restart: "reviewer" },
      });
      await Promise.all([
        restartedWorkspaceStore.flushShadowWrites({ close: true }),
        restartedSessionStore.flushShadowWrites({ close: true }),
      ]);
    },
  );
});

describe("SC05 dual shadow failures", () => {
  it("keeps both SQLite commits visible and closes further admission", async () => {
    const root = await createRoot();
    await mkdir(path.join(root, "agent-workspaces.json"));
    await mkdir(path.join(root, "multi-agent-sessions.json"));
    const storage = trackStorage(await createInMemoryStorage());
    const workspaceStore = createAgentWorkspaceStore({
      configDir: root,
      backend: "dual",
      storage,
      createId: () => "workspace_shadow",
    });
    const sessionStore = createMultiAgentSessionStore({
      configDir: root,
      backend: "dual",
      storage,
      createId: () => "session_shadow",
    });

    await workspaceStore.create({
      name: "SQLite workspace",
      rootPath: "/tmp/sqlite",
      kind: "project",
      cleanup: "keep",
    });
    await sessionStore.create({
      title: "SQLite session",
      workspaceId: "workspace_shadow",
    });
    await expect(
      workspaceStore.flushShadowWrites({ close: true }),
    ).rejects.toBeDefined();
    await expect(
      sessionStore.flushShadowWrites({ close: true }),
    ).rejects.toBeDefined();
    await expect(workspaceStore.get("workspace_shadow")).resolves.toMatchObject({
      name: "SQLite workspace",
    });
    await expect(sessionStore.get("session_shadow")).resolves.toMatchObject({
      title: "SQLite session",
    });
    await expect(
      workspaceStore.touch("workspace_shadow"),
    ).rejects.toThrow("Persistence queue is closed");
    await expect(
      sessionStore.setStatus("session_shadow", "failed"),
    ).rejects.toThrow("Persistence queue is closed");
  });
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "zerox-sc05-"));
  roots.push(root);
  return root;
}

async function createBackendStorage(
  backend: StorageBackend,
): Promise<Storage | undefined> {
  return backend === "json"
    ? undefined
    : trackStorage(await createInMemoryStorage());
}

async function createFileBackendStorage(
  backend: StorageBackend,
  root: string,
): Promise<Storage | undefined> {
  return backend === "json"
    ? undefined
    : trackStorage(createStorageImpl({ dbPath: path.join(root, "zerox.db") }));
}

function trackStorage(storage: Storage): Storage {
  storages.add(storage);
  return storage;
}

function closeStorage(storage: Storage): void {
  storage.close();
  storages.delete(storage);
}
