/**
 * product/src/research/phases.ts — durable research phases (specs/research-loop.md §§2-5).
 * Phase functions take injected (brief, db, meta, budgets) deps; each reads/writes
 * durable D1 state and returns its outcome. Deterministic dedupe/budgets in code.
 * No `cloudflare:workers` imports (runs under plain vitest/node).
 */
import {
  Db,
  DbValidationError,
  getRun,
  listEvidence,
  listProspects,
  logActivity,
  saveAssessment,
  saveCandidate,
  saveDraft,
  saveEvidence,
  saveRoute,
  setProspectStatus,
  setRunStatus,
  type Assessment,
  type Evidence,
  type Prospect,
} from "../db";
import { budgetReason, checkIncrement, firstBreach, type BudgetCaps, type BudgetConsumed } from "./budgets";
import {
  checkHardConstraints, decideVerdict, ensureDirective, extractContacts, icpFromBrief, isGroundedContact,
  validateBrief,
  type QualificationDims,
} from "./commercial";
import { execFetchPage, type FetchPageDeps } from "./tools";
import { isDirectoryHost, isSocialHost, MODEL_ID } from "../meta";
import { matchTokens, verifyContact } from "../verify";
import type { RouteVerification } from "../db";

/** Host of a url (www stripped); "" when unparsable. */
function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

// --- Injected deps ----------------------------------------------------------

export interface Brief {
  id: string;
  status: "draft" | "confirmed";
  excerpt: string;
}

export interface SearchHit {
  claim: string;
  quote: string;
  source_url: string | null;
  name: string;
  category: string;
  location?: Record<string, string>;
  domainOrHandle?: string;
  /** False when the name looks like model chatter: evidence kept, no candidate. */
  candidateEligible?: boolean;
}

export interface AssessProposal {
  prospect_id: string;
  fit_rating: number;
  supporting_claims: string[];
  weakening_claims?: string[];
  rationale: string;
  /** Dimensional scores (new path); absent = legacy overall-only proposal. */
  dimensions?: { icp_fit: number; problem: number; readiness: number; reachability: number; confidence: number };
  /** Grounded-then-validated contact extraction (user request 2026-11-01):
   * social profiles + the named contact person, when the evidence states them. */
  contacts?: { person_name?: string; person_title?: string; socials?: string[] };
}

export interface DraftProposal {
  prospect_id: string;
  channel: "website_form" | "email" | "phone" | "social_profile" | "other";
  channel_suggestion?: string;
  contact_value: string;
  subject?: string | null;
  body: string;
  /** Per-prospect offer fit (owner 2026-11-04): one sentence in the owner's
   *  voice naming the concrete connection between the offer and THIS
   *  prospect ("event grilling for the events you host"). */
  angle?: string;
  next_action: string;
  follow_up_days?: number;
  /** Prospect-evidence ids backing the draft's claims (audited in code). */
  supporting_ids?: string[];
  /** Per-channel versions (user request 2026-11-01): WhatsApp short + casual,
   * Email full with the subject, DM ultra-short for Instagram/TikTok. */
  variants?: { whatsapp?: string; email?: string; dm?: string };
}

/** Business-profile fields the brief builder reasons over (plain strings). */
export interface BriefProfile {
  name: string;
  website_url: string;
  description: string;
  target_market: string;
  service_area_note: string;
  constraints_note: string;
}

/** Allowlisted keys for conversational onboarding (server enforces; model cannot invent keys). */
export const ONBOARD_FIELD_KEYS = [
  "offering",
  "ideal_customer",
  "service_area",
  "order_size",
  "decision_maker",
  "timeline",
  "budget",
  "exclusions",
] as const;
export type OnboardFieldKey = (typeof ONBOARD_FIELD_KEYS)[number];

/** One extracted fact about the owner's business (model may only produce label "inferred"). */
export interface OnboardFieldValue {
  value: string;
  label: string;
}

/** Model's single permitted follow-up question (null when done or capped). */
export interface OnboardQuestion {
  key: string;
  prompt: string;
  chips: string[];
}

/** Validated output of one onboarding turn. */
export interface OnboardTurnResult {
  fields: Record<string, OnboardFieldValue>;
  question: OnboardQuestion | null;
  done: boolean;
  /** Business name stated in the owner's words (absent when not stated). */
  name?: string;
}

/** Input the server hands to the model for one onboarding turn. */
export interface OnboardTurnInput {
  text: string;
  known: Array<{ key: string; value: string; label: string }>;
  followups_used: number;
  /** Silent network context (Cloudflare edge geo, country/region/city):
   *  lets the model complete bare places ("Ikeja" + NG context) without
   *  asking — never mentioned to the owner (owner direction 2026-11-03). */
  geo_context?: string;
  /** The owner shared their website: fetched page text the model must mine
   *  for every field (name, offer, buyers, area) before asking anything
   *  (owner direction 2026-11-03: "they gave a website — extract it all,
   *  the user only edits"). */
  site?: { url: string; text: string };
}

export type RewriteTone = "warmer" | "more_direct" | "another";

export interface RewriteInput {
  subject: string;
  body: string;
  channel: string;
  tone: RewriteTone;
}

export interface RewriteResult {
  subject: string;
  body: string;
}

/** Mockable Meta client surface (no live calls; mocked in tests). */
export interface MetaClient {
  planQueries?: (briefExcerpt: string) => Promise<string[]>;
  /** QA-loop replan: fresh queries after a sweep fell short (absent = no loop). */
  planMore?: (input: { previousQueries: string[]; whyNot: string }) => Promise<string[]>;
  search?: (query: string, knownNames?: string[]) => Promise<SearchHit[]>;
  proposeAssessments?: (prospects: Prospect[], evidence: Evidence[]) => Promise<AssessProposal[]>;
  proposeDrafts?: (prospects: Prospect[], evidence?: Evidence[]) => Promise<DraftProposal[]>;
  fetchPage?: (url: string, timeoutMs: number) => Promise<
    { text: string; socials?: string[]; links?: Array<{ url: string; text: string }> }
    | { failure: "blocked" | "empty" | "timeout"; detail: string }
  >;
  rationales?: (prospectIds: string[]) => Promise<Record<string, string>>;
  /** Build + validate the versioned commercial brief (new path; absent = legacy excerpt flow). */
  buildBrief?: (profile: BriefProfile) => Promise<import("./commercial").CommercialBrief>;
  /** Hand the stored brief to later bursts (prompts switch to brief-driven goals). */
  setBrief?: (brief: import("./commercial").CommercialBrief) => void;
  /** Model id stamped on assessments (absent in old mocks = default model). */
  modelId?: string;
  /** Rewrite one outreach draft in a requested tone (studio rewrite buttons). */
  rewriteDraft?: (input: RewriteInput) => Promise<RewriteResult>;
  /** Rewrite a stored draft into ONE channel's shape (one-click tune for
   * drafts written before per-channel variants existed). */
  retuneVariant?: (input: import("../meta").RetuneInput) => Promise<string>;
  /** One conversational-onboarding turn: extract facts, ask at most one question. */
  onboardTurn?: (input: OnboardTurnInput) => Promise<OnboardTurnResult>;
}

export interface BudgetState {
  caps: BudgetCaps;
  consumed: BudgetConsumed;
}

export type PhaseOutcome =
  | { status: "completed"; detail?: string; stop_reason?: undefined }
  | { status: "stopped"; stop_reason: string; detail?: string };

export function stopped(reason: string, detail?: string): PhaseOutcome {
  return detail === undefined ? { status: "stopped", stop_reason: reason } : { status: "stopped", stop_reason: reason, detail };
}
export function completed(detail?: string): PhaseOutcome {
  return detail === undefined ? { status: "completed" } : { status: "completed", detail };
}

// --- Gate decisions (pure; gates are wait states, never auto-advanced) ------

/** Brief gate: run cannot leave `created` until the brief is confirmed. */
export function briefGateDecision(brief: Brief): { wait: boolean; event: "brief_confirmed" } | { wait: false } {
  if (brief.status === "confirmed") return { wait: false };
  return { wait: true, event: "brief_confirmed" };
}

export interface DraftRow { id: string; status: string }
/** Draft gate: waits while any draft is undecided. An EMPTY draft list means
 * nothing needs approval — close completes the run honestly (zero shortlisted
 * is a valid outcome; the empty-wait here once crashed the workflow with
 * "close stopped: awaiting_approval" on run_27e246ba). */
export function draftGateDecision(drafts: DraftRow[]): { wait: boolean; event?: "drafts_decided"; pending: number } {
  const pending = drafts.filter((d) => d.status === "draft").length;
  if (pending > 0) return { wait: true, event: "drafts_decided", pending };
  return { wait: false, pending: 0 };
}

// --- plan -------------------------------------------------------------------

const MAX_PLAN_QUERIES = 8;

