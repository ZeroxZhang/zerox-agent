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
  {
    name: "0001_plan_records.sql",
    ordinal: 1,
    sql: `-- Zerox Agent 3.8.0: durable Plan Mode records and append-only events.

CREATE TABLE IF NOT EXISTS plan_records (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  action_gate TEXT NOT NULL,
  revision INTEGER NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_plan_records_session
  ON plan_records(session_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_plan_records_status
  ON plan_records(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS plan_events (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  type TEXT NOT NULL,
  revision INTEGER NOT NULL,
  payload TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (plan_id) REFERENCES plan_records(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_plan_events_plan
  ON plan_events(plan_id, revision ASC, created_at ASC);
`,
  },
  {
    name: "0002_chat_session_events.sql",
    ordinal: 2,
    sql: `-- Zerox Agent runtime convergence: append-only Chat facts and small projections.

ALTER TABLE chat_messages ADD COLUMN seq INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_messages_session_seq
  ON chat_messages(session_id, seq)
  WHERE seq IS NOT NULL;

CREATE TABLE IF NOT EXISTS chat_session_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(session_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_chat_session_events_session
  ON chat_session_events(session_id, seq ASC);
CREATE INDEX IF NOT EXISTS idx_chat_session_events_type
  ON chat_session_events(type, created_at DESC);

CREATE TABLE IF NOT EXISTS chat_session_projections (
  session_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  watermark INTEGER NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  workspace_id TEXT,
  archived_at TEXT,
  message_count INTEGER NOT NULL,
  last_assistant_at TEXT,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chat_projection_updated
  ON chat_session_projections(updated_at DESC, session_id ASC);
CREATE INDEX IF NOT EXISTS idx_chat_projection_archived
  ON chat_session_projections(archived_at, updated_at DESC);

CREATE TABLE IF NOT EXISTS chat_store_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`,
  },
  {
    name: "0003_chat_search_fts.sql",
    ordinal: 3,
    sql: `-- P96 AE-11: bounded Chat search candidates backed by FTS5 trigram indexes.

CREATE INDEX IF NOT EXISTS idx_chat_messages_created
  ON chat_messages(created_at DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS chat_message_fts USING fts5(
  content,
  content='chat_messages',
  content_rowid='rowid',
  tokenize='trigram'
);

CREATE TRIGGER IF NOT EXISTS chat_message_fts_ai
AFTER INSERT ON chat_messages BEGIN
  INSERT INTO chat_message_fts(rowid, content)
  VALUES (new.rowid, new.content);
END;

CREATE TRIGGER IF NOT EXISTS chat_message_fts_ad
AFTER DELETE ON chat_messages BEGIN
  INSERT INTO chat_message_fts(chat_message_fts, rowid, content)
  VALUES ('delete', old.rowid, old.content);
END;

CREATE TRIGGER IF NOT EXISTS chat_message_fts_au
AFTER UPDATE OF content ON chat_messages BEGIN
  INSERT INTO chat_message_fts(chat_message_fts, rowid, content)
  VALUES ('delete', old.rowid, old.content);
  INSERT INTO chat_message_fts(rowid, content)
  VALUES (new.rowid, new.content);
END;

INSERT INTO chat_message_fts(chat_message_fts) VALUES ('rebuild');

CREATE VIRTUAL TABLE IF NOT EXISTS chat_session_title_fts USING fts5(
  title,
  content='chat_session_projections',
  content_rowid='rowid',
  tokenize='trigram'
);

CREATE TRIGGER IF NOT EXISTS chat_session_title_fts_ai
AFTER INSERT ON chat_session_projections BEGIN
  INSERT INTO chat_session_title_fts(rowid, title)
  VALUES (new.rowid, new.title);
END;

CREATE TRIGGER IF NOT EXISTS chat_session_title_fts_ad
AFTER DELETE ON chat_session_projections BEGIN
  INSERT INTO chat_session_title_fts(chat_session_title_fts, rowid, title)
  VALUES ('delete', old.rowid, old.title);
END;

CREATE TRIGGER IF NOT EXISTS chat_session_title_fts_au
AFTER UPDATE OF title ON chat_session_projections BEGIN
  INSERT INTO chat_session_title_fts(chat_session_title_fts, rowid, title)
  VALUES ('delete', old.rowid, old.title);
  INSERT INTO chat_session_title_fts(rowid, title)
  VALUES (new.rowid, new.title);
END;

INSERT INTO chat_session_title_fts(chat_session_title_fts) VALUES ('rebuild');
`,
  },
  {
    name: "0004_goal_execution_authority.sql",
    ordinal: 4,
    sql: `-- P97 SC03: Goal CAS, exactly-once ledger publication, and runtime checkpoint access.

ALTER TABLE goals ADD COLUMN plan_version INTEGER;
ALTER TABLE goals ADD COLUMN active_plan_id TEXT;

UPDATE goals
SET plan_version = MAX(
      1,
      COALESCE(CAST(json_extract(payload, '$.planVersion') AS INTEGER), 1)
    ),
    active_plan_id = json_extract(payload, '$.activePlanRef.planId');

CREATE INDEX IF NOT EXISTS idx_goals_plan_version
  ON goals(id, plan_version, active_plan_id);

CREATE TABLE goal_ledger_sc03 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  goal_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  publication_key TEXT,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(goal_id, seq)
);

-- Historical implementations checked publication keys before insert without a
-- database uniqueness constraint. Keep the earliest canonical publication if
-- such a database already contains duplicates, preserve every ordinary event,
-- and re-establish a dense deterministic sequence.
WITH canonical AS (
  SELECT
    ledger.*,
    CASE
      WHEN json_type(ledger.payload, '$.publicationKey') = 'text'
        THEN json_extract(ledger.payload, '$.publicationKey')
      ELSE NULL
    END AS canonical_publication_key
  FROM goal_ledger ledger
),
deduplicated AS (
  SELECT *
  FROM canonical candidate
  WHERE candidate.canonical_publication_key IS NULL
     OR candidate.id = (
       SELECT MIN(duplicate.id)
       FROM canonical duplicate
       WHERE duplicate.goal_id = candidate.goal_id
         AND duplicate.canonical_publication_key =
           candidate.canonical_publication_key
     )
),
ranked AS (
  SELECT
    id,
    goal_id,
    ROW_NUMBER() OVER (
      PARTITION BY goal_id
      ORDER BY seq ASC, id ASC
    ) AS canonical_seq,
    canonical_publication_key,
    payload,
    created_at
  FROM deduplicated
)
INSERT INTO goal_ledger_sc03 (
  id,
  goal_id,
  seq,
  publication_key,
  payload,
  created_at
)
SELECT
  id,
  goal_id,
  canonical_seq,
  canonical_publication_key,
  payload,
  created_at
FROM ranked
ORDER BY id ASC;

DROP TABLE goal_ledger;
ALTER TABLE goal_ledger_sc03 RENAME TO goal_ledger;

CREATE INDEX idx_ledger_goal ON goal_ledger(goal_id, seq);
CREATE UNIQUE INDEX idx_goal_ledger_publication_unique
  ON goal_ledger(goal_id, publication_key)
  WHERE publication_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS goal_ledger_sequences (
  goal_id TEXT PRIMARY KEY,
  next_seq INTEGER NOT NULL CHECK (next_seq >= 1)
);

INSERT INTO goal_ledger_sequences (goal_id, next_seq)
SELECT goal_id, MAX(seq) + 1
FROM goal_ledger
GROUP BY goal_id
ON CONFLICT(goal_id) DO UPDATE SET
  next_seq = MAX(goal_ledger_sequences.next_seq, excluded.next_seq);

CREATE INDEX IF NOT EXISTS idx_ckp_runtime_latest
  ON checkpoints(run_id, created_at DESC)
  WHERE kind = 'runtime';
`,
  },
  {
    name: "0005_reviewed_learning_eval_authority.sql",
    ordinal: 5,
    sql: `-- P97 SC06: reviewed learning/eval indexes, eval idempotency, and stable
-- promoted-fixture ordering.

CREATE INDEX IF NOT EXISTS idx_learning_status_type
  ON learning_candidates(status, type, created_at);

ALTER TABLE eval_candidates ADD COLUMN fixture_id TEXT;

UPDATE eval_candidates
SET fixture_id = json_extract(payload, '$.fixture.id');

-- The JSON store has always treated (sourceRunId, fixture.id) as an identity.
-- Keep the earliest row if a historical cross-process race bypassed that
-- application-level check, then enforce the identity in SQLite.
DELETE FROM eval_candidates
WHERE fixture_id IS NOT NULL
  AND rowid NOT IN (
    SELECT MIN(rowid)
    FROM eval_candidates
    WHERE fixture_id IS NOT NULL
    GROUP BY source_run_id, fixture_id
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_eval_source_fixture_unique
  ON eval_candidates(source_run_id, fixture_id)
  WHERE fixture_id IS NOT NULL;

ALTER TABLE promoted_eval_fixtures ADD COLUMN sort_order INTEGER;

UPDATE promoted_eval_fixtures AS fixture
SET sort_order = (
  SELECT COUNT(*)
  FROM promoted_eval_fixtures AS earlier
  WHERE earlier.created_at < fixture.created_at
     OR (
       earlier.created_at = fixture.created_at
       AND earlier.rowid <= fixture.rowid
     )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_promoted_fixture_sort_order
  ON promoted_eval_fixtures(sort_order);
`,
  },
  {
    name: "0006_domain_authority_state.sql",
    ordinal: 6,
    sql: `-- P97 SC07: durable per-domain bootstrap markers.

CREATE TABLE IF NOT EXISTS domain_authority_state (
  domain TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  imported_at TEXT NOT NULL
);
`,
  },
];
