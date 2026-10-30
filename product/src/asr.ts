/**
 * product/src/asr.ts — Muse Voice Transcribe client helpers (Meta Model API).
 * Dictation flow: the browser records a short clip, converts it to 24 kHz mono
 * WAV, and POSTs the raw bytes to /api/transcribe; this module builds the
 * multipart request Meta's batch endpoint expects (a `request` JSON part +
 * an `audio` WAV part) and validates the response. The API key stays
 * server-side: the Authorization header is built here by string
 * concatenation ("Bearer " + key), never in the browser. PUSH_TO_TALK mode:
 * one utterance per clip. Endpoint spec: dev.meta.ai/docs/speech-to-text
 * (32 MB body cap; WAV mono 16-bit PCM at 16 or 24 kHz).
 */

export const ASR_ENDPOINT = "https://api.meta.ai/v1/asr/transcribe";
export const ASR_MODEL = "muse-voice-transcribe-1.0";
/** Provider cap is 32 MB; the route enforces its own smaller dictation cap. */
export const ASR_PROVIDER_BODY_CAP = 32 * 1024 * 1024;

/**
 * Vocabulary biasing for business descriptions. The browser recognizer this
 * replaces misheard "AI" as "inn"/"EM"/"To"; keywords steer the model toward
 * the terms small-business owners actually say. Bias, not guarantee.
 */
export const ASR_KEYWORDS = [
  "AI", "artificial intelligence", "e-commerce", "B2B", "SaaS", "POS",
  "logistics", "wholesale", "catering", "API", "FMCG", "SMS",
] as const;

export const ASR_LANGUAGE_BIAS = ["English"] as const;

export interface TranscribeRequestSpec {
  model: string;
  mode: "PUSH_TO_TALK";
  audioEncoding: "WAV";
  languageBias: string[];
  keywords: string[];
}

/** The `request` JSON part: same settings as the realtime handshake, minus
 * authorization. languageBias/keywords are fixed at request time. */
export function buildTranscribeRequestSpec(): TranscribeRequestSpec {
  return {
    model: ASR_MODEL,
    mode: "PUSH_TO_TALK",
    audioEncoding: "WAV",
    languageBias: [...ASR_LANGUAGE_BIAS],
    keywords: [...ASR_KEYWORDS],
  };
}

/**
 * Multipart body for POST /v1/asr/transcribe: `request` part as a JSON blob
 * (its content-type rides the Blob) and the `audio` part as a WAV blob.
 */
export function buildTranscribeForm(audio: Uint8Array, sessionId: string): FormData {
  const form = new FormData();
  form.append(
    "request",
    new Blob([JSON.stringify(buildTranscribeRequestSpec())], { type: "application/json" }),
  );
  // Copy to a standalone ArrayBuffer: Blob needs an exact buffer (the caller
  // may pass a view over a larger one).
  const bytes = (audio.byteOffset === 0 && audio.byteLength === audio.buffer.byteLength
    ? audio.buffer
    : audio.slice().buffer) as ArrayBuffer;
  form.append("audio", new Blob([bytes], { type: "audio/wav" }), `${sessionId}.wav`);
  return form;
}

export interface TranscribeParsed {
  ok: boolean;
  transcript: string;
  error?: string;
}

/**
 * Validate the JSON response. `transcript` (string) is the one required
 * field; sessionId/turns/audioDurationMs are tolerated-but-ignored.
 */
export function parseTranscribeResponse(body: unknown): TranscribeParsed {
  if (typeof body !== "object" || body === null) {
    return { ok: false, transcript: "", error: "asr_bad_response" };
  }
  const transcript = (body as Record<string, unknown>)["transcript"];
  if (typeof transcript !== "string") {
    return { ok: false, transcript: "", error: "asr_bad_response" };
  }
  return { ok: true, transcript };
}
