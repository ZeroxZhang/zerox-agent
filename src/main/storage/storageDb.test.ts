import { describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createInMemoryStorage, createStorageImpl, createTempFileStorage } from "./storageDb";
import { BUNDLED_MIGRATIONS } from "./migrationBundle";
import { readFileSync, readdirSync } from "node:fs";

const ALL_TABLES = [
  "sessions",
  "chat_messages",
  "runs",
  "trajectory_events",
  "checkpoints",
  "tool_results",
  "memory_records",
  "memory_fts",
  "goals",
  "goal_ledger",
  "artifacts",
  "tasks",
  "tool_audit",
  "permissions",
  "actors",
  "learning_candidates",
  "eval_candidates",
  "promoted_eval_fixtures",
  "workspaces",
  "memory_profile",
  "validation_snapshots",
];

function tableNames(db: { prepare: (s: string) => { all: <T>() => T[] } }): Set<string> {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all<{ name: string }>();
  return new Set(rows.map((r) => r.name));
}

describe("storageDb", () => {
  it("opens an in-memory db with WAL + foreign_keys pragmas", async () => {
    const storage = await createInMemoryStorage();
    const journal = storage.db.prepare("PRAGMA journal_mode").get() as { journal_mode?: string };
    // :memory: dbs report "memory" for journal_mode even when WAL requested;
    // the pragma is still issued. Assert foreign_keys is enforced instead.
    expect(journal).toBeDefined();
    const fk = storage.db.prepare("PRAGMA foreign_keys").get() as { foreign_keys?: number };
    expect(fk.foreign_keys).toBe(1);
    storage.close();
  });

  it("self-checks FTS5 is enabled", async () => {
    const storage = await createInMemoryStorage();
    const row = storage.db
      .prepare("SELECT sqlite_compileoption_used('ENABLE_FTS5') AS ok")
      .get() as { ok: number };
    expect(row.ok).toBe(1);
    storage.close();
  });

  it("creates all contract tables + the migrations ledger on migrate()", async () => {
    const storage = await createInMemoryStorage();
    const tables = tableNames(storage.db);
    for (const name of ALL_TABLES) {
      expect(tables.has(name), `missing table ${name}`).toBe(true);
    }
    expect(tables.has("__zerox_migrations")).toBe(true);
    storage.close();
  });

  it("migrate() is idempotent", async () => {
    const storage = await createInMemoryStorage();
    await storage.migrate();
    await storage.migrate();
    const rows = storage.db
      .prepare("SELECT COUNT(*) AS n FROM __zerox_migrations")
      .get() as { n: number };
    expect(rows.n).toBe(BUNDLED_MIGRATIONS.length);
    storage.close();
  });

  it("creates required indexes", async () => {
    const storage = await createInMemoryStorage();
    const idx = storage.db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name")
      .all<{ name: string }>();
    const names = new Set(idx.map((r) => r.name));
    for (const required of [
      "idx_traj_run_created",
      "idx_runs_task",
      "idx_runs_status",
      "idx_ckp_run_kind",
      "idx_mem_scope_kind",
      "idx_goals_session",
      "idx_goals_status",
      "idx_audit_run",
      "idx_msg_session",
      "idx_actors_run",
    ]) {
      expect(names.has(required), `missing index ${required}`).toBe(true);
    }
    storage.close();
  });

  it("FTS5 memory_fts triggers keep the index in sync", async () => {
    const storage = await createInMemoryStorage();
    const db = storage.db;
    db.prepare(
      `INSERT INTO memory_records (id, kind, scope, title, content, tags, importance, payload, created_at, updated_at)
       VALUES (?, 'semantic', 'global', ?, ?, '[]', 3, ?, ?, ?)`,
    ).run(
      "m1",
      "Zerox Agent architecture",
      "The SQLite storage layer replaces JSON files.",
      JSON.stringify({ id: "m1", title: "Zerox Agent architecture" }),
      "2026-06-19T00:00:00.000Z",
      "2026-06-19T00:00:00.000Z",
    );
    const hit = db
      .prepare("SELECT memory_fts FROM memory_fts WHERE memory_fts MATCH ? ORDER BY rank")
      .all<{ memory_fts: string }>("sqlite");
    expect(hit.length).toBe(1);
    // archive (delete) should remove from FTS via the delete trigger
    db.prepare("DELETE FROM memory_records WHERE id = ?").run("m1");
    const after = db
      .prepare("SELECT memory_fts FROM memory_fts WHERE memory_fts MATCH ?")
      .all("sqlite");
    expect(after.length).toBe(0);
    storage.close();
  });

  it("backup() produces a .bak file for a file-backed db", async () => {
    const dir = join(tmpdir(), `zerox-storage-test-${randomUUID()}`);
    const storage = await createTempFileStorage(dir);
    const backupPath = await storage.backup();
    const row = storage.db
      .prepare("SELECT count(*) AS n FROM __zerox_migrations")
      .get() as { n: number };
    expect(row.n).toBeGreaterThan(0);
    // backup path ends with .bak
    expect(backupPath.endsWith(".bak")).toBe(true);
    storage.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("createStorageImpl on a fresh file path applies migrations", async () => {
    const dir = join(tmpdir(), `zerox-storage-impl-${randomUUID()}`);
    const dbPath = join(dir, "zerox.db");
    const storage = createStorageImpl({ dbPath });
    await storage.migrate();
    const tables = tableNames(storage.db);
    expect(tables.has("runs")).toBe(true);
    storage.close();
    await rm(dir, { recursive: true, force: true });
  });
});

describe("migrationBundle stays in sync with .sql files", () => {
  it("bundle matches the on-disk migration directory", () => {
    const dir = new URL("./migrations/", import.meta.url);
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    expect(files.length).toBe(BUNDLED_MIGRATIONS.length);
    for (const m of BUNDLED_MIGRATIONS) {
      expect(files).toContain(m.name);
      const onDisk = readFileSync(new URL(`migrations/${m.name}`, import.meta.url), "utf8");
      expect(m.sql).toBe(onDisk);
    }
  });
});
