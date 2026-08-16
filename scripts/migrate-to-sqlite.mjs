#!/usr/bin/env node
// Import only SQLite-authoritative domains from legacy JSON/JSONL files.
// Plan is imported because this script performs the JSON -> SQLite cutover.
//
//   node scripts/migrate-to-sqlite.mjs --configDir <path> [--dry-run] [--verify]
//
// --verify is idempotent: it verifies source identities in the final target
// instead of requiring every invocation to increase table counts.

import {
  appendFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

const args = parseArgs(process.argv.slice(2));
const configDir = args.configDir;
if (!configDir) {
  console.error(
    "usage: node scripts/migrate-to-sqlite.mjs --configDir <path> [--dry-run] [--verify]",
  );
  process.exit(2);
}

const root = path.resolve(new URL("..", import.meta.url).pathname);
const { createInMemoryStorage, createStorageImpl } = await import(
  path.join(root, "dist-electron/main/storage/storageDb.js")
);
const runsRepo = await import(
  path.join(root, "dist-electron/main/storage/repositories/runRepository.js")
);
const repos = await import(
  path.join(root, "dist-electron/main/storage/repositories/index.js")
);
const chatRepo = await import(
  path.join(
    root,
    "dist-electron/main/storage/repositories/chatSessionEventRepository.js",
  )
);
const chatStore = await import(
  path.join(root, "dist-electron/main/chatSessionStore.js")
);
const goalStores = await import(
  path.join(root, "dist-electron/main/agentGoalStore.js")
);
const executionStores = await import(
  path.join(root, "dist-electron/main/agentExecutionStore.js")
);
const memoryRepos = await import(
  path.join(
    root,
    "dist-electron/main/storage/repositories/memoryRepository.js",
  )
);
const sessionRepos = await import(
  path.join(
    root,
    "dist-electron/main/storage/repositories/sessionRepository.js",
  )
);
const skillSnapshots = await import(
  path.join(root, "dist-electron/shared/skills.js")
);

const errorsPath = path.join(configDir, "migration-errors.jsonl");
if (existsSync(errorsPath)) writeFileSync(errorsPath, "");
const counts = {};
const sourceCounts = {};
const sourceKeys = new Map();
const canonicalSources = new Map();
const failures = { parse: 0, write: 0 };
const conflicts = [];
const identityKeys = {
  goals: "goal.id",
  goal_ledger: "goal.id + ledger sequence",
  runtime_checkpoints: "checkpoint.runId (latest runtime)",
  memory_records: "memory.id",
  workspaces: "workspace.id",
  multi_agent_sessions: "session.id",
  learning_candidates: "candidate.id",
  eval_candidates: "candidate.id (unique sourceRunId + fixture.id alias)",
  promoted_eval_fixtures: "fixture.id",
};

function bump(store, amount = 1) {
  counts[store] = (counts[store] ?? 0) + amount;
}

function trackSource(store, key) {
  sourceCounts[store] = (sourceCounts[store] ?? 0) + 1;
  const keys = sourceKeys.get(store) ?? new Set();
  keys.add(String(key));
  sourceKeys.set(store, keys);
}

function trackCanonicalSource(store, key, value) {
  trackSource(store, key);
  const records = canonicalSources.get(store) ?? new Map();
  records.set(String(key), value);
  canonicalSources.set(store, records);
}

function logError(store, detail, kind) {
  failures[kind] += 1;
  if (String(detail).includes("mixed-generation conflict")) {
    conflicts.push({ store, detail: String(detail) });
  }
  appendFileSync(
    errorsPath,
    `${JSON.stringify({
      store,
      kind,
      detail,
      at: new Date().toISOString(),
    })}\n`,
  );
}

function logParseError(store, detail) {
  logError(store, detail, "parse");
}

function logWriteError(store, detail) {
  logError(store, detail, "write");
}

function readJson(file, fallback) {
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    logParseError(file, `parse failed: ${String(error)}`);
    return fallback;
  }
}

