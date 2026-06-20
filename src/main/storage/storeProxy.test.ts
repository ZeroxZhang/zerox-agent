// Backend-matrix tests: exercise the dual/sqlite proxy paths of the stores
// converted in P1 (agentRunStore, agentTrajectoryStore). The legacy `json` path
// is covered by each store's co-located test; here we assert the sqlite/dual
// paths produce equivalent results via the repositories.

import { describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createAgentRunStore } from "../agentRunStore";
import { createAgentTrajectoryStore } from "../agentTrajectoryStore";
import { createStorageImpl } from "./storageDb";
import type { AgentRunRecord } from "../../shared/agentRuns";
import type { AgentTrajectoryEvent } from "../../shared/agentTrajectory";
import type { StorageBackend } from "../../shared/storageContract";

function makeRun(id: string): AgentRunRecord {
  return {
    id,
    taskId: "task-1",
    taskName: "T",
    skillName: "s",
    status: "executing",
    summary: "",
    events: [],
    startedAt: `2026-06-19T00:00:0${id.length}.000Z`,
    finishedAt: "",
  };
}

function makeEvent(seq: number): AgentTrajectoryEvent {
  return {
    id: `e-${seq}`,
    runId: "run-1",
    type: "tool_call",
    sequence: seq,
    payload: { seq },
    redaction: { containsApiKey: false, containsFileContent: false, containsUserText: false },
    createdAt: `2026-06-19T00:00:0${seq}.000Z`,
  };
}

async function withStorage<T>(
  backend: StorageBackend,
  fn: (dir: string, storage: ReturnType<typeof createStorageImpl>) => Promise<T>,
): Promise<T> {
  const dir = join(tmpdir(), `zerox-proxy-${randomUUID()}`);
  const storage = createStorageImpl({ dbPath: join(dir, "zerox.db") });
  await storage.migrate();
  try {
    return await fn(dir, storage);
  } finally {
    storage.close();
    await rm(dir, { recursive: true, force: true });
  }
}

describe.each(["sqlite", "dual"] as StorageBackend[])(
  "agentRunStore backend=%s",
  (backend) => {
    it("append/get/list round-trip", async () => {
      await withStorage(backend, async (dir, storage) => {
        const store = createAgentRunStore({ configDir: dir, backend, storage });
        await store.append(makeRun("a"));
        await store.append(makeRun("b"));
        expect((await store.get("a"))?.id).toBe("a");
        expect((await store.list()).map((r) => r.id)).toEqual(["b", "a"]);
        expect((await store.list({ limit: 1 })).map((r) => r.id)).toEqual(["b"]);
      });
    });
  },
);

describe.each(["sqlite", "dual"] as StorageBackend[])(
  "agentTrajectoryStore backend=%s",
  (backend) => {
    it("append/list preserves order", async () => {
      await withStorage(backend, async (dir, storage) => {
        const store = createAgentTrajectoryStore({ configDir: dir, backend, storage });
        for (const seq of [1, 2, 3]) await store.append("run-1", makeEvent(seq));
        const events = await store.list("run-1");
        expect(events.map((e) => e.sequence)).toEqual([1, 2, 3]);
      });
    });
  },
);

describe("dual-write shadows to JSON", () => {
  it("JSON sidecar receives the same writes in dual mode", async () => {
    await withStorage("dual", async (dir, storage) => {
      const store = createAgentRunStore({ configDir: dir, backend: "dual", storage });
      await store.append(makeRun("a"));
      // Give the fire-and-forget JSON shadow write time to flush.
      await new Promise((r) => setTimeout(r, 50));
      // A fresh json-only store reading the same configDir should see the run.
      const jsonOnly = createAgentRunStore({ configDir: dir, backend: "json" });
      expect((await jsonOnly.get("a"))?.id).toBe("a");
    });
  });
});

describe.each(["sqlite", "dual"] as StorageBackend[])(
  "toolAuditLog backend=%s",
  (backend) => {
    it("append/list round-trip", async () => {
      await withStorage(backend, async (dir, storage) => {
        const { createToolAuditLog } = await import("../toolAuditLog");
        const log = createToolAuditLog({ configDir: dir, backend, storage });
        await log.append({ taskId: "t1", request: { toolName: "shell_exec", args: {} }, decision: { allowed: true, reason: "ok" } });
        await log.append({ taskId: "t2", request: { toolName: "file_write", args: {} }, decision: { allowed: false, reason: "no" } });
        const events = await log.list();
        expect(events.length).toBe(2);
        expect(events[0]!.request.toolName).toBe("file_write"); // newest first
      });
    });
  },
);
