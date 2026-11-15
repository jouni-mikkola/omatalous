import { describe, expect, it } from "vitest";
import { columnX, type DotIn, labelled, nextDot, placeDots, STEPS_HEIGHT, stepLine } from "../src/charts/bill-line.ts";

type Dot = ReturnType<typeof placeDots>["dots"][number];

/** Every pair of dots keeps its distance: the middles are at least the two radii apart (the gap is the code's own). */
function overlaps(dots: Dot[]): [number, number][] {
  const found: [number, number][] = [];
  dots.forEach((a, i) => {
    dots.slice(i + 1).forEach((b, j) => {
      const apart = Math.hypot(a.x - b.x, a.y + a.size / 2 - (b.y + b.size / 2));
      if (apart < (a.size + b.size) / 2 - 0.01) found.push([i, i + 1 + j]);
    });
  });
  return found;
}

describe("the days of the line", () => {
  it("a day's dot stands on the middle of its column", () => {
    expect(columnX(1200, 12, 0)).toBe(50);
    expect(columnX(1200, 12, 11)).toBe(1150);
    expect(columnX(300, 1, 0)).toBe(150);
  });

  it("a line of no columns is read as one: no division by zero", () => {
    expect(columnX(300, 0, 0)).toBe(150);
  });
});

describe("the dots", () => {
  it("one dot is the full size on a wide line, stands on its day and inside the line", () => {
    const { dots, height } = placeDots(960, 12, [{ column: 3, cents: 91_240 }]);
    expect(dots).toHaveLength(1);
    expect(dots[0]).toMatchObject({ x: columnX(960, 12, 3), size: 38, tone: 4 });
    expect(height).toBeGreaterThanOrEqual(64);
  });

  it("the size follows the sum by its square root, from 12 to 38 pixels, and the tone follows the size", () => {
    const { dots } = placeDots(960, 12, [
      { column: 0, cents: 1_000_000 },
      { column: 2, cents: 250_000 },
      { column: 4, cents: 10_000 },
    ]);
    expect(dots.map((d) => d.size)).toEqual([38, 25, 15]);
    expect(dots.map((d) => d.tone)).toEqual([4, 2, 1]);
  });

  it("a sum no bigger than a cent, a sum of nothing and one that is huge give a dot of the bounds and never a number that is not one", () => {
    const { dots } = placeDots(960, 12, [
      { column: 0, cents: 0 },
      { column: 1, cents: 1 },
      { column: 2, cents: 10 ** 15 },
      { column: 3, cents: Number.MAX_SAFE_INTEGER },
    ]);
    for (const d of dots) {
      expect(d.size).toBeGreaterThanOrEqual(12);
      expect(d.size).toBeLessThanOrEqual(38);
      expect([d.x, d.y, d.size].every(Number.isFinite)).toBe(true);
      expect(d.x - d.size / 2).toBeGreaterThanOrEqual(0);
      expect(d.x + d.size / 2).toBeLessThanOrEqual(960);
    }
    expect(dots[3]!.size).toBe(38);
    // only zeros: no largest sum to measure by, every dot is the smallest
    expect(placeDots(960, 12, [{ column: 0, cents: 0 }]).dots[0]!.size).toBe(12);
  });

  it("the dots of the first and the last day lean in, so none leaves the line", () => {
    const { dots } = placeDots(300, 12, [
      { column: 0, cents: 90_000 },
      { column: 11, cents: 90_000 },
    ]);
    expect(dots[0]!.x - dots[0]!.size / 2).toBeGreaterThanOrEqual(0);
    expect(dots[1]!.x + dots[1]!.size / 2).toBeLessThanOrEqual(300);
  });

  it("two bills on one day stand on each other, the one set first below", () => {
    const { dots } = placeDots(960, 12, [
      { column: 4, cents: 91_240 },
      { column: 4, cents: 28_600 },
    ]);
    expect(dots[0]!.x).toBe(dots[1]!.x);
    expect(dots[1]!.y).toBeGreaterThanOrEqual(dots[0]!.y + dots[0]!.size);
    expect(overlaps(dots)).toEqual([]);
  });

  it("twenty bills on one day: no dot hides another, all stand on the day and inside the line", () => {
    const input: DotIn[] = Array.from({ length: 20 }, (_, i) => ({ column: 5, cents: 100_000 - i * 3_000 }));
    for (const width of [320, 960]) {
      const { dots, height } = placeDots(width, 12, input);
      expect(overlaps(dots), `${width} px`).toEqual([]);
      expect(dots).toHaveLength(20);
      for (const d of dots) {
        expect(d.x).toBe(columnX(width, 12, 5));
        expect(d.y + d.size).toBeLessThanOrEqual(height);
      }
      // the field has the stack in it: it grew to hold it, or the dots shrank to fit the cap
      expect(height).toBeGreaterThanOrEqual(Math.max(...dots.map((d) => d.y + d.size)));
    }
  });

  it("a stack that would pass the cap is packed again with smaller dots, to the floor, and the field stays under the cap when the floor allows", () => {
    const few = placeDots(960, 12, Array.from({ length: 3 }, () => ({ column: 5, cents: 100_000 })));
    const many = placeDots(960, 12, Array.from({ length: 9 }, () => ({ column: 5, cents: 100_000 })));
    expect(few.dots[0]!.size).toBe(38);
    expect(many.dots[0]!.size).toBeLessThan(38);
    expect(many.height).toBeLessThanOrEqual(168);
    expect(overlaps(many.dots)).toEqual([]);
    // sixty at once do not fit under the cap at any size: nothing is hidden, the field grows
    const sixty = placeDots(960, 12, Array.from({ length: 60 }, () => ({ column: 5, cents: 100_000 })));
    expect(overlaps(sixty.dots)).toEqual([]);
    expect(Math.min(...sixty.dots.map((d) => d.size))).toBeGreaterThanOrEqual(6);
    expect(sixty.height).toBeGreaterThan(168);
  });

  it("big dots on two days side by side on a narrow line do not hide each other either", () => {
    const input: DotIn[] = Array.from({ length: 12 }, (_, i) => ({ column: i, cents: 90_000 }));
    const { dots } = placeDots(300, 12, input);
    expect(overlaps(dots)).toEqual([]);
    // the dots are smaller on a narrow line than on a wide one
    expect(dots[5]!.size).toBeLessThan(placeDots(960, 12, input).dots[5]!.size);
  });

  it("a mark of its own size takes its place among the dots and tells no sum", () => {
    const { dots } = placeDots(960, 12, [
      { column: 11, cents: 50_000 },
      { column: 11, cents: 0, fixed: 20 },
    ]);
    expect(dots[1]!.size).toBe(20);
    expect(overlaps(dots)).toEqual([]);
    // alone on its day it stands on the axis
    expect(placeDots(960, 12, [{ column: 11, cents: 0, fixed: 20 }]).dots[0]!.y).toBe(5);
  });

  it("the width of 0 before the line is measured gives a line of dots that is still finite", () => {
    const { dots, height } = placeDots(0, 12, [{ column: 0, cents: 5_000 }]);
    expect([dots[0]!.x, dots[0]!.y, height].every(Number.isFinite)).toBe(true);
  });
});

