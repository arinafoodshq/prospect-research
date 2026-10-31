-- product/migrations/0004_route_verification.sql — route verification states
-- (spec P0, 2026-10-31): every link the UI shows must have been checked.
-- SQLite cannot ALTER a CHECK: rebuild, copy, swap.
CREATE TABLE contact_route_v4 (
  id TEXT PRIMARY KEY,
  prospect_id TEXT NOT NULL REFERENCES prospect(id),
  channel TEXT NOT NULL CHECK (channel IN (
    'website_form','email','phone','social_profile','other')),
  value TEXT NOT NULL,
  verification TEXT NOT NULL DEFAULT 'public_listing'
    CHECK (verification IN ('public_listing','verified','unchecked','broken','wrong_type')),
  evidence_id TEXT NOT NULL REFERENCES evidence(id),
  created_at TEXT NOT NULL
);
INSERT INTO contact_route_v4 (id, prospect_id, channel, value, verification, evidence_id, created_at)
  SELECT id, prospect_id, channel, value, verification, evidence_id, created_at FROM contact_route;
DROP TABLE contact_route;
ALTER TABLE contact_route_v4 RENAME TO contact_route;
CREATE INDEX IF NOT EXISTS idx_route_prospect ON contact_route(prospect_id);
