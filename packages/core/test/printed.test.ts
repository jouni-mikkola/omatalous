import { describe, expect, it } from "vitest";
import { formatEur, printedEuros, printedParts } from "../src/index.ts";
import { rng } from "./gen.ts";

const euros = (cents: number) => Number(formatEur(cents, false).replace(/[^\d-−]/g, "").replace("−", "-"));

describe("parts printed beside their total", () => {
  it("prints a euro as formatEur does, halves away from zero", () => {
    for (const c of [0, 49, 50, 149, 150, -50, -149, -150, 123456]) expect(printedEuros(c) / 100).toBe(euros(c));
  });

  it("the critic's sets: 0,60 + 0,60 + 98,60 print 1 + 1 + 98 under 100, a rise of 398 splits into parts that print 398", () => {
    expect(printedParts([60, 60, 98_60], 99_80)).toEqual([100, 100, 98_00]);
    const [price, quantity] = printedParts([93_40, 304_60], 398_00);
    expect(price! + quantity!).toBe(398_00);
    expect([price, quantity]).toEqual([93_00, 305_00]);
  });

  it("random sets: the printed parts add up to the printed total, each within a euro of its own value, the same every time", () => {
    const next = rng(67);
    for (let round = 0; round < 2000; round++) {
      const n = 1 + Math.floor(next() * 12);
      const parts = Array.from({ length: n }, () => (next() < 0.1 ? null : Math.round((next() - 0.3) * 200_000)));
      const total = parts.reduce<number>((s, p) => s + (p ?? 0), 0);
      const printed = printedParts(parts, total);
      expect(printed.reduce<number>((s, p) => s + (p ?? 0), 0)).toBe(printedEuros(total));
      printed.forEach((p, i) => {
        if (parts[i] === null) return expect(p).toBeNull();
        expect(Math.abs(p! % 100)).toBe(0);
        expect(Math.abs(p! - parts[i]!)).toBeLessThan(100);
      });
      expect(printedParts(parts, total)).toEqual(printed);
    }
  });

  it("a group rounded into Yhteensä prints its categories to the group's printed euros", () => {
    const groups = printedParts([10_60, 10_60, 10_60], 31_80);
    expect(groups).toEqual([11_00, 11_00, 10_00]);
    const third = printedParts([5_30, 5_30], 10_60, groups[2]!);
    expect(third[0]! + third[1]!).toBe(10_00);
  });

  it("parts that miss their total are each printed on their own", () => {
    expect(printedParts([60, 60], 500)).toEqual([100, 100]);
  });
});
