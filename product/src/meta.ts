/**
 * product/src/meta.ts â€” Meta Responses client: request builder + response parser.
 * Model `muse-spark-1.3`; `search_context_size` medium default (low for
 * high-volume discovery, high for sparse categories); `user_location` from the
 * brief's service area; always `include: ["web_search_call.results"]`;
 * `max_tool_calls` bounds built-in search per burst. Reasoning effort low
 * default, medium for assessment/draft phases. No live calls here â€” pure
 * build/parse helpers plus usage counting (specs/architecture.md Â§5).
 */

import type { Evidence, Prospect } from "./db";
import type { AssessProposal, DraftProposal, MetaClient, SearchHit } from "./research/phases";
import {
  buildPlanGoal, buildSearchGoal, renderBriefPrompt, validateBrief,
  type CommercialBrief,
} from "./research/commercial";

export const MODEL_ID = "muse-spark-1.3";
export type SearchContextSize = "low" | "medium" | "high";
export type ReasoningEffort = "low" | "medium";

/** Developer function tools exposed beside built-in web_search (tools.md Part B). */
export const PRODUCT_TOOL_NAMES = [
  "rs.fetch_page",
  "rs.get_run_state",
  "rs.save_evidence",
  "rs.save_candidate",
  "rs.save_assessment",
  "rs.save_route",
  "rs.save_draft",
] as const;

export interface ServiceArea {
  country?: string; region?: string; city?: string; timezone?: string;
}

export interface PhaseRequestOptions {
  phase: "plan" | "discover" | "investigate" | "assess" | "rank" | "draft";
  briefExcerpt: string;
  phaseGoal: string;
  d1StateSummary?: string;
  serviceArea?: ServiceArea;
  searchContextSize?: SearchContextSize;
  maxToolCalls?: number;
  reasoningEffort?: ReasoningEffort;
  previousResponseId?: string;
  structuredOutputSchema?: Record<string, unknown>;
}

export interface ResponsesRequest {
  model: string;
  input: Array<{ role: string; content: string }>;
  tools: Array<Record<string, unknown>>;
  tool_choice: "auto";
  include: string[];
  max_tool_calls?: number;
  reasoning?: { effort: ReasoningEffort };
  previous_response_id?: string;
  text?: { format: Record<string, unknown> };
}

/** Build a phase-scoped Responses request grounded in D1 state. */
export function buildPhaseRequest(opts: PhaseRequestOptions): ResponsesRequest {
  const effort: ReasoningEffort =
    opts.reasoningEffort ?? (opts.phase === "assess" || opts.phase === "draft" ? "medium" : "low");
  const contextSize: SearchContextSize = opts.searchContextSize ?? "medium";
  const withSearch = opts.phase === "discover" || opts.phase === "investigate";
  const tools: Array<Record<string, unknown>> = [];
  if (withSearch) {
    tools.push({
      type: "web_search",
      search_context_size: contextSize,
      ...(opts.serviceArea ? { user_location: { ...opts.serviceArea, type: "approximate" } } : {}),
    });
  }
  // Product function tools relevant to the phase (declared, implemented Worker-side).
  const phaseTools: Record<string, string[]> = {
    plan: ["rs.get_run_state"],
    discover: ["rs.get_run_state", "rs.save_evidence", "rs.save_candidate"],
    investigate: ["rs.fetch_page", "rs.get_run_state", "rs.save_evidence"],
    assess: ["rs.get_run_state", "rs.save_evidence", "rs.save_assessment"],
    rank: ["rs.get_run_state"],
    draft: ["rs.get_run_state", "rs.save_evidence", "rs.save_route", "rs.save_draft"],
  };
  for (const name of phaseTools[opts.phase] ?? []) {
    tools.push({ type: "function", name, description: `Product tool ${name} (see tools.md Part B).`, parameters: { type: "object", properties: {} } });
  }
  const req: ResponsesRequest = {
    model: MODEL_ID,
    input: [
      { role: "system", content: `You are the prospect-research agent (phase: ${opts.phase}). ${opts.phaseGoal}` },
      {
        role: "user",
        content: `Brief: ${opts.briefExcerpt}${opts.d1StateSummary ? `\nKnown state:\n${opts.d1StateSummary}` : ""}`,
      },
    ],
    tools,
    tool_choice: "auto",
    include: ["web_search_call.results"],
  };
  if (opts.maxToolCalls !== undefined) req.max_tool_calls = opts.maxToolCalls;
  req.reasoning = { effort };
  if (opts.previousResponseId) req.previous_response_id = opts.previousResponseId;
  if (opts.structuredOutputSchema) req.text = { format: opts.structuredOutputSchema };
  return req;
}

// --- Response parsing -------------------------------------------------------

export interface SearchResultItem {
  title: string; url: string; snippet: string;
}

