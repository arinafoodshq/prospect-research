/**
 * product/tests/workflow-failure.test.ts — the stranding regression
 * (run_109a87e6): the research Workflow errored mid-assess and nothing told
 * D1, so the run row froze at "assessing" and the UI said "Working now"
 * forever. The entrypoint must mark the run failed before rethrowing.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResearchWorkflowEntrypoint } from "../src/workflow";

type Row = Record<string, unknown>;

function makeEnvDb() {
  const updates: Array<{ sql: string; params: unknown[] }> = [];
  const tables: Record<string, Row[]> = {
    research_run: [{
      id: "run_1", profile_id: "bp_1", workflow_instance_id: "wf_1",
      plan: "[]", status: "assessing", stop_reason: null, commercial_brief: null,
      budgets: "{}", consumed: "{}",
      started_at: "t", finished_at: null, created_at: "t",
    }],
    business_profile: [{
      id: "bp_1", name: "Grill spot", website_url: null,
      description: "grill chicken for events", services: "[]",
      value_proposition: "", target_market: "events", service_area: "{}",
      constraints_json: "{}", provenance: "{}", status: "confirmed",
      version: 1, confirmed_at: "t", created_at: "t",
    }],
  };
  const db = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            async first<T>(): Promise<T | null> {
              const table = /from\s+(\w+)/i.exec(sql)?.[1];
              const rows = table ? tables[table] ?? [] : [];
              return (rows[0] ?? null) as T | null;
            },
            async all<T>(): Promise<{ results: T[] }> {
              const table = /from\s+(\w+)/i.exec(sql)?.[1];
              return { results: (table ? tables[table] ?? [] : []) as T[] };
            },
            async run() {
              updates.push({ sql, params });
              return { success: true };
            },
          };
        },
      };
    },
  };
  return { db, updates };
}

/** Fake WorkflowStep: executes step bodies inline, records their names. */
function makeFakeStep() {
  const names: string[] = [];
  const step = {
    do(_name: string, _opts: unknown, fn?: () => Promise<unknown>) {
      const body = (typeof _opts === "function" ? _opts : fn) as () => Promise<unknown>;
      names.push(_name);
      return body();
    },
    waitForEvent(): Promise<never> {
      return new Promise(() => { /* never resolves: gates block the test run */ });
    },
  };
  return { step, names };
}

describe("ResearchWorkflowEntrypoint failure handling", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("marks the run failed when a phase dies, then rethrows", async () => {
    const { db, updates } = makeEnvDb();
    const { step, names } = makeFakeStep();
    // The plan phase builds its brief through the real MetaClient: make the
    // network call fail so run() throws after plan stops.
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("meta unreachable"); }));
    const wf = new ResearchWorkflowEntrypoint();
    (wf as unknown as { env: unknown }).env = { DB: db, MODEL_API_KEY: "test-key" };

    await expect(
      wf.run({ payload: { run_id: "run_1" } } as never, step as never),
    ).rejects.toThrow();

    expect(names).toContain("mark-failed");
    const marker = updates.find((u) => /UPDATE research_run SET status/.test(u.sql));
    expect(marker).toBeTruthy();
    expect(marker?.params[0]).toBe("failed");
    expect(String(marker?.params[1])).toContain("workflow_error");
  });

  it("rethrows even when the failure marker itself cannot be written", async () => {
    const { db } = makeEnvDb();
    const { step } = makeFakeStep();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    const wf = new ResearchWorkflowEntrypoint();
    (wf as unknown as { env: unknown }).env = {
      // Same reads succeed, but every D1 write fails: the marker is
      // best-effort and the original error must still surface.
      DB: {
        prepare(sql: string) {
          return {
            bind() {
              return {
                async first<T>(): Promise<T | null> {
                  const table = /from\s+(\w+)/i.exec(sql)?.[1];
                  const rows = table === "research_run"
                    ? [{ id: "run_1", status: "assessing" }]
                    : table === "business_profile"
                      ? [{ id: "bp_1", status: "confirmed", description: "grill chicken for events" }]
                      : [];
                  return (rows[0] ?? null) as T | null;
                },
                async all(): Promise<{ results: unknown[] }> { return { results: [] }; },
                async run(): Promise<never> { throw new Error("d1 down"); },
              };
            },
          };
        },
      },
      MODEL_API_KEY: "test-key",
    };
    await expect(
      wf.run({ payload: { run_id: "run_1" } } as never, step as never),
    ).rejects.toThrow();
  });
});
