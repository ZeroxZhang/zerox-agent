import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PlanRecord } from "../shared/planMode";
import { createPlanStore, PlanVersionConflictError } from "./planStore";
import { createStorageImpl } from "./storage/storageDb";

describe("plan store parity", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "zerox-plan-store-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("keeps JSON and SQLite backends behaviorally equivalent", async () => {
    let jsonEvent = 0;
    let sqliteEvent = 0;
    const storage = createStorageImpl({
      dbPath: path.join(tempDir, "zerox.db"),
      skipFts5Check: true,
    });
    const json = createPlanStore({
      configDir: path.join(tempDir, "json"),
      now: () => "2026-07-30T00:00:01.000Z",
      createId: () => `json-event-${++jsonEvent}`,
    });
    const sqlite = createPlanStore({
      configDir: path.join(tempDir, "sqlite-unused"),
      storage,
      now: () => "2026-07-30T00:00:01.000Z",
      createId: () => `sqlite-event-${++sqliteEvent}`,
    });
    try {
      const record = createRecord();
      const jsonCreated = await json.create(record);
      const sqliteCreated = await sqlite.create(record);
      expect(sqliteCreated).toEqual(jsonCreated);

      const jsonSaved = await json.save(
        {
          ...jsonCreated,
          status: "awaiting_confirmation",
          actionGate: "ready",
        },
        jsonCreated.revision,
        "plan_ready",
      );
      const sqliteSaved = await sqlite.save(
        {
          ...sqliteCreated,
          status: "awaiting_confirmation",
          actionGate: "ready",
        },
        sqliteCreated.revision,
        "plan_ready",
      );
      expect(sqliteSaved).toEqual(jsonSaved);
      expect(await sqlite.get(record.id)).toEqual(await json.get(record.id));
      expect(await sqlite.listBySession(record.sessionId)).toEqual(
        await json.listBySession(record.sessionId),
      );
      expect(await sqlite.getLatestBySession(record.sessionId)).toEqual(
        await json.getLatestBySession(record.sessionId),
      );
      expect(
        storage.db
          .prepare("SELECT type, revision FROM plan_events ORDER BY revision")
          .all(),
      ).toEqual([
        { type: "plan_created", revision: 1 },
        { type: "plan_ready", revision: 2 },
      ]);
    } finally {
      storage.close();
    }
  });

  it("rejects stale revisions without overwriting the canonical record", async () => {
    let event = 0;
    const store = createPlanStore({
      configDir: tempDir,
      createId: () => `event-${++event}`,
    });
    const created = await store.create(createRecord());
    const updated = await store.save(
      { ...created, status: "paused" },
      created.revision,
      "paused",
    );

    await expect(
      store.save(
        { ...created, status: "discarded" },
        created.revision,
        "stale",
      ),
    ).rejects.toBeInstanceOf(PlanVersionConflictError);
    await expect(store.get(created.id)).resolves.toEqual(updated);
  });

  it("uses the durable session index without parsing unrelated Plan files", async () => {
    const configDir = path.join(tempDir, "indexed");
    const store = createPlanStore({ configDir });
    const created = await store.create(createRecord());
    const plansDir = path.join(configDir, "plans");
    await mkdir(plansDir, { recursive: true });
    await writeFile(
      path.join(plansDir, "unrelated-corrupt.json"),
      "{not valid json",
      "utf8",
    );

    await expect(
      store.getLatestBySession(created.sessionId),
    ).resolves.toEqual(created);
  });
});

function createRecord(): PlanRecord {
  return {
    id: "plan-store-test",
    sessionId: "session-store-test",
    workspaceRoot: "/tmp/workspace",
    sourceMessage: "Test plan",
    mode: "direct",
    status: "drafting",
    actionGate: "blocked",
    revision: 1,
    taskContract: {
      objective: "Test plan",
      audience: "Tester",
      inScope: ["test"],
      outOfScope: [],
      constraints: [],
      successCriteria: ["passes"],
      assumptions: [],
    },
    evidence: [],
    requestedModelAssignments: {},
    frozenModelAssignments: {},
    rounds: [],
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z",
  };
}
