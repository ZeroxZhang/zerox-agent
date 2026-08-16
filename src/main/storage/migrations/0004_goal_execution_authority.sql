-- P97 SC03: Goal CAS, exactly-once ledger publication, and runtime checkpoint access.

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
