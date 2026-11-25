/**
 * The two monthly charts (MonthColumns, MonthBars) at a phone's and a desktop's width: the name of the dashed usual level
 * stands where no column or clipped sum can cover it, and the month the readout names keeps its name on the axis.
 * jsdom lays nothing out, so the boxes are the ones the chart draws: a text's x and y, and its width from LABEL_CHAR_W.
 */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import "@banking/core/late";
import { LABEL_CHAR_W } from "../src/charts/draw.ts";
import { MonthBars } from "../src/charts/MonthBars.tsx";
import { MonthColumns } from "../src/charts/forms/MonthColumns.tsx";
import "./fixed-clock.ts";

let boxWidth = 390;
const measured = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
beforeAll(() => Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => boxWidth }));
afterAll(() => {
  if (measured) Object.defineProperty(HTMLElement.prototype, "clientWidth", measured);
  else delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
});
afterEach(cleanup);

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
const overlap = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const num = (el: Element, name: string) => Number(el.getAttribute(name));
const rectBox = (el: Element): Box => ({ left: num(el, "x"), right: num(el, "x") + num(el, "width"), top: num(el, "y"), bottom: num(el, "y") + num(el, "height") });
/** A name's box: it runs from the baseline up one line of 12 px; its width is the characters' estimate, from x by its anchor. */
const textBox = (el: Element): Box => {
  const w = (el.textContent ?? "").length * LABEL_CHAR_W;
  const x = num(el, "x");
  const anchor = el.getAttribute("text-anchor");
  const left = anchor === "end" ? x - w : anchor === "start" ? x : x - w / 2;
  return { left, right: left + w, top: num(el, "y") - 12, bottom: num(el, "y") };
};
const first = (el: Element) => el.firstElementChild!;

const MONTHS = ["2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"];
const usualName = (container: Element) => container.querySelector("text.usual-label")!;
/** The name of the usual level and its dashed sample, as boxes in the plot's coordinates. */
const usualBoxes = (container: Element): Box[] => {
  const sample = container.querySelector("line.usual-sample")!;
  return [textBox(usualName(container)), { left: num(sample, "x1"), right: num(sample, "x2"), top: num(sample, "y1") - 1, bottom: num(sample, "y2") + 1 }];
};
const monthName = (container: Element, stem: string) => [...container.querySelectorAll("svg text")].find((el) => first(el)?.textContent === stem);

function columns() {
  // October is far above the others: its column is cut and its sum written over it, next to the newest columns
  const months = MONTHS.map((month, i) => {
    const total = month === "2026-10" ? 2_100_000 : 300_000 + i * 5_000;
    return { month, complete: month !== "2026-11", parts: [total], totalCents: total };
  });
  return render(
    createElement(MonthColumns, {
      months,
      series: [{ key: "spend", label: "Menot" }],
      tone: "spending",
      usual: { cents: 310_000, label: "tavallinen kuukausi 3 100 €", short: "tavallinen 3 100 €" },
      running: "2026-11",
      label: "Menot kuukausittain",
    }),
  ).container;
}

function bars() {
  const rows = MONTHS.map((month) => ({ month, incomeCents: month === "2026-10" ? 2_500_000 : 400_000, spendCents: month === "2026-10" ? 2_100_000 : 300_000, complete: month !== "2026-11" }));
  const overview = { months: rows, usualSpendCents: 310_000, usualMonths: 10 } as unknown as Parameters<typeof MonthBars>[0]["overview"];
  return render(createElement(MonthBars, { overview, today: "2026-11-11" })).container;
}

/** Points at month `i` the way the chart is pointed at: the columns' layer takes the arrow keys, each bar pair is a link. */
const CHARTS = [
  {
    name: "MonthColumns",
    draw: columns,
    marks: ".ms-month rect",
    pick: "ms-pick",
    point: (container: Element, i: number) => {
      const layer = container.querySelector("[role='group']")!;
      fireEvent.focus(layer);
      // the first arrow from no pick lands on the newest month
      for (let step = 0; step < MONTHS.length - i; step += 1) fireEvent.keyDown(layer, { key: "ArrowLeft" });
    },
  },
  {
    name: "MonthBars",
    draw: bars,
    marks: ".mb-month rect",
    pick: "mb-pick",
    point: (container: Element, i: number) => {
      fireEvent.focus(container.querySelectorAll("a.mb-link")[i]!);
    },
  },
];

describe.each(CHARTS)("$name: the usual level's name", ({ draw, marks }) => {
  it.each([390, 1440])("stands clear of every column and every clipped sum at %i px", (width) => {
    boxWidth = width;
    const container = draw();
    const columnsDrawn = [...container.querySelectorAll(marks)].map(rectBox);
    expect(columnsDrawn.length).toBeGreaterThan(10);
    const sums = [...container.querySelectorAll("text.cap-sum")].map(textBox);
    expect(sums.length).toBeGreaterThan(0);
    for (const label of usualBoxes(container)) {
      for (const column of columnsDrawn) expect(overlap(label, column)).toBe(false);
      for (const sum of sums) expect(overlap(label, sum)).toBe(false);
      // above the plot, over the clipped sums and the cut ends: nothing a column can reach
      expect(label.bottom).toBeLessThan(Math.min(...columnsDrawn.map((c) => c.top), ...sums.map((s) => s.top)));
      // inside the chart's own width: the name is not cut off at the left
      expect(label.left).toBeGreaterThan(0);
    }
    expect(usualName(container).textContent?.replace(/[  ]/g, " ")).toBe(width < 600 ? "tavallinen 3 100 €" : "tavallinen kuukausi 3 100 €");
  });
});

describe.each(CHARTS)("$name: the month the readout names", ({ draw, pick, point }) => {
  it("keeps its name on the axis in the picked weight at 390 px, beside the running month's name", () => {
    boxWidth = 390;
    const container = draw();
    expect(container.querySelector(".readout-line")!.textContent).toContain("lokakuu 2026");
    const named = monthName(container, "loka")!;
    expect(named).toBeTruthy();
    expect(named.getAttribute("class")).toBe(pick);
    const running = monthName(container, "marras")!;
    expect(running.textContent).toBe("marraskesken");
    expect(overlap(textBox(named), textBox(running))).toBe(false);
  });

  it("names a picked month on the axis in the picked weight, also one the every-second-month rule would skip", () => {
    boxWidth = 390;
    const container = draw();
    // the months print from the newest every second one, so September (the one before the last whole) is skipped unless picked
    expect(monthName(container, "syys")).toBeUndefined();
    point(container, MONTHS.indexOf("2026-09"));
    expect(container.querySelector(".readout-line")!.textContent).toContain("syyskuu 2026");
    const picked = monthName(container, "syys")!;
    expect(picked.getAttribute("class")).toBe(pick);
    expect(container.querySelectorAll(`text.${pick}`)).toHaveLength(1);
  });

  it("has the month's name at 1440 px in bold too", () => {
    boxWidth = 1440;
    const container = draw();
    expect(monthName(container, "loka")!.getAttribute("class")).toBe(pick);
    expect(monthName(container, "marras")!.getAttribute("text-anchor")).toBe("middle");
  });
});
