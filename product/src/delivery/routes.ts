/**
 * product/src/delivery/routes.ts — sender connections, campaigns, assist links.
 * Handlers are (req, env, params) functions registered thinly in index.ts.
 * Secrets are sealed with CRED_KEY and never returned to callers.
 */
import { DbValidationError, makeId, nowIso, type Db } from "../db";
import { hmacHex, openSecret, sealSecret, verifyUnsub } from "./crypto";
import { enqueueDueJobs } from "./processor";
import {
  buildMailto, buildWaMe, isValidEmail, providerFor, type ProviderId,
} from "./providers";

export interface DeliveryEnv {
  DB: Db;
  CRED_KEY?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  PUBLIC_BASE_URL?: string;
  DELIVERY_QUEUE?: { send(msg: unknown): Promise<void> };
}

type Params = Record<string, string>;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}
function err(code: string, status: number, detail?: string): Response {
  return json(detail === undefined ? { error: code } : { error: code, detail }, status);
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
function parseMeta(v: string | null): Record<string, unknown> {
  if (!v) return {};
  try {
    const p = JSON.parse(v) as unknown;
    return isObj(p) ? p : {};
  } catch {
    return {};
  }
}
function publicConn(row: Record<string, unknown>): Record<string, unknown> {
  const { secret_blob: _drop, ...rest } = row;
  return { ...rest, metadata: parseMeta(row["metadata_json"] as string | null) };
}
function needCredKey(env: DeliveryEnv): Response | null {
  if (!env.CRED_KEY) return err("credentials_unavailable", 501, "server credential key not configured");
  return null;
}

// --- sender connections -------------------------------------------------------

export async function postConnection(req: Request, env: DeliveryEnv): Promise<Response> {
  const keyErr = needCredKey(env);
  if (keyErr) return keyErr;
  const parsed = await readJson(req);
  if (!parsed.ok) return parsed.res;
  if (!isObj(parsed.body)) return err("invalid_body", 400);
  const { provider, label, sender_email, sender_name, secret } = parsed.body;
  if (provider !== "mock" && provider !== "resend" && provider !== "gmail") {
    return err("provider_unavailable", 400, "connectable providers: mock, resend, gmail (graph/smtp not implemented)");
  }
  if (typeof label !== "string" || !label.trim()) return err("missing_label", 400);
  if (typeof sender_email !== "string" || !isValidEmail(sender_email)) return err("invalid_sender_email", 400);
  if (sender_name !== undefined && typeof sender_name !== "string") return err("invalid_body", 400);
  const secretObj: Record<string, unknown> =
    provider === "mock" ? (isObj(secret) ? secret : {}) : isObj(secret) ? secret : {};
  if (provider === "resend" && typeof secretObj["api_key"] !== "string") {
    return err("missing_secret", 400, "resend needs {api_key}");
  }
  if (provider === "gmail" && (
    typeof secretObj["refresh_token"] !== "string" || typeof secretObj["client_id"] !== "string" ||
    typeof secretObj["client_secret"] !== "string")) {
    return err("missing_secret", 400, "gmail needs {refresh_token, client_id, client_secret} — or use the Gmail OAuth flow");
  }
  const blob = await sealSecret(JSON.stringify(secretObj), env.CRED_KEY as string);
  const id = makeId("conn");
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO sender_connection (id, provider, label, sender_email, sender_name, status, secret_blob, metadata_json, last_verified_at, last_error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, provider, (label as string).trim(), (sender_email as string).trim().toLowerCase(),
    typeof sender_name === "string" ? sender_name : null, "pending", JSON.stringify(blob), "{}", null, null, now, now).run();
  const row = await env.DB.prepare("SELECT * FROM sender_connection WHERE id = ?").bind(id).first<Record<string, unknown>>();
  return json(publicConn((row ?? {}) as Record<string, unknown>), 201);
}

export async function getConnections(_req: Request, env: DeliveryEnv): Promise<Response> {
  const out = await env.DB.prepare("SELECT * FROM sender_connection").all<Record<string, unknown>>();
  return json({ connections: (out.results ?? []).map(publicConn) });
}

export async function postVerifyConnection(_req: Request, env: DeliveryEnv, params: Params): Promise<Response> {
  const keyErr = needCredKey(env);
  if (keyErr) return keyErr;
  const row = await env.DB.prepare("SELECT * FROM sender_connection WHERE id = ?").bind(params["id"])
    .first<Record<string, unknown>>();
  if (!row) return err("connection_not_found", 404);
  const provider = providerFor(row["provider"] as ProviderId);
  let secret: string;
  try {
    secret = await openSecret(JSON.parse(row["secret_blob"] as string), env.CRED_KEY as string);
  } catch {
    await env.DB.prepare("UPDATE sender_connection SET status = ?, last_error = ?, updated_at = ? WHERE id = ?")
      .bind("error", "cannot open credentials", nowIso(), row["id"]).run();
    return err("verification_failed", 400, "cannot open credentials");
  }
  const res = await provider.verify({ secret, senderEmail: row["sender_email"] as string });
  const now = nowIso();
  if (res.ok) {
    await env.DB.prepare("UPDATE sender_connection SET status = ?, last_verified_at = ?, last_error = ?, updated_at = ? WHERE id = ?")
      .bind("connected", now, null, now, row["id"]).run();
  } else {
    await env.DB.prepare("UPDATE sender_connection SET status = ?, last_error = ?, updated_at = ? WHERE id = ?")
      .bind("error", res.error ?? "verification failed", now, row["id"]).run();
  }
  const updated = await env.DB.prepare("SELECT * FROM sender_connection WHERE id = ?").bind(row["id"]).first<Record<string, unknown>>();
  return json(publicConn((updated ?? {}) as Record<string, unknown>), res.ok ? 200 : 400);
}

export async function postDisconnect(_req: Request, env: DeliveryEnv, params: Params): Promise<Response> {
  const row = await env.DB.prepare("SELECT id FROM sender_connection WHERE id = ?").bind(params["id"]).first<{ id: string }>();
  if (!row) return err("connection_not_found", 404);
  await env.DB.prepare("UPDATE sender_connection SET status = ?, secret_blob = ?, updated_at = ? WHERE id = ?")
    .bind("revoked", null, nowIso(), params["id"]).run();
  return json({ id: params["id"], status: "revoked" });
}

// --- Gmail OAuth (separate from login; user provisions the Google app) ----------

const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.send";

function callbackUrl(req: Request): string {
  const u = new URL(req.url);
  return `${u.origin}/api/connections/gmail/callback`;
}

export async function getGmailAuthUrl(req: Request, env: DeliveryEnv): Promise<Response> {
  const keyErr = needCredKey(env);
  if (keyErr) return keyErr;
  if (!env.GOOGLE_CLIENT_ID) return err("oauth_unconfigured", 501, "GOOGLE_CLIENT_ID not configured on the server");
  const q = new URL(req.url).searchParams;
  const label = (q.get("label") || "Gmail").slice(0, 80);
  const sender = (q.get("sender_email") || "").trim().toLowerCase();
  if (sender && !isValidEmail(sender)) return err("invalid_sender_email", 400);
  const payload = btoa(JSON.stringify({ label, sender_email: sender, ts: Date.now() }));
  const sig = await hmacHex(env.CRED_KEY as string, "gmail-oauth:" + payload);
  const url = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: callbackUrl(req),
    response_type: "code",
    scope: GMAIL_SCOPE,
    access_type: "offline",
    prompt: "consent",
    state: `${payload}.${sig}`,
  }).toString();
  return json({ url });
}

