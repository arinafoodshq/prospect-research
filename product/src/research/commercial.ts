/**
 * product/src/research/commercial.ts — commercial brief + ICP contract.
 * The brief is built once per run (model proposes, code validates) and stored
 * versioned on the run; every later phase derives its constraints from it.
 * Hard constraints and verdict thresholds are deterministic: no score can
 * override them. No `cloudflare:workers` imports (plain vitest/node).
 */

export type Provenance = "user_fact" | "source_verified" | "inference" | "hypothesis" | "unknown";

const PROVENANCE: Provenance[] = ["user_fact", "source_verified", "inference", "hypothesis", "unknown"];

export interface BriefSegment {
  label: string;
  industries: string[];
  geos: string[];
  sizes: string[];
  use_cases: string[];
  inclusions: string[];
  exclusions: string[];
}

export interface PainModel {
  job: string;
  obstacle: string;
  workaround?: string;
  trigger_hints: string[];
  falsifiable_by: string;
}

export interface BuyerRole {
  role: string;
  concerns: string[];
}

export interface BriefStatement {
  text: string;
  provenance: Provenance;
}

export interface CommercialBrief {
  version: 1;
  offer: { description: string; geography: string; outcomes: string[] };
  primary_segment: BriefSegment;
  secondary_segments: Array<{ label: string; why_experiment: string }>;
  pains: PainModel[];
  buyer_roles: BuyerRole[];
  statements: BriefStatement[];
  /** At most 3 blocking questions; empty means proceed on stated assumptions. */
  questions: string[];
  assumptions: string[];
}

export interface ICPContract {
  version: 1;
  hard_inclusions: { industries: string[]; geos: string[] };
  hard_exclusions: { industries: string[] };
  preferred: string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function strList(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== "string" || item.trim() === "") return null;
    out.push(item.trim());
  }
  return out;
}

