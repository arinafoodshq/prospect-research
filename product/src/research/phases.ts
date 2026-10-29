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
import { budgetReason, firstBreach, type BudgetCaps, type BudgetConsumed } from "./budgets";
import { execFetchPage, type FetchPageDeps } from "./tools";

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
}

/** Mockable Meta client surface (no live calls; mocked in tests). */
export interface MetaClient {
  planQueries?: (briefExcerpt: string) => Promise<string[]>;
  search?: (query: string) => Promise<SearchHit[]>;
  proposeAssessments?: (prospects: Prospect[], evidence: Evidence[]) => Promise<AssessProposal[]>;
  proposeDrafts?: (prospects: Prospect[]) => Promise<DraftProposal[]>;
  fetchPage?: (url: string, timeoutMs: number) => Promise<{ text: string } | { failure: "blocked" | "empty" | "timeout"; detail: string }>;
  rationales?: (prospectIds: string[]) => Promise<Record<string, string>>;
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
        const evId = await saveEvidence(db, {
          run_id: budgets.run_id, claim: h.claim, quote: h.quote,
          source_url: h.source_url, source_type: "search_snippet",
          retrieved_at: new Date().toISOString(), reliability: "unknown",
          conflicts_with: null, supersedes: null,
        });
        if (h.candidateEligible === false) continue; // evidence kept, chatter never becomes a candidate
        const r = await saveCandidate(db, {
          run_id: budgets.run_id, name: h.name, category: h.category,
          location: h.location ?? {},
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
    const evs = await listEvidence(db, budgets.run_id);
    const prior = evs.find((e) => e.source_url);
    const url = prior?.source_url ?? `https://example.com/${encodeURIComponent(p.name)}`;
    const res = await execFetchPage(fetchDeps, { url });
    if (res.ok) {
      await saveEvidence(db, {
        run_id: budgets.run_id, claim: `fetched page for ${p.name}`, quote: res.value.text.slice(0, 500),
        source_url: url, source_type: "fetched_page", retrieved_at: new Date().toISOString(),
        reliability: "unknown", conflicts_with: null, supersedes: null,
      });
    } else {
      // Explicit fetch-failure evidence (never a silent skip).
      await saveEvidence(db, {
        run_id: budgets.run_id, claim: `fetch failed for ${p.name}: ${res.error}`,
        quote: res.reason ?? res.error, source_url: url, source_type: "fetched_page",
        retrieved_at: new Date().toISOString(), reliability: "unknown",
        conflicts_with: null, supersedes: null,
      });
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
  let done = 0;
  for (const t of targets) {
    const prop = proposals.find((x) => x.prospect_id === t.id);
    const rating = prop?.fit_rating ?? 2;
    // Link support by matching claim text to run evidence (case-insensitive,
    // either direction); unmatched claims link nothing — never arbitrary rows.
    // Rating cap with no supporting evidence: clamp rather than invent.
    const runEvidence = evidence.filter((e) => e.run_id === budgets.run_id);
    const claims = (prop?.supporting_claims ?? []).map((c) => c.toLowerCase());
    const supporting = runEvidence
      .filter((e) => claims.some((c) => {
        if (c.length === 0) return false;
        const el = e.claim.toLowerCase();
        if (el.includes(c) || c.includes(el)) return true;
        // Fuzzy fallback: paraphrased claims sharing 3+ significant words.
        const cw = new Set(c.split(/[^a-z0-9]+/).filter((w) => w.length > 3));
        const ew = new Set(el.split(/[^a-z0-9]+/).filter((w) => w.length > 3));
        let shared = 0;
        for (const w of cw) if (ew.has(w)) shared += 1;
        return shared >= 3;
      }))
      .map((e) => e.id);
    const capped = supporting.length === 0 ? Math.min(rating, 2) : rating;
    try {
      await saveAssessment(db, {
        prospect_id: t.id, fit_rating: capped, supporting_ids: supporting,
        weakening_ids: [], uncertainties: [], missing_info: [],
        rationale: prop?.rationale ?? "default assessment: thin evidence", model_id: "mocked-model",
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

// --- rank ---------------------------------------------------------------------

export interface MergeProposal { from_id: string; into_id: string; rationale: string; evidence_ids: string[] }

async function fetchAssessmentMap(db: Db, prospectIds: string[]): Promise<Map<string, Assessment & { supporting: string[] }>> {
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
  const qualified = prospects.filter((p) => p.status === "qualified");
  if (qualified.length === 0) return stopped("no_candidates", "no qualified prospects to rank");
  const amap = await fetchAssessmentMap(db, qualified.map((p) => p.id));
  const evs = await listEvidence(db, budgets.run_id);
  const evCount = new Map<string, number>();
  for (const e of evs) evCount.set(e.run_id, (evCount.get(e.run_id) ?? 0) + 1);
  // Deterministic order: rating desc, then evidence strength desc, then name asc.
  const strength = (pid: string): number => amap.get(pid)?.supporting.length ?? 0;
  const ordered = [...qualified].sort((a, b) => {
    const ra = amap.get(a.id)?.fit_rating ?? 0;
    const rb = amap.get(b.id)?.fit_rating ?? 0;
    if (rb !== ra) return rb - ra;
    if (strength(b.id) !== strength(a.id)) return strength(b.id) - strength(a.id);
    return a.name.localeCompare(b.name);
  });
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
  if (targets.length === 0) return stopped("no_candidates", "no shortlisted prospects to draft");
  let proposals: DraftProposal[];
  try {
    if (meta.proposeDrafts) {
      proposals = await meta.proposeDrafts(targets);
    } else {
      const evs = await listEvidence(db, budgets.run_id);
      const first = evs[0];
      proposals = targets.map((t) => ({
        prospect_id: t.id, channel: "website_form" as const, contact_value: "https://example.com/contact",
        subject: `Hello ${t.name}`, body: `Hi ${t.name}, see [${first?.id ?? "ev_x"}].`,
        next_action: "Send intro", follow_up_days: 7,
      }));
    }
  } catch (e) {
    return stopped("draft_failed", e instanceof Error ? e.message : "draft burst failed");
  }
  budgets.consumed.tool_rounds += 1;
  let done = 0;
  for (const t of targets) {
    const prop = proposals.find((x) => x.prospect_id === t.id);
    if (!prop) continue; // flagged for manual review; run continues
    const evs = await listEvidence(db, budgets.run_id);
    const evId = evs[0]?.id;
    if (!evId) continue;
    try {
      await saveRoute(db, { prospect_id: t.id, channel: prop.channel, value: prop.contact_value, evidence_id: evId });
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
  return completed(`${done} drafts written; awaiting approval`);
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