/**
 * plan: model drafts a search plan (business types × locale angles, ≤8 queries);
 * code validates shape and budget fit; plan stored on the run.
 * Entry requires brief status = confirmed, else outcome stopped at awaiting_brief.
 */
export async function plan(
  brief: Brief, db: Db, meta: MetaClient, budgets: BudgetState & { run_id: string },
): Promise<PhaseOutcome> {
  const gate = briefGateDecision(brief);
  if (gate.wait) {
    try { await setRunStatus(db, budgets.run_id, "awaiting_brief"); } catch { /* keep durable state best-effort */ }
    return stopped("awaiting_brief", "brief not confirmed; waiting at awaiting_brief");
  }
  const breach = firstBreach(budgets.consumed, budgets.caps);
  if (breach) return stopped(breach, "budget breached before plan");
  // New path: build + store the versioned commercial brief once per run,
  // then hand it to later bursts. Absent without buildBrief (legacy flow).
  if (meta.buildBrief || meta.setBrief) {
    const stored = await getRun(db, budgets.run_id);
    let briefJson = stored?.commercial_brief ?? null;
    if (meta.buildBrief && !briefJson) {
      const profile = await db.prepare("SELECT * FROM business_profile WHERE id = ?").bind(brief.id)
        .first<{ name: string; website_url: string; description: string; target_market: string; service_area: string; constraints: string }>();
      if (!profile) return stopped("plan_failed", `profile ${brief.id} not found`);
      /**
       * Service-area note: onboarding stores {note: "..."} (the owner's own
       * words, e.g. "kodeosh street, ikeja"); structured runs store
       * {city, region, country}. The note MUST reach the brief — dropping it
       * made the brief claim "no service area stated", geos became a
       * placeholder and every query went Nigeria-wide (run with job-board
       * junk, 2026-10-30).
       */
      const areaOf = (raw: string): string => {
        try {
          const parsed = JSON.parse(raw) as { note?: unknown; country?: unknown; region?: unknown; city?: unknown };
          const note = typeof parsed?.note === "string" ? parsed.note.trim() : "";
          const structured = [parsed?.city, parsed?.region, parsed?.country]
            .filter((v): v is string => typeof v === "string" && v !== "").join(", ");
          return note || structured;
        } catch { return ""; }
      };
      const constraintsOf = (raw: string): string => {
        try {
          const parsed = JSON.parse(raw) as { min_order?: unknown; price_range?: unknown; exclusions?: unknown };
          const parts: string[] = [];
          if (typeof parsed?.min_order === "string" && parsed.min_order !== "") parts.push(`min order: ${parsed.min_order}`);
          if (typeof parsed?.price_range === "string" && parsed.price_range !== "") parts.push(`price: ${parsed.price_range}`);
          if (Array.isArray(parsed?.exclusions)) {
            const ex = parsed.exclusions.filter((e): e is string => typeof e === "string");
            if (ex.length > 0) parts.push(`excludes: ${ex.join(", ")}`);
          }
          return parts.join("; ");
        } catch { return ""; }
      };
      try {
        const built = ensureDirective(await meta.buildBrief({
          name: profile.name, website_url: profile.website_url ?? "", description: profile.description,
          target_market: profile.target_market, service_area_note: areaOf(profile.service_area),
          constraints_note: constraintsOf(profile.constraints),
        }));
        briefJson = JSON.stringify(built);
        await db.prepare("UPDATE research_run SET commercial_brief = ? WHERE id = ?")
          .bind(briefJson, budgets.run_id).run();
      } catch (e) {
        return stopped("plan_failed", e instanceof Error ? e.message : "brief burst failed");
      }
    }
    if (meta.setBrief && briefJson) {
      try {
        meta.setBrief(validateBrief(JSON.parse(briefJson)));
      } catch { /* stored brief invalid: stay on legacy prompts */ }
    }
  }
  let queries: string[];
  try {
    queries = meta.planQueries ? await meta.planQueries(brief.excerpt) : [];
  } catch (e) {
    return stopped("plan_failed", e instanceof Error ? e.message : "plan burst failed");
  }
  if (!Array.isArray(queries) || queries.length === 0) {
    return stopped("no_plan", "model produced no queries; run stops without filler");
  }
  if (queries.length > MAX_PLAN_QUERIES) {
    return stopped("plan_too_large", `plan has ${queries.length} queries, max ${MAX_PLAN_QUERIES}`);
  }
  if (queries.some((q) => typeof q !== "string" || q.trim() === "")) {
    return stopped("plan_invalid", "plan contains empty queries");
  }
  if (budgets.consumed.searches + queries.length > budgets.caps.searches) {
    return stopped(budgetReason("searches"), "plan does not fit search budget");
  }
  await db.prepare("UPDATE research_run SET plan = ? WHERE id = ?")
    .bind(JSON.stringify({ queries }), budgets.run_id).run();
  budgets.consumed.tool_rounds += 1;
  return completed(`plan stored with ${queries.length} queries`);
}

// --- discover ----------------------------------------------------------------

/**
 * discover: per-query grounded-search bursts; candidate extraction (structured)
 * → prospect rows (status = candidate) + evidence rows (search_snippet).
 * Queries exhausted or candidate cap reached ends the phase. Zero candidates
 * ends stopped with reason no_candidates (honest empty, never filler).
 */
export async function discover(
  brief: Brief, db: Db, meta: MetaClient, budgets: BudgetState & { run_id: string },
): Promise<PhaseOutcome> {
  void brief;
  const run = await getRun(db, budgets.run_id);
  const plan = (run?.plan ?? {}) as { queries?: string[]; all_queries?: string[]; done_queries?: string[] };
  const queries: string[] = plan.queries ?? [];
  if (queries.length === 0) return stopped("no_plan", "discover needs a stored plan");
  if (!meta.search) return stopped("no_candidates", "no search client; honest empty shortlist");
  const searchFn = meta.search;
  // Synchronized retry (owner directive 2026-11-03): the per-query ledger in
  // the run's plan JSON marks completed searches. A retried run continues at
  // the first UNSEARCHED query — never from the absolute beginning — and the
  // at-least-once re-run of an interrupted query converges via the run's
  // evidence-url + candidate dedupe.
  const done = new Set(plan.done_queries ?? []);
  const todo = queries.filter((q) => !done.has(q));
  // Candidate locations inherit the stored brief's area (queries are
  // locale-scoped; hits themselves carry no geo).
  let geos: string[] = [];
  if (run?.commercial_brief) {
    try { geos = validateBrief(JSON.parse(run.commercial_brief)).primary_segment.geos; } catch { geos = []; }
  }
  // Search-burst memory: bursts that know what is already found steer toward
  // NEW organizations instead of re-suggesting the same ones (bounded).
  const knownNames = (await listProspects(db, budgets.run_id)).map((p) => p.name).slice(0, 15);
  let searched = 0;
  let skipped = 0;
  let explodedTotal = 0;
  // Parallel sweeps (owner direction 2026-11-03, borrowed from
  // ArinaBreeze): grounded-search bursts run 3 at a time; the batch is
  // SLICED to the remaining search budget up front, so parallelism can
  // never overshoot the caps. Failures are isolated per query
  // (Promise.allSettled): one dead burst never kills the sweep.
  const BATCH = 3;
  for (let i = 0; i < todo.length; i += BATCH) {
    if (budgets.consumed.candidates >= budgets.caps.candidates) break;
    const allowed = Math.max(0, budgets.caps.searches - budgets.consumed.searches);
    if (allowed <= 0) {
      return stopped(budgetReason("searches"), "search budget exhausted mid-discover");
    }
    const batch = todo.slice(i, i + Math.min(BATCH, allowed));
    if (batch.length === 0) break;
    const settled = await Promise.allSettled(
      batch.map(async (q) => ({ q, hits: await searchFn(q, knownNames) })),
    );
    for (let b = 0; b < settled.length; b += 1) {
      const r = settled[b];
      const q = batch[b];
      if (!r || r.status !== "fulfilled" || !q) { skipped += 1; continue; }
      budgets.consumed.searches += 1;
      budgets.consumed.tool_rounds += 1;
      searched += 1;
      const hits = r.value.hits;
      if (!hits || hits.length === 0) {
        // Zero-result outcome: mark the query done (retrying it would just
        // repeat the miss), then move on.
        await markQueryDone(db, budgets.run_id, plan, q);
        continue;
      }
      for (const h of hits) {
        if (budgets.consumed.candidates >= budgets.caps.candidates) break;
        try {
          // Evidence URL dedupe: the same source url reached the shortlist as
          // three separate evidence rows across sweeps (billionaires.africa
          // x3). One url = one evidence row per run; later hits reuse it.
          const existingEv = h.source_url
            ? await db.prepare("SELECT id FROM evidence WHERE run_id = ? AND source_url = ?")
              .bind(budgets.run_id, h.source_url).first<string>("id")
            : null;
          const evId = existingEv ?? await saveEvidence(db, {
            run_id: budgets.run_id, claim: h.claim, quote: h.quote,
            source_url: h.source_url, source_type: "search_snippet",
            retrieved_at: new Date().toISOString(), reliability: "unknown",
            conflicts_with: null, supersedes: null,
          });
          if (h.candidateEligible === false) continue; // evidence kept, chatter never becomes a candidate
          // Location inheritance: search hits carry no geo. The queries are
          // already locale-scoped, so a candidate without its own location
          // inherits the brief's area instead of rendering "Area unconfirmed".
          const inherited = Object.keys(h.location ?? {}).length > 0
            ? h.location as Record<string, string>
            : (geos.length ? { area: geos.slice(0, 3).join(", "), source: "brief" } : {});
          // Directory explosion (owner direction 2026-11-03, borrowed from
          // ArinaBreeze): a directory hit is CONSUMED by its member
          // businesses — always, even when zero members pass the gates (the
          // listing page itself must never become a candidate; that
          // fall-through shipped "Houses in Estates, Port Harcourt, Rivers").
          // Bounded (≤25 per directory, ≤60 per run), fail-safe per link.
          if (h.source_url && isDirectoryHost(h.source_url) && meta.fetchPage) {
            const made = explodedTotal < 60
              ? await explodeDirectory(meta, db, budgets, {
                url: h.source_url, evidenceId: evId, inherited,
                remaining: 60 - explodedTotal,
              })
              : 0;
            explodedTotal += made;
            continue;
          }
          // Ingest gate: page titles (listicles, calendars, forms, fragments,
          // listing-inventory titles, marketing phrases) never become
          // candidates (owner report 2026-11-03).
          if (!plausibleBusinessName(h.name)) continue;
          const r = await saveCandidate(db, {
            run_id: budgets.run_id, name: normalizeCandName(h.name), category: h.category,
            location: inherited,
            ...(h.domainOrHandle !== undefined ? { domainOrHandle: h.domainOrHandle } : {}),
            evidence_ids: [evId],
          });
          if (!r.merged) budgets.consumed.candidates += 1;
        } catch (e) {
          if (e instanceof DbValidationError) continue; // validation rejection recorded as tool result; move on
          throw e;
        }
      }
      await markQueryDone(db, budgets.run_id, plan, q);
    }
  }
  void skipped;
  const prospects = await listProspects(db, budgets.run_id);
  if (prospects.length === 0) {
    return stopped("no_candidates", `zero candidates after ${searched} searches; honest empty shortlist`);
  }
  return completed(`${prospects.length} candidates from ${searched} searches (${done.size + searched}/${queries.length} queries done)`);
}

