# progress.md — Project Status

## Current phase

M0 (specifications). All 11 M0 documents drafted v0.1 on 2026-10-28 and
approved ("go ahead"). M0/M1 done 2026-10-28. M2 accepted by user ("proceed") without line-by-line
review — diffs remain in the working copy for later audit. M3 Objective 1
(product scaffold, files only) executed 2026-10-28: 17 turns, $0.48, zero
mid-run gates, completion claimed with evidence. Independent verification passed
on all 6 criteria (see report). Run approved by you and resumed to `completed` (17 turns, $0.48, no extra
cost on resume). M3 Objective 1 (scaffold) done. Minor follow-up noted:
completion_report omits acceptance verdicts on the resume path (verdicts live in
gate.json) — bundle with the budget-enforcement fix.
M3 Objective 2 (budget block + verdicts) executed 2026-10-28: 20 turns, $0.58,
completion gate raised, operator verification passed, approved by you and
resumed to `completed` (20 turns, $0.58, zero resume cost). M3 Objective 2 done.
Note: this run's own report lacks verdicts (its gate was raised by pre-fix code;
the fix covers new gates — proven by the roundtrip test).
M3 Objective 3 launched 2026-10-28 (meta.ts parser suite): parsed budget block
applied live (25/1800/$4/300k in run record — Obj2 feature working). Run
61162d405543 paused at turn 11 ($0.19) on a TOOL gate, not completion: model
called dev.run_shell for `npm test` (cwd product) because dev.run_tests has no
cwd parameter — controller gap queued. Awaiting YOUR approve/deny.

