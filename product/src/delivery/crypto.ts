/**
 * product/src/delivery/crypto.ts — AES-GCM credential seal + HMAC tokens.
 * WebCrypto only: runs in Workers and in Node 20 (tests). No dependencies.
 * Secrets are sealed JSON strings; the key (32 bytes, base64) lives in the
 * CRED_KEY worker secret and never in D1, logs, or API responses.
 */
export interface SealedBlob { cipher_b64: string; nonce_b64: string }

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i] ?? 0);
  return btoa(s);
}

function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importAes(keyB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", unb64(keyB64) as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function importHmac(keyB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw", unb64(keyB64) as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"],
  );
}

/** Seal a plaintext credential; returns a JSON-serializable blob. */
export async function sealSecret(plaintext: string, keyB64: string): Promise<SealedBlob> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce as BufferSource }, await importAes(keyB64), enc.encode(plaintext));
  return { cipher_b64: b64(new Uint8Array(ct)), nonce_b64: b64(nonce) };
}

/** Open a sealed blob; throws on wrong key or tampering. */
export async function openSecret(blob: SealedBlob, keyB64: string): Promise<string> {
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unb64(blob.nonce_b64) as BufferSource }, await importAes(keyB64), unb64(blob.cipher_b64) as BufferSource,
  );
  return dec.decode(pt);
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** HMAC-SHA256 hex of a message under the raw key bytes. */
export async function hmacHex(keyB64: string, message: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await importHmac(keyB64), enc.encode(message));
  return hex(new Uint8Array(sig));
}

/** Stateless unsubscribe token: `<recipientId>.<sig>`. */
export async function signUnsub(keyB64: string, recipientId: string): Promise<string> {
  return `${recipientId}.${await hmacHex(keyB64, "unsub:" + recipientId)}`;
}

/** Verify an unsubscribe token; returns the recipient id or null. */
export async function verifyUnsub(keyB64: string, token: string): Promise<string | null> {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const id = token.slice(0, dot);
  const want = await hmacHex(keyB64, "unsub:" + id);
  return token.slice(dot + 1) === want ? id : null;
}
