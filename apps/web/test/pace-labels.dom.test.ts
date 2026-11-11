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

  it("a five-digit estimate still fits right of the plot", () => {
    current = 1440;
    const big = { ...pace, projection: { fromDay: 12, low: pace.projection.low.map((v: number) => v * 4), high: pace.projection.high.map((v: number) => v * 4) } };
    const { container } = render(createElement(PaceChart, { pace: big, goal: null, payday: 25, names: { current: "Tämä kuu", previous: "Viime kuu" } }));
    const left = Number(container.querySelector("svg > g")!.getAttribute("transform")!.match(/translate\(([\d.]+)/)![1]);
    const end = container.querySelector("text.pace-end-est")!;
    expect(left + Number(end.getAttribute("x")) + end.textContent!.length * LABEL_CHAR_W).toBeLessThanOrEqual(1440);
  });
});