2026-10-29 (Obj6b closure, operator session): research suite written by run
f5d635417cb0 (25/25 turns, $0.46, budget_exhausted) landed with 3 red tests;
operator diagnosed and fixed directly. Root cause: test mock mapped INSERT
columns positionally to bound params, ignoring SQL VALUES literals
(saveCandidate's 'candidate'/NULL), so mock prospect rows carried
status=<timestamp>; plus the fetch-cap test moved targets off "candidate",
emptying investigate's target set. Fix (tests only, assertions untouched):
VALUES-literal modeling in the mock + removed counterproductive status move.
Typecheck already clean (TS2379 fixed by run's final turns). Verified
2026-10-29 01:44 UTC: product npm test 34/34 (research 10/10, routes 13/13,
meta 11/11), tsc clean, controller harness 50/50. Spend ~$5.10/$25 cap.
Next: UI wiring (RealApi live) or Workflow loop hardening per Obj6b queue.

2026-10-29 (operator session, "live local e2e slice" — UI wiring + live research):
Worked directly (not via loop.py: interactive wrangler-dev verification fits
operator better; $0 controller spend). Delivered: RealApi adapters + app.js
runId/draft threading + assets serving (O-1 resolved, verified); new routes
GET /api/prospects/:id, PATCH /api/drafts/:id, decision inline-edit with
edit-flag preservation, POST /api/runs/:id/start (dev-only, 501 in
production); MetaClient adapter (grounded search + structured bursts, URL
validation, name gate, category validation, directory blocklist, tool
stripping); orchestrator.ts extraction + runPhases + wired Workflow entrypoint
(class_name fixed) + gate-deadlock fixes (brief gate conditional, drafts
re-check loop, run-scoped close); assess evidence-linking (substring + fuzzy)
instead of arbitrary slice(0,2). Verified: 136/136 vitest, tsc clean, smoke
PASS (mock + live adapters), 11 live local runs to awaiting_approval with
real drafts (Ikeja buyers: Paystack, Cowrywise, Mikano, Lagoon, Zenith, Air
Peace), full approval journey live (detail/edit/approve/reject/statuses).
Key finds: (1) POST /api/runs raced the Workflow against /start (double
discovery + double spend) — fixed by ENVIRONMENT ownership split + tests;
(2) offered function tools steal structured bursts (probe-proven) — adapter
strips tools, single-shot JSON; (3) wrangler 3.x runs Workflow instances
locally despite "remote" banner, but waitForEvent is unimplemented locally.
Spend this session ~$4-5 Meta (11 runs + 2 probes); total ~$9-10/$25.
Follow-ups: remote D1 create/migrate + deploy (needs approval); Workflow
prod verification; merge-proposals for same-name dupes; cumulative consumed
persistence; assessment determinism; re-verify ?live=1 visually (user step).
Next: deploy prep (D1 remote + migrations + secrets) or demo polish.

2026-10-29 (operator session, deploy + Baseten + Workflow prod fixes):
Worked directly ($0 controller spend). (1) UI copy: generalized the
Ikeja-locked tagline (index.html:13); verified backend has zero hardcoded
geography (service_area is user-stated; no-hardcoded-geography comment at
index.ts planning site). (2) DEPLOYED: remote D1 prospect_research created
(f403c035…, WEUR) + schema applied (16 queries, 8 tables); wrangler.jsonc now
carries database_id + ENVIRONMENT=production (.dev.vars keeps local dev on
ENVIRONMENT=dev); MODEL_API_KEY set via `wrangler secret put` (piped, never
displayed); live at https://prospect-research.sam-5b1.workers.dev (GET / 200,
new tagline confirmed). Caught a prod-only client bug pre-verify: RealApi
chained POST /start which 501s in production — now treats 501 use_workflow as
"already running" (smoke still PASS). (3) First remote run (GreenLeaf cleaning,
Abuja — proving location generality) executed all phases remotely but parked
at status `created`: root causes found — (a) Workflow run() never wrote
status markers (only runPhases did), (b) decision/gate event used a
nonexistent binding-level sendEvent (real API is get(id).sendEvent, verified
in Cloudflare docs), (c) gate re-waits reused one step name (would return the
first event forever), (d) "waits indefinitely" comment false (24h default).
Fixed TDD (4 new tests RED→GREEN): step-wrapped replay-safe markers incl.
idempotent awaiting_approval park, per-wait unique names with constant event
type, sendWorkflowEvent helper via get(instanceId). 140/140 vitest, tsc
clean. Deployed fix; decided the stuck run's 4 drafts remotely (2 approved /
2 rejected) → instance woke and run went created → complete in ~5s. Full
production loop verified: research → rank → drafts → human decisions → gate
release → close. (4) Baseten verified (BASETEN_API_KEY user-set): auth OK,
text output OK (max_tokens must exceed reasoning budget — 50 tokens returned
null content), tool calling OK (get_weather, valid JSON args). Baseten kept
out of the research path (no search grounding on chat-completions); candidate
for open-weights bonus use later. Spend this session ~$0.50 Meta (1 remote
run); total ~$10/$25.
Known follow-ups: locale leakage (Abuja brief shortlisted Lagos hubs —
queries/assessment need locale adherence); postResume "resume" event has no
waiter (best-effort signal only); waitForEvent 24h default vs multi-day human
gates; same-name merge proposals; cumulative consumed persistence.
Next: user decision on email delivery scope (reviewer prompt received —
assess vs deadline) or demo polish.

