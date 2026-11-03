-- 0009: sender_connection ownership (owner directive 2026-11-03: "that one
-- I use. That is me personally. People should not be able to have the
-- authority to use that email to send out to everybody.").
-- Every connection belongs to exactly one operator; listing, verifying,
-- disconnecting and sending through a connection are scoped to its owner.
ALTER TABLE sender_connection ADD COLUMN owner_email TEXT;
-- Backfill: the pre-existing connections were connected by the product owner.
UPDATE sender_connection SET owner_email = 'samdoxiso@gmail.com' WHERE owner_email IS NULL;
