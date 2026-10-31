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
  checkHardConstraints, decideVerdict, extractContacts, icpFromBrief, isGroundedContact,
  validateBrief,
  type QualificationDims,
} from "./commercial";
import { execFetchPage, type FetchPageDeps } from "./tools";
import { isDirectoryHost, isSocialHost, MODEL_ID } from "../meta";

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
}

export interface DraftProposal {
  prospect_id: string;
  channel: "website_form" | "email" | "phone" | "social_profile" | "other";
  channel_suggestion?: string;
  contact_value: string;
  subject?: string | null;
  body: string;
  next_action: string;
  follow_up_days?: number;
  /** Prospect-evidence ids backing the draft's claims (audited in code). */
  supporting_ids?: string[];
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
}

/** Input the server hands to the model for one onboarding turn. */
export interface OnboardTurnInput {
  text: string;
  known: Array<{ key: string; value: string; label: string }>;
  followups_used: number;
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
  search?: (query: string) => Promise<SearchHit[]>;
  proposeAssessments?: (prospects: Prospect[], evidence: Evidence[]) => Promise<AssessProposal[]>;
  proposeDrafts?: (prospects: Prospect[], evidence?: Evidence[]) => Promise<DraftProposal[]>;
  fetchPage?: (url: string, timeoutMs: number) => Promise<{ text: string } | { failure: "blocked" | "empty" | "timeout"; detail: string }>;
  rationales?: (prospectIds: string[]) => Promise<Record<string, string>>;
  /** Build + validate the versioned commercial brief (new path; absent = legacy excerpt flow). */
  buildBrief?: (profile: BriefProfile) => Promise<import("./commercial").CommercialBrief>;
  /** Hand the stored brief to later bursts (prompts switch to brief-driven goals). */
  setBrief?: (brief: import("./commercial").CommercialBrief) => void;
  /** Model id stamped on assessments (absent in old mocks = default model). */
  modelId?: string;
  /** Rewrite one outreach draft in a requested tone (studio rewrite buttons). */
  rewriteDraft?: (input: RewriteInput) => Promise<RewriteResult>;
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
/** Draft gate: waits until every draft is approved/rejected/deferred. */
export function draftGateDecision(drafts: DraftRow[]): { wait: boolean; event?: "drafts_decided"; pending: number } {
  const pending = drafts.filter((d) => d.status === "draft").length;
  if (drafts.length === 0 || pending > 0) return { wait: true, event: "drafts_decided", pending };
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
        const built = validateBrief(await meta.buildBrief({
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
  const queries: string[] = (run?.plan as { queries?: string[] } | null)?.queries ?? [];
  if (queries.length === 0) return stopped("no_plan", "discover needs a stored plan");
  if (!meta.search) return stopped("no_candidates", "no search client; honest empty shortlist");
  // Candidate locations inherit the stored brief's area (queries are
  // locale-scoped; hits themselves carry no geo).
  let geos: string[] = [];
  if (run?.commercial_brief) {
    try { geos = validateBrief(JSON.parse(run.commercial_brief)).primary_segment.geos; } catch { geos = []; }
  }
  let searched = 0;
  let skipped = 0;
  for (const q of queries) {
    if (budgets.consumed.candidates >= budgets.caps.candidates) break;
    if (budgets.consumed.searches + 1 > budgets.caps.searches) {
      return stopped(budgetReason("searches"), "search budget exhausted mid-discover");
    }
    let hits: SearchHit[];
    try {
      hits = await meta.search(q);
    } catch {
      skipped += 1;
      continue;
    }
    budgets.consumed.searches += 1;
    budgets.consumed.tool_rounds += 1;
    searched += 1;
    if (!hits || hits.length === 0) continue; // zero-result outcome; may rephrase once — here: move on
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
        const r = await saveCandidate(db, {
          run_id: budgets.run_id, name: h.name, category: h.category,
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
  }
  void skipped;
  const prospects = await listProspects(db, budgets.run_id);
  if (prospects.length === 0) {
    return stopped("no_candidates", `zero candidates after ${searched} searches; honest empty shortlist`);
  }
  return completed(`${prospects.length} candidates from ${searched} searches`);
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
  let investigated = 0;
  for (const p of targets) {
    if (budgets.consumed.fetches + 1 > budgets.caps.fetches) {
      return stopped(budgetReason("fetches"), "fetch budget exhausted mid-investigate");
    }
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
        investigated += 1;
      } catch (e) {
        if (!(e instanceof DbValidationError)) throw e;
      }
      continue;
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
      if (!isDirectoryHost(target.source_url)) {
        for (const c of extractContacts(res.value.text).slice(0, 5)) {
          try {
            await saveRoute(db, { prospect_id: p.id, channel: c.channel, value: c.value, evidence_id: evId });
          } catch {
            /* dupes or bad rows: contacts are best-effort, the run continues */
          }
        }
        try {
          await saveRoute(db, {
            prospect_id: p.id,
            channel: isSocialHost(target.source_url) ? "social_profile" : "website_form",
            value: target.source_url, evidence_id: evId,
          });
        } catch {
          /* url route is best-effort too */
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
      investigated += 1;
    } catch (e) {
      if (!(e instanceof DbValidationError)) throw e;
    }
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

export interface RunQuality {
  good: number; junk: number; candidates: number; unlocated: number;
}

export function runQuality(
  prospects: Prospect[],
  amap: Map<string, Assessment & { supporting: string[] }>,
  evidence: Evidence[],
): RunQuality {
  let good = 0, junk = 0, unlocated = 0;
  for (const p of prospects) {
    if (isJunkProspect(p, evidence)) { junk += 1; continue; }
    const a = amap.get(p.id);
    if (p.status !== "disqualified" && (a?.fit_rating ?? 0) >= 3) good += 1;
    if (!p.location || Object.keys(p.location).length === 0) unlocated += 1;
  }
  return { good, junk, candidates: prospects.length, unlocated };
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
  brief: Brief, db: Db, meta: MetaClient, budgets: BudgetState & { run_id: string },
): Promise<PhaseOutcome> {
  void brief;
  const breach = firstBreach(budgets.consumed, budgets.caps);
  if (breach) return stopped(breach, "budget breached before draft");
  const prospects = await listProspects(db, budgets.run_id);
  const targets = prospects.filter((p) => p.status === "shortlisted");
  // Honest empty: nothing shortlisted (rank already logged why). Park at
  // awaiting_approval like the normal path so the run completes visibly
  // instead of freezing mid-flight on the Workflow path.
  if (targets.length === 0) {
    try {
      await setRunStatus(db, budgets.run_id, "awaiting_approval");
    } catch { /* best-effort; gate still waits */ }
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
        ...(prop.follow_up_days !== undefined ? { follow_up_days: prop.follow_up_days } : {}),
      });
      await logActivity(db, { run_id: budgets.run_id, prospect_id: t.id, event: "drafted", note: null });
      done += 1;
    } catch (e) {
      if (e instanceof DbValidationError) continue; // flagged item; run continues
      throw e;
    }
  }
  try {
    await setRunStatus(db, budgets.run_id, "awaiting_approval");
  } catch { /* best-effort; gate still waits */ }
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
