/**
 * product/tests/audit.test.ts — the audit trail (user requirement
 * 2026-10-31): every API request, model call, and auth event lands in
 * audit_log redacted and truncated. Covers: redaction (secrets never
 * stored), bounds, never-throw behavior, and an end-to-end row through the
 * real Worker fetch handler (401 gate path).
 */
import { describe, expect, it } from "vitest";
import app from "../src/index";
import { auditEvent, auditSummary, redact } from "../src/audit";

describe("redaction", () => {
  it("replaces secret-bearing values with [redacted]", () => {
    const out = redact({
      authorization: "Bearer sk-live-123",
      api_key: "sk-123",
      apiKey: "sk-456",
      token: "tok_abc",
      oauth_code: "4/0Abc",
      cookie: "pr_sess=xyz",
      password: "hunter2",
      client_secret: "GOCSPX-1",
      safe: "keep me",
    }) as Record<string, string>;
    expect(out.authorization).toBe("[redacted]");
    expect(out.api_key).toBe("[redacted]");
    expect(out.apiKey).toBe("[redacted]");
    expect(out.token).toBe("[redacted]");
    expect(out.oauth_code).toBe("[redacted]");
    expect(out.cookie).toBe("[redacted]");
    expect(out.password).toBe("[redacted]");
    expect(out.client_secret).toBe("[redacted]");
    expect(out.safe).toBe("keep me");
  });

  it("redacts nested objects and truncates long strings", () => {
    const out = redact({ body: { headers: { Authorization: "Bearer x" }, note: "y".repeat(3000) } }) as Record<string, unknown>;
    const body = out.body as Record<string, unknown>;
    expect((body.headers as Record<string, string>).Authorization).toBe("[redacted]");
    expect(String(body.note).endsWith("…[truncated]")).toBe(true);
    expect(String(body.note).length).toBeLessThan(2100);
  });

  it("bounds arrays and depth", () => {
    const out = redact({ items: Array.from({ length: 30 }, (_, i) => i) }) as Record<string, unknown[]>;
    expect(out.items).toHaveLength(21); // 20 items + overflow marker
    expect(String(out.items[20])).toContain("more");
    const deep = redact({ a: { b: { c: { d: { e: { f: { g: 1 } } } } } } }) as Record<string, unknown>;
    expect(deep.a).toBeTruthy();
  });

  it("redacts secrets inside stringified JSON bodies", () => {
    const out = redact({ body: '{"api_key":"sk-x","name":"Adaeze","token":"t1"}' }) as Record<string, unknown>;
    expect((out.body as Record<string, string>).api_key).toBe("[redacted]");
    expect((out.body as Record<string, string>).name).toBe("Adaeze");
    expect((out.body as Record<string, string>).token).toBe("[redacted]");
  });
});

describe("auditSummary", () => {
  it("serializes redacted JSON and caps size", () => {
    const s = auditSummary({ authorization: "Bearer x", hello: "world" });
    expect(s).toContain('"hello":"world"');
    expect(s).toContain("[redacted]");
    const big = auditSummary({ blob: "z".repeat(9000) });
    expect(big.length).toBeLessThanOrEqual(6000 + "…[truncated]".length);
  });

  it("returns empty string for unusable input, survives cyclic graphs", () => {
    expect(auditSummary(undefined)).toBe("");
    const cyc: Record<string, unknown> = {};
    cyc.self = cyc;
    expect(typeof auditSummary(cyc)).toBe("string"); // depth-capped, no hang
  });
});

describe("auditEvent", () => {
  it("inserts one row with redacted summary", async () => {
    const inserted: Array<{ sql: string; args: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            return {
              async run() {
                inserted.push({ sql, args });
                return { success: true };
              },
            };
          },
        };
      },
    };
    await auditEvent(db, {
      kind: "api_request", run_id: "run_1", subject: "POST /api/runs",
      summary: { status: 200, body: JSON.stringify({ api_key: "sk-x", name: "Adaeze" }) },
    });
    expect(inserted).toHaveLength(1);
    expect(inserted[0].sql).toContain("INSERT INTO audit_log");
    const summary = JSON.parse(String(inserted[0].args[4]) || "{}") as Record<string, unknown>;
    expect(summary.status).toBe(200);
    const body = summary.body as Record<string, string>;
    expect(body.api_key).toBe("[redacted]");
    expect(body.name).toBe("Adaeze");
  });

  it("never throws, even when the DB is broken", async () => {
    const bad = {
      prepare(): never {
        throw new Error("no such table");
      },
    };
    await expect(auditEvent(bad, { kind: "x" })).resolves.toBeUndefined();
  });
});

describe("end-to-end audit through the Worker fetch handler", () => {
  it("records the 401 gate row with query and status, no secrets", async () => {
    const inserted: Array<{ sql: string; args: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            return {
              async first<T>(): Promise<T | null> {
                return null as T | null;
              },
              async run() {
                inserted.push({ sql, args });
                return { success: true };
              },
            };
          },
        };
      },
    };
    const res = await app.fetch(
      new Request("https://app.example.com/api/runs?x=1"),
      { DB: db } as never,
      {} as never,
    );
    expect(res.status).toBe(401);
    const row = inserted.find((r) => r.sql.includes("INSERT INTO audit_log"));
    expect(row).toBeDefined();
    expect(String(row!.args[1])).toBe("api_request");
    expect(String(row!.args[3])).toBe("GET /api/runs");
    const summary = JSON.parse(String(row!.args[4]) || "{}") as Record<string, unknown>;
    expect(summary.status).toBe(401);
    expect((summary.query as Record<string, string>).x).toBe("1");
  });
});
