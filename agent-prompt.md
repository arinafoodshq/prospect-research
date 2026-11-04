# Prompt for the coding agent (paste as one message)

You are improving the Prospect Research app (Cloudflare Workers, Workflows, D1, Queues, Meta models through AI Gateway). Read `architecture.md` in full before touching code. It explains what is wrong and the target design. It was written without seeing the source, so confirm each claim in the code first.

## Goal

Research runs must feel fast and alive. First useful result in under 90 seconds, a 40-business run finished in 2 to 4 minutes, and the UI must always make clear that work is moving. Page refresh must resume the same view and never start or restart work.

## Order of work

1. **Read first, change nothing.** Answer these in a short note: (a) is discovery a model tool loop or a direct search API call, (b) which model and endpoint does each stage use, (c) where is `listEvidence` called per prospect, (d) how does the UI read progress today. Include file and line references.
2. **Measure.** Add per-stage `duration_ms` to `audit_log` (or equivalent) so we can compare before and after. Deploy only this and run the Ikeja grills and drinks brief once. Record the numbers in the table in section 14 of the architecture file.
3. **Phase 0** items 0.1 to 0.6, one at a time, each its own commit and its own deploy. Skip 0.6 if search can only be reached through the model loop, and tell me.
4. Stop and report. Do not start Phase 1 or later until I say so.

## Rules

- Tag the current deployed version before starting (`git tag pre-speed`) and note the Worker version id for `wrangler rollback`.
- After every edit, re-read the diff. Look for duplicated lines, leftover old code and two versions of the same function. You previously left a bogus second `phase()` call and had to fix it, so be careful.
- Run `npm test`, `npm run typecheck` and `node tests/smoke.mjs` before every deploy. All must pass. Add a unit test for every new pure function (the pool, the junk filter, the dedupe key).
- Budget exhaustion is a normal outcome, never a thrown error. Do not reintroduce throwing inside Workflow steps for expected conditions.
- Handlers must be idempotent. Guard state changes with `UPDATE ... WHERE state = expected`.
- Never put page text or large payloads in queue messages (128 KB limit). Send ids.
- Do not change the sending or approval flow. Nothing is sent without approval.
- Do not deploy in the last 60 minutes before the hackathon deadline.
- Workflow instances pin their version. Test with a new run, not an existing one.
- Keep user-facing copy in plain British English with no em dashes. Follow the existing style guide for any UI change.

## Report format after each step

One short block: what changed, the files touched, test results (counts), deployed version id, and the before and after numbers for the Ikeja brief. If something surprised you, say so.

## Definition of done for Phase 0

- Page opening uses a sliding window of 6 with an 8 second hard timeout including the body.
- No per-prospect full-run evidence query remains.
- Assess and draft calls run with bounded concurrency (start at 4).
- Junk names and duplicate domains are rejected before any page is opened, with tests using "HOTELS", "INDEPENDENT", "NOTICE OF ANNUAL GENERAL MEETING" and "Ikeja Hotels 2025 AR & ACCTS.cdr".
- Set-aside reasons are specific per business.
- The Ikeja run finishes meaningfully faster than the 15 minute baseline with a similar number of good prospects.
