#!/usr/bin/env node
// P1 one-shot migration: read legacy JSON/JSONL files under a configDir and
// load them into zerox.db via the P1 repositories. Idempotent (upserts).
//
//   node scripts/migrate-to-sqlite.mjs --configDir <path> [--dry-run] [--verify]
//
// Failures are recorded to <configDir>/migration-errors.jsonl and do not abort
// the overall migration (per spec T1.7). --dry-run reports planned row counts
// without writing. --verify compares this invocation's target deltas with the
// independently counted source records.

import { readFileSync, readdirSync, existsSync, writeFileSync, appendFileSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

const args = parseArgs(process.argv.slice(2));
const configDir = args.configDir;
if (!configDir) {
  console.error("usage: node scripts/migrate-to-sqlite.mjs --configDir <path> [--dry-run] [--verify]");
  process.exit(2);
}

const root = path.resolve(new URL("..", import.meta.url).pathname);
// Import the compiled storage layer (built via `npm run build`).
const {
  createStorageImpl,
} = await import(path.join(root, "dist-electron/main/storage/storageDb.js"));
const runsRepo = await import(path.join(root, "dist-electron/main/storage/repositories/runRepository.js"));
const repos = await import(path.join(root, "dist-electron/main/storage/repositories/index.js"));
const ckRepo = await import(path.join(root, "dist-electron/main/storage/repositories/checkpointRepository.js"));
const goalRepo = await import(path.join(root, "dist-electron/main/storage/repositories/goalRepository.js"));
const memRepo = await import(path.join(root, "dist-electron/main/storage/repositories/memoryRepository.js"));
const sessRepo = await import(path.join(root, "dist-electron/main/storage/repositories/sessionRepository.js"));
const chatRepo = await import(path.join(root, "dist-electron/main/storage/repositories/chatSessionEventRepository.js"));
const chatStore = await import(path.join(root, "dist-electron/main/chatSessionStore.js"));

const errorsPath = path.join(configDir, "migration-errors.jsonl");
if (existsSync(errorsPath)) writeFileSync(errorsPath, "");
const counts = {};
const sourceCounts = {};
const failures = { parse: 0, write: 0 };
function bump(store, n) { counts[store] = (counts[store] ?? 0) + n; }
function bumpSource(store, n) {
  sourceCounts[store] = (sourceCounts[store] ?? 0) + n;
}
function logError(store, detail, kind) {
  failures[kind] += 1;
  appendFileSync(
    errorsPath,
    JSON.stringify({ store, kind, detail, at: new Date().toISOString() }) + "\n",
  );
}
function logParseError(store, detail) {
  logError(store, detail, "parse");
}
function logWriteError(store, detail) {
  logError(store, detail, "write");
}
function readJson(file, fallback) {
  try {
    if (!existsSync(file)) return fallback;
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
  readFileSync(file, "utf8").split("\n").forEach((line, index) => {
    if (!line.trim()) return;
    bumpSource(store, 1);
    try {
      rows.push(JSON.parse(line));
    } catch (error) {
      logParseError(file, `line ${index + 1} parse failed: ${String(error)}`);
    }
  });
  return rows;
}

function dryRunOnly() { return args["dry-run"] === true; }

const storage = createStorageImpl({ dbPath: path.join(configDir, "zerox.db") });
await storage.migrate();
const db = storage.db;
const targetBaselineCounts = {};
if (args.verify) {
  for (const table of [
    "workspaces",
    "sessions",
    "chat_messages",
    "chat_session_events",
    "tasks",
    "runs",
    "trajectory_events",
    "memory_records",
    "memory_profile",
    "goals",
    "goal_ledger",
    "tool_audit",
    "tool_results",
    "learning_candidates",
    "eval_candidates",
    "validation_snapshots",
    "promoted_eval_fixtures",
    "artifacts",
  ]) {
    targetBaselineCounts[table] =
      db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n ?? 0;
  }
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

// 1. workspaces
{
  const data = readJson(path.join(configDir, "agent-workspaces.json"), { workspaces: [] });
  for (const w of data.workspaces ?? []) {
    bumpSource("workspaces", 1);
    if (dryRunOnly()) { bump("workspaces", 1); continue; }
    try { repos.createWorkspaceRepository(storage).save(w); bump("workspaces", 1); } catch (e) { logWriteError("workspaces", String(e)); }
  }
}

// 2. chat sessions + messages
{
  try {
    const data = readJsonStrict(
      path.join(configDir, "chat-sessions.json"),
      { sessions: [] },
    );
    for (const session of data.sessions ?? []) {
      bumpSource("sessions", 1);
      bumpSource("chat_messages", session.messages?.length ?? 0);
      bumpSource("chat_session_events", 1);
    }
    const sessions = (data.sessions ?? []).map((session) =>
      chatStore.normalizeChatSessionRecord(session),
    );
    if (dryRunOnly()) {
      for (const session of sessions) {
        bump("sessions", 1);
        bump("chat_messages", session.messages?.length ?? 0);
        bump("chat_session_events", 1);
      }
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
          (total, session) => total + (session.messages?.length ?? 0),
          0,
        ),
      );
      bump("chat_session_events", sessions.length);
    }
  } catch (e) {
    if (!String(e).includes(" parse failed:")) {
      logWriteError("sessions", String(e));
    }
  }
}

// 3. multi-agent sessions + actors
{
  const data = readJson(path.join(configDir, "multi-agent-sessions.json"), { sessions: [] });
  for (const s of data.sessions ?? []) {
    bumpSource("sessions_multi", 1);
    if (dryRunOnly()) { bump("sessions_multi", 1); continue; }
    try {
      sessRepo.createSessionRepository(storage).createSession({
        id: s.id, kind: "multi_agent", title: s.title, status: s.status,
        rootRunId: s.rootRunId, workspaceId: s.workspaceId, payload: s,
        createdAt: s.createdAt, updatedAt: s.updatedAt,
      });
      bump("sessions_multi", 1);
    } catch (e) { logWriteError("sessions_multi", String(e)); }
  }
}
// 4. tasks
{
  const data = readJson(path.join(configDir, "scheduled-tasks.json"), { tasks: [] });
  for (const t of data.tasks ?? []) {
    bumpSource("tasks", 1);
    if (dryRunOnly()) { bump("tasks", 1); continue; }
    try {
      repos.createTaskRepository(storage).create({
        ...normalizeMigratedTask(t),
        id: t.id,
      });
      bump("tasks", 1);
    } catch (e) { logWriteError("tasks", String(e)); }
  }
}

// 5. runs
{
  const runs = readJsonl(path.join(configDir, "agent-runs.jsonl"), "runs");
  for (const r of runs) {
    if (dryRunOnly()) { bump("runs", 1); continue; }
    try { runsRepo.createRunRepository(storage).create(r); bump("runs", 1); } catch (e) { logWriteError("runs", String(e)); }
  }
}

// 6. trajectory_events
{
  const dir = path.join(configDir, "agent-trajectories");
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".jsonl"))) {
      const runId = f.replace(/\.jsonl$/, "");
      for (const e of readJsonl(path.join(dir, f), "trajectory_events")) {
        if (dryRunOnly()) { bump("trajectory_events", 1); continue; }
        try { runsRepo.createRunRepository(storage).appendTrajectory(e.runId ?? runId, e); bump("trajectory_events", 1); } catch (err) { logWriteError("trajectory_events", String(err)); }
      }
    }
  }
}

