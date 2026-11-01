/** The time of the behaviour counts: a household of 100 000 rows in under 100 ms. It runs in the perf project (docs/DEVELOPMENT.md). */
import { describe, expect, it } from "vitest";
import { bestOfSync, calibrate, slowerNow } from "../../../tools/lib/timing.ts";
import { createContext } from "../src/analysis/context.ts";
import { behaviourOf } from "../src/behaviour/index.ts";
import { card, checking, householdRows, TODAY } from "./behaviour-coverage-kit.ts";

describe("cost", () => {
  it("counts a household of 100 000 rows in under 100 ms", () => {
    const ctx = createContext(householdRows(), [checking, card], TODAY);
    // the CPU time of the best of five runs, each on a fresh copy of the context (the result is cached per context): the
    // budget is for the counting. A loaded machine slows a single run several times over, and still makes the best one
    // cost more, so the budget stretches as the calibration runs slower than idle (tools/lib/timing.ts)
    let copy = { ...ctx };
    const before = calibrate();
    const { ms } = bestOfSync(5, () => behaviourOf(copy), () => void (copy = { ...ctx }));
    expect(ms).toBeLessThan(100 * slowerNow(before));
  }, 60_000);
});
