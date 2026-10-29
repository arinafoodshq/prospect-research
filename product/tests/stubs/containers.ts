/** Node-test stub for `@cloudflare/containers` (index.ts re-exports the DO class). */
export class Container {
  constructor(..._args: Array<unknown>) {
    // unreachable in unit tests
  }
}

export function getContainer(): never {
  throw new Error("@cloudflare/containers stub: containers are unavailable in unit tests");
}
