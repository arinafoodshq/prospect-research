/**
 * product/tests/delivery.test.ts — delivery slice: crypto, providers, assist
 * links, campaign processor, routes, cron wiring. No network except stubbed
 * fetch; D1 is an in-memory mock (SELECT col=? filters, INSERT, UPDATE,
 * DELETE).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../src/db";
import { openSecret, sealSecret, signUnsub, verifyUnsub } from "../src/delivery/crypto";
import {
  buildMailto, buildWaMe, isValidEmail, providerFor, resetMockOutbox, mockOutbox,
} from "../src/delivery/providers";

type Row = Record<string, any>;
const TEST_KEY = btoa("0123456789abcdef0123456789abcdef");

function makeMockDb() {
  const tables: Record<string, Row[]> = {
    business_profile: [], research_run: [], evidence: [], prospect: [],
    assessment: [], contact_route: [], outreach_draft: [], activity: [],
    sender_connection: [], campaign: [], campaign_recipient: [],
    delivery_attempt: [], suppression: [], contact_event: [],
  };
  const tableOf = (sql: string): string => {
    const m = /from\s+(\w+)|into\s+(\w+)|update\s+(\w+)/i.exec(sql);
    if (!m) throw new Error(`mock: no table in ${sql}`);
    return (m[1] ?? m[2] ?? m[3]) as string;
  };
  function select(sql: string, params: any[]): Row[] {
    const rows = tables[tableOf(sql)] ?? [];
    const where = sql.split(/where/i).slice(1).join(" where ");
    const cols = [...where.matchAll(/(\w+)\s*=\s*\?/g)].map((m) => m[1]);
    if (cols.length === 0) return rows.map((r) => ({ ...r }));
    return rows.filter((r) => cols.every((c, i) => r[c] === params[i])).map((r) => ({ ...r }));
  }
  function mutate(sql: string, params: any[]): void {
    const del = /delete\s+from\s+(\w+)\s+where\s+(.+)/is.exec(sql);
    if (del) {
      const [, table, wherePart] = del;
      const cols = [...wherePart.matchAll(/(\w+)\s*=\s*\?/g)].map((m) => m[1]);
      tables[table] = (tables[table] ?? []).filter((r) => !cols.every((c, i) => r[c] === params[i]));
      return;
    }
    const insert = /insert\s+into\s+(\w+)\s*\(([^)]+)\)/i.exec(sql);
    if (insert) {
      const [, table, colList] = insert;
      const cols = colList.split(",").map((c) => c.trim());
      const valuesPart = /values\s*\(([^)]+)\)/i.exec(sql)?.[1] ?? "";
      const tokens = valuesPart.match(/'(?:[^']|'')*'|[^,]+/g) ?? [];
      let p = 0;
      const row: Row = {};
      cols.forEach((c, i) => {
        const tok = (tokens[i] ?? "?").trim();
        if (tok === "?") row[c] = params[p++];
        else if (/^null$/i.test(tok)) row[c] = null;
        else if (tok.startsWith("'") && tok.endsWith("'")) row[c] = tok.slice(1, -1).replace(/''/g, "'");
        else if (tok !== "" && !Number.isNaN(Number(tok))) row[c] = Number(tok);
        else row[c] = params[p++];
      });
      tables[table].push(row);
      return;
    }
    const update = /update\s+(\w+)\s+set\s+(.+?)\s+where\s+(.+)/is.exec(sql);
    if (update) {
      const [, table, setPart, wherePart] = update;
      const assigns: { col: string; coalesce: boolean }[] = [];
      const re = /(\w+)\s*=\s*(COALESCE\(\?,\s*\1\)|\?)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(setPart)) !== null) assigns.push({ col: m[1], coalesce: m[2].startsWith("COALESCE") });
      const whereCols = [...wherePart.matchAll(/(\w+)\s*=\s*\?/g)].map((mm) => mm[1]);
      const whereVals = params.slice(assigns.length);
      const literals: Array<{ col: string; val: number }> = [];
      const litRe = /(\w+)\s*=\s*(-?\d+(?:\.\d+)?)/g;
      let lit: RegExpExecArray | null;
      while ((lit = litRe.exec(setPart)) !== null) literals.push({ col: lit[1], val: Number(lit[2]) });
      for (const r of tables[table] ?? []) {
        if (!whereCols.every((c, i) => r[c] === whereVals[i])) continue;
        assigns.forEach((a, i) => {
          const v = params[i];
          if (a.coalesce) { if (v !== null && v !== undefined) r[a.col] = v; return; }
          r[a.col] = v;
        });
        for (const l of literals) r[l.col] = l.val;
      }
      return;
    }
    throw new Error(`mock: unsupported write ${sql}`);
  }
  const db = {
    prepare(sql: string) {
      const stmt = {
        bind(...params: any[]) {
          return {
            first: async (): Promise<Row | null> => select(sql, params)[0] ?? null,
            all: async <T>(): Promise<{ results: T[] }> => ({ results: select(sql, params) as T[] }),
            run: async (): Promise<{ success: boolean }> => { mutate(sql, params); return { success: true }; },
          };
        },
        first: async (): Promise<Row | null> => select(sql, [])[0] ?? null,
        all: async <T>(): Promise<{ results: T[] }> => ({ results: select(sql, []) as T[] }),
        run: async (): Promise<{ success: boolean }> => { mutate(sql, []); return { success: true }; },
      };
      return stmt;
    },
  };
  return { db: db as unknown as Db, tables };
}

afterEach(() => { vi.unstubAllGlobals(); resetMockOutbox(); });

// --- crypto --------------------------------------------------------------------

describe("delivery crypto", () => {
  it("seals and opens secrets; wrong key and tampering fail", async () => {
    const blob = await sealSecret(JSON.stringify({ api_key: "sk-live" }), TEST_KEY);
    expect(await openSecret(blob, TEST_KEY)).toBe(JSON.stringify({ api_key: "sk-live" }));
    const other = btoa("fedcba9876543210fedcba9876543210");
    await expect(openSecret(blob, other)).rejects.toThrow();
    await expect(openSecret({ ...blob, cipher_b64: blob.cipher_b64.slice(0, -2) + "AA" }, TEST_KEY)).rejects.toThrow();
  });

  it("signs and verifies unsubscribe tokens; tampering fails", async () => {
    const tok = await signUnsub(TEST_KEY, "rcpt_1");
    expect(await verifyUnsub(TEST_KEY, tok)).toBe("rcpt_1");
    expect(await verifyUnsub(TEST_KEY, tok + "x")).toBeNull();
    expect(await verifyUnsub(TEST_KEY, "garbage")).toBeNull();
  });
});

// --- assisted delivery ------------------------------------------------------------

describe("assist links", () => {
  it("builds correctly-encoded mailto links; rejects bad emails", () => {
    expect(isValidEmail("ada@example.ng")).toBe(true);
    expect(isValidEmail("not-an-email")).toBe(false);
    const url = buildMailto("ada@example.ng", "Hello Ada", "Line one\nLine two \u{1F600}");
    expect(url.startsWith("mailto:ada%40example.ng?subject=Hello%20Ada&body=")).toBe(true);
    expect(url).toContain(encodeURIComponent("Line one\nLine two \u{1F600}"));
    expect(() => buildMailto("bad", "s", "b")).toThrow();
  });

  it("builds wa.me links from messy phone input; rejects bad input", () => {
    expect(buildWaMe("+234 (801) 234-5678", "Hi Ada")).toBe("https://wa.me/2348012345678?text=Hi%20Ada");
    expect(() => buildWaMe("123", "Hi")).toThrow();
    expect(() => buildWaMe("2348012345678", "")).toThrow();
    expect(() => buildWaMe("2348012345678", "x".repeat(1501))).toThrow();
  });
});

// --- providers --------------------------------------------------------------------

type FetchRoute = { match: (u: string) => boolean; status: number; body: unknown };
function stubFetch(routes: FetchRoute[] | "throw") {
  vi.stubGlobal("fetch", async (url: unknown) => {
    if (routes === "throw") throw new Error("network down");
    const hit = routes.find((r) => r.match(String(url)));
    if (!hit) throw new Error("unstubbed fetch " + String(url));
    return new Response(JSON.stringify(hit.body), { status: hit.status });
  });
}

describe("providers", () => {
  it("mock provider verifies and sends; bad secret fails auth", async () => {
    const mock = providerFor("mock");
    expect((await mock.verify({ secret: "{}", senderEmail: "a@b.co" })).ok).toBe(true);
    expect((await mock.verify({ secret: "bad", senderEmail: "a@b.co" })).ok).toBe(false);
    const res = await mock.send({ secret: "{}", senderEmail: "a@b.co" }, {
      fromEmail: "a@b.co", to: "c@d.co", subject: "s", text: "b", idempotencyKey: "k1",
    });
    expect(res.ok).toBe(true);
    expect(res.status).toBe("accepted");
    expect(mockOutbox).toHaveLength(1);
  });

  it("resend maps success, auth, rate-limit, and network failures", async () => {
    const resend = providerFor("resend");
    const creds = { secret: JSON.stringify({ api_key: "re_test" }), senderEmail: "me@co.ng" };
    const req = { fromEmail: "me@co.ng", to: "you@co.ng", subject: "s", text: "b", idempotencyKey: "k1" };
    stubFetch([{ match: (u) => u.includes("/emails"), status: 200, body: { id: "re_1" } }]);
    const ok = await resend.send(creds, req);
    expect(ok.ok && ok.providerMessageId).toBe("re_1");
    stubFetch([{ match: () => true, status: 401, body: { message: "bad key" } }]);
    const auth = await resend.send(creds, req);
    expect(auth.retryable).toBe(false);
    expect(auth.errorCategory).toBe("auth");
    stubFetch([{ match: () => true, status: 429, body: {} }]);
    expect((await resend.send(creds, req)).errorCategory).toBe("rate_limit");
    stubFetch("throw");
    const down = await resend.send(creds, req);
    expect(down.retryable).toBe(true);
    expect(down.errorCategory).toBe("transient");
  });

  it("gmail refreshes OAuth tokens and sends; bad secrets fail closed", async () => {
    const gmail = providerFor("gmail");
    expect((await gmail.verify({ secret: "not-json", senderEmail: "a@b.co" })).ok).toBe(false);
    const creds = {
      secret: JSON.stringify({ refresh_token: "rt", client_id: "cid", client_secret: "cs" }),
      senderEmail: "a@b.co",
    };
    stubFetch([{ match: (u) => u.includes("oauth2.googleapis.com"), status: 200, body: { access_token: "at" } }]);
    expect((await gmail.verify(creds)).ok).toBe(true);
    stubFetch([
      { match: (u) => u.includes("oauth2.googleapis.com"), status: 200, body: { access_token: "at" } },
      { match: (u) => u.includes("/messages/send"), status: 200, body: { id: "gm_1" } },
    ]);
    const sent = await gmail.send(creds, { fromEmail: "a@b.co", to: "c@d.co", subject: "s", text: "b", idempotencyKey: "k1" });
    expect(sent.ok && sent.status).toBe("sent");
    stubFetch([{ match: (u) => u.includes("oauth2.googleapis.com"), status: 400, body: {} }]);
    const bad = await gmail.send(creds, { fromEmail: "a@b.co", to: "c@d.co", subject: "s", text: "b", idempotencyKey: "k1" });
    expect(bad.errorCategory).toBe("auth");
  });

  it("graph/smtp throw honest not-implemented", () => {
    expect(() => providerFor("graph")).toThrow("not implemented");
    expect(() => providerFor("smtp")).toThrow("not implemented");
  });
});

// --- pipeline (producer + consumer) -----------------------------------------------------

describe("delivery pipeline", () => {
  async function seed(secret = "{}") {
    const mod = await import("../src/delivery/processor");
    const { db, tables } = makeMockDb();
    const now = new Date().toISOString();
    const blob = await sealSecret(secret, TEST_KEY);
    tables["sender_connection"].push({
      id: "conn_1", provider: "mock", label: "Mock", sender_email: "me@co.ng", sender_name: null,
      status: "connected", secret_blob: JSON.stringify(blob), metadata_json: "{}",
      last_verified_at: now, last_error: null, created_at: now, updated_at: now,
    });
    tables["campaign"].push({
      id: "cmp_1", run_id: null, name: "Test", connection_id: "conn_1", status: "scheduled",
      scheduled_at_utc: new Date(Date.now() - 60000).toISOString(), timezone: "UTC",
      approved_at: now, stats_json: "{}", created_at: now, updated_at: now,
    });
    const rcpt = (id: string, email: string, status = "queued") => tables["campaign_recipient"].push({
      id, campaign_id: "cmp_1", prospect_id: null, email, subject_snapshot: "Hi",
      body_snapshot: "Body", status, attempts: 0, provider_message_id: null,
      idempotency_key: "idem_" + id, last_error: null, next_attempt_at: null,
      sent_at: null, created_at: now, updated_at: now,
    });
    const jobs: Array<{ recipientId: string; campaignId: string; claim: string }> = [];
    const deps = { credKeyB64: TEST_KEY, unsubBaseUrl: "https://t.local/api/unsubscribe?token=" };
    const produce = (nowAt?: string) => mod.enqueueDueJobs(db, async (job) => { jobs.push(job); }, nowAt);
    const consume = (nowAt?: string) => mod.consumeDeliveryBatch(db, deps,
      jobs.splice(0).map((body) => ({ body, attempts: 1, ack: () => {}, retry: () => {} })), nowAt);
    return { db, tables, rcpt, jobs, produce, consume };
  }

  it("producer claims and enqueues; consumer sends and completes", async () => {
    const { tables, rcpt, produce, consume } = await seed();
    rcpt("rcpt_1", "a@x.co");
    rcpt("rcpt_2", "b@x.co");
    expect(await produce()).toEqual({ enqueued: 2, skipped: 0 });
    expect(tables["campaign_recipient"].every((r) => r.status === "sending")).toBe(true);
    await consume();
    expect(mockOutbox).toHaveLength(2);
    expect(mockOutbox[0].req.unsubUrl).toContain("https://t.local/api/unsubscribe?token=");
    expect(mockOutbox[0].req.text).toContain("Unsubscribe:");
    expect(tables["campaign"][0].status).toBe("complete");
    expect(tables["delivery_attempt"]).toHaveLength(2);
    expect(tables["campaign_recipient"].every((r) => r.status === "accepted" && r.sent_at)).toBe(true);
  });

  it("consumer skips suppressed/invalid recipients and stale claims", async () => {
    const { tables, rcpt, jobs, produce, consume } = await seed();
    tables["suppression"].push({ email: "s@x.co", reason: "manual", source: "test", created_at: new Date().toISOString() });
    rcpt("rcpt_1", "s@x.co");
    rcpt("rcpt_2", "not-an-email");
    rcpt("rcpt_3", "ok@x.co");
    await produce();
    jobs.push({ recipientId: "nope", campaignId: "cmp_1", claim: "bogus" });
    await consume();
    expect(tables["campaign_recipient"].find((r) => r.id === "rcpt_1").status).toBe("suppressed");
    expect(tables["campaign_recipient"].find((r) => r.id === "rcpt_2").status).toBe("failed");
    expect(tables["campaign_recipient"].find((r) => r.id === "rcpt_3").status).toBe("accepted");
    expect(mockOutbox).toHaveLength(1);
  });

  it("transient failures requeue with backoff; stale rows recovered", async () => {
    const { tables, rcpt, produce, consume } = await seed("flaky");
    rcpt("rcpt_1", "a@x.co");
    await produce();
    await consume();
    const row = tables["campaign_recipient"].find((r) => r.id === "rcpt_1");
    expect(row.status).toBe("queued");
    expect(row.attempts).toBe(1);
    expect(row.next_attempt_at).toBeTruthy();
    expect(tables["campaign"][0].status).toBe("sending");
    tables["sender_connection"][0].secret_blob = JSON.stringify(await sealSecret("{}", TEST_KEY));
    const later = new Date(Date.now() + 10 * 60000).toISOString();
    await produce(later);
    await consume(later);
    expect(tables["campaign_recipient"].find((r) => r.id === "rcpt_1").status).toBe("accepted");
    const old = new Date(Date.now() - 30 * 60000).toISOString();
    tables["campaign_recipient"].push({
      id: "rcpt_old", campaign_id: "cmp_1", prospect_id: null, email: "old@x.co",
      subject_snapshot: "Hi", body_snapshot: "B", status: "sending", attempts: 1,
      provider_message_id: null, idempotency_key: "idem_old", last_error: null,
      next_attempt_at: null, sent_at: null, created_at: old, updated_at: old,
    });
    tables["campaign_recipient"].push({
      id: "rcpt_max", campaign_id: "cmp_1", prospect_id: null, email: "max@x.co",
      subject_snapshot: "Hi", body_snapshot: "B", status: "sending", attempts: 3,
      provider_message_id: null, idempotency_key: "idem_max", last_error: null,
      next_attempt_at: null, sent_at: null, created_at: old, updated_at: old,
    });
    tables["campaign"][0].status = "sending";
    await produce(later);
    await consume(later);
    expect(tables["campaign_recipient"].find((r) => r.id === "rcpt_old").status).toBe("accepted");
    expect(tables["campaign_recipient"].find((r) => r.id === "rcpt_max").status).toBe("failed");
  });

  it("overlapping producers never double-enqueue; each job sends once", async () => {
    const { tables, rcpt, jobs, produce, consume } = await seed();
    rcpt("rcpt_1", "a@x.co");
    rcpt("rcpt_2", "b@x.co");
    const [a, b] = await Promise.all([produce(), produce()]);
    expect(a.enqueued + b.enqueued).toBe(2);
    expect(jobs).toHaveLength(2);
    await consume();
    expect(mockOutbox).toHaveLength(2);
    for (const r of tables["campaign_recipient"]) {
      const accepted = tables["delivery_attempt"].filter((t) => t.recipient_id === r.id && t.status === "accepted");
      expect(accepted).toHaveLength(1);
    }
  });

  it("auth failure stops the campaign without burning the list", async () => {
    const { tables, rcpt, produce, consume } = await seed("bad");
    rcpt("rcpt_1", "a@x.co");
    await produce();
    await consume();
    expect(mockOutbox).toHaveLength(0);
    expect(tables["campaign"][0].status).toBe("failed");
    expect(tables["sender_connection"][0].status).toBe("error");
    expect(tables["campaign_recipient"][0].status).toBe("queued");
  });

  it("producer fails campaigns with no connected sender", async () => {
    const { tables, rcpt, jobs, produce } = await seed();
    tables["sender_connection"][0].status = "pending";
    rcpt("rcpt_1", "a@x.co");
    expect(await produce()).toEqual({ enqueued: 0, skipped: 0 });
    expect(tables["campaign"][0].status).toBe("failed");
    expect(jobs).toHaveLength(0);
  });
});

// --- routes -----------------------------------------------------------------------

describe("delivery routes", () => {
  const req = (url: string, method = "GET", body?: unknown) =>
    new Request(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  async function setup(extra: Record<string, unknown> = {}) {
    const R = await import("../src/delivery/routes");
    const { db, tables } = makeMockDb();
    return { R, db, tables, env: { DB: db, CRED_KEY: TEST_KEY, ...extra } };
  }
  async function mockConn(R: any, env: any, secret: unknown = {}) {
    const res = await R.postConnection(req("https://t.local/api/connections", "POST", {
      provider: "mock", label: "Mock", sender_email: "me@co.ng", secret,
    }), env);
    const conn = await res.json();
    await R.postVerifyConnection(req(`https://t.local/api/connections/${conn.id}/verify`, "POST"), env, { id: conn.id });
    return conn.id as string;
  }

  it("creates connections with sealed secrets, never returned", async () => {
    const { R, tables, env } = await setup();
    const res = await R.postConnection(req("https://t.local/api/connections", "POST", {
      provider: "resend", label: "R", sender_email: "me@co.ng", secret: { api_key: "re_secret" },
    }), env);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.secret_blob).toBeUndefined();
    expect(JSON.stringify(tables["sender_connection"][0])).not.toContain("re_secret");
    expect(await openSecret(JSON.parse(tables["sender_connection"][0].secret_blob), TEST_KEY)).toContain("re_secret");
    const list = await (await R.getConnections(req("https://t.local/api/connections"), env)).json();
    expect(JSON.stringify(list)).not.toContain("re_secret");
  });

  it("501s credential flows without CRED_KEY", async () => {
    const { R, db } = await setup();
    const noKey = { DB: db };
    expect((await R.postConnection(req("https://t.local/x", "POST", {}), noKey)).status).toBe(501);
    expect((await R.getUnsubscribe(req("https://t.local/api/unsubscribe?token=x"), noKey)).status).toBe(501);
  });

  it("validates campaign recipients", async () => {
    const { R, env } = await setup();
    const bad = await R.postCampaign(req("https://t.local/api/campaigns", "POST", {
      name: "c", recipients: [{ email: "nope", subject: "s", body: "b" }],
    }), env);
    expect(bad.status).toBe(400);
    const dup = await R.postCampaign(req("https://t.local/api/campaigns", "POST", {
      name: "c", recipients: [
        { email: "a@x.co", subject: "s", body: "b" },
        { email: "a@x.co", subject: "s", body: "b" },
      ],
    }), env);
    expect((await dup.json()).error).toBe("duplicate_recipient");
    const many = await R.postCampaign(req("https://t.local/api/campaigns", "POST", {
      name: "c", recipients: Array.from({ length: 501 }, (_, i) => ({ email: `u${i}@x.co`, subject: "s", body: "b" })),
    }), env);
    expect(many.status).toBe(400);
  });

  it("approve requires a connected sender and locks the campaign", async () => {
    const { R, env } = await setup();
    const created = await R.postConnection(req("https://t.local/api/connections", "POST", {
      provider: "mock", label: "M", sender_email: "me@co.ng", secret: {},
    }), env);
    const connId = (await created.json()).id as string;
    const cmp = await (await R.postCampaign(req("https://t.local/api/campaigns", "POST", {
      name: "c", connection_id: connId, recipients: [{ email: "a@x.co", subject: "s", body: "b" }],
    }), env)).json();
    const early = await R.postApproveCampaign(
      req(`https://t.local/api/campaigns/${cmp.id}/approve`, "POST", { scheduled_at_utc: new Date().toISOString() }), env, { id: cmp.id });
    expect(early.status).toBe(400);
    await R.postVerifyConnection(req(`https://t.local/api/connections/${connId}/verify`, "POST"), env, { id: connId });
    const ok = await R.postApproveCampaign(
      req(`https://t.local/api/campaigns/${cmp.id}/approve`, "POST", { scheduled_at_utc: new Date().toISOString() }), env, { id: cmp.id });
    expect(ok.status).toBe(200);
    expect((await ok.json()).status).toBe("scheduled");
    const locked = await R.patchCampaign(req(`https://t.local/api/campaigns/${cmp.id}`, "PATCH", { name: "x" }), env, { id: cmp.id });
    expect(locked.status).toBe(409);
  });

  it("runs the full mock journey: approve, enqueue, consume, cancel", async () => {
    const { R, db, env } = await setup();
    const connId = await mockConn(R, env);
    const jobs: Array<{ recipientId: string; campaignId: string; claim: string }> = [];
    const queued = { ...env, DELIVERY_QUEUE: { send: async (job: never) => { jobs.push(job); } } };
    const cmp = await (await R.postCampaign(req("https://t.local/api/campaigns", "POST", {
      name: "c", connection_id: connId,
      recipients: [
        { email: "a@x.co", subject: "s", body: "b" },
        { email: "b@x.co", subject: "s", body: "b" },
      ],
    }), env)).json();
    await R.postApproveCampaign(req(`https://t.local/api/campaigns/${cmp.id}/approve`, "POST", {
      scheduled_at_utc: new Date(Date.now() - 1000).toISOString(),
    }), env, { id: cmp.id });
    const done = await (await R.postProcessCampaign(req(`https://t.local/api/campaigns/${cmp.id}/process`, "POST"), queued, { id: cmp.id })).json();
    expect(done.summary).toEqual({ enqueued: 2, skipped: 0 });
    const { consumeDeliveryBatch } = await import("../src/delivery/processor");
    await consumeDeliveryBatch(db, { credKeyB64: TEST_KEY, unsubBaseUrl: "https://t.local/api/unsubscribe?token=" },
      jobs.splice(0).map((body) => ({ body, attempts: 1, ack: () => {}, retry: () => {} })));
    const finished = await (await R.getCampaignById(req(`https://t.local/api/campaigns/${cmp.id}`), env, { id: cmp.id })).json();
    expect(finished.status).toBe("complete");
    expect(finished.stats).toEqual({ accepted: 2 });
    const cmp2 = await (await R.postCampaign(req("https://t.local/api/campaigns", "POST", {
      name: "c2", connection_id: connId, recipients: [{ email: "c@x.co", subject: "s", body: "b" }],
    }), env)).json();
    await R.postApproveCampaign(req(`https://t.local/api/campaigns/${cmp2.id}/approve`, "POST", {
      scheduled_at_utc: new Date(Date.now() + 3600000).toISOString(),
    }), env, { id: cmp2.id });
    await R.postCancelCampaign(req(`https://t.local/api/campaigns/${cmp2.id}/cancel`, "POST"), env, { id: cmp2.id });
    const blocked = await R.postProcessCampaign(req(`https://t.local/api/campaigns/${cmp2.id}/process`, "POST"), env, { id: cmp2.id });
    expect(blocked.status).toBe(409);
    const detail = await (await R.getCampaignById(req(`https://t.local/api/campaigns/${cmp2.id}`), env, { id: cmp2.id })).json();
    expect(detail.recipients[0].status).toBe("cancelled");
  });

  it("unsubscribe suppresses and parks the recipient", async () => {
    const { R, db, tables, env } = await setup();
    const now = new Date().toISOString();
    tables["campaign_recipient"].push({
      id: "rcpt_1", campaign_id: "cmp_x", prospect_id: null, email: "quit@x.co",
      subject_snapshot: "s", body_snapshot: "b", status: "queued", attempts: 0,
      provider_message_id: null, idempotency_key: "k1", last_error: null,
      next_attempt_at: null, sent_at: null, created_at: now, updated_at: now,
    });
    const token = await signUnsub(TEST_KEY, "rcpt_1");
    const ok = await R.getUnsubscribe(req(`https://t.local/api/unsubscribe?token=${encodeURIComponent(token)}`), env);
    expect(ok.status).toBe(200);
    expect(tables["suppression"].find((s) => s.email === "quit@x.co")?.reason).toBe("unsubscribed");
    expect(tables["campaign_recipient"][0].status).toBe("suppressed");
    expect((await R.getUnsubscribe(req("https://t.local/api/unsubscribe?token=bogus"), env)).status).toBe(400);
    expect(db).toBeTruthy();
  });

  it("gmail auth-url needs a configured client id; builds a consent URL otherwise", async () => {
    const { R, env } = await setup();
    expect((await R.getGmailAuthUrl(req("https://t.local/api/connections/gmail/auth-url"), env)).status).toBe(501);
    const configured = await setup({ GOOGLE_CLIENT_ID: "cid.apps.googleusercontent.com" });
    const res = await configured.R.getGmailAuthUrl(
      req("https://t.local/api/connections/gmail/auth-url?label=Work&sender_email=me%40co.ng"), configured.env);
    expect(res.status).toBe(200);
    const { url } = await res.json();
    expect(url).toContain("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url).toContain(encodeURIComponent("https://www.googleapis.com/auth/gmail.send"));
    expect(url).toContain("access_type=offline");
  });

  it("suppression API blocks approval-time recipients", async () => {
    const { R, env } = await setup();
    const connId = await mockConn(R, env);
    expect((await R.postSuppression(req("https://t.local/api/suppressions", "POST", { email: "no@x.co" }), env)).status).toBe(201);
    const cmp = await (await R.postCampaign(req("https://t.local/api/campaigns", "POST", {
      name: "c", connection_id: connId,
      recipients: [
        { email: "no@x.co", subject: "s", body: "b" },
        { email: "yes@x.co", subject: "s", body: "b" },
      ],
    }), env)).json();
    const approved = await (await R.postApproveCampaign(req(`https://t.local/api/campaigns/${cmp.id}/approve`, "POST", {
      scheduled_at_utc: new Date().toISOString(),
    }), env, { id: cmp.id })).json();
    const byEmail = Object.fromEntries(approved.recipients.map((r: any) => [r.email, r.status]));
    expect(byEmail["no@x.co"]).toBe("suppressed");
    expect(byEmail["yes@x.co"]).toBe("queued");
  });
});

// --- cron wiring --------------------------------------------------------------------

describe("cron wiring", () => {
  it("scheduled() drains due campaigns", async () => {
    const app = (await import("../src/index")).default as any;
    const { db, tables } = makeMockDb();
    const now = new Date().toISOString();
    const blob = await sealSecret("{}", TEST_KEY);
    tables["sender_connection"].push({
      id: "conn_1", provider: "mock", label: "Mock", sender_email: "me@co.ng", sender_name: null,
      status: "connected", secret_blob: JSON.stringify(blob), metadata_json: "{}",
      last_verified_at: now, last_error: null, created_at: now, updated_at: now,
    });
    tables["campaign"].push({
      id: "cmp_1", run_id: null, name: "Cron", connection_id: "conn_1", status: "scheduled",
      scheduled_at_utc: new Date(Date.now() - 1000).toISOString(), timezone: "UTC",
      approved_at: now, stats_json: "{}", created_at: now, updated_at: now,
    });
    tables["campaign_recipient"].push({
      id: "rcpt_1", campaign_id: "cmp_1", prospect_id: null, email: "cron@x.co",
      subject_snapshot: "Hi", body_snapshot: "Body", status: "queued", attempts: 0,
      provider_message_id: null, idempotency_key: "idem_1", last_error: null,
      next_attempt_at: null, sent_at: null, created_at: now, updated_at: now,
    });
    const jobs: any[] = [];
    await app.scheduled({ cron: "*/5 * * * *" }, { DB: db, DELIVERY_QUEUE: { send: async (j: any) => { jobs.push(j); } } }, {});
    expect(jobs).toHaveLength(1);
    expect(tables["campaign_recipient"][0].status).toBe("sending");
    await app.queue(
      { messages: jobs.map((body) => ({ body, attempts: 1, ack: () => {}, retry: () => {} })) },
      { DB: db, CRED_KEY: TEST_KEY, PUBLIC_BASE_URL: "https://t.local" });
    expect(tables["campaign_recipient"][0].status).toBe("accepted");
    expect(tables["campaign"][0].status).toBe("complete");
  });
});

