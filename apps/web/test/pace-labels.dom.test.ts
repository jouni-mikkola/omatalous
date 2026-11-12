/**
 * The pace chart's labels fit the chart: on a phone the event labels stay inside the width and clear each other, and the
 * estimate at the end of a wide chart starts with the word of the key, so it does not read as the usual.
 */
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PaceChart } from "../src/charts/PaceChart.tsx";
import { LABEL_CHAR_W } from "../src/charts/draw.ts";

const DAYS = 30;
const curve = (k: number) => Array.from({ length: DAYS }, (_, i) => (i + 1) * k);
const pace = {
  month: "2026-11",
  daysInMonth: DAYS,
  current: Array.from({ length: DAYS }, (_, i) => (i < 12 ? (i + 1) * 10000 : null)),
  expected: { curve: curve(10000), low: curve(9000), high: curve(11000) },
  previous: null,
  projection: { fromDay: 12, low: Array.from({ length: 19 }, (_, i) => 120000 + i * 9000), high: Array.from({ length: 19 }, (_, i) => 120000 + i * 11000) },
  largest: { day: 11, name: "Robert's Coffee", cents: 4500 },
  payDays: [25],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

let current = 366;
let original: PropertyDescriptor | undefined;

function draw() {
  const { container } = render(createElement(PaceChart, { pace, goal: null, payday: 25, names: { current: "Tämä kuu", previous: "Viime kuu" } }));
  return container;
}

describe("PaceChart labels", () => {
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

  it("on a phone every event label lies inside the chart and the two do not overlap", () => {
    current = 366;
    const c = draw();
    const left = Number(c.querySelector("svg > g")!.getAttribute("transform")!.match(/translate\(([\d.]+)/)![1]);
    const boxes = [...c.querySelectorAll<SVGTextElement>("text.kit-event-label")].map((el) => {
      const w = el.textContent!.length * LABEL_CHAR_W;
      const x = left + Number(el.getAttribute("x"));
      const a = el.getAttribute("text-anchor");
      const from = a === "end" ? x - w : a === "middle" ? x - w / 2 : x;
      return { from, to: from + w, y: Number(el.getAttribute("y")), text: el.textContent };
    });
    expect(boxes.map((b) => b.text)).toEqual(expect.arrayContaining([expect.stringContaining("Robert's Coffee"), expect.stringContaining("Palkka 25.")]));
    for (const b of boxes) {
      expect(b.from).toBeGreaterThanOrEqual(0);
      expect(b.to).toBeLessThanOrEqual(366);
    }
    const [a, b] = boxes;
    expect(a!.y !== b!.y || a!.to <= b!.from || b!.to <= a!.from).toBe(true);
  });

  it("on a wide chart the estimate at the end starts with Arvio and the usual line keeps Tavallinen", () => {
    current = 1440;
    const ends = [...draw().querySelectorAll("text.pace-end")].map((e) => e.textContent!);
    expect(ends).toContain("Tavallinen");
    expect(ends.find((e) => e.includes("≈"))).toMatch(/^Arvio ≈ /);
  });

  for (const width of [366, 1440]) {
    it(`today's figure moves off last month's line where it runs over the dot at ${width} px`, () => {
      current = width;
      // no usual level yet: last month's line climbs past this month's just after today, as it does when its pay came early
      const prev = Array.from({ length: DAYS }, (_, i) => 2_000 + i * 15_000 + (i >= 9 ? 60_000 : 0));
      const now = Array.from({ length: DAYS }, (_, i) => (i < 12 ? 2_000 + i * 14_000 + (i >= 9 ? 30_000 : 0) : null));
      const p = { ...pace, current: now, expected: null, projection: null, previous: { curve: prev } };
      const { container } = render(createElement(PaceChart, { pace: p, goal: null, payday: null, names: { current: "Tämä kuu", previous: "Viime kuu" } }));
      const label = container.querySelector<SVGTextElement>("text.pace-now-label")!;
      const w = label.textContent!.length * LABEL_CHAR_W;
      const lx = Number(label.getAttribute("x"));
      const a = label.getAttribute("text-anchor");
      const x0 = a === "end" ? lx - w : a === "middle" ? lx - w / 2 : lx;
      const box = { x0, x1: x0 + w, y0: Number(label.getAttribute("y")) - 11, y1: Number(label.getAttribute("y")) + 2 };
      // every segment of the two lines that reaches into the label's columns passes above or below it
      for (const line of [".pace-prev", ".pace-now"]) {
        const pts = [...container.querySelector(line)!.getAttribute("d")!.matchAll(/[ML]([\d.]+),([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
        for (let i = 1; i < pts.length; i++) {
          const [[a, ya], [b, yb]] = [pts[i - 1]!, pts[i]!];
          if (b < box.x0 || a > box.x1) continue;
          const at = (px: number) => ya + ((yb - ya) * (px - a)) / (b - a);
          const [y0, y1] = [at(Math.max(a, box.x0)), at(Math.min(b, box.x1))];
          expect(Math.max(y0, y1) < box.y0 || Math.min(y0, y1) > box.y1, `${line} segment ${i} runs through the label`).toBe(true);
        }
      }
    });
  }

  it("on the month's last day today's figure stays clear of the usual level's end label", () => {
    current = 1440;
    // last month's line ends a little over this month's, so the place over the dot is taken
    const now = curve(10_000);
    const p = { ...pace, current: now, projection: null, previous: { curve: curve(10_700) } };
    const { container } = render(createElement(PaceChart, { pace: p, goal: null, payday: null, names: { current: "Tämä kuu", previous: "Viime kuu" } }));
    const box = (el: Element, dy = 0) => {
      const w = el.textContent!.length * LABEL_CHAR_W;
      const x = Number(el.getAttribute("x"));
      const a = el.getAttribute("text-anchor");
      const x0 = a === "end" ? x - w : a === "middle" ? x - w / 2 : x;
      const y = Number(el.getAttribute("y")) + dy;
      return { x0, x1: x0 + w, y0: y - 11, y1: y + 2 };
    };
    const label = box(container.querySelector("text.pace-now-label")!);
    const end = [...container.querySelectorAll("text.pace-end")].find((e) => e.textContent === "Tavallinen")!;
    // dy 0.32em of a 12 px text
    const usual = box(end, 4);
    expect(label.x1 <= usual.x0 || usual.x1 <= label.x0 || label.y1 <= usual.y0 || usual.y1 <= label.y0).toBe(true);
  });

  it("today's figure stays over its dot when nothing runs there", () => {
    current = 1440;
    const c = draw();
    const label = c.querySelector("text.pace-now-label")!;
    expect(Number(label.getAttribute("y"))).toBeLessThan(Number(c.querySelector("circle.pace-dot")!.getAttribute("cy")));
    expect(label.getAttribute("text-anchor")).toBe("middle");
  });

  it("a five-digit estimate still fits right of the plot", () => {
    current = 1440;
    const big = { ...pace, projection: { fromDay: 12, low: pace.projection.low.map((v: number) => v * 4), high: pace.projection.high.map((v: number) => v * 4) } };
    const { container } = render(createElement(PaceChart, { pace: big, goal: null, payday: 25, names: { current: "Tämä kuu", previous: "Viime kuu" } }));
    const left = Number(container.querySelector("svg > g")!.getAttribute("transform")!.match(/translate\(([\d.]+)/)![1]);
    const end = container.querySelector("text.pace-end-est")!;
    expect(left + Number(end.getAttribute("x")) + end.textContent!.length * LABEL_CHAR_W).toBeLessThanOrEqual(1440);
  });
});
