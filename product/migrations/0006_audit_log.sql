-- 0006: audit trail. The product acts on the user's behalf (research runs,
-- drafts, sends), so every API request, model call, and auth event lands here
-- redacted and truncated: user input, data passed, output received, outcome.
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  kind TEXT NOT NULL,
  run_id TEXT,
  subject TEXT,
  summary TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_run ON audit_log(run_id, ts);
CREATE INDEX IF NOT EXISTS idx_audit_kind ON audit_log(kind, ts);
