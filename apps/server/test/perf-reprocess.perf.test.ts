/**
 * Budget: the reprocess of a whole history. A household of two members and about 12 000 rows (perf-household.ts) is
 * categorised again from scratch for each member; the budget is about three times the median measured on a quiet
 * machine, so a busy one does not fail it.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { reprocessDetailed } from "../src/services/enrich.ts";
import { perfHousehold, type PerfHousehold } from "./perf-household.ts";
import { bestOf } from "../../../tools/lib/timing.ts";

// about 10x the median measured on a busy machine (PB1 notes), held against the best of two runs after a warm-up
// (`bestOf`): a busy machine slows a run, rarely all of them, and a slowdown by an order of magnitude fails every one
const BUDGET_MS = { reprocessEach: 2_000 };
let w: PerfHousehold;

describe("whole-history reprocess budget", () => {
  beforeAll(async () => {
    w = await perfHousehold();
  }, 60_000);

  it("has the stated size", () => {
    expect(w.rows).toBeGreaterThan(11_000);
    expect(w.rows).toBeLessThan(13_500);
  });

  for (const who of ["aino", "ville"] as const) {
    it(`categorises ${who}'s whole history again within the budget`, async () => {
      // before each run every row back to uncategorised, so each run does the work of a first import
      const { ms, result } = await bestOf(
        2,
        () => reprocessDetailed(w.s.finance(w[who]), w.s.settings),
        () => w.db.run("UPDATE transactions SET category = 'other', category_source = 'default' WHERE user_id = ?", [w[who]]),
      );
      expect(result.changed).toBeGreaterThan(1000);
      expect(ms).toBeLessThan(BUDGET_MS.reprocessEach);
    }, 60_000);
  }

  it("changes nothing the second time", async () => {
    const result = await reprocessDetailed(w.s.finance(w.aino), w.s.settings);
    expect(result.changed).toBe(0);
  });
});
