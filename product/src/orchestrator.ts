/**
 * product/src/orchestrator.ts — research-run orchestration (specs/research-loop.md §3,9).
 * Workerd-free: no `cloudflare:workers` import, so this module is unit-testable
 * in Node. The production Workflow entrypoint lives in workflow.ts and maps the
 * real WorkflowStep onto WorkflowRuntime; the dev start-route drives runPhases()
 * with an inline runtime (no gates, no close — the run parks at
 * awaiting_approval for human decisions).
 */
import { getRun, listEvidence, listProspects, setRunStatus, type Db, type RunStatus } from "./db";
import { DEFAULT_CAPS, emptyConsumed, type BudgetConsumed } from "./research/budgets";
import { validateBrief } from "./research/commercial";
import {
  assess,
  briefGateDecision,
  close,
  discover,
  draft,
  fetchAssessmentMap,
  investigate,
  plan,
  rank,
  runQuality,
  type Brief,
  type MetaClient,
  type PhaseOutcome,
  type RunQuality,
} from "./research/phases";
import { completed, stopped } from "./research/phases";

export type WorkflowPhase =
  | "plan" | "discover" | "investigate" | "assess" | "rank" | "draft" | "close";

export type GateName = "brief_confirmed" | "drafts_decided";

export interface PhaseEvent {
  phase: WorkflowPhase;
  status: "started" | "completed" | "failed" | "paused";
  detail?: string;
}

export interface RunPlan {
  queries: string[];
}

/** Budgets mirrored from specs/architecture.md §6 (per research run). */
export interface WorkflowBudgets {
  searches: number; // <= 30
  fetches: number; // <= 40
  candidates: number; // <= 25
  cost_usd: number; // <= 6
  active_compute_s: number; // <= 1200 (20 min)
}

/** Minimal Workflow runtime surface (real WorkflowEntrypoint in prod). */
export interface WorkflowRuntime {
  step(name: string, fn: () => Promise<unknown>): Promise<unknown>;
  // waitName keys the persisted step (must be unique per wait); type routes
  // the event to the waiter (constant per gate).
  waitForEvent(waitName: string, type: GateName): Promise<unknown>;
  log(message: string): void;
}

export const DEFAULT_BUDGETS: WorkflowBudgets = {
  searches: 30, fetches: 40, candidates: 25, cost_usd: 6, active_compute_s: 1200,
};

export const RETRY_POLICY = {
  maxAttempts: 3,
  backoffMs: [1000, 4000, 15000],
} as const;

/** Per-step retry config (Workflow step options; retries cover 429/5xx/fetch failures). */
export const STEP_RETRIES = {
  retries: { limit: RETRY_POLICY.maxAttempts, delay: "5 second", backoff: "exponential" },
} as const;

/**
 * Error taxonomy per specs/research-loop.md §7.
 * - retryable (429/5xx/timeout): Workflow step retry with backoff, then pause with resume.
 * - fatal (400/401): run failed with report.
 * - honest outcomes (zero results, search skipped, fetch blocked): labelled gaps, never errors.
 */
export type StepErrorKind = "retryable" | "fatal" | "honest_gap";

export function classifyStepError(statusCode: number | null, outcome: string): StepErrorKind {
  if (outcome === "zero_results" || outcome === "search_not_run" || outcome === "fetch_blocked") return "honest_gap";
  if (statusCode === 429 || (statusCode !== null && statusCode >= 500) || outcome === "timeout") return "retryable";
  if (statusCode === 400 || statusCode === 401) return "fatal";
  return "retryable";
}

/**
 * Cumulative budget counters. Phases run in fresh isolates (Workflow steps
 * resume stateless), so per-phase zeroed counters reset the run's caps every
 * phase and the progress UI read "0 searches, 0 page opens" forever. These
 * helpers load the run's persisted counters at phase start and persist them
 * at phase end, making caps and the UI truly per-run. Best-effort persist:
 * a failed write must not fail a phase that already succeeded (step retry
 * would re-run the phase and duplicate its D1 side effects).
 */
