# objective.md — Current Approved Objective

## Format (normative)

Every objective file contains these sections, in this order:

1. **Objective.** One paragraph: the concrete deliverable and why.
2. **Scope.** In-scope items (files, behaviors). Closed list.
3. **Non-goals.** Explicitly excluded items.
4. **Acceptance criteria.** Numbered, each testable by a tool or human check.
5. **Budget.** Turns, wall-clock, cost USD, tokens (may only tighten loop defaults
   without extra rationale; widening needs recorded rationale here).
6. **Approval note.** Who approved, when, and any conditions. A run without this
   section filled and dated must refuse to start.

Machine-readable budget: exactly one fenced block tagged budget in the whole
file, placed in section 5, with one key=value per line using exactly the keys
turns, wall_s, cost_usd, tokens (example values: 25 / 1800 / 5.00 / 800000).
No other fenced budget block may appear anywhere, including in this format
description — the parser refuses objectives with zero or multiple blocks.

Rules: objectives are immutable during a run (hash-pinned at start); a changed
objective is a new objective requiring new approval.

---

## M3 Objective 6b: research tests + 4 type errors (strict read cap)

### Objective

Finish Objective 6: the research modules exist (phases/tools/budgets.ts,
workflow.ts rewrite, randomUUID fix) but 4 TS2379 errors remain and the
research test suite was never written because the prior run spent 13 turns
re-reading. This run fixes the errors, writes the suite, and goes green —
with a hard, countable read cap.

### Scope

Closed file list (all paths repo-relative):

- `product/src/research/phases.ts`, `product/src/research/tools.ts` — fix the 4
  TS2379 exactOptionalPropertyTypes errors (phases.ts ~lines 193/498,
  tools.ts ~lines 132/177): object literals passing `T | undefined` into
  optional props. Fix by conditional spread or exactOptional-safe
  construction. No logic changes beyond what the errors require.
- `product/src/index.ts` — verify the `as unknown as` cast is gone (prior run
  edited this file); if any cast remains, replace with the minimal-interface
  parameter. Read the relevant region once to confirm either way.
- `product/tests/research.test.ts` (new) — phase/dedupe/budget/gate-decision
  tests with mocked deps: dedupe merge behavior, budget-cap stops with reasons,
  empty-search clean stop, fetch-failure evidence, assessment rating cap with
  no supporting evidence, gate wait/resume decisions. No live calls.
- `product/tests/routes.test.ts` — READ ONLY (a prior run shrank it by ~127
  bytes; confirm the suite still contains all 24 tests and the resume
  assertions intact — do not weaken or "fix" any test to go green; if a test
  is genuinely wrong per specs, record it in the claim and fail loudly).
- Read cap (hard, counted from transcript): at most 10 dev.read_file calls and
  at most 4 dev.list_dir calls for the whole run. Exceeding fails efficiency
  review. Plan reads up front, batch them, use limit windows.
- Pacing: suite drafted by turn 14; typecheck + suite green by turn 22.
- Verification behavior: run `npm run typecheck` then `npm test` (cwd product)
  until both green; fix failures before claiming completion.

### Non-goals

- No `wrangler dev`/`deploy`/`d1 create`, no migrations run, no secrets touched.
- No live model calls, no network use beyond the two test commands.
- No UI changes, no spec/controller changes (genuine spec conflicts: record in
  the completion claim, do not edit specs).
- No new dependencies. No weakening tests to go green, ever.

### Acceptance criteria

1. `npm run typecheck` (cwd product) passes with zero errors as observed
   in-run tool output.
2. `npm test` (cwd product) passes as observed in-run tool output, including
   the new research suite and all 24 pre-existing tests unbroken (same count).
3. Research suite covers: dedupe merges, budget-cap stops with reasons,
   empty-search clean stop, fetch-failure evidence, rating cap without support,
   gate wait/resume decisions.
4. Transcript shows at most 10 read_file and 4 list_dir calls total.
5. No cloud operations performed; nothing outside Scope; verification gates only.

### Budget

Turns 25, wall-clock 1800s, cost $5.00, tokens 800000 combined.

```budget
turns=25
wall_s=1800
cost_usd=5.00
tokens=800000
```

### Approval note

Standing approval per AGENTS.md "Standing autonomy" (bounded in-scope product
backend objective, 2026-10-29). Conditions: writes confined to Scope list; no
cloud, secret, network, or install actions; any non-verification gate pauses.
