/**
 * product/tests/consumed.test.ts — cumulative run budget counters.
 * loadRunConsumed must seed a phase's counters from the persisted run row
 * (caps then span the whole run, not one phase) and persistRunConsumed must
 * write them back best-effort (never throwing).
 */
import { describe, expect, it } from "vitest";
import { loadRunConsumed, persistRunConsumed } from "../src/orchestrator";

/** One-statement mock D1: serves a fixed row for SELECT, records UPDATEs. */
function makeDb(row: Record<string, unknown> | null) {
  const updates: Array<{ sql: string; params: unknown[] }> = [];
  return {
    db: {
      prepare(sql: string) {
        return {
          bind(...params: unknown[]) {
            return {
              async first<T>(): Promise<T | null> { return (row ? ({ ...row } as T) : null); },
              async run() {
                updates.push({ sql, params });
                return { success: true };
              },
            };
          },
        };
      },
    },
    updates,
  };
}

const RUN_ID = "run_test";

describe("loadRunConsumed", () => {
  it("seeds counters from the persisted run row", async () => {
    const { db } = makeDb({ consumed: JSON.stringify({ searches: 12, fetches: 20, candidates: 7, tool_rounds: 30, cost_usd_est: 0.4, active_compute_s: 60 }) });
    const consumed = await loadRunConsumed(db as never, RUN_ID);
    expect(consumed).toEqual({ searches: 12, fetches: 20, candidates: 7, tool_rounds: 0, cost_usd_est: 0.4, active_compute_s: 60 });
  });

  it("resets tool_rounds to zero: the cap is per burst, never cumulative", async () => {
    // run_109a87e6 regression: investigate's 19 rounds rode into assess and
    // tripped the 6-per-burst cap at phase entry, erroring the instance.
    const { db } = makeDb({ consumed: JSON.stringify({ searches: 1, fetches: 17, candidates: 25, tool_rounds: 19, cost_usd_est: 0.2, active_compute_s: 9 }) });
    const consumed = await loadRunConsumed(db as never, RUN_ID);
    expect(consumed.searches).toBe(1);
    expect(consumed.fetches).toBe(17);
    expect(consumed.candidates).toBe(25);
    expect(consumed.tool_rounds).toBe(0);
  });

  it("starts from zeros when the row or counters are missing/corrupt", async () => {
    const empty = await loadRunConsumed(makeDb(null).db as never, RUN_ID);
    expect(empty).toEqual({ searches: 0, fetches: 0, candidates: 0, tool_rounds: 0, cost_usd_est: 0, active_compute_s: 0 });
    const corrupt = await loadRunConsumed(makeDb({ consumed: "{not json" }).db as never, RUN_ID);
    expect(corrupt.searches).toBe(0);
    const partial = await loadRunConsumed(makeDb({ consumed: JSON.stringify({ searches: -3, fetches: "x", candidates: 2 }) }).db as never, RUN_ID);
    expect(partial.searches).toBe(0); // negative junk ignored
    expect(partial.fetches).toBe(0);  // non-number ignored
    expect(partial.candidates).toBe(2); // valid field carried over
  });
});

describe("persistRunConsumed", () => {
  it("writes the counters back to the run row", async () => {
    const { db, updates } = makeDb(null);
    const consumed = { searches: 5, fetches: 9, candidates: 3, tool_rounds: 14, cost_usd_est: 0.12, active_compute_s: 9 };
    await persistRunConsumed(db as never, RUN_ID, consumed);
    expect(updates).toHaveLength(1);
    expect(updates[0].sql).toContain("UPDATE research_run SET consumed");
    expect(JSON.parse(updates[0].params[0] as string)).toEqual(consumed);
  });

  it("never throws when the write fails", async () => {
    const failing = {
      prepare() {
        return {
          bind() {
            return { async run(): Promise<never> { throw new Error("d1 down"); } };
          },
        };
      },
    };
    await expect(persistRunConsumed(failing as never, RUN_ID, { searches: 1, fetches: 1, candidates: 1, tool_rounds: 2, cost_usd_est: 0, active_compute_s: 0 })).resolves.toBeUndefined();
  });
});