describe("the labels of the days", () => {
  it("every day has one when each has 26 pixels, else every second, third or seventh counted back from the last day", () => {
    const all = labelled(312, 12);
    expect(Array.from({ length: 12 }, (_, k) => all(k))).toEqual(Array(12).fill(true));
    const half = labelled(300, 12);
    expect(Array.from({ length: 12 }, (_, k) => half(k))).toEqual(Array.from({ length: 12 }, (_, k) => (11 - k) % 2 === 0));
    // a month on a phone: every third, the last day among them
    const third = labelled(300, 31);
    expect(third(30)).toBe(true);
    expect([27, 24, 3, 0].every((k) => third(k))).toBe(true);
    expect([29, 28, 26].some((k) => third(k))).toBe(false);
    expect(labelled(120, 46)(45)).toBe(true);
  });

  it("the last day, the payday, is always labelled", () => {
    for (const [width, columns] of [[300, 12], [300, 31], [120, 46], [960, 3], [100, 1]] as const) expect(labelled(width, columns)(columns - 1)).toBe(true);
  });
});

describe("the balance in steps", () => {
  it("starts at the balance, steps down on the day of a payment by its sum and ends in the middle of the last day", () => {
    const s = stepLine(1200, 12, 341_258, [
      { column: 3, cents: 91_240 },
      { column: 3, cents: 28_600 },
      { column: 7, cents: 4_490 },
    ]);
    expect(s.path).toMatch(/^M0,[\d.]+H350V[\d.]+H750V[\d.]+H1150$/);
    expect(s.area).toBe(`${s.path}V${STEPS_HEIGHT}H0Z`);
    expect(s.at).toHaveLength(12);
    // the days before the first payment stand at the start, a day with two payments steps once
    expect(s.at[0]!.y).toBe(s.at[2]!.y);
    expect(s.at[3]!.y).toBeGreaterThan(s.at[2]!.y);
    expect(s.at[4]!.y).toBe(s.at[6]!.y);
    expect(s.at[7]!.y).toBeGreaterThan(s.at[6]!.y);
    expect(s.at[11]!.x).toBe(1150);
    // the last level is the balance less everything due, and is in the frame
    for (const p of s.at) expect(p.y).toBeGreaterThanOrEqual(0);
    for (const p of s.at) expect(p.y).toBeLessThanOrEqual(STEPS_HEIGHT);
  });

  it("the step of a larger sum is longer than one of a smaller sum", () => {
    const s = stepLine(1200, 12, 500_000, [
      { column: 2, cents: 100_000 },
      { column: 6, cents: 10_000 },
    ]);
    expect(s.at[2]!.y - s.at[1]!.y).toBeGreaterThan((s.at[6]!.y - s.at[5]!.y) * 5);
  });

  it("a balance the payments exceed goes below zero and stays in the frame", () => {
    const s = stepLine(600, 6, 20_000, [{ column: 1, cents: 150_000 }]);
    for (const p of s.at) {
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(STEPS_HEIGHT);
    }
    expect(s.at[1]!.y).toBeGreaterThan(s.at[0]!.y);
  });

  it("no payment is a flat line in the middle, and a refund (a negative sum) is no step", () => {
    const flat = stepLine(600, 6, 100_000, []);
    expect(flat.at.every((p) => p.y === STEPS_HEIGHT / 2)).toBe(true);
    expect(flat.path).toBe(`M0,${STEPS_HEIGHT / 2}H550`);
    const refund = stepLine(600, 6, 100_000, [{ column: 2, cents: -5_000 }]);
    expect(refund.path).toBe(flat.path);
  });

  it("gives the height the path starts at beside the path", () => {
    const s = stepLine(600, 6, 100_000, [{ column: 2, cents: 30_000 }]);
    expect(s.path.startsWith(`M0,${s.startY}H`)).toBe(true);
    expect(stepLine(600, 6, 100_000, []).startY).toBe(STEPS_HEIGHT / 2);
  });

  it("one day: a point in the middle of the line", () => {
    const s = stepLine(600, 1, 100_000, [{ column: 0, cents: 30_000 }]);
    expect(s.at).toHaveLength(1);
    expect(s.at[0]!.x).toBe(300);
    expect(s.path).toMatch(/^M0,[\d.]+H300V[\d.]+H300$/);
  });

  it("a huge sum keeps every number finite", () => {
    const s = stepLine(600, 6, 10 ** 12, [{ column: 1, cents: 10 ** 15 }]);
    expect(s.at.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    expect(s.path).not.toContain("NaN");
  });
});

describe("the keys between the dots", () => {
  it("the arrows go from day to day and stop at the ends, Home and End go to the ends, any other key is not for the line", () => {
    expect(nextDot("ArrowRight", 0, 4)).toBe(1);
    expect(nextDot("ArrowDown", 1, 4)).toBe(2);
    expect(nextDot("ArrowLeft", 3, 4)).toBe(2);
    expect(nextDot("ArrowUp", 2, 4)).toBe(1);
    expect(nextDot("ArrowRight", 3, 4)).toBe(3);
    expect(nextDot("ArrowLeft", 0, 4)).toBe(0);
    expect(nextDot("Home", 2, 4)).toBe(0);
    expect(nextDot("End", 0, 4)).toBe(3);
    expect(nextDot("Tab", 1, 4)).toBeNull();
    expect(nextDot("Enter", 1, 4)).toBeNull();
  });

  it("one dot is its own neighbour", () => {
    expect(nextDot("ArrowRight", 0, 1)).toBe(0);
    expect(nextDot("End", 0, 1)).toBe(0);
  });
});
