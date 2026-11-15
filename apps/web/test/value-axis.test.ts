/**
 * The value axis of the line charts holds its lowest point, so a line that runs below zero stays inside the frame.
 */
import { describe, expect, it } from "vitest";
import { valueAxis } from "../src/charts/scale.ts";

describe("the value axis of a line chart", () => {
  it("starts from zero with the round ticks it had when nothing is below zero", () => {
    const { ticks, at } = valueAxis([0, 40_000, 123_400]);
    expect(ticks).toEqual([0, 50_000, 100_000, 150_000]);
    expect(at(0)).toBe(0);
    expect(at(150_000)).toBe(1);
  });

  it("holds the lowest point of a month that opens with money back", () => {
    // cumulative spending that starts 744,00 below zero and climbs to 429,00
    const curve = [-74_400, -70_150, -61_000, -14_700, 3_200, 42_900];
    const { ticks, at } = valueAxis(curve);
    expect(ticks).toEqual([-100_000, -50_000, 0, 50_000]);
    for (const v of curve) {
      expect(at(v), String(v)).toBeGreaterThanOrEqual(0);
      expect(at(v), String(v)).toBeLessThanOrEqual(1);
    }
    // zero is a line inside the frame, the bottom line is the lowest tick
    expect(at(0)).toBeCloseTo(2 / 3, 10);
    expect(at(-100_000)).toBe(0);
  });

  it("holds a line that is below zero all the way, with zero on the top line", () => {
    const { ticks, at } = valueAxis([-500, -300, -100]);
    expect(ticks).toEqual([-600, -400, -200, 0]);
    expect(at(-500)).toBeGreaterThan(0);
    expect(at(0)).toBe(1);
  });

  it("has an axis with no values and with zeros only", () => {
    for (const values of [[], [0, 0, 0]]) {
      const { ticks, at } = valueAxis(values);
      expect(ticks[0]).toBe(0);
      expect(ticks.length).toBeGreaterThan(1);
      expect(at(0)).toBe(0);
    }
  });

  it("keeps every point inside the frame, whatever the values", () => {
    let seed = 7;
    const next = () => (seed = (seed * 48_271) % 2_147_483_647) / 2_147_483_647;
    for (let round = 0; round < 300; round++) {
      // a tenth of the rounds is below zero only, a tenth above only, the rest on both sides
      const [low, high] = round % 10 === 0 ? [-1, 0] : round % 10 === 1 ? [0, 1] : [-next(), 1];
      const size = 10 ** Math.floor(next() * 8);
      const values = Array.from({ length: 1 + Math.floor(next() * 40) }, () => Math.round((low + next() * (high - low)) * size));
      const { ticks, at } = valueAxis(values);
      const name = `round ${round}: ${Math.min(...values)}..${Math.max(...values)}`;
      for (const v of values) {
        expect(at(v), name).toBeGreaterThanOrEqual(0);
        expect(at(v), name).toBeLessThanOrEqual(1);
      }
      expect(ticks[0], name).toBeLessThanOrEqual(Math.min(0, ...values));
      expect(ticks.some((t) => t === 0), name).toBe(true);
    }
  });
});