/**
 * Directory explosion: fetch the listing page, harvest member anchors
 * (name+url), and save each plausible member as a candidate with its OWN
 * evidence row (so investigate fetches the member's page, not the directory
 * index). Members may live off-domain (their own site) or on the directory
 * itself under a profile path (/company/<slug> — how businesslist hosts
 * member pages). Fail-safe by construction: the whole function swallows its
 * own failures and returns the count made — the caller consumes the
 * directory hit either way, so a dead or blocked directory costs nothing
 * but one fetch. Bounded: ≤25 members per directory, and the caller caps
 * explosions per run.
 */
async function explodeDirectory(
  meta: MetaClient, db: Db, budgets: BudgetState & { run_id: string },
  dir: { url: string; evidenceId: string; inherited: Record<string, string>; remaining: number },
): Promise<number> {
  try {
    if (!meta.fetchPage) return 0;
    if (dir.remaining <= 0) return 0;
    const page = await meta.fetchPage(dir.url, 15000);
    if (!("links" in page) || !page.links || page.links.length === 0) return 0;
    const dirHost = hostOf(dir.url).replace(/^www\./, "");
    let made = 0;
    for (const l of page.links) {
      if (made >= Math.min(25, dir.remaining)) break;
      if (budgets.consumed.candidates >= budgets.caps.candidates) break;
      try {
        if (isSocialHost(l.url)) continue; // social buttons, not members
        const host = hostOf(l.url);
        if (!host) continue;
        const sameHost = host.replace(/^www\./, "") === dirHost;
        if (!sameHost && isDirectoryHost(l.url)) continue; // another directory's page
        // Same-domain links must look like a member PROFILE page, not the
        // directory's own nav or category pages.
        if (sameHost && !/\/(?:company|business|profile|listing|organizations?|store|shops?)\/[^/]/i.test(new URL(l.url).pathname)) continue;
        const name = normalizeCandName(l.text);
        if (!plausibleBusinessName(name)) continue; // "About us", "Contact", fragments
        // Per-member evidence row: the prospect's OWN url is the member
        // page, so investigate opens the member (real contacts live there),
        // never the directory index again.
        const evId = await saveEvidence(db, {
          run_id: budgets.run_id, claim: `${name} listed on ${dirHost}`,
          quote: l.text.slice(0, 200), source_url: l.url, source_type: "search_snippet",
          retrieved_at: new Date().toISOString(), reliability: "unknown",
          conflicts_with: null, supersedes: null,
        });
        const r = await saveCandidate(db, {
          run_id: budgets.run_id, name, category: "Directory listing",
          location: dir.inherited, ...(sameHost ? {} : { domainOrHandle: host }),
          evidence_ids: [evId],
        });
        if (!r.merged) { budgets.consumed.candidates += 1; made += 1; }
      } catch (e) {
        if (!(e instanceof DbValidationError)) {
          await logActivity(db, {
            run_id: budgets.run_id, event: "created",
            note: `explosion link skipped: ${e instanceof Error ? e.message.slice(0, 140) : "error"}`,
          }).catch(() => { /* the run never fails for one member */ });
        }
      }
    }
    return made;
  } catch {
    return 0; // a dead or blocked directory costs nothing but one fetch
  }
}

/** Persist one query into the run's done_queries ledger (best-effort: a
 *  failed write only costs a re-search on retry, never a crash). */
async function markQueryDone(
  db: Db, run_id: string, plan: { all_queries?: string[]; done_queries?: string[] }, q: string,
): Promise<void> {
  try {
    const ledger = [...new Set([...(plan.done_queries ?? []), q])];
    plan.done_queries = ledger;
    await db.prepare("UPDATE research_run SET plan = ? WHERE id = ?")
      .bind(JSON.stringify({ queries: plan.all_queries ?? [], all_queries: plan.all_queries ?? [], done_queries: ledger }), run_id).run();
  } catch { /* ledger is an optimization, never a failure */ }
}

// --- investigate --------------------------------------------------------------

/**
 * investigate: page fetches for top candidates (rank cutoff by budget);
 * extraction → further evidence rows (fetched_page); prospect → investigating.
 * Blocked/empty/timeout fetches record explicit fetch-failure evidence, never
 * silent skips.
 */
