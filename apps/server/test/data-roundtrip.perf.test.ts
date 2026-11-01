/** The time of "Tuo tiedot": a household of PB1's size imported into an empty instance. It runs in the perf project (docs/DEVELOPMENT.md). */
import { describe, expect, it } from "vitest";
import { exportOf, importFile } from "./data-import-kit.ts";
import { perfHousehold } from "./perf-household.ts";
import { setupApp } from "./helpers.ts";
import { bestOf } from "../../../tools/lib/timing.ts";

// about 10x the median measured on a busy machine (PB1 notes), held against the best of two runs after a warm-up
// (`bestOf`): a busy machine slows a run, rarely all of them, and a slowdown by an order of magnitude fails every one
const IMPORT_BUDGET_MS = 10_000;

describe("a household of PB1's size", () => {
  it("imports into an empty instance under a budget", async () => {
    const w = await perfHousehold();
    const file = await exportOf(w.admin);
    expect(file.transactions.length).toBeGreaterThan(5000);
    // each run into an empty instance of its own, made outside the clock
    let empty = await setupApp();
    const fresh = async () => {
      empty = await setupApp();
      expect((await empty.member("ville", "Ville")).id).toBeTruthy();
    };
    const { ms, result: first } = await bestOf(2, () => importFile(empty.admin, file), fresh);
    expect(first.done.total.add).toBeGreaterThan(5000);
    expect(ms).toBeLessThan(IMPORT_BUDGET_MS);
  }, 180_000);
});
