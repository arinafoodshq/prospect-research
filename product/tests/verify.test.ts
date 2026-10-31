/**
 * product/tests/verify.test.ts — contact and link verification (spec P0,
 * 2026-10-31): URL shapes, Nigerian phone validation, and the deterministic
 * link checks. No live network: fetch is stubbed per test.
 */
import { describe, expect, it, vi } from "vitest";
import { classifySocialUrl, verifyContact, verifyUrl } from "../src/verify";
import { isValidNgPhone, normaliseNgPhone } from "../src/research/commercial";
import { dedupeKey } from "../src/db";

describe("classifySocialUrl", () => {
  it("accepts business profile shapes", () => {
    expect(classifySocialUrl("https://www.instagram.com/ikejaeventhub")).toMatchObject({ network: "instagram", kind: "profile", handle: "ikejaeventhub" });
    expect(classifySocialUrl("https://www.facebook.com/WelcomeCentreHotels")).toMatchObject({ network: "facebook", kind: "profile" });
    expect(classifySocialUrl("https://www.linkedin.com/company/grillhouse")).toMatchObject({ network: "linkedin", kind: "profile", handle: "grillhouse" });
    expect(classifySocialUrl("https://x.com/grillhouse")).toMatchObject({ network: "x", kind: "profile" });
    expect(classifySocialUrl("https://www.tiktok.com/@grillhouse")).toMatchObject({ network: "tiktok", kind: "profile" });
  });

  it("rejects posts, personal profiles and group pages as wrong shapes", () => {
    expect(classifySocialUrl("https://www.linkedin.com/posts/oluwaseyitan-akin").kind).toBe("post");
    expect(classifySocialUrl("https://www.linkedin.com/in/oluwaseyitan-akin").kind).toBe("personal");
    expect(classifySocialUrl("https://www.instagram.com/p/CxYz1234/").kind).toBe("post");
    expect(classifySocialUrl("https://www.instagram.com/reel/abc123/").kind).toBe("post");
    expect(classifySocialUrl("https://www.facebook.com/groups/12345/").kind).toBe("post");
  });
});

describe("Nigerian phone validation", () => {
  it("accepts valid mobile and Lagos landline forms", () => {
    expect(isValidNgPhone("2348056453934")).toBe(true);
    expect(isValidNgPhone("08056453934")).toBe(true);
    expect(isValidNgPhone("012345678")).toBe(true); // 01 + 7: Lagos landline
    expect(normaliseNgPhone("0803 123 4567")).toBe("08031234567");
    expect(normaliseNgPhone("+2348031234567")).toBe("+2348031234567");
  });

  it("rejects timestamps, malformed double prefixes and junk", () => {
    expect(isValidNgPhone("20261004104841")).toBe(false); // a timestamp, not a phone
    expect(isValidNgPhone("23401262104041")).toBe(false); // +234 with a 0 baked in
    expect(isValidNgPhone("01262104041")).toBe(false);    // 11 digits starting 01: malformed
    expect(normaliseNgPhone("20261004104841")).toBeNull();
  });
});

describe("verifyUrl", () => {
  it("verifies a page that opens and mentions the business", async () => {
    const fetcher = vi.fn(async () => new Response("<html><title>Grill House Ikeja</title><body>grill house events</body></html>", { status: 200 }));
    const v = await verifyUrl("https://grillhouse.ng", "Grill House", "Ikeja", fetcher as never);
    expect(v.state).toBe("verified");
  });

  it("marks 404 as broken and parked domains as broken", async () => {
    const fetcher = vi.fn(async () => new Response("nope", { status: 404 }));
    expect((await verifyUrl("https://gone.ng", "Gone Ltd", "", fetcher as never)).state).toBe("broken");
    const parked = vi.fn(async () => new Response("<html>Buy this domain - great prices</html>", { status: 200 }));
    expect((await verifyUrl("https://parked.ng", "Parked Ltd", "", parked as never)).state).toBe("broken");
  });

  it("treats a blocked social host as unchecked, never broken", async () => {
    const fetcher = vi.fn(async () => new Response("login required", { status: 403 }));
    const v = await verifyUrl("https://www.instagram.com/grillhouse", "Grill House", "", fetcher as never);
    expect(v.state).toBe("unchecked");
    expect(v.detail).toContain("blocked");
  });
});

describe("verifyContact", () => {
  it("rejects a LinkedIn post as wrong type before any fetch", async () => {
    const fetcher = vi.fn();
    const out = await verifyContact(
      { channel: "social_profile", value: "https://www.linkedin.com/posts/oluwaseyitan-akin", businessName: "Access Bank", area: "Ikeja" },
      fetcher as never,
    );
    expect(out.state).toBe("wrong_type");
    expect(out.detail).toContain("post");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("promotes a phone to WhatsApp only when the page confirms it", async () => {
    const page = "Call us on 0803 123 4567 or chat on WhatsApp wa.me/2348031234567";
    const confirmed = await verifyContact({ channel: "phone", value: "08031234567", sourceText: page, businessName: "X", area: "" }, async () => { throw new Error("no"); });
    expect(confirmed.channel).toBe("whatsapp");
    expect(confirmed.state).toBe("verified");
    const notConfirmed = await verifyContact({ channel: "phone", value: "08031234567", sourceText: "Call us any time", businessName: "X", area: "" }, async () => { throw new Error("no"); });
    expect(notConfirmed.channel).toBe("phone");
    expect(notConfirmed.state).toBe("unchecked");
  });

  it("email says 'address not tested' and never claims a verified mailbox", async () => {
    const ok = await verifyContact({ channel: "email", value: "info@grillhouse.ng", ownDomain: "grillhouse.ng", businessName: "Grill House", area: "" }, async () => { throw new Error("no"); });
    expect(ok.state).toBe("unchecked");
    expect(ok.detail).toContain("not tested");
    const bad = await verifyContact({ channel: "email", value: "not-an-email", ownDomain: "", businessName: "X", area: "" }, async () => { throw new Error("no"); });
    expect(bad.state).toBe("wrong_type");
  });
});

describe("duplicate merge (& vs and)", () => {
  it("collapses ampersand and word forms to one key", () => {
    expect(dedupeKey("Mayonex Events & Party Rentals")).toBe(dedupeKey("Mayonex Events and Party Rentals"));
    expect(dedupeKey("Mayonex Events & Party Rentals Ltd")).toBe(dedupeKey("mayonex events party rentals"));
  });
});
