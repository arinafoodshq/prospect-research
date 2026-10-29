# specs/architecture.md — Deployed Product Architecture (System B)

- Status: draft for review (v0.1, 2026-10-28).
- Owner: System B only. Detailed loop in `specs/research-loop.md`, persistence in
  `specs/data-model.md`, requirements in `specs/product.md`.

## 1. Overview

A web application: a TypeScript single-page frontend (conversational onboarding +
research workspace) backed by one Cloudflare Worker API that orchestrates
evidence-backed prospect research. Meta Responses API provides reasoning and
grounded web search; the Worker owns validation, budgets, and approval gates; D1
holds all runtime state; one Workflow per research run provides durable multi-step
execution with human-gate pauses. All model keys server-side.

## 2. Principles

1. **Server owns truth.** D1 state, not model memory, is the source of record;
   every phase reads and writes durable state.
2. **Model decides, code enforces.** Same split as System A: research choices come
   from the model; schemas, budgets, dedupe, and gates are deterministic code.
3. **Human gates are structural.** Brief confirmation and draft approval are
   Workflow wait states, not UI suggestions — the run cannot advance past them.
4. **Smallest sufficient infrastructure.** Each component below carries a
   one-line justification; anything without one is excluded.
5. **Phase-scoped model calls.** Human gates break conversations, so each phase
   issues fresh focused requests grounded in D1 state rather than one long
   history. Conversation chaining (`previous_response_id`) is used only inside a
   single tool-loop burst.

## 3. Components and responsibilities

- **Web frontend (TypeScript SPA).** Conversational onboarding pane; business
  profile review + confirmation; research progress view; ranked shortlist with
  evidence panel; draft review with approve/edit/reject; status and follow-ups
  boards. No secrets, no direct model calls. Served from the same Worker project
  via static assets (exact mechanism verified at scaffold).
- **Worker API (TypeScript).** REST endpoints per journey phase (profile, brief,
  runs, prospects, evidence, drafts, decisions, statuses); Meta API client;
  request validation; budget accounting; Workflow triggering and event delivery
  (`sendEvent` for gate answers). Holds `MODEL_API_KEY` as a Worker secret
  (dev: untracked `.dev.vars`).
- **Meta Responses API client.** Builds phase-scoped requests (`muse-spark-1.3`,
  `web_search` + product function tools, structured output at extraction points);
  parses `web_search_call` / `results` / `url_citation`; counts usage. No other
  model dependency in the MVP.
- **Research Workflow (one instance per run).** Durable steps per research phase
  (plan, discover, investigate, assess, rank, draft); per-step retries with
  backoff for model/fetch failures; `waitForEvent` gates for brief confirmation
  and draft approval; instance status as the progress source. Justification: the
  run spans minutes plus indefinite human waits — plain request handlers cannot
  survive that; Workflows provide retries, sleep/wait, and resume without custom
  orchestration.
- **D1 database (one, namespaced for this project).** All System B runtime state
  per `specs/data-model.md`. Justification: relational evidence linkage and state
  machines need transactions and queries; 20 D1 databases already in use on the
  account proves availability. Limits verified before first deploy.
- **Page-fetch helper (inside Worker/Workflow).** Server-side fetch of supplied
  business sites and cited pages with size caps, timeouts, and text extraction.
  Justification: grounding returns snippets only; contact and service details need
  full pages; must respect blocks/failures as explicit states.

## 4. Data flow per journey phase

- Describe/Understand: frontend → Worker validates input → fetch helper retrieves
  site (best effort) → extraction request (structured) → D1 profile with
  provenance → frontend renders.
- Clarify/Confirm: frontend answers → Worker updates profile (provenance: stated)
  → confirm locks brief (versioned) → Workflow instance created, pauses at
  confirm gate already satisfied.
- Research: Workflow steps issue Meta calls; tool results validated and written
  to D1 (evidence → prospects → assessments → routes → drafts); dedupe enforced
  on write; budgets checked per step; clean stop preserves partial D1 state.
- Review/Decide: frontend reads D1 views; decisions call Worker endpoints that
  validate state transitions and `sendEvent` the Workflow past its approval gate;
  activity log appended; follow-ups derived on read.

## 5. Meta integration decisions

- Model `muse-spark-1.3`; `search_context_size` medium default (low for
  high-volume discovery, high for sparse categories); `user_location` set from the
  brief's service area; `include: ["web_search_call.results"]` always;
  `max_tool_calls` bounds built-in search per burst.
- Structured output enforced at: profile extraction, candidate extraction,
  assessment, draft generation. Free text allowed only for clarification questions
  and progress summaries (validated for length, never persisted as facts).
- Reasoning effort: `low` default; `medium` for assessment/draft phases.
- 429/5xx: Workflow step retry with backoff; 400/401: fail run with report
  (config problem). Model skipping search (no `web_search_call`) is a first-class
  outcome: step records `search_not_run` and either rephrases (bounded) or
  degrades gracefully — never treated as evidence.

## 6. Budgets (per research run; visible in UI)

- Searches ≤ 30, page fetches ≤ 40, candidates ≤ 25, shortlist default 5–8.
- Cost ≤ $6, wall-clock active compute ≤ 20 min (human waits excluded).
- Any cap hit stops the run cleanly with reason recorded and partial results
  reviewable and resumable.

## 7. Excluded components (each rejected for a stated reason)

- **Queues:** no cross-service producer/consumer split exists; Workflow + D1 cover
  async needs.
- **KV:** no session-cache or scratch-lookup need; D1 serves all reads.
- **R2:** no binary/artifact storage need; page text fits D1 caps for MVP volumes.
- **Containers:** no full-runtime workload; TypeScript runs natively on Workers.
- **Workers AI:** excluded by direction; Meta provides model intelligence.
- **Agent frameworks:** the loop is ours (specified, budgeted, gated); a framework
  would obscure the judged agent design.

## 8. Topology and environments

- Dev: local Wrangler dev (Worker + D1 local) with `.dev.vars`; model calls mocked
  except explicitly approved live calls. Prod: deployed Worker + D1 + Workflow;
  secrets via `wrangler secret`. Frontend served from the same project in both.
- Pre-deploy verification: D1 limits, Workflow step/timeout behavior on this plan,
  secret presence (presence-only), one live smoke run on a rehearsed brief.

## 9. Open items (owners, not TBDs)

- O-1 (RESOLVED 2026-10-29): Workers Static Assets via `"assets": { "directory": "./public" }`; `/` serves index.html and `/api/*` falls through to the Worker (verified on wrangler dev; rationale: zero extra binding, no separate Pages project). Original item: frontend static-serving mechanism on this account — verify at scaffold (M3).
- O-2: D1/Workflow plan quotas — verify before first deploy (M3).
- O-3: U-1 grounding quality — the approved single-call experiment (post-M0 spike).

## 10. Acceptance of this spec (DoD)

Done when: every component has a stated responsibility and justification;
exclusions have reasons; Meta shapes, budgets, and error policy are fixed; data
flow covers all 7 journey steps; names match `specs/research-loop.md`,
`specs/data-model.md`, and `tools.md` Part B; and you approve it. Evidence:
approval in `progress.md`.

## 11. Version history

- v0.1 (2026-10-28): initial draft for review.
