/**
 * product/tests/research.test.ts — research loop tests with mocked deps.
 * No live model calls, no network: MetaClient surface is stubbed per test and
 * D1 is an in-memory mock implementing prepare/bind/first/all/run over the
 * SQL subset used by src/db.ts (SELECT with `col = ?` filters, INSERT, UPDATE).
 */
import { describe, expect, it, vi } from "vitest";
import type { Db } from "../src/db";
import {
  listEvidence,
  listProspects,
  saveAssessment,
  saveCandidate,
  saveEvidence,
  setProspectStatus,
} from "../src/db";
import { budgetReason, DEFAULT_CAPS, emptyConsumed } from "../src/research/budgets";
import {
  assess,
  briefGateDecision,
  discover,
  draft,
  draftGateDecision,
  investigate,
  listAssessments,
  plan,
  rank,
  runQuality,
  type BudgetState,
  type Prospect,
} from "../src/research/phases";
import { dedupeKey, type Assessment, type Evidence, type ProspectStatus } from "../src/db";
import { hydrateBriefFromRun, ResearchWorkflow } from "../src/orchestrator";

type Row = Record<string, any>;

// --- In-memory D1 mock -------------------------------------------------------

function makeMockDb() {
  const tables: Record<string, Row[]> = {
    business_profile: [],
    research_run: [],
    evidence: [],
    prospect: [],
    assessment: [],
    contact_route: [],
    outreach_draft: [],
    activity: [],
  };

  const tableOf = (sql: string): string => {
    const m = /from\s+(\w+)/i.exec(sql);
    if (!m) throw new Error(`mock: no FROM in ${sql}`);
    return m[1];
  };
  const condCols = (where: string): string[] =>
    [...where.matchAll(/(\w+)\s*=\s*\?/g)].map((m) => m[1]);

  function select(sql: string, params: any[]): Row[] {
    const rows = tables[tableOf(sql)] ?? [];
    const where = sql.split(/where/i).slice(1).join(" where ");
    const cols = condCols(where);
    if (cols.length === 0) return rows.map((r) => ({ ...r }));
    return rows
      .filter((r) => cols.every((c, i) => r[c] === params[i]))
      .map((r) => ({ ...r }));
  }

  function mutate(sql: string, params: any[]): void {
    const insert = /insert\s+into\s+(\w+)\s*\(([^)]+)\)/i.exec(sql);
    if (insert) {
      const [, table, colList] = insert;
      const cols = colList.split(",").map((c) => c.trim());
      // Model D1 VALUES semantics: `?` consumes the next bound param, SQL
      // literals ('candidate', NULL, 0, ...) map directly (src/db.ts writers
      // mix both forms, e.g. saveCandidate's status/rank literals).
      const valuesPart = /values\s*\(([^)]+)\)/i.exec(sql)?.[1] ?? "";
      const tokens = valuesPart.match(/'(?:[^']|'')*'|[^,]+/g) ?? [];
      let p = 0;
      const row: Row = {};
      cols.forEach((c, i) => {
        const tok = (tokens[i] ?? "?").trim();
        if (tok === "?") row[c] = params[p++];
        else if (/^null$/i.test(tok)) row[c] = null;
        else if (tok.startsWith("'") && tok.endsWith("'")) row[c] = tok.slice(1, -1).replace(/''/g, "'");
        else if (tok !== "" && !Number.isNaN(Number(tok))) row[c] = Number(tok);
        else row[c] = params[p++];
      });
      tables[table].push(row);
      return;
    }
    const update = /update\s+(\w+)\s+set\s+(.+?)\s+where\s+(.+)/is.exec(sql);
    if (update) {
      const [, table, setPart, wherePart] = update;
      // Ordered placeholder assignments; COALESCE(?, col) consumes a param too.
      const assigns: { col: string; coalesce: boolean }[] = [];
      const re = /(\w+)\s*=\s*(COALESCE\(\?,\s*\1\)|\?)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(setPart)) !== null) {
        assigns.push({ col: m[1], coalesce: m[2].startsWith("COALESCE") });
      }
      const whereCols = [...wherePart.matchAll(/(\w+)\s*=\s*\?/g)].map((mm) => mm[1]);
      const whereVals = params.slice(assigns.length);
      // Literal numeric SET assignments (e.g. edited_by_human = 1): no params.
      const literals: Array<{ col: string; val: number }> = [];
      const litRe = /(\w+)\s*=\s*(-?\d+(?:\.\d+)?)/g;
      let lit: RegExpExecArray | null;
      while ((lit = litRe.exec(setPart)) !== null) {
        literals.push({ col: lit[1], val: Number(lit[2]) });
      }
      for (const r of tables[table] ?? []) {
        if (!whereCols.every((c, i) => r[c] === whereVals[i])) continue;
        assigns.forEach((a, i) => {
          const v = params[i];
          if (a.coalesce) {
            if (v !== null && v !== undefined) r[a.col] = v;
            return;
          }
          r[a.col] = v;
        });
        for (const l of literals) r[l.col] = l.val;
      }
      return;
    }
    throw new Error(`mock: unsupported write ${sql}`);
  }

  const db = {
    prepare(sql: string) {
      const stmt = {
        bind(...params: any[]) {
          return {
            first: async (): Promise<Row | null> => select(sql, params)[0] ?? null,
            all: async <T>(): Promise<{ results: T[] }> => ({
              results: select(sql, params) as T[],
            }),
            run: async (): Promise<{ success: boolean }> => {
              mutate(sql, params);
              return { success: true };
            },
          };
        },
        first: async (): Promise<Row | null> => select(sql, [])[0] ?? null,
        all: async <T>(): Promise<{ results: T[] }> => ({
          results: select(sql, []) as T[],
        }),
        run: async (): Promise<{ success: boolean }> => {
          mutate(sql, []);
          return { success: true };
        },
      };
      return stmt;
    },
  };
  return { db: db as unknown as Db, tables };
}

const RUN_ID = "run_test_1";

function seedRun(tables: Record<string, Row[]>, queries: string[] = ["test query"]) {
  const now = new Date().toISOString();
  tables["research_run"].push({
    id: RUN_ID,
    profile_id: "prof_1",
    workflow_instance_id: "wf_1",
    plan: JSON.stringify({ queries }),
    status: "discovering",
    stop_reason: null,
    budgets: JSON.stringify({
      searches: 30,
      fetches: 40,
      candidates: 25,
      cost_usd: 6,
      active_compute_s: 1200,
    }),
    consumed: JSON.stringify({
      searches: 0,
      fetches: 0,
      candidates: 0,
      tool_rounds: 0,
      cost_usd_est: 0,
    }),
    started_at: now,
    finished_at: null,
    created_at: now,
  });
}

function budgetsWith(
  caps: Partial<typeof DEFAULT_CAPS> = {},
): BudgetState & { run_id: string } {
  return {
    caps: { ...DEFAULT_CAPS, ...caps },
    consumed: emptyConsumed(),
    run_id: RUN_ID,
  };
}

