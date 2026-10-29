# specs/data-model.md — Product Persistence (System B)

- Status: approved through v0.2 (2026-10-29). v0.1 approved 2026-10-28.
- Owner: System B runtime state in D1. DDL in `product/schema.sql` (single file,
  `IF NOT EXISTS`, re-appliable); 14 tables as of v0.2.
- Conventions: `id` = text prefixed unique (`makeId`); `at` fields = ISO 8601 UTC;
  all tables carry `created_at`; money in minor units where present.

## 1. Entities (research)

**business_profile** — the confirmed brief input.
- Fields: `id`, `name`, `website_url` (nullable), `description`, `services` (JSON
  list), `value_proposition`, `target_market`, `service_area` (JSON:
  country/region/city/timezone), `constraints` (JSON: min order, price range,
  exclusions), `provenance` (JSON map field → stated | extracted+source | assumed),
  `status` (draft | confirmed), `version`, `confirmed_at` (nullable).
- Rules: research requires `status = confirmed`; edits after confirm bump `version`
  and keep prior versions readable.

**research_run** — one bounded research execution (maps 1:1 to a Workflow instance).
- Fields: `id`, `profile_id`, `workflow_instance_id`, `plan` (JSON),
  `status` (created | discovering | investigating | assessing | drafting |
  awaiting_brief | awaiting_approval | complete | stopped | failed),
  `stop_reason` (nullable), `budgets` (JSON caps), `consumed` (JSON counters +
  cost_usd_est), `started_at`, `finished_at` (nullable).
- Rules: exactly one active run per profile version; stop always records reason.

**evidence** — every sourced claim fragment.
- Fields: `id`, `run_id`, `claim` (short fact text), `quote` (supporting snippet),
  `source_url` (nullable for user-stated), `source_type` (search_snippet |
  fetched_page | business_site | user_stated | model_inference),
  `retrieved_at`, `reliability` (verified | inferred | unknown | conflicting).
- Rules: `model_inference` rows never carry a `source_url`; conflicting pairs link
  via `conflicts_with` (nullable evidence id); immutable once written (corrections
  are new rows superseding via `supersedes`, nullable).

**prospect** — a candidate buyer.
- Fields: `id`, `run_id`, `name`, `category`, `location` (JSON), `dedupe_key`,
  `status` (candidate | investigating | qualified | disqualified | shortlisted |
  approved | rejected | contacted | closed), `rank` (nullable), `created_at`.
- Rules: `dedupe_key` unique per run (normalised name + domain/handle, defined in
  `specs/research-loop.md`); status transitions validated (see §3).

**assessment** — fit evaluation of one prospect.
- Fields: `id`, `prospect_id`, `fit_rating` (1–5), `supporting_evidence_ids` (JSON),
  `weakening_evidence_ids` (JSON), `uncertainties` (JSON list),
  `missing_info` (JSON list), `model_id`, `created_at`.
- Rules: every id referenced must exist; empty supporting list forces
  `fit_rating ≤ 2` and a recorded rationale.

**contact_route** — a reachable path to a prospect.
- Fields: `id`, `prospect_id`, `channel` (website_form | email | phone |
  social_profile | other), `value`, `verification` (public_listing — the only MVP
  level), `evidence_id`, `created_at`.
- Rules: `evidence_id` mandatory; no other verification level exists in the MVP
  schema (stronger claims are unrepresentable by design).

**outreach_draft** — one draft + next action.
- Fields: `id`, `prospect_id`, `channel_suggestion`, `subject` (nullable), `body`,
  `next_action`, `follow_up_days` (nullable), `status` (draft | approved |
  rejected | deferred), `edited_by_human` (bool), `decided_at` (nullable).
- Rules: one active draft per prospect (new versions supersede); the only path
  from a draft toward sending is an approved campaign snapshot (FR-10).

**activity** — append-only run/prospect event log.
- Fields: `id`, `run_id`, `prospect_id` (nullable), `event` (created | assessed |
  shortlisted | drafted | approved | rejected | deferred | contacted |
  follow_up_logged | stopped), `note` (nullable), `created_at`.
- Rules: insert-only; follow-ups-due derives from approvals + `follow_up_days` +
  elapsed time (derivation owned by the API, computed on read).

## 2. Entities (delivery, new in v0.2)

**sender_connection** — a provider identity that can send.
- Fields: `id`, `provider` (mock | resend | gmail | graph | smtp),
  `label`, `sender_email`, `sender_name` (nullable), `status` (pending |
  connected | revoked | error), `secret_blob` (nullable; AES-GCM sealed JSON),
  `metadata_json` (non-secret: account ids, expiry), `last_verified_at`
  (nullable), `last_error` (nullable), `updated_at`.
- Rules: secrets sealed with `CRED_KEY`; API responses strip `secret_blob`
  always; disconnect nulls the blob; graph/smtp rows rejected at create
  (adapters unimplemented).

**campaign** — an approval-gated scheduled send.
- Fields: `id`, `run_id` (nullable), `name`, `connection_id` (nullable until
  approve), `status` (draft | scheduled | sending | paused | complete |
  cancelled | failed), `scheduled_at_utc` (nullable, ISO UTC), `timezone`
  (IANA, default UTC), `approved_at` (nullable), `stats_json`, `updated_at`.
