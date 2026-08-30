// P1 migration script round-trip test.
//
// The migrate-to-sqlite / rollback-sqlite-to-json scripts import compiled
// dist-electron modules, so they run as real child processes (not vitest
// in-process). This test creates a fresh temporary script root, compiles the
// current source tree into that root, then runs copied migration scripts from
// there. That keeps script behavior realistic without depending on whatever
// repository-level dist-electron happens to contain.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import Database from "better-sqlite3";

const root = path.resolve(__dirname, "..", "..", "..");
let scriptRoot: string;

function createFreshMigrationScriptRoot(): string {
  const scriptRoot = mkdtempSync(path.join(tmpdir(), "zerox-mig-scripts-"));
  const scriptsDir = path.join(scriptRoot, "scripts");
  mkdirSync(scriptsDir, { recursive: true });
  symlinkSync(path.join(root, "node_modules"), path.join(scriptRoot, "node_modules"), "dir");
  copyFileSync(path.join(root, "scripts", "migrate-to-sqlite.mjs"), path.join(scriptsDir, "migrate-to-sqlite.mjs"));
  copyFileSync(path.join(root, "scripts", "rollback-sqlite-to-json.mjs"), path.join(scriptsDir, "rollback-sqlite-to-json.mjs"));
  execFileSync(process.execPath, [
    path.join(root, "node_modules", "typescript", "bin", "tsc"),
    "-p",
    path.join(root, "tsconfig.electron.json"),
    "--outDir",
    path.join(scriptRoot, "dist-electron"),
  ], { cwd: root, encoding: "utf8" });
  expect(existsSync(path.join(scriptRoot, "dist-electron", "main", "storage", "storageDb.js"))).toBe(true);
  return scriptRoot;
}

