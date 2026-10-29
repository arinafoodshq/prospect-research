import { describe, expect, it, vi } from "vitest";
import { cleanBusinessName, createMetaClient, isDirectoryHost, isPlausibleName, normUrl, parseResponsesResponse, serviceAreaFromGeos } from "../src/meta";
import s0Fixture from "./fixtures/s0_ikeja_venues.json";

describe("parseResponsesResponse", () => {
  describe("(a) real S-0 fixture", () => {
    it("parses searches, results, usage, and tolerates zero citations", () => {
      const parsed = parseResponsesResponse(s0Fixture);
      expect(parsed.responseId).toBe("resp_6ae2617de99e35614d804a71");
      expect(parsed.searchNotRun).toBe(false);
      expect(parsed.searches).toHaveLength(3);
      expect(parsed.searches[0]?.id).toBe(
        "ws_call_045e0e14-670d-492b-a5ff-23647e54d7aa",
      );
      for (const s of parsed.searches) {
        expect(s.status).toBe("completed");
        expect(s.results.length).toBeGreaterThan(0);
        for (const r of s.results) {
          expect(typeof r.title).toBe("string");
          expect(typeof r.url).toBe("string");
        }
      }
      expect(parsed.searches[0]?.results[0]?.url).toContain(
        "nigeriapropertycentre.com",
      );
      // Zero citations tolerated: fixture has no url_citation annotations.
      expect(parsed.citations).toEqual([]);
      expect(parsed.outputText).toContain("Three corporate event options");
      expect(parsed.usage).toEqual({
        input_tokens: 10615,
        output_tokens: 7741,
      });
    });
  });

  describe("(b) zero-search payload", () => {
    it("yields searchNotRun true, never an error", () => {
      const body = {
        id: "resp_none",
        output: [
          {
            type: "message",
            content: [
              { type: "output_text", text: "hello", annotations: [] },
            ],
          },
        ],
        usage: { input_tokens: 1, output_tokens: 2 },
      };
      let parsed;
      expect(() => {
        parsed = parseResponsesResponse(body);
      }).not.toThrow();
      expect(parsed!.searchNotRun).toBe(true);
      expect(parsed!.searches).toEqual([]);
      expect(parsed!.citations).toEqual([]);
      expect(parsed!.outputText).toBe("hello");
    });

    it("missing output also yields searchNotRun true", () => {
      const parsed = parseResponsesResponse({ id: "resp_empty" });
      expect(parsed.searchNotRun).toBe(true);
      expect(parsed.searches).toEqual([]);
    });
  });

  describe("(c) citations and function calls", () => {
    it("parses url_citation annotations and function_call items onto the right fields", () => {
      const body = {
        id: "resp_mixed",
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: "answer",
                annotations: [
                  {
                    type: "url_citation",
                    url: "https://example.com/a",
                    title: "A",
                    start_index: 0,
                    end_index: 6,
                  },
                  { type: "other", url: "https://example.com/ignored" },
                ],
              },
            ],
          },
          {
            type: "function_call",
            name: "rs.save_evidence",
            call_id: "call_1",
            arguments: '{"a":1}',
          },
        ],
        usage: { input_tokens: 5, output_tokens: 6 },
      };
      const parsed = parseResponsesResponse(body);
      expect(parsed.citations).toEqual([
        {
          url: "https://example.com/a",
          title: "A",
          start_index: 0,
          end_index: 6,
        },
      ]);
      expect(parsed.functionCalls).toEqual([
        {
          name: "rs.save_evidence",
          call_id: "call_1",
          arguments: '{"a":1}',
        },
      ]);
      expect(parsed.searchNotRun).toBe(true);
    });

    it("citation without optional fields parses with url only", () => {
      const body = {
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: "x",
                annotations: [{ type: "url_citation", url: "https://example.com/b" }],
              },
            ],
          },
        ],
      };
      const parsed = parseResponsesResponse(body);
      expect(parsed.citations).toEqual([{ url: "https://example.com/b" }]);
    });
  });

  describe("(d) malformed input", () => {
    it.each([null, undefined, "nope", 42, true])(
      "non-object body %p yields the empty outcome, never throws",
      (bad) => {
        let parsed;
        expect(() => {
          parsed = parseResponsesResponse(bad);
        }).not.toThrow();
        expect(parsed!).toEqual({
          responseId: null,
          outputText: "",
          searches: [],
          citations: [],
          searchNotRun: false,
          functionCalls: [],
          usage: { input_tokens: 0, output_tokens: 0 },
        });
      },
    );

    it("missing output and bad annotation shapes yield empty outcome, never throw", () => {
      const cases: unknown[] = [
        {},
        { output: null },
        { output: "oops" },
        { output: [null, 42, "x", { noType: true }] },
        {
          output: [
            {
              type: "message",
              content: [
                { type: "output_text", annotations: [{ type: "url_citation" }] },
                null,
                "junk",
                { type: "output_text", text: 7, annotations: "bad" },
                {
                  type: "output_text",
                  text: "ok",
                  annotations: [null, "x", { type: "url_citation", url: 123 }],
                },
              ],
            },
          ],
        },
        {
          output: [
            { type: "web_search_call", results: "bad" },
            { type: "function_call" },
          ],
        },
      ];
      for (const body of cases) {
        let parsed;
        expect(() => {
          parsed = parseResponsesResponse(body);
        }).not.toThrow();
        expect(parsed!.responseId).toBeNull();
        expect(Array.isArray(parsed!.searches)).toBe(true);
        expect(Array.isArray(parsed!.citations)).toBe(true);
        expect(Array.isArray(parsed!.functionCalls)).toBe(true);
      }
      // Spot-check defaults on the fully-empty body.
      const empty = parseResponsesResponse({});
      expect(empty.outputText).toBe("");
      expect(empty.usage).toEqual({ input_tokens: 0, output_tokens: 0 });
      // url_citation with non-string url degrades to empty url, never throws.
      const badUrl = parseResponsesResponse({
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: "ok",
                annotations: [{ type: "url_citation", url: 123 }],
              },
            ],
          },
        ],
      });
      expect(badUrl.citations).toEqual([{ url: "" }]);
    });
  });
});

