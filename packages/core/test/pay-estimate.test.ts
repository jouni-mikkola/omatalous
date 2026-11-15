import { describe, expect, it } from "vitest";
import { type Pay, payEstimate } from "../src/analysis/pay-estimate.ts";
import { addMonths } from "../src/dates.ts";

/** One pay a month on the 15th, `n` months from `first` (a "YYYY-MM"), amount per index in euros. */
const monthly = (first: string, n: number, euros: number | ((i: number) => number)): Pay[] =>
  Array.from({ length: n }, (_, i) => ({ date: `${addMonths(first, i)}-15`, cents: 100 * (typeof euros === "function" ? euros(i) : euros) }));

const TODAY = "2026-10-13";

describe("payEstimate", () => {
  it("calls twelve equal pays steady, with the range of one value", () => {
    expect(payEstimate(monthly("2025-09", 12, 2480), TODAY)).toEqual({ count: 12, lowCents: 248_000, highCents: 248_000, usualCents: 248_000, floorCents: 248_000, ceilCents: 248_000, kind: "steady", baseCents: 248_000 });
  });

  it("calls twelve pays with a spread of 2 % steady and one pay 3 % off varies", () => {
    expect(payEstimate(monthly("2025-09", 12, (i) => (i === 5 ? 2040 : 2000)), TODAY)?.kind).toBe("steady");
    const off = payEstimate(monthly("2025-09", 12, (i) => (i === 5 ? 2060 : 2000)), TODAY);
    expect(off).toMatchObject({ kind: "varies", lowCents: 200_000, highCents: 206_000, usualCents: 200_000 });
  });

  it("takes the 25th and 75th percentile of a commission pay, down and up to whole euros, and its base", () => {
    // twelve months of 2 000 base plus a commission of 0 to 1 400, in the order the months came
    const commission = [0, 1400, 350, 700, 0, 1050, 0, 525.5, 875, 0, 1200, 175];
    const e = payEstimate(monthly("2025-09", 12, (i) => 2000 + commission[i]!), TODAY)!;
    // sorted: 2000 x4, 2175, 2350, 2525.50, 2700, 2875, 3050, 3200, 3400; the 25th at index 2.75 is 2 000, the 75th at 8.25 is 2 918,75
    expect(e).toMatchObject({ count: 12, lowCents: 200_000, highCents: 340_000, kind: "varies", baseCents: 200_000 });
    expect(e.floorCents).toBe(200_000);
    expect(e.ceilCents).toBe(291_900);
    expect(e.usualCents).toBe(243_775);
  });

  it("rounds the floor down and the ceiling up to a whole euro", () => {
    const e = payEstimate(monthly("2026-01", 6, (i) => [1000.5, 1100.25, 1200.75, 1300.5, 1400, 1500][i]!), TODAY)!;
    // sorted cents: 100050 110025 120075 130050 140000 150000; p25 at 1.25 = 110025 + 0.25 * 10050 = 112537.5; p75 at 3.75 = 130050 + 0.75 * 9950 = 137512.5
    expect([e.floorCents, e.ceilCents]).toEqual([112_500, 137_600]);
  });

  it("names a base only from six pays and when the smallest three are within 2 %", () => {
    const six = payEstimate(monthly("2026-04", 6, (i) => [2000, 2900, 2000, 2400, 2010, 3100][i]!), TODAY)!;
    expect(six.baseCents).toBe(200_000);
    // five pays only: no base, whatever their levels
    expect(payEstimate(monthly("2026-05", 5, (i) => [2000, 2900, 2000, 2400, 2010][i]!), TODAY)).not.toHaveProperty("baseCents");
    // six pays whose smallest three are 3 % apart: no base
    expect(payEstimate(monthly("2026-04", 6, (i) => [2000, 2900, 2060, 2400, 2010, 3100][i]!), TODAY)).not.toHaveProperty("baseCents");
  });

  it("reads only the pays after a raise as evidence", () => {
    const e = payEstimate(monthly("2026-01", 9, (i) => (i < 5 ? 2000 : 2200)), TODAY)!;
    expect(e).toMatchObject({ count: 4, lowCents: 220_000, highCents: 220_000, kind: "steady" });
    // the same pays without the step stay evidence: a rise of 1 % is no step
    expect(payEstimate(monthly("2026-01", 9, (i) => (i < 5 ? 2000 : 2010)), TODAY)?.count).toBe(9);
  });

  it("gives no estimate under three pays, nor when a step leaves fewer than three", () => {
    expect(payEstimate(monthly("2026-08", 2, 2480), TODAY)).toBeNull();
    expect(payEstimate(monthly("2026-09", 1, 2480), TODAY)).toBeNull();
    expect(payEstimate([], TODAY)).toBeNull();
    expect(payEstimate(monthly("2026-01", 9, (i) => (i < 7 ? 2000 : 2200)), TODAY)).toBeNull();
    expect(payEstimate(monthly("2026-01", 3, 2480), TODAY)?.count).toBe(3);
  });

  it("keeps the newest twelve pays", () => {
    const e = payEstimate(monthly("2024-01", 20, (i) => (i < 8 ? 3000 : 2000 + (i % 2) * 10)), TODAY)!;
    expect(e).toMatchObject({ count: 12, lowCents: 200_000, highCents: 201_000 });
  });

  describe("seasons", () => {
    /** Two earlier years of 2 000 with the December pay `december` and the third year to be estimated. */
    const years = (first: number, second: number, third = 2000): Pay[] => [
      ...monthly("2023-01", 12, (i) => (i === 11 ? first : 2000)),
      ...monthly("2024-01", 12, (i) => (i === 11 ? second : 2000)),
      ...monthly("2025-01", 12, (i) => (i === 11 ? third : 2000)),
      ...monthly("2026-01", 9, 2000),
    ];

    it("moves the estimate of December by the smaller of two ratios when two earlier years had it above", () => {
      // year medians are 2 000: December paid 2 600 (1,3) and 2 400 (1,2)
      const e = payEstimate(years(2600, 2400), TODAY, "2026-12-15")!;
      expect(e).toMatchObject({ season: true, usualCents: 240_000, floorCents: 240_000, ceilCents: 240_000, lowCents: 200_000, highCents: 200_000 });
    });

    it("moves it down when two earlier years had it below", () => {
      expect(payEstimate(years(1400, 1600), TODAY, "2026-12-15")).toMatchObject({ season: true, usualCents: 160_000 });
    });

    it("sets no season on one year only, a rise of 10 % or less, or other months", () => {
      expect(payEstimate(years(2600, 2000), TODAY, "2026-12-15")).not.toHaveProperty("season");
      expect(payEstimate(years(2600, 2200), TODAY, "2026-12-15")).not.toHaveProperty("season");
      expect(payEstimate(years(2600, 2400), TODAY, "2026-11-15")).not.toHaveProperty("season");
      expect(payEstimate(years(2600, 2400), TODAY)).not.toHaveProperty("season");
    });

    it("does not set a season when one year was above and the other below", () => {
      expect(payEstimate(years(2600, 1400), TODAY, "2026-12-15")).not.toHaveProperty("season");
    });
  });
});