- Rules: edits allowed only in draft; approve requires a connected sender, ≥1
  sendable recipient, and a parseable schedule; approval freezes snapshots;
  cancel parks all unsent recipients.

**campaign_recipient** — one per-recipient job.
- Fields: `id`, `campaign_id`, `prospect_id` (nullable), `email`,
  `subject_snapshot`, `body_snapshot`, `status` (queued | scheduled | sending |
  sent | accepted | delivered | bounced | failed | cancelled | suppressed),
  `attempts`, `provider_message_id` (nullable), `idempotency_key` (unique),
  `last_error` (nullable), `next_attempt_at` (nullable backoff gate),
  `sent_at` (nullable), `updated_at`.
- Rules: `UNIQUE (campaign_id, email)`; claim = guarded UPDATE + unique stamp
  read-back; `sent`/`accepted` set `sent_at`.

**delivery_attempt** — append-only attempt log per recipient.
- Fields: `id`, `recipient_id`, `attempt_no`, `status`,
  `provider_message_id` (nullable), `error_category` (nullable: auth |
  validation | rate_limit | transient | permanent | policy), `error_detail`
  (nullable, safe truncated), `created_at`.
- Rules: insert-only; one row per attempt including recoveries and suppressions.

**suppression** — do-not-contact list.
- Fields: `email` (PK, lowercased), `reason` (unsubscribed | bounced |
  complaint | manual), `source`, `created_at`.
- Rules: checked at approve and immediately before every send; hard bounces
  auto-insert.

**contact_event** — every touch with a prospect, any channel.
- Fields: `id`, `prospect_id`, `campaign_id` (nullable), `recipient_id`
  (nullable), `channel` (email | whatsapp | telegram | phone | sms |
  in_person | other), `direction` (outbound | inbound, default outbound),
  `note` (nullable, ≤500), `contacted_at` (user-stated or system ISO),
  `created_at`.
- Rules: campaign sends auto-insert (channel email); manual inserts also append
  an `activity(contacted)` row; timeline merges contacts + activity newest-first.

## 3. Relationships

- profile 1:N runs; run 1:N evidence/prospects/activity; prospect 1:N assessments
  (latest wins), routes, drafts, contact events; assessment N:N evidence via id
  lists; route N:1 evidence; draft N:1 prospect.
- connection 1:N campaigns; campaign 1:N recipients + attempts (via recipient);
  campaign N:1 run (nullable); recipient N:1 prospect (nullable); suppression
  stands alone (email key); contact_event N:1 prospect, campaign, recipient.

## 4. Valid status transitions (enforced in code, tested in harness)

- run: created → discovering → investigating → assessing → drafting → complete;
  any active → awaiting_brief | awaiting_approval → back to prior active;
  any → stopped | failed (terminal; stopped resumable, failed needs new run).
- prospect: candidate → investigating → qualified | disqualified;
  qualified → shortlisted → approved | rejected | deferred; approved → contacted →
  closed. No backward transitions except deferred → shortlisted (re-review).
- draft: draft → approved | rejected | deferred; any decided → draft only via new
  version (supersede chain preserved).
- campaign: draft → scheduled → sending → complete; scheduled|sending → paused →
  scheduled; draft|scheduled|sending|paused → cancelled; any → failed (sender
  lost, auth failure, config error). Complete/cancelled/failed terminal.
- recipient: queued|scheduled → sending → sent | accepted | delivered | bounced |
  failed | suppressed; sending → queued (transient retry, bounded attempts);
  queued|scheduled|sending → cancelled | suppressed. Sent-family terminal.

## 5. Provenance and integrity rules

- Every material displayed claim resolves to an evidence row; inference-labeled
  rows display with an explicit marker; unknown is stored as missing rows plus
  `missing_info` entries, never as placeholder facts.
- Writes are validated before insert: foreign keys exist, enums match, transitions
  legal, dedupe keys unique. Violations reject the write with a structured error;
  the loop records the rejection as a tool-result failure, never a silent skip.
- Delivery integrity: snapshots frozen at approve; idempotency keys unique;
  suppression re-checked at send; secrets never selected into API shapes
  (`publicConn` strips the blob — tested).

## 6. Retention and migrations

- MVP: retain everything per profile; no TTL. Schema changes land in
  `product/schema.sql` (`IF NOT EXISTS`, re-appliable) and ship with the spec
  change that requires them; remote applied via
  `wrangler d1 execute prospect_research --remote --file=schema.sql`.

## 7. Acceptance of this spec (DoD)

Done when: all entities, fields, transitions, and rules above are fixed; names
match `specs/architecture.md`, `specs/research-loop.md`, and `tools.md`;
invalid states are unrepresentable or rejected with tests named in
`specs/evaluation.md`; and you approve it. Evidence: approval in `progress.md`.

## 8. Version history

- v0.1 (2026-10-28): initial draft for review.
- v0.2 (2026-10-29): six delivery entities, campaign/recipient transitions,
  delivery integrity rules, schema-file convention. Rationale: hybrid delivery
  built live; restart-from-docs requirement.
