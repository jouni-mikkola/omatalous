import { describe, expect, it } from "vitest";
import { carriesLabel, stackBars } from "../src/charts/payment-bars.ts";

describe("the bars of the days", () => {
  it("a day's payments stack in the order given, and the tallest day ends at the top tick", () => {
    const { pieces, ticks, at } = stackBars([
      { column: 2, cents: 30_000 },
      { column: 2, cents: 20_000 },
      { column: 5, cents: 10_000 },
    ]);
    const top = ticks[ticks.length - 1]!;
    expect(top).toBeGreaterThanOrEqual(50_000);
    expect(pieces[0]!.from).toBe(0);
    expect(pieces[1]!.from).toBe(pieces[0]!.to);
    expect(pieces[1]!.to).toBeCloseTo(at(50_000), 10);
    expect(pieces[2]!.from).toBe(0);
    expect(pieces[2]!.to).toBeCloseTo(at(10_000), 10);
    expect(Math.max(...pieces.map((p) => p.to))).toBeLessThanOrEqual(1);
  });

  it("a height is the sum: twice the sum is twice the height", () => {
    const { pieces } = stackBars([
      { column: 0, cents: 12_000 },
      { column: 1, cents: 24_000 },
    ]);
    expect(pieces[1]!.to).toBeCloseTo(2 * pieces[0]!.to, 10);
  });

  it("no payments leave an axis that still divides by something", () => {
    const { pieces, ticks, at } = stackBars([]);
    expect(pieces).toEqual([]);
    expect(ticks[0]).toBe(0);
    expect(Number.isFinite(at(0))).toBe(true);
  });
});

describe("the labels under the bars", () => {
  it("labels every day while they fit", () => {
    expect(Array.from({ length: 10 }, (_, k) => carriesLabel(10, k)).filter(Boolean).length).toBeGreaterThanOrEqual(8);
  });

  it("always labels the payday, the last day, and never two labels in a row on a long span", () => {
    for (const columns of [3, 12, 20, 31]) {
      expect(carriesLabel(columns, columns - 1)).toBe(true);
      const marked = Array.from({ length: columns }, (_, k) => carriesLabel(columns, k));
      if (columns > 12) for (let k = 1; k < columns; k++) expect(marked[k] && marked[k - 1]).toBe(false);
    }
  });
});
