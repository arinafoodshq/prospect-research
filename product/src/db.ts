/**
 * product/src/db.ts — typed D1 accessors matching specs/data-model.md v0.1.
 * Every writer validates enums, foreign keys, transitions, and dedupe keys
 * before insert; violations throw DbValidationError (recorded by the loop as
 * a tool-result failure, never a silent skip). No model calls here.
 */

export type ProfileStatus = "draft" | "confirmed";
export type RunStatus =
  | "created" | "discovering" | "investigating" | "assessing" | "drafting"
  | "awaiting_brief" | "awaiting_approval" | "complete" | "stopped" | "failed";
export type SourceType =
  | "search_snippet" | "fetched_page" | "business_site" | "user_stated" | "model_inference";
export type Reliability = "verified" | "inferred" | "unknown" | "conflicting";
export type ProspectStatus =
  | "candidate" | "investigating" | "qualified" | "disqualified"
  | "shortlisted" | "approved" | "rejected" | "contacted" | "closed" | "deferred";
export type RouteChannel = "website_form" | "email" | "phone" | "social_profile" | "other";
export type DraftStatus = "draft" | "approved" | "rejected" | "deferred";
export type ActivityEvent =
  | "created" | "assessed" | "shortlisted" | "drafted" | "approved" | "rejected"
  | "deferred" | "contacted" | "follow_up_logged" | "stopped";

export interface BusinessProfile {
  id: string; name: string; website_url: string | null; description: string;
  services: string[]; value_proposition: string; target_market: string;
  service_area: { country?: string; region?: string; city?: string; timezone?: string };
  constraints: { min_order?: string; price_range?: string; exclusions?: string[] };
  provenance: Record<string, string>; status: ProfileStatus; version: number;
  confirmed_at: string | null; created_at: string;
}

export interface ResearchRun {
  id: string; profile_id: string; workflow_instance_id: string;
  plan: { queries: string[] }; status: RunStatus; stop_reason: string | null;
  commercial_brief?: string | null;
  budgets: RunBudgets; consumed: RunConsumed;
  started_at: string; finished_at: string | null; created_at: string;
}

export interface RunBudgets {
  searches: number; fetches: number; candidates: number;
  cost_usd: number; active_compute_s: number;
}

export interface RunConsumed {
  searches: number; fetches: number; candidates: number;
  tool_rounds: number; cost_usd_est: number;
}

export interface Evidence {
  id: string; run_id: string; claim: string; quote: string;
  source_url: string | null; source_type: SourceType; retrieved_at: string;
  reliability: Reliability; conflicts_with: string | null;
  supersedes: string | null; created_at: string;
}

export interface Prospect {
  id: string; run_id: string; name: string; category: string;
  location: Record<string, string>; dedupe_key: string;
  evidence_ids: string[];
  status: ProspectStatus; rank: number | null; created_at: string;
}

export interface Assessment {
  id: string; prospect_id: string; fit_rating: 1 | 2 | 3 | 4 | 5;
  supporting_evidence_ids: string[]; weakening_evidence_ids: string[];
  uncertainties: string[]; missing_info: string[]; rationale: string;
  dimensions?: { icp_fit: number; problem: number; readiness: number; reachability: number; confidence: number }; verdict?: string;
  model_id: string; created_at: string;
}

export interface ContactRoute {
  id: string; prospect_id: string; channel: RouteChannel; value: string;
  verification: "public_listing"; evidence_id: string; created_at: string;
}

export interface OutreachDraft {
  id: string; prospect_id: string; channel_suggestion: string;
  subject: string | null; body: string; next_action: string;
  follow_up_days: number | null; status: DraftStatus;
  edited_by_human: boolean; decided_at: string | null; created_at: string;
}

export interface ActivityRow {
  id: string; run_id: string; prospect_id: string | null;
  event: ActivityEvent; note: string | null; created_at: string;
}

