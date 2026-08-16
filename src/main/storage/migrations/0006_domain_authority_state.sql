-- P97 SC07: durable per-domain bootstrap markers.

CREATE TABLE IF NOT EXISTS domain_authority_state (
  domain TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  imported_at TEXT NOT NULL
);
