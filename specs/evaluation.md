# specs/evaluation.md — Testing Strategy and Quality Bar

- Status: draft for review (v0.1, 2026-10-28).
- Owner: both systems, in separated sections. No live model calls in any test;
  live work happens only in explicitly approved runs/spikes.

## 1. Principles

1. **Mock the model, test the machine.** All automated tests run against
   deterministic recorded fixtures; model judgment is evaluated in golden
   scenarios, also fixture-driven unless explicitly live.
2. **Contracts before behavior.** Schema/registry/state-machine tests gate
   everything else: if names or shapes drift, nothing else runs.
3. **Budgets and gates are tested as behavior.** Stops, pauses, and rejections
   have the same test status as happy paths.
4. **Evidence honesty is measurable.** Citation coverage and unknown-labeling are
  Scored, not eyeballed.

## 2. Fixture design (shared)

- Recorded Responses API payloads: `web_search_call` (+ `results` with
  url/title/snippet), `url_citation` annotations, `function_call` items, usage
  blocks, error shapes (400/401/429/5xx), refusal and empty-output shapes.
- Fixtures are response bodies only, sanitised (no request headers/keys), stored
  under each system's test tree (`controller/tests/fixtures/`,
  `product/tests/fixtures/`), versioned with the specs that define their shapes.
- Scripted tool executors: deterministic file/shell/fetch/D1 doubles with
  programmable failures (timeout, block, empty, malformed).

## 3. System A — controller harness (gates M2)

- **Contract tests:** registry output ≡ `tools.md` Part A (names, schemas,
  descriptions present); module interfaces ≡ `specs/agent-loop.md` §13.
- **Unit tests:** validation tiers (auto/approval/forbidden matrix); sandbox
  escapes rejected (.., symlink, absolute); budget accounting and 80%/100%
  behavior; re-ask counting; gate raise/answer round-trip; resume hash check.
- **Scenario tests (mocked inference transcripts):**
  - S-A1 small doc edit: completes with minimal diff, zero gates, evidence-linked
    completion claim accepted.
  - S-A2 failing-test fix: runs tests, edits code, re-runs green, reports.
  - S-A3 shell beyond allowlist: gate raised, run pauses, answer resumes it.
  - S-A4 runaway objective: budget stops the run; partial work intact; report
    written.
  - S-A5 corrupt run record: abort with report, no state repair attempts.
- **Metrics:** scenario pass rate 100%; zero unapproved actions across all runs;
  zero secret values in any persisted output (scanner test).
- M2 exit = all green + human review of diffs. No live calls required.

## 4. System B — product tests (run in M3 per objective)

- **Unit:** dedupe-key computation and merge rules; status-transition validators
  (all legal/illegal pairs from `specs/data-model.md` §3); budget checks;
  follow-up derivation; citation-marker checking.
- **Contract:** product tool schemas ≡ `tools.md` Part B; API request/response
  shapes; structured-output schemas validate and reject malformed payloads.
- **Integration (mocked Meta + local D1):** phase writers persist valid rows and
  reject invalid ones; Workflow step retry then pause behavior (mocked); gate
  wait/`sendEvent` resume; resume-from-D1 without phase re-runs.
- **Golden end-to-end scenarios (recorded fixtures, scripted fetches):**
  - S-B1 happy path (catering brief): 5–8 shortlist, every claim cited, drafts
    valid, gates traversed.
  - S-B2 sparse category: small shortlist with explicit unknowns, no filler.
  - S-B3 empty results: clean `no_candidates` stop with guidance text.
  - S-B4 ambiguous business: clarification asked (≤5), brief corrected, run proceeds.
  - S-B5 approval paths: approve/edit/reject/defer all persist correctly; no
    sent-state reachable.
- **Quality metrics (scored on goldens + reviewed live runs):** citation coverage
  (% material claims with evidence links; bar: 100%); unknown-label rate on
  unknowable items (bar: 100%, zero guesses); fit-rating justification presence
  (bar: 100%); draft validity (evidence reference + length + next action; bar:
  100%); dedupe precision on seeded duplicates (bar: 100%).

## 5. Live-work policy (spikes and smoke runs)

- Allowed only after M0 approval + explicit permission stating question, cost cap,
  and fixture-output plan. Findings return as recorded fixtures or spec changes
  via change control — never as unrecorded behavior.
- **Scheduled spike S-0 (answers U-1):** the single search-grounding call
  (narrow Nigerian query, `search_context_size: low`, results included,
  `max_tool_calls: 3`). Inspect: `web_search_call` completed presence, `results`
  url/title/snippet, citation span slicing, usage. Cost cap $0.10. Output: first
  product fixture + coverage verdict in `progress.md`. Requires key configured
  (presence-confirmed) + explicit go.

## 6. Acceptance of this spec (DoD)

Done when: fixture formats, both harnesses, all scenarios, and all metrics/bars
are fixed; every loop/spec behavior points here for its verification; live-work
policy and S-0 are specified; and you approve it. Evidence: approval in
`progress.md`.

## 7. Version history

- v0.1 (2026-10-28): initial draft for review.
