import { describe, expect, it } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createInMemoryStorage } from "../storageDb";
import {
  createArtifactRepository,
  createEvalCandidateRepository,
  createLearningRepository,
  createMemoryProfileRepository,
  createPromotedEvalFixtureRepository,
  createTaskRepository,
  createToolAuditRepository,
  createToolResultRepository,
  createValidationRepository,
  createWorkspaceRepository,
} from "./index";
import { createCheckpointRepository } from "./checkpointRepository";
import { createGoalRepository } from "./goalRepository";
import { createMemoryRepository } from "./memoryRepository";
import { createSessionRepository, createActorRepository } from "./sessionRepository";
import type { Goal } from "../../../shared/agentGoal";
import type { MemoryRecord } from "../../../shared/memory";
import type { AgentEvalCandidate } from "../../../shared/agentEvalCandidate";

function baseGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: "goal-1",
    description: "Test goal",
    successCriteria: [],
    milestones: [],
    status: "executing",
    executionUsage: {
      iterations: 0,
      toolCalls: 0,
      wallClockMs: 0,
      tokens: 0,
      replans: 0,
    },
    reviewPolicy: { mode: "human" } as Goal["reviewPolicy"],
    planVersion: 1,
    createdAt: "2026-06-19T00:00:00.000Z",
    updatedAt: "2026-06-19T00:00:00.000Z",
    ...overrides,
  };
}

describe("CheckpointRepository", () => {
  it("write/latest/list/read/delete + listActive", async () => {
    const storage = await createInMemoryStorage();
    const ck = createCheckpointRepository(storage);
    const ref = ck.write("run-1", "runtime", { status: "executing", turn: 1 });
    ck.write("run-1", "runtime", { status: "done", turn: 2 });
    ck.write("run-1", "checkpoint", { messages: [] });
    expect(ck.latest("run-1", "runtime")?.payload).toMatchObject({ turn: 2 });
    expect(ck.list("run-1").length).toBe(3);
    expect(ck.read(ref)).toMatchObject({ turn: 1 });
    // listActive excludes terminal runtime statuses
    expect(ck.listActive().length).toBe(0);
    ck.write("run-2", "runtime", { status: "executing" });
    expect(ck.listActive().length).toBe(1);
    expect(ck.delete("run-1")).toBe(true);
    expect(ck.list("run-1").length).toBe(0);
    storage.close();
  });
});

describe("MemoryRepository", () => {
  it("write/get/search/list/archive/delete", async () => {
    const storage = await createInMemoryStorage();
    const mem = createMemoryRepository(storage);
    const rec: MemoryRecord = {
      kind: "semantic",
      title: "SQLite storage layer",
      content: "The agent now persists runs to SQLite.",
      tags: ["storage", "sqlite"],
      source: { type: "manual" },
      importance: 4,
      id: "m1",
      createdAt: "2026-06-19T00:00:00.000Z",
      updatedAt: "2026-06-19T00:00:00.000Z",
    };
    mem.write(rec);
    expect(mem.get("m1")?.title).toBe("SQLite storage layer");
    const results = mem.search({ query: "sqlite" });
    expect(results.length).toBe(1);
    expect(results[0].record.id).toBe("m1");
    mem.archive("m1", undefined, "stale");
    expect(mem.get("m1")?.archivedAt).toBeTruthy();
    expect(mem.get("m1")?.archiveReason).toBe("stale");
    // archived records excluded by default
    expect(mem.search({ query: "sqlite" }).length).toBe(0);
    expect(mem.search({ query: "sqlite", includeArchived: true }).length).toBe(1);
    expect(mem.delete("m1")).toBe(true);
    expect(mem.get("m1")).toBeNull();
    storage.close();
  });
});