export async function loadRunConsumed(db: Db, run_id: string): Promise<BudgetConsumed> {
  const consumed = emptyConsumed();
  try {
    const row = await db.prepare("SELECT consumed FROM research_run WHERE id = ?").bind(run_id)
      .first<{ consumed: string }>();
    const parsed: unknown = JSON.parse(row?.consumed ?? "{}");
    if (typeof parsed === "object" && parsed !== null) {
      const src = parsed as Record<string, unknown>;
      for (const key of Object.keys(consumed) as Array<keyof BudgetConsumed>) {
        if (key === "tool_rounds") continue; // per-burst cap (spec §6): never cumulative
        const v = src[key];
        if (typeof v === "number" && Number.isFinite(v) && v > 0) consumed[key] = v;
      }
    }
  } catch { /* missing/corrupt counters: start from zeros */ }
  return consumed;
}

export async function persistRunConsumed(db: Db, run_id: string, consumed: BudgetConsumed): Promise<void> {
  try {
    await db.prepare("UPDATE research_run SET consumed = ? WHERE id = ?")
      .bind(JSON.stringify(consumed), run_id).run();
  } catch { /* best-effort: counters are advisory, never fail the phase */ }
}

export interface OrchestratorDeps {
  db: Db;
  meta: MetaClient;
  brief: Brief;
  run_id: string;
}

/** Phase order fixed by the spec; gates bracket the run. */
export const PHASE_ORDER: WorkflowPhase[] = ["plan", "discover", "investigate", "assess", "rank", "draft", "close"];

/** Pure decision helper: which gate (if any) precedes/follows a phase. */
export function gateForPhase(phase: WorkflowPhase, when: "before" | "after"): GateName | null {
  if (phase === "plan" && when === "after") return "brief_confirmed";
  if (phase === "draft" && when === "after") return "drafts_decided";
  return null;
}

/**
 * Re-hand the stored commercial brief to the model client. Workflow steps
 * resume in fresh isolates, so the setBrief call plan() made in its own
 * incarnation is lost to discover/investigate/assess/draft (run_99840398
 * ran every post-plan phase on legacy prompts: 0/25 dimensional verdicts).
 * Durable state (D1) is the only thing that crosses the step boundary, so
 * every phase reloads the brief from the run row. No-op for legacy runs.
 */
export async function hydrateBriefFromRun(db: Db, meta: MetaClient, run_id: string): Promise<void> {
  if (!meta.setBrief) return;
  try {
    const run = await getRun(db, run_id);
    if (!run?.commercial_brief) return;
    meta.setBrief(validateBrief(JSON.parse(run.commercial_brief)));
  } catch {
    /* corrupt brief JSON: stay on legacy prompts rather than fail the run */
  }
}

/** Run-status marker per phase (rank shares assessing; there is no ranking status). */
const PHASE_RUN_STATUS: Record<Exclude<WorkflowPhase, "close">, RunStatus | null> = {
  plan: null,
  discover: "discovering",
  investigate: "investigating",
  assess: "assessing",
  rank: null,
  draft: "drafting",
};

/**
 * ResearchWorkflow skeleton/orchestrator. Phase bodies delegate to the
 * Worker-side phase helpers (Meta bursts + validated D1 writers).
 */
export class ResearchWorkflow {
  constructor(private runtime: WorkflowRuntime, private deps?: OrchestratorDeps) {}

