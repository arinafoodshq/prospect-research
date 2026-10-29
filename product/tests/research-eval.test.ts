/**
 * product/tests/research-eval.test.ts — research-intelligence acceptance suite.
 * Deterministic guardrails for the P0 upgrade: brief contract, prompt
 * segment-adherence, hard constraints, verdict thresholds, name/dedupe
 * quality, draft claim audit. Fixtures come from the failed TechAssembly
 * live run (run_d3f68cbd). No network, no model calls.
 */
import { describe, expect, it } from "vitest";
import {
  buildBriefGoal,
  buildPlanGoal,
  buildSearchGoal,
  checkHardConstraints,
  decideVerdict,
  extractContacts,
  icpFromBrief,
  isGroundedContact,
  renderBriefPrompt,
  validateBrief,
  type CommercialBrief,
} from "../src/research/commercial";
import { cleanBusinessName, isPlausibleName } from "../src/meta";
import { dedupeKey, dedupeLookupKeys, sanitizeText } from "../src/db";

/** Retail/logistics beachhead brief in the shape buildBrief must produce. */
function retailBrief(): CommercialBrief {
  return {
    version: 1,
    offer: {
      description: "Business operations system for Nigerian SMEs: orders, stock, payments and approvals, with WhatsApp automation.",
      geography: "Lagos, Nigeria",
      outcomes: ["fewer lost orders", "stock counts that match", "recorded payments"],
    },
    primary_segment: {
      label: "Lagos retail shops and logistics operators (5-200 staff)",
      industries: ["retail", "logistics"],
      geos: ["Lagos", "Nigeria"],
      sizes: ["5-200 staff", "1-10 branches"],
      use_cases: ["WhatsApp order taking", "stock tracking", "dispatch"],
      inclusions: ["takes orders over WhatsApp", "holds physical stock", "runs deliveries"],
      exclusions: ["schools", "clinics", "hospitals", "universities", "coworking spaces", "enterprises"],
    },
    secondary_segments: [],
    pains: [{
      job: "fulfill customer orders without losing track",
      obstacle: "orders, stock and payments live across chats and notebooks",
      workaround: "WhatsApp + spreadsheets + memory",
      trigger_hints: ["new branch", "hiring dispatch riders", "customer complaints about delays"],
      falsifiable_by: "business already runs an ERP or has no physical fulfillment",
    }],
    buyer_roles: [{ role: "founder / operations manager", concerns: ["cost", "staff learning curve"] }],
    statements: [
      { text: "TechAssembly serves Nigerian SMEs", provenance: "user_fact" },
      { text: "Retailers in Lagos take orders over WhatsApp", provenance: "hypothesis" },
    ],
    questions: [],
    assumptions: ["buyer speaks English", "business has reliable smartphones"],
  };
}

describe("commercial brief contract", () => {
  it("accepts a well-formed brief and stamps version 1", () => {
    expect(validateBrief(retailBrief()).version).toBe(1);
  });

  it("rejects missing primary segment, bad provenance, and >3 questions", () => {
    const noSeg = { ...retailBrief(), primary_segment: undefined };
    expect(() => validateBrief(noSeg)).toThrow();
    const badProv = retailBrief();
    badProv.statements = [{ text: "x", provenance: "vibes" } as never];
    expect(() => validateBrief(badProv)).toThrow();
    const manyQ = retailBrief();
    manyQ.questions = ["a", "b", "c", "d"];
    expect(() => validateBrief(manyQ)).toThrow(/questions/);
  });

  it("derives hard inclusions/exclusions from the brief", () => {
    const icp = icpFromBrief(retailBrief());
    expect(icp.version).toBe(1);
    expect(icp.hard_inclusions.industries).toEqual(["retail", "logistics"]);
    expect(icp.hard_exclusions.industries).toContain("schools");
    expect(icp.hard_exclusions.industries).toContain("hospitals");
  });

  it("renders a prompt block carrying segment, pains, and exclusions", () => {
    const text = renderBriefPrompt(retailBrief());
    expect(text).toContain("retail");
    expect(text).toContain("logistics");
    expect(text).toContain("schools");
    expect(text).toContain("WhatsApp");
    expect(text).not.toContain("offices, schools, clinics, hubs, venues");
  });
});

