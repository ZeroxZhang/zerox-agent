#!/usr/bin/env node
// P1 one-shot migration: read legacy JSON/JSONL files under a configDir and
// load them into zerox.db via the P1 repositories. Idempotent (upserts).
//
//   node scripts/migrate-to-sqlite.mjs --configDir <path> [--dry-run] [--verify]
//
// Failures are recorded to <configDir>/migration-errors.jsonl and do not abort
// the overall migration (per spec T1.7). --dry-run reports planned row counts
// without writing. --verify re-reads and compares counts after migration.

import { readFileSync, readdirSync, existsSync, writeFileSync, appendFileSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

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

const errorsPath = path.join(configDir, "migration-errors.jsonl");
if (existsSync(errorsPath)) writeFileSync(errorsPath, "");
function logError(store, detail) {
  appendFileSync(errorsPath, JSON.stringify({ store, detail, at: new Date().toISOString() }) + "\n");
}
function readJson(file, fallback) {
  try {
    if (!existsSync(file)) return fallback;
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    logError(file, `parse failed: ${String(error)}`);
    return fallback;
  }
}
function readJsonl(file) {
  if (!existsSync(file)) return [];
  try {
    return readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    logError(file, `parse failed: ${String(error)}`);
    return [];
  }
}

const storage = createStorageImpl({ dbPath: path.join(configDir, "zerox.db") });
await storage.migrate();
const db = storage.db;

const counts = {};
function bump(store, n) { counts[store] = (counts[store] ?? 0) + n; }

function dryRunOnly() { return args["dry-run"] === true; }

// 1. workspaces
{
  const data = readJson(path.join(configDir, "agent-workspaces.json"), { workspaces: [] });
  for (const w of data.workspaces ?? []) {
    if (dryRunOnly()) { bump("workspaces", 1); continue; }
    try { repos.createWorkspaceRepository(storage).save(w); bump("workspaces", 1); } catch (e) { logError("workspaces", String(e)); }
  }
}

// 2. chat sessions + messages
{
  const data = readJson(path.join(configDir, "chat-sessions.json"), { sessions: [] });
  for (const s of data.sessions ?? []) {
    if (dryRunOnly()) { bump("sessions", 1); bump("chat_messages", s.messages?.length ?? 0); continue; }
    try {
      sessRepo.createSessionRepository(storage).createSession({
        id: s.id, kind: "chat", title: s.title, payload: s,
        createdAt: s.createdAt, updatedAt: s.updatedAt,
      });
      bump("sessions", 1);
      for (const m of s.messages ?? []) {
        sessRepo.createSessionRepository(storage).appendMessage({
          sessionId: s.id, role: m.role, content: m.content, createdAt: m.createdAt, message: m,
        });
        bump("chat_messages", 1);
      }
    } catch (e) { logError("sessions", String(e)); }
  }
}

// 3. multi-agent sessions + actors
{
  const data = readJson(path.join(configDir, "multi-agent-sessions.json"), { sessions: [] });
  for (const s of data.sessions ?? []) {
    if (dryRunOnly()) { bump("sessions_multi", 1); continue; }
    try {
      sessRepo.createSessionRepository(storage).createSession({
        id: s.id, kind: "multi_agent", title: s.title, status: s.status,
        rootRunId: s.rootRunId, workspaceId: s.workspaceId, payload: s,
        createdAt: s.createdAt, updatedAt: s.updatedAt,
      });
      bump("sessions_multi", 1);
    } catch (e) { logError("sessions_multi", String(e)); }
  }
}

// 4. tasks
{
  const data = readJson(path.join(configDir, "scheduled-tasks.json"), { tasks: [] });
  for (const t of data.tasks ?? []) {
    if (dryRunOnly()) { bump("tasks", 1); continue; }
    try { repos.createTaskRepository(storage).create({ ...t, id: t.id }); bump("tasks", 1); } catch (e) { logError("tasks", String(e)); }
  }
}

// 5. runs
{
  const runs = readJsonl(path.join(configDir, "agent-runs.jsonl"));
  for (const r of runs) {
    if (dryRunOnly()) { bump("runs", 1); continue; }
    try { runsRepo.createRunRepository(storage).create(r); bump("runs", 1); } catch (e) { logError("runs", String(e)); }
  }
}

// 6. trajectory_events
{
  const dir = path.join(configDir, "agent-trajectories");
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".jsonl"))) {
      const runId = f.replace(/\.jsonl$/, "");
      for (const e of readJsonl(path.join(dir, f))) {
        if (dryRunOnly()) { bump("trajectory_events", 1); continue; }
        try { runsRepo.createRunRepository(storage).appendTrajectory(e.runId ?? runId, e); bump("trajectory_events", 1); } catch (err) { logError("trajectory_events", String(err)); }
      }
    }
  }
}