2026-10-29 (operator session, hybrid email delivery backend):
Reviewer scope accepted with one correction (Stage One is satisfied: ALL
research/ranking/drafting runs on Meta muse-spark-1.3 via api.meta.ai;
Baseten only probed). Spike verdict: SMTP port 25 blocked in Workers per
docs; 465/587 reachable in principle but need a hand-rolled SMTP client —
rejected for the hackathon (relay-outside-Workers later). HTTPS adapters win:
mock + resend + gmail behind DeliveryProvider; graph/smtp throw honest
not-implemented. Built + deployed: 5 D1 tables (sender_connection AES-GCM
sealed via CRED_KEY secret, campaign, campaign_recipient with idempotency
keys + claim stamps, delivery_attempt, suppression); WebCrypto crypto module;
resend + gmail adapters with error-category mapping; campaign routes
(create/edit/approve/schedule/pause/resume/cancel/process/detail);
mailto + wa.me assist builders; suppression + HMAC unsubscribe links/footer;
cron `*/5 * * * *` + scheduled() sharing processDueCampaigns (atomic
claiming, stale recovery, backoff, auth-stop, completion stats); Gmail OAuth
routes (need user's Google app). Tests 163/163 (23 new), tsc clean. Notable
catch: claim stamp collision on same-ms ticks caused a double-send in the
overlap test — fixed with unique claim ids. Verified LIVE on production:
mock connection → verify → campaign → approve → process → 2/2 accepted,
complete with stats; assist links, suppression, bad-token 400 all green.
Spend ~$0 this session (no model calls). Single-tenant MVP (no auth layer
yet) — noted, not theatred. Follow-ups: campaign UI; real-provider send
(blocked on user creds); locale leakage; Graph adapter; bounce webhooks.
Next: user provides ONE of (Resend key / Gmail OAuth app / own address for
real-send test) + campaign UI build.

2026-10-29 (live Resend test, user-authorized): user set
RESEND_TECHASSEMBLY_API_KEY (presence-only checks; value never displayed).
Controlled send sam@techassembly.io → samdoxiso@gmail.com through the
product API: connection created (secret sealed, not echoed) → verify
connected → campaign approved → process 1/1 sent, recipient `accepted`,
Resend message id 01a18624-04f2-75ef-b53f-a20eca64bfcc, 1 attempt, no error.
TechAssembly domain accepted by Resend (no domain-verification blocker).
Inbox confirmation is a user step (check Gmail incl. spam). Connection left
connected for further testing; disconnect via API when done.
Parked mid-flight: queue pipeline refactor (code + tests rewritten, not yet
re-run), contact tracking (backend done, tests pending), UI (campaigns
monitor + timeline + onboarding polish, smoke pending), container SMTP relay
(design only). Next: confirm inbox, then resume parked work.

2026-10-29 (Gmail live + queue pipeline + tracking + UI shipped):
User confirmed Resend inbox receipt (DKIM-signed, TLS). Gmail OAuth consent
completed (unverified-app screen expected in dev; user clicked through).
Verify first failed 403 insufficient-scopes: users/me/profile is outside
gmail.send — fixed verify to refresh-token-only + test (live lesson).
Deployed: queue pipeline (delivery-jobs + DLQ, batch 10, max_concurrency 2,
retries x5; producer/consumer split, 167/167 tests, smoke PASS), contact
tracking (contact_event + routes + per-prospect timeline + auto-log on
campaign sends), UI (onboarding progressive disclosure + preset chips,
per-prospect history + log-contact form, campaign monitor on status board).
Gmail live test via NEW queue path: verify connected → 1/1 `sent`, Gmail
id 1a1863b1684c37b8, campaign complete — proves consumer remotely.
Inbox check (TechAssembly) is a user step. Spend $0 (no model calls).
Next: container SMTP relay build (Docker present, needs @cloudflare/containers
+ image + config) or campaign creation UI + demo polish.

2026-10-29 (GitHub + specs v0.2 + campaign creation UI):
Pushed to https://github.com/arinafoodshq/prospect-research (public, main;
hygiene verified: .dev.vars/.runs/node_modules ignored, secret scan clean).
Specs rewritten to v0.2 (product/architecture/data-model/tools): delivery
scope, FR-13–FR-20, journey steps 8–10, 6 delivery tables + transitions,
queue topology, SMTP verdict, OAuth shape, deterministic-ops registry —
restart-from-docs requirement met. Campaign creation UI live: 7th view with
sender picker, approved-prospect recipients (email prefilled from routes,
subject/body from drafts, all editable), schedule picker, one-click
create+approve; entry from status-board monitor. 167/167 vitest, smoke PASS.
Spend $0 (no model calls).
Next: container SMTP relay build, then demo video script + polish.

## Milestones

- **M0 — specs complete and approved.** Done 2026-10-28 ("go ahead" approval).
- **M1 — `loop.py` v0 implemented.** Done 2026-10-28. Deliverables: `loop.py`,
  `controller/` (registry, validate, execute, state, budgets, gates, report,
  client), 32 tests + registry fixture, `.gitignore`.
- **M2 — v0 passes controller harness on mocked inference.** Done 2026-10-28:
  harness 32/32 green (observed) + user acceptance via "proceed" (review waived,
  audit later).
- **M3 — controller executes approved product objectives.** In progress.
  Objective 1: product scaffold, files only, budget 25 turns / 30 min / $4 /
  300k tokens. No installs, deploys, or live product calls.
- **M2 — v0 passes controller harness on mocked inference.** Pending M1.
- **M3 — controller executes approved product objectives.** Forbidden until M2 passes.

