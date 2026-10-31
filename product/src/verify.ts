/**
 * product/src/verify.ts — contact and link verification (a script, not a
 * model guess). Spec P0 (2026-10-31): every link the UI shows must have been
 * classified and checked; broken and wrong-type contacts are never links.
 *
 * Rules implemented here:
 * - Social URL shapes are classified FIRST: business profile shapes only
 *   (instagram.com/{handle}, facebook.com/{page}, linkedin.com/company/{slug},
 *   x.com/{handle}, tiktok.com/@handle). Posts, reels, groups, hashtags and
 *   personal profiles (linkedin.com/in/..., linkedin.com/posts/...) are
 *   wrong_type before any fetch.
 * - Website: fetch with redirects and a 10s timeout. 2xx accepted; 404/410/
 *   DNS failure/parked pages broken; the page must mention the business or
 *   its area to be verified, else unchecked.
 * - Social sites often block scripts or show a login wall: a non-200 there
 *   is "unchecked", never proof it is broken. Verified only when the page
 *   text or metadata matches the business.
 * - Phone: Nigeria validation (+234/0 forms). A phone is WhatsApp ONLY when
 *   the source page confirms it (wa.me link or "WhatsApp" label nearby);
 *   otherwise it stays a phone. Never guessed.
 * - Email: syntax + domain match against the business's own domain. We
 *   cannot confirm a mailbox exists, so best state is "unchecked".
 */

import { isValidNgPhone } from "./research/commercial";

export type ContactState = "verified" | "unchecked" | "broken" | "wrong_type";

export type Fetcher = (url: string, init?: { signal?: AbortSignal; redirect?: "follow" | "error" | "manual" }) => Promise<Response>;

export interface SocialShape {
  network: "instagram" | "facebook" | "linkedin" | "x" | "tiktok" | "unknown";
  kind: "profile" | "post" | "personal" | "unknown";
  /** Single path segment after the host (the handle/page slug), if any. */
  handle: string;
}

const SEG_RE = /^\/([A-Za-z0-9._@-]+)(?:\/|$)/;

function firstSegment(pathname: string): string | null {
  const m = SEG_RE.exec(pathname);
  return m ? (m[1] ?? null) : null;
}

/** Classify a social URL by shape, before any network access. */
export function classifySocialUrl(raw: string): SocialShape {
  let network: SocialShape["network"] = "unknown";
  let path = "";
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    path = u.pathname.toLowerCase();
    if (host === "instagram.com" || host.endsWith(".instagram.com")) network = "instagram";
    else if (host === "facebook.com" || host === "fb.com" || host === "m.facebook.com" || host.endsWith(".facebook.com")) network = "facebook";
    else if (host === "linkedin.com" || host.endsWith(".linkedin.com")) network = "linkedin";
    else if (host === "x.com" || host === "twitter.com") network = "x";
    else if (host === "tiktok.com" || host.endsWith(".tiktok.com")) network = "tiktok";
  } catch {
    return { network: "unknown", kind: "unknown", handle: "" };
  }
  if (network === "unknown") return { network, kind: "unknown", handle: "" };

  // Post/reel/feed shapes are never business profiles.
  if (
    /\/(p|reel|reels|explore|stories|tv)\//.test(path) && network === "instagram" ||
    network === "facebook" && /\/(posts|videos|groups|events|watch|notes|permalink|share)\//.test(path) ||
    network === "linkedin" && /\/(posts|feed|pulse|posts\/|detail\/)\//.test(path)
  ) {
    return { network, kind: "post", handle: "" };
  }
  if (network === "linkedin") {
    const seg = firstSegment(path) ?? "";
    if (seg === "in") return { network, kind: "personal", handle: "" };
    if (seg === "company") {
      const slug = path.split("/")[2] ?? "";
      return { network, kind: slug ? "profile" : "unknown", handle: slug };
    }
    return { network, kind: "unknown", handle: seg };
  }
  if (network === "facebook") {
    if (/^\/(people|profile\.php|pages)\//.test(path)) return { network, kind: "unknown", handle: "" };
    const seg = firstSegment(path) ?? "";
    return { network, kind: seg && !seg.startsWith("pages-") ? "profile" : "unknown", handle: seg };
  }
  if (network === "instagram") {
    const seg = firstSegment(path) ?? "";
    const reserved = new Set(["explore", "accounts", "stories"]);
    if (!seg || reserved.has(seg)) return { network, kind: "unknown", handle: "" };
    return { network, kind: "profile", handle: seg };
  }
  if (network === "x" || network === "tiktok") {
    const seg = firstSegment(path) ?? "";
    if (!seg) return { network, kind: "unknown", handle: "" };
    if (network === "x" && /^(home|i|intent)$/.test(seg)) return { network, kind: "unknown", handle: "" };
    if (network === "tiktok" && !seg.startsWith("@")) return { network, kind: "unknown", handle: "" };
    return { network, kind: "profile", handle: seg };
  }
  return { network, kind: "unknown", handle: "" };
}

export interface UrlVerdict {
  state: ContactState;
  detail: string;
}

/** Distinctive word from the business name for page matching (never generic). */
export function matchTokens(businessName: string): string[] {
  const words = businessName
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3);
  return words.length > 0 ? words.slice(0, 3) : [];
}

/**
 * Fetch a URL and judge it. Websites must open AND mention the business or
 * its area. Social hosts that block scripts (401/403/429/login wall) come
 * back "unchecked" — that is not proof the link is broken.
 */
