/**
 * product/tests/auth-gate.test.ts — the sign-in gate itself, through the real
 * Worker fetch handler. Proves: gated API paths return 401 signin_required
 * without a session; /api/me is public and reflects the session row; a valid
 * cookie passes the gate. Direct-route suites set __PR_SKIP_SIGNIN__; this
 * file leaves it OFF for the gate assertions.
 */
import { afterEach, describe, expect, it } from "vitest";
import app from "../src/index";

const g = globalThis as { __PR_SKIP_SIGNIN__?: boolean };

interface Row { email: string; name: string | null; expires_at: number }

function fakeDb(rows: Row[]) {
  return {
    prepare(sql: string) {
      return {
        bind(..._args: unknown[]) {
          return {
            async first<T>(): Promise<T | null> {
              return (rows.length ? (rows[0] as unknown) : null) as T | null;
            },
            async run() { return { success: true }; },
            async all<T>(): Promise<{ results: T[] }> { return { results: [] as T[] }; },
          };
        },
      };
    },
  } as unknown as D1Database;
}

afterEach(() => { g.__PR_SKIP_SIGNIN__ = false; });

describe("sign-in gate", () => {
  it("returns 401 signin_required on a gated API path without a session", async () => {
    const res = await app.fetch(
      new Request("https://app.example.com/api/runs"),
      { DB: fakeDb([]) } as never,
      {} as never,
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("signin_required");
  });

  it("keeps /api/me public and reflects the signed-in user", async () => {
    const future = Date.now() + 60_000;
    const res = await app.fetch(
      new Request("https://app.example.com/api/me", { headers: { cookie: "pr_sess=tok" } }),
      { DB: fakeDb([{ email: "a@b.co", name: "A", expires_at: future }]) } as never,
      {} as never,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { email: string } | null };
    expect(body.user?.email).toBe("a@b.co");
  });

  it("keeps /api/unsubscribe public (message recipients have no session)", async () => {
    const res = await app.fetch(
      new Request("https://app.example.com/api/unsubscribe?token=whatever"),
      { DB: fakeDb([]) } as never,
      {} as never,
    );
    // The unsubscribe handler runs its own logic (invalid token → 400); the
    // point of this assertion is that the status is NOT 401.
    expect(res.status).not.toBe(401);
  });

  it("lets a request with a live session cookie through the gate", async () => {
    const future = Date.now() + 60_000;
    const res = await app.fetch(
      new Request("https://app.example.com/api/runs", { headers: { cookie: "pr_sess=tok" } }),
      { DB: fakeDb([{ email: "a@b.co", name: "A", expires_at: future }]) } as never,
      {} as never,
    );
    expect(res.status).not.toBe(401);
  });
});