// 7. memory_records
{
  const data = readJson(path.join(configDir, "memory-records.json"), { records: [] });
  for (const m of data.records ?? []) {
    bumpSource("memory_records", 1);
    if (dryRunOnly()) { bump("memory_records", 1); continue; }
    try { memRepo.createMemoryRepository(storage).write(m); bump("memory_records", 1); } catch (e) { logWriteError("memory_records", String(e)); }
  }
}

// 8. memory_profile
{
  const file = path.join(configDir, "memory-persona.md");
  if (existsSync(file)) {
    bumpSource("memory_profile", 1);
    const content = readFileSync(file, "utf8");
    if (dryRunOnly()) {
      bump("memory_profile", 1);
    } else {
      try {
        repos.createMemoryProfileRepository(storage).save(content);
        bump("memory_profile", 1);
      } catch (error) {
        logWriteError("memory_profile", String(error));
      }
    }
  }
}

// 9. goals + ledger
{
  const dir = path.join(configDir, "agent-goals");
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".json") && !f.endsWith(".ledger.jsonl"))) {
      const g = readJson(path.join(dir, f), null);
      if (g) { bumpSource("goals", 1); if (dryRunOnly()) { bump("goals", 1); continue; } try { goalRepo.createGoalRepository(storage).save(g); bump("goals", 1); } catch (e) { logWriteError("goals", String(e)); } }
    }
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".ledger.jsonl"))) {
      const goalId = f.replace(/\.ledger\.jsonl$/, "");
      for (const ev of readJsonl(path.join(dir, f), "goal_ledger")) {
        if (dryRunOnly()) { bump("goal_ledger", 1); continue; }
        try { goalRepo.createGoalRepository(storage).appendLedger(goalId, ev); bump("goal_ledger", 1); } catch (e) { logWriteError("goal_ledger", String(e)); }
      }
    }
  }
}

// 10. tool_audit
{
  for (const e of readJsonl(path.join(configDir, "tool-audit.jsonl"), "tool_audit")) {
    if (dryRunOnly()) { bump("tool_audit", 1); continue; }
    try { repos.createToolAuditRepository(storage).append(e); bump("tool_audit", 1); } catch (err) { logWriteError("tool_audit", String(err)); }
  }
}

// 11. tool_results (raw string content)
{
  const dir = path.join(configDir, "tool-result-refs");
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      bumpSource("tool_results", 1);
      const refId = f.replace(/\.json$/, "");
      const content = readFileSync(path.join(dir, f), "utf8");
      if (dryRunOnly()) { bump("tool_results", 1); continue; }
      try { repos.createToolResultRepository(storage).write({ refId, content }); bump("tool_results", 1); } catch (e) { logWriteError("tool_results", String(e)); }
    }
  }
}

