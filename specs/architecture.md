# specs/architecture.md — Deployed Product Architecture (System B)

- Status: approved through v0.2 (2026-10-29). v0.1 approved 2026-10-28.
- Owner: System B only. Detailed loop in `specs/research-loop.md`, persistence in
  `specs/data-model.md`, requirements in `specs/product.md`.

## 1. Overview

A web application: a TypeScript single-page frontend (onboarding + research
workspace + campaign monitor + contact timelines) backed by one Cloudflare Worker
API that orchestrates evidence-backed prospect research and approval-gated email
delivery. Meta Responses API provides reasoning and grounded web search; the
Worker owns validation, budgets, and approval gates; D1 holds all runtime state;
one Workflow per research run provides durable multi-step execution with
human-gate pauses; one Queue+cron pipeline provides durable scheduled delivery.
All model keys and messaging credentials server-side.

## 2. Principles

1. **Server owns truth.** D1 state, not model memory, is the source of record;
   every phase reads and writes durable state.
2. **Model decides, code enforces.** Same split as System A: research choices come
   from the model; schemas, budgets, dedupe, gates, scheduling, and sending are
   deterministic code. Delivery has no model tools by design.
3. **Human gates are structural.** Brief confirmation, draft approval, and campaign
   approval are enforced state transitions (Workflow waits / locked statuses),
   not UI suggestions — the run cannot advance past them.
4. **Smallest sufficient infrastructure.** Each component below carries a
   one-line justification; anything without one is excluded.
5. **Phase-scoped model calls.** Human gates break conversations, so each phase
   issues fresh focused requests grounded in D1 state rather than one long
   history. Conversation chaining (`previous_response_id`) is used only inside a
   single tool-loop burst.
6. **Credentials never flow to the model or client.** Sealed at rest (AES-GCM),
   decrypted only inside the send path, never logged, returned, or prompted.

## 3. Components and responsibilities

- **Web frontend (TypeScript SPA).** Conversational onboarding pane; business
  profile review + confirmation; research progress view; ranked shortlist with
  evidence panel + per-prospect timeline + log-contact form; draft review with
  approve/edit/reject; status and follow-ups boards; campaign monitor (statuses,
  per-recipient states, cancel). No secrets, no direct model calls. Served from
  the same Worker project via static assets.
- **Worker API (TypeScript).** REST endpoints per journey phase (profile, brief,
  runs, prospects, evidence, drafts, decisions, statuses, connections, campaigns,
  suppressions, contacts, timeline, assist links); Meta API client; request
  validation; budget accounting; Workflow triggering and event delivery
  (`get(id).sendEvent` for gate answers). Holds `MODEL_API_KEY`, `CRED_KEY`,
  and `GOOGLE_CLIENT_*` as Worker secrets (dev: untracked `.dev.vars`).
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
  machines need transactions and queries.
- **Page-fetch helper (inside Worker/Workflow).** Server-side fetch of supplied
  business sites and cited pages with size caps, timeouts, and text extraction.
  Justification: grounding returns snippets only; contact and service details need
  full pages; must respect blocks/failures as explicit states.
- **Delivery interface + adapters (`DeliveryProvider`).** One server-side contract
  (verify/send/status mapping, error categories, retryability). Adapters: mock
  (tests/demo), resend (HTTPS API), gmail (HTTPS Gmail API + OAuth connect flow).
  Justification: campaign logic must outlive any vendor; adapters are swappable.
- **Queue pipeline (delivery-jobs + delivery-dlq).** Cron tick and the manual
  process route claim due recipients and enqueue one job each; the queue consumer
  sends one attempt per message. Backpressure: batch 10 + max 2 concurrent
  consumers; crashes retry ×5 then DLQ; transient provider errors requeue with
  app backoff and ACK. Justification: scheduled sends must survive browser
  closes, overlap safely, and isolate poison messages — in-request sending does
  none of that.
- **Credential store (sealed D1 + `CRED_KEY`).** AES-GCM via WebCrypto; key only
  in the Worker secret. Justification: OAuth refresh tokens and API keys must
  persist across ticks without ever appearing outside the send path.

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
- Connect: owner submits provider secret (sealed immediately) or completes Gmail
  OAuth (single `callbackUrl` builder, one route); verify exercises the provider;
  connection flips to connected. Secrets never returned.
- Campaign: create (recipients validated + deduped) → edit while draft →
  approve (sender must be connected, snapshots frozen, suppression pre-pass) →
  schedule → cron/consumer sends in bounded batches → per-recipient statuses,
  attempts, pause/cancel; completion recorded with stats.
- Track: campaign sends auto-log contact events; owner hand-logs any-channel
  touches; timeline merges contacts + activity newest-first.

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
- Delivery: consumer batch 10/tick, cron every 5 min, 500 recipients/campaign cap,
  3 attempts/recipient. Any cap hit stops cleanly with reason recorded.

## 7. Delivery design decisions (locked)

- **SMTP verdict:** port 25 blocked in Workers per docs; 465/587 reachable in
  principle but need a hand-rolled SMTP client — rejected for the hackathon.
  Container SMTP relay is designed (full Linux egress, user creds passed
  per-request, nothing secret at rest) but unbuilt; HTTPS adapters carry the demo.