function readJsonStrict(file, fallback) {
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    logParseError(file, `parse failed: ${String(error)}`);
    throw new Error(`${file} parse failed: ${String(error)}`);
  }
}

function readJsonArray(file, property, store) {
  const data = readJson(file, { [property]: [] });
  if (!Array.isArray(data?.[property])) {
    logParseError(store, `${file} must contain an array at ${property}`);
    return [];
  }
  return data[property];
}

function readJsonl(file, store) {
  if (!existsSync(file)) return [];
  const rows = [];
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, index) => {
      if (!line.trim()) return;
      try {
        rows.push(JSON.parse(line));
      } catch (error) {
        sourceCounts[store] = (sourceCounts[store] ?? 0) + 1;
        logParseError(
          file,
          `line ${index + 1} parse failed: ${String(error)}`,
        );
      }
    });
  return rows;
}

function dryRunOnly() {
  return args["dry-run"] === true;
}

function timestamp(value) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function assertImportGeneration(store, key, source, target) {
  if (target === null || target === undefined) return "write";
  if (isDeepStrictEqual(source, target)) return "identical";

  const sourceGeneration = timestamp(source?.updatedAt);
  const targetGeneration = timestamp(target?.updatedAt);
  if (
    sourceGeneration === null ||
    targetGeneration === null ||
    targetGeneration >= sourceGeneration
  ) {
    throw new Error(
      `mixed-generation conflict for ${store} identity ${key}: ` +
        `source updatedAt=${String(source?.updatedAt ?? "<none>")}, ` +
        `SQLite updatedAt=${String(target?.updatedAt ?? "<none>")}`,
    );
  }
  return "write";
}

async function importCanonicalRecord(options) {
  const {
    store,
    key,
    source,
    target,
    write,
    read,
  } = options;
  trackCanonicalSource(store, key, source);
  if (dryRunOnly()) {
    bump(store);
    return;
  }
  const action = assertImportGeneration(store, key, source, target);
  if (action === "write") {
    await write();
  }
  const stored = await read();
  if (!isDeepStrictEqual(stored, source)) {
    throw new Error(
      `canonical import mismatch for ${store} identity ${key}`,
    );
  }
  bump(store);
}

function goalLedgerIdentity(goalId, sequence) {
  return JSON.stringify([goalId, sequence]);
}

function toMultiAgentSession(record) {
  if (!record || record.kind !== "multi_agent") return null;
  return {
    id: record.id,
    title: record.title ?? "",
    ...(record.rootRunId ? { rootRunId: record.rootRunId } : {}),
    status: record.status ?? "running",
    workspaceId: record.workspaceId ?? "",
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    childRunIds: [...(record.childRunIds ?? [])],
    roles: { ...(record.roles ?? {}) },
  };
}

function normalizeMigratedTask(task) {
  const permissions = task?.permissions;
  const currentPermissions =
    permissions &&
    Array.isArray(permissions.files?.read) &&
    Array.isArray(permissions.files?.write) &&
    typeof permissions.web?.search === "boolean" &&
    Array.isArray(permissions.web?.fetchDomains) &&
    Array.isArray(permissions.shell?.commands);
  return currentPermissions ? task : { ...task, permissions: undefined };
}

const storage = createStorageImpl({
  dbPath: path.join(configDir, "zerox.db"),
});
await storage.migrate();
const db = storage.db;
const goalStore = goalStores.createAgentGoalStore({
  configDir,
  backend: "sqlite",
  storage,
});
const executionStore = executionStores.createAgentExecutionStore({
  configDir,
  backend: "sqlite",
  storage,
});
const memoryRepository = memoryRepos.createMemoryRepository(storage);
const workspaceRepository = repos.createWorkspaceRepository(storage);
const sessionRepository = sessionRepos.createSessionRepository(storage);
const learningRepository = repos.createLearningRepository(storage);
const evalCandidateRepository =
  repos.createEvalCandidateRepository(storage);
const promotedFixtureRepository =
  repos.createPromotedEvalFixtureRepository(storage);

