/**
 * product/tests/routes.test.ts — journey API route tests with a mocked D1 DB.
 * Covers happy paths, 400s, illegal transitions, dedupe keys, and decisions.
 * No live model calls, no network: the Worker fetch handler runs in-process
 * against an in-memory mock implementing prepare/bind/first/all/run.
 */
import { describe, expect, it, vi } from "vitest";
import app from "../src/index";
import { dedupeKey } from "../src/db";
import { sealSecret } from "../src/delivery/crypto";
import { mockOutbox, resetMockOutbox } from "../src/delivery/providers";

vi.mock("../src/meta", () => ({
  MODEL_ID: "muse-spark-1.3",
  isDirectoryHost: () => false,
  isSocialHost: () => false,
  createMetaClient: () => ({
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
    proposeAssessments: async (targets: Array<{ id: string }>) =>
      targets.map((t) => ({
        prospect_id: t.id,
        fit_rating: 4,
        supporting_claims: ["Acme Catering exists"],
        rationale: "evidence-backed fit",
      })),
    proposeDrafts: async (targets: Array<{ id: string }>) =>
      targets.map((t) => ({
        prospect_id: t.id,
        channel: "website_form",
        contact_value: "https://acme.ng/contact",
        subject: "Weekday lunches",
        body: "Hello team, saw your lunch rota [source 1]. Trial week?",
        next_action: "Send intro",
        follow_up_days: 7,
      })),
    // Canned onboarding turn: always extracts decision_maker and always asks
    // a question, so skip/lock/cap tests prove the handler overrode it.
    onboardTurn: async () => ({
      fields: { decision_maker: { value: "HR manager", label: "inferred" } },
      question: { key: "order_size", prompt: "Typical order size?", chips: ["20-50", "50-200"] },
      done: false,
    }),
    rewriteDraft: async (input: { subject: string; body: string; tone: string }) => ({
      subject: input.subject + " (" + input.tone + ")",
      body: input.body + " [" + input.tone + " rewrite]",
    }),
  }),
}));

type Row = Record<string, any>;

// --- Minimal in-memory D1 mock (generic SQL subset used by the routes) -------

function makeMockDb(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {
    business_profile: [],
    research_run: [],
    evidence: [],
    prospect: [],
    assessment: [],
    contact_route: [],
    outreach_draft: [],
    activity: [],
    sender_connection: [],
    ...Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, v.map((r) => ({ ...r }))])),
  };

  const tableOf = (sql: string): string => {
    const m = /from\s+(\w+)/i.exec(sql);
    if (!m) throw new Error(`mock: no FROM in ${sql}`);
    return m[1];
  };
  const whereOf = (sql: string): string => {
    const parts = sql.split(/where/i);
    return parts.length > 1 ? parts.slice(1).join(" where ") : "";
  };
  const condCols = (where: string): string[] =>
    [...where.matchAll(/(\w+)\s*=\s*\?/g)].map((m) => m[1]);

  function select(sql: string, params: any[]): Row[] {
    const rows = tables[tableOf(sql)] ?? [];
    const cols = condCols(whereOf(sql));
    if (cols.length === 0) return rows.map((r) => ({ ...r }));
    return rows
      .filter((r) => cols.every((c, i) => r[c] === params[i]))
      .map((r) => ({ ...r }));
  }

  function mutate(sql: string, params: any[]): void {
    const insert = /insert\s+into\s+(\w+)\s*\(([^)]+)\)/i.exec(sql);
    if (insert) {
      const cols = insert[2].split(",").map((c) => c.trim());
      // D1 VALUES semantics: `?` consumes the next bound param, SQL literals
      // ('candidate', NULL, 0, ...) map directly (same as research.test.ts).
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
      tables[insert[1]].push(row);
      return;
    }
    const update = /update\s+(\w+)\s+set\s+(.+?)\s+where\s+(.+)/is.exec(sql);
    if (update) {
      // Ordered placeholder assignments; COALESCE(?, col) consumes a param too.
      const assigns: { col: string; coalesce: boolean }[] = [];
      const re = /(\w+)\s*=\s*(COALESCE\(\?,\s*\1\)|\?)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(update[2])) !== null) {
        assigns.push({ col: m[1], coalesce: m[2].startsWith("COALESCE") });
      }
      const wCols = condCols(update[3]);
      const wVals = params.slice(assigns.length);
      // Literal numeric SET assignments (e.g. edited_by_human = 1): no params.
      const literals: Array<{ col: string; val: number }> = [];
      const litRe = /(\w+)\s*=\s*(-?\d+(?:\.\d+)?)/g;
      let lit: RegExpExecArray | null;
      while ((lit = litRe.exec(update[2])) !== null) {
        literals.push({ col: lit[1], val: Number(lit[2]) });
      }
      for (const r of tables[update[1]] ?? []) {
        if (!wCols.every((c, i) => r[c] === wVals[i])) continue;
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
    throw new Error(`mock: unsupported mutation ${sql}`);
  }

  // Literal SET assignments without placeholders (confirm endpoint).
  const db = {
    __tables: tables,
    prepare(sql: string) {
      return {
        async first(col?: string) {
          const rows = select(sql, []);
          if (rows.length === 0) return null;
          return col !== undefined ? (rows[0][col] ?? rows[0]) : rows[0];
        },
        async all() {
          return { results: select(sql, []) };
        },
        async run() {
          mutate(sql, []);
          return { success: true };
        },
        bind(...params: any[]) {
          return {
            async first(col?: string) {
              const rows = select(sql, params);
              if (rows.length === 0) return null;
              const row = rows[0];
              if (col !== undefined) return row[col] ?? row;
              return row;
            },
            async all() {
              return { results: select(sql, params) };
            },
            async run() {
              mutate(sql, params);
              return { success: true };
            },
          };
        },
      };
    },
  };
  return db;
}