export async function verifyUrl(
  url: string,
  businessName: string,
  area: string,
  fetcher: Fetcher,
  timeoutMs = 10_000,
): Promise<UrlVerdict> {
  let res: Response;
  try {
    res = await fetcher(url, { signal: AbortSignal.timeout(timeoutMs), redirect: "follow" });
  } catch {
    return { state: "broken", detail: "did not open (network error or timeout)" };
  }
  const social = classifySocialUrl(url).network !== "unknown";
  if (!res.ok) {
    if (social && (res.status === 401 || res.status === 403 || res.status === 429 || res.status === 999)) {
      return { state: "unchecked", detail: `the network blocked our check (http ${res.status})` };
    }
    if (res.status === 404 || res.status === 410) {
      return { state: "broken", detail: `page gone (http ${res.status})` };
    }
    return { state: "unchecked", detail: `unexpected http ${res.status}` };
  }
  let text = "";
  try {
    text = (await res.text()).slice(0, 20_000).toLowerCase();
  } catch {
    return { state: "unchecked", detail: "could not read the page" };
  }
  if (/domain for sale|buy this domain|parked domain|godaddy sedo/i.test(text)) {
    return { state: "broken", detail: "domain is parked or for sale" };
  }
  const tokens = matchTokens(businessName);
  const areaTokens = matchTokens(area);
  const nameHit = tokens.some((t) => text.includes(t));
  const areaHit = areaTokens.some((t) => text.includes(t));
  if (nameHit || areaHit || (social && text.length > 200)) {
    // Social walls return thin generic chrome; require a token there.
    if (social && !nameHit && !areaHit) return { state: "unchecked", detail: "opened, but could not confirm it is this business" };
    return { state: "verified", detail: "opened and mentions this business" };
  }
  return { state: "unchecked", detail: "opened, but could not confirm it is this business" };
}

export interface ContactCheckInput {
  channel: string; // website_form | email | phone | social_profile | whatsapp?
  value: string;
  /** The page the contact was lifted from (for WhatsApp confirmation). */
  sourceText?: string;
  /** The business's own website domain (for email domain match). */
  ownDomain?: string;
  businessName: string;
  area: string;
}

export interface ContactCheckResult {
  channel: "website" | "email" | "phone" | "whatsapp" | "instagram" | "facebook" | "linkedin" | "x" | "tiktok";
  value: string;
  state: ContactState;
  detail: string;
}

/** WhatsApp confirmation: the source page must show intent (wa.me/whatsapp). */
export function whatsappConfirmed(value: string, sourceText?: string): boolean {
  if (!sourceText) return false;
  const digits = value.replace(/\D/g, "").slice(-9);
  if (!digits) return false;
  const lower = sourceText.toLowerCase();
  if (lower.includes("wa.me") || lower.includes("api.whatsapp.com") || lower.includes("whatsapp")) {
    // The number or a meaningful tail of it must appear near the mention.
    return lower.includes(digits) || lower.includes(digits.slice(-7));
  }
  return false;
}

/**
 * Verify one extracted contact. Wrong-type social shapes are rejected
 * before any fetch. Email can be syntax- and domain-checked only: the
 * result says "address not tested", because we cannot confirm a mailbox.
 */
export async function verifyContact(
  input: ContactCheckInput,
  fetcher: Fetcher,
): Promise<ContactCheckResult> {
  const { channel, value, sourceText, ownDomain, businessName, area } = input;

  if (channel === "social_profile" || /^https?:\/\//.test(value)) {
    const shape = classifySocialUrl(value);
    if (shape.network === "linkedin" && (shape.kind === "personal" || shape.kind === "post")) {
      return { channel: "linkedin", value, state: "wrong_type", detail: shape.kind === "personal" ? "a personal LinkedIn profile, not the business" : "a LinkedIn post, not the business page" };
    }
    if (shape.kind === "post") {
      return { channel: shape.network as ContactCheckResult["channel"], value, state: "wrong_type", detail: "a post, not a business page" };
    }
    if (shape.kind === "profile") {
      const v = await verifyUrl(value, businessName, area, fetcher);
      return { channel: shape.network as ContactCheckResult["channel"], value, state: v.state, detail: v.detail };
    }
  }

  if (channel === "website_form") {
    const v = await verifyUrl(value, businessName, area, fetcher);
    return { channel: "website", value, state: v.state, detail: v.detail };
  }

  if (channel === "phone") {
    if (!isValidNgPhone(value)) {
      return { channel: "phone", value, state: "wrong_type", detail: "not a valid Nigerian number" };
    }
    if (whatsappConfirmed(value, sourceText)) {
      return { channel: "whatsapp", value, state: "verified", detail: "WhatsApp confirmed on their own page" };
    }
    return { channel: "phone", value, state: "unchecked", detail: "valid Nigerian number; WhatsApp not confirmed" };
  }

  if (channel === "email") {
    if (!/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(value)) {
      return { channel: "email", value, state: "wrong_type", detail: "not a valid email address" };
    }
    const domain = value.split("@")[1] ?? "";
    if (ownDomain && !domain.endsWith(ownDomain.replace(/^www\./, ""))) {
      return { channel: "email", value, state: "unchecked", detail: "address not tested; domain differs from their website" };
    }
    return { channel: "email", value, state: "unchecked", detail: "address not tested; mailbox existence cannot be confirmed" };
  }

  return { channel: "phone", value, state: "unchecked", detail: "not verified" };
}