// 7. memory_records
{
  const data = readJson(path.join(configDir, "memory-records.json"), { records: [] });
  for (const m of data.records ?? []) {
    if (dryRunOnly()) { bump("memory_records", 1); continue; }
    try { memRepo.createMemoryRepository(storage).write(m); bump("memory_records", 1); } catch (e) { logError("memory_records", String(e)); }
  }
}

// 8. memory_profile
{
  const file = path.join(configDir, "memory-persona.md");
  if (existsSync(file)) {
    const content = readFileSync(file, "utf8");
    if (!dryRunOnly()) { repos.createMemoryProfileRepository(storage).save(content); }
    bump("memory_profile", 1);
  }
}

// 9. goals + ledger
{
  const dir = path.join(configDir, "agent-goals");
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".json") && !f.endsWith(".ledger.jsonl"))) {
      const g = readJson(path.join(dir, f), null);
      if (g) { if (dryRunOnly()) { bump("goals", 1); continue; } try { goalRepo.createGoalRepository(storage).save(g); bump("goals", 1); } catch (e) { logError("goals", String(e)); } }
    }
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".ledger.jsonl"))) {
      const goalId = f.replace(/\.ledger\.jsonl$/, "");
      for (const ev of readJsonl(path.join(dir, f))) {
        if (dryRunOnly()) { bump("goal_ledger", 1); continue; }
        try { goalRepo.createGoalRepository(storage).appendLedger(goalId, ev); bump("goal_ledger", 1); } catch (e) { logError("goal_ledger", String(e)); }
      }
    }
  }
}

// 10. tool_audit
{
  for (const e of readJsonl(path.join(configDir, "tool-audit.jsonl"))) {
    if (dryRunOnly()) { bump("tool_audit", 1); continue; }
    try { repos.createToolAuditRepository(storage).append(e); bump("tool_audit", 1); } catch (err) { logError("tool_audit", String(err)); }
  }
}

// 11. tool_results (raw string content)
{
  const dir = path.join(configDir, "tool-result-refs");
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const refId = f.replace(/\.json$/, "");
      const content = readFileSync(path.join(dir, f), "utf8");
      if (dryRunOnly()) { bump("tool_results", 1); continue; }
      try { repos.createToolResultRepository(storage).write({ refId, content }); bump("tool_results", 1); } catch (e) { logError("tool_results", String(e)); }
    }
  }
}

// 12. learning_candidates
{
  const data = readJson(path.join(configDir, "agent-learning-candidates.json"), { candidates: [] });
  for (const c of data.candidates ?? []) {
    if (dryRunOnly()) { bump("learning_candidates", 1); continue; }
    try { repos.createLearningRepository(storage).create({ type: c.type, sourceRunId: c.sourceRunId, sourceTrajectoryEventIds: c.sourceTrajectoryEventIds, claim: c.claim, recommendedAction: c.recommendedAction, risk: c.risk }); bump("learning_candidates", 1); } catch (e) { logError("learning_candidates", String(e)); }
  }
}

// 13. eval_candidates
{
  const data = readJson(path.join(configDir, "agent-eval-candidates.json"), { candidates: [] });
  for (const c of data.candidates ?? []) {
    if (dryRunOnly()) { bump("eval_candidates", 1); continue; }
    try { repos.createEvalCandidateRepository(storage).create(c); bump("eval_candidates", 1); } catch (e) { logError("eval_candidates", String(e)); }
  }
}

// 14. validation_snapshots
{
  const data = readJson(path.join(configDir, "agent-validation.json"), { latest: null });
  if (data.latest) {
    if (!dryRunOnly()) { repos.createValidationRepository(storage).save(data.latest); }
    bump("validation_snapshots", 1);
  }
}

// 15. promoted_eval_fixtures
{
  const data = readJson(path.join(configDir, "agent-promoted-eval-fixtures.json"), { fixtures: [] });
  for (const f of data.fixtures ?? []) {
    if (dryRunOnly()) { bump("promoted_eval_fixtures", 1); continue; }
    try { repos.createPromotedEvalFixtureRepository(storage).upsert(f); bump("promoted_eval_fixtures", 1); } catch (e) { logError("promoted_eval_fixtures", String(e)); }
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
    } catch (e) { logError("artifacts", String(e)); }
  }
}

storage.close();

if (args.verify) {
  const storage2 = createStorageImpl({ dbPath: path.join(configDir, "zerox.db") });
  await storage2.migrate();
  const db2 = storage2.db;
  for (const [table, expected] of Object.entries(counts)) {
    const row = db2.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get();
    const actual = row?.n ?? 0;
    const status = actual === expected ? "OK" : `MISMATCH (expected ${expected})`;
    console.log(`  verify ${table}: ${actual} ${status}`);
  }
  storage2.close();
}

console.log(JSON.stringify({ dryRun: dryRunOnly(), counts, errors: existsSync(errorsPath) ? errorsPath : null }, null, 2));

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