export interface UrlCitation {
  url: string; title?: string; start_index?: number; end_index?: number;
}

export interface ParsedWebSearchCall {
  id: string;
  status: string;
  results: SearchResultItem[];
}

export interface ParsedResponse {
  responseId: string | null;
  outputText: string;
  searches: ParsedWebSearchCall[];
  citations: UrlCitation[];
  searchNotRun: boolean;
  functionCalls: Array<{ name: string; call_id: string; arguments: string }>;
  usage: { input_tokens: number; output_tokens: number };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * Parse a Responses API response object (already JSON-decoded).
 * Tolerates zero citations â€” an S-0-style finding (model answered from no
 * search, or search returned nothing) is a valid outcome, not an error.
 * A search-intended burst with no web_search_call item yields searchNotRun.
 */
export function parseResponsesResponse(body: unknown): ParsedResponse {
  const parsed: ParsedResponse = {
    responseId: null, outputText: "", searches: [], citations: [],
    searchNotRun: false, functionCalls: [],
    usage: { input_tokens: 0, output_tokens: 0 },
  };
  if (!isRecord(body)) return parsed;
  if (typeof body["id"] === "string") parsed.responseId = body["id"];
  const usage = body["usage"];
  if (isRecord(usage)) {
    if (typeof usage["input_tokens"] === "number") parsed.usage.input_tokens = usage["input_tokens"];
    if (typeof usage["output_tokens"] === "number") parsed.usage.output_tokens = usage["output_tokens"];
  }
  const output = Array.isArray(body["output"]) ? body["output"] as unknown[] : [];
  let sawSearchCall = false;
  for (const item of output) {
    if (!isRecord(item)) continue;
    const type = item["type"];
    if (type === "web_search_call") {
      sawSearchCall = true;
      const resultsRaw = Array.isArray(item["results"]) ? item["results"] as unknown[] : [];
      const results: SearchResultItem[] = [];
      for (const r of resultsRaw) {
        if (!isRecord(r)) continue;
        results.push({
          title: typeof r["title"] === "string" ? r["title"] : "",
          url: typeof r["url"] === "string" ? r["url"] : "",
          snippet: typeof r["snippet"] === "string" ? r["snippet"] : "",
        });
      }
      parsed.searches.push({
        id: typeof item["id"] === "string" ? item["id"] : "",
        status: typeof item["status"] === "string" ? item["status"] : "unknown",
        results,
      });
    } else if (type === "message") {
      const content = Array.isArray(item["content"]) ? item["content"] as unknown[] : [];
      for (const part of content) {
        if (!isRecord(part)) continue;
        if (part["type"] === "output_text" && typeof part["text"] === "string") {
          parsed.outputText += part["text"];
        }
        const annotations = Array.isArray(part["annotations"]) ? part["annotations"] as unknown[] : [];
        for (const a of annotations) {
          if (isRecord(a) && a["type"] === "url_citation") {
            parsed.citations.push({
              url: typeof a["url"] === "string" ? a["url"] : "",
              ...(typeof a["title"] === "string" ? { title: a["title"] } : {}),
              ...(typeof a["start_index"] === "number" ? { start_index: a["start_index"] } : {}),
              ...(typeof a["end_index"] === "number" ? { end_index: a["end_index"] } : {}),
            });
          }
        }
      }
    } else if (type === "function_call") {
      parsed.functionCalls.push({
        name: typeof item["name"] === "string" ? item["name"] : "",
        call_id: typeof item["call_id"] === "string" ? item["call_id"] : "",
        arguments: typeof item["arguments"] === "string" ? item["arguments"] : "{}",
      });
    }
  }
  parsed.searchNotRun = !sawSearchCall;
  return parsed;
}

/** Rough cost estimate placeholder: callers fill real per-model pricing later. */
export function estimateCostUsd(inputTokens: number, outputTokens: number, pricePerMTokIn = 0, pricePerMTokOut = 0): number {
  return (inputTokens / 1_000_000) * pricePerMTokIn + (outputTokens / 1_000_000) * pricePerMTokOut;
}

// --- MetaClient adapter (live Responses API behind the phases' interface) ---

export const META_RESPONSES_ENDPOINT = "https://api.meta.ai/v1/responses";
const MAX_PLAN_QUERIES_OUT = 8;
const FETCH_TEXT_CAP = 200_000;
const DRAFT_CHANNELS = ["website_form", "email", "phone", "social_profile", "other"] as const;
const CITATION_MARKER = /\[(ev_|source\s*\d+|cite)/i;

export interface MetaClientDeps {
  apiKey: string;
  modelId?: string;
  briefExcerpt?: string;
  endpoint?: string;
  fetchImpl?: typeof fetch;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function nameFromTitle(title: string, url: string): string {
  const head = title.split(/ [-|–] /)[0]?.trim() ?? "";
  return (head || hostOf(url) || url).slice(0, 80);
}

/** Chatter guard: real business names are short, sentence-free, verb-free. */
const CHATTER_VERBS = /\b(hunting|pulling|gathering|found|searching|looking|checking|getting|sharing|listing)\b/i;
const HEADLINE_VERBS = /\b(opened|opening|launch|launched|launches|unveil|unveiled|unveils|announce|announced|introduce|introduced|produce|produces|raise|raises|raised|secure|secures|wins)\b/i;
const NEVER_NAME_VERBS = /\b(shut|shuts|closes|closed|closure|dies|died|introduce|introduced|introducing|introduction)\b/i;
const JOB_WORDS = new Set(
  "staff personnel officer officers administrator administrators assistant assistants warehouse inventory job jobs vacancy vacancies hiring career careers salary intern interns compliance recruitment teachers teacher".split(" "),
);
const STREET_ENDING = /\b(street|road|avenue|way|close|crescent|lane|boulevard|estate|estates)\.?$/i;
const LISTICLE_START = /^\s*(the\s+)?best\s+\w+(\s+\w+){1,}/i;
const TOP_N_START = /^\s*top\s+\d+/i;
const POSSESSIVE_POST = /\w+'s\s+(posts?|blogs?|articles?)\b/i;
const SITES_LIKE = /\bsites?\s+like\b/i;
const BARE_DOMAIN = /\.(com|org|ng|net|io|co|info|biz)\b/i;
/** Page-type words: portal/login/archive pages are never the business itself. */
const PAGE_TYPE_WORDS = /\b(portal|portals|login|logins|archives?|sitemap|homepage|webmail)\b/i;
/** Company-profile page titles ("X Overview, Competitors & Contact Info"). */
const PROFILE_TITLE = /\b(overview|competitors?|revenue|employees|funding|valuation)\b/i;
/** Headline verbs observed in live-run junk (extends HEADLINE_VERBS cases). */
const EXTRA_HEADLINE_VERBS = /\b(dabbles?|dives?|eyes?|bets?|mulls?|weighs?|taps?|opens?|wants?|plans?|seeks?|vows?|hails?)\b/i;
/** "List of ..." directory pages are never a business. */
const LIST_OF_LEAD = /^\s*lists?\s+of\b/i;
/** Possessive product lines ("Men's Straight Jeans") are departments, not businesses. */
const POSSESSIVE_PRODUCT = /\b(men'?s|women'?s|kids'?|unisex)\b.{0,24}\b(jeans|shirts?|dresses|shoes|sneakers|gowns|wigs?|bags?|watches|phones?|laptops?|trousers|jackets|suits)\b/i;
/** Property listings ("Shops for Sale in Ikota") are never a business. */
const FOR_SALE_RENT = /\bfor\s+(sale|rent|lease|letting)\b/i;
/** Demonstratives ("these platforms") mark headlines, never names. */
const THESE_THOSE = /\b(these|those)\b/i;
/** Listing leftovers ("Didi Fashion ... (photos)", "Clothing (Brands)"). */
const LISTING_PAREN = /\((photos?|brands?|images?|pictures?)\)/i;
/** Emoji-laden titles are social-post text, not verified business names. */
const HAS_EMOJI = /\p{Extended_Pictographic}/u;
/** Year-paren listing cruft ("Teph-store, ... (2026)"): stripped, residue validates. */
const YEAR_PAREN = /\(\s*(19|20)\d{2}\s*\)/g;
/** Hashtag soup ("#aralinelogistics #businessgrowth ...") is a post, not a business. */
const HASHTAG_SOUP = /#\w+.*#\w+|^#\w+/;

/** Words that never make a name distinctive (categories, places, fillers). */
const GENERIC_WORDS = new Set(
  ("commercial office offices company companies business businesses coworking space spaces " +
    "hub hubs school schools hospital hospitals clinic clinics bank banks branch branches " +
    "center centers centre centres event events venue venues conference conferences " +
    "tech startup startups list lists guide guides find research directory directories top best " +
    "state states comprehensive ultimate complete registration registered conglomerates conglomerate " +
    "serviced servicing retail retailers retailing wholesale rent rental sale letting let leased lease " +
    "unfurnished furnished electrical electronics engineering utilities security " +
    "estates service services contact contacts review reviews secondary elementary kindergarten " +
    "staff personnel officer officers administrator administrators assistant assistants warehouse " +
    "inventory job jobs vacancy vacancies hiring career careers apply salary " +
    "customer customers sales support software information all area areas neighbourhood neighborhood phase " +
    "medical dental square meters meter metre sq sqm ft online offline modern payment payments " +
    "gateway gateways fintech alternative alternatives competitor competitors technology technologies " +
    "africa their detail details since virtual blog blogs article articles " +
    "email emails phone phones number numbers premium around about fertility vitro fertilization " +
    "city building buildings " +
    "bedroom bedrooms flat flats apartment apartments duplex bungalow contain self affordable cheap " +
    "shop shops store stores mart marts market markets mall malls plaza plazas boutique boutiques " +
    "stall stalls kiosk kiosks outlet outlets clothing clothes wear wears fabric fabrics " +
    "fashion fashions luxury luxuries verified " +
    "grocery groceries supermarket supermarkets bookshop bookshops " +
    "private primary nursery international preschool college lagos ikeja nigeria nigerian " +
    "omole ogba opebi allen gra maryland yaba surulere lekki ikoyi island " +
    "in the a an of and for with near across plus").split(" "),
);
const STREET_SUFFIX = /\b(street|road|avenue|way|close|crescent|lane|boulevard|estate)\b/i;
const COMPANY_DESIGNATOR = /\b(ltd|limited|inc|llc|plc|co|company|group|ventures|school|clinic|hospital|bank|hub|church|hotel|pharmacy)\b/i;
const LOCATION_TAIL = /(,\s*(ikeja|lagos|nigeria|nigerian|omole|ogba|opebi|allen|gra|maryland|yaba|surulere|lekki|ikoyi))+\.?$/i;
const LOCATION_CHAIN = /(\s+(gra|ikeja|lagos|nigeria|nigerian|omole|ogba|opebi|allen|maryland|yaba|surulere|lekki|ikoyi))+\.?$/i;
const CITY_CRUFT = /\s+in\s+the\s+(city|town)\s+[^,]+$/i;

const DANGLING_PREP = /\s+(in|of|for|at|near)\s*$/i;

/** Strip location tails, dangling prepositions and "in the city X" cruft. Loops to a fixpoint: each strip can expose another ("...Office in Ikeja" -> "...Office in" -> "...Office"). */
export function cleanBusinessName(name: string): string {
  let out = name;
  for (let i = 0; i < 3; i += 1) {
    const next = out.replace(CITY_CRUFT, "").replace(DANGLING_PREP, "")
      .replace(YEAR_PAREN, "").replace(LOCATION_TAIL, "").replace(LOCATION_CHAIN, "")
      .replace(/[,;:]+$/, "").replace(/\s+/g, " ").trim();
    if (next === out) break;
    out = next;
  }
  return out;
}

/** Aggregator/directory hosts: fine as evidence, never a business candidate. */
const DIRECTORY_HOSTS = [
  "businesslist", "finelib", "directory.org.ng", "goafricaonline", "ngex.com",
  "nigeriansearchguide", "worldorgs", "highperformr", "signalhire", "6sense",
  "tripadvisor", "travelandtourworld", "yellowpages", "hotfrog", "cylex",
  "vconnect", "jiji.ng", "connectnigeria", "listcompany",
  "indeed", "hotnigerianjobs", "manpower.com.ng", "infoaboutcompanies", "africabz",
  "jantareview", "lokercepat", "wikipedia.org", "thesun.ng", "trekafrica",
  "towncriernews", "etimesafrica", "healthlifescienceplus", "edusko", "ischooladvisor",
  "findglocal", "globuya", "projectshelve", "cryptofinancejob", "babymigo", "nearu",
];

export function isDirectoryHost(url: string): boolean {
  const h = hostOf(url).toLowerCase();
  return DIRECTORY_HOSTS.some((d) => h.includes(d));
}

/** Social hosts: the profile url itself is a DM-able contact route. */
const SOCIAL_HOSTS = [
  "instagram.com", "facebook.com", "fb.com", "tiktok.com", "x.com",
  "twitter.com", "linkedin.com", "wa.me", "whatsapp.com", "t.me", "telegram.me",
];

export function isSocialHost(url: string): boolean {
  const h = hostOf(url).toLowerCase();
  return SOCIAL_HOSTS.some((d) => h === d || h.endsWith(`.${d}`));
}

/** Canonicalize for comparing model urls against result urls. */
export function normUrl(u: string): string {
  try {
    const p = new URL(u.trim());
    const host = p.hostname.toLowerCase().replace(/^www\./, "");
    const path = p.pathname.replace(/\/+$/, "") || "/";
    return host + path + (p.search || "");
  } catch {
    return u.trim();
  }
}

export function isPlausibleName(raw: string): boolean {
  const trimmed = cleanBusinessName(raw).trim();
  if (trimmed.length === 0 || trimmed.length > 80) return false;
  const words = trimmed.split(/\s+/);
  if (words.length > 8) return false;
  if (/[.!?]$/.test(trimmed) || /[!?]/.test(trimmed) || CHATTER_VERBS.test(trimmed)) return false;
  if (STREET_SUFFIX.test(trimmed) && !COMPANY_DESIGNATOR.test(trimmed)) return false; // street address, not a business
  if (/\b(is|are|was|were|has|have|offers?|provides?|providing|located)\b/i.test(trimmed)) return false; // sentence, not a name
  if (HEADLINE_VERBS.test(trimmed) && !COMPANY_DESIGNATOR.test(trimmed)) return false; // news headline, not a name
  if (NEVER_NAME_VERBS.test(trimmed)) return false; // shutdown/death/announcement headline, never a business name
  if (/@/.test(trimmed)) return false; // contains an email address: contact page, never a business name
  if (/\//.test(trimmed)) return false; // url path, not a name
  if (/area guide|neighbourhood guide|neighborhood guide|city guide/i.test(trimmed)) return false; // guide page, not a business
  if (STREET_ENDING.test(trimmed)) return false; // ends with a street suffix: the street, not a business
  if (/alternativ/i.test(trimmed) && /competitor/i.test(trimmed)) return false; // comparison article, not a business
  if (LISTICLE_START.test(trimmed)) return false; // "The Best X..." listicle, not a business
  if (TOP_N_START.test(trimmed)) return false; // "Top N..." ranking, not a business
  if (POSSESSIVE_POST.test(trimmed)) return false; // "X's Posts" blog page, not a business
  if (SITES_LIKE.test(trimmed)) return false; // "sites like X" roundup, not a business
  if (/alternativ/i.test(trimmed) && BARE_DOMAIN.test(trimmed)) return false; // "X alternatives" roundup, not a business
  if (PAGE_TYPE_WORDS.test(trimmed)) return false; // portal/login/archive page, not the business
  if (EXTRA_HEADLINE_VERBS.test(trimmed) && !COMPANY_DESIGNATOR.test(trimmed)) return false; // news headline, not a name
  if (PROFILE_TITLE.test(trimmed) && /,/.test(trimmed)) return false; // company-profile page title, not a name
  if (LIST_OF_LEAD.test(trimmed)) return false; // "List of ..." directory page, not a business
  if (POSSESSIVE_PRODUCT.test(trimmed)) return false; // possessive product line, not a business
  if (FOR_SALE_RENT.test(trimmed)) return false; // property listing, not a business
  if (THESE_THOSE.test(trimmed)) return false; // headline demonstrative, not a name
  if (LISTING_PAREN.test(trimmed)) return false; // "(photos)/(brands)" leftover, not a business
  if (HAS_EMOJI.test(trimmed)) return false; // emoji title, not a verified name
  if (HASHTAG_SOUP.test(trimmed)) return false; // hashtag soup, not a business
  if (trimmed.includes("?")) return false; // encoding casualty: never a verified name
  if (/:/.test(trimmed) && /\b(lagos|lekki|ikeja|ikoyi|yaba|surulere|oshodi|apapa|festac|ajah|island|mainland|abuja|nigeria|nigerian|guide|directory|list)\b/i.test(trimmed)) return false; // "Place: listing" guide page, not a business
  const lowerWords = words.map((w) => w.toLowerCase().replace(/[^a-z]/g, ""));
  if (lowerWords.includes("at") && lowerWords.some((w) => JOB_WORDS.has(w))) return false; // "<role> at <company>" job post
  const distinctive = words.filter((w) => {
    const alnum = w.replace(/[^a-z0-9]/gi, "");
    if (alnum.length <= 2 || /^\d+$/.test(alnum) || /^\d+[a-z]+$/i.test(alnum)) return false;
    return !GENERIC_WORDS.has(w.toLowerCase().replace(/[^a-z]/g, ""));
  });
  return distinctive.length >= 1;
}

/** Categories longer than 4 words are query echoes, not categories. */
export function isPlausibleCategory(category: string): boolean {
  const words = category.trim().split(/\s+/).filter((w) => w.length > 0);
  return words.length >= 1 && words.length <= 4;
}

function extractJsonArray(text: string): unknown[] {
  const stripped = text.replace(/```json\s*/gi, "```").replace(/```/g, "");
  const m = /\[.*\]/s.exec(stripped);
  if (!m) return [];
  try {
    const v: unknown = JSON.parse(m[0]);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** Live MetaClient: grounded search + structured bursts, all validated. */
export function createMetaClient(deps: MetaClientDeps): MetaClient {
  const model = deps.modelId ?? MODEL_ID;
  const endpoint = deps.endpoint ?? META_RESPONSES_ENDPOINT;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const brief = deps.briefExcerpt ?? "";

  async function callResponses(req: ResponsesRequest): Promise<ParsedResponse> {
    const res = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "Authorization": "Bearer " + deps.apiKey },
      body: JSON.stringify({ ...req, model }),
    });
    if (!res.ok) throw new Error(`meta_http_${res.status}`);
    return parseResponsesResponse(await res.json());
  }

  async function search(query: string): Promise<SearchHit[]> {
    const req = buildPhaseRequest({
      phase: "discover",
      briefExcerpt: brief,
      phaseGoal: activeBrief ? buildSearchGoal(activeBrief, query) : `Find businesses that match: ${query}. Wanted: buying businesses (offices, schools, clinics, hubs, venues). Never list caterers, food vendors, or recipe/blog pages. Reply ONLY a JSON array, one object per distinct business, no other text: [{"name": "real business name, max 8 words", "category": "1-3 words, e.g. Logistics", "fact": "one short evidence sentence about why they might buy", "url": "the result page url"}]. Example: [{"name": "Brightline Logistics", "category": "Logistics", "fact": "Runs a weekday lunch rota for 45 staff", "url": "https://brightline.ng/about"}]`,
      searchContextSize: "low",
      maxToolCalls: 4,
    });
    // Single-shot burst: keep web_search, drop function tools (the adapter
    // cannot continue a tool loop, so offered tools only steal the turn).
    req.tools = req.tools.filter((t) => t["type"] === "web_search");
    const parsed = await callResponses(req);
    const results = parsed.searches.flatMap((s) => s.results);
    const byUrl = new Map(results.map((r) => [normUrl(r.url), r]));
    const hits: SearchHit[] = [];
    const claimed = new Set<string>();
    for (const item of extractJsonArray(parsed.outputText)) {
      if (!isRecord(item)) continue;
      const name = item["name"];
      const category = item["category"];
      const fact = item["fact"];
      const url = item["url"];
      if (typeof name !== "string" || typeof url !== "string") continue;
      const hit = byUrl.get(normUrl(url));
      if (!name || !url || !hit) continue; // url must come from results[]
      const host = hostOf(hit.url);
      claimed.add(hit.url);
      const eligible = isPlausibleName(name) && !isDirectoryHost(hit.url);
      const cat = typeof category === "string" ? category : "";
      hits.push({
        claim: (typeof fact === "string" && fact) || name,
        quote: hit.snippet || ((typeof fact === "string" && fact) || name),
        source_url: hit.url,
        name: cleanBusinessName(name).slice(0, 80),
        category: isPlausibleCategory(cat) ? cat : "unclassified",
        ...(eligible ? {} : { candidateEligible: false as const }),
        ...(host ? { domainOrHandle: host } : {}),
      });
    }
    for (const r of results) {
      if (!r.url || claimed.has(r.url)) continue;
      const host = hostOf(r.url);
      const fallbackName = cleanBusinessName(nameFromTitle(r.title, r.url));
      const eligible = isPlausibleName(fallbackName) && !isDirectoryHost(r.url);
      hits.push({
        claim: r.title || r.url,
        quote: r.snippet || r.title || r.url,
        source_url: r.url,
        name: fallbackName,
        category: "unclassified",
        ...(eligible ? {} : { candidateEligible: false as const }),
        ...(host ? { domainOrHandle: host } : {}),
      });
    }
    return hits;
  }

  async function proposeAssessments(prospects: Prospect[], evidence: Evidence[]): Promise<AssessProposal[]> {
    const ids = new Set(prospects.map((p) => p.id));
    const req = buildPhaseRequest({
      phase: "assess",
      briefExcerpt: brief,
      phaseGoal: activeBrief
        ? `Score each prospect 1-5 on five dimensions. ${renderBriefPrompt(activeBrief)} Reply ONLY a JSON array: [{"prospect_id","fit_rating":1-5 overall,"supporting_claims":[claim text],"weakening_claims":[],"rationale":"why fit or not, citing specifics","dimensions":{"icp_fit":1-5 account match,"problem":1-5 pain relevance (1=contradicted or unclear),"readiness":1-5 dated buying trigger (1=none),"reachability":1-5 contact quality: an official site or business social profile counts as a usable route (1=none),"confidence":1-5 source quality}}]. Score honesty over optimism: use 1-2 freely when evidence is thin. Prospects: ${JSON.stringify(prospects.map((p) => ({ id: p.id, name: p.name, category: p.category })))}. Evidence: ${JSON.stringify(evidence.slice(0, 30).map((e) => ({ claim: e.claim, url: e.source_url, type: e.source_type })))}.`
        : `Rate fit 1-5 for each prospect. Reply ONLY a JSON array: [{"prospect_id","fit_rating":1-5,"supporting_claims":[claim text],"weakening_claims":[],"rationale":"..."}]. Prospects: ${JSON.stringify(prospects.map((p) => ({ id: p.id, name: p.name, category: p.category })))}. Evidence: ${JSON.stringify(evidence.slice(0, 30).map((e) => ({ claim: e.claim, url: e.source_url, type: e.source_type })))}.`,
    });
    req.tools = []; // structured burst: answer in text, no tool loop offered
    const parsed = await callResponses(req);
    const out: AssessProposal[] = [];
    for (const item of extractJsonArray(parsed.outputText)) {
      if (!isRecord(item)) continue;
      const pid = item["prospect_id"];
      const rating = item["fit_rating"];
      if (typeof pid !== "string" || !ids.has(pid)) continue;
      if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5) continue;
      const supporting = Array.isArray(item["supporting_claims"])
        ? (item["supporting_claims"] as unknown[]).filter((c): c is string => typeof c === "string")
        : [];
      const weakening = Array.isArray(item["weakening_claims"])
        ? (item["weakening_claims"] as unknown[]).filter((c): c is string => typeof c === "string")
        : [];
      const dimsRaw = isRecord(item["dimensions"]) ? (item["dimensions"] as Record<string, unknown>) : null;
      const dims = dimsRaw && ["icp_fit", "problem", "readiness", "reachability", "confidence"]
        .every((k) => typeof dimsRaw[k] === "number" && Number.isInteger(dimsRaw[k]) && (dimsRaw[k] as number) >= 1 && (dimsRaw[k] as number) <= 5)
        ? {
            icp_fit: dimsRaw["icp_fit"] as number, problem: dimsRaw["problem"] as number,
            readiness: dimsRaw["readiness"] as number, reachability: dimsRaw["reachability"] as number,
            confidence: dimsRaw["confidence"] as number,
          }
        : null;
      out.push({
        prospect_id: pid,
        fit_rating: rating,
        supporting_claims: supporting,
        ...(weakening.length > 0 ? { weakening_claims: weakening } : {}),
        rationale: typeof item["rationale"] === "string" ? item["rationale"] : "",
        ...(dims ? { dimensions: dims } : {}),
      });
    }
    return out;
  }

  async function proposeDrafts(prospects: Prospect[], evidence: Evidence[] = []): Promise<DraftProposal[]> {
    const ids = new Set(prospects.map((p) => p.id));
    const req = buildPhaseRequest({
      phase: "draft",
      briefExcerpt: brief,
      phaseGoal: activeBrief
        ? `Write one outreach draft per prospect. Each draft must follow: observed fact from the evidence below, supported interpretation, pain hypothesis (say "might" or "often" when unverified), the offer, one low-friction ask. Never invent metrics, relationships, referrals, or internal knowledge. Reply ONLY a JSON array: [{"prospect_id","channel":"website_form|email|phone|social_profile|other","contact_value":"copied from the evidence urls below, never invented","subject":"...","body":"... must cite evidence like [source 1] ...","next_action":"...","follow_up_days":7,"supporting_ids":[evidence ids backing the claims]}]. Business: ${renderBriefPrompt(activeBrief)} Prospects: ${JSON.stringify(prospects.map((p) => ({ id: p.id, name: p.name, category: p.category })))}. Evidence: ${JSON.stringify(evidence.slice(0, 40).map((e) => ({ id: e.id, claim: e.claim, url: e.source_url })))}.`
        : `Write one outreach draft per prospect. Reply ONLY a JSON array: [{"prospect_id","channel":"website_form|email|phone|social_profile|other","contact_value":"copied from the evidence urls below, never invented","subject":"...","body":"... must cite evidence like [source 1] ...","next_action":"...","follow_up_days":7}]. Business: ${brief}. Prospects: ${JSON.stringify(prospects.map((p) => ({ id: p.id, name: p.name, category: p.category })))}. Evidence: ${JSON.stringify(evidence.slice(0, 40).map((e) => ({ id: e.id, claim: e.claim, url: e.source_url })))}.`,
    });
    req.tools = []; // structured burst: answer in text, no tool loop offered
    const parsed = await callResponses(req);
    const out: DraftProposal[] = [];
    for (const item of extractJsonArray(parsed.outputText)) {
      if (!isRecord(item)) continue;
      const pid = item["prospect_id"];
      const body = item["body"];
      if (typeof pid !== "string" || !ids.has(pid)) continue;
      if (typeof body !== "string" || !CITATION_MARKER.test(body)) continue;
      const channel = item["channel"];
      const supportingIds = Array.isArray(item["supporting_ids"])
        ? (item["supporting_ids"] as unknown[]).filter((x): x is string => typeof x === "string")
        : [];
      out.push({
        prospect_id: pid,
        channel: typeof channel === "string" && (DRAFT_CHANNELS as readonly string[]).includes(channel)
          ? (channel as (typeof DRAFT_CHANNELS)[number])
          : "other",
        contact_value: typeof item["contact_value"] === "string" ? item["contact_value"] : "",
        subject: typeof item["subject"] === "string" ? item["subject"] : null,
        body,
        next_action: typeof item["next_action"] === "string" ? item["next_action"] : "Follow up manually",
        ...(typeof item["follow_up_days"] === "number" && item["follow_up_days"] > 0
          ? { follow_up_days: Math.floor(item["follow_up_days"]) }
          : {}),
        ...(supportingIds.length > 0 ? { supporting_ids: supportingIds } : {}),
      });
    }
    return out;
  }

  async function planQueries(briefExcerpt: string): Promise<string[]> {
    const req = buildPhaseRequest({
      phase: "plan",
      briefExcerpt: briefExcerpt,
      // Brief-driven plan when a commercial brief was built; legacy excerpt
      // prompts otherwise (runs without a brief keep working).
      phaseGoal: activeBrief ? buildPlanGoal(activeBrief) : `Draft a buyer search plan: business types x locale angles. Queries must find BUYING businesses (offices, schools, clinics, hubs, venues near the service area) — never caterers or food vendors. Qualify each query with the service-area locale from the brief. Reply ONLY a JSON array of at most ${MAX_PLAN_QUERIES_OUT} search query strings.`,
    });
    req.tools = []; // structured burst: answer in text, no tool loop offered
    const parsed = await callResponses(req);
    return extractJsonArray(parsed.outputText)
      .filter((q): q is string => typeof q === "string" && q.trim() !== "")
      .map((q) => q.trim())
      .slice(0, MAX_PLAN_QUERIES_OUT);
  }

/**
 * Best-effort visible-text extraction: fetched pages arrived as raw HTML
 * (run_99840398 quotes were <head> soup), poisoning assessment and contact
 * extraction. Scripts/styles removed, tags cut, common entities decoded.
 */
function extractVisibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript\s*>/gi, " ")
    .replace(/<\/?[a-z!][^>]*>/gi, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

  async function fetchPage(
    url: string, timeoutMs: number,
  ): Promise<{ text: string } | { failure: "blocked" | "empty" | "timeout"; detail: string }> {
    let res: Response;
    try {
      res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      return { failure: "timeout", detail: e instanceof Error ? e.message : "fetch failed" };
    }
    if (res.status === 403 || res.status === 401 || res.status === 429) {
      return { failure: "blocked", detail: `http ${res.status}` };
    }
    if (res.status === 404 || res.status === 410) return { failure: "empty", detail: `http ${res.status}` };
    if (!res.ok) return { failure: "blocked", detail: `http ${res.status}` };
    return { text: extractVisibleText(await res.text()).slice(0, FETCH_TEXT_CAP) };
  }

  let activeBrief: CommercialBrief | null = null;

  async function buildBrief(profile: {
    name: string; website_url: string; description: string;
    target_market: string; service_area_note: string; constraints_note: string;
  }): Promise<CommercialBrief> {
    const goal = [
      "Build a commercial brief for B2B prospecting. Reply ONLY JSON, no other text.",
      `Business: ${profile.name}. ${profile.description}`,
      `Website: ${profile.website_url || "none"}. Target market: ${profile.target_market || "unknown"}.`,
      `Service area: ${profile.service_area_note || "unknown"}. Constraints: ${profile.constraints_note || "none stated"}.`,
      'Shape: {"version":1,"offer":{"description":string,"geography":string,"outcomes":[3 strings]},',
      '"primary_segment":{"label":string,"industries":[1-3],"geos":[1-3],"sizes":[1-2],"use_cases":[1-3],"inclusions":[2-5 observable traits],"exclusions":[2-6 categories to never target]},',
      '"secondary_segments":[],"pains":[{"job":string,"obstacle":string,"workaround":string,"trigger_hints":[2-4],"falsifiable_by":string}],',
      '"buyer_roles":[{"role":string,"concerns":[1-3]}],"statements":[{"text":string,"provenance":"user_fact|source_verified|inference|hypothesis|unknown"}],',
      '"questions":[at most 3 blocking questions, or empty],"assumptions":[provisional assumptions or empty]}.',
      "Rules: exactly one primary segment; exclusions must name concrete categories; every statement labeled honestly — never mark a guess as user_fact; each pain must name what evidence would falsify it.",
    ].join("\n");
    const req = buildPhaseRequest({
      phase: "plan",
      briefExcerpt: `${profile.name}. ${profile.description}`,
      phaseGoal: goal,
    });
    req.tools = []; // structured burst: answer in text, no tool loop offered
    const parsed = await callResponses(req);
    const raw = parsed.outputText;
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    let item: unknown = null;
    if (start >= 0 && end > start) {
      try {
        item = JSON.parse(raw.slice(start, end + 1)) as unknown;
      } catch { item = null; }
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("brief burst did not return an object");
    }
    return validateBrief(item);
  }

  function setBrief(b: CommercialBrief): void {
    activeBrief = b;
  }

  return { planQueries, search, proposeAssessments, proposeDrafts, fetchPage, buildBrief, setBrief, modelId: model };
}
