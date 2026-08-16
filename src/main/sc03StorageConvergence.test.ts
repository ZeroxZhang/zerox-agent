import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  AgentExecutionCheckpoint,
  AgentExecutionStatus,
} from "../shared/agentExecution";
import type { Goal, GoalStatus, SuccessCriterion } from "../shared/agentGoal";
import type { Storage, StorageBackend } from "../shared/storageContract";
import { createAgentExecutionStore } from "./agentExecutionStore";
import { createGoalAcceptanceCertificate } from "./agentGoalAcceptanceCertificate";
import { createAgentGoalStore } from "./agentGoalStore";
import {
  createGoalContractRef,
  deriveLegacyGoalContract,
} from "./goalPlanContractService";
import { createCheckpointRepository } from "./storage/repositories/checkpointRepository";
import { createStorageImpl } from "./storage/storageDb";

const roots: string[] = [];
const openStorage = new Set<Storage>();
const backends: StorageBackend[] = ["json", "sqlite", "dual"];

afterEach(async () => {
  for (const storage of openStorage) {
    storage.close();
  }
  openStorage.clear();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe.each(backends)("SC03 %s contract", (backend) => {
  it("preserves Goal CAS, certificate, ledger, and canonical shadow semantics", async () => {
    const fixture = await createFixture(backend);
    const store = createAgentGoalStore(fixture);
    const base = createGoal("goal_contract", "executing");
    const activePlanRef = {
      planId: "plan-v1",
      planRevision: 1,
      goalPlanVersion: 1,
      mode: "direct" as const,
      purpose: "initial" as const,
      goalContractRef: base.goalContractRef!,
    };
    const initial: Goal = {
      ...base,
      chatSessionId: "chat_contract",
      activePlanRef,
      planHistory: [
        {
          ...activePlanRef,
          trigger: {
            kind: "initial_request",
            summary: "Initial Plan",
            evidenceRefs: [],
            at: base.createdAt,
          },
          outcome: "active",
          adoptedAt: base.createdAt,
        },
      ],
    };
    await store.save(initial);

    const candidate = (planId: string): Goal => ({
      ...initial,
      planVersion: 2,
      activePlanRef: {
        ...activePlanRef,
        planId,
        goalPlanVersion: 2,
        purpose: "runtime_replan",
      },
      updatedAt: "2026-08-16T01:00:00.000Z",
    });
    const planResults = await Promise.all([
      store.saveIfPlanVersion(candidate("plan-v2-a"), 1, "plan-v1"),
      store.saveIfPlanVersion(candidate("plan-v2-b"), 1, "plan-v1"),
    ]);
    expect(planResults.filter((result) => result.saved)).toHaveLength(1);
    expect(await store.getMany(["missing", initial.id, initial.id])).toEqual([
      expect.objectContaining({
        id: initial.id,
        planVersion: 2,
        activePlanRef: expect.objectContaining({ planId: "plan-v2-a" }),
      }),
    ]);

    const planned = {
      at: "2026-08-16T01:01:00.000Z",
      kind: "goal_replanned" as const,
      summary: "Adopted Plan v2.",
    };
    const certified = {
      at: "2026-08-16T01:02:00.000Z",
      kind: "acceptance_certified" as const,
      summary: "Acceptance certificate published.",
    };
    await store.appendLedger(initial.id, planned);
    const publicationResults = await Promise.all([
      store.appendLedgerIfAbsent(
        initial.id,
        "acceptance:certified:v2",
        certified,
      ),
      store.appendLedgerIfAbsent(
        initial.id,
        "acceptance:certified:v2",
        certified,
      ),
    ]);
    expect(publicationResults.sort()).toEqual([false, true]);
    expect(await store.readLedger(initial.id)).toEqual([
      planned,
      { ...certified, publicationKey: "acceptance:certified:v2" },
    ]);

    const executingV2 = createProtocolV2Goal(
      "goal_certificate",
      "executing",
    );
    await store.save(executingV2);
    const validAchievement = createCertifiedGoal(executingV2);
    const invalidAchievement = structuredClone(validAchievement);
    invalidAchievement.acceptanceCertificate!.evidence[0]!.sha256 =
      "0".repeat(64);
    await expect(store.save(invalidAchievement)).resolves.toEqual(executingV2);
    await expect(store.save(validAchievement)).resolves.toEqual(
      validAchievement,
    );
    await expect(
      store.save({
        ...executingV2,
        planVersion: 9,
        updatedAt: "2026-08-16T01:03:00.000Z",
      }),
    ).resolves.toEqual(validAchievement);

    await store.flushShadowWrites();
    if (backend === "dual") {
      const shadow = JSON.parse(
        await readFile(
          path.join(
            fixture.configDir,
            "agent-goals",
            `${validAchievement.id}.json`,
          ),
          "utf8",
        ),
      ) as Goal;
      expect(shadow).toEqual(validAchievement);
    }
    if (fixture.storage) {
      const ledgerRows = fixture.storage.db
        .prepare(
          `SELECT seq, publication_key
           FROM goal_ledger
           WHERE goal_id = ?
           ORDER BY seq ASC`,
        )
        .all(initial.id);
      expect(ledgerRows).toEqual([
        { seq: 1, publication_key: null },
        { seq: 2, publication_key: "acceptance:certified:v2" },
      ]);
    }
  });

  it("preserves AgentExecution runtime-only operations and succeeded filtering", async () => {
    const fixture = await createFixture(backend);
    const store = createAgentExecutionStore(fixture);
    const running = createCheckpoint("run_running", "running");
    const succeeded = createCheckpoint("run_succeeded", "succeeded");

    if (fixture.storage) {
      createCheckpointRepository(fixture.storage).write(
        succeeded.runId,
        "markdown",
        { summary: "Keep this non-runtime checkpoint." },
      );
    }
    await Promise.all([store.save(running), store.save(succeeded)]);

    await expect(store.listActive()).resolves.toEqual([running]);
    await expect(store.get(succeeded.runId)).resolves.toEqual(succeeded);
    const staleRunning = {
      ...succeeded,
      id: "checkpoint_stale_running",
      status: "running" as const,
      updatedAt: "2026-08-16T23:59:59.000Z",
    };
    await expect(store.save(staleRunning)).resolves.toEqual(succeeded);
    await expect(store.get(succeeded.runId)).resolves.toEqual(succeeded);
    await expect(store.listActive()).resolves.toEqual([running]);
    await expect(store.delete(succeeded.runId)).resolves.toBe(true);
    await expect(store.get(succeeded.runId)).resolves.toBeNull();
    if (fixture.storage) {
      expect(
        createCheckpointRepository(fixture.storage).latest(
          succeeded.runId,
          "markdown",
        ),
      ).not.toBeNull();
    }

    await store.flushShadowWrites();
    if (backend === "dual") {
      const shadow = JSON.parse(
        await readFile(
          path.join(
            fixture.configDir,
            "agent-executions",
            `${running.runId}.json`,
          ),
          "utf8",
        ),
      ) as AgentExecutionCheckpoint;
      expect(shadow).toEqual(running);
    }
  });

  it("recovers Goal, ledger, and AgentExecution state after restart", async () => {
    const fixture = await createFixture(backend);
    const goalStore = createAgentGoalStore(fixture);
    const executionStore = createAgentExecutionStore(fixture);
    const goal = createGoal("goal_restart", "executing");
    const checkpoint = createCheckpoint("run_restart", "paused");

    await goalStore.save(goal);
    await goalStore.appendLedger(goal.id, {
      at: "2026-08-16T02:00:00.000Z",
      kind: "milestone_started",
      summary: "Started before restart.",
    });
    await executionStore.save(checkpoint);
    await Promise.all([
      goalStore.flushShadowWrites({ close: true }),
      executionStore.flushShadowWrites({ close: true }),
    ]);

    if (fixture.storage) closeStorage(fixture.storage);
    const restartedStorage =
      backend === "json"
        ? undefined
        : trackStorage(
            createStorageImpl({
              dbPath: path.join(fixture.configDir, "zerox.db"),
            }),
          );
    const restartedGoalStore = createAgentGoalStore({
      configDir: fixture.configDir,
      backend,
      ...(restartedStorage ? { storage: restartedStorage } : {}),
    });
    const restartedExecutionStore = createAgentExecutionStore({
      configDir: fixture.configDir,
      backend,
      ...(restartedStorage ? { storage: restartedStorage } : {}),
    });

    await expect(restartedGoalStore.get(goal.id)).resolves.toEqual(goal);
    await expect(restartedGoalStore.readLedger(goal.id)).resolves.toHaveLength(
      1,
    );
    await expect(
      restartedExecutionStore.get(checkpoint.runId),
    ).resolves.toEqual(checkpoint);
  });
});

describe("SC03 dual shadow failures", () => {
  it("keeps committed Goal authority and closes admission after shadow failure", async () => {
    const fixture = await createFixture("dual");
    await writeFile(
      path.join(fixture.configDir, "agent-goals"),
      "blocks shadow directory",
      "utf8",
    );
    const store = createAgentGoalStore(fixture);
    const goal = createGoal("goal_shadow_failure", "executing");

    await expect(store.save(goal)).resolves.toEqual(goal);
    await expect(
      store.flushShadowWrites({ close: true }),
    ).rejects.toMatchObject({ code: expect.stringMatching(/EEXIST|ENOTDIR/) });
    await expect(store.get(goal.id)).resolves.toEqual(goal);
    await expect(
      store.save({ ...goal, updatedAt: "2026-08-16T03:00:00.000Z" }),
    ).rejects.toThrow("Persistence queue is closed");
  });

  it("keeps committed runtime authority and reports checkpoint shadow failure", async () => {
    const fixture = await createFixture("dual");
    await writeFile(
      path.join(fixture.configDir, "agent-executions"),
      "blocks shadow directory",
      "utf8",
    );
    const store = createAgentExecutionStore(fixture);
    const checkpoint = createCheckpoint("run_shadow_failure", "running");

    await expect(store.save(checkpoint)).resolves.toEqual(checkpoint);
    await expect(store.flushShadowWrites()).rejects.toMatchObject({
      code: expect.stringMatching(/EEXIST|ENOTDIR/),
    });
    await expect(store.get(checkpoint.runId)).resolves.toEqual(checkpoint);
  });
});

async function createFixture(backend: StorageBackend): Promise<{
  configDir: string;
  backend: StorageBackend;
  storage?: Storage;
}> {
  const configDir = await mkdtemp(path.join(os.tmpdir(), "zerox-sc03-"));
  roots.push(configDir);
  if (backend === "json") return { configDir, backend };
  return {
    configDir,
    backend,
    storage: trackStorage(
      createStorageImpl({ dbPath: path.join(configDir, "zerox.db") }),
    ),
  };
}

function trackStorage(storage: Storage): Storage {
  openStorage.add(storage);
  return storage;
}

function closeStorage(storage: Storage): void {
  if (!openStorage.delete(storage)) return;
  storage.close();
}

const criterion: SuccessCriterion = {
  id: "criterion_done",
  description: "The local artifact is accepted.",
  acceptanceChecks: [
    {
      id: "check_file",
      kind: "file_exists",
      description: "The expected artifact exists.",
      params: { path: "artifact.md" },
      requiresEvidence: false,
    },
  ],
};

function createGoal(id: string, status: GoalStatus): Goal {
  const goal: Goal = {
    id,
    description: "Complete a bounded local goal.",
    successCriteria: [criterion],
    milestones: [
      {
        id: "milestone_1",
        description: "Create the artifact.",
        dependsOn: [],
        successCriteria: [criterion],
        state: status === "planning" ? "pending" : "ready",
        runIds: [],
        attempts: 0,
      },
    ],
    status,
    executionUsage: {
      iterations: 0,
      toolCalls: 0,
      wallClockMs: 0,
      tokens: 0,
      replans: 0,
    },
    reviewPolicy: "review_final_only",
    planVersion: 1,
    createdAt: "2026-08-16T00:00:00.000Z",
    updatedAt: "2026-08-16T00:00:00.000Z",
  };
  const goalContractSnapshot = deriveLegacyGoalContract(goal);
  return {
    ...goal,
    goalContractSnapshot,
    goalContractRef: createGoalContractRef(goalContractSnapshot),
  };
}

function createProtocolV2Goal(id: string, status: GoalStatus): Goal {
  return {
    ...createGoal(id, status),
    acceptanceProtocolVersion: 2,
    acceptanceState: {
      protocolVersion: 2,
      phase: status === "achieved" ? "certified" : "idle",
      attempt: 0,
      recentFailures: [],
    },
  };
}

function createCertifiedGoal(executing: Goal): Goal {
  const acceptanceCertificate = createGoalAcceptanceCertificate({
    goal: executing,
    acceptedAt: "2026-08-16T01:10:00.000Z",
    runIds: ["run_certificate"],
    checkResults: [
      {
        checkId: "check_file",
        kind: "file_exists",
        passed: true,
        code: "accepted",
        evidenceRefs: ["artifact:goal"],
        detail: "Accepted by the SC03 contract fixture.",
      },
    ],
    evidenceManifest: {
      version: 1,
      generatedAt: "2026-08-16T01:09:00.000Z",
      artifacts: [
        {
          ref: "artifact:goal",
          path: "/workspace/artifact.md",
          mediaType: "text/markdown",
          sizeBytes: 12,
          sha256: "a".repeat(64),
          excerpts: [],
        },
      ],
      totalRenderedChars: 10,
      truncated: false,
    },
    provenanceRefs: {
      "artifact:goal": ["trajectory_certificate"],
    },
  });
  return {
    ...structuredClone(executing),
    status: "achieved",
    stopReason: "goal_accepted",
    acceptanceState: {
      protocolVersion: 2,
      phase: "certified",
      attempt: 1,
      recentFailures: [],
    },
    acceptanceCertificate,
    updatedAt: "2026-08-16T01:10:00.000Z",
  };
}

function createCheckpoint(
  runId: string,
  status: AgentExecutionStatus,
): AgentExecutionCheckpoint {
  return {
    id: `checkpoint_${runId}`,
    runId,
    taskId: `task_${runId}`,
    status,
    currentStepId: "step_1",
    steps: [
      {
        id: "step_1",
        description: "Inspect the workspace.",
        expectedOutcome: "Workspace state is known.",
        state: status === "queued" ? "pending" : "running",
        attempts: status === "queued" ? 0 : 1,
      },
    ],
    messages: [{ role: "user", content: "Inspect the workspace." }],
    toolCallCount: status === "queued" ? 0 : 1,
    createdAt: "2026-08-16T00:00:00.000Z",
    updatedAt:
      status === "running"
        ? "2026-08-16T00:02:00.000Z"
        : "2026-08-16T00:01:00.000Z",
  };
}
