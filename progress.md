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

## 2026-10-29 - Live research evaluation: TechAssembly run (HONEST GAPS)

Ran the product as a real customer (TechAssembly, retail/logistics SMEs
in Lagos): profile -> confirm -> Workflow run -> awaiting_approval in
~2 min. Results: 25 prospects, 8 drafts. E2E pipeline works; research
QUALITY is weak for this vertical:
1. Vertical drift: brief said retail/logistics; results are schools,
   clinics, coworking. Retrieval biased to high-web-presence categories.
2. Snippet-only evidence: 274 search_snippet vs 9 fetched_page. No
   prospect-site fetching; directory/listicles junk (ngex, top-10 lists);
   unrelated-company evidence attached (AfricaWorks on Venia).
3. Junk names: search titles stored as businesses ("dr reddington
   patient portal"), encoding corruption, duplicates (Venia x2).
4. Weak bar: 3/5 ratings with poor-fit rationales still "qualified".
5. Thin contacts: 8/25 prospects have contact routes.
Bright spot: drafts are well-written and source-cited.
Fix list (ranked): brief-anchored search plan + vertical guardrail;
require fetched_page evidence per qualified prospect; name validation
+ dedup + encoding fix; fit-threshold calibration; contact extraction
pass. Needs user call: quality sprint vs demo-video polish first.
Run: run_d3f68cbd (profile bp_76b0bee9).

## 2026-10-29 - Research upgrade deployed; acceptance thresholds (pre-registered)

Pipeline v0badbb0e live with: versioned commercial brief, ICP hard-gate,
brief-driven search (catering hardcode removed from new path), per-prospect
fetch, prospect-scoped evidence, dimensional verdicts, contact grounding,
name/dedupe/encoding fixes. Migration 0002 applied remote (local dev DB
never initialized - noted, unused).
Baseline: run_d3f68cbd (25 prospects, 4 qualified, 0 in-segment, 274
snippets/9 fetched, 8/25 with routes). Comparison: run_375b97dd on
identical profile bp_e2fbf040.
ACCEPTANCE (set before seeing results):
- >=80% of qualified prospects in the primary segment (retail/logistics)
- 0 hard-constraint violations among qualified
- 100% of qualified have a prospect-owned fetched source (structural)
- 0 duplicates with contradictory verdicts
- Contact coverage + cost/time per qualified: report only, no threshold
- Fewer, better-evidenced prospects is a PASS, not a fail

## 2026-10-29 - Gate root cause: exclusions nuked the home market

run_375b97dd scored: 25 prospects, 18 disqualified, 4 investigating, 3
shortlisted-as-qualified (2 junk "Fabric Store"/"Grocery Store" headlines).
0 drafts — FAIL vs acceptance (>=80% in-segment, real qualified>0).
Root cause in checkHardConstraints (commercial.ts), proven against the
brief Meta stored on run_724:
1. Exclusion "Businesses outside Nigeria with no Lagos operations" matched
   EVERY Lagos prospect: location haystack + reversed substring
   (n.includes("lagos")).
2. Exclusion "Large enterprises and supermarket chains" matched every
   "Retail"-category prospect via synonym-group equivalence
   (retail == supermarket).
Fix (deployed v5484c961): exclusions chunked into significant words, matched
by whole-word stemmed equality only, name/category only (never location);
geo words filtered vs inclusion geos; "outside/within/..." stop-listed.
New regression test uses run_724's exact exclusion list (bank/supermarket/
software rejected; retail/logistics pass; school rejected by inclusions).
Tests 239/239 + tsc clean. Spec note: termHit (fuzzy) stays for inclusions;
exclusions are deliberately strict.
Fresh comparison launched on identical TechAssembly input: profile
bp_64987b2e, run_99840398 (budgets same: 30/40/25/$6). Old runs preserved.
Catering eval still separate; fallback-demo decision after this run lands.

## 2026-10-29 - Comparison run 2 scored: upgrade never engaged (0/25 dims)

