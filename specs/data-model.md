# specs/data-model.md — Product Persistence (System B)

- Status: draft for review (v0.1, 2026-10-28).
- Owner: System B runtime state in D1. Abstract types; D1 DDL in M3.
- Conventions: `id` = text ULID-ish unique; `at` fields = ISO 8601 UTC;
  all tables carry `created_at`; money in minor units where present.

## 1. Entities

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
- Rules: one active draft per prospect (new versions supersede); no `sent` status
  exists in the MVP schema (sending is unrepresentable by design).

**activity** — append-only run/prospect event log.
- Fields: `id`, `run_id`, `prospect_id` (nullable), `event` (created | assessed |
  shortlisted | drafted | approved | rejected | deferred | contacted |
  follow_up_logged | stopped), `note` (nullable), `created_at`.
- Rules: insert-only; follow-ups-due derives from approvals + `follow_up_days` +
  elapsed time (derivation owned by the API, computed on read).

## 2. Relationships

- profile 1:N runs; run 1:N evidence/prospects/activity; prospect 1:N assessments
  (latest wins), routes, drafts; assessment N:N evidence via id lists; route N:1
  evidence; draft N:1 prospect.

## 3. Valid status transitions (enforced in code, tested in harness)

- run: created → discovering → investigating → assessing → drafting → complete;
  any active → awaiting_brief | awaiting_approval → back to prior active;
  any → stopped | failed (terminal; stopped resumable, failed needs new run).
- prospect: candidate → investigating → qualified | disqualified;
  qualified → shortlisted → approved | rejected | deferred; approved → contacted →
  closed. No backward transitions except deferred → shortlisted (re-review).
- draft: draft → approved | rejected | deferred; any decided → draft only via new
  version (supersede chain preserved).

## 4. Provenance and integrity rules

- Every material displayed claim resolves to an evidence row; inference-labeled
  rows display with an explicit marker; unknown is stored as missing rows plus
  `missing_info` entries, never as placeholder facts.
- Writes are validated before insert: foreign keys exist, enums match, transitions
  legal, dedupe keys unique. Violations reject the write with a structured error;
  the loop records the rejection as a tool-result failure, never a silent skip.

## 5. Retention and migrations

- MVP: retain everything per profile; no TTL. Schema changes via numbered D1
  migrations reviewed with the spec change that requires them.

## 6. Acceptance of this spec (DoD)

Done when: all entities, fields, transitions, and rules above are fixed; names
match `specs/architecture.md`, `specs/research-loop.md`, and `tools.md` Part B;
invalid states are unrepresentable or rejected with tests named in
`specs/evaluation.md`; and you approve it. Evidence: approval in `progress.md`.

## 7. Version history

- v0.1 (2026-10-28): initial draft for review.