describe("P1 migration scripts round-trip", () => {
  beforeAll(() => {
    scriptRoot = createFreshMigrationScriptRoot();
  }, 20_000);

  afterAll(() => {
    rmSync(scriptRoot, { recursive: true, force: true });
  });

  it("refuses to overwrite authoritative JSON without explicit SQLite confirmation", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "zerox-rollback-guard-"));
    try {
      expect(() =>
        execFileSync(
          process.execPath,
          [path.join(root, "scripts", "rollback-sqlite-to-json.mjs"), "--configDir", dir],
          { encoding: "utf8", cwd: root, stdio: "pipe" },
        ),
      ).toThrow(/refusing rollback export/);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

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
        path.join(dir, "multi-agent-sessions.json"),
        JSON.stringify({
          schemaVersion: 1,
          sessions: [
            {
              id: "multi_session_1",
              title: "Migration session",
              rootRunId: "run-1",
              status: "paused",
              workspaceId: "workspace_1",
              childRunIds: ["run-child-1"],
              roles: { "run-child-1": "reviewer" },
              createdAt: "2026-06-19T00:00:00.000Z",
              updatedAt: "2026-06-19T00:00:02.000Z",
            },
          ],
        }),
      );
      writeFileSync(
        path.join(dir, "scheduled-tasks.json"),
        JSON.stringify({ schemaVersion: 1, tasks: [{ id: "task_1", name: "Disabled daily", skillName: "noop", enabled: false, schedule: { kind: "daily", time: "09:30" }, input: {}, permissions: { filesystem: "read_only", network: "none", shell: "none", mcpServers: [] }, createdAt: "2026-06-19T00:00:00.000Z", updatedAt: "2026-06-19T00:00:00.000Z", lastRunAt: null, nextRunAt: null }] }),
      );
      writeFileSync(
        path.join(dir, "chat-sessions.json"),
        JSON.stringify({
          schemaVersion: 1,
          sessions: [
            {
              id: "chat_1",
              title: "Migration chat",
              summary: "hello",
              messages: [
                {
                  id: "message_1",
                  role: "user",
                  content: "hello",
                  createdAt: "2026-06-19T00:00:00.000Z",
                },
                {
                  id: "message_2",
                  role: "assistant",
                  content: "world",
                  createdAt: "2026-06-19T00:00:01.000Z",
                },
              ],
              createdAt: "2026-06-19T00:00:00.000Z",
              updatedAt: "2026-06-19T00:00:01.000Z",
            },
          ],
        }),
      );
      mkdirSync(path.join(dir, "tool-result-refs"), { recursive: true });
      writeFileSync(path.join(dir, "tool-result-refs", "tool_ref_1.json"), "raw tool output");
      mkdirSync(path.join(dir, "workspace-runs"), { recursive: true });
      writeFileSync(
        path.join(dir, "workspace-runs", "runs.jsonl"),
        '{"workspaceRunId":"workspace_run_1"}\n',
      );
      writeFileSync(
        path.join(dir, "raw-history.jsonl"),
        '{"id":"history_1","content":"raw evidence"}\n',
      );
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
      const goalsDir = path.join(dir, "agent-goals");
      mkdirSync(goalsDir, { recursive: true });
      writeFileSync(
        path.join(goalsDir, "goal-manual-historical.json"),
        JSON.stringify({
          id: "goal-manual-historical",
          description: "Historical manual completion",
          successCriteria: [],
          milestones: [],
          status: "completed_unverified",
          budget: {},
          executionUsage: {},
          reviewPolicy: "review_final_only",
          planVersion: 1,
          selectedSkill: createPrivateP97SkillSnapshot(),
          acceptanceCertificate: { forged: true },
          createdAt: "2026-06-19T00:00:00.000Z",
          updatedAt: "2026-06-19T00:00:01.000Z",
        }),
      );
      writeFileSync(
        path.join(goalsDir, "goal-manual-historical.ledger.jsonl"),
        `${JSON.stringify({
          at: "2026-06-19T00:00:01.000Z",
          kind: "goal_completed",
          summary: "Historical completion retained.",
        })}\n`,
      );
      const executionsDir = path.join(dir, "agent-executions");
      mkdirSync(executionsDir, { recursive: true });
      writeFileSync(
        path.join(executionsDir, "run-checkpoint-1.json"),
        JSON.stringify({
          id: "checkpoint_1",
          runId: "run-checkpoint-1",
          taskId: "task_1",
          status: "paused",
          currentStepId: "step_1",
          steps: [],
          messages: [],
          toolCallCount: 1,
          createdAt: "2026-06-19T00:00:00.000Z",
          updatedAt: "2026-06-19T00:00:03.000Z",
        }),
      );
      const plansDir = path.join(dir, "plans");
      mkdirSync(plansDir, { recursive: true });
      const plan = {
        id: "plan_1",
        sessionId: "chat_1",
        sourceMessage: "Plan migration",
        mode: "direct",
        status: "awaiting_confirmation",
        actionGate: "ready",
        revision: 1,
        createdAt: "2026-06-19T00:00:00.000Z",
        updatedAt: "2026-06-19T00:00:01.000Z",
      };
      const planEvent = {
        id: "plan_event_1",
        planId: "plan_1",
        type: "plan_created",
        revision: 1,
        createdAt: "2026-06-19T00:00:00.000Z",
      };
      writeFileSync(
        path.join(plansDir, "plan_1.json"),
        JSON.stringify(plan),
      );
      writeFileSync(
        path.join(plansDir, "plan_1.events.jsonl"),
        `${JSON.stringify(planEvent)}\n`,
      );

      // 1. Migrate JSON → SQLite (--verify asserts counts).
      const migrateOut = runMigrationVerify(dir);
      expect(migrateOut).toContain('"runs": 1');
      expect(migrateOut).toContain('"plan_records": 1');
      expect(migrateOut).toContain('"memory_records": 1');
      expect(migrateOut).toContain('"workspaces": 1');
      expect(migrateOut).toContain('"multi_agent_sessions": 1');
      expect(migrateOut).toContain('"learning_candidates": 2');
      expect(migrateOut).toContain('"eval_candidates": 1');
      expect(migrateOut).toContain('"promoted_eval_fixtures": 1');
      expect(migrateOut).toContain('"goals": 1');
      expect(migrateOut).toContain('"goal_ledger": 1');
      expect(migrateOut).toContain('"runtime_checkpoints": 1');
      expect(migrateOut).toContain('"chat_session_events": 1');
      expect(migrateOut).toContain('"goal.id + ledger sequence"');
      expect(migrateOut).toContain('"workspace_run_ledger"');
      expect(existsSync(path.join(dir, "zerox.db"))).toBe(true);
      const db = new Database(path.join(dir, "zerox.db"), { readonly: true });
      try {
        expect(
          db.prepare("SELECT COUNT(*) AS count FROM memory_records").get(),
        ).toEqual({ count: 1 });
        expect(
          db.prepare("SELECT COUNT(*) AS count FROM learning_candidates").get(),
        ).toEqual({ count: 2 });
        expect(
          db.prepare("SELECT COUNT(*) AS count FROM goals").get(),
        ).toEqual({ count: 1 });
        expect(
          db.prepare("SELECT COUNT(*) AS count FROM goal_ledger").get(),
        ).toEqual({ count: 1 });
        expect(
          db
            .prepare(
              "SELECT COUNT(*) AS count FROM checkpoints WHERE kind = 'runtime'",
            )
            .get(),
        ).toEqual({ count: 1 });
        expect(
          db.prepare("SELECT COUNT(*) AS count FROM workspaces").get(),
        ).toEqual({ count: 1 });
        expect(
          db
            .prepare(
              "SELECT COUNT(*) AS count FROM sessions WHERE kind = 'multi_agent'",
            )
            .get(),
        ).toEqual({ count: 1 });
        expect(
          db.prepare("SELECT COUNT(*) AS count FROM eval_candidates").get(),
        ).toEqual({ count: 1 });
        expect(
          db
            .prepare("SELECT COUNT(*) AS count FROM promoted_eval_fixtures")
            .get(),
        ).toEqual({ count: 1 });
        expect(
          db.prepare("SELECT COUNT(*) AS count FROM tool_results").get(),
        ).toEqual({ count: 0 });
        expect(
          db.prepare("SELECT COUNT(*) AS count FROM artifacts").get(),
        ).toEqual({ count: 0 });
        const migratedGoal = JSON.parse(
          (
            db
              .prepare("SELECT payload FROM goals WHERE id = ?")
              .get("goal-manual-historical") as { payload: string }
          ).payload,
        ) as Record<string, unknown>;
        expect(migratedGoal.status).toBe("completed_unverified");
        expect(migratedGoal).not.toHaveProperty("acceptanceCertificate");
        expect(JSON.stringify(migratedGoal)).not.toContain(
          "P97_PRIVATE_SECRET",
        );
        expect(
          db.prepare("SELECT payload FROM plan_records WHERE id = ?").get(
            "plan_1",
          ),
        ).toEqual({ payload: JSON.stringify(plan) });
        expect(
          db.prepare("SELECT type FROM plan_events WHERE id = ?").get(
            "plan_event_1",
          ),
        ).toEqual({ type: "plan_created" });
        expect(
          db
            .prepare(
              "SELECT message_count, watermark FROM chat_session_projections WHERE session_id = ?",
            )
            .get("chat_1"),
        ).toEqual({ message_count: 2, watermark: 1 });
      } finally {
        db.close();
      }

      // Explicit rollback confirmation replaces stale JSON and preserves it as
      // one directory backup while exporting canonical SQLite authority.
      writeFileSync(
        path.join(goalsDir, "goal-manual-historical.json"),
        JSON.stringify({ id: "goal-manual-historical", marker: "stale-json" }),
      );

      // 2. Roll back SQLite → JSON.
      const rollbackOut = execFileSync(process.execPath, [path.join(scriptRoot, "scripts", "rollback-sqlite-to-json.mjs"), "--configDir", dir, "--confirmSqliteAuthoritative", "--planBackend", "sqlite"], { encoding: "utf8", cwd: root });
      expect(rollbackOut).toContain('"execution_checkpoint"');
      expect(rollbackOut).toContain('"promoted_eval_fixture"');
      const rolledBackDb = new Database(path.join(dir, "zerox.db"), {
        readonly: true,
      });
      try {
        expect(
          rolledBackDb
            .prepare(
              `SELECT COUNT(*) AS count
                 FROM domain_authority_state
                WHERE source = 'json_rollback'`,
            )
            .get(),
        ).toEqual({ count: 8 });
      } finally {
        rolledBackDb.close();
      }
      // The rollback re-exports agent-runs.jsonl (freezing the original as .legacy).
      const rolledBackRuns = path.join(dir, "agent-runs.jsonl");
      expect(existsSync(rolledBackRuns)).toBe(true);
      const runsContent = readFileSync(rolledBackRuns, "utf8");
      expect(runsContent).toContain("run-1");
      // memory-records.json re-exported.
      const mem = readFileSync(path.join(dir, "memory-records.json"), "utf8");
      expect(mem).toContain("hello");
      expect(readFileSync(path.join(dir, "agent-workspaces.json"), "utf8")).toContain("workspace_1");
      expect(readFileSync(path.join(dir, "multi-agent-sessions.json"), "utf8")).toContain("multi_session_1");
      expect(readFileSync(path.join(executionsDir, "run-checkpoint-1.json"), "utf8")).toContain("checkpoint_1");
      expect(readFileSync(path.join(dir, "scheduled-tasks.json"), "utf8")).toContain("task_1");
      const rolledBackChat = JSON.parse(
        readFileSync(path.join(dir, "chat-sessions.json"), "utf8"),
      );
      expect(rolledBackChat.sessions).toEqual([
        expect.objectContaining({
          id: "chat_1",
          messages: [
            expect.objectContaining({ id: "message_1", content: "hello" }),
            expect.objectContaining({ id: "message_2", content: "world" }),
          ],
        }),
      ]);
      expect(readFileSync(path.join(dir, "tool-result-refs", "tool_ref_1.json"), "utf8")).toBe("raw tool output");
      expect(readFileSync(path.join(dir, "workspace-runs", "runs.jsonl"), "utf8")).toContain("workspace_run_1");
      expect(readFileSync(path.join(dir, "raw-history.jsonl"), "utf8")).toContain("history_1");
      const learning = JSON.parse(readFileSync(path.join(dir, "agent-learning-candidates.json"), "utf8"));
      expect(learning.candidates).toEqual([
        expect.objectContaining({ id: "learn_accepted", status: "accepted" }),
        expect.objectContaining({ id: "learn_rejected", status: "rejected" }),
      ]);
      expect(readFileSync(path.join(dir, "agent-eval-candidates.json"), "utf8")).toContain("eval_1");
      expect(readFileSync(path.join(dir, "agent-promoted-eval-fixtures.json"), "utf8")).toContain("promoted_1");
      expect(readFileSync(`${artifactPath}.provenance.json`, "utf8")).toContain("artifact_1");
      const rolledBackGoal = JSON.parse(
        readFileSync(
          path.join(goalsDir, "goal-manual-historical.json"),
          "utf8",
        ),
      );
      expect(rolledBackGoal).toMatchObject({
        id: "goal-manual-historical",
        status: "completed_unverified",
      });
      expect(rolledBackGoal).not.toHaveProperty("acceptanceCertificate");
      expect(JSON.stringify(rolledBackGoal)).not.toContain(
        "P97_PRIVATE_SECRET",
      );
      expect(
        readFileSync(
          path.join(
            goalsDir,
            "goal-manual-historical.ledger.jsonl",
          ),
          "utf8",
        ),
      ).toContain("Historical completion retained.");
      expect(
        existsSync(
          path.join(
            dir,
            "agent-goals.legacy",
            "goal-manual-historical.json",
          ),
        ),
      ).toBe(true);
      expect(
        readFileSync(
          path.join(
            dir,
            "agent-goals.legacy",
            "goal-manual-historical.json",
          ),
          "utf8",
        ),
      ).toContain("stale-json");
      expect(
        JSON.parse(
          readFileSync(path.join(plansDir, "plan_1.json"), "utf8"),
        ),
      ).toEqual(plan);
      expect(
        readFileSync(
          path.join(plansDir, "plan_1.events.jsonl"),
          "utf8",
        ),
      ).toContain("plan_event_1");

      const stableP97Paths = [
        "agent-goals/goal-manual-historical.json",
        "agent-goals/goal-manual-historical.ledger.jsonl",
        "agent-executions/run-checkpoint-1.json",
        "memory-records.json",
        "agent-workspaces.json",
        "multi-agent-sessions.json",
        "agent-learning-candidates.json",
        "agent-eval-candidates.json",
        "agent-promoted-eval-fixtures.json",
      ];
      const firstExport = new Map(
        stableP97Paths.map((relativePath) => [
          relativePath,
          readFileSync(path.join(dir, relativePath), "utf8"),
        ]),
      );
      execFileSync(
        process.execPath,
        [
          path.join(
            scriptRoot,
            "scripts",
            "rollback-sqlite-to-json.mjs",
          ),
          "--configDir",
          dir,
          "--confirmSqliteAuthoritative",
          "--planBackend",
          "sqlite",
        ],
        { encoding: "utf8", cwd: root },
      );
      for (const [relativePath, content] of firstExport) {
        expect(readFileSync(path.join(dir, relativePath), "utf8")).toBe(
          content,
        );
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);

  it("does not complete Chat bootstrap when legacy JSON is corrupt", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "zerox-mig-corrupt-chat-"));
    try {
      writeFileSync(path.join(dir, "chat-sessions.json"), "{not-json");

      execFileSync(
        process.execPath,
        [
          path.join(scriptRoot, "scripts", "migrate-to-sqlite.mjs"),
          "--configDir",
          dir,
        ],
        { encoding: "utf8", cwd: root },
      );

      const db = new Database(path.join(dir, "zerox.db"), { readonly: true });
      try {
        expect(
          db
            .prepare(
              "SELECT value FROM chat_store_metadata WHERE key = 'legacy_json_import'",
            )
            .get(),
        ).toBeUndefined();
      } finally {
        db.close();
      }
      expect(
        readFileSync(path.join(dir, "migration-errors.jsonl"), "utf8"),
      ).toMatch(/sessions.*parse failed/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails --verify when a JSONL source row cannot be parsed", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "zerox-mig-parse-loss-"));
    try {
      writeFileSync(
        path.join(dir, "agent-runs.jsonl"),
        [
          JSON.stringify({
            id: "run_valid",
            taskId: "task_1",
            taskName: "Task",
            skillName: "skill",
            status: "succeeded",
            summary: "done",
            events: [],
            startedAt: "2026-08-16T00:00:00.000Z",
            finishedAt: "2026-08-16T00:00:01.000Z",
          }),
          '{"id":"run_truncated"',
          "",
        ].join("\n"),
      );

      const failure = captureMigrationFailure(dir);
      expect(failure.status).not.toBe(0);
      expect(failure.stdout).toContain('"sourceCounts"');
      expect(failure.stdout).toContain('"parse": 1');
      expect(failure.stdout).toContain('"table": "runs"');
      expect(
        readFileSync(path.join(dir, "migration-errors.jsonl"), "utf8"),
      ).toContain('"kind":"parse"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails --verify when a parsed source row cannot be written", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "zerox-mig-write-loss-"));
    try {
      writeFileSync(
        path.join(dir, "agent-runs.jsonl"),
        `${JSON.stringify({
          id: "run_invalid",
          taskId: null,
          taskName: "Invalid",
          skillName: "skill",
          status: "succeeded",
          summary: "must fail",
          events: [],
          startedAt: "2026-08-16T00:00:00.000Z",
          finishedAt: "2026-08-16T00:00:01.000Z",
        })}\n`,
      );

      const failure = captureMigrationFailure(dir);
      expect(failure.status).not.toBe(0);
      expect(failure.stdout).toContain('"write": 1');
      expect(failure.stdout).toContain('"source": 1');
      expect(failure.stdout).toContain('"target": 0');
      expect(
        readFileSync(path.join(dir, "migration-errors.jsonl"), "utf8"),
      ).toContain('"kind":"write"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not publish authority markers before canonical verification passes", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "zerox-mig-marker-gate-"));
    try {
      const baseMemory = {
        id: "memory_duplicate",
        kind: "semantic",
        title: "Duplicate identity",
        tags: [],
        source: { type: "manual" },
        importance: 3,
        createdAt: "2026-08-16T00:00:00.000Z",
      };
      writeFileSync(
        path.join(dir, "memory-records.json"),
        JSON.stringify({
          schemaVersion: 1,
          records: [
            {
              ...baseMemory,
              content: "older",
              updatedAt: "2026-08-16T00:00:01.000Z",
            },
            {
              ...baseMemory,
              content: "newer",
              updatedAt: "2026-08-16T00:00:02.000Z",
            },
          ],
        }),
      );

      const failure = captureMigrationFailure(dir);
      expect(failure.status).not.toBe(0);
      expect(failure.stdout).toContain(
        "MISMATCH (source=2, unique=1, canonical=1)",
      );
      const db = new Database(path.join(dir, "zerox.db"), { readonly: true });
      try {
        expect(
          db
            .prepare("SELECT COUNT(*) AS count FROM domain_authority_state")
            .get(),
        ).toEqual({ count: 0 });
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps consecutive --verify runs idempotent and fail-closed", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "zerox-mig-preexisting-"));
    try {
      writeFileSync(
        path.join(dir, "agent-runs.jsonl"),
        `${JSON.stringify({
          id: "run_preexisting",
          taskId: "task_1",
          taskName: "Task",
          skillName: "skill",
          status: "succeeded",
          summary: "done",
          events: [],
          startedAt: "2026-08-16T00:00:00.000Z",
          finishedAt: "2026-08-16T00:00:01.000Z",
        })}\n`,
      );
      seedP97Fixture(dir);

      expect(runMigrationVerify(dir)).toMatch(
        /"targetCounts":\s*{\s*"runs": 1/,
      );
      const second = runMigrationVerify(dir);
      expect(second).toMatch(/"targetCounts":\s*{\s*"runs": 1/);
      for (const table of [
        "goals",
        "goal_ledger",
        "runtime_checkpoints",
        "memory_records",
        "workspaces",
        "multi_agent_sessions",
        "learning_candidates",
        "eval_candidates",
        "promoted_eval_fixtures",
      ]) {
        expect(second).toContain(`"${table}": 1`);
      }
      expect(second).toContain('"mismatches": []');
      expect(second).toContain('"parse": 0');
      expect(second).toContain('"write": 0');
      const db = new Database(path.join(dir, "zerox.db"), { readonly: true });
      try {
        expect(
          db.prepare("SELECT COUNT(*) AS count FROM goal_ledger").get(),
        ).toEqual({ count: 1 });
        expect(
          db
            .prepare(
              "SELECT COUNT(*) AS count FROM checkpoints WHERE kind = 'runtime'",
            )
            .get(),
        ).toEqual({ count: 1 });
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("bootstraps SQLite from the latest revision > 1 AgentRun snapshot", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "zerox-mig-run-revision-"));
    try {
      const paused = {
        id: "run_revisioned",
        taskId: "task_revisioned",
        taskName: "Revisioned task",
        skillName: "prompt-task",
        status: "paused",
        executionRevision: 1,
        summary: "paused",
        events: [],
        startedAt: "2026-08-24T00:00:00.000Z",
        finishedAt: "2026-08-24T00:00:01.000Z",
      };
      const terminal = {
        ...paused,
        status: "succeeded",
        executionRevision: 2,
        summary: "resumed and completed",
        finishedAt: "2026-08-24T00:00:02.000Z",
      };
      writeFileSync(
        path.join(dir, "agent-runs.jsonl"),
        `${JSON.stringify(paused)}\n${JSON.stringify(terminal)}\n`,
      );

      expect(runMigrationVerify(dir)).toMatch(
        /"targetCounts":\s*{\s*"runs": 1/,
      );
      expect(runMigrationVerify(dir)).toContain('"write": 0');

      const db = new Database(path.join(dir, "zerox.db"), { readonly: true });
      try {
        const row = db
          .prepare("SELECT payload FROM runs WHERE id = ?")
          .get(terminal.id) as { payload: string };
        expect(JSON.parse(row.payload)).toEqual(terminal);
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);

  it("rejects stale JSON when SQLite has a newer P97 generation", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "zerox-mig-generation-"));
    try {
      seedP97Fixture(dir);
      runMigrationVerify(dir);
      const db = new Database(path.join(dir, "zerox.db"));
      try {
        const row = db
          .prepare("SELECT payload FROM memory_records WHERE id = ?")
          .get("memory_p97") as { payload: string };
        const newer = {
          ...JSON.parse(row.payload),
          title: "Newer SQLite authority",
          updatedAt: "2026-08-16T23:00:00.000Z",
        };
        db.prepare(
          `UPDATE memory_records
              SET title = ?, payload = ?, updated_at = ?
            WHERE id = ?`,
        ).run(
          newer.title,
          JSON.stringify(newer),
          newer.updatedAt,
          newer.id,
        );
      } finally {
        db.close();
      }

      const failure = captureMigrationFailure(dir);
      expect(failure.status).not.toBe(0);
      expect(failure.stdout).toContain("mixed-generation conflict");
      expect(failure.stdout).toContain('"store": "memory_records"');
      const verifyDb = new Database(path.join(dir, "zerox.db"), {
        readonly: true,
      });
      try {
        expect(
          verifyDb
            .prepare("SELECT title FROM memory_records WHERE id = ?")
            .get("memory_p97"),
        ).toEqual({ title: "Newer SQLite authority" });
      } finally {
        verifyDb.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails canonical verify when a P97 repository write is injected to fail", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "zerox-mig-p97-write-"));
    try {
      execFileSync(
        process.execPath,
        [
          path.join(scriptRoot, "scripts", "migrate-to-sqlite.mjs"),
          "--configDir",
          dir,
        ],
        { encoding: "utf8", cwd: root },
      );
      const db = new Database(path.join(dir, "zerox.db"));
      try {
        db.exec(`
          CREATE TRIGGER reject_p97_memory
          BEFORE INSERT ON memory_records
          WHEN NEW.id = 'memory_p97'
          BEGIN
            SELECT RAISE(ABORT, 'injected P97 memory failure');
          END;
        `);
      } finally {
        db.close();
      }
      writeFileSync(
        path.join(dir, "memory-records.json"),
        JSON.stringify({
          schemaVersion: 1,
          records: [createP97Memory()],
        }),
      );

      const failure = captureMigrationFailure(dir);
      expect(failure.status).not.toBe(0);
      expect(failure.stdout).toContain('"table": "memory_records"');
      expect(
        readFileSync(path.join(dir, "migration-errors.jsonl"), "utf8"),
      ).toContain("injected P97 memory failure");
      const verifyDb = new Database(path.join(dir, "zerox.db"), {
        readonly: true,
      });
      try {
        expect(
          verifyDb
            .prepare("SELECT COUNT(*) AS count FROM memory_records")
            .get(),
        ).toEqual({ count: 0 });
      } finally {
        verifyDb.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("overwrites stale Chat JSON when authoritative SQLite is empty", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "zerox-rollback-empty-chat-"));
    try {
      execFileSync(
        process.execPath,
        [
          path.join(scriptRoot, "scripts", "migrate-to-sqlite.mjs"),
          "--configDir",
          dir,
        ],
        { encoding: "utf8", cwd: root },
      );
      writeFileSync(
        path.join(dir, "chat-sessions.json"),
        JSON.stringify({
          schemaVersion: 1,
          sessions: [{ id: "stale_chat", title: "stale" }],
        }),
      );

      execFileSync(
        process.execPath,
        [
          path.join(scriptRoot, "scripts", "rollback-sqlite-to-json.mjs"),
          "--configDir",
          dir,
          "--confirmSqliteAuthoritative",
        ],
        { encoding: "utf8", cwd: root },
      );

      expect(
        JSON.parse(
          readFileSync(path.join(dir, "chat-sessions.json"), "utf8"),
        ),
      ).toEqual({ schemaVersion: 1, sessions: [] });
      expect(
        readFileSync(
          path.join(dir, "chat-sessions.legacy.json"),
          "utf8",
        ),
      ).toContain("stale_chat");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exports mixed-generation Chat sessions and orphan trajectories", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "zerox-rollback-mixed-chat-"));
    const modernSession = {
      id: "chat_modern",
      title: "Modern",
      summary: "projected",
      messages: [],
      createdAt: "2026-06-19T00:00:00.000Z",
      updatedAt: "2026-06-19T00:00:01.000Z",
    };
    const legacySession = {
      id: "chat_legacy",
      title: "Legacy",
      summary: "generic row",
      messages: [],
      createdAt: "2026-06-19T00:00:02.000Z",
      updatedAt: "2026-06-19T00:00:03.000Z",
    };
    const legacyMessage = {
      id: "message_legacy",
      role: "user",
      content: "legacy message",
      createdAt: "2026-06-19T00:00:03.000Z",
    };
    const orphanEvent = {
      id: "event_orphan",
      runId: "run_orphan",
      type: "tool_call",
      sequence: 1,
      payload: { label: "orphan" },
      redaction: {
        containsApiKey: false,
        containsFileContent: false,
        containsUserText: false,
      },
      createdAt: "2026-06-19T00:00:04.000Z",
    };
    try {
      writeFileSync(
        path.join(dir, "chat-sessions.json"),
        JSON.stringify({
          schemaVersion: 1,
          sessions: [modernSession],
        }),
      );
      execFileSync(
        process.execPath,
        [
          path.join(scriptRoot, "scripts", "migrate-to-sqlite.mjs"),
          "--configDir",
          dir,
        ],
        { encoding: "utf8", cwd: root },
      );

      const db = new Database(path.join(dir, "zerox.db"));
      try {
        db.prepare(
          `INSERT INTO sessions
            (id, kind, title, payload, created_at, updated_at)
           VALUES (?, 'chat', ?, ?, ?, ?)`,
        ).run(
          legacySession.id,
          legacySession.title,
          JSON.stringify(legacySession),
          legacySession.createdAt,
          legacySession.updatedAt,
        );
        db.prepare(
          `INSERT INTO chat_messages
            (id, session_id, role, content, payload, created_at, seq)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          legacyMessage.id,
          legacySession.id,
          legacyMessage.role,
          legacyMessage.content,
          JSON.stringify(legacyMessage),
          legacyMessage.createdAt,
          1,
        );
        db.prepare(
          `INSERT INTO trajectory_events
            (id, run_id, seq, type, payload, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(
          orphanEvent.id,
          orphanEvent.runId,
          orphanEvent.sequence,
          orphanEvent.type,
          JSON.stringify(orphanEvent),
          orphanEvent.createdAt,
        );
      } finally {
        db.close();
      }

      execFileSync(
        process.execPath,
        [
          path.join(scriptRoot, "scripts", "rollback-sqlite-to-json.mjs"),
          "--configDir",
          dir,
          "--confirmSqliteAuthoritative",
        ],
        { encoding: "utf8", cwd: root },
      );

      const chat = JSON.parse(
        readFileSync(path.join(dir, "chat-sessions.json"), "utf8"),
      );
      expect(chat.sessions.map((session: { id: string }) => session.id)).toEqual([
        "chat_modern",
        "chat_legacy",
      ]);
      expect(
        chat.sessions.find(
          (session: { id: string }) => session.id === "chat_legacy",
        ).messages,
      ).toEqual([legacyMessage]);
      expect(
        readFileSync(
          path.join(
            dir,
            "agent-trajectories",
            "run_orphan.jsonl",
          ),
          "utf8",
        ),
      ).toContain("event_orphan");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("compensates a failed staged rollback without exposing mixed generations", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "zerox-rollback-compensate-"));
    const runsPath = path.join(dir, "agent-runs.jsonl");
    const chatPath = path.join(dir, "chat-sessions.json");
    try {
      writeFileSync(
        runsPath,
        `${JSON.stringify({
          id: "run_old",
          taskId: "task_1",
          taskName: "Old",
          skillName: "skill",
          status: "succeeded",
          summary: "old generation",
          events: [],
          startedAt: "2026-08-16T00:00:00.000Z",
          finishedAt: "2026-08-16T00:00:01.000Z",
        })}\n`,
      );
      writeFileSync(
        chatPath,
        JSON.stringify({ schemaVersion: 1, sessions: [] }),
      );
      seedP97Fixture(dir);
      runMigrationVerify(dir);
      const beforeRuns = readFileSync(runsPath, "utf8");
      const beforeChat = readFileSync(chatPath, "utf8");
      const preservedP97 = new Map(
        [
          "agent-goals/goal_p97.json",
          "agent-goals/goal_p97.ledger.jsonl",
          "agent-executions/run_p97.json",
          "memory-records.json",
          "agent-workspaces.json",
          "multi-agent-sessions.json",
          "agent-learning-candidates.json",
        ].map((relativePath) => [
          relativePath,
          readFileSync(path.join(dir, relativePath), "utf8"),
        ]),
      );

      expect(() =>
        execFileSync(
          process.execPath,
          [
            path.join(
              scriptRoot,
              "scripts",
              "rollback-sqlite-to-json.mjs",
            ),
            "--configDir",
            dir,
            "--confirmSqliteAuthoritative",
          ],
          {
            encoding: "utf8",
            cwd: root,
            stdio: "pipe",
            env: {
              ...process.env,
              NODE_ENV: "test",
              ZEROX_ROLLBACK_TEST_FAIL_AFTER_PUBLISH: "13",
            },
          },
        ),
      ).toThrow(/compensation completed/);

      expect(readFileSync(runsPath, "utf8")).toBe(beforeRuns);
      expect(readFileSync(chatPath, "utf8")).toBe(beforeChat);
      for (const [relativePath, content] of preservedP97) {
        expect(readFileSync(path.join(dir, relativePath), "utf8")).toBe(
          content,
        );
      }
      expect(existsSync(path.join(dir, "agent-trajectories"))).toBe(false);
      expect(
        readdirSync(dir).some((name) =>
          name.startsWith("rollback-recovery-")
        ),
      ).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function createPrivateP97SkillSnapshot() {
  return {
    rootDir: "/tmp/private-p97-skill",
    skillFile: "/tmp/private-p97-skill/SKILL.md",
    body: "# Private P97 Skill",
    manifest: {
      name: "private-p97-skill",
      description: "Exercises migration credential stripping.",
      execution: { mode: "agent", entrypoint: null },
      inputs: [],
      permissions: {
        files: { read: [], write: [] },
        shell: { commands: [] },
        web: { search: false, fetchDomains: [] },
        memory: { read: false, write: false },
      },
      mcpServers: [
        {
          name: "private-p97-server",
          transport: "stdio",
          command: "node",
          env: { PRIVATE_TOKEN: "P97_PRIVATE_SECRET" },
        },
      ],
    },
  };
}

function createP97Memory() {
  return {
    id: "memory_p97",
    kind: "semantic",
    title: "P97 memory",
    content: "Canonical storage convergence.",
    tags: ["p97"],
    source: { type: "manual" },
    importance: 4,
    createdAt: "2026-08-16T00:00:00.000Z",
    updatedAt: "2026-08-16T00:00:00.000Z",
  };
}

function seedP97Fixture(configDir: string): void {
  writeFileSync(
    path.join(configDir, "memory-records.json"),
    JSON.stringify({ schemaVersion: 1, records: [createP97Memory()] }),
  );
  writeFileSync(
    path.join(configDir, "agent-workspaces.json"),
    JSON.stringify({
      schemaVersion: 1,
      workspaces: [
        {
          id: "workspace_p97",
          name: "P97 workspace",
          rootPath: configDir,
          kind: "project",
          cleanup: "keep",
          createdAt: "2026-08-16T00:00:00.000Z",
          updatedAt: "2026-08-16T00:00:00.000Z",
          lastUsedAt: null,
        },
      ],
    }),
  );
  writeFileSync(
    path.join(configDir, "multi-agent-sessions.json"),
    JSON.stringify({
      schemaVersion: 1,
      sessions: [
        {
          id: "session_p97",
          title: "P97 session",
          rootRunId: "run_p97",
          status: "paused",
          workspaceId: "workspace_p97",
          childRunIds: ["run_child_p97"],
          roles: { run_child_p97: "reviewer" },
          createdAt: "2026-08-16T00:00:00.000Z",
          updatedAt: "2026-08-16T00:01:00.000Z",
        },
      ],
    }),
  );
  writeFileSync(
    path.join(configDir, "agent-learning-candidates.json"),
    JSON.stringify({
      schemaVersion: 1,
      candidates: [
        {
          id: "learning_p97",
          type: "failure_lesson",
          sourceRunId: "run_p97",
          sourceTrajectoryEventIds: ["event_p97"],
          claim: "Canonical import is verified.",
          recommendedAction: "Keep identity checks.",
          risk: "low",
          status: "accepted",
          createdAt: "2026-08-16T00:00:00.000Z",
          updatedAt: "2026-08-16T00:01:00.000Z",
        },
      ],
    }),
  );
  writeFileSync(
    path.join(configDir, "agent-eval-candidates.json"),
    JSON.stringify({
      schemaVersion: 1,
      candidates: [
        {
          id: "eval_p97",
          sourceRunId: "run_p97",
          status: "accepted",
          rationale: "P97 fixture",
          fixture: {
            id: "fixture_p97",
            description: "P97 candidate fixture",
            events: [],
            requiredEventTypes: [],
          },
          createdAt: "2026-08-16T00:00:00.000Z",
          updatedAt: "2026-08-16T00:01:00.000Z",
        },
      ],
    }),
  );
  writeFileSync(
    path.join(configDir, "agent-promoted-eval-fixtures.json"),
    JSON.stringify({
      schemaVersion: 1,
      fixtures: [
        {
          id: "promoted_p97",
          description: "P97 promoted fixture",
          events: [],
          requiredEventTypes: [],
        },
      ],
    }),
  );
  const goalsDir = path.join(configDir, "agent-goals");
  mkdirSync(goalsDir, { recursive: true });
  writeFileSync(
    path.join(goalsDir, "goal_p97.json"),
    JSON.stringify({
      id: "goal_p97",
      description: "P97 canonical Goal",
      successCriteria: [],
      milestones: [],
      status: "completed_unverified",
      budget: {},
      executionUsage: {},
      reviewPolicy: "review_final_only",
      planVersion: 1,
      acceptanceCertificate: { forged: true },
      createdAt: "2026-08-16T00:00:00.000Z",
      updatedAt: "2026-08-16T00:01:00.000Z",
    }),
  );
  writeFileSync(
    path.join(goalsDir, "goal_p97.ledger.jsonl"),
    '{"at":"2026-08-16T00:01:00.000Z","kind":"goal_completed","summary":"P97 Goal complete."}\n',
  );
  const executionsDir = path.join(configDir, "agent-executions");
  mkdirSync(executionsDir, { recursive: true });
  writeFileSync(
    path.join(executionsDir, "run_p97.json"),
    JSON.stringify({
      id: "checkpoint_p97",
      runId: "run_p97",
      taskId: "task_p97",
      status: "paused",
      currentStepId: "step_p97",
      steps: [],
      messages: [],
      toolCallCount: 1,
      createdAt: "2026-08-16T00:00:00.000Z",
      updatedAt: "2026-08-16T00:01:00.000Z",
    }),
  );
}

function captureMigrationFailure(configDir: string): {
  status: number | null;
  stdout: string;
} {
  try {
    execFileSync(
      process.execPath,
      [
        path.join(scriptRoot, "scripts", "migrate-to-sqlite.mjs"),
        "--configDir",
        configDir,
        "--verify",
      ],
      { encoding: "utf8", cwd: root, stdio: "pipe" },
    );
  } catch (error) {
    const failure = error as Error & {
      status: number | null;
      stdout: string;
    };
    return {
      status: failure.status,
      stdout: failure.stdout,
    };
  }
  throw new Error("Expected migration verification to fail.");
}

function runMigrationVerify(configDir: string): string {
  try {
    return execFileSync(
      process.execPath,
      [
        path.join(scriptRoot, "scripts", "migrate-to-sqlite.mjs"),
        "--configDir",
        configDir,
        "--verify",
      ],
      { encoding: "utf8", cwd: root, stdio: "pipe" },
    );
  } catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string };
    throw new Error(
      `Migration verification failed.\nstdout:\n${failure.stdout ?? ""}\nstderr:\n${failure.stderr ?? ""}`,
    );
  }
}