// Chat sessions, immutable messages, events, and projections.
{
  try {
    const data = readJsonStrict(
      path.join(configDir, "chat-sessions.json"),
      { sessions: [] },
    );
    for (const session of data.sessions ?? []) {
      trackSource("sessions", session.id);
      for (const message of session.messages ?? []) {
        trackSource("chat_messages", message.id);
      }
      trackSource("chat_session_events", `chat_import_${session.id}`);
    }
    const sessions = (data.sessions ?? []).map((session) =>
      chatStore.normalizeChatSessionRecord(session),
    );
    if (dryRunOnly()) {
      bump("sessions", sessions.length);
      bump(
        "chat_messages",
        sessions.reduce(
          (total, session) => total + session.messages.length,
          0,
        ),
      );
      bump("chat_session_events", sessions.length);
    } else {
      const repository = chatRepo.createChatSessionEventRepository(storage);
      repository.importSnapshots(
        sessions.map((session) => ({
          eventId: `chat_import_${session.id}`,
          session,
        })),
      );
      for (const session of sessions) {
        if (!isDeepStrictEqual(repository.getSession(session.id), session)) {
          throw new Error(`Chat migration parity failed for ${session.id}`);
        }
      }
      repository.completeBootstrap(new Date().toISOString());
      bump("sessions", sessions.length);
      bump(
        "chat_messages",
        sessions.reduce(
          (total, session) => total + session.messages.length,
          0,
        ),
      );
      bump("chat_session_events", sessions.length);
    }
  } catch (error) {
    if (!String(error).includes(" parse failed:")) {
      logWriteError("sessions", String(error));
    }
  }
}

// Scheduled Tasks.
{
  const data = readJson(path.join(configDir, "scheduled-tasks.json"), {
    tasks: [],
  });
  for (const task of data.tasks ?? []) {
    trackSource("tasks", task.id);
    if (dryRunOnly()) {
      bump("tasks");
      continue;
    }
    try {
      repos.createTaskRepository(storage).create({
        ...normalizeMigratedTask(task),
        id: task.id,
      });
      bump("tasks");
    } catch (error) {
      logWriteError("tasks", String(error));
    }
  }
}

// Runs.
{
  const rows = readJsonl(path.join(configDir, "agent-runs.jsonl"), "runs");
  for (const run of rows) {
    trackSource("runs", run.id);
    if (dryRunOnly()) {
      bump("runs");
      continue;
    }
    try {
      runsRepo.createRunRepository(storage).create(run);
      bump("runs");
    } catch (error) {
      logWriteError("runs", String(error));
    }
  }
}

// Trajectory events, including orphan run groups.
{
  const dir = path.join(configDir, "agent-trajectories");
  if (existsSync(dir)) {
    for (const filename of readdirSync(dir).filter((name) =>
      name.endsWith(".jsonl")
    )) {
      const runId = filename.replace(/\.jsonl$/, "");
      const rows = readJsonl(
        path.join(dir, filename),
        "trajectory_events",
      );
      for (const event of rows) {
        trackSource("trajectory_events", event.id);
        if (dryRunOnly()) {
          bump("trajectory_events");
          continue;
        }
        try {
          runsRepo
            .createRunRepository(storage)
            .appendTrajectory(event.runId ?? runId, event);
          bump("trajectory_events");
        } catch (error) {
          logWriteError("trajectory_events", String(error));
        }
      }
    }
  }
}

