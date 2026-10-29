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
  saveCandidate,
  saveEvidence,
  setProspectStatus,
} from "../src/db";
import { budgetReason, DEFAULT_CAPS, emptyConsumed } from "../src/research/budgets";
import {
  assess,
  briefGateDecision,
  discover,
  draftGateDecision,
  investigate,
  listAssessments,
  type BudgetState,
} from "../src/research/phases";
import { dedupeKey } from "../src/db";
import { ResearchWorkflow } from "../src/orchestrator";

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
});

// --- budget caps ---------------------------------------------------------------

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

describe("fetch failures", () => {
  it("records explicit fetch-failure evidence instead of skipping", async () => {
    const { db, tables } = makeMockDb();
    seedRun(tables);
    await seedCandidate(db, "Blocked Co");
    const out = await investigate(
      BRIEF,
      db,
      { fetchPage: async () => ({ failure: "blocked" as const, detail: "robots denied" }) },
      budgetsWith(),
    );
    expect(out.status).toBe("completed");
    const evs = await listEvidence(db, RUN_ID);
    const failures = evs.filter(
      (e) => e.source_type === "fetched_page" && e.claim.includes("fetch failed"),
    );
    expect(failures.length).toBeGreaterThan(0);
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
    const { prospectId } = await seedCandidate(db, "Fuzzy Co");
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
