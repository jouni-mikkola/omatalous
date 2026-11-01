/**
 * The work behind the front page answers (App.tsx, Overview.tsx, Notices.tsx) on the household of perf-household.ts:
 * each answers 200, and the answer from a warm analysis cache equals the one built cold. The seconds they take are held
 * by perf-front.perf.test.ts.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { settlementsOf } from "../src/services/settlement.ts";
import { perfHousehold, type PerfHousehold } from "./perf-household.ts";

let w: PerfHousehold;

const CALLS: [name: string, path: string][] = [
  ["meta", "/api/meta"],
  ["dashboard month", "/api/dashboard?from=2026-10-01&to=2026-10-31&scope=household"],
  ["dashboard past month", "/api/dashboard?from=2026-09-01&to=2026-09-30&scope=household"],
  ["reports past month", "/api/reports?from=2026-09-01&to=2026-09-30&scope=household&reports=spendingChange"],
  ["recurring", "/api/recurring?scope=own"],
  ["notices", "/api/security/notices"],
];

describe("front page answers", () => {
  beforeAll(async () => {
    w = await perfHousehold();
    await settlementsOf(w.s, w.aino, "2026-10");
  }, 120_000);

  for (const scope of ["household", "own"] as const) {
    for (const [name, path] of CALLS) {
      const url = path.replace("scope=household", `scope=${scope}`);
      it(`${name} (${scope}) answers the same cold and warm`, async () => {
        const as = w.as(w.aino);
        // a write moves the user's data version, which empties the cache the answer is built from
        await w.s.settings.bumpUserDataVersion(w.aino);
        const cold = await as.call("GET", url);
        const warm = await as.call("GET", url);
        expect(cold.status).toBe(200);
        expect(warm.status).toBe(200);
        expect(warm.body).toEqual(cold.body);
      }, 60_000);
    }
  }
});