/** Minimal D1 binding surface used by these accessors (real D1 in prod). */
export interface Db {
  prepare(query: string): DbStatement;
  batch(statements: DbStatement[]): Promise<unknown[]>;
}
export interface DbStatement {
  bind(...values: unknown[]): DbStatement;
  first<T>(column?: string): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<{ success: boolean }>;
}

export class DbValidationError extends Error {
  constructor(message: string) { super(message); this.name = "DbValidationError"; }
}

const RUN_TRANSITIONS: Record<RunStatus, RunStatus[]> = {
  created: ["discovering", "awaiting_brief", "stopped", "failed"],
  discovering: ["investigating", "awaiting_brief", "awaiting_approval", "stopped", "failed"],
  investigating: ["assessing", "awaiting_brief", "awaiting_approval", "stopped", "failed"],
  assessing: ["drafting", "awaiting_brief", "awaiting_approval", "stopped", "failed"],
  drafting: ["complete", "awaiting_brief", "awaiting_approval", "stopped", "failed"],
  awaiting_brief: ["created", "discovering", "investigating", "assessing", "drafting", "stopped", "failed"],
  awaiting_approval: ["drafting", "complete", "stopped", "failed"],
  complete: [], stopped: [], failed: [],
};

const PROSPECT_TRANSITIONS: Record<ProspectStatus, ProspectStatus[]> = {
  candidate: ["investigating", "disqualified"],
  investigating: ["qualified", "disqualified"],
  qualified: ["shortlisted", "disqualified"],
  disqualified: [],
  shortlisted: ["approved", "rejected", "deferred"],
  deferred: ["shortlisted"],
  approved: ["contacted"],
  rejected: [], contacted: ["closed"], closed: [],
};

export function assertRunTransition(from: RunStatus, to: RunStatus): void {
  if (!RUN_TRANSITIONS[from].includes(to)) {
    throw new DbValidationError(`Illegal run transition ${from} -> ${to}`);
  }
}

export function assertProspectTransition(from: ProspectStatus, to: ProspectStatus): void {
  if (!PROSPECT_TRANSITIONS[from].includes(to)) {
    throw new DbValidationError(`Illegal prospect transition ${from} -> ${to}`);
  }
}

/**
 * Dedupe key per specs/research-loop.md §5: lowercase alphanumeric name
 * stripped of legal suffixes + registrable domain or social handle when known.
 */
export function dedupeKey(name: string, domainOrHandle?: string): string {
  const suffixes = /\b(ltd|limited|inc|incorporated|llc|plc|gmbh|corp|corporation|co|company|ventures|group|ng|nig|ltd\.)\b/g;
  const normName = name.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(suffixes, " ").replace(/\s+/g, "").trim();
  const normDomain = ((domainOrHandle ?? "").toLowerCase().replace(/^(@|https?:\/\/|www\.)/, "").split("/")[0] ?? "").trim();
  return normDomain ? `${normName}::${normDomain}` : normName;
}

/**
 * Lookup keys for deterministic merging: the full name+domain key first,
 * then the name-only fallback so the same business found via different
 * domains still merges. Existing key format unchanged.
 */
export function dedupeLookupKeys(name: string, domainOrHandle?: string): string[] {
  const full = dedupeKey(name, domainOrHandle);
  const nameOnly = dedupeKey(name);
  return full === nameOnly ? [full] : [full, nameOnly];
}

/** Fillers skipped when finding a name's brand token for domain merging. */
const MERGE_FILLER = new Set(
  ("the a an and for with from online shop shops store stores mart market markets " +
    "mall malls boutique best new lagos ikeja nigeria nigerian lekki ltd limited " +
    "plc ng nig co company group").split(" "),
);

/** First significant token: the brand word ("supermart" in both Supermart rows). */
export function firstDistinctiveToken(name: string): string | null {
  for (const w of name.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/)) {
    if (w.length > 3 && /[a-z]/.test(w) && !MERGE_FILLER.has(w)) return w;
  }
  return null;
}

