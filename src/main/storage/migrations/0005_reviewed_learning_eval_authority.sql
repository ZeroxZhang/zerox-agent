-- P97 SC06: reviewed learning/eval indexes, eval idempotency, and stable
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
