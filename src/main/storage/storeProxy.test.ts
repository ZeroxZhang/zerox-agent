// Backend-matrix tests: exercise the dual/sqlite proxy paths of the stores
// converted in P1 (agentRunStore, agentTrajectoryStore). The legacy `json` path
// is covered by each store's co-located test; here we assert the sqlite/dual
// paths produce equivalent results via the repositories.

import { describe, expect, it } from "vitest";
import { mkdir, rm } from "node:fs/promises";
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
    status: "running",
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
        if (backend === "dual") await store.flushShadowWrites();
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
        if (backend === "dual") await store.flushShadowWrites();
      });
    });
  },
);

describe("dual-write shadows to JSON", () => {
  it("run JSON sidecar receives the same writes after explicit drain", async () => {
    await withStorage("dual", async (dir, storage) => {
      const store = createAgentRunStore({ configDir: dir, backend: "dual", storage });
      await store.append(makeRun("a"));
      await store.flushShadowWrites();
      // A fresh json-only store reading the same configDir should see the run.
      const jsonOnly = createAgentRunStore({ configDir: dir, backend: "json" });
      expect((await jsonOnly.get("a"))?.id).toBe("a");
    });
  });

  it("trajectory JSON sidecar receives the same writes after explicit drain", async () => {
    await withStorage("dual", async (dir, storage) => {
      const store = createAgentTrajectoryStore({ configDir: dir, backend: "dual", storage });
      await store.append("run-1", makeEvent(1));
      await store.flushShadowWrites();

      const jsonOnly = createAgentTrajectoryStore({ configDir: dir, backend: "json" });
      expect((await jsonOnly.list("run-1")).map((event) => event.sequence)).toEqual([1]);
    });
  });

  it("keeps SQLite task mutations authoritative when every JSON shadow fails", async () => {
    await withStorage("dual", async (dir, storage) => {
      await mkdir(join(dir, "scheduled-tasks.json"));
      const { createScheduledTaskStore } = await import("../taskStore");
      const store = createScheduledTaskStore({
        configDir: dir,
        backend: "dual",
        storage,
        createId: () => "task_authoritative",
        now: () => new Date("2026-08-16T00:00:00.000Z"),
      });

      const created = await store.create({
        name: "Authoritative",
        skillName: "",
        enabled: true,
        schedule: { kind: "manual" },
        input: {},
      });
      const updated = await store.update(created.id, {
        name: "SQLite wins",
        skillName: "",
        enabled: true,
        schedule: { kind: "daily", time: "09:00" },
        input: { request: "run" },
      });
      await store.recordRun(
        created.id,
        new Date("2026-08-16T01:00:00.000Z"),
      );
      await store.setEnabled(created.id, false);

      expect(updated?.name).toBe("SQLite wins");
      await expect(store.get(created.id)).resolves.toMatchObject({
        name: "SQLite wins",
        enabled: false,
        lastRunAt: "2026-08-16T01:00:00.000Z",
      });
      await expect(store.delete(created.id)).resolves.toBe(true);
      await expect(store.get(created.id)).resolves.toBeNull();
      await expect(store.flushShadowWrites()).rejects.toMatchObject({
        code: "EISDIR",
      });
    });
  });

  it("reports run shadow failure only at the explicit drain", async () => {
    await withStorage("dual", async (dir, storage) => {
      await mkdir(join(dir, "agent-runs.jsonl"));
      const store = createAgentRunStore({
        configDir: dir,
        backend: "dual",
        storage,
      });

      await expect(store.append(makeRun("authority"))).resolves.toMatchObject({
        id: "authority",
      });
      await expect(store.get("authority")).resolves.toMatchObject({
        id: "authority",
      });
      await expect(store.flushShadowWrites()).rejects.toMatchObject({
        code: "EISDIR",
      });
    });
  });

  it("tracks validation, persona, and audit shadows for shutdown drain", async () => {
    await withStorage("dual", async (dir, storage) => {
      await Promise.all([
        mkdir(join(dir, "agent-validation.json")),
        mkdir(join(dir, "memory-persona.md")),
        mkdir(join(dir, "tool-audit.jsonl")),
      ]);
      const [
        { createAgentValidationStore },
        { createMemoryProfileStore },
        { createToolAuditLog },
      ] = await Promise.all([
        import("../agentValidationStore"),
        import("../memoryProfileStore"),
        import("../toolAuditLog"),
      ]);
      const validation = createAgentValidationStore({
        configDir: dir,
        backend: "dual",
        storage,
      });
      const profile = createMemoryProfileStore({
        configDir: dir,
        backend: "dual",
        storage,
      });
      const audit = createToolAuditLog({
        configDir: dir,
        backend: "dual",
        storage,
      });

      await validation.save({
        validatedAt: "2026-08-16T00:00:00.000Z",
        report: {
          ready: true,
          model: { ready: true, message: "ready" },
          skill: { ready: true, message: "ready" },
          task: { ready: true, created: false, task: null, message: "ready" },
          connection: {
            ready: true,
            checked: true,
            latencyMs: 1,
            message: "ready",
          },
          run: { ready: true, ran: false, run: null, message: "ready" },
        },
      });
      await profile.save("# SQLite persona");
      await audit.append({
        taskId: "task_1",
        request: { toolName: "file_read", args: { path: "/tmp/a" } },
        decision: { allowed: true, reason: "allowed" },
      });

      await expect(validation.flushShadowWrites()).rejects.toMatchObject({
        code: "EISDIR",
      });
      await expect(profile.flushShadowWrites()).rejects.toMatchObject({
        code: "EISDIR",
      });
      await expect(audit.flushShadowWrites()).rejects.toMatchObject({
        code: "EISDIR",
      });
    });
  });

  it("rejects every authoritative mutation after the shutdown drain closes admission", async () => {
    await withStorage("dual", async (dir, storage) => {
      const [
        { createScheduledTaskStore },
        { createAgentValidationStore },
        { createMemoryProfileStore },
        { createToolAuditLog },
      ] = await Promise.all([
        import("../taskStore"),
        import("../agentValidationStore"),
        import("../memoryProfileStore"),
        import("../toolAuditLog"),
      ]);
      const runs = createAgentRunStore({
        configDir: dir,
        backend: "dual",
        storage,
      });
      const trajectories = createAgentTrajectoryStore({
        configDir: dir,
        backend: "dual",
        storage,
      });
      const tasks = createScheduledTaskStore({
        configDir: dir,
        backend: "dual",
        storage,
        createId: () => "task_before_close",
      });
      const validation = createAgentValidationStore({
        configDir: dir,
        backend: "dual",
        storage,
      });
      const profile = createMemoryProfileStore({
        configDir: dir,
        backend: "dual",
        storage,
      });
      const audit = createToolAuditLog({
        configDir: dir,
        backend: "dual",
        storage,
      });
      const validationSnapshot = {
        validatedAt: "2026-08-16T00:00:00.000Z",
        report: {
          ready: true,
          model: { ready: true, message: "ready" },
          skill: { ready: true, message: "ready" },
          task: { ready: true, created: false, task: null, message: "ready" },
          connection: {
            ready: true,
            checked: true,
            latencyMs: 1,
            message: "ready",
          },
          run: { ready: true, ran: false, run: null, message: "ready" },
        },
      };

      await runs.append(makeRun("before-close"));
      await trajectories.append("run-1", makeEvent(1));
      await tasks.create({
        name: "Before close",
        skillName: "",
        enabled: true,
        schedule: { kind: "manual" },
        input: {},
      });
      await validation.save(validationSnapshot);
      await profile.save("# Before close");
      await audit.append({
        taskId: "before-close",
        request: { toolName: "file_read", args: { path: "/tmp/a" } },
        decision: { allowed: true, reason: "allowed" },
      });

      await Promise.all([
        runs.flushShadowWrites({ close: true }),
        trajectories.flushShadowWrites({ close: true }),
        tasks.flushShadowWrites({ close: true }),
        validation.flushShadowWrites({ close: true }),
        profile.flushShadowWrites({ close: true }),
        audit.flushShadowWrites({ close: true }),
      ]);

      const closed = "Persistence queue is closed.";
      await expect(runs.append(makeRun("after-close"))).rejects.toThrow(closed);
      await expect(
        trajectories.append("run-1", makeEvent(2)),
      ).rejects.toThrow(closed);
      await expect(
        tasks.create({
          name: "After close",
          skillName: "",
          enabled: true,
          schedule: { kind: "manual" },
          input: {},
        }),
      ).rejects.toThrow(closed);
      await expect(
        validation.save({
          ...validationSnapshot,
          validatedAt: "2026-08-16T01:00:00.000Z",
        }),
      ).rejects.toThrow(closed);
      await expect(profile.save("# After close")).rejects.toThrow(closed);
      await expect(
        audit.append({
          taskId: "after-close",
          request: { toolName: "file_read", args: { path: "/tmp/b" } },
          decision: { allowed: true, reason: "allowed" },
        }),
      ).rejects.toThrow(closed);

      await expect(runs.get("after-close")).resolves.toBeNull();
      await expect(trajectories.list("run-1")).resolves.toHaveLength(1);
      await expect(tasks.list()).resolves.toHaveLength(1);
      await expect(validation.load()).resolves.toEqual(validationSnapshot);
      await expect(profile.read()).resolves.toMatchObject({
        content: "# Before close",
      });
      await expect(audit.list()).resolves.toHaveLength(1);
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
        if (backend === "dual") await log.flushShadowWrites();
      });
    });

    it("returns the exact event persisted by list", async () => {
      await withStorage(backend, async (dir, storage) => {
        const { createToolAuditLog } = await import("../toolAuditLog");
        const log = createToolAuditLog({
          configDir: dir,
          backend,
          storage,
          createId: () => "audit_exact",
          now: () => new Date("2026-06-21T01:02:03.000Z"),
        });
        const event = await log.append({
          taskId: "task_exact",
          request: { toolName: "shell_exec", args: { cmd: "pwd" } },
          decision: { allowed: true, reason: "approved" },
        });

        await expect(log.list({ limit: 1 })).resolves.toEqual([event]);
        if (backend === "dual") await log.flushShadowWrites();
      });
    });
  },
);

