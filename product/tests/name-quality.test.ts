/**
 * product/tests/name-quality.test.ts — the candidate name-quality gate
 * (audit 2026-11-01: run_26e1b058 kept 0 because discovery shipped website
 * section headings and ranking roundups as business names). Pins the
 * patterns that now reject them, plus the plan goal's entity-bias rules.
 */
import { describe, expect, it } from "vitest";
import { isPlausibleName } from "../src/meta";
import { buildPlanGoal, validateBrief, ensureDirective, type CommercialBrief } from "../src/research/commercial";

function brief(): CommercialBrief {
  return ensureDirective(validateBrief({
    version: 1,
    offer: { description: "Live charcoal grilling for events", geography: "Ikeja, Lagos, Nigeria", outcomes: ["x", "y", "z"] },
    primary_segment: {
      label: "Ikeja gathering hosts",
      industries: ["event venues", "event planning"],
      geos: ["Ikeja, Lagos, Nigeria"],
      sizes: ["SME"],
      use_cases: ["staff parties"],
      inclusions: ["hosts events"],
      exclusions: ["other caterers", "food vendors"],
    },
    secondary_segments: [],
    pains: [{ job: "feed 150 guests", obstacle: "rigid venue catering", trigger_hints: ["annual dinner"], falsifiable_by: "in-house banqueting" }],
    buyer_roles: [{ role: "events manager", concerns: ["reliability"] }],
    statements: [{ text: "serves Ikeja", provenance: "user_fact" }],
    questions: [],
    assumptions: [],
  }));
}

describe("name-quality gate: page-heading names never become candidates", () => {
  it("rejects 'Our ...' website section headings", () => {
    for (const bad of ["Our Services", "Our Events Gallery", "Our contact details", "Our Products", "Our Team"]) {
      expect(isPlausibleName(bad)).toBe(false);
    }
  });

  it("rejects numberless 'Top <category>' roundups", () => {
    for (const bad of ["Top Event Management Companies", "The Top Wedding Planners in Lagos", "Top Corporate Catering Services"]) {
      expect(isPlausibleName(bad)).toBe(false);
    }
  });

  it("rejects staffing-demand and office-move headlines", () => {
    for (const bad of ["More teachers needed in Lagos public schools", "Africa Internet Group moves office to", "Hypercity Nigeria hiring Admin Manager", "Tech firm relocating to Ikeja"]) {
      expect(isPlausibleName(bad)).toBe(false);
    }
  });

  it("rejects the real junk from run_71a74ac3 (maryodidi2 recording run)", () => {
    // Bare all-caps generic trade words are category labels, not brands.
    expect(isPlausibleName("HOTELS")).toBe(false);
    expect(isPlausibleName("INDEPENDENT")).toBe(false);
    // Meeting/notice documents are announcements, never organisations.
    expect(isPlausibleName("NOTICE OF ANNUAL GENERAL MEETING")).toBe(false);
    // File artefacts ("...AR & ACCTS.cdr") are downloads, not businesses.
    expect(isPlausibleName("Ikeja Hotels 2025 AR & ACCTS.cdr")).toBe(false);
    // Editorial openers are article sentences, not names.
    expect(isPlausibleName("How We Uplifted The Standards Of IKEJA Club")).toBe(false);
    expect(isPlausibleName("Again, COWA Ignites Fire of Hope")).toBe(false);
  });

  it("keeps real brands that the new rules must not reject", () => {
    expect(isPlausibleName("NECA Event Centre")).toBe(true); // acronym brand, not a bare generic
    expect(isPlausibleName("504 Yard Grills & Drinks")).toBe(true);
    expect(isPlausibleName("Ikeja Club")).toBe(true);
    expect(isPlausibleName("The Alcove Events Studios")).toBe(true);
  });

  it("rejects directory tails and domains inside names", () => {
    expect(isPlausibleName("Araromi Youth Development Centre Lagos. « HEYPLACES.COM.NG")).toBe(false);
    expect(isPlausibleName("GlowMart Beauty www.glowmart.ng")).toBe(false);
    expect(isPlausibleName("Supermart.ng")).toBe(true); // brand+tld, not a tail
  });

  it("keeps real businesses that merely start with Top or Our", () => {
    expect(isPlausibleName("Topmark Services")).toBe(true);
    expect(isPlausibleName("Ours Glazing Works")).toBe(true);
  });

  it("rejects gallery/careers page-type words in names", () => {
    expect(isPlausibleName("Balmoral Gallery")).toBe(false);
    expect(isPlausibleName("StackHR Careers")).toBe(false);
  });

  it("still accepts ordinary business names", () => {
    for (const good of ["GlowMart Beauty", "Choice Cleaners", "Little Steps Academy", "Balmoral Convention Centre"]) {
      expect(isPlausibleName(good)).toBe(true);
    }
  });
});

describe("plan goal: entity-biased queries, no scrape shapes", () => {
  it("forbids careers/jobs words and directory-scrape query shapes", () => {
    const goal = buildPlanGoal(brief());
    expect(goal).toContain("Never put careers, jobs, vacancies");
    expect(goal).toContain("official site");
  });

  it("keeps the ecosystem and exclusion rules", () => {
    const goal = buildPlanGoal(brief());
    expect(goal).toContain("ecosystem researcher");
    expect(goal).toContain("caterers");
    expect(goal).toContain("Jiji");
  });
});