const BRIEF = { id: "brief_1", status: "confirmed" as const, excerpt: "test brief" };

async function seedViaDiscover(
  db: Db,
  names: string[],
): Promise<void> {
  const out = await discover(
    BRIEF,
    db,
    {
      search: async () => names.map((name) => ({
        claim: `${name} exists`,
        quote: `${name} quoted`,
        source_url: `https://example.com/${encodeURIComponent(name)}`,
        name,
        category: "services",
      })),
    },
    budgetsWith(),
  );
  if (out.status !== "completed") throw new Error(`seed discover failed: ${out.stop_reason}`);
}

async function seedCandidate(
  db: Db,
  name = "Acme Corp",
): Promise<{ prospectId: string; evidenceId: string }> {
  const evidenceId = await saveEvidence(db, {
    run_id: RUN_ID,
    claim: `${name} exists`,
    quote: `${name} quoted`,
    source_url: "https://example.com/acme",
    source_type: "search_snippet",
    retrieved_at: new Date().toISOString(),
    reliability: "unknown",
    conflicts_with: null,
    supersedes: null,
  });
  const r = await saveCandidate(db, {
    run_id: RUN_ID,
    name,
    category: "services",
    location: {},
    evidence_ids: [evidenceId],
  });
  const prospects = await listProspects(db, RUN_ID);
  const prospectId = prospects.find((p) => p.name === name)?.id ?? (r as { prospect_id?: string }).prospect_id ?? "";
  return { prospectId, evidenceId };
}

// --- dedupe ------------------------------------------------------------------

describe("dedupe", () => {
  it("merges duplicate candidates instead of inserting", async () => {
    const { db, tables } = makeMockDb();
    seedRun(tables);
    const first = await seedCandidate(db, "Acme Corp");
    expect(first.prospectId).toBeTruthy();

    const ev2 = await saveEvidence(db, {
      run_id: RUN_ID,
      claim: "Acme Corp second sighting",
      quote: "acme again",
      source_url: "https://example.com/acme-2",
      source_type: "search_snippet",
      retrieved_at: new Date().toISOString(),
      reliability: "unknown",
      conflicts_with: null,
      supersedes: null,
    });
    const r2 = await saveCandidate(db, {
      run_id: RUN_ID,
      name: "Acme Corp",
      category: "services",
      location: {},
      evidence_ids: [ev2],
    });
    expect((r2 as { merged: boolean }).merged).toBe(true);
    const prospects = await listProspects(db, RUN_ID);
    expect(prospects.filter((p) => p.name === "Acme Corp")).toHaveLength(1);
  });

  it("dedupeKey is case-insensitive on name", () => {
    expect(dedupeKey("Acme Corp", undefined)).toBe(dedupeKey("acme corp", undefined));
  });

  it("dedupeKey distinguishes different domains/handles", () => {
    expect(dedupeKey("Acme", "a.com")).not.toBe(dedupeKey("Acme", "b.com"));
  });

  it("merges same-domain names sharing a first distinctive token (Supermart x2)", async () => {
    const { db, tables } = makeMockDb();
    seedRun(tables);
    const ev1 = await saveEvidence(db, {
      run_id: RUN_ID, claim: "Supermart exists", quote: "supermart",
      source_url: "https://supermart.ng/", source_type: "search_snippet",
      retrieved_at: new Date().toISOString(), reliability: "unknown",
      conflicts_with: null, supersedes: null,
    });
    const r1 = await saveCandidate(db, {
      run_id: RUN_ID, name: "Supermart.ng", category: "Groceries", location: {},
      domainOrHandle: "supermart.ng", evidence_ids: [ev1],
    });
    expect(r1.merged).toBe(false);
    const ev2 = await saveEvidence(db, {
      run_id: RUN_ID, claim: "Supermart online groceries", quote: "groceries",
      source_url: "https://supermart.ng/online-groceries", source_type: "search_snippet",
      retrieved_at: new Date().toISOString(), reliability: "unknown",
      conflicts_with: null, supersedes: null,
    });
    const r2 = await saveCandidate(db, {
      run_id: RUN_ID, name: "Supermart Online Groceries", category: "Groceries", location: {},
      domainOrHandle: "supermart.ng", evidence_ids: [ev2],
    });
    expect(r2.merged).toBe(true);
    expect(r2.prospect_id).toBe(r1.prospect_id);
    expect(await listProspects(db, RUN_ID)).toHaveLength(1);
  });

  it("merges same-name rows across different domains (OPay x2, catering eval)", async () => {
    const { db, tables } = makeMockDb();
    seedRun(tables);
    const ev1 = await saveEvidence(db, {
      run_id: RUN_ID, claim: "OPay exists", quote: "opay",
      source_url: "https://opay.com/", source_type: "search_snippet",
      retrieved_at: new Date().toISOString(), reliability: "unknown",
      conflicts_with: null, supersedes: null,
    });
    const r1 = await saveCandidate(db, {
      run_id: RUN_ID, name: "OPay", category: "Fintech", location: {},
      domainOrHandle: "opay.com", evidence_ids: [ev1],
    });
    expect(r1.merged).toBe(false);
    const ev2 = await saveEvidence(db, {
      run_id: RUN_ID, claim: "OPay offices", quote: "offices",
      source_url: "https://example.com/opay-offices", source_type: "search_snippet",
      retrieved_at: new Date().toISOString(), reliability: "unknown",
      conflicts_with: null, supersedes: null,
    });
    const r2 = await saveCandidate(db, {
      run_id: RUN_ID, name: "OPay", category: "Fintech", location: {},
      domainOrHandle: "example.com", evidence_ids: [ev2],
    });
    expect(r2.merged).toBe(true);
    expect(r2.prospect_id).toBe(r1.prospect_id);
    expect(await listProspects(db, RUN_ID)).toHaveLength(1);
  });

  it("does not merge different businesses sharing a platform domain", async () => {
    const { db, tables } = makeMockDb();
    seedRun(tables);
    const ev1 = await saveEvidence(db, {
      run_id: RUN_ID, claim: "Ashluxury exists", quote: "ashluxury",
      source_url: "https://instagram.com/ashluxury", source_type: "search_snippet",
      retrieved_at: new Date().toISOString(), reliability: "unknown",
      conflicts_with: null, supersedes: null,
    });
    await saveCandidate(db, {
      run_id: RUN_ID, name: "Ashluxury", category: "Fashion", location: {},
      domainOrHandle: "instagram.com", evidence_ids: [ev1],
    });
    const ev2 = await saveEvidence(db, {
      run_id: RUN_ID, claim: "ZTTW exists", quote: "zttw",
      source_url: "https://instagram.com/zttw_shop", source_type: "search_snippet",
      retrieved_at: new Date().toISOString(), reliability: "unknown",
      conflicts_with: null, supersedes: null,
    });
    const r2 = await saveCandidate(db, {
      run_id: RUN_ID, name: "ZTTW Shop by Zlatan", category: "Fashion", location: {},
      domainOrHandle: "instagram.com", evidence_ids: [ev2],
    });
    expect(r2.merged).toBe(false);
    expect(await listProspects(db, RUN_ID)).toHaveLength(2);
  });
});