function nonEmpty(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/** Validate a model-proposed brief; throws on any contract violation. */
export function validateBrief(raw: unknown): CommercialBrief {
  if (!isRecord(raw)) throw new Error("brief must be an object");
  if (raw["version"] !== 1) throw new Error("brief version must be 1");
  const offer = isRecord(raw["offer"]) ? raw["offer"] : null;
  const description = offer ? nonEmpty(offer["description"]) : null;
  const geography = offer ? nonEmpty(offer["geography"]) : null;
  const outcomes = offer ? strList(offer["outcomes"]) : null;
  if (!description || !geography || !outcomes) throw new Error("brief.offer needs description, geography, outcomes[]");
  const seg = isRecord(raw["primary_segment"]) ? raw["primary_segment"] : null;
  const label = seg ? nonEmpty(seg["label"]) : null;
  const industries = seg ? strList(seg["industries"]) : null;
  const geos = seg ? strList(seg["geos"]) : null;
  const sizes = seg ? strList(seg["sizes"]) : null;
  const useCases = seg ? strList(seg["use_cases"]) : null;
  const inclusions = seg ? strList(seg["inclusions"]) : null;
  const exclusions = seg ? strList(seg["exclusions"]) : null;
  if (!seg || !label || !industries || industries.length === 0 || !geos || geos.length === 0 ||
    !sizes || !useCases || !inclusions || !exclusions) {
    throw new Error("brief.primary_segment needs label, industries[], geos[], sizes[], use_cases[], inclusions[], exclusions[]");
  }
  const secondary: CommercialBrief["secondary_segments"] = [];
  if (raw["secondary_segments"] !== undefined) {
    if (!Array.isArray(raw["secondary_segments"])) throw new Error("brief.secondary_segments must be an array");
    for (const s of raw["secondary_segments"]) {
      const l = isRecord(s) ? nonEmpty(s["label"]) : null;
      const w = isRecord(s) ? nonEmpty(s["why_experiment"]) : null;
      if (!l || !w) throw new Error("secondary segments need label + why_experiment");
      secondary.push({ label: l, why_experiment: w });
    }
  }
  if (!Array.isArray(raw["pains"]) || raw["pains"].length === 0) throw new Error("brief.pains needs at least one pain model");
  const pains: PainModel[] = [];
  for (const p of raw["pains"]) {
    const job = isRecord(p) ? nonEmpty(p["job"]) : null;
    const obstacle = isRecord(p) ? nonEmpty(p["obstacle"]) : null;
    const triggers = isRecord(p) ? strList(p["trigger_hints"]) : null;
    const fals = isRecord(p) ? nonEmpty(p["falsifiable_by"]) : null;
    if (!job || !obstacle || !triggers || !fals) throw new Error("each pain needs job, obstacle, trigger_hints[], falsifiable_by");
    pains.push({
      job, obstacle, ...(isRecord(p) && typeof p["workaround"] === "string" && p["workaround"].trim() !== ""
        ? { workaround: (p["workaround"] as string).trim() } : {}),
      trigger_hints: triggers, falsifiable_by: fals,
    });
  }
  if (!Array.isArray(raw["buyer_roles"]) || raw["buyer_roles"].length === 0) {
    throw new Error("brief.buyer_roles needs at least one role");
  }
  const buyerRoles: BuyerRole[] = [];
  for (const b of raw["buyer_roles"]) {
    const role = isRecord(b) ? nonEmpty(b["role"]) : null;
    const concerns = isRecord(b) ? strList(b["concerns"]) : null;
    if (!role || !concerns) throw new Error("each buyer role needs role + concerns[]");
    buyerRoles.push({ role, concerns });
  }
  if (!Array.isArray(raw["statements"])) throw new Error("brief.statements must be an array");
  const statements: BriefStatement[] = [];
  for (const s of raw["statements"]) {
    const text = isRecord(s) ? nonEmpty(s["text"]) : null;
    const prov = isRecord(s) ? s["provenance"] : null;
    if (!text || typeof prov !== "string" || !PROVENANCE.includes(prov as Provenance)) {
      throw new Error("each statement needs text + valid provenance");
    }
    statements.push({ text, provenance: prov as Provenance });
  }
  const questions = strList(raw["questions"] ?? []);
  if (questions === null) throw new Error("brief.questions must be a string array");
  if (questions.length > 3) throw new Error("brief.questions allows at most 3 blocking questions");
  const assumptions = strList(raw["assumptions"] ?? []);
  if (assumptions === null) throw new Error("brief.assumptions must be a string array");
  return {
    version: 1,
    offer: { description, geography, outcomes },
    primary_segment: {
      label, industries, geos, sizes, use_cases: useCases, inclusions, exclusions,
    },
    secondary_segments: secondary,
    pains, buyer_roles: buyerRoles, statements, questions, assumptions,
  };
}

/** Derive the machine-enforceable contract: hard inclusions/exclusions only. */
export function icpFromBrief(b: CommercialBrief): ICPContract {
  return {
    version: 1,
    hard_inclusions: { industries: [...b.primary_segment.industries], geos: [...b.primary_segment.geos] },
    hard_exclusions: { industries: [...b.primary_segment.exclusions] },
    preferred: [...b.primary_segment.inclusions],
  };
}

/** Deterministic prompt block: every reasoning burst sees the same constraints. */
export function renderBriefPrompt(b: CommercialBrief): string {
  const seg = b.primary_segment;
  const lines = [
    `Offer: ${b.offer.description} (serves ${b.offer.geography}).`,
    `Primary segment: ${seg.label}.`,
    `Target industries: ${seg.industries.join(", ")}.`,
    `Geography: ${seg.geos.join(", ")}.`,
    `In scope when: ${seg.inclusions.join("; ")}.`,
    `NEVER target (hard exclusions): ${seg.exclusions.join(", ")}.`,
    `Customer pains: ${b.pains.map((p) => `${p.job} / blocked by ${p.obstacle}${p.workaround ? ` / today: ${p.workaround}` : ""}`).join(" | ")}.`,
    `Buyers: ${b.buyer_roles.map((r) => r.role).join(", ")}.`,
  ];
  if (b.secondary_segments.length > 0) {
    lines.push(`Exploratory only (label separately, never mix): ${b.secondary_segments.map((s) => s.label).join(", ")}.`);
  }
  if (b.assumptions.length > 0) lines.push(`Provisional assumptions: ${b.assumptions.join("; ")}.`);
  return lines.join("\n");
}

/** Lowercase alnum + light plural stemming so "schools" matches "school". */
function stem(word: string): string {
  if (/ies$/.test(word) && word.length > 4) return word.slice(0, -3) + "y";
  if (/([^s])s$/.test(word)) return word.slice(0, -1);
  return word;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/)
    .filter((w) => w !== "").map(stem).join(" ");
}