## Decisions log

- 2026-10-28: Two separate systems (A: local dev controller, B: deployed product);
  runtimes, tools, and state documented separately. (Approved direction.)
- 2026-10-28: Controller is local Python (`loop.py`); never deployed to Cloudflare.
  (Approved direction.)
- 2026-10-28: Product uses Meta model + search grounding for reasoning/research,
  Cloudflare for infrastructure/durable state. No Cloudflare Workers AI in MVP.
  (Approved direction.)
- 2026-10-28: Model choice `muse-spark-1.3` via Responses API; grounding, tool
  calling, structured output, pricing, and limits confirmed against official Meta
  docs (dev.meta.ai pages inspected 2026-10-27/28). (Verified from docs.)
- 2026-10-28: Social discovery via official FB/IG APIs is narrow and review-gated;
  not an MVP discovery pillar. MVP discovers via web grounding + public pages;
  contact claims stay at "public listing with source". (Verified from
  developers.facebook.com docs.)
- 2026-10-28: Cloudflare candidates Workers/D1/Workflows; Queues/KV/R2/Containers
  excluded until a justified requirement exists. Account has all of Workers, D1,
  KV, R2, Queues, Workflows in active use (26/20/10/20/22/1 resources). MCP identity
  sam@techassembly.io, one account. (Verified via read-only API 2026-10-28.)
- 2026-10-28: Enterprise plan with $89k+ remaining credits. (User-stated, unverified.)
- 2026-10-28: Documentation structure approved: `AGENTS.md`, `progress.md`,
  `tools.md`, `system_instructions.md`, `objective.md`, plus `specs/product.md`,
  `specs/architecture.md`, `specs/agent-loop.md` (System A loop),
  `specs/research-loop.md` (System B loop), `specs/data-model.md`,
  `specs/evaluation.md`. (Approved 2026-10-28.)
- 2026-10-28: Bootstrap rule (v0 written directly from spec, reviewed by human)
  and anti-stall rule (M0 done when decisions settled + consistent, refinements via
  change control). (Approved 2026-10-28.)
- 2026-10-28: Controller v0 calls Meta Responses API directly
  (`muse-spark-1.3`, `previous_response_id`); coding-tool integration deferred to
  a post-v0 spike. Run records in untracked `.runs/`. (Spec decision, needs M0
  approval.)
- 2026-10-28: Product uses phase-scoped Meta calls with D1 as source of truth;
  conversation chaining only inside single tool bursts. Per-run budgets fixed
  (30 searches / 40 fetches / $6). (Spec decision, needs M0 approval.)
- 2026-10-28: Spike S-0 (single grounding call, ≤$0.10) scheduled post-M0 to
  answer U-1; key presence + explicit go still required. (Proposed in
  `specs/evaluation.md`.)
- 2026-10-28: Auth-header root cause: the write pipeline rewrote
  `f"Bearer {key}"` to a literal in `controller/client.py`; fixed with
  concatenation + read-back rule in `AGENTS.md`. Three $0 401 runs resulted.
- 2026-10-28: Stored-response lag (400 not-found at turn 5 of first live run,
  $0.04 spent): added 2s/5s retry + transcript-rebuild fallback
  (`specs/agent-loop.md` change-controlled); harness now 35/35.
- 2026-10-28: U-1 answered (S-0 evidence): Ikeja grounding returns rich results
  (31, relevant); inline `url_citation`s NOT observed — product must ground via
  retained `results[]` + `fetch_page` extraction, treating model citations as
  optional. Grounded-call cost calibration ≈ $0.04 at low context (~10.7k/5.1k
  tokens), comfortably inside the $6/run budget.

## Completed work and verification evidence

- Empty-repo inspection: no source, config, or secret files present. (Observed.)
- Meta capability research: grounding (`web_search_call`, `url_citation`,
  opt-in `results`), tool-calling constraints (`tool_choice: auto` only, name
  rules, strict semantics), structured output, pricing, rate limits. (Official
  docs inspected; links recorded in session notes.)
- Cloudflare inventory: product availability confirmed as above. (Read-only API.)
- `AGENTS.md` + `progress.md` created per approved structure.
- `specs/product.md` v0.1 drafted: overview, principles, journey, 12 FRs with
  acceptance criteria, demo scenario, unknowns U-1..U-3. Awaiting review.