// --- budget caps ---------------------------------------------------------------

describe("brief hydration across workflow steps", () => {
  it("hands the stored brief to the client (run_99840398: dims 0/25 without this)", async () => {
    const { db, tables } = makeMockDb();
    seedRun(tables);
    tables["research_run"][0].commercial_brief = JSON.stringify(RETAIL_BRIEF);
    const setBrief = vi.fn();
    await hydrateBriefFromRun(db, { setBrief } as never, RUN_ID);
    expect(setBrief).toHaveBeenCalledTimes(1);
    expect(setBrief.mock.calls[0][0]).toMatchObject({ version: 1 });
  });

  it("is a no-op without a stored brief, setter, or on invalid JSON", async () => {
    const { db, tables } = makeMockDb();
    seedRun(tables);
    const setBrief = vi.fn();
    await hydrateBriefFromRun(db, { setBrief } as never, RUN_ID);
    expect(setBrief).not.toHaveBeenCalled();
    tables["research_run"][0].commercial_brief = "not json";
    await hydrateBriefFromRun(db, { setBrief } as never, RUN_ID);
    expect(setBrief).not.toHaveBeenCalled();
    tables["research_run"][0].commercial_brief = JSON.stringify(RETAIL_BRIEF);
    await hydrateBriefFromRun(db, {} as never, RUN_ID);
    expect(setBrief).not.toHaveBeenCalled();
  });

  it("runPhases hydrates before discover so later phases stay brief-driven", async () => {
    const { db, tables } = makeMockDb();
    seedRun(tables, ["q1"]);
    tables["research_run"][0].status = "created";
    tables["research_run"][0].commercial_brief = JSON.stringify(RETAIL_BRIEF);
    const setBrief = vi.fn();
    const wf = new ResearchWorkflow(
      {
        step: async (_name: string, fn: () => Promise<unknown>) => fn(),
        waitForEvent: async () => ({}),
        log: (_msg: string) => {},
      },
      {
        db,
        brief: { id: "brief_1", status: "confirmed", excerpt: "x" },
        run_id: RUN_ID,
        meta: { planQueries: async () => ["q1"], search: async () => [], setBrief },
      },
    );
    await wf.runPhases();
    expect(setBrief).toHaveBeenCalled();
    expect(setBrief.mock.calls[0][0]).toMatchObject({ version: 1 });
  });
});

describe("budget caps", () => {
  it("discover stops with budget_searches when the search cap is exhausted", async () => {
    const { db, tables } = makeMockDb();
    seedRun(tables, ["q1"]);
    const search = vi.fn(async () => []);
    const out = await discover(BRIEF, db, { search }, budgetsWith({ searches: 0 }));
    expect(out.status).toBe("stopped");
    expect(out.stop_reason).toBe(budgetReason("searches"));
    expect(search).not.toHaveBeenCalled();
  });

  it("discover caps saved candidates and stops taking more", async () => {
    const { db, tables } = makeMockDb();
    seedRun(tables, ["q1"]);
    const hits = Array.from({ length: 30 }, (_, i) => ({
      claim: `Biz ${i} exists`,
      quote: `quote ${i}`,
      source_url: `https://example.com/${i}`,
      name: `Biz ${i}`,
      category: "Logistics",
    }));
    const out = await discover(BRIEF, db, { search: async () => hits }, budgetsWith({ candidates: 25 }));
    expect(out.status).toBe("completed");
    expect(await listProspects(db, RUN_ID)).toHaveLength(25);
  });

  it("investigate stops with budget_fetches when the fetch cap is exhausted", async () => {
    const { db, tables } = makeMockDb();
    seedRun(tables);
    await seedViaDiscover(db, ["Fetch Cap Co"]);
    // Prospects stay "candidate" so investigate has targets (it only fetches
    // candidates); the cap check runs before any fetch, so zero budget stops
    // with reason before fetchPage.
    const fetchPage = vi.fn(async () => ({ text: "hello" }));
    const out = await investigate(BRIEF, db, { fetchPage }, budgetsWith({ fetches: 0 }));
    expect(out.status).toBe("stopped");
    expect(out.stop_reason).toBe(budgetReason("fetches"));
    expect(fetchPage).not.toHaveBeenCalled();
  });
});

// --- empty search -----------------------------------------------------------------

describe("empty search", () => {
  it("discover ends stopped/no_candidates on zero hits (honest empty)", async () => {
    const { db, tables } = makeMockDb();
    seedRun(tables, ["q1", "q2"]);
    const out = await discover(
      BRIEF,
      db,
      { search: async () => [] },
      budgetsWith(),
    );
    expect(out.status).toBe("stopped");
    expect(out.stop_reason).toBe("no_candidates");
    expect(await listProspects(db, RUN_ID)).toHaveLength(0);
  });

  it("keeps evidence for chatter-flagged hits but creates no candidate", async () => {
    const { db, tables } = makeMockDb();
    seedRun(tables, ["q1"]);
    const out = await discover(
      BRIEF,
      db,
      {
        search: async () => [
          {
            claim: "model chatter",
            quote: "chatter quote",
            source_url: "https://example.com/x",
            name: "Hunting for great bulk catering leads today",
            category: "Logistics",
            candidateEligible: false,
          },
        ],
      },
      budgetsWith(),
    );
    expect(out.status).toBe("stopped");
    expect(out.stop_reason).toBe("no_candidates");
    expect(await listProspects(db, RUN_ID)).toHaveLength(0);
    expect(await listEvidence(db, RUN_ID)).toHaveLength(1);
  });
});

// --- fetch failure -----------------------------------------------------------

describe("run quality (agentic QA loop)", () => {
  const ev = (id: string, url: string | null): Evidence => ({
    id, run_id: RUN_ID, claim: "c", quote: "q", source_url: url,
    source_type: url ? "business_site" : "search_snippet", retrieved_at: "t",
    reliability: "unknown", conflicts_with: null, supersedes: null, created_at: "t",
  });
  const p = (id: string, evIds: string[], status: ProspectStatus, loc: Record<string, string> = {}): Prospect => ({
    id, run_id: RUN_ID, name: id, category: "c", location: loc, dedupe_key: id,
    evidence_ids: evIds, status, rank: null, created_at: "t",
  });
  const entry = (pid: string, fit: number): Assessment & { supporting: string[] } => ({
    id: "a_" + pid, prospect_id: pid, fit_rating: fit as 3,
    supporting_evidence_ids: [], weakening_evidence_ids: [], uncertainties: [],
    missing_info: [], rationale: "r", model_id: "m", created_at: "t", supporting: [],
  });

  it("counts good and junk per the QA rules", () => {
    // Junk regression: directory-only evidence (enbizopedia/businesslist)
    // reached a caterer's shortlist as barbers and IT firms.
    const evidence = [
      ev("e1", "https://www.enbizopedia.com/NG/Ikeja/123/junk-co"),
      ev("e2", "https://grillhouse.ng/about"),
      ev("e3", "https://www.businesslist.com.ng/company/other"),
    ];
    const prospects = [
      p("p1", ["e2"], "qualified", { area: "Ikeja" }), // good: fit >= 3, own site
      p("p2", ["e1"], "investigating"),                // junk: directory-only
      p("p3", ["e3"], "investigating"),                // junk: directory-only
      p("p4", ["e2"], "disqualified"),                 // disqualified: never good
    ];
    const amap = new Map([
      ["p1", entry("p1", 4)],
      ["p4", entry("p4", 1)],
    ]);
    const q = runQuality(prospects, amap, evidence);
    expect(q).toEqual({ good: 1, junk: 2, candidates: 4, unlocated: 1 }); // junk rows skip the location check
  });

  it("mixed evidence never counts as junk", () => {
    const evidence = [ev("e1", "https://www.businesslist.com.ng/x"), ev("e2", "https://venue.ng/contact")];
    const prospects = [p("p1", ["e1", "e2"], "investigating")];
    const q = runQuality(prospects, new Map(), evidence);
    expect(q.junk).toBe(0);
    expect(q.good).toBe(0); // no assessment yet, but not junk either
  });
});

