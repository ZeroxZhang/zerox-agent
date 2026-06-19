// Auto-generated migration bundle. The canonical SQL lives in
// ./migrations/*.sql; this embedded copy is what the runtime executes (tsc
// does not copy .sql files to dist-electron, so embedding is the robust
// single-source approach). Regenerate via `node scripts/sync-migration-bundle.mjs`
// after editing any .sql file. Do not edit by hand.

export interface BundledMigration {
  name: string;
  ordinal: number;
  sql: string;
}

export const BUNDLED_MIGRATIONS: BundledMigration[] = [
  {
    name: "0000_initial.sql",
    ordinal: 0,
    sql: `-- P1 initial schema (contracts v1.4 §1.2).
-- Every domain table stores the full domain record as a JSON \`payload\` TEXT
-- column (perfect parity with the legacy JSON/JSONL stores) alongside
-- denormalized, indexed columns used by hot query paths. FTS5 backs memory
-- search. This file is immutable once shipped; evolve via 0001_*.sql etc.

PRAGMA foreign_keys = ON;

-- sessions (replaces chatSessionStore + multiAgentSessionStore session rows)
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                -- chat | goal | scheduled | multi_agent
  parent_session_id TEXT,
  agent_role TEXT,
  title TEXT,
  root_run_id TEXT,
  status TEXT,
  workspace_id TEXT,
  payload TEXT NOT NULL,             -- full session record JSON
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_kind ON sessions(kind);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);

-- chat_messages (replaces chatSessionStore message search; Patch 26)
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,             -- JSON-encoded message content
  payload TEXT NOT NULL,             -- full message object JSON
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_msg_session ON chat_messages(session_id, created_at);

-- runs (replaces agentRunStore agent-runs.jsonl)
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  task_name TEXT NOT NULL,
  skill_name TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL,             -- full AgentRunRecord JSON
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runs_task ON runs(task_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);

-- trajectory_events (replaces agent-trajectories/<runId>.jsonl)
CREATE TABLE IF NOT EXISTS trajectory_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,             -- full AgentTrajectoryEvent JSON
  created_at TEXT NOT NULL,
  UNIQUE(run_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_traj_run_created ON trajectory_events(run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_traj_type ON trajectory_events(type);

-- checkpoints (replaces agentExecutionStore + kernel/checkpointStore)
CREATE TABLE IF NOT EXISTS checkpoints (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  kind TEXT NOT NULL,                -- runtime | checkpoint | markdown
  ref TEXT NOT NULL,
  status TEXT,                       -- runtime execution status (for listActive)
  payload TEXT NOT NULL,             -- full checkpoint JSON
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ckp_run_kind ON checkpoints(run_id, kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ckp_status ON checkpoints(status);

-- tool_results (replaces tool-result-refs/<refId>.json; content is raw string)
CREATE TABLE IF NOT EXISTS tool_results (
  ref_key TEXT PRIMARY KEY,
  run_id TEXT,
  blob TEXT NOT NULL,                -- raw string content (NOT JSON)
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tr_run ON tool_results(run_id);

-- memory_records (replaces memory-records.json) + FTS5
CREATE TABLE IF NOT EXISTS memory_records (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'global',   -- project | global | session (Patch 22)
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',        -- JSON array
  importance INTEGER NOT NULL DEFAULT 3,
  embedding BLOB,                         -- nullable; absent => BM25-only
  embedded_at TEXT,
  archived_at TEXT,
  archive_reason TEXT,                    -- consolidated|superseded|stale|user_archived
  source TEXT,                            -- JSON MemorySource (Patch 23; P7 populates)
  payload TEXT NOT NULL,                  -- full MemoryRecord JSON
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mem_scope_kind ON memory_records(scope, kind);
CREATE INDEX IF NOT EXISTS idx_mem_archived ON memory_records(archived_at);

-- memory_fts (FTS5 external-content table over memory_records)
CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
  title,
  content,
  tags,
  content='memory_records',
  content_rowid='rowid',
  tokenize='unicode61'
);
-- Triggers keep memory_fts in sync with memory_records.
CREATE TRIGGER IF NOT EXISTS memory_fts_ai AFTER INSERT ON memory_records BEGIN
  INSERT INTO memory_fts(rowid, title, content, tags)
  VALUES (new.rowid, new.title, new.content, new.tags);
END;
CREATE TRIGGER IF NOT EXISTS memory_fts_ad AFTER DELETE ON memory_records BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, title, content, tags)
  VALUES ('delete', old.rowid, old.title, old.content, old.tags);
END;
CREATE TRIGGER IF NOT EXISTS memory_fts_au AFTER UPDATE ON memory_records BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, title, content, tags)
  VALUES ('delete', old.rowid, old.title, old.content, old.tags);
  INSERT INTO memory_fts(rowid, title, content, tags)
  VALUES (new.rowid, new.title, new.content, new.tags);
END;

-- goals (replaces agent-goals/<id>.json)
CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  chat_session_id TEXT,
  status TEXT NOT NULL,
  payload TEXT NOT NULL,             -- full Goal JSON
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_goals_session ON goals(chat_session_id);
CREATE INDEX IF NOT EXISTS idx_goals_status ON goals(status);

-- goal_ledger (replaces agent-goals/<id>.ledger.jsonl)
CREATE TABLE IF NOT EXISTS goal_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  goal_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  payload TEXT NOT NULL,             -- full ProgressLedgerEvent JSON
  created_at TEXT NOT NULL,
  FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ledger_goal ON goal_ledger(goal_id, seq);

-- artifacts (replaces *.provenance.json sidecars)
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,               -- artifactId
  run_id TEXT,
  goal_id TEXT,
  milestone_id TEXT,
  path TEXT,
  sha256 TEXT,
  source TEXT,                       -- JSON source object
  payload TEXT NOT NULL,             -- full provenance manifest JSON
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_artifacts_run ON artifacts(run_id);

-- tasks (replaces scheduled-tasks.json)
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  skill_name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  next_run_at TEXT,
  payload TEXT NOT NULL,             -- full ScheduledTask JSON
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- tool_audit (replaces tool-audit.jsonl)
CREATE TABLE IF NOT EXISTS tool_audit (
  id TEXT PRIMARY KEY,
  run_id TEXT,
  tool TEXT,
  payload TEXT NOT NULL,             -- full ToolAuditEvent JSON
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_run ON tool_audit(run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON tool_audit(created_at DESC);

-- permissions (toolApproval memoization; P4 wires writers)
CREATE TABLE IF NOT EXISTS permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project TEXT,
  tool TEXT,
  pattern TEXT,
  action TEXT,
  created_at TEXT NOT NULL
);

-- actors (replaces multiAgentSessionStore lineage; P6 consumes)
CREATE TABLE IF NOT EXISTS actors (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  parent_actor_id TEXT,
  context_mode TEXT NOT NULL,        -- none | state | full
  status TEXT NOT NULL,              -- spawning|running|done|canceled|error
  task TEXT,
  payload TEXT NOT NULL,             -- full ActorRecord JSON
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_actors_run ON actors(run_id);

-- learning_candidates (replaces agent-learning-candidates.json)
CREATE TABLE IF NOT EXISTS learning_candidates (
  id TEXT PRIMARY KEY,
  source_run_id TEXT,
  type TEXT,
  status TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_learning_status ON learning_candidates(status);

-- eval_candidates (replaces agent-eval-candidates.json)
CREATE TABLE IF NOT EXISTS eval_candidates (
  id TEXT PRIMARY KEY,
  source_run_id TEXT,
  status TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_eval_status ON eval_candidates(status);

-- promoted_eval_fixtures (replaces agentPromotedEvalFixtures; Patch 1)
CREATE TABLE IF NOT EXISTS promoted_eval_fixtures (
  id TEXT PRIMARY KEY,
  source_candidate_id TEXT,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- workspaces (replaces agent-workspaces.json; Patch 1)
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL,
  kind TEXT NOT NULL,
  sandbox_policy TEXT,               -- JSON AgentSandboxPolicy
  git_metadata TEXT,                 -- JSON AgentWorkspaceGitMetadata
  payload TEXT NOT NULL,             -- full AgentWorkspace JSON
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_used_at TEXT
);

-- memory_profile (replaces memory-persona.md singleton; Patch 1)
CREATE TABLE IF NOT EXISTS memory_profile (
  id TEXT PRIMARY KEY,               -- fixed 'singleton'
  content TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- validation_snapshots (replaces agent-validation.json singleton; Patch 1)
CREATE TABLE IF NOT EXISTS validation_snapshots (
  id TEXT PRIMARY KEY,               -- fixed 'latest'
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`,
  },
];