- `specs/agent-loop.md` v0.1: System A 8-step lifecycle, direct Meta API,
  previous_response_id history, permission tiers, `.runs/` records, budgets,
  gates, module interfaces. `system_instructions.md` + `objective.md` (format +
  unapproved M1 draft) written alongside.
- `specs/architecture.md` v0.1: Worker + D1 + Workflow + TS SPA, Meta shapes,
  phase-scoped calls, per-run budgets, exclusion reasons.
- `specs/data-model.md` v0.1: 8 entities, transitions, dedupe/provenance rules
  (no `sent` status, no strong contact verification — unrepresentable by design).
- `specs/research-loop.md` v0.1: 7 Workflow phases, burst cycle, dedupe keys,
  error/empty handling, resume, `waitForEvent` gates.
- `tools.md` v0.1: Part A (7 dev tools) + Part B (7 rs tools), full contracts.
- `specs/evaluation.md` v0.1: fixture design, controller harness S-A1..S-A5,
  product goldens S-B1..S-B5, quality bars, live-work policy, scheduled spike S-0.
- M1 built: `loop.py` + 8 controller modules + 32 tests. First run 26/32;
  diagnosed 4 code bugs (completion-gate path, finish exit code, `.env` path
  normalization, edit-vs-write read rule) + 2 test bugs (budget clock, snapshot
  order); fixed; re-run 32/32 OK, exit 0 (`python -m unittest discover -t .
  -s controller/tests`, 0.5s). No installs, no network, no secrets touched.
- S-0 executed 2026-10-28 (one call, est. $0.0426, under $0.10 cap): status
  completed, 3/3 web_search_call completed, 31 raw results retained, 0 inline
  url_citations, 10766/5085 tokens. Fixture saved at
  `product/tests/fixtures/s0_ikeja_venues.json`. No key material in outputs.
- M3-Obj1 run 2642778677c1: 17 turns, 325724/16186 tokens, $0.48, 0 rejects,
  rebuilt_count 1 (lag recovery worked), completion gate raised. Verified: 10/10
  files substantive, 8/8 tables, meta.ts parser correct, wrangler bindings
  correct, root clean, zero mid-run gates. Finding: objective token budget
  (300k) exceeded (~342k) because loop.py enforces only its defaults — objective
  Budget section is advisory text, not machine-read. Fix queued as follow-up
  controller objective (machine-readable budget block + parsing + spec note).
- M3-Obj2 run 410ee6ed2e72: 20 turns, 419843/12637 tokens, $0.58, 0 rejects,
  rebuilt_count 1. Verified: parse_budget_block + enforcement wired in main(),
  verdicts in both finish paths, spec §9 note present, test_objective_budgets.py
  added, harness 43/43 green, tree clean. Note: `muse.search` returned empty
  twice on content proven present by direct read (tool quirk — verify by read).

## Outstanding decisions (to be settled in specs)

- Controller inference API and Muse Code/OpenCode integration mechanism (verify
  real interfaces; assume nothing).
- Controller execution-layer permission model and run-record format/location.
- Product component justification (Workers/D1/Workflows roles, limits, suitability).
- Meta history mode, structured-output points, numeric budgets.
- Research tool set, state machines, dedupe keys, frontend approach.
- Controller + product harness design, fixtures, golden scenarios, metrics.

## Risks and unknowns

- Web-grounding coverage/quality for Nigerian-local prospecting queries (unresolved;
  answered by the approved single-call experiment at the right milestone).
- `MODEL_API_KEY` set by user in HKCU registry 2026-10-28; agent shells need a
  per-call refresh from User env (stale inherited env quirk, handled without
  exposing the value). Call authenticated successfully; $150 balance still
  unconfirmed (no balance endpoint probed).
- Objective-declared budgets are not machine-enforced by loop.py v0 (defaults
  only). Observed overrun was small and harmless; fix before objectives with
  tight cost bounds.
- Cloudflare plan quotas unverified (availability verified; limits unknown).
- Local shell instability: repeated `wrangler whoami`/env-check calls died in
  flight across three turns; `wrangler whoami` output still pending. Wrangler
  4.91.0, node v22.14.0, npm 10.9.2 observed installed.