// --- fetch failure -----------------------------------------------------------

describe("fetch failures", () => {
  it("does not record fetch failures as evidence; the prospect still moves on", async () => {
    // A failure detail is not a claim: attaching it once shipped "http 404"
    // as visible evidence and fed junk into assess/draft prompts.
    const { db, tables } = makeMockDb();
    seedRun(tables);
    const { prospectId } = await seedCandidate(db, "Blocked Co");
    const before = await listEvidence(db, RUN_ID);
    const out = await investigate(
      BRIEF,
      db,
      { fetchPage: async () => ({ failure: "blocked" as const, detail: "robots denied" }) },
      budgetsWith(),
    );
    expect(out.status).toBe("completed");
    const evs = await listEvidence(db, RUN_ID);
    expect(evs.filter((e) => e.claim.includes("fetch failed"))).toHaveLength(0);
    expect(evs.length).toBe(before.length);
    const prospect = (await listProspects(db, RUN_ID)).find((p) => p.id === prospectId);
    expect(prospect?.status).toBe("investigating");
  });
});

// --- assessment rating cap ---------------------------------------------------

describe("assessment rating cap", () => {
  it("caps fit_rating at 2 when there is no supporting evidence", async () => {
    const { db, tables } = makeMockDb();
    seedRun(tables);
    const { prospectId } = await seedCandidate(db, "Unproven Co");
    await setProspectStatus(db, RUN_ID, prospectId, "investigating");
    const out = await assess(
      BRIEF,
      db,
      {
        proposeAssessments: async () => [
          {
            prospect_id: prospectId,
            fit_rating: 5,
            supporting_claims: [],
            weakening_claims: [],
            rationale: "model is overconfident",
          },
        ],
      },
      budgetsWith(),
    );
    expect(out.status).toBe("completed");
    const recs = await listAssessments(db, [prospectId]);
    expect(recs.length).toBeGreaterThan(0);
    expect(recs[0].fit_rating).toBeLessThanOrEqual(2);
  });

  it("links supporting claims to matching evidence, never arbitrary rows", async () => {
    const { db, tables } = makeMockDb();
    seedRun(tables);
    const a = await seedCandidate(db, "Linked Co");
    const b = await seedCandidate(db, "Vague Co");
    await setProspectStatus(db, RUN_ID, a.prospectId, "investigating");
    await setProspectStatus(db, RUN_ID, b.prospectId, "investigating");
    const out = await assess(
      BRIEF,
      db,
      {
        proposeAssessments: async () => [
          {
            prospect_id: a.prospectId,
            fit_rating: 5,
            supporting_claims: ["Linked Co exists"],
            weakening_claims: [],
            rationale: "evidence-backed",
          },
          {
            prospect_id: b.prospectId,
            fit_rating: 5,
            supporting_claims: ["nothing matches this claim text"],
            weakening_claims: [],
            rationale: "overconfident",
          },
        ],
      },
      budgetsWith(),
    );
    expect(out.status).toBe("completed");
    const recs = await listAssessments(db, [a.prospectId, b.prospectId]);
    const ra = recs.find((r) => r.prospect_id === a.prospectId)!;
    const rb = recs.find((r) => r.prospect_id === b.prospectId)!;
    // "Linked Co exists" is the seeded claim text, so its evidence id links.
    expect(ra.supporting_evidence_ids).toContain(a.evidenceId);
    expect(ra.fit_rating).toBe(5);
    // No match: honest empty support, rating capped — not random evidence.
    expect(rb.supporting_evidence_ids).toEqual([]);
    expect(rb.fit_rating).toBeLessThanOrEqual(2);
  });

  it("links paraphrased claims sharing 3+ significant words, caps the rest", async () => {
    const { db, tables } = makeMockDb();
    seedRun(tables);
    const seeded = await seedCandidate(db, "Fuzzy Co");
    const prospectId = seeded.prospectId;
    const rotaId = await saveEvidence(db, {
      run_id: RUN_ID,
      claim: "Fuzzy Co runs a weekday office lunch rota",
      quote: "weekday rota",
      source_url: "https://fuzzy.example/",
      source_type: "fetched_page",
      retrieved_at: new Date().toISOString(),
      reliability: "unknown",
      conflicts_with: null,
      supersedes: null,
    });
    // New contract: support links only prospect-owned evidence (as investigate attaches).
    await db.prepare("UPDATE prospect SET evidence_ids = ? WHERE id = ?")
      .bind(JSON.stringify([seeded.evidenceId, rotaId]), prospectId).run();
    await setProspectStatus(db, RUN_ID, prospectId, "investigating");
    const out = await assess(
      BRIEF,
      db,
      {
        proposeAssessments: async () => [
          {
            prospect_id: prospectId,
            fit_rating: 4,
            supporting_claims: ["Fuzzy weekday office lunch program confirmed", "completely unrelated one"],
            weakening_claims: [],
            rationale: "paraphrase",
          },
        ],
      },
      budgetsWith(),
    );
    expect(out.status).toBe("completed");
    const recs = await listAssessments(db, [prospectId]);
    // fuzzy/weekday/office/lunch shared -> linked; rating stands.
    expect(recs[0].supporting_evidence_ids).toContain(rotaId);
    expect(recs[0].fit_rating).toBe(4);
  });
});

// --- orchestrator runPhases ---------------------------------------------------

