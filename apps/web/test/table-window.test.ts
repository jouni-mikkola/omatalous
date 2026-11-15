import { describe, expect, it } from "vitest";
import { OVERSCAN_PX, UNIT_PX, windowSpan } from "../src/components/table/use-window.ts";

// 100 groups of 3 rows (a head and two rows): 132 px each when nothing is measured yet
const keys = Array.from({ length: 100 }, (_, i) => `g${i}`);
const weights = keys.map(() => 3);
const group = 3 * UNIT_PX;

describe("the window of a long table", () => {
  it("at the top draws the groups under the screen and its margin, and stands the rest in one spacer", () => {
    const w = windowSpan(new Map(), keys, weights, { top: 0, bottom: 800 });
    expect(w.from).toBe(0);
    expect(w.to).toBe(Math.ceil((800 + OVERSCAN_PX) / group));
    expect(w.before).toBe(0);
    expect(w.after).toBe((keys.length - w.to) * group);
  });

  it("in the middle draws a few groups and leaves the heights before and after to the spacers", () => {
    const w = windowSpan(new Map(), keys, weights, { top: 6000, bottom: 6800 });
    expect(w.to - w.from).toBeLessThan(15);
    expect(w.before + (w.to - w.from) * group + w.after).toBe(keys.length * group);
  });

  it("follows the heights it has measured, and estimates the rest from them", () => {
    const heights = new Map(keys.slice(0, 10).map((k) => [k, 200]));
    const w = windowSpan(heights, keys, weights, { top: 0, bottom: 100 });
    // 10 measured groups of 200 px for 30 rows: 66.7 px a row, so each of the other 90 groups is estimated at 200 px as well
    expect(w.before + w.after + keys.slice(w.from, w.to).reduce((n, k) => n + (heights.get(k) ?? 200), 0)).toBeCloseTo(keys.length * 200, 0);
  });

  it("keeps the groups around the one that holds the focus while they touch the screen's window, and lets a far one go", () => {
    const top = { top: 0, bottom: 800 };
    const plain = windowSpan(new Map(), keys, weights, top);
    const near = windowSpan(new Map(), keys, weights, top, { from: plain.to - 1, to: plain.to + 2 });
    expect(near.from).toBe(0);
    expect(near.to).toBe(plain.to + 2);
    // a window is one run of groups: a focused row far from the screen is not kept, or the table would draw everything between
    expect(windowSpan(new Map(), keys, weights, top, { from: 60, to: 63 })).toEqual(plain);
  });

  it("is never empty: past the end it keeps the last group, before the start the first", () => {
    const past = windowSpan(new Map(), keys, weights, { top: 99_999, bottom: 100_800 });
    expect([past.from, past.to]).toEqual([keys.length - 1, keys.length]);
    const before = windowSpan(new Map(), keys, weights, { top: -99_999, bottom: -99_000 });
    expect([before.from, before.to]).toEqual([0, 1]);
  });

  it("draws nothing of an empty table", () => {
    expect(windowSpan(new Map(), [], [], { top: 0, bottom: 800 })).toEqual({ from: 0, to: 0, before: 0, after: 0 });
  });
});