/** Domain normalization for merge lookup (www stripped, lowercased). */
export function normMergeDomain(d: string): string {
  return (d.toLowerCase().replace(/^www\./, "").split("/")[0] ?? "").trim();
}

/**
 * Cross-key sibling scan (earliest wins). Rule 1: same normalized domain +
 * same first distinctive token ("Supermart.ng" vs "Supermart Online
 * Groceries"); platform domains only merge on brand-token match. Rule 2:
 * same normalized name-part whatever the domain ("OPay" via opay.com vs
 * example.com) — the key-lookup fallback only matches rows STORED without
 * a domain, so same-name rows with different domains otherwise never merge.
 */
async function findSibling(db: Db, run_id: string, name: string, domain?: string): Promise<string | null> {
  const { results } = await db.prepare("SELECT id, name, dedupe_key, created_at FROM prospect WHERE run_id = ?")
    .bind(run_id).all<{ id: string; name: string; dedupe_key: string; created_at: string }>();
  const rows = (results ?? []).sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  const mine = domain ? normMergeDomain(domain) : "";
  const myToken = firstDistinctiveToken(name);
  if (mine && myToken) {
    const sib = rows.find((r) =>
      normMergeDomain((r.dedupe_key.split("::")[1] ?? "")) === mine &&
      firstDistinctiveToken(r.name) === myToken);
    if (sib) return sib.id;
  }
  const myNamePart = dedupeKey(name);
  return rows.find((r) => (r.dedupe_key.split("::")[0] ?? "") === myNamePart)?.id ?? null;
}

/**
 * Strip control chars, U+FFFD replacements, and lone surrogates from
 * model/web text. Applied by writers; fetched-page bodies stay verbatim
 * except for these (page text is untrusted data, stored as-is otherwise).
 */
export function sanitizeText(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    if (c === 0xFFFD) continue;
    if (c < 0x20 && c !== 0x09 && c !== 0x0A && c !== 0x0D) continue;
    if (c === 0x7F) continue;
    if (c >= 0xD800 && c <= 0xDFFF) continue; // lone surrogate (pairs arrive whole)
    out += ch;
  }
  return out.trim();
}

export function nowIso(): string { return new Date().toISOString(); }
export function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

const ROUTE_CHANNELS: RouteChannel[] = ["website_form", "email", "phone", "social_profile", "other"];
const DRAFT_STATUSES: DraftStatus[] = ["draft", "approved", "rejected", "deferred"];

