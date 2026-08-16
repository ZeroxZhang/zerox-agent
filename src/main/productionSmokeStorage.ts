import { access } from "node:fs/promises";
import path from "node:path";
import type { Goal } from "../shared/agentGoal";
import type { ScheduledTaskStore } from "./taskStore";
import type {
  Storage,
  StorageBackend,
} from "../shared/storageContract";
import {
  productionStorageAuthorityDomains,
  type ProductionStorageAuthorityDomain,
  type ProductionStorageSmokeEvidence,
} from "../shared/productionSmoke";
import type { AgentEvalCandidateStore } from "./agentEvalCandidateStore";
import type { AgentExecutionStore } from "./agentExecutionStore";
import type { AgentGoalStore } from "./agentGoalStore";
import type { AgentLearningStore } from "./agentLearningStore";
import type { AgentWorkspaceStore } from "./agentWorkspaceStore";
import type { PromotedAgentEvalFixtureStore } from "./eval/agentPromotedEvalFixtures";
import type { MemoryStore } from "./memoryStore";
import type { MultiAgentSessionStore } from "./multiAgentSessionStore";

type RuntimeVersions = {
  electron?: string;
  modules?: string;
  node?: string;
};

export async function runProductionStorageSmokeProbe(options: {
  configDir: string;
  requestedBackend: StorageBackend;
  resolvedBackend: StorageBackend;
  runtimeVersions: RuntimeVersions;
  storage: Storage | null;
  taskStore: ScheduledTaskStore;
  goalStore: AgentGoalStore;
  executionStore: AgentExecutionStore;
  memoryStore: MemoryStore;
  workspaceStore: AgentWorkspaceStore;
  multiAgentSessionStore: MultiAgentSessionStore;
  learningStore: AgentLearningStore;
  evalCandidateStore: AgentEvalCandidateStore;
  promotedFixtureStore: PromotedAgentEvalFixtureStore;
  createId?: () => string;
}): Promise<ProductionStorageSmokeEvidence> {
  if (options.requestedBackend !== "sqlite") {
    throw new Error(
      `Production storage smoke requires requested backend "sqlite"; received "${options.requestedBackend}".`,
    );
  }
  if (options.resolvedBackend !== "sqlite" || !options.storage) {
    throw new Error(
      `Production storage smoke rejected storage fallback: requested=sqlite resolved=${options.resolvedBackend}.`,
    );
  }
  if (!options.runtimeVersions.electron) {
    throw new Error("Production storage smoke must execute inside Electron.");
  }

  const taskId = options.createId?.() ?? `production_smoke_${Date.now()}`;
  const taskName = `Production SQLite smoke ${taskId}`;
  const task = await options.taskStore.create({
    name: taskName,
    skillName: "",
    enabled: false,
    schedule: { kind: "manual" },
    input: {
      productionSmoke: true,
      taskId,
    },
  });
  if (options.createId && task.id !== taskId) {
    throw new Error(
      `Production storage smoke task identity mismatch: expected=${taskId} actual=${task.id}.`,
    );
  }

  const timestamp = new Date().toISOString();
  const suffix = task.id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const goal: Goal = {
    id: `goal_${suffix}`,
    description: "Verify production SQLite authority.",
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
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const savedGoal = await options.goalStore.save(goal);
  await options.goalStore.appendLedgerIfAbsent(
    savedGoal.id,
    `production-smoke:${task.id}`,
    {
      at: timestamp,
      kind: "goal_planned",
      summary: "Production SQLite authority smoke.",
    },
  );

  const runId = `run_${suffix}`;
  const checkpoint = await options.executionStore.save({
    id: `checkpoint_${suffix}`,
    runId,
    taskId: task.id,
    status: "paused",
    steps: [],
    messages: [],
    toolCallCount: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const memory = await options.memoryStore.create({
    kind: "semantic",
    title: "Production SQLite authority",
    content: `Storage smoke ${task.id}`,
    source: { type: "system" },
  });
  const workspace = await options.workspaceStore.create({
    name: "Production storage smoke",
    rootPath: options.configDir,
    kind: "temporary",
    cleanup: "delete_on_completion",
  });
  const multiAgentSession = await options.multiAgentSessionStore.create({
    title: "Production storage smoke",
    workspaceId: workspace.id,
    rootRunId: runId,
  });
  const childRunId = `child_${suffix}`;
  const updatedSession = await options.multiAgentSessionStore.appendChildRun(
    multiAgentSession.id,
    childRunId,
    "reviewer",
  );
  if (!updatedSession?.childRunIds.includes(childRunId)) {
    throw new Error(
      "Production storage smoke could not persist a Multi-Agent child run.",
    );
  }
  const learning = await options.learningStore.create({
    type: "failure_lesson",
    sourceRunId: runId,
    sourceTrajectoryEventIds: [`event_${suffix}`],
    claim: "Production SQLite authority is active.",
    recommendedAction: "Keep SQLite as the release default.",
    risk: "Low",
  });
  const fixtureId = `fixture_${suffix}`;
  const evalCandidate = await options.evalCandidateStore.create({
    id: `candidate_${suffix}`,
    sourceRunId: runId,
    status: "accepted",
    rationale: "Production storage authority smoke.",
    fixture: {
      id: fixtureId,
      description: "Production SQLite authority fixture.",
      events: [],
      requiredEventTypes: [],
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const promotedFixture = await options.promotedFixtureStore.upsert(
    evalCandidate.fixture,
  );

  await Promise.all([
    options.taskStore.flushShadowWrites(),
    options.goalStore.flushShadowWrites(),
    options.executionStore.flushShadowWrites(),
    options.memoryStore.flushShadowWrites(),
    options.workspaceStore.flushShadowWrites(),
    options.multiAgentSessionStore.flushShadowWrites(),
    options.learningStore.flushShadowWrites(),
    options.evalCandidateStore.flushShadowWrites(),
    options.promotedFixtureStore.flushShadowWrites(),
  ]);

  const sqliteRow = options.storage.db
    .prepare("SELECT payload FROM tasks WHERE id = ?")
    .get<{ payload: string }>(task.id);
  const sqliteTask = sqliteRow
    ? (JSON.parse(sqliteRow.payload) as { id?: string; name?: string })
    : null;
  const journal = options.storage.db
    .prepare("PRAGMA journal_mode")
    .get<{ journal_mode?: string }>();
  const foreignKeys = options.storage.db
    .prepare("PRAGMA foreign_keys")
    .get<{ foreign_keys?: number }>();
  const migrations = options.storage.db
    .prepare("SELECT COUNT(*) AS count FROM __zerox_migrations")
    .get<{ count?: number }>();
  const markedDomains = options.storage.db
    .prepare("SELECT domain FROM domain_authority_state ORDER BY domain ASC")
    .all<{ domain: string }>()
    .map((row) => row.domain);
  const expectedDomains = [...productionStorageAuthorityDomains].sort();
  const markersPersisted =
    markedDomains.length === expectedDomains.length &&
    markedDomains.every((domain, index) => domain === expectedDomains[index]);
  const recordIds: Record<ProductionStorageAuthorityDomain, string> = {
    goal: savedGoal.id,
    execution_checkpoint: checkpoint.runId,
    memory: memory.id,
    workspace: workspace.id,
    multi_agent_session: multiAgentSession.id,
    learning_candidate: learning.id,
    eval_candidate: evalCandidate.id,
    promoted_eval_fixture: promotedFixture.id,
  };
  const domainRowsPersisted = [
    hasRow(
      options.storage,
      "SELECT 1 FROM goals WHERE id = ?",
      recordIds.goal,
    ) &&
      hasRow(
        options.storage,
        "SELECT 1 FROM goal_ledger WHERE goal_id = ?",
        recordIds.goal,
      ),
    hasRow(
      options.storage,
      "SELECT 1 FROM checkpoints WHERE run_id = ? AND kind = 'runtime'",
      recordIds.execution_checkpoint,
    ),
    hasRow(
      options.storage,
      "SELECT 1 FROM memory_records WHERE id = ?",
      recordIds.memory,
    ),
    hasRow(
      options.storage,
      "SELECT 1 FROM workspaces WHERE id = ?",
      recordIds.workspace,
    ),
    hasRow(
      options.storage,
      "SELECT 1 FROM sessions WHERE id = ? AND kind = 'multi_agent'",
      recordIds.multi_agent_session,
    ),
    hasRow(
      options.storage,
      "SELECT 1 FROM learning_candidates WHERE id = ?",
      recordIds.learning_candidate,
    ),
    hasRow(
      options.storage,
      "SELECT 1 FROM eval_candidates WHERE id = ?",
      recordIds.eval_candidate,
    ),
    hasRow(
      options.storage,
      "SELECT 1 FROM promoted_eval_fixtures WHERE id = ?",
      recordIds.promoted_eval_fixture,
    ),
  ].every(Boolean);
  const legacyJsonShadowsAbsent = (
    await Promise.all(
      [
        path.join(options.configDir, "scheduled-tasks.json"),
        path.join(options.configDir, "agent-goals", `${savedGoal.id}.json`),
        path.join(
          options.configDir,
          "agent-goals",
          `${savedGoal.id}.ledger.jsonl`,
        ),
        path.join(
          options.configDir,
          "agent-executions",
          `${checkpoint.runId}.json`,
        ),
        path.join(options.configDir, "memory-records.json"),
        path.join(options.configDir, "agent-workspaces.json"),
        path.join(options.configDir, "multi-agent-sessions.json"),
        path.join(options.configDir, "agent-learning-candidates.json"),
        path.join(options.configDir, "agent-eval-candidates.json"),
        path.join(options.configDir, "agent-promoted-eval-fixtures.json"),
      ].map(fileExists),
    )
  ).every((exists) => !exists);

  const taskRowPersisted =
    sqliteTask?.id === task.id && sqliteTask.name === taskName;
  const migrationCount = Number(migrations?.count ?? 0);
  if (
    !taskRowPersisted ||
    !markersPersisted ||
    !domainRowsPersisted ||
    !legacyJsonShadowsAbsent ||
    foreignKeys?.foreign_keys !== 1 ||
    journal?.journal_mode?.toLowerCase() !== "wal" ||
    migrationCount <= 0
  ) {
    throw new Error(
      "Production storage smoke did not observe complete SQLite authority evidence.",
    );
  }

  return {
    schemaVersion: 2,
    kind: "production_storage_smoke",
    requestedBackend: options.requestedBackend,
    resolvedBackend: options.resolvedBackend,
    nativeRuntime: {
      runtime: "electron",
      electronVersion: options.runtimeVersions.electron,
      modulesAbi: options.runtimeVersions.modules ?? "unknown",
      nodeVersion: options.runtimeVersions.node ?? "unknown",
    },
    sqlite: {
      foreignKeys: 1,
      journalMode: "wal",
      migrationCount,
      taskRowPersisted: true,
      taskId: task.id,
      taskName,
    },
    authority: {
      domains: [...productionStorageAuthorityDomains],
      markerCount: 8,
      recordIds,
      domainRowsPersisted: true,
      legacyJsonShadowsAbsent: true,
    },
  };
}

function hasRow(
  storage: Storage,
  sql: string,
  ...params: unknown[]
): boolean {
  return Boolean(storage.db.prepare(sql).get(...params));
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