// --- contact tracking ---------------------------------------------------------------

describe("contact tracking", () => {
  const req = (url: string, method = "GET", body?: unknown) =>
    new Request(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  async function setup() {
    const R = await import("../src/delivery/routes");
    const { db, tables } = makeMockDb();
    tables["prospect"].push({ id: "pr_1", run_id: "run_1", name: "Venue One" });
    return { R, db, tables, env: { DB: db } };
  }

  it("logs a contact with channel + date and lists it back", async () => {
    const { R, tables, env } = await setup();
    const res = await R.postContact(req("https://t.local/api/prospects/pr_1/contacts", "POST", {
      channel: "whatsapp", note: "Sent intro", contacted_at: "2026-10-28T10:00:00.000Z",
    }), env, { id: "pr_1" });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.channel).toBe("whatsapp");
    expect(body.contacted_at).toBe("2026-10-28T10:00:00.000Z");
    expect(tables["activity"].find((a) => a.event === "contacted")?.note).toBe("outbound:whatsapp");
    const list = await (await R.getContacts(req("https://t.local/x"), env, { id: "pr_1" })).json();
    expect(list.contacts).toHaveLength(1);
  });

  it("rejects bad channel, bad date, unknown prospect", async () => {
    const { R, env } = await setup();
    expect((await R.postContact(req("https://t.local/x", "POST", { channel: "smoke-signal" }), env, { id: "pr_1" })).status).toBe(400);
    expect((await R.postContact(req("https://t.local/x", "POST", { channel: "email", contacted_at: "yesterday-ish" }), env, { id: "pr_1" })).status).toBe(400);
    expect((await R.postContact(req("https://t.local/x", "POST", { channel: "email" }), env, { id: "nope" })).status).toBe(404);
    expect((await R.getTimeline(req("https://t.local/x"), env, { id: "nope" })).status).toBe(404);
  });

  it("timeline merges contacts and activity newest-first", async () => {
    const { R, tables, env } = await setup();
    await R.postContact(req("https://t.local/x", "POST", { channel: "email", contacted_at: "2026-10-27T10:00:00.000Z" }), env, { id: "pr_1" });
    await R.postContact(req("https://t.local/x", "POST", { channel: "phone", contacted_at: "2026-10-28T10:00:00.000Z" }), env, { id: "pr_1" });
    const tl = await (await R.getTimeline(req("https://t.local/x"), env, { id: "pr_1" })).json();
    const contacts = tl.timeline.filter((t: any) => t.kind === "contact");
    expect(contacts.map((t: any) => t.channel)).toEqual(["phone", "email"]);
    expect(tl.timeline.length).toBeGreaterThan(2);
    expect(tables["activity"].filter((a) => a.event === "contacted")).toHaveLength(2);
  });

  it("campaign sends auto-log contact events for linked prospects", async () => {
    const { enqueueDueJobs, consumeDeliveryBatch } = await import("../src/delivery/processor");
    const { db, tables } = makeMockDb();
    const now = new Date().toISOString();
    const blob = await sealSecret("{}", TEST_KEY);
    tables["sender_connection"].push({ id: "conn_1", provider: "mock", label: "M", sender_email: "me@co.ng", sender_name: null, status: "connected", secret_blob: JSON.stringify(blob), metadata_json: "{}", last_verified_at: now, last_error: null, created_at: now, updated_at: now });
    tables["campaign"].push({ id: "cmp_1", run_id: null, name: "c", connection_id: "conn_1", status: "scheduled", scheduled_at_utc: new Date(Date.now() - 1000).toISOString(), timezone: "UTC", approved_at: now, stats_json: "{}", created_at: now, updated_at: now });
    tables["prospect"].push({ id: "pr_9", run_id: "run_1", name: "Acme" });
    tables["campaign_recipient"].push({ id: "rcpt_1", campaign_id: "cmp_1", prospect_id: "pr_9", email: "a@x.co", subject_snapshot: "s", body_snapshot: "b", status: "queued", attempts: 0, provider_message_id: null, idempotency_key: "k1", last_error: null, next_attempt_at: null, sent_at: null, created_at: now, updated_at: now });
    const jobs: any[] = [];
    await enqueueDueJobs(db, async (job) => { jobs.push(job); });
    await consumeDeliveryBatch(db, { credKeyB64: TEST_KEY, unsubBaseUrl: "" },
      jobs.map((body) => ({ body, attempts: 1, ack: () => {}, retry: () => {} })));
    expect(tables["contact_event"]).toHaveLength(1);
    expect(tables["contact_event"][0].channel).toBe("email");
    expect(tables["contact_event"][0].prospect_id).toBe("pr_9");
  });
});

