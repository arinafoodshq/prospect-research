-- product/schema.sql — D1 DDL for all 8 data-model entities.
-- Source: specs/data-model.md v0.1. SQLite/D1 dialect. TEXT enums checked
-- with CHECK constraints so invalid states are rejected at write time.
-- Conventions: id TEXT (ULID-ish); timestamps ISO 8601 UTC TEXT; JSON in TEXT columns.

PRAGMA foreign_keys = ON;

-- 1. business_profile — the confirmed brief input.
CREATE TABLE IF NOT EXISTS business_profile (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  website_url TEXT,
  description TEXT NOT NULL,
  services TEXT NOT NULL,            -- JSON list
  value_proposition TEXT NOT NULL,
  target_market TEXT NOT NULL,
  service_area TEXT NOT NULL,        -- JSON {country,region,city,timezone}
  constraints_json TEXT NOT NULL,    -- JSON {min_order,price_range,exclusions}
  provenance TEXT NOT NULL,          -- JSON map field -> stated|extracted+source|assumed
  status TEXT NOT NULL CHECK (status IN ('draft','confirmed')),
  version INTEGER NOT NULL DEFAULT 1,
  confirmed_at TEXT,                 -- nullable ISO 8601 UTC
  created_at TEXT NOT NULL
);

-- 2. research_run — one bounded research execution (1:1 Workflow instance).
CREATE TABLE IF NOT EXISTS research_run (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES business_profile(id),
  workflow_instance_id TEXT NOT NULL,
  plan TEXT NOT NULL,                -- JSON search plan
  status TEXT NOT NULL CHECK (status IN (
    'created','discovering','investigating','assessing','drafting',
    'awaiting_brief','awaiting_approval','complete','stopped','failed')),
  stop_reason TEXT,                  -- e.g. budget_searches, no_candidates
  commercial_brief TEXT,             -- JSON versioned CommercialBrief (NULL = legacy run)
  budgets TEXT NOT NULL,             -- JSON caps
  consumed TEXT NOT NULL,            -- JSON counters + cost_usd_est
  started_at TEXT NOT NULL,
  finished_at TEXT,                  -- nullable
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_run_profile ON research_run(profile_id);

-- 3. evidence — every sourced claim fragment (immutable once written).
CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES research_run(id),
  claim TEXT NOT NULL,
  quote TEXT NOT NULL,
  source_url TEXT,                   -- NULL for user_stated / model_inference
  source_type TEXT NOT NULL CHECK (source_type IN (
    'search_snippet','fetched_page','business_site','user_stated','model_inference')),
  retrieved_at TEXT NOT NULL,
  reliability TEXT NOT NULL CHECK (reliability IN (
    'verified','inferred','unknown','conflicting')),
  conflicts_with TEXT REFERENCES evidence(id),
  supersedes TEXT REFERENCES evidence(id),
  created_at TEXT NOT NULL,
  CHECK (NOT (source_type = 'model_inference' AND source_url IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_evidence_run ON evidence(run_id);

-- 4. prospect — a candidate buyer. dedupe_key unique per run.
CREATE TABLE IF NOT EXISTS prospect (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES research_run(id),
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  location TEXT NOT NULL,            -- JSON
  dedupe_key TEXT NOT NULL,
  evidence_ids TEXT NOT NULL DEFAULT '[]',  -- JSON list of owning evidence ids
  status TEXT NOT NULL CHECK (status IN (
    'candidate','investigating','qualified','disqualified',
    'shortlisted','approved','rejected','contacted','closed','deferred')),
  rank INTEGER,                      -- nullable; set at rank phase
  created_at TEXT NOT NULL,
  UNIQUE (run_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_prospect_run ON prospect(run_id);

-- 5. assessment — fit evaluation of one prospect (latest wins).
CREATE TABLE IF NOT EXISTS assessment (
  id TEXT PRIMARY KEY,
  prospect_id TEXT NOT NULL REFERENCES prospect(id),
  fit_rating INTEGER NOT NULL CHECK (fit_rating BETWEEN 1 AND 5),
  supporting_evidence_ids TEXT NOT NULL,  -- JSON list
  weakening_evidence_ids TEXT NOT NULL,   -- JSON list
  uncertainties TEXT NOT NULL,            -- JSON list
  missing_info TEXT NOT NULL,             -- JSON list
  rationale TEXT NOT NULL,
  dimensions TEXT,                   -- JSON QualificationDims (NULL = legacy)
  verdict TEXT,                      -- qualified|needs_research|no_signal|manual_review|disqualified
  model_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assessment_prospect ON assessment(prospect_id);

-- 6. contact_route — a reachable path; verification always public_listing in MVP.
CREATE TABLE IF NOT EXISTS contact_route (
  id TEXT PRIMARY KEY,
  prospect_id TEXT NOT NULL REFERENCES prospect(id),
  channel TEXT NOT NULL CHECK (channel IN (
    'website_form','email','phone','social_profile','other')),
  value TEXT NOT NULL,
  verification TEXT NOT NULL DEFAULT 'public_listing'
    CHECK (verification = 'public_listing'),
  evidence_id TEXT NOT NULL REFERENCES evidence(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_route_prospect ON contact_route(prospect_id);

-- 7. outreach_draft — one draft + next action; no 'sent' status in MVP.
CREATE TABLE IF NOT EXISTS outreach_draft (
  id TEXT PRIMARY KEY,
  prospect_id TEXT NOT NULL REFERENCES prospect(id),
  channel_suggestion TEXT NOT NULL,
  subject TEXT,                      -- nullable
  body TEXT NOT NULL,
  next_action TEXT NOT NULL,
  follow_up_days INTEGER,            -- nullable
  status TEXT NOT NULL CHECK (status IN ('draft','approved','rejected','deferred')),
  edited_by_human INTEGER NOT NULL DEFAULT 0 CHECK (edited_by_human IN (0,1)),
  decided_at TEXT,                   -- nullable
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_draft_prospect ON outreach_draft(prospect_id);

-- 8. activity — append-only run/prospect event log (insert-only by convention).
CREATE TABLE IF NOT EXISTS activity (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES research_run(id),
  prospect_id TEXT REFERENCES prospect(id),
  event TEXT NOT NULL CHECK (event IN (
    'created','assessed','shortlisted','drafted','approved','rejected',
    'deferred','contacted','follow_up_logged','stopped','test_send')),
  note TEXT,                         -- nullable
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_run ON activity(run_id);

-- 9. sender_connection — provider identities; secrets AES-GCM sealed, never selected to UI.
CREATE TABLE IF NOT EXISTS sender_connection (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('mock','resend','gmail','graph','smtp')),
  label TEXT NOT NULL,
  sender_email TEXT NOT NULL,
  sender_name TEXT,                  -- nullable
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','connected','revoked','error')),
  secret_blob TEXT,                  -- nullable; sealed JSON {cipher_b64, nonce_b64}
  metadata_json TEXT NOT NULL DEFAULT '{}',  -- non-secret: account ids, expiry, domains
  last_verified_at TEXT,             -- nullable
  last_error TEXT,                   -- nullable
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 10. campaign — approval-gated scheduled sends; snapshots frozen at approve.
CREATE TABLE IF NOT EXISTS campaign (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES research_run(id),  -- nullable
  name TEXT NOT NULL,
  connection_id TEXT REFERENCES sender_connection(id),  -- nullable until approve
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','sending','paused','complete','cancelled','failed')),
  scheduled_at_utc TEXT,             -- nullable; ISO UTC
  timezone TEXT NOT NULL DEFAULT 'UTC',
  approved_at TEXT,                  -- nullable
  stats_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_campaign_status ON campaign(status);

-- 11. campaign_recipient — per-recipient job; idempotency_key guards duplicates.
CREATE TABLE IF NOT EXISTS campaign_recipient (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaign(id),
  prospect_id TEXT REFERENCES prospect(id),  -- nullable
  email TEXT NOT NULL,
  subject_snapshot TEXT NOT NULL,
  body_snapshot TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','scheduled','sending','sent','accepted','delivered','bounced','failed','cancelled','suppressed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  provider_message_id TEXT,          -- nullable
  idempotency_key TEXT NOT NULL UNIQUE,
  last_error TEXT,                   -- nullable
  next_attempt_at TEXT,              -- nullable; backoff gate, ISO UTC
  sent_at TEXT,                      -- nullable
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (campaign_id, email)
);
CREATE INDEX IF NOT EXISTS idx_recipient_campaign ON campaign_recipient(campaign_id);

-- 12. delivery_attempt — append-only attempt log per recipient.
CREATE TABLE IF NOT EXISTS delivery_attempt (
  id TEXT PRIMARY KEY,
  recipient_id TEXT NOT NULL REFERENCES campaign_recipient(id),
  attempt_no INTEGER NOT NULL,
  status TEXT NOT NULL,
  provider_message_id TEXT,          -- nullable
  error_category TEXT,               -- nullable: auth|validation|rate_limit|transient|permanent|policy
  error_detail TEXT,                 -- nullable; safe, truncated
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attempt_recipient ON delivery_attempt(recipient_id);

-- 13. suppression — do-not-contact list; email unique.
CREATE TABLE IF NOT EXISTS suppression (
  email TEXT PRIMARY KEY,
  reason TEXT NOT NULL CHECK (reason IN ('unsubscribed','bounced','complaint','manual')),
  source TEXT NOT NULL DEFAULT 'local',
  created_at TEXT NOT NULL
);

-- 14. contact_event — every touch with a prospect, any channel, manual or campaign.
CREATE TABLE IF NOT EXISTS contact_event (
  id TEXT PRIMARY KEY,
  prospect_id TEXT NOT NULL REFERENCES prospect(id),
  campaign_id TEXT REFERENCES campaign(id),  -- nullable
  recipient_id TEXT REFERENCES campaign_recipient(id),  -- nullable
  channel TEXT NOT NULL CHECK (channel IN ('email','whatsapp','telegram','phone','sms','in_person','other')),
  direction TEXT NOT NULL DEFAULT 'outbound' CHECK (direction IN ('outbound','inbound')),
  note TEXT,                         -- nullable
  contacted_at TEXT NOT NULL,        -- user-stated or system time, ISO UTC
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contact_prospect ON contact_event(prospect_id);