describe("orchestrator runPhases", () => {
  it("runs plan through draft synchronously, ending awaiting_approval with drafts", async () => {
    const { db, tables } = makeMockDb();
    seedRun(tables, ["seed query"]);
    tables["research_run"][0].status = "created";
    const wf = new ResearchWorkflow(
      {
        step: async (_name: string, fn: () => Promise<unknown>) => fn(),
        waitForEvent: async (_name: string) => ({}),
        log: (_msg: string) => {},
      },
      {
        db,
        brief: { id: "brief_1", status: "confirmed", excerpt: "catering Ikeja" },
        run_id: RUN_ID,
        meta: {
          planQueries: async () => ["catering buyers Ikeja"],
          search: async () => [
            {
              claim: "Acme Catering exists",
              quote: "acme office lunch",
              source_url: "https://acme.ng/",
              name: "Acme Catering",
              category: "Logistics",
            },
          ],
          fetchPage: async () => ({ text: "acme page text about office lunch catering" }),
          proposeAssessments: async (targets) =>
            targets.map((t) => ({
              prospect_id: t.id,
              fit_rating: 4,
              supporting_claims: ["Acme Catering exists"],
              rationale: "evidence-backed fit",
            })),
          proposeDrafts: async (targets) =>
            targets.map((t) => ({
              prospect_id: t.id,
              channel: "website_form" as const,
              contact_value: "https://acme.ng/contact",
              subject: "Weekday lunches",
              body: "Hello team, saw your lunch rota [source 1]. Trial week?",
              next_action: "Send intro",
              follow_up_days: 7,
            })),
        },
      },
    );
    const outcome = await wf.runPhases();
    expect(outcome.status).toBe("completed");
    expect(tables["research_run"][0].status).toBe("awaiting_approval");
    const prospects = await listProspects(db, RUN_ID);
    expect(prospects.length).toBeGreaterThan(0);
    expect(prospects.every((p) => p.status === "shortlisted")).toBe(true);
    const { results: drafts } = await db.prepare("SELECT * FROM outreach_draft").all();
    expect(drafts.length).toBeGreaterThan(0);
  });

  it("stops the run with reason when a phase stops", async () => {
    const { db, tables } = makeMockDb();
    seedRun(tables, ["q1"]);
    tables["research_run"][0].status = "created";
    const wf = new ResearchWorkflow(
      {
        step: async (_name: string, fn: () => Promise<unknown>) => fn(),
        waitForEvent: async (_name: string) => ({}),
        log: (_msg: string) => {},
      },
      {
        db,
        brief: { id: "brief_1", status: "confirmed", excerpt: "x" },
        run_id: RUN_ID,
        meta: { planQueries: async () => [], search: async () => [] },
      },
    );
    const outcome = await wf.runPhases();
    expect(outcome.status).toBe("stopped");
    expect(tables["research_run"][0].status).toBe("stopped");
  });
});

// --- orchestrator run (Workflow path) ------------------------------------------

describe("orchestrator run (Workflow path)", () => {
  function setup(waits: Array<[string, string]>, onWait: (calls: number) => void) {
    const { db, tables } = makeMockDb();
    seedRun(tables, ["seed query"]);
    tables["research_run"][0].status = "created";
    const steps: string[] = [];
    let calls = 0;
    const wf = new ResearchWorkflow(
      {
        step: async (name: string, fn: () => Promise<unknown>) => {
          steps.push(name);
          return fn();
        },
        waitForEvent: async (waitName: string, type: string) => {
          waits.push([waitName, type]);
          calls += 1;
          onWait(calls);
          return {};
        },
        log: (_msg: string) => {},
      },
      {
        db,
        brief: { id: "brief_1", status: "confirmed", excerpt: "catering Ikeja" },
        run_id: RUN_ID,
        meta: {
          planQueries: async () => ["catering buyers Ikeja"],
          search: async () => [
            {
              claim: "Acme Catering exists",
              quote: "acme office lunch",
              source_url: "https://acme.ng/",
              name: "Acme Catering",
              category: "Logistics",
            },
          ],
          fetchPage: async () => ({ text: "acme page text about office lunch catering" }),
          proposeAssessments: async (targets) =>
            targets.map((t) => ({
              prospect_id: t.id,
              fit_rating: 4,
              supporting_claims: ["Acme Catering exists"],
              rationale: "evidence-backed fit",
            })),
          proposeDrafts: async (targets) =>
            targets.map((t) => ({
              prospect_id: t.id,
              channel: "website_form" as const,
              contact_value: "https://acme.ng/contact",
              subject: "Weekday lunches",
              body: "Hello team, saw your lunch rota [source 1]. Trial week?",
              next_action: "Send intro",
              follow_up_days: 7,
            })),
        },
      },
    );
    return { wf, tables, steps };
  }

  it("marks phase statuses and closes the run once drafts are decided", async () => {
    const waits: Array<[string, string]> = [];
    const { wf, tables, steps } = setup(waits, () => {
      for (const d of tables["outreach_draft"]) d.status = "approved";
    });
    await wf.run();
    for (const s of ["status:discovering", "status:investigating", "status:assessing", "status:drafting", "status:awaiting_approval"]) {
      expect(steps).toContain(s);
    }
    expect(waits).toHaveLength(1);
    expect(waits[0][1]).toBe("drafts_decided");
    expect(tables["research_run"][0].status).toBe("complete");
  });

  it("uses a fresh wait name per gate wake so re-waits block on new events", async () => {
    const waits: Array<[string, string]> = [];
    const { wf, tables } = setup(waits, (calls) => {
      if (calls >= 2) for (const d of tables["outreach_draft"]) d.status = "approved";
    });
    await wf.run();
    expect(waits).toHaveLength(2);
    expect(waits[0][0]).not.toBe(waits[1][0]);
    expect(waits.map((w) => w[1])).toEqual(["drafts_decided", "drafts_decided"]);
    expect(tables["research_run"][0].status).toBe("complete");
  });

  it("parks the run at awaiting_approval while the drafts gate waits", async () => {
    const { db, tables } = makeMockDb();
    seedRun(tables, ["seed query"]);
    tables["research_run"][0].status = "created";
    const wf = new ResearchWorkflow(
      {
        step: async (_name: string, fn: () => Promise<unknown>) => fn(),
        waitForEvent: async () => { throw new Error("parked"); },
        log: (_msg: string) => {},
      },
      {
        db,
        brief: { id: "brief_1", status: "confirmed", excerpt: "catering Ikeja" },
        run_id: RUN_ID,
        meta: {
          planQueries: async () => ["catering buyers Ikeja"],
          search: async () => [
            { claim: "Acme Catering exists", quote: "acme office lunch", source_url: "https://acme.ng/", name: "Acme Catering", category: "Logistics" },
          ],
          fetchPage: async () => ({ text: "acme page text about office lunch catering" }),
          proposeAssessments: async (targets) =>
            targets.map((t) => ({ prospect_id: t.id, fit_rating: 4, supporting_claims: ["Acme Catering exists"], rationale: "fit" })),
          proposeDrafts: async (targets) =>
            targets.map((t) => ({
              prospect_id: t.id, channel: "website_form" as const, contact_value: "https://acme.ng/contact",
              subject: "S", body: "B [source 1]", next_action: "Send", follow_up_days: 7,
            })),
        },
      },
    );
    await expect(wf.run()).rejects.toThrow("parked");
    expect(tables["research_run"][0].status).toBe("awaiting_approval");
  });
});

// --- gate decisions ----------------------------------------------------------