export async function investigate(
  brief: Brief, db: Db, meta: MetaClient, budgets: BudgetState & { run_id: string },
): Promise<PhaseOutcome> {
  void brief;
  const prospects = await listProspects(db, budgets.run_id);
  const targets = prospects.filter((p) => p.status === "candidate");
  if (targets.length === 0) return completed("nothing to investigate");
  const fetchDeps: FetchPageDeps = {
    consumed: budgets.consumed, caps: budgets.caps,
    fetcher: meta.fetchPage ?? (async () => ({ failure: "blocked" as const, detail: "no fetch client" })),
  };
  // Parallel page opens (owner 2026-11-03: "opening 30 pages is too slow" —
  // the slowness was one fetch after another). Five at a time, sliced to the
  // remaining fetch budget so parallelism never overshoots; every target is
  // isolated (Promise.allSettled): one dead page costs nothing but itself.
  let investigated = 0;
  const BATCH = 5;
  const investigateOne = async (p: Prospect): Promise<"opened" | "nofetch" | "failed"> => {
    try {
    // Per-prospect fetch: the prospect's OWN discovery URL. Never another
    // prospect's evidence, never a placeholder (both happened before).
    const ownIds = new Set(p.evidence_ids);
    const own = (await listEvidence(db, budgets.run_id)).filter((e) => ownIds.has(e.id));
    const target = own.find((e) => e.source_url);
    if (!target?.source_url) {
      // No fetchable url: the candidate keeps its discovery evidence and
      // moves to investigating; no synthetic "no fetchable source url"
      // evidence row (it read as junk evidence downstream).
      try {
        await setProspectStatus(db, budgets.run_id, p.id, "investigating");
        return "nofetch";
      } catch (e) {
        if (e instanceof DbValidationError) return "failed";
        throw e;
      }
    }
    const res = await execFetchPage(fetchDeps, { url: target.source_url });
    const attach = async (evId: string): Promise<void> => {
      const union = [...new Set([...p.evidence_ids, evId])];
      await db.prepare("UPDATE prospect SET evidence_ids = ? WHERE id = ?").bind(JSON.stringify(union), p.id).run();
      p.evidence_ids = union;
    };
    if (res.ok) {
      const evId = await saveEvidence(db, {
        run_id: budgets.run_id, claim: `fetched page for ${p.name}`, quote: res.value.text.slice(0, 500),
        source_url: target.source_url, source_type: "fetched_page", retrieved_at: new Date().toISOString(),
        reliability: "unknown", conflicts_with: null, supersedes: null,
      });
      await attach(evId);
      // Deterministic contact pass: emails/phones lifted from the fetched
      // page, each bound to this evidence row. Directory pages contribute
      // NOTHING (their numbers belong to other businesses); an owned page
      // also records its own url as a DM-able route. Never fatal.
      // Spec P0 (2026-10-31): every contact is CHECKED by script before it
      // becomes a route — phones validated (WhatsApp only when the page
      // confirms it), email syntax+domain, the page url itself verified.
      if (!isDirectoryHost(target.source_url)) {
        const areaHint = p.location?.area ?? "";
        const routeVerification = async (
          channel: "phone" | "email", value: string,
        ): Promise<RouteVerification> => {
          const check = await verifyContact(
            channel === "email"
              ? { channel: "email", value, ownDomain: hostOf(target.source_url ?? ""), businessName: p.name, area: areaHint }
              : { channel: "phone", value, sourceText: res.value.text, businessName: p.name, area: areaHint },
            async () => { throw new Error("no network in this pass"); },
          );
          return check.state;
        };
        for (const c of extractContacts(res.value.text).slice(0, 5)) {
          if (c.channel === "phone") {
            const phoneState = await routeVerification("phone", c.value);
            try {
              // A phone confirmed as WhatsApp keeps channel "phone" with a
              // verified state; the UI renders the WhatsApp icon for it.
              await saveRoute(db, { prospect_id: p.id, channel: "phone", value: c.value, evidence_id: evId, verification: phoneState });
            } catch {
              /* dupes or bad rows: contacts are best-effort, the run continues */
            }
            continue;
          }
          const emailState = await routeVerification("email", c.value);
          try {
            await saveRoute(db, { prospect_id: p.id, channel: "email", value: c.value, evidence_id: evId, verification: emailState });
          } catch {
            /* dupes or bad rows: contacts are best-effort, the run continues */
          }
        }
        // The page itself is already fetched: no extra network call — the
        // route is verified when the page mentions the business or area.
        const pageText = res.value.text.toLowerCase();
        const hit = matchTokens(p.name).some((t) => pageText.includes(t))
          || matchTokens(areaHint).some((t) => pageText.includes(t));
        const urlState: RouteVerification = hit ? "verified" : "unchecked";
        try {
          await saveRoute(db, {
            prospect_id: p.id,
            channel: isSocialHost(target.source_url) ? "social_profile" : "website_form",
            value: target.source_url, evidence_id: evId,
            verification: urlState,
          });
        } catch {
          /* url route is best-effort too */
        }
        // Social-link harvest (user request 2026-11-01): the crawled page's
        // own markup declares its Instagram/Facebook/X/LinkedIn/TikTok
        // profiles. Grounded by construction — they come from the lead's own
        // site — stored unchecked, deduped by value.
        for (const s of res.value.socials ?? []) {
          const existing = await db.prepare("SELECT id FROM contact_route WHERE prospect_id = ? AND value = ?")
            .bind(p.id, s).first<string>("id");
          if (existing) continue;
          try {
            await saveRoute(db, { prospect_id: p.id, channel: "social_profile", value: s, evidence_id: evId, verification: "unchecked" });
          } catch {
            /* social routes are best-effort */
          }
        }
      }
    } else {
      // Fetch failure: recorded in the phase outcome, NEVER as an evidence
      // row — a failure detail is not a claim, and attaching it made the
      // UI show "http 404" as evidence and fed junk into assess/draft.
    }
    // Verification anchor (the 504Yard method): find the organisation's
    // official social profile with a SEARCH, never guessed — the handle must
    // come from results. Best-effort, bounded by the search budget, skipped
    // when the discovery url is already a social profile.
    const verificationQuery = `\"${p.name}\" ${p.location?.area ?? ""} official Instagram Facebook`;
    if (
      meta.search && !isSocialHost(target.source_url)
      && !checkIncrement("searches", budgets.consumed, budgets.caps)
    ) {
      try {
        const hits = await meta.search(verificationQuery);
        budgets.consumed.searches += 1;
        budgets.consumed.tool_rounds += 1;
        const social = (hits ?? []).find(
          (h) => h.source_url && isSocialHost(h.source_url)
            && (h.name.toLowerCase().includes(p.name.toLowerCase().split(" ")[0] ?? "")
              || h.claim.toLowerCase().includes(p.name.toLowerCase().split(" ")[0] ?? "")),
        );
        if (social?.source_url) {
          const evId2 = await saveEvidence(db, {
            run_id: budgets.run_id, claim: `official social profile for ${p.name}`,
            quote: social.claim || social.quote || social.source_url,
            source_url: social.source_url, source_type: "business_site",
            retrieved_at: new Date().toISOString(), reliability: "unknown",
            conflicts_with: null, supersedes: null,
          });
          await attach(evId2);
          try {
            await saveRoute(db, {
              prospect_id: p.id, channel: "social_profile",
              value: social.source_url, evidence_id: evId2,
            });
          } catch { /* dupe route: already anchored */ }
        }
      } catch {
        /* verification pass is best-effort: the run continues without it */
      }
    }
    try {
      await setProspectStatus(db, budgets.run_id, p.id, "investigating");
      return "opened";
    } catch (e) {
      if (e instanceof DbValidationError) return "failed";
      throw e;
    }
    } catch (e) {
      // Fail-safe: an unexpected per-prospect error still moves the
      // candidate ON (the fetch-failure contract) — never stranded as
      // "candidate"; one dead page costs nothing but itself.
      try {
        await setProspectStatus(db, budgets.run_id, p.id, "investigating");
      } catch { /* stranded only if D1 itself is down */ }
      return "failed";
    }
  };
  for (let i = 0; i < targets.length; i += BATCH) {
    const allowed = Math.max(0, budgets.caps.fetches - budgets.consumed.fetches);
    if (allowed <= 0) {
      return stopped(budgetReason("fetches"), "fetch budget exhausted mid-investigate");
    }
    const batch = targets.slice(i, i + Math.min(BATCH, allowed));
    if (batch.length === 0) break;
    const settled = await Promise.allSettled(batch.map((p) => investigateOne(p)));
    for (const r of settled) {
      if (r.status === "fulfilled" && r.value !== "failed") investigated += 1;
    }
    // Hard clamp: parallel verification searches could nose past a cap.
    if (budgets.consumed.searches > budgets.caps.searches) budgets.consumed.searches = budgets.caps.searches;
    if (budgets.consumed.fetches > budgets.caps.fetches) budgets.consumed.fetches = budgets.caps.fetches;
  }
  return completed(`${investigated} prospects investigated`);
}

// --- assess -------------------------------------------------------------------

export interface AssessmentRecord {
  id: string;
  prospect_id: string;
  fit_rating: number;
  supporting_evidence_ids: string[];
}

async function listAssessments(db: Db, prospectIds: string[]): Promise<AssessmentRecord[]> {
  if (prospectIds.length === 0) return [];
  const out: AssessmentRecord[] = [];
  for (const pid of prospectIds) {
    const { results } = await db.prepare("SELECT * FROM assessment WHERE prospect_id = ?")
      .bind(pid).all<Record<string, unknown>>();
    for (const r of results) {
      out.push({
        id: r["id"] as string, prospect_id: r["prospect_id"] as string,
        fit_rating: r["fit_rating"] as number,
        supporting_evidence_ids: JSON.parse((r["supporting_evidence_ids"] as string) ?? "[]") as string[],
      });
    }
  }
  return out;
}

/**
 * Prospect-scoped evidence linking: a text links a row when it contains (or
 * is contained by) the claim or quote, or shares 3+ significant words
 * (paraphrase fallback). Shared by assess (supporting_claims) and draft
 * (body chunks): run-wide linking attached other businesses' evidence.
 */
export function linkTextsToEvidence(
  texts: string[], ownEvidence: Array<{ id: string; claim: string; quote: string }>,
): string[] {
  const claims = texts.map((c) => c.toLowerCase()).filter((c) => c.length > 0);
  return ownEvidence
    .filter((e) => [e.claim.toLowerCase(), e.quote.toLowerCase()].some((el) => claims.some((c) => {
      if (el.includes(c) || c.includes(el)) return true;
      const cw = new Set(c.split(/[^a-z0-9]+/).filter((w) => w.length > 3));
      const ew = new Set(el.split(/[^a-z0-9]+/).filter((w) => w.length > 3));
      let shared = 0;
      for (const w of cw) if (ew.has(w)) shared += 1;
      return shared >= 3;
    })))
    .map((e) => e.id);
}

