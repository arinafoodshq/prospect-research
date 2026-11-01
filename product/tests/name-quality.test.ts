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
