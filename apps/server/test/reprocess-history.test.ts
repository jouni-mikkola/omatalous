/**
 * The work of a whole-history reprocess: a household of two members and about 12 000 rows (perf-household.ts) is
 * categorised again from scratch for each member. The seconds it takes are held by perf-reprocess.perf.test.ts.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { reprocessDetailed } from "../src/services/enrich.ts";
import { perfHousehold, type PerfHousehold } from "./perf-household.ts";

let w: PerfHousehold;

describe("whole-history reprocess", () => {
  beforeAll(async () => {
    w = await perfHousehold();
  }, 60_000);

  it("has the stated size", () => {
    expect(w.rows).toBeGreaterThan(11_000);
    expect(w.rows).toBeLessThan(13_500);
  });

  for (const who of ["aino", "ville"] as const) {
    it(`categorises ${who}'s whole history again and changes the rows that were reset`, async () => {
      // every row back to uncategorised, so the run does the work of a first import
      await w.db.run("UPDATE transactions SET category = 'other', category_source = 'default' WHERE user_id = ?", [w[who]]);
      const result = await reprocessDetailed(w.s.finance(w[who]), w.s.settings);
      expect(result.changed).toBeGreaterThan(1000);
    }, 60_000);
  }

  it("changes nothing the second time", async () => {
    const result = await reprocessDetailed(w.s.finance(w.aino), w.s.settings);
    expect(result.changed).toBe(0);
  });
});
