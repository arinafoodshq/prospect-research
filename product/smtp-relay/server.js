/**
 * smtp-relay/server.js — binding-only SMTP relay (runs in a Cloudflare Container).
 * The Worker (the only caller, via the container binding) POSTs per-request SMTP
 * credentials + message(s); the relay sends through the USER'S provider and forgets.
 * Nothing secret is stored, logged, or kept at rest. Nodemailer is required only
 * when the server actually runs; tests inject a stub transport factory.
 *
 * Speed design: one SMTP transport (one handshake) per request, and /send-batch
 * carries a whole queue batch over that single connection. The Worker keeps the
 * container warm with /health pings only while SMTP work is pending.
 */
"use strict";
const http = require("node:http");

const PORT = Number(process.env.PORT || 8080);
const TIMEOUT_MS = 20000;
const MAX_BATCH = 50;
const STARTED_AT = new Date().toISOString();

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new Error("body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** Map nodemailer/system errors to safe categories. Never includes secrets. */
function categorize(err) {
  const msg = String((err && err.message) || err || "send failed").slice(0, 200);
  const code = String((err && err.code) || "");
  if (/EAUTH|535|535-5|Username and Password not accepted|Invalid login/i.test(msg + " " + code)) {
    return { category: "auth", retryable: false, detail: msg };
  }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ESOCKET|ECONNRESET|EAI_AGAIN/i.test(code)) {
    return { category: "transient", retryable: true, detail: msg };
  }
  if (/EENVELOPE|550|551|552|553|554|recipient|mailbox/i.test(msg + " " + code)) {
    return { category: "permanent", retryable: false, detail: msg };
  }
  return { category: "transient", retryable: true, detail: msg };
}

function checkCreds(b) {
  if (!b || typeof b !== "object") return "invalid JSON body";
  if (typeof b.host !== "string" || !b.host.trim() || b.host.length > 253) return "host required";
  if (!Number.isInteger(b.port) || b.port < 1 || b.port > 65535) return "port must be 1-65535";
  if (b.port === 25) return "port 25 blocked: use 465 (implicit TLS) or 587 (STARTTLS)";
  if (typeof b.username !== "string" || !b.username) return "username required";
  if (typeof b.password !== "string" || !b.password) return "password required";
  return null;
}

function checkMsg(m) {
  if (!m || typeof m !== "object") return "message must be an object";
  if (typeof m.to !== "string" || !m.to.includes("@")) return "to must be an email address";
  if (typeof m.subject !== "string" || typeof m.text !== "string") return "subject and text required";
  return null;
}

function buildMsg(from, fromName, m) {
  return {
    from: fromName ? `"${String(fromName).replace(/["\r\n]/g, "")}" <${from}>` : from,
    to: m.to,
    subject: m.subject,
    text: m.text,
    ...(m.replyTo ? { replyTo: m.replyTo } : {}),
    ...(m.unsubUrl ? { headers: { "List-Unsubscribe": `<${m.unsubUrl}>` } } : {}),
  };
}

function withTimeout(promise, ms, what) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(what + " timed out")), ms);
  });
  return Promise.race([promise.finally(() => clearTimeout(timer)), timeout]);
}

function createApp(createTransport) {
  const handler = async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/health") {
        json(res, 200, {
          ok: true, service: "smtp-relay", startedAt: STARTED_AT,
          uptimeSec: Math.floor((Date.now() - Date.parse(STARTED_AT)) / 1000),
        });
        return;
      }
      if (req.method !== "POST" || (req.url !== "/verify" && req.url !== "/send" && req.url !== "/send-batch")) {
        json(res, 404, { ok: false, error: "not found" });
        return;
      }
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        json(res, 400, { ok: false, error: "invalid JSON body" });
        return;
      }
      const bad = checkCreds(body);
      if (bad) { json(res, 400, { ok: false, error: bad }); return; }
      const transport = createTransport({
        host: body.host.trim(),
        port: body.port,
        secure: body.secure === true || body.port === 465,
        auth: { user: body.username, pass: body.password },
        connectionTimeout: TIMEOUT_MS,
        greetingTimeout: TIMEOUT_MS,
        socketTimeout: TIMEOUT_MS,
      });
      try {
        if (req.url === "/verify") {
          try {
            await withTimeout(transport.verify(), TIMEOUT_MS, "smtp verify");
            json(res, 200, { ok: true });
          } catch (err) {
            const c = categorize(err);
            json(res, 200, { ok: false, error: c.detail, category: c.category });
          }
          return;
        }
        if (req.url === "/send-batch") {
          const msgs = body.messages;
          if (!Array.isArray(msgs) || msgs.length === 0) {
            json(res, 400, { ok: false, error: "messages must be a non-empty array" });
            return;
          }
          if (msgs.length > MAX_BATCH) {
            json(res, 400, { ok: false, error: `messages capped at ${MAX_BATCH}` });
            return;
          }
          for (const m of msgs) {
            const badMsg = checkMsg(m);
            if (badMsg) { json(res, 400, { ok: false, error: badMsg }); return; }
          }
          // Sequential on one connection: predictable provider rate behavior,
          // per-message outcomes so the Worker can retry only failures.
          const results = [];
          for (const m of msgs) {
            try {
              const info = await withTimeout(
                transport.sendMail(buildMsg(m.from || body.from, m.fromName || body.fromName, m)),
                TIMEOUT_MS * 2, "smtp send");
              results.push({ ok: true, messageId: info && info.messageId ? String(info.messageId) : null });
            } catch (err) {
              const c = categorize(err);
              results.push({ ok: false, error: c.detail, category: c.category, retryable: c.retryable });
            }
          }
          json(res, 200, { ok: true, results });
          return;
        }
        // /send
        const badMsg = checkMsg(body);
        if (badMsg) { json(res, 400, { ok: false, error: badMsg }); return; }
        try {
          const info = await withTimeout(transport.sendMail(buildMsg(body.from, body.fromName, body)),
            TIMEOUT_MS * 2, "smtp send");
          json(res, 200, { ok: true, messageId: info && info.messageId ? String(info.messageId) : null });
        } catch (err) {
          const c = categorize(err);
          json(res, 200, { ok: false, status: "failed", error: c.detail, category: c.category, retryable: c.retryable });
        }
      } finally {
        try { transport.close(); } catch { /* ignore */ }
      }
    } catch (err) {
      json(res, 500, { ok: false, error: String((err && err.message) || "relay failed").slice(0, 200) });
    }
  };
  return handler;
}

if (require.main === module) {
  // eslint-disable-next-line global-require
  const nodemailer = require("nodemailer");
  const server = http.createServer(createApp((opts) => nodemailer.createTransport(opts)));
  server.listen(PORT, () => console.log(`smtp-relay listening on ${PORT}`));
}

module.exports = { createApp, categorize, checkCreds };
