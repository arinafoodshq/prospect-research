-- product/migrations/0003_activity_test_send.sql — allow activity event
-- 'test_send'. SQLite cannot ALTER a CHECK constraint: rebuild the table,
-- copy the rows, swap. Nothing else references activity, so the swap is safe.
CREATE TABLE activity_v3 (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES research_run(id),
  prospect_id TEXT REFERENCES prospect(id),
  event TEXT NOT NULL CHECK (event IN (
    'created','assessed','shortlisted','drafted','approved','rejected',
    'deferred','contacted','follow_up_logged','stopped','test_send')),
  note TEXT,
  created_at TEXT NOT NULL
);
INSERT INTO activity_v3 (id, run_id, prospect_id, event, note, created_at)
  SELECT id, run_id, prospect_id, event, note, created_at FROM activity;
DROP TABLE activity;
ALTER TABLE activity_v3 RENAME TO activity;
CREATE INDEX IF NOT EXISTS idx_activity_run ON activity(run_id);