// P97 Goal records and append-only ledgers. Canonicalization runs through an
// isolated compiled Goal store so secret stripping and certificate policy are
// identical to production without mutating the target during preflight.
{
  const dir = path.join(configDir, "agent-goals");
  const canonicalStorage = await createInMemoryStorage();
  const canonicalGoalStore = goalStores.createAgentGoalStore({
    configDir,
    backend: "sqlite",
    storage: canonicalStorage,
  });
  try {
    if (existsSync(dir)) {
      const goalFiles = readdirSync(dir)
        .filter((name) => name.endsWith(".json"))
        .sort((left, right) => left.localeCompare(right));
      for (const filename of goalFiles) {
        const file = path.join(dir, filename);
        const fileGoalId = filename.replace(/\.json$/, "");
        let sourceTracked = false;
        try {
          const rawGoal = readJsonStrict(file, null);
          if (!rawGoal || rawGoal.id !== fileGoalId) {
            throw new Error(
              `Goal identity mismatch: file=${fileGoalId}, payload=${String(rawGoal?.id)}`,
            );
          }
          const canonicalGoal = await canonicalGoalStore.save(rawGoal);
          sourceTracked = true;
          await importCanonicalRecord({
            store: "goals",
            key: canonicalGoal.id,
            source: canonicalGoal,
            target: await goalStore.get(canonicalGoal.id),
            write: () => goalStore.save(canonicalGoal),
            read: () => goalStore.get(canonicalGoal.id),
          });
        } catch (error) {
          if (!sourceTracked && !String(error).includes(" parse failed:")) {
            trackSource("goals", fileGoalId);
          }
          if (!String(error).includes(" parse failed:")) {
            logWriteError("goals", String(error));
          }
        }
      }

      const ledgerFiles = readdirSync(dir)
        .filter((name) => name.endsWith(".ledger.jsonl"))
        .sort((left, right) => left.localeCompare(right));
      for (const filename of ledgerFiles) {
        const goalId = filename.replace(/\.ledger\.jsonl$/, "");
        const sourceEvents = readJsonl(
          path.join(dir, filename),
          "goal_ledger",
        );
        sourceEvents.forEach((event, index) => {
          trackCanonicalSource(
            "goal_ledger",
            goalLedgerIdentity(goalId, index + 1),
            event,
          );
        });
        if (dryRunOnly()) {
          bump("goal_ledger", sourceEvents.length);
          continue;
        }
        try {
          const targetEvents = await goalStore.readLedger(goalId);
          const sharedLength = Math.min(
            sourceEvents.length,
            targetEvents.length,
          );
          for (let index = 0; index < sharedLength; index += 1) {
            if (!isDeepStrictEqual(sourceEvents[index], targetEvents[index])) {
              throw new Error(
                `mixed-generation conflict for goal_ledger identity ` +
                  `${goalLedgerIdentity(goalId, index + 1)}`,
              );
            }
          }
          if (targetEvents.length > sourceEvents.length) {
            throw new Error(
              `mixed-generation conflict for goal_ledger identity ${goalId}: ` +
                `SQLite has ${targetEvents.length} events, source has ${sourceEvents.length}`,
            );
          }
          for (
            let index = targetEvents.length;
            index < sourceEvents.length;
            index += 1
          ) {
            const event = sourceEvents[index];
            if (typeof event.publicationKey === "string") {
              await goalStore.appendLedgerIfAbsent(
                goalId,
                event.publicationKey,
                event,
              );
            } else {
              await goalStore.appendLedger(goalId, event);
            }
          }
          const storedEvents = await goalStore.readLedger(goalId);
          if (!isDeepStrictEqual(storedEvents, sourceEvents)) {
            throw new Error(
              `canonical import mismatch for goal_ledger identity ${goalId}`,
            );
          }
          bump("goal_ledger", sourceEvents.length);
        } catch (error) {
          logWriteError("goal_ledger", String(error));
        }
      }
    }
  } finally {
    canonicalStorage.close();
  }
}

