/** The time of a long CSV import (20 000 rows). It runs in the perf project (docs/DEVELOPMENT.md). */
import { describe, expect, it } from "vitest";
import { longCsv, seedCsv } from "./csv-seed.ts";
import { setupApp } from "./helpers.ts";
import { bestOf } from "../../../tools/lib/timing.ts";

describe("CSV rows of the test seed: the ingest", () => {
  it("a long file imports in reasonable time", async () => {
    const content = longCsv(20000);
    // each run into an instance of its own, made outside the clock; the best of two after a warm-up holds the budget
    let app = await setupApp();
    const { ms, result: r } = await bestOf(2, () => seedCsv(app.s, app.admin, { content, accountName: "Pitkä" }), async () => (app = await setupApp()));
    expect(r.body.inserted).toBe(20000);
    expect(ms).toBeLessThan(20_000);
  }, 120_000);
});
