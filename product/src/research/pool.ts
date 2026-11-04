/**
 * product/src/research/pool.ts — bounded sliding window for independent
 * async work (architecture.md §12.1, Phase 0.1/0.3).
 *
 * A slot refills the moment any task finishes: there is no batch barrier,
 * so one slow site never costs the batch behind it, and one failure never
 * cancels the others (every task is isolated, Promise.allSettled-shaped).
 * Workers cap simultaneous outbound connections at 6 per invocation — keep
 * the limit at or under that.
 */

export type Settled<T> =
  | { status: "fulfilled"; value: T }
  | { status: "rejected"; reason: unknown };

export async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<Settled<R>[]> {
  const out: Settled<R>[] = new Array(items.length);
  let next = 0;
  const capped = Math.max(1, Math.min(limit, items.length));
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      const item = items[i];
      if (item === undefined) return;
      try {
        out[i] = { status: "fulfilled", value: await fn(item, i) };
      } catch (reason) {
        out[i] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: capped }, () => worker()));
  return out;
}