## Blockers

- None blocking M0 documentation work. Verification retries await approval and a
  stable shell.

## Next action

M3 Objective 3: prior runs hit empty-input resume 400 (fixed, 49/49) and the
run_tests cwd gap (both tool gates user-approved). Run 56964fef5f54 reached the
completion gate (17 turns, $0.31): suite 11/11 green (confirmed by operator),
typecheck fails ONLY on out-of-scope scaffold files (db/index/workflow — agent
honestly verdict-failed, refused to touch them). Queued: scaffold typecheck
repair objective + run_tests cwd. Obj3 approved by you with 2 noted exceptions; run 56964fef5f54 resumed to
`completed` (17 turns, $0.31). M3 Objective 3 done.
M3 Objective 4 launched (UI shell + mock adapter). Run 06ac87d67a81 paused at
turn 12 ($0.18) on tool gate: `node --check product/public/app.js` via
run_shell — model bypassed allowlisted run_tests again (allowlist contents are
invisible to it; queue: advertise allowlists in instructions + run_tests cwd).
Obj4 run 06ac87d67a81 reached completion gate (17 turns, $0.24) under
standing verification pre-approval (user YES). Operator audit: 4/4 files,
5 views, syntax valid, honest demo banner, good microcopy, XSS-safe, keyboard
+ aria basics. Issues queued for Obj4b polish: (1) status board has a "sent"
column contradicting the drafts-only spec — must become follow-ups-due without
duplicating approved; (2) profile hint promises editing guesses but fields are
static; (3) dead-end "Nothing here" microcopy; (4) no back-nav drafts→shortlist;
(5) add tests/smoke.mjs load smoke. Model again misreported "zero gates" (2
raised) — queue gate-history in state summary. Obj4 approved by you with noted exceptions; run 06ac87d67a81 resumed to
`completed` (17 turns, $0.24). M3 Objective 4 done.
M3 Objective 4b done 2026-10-28 (operator-verified completion): run 350e663deb18
did all fixes then stopped on token budget (18 turns, $0.45); operator confirmed
green directly — smoke 22/22, node --check ×2 exit 0, vitest 11/11, zero "sent"
refs, back-nav present, package smoke script added. No fresh run needed.
M3 Objective 5 run fb720128b5dc stopped on token budget (18 turns, $0.64,
490k input tokens — 31 re-reads + full-history resend each turn; only 4 edits,
no test file). Finding: server-managed history costs ~25k input tokens/turn on
implementation work — queue transcript compaction; meanwhile objectives carry
read discipline + token budgets sized to it ($ cap stays binding). Silver
lining: the 4 edits fixed all 3 type errors (operator-confirmed tsc clean).
M3 Objective 5b run 9283561afbcd stopped on turn budget (25/25, $0.75) with
routes + 13 tests written and typecheck clean. Operator finished: fixed the last
red test (mock UPDATE miscounted COALESCE placeholders — mock bug, handler SQL
was correct) and verified 24/24 green + tsc clean directly. M3 Objective 5b
done (operator-verified completion). Workers review flags queued (non-blocking):
Math.random IDs → crypto.randomUUID; hand-written Env → wrangler types at
deploy; one as-unknown-as cast → minimal-interface param. Still queued from
before: run_tests cwd, allowlist visibility, gate-history in summary,
transcript compaction. Obj6 run 7088580469d6 stopped on turns (25/25, $0.94): research modules +
workflow rewrite + randomUUID fix landed, but 4 TS2379 errors remain, no
research suite, and read discipline was ignored (13 read turns). Fix: countable
read caps in objectives (≤10 reads/≤4 lists). Obj6b defined (errors + suite +
caps) and launching. Next after: UI wiring, then human-gated D1/deploy.
Spend ≈$4.64 of $25.

