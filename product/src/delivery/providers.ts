/**
 * product/src/delivery/providers.ts — provider-independent email delivery.
 * Campaign logic depends on DeliveryProvider, never on a vendor SDK.
 * Adapters: mock (tests/demo), resend (HTTPS API), gmail (HTTPS Gmail API).
 * graph/smtp are declared but unimplemented (see providerFor).
 */
export type ProviderId = "mock" | "resend" | "gmail" | "graph" | "smtp";

export interface SendRequest {
  fromEmail: string;
  fromName?: string;
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
  unsubUrl?: string;
  idempotencyKey: string;
}

export type ErrorCategory = "auth" | "validation" | "rate_limit" | "transient" | "permanent" | "policy";

export interface SendResult {
  ok: boolean;
  providerMessageId?: string;
  /** accepted = provider queued it; sent = handed off synchronously. */
  status: "accepted" | "sent" | "failed";
  retryable: boolean;
  errorCategory?: ErrorCategory;
  /** Safe one-line detail; never includes credentials. */
  errorDetail?: string;
}

export interface VerifyResult { ok: boolean; error?: string }

/** Decrypted per-connection secret (provider-shaped JSON) + sender identity. */
export interface ConnCreds { secret: string; senderEmail: string; senderName?: string }

export interface DeliveryProvider {
  id: ProviderId;
  verify(creds: ConnCreds): Promise<VerifyResult>;
  send(creds: ConnCreds, req: SendRequest): Promise<SendResult>;
}

// --- mock (tests + controlled demo; no network) -------------------------------

export const mockOutbox: Array<{ creds: ConnCreds; req: SendRequest }> = [];
export function resetMockOutbox(): void { mockOutbox.length = 0; }

const mockProvider: DeliveryProvider = {
  id: "mock",
  async verify(creds) {
    if (creds.secret === "bad") return { ok: false, error: "mock credentials rejected" };
    return { ok: true };
  },
  async send(creds, req) {
    if (creds.secret === "bad") {
      return { ok: false, status: "failed", retryable: false, errorCategory: "auth", errorDetail: "mock credentials rejected" };
    }
    if (creds.secret === "flaky" && mockOutbox.length % 2 === 0) {
      return { ok: false, status: "failed", retryable: true, errorCategory: "transient", errorDetail: "mock transient failure" };
    }
    mockOutbox.push({ creds, req });
    return { ok: true, providerMessageId: `mock_${mockOutbox.length}`, status: "accepted", retryable: false };
  },
};

// --- HTTP helper ---------------------------------------------------------------

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
}

function httpCategory(status: number): { retryable: boolean; category: ErrorCategory } {
  if (status === 401 || status === 403) return { retryable: false, category: "auth" };
  if (status === 429) return { retryable: true, category: "rate_limit" };
  if (status >= 500) return { retryable: true, category: "transient" };
  return { retryable: false, category: "validation" };
}

async function safeDetail(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  return `HTTP ${res.status}: ${text.slice(0, 160)}`;
}

// --- resend (https://api.resend.com) --------------------------------------------

const resendProvider: DeliveryProvider = {
  id: "resend",
  async verify(creds) {
    try {
      const key = (JSON.parse(creds.secret) as { api_key?: string }).api_key;
      if (!key) return { ok: false, error: "missing api_key" };
      // Domains list is an authenticated read: proves the key works (not the sender identity).
      const res = await fetch("https://api.resend.com/domains", {
        headers: { authorization: "Bearer " + key },
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) return { ok: true };
      return { ok: false, error: await safeDetail(res) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message.slice(0, 160) : "verify failed" };
    }
  },
  async send(creds, req) {
    try {
      const key = (JSON.parse(creds.secret) as { api_key?: string }).api_key;
      if (!key) {
        return { ok: false, status: "failed", retryable: false, errorCategory: "auth", errorDetail: "missing api_key" };
      }
      const from = req.fromName ? `${req.fromName} <${req.fromEmail}>` : req.fromEmail;
      const res = await postJson("https://api.resend.com/emails", { authorization: "Bearer " + key }, {
        from, to: [req.to], subject: req.subject, text: req.text,
        ...(req.replyTo ? { reply_to: req.replyTo } : {}),
        ...(req.unsubUrl ? { headers: { "List-Unsubscribe": `<${req.unsubUrl}>` } } : {}),
      });
      if (res.ok) {
        const body = (await res.json().catch(() => ({}))) as { id?: string };
        return { ok: true, status: "accepted", retryable: false, ...(body.id ? { providerMessageId: body.id } : {}) };
      }
      const mapped = httpCategory(res.status);
      return { ok: false, status: "failed", retryable: mapped.retryable, errorCategory: mapped.category, errorDetail: await safeDetail(res) };
    } catch (e) {
      const detail = e instanceof Error ? e.message.slice(0, 160) : "send failed";
      return { ok: false, status: "failed", retryable: true, errorCategory: "transient", errorDetail: detail };
    }
  },
};

// --- gmail (Gmail API over HTTPS; OAuth tokens in sealed secret) ----------------

export interface GmailSecret { refresh_token: string; client_id: string; client_secret: string }

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i] ?? 0);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function buildMime(from: string, to: string, subject: string, text: string): string {
  const clean = (v: string) => v.replace(/[\r\n]+/g, " ");
  return (
    `From: ${clean(from)}\r\nTo: ${clean(to)}\r\nSubject: ${clean(subject)}\r\n` +
    `Content-Type: text/plain; charset=utf-8\r\n\r\n${text}`
  );
}

