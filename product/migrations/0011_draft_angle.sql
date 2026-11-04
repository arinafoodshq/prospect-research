-- 0011 — per-prospect offer angle (owner directive 2026-11-04: the "Your
-- offer" panel must reason per prospect — "event grilling for the events you
-- host" for a venue, "grill packs for staff lunch" for an office — in the
-- owner's voice, never a generic capability the business does not have).
-- The draft burst writes the angle; the studio shows it beside the offer.
ALTER TABLE outreach_draft ADD COLUMN angle TEXT;

-- Legacy drafts keep NULL angle; the studio falls back to the offer line.