  async run(): Promise<void> {
    // Brief gate first: runs are created only from confirmed briefs, so this
    // is normally a no-op; an unconfirmed brief waits instead of planning.
    if (!this.deps || briefGateDecision(this.deps.brief).wait) {
      await this.gate("brief_confirmed", "run cannot plan until the brief is confirmed");
    }
    await this.phase("plan", () => this.plan());
    // Agentic QA loop (owner direction 2026-10-30): research one sweep, then
    // JUDGE it — enough good buyers, or loop back with freshly planned
    // queries. Budget and a 3-sweep cap bound the loop; Workflow steps keep
    // every sweep replay-safe.
    const TARGET_GOOD = 4;
    const MAX_SWEEPS = 3;
    let prevCandidates = -1;
    for (let sweep = 1; sweep <= MAX_SWEEPS; sweep += 1) {
      await this.phase("discover", () => this.dispatch("discover"));
      await this.phase("investigate", () => this.dispatch("investigate"));
      await this.phase("assess", () => this.dispatch("assess"));
      const qa = await this.runtime.step(`qa:${sweep}`, () => this.qualitySnapshot()) as RunQuality & { budgetLeft: boolean };
      this.runtime.log(`qa sweep ${sweep}: good ${qa.good}, junk ${qa.junk}, candidates ${qa.candidates}, unlocated ${qa.unlocated}`);
      if (qa.good >= TARGET_GOOD) break; // quality bar met
      if (qa.candidates === prevCandidates) break; // planner exhausted: no new candidates
      prevCandidates = qa.candidates;
      if (!qa.budgetLeft || sweep === MAX_SWEEPS) break; // rank what exists
      const fresh = await this.replan(sweep, qa);
      if (!fresh) break; // model produced nothing new: rank what exists
    }
    await this.phase("rank", () => this.dispatch("rank"));
    await this.phase("draft", () => this.dispatch("draft"));
    // Park visibly at awaiting_approval before the first wait so the UI can
    // poll progress while humans decide (drafting -> awaiting_approval).
    // Idempotent: draft() already parks best-effort, so skip when landed.
    if (this.deps) {
      const { db, run_id } = this.deps;
      await this.runtime.step("status:awaiting_approval", async () => {
        const row = await db.prepare("SELECT status FROM research_run WHERE id = ?").bind(run_id)
          .first<{ status: RunStatus }>();
        if (row && row.status !== "awaiting_approval") await setRunStatus(db, run_id, "awaiting_approval");
      });
    }
    // Drafts gate: re-check after every wake — one event per decision, and
    // waitForEvent resolves on the first, so a single wait would close early.
    for (;;) {
      const undecided = await this.undecidedDrafts();
      if (undecided === 0) break;
      await this.gate("drafts_decided", `run waits at awaiting_approval until ${undecided} draft(s) are decided`);
    }
    await this.phase("close", () => this.close());
  }

  /** Count of undecided drafts scoped to this run's prospects. */
  private async undecidedDrafts(): Promise<number> {
    if (!this.deps) throw new Error("gate check requires injected deps");
    return (await this.runDrafts()).filter((d) => d.status === "draft").length;
  }

  /** All draft rows scoped to this run's prospects (never cross-run). */
  private async runDrafts(): Promise<Array<{ id: string; status: string }>> {
    if (!this.deps) throw new Error("draft read requires injected deps");
    const ids = await this.deps.db.prepare("SELECT id FROM prospect WHERE run_id = ?")
      .bind(this.deps.run_id).all<{ id: string }>();
    const mine = new Set((ids.results ?? []).map((r) => r.id));
    const { results } = await this.deps.db.prepare("SELECT id, status, prospect_id FROM outreach_draft")
      .all<{ id: string; status: string; prospect_id: string }>();
    return (results ?? []).filter((d) => mine.has(d.prospect_id));
  }

  /**
   * runPhases: synchronous driver for the dev start-route — plan, then the
   * same QA sweeps as the Workflow path (no gates, no close). A stopped phase
   * parks the run stopped with the phase reason; an exception parks it failed.
   */
  async runPhases(): Promise<PhaseOutcome> {
    if (!this.deps) throw new Error("runPhases requires injected deps");
    const first = await this.runPhasesPhase("plan");
    if (first) return first;
    // Agentic QA loop, dev flavor: same sweep/quality/replan logic as run().
    const TARGET_GOOD = 4;
    const MAX_SWEEPS = 3;
    let prevCandidates = -1;
    for (let sweep = 1; sweep <= MAX_SWEEPS; sweep += 1) {
      for (const name of ["discover", "investigate", "assess"] as const) {
        const out = await this.runPhasesPhase(name);
        if (out) return out;
      }
      const qa = await this.qualitySnapshot();
      this.runtime.log(`qa sweep ${sweep}: good ${qa.good}, junk ${qa.junk}, candidates ${qa.candidates}, unlocated ${qa.unlocated}`);
      if (qa.good >= TARGET_GOOD) break;
      if (qa.candidates === prevCandidates) break;
      prevCandidates = qa.candidates;
      if (!qa.budgetLeft || sweep === MAX_SWEEPS) break;
      const fresh = await this.replan(sweep, qa);
      if (!fresh) break;
    }
    const rankOutcome = await this.runPhasesPhase("rank");
    if (rankOutcome) return rankOutcome;
    const draftOutcome = await this.runPhasesPhase("draft");
    return draftOutcome ?? completed("plan through draft complete");
  }

