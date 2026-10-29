/**
 * smtp-relay/server.js — binding-only SMTP relay (runs in a Cloudflare Container).
 * The Worker (the only caller, via the container binding) POSTs per-request SMTP
 * credentials + message; the relay sends through the USER'S provider and forgets.
 * Nothing secret is stored, logged, or kept at rest. Nodemailer is required only
 * when the server actually runs; tests inject a stub transport factory.
 */
"use strict";
const http = require("node:http");

const PORT = Number(process.env.PORT || 8080);
const TIMEOUT_MS = 20000;

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req, limit = 512 * 1024) {
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
        json(res, 200, { ok: true, service: "smtp-relay" });
        return;
      }
      if (req.method !== "POST" || (req.url !== "/verify" && req.url !== "/send")) {
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
      if (req.url === "/verify") {
        try {
          await withTimeout(transport.verify(), TIMEOUT_MS, "smtp verify");
          json(res, 200, { ok: true });
        } catch (err) {
          const c = categorize(err);
          json(res, 200, { ok: false, error: c.detail, category: c.category });
        } finally {
          try { transport.close(); } catch { /* ignore */ }
        }
        return;
      }
      // /send
      if (typeof body.to !== "string" || !body.to.includes("@")) {
        json(res, 400, { ok: false, error: "to must be an email address" });
        return;
      }
      if (typeof body.subject !== "string" || typeof body.text !== "string") {
        json(res, 400, { ok: false, error: "subject and text required" });
        return;
      }
      try {
        const info = await withTimeout(transport.sendMail({
          from: body.fromName ? `"${String(body.fromName).replace(/["\r\n]/g, "")}" <${body.from}>` : body.from,
          to: body.to,
          subject: body.subject,
          text: body.text,
          ...(body.replyTo ? { replyTo: body.replyTo } : {}),
          ...(body.unsubUrl ? { headers: { "List-Unsubscribe": `<${body.unsubUrl}>` } } : {}),
        }), TIMEOUT_MS * 2, "smtp send");
        json(res, 200, { ok: true, messageId: info && info.messageId ? String(info.messageId) : null });
      } catch (err) {
        const c = categorize(err);
        json(res, 200, { ok: false, status: "failed", error: c.detail, category: c.category, retryable: c.retryable });
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
