import { describe, expect, it } from "vitest";
import { dayHeat } from "../src/analysis/day-heat.ts";

describe("dayHeat", () => {
  it("is 1 under half the usual day, 2 to it, 3 to one and a half times it, 4 above", () => {
    const days = [10, 40, 50, 60, 75, 80, 0].map((e, i) => ({ date: `2026-03-0${i + 1}`, cents: e * 100 }));
    const { usualCents, heat } = dayHeat(days, "2026-03-31");
    expect(usualCents).toBe(5250);
    expect(heat).toEqual([1, 2, 2, 3, 3, 4, 0]);
  });

  it("keeps a steady run plain and gives no shade before a day has ended", () => {
    expect(dayHeat([{ date: "2026-03-01", cents: 1000 }, { date: "2026-03-02", cents: 1100 }], "2026-03-31").heat).toEqual([0, 0]);
    expect(dayHeat([{ date: "2026-03-01", cents: 1000 }], "2026-03-01")).toEqual({ usualCents: null, heat: [0] });
  });
});
