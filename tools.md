# tools.md — Tool Registry

- Status: approved through v0.2 (2026-10-29). v0.1 approved 2026-10-28.
- Normative for tool names and parameter schemas. Code registries must match
  (contract-tested). Two model-tool parts plus deterministic delivery operations.
- Global naming rules: lowercase with at most one dot (per Responses API
  constraints); never `browser.*`; `dev.*` reserved for System A,
  `rs.*` reserved for System B. Descriptions steer the model (`tool_choice` is
  always `auto`, so tools must be unambiguously described).

## Part A — System A tools (local controller, Python execution layer)

Spec owner: `specs/agent-loop.md`. All paths confined to the repo root.
Implementation: `loop.py` + `controller/` (50/50 harness green; budgets, gates,
resume, recovery verified over live runs).

### dev.read_file(path, offset?, limit?) → text window

- Purpose: read a repo file (paginated). Params: `path` (string, repo-relative),
  `offset` (int ≥1, default 1), `limit` (int 1–2000, default 500).
- Permissions: auto. Validation: path inside root; file exists and is text.
- Errors: `not_found`, `outside_root`, `binary_rejected`, each returned as tool
  error (not exception).

### dev.list_dir(path?) → entry list

- Purpose: list a repo directory (names + kinds + sizes, one level).
- Params: `path` (string, default "."). Permissions: auto. Validation: inside root.

### dev.write_file(path, content) → created file

- Purpose: create or fully overwrite a repo file. Params: `path`, `content`
  (string, ≤200KB).
- Permissions: auto inside root except forbidden set (`.env`, `.dev.vars`, key
  material, `.runs/*` — run dir is loop-managed). Overwriting an existing file
  requires the model to have read it this run (enforced via transcript check).
- Validation: schema + forbidden-set + size. Errors: `forbidden_path`,
  `unread_overwrite`, `too_large`.

### dev.edit_file(path, find, replace) → edited file

- Purpose: exact-match single replacement. Params: `path`, `find` (nonempty),
  `replace`.
- Permissions: auto (same forbidden set as write). Validation: `find` occurs
  exactly once; file size stays ≤200KB. Errors: `no_match`, `ambiguous_match`,
  `forbidden_path`.

### dev.run_tests(command, timeout_s?) → test result

- Purpose: run the project's test command(s). Params: `command` (must be on the
  test allowlist recorded in the run record, e.g. `pytest`, `npm test -- --run`),
  `timeout_s` (default 300, max 600).
- Permissions: auto when allowlisted; anything else is rejected (use `dev.run_shell`
  + gate). Output truncated (200KB head+tail), secret-redacted. Records exit code,
  duration, tail.

### dev.run_shell(command, timeout_s?, cwd?) → command result

- Purpose: general local execution (build, lint, git reads, scaffolding).
- Params: `command` (string), `timeout_s` (default 120, max 600), `cwd`
  (repo-relative, default ".").
- Permissions: approval gate always in v0, except read-only git/network-free
  informational commands on an explicit mini-allowlist (`git status`, `git diff`,
  `git log`, `node --version`, etc. — listed in the run record at start).
- Validation: no backgrounding/detaching (`&`, `nohup`, `setsid` rejected);
  destructive git ops (`reset --hard`, `push --force`, history rewrites) rejected
  as forbidden, never gated. Same truncation/redaction as tests.

### dev.complete_objective(criteria[]) → completion claim

- Purpose: claim the objective is complete. Params: `criteria` (list of
  {criterion, verdict: pass|fail|partial, evidence: transcript/file/test pointers}).
- Permissions: auto to call; effect is to raise the completion gate (§10 of
  agent-loop spec). The loop mechanically checks pointer existence, then pauses
  for human approval. Not executable twice (second call rejected).

## Part B — System B tools (product runtime, Worker/Workflow execution layer)

Spec owner: `specs/research-loop.md`. Built-in `web_search` is Meta-hosted (not
defined here); these are the developer function tools beside it.

### rs.fetch_page(url, max_chars?) → page text

- Purpose: fetch a public page and return extracted text. Params: `url`
  (http/https only; private IPs, localhost, and non-web schemes rejected),
  `max_chars` (default 12000, max 60000).
- Permissions: auto within run fetch budget. Behavior: 10s timeout, 1 retry;
  size cap 2MB raw; blocks/empties/timeouts return structured fetch-failure
  (recorded as evidence, never thrown away).