export async function getGmailCallback(req: Request, env: DeliveryEnv): Promise<Response> {
  const keyErr = needCredKey(env);
  if (keyErr) return keyErr;
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return err("oauth_unconfigured", 501, "GOOGLE_CLIENT_ID/SECRET not configured on the server");
  }
  const q = new URL(req.url).searchParams;
  const code = q.get("code");
  const state = q.get("state") || "";
  if (!code) return err("oauth_failed", 400, q.get("error") || "no code returned");
  const dot = state.lastIndexOf(".");
  if (dot <= 0) return err("oauth_failed", 400, "bad state");
  const payload = state.slice(0, dot);
  const want = await hmacHex(env.CRED_KEY as string, "gmail-oauth:" + payload);
  if (state.slice(dot + 1) !== want) return err("oauth_failed", 400, "bad state signature");
  let decoded: { label?: string; sender_email?: string; ts?: number };
  try {
    decoded = JSON.parse(atob(payload)) as { label?: string; sender_email?: string; ts?: number };
  } catch {
    return err("oauth_failed", 400, "bad state payload");
  }
  if (!decoded.ts || Date.now() - decoded.ts > 24 * 3600_000) return err("oauth_failed", 400, "state expired");
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: callbackUrl(req), grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!tokenRes.ok) return err("oauth_failed", 400, `token exchange HTTP ${tokenRes.status}`);
  const tokens = (await tokenRes.json().catch(() => ({}))) as { refresh_token?: string };
  if (!tokens.refresh_token) return err("oauth_failed", 400, "no refresh_token returned; remove the app grant and retry");
  const blob = await sealSecret(JSON.stringify({
    refresh_token: tokens.refresh_token, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
  }), env.CRED_KEY as string);
  const id = makeId("conn");
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO sender_connection (id, provider, label, sender_email, sender_name, status, secret_blob, metadata_json, last_verified_at, last_error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, "gmail", decoded.label || "Gmail", decoded.sender_email || "", null, "connected",
    JSON.stringify(blob), "{}", now, null, now, now).run();
  const row = await env.DB.prepare("SELECT * FROM sender_connection WHERE id = ?").bind(id).first<Record<string, unknown>>();
  return json(publicConn((row ?? {}) as Record<string, unknown>), 201);
}