describe("gate decisions", () => {
  it("brief gate waits until the brief is confirmed", () => {
    expect(
      briefGateDecision({ id: "b", status: "draft", excerpt: "x" }),
    ).toEqual({ wait: true, event: "brief_confirmed" });
    expect(
      briefGateDecision({ id: "b", status: "confirmed", excerpt: "x" }),
    ).toEqual({ wait: false });
  });

  it("draft gate waits while drafts are undecided and resumes when decided", () => {
    expect(draftGateDecision([]).wait).toBe(true);
    const waiting = draftGateDecision([
      { id: "d1", status: "approved" },
      { id: "d2", status: "draft" },
    ]);
    expect(waiting.wait).toBe(true);
    expect(waiting.pending).toBe(1);
    const resumed = draftGateDecision([
      { id: "d1", status: "approved" },
      { id: "d2", status: "rejected" },
    ]);
    expect(resumed.wait).toBe(false);
    expect(resumed.pending).toBe(0);
  });
});

// --- commercial brief + hard gate (new path) ----------------------------------

const RETAIL_BRIEF = {
  version: 1,
  offer: { description: "ops system for SMEs", geography: "Lagos, Nigeria", outcomes: ["fewer lost orders"] },
  primary_segment: {
    label: "Lagos retail shops (5-200 staff)",
    industries: ["retail", "logistics"],
    geos: ["Lagos", "Nigeria"],
    sizes: ["5-200 staff"],
    use_cases: ["WhatsApp orders"],
    inclusions: ["takes orders over WhatsApp"],
    exclusions: ["schools", "clinics", "hospitals"],
  },
  secondary_segments: [],
  pains: [{
    job: "fulfill orders", obstacle: "chats and notebooks",
    trigger_hints: ["new branch"], falsifiable_by: "already runs an ERP",
  }],
  buyer_roles: [{ role: "founder", concerns: ["cost"] }],
  statements: [{ text: "serves SMEs", provenance: "user_fact" }],
  questions: [],
  assumptions: [],
};

describe("plan builds the commercial brief", () => {
  it("stores a validated brief once and hands it to later bursts", async () => {
    const { db, tables } = makeMockDb();
    seedRun(tables, ["q1"]);
    tables["business_profile"].push({
      id: "brief_1", name: "TechAssembly", website_url: "https://techassembly.io",
      description: "ops system", target_market: "retail",
      service_area: JSON.stringify({ city: "Lagos", country: "Nigeria" }),
      constraints: JSON.stringify({ exclusions: ["schools"] }),
    });
    let handed: any = null;
    const out = await plan(BRIEF, db, {
      buildBrief: async () => RETAIL_BRIEF as any,
      setBrief: (b: any) => { handed = b; },
      planQueries: async () => ["retail Lagos"],
    }, budgetsWith());
    expect(out.status).toBe("completed");
    expect(JSON.parse(tables["research_run"][0].commercial_brief).version).toBe(1);
    expect(handed.primary_segment.label).toContain("retail");
  });

  it("stops plan_failed when the brief burst is invalid", async () => {
    const { db, tables } = makeMockDb();
    seedRun(tables, ["q1"]);
    tables["business_profile"].push({
      id: "brief_1", name: "X", website_url: "", description: "d",
      target_market: "t", service_area: "{}", constraints: "{}",
    });
    const out = await plan(BRIEF, db, {
      buildBrief: async () => { throw new Error("bad json"); },
      planQueries: async () => ["q"],
    }, budgetsWith());
    expect(out.status).toBe("stopped");
    expect(out.stop_reason).toBe("plan_failed");
  });

  it("skips rebuilding when a brief is already stored", async () => {
    const { db, tables } = makeMockDb();
    seedRun(tables, ["q1"]);
    tables["research_run"][0].commercial_brief = JSON.stringify(RETAIL_BRIEF);
    const buildBrief = vi.fn(async () => RETAIL_BRIEF as any);
    let handed: any = null;
    const out = await plan(BRIEF, db, {
      buildBrief, setBrief: (b: any) => { handed = b; },
      planQueries: async () => ["q"],
    }, budgetsWith());
    expect(out.status).toBe("completed");
    expect(buildBrief).not.toHaveBeenCalled();
    expect(handed.version).toBe(1);
  });
});

describe("assess hard gate + dimensions", () => {
  async function seedBriefed() {
    const { db, tables } = makeMockDb();
    seedRun(tables);
    tables["research_run"][0].commercial_brief = JSON.stringify(RETAIL_BRIEF);
    return { db, tables };
  }
  async function seedNamed(db: Db, name: string, category: string, url: string) {
    const evidenceId = await saveEvidence(db, {
      run_id: RUN_ID, claim: `${name} exists`, quote: `${name} quoted`,
      source_url: url, source_type: "search_snippet", retrieved_at: new Date().toISOString(),
      reliability: "unknown", conflicts_with: null, supersedes: null,
    });
    const r = await saveCandidate(db, {
      run_id: RUN_ID, name, category, location: { city: "Lagos" }, evidence_ids: [evidenceId],
    });
    await setProspectStatus(db, RUN_ID, r.prospect_id, "investigating");
    return r.prospect_id;
  }

  it("disqualifies an excluded industry despite a confident 5/5 proposal", async () => {
    const { db } = await seedBriefed();
    const pid = await seedNamed(db, "Greensprings School", "Education", "https://greensprings.ng/");
    const out = await assess(BRIEF, db, {
      proposeAssessments: async () => [{
        prospect_id: pid, fit_rating: 5, supporting_claims: ["Greensprings School exists"],
        rationale: "great fit",
        dimensions: { icp_fit: 5, problem: 5, readiness: 5, reachability: 5, confidence: 5 },
      }],
    }, budgetsWith());
    expect(out.status).toBe("completed");
    const prospects = await listProspects(db, RUN_ID);
    expect(prospects.find((p) => p.id === pid)?.status).toBe("disqualified");
    const { results } = await db.prepare("SELECT * FROM assessment WHERE prospect_id = ?").bind(pid).all<any>();
    expect(results[0].rationale).toContain("hard constraint");
    expect(results[0].verdict).toBe("disqualified");
  });

  it("records needs_research (staying investigating) when evidence is thin", async () => {
    const { db } = await seedBriefed();
    const pid = await seedNamed(db, "Brightline Retail", "Retail", "https://brightline.ng/");
    await assess(BRIEF, db, {
      proposeAssessments: async () => [{
        prospect_id: pid, fit_rating: 4, supporting_claims: ["Brightline Retail exists"],
        rationale: "good account",
        dimensions: { icp_fit: 4, problem: 3, readiness: 3, reachability: 3, confidence: 3 },
      }],
    }, budgetsWith());
    const prospects = await listProspects(db, RUN_ID);
    expect(prospects.find((p) => p.id === pid)?.status).toBe("investigating");
    const { results } = await db.prepare("SELECT * FROM assessment WHERE prospect_id = ?").bind(pid).all<any>();
    expect(results[0].verdict).toBe("needs_research");
    expect(results[0].fit_rating).toBe(3);
  });

  it("qualifies only with fit, primary evidence, and signal", async () => {
    const { db } = await seedBriefed();
    const pid = await seedNamed(db, "Brightline Retail", "Retail", "https://brightline.ng/");
    const fetched = await saveEvidence(db, {
      run_id: RUN_ID, claim: "fetched page for Brightline Retail", quote: "shop page",
      source_url: "https://brightline.ng/", source_type: "fetched_page",
      retrieved_at: new Date().toISOString(), reliability: "unknown",
      conflicts_with: null, supersedes: null,
    });
    const row = (await listProspects(db, RUN_ID)).find((p) => p.id === pid);
    await db.prepare("UPDATE prospect SET evidence_ids = ? WHERE id = ?")
      .bind(JSON.stringify([...row!.evidence_ids, fetched]), pid).run();
    await assess(BRIEF, db, {
      proposeAssessments: async () => [{
        prospect_id: pid, fit_rating: 4, supporting_claims: ["Brightline Retail exists"],
        rationale: "fits",
        dimensions: { icp_fit: 4, problem: 4, readiness: 3, reachability: 3, confidence: 4 },
      }],
    }, budgetsWith());
    const prospects = await listProspects(db, RUN_ID);
    expect(prospects.find((p) => p.id === pid)?.status).toBe("qualified");
    const { results } = await db.prepare("SELECT * FROM assessment WHERE prospect_id = ?").bind(pid).all<any>();
    expect(results[0].verdict).toBe("qualified");
    expect(JSON.parse(results[0].dimensions).icp_fit).toBe(4);
  });

  it("stamps the client's model id on assessments, never a mock label", async () => {
    const { db } = await seedBriefed();
    const pid = await seedNamed(db, "Brightline Retail", "Retail", "https://brightline.ng/");
    await assess(BRIEF, db, {
      modelId: "muse-spark-1.3",
      proposeAssessments: async () => [{
        prospect_id: pid, fit_rating: 4, supporting_claims: ["Brightline Retail exists"],
        rationale: "fits",
        dimensions: { icp_fit: 4, problem: 4, readiness: 3, reachability: 3, confidence: 4 },
      }],
    }, budgetsWith());
    const { results } = await db.prepare("SELECT model_id FROM assessment WHERE prospect_id = ?").bind(pid).all<any>();
    expect(results[0].model_id).toBe("muse-spark-1.3");
  });
});

