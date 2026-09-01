import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
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
import type { SkillRecord } from "../shared/skills";
import {
  assertSafePlanId,
  createPlanStore,
  PlanVersionConflictError,
} from "./planStore";
import {
  createPlanArtifactWriter,
  describePlanProjection,
} from "./planArtifactWriter";
import { InvalidPersistedPlanRecordError } from "./planRecordDecoder";
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

  it("keeps both Plan replay failure paths on the fixed classifier boundary", async () => {
    const source = await readFile(path.join(process.cwd(), "src/main/main.ts"), "utf8");
    const replayDriver = source.slice(
      source.indexOf("function startPlanReplayDriver()"),
      source.indexOf("function stopAppUpdateScheduler()"),
    );
    expect(replayDriver.match(/classifyPlanReplayReadFailure\(error\)/g))
      .toHaveLength(2);
    expect(replayDriver).not.toContain("error.message");
    expect(replayDriver).not.toContain("String(error)");
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
    const rawProjection = `# raw projection ${secret}\n`;
    await writeFile(projectionPath, rawProjection, {
      encoding: "utf8",
      mode: 0o600,
    });
    const storage = createStorageImpl({
      dbPath: path.join(tempDir, "diagnostic.sqlite"),
      skipFts5Check: true,
    });
    const json = createPlanStore({ configDir });
    const sqlite = createPlanStore({
      configDir: path.join(tempDir, "diagnostic-sqlite-unused"),
      storage,
    });
    const raw: PlanRecord = ensurePlanGoalContract({
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
        {
          id: "round-owned-dto",
          kind: "a1",
          role: "a",
          ordinal: 1,
          runId: "run-owned-dto",
          modelBinding: {} as PlanRecord["rounds"][number]["modelBinding"],
          status: "completed",
          publicInputRefs: [],
          output: createDiagnosticArtifact("safe"),
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
        sha256: sha256(rawProjection),
        writtenAt: "2026-09-01T00:00:00.000Z",
      },
      trigger: {
        kind: "initial_request",
        summary: "safe trigger",
        evidenceRefs: [],
        at: "2026-09-01T00:00:00.000Z",
      },
      criterionBindings: [
        { criterionId: "criterion-1", milestoneIds: [], checkIds: [] },
      ],
      goalContractIssues: [
        {
          id: `issue-${secret}`,
          severity: "blocking",
          description: `issue ${secret}`,
          evidenceRefs: [`evidence-${secret}`],
        },
      ],
    });
    Object.assign(raw, { rawDiagnostic: `root ${secret}` });
    Object.assign(raw.rounds[0]!, { rawDiagnostic: `round ${secret}` });
    Object.assign(raw.planningStages![0]!, {
      rawDiagnostic: `stage ${secret}`,
    });
    Object.assign(raw.qualityReport!, { rawDiagnostic: `quality ${secret}` });
    Object.assign(raw.qualityReport!.evidenceCoverage, {
      rawDiagnostic: `coverage ${secret}`,
    });
    Object.assign(raw.finalArtifact!, {
      rawDiagnostic: `artifact ${secret}`,
    });
    Object.assign(raw.finalArtifact!.scope, {
      rawDiagnostic: `artifact scope ${secret}`,
    });
    Object.assign(raw.goalContractSnapshot!, {
      rawDiagnostic: `contract ${secret}`,
    });
    Object.assign(raw.goalContractSnapshot!.source, {
      rawDiagnostic: `contract source ${secret}`,
    });
    Object.assign(raw.trigger!, { rawDiagnostic: `trigger ${secret}` });
    Object.assign(raw.criterionBindings![0]!, {
      rawDiagnostic: `binding ${secret}`,
    });
    Object.assign(raw.goalContractIssues![0]!, {
      rawDiagnostic: `goal issue ${secret}`,
    });
    raw.selectedSkill = createPrivateSkillSnapshot();
    Object.assign(raw.selectedSkill.manifest.execution, {
      rawDiagnostic: `skill execution ${secret}`,
    });
    raw.selectedSkill.manifest.inputs = [{
      name: "scope",
      label: "Scope",
      type: "string",
      required: false,
      defaultValue: "safe",
      rawDiagnostic: `skill input ${secret}`,
    } as NonNullable<PlanRecord["selectedSkill"]>["manifest"]["inputs"][number]];
    raw.selectedSkill.manifest.planning = {
      required: true,
      maxSteps: 3,
      rawDiagnostic: `skill planning ${secret}`,
    } as NonNullable<PlanRecord["selectedSkill"]>["manifest"]["planning"];
    Object.assign(raw.rounds[1]!.output!, {
      rawDiagnostic: `round output ${secret}`,
      issues: [{ rawDiagnostic: `shape injection ${secret}` }],
      goalContractIssues: [
        {
          id: `round-issue-${secret}`,
          severity: "warning",
          description: `round issue ${secret}`,
          evidenceRefs: [`round-evidence-${secret}`],
          rawDiagnostic: `round issue unknown ${secret}`,
        },
      ],
    });

    try {
      const jsonCreated = await json.create(raw);
      const sqliteCreated = await sqlite.create(raw);
      expect(JSON.stringify(jsonCreated)).not.toContain(secret);
      expect(JSON.stringify(sqliteCreated)).not.toContain(secret);
      expect(jsonCreated).not.toHaveProperty("rawDiagnostic");
      expect(jsonCreated.rounds[0]).not.toHaveProperty("rawDiagnostic");
      expect(jsonCreated.planningStages?.[0]).not.toHaveProperty(
        "rawDiagnostic",
      );
      expect(jsonCreated.qualityReport).not.toHaveProperty("rawDiagnostic");
      expect(jsonCreated.qualityReport?.evidenceCoverage).not.toHaveProperty(
        "rawDiagnostic",
      );
      expect(jsonCreated.finalArtifact).not.toHaveProperty("rawDiagnostic");
      expect(jsonCreated.finalArtifact?.scope).not.toHaveProperty(
        "rawDiagnostic",
      );
      expect(jsonCreated.goalContractSnapshot).not.toHaveProperty(
        "rawDiagnostic",
      );
      expect(jsonCreated.goalContractSnapshot?.source).not.toHaveProperty(
        "rawDiagnostic",
      );
      expect(jsonCreated.trigger).not.toHaveProperty("rawDiagnostic");
      expect(jsonCreated.criterionBindings?.[0]).not.toHaveProperty(
        "rawDiagnostic",
      );
      expect(jsonCreated.goalContractIssues?.[0]).toEqual({
        id: "goal_contract_issue_1",
        severity: "blocking",
        description:
          "规划模型报告 GoalContract 存在阻断问题；原始诊断内容未保存。",
        evidenceRefs: [],
      });
      expect(jsonCreated.selectedSkill?.manifest.execution).not.toHaveProperty(
        "rawDiagnostic",
      );
      expect(jsonCreated.selectedSkill?.manifest.inputs[0]).not.toHaveProperty(
        "rawDiagnostic",
      );
      expect(jsonCreated.selectedSkill?.manifest.planning).not.toHaveProperty(
        "rawDiagnostic",
      );
      expect(jsonCreated.rounds[1]?.output).not.toHaveProperty("issues");
      expect(jsonCreated.rounds[1]?.output).not.toHaveProperty(
        "rawDiagnostic",
      );
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

      const legacyProjection = `# legacy projection ${secret}\n`;
      raw.projection!.sha256 = sha256(legacyProjection);
      await writeFile(planFile, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
      storage.db.prepare("UPDATE plan_records SET payload = ? WHERE id = ?")
        .run(JSON.stringify(raw), raw.id);
      await writeFile(projectionPath, legacyProjection, "utf8");

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

  it("cleans stored diagnostics even when the legacy workspace is offline", async () => {
    const secret = "local-canary-offline-plan-0123456789abcdef";
    const configDir = path.join(tempDir, "offline-diagnostic-json");
    const workspaceInput = path.join(tempDir, "offline-diagnostic-workspace");
    await mkdir(workspaceInput, { recursive: true });
    const workspaceRoot = await realpath(workspaceInput);
    const projectionPath = path.join(
      workspaceRoot,
      ".zerox",
      "plans",
      "plan-store-test.md",
    );
    await mkdir(path.dirname(projectionPath), { recursive: true });
    const legacyProjection = `# legacy ${secret}\n`;
    await writeFile(projectionPath, legacyProjection, {
      encoding: "utf8",
      mode: 0o600,
    });
    const storage = createStorageImpl({
      dbPath: path.join(tempDir, "offline-diagnostic.sqlite"),
      skipFts5Check: true,
    });
    const json = createPlanStore({ configDir });
    const sqlite = createPlanStore({
      configDir: path.join(tempDir, "offline-sqlite-unused"),
      storage,
    });
    const raw: PlanRecord = {
      ...createRecord(),
      workspaceRoot,
      finalArtifact: createDiagnosticArtifact("offline-safe"),
      projection: {
        path: projectionPath,
        sha256: sha256(legacyProjection),
        writtenAt: "2026-09-01T00:00:00.000Z",
      },
    };
    Object.assign(raw, { rawDiagnostic: secret });

    try {
      await json.create(raw);
      await sqlite.create(raw);
      const planFile = path.join(configDir, "plans", `${raw.id}.json`);
      await writeFile(planFile, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
      storage.db.prepare("UPDATE plan_records SET payload = ? WHERE id = ?")
        .run(JSON.stringify(raw), raw.id);
      const offlineWorkspace = `${workspaceRoot}.offline`;
      await rename(workspaceRoot, offlineWorkspace);

      const jsonMigrated = await json.get(raw.id);
      const sqliteMigrated = await sqlite.get(raw.id);
      expect(jsonMigrated).toMatchObject({ id: raw.id });
      expect(sqliteMigrated).toMatchObject({ id: raw.id });
      expect(jsonMigrated).toMatchObject({
        status: "drafting",
        actionGate: "blocked",
        projection: { path: projectionPath, sha256: sha256(legacyProjection) },
        projectionIntent: {
          expectedSha256: sha256(legacyProjection),
          body: expect.not.stringContaining(secret),
        },
      });
      expect(sqliteMigrated).toMatchObject({
        status: "drafting",
        actionGate: "blocked",
        projection: { path: projectionPath, sha256: sha256(legacyProjection) },
        projectionIntent: {
          expectedSha256: sha256(legacyProjection),
          body: expect.not.stringContaining(secret),
        },
      });
      await expect(readFile(planFile, "utf8")).resolves.not.toContain(secret);
      expect(storage.db.prepare("SELECT payload FROM plan_records WHERE id = ?")
        .get<{ payload: string }>(raw.id)?.payload).not.toContain(secret);

      await rename(offlineWorkspace, workspaceRoot);
      const jsonRecovered = await json.get(raw.id);
      const sqliteRecovered = await sqlite.get(raw.id);
      expect(jsonRecovered?.projectionIntent).toBeUndefined();
      expect(sqliteRecovered?.projectionIntent).toBeUndefined();
      await expect(readFile(projectionPath, "utf8")).resolves.not.toContain(secret);
    } finally {
      storage.close();
    }
  });

  it("tombstones a legacy diagnostic projection without a final artifact", async () => {
    const secret = "local-canary-detached-plan-0123456789abcdef";
    const workspaceInput = path.join(tempDir, "detached-diagnostic-workspace");
    await mkdir(workspaceInput, { recursive: true });
    const workspaceRoot = await realpath(workspaceInput);
    const projectionPath = path.join(
      workspaceRoot,
      ".zerox",
      "plans",
      "plan-store-test.md",
    );
    await mkdir(path.dirname(projectionPath), { recursive: true });
    const legacyProjection = `# legacy ${secret}\n`;
    await writeFile(projectionPath, legacyProjection, {
      encoding: "utf8",
      mode: 0o600,
    });
    const store = createPlanStore({
      configDir: path.join(tempDir, "detached-diagnostic-json"),
    });
    const raw: PlanRecord = {
      ...createRecord(),
      workspaceRoot,
      projection: {
        path: projectionPath,
        sha256: sha256(legacyProjection),
        writtenAt: "2026-09-01T00:00:00.000Z",
      },
    };
    Object.assign(raw, { rawDiagnostic: secret });

    const created = await store.create(raw);
    expect(created.projection).toBeDefined();
    expect(created.projectionIntent).toBeUndefined();
    await expect(readFile(projectionPath, "utf8")).resolves.toBe(
      "# Plan projection unavailable\n\nLegacy diagnostic projection removed.\n",
    );
  });

  it("keeps a non-confirmable recovery intent without overwriting a drifted legacy projection", async () => {
    const secret = "local-canary-drifted-plan-0123456789abcdef";
    const workspaceInput = path.join(tempDir, "drifted-diagnostic-workspace");
    await mkdir(workspaceInput, { recursive: true });
    const workspaceRoot = await realpath(workspaceInput);
    const trustedProjection = "# trusted legacy projection\n";
    const userModifiedProjection = "# user modified projection\n";
    const storage = createStorageImpl({
      dbPath: path.join(tempDir, "drifted-diagnostic.sqlite"),
      skipFts5Check: true,
    });
    try {
      for (const backend of ["json", "sqlite"] as const) {
        const id = `plan-drifted-${backend}`;
        const projectionPath = path.join(
          workspaceRoot,
          ".zerox",
          "plans",
          `${id}.md`,
        );
        await mkdir(path.dirname(projectionPath), { recursive: true });
        await writeFile(projectionPath, userModifiedProjection, {
          encoding: "utf8",
          mode: 0o600,
        });
        const raw: PlanRecord = {
          ...createRecord(),
          id,
          sessionId: `session-${backend}`,
          workspaceRoot,
          finalArtifact: createDiagnosticArtifact("safe"),
          projection: {
            path: projectionPath,
            sha256: sha256(trustedProjection),
            writtenAt: "2026-09-01T00:00:00.000Z",
          },
        };
        Object.assign(raw, { rawDiagnostic: secret });
        const store = createPlanStore({
          configDir: path.join(tempDir, `drifted-${backend}`),
          ...(backend === "sqlite" ? { storage } : {}),
        });

        const created = await store.create(raw);

        expect(created).toMatchObject({
          status: "drafting",
          actionGate: "blocked",
          projection: { sha256: sha256(trustedProjection) },
          projectionIntent: {
            kind: "artifact",
            expectedSha256: sha256(trustedProjection),
          },
        });
        await expect(readFile(projectionPath, "utf8")).resolves.toBe(
          userModifiedProjection,
        );
        if (backend === "sqlite") {
          expect(
            storage.db
              .prepare("SELECT payload FROM plan_records WHERE id = ?")
              .get<{ payload: string }>(id)?.payload,
          ).not.toContain(secret);
        } else {
          await expect(
            readFile(
              path.join(tempDir, `drifted-${backend}`, "plans", `${id}.json`),
              "utf8",
            ),
          ).resolves.not.toContain(secret);
        }
      }
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
    expect(JSON.stringify(jsonCreated)).not.toContain("PLAN_ARGS_SECRET");
    expect(JSON.stringify(jsonCreated)).not.toContain("PLAN_URL_SECRET");
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

  it("recovers a durable projection intent before exposing a confirmable Plan", async () => {
    const configDir = path.join(tempDir, "projection-intent");
    const workspaceRoot = path.join(tempDir, "projection-workspace");
    await mkdir(workspaceRoot, { recursive: true });
    const firstRuntime = createPlanStore({ configDir });
    const artifact: PlanArtifact = {
      ...createDiagnosticArtifact("safe"),
      actionGate: "ready",
      gateReason: "ready",
    };
    const created = await firstRuntime.create({
      ...createRecord(),
      workspaceRoot,
    });
    const target: PlanRecord = {
      ...created,
      status: "awaiting_confirmation",
      actionGate: "ready",
      finalArtifact: artifact,
    };
    const description = await describePlanProjection(
      { ...target, revision: created.revision + 1 },
      artifact,
    );
    const prepared = await firstRuntime.saveProjectionIntent(
      target,
      created.revision,
      description,
      "plan_synthesized",
    );

    expect(prepared).toMatchObject({
      revision: created.revision + 1,
      status: "drafting",
      actionGate: "blocked",
      projectionIntent: {
        nextPath: description.path,
        nextSha256: description.sha256,
        targetStatus: "awaiting_confirmation",
        targetActionGate: "ready",
      },
    });

    const recovered = await createPlanStore({ configDir }).get(created.id);

    expect(recovered).toMatchObject({
      revision: prepared.revision,
      status: "awaiting_confirmation",
      actionGate: "ready",
      projection: {
        path: description.path,
        sha256: description.sha256,
      },
    });
    expect(recovered?.projectionIntent).toBeUndefined();
    await expect(
      createPlanArtifactWriter().verify(recovered!),
    ).resolves.toBe(true);
  });

  it("samples cancellation once at projection commit and returns the stored outcome", async () => {
    const configDir = path.join(tempDir, "projection-cancel-linearization");
    const workspaceRoot = path.join(tempDir, "projection-cancel-workspace");
    await mkdir(workspaceRoot, { recursive: true });
    const store = createPlanStore({ configDir });
    const created = await store.create({ ...createRecord(), workspaceRoot });
    const artifact: PlanArtifact = {
      ...createDiagnosticArtifact("safe"),
      actionGate: "ready",
      gateReason: "ready",
    };
    const target: PlanRecord = {
      ...created,
      status: "awaiting_confirmation",
      actionGate: "ready",
      finalArtifact: artifact,
    };
    const description = await describePlanProjection(
      { ...target, revision: created.revision + 1 },
      artifact,
    );
    const prepared = await store.saveProjectionIntent(
      target,
      created.revision,
      description,
      "plan_synthesized",
    );
    const projection = await createPlanArtifactWriter().writePrepared(
      prepared,
      description,
    );
    let abortedReads = 0;
    const signal = {
      get aborted() {
        abortedReads += 1;
        return abortedReads > 1;
      },
    } as AbortSignal;

    const finalized = await store.finalizeProjectionIntent(
      prepared.id,
      prepared.revision,
      projection,
      "plan_synthesized",
      undefined,
      signal,
    );

    expect(abortedReads).toBe(1);
    expect(finalized).toMatchObject({
      status: "awaiting_confirmation",
      actionGate: "ready",
    });
    await expect(store.get(prepared.id)).resolves.toMatchObject({
      status: "awaiting_confirmation",
      actionGate: "ready",
    });
  });

  it("rejects a mismatched prepared projection before persisting or publishing it", async () => {
    const configDir = path.join(tempDir, "projection-intent-mismatch");
    const workspaceRoot = path.join(tempDir, "projection-intent-mismatch-workspace");
    await mkdir(workspaceRoot, { recursive: true });
    const store = createPlanStore({ configDir });
    const created = await store.create({ ...createRecord(), workspaceRoot });
    const artifact = createDiagnosticArtifact("safe");
    const target = {
      ...created,
      status: "awaiting_input" as const,
      actionGate: "needs_input" as const,
      finalArtifact: artifact,
    };
    const prepared = await describePlanProjection(
      { ...target, revision: created.revision + 1 },
      artifact,
    );

    await expect(store.saveProjectionIntent(
      target,
      created.revision,
      { ...prepared, sha256: "0".repeat(64) },
      "plan_synthesized",
    )).rejects.toThrow("规范化终版不一致");
    await expect(store.get(created.id)).resolves.toEqual(created);
    await expect(readFile(prepared.path, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("atomically abandons an unrecoverable projection intent so the Plan can be discarded", async () => {
    const configDir = path.join(tempDir, "projection-intent-abandon");
    const workspaceRoot = path.join(tempDir, "projection-intent-abandon-workspace");
    await mkdir(workspaceRoot, { recursive: true });
    const store = createPlanStore({ configDir });
    const created = await store.create({ ...createRecord(), workspaceRoot });
    const artifact = createDiagnosticArtifact("safe");
    const target = {
      ...created,
      status: "awaiting_input" as const,
      actionGate: "needs_input" as const,
      finalArtifact: artifact,
    };
    const prepared = await describePlanProjection(
      { ...target, revision: created.revision + 1 },
      artifact,
    );
    const pending = await store.saveProjectionIntent(
      target,
      created.revision,
      prepared,
      "plan_synthesized",
    );
    await mkdir(path.dirname(prepared.path), { recursive: true });
    await writeFile(prepared.path, "# conflicting user projection\n", {
      mode: 0o600,
    });
    expect((await store.get(created.id))?.projectionIntent).toBeDefined();

    const discarded = await store.abandonProjectionIntent(
      created.id,
      pending.revision,
      "discarded",
      "plan_projection_abandoned",
    );
    expect(discarded).toMatchObject({
      revision: pending.revision + 1,
      status: "discarded",
      actionGate: "blocked",
    });
    expect(discarded.projection).toBeUndefined();
    expect(discarded.projectionIntent).toBeUndefined();
    await expect(readFile(prepared.path, "utf8")).resolves.toBe(
      "# conflicting user projection\n",
    );
  });

  it("isolates only corrupt records and propagates systemic Plan I/O failures", async () => {
    const configDir = path.join(tempDir, "plan-io-failure");
    const store = createPlanStore({ configDir });
    const older = await store.create({
      ...createRecord(),
      id: "plan-older",
      updatedAt: "2026-07-30T00:00:00.000Z",
    });
    const latest = await store.create({
      ...createRecord(),
      id: "plan-latest",
      updatedAt: "2026-07-30T01:00:00.000Z",
    });
    const latestPath = path.join(configDir, "plans", `${latest.id}.json`);
    await chmod(latestPath, 0o000);
    try {
      await expect(store.get(latest.id)).rejects.toMatchObject({ code: "EACCES" });
      await expect(store.listAll()).rejects.toMatchObject({ code: "EACCES" });
      await expect(store.listBySession(older.sessionId)).rejects.toMatchObject({
        code: "EACCES",
      });
      await expect(store.getLatestBySession(older.sessionId)).rejects.toMatchObject({
        code: "EACCES",
      });
    } finally {
      await chmod(latestPath, 0o600);
    }
  });

  it("converts malformed JSON parser output to a content-free record error", async () => {
    const configDir = path.join(tempDir, "malformed-json-secret");
    const plansDir = path.join(configDir, "plans");
    await mkdir(plansDir, { recursive: true });
    const secret = "local-canary-parser-secret-0123456789abcdef";
    await writeFile(
      path.join(plansDir, "plan-parser-secret.json"),
      `{"secret":"${secret}",`,
      "utf8",
    );
    const store = createPlanStore({ configDir });
    const error = await store.get("plan-parser-secret").catch((caught) => caught);
    expect(error).toBeInstanceOf(InvalidPersistedPlanRecordError);
    expect(String(error)).not.toContain(secret);
  });

  it("converts malformed SQLite JSON parser output to a content-free record error", async () => {
    const storage = createStorageImpl({
      dbPath: path.join(tempDir, "malformed-sqlite-secret.sqlite"),
      skipFts5Check: true,
    });
    const store = createPlanStore({
      configDir: path.join(tempDir, "sqlite-unused"),
      storage,
    });
    const secret = "local-canary-sqlite-parser-secret-0123456789abcdef";
    try {
      storage.db.prepare(
        `INSERT INTO plan_records
          (id, session_id, mode, status, action_gate, revision, payload, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "plan-sqlite-parser-secret",
        "session-store-test",
        "direct",
        "drafting",
        "blocked",
        1,
        `{"secret":"${secret}",`,
        "2026-07-30T00:00:00.000Z",
        "2026-07-30T00:00:00.000Z",
      );
      const error = await store.get("plan-sqlite-parser-secret")
        .catch((caught) => caught);
      expect(error).toBeInstanceOf(InvalidPersistedPlanRecordError);
      expect(String(error)).not.toContain(secret);
    } finally {
      storage.close();
    }
  });

  it("binds decoded payload identity to its JSON or SQLite storage envelope", async () => {
    const jsonConfigDir = path.join(tempDir, "plan-envelope-json");
    const json = createPlanStore({ configDir: jsonConfigDir });
    const safe = await json.create({
      ...createRecord(),
      id: "plan-safe-envelope",
    });
    const other = await json.create({
      ...createRecord(),
      id: "plan-other-envelope",
      sessionId: "session-other-envelope",
    });
    await writeFile(
      path.join(jsonConfigDir, "plans", `${safe.id}.json`),
      JSON.stringify({ ...safe, id: "../cross-record" }),
      "utf8",
    );
    await expect(json.get(safe.id)).rejects.toBeInstanceOf(
      InvalidPersistedPlanRecordError,
    );
    await expect(json.listAll()).resolves.toEqual([other]);

    const storage = createStorageImpl({
      dbPath: path.join(tempDir, "plan-envelope.sqlite"),
      skipFts5Check: true,
    });
    const sqlite = createPlanStore({
      configDir: path.join(tempDir, "plan-envelope-sqlite-unused"),
      storage,
    });
    try {
      const victim = await sqlite.create({
        ...createRecord(),
        id: "plan-envelope-victim",
        sourceMessage: "VICTIM",
      });
      const rogue = await sqlite.create({
        ...createRecord(),
        id: "plan-envelope-rogue",
        sessionId: "session-envelope-rogue",
        sourceMessage: "ROGUE",
      });
      storage.db.prepare("UPDATE plan_records SET payload = ? WHERE id = ?")
        .run(JSON.stringify({
          ...rogue,
          id: victim.id,
          rawDiagnostic: "force-migration",
        }), rogue.id);
      await expect(sqlite.get(rogue.id)).rejects.toBeInstanceOf(
        InvalidPersistedPlanRecordError,
      );
      await expect(sqlite.get(victim.id)).resolves.toMatchObject({
        id: victim.id,
        sourceMessage: "VICTIM",
      });

      const older = await sqlite.create({
        ...createRecord(),
        id: "plan-envelope-older",
        sessionId: "session-envelope-order",
        updatedAt: "2026-07-30T01:00:00.000Z",
      });
      const newer = await sqlite.create({
        ...createRecord(),
        id: "plan-envelope-newer",
        sessionId: "session-envelope-order",
        updatedAt: "2026-07-30T02:00:00.000Z",
      });
      storage.db.prepare(
        "UPDATE plan_records SET updated_at = ? WHERE id = ?",
      ).run("9999-12-31T23:59:59.999Z", older.id);
      await expect(
        sqlite.getLatestBySession("session-envelope-order"),
      ).resolves.toMatchObject({ id: newer.id });
      await expect(
        sqlite.listBySession("session-envelope-order"),
      ).resolves.toEqual([expect.objectContaining({ id: newer.id })]);

      storage.db.prepare(
        "UPDATE plan_records SET session_id = ? WHERE id = ?",
      ).run("session-envelope-mismatch", victim.id);
      await expect(sqlite.get(victim.id)).rejects.toBeInstanceOf(
        InvalidPersistedPlanRecordError,
      );
    } finally {
      storage.close();
    }
  });

  it("quarantines malformed JSON Plans without blocking valid list queries", async () => {
    const configDir = path.join(tempDir, "malformed-json");
    const store = createPlanStore({ configDir });
    const valid = await store.create(createRecord());
    const malformedRecords = [
      {
        ...createRecord(),
        id: "plan-malformed-issue",
        goalContractIssues: [null],
      },
      {
        ...createRecord(),
        id: "plan-malformed-contract",
        goalContractSnapshot: {},
      },
      {
        ...createRecord(),
        id: "plan-malformed-skill",
        selectedSkill: { manifest: { inputs: [], permissions: {} } },
      },
      {
        ...createRecord(),
        id: "plan-malformed-requested-skill",
        requestedSkillName: { rawDiagnostic: "secret" },
      },
      {
        ...createRecord(),
        id: "plan-malformed-skill-entrypoint",
        selectedSkill: {
          ...createPrivateSkillSnapshot(),
          manifest: {
            ...createPrivateSkillSnapshot().manifest,
            execution: { mode: "agent", entrypoint: { rawDiagnostic: "secret" } },
          },
        },
      },
      {
        ...createRecord(),
        id: "plan-malformed-skill-default",
        selectedSkill: {
          ...createPrivateSkillSnapshot(),
          manifest: {
            ...createPrivateSkillSnapshot().manifest,
            inputs: [{
              name: "count",
              label: "Count",
              type: "number",
              required: false,
              defaultValue: { rawDiagnostic: "secret" },
            }],
          },
        },
      },
      {
        ...createRecord(),
        id: "plan-malformed-selected-skill-input-values",
        selectedSkillInputValues: {
          token: { rawDiagnostic: "secret" },
        } as unknown as PlanRecord["selectedSkillInputValues"],
      },
      {
        ...createRecord(),
        id: "plan-malformed-decision-input-values",
        skillDecision: {
          source: "none",
          reason: "none",
          evidenceRefs: [],
          alternatives: [],
          inputValues: { token: { rawDiagnostic: "secret" } },
          inputEvidenceRefs: {},
          missingInputFields: [],
          invalidInputFields: [],
        } as unknown as PlanRecord["skillDecision"],
      },
      {
        ...createRecord(),
        id: "plan-malformed-brief-input-values",
        planningBrief: {
          objective: "test",
          deliverables: [],
          inScope: [],
          outOfScope: [],
          constraints: [],
          assumptions: [],
          unresolvedQuestions: [],
          targetRefs: [],
          evidenceRefs: [],
          skillCandidates: [],
          recommendedSkillInputValues: {
            token: { rawDiagnostic: "secret" },
          },
        } as unknown as PlanRecord["planningBrief"],
      },
    ];
    for (const malformed of malformedRecords) {
      await writeFile(
        path.join(configDir, "plans", `${malformed.id}.json`),
        JSON.stringify(malformed),
        "utf8",
      );
      await expect(store.get(malformed.id)).rejects.toBeInstanceOf(
        InvalidPersistedPlanRecordError,
      );
    }
    await expect(store.listAll()).resolves.toEqual([valid]);
    await expect(store.listBySession(valid.sessionId)).resolves.toEqual([valid]);
  });

  it("quarantines malformed SQLite Plans and skips a corrupt newest session record", async () => {
    const storage = createStorageImpl({
      dbPath: path.join(tempDir, "malformed.sqlite"),
      skipFts5Check: true,
    });
    const store = createPlanStore({
      configDir: path.join(tempDir, "sqlite-unused"),
      storage,
    });
    try {
      const valid = await store.create(createRecord());
      const malformed = {
        ...createRecord(),
        id: "plan-malformed-sqlite",
        selectedSkill: { manifest: { inputs: [], permissions: {} } },
        updatedAt: "2026-07-30T01:00:00.000Z",
      };
      storage.db.prepare(
        `INSERT INTO plan_records
          (id, session_id, mode, status, action_gate, revision, payload, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        malformed.id,
        malformed.sessionId,
        malformed.mode,
        malformed.status,
        malformed.actionGate,
        malformed.revision,
        JSON.stringify(malformed),
        malformed.createdAt,
        malformed.updatedAt,
      );

      await expect(store.get(malformed.id)).rejects.toBeInstanceOf(
        InvalidPersistedPlanRecordError,
      );
      await expect(store.listAll()).resolves.toEqual([valid]);
      await expect(store.listBySession(valid.sessionId)).resolves.toEqual([
        valid,
      ]);
      await expect(store.getLatestBySession(valid.sessionId)).resolves.toEqual(
        valid,
      );
    } finally {
      storage.close();
    }
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

function createPrivateSkillSnapshot(): SkillRecord {
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
          args: ["server.js", "--token", "PLAN_ARGS_SECRET"],
          env: { PRIVATE_TOKEN: "PLAN_STDIO_SECRET" },
        },
        {
          name: "remote-private",
          transport: "sse",
          url: "https://user:PLAN_URL_SECRET@mcp.example.test/events?token=secret",
          headers: { authorization: "PLAN_REMOTE_SECRET" },
        },
      ],
    },
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