// P97 runtime checkpoints. Non-runtime checkpoint kinds remain untouched.
{
  const dir = path.join(configDir, "agent-executions");
  if (existsSync(dir)) {
    for (const filename of readdirSync(dir)
      .filter((name) => name.endsWith(".json") && !name.includes(".corrupt-"))
      .sort((left, right) => left.localeCompare(right))) {
      const file = path.join(dir, filename);
      const fileRunId = filename.replace(/\.json$/, "");
      try {
        const checkpoint = readJsonStrict(file, null);
        if (!checkpoint || checkpoint.runId !== fileRunId) {
          throw new Error(
            `Runtime checkpoint identity mismatch: file=${fileRunId}, payload=${String(checkpoint?.runId)}`,
          );
        }
        await importCanonicalRecord({
          store: "runtime_checkpoints",
          key: checkpoint.runId,
          source: checkpoint,
          target: await executionStore.get(checkpoint.runId),
          write: () => executionStore.save(checkpoint),
          read: () => executionStore.get(checkpoint.runId),
        });
      } catch (error) {
        if (!String(error).includes(" parse failed:")) {
          logWriteError("runtime_checkpoints", String(error));
        }
      }
    }
  }
}

// P97 Memory records.
{
  const records = readJsonArray(
    path.join(configDir, "memory-records.json"),
    "records",
    "memory_records",
  );
  for (const record of records) {
    try {
      await importCanonicalRecord({
        store: "memory_records",
        key: record.id,
        source: record,
        target: memoryRepository.get(record.id),
        write: () => memoryRepository.write(record),
        read: () => memoryRepository.get(record.id),
      });
    } catch (error) {
      logWriteError("memory_records", String(error));
    }
  }
}

// P97 Workspaces.
{
  const workspaces = readJsonArray(
    path.join(configDir, "agent-workspaces.json"),
    "workspaces",
    "workspaces",
  );
  for (const workspace of workspaces) {
    try {
      await importCanonicalRecord({
        store: "workspaces",
        key: workspace.id,
        source: workspace,
        target: workspaceRepository.get(workspace.id),
        write: () => workspaceRepository.save(workspace),
        read: () => workspaceRepository.get(workspace.id),
      });
    } catch (error) {
      logWriteError("workspaces", String(error));
    }
  }
}

// P97 Multi-Agent Sessions. Chat and other session kinds are not replaced.
{
  const sessions = readJsonArray(
    path.join(configDir, "multi-agent-sessions.json"),
    "sessions",
    "multi_agent_sessions",
  );
  for (const session of sessions) {
    const canonicalSession = {
      id: session.id,
      title: session.title ?? "",
      ...(session.rootRunId ? { rootRunId: session.rootRunId } : {}),
      status: session.status ?? "running",
      workspaceId: session.workspaceId ?? "",
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      childRunIds: [...(session.childRunIds ?? [])],
      roles: { ...(session.roles ?? {}) },
    };
    try {
      const targetRecord = sessionRepository.getSession(canonicalSession.id);
      if (targetRecord && targetRecord.kind !== "multi_agent") {
        trackCanonicalSource(
          "multi_agent_sessions",
          canonicalSession.id,
          canonicalSession,
        );
        throw new Error(
          `mixed-generation conflict for multi_agent_sessions identity ` +
            `${canonicalSession.id}: SQLite kind=${targetRecord.kind}`,
        );
      }
      await importCanonicalRecord({
        store: "multi_agent_sessions",
        key: canonicalSession.id,
        source: canonicalSession,
        target: toMultiAgentSession(targetRecord),
        write: () =>
          sessionRepository.createSession({
            ...canonicalSession,
            kind: "multi_agent",
            payload: canonicalSession,
          }),
        read: () =>
          toMultiAgentSession(
            sessionRepository.getSession(canonicalSession.id),
          ),
      });
    } catch (error) {
      logWriteError("multi_agent_sessions", String(error));
    }
  }
}

// P97 reviewed Learning candidates.
{
  const candidates = readJsonArray(
    path.join(configDir, "agent-learning-candidates.json"),
    "candidates",
    "learning_candidates",
  );
  for (const candidate of candidates) {
    const existing = learningRepository
      .list()
      .find((item) => item.id === candidate.id) ?? null;
    try {
      await importCanonicalRecord({
        store: "learning_candidates",
        key: candidate.id,
        source: candidate,
        target: existing,
        write: () => learningRepository.create(candidate),
        read: () =>
          learningRepository
            .list()
            .find((item) => item.id === candidate.id) ?? null,
      });
    } catch (error) {
      logWriteError("learning_candidates", String(error));
    }
  }
}

