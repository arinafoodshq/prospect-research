# specs/product.md — Prospecting Product Requirements

- Status: approved through v0.2 (2026-10-29). v0.1 approved 2026-10-28.
- Owner: System B (deployed prospecting product). Design details live in
  `specs/architecture.md` (components), `specs/research-loop.md` (runtime loop),
  `specs/data-model.md` (persistence), `specs/evaluation.md` (tests and metrics).
  This document owns scope, journey, requirements, and acceptance.

## 1. Overview

An AI prospecting agent for small businesses. The owner describes what the business
offers; the agent investigates the business, asks only essential clarification
questions, discovers candidate customers through public web sources, evaluates and
ranks them with cited evidence, identifies legitimate public contact routes, and
prepares personalised outreach drafts for human review. It thinks in buyer layers:
for a caterer, corporates running events and the event organisers themselves are
different layers with different pitches.

Central promise: **tell the agent what your business offers; it researches who
might buy it and explains why.** Key characteristic: every recommendation is
evidence-backed and human-approved — never a plausible-sounding guess.

## 2. Design principles

1. **Evidence before assertion.** No material prospect claim without a linked
   evidence record (source, retrieval time, supporting quote or snippet).
2. **Facts, inferences, and unknowns are labelled.** The system distinguishes
   verified facts, reasonable inferences, conflicting evidence, and missing
   information in storage and display.
3. **Human approves every outreach.** Drafts and scheduled campaigns are both
   gated: per-draft approve/edit/reject, then explicit campaign approval. The
   system sends only approved campaign mail, and never claims a message was
   sent when it was only drafted, queued, or handed to a provider.
4. **Minimal owner effort.** Conversational onboarding; extract where possible, ask
   only questions that change the research outcome; never a large form.
5. **Bounded agent behavior.** Every research run operates inside explicit,
   visible budgets and stops cleanly with partial results preserved.
6. **Honest contact routes.** A public listing is not a verified channel. Contact
   claims carry a verification level and a source; the system never claims a number
   is WhatsApp-enabled or verified without a legitimate verification method
   (none exists in the MVP).
7. **Deterministic delivery.** The AI researches and drafts; scheduling, sending,
   retries, and compliance are deterministic application code behind a
   provider-independent interface. Credentials never reach the model.

## 3. Target user and problem

- **User:** a small-business owner/operator with no lead list and no research
  capacity. Launch scenario: 504 Yard Grills & Drinks (Ikeja, Lagos) seeking
  corporate catering/event buyers and event organisers. The product is
  location- and business-agnostic: Ikeja catering is the demo scenario, never a
  hardcoded default (verified: zero geography literals in backend runtime).
- **Problem:** the owner can describe what they sell but cannot systematically
  answer who nearby would buy it, why those buyers fit, how to reach them, or what
  to say — and cannot distinguish a general assistant's confident guesses from facts.

## 4. User journey

1. **Describe.** Owner submits business name plus a website URL and/or short
   free-text description. Exit: a draft business profile exists.
2. **Understand.** System fetches the supplied site when accessible, extracts
   services, value proposition, target market, service area, and constraints;
   shows the draft profile with per-field provenance (stated / extracted with
   source / assumed). Exit: owner sees what the system learned.
3. **Clarify.** System asks at most 5 focused questions covering material gaps
   only (ideal customer, location, minimum order, price range, differentiators,
   exclusions). Exit: owner answered or explicitly skipped each.
4. **Confirm.** Owner confirms or corrects the profile; confirmed profile locks as
   the research brief. Exit: brief locked with version and timestamp.
5. **Research.** System runs a bounded research run: discovers candidates from
   public web sources, investigates with bounded page fetches, dedupes, assesses
   fit. Progress and budget consumption are visible throughout. Exit: ranked
   shortlist with evidence, or a clean stop with reasons and partial results.
6. **Review.** Owner receives a deduplicated ranked shortlist (default 5–8
   prospects): fit reasoning, cited evidence, uncertainties, missing info, public
   contact routes with sources, recommended next action, and one outreach draft per
   prospect. Exit: owner has reviewed each item.
7. **Decide.** Owner approves, edits, or rejects each draft. Decisions and reasons
   persist; statuses and follow-ups-due update. Exit: every draft is decided or
   explicitly deferred.
8. **Connect.** Owner optionally connects a sender: mock (demo), Resend API key,
   or Gmail OAuth. Credentials are sealed server-side and never shown again.
   Assisted `mailto:`/`wa.me` links always work with no sender. Exit: a verified
   sender exists, or the owner proceeds assisted-only.
