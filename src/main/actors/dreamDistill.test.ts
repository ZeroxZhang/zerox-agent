import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { rm } from "node:fs/promises";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createInMemoryStorage } from "../storage/storageDb";
import { createRunRepository, createTrajectoryRepository } from "../storage/repositories/runRepository";
import { createCheckpointRepository } from "../storage/repositories/checkpointRepository";
import { createMemoryRepository } from "../storage/repositories/memoryRepository";
import { createSessionRepository } from "../storage/repositories/sessionRepository";
import { runDream, ruleBasedDistill, DREAM_AUTO_WRITE_THRESHOLD } from "./dreamService";
import { runDistill, DISTILL_PACKAGE_THRESHOLD } from "./distillService";
import { registerWorkflowAsSkill } from "../workflow/registerWorkflowAsSkill";
import { createWorkflowRuntime } from "../workflow/workflowRuntime";
import { createCheckpointWriterOrchestrator } from "./checkpointWriterOrchestrator";
import { projectRunGraph } from "../../shared/runGraph";
import type { AgentRunRecord } from "../../shared/agentRuns";
import type { AgentTrajectoryEvent } from "../../shared/agentTrajectory";
import type { MemoryRecord } from "../../shared/memory";

function makeRun(id: string): AgentRunRecord {
  return { id, taskId: `task-${id}`, taskName: "T", skillName: "s", status: "executing", summary: "", events: [], startedAt: "2026-06-19T00:00:00.000Z", finishedAt: "" };
}
function evt(runId: string, seq: number, type: AgentTrajectoryEvent["type"], payload: Record<string, unknown>): AgentTrajectoryEvent {
  return { id: `e-${runId}-${seq}`, runId, type, sequence: seq, payload, redaction: { containsApiKey: false, containsFileContent: false, containsUserText: false }, createdAt: `2026-06-19T00:00:0${seq}.000Z` };
}

describe("dreamService", () => {
  it("auto-writes high-confidence findings as project memories sourced from dream, and prunes stale", async () => {
    const storage = await createInMemoryStorage();
    const runs = createRunRepository(storage);
    const traj = createTrajectoryRepository(storage);
    const mem = createMemoryRepository(storage);
    const sessions = createSessionRepository(storage);
    // Seed a recurring tool sequence (file_read -> file_write) across 3 runs.
    for (const r of ["r1", "r2", "r3"]) {
      runs.create(makeRun(r));
      runs.appendTrajectory(r, evt(r, 1, "tool_call", { toolName: "file_read" }));
      runs.appendTrajectory(r, evt(r, 2, "tool_call", { toolName: "file_write" }));
    }
    // Seed a project memory that will be flagged stale (no recent footprint).
    mem.write({
      kind: "procedural", title: "Legacy deploy steps for ancient_tool", content: "old",
      tags: [], source: { type: "manual" }, importance: 2, id: "stale-mem",
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    });
    // listByScope("project") returns nothing because the legacy memory has no scope set (global);
    // dream's stale detection operates on projectMemories, so add a project-scoped stale one.
    const db = storage.db;
    db.prepare("UPDATE memory_records SET scope='project' WHERE id='stale-mem'").run();

    const report = await runDream({ storage, memoryRepository: mem, runRepository: runs, trajectoryRepository: traj, sessionRepository: sessions, now: () => "2026-06-19T00:00:00.000Z" });
    expect(report.findingsConsidered).toBeGreaterThan(0);
    expect(report.memoriesWritten).toBeGreaterThan(0);
    // The dream-written memory is project-scoped + dream-sourced.
    const projectMems = mem.listByScope("project");
    const dreamMem = projectMems.find((m) => m.source.type === "dream");
    expect(dreamMem).toBeTruthy();
    expect(dreamMem!.title).toContain("Recurring tool sequence");
    // Stale memory archived.
    const stale = mem.get("stale-mem");
    expect(stale?.archivedAt).toBeTruthy();
    storage.close();
  });

  it("queues low-confidence findings instead of writing", async () => {
    const storage = await createInMemoryStorage();
    const runs = createRunRepository(storage);
    const trajRepo = createTrajectoryRepository(storage);
    const mem = createMemoryRepository(storage);
    const sessions = createSessionRepository(storage);
    // A finding with confidence < threshold (override distill).
    const report = await runDream({
      storage, memoryRepository: mem, runRepository: runs, trajectoryRepository: trajRepo, sessionRepository: sessions,
      distill: () => [{ title: "low", content: "x", tags: [], importance: 2, confidence: DREAM_AUTO_WRITE_THRESHOLD - 0.1 }],
    });
    expect(report.memoriesWritten).toBe(0);
    expect(report.candidatesQueued).toBe(1);
    storage.close();
  });

  it("ruleBasedDistill extracts recurring bigrams", () => {
    // 3 runs each with file_read -> file_write (bigram appears 3x → finding).
    const events = ["r1", "r2", "r3"].flatMap((r) => [
      { runId: r, type: "tool_call", payload: { toolName: "file_read" } },
      { runId: r, type: "tool_call", payload: { toolName: "file_write" } },
    ]);
    const findings = ruleBasedDistill({ recentTrajectory: events, sessionCount: 1, projectMemories: [] });
    expect(findings.some((f) => f.title.includes("file_read->file_write"))).toBe(true);
  });
});