// 12. learning_candidates
{
  const data = readJson(path.join(configDir, "agent-learning-candidates.json"), { candidates: [] });
  for (const c of data.candidates ?? []) {
    bumpSource("learning_candidates", 1);
    if (dryRunOnly()) { bump("learning_candidates", 1); continue; }
    try { repos.createLearningRepository(storage).create(c); bump("learning_candidates", 1); } catch (e) { logWriteError("learning_candidates", String(e)); }
  }
}

// 13. eval_candidates
{
  const data = readJson(path.join(configDir, "agent-eval-candidates.json"), { candidates: [] });
  for (const c of data.candidates ?? []) {
    bumpSource("eval_candidates", 1);
    if (dryRunOnly()) { bump("eval_candidates", 1); continue; }
    try { repos.createEvalCandidateRepository(storage).create(c); bump("eval_candidates", 1); } catch (e) { logWriteError("eval_candidates", String(e)); }
  }
}

// 14. validation_snapshots
{
  const data = readJson(path.join(configDir, "agent-validation.json"), { latest: null });
  if (data.latest) {
    bumpSource("validation_snapshots", 1);
    if (dryRunOnly()) {
      bump("validation_snapshots", 1);
    } else {
      try {
        repos.createValidationRepository(storage).save(data.latest);
        bump("validation_snapshots", 1);
      } catch (error) {
        logWriteError("validation_snapshots", String(error));
      }
    }
  }
}

// 15. promoted_eval_fixtures
{
  const data = readJson(path.join(configDir, "agent-promoted-eval-fixtures.json"), { fixtures: [] });
  for (const f of data.fixtures ?? []) {
    bumpSource("promoted_eval_fixtures", 1);
    if (dryRunOnly()) { bump("promoted_eval_fixtures", 1); continue; }
    try { repos.createPromotedEvalFixtureRepository(storage).upsert(f); bump("promoted_eval_fixtures", 1); } catch (e) { logWriteError("promoted_eval_fixtures", String(e)); }
  }
}

// 16. artifacts (provenance sidecars)
{
  function walk(dir) {
    if (!existsSync(dir)) return [];
    const out = [];
    for (const f of readdirSync(dir)) {
      const full = path.join(dir, f);
      const stat = statSync(full);
      if (stat.isDirectory()) out.push(...walk(full));
      else if (f.endsWith(".provenance.json")) out.push(full);
    }
    return out;
  }
  for (const file of walk(configDir)) {
    const manifest = readJson(file, null);
    if (!manifest || !manifest.artifactId) continue;
    bumpSource("artifacts", 1);
    if (dryRunOnly()) { bump("artifacts", 1); continue; }
    try {
      db.prepare(
        `INSERT OR REPLACE INTO artifacts (id, run_id, goal_id, milestone_id, path, sha256, source, payload, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        manifest.artifactId, manifest.runId ?? null, manifest.goalId ?? null,
        manifest.milestoneId ?? null, manifest.destination?.path ?? null,
        manifest.destination?.sha256 ?? null, JSON.stringify(manifest.source ?? null),
        JSON.stringify(manifest), manifest.generatedAt ?? new Date().toISOString(),
      );
      bump("artifacts", 1);
    } catch (e) { logWriteError("artifacts", String(e)); }
  }
}

storage.close();

const targetCounts = {};
const targetTotalCounts = {};
const mismatches = [];
if (args.verify) {
  const storage2 = createStorageImpl({ dbPath: path.join(configDir, "zerox.db") });
  await storage2.migrate();
  const db2 = storage2.db;
  const expectedTargets = {};
  for (const [store, count] of Object.entries(sourceCounts)) {
    const table = store === "sessions_multi" ? "sessions" : store;
    expectedTargets[table] = (expectedTargets[table] ?? 0) + count;
  }
  for (const [table, expected] of Object.entries(expectedTargets)) {
    const row = db2.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get();
    const total = row?.n ?? 0;
    const baseline = targetBaselineCounts[table] ?? 0;
    const migrated = total - baseline;
    targetCounts[table] = migrated;
    targetTotalCounts[table] = total;
    const status =
      migrated === expected ? "OK" : `MISMATCH (expected delta ${expected})`;
    if (migrated !== expected) {
      mismatches.push({
        table,
        source: expected,
        target: migrated,
        baseline,
        total,
      });
    }
    console.log(
      `  verify ${table}: before=${baseline} after=${total} delta=${migrated} ${status}`,
    );
  }
  storage2.close();
}

console.log(JSON.stringify({
  dryRun: dryRunOnly(),
  sourceCounts,
  counts,
  targetBaselineCounts,
  targetCounts,
  targetTotalCounts,
  failures,
  mismatches,
  errors: existsSync(errorsPath) ? errorsPath : null,
}, null, 2));

if (
  args.verify &&
  (failures.parse > 0 || failures.write > 0 || mismatches.length > 0)
) {
  process.exitCode = 1;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      if (argv[i + 1] && !argv[i + 1].startsWith("--")) { out[key] = argv[++i]; }
      else out[key] = true;
    }
  }
  return out;
}
