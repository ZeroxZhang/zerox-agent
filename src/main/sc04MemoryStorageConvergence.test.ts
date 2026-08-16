import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { MemoryRecord } from "../shared/memory";
import type {
  Storage,
  StorageBackend,
} from "../shared/storageContract";
import { createMemoryStore } from "./memoryStore";
import {
  createInMemoryStorage,
  createStorageImpl,
} from "./storage/storageDb";
import { createMemoryRepository } from "./storage/repositories/memoryRepository";

const roots: string[] = [];
const storages: Storage[] = [];

afterEach(async () => {
  for (const storage of storages.splice(0)) {
    try {
      storage.close();
    } catch {
      // A restart test may already have closed the tracked handle.
    }
  }
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("SC04 Memory storage convergence", () => {
  it("keeps embedding, hybrid RRF, reranking, session isolation, and CRUD identical", async () => {
    const outcomes: unknown[] = [];

    for (const backend of ["json", "sqlite", "dual"] satisfies StorageBackend[]) {
      const root = await createRoot();
      const storage = await createBackendStorage(backend);
      const embeddingCalls: string[] = [];
      let rerankerCalls = 0;
      const store = createMemoryStore({
        configDir: root,
        backend,
        ...(storage ? { storage } : {}),
        createId: createSequentialId("memory"),
        now: createSteppedClock("2026-08-16T10:00:00.000Z"),
        embeddingService: {
          async embed(text) {
            embeddingCalls.push(text);
            return {
              model: "embedding-sc04",
              vector: text.includes("unrelated") ? [0, 1] : [1, 0],
            };
          },
        },
        reranker: {
          rerank(results) {
            rerankerCalls += 1;
            return results;
          },
        },
      });

      await store.create({
        kind: "session",
        title: "Current context",
        content: "storage context",
        source: {
          type: "chat_session",
          sessionId: "session_current",
          messageIds: ["message_current"],
        },
      });
      await store.create({
        kind: "session",
        title: "Foreign context",
        content: "storage context",
        source: {
          type: "chat_session",
          sessionId: "session_foreign",
          messageIds: ["message_foreign"],
        },
      });
      const global = await store.create({
        kind: "semantic",
        title: "Global context",
        content: "storage context",
      });

      const search = await store.search({
        query: "storage context",
        sessionId: "session_current",
        strategy: "hybrid",
      });
      const deleted = await store.delete("memory_2");
      const records = await store.list({ includeArchived: true });
      await store.flushShadowWrites();

      if (backend === "dual") {
        expect(
          JSON.parse(
            await readFile(path.join(root, "memory-records.json"), "utf8"),
          ),
        ).toEqual({ schemaVersion: 1, records });
      }

      outcomes.push({
        deleted,
        records,
        search,
        embeddingCalls,
        rerankerCalls,
        globalEmbedding: global.embedding,
      });
    }

    expect(outcomes[1]).toEqual(outcomes[0]);
    expect(outcomes[2]).toEqual(outcomes[0]);
    expect(outcomes[0]).toMatchObject({
      deleted: true,
      records: [
        { id: "memory_1", title: "Current context" },
        { id: "memory_3", title: "Global context" },
      ],
      search: [
        { record: { id: "memory_3" } },
        { record: { id: "memory_1" } },
      ],
      rerankerCalls: 1,
      globalEmbedding: {
        model: "embedding-sc04",
        dimensions: 2,
        vector: [1, 0],
      },
    });
    expect(
      (outcomes[0] as { search: Array<{ record: MemoryRecord }> }).search
        .map((result) => result.record.id),
    ).not.toContain("memory_2");
    expect(
      (outcomes[0] as { embeddingCalls: string[] }).embeddingCalls.at(-1),
    ).toBe("storage context");
  });

  it("keeps maintenance and governance identical across all backends", async () => {
    const outcomes: unknown[] = [];

    for (const backend of ["json", "sqlite", "dual"] satisfies StorageBackend[]) {
      const root = await createRoot();
      const storage = await createBackendStorage(backend);
      const store = createMemoryStore({
        configDir: root,
        backend,
        ...(storage ? { storage } : {}),
        createId: createSequentialId("memory"),
        now: () => new Date("2026-08-16T11:00:00.000Z"),
      });

      for (const content of ["first observation", "second observation"]) {
        await store.create({
          kind: "episodic",
          title: "Repeated observation",
          content,
          tags: ["storage"],
          importance: 2,
        });
      }

      const governance = await store.reviewGovernance({
        now: "2026-08-16T11:00:00.000Z",
      });
      const maintenance = await store.runMaintenance({
        minDuplicateGroupSize: 2,
        createdAt: "2026-08-16T11:05:00.000Z",
      });
      const records = await store.list({ includeArchived: true });
      await store.flushShadowWrites();

      outcomes.push({ governance, maintenance, records });
    }

    expect(outcomes[1]).toEqual(outcomes[0]);
    expect(outcomes[2]).toEqual(outcomes[0]);
    expect(outcomes[0]).toMatchObject({
      governance: {
        scanned: 2,
        duplicateGroups: [{ memoryIds: ["memory_1", "memory_2"] }],
      },
      maintenance: {
        scanned: 2,
        consolidated: 1,
        archived: 2,
        createdMemories: [{ id: "memory_3" }],
      },
      records: [
        { id: "memory_1", consolidatedInto: "memory_3" },
        { id: "memory_2", consolidatedInto: "memory_3" },
        { id: "memory_3" },
      ],
    });
  });

  it("rolls back the complete maintenance replacement when one row fails", async () => {
    const root = await createRoot();
    const storage = await createBackendStorage("sqlite");
    const store = createMemoryStore({
      configDir: root,
      backend: "sqlite",
      storage: storage!,
      createId: createSequentialId("memory"),
      now: () => new Date("2026-08-16T12:00:00.000Z"),
    });
    for (const content of ["first", "second"]) {
      await store.create({
        kind: "episodic",
        title: "Rollback observation",
        content,
      });
    }
    const before = await store.list({ includeArchived: true });
    storage!.db.exec(`
      CREATE TRIGGER reject_sc04_consolidation
      BEFORE INSERT ON memory_records
      WHEN NEW.title LIKE 'Merged memory:%'
      BEGIN
        SELECT RAISE(ABORT, 'reject SC04 consolidation');
      END;
    `);

    await expect(
      store.runMaintenance({
        minDuplicateGroupSize: 2,
        createdAt: "2026-08-16T12:05:00.000Z",
      }),
    ).rejects.toThrow("reject SC04 consolidation");
    await expect(store.list({ includeArchived: true })).resolves.toEqual(before);
  });

  it("atomically replaces records and limits repository session candidates", async () => {
    const storage = await createBackendStorage("sqlite");
    const repository = createMemoryRepository(storage!);
    const current = createRecord({
      id: "memory_current",
      kind: "session",
      title: "Current isolation",
      source: {
        type: "chat_session",
        sessionId: "session_current",
        messageIds: [],
      },
    });
    const foreign = createRecord({
      id: "memory_foreign",
      kind: "session",
      title: "Foreign isolation",
      source: {
        type: "chat_session",
        sessionId: "session_foreign",
        messageIds: [],
      },
    });
    const durable = createRecord({
      id: "memory_durable",
      kind: "semantic",
      title: "Durable isolation",
      source: { type: "manual" },
    });

    repository.replaceAll([current, foreign, durable]);
    expect(
      repository
        .search({
          query: "isolation",
          kind: "session",
          sessionId: "session_current",
        })
        .map((result) => result.record.id),
    ).toEqual(["memory_current"]);

    repository.replaceAll([durable]);
    expect(repository.list({ includeArchived: true })).toEqual([durable]);
    expect(() => repository.replaceAll([current, current])).toThrow();
    expect(repository.list({ includeArchived: true })).toEqual([durable]);
    repository.write(current);
    expect(() => repository.replaceAll([foreign], [durable])).toThrow(
      "changed before the authoritative transaction committed",
    );
    expect(repository.list({ includeArchived: true })).toEqual([
      durable,
      current,
    ]);
  });

  it("commits SQLite before reporting an atomic JSON shadow failure", async () => {
    const root = await createRoot();
    const blockedConfigDir = path.join(root, "blocked");
    await writeFile(blockedConfigDir, "not a directory", "utf8");
    const storage = await createBackendStorage("dual");
    const store = createMemoryStore({
      configDir: blockedConfigDir,
      backend: "dual",
      storage: storage!,
      createId: () => "memory_shadow",
    });

    await expect(
      store.create({
        kind: "semantic",
        title: "SQLite survives",
        content: "The shadow cannot replace SQLite authority.",
      }),
    ).resolves.toMatchObject({ id: "memory_shadow" });
    await expect(store.flushShadowWrites()).rejects.toMatchObject({
      code: expect.stringMatching(/EEXIST|ENOTDIR/),
    });
    await expect(store.list()).resolves.toMatchObject([
      { id: "memory_shadow" },
    ]);
  });

  it.each(["sqlite", "dual"] satisfies StorageBackend[])(
    "recovers %s authority after restart without trusting the JSON shadow",
    async (backend) => {
      const root = await createRoot();
      const dbPath = path.join(root, "zerox.db");
      const firstStorage = trackStorage(createStorageImpl({ dbPath }));
      const first = createMemoryStore({
        configDir: root,
        backend,
        storage: firstStorage,
        createId: () => "memory_restart",
      });
      await first.create({
        kind: "semantic",
        title: "Restart authority",
        content: "SQLite remains canonical after restart.",
      });
      await first.flushShadowWrites({ close: true });
      firstStorage.close();

      if (backend === "dual") {
        await writeFile(
          path.join(root, "memory-records.json"),
          `${JSON.stringify({ schemaVersion: 1, records: [] })}\n`,
          "utf8",
        );
      }

      const secondStorage = trackStorage(createStorageImpl({ dbPath }));
      const second = createMemoryStore({
        configDir: root,
        backend,
        storage: secondStorage,
      });

      await expect(second.list()).resolves.toMatchObject([
        { id: "memory_restart", title: "Restart authority" },
      ]);
      await second.flushShadowWrites({ close: true });
    },
  );
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "zerox-sc04-memory-"));
  roots.push(root);
  return root;
}

async function createBackendStorage(
  backend: StorageBackend,
): Promise<Storage | undefined> {
  if (backend === "json") {
    return undefined;
  }
  return trackStorage(await createInMemoryStorage());
}

function trackStorage(storage: Storage): Storage {
  storages.push(storage);
  return storage;
}

function createSequentialId(prefix: string): () => string {
  let index = 0;
  return () => `${prefix}_${++index}`;
}

function createSteppedClock(startIso: string): () => Date {
  let offset = 0;
  const start = new Date(startIso).getTime();
  return () => new Date(start + offset++ * 1000);
}

function createRecord(
  options: Pick<MemoryRecord, "id" | "kind" | "title" | "source"> &
    Partial<MemoryRecord>,
): MemoryRecord {
  return {
    content: `${options.title} content`,
    tags: [],
    importance: 3,
    createdAt: "2026-08-16T13:00:00.000Z",
    updatedAt: "2026-08-16T13:00:00.000Z",
    ...options,
  };
}
