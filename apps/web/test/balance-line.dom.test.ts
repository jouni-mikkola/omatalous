/**
 * The balance line of Tilit ja saldot when the accounts are known for only the end of the range: the axis starts at the
 * first known day, the running month's name stays inside the chart, and no label lies on another.
 */
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { BalanceLine } from "../src/charts/forms/BalanceLine.tsx";
import { LABEL_CHAR_W } from "../src/charts/draw.ts";
import { dayNumber, fromDayNumber } from "@banking/core";

const FROM = "2025-12-01";
const TO = "2026-11-12";
const DAYS = dayNumber(TO) - dayNumber(FROM) + 1;
const KNOWN = dayNumber("2026-09-15") - dayNumber(FROM);
const PAY = DAYS - 3;
// a balance that falls by 4 € a day and climbs by 1 000 € with the pay two days before today
const cents = Array.from({ length: DAYS }, (_, i) => (i < KNOWN ? null : 150_000 - (i - KNOWN) * 400 + (i >= PAY ? 100_000 : 0)));
const report = {
  daily: { from: FROM, cents },
  lowest: null,
  events: [],
  payDays: [fromDayNumber(dayNumber(FROM) + PAY)],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

let current = 366;
let original: PropertyDescriptor | undefined;

function draw(width: number, r = report) {
  current = width;
  const { container } = render(createElement(BalanceLine, { r }));
  return container;
}

/** The month names under the axis: the texts with no class of their own that read as a month. */
const monthsOf = (c: HTMLElement) => [...c.querySelectorAll<SVGTextElement>("svg text")].filter((el) => !el.getAttribute("class") && /^[a-zäö]+( \d{4})?$/.test(el.textContent!));

/** Whether two boxes of `boxOf` keep apart. */
const clear = (a: ReturnType<typeof boxOf>, b: ReturnType<typeof boxOf>) => a.to <= b.from || b.to <= a.from || a.bottom <= b.top || b.bottom <= a.top;

/** The box of an SVG text in the coordinates of the svg, its width by the characters as the chart counts them. */
function boxOf(el: SVGTextElement) {
  const left = Number(el.closest("svg")!.querySelector("g")!.getAttribute("transform")!.match(/translate\(([\d.]+)/)![1]);
  const w = el.textContent!.length * LABEL_CHAR_W;
  const x = left + Number(el.getAttribute("x"));
  const a = el.getAttribute("text-anchor");
  const from = a === "end" ? x - w : a === "middle" ? x - w / 2 : x;
  const y = Number(el.getAttribute("y"));
  return { from, to: from + w, top: y - 12, bottom: y, text: el.textContent! };
}

describe("BalanceLine with a balance known only lately", () => {
  // happy-dom lays nothing out: the chart measures its own width, so every element is `current` px wide here
  beforeAll(() => {
    original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => current });
  });
  afterAll(() => {
    if (original) Object.defineProperty(HTMLElement.prototype, "clientWidth", original);
    else Reflect.deleteProperty(HTMLElement.prototype, "clientWidth");
  });
  afterEach(cleanup);

  // the line of two months stood in the last sixth of a year's axis, its labels on each other
  it("starts the axis at the first day it knows: the line runs from the left edge and no month before it is named", () => {
    const c = draw(900);
    const line = c.querySelector("path.qc-line")!.getAttribute("d")!;
    expect(Number(line.match(/^M([\d.]+),/)![1])).toBe(0);
    expect(monthsOf(c).map((m) => m.textContent)).toEqual(["loka", "marras"]);
  });

  it("keeps the whole range when every day is known", () => {
    const whole = { ...report, daily: { from: FROM, cents: cents.map((v, i) => v ?? 200_000 - i) } };
    const { container } = render(createElement(BalanceLine, { r: whole }));
    expect(monthsOf(container).map((m) => m.textContent)[0]).toBe("joulu");
  });

  for (const width of [366, 900]) {
    it(`keeps every month's name inside the chart at ${width} px`, () => {
      const c = draw(width);
      const months = monthsOf(c);
      expect(months.map((m) => m.textContent)).toContain("marras");
      for (const m of months.map(boxOf)) {
        expect(m.from).toBeGreaterThanOrEqual(0);
        expect(m.to).toBeLessThanOrEqual(width);
      }
    });

    it(`lays the word of a pay day on no other label at ${width} px`, () => {
      const c = draw(width);
      const notes = [...c.querySelectorAll<SVGTextElement>("text.qc-note, text.qc-end-sub")].map(boxOf);
      const pay = notes.filter((n) => n.text === "palkka");
      const others = notes.filter((n) => n.text !== "palkka");
      for (const p of pay) for (const o of others) expect(clear(p, o), `${p.text} on ${o.text}`).toBe(true);
      // a word left out leaves its day's dot
      expect(c.querySelectorAll("circle.qc-dot-then")).toHaveLength(report.payDays.length);
    });

    it(`prints a new January's name with its year and clear of December at ${width} px`, () => {
      const r = { ...report, daily: { from: "2026-01-01", cents: Array.from({ length: 367 }, (_, i) => 100_000 + i * 10) }, payDays: [] };
      const months = monthsOf(draw(width, r)).map(boxOf);
      expect(months.at(-1)!.text).toBe("tammi 2027");
      for (let k = 1; k < months.length; k++) expect(months[k - 1]!.to <= months[k]!.from, `${months[k - 1]!.text} on ${months[k]!.text}`).toBe(true);
    });

  }

  it("names no pay day whose word would run past the chart's right edge", () => {
    for (const width of [366, 900]) {
      // the pay lifts the balance the day before today, so its word stands well below today's label
      const late = Array.from({ length: DAYS }, (_, i) => 150_000 - i * 400 + (i === DAYS - 2 ? 100_000 : 0));
      const c = draw(width, { ...report, daily: { from: FROM, cents: late }, payDays: [fromDayNumber(dayNumber(FROM) + DAYS - 2)] });
      for (const p of [...c.querySelectorAll<SVGTextElement>("text.qc-end-sub, text.qc-note")].map(boxOf).filter((n) => n.text === "palkka")) expect(p.to, `${width} px`).toBeLessThanOrEqual(width);
      cleanup();
    }
  });

  describe("with days between that are not known", () => {
    // October 1st to 30th: known 1.-5., not known 6.-10., one known day (11.), not known 12.-13., known 14.-30., and five days after it not known
    const gap = (i: number): number | null => (i <= 4 || i === 10 || (i >= 13 && i <= 29) ? 100_000 + i * 1000 : null);
    const gapped = { daily: { from: "2026-10-01", cents: Array.from({ length: 35 }, (_, i) => gap(i)) }, lowest: null, events: [], payDays: [] };
    /** The points of a path's drawing commands, in order, with the command that drew each. */
    const pointsOf = (d: string) => [...d.matchAll(/([ML])([\d.]+),([\d.]+)/g)].map((m) => ({ cmd: m[1]!, x: Number(m[2]), y: Number(m[3]) }));

    it("lifts the line over the unknown days: three pieces, each where the known days are", () => {
      const c = draw(900, gapped as never);
      const pts = pointsOf(c.querySelector("path.qc-line")!.getAttribute("d")!);
      // 30 days on the axis (the five unknown ones at the end are no part of it): the last known day is the right edge
      const step = pts.at(-1)!.x / 29;
      expect(pts.filter((p) => p.cmd === "M").map((p) => Math.round(p.x / step))).toEqual([0, 10, 13]);
      expect(pts.map((p) => Math.round(p.x / step))).toEqual([...Array.from({ length: 5 }, (_, i) => i), 10, ...Array.from({ length: 17 }, (_, i) => 13 + i)]);
      // nothing is drawn on a day with no balance
      for (const day of [5, 6, 7, 8, 9, 11, 12]) expect(pts.some((p) => Math.abs(p.x - day * step) < 0.6), `day ${day}`).toBe(false);
      // higher balance, higher on the page: the first piece climbs 1 000 € over four days
      expect(pts[0]!.y).toBeGreaterThan(pts[4]!.y);
    });

    it("fills under the known days only, not under the unknown ones", () => {
      const c = draw(900, gapped as never);
      const line = pointsOf(c.querySelector("path.qc-line")!.getAttribute("d")!);
      const step = line.at(-1)!.x / 29;
      const fill = c.querySelector("path.qc-area")!.getAttribute("d")!;
      expect(fill.match(/M/g)).toHaveLength(3);
      expect(fill.match(/Z/g)).toHaveLength(3);
      const xs = pointsOf(fill).map((p) => p.x / step);
      for (const x of xs) {
        const inGap = (x > 4.05 && x < 9.95) || (x > 10.05 && x < 12.95);
        expect(inGap, `fill at day ${x.toFixed(2)}`).toBe(false);
      }
    });

    it("marks a known day between two unknown ones with a dot of its own, and today's dot sits on the last known day", () => {
      const c = draw(900, gapped as never);
      const step = pointsOf(c.querySelector("path.qc-line")!.getAttribute("d")!).at(-1)!.x / 29;
      const lone = [...c.querySelectorAll("circle[data-lone]")];
      expect(lone).toHaveLength(1);
      expect(Number(lone[0]!.getAttribute("cx")) / step).toBeCloseTo(10, 1);
      const last = c.querySelector("circle.qc-dot:not([data-lone])")!;
      expect(Number(last.getAttribute("cx")) / step).toBeCloseTo(29, 1);
    });

    it("ends the axis on the last known day: the month after it is not named", () => {
      expect(monthsOf(draw(900, gapped as never)).map((m) => m.textContent)).toEqual(["loka"]);
    });
  });

  it("says why there is no line when one day is known", () => {
    const c = draw(366, { ...report, daily: { from: TO, cents: [120_000] }, payDays: [] });
    expect(c.querySelector("svg")).toBeNull();
    expect(c.textContent).toContain("Saldojen kehitys näkyy, kun saldo on tiedossa kahdelta päivältä.");
  });

});