// P97 Eval Candidates. The repository's composite identity is checked before
// create so a different candidate id cannot alias the same run/fixture pair.
{
  const candidates = readJsonArray(
    path.join(configDir, "agent-eval-candidates.json"),
    "candidates",
    "eval_candidates",
  );
  for (const candidate of candidates) {
    const existing =
      evalCandidateRepository.get(candidate.id) ??
      evalCandidateRepository
        .list()
        .find(
          (item) =>
            item.sourceRunId === candidate.sourceRunId &&
            item.fixture.id === candidate.fixture?.id,
        ) ??
      null;
    try {
      await importCanonicalRecord({
        store: "eval_candidates",
        key: candidate.id,
        source: candidate,
        target: existing,
        write: () => evalCandidateRepository.create(candidate),
        read: () => evalCandidateRepository.get(candidate.id),
      });
    } catch (error) {
      logWriteError("eval_candidates", String(error));
    }
  }
}

// P97 promoted fixtures preserve source order through repository sort_order.
{
  const fixtures = readJsonArray(
    path.join(configDir, "agent-promoted-eval-fixtures.json"),
    "fixtures",
    "promoted_eval_fixtures",
  );
  for (const [index, fixture] of fixtures.entries()) {
    const existing =
      promotedFixtureRepository
        .list()
        .find((item) => item.id === fixture.id) ?? null;
    try {
      await importCanonicalRecord({
        store: "promoted_eval_fixtures",
        key: fixture.id,
        source: fixture,
        target: existing,
        write: () =>
          promotedFixtureRepository.upsert(fixture, {
            createdAt:
              typeof fixture.createdAt === "string"
                ? fixture.createdAt
                : new Date(index).toISOString(),
          }),
        read: () =>
          promotedFixtureRepository
            .list()
            .find((item) => item.id === fixture.id) ?? null,
      });
    } catch (error) {
      logWriteError("promoted_eval_fixtures", String(error));
    }
  }
}

// Memory Profile.
{
  const file = path.join(configDir, "memory-persona.md");
  if (existsSync(file)) {
    trackSource("memory_profile", "singleton");
    if (dryRunOnly()) {
      bump("memory_profile");
    } else {
      try {
        repos
          .createMemoryProfileRepository(storage)
          .save(readFileSync(file, "utf8"));
        bump("memory_profile");
      } catch (error) {
        logWriteError("memory_profile", String(error));
      }
    }
  }
}

// Tool authorization audit.
{
  const rows = readJsonl(
    path.join(configDir, "tool-audit.jsonl"),
    "tool_audit",
  );
  for (const event of rows) {
    trackSource("tool_audit", event.id);
    if (dryRunOnly()) {
      bump("tool_audit");
      continue;
    }
    try {
      repos.createToolAuditRepository(storage).append(event);
      bump("tool_audit");
    } catch (error) {
      logWriteError("tool_audit", String(error));
    }
  }
}

// Validation snapshot.
{
  const data = readJson(path.join(configDir, "agent-validation.json"), {
    latest: null,
  });
  if (data.latest) {
    trackSource("validation_snapshots", "latest");
    if (dryRunOnly()) {
      bump("validation_snapshots");
    } else {
      try {
        repos.createValidationRepository(storage).save(data.latest);
        bump("validation_snapshots");
      } catch (error) {
        logWriteError("validation_snapshots", String(error));
      }
    }
  }
}

