/**
 * product/src/research/budgets.ts — per-run budget checks (specs/research-loop.md §6).
 * Deterministic code: checked before every Meta call and every fetch; breach
 * stops the run with reason `budget_<name>` and status `stopped`.
 * No `cloudflare:workers` imports (runs under plain vitest/node).
 */

export interface BudgetCaps {
  searches: number; // <= 30
  fetches: number; // <= 40
  candidates: number; // <= 25
  tool_rounds: number; // <= 6 per burst
  cost_usd: number; // <= 6
  active_compute_s: number; // <= 1200 (20 min)
}

export interface BudgetConsumed {
  searches: number;
  fetches: number;
  candidates: number;
  tool_rounds: number;
  cost_usd_est: number;
  active_compute_s: number;
}

export const DEFAULT_CAPS: BudgetCaps = {
  searches: 30,
  fetches: 40,
  candidates: 25,
  tool_rounds: 6,
  cost_usd: 6,
  active_compute_s: 1200,
};

export function emptyConsumed(): BudgetConsumed {
  return { searches: 0, fetches: 0, candidates: 0, tool_rounds: 0, cost_usd_est: 0, active_compute_s: 0 };
}

export type BudgetKind = "searches" | "fetches" | "candidates" | "tool_rounds" | "cost" | "time";

/** Map a kind to its stop reason. */
export function budgetReason(kind: BudgetKind): string {
  switch (kind) {
    case "searches": return "budget_searches";
    case "fetches": return "budget_fetches";
    case "candidates": return "budget_candidates";
    case "tool_rounds": return "budget_tool_rounds";
    case "cost": return "budget_cost";
    case "time": return "budget_time";
  }
}

/**
 * Check a single prospective increment. Returns the stop reason when the cap
 * would be breached, else null. Pure function (no D1 writes).
 */
export function checkIncrement(
  kind: Exclude<BudgetKind, "cost" | "time">,
  consumed: BudgetConsumed,
  caps: BudgetCaps,
): string | null {
  const next = consumed[kind] + 1;
  const cap = caps[kind];
  return next > cap ? budgetReason(kind) : null;
}

/** Check cost/time counters (continuous resources). */
export function checkLevels(consumed: BudgetConsumed, caps: BudgetCaps): string | null {
  if (consumed.cost_usd_est > caps.cost_usd) return budgetReason("cost");
  if (consumed.active_compute_s > caps.active_compute_s) return budgetReason("time");
  return null;
}

/**
 * First breach across all counters, in deterministic priority order
 * (searches, fetches, candidates, rounds, cost, time). Returns null when clean.
 */
export function firstBreach(consumed: BudgetConsumed, caps: BudgetCaps): string | null {
  if (consumed.searches > caps.searches) return budgetReason("searches");
  if (consumed.fetches > caps.fetches) return budgetReason("fetches");
  if (consumed.candidates > caps.candidates) return budgetReason("candidates");
  if (consumed.tool_rounds > caps.tool_rounds) return budgetReason("tool_rounds");
  return checkLevels(consumed, caps);
}

/** Mutating counter increments (caller persists to D1 via writers). */
export function recordSearch(c: BudgetConsumed): void { c.searches += 1; c.tool_rounds += 1; }
export function recordFetch(c: BudgetConsumed, costEst = 0.01): void {
  c.fetches += 1; c.tool_rounds += 1; c.cost_usd_est += costEst;
}
export function recordCandidate(c: BudgetConsumed): void { c.candidates += 1; }
export function recordRound(c: BudgetConsumed, costEst = 0.02, computeS = 1): void {
  c.tool_rounds += 1; c.cost_usd_est += costEst; c.active_compute_s += computeS;
}