/**
 * Segment synonym groups: a grocery store IS retail even though neither word
 * contains the other. Terms are stemmed at load to match norm() output.
 */
const SEGMENT_SYNONYMS: Array<{ group: string; terms: string[] }> = [
  { group: "retail", terms: ["retail", "retailer", "retailing", "store", "shop", "mart", "market", "supermarket", "boutique", "grocery", "groceries", "plaza", "mall", "outlet", "kiosk", "stall", "provisions", "provision", "fashion", "clothing", "wears", "fabrics", "fabric", "bookshop"] },
  { group: "logistics", terms: ["logistics", "logistic", "delivery", "deliveries", "dispatch", "courier", "freight", "haulage", "warehouse", "warehousing", "fulfilment", "fulfillment", "cargo", "shipping", "transport", "transportation", "distribution", "distributor", "distro", "mover", "rider", "trucking", "clearing", "forwarding"] },
];
const STEMMED_GROUPS = SEGMENT_SYNONYMS.map((g) => ({ group: g.group, terms: g.terms.map(stem) }));

function groupOf(word: string): string | null {
  for (const g of STEMMED_GROUPS) {
    if (g.terms.includes(word)) return g.group;
  }
  return null;
}

/** Fuzzy term hit: substring either way, or same synonym group. */
function termHit(haystack: string, needle: string): boolean {
  const h = norm(haystack);
  const n = norm(needle);
  if (!h || !n) return false;
  if (h.includes(n) || n.includes(h)) return true;
  for (const a of h.split(" ")) {
    for (const b of n.split(" ")) {
      const ga = groupOf(a);
      if (ga && ga === groupOf(b)) return true;
    }
  }
  return false;
}

/**
 * Exclusion word hit: whole-word equality on stemmed text only. No synonym
 * groups and no substring matching — a "retail" shop must not match a
 * "supermarket" exclusion, and "Riverbank Suites" must not match "bank".
 */
function wordHit(hay: string, word: string): boolean {
  if (!word) return false;
  return norm(hay).split(" ").some((a) => a === word);
}

/**
 * Words too generic to ever exclude on (size words, fillers, geo
 * prepositions). Matched against raw words before stemming.
 */
const EXCLUSION_STOP = new Set([
  "and", "the", "for", "with", "from", "that", "which", "without", "with",
  "outside", "inside", "within", "across", "around", "between",
  "large", "small", "major", "other", "no",
  "business", "businesses", "operation", "operations",
  "company", "companies", "enterprise", "enterprises", "corporate",
  "firm", "firms", "organization", "organisation",
]);

/**
 * Split a brief exclusion phrase ("Banks, fintechs and government agencies")
 * into OR-chunks of significant stemmed words. Geo words are filtered by the
 * caller against the inclusion geos (a Nigeria mention must not nuke Lagos
 * prospects).
 */
function exclusionChunks(ex: string): string[][] {
  return ex.split(/,|\band\b/i)
    .map((chunk) => chunk.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/)
      .filter((w) => w.length > 3 && !EXCLUSION_STOP.has(w))
      .map(stem))
    .filter((ws) => ws.length > 0);
}

export interface ProspectIdentity {
  name: string;
  category: string;
  location: Record<string, string>;
}

/** Legal-form suffixes stripped before exclusion matching ("X Enterprise" is not an enterprise account). */
const NAME_SUFFIXES = new Set([
  "enterprise", "enterprises", "ltd", "limited", "inc", "llc", "plc",
  "co", "company", "companies", "group", "groups", "venture", "ventures",
  "holding", "holdings",
]);

function stripSuffixes(name: string): string {
  return norm(name).split(" ").filter((w) => !NAME_SUFFIXES.has(w)).join(" ");
}

/**
 * Deterministic hard-constraint gate. Exclusions always enforced; inclusions
 * enforced only when the prospect field is present and specific — unknown or
 * "unclassified" passes here and is decided by evidence rules downstream.
 */
