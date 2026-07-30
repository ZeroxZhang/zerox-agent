-- Zerox Agent 3.8.0: durable Plan Mode records and append-only events.

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