describe("investigate per-prospect fetch", () => {
  it("fetches each prospect's own url and never a placeholder", async () => {
    const { db, tables } = makeMockDb();
    seedRun(tables);
    const urls: string[] = [];
    const mk = async (name: string, url: string) => {
      const evidenceId = await saveEvidence(db, {
        run_id: RUN_ID, claim: `${name} exists`, quote: "q", source_url: url,
        source_type: "search_snippet", retrieved_at: new Date().toISOString(),
        reliability: "unknown", conflicts_with: null, supersedes: null,
      });
      await saveCandidate(db, { run_id: RUN_ID, name, category: "Retail", location: {}, evidence_ids: [evidenceId] });
    };
    await mk("Shop A", "https://shopa.ng/about");
    await mk("Shop B", "https://shopb.ng/about");
    const out = await investigate(BRIEF, db, {
      fetchPage: async (url: string) => { urls.push(url); return { text: `page text for ${url}` }; },
    }, budgetsWith());
    expect(out.status).toBe("completed");
    expect(urls.sort()).toEqual(["https://shopa.ng/about", "https://shopb.ng/about"]);
    const prospects = await listProspects(db, RUN_ID);
    expect(prospects.every((p) => p.evidence_ids.length >= 2)).toBe(true);
  });

  it("extracts contacts from fetched pages and binds them to the fetch evidence", async () => {
    const { db, tables } = makeMockDb();
    seedRun(tables);
    const evidenceId = await saveEvidence(db, {
      run_id: RUN_ID, claim: "Shop exists", quote: "q", source_url: "https://shop.ng/",
      source_type: "search_snippet", retrieved_at: new Date().toISOString(),
      reliability: "unknown", conflicts_with: null, supersedes: null,
    });
    await saveCandidate(db, { run_id: RUN_ID, name: "Shop", category: "Retail", location: {}, evidence_ids: [evidenceId] });
    await investigate(BRIEF, db, {
      fetchPage: async () => ({ text: "Contact us at hello@shop.ng or 0803 123 4567 today." }),
    }, budgetsWith());
    const { results } = await db.prepare("SELECT * FROM contact_route").all<any>();
    const values = results.map((r) => r.value).sort();
    expect(values).toContain("hello@shop.ng");
    expect(values).toContain("08031234567");
  });

  it("saves the owned fetch url as a route but never directory pages (run_5538b2b3)", async () => {
    const { db, tables } = makeMockDb();
    seedRun(tables);
    const mk = async (name: string, url: string) => {
      const evidenceId = await saveEvidence(db, {
        run_id: RUN_ID, claim: `${name} exists`, quote: "q", source_url: url,
        source_type: "search_snippet", retrieved_at: new Date().toISOString(),
        reliability: "unknown", conflicts_with: null, supersedes: null,
      });
      await saveCandidate(db, { run_id: RUN_ID, name, category: "Retail", location: {}, evidence_ids: [evidenceId] });
    };
    await mk("Owned Shop", "https://instagram.com/ownedshop");
    await mk("Listed Shop", "https://www.finelib.com/lagos/listed-shop");
    await investigate(BRIEF, db, {
      fetchPage: async () => ({ text: "reach us at hello@example.com today" }),
    }, budgetsWith());
    const { results } = await db.prepare("SELECT * FROM contact_route").all<any>();
    const byValue = new Map(results.map((r) => [r.value, r.channel]));
    // Owned social profile becomes a DM-able route.
    expect(byValue.get("https://instagram.com/ownedshop")).toBe("social_profile");
    // Directory pages contribute no routes at all (no unattributed contacts).
    expect([...byValue.keys()].some((v) => String(v).includes("finelib"))).toBe(false);
    expect(results).toHaveLength(2); // email + social route, both for Owned Shop
  });
});

