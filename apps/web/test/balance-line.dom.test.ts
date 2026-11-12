/**
 * The balance line of Tilit ja saldot when the accounts are known for only the end of the range: the empty part says
 * from which day the balance is known, the running month's name stays inside the chart, and no label lies on another.
 */
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { BalanceLine } from "../src/charts/forms/BalanceLine.tsx";
import { LABEL_CHAR_W } from "../src/charts/draw.ts";
import { dayNumber, isoDay } from "../src/charts/kit/scale.ts";

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
  payDays: [isoDay(dayNumber(FROM) + PAY)],
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

  it("names the first day it knows in the empty part before the line", () => {
    const c = draw(900);
    const note = c.querySelector<SVGTextElement>("text.bl-known-from");
    expect(note?.textContent).toBe("Saldo tiedossa 15.9. alkaen");
    const line = c.querySelector("path.qc-line")!.getAttribute("d")!;
    const lineStart = Number(line.match(/^M([\d.]+),/)![1]);
    expect(Number(note!.getAttribute("x")) + (note!.textContent!.length * LABEL_CHAR_W) / 2).toBeLessThan(lineStart);
  });

  it("says nothing of the kind when every day is known", () => {
    const whole = { ...report, daily: { from: FROM, cents: cents.map((v, i) => v ?? 200_000 - i) } };
    const { container } = render(createElement(BalanceLine, { r: whole }));
    expect(container.querySelector("text.bl-known-from")).toBeNull();
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

    it(`keeps the first known day's note off the lowest day's label at ${width} px`, () => {
      const known = 267;
      const cents = Array.from({ length: 367 }, (_, i) => (i < known ? null : 110_000 + (i - known) * 500));
      const r = { ...report, daily: { from: "2025-11-12", cents }, lowest: { day: isoDay(dayNumber("2025-11-12") + known), cents: 110_000 }, payDays: [] };
      const c = draw(width, r);
      const notes = [...c.querySelectorAll<SVGTextElement>("text.qc-note, text.bl-known-from")].map(boxOf);
      for (const a of notes) for (const b of notes) if (a !== b) expect(clear(a, b), `${a.text} on ${b.text}`).toBe(true);
    });
  }

  it("says why there is no line when one day is known", () => {
    const c = draw(366, { ...report, daily: { from: TO, cents: [120_000] }, payDays: [] });
    expect(c.querySelector("svg")).toBeNull();
    expect(c.textContent).toContain("Saldojen kehitys näkyy, kun saldo on tiedossa kahdelta päivältä.");
  });

  it("names the year of a first known day in the year before the last", () => {
    const from = "2025-06-01";
    const cents = Array.from({ length: dayNumber(TO) - dayNumber(from) + 1 }, (_, i) => (i < 200 ? null : 100_000));
    const note = draw(900, { ...report, daily: { from, cents }, payDays: [] }).querySelector("text.bl-known-from");
    expect(note?.textContent).toBe("Saldo tiedossa 18.12.2025 alkaen");
  });
});
