/**
 * Raportit: the months chart (MonthColumns). One column a month stacked by series, the usual level a dashed line, a month
 * that is not whole drawn apart and named in its readout. A month's total is the report's, never added up here.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import "@banking/core/late";
import { MonthColumns } from "../src/charts/forms/MonthColumns.tsx";
import { ChartWithTable } from "../src/components/table/selection.tsx";
import { Table } from "../src/components/table/Table.tsx";
import "./fixed-clock.ts";

afterEach(cleanup);

const MONTHS = [
  { month: "2026-08", complete: true, parts: [300000, 20000], totalCents: 320000, against: { cents: 20000, side: "more" as const } },
  { month: "2026-09", complete: false, parts: [150000, 0], totalCents: 150000 },
  { month: "2026-10", complete: true, parts: [310000, 0], totalCents: 310000 },
];
const SERIES = [
  { key: "earned", label: "Ansiotulot" },
  { key: "other", label: "Muut tulot" },
];

const props = (more: Partial<Parameters<typeof MonthColumns>[0]> = {}): Parameters<typeof MonthColumns>[0] => ({
  months: MONTHS,
  series: SERIES,
  tone: "income",
  usual: { cents: 300000, label: "keskimäärin 3 000 €", short: "keskimäärin 3 000 €" },
  running: "2026-10",
  label: "Tulot kuukausittain",
  ...more,
});
const show = (more: Partial<Parameters<typeof MonthColumns>[0]> = {}) => render(createElement(MonthColumns, props(more)));
const num = (el: Element | null, name: string) => Number(el!.getAttribute(name));
const plain = (s: string | null) => (s ?? "").replace(/[\s  ]+/g, " ");

describe("Raportit: the months chart", () => {
  it("draws a column part for every sum above zero and names the chart", () => {
    const { container } = show();
    expect(screen.getByRole("img", { name: "Tulot kuukausittain" })).toBeTruthy();
    expect(container.querySelectorAll("rect.ms-s0")).toHaveLength(3);
    expect(container.querySelectorAll("rect.ms-s1")).toHaveLength(1);
  });

  it("has no legend list: the readout line names the stack's series, and the usual level is named on its line", () => {
    const { container } = show();
    expect(container.querySelector(".ms-legend")).toBeNull();
    const readout = plain(container.querySelector(".readout-line")!.textContent);
    expect(readout).toContain("Ansiotulot");
    expect(readout).toContain("Muut tulot");
    expect(container.querySelectorAll("line.ms-usual")).toHaveLength(1);
    expect(plain(container.querySelector("text.usual-label")!.textContent)).toBe("keskimäärin 3 000 €");
  });

  it("names the last whole month in the readout while nothing is picked, and sets it against the average", () => {
    const { container } = show();
    const readout = plain(container.querySelector(".readout-line")!.textContent);
    // September is not whole and October is running, so August is the month named
    expect(readout).toContain("elokuu 2026");
    expect(readout).toContain("Yhteensä 3 200 €");
    expect(readout).toContain("tulot 200 € yli keskiarvon");
  });

  it("names the resting month in the readout while nothing is pointed at, and the last whole one when it is not a month of the chart", () => {
    const named = (resting: string | null) => {
      const { container, unmount } = show({ resting });
      const readout = plain(container.querySelector(".readout-line")!.textContent);
      unmount();
      return readout;
    };
    expect(named("2026-09")).toContain("syyskuu 2026");
    expect(named("2027-01")).toContain("elokuu 2026");
    expect(named(null)).toContain("elokuu 2026");
  });

  it("puts the comparison in the live readout of a picked month, and says none for a month the report gives none for", () => {
    const { container } = show();
    const layer = container.querySelector("[role='group']")!;
    fireEvent.focus(layer);
    // from no pick the first arrow lands on the newest month (running October), the next on September
    fireEvent.keyDown(layer, { key: "ArrowLeft" });
    expect(container.querySelector("[aria-live]")!.textContent).not.toContain("keskiarvon");
    fireEvent.keyDown(layer, { key: "ArrowLeft" });
    fireEvent.keyDown(layer, { key: "ArrowLeft" });
    expect(plain(container.querySelector("[aria-live]")!.textContent)).toContain("tulot 200 € yli keskiarvon");
  });

  it("draws no usual line or label with no usual level", () => {
    const { container } = show({ series: [SERIES[0]!], months: MONTHS.map((m) => ({ ...m, parts: [m.parts[0]!], totalCents: m.parts[0]!, against: null })), usual: null });
    expect(container.querySelector("line.ms-usual")).toBeNull();
    expect(container.querySelector("text.usual-label")).toBeNull();
    expect(plain(container.querySelector(".readout-line")!.textContent)).not.toContain("keskiarvon");
  });

  it("labels the running month with kesken under its name", () => {
    const { container } = show();
    const running = [...container.querySelectorAll("svg text")].find((el) => el.textContent?.startsWith("loka"));
    expect(plain(running!.textContent)).toBe("lokakesken");
  });

  it("draws a month that is not whole apart", () => {
    const { container } = show();
    expect(container.querySelectorAll("g.ms-partial")).toHaveLength(2);
    expect(container.querySelectorAll("g.ms-month")).toHaveLength(3);
  });

  it("reads the newest month out on focus, with its sums and that it is not whole", () => {
    const { container } = show();
    expect(container.querySelector(".pick-band")).toBeNull();
    fireEvent.focus(screen.getByRole("group", { name: "Tulot kuukausittain" }));
    const readout = container.querySelector(".readout-line")!;
    expect(readout.textContent).toContain("lokakuu 2026");
    expect(readout.textContent).toContain("Ansiotulot");
    expect(readout.textContent).toContain("kesken");
    expect(container.querySelectorAll(".pick-band")).toHaveLength(1);
    expect(container.querySelector(".tooltip")).toBeNull();
  });

  it("puts the usual line at the height of a column that holds the usual sum", () => {
    const { container } = show({ months: [{ month: "2026-08", complete: true, parts: [300000], totalCents: 300000 }, ...MONTHS.slice(1)] });
    const first = container.querySelector("g.ms-month rect.ms-s0")!;
    // the line is drawn on the half pixel of its row, the column on the whole one
    expect(Math.abs(num(container.querySelector("line.ms-usual"), "y1") - num(first, "y"))).toBeLessThanOrEqual(1);
    // a larger month stands higher than the line, a smaller one lower
    const tops = [...container.querySelectorAll("g.ms-month")].map((g) => num(g.querySelector("rect.ms-s0"), "y"));
    const line = num(container.querySelector("line.ms-usual"), "y1");
    expect(tops[2]!).toBeLessThan(line);
    expect(tops[1]!).toBeGreaterThan(line);
  });

  it("cuts a month far above the others 6 px past the top, with a break, and writes its sum above it", () => {
    const sums = [120000, 130000, 110000, 125000, 2045000].map((cents, i) => ({ month: `2026-0${i + 1}`, complete: true, parts: [cents], totalCents: cents }));
    const { container } = show({ months: sums, series: [SERIES[0]!], usual: null, running: null });
    const columns = [...container.querySelectorAll("g.ms-month rect.ms-s0")];
    expect(num(columns[4]!, "y")).toBe(-6);
    expect(num(columns[3]!, "y")).toBeGreaterThan(0);
    expect(container.querySelectorAll("path.cap-break")).toHaveLength(1);
    expect(plain(container.querySelector("text.cap-sum")!.textContent)).toBe("20 450 €");
  });

  it("reads the true sum of a cut month in its readout", () => {
    const sums = [120000, 130000, 110000, 125000, 2045000].map((cents, i) => ({ month: `2026-0${i + 1}`, complete: true, parts: [cents], totalCents: cents }));
    show({ months: sums, series: [SERIES[0]!], usual: null, running: null });
    fireEvent.focus(screen.getByRole("group", { name: "Tulot kuukausittain" }));
    expect(plain(document.querySelector(".readout-line")!.textContent)).toContain("20 450 €");
  });

  it("cuts nothing in a view of three months, whatever the usual level", () => {
    const sums = [200000, 200000, 900000].map((cents, i) => ({ month: `2026-0${i + 1}`, complete: true, parts: [cents], totalCents: cents }));
    const { container } = show({ months: sums, series: [SERIES[0]!], usual: { cents: 200000, label: "tavallinen kuukausi 2 000 €", short: "tavallinen 2 000 €" }, running: null });
    expect(container.querySelector("path.cap-break")).toBeNull();
    expect(container.querySelector("text.cap-sum")).toBeNull();
    expect(num(container.querySelectorAll("g.ms-month rect.ms-s0")[2]!, "y")).toBeGreaterThanOrEqual(0);
  });

  it("draws no break at a clipped sum whose column still ends inside the plot", () => {
    // the cap is 1 800 € and the axis rounds up to 2 000 €, so 1 900 € is under the top
    const cents = [...Array(10).fill(90000), 180000, 190000];
    const sums = cents.map((c, i) => ({ month: `2026-${String(i + 1).padStart(2, "0")}`, complete: true, parts: [c], totalCents: c }));
    const { container } = show({ months: sums, series: [SERIES[0]!], usual: { cents: 100000, label: "tavallinen kuukausi 1 000 €", short: "tavallinen 1 000 €" }, running: null });
    expect(container.querySelector("path.cap-break")).toBeNull();
    expect(container.querySelector("text.cap-sum")).toBeNull();
    expect(num(container.querySelectorAll("g.ms-month rect.ms-s0")[11]!, "y")).toBeGreaterThan(0);
  });

  it("writes the sum of a month cut at the bottom inside the plot, above its break, clear of the month names", () => {
    const sums = [-900000, 100000, 110000, 120000, 130000].map((cents, i) => ({ month: `2026-0${i + 1}`, complete: true, parts: [cents], totalCents: cents }));
    const { container } = show({ months: sums, series: [SERIES[0]!], usual: null, running: null });
    const column = container.querySelector("g.ms-month rect.ms-s0")!;
    const bottom = num(column, "y") + num(column, "height");
    expect(container.querySelectorAll("path.cap-break")).toHaveLength(1);
    const sum = container.querySelector("text.cap-sum")!;
    expect(plain(sum.textContent)).toMatch(/[−-]9 000 €/);
    expect(num(sum, "y")).toBeLessThan(bottom - 6);
  });

  it("draws no break when no month stands out", () => {
    const { container } = show();
    expect(container.querySelector("path.cap-break")).toBeNull();
    expect(container.querySelector("text.cap-sum")).toBeNull();
  });

  it("stacks the series from the bottom in their order", () => {
    const { container } = show();
    const month = container.querySelector("g.ms-month")!;
    const first = month.querySelector("rect.ms-s0")!;
    const second = month.querySelector("rect.ms-s1")!;
    expect(num(first, "y") + num(first, "height")).toBeGreaterThan(num(second, "y") + num(second, "height") - 0.01);
    // the second part sits right on top of the first
    expect(num(second, "y") + num(second, "height")).toBeCloseTo(num(first, "y"), 5);
    expect(num(first, "height")).toBeGreaterThan(num(second, "height"));
  });

  it("draws a negative month below zero, down from the line the positive ones stand on", () => {
    const { container } = show({
      months: [{ month: "2026-08", complete: true, parts: [200000], totalCents: 200000 }, { month: "2026-09", complete: true, parts: [-50000], totalCents: -50000 }],
      series: [SERIES[0]!],
      usual: null,
    });
    const [up, down] = [...container.querySelectorAll("g.ms-month rect.ms-s0")];
    expect(container.querySelectorAll("rect.ms-s0")).toHaveLength(2);
    const zero = num(up!, "y") + num(up!, "height");
    expect(num(down!, "y")).toBeCloseTo(zero, 5);
    expect(num(down!, "height")).toBeGreaterThan(0);
  });

  it("reads a month's total from the report, not from the sum of its parts", () => {
    show({ months: [{ month: "2026-10", complete: true, parts: [100000, 20000], totalCents: 123400 }], usual: null });
    fireEvent.focus(screen.getByRole("group", { name: "Tulot kuukausittain" }));
    const tip = document.querySelector(".readout-line")!;
    expect(plain(tip.textContent)).toContain("1 234 €");
    expect(plain(tip.textContent)).not.toContain("1 200 €");
  });

  it("reads a negative month in its readout", () => {
    show({ months: [{ month: "2026-10", complete: true, parts: [-50000], totalCents: -50000 }], series: [SERIES[0]!], usual: null });
    fireEvent.focus(screen.getByRole("group", { name: "Tulot kuukausittain" }));
    expect(plain(document.querySelector(".readout-line")!.textContent)).toMatch(/[−-]500 €/);
  });
});

describe("Raportit: the months chart and the table under it", () => {
  const rows = MONTHS.map((m) => ({ month: m.month }));
  const withTable = () =>
    render(
      createElement(ChartWithTable, {
        chart: createElement(MonthColumns, props()),
        table: createElement(Table<(typeof rows)[number]>, { caption: "Kuukaudet", rows, rowKey: (r) => r.month, columns: [{ key: "month", label: "Kuukausi", kind: "text", rowHead: true, cell: (r) => r.month }], search: false, toolbar: false, csv: false }),
      }),
    );
  const bodyRows = () => within(screen.getByRole("table", { name: "Kuukaudet", hidden: true })).getAllByRole("row", { hidden: true }).slice(1);

  it("an arrow key steps to another month and Enter keeps that month's row alone", () => {
    withTable();
    expect(bodyRows()).toHaveLength(3);
    expect(document.querySelector<HTMLDetailsElement>("details.chart-fold")!.open).toBe(false);
    const chart = screen.getByRole("group", { name: /Tulot kuukausittain/ });
    fireEvent.focus(chart);
    fireEvent.keyDown(chart, { key: "ArrowLeft" });
    fireEvent.keyDown(chart, { key: "Enter" });
    const kept = bodyRows();
    expect(kept).toHaveLength(1);
    expect(kept[0]!.textContent).toContain("2026-09");
    // the pick opened the fold the table stands in
    expect(document.querySelector<HTMLDetailsElement>("details.chart-fold")!.open).toBe(true);
    // the kept row is a chip with its name and a way back, and no sentence
    const chip = document.querySelector(".rt-filter .chip")!;
    expect(chip.textContent).toContain("2026-09");
    expect(chip.textContent).not.toContain("Näytämme");
    expect(within(chip as HTMLElement).getByRole("button", { name: "Näytä kaikki rivit" })).toBeTruthy();
  });

  it("draws no total beside a picked row, as the total sums every row, and draws it again when all rows are back", () => {
    render(
      createElement(ChartWithTable, {
        chart: createElement(MonthColumns, props()),
        table: createElement(Table<(typeof rows)[number]>, {
          caption: "Kuukaudet",
          rows,
          rowKey: (r) => r.month,
          columns: [
            { key: "month", label: "Kuukausi", kind: "text", rowHead: true, cell: (r) => r.month },
            { key: "sum", label: "Summa", kind: "money", cents: () => 100 },
          ],
          total: { label: "Yhteensä", cells: { sum: "3,00 €" } },
          search: false,
          toolbar: false,
          csv: false,
        }),
      }),
    );
    const table = screen.getByRole("table", { name: "Kuukaudet", hidden: true });
    expect(within(table).getByText("3,00 €")).toBeTruthy();
    const chart = screen.getByRole("group", { name: /Tulot kuukausittain/ });
    fireEvent.focus(chart);
    fireEvent.keyDown(chart, { key: "Enter" });
    expect(within(table).queryByText("3,00 €")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Näytä kaikki rivit" }));
    expect(within(table).getByText("3,00 €")).toBeTruthy();
  });

  it("Enter on the same month again shows every row again", () => {
    withTable();
    const chart = screen.getByRole("group", { name: /Tulot kuukausittain/ });
    fireEvent.focus(chart);
    fireEvent.keyDown(chart, { key: "Enter" });
    expect(bodyRows()).toHaveLength(1);
    expect(bodyRows()[0]!.textContent).toContain("2026-10");
    fireEvent.keyDown(chart, { key: "Enter" });
    expect(bodyRows()).toHaveLength(3);
  });
});

describe("Laskut: the months chart with paid and coming parts", () => {
  const BILLS = [
    { month: "2026-10", complete: true, paid: [200000, 30000], parts: [50000, 40000], totalCents: 320000 },
    { month: "2026-11", complete: true, paid: [0, 0], parts: [250000, 0], totalCents: 250000 },
  ];
  const kinds = (more: Partial<Parameters<typeof MonthColumns>[0]> = {}) =>
    render(createElement(MonthColumns, props({ months: BILLS, tone: "spending", usual: { cents: 260000, label: "Tavallinen 2 600 €", short: "Tavallinen 2 600 €" }, running: "2026-10", today: "2026-10-16", states: { paid: "Maksettu", coming: "Tulossa" }, ...more })));

  it("draws the paid parts filled and the parts to come hatched with a dashed edge, in the colour of their series", () => {
    const { container } = kinds();
    const month = container.querySelectorAll("g.ms-month")[0]!;
    const filled = [...month.querySelectorAll("rect:not(.ms-coming)")];
    const coming = [...month.querySelectorAll("rect.ms-coming")];
    expect(filled.map((r) => r.getAttribute("class"))).toEqual(["ms-s0", "ms-s1"]);
    expect(coming.map((r) => r.getAttribute("class"))).toEqual(["ms-s0 ms-coming", "ms-s1 ms-coming"]);
    expect(filled.every((r) => r.getAttribute("fill") === null)).toBe(true);
    expect(coming.every((r) => /^url\(#.+-[01]\)$/.test(r.getAttribute("fill")!))).toBe(true);
    // a month with nothing paid is all hatched, and no month is drawn as a month that is not whole
    expect(container.querySelectorAll("g.ms-month")[1]!.querySelectorAll("rect:not(.ms-coming)")).toHaveLength(0);
    expect(container.querySelectorAll("g.ms-partial")).toHaveLength(0);
    expect(container.querySelector(".key-partial")).toBeNull();
  });

  it("stacks the paid parts under the parts to come, each as high as its sum", () => {
    const { container } = kinds();
    const rects = [...container.querySelectorAll("g.ms-month")[0]!.querySelectorAll("rect")];
    const [paidRegular, paidRare, comingRegular, comingRare] = rects.map((r) => ({ y: num(r, "y"), h: num(r, "height") }));
    // each part ends where the one under it starts
    expect(paidRare!.y + paidRare!.h).toBeCloseTo(paidRegular!.y, 5);
    expect(comingRegular!.y + comingRegular!.h).toBeCloseTo(paidRare!.y, 5);
    expect(comingRare!.y + comingRare!.h).toBeCloseTo(comingRegular!.y, 5);
    expect(paidRegular!.h / paidRare!.h).toBeCloseTo(200000 / 30000, 0);
    expect(comingRegular!.h / comingRare!.h).toBeCloseTo(50000 / 40000, 0);
  });

  it("names every part of the resting month in the readout, with its state, and adds no total", () => {
    const { container } = kinds({ resting: "2026-10" });
    const readout = plain(container.querySelector(".readout-line")!.textContent);
    expect(readout).toContain("Ansiotulot, maksettu 2 000 €");
    expect(readout).toContain("Muut tulot, maksettu 300 €");
    expect(readout).toContain("Ansiotulot, tulossa 500 €");
    expect(readout).toContain("Muut tulot, tulossa 400 €");
    expect(readout).not.toContain("Yhteensä");
    expect(container.querySelectorAll(".readout-line .ms-key.ms-coming")).toHaveLength(2);
  });

  it("leaves out a part that is nothing", () => {
    const { container } = kinds({ resting: "2026-11" });
    const readout = plain(container.querySelector(".readout-line")!.textContent);
    expect(readout).toContain("Ansiotulot, tulossa 2 500 €");
    expect(readout).not.toContain("maksettu");
    expect(readout).not.toContain("Muut tulot");
  });

  it("draws one rule at today inside its month, with the ground right of it, and none without a day", () => {
    const { container } = kinds();
    const rule = container.querySelector("line.ms-today")!;
    const ground = container.querySelector("rect.ms-ground")!;
    const x = num(rule, "x1");
    expect(Math.abs(num(ground, "x") - x)).toBeLessThanOrEqual(1);
    // the 16th of 31 days falls inside the first of two bands
    const second = num(container.querySelectorAll("g.ms-month")[1]!.querySelector("rect"), "x");
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(second);
    expect(plain(container.querySelector("text.ms-today-label")!.textContent)).toBe("Nyt 16.10.");
    cleanup();
    const none = kinds({ today: null });
    expect(none.container.querySelector("line.ms-today")).toBeNull();
    expect(none.container.querySelector("rect.ms-ground")).toBeNull();
  });
});