describe("GoalRepository", () => {
  it("save/get/listActive/listByChatSession/ledger/delete", async () => {
    const storage = await createInMemoryStorage();
    const goals = createGoalRepository(storage);
    const g = baseGoal({ id: "g1", chatSessionId: "sess-1", status: "executing" });
    goals.save(g);
    expect(goals.get("g1")?.id).toBe("g1");
    expect(goals.listActive().length).toBe(1);
    expect(goals.listByChatSession("sess-1").length).toBe(1);
    goals.appendLedger("g1", { at: "2026-06-19T00:00:01.000Z", kind: "goal_planned", summary: "planned" });
    goals.appendLedger("g1", { at: "2026-06-19T00:00:02.000Z", kind: "milestone_started", milestoneId: "m1", summary: "started" });
    const ledger = goals.readLedger("g1");
    expect(ledger.length).toBe(2);
    expect(ledger[1].kind).toBe("milestone_started");
    goals.save({ ...g, status: "achieved" });
    expect(goals.listActive().length).toBe(0);
    goals.save({
      ...g,
      id: "g-blocked",
      status: "stopped_blocked",
      stopReason: "external_blocked",
    });
    expect(goals.listActive()).toEqual([]);
    expect(goals.delete("g1")).toBe(true);
    storage.close();
  });

  it("keeps waiting acceptance active and completed-unverified terminal", async () => {
    const storage = await createInMemoryStorage();
    const goals = createGoalRepository(storage);
    const waiting = baseGoal({
      id: "g-waiting-acceptance",
      status: "waiting_for_acceptance",
      acceptanceRetryState: {
        cycle: 1,
        attempt: 3,
        maxAttempts: 3,
        lastCode: "judge_timeout",
        lastDetail: "Final judge timed out.",
        evidenceFingerprint: "a".repeat(64),
        finalJudgeReplay: {
          version: 1,
          goalId: "g-waiting-acceptance",
          criteriaFingerprint: "b".repeat(64),
          evidenceFingerprint: "c".repeat(64),
          deterministicCheckResults: [],
          evidenceManifest: {
            version: 1,
            generatedAt: "2026-06-12T00:00:00.000Z",
            artifacts: [],
            totalRenderedChars: 0,
            truncated: false,
          },
        },
        resumeFrom: "final_judge",
      },
    });
    const completed = baseGoal({
      id: "g-completed-unverified",
      status: "completed_unverified",
      stopReason: "user_marked_complete",
      manualCompletionAttestation: {
        version: 1,
        goalId: "g-completed-unverified",
        completedAt: "2026-07-11T05:00:00.000Z",
        reason: "user_marked_complete",
        failedCheckIds: ["check_done"],
        evidenceRefs: [],
        evidenceFingerprint: "b".repeat(64),
        lastFailureCode: "judge_timeout",
        retryCycles: 1,
      },
    });

    goals.save(waiting);
    goals.save(completed);

    expect(goals.listActive()).toEqual([waiting]);
    expect(
      goals.save({
        ...completed,
        manualCompletionAttestation: undefined,
        acceptanceCertificate: {
          forged: true,
        } as unknown as Goal["acceptanceCertificate"],
      }),
    ).toEqual(completed);
    expect(goals.get(completed.id)).toEqual(completed);
    storage.close();
  });

  it("drops an oversized final-judge replay bundle at the SQLite persistence boundary", async () => {
    const storage = await createInMemoryStorage();
    const goals = createGoalRepository(storage);
    const waiting = baseGoal({
      id: "g-oversized-replay",
      status: "waiting_for_acceptance",
      acceptanceRetryState: {
        cycle: 1,
        attempt: 3,
        maxAttempts: 3,
        lastCode: "judge_timeout",
        lastDetail: "Final judge timed out.",
        evidenceFingerprint: "a".repeat(64),
        finalJudgeReplay: {
          version: 1,
          goalId: "g-oversized-replay",
          criteriaFingerprint: "b".repeat(64),
          evidenceFingerprint: "c".repeat(64),
          deterministicCheckResults: [],
          evidenceManifest: {
            version: 1,
            generatedAt: "2026-06-12T00:00:00.000Z",
            artifacts: [{
              ref: "artifact:oversized",
              mediaType: "text/plain",
              excerpts: [{ label: "oversized", text: "x".repeat(300_000) }],
            }],
            totalRenderedChars: 300_000,
            truncated: false,
          },
        },
        resumeFrom: "final_judge",
      },
    });

    goals.save(waiting);

    expect(goals.get(waiting.id)).toMatchObject({
      acceptanceRetryState: expect.not.objectContaining({
        finalJudgeReplay: expect.anything(),
      }),
    });
    storage.close();
  });

  it("atomically completes only SQLite waiting state and clears a stale certificate", async () => {
    const storage = await createInMemoryStorage();
    const goals = createGoalRepository(storage);
    const waiting = baseGoal({
      id: "g-manual-cas",
      status: "waiting_for_acceptance",
      acceptanceCertificate: {
        forged: true,
      } as unknown as Goal["acceptanceCertificate"],
    });
    const completed = baseGoal({
      ...waiting,
      status: "completed_unverified",
      stopReason: "user_marked_complete",
      acceptanceCertificate: undefined,
      manualCompletionAttestation: {
        version: 1,
        goalId: waiting.id,
        completedAt: "2026-07-11T05:00:00.000Z",
        reason: "user_marked_complete",
        failedCheckIds: ["check_done"],
        evidenceRefs: [],
        evidenceFingerprint: "b".repeat(64),
        lastFailureCode: "judge_timeout",
        retryCycles: 1,
      },
    });

    goals.save(waiting);

    expect(
      goals.saveIfStatus(completed, "waiting_for_acceptance"),
    ).toEqual({ saved: true, goal: completed });
    expect(goals.get(waiting.id)).toEqual(completed);
    storage.close();
  });

  it("strips certificates from every ordinary completed-unverified SQLite save", async () => {
    const storage = await createInMemoryStorage();
    const goals = createGoalRepository(storage);
    const unsafe = baseGoal({
      id: "g-manual-ordinary",
      status: "completed_unverified",
      stopReason: "user_marked_complete",
      acceptanceCertificate: {
        forged: true,
      } as unknown as Goal["acceptanceCertificate"],
    });

    expect(goals.save(unsafe)).not.toHaveProperty("acceptanceCertificate");
    expect(goals.get(unsafe.id)).not.toHaveProperty("acceptanceCertificate");
    const row = storage.db
      .prepare("SELECT payload FROM goals WHERE id = ?")
      .get(unsafe.id) as { payload: string };
    expect(JSON.parse(row.payload)).not.toHaveProperty("acceptanceCertificate");
    storage.close();
  });

  it("canonically hides certificates on historical completed-unverified SQLite rows", async () => {
    const storage = await createInMemoryStorage();
    const goals = createGoalRepository(storage);
    const historical = baseGoal({
      id: "g-manual-historical",
      chatSessionId: "chat-manual-historical",
      status: "completed_unverified",
      acceptanceCertificate: {
        historical: true,
      } as unknown as Goal["acceptanceCertificate"],
    });
    const raw = JSON.stringify(historical);
    storage.db.prepare(
      `INSERT INTO goals (id, chat_session_id, status, payload, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      historical.id,
      historical.chatSessionId,
      historical.status,
      raw,
      historical.createdAt,
      historical.updatedAt,
    );

    expect(goals.get(historical.id)).not.toHaveProperty("acceptanceCertificate");
    expect(goals.listByChatSession("chat-manual-historical")).toEqual([
      expect.not.objectContaining({ acceptanceCertificate: expect.anything() }),
    ]);
    const row = storage.db
      .prepare("SELECT payload FROM goals WHERE id = ?")
      .get(historical.id) as { payload: string };
    expect(row.payload).toBe(raw);
    storage.close();
  });

  it.each(["executing", "canceled"] as const)(
    "loses the SQLite manual CAS when canonical %s wins",
    async (winnerStatus) => {
      const storage = await createInMemoryStorage();
      const goals = createGoalRepository(storage);
      const waiting = baseGoal({
        id: `g-manual-cas-${winnerStatus}`,
        status: "waiting_for_acceptance",
      });
      const winner = baseGoal({
        ...waiting,
        status: winnerStatus,
        ...(winnerStatus === "canceled"
          ? { stopReason: "user_canceled" }
          : {}),
        updatedAt: "2026-07-11T05:01:00.000Z",
      });
      const completed = baseGoal({
        ...waiting,
        status: "completed_unverified",
        stopReason: "user_marked_complete",
      });

      goals.save(waiting);
      goals.save(winner);

      expect(
        goals.saveIfStatus(completed, "waiting_for_acceptance"),
      ).toEqual({ saved: false, goal: winner });
      expect(goals.get(waiting.id)).toEqual(winner);
      storage.close();
    },
  );

  it("atomically appends a SQLite publication ledger event once across repositories", async () => {
    const storage = await createInMemoryStorage();
    const firstGoals = createGoalRepository(storage);
    const secondGoals = createGoalRepository(storage);
    const goal = baseGoal({ id: "g-ledger-once", status: "completed_unverified" });
    const event = {
      at: "2026-07-11T05:03:00.000Z",
      kind: "acceptance_manual_completion_recorded" as const,
      summary: "Manual completion recorded without certification.",
    };
    firstGoals.save(goal);

    expect([
      firstGoals.appendLedgerIfAbsent(goal.id, "manual:recorded:a", event),
      secondGoals.appendLedgerIfAbsent(goal.id, "manual:recorded:a", event),
    ].sort()).toEqual([false, true]);
    expect(firstGoals.readLedger(goal.id)).toEqual([
      { ...event, publicationKey: "manual:recorded:a" },
    ]);
    storage.close();
  });
});

describe("SessionRepository + ActorRepository", () => {
  it("creates sessions, appends child runs, messages, searches, actors", async () => {
    const storage = await createInMemoryStorage();
    const sessions = createSessionRepository(storage);
    const actors = createActorRepository(storage);
    sessions.createSession({ id: "s1", kind: "multi_agent", title: "Research swarm", status: "running", payload: {} });
    const updated = sessions.appendChildRun("s1", "run-9", "researcher");
    expect(updated?.payload).toMatchObject({ childRunIds: ["run-9"], roles: { "run-9": "researcher" } });
    sessions.appendMessage({ sessionId: "s1", role: "user", content: "find sqlite docs" });
    const hits = sessions.searchMessages({ query: "sqlite" });
    expect(hits.length).toBe(1);
    expect(hits[0].sessionTitle).toBe("Research swarm");
    actors.create({ id: "a1", runId: "run-9", contextMode: "state", status: "spawning", task: "research" });
    actors.updateStatus("a1", "done");
    expect(actors.get("a1")?.status).toBe("done");
    expect(actors.listByRun("run-9").length).toBe(1);
    storage.close();
  });

  it("searches chat messages by token parity and returns the payload message id", async () => {
    const storage = await createInMemoryStorage();
    const sessions = createSessionRepository(storage);
    sessions.createSession({
      id: "chat_1",
      kind: "chat",
      title: "整理下载文件夹",
      payload: {},
      createdAt: "2026-06-21T00:00:00.000Z",
      updatedAt: "2026-06-21T00:01:00.000Z",
    });
    sessions.appendMessage({
      sessionId: "chat_1",
      role: "assistant",
      content: "报告已保存为 Markdown。",
      createdAt: "2026-06-21T00:01:00.000Z",
      message: {
        id: "chat_3",
        role: "assistant",
        content: "报告已保存为 Markdown。",
        createdAt: "2026-06-21T00:01:00.000Z",
      },
    });

    expect(sessions.searchMessages({ query: "报告 markdown", limit: 5 })).toEqual([
      {
        sessionId: "chat_1",
        sessionTitle: "整理下载文件夹",
        messageId: "chat_3",
        role: "assistant",
        content: "报告已保存为 Markdown。",
        createdAt: "2026-06-21T00:01:00.000Z",
        score: 4,
        matchedTerms: ["报告", "markdown"],
      },
    ]);
    storage.close();
  });
});

describe("remaining repositories", () => {
  it("task create/recordRun/setEnabled/list/get/delete", async () => {
    const storage = await createInMemoryStorage();
    const tasks = createTaskRepository(storage);
    const task = tasks.create({ name: "Daily", skillName: "noop", enabled: true, schedule: { kind: "manual" }, input: {} });
    expect(tasks.get(task.id)?.name).toBe("Daily");
    tasks.recordRun(task.id, new Date("2026-06-19T01:00:00.000Z"));
    expect(tasks.get(task.id)?.lastRunAt).toBeTruthy();
    tasks.setEnabled(task.id, false);
    expect(tasks.get(task.id)?.enabled).toBe(false);
    expect(tasks.list().length).toBe(1);
    expect(tasks.delete(task.id)).toBe(true);
    storage.close();
  });

  it("toolAudit append/list", async () => {
    const storage = await createInMemoryStorage();
    const audit = createToolAuditRepository(storage);
    audit.append({ taskId: "t1", request: { toolName: "shell_exec", args: {} }, decision: { allowed: true, reason: "ok" } });
    expect(audit.list().length).toBe(1);
    storage.close();
  });

  it("toolResult write/read with raw string content", async () => {
    const storage = await createInMemoryStorage();
    const tr = createToolResultRepository(storage);
    const ref = tr.write({ runId: "r1", content: 'not json { raw' });
    expect(tr.read(ref.relativePath)).toBe('not json { raw');
    expect(tr.read(ref.refId)).toBe('not json { raw');
    storage.close();
  });

  it("workspace create/save/touch/list/get/delete", async () => {
    const storage = await createInMemoryStorage();
    const ws = createWorkspaceRepository(storage);
    const w = ws.create({ name: "proj", rootPath: "/tmp/proj", kind: "project", cleanup: "keep" });
    expect(ws.get(w.id)?.rootPath).toBe("/tmp/proj");
    ws.touch(w.id);
    expect(ws.get(w.id)?.lastUsedAt).toBeTruthy();
    expect(ws.list().length).toBe(1);
    expect(ws.delete(w.id)).toBe(true);
    storage.close();
  });

  it("artifact writeProvenance/get/listByRun", async () => {
    const dir = join(tmpdir(), `zerox-art-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    const artifactPath = join(dir, "out.txt");
    writeFileSync(artifactPath, "hello world");
    const storage = await createInMemoryStorage();
    const arts = createArtifactRepository(storage);
    const manifest = arts.writeProvenance({
      artifactPath,
      artifactId: "art-1",
      artifactRef: "ref-1",
      runId: "run-1",
      source: { type: "tool" },
    });
    expect(manifest.destination.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.destination.sizeBytes).toBe(11);
    expect(arts.get("art-1")?.artifactId).toBe("art-1");
    expect(arts.listByRun("run-1").length).toBe(1);
    storage.close();
  });

  it("learning create/list/setStatus", async () => {
    const storage = await createInMemoryStorage();
    const lrn = createLearningRepository(storage);
    const c = lrn.create({ type: "failure_lesson", sourceRunId: "r1", sourceTrajectoryEventIds: [], claim: "x", recommendedAction: "y", risk: "low" });
    expect(lrn.list().length).toBe(1);
    lrn.setStatus(c.id, "accepted");
    expect(lrn.list({ status: "accepted" }).length).toBe(1);
    storage.close();
  });

  it("evalCandidate create/list/transitionStatus CAS", async () => {
    const storage = await createInMemoryStorage();
    const evals = createEvalCandidateRepository(storage);
    const cand: AgentEvalCandidate = {
      id: "ec1",
      sourceRunId: "r1",
      status: "pending_review",
      rationale: "x",
      fixture: { id: "f1", description: "d", events: [], requiredEventTypes: [] },
      createdAt: "2026-06-19T00:00:00.000Z",
      updatedAt: "2026-06-19T00:00:00.000Z",
    };
    evals.create(cand);
    expect(evals.transitionStatus("ec1", "pending_review", "accepted")?.status).toBe("accepted");
    // CAS fails when expected doesn't match
    expect(evals.transitionStatus("ec1", "pending_review", "rejected")).toBeNull();
    storage.close();
  });

  it("validation singleton save/load", async () => {
    const storage = await createInMemoryStorage();
    const v = createValidationRepository(storage);
    expect(v.load()).toBeNull();
    v.save({ report: { ready: true, model: { ok: true, detail: "" }, skill: { ok: true, detail: "" }, task: { ok: true, detail: "", tasks: [] }, connection: { ok: true, detail: "" }, run: { ok: true, detail: "", run: undefined } } as never, validatedAt: "2026-06-19T00:00:00.000Z" });
    expect(v.load()?.validatedAt).toBe("2026-06-19T00:00:00.000Z");
    storage.close();
  });

  it("memoryProfile singleton read/save", async () => {
    const storage = await createInMemoryStorage();
    const p = createMemoryProfileRepository(storage);
    expect(p.read().content).toBe("");
    p.save("## Preferences\n- test");
    expect(p.read().content).toContain("Preferences");
    storage.close();
  });

  it("promotedEvalFixture upsert/list", async () => {
    const storage = await createInMemoryStorage();
    const f = createPromotedEvalFixtureRepository(storage);
    f.upsert({ id: "f1", description: "d", events: [], requiredEventTypes: [] });
    expect(f.list().length).toBe(1);
    storage.close();
  });
});
