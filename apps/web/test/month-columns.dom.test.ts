/**
 * Raportit: the months chart (MonthColumns). One column a month stacked by series, the usual level a dashed line, a month
 * that is not whole drawn apart and named in its readout.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import "@banking/core/late";
import { MonthColumns } from "../src/charts/forms/MonthColumns.tsx";
import "./fixed-clock.ts";

afterEach(cleanup);

const MONTHS = [
  { month: "2026-08", complete: true, parts: [300000, 20000] },
  { month: "2026-09", complete: false, parts: [150000, 0] },
  { month: "2026-10", complete: true, parts: [310000, 0] },
];
const SERIES = [
  { key: "earned", label: "Ansiotulot" },
  { key: "other", label: "Muut tulot" },
];

const show = (props: Partial<Parameters<typeof MonthColumns>[0]> = {}) =>
  render(createElement(MonthColumns, { months: MONTHS, series: SERIES, tone: "income", usual: { cents: 300000, label: "Tavallinen kuukausi 3 000 € (3 kk)" }, running: "2026-10", label: "Tulot kuukausittain", ...props }));

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
    const { container } = show({ series: [SERIES[0]!], months: MONTHS.map((m) => ({ ...m, parts: [m.parts[0]!] })), usual: null });
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
});