describe.each(["sqlite", "dual"] as StorageBackend[])(
  "scheduledTaskStore backend=%s",
  (backend) => {
    it("create/get/list/setEnabled/recordRun/delete round-trip", async () => {
      await withStorage(backend, async (dir, storage) => {
        const { createScheduledTaskStore } = await import("../taskStore");
        const store = createScheduledTaskStore({ configDir: dir, backend, storage });
        const task = await store.create({ name: "Daily", skillName: "noop", enabled: true, schedule: { kind: "manual" }, input: {} });
        expect((await store.get(task.id))?.name).toBe("Daily");
        await store.update(task.id, {
          name: "Daily weather",
          skillName: "noop",
          enabled: true,
          schedule: { kind: "daily", time: "12:30" },
          input: { request: "weather" },
        });
        expect((await store.get(task.id))?.name).toBe("Daily weather");
        expect((await store.get(task.id))?.nextRunAt).toBeTruthy();
        await store.setEnabled(task.id, false);
        expect((await store.get(task.id))?.enabled).toBe(false);
        await store.recordRun(task.id, new Date("2026-06-19T01:00:00.000Z"));
        expect((await store.get(task.id))?.lastRunAt).toBeTruthy();
        expect((await store.list()).length).toBe(1);
        expect(await store.delete(task.id)).toBe(true);
        expect(await store.get(task.id)).toBeNull();
        if (backend === "dual") await store.flushShadowWrites();
      });
    });

    it("preserves disabled daily task identity and null nextRunAt", async () => {
      await withStorage(backend, async (dir, storage) => {
        const { createScheduledTaskStore } = await import("../taskStore");
        const store = createScheduledTaskStore({
          configDir: dir,
          backend,
          storage,
          createId: () => "task_disabled_daily",
          now: () => new Date("2026-06-21T00:00:00.000Z"),
        });

        const created = await store.create({
          name: "Disabled daily",
          skillName: "noop",
          enabled: false,
          schedule: { kind: "daily", time: "09:30" },
          input: { note: "keep disabled" },
        });

        expect(created).toMatchObject({
          id: "task_disabled_daily",
          enabled: false,
          createdAt: "2026-06-21T00:00:00.000Z",
          updatedAt: "2026-06-21T00:00:00.000Z",
          nextRunAt: null,
        });
        await expect(store.get(created.id)).resolves.toEqual(created);
        await expect(store.list()).resolves.toEqual([created]);
        if (backend === "dual") await store.flushShadowWrites();
      });
    });
  },
);

