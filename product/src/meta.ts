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
import type {
  AssessProposal, DraftProposal, MetaClient, OnboardFieldKey,
  OnboardTurnInput, OnboardTurnResult, RewriteInput, RewriteResult, SearchHit,
} from "./research/phases";
import { ONBOARD_FIELD_KEYS } from "./research/phases";
import {
  buildBriefGoal, buildPlanGoal, buildSearchGoal, renderBriefPrompt, validateBrief,
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

/**
 * City-led geo bias for web_search user_location (run_de5e566e returned
 * Philadelphia results for a Lagos brief). Country passes through only in
 * ISO-2 form — a mispredicted country code would poison every search, so a
 * full country name is dropped and the city carries the bias.
 */
/** Global/online words: reach, not a place. Never becomes a search city. */
const GLOBAL_GEO_WORDS = /\b(worldwide|global|globally|international|internationally|online|nationwide|remote|virtual|everywhere|anywhere)\b/i;

export function serviceAreaFromGeos(geos: string[]): ServiceArea | undefined {
  const parts = geos.flatMap((g) => g.split(",").map((s) => s.trim()).filter((s) => s !== ""));
  // A business may be purely online or serve worldwide (no base): a global
  // word is not a place — biasing web_search with city "Worldwide" would
  // poison every result. Drop such entries; nothing concrete => no bias.
  const concrete = parts.filter((p) => !GLOBAL_GEO_WORDS.test(p));
  const city = concrete[0];
  if (city === undefined) return undefined;
  const area: ServiceArea = { city };
  const last = concrete[concrete.length - 1];
  if (concrete.length > 1 && typeof last === "string" && /^[A-Z]{2}$/.test(last)) area.country = last;
  return area;
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
  /** Phase label for the audit trail only — stripped before the wire. */
  phase?: "plan" | "discover" | "investigate" | "assess" | "rank" | "draft";
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
    phase: opts.phase,
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
/** Wall-clock cap per Responses call. Without it a stalled upstream hangs the
 * Workflow step forever (Workers fetch has no default timeout). */
const META_CALL_TIMEOUT_MS = 120_000;
const DRAFT_CHANNELS = ["website_form", "email", "phone", "social_profile", "other"] as const;

export interface MetaClientDeps {
  apiKey: string;
  modelId?: string;
  briefExcerpt?: string;
  endpoint?: string;
  fetchImpl?: typeof fetch;
  /** Transient-retry backoff for model calls (tests inject tiny delays). */
  retryDelays?: number[];
  /** Audit trail hook (user requirement 2026-10-31): every model burst logs
   * phase, goal head, usage, duration, and output head. Best-effort. */
  audit?: (ev: import("./audit").AuditEvent) => Promise<void>;
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
const NEVER_NAME_VERBS = /\b(shut|shuts|closes|closed|closure|dies|died|introduce|introduced|introduces|introducing|introduction)\b/i;
const JOB_WORDS = new Set(
  "staff personnel officer officers administrator administrators assistant assistants warehouse inventory job jobs vacancy vacancies hiring career careers salary intern interns compliance recruitment teachers teacher".split(" "),
);
const STREET_ENDING = /\b(street|road|avenue|way|close|crescent|lane|boulevard|estate|estates)\.?$/i;
const LISTICLE_START = /^\s*(the\s+)?best\s+\w+(\s+\w+){1,}/i;
const TOP_N_START = /^\s*top\s+\d+/i;
/** "Top Event Management Companies" — a numberless ranking roundup. Real
 * names starting with Top (Topmark, Topfit) survive: they have no space
 * after "top". */
const TOP_ROUNDUP = /^\s*(the\s+)?top\s+\w+(\s+\w+){0,5}\s+(companies|planners|agencies|firms|venues|centres|centers|hotels|restaurants|shops|stores|suppliers|consultants|contractors|services|schools|banks)\b/i;
const POSSESSIVE_POST = /\w+'s\s+(posts?|blogs?|articles?|profile)\b/i;
const SITES_LIKE = /\bsites?\s+like\b/i;
const BARE_DOMAIN = /\.(com|org|ng|net|io|co|info|biz)\b/i;
/** Page-type words: portal/login/archive pages are never the business itself. */
const PAGE_TYPE_WORDS = /\b(portal|portals|login|logins|archives?|sitemap|homepage|webmail|gallery|galleries|photos|images|videos|media|menu|faqs?|careers|jobs?|vacanc)\b/i;
/** "Our Services" / "Our Events Gallery" / "Our contact details" — website
 * section headings shipped as business names (run_26e1b058). */
const OUR_SECTION = /^our\s+(services|products?|solutions?|events?|gallery|portfolio|works?|projects?|clients?|contact|details|story|about|team|offerings?|packages?|process|faq|mission|vision)\b/i;
/** Company-profile page titles ("X Overview, Competitors & Contact Info"). */
const PROFILE_TITLE = /\b(overview|competitors?|revenue|employees|funding|valuation)\b/i;
/** Headline verbs observed in live-run junk (extends HEADLINE_VERBS cases). */
const EXTRA_HEADLINE_VERBS = /\b(dabbles?|dives?|eyes?|bets?|mulls?|weighs?|taps?|opens?|wants?|plans?|seeks?|vows?|hails?|widens?|expands?|extends?|grows?)\b/i;
/** Software spam ("X 2.0 Free Download") is never a business. */
const FREE_DOWNLOAD = /\bfree download\b/i;
/** Version numbers ("2.0") mark software, never a business name. */
const VERSION_NUM = /\bv?\d+\.\d+(\.\d+)?\b/;
/** Flag emoji (regional indicators): stripped, residue validates. */
const FLAG_STRIP = /[\p{Regional_Indicator}]/gu;
/** "List of ..." directory pages are never a business. */
const LIST_OF_LEAD = /^\s*(full|complete|comprehensive|the|a)?\s*lists?\s+of\b/i;
/** Numbered listicles ("The 10 best X", "10 best X") are rankings, not businesses. */
const NUMBERED_LISTICLE = /^\s*(the\s+)?\d+\s+best\b/i;
/** Meta explainers ("Types of hr jobs") are articles, not businesses. */
const TYPES_OF = /^\s*types?\s+of\b/i;
/** About pages ("About X Services Limited") describe a business; they aren't one. */
const ABOUT_COMPANY = /^\s*about\s+\w+.*\b(limited|ltd|inc|services|company)\b/i;
/** About + ALLCAPS brand ("About KIKKI CLOTHING") is a page title, not a name. Title-case ("About You") is spared. */
const ABOUT_CAPS = /^\s*[Aa][Bb][Oo][Uu][Tt]\s+[A-Z]{2,}/;
/** Bare about pages ("About Us") are site sections, not businesses. */
const ABOUT_BARE = /^\s*about\s+(us|the company|our company)\b/i;
/** Contact pages ("Contact X Stores") are site sections, not businesses. */
const CONTACT_LEAD = /^\s*contact\b/i;
/** Shopping guides ("Where To Buy X") are articles, not businesses. */
const WHERE_TO_BUY = /^\s*where\s+to\s+buy\b/i;
/** Haul videos ("MY MAKEUP HAUL FROM ...") need a video word, so "Haul Logistics" survives. */
const HAUL_WORD = /\bhauls?\b/i;
const HAUL_VIDEO = /\b(videos?|watch|from|youtube|vlog)\b/i;
/** FAQ labels ("SLOT Nigeria FAQ") are pages, not businesses. */
const FAQ_TOKEN = /\bfaqs?\b/i;
/** "All X Offices/Stores" roundups are lists, not businesses ("All Saints" spared). */
const ALL_OUTLETS = /^\s*all\s+.*\b(offices?|stores?|branches?|locations?)\b/i;
/** Story headlines ("Obiwezy: From X to Y") are articles, not businesses. */
const STORY_HEADLINE = /:\s*from\b/i;
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
/** Promo headlines ("Get 10% Off ...") are offers, not businesses. */
const PROMO_OFF = /\b\d+\s*%\s*off\b/i;
/** Map labels ("Driving directions to X") are pages, not businesses. */
const DIRECTIONS_LEAD = /^(driving directions|directions|how to get)\b/i;
/** Profile pages ("X Company Profile") describe a business; they aren't one. */
const COMPANY_PROFILE = /\bcompany profile\b/i;
/** Platform-handle titles ("TikTok · X") are accounts, not verified businesses. */
const PLATFORM_WORD = /\b(tiktok|instagram|facebook|whatsapp|telegram|snapchat|twitter|youtube|youtu\.be)\b/i;
/** SKU titles ("... GLUCOSAMINE SULPHATE 750MG X 30") are products, not businesses. */
const DOSAGE = /\b\d+\s?(mg|ml|mcg)\b/i;
/** Imperative headlines ("Buy Medicines Online") are CTAs, not businesses. */
const IMPERATIVE_LEAD = /^(buy|order|find|discover|explore|compare)\b/i;
/** Contact pages ("Contact Us | X") are site sections, not businesses. */
const CONTACT_US = /\bcontact us\b/i;
/** Street addresses (", 32 Randle Avenue ..."): stripped so variants dedupe. */
const ADDRESS_STRIP = /,?\s*\d+\s+[A-Za-z][A-Za-z .'-]*(street|road|avenue|close|crescent|lane|boulevard|way)\b.*$/i;

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
    "privacy policy policies terms conditions condition cookies cookie copyright " +
    "storelocator locator faq faqs frequently asked questions question " +
    "food foods law laws legal firm firms commercial criminal human rights search " +
    "training providers detached duplexes terrace terraces " +
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
      .replace(YEAR_PAREN, "").replace(ADDRESS_STRIP, "").replace(FLAG_STRIP, "")
      .replace(LOCATION_TAIL, "").replace(LOCATION_CHAIN, "")
      .replace(/,\s*(Ikeja|Ogba|Maryland|Yaba|Lekki|Surulere|Opebi|Allen|Alausa|Agege|Onipanu|Gbagada|Magodo|Ilupeju|Lagos|Nigeria)(?=[,\s]|$)/gi, "")
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
  "konga.com", "jumia.", "kara.com.ng",
  // Job boards shipped "HR Business Partner (Fintech)" as a prospect for a
  // caterer; news/map/venue aggregators shipped headlines and list pages.
  "betajob", "grabjobs", "myjobmag", "jobgivers", "glassdoor", "zippia",
  "cvent", "vymaps", "mapcarta", "placedigger", "billionaires.africa",
  "amimagazine", "nairaland", "heyplaces", "heyplace",
];
/** Pattern layer: a denylist alone lost to enbizopedia (run_109a87e6
 * shipped barbers for a caterer from it). Match aggregator-shaped hosts. */
const DIRECTORY_HOST_PATTERNS = [
  /pedia/i, /directory/i, /yellowpages/i, /phonebook/i, /listicle/i,
  /nearme/i, /nicelocal/i, /findopen/i, /bizbook/i, /localpages/i,
  /freebusinesslisting/i, /companywall/i, /opencorporates/i,
];

export function isDirectoryHost(url: string): boolean {
  const h = hostOf(url).toLowerCase();
  if (DIRECTORY_HOSTS.some((d) => h.includes(d))) return true;
  return DIRECTORY_HOST_PATTERNS.some((p) => p.test(h));
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
  // Person-launches-news pattern: "Ibukun Awosika launches THE HUB executive
  // venue" passed the headline check via the venue word 'hub' — a launch
  // verb is never part of a business name.
  if (/\b(launches|unveils|debuts|inaugurates|launched|unveiled)\b/i.test(trimmed)) return false;
  // Role-led names are job ads, not organisations ("HR Business Partner
  // (Fintech)", "Head of Human Resources, Nigeria at Hugo", "People
  // Operations Manager (Hybrid) at Erecruiter").
  if (/^(head of\b|manager\b|lead\b|officer\b|director\b|hr\s+(business partner|manager|lead|officer|generalist|partner)\b|people ops|people operations|talent |recruiter|recruitment|business partner|co-?ordinator|supervisor|intern\b|graduate trainee|sales executive|account officer|hiring\b)/i.test(trimmed)) return false;
  // A month + year inside a name is a dated listing ("People Operations Lead
  // at Flutterwave May, 2022").
  if (/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s*,?\s*20\d\d\b/i.test(trimmed)) return false;
  // "X hiring Y" is a job ad, never a business ("Hypercity (Nigeria) hiring
  // Admin Manager Job"). Same for staffing-demand and office-move headlines
  // ("More teachers needed in Lagos public schools", "Africa Internet Group
  // moves office to ...") — run_cb6fec23 shipped both as candidates.
  if (/\bhiring\b|\bneeded\b|\bseeking\b|\bmoves?\b|\bmoved\b|\brelocat\w+\b/i.test(trimmed)) return false;
  // Document and listing artefacts read as names ("AIS Professional
  // Services — Firm brochure 2026", "Result page 13 for ...").
  if (/—/u.test(trimmed)) return false; // em-dash = title separator
  if (/\b(brochure|flyer|fact sheet|price list|rate card|catalogue|catalog|portfolio|proposal|quotation)\b/i.test(trimmed)) return false;
  if (/^result page\b/i.test(trimmed)) return false;
  if (/@/.test(trimmed)) return false; // contains an email address: contact page, never a business name
  if (/\//.test(trimmed)) return false; // url path, not a name
  if (/[«»]/.test(trimmed)) return false; // directory-tail guillemets, not a name
  // A bare domain inside the name is a directory/attribution tail
  // ("Araromi Youth Development Centre Lagos. « HEYPLACES.COM.NG") — unless
  // the whole name is brand+tld ("Supermart.ng" is a real brand).
  const beforeTld = (trimmed.split(/\s*\.(?:com|com\.ng|ng|org|net|co)\b/i)[0] ?? "").trim();
  if (/\.(com|com\.ng|ng|org|net|co)\b/i.test(trimmed) && beforeTld.split(/\s+/).length >= 2) return false;
  if (/area guide|neighbourhood guide|neighborhood guide|city guide/i.test(trimmed)) return false; // guide page, not a business
  if (STREET_ENDING.test(trimmed)) return false; // ends with a street suffix: the street, not a business
  if (/alternativ/i.test(trimmed) && /competitor/i.test(trimmed)) return false; // comparison article, not a business
  if (LISTICLE_START.test(trimmed)) return false; // "The Best X..." listicle, not a business
  if (TOP_N_START.test(trimmed)) return false; // "Top N..." ranking, not a business
  if (TOP_ROUNDUP.test(trimmed)) return false; // "Top Event Management Companies" roundup, not a business
  if (OUR_SECTION.test(trimmed)) return false; // "Our Services" section heading, not a business
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
  if (PROMO_OFF.test(trimmed)) return false; // promo headline, not a business
  if (DIRECTIONS_LEAD.test(trimmed)) return false; // map label, not a business
  if (COMPANY_PROFILE.test(trimmed)) return false; // profile page, not a business
  if (PLATFORM_WORD.test(trimmed)) return false; // platform-handle title, not a business
  if (DOSAGE.test(trimmed)) return false; // SKU dosage, not a business
  if (IMPERATIVE_LEAD.test(trimmed)) return false; // imperative headline, not a business
  if (CONTACT_US.test(trimmed)) return false; // contact page, not a business
  if (FREE_DOWNLOAD.test(trimmed)) return false; // software spam, not a business
  if (VERSION_NUM.test(trimmed)) return false; // version number, not a business
  if (NUMBERED_LISTICLE.test(trimmed)) return false; // ranked listicle, not a business
  if (TYPES_OF.test(trimmed)) return false; // meta explainer, not a business
  if (ABOUT_COMPANY.test(trimmed)) return false; // about page, not a business
  if (ABOUT_CAPS.test(trimmed)) return false; // about + ALLCAPS brand, not a business
  if (ABOUT_BARE.test(trimmed)) return false; // bare about page, not a business
  if (CONTACT_LEAD.test(trimmed)) return false; // contact page, not a business
  if (WHERE_TO_BUY.test(trimmed)) return false; // shopping guide, not a business
  if (HAUL_WORD.test(trimmed) && HAUL_VIDEO.test(trimmed)) return false; // haul video, not a business
  if (FAQ_TOKEN.test(trimmed)) return false; // FAQ label, not a business
  if (ALL_OUTLETS.test(trimmed)) return false; // outlet roundup, not a business
  if (trimmed.includes("?")) return false; // encoding casualty: never a verified name
  if (/:/.test(trimmed) && /\b(lagos|lekki|ikeja|ikoyi|yaba|surulere|oshodi|apapa|festac|ajah|island|mainland|abuja|nigeria|nigerian|guide|directory|list|suppliers?|vendors?|manufacturers?|exporters?)\b/i.test(trimmed)) return false; // "Place: listing" guide page, not a business
  if (STORY_HEADLINE.test(trimmed)) return false; // story headline, not a business
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

const ONBOARD_VALUE_CAP = 280;
const ONBOARD_PROMPT_CAP = 280;
const ONBOARD_CHIP_CAP = 40;
const ONBOARD_MAX_CHIPS = 3;
const ONBOARD_KEYS = new Set<string>(ONBOARD_FIELD_KEYS);

/** Assume-never-ask (owner direction 2026-11-03): these fields are inferred
 *  or defaulted by the system, never spent as an interview question. No
 *  default text is injected into the field dict — assumptions belong to the
 *  brief phase, where they cannot leak into the owner's stated buyers. */
const NEVER_ASK_FIELDS: ReadonlySet<string> = new Set(["decision_maker", "order_size", "budget", "timeline"]);

function isOnboardKey(key: unknown): key is OnboardFieldKey {
  return typeof key === "string" && ONBOARD_KEYS.has(key);
}

/**
 * Validate one onboarding burst. Fail-closed: unknown keys are dropped, every
 * label is forced to "inferred" (the model can never mint user-provided or
 * skipped fields), and an unusable question ends the conversation.
 */
export function validateOnboardTurn(item: unknown): OnboardTurnResult {
  if (!isRecord(item)) throw new Error("onboard burst did not return an object");
  const fields: Record<string, { value: string; label: string }> = {};
  const rawFields = item["fields"];
  if (isRecord(rawFields)) {
    for (const [key, fv] of Object.entries(rawFields)) {
      if (!isOnboardKey(key) || !isRecord(fv)) continue;
      const value = fv["value"];
      if (typeof value !== "string" || value.trim() === "") continue;
      fields[key] = { value: value.slice(0, ONBOARD_VALUE_CAP), label: "inferred" };
    }
  }
  let question: OnboardTurnResult["question"] = null;
  const rawQ = item["question"];
  if (
    isRecord(rawQ) && isOnboardKey(rawQ["key"])
    && typeof rawQ["prompt"] === "string" && rawQ["prompt"].trim() !== ""
  ) {
    const chips = Array.isArray(rawQ["chips"])
      ? (rawQ["chips"] as unknown[])
        .filter((c): c is string => typeof c === "string" && c.trim() !== "")
        .slice(0, ONBOARD_MAX_CHIPS)
        .map((c) => c.slice(0, ONBOARD_CHIP_CAP))
      : [];
    question = { key: rawQ["key"], prompt: rawQ["prompt"].slice(0, ONBOARD_PROMPT_CAP), chips };
  }
  // Deterministic assume-never-ask guard (owner direction 2026-11-03): these
  // fields are the system's job to assume, not the owner's to answer. A
  // question targeting them is simply dropped — no default value is injected
  // into the field dict, so the assumption can never leak into buyers or the
  // brief (the brief's strategist rule carries "the owner decides" instead).
  if (question && NEVER_ASK_FIELDS.has(question.key)) {
    question = null;
  }
  const done = item["done"] === true || question === null;
  // The business name rides beside the fields: the owner's words may name it
  // even when the fields dict has no slot for it (the model is instructed to
  // extract name-like phrases). Absent stays absent — never invent.
  const name = typeof item["name"] === "string" && item["name"].trim() !== ""
    ? item["name"].trim().slice(0, 120)
    : undefined;
  return { fields, question: done ? null : question, done, ...(name ? { name } : {}) };
}

const REWRITE_TONE_GUIDE: Record<string, string> = {
  warmer: "Rewrite warmer and friendlier, like a helpful neighbour.",
  more_direct: "Rewrite shorter and more direct. Lead with the ask.",
  another: "Write a fresh version with a different opening angle.",
};

/** Channel tune input: the stored draft plus the target channel shape. */
export interface RetuneInput {
  subject: string;
  body: string;
  channel_target: "whatsapp" | "email" | "dm";
}

export function validateRewrite(item: unknown): RewriteResult {
  if (!isRecord(item)) throw new Error("rewrite burst did not return an object");
  const subject = item["subject"];
  const body = item["body"];
  if (typeof subject !== "string" || subject.trim() === "") {
    throw new Error("rewrite burst missing subject");
  }
  if (typeof body !== "string" || body.trim() === "") {
    throw new Error("rewrite burst missing body");
  }
  return { subject: subject.slice(0, 200), body: body.slice(0, 4000) };
}

/** Live MetaClient: grounded search + structured bursts, all validated. */
export function createMetaClient(deps: MetaClientDeps): MetaClient {
  const model = deps.modelId ?? MODEL_ID;
  const endpoint = deps.endpoint ?? META_RESPONSES_ENDPOINT;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const brief = deps.briefExcerpt ?? "";

  async function callResponses(req: ResponsesRequest): Promise<ParsedResponse> {
    // Transient model failures (429/5xx/timeout) ride out IN-CALL: the
    // Workflow step retry is the outer belt, this is the inner suspenders —
    // one flaky burst must not cost a full step re-run (run_dc346818 died on
    // a single meta_http_504 with 29 assessed prospects, 2026-11-03).
    const DELAYS = deps.retryDelays ?? [2000, 8000];
    const firstStarted = Date.now();
    let lastErr: unknown;
    for (let attempt = 0; attempt <= DELAYS.length; attempt += 1) {
      const started = Date.now();
      try {
        const wire: Record<string, unknown> = { ...req, model };
        delete wire["phase"]; // audit-only label, never sent to the API
        const res = await fetchImpl(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json", "Authorization": "Bearer " + deps.apiKey },
          body: JSON.stringify(wire),
          signal: AbortSignal.timeout(META_CALL_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`meta_http_${res.status}`);
        const parsed = parseResponsesResponse(await res.json());
        if (deps.audit) {
          const lastInput = req.input[req.input.length - 1];
          const goal = lastInput ? lastInput.content : "";
          await deps.audit({
            kind: "model_call",
            subject: `${req.phase} ${model}`,
            summary: {
              phase: req.phase, model, duration_ms: Date.now() - started,
              input_tokens: parsed.usage?.input_tokens, output_tokens: parsed.usage?.output_tokens,
              tools: req.tools.map((t) => t["name"] ?? t["type"]).slice(0, 5),
              goal_head: goal.slice(0, 800),
              output_head: (parsed.outputText || "").slice(0, 1200),
            },
          }).catch(() => { /* audit never breaks a model call */ });
        }
        return parsed;
      } catch (e) {
        lastErr = e;
        const msg = e instanceof Error ? e.message : String(e);
        const transient = /meta_http_(429|5\d\d)/.test(msg)
          || /timeout|fetch failed|network/i.test(msg);
        if (!transient || attempt === DELAYS.length) break;
        await new Promise((r) => setTimeout(r, DELAYS[attempt]));
      }
    }
    if (deps.audit) {
      await deps.audit({
        kind: "model_error",
        subject: `${req.phase} ${model}`,
        summary: { phase: req.phase, model, duration_ms: Date.now() - firstStarted, error: lastErr instanceof Error ? lastErr.message.slice(0, 300) : String(lastErr).slice(0, 300) },
      }).catch(() => { /* ignore */ });
    }
    throw lastErr;
  }

  async function search(query: string, knownNames?: string[]): Promise<SearchHit[]> {
    const area = activeBrief ? serviceAreaFromGeos(activeBrief.primary_segment.geos) : undefined;
    // Circumstance memory: a burst that knows the run's found businesses
    // steers toward NEW organizations (bounded list, only when non-empty).
    const known = Array.isArray(knownNames) && knownNames.length > 0
      ? ` Already reported by earlier queries in this run (do NOT repeat them; find organizations NOT in this list): ${knownNames.slice(0, 15).join("; ")}.`
      : "";
    const req = buildPhaseRequest({
      phase: "discover",
      briefExcerpt: brief,
      phaseGoal: (activeBrief ? buildSearchGoal(activeBrief, query) : `Find businesses that match: ${query}. Wanted: buying businesses (offices, schools, clinics, hubs, venues). Never list caterers, food vendors, or recipe/blog pages. Reply ONLY a JSON array, one object per distinct business, no other text: [{"name": "real business name, max 8 words", "category": "1-3 words, e.g. Logistics", "fact": "one short evidence sentence about why they might buy", "url": "the result page url"}]. Example: [{"name": "Brightline Logistics", "category": "Logistics", "fact": "Runs a weekday lunch rota for 45 staff", "url": "https://brightline.ng/about"}]`) + known,
      searchContextSize: "low",
      maxToolCalls: 4,
      ...(area ? { serviceArea: area } : {}),
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
    // Per-prospect evidence (2026-11-03 shortlist collapse): the old prompt
    // shared a global slice of 30 evidence rows across 72 prospects, so most
    // prospects were judged with their OWN pages missing from the prompt and
    // were rejected for "no evidence". Each prospect now carries its own
    // evidence rows (bounded) so the model judges what we actually found.
    const evidenceFor = new Map<string, Array<{ claim: string; url: string | null; type: string }>>();
    for (const p of prospects) {
      const ownIds = new Set(p.evidence_ids);
      const own = evidence.filter((e) => ownIds.has(e.id)).slice(0, 4)
        .map((e) => ({ claim: e.claim.slice(0, 160), url: e.source_url, type: e.source_type }));
      evidenceFor.set(p.id, own);
    }
    const req = buildPhaseRequest({
      phase: "assess",
      briefExcerpt: brief,
      phaseGoal: activeBrief
        ? `Score each prospect 1-5 on five dimensions. ${renderBriefPrompt(activeBrief)} A prospect is an ORGANIZATION; score it as a route to the owner's buyers — icp_fit rewards organizations that can buy in bulk, carry or resell, host, or refer the offer to the buyers named in the brief (when those buyers are people, a prospect that reaches them is a GOOD fit, never a bad one for "not being" the buyer). Reply ONLY a JSON array: [{"prospect_id","fit_rating":1-5 overall,"supporting_claims":[claim text],"weakening_claims":[],"rationale":"why fit or not, citing specifics","dimensions":{"icp_fit":1-5 account match,"problem":1-5 pain relevance (1=contradicted or unclear),"readiness":1-5 dated buying trigger (1=none),"reachability":1-5 contact quality: an official site or business social profile counts as a usable route (1=none),"confidence":1-5 source quality},"contacts":{"person_name":"the contact person's name as published, or null","person_title":"their role, or null","socials":["full profile urls copied from the evidence, e.g. https://instagram.com/handle"]}}]. Extract contacts ONLY from the evidence text — never invent emails, phones, handles or names; socials must be real profile urls on instagram.com, facebook.com, x.com, twitter.com or linkedin.com that appear in the evidence. Band like the 504Yard rubric: a real organisation that visibly belongs to the segment is icp_fit 3 or more EVEN WHEN evidence is thin (band B: worthwhile, needs qualification); reserve icp_fit 1-2 for the wrong KIND only — listing portals, directories, review aggregators, unrelated trades, or one unattached person with no organisation. Thin evidence lowers confidence and readiness, never the band. An official website or business social profile means reachability 3+. problem 2 means the segment's standard pain plausibly applies and nothing contradicts it; 1 only when something in the evidence contradicts it. readiness 1 is NORMAL for a healthy account with no dated trigger published yet — it lowers the tier (warm-up), never the band; readiness 2+ only when the evidence names a dated trigger. Judge each prospect ONLY from its own evidence rows below; say "unverified" rather than inventing. Prospects (each with its own evidence): ${JSON.stringify(prospects.map((p) => ({ id: p.id, name: p.name, category: p.category, evidence: evidenceFor.get(p.id) ?? [] })))}.`
        : `Rate fit 1-5 for each prospect. Reply ONLY a JSON array: [{"prospect_id","fit_rating":1-5,"supporting_claims":[claim text],"weakening_claims":[],"rationale":"..."}]. Prospects: ${JSON.stringify(prospects.map((p) => ({ id: p.id, name: p.name, category: p.category, evidence: evidenceFor.get(p.id) ?? [] })))}.`,
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
      // Contact extraction (user request 2026-11-01): person + socials,
      // grounded later in code against the prospect's own evidence text.
      let contacts: AssessProposal["contacts"] | undefined;
      const cRaw = isRecord(item["contacts"]) ? (item["contacts"] as Record<string, unknown>) : null;
      if (cRaw) {
        const socials = Array.isArray(cRaw["socials"])
          ? (cRaw["socials"] as unknown[]).filter((u): u is string => typeof u === "string" && u.length <= 300).slice(0, 8)
          : [];
        contacts = {
          ...(typeof cRaw["person_name"] === "string" && cRaw["person_name"].trim() !== ""
            ? { person_name: (cRaw["person_name"] as string).trim().slice(0, 120) } : {}),
          ...(typeof cRaw["person_title"] === "string" && cRaw["person_title"].trim() !== ""
            ? { person_title: (cRaw["person_title"] as string).trim().slice(0, 120) } : {}),
          ...(socials.length > 0 ? { socials } : {}),
        };
      }
      out.push({
        prospect_id: pid,
        fit_rating: rating,
        supporting_claims: supporting,
        ...(weakening.length > 0 ? { weakening_claims: weakening } : {}),
        rationale: typeof item["rationale"] === "string" ? item["rationale"] : "",
        ...(dims ? { dimensions: dims } : {}),
        ...(contacts ? { contacts } : {}),
      });
    }
    return out;
  }

  async function proposeDrafts(prospects: Prospect[], evidence: Evidence[] = []): Promise<DraftProposal[]> {
    const ids = new Set(prospects.map((p) => p.id));
    // Per-prospect evidence (owner bug 2026-11-04: the prompt shared ONE
    // global slice of 40 evidence rows across all prospects — most
    // prospects' own pages were missing, the model could not cite them,
    // and the grounding audit skipped every ungrounded body: the studio's
    // "Write their messages now" wrote ZERO drafts). Each prospect now
    // carries its own evidence rows. Bursts are chunked to 12 prospects —
    // 40+ messages with variants in one reply truncated and lost rows.
    const evidenceFor = new Map<string, Array<{ id: string; claim: string; url: string | null }>>();
    for (const p of prospects) {
      const ownIds = new Set(p.evidence_ids);
      const own = evidence.filter((e) => ownIds.has(e.id)).slice(0, 5)
        .map((e) => ({ id: e.id, claim: e.claim.slice(0, 160), url: e.source_url }));
      evidenceFor.set(p.id, own);
    }
    const goalFor = (chunk: Array<{ id: string; name: string; category: string; contact_name?: string | null; evidence: Array<{ id: string; claim: string; url: string | null }> }>) => buildPhaseRequest({
      phase: "draft",
      briefExcerpt: brief,
      phaseGoal: activeBrief
        ? `Write one outreach draft per prospect. Each draft must follow: observed fact from the prospect's OWN evidence below, supported interpretation, pain hypothesis (say "might" or "often" when unverified), the offer, one low-friction ask. When the business's buyers are people (consumers), the prospect is a partner route — frame the ask as bulk order, stocking the line, hosting, or referring their audience, never as if the prospect were the end consumer. Never invent metrics, relationships, referrals, or internal knowledge. THE OFFER RULE: the offer sentence states what the business ACTUALLY sells, in the owner's own words from the brief (e.g. a grill house sells fresh grilled chicken, packed lunch packs and event catering). NEVER give the owner capabilities the brief does not state — no bookings growth, marketing, software, "client coordination" or consulting services; a message claiming services the brief does not mention is a FAILED draft. Every draft carries "angle": ONE sentence in the owner's voice naming the concrete connection between THIS prospect and the offer, using the right trade name for it (e.g. for a wedding venue: "Live event grilling for the weddings and corporate events you host"; for a corporate office: "Grill packs for your staff lunch days"; for a supermarket: "Stock our packaged grill packs"). Body rules: under 120 words, 2-4 short paragraphs, every line has text (never a line of only spaces). Reply ONLY a JSON array: [{"prospect_id","channel":"website_form|email|phone|social_profile|other","contact_value":"copied from the prospect's own evidence urls, never invented","subject":"...","body":"... must cite evidence ids from that prospect's own evidence list, like [${chunk[0] && chunk[0].evidence[0] ? chunk[0].evidence[0].id : "ev_x"}] ...","angle":"...","next_action":"...","follow_up_days":7,"supporting_ids":[evidence ids backing the claims],"variants":{"whatsapp":"<=60 words, casual and direct, greeting by name, no citations, no blank space lines","email":"<=120 words, professional, matches body but tighter","dm":"<=35 words, ultra casual for Instagram/TikTok"}}]. The variants are the messages the prospect actually receives on each channel — same facts, shaped for the channel. Business: ${renderBriefPrompt(activeBrief)} Prospects (each with its OWN evidence): ${JSON.stringify(chunk)}.`
        : `Write one outreach draft per prospect. Reply ONLY a JSON array: [{"prospect_id","channel":"website_form|email|phone|social_profile|other","contact_value":"copied from the evidence urls below, never invented","subject":"...","body":"... must cite evidence like [source 1] ...","next_action":"...","follow_up_days":7}]. Business: ${brief}. Prospects: ${JSON.stringify(chunk.map((p) => ({ id: p.id, name: p.name, category: p.category })))}. Evidence: ${JSON.stringify(chunk.flatMap((p) => p.evidence))}.`,
    });
    const out: DraftProposal[] = [];
    const CHUNK = 12;
    for (let i = 0; i < prospects.length; i += CHUNK) {
      const chunk = prospects.slice(i, i + CHUNK).map((p) => ({
        id: p.id, name: p.name, category: p.category, contact_name: p.contact_name ?? null,
        evidence: evidenceFor.get(p.id) ?? [],
      }));
      const req = goalFor(chunk);
      req.tools = []; // structured burst: answer in text, no tool loop offered
      const parsed = await callResponses(req);
      for (const item of extractJsonArray(parsed.outputText)) {
      if (!isRecord(item)) continue;
      const pid = item["prospect_id"];
      const body = item["body"];
      if (typeof pid !== "string" || !ids.has(pid)) continue;
      if (typeof body !== "string" || body.trim() === "") continue;
      const channel = item["channel"];
      const angle = typeof item["angle"] === "string" && item["angle"].trim() !== ""
        ? item["angle"].trim().slice(0, 240) : undefined;
      const supportingIds = Array.isArray(item["supporting_ids"])
        ? (item["supporting_ids"] as unknown[]).filter((x): x is string => typeof x === "string")
        : [];
      const vRaw = isRecord(item["variants"]) ? (item["variants"] as Record<string, unknown>) : null;
      let variants: DraftProposal["variants"];
      if (vRaw) {
        const pick = (v: unknown, cap: number): string | undefined =>
          typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, cap) : undefined;
        const built: { whatsapp?: string; email?: string; dm?: string } = {};
        const w = pick(vRaw["whatsapp"], 700);
        const e = pick(vRaw["email"], 1400);
        const dm = pick(vRaw["dm"], 400);
        if (w) built.whatsapp = w;
        if (e) built.email = e;
        if (dm) built.dm = dm;
        if (Object.keys(built).length > 0) variants = built;
      }
      out.push({
        prospect_id: pid,
        channel: typeof channel === "string" && (DRAFT_CHANNELS as readonly string[]).includes(channel)
          ? (channel as (typeof DRAFT_CHANNELS)[number])
          : "other",
        contact_value: typeof item["contact_value"] === "string" ? item["contact_value"] : "",
        subject: typeof item["subject"] === "string" ? item["subject"] : null,
        body,
        next_action: typeof item["next_action"] === "string" ? item["next_action"] : "Follow up manually",
        ...(angle ? { angle } : {}),
        ...(typeof item["follow_up_days"] === "number" && item["follow_up_days"] > 0
          ? { follow_up_days: Math.floor(item["follow_up_days"]) }
          : {}),
        ...(supportingIds.length > 0 ? { supporting_ids: supportingIds } : {}),
        ...(variants && Object.keys(variants).length > 0 ? { variants } : {}),
      });
      }
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
   * QA-loop replan: the judge reports; THIS stays the planner. The goal is
   * the full buildPlanGoal prompt (the same one that planned sweep 1) plus
   * the gate's report — never a weaker ad-hoc goal (owner direction
   * 2026-11-03: sweep-2 junk came from the thin replan prompt).
   */
  async function planMore(input: { previousQueries: string[]; whyNot: string }): Promise<string[]> {
    if (!activeBrief) {
      const goal = [
        `The previous search sweep fell short: ${input.whyNot}`,
        `Already searched (do NOT repeat): ${input.previousQueries.join(" | ")}.`,
        "Write up to 8 NEW search queries for better-fitting buyers, same locale, different wording. Reply ONLY a JSON array of search query strings.",
      ].join("\n");
      const req = buildPhaseRequest({ phase: "plan", briefExcerpt: brief, phaseGoal: goal });
      req.tools = [];
      const parsed = await callResponses(req);
      return extractJsonArray(parsed.outputText)
        .filter((q): q is string => typeof q === "string" && q.trim() !== "")
        .map((q) => q.trim())
        .slice(0, MAX_PLAN_QUERIES_OUT);
    }
    const goal = [
      "A quality gate reviewed the previous sweep and requests more candidates from you (you are the planner; the gate never writes queries).",
      `Gate report: ${input.whyNot}`,
      `Already searched (do NOT repeat or reword these): ${input.previousQueries.join(" | ")}.`,
      buildPlanGoal(activeBrief),
      "Write up to 8 NEW search queries that obey every rule above, inside the brief's directive categories and segment industries. Prefer the query shapes behind the good candidates in the report; avoid the shapes behind the junk names. Reply ONLY a JSON array of search query strings.",
    ].join("\n");
    const req = buildPhaseRequest({ phase: "plan", briefExcerpt: brief, phaseGoal: goal });
    req.tools = [];
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
  ): Promise<{ text: string; socials?: string[] } | { failure: "blocked" | "empty" | "timeout"; detail: string }> {
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
    const html = await res.text();
    // Social-link harvest: the lead's own page declares its profiles in the
    // markup (footer usually) — visible text often omits them. Grounded by
    // construction: these come from the prospect's own page.
    const socials = new Set<string>();
    const re = /https?:\/\/(?:www\.)?(instagram\.com|facebook\.com|fb\.com|x\.com|twitter\.com|linkedin\.com|tiktok\.com)\/[A-Za-z0-9_.\-/]{1,60}/gi;
    for (const m of html.matchAll(re)) {
      const u = m[0].replace(/[)\]}"'?#,;]+$/, "");
      if (u.length <= 100) socials.add(u);
    }
    const harvested = [...socials].slice(0, 8);
    // Member-link harvest for directory explosion (owner direction
    // 2026-11-03, borrowed from ArinaBreeze): anchor href+text pairs let
    // discover turn one directory page into many real-business candidates.
    // Bounded, deduped by url, best-effort.
    const linkPairs = new Map<string, string>();
    const reA = /<a\b[^>]*href\s*=\s*"(https?:\/\/[^"]+)"[^>]*>([\s\S]{0,160}?)<\/a>/gi;
    for (const m of html.matchAll(reA)) {
      const href = m[1] ?? "";
      const text = extractVisibleText(m[2] ?? "").trim().slice(0, 80);
      if (!href || !text || text.length < 3 || linkPairs.has(href)) continue;
      linkPairs.set(href, text);
    }
    const links = [...linkPairs.entries()].slice(0, 80).map(([url, text]) => ({ url, text }));
    return {
      text: extractVisibleText(html).slice(0, FETCH_TEXT_CAP),
      ...(harvested.length > 0 ? { socials: harvested } : {}),
      ...(links.length > 0 ? { links } : {}),
    };
  }

  let activeBrief: CommercialBrief | null = null;

  async function onboardTurn(input: OnboardTurnInput): Promise<OnboardTurnResult> {
    const known = input.known.map((k) => `${k.key}=${k.value} (${k.label})`).join("; ");
    const geo = input.geo_context
      ? ` Network context (from the visitor's own request, use it SILENTLY: complete places they name with it and store the fuller form - "Ikeja" with a "${input.geo_context}" context becomes "Ikeja, Lagos, Nigeria" in service_area; never mention, quote or ask about this context): visitor network appears to be in ${input.geo_context}.`
      : "";
    const site = input.site
      ? ` The owner shared their website ${input.site.url}. Its page text says: "${input.site.text.slice(0, 2200)}". MINE IT FIRST: fill the business name ("name"), what they sell (offering), who buys (ideal_customer), where they serve (service_area), and anything else the page answers - label every site-sourced field "inferred". NEVER ask a question the page already answers (asking for the business name or the offer when the site states them is forbidden). Extract even when the owner's reply was short.`
      : "";
    const req = buildPhaseRequest({
      phase: "plan",
      briefExcerpt: brief || "New business onboarding.",
      phaseGoal: `Extract facts about the owner's business from their reply. Reply ONLY a JSON object: {"fields": {key: {"value": "...", "label": "inferred"}}, "name": "the business name the owner stated, or empty string", "question": {"key": "...", "prompt": "...", "chips": ["a", "b"]} | null, "done": true|false}. Rules: use ONLY these keys: ${ONBOARD_FIELD_KEYS.join(", ")}. Extract only facts stated or clearly implied by the owner; never invent values. Label every extracted field "inferred". Sharp memory - Known plus the owner's words are ONE memory, and the owner volunteers facts no question asked for: "504 yards Grills and Drinks sell grilled chicken to individuals, corporate events" already names the business (504 yards Grills and Drinks), the offer (grilled chicken), AND the buyers (individuals, corporate event organisers) - extract ALL of them in that single turn and ask nothing. Put any stated business name in "name". NEVER ask for the business name when the words contain any name-like phrase ('X Grills', 'Y Services', 'my company Z'); extract it as inferred and let the owner edit on the summary - asking for a stated name is forbidden. When the owner's words state a place the business serves ("offices in Ikeja"), extract it into service_area immediately — asking for a place they just said is forbidden (refining a bare place to its fuller areas is allowed, and shows the noted value). Never spend a question confirming something you can already extract: the owner confirms and edits every field on the summary screen. Each field may be asked about at most once in the whole conversation; a field in Known with a value is ANSWERED, never re-asked, not even to confirm or refine. Only ask about a fact that is still missing AND material, at most one per turn. Think like a sales strategist: read the whole reply before asking anything. ASSUME-NEVER-ASK rule: decision_maker, order_size, budget and timeline are NEVER asked - for any small business the owner decides purchases unless their words say otherwise, so set decision_maker inferred ("the owner decides purchases") and leave the others to the summary screen as editable assumptions; asking about them wastes a turn the owner trusted you with. Location rule: "area, city" or "city, state" (e.g. "Ikeja, Lagos") is a COMPLETE service_area - the country is never worth a follow-up on its own; a street address is fine too ("Kodesoh Street, Ikeja"). Some businesses are purely online or serve nationwide/worldwide: record what the owner says ("Worldwide"/"Online" are valid values), plus stated reach alongside a base. Never invent a base or a reach. Ask AT MOST ONE follow-up question about the most important missing fact (${input.followups_used} of 3 used); set "done": true with "question": null when nothing material is missing. Keep prompts plain and short. Known so far: ${known || "nothing"}.${geo}${site} Owner's reply: ${JSON.stringify(input.text)}.`,
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
    return validateOnboardTurn(item);
  }

  async function rewriteDraft(input: RewriteInput): Promise<RewriteResult> {
    const guide = REWRITE_TONE_GUIDE[input.tone] ?? REWRITE_TONE_GUIDE["another"];
    const req = buildPhaseRequest({
      phase: "plan",
      briefExcerpt: brief || "Outreach draft rewrite.",
      phaseGoal: `${guide} Keep every fact, name and number exactly as written; change only wording and tone. Keep it under 80 words. Reply ONLY a JSON object: {"subject": "...", "body": "..."}. Channel: ${input.channel}. Subject: ${JSON.stringify(input.subject)}. Body: ${JSON.stringify(input.body)}.`,
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
    return validateRewrite(item);
  }

  /** Rewrite a stored draft into ONE channel's shape (user report 2026-11-02:
   * drafts written before per-channel variants existed stay long on the
   * WhatsApp tab; this tightens them in place — no new campaign needed). */
  async function retuneVariant(input: RetuneInput): Promise<string> {
    const shape: Record<string, string> = {
      whatsapp: "Rewrite for WhatsApp: warm, plain, human. Greeting + one observed fact + one small ask. At most 60 words. No subject line, no markdown.",
      email: "Rewrite as an email: a short human body of at most 120 words. Keep it specific, no markdown lists.",
      dm: "Rewrite as an Instagram or TikTok direct message: at most 35 words, casual, one clear ask.",
    };
    const req = buildPhaseRequest({
      phase: "plan",
      briefExcerpt: brief || "Outreach draft channel tune.",
      phaseGoal: `${shape[input.channel_target] ?? shape["whatsapp"]} Keep every fact, name and number exactly as written; change only shape and wording. Do not add new claims or names. Reply ONLY a JSON object: {"text": "..."}. Subject: ${JSON.stringify(input.subject)}. Message: ${JSON.stringify(input.body)}.`,
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
    const text = item && typeof item === "object" && !Array.isArray(item) &&
        typeof (item as Record<string, unknown>)["text"] === "string"
      ? ((item as Record<string, unknown>)["text"] as string).trim()
      : "";
    if (!text) throw new Error("retune burst did not return text");
    return text;
  }

  async function buildBrief(profile: {
    name: string; website_url: string; description: string;
    target_market: string; service_area_note: string; constraints_note: string;
  }): Promise<CommercialBrief> {
    const goal = buildBriefGoal(profile);
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

  return { planQueries, planMore, search, proposeAssessments, proposeDrafts, fetchPage, buildBrief, setBrief, onboardTurn, rewriteDraft, retuneVariant, modelId: model };
}