### rs.get_run_state(run_id, include?) → run snapshot

- Purpose: read current D1 state for the run (brief, counters, rows by kind).
- Params: `run_id`, `include` (list subset of brief|prospects|evidence|budgets,
  default all). Permissions: auto, read-only.

### rs.save_evidence(run_id, claim, quote, source_url?, source_type, reliability, conflicts_with?) → evidence id

- Purpose: persist one evidence row. Params per `specs/data-model.md` evidence
  fields; enums closed. Permissions: auto. Validation: `model_inference` must not
  carry `source_url`; referenced conflict target must exist. Returns row id.

### rs.save_candidate(run_id, name, category, location, evidence_ids[]) → prospect id

- Purpose: insert or merge a candidate (dedupe enforced in code).
- Params: per prospect fields; `evidence_ids` must exist. Returns prospect id +
  `merged: bool` when a collision merged.

### rs.save_assessment(prospect_id, fit_rating, supporting_ids[], weakening_ids[], uncertainties[], missing_info[], rationale) → assessment id

- Purpose: persist a fit assessment. Params per assessment fields; rating 1–5.
- Validation: referenced ids exist; empty supporting list forces rating ≤ 2
  (rejected otherwise with reason, so the model corrects).

### rs.save_route(prospect_id, channel, value, evidence_id) → route id

- Purpose: persist a contact route. Params: closed channel enum; `evidence_id`
  mandatory. Verification level is server-set to `public_listing` (not a model
  parameter — stronger claims are unrepresentable).

### rs.save_draft(prospect_id, channel_suggestion, subject?, body, next_action, follow_up_days?) → draft id

- Purpose: persist an outreach draft. Params per draft fields; body ≤4000 chars.
- Validation: prospect is shortlisted; body references at least one evidence id
  (citation markers checked); else rejected with reason.

## Part C — Deterministic delivery operations (NOT model tools)

Delivery, scheduling, and contact tracking are deterministic HTTP operations by
design (principle 7, `specs/architecture.md` §2): the model must never send,
schedule, or touch credentials. No `rs.*` tool exists for these; the contract
below is the route surface instead (handlers in `product/src/delivery/`,
registered in `product/src/index.ts`).

- Connections: `POST /api/connections`, `GET /api/connections`,
  `POST /api/connections/:id/verify`, `POST /api/connections/:id/disconnect`,
  `GET /api/connections/gmail/auth-url`, `GET /api/connections/gmail/callback`.
  Secrets sealed with `CRED_KEY`, never returned (`publicConn` tested).
- Campaigns: `POST /api/campaigns`, `GET /api/campaigns`, `GET /api/campaigns/:id`,
  `PATCH /api/campaigns/:id` (draft-only), `POST /api/campaigns/:id/approve`,
  `/cancel`, `/pause`, `/resume`, `/process` (manual producer tick).
- Execution: cron `*/5 * * * *` → `scheduled()` → `enqueueDueJobs` →
  `DELIVERY_QUEUE` → `queue()` → `consumeDeliveryBatch`. Batch 10, max 2
  concurrent consumers, ×5 crash retries then `delivery-dlq`, app backoff + ACK
  for transient provider errors.
- Safety: `GET|POST /api/suppressions`, `DELETE /api/suppressions/:email`,
  `GET /api/unsubscribe?token=` (HMAC, 24h OAuth state TTL for Gmail flow).
- Assist: `GET /api/assist/mailto`, `GET /api/assist/wa` (validated builders).
- Tracking: `POST|GET /api/prospects/:id/contacts`,
  `GET /api/prospects/:id/timeline`; campaign sends auto-log `contact_event`.
- Provider contract (`DeliveryProvider`): `verify` / `send` with
  `SendResult{ok, providerMessageId?, status, retryable, errorCategory?,
  errorDetail?}`; adapters: mock, resend, gmail (graph/smtp throw
  not-implemented).

## Contract-compliance rule

Any code change to a tool's name, parameters, or behavior requires the matching
`tools.md` edit in the same change, plus the contract test update. Drift between
registry and implementation is a release-blocking defect in both systems.
Delivery routes follow the same rule (route + shape + test move together).

## Version history

- v0.1 (2026-10-28): initial draft for review.
- v0.2 (2026-10-29): Part C (deterministic delivery surface), System A
  implementation note, delivery contract rule. Rationale: hybrid delivery built
  live; restart-from-docs requirement.
