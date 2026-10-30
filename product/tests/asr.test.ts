/**
 * product/tests/asr.test.ts — Muse Voice Transcribe helpers + dictation route.
 * No network: the Meta endpoint is a stubbed global fetch; fixtures carry
 * response bodies only (no request headers, no real keys).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ASR_ENDPOINT,
  ASR_MODEL,
  buildTranscribeForm,
  buildTranscribeRequestSpec,
  parseTranscribeResponse,
} from "../src/asr";
import app from "../src/index";

function makeWav(frames: number): ArrayBuffer {
  const bytes = new ArrayBuffer(44 + frames * 2);
  const view = new DataView(bytes);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i += 1) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF"); view.setUint32(4, 36 + frames * 2, true); writeStr(8, "WAVE");
  writeStr(12, "fmt "); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 24000, true); view.setUint32(28, 48000, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  writeStr(36, "data"); view.setUint32(40, frames * 2, true);
  for (let i = 0; i < frames; i += 1) view.setInt16(44 + i * 2, (i % 7) * 100, true);
  return bytes;
}

const ENV_OK = { MODEL_API_KEY: "test-key" } as never;

function post(body: BodyInit): Promise<Response> {
  const req = new Request("http://localhost/api/transcribe", { method: "POST", body });
  return app.fetch(req, ENV_OK, { waitUntil: async () => {} } as never);
}

describe("buildTranscribeRequestSpec", () => {
  it("targets the Muse Voice Transcribe model in push-to-talk WAV mode", () => {
    const spec = buildTranscribeRequestSpec();
    expect(spec.model).toBe(ASR_MODEL);
    expect(ASR_MODEL).toContain("muse-voice-transcribe");
    expect(spec.mode).toBe("PUSH_TO_TALK");
    expect(spec.audioEncoding).toBe("WAV");
  });

  it("biases toward English and includes domain keywords with 'AI' first", () => {
    const spec = buildTranscribeRequestSpec();
    expect(spec.languageBias).toEqual(["English"]);
    expect(spec.keywords[0]).toBe("AI");
  });
});

describe("buildTranscribeForm", () => {
  it("carries a JSON request part and a WAV audio part", async () => {
    const form = buildTranscribeForm(new Uint8Array(makeWav(8)), "dict-x");
    const request = form.get("request") as Blob;
    const audio = form.get("audio") as File;
    expect(request).toBeInstanceOf(Blob);
    expect(request.type).toBe("application/json");
    expect(JSON.parse(await request.text())).toMatchObject({ model: ASR_MODEL, mode: "PUSH_TO_TALK" });
    expect(audio.type).toBe("audio/wav");
    expect(audio.size).toBe(44 + 8 * 2);
  });
});

describe("parseTranscribeResponse", () => {
  it("extracts the transcript from a valid body", () => {
    const parsed = parseTranscribeResponse({
      sessionId: "s1", transcript: "We do AI systems for businesses.", audioDurationMs: 2400, turns: [],
    });
    expect(parsed.ok).toBe(true);
    expect(parsed.transcript).toBe("We do AI systems for businesses.");
  });

  it("rejects missing transcript and non-object bodies", () => {
    expect(parseTranscribeResponse({ sessionId: "s1" }).ok).toBe(false);
    expect(parseTranscribeResponse(null).ok).toBe(false);
    expect(parseTranscribeResponse("nope").ok).toBe(false);
  });
});

describe("POST /api/transcribe", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("requires the server-side key", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/transcribe", { method: "POST", body: makeWav(100) }),
      {} as never,
      { waitUntil: async () => {} } as never,
    );
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("model_not_configured");
  });

  it("rejects non-WAV and too-short bodies before calling Meta", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const notWav = new ArrayBuffer(200);
    const bad = await post(notWav);
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("invalid_audio");
    const tiny = await post(new ArrayBuffer(10));
    expect(tiny.status).toBe(400);
    expect((await tiny.json()).error).toBe("audio_too_short");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards a WAV clip to Meta with a Bearer header and returns clean text", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      sessionId: "srv-1",
      transcript: "We do AI systems for businesses.",
      audioDurationMs: 2500,
      turns: [],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await post(makeWav(1000));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: "We do AI systems for businesses." });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url.startsWith(ASR_ENDPOINT)).toBe(true);
    // AGENTS.md §4: auth header built by concatenation, never interpolation.
    expect(init.headers).toEqual({ "Authorization": "Bearer test-key" });
    const form = init.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(JSON.parse(await (form.get("request") as Blob).text())).toMatchObject({ model: ASR_MODEL });
    expect((form.get("audio") as File).size).toBe(44 + 1000 * 2);
  });

  it("maps provider failures to 502 transcribe_failed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 429 })));
    const res = await post(makeWav(1000));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("transcribe_failed");
    expect(body.detail).toBe("asr_http_429");
  });

  it("maps a transcript-less provider 200 to 502 asr_bad_response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ sessionId: "x" }), { status: 200 })));
    const res = await post(makeWav(1000));
    expect(res.status).toBe(502);
    expect((await res.json()).detail).toBe("asr_bad_response");
  });

  it("returns 422 when the transcript is empty", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ transcript: "   " }), { status: 200 })));
    const res = await post(makeWav(1000));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("transcribe_empty");
  });
});
