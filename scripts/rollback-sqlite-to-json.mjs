#!/usr/bin/env node
// P1 rollback: re-export legacy JSON/JSONL files from zerox.db, freezing any
// existing on-disk JSON as *.legacy.json first so nothing is overwritten
// destructively. Inverse of migrate-to-sqlite.mjs.
//
//   node scripts/rollback-sqlite-to-json.mjs --configDir <path> --confirmSqliteAuthoritative

import { existsSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const configDir = args.configDir;
if (!configDir) {
  console.error("usage: node scripts/rollback-sqlite-to-json.mjs --configDir <path> --confirmSqliteAuthoritative");
  process.exit(2);
}
if (args.confirmSqliteAuthoritative !== true) {
  console.error(
    "refusing rollback export: JSON is the v3.7.0 default source of truth; pass --confirmSqliteAuthoritative only after verifying SQLite was authoritative",
  );
  process.exit(2);
}

const root = path.resolve(new URL("..", import.meta.url).pathname);
const { createStorageImpl } = await import(path.join(root, "dist-electron/main/storage/storageDb.js"));
const runsRepo = await import(path.join(root, "dist-electron/main/storage/repositories/runRepository.js"));
const repos = await import(path.join(root, "dist-electron/main/storage/repositories/index.js"));
const goalRepo = await import(path.join(root, "dist-electron/main/storage/repositories/goalRepository.js"));
const memRepo = await import(path.join(root, "dist-electron/main/storage/repositories/memoryRepository.js"));
const sessRepo = await import(path.join(root, "dist-electron/main/storage/repositories/sessionRepository.js"));
const chatRepo = await import(path.join(root, "dist-electron/main/storage/repositories/chatSessionEventRepository.js"));

const dbPath = path.join(configDir, "zerox.db");
if (!existsSync(dbPath)) {
  console.error(`no zerox.db at ${dbPath}; nothing to roll back.`);
  process.exit(0);
}

function freeze(file) {
  if (!existsSync(file)) return;
  const base = file.replace(/(\.[^.]+)$/, ".legacy$1");
  let backup = base;
  let suffix = 1;
  while (existsSync(backup)) {
    backup = `${base}.${suffix++}`;
  }
  renameSync(file, backup);
}
function writeJson(file, obj) {
  mkdirSync(path.dirname(file), { recursive: true });
  freeze(file);
  writeFileSync(file, JSON.stringify(obj, null, 2) + "\n", "utf8");
}
function writeJsonl(file, rows) {
  mkdirSync(path.dirname(file), { recursive: true });
  freeze(file);
  writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
}

const storage = createStorageImpl({ dbPath });
await storage.migrate();
const db = storage.db;
const counts = {};

// runs + trajectory
{
  const runs = runsRepo.createRunRepository(storage).list({ limit: Number.MAX_SAFE_INTEGER });
  freeze(path.join(configDir, "agent-runs.jsonl"));
  writeJsonl(path.join(configDir, "agent-runs.jsonl"), runs);
  counts.runs = runs.length;
  const trajDir = path.join(configDir, "agent-trajectories");
  let trajCount = 0;
  for (const r of runs) {
    const events = runsRepo.createRunRepository(storage).getTrajectory(r.id);
    if (events.length) { writeJsonl(path.join(trajDir, `${r.id}.jsonl`), events); trajCount += events.length; }
  }
  counts.trajectory_events = trajCount;
}

// memory_records
{
  const records = memRepo.createMemoryRepository(storage).list({ limit: Number.MAX_SAFE_INTEGER });
  freeze(path.join(configDir, "memory-records.json"));
  writeJson(path.join(configDir, "memory-records.json"), { schemaVersion: 1, records });
  counts.memory_records = records.length;
}

// memory_profile
{
  const profile = repos.createMemoryProfileRepository(storage).read();
  if (profile.content) {
    freeze(path.join(configDir, "memory-persona.md"));
    writeFileSync(path.join(configDir, "memory-persona.md"), profile.content, "utf8");
    counts.memory_profile = 1;
  }
}

// goals + ledger
{
  const dir = path.join(configDir, "agent-goals");
  mkdirSync(dir, { recursive: true });
  const rows = db.prepare("SELECT payload FROM goals").all().map((r) => JSON.parse(r.payload));
  for (const g of rows) {
    writeJson(path.join(dir, `${g.id}.json`), g);
    const ledger = goalRepo.createGoalRepository(storage).readLedger(g.id);
    if (ledger.length) writeJsonl(path.join(dir, `${g.id}.ledger.jsonl`), ledger);
  }
  counts.goals = rows.length;
}

// chat sessions (authoritative event projection + message rows)
{
  const repository = chatRepo.createChatSessionEventRepository(storage);
  let out = repository
    .listProjections()
    .map((projection) => repository.getSession(projection.session.id))
    .filter(Boolean);
  // Compatibility with databases created before RC05 and never opened by the
  // new runtime.
  if (out.length === 0) {
    const sessions = sessRepo.createSessionRepository(storage).listSessions({ kind: "chat" });
    out = sessions.map((session) => {
      const payload = session.payload ?? {};
      const messages = db
        .prepare(
          `SELECT payload FROM chat_messages
           WHERE session_id = ?
           ORDER BY created_at ASC, rowid ASC`,
        )
        .all(session.id)
        .map((row) => JSON.parse(row.payload));
      return {
        ...payload,
        messages: messages.length ? messages : (payload.messages ?? []),
      };
    });
  }
  if (out.length) { freeze(path.join(configDir, "chat-sessions.json")); writeJson(path.join(configDir, "chat-sessions.json"), { schemaVersion: 1, sessions: out }); }
  counts.sessions = out.length;
}

// multi-agent sessions
{
  const sessions = sessRepo.createSessionRepository(storage).listSessions({ kind: "multi_agent" });
  const out = sessions.map((s) => s.payload ?? {});
  if (out.length) { freeze(path.join(configDir, "multi-agent-sessions.json")); writeJson(path.join(configDir, "multi-agent-sessions.json"), { schemaVersion: 1, sessions: out }); }
  counts.sessions_multi = out.length;
}

// workspaces
{
  const workspaces = repos.createWorkspaceRepository(storage).list();
  if (workspaces.length) { freeze(path.join(configDir, "agent-workspaces.json")); writeJson(path.join(configDir, "agent-workspaces.json"), { schemaVersion: 1, workspaces }); }
  counts.workspaces = workspaces.length;
}

// scheduled tasks
{
  const tasks = repos.createTaskRepository(storage).list();
  if (tasks.length) { freeze(path.join(configDir, "scheduled-tasks.json")); writeJson(path.join(configDir, "scheduled-tasks.json"), { schemaVersion: 1, tasks }); }
  counts.tasks = tasks.length;
}

// tool_audit
{
  const rows = db.prepare("SELECT payload FROM tool_audit ORDER BY created_at ASC").all().map((r) => JSON.parse(r.payload));
  if (rows.length) { freeze(path.join(configDir, "tool-audit.jsonl")); writeJsonl(path.join(configDir, "tool-audit.jsonl"), rows); }
  counts.tool_audit = rows.length;
}

// tool_results
{
  const rows = db.prepare("SELECT ref_key, blob FROM tool_results ORDER BY created_at ASC").all();
  const dir = path.join(configDir, "tool-result-refs");
  if (rows.length) mkdirSync(dir, { recursive: true });
  for (const row of rows) {
    const file = path.join(dir, `${row.ref_key}.json`);
    freeze(file);
    writeFileSync(file, row.blob, "utf8");
  }
  counts.tool_results = rows.length;
}

// learning_candidates
{
  const candidates = db.prepare("SELECT payload FROM learning_candidates ORDER BY created_at ASC").all().map((r) => JSON.parse(r.payload));
  if (candidates.length) { freeze(path.join(configDir, "agent-learning-candidates.json")); writeJson(path.join(configDir, "agent-learning-candidates.json"), { schemaVersion: 1, candidates }); }
  counts.learning_candidates = candidates.length;
}

// eval_candidates
{
  const candidates = db.prepare("SELECT payload FROM eval_candidates ORDER BY created_at ASC").all().map((r) => JSON.parse(r.payload));
  if (candidates.length) { freeze(path.join(configDir, "agent-eval-candidates.json")); writeJson(path.join(configDir, "agent-eval-candidates.json"), { schemaVersion: 1, candidates }); }
  counts.eval_candidates = candidates.length;
}

// promoted_eval_fixtures
{
  const fixtures = db.prepare("SELECT payload FROM promoted_eval_fixtures ORDER BY created_at ASC").all().map((r) => JSON.parse(r.payload));
  if (fixtures.length) { freeze(path.join(configDir, "agent-promoted-eval-fixtures.json")); writeJson(path.join(configDir, "agent-promoted-eval-fixtures.json"), { schemaVersion: 1, fixtures }); }
  counts.promoted_eval_fixtures = fixtures.length;
}

// artifacts (provenance sidecars)
{
  const manifests = db.prepare("SELECT payload FROM artifacts ORDER BY created_at ASC").all().map((r) => JSON.parse(r.payload));
  for (const manifest of manifests) {
    if (!manifest.destination?.path) continue;
    const file = `${manifest.destination.path}.provenance.json`;
    freeze(file);
    writeJson(file, manifest);
  }
  counts.artifacts = manifests.length;
}

// validation
{
  const v = repos.createValidationRepository(storage).load();
  if (v) { freeze(path.join(configDir, "agent-validation.json")); writeJson(path.join(configDir, "agent-validation.json"), { schemaVersion: 1, latest: v }); counts.validation = 1; }
}

storage.close();
console.log(JSON.stringify({ rolledBack: counts }, null, 2));

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      if (argv[i + 1] && !argv[i + 1].startsWith("--")) out[key] = argv[++i];
      else out[key] = true;
    }
  }
  return out;
}