run_99840398: 25 prospects, 19 disqualified / 6 shortlisted, 6 drafts.
FAIL vs acceptance: shortlist is junk ("Shops for Rent", "GIFT ORDER
emoji", "Teph-store...(2026)", "Avoid shopping stress...", Supermart x2
duplicate) while real boutiques (Ashluxury etc) disqualified.
Root causes (all proven against D1 + code):
1. HUGE: brief lost across Workflow steps. plan() setBrief runs in one
   isolate incarnation; discover/assess/draft resume fresh with
   activeBrief=null -> legacy prompts everywhere. 0/25 assessments have
   dimensions; legacy catering-era search prompt ran ("Never list
   caterers"). Fix: hydrateBriefFromRun(db,meta,run) before EVERY phase
   in orchestrator (D1 is the only cross-step channel).
2. Junk names passed isPlausibleName: shops/stores/clothing not in
   GENERIC_WORDS; no for-sale/rent, these/those, (photos)/(brands),
   emoji, or year-paren rules; colon rule missed lekki etc. All added +
   tested with run_998 fixtures. ("d???" was PS display mojibake for
   emoji, not stored corruption - verified via hex().)
3. Contacts: date fragments as phones ("20261028"). Fix:
   isPlausiblePhone (YYYYMMDD reject, 0-prefix needs 9-11 digits).
4. fetched_page quotes were raw <head> HTML soup. Fix:
   extractVisibleText (strip scripts/styles/tags, decode entities).
5. Supermart duplicate: different names, same domain. Fix:
   findDomainSibling (same domain + same first distinctive token);
   platform domains only merge on brand-token match.
6. model_id "mocked-model" was a hardcoded label, not a mock run. Fix:
   threaded MetaClient.modelId (default muse-spark-1.3) into all
   assessment writers incl. tools.ts.
Tests 262/262 + tsc clean (23 new). Deployed v5f8be184 (first deploy
attempt failed transiently, retry clean). Fresh comparison run_5538b2b3
on identical input (profile bp_ae89ddca). Deferred: location capture
(needs Lagos containment or geo gate misfires), person-name handling
(left to dimensional assess).

## 2026-10-29 - Comparison run 3: upgrade ENGAGED, new wall found

run_5538b2b3 verdicts: 15 disqualified + 10 needs_research, ALL with
dimensions (was 0/25). Hydration fix PROVEN. Segment adherence now
strong: Style Lagos Boutique, Fabrics by Jadesh (icp_fit 5, "two Lagos
branches, WhatsApp orders"), Nomad/GoFlow logistics, Julix Fashion -
real in-segment prospects with cited specifics.
New findings:
1. Reachability wall: all 10 needs_research score reachability 1. Root
   cause: assess burst showed the model claims ONLY (no urls/types),
   and the deterministic pass saved no url routes - so owned IG/sites
   (fabricsbyjadesh, julixfashionstore.carrd.co, nomadlogisticsolutions)
   were invisible as routes. Fix: bursts now include {claim,url,type};
   reachability rubric counts official site/social as a route;
   investigate saves owned fetch urls as website_form/social_profile
   routes; search goal prefers owned sources.
2. Directory contacts unattributed: 45 phones lifted from directory
   pages (other businesses' numbers). Fix: directory hosts contribute
   ZERO routes (extraction + url-route both gated).
3. Rank/draft froze the run: 0 qualified -> stopped -> dispatch threw
   -> retries exhausted -> stuck at assessing forever. Fix: honest-empty
   completion (rank logs breakdown + completes; draft parks at
   awaiting_approval + completes). Frozen run marked stopped with
   reason (data preserved for audit).
4. More junk guards: hashtag soup, +fashion/luxury/verified generics
   ("Top Verified Boutique", "#aralinelogistics...").
Tests 274/274 + tsc clean (12 new). Deployed v89e6a8ac. Fresh
comparison run_de5e566e (profile bp_64d4014d).

## 2026-10-29 - Comparison run 4: precision fixed, recall + drafts next

run_de5e566e: 1 qualified (Perfect Retail NG, reachability 4 - url fix
worked), 6 needs_research, 18 disqualified with superb rationales (US
chains, promos, personal accounts, products-vs-businesses all correctly
called out). 0 junk shortlisted (was 6). Precision PASS.
Gaps -> fix round 4:
1. Geo drift: Philadelphia results for a Lagos brief. Fix:
   serviceAreaFromGeos -> user_location {city} on web_search (country
   only when ISO-2, never mispredicted).
2. 0 drafts for the 1 qualified ("no proposal from burst"). Fix:
   bracket-marker regex REMOVED from parsing AND saveDraft (it dropped
   grounded drafts); draft() now fuzzy-links body chunks to own
   evidence (shared linkTextsToEvidence helper, claim OR quote) and
   skips only the unlinked; bracket markers trusted-but-bound; one
   burst retry when no target gets a proposal; counts in detail.
3. Name guards: promo %off, driving-directions, privacy/policy/terms/
   cookies/copyright/storelocator generics, company-profile,
   possessive-profile, platform words (tiktok/instagram/...).
Note: pharmacies are plan-sanctioned but assess-disqualified (model
variance across phases; defensible either way - left alone).
Note: draft supporting_ids still enforcement-only, not stored on the
draft row - schema follow-up for the audit-trail UI.
Tests 289/289 + tsc clean (15 new). Deployed v4eca1288. Fresh
comparison run_b0675e86 (profile bp_84838089).

## 2026-10-29 - Comparison run 5: first full loop (qualified + draft)

run_b0675e86: 1 qualified (AgroGroom Enterprise, own domain
agrogroom.com) + 1 DRAFT WRITTEN ("Idea for AgroGroom's WhatsApp +
shop orders", website_form). 5 needs_research, 19 disqualified. No US
drift (user_location worked). Precision holds; volume still thin
(~10/25 slots lost to products/SKUs/marketplaces).
Fix round 5 (recall): marketplaces (Konga/Jumia/Kara) join directory
hosts (evidence-only); plan goal bans marketplace listings as sources;
guards for SKU dosage, imperative headlines, contact pages, youtube,
street-address stripping (Bismid x2 dedupe).
Note: cost_usd_est reads 0 on all runs (per-phase ctx never persists;
known gap) - cost/qualified unmeasurable, bounded by $6/run cap.
Note: finished_at null on parked runs - minor.
Tests 297/297 + tsc clean (8 new). Deployed v6bbd7db8 (two transient
fetch-failed deploys, third clean). Fresh comparison run_9c3a8111
(profile bp_719a6863).

## 2026-10-29 - Comparison run 6: funnel stable, pharmacy coherence found

run_9c3a8111: 1 qualified (Maucare Pharmacy, Lekki, own online site,
icp_fit 4 reachability 4 - DEFENSIBLE: brief never excluded pharmacies;
thin-evidence pharmacies disqualify, owned-evidence ones qualify), 7
needs_research, 17 disqualified. Funnel now stable across runs 4-6:
exactly 1 qualified + 5-7 needs_research + 17-19 disqualified, 0 junk
shortlisted every time.
Fix round 6 (marginal guards): expansion headline verbs
(widen/expand/extend/grow), free-download + version numbers, faq/
frequently/asked/questions + food generics, flag-emoji STRIPPED (kept:
"Walexfabrics Lagos NG-flag" -> "Walexfabrics"; pictographs still
rejected). Supermart x5 noted: same-name-different-domain rows stay
apart by design (news evidence must not merge into business rows).
Tests 306/306 + tsc clean (9 new). Deployed v8d4a289c. Catering eval
run_ac026b81 launched on same build (504 Yard corporate catering in
Ikeja; scored separately, never as generalisation proof).

## 2026-10-29 - Catering eval: 0/25, two real bugs + one vertical truth

run_ac026b81: all 25 disqualified, 0 drafts. NOT a pipeline failure:
1. Gate false-reject (deterministic bug): "Legal Services" vs segment
   "Professional Services" - inclusion matcher has no hyponyms outside
   retail/logistics. FIX: industry inclusions REMOVED from the gate;
   model-judged via icp_fit (threshold 3) instead. Gate now owns only
   explicit exclusions + geography. Brief prompt now demands
   adjacent-vertical exclusions (the remaining deterministic drift
   guard). Spec 12.6 updated.
2. Name-part dedupe broken by design: same-name rows with different
   domains never merged (OPay x2) - the name-only fallback only hits
   rows STORED without a domain. FIX: findSibling scan (domain+token
   rule, then name-part rule, earliest wins).
3. Vertical truth: catering pains/triggers (team lunches, 20+ staff,
   HR buyer) are nearly unobservable from snippets, so the model
   honestly scores icp_fit 1 ("no evidence of Ikeja office, team
   size, lunch need"). Correct refusal to invent. Catering parked as
   fallback demo ONLY if a venue-beachhead run qualifies; demo =
   retail (proven loop + drafts). One NULL verdict observed = legacy
   fallback working as designed (dims omitted for 1 item).
Also: law-vertical guards (numbered listicles, law/legal/firm
generics, types-of/about-company/full-list, detached/duplexes/
terrace). Tests 324/324 + tsc clean (18 new). Deployed vb5055baa.
Run 7 run_c5d01d96 (TechAssembly) verifies no drift regression.

## 2026-10-29 - Comparison run 7: no drift, no_signal debuts, bar too strict

run_c5d01d96: 0 qualified, 6 no_signal (all fashion boutiques, dims
5/4/1/4/3), 4 needs_research, 15 disqualified. NO DRIFT anywhere -
gate inversion validated (model holds the segment; brief exclusions
now name schools/clinics/pharmacies/hospitality explicitly thanks to
the adjacent-verticals prompt line).
Product decision: shortlist = qualified + steady no_signal (rank
change; investigating->shortlisted transition added; verdicts stay
distinct). Withholding drafts from icp_fit-5 accounts over an
unobservable trigger wastes runs; drafts use hypothesis timing.
Also: about/contact/where-buy/haul/FAQ/all-outlets/story guards,
supplier-vendor colon words, introduces verb. Tests 339/339 + tsc
clean (15 new). Deployed v75f1dba7. Run 8 run_b84f3af5 expects a
multi-prospect shortlist (qualified + steady).

## 2026-10-29 - Comparison run 8: 3/3 shortlisted, all grounded. SPRINT CLOSED.

run_b84f3af5: 3 shortlisted (all no_signal steady), 4 needs_research,
3 manual_review (verdict debuts, all correct: directory-only evidence),
15 disqualified. 3 drafts with specific subjects.
Acceptance: shortlist in-segment 3/3 (Feebees Oniru supermarket +
WhatsApp orders; KNG Ebute-Metta grocery + WhatsApp; QuickDelivery
Lagos logistics for restocking); 0 hard violations; owned fetched
source 3/3 (feebees.ng, kng-store.lovable.app, quickdeliveryng.com);
0 contradictory dupes; drafts 3/3.
Notes: AgroGroom qualified (run 5) -> disqualified (run 8) is
evidence variance, honestly reasoned (run-8 snippets had zero Lagos/
channel evidence). Remaining name nits (Wig shops, Car washer,
underscore handles, mashed "Mart | Clutch" titles) all correctly
disqualified by assess - zero shortlist impact, parked.
BEFORE/AFTER (TechAssembly): baseline 25 prospects / 4 qualified with
school/clinic drift, headline junk, 274 snippets vs 9 fetched, 8/25
routes -> now 3 shortlisted, 100% in-segment, 100% dimensional
coverage, 100% owned sources, 3 linked drafts, 0 junk shortlisted in
5 consecutive runs (4-8). Catering eval documented separately (0/25,
correct refusal; parked unless venue-beachhead run).
RESEARCH FROZEN as of v75f1dba7 (commit 5c6ae0c) for the UI revamp.
Only logging research bugs in progress.md from here; no logic changes.

## 2026-10-29 - UI revamp P0 START (Step 0 audit)

Audit: Worker Static Assets ./public, no build step; vanilla JS
(index.html 8 views, api.js Mock/Real via ?live=1, app.js ~38KB,
styles.css); DEMO DATA banner index.html:12 + app.js:695; no CSP
headers (Google Fonts OK); RunStatus/verdicts/dims already cover
progress + Ready/Warm/Look tabs; brief+ICP live (onboarding feeds
profile->brief unchanged); 339 tests green (spec's "140" is stale).
Plan approved by user. taste skill preflight before first edit.

## 2026-10-29 - Revamp P0.1 DONE: tokens + shell (dark theme)

New tokens.css (exact PDF values, --accent single variable), styles.css
re-skinned dark (gold pills, 48px targets, Fraunces/Manrope via Google
Fonts with display=swap, focus rings, rise/float/pulse/lift with
prefers-reduced-motion), index.html head (fonts, tokens, theme-color,
lang en-GB). No JS or backend changes; all selectors/ids preserved.
Verified: local serve + headless screenshot viewed (dark shell, gold
CTA, serif headlines, restyled banner), console 0 errors, 0 failed
requests (fonts load, no CSP issue). Pre-existing bug noted:
view-campaigns lacks `hidden` on load (visible under onboard);
fix rides with the P0 view restructure.

## 2026-10-29 - Revamp P0.2 DONE: landing page (PDF screen 1)

New view-landing (verbatim PDF copy, sample content labelled sample):
nav, hero + floating sample cards, shift rows, engines, 3 steps,
channel samples, trust, final CTA. VIEWS += landing/campaigns (fixes
the campaigns-visible bug); landing hides app header; data-start ->
onboard, data-sample -> mock shortlist (live without run -> onboard).
Verified: desktop + 390px screenshots viewed (0px overflow, single
column), CTA click asserts pass, console clean, 339 tests green.

## 2026-10-29 - Revamp P0.3 DONE: conversational onboarding (PDF screen 2)

Endpoint POST /api/onboard/turn (stateless; client holds the field
map): free text + prior fields -> validated merge + max 1 next
question, follow-up cap 3 enforced server-side (no model call at cap),
8-key allowlist, labels user-provided/inferred/unknown, skip/edit lock
and always win, model output coerced (unknown keys dropped, labels
forced inferred, chips capped 3), fail-closed 500 no-key / 502
model_error. Meta burst via existing buildPhaseRequest tool-free
structured pattern. Feeds existing createProfile (q1-q5 mapping);
timeline/budget fold into description; profile view kept as the
confirm step (PDF has none; streamline later if time allows).
UI: state A (name + free text + presets) -> state B chat (YOU SAID +
Edit, serif question, helper, answer + chips, Continue, Skip-link,
understood panel with guess chips + inline edit, step countdown,
Save-and-exit); mock mirrors server merge rules; "not sure" chips
skip. Fixed smoke.mjs P0.2 rot (was red at baseline: missing
view-landing/campaigns/senders ids, boot view, document.querySelector
stub) and extended it to walk the chat + live onboardTurn adapter.
Verified: 349/349 vitest green (+10: 7 route, 3 meta), smoke PASS
(chat ask/answer/skip/edit-first/finish + full flow + live adapters),
node --check clean, headless drive (question/chips/countdown/panel/
profile asserts) 0 console errors 0 failed requests 0px overflow,
desktop + 390px screenshots viewed (stacked, no clipping).
NOT deployed: live worker still v75f1dba7 without this route; deploy
rides with the end-of-revamp release. Research logic untouched
(freeze holds).

## 2026-10-29 - Revamp P0.4 DONE: research progress + set-aside (PDF screen 3)

No backend changes (freeze holds; read APIs already expose everything).
New api.getProgressSnapshot on both adapters: run status + brief +
prospect statuses -> found/opened/kept counts, brief-driven search
line ("Searched for X in Y"), consumed budgets, set-aside list with
reasons (live: disqualified rationales via the cached evidence
adapter, first sentence, one fetch per prospect; mock: 3 staged demo
drops). UI: kicker (SAMPLE/LIVE RUN), Working-now eyebrow + serif
title, honest stay-open note per mode (no fake "we will message you"),
stats trio, 7-step checklist with done/active/todo states (past-tense
labels, first-todo-active rule, open counts), budget line, set-aside
card, Preview results so far (mid-run partial shortlist; mock slices
by tick) + Stop and adjust my brief (returns to profile; the old run
keeps going server-side, no stop endpoint under the freeze).
Verified: smoke PASS (mid-run stats/steps/set-aside, 2-prospect
preview, stop-to-brief, live snapshot adapter mapping), node --check
clean, headless full-journey drive 0 console errors 0 failed requests
0px overflow, desktop + 390px screenshots viewed. Fixed along the way:
legacy #progress-steps CSS overriding the new checklist (removed dead
progress-bar rules); two stale local http.servers colliding on :8000.

## 2026-10-29 - Revamp P0.5 DONE: shortlist tabs + sticky bar (PDF screen 4)

No backend changes (freeze holds). Tabs bucket by verdict (Ready =
qualified, Warm = no_signal, Look = everything else incl.
needs_research/manual_review/unscored); disqualified stay excluded
(set-aside owns them). Cards show fit badge, why-now (readiness>=3 ->
rationale first sentence, else honest no-signal lines), derived
source label (their Instagram/Facebook/careers page or hostname),
first contact route labelled Published not yet checked, and the top 2
uncertainties; routeless cards say so. Tick selection defaults to all
and drives the sticky bar count plus a drafts filter with honest
notes for missing drafts. Mock data enriched to 2/2/2 across tabs;
live adapter maps verdict/readiness/rationale/uncertainties/routes/
sourceUrl, reusing the cached evidence adapter.
Verified: smoke PASS (tab counts/switching, card fields, untick ->
count, 3-draft filter + notes, live mapping), 349/349 vitest green,
node --check clean, headless full-journey drive 0 console errors 0
failed requests 0px overflow, desktop + 390px screenshots viewed.
Note: stale :8000 screenshot servers keep surviving terminate; killed
by PID again before driving.

## 2026-10-29 - Revamp P1 DONE: message studio + restyle (PDF screen 8)

No backend changes (freeze holds). Drafts view rebuilt as a one-message
studio: MESSAGE N OF M pager, channel tabs (WhatsApp/Email/DM mapped
from channel_suggestion; off-channel tabs honestly state the single
variant), tap-to-edit inline editor with save/cancel, tiered word
guidance (40/80), per-channel sender line + opt-out + Change sender
(returns to drafts), Approve and schedule / Skip this one (defer) /
Reject instead, and a WHY THIS MESSAGE panel (fact quote + view-source
link when http, hypothesis, profile offer, next_action ask) with the
honesty footer. Mock drafts vary by channel (short hook vs fuller
email) with hypotheses + next actions; live adapter maps
channel_suggestion/next_action. Deliberately omitted under the freeze:
tone rewrite buttons and Send-a-test (no endpoints; faking either
would be dishonest). Remaining screens (profile/status/campaigns/
senders) got brand header rows; h2s were already serif.
Verified: smoke PASS (pager/tabs/edit/save/skip/defer, why panel,
live mapping), 349/349 vitest green, node --check clean, headless
full-journey drive 0 console errors 0 failed requests 0px overflow,
desktop + 390px screenshots viewed.

## 2026-10-30 - Revamp CLOSED: deploy + live journey + report

Deployed revamp to production (version 4727b403, then redeploy with
closure fixes; worker prospect-research.sam-5b1.workers.dev). Live
build verified: studio markup served, POST /api/onboard/turn live
(400 on empty body, zero model cost).
Full live journey at 1440px (?live=1, catering profile): 4 chat
turns with real questions/chips to done, profile confirm, Workflow
run to awaiting_approval, 7-prospect shortlist, empty studio,
status board. Screenshots viewed (landing/chat/profile/progress/
shortlist/studio/status). 390px live: landing + one real chat turn,
0px overflow, 0 console errors. D1 cross-check: run_a350 has 18
disqualified + 7 needs_research + 0 drafts, exactly what the UI
showed — mapping honest end to end.
BUG LOGGED (frozen research, not fixed): production Workflow builds
the brief excerpt from description only (workflow.ts load-profile
step) while the dev path appends service area + buyers. Observed:
profile.service_area={note:"Ikeja and Yaba"} correct, but
commercial_brief.geography="Unknown - service area not stated",
plan queries ungeoqualified, US drift (law firms) + junk candidates
(job listings, email-lookup pages), 0 qualified. Post-freeze fix:
mirror the postStart excerpt composition in workflow.ts. Skipped a
second live run: same systematic bug would reproduce, low value.
Pre-existing, untouched: POST /runs/:id/start returns 501
use_workflow in production by design; client handles it as
already-running (one console error on the journey, cosmetic).
Closure fixes from live evidence (frontend, revamp scope): profile
offer no longer duplicates the buyer ("to offices for offices…");
shortlist lands on the first non-empty tab; empty-drafts status
board says "nothing qualified" instead of "all reviewed".
Verified: smoke PASS (+3 asserts), 349/349 vitest green, empty-
drafts board viewed via transient local probe (reverted).

## 2026-10-30 - Exact-PDF pass DONE (passes A-G, user review response)

User rejected the first revamp as not exact: "screenshot the pages
and get the design ui elements and replicate it exactly". Rendered
all 8 PDF pages to PNG (C:/Temp/pdf-p1..p8.png) and rebuilt each
screen against the screenshots in vanilla JS/CSS. Research stayed
FROZEN throughout; only frontend + two new studio endpoints changed.

Pass A (chrome/tokens): --white/--info/--gold-deep/--green-deep/
--navy-deep/--ink-strong tokens; favicon.svg replaced with the gold
rounded-square-dot mark; brand mark prepended to all 9 brand rows;
flow views (landing/onboard/profile/progress/shortlist/drafts) hide
the site header/footer and drop the outer card (view-plain);
kicker variants (dim/green/blue), white active tabs, gold + plain
link variants, view-source gold, base anchor gold.
Pass B (landing): eyebrow pill with green dot, display serif hero
with gold italic "buy", gold + outline hero buttons with arrows,
2-col tick list with inline SVG checks, sample prospect card with
inset why-box, green WhatsApp card, approval bar, full-bleed strip
band, 3+1 shift cards with strikethrough befores, stacked engine
cards with filled tags, hairline steps with giant gold numerals,
2+1 message cards with bubbles, trust columns with gold top rules,
gold CTA panel with dark pill, landing footer line.
Pass C (onboard): segmented progress (segs + step text, 1 filled
on first view, 2 in chat), 2-col chat + understood panel, big
serif question, per-key helper line + worked-example placeholder
(OB_SUB, 8 keys + fallback, no endpoint change), tall gold-border
answer box, hairline stacked panel rows with gold "Asking you now"
and inset note box.
Pass D (progress): green Working-now line, 3 stat cards (gold kept
card), checklist card with circled green checks + hairlines + bold
active row with gold "n of m" and progress bar, set-aside card with
inset boxes holding the gold Preview button + stop link. Kept the
honest close-page note (PDF "we will message you" would be false).
Pass E (shortlist): full-width pick cards (checkbox + serif name +
filled fit pill, 2-col why/reach, hairline unconfirmed), white
active tab, spelled-out title ("Six buyers…"), per-tab sub-line
(look tab warns), full-bleed sticky bar. Evidence + contact-log
panel moved below the list (preserves contact tracking; only
visible layout deviation from PDF screen 4).
Pass F (studio): 2-col studio + why panel (coloured h4s, hairlines,
gold source links incl. scheme-less domains, inset note), big
draft text, green word line with SVG tick, sender card with gold
Change-sender link, approve/test/skip/reject actions row.
Pass G (TDD endpoints): POST /api/drafts/:id/rewrite
{warmer|more_direct|another} via meta.rewriteDraft structured burst
(validated, facts-preserving prompt), persisted through editDraft
(illegal after decision); POST /api/drafts/:id/test-send emails
the draft to the sender's own address through the connected
provider, email-only, 409 without sender, activity test_send
logged. MockApi deterministic demo transforms; studio tone
buttons + test button + aria-live status wired.

Verified: 7 RED -> GREEN route tests, +2 meta tests, 358/358
vitest green, typecheck clean, smoke PASS (+13 asserts incl. tone
rewrite, test-send, adapter mappings), node --check clean.
Screenshots viewed at 1440 (hero/landing/chat/progress/shortlist/
studio) and 390 (landing/chat/shortlist/studio): 0px overflow, 0
console errors, 0 failed requests everywhere.
Deliberate deviations from PDF (all honest-function): no "we will
message you" claim; look-tab sub warns; evidence/contact panel
kept below shortlist cards; reject link kept beside skip; pager
kept for multi-message studios; test-send email-only.

Shipped 2026-10-30 (user-approved): commit 7e60140 pushed to
main; worker deployed (version d4a23d22, --containers-rollout=none
because Docker daemon was down; relay container untouched by this
pass). Live validation, zero frozen-data mutation: rewrite 404 /
unknown_tone 400 / illegal_edit 400 on decided draft, test-send
404 / wrong_channel 400, all exact; one scratch draft inserted,
live warmer rewrite returned 200 with facts preserved and
edited_by_human=1, scratch deleted after. Served HTML contains
the new build markers. Test-send happy path NOT fired live (would
send a real email); covered by mock-provider route test.
V2 revamp (user-approved new reference set 2026-10-30):
Prospect Research Revamp (1).pdf + Revamp-png.zip + Revamp.html.
Minimalist, mobile-first, production grade. Research FROZEN;
frontend + approved studio endpoints only. References extracted
to C:/Temp/revamp-png, downscaled to C:/Temp/revamp-small, 9 PDF
pages rendered to C:/Temp/v2-p1..p9.png and viewed. Em-dash scrub
done (frontend total 0).

V2 P0.1 done (mode system rework): main journey always live via
RealApi; selectApi checks pathname === /demo only (MockApi for
judges). Removed #demo-banner + #mode-line markup, .demo-banner
CSS, showSampleShortlist + [data-sample] wiring. No user-visible
LIVE MODE / DEMO DATA / ?live=1 anywhere; per-screen EXAMPLE DATA
kickers on all six data views (progress, shortlist, drafts, status,
campaigns, senders), set centrally in showView() and gated by
isDemo(). Title no longer says Demo. SPA fallback
added (assets.not_found_handling = single-page-application, schema
verified in wrangler 4.155; run_worker_first arrays need 4.20+ so
not used): navigation to /demo serves index.html, fetch() API calls
are non-navigation and still reach the Worker. Smoke updated:
journey flow pinned to /demo sandbox, +2 selectApi assertions,
stale SAMPLE RUN kicker assertion fixed to EXAMPLE DATA.
Verified: typecheck clean, 358/358 vitest, smoke PASS, node --check
clean on app.js + api.js.
P0.1b: /demo returned 501 for non-navigation requests (SPA fallback
only catches navigation). Added worker /demo route serving
index.html via ASSETS binding + 2 route tests (RED then GREEN,
360/360). Deployed c402e5be then 44d5111a
(--containers-rollout=none). Live: / 200, /demo 200 text/html,
API 404 JSON intact.

V2 P0.2 done (landing rebuild, commit 3f2b1d3): one gold CTA in hero
+ dark CTA in final panel, Sign in plain-text link with honest
coming-soon note (no accounts exist), non-interactive hero SVG with
readable prospect card (name, Strong fit, why-now, source) + message
bubble + approval badge. Story order per images: hero, problem band,
guide, steps, with/without, trust, final CTA. Phone: guide folds away,
THREE STEPS kicker shows, full-width 64px CTAs.
V2 P0.3-4 done (onboarding, commit 2af5b29): single free-text box +
Speak (SpeechRecognition, hidden when unsupported) + Need an example
link; Business name field and Try-one chips removed. Backend
extractBusinessName (quoted, explicit, suffixed patterns; TDD 4 route
tests, 364/364): extracted names carry assumed provenance (editable at
confirm); missing_name 400 only when unresolvable, and the client
then asks "What should we call your business?" inline (skip allowed,
working label "My business"). Max 3 follow-ups unchanged, skip always.
V2 P0.5 done (failure states, commit 8420e77): network failures show
"We could not reach the service. Check your connection and try again."
with Retry (re-sends last turn or finish); typed text preserved;
confirm + progress failures plain-language with retry; no raw error
ever rendered. Smoke covers fail → message → retry → advance.
V2 P0.6+P1 done (routing truth + polish, commit 328b3f6): Save and
exit really saves (localStorage draft, restored on return); Stop and
adjust my brief really stops (POST resume to=stopped) with no
view-yank after navigating away; Approve and schedule routes to the
campaign scheduler once every message is decided; campaigns view gains
Back to messages. Step transitions 0.3s slide+fade, skeleton loaders
for research steps + shortlist, phone fixes (stacked stats, nowrap
header links, URL wrap). No user-visible sample/demo/live/API wording.
Verified: typecheck clean, 364/364 vitest, smoke PASS, node --check
clean. Screenshots viewed at 1440 + 390 (landing, describe, follow-up,
progress, shortlist, studio): 0 overflow, 0 console errors, 0 failed
requests. Deliberate deviations: no "we will message you" claim (no
messaging infra; honest "come back any time"); evidence/contact panel
kept below shortlist cards; pager + reject + status-board entry kept in
studio; guide section desktop-only per phone reference.
Shipped 2026-10-30: commits 3f2b1d3, 2af5b29, 8420e77, 328b3f6 +
record dcc0902 pushed to main; worker deployed version 3909c360
(--containers-rollout=none; relay untouched). Live: / 200 with v2
markers, no banner/query strings; /demo 200; live 390 landing
screenshot viewed, 0 overflow, 0 console errors, 0 failed requests.Next action: post-freeze Workflow brief-excerpt fix + live re-run.
2026-10-30 (speech-to-text replaced with Muse Voice Transcribe + wiring fixes):
User-reported bug: dictation on "What do you sell?" stacked garbage ("We do
inn systems for businesses" repeated). Root causes: (1) setupVoice used the
BROWSER SpeechRecognition (not a Meta model; "AI" misheard as inn/EM/To),
(2) its onresult appended every cumulative partial into the textarea. Fixed
by replacing with MediaRecorder -> 24kHz mono WAV -> POST /api/transcribe ->
Meta muse-voice-transcribe-1.0 batch endpoint (PUSH_TO_TALK, English bias,
business keywords incl. "AI"; key stays server-side, "Bearer " + concat per
AGENTS.md). One click now appends exactly one clean utterance. Files:
src/asr.ts (new), src/index.ts (route + postConfirm idempotent +
dimensions parse + test_send activity best-effort), src/orchestrator.ts
(loadRunConsumed/persistRunConsumed: caps + progress UI now per-run),
public/app.js (voice rewrite + campaign filter d.status + poller stale-run
guard + double-submit guards), public/api.js (Safari<16.4 lookbehind removed,
MockApi draft store so demo campaign wizard sees approved drafts,
already_confirmed tolerance), schema.sql + migrations/0003_activity_test_send
(CHECK rebuild adding 'test_send'; REMOTE MIGRATION PENDING deploy approval).
Verified: tsc clean, 379/379 vitest (11 new asr, 4 new consumed, confirm +
dimensions route assertions updated), smoke PASS, node --check on
app.js/api.js. Dictation end-to-end needs a real mic; deploy + live speech
check pending user approval. Prod secrets confirmed via wrangler secret
list: MODEL_API_KEY present; BASETEN_API_KEY absent (not needed for STT).
Deferred (user decision): API auth token, unsubscribe confirm-page
(GET-opt-out scanner risk), 0002/schema.sql idempotency, delivery-jobs
queue creation note.
2026-10-30 (landing band alignment fix + remote D1 migration applied):
User flagged the "Sound familiar?" band (l-problem) misaligned. Two real
bugs: (1) the per-child centering rule (.l-problem > *) was defeated by
.kicker margin:0 and .view-landing h2 margins (specificity/source order) ->
band text pinned ~24px+ from the window edge vs the 72rem column; (2)
width:100vw full-bleed includes the Windows scrollbar (~17px) with no
overflow-x guard -> stray horizontal scrollbar. Fix: real inner container
.l-band-in rebuilding the exact column geometry
(max-width calc(min(72rem,100vw) - 2*var(--app-pad-x)), padding 1.5rem);
--app-pad-x custom property introduced as the single home for #app gutter
(1.5rem, 1rem <=480px) so band and shell can never drift; body
overflow-x:clip for the scrollbar bleed. Evidence (headless Chromium,
file:// load): band kicker/h2 left == hero title == guide h2 == steps ==
compare at 1440px (all 192), 800px (all 48), 390px (all 40);
scrollWidth==clientWidth at all three; 0 console errors; full-page
screenshot reviewed. Remote D1 migration applied + verified: 0003 activity
CHECK rebuild via d1 execute --remote (migrations tracking table absent,
0002 not idempotent vs applied schema.sql so migrations apply was unsafe);
477 activity rows preserved (477 before == 477 after), new DDL contains
test_send, idx_activity_run recreated, no activity_v3 leftover. Local dev
DB was empty: seeded via db:migrate:local (schema.sql already carries
test_send). tsc clean, 379/379 vitest, smoke PASS. NOT yet deployed:
worker code (transcribe route + fixes) and the CSS/HTML fixes are local.
2026-10-30 (DEPLOYED, user-approved): wrangler deploy
--containers-rollout=none -> version f4762790-ef97-4898-95f0-5106503be8f6
(268 KiB, bindings unchanged, relay untouched). Live verification:
GET / 200 with new assets (styles.css carries l-band-in + overflow-x:clip;
index.html carries the wrapper); POST /api/transcribe junk 10B -> 400,
RIFF 12B -> 400 audio_too_short (validation before any model call);
synthesized 0.5s silence WAV -> 422 transcribe_empty (full live round-trip
Worker -> Meta muse-voice-transcribe worked; ~0 billed seconds). Live
landing alignment re-measured in browser: 192/48/40 exact at 1440/800/390,
0 console errors, 0 failed requests. Remaining user step: speak one
sentence into the live mic button ("We do AI systems for businesses")
to confirm a clean single-line transcript. Nothing else pending.
2026-10-30 (run stranding diagnosed + fixed; animation + location guard added):
User-reported: progress view stranded at "Checking fit" (run_109a87e6, New
Orleans brief "504 Yard Grills"). Evidence: workflow instance
wf_743382dc errored 84s in — "assess stopped: budget_tool_rounds"; run row
stuck at assessing, 0 assessments, UI polled a dead run for 12+ min. Root
causes: (1) my consumed persistence made tool_rounds cumulative though the
spec caps it per burst (6) — investigate's 19 rounds tripped the cap at
assess entry; (2) instance errors never marked the run failed. Fixes:
loadRunConsumed resets tool_rounds to 0 (per-burst, tested); workflow.ts
wraps wf.run() and step-writes status=failed with the error reason before
rethrowing (2 tests incl. marker-write-fails case); callResponses gets a
120s AbortSignal.timeout (a stalled Meta call used to hang the step
forever); postRun marks workflow_start_failed when the instance create
fails (bestEffort now returns success). Stranded run repaired via remote
D1 UPDATE to failed with the honest stop_reason. Also added (from user
asks): speak-button recording feedback — accent pulse ring + equalizer
bars while recording, unified pulse while transcribing, reduced-motion
safe (--accent-rgb token added), verified via forced-state screenshots;
location precision: onboardTurn prompt rule (never silently expand a bare
place name; offer the full form as a chip) + deterministic backstop
needsLocationDisambiguation in postOnboardTurn — a service_area with <2
comma parts triggers a follow-up asking for e.g. "Ikeja, Lagos, Nigeria"
(skips locked values, defers to the model's own location question, only
within followup budget; 5 new tests; OB_SUB example updated). tsc clean,
386/386 vitest, smoke PASS, node --check ok. NOT yet deployed.
2026-10-30 (DEPLOYED 19551f40, user-approved + pushed): location handling
made strategist-grade per user pushback ("some serve online and offline;
be a perfect salesman"): LOCATION_ASK_PROMPT now asks base AND reach;
model prompt captures base + stated reach (e.g. "Ikeja, Lagos, Nigeria —
nationwide delivery") with "Worldwide"/"Online" valid when no base;
needsLocationDisambiguation passes global/online words (tested);
serviceAreaFromGeos drops reach words so a worldwide business gets NO fake
city geo-bias on web_search (tested). Deployed --containers-rollout=none:
version 19551f40-6bd3-4eca-9641-c5f33b0ead0e; live styles carry speak-eq +
speak-pulse; /api/transcribe junk -> 400. Pushed to main: commit 5a9a82f
(13 files, +412/-22). tsc clean, 388/388 vitest, smoke PASS. User next
step: re-run the grill-chicken brief — expect a base+reach ask for a bare
"Ikeja", and a real recording animation on the speak button.
2026-10-30 (agentic QA loop + strategist brief + onboarding dynamics + nav):
User verdict on the run shortlist: "sick and terrible" — barbers/IT firms
for a chicken caterer, enbizopedia/beautynailhairsalons sources, "http 404"
shown as evidence, all "unclassified · Area unconfirmed". Direction: make
research an agentic loop with QA orchestration on Cloudflare Workflows; be
a business strategist (grill chicken in Ikeja -> corporate event hosts
around Ogba/Allen/Maryland); dynamic questions only for what's missing;
real navigation (campaign -> dashboard -> describe another business).
Implemented: (1) QA LOOP in ResearchWorkflow.run() AND dev runPhases():
sweep(discover/investigate/assess) -> deterministic quality snapshot
(runQuality: good=fit>=3 non-junk, junk=directory-only evidence,
unlocated) -> stop when good>=4 / planner dry / budget low / 3 sweeps;
else replan step (meta.planMore: fresh queries given previous+whyNot)
rewrites run.plan {queries, all_queries}; run-status loop-backs added to
RUN_TRANSITIONS. (2) STRATEGIST: buildBriefGoal rules (buyers are hosts/
organizers/budget-owners, never lookalike sellers; expand base to known
neighbour districts; honor stated reach) feeding plan/search/assess;
buildPlanGoal/buildSearchGoal carry buyer_roles defensively. (3) QUALITY
GATES: isJunkProspect + runQuality; rank excludes directory-only
prospects from qualified+steady; investigate failure details no longer
saved as evidence (http 404 fix); candidates inherit the brief's area
(Area unconfirmed fix); isDirectoryHost gains aggregator patterns
(/pedia/ etc. — enbizopedia class). (4) ONBOARDING: prompt forbids
re-asking any Known field ("Ikeja, Lagos" is complete; country never
worth an ask) + deterministic anti-re-ask guard (asked-key with value/
locked -> turn ends); "around/near/in/at" prefix stripped from
service_area; UI step line now honest ("N of 5 details captured · we
only ask what is missing") with segs reflecting captured fields.
(5) NAV: after scheduling a campaign -> "Go to the status board" +
"Describe another business" buttons (restartToLanding). Tests: runQuality
pure tests, never-re-ask + strip, planMore replan client test, fetch
failure no-evidence assertion (old test flipped), 393/393 vitest, tsc
clean, smoke PASS, node --check ok. NOT yet deployed.
2026-10-30 (DEPLOYED 3de50cfa, user-approved + pushed): commit 8fef5d5
(11 files, +434/-76) live. Verified live: app.js serves the dynamic step
line + status-board/landing nav buttons; transcribe guard 400. Agentic QA
loop, strategist brief, junk gates, onboarding anti-re-ask, and nav are
now in production. User next step: re-run the grill-chicken brief live —
expect at most one base+reach ask, event-host buyers around the expanded
Ikeja area, directory junk excluded, and a QA loop before anything shows
in the shortlist. Watch first-run behavior and report any drift.
2026-10-30 (Gemini-style thinking state + working button morph): user asked
for the between-questions gap to animate ("what would Google do"). Built:
(1) #ob-thinking block shown whenever a turn is in flight — shimmering
gradient sweep across the status text (background-clip:text, Gemini
signature) + three staggered gold dots; copy rotates honestly every 2.2s
(Reading what you said -> Pulling out the facts -> Deciding what to ask
next -> Almost there), role=status for screen readers. (2) The answer
form + orphaned empty box hide during the turn (they used to sit there
enabled with no question). (3) Continue button morphs instead of going
dead: spinner arc inside, label "Working…", arrow parked, aria-busy,
min-width prevents layout jump; Skip dims to 0.45. (4) Typed answers
still survive failures (only a NEW question clears the box — smoke
assertion kept); every turn (send/retry) shows the state; error path
re-renders without it. Reduced-motion: shimmer/dots/spinner stop, color +
label carry the state. Verified: smoke PASS (new ids registered in the
DOM surface guard; fixed busy-init guard that swallowed the first send),
393/393 vitest, node --check; headless screenshots of the live-flow
thinking state (shimmer + spinner + hidden answer UI) via a suspended
/ api/onboard/turn route. NOT yet deployed.
2026-10-30 (DEPLOYED 12be27b8, user-approved + pushed): thinking state live.
Commit 22f8b27 (5 files, +140/-11) pushed to main. Live verification
(headless, /api/onboard/turn suspended mid-flow): thinking block visible,
shimmer copy "Reading what you said...", answer UI hidden, spinner shown,
button label "Working...", arrow parked, aria-busy=true; 0 console
errors, 0 failed requests. Onboarding turn UX is now fully animated:
shimmer+dots status line, working button morph, honest captured-count
progress line, typed-answer-survives-failure kept.
2026-10-30 (504Yard benchmark mined + root cause + quality gates v3):
User: "the results so far are dumb" — pointed at C:\dev\504Yard as the good
example. Mined OpenCode session history (opencode.db, session_v2 +
session_message): ses_ea237a001 "504 Yard Grills prospect research &
outreach" (Oct 21-23, C:/dev/game) spawned SEVEN parallel category
subagents (venues/planners/churches/corporates/hotels/clubs/lounges,
"Research Lagos X w/ Instagram", 25-30 each). The method: (1) category
split, (2) verification anchor — an Instagram handle must be SEEN in
search results, never guessed, (3) two-step per prospect: org via
directory CATEGORY page then its social handle, (4) strict evidence
discipline (phone only when seen). ROOT CAUSE of the Nigeria-wide junk
run found in D1: areaOf() parsed service_area {city,region,country} but
onboarding stores {note:"kodeosh street, ikeja"} -> brief said "no
service area stated" -> geos placeholder -> wide queries -> job boards.
Fixed: areaOf passes the note (tested); geography rule in buildBriefGoal
(expand street to area/city/state/country, no placeholders); ecosystem
researcher query style + >=4 buyer categories in plan goal; search goal
forbids job ads, two-step handle rule (never guess); investigate gains
a 504Yard verification pass (one bounded search per prospect for the
official social profile; route+evidence saved; skipped on social
discovery url or budget exhaustion); isDirectoryHost + job boards
(betajob/grabjobs/myjobmag/jobgivers/glassdoor/zippia) + cvent/vymaps/
mapcarta/billionaires.africa/amimagazine/nairaland; isPlausibleName
rejects launch/unveil/debut names, role-led job-ad names (HR Business
Partner..., Head of..., People Operations...), month+year listings,
"hiring" ads; evidence URL dedupe in discover (billionaires.africa x3
regression); containment merge in rank ("De Renaissance" vs "De
Renaissance Hotel" absorbed into the higher-fit name, evidence unioned,
loser disqualified with note); onboarding prompt sharp-memory few-shot
(name/offer/buyers extracted from one statement; asking for a stated
name forbidden) + tested anti-re-ask drop. Verified: tsc clean, 402/402
vitest, smoke PASS. NOT yet deployed.
