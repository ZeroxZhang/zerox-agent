import { describe, expect, it } from "vitest";
import { createInMemoryStorage } from "../storageDb";
import { createRunRepository, createTrajectoryRepository } from "./runRepository";
import type { AgentRunRecord } from "../../../shared/agentRuns";
import type { AgentTrajectoryEvent } from "../../../shared/agentTrajectory";

function makeRun(overrides: Partial<AgentRunRecord> = {}): AgentRunRecord {
  return {
    id: "run-1",
    taskId: "task-1",
    taskName: "Test task",
    skillName: "test",
    status: "executing",
    summary: "",
    events: [],
    startedAt: "2026-06-19T00:00:00.000Z",
    finishedAt: "",
    ...overrides,
  };
}

function makeEvent(seq: number, overrides: Partial<AgentTrajectoryEvent> = {}): AgentTrajectoryEvent {
  return {
    id: `evt-${seq}`,
    runId: "run-1",
    type: "tool_call",
    sequence: seq,
    payload: { seq },
    redaction: { containsApiKey: false, containsFileContent: false, containsUserText: false },
    createdAt: `2026-06-19T00:00:${String(seq).padStart(2, "0")}.000Z`,
    ...overrides,
  };
}

describe("RunRepository", () => {
  it("create + get round-trips the full record", async () => {
    const storage = await createInMemoryStorage();
    const runs = createRunRepository(storage);
    const run = makeRun({ artifacts: [{ path: "/tmp/x", sha256: "abc" }], childRunIds: ["c1"] });
    runs.create(run);
    expect(runs.get("run-1")).toEqual(run);
    expect(runs.get("missing")).toBeNull();
    storage.close();
  });

  it("create upserts on conflict (idempotent)", async () => {
    const storage = await createInMemoryStorage();
    const runs = createRunRepository(storage);
    runs.create(makeRun({ summary: "v1" }));
    runs.create(makeRun({ summary: "v2", status: "done" }));
    const got = runs.get("run-1");
    expect(got?.summary).toBe("v2");
    expect(got?.status).toBe("done");
    storage.close();
  });

  it("list orders by started_at desc and filters by taskId", async () => {
    const storage = await createInMemoryStorage();
    const runs = createRunRepository(storage);
    runs.create(makeRun({ id: "a", taskId: "t1", startedAt: "2026-06-19T01:00:00.000Z" }));
    runs.create(makeRun({ id: "b", taskId: "t2", startedAt: "2026-06-19T02:00:00.000Z" }));
    runs.create(makeRun({ id: "c", taskId: "t1", startedAt: "2026-06-19T03:00:00.000Z" }));
    expect(runs.list().map((r) => r.id)).toEqual(["c", "b", "a"]);
    expect(runs.list({ taskId: "t1" }).map((r) => r.id)).toEqual(["c", "a"]);
    expect(runs.list({ limit: 1 }).map((r) => r.id)).toEqual(["c"]);
    storage.close();
  });

  it("updateStatus keeps the denormalized column and canonical payload aligned", async () => {
    const storage = await createInMemoryStorage();
    const runs = createRunRepository(storage);
    runs.create(makeRun());
    runs.updateStatus("run-1", "done");
    expect(runs.get("run-1")?.status).toBe("done");
    const row = storage.db.prepare("SELECT status FROM runs WHERE id = ?").get<{ status: string }>("run-1");
    expect(row.status).toBe("done");
    storage.close();
  });

  it("appendTrajectory + getTrajectory preserve order and fromSeq", async () => {
    const storage = await createInMemoryStorage();
    const runs = createRunRepository(storage);
    for (const seq of [1, 2, 3]) runs.appendTrajectory("run-1", makeEvent(seq));
    expect(runs.getTrajectory("run-1").map((e) => e.sequence)).toEqual([1, 2, 3]);
    expect(runs.getTrajectory("run-1", { fromSeq: 2 }).map((e) => e.sequence)).toEqual([2, 3]);
    storage.close();
  });

  it("atomically allocates monotonic publication sequences per run", async () => {
    const storage = await createInMemoryStorage();
    const runs = createRunRepository(storage);
    runs.appendTrajectory("run-1", makeEvent(4));

    const first = runs.appendTrajectoryPublication(
      "run-1",
      "publication:a",
      makeEvent(0, {
        id: "publication-a",
        payload: { publicationKey: "publication:a" },
      }),
    );
    const duplicate = runs.appendTrajectoryPublication(
      "run-1",
      "publication:a",
      makeEvent(0, {
        id: "publication-a-competing",
        payload: { publicationKey: "publication:a", competing: true },
      }),
    );
    const second = runs.appendTrajectoryPublication(
      "run-1",
      "publication:b",
      makeEvent(0, {
        id: "publication-b",
        payload: { publicationKey: "publication:b" },
      }),
    );

    expect(first).toMatchObject({ appended: true, event: { sequence: 5 } });
    expect(duplicate).toEqual({ appended: false, event: first.event });
    expect(second).toMatchObject({ appended: true, event: { sequence: 6 } });
    expect(runs.getTrajectory("run-1").map((event) => event.sequence)).toEqual([
      4,
      5,
      6,
    ]);
    storage.close();
  });

  it("appendTrajectory is idempotent on identical (run_id, seq)", async () => {
    const storage = await createInMemoryStorage();
    const runs = createRunRepository(storage);
    runs.appendTrajectory("run-1", makeEvent(1));
    runs.appendTrajectory("run-1", makeEvent(1));
    expect(runs.getTrajectory("run-1").length).toBe(1);
    storage.close();
  });

  it("fails loudly instead of silently dropping a sequence collision", async () => {
    const storage = await createInMemoryStorage();
    const runs = createRunRepository(storage);
    runs.appendTrajectory("run-1", makeEvent(1));

    expect(() =>
      runs.appendTrajectory(
        "run-1",
        makeEvent(1, { id: "evt-conflict", payload: { different: true } }),
      ),
    ).toThrow("Trajectory sequence collision for run run-1 at 1");
    storage.close();
  });
});

describe("TrajectoryRepository", () => {
  it("getTrajectory filters by types", async () => {
    const storage = await createInMemoryStorage();
    const runs = createRunRepository(storage);
    const traj = createTrajectoryRepository(storage);
    runs.appendTrajectory("run-1", makeEvent(1, { type: "tool_call" }));
    runs.appendTrajectory("run-1", makeEvent(2, { type: "tool_result" }));
    runs.appendTrajectory("run-1", makeEvent(3, { type: "model_response" }));
    expect(traj.getTrajectory("run-1", { types: ["tool_call", "tool_result"] }).map((e) => e.sequence)).toEqual([1, 2]);
    storage.close();
  });

  it("scanByTypes spans runs and optional runId filter", async () => {
    const storage = await createInMemoryStorage();
    const runs = createRunRepository(storage);
    const traj = createTrajectoryRepository(storage);
    runs.appendTrajectory("run-1", makeEvent(1, { type: "tool_call" }));
    runs.appendTrajectory("run-2", makeEvent(1, { type: "tool_call", id: "evt-r2-1", runId: "run-2" }));
    runs.appendTrajectory("run-2", makeEvent(2, { type: "final_summary", id: "evt-r2-2", runId: "run-2" }));
    const all = traj.scanByTypes(["tool_call"]);
    expect(all.length).toBe(2);
    expect(traj.scanByTypes(["tool_call"], { runId: "run-2" }).length).toBe(1);
    storage.close();
  });
});
