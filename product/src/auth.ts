/**
 * product/src/auth.ts — simple sign-in for the live product.
 *
 * The product sends email and WhatsApp messages on the user's behalf, so use
 * of the live API requires a signed-in identity. Sign-in is Google OAuth
 * (credentials already on the Worker): one button, one consent screen, no
 * passwords. Sessions are opaque random tokens in an HttpOnly cookie; D1
 * stores only the SHA-256 hash of the token. The demo path (/demo) and the
 * unsubscribe link for message recipients stay public by design.
 *
 * Redirect URI the operator must whitelist in the Google Cloud console:
 *   https://<host>/api/auth/callback
 */
import { hmacHex } from "./delivery/crypto";
import { auditEvent } from "./audit";

export interface SessionUser {
  email: string;
  name: string;
}

interface Env {
  DB: D1Database;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  CRED_KEY?: string;
}

const COOKIE = "pr_sess";
const SESSION_MS = 30 * 24 * 3600_000; // 30 days

function html(title: string, body: string, status = 400): Response {
  return new Response(
    `<!DOCTYPE html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} · Prospect Research</title><style>body{font-family:system-ui,sans-serif;background:#F8F7F4;color:#0B1220;display:grid;place-items:center;min-height:100vh;margin:0}main{background:#fff;border:1px solid #E6E3DA;border-radius:20px;padding:32px;max-width:420px;text-align:center}h1{font-size:20px;margin:0 0 8px}p{color:#4B5565;margin:0 0 16px}a{color:#2A43D1;font-weight:700}</style></head><body><main><h1>${title}</h1>${body}<p><a href="/">Back to Prospect Research</a></p></main></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

function cookieGet(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/** SHA-256 hex of a string — session tokens are stored hashed (never raw).
 *  Exported for tests that seed sessions directly. */
export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Parse a JWT id_token payload without verifying the signature — safe here
 * because the payload came straight from Google over the server-side code
 * exchange (client_secret never leaves the Worker). */
export function decodeIdToken(idToken: string): { email?: string; email_verified?: boolean; name?: string } | null {
  const parts = idToken.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const bin = atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(bytes)) as { email?: string; email_verified?: boolean; name?: string };
  } catch {
    return null;
  }
}

export function cookieSessionToken(req: Request): string | null {
  return cookieGet(req, COOKIE);
}

/** Look up the signed-in user from the session cookie. Returns null when
 * absent or expired; never throws on DB trouble? No — D1 errors bubble so
 * callers fail visibly. */
export async function getSession(env: Env, req: Request): Promise<SessionUser | null> {
  const token = cookieSessionToken(req);
  if (!token) return null;
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare(
    "SELECT email, name, expires_at FROM user_session WHERE token_hash = ?",
  ).bind(hash).first<{ email: string; name: string | null; expires_at: number }>();
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    await env.DB.prepare("DELETE FROM user_session WHERE token_hash = ?").bind(hash).run();
    return null;
  }
  return { email: row.email, name: row.name || row.email };
}

/** Start the Google OAuth flow: HMAC-signed state (same pattern as the Gmail
 * connection flow), 302 to the consent screen. */
export async function startGoogleLogin(req: Request, env: Env): Promise<Response> {
  await auditEvent(env.DB, { kind: "auth_event", subject: "signin_start", summary: { at: new Date().toISOString() } });
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.CRED_KEY) {
    return html("Sign-in unavailable", "<p>The server is missing Google sign-in credentials. Ask the operator to set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and CRED_KEY.</p>", 501);
  }
  const payload = btoa(JSON.stringify({ ts: Date.now() }));
  const sig = await hmacHex(env.CRED_KEY, "login-oauth:" + payload);
  const origin = new URL(req.url).origin;
  const url = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: `${origin}/api/auth/callback`,
    response_type: "code",
    scope: "openid email",
    state: `${payload}.${sig}`,
    prompt: "select_account",
  }).toString();
  return new Response(null, { status: 302, headers: { location: url } });
}

/** Finish the flow: verify state, exchange the code, store a session row,
 * set the cookie, and return to the app. */
export async function googleCallback(req: Request, env: Env): Promise<Response> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.CRED_KEY) {
    return html("Sign-in unavailable", "<p>The server is missing Google sign-in credentials.</p>", 501);
  }
  const q = new URL(req.url).searchParams;
  const code = q.get("code");
  const state = q.get("state") || "";
  if (!code) {
    await auditEvent(env.DB, { kind: "auth_event", subject: "signin_failed", summary: { reason: q.get("error") || "no_code" } });
    return html("Sign-in failed", `<p>${q.get("error") || "No authorisation code came back."}</p>`);
  }
  const dot = state.lastIndexOf(".");
  if (dot <= 0) {
    await auditEvent(env.DB, { kind: "auth_event", subject: "signin_failed", summary: { reason: "bad_state" } });
    return html("Sign-in failed", "<p>Bad state from Google.</p>");
  }
  const payload = state.slice(0, dot);
  const want = await hmacHex(env.CRED_KEY, "login-oauth:" + payload);
  if (state.slice(dot + 1) !== want) {
    await auditEvent(env.DB, { kind: "auth_event", subject: "signin_failed", summary: { reason: "state_signature_mismatch" } });
    return html("Sign-in failed", "<p>State signature mismatch — start again.</p>");
  }
  let decodedTs: number | undefined;
  try {
    decodedTs = (JSON.parse(atob(payload)) as { ts?: number }).ts;
  } catch {
    await auditEvent(env.DB, { kind: "auth_event", subject: "signin_failed", summary: { reason: "bad_state_payload" } });
    return html("Sign-in failed", "<p>Bad state payload.</p>");
  }
  if (!decodedTs || Date.now() - decodedTs > 15 * 60_000) {
    await auditEvent(env.DB, { kind: "auth_event", subject: "signin_failed", summary: { reason: "state_expired" } });
    return html("Sign-in failed", "<p>The sign-in attempt expired. Start again.</p>");
  }
  const origin = new URL(req.url).origin;
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${origin}/api/auth/callback`,
      grant_type: "authorization_code",
    }).toString(),
  });
  if (!tokenRes.ok) {
    await auditEvent(env.DB, { kind: "auth_event", subject: "signin_failed", summary: { reason: "token_exchange_failed", status: tokenRes.status } });
    return html("Sign-in failed", `<p>Token exchange failed (HTTP ${tokenRes.status}).</p>`);
  }
  const tokens = (await tokenRes.json()) as { id_token?: string };
  const claims = tokens.id_token ? decodeIdToken(tokens.id_token) : null;
  if (!claims || !claims.email || claims.email_verified !== true) {
    await auditEvent(env.DB, { kind: "auth_event", subject: "signin_failed", summary: { reason: "no_verified_email" } });
    return html("Sign-in failed", "<p>Google did not return a verified email address.</p>");
  }
  const name = (claims.name || "").slice(0, 80) || claims.email;
  const token = makeToken();
  const hash = await sha256Hex(token);
  const now = Date.now();
  // Opportunistic cleanup of expired rows, then insert the new session.
  await env.DB.prepare("DELETE FROM user_session WHERE expires_at < ?").bind(now).run();
  await env.DB.prepare(
    "INSERT INTO user_session (token_hash, email, name, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
  ).bind(hash, claims.email, name, new Date(now).toISOString(), now + SESSION_MS).run();
  const cookie = `${COOKIE}=${token}; HttpOnly; Secure; Path=/; Max-Age=${Math.floor(SESSION_MS / 1000)}; SameSite=Lax`;
  await auditEvent(env.DB, {
    kind: "auth_event", subject: "signin",
    summary: { email: claims.email, name, created_at: new Date(now).toISOString() },
  });
  const headers = new Headers({ location: `${origin}/?dash=1` });
  headers.append("set-cookie", cookie);
  return new Response(null, { status: 302, headers });
}

function makeToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Sign out: delete the session row and clear the cookie. */
export async function signOut(env: Env, req: Request): Promise<Response> {
  const token = cookieSessionToken(req);
  if (token) {
    const hash = await sha256Hex(token);
    const row = await env.DB.prepare(
      "SELECT email FROM user_session WHERE token_hash = ?",
    ).bind(hash).first<{ email: string }>().catch(() => null);
    await env.DB.prepare("DELETE FROM user_session WHERE token_hash = ?").bind(hash).run();
    await auditEvent(env.DB, { kind: "auth_event", subject: "signout", summary: { email: row?.email ?? null } });
  }
  const cleared = `${COOKIE}=; HttpOnly; Secure; Path=/; Max-Age=0; SameSite=Lax`;
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json", "set-cookie": cleared },
  });
}
