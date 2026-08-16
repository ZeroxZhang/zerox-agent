import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Goal } from "../../shared/agentGoal";
import type { AgentExecutionCheckpoint } from "../../shared/agentExecution";
import type { MemoryRecord } from "../../shared/memory";
import { createAgentExecutionStore } from "../agentExecutionStore";
import { createAgentGoalStore } from "../agentGoalStore";
import { createStorageImpl } from "./storageDb";
import { bootstrapSqliteDomainAuthority } from "./domainAuthorityBootstrap";
import {
  createEvalCandidateRepository,
  createLearningRepository,
  createPromotedEvalFixtureRepository,
  createWorkspaceRepository,
} from "./repositories";
import { createMemoryRepository } from "./repositories/memoryRepository";
import { createSessionRepository } from "./repositories/sessionRepository";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("SQLite domain authority bootstrap", () => {
  it("imports every P97 JSON authority once and persists durable markers", async () => {
    const configDir = await createLegacyFixture();
    const storage = createStorageImpl({
      dbPath: path.join(configDir, "zerox.db"),
    });

    const first = await bootstrapSqliteDomainAuthority({
      configDir,
      storage,
      now: () => new Date("2026-08-16T19:30:00.000Z"),
    });

    expect(first.imported).toEqual([
      "goal",
      "execution_checkpoint",
      "memory",
      "workspace",
      "multi_agent_session",
      "learning_candidate",
      "eval_candidate",
      "promoted_eval_fixture",
    ]);
    await expect(
      createAgentGoalStore({
        configDir,
        backend: "sqlite",
        storage,
      }).get("goal_bootstrap"),
    ).resolves.toMatchObject({ id: "goal_bootstrap", status: "executing" });
    await expect(
      createAgentExecutionStore({
        configDir,
        backend: "sqlite",
        storage,
      }).get("run_bootstrap"),
    ).resolves.toMatchObject({ runId: "run_bootstrap", status: "paused" });
    expect(
      createMemoryRepository(storage).get("memory_bootstrap"),
    ).toMatchObject({ id: "memory_bootstrap" });
    expect(
      createWorkspaceRepository(storage).get("workspace_bootstrap"),
    ).toMatchObject({ id: "workspace_bootstrap" });
    expect(
      createSessionRepository(storage).getSession("session_bootstrap"),
    ).toMatchObject({
      id: "session_bootstrap",
      childRunIds: ["run_child"],
    });
    expect(createLearningRepository(storage).list()).toHaveLength(1);
    expect(createEvalCandidateRepository(storage).list()).toHaveLength(1);
    expect(createPromotedEvalFixtureRepository(storage).list()).toHaveLength(1);
    expect(
      storage.db
        .prepare("SELECT COUNT(*) AS count FROM domain_authority_state")
        .get(),
    ).toEqual({ count: 8 });

    await writeJson(path.join(configDir, "memory-records.json"), {
      schemaVersion: 1,
      records: [
        createMemoryRecord("memory_stale_shadow"),
      ],
    });
    createMemoryRepository(storage).delete("memory_bootstrap");
    const second = await bootstrapSqliteDomainAuthority({
      configDir,
      storage,
    });
    expect(second.imported).toEqual([]);
    expect(second.existing).toHaveLength(8);
    expect(createMemoryRepository(storage).list({ includeArchived: true })).toEqual(
      [],
    );
    storage.close();
  });

  it("does not mark a domain when legacy import fails", async () => {
    const configDir = await mkdtemp(
      path.join(os.tmpdir(), "zerox-domain-bootstrap-failure-"),
    );
    roots.push(configDir);
    const goalsDir = path.join(configDir, "agent-goals");
    await mkdir(goalsDir, { recursive: true });
    const importableGoal = createGoal("goal_a_importable");
    await writeJson(
      path.join(goalsDir, `${importableGoal.id}.json`),
      importableGoal,
    );
    await writeFile(
      path.join(goalsDir, "goal_z_bad.json"),
      "{not valid json",
      "utf8",
    );
    const storage = createStorageImpl({
      dbPath: path.join(configDir, "zerox.db"),
    });
    const goalStore = createAgentGoalStore({
      configDir,
      backend: "sqlite",
      storage,
    });
    await goalStore.save(createGoal("goal_existing_sqlite"));

    await expect(
      bootstrapSqliteDomainAuthority({ configDir, storage }),
    ).rejects.toThrow();
    await expect(goalStore.get("goal_existing_sqlite")).resolves.toMatchObject({
      id: "goal_existing_sqlite",
    });
    await expect(goalStore.get(importableGoal.id)).resolves.toBeNull();
    expect(
      storage.db
        .prepare(
          "SELECT COUNT(*) AS count FROM domain_authority_state WHERE domain = 'goal'",
        )
        .get(),
    ).toEqual({ count: 0 });
    storage.close();
  });

  it("rejects stale legacy JSON instead of replacing a newer SQLite generation", async () => {
    const configDir = await mkdtemp(
      path.join(os.tmpdir(), "zerox-domain-bootstrap-conflict-"),
    );
    roots.push(configDir);
    const staleMemory = {
      ...createMemoryRecord("memory_conflict"),
      content: "stale JSON",
      updatedAt: "2026-08-16T19:00:01.000Z",
    };
    await writeJson(path.join(configDir, "memory-records.json"), {
      schemaVersion: 1,
      records: [staleMemory],
    });
    const storage = createStorageImpl({
      dbPath: path.join(configDir, "zerox.db"),
    });
    const repository = createMemoryRepository(storage);
    repository.write({
      ...staleMemory,
      content: "newer SQLite",
      updatedAt: "2026-08-16T19:00:02.000Z",
    });

    await expect(
      bootstrapSqliteDomainAuthority({ configDir, storage }),
    ).rejects.toThrow(/mixed-generation conflict for memory/);
    expect(repository.get(staleMemory.id)).toMatchObject({
      content: "newer SQLite",
      updatedAt: "2026-08-16T19:00:02.000Z",
    });
    expect(
      storage.db
        .prepare(
          "SELECT COUNT(*) AS count FROM domain_authority_state WHERE domain = 'memory'",
        )
        .get(),
    ).toEqual({ count: 0 });
    storage.close();
  });

  it("rolls back a Goal import when any ledger line is malformed", async () => {
    const configDir = await mkdtemp(
      path.join(os.tmpdir(), "zerox-domain-bootstrap-ledger-"),
    );
    roots.push(configDir);
    const goalsDir = path.join(configDir, "agent-goals");
    await mkdir(goalsDir, { recursive: true });
    const goal = createGoal("goal_ledger_failure");
    await writeJson(path.join(goalsDir, `${goal.id}.json`), goal);
    await writeFile(
      path.join(goalsDir, `${goal.id}.ledger.jsonl`),
      [
        JSON.stringify({
          at: "2026-08-16T19:00:01.000Z",
          kind: "goal_planned",
          summary: "Valid prefix",
        }),
        "{malformed",
        "",
      ].join("\n"),
      "utf8",
    );
    const storage = createStorageImpl({
      dbPath: path.join(configDir, "zerox.db"),
    });

    await expect(
      bootstrapSqliteDomainAuthority({ configDir, storage }),
    ).rejects.toThrow(/JSONL bootstrap parse failed/);
    await expect(
      createAgentGoalStore({
        configDir,
        backend: "sqlite",
        storage,
      }).get(goal.id),
    ).resolves.toBeNull();
    expect(
      storage.db
        .prepare(
          "SELECT COUNT(*) AS count FROM domain_authority_state WHERE domain = 'goal'",
        )
        .get(),
    ).toEqual({ count: 0 });
    storage.close();
  });

  it("reimports explicitly rolled-back JSON authority before restoring SQLite markers", async () => {
    const configDir = await mkdtemp(
      path.join(os.tmpdir(), "zerox-domain-bootstrap-json-rollback-"),
    );
    roots.push(configDir);
    await writeJson(path.join(configDir, "memory-records.json"), {
      schemaVersion: 1,
      records: [],
    });
    const storage = createStorageImpl({
      dbPath: path.join(configDir, "zerox.db"),
    });
    const repository = createMemoryRepository(storage);
    repository.write(createMemoryRecord("memory_removed_during_rollback"));
    storage.db
      .prepare(
        `INSERT INTO domain_authority_state (domain, source, imported_at)
         VALUES ('memory', 'json_rollback', ?)`,
      )
      .run("2026-08-16T19:00:00.000Z");

    await expect(
      bootstrapSqliteDomainAuthority({ configDir, storage }),
    ).resolves.toMatchObject({
      imported: expect.arrayContaining(["memory"]),
    });
    expect(repository.list({ includeArchived: true })).toEqual([]);
    expect(
      storage.db
        .prepare(
          "SELECT source FROM domain_authority_state WHERE domain = 'memory'",
        )
        .get(),
    ).toEqual({ source: "json_rollback_import" });
    storage.close();
  });
});