/** Bracket citation in a draft body: trusted-but-bound to own evidence. */
const CITATION_MARKER = /\[(ev_|source\s*\d+|cite)/i;

/** Social hosts a lead's profile may live on (user request 2026-11-01). */
const SOCIAL_ROUTE_HOSTS = ["instagram.com", "facebook.com", "fb.com", "x.com", "twitter.com", "linkedin.com", "tiktok.com"];

export function isSocialRoute(url: string): boolean {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return SOCIAL_ROUTE_HOSTS.some((d) => h === d || h.endsWith("." + d));
  } catch {
    return false;
  }
}

/** Grounding: the url (protocol stripped) must appear in the prospect's own
 * evidence text — the model may only copy what the page actually says. */
export function socialGrounded(url: string, texts: string[]): boolean {
  const bare = url.replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();
  return bare.length > 0 && texts.some((t) => t.toLowerCase().includes(bare));
}

/**
 * Persist a prospect's extracted contacts: social profile routes (grounded,
 * verification 'unchecked' — published but never confirmed) and the contact
 * person when the evidence names one. Never overwrites an owner-set name.
 */
export async function persistContacts(
  db: Db, prospect_id: string,
  contacts: AssessProposal["contacts"],
  ownEvidence: Array<{ id: string; claim: string; quote: string; source_type?: string }>,
): Promise<void> {
  if (!contacts) return;
  const texts = ownEvidence.map((e) => `${e.claim}\n${e.quote}`);
  const routeEv = ownEvidence.find((e) => e.source_type === "fetched_page") ?? ownEvidence[0];
  for (const url of contacts.socials ?? []) {
    if (!isSocialRoute(url) || !socialGrounded(url, texts)) continue;
    const existing = await db.prepare("SELECT id FROM contact_route WHERE prospect_id = ? AND value = ?")
      .bind(prospect_id, url).first<string>("id");
    if (existing || !routeEv) continue;
    try {
      await saveRoute(db, { prospect_id, channel: "social_profile", value: url, evidence_id: routeEv.id, verification: "unchecked" });
    } catch (e) {
      if (!(e instanceof DbValidationError)) throw e;
    }
  }
  if ((contacts.person_name || contacts.person_title)) {
    const p = await db.prepare("SELECT contact_name FROM prospect WHERE id = ?").bind(prospect_id)
      .first<{ contact_name: string | null }>();
    if (p && !p.contact_name) { // owner-set names always win
      await db.prepare("UPDATE prospect SET contact_name = ?, contact_title = ? WHERE id = ?")
        .bind(contacts.person_name ?? null, contacts.person_title ?? null, prospect_id).run();
    }
  }
}

/**
 * assess: per investigated prospect, structured assessment → assessment rows +
 * prospect → qualified | disqualified with rationale. Empty supporting evidence
 * forces rating ≤ 2 (enforced by the writer; violations rejected so the model
 * corrects — here recorded and capped).
 */
export async function assess(
  brief: Brief, db: Db, meta: MetaClient, budgets: BudgetState & { run_id: string },
): Promise<PhaseOutcome> {
  void brief;
  const breach = firstBreach(budgets.consumed, budgets.caps);
  if (breach) return stopped(breach, "budget breached before assess");
  const prospects = await listProspects(db, budgets.run_id);
  const targets = prospects.filter((p) => p.status === "investigating");
  if (targets.length === 0) return completed("nothing to assess");
  const evidence = await listEvidence(db, budgets.run_id);
  let proposals: AssessProposal[];
  try {
    proposals = meta.proposeAssessments ? await meta.proposeAssessments(targets, evidence) : [];
  } catch (e) {
    return stopped("assess_failed", e instanceof Error ? e.message : "assess burst failed");
  }
  budgets.consumed.tool_rounds += 1;
  // New path: load the stored brief for the deterministic hard gate.
  const stored = await getRun(db, budgets.run_id);
  let icp: ReturnType<typeof icpFromBrief> | null = null;
  if (stored?.commercial_brief) {
    try {
      icp = icpFromBrief(validateBrief(JSON.parse(stored.commercial_brief)));
    } catch { icp = null; }
  }
  let done = 0;
  for (const t of targets) {
    const prop = proposals.find((x) => x.prospect_id === t.id);
    const rating = prop?.fit_rating ?? 2;
    // Prospect-scoped linking: support matches only the prospect's OWN
    // evidence rows. Run-wide linking attached other businesses' evidence.
    const ownIds = new Set(t.evidence_ids);
    const ownEvidence = evidence.filter((e) => e.run_id === budgets.run_id && ownIds.has(e.id));
    const claims = (prop?.supporting_claims ?? []).map((c) => c.toLowerCase());
    const supporting = linkTextsToEvidence(claims, ownEvidence);
    // Deterministic hard gate: violations disqualify whatever the model says.
    const hard = icp
      ? checkHardConstraints(icp, { name: t.name, category: t.category, location: t.location })
      : { ok: true as const };
    const modelId = meta.modelId ?? MODEL_ID;
    if (!hard.ok) {
      await saveAssessment(db, {
        prospect_id: t.id, fit_rating: 1, supporting_ids: supporting,
        weakening_ids: [], uncertainties: [], missing_info: [],
        rationale: `hard constraint: ${hard.reason}`, model_id: modelId,
        verdict: "disqualified",
      });
      await setProspectStatus(db, budgets.run_id, t.id, "disqualified");
      done += 1;
      continue;
    }
    const rd = prop?.dimensions;
    const dims: QualificationDims | null = rd &&
      [rd.icp_fit, rd.problem, rd.readiness, rd.reachability, rd.confidence]
        .every((v) => Number.isInteger(v) && v >= 1 && v <= 5)
      ? {
          icp_fit: rd.icp_fit as 1 | 2 | 3 | 4 | 5, problem: rd.problem as 1 | 2 | 3 | 4 | 5,
          readiness: rd.readiness as 1 | 2 | 3 | 4 | 5,
          reachability: rd.reachability as 1 | 2 | 3 | 4 | 5,
          confidence: rd.confidence as 1 | 2 | 3 | 4 | 5,
        }
      : null;
    if (dims && icp) {
      const primaryEvidence = ownEvidence.some((e) => e.source_type === "fetched_page");
      const decision = decideVerdict(dims, hard, primaryEvidence);
      try {
        await saveAssessment(db, {
          prospect_id: t.id, fit_rating: decision.fit_rating, supporting_ids: supporting,
          weakening_ids: [], uncertainties: [], missing_info: [],
          rationale: `${prop?.rationale ?? "model assessment"} [verdict: ${decision.verdict} — ${decision.reason}]`,
          model_id: modelId, dimensions: dims, verdict: decision.verdict,
        });
        await persistContacts(db, t.id, prop?.contacts, ownEvidence);
        // Terminal statuses only for decided outcomes; the undecided stay
        // investigating with their verdict recorded on the assessment.
        if (decision.verdict === "qualified" || decision.verdict === "disqualified") {
          await setProspectStatus(db, budgets.run_id, t.id, decision.verdict);
        }
        done += 1;
      } catch (e) {
        if (e instanceof DbValidationError) {
          try {
            await setProspectStatus(db, budgets.run_id, t.id, "disqualified");
          } catch {
            /* already there via a concurrent runner — still counts as handled */
          }
          done += 1;
          continue;
        }
        throw e;
      }
      continue;
    }
    // Legacy path (no dimensions or no brief): rating + support cap as before.
    const capped = supporting.length === 0 ? Math.min(rating, 2) : rating;
    try {
      await saveAssessment(db, {
        prospect_id: t.id, fit_rating: capped, supporting_ids: supporting,
        weakening_ids: [], uncertainties: [], missing_info: [],
        rationale: prop?.rationale ?? "default assessment: thin evidence", model_id: modelId,
      });
      await setProspectStatus(db, budgets.run_id, t.id, capped >= 3 ? "qualified" : "disqualified");
      done += 1;
    } catch (e) {
      if (e instanceof DbValidationError) {
        try {
          await setProspectStatus(db, budgets.run_id, t.id, "disqualified");
        } catch {
          /* already there via a concurrent runner — still counts as handled */
        }
        done += 1;
        continue;
      }
      throw e;
    }
  }
  await logActivity(db, { run_id: budgets.run_id, event: "assessed", note: `${done} assessed` });
  return completed(`${done} prospects assessed`);
}

/**
 * Deterministic quality signals for the agentic QA loop. Junk = every
 * evidence url is a directory host (aggregator profiles are pages ABOUT
 * businesses; they reached the shortlist before). Good = latest assessment
 * fit >= 3 and not disqualified and not junk. Pure function, unit-tested.
 */