Design direction (user, 2026-10-28): UI must follow Nielsen's 10 heuristics,
psychology/ease-of-use, concise plain-English copy per StoryBrand. Skill survey:
no Nielsen/StoryBrand skill installed; loaded product-copy (UX writing) as the
working standard; pixijs-accessibility is canvas-only (N/A to DOM UI); web-perf
applies to load quality. Design QA bar: status visibility, real-world language,
user control (back/edit/undo), term consistency, inline validation, evidence
beside claims, one primary action per view, plain-language errors with next
steps, teaching empty states; StoryBrand arc (owner as hero, research burden as
villain, agent as guide, 3-step plan, approve CTA, stakes, success); copy per
product-copy (concrete verbs, consistent glossary, specific CTAs). Applied at
Obj4 verification; gaps become Obj4b design-polish objective.

## 2026-10-29 — Container SMTP relay live (O-4 resolved)

Worker-to-container delivery path deployed and verified: image
prospect-research-smtprelaycontainer (standard-1, max 2, sleepAfter 30m),
GET /api/relay-health returns relay reachable on production. Wiring:
SmtpRelayContainer DO + smtpProvider(relay) adapter (per-request creds,
nothing secret at rest), injected into queue consumer + verify route; smtp
connectable via POST /api/connections with {host,port,username,password}.
Tests 177/177 + tsc clean; vitest stubs cloudflare:workers and
@cloudflare/containers, smtp-relay/ excluded (node --test 3/3). Wrangler
3.114 to 4.155 (containers schema) + workers-types v5. Not yet proven:
real SMTP send (needs user test mailbox + recipient). Next: SMTP test
mailbox credentials, then UI smtp connect form.

## 2026-10-29 - SMTP batch transport + keep-warm + build-cache fix

Speed: relay /send-batch (1-50 msgs, one SMTP connection, sequential,
per-item results); Worker DeliveryProvider.sendMany + consumer groups
same-connection jobs into one relay call (processor split into
prepare/apply; other providers unchanged); cron warmSmtpRelay pings
/health before enqueue only while connected SMTP senders have open
recipients; shared singleton container (no per-user spin-up), sleepAfter
30m; /api/relay-health passes startedAt/uptimeSec. Tests: relay 5/5
node --test, worker 185/185 vitest, tsc clean.
Ops: Docker Desktop buildkit served STALE server.js across wrangler
builds (green build+deploy, old code live; proven by image/disk hash
mismatch). Fix: docker builder prune -f + rebuild (manifest 66fdc0...,
worker v41fa6a95). Direct registry push rejected (cross-repo blob
mount). Rule: verify relay changes via live uptime fields. New doc:
product/smtp-relay/README.md. Disk: removed 6 local test/version tags.
Live verified: uptimeSec 0 then 101 with same startedAt 07:00:19Z -
new image serving and instance stays warm across 100s gap.
Needs: Gmail app password (smtp.gmail.com:587, user + 16-char app
password) + test recipient for first real SMTP send; then UI smtp
connect form.

## 2026-10-29 - First real SMTP sends + guided Senders UI

E2E proven with Gmail app password (smtp.gmail.com:587): connection
created via API, relay verify -> connected, campaign of 3 approved,
process -> queue -> ONE sendMany batch -> all 3 sent first attempt with
Gmail message IDs, campaign complete {sent:3}. Recipients:
maryodidi2@gmail.com, sam@techassembly.io, info@techassembly.io.
Bug found live: enqueueDueJobs availability gate called bare
providerFor(smtp) which throws by design -> campaign failed with
"provider smtp unavailable". Fix: injected[] param; cron + process
route vouch for smtp when relay bound. Tests 187/187, tsc clean.
UI: new Senders view (nav 8) - provider choice (Gmail/Business/Resend),
Gmail app-password guide with verified Google links, business-email
SMTP finder (Zoho/cPanel/M365) + copy-message-for-developer, plain-
language errors, test/disconnect, mobile stacking. API: _req now
surfaces server error detail (HTTP 501 check preserved).
App-password recommendation: YES for all users - Google blocks normal
passwords with 2SV anyway; app passwords are revocable and least-
privilege. UI never asks for a Google password and says so.
Live: worker v699af034, senders section + JS verified on prod.
Test connection conn_a12e... (Gmail) left connected for reuse.
Next: user confirms inbox delivery; demo video script + polish.

Inbox confirmed 2026-10-29 (sam@techassembly.io, TLS, unsubscribe footer present). Unsubscribe link exercised live -> 200 + address suppressed, then suppression removed to keep the test address usable.