describe.each(["sqlite", "dual"] as StorageBackend[])(
  "agentValidationStore backend=%s",
  (backend) => {
    it("save/load singleton round-trip", async () => {
      await withStorage(backend, async (dir, storage) => {
        const { createAgentValidationStore } = await import("../agentValidationStore");
        const store = createAgentValidationStore({ configDir: dir, backend, storage });
        expect(await store.load()).toBeNull();
        await store.save({ report: { ready: true, model: { ok: true, detail: "" }, skill: { ok: true, detail: "" }, task: { ok: true, detail: "", tasks: [] }, connection: { ok: true, detail: "" }, run: { ok: true, detail: "", run: undefined } } as never, validatedAt: "2026-06-19T00:00:00.000Z" });
        const loaded = await store.load();
        expect(loaded?.validatedAt).toBe("2026-06-19T00:00:00.000Z");
        if (backend === "dual") await store.flushShadowWrites();
      });
    });
  },
);

describe.each(["sqlite", "dual"] as StorageBackend[])(
  "memoryProfileStore backend=%s",
  (backend) => {
    it("save/read + updateFromMemories round-trip", async () => {
      await withStorage(backend, async (dir, storage) => {
        const { createMemoryProfileStore } = await import("../memoryProfileStore");
        const store = createMemoryProfileStore({ configDir: dir, backend, storage, now: () => new Date("2026-06-19T00:00:00.000Z") });
        expect((await store.read()).content).toBe("");
        await store.save("## Preferences\n- [m1] likes dark mode");
        const doc = await store.read();
        expect(doc.content).toContain("dark mode");
        await store.updateFromMemories([
          { kind: "semantic", title: "pref", content: "likes Vim", tags: ["preference"], source: { type: "manual" }, importance: 3, id: "m2", createdAt: "2026-06-19T00:00:00.000Z", updatedAt: "2026-06-19T00:00:00.000Z" } as never,
        ]);
        const updated = await store.read();
        expect(updated.content).toContain("Vim");
        if (backend === "dual") await store.flushShadowWrites();
      });
    });
  },
);
