/**
 * product/src/workflow.ts — production Workflow entrypoint (thin).
 * Only this file (and index.ts's re-export) may import `cloudflare:workers`.
 * Orchestration lives in orchestrator.ts; this file maps the real WorkflowStep
 * onto WorkflowRuntime and builds deps from bindings + D1.
 */
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { getRun, type Db, type ResearchRun } from "./db";
import { createMetaClient } from "./meta";
import {
  ResearchWorkflow,
  STEP_RETRIES,
  type GateName,
  type WorkflowRuntime,
} from "./orchestrator";

export interface WorkflowEnv {
  DB: D1Database;
  MODEL_API_KEY: string;
  MODEL_ID?: string;
}

export interface ResearchWorkflowParams {
  run_id: string;
}

export class ResearchWorkflowEntrypoint extends WorkflowEntrypoint<WorkflowEnv, ResearchWorkflowParams> {
  override async run(event: WorkflowEvent<ResearchWorkflowParams>, step: WorkflowStep): Promise<unknown> {
    const runId = event.payload.run_id;
    const db = this.env.DB as unknown as Db;
    // Step results cross a serialization boundary: JSON round-trip keeps the
    // callback return Serializable (D1 rows carry unknown-typed columns).
    const run = (await step.do("load-run", STEP_RETRIES, async (): Promise<any> =>
      JSON.parse(JSON.stringify(await getRun(db, runId)) ?? "null"),
    )) as ResearchRun | null;
    if (!run) throw new Error(`run ${runId} does not exist`);
    const profile = (await step.do("load-profile", STEP_RETRIES, async (): Promise<any> =>
      JSON.parse(JSON.stringify(await db.prepare("SELECT * FROM business_profile WHERE id = ?")
        .bind(run.profile_id).first<Record<string, unknown>>()) ?? "null"),
    )) as Record<string, unknown> | null;
    const runtime: WorkflowRuntime = {
      step: (name, fn) => step.do(name, STEP_RETRIES, fn as () => Promise<any>) as Promise<unknown>,
      waitForEvent: (waitName: string, type: GateName) => step.waitForEvent(waitName, { type }) as Promise<unknown>,
      log: (message: string) => console.log(`[research-workflow ${runId}] ${message}`),
    };
    const meta = createMetaClient({
      apiKey: this.env.MODEL_API_KEY,
      ...(this.env.MODEL_ID !== undefined ? { modelId: this.env.MODEL_ID } : {}),
      briefExcerpt: typeof profile?.["description"] === "string" ? (profile["description"] as string) : "",
    });
    const wf = new ResearchWorkflow(runtime, {
      db,
      meta,
      brief: {
        id: run.profile_id,
        status: profile?.["status"] === "confirmed" ? "confirmed" : "draft",
        excerpt: typeof profile?.["description"] === "string" ? (profile["description"] as string) : "",
      },
      run_id: runId,
    });
    await wf.run();
    return { ok: true, run_id: runId };
  }
}
