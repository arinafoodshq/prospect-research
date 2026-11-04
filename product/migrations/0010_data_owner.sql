-- 0010 — per-user data scoping (owner directive 2026-11-04: "every data must
-- be scoped to the user that started it or has it").
--
-- business_profile is the ownership root: runs, prospects, evidence, drafts,
-- campaigns and recipients all hang off one. owner_email is stamped at
-- creation from the signed-in session and checked on every read and write.
-- research_run and campaign carry a denormalized copy (stamped at creation,
-- profiles never change owner) so list endpoints filter on their own table.
--
-- NULL = legacy row created before scoping: hidden from every user, never
-- silently shared. The operator can claim legacy rows explicitly, e.g.
--   UPDATE business_profile SET owner_email = 'operator@example.com'
--     WHERE owner_email IS NULL;
-- (and the same for research_run, campaign, suppression).

ALTER TABLE business_profile ADD COLUMN owner_email TEXT;
ALTER TABLE research_run ADD COLUMN owner_email TEXT;
ALTER TABLE campaign ADD COLUMN owner_email TEXT;
ALTER TABLE suppression ADD COLUMN owner_email TEXT;

CREATE INDEX IF NOT EXISTS idx_business_profile_owner ON business_profile(owner_email);
CREATE INDEX IF NOT EXISTS idx_research_run_owner ON research_run(owner_email);
CREATE INDEX IF NOT EXISTS idx_campaign_owner ON campaign(owner_email);
CREATE INDEX IF NOT EXISTS idx_suppression_owner ON suppression(owner_email);
