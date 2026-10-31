/**
 * tests/auth.test.ts — unit tests for the sign-in module (src/auth.ts).
 * Covers: id_token payload decode, Google auth URL construction, OAuth state
 * verification (signature + expiry + missing code), and session lookup from
 * the cookie (found / missing / expired rows). The full happy path (code
 * exchange) is integration territory — exercised live at deploy.
 */
import { describe, expect, it } from "vitest";
import {
  cookieSessionToken,
  decodeIdToken,
  getSession,
  googleCallback,
  startGoogleLogin,
  type SessionUser,
} from "../src/auth";

const CRED_KEY = btoa("0123456789abcdef0123456789abcdef");

interface Row {
  email: string;
  name: string | null;
  expires_at: number;
}

function fakeDb(rows: Record<string, Row>, deleted: string[] = []) {
  const db = {
    prepare(sql: string) {
      return {
        bind(..._args: unknown[]) {
          return {
            async first<T>(): Promise<T | null> {
              const vals = Object.values(rows);
              return (vals.length ? (vals[0] as unknown) : null) as T | null;
            },
            async run() {
              if (sql.startsWith("DELETE")) deleted.push(sql);
              return { success: true };
            },
          };
        },
      };
    },
  };
  return db as unknown as D1Database;
}

function base64urlJson(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("decodeIdToken", () => {
  it("decodes a base64url id_token payload", () => {
    const idToken = `${base64urlJson({ alg: "RS256", kid: "k" })}.${base64urlJson({
      email: "a@b.co", email_verified: true, name: "A B",
    })}.sig`;
    const claims = decodeIdToken(idToken);
    expect(claims).not.toBeNull();
    expect(claims!.email).toBe("a@b.co");
    expect(claims!.email_verified).toBe(true);
    expect(claims!.name).toBe("A B");
  });

  it("returns null for malformed tokens", () => {
    expect(decodeIdToken("not-a-jwt")).toBeNull();
    expect(decodeIdToken("a.b.c")).toBeNull();
  });
});

describe("startGoogleLogin", () => {
  const env = { DB: {} as D1Database, GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "secret", CRED_KEY };

  it("redirects to Google with the registered callback and signed state", async () => {
    const req = new Request("https://app.example.com/api/auth/start");
    const res = await startGoogleLogin(req, env);
    expect(res.status).toBe(302);
    const loc = res.headers.get("location") || "";
    expect(loc).toContain("accounts.google.com/o/oauth2/v2/auth");
    expect(loc).toContain("client_id=cid");
    expect(loc).toContain("redirect_uri=" + encodeURIComponent("https://app.example.com/api/auth/callback"));
    expect(loc).toContain("scope=openid+email");
    const state = new URL(loc).searchParams.get("state") || "";
    expect(state).toContain(".");
    const payload = state.slice(0, state.lastIndexOf("."));
    expect(JSON.parse(atob(payload))).toHaveProperty("ts");
  });

  it("returns 501 when credentials are missing", async () => {
    const res = await startGoogleLogin(new Request("https://app.example.com/api/auth/start"), { DB: {} as D1Database });
    expect(res.status).toBe(501);
  });
});

describe("googleCallback state verification", () => {
  const env = { DB: {} as D1Database, GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "secret", CRED_KEY };

  it("rejects a missing code", async () => {
    const res = await googleCallback(new Request("https://app.example.com/api/auth/callback?state=x.y"), env);
    expect(res.status).toBe(400);
  });

  it("rejects a state with a bad signature", async () => {
    const payload = btoa(JSON.stringify({ ts: Date.now() }));
    const res = await googleCallback(
      new Request(`https://app.example.com/api/auth/callback?code=c&state=${encodeURIComponent(payload + ".badsig")}`),
      env,
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("signature");
  });

  it("rejects an expired state", async () => {
    const payload = btoa(JSON.stringify({ ts: Date.now() - 16 * 60_000 }));
    const { hmacHex } = await import("../src/delivery/crypto");
    const sig = await hmacHex(CRED_KEY, "login-oauth:" + payload);
    const res = await googleCallback(
      new Request(`https://app.example.com/api/auth/callback?code=c&state=${encodeURIComponent(payload + "." + sig)}`),
      env,
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("expired");
  });
});

describe("getSession", () => {
  it("returns null without a cookie", async () => {
    const user = await getSession({ DB: fakeDb({}) }, new Request("https://app.example.com/api/runs"));
    expect(user).toBeNull();
  });

  it("returns the user for a live session row", async () => {
    const future = Date.now() + 60_000;
    const db = fakeDb({ hash: { email: "a@b.co", name: "A", expires_at: future } });
    const req = new Request("https://app.example.com/api/runs", { headers: { cookie: "pr_sess=tok123; other=x" } });
    expect(cookieSessionToken(req)).toBe("tok123");
    const user = await getSession({ DB: db }, req);
    expect((user as SessionUser | null)?.email).toBe("a@b.co");
  });

  it("deletes and rejects an expired session row", async () => {
    const past = Date.now() - 60_000;
    const deleted: string[] = [];
    const db = fakeDb({ hash: { email: "a@b.co", name: null, expires_at: past } }, deleted);
    const req = new Request("https://app.example.com/api/runs", { headers: { cookie: "pr_sess=tok123" } });
    const user = await getSession({ DB: db }, req);
    expect(user).toBeNull();
    expect(deleted.some((s) => s.startsWith("DELETE FROM user_session"))).toBe(true);
  });
});
