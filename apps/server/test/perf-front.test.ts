/**
 * Budget: the answers the front page asks for when it opens (App.tsx, Overview.tsx, Notices.tsx): /api/meta, the
 * running month's /api/dashboard, a past month's /api/dashboard and /api/reports, /api/recurring and the security
 * notices, on the household of perf-household.ts. Each is called cold (the analysis cache is empty after a write) and
 * warm; the budget of each is about three times the median measured.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { perfHousehold, type PerfHousehold } from "./perf-household.ts";
import { bestOf, calibrate } from "../../../tools/lib/timing.ts";

// about 10x the median measured on a busy machine (PB1 notes), held against the best of two cold and three warm runs after a warm-up
// (`bestOf`): a busy machine slows a run, rarely all of them, and a slowdown by an order of magnitude fails every one
const BUDGET_MS = { cold: 3_000, warm: 300 };
// CPU time is not wait time, but a loaded box still makes the same work cost more of it (a core's sibling, a shared cache,
// a lower clock): a cold answer of 1.3 s alone took 3.1 to 3.4 s beside the other suites on a 4-core box. So the budgets
// stretch by how much slower `calibrate` (fixed work of the same kind, in this process) runs now than on an idle machine,
// the faster of a reading just before and one just after the runs (a loaded machine slows both, a stray pause one). They never shrink, and slower code costs more against the same calibration,
// so a regression of the size the budgets are for still fails. Rather than a median of more cold runs: the spread of one
// cold run is about 30 % alone and under load alike, and each costs over a second.
const CALIBRATION_IDLE_MS = 80;
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
        // cold: a write before each run moves the user's data version, which empties the cache the answer is built from
        const before = calibrate();
        const cold = await bestOf(2, () => as.call("GET", url), () => w.s.settings.bumpUserDataVersion(w.aino));
        const warm = await bestOf(3, () => as.call("GET", url));
        const slower = Math.max(1, Math.min(before, calibrate()) / CALIBRATION_IDLE_MS);
        expect(cold.result.status).toBe(200);
        expect(warm.result.status).toBe(200);
        expect(warm.result.body).toEqual(cold.result.body);
        expect(cold.ms).toBeLessThan(BUDGET_MS.cold * slower);
        expect(warm.ms).toBeLessThan(BUDGET_MS.warm * slower);
        // the test's own timeout is wall time over six calls and warm-ups: a full check stretches it to about 20 s
      }, 60_000);
    }
  }
});
