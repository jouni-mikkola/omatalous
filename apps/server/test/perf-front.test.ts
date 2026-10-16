/**
 * Budget: the answers the front page asks for when it opens (App.tsx, Overview.tsx, Notices.tsx): /api/meta, the
 * running month's /api/dashboard, a past month's /api/dashboard and /api/reports, /api/recurring and the security
 * notices, on the household of perf-household.ts. Each is called cold (the analysis cache is empty after a write) and
 * warm; the budget of each is about three times the median measured.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { perfHousehold, type PerfHousehold } from "./perf-household.ts";

const BUDGET_MS = { cold: 1_000, warm: 100 };
let w: PerfHousehold;

const CALLS: [name: string, path: string][] = [
  ["meta", "/api/meta"],
  ["dashboard month", "/api/dashboard?from=2026-10-01&to=2026-10-31&scope=household"],
  ["dashboard past month", "/api/dashboard?from=2026-09-01&to=2026-09-30&scope=household"],
  ["reports past month", "/api/reports?from=2026-09-01&to=2026-09-30&scope=household&reports=spendingChange"],
  ["recurring", "/api/recurring?scope=own"],
  ["notices", "/api/security/notices"],
];

describe("front page answers budget", () => {
  beforeAll(async () => {
    w = await perfHousehold();
  }, 60_000);

  for (const scope of ["household", "own"] as const) {
    for (const [name, path] of CALLS) {
      const url = path.replace("scope=household", `scope=${scope}`);
      it(`${name} (${scope}) answers within the budget`, async () => {
        const as = w.as(w.aino);
        // a write moves the user's data version, which empties the cache the next answer is built from
        await w.s.settings.bumpUserDataVersion(w.aino);
        const t0 = performance.now();
        const cold = await as.call("GET", url);
        const coldMs = performance.now() - t0;
        const t1 = performance.now();
        const warm = await as.call("GET", url);
        const warmMs = performance.now() - t1;
        expect(cold.status).toBe(200);
        expect(warm.status).toBe(200);
        expect(coldMs).toBeLessThan(BUDGET_MS.cold);
        expect(warmMs).toBeLessThan(BUDGET_MS.warm);
      }, 30_000);
    }
  }
});
