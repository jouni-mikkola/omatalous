import { describe, expect, it } from "vitest";
import { printedEuroCents, seriesMarks } from "../src/components/bills/series.tsx";
import type { Recurring } from "../src/types.ts";

const series = (...monthly: number[]) => monthly.map((monthlyCents) => ({ monthlyCents }) as Recurring);

describe("printedEuroCents", () => {
  it("rounds to the euro the page prints, halves away from zero, in both directions", () => {
    expect(printedEuroCents(1_249)).toBe(1_200);
    expect(printedEuroCents(1_250)).toBe(1_300);
    expect(printedEuroCents(-1_250)).toBe(-1_300);
    expect(printedEuroCents(0)).toBe(0);
  });
});

describe("seriesMarks", () => {
  it("draws the bracket and the tracks when the printed euros add up (money out)", () => {
    const m = seriesMarks(series(10_000, 5_000, 5_000));
    expect(m.bracket).toBe(true);
    expect(m.tracks).toEqual([{ from: 0, part: 50 }, { from: 50, part: 25 }, { from: 75, part: 25 }]);
  });
  it("draws no bracket when rounded rows miss the rounded sum by a euro (near miss)", () => {
    // 1,49 + 1,49 = 2,98 prints 1 + 1 under 3
    const m = seriesMarks(series(149, 149));
    expect(m.bracket).toBe(false);
    expect(m.tracks).not.toBeNull();
  });
  it("keeps the bracket when the rounded rows still add up", () => {
    expect(seriesMarks(series(149, 151)).bracket).toBe(true);
  });
  it("draws no bracket for one row", () => {
    expect(seriesMarks(series(10_000)).bracket).toBe(false);
  });
  it("draws no tracks when a row is a refund (money back), the bracket still adds", () => {
    const m = seriesMarks(series(10_000, -2_000));
    expect(m.tracks).toBeNull();
    expect(m.bracket).toBe(true);
  });
});