// --- campaigns -------------------------------------------------------------------

interface RecipientInput { email: string; subject: string; body: string; prospect_id?: string }

function validSchedule(value: unknown): string | null {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString();
}
function validTimezone(value: unknown): string {
  const tz = typeof value === "string" && value ? value : "UTC";
  try {
    if (!(Intl.supportedValuesOf("timeZone") as string[]).includes(tz)) return "UTC";
  } catch {
    return "UTC";
  }
  return tz;
}

async function insertRecipients(db: Db, campaignId: string, list: RecipientInput[]): Promise<Response | null> {
  const seen = new Set<string>();
  for (const r of list) {
    if (!isObj(r)) return err("invalid_recipient", 400);
    const email = typeof r["email"] === "string" ? (r["email"] as string).trim().toLowerCase() : "";
    if (!isValidEmail(email)) return err("invalid_recipient", 400, `bad email: ${String(r["email"]).slice(0, 80)}`);
    if (seen.has(email)) return err("duplicate_recipient", 400, email);
    seen.add(email);
    if (typeof r["subject"] !== "string" || !r["subject"].trim()) return err("invalid_recipient", 400, "subject required");
    if (typeof r["body"] !== "string" || !r["body"].trim()) return err("invalid_recipient", 400, "body required");
    if (r["prospect_id"] !== undefined) {
      const p = await db.prepare("SELECT id FROM prospect WHERE id = ?").bind(r["prospect_id"]).first<{ id: string }>();
      if (!p) return err("prospect_not_found", 400, String(r["prospect_id"]).slice(0, 64));
    }
  }
  const now = nowIso();
  for (const r of list) {
    await db.prepare(
      `INSERT INTO campaign_recipient (id, campaign_id, prospect_id, email, subject_snapshot, body_snapshot, status, attempts, provider_message_id, idempotency_key, last_error, next_attempt_at, sent_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(makeId("rcpt"), campaignId,
      typeof r["prospect_id"] === "string" ? r["prospect_id"] : null,
      (r["email"] as string).trim().toLowerCase(), (r["subject"] as string).trim(), r["body"] as string,
      "queued", 0, null, makeId("idem"), null, null, null, now, now).run();
  }
  return null;
}

export async function postCampaign(req: Request, env: DeliveryEnv): Promise<Response> {
  const parsed = await readJson(req);
  if (!parsed.ok) return parsed.res;
  if (!isObj(parsed.body)) return err("invalid_body", 400);
  const { name, run_id, connection_id, recipients, scheduled_at_utc, timezone } = parsed.body;
  if (typeof name !== "string" || !name.trim()) return err("missing_name", 400);
  if (!Array.isArray(recipients) || recipients.length === 0) return err("missing_recipients", 400);
  if (recipients.length > 500) return err("too_many_recipients", 400, "max 500 per campaign in this MVP");
  if (run_id !== undefined) {
    const run = await env.DB.prepare("SELECT id FROM research_run WHERE id = ?").bind(run_id).first<{ id: string }>();
    if (!run) return err("run_not_found", 400);
  }
  if (connection_id !== undefined) {
    const conn = await env.DB.prepare("SELECT id FROM sender_connection WHERE id = ?").bind(connection_id).first<{ id: string }>();
    if (!conn) return err("connection_not_found", 400);
  }
  let scheduled: string | null = null;
  if (scheduled_at_utc !== undefined) {
    scheduled = validSchedule(scheduled_at_utc);
    if (!scheduled) return err("invalid_schedule", 400, "scheduled_at_utc must be a parseable date");
  }
  const id = makeId("cmp");
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO campaign (id, run_id, name, connection_id, status, scheduled_at_utc, timezone, approved_at, stats_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, typeof run_id === "string" ? run_id : null, (name as string).trim(),
    typeof connection_id === "string" ? connection_id : null, "draft", scheduled, validTimezone(timezone),
    null, "{}", now, now).run();
  const recErr = await insertRecipients(env.DB, id, recipients as RecipientInput[]);
  if (recErr) {
    await env.DB.prepare("UPDATE campaign SET status = ?, updated_at = ? WHERE id = ?").bind("failed", nowIso(), id).run();
    return recErr;
  }
  return json(await campaignDetail(env.DB, id), 201);
}

export async function campaignDetail(db: Db, id: string | undefined): Promise<Record<string, unknown> | null> {
  if (!id) return null;
  const row = await db.prepare("SELECT * FROM campaign WHERE id = ?").bind(id).first<Record<string, unknown>>();
  if (!row) return null;
  const recs = await db.prepare("SELECT * FROM campaign_recipient WHERE campaign_id = ?").bind(id).all<Record<string, unknown>>();
  const recipients = recs.results ?? [];
  const attempts: Record<string, unknown>[] = [];
  for (const r of recipients) {
    const att = await db.prepare("SELECT * FROM delivery_attempt WHERE recipient_id = ?").bind(r["id"]).all<Record<string, unknown>>();
    attempts.push(...(att.results ?? []));
  }
  return { ...row, stats: parseMeta(row["stats_json"] as string | null), recipients, attempts };
}

export async function getCampaigns(_req: Request, env: DeliveryEnv): Promise<Response> {
  const out = await env.DB.prepare("SELECT * FROM campaign").all<Record<string, unknown>>();
  return json({ campaigns: out.results ?? [] });
}

export async function getCampaignById(_req: Request, env: DeliveryEnv, params: Params): Promise<Response> {
  const detail = await campaignDetail(env.DB, params["id"]);
  if (!detail) return err("campaign_not_found", 404);
  return json(detail);
}

export async function patchCampaign(req: Request, env: DeliveryEnv, params: Params): Promise<Response> {
  const row = await env.DB.prepare("SELECT * FROM campaign WHERE id = ?").bind(params["id"]).first<Record<string, unknown>>();
  if (!row) return err("campaign_not_found", 404);
  if (row["status"] !== "draft") return err("campaign_locked", 409, "only draft campaigns can be edited; cancel and recreate to change an approved campaign");
  const parsed = await readJson(req);
  if (!parsed.ok) return parsed.res;
  if (!isObj(parsed.body)) return err("invalid_body", 400);
  const { name, recipients, connection_id, scheduled_at_utc, timezone } = parsed.body;
  if (name !== undefined) {
    if (typeof name !== "string" || !name.trim()) return err("invalid_body", 400);
    await env.DB.prepare("UPDATE campaign SET name = ?, updated_at = ? WHERE id = ?").bind(name.trim(), nowIso(), row["id"]).run();
  }
  if (connection_id !== undefined) {
    const conn = await env.DB.prepare("SELECT id FROM sender_connection WHERE id = ?").bind(connection_id).first<{ id: string }>();
    if (!conn) return err("connection_not_found", 400);
    await env.DB.prepare("UPDATE campaign SET connection_id = ?, updated_at = ? WHERE id = ?").bind(connection_id, nowIso(), row["id"]).run();
  }
  if (scheduled_at_utc !== undefined) {
    const scheduled = validSchedule(scheduled_at_utc);
    if (!scheduled) return err("invalid_schedule", 400);
    await env.DB.prepare("UPDATE campaign SET scheduled_at_utc = ?, updated_at = ? WHERE id = ?").bind(scheduled, nowIso(), row["id"]).run();
  }
  if (timezone !== undefined) {
    await env.DB.prepare("UPDATE campaign SET timezone = ?, updated_at = ? WHERE id = ?").bind(validTimezone(timezone), nowIso(), row["id"]).run();
  }
  if (recipients !== undefined) {
    if (!Array.isArray(recipients) || recipients.length === 0) return err("missing_recipients", 400);
    const existing = await env.DB.prepare("SELECT id FROM campaign_recipient WHERE campaign_id = ?").bind(row["id"]).all<{ id: string }>();
    for (const r of (existing.results ?? [])) {
      await env.DB.prepare("UPDATE campaign_recipient SET status = ? WHERE id = ?").bind("cancelled", r.id).run();
    }
    const recErr = await insertRecipients(env.DB, row["id"] as string, recipients as RecipientInput[]);
    if (recErr) return recErr;
  }
  return json(await campaignDetail(env.DB, row["id"] as string));
}

export async function postApproveCampaign(req: Request, env: DeliveryEnv, params: Params): Promise<Response> {
  const row = await env.DB.prepare("SELECT * FROM campaign WHERE id = ?").bind(params["id"]).first<Record<string, unknown>>();
  if (!row) return err("campaign_not_found", 404);
  if (row["status"] !== "draft") return err("campaign_locked", 409, "only draft campaigns can be approved");
  const parsed = await readJson(req);
  if (!parsed.ok) return parsed.res;
  const body = isObj(parsed.body) ? parsed.body : {};
  const connectionId = typeof body["connection_id"] === "string" ? body["connection_id"] : (row["connection_id"] as string | null);
  if (!connectionId) return err("missing_sender", 400, "choose a connected sender before approving");
  const conn = await env.DB.prepare("SELECT * FROM sender_connection WHERE id = ?").bind(connectionId).first<Record<string, unknown>>();
  if (!conn) return err("connection_not_found", 400);
  if (conn["status"] !== "connected") return err("sender_not_connected", 400, "verify the sender connection before approving");
  const scheduledRaw = body["scheduled_at_utc"] !== undefined ? body["scheduled_at_utc"] : row["scheduled_at_utc"];
  const scheduled = validSchedule(scheduledRaw);
  if (!scheduled) return err("invalid_schedule", 400, "scheduled_at_utc must be a parseable date");
  const recs = await env.DB.prepare("SELECT * FROM campaign_recipient WHERE campaign_id = ?").bind(row["id"]).all<Record<string, unknown>>();
  const active = (recs.results ?? []).filter((r) => r["status"] === "queued" || r["status"] === "scheduled");
  if (active.length === 0) return err("missing_recipients", 400, "campaign has no sendable recipients");
  // Early suppression pass (the processor re-checks at send time).
  for (const r of active) {
    const blocked = await env.DB.prepare("SELECT email FROM suppression WHERE email = ?")
      .bind(String(r["email"]).toLowerCase()).first<{ email: string }>();
    if (blocked) {
      await env.DB.prepare("UPDATE campaign_recipient SET status = ?, last_error = ?, updated_at = ? WHERE id = ?")
        .bind("suppressed", "suppressed at approval", nowIso(), r["id"]).run();
    }
  }
  const now = nowIso();
  await env.DB.prepare(
    "UPDATE campaign SET connection_id = ?, status = ?, scheduled_at_utc = ?, timezone = ?, approved_at = ?, updated_at = ? WHERE id = ?",
  ).bind(connectionId, "scheduled", scheduled,
    body["timezone"] !== undefined ? validTimezone(body["timezone"]) : (row["timezone"] as string),
    now, now, row["id"]).run();
  return json(await campaignDetail(env.DB, row["id"] as string));
}

async function setCampaignStatus(db: Db, id: string | undefined, to: string, from: string[]): Promise<Record<string, unknown> | null> {
  if (!id) return null;
  const row = await db.prepare("SELECT * FROM campaign WHERE id = ?").bind(id).first<Record<string, unknown>>();
  if (!row || !from.includes(row["status"] as string)) return null;
  await db.prepare("UPDATE campaign SET status = ?, updated_at = ? WHERE id = ?").bind(to, nowIso(), id).run();
  return row;
}

export async function postCancelCampaign(_req: Request, env: DeliveryEnv, params: Params): Promise<Response> {
  const row = await setCampaignStatus(env.DB, params["id"], "cancelled", ["draft", "scheduled", "sending", "paused"]);
  if (!row) return err("campaign_not_cancellable", 409);
  const recs = await env.DB.prepare("SELECT * FROM campaign_recipient WHERE campaign_id = ?").bind(params["id"]).all<Record<string, unknown>>();
  for (const r of (recs.results ?? [])) {
    if (r["status"] === "queued" || r["status"] === "scheduled" || r["status"] === "sending") {
      await env.DB.prepare("UPDATE campaign_recipient SET status = ?, updated_at = ? WHERE id = ?").bind("cancelled", nowIso(), r["id"]).run();
    }
  }
  return json(await campaignDetail(env.DB, params["id"]));
}

export async function postPauseCampaign(_req: Request, env: DeliveryEnv, params: Params): Promise<Response> {
  const row = await setCampaignStatus(env.DB, params["id"], "paused", ["scheduled", "sending"]);
  if (!row) return err("campaign_not_pausable", 409);
  return json(await campaignDetail(env.DB, params["id"]));
}

export async function postResumeCampaign(_req: Request, env: DeliveryEnv, params: Params): Promise<Response> {
  const row = await setCampaignStatus(env.DB, params["id"], "scheduled", ["paused"]);
  if (!row) return err("campaign_not_resumable", 409);
  return json(await campaignDetail(env.DB, params["id"]));
}

export async function postProcessCampaign(_req: Request, env: DeliveryEnv, params: Params): Promise<Response> {
  const row = await env.DB.prepare("SELECT * FROM campaign WHERE id = ?").bind(params["id"]).first<Record<string, unknown>>();
  if (!row) return err("campaign_not_found", 404);
  if (row["status"] !== "scheduled" && row["status"] !== "sending") {
    return err("campaign_not_processable", 409, "only scheduled/sending campaigns can be processed");
  }
  if (!env.DELIVERY_QUEUE) return err("queue_unavailable", 501, "delivery queue not bound");
  const queue = env.DELIVERY_QUEUE;
  const summary = await enqueueDueJobs(env.DB, (job) => queue.send(job));
  return json({ summary, campaign: await campaignDetail(env.DB, params["id"]) });
}

// --- assisted delivery -----------------------------------------------------------

export async function getAssistMailto(req: Request, _env: DeliveryEnv): Promise<Response> {
  const q = new URL(req.url).searchParams;
  try {
    return json({ url: buildMailto(q.get("to") || "", q.get("subject") || "", q.get("body") || "") });
  } catch (e) {
    return err("invalid_assist", 400, e instanceof Error ? e.message : "bad request");
  }
}

export async function getAssistWa(req: Request, _env: DeliveryEnv): Promise<Response> {
  const q = new URL(req.url).searchParams;
  try {
    return json({ url: buildWaMe(q.get("phone") || "", q.get("message") || "") });
  } catch (e) {
    return err("invalid_assist", 400, e instanceof Error ? e.message : "bad request");
  }
}

// --- suppressions + unsubscribe ----------------------------------------------------

const REASONS = ["unsubscribed", "bounced", "complaint", "manual"];

export async function getSuppressions(_req: Request, env: DeliveryEnv): Promise<Response> {
  const out = await env.DB.prepare("SELECT * FROM suppression").all<Record<string, unknown>>();
  return json({ suppressions: out.results ?? [] });
}

export async function postSuppression(req: Request, env: DeliveryEnv): Promise<Response> {
  const parsed = await readJson(req);
  if (!parsed.ok) return parsed.res;
  if (!isObj(parsed.body)) return err("invalid_body", 400);
  const email = typeof parsed.body["email"] === "string" ? (parsed.body["email"] as string).trim().toLowerCase() : "";
  if (!isValidEmail(email)) return err("invalid_email", 400);
  const reason = typeof parsed.body["reason"] === "string" ? parsed.body["reason"] : "manual";
  if (!REASONS.includes(reason)) return err("invalid_reason", 400);
  const existing = await env.DB.prepare("SELECT email FROM suppression WHERE email = ?").bind(email).first<{ email: string }>();
  if (!existing) {
    await env.DB.prepare("INSERT INTO suppression (email, reason, source, created_at) VALUES (?, ?, ?, ?)")
      .bind(email, reason, "api", nowIso()).run();
  }
  return json({ email, suppressed: true }, 201);
}

export async function deleteSuppression(_req: Request, env: DeliveryEnv, params: Params): Promise<Response> {
  const email = (params["email"] || "").trim().toLowerCase();
  const existing = await env.DB.prepare("SELECT email FROM suppression WHERE email = ?").bind(email).first<{ email: string }>();
  if (!existing) return err("suppression_not_found", 404);
  await env.DB.prepare("DELETE FROM suppression WHERE email = ?").bind(email).run();
  return json({ email, suppressed: false });
}

export async function getUnsubscribe(req: Request, env: DeliveryEnv): Promise<Response> {
  const keyErr = needCredKey(env);
  if (keyErr) return keyErr;
  const token = new URL(req.url).searchParams.get("token") || "";
  const id = await verifyUnsub(env.CRED_KEY as string, token);
  if (!id) return new Response("This unsubscribe link is invalid.", { status: 400, headers: { "content-type": "text/plain" } });
  const rec = await env.DB.prepare("SELECT * FROM campaign_recipient WHERE id = ?").bind(id).first<Record<string, unknown>>();
  if (!rec) return new Response("This unsubscribe link is invalid.", { status: 400, headers: { "content-type": "text/plain" } });
  const email = String(rec["email"]).toLowerCase();
  const existing = await env.DB.prepare("SELECT email FROM suppression WHERE email = ?").bind(email).first<{ email: string }>();
  if (!existing) {
    await env.DB.prepare("INSERT INTO suppression (email, reason, source, created_at) VALUES (?, ?, ?, ?)")
      .bind(email, "unsubscribed", "unsubscribe-link", nowIso()).run();
  }
  if (rec["status"] === "queued" || rec["status"] === "scheduled" || rec["status"] === "sending") {
    await env.DB.prepare("UPDATE campaign_recipient SET status = ?, updated_at = ? WHERE id = ?").bind("suppressed", nowIso(), id).run();
  }
  return new Response(
    "<!doctype html><title>Unsubscribed</title><p>You have been unsubscribed and will not receive further campaign mail.</p>",
    { status: 200, headers: { "content-type": "text/html" } },
  );
}

// --- contact tracking ---------------------------------------------------------------

const CONTACT_CHANNELS = ["email", "whatsapp", "telegram", "phone", "sms", "in_person", "other"];

export async function postContact(req: Request, env: DeliveryEnv, params: Params): Promise<Response> {
  const prospectId = params["id"] as string;
  const prospect = await env.DB.prepare("SELECT id, run_id FROM prospect WHERE id = ?").bind(prospectId)
    .first<{ id: string; run_id: string }>();
  if (!prospect) return err("prospect_not_found", 404);
  const parsed = await readJson(req);
  if (!parsed.ok) return parsed.res;
  if (!isObj(parsed.body)) return err("invalid_body", 400);
  const { channel, direction, note, contacted_at, campaign_id } = parsed.body;
  if (typeof channel !== "string" || !CONTACT_CHANNELS.includes(channel)) {
    return err("invalid_channel", 400, `channel: ${CONTACT_CHANNELS.join("|")}`);
  }
  const dir = direction === undefined ? "outbound" : direction;
  if (dir !== "outbound" && dir !== "inbound") return err("invalid_direction", 400);
  let at = nowIso();
  if (contacted_at !== undefined) {
    if (typeof contacted_at !== "string" || Number.isNaN(Date.parse(contacted_at))) return err("invalid_contacted_at", 400);
    at = new Date(contacted_at).toISOString();
  }
  if (campaign_id !== undefined) {
    const c = await env.DB.prepare("SELECT id FROM campaign WHERE id = ?").bind(campaign_id).first<{ id: string }>();
    if (!c) return err("campaign_not_found", 400);
  }
  const id = makeId("ce");
  await env.DB.prepare(
    `INSERT INTO contact_event (id, prospect_id, campaign_id, recipient_id, channel, direction, note, contacted_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, prospectId, typeof campaign_id === "string" ? campaign_id : null, null, channel, dir,
    typeof note === "string" ? note.slice(0, 500) : null, at, nowIso()).run();
  await env.DB.prepare("INSERT INTO activity (id, run_id, prospect_id, event, note, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(makeId("ac"), prospect.run_id, prospectId, "contacted", `${dir}:${channel}`, nowIso()).run();
  const row = await env.DB.prepare("SELECT * FROM contact_event WHERE id = ?").bind(id).first<Record<string, unknown>>();
  return json(row, 201);
}

export async function getContacts(_req: Request, env: DeliveryEnv, params: Params): Promise<Response> {
  const prospectId = params["id"] as string;
  const prospect = await env.DB.prepare("SELECT id FROM prospect WHERE id = ?").bind(prospectId).first<{ id: string }>();
  if (!prospect) return err("prospect_not_found", 404);
  const out = await env.DB.prepare("SELECT * FROM contact_event WHERE prospect_id = ?").bind(prospectId).all<Record<string, unknown>>();
  const rows = (out.results ?? []).sort((a, b) => (String(a["contacted_at"]) < String(b["contacted_at"]) ? 1 : -1));
  return json({ prospect_id: prospectId, contacts: rows });
}

export async function getTimeline(_req: Request, env: DeliveryEnv, params: Params): Promise<Response> {
  const prospectId = params["id"] as string;
  const prospect = await env.DB.prepare("SELECT id FROM prospect WHERE id = ?").bind(prospectId).first<{ id: string }>();
  if (!prospect) return err("prospect_not_found", 404);
  const contacts = await env.DB.prepare("SELECT * FROM contact_event WHERE prospect_id = ?").bind(prospectId).all<Record<string, unknown>>();
  const acts = await env.DB.prepare("SELECT * FROM activity WHERE prospect_id = ?").bind(prospectId).all<Record<string, unknown>>();
  const items = [
    ...(contacts.results ?? []).map((c) => ({ kind: "contact", at: c["contacted_at"], channel: c["channel"], direction: c["direction"], note: c["note"] })),
    ...(acts.results ?? []).map((a) => ({ kind: "activity", at: a["created_at"], event: a["event"], note: a["note"] })),
  ].sort((a, b) => (String(a.at) < String(b.at) ? 1 : -1));
  return json({ prospect_id: prospectId, timeline: items });
}

export function dbError(e: unknown): Response | null {
  if (e instanceof DbValidationError) return err("validation", 400, e.message);
  return null;
}