export function checkHardConstraints(
  icp: ICPContract, p: ProspectIdentity,
): { ok: true } | { ok: false; reason: string } {
  // Exclusions match on name/category only (never location: geo words inside
  // exclusion phrases must not reject the home market; geography is enforced
  // by the inclusion check below).
  const haystacks = [stripSuffixes(p.name), p.category];
  const geoWords = new Set(icp.hard_inclusions.geos.flatMap((g) => norm(g).split(" ")));
  for (const ex of icp.hard_exclusions.industries) {
    for (const chunk of exclusionChunks(ex)) {
      const words = chunk.filter((w) => !geoWords.has(w));
      if (words.some((w) => haystacks.some((h) => wordHit(h, w)))) {
        return { ok: false, reason: `excluded industry: ${p.category || p.name} matches exclusion ${JSON.stringify(ex)}` };
      }
    }
  }
  const cat = norm(p.category);
  if (cat !== "" && cat !== "unclassified" && cat !== "unknown") {
    const inIndustry = icp.hard_inclusions.industries.some((ind) => termHit(p.category, ind) || termHit(p.name, ind));
    if (!inIndustry) {
      return { ok: false, reason: `outside primary segment: ${JSON.stringify(p.category)} matches none of ${icp.hard_inclusions.industries.join(", ")}` };
    }
  }
  const locValues = Object.values(p.location).filter((v) => v.trim() !== "");
  if (locValues.length > 0) {
    const inGeo = icp.hard_inclusions.geos.some((g) => locValues.some((v) => termHit(v, g)));
    if (!inGeo) {
      return { ok: false, reason: `outside service geography: ${locValues.join(", ")} matches none of ${icp.hard_inclusions.geos.join(", ")}` };
    }
  }
  return { ok: true };
}

export type Dimension = 1 | 2 | 3 | 4 | 5;

export interface QualificationDims {
  /** Account match to segment, geo, size, use case. */
  icp_fit: Dimension;
  /** Problem relevance: 1 contradicted/unclear … 5 documented. */
  problem: Dimension;
  /** Dated buying trigger: 1 none … 5 explicit. */
  readiness: Dimension;
  /** Contact route quality: 1 none … 5 verified. */
  reachability: Dimension;
  /** Source reliability/relevance/recency. */
  confidence: Dimension;
}

export type Verdict = "qualified" | "needs_research" | "no_signal" | "manual_review" | "disqualified";

export interface VerdictDecision {
  verdict: Verdict;
  fit_rating: 1 | 2 | 3 | 4 | 5;
  reason: string;
}

function clampRating(n: number): 1 | 2 | 3 | 4 | 5 {
  return Math.max(1, Math.min(5, Math.floor(n))) as 1 | 2 | 3 | 4 | 5;
}

/**
 * Deterministic verdict. Fit below threshold or a hard violation can never
 * qualify; missing evidence/signal/route downgrades instead of failing.
 * Score is weakest-link over the scored dims (readiness/reachability move
 * the verdict, never the score).
 */
export function decideVerdict(
  d: QualificationDims,
  hard: { ok: boolean; reason?: string },
  primaryEvidence: boolean,
): VerdictDecision {
  const score = clampRating(Math.min(d.icp_fit, d.problem, d.confidence));
  if (!hard.ok) {
    return { verdict: "disqualified", fit_rating: Math.min(score, 2) as 1 | 2, reason: hard.reason ?? "hard constraint violated" };
  }
  if (d.icp_fit < 3) {
    return { verdict: "disqualified", fit_rating: clampRating(Math.min(score, 2)), reason: `icp_fit ${d.icp_fit} below threshold 3` };
  }
  if (!primaryEvidence || d.confidence < 2) {
    return { verdict: "needs_research", fit_rating: score, reason: !primaryEvidence ? "no prospect-owned source yet" : "evidence confidence too low" };
  }
  if (d.problem <= 1) {
    return { verdict: "manual_review", fit_rating: score, reason: "good account but pain unclear or contradicted; human call" };
  }
  // A score below 3 can never qualify: the evidence is too thin no matter
  // how promising the account looks (kills qualified-with-2/5).
  if (score < 3) {
    return { verdict: "needs_research", fit_rating: score, reason: `score ${score} below 3: evidence too thin to qualify` };
  }
  if (d.readiness <= 1) {
    return { verdict: "no_signal", fit_rating: score, reason: "suitable account, no dated buying signal" };
  }
  if (d.reachability <= 1) {
    return { verdict: "needs_research", fit_rating: score, reason: "fit and signal ok, no usable contact route yet" };
  }
  return { verdict: "qualified", fit_rating: score, reason: "fit, evidence, signal, and route all meet the bar" };
}

