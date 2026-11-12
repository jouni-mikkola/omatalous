/**
 * The balance line of Tilit ja saldot when the accounts are known for only the end of the range: the empty part says
 * from which day the balance is known, the running month's name stays inside the chart, and the word of a pay day
 * never lies on today's balance.
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

function draw(width: number) {
  current = width;
  const { container } = render(createElement(BalanceLine, { r: report }));
  return container;
}

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
      const months = [...c.querySelectorAll<SVGTextElement>("svg text")].filter((el) => !el.getAttribute("class") && /^[a-zäö]+( \d{4})?$/.test(el.textContent!));
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
      for (const p of pay) for (const o of others) expect(p.to <= o.from || o.to <= p.from || p.bottom <= o.top || o.bottom <= p.top, `${p.text} on ${o.text}`).toBe(true);
    });
  }
});
