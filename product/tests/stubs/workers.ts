/** Node-test stub for `cloudflare:workers` (only what workflow.ts touches). */
export class WorkflowEntrypoint<Env = unknown, _Params = unknown> {
  env!: Env;
  run(_event?: unknown, _step?: unknown): Promise<unknown> {
    return Promise.resolve({});
  }
}

export interface WorkflowEvent<P> {
  payload: P;
}

export interface WorkflowStep {
  do(...args: Array<unknown>): Promise<unknown>;
  waitForEvent(...args: Array<unknown>): Promise<unknown>;
}
