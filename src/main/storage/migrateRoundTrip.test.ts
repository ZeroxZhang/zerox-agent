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
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { existsSync as exists } from "node:fs";
import Database from "better-sqlite3";

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
      writeFileSync(
        path.join(dir, "agent-workspaces.json"),
        JSON.stringify({ schemaVersion: 1, workspaces: [{ id: "workspace_1", name: "Project", rootPath: dir, kind: "project", cleanup: "keep", createdAt: "2026-06-19T00:00:00.000Z", updatedAt: "2026-06-19T00:00:00.000Z", lastUsedAt: null }] }),
      );
      writeFileSync(
        path.join(dir, "scheduled-tasks.json"),
        JSON.stringify({ schemaVersion: 1, tasks: [{ id: "task_1", name: "Disabled daily", skillName: "noop", enabled: false, schedule: { kind: "daily", time: "09:30" }, input: {}, permissions: { filesystem: "read_only", network: "none", shell: "none", mcpServers: [] }, createdAt: "2026-06-19T00:00:00.000Z", updatedAt: "2026-06-19T00:00:00.000Z", lastRunAt: null, nextRunAt: null }] }),
      );
      mkdirSync(path.join(dir, "tool-result-refs"), { recursive: true });
      writeFileSync(path.join(dir, "tool-result-refs", "tool_ref_1.json"), "raw tool output");
      writeFileSync(
        path.join(dir, "agent-learning-candidates.json"),
        JSON.stringify({
          schemaVersion: 1,
          candidates: [
            { id: "learn_accepted", type: "failure_lesson", sourceRunId: "run-1", sourceTrajectoryEventIds: ["evt-1"], claim: "Accepted claim", recommendedAction: "Keep the fix", risk: "low", status: "accepted", createdAt: "2026-06-19T00:00:02.000Z", updatedAt: "2026-06-19T00:00:03.000Z" },
            { id: "learn_rejected", type: "procedural_memory", sourceRunId: "run-1", sourceTrajectoryEventIds: ["evt-2"], claim: "Rejected claim", recommendedAction: "Do not keep", risk: "medium", status: "rejected", createdAt: "2026-06-19T00:00:04.000Z", updatedAt: "2026-06-19T00:00:05.000Z" },
          ],
        }),
      );
      writeFileSync(
        path.join(dir, "agent-eval-candidates.json"),
        JSON.stringify({ schemaVersion: 1, candidates: [{ id: "eval_1", sourceRunId: "run-1", status: "accepted", rationale: "good", fixture: { id: "fixture_1", description: "d", events: [], requiredEventTypes: [] }, createdAt: "2026-06-19T00:00:00.000Z", updatedAt: "2026-06-19T00:00:00.000Z" }] }),
      );
      writeFileSync(
        path.join(dir, "agent-promoted-eval-fixtures.json"),
        JSON.stringify({ schemaVersion: 1, fixtures: [{ id: "promoted_1", description: "promoted", events: [], requiredEventTypes: [] }] }),
      );
      const artifactPath = path.join(dir, "artifact.md");
      writeFileSync(artifactPath, "artifact");
      writeFileSync(
        `${artifactPath}.provenance.json`,
        JSON.stringify({ schemaVersion: 1, kind: "zerox.artifactProvenance", runId: "run-1", artifactId: "artifact_1", artifactRef: "artifact:artifact_1", source: { type: "tool" }, destination: { path: artifactPath, sha256: "sha", sizeBytes: 8 }, generatedAt: "2026-06-19T00:00:00.000Z" }),
      );

      // 1. Migrate JSON → SQLite (--verify asserts counts).
      const migrateOut = execFileSync("node", [path.join(root, "scripts", "migrate-to-sqlite.mjs"), "--configDir", dir, "--verify"], { encoding: "utf8", cwd: root });
      expect(migrateOut).toContain('"runs": 1');
      expect(migrateOut).toContain('"memory_records": 1');
      expect(migrateOut).toContain('"learning_candidates": 2');
      expect(existsSync(path.join(dir, "zerox.db"))).toBe(true);
      const db = new Database(path.join(dir, "zerox.db"), { readonly: true });
      try {
        const migratedLearning = db
          .prepare("SELECT payload FROM learning_candidates ORDER BY id ASC")
          .all()
          .map((row) => JSON.parse((row as { payload: string }).payload));
        expect(migratedLearning).toEqual([
          expect.objectContaining({
            id: "learn_accepted",
            status: "accepted",
            createdAt: "2026-06-19T00:00:02.000Z",
            updatedAt: "2026-06-19T00:00:03.000Z",
            claim: "Accepted claim",
            sourceTrajectoryEventIds: ["evt-1"],
            recommendedAction: "Keep the fix",
          }),
          expect.objectContaining({
            id: "learn_rejected",
            status: "rejected",
            createdAt: "2026-06-19T00:00:04.000Z",
            updatedAt: "2026-06-19T00:00:05.000Z",
            claim: "Rejected claim",
            sourceTrajectoryEventIds: ["evt-2"],
            recommendedAction: "Do not keep",
          }),
        ]);
      } finally {
        db.close();
      }

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
      expect(readFileSync(path.join(dir, "agent-workspaces.json"), "utf8")).toContain("workspace_1");
      expect(readFileSync(path.join(dir, "scheduled-tasks.json"), "utf8")).toContain("task_1");
      expect(readFileSync(path.join(dir, "tool-result-refs", "tool_ref_1.json"), "utf8")).toBe("raw tool output");
      const learning = JSON.parse(readFileSync(path.join(dir, "agent-learning-candidates.json"), "utf8"));
      expect(learning.candidates).toEqual([
        expect.objectContaining({ id: "learn_accepted", status: "accepted" }),
        expect.objectContaining({ id: "learn_rejected", status: "rejected" }),
      ]);
      expect(readFileSync(path.join(dir, "agent-eval-candidates.json"), "utf8")).toContain("eval_1");
      expect(readFileSync(path.join(dir, "agent-promoted-eval-fixtures.json"), "utf8")).toContain("promoted_1");
      expect(readFileSync(`${artifactPath}.provenance.json`, "utf8")).toContain("artifact_1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
