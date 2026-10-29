# specs/research-loop.md — Product Runtime Loop (System B)

- Status: draft for review (v0.1, 2026-10-28).
- Owner: System B only. Deployed loop (Worker + Workflow + D1). Distinct from the
  development controller loop in `specs/agent-loop.md`: different runtime, tools,
  state, budgets, and gates. Machine-readable tool contracts: `tools.md` Part B.

## 1. Overview

One research run turns a confirmed brief into a ranked, evidence-backed shortlist
with contact routes and approval-ready drafts. Execution is a model-directed tool
cycle inside durable Workflow phases: the model chooses searches, fetches, and
assessments; deterministic code validates writes, enforces dedupe and budgets,
and holds human gates. All state persists to D1 phase by phase, so any stop —
budget, gate, failure — preserves reviewable partial results and supports resume.

## 2. Principles

1. **Phases are durable, bursts are conversational.** Each phase persists to D1 on
   completion; inside a phase the model may run a short tool-loop burst chained
   with `previous_response_id`.
2. **Write-through evidence.** No phase output (candidate, rating, route, draft)
   persists without its evidence links validated first.
3. **Gates are wait states.** Brief confirmation precedes run start; draft approval
   gates completion. The Workflow waits; it never auto-advances.
4. **Degrade honestly.** Empty searches, skipped searches, blocked fetches, and
   thin categories produce labelled gaps and smaller shortlists — never invented
   prospects.
5. **Deterministic where it matters.** Dedupe keys, status transitions, budget
   checks, and gate enforcement are code, identical on every run.

## 3. Phases and Workflow mapping (one instance per run)

- **plan** (step): model drafts a search plan from the brief (business types ×
  locale angles, ≤8 queries); code validates shape and budget fit; plan stored on
  the run. Entry requires brief `status = confirmed`, else wait at `awaiting_brief`.
- **discover** (steps, bounded): per-query grounded-search bursts; candidate
  extraction (structured) → `prospect` rows (`status = candidate`) + `evidence`
  rows (search_snippet). Queries exhausted or candidate cap reached ends the phase.
- **investigate** (steps, bounded per prospect): page fetches for top candidates
  (rank cutoff by budget); extraction → further `evidence` rows (fetched_page);
  prospect → `investigating`. Blocked/empty/timeout fetches record explicit
  fetch-failure evidence, never silent skips.
- **assess** (steps): per investigated prospect, structured assessment → `assessment`
  rows + prospect → `qualified | disqualified` with rationale. Empty supporting
  evidence forces rating ≤ 2 per data-model rules.
- **rank** (step, deterministic + model rationale): dedupe merge pass (keys per
  §5), ordering by rating then evidence strength, shortlist cut (default 5–8);
  shortlisted status set; model writes per-item rationale referencing evidence ids.
- **draft** (steps): per shortlisted prospect, structured draft + next action →
  `outreach_draft` rows + `contact_route` rows (public_listing only). Then wait at
  `awaiting_approval` until every draft is decided via API (which `sendEvent`s).
- **close** (step): all drafts decided → run `complete`; activity log appended;
  follow-ups derived on read thereafter.

## 4. Model-directed tool cycle (inside discover/investigate/assess/draft bursts)

1. Build a phase-scoped request: brief excerpt + phase goal + relevant D1 state +
   product tool definitions + `web_search` (where searching).
2. Model responds with tool calls and/or text. No `web_search_call` in a
   search-intended burst is recorded as `search_not_run` (outcome, not error).
3. Validate each call (schema, permissions, budget) before executing; rejections
   return to the model as tool results (bounded: 3 per call).
4. Execute approved calls (function tools run in Worker/Workflow; `web_search`
   runs server-side at Meta); persist results to D1 through validated writers.
5. Continue the burst while phase work remains and burst caps hold (≤6 tool rounds
   per burst); then persist phase state and end the burst. Nothing carries to the
   next phase except D1 rows.

## 5. Dedupe

- Key: lowercase alphanumeric name stripped of legal suffixes + registrable domain
  or social handle when known. Computed in code at candidate insert; collisions
  merge into the earliest row, attaching new evidence to the survivor and logging
  the merge in `activity`.
- The model may propose merges across keys (aliases, rebrands); code applies them
  only with recorded rationale + supporting evidence, else rejects with reason.

## 6. Budgets (per run; mirror `specs/architecture.md` §6)

- Searches ≤ 30, fetches ≤ 40, candidates ≤ 25, tool rounds ≤ 6 per burst,
  cost ≤ $6, active compute ≤ 20 min. Checked before every Meta call and every
  fetch; breach stops the run with reason `budget_<name>` and status `stopped`.

## 7. Errors, retries, empty outcomes

- Meta 429/5xx/timeout: Workflow step retry with backoff (3 attempts), then phase
  pauses with resume instructions; D1 state intact.
- Meta 400/401: run `failed` with report (config/auth fault).
- Search with zero results / search skipped by model: recorded outcome; burst may
  rephrase once, then moves on. A run with zero candidates ends `stopped` with
  reason `no_candidates` and guidance text — an honest empty shortlist, never
  filler.
- Fetch blocked/empty/timeout (10s, 1 retry): fetch-failure evidence row; prospect
  continues with reduced evidence or is disqualified with rationale.
- Malformed structured output: 1 retry with schema reminder, then step fails over
  to manual-review marking (item flagged, run continues).

## 8. Resume

- Resume rebuilds phase context purely from D1 (brief + rows + counters); completed
  phases never re-run; the in-progress phase restarts its current burst at most
  once (idempotent writers keyed by dedupe/evidence identity make repeats safe).
- `stopped` runs resume via API; `failed` runs require a new run (record links
  predecessor for audit).

## 9. Human gates (Workflow `waitForEvent`)

- `brief_confirmed`: run cannot leave `created` until the confirm API validates
  and sends this event. Default timeout: none (runs wait indefinitely; listed as
  pending; owner may cancel).
- `drafts_decided`: run waits at `awaiting_approval` until every active draft is
  approved/rejected/deferred through validated API transitions. Partial decisions
  persist; the event fires once the set is complete.
- Gate answers are data validated by API code, never model commands.

## 10. Acceptance of this spec (DoD)

Done when: phases, bursts, dedupe, budgets, errors, resume, and gates are fully
specified; tool names match `tools.md` Part B exactly; state names match
`specs/data-model.md`; Workflow mapping matches `specs/architecture.md`; every
behavior names its verification in `specs/evaluation.md`; and you approve it.
Evidence: approval in `progress.md`.

## 11. Version history

- v0.1 (2026-10-28): initial draft for review.