9. **Campaign.** Owner builds a campaign from researched prospects, reviews/edits
   each personalised draft, approves explicitly, and schedules a send time.
   Server sends due mail after the browser closes; per-recipient statuses,
   attempts, pause/cancel are visible. Exit: campaign complete/cancelled with a
   full delivery record.
10. **Track.** Every touch — campaign email or hand-logged WhatsApp call, visit,
    or reply — lands on the prospect's timeline with channel and date. Exit:
    the owner can answer "who did we contact, how, and when" for any lead.

## 5. MVP scope

In scope:

- Single-operator use; one business profile per research brief.
- Website fetch and profile extraction; conversational clarification (≤5 questions).
- Grounded web discovery + bounded page investigation of public sources.
- Evidence records with provenance; verified/inferred/unknown/conflicting labels.
- Deterministic dedupe; ranked shortlist with fit reasoning and uncertainties.
- Public contact routes with verification level and source.
- One outreach draft + next action per shortlisted prospect; approve/edit/reject.
- Prospect/draft status tracking; follow-ups-due derivation.
- Visible run progress, budgets, and clean-stop behavior.
- Provider-independent email delivery (mock, Resend, Gmail OAuth adapters).
- Approval-gated scheduled campaigns with per-recipient tracking, retries,
  suppression/unsubscribe, pause/cancel; queue-based execution.
- Contact tracking across all channels + per-prospect timeline.
- Assisted `mailto:`/`wa.me` click-to-send (no sender required).

Explicit non-goals (rejected for MVP, not merely deferred silently):

- Any sending without explicit human approval per campaign; unsupervised or
  bulk cold outreach.
- CSV import as a primary workflow (may return later as optional input).
- Social-network discovery pillar (FB/IG search) — review-gated and narrow; the
  MVP must impress without it.
- Raw-SMTP sending from Workers (port 25 blocked; hand-rolled client rejected);
  SMTP relay via container is designed, not built.
- Microsoft Graph adapter, bounce/complaint webhooks, multi-user accounts and
  roles, analytics dashboards, paid data providers, self-hosted large models.

## 6. Functional requirements and acceptance criteria

**FR-1 — Business submission.** Owner can submit name + website URL and/or
description; system accepts any combination with at least a name and one of URL
or description. Accept: each combination is accepted; empty submissions are
rejected with a specific error.

**FR-2 — Profile extraction.** System produces services, value proposition, target
market, service area, and constraints, each labelled stated / extracted (with
source URL) / assumed. Accept: no field lacks a provenance label; extracted fields
cite a fetched page or are downgraded to assumed.

**FR-3 — Clarification.** System asks ≤5 questions, each tied to a material gap
that changes research (customer, location, order minimum, price, differentiators,
exclusions). Accept: question count never exceeds 5; each question names the gap
it resolves; owner can skip any question.

**FR-4 — Brief lock.** Owner confirms/corrects; the brief locks with version and
timestamp and becomes the research input. Accept: research cannot start on an
unconfirmed brief; corrections update provenance to stated.

**FR-5 — Bounded discovery.** Research run discovers candidates via grounded
search within explicit search/fetch/candidate budgets. Accept: run stops at caps;
empty results yield a clean stop with reasons, never fabricated candidates.

**FR-6 — Evidence linkage.** Every material prospect claim links to an evidence
record (source URL or origin, source type, retrieved timestamp, quote/snippet);
claims carry exactly one of verified / inferred / unknown; conflicts are flagged,
not silently resolved. Accept: spot-check any displayed claim reaches its evidence;
no claim displays without a label.

**FR-7 — Ranked shortlist.** Deduplicated shortlist (default 5–8, configurable
1–20) with fit rating, supporting/weakening evidence references, uncertainties,
and missing info per prospect. Accept: no duplicate prospects under distinct names
(normalised dedupe keys); every ranked item shows its reasoning and gaps.

**FR-8 — Contact routes.** Each route records channel, value, verification level
(public-listing only in MVP), and source evidence. Accept: no route claims a
verified channel; every route resolves to its source.

**FR-9 — Outreach drafts.** One draft + suggested next action per shortlisted
prospect, personalised from the prospect's evidence. Accept: draft references at
least one cited fact about the prospect; next action is specific (channel + timing).

**FR-10 — Approval gate.** Owner can approve, edit (marks edited-by-human), or
reject each draft; decisions persist with timestamps. Accept: no path from draft
to "sent" exists except through an approved campaign; all transitions are
validated state changes.

**FR-11 — Status and follow-ups.** Prospect/draft statuses and an activity log
persist; follow-ups-due derives from approvals plus elapsed time. Accept: status
history is complete and ordered; due list matches the derivation rule.

**FR-12 — Run visibility and budgets.** Run shows phase, progress, and budget
consumption (searches, fetches, tokens, cost, elapsed time); hitting any cap stops
the run cleanly with partial results preserved and resumable. Accept: every stop
records its reason; partial results remain reviewable.