- **Gmail verify:** `users/me/profile` is outside `gmail.send` (live 403) — a
  successful token refresh is the verification; first real send is the scope test.
- **OAuth shape:** one callback route, one `callbackUrl` origin-derived builder
  (prod + localhost URIs), HMAC state, offline+consent for refresh tokens.
- **Event delivery to Workflows:** instance `get(id).sendEvent({type, payload})`
  (docs-verified); unique wait names per gate wake; 24h default wait timeout.
- **Claiming:** guarded UPDATE + unique claim-stamp read-back; idempotency keys
  per recipient; overlapping producers/consumers tested to never double-send.
- **Single-tenant MVP:** no auth layer yet — documented, not faked with
  placeholder tenant ids.

## 8. Excluded components (each rejected for a stated reason)

- **KV:** no session-cache or scratch-lookup need; D1 serves all reads.
- **R2:** no binary/artifact storage need; page text fits D1 caps for MVP volumes.
- **Containers:** no full-runtime workload *in the MVP path*; reserved for the
  SMTP relay design (§7) — explicitly next, not rejected.
- **Workers AI:** excluded by direction; Meta provides model intelligence.
- **Agent frameworks:** the loop is ours (specified, budgeted, gated); a framework
  would obscure the judged agent design.
- (Queues graduated from this list in v0.2: the delivery pipeline justified them.)

## 9. Topology and environments

- Dev: local Wrangler dev (Worker + D1 local) with `.dev.vars`; model calls mocked
  except explicitly approved live calls; queues/cron exercised remotely.
  Prod: deployed Worker + D1 + Workflow + Queues + cron; secrets via
  `wrangler secret`. Frontend served from the same project in both.
- Live: `https://prospect-research.sam-5b1.workers.dev` (D1 `prospect_research`,
  queues `delivery-jobs`/`delivery-dlq`, cron `*/5 * * * *`).

## 10. Open items (owners, not TBDs)

- O-1 (RESOLVED 2026-10-29): Workers Static Assets via `"assets": { "directory": "./public" }`; `/` serves index.html and `/api/*` falls through to the Worker. Original item: frontend static-serving mechanism — verify at scaffold (M3).
- O-2 (RESOLVED 2026-10-29): Enterprise quotas verified; Worker + D1 + Workflow + Queues deployed and live.
- O-3 (RESOLVED 2026-10-29): U-1 grounding usable via `results[]` (zero citations retained); live Ikeja/Abuja runs rank real buyers.
- O-4 (RESOLVED 2026-10-29): container SMTP relay live. Binding-only
  `SmtpRelayContainer` DO (standard-1, max 2, sleepAfter 30m) fronts a Node +
  nodemailer relay (`/verify`, `/send`, `/health`); per-request creds, no
  secrets at rest. Worker injects `smtpProvider(containerRelay(...))` into the
  queue consumer and verify route; `GET /api/relay-health` returns
  `{"relay":"reachable"}` in production. Wrangler 4.155 required (v3 schema
  lacks DO-container `containers[]`). Still needs: real SMTP send against a
  user-provided test mailbox.
- Speed design (2026-10-29): one shared relay (no per-user spin-up); queue
  batches group same-connection mail into one `/send-batch` call over a
  single SMTP connection (provider `sendMany`, per-item outcomes, failures
  retry individually); cron pings `/health` before enqueueing only while
  SMTP work is pending (no 24/7 idle burn); `sleepAfter 30m`. OPS GOTCHA:
  Docker Desktop buildkit cache served a stale `server.js` layer across
  wrangler builds (proven by image/disk hash mismatch); fix was
  `docker builder prune -f` + rebuild. Relay image changes must be verified
  live via `/api/relay-health` uptime fields, never assumed from a green
  deploy.
- O-5: Google OAuth verification for public Gmail users (post-hackathon only).

## 11. Acceptance of this spec (DoD)

Done when: every component has a stated responsibility and justification;
exclusions have reasons; Meta shapes, budgets, and error policy are fixed; data
flow covers all 10 journey steps; names match `specs/research-loop.md`,
`specs/data-model.md`, and `tools.md`; and you approve it. Evidence:
approval in `progress.md`.

## 12. Version history

- v0.1 (2026-10-28): initial draft for review.
- v0.2 (2026-10-29): delivery architecture (interface, adapters, queue topology,
  credential store), journey phases 8–10, SMTP verdict, OAuth shape, queue + UI
  components, O-1–O-3 resolved. Rationale: approved hybrid delivery built live.
- v0.3 (2026-10-29): container SMTP relay live (binding-only, standard-1,
  /api/relay-health); O-4 resolved. Rationale: universal SMTP without the
  Workers port-25 block.
- v0.4 (2026-10-29): bulk SMTP transport (/send-batch, sendMany grouping,
  keep-warm, uptime reporting) + container build-cache gotcha. Rationale:
  amortize cold start + SMTP handshake over whole batches.
- v0.5 (2026-10-29): live SMTP E2E (Gmail app password, 3/3 sent via one
  batch), enqueue injected-provider gate fix, guided Senders UI.
  Rationale: users connect senders themselves with layman-safe help.
