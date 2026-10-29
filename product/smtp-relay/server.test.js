/** smtp-relay/server.test.js — contract tests with a stub transport (no network). */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { createApp } = require("./server");

function withServer(transport) {
  const server = http.createServer(createApp(() => transport));
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        base: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

const creds = { host: "mail.example.ng", port: 587, username: "u", password: "p" };

test("health reports ok", async () => {
  const t = { verify: async () => true, sendMail: async () => ({ messageId: "x" }), close: () => {} };
  const s = await withServer(t);
  try {
    const r = await fetch(s.base + "/health");
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, service: "smtp-relay" });
  } finally { await s.close(); }
});

test("verify + send round-trip through the stub transport", async () => {
  const seen = [];
  const t = {
    verify: async () => true,
    sendMail: async (msg) => { seen.push(msg); return { messageId: "<abc@mail>" }; },
    close: () => {},
  };
  const s = await withServer(t);
  try {
    const v = await fetch(s.base + "/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(creds) });
    assert.deepEqual(await v.json(), { ok: true });
    const snd = await fetch(s.base + "/send", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...creds, from: "me@co.ng", fromName: "Me", to: "you@co.ng", subject: "Hi", text: "Body", unsubUrl: "https://x/u" }),
    });
    assert.deepEqual(await snd.json(), { ok: true, messageId: "<abc@mail>" });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].headers["List-Unsubscribe"], "<https://x/u>");
  } finally { await s.close(); }
});

test("auth failures map to auth/non-retryable; bad input 400s", async () => {
  const t = {
    verify: async () => { const e = new Error("Invalid login: 535"); e.code = "EAUTH"; throw e; },
    sendMail: async () => { throw new Error("nope"); },
    close: () => {},
  };
  const s = await withServer(t);
  try {
    const v = await fetch(s.base + "/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(creds) });
    const vb = await v.json();
    assert.equal(vb.ok, false);
    assert.equal(vb.category, "auth");
    const bad = await fetch(s.base + "/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...creds, port: 25, to: "a@b.co", subject: "s", text: "t" }) });
    assert.equal(bad.status, 400);
    const notfound = await fetch(s.base + "/nope");
    assert.equal(notfound.status, 404);
  } finally { await s.close(); }
});