describe("distillService", () => {
  it("clusters repeated 3-tool sequences and packages high-confidence ones", async () => {
    const storage = await createInMemoryStorage();
    const runs = createRunRepository(storage);
    const trajRepo = createTrajectoryRepository(storage);
    for (const r of ["r1", "r2", "r3", "r4"]) {
      runs.create(makeRun(r));
      runs.appendTrajectory(r, evt(r, 1, "tool_call", { toolName: "code_search" }));
      runs.appendTrajectory(r, evt(r, 2, "tool_call", { toolName: "file_read" }));
      runs.appendTrajectory(r, evt(r, 3, "tool_call", { toolName: "file_write" }));
    }
    const wf = createWorkflowRuntime({ async spawnActor() { return { status: "done", summary: "ok", filesTouched: [] }; }, async webfetch() { return ""; }, async websearch() { return []; } });
    const dir = join(tmpdir(), `zerox-distill-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    try {
      const report = await runDistill({ storage, trajectoryRepository: trajRepo, workflowRuntime: wf, skillsDir: dir });
      expect(report.clustersConsidered).toBeGreaterThan(0);
      expect(report.skillsPackaged).toBeGreaterThan(0);
      expect(report.packagedSkillIds.length).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    storage.close();
  });

  it("DISTILL_PACKAGE_THRESHOLD is 0.7", () => { expect(DISTILL_PACKAGE_THRESHOLD).toBe(0.7); });
});

describe("registerWorkflowAsSkill", () => {
  it("writes a SKILL.md under a path-guarded skillsDir and registers a dynamic workflow", async () => {
    const wf = createWorkflowRuntime({ async spawnActor() { return { status: "done", summary: "", filesTouched: [] }; }, async webfetch() { return ""; }, async websearch() { return []; } });
    const dir = join(tmpdir(), `zerox-skill-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    try {
      const result = await registerWorkflowAsSkill(wf, "deep-research", {
        name: "my-distilled-skill", displayName: "My Skill", description: "d", mode: "agent",
        agentPrompt: "do the thing", permissions: {}, sourceRunIds: ["r1", "r2"],
      }, { skillsDir: dir });
      expect(existsSync(result.skillPath)).toBe(true);
      const content = readFileSync(result.skillPath, "utf8");
      expect(content).toContain("name: my-distilled-skill");
      expect(content).toContain("do the thing");
      expect(wf.has(result.workflowId)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects invalid slugs and path traversal", async () => {
    const wf = createWorkflowRuntime({ async spawnActor() { return { status: "done", summary: "", filesTouched: [] }; }, async webfetch() { return ""; }, async websearch() { return []; } });
    await expect(registerWorkflowAsSkill(wf, "x", { name: "Bad Slug!", displayName: "x", description: "d", mode: "agent", permissions: {}, sourceRunIds: [] })).rejects.toThrow("invalid skill name");
    await expect(registerWorkflowAsSkill(wf, "x", { name: "../escape", displayName: "x", description: "d", mode: "agent", permissions: {}, sourceRunIds: [] })).rejects.toThrow();
  });
});

describe("runGraph dream/distill projection (additive)", () => {
  it("projects dream/distill nodes without dropping existing kinds", () => {
    const run: AgentRunRecord = makeRun("run-d");
    const ev = (id: string, seq: number, type: AgentTrajectoryEvent["type"]): AgentTrajectoryEvent =>
      ({ id, runId: "run-d", type, sequence: seq, payload: {}, redaction: { containsApiKey: false, containsFileContent: false, containsUserText: false }, createdAt: `2026-06-19T00:00:0${seq}.000Z` });
    const graph = projectRunGraph({ run, trajectoryEvents: [
      ev("e1", 1, "tool_call"),
      ev("e2", 2, "dream_started"),
      ev("e3", 3, "dream_completed"),
      ev("e4", 4, "distill_started"),
      ev("e5", 5, "distill_completed"),
    ] });
    const kinds = graph.nodes.map((n) => n.kind);
    expect(kinds).toContain("tool_call");
    expect(kinds).toContain("dream");
    expect(kinds).toContain("distill");
    expect(graph.edges.some((e) => e.relation === "spawned_by")).toBe(true);
  });
});

describe("P5/P7 observability event emission", () => {
  it("checkpoint writer orchestrator emits actor_spawned + actor_done trajectory events", async () => {
    const storage = await createInMemoryStorage();
    const runs = createRunRepository(storage);
    const ck = createCheckpointRepository(storage);
    runs.create(makeRun("run-emit"));
    const orchestrator = createCheckpointWriterOrchestrator({
      runRepository: runs, checkpointRepository: ck,
      resolveGoal: () => ({ goal: baseGoal(), ledgerEvents: [] }),
    });
    await orchestrator.maybeWriteCheckpoint({ parentRunId: "run-emit", parentMessages: [] });
    const traj = runs.getTrajectory("run-emit");
    const types = traj.map((e) => e.type);
    expect(types).toContain("actor_spawned");
    expect(types).toContain("actor_done");
    // runGraph projects them
    const graph = projectRunGraph({
      run: makeRun("run-emit"),
      trajectoryEvents: traj,
    });
    expect(graph.nodes.some((n) => n.kind === "actor")).toBe(true);
    storage.close();
  });
});