describe("prompt segment adherence (retail brief must not drift)", () => {
  it("plan goal names the segment and exclusions, never a hardcoded vertical", () => {
    const goal = buildPlanGoal(retailBrief());
    expect(goal).toContain("retail");
    expect(goal).toContain("logistics");
    expect(goal).toContain("Lagos");
    expect(goal).toContain("schools");
    expect(goal).not.toContain("offices, schools, clinics, hubs, venues");
    expect(goal).not.toContain("caterers");
  });

  it("plan goal steers queries to business profiles, not marketplace listings", () => {
    const goal = buildPlanGoal(retailBrief());
    expect(goal).toContain("marketplace");
    expect(goal).toContain("Jiji");
  });

  it("brief goal demands explicit adjacent-vertical exclusions (catering: gate owns exclusions only)", () => {
    const goal = buildBriefGoal({
      name: "TechAssembly", website_url: "", description: "ops system",
      target_market: "retail", service_area_note: "Lagos", constraints_note: "",
    });
    expect(goal).toContain("TechAssembly");
    expect(goal).toContain("adjacent");
    expect(goal).toContain("exclusions");
  });

  it("search goal preserves segment, geography, and exclusions per query", () => {
    const goal = buildSearchGoal(retailBrief(), "retail shops with branches in Ikeja");
    expect(goal).toContain("retail");
    expect(goal).toContain("Ikeja");
    expect(goal).toContain("Never list");
    expect(goal).toContain("schools");
    expect(goal).not.toContain("offices, schools, clinics, hubs, venues");
  });
});

