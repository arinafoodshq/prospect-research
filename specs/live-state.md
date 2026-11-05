# Feature Specification: live run state (Phase 1)

> Written from SPECIFICATION.md (agent-rules-templates methodology) before
> implementation. Lands on STAGING first; promoted to live on the owner's
> word.

## Objective

A research run must feel alive and honest from the first second to the
park: the page shows per-stage counts that move while work happens, the
owner sees the first messages the moment they exist, and refreshing or
leaving and returning never starts, restarts, or resets anything.

## Use Cases

- Mary opens /progress two minutes into a run: she sees "Looking for
  businesses (34 found) - Reading their websites (12 of 34) - Checking
  they fit (5 of 12) - Writing your messages (1 ready)" with at least one
  number moving every few seconds.
- The dashboard hero flips to "4 messages are ready. The rest are still
  being written." the moment drafts exist, while research continues.
- She refreshes mid-run (or closes the tab and comes back): the same view
  resumes, the same numbers, nothing restarts.
- A set-aside row always carries a specific reason, including prospects
  disqualified by rule (no assessment exists).

## Key Functionality

- `RunCoordinator` Durable Object (SQLite-backed), one instance per run id:
  budget reserves, per-stage counters, in-flight counts, a small recent-
  events ring, and `live()` returning the UI snapshot. D1 stays the source
  of truth; the coordinator is a derived view it can rebuild.
- `GET /api/runs/:id/live` returns the snapshot the page reads (stages,
  skipped, firstReady, recent, settled). Owner-scoped like every run
  endpoint; unknown and not-yours stay indistinguishable (generic 404).
- The progress view reads the live endpoint on its existing poll cadence
  and renders stage counts instead of the single "N of M" bar.
- Dashboard hero gains the first-ready state (drafted >= 1 while the run
  is still working).
- "Kept so far" counts shortlisted and drafted (never an investigate-time
  default).
- Rule-disqualified prospects get a specific reason stored on the prospect
  (new nullable `reason` column + migration), shown in set-aside.

## Technical Requirements and Design

- Budget exhaustion stays a normal outcome: `reserve()` returns false,
  handlers skip and ack; nothing throws inside Workflow steps for expected
  conditions (the Phase 0 rule).
- Handlers are idempotent: state changes guard with
  `UPDATE ... WHERE state = expected`; duplicate deliveries change nothing.
- The coordinator is best-effort live state: if it is cold or empty, the
  endpoint falls back to the existing D1-derived snapshot (no new failure
  mode).
- Workflow instances pin their version: verify Phase 1 with NEW runs on
  staging, never by re-driving a live-run instance.
- Deploys: staging only (`wrangler deploy --env staging`); promote to live
  is a separate explicit step after the owner's test pass.
- Live D1 migrations for the `reason` column run ONLY at promotion time,
  never from staging against the live database.
- Validation: unit tests for the coordinator counters (pure parts) and the
  reason mapping; `npm test`, `npm run typecheck`, `node tests/smoke.mjs`
  green; a staging run exercised end to end by the owner.
- No changes to the approval or sending flow; nothing sends without a
  human press (standing rule).
