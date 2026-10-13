import { describe, expect, it } from "vitest";
import { eurosText, parseEuros, parseRate, rateText, roundedShares, shareText } from "../src/format.ts";

describe("the texts of amount and rate inputs", () => {
  it("writes cents and hundredths of a percent as the household types them, with plain spaces", () => {
    expect(eurosText(12_345_678)).toBe("123 456,78");
    expect(eurosText(50)).toBe("0,50");
    expect(rateText(325)).toBe("3,25");
    expect(rateText(5)).toBe("0,05");
    expect(rateText(1000)).toBe("10,00");
  });

  it("reads what it wrote, and rounds a rate to hundredths, a half up", () => {
    for (const cents of [0, 1, 99_999, 12_345_678]) expect(parseEuros(eurosText(cents))).toBe(cents);
    for (const bp of [0, 5, 325, 5000]) expect(parseRate(rateText(bp))).toBe(bp);
    expect(parseRate("3.255 %")).toBe(326);
    expect(parseRate("3,254")).toBe(325);
    expect(parseRate("3,25 %")).toBe(325);
    expect(parseRate("neljä")).toBeNull();
    expect(parseRate("")).toBeNull();
  });
});

describe("roundedShares: shares of one whole printed side by side", () => {
  const cases: [string, (number | null)[], number, number, (number | null)[]][] = [
    ["the kind of split that printed 101 %: 47,6 / 37,8 / 14,6", [4760, 3780, 1460], 10_000, 0, [48, 38, 14]],
    ["three equal thirds, the first row takes the extra unit", [1, 1, 1], 3, 0, [34, 33, 33]],
    ["three equal thirds with one decimal", [1, 1, 1], 3, 1, [334, 333, 333]],
    ["three equal thirds with two decimals", [1, 1, 1], 3, 2, [3334, 3333, 3333]],
    ["a zero among the parts stays 0", [1, 0, 2], 3, 0, [33, 0, 67]],
    ["a part that is all of it", [10_000], 10_000, 0, [100]],
    ["parts under the whole add up to the nearest unit of their true sum", [3333, 3333], 10_000, 0, [34, 33]],
    ["a part that is null or below zero stands outside and the rest add up", [5000, null, -100, 5000], 10_000, 0, [50, null, null, 50]],
    ["no whole, no share", [5, 0, null], 0, 0, [0, 0, null]],
    ["one decimal that needs no rounding stays as it is", [4760, 3780, 1460], 10_000, 1, [476, 378, 146]],
  ];
  for (const [name, parts, whole, decimals, units] of cases) {
    it(name, () => expect(roundedShares(parts, whole, decimals)).toEqual(units));
  }

  it("takes the target a caller gives, so the parts of a part add up to the share that part printed", () => {
    // 30,0 and 17,4 are 47,4 together: on their own 47 %, but a group of 47,4 that went up to 48 % has parts adding up to 48
    expect(roundedShares([300, 174], 1000, 0)).toEqual([30, 17]);
    expect(roundedShares([300, 174], 1000, 0, 48)).toEqual([30, 18]);
  });

  it("writes units as the percent text, a comma before the decimals", () => {
    expect(shareText(48)).toBe("48 %");
    expect(shareText(476, 1)).toBe("47,6 %");
    expect(shareText(5, 2)).toBe("0,05 %");
    expect(shareText(10_000, 2)).toBe("100,00 %");
  });

  it("holds for a few hundred seeded splits: the parts add up, each is within one unit, a tie goes to the earlier row", () => {
    let seed = 20_261_013;
    const next = () => {
      seed = (seed * 1_664_525 + 1_013_904_223) % 4_294_967_296;
      return seed / 4_294_967_296;
    };
    for (let k = 0; k < 400; k++) {
      const n = 2 + Math.floor(next() * 7);
      const decimals = Math.floor(next() * 3);
      const equal = next() < 0.3;
      const base = 1 + Math.floor(next() * 500_000);
      const parts = Array.from({ length: n }, () => (equal ? base : next() < 0.15 ? 0 : 1 + Math.floor(next() * 500_000)));
      const hidden = next() < 0.3 ? 1 + Math.floor(next() * 400_000) : 0;
      const sum = parts.reduce((a, b) => a + b, 0);
      const whole = sum + hidden;
      const scale = 100 * 10 ** decimals;
      const out = roundedShares(parts, whole, decimals) as number[];
      const nearest = Math.floor((2 * sum * scale + whole) / (2 * whole));
      expect(out.reduce((a, b) => a + b, 0)).toBe(hidden ? nearest : scale);
      out.forEach((u, i) => {
        const floor = Math.floor((parts[i]! * scale) / whole);
        expect([floor, floor + 1]).toContain(u);
        if (parts[i] === 0) expect(u).toBe(0);
        // the same cents print the same, but the earlier row may take the unit the later one lacks
        for (let j = i + 1; j < n; j++) if (parts[j] === parts[i]) expect(u).toBeGreaterThanOrEqual(out[j]!);
      });
      expect(roundedShares(parts, whole, decimals)).toEqual(out);
    }
  });
});