  /** One named phase through the runtime (dev driver); null when the run
   * parked stopped/failed — the caller decides whether that ends the run. */
  private async runPhasesPhase(name: WorkflowPhase): Promise<PhaseOutcome | null> {
    if (!this.deps) throw new Error("runPhasesPhase requires injected deps");
    const { db, run_id } = this.deps;
    const marker = name === "close" ? null : PHASE_RUN_STATUS[name as Exclude<WorkflowPhase, "close">];
    if (marker) {
      try {
        await setRunStatus(db, run_id, marker);
      } catch {
        return stopped("run_not_startable", `cannot move run to ${marker}`);
      }
    }
    let outcome: PhaseOutcome;
    try {
      this.runtime.log(`phase ${name} started`);
      const stepResult = name === "plan"
        ? await this.runtime.step(`phase:${name}`, () => this.execPlan())
        : await this.runtime.step(`phase:${name}`, () => this.execPhase(name as Exclude<WorkflowPhase, "plan" | "close">));
      outcome = stepResult as PhaseOutcome;
      this.runtime.log(`phase ${name} ${outcome.status}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.runtime.log(`phase ${name} failed: ${msg}`);
      try {
        await setRunStatus(db, run_id, "failed", `phase_failed:${name}`);
      } catch { /* failed marker best-effort */ }
      return stopped("phase_failed", `${name}: ${msg}`);
    }
    if (outcome.status === "stopped") {
      try {
        await setRunStatus(db, run_id, "stopped", outcome.stop_reason);
      } catch { /* stopped marker best-effort */ }
      return outcome;
    }
    return null;
  }

  private async phase(name: WorkflowPhase, fn: () => Promise<unknown>): Promise<void> {
    this.runtime.log(`phase ${name} started`);
    // Status markers inside steps: replay-safe (cached on wake), unlike bare
    // D1 writes which would re-execute and trip transition validation.
    const marker = name === "close" ? null : PHASE_RUN_STATUS[name];
    if (marker && this.deps) {
      const { db, run_id } = this.deps;
      await this.runtime.step(`status:${marker}`, () => setRunStatus(db, run_id, marker));
    }
    try {
      await this.runtime.step(`phase:${name}`, fn);
      this.runtime.log(`phase ${name} completed`);
    } catch (err) {
      this.runtime.log(`phase ${name} failed: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }

  private gateSeq = 0;

  private async gate(type: GateName, reason: string): Promise<void> {
    // Fresh wait name per call: step names key persisted results, so
    // re-waiting on one name would return the first event forever instead of
    // blocking for the next decision. The event *type* stays constant so
    // every sender wakes the current waiter.
    // NOTE: waitForEvent defaults to a 24h timeout — a human gate parked
    // longer errors the instance (demo-acceptable; revisit for production).
    this.gateSeq += 1;
    const waitName = `${type}#${this.gateSeq}`;
    this.runtime.log(`gate ${type} waiting (${reason}; wait ${waitName})`);
    await this.runtime.waitForEvent(waitName, type);
    this.runtime.log(`gate ${type} satisfied`);
  }

  private async phaseCtx(): Promise<{ caps: typeof DEFAULT_CAPS; consumed: BudgetConsumed; run_id: string }> {
    const runId = (this.deps as OrchestratorDeps).run_id;
    const consumed = await loadRunConsumed((this.deps as OrchestratorDeps).db, runId);
    return { caps: { ...DEFAULT_CAPS }, consumed, run_id: runId };
  }

  /** Outcome-returning plan body shared by run() (via plan()) and runPhases(). */
  private async execPlan(): Promise<PhaseOutcome> {
    if (!this.deps) throw new Error("not implemented: plan phase (no deps injected)");
    await hydrateBriefFromRun(this.deps.db, this.deps.meta, this.deps.run_id);
    const ctx = await this.phaseCtx();
    const outcome = await plan(this.deps.brief, this.deps.db, this.deps.meta, ctx);
    await persistRunConsumed(this.deps.db, this.deps.run_id, ctx.consumed);
    return outcome;
  }

  /** Outcome-returning dispatch shared by run() (via dispatch()) and runPhases(). */
  private async execPhase(phase: Exclude<WorkflowPhase, "plan" | "close">): Promise<PhaseOutcome> {
    if (!this.deps) throw new Error(`not implemented: ${phase} phase (no deps injected)`);
    await hydrateBriefFromRun(this.deps.db, this.deps.meta, this.deps.run_id);
    const ctx = await this.phaseCtx();
    const brief = this.deps.brief;
    const db = this.deps.db;
    const meta = this.deps.meta;
    let outcome: PhaseOutcome;
    switch (phase) {
      case "discover": outcome = await discover(brief, db, meta, ctx); break;
      case "investigate": outcome = await investigate(brief, db, meta, ctx); break;
      case "assess": outcome = await assess(brief, db, meta, ctx); break;
      case "rank": outcome = await rank(brief, db, meta, ctx); break;
      case "draft": outcome = await draft(brief, db, meta, ctx); break;
    }
    await persistRunConsumed(db, this.deps.run_id, ctx.consumed);
    return outcome;
  }

  /**
   * Deterministic quality snapshot for the QA loop: good (fit >= 3, live,
   * non-directory evidence), junk (directory-only evidence), candidates,
   * unlocated. Read-only — the loop in run() decides what to do with it.
   */
  private async qualitySnapshot(): Promise<RunQuality & { budgetLeft: boolean }> {
    if (!this.deps) throw new Error("quality snapshot requires injected deps");
    const { db, run_id } = this.deps;
    const prospects = await listProspects(db, run_id);
    const amap = await fetchAssessmentMap(db, prospects.map((p) => p.id));
    const evidence = await listEvidence(db, run_id);
    const q = runQuality(prospects, amap, evidence);
    const consumed = await loadRunConsumed(db, run_id);
    const budgetLeft = consumed.searches < DEFAULT_CAPS.searches
      && consumed.fetches < DEFAULT_CAPS.fetches - 4
      && consumed.candidates < DEFAULT_CAPS.candidates;
    return { ...q, budgetLeft };
  }

  /**
   * QA-loop replan: ask the model for fresh queries given the sweep's
   * quality report; write them as the next sweep's plan. Returns null when
   * the model is dry (nothing new) or no planMore client exists.
   */
  private async replan(sweep: number, qa: RunQuality): Promise<string[] | null> {
    if (!this.deps) throw new Error("replan requires injected deps");
    const { db, run_id } = this.deps;
    const planMore = this.deps.meta.planMore;
    if (!planMore) return null;
    return this.runtime.step(`replan:${sweep}`, async (): Promise<string[] | null> => {
      const row = await getRun(db, run_id);
      const plan = (row?.plan ?? {}) as { queries?: string[]; all_queries?: string[] };
      const previous = plan.all_queries ?? plan.queries ?? [];
      const whyNot = `only ${qa.good} of ${qa.candidates} candidates look good; ${qa.junk} came from directory pages; ${qa.unlocated} lack a location. Need buyer organizations that match the brief.`;
      const fresh = await planMore({ previousQueries: previous, whyNot });
      const added = (Array.isArray(fresh) ? fresh : [])
        .filter((q) => typeof q === "string" && q.trim() !== "" && !previous.includes(q))
        .slice(0, 8);
      if (added.length === 0) return null;
      await db.prepare("UPDATE research_run SET plan = ? WHERE id = ?")
        .bind(JSON.stringify({ queries: added, all_queries: [...previous, ...added] }), run_id).run();
      this.runtime.log(`replan sweep ${sweep}: +${added.length} fresh queries`);
      return added;
    }) as Promise<string[] | null>;
  }

  /** plan: model drafts a search plan (business types × locale angles, <=8 queries). */
  async plan(): Promise<RunPlan> {
    const outcome = await this.execPlan();
    if (outcome.status === "stopped") throw new Error(`plan stopped: ${outcome.stop_reason}`);
    return { queries: [] };
  }

  private async dispatch(phase: Exclude<WorkflowPhase, "plan" | "close">): Promise<void> {
    const outcome = await this.execPhase(phase);
    if (outcome.status === "stopped") throw new Error(`${phase} stopped: ${outcome.stop_reason}`);
  }

  /** close: all drafts decided -> run complete; activity log appended. */
  async close(): Promise<void> {
    if (!this.deps) throw new Error("not implemented: close phase (no deps injected)");
    const consumed: BudgetConsumed = {
      searches: 0, fetches: 0, candidates: 0, tool_rounds: 0, cost_usd_est: 0, active_compute_s: 0,
    };
    const drafts = await this.runDrafts();
    const outcome = await close(this.deps.db, { caps: { ...DEFAULT_CAPS }, consumed, run_id: this.deps.run_id }, drafts);
    if (outcome.status === "stopped") throw new Error(`close stopped: ${outcome.stop_reason}`);
  }
}