**FR-13 — Delivery interface.** One server-side contract (verify/send/status)
behind which providers plug in; campaign code never touches vendor APIs.
Accept: adding a provider touches one adapter file plus registration.

**FR-14 — Sender connect.** Owner connects mock/Resend/Gmail senders; secrets are
encrypted at rest and never returned. Accept: no API response, log, or prompt
ever contains a credential; disconnect wipes the secret.

**FR-15 — Campaign lifecycle.** Create from researched prospects, edit pre-approval,
explicit approve with schedule, pause/resume/cancel; approval freezes snapshots.
Accept: unapproved campaigns never send; post-approval edits are rejected;
cancel prevents all unsent deliveries.

**FR-16 — Scheduled execution.** Due mail sends server-side after the browser
closes, in bounded batches with idempotent claiming. Accept: approved campaign
with a past schedule completes without any open browser; no recipient is ever
sent twice (idempotency keys + claim stamps, tested under overlap).

**FR-17 — Suppression and unsubscribe.** Do-not-contact list enforced at approval
and send time; every campaign mail carries a working unsubscribe link.
Accept: suppressed addresses never send; unsubscribe link suppresses + parks.

**FR-18 — Assist links.** Correctly-encoded `mailto:`/`wa.me` links per draft with
no sender required. Accept: links open the right composer/handoff; UI never
claims a handoff is a send.

**FR-19 — Contact tracking.** Owner logs any-channel touches (channel, date, note);
campaign sends auto-log; per-prospect timeline merges all events newest-first.
Accept: every send appears on the timeline; manual contacts persist with
user-stated dates.

**FR-20 — Queue guarantees.** Producers enqueue claimed jobs; consumers send one
attempt each; transient errors requeue with backoff (ACK); crashes retry then
DLQ. Accept: overlapping producers never double-enqueue (tested); poison
messages land in the DLQ, never silently dropped.

## 7. Demo scenario (acceptance in miniature)

504 Yard, no lead list: owner enters name + catering description (+ website if
available) → agent shows extracted profile → asks ≤5 questions → owner confirms →
agent researches with visible progress → presents 5–8 ranked Ikeja corporate
prospects with evidence, uncertainties, contact routes, and drafts → owner edits
one draft, approves it, rejects another → connects a sender (or uses assisted
links) → schedules a campaign to a controlled recipient → watches per-recipient
status land → logs a WhatsApp follow-up on the winner's timeline. Every
on-screen claim traceable to a source; every send explicitly approved.

## 8. Constraints

- Model inference is a documented product dependency (Meta Responses API);
  exact request shapes and history mode are owned by `specs/architecture.md`.
- All model keys and messaging credentials server-side; nothing secret in client,
  repo, logs, prompts, or fixtures.
- $150 Meta credit budget for the project; development runs on mocks/fixtures
  except explicitly approved live calls.
- No fabricated prospects, evidence, contact details, or send-status claims.
- Public repo: compliance note in README; demo sends to controlled recipients only.

## 9. Open unknowns

- **U-1 (RESOLVED 2026-10-29):** grounded-search coverage for Nigerian-local
  queries is usable (live Ikeja/Abuja runs produced real ranked buyers); zero
  citations retained, so grounding relies on `results[]` snippets.
- **U-2 (RESOLVED 2026-10-29):** public contact data is sparse but present;
  graceful degradation (unknown labels, partial shortlists) implemented.
- **U-3 (RESOLVED 2026-10-29):** Enterprise quotas verified; Worker + D1 +
  Workflows + Queues all deployed and live.
- **U-4:** container SMTP relay operability (image build, cold starts, relay
  throughput). Resolution: build spike post-MVP; HTTPS adapters carry the demo.
- **U-5:** Google OAuth verification for public Gmail users. Resolution: not
  required for single-operator demo (dev-mode consent); verification only if
  strangers connect Gmail post-hackathon.

## 10. Acceptance of this spec (DoD)

This spec is done when: every FR has testable acceptance criteria (above); every
journey step has an exit criterion; non-goals are explicit; unknowns list owners
and resolution paths; no design detail contradicts `AGENTS.md`; and you approve it.
Evidence: approval recorded in `progress.md`.

## 11. Version history

- v0.1 (2026-10-28): initial draft for review.
- v0.2 (2026-10-29): delivery scope approved and built — journey steps 8–10,
  FR-13–FR-20, non-goal revisions (approved campaign sending in scope),
  U-1–U-3 resolved with outcomes, location-agnostic guarantee. Rationale:
  reviewer-approved hybrid delivery implemented and live-verified.