function stubFetch(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  }));
}

const SEARCH_LINE_FIXTURE = {
  id: "resp_lines",
  output: [
    {
      type: "web_search_call",
      id: "ws_1",
      status: "completed",
      results: [
        { title: "Brightline Ltd - Logistics", url: "https://brightline.ng/about", snippet: "weekday lunch rota" },
        { title: "Unknown Shop", url: "https://unknown.ng/", snippet: "we sell things" },
      ],
    },
    {
      type: "message",
      content: [
        {
          type: "output_text",
          text: '[{"name": "Brightline Ltd", "category": "Logistics", "fact": "Runs a weekday lunch rota", "url": "https://brightline.ng/about"}, {"name": "Ghost Co", "category": "Retail", "fact": "Fake line", "url": "https://ghost.invalid/x"}]',
          annotations: [],
        },
      ],
    },
  ],
  usage: { input_tokens: 10, output_tokens: 20 },
};

describe("business-name gate", () => {
  it.each([
    "Paystack x Stripe",
    "ContourGlobal Solutions Nigeria Limited in the city Ikeja",
    "Vicsum Nursery Primary Private Schools",
    "Mind Builders Nursery and School, Ikeja, Lagos, Nigeria",
    "The Plectrum Hub",
    "GitHub",
    "Brightline Ltd",
    "Air Peace",
    "Dervac Technologies",
    "Best Buy",
  ])("accepts %s", (name) => {
    expect(isPlausibleName(name)).toBe(true);
  });

  it.each([
    "Commercial office",
    "company in LAGOS",
    "Obafemi Awolowo Way, Ikeja, Lagos, Nigeria",
    "Find & Research Hospitals Companies in Ikeja",
    "Private Primary Schools in Ikeja",
    "Coworking Space in the Lagos State",
    "A comprehensive list of co-working spaces across Lagos",
    "Hunting for great bulk catering leads today",
    "Office lunch pack hunt is on — pulling bulk catering prospects.Found strong leads",
    "COMPANY REGISTRATION OFFICE IN LAGOS NIGERIA",
    "Conglomerates in Ikeja",
    "Serviced Office Spaces in Ikeja",
    "Find & Research Retailing Companies in Ikeja",
    "Office Spaces for Rent in Ikeja",
    "Unfurnished Office Spaces for Sale in Lagos",
    "List of 7,526 Registered Companies in Ikeja",
    "Lagoon Clinics is a private Hospital/clinic in Ikeja",
    "Find & Research Utilities Companies in Ikeja",
    "We Just Opened Our Biggest Office Yet",
    "Lagos firm to launch new e-commerce platform",
    "Lagos firm unveils new e-commerce portal",
    "Office Support Staff",
    "Inventory Personnel at Gadgethutng",
    "Customer Service & Sales Officer",
    "Best Software Company in Lagos reviews",
    "Top 9 Best Secondary schools in",
    "4Bedroom in",
    "Self Contain for Rent in Ikeja: Affordable Apartments",
    "Ogba, Lagos: Area Guide",
    "Ogba Neighbourhood Guide",
    "Oba akran, Ikeja: Area Guide",
    "Omole Phase 2, Lagos: Area Guide",
    "iambeejayayo/tech-hubs",
    "Top 10 Dental Clinics",
    "Medical",
    "Office Spaces on Mobolaji Bank Anthony Way",
    "296 Square Meters Office Space",
    "Compliance at Paystack",
    "Modern online and offline payments for Africa",
    "Best Online Payment Gateways",
    "Top fintech companies in Nigeria and their details",
    "Top Paystack Alternatives, Competitors",
    "Founder Institute Lagos Produces 11 New Technology Companies",
    "Find Emails and Phone Numbers of Office Assistants",
    "The Best Cross Platform Companies",
    "Best Web Developers",
    "Top 12 sites like emeraldschools.com",
    "Olaspar's Posts",
    "aftal.org Alternatives",
    "SINCE 1958",
    "For Rent: Premium Furnished 220sqm Office Space",
    "Lagos shuts Chrisland School over death of student",
    "Closure of Chrisland School",
    "Ikeja, Nigeria Fertility Clinics",
    "Ikeja, Nigeria In Vitro Fertilization Fertility Clinics",
    "Contact Angela Irabor, Email: i***@grangeschool.com",
    "Current Recruitment at Grange School",
    "Teachers at Grange School",
    "HOSPITAL CITY STATE",
    "Introducing the DUCHESS International Hospital,",
    "Commercial Office Building",
  ])("rejects %s", (name) => {
    expect(isPlausibleName(name)).toBe(false);
  });

  it("strips location tails and city cruft", () => {
    expect(cleanBusinessName("Mind Builders Nursery and School, Ikeja, Lagos, Nigeria")).toBe(
      "Mind Builders Nursery and School",
    );
    expect(cleanBusinessName("ContourGlobal Solutions Nigeria Limited in the city Ikeja")).toBe(
      "ContourGlobal Solutions Nigeria Limited",
    );
    expect(cleanBusinessName("Greenhands GRA Ikeja Lagos Nigeria")).toBe("Greenhands");
    expect(cleanBusinessName("Ikeja Hotel Plc")).toBe("Ikeja Hotel Plc");
    expect(cleanBusinessName("Temple School in")).toBe("Temple School");
    expect(cleanBusinessName("The Leabridge School, IKeja in")).toBe("The Leabridge School");
    expect(cleanBusinessName("Air Peace Lagos Office in Ikeja")).toBe("Air Peace Lagos Office");
  });

  it("normalizes urls for result matching", () => {
    expect(normUrl("https://WWW.Example.ng/About/")).toBe("example.ng/About");
    expect(normUrl("https://example.ng/About")).toBe("example.ng/About");
    expect(normUrl("not a url")).toBe("not a url");
  });

  it("flags directory hosts as evidence-only", () => {
    expect(isDirectoryHost("https://www.finelib.com/lagos/xyz")).toBe(true);
    expect(isDirectoryHost("https://businesslist.com.ng/company/123")).toBe(true);
    expect(isDirectoryHost("https://ng.indeed.com/viewjob?jk=1")).toBe(true);
    expect(isDirectoryHost("https://en.wikipedia.org/wiki/Lagos")).toBe(true);
    expect(isDirectoryHost("https://www.konga.com/product/123")).toBe(true);
    expect(isDirectoryHost("https://www.jumia.com.ng/xyz")).toBe(true);
    expect(isDirectoryHost("https://brightline.ng/about")).toBe(false);
    expect(isDirectoryHost("https://www.coworker.com/lagos/godo-hub")).toBe(false);
  });
});

