import { describe, expect, it } from "vitest";
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