function createGoal(id: string): Goal {
  return {
    id,
    description: "Bootstrap Goal",
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
    reviewPolicy: "review_final_only",
    planVersion: 1,
    createdAt: "2026-08-16T19:00:00.000Z",
    updatedAt: "2026-08-16T19:00:00.000Z",
  };
}

async function createLegacyFixture(): Promise<string> {
  const configDir = await mkdtemp(
    path.join(os.tmpdir(), "zerox-domain-bootstrap-"),
  );
  roots.push(configDir);
  const goalsDir = path.join(configDir, "agent-goals");
  const executionsDir = path.join(configDir, "agent-executions");
  await Promise.all([
    mkdir(goalsDir, { recursive: true }),
    mkdir(executionsDir, { recursive: true }),
  ]);
  const goal = createGoal("goal_bootstrap");
  const checkpoint: AgentExecutionCheckpoint = {
    id: "checkpoint_bootstrap",
    runId: "run_bootstrap",
    taskId: "task_bootstrap",
    status: "paused",
    steps: [],
    messages: [],
    toolCallCount: 0,
    createdAt: "2026-08-16T19:00:00.000Z",
    updatedAt: "2026-08-16T19:00:00.000Z",
  };
  await Promise.all([
    writeJson(path.join(goalsDir, `${goal.id}.json`), goal),
    writeJson(
      path.join(executionsDir, `${checkpoint.runId}.json`),
      checkpoint,
    ),
    writeJson(path.join(configDir, "memory-records.json"), {
      schemaVersion: 1,
      records: [createMemoryRecord("memory_bootstrap")],
    }),
    writeJson(path.join(configDir, "agent-workspaces.json"), {
      schemaVersion: 1,
      workspaces: [
        {
          id: "workspace_bootstrap",
          name: "Bootstrap",
          rootPath: configDir,
          kind: "project",
          cleanup: "keep",
          createdAt: "2026-08-16T19:00:00.000Z",
          updatedAt: "2026-08-16T19:00:00.000Z",
          lastUsedAt: null,
        },
      ],
    }),
    writeJson(path.join(configDir, "multi-agent-sessions.json"), {
      schemaVersion: 1,
      sessions: [
        {
          id: "session_bootstrap",
          title: "Bootstrap",
          status: "running",
          workspaceId: "workspace_bootstrap",
          createdAt: "2026-08-16T19:00:00.000Z",
          updatedAt: "2026-08-16T19:00:00.000Z",
          childRunIds: ["run_child"],
          roles: { run_child: "worker" },
        },
      ],
    }),
    writeJson(path.join(configDir, "agent-learning-candidates.json"), {
      schemaVersion: 1,
      candidates: [
        {
          id: "learning_bootstrap",
          type: "failure_lesson",
          status: "pending_review",
          sourceRunId: "run_bootstrap",
          sourceTrajectoryEventIds: [],
          claim: "Bootstrap learning",
          recommendedAction: "Keep",
          risk: "low",
          createdAt: "2026-08-16T19:00:00.000Z",
          updatedAt: "2026-08-16T19:00:00.000Z",
        },
      ],
    }),
    writeJson(path.join(configDir, "agent-eval-candidates.json"), {
      schemaVersion: 1,
      candidates: [
        {
          id: "eval_bootstrap",
          sourceRunId: "run_bootstrap",
          status: "accepted",
          rationale: "Bootstrap",
          fixture: {
            id: "fixture_bootstrap",
            description: "Bootstrap fixture",
            events: [],
            requiredEventTypes: [],
          },
          createdAt: "2026-08-16T19:00:00.000Z",
          updatedAt: "2026-08-16T19:00:00.000Z",
        },
      ],
    }),
    writeJson(path.join(configDir, "agent-promoted-eval-fixtures.json"), {
      schemaVersion: 1,
      fixtures: [
        {
          id: "promoted_bootstrap",
          description: "Promoted bootstrap",
          events: [],
          requiredEventTypes: [],
        },
      ],
    }),
  ]);
  return configDir;
}

function createMemoryRecord(id: string): MemoryRecord {
  return {
    id,
    kind: "semantic",
    title: id,
    content: "Bootstrap memory",
    tags: [],
    source: { type: "manual" as const },
    importance: 3,
    createdAt: "2026-08-16T19:00:00.000Z",
    updatedAt: "2026-08-16T19:00:00.000Z",
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
