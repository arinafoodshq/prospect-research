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
2026-10-31 (DEPLOYED 0262f254, user-approved + pushed): commit 342d5e7
(7 files, +213/-7) live: 504Yard method transfer — areaOf note fix (root
cause), ecosystem query style, investigate verification pass, junk gates
v3 (job boards/news/maps/venue aggregators, headline/role-ad/month-year/
hiring name rejections), evidence URL dedupe, containment merge,
onboarding sharp-memory few-shot. Verified: tsc clean, 402/402 vitest,
smoke PASS. User next step: re-run the 504 Yard brief live — expect
Ikeja-scoped ecosystem queries, social-anchored prospects with routes,
no job boards/news/duplicate names; compare against the manual 204-row
tracker quality bar.
2026-10-31 (P0 correctness + contact verification, spec from user with the
two HTML references): the user attached landing.html + workspace.html as
the design references and a P0/P1 plan built from the live-run failures
(banks for a caterer, "Firm brochure 2026" as a business, timestamp
phone 20261004104841, LinkedIn post as a company contact, Mayonex
duplicates, "Ready now" with no signal, dishonest "passed your
must-haves" headline, all pre-selected, dead-end Write-my-messages,
unclassified categories, repeated service area).
P0 correctness shipped: (A) segments from the owner's words only —
buildBriefGoal hard rule (banks/financial/professional services FORBIDDEN
unless named; into exclusions instead) + brief.groups contract {name,
reason, source: owner|derived} validated (owner-named groups steer
searches; derived shown for confirmation — P1 renders them). (B) entity
quality: isPlausibleName rejects em-dash titles, brochure/flyer/price
list/proposal artefacts, "Result page" listings; cleanBusinessName
strips mid-name locations; dedupeKey normalises "&" to "and" so
"Mayonex Events & Party Rentals" = "Mayonex Events and Party Rentals"
(merge tested). (C) tabs follow the definitions: app.js tabOf = ready
(qualified AND readiness>=4 AND own source) / warm (good fit no signal)
/ look (unclear identity, weak fit, no own source); fit badges follow
the tab. (D) honest copy: headline/sub generated from real counts
("2 ready to contact, 0 to warm up, 11 to check first" — never claims
passed-must-haves); default selection = Ready now ONLY (smoke updated:
untick then deliberate ticking). (E) contact states: schema migration
0004 (contact_route CHECK: public_listing/verified/unchecked/broken/
wrong_type), saveRoute accepts states, investigate verifies every
contact by script (phones via isValidNgPhone + WhatsApp-only-when-page-
confirms, email syntax+domain, page url verified from the already-
fetched text — zero extra network calls); new src/verify.ts:
classifySocialUrl (business shapes only; LinkedIn in/posts and IG
posts/reels wrong_type), verifyUrl (2xx+name/area match = verified,
404/410/parked = broken, social 403/429/login = unchecked), WhatsApp
confirmation rule, email "address not tested". api.js filters broken/
wrong_type routes from the UI (never shown as links) and passes states.
Phone rules: mobile +234/0 (11 digits, 7-9), Lagos landline 01+7;
timestamps and double prefixes rejected (tested). Verified: tsc clean,
413/413 vitest (10 files; verify.test.ts new: shapes, phones, verifyUrl
states, wrong-type-before-fetch, WhatsApp rule, email, & merge), smoke
PASS. Remaining from the spec: P0 search-grounding probe (5 known
businesses), P1 UI rebuild from landing.html/workspace.html (tokens
paper/ink/ultramarine/marigold, Fraunces+Manrope, sidebar+bottom tabs,
drawer, groups toggles, board stages, removed-list rendering), hide
internals (ids/timestamps/stated-assumed in status board + senders),
verification re-run of the same brief with before/after numbers. NOT
yet deployed.
2026-10-31 (DEPLOYED 18ee55d6, user-approved + pushed): commit caedc6a
(P0 correctness + contact verification). Migration 0004 applied REMOTE
first (816 contact_route rows preserved, new CHECK verified by
sqlite_master, no leftover table) then LOCAL. Deployed
--containers-rollout=none; live: GET / 200, app.js serves the new tab
rule (ready = qualified AND readiness>=4 AND own source), api.js serves
the broken/wrong_type route filter. Pushed to main (caedc6a + progress
record). Next per spec: P0 search-grounding probe (5 known businesses),
P1 UI rebuild from landing.html + workspace.html references (reference
preserved at Temp\opencode\reference-landing.html), hide internals,
verification re-run with before/after numbers at 390px + 1440px.
2026-10-31 (commit b0f523f, NOT yet deployed): P1 UI rebuild from the two
reference files. tokens.css rewritten to the paper palette (ground #F8F7F4,
cards #FFFFFF, ink #0B1220, ultramarine #3D5AFE accent, marigold #FFB020 final
panel; compatibility var names kept so every existing view re-skins without
DOM changes). styles.css: appended reference-theme layer (pill buttons with
shadow, white cards + hover lift, soft status tags, focus-visible, light
thinking shimmer/marigold dots, ultramarine progress bars, route-dot classes,
reduced-motion overrides). index.html: landing markup rebuilt to the
reference - hero with non-interactive example card (Example tag, avatar,
strong-fit chip, why-now panel, checked contact circles with dots), typed
WhatsApp draft bubble (#l-typed data-text, blinking caret), approve-status
pill (#l-status), sound-familiar block, three steps with top rules,
with/without duo (ultramarine vs white), trust row, marigold final panel;
SVG symbol defs (i-wa/i-mail/i-ig), Fraunces+Manrope weights 600-800,
theme-color #F8F7F4; kept #view-landing, link-signin, signin-note, both
data-start buttons. app.js: initLandingAnim - typed loop then "Approved.
Ready to send" then reset, reveal-on-scroll via IntersectionObserver,
prefers-reduced-motion falls back to full text + shown sections. smoke.mjs:
registered l-typed/l-status ids in the DOM-surface array; also
first-committed product/tests/verify.test.ts (missed by the caedc6a commit;
vitest depends on it). Verified: node --check clean, smoke PASS
(landing->chat->confirm->progress->shortlist->drafts->decide->status),
413/413 vitest, browser QA at 390px + 1440px (screenshots reviewed):
landing hero/example/bubble/status/steps/duo/trust/final, shortlist selected
card + tabs + honest "Published, not yet checked" copy + sticky action bar,
progress view live counters + checked-step list + set-aside reasons +
budget line; console clean except a deliberate font-CDN abort in one run;
no horizontal overflow at 390px. Known: Google Fonts CDN intermittently
hangs (Playwright screenshot font-wait) - production unaffected, page
renders with fallback fonts if it ever stalls. Next: deploy + push on
approval, then P0 search-grounding probe, hide internals in status
board/senders, verification re-run with before/after numbers.
2026-10-31 (DEPLOYED 0b5796b4, user-approved + pushed): P1 UI rebuild live.
commit b0f523f deployed with --containers-rollout=none; verified live: GET /
200, tokens.css serves #F8F7F4 paper palette, / serves the new example-card
landing markup. Pushed to main (b0f523f + 17440ae). Remaining per spec: P0
search-grounding probe (5 known businesses), hide internals in status
board/senders, verification re-run with before/after numbers at 390px +
1440px.

## 2026-10-31 — P0: sign-in required for the live product (user requirement)

Why: the product sends email and WhatsApp on the user's behalf; user required
sign-in ("there must be sign in"). Anonymous use of the live API is now blocked.

Implementation:
- Google OAuth sign-in reusing GOOGLE_CLIENT_ID/SECRET already on the Worker:
  GET /api/auth/start -> consent -> GET /api/auth/callback -> session cookie
  pr_sess (HttpOnly, Secure, SameSite=Lax, 30 days). D1 stores only the
  SHA-256 token hash (migration 0005 user_session, applied LOCALLY and verified;
  remote apply pending approval).
- Gate in the Worker fetch handler: every /api/* path requires a session except
  /api/auth/*, /api/me, /api/unsubscribe (message recipients have no session).
  Unauthenticated calls get 401 {"error":"signin_required"}.
- UI: new #view-signin card ("Continue with Google", back link, note slot);
  "Describe your business" gates to sign-in in live mode when signed out; demo
  (/demo) unchanged, its Sign in link explains the demo needs no account;
  header shows account chip + Sign out on chrome'd views; a mid-session 401
  (RealApi._req) fires ApiLayer.onAuthRequired -> sign-in view with expiry note.
- Tests: new tests/auth.test.ts (id_token decode, OAuth state signature/expiry
  rejection, session lookup incl. expired-row deletion) and
  tests/auth-gate.test.ts (real fetch handler: 401 on gated path, /api/me
  public, /api/unsubscribe public, live cookie passes). Direct-route suites set
  the documented hook __PR_SKIP_SIGNIN__ (pattern of __onboardMockTurn); the
  gate is always on in production.

Verification (evidence):
- node --check on app.js/api.js clean; npx tsc --noEmit clean.
- npx vitest run: 427/427 passing (was 413; +14 auth tests).
- npm run smoke: SMOKE PASS (demo journey unaffected).
- Browser QA (static server, fonts blocked): #view-signin renders at 1440 and
  390, no horizontal overflow; console errors limited to expected 404 /api/me
  (static server has no API) and the deliberate font-block abort. Screenshots
  reviewed in one 2-image batch (image-limit discipline after hitting the
  8-image cap: max 2 screenshots/turn, cumulative history counts; nuance added
  to C:\dev\agent-rules-templates\AGENTS.md section 6).

Files: migrations/0005_user_session.sql (new), src/auth.ts (new), src/index.ts,
public/index.html, public/app.js, public/api.js, public/styles.css,
tests/auth.test.ts (new), tests/auth-gate.test.ts (new), tests/smoke.mjs,
tests/routes.test.ts, tests/asr.test.ts. Commit 6b7dd8a (not yet pushed).

Limitations / unresolved:
- Remote D1 migration 0005 + Worker deploy + push: PENDING APPROVAL.
- Operator manual step (user): add authorized redirect URI
  https://prospect-research.sam-5b1.workers.dev/api/auth/callback to the Google
  OAuth client (same client as Gmail sending). Not possible from here.
- Sign out lives in the header (status/campaigns/senders views); landing shows
  no account chip when signed in. Sessions last 30 days.
- Workspace data is not per-user scoped yet (any signed-in user sees the
  workspace); ownership column deferred - single-operator MVP.
Next: on approval, apply 0005 remote + deploy + push; user adds the Google
redirect URI, then signs in live.

## 2026-10-31 — Investigation (user request): how the 504Yard tracker reached 200+ leads

Investigated C:\dev\504Yard (OpenCode session ses_ea237a001ffeFzlpdFZ6YRTFjk,
title "504 Yard Grills prospect research & outreach", 772 messages, 658 tool
calls, $5.64 model spend). The 2-row Perplexity starter (still intact at
C:\Users\User\Videos\...tracker.csv, 2 rows) never grew by itself. Growth came
from the session: user instruction "find more prospects. lets keep going on a
loop till you hit 200. ensure they have instagram so we can verify" -> parallel
per-category research subagents (planners / venues / churches / orgs; round 2
lounges / hotels / clubs) returning pipe rows NAME|AREA|IG|PHONE|WEBSITE|
EVIDENCE|SOURCE|FLAG -> scripts/merge_prospects.py mechanically enforced
IG-handle-or-reject, dedupe (name+handle+near-match), conservative rubric
scoring, per-category messages, rolling .bak backups. Result (audited): 204
rows, 0 duplicate orgs, 204/204 with source URL (57 unique domains; 112
instagram.com), bands A/B/C = 3/94/107 (avg score 55.6), 149 rows honestly
marked "IG-sourced - verify by opening profile", their validate_tracker.py
passes clean. Deployed as live app 504.sam-5b1.workers.dev (D1: wol504), 56
contacted, 21 replies. Recorded here because the pattern (quality brief first,
then category-batched verified research with a mechanical merge gate) is the
candidate model for System B research quality; proposal to follow (change
control required).

## 2026-10-31 — Deploy: sign-in batch live (approved: "GO AHEAD. DO WHAT'S BEST")

Sequence executed with verification at each step:
1. Migration 0005 applied REMOTE (prospect_research, WEUR): user_session table
   created (15 tables total, 5 rows written); verified via sqlite_master query;
   SELECT COUNT(*) = 0 rows, ready.
2. Worker deployed: version c90194b1-b704-49a4-8e8b-9e772ecca5f5 (100% traffic,
   created 2026-10-31T16:50:34Z).
3. Live verification (curl against https://prospect-research.sam-5b1.workers.dev):
   - GET / -> 200; GET /api/me -> {"user":null} (public, new code live).
   - GET /api/runs -> 401 {"error":"signin_required"} - THE GATE IS LIVE.
   - GET /api/auth/start -> 302 to accounts.google.com consent with client_id
     1055787127064-...apps.googleusercontent.com, redirect_uri=
     https://prospect-research.sam-5b1.workers.dev/api/auth/callback,
     scope=openid email, HMAC-signed state, prompt=select_account. (Note: HEAD
     requests 404 by route-table design; GET is the real path.)
   - GET /demo -> 307 to / for non-navigation fetches only; browser navigations
     get index.html from the assets layer with pathname intact (demo mode boots).
4. Pushed main: ef98752..cd1027d (6b7dd8a sign-in implementation + cd1027d
   progress).

OPERATOR STEP REMAINING (user, cannot be done from here): in the Google Cloud
console, add authorized redirect URI
https://prospect-research.sam-5b1.workers.dev/api/auth/callback
to the OAuth client (same client as Gmail sending). Until then, "Continue with
Google" ends at Google's redirect_uri_mismatch screen. After it is added:
sign in live, verify /api/me returns the user, and the gate becomes invisible.

## 2026-10-31 — Change control: research-loop spec v0.3 (research directive)

User approved the brief-composer proposal ("GO AHEAD. DO WHAT'S BEST") after the
504Yard investigation. specs/research-loop.md updated: status line v0.3 approved/
implementation pending; version history entry; new SS12.11 "Research directive":
the commercial brief gains a category sweep plan (named organisation categories,
buyer roles per category, one owner-checkable qualification artifact per row,
directory-grade rubric caps), composed alongside the brief, stored on the run;
discover sweeps per category; artifact-less candidates cap at manual_review,
never qualified. Rationale (one line): the 504Yard method (204 evidence-backed
prospects, zero duplicates, honest bands, 21 replies) proves brief-first
category sweeps with per-row verification artifacts beat generic ICP sweeps.
Prior spec text retained in git history (v0.2 text unchanged apart from the
status line; change noted in version history). Implementation: next batch.

## 2026-10-31 — Implemented: research directive v0.3 (the 504Yard method, commit 3aa8aff)

Spec SS12.11 implementation (approved change control same day):
- Brief composition now emits the research directive in the same model call:
  buildBriefGoal JSON shape gained directive.categories (2-6 buying-organisation
  categories, each with angle, buyer_roles, owner-checkable artifact,
  max_queries 1-3) + a directive rule line (buyer orgs only, never lookalike
  sellers or excluded verticals).
- Parsing degrades honestly: a malformed model directive is DROPPED, never
  throws (validateBrief -> parseDirective); ensureDirective() synthesizes a
  deterministic fallback from the validated brief (one category per primary
  industry <=4, the brief's buyer roles, standard artifact line, 2 queries
  each) so every run sweeps with an artifact rule. Applied at brief build
  (phases) and at hydration of legacy stored briefs (orchestrator) - existing
  runs get the directive without re-running the brief.
- discover sweeps per category: buildPlanGoal now instructs "sweep every
  directive category with at least one problem-led query, capped per category
  (name <=N)" when a directive exists; the legacy generic cover line remains
  for briefs without one. renderBriefPrompt carries the directive block (with
  artifacts) into every later burst (assess, draft, rationales).
- Artifact cap verified triple-enforced and pinned by tests: decideVerdict
  never returns qualified without a prospect-owned source (needs_research);
  rank's junk gate excludes directory-only evidence; needs_research/manual_review
  stay draftless per SS12.10. New tests pin all of it.

Verification (evidence): npx tsc --noEmit clean; npx vitest run 440/440 (was
427; +13 directive tests in tests/directive.test.ts); npm run smoke: SMOKE
PASS; pushed main 93ae351..3aa8aff.
Files: src/research/commercial.ts, src/research/phases.ts, src/orchestrator.ts,
tests/directive.test.ts (new).
Not yet deployed - deploy needs approval. First live directive-bearing run
should be compared against the pre-registered thresholds (>=80% qualified
in-segment, 0 hard violations, 100% qualified with prospect-owned source).
Next: on approval, deploy (same command as before), then run a live research
run to see directive-driven sweeps in action.

## 2026-10-31 — Deploy: research directive live (approved: "go ahead")

Worker version 8964f737-4c76-4449-864a-844feebe090b (100% traffic, created
2026-10-31T19:27:44Z). Live verification: GET / -> 200; GET /api/me ->
{"user":null}; GET /api/runs -> 401 signin_required (gate intact); GET
/api/auth/start -> 302 (OAuth start intact). Sign-in + directive code now
both live. Nothing else changed server-side; the directive engages on the
next research run's brief composition (and on hydration of stored briefs).

Pending for the first directive-driven live run (user steps, cannot be done
from here): 1) add authorized redirect URI
https://prospect-research.sam-5b1.workers.dev/api/auth/callback in the Google
console (if not already done); 2) sign in on the live site; 3) describe a
business and confirm the brief - the run then sweeps per directive category.
Afterwards: pull the run record from D1 and audit against pre-registered
thresholds (>=80% qualified in-segment, 0 hard violations, 100% qualified
with prospect-owned source) and report the model-spend running total.

## 2026-10-31 — Deploy: audit trail + /api navigation fix (user request before first run)

User added the Google redirect URI; before running, asked for a full audit
trail (all user input, functions called, data passed, output received) and
reported the auth page rendering as an unstyled app shell.

Root cause (auth page): browser NAVIGATIONS to non-asset paths were served
index.html by the assets SPA fallback WITHOUT running the Worker - so
/api/auth/start never reached its 302. Affected every /api navigation incl.
unsubscribe links in emails. Fixed in wrangler.jsonc with
assets.run_worker_first: ["/api/*"] (also enabled Workers Logs observability).

Audit trail (commit 20d0acb, migration 0006_audit_log, version 07f81545):
- D1 table audit_log (ts, kind, run_id, subject, summary, created_at; run+kind
  indexes).
- src/audit.ts: never-throws writer; redaction (authorization/api_key/token/
  secret/password/cookie/code/credential keys -> [redacted]) applied
  STRUCTURALLY - stringified JSON bodies (request payloads) are parsed and
  redacted before storage; bounded (2000-char strings, 20-item arrays,
  depth 6, 6KB summary).
- Instrumented: every /api/* request (method, path, status, duration, user
  email, query, request body, response head) incl. 401 gate rows and 500s
  with error; every model burst from meta.callResponses (phase, model, goal
  head, tool names, usage tokens, duration, output head, failures as
  model_error); auth events (signin_start, signin, signin_failed reasons,
  signout). run_id attached inside the Workflow. Secrets never stored: OAuth
  codes, session tokens, unsub tokens all redacted.

Verification (evidence): tsc clean; vitest 449/449 (+9 audit tests); SMOKE
PASS; migration 0006 applied remote (audit_log verified); deployed version
07f81545-c775-4b58-83f5-e6c2e5d25170; live checks: browser-like navigation
(Sec-Fetch-Mode: navigate) to /api/auth/start -> 302 to Google consent (bug
fixed), unsubscribe navigation -> 400 handler response (reached the Worker),
gate 401, /api/me 200; first live audit rows inspected in D1 showing
redaction working (query.token [redacted]).

Files: migrations/0006_audit_log.sql (new), src/audit.ts (new), src/index.ts,
src/meta.ts, src/workflow.ts, src/auth.ts, wrangler.jsonc,
tests/audit.test.ts (new). Pushed after this entry.
Limitation: audit rows count toward D1 storage; the api_request row caps
bodies at 3000 chars and response heads at 1200. Model-call rows do not
capture web_search result payloads (those persist as evidence rows already).
Next: user runs the first directive-driven research run; audit queryable via
D1 (SELECT * FROM audit_log ORDER BY id DESC).

## 2026-10-31 — First live run post-mortem + fixes (user request)

The user ran the first directive-driven research run and reported: "Stopped"
screen, retry doing nothing, budget showing zeros, and onboarding re-asking
name/area they had stated. The new audit trail made the post-mortem direct.

What actually happened (from audit_log + research_run):
- The run was NOT stopped early - it worked: plan produced directive-driven
  queries ("Allen Ikeja companies end of year party...", "Maryland Lagos
  corporate offices Christmas party outside vendors policy..."), 25
  candidates found, 20 pages opened, 21 DISQUALIFIED with correct rationales
  (directory pages, generic category labels, property listings, excluded
  caterers), searches budget fully spent 30/30 in sweep 1.
- Crash: the run shortlisted nobody -> ZERO drafts -> close() saw an empty
  draft list and returned stopped("awaiting_approval") -> orchestrator threw
  "close stopped: awaiting_approval" -> run marked FAILED. Root cause:
  draftGateDecision treated drafts.length===0 as "wait", while the pre-close
  gate loop treated zero undecided as "proceed".
- UI: runProgress rejected on the FIRST failed poll (one dropped request in
  ~600 latched the view to "Stopped"); Retry polled again but the onTick
  never cleared the latch, and the run later WAS failed - so retry always
  re-latched. The zero budget display was the early snapshot frozen by the
  latch.
- Onboarding re-ask: the model did not extract service_area from the owner's
  prose ("offices in Ikeja") and the product had NO channel for a stated
  business name (name was not an onboard field -> empty-name 400 -> the
  summary asked for the name).

Fixes (commit f424d33, deployed c3637dea-4bb4-4ea3-b7b3-833aa45cf44a):
- draftGateDecision([]) no longer waits; an empty draft list completes the
  run honestly. Test updated (it had pinned the bug).
- runProgress tolerates up to 3 consecutive failed polls; a live tick clears
  the Stopped latch (banner/error/retry reset). Progress stays alive through
  transient network blips.
- Onboarding: the model can return the stated business name (new "name" in
  the turn schema; app captures it so the summary never asks for a stated
  name); prose location capture seeds service_area from "offices in Ikeja"
  style phrasing when the model still asks for it (the precision backstop
  may still refine, showing the noted value).
- Sweep budget share: each QA sweep may spend at most an equal slice of the
  remaining search/fetch budget, so replans have real budget instead of
  sweep 1 draining 30/30.
- Repaired both crashed runs (run_27e246ba, run_5523632b) to status
  "complete" with honest stop_reason "empty shortlist: every candidate was
  set aside by the quality gates; adjust the brief and run again" (2 rows
  changed).

Verification: node --check ok; tsc clean; vitest 449/449; SMOKE PASS; live
checks root 200, gate 401; repaired run rows verified in D1.
Remaining observation (not fixed here): candidate quality upstream - queries
returned directory-heavy pages; the gates held the line (0 junk kept) but
the sweep-share fix gives replans room to find better veins. Watch the next
run's audit rows.

## 2026-11-01 — Run recovery: continue, never restart (user request)

User asked: the results page should let a user see where the research stopped
after bad network and CONTINUE to the drafts with all data remaining - not
retry or restart.

Gap fixed: the run id lived only in browser memory - a reload, closed tab, or
dead network orphaned the run (no way back except a new run, which re-spends
budget).

Implementation (commit 4fe0cf0, deployed 98b9248a-ffdc-44fa-912a-8e8ef7442d1c):
- GET /api/runs/latest: the operator's newest run + profile name (gated like
  every API; registered before /api/runs/:id so "latest" is not read as an id).
- Landing resume card (hidden until the boot check finds a resumable run):
  "Pick up where you left off - <Business> - <where the run is>" with
  Continue / Start fresh instead. Boot check runs after whoAmI (signed in,
  live, no run in flight); statuses created..awaiting_approval are resumable.
- Continue restores state.runId + profile from the server and opens the
  progress view with the existing poll (which resolves to the shortlist on
  approval/complete) - one path for every state, all data from D1, no new
  run, no budget re-spend. Within the progress page the existing navigation
  stays: Preview results so far, Stop and adjust my brief, Retry (now
  blip-tolerant), Start over.

Verification: node --check ok; tsc clean; vitest 452/452 (+3 recovery tests:
gated 401, newest run + profile name, run:null); SMOKE PASS; deployed; live
check: /api/runs/latest 401 signed out, root 200; latest run in D1 confirmed
(run_27e246ba, complete). Limitation: latest-run only (single-operator MVP) -
the card shows the most recent run, not a run list.

## 2026-11-01 — Browser MCP added (@latest) + tests (user request)

User installed the Browser MCP Chrome extension and asked to add
@browsermcp/mcp@latest and tests.

- Global OpenCode config had browsermcp pinned to the ancient
  @browsermcp/mcp@0.1.3 - updated to @browsermcp/mcp@latest (surgical text
  replace; backup at opencode.json.bak-browsermcp; browsermcp entry verified:
  type local, enabled, npx -y @browsermcp/mcp@latest). OpenCode needs a
  restart for the server to load; first browser-tool use triggers the
  six-digit pairing (click Allow in the extension popup).
- product: @browsermcp/mcp@2.3.0 installed as devDependency (commit 3cb98c8).
- Tests (tests/browsermcp.test.ts, 3 passing):
  1. installed package is the modern line (>= 2), never the 0.1.3 pin;
  2. global opencode.json wires browsermcp on @latest (skipIf config absent);
  3. the real binary speaks MCP over stdio: initialize -> serverInfo
     "Browser MCP" 2.3.0, tools/list -> the `browser` tool.
  Gotcha documented in the test: the server exits on stdin EOF - the client
  must hold the stream open or tools/list races shutdown (observed:
  initialize answered, then exit 0).

Verification: vitest 455/455; global config parse-verified. No product
runtime change (dev tooling only) - no deploy needed. Live-site note:
browsermcp.io says v2.0 extension + server only work together - if the
extension is still 1.x, update it (chrome://extensions -> Developer mode ->
Update) or the pair will refuse to connect.

## 2026-11-01 — 4 business profiles driven live via Browser MCP + budget-stop fix

User asked for a local trace file (input/process/output per model step, human-
readable) and to test 4 different business profiles across industries and
sectors, online and offline, via Browser MCP.

- Trace exporter: product/scripts/export-trace.mjs -> C:\Users\User\Videos\
  prospect-trace.md (outside the repo: runtime data never lives in the repo).
  Sections: runs overview, model steps (goal head -> output head, tokens,
  duration), full brief/plan/prospects/drafts for the newest run, owner input
  -> product response. Regenerated: 1639 lines.
- Browser MCP worked after pointing the global config at the local install.
  The extension bridge needed no pairing prompt (already allowed).
- 4 journeys driven through the user's signed-in Chrome (real flow: describe
  -> chat -> confirm -> run): PrintFlex NG (online print shop, nationwide),
  Choice Cleaners (cleaning, Ikeja), Little Steps Academy (school, Surulere),
  GlowMart Beauty (beauty retail, Instagram + Ikota shop). Onboarding behaved:
  name/area extracted from prose, no re-asks, followup cap held, resume card
  appeared on new tabs for the running run (recovery feature confirmed live).
- Run outcomes at report time: PrintFlex complete (16/30 searches, 25
  candidates, 20 disqualified, 0 drafts); Little Steps investigating;
  GlowMart created; Choice Cleaners FAILED on "investigate stopped:
  budget_fetches".
- FIX (commit 6542cc4, deployed 356874bb): budget stops are now NON-FATAL -
  the sweep loop catches "X stopped: budget_*" and proceeds to rank what
  exists (spec behaviour) instead of failing the run. The sweep share change
  had made mid-run budget stops normal, exposing the flaw. Test suite green
  (455/455) before push after two sloppy push-before-green corrections
  (browsermcp config test updated for the local wiring + windows paths).
- Note: cost_usd_est stays 0 - cost tracking not wired to usage yet.

## 2026-11-01 — Audit verdict + candidate-quality fix (user-approved)

Audit of the 4 live business profiles: PrintFlex NG + Little Steps Academy
completed end-to-end; Choice Cleaners + GlowMart died on the pre-fix budget
bug (their workflow instances predated the fix). Across 100 candidates:
ZERO keepers. The gates behaved correctly (0 hard violations, nothing junk
kept) but candidate EXTRACTION was the failure: search-result titles shipped
as business names ("Top Event Management Companies", "Our Services", "Our
Events Gallery", "More teachers needed in Lagos public schools", "Africa
Internet Group moves office to", "Araromi ... « HEYPLACES.COM.NG").

Fixes (3 commits, deployed 85962022):
- 31e440b: name-quality gate round 1 (numberless Top-roundups, "Our ..."
  section headings, gallery/careers page-type words) + plan-goal entity bias
  (queries must name a place + entity type + official site; careers/jobs/
  scrape shapes banned). Verified live: the re-run of Little Steps produced
  entity-biased queries ("...family support official site", "...association
  members events").
- 18cc886: round 2 (staffing-demand and office-move headlines, directory
  tails heyplaces, domain-in-name) with the brand+tld exception preserved
  (Supermart.ng keeps passing - pinned by test).
- Budget stops rank what exists (6542cc4, deployed 356874bb) from the
  Choice Cleaners post-mortem.

Verification: tsc clean; vitest 464/464 (+ name-quality suite); SMOKE PASS;
deployed; trace file regenerated (C:\Users\User\Videos\prospect-trace.md).
Little Steps re-run completed in ~5 min (23 disqualified, 2 investigating,
0 kept) - extraction still shipped headline junk through the round-1 gate,
which round 2 now closes. Next measurement: run a fresh profile and compare
keeper rate.

## 2026-11-01 — PrintFlex A/B with all gates: junk cut 55%, bottleneck moved to assess throughput

Controlled A/B: same PrintFlex NG brief re-run (baseline 2026-10-31: 16
searches, 25 candidates, 20 disqualified, 5 investigating, 0 kept). Re-run
(2026-11-01, all gates live): COMPLETE, 10 searches, 13 fetches, 25
candidates, 9 disqualified, 16 investigating, 0 drafts.

- Name gate working: junk candidates dropped 20 -> 9; real named entities now
  reach the pool (Landmark Events Centre, Korex Events, Omega Events,
  Eventful Nigeria Limited, Jemz Events - yesterday's run had almost none).
- Remaining junk shapes leak ("Event Managers in Nigeria, Wedding Planners
  and Coordinators", "Paystack x Stripe", "Company Formation", "Leading SME
  Brands") - further patterns needed.
- NEW bottleneck: assess throughput. 16 candidates investigated but only 9
  assessed before the fetch budget stopped; budget-stop fix correctly ranked
  what existed (run completed instead of failing) but 0 shortlisted -> 0
  drafts. Little Steps round-1 re-run also completed: 0 keepers (round-1
  gate only).
- Browser MCP note: the extension disconnected mid-journey once ("No browser
  is connected") after a server restart; reconnecting needed a new session.
  The confirm click lost in that gap did NOT create a run - re-driven.
Next levers (need decision): raise fetch caps (40 -> 60?) so assess finishes;
or assess-on-snippets for investigated-but-unassessed candidates at rank;
or more round-2 name patterns.

## 2026-11-01 — Budget headroom raised; FIRST END-TO-END KEEPER (user: "let budget not be in the way")

Owner directive: budget must not constrain runs. Fixed three things
(commit b458f86, deployed 2d0d36de):
- DEFAULT_CAPS raised: searches 30->40, fetches 40->80, candidates 25->30.
- THE ROOT BLOCKER: postRun hardcoded budgets {30,40,25} in the run row -
  DEFAULT_CAPS was never consulted. Runs now write budgets from DEFAULT_CAPS.
- Sweep share: each sweep may spend up to HALF of what remains (was equal
  thirds) so sweep 1 has real room for investigate+assess.

Measured with Choice Cleaners (the run that had never finished): status
awaiting_approval - the first run to reach the drafts gate. 30 candidates,
28 disqualified (gates strict), 1 shortlisted WITH a draft awaiting approval:
"Duban International Hotel" - subject "Post-event / next-morning cleaning for
your Ogba hall" - a real venue with a grounded use case. Keeper rate 0 -> 1/30.

Verification: tsc clean, vitest 464/464, SMOKE PASS, deployed, caps verified
in the live run row (40/80/30). Trace file regenerated.

## 2026-11-01 — Evidence panel rebuilt: accordions, humanized history, real proof (user UX critique)

User flagged the old panel (raw "created - <ISO> dedupe merge" lines, bare
channel/date/note fields, unclear evidence) and asked for accordions +
504Yard-style logging. Rebuilt (4 commits: c057527, 61877fc, 5a18ee7,
+ quote clamp; deployed 947cc943/d3d82ca4):
- Native <details> accordions: "Why <name> was shortlisted" (open),
  "History", with the contact-log form inside History.
- Proof rows: claim + humanized source ("their own page"/"search result" +
  host link). ROOT FIX: the detail route filtered evidence to
  assessment-linked rows only, hiding discovery proof (prospect.evidence_ids
  was never consulted) - every shortlisted pick rendered an empty panel.
  Discovery evidence now included.
- History humanized: event labels (Added/Shortlisted/Merged with duplicate...),
  medium+short timestamps (no seconds), channel rows labeled (WhatsApp/Email/
  Phone call...), tidy labeled log form.
- Card location de-duplicated ("Ikeja, Maryland, Ogba and Oregun, Lagos,
  Nigeria" instead of repeated "Lagos, Nigeria" chains); hint de-duplicated
  ("The research behind this pick:"); long page quotes clamped; sticky
  selection bar no longer covers the panel (clearance added).
Verified live in the owner's Chrome via Browser MCP on the Duban
International Hotel shortlist (screenshots reviewed, 2-image budget).
Evidence: 464/446->464/464 vitest, SMOKE PASS each deploy.

## 2026-11-01 — Full contact set per lead (user request: socials, emails, phones, persons)

User asked for Instagram/Facebook/Twitter/LinkedIn/website/email/phone AND
contact persons per lead. Built (commits b07a279 + 6dfa40f, deployed
e36dd067/111f775b, migration 0007 applied remote):
- Extraction: the assess burst now extracts contacts from evidence — social
  profile urls (instagram/facebook/x/twitter/linkedin/tiktok) and the named
  contact person + role — grounded in code (the url must appear verbatim in
  the prospect's own evidence text; protocol-stripped match).
- Storage: socials saved as contact_route (channel social_profile,
  verification unchecked — published, never confirmed); contact person stored
  on prospect (contact_name/contact_title, migration 0007), never overwriting
  owner-set names.
- Owner edit: POST /api/prospects/:id/contact-person (owner-provided beats
  extraction; 504Yard "type it there" pattern).
- UI: Reach out accordion (first, open) in the evidence panel — Contact
  person row (extracted or "Not named yet" + inline name/role edit + Save),
  then every route as a chip row (Email/Phone/Instagram/... network parsed
  from the url) with verification state and Copy buttons.
- Cache bug found live: getEvidence memoized responses, so a saved contact
  person showed "Not named yet" until reload — cache now invalidated on
  setContactPerson and logContact.
Verified live in the owner's Chrome: saved "Funmi Adeleke, Reservations
Manager" on Duban International Hotel (audit row: POST 200, input+output
captured), Reach out panel rendering all routes with Copy. Existing leads
gain socials on their next assess pass.

## 2026-11-01 — Manual WhatsApp send verified live; emoji-loss ROOT CAUSE found and fixed

User: WhatsApp is manual (click per lead, opens the app), must respect
WhatsApp vs WhatsApp Business on the device, and must not lose emoji in
transit - see 504Yard. Built (46d209e) and verified in the owner's Chrome:
- Message studio WhatsApp tab: "Send now, by hand" card - app selector
  Auto/WhatsApp/WhatsApp Business (intent:// package dispatch com.whatsapp /
  com.whatsapp.w4b, saved per device in localStorage), Open WhatsApp buttons
  per phone route (multi-number up to 4), landline + unverified guards
  (504Yard heuristics), greeting personalisation from the lead's contact
  person, contact logged on open. Email tab: mailto with subject+body.
  DM tab: opens their social profile.
- Verified live: studio -> WhatsApp tab -> Open WhatsApp -> unverified
  confirm -> contact logged (audit row 201) -> WhatsApp handoff.

Emoji ROOT CAUSE (measured, not assumed): wa.me's own redirect MANGLES
emoji - request with correct %F0%9F%94%A5 came back 302 with
text=...%EF%BF%BD... (replacement chars) on api.whatsapp.com. Fix (8b459e4,
deployed 0e14ce52): waUrl() now builds on api.whatsapp.com/send/?phone=...&text=...
which PRESERVES emoji (verified end-to-end live: the page URL carries
%F0%9F%94%A5 intact and hands off to the app). NOTE: 504Yard's manager app
uses wa.me and has the same emoji bug - the fix is portable there.
Smoke gained the wa send-stack assertions (number normalisation, emoji
encoding via codepoint-built literals, per-app intents, endpoint choice);
464/464 vitest, SMOKE PASS.

## 2026-11-01 — Emoji fix CONFIRMED in the owner's real WhatsApp; test-message incident + guard

The owner sent a screenshot of WhatsApp Desktop (chat with Duban
International Hotel): the four earlier wa.me-path test messages arrived
MANGLED (replacement chars) while the api.whatsapp.com-path message arrived
INTACT ("Quick test 🔥 emoji survives") - the emoji fix is confirmed in the
real app, not just in tests.

Incident: the garbled test prefills reached a REAL prospect (some were sent
from the compose window). A recovery note was handed to the owner to send at
their discretion. Guard added so this cannot recur (commit 4279c7f, deployed
25e8d7a6): the studio send card now has "Test on yourself first" - the owner
enters THEIR OWN number and the message opens on their WhatsApp; tests never
touch the lead and are never auto-logged.
Verification: 464/464 vitest, SMOKE PASS, deployed.

## 2026-11-01 — Studio text fixes (user critique): citations leak, dead-end tabs, verdict codes

User flagged: [source 1] placeholder visible in the WhatsApp message; "No
whatsapp version for this pick" confusing (a send block existed below); raw
verdict code "[verdict: no_signal ...]" in the hypothesis; broken punctuation
("Road Ogba ."). Fixes (commit 063fd88, deployed 57c851a6):
- cleanCitations: provenance markers ([source N]) are audit-only - stripped
  from display, editor, and the sent/mailed message (stored draft keeps its
  linkage via supporting_ids; editDraft never required the marker).
- One message, every channel: off-channel tabs show the same draft labelled
  "The research wrote this as a <channel> message - it reads fine here too"
  instead of a dead end.
- verdictHuman: verdict codes translated (no_signal -> "Good fit - no dated
  buying signal yet, so a patient introduction is suggested."); raw
  "[verdict: ...]" stripped from the hypothesis; a friendly status chip
  shown instead.
- tidyProse: no space before punctuation, comma after Road/Street before a
  place name ("Ogunnusi Road, Ogba."), double spaces collapsed - applied to
  evidence quotes and hypotheses (business names protected: "Airport Road
  Hotel" keeps no comma).
- WhatsApp-aware length guidance (<=60 words good; >100 "cut to the point").
Verified: 464/464 vitest, SMOKE PASS (new assertions: same-message tab,
no citation markers render, tidyProse exactly on the user's example).

## 2026-11-01 — Per-channel draft versions + social harvest from the crawl (user request)

User asked: generate WhatsApp, Email and DM (Instagram/TikTok) versions per
lead (not one long message for every tab), and harvest the lead's social
profile links when their website is crawled, shown with links.

Built (commit 60449e0, deployed 9c27e4c4, migration 0008 applied remote):
- Draft variants: the draft burst now writes three shapes per shortlisted
  lead — WhatsApp (<=60 words, casual, greeting by name), Email (<=120 words,
  professional), DM (<=35 words, ultra casual for Instagram/TikTok) — stored
  on the draft (outreach_draft.variants JSON, migration 0008). The studio
  renders the variant for the active tab; editing a tab edits that variant
  (decide endpoint accepts {variant, variant_body} -> updateDraftVariant);
  the send buttons use the active tab's version. Demo drafts carry a
  WhatsApp variant for judges; a missing variant falls back to the shared
  message with an honest label.
- Social harvest: meta.fetchPage now scans the crawled page's raw HTML for
  instagram/facebook/x/twitter/linkedin/tiktok profile links and returns
  them; investigate stores each as a social_profile contact_route
  (verification unchecked, deduped by value) — grounded by construction
  (they come from the lead's own site). The Reach out panel lists them as
  linked chips (Instagram/Facebook/X/LinkedIn/TikTok parsed from the url).
Verification: tsc clean; 464/464 vitest (one fetchPage shape test updated);
SMOKE PASS (demo WhatsApp variant asserted); deployed; push.

## 2026-11-02 — Dashboard navigation (user: "how do I navigate to my dashboard")

The shortlist and drafts views were chromeless - no way back to the status
board, campaigns or senders. Fixed (commit 7d9dd6c, deployed 9648a3e6):
- The step rail (1. Onboard ... 8. Senders) now shows on shortlist and drafts
  too, with the current stage highlighted and Sign in/out in the header.
- Every step is CLICKABLE and jumps to what the app can render right now:
  Status board / Campaigns / Senders render on demand; Shortlist/Drafts/
  Progress jump only when their data is loaded; Onboarding restarts only
  when no run is in flight. Smoke asserts the rail on the shortlist
  (header stub added to the smoke DOM) and the senders click is wired in the
  real handler.
Verification: 464/464 vitest, SMOKE PASS, deployed, push.

## 2026-11-02 — Dashboard everywhere + smart resume (user flow review)

User: "how do I go to dashboard from here" / "as a signed in user, I only saw
continue" / "for Duban, messages were already written, why take me to #4
shortlist where I have to click write message again". Fixes (commit 7cd30fd,
deployed 1fa67ac8):

- Dashboard entry on every screen: header button (full views), slim dash-bar
  on onboard/profile/progress (Sign in there when signed out), Dashboard link
  in the landing nav when signed in. Step 6 renamed "6. Dashboard"; the view
  heading is now "Your dashboard".
- Post-sign-in return goes to the owner's home, not the marketing page:
  /api/auth/callback redirects to /?dash=1; boot opens the dashboard (status
  board hydrated from the latest run via getShortlist + getDrafts). No run yet
  for a fresh account -> stays on the landing.
- Smart resume: pollProgress terminal in live mode checks getDrafts first -
  if messages exist it lands straight in the drafts studio; empty/failed
  draft fetch falls back to the shortlist. Demo keeps its teaching flow
  (shortlist -> Write my messages).
- Resume card button names the destination: "Open my messages" when the run
  is awaiting_approval, else "Continue".

Verification: SMOKE PASS with new pins (bar hidden on landing, bar visible on
progress view, header Dashboard opens the board, rail click jumps stages);
464/464 vitest; no migration in this batch.

## 2026-11-02 — Sidebar shell + dashboard revamp + human campaigns (user flow review, round 2)

User: dashboard was wrongly a numbered step; wanted a left sidebar like normal
apps; campaigns listed raw cmp_ ids, ISO stamps and provider words; dashboard
should look like the landing (paper theme, vibrant, easy on the eyes); nav
links must not be filled pills. Fixes (commit ad61cde, deployed 2d173918):

- App shell rebuilt: LEFT SIDEBAR is the app navigation (Dashboard, Messages,
  Campaigns, Senders + account at the bottom), hidden only on the landing and
  sign-in screens; collapses to a top bar under 880px.
- The 1-8 step rail is gone. A campaign's five stages (Onboard, Confirm
  profile, Research run, Shortlist, Messages) live in a contextual "This
  campaign" strip shown only while a campaign is in play; still clickable to
  revisit what was done. Stages are a trail, not navigation.
- Nav links are quiet (text rows, hover surface) per platform convention;
  filled buttons reserved for a screen's primary action. Landing Dashboard
  link reset to quiet text (button UA styles neutralized).
- Dashboard revamp on the landing tokens: white cards on the paper ground,
  one calm accent stripe per column (success/pending accent/marigold/warn),
  rounded 16px, soft shadows, human empty copy ("Open Messages and approve
  one"), board subtitle "Nothing sends without your approval."
- Campaigns humanized: no internal ids, no ISO stamps (cleanTime), states in
  the owner's words (Went out / Scheduled / Going out now / Failed; waiting,
  not queued; provider errors become "the mail provider was unreachable");
  schedule confirmation shows the send time in the owner's clock too.

Verification: SMOKE PASS with new pins (sidebar hidden on landing, sidebar +
stage strip on progress/shortlist, sidebar Dashboard opens the board, no stage
strip on the dashboard, campaigns hide ids/ISO/queued); 464/464 vitest; no
migration in this batch.

## 2026-11-02 — Campaign model alignment + board detail doors + naming (round 3)

User: "a campaign is the beginning of any new prospect research from describing
the business... like a word document, resume/follow up, send out messages".
Also: board column items should open the message detail; "Senders" is jargon;
review copy/nav per the 10 heuristics; mind mobile. Fixes (commit d31425b,
deployed ccca4b36):

- Campaigns view rebuilt around the engagement: "Your campaigns" now shows a
  Current campaign card (name, human status, started date, Open messages /
  Continue research / Retry + Start another campaign), then "Schedule a send"
  (the wizard, now drafts-first: N messages waiting for review -> Open
  messages instead of a dead end), then "Email sends" (the humanized monitor,
  moved off the dashboard so the board stays pure message states).
- The run is the campaign: status map gained complete/failed human states;
  no raw status codes anywhere.
- Board items (Approved/Pending/Deferred/Rejected/Follow-ups) are buttons
  that open that lead's message in the studio, focused on the exact draft
  (openDraftFor; direct focus when the studio is built, refetch on cold boot).
- Naming sweep: Senders -> "Email accounts" (sidebar + page + copy, Google's
  "send mail as" convention); "Email campaigns" monitor -> "Email sends";
  "Schedule a campaign" -> "Schedule a send"; "Start over (new business)" ->
  "Start a new campaign"; wizard "Sender" -> "Send from"; "Connect a sender"
  -> "Connect an email account".
- Responsive: board columns now auto-fit (minmax 13.5rem) so 5 columns wrap
  naturally at every width; existing 800px/480px breakpoints kept; touch
  targets preserved.

Verification: SMOKE PASS (board is pure message states + doors pin, sends
monitor pins moved to the Campaigns view incl. no ids/ISO/queued, campaign
card hidden in demo), 464/464 vitest; no migration in this batch.

## 2026-11-02 — One-click channel tune for legacy drafts (user: why is Duban's WhatsApp message still long)

User asked whether the shortening applies to the already-written Duban draft,
or whether a new campaign/re-click is needed. Answer shipped (commit 6690a0e,
deployed a63f38a6): neither - a stored draft can now be tightened in place.

- New endpoint POST /api/drafts/:id/retune {channel}: loads the undecided
  draft, calls the model (muse-spark-1.3, audited) with the channel's shape
  (WhatsApp <=60 words casual; Email <=120; DM <=35), stores the result via
  updateDraftVariant (same guardrails: <=2000 chars, undecided only).
- Studio: on any tab missing a per-channel variant (legacy drafts), the
  honest label now carries a "Write the <channel> version" button; clicking
  writes the variant in place with a busy state and honest failure text.
  New drafts already get all three shapes at writing time.
- Client: RealApi.retuneDraft (parses the stored variants JSON) +
  MockApi.retuneDraft (canned tightened texts).

Verification: tsc clean; SMOKE PASS with new pins (missing version honestly
labelled, one-click write offered, written version renders in place);
464/464 vitest; no migration in this batch.

## 2026-11-02 — Scheduler data fix + scale + loading honesty (user: empty message box, 200 recipients?, a minute of "Loading...")

User: the scheduler's Subject/Message boxes were empty though an email version
existed; names should be real, not generic; what happens at 200 recipients;
and the page sat on bare "Loading..." for about a minute. Fixes (commit
e5286ad, deployed da2435ef):

- Root cause of the empty boxes: the wizard read `approved[i].draft`, a field
  that does not exist on draft rows (subject/body are top-level), so the
  fallback was `{}`; it also ignored the approved EMAIL variant. Now subject
  and body fall back through every honest source and the send uses
  variants.email when present - each recipient keeps their own approved,
  personalized message.
- Scale: recipients are collapsed rows (name + address visible, tap to open
  the full To/Subject/Message editor, first row open), paginated 20 per page
  with an honest pager; page edits fold into state before navigation and
  before scheduling. 200 recipients = 10 tidy pages, not 200 textareas.
- Loading: one loadingHint helper (spinner dot, then "Still loading - check
  your connection and reload" after 6s) applied to the campaign card, the
  scheduler, the sends monitor and the schedule submit; connections and
  per-lead details now load in parallel instead of serially.

Note (no code change): WhatsApp only opens when its own send button is
pressed (manual send by design); the approve path contains no window.open.

Verification: tsc clean; SMOKE PASS with new pins (recipient rows show real
names; message arrives pre-filled, never empty); 464/464 vitest; no
migration in this batch.

## 2026-11-03 — SEO + social sharing preview (user: WhatsApp/social link cards, icons, copies)

User: fix SEO, meta tags and the link preview when sharing on WhatsApp and
social media; proper icons, images and copies. Shipped (commit f69e761,
deployed 0cdef096):

- Branded OG image (public/og.png, 1200x630 PNG, 113KB) built in the landing
  design language: paper ground, gold mark, Fraunces headline "Know who will
  buy before you say hello." with the ultramarine "buy", sub copy and three
  promise chips. Rendered from HTML via headless Chromium and verified.
- Full head meta set: description, canonical, OG (type/site_name/url/title/
  description/image + width/height/alt/locale en_GB), Twitter
  summary_large_image card, apple-touch-icon.png (180x180), theme-color.
  All preview URLs absolute (WhatsApp cannot resolve relative or SVG).
- robots.txt (allow all, /api/ disallowed) + sitemap.xml with the canonical
  URL + JSON-LD WebApplication structured data.

Verification: PNG dimensions confirmed from the file headers; SMOKE PASS;
live checks: og:title/og:image/twitter:card/canonical present in the served
HTML, /og.png 200 image/png 112831 bytes, /robots.txt 200; pushed.
## 2026-11-03 (mobile UX + the "0 buyers" root cause + orchestration)

User reports (odidimary407@gmail.com, Kiddies thrift by Arinastores): mobile
UI poor; "Sign in"/"Sign out" breaking; shortlist flashed "No buyers worth
your time" then filled; junk names (admin, Lagos Events Calendar, listicles)
on the board; and the thrift search ended 0.

Root cause (verified in D1 run_e525ec91): all 30 prospects disqualified,
fit 1. The brief set target industries to "Consumer Households - Parents of
Young Children" (B2C seller, B2B-shaped prompts), so qualification demanded
each prospect BE a household; the planner grasped at family venues/pages;
discovery ingested search-result page TITLES as businesses (no gate); the
QA replan prompt was a thin ad-hoc goal, so sweep-2 pulled junk. Second live
run ("Mb declutter") same shape, still mid-flight on old code.

Orchestration (user direction: delegate, QA judges but never searches):
QA stays a deterministic judge; its report (good/junk counts + first 5 junk
and good NAMES) now feeds the ORIGINAL buildPlanGoal prompt (complete
prompt, same family that planned sweep 1) - planMore rebuilt on it.
investigate/assess remain the crawl+contacts specialists; the ingest gate
protects their handoff.

- commercial.ts: Consumer-buyers rule (hard) in buildBriefGoal - consumers
  as buyers means prospects are the organizations that supply/host/reach
  them, industries never name people; buildPlanGoal + buildSearchGoal carry
  the same lens + "every result is one namable organization".
- phases.ts: plausibleBusinessName() ingest gate (listicles, calendars,
  directories, forms, single generic words) - discover skips non-plausible
  names, evidence rows kept; runQuality now returns goodNames/junkNames.
- meta.ts: assess scores prospects as ROUTES (bulk/carry/host/refer); draft
  frames the ask as partnership for consumer-buyer briefs.
- app.js: shortlist gate - progress card until a fetch lands; mid-run only
  the explicitly opened "Preview results so far" peek shows a labeled list;
  honest zero only for a parked run ("Nothing worth your time yet." +
  widen/redo guidance); runStatus tracked from snapshot + campaign card.
- index.html: stage trail unnumbered (Onboard / Confirm profile / ...);
  mobile ob-head brand pair hidden (top bar already brands).
- styles.css: mobile ob-head keeps only "Save and exit" right-aligned.
- tests: plausibleBusinessName suite (real junk names from the run),
  runQuality name-arrays pin, consumer-rule prompt pin; browsermcp config
  test updated for OpenCode's new mcp.servers shape.

Verification: 468/468 vitest, SMOKE PASS, tsc clean; deployed f949f7ce
(push d510c9a). Live 390px: brand + chip (ellipsized) + Sign out on one
row, all 4 nav items visible, no overflow at 360px, ob-brand hidden, trail
unnumbered (DOM-verified + one screenshot).

Unresolved: (1) old runs keep pre-deploy logic - a FRESH search is needed
to see the new behavior; (2) run_ca31bc9f (Mb declutter) still mid-flight
on old prompts - recommend Retry research once it stops; (3) OpenCode
global config shape changed on this machine (mcp.servers) - test updated
to accept both shapes.
## 2026-11-03 (fail-proof runs + synchronized retry + memory feeds + mobile shell)

User direction: server+client keep synchronized state so retry never starts
from the absolute beginning nor regenerates junk; feed the model memory when
the circumstance demands it; mobile first-viewport must carry the status.

ArinaFoods run_dc346818 diagnosis: FAILED on meta_http_504 (one transient
model timeout) with 29 prospects + 20 searches persisted; junk leaked past
ingest gate v1 (list pages, "The big list of...", bare domains, all-generic
category names).

Synchronized state (server):
- research_run.plan now carries a done_queries ledger; discover skips
  searched queries and persists after each one (zero-result queries too) -
  a retry continues at the first unsearched query, never from zero.
- plan phase skipped when a stored plan has queries (restarted runs keep
  their plan and everything else).
- RUN_TRANSITIONS: stopped/failed -> created allowed; postResume starts a
  FRESH workflow instance over the SAME run state (workflow_instance_id
  updated; rollback on start failure). Client "Retry research" and
  btn-retry-progress call POST /api/runs/:id/resume (RealApi.resumeRun).
- callResponses: in-call transient retry (429/5xx/timeout, 2s/8s, injectable
  for tests); Workflow STEP_RETRIES raised to limit 5 x 20s exponential.
- assess already resume-safe (targets = investigating only).

Memory feeds (circumstance-gated):
- search bursts receive the run's found names (<=15) - steer to NEW orgs.
- renderBriefPrompt carries owner's own user_fact/source_verified words
  (<=3) so assess and drafts quote the owner's truth.
- replan already carries brief + QA report + junk/good names (previous turn).
- onboard: ASSUME-NEVER-ASK - decision_maker/order_size/budget/timeline are
  never questions (deterministic validator strips them; decision_maker
  defaults to "the owner decides purchases" as an editable assumption).

Client resilience:
- runProgress polls back off 1.5s->15s, reset on success, ~2min floor;
  offline banner (#net-banner) + online resync + 10s heartbeat snapshot.
- shortlist gate from the earlier turn unchanged.

Mobile shell:
- sb-nav becomes a fixed bottom icon tab bar (inline SVGs, 0.62rem labels),
  shortlist sticky bar raised above it; stage trail = one scrollable row
  (scroll container on the nav; page never overflows - verified scrollW=390).
- progress view: stats stay 3-up inline on phones, .view h2 shrunk to
  1.45rem, ob-head brand pair hidden everywhere on mobile.
- interview fonts: #ob-question 1.35rem/800 (display font stays on the
  landing hero), #ob-first h2 clamp down to 2rem.

Verification: 473/473 vitest (ledger-resume test, known-names memory test,
ArinaFoods gate cases, never-ask strip cases), SMOKE PASS, tsc clean;
deployed d5710240 (pushes b365097, 0168e56). Live 390px: progress eyebrow
at y=61, stats 3-up at y=200, steps at y=296 (first viewport), brand hidden,
fixed bottom bar, overflowX false. Known limit: runs started BEFORE this
deploy have no ledger - a retry re-walks remaining queries with dedupe
convergence; fresh runs resume true.
## 2026-11-03 (location loop killed: use its senses + network geo context)

User: the interview asked "Where are you based..." even AFTER answering -
the location-precision backstop (needsLocationDisambiguation: fewer than
two comma parts) fired EVERY turn on bare/naturally-phrased answers, and
the model could overwrite a fuller value with a bare re-extraction.

Fixes (owner direction: "use its senses - Ikeja IS Lagos"; add network
context to what it knows):
- needsLocationDisambiguation: any word from a Nigerian states+areas set
  completes the place ("Ikeja", "Ikeja Lagos" without a comma, "Lekki
  Phase 1") - no ask. Only a truly unknown bare token asks.
- The refine ask is capped AT MOST ONCE per interview (marker label
  "location-asked" rides in the returned fields).
- Network geo context (free): req.cf city/region/country is passed to the
  onboard model as silent context - "Ikeja" + a Lagos/Nigeria request
  becomes "Ikeja, Lagos, Nigeria" in service_area; the model stores the
  completed form and never mentions the context. Absent in tests.
- No-downgrade merge: a fuller/already-refined service_area never loses
  parts to a bare model re-extraction.
- Model prompt: complete places you can place on a map; "area, city" is a
  COMPLETE service_area (country never worth a follow-up).

Verification: 474/474 vitest (route tests rewritten to the new rule: known
area accepted, unknown token asks exactly once, model re-ask suppressed),
SMOKE PASS, tsc clean; deployed b93c8cfd (push 7cf86ac).
## 2026-11-03 (dashboard shows unfinished work)

User: a crashed run left the dashboard with only empty columns - no trace
of the work in flight ("be able to see unfinished works").

- view-status gains #run-banner, rendered from GET /api/runs/latest on
  every dashboard render: mid-run -> "Still working - <name> is <stage>"
  + Continue research (poll); failed -> "Unfinished campaign - stopped
  early, everything it found is saved" + Continue research (resumeRun to
  created: the synchronized same-run restart); awaiting_approval ->
  "Waiting for you" + Open my messages. Complete runs hide the banner.
- onBoardClick handles resume-run / open-messages; sets state.runId from
  the banner run before continuing.
- CSS: .run-banner with state-colored left stripe (accent/marigold/
  success); smoke IDS registers run-banner.
- Known limit (flagged): /api/runs/latest is the global latest - runs
  carry no operator column; fine for the current single-operator demo,
  must be scoped before true multi-user.

Verification: 474/474 vitest, SMOKE PASS (banner id registered), tsc
clean; deployed eb2acd03 (push 11b0136). The failed ArinaFoods run will
now appear on that user's dashboard with a working Continue button.
## 2026-11-03 (real URL paths + banner click fix)

User: "Continue research" on the dashboard banner did nothing; and the app
should have URL paths with per-path auth handling, not a pathless SPA.

- Banner bug: the buttons live in #run-banner but onBoardClick was bound
  only to #status-board - clicks never reached the handler. The banner now
  has its own listener wired to the same handler.
- Real paths (owner requirement): /dashboard /messages /campaigns
  /accounts /progress /shortlist /onboard.
  Server: each path is a real handler - auth session checked first
  (unauthenticated -> 302 to /?next=<path>), then the app shell is served.
  Client: showView pushes the path (history.pushState), popstate re-renders
  with data (routeToView: dashboard loads board+banner, messages loads the
  studio or falls back to the dashboard, etc.), boot routes a deep-linked
  path straight into its view, and ?next lands the post-sign-in visitor on
  their destination. Demo keeps /demo (no pushes there - a reload must
  stay in demo).
- Tests: user_session added to the mock D1 tables; sha256Hex exported from
  auth for session seeding; three new route tests (redirect with ?next,
  shell for a session, all seven paths 200).

Verification: 477/477 vitest, SMOKE PASS, tsc clean, node --check; deployed
d761b901 (push 9c38b2f).
## 2026-11-03 (flow fixes + sender authority)

User (with screenshot): Continue/finish auto-jumped to Messages; Messages
opened straight into "message 1 of 1: your note to CoWorkX"; the shortlist
rendered flat-empty static markup; and Email accounts showed the owner's
connected email to EVERY user ("that one I use. That is me personally.
People should not be able to use that email to send out to everybody").

Flow (owner direction: never auto-go to messages; show the shortlist):
- pollProgress no longer auto-lands in the drafts studio on run completion
  (supersedes the 2026-11-02 Duban auto-land) - it lands on the shortlist.
- Messages opens as an OVERVIEW: every message as a row (lead, decision
  pill, first-line preview, Open) - clicking a row opens the pager. Board
  items still jump straight to that lead's message (overview=false).
- Shortlist deep-link/stage-pill now always fetch-then-render
  (previewProgress), so the static zero markup can never show.
- Zero-state explains the picture: "We checked N businesses and set M
  aside. The Evidence panel shows why."

Sender authority (migration 0009 + code):
- sender_connection.owner_email (backfilled to samdoxiso@gmail.com - the
  owner's own accounts; d1_migrations ledger seeded for 0002-0008, which
  had been applied raw and unrecorded).
- Session email threaded through dispatchApi into delivery handlers.
- getConnections lists ONLY the owner's connections; create stamps the
  owner; verify/disconnect gated; campaign create/patch/approve refuse a
  connection the caller does not own (403 not_your_connection) - the send
  authority sits with the connection's owner.
- Test gate now RESOLVES a session under __PR_SKIP_SIGNIN__ (skip skips
  the rejection, not the resolution) so ownership is visible in tests.
- Known follow-up: campaign rows themselves carry no owner column - list
  scoping for campaigns is next; the send gate is the authority fix asked
  for today.

Verification: 478/478 vitest (sender-ownership route test), SMOKE PASS
(new pins: overview-first studio, row opens the pager), tsc clean;
deployed f014293b (push 07d6b0f).
## 2026-11-03 (interview senses: chips, website mining, no leaks)

User test (TechAssembly: "we build website and app" + their site URL):
chip clicks advanced the interview (no multi-select); the site was given
but the interview still asked the business name; the summary showed
"Buyer: the owner decides purchases | startups and small businesses"; the
shortlist showed one dead-end card ("First Concepts", unclassified, no
route, rationale cut mid-word "no reachable o...") and a "No draft yet"
dead end; the decision-maker assumption had pattern-matched into the
assessment rationale.

Root causes + fixes:
- THE POISON: RealApi.createProfile built target_market as
  [decision_maker, ideal_customer].join(" | ") - the assumption leaked
  into buyers, then into the brief's "Buyers:" line, and assessments
  pattern-matched prospects against "the owner decides purchases".
  Buyers are q5 (ideal_customer) ONLY; the decision-maker default no
  longer injects into the field dict at all (stripped question leaves the
  field empty; the brief's strategist rule carries "owner decides" as an
  assumption, never a buyer_role/industry).
- Chips are multi-select (owner direction): a chip ADDS to the input
  (comma-append, duplicates collapse) and never advances; Continue stays
  the owner's move. Demo mock teaches one chips question (exclusions).
- Website auto-mining: a URL in the owner's reply is fetched server-side
  (fetchPage, best-effort) and handed to the model: "MINE IT FIRST -
  fill name/offer/buyers/area from the page; asking for what the site
  answers is forbidden" (OnboardTurnInput.site).
- Rationales clip at a WORD boundary (clipAt) - "no reachable o..." gone.
- Routeless prospects with no draft-bearing status are off the shortlist
  (dead ends don't belong on "buyers worth your time"); the zero-state
  counts them: "set N aside (K with no way to reach them yet)".
- Demo profile Buyer reads q5; empty profile rows hidden from the summary.

Testing loop (user: "test, loop n use playwright until it works"): smoke
rewritten for the new interview (exclusions chips, append pins, retry
survival, done-by-assumptions) + demo fixture Northgate given a route;
browser loop on live /demo verified: chips append live ("Competitors,
Franchises", no advance), interview ends by assumptions, summary clean
(Business stated / Offer stated / no decision-maker noise, no empty
assumed rows).

Verification: 478/478 vitest, SMOKE PASS, tsc clean; deployed 20688517
(push c7d9e84). Next live check: run a fresh TechAssembly-style campaign -
the site mining + clean brief should fill the summary from the site and
qualify real web-dev buyers.
## 2026-11-03 (run view stays put + drafts never dead-end + select-all)

User: clicking "Research run" yanked them to the shortlist; picking 4
prospects and hitting "Write my messages" dead-ended ("No draft yet...
The research did not write one"); the shortlist lacked select-all.

- The run view STAYS PUT: pollProgress(autoLand) — deliberate Continue
  flows land on the results, but navigating to "Research run" (pill,
  /progress deep link) never yanks; the run view gains "Everything we
  found" (name + human status badge + category/area, live-filled from a
  light /prospects fetch on every tick) + a See-the-shortlist CTA.
- Drafts for everyone reachable: draft() now targets all non-disqualified
  prospects that own a contact route (not just rank-shortlisted), with an
  optional onlyIds scope. New route POST /api/runs/:id/draft-missing runs
  it on demand while the run is parked; the studio's "No draft yet for..."
  note now carries a "Write their messages now" button that calls it and
  re-renders.
- Select all / Clear on the shortlist sticky bar (ticks visible rows,
  updates the count, label flips).
- Smoke: new ids registered; pins updated for the note-as-html (FakeEl
  keeps textContent/innerHTML independent) and the overview flow.

Verification: 478/478 vitest, SMOKE PASS, tsc clean; deployed e367cd19
(push 68f8f76). Still open from the perf direction: directory explosion,
parallel queries/fetches, caps raise, per-item live feed beyond counts.
## 2026-11-03 (volume: directory explosion + parallel sweeps, fail-safe)

User: wakasure.com search found 30, only 3 worth the time; page opens are
slow (serial fetches); "explode to be able to find 100, 80"; approve the
ArinaBreeze borrowings, fail-safe, proper error handling.

- Directory explosion (borrowed from ArinaBreeze, Meta-native): fetchPage
  now harvests anchor href+text pairs; when a search hit is on a known
  directory host, discover fetches the listing page and saves each
  PLAUSIBLE member as a candidate (name gate, social/nav-link rejects,
  domain dedupe) sharing the directory's evidence row. The listing page
  itself never becomes a candidate. Bounded: <=25 members per directory,
  <=60 exploded per run; the whole explosion is best-effort (a dead or
  blocked directory costs one fetch and nothing else).
- Parallel query bursts in discover: 3 grounded-search bursts at a time;
  each batch is SLICED to the remaining search budget up front (no
  overshoot); Promise.allSettled isolates one dead burst; the per-query
  done-ledger still marks completion.
- Parallel page opens in investigate: 5 fetches at a time, budget-sliced;
  per-prospect isolation - an unexpected error still moves the candidate
  to investigating (fetch-failure contract), never stranded; budget
  counters hard-clamped after each batch; budget exhaustion returns the
  honest stopped reasons (searches/fetches) exactly as before.
- Caps raised: candidates 30 -> 120, fetches 80 (searches 40, rounds 60).
- Tests: explosion (gated members, page never a candidate, domain dedupe),
  allSettled query isolation, budget slicing (5 queries / cap 2 -> exactly
  2 calls then stopped), investigate isolation (one exploding fetch, both
  candidates still investigated).

Verification: 482/482 vitest, SMOKE PASS, tsc clean; deployed c2956cc0
(push a7708ab). Note: the client already streams the found-list live
(per-tick /prospects fetch); Muse token streaming is irrelevant here -
the workflow reasons server-side and the UI polls results.
## 2026-11-03 (classify like 504Yard: the shortlist holds, not discards)

User report on the real-estate run: 72 found but only 5 shortlisted, and the
set-aside pile was full of real agencies (GidiSteel, Mercy Divine, MaisonHills,
Thorpe...) plus listing-title junk ("Houses in Estates, Port Harcourt, Rivers",
"PowerPoint Presentation"). Direction: "5 is too small, that's too strict —
ideally it should find almost 70 and classify them like C:\dev\504Yard"
(504Yard bands: A 3 / B 94 / C 107 of 204 — band C is "research further",
VISIBLE, never discarded).

Root causes found and fixed:

1. Deterministic exclusion gate nuked real agencies: word-stem matching let
   the modifier "property" (inside "Property portals and listing marketplaces")
   fire on any agency named "…Properties". Now multi-word exclusion phrases
   fire on the CATEGORY (the kind field) or >= 2 name words — never one
   modifier inside a company name — and trailing company-name descriptors
   ("Properties", "Homes", "Realty", "Estate"...) are stripped before
   matching, the same rule as "X Enterprise is not an enterprise account".
   Single-word exclusions ("banks") still fire on name or category.
2. Mass model set-asides: the assess prompt shared ONE global slice of 30
   evidence rows across 72 prospects (most prospects judged with their own
   pages MISSING, then rejected for "no evidence") and instructed "use 1-2
   freely when evidence is thin". Now every prospect carries its OWN evidence
   rows in the prompt, and the rubric is 504Yard banding: a real organisation
   that visibly belongs to the segment is icp_fit 3+ even when thin; 1-2 is
   for the wrong KIND only (portals, directories, unrelated trades, one
   unattached person). decideVerdict: icp_fit < 3 with a route or own page is
   now needs_research (kept for a look, lands on the shortlist) — only unfit
   AND unreachable AND page-less is disqualified.
3. Ingest junk classes: listing-inventory titles ("<type> ... in <place>"),
   generic-org-in-place titles, verb/marketing openings, "your"-copy,
   document artifacts, pagination ghosts ("... in 3") all rejected at the
   name gate; nav furniture normalized (", Home" suffix, "About " prefix).
4. Explosion: a directory hit is ALWAYS consumed by its members (the
   zero-member fall-through that shipped "Houses in Estates..." is gone);
   same-host profile paths (/company/<slug>) now explode into members, each
   with its OWN evidence row so investigate opens the member page, not the
   directory index.
5. Run view: set-aside list collapsed to 8 rows + "Show N more set aside"
   (expansion survives polling), rationales word-boundary-clipped
   (mid-word "Principal/Fo" cuts gone), budget line reads caps from the
   run's own budgets (no more hardcoded 30/40).

Tests: exclusion-gate wakasure regression (8 agency names pass, portal kind
caught), banding verdicts (routed+under-evidenced kept; wrong kind still
discarded), ingest-gate junk class list, nav normalization, directory
fall-through (zero members -> no candidate), same-host profile explosion with
own evidence rows, smoke collapse/show-more journey (9 mock dropped rows).
Verification: 488/488 vitest, SMOKE PASS, tsc clean; deployed fceee880
(push a499a81).
## 2026-11-03 (keep-rate + runs history + URL recognition + run-view revamp)

User: "out of 43 only 4 kept, that's weak... let keeping be like 60% at
least" and asked whether the missing WhatsApp numbers were the cause.
Also: dashboard stored only one run; "wakasure.com" was not recognised as a
website (only https:// links were); the run view wasted its top on a brand
block + stage pills and cramped the set-aside rail.

- Not WhatsApp (verified: the keep gate never required a phone route —
  email/website-form routes qualify; reachability 2+ passes). The real gate
  was readiness: "no dated buying signal" refused to qualify ANY routed
  in-segment agency. Fixed (504Yard banding): readiness 1 with a usable
  route now QUALIFIES at fit 2 (warm-up tier) — a tier question, never a
  band question. Assess prompt tells the model the same. Expected keep-rate
  on new runs: most of the found list lands Ready/Warm/Look.
- Junk gates extended: marketing-claim sentences ("...The best real estate
  development company"), year-guides ("A 2026 Property Buyer's Guide"),
  fully-generic org names ("Real Estate Company").
- Runs history: GET /api/runs (limit/offset, JS-sorted so mock and prod
  agree) with per-run found/kept counts; the dashboard lists ALL runs any
  status under "All runs" with a working pager (8/page, edge-aware
  buttons) and an Open action that adopts the run and lands on its run
  view. Mock carries 9 demo runs for the pager.
- Website recognition: extractSiteUrl accepts BARE domains ("wakasure.com",
  "see wakasure.com", www forms), guards emails (@host), normalises the
  scheme; the detected site rides back in the turn response, the client
  remembers it (ob.site) and re-sends it as site_url on later turns (the
  mined context survives even when the latest message has no domain), and
  it persists to business_profile.website_url (was always "" before).
- Run view revamp: the in-page brand block is gone (the sidebar owns the
  brand); the campaign stage trail MOUNTS into the page flow under the
  headline (same shell node, single source of truth) styled as quiet
  hairline chips (~28px row); set-aside panel got a real width
  (minmax(280px,1fr)), small heading, tight bordered rows; found-list
  spans full width. Budget line already reads the run's own caps.

Tests: runs-list pagination + counts, extractSiteUrl (bare/www/prose/email
guards), warm-up verdict; smoke covers the pager (8+1 of 9 demo runs), page
labels, edge buttons, open-a-past-run adoption. Verification: 491/491
vitest, SMOKE PASS, tsc clean; deployed 2f87a936 (push bf75540). Note: a
run already in flight keeps the workflow version it started with — the
keep-rate change applies to runs started after this deploy.
## 2026-11-04 (write-messages fixed + brand dedup + slim headers)

User: "Write their messages now" did nothing for ~30 non-drafted picks;
redundant "Prospect Research" rows on messages/dashboard/shortlist; the
shortlist header was space-consuming.

- Root cause 1 (the dead click): the studio note's button carried prospect
  NAMES in data-ids where the API expects prospect IDS — the server matched
  nothing, drafted nothing, and the note re-rendered unchanged. The button
  now carries ids (names stay for reading); the click handler also falls
  back to getAttribute when dataset is unavailable.
- Root cause 2: draft-missing refused runs that were still working (409
  run_not_ready) — the user clicked from a mid-run peek. The gate is gone:
  an explicit owner action, the draft phase is bounded and fail-safe, so it
  drafts whatever is ready whenever it is asked.
- Brand dedup: the in-page "Prospect Research" logo rows are removed from
  shortlist, drafts, dashboard, campaigns, and senders (the sidebar owns
  the brand; demo kickers stay); in-app h2s are compact (1.45rem).

Scoping answer (recorded): everything IS campaign/run-scoped — prospects,
evidence, routes, drafts, decisions live under the run's id, so messages
for non-drafted picks generate from THAT run's evidence and contact routes
with no re-research. Email accounts (sender connections) are the only
cross-campaign resource, by design (they send for any campaign).

Tests: draft-missing on a running run (no 409, ok:true). Verification:
492/492 vitest, SMOKE PASS, tsc clean; deployed f7dce344 (push 7fda3de).
