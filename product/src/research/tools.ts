/**
 * product/src/research/tools.ts — rs.* function tool definitions + validated executors.
 * Per tools.md Part B and specs/research-loop.md §§4-5,7. Deterministic validation
 * in code; rejections are returned as tool results (never silent skips).
 * No `cloudflare:workers` imports (runs under plain vitest/node).
 */
import {
  Db,
  DbValidationError,
  dedupeKey,
  saveAssessment as dbSaveAssessment,
  saveCandidate as dbSaveCandidate,
  saveDraft as dbSaveDraft,
  saveEvidence as dbSaveEvidence,
  saveRoute as dbSaveRoute,
  type Reliability,
  type RouteChannel,
  type SourceType,
} from "../db";
import { budgetReason, type BudgetCaps, type BudgetConsumed } from "./budgets";

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export const TOOL_DEFS: ToolDef[] = [
  { name: "rs.fetch_page", description: "Fetch a public page and return extracted text (10s timeout, 1 retry; blocks/empties/timeouts return structured fetch-failure).", parameters: { type: "object", properties: { url: { type: "string" }, max_chars: { type: "number" } }, required: ["url"] } },
  { name: "rs.get_run_state", description: "Read current D1 state for the run (brief, counters, rows by kind). Read-only.", parameters: { type: "object", properties: { run_id: { type: "string" }, include: { type: "array", items: { type: "string" } } }, required: ["run_id"] } },
  { name: "rs.save_evidence", description: "Persist one evidence row (enums closed; model_inference must not carry source_url).", parameters: { type: "object", properties: { run_id: { type: "string" }, claim: { type: "string" }, quote: { type: "string" }, source_url: { type: "string" }, source_type: { type: "string" }, reliability: { type: "string" } }, required: ["run_id", "claim", "quote", "source_type", "reliability"] } },
  { name: "rs.save_candidate", description: "Insert or merge a candidate (dedupe enforced in code).", parameters: { type: "object", properties: { run_id: { type: "string" }, name: { type: "string" }, category: { type: "string" }, location: { type: "object" }, evidence_ids: { type: "array", items: { type: "string" } } }, required: ["run_id", "name", "category", "evidence_ids"] } },
  { name: "rs.save_assessment", description: "Persist a fit assessment (rating 1-5; empty supporting list forces rating <= 2).", parameters: { type: "object", properties: { prospect_id: { type: "string" }, fit_rating: { type: "number" }, supporting_ids: { type: "array", items: { type: "string" } }, rationale: { type: "string" } }, required: ["prospect_id", "fit_rating", "rationale"] } },
  { name: "rs.save_route", description: "Persist a contact route (verification server-set to public_listing).", parameters: { type: "object", properties: { prospect_id: { type: "string" }, channel: { type: "string" }, value: { type: "string" }, evidence_id: { type: "string" } }, required: ["prospect_id", "channel", "value", "evidence_id"] } },
  { name: "rs.save_draft", description: "Persist an outreach draft (shortlisted prospect only; body must cite evidence; <=4000 chars).", parameters: { type: "object", properties: { prospect_id: { type: "string" }, body: { type: "string" }, next_action: { type: "string" } }, required: ["prospect_id", "body", "next_action"] } },
];

export const TOOL_NAMES = TOOL_DEFS.map((t) => t.name);

export type ToolOk<T> = { ok: true; value: T };
export type ToolFail = { ok: false; error: string; reason?: string };
export type ToolResult<T> = ToolOk<T> | ToolFail;

export function fail(error: string, reason?: string): ToolFail {
  return reason === undefined ? { ok: false, error } : { ok: false, error, reason };
}

// --- fetch_page ------------------------------------------------------------

export interface FetchPageInput { url: string; max_chars?: number }
export interface FetchPageDeps {
  consumed: BudgetConsumed;
  caps: BudgetCaps;
  /** Low-level fetcher injected by the Workflow (mocked in tests). */
  fetcher: (url: string, timeoutMs: number) => Promise<{ text: string } | { failure: "blocked" | "empty" | "timeout"; detail: string }>;
}

export const FETCH_TIMEOUT_MS = 10_000;
export const FETCH_MAX_CHARS_DEFAULT = 12_000;
export const FETCH_MAX_CHARS_MAX = 60_000;
export const FETCH_RAW_CAP_BYTES = 2_000_000;

function isPublicWebUrl(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host === "[::1]") return false;
  if (/^(127\.|10\.|192\.168\.|169\.254\.)/.test(host)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
  if (host === "::1") return false;
  return true;
}

/**
 * Validated fetch_page executor: schema + budget + timeout/1-retry.
 * Success: { ok:true, value:{ text } }. Fetch problems: { ok:false, error:"fetch_<kind>", reason }
 * (the caller records fetch-failure evidence — never a silent skip).
 */
