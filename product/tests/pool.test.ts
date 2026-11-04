import { describe, expect, it } from "vitest";
import { mapPool } from "../src/research/pool";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Mirrors pool.test.mjs (architecture.md §12.1): limit respected, slots
 *  refill immediately, failures isolate, and the window beats a barrier. */
describe("mapPool (sliding window)", () => {
  it("never exceeds the limit and isolates failures", async () => {
    const durations = [400, 50, 50, 50, 50, 400, 50, 50, 50, 50];
    let inflight = 0;
    let peak = 0;
    const res = await mapPool(durations, 5, async (d, i) => {
      inflight++;
      peak = Math.max(peak, inflight);
      await sleep(d);
      inflight--;
      if (i === 3) throw new Error("boom");
      return i;
    });
    expect(peak).toBeLessThanOrEqual(5);
    expect(res[3]?.status).toBe("rejected");
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(9);
    expect((res[3] as { reason: Error }).reason.message).toBe("boom");
  });

  it("refills slots instead of waiting for batch barriers", async () => {
    // 10 tasks: one 300ms straggler per batch of 5, the rest 30ms.
    const durations = [300, 30, 30, 30, 30, 300, 30, 30, 30, 30];
    const t0 = Date.now();
    await mapPool(durations, 5, (d) => sleep(d));
    const pooled = Date.now() - t0;
    const t1 = Date.now();
    for (let i = 0; i < durations.length; i += 5) {
      await Promise.allSettled(durations.slice(i, i + 5).map((d) => sleep(d)));
    }
    const barrier = Date.now() - t1;
    expect(pooled).toBeLessThan(barrier);
  });

  it("runs every item exactly once", async () => {
    const seen: number[] = [];
    const res = await mapPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      seen.push(n);
      return n * 2;
    });
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(res.map((r) => (r.status === "fulfilled" ? r.value : -1))).toEqual([2, 4, 6, 8, 10, 12, 14]);
  });

  it("handles an empty list and a limit larger than the list", async () => {
    expect(await mapPool([], 4, async (n) => n)).toEqual([]);
    const res = await mapPool([1, 2], 8, async (n) => n);
    expect(res.map((r) => (r.status === "fulfilled" ? r.value : -1))).toEqual([1, 2]);
  });
});
