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
  { month: "2026-08", complete: true, parts: [300000, 20000], totalCents: 320000 },
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
  usual: { cents: 300000, label: "Tavallinen kuukausi 3 000 € (3 kk)" },
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

  it("names the stack's series and the usual level in the legend", () => {
    const { container } = show();
    const legend = container.querySelector(".ms-legend")!.textContent;
    expect(legend).toContain("Ansiotulot");
    expect(legend).toContain("Muut tulot");
    expect(legend).toContain("Tavallinen kuukausi 3 000 € (3 kk)");
    expect(container.querySelectorAll("line.ms-usual")).toHaveLength(1);
  });

  it("has no legend for one series with no usual level, and no usual line", () => {
    const { container } = show({ series: [SERIES[0]!], months: MONTHS.map((m) => ({ ...m, parts: [m.parts[0]!], totalCents: m.parts[0]! })), usual: null });
    expect(container.querySelector(".ms-legend")).toBeNull();
    expect(container.querySelector("line.ms-usual")).toBeNull();
  });

  it("draws a month that is not whole apart", () => {
    const { container } = show();
    expect(container.querySelectorAll("g.ms-partial")).toHaveLength(2);
    expect(container.querySelectorAll("g.ms-month")).toHaveLength(3);
  });

  it("reads the newest month out on focus, with its sums and that it is not whole", () => {
    show();
    fireEvent.focus(screen.getByRole("group", { name: "Tulot kuukausittain" }));
    const tip = document.querySelector(".tooltip")!;
    expect(tip.textContent).toContain("lokakuu 2026");
    expect(tip.textContent).toContain("Ansiotulot");
    expect(tip.textContent).toContain("kesken");
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
    const tip = document.querySelector(".tooltip")!;
    expect(plain(tip.textContent)).toContain("1 234 €");
    expect(plain(tip.textContent)).not.toContain("1 200 €");
  });

  it("reads a negative month in its readout", () => {
    show({ months: [{ month: "2026-10", complete: true, parts: [-50000], totalCents: -50000 }], series: [SERIES[0]!], usual: null });
    fireEvent.focus(screen.getByRole("group", { name: "Tulot kuukausittain" }));
    expect(plain(document.querySelector(".tooltip")!.textContent)).toMatch(/[−-]500 €/);
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
  const bodyRows = () => within(screen.getByRole("table", { name: "Kuukaudet" })).getAllByRole("row").slice(1);

  it("an arrow key steps to another month and Enter keeps that month's row alone", () => {
    withTable();
    expect(bodyRows()).toHaveLength(3);
    const chart = screen.getByRole("group", { name: /Tulot kuukausittain/ });
    fireEvent.focus(chart);
    fireEvent.keyDown(chart, { key: "ArrowLeft" });
    fireEvent.keyDown(chart, { key: "Enter" });
    const kept = bodyRows();
    expect(kept).toHaveLength(1);
    expect(kept[0]!.textContent).toContain("2026-09");
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
    const table = screen.getByRole("table", { name: "Kuukaudet" });
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