export function isJunkProspect(p: Prospect, evidence: Evidence[]): boolean {
  const ids = new Set(p.evidence_ids);
  const urls = evidence
    .filter((e) => ids.has(e.id) && e.source_url)
    .map((e) => e.source_url as string);
  return urls.length > 0 && urls.every((u) => isDirectoryHost(u));
}

/**
 * Ingest gate for candidate names (owner report 2026-11-03: "admin",
 * "Lagos Events Calendar", "13 Top Family-Friendly Activities in Lagos",
 * "Terms of Agreement HC052024" and bare "Halls" reached the shortlist —
 * search-result PAGE TITLES, not businesses). Pure + unit-tested; discover
 * skips non-plausible names (their evidence rows stay for the trail).
 */
/**
 * Candidate-name normalization for names harvested from page chrome: nav
 * suffixes (", Home", " - Home") and nav prefixes ("About Vala Homes") are
 * page furniture, not the business name.
 */
export function normalizeCandName(raw: string): string {
  let name = String(raw ?? "").trim();
  name = name.replace(/\s*[|,\-–»>]\s*home\s*$/i, "").trim();
  name = name.replace(/^(?:about|meet|welcome to)\s+/i, "").trim();
  return name;
}

export function plausibleBusinessName(raw: string): boolean {
  const name = normalizeCandName(raw);
  if (name.length < 3 || name.length > 80) return false;
  if (!/[a-z]/i.test(name)) return false;
  if (/^\d/.test(name)) return false; // "13 Top ..." — listicles
  const low = name.toLowerCase();
  if (/\b(calendar|directory|listings?|wikipedia|jotform|admin|login|sign in|sign up|blog|news|jobs|vacanc\w*|careers|about us|contact us|home page|events? in|activities in|things to do|places (for|to)|most reviewed|guide to|list of|big list|detailed information|alternatives? (and|for|to)|radar from|worldwide sites|reviews?|short let|available)\b/.test(low)) return false;
  if (/\b(terms|privacy|cookies?)\b/.test(low)) return false;
  if (/\btop\s+\d+\b/.test(low) || /\bbest\s+\d+\b/.test(low)) return false;
  if (/\(\s*\d*\s*(available|reviews)\s*\)/i.test(name)) return false; // "(10 available)"
  // A bare dotted string with no space is a domain, not a business name
  // ("techpoint.africa").
  if (!/\s/.test(name) && /\.[a-z]{2,}$/i.test(name)) return false;
  // Listing-shaped names: a generic plural category followed by "in <place>"
  // ("Office Spaces in Oregun", "Coworking spaces in Ikeja and environs").
  if (/\b(spaces?|workspaces?|offices?|rooms?|venues?|centres?|centers?|halls?)\b[^,;.]*\bin\b/.test(low)) return false;
  // One generic word is a page fragment, not a business ("Play", "Halls").
  const words = low.split(/[^a-z0-9&']+/).filter(Boolean);
  const GENERIC = new Set(["play", "hall", "halls", "event", "events", "fun", "conference", "venue", "venues", "place", "centre", "center", "home", "about", "contact", "admin", "page"]);
  if (words.length === 1 && GENERIC.has(String(words[0]))) return false;
  // A name whose EVERY word is a generic category word is a category page,
  // not a business ("WEDDING PLANNERS", "Meeting Room", "Shared Workspace").
  const CATS = new Set(["wedding", "weddings", "event", "events", "planners", "planning", "spaces", "space", "workspace", "workspaces", "shared", "coworking", "co", "working", "office", "offices", "meeting", "rooms", "room", "venue", "venues", "services", "service", "centre", "centers", "center", "creative", "let", "lettings", "agency"]);
  const ws = low.split(/[^a-z]+/).filter(Boolean);
  if (ws.length >= 2 && ws.every((w) => CATS.has(w))) return false;
  // Listing-inventory titles: "<property type> … in <place>" are portal
  // inventory pages, never organisations ("Houses in Estates, Port
  // Harcourt, Rivers", "Terraced Duplexes in Wuse, Abuja", "Serviced Shops
  // in Wuse 2", "Prime Land in Trans Woji Port Harcourt").
  if (/\b(houses?|flats?|apartments?|duplex(?:es)?|detached|terraced|semi[- ]?detached|bungalows?|penthouses?|lands?|plots?|acres?|shops?|offices?|spaces?|warehouses?|shortlets?|serviced\s+\w+)\b[^,;.]{0,80}\b(?:in|at|near|around)\b/.test(low)) return false;
  // Generic organisation-in-place titles ("Real Estate Company in Abuja",
  // "Property Developers in Maitama District, Abuja").
  if (/\b(?:real\s+estate|property|properties)\s+(?:company|developers?|agents?|agencies|consultants?|firms?|brokers?|experts?)\b/.test(low) && /\bin\b/.test(low)) return false;
  // Marketing phrases and verb openings ("Own Your Dream Home in Abuja",
  // "Turning Your Lemons Into Lemonades"): a business name is a noun phrase.
  if (/^(?:own|buy|rent|sell|find|discover|explore|get|invest(?:ing)?|learn|join|read|see|view|download|welcome|turning|making|building|creating|grow(?:ing)?|crises|crisis)\b/.test(low)) return false;
  if (/\byour\b/.test(low)) return false; // second-person copy, never a name
  if (/\bbreeds?\b/.test(low)) return false; // sentence-shaped junk ("Crises Breed Opportunities")
  // Document artifacts ("PowerPoint Presentation", "…Brochure").
  if (/\b(powerpoint|presentation|brochure|flyer|catalogue|webinar|slides?)\b/.test(low)) return false;
  // Pagination ghosts ("Prime Waters Properties in 3" = listing page 3).
  if (/\b(?:in|page)\s+\d{1,2}$/.test(low)) return false;
  // Marketing-claim sentences ("Legrande Properties. The best real estate
  // development company") and year-guides ("A 2026 Property Buyer's Guide").
  if (/\b(?:the best|top[- ]rated|leading|award[- ]winning|number one|no\.?\s*1)\b/.test(low)) return false;
  if (/\b(?:19|20)\d{2}\b/.test(low) && /\bguide\b/.test(low)) return false;
  if (/\bbuyer'?s? guide\b/.test(low)) return false;
  // A name whose EVERY word is a generic org/trade word has no brand
  // ("Real Estate Company").
  const ORG = new Set(["real", "estate", "company", "companies", "properties", "property", "agency", "agencies", "broker", "brokers", "brokerage", "homes", "home", "house", "houses", "consultant", "consultants", "services", "service", "developers", "developer", "realtor", "realtors", "realty", "team", "solutions"]);
  const orgWords = low.split(/[^a-z]+/).filter(Boolean);
  if (orgWords.length >= 2 && orgWords.every((w) => ORG.has(w))) return false;
  return true;
}

export interface RunQuality {
  good: number; junk: number; candidates: number; unlocated: number;
  goodNames: string[]; junkNames: string[];
}

export function runQuality(
  prospects: Prospect[],
  amap: Map<string, Assessment & { supporting: string[] }>,
  evidence: Evidence[],
): RunQuality {
  let good = 0, junk = 0, unlocated = 0;
  const goodNames: string[] = [];
  const junkNames: string[] = [];
  for (const p of prospects) {
    if (isJunkProspect(p, evidence)) {
      junk += 1;
      if (junkNames.length < 5) junkNames.push(p.name);
      continue;
    }
    const a = amap.get(p.id);
    if (p.status !== "disqualified" && (a?.fit_rating ?? 0) >= 3) {
      good += 1;
      if (goodNames.length < 5) goodNames.push(p.name);
    }
    if (!p.location || Object.keys(p.location).length === 0) unlocated += 1;
  }
  return { good, junk, candidates: prospects.length, unlocated, goodNames, junkNames };
}

// --- rank ---------------------------------------------------------------------

export interface MergeProposal { from_id: string; into_id: string; rationale: string; evidence_ids: string[] }

export async function fetchAssessmentMap(db: Db, prospectIds: string[]): Promise<Map<string, Assessment & { supporting: string[] }>> {
  const map = new Map<string, Assessment & { supporting: string[] }>();
  for (const pid of prospectIds) {
    const { results } = await db.prepare("SELECT * FROM assessment WHERE prospect_id = ?")
      .bind(pid).all<Record<string, unknown>>();
    const rows = [...results].sort((a, b) => String(a["created_at"]).localeCompare(String(b["created_at"])));
    const latest = rows[rows.length - 1];
    if (latest) {
      map.set(pid, {
        id: latest["id"] as string, prospect_id: pid,
        fit_rating: latest["fit_rating"] as 1 | 2 | 3 | 4 | 5,
        supporting_evidence_ids: JSON.parse((latest["supporting_evidence_ids"] as string) ?? "[]") as string[],
        weakening_evidence_ids: JSON.parse((latest["weakening_evidence_ids"] as string) ?? "[]") as string[],
        uncertainties: JSON.parse((latest["uncertainties"] as string) ?? "[]") as string[],
        missing_info: JSON.parse((latest["missing_info"] as string) ?? "[]") as string[],
        rationale: latest["rationale"] as string, model_id: latest["model_id"] as string,
        created_at: latest["created_at"] as string,
        ...(typeof latest["verdict"] === "string" ? { verdict: latest["verdict"] } : {}),
        ...(typeof latest["dimensions"] === "string" && latest["dimensions"] !== "null"
          ? {
              dimensions: JSON.parse(latest["dimensions"]) as {
                icp_fit: number; problem: number; readiness: number; reachability: number; confidence: number;
              },
            }
          : {}),
        supporting: JSON.parse((latest["supporting_evidence_ids"] as string) ?? "[]") as string[],
      });
    }
  }
  return map;
}

/**
 * applyMerges: model-proposed cross-key merges apply only with recorded
 * rationale + supporting evidence, else rejected with reason.
 */
export async function applyMerges(
  db: Db, run_id: string, proposals: MergeProposal[],
): Promise<{ applied: number; rejected: Array<{ proposal: MergeProposal; reason: string }> }> {
  let applied = 0;
  const rejected: Array<{ proposal: MergeProposal; reason: string }> = [];
  for (const m of proposals) {
    if (!m.rationale || m.evidence_ids.length === 0) {
      rejected.push({ proposal: m, reason: "merge requires rationale + supporting evidence" });
      continue;
    }
    const from = await db.prepare("SELECT id, run_id FROM prospect WHERE id = ?").bind(m.from_id)
      .first<{ id: string; run_id: string }>();
    const into = await db.prepare("SELECT id, run_id FROM prospect WHERE id = ?").bind(m.into_id)
      .first<{ id: string; run_id: string }>();
    if (!from || !into || from.run_id !== run_id || into.run_id !== run_id) {
      rejected.push({ proposal: m, reason: "merge targets must exist in this run" });
      continue;
    }
    for (const eid of m.evidence_ids) {
      const found = await db.prepare("SELECT id FROM evidence WHERE id = ? AND run_id = ?").bind(eid, run_id)
        .first<string>("id");
      if (!found) {
        rejected.push({ proposal: m, reason: `evidence ${eid} does not exist in this run` });
        continue;
      }
    }
    if (rejected.length > 0 && rejected[rejected.length - 1]?.proposal === m) continue;
    await logActivity(db, { run_id, prospect_id: m.into_id, event: "created", note: `dedupe merge: ${m.from_id} -> ${m.into_id}: ${m.rationale}` });
    try {
      await setProspectStatus(db, run_id, m.from_id, "disqualified");
    } catch { /* already terminal — merge note still stands */ }
    applied += 1;
  }
  return { applied, rejected };
}

/**
 * rank: deterministic dedupe-aware ordering by rating then evidence strength,
 * shortlist cut (default 5–8 → here: top 8, min 0); shortlisted status set;
 * per-item rationale references evidence ids (via meta.rationales when given).
 */
export async function rank(
  brief: Brief, db: Db, meta: MetaClient, budgets: BudgetState & { run_id: string },
  opts?: { shortlistN?: number; merges?: MergeProposal[] },
): Promise<PhaseOutcome> {
  void brief;
  const breach = firstBreach(budgets.consumed, budgets.caps);
  if (breach) return stopped(breach, "budget breached before rank");
  if (opts?.merges && opts.merges.length > 0) {
    await applyMerges(db, budgets.run_id, opts.merges);
  }
  const prospects = await listProspects(db, budgets.run_id);
  const evidence = await listEvidence(db, budgets.run_id);
  const amap = await fetchAssessmentMap(db, prospects.map((p) => p.id));
  // Containment merge: "De Renaissance" and "De Renaissance Hotel" are one
  // venue with two names — both reached the shortlist before. The higher-fit
  // name absorbs the loser's evidence; the loser leaves the shortlist path.
  const cands = prospects.filter((p) => p.status === "qualified" || p.status === "investigating");
  const absorbed = new Set<string>();
  for (let i = 0; i < cands.length; i += 1) {
    const ci = cands[i];
    if (!ci || absorbed.has(ci.id)) continue;
    for (let j = i + 1; j < cands.length; j += 1) {
      const cj = cands[j];
      if (!cj || absorbed.has(cj.id)) continue;
      const a = ci.name.toLowerCase().trim();
      const b = cj.name.toLowerCase().trim();
      if (a === b || (!a.includes(b) && !b.includes(a))) continue;
      const fitA = amap.get(ci.id)?.fit_rating ?? 0;
      const fitB = amap.get(cj.id)?.fit_rating ?? 0;
      const winner = fitB > fitA ? cj : ci;
      const loser = winner === ci ? cj : ci;
      absorbed.add(loser.id);
      try {
        const winRow = await db.prepare("SELECT evidence_ids FROM prospect WHERE id = ?")
          .bind(winner.id).first<{ evidence_ids: string }>();
        const winIds: string[] = (() => {
          try { const parsed: unknown = JSON.parse(winRow?.evidence_ids ?? "[]"); return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []; } catch { return []; }
        })();
        const union = [...new Set([...winIds, ...loser.evidence_ids])];
        await db.prepare("UPDATE prospect SET evidence_ids = ? WHERE id = ?").bind(JSON.stringify(union), winner.id).run();
        await logActivity(db, {
          run_id: budgets.run_id, prospect_id: winner.id, event: "created",
          note: `contained-name merge: ${loser.name} -> ${winner.name}`,
        });
        await setProspectStatus(db, budgets.run_id, loser.id, "disqualified").catch(() => { /* best-effort */ });
      } catch (e) {
        if (!(e instanceof DbValidationError)) throw e;
      }
    }
  }
  // Junk gate: directory-aggregator profiles reached the shortlist before
  // (enbizopedia/beautynailhairsalons shipped barbers for a caterer). A
  // prospect whose only evidence lives on directories never joins the list.
  const sellable = (p: (typeof prospects)[number]): boolean => !isJunkProspect(p, evidence)
    && !absorbed.has(p.id);
  const qualified = prospects.filter((p) => p.status === "qualified" && sellable(p));
  // Steady seconds: suitable-but-no-signal prospects (fit + evidence +
  // route, no dated trigger) join the shortlist after the qualified.
  // Nigerian SME triggers are rarely published; withholding drafts from
  // perfect-fit accounts over an unobservable "why now" wastes the run
  // (run_c5d01d96: 6 boutiques at icp_fit 5, zero shortlisted).
  const steady = prospects.filter((p) => p.status === "investigating" && amap.get(p.id)?.verdict === "no_signal" && sellable(p));
  // Honest empty: the dimensional bar may qualify nobody (0/25 on
  // run_5538b2b3). Stopping here throws on the Workflow path and freezes
  // the run; completing lets draft park visibly with per-prospect reasons.
  if (qualified.length === 0 && steady.length === 0) {
    const byStatus = prospects.reduce<Record<string, number>>((m, p) => {
      m[p.status] = (m[p.status] ?? 0) + 1;
      return m;
    }, {});
    await logActivity(db, {
      run_id: budgets.run_id, prospect_id: null,
      event: "shortlisted", note: `empty shortlist: 0 qualified (${JSON.stringify(byStatus)})`,
    });
    return completed("empty shortlist: 0 qualified, see per-prospect verdicts");
  }
  // Deterministic order: qualified first, then steady; rating desc, then
  // evidence strength desc, then name asc within each tier.
  const strength = (pid: string): number => amap.get(pid)?.supporting.length ?? 0;
  const byScore = (a: (typeof prospects)[number], b: (typeof prospects)[number]): number => {
    const ra = amap.get(a.id)?.fit_rating ?? 0;
    const rb = amap.get(b.id)?.fit_rating ?? 0;
    if (rb !== ra) return rb - ra;
    if (strength(b.id) !== strength(a.id)) return strength(b.id) - strength(a.id);
    return a.name.localeCompare(b.name);
  };
  const ordered = [...qualified].sort(byScore).concat([...steady].sort(byScore));
  const n = Math.min(opts?.shortlistN ?? 8, 8, ordered.length);
  const shortlist = ordered.slice(0, Math.max(n, Math.min(5, ordered.length)));
  let rationales: Record<string, string> = {};
  if (meta.rationales) rationales = await meta.rationales(shortlist.map((p) => p.id));
  let i = 0;
  for (const p of shortlist) {
    i += 1;
    try {
      await setProspectStatus(db, budgets.run_id, p.id, "shortlisted");
    } catch (e) {
      if (!(e instanceof DbValidationError)) throw e;
      /* already shortlisted via a concurrent runner — rank still applies */
    }
    await db.prepare("UPDATE prospect SET rank = ? WHERE id = ?").bind(i, p.id).run();
    const r = rationales[p.id] ?? `rank ${i}: rating ${amap.get(p.id)?.fit_rating ?? "?"} evidence [${(amap.get(p.id)?.supporting ?? []).join(",")}]`;
    await logActivity(db, { run_id: budgets.run_id, prospect_id: p.id, event: "shortlisted", note: r });
  }
  return completed(`${shortlist.length} shortlisted`);
}

// --- draft --------------------------------------------------------------------

/**
 * draft: per shortlisted prospect, structured draft + next action →
 * outreach_draft rows + contact_route rows (public_listing only).
 */
export async function draft(
  brief: Brief, db: Db, meta: MetaClient,
  budgets: BudgetState & { run_id: string },
  onlyIds?: string[],
  opts?: { onDemand?: boolean },
): Promise<PhaseOutcome> {
  void brief;
  const breach = firstBreach(budgets.consumed, budgets.caps);
  if (breach) return stopped(breach, "budget breached before draft");
  const prospects = await listProspects(db, budgets.run_id);
  // Everyone reachable gets a message draft (owner report 2026-11-03: picks
  // on the shortlist dead-ended with "no draft yet") — not just the
  // rank-shortlisted elite. Reachable = owns a contact route, or was
  // rank-shortlisted. onlyIds scopes an on-demand top-up from the studio.
  // Routes are scoped to THIS run (owner bug 2026-11-04: the raw route
  // scan crossed runs); the intersection happens in JS because the
  // prospects list is already run-scoped.
  const routeRows = await db.prepare("SELECT prospect_id FROM contact_route").all<{ prospect_id: string }>();
  const runProspectIds = new Set(prospects.map((p) => p.id));
  const routeIds = new Set(
    (routeRows.results ?? [])
      .map((r) => String(r["prospect_id"]))
      .filter((id) => runProspectIds.has(id)),
  );
  let targets = prospects.filter((p) =>
    p.status !== "disqualified" && (routeIds.has(p.id) || p.status === "shortlisted"));
  if (onlyIds && onlyIds.length > 0) targets = targets.filter((t) => onlyIds.indexOf(t.id) >= 0);
  // Honest empty: nothing shortlisted (rank already logged why). Park at
  // awaiting_approval like the normal path so the run completes visibly
  // instead of freezing mid-flight on the Workflow path — but NEVER from
  // the studio's on-demand top-up: that must not touch a live run's status
  // (owner bug 2026-11-04: a mid-run top-up hijacked a running run).
  if (targets.length === 0) {
    if (!opts?.onDemand) {
      try {
        await setRunStatus(db, budgets.run_id, "awaiting_approval");
      } catch { /* best-effort; gate still waits */ }
    }
    return completed("0 drafts written; empty shortlist awaiting review");
  }
  const allEvidence = await listEvidence(db, budgets.run_id);
  const runEvidence = allEvidence.filter((e) => e.run_id === budgets.run_id);
  let proposals: DraftProposal[];
  try {
    if (meta.proposeDrafts) {
      proposals = await meta.proposeDrafts(targets, runEvidence);
      budgets.consumed.tool_rounds += 1;
      // One retry: empty bursts happen (run_de5e566e wrote 0 drafts when
      // the model returned nothing usable for its only target).
      if (!targets.some((t) => proposals.some((x) => x.prospect_id === t.id))) {
        proposals = await meta.proposeDrafts(targets, runEvidence);
        budgets.consumed.tool_rounds += 1;
      }
    } else {
      const first = allEvidence[0];
      proposals = targets.map((t) => ({
        prospect_id: t.id, channel: "website_form" as const, contact_value: "https://example.com/contact",
        subject: `Hello ${t.name}`, body: `Hi ${t.name}, see [${first?.id ?? "ev_x"}].`,
        next_action: "Send intro", follow_up_days: 7,
      }));
    }
  } catch (e) {
    return stopped("draft_failed", e instanceof Error ? e.message : "draft burst failed");
  }
  let done = 0;
  for (const t of targets) {
    const prop = proposals.find((x) => x.prospect_id === t.id);
    if (!prop) {
      await logActivity(db, { run_id: budgets.run_id, prospect_id: t.id, event: "deferred", note: "draft skipped: no proposal from burst" });
      continue;
    }
    const ownIds = new Set(t.evidence_ids);
    const ownEvidence = allEvidence.filter((e) => e.run_id === budgets.run_id && ownIds.has(e.id));
    if (ownEvidence.length === 0) {
      await logActivity(db, { run_id: budgets.run_id, prospect_id: t.id, event: "deferred", note: "draft skipped: no auditable evidence" });
      continue;
    }
    // Audit claimed support: foreign ids are an instant skip; then the body
    // must link to own evidence (fuzzy chunks) or carry a bracket marker
    // (trusted-but-bound to own rows for human review). Unlinked bodies
    // are skipped, never stored as grounded drafts.
    if (prop.supporting_ids !== undefined && prop.supporting_ids.some((id) => !ownIds.has(id))) {
      await logActivity(db, { run_id: budgets.run_id, prospect_id: t.id, event: "deferred", note: `draft skipped: supporting_ids not owned (${prop.supporting_ids.join(", ").slice(0, 200)})` });
      continue;
    }
    const chunks = prop.body.split(/[.!?;\n]+/).map((s) => s.trim()).filter((s) => s.length > 0);
    const linked = linkTextsToEvidence(chunks, ownEvidence);
    const marked = CITATION_MARKER.test(prop.body) ? ownEvidence.map((e) => e.id) : [];
    const support = [...new Set([...(prop.supporting_ids ?? []), ...linked, ...marked])];
    if (support.length === 0) {
      await logActivity(db, { run_id: budgets.run_id, prospect_id: t.id, event: "deferred", note: "draft skipped: body links to no own evidence" });
      continue;
    }
    // Contact grounding: model-proposed values must appear in the prospect's
    // own evidence text; otherwise the draft is kept but no route is invented.
    const texts = ownEvidence.map((e) => `${e.claim}\n${e.quote}`);
    const grounded = isGroundedContact(prop.contact_value, texts);
    const routeEv = ownEvidence.find((e) => e.source_type === "fetched_page") ?? ownEvidence[0];
    try {
      if (grounded && routeEv) {
        await saveRoute(db, { prospect_id: t.id, channel: prop.channel, value: prop.contact_value, evidence_id: routeEv.id });
      } else {
        await logActivity(db, { run_id: budgets.run_id, prospect_id: t.id, event: "drafted", note: "contact ungrounded: route withheld" });
      }
      await saveDraft(db, {
        prospect_id: t.id, channel_suggestion: prop.channel_suggestion ?? prop.channel,
        subject: prop.subject ?? null, body: prop.body, next_action: prop.next_action,
        ...(prop.angle ? { angle: prop.angle } : {}),
        ...(prop.follow_up_days !== undefined ? { follow_up_days: prop.follow_up_days } : {}),
        ...(prop.variants ? { variants: prop.variants } : {}),
      });
      await logActivity(db, { run_id: budgets.run_id, prospect_id: t.id, event: "drafted", note: null });
      done += 1;
    } catch (e) {
      if (e instanceof DbValidationError) {
        // A rejection is VISIBLE (owner bug 2026-11-04: silent mass-skips
        // made "0 drafts" look like nothing happened at all).
        await logActivity(db, {
          run_id: budgets.run_id, prospect_id: t.id, event: "deferred",
          note: `draft rejected: ${e.message.slice(0, 160)}`,
        }).catch(() => { /* logging never blocks the run */ });
        continue;
      }
      throw e;
    }
  }
  // Park the run for review on the WORKFLOW path only — the studio's
  // on-demand top-up must never rewind a completed (or live) run.
  if (!opts?.onDemand) {
    try {
      await setRunStatus(db, budgets.run_id, "awaiting_approval");
    } catch { /* best-effort; gate still waits */ }
  }
  return completed(`${done}/${targets.length} drafts written (${proposals.length} proposals); awaiting approval`);
}

// --- close --------------------------------------------------------------------

/** close: all drafts decided → run complete; activity log appended. */
export async function close(
  db: Db, budgets: BudgetState & { run_id: string }, drafts: DraftRow[],
): Promise<PhaseOutcome> {
  const gate = draftGateDecision(drafts);
  if (gate.wait) return stopped("awaiting_approval", `${gate.pending} drafts undecided; waiting`);
  try {
    await setRunStatus(db, budgets.run_id, "complete");
  } catch (e) {
    if (e instanceof DbValidationError) return stopped("close_failed", e.message);
    throw e;
  }
  await logActivity(db, { run_id: budgets.run_id, event: "approved", note: "run complete" });
  return completed("run complete");
}

export { listAssessments };
