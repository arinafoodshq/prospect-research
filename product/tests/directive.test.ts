/**
 * product/tests/directive.test.ts — spec v0.3 §12.11 research directive
 * (the "504Yard method": quality brief first, then category-batched sweeps
 * with a per-row owner-checkable artifact). Covers: directive parsing with
 * honest degrade, deterministic fallback, prompt integration (brief goal,
 * plan goal, render), legacy-brief hydration, and the artifact cap — a
 * candidate without a prospect-owned source can never qualify.
 */
import { describe, expect, it } from "vitest";
import {
  buildBriefGoal,
  buildPlanGoal,
  decideVerdict,
  ensureDirective,
  renderBriefPrompt,
  validateBrief,
  type CommercialBrief,
  type QualificationDims,
} from "../src/research/commercial";

/** Minimal valid brief in the shape buildBrief must produce. */
function brief(): CommercialBrief {
  return {
    version: 1,
    offer: {
      description: "Live charcoal grilling and event food experience for gatherings",
      geography: "Ikeja, Lagos, Nigeria",
      outcomes: ["memorable food experience", "hassle-free hosting", "aroma and theatre of the grill"],
    },
    primary_segment: {
      label: "Ikeja organisations that host gatherings of 150+",
      industries: ["event venues", "event planning", "corporate offices"],
      geos: ["Ikeja, Lagos, Nigeria"],
      sizes: ["SME to mid-size"],
      use_cases: ["staff parties", "product launches", "community events"],
      inclusions: ["hosts events or gatherings", "has space or a programme drawing crowds"],
      exclusions: ["other caterers", "food vendors"],
    },
    secondary_segments: [],
    pains: [{
      job: "feed 150+ guests without the venue kitchen lifting a finger",
      obstacle: "venue catering is rigid or absent",
      workaround: "external vendors or buffet packs",
      trigger_hints: ["annual dinner", "end-of-year party", "product launch"],
      falsifiable_by: "venue bans outside vendors or has its own banqueting",
    }],
    buyer_roles: [{ role: "events manager", concerns: ["vendor reliability", "guest experience"] }],
    statements: [{ text: "504 serves Ikeja events", provenance: "user_fact" }],
    questions: [],
    assumptions: [],
  };
}

const directive = {
  version: 1 as const,
  categories: [
    { name: "event venues", angle: "hosts the gatherings; external-grill partner angle", buyer_roles: ["venue manager"], artifact: "own website or Google Business Profile", max_queries: 2 },
    { name: "event planning agencies", angle: "build vendor lists for client events", buyer_roles: ["lead planner"], artifact: "Instagram business page", max_queries: 3 },
  ],
};

function dims(over: Partial<QualificationDims> = {}): QualificationDims {
  return { icp_fit: 4, problem: 4, readiness: 4, reachability: 4, confidence: 4, ...over };
}

describe("directive parsing (honest degrade)", () => {
  it("accepts a valid directive and clamps per-category query caps", () => {
    const raw = { ...brief(), directive: { version: 1, categories: directive.categories.map((c) => ({ ...c, max_queries: 9 })) } };
    const parsed = validateBrief(raw);
    expect(parsed.directive).toBeDefined();
    expect(parsed.directive!.categories).toHaveLength(2);
    expect(parsed.directive!.categories.every((c) => c.max_queries === 2)).toBe(true);
  });

  it("drops a malformed directive instead of failing the brief", () => {
    const noArtifact = { ...brief(), directive: { version: 1, categories: [{ name: "venues", angle: "x", buyer_roles: ["mgr"], max_queries: 1 }] } };
    expect(validateBrief(noArtifact).directive).toBeUndefined();
    const tooFew = { ...brief(), directive: { version: 1, categories: [directive.categories[0]] } };
    expect(validateBrief(tooFew).directive).toBeUndefined();
    const badVersion = { ...brief(), directive: { version: 2, categories: directive.categories } };
    expect(validateBrief(badVersion).directive).toBeUndefined();
  });

  it("keeps a legacy brief (no directive) valid", () => {
    expect(validateBrief(brief()).directive).toBeUndefined();
  });
});

describe("deterministic fallback (ensureDirective)", () => {
  it("synthesizes one category per primary industry with the artifact rule", () => {
    const withFallback = ensureDirective(brief());
    expect(withFallback.directive).toBeDefined();
    expect(withFallback.directive!.version).toBe(1);
    expect(withFallback.directive!.categories.map((c) => c.name)).toEqual(
      ["event venues", "event planning", "corporate offices"],
    );
    for (const c of withFallback.directive!.categories) {
      expect(c.buyer_roles).toEqual(["events manager"]);
      expect(c.artifact).toContain("own website");
      expect(c.max_queries).toBe(2);
    }
  });

  it("hydrates a legacy stored brief (JSON round-trip) with the fallback", () => {
    const stored = JSON.parse(JSON.stringify(brief())) as CommercialBrief;
    const hydrated = ensureDirective(validateBrief(stored));
    expect(hydrated.directive!.categories.length).toBeGreaterThanOrEqual(1);
  });

  it("never mutates or replaces a model-proposed directive", () => {
    const withDirective = validateBrief({ ...brief(), directive });
    const ensured = ensureDirective(withDirective);
    expect(ensured.directive).toBe(withDirective.directive);
  });
});

describe("prompt integration", () => {
  it("brief goal asks the model for the directive shape and artifact rule", () => {
    const goal = buildBriefGoal({
      name: "504 Yard Grills & Drinks", website_url: "", description: "live grilling",
      target_market: "event hosts", service_area_note: "Ikeja", constraints_note: "",
    });
    expect(goal).toContain('"directive"');
    expect(goal).toContain("artifact");
    expect(goal).toContain("BUYER organisations");
  });

  it("plan goal sweeps every directive category with its query cap", () => {
    const goal = buildPlanGoal(ensureDirective(brief()));
    expect(goal).toContain("directive category");
    expect(goal).toContain("event venues");
    expect(goal).toContain("event planning");
    expect(goal).toContain("≤2");
  });

  it("plan goal keeps the legacy generic line when no directive exists", () => {
    const goal = buildPlanGoal(brief());
    expect(goal).toContain("at least 4 distinct buyer categories");
  });

  it("plan goal still carries exclusions and marketplace guard with a directive", () => {
    const goal = buildPlanGoal(ensureDirective(brief()));
    expect(goal).toContain("caterers");
    expect(goal).toContain("Jiji");
  });

  it("render carries the directive block with artifacts into every burst", () => {
    const text = renderBriefPrompt(ensureDirective(brief()));
    expect(text).toContain("Research directive");
    expect(text).toContain("event venues");
    expect(text).toContain("verify via");
    expect(renderBriefPrompt(brief())).not.toContain("Research directive");
  });
});

describe("artifact cap (never qualified without a prospect-owned source)", () => {
  const hard = { ok: true as const };

  it("all-5 dims but no owned source -> needs_research, never qualified", () => {
    const d = dims({ icp_fit: 5, problem: 5, readiness: 5, reachability: 5, confidence: 5 });
    const v = decideVerdict(d, hard, false);
    expect(v.verdict).not.toBe("qualified");
    expect(v.verdict).toBe("needs_research");
  });

  it("owned source + all bars met -> qualified (sanity)", () => {
    const v = decideVerdict(dims(), hard, true);
    expect(v.verdict).toBe("qualified");
  });
});
