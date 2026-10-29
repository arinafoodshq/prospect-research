/**
 * product/src/delivery/processor.ts — queue-based campaign execution.
 * Producer (cron tick / manual process route): collect due recipients, claim
 * them, enqueue one job each. Consumer (queue() handler): send one attempt.
 * App-level retries (transient provider errors) requeue with backoff and ACK;
 * queue-level retries + DLQ catch crashes only. Idempotent throughout.
 */
import { makeId, nowIso, type Db } from "../db";
import { openSecret, signUnsub } from "./crypto";
import {
  isValidEmail, providerFor,
  type ConnCreds, type DeliveryProvider, type ProviderId, type SendRequest, type SendResult,
} from "./providers";

export interface DeliveryJob { recipientId: string; campaignId: string; claim: string }

export interface ConsumerDeps {
  credKeyB64: string;
  unsubBaseUrl: string;
  providers?: Partial<Record<ProviderId, DeliveryProvider>>;
}

export type ConsumeOutcome = "sent" | "failed" | "requeued" | "skipped" | "stale";

interface RecipientRow {
  id: string; campaign_id: string; prospect_id: string | null; email: string;
  subject_snapshot: string; body_snapshot: string;
  status: string; attempts: number; next_attempt_at: string | null;
  idempotency_key: string; updated_at: string; created_at: string;
}

