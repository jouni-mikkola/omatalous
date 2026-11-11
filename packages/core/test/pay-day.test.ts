import { describe, expect, it } from "vitest";
import { nextPayDate, payDayOf } from "../src/pay-day.ts";

describe("pay day moved past month end", () => {
  it("reads a day 31 moved forward to the 1st or 2nd as day 31, rule next", () => {
    const dates = ["2025-03-31", "2025-04-30", "2025-06-02", "2025-06-30", "2025-07-31", "2025-09-01", "2025-09-30", "2025-10-31", "2025-12-01"];
    expect(payDayOf(dates)).toEqual({ day: 31, rule: "next", hits: 9, of: 9 });
  });

  it("gives the pay date of the month before when it moved into this month", () => {
    expect(nextPayDate("2025-06-01", { day: 31, rule: "next" })).toBe("2025-06-02");
  });

  it("still gives a day 1 moved back into the month before", () => {
    expect(nextPayDate("2025-10-30", { day: 1, rule: "prev" })).toBe("2025-10-31");
  });
});