describe("honest empty shortlist (run_5538b2b3 froze at assessing)", () => {
  it("rank completes with zero qualified instead of stopping the run", async () => {
    const { db, tables } = makeMockDb();
    seedRun(tables);
    await seedCandidate(db, "Still Researching Co");
    const out = await rank(BRIEF, db, {}, budgetsWith());
    expect(out.status).toBe("completed");
    expect(out.detail ?? "").toContain("0 qualified");
  });

  it("shortlists qualified first, then no_signal (run_7: 6 boutiques, no trigger)", async () => {
    const { db, tables } = makeMockDb();
    seedRun(tables);
    const dims = { icp_fit: 5, problem: 4, readiness: 1, reachability: 4, confidence: 3 };
    const rate = async (name: string, status: "qualified" | "investigating", verdict: string, fit: number) => {
      const s = await seedCandidate(db, name);
      await setProspectStatus(db, RUN_ID, s.prospectId, "investigating");
      if (status === "qualified") await setProspectStatus(db, RUN_ID, s.prospectId, "qualified");
      await saveAssessment(db, {
        prospect_id: s.prospectId, fit_rating: fit, supporting_ids: [s.evidenceId],
        weakening_ids: [], uncertainties: [], missing_info: [], rationale: "r",
        model_id: "m", dimensions: dims, verdict,
      });
      return s.prospectId;
    };
    await rate("Qualified Co", "qualified", "qualified", 4);
    await rate("Steady Co", "investigating", "no_signal", 3);
    await rate("Thin Co", "investigating", "needs_research", 2);
    const out = await rank(BRIEF, db, {}, budgetsWith());
    expect(out.status).toBe("completed");
    const prospects = await listProspects(db, RUN_ID);
    const ordered = prospects
      .filter((p) => p.status === "shortlisted")
      .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
      .map((p) => p.name);
    expect(ordered).toEqual(["Qualified Co", "Steady Co"]);
  });

  it("draft parks at awaiting_approval with zero shortlisted instead of stopping", async () => {
    const { db, tables } = makeMockDb();
    seedRun(tables);
    tables["research_run"][0].status = "assessing";
    await seedCandidate(db, "Still Researching Co");
    const proposeDrafts = vi.fn(async () => []);
    const out = await draft(BRIEF, db, { proposeDrafts }, budgetsWith());
    expect(out.status).toBe("completed");
    expect(proposeDrafts).not.toHaveBeenCalled();
    expect(tables["research_run"][0].status).toBe("awaiting_approval");
  });
});

describe("draft grounding", () => {
  async function seedShortlisted(db: Db, name: string, quote: string) {
    const evidenceId = await saveEvidence(db, {
      run_id: RUN_ID, claim: `${name} exists`, quote,
      source_url: "https://example.com/x", source_type: "search_snippet",
      retrieved_at: new Date().toISOString(), reliability: "unknown",
      conflicts_with: null, supersedes: null,
    });
    const r = await saveCandidate(db, { run_id: RUN_ID, name, category: "Retail", location: {}, evidence_ids: [evidenceId] });
    await setProspectStatus(db, RUN_ID, r.prospect_id, "investigating");
    await setProspectStatus(db, RUN_ID, r.prospect_id, "qualified");
    await setProspectStatus(db, RUN_ID, r.prospect_id, "shortlisted");
    return { prospectId: r.prospect_id, evidenceId };
  }

  it("withholds the route when the contact is ungrounded but keeps the draft", async () => {
    const { db, tables } = makeMockDb();
    seedRun(tables);
    const { prospectId } = await seedShortlisted(db, "Acme", "acme quoted, no contact here");
    await draft(BRIEF, db, {
      proposeDrafts: async () => [{
        prospect_id: prospectId, channel: "email", contact_value: "boss@acme.ng",
        subject: "Hi", body: "Hello [source 1]", next_action: "Send",
      }],
    }, budgetsWith());
    const routes = await db.prepare("SELECT * FROM contact_route").all();
    expect(routes.results).toHaveLength(0);
    const drafts = await db.prepare("SELECT * FROM outreach_draft").all();
    expect(drafts.results).toHaveLength(1);
  });

  it("saves the route when the contact appears in own evidence", async () => {
    const { db, tables } = makeMockDb();
    seedRun(tables);
    const { prospectId } = await seedShortlisted(db, "Acme", "mail boss@acme.ng for orders");
    await draft(BRIEF, db, {
      proposeDrafts: async () => [{
        prospect_id: prospectId, channel: "email", contact_value: "boss@acme.ng",
        subject: "Hi", body: "Hello [source 1]", next_action: "Send",
      }],
    }, budgetsWith());
    const routes = await db.prepare("SELECT * FROM contact_route").all<any>();
    expect(routes.results).toHaveLength(1);
    expect(routes.results[0].value).toBe("boss@acme.ng");
  });

  it("rejects drafts citing foreign evidence ids", async () => {
    const { db, tables } = makeMockDb();
    seedRun(tables);
    const { prospectId } = await seedShortlisted(db, "Acme", "quoted");
    await draft(BRIEF, db, {
      proposeDrafts: async () => [{
        prospect_id: prospectId, channel: "email", contact_value: "boss@acme.ng",
        subject: "Hi", body: "Hello [source 1]", next_action: "Send",
        supporting_ids: ["ev_foreign"],
      }],
    }, budgetsWith());
    const drafts = await db.prepare("SELECT * FROM outreach_draft").all();
    expect(drafts.results).toHaveLength(0);
  });

  it("keeps an unmarked draft whose body links to own evidence (run_de5e566e 0 drafts)", async () => {
    const { db, tables } = makeMockDb();
    seedRun(tables);
    const { prospectId } = await seedShortlisted(db, "Acme", "acme runs a weekday office lunch rota");
    await draft(BRIEF, db, {
      proposeDrafts: async () => [{
        prospect_id: prospectId, channel: "website_form", contact_value: "https://example.com/x",
        subject: "Hi", body: "Saw your weekday office lunch rota, per your site. Trial week?",
        next_action: "Send",
      }],
    }, budgetsWith());
    const drafts = await db.prepare("SELECT * FROM outreach_draft").all();
    expect(drafts.results).toHaveLength(1);
  });

  it("skips a draft whose body links to no own evidence", async () => {
    const { db, tables } = makeMockDb();
    seedRun(tables);
    const { prospectId } = await seedShortlisted(db, "Acme", "acme quoted, no contact here");
    await draft(BRIEF, db, {
      proposeDrafts: async () => [{
        prospect_id: prospectId, channel: "email", contact_value: "boss@acme.ng",
        subject: "Hi", body: "Hello wonderful team, let's synergize going forward",
        next_action: "Send",
      }],
    }, budgetsWith());
    const drafts = await db.prepare("SELECT * FROM outreach_draft").all();
    expect(drafts.results).toHaveLength(0);
    const acts = await db.prepare("SELECT * FROM activity WHERE prospect_id = ?").bind(prospectId).all<any>();
    expect(acts.results.some((a) => String(a.note).includes("links to no own evidence"))).toBe(true);
  });

  it("retries the draft burst once when no target gets a proposal", async () => {
    const { db, tables } = makeMockDb();
    seedRun(tables);
    const { prospectId } = await seedShortlisted(db, "Acme", "acme runs a weekday office lunch rota");
    const proposeDrafts = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        prospect_id: prospectId, channel: "website_form", contact_value: "https://example.com/x",
        subject: "Hi", body: "Saw your weekday office lunch rota [source 1]. Trial?",
        next_action: "Send",
      }]);
    const out = await draft(BRIEF, db, { proposeDrafts }, budgetsWith());
    expect(proposeDrafts).toHaveBeenCalledTimes(2);
    expect(out.status).toBe("completed");
    const drafts = await db.prepare("SELECT * FROM outreach_draft").all();
    expect(drafts.results).toHaveLength(1);
  });
});