export async function execFetchPage(
  deps: FetchPageDeps,
  input: FetchPageInput,
): Promise<ToolResult<{ text: string }>> {
  if (typeof input.url !== "string" || input.url.trim() === "") return fail("invalid_url");
  if (!isPublicWebUrl(input.url)) return fail("url_rejected", "private/non-web URL rejected");
  const maxChars = input.max_chars ?? FETCH_MAX_CHARS_DEFAULT;
  if (!Number.isFinite(maxChars) || maxChars <= 0 || maxChars > FETCH_MAX_CHARS_MAX) {
    return fail("invalid_max_chars");
  }
  if (deps.consumed.fetches + 1 > deps.caps.fetches) return fail(budgetReason("fetches"), "fetch budget exhausted");
  let last: { failure: "blocked" | "empty" | "timeout"; detail: string } | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const res = await deps.fetcher(input.url, FETCH_TIMEOUT_MS);
    if ("text" in res) {
      if (!res.text || res.text.trim() === "") { last = { failure: "empty", detail: "empty page text" }; continue; }
      deps.consumed.fetches += 1;
      deps.consumed.tool_rounds += 1;
      return { ok: true, value: { text: res.text.slice(0, Math.min(maxChars, FETCH_RAW_CAP_BYTES)) } };
    }
    last = res.failure ? { failure: res.failure, detail: res.detail } : last;
    if (res.failure === "blocked") break; // no retry for blocks
  }
  const kind = last?.failure ?? "timeout";
  return fail(`fetch_${kind}`, last?.detail ?? "fetch failed");
}

// --- save_* executors (validated, write-through) ----------------------------

export async function execSaveEvidence(
  db: Db,
  input: { run_id: string; claim: string; quote: string; source_url?: string | null; source_type: SourceType; reliability: Reliability; retrieved_at?: string; conflicts_with?: string | null; supersedes?: string | null },
): Promise<ToolResult<{ evidence_id: string }>> {
  try {
    const id = await dbSaveEvidence(db, {
      run_id: input.run_id, claim: input.claim, quote: input.quote,
      source_url: input.source_url ?? null, source_type: input.source_type,
      retrieved_at: input.retrieved_at ?? new Date().toISOString(),
      reliability: input.reliability, conflicts_with: input.conflicts_with ?? null,
      supersedes: input.supersedes ?? null,
    });
    return { ok: true, value: { evidence_id: id } };
  } catch (e) {
    return fail(e instanceof DbValidationError ? e.message : "save_evidence_failed");
  }
}

export async function execSaveCandidate(
  db: Db,
  input: { run_id: string; name: string; category: string; location?: Record<string, string>; domainOrHandle?: string; evidence_ids: string[] },
): Promise<ToolResult<{ prospect_id: string; merged: boolean; dedupe_key: string }>> {
  try {
    const r = await dbSaveCandidate(db, {
      run_id: input.run_id, name: input.name, category: input.category,
      location: input.location ?? {},
      ...(input.domainOrHandle !== undefined ? { domainOrHandle: input.domainOrHandle } : {}),
      evidence_ids: input.evidence_ids,
    });
    return { ok: true, value: { ...r, dedupe_key: dedupeKey(input.name, input.domainOrHandle) } };
  } catch (e) {
    return fail(e instanceof DbValidationError ? e.message : "save_candidate_failed");
  }
}

export async function execSaveAssessment(
  db: Db,
  input: { prospect_id: string; fit_rating: number; supporting_ids?: string[]; weakening_ids?: string[]; uncertainties?: string[]; missing_info?: string[]; rationale: string; model_id?: string },
): Promise<ToolResult<{ assessment_id: string }>> {
  try {
    const id = await dbSaveAssessment(db, {
      prospect_id: input.prospect_id, fit_rating: input.fit_rating,
      supporting_ids: input.supporting_ids ?? [], weakening_ids: input.weakening_ids ?? [],
      uncertainties: input.uncertainties ?? [], missing_info: input.missing_info ?? [],
      rationale: input.rationale, model_id: input.model_id ?? "mocked-model",
    });
    return { ok: true, value: { assessment_id: id } };
  } catch (e) {
    return fail(e instanceof DbValidationError ? e.message : "save_assessment_failed");
  }
}

export async function execSaveRoute(
  db: Db,
  input: { prospect_id: string; channel: RouteChannel; value: string; evidence_id: string },
): Promise<ToolResult<{ route_id: string }>> {
  try {
    const id = await dbSaveRoute(db, input);
    return { ok: true, value: { route_id: id } };
  } catch (e) {
    return fail(e instanceof DbValidationError ? e.message : "save_route_failed");
  }
}

export async function execSaveDraft(
  db: Db,
  input: { prospect_id: string; channel_suggestion?: string; subject?: string | null; body: string; next_action: string; follow_up_days?: number },
): Promise<ToolResult<{ draft_id: string }>> {
  try {
    const id = await dbSaveDraft(db, {
      prospect_id: input.prospect_id, channel_suggestion: input.channel_suggestion ?? "website_form",
      subject: input.subject ?? null, body: input.body, next_action: input.next_action,
      ...(input.follow_up_days !== undefined ? { follow_up_days: input.follow_up_days } : {}),
    });
    return { ok: true, value: { draft_id: id } };
  } catch (e) {
    return fail(e instanceof DbValidationError ? e.message : "save_draft_failed");
  }
}
