import { describe, expect, it } from "vitest";
import { usualCents } from "../src/analysis/usual.ts";
import { median } from "../src/stats.ts";

describe("median", () => {
  it("is 0 for no values, so callers need no guard", () => {
    expect(median([])).toBe(0);
  });

  it("takes the middle value, or the mean of the middle two, without rounding", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([0.05, 0.3])).toBe(0.175);
  });

  it("leaves its input as it was", () => {
    const xs = [3, 1, 2];
    median(xs);
    expect(xs).toEqual([3, 1, 2]);
  });
});

describe("usualCents", () => {
  it("is the median in whole cents", () => {
    expect(usualCents([100000, 120000, 90000])).toBe(100000);
    expect(usualCents([100001, 100002, 100003, 100004])).toBe(100003);
    expect(usualCents([-5000, -7000, -6000, -9001, -8000, -4000])).toBe(-6500);
  });

  it("says nothing under three values, however steady they are", () => {
    expect(usualCents([])).toBeNull();
    expect(usualCents([50000])).toBeNull();
    expect(usualCents([50000, 50000])).toBeNull();
    expect(usualCents([50000, 50000, 50000])).toBe(50000);
  });

  it("is not moved by one extreme month", () => {
    expect(usualCents([200000, 210000, 205000, 2000000, 195000, 190000])).toBe(202500);
  });
});
