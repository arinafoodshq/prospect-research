/**
 * product/tests/runs-latest.test.ts — run recovery (user requirement
 * 2026-11-01): the operator can always find their most recent run and
 * continue it — after a reload, a dead network, or a closed tab. Covers the
 * /api/runs/latest route through the real Worker fetch handler: gated
 * (401 signed out), returns the newest run with its profile name, and
 * returns null when no run exists.
 */
import { describe, expect, it } from "vitest";
import app from "../src/index";

// Explicit and local: other suites set __PR_SKIP_SIGNIN__ at module scope;
// this file needs the gate ON (it tests the gated recovery route).
const g = globalThis as { __PR_SKIP_SIGNIN__?: boolean };
g.__PR_SKIP_SIGNIN__ = false;

interface Row {
  email?: string; name?: string | null; expires_at?: number;
  id?: string; profile_id?: string; status?: string; stop_reason?: string | null;
  plan?: string | null; commercial_brief?: string | null; budgets?: string | null;
  consumed?: string | null; started_at?: string; finished_at?: string | null; created_at?: string;
  profile_name?: string | null;
}

function fakeDb(runRow: Row | null) {
  return {
    prepare(sql: string) {
      return {
        bind(..._args: unknown[]) {
          return {
            async first<T>(): Promise<T | null> {
              // The gate's session lookup always finds a live session in this
              // fake (it represents a signed-in operator); run queries get
              // exactly what was stored (null when the operator has none).
              if (sql.includes("user_session")) {
                return { email: "sam@example.com", name: "Sam", expires_at: Date.now() + 60_000 } as T;
              }
              return (runRow ?? null) as T;
            },
            async run() { return { success: true }; },
            async all<T>(): Promise<{ results: T[] }> {
              return { results: (runRow ? [runRow] : []) as T[] };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

const RUN_ROW: Row = {
  email: "sam@example.com", name: "Sam", expires_at: Date.now() + 60_000,
  id: "run_latest", profile_id: "bp_1", status: "awaiting_approval", stop_reason: null,
  plan: '{"queries":["q1"]}', commercial_brief: null, budgets: '{"searches":30,"fetches":40}',
  consumed: '{"searches":10,"fetches":5}', started_at: "2026-11-01T09:00:00.000Z",
  finished_at: null, created_at: "2026-11-01T09:00:00.000Z",
  profile_name: "Adaeze Catering",
};

describe("GET /api/runs/latest (run recovery)", () => {
  it("is gated: 401 without a session", async () => {
    const res = await app.fetch(
      new Request("https://app.example.com/api/runs/latest"),
      { DB: fakeDb(null) } as never,
      {} as never,
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("signin_required");
  });

  it("returns the newest run with its profile name for a signed-in operator", async () => {
    const res = await app.fetch(
      new Request("https://app.example.com/api/runs/latest", { headers: { cookie: "pr_sess=tok" } }),
      { DB: fakeDb(RUN_ROW) } as never,
      {} as never,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { run: { id: string; status: string; profile_name: string; consumed: Record<string, number> } | null };
    expect(body.run).not.toBeNull();
    expect(body.run!.id).toBe("run_latest");
    expect(body.run!.status).toBe("awaiting_approval");
    expect(body.run!.profile_name).toBe("Adaeze Catering");
    expect(body.run!.consumed.searches).toBe(10);
  });

  it("returns run: null when the operator has no runs yet", async () => {
    const res = await app.fetch(
      new Request("https://app.example.com/api/runs/latest", { headers: { cookie: "pr_sess=tok" } }),
      { DB: fakeDb(null) } as never,
      {} as never,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { run: unknown };
    expect(body.run).toBeNull();
  });
});