/** Record a campaign send as a contact event (skips recipients without a prospect). */
async function logSendContact(db: Db, recipientId: string, prospectId: string | null, campaignId: string, now: string): Promise<void> {
  if (!prospectId) return;
  await db.prepare(
    `INSERT INTO contact_event (id, prospect_id, campaign_id, recipient_id, channel, direction, note, contacted_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(makeId("ce"), prospectId, campaignId, recipientId, "email", "outbound", "campaign send", now, now).run();
}

const MAX_ATTEMPTS = 3;
const STALE_SENDING_MIN = 15;

function backoffIso(nowMs: number, attempts: number): string {
  return new Date(nowMs + 2 ** Math.min(attempts, 6) * 60_000).toISOString();
}

async function logAttempt(
  db: Db, recipientId: string, attemptNo: number, status: string,
  providerMessageId: string | null, category: string | null, detail: string | null,
): Promise<void> {
  await db.prepare(
    `INSERT INTO delivery_attempt (id, recipient_id, attempt_no, status, provider_message_id, error_category, error_detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(makeId("att"), recipientId, attemptNo, status, providerMessageId, category, detail, nowIso()).run();
}

async function suppress(db: Db, email: string, reason: string): Promise<void> {
  const norm = email.trim().toLowerCase();
  const existing = await db.prepare("SELECT email FROM suppression WHERE email = ?").bind(norm).first<{ email: string }>();
  if (!existing) {
    await db.prepare("INSERT INTO suppression (email, reason, source, created_at) VALUES (?, ?, ?, ?)")
      .bind(norm, reason, "delivery", nowIso()).run();
  }
}

/**
 * Claim one recipient for this producer: guarded UPDATE + read-back stamp
 * check. Returns the claimed row or null when another worker won.
 */
async function claimRecipient(db: Db, id: string, from: string, stamp: string): Promise<RecipientRow | null> {
  await db.prepare("UPDATE campaign_recipient SET status = ?, updated_at = ? WHERE id = ? AND status = ?")
    .bind("sending", stamp, id, from).run();
  const row = await db.prepare("SELECT * FROM campaign_recipient WHERE id = ?").bind(id).first<RecipientRow>();
  if (!row || row.status !== "sending" || row.updated_at !== stamp) return null;
  return row;
}

/**
 * Producer: recover stale rows, find due campaigns, claim + enqueue.
 * Never sends. Failing a campaign (bad sender) skips its recipients.
 */
export async function enqueueDueJobs(
  db: Db, send: (job: DeliveryJob) => Promise<void>, nowOverride?: string, batch = 10,
  injected: ProviderId[] = [],
): Promise<{ enqueued: number; skipped: number }> {
  const out = { enqueued: 0, skipped: 0 };
  const now = nowOverride ?? nowIso();
  const nowMs = Date.parse(now);
  const staleBefore = new Date(nowMs - STALE_SENDING_MIN * 60_000).toISOString();

  const stuck = await db.prepare("SELECT * FROM campaign_recipient WHERE status = ?").bind("sending").all<RecipientRow>();
  for (const row of (stuck.results ?? [])) {
    if (row.updated_at >= staleBefore) continue;
    const attempts = row.attempts + 1;
    const terminal = attempts >= MAX_ATTEMPTS;
    await db.prepare("UPDATE campaign_recipient SET status = ?, attempts = ?, last_error = ?, updated_at = ? WHERE id = ?")
      .bind(terminal ? "failed" : "queued", attempts, "stale sending recovered", now, row.id).run();
    await logAttempt(db, row.id, attempts, terminal ? "failed" : "requeued", null, "transient", "stale sending recovered");
  }

  const all = await db.prepare("SELECT * FROM campaign").all<Record<string, string | null>>();
  const due = (all.results ?? []).filter((c) =>
    (c["status"] === "scheduled" || c["status"] === "sending") &&
    c["scheduled_at_utc"] !== null && (c["scheduled_at_utc"] as string) <= now);

  for (const c of due) {
    if (out.enqueued >= batch) break;
    const campaignId = c["id"] as string;
    const connId = c["connection_id"] as string | null;
    const conn = connId
      ? await db.prepare("SELECT * FROM sender_connection WHERE id = ?").bind(connId)
        .first<{ id: string; provider: ProviderId; status: string; secret_blob: string | null }>()
      : null;
    if (!conn || conn.status !== "connected" || !conn.secret_blob) {
      await db.prepare("UPDATE campaign SET status = ?, stats_json = ?, updated_at = ? WHERE id = ?")
        .bind("failed", JSON.stringify({ error: "sender not connected" }), now, campaignId).run();
      continue;
    }
    try {
      // Injected providers (smtp via the relay client) are unavailable to the
      // bare registry by design; the caller vouches for them explicitly.
      if (!injected.includes(conn.provider)) providerFor(conn.provider);
    } catch {
      await db.prepare("UPDATE campaign SET status = ?, stats_json = ?, updated_at = ? WHERE id = ?")
        .bind("failed", JSON.stringify({ error: `provider ${conn.provider} unavailable` }), now, campaignId).run();
      continue;
    }
    if (c["status"] === "scheduled") {
      await db.prepare("UPDATE campaign SET status = ?, updated_at = ? WHERE id = ?").bind("sending", now, campaignId).run();
    }
    const recs = await db.prepare("SELECT * FROM campaign_recipient WHERE campaign_id = ?").bind(campaignId).all<RecipientRow>();
    const pending = (recs.results ?? [])
      .filter((r) => (r.status === "queued" || r.status === "scheduled") &&
        (r.next_attempt_at === null || r.next_attempt_at <= now))
      .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    for (const cand of pending) {
      if (out.enqueued >= batch) break;
      const stamp = makeId("claim");
      const row = await claimRecipient(db, cand.id, cand.status, stamp);
      if (!row) { out.skipped += 1; continue; }
      await send({ recipientId: row.id, campaignId, claim: stamp });
      out.enqueued += 1;
    }
  }
  return out;
}

/** Count open recipients; complete the campaign when none remain. */
async function maybeComplete(db: Db, campaignId: string, now: string): Promise<void> {
  const rest = await db.prepare("SELECT * FROM campaign_recipient WHERE campaign_id = ?").bind(campaignId).all<RecipientRow>();
  const rows = rest.results ?? [];
  if (rows.some((r) => r.status === "queued" || r.status === "scheduled" || r.status === "sending")) return;
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
  await db.prepare("UPDATE campaign SET status = ?, stats_json = ?, updated_at = ? WHERE id = ?")
    .bind("complete", JSON.stringify(counts), now, campaignId).run();
}

interface SenderConn {
  id: string; provider: ProviderId; sender_email: string; sender_name: string | null;
  status: string; secret_blob: string | null;
}

/** Everything resolved before the transport call (shared by single + batch sends). */
export interface PreparedSend {
  row: RecipientRow;
  conn: SenderConn;
  attempts: number;
  now: string;
  provider: DeliveryProvider;
  creds: ConnCreds;
  req: SendRequest;
}

type Prepared = { kind: "send"; ctx: PreparedSend } | { kind: "done"; outcome: ConsumeOutcome };

async function finishSend(
  db: Db, row: RecipientRow, attempts: number, now: string,
  status: string, providerId: string | null, err: string | null, next: string | null,
): Promise<void> {
  await db.prepare(
    "UPDATE campaign_recipient SET status = ?, attempts = ?, provider_message_id = COALESCE(?, provider_message_id), last_error = ?, next_attempt_at = ?, sent_at = ?, updated_at = ? WHERE id = ?",
  ).bind(status, attempts, providerId, err, next, status === "sent" || status === "accepted" ? now : null, now, row.id).run();
}

/**
 * Prepare one job: verify the claim stamp, re-check eligibility, resolve the
 * sender + provider request. Decided branches (stale/suppressed/invalid/
 * unconnected) record their outcome here and return done.
 */
async function prepareSend(db: Db, deps: ConsumerDeps, job: DeliveryJob, nowOverride?: string): Promise<Prepared> {
  const now = nowOverride ?? nowIso();
  const row = await db.prepare("SELECT * FROM campaign_recipient WHERE id = ?").bind(job.recipientId).first<RecipientRow>();
  if (!row || row.status !== "sending" || row.updated_at !== job.claim) return { kind: "done", outcome: "stale" };
  const attempts = row.attempts + 1;
  const norm = row.email.trim().toLowerCase();
  const blocked = await db.prepare("SELECT email FROM suppression WHERE email = ?").bind(norm).first<{ email: string }>();
  if (blocked) {
    await finishSend(db, row, attempts, now, "suppressed", null, "suppressed at send time", null);
    await logAttempt(db, row.id, attempts, "suppressed", null, "policy", "suppressed at send time");
    await maybeComplete(db, row.campaign_id, now);
    return { kind: "done", outcome: "skipped" };
  }
  if (!isValidEmail(row.email)) {
    await finishSend(db, row, attempts, now, "failed", null, "invalid recipient email", null);
    await logAttempt(db, row.id, attempts, "failed", null, "validation", "invalid recipient email");
    await maybeComplete(db, row.campaign_id, now);
    return { kind: "done", outcome: "failed" };
  }
  const campaign = await db.prepare("SELECT * FROM campaign WHERE id = ?").bind(row.campaign_id)
    .first<{ connection_id: string | null; status: string }>();
  const conn = campaign?.connection_id
    ? await db.prepare("SELECT * FROM sender_connection WHERE id = ?").bind(campaign.connection_id).first<SenderConn>()
    : null;
  if (!conn || conn.status !== "connected" || !conn.secret_blob) {
    await finishSend(db, row, attempts, now, "failed", null, "sender not connected", null);
    await logAttempt(db, row.id, attempts, "failed", null, "auth", "sender not connected");
    await maybeComplete(db, row.campaign_id, now);
    return { kind: "done", outcome: "failed" };
  }
  const provider = deps.providers?.[conn.provider] ?? providerFor(conn.provider);
  const secret = await openSecret(JSON.parse(conn.secret_blob as string), deps.credKeyB64);
  const token = deps.unsubBaseUrl ? await signUnsub(deps.credKeyB64, row.id) : null;
  const unsubUrl = token ? deps.unsubBaseUrl + encodeURIComponent(token) : undefined;
  const text = unsubUrl ? `${row.body_snapshot}\n\nUnsubscribe: ${unsubUrl}` : row.body_snapshot;
  return {
    kind: "send",
    ctx: {
      row, conn, attempts, now, provider,
      creds: { secret, senderEmail: conn.sender_email, ...(conn.sender_name ? { senderName: conn.sender_name } : {}) },
      req: {
        fromEmail: conn.sender_email, ...(conn.sender_name ? { fromName: conn.sender_name } : {}),
        to: row.email, subject: row.subject_snapshot, text,
        ...(unsubUrl ? { unsubUrl } : {}), idempotencyKey: row.idempotency_key,
      },
    },
  };
}

/** Record one transport outcome (shared by single sends and grouped batches). */
async function applySendResult(db: Db, p: PreparedSend, res: SendResult): Promise<ConsumeOutcome> {
  const { row, conn, attempts, now } = p;
  const norm = row.email.trim().toLowerCase();
  if (res.ok) {
    const st = res.status === "sent" ? "sent" : "accepted";
    await finishSend(db, row, attempts, now, st, res.providerMessageId ?? null, null, null);
    await logAttempt(db, row.id, attempts, st, res.providerMessageId ?? null, null, null);
    await logSendContact(db, row.id, row.prospect_id, row.campaign_id, now);
    await maybeComplete(db, row.campaign_id, now);
    return "sent";
  }
  await logAttempt(db, row.id, attempts, "failed", res.providerMessageId ?? null, res.errorCategory ?? null, res.errorDetail ?? null);
  if (res.errorCategory === "auth") {
    await finishSend(db, row, attempts, now, "queued", null, res.errorDetail ?? "provider auth failed", null);
    await db.prepare("UPDATE campaign SET status = ?, stats_json = ?, updated_at = ? WHERE id = ?")
      .bind("failed", JSON.stringify({ error: "provider auth failed" }), now, row.campaign_id).run();
    await db.prepare("UPDATE sender_connection SET status = ?, last_error = ?, updated_at = ? WHERE id = ?")
      .bind("error", res.errorDetail ?? "provider auth failed", now, conn.id).run();
    return "failed";
  }
  if (res.retryable && attempts < MAX_ATTEMPTS) {
    await finishSend(db, row, attempts, now, "queued", null, res.errorDetail ?? "transient failure", backoffIso(Date.parse(now), attempts));
    return "requeued";
  }
  if (!res.retryable && /bounc|invalid recipient|unknown user|mailbox/i.test(res.errorDetail ?? "")) {
    await suppress(db, norm, "bounced");
  }
  await finishSend(db, row, attempts, now, "failed", null, res.errorDetail ?? "send failed", null);
  await maybeComplete(db, row.campaign_id, now);
  return "failed";
}

/**
 * Consumer: one attempt for one claimed job. Verifies the claim stamp,
 * re-checks eligibility, sends, records the outcome. Returns the outcome;
 * throws only on unexpected errors (queue retries those, then DLQ).
 */
export async function consumeDeliveryJob(db: Db, deps: ConsumerDeps, job: DeliveryJob, nowOverride?: string): Promise<ConsumeOutcome> {
  const prep = await prepareSend(db, deps, job, nowOverride);
  if (prep.kind === "done") return prep.outcome;
  const res = await prep.ctx.provider.send(prep.ctx.creds, prep.ctx.req);
  return applySendResult(db, prep.ctx, res);
}

export interface QueueMessage {
  body: DeliveryJob;
  attempts: number;
  ack(): void;
  retry(opts?: { delaySeconds?: number }): void;
}

/**
 * Batch consumer: prepare every message, group same-connection sendables onto
 * the provider bulk path (one relay call per group), send the rest singly.
 * Every handled outcome ACKs; only unexpected throws propagate, letting the
 * queue retry then DLQ the message.
 */
export async function consumeDeliveryBatch(
  db: Db, deps: ConsumerDeps, messages: QueueMessage[], nowOverride?: string,
): Promise<void> {
  const groups = new Map<string, { ctx: PreparedSend; msg: QueueMessage }[]>();
  const singles: { ctx: PreparedSend; msg: QueueMessage }[] = [];
  for (const msg of messages) {
    const prep = await prepareSend(db, deps, msg.body, nowOverride);
    if (prep.kind === "done") { msg.ack(); continue; }
    if (prep.ctx.provider.sendMany) {
      const list = groups.get(prep.ctx.conn.id) ?? [];
      list.push({ ctx: prep.ctx, msg });
      groups.set(prep.ctx.conn.id, list);
    } else {
      singles.push({ ctx: prep.ctx, msg });
    }
  }
  for (const [, g] of groups) {
    const first = g[0];
    const sendMany = first?.ctx.provider.sendMany;
    if (!first || !sendMany) continue;
    const results = await sendMany(first.ctx.creds, g.map((x) => x.ctx.req));
    for (let i = 0; i < g.length; i++) {
      const item = g[i];
      if (!item) continue;
      const res = results[i] ?? {
        ok: false, status: "failed", retryable: true,
        errorCategory: "transient", errorDetail: "batch result missing",
      } satisfies SendResult;
      await applySendResult(db, item.ctx, res);
      item.msg.ack();
    }
  }
  for (const s of singles) {
    const res = await s.ctx.provider.send(s.ctx.creds, s.ctx.req);
    await applySendResult(db, s.ctx, res);
    s.msg.ack();
  }
}

/**
 * Keep-warm: if connected SMTP senders have open recipients, ping the relay
 * so the container is warm before the queue consumer sends. Returns whether
 * a ping was attempted and whether it answered. Never throws.
 */
export async function warmSmtpRelay(db: Db, ping: () => Promise<unknown>): Promise<"warmed" | "idle" | "failed"> {
  const conns = await db.prepare("SELECT * FROM sender_connection WHERE provider = ? AND status = ?")
    .bind("smtp", "connected").all<SenderConn>();
  for (const conn of conns.results ?? []) {
    const camps = await db.prepare("SELECT * FROM campaign WHERE connection_id = ?").bind(conn.id).all<{ id: string }>();
    for (const camp of (camps.results ?? [])) {
      const recs = await db.prepare("SELECT * FROM campaign_recipient WHERE campaign_id = ?").bind(camp.id).all<RecipientRow>();
      const open = (recs.results ?? []).some((r) => r.status === "queued" || r.status === "scheduled" || r.status === "sending");
      if (open) {
        try {
          await ping();
          return "warmed";
        } catch {
          return "failed";
        }
      }
    }
  }
  return "idle";
}
