// P1 observability parity (spec T1.9, contract §1.5 / spec §2.1.5).
//
// Hard constraint: `trajectory_events` in SQLite must reproduce the EXACT
// `projectRunGraph()` output the legacy JSON trajectory store produces — all 11
// node/gate-producing event types, the multi-alias runId filter, and the
// sequence+createdAt ordering. This test builds a golden run covering every
// node-producing type, persists it through BOTH the JSON store and the SQLite
// repository, then asserts the two `projectRunGraph` views are deep-equal.

import { describe, expect, it } from "vitest";
import { rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createStorageImpl } from "./storageDb";
import { createRunRepository } from "./repositories/runRepository";
import { createAgentTrajectoryStore } from "../agentTrajectoryStore";
import { projectRunGraph } from "../../shared/runGraph";
import type { AgentRunRecord } from "../../shared/agentRuns";
import type { AgentTrajectoryEvent } from "../../shared/agentTrajectory";

const baseTime = "2026-06-17T00:00:00.000Z";
const RUN_ID = "run_parity";
const TASK_ID = "task_parity";

function makeRun(): AgentRunRecord {
  return {
    id: RUN_ID,
    taskId: TASK_ID,
    taskName: "Parity golden run",
    skillName: "test",
    status: "succeeded",
    summary: "golden",
    events: [],
    startedAt: baseTime,
    finishedAt: baseTime,
  };
}

// One trajectory event for each of the 11 node/gate-producing types that
// projectRunGraph consumes (runGraph.ts:176-416), in sequence order.
function goldenTrajectory(): AgentTrajectoryEvent[] {
  let seq = 0;
  const ev = (
    id: string,
    type: AgentTrajectoryEvent["type"],
    payload: Record<string, unknown>,
    runId: string = RUN_ID,
  ): AgentTrajectoryEvent => ({
    id,
    runId,
    type,
    sequence: ++seq,
    payload,
    redaction: { containsApiKey: false, containsFileContent: false, containsUserText: false },
    createdAt: baseTime,
  });
  return [
    ev("e_goal_planned", "goal_planned", { goalId: "goal_1", planVersion: 1 }),
    ev("e_milestone_started", "milestone_started", { goalId: "goal_1", milestoneId: "milestone_1" }),
    ev("e_model_request", "model_request", { turn: 0 }),
    ev("e_tool_call", "tool_call", { toolCallId: "call_1", toolName: "file_read" }),
    ev("e_tool_result", "tool_result", { toolCallId: "call_1", toolName: "file_read", ok: true }),
    ev("e_checkpoint", "checkpoint_written", { checkpointId: "checkpoint_1", status: "running" }),
    ev("e_artifact", "artifact_created", { artifactId: "artifact_1", path: "/tmp/out.md", sha256: "abc" }),
    ev("e_review", "goal_review_requested", { goalId: "goal_1", milestoneId: "milestone_1" }),
    ev("e_acceptance", "acceptance_checked", { goalId: "goal_1", milestoneId: "milestone_1", accepted: true, checkId: "check_1" }),
    ev("e_escape", "workspace_escape_denied", { toolName: "file_write", path: "/tmp/outside.md", reason: "outside" }),
    ev("e_summary", "final_summary", { status: "succeeded", summary: "done" }),
  ];
}

describe("runGraph trajectory parity (JSON vs SQLite)", () => {
  it("produces deep-equal projectRunGraph output for all 11 node/gate types", async () => {
    const dir = join(tmpdir(), `zerox-parity-${randomUUID()}`);
    await mkdir(join(dir, "agent-trajectories"), { recursive: true });

    // --- JSON path: write the legacy JSONL directly ---
    const jsonPath = join(dir, "agent-trajectories", `${RUN_ID}.jsonl`);
    const events = goldenTrajectory();
    await writeFile(
      jsonPath,
      events.map((e) => JSON.stringify(e)).join("\n") + "\n",
      "utf8",
    );
    const jsonStore = createAgentTrajectoryStore({ configDir: dir, backend: "json" });
    const jsonEvents = await jsonStore.list(RUN_ID);

    // --- SQLite path: persist via the repository ---
    const storage = createStorageImpl({ dbPath: join(dir, "zerox.db") });
    await storage.migrate();
    const runs = createRunRepository(storage);
    runs.create(makeRun());
    for (const e of events) runs.appendTrajectory(RUN_ID, e);
    const sqliteEvents = runs.getTrajectory(RUN_ID);

    // The two event lists must be identical (parity of storage).
    expect(sqliteEvents).toEqual(jsonEvents);

    // ...and the projected run graphs must be deep-equal.
    const run = makeRun();
    const jsonGraph = projectRunGraph({ run, trajectoryEvents: jsonEvents });
    const sqliteGraph = projectRunGraph({ run, trajectoryEvents: sqliteEvents });
    expect(sqliteGraph).toEqual(jsonGraph);

    // Sanity: the golden run actually produced a non-trivial graph with the
    // expected node/gate kinds (guards against a vacuous deep-equal).
    const kinds = sqliteGraph.nodes.map((n) => n.kind).sort();
    expect(kinds).toEqual(
      expect.arrayContaining([
        "goal",
        "milestone",
        "model_request",
        "tool_call",
        "checkpoint",
        "artifact",
        "summary",
      ]),
    );
    expect(sqliteGraph.gates.length).toBe(3); // review + acceptance + workspace_sandbox

    storage.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("fromSeq returns a consistent tail from both backends", async () => {
    const dir = join(tmpdir(), `zerox-parity-seq-${randomUUID()}`);
    await mkdir(join(dir, "agent-trajectories"), { recursive: true });
    const events = goldenTrajectory();

    const jsonPath = join(dir, "agent-trajectories", `${RUN_ID}.jsonl`);
    await writeFile(jsonPath, events.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
    const jsonStore = createAgentTrajectoryStore({ configDir: dir, backend: "json" });

    const storage = createStorageImpl({ dbPath: join(dir, "zerox.db") });
    await storage.migrate();
    const runs = createRunRepository(storage);
    runs.create(makeRun());
    for (const e of events) runs.appendTrajectory(RUN_ID, e);

    // The JSON store has no fromSeq; emulate by slicing the full list.
    const fullJson = await jsonStore.list(RUN_ID);
    const jsonTail = fullJson.filter((e) => e.sequence >= 5);
    const sqliteTail = runs.getTrajectory(RUN_ID, { fromSeq: 5 });
    expect(sqliteTail).toEqual(jsonTail);

    storage.close();
    await rm(dir, { recursive: true, force: true });
  });
});
