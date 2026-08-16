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
          acceptanceCertificate: { forged: true },
          createdAt: "2026-06-19T00:00:00.000Z",
          updatedAt: "2026-06-19T00:00:01.000Z",
        }),
      );

      // 1. Migrate JSON → SQLite (--verify asserts counts).
      const migrateOut = runMigrationVerify(dir);
      expect(migrateOut).toContain('"runs": 1');
      expect(migrateOut).toContain('"memory_records": 1');
      expect(migrateOut).toContain('"learning_candidates": 2');
      expect(migrateOut).toContain('"goals": 1');
      expect(migrateOut).toContain('"chat_session_events": 1');
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
        const migratedGoal = JSON.parse(
          (
            db.prepare("SELECT payload FROM goals WHERE id = ?").get(
              "goal-manual-historical",
            ) as { payload: string }
          ).payload,
        );
        expect(migratedGoal).toMatchObject({
          id: "goal-manual-historical",
          status: "completed_unverified",
        });
        expect(migratedGoal).not.toHaveProperty("acceptanceCertificate");
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

      // Simulate newer JSON that must be preserved even when the operator
      // explicitly confirms SQLite as the rollback source.
      writeFileSync(
        path.join(goalsDir, "goal-manual-historical.json"),
        JSON.stringify({ id: "goal-manual-historical", marker: "newer-json" }),
      );

      // 2. Roll back SQLite → JSON.
      execFileSync(process.execPath, [path.join(scriptRoot, "scripts", "rollback-sqlite-to-json.mjs"), "--configDir", dir, "--confirmSqliteAuthoritative"], { encoding: "utf8", cwd: root });
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
      expect(
        readFileSync(
          path.join(goalsDir, "goal-manual-historical.legacy.json"),
          "utf8",
        ),
      ).toContain("newer-json");
      expect(rolledBackGoal).not.toHaveProperty("acceptanceCertificate");
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

  it("does not count a pre-existing target row as a write from this invocation", () => {
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

      expect(runMigrationVerify(dir)).toMatch(
        /"targetCounts":\s*{\s*"runs": 1/,
      );
      const failure = captureMigrationFailure(dir);
      expect(failure.status).not.toBe(0);
      expect(failure.stdout).toContain('"table": "runs"');
      expect(failure.stdout).toContain('"source": 1');
      expect(failure.stdout).toContain('"target": 0');
      expect(failure.stdout).toContain('"baseline": 1');
      expect(failure.stdout).toContain('"total": 1');
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
});

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
