/**
 * product/src/index.ts — Worker API routes for the prospect-research journey.
 * Describe/Understand (profiles), Clarify/Confirm (answers, confirm),
 * Research (runs lifecycle + resume), Review/Decide (prospects, evidence,
 * drafts, decisions, statuses, follow-ups). Every handler validates input,
 * enforces the data-model state machines, and writes D1; Workflow
 * triggers/events are best-effort (never fail a request).
 */
import {
  assertRunTransition,
  decideDraft,
  DbValidationError,
  editDraft,
  makeId,
  nowIso,
  type Db,
  type DraftStatus,
  type RunStatus,
} from "./db";
import { createMetaClient } from "./meta";
import { ResearchWorkflow } from "./orchestrator";
import * as delivery from "./delivery/routes";
import { consumeDeliveryBatch, enqueueDueJobs, warmSmtpRelay, type DeliveryJob } from "./delivery/processor";
import { containerRelay, smtpProvider } from "./delivery/providers";
import type { Container } from "@cloudflare/containers";

export { ResearchWorkflowEntrypoint } from "./workflow";
export { SmtpRelayContainer } from "./smtp-relay-container";

export interface Env {
  DB: D1Database;
  RESEARCH_WORKFLOW?: {
    create?: (...args: unknown[]) => Promise<unknown>;
    get?: (id: string) => Promise<{ sendEvent?: (evt: { type: string; payload: unknown }) => Promise<unknown> } | null>;
  };
  MODEL_API_KEY: string;
  MODEL_ID?: string;
  ENVIRONMENT?: string;
  CRED_KEY?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  PUBLIC_BASE_URL?: string;
  DELIVERY_QUEUE?: { send(msg: unknown): Promise<void> };
  SMTP_RELAY?: DurableObjectNamespace<Container>;
}

export interface QueueMessageWire {
  body: DeliveryJob;
  attempts: number;
  ack(): void;
  retry(opts?: { delaySeconds?: number }): void;
}

export interface QueueBatch {
  messages: QueueMessageWire[];
}