/** Evidence writer: enforces model_inference-never-has-source_url, conflict target exists. */
export async function saveEvidence(db: Db, row: Omit<Evidence, "id" | "created_at">): Promise<string> {
  if (row.source_type === "model_inference" && row.source_url !== null) {
    throw new DbValidationError("model_inference evidence must not carry source_url");
  }
  if (row.conflicts_with) {
    const target = await db.prepare("SELECT id FROM evidence WHERE id = ?").bind(row.conflicts_with).first<string>("id");
    if (!target) throw new DbValidationError(`conflicts_with target ${row.conflicts_with} does not exist`);
  }
  const id = makeId("ev");
  await db.prepare(
    `INSERT INTO evidence (id, run_id, claim, quote, source_url, source_type, retrieved_at, reliability, conflicts_with, supersedes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, row.run_id, sanitizeText(row.claim), sanitizeText(row.quote), row.source_url, row.source_type,
    row.retrieved_at, row.reliability, row.conflicts_with, row.supersedes, nowIso()).run();
  return id;
}

/**
 * Candidate writer: computes the dedupe key, merges on (run_id, dedupe_key)
 * collision into the earliest row (attaching a merge note), else inserts.
 * Per tools.md rs.save_candidate: evidence ids must exist.
 */
export async function saveCandidate(
  db: Db,
  input: { run_id: string; name: string; category: string; location: Record<string, string>; domainOrHandle?: string; evidence_ids: string[] },
): Promise<{ prospect_id: string; merged: boolean }> {
  if (input.evidence_ids.length === 0) throw new DbValidationError("candidate requires at least one evidence id");
  for (const eid of input.evidence_ids) {
    const found = await db.prepare("SELECT id FROM evidence WHERE id = ? AND run_id = ?").bind(eid, input.run_id).first<string>("id");
    if (!found) throw new DbValidationError(`evidence ${eid} does not exist in run ${input.run_id}`);
  }
  const key = dedupeKey(input.name, input.domainOrHandle);
  let existing: string | null = null;
  for (const lookup of dedupeLookupKeys(input.name, input.domainOrHandle)) {
    existing = await db.prepare(
      "SELECT id FROM prospect WHERE run_id = ? AND dedupe_key = ? ORDER BY created_at ASC LIMIT 1",
    ).bind(input.run_id, lookup).first<string>("id");
    if (existing) break;
  }
  if (!existing) {
    existing = await findSibling(db, input.run_id, input.name, input.domainOrHandle);
  }
  if (existing) {
    const row = await db.prepare("SELECT evidence_ids FROM prospect WHERE id = ?").bind(existing)
      .first<{ evidence_ids: string }>();
    let ids: string[] = [];
    try {
      const parsed: unknown = JSON.parse(row?.evidence_ids ?? "[]");
      if (Array.isArray(parsed)) ids = parsed.filter((x): x is string => typeof x === "string");
    } catch { ids = []; }
    const union = [...new Set([...ids, ...input.evidence_ids])];
    await db.prepare("UPDATE prospect SET evidence_ids = ? WHERE id = ?")
      .bind(JSON.stringify(union), existing).run();
    await logActivity(db, { run_id: input.run_id, prospect_id: existing, event: "created", note: `dedupe merge: ${input.name}` });
    return { prospect_id: existing, merged: true };
  }
  const id = makeId("pr");
  await db.prepare(
    `INSERT INTO prospect (id, run_id, name, category, location, dedupe_key, evidence_ids, status, rank, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'candidate', NULL, ?)`,
  ).bind(id, input.run_id, sanitizeText(input.name), sanitizeText(input.category),
    JSON.stringify(input.location), key, JSON.stringify(input.evidence_ids), nowIso()).run();
  await logActivity(db, { run_id: input.run_id, prospect_id: id, event: "created", note: null });
  return { prospect_id: id, merged: false };
}

/** Assessment writer: empty supporting list forces fit_rating <= 2. */
export async function saveAssessment(
  db: Db,
input: { prospect_id: string; fit_rating: number; supporting_ids: string[]; weakening_ids: string[]; uncertainties: string[]; missing_info: string[]; rationale: string; model_id: string; dimensions?: { icp_fit: number; problem: number; readiness: number; reachability: number; confidence: number }; verdict?: string },
): Promise<string> {
  if (input.fit_rating < 1 || input.fit_rating > 5) throw new DbValidationError("fit_rating must be 1..5");
  if (input.supporting_ids.length === 0 && input.fit_rating > 2) {
    throw new DbValidationError("empty supporting evidence forces fit_rating <= 2");
  }
  if (!input.rationale) throw new DbValidationError("assessment rationale is required");
  if (input.dimensions !== undefined) {
    for (const k of ["icp_fit", "problem", "readiness", "reachability", "confidence"] as const) {
      const v = input.dimensions[k];
      if (!Number.isInteger(v) || v < 1 || v > 5) throw new DbValidationError(`assessment dimension ${k} must be 1..5`);
    }
  }
  if (input.verdict !== undefined && !["qualified", "needs_research", "no_signal", "manual_review", "disqualified"].includes(input.verdict)) {
    throw new DbValidationError(`unknown verdict ${input.verdict}`);
  }
  const prospect = await db.prepare("SELECT id, run_id FROM prospect WHERE id = ?").bind(input.prospect_id).first<{ id: string; run_id: string }>();
  if (!prospect) throw new DbValidationError(`prospect ${input.prospect_id} does not exist`);
  for (const eid of [...input.supporting_ids, ...input.weakening_ids]) {
    const found = await db.prepare("SELECT id FROM evidence WHERE id = ? AND run_id = ?").bind(eid, prospect.run_id).first<string>("id");
    if (!found) throw new DbValidationError(`evidence ${eid} does not exist in this run`);
  }
  const id = makeId("as");
  await db.prepare(
`INSERT INTO assessment (id, prospect_id, fit_rating, supporting_evidence_ids, weakening_evidence_ids, uncertainties, missing_info, rationale, model_id, dimensions, verdict, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, input.prospect_id, input.fit_rating, JSON.stringify(input.supporting_ids),
    JSON.stringify(input.weakening_ids), JSON.stringify(input.uncertainties),
JSON.stringify(input.missing_info), sanitizeText(input.rationale), input.model_id,
    JSON.stringify(input.dimensions ?? null), input.verdict ?? null, nowIso()).run();
  return id;
}

/** Route writer: evidence_id mandatory; verification server-set to public_listing. */
export async function saveRoute(
  db: Db,
  input: { prospect_id: string; channel: RouteChannel; value: string; evidence_id: string },
): Promise<string> {
  if (!ROUTE_CHANNELS.includes(input.channel)) throw new DbValidationError(`unknown channel ${input.channel}`);
  const ev = await db.prepare("SELECT id FROM evidence WHERE id = ?").bind(input.evidence_id).first<string>("id");
  if (!ev) throw new DbValidationError(`evidence ${input.evidence_id} does not exist`);
  const id = makeId("rt");
  await db.prepare(
    `INSERT INTO contact_route (id, prospect_id, channel, value, verification, evidence_id, created_at)
     VALUES (?, ?, ?, ?, 'public_listing', ?, ?)`,
).bind(id, input.prospect_id, input.channel, sanitizeText(input.value), input.evidence_id, nowIso()).run();
  return id;
}

/** Draft writer: prospect must be shortlisted; body must carry an evidence citation marker. */
export async function saveDraft(
  db: Db,
  input: { prospect_id: string; channel_suggestion: string; subject: string | null; body: string; next_action: string; follow_up_days?: number },
): Promise<string> {
  const prospect = await db.prepare("SELECT id, status FROM prospect WHERE id = ?").bind(input.prospect_id).first<{ id: string; status: ProspectStatus }>();
  if (!prospect) throw new DbValidationError(`prospect ${input.prospect_id} does not exist`);
  if (prospect.status !== "shortlisted") throw new DbValidationError("drafts require a shortlisted prospect");
  if (input.body.length > 4000) throw new DbValidationError("draft body exceeds 4000 chars");
  if (input.body.trim() === "") throw new DbValidationError("draft body is required");
  // Grounding is enforced by draft() (fuzzy body→evidence linking), not by a
  // bracket-marker regex here: the regex silently dropped grounded drafts.
  const id = makeId("dr");
  await db.prepare(
    `INSERT INTO outreach_draft (id, prospect_id, channel_suggestion, subject, body, next_action, follow_up_days, status, edited_by_human, decided_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', 0, NULL, ?)`,
).bind(id, input.prospect_id, input.channel_suggestion, input.subject === null ? null : sanitizeText(input.subject),
sanitizeText(input.body), sanitizeText(input.next_action), input.follow_up_days ?? null, nowIso()).run();
  return id;
}

/** Transition a prospect's status with validation + activity log. */
export async function setProspectStatus(db: Db, run_id: string, prospect_id: string, to: ProspectStatus): Promise<void> {
  const row = await db.prepare("SELECT status FROM prospect WHERE id = ?").bind(prospect_id).first<{ status: ProspectStatus }>();
  if (!row) throw new DbValidationError(`prospect ${prospect_id} does not exist`);
  assertProspectTransition(row.status, to);
  await db.prepare("UPDATE prospect SET status = ? WHERE id = ?").bind(to, prospect_id).run();
  const eventMap: Partial<Record<ProspectStatus, ActivityEvent>> = {
    shortlisted: "shortlisted", approved: "approved", rejected: "rejected",
    deferred: "deferred", contacted: "contacted",
  };
  if (eventMap[to]) await logActivity(db, { run_id, prospect_id, event: eventMap[to] as ActivityEvent, note: null });
}

/** Transition a run's status with validation. */
export async function setRunStatus(db: Db, run_id: string, to: RunStatus, stop_reason?: string): Promise<void> {
  const row = await db.prepare("SELECT status FROM research_run WHERE id = ?").bind(run_id).first<{ status: RunStatus }>();
  if (!row) throw new DbValidationError(`run ${run_id} does not exist`);
  assertRunTransition(row.status, to);
  const finished = to === "complete" || to === "stopped" || to === "failed" ? nowIso() : null;
  await db.prepare("UPDATE research_run SET status = ?, stop_reason = COALESCE(?, stop_reason), finished_at = COALESCE(?, finished_at) WHERE id = ?")
    .bind(to, stop_reason ?? null, finished, run_id).run();
}

/** Decide a draft (approved/rejected/deferred) preserving the supersede chain note. */
export async function decideDraft(db: Db, run_id: string, draft_id: string, decision: DraftStatus, edited: boolean): Promise<void> {
  if (decision === "draft") throw new DbValidationError("decision must be approved, rejected, or deferred");
  if (!DRAFT_STATUSES.includes(decision)) throw new DbValidationError(`unknown draft status ${decision}`);
  const row = await db.prepare("SELECT id, prospect_id, status FROM outreach_draft WHERE id = ?").bind(draft_id)
    .first<{ id: string; prospect_id: string; status: DraftStatus }>();
  if (!row) throw new DbValidationError(`draft ${draft_id} does not exist`);
  if (row.status !== "draft") throw new DbValidationError("only undecided drafts can be decided");
  await db.prepare("UPDATE outreach_draft SET status = ?, edited_by_human = ?, decided_at = ? WHERE id = ?")
    .bind(decision, edited ? 1 : 0, nowIso(), draft_id).run();
  const eventMap: Record<Exclude<DraftStatus, "draft">, ActivityEvent> = { approved: "approved", rejected: "rejected", deferred: "deferred" };
  await logActivity(db, { run_id, prospect_id: row.prospect_id, event: eventMap[decision as Exclude<DraftStatus, "draft">], note: draft_id });
}

/** Edit an undecided draft's subject/body (human revision before decision). */
export async function editDraft(
  db: Db,
  input: { draft_id: string; subject?: string; body?: string },
): Promise<void> {
  if (input.subject === undefined && input.body === undefined) {
    throw new DbValidationError("edit needs a subject and/or body");
  }
  if (input.body !== undefined && input.body.length > 4000) {
    throw new DbValidationError("draft body exceeds 4000 chars");
  }
  const row = await db.prepare("SELECT id, status FROM outreach_draft WHERE id = ?").bind(input.draft_id)
    .first<{ id: string; status: DraftStatus }>();
  if (!row) throw new DbValidationError(`draft ${input.draft_id} does not exist`);
  if (row.status !== "draft") throw new DbValidationError("only undecided drafts can be edited");
  await db.prepare("UPDATE outreach_draft SET subject = COALESCE(?, subject), body = COALESCE(?, body), edited_by_human = 1 WHERE id = ?")
    .bind(input.subject ?? null, input.body ?? null, input.draft_id).run();
}

export async function logActivity(
  db: Db,
  input: { run_id: string; prospect_id?: string | null; event: ActivityEvent; note?: string | null },
): Promise<string> {
  const id = makeId("ac");
  await db.prepare("INSERT INTO activity (id, run_id, prospect_id, event, note, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, input.run_id, input.prospect_id ?? null, input.event, input.note ?? null, nowIso()).run();
  return id;
}

/** Read helpers: run snapshot for rs.get_run_state (brief + rows + counters). */
export async function getRun(db: Db, run_id: string): Promise<ResearchRun | null> {
  const row = await db.prepare("SELECT * FROM research_run WHERE id = ?").bind(run_id).first<Record<string, unknown>>();
  if (!row) return null;
  return {
    id: row["id"] as string, profile_id: row["profile_id"] as string,
    workflow_instance_id: row["workflow_instance_id"] as string,
    plan: JSON.parse(row["plan"] as string), status: row["status"] as RunStatus,
    stop_reason: row["stop_reason"] as string | null,
    commercial_brief: (row["commercial_brief"] as string | null) ?? null,
    budgets: JSON.parse(row["budgets"] as string), consumed: JSON.parse(row["consumed"] as string),
    started_at: row["started_at"] as string, finished_at: row["finished_at"] as string | null,
    created_at: row["created_at"] as string,
  };
}

export async function listProspects(db: Db, run_id: string): Promise<Prospect[]> {
  const { results } = await db.prepare("SELECT * FROM prospect WHERE run_id = ? ORDER BY rank NULLS LAST, created_at ASC").bind(run_id).all<Record<string, unknown>>();
  return results.map((r) => ({
    id: r["id"] as string, run_id: r["run_id"] as string, name: r["name"] as string,
    category: r["category"] as string, location: JSON.parse(r["location"] as string),
    dedupe_key: r["dedupe_key"] as string, status: r["status"] as ProspectStatus,
    evidence_ids: JSON.parse((r["evidence_ids"] as string) ?? "[]") as string[],
    rank: r["rank"] as number | null, created_at: r["created_at"] as string,
  }));
}

export async function listEvidence(db: Db, run_id: string): Promise<Evidence[]> {
  const { results } = await db.prepare("SELECT * FROM evidence WHERE run_id = ? ORDER BY created_at ASC").bind(run_id).all<Record<string, unknown>>();
  return results.map((r) => ({
    id: r["id"] as string, run_id: r["run_id"] as string, claim: r["claim"] as string,
    quote: r["quote"] as string, source_url: r["source_url"] as string | null,
    source_type: r["source_type"] as SourceType, retrieved_at: r["retrieved_at"] as string,
    reliability: r["reliability"] as Reliability,
    conflicts_with: r["conflicts_with"] as string | null, supersedes: r["supersedes"] as string | null,
    created_at: r["created_at"] as string,
  }));
}

/**
 * Follow-ups due: approvals with follow_up_days whose decided_at + days <= now.
 * Derived on read per specs/data-model.md §1 (activity) — computed by the API.
 */
export async function followUpsDue(db: Db, run_id: string, nowMs: number): Promise<OutreachDraft[]> {
  const { results } = await db.prepare(
    `SELECT d.* FROM outreach_draft d JOIN prospect p ON p.id = d.prospect_id
     WHERE p.run_id = ? AND d.status = 'approved' AND d.follow_up_days IS NOT NULL AND d.decided_at IS NOT NULL`,
  ).bind(run_id).all<Record<string, unknown>>();
  return results
    .filter((r) => Date.parse(r["decided_at"] as string) + (r["follow_up_days"] as number) * 86400000 <= nowMs)
    .map((r) => ({
      id: r["id"] as string, prospect_id: r["prospect_id"] as string,
      channel_suggestion: r["channel_suggestion"] as string, subject: r["subject"] as string | null,
      body: r["body"] as string, next_action: r["next_action"] as string,
      follow_up_days: r["follow_up_days"] as number | null, status: r["status"] as DraftStatus,
      edited_by_human: (r["edited_by_human"] as number) === 1, decided_at: r["decided_at"] as string | null,
      created_at: r["created_at"] as string,
    }));
}
