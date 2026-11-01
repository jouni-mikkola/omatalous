/** The time of the money trace: 5 000 rows in a blink. It runs in the perf project (docs/DEVELOPMENT.md). */
import { describe, expect, it } from "vitest";
import { trace } from "../src/money-trace.ts";
import { bestOfSync } from "../../../tools/lib/timing.ts";
import { history } from "./money-trace-history.ts";

describe("a seeded history", () => {
  it("traces 5 000 rows in a blink", () => {
    const rows = history(9, ["u:u-aino", "u:u-ville"], 5000);
    const { ms } = bestOfSync(3, () => trace(rows, 0, rows[0]!.day));
    expect(ms).toBeLessThan(3000);
  });
});
