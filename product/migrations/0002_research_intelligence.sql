-- migrations/0002_research_intelligence.sql — P0 research-upgrade columns.
-- Versioned commercial brief per run, prospect-owned evidence linkage,
-- dimensional qualification. Additive only; old runs keep working (NULL brief
-- = legacy behavior for already-terminal runs, which are never re-processed).
-- Apply: npx wrangler d1 execute prospect_research --local --file=./migrations/0002_research_intelligence.sql
--        npx wrangler d1 execute prospect_research --remote --file=./migrations/0002_research_intelligence.sql
ALTER TABLE research_run ADD COLUMN commercial_brief TEXT;
ALTER TABLE prospect ADD COLUMN evidence_ids TEXT NOT NULL DEFAULT '[]';
ALTER TABLE assessment ADD COLUMN dimensions TEXT;
ALTER TABLE assessment ADD COLUMN verdict TEXT;
