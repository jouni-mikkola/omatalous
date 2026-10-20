/** The helpers of the marks: when the parts add up, a row's share of its block, the ruler along a column of bars. */
import { describe, expect, it } from "vitest";
import { addsUp, addsUpPrinted, barScale, shares } from "../src/marks.ts";

describe("addsUp", () => {
  it("holds for money out and money in that add up to the cent", () => {
    expect(addsUp([-120_50, -79_50], -200_00)).toBe(true);
    expect(addsUp([105_000, 9_821, 5_697], 120_518)).toBe(true);
  });
  it("counts a refund among the parts like any other", () => {
    expect(addsUp([100_00, -25_00, 40_00], 115_00)).toBe(true);
    expect(addsUp([100_00, -25_00, 40_00], 165_00)).toBe(false);
  });
  it("draws nothing for a near miss of one cent", () => {
    expect(addsUp([100_00, 50_00], 150_01)).toBe(false);
    expect(addsUp([100_00, 50_00], 149_99)).toBe(false);
  });
  it("needs two known parts; a part that is not known is no part", () => {
    expect(addsUp([150_00], 150_00)).toBe(false);
    expect(addsUp([100_00, null, 50_00], 150_00)).toBe(true);
    expect(addsUp([100_00, null], 100_00)).toBe(false);
  });
  it("refuses a sum that is not whole cents", () => {
    expect(addsUp([0.5, 0.5], 1)).toBe(false);
  });
});

describe("shares", () => {
  const accounts = [5_805_49, 8_100_00, 16_534_94, 7_117_12, 725_34];
  it("gives whole percents that add up to 100, by the largest remainder", () => {
    expect(shares(accounts, 38_282_89)).toEqual([15, 21, 43, 19, 2]);
  });
  it("shares money in as it shares money out", () => {
    expect(shares([2_000_00, 1_000_00], 3_000_00)).toEqual([67, 33]);
  });
  it("gives a part under half a percent 0 and still adds up to 100", () => {
    expect(shares([995_00, 3_00, 2_00], 1_000_00)).toEqual([100, 0, 0]);
  });
  it("leaves a part that is not known without a slice", () => {
    expect(shares([300_00, null, 100_00], 400_00)).toEqual([75, null, 25]);
  });
  it("is null with a refund among the parts (a negative part)", () => {
    expect(shares([150_00, -50_00, 100_00], 200_00)).toBeNull();
  });
  it("is null when the parts miss the total by one cent, or the total is not above zero", () => {
    expect(shares(accounts, 38_282_90)).toBeNull();
    expect(shares([0, 0], 0)).toBeNull();
  });
  it("passes a near miss: a zero part is 0 and the rest tile the track", () => {
    expect(shares([0, 100_00, 100_00], 200_00)).toEqual([0, 50, 50]);
  });
});

describe("barScale", () => {
  it("puts the ticks that are not above the longest row at their percent of it", () => {
    expect(barScale(188_389)).toEqual([
      { at: 0, label: "0" },
      { at: 26.54, label: null },
      { at: 53.08, label: null },
      { at: 79.62, label: expect.stringMatching(/^1\s500\s€$/) },
    ]);
  });
  it("is null with no longest row, and when under two ticks are left", () => {
    expect(barScale(0)).toBeNull();
    expect(barScale(-5_00)).toBeNull();
  });
});

describe("addsUpPrinted", () => {
  it("holds when the whole euros a reader adds give the whole euros printed, money out and in", () => {
    expect(addsUpPrinted([70_00, 30_00], 100_00)).toBe(true);
    expect(addsUpPrinted([-70_20, -29_90], -100_10)).toBe(true);
  });
  it("holds for rows that add up as printed and not to the cent", () => {
    // 1,49 + 1,51 is 3,00 and prints 1 + 2 under 3; 0,60 + 0,60 is 1,20 and prints 1 + 1 under 1
    expect(addsUpPrinted([149, 151], 300)).toBe(true);
    expect(addsUp([149, 151], 301)).toBe(false);
    expect(addsUpPrinted([149, 151], 301)).toBe(true);
  });
  it("does not hold for rows that add up to the cent and not as printed: three of 0,40 print 0 under 1", () => {
    expect(addsUp([40, 40, 40], 120)).toBe(true);
    expect(addsUpPrinted([40, 40, 40], 120)).toBe(false);
  });
  it("keeps the rules of addsUp: two known parts at least, a part that is not known is left out", () => {
    expect(addsUpPrinted([100_00], 100_00)).toBe(false);
    expect(addsUpPrinted([60_00, null, 40_00], 100_00)).toBe(true);
  });
});
