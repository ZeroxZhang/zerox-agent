import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  PlanArtifact,
  PlanQualityIssueCode,
  PlanRecord,
} from "../shared/planMode";
import {
  assertSafePlanId,
  createPlanStore,
  PlanVersionConflictError,
} from "./planStore";
import { createStorageImpl } from "./storage/storageDb";
import { ensurePlanGoalContract } from "./goalPlanContractService";
import { classifyPlanReplayReadFailure } from "../shared/planDiagnostics";

describe("plan store parity", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "zerox-plan-store-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("rejects unsafe plan ids used by stores and replay drivers", () => {
    expect(() => assertSafePlanId("plan-safe_1")).not.toThrow();
    expect(() => assertSafePlanId("../outside")).toThrow("计划 ID 非法");
  });

  it("classifies replay read failures without retaining arbitrary parser input", () => {
    const secret = "local-canary-replay-json-0123456789abcdef";
    expect(classifyPlanReplayReadFailure(new SyntaxError(secret))).toBe(
      "invalid_json",
    );
    expect(classifyPlanReplayReadFailure(new Error(secret))).toBe(
      "plan_file_unavailable",
    );
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
      expect(jsonCreated.schemaVersion).toBe(1);

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

  it("sanitizes and migrates Plan diagnostics at every storage boundary", async () => {
    const secret = "local-canary-plan-store-0123456789abcdef";
    const configDir = path.join(tempDir, "diagnostic-json");
    const workspaceInput = path.join(tempDir, "diagnostic-workspace");
    await mkdir(workspaceInput, { recursive: true });
    const workspaceRoot = await realpath(workspaceInput);
    const projectionPath = path.join(
      workspaceRoot,
      ".zerox",
      "plans",
      "plan-store-test.md",
    );
    await mkdir(path.dirname(projectionPath), { recursive: true });
    await writeFile(projectionPath, `# raw projection ${secret}\n`, "utf8");
    const storage = createStorageImpl({
      dbPath: path.join(tempDir, "diagnostic.sqlite"),
      skipFts5Check: true,
    });
    const json = createPlanStore({ configDir });
    const sqlite = createPlanStore({
      configDir: path.join(tempDir, "diagnostic-sqlite-unused"),
      storage,
    });
    const raw: PlanRecord = {
      ...createRecord(),
      workspaceRoot,
      rounds: [
        {
          id: "round-secret",
          kind: "direct",
          role: "direct",
          ordinal: 1,
          runId: "run-secret",
          modelBinding: {} as PlanRecord["rounds"][number]["modelBinding"],
          status: "failed",
          publicInputRefs: [],
          error: `provider failed with ${secret}`,
          failureExcerpt: `raw response ${secret}`,
        },
      ],
      planningStages: [
        {
          id: "stage-secret",
          kind: "review",
          runId: "review-secret",
          status: "failed",
          evidenceRefs: [],
          error: `review failed with ${secret}`,
          failureExcerpt: `review raw ${secret}`,
          reviewIssues: [
            {
              code: "SECRET_REVIEW",
              severity: "high",
              message: `review message ${secret}`,
              repairable: true,
              repairInstruction: `repair using ${secret}`,
            },
          ],
        },
      ],
      qualityReport: {
        status: "blocked",
        generatedAt: "2026-09-01T00:00:00.000Z",
        blockingIssues: [
          {
            code: `SECRET_QUALITY_${secret}` as PlanQualityIssueCode,
            severity: "blocking",
            message: `quality message ${secret}`,
            milestoneId: `milestone-${secret}`,
            checkId: `check-${secret}`,
            evidenceRefs: [`evidence-${secret}`],
          },
        ],
        warnings: [],
        evidenceCoverage: {
          referenced: 0,
          total: 1,
          missingRefs: [`missing-${secret}`],
        },
        acceptanceCoverage: {
          deterministicChecks: 0,
          modelReviewChecks: 0,
          totalChecks: 0,
          milestonesCovered: 0,
          milestonesTotal: 0,
        },
      },
      finalArtifact: createDiagnosticArtifact(secret),
      projection: {
        path: projectionPath,
        sha256: `raw-${secret}`,
        writtenAt: "2026-09-01T00:00:00.000Z",
      },
    };

    try {
      const jsonCreated = await json.create(raw);
      const sqliteCreated = await sqlite.create(raw);
      expect(JSON.stringify(jsonCreated)).not.toContain(secret);
      expect(JSON.stringify(sqliteCreated)).not.toContain(secret);
      expect(JSON.stringify(jsonCreated)).not.toContain("SECRET_REVIEW");
      expect(jsonCreated.qualityReport?.blockingIssues[0]?.code).toBe(
        "INVALID_SCHEMA",
      );
      expect(jsonCreated.qualityReport?.blockingIssues[0]?.milestoneId)
        .toBeUndefined();
      expect(jsonCreated.qualityReport?.evidenceCoverage.missingRefs).toEqual(
        [],
      );
      expect(jsonCreated.finalArtifact?.markdown).toBe("");
      await expect(readFile(projectionPath, "utf8")).resolves.not.toContain(
        secret,
      );
      expect(jsonCreated.rounds[0]?.failureExcerpt).toBeUndefined();
      expect(jsonCreated.planningStages?.[0]?.reviewIssues?.[0]?.message)
        .toContain("原始说明未保存");

      const planFile = path.join(configDir, "plans", `${raw.id}.json`);
      await expect(readFile(planFile, "utf8")).resolves.not.toContain(secret);
      expect(storage.db.prepare("SELECT payload FROM plan_records WHERE id = ?")
        .get<{ payload: string }>(raw.id)?.payload).not.toContain(secret);

      await writeFile(planFile, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
      storage.db.prepare("UPDATE plan_records SET payload = ? WHERE id = ?")
        .run(JSON.stringify(raw), raw.id);
      await writeFile(projectionPath, `# legacy projection ${secret}\n`, "utf8");

      await expect(json.get(raw.id)).resolves.toMatchObject({ id: raw.id });
      await expect(sqlite.get(raw.id)).resolves.toMatchObject({ id: raw.id });
      await expect(readFile(planFile, "utf8")).resolves.not.toContain(secret);
      await expect(readFile(projectionPath, "utf8")).resolves.not.toContain(
        secret,
      );
      expect(storage.db.prepare("SELECT payload FROM plan_records WHERE id = ?")
        .get<{ payload: string }>(raw.id)?.payload).not.toContain(secret);
    } finally {
      storage.close();
    }
  });

  it("persists and returns credential-free Skill snapshots for JSON, SQLite, and legacy Plans", async () => {
    const jsonConfigDir = path.join(tempDir, "private-json");
    const json = createPlanStore({ configDir: jsonConfigDir });
    const privateRecord: PlanRecord = {
      ...createRecord(),
      id: "plan-private-json",
      selectedSkill: createPrivateSkillSnapshot(),
    };

    const jsonCreated = await json.create(privateRecord);
    const jsonPayload = await readFile(
      path.join(jsonConfigDir, "plans", `${privateRecord.id}.json`),
      "utf8",
    );

    expect(JSON.stringify(jsonCreated)).not.toContain("PLAN_STDIO_SECRET");
    expect(JSON.stringify(jsonCreated)).not.toContain("PLAN_REMOTE_SECRET");
    expect(jsonPayload).not.toContain("PLAN_STDIO_SECRET");
    expect(jsonPayload).not.toContain("PLAN_REMOTE_SECRET");

    const legacyRecord: PlanRecord = {
      ...createRecord(),
      id: "plan-private-legacy",
      selectedSkill: createPrivateSkillSnapshot(),
    };
    await writeFile(
      path.join(jsonConfigDir, "plans", `${legacyRecord.id}.json`),
      JSON.stringify(legacyRecord),
      "utf8",
    );

    const legacyLoaded = await json.get(legacyRecord.id);

    expect(JSON.stringify(legacyLoaded)).not.toContain("PLAN_STDIO_SECRET");
    expect(JSON.stringify(legacyLoaded)).not.toContain("PLAN_REMOTE_SECRET");
    const rewrittenLegacyPayload = await readFile(
      path.join(
        jsonConfigDir,
        "plans",
        `${legacyRecord.id}.json`,
      ),
      "utf8",
    );
    expect(rewrittenLegacyPayload).not.toContain("PLAN_STDIO_SECRET");
    expect(rewrittenLegacyPayload).not.toContain("PLAN_REMOTE_SECRET");

    const storage = createStorageImpl({
      dbPath: path.join(tempDir, "private-plan.db"),
      skipFts5Check: true,
    });
    try {
      const sqlite = createPlanStore({
        configDir: path.join(tempDir, "sqlite-unused"),
        storage,
      });
      const sqliteRecord = {
        ...privateRecord,
        id: "plan-private-sqlite",
      };
      const sqliteCreated = await sqlite.create(sqliteRecord);
      const row = storage.db
        .prepare("SELECT payload FROM plan_records WHERE id = ?")
        .get<{ payload: string }>(sqliteRecord.id);

      expect(JSON.stringify(sqliteCreated)).not.toContain("PLAN_STDIO_SECRET");
      expect(JSON.stringify(sqliteCreated)).not.toContain("PLAN_REMOTE_SECRET");
      expect(row?.payload).not.toContain("PLAN_STDIO_SECRET");
      expect(row?.payload).not.toContain("PLAN_REMOTE_SECRET");

      const legacySqliteRecord = ensurePlanGoalContract({
        ...createRecord(),
        id: "plan-private-legacy-sqlite",
        sessionId: "session-private-legacy-sqlite",
        selectedSkill: createPrivateSkillSnapshot(),
        updatedAt: "2026-07-30T01:00:00.000Z",
      });
      storage.db
        .prepare(
          `INSERT INTO plan_records
            (id, session_id, mode, status, action_gate, revision, payload, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          legacySqliteRecord.id,
          legacySqliteRecord.sessionId,
          legacySqliteRecord.mode,
          legacySqliteRecord.status,
          legacySqliteRecord.actionGate,
          legacySqliteRecord.revision,
          JSON.stringify(legacySqliteRecord),
          legacySqliteRecord.createdAt,
          legacySqliteRecord.updatedAt,
        );

      const legacySqliteLoaded = (await sqlite.listAll()).find(
        (plan) => plan.id === legacySqliteRecord.id,
      );

      expect(JSON.stringify(legacySqliteLoaded)).not.toContain(
        "PLAN_STDIO_SECRET",
      );
      expect(JSON.stringify(legacySqliteLoaded)).not.toContain(
        "PLAN_REMOTE_SECRET",
      );
      await expect(
        sqlite.listBySession(legacySqliteRecord.sessionId),
      ).resolves.toEqual([
        expect.objectContaining({ id: legacySqliteRecord.id }),
      ]);
      await expect(
        sqlite.getLatestBySession(legacySqliteRecord.sessionId),
      ).resolves.toMatchObject({ id: legacySqliteRecord.id });
      const rewrittenSqlitePayload = storage.db
        .prepare("SELECT payload FROM plan_records WHERE id = ?")
        .get<{ payload: string }>(legacySqliteRecord.id)?.payload;
      expect(rewrittenSqlitePayload).not.toContain("PLAN_STDIO_SECRET");
      expect(rewrittenSqlitePayload).not.toContain("PLAN_REMOTE_SECRET");
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

  it("rejects an invalid persisted Plan autonomy mode", async () => {
    const store = createPlanStore({ configDir: tempDir });

    await expect(
      store.create({
        ...createRecord(),
        autonomyMode: "untrusted" as PlanRecord["autonomyMode"],
      }),
    ).rejects.toThrow("计划自主模式非法");
  });

  it("persists PlanRecord v3 lineage and rejects non-Direct runtime replans", async () => {
    const store = createPlanStore({ configDir: tempDir });
    const compatible = ensurePlanGoalContract(createRecord());
    const v3: PlanRecord = {
      ...compatible,
      schemaVersion: 3,
      purpose: "runtime_replan",
      mode: "direct",
      goalId: "goal-1",
      parentPlanRef: {
        planId: "plan-parent",
        planRevision: 4,
        goalPlanVersion: 1,
        mode: "debate",
        purpose: "initial",
        goalContractRef: compatible.goalContractRef!,
      },
      goalPlanVersion: 2,
      trigger: {
        kind: "acceptance_failure",
        summary: "The acceptance path became invalid.",
        evidenceRefs: ["evidence-ledger"],
        at: compatible.createdAt,
      },
      criterionBindings: [],
      goalContractIssues: [],
      taskProfile: {
        domain: "code",
        mode: "exploratory",
        risk: "writes_files",
        expectedScale: "small",
        needsConfirmation: false,
        targetRefs: [],
        ambiguity: [],
        investigationDepth: "standard",
      },
      planningBrief: {
        objective: "Test plan",
        deliverables: [],
        inScope: ["test"],
        outOfScope: [],
        constraints: [],
        assumptions: [],
        unresolvedQuestions: [],
        targetRefs: [],
        evidenceRefs: [],
        skillCandidates: [],
      },
      planningStages: [],
    };

    await expect(store.create(v3)).resolves.toMatchObject({
      schemaVersion: 3,
      purpose: "runtime_replan",
      goalPlanVersion: 2,
      parentPlanRef: { planId: "plan-parent" },
    });
    await expect(
      createPlanStore({ configDir: path.join(tempDir, "invalid") }).create({
        ...v3,
        id: "plan-invalid-runtime",
        mode: "debate",
      }),
    ).rejects.toThrow("Direct");
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

  it("recovers an interrupted v2 planning stage as a retryable failure in a new runtime", async () => {
    const configDir = path.join(tempDir, "crash-recovery");
    const firstRuntime = createPlanStore({ configDir });
    const base = createRecord();
    const created = await firstRuntime.create({
      ...base,
      schemaVersion: 2,
      taskProfile: {
        domain: "code",
        mode: "exploratory",
        risk: "writes_files",
        expectedScale: "small",
        needsConfirmation: false,
        targetRefs: [],
        ambiguity: [],
        investigationDepth: "standard",
      },
      planningBrief: {
        objective: "Test plan",
        deliverables: ["实现"],
        inScope: ["workspace"],
        outOfScope: [],
        constraints: ["read-only"],
        assumptions: [],
        unresolvedQuestions: [],
        targetRefs: [],
        evidenceRefs: [],
        skillCandidates: [],
      },
      planningStages: [],
    });
    const running = await firstRuntime.save(
      {
        ...created,
        planningStages: [
          {
            id: "investigation-stage",
            kind: "investigation",
            runId: "investigation-run",
            status: "running",
            investigationDepth: "standard",
            evidenceRefs: [],
          },
        ],
      },
      created.revision,
      "planner_investigation_started",
    );
    await expect(firstRuntime.get(running.id)).resolves.toMatchObject({
      status: "drafting",
      planningStages: [{ status: "running" }],
    });

    const recovered = await createPlanStore({ configDir }).get(running.id);

    expect(recovered).toMatchObject({
      revision: running.revision,
      status: "paused",
      actionGate: "blocked",
      planningStages: [
        {
          id: "investigation-stage",
          runId: "investigation-run",
          status: "failed",
          error: expect.stringContaining("中断"),
        },
      ],
    });
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

function createDiagnosticArtifact(secret: string): PlanArtifact {
  return {
    title: "Diagnostic migration",
    summary: "summary",
    objective: "objective",
    scope: { in: [], out: [] },
    assumptions: [],
    milestones: [],
    dependencies: [],
    risks: [],
    acceptanceCriteria: [],
    claimLedger: [],
    unresolvedQuestions: [],
    minorityOpinion: [`review ${secret}`],
    actionGate: "blocked",
    gateReason: `quality gate ${secret}`,
    markdown: `# raw markdown ${secret}`,
  };
}

function createPrivateSkillSnapshot(): NonNullable<PlanRecord["selectedSkill"]> {
  return {
    rootDir: "/tmp/private-plan-skill",
    skillFile: "/tmp/private-plan-skill/SKILL.md",
    body: "# Private Plan Skill",
    manifest: {
      name: "private-plan-skill",
      displayName: "Private Plan Skill",
      description: "Uses private MCP runtime configuration.",
      version: "1.0.0",
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
          name: "local-private",
          transport: "stdio",
          command: "node",
          env: { PRIVATE_TOKEN: "PLAN_STDIO_SECRET" },
        },
        {
          name: "remote-private",
          transport: "sse",
          url: "https://mcp.example.test/events",
          headers: { authorization: "PLAN_REMOTE_SECRET" },
        },
      ],
    },
  };
}