/** Plan-burst goal: brief-driven, exclusion-preserving, no hardcoded vertical. */
export function buildPlanGoal(b: CommercialBrief): string {
  const seg = b.primary_segment;
  return [
    "Draft a buyer search plan: business types x locale angles.",
    `Queries must find BUYING businesses in: ${seg.industries.join(", ")} (${seg.label}), near ${seg.geos.join(", ")}.`,
    `Never list: ${seg.exclusions.join(", ")}.`,
    `In scope when: ${seg.inclusions.join("; ")}.`,
    "Qualify each query with the service-area locale. Reply ONLY a JSON array of at most 8 search query strings.",
  ].join(" ");
}

/** Search-burst goal: preserves segment, geography, and exclusions per query. */
export function buildSearchGoal(b: CommercialBrief, query: string): string {
  const seg = b.primary_segment;
  return [
    `Find businesses that match: ${query}.`,
    `Wanted: buying businesses in ${seg.industries.join(", ")} (${seg.label}) near ${seg.geos.join(", ")}.`,
    `Never list: ${seg.exclusions.join(", ")}.`,
    `Reply ONLY a JSON array, one object per distinct business, no other text: [{"name": "real business name, max 8 words", "category": "1-3 words", "fact": "one short evidence sentence about why they might buy", "url": "the result page url"}].`,
  ].join(" ");
}

/** Deterministic contact extraction from fetched page text (untrusted input, safe patterns). */
export function extractContacts(text: string): Array<{ channel: "email" | "phone"; value: string }> {
  const out: Array<{ channel: "email" | "phone"; value: string }> = [];
  const seen = new Set<string>();
  const emails = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  for (const e of emails) {
    const v = e.toLowerCase();
    if (/\.(png|jpe?g|gif|svg|css|js)$/.test(v)) continue; // file-name false positives
    if (v.length > 100) continue;
    if (!seen.has(v)) { seen.add(v); out.push({ channel: "email", value: v }); }
  }
  const phones = text.match(/\+?[0-9][0-9\s().-]{5,22}[0-9]/g) ?? [];
  for (const p of phones) {
    const digits = p.replace(/\D/g, "");
    if (!isPlausiblePhone(digits)) continue;
    const v = (p.trim().startsWith("+") ? "+" : "") + digits;
    if (!seen.has(v)) { seen.add(v); out.push({ channel: "phone", value: v }); }
  }
  return out.slice(0, 20);
}

/**
 * Date fragments ("20261028", "01232025") arrived as phone routes on
 * run_99840398. Rules: 7-15 digits; 0-prefix needs 9-11 (NG landline 9,
 * mobile 11); 8-digit 19xx/20xx with a valid month/day is YYYYMMDD.
 */
function isPlausiblePhone(digits: string): boolean {
  if (digits.length < 7 || digits.length > 15) return false;
  if (digits.length === 8 && /^(19|20)/.test(digits)) {
    const month = Number(digits.slice(4, 6));
    const day = Number(digits.slice(6, 8));
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return false;
  }
  if (digits.startsWith("0") && (digits.length < 9 || digits.length > 11)) return false;
  return true;
}

function normPhone(s: string): string {
  return s.replace(/\D/g, "").replace(/^(234|0)(?=\d{9,10}$)/, "");
}

/**
 * A model-proposed contact is grounded only if it appears in the prospect's
 * own evidence text. Phone matching tolerates 0-prefix vs +234-prefix forms.
 */
export function isGroundedContact(value: string, evidenceTexts: string[]): boolean {
  const v = value.trim().toLowerCase();
  if (!v) return false;
  if (v.includes("@")) {
    return evidenceTexts.some((t) => t.toLowerCase().includes(v));
  }
  const digits = normPhone(v);
  if (digits.length >= 7) {
    return evidenceTexts.some((t) => {
      const runs = t.match(/\+?[0-9][0-9\s().-]*/g) ?? [];
      return runs.map(normPhone).some((h) => h.length >= 7 && (h.includes(digits) || digits.includes(h)));
    });
  }
  return evidenceTexts.some((t) => t.toLowerCase().includes(v));
}