async function gmailAccessToken(sec: GmailSecret): Promise<{ token: string } | { error: string }> {
  try {
    const res = await postJson("https://oauth2.googleapis.com/token", {}, {
      client_id: sec.client_id,
      client_secret: sec.client_secret,
      refresh_token: sec.refresh_token,
      grant_type: "refresh_token",
    });
    if (!res.ok) return { error: await safeDetail(res) };
    const body = (await res.json().catch(() => ({}))) as { access_token?: string };
    if (!body.access_token) return { error: "no access_token in refresh response" };
    return { token: body.access_token };
  } catch (e) {
    return { error: e instanceof Error ? e.message.slice(0, 160) : "refresh failed" };
  }
}

const gmailProvider: DeliveryProvider = {
  id: "gmail",
  async verify(creds) {
    let sec: GmailSecret;
    try {
      sec = JSON.parse(creds.secret) as GmailSecret;
    } catch {
      return { ok: false, error: "secret is not valid Gmail JSON" };
    }
    if (!sec.refresh_token || !sec.client_id || !sec.client_secret) return { ok: false, error: "missing refresh_token/client_id/client_secret" };
    const tok = await gmailAccessToken(sec);
    // A fresh access token proves the client credentials and the live grant.
    // No readable profile endpoint is covered by gmail.send alone, so the
    // first real send is the true scope test (auth failures mark error).
    if ("error" in tok) return { ok: false, error: tok.error };
    return { ok: true };
  },
  async send(creds, req) {
    let sec: GmailSecret;
    try {
      sec = JSON.parse(creds.secret) as GmailSecret;
    } catch {
      return { ok: false, status: "failed", retryable: false, errorCategory: "auth", errorDetail: "secret is not valid Gmail JSON" };
    }
    const tok = await gmailAccessToken(sec);
    if ("error" in tok) {
      return { ok: false, status: "failed", retryable: false, errorCategory: "auth", errorDetail: tok.error };
    }
    try {
      const from = req.fromName ? `${req.fromName} <${req.fromEmail}>` : req.fromEmail;
      const raw = b64url(new TextEncoder().encode(buildMime(from, req.to, req.subject, req.text)));
      const res = await postJson("https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        { authorization: "Bearer " + tok.token }, { raw });
      if (res.ok) {
        const body = (await res.json().catch(() => ({}))) as { id?: string };
        return { ok: true, status: "sent", retryable: false, ...(body.id ? { providerMessageId: body.id } : {}) };
      }
      const mapped = httpCategory(res.status);
      return { ok: false, status: "failed", retryable: mapped.retryable, errorCategory: mapped.category, errorDetail: await safeDetail(res) };
    } catch (e) {
      const detail = e instanceof Error ? e.message.slice(0, 160) : "send failed";
      return { ok: false, status: "failed", retryable: true, errorCategory: "transient", errorDetail: detail };
    }
  },
};

/** Registry: graph/smtp throw honest not-implemented (SMTP needs a relay outside Workers). */
export function providerFor(id: ProviderId): DeliveryProvider {
  if (id === "mock") return mockProvider;
  if (id === "resend") return resendProvider;
  if (id === "gmail") return gmailProvider;
  throw new Error(`provider ${id} not implemented`);
}

// --- assisted delivery (no credentials, no sending) -------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export function isValidEmail(s: string): boolean {
  return EMAIL_RE.test(s.trim()) && s.length <= 254;
}

/** Correctly-encoded mailto: link. Opening it sends nothing. */
export function buildMailto(to: string, subject: string, body: string): string {
  if (!isValidEmail(to)) throw new Error("invalid recipient email");
  return `mailto:${encodeURIComponent(to.trim())}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** International digits only (no +, spaces, brackets, dashes). */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) throw new Error("phone must be 7-15 digits in international format");
  return digits;
}

/** wa.me click-to-send link. Opening the chat is a handoff, not proof of send. */
export function buildWaMe(phone: string, message: string): string {
  const digits = normalizePhone(phone);
  if (!message.trim()) throw new Error("message must not be empty");
  if (message.length > 1500) throw new Error("message too long for a wa.me link (1500 chars)");
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