describe("createMetaClient", () => {
  it("search maps results to validated hits and drops urls outside the result set", async () => {
    const fetchImpl = stubFetch(SEARCH_LINE_FIXTURE);
    const client = createMetaClient({ apiKey: "test-key", fetchImpl: fetchImpl as any });
    const hits = await client.search!("catering buyers Ikeja");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, Record<string, any>];
    expect(url).toContain("api.meta.ai");
    expect(init.headers["Authorization"]).toBe("Bearer test-key");
    const sent = JSON.parse(init.body as string);
    expect(sent.tools).toHaveLength(1);
    expect(sent.tools[0].type).toBe("web_search");
    // Ghost Co's url is not in results[] so its line is dropped; Unknown Shop
    // falls back to a title-derived hit with honest unclassified category.
    expect(hits.map((h) => h.name)).toEqual(["Brightline Ltd", "Unknown Shop"]);
    expect(hits[0]).toMatchObject({
      category: "Logistics",
      quote: "weekday lunch rota",
      source_url: "https://brightline.ng/about",
    });
    expect(hits[1].category).toBe("unclassified");
  });

  it("flags chatter names as evidence-only and demotes query-echo categories", async () => {
    const fetchImpl = stubFetch({
      id: "resp_chatter",
      output: [
        {
          type: "web_search_call",
          id: "ws_1",
          status: "completed",
          results: [
            { title: "Real fit body", url: "https://real.ng/", snippet: "real snippet" },
            { title: "This Is An Absurdly Long Page Title That No Real Business Would Ever Use", url: "https://long.ng/", snippet: "long snippet" },
          ],
        },
        {
          type: "message",
          content: [{
            type: "output_text",
            text: '[{"name": "Hunting for great bulk catering leads today", "category": "corporate offices bulk office lunch packs catering", "fact": "Some fact", "url": "https://real.ng/"}]',
            annotations: [],
          }],
        },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const client = createMetaClient({ apiKey: "k", fetchImpl: fetchImpl as any });
    const hits = await client.search!("q");
    // Parsed line kept for evidence but flagged: sentence-like name.
    expect(hits[0].candidateEligible).toBe(false);
    expect(hits[0].category).toBe("unclassified");
    // Junk fallback title likewise flagged, never silently dropped.
    expect(hits[1].candidateEligible).toBe(false);
    expect(hits).toHaveLength(2);
  });

  it("search returns [] when the search ran with zero results", async () => {
    const fetchImpl = stubFetch({
      id: "resp_empty",
      output: [{ type: "web_search_call", id: "ws_1", status: "completed", results: [] }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const client = createMetaClient({ apiKey: "k", fetchImpl: fetchImpl as any });
    await expect(client.search!("q")).resolves.toEqual([]);
  });

  it("search surfaces HTTP errors with status, never silent []", async () => {
    const fetchImpl = stubFetch({ error: "slow down" }, 429);
    const client = createMetaClient({ apiKey: "k", fetchImpl: fetchImpl as any });
    await expect(client.search!("q")).rejects.toThrow("429");
  });

  it("exposes the configured model id", () => {
    expect(createMetaClient({ apiKey: "k" }).modelId).toBe("muse-spark-1.3");
    expect(createMetaClient({ apiKey: "k", modelId: "custom-model" }).modelId).toBe("custom-model");
  });

  it("fetchPage strips scripts and tags to visible text (run_99840398 HTML soup)", async () => {
    const html = '<!DOCTYPE html><html><head><script>var x=1;alert("hi");</script><style>.a{color:red}</style></head><body><h1>Ashluxury Boutique</h1><p>Call 0803 123 4567 for orders &amp; delivery.</p></body></html>';
    const fetchImpl = vi.fn(async () => new Response(html, {
      status: 200, headers: { "content-type": "text/html" },
    }));
    const client = createMetaClient({ apiKey: "k", fetchImpl: fetchImpl as any });
    const res = await client.fetchPage!("https://ashluxury.ng/", 5000);
    expect(res).toHaveProperty("text");
    const text = (res as { text: string }).text;
    expect(text).toContain("Ashluxury Boutique");
    expect(text).toContain("0803 123 4567");
    expect(text).toContain("&");
    expect(text).not.toContain("<");
    expect(text).not.toContain("var x");
    expect(text).not.toContain("color:red");
  });

  it("proposeAssessments parses JSON proposals and drops invalid entries", async () => {
    const fetchImpl = stubFetch({
      id: "resp_a",
      output: [{
        type: "message",
        content: [{
          type: "output_text",
          text: '```json\n[{"prospect_id":"pr_1","fit_rating":4,"supporting_claims":["rota"],"rationale":"good"},{"prospect_id":"pr_x","fit_rating":9,"rationale":"bad"}]\n```',
          annotations: [],
        }],
      }],
      usage: { input_tokens: 5, output_tokens: 5 },
    });
    const client = createMetaClient({ apiKey: "k", fetchImpl: fetchImpl as any });
    const out = await client.proposeAssessments!(
      [{ id: "pr_1" } as any],
      [{ id: "ev_1", claim: "rota claim" } as any],
    );
    expect(out).toEqual([{ prospect_id: "pr_1", fit_rating: 4, supporting_claims: ["rota"], rationale: "good" }]);
    const sentAssess = JSON.parse((fetchImpl.mock.calls[0] as any[])[1].body as string);
    expect(sentAssess.tools).toEqual([]);
  });

  it("assess burst shows the model evidence urls + types (run_5538b2b3 reachability blindness)", async () => {
    const fetchImpl = stubFetch({
      id: "resp_au",
      output: [{
        type: "message",
        content: [{
          type: "output_text",
          text: '[{"prospect_id":"pr_1","fit_rating":4,"supporting_claims":["x"],"rationale":"y","dimensions":{"icp_fit":4,"problem":4,"readiness":3,"reachability":4,"confidence":4}}]',
          annotations: [],
        }],
      }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const client = createMetaClient({ apiKey: "k", fetchImpl: fetchImpl as any });
    await client.proposeAssessments!(
      [{ id: "pr_1" } as any],
      [{ id: "ev_1", claim: "ig page", source_url: "https://instagram.com/shop", source_type: "fetched_page" } as any],
    );
    const sent = JSON.parse((fetchImpl.mock.calls[0] as any[])[1].body as string);
    const input = JSON.stringify(sent.input);
    expect(input).toContain("https://instagram.com/shop");
    expect(input).toContain("fetched_page");
  });

  it("draft burst shows the model evidence urls for contact grounding", async () => {
    const fetchImpl = stubFetch({
      id: "resp_du",
      output: [{
        type: "message",
        content: [{
          type: "output_text",
          text: '[{"prospect_id":"pr_1","channel":"social_profile","contact_value":"https://instagram.com/shop","body":"Hi [ev_1]","next_action":"Send"}]',
          annotations: [],
        }],
      }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const client = createMetaClient({ apiKey: "k", fetchImpl: fetchImpl as any });
    await client.proposeDrafts!(
      [{ id: "pr_1" } as any],
      [{ id: "ev_1", claim: "ig page", source_url: "https://instagram.com/shop" } as any],
    );
    const sent = JSON.parse((fetchImpl.mock.calls[0] as any[])[1].body as string);
    expect(JSON.stringify(sent.input)).toContain("https://instagram.com/shop");
  });

  it("proposeDrafts validates channels and keeps unmarked bodies for code-level linking", async () => {
    // Was: bracket-marker regex gate. Dropped after run_de5e566e wrote 0
    // drafts: the regex rejected semantically grounded drafts, and silence
    // is worse than a linked draft. draft() now fuzzy-links each body to
    // the prospect's own evidence and skips only the unlinked.
    const fetchImpl = stubFetch({
      id: "resp_d",
      output: [{
        type: "message",
        content: [{
          type: "output_text",
          text: '[{"prospect_id":"pr_1","channel":"pigeon","contact_value":"x","body":"Hi [ev_1]","next_action":"Send"},{"prospect_id":"pr_1","channel":"email","contact_value":"y","body":"Hi without marker","next_action":"Send"}]',
          annotations: [],
        }],
      }],
      usage: { input_tokens: 5, output_tokens: 5 },
    });
    const client = createMetaClient({ apiKey: "k", fetchImpl: fetchImpl as any });
    const out = await client.proposeDrafts!([{ id: "pr_1" } as any]);
    expect(out).toHaveLength(2);
    expect(out[0].channel).toBe("other");
    expect(out[1].channel).toBe("email");
    const sentDraft = JSON.parse((fetchImpl.mock.calls[0] as any[])[1].body as string);
    expect(sentDraft.tools).toEqual([]);
  });

  it("search sends user_location from the brief geos (run_de5e566e Philly drift)", async () => {
    const fetchImpl = stubFetch(SEARCH_LINE_FIXTURE);
    const client = createMetaClient({ apiKey: "k", fetchImpl: fetchImpl as any });
    client.setBrief!({
      primary_segment: {
        label: "Lagos retail", industries: ["retail"], geos: ["Lagos, Nigeria"], exclusions: [],
      },
    } as any);
    await client.search!("retail lagos");
    const sent = JSON.parse((fetchImpl.mock.calls[0] as any[])[1].body as string);
    expect(sent.tools[0].type).toBe("web_search");
    expect(sent.tools[0].user_location).toMatchObject({ city: "Lagos", type: "approximate" });
  });

  it("serviceAreaFromGeos parses city-led geos, ISO-only country", () => {
    expect(serviceAreaFromGeos(["Lagos, Nigeria"])).toEqual({ city: "Lagos" });
    expect(serviceAreaFromGeos(["Lagos", "Nigeria"])).toEqual({ city: "Lagos" });
    expect(serviceAreaFromGeos(["Austin, US"])).toEqual({ city: "Austin", country: "US" });
    expect(serviceAreaFromGeos([])).toBeUndefined();
  });

  it("planQueries returns at most 8 non-empty strings", async () => {
    const fetchImpl = stubFetch({
      id: "resp_p",
      output: [{
        type: "message",
        content: [{ type: "output_text", text: JSON.stringify(["q1", "", 42, "q2", "q3", "q4", "q5", "q6", "q7", "q8", "q9"]), annotations: [] }],
      }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const client = createMetaClient({ apiKey: "k", fetchImpl: fetchImpl as any });
    await expect(client.planQueries!("excerpt")).resolves.toEqual(["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8"]);
  });

  it("fetchPage maps ok/timeout/blocked honestly", async () => {
    const okImpl = vi.fn(async () => new Response("hello page", { status: 200 }));
    const client = createMetaClient({ apiKey: "k", fetchImpl: okImpl as any });
    await expect(client.fetchPage!("https://example.com/", 50)).resolves.toEqual({ text: "hello page" });
    const blocked = createMetaClient({ apiKey: "k", fetchImpl: (async () => new Response("no", { status: 403 })) as any });
    await expect(blocked.fetchPage!("https://example.com/", 50)).resolves.toMatchObject({ failure: "blocked" });
    const missing = createMetaClient({ apiKey: "k", fetchImpl: (async () => new Response("no", { status: 404 })) as any });
    await expect(missing.fetchPage!("https://example.com/", 50)).resolves.toMatchObject({ failure: "empty" });
    const down = createMetaClient({ apiKey: "k", fetchImpl: (async () => { throw new Error("boom"); }) as any });
    await expect(down.fetchPage!("https://example.com/", 50)).resolves.toMatchObject({ failure: "timeout" });
  });
});
