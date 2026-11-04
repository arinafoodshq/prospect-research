// Verifies the sliding window never exceeds the limit, refills immediately, and isolates failures.
export async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try { out[i] = { status: "fulfilled", value: await fn(items[i], i) }; }
      catch (reason) { out[i] = { status: "rejected", reason }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 10 tasks; one slow (400ms) per group of 5, the rest fast (50ms). Limit 5.
const durations = [400, 50, 50, 50, 50, 400, 50, 50, 50, 50];
let inflight = 0, peak = 0;

const t0 = Date.now();
const res = await mapPool(durations, 5, async (d, i) => {
  inflight++; peak = Math.max(peak, inflight);
  await sleep(d);
  inflight--;
  if (i === 3) throw new Error("boom");
  return i;
});
const pool = Date.now() - t0;

// Barrier version for comparison
const t1 = Date.now();
for (let i = 0; i < durations.length; i += 5) {
  await Promise.allSettled(durations.slice(i, i + 5).map((d) => sleep(d)));
}
const barrier = Date.now() - t1;

console.assert(peak <= 5, "peak in flight exceeded limit: " + peak);
console.assert(res[3].status === "rejected", "failure not isolated");
console.assert(res.filter((r) => r.status === "fulfilled").length === 9, "other tasks should succeed");
console.assert(pool < barrier, `pool (${pool}ms) should beat barrier (${barrier}ms)`);
console.log(`peak=${peak} pool=${pool}ms barrier=${barrier}ms rejected=${res.filter(r=>r.status==="rejected").length}`);
console.log(pool < barrier && peak <= 5 ? "PASS" : "FAIL");