async function call(
  db: ReturnType<typeof makeMockDb>,
  method: string,
  path: string,
  body?: unknown,
  envExtra: Record<string, unknown> = {},
): Promise<{ status: number; body: any }> {
  const req = new Request(`https://test.local${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await (app as any).fetch(req, { DB: db, MODEL_API_KEY: "test", ...envExtra }, {});
  return { status: res.status, body: await res.json() };
}

function seedProfile(db: ReturnType<typeof makeMockDb>, overrides: Row = {}) {
  db.__tables.business_profile.push({
    id: "bp_1",
    name: "Acme Catering",
    website_url: null,
    description: "Corporate catering",
    services: JSON.stringify(["catering"]),
    value_proposition: "Fast",
    target_market: "Offices",
    service_area: JSON.stringify({ city: "Ikeja" }),
    constraints_json: JSON.stringify({}),
    provenance: JSON.stringify({ name: "stated" }),
    status: "draft",
    version: 1,
    confirmed_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  });
}

function seedRun(db: ReturnType<typeof makeMockDb>, overrides: Row = {}) {
  db.__tables.research_run.push({
    id: "run_1",
    profile_id: "bp_1",
    workflow_instance_id: "wf_1",
    plan: JSON.stringify({ queries: [] }),
    status: "created",
    stop_reason: null,
    budgets: JSON.stringify({ searches: 30 }),
    consumed: JSON.stringify({ searches: 0 }),
    started_at: new Date().toISOString(),
    finished_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  });
}

// --- Tests -------------------------------------------------------------------

describe("profiles", () => {
  it("creates a draft profile (happy path)", async () => {
    const db = makeMockDb();
    const res = await call(db, "POST", "/api/profiles", { name: "Acme" });
    expect(res.status).toBe(201);
    expect(res.body.id).toMatch(/^bp_/);
    expect(res.body.status).toBe("draft");
    expect(res.body.provenance.name).toBe("stated");
  });

  it("rejects missing name with 400", async () => {
    const db = makeMockDb();
    expect((await call(db, "POST", "/api/profiles", {})).status).toBe(400);
    expect((await call(db, "POST", "/api/profiles", { name: " " })).status).toBe(400);
  });

  it("extracts an explicit business name from the description", async () => {
    const db = makeMockDb();
    const res = await call(db, "POST", "/api/profiles", {
      description: "I run Adaeze Catering Services. We deliver packed lunches to offices in Ikeja.",
    });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Adaeze Catering Services");
    expect(res.body.provenance.name).toBe("assumed");
  });

  it("extracts a quoted business name from the description", async () => {
    const db = makeMockDb();
    const res = await call(db, "POST", "/api/profiles", {
      description: 'We are "Sparkle Office Cleaning" and we clean offices in Abuja.',
    });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Sparkle Office Cleaning");
    expect(res.body.provenance.name).toBe("assumed");
  });

  it("returns missing_name when no name can be resolved", async () => {
    const db = makeMockDb();
    const res = await call(db, "POST", "/api/profiles", {
      description: "We deliver packed lunches to offices in Ikeja and Yaba.",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("missing_name");
  });

  it("marks a skipped working name as assumed", async () => {
    const db = makeMockDb();
    const res = await call(db, "POST", "/api/profiles", { name: "My business", name_assumed: true });
    expect(res.status).toBe(201);
    expect(res.body.provenance.name).toBe("assumed");
  });

  it("reads back a profile and 404s when absent", async () => {
    const db = makeMockDb();
    seedProfile(db);
    const ok = await call(db, "GET", "/api/profiles/bp_1");
    expect(ok.status).toBe(200);
    expect(ok.body.services).toEqual(["catering"]);
    expect((await call(db, "GET", "/api/profiles/nope")).status).toBe(404);
  });

  it("applies answers with stated provenance, rejects empty", async () => {
    const db = makeMockDb();
    seedProfile(db);
    const res = await call(db, "POST", "/api/profiles/bp_1/answers", {
      answers: { target_market: "Tech startups" },
    });
    expect(res.status).toBe(200);
    expect(res.body.target_market).toBe("Tech startups");
    expect(res.body.provenance.target_market).toBe("stated");
    expect((await call(db, "POST", "/api/profiles/bp_1/answers", { answers: {} })).status).toBe(400);
    expect((await call(db, "POST", "/api/profiles/nope/answers", { answers: { a: "b" } })).status).toBe(404);
  });

  it("bump version when answering after confirm", async () => {
    const db = makeMockDb();
    seedProfile(db, { status: "confirmed", version: 1 });
    const res = await call(db, "POST", "/api/profiles/bp_1/answers", {
      answers: { description: "Updated" },
    });
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(2);
  });

  it("confirms a draft, rejects double confirm", async () => {
    const db = makeMockDb();
    seedProfile(db);
    const res = await call(db, "POST", "/api/profiles/bp_1/confirm", {});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("confirmed");
    expect(res.body.confirmed_at).toBeTruthy();
    expect((await call(db, "POST", "/api/profiles/bp_1/confirm", {})).status).toBe(400);
  });
});

describe("runs", () => {
  it("requires a confirmed brief", async () => {
    const db = makeMockDb();
    seedProfile(db); // draft
    const res = await call(db, "POST", "/api/runs", { profile_id: "bp_1" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("brief_not_confirmed");
  });

  it("creates a run, blocks a second active run, reads it back", async () => {
    const db = makeMockDb();
    seedProfile(db, { status: "confirmed" });
    const created = await call(db, "POST", "/api/runs", { profile_id: "bp_1" });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("created");
    expect((await call(db, "POST", "/api/runs", { profile_id: "bp_1" })).status).toBe(409);
    const got = await call(db, "GET", `/api/runs/${created.body.id}`);
    expect(got.status).toBe(200);
    expect(got.body.plan).toEqual({ queries: [] });
    expect((await call(db, "GET", "/api/runs/nope")).status).toBe(404);
  });

  it("resume: legal transition advances, illegal transition is 400", async () => {
    const db = makeMockDb();
    seedProfile(db, { status: "confirmed" });
    seedRun(db);
    const ok = await call(db, "POST", "/api/runs/run_1/resume", { to: "discovering" });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe("discovering");
    const bad = await call(db, "POST", "/api/runs/run_1/resume", { to: "complete" });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("illegal_transition");
    expect((await call(db, "POST", "/api/runs/run_1/resume", {})).status).toBe(400);
  });
});

describe("review/decide", () => {
  function seeded() {
    const db = makeMockDb();
    seedProfile(db, { status: "confirmed" });
    seedRun(db, { status: "awaiting_approval" });
    db.__tables.prospect.push({
      id: "pr_1",
      run_id: "run_1",
      name: "Venue One",
      category: "venue",
      location: JSON.stringify({ city: "Ikeja" }),
      dedupe_key: "venueone",
      status: "shortlisted",
      rank: 1,
      created_at: new Date().toISOString(),
    });
    db.__tables.evidence.push({
      id: "ev_1",
      run_id: "run_1",
      claim: "Has 500 seats",
      quote: "500-seat hall",
      source_url: "https://example.com/v",
      source_type: "fetched_page",
      retrieved_at: new Date().toISOString(),
      reliability: "verified",
      conflicts_with: null,
      supersedes: null,
      created_at: new Date().toISOString(),
    });
    db.__tables.outreach_draft.push({
      id: "dr_1",
      prospect_id: "pr_1",
      channel_suggestion: "email",
      subject: "Hello",
      body: "Saw [ev_1] …",
      next_action: "Call",
      follow_up_days: 7,
      status: "draft",
      edited_by_human: 0,
      decided_at: null,
      created_at: new Date().toISOString(),
    });
    return db;
  }

  it("lists prospects, evidence, drafts; 404s on unknown run", async () => {
    const db = seeded();
    expect((await call(db, "GET", "/api/runs/run_1/prospects")).body.prospects).toHaveLength(1);
    expect((await call(db, "GET", "/api/runs/run_1/evidence")).body.evidence).toHaveLength(1);
    expect((await call(db, "GET", "/api/runs/run_1/drafts")).body.drafts).toHaveLength(1);
    expect((await call(db, "GET", "/api/runs/nope/prospects")).status).toBe(404);
  });

  it("decides a draft, logs activity, rejects re-decision and bad values", async () => {
    const db = seeded();
    const res = await call(db, "POST", "/api/drafts/dr_1/decision", { decision: "approved" });
    expect(res.status).toBe(200);
    expect(res.body.draft.status).toBe("approved");
    expect(db.__tables.activity.length).toBeGreaterThan(0);
    expect((await call(db, "POST", "/api/drafts/dr_1/decision", { decision: "rejected" })).status).toBe(400);
    expect((await call(db, "POST", "/api/drafts/dr_1/decision", { decision: "sent" })).status).toBe(400);
    expect((await call(db, "POST", "/api/drafts/nope/decision", { decision: "approved" })).status).toBe(404);
  });

  it("decision delivers a drafts_decided event to the run's workflow instance", async () => {
    const db = seeded();
    const sendEvent = vi.fn(async () => {});
    const get = vi.fn(async (_id: string) => ({ sendEvent }));
    const res = await call(db, "POST", "/api/drafts/dr_1/decision", { decision: "approved" }, { RESEARCH_WORKFLOW: { get } });
    expect(res.status).toBe(200);
    expect(get).toHaveBeenCalledWith("wf_1");
    expect(sendEvent).toHaveBeenCalledWith({
      type: "drafts_decided",
      payload: { draft_id: "dr_1", decision: "approved" },
    });
  });

  it("statuses aggregate counts; follow-ups derive overdue approvals", async () => {
    const db = seeded();
    const st = await call(db, "GET", "/api/runs/run_1/statuses");
    expect(st.status).toBe(200);
    expect(st.body.prospects.total).toBe(1);
    expect(st.body.drafts.pending_decisions).toBe(1);
    const empty = await call(db, "GET", "/api/runs/run_1/follow-ups");
    expect(empty.body.follow_ups).toEqual([]);
    // Age the decision 10 days back with a 7-day follow-up: now overdue.
    const d = db.__tables.outreach_draft[0];
    d.status = "approved";
    d.decided_at = new Date(Date.now() - 10 * 86400000).toISOString();
    const due = await call(db, "GET", "/api/runs/run_1/follow-ups");
    expect(due.body.follow_ups).toHaveLength(1);
    expect(due.body.follow_ups[0].days_overdue).toBeGreaterThanOrEqual(3);
  });
});

describe("dedupe keys", () => {
  it("normalises names and domains to one key per prospect", () => {
    expect(dedupeKey("Acme Ltd", "https://Acme.com/")).toBe(dedupeKey("acme", "acme.com"));
    expect(dedupeKey("Acme Ltd", "acme.com")).not.toBe(dedupeKey("Acme Ltd", "other.com"));
    expect(dedupeKey("Venue One")).not.toBe(dedupeKey("Venue Two"));
  });
});

function seedProspectDetail(db: ReturnType<typeof makeMockDb>) {
  seedProfile(db);
  seedRun(db);
  db.__tables.prospect.push({
    id: "pr_1", run_id: "run_1", name: "Brightline Ltd", category: "Logistics",
    location: JSON.stringify({ area: "Ikeja GRA" }), dedupe_key: "brightline",
    status: "qualified", rank: 1, created_at: new Date().toISOString(),
  });
  db.__tables.evidence.push({
    id: "ev_1", run_id: "run_1", claim: "Brightline runs a lunch rota",
    quote: "weekday lunch rota for 45 staff", source_url: "https://brightline.ng/about",
    source_type: "fetched_page", retrieved_at: new Date().toISOString(),
    reliability: "high", conflicts_with: null, supersedes: null,
    created_at: new Date().toISOString(),
  });
  db.__tables.evidence.push({
    id: "ev_2", run_id: "run_1", claim: "unrelated claim",
    quote: "unrelated", source_url: null, source_type: "search_snippet",
    retrieved_at: new Date().toISOString(), reliability: "unknown",
    conflicts_with: null, supersedes: null, created_at: new Date().toISOString(),
  });
  db.__tables.assessment.push({
    id: "as_1", prospect_id: "pr_1", fit_rating: 4,
    supporting_evidence_ids: JSON.stringify(["ev_1"]),
    weakening_evidence_ids: JSON.stringify([]),
    uncertainties: JSON.stringify([]), missing_info: JSON.stringify([]),
    rationale: "strong fit", model_id: "muse-spark-1.3",
    created_at: new Date().toISOString(),
  });
  db.__tables.contact_route.push({
    id: "cr_1", prospect_id: "pr_1", channel: "website_form",
    value: "https://brightline.ng/contact", verification: "public_listing",
    evidence_id: "ev_1", created_at: new Date().toISOString(),
  });
  db.__tables.outreach_draft.push({
    id: "dr_1", prospect_id: "pr_1", channel_suggestion: "website_form",
    subject: "Lunches", body: "Hello [ev_1]", next_action: "Send intro",
    follow_up_days: 7, status: "draft", edited_by_human: 0, decided_at: null,
    created_at: new Date().toISOString(),
  });
}

describe("prospect detail", () => {
  it("404s for an unknown prospect", async () => {
    const db = makeMockDb();
    const res = await call(db, "GET", "/api/prospects/nope");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("prospect_not_found");
  });

  it("returns prospect with assessments, linked evidence and contact routes", async () => {
    const db = makeMockDb();
    seedProspectDetail(db);
    const res = await call(db, "GET", "/api/prospects/pr_1");
    expect(res.status).toBe(200);
    expect(res.body.prospect.name).toBe("Brightline Ltd");
    expect(res.body.prospect.location).toEqual({ area: "Ikeja GRA" });
    expect(res.body.assessments).toHaveLength(1);
    expect(res.body.assessments[0].supporting_evidence_ids).toEqual(["ev_1"]);
    // Only assessment-linked evidence is returned, not unrelated run evidence.
    expect(res.body.evidence.map((e: Row) => e.id)).toEqual(["ev_1"]);
    expect(res.body.contact_routes).toHaveLength(1);
    expect(res.body.contact_routes[0].verification).toBe("public_listing");
  });
});

describe("draft edits", () => {
  it("PATCH 404s for an unknown draft", async () => {
    const db = makeMockDb();
    const res = await call(db, "PATCH", "/api/drafts/nope", { body: "x [ev_1]" });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("draft_not_found");
  });

  it("PATCH rejects empty, mistyped and overlong edits with 400", async () => {
    const db = makeMockDb();
    seedProspectDetail(db);
    expect((await call(db, "PATCH", "/api/drafts/dr_1", {})).status).toBe(400);
    expect((await call(db, "PATCH", "/api/drafts/dr_1", { body: 42 })).status).toBe(400);
    expect((await call(db, "PATCH", "/api/drafts/dr_1", { subject: 7 })).status).toBe(400);
    expect((await call(db, "PATCH", "/api/drafts/dr_1", { body: "y".repeat(4001) })).status).toBe(400);
  });

  it("PATCH saves subject/body and flags edited_by_human", async () => {
    const db = makeMockDb();
    seedProspectDetail(db);
    const res = await call(db, "PATCH", "/api/drafts/dr_1", { subject: "New sub", body: "Hi [ev_1], edited" });
    expect(res.status).toBe(200);
    expect(res.body.draft.subject).toBe("New sub");
    expect(res.body.draft.body).toBe("Hi [ev_1], edited");
    expect(res.body.draft.edited_by_human).toBe(1);
    expect(res.body.draft.status).toBe("draft");
  });

  it("PATCH refuses edits once the draft is decided", async () => {
    const db = makeMockDb();
    seedProspectDetail(db);
    db.__tables.outreach_draft[0].status = "approved";
    expect((await call(db, "PATCH", "/api/drafts/dr_1", { body: "late [ev_1]" })).status).toBe(400);
  });

  it("decision accepts inline subject/body and records the edit", async () => {
    const db = makeMockDb();
    seedProspectDetail(db);
    const res = await call(db, "POST", "/api/drafts/dr_1/decision", {
      decision: "approved", subject: "Final sub", body: "Final [ev_1]",
    });
    expect(res.status).toBe(200);
    expect(res.body.draft.status).toBe("approved");
    expect(res.body.draft.subject).toBe("Final sub");
    expect(res.body.draft.body).toBe("Final [ev_1]");
    expect(res.body.draft.edited_by_human).toBe(1);
  });

  it("decision without edits preserves a prior save-edit flag", async () => {
    const db = makeMockDb();
    seedProspectDetail(db);
    expect((await call(db, "PATCH", "/api/drafts/dr_1", { body: "Edited [ev_1]" })).status).toBe(200);
    const res = await call(db, "POST", "/api/drafts/dr_1/decision", { decision: "approved" });
    expect(res.status).toBe(200);
    expect(res.body.draft.body).toBe("Edited [ev_1]");
    expect(res.body.draft.edited_by_human).toBe(1);
  });
});

describe("synchronous start (dev path)", () => {
  async function seedStartedRun(db: ReturnType<typeof makeMockDb>) {
    seedProfile(db, { status: "confirmed", confirmed_at: new Date().toISOString() });
    const created = await call(db, "POST", "/api/runs", { profile_id: "bp_1" });
    expect(created.status).toBe(201);
    return created.body.id as string;
  }

  it("404s for an unknown run", async () => {
    const db = makeMockDb();
    const res = await call(db, "POST", "/api/runs/nope/start", {});
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("run_not_found");
  });

  it("runs research synchronously to awaiting_approval with prospects and drafts", async () => {
    const db = makeMockDb();
    const runId = await seedStartedRun(db);
    const res = await call(db, "POST", `/api/runs/${runId}/start`, {});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("awaiting_approval");
    const prospects = await call(db, "GET", `/api/runs/${runId}/prospects`);
    expect(prospects.body.prospects.length).toBeGreaterThan(0);
    const drafts = await call(db, "GET", `/api/runs/${runId}/drafts`);
    expect(drafts.body.drafts.length).toBeGreaterThan(0);
  });

  it("409s when the run already left created", async () => {
    const db = makeMockDb();
    const runId = await seedStartedRun(db);
    await call(db, "POST", `/api/runs/${runId}/start`, {});
    const again = await call(db, "POST", `/api/runs/${runId}/start`, {});
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("run_not_startable");
  });

  it("501s on production, where the Workflow owns execution", async () => {
    const db = makeMockDb();
    const runId = await seedStartedRun(db);
    const res = await call(db, "POST", `/api/runs/${runId}/start`, {}, { ENVIRONMENT: "production" });
    expect(res.status).toBe(501);
    expect(res.body.error).toBe("use_workflow");
  });
});

describe("workflow trigger ownership", () => {
  it("does not trigger the Workflow in dev (start-route owns execution)", async () => {
    const db = makeMockDb();
    seedProfile(db, { status: "confirmed", confirmed_at: new Date().toISOString() });
    const create = vi.fn(async () => ({}));
    const res = await call(db, "POST", "/api/runs", { profile_id: "bp_1" }, { RESEARCH_WORKFLOW: { create } });
    expect(res.status).toBe(201);
    expect(create).not.toHaveBeenCalled();
  });

  it("triggers the Workflow once in production", async () => {
    const db = makeMockDb();
    seedProfile(db, { status: "confirmed", confirmed_at: new Date().toISOString() });
    const create = vi.fn(async () => ({}));
    const res = await call(
      db, "POST", "/api/runs", { profile_id: "bp_1" },
      { ENVIRONMENT: "production", RESEARCH_WORKFLOW: { create } },
    );
    expect(res.status).toBe(201);
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe("conversational onboarding", () => {
  it("rejects missing or oversized text with 400", async () => {
    const db = makeMockDb();
    const missing = await call(db, "POST", "/api/onboard/turn", { fields: {} });
    expect(missing.status).toBe(400);
    expect(missing.body.error).toBe("invalid_body");
    const big = await call(db, "POST", "/api/onboard/turn", { text: "x".repeat(2001), fields: {} });
    expect(big.status).toBe(400);
    expect(big.body.error).toBe("text_too_long");
  });

  it("merges one model turn and returns the next question", async () => {
    const db = makeMockDb();
    const res = await call(db, "POST", "/api/onboard/turn", {
      text: "I sell pastries to offices",
      fields: {},
      followups_used: 0,
    });
    expect(res.status).toBe(200);
    expect(res.body.fields.decision_maker.value).toBe("HR manager");
    expect(res.body.fields.decision_maker.label).not.toBe("user-provided");
    expect(res.body.question.key).toBe("order_size");
    expect(res.body.followups_used).toBe(1);
    expect(res.body.done).toBe(false);
  });

  it("never calls the model once the follow-up cap is reached", async () => {
    const db = makeMockDb();
    const res = await call(db, "POST", "/api/onboard/turn", {
      text: "anything",
      fields: { offering: { value: "pastries", label: "user-provided", locked: true } },
      followups_used: 3,
    });
    expect(res.status).toBe(200);
    expect(res.body.done).toBe(true);
    // The mocked model always returns a question, so a null question
    // proves the handler short-circuited without calling it.
    expect(res.body.question).toBeNull();
    expect(res.body.followups_used).toBe(3);
    expect(res.body.fields.offering.value).toBe("pastries");
  });

  it("honours skip: locked unknown fields survive model output", async () => {
    const db = makeMockDb();
    const res = await call(db, "POST", "/api/onboard/turn", {
      text: "skip",
      fields: { decision_maker: { value: "", label: "unknown", locked: true } },
      followups_used: 0,
      skip_key: "decision_maker",
    });
    expect(res.status).toBe(200);
    // The mocked model returns a decision_maker value; the skip must win.
    expect(res.body.fields.decision_maker.label).toBe("unknown");
    expect(res.body.fields.decision_maker.locked).toBe(true);
  });

  it("honours edit: user-provided locked fields are never overwritten", async () => {
    const db = makeMockDb();
    const res = await call(db, "POST", "/api/onboard/turn", {
      text: "actually the office manager decides",
      fields: { decision_maker: { value: "Office manager", label: "user-provided", locked: true } },
      followups_used: 0,
      edit_key: "decision_maker",
      edit_value: "Office manager",
    });
    expect(res.status).toBe(200);
    expect(res.body.fields.decision_maker.value).toBe("Office manager");
    expect(res.body.fields.decision_maker.label).toBe("user-provided");
  });

  it("fails closed with 500 when the model key is missing", async () => {
    const db = makeMockDb();
    const res = await call(
      db, "POST", "/api/onboard/turn",
      { text: "hello", fields: {}, followups_used: 0 },
      { MODEL_API_KEY: undefined },
    );
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("model_not_configured");
  });

  it("rejects unknown field keys and unknown skip keys", async () => {
    const db = makeMockDb();
    const bad = await call(db, "POST", "/api/onboard/turn", {
      text: "hi",
      fields: { favourite_colour: { value: "blue", label: "user-provided" } },
      followups_used: 0,
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("unknown_field_key");
    const badSkip = await call(db, "POST", "/api/onboard/turn", {
      text: "skip",
      fields: {},
      followups_used: 0,
      skip_key: "favourite_colour",
    });
    expect(badSkip.status).toBe(400);
    expect(badSkip.body.error).toBe("unknown_field_key");
  });
});

describe("studio rewrite + test-send", () => {
  const TEST_KEY = btoa("0123456789abcdef0123456789abcdef");

  function seededStudio(channel = "email") {
    const db = makeMockDb();
    seedProfile(db, { status: "confirmed" });
    seedRun(db, { status: "awaiting_approval" });
    db.__tables.prospect.push({
      id: "pr_1", run_id: "run_1", name: "Venue One", status: "shortlisted",
    });
    db.__tables.outreach_draft.push({
      id: "dr_1", prospect_id: "pr_1", channel_suggestion: channel,
      subject: "Hello", body: "Saw the new branch.", next_action: "Call",
      follow_up_days: 7, status: "draft", edited_by_human: 0,
      decided_at: null, created_at: new Date().toISOString(),
    });
    return db;
  }

  async function seedConn(db: ReturnType<typeof makeMockDb>) {
    const now = new Date().toISOString();
    const blob = await sealSecret(JSON.stringify({ api_key: "k" }), TEST_KEY);
    db.__tables.sender_connection.push({
      id: "conn_1", provider: "mock", label: "Mock", sender_email: "me@co.ng",
      sender_name: null, status: "connected", secret_blob: JSON.stringify(blob),
      metadata_json: "{}", last_verified_at: now, last_error: null,
      created_at: now, updated_at: now,
    });
  }

  it("POST /api/drafts/:id/rewrite 404s on unknown draft, 400s on bad tone", async () => {
    const db = seededStudio();
    const nope = await call(db, "POST", "/api/drafts/nope/rewrite", { tone: "warmer" });
    expect(nope.status).toBe(404);
    expect(nope.body.error).toBe("draft_not_found");
    const bad = await call(db, "POST", "/api/drafts/dr_1/rewrite", { tone: "shouty" });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("unknown_tone");
    const empty = await call(db, "POST", "/api/drafts/dr_1/rewrite", {});
    expect(empty.status).toBe(400);
  });

  it("rewrite persists the new text and marks the draft edited", async () => {
    const db = seededStudio();
    const res = await call(db, "POST", "/api/drafts/dr_1/rewrite", { tone: "warmer" });
    expect(res.status).toBe(200);
    expect(res.body.draft.body).toContain("[warmer rewrite]");
    expect(res.body.draft.subject).toContain("(warmer)");
    expect(res.body.draft.edited_by_human).toBe(1);
    const again = await call(db, "POST", "/api/drafts/dr_1/rewrite", { tone: "more_direct" });
    expect(again.status).toBe(200);
    expect(again.body.draft.body).toContain("[more_direct rewrite]");
  });

  it("rewrite refuses decided drafts", async () => {
    const db = seededStudio();
    await call(db, "POST", "/api/drafts/dr_1/decision", { decision: "approved" });
    const res = await call(db, "POST", "/api/drafts/dr_1/rewrite", { tone: "warmer" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("illegal_edit");
  });

  it("POST /api/drafts/:id/test-send 404s on unknown draft", async () => {
    const db = seededStudio();
    await seedConn(db);
    const res = await call(db, "POST", "/api/drafts/nope/test-send", {}, { CRED_KEY: TEST_KEY });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("draft_not_found");
  });

  it("test-send needs a connected sender", async () => {
    const db = seededStudio();
    const res = await call(db, "POST", "/api/drafts/dr_1/test-send", {}, { CRED_KEY: TEST_KEY });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("no_sender");
  });

  it("test-send refuses non-email drafts", async () => {
    const db = seededStudio("whatsapp");
    await seedConn(db);
    const res = await call(db, "POST", "/api/drafts/dr_1/test-send", {}, { CRED_KEY: TEST_KEY });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("wrong_channel");
  });

  it("test-send delivers to the sender address and logs activity", async () => {
    const db = seededStudio();
    await seedConn(db);
    resetMockOutbox();
    const res = await call(db, "POST", "/api/drafts/dr_1/test-send", {}, { CRED_KEY: TEST_KEY });
    expect(res.status).toBe(200);
    expect(res.body.to).toBe("me@co.ng");
    expect(mockOutbox).toHaveLength(1);
    expect(mockOutbox[0].req.to).toBe("me@co.ng");
    expect(mockOutbox[0].req.subject).toContain("[Test]");
    const acts = db.__tables.activity.filter((a) => a.event === "test_send");
    expect(acts).toHaveLength(1);
    expect(acts[0].prospect_id).toBe("pr_1");
  });
});

describe("/demo path", () => {
  it("serves the app shell for non-navigation /demo requests", async () => {
    const db = makeMockDb();
    const html = "<html>shell</html>";
    const assets = { fetch: async () => new Response(html, { headers: { "content-type": "text/html" } }) };
    const res = await (app as any).fetch(
      new Request("https://test.local/demo"),
      { DB: db, MODEL_API_KEY: "test", ASSETS: assets }, {});
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(html);
  });
  it("returns 404 for /demo without an ASSETS binding", async () => {
    const db = makeMockDb();
    const res = await (app as any).fetch(
      new Request("https://test.local/demo"),
      { DB: db, MODEL_API_KEY: "test" }, {});
    expect(res.status).toBe(404);
  });
});
