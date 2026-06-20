// P1 migration script round-trip test.
//
// The migrate-to-sqlite / rollback-sqlite-to-json scripts import the compiled
// dist-electron modules, so they run as real child processes (not vitest
// in-process). This test seeds a temp configDir with legacy JSON/JSONL, runs
// `node scripts/migrate-to-sqlite.mjs --verify`, then `node
// scripts/rollback-sqlite-to-json.mjs`, and asserts the rollback re-exports
// the seeded data. Requires `npm run build` (run by `npm run verify` before
// evals; this test is part of `npm test` which runs first in verify, so it
// builds the dist-electron it needs via the test-time tsc — but to be safe we
// skip when dist-electron is absent).

import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { existsSync as exists } from "node:fs";

const root = path.resolve(__dirname, "..", "..", "..");
const distReady = exists(path.join(root, "dist-electron", "main", "storage", "storageDb.js"));

describe.skipIf(!distReady)("P1 migration scripts round-trip", () => {
  it("migrates legacy JSON→SQLite then rolls back SQLite→JSON, preserving data", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "zerox-mig-rt-"));
    try {
      // Seed legacy files.
      writeFileSync(
        path.join(dir, "agent-runs.jsonl"),
        JSON.stringify({ id: "run-1", taskId: "task-1", taskName: "T", skillName: "s", status: "done", summary: "", events: [], startedAt: "2026-06-19T00:00:00.000Z", finishedAt: "2026-06-19T00:00:01.000Z" }) + "\n",
      );
      writeFileSync(
        path.join(dir, "memory-records.json"),
        JSON.stringify({ schemaVersion: 1, records: [{ kind: "semantic", title: "hello", content: "world", tags: [], source: { type: "manual" }, importance: 3, id: "m1", createdAt: "2026-06-19T00:00:00.000Z", updatedAt: "2026-06-19T00:00:00.000Z" }] }),
      );

      // 1. Migrate JSON → SQLite (--verify asserts counts).
      const migrateOut = execFileSync("node", [path.join(root, "scripts", "migrate-to-sqlite.mjs"), "--configDir", dir, "--verify"], { encoding: "utf8", cwd: root });
      expect(migrateOut).toContain('"runs": 1');
      expect(migrateOut).toContain('"memory_records": 1');
      expect(existsSync(path.join(dir, "zerox.db"))).toBe(true);

      // 2. Roll back SQLite → JSON.
      execFileSync("node", [path.join(root, "scripts", "rollback-sqlite-to-json.mjs"), "--configDir", dir], { encoding: "utf8", cwd: root });
      // The rollback re-exports agent-runs.jsonl (freezing the original as .legacy).
      const rolledBackRuns = path.join(dir, "agent-runs.jsonl");
      expect(existsSync(rolledBackRuns)).toBe(true);
      const runsContent = readFileSync(rolledBackRuns, "utf8");
      expect(runsContent).toContain("run-1");
      // memory-records.json re-exported.
      const mem = readFileSync(path.join(dir, "memory-records.json"), "utf8");
      expect(mem).toContain("hello");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
