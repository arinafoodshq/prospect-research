-- 0008: per-channel message versions on the draft (WhatsApp short + casual,
-- Email full, DM ultra-short) so every tab of the Message studio sends the
-- right shape for its channel.
ALTER TABLE outreach_draft ADD COLUMN variants TEXT;
