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
const { createStorageImpl } = await import(
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
const skillSnapshots = await import(
  path.join(root, "dist-electron/shared/skills.js")
);

const errorsPath = path.join(configDir, "migration-errors.jsonl");
if (existsSync(errorsPath)) writeFileSync(errorsPath, "");
const counts = {};
const sourceCounts = {};
const sourceKeys = new Map();
const failures = { parse: 0, write: 0 };

function bump(store, amount = 1) {
  counts[store] = (counts[store] ?? 0) + amount;
}

function trackSource(store, key) {
  sourceCounts[store] = (sourceCounts[store] ?? 0) + 1;
  const keys = sourceKeys.get(store) ?? new Set();
  keys.add(String(key));
  sourceKeys.set(store, keys);
}

function logError(store, detail, kind) {
  failures[kind] += 1;
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
      ],
      sourceCounts,
      counts,
      targetCounts,
      failures,
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
