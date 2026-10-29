import { describe, expect, it, vi } from "vitest";
import { smtpProvider, type SmtpRelayClient } from "../src/delivery/providers";

const SEC = JSON.stringify({ host: "mail.example.com", port: 587, username: "u", password: "p" });
const CREDS = { id: "conn-1", secret: SEC };
const REQ = { fromEmail: "sam@techassembly.io", to: "samdoxiso@gmail.com", subject: "hi", text: "hello" };

function relay(json: unknown, status = 200): SmtpRelayClient {
  return { post: vi.fn(async () => ({ status, json: json as Record<string, unknown> | null })) };
}

describe("smtp provider (container relay client)", () => {
  it("verify returns ok when the relay verifies the connection", async () => {
    const p = smtpProvider(relay({ ok: true }));
    await expect(p.verify(CREDS)).resolves.toEqual({ ok: true });
  });

  it("verify surfaces the relay error message", async () => {
    const p = smtpProvider(relay({ ok: false, error: "bad password" }, 401));
    const r = await p.verify(CREDS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("bad password");
  });

  it("verify rejects a malformed secret without calling the relay", async () => {
    const r = relay({ ok: true });
    const p = smtpProvider(r);
    const out = await p.verify({ id: "x", secret: "not-json" });
    expect(out.ok).toBe(false);
    expect(r.post).not.toHaveBeenCalled();
  });

  it("send returns sent with the provider message id", async () => {
    const p = smtpProvider(relay({ ok: true, messageId: "<abc@mail>" }));
    const r = await p.send(CREDS, REQ);
    expect(r).toMatchObject({ ok: true, status: "sent", providerMessageId: "<abc@mail>" });
  });

  it("send maps auth failure to non-retryable", async () => {
    const p = smtpProvider(relay({ ok: false, category: "auth", retryable: false, error: "535 bad" }, 401));
    const r = await p.send(CREDS, REQ);
    expect(r).toMatchObject({ ok: false, status: "failed", retryable: false, errorCategory: "auth" });
  });

  it("send maps transient relay failure to retryable", async () => {
    const p = smtpProvider(relay({ ok: false, category: "transient", retryable: true, error: "421 busy" }, 502));
    const r = await p.send(CREDS, REQ);
    expect(r).toMatchObject({ ok: false, status: "failed", retryable: true, errorCategory: "transient" });
  });

  it("send maps an unreachable relay to transient retryable", async () => {
    const p = smtpProvider({ post: async () => { throw new Error("connection reset"); } });
    const r = await p.send(CREDS, REQ);
    expect(r).toMatchObject({ ok: false, status: "failed", retryable: true, errorCategory: "transient" });
    if (!r.ok) expect(r.errorDetail).toContain("connection reset");
  });
});

describe("relay health endpoint", () => {
  const req = () => new Request("https://t.local/api/relay-health");
  const dead: SmtpRelayClient = {
    post: async () => { throw new Error("unused"); },
    get: async () => { throw new Error("unused"); },
  };

  it("reports reachable when the relay answers /health", async () => {
    const { getRelayHealth } = await import("../src/delivery/routes");
    const res = await getRelayHealth(req(), {} as never, {
      ...dead, get: async () => ({ status: 200, json: { ok: true, service: "smtp-relay" } }),
    });
    expect((await res.json()).relay).toBe("reachable");
  });

  it("reports unbound when no binding and no injected client", async () => {
    const { getRelayHealth } = await import("../src/delivery/routes");
    const res = await getRelayHealth(req(), {} as never);
    expect((await res.json()).relay).toBe("unbound");
  });

  it("reports unreachable when the relay errors", async () => {
    const { getRelayHealth } = await import("../src/delivery/routes");
    const res = await getRelayHealth(req(), {} as never, {
      ...dead, get: async () => { throw new Error("boom"); },
    });
    const body = await res.json() as { relay: string; detail: string };
    expect(body.relay).toBe("unreachable");
    expect(body.detail).toContain("boom");
  });
});
