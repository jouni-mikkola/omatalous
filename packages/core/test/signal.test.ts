import { describe, expect, it } from "vitest";
import { clearlyAbove, meansApart, MIN_T, monthlyNoise, monthStandsOut } from "../src/analysis/signal.ts";

describe("a change stands out from the household's own noise", () => {
  it("a step between two months is one range, so a step inside a window does not hide itself", () => {
    // the hit of the spending growth insight: purchases 300 € higher from the seventh month of the twelve
    const then = Array.from({ length: 12 }, () => 33000);
    const now = Array.from({ length: 12 }, (_, i) => (i < 6 ? 33000 : 63000));
    expect(monthlyNoise(now, then)).toBeCloseTo(30000 / 22 / 1.128, 6);
    expect(clearlyAbove(now, then)).toBe(true);
  });

  it("a rise of a fifth on months that swing by half is noise", () => {
    const then = [31000, 58000, 40000, 62000, 35000, 47000, 29000, 55000, 44000, 33000, 61000, 38000];
    const now = [52000, 41000, 66000, 45000, 73000, 50000, 39000, 68000, 47000, 58000, 44000, 71000];
    expect(meansApart(now, then)).toBe(false);
    expect(clearlyAbove(now, then)).toBe(false);
  });

  it("one month against its usual level counts the level's own error", () => {
    // noise 100: a month 4 noises above a median of six months is under MIN_T standard errors, 5 noises above is over
    expect(monthStandsOut(MIN_T * 100, 100, 6)).toBe(false);
    expect(monthStandsOut(5 * 100, 100, 6)).toBe(true);
    // without noise any rise stands out, and no fall does
    expect(monthStandsOut(1, 0, 6)).toBe(true);
    expect(monthStandsOut(-1, 0, 6)).toBe(false);
  });
});
