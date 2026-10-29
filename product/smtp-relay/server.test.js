/** smtp-relay/server.test.js — contract tests with a stub transport (no network). */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { createApp } = require("./server");

function withServer(transport, onCreate) {
  const server = http.createServer(createApp((opts) => { if (onCreate) onCreate(opts); return transport; }));
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

test("health reports ok + uptime", async () => {
  const t = { verify: async () => true, sendMail: async () => ({ messageId: "x" }), close: () => {} };
  const s = await withServer(t);
  try {
    const r = await fetch(s.base + "/health");
    assert.equal(r.status, 200);
    const b = await r.json();
    assert.equal(b.ok, true);
    assert.equal(b.service, "smtp-relay");
    assert.equal(typeof b.startedAt, "string");
    assert.equal(typeof b.uptimeSec, "number");
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

test("send-batch uses one transport and returns per-message results", async () => {
  const seen = [];
  let created = 0;
  const t = {
    verify: async () => true,
    sendMail: async (msg) => { seen.push(msg); return { messageId: `<${seen.length}@mail>` }; },
    close: () => {},
  };
  const s = await withServer(t, () => { created += 1; });
  try {
    const r = await fetch(s.base + "/send-batch", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...creds, from: "me@co.ng",
        messages: [
          { to: "a@x.co", subject: "Hi A", text: "Body A" },
          { to: "b@x.co", subject: "Hi B", text: "Body B", unsubUrl: "https://x/u2" },
        ],
      }),
    });
    assert.equal(r.status, 200);
    const b = await r.json();
    assert.equal(b.ok, true);
    assert.equal(b.results.length, 2);
    assert.deepEqual(b.results[0], { ok: true, messageId: "<1@mail>" });
    assert.equal(b.results[1].ok, true);
    assert.equal(created, 1);
    assert.equal(seen.length, 2);
    assert.equal(seen[1].headers["List-Unsubscribe"], "<https://x/u2>");
  } finally { await s.close(); }
});

test("send-batch reports partial failure per message and enforces the cap", async () => {
  const t = {
    verify: async () => true,
    sendMail: async (msg) => {
      if (msg.to === "bad@x.co") { const e = new Error("550 mailbox unavailable"); e.code = "EENVELOPE"; throw e; }
      return { messageId: "<ok@mail>" };
    },
    close: () => {},
  };
  const s = await withServer(t);
  try {
    const r = await fetch(s.base + "/send-batch", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...creds, from: "me@co.ng",
        messages: [
          { to: "good@x.co", subject: "s", text: "t" },
          { to: "bad@x.co", subject: "s", text: "t" },
        ],
      }),
    });
    const b = await r.json();
    assert.equal(b.ok, true);
    assert.equal(b.results[0].ok, true);
    assert.equal(b.results[1].ok, false);
    assert.equal(b.results[1].category, "permanent");
    assert.equal(b.results[1].retryable, false);
    const many = await fetch(s.base + "/send-batch", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...creds, messages: Array.from({ length: 51 }, (_, i) => ({ to: `u${i}@x.co`, subject: "s", text: "t" })) }),
    });
    assert.equal(many.status, 400);
    const empty = await fetch(s.base + "/send-batch", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...creds, messages: [] }),
    });
    assert.equal(empty.status, 400);
  } finally { await s.close(); }
});
