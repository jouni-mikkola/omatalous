/**
 * What the charts draw with: crisp 1 px lines, the dashes that tell series apart, the ticks that may be printed
 * and which labels give way to the day a last value belongs to.
 */
import { describe, expect, it } from "vitest";
import { crisp, dashOf, keyStyle, labelPrinted, labelsWithRoom, LABEL_Y, TICK, TICK_L } from "../src/charts/draw.ts";
import { barTicks, niceTicks, roundedTop, valueAxis, wholeTicks } from "../src/charts/scale.ts";

describe("a 1 px line", () => {
  it("is drawn in the middle of a pixel row", () => {
    expect(crisp(0)).toBe(0.5);
    expect(crisp(10.2)).toBe(10.5);
    expect(crisp(10.5)).toBe(11.5);
    expect(crisp(-0.2)).toBe(0.5);
  });

  it("has ticks of 4 and 8 px and a label under the long one", () => {
    expect([TICK, TICK_L, LABEL_Y]).toEqual([4, 8, 23]);
  });
});

describe("the dashes of a series", () => {
  it("are solid, 6 3, then 2 3 for every later series", () => {
    expect([0, 1, 2, 3].map(dashOf)).toEqual([undefined, "6 3", "2 3", "2 3"]);
  });

  it("are the legend key's too", () => {
    expect(keyStyle("var(--series-1)")).toEqual({ background: "var(--series-1)" });
    expect(keyStyle("red", "6 3").background).toBe("repeating-linear-gradient(90deg, red 0 6px, transparent 6px 9px)");
    expect(keyStyle("red", "2 3").background).toContain("transparent 2px 5px");
  });
});

describe("the label of a day a last value belongs to", () => {
  it("is printed, and a regular label within two days of it is not", () => {
    const drops = new Set([17]);
    expect(labelPrinted(17, false, drops)).toBe(true);
    expect(labelPrinted(15, true, drops)).toBe(false);
    expect(labelPrinted(19, true, drops)).toBe(false);
  });

  it("leaves a regular label three days away alone, and an unlabelled day unprinted", () => {
    const drops = new Set([18]);
    expect(labelPrinted(15, true, drops)).toBe(true);
    expect(labelPrinted(16, false, drops)).toBe(false);
  });

  it("prints every regular label when nothing has a last value", () => {
    expect(labelPrinted(5, true, new Set())).toBe(true);
  });
});

describe("the ticks of an axis", () => {
  it("never go beyond the axis top, and are whole cents, for a maximum of zero, a cent and a round number", () => {
    for (const top of [0, 1, 100_000]) {
      const { ticks, at } = valueAxis([top]);
      const printed = wholeTicks(ticks);
      expect(printed.length, String(top)).toBeGreaterThan(0);
      expect(printed[0]).toBe(0);
      for (const t of printed) {
        expect(Number.isInteger(t), `${top}: ${t}`).toBe(true);
        expect(at(t), `${top}: ${t}`).toBeGreaterThanOrEqual(0);
        expect(at(t), `${top}: ${t}`).toBeLessThanOrEqual(1);
      }
      // no tick stands above the highest value except by the axis's own round-up
      expect(Math.max(...printed)).toBeLessThanOrEqual(Math.max(top, 1));
    }
  });

  it("show that the axis steps by a quarter of a cent for a maximum of zero or a cent", () => {
    // the finding: the axis's own numbers are not whole cents there, so the chart prints only the whole ones
    expect(valueAxis([0]).ticks).toEqual([0, 0.25]);
    expect(wholeTicks(valueAxis([0]).ticks)).toEqual([0]);
    expect(wholeTicks(valueAxis([1]).ticks)).toEqual([0, 1]);
    expect(valueAxis([100_000]).ticks).toEqual([0, 25_000, 50_000, 75_000, 100_000]);
  });

  it("of a bar chart are the zero line alone when nothing is above zero", () => {
    expect(barTicks(0).ticks).toEqual([0]);
    expect(barTicks(-5).ticks).toEqual([0]);
    expect(barTicks(1234)).toEqual({ ticks: [0, 500, 1000, 1500], max: 1500 });
    expect(barTicks(1234).ticks).toEqual(niceTicks(1234).ticks);
  });

  it("of a bar chart holding a cent are whole", () => {
    expect(barTicks(1).ticks.every(Number.isInteger)).toBe(true);
  });
});

describe("a column's data end", () => {
  it("has a 1 px radius", () => {
    expect(roundedTop(0, 0, 10, 20)).toBe("M0,20V1Q0,0 1,0H9Q10,0 10,1V20Z");
  });
});

describe("the labels of a category axis by room in pixels", () => {
  const months = ["loka", "marras", "joulu", "tammi 2026", "helmi", "maalis", "huhti", "touko", "kesä", "heinä", "elo", "syys"];

  it("prints every label where the ticks are far apart, the last one included", () => {
    const shown = labelsWithRoom(months, 99, new Set([11]));
    expect([...shown].sort((a, b) => a - b)).toEqual(months.map((_, i) => i));
  });

  it("never lets two printed labels touch where the ticks are close", () => {
    for (const pitch of [20, 28, 40, 60]) {
      const shown = [...labelsWithRoom(months, pitch, new Set([11]))].sort((a, b) => a - b);
      expect(shown).toContain(11);
      shown.slice(1).forEach((i, k) => {
        const j = shown[k]!;
        expect((i - j) * pitch).toBeGreaterThanOrEqual((months[i]!.length + months[j]!.length) * 3.25);
      });
    }
  });
});
