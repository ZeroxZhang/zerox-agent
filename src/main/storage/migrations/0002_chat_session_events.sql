-- Zerox Agent runtime convergence: append-only Chat facts and small projections.

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