// SQLite-mode Plan records and append-only events.
{
  const dir = path.join(configDir, "plans");
  if (existsSync(dir)) {
    for (const filename of readdirSync(dir).filter(
      (name) =>
        name.endsWith(".json") &&
        name !== "session-index.json",
    )) {
      const plan = readJson(path.join(dir, filename), null);
      if (!plan) continue;
      const persistedPlan = plan.selectedSkill
        ? {
            ...plan,
            selectedSkill: skillSnapshots.createPublicSkillSnapshot(
              plan.selectedSkill,
            ),
          }
        : plan;
      trackSource("plan_records", plan.id);
      if (dryRunOnly()) {
        bump("plan_records");
        continue;
      }
      try {
        db.prepare(
          `INSERT INTO plan_records
            (id, session_id, mode, status, action_gate, revision, payload,
             created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             session_id=excluded.session_id,
             mode=excluded.mode,
             status=excluded.status,
             action_gate=excluded.action_gate,
             revision=excluded.revision,
             payload=excluded.payload,
             updated_at=excluded.updated_at`,
        ).run(
          persistedPlan.id,
          persistedPlan.sessionId,
          persistedPlan.mode,
          persistedPlan.status,
          persistedPlan.actionGate,
          persistedPlan.revision,
          JSON.stringify(persistedPlan),
          persistedPlan.createdAt,
          persistedPlan.updatedAt,
        );
        bump("plan_records");
      } catch (error) {
        logWriteError("plan_records", String(error));
      }
    }

    for (const filename of readdirSync(dir).filter((name) =>
      name.endsWith(".events.jsonl")
    )) {
      const rows = readJsonl(path.join(dir, filename), "plan_events");
      for (const event of rows) {
        trackSource("plan_events", event.id);
        if (dryRunOnly()) {
          bump("plan_events");
          continue;
        }
        try {
          db.prepare(
            `INSERT INTO plan_events
              (id, plan_id, type, revision, payload, created_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               plan_id=excluded.plan_id,
               type=excluded.type,
               revision=excluded.revision,
               payload=excluded.payload,
               created_at=excluded.created_at`,
          ).run(
            event.id,
            event.planId,
            event.type,
            event.revision,
            event.payload ? JSON.stringify(event.payload) : null,
            event.createdAt,
          );
          bump("plan_events");
        } catch (error) {
          logWriteError("plan_events", String(error));
        }
      }
    }
  }
}

storage.close();