describe("hard-constraint gate", () => {
  it("rejects an excluded industry even with a confident name match", () => {
    const icp = icpFromBrief(retailBrief());
    const r = checkHardConstraints(icp, { name: "Greensprings School", category: "Education", location: { city: "Lagos" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("excluded");
  });

  it("accepts an in-segment Lagos business", () => {
    const icp = icpFromBrief(retailBrief());
    expect(checkHardConstraints(icp, {
      name: "Brightline Retail", category: "Retail", location: { city: "Lagos" },
    })).toEqual({ ok: true });
  });

  it("matches segment synonyms (a grocery store IS retail)", () => {
    const icp = icpFromBrief(retailBrief());
    expect(checkHardConstraints(icp, {
      name: "AgroGroom Enterprise", category: "Grocery Store", location: { city: "Lagos" },
    })).toEqual({ ok: true });
    expect(checkHardConstraints(icp, {
      name: "Fabrics by Jadesh", category: "Fabric Store", location: { city: "Lagos" },
    })).toEqual({ ok: true });
    expect(checkHardConstraints(icp, {
      name: "Swift Riders", category: "Dispatch", location: { city: "Lagos" },
    })).toEqual({ ok: true });
  });

  it("passes unclassified/unknown rather than guessing (evidence rules decide later)", () => {
    const icp = icpFromBrief(retailBrief());
    expect(checkHardConstraints(icp, { name: "Venia Business Hub", category: "unclassified", location: {} }).ok).toBe(true);
  });

  it("enforces the stored brief exclusions without nuking the home market", () => {
    const brief = retailBrief();
    // Exact exclusions Meta stored on run_724, which wrongly rejected 18/25.
    brief.primary_segment.exclusions = [
      "Large enterprises and supermarket chains",
      "Banks, fintechs and government agencies",
      "Software and IT services companies",
      "Businesses outside Nigeria with no Lagos operations",
    ];
    const icp = icpFromBrief(brief);
    const lagos = { city: "Lagos", country: "Nigeria" };
    // In-segment prospects pass.
    expect(checkHardConstraints(icp, {
      name: "Adaeze Fashion Store", category: "Fashion retail", location: lagos,
    })).toEqual({ ok: true });
    expect(checkHardConstraints(icp, {
      name: "Swift Dispatch Ltd", category: "Logistics", location: lagos,
    })).toEqual({ ok: true });
    // Genuine exclusion hits are rejected.
    expect(checkHardConstraints(icp, {
      name: "Sterling Bank", category: "Bank", location: lagos,
    }).ok).toBe(false);
    expect(checkHardConstraints(icp, {
      name: "Shoprite Ikeja", category: "Supermarket", location: lagos,
    }).ok).toBe(false);
    expect(checkHardConstraints(icp, {
      name: "Softcom IT Services", category: "Software", location: lagos,
    }).ok).toBe(false);
    // Industry fit is model-judged (icp_fit), NOT gated: a school passes
    // here and dies in assess (proven live: drift scores icp_fit 1). The
    // gate owns only explicit exclusions + geography.
    expect(checkHardConstraints(icp, {
      name: "Greenfield Schools", category: "School", location: lagos,
    })).toEqual({ ok: true });
    // Catering-eval regression: "Legal Services" must not be rejected
    // against a "Professional Services" segment (model knows the hyponym).
    const officeIcp = icpFromBrief({
      ...brief,
      primary_segment: {
        ...brief.primary_segment,
        industries: ["Professional Services", "Financial Services"],
      },
    });
    expect(checkHardConstraints(officeIcp, {
      name: "Jacobs and Bigaels", category: "Legal Services", location: lagos,
    })).toEqual({ ok: true });
    // Substring lookalikes are NOT exclusions.
    expect(checkHardConstraints(icp, {
      name: "Riverbank Fashion", category: "Fashion retail", location: lagos,
    })).toEqual({ ok: true });
  });

  it("rejects an out-of-geography prospect when geography is known", () => {
    const icp = icpFromBrief(retailBrief());
    const r = checkHardConstraints(icp, { name: "Accra Mega Mart", category: "Retail", location: { city: "Accra", country: "Ghana" } });
    expect(r.ok).toBe(false);
  });
});

describe("verdict thresholds", () => {
  const good = { icp_fit: 4, problem: 4, readiness: 3, reachability: 3, confidence: 4 } as const;

  it("disqualifies on hard violation no matter the scores", () => {
    const v = decideVerdict({ ...good }, { ok: false, reason: "excluded industry" }, true);
    expect(v.verdict).toBe("disqualified");
    expect(v.fit_rating).toBeLessThanOrEqual(2);
  });

  it("never qualifies fit below threshold", () => {
    const v = decideVerdict({ ...good, icp_fit: 2 }, { ok: true }, true);
    expect(v.verdict).toBe("disqualified");
  });

  it("needs research without prospect-owned evidence", () => {
    expect(decideVerdict({ ...good }, { ok: true }, false).verdict).toBe("needs_research");
  });

  it("reports no_signal when fit is fine but no trigger exists", () => {
    expect(decideVerdict({ ...good, readiness: 1 }, { ok: true }, true).verdict).toBe("no_signal");
  });

  it("never qualifies a score below 3, even with fit and signal", () => {
    // Live failure: icp 3 + confidence 2 qualified with fit_rating 2.
    const v = decideVerdict({ icp_fit: 3, problem: 3, readiness: 2, reachability: 2, confidence: 2 }, { ok: true }, true);
    expect(v.verdict).toBe("needs_research");
    expect(v.fit_rating).toBe(2);
  });

  it("qualifies only when fit, evidence, and signal all hold", () => {
    const v = decideVerdict({ ...good }, { ok: true }, true);
    expect(v.verdict).toBe("qualified");
    expect(v.fit_rating).toBeGreaterThanOrEqual(3);
  });

  it("sends unclear pain with good fit to manual review", () => {
    expect(decideVerdict({ ...good, problem: 1 }, { ok: true }, true).verdict).toBe("manual_review");
  });
});

describe("business-name guards (live-run junk fixtures)", () => {
  const junk = [
    "Reddington dabbles into bodycare plastic surgery",
    "dr reddington patient portal",
    "Lagos Archives",
    "Venia Business Hub-Overview, Competitors & Contact Info",
    "List Of Private educational institutions",
    "IUI Archives",
    "Coworking in Lagos, Nigeria: Turnkey Office Rental",
    "Ade Bakare opens new boutique",
    "City Distro Wants to Digitise Africa's FMCG Distribution",
    "Fashion Boutique Men's Straight Jeans",
    // run_99840398 junk (comparison run 2): property listings, guide pages,
    // social-post titles, photo/category leftovers.
    "Shops for Rent",
    "Shops for Sale",
    "Shops for Sale in Ikota",
    "Clothing stores",
    "Lekki: Emerging commercial hub",
    "GIFT ORDER 🎁",
    "Avoid shopping stress with these online grocery platforms",
    "Didi Fashion for exclusive fashion wear (photos)",
    "Clothing (Brands)",
    // run_5538b2b3 junk (comparison run 3): directory-coined names, hashtag soup.
    "Top Verified Boutique",
    "Luxury Fashion Boutique",
    "#aralinelogistics #businessgrowth #ecommercenigeria #lagosbusiness",
    // run_de5e566e junk (comparison run 4): promos, directions, policy pages,
    // locator labels, profile pages, platform-handle titles.
    "Get 10% Off Plus Free Delivery Anywhere",
    "Driving directions to Blenco Supermarket",
    "Privacy Policy",
    "Storelocator",
    "Konga Group Company Profile",
    "Fkols's Profile",
    "TikTok · Ogunmola Tobibackup",
    // run_b0675e86 junk (comparison run 5): SKU titles, imperative
    // headlines, platform leftovers, contact pages.
    "DAY LEWIS PHARMACY GLUCOSAMINE SULPHATE 750MG X 30",
    "Buy Medicines, Vitamins & Supplements Online",
    "- YouTube",
    "Contact Us | Bismid Cosmetics",
    // run_9c3a8111 junk (comparison run 6): expansion headlines, software
    // spam, FAQ pages, generic category labels.
    "Supermart.ng widens Nigeria coverage",
    "Supermart Online Groceries 2.0 Free Download",
    "FAQs",
    "Frequently Asked Questions",
    "Food Retailers",
    // run_ac026b81 junk (catering eval): numbered listicles, category
    // labels, meta patterns (types/about/full-list), property leftovers.
    "The 10 best Employer Lawyers & Law Firms",
    "10 best schools in Lagos",
    "LAW FIRMS IN LAGOS STATE",
    "COMMERCIAL LAW FIRMS",
    "The Law Firm",
    "Search Law Firms & Legal Services Companies",
    "Training providers in Ikeja, Lagos State",
    "Types of hr jobs",
    "About OPay Digital Services Limited (OPay Wallet)",
    "Full list of Opay Offices",
    "Luxury 4 Bedroom Terrace Duplex",
    "Detached Duplexes",
    // run_c5d01d96 junk (comparison run 7): about/contact/where-buy pages,
    // haul videos, supplier titles, FAQ labels, story headlines.
    "About KIKKI CLOTHING",
    "Contact Shopkyluxury Fashion Stores",
    "Where To Buy Iphone 17 Series",
    "MY MAKEUP HAUL FROM PARIS PURPLE BEAUTY",
    "Wigmore Trading: Fashion and Beauty Accessories Suppliers",
    "SLOT Nigeria FAQ",
    "Slot introduces Electronics Sales",
    "All Slot Systems Offices",
    "Obiwezy: From Computer Village to an accelerator",
  ];
  for (const name of junk) {
    it(`rejects ${JSON.stringify(name)}`, () => {
      expect(isPlausibleName(name)).toBe(false);
    });
  }

  it("strips year-paren listing cruft so the residue can validate", () => {
    expect(cleanBusinessName("Teph-store, Ikeja Lagos, Lagos (2026)")).toBe("Teph-store");
    expect(isPlausibleName("Teph-store, Ikeja Lagos, Lagos (2026)")).toBe(true);
  });

  it("strips street addresses so variants dedupe (Bismid x2)", () => {
    expect(cleanBusinessName("Bismid Cosmetics Ltd, 32 Randle Avenue Off Akerele")).toBe("Bismid Cosmetics Ltd");
    expect(cleanBusinessName("7Up Bottling Company")).toBe("7Up Bottling Company");
    expect(cleanBusinessName("24 Pharmacy")).toBe("24 Pharmacy");
  });

  it("strips flag emoji (common in legit Lagos vendor names) but rejects pictographs", () => {
    expect(cleanBusinessName("Walexfabrics Lagos 🇳🇬")).toBe("Walexfabrics");
    expect(isPlausibleName("Walexfabrics Lagos 🇳🇬")).toBe(true);
    expect(isPlausibleName("GIFT ORDER 🎁")).toBe(false);
  });

  const real = ["Greensprings School", "Venia Business Hub", "Brightline Logistics", "Hygei Clinics", "Ashluxury", "Teph-store", "Supermart.ng", "Fabrics by Jadesh", "Nomad Logistic Solutions", "Julix Fashion Store", "Style Lagos Boutique", "Blenco Supermarket", "Medplus Pharmacy", "SalsBest Cosmetics", "AgroGroom Enterprise", "Shalom Anziko mini mart", "Maucare Pharmacy", "Walexfabrics", "The Flair Store", "Jacobs and Bigaels Legal Practitioners", "Tope Adebayo LP", "First City Monument Bank", "NAYZER Consulting", "Haul Logistics", "All Saints", "About You", "The Vault NG Boutique", "Obiwezy Experience Center (Ikeja Computer Village)"];
  for (const name of real) {
    it(`keeps ${JSON.stringify(name)}`, () => {
      expect(isPlausibleName(name)).toBe(true);
    });
  }
});

describe("deterministic dedupe", () => {
  it("looks up the same business by full key and name-only fallback", () => {
    expect(dedupeLookupKeys("Venia Business Hub", "venia.ng")).toEqual([
      dedupeKey("Venia Business Hub", "venia.ng"),
      dedupeKey("Venia Business Hub"),
    ]);
  });

  it("keeps distinct businesses apart", () => {
    expect(dedupeKey("Venia Business Hub")).not.toBe(dedupeKey("Cranium One"));
  });
});

describe("contact extraction + grounding", () => {
  it("extracts emails and phones deterministically", () => {
    const found = extractContacts("Call us on 0803 123 4567 or mail hello@example.ng today.");
    expect(found).toContainEqual({ channel: "email", value: "hello@example.ng" });
    expect(found).toContainEqual({ channel: "phone", value: "08031234567" });
  });

  it("skips short digit runs", () => {
    expect(extractContacts("open 24 hours, est. 1999")).toEqual([]);
  });

  it("rejects date fragments as phones (run_99840398 contact bug)", () => {
    expect(extractContacts("posted 20261028, updated 20260906, ref 01232025")).toEqual([]);
    expect(extractContacts("dated 19981231 in the footer")).toEqual([]);
  });

  it("keeps real Nigerian mobile and landline forms", () => {
    const found = extractContacts("call +2348056453934 or 0803 123 4567, landline 012345678");
    expect(found).toContainEqual({ channel: "phone", value: "+2348056453934" });
    expect(found).toContainEqual({ channel: "phone", value: "08031234567" });
    expect(found).toContainEqual({ channel: "phone", value: "012345678" });
  });

  it("grounds emails case-insensitively", () => {
    expect(isGroundedContact("Hello@Example.ng", ["mail hello@example.ng"])).toBe(true);
    expect(isGroundedContact("made@up.ng", ["mail hello@example.ng"])).toBe(false);
  });

  it("tolerates 0-prefix vs +234-prefix phone forms", () => {
    expect(isGroundedContact("+2348031234567", ["call 0803 123 4567"])).toBe(true);
    expect(isGroundedContact("08031234567", ["tel: +234 803 123 4567"])).toBe(true);
    expect(isGroundedContact("08000000000", ["call 0803 123 4567"])).toBe(false);
  });

  it("rejects empty values", () => {
    expect(isGroundedContact("  ", ["anything"])).toBe(false);
  });
});

describe("text sanitation", () => {
  it("strips controls, replacement chars, and lone surrogates", () => {
    expect(sanitizeText("Lagos Cha�nnel")).toBe("Lagos Channel");
    expect(sanitizeText("a b�c")).toBe("abc");
    expect(sanitizeText("  ok  ")).toBe("ok");
    expect(sanitizeText("caf\u00e9 \u4e2d\u6587")).toBe("caf\u00e9 \u4e2d\u6587");
  });
});