type Ctx = { req: Request; env: Env; params: Record<string, string> };
type Handler = (c: Ctx) => Promise<Response>;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function err(code: string, status: number, detail?: string): Response {
  return json(detail === undefined ? { error: code } : { error: code, detail }, status);
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

async function readJson(req: Request): Promise<{ ok: true; body: unknown } | { ok: false; res: Response }> {
  try {
    return { ok: true, body: await req.json() };
  } catch {
    return { ok: false, res: err("invalid_json", 400) };
  }
}

/**
 * Minimal D1 surface needed to decide a draft (fix: callee takes the minimal
 * interface instead of an `as unknown as` cast at the call site).
 */
export async function decideDraftWithDb(
  db: Db, run_id: string, draft_id: string, decision: DraftStatus, edited: boolean,
): Promise<void> {
  await decideDraft(db, run_id, draft_id, decision, edited);
}

/** Best-effort Workflow call: records human-gate/trigger delivery, never throws. */
async function bestEffort(fn: (() => Promise<unknown>) | undefined): Promise<void> {
  if (!fn) return;
  try {
    await fn();
  } catch {
    /* Workflow not bound in tests/dev — D1 remains the source of truth. */
  }
}

/** Deliver an event to a running Workflow instance by id; never throws. */
async function sendWorkflowEvent(env: Env, instanceId: string, type: string, payload: unknown): Promise<void> {
  try {
    const inst = await env.RESEARCH_WORKFLOW?.get?.(instanceId);
    await inst?.sendEvent?.({ type, payload });
  } catch {
    /* Workflow not bound (tests/dev) — D1 remains the source of truth. */
  }
}

// --- Row shapes (TEXT JSON columns parsed on read) ---------------------------

interface ProfileRow {
  id: string; name: string; website_url: string | null; description: string;
  services: string; value_proposition: string; target_market: string;
  service_area: string; constraints_json: string; provenance: string;
  status: string; version: number; confirmed_at: string | null; created_at: string;
}

interface RunRow {
  id: string; profile_id: string; workflow_instance_id: string; plan: string;
  status: string; stop_reason: string | null; commercial_brief: string | null;
  budgets: string; consumed: string;
  started_at: string; finished_at: string | null; created_at: string;
}

function serializeProfile(r: ProfileRow): Record<string, unknown> {
  return {
    id: r.id, name: r.name, website_url: r.website_url, description: r.description,
    services: parseJson<unknown[]>(r.services, []),
    value_proposition: r.value_proposition, target_market: r.target_market,
    service_area: parseJson<Record<string, string>>(r.service_area, {}),
    constraints: parseJson<Record<string, unknown>>(r.constraints_json, {}),
    provenance: parseJson<Record<string, string>>(r.provenance, {}),
    status: r.status, version: r.version, confirmed_at: r.confirmed_at, created_at: r.created_at,
  };
}

function serializeRun(r: RunRow): Record<string, unknown> {
  return {
    id: r.id, profile_id: r.profile_id, workflow_instance_id: r.workflow_instance_id,
    plan: parseJson<{ queries: string[] }>(r.plan, { queries: [] }),
    status: r.status, stop_reason: r.stop_reason,
    commercial_brief: r.commercial_brief ? parseJson<Record<string, unknown>>(r.commercial_brief, {}) : null,
    budgets: parseJson<Record<string, number>>(r.budgets, {}),
    consumed: parseJson<Record<string, number>>(r.consumed, {}),
    started_at: r.started_at, finished_at: r.finished_at, created_at: r.created_at,
  };
}

async function getProfile(env: Env, id: string): Promise<ProfileRow | null> {
  return env.DB.prepare("SELECT * FROM business_profile WHERE id = ?").bind(id).first<ProfileRow>();
}

async function getRun(env: Env, id: string): Promise<RunRow | null> {
  return env.DB.prepare("SELECT * FROM research_run WHERE id = ?").bind(id).first<RunRow>();
}

async function prospectIdsForRun(env: Env, runId: string): Promise<Set<string>> {
  const out = await env.DB.prepare("SELECT id FROM prospect WHERE run_id = ?").bind(runId).all<{ id: string }>();
  return new Set((out.results ?? []).map((r) => r.id));
}

async function draftsForRun(env: Env, runId: string): Promise<Array<Record<string, unknown>>> {
  const ids = await prospectIdsForRun(env, runId);
  if (ids.size === 0) return [];
  const out = await env.DB.prepare("SELECT * FROM outreach_draft").all<Record<string, unknown>>();
  return (out.results ?? []).filter((d) => ids.has(String(d["prospect_id"])));
}

// --- Handlers ----------------------------------------------------------------

const postProfile: Handler = async ({ req, env }) => {
  const parsed = await readJson(req);
  if (!parsed.ok) return parsed.res;
  if (!isObj(parsed.body)) return err("invalid_body", 400);
  const name = parsed.body["name"];
  if (typeof name !== "string" || name.trim() === "") return err("missing_name", 400);
  const str = (v: unknown, fb: string): string => (typeof v === "string" ? v : fb);
  const websiteUrl = parsed.body["website_url"];
  const id = makeId("bp");
  const provenance: Record<string, string> = { name: "stated" };
  for (const f of ["description", "services", "value_proposition", "target_market", "service_area", "constraints", "website_url"]) {
    if (parsed.body[f] !== undefined) provenance[f] = "stated";
  }
  await env.DB.prepare(
    `INSERT INTO business_profile (id, name, website_url, description, services, value_proposition, target_market, service_area, constraints_json, provenance, status, version, confirmed_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id, name.trim(),
    typeof websiteUrl === "string" ? websiteUrl : null,
    str(parsed.body["description"], ""),
    JSON.stringify(parsed.body["services"] ?? []),
    str(parsed.body["value_proposition"], ""),
    str(parsed.body["target_market"], ""),
    JSON.stringify(parsed.body["service_area"] ?? {}),
    JSON.stringify(parsed.body["constraints"] ?? {}),
    JSON.stringify(provenance), "draft", 1, null, nowIso(),
  ).run();
  const row = await getProfile(env, id);
  return json(serializeProfile(row as ProfileRow), 201);
};

const getProfileById: Handler = async ({ env, params }) => {
  const row = await getProfile(env, params["id"] as string);
  if (!row) return err("profile_not_found", 404);
  return json(serializeProfile(row));
};

const ANSWER_FIELDS: Record<string, { col: string; json: boolean }> = {
  name: { col: "name", json: false },
  website_url: { col: "website_url", json: false },
  description: { col: "description", json: false },
  services: { col: "services", json: true },
  value_proposition: { col: "value_proposition", json: false },
  target_market: { col: "target_market", json: false },
  service_area: { col: "service_area", json: true },
  constraints: { col: "constraints_json", json: true },
};

const postAnswers: Handler = async ({ req, env, params }) => {
  const row = await getProfile(env, params["id"] as string);
  if (!row) return err("profile_not_found", 404);
  const parsed = await readJson(req);
  if (!parsed.ok) return parsed.res;
  if (!isObj(parsed.body)) return err("invalid_body", 400);
  const raw = parsed.body["answers"];
  const answers = isObj(raw) ? raw : parsed.body;
  const updates: Array<{ field: string; col: string; value: string }> = [];
  for (const [field, spec] of Object.entries(ANSWER_FIELDS)) {
    if (answers[field] === undefined || (isObj(raw) === false && field === "name" && answers === parsed.body)) continue;
    const v = answers[field];
    if (v === undefined) continue;
    updates.push({ field, col: spec.col, value: spec.json ? JSON.stringify(v) : String(v) });
  }
  if (updates.length === 0) return err("empty_answers", 400);
  const provenance = parseJson<Record<string, string>>(row.provenance, {});
  for (const u of updates) provenance[u.field] = "stated";
  const version = row.status === "confirmed" ? row.version + 1 : row.version;
  const setClause = updates.map((u) => `${u.col} = ?`).join(", ");
  await env.DB.prepare(
    `UPDATE business_profile SET ${setClause}, provenance = ?, version = ? WHERE id = ?`,
  ).bind(...updates.map((u) => u.value), JSON.stringify(provenance), version, row.id).run();
  return json(serializeProfile((await getProfile(env, row.id)) as ProfileRow));
};

const postConfirm: Handler = async ({ env, params }) => {
  const row = await getProfile(env, params["id"] as string);
  if (!row) return err("profile_not_found", 404);
  if (row.status === "confirmed") return err("already_confirmed", 400);
  const at = nowIso();
  await env.DB.prepare("UPDATE business_profile SET status = ?, confirmed_at = ? WHERE id = ?").bind("confirmed", at, row.id).run();
  return json(serializeProfile((await getProfile(env, row.id)) as ProfileRow));
};

const TERMINAL_RUN = ["complete", "stopped", "failed"];

const postRun: Handler = async ({ req, env }) => {
  const parsed = await readJson(req);
  if (!parsed.ok) return parsed.res;
  if (!isObj(parsed.body)) return err("invalid_body", 400);
  const profileId = parsed.body["profile_id"];
  if (typeof profileId !== "string" || profileId === "") return err("missing_profile_id", 400);
  const profile = await getProfile(env, profileId);
  if (!profile) return err("profile_not_found", 404);
  if (profile.status !== "confirmed") return err("brief_not_confirmed", 400);
  const existing = await env.DB.prepare("SELECT id, status FROM research_run WHERE profile_id = ?").bind(profileId).all<{ id: string; status: string }>();
  if ((existing.results ?? []).some((r) => !TERMINAL_RUN.includes(r.status))) return err("run_active", 409);
  const id = makeId("run");
  const wfId = makeId("wf");
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO research_run (id, profile_id, workflow_instance_id, plan, status, stop_reason, budgets, consumed, started_at, finished_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id, profileId, wfId, JSON.stringify({ queries: [] }), "created", null,
    JSON.stringify({ searches: 30, fetches: 40, candidates: 25, cost_usd: 6, active_compute_s: 1200 }),
    JSON.stringify({ searches: 0, fetches: 0, candidates: 0, tool_rounds: 0, cost_usd_est: 0 }),
    now, null, now,
  ).run();
  // Production owns execution via Workflow; dev runs stay parked at created
  // until the synchronous start-route drives them (never both at once).
  if (env.ENVIRONMENT === "production") {
    await bestEffort(() => env.RESEARCH_WORKFLOW?.create?.({ id: wfId, params: { run_id: id } }) as Promise<unknown>);
  }
  return json(serializeRun((await getRun(env, id)) as RunRow), 201);
};

const getRunById: Handler = async ({ env, params }) => {
  const row = await getRun(env, params["id"] as string);
  if (!row) return err("run_not_found", 404);
  return json(serializeRun(row));
};

const postResume: Handler = async ({ req, env, params }) => {
  const row = await getRun(env, params["id"] as string);
  if (!row) return err("run_not_found", 404);
  const parsed = await readJson(req);
  if (!parsed.ok) return parsed.res;
  if (!isObj(parsed.body)) return err("invalid_body", 400);
  const to = parsed.body["to"];
  if (typeof to !== "string" || to === "") return err("missing_target", 400);
  try {
    assertRunTransition(row.status as RunStatus, to as RunStatus);
  } catch (e) {
    if (e instanceof DbValidationError) return err("illegal_transition", 400, e.message);
    throw e;
  }
  const terminal = TERMINAL_RUN.includes(to);
  const reason = typeof parsed.body["stop_reason"] === "string" ? (parsed.body["stop_reason"] as string) : null;
  await env.DB.prepare("UPDATE research_run SET status = ?, stop_reason = COALESCE(?, stop_reason), finished_at = ? WHERE id = ?")
    .bind(to, reason, terminal ? nowIso() : row.finished_at, row.id).run();
  // NOTE: no waiter consumes "resume" yet (the run loop waits on
  // brief_confirmed/drafts_decided). Kept as a best-effort signal only.
  await sendWorkflowEvent(env, row.workflow_instance_id, "resume", { run_id: row.id, to });
  return json(serializeRun((await getRun(env, row.id)) as RunRow));
};

const getProspects: Handler = async ({ env, params }) => {
  const runId = params["id"] as string;
  if (!(await getRun(env, runId))) return err("run_not_found", 404);
  const out = await env.DB.prepare("SELECT * FROM prospect WHERE run_id = ?").bind(runId).all<Record<string, unknown>>();
  const prospects = (out.results ?? []).map((p) => ({
    ...p,
    location: parseJson<Record<string, string>>(p["location"] as string | null, {}),
  }));
  return json({ run_id: runId, prospects });
};

const getEvidence: Handler = async ({ env, params }) => {
  const runId = params["id"] as string;
  if (!(await getRun(env, runId))) return err("run_not_found", 404);
  const out = await env.DB.prepare("SELECT * FROM evidence WHERE run_id = ?").bind(runId).all<Record<string, unknown>>();
  return json({ run_id: runId, evidence: out.results ?? [] });
};

const getDrafts: Handler = async ({ env, params }) => {
  const runId = params["id"] as string;
  if (!(await getRun(env, runId))) return err("run_not_found", 404);
  return json({ run_id: runId, drafts: await draftsForRun(env, runId) });
};

const getProspectDetail: Handler = async ({ env, params }) => {
  const p = await env.DB.prepare("SELECT * FROM prospect WHERE id = ?").bind(params["id"] as string)
    .first<Record<string, unknown>>();
  if (!p) return err("prospect_not_found", 404);
  const assessments = await env.DB.prepare("SELECT * FROM assessment WHERE prospect_id = ?").bind(p["id"])
    .all<Record<string, unknown>>();
  const aRows = (assessments.results ?? []).map((a) => ({
    ...a,
    supporting_evidence_ids: parseJson<string[]>(a["supporting_evidence_ids"] as string | null, []),
    weakening_evidence_ids: parseJson<string[]>(a["weakening_evidence_ids"] as string | null, []),
    uncertainties: parseJson<string[]>(a["uncertainties"] as string | null, []),
    missing_info: parseJson<string[]>(a["missing_info"] as string | null, []),
  }));
  const linked = new Set<string>();
  for (const a of aRows) {
    for (const id of [...a.supporting_evidence_ids, ...a.weakening_evidence_ids]) linked.add(id);
  }
  const ev = await env.DB.prepare("SELECT * FROM evidence WHERE run_id = ?").bind(p["run_id"])
    .all<Record<string, unknown>>();
  const routes = await env.DB.prepare("SELECT * FROM contact_route WHERE prospect_id = ?").bind(p["id"])
    .all<Record<string, unknown>>();
  return json({
    prospect: { ...p, location: parseJson<Record<string, string>>(p["location"] as string | null, {}) },
    assessments: aRows,
    evidence: (ev.results ?? []).filter((e) => linked.has(String(e["id"]))),
    contact_routes: routes.results ?? [],
  });
};

const patchDraft: Handler = async ({ req, env, params }) => {
  const draftId = params["id"] as string;
  const parsed = await readJson(req);
  if (!parsed.ok) return parsed.res;
  if (!isObj(parsed.body)) return err("invalid_body", 400);
  const subject = parsed.body["subject"];
  const bodyText = parsed.body["body"];
  if (subject === undefined && bodyText === undefined) return err("empty_patch", 400);
  if (subject !== undefined && typeof subject !== "string") return err("invalid_body", 400);
  if (bodyText !== undefined && typeof bodyText !== "string") return err("invalid_body", 400);
  if (typeof bodyText === "string" && bodyText.length > 4000) return err("body_too_long", 400);
  try {
    await editDraft(env.DB, {
      draft_id: draftId,
      ...(typeof subject === "string" ? { subject } : {}),
      ...(typeof bodyText === "string" ? { body: bodyText } : {}),
    });
  } catch (e) {
    if (e instanceof DbValidationError) {
      if (e.message.includes("does not exist")) return err("draft_not_found", 404);
      return err("illegal_edit", 400, e.message);
    }
    throw e;
  }
  const updated = await env.DB.prepare("SELECT * FROM outreach_draft WHERE id = ?").bind(draftId)
    .first<Record<string, unknown>>();
  return json({ draft: updated });
};

const postStart: Handler = async ({ env, params }) => {
  if (env.ENVIRONMENT === "production") return err("use_workflow", 501);
  const row = await getRun(env, params["id"] as string);
  if (!row) return err("run_not_found", 404);
  if (row.status !== "created") return err("run_not_startable", 409);
  const profile = await getProfile(env, row.profile_id);
  if (!profile) return err("profile_not_found", 404);
  // Brief excerpt carries description + service area + buyers so plan/search
  // prompts qualify queries with the locale (no hardcoded geography).
  const serviceNote = parseJson<{ note?: string }>(profile.service_area, {}).note;
  const excerptParts = [profile.description];
  if (serviceNote) excerptParts.push(`Serves: ${serviceNote}.`);
  if (profile.target_market) excerptParts.push(`Buyers: ${profile.target_market}.`);
  const excerpt = excerptParts.join(" ");
  const meta = createMetaClient({
    apiKey: env.MODEL_API_KEY,
    ...(env.MODEL_ID !== undefined ? { modelId: env.MODEL_ID } : {}),
    briefExcerpt: excerpt,
  });
  const wf = new ResearchWorkflow(
    {
      step: async (_name: string, fn: () => Promise<unknown>) => fn(),
      waitForEvent: async () => ({}),
      log: () => {},
    },
    {
      db: env.DB,
      meta,
      brief: { id: profile.id, status: profile.status === "confirmed" ? "confirmed" : "draft", excerpt },
      run_id: row.id,
    },
  );
  await wf.runPhases();
  const updated = (await getRun(env, row.id)) as RunRow;
  return json(serializeRun(updated), updated.status === "failed" ? 500 : 200);
};

const DECISIONS = ["approved", "rejected", "deferred"] as const;

const postDecision: Handler = async ({ req, env, params }) => {
  const draftId = params["id"] as string;
  const parsed = await readJson(req);
  if (!parsed.ok) return parsed.res;
  if (!isObj(parsed.body)) return err("invalid_body", 400);
  const decision = parsed.body["decision"];
  if (typeof decision !== "string" || !(DECISIONS as readonly string[]).includes(decision)) {
    return err("unknown_decision", 400);
  }
  const draft = await env.DB.prepare("SELECT id, prospect_id, status, edited_by_human FROM outreach_draft WHERE id = ?").bind(draftId)
    .first<{ id: string; prospect_id: string; status: string; edited_by_human: number }>();
  if (!draft) return err("draft_not_found", 404);
  const prospect = await env.DB.prepare("SELECT id, run_id FROM prospect WHERE id = ?").bind(draft.prospect_id)
    .first<{ id: string; run_id: string }>();
  if (!prospect) return err("prospect_not_found", 404);
  const subject = parsed.body["subject"];
  const bodyText = parsed.body["body"];
  if (subject !== undefined && typeof subject !== "string") return err("invalid_body", 400);
  if (bodyText !== undefined && typeof bodyText !== "string") return err("invalid_body", 400);
  if (typeof bodyText === "string" && bodyText.length > 4000) return err("body_too_long", 400);
  const edited = parsed.body["edited_by_human"] === true || subject !== undefined || bodyText !== undefined
    || draft.edited_by_human === 1;
  try {
    if (subject !== undefined || bodyText !== undefined) {
      await editDraft(env.DB, {
        draft_id: draftId,
        ...(typeof subject === "string" ? { subject } : {}),
        ...(typeof bodyText === "string" ? { body: bodyText } : {}),
      });
    }
    await decideDraftWithDb(env.DB, prospect.run_id, draftId, decision as DraftStatus, edited);
  } catch (e) {
    if (e instanceof DbValidationError) return err("illegal_decision", 400, e.message);
    throw e;
  }
  const run = await getRun(env, prospect.run_id);
  if (run) await sendWorkflowEvent(env, run.workflow_instance_id, "drafts_decided", { draft_id: draftId, decision });
  const updated = await env.DB.prepare("SELECT * FROM outreach_draft WHERE id = ?").bind(draftId).first<Record<string, unknown>>();
  return json({ run_id: prospect.run_id, draft: updated });
};

const getStatuses: Handler = async ({ env, params }) => {
  const runId = params["id"] as string;
  const run = await getRun(env, runId);
  if (!run) return err("run_not_found", 404);
  const prospects = await env.DB.prepare("SELECT id, status FROM prospect WHERE run_id = ?").bind(runId).all<{ id: string; status: string }>();
  const byStatus: Record<string, number> = {};
  for (const p of (prospects.results ?? [])) byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
  const drafts = await draftsForRun(env, runId);
  const draftsBy: Record<string, number> = {};
  for (const d of drafts) {
    const s = String(d["status"]);
    draftsBy[s] = (draftsBy[s] ?? 0) + 1;
  }
  return json({
    run_id: runId, run_status: run.status,
    prospects: { total: prospects.results?.length ?? 0, by_status: byStatus },
    drafts: { total: drafts.length, by_status: draftsBy, pending_decisions: draftsBy["draft"] ?? 0 },
  });
};

const getFollowUps: Handler = async ({ env, params }) => {
  const runId = params["id"] as string;
  if (!(await getRun(env, runId))) return err("run_not_found", 404);
  const drafts = await draftsForRun(env, runId);
  const nowMs = Date.now();
  const followUps: Array<Record<string, unknown>> = [];
  for (const d of drafts) {
    if (d["status"] !== "approved") continue;
    const days = d["follow_up_days"];
    const decidedAt = d["decided_at"];
    if (typeof days !== "number" || typeof decidedAt !== "string") continue;
    const dueMs = Date.parse(decidedAt) + days * 86400000;
    if (Number.isNaN(dueMs) || dueMs > nowMs) continue;
    followUps.push({
      draft_id: d["id"], prospect_id: d["prospect_id"],
      decided_at: decidedAt, follow_up_days: days,
      due_at: new Date(dueMs).toISOString(),
      days_overdue: Math.floor((nowMs - dueMs) / 86400000),
    });
  }
  return json({ run_id: runId, follow_ups: followUps });
};

// --- Router ------------------------------------------------------------------

const table: Array<{ method: string; pattern: RegExp; keys: string[]; handler: Handler }> = [];

function route(method: string, path: string, handler: Handler): void {
  const keys: string[] = [];
  const src = path.split("/").map((seg) => {
    if (seg.startsWith(":")) {
      keys.push(seg.slice(1));
      return "([^/]+)";
    }
    return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }).join("/");
  table.push({ method, pattern: new RegExp(`^${src}$`), keys, handler });
}

route("POST", "/api/profiles", postProfile);
route("GET", "/api/profiles/:id", getProfileById);
route("POST", "/api/profiles/:id/answers", postAnswers);
route("POST", "/api/profiles/:id/confirm", postConfirm);
route("POST", "/api/runs", postRun);
route("GET", "/api/runs/:id", getRunById);
route("POST", "/api/runs/:id/resume", postResume);
route("GET", "/api/runs/:id/prospects", getProspects);
route("GET", "/api/runs/:id/evidence", getEvidence);
route("GET", "/api/runs/:id/drafts", getDrafts);
route("POST", "/api/drafts/:id/decision", postDecision);
route("PATCH", "/api/drafts/:id", patchDraft);
route("GET", "/api/prospects/:id", getProspectDetail);
route("POST", "/api/runs/:id/start", postStart);
route("GET", "/api/runs/:id/statuses", getStatuses);
route("GET", "/api/runs/:id/follow-ups", getFollowUps);
route("POST", "/api/connections", (c) => delivery.postConnection(c.req, c.env));
route("GET", "/api/connections", (c) => delivery.getConnections(c.req, c.env));
route("GET", "/api/connections/gmail/auth-url", (c) => delivery.getGmailAuthUrl(c.req, c.env));
route("GET", "/api/connections/gmail/callback", (c) => delivery.getGmailCallback(c.req, c.env));
route("POST", "/api/connections/:id/verify", (c) => delivery.postVerifyConnection(c.req, c.env, c.params));
route("GET", "/api/relay-health", (c) => delivery.getRelayHealth(c.req, c.env));
route("POST", "/api/connections/:id/disconnect", (c) => delivery.postDisconnect(c.req, c.env, c.params));
route("POST", "/api/campaigns", (c) => delivery.postCampaign(c.req, c.env));
route("GET", "/api/campaigns", (c) => delivery.getCampaigns(c.req, c.env));
route("GET", "/api/campaigns/:id", (c) => delivery.getCampaignById(c.req, c.env, c.params));
route("PATCH", "/api/campaigns/:id", (c) => delivery.patchCampaign(c.req, c.env, c.params));
route("POST", "/api/campaigns/:id/approve", (c) => delivery.postApproveCampaign(c.req, c.env, c.params));
route("POST", "/api/campaigns/:id/cancel", (c) => delivery.postCancelCampaign(c.req, c.env, c.params));
route("POST", "/api/campaigns/:id/pause", (c) => delivery.postPauseCampaign(c.req, c.env, c.params));
route("POST", "/api/campaigns/:id/resume", (c) => delivery.postResumeCampaign(c.req, c.env, c.params));
route("POST", "/api/campaigns/:id/process", (c) => delivery.postProcessCampaign(c.req, c.env, c.params));
route("GET", "/api/assist/mailto", (c) => delivery.getAssistMailto(c.req, c.env));
route("GET", "/api/assist/wa", (c) => delivery.getAssistWa(c.req, c.env));
route("GET", "/api/suppressions", (c) => delivery.getSuppressions(c.req, c.env));
route("POST", "/api/suppressions", (c) => delivery.postSuppression(c.req, c.env));
route("DELETE", "/api/suppressions/:email", (c) => delivery.deleteSuppression(c.req, c.env, c.params));
route("GET", "/api/unsubscribe", (c) => delivery.getUnsubscribe(c.req, c.env));
route("POST", "/api/prospects/:id/contacts", (c) => delivery.postContact(c.req, c.env, c.params));
route("GET", "/api/prospects/:id/contacts", (c) => delivery.getContacts(c.req, c.env, c.params));
route("GET", "/api/prospects/:id/timeline", (c) => delivery.getTimeline(c.req, c.env, c.params));

export default {
  async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) {
      for (const r of table) {
        if (r.method !== req.method) continue;
        const m = r.pattern.exec(url.pathname);
        if (!m) continue;
        const params: Record<string, string> = {};
        r.keys.forEach((k, i) => {
          params[k] = decodeURIComponent(m[i + 1] as string);
        });
        try {
          return await r.handler({ req, env, params });
        } catch (e) {
          if (e instanceof DbValidationError) return err("validation", 400, e.message);
          throw e;
        }
      }
      return err("not_found", 404);
    }
    return err("not_implemented", 501);
  },
  async scheduled(_controller: unknown, env: Env, _ctx: ExecutionContext): Promise<void> {
    // Campaign delivery tick (triggers.crons): enqueue due recipients; the
    // queue consumer sends. Same producer as the manual process route.
    if (!env.DELIVERY_QUEUE) return;
    if (env.SMTP_RELAY) {
      // Roll the relay warm window while SMTP work is pending; the warmer
      // no-ops when idle and never blocks enqueueing.
      const ns = env.SMTP_RELAY;
      await warmSmtpRelay(env.DB, () => containerRelay(ns).get("/health"));
    }
    await enqueueDueJobs(env.DB, (job) => env.DELIVERY_QUEUE!.send(job),
      undefined, 10, env.SMTP_RELAY ? ["smtp"] : []);
  },
  async queue(batch: QueueBatch, _env: Env): Promise<void> {
    // Queue consumer: one attempt per message; handled outcomes ACK, crashes
    // retry then DLQ. (Env typed loosely: tests pass mock bindings.)
    const env = _env as Env;
    if (!env.CRED_KEY) return;
    await consumeDeliveryBatch(env.DB, {
      credKeyB64: env.CRED_KEY,
      unsubBaseUrl: env.PUBLIC_BASE_URL ? `${env.PUBLIC_BASE_URL}/api/unsubscribe?token=` : "",
      ...(env.SMTP_RELAY ? { providers: { smtp: smtpProvider(containerRelay(env.SMTP_RELAY)) } } : {}),
    }, batch.messages);
  },
};