const targetCounts = {};
const mismatches = [];
if (args.verify) {
  const storage2 = createStorageImpl({
    dbPath: path.join(configDir, "zerox.db"),
  });
  await storage2.migrate();
  const keyColumns = {
    sessions: "id",
    chat_messages: "id",
    chat_session_events: "id",
    tasks: "id",
    runs: "id",
    trajectory_events: "id",
    memory_profile: "id",
    tool_audit: "id",
    validation_snapshots: "id",
    plan_records: "id",
    plan_events: "id",
  };
  for (const [table, keys] of sourceKeys) {
    const keyColumn = keyColumns[table];
    if (!keyColumn) continue;
    const targetKeys = new Set(
      storage2.db
        .prepare(`SELECT ${keyColumn} AS key FROM ${table}`)
        .all()
        .map((row) => String(row.key)),
    );
    const present = [...keys].filter((key) => targetKeys.has(key)).length;
    const source = sourceCounts[table] ?? 0;
    targetCounts[table] = present;
    const status =
      present === keys.size && source === keys.size
        ? "OK"
        : `MISMATCH (source=${source}, unique=${keys.size}, present=${present})`;
    if (status !== "OK") {
      mismatches.push({
        table,
        source,
        uniqueSourceKeys: keys.size,
        target: present,
      });
    }
    console.log(`  verify ${table}: ${status}`);
  }

  const verifyGoalStore = goalStores.createAgentGoalStore({
    configDir,
    backend: "sqlite",
    storage: storage2,
  });
  const verifyExecutionStore = executionStores.createAgentExecutionStore({
    configDir,
    backend: "sqlite",
    storage: storage2,
  });
  const verifyMemoryRepository =
    memoryRepos.createMemoryRepository(storage2);
  const verifyWorkspaceRepository =
    repos.createWorkspaceRepository(storage2);
  const verifySessionRepository =
    sessionRepos.createSessionRepository(storage2);
  const verifyLearningRepository =
    repos.createLearningRepository(storage2);
  const verifyEvalRepository =
    repos.createEvalCandidateRepository(storage2);
  const verifyFixtureRepository =
    repos.createPromotedEvalFixtureRepository(storage2);
  const ledgerCache = new Map();

  async function readCanonicalTarget(table, key) {
    switch (table) {
      case "goals":
        return verifyGoalStore.get(key);
      case "goal_ledger": {
        const [goalId, sequence] = JSON.parse(key);
        if (!ledgerCache.has(goalId)) {
          ledgerCache.set(goalId, await verifyGoalStore.readLedger(goalId));
        }
        return ledgerCache.get(goalId)?.[sequence - 1] ?? null;
      }
      case "runtime_checkpoints":
        return verifyExecutionStore.get(key);
      case "memory_records":
        return verifyMemoryRepository.get(key);
      case "workspaces":
        return verifyWorkspaceRepository.get(key);
      case "multi_agent_sessions":
        return toMultiAgentSession(
          verifySessionRepository.getSession(key),
        );
      case "learning_candidates":
        return (
          verifyLearningRepository
            .list()
            .find((candidate) => candidate.id === key) ?? null
        );
      case "eval_candidates":
        return verifyEvalRepository.get(key);
      case "promoted_eval_fixtures":
        return (
          verifyFixtureRepository
            .list()
            .find((fixture) => fixture.id === key) ?? null
        );
      default:
        return null;
    }
  }

  for (const [table, records] of canonicalSources) {
    let present = 0;
    for (const [key, source] of records) {
      const target = await readCanonicalTarget(table, key);
      if (isDeepStrictEqual(target, source)) {
        present += 1;
      }
    }
    const source = sourceCounts[table] ?? 0;
    targetCounts[table] = present;
    const status =
      present === records.size && source === records.size
        ? "OK"
        : `MISMATCH (source=${source}, unique=${records.size}, canonical=${present})`;
    if (status !== "OK") {
      mismatches.push({
        table,
        source,
        uniqueSourceKeys: records.size,
        target: present,
      });
    }
    console.log(`  verify ${table}: ${status}`);
  }

  if (
    !dryRunOnly() &&
    failures.parse === 0 &&
    failures.write === 0 &&
    conflicts.length === 0 &&
    mismatches.length === 0
  ) {
    const markDomain = storage2.db.prepare(
      `INSERT INTO domain_authority_state (domain, source, imported_at)
       VALUES (?, 'migration_cli', ?)
       ON CONFLICT(domain) DO NOTHING`,
    );
    const markedAt = new Date().toISOString();
    for (const domain of [
      "goal",
      "execution_checkpoint",
      "memory",
      "workspace",
      "multi_agent_session",
      "learning_candidate",
      "eval_candidate",
      "promoted_eval_fixture",
    ]) {
      markDomain.run(domain, markedAt);
    }
  }
  storage2.close();
}

console.log(
  JSON.stringify(
    {
      dryRun: dryRunOnly(),
      authority: [
        "chat",
        "run",
        "trajectory",
        "task",
        "validation",
        "memory_profile",
        "tool_audit",
        "plan_sqlite_mode",
        "goal",
        "goal_ledger",
        "execution_checkpoint",
        "memory",
        "workspace",
        "multi_agent_session",
        "learning_candidate",
        "eval_candidate",
        "promoted_eval_fixture",
      ],
      identityKeys,
      fileBackedExclusions: [
        "tool_result_blobs",
        "workspace_run_ledger",
        "raw_history",
        "artifact_payloads",
      ],
      sourceCounts,
      counts,
      targetCounts,
      failures,
      conflicts,
      mismatches,
      errors: existsSync(errorsPath) ? errorsPath : null,
    },
    null,
    2,
  ),
);

if (
  args.verify &&
  (failures.parse > 0 || failures.write > 0 || mismatches.length > 0)
) {
  process.exitCode = 1;
}

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) continue;
    const key = argument.slice(2);
    if (argv[index + 1] && !argv[index + 1].startsWith("--")) {
      out[key] = argv[++index];
    } else {
      out[key] = true;
    }
  }
  return out;
}
