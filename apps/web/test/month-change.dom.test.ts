/**
 * Raportit > Menot kategorioittain > Mikä muuttui: the usual month, a step for each category that moved it and the month,
 * from the report's `changes`. The page adds up nothing: the starts, ends and gaps are the server's, and a month the
 * report gives no steps for cannot be picked.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import "@banking/core/late";
import { section } from "../src/pages/reports/sections/MonthChange.tsx";
import type { ReportContext } from "../src/pages/reports/types.ts";
import type { ReportsData } from "../src/types.ts";
import "./fixed-clock.ts";

afterEach(cleanup);

type Report = ReportsData["spendingMonths"];
const MONTHS = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];

const change = (rise: number): NonNullable<Report["changes"][number]> => ({
  startCents: 100_000,
  steps: [
    { category: "groceries", label: "Ruokakauppa", cents: rise, fromCents: 100_000, toCents: 100_000 + rise },
    { category: null, label: null, cents: -20_000, fromCents: 100_000 + rise, toCents: 80_000 + rise },
  ],
  endCents: 80_000 + rise,
});

const report = (changes: Report["changes"]): Report =>
  ({
    months: MONTHS,
    from: "2026-05-01",
    complete: [true, true, true, true, true, false],
    totals: [0, 0, 0, 0, 0, 0],
    totalCents: 0,
    fromSavings: MONTHS.map(() => 0),
    fromSavingsCents: 0,
    typicalCents: 100_000,
    typicalFlowCents: 100_000,
    largeFlowCompleteCents: 0,
    againstUsual: MONTHS.map(() => null),
    typicalMonths: 5,
    categoryMonths: 3,
    cardGap: false,
    last: 4,
    changes,
    categories: [],
  }) as Report;

const context = (spendingMonths: Report): ReportContext => ({ data: { spendingMonths } }) as unknown as ReportContext;
const show = (r: Report) => render(createElement(section.Component, { ctx: context(r) }));
const plain = (s: string | null) => (s ?? "").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();

describe("Menot kategorioittain: Mikä muuttui", () => {
  it("opens on the newest month with steps, and names the usual month, each step and the month with the report's figures", () => {
    show(report([null, null, change(10_000), change(30_000), change(50_000), null]));
    const table = screen.getByRole("table", { name: "Mikä muuttui: syyskuu 2026" });
    const rows = Array.from(table.querySelectorAll("tbody tr")).map((tr) => plain(tr.textContent));
    expect(rows).toHaveLength(4);
    // the categories' own sum has a label of its own: Tavallinen kuukausi is the line of the months above it
    expect(rows[0]).toContain("Kategorioiden keskiarvot yhteensä");
    expect(rows[0]).not.toContain("Tavallinen kuukausi");
    expect(rows[0]).toContain("1 000 €");
    expect(rows[1]).toContain("Ruokakauppa");
    expect(rows[1]).toContain("500 €");
    expect(rows[3]).toContain("Syyskuu 2026");
    expect(rows[3]).toContain("1 300 €");
    expect(table.querySelectorAll(".rt-span")).toHaveLength(4);
    expect(document.querySelector(".mc-note")).toBeNull();
    expect(document.body.textContent).not.toContain("suuria ostoja");
  });

  it("names the step of the categories with no level \"Kategoriat ilman keskiarvoa, kortti liitetty äskettäin\"", () => {
    const withStep: NonNullable<Report["changes"][number]> = {
      startCents: 100_000,
      steps: [{ category: null, label: null, withoutLevel: true, cents: 7_000, fromCents: 100_000, toCents: 107_000 }],
      endCents: 107_000,
    };
    show(report([null, null, null, null, withStep, null]));
    const table = screen.getByRole("table", { name: "Mikä muuttui: syyskuu 2026" });
    const rows = Array.from(table.querySelectorAll("tbody tr")).map((tr) => plain(tr.textContent));
    expect(rows[1]).toContain("Kategoriat ilman keskiarvoa, kortti liitetty äskettäin");
    expect(rows[1]).toContain("70 €");
  });

  it("has no rest row when the server sends none because the other gaps cancel out", () => {
    const whole: NonNullable<Report["changes"][number]> = {
      startCents: 100_000,
      steps: [{ category: "groceries", label: "Ruokakauppa", cents: 5_000, fromCents: 100_000, toCents: 105_000 }],
      endCents: 105_000,
    };
    show(report([null, null, null, null, whole, null]));
    const rows = Array.from(screen.getByRole("table").querySelectorAll("tbody tr")).map((tr) => plain(tr.textContent));
    expect(rows).toHaveLength(3);
    expect(rows.join(" ")).not.toContain("Muut muutokset");
  });

  it("steps to the months before and after that have steps, and offers none past the ends", () => {
    show(report([null, null, change(10_000), change(30_000), change(50_000), null]));
    expect(screen.queryByRole("button", { name: /›/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /‹ elokuu 2026/ }));
    expect(screen.getByRole("table", { name: "Mikä muuttui: elokuu 2026" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /syyskuu 2026 ›/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /‹ heinäkuu 2026/ }));
    expect(screen.queryByRole("button", { name: /‹/ })).toBeNull();
  });

  it("is shown only when some month has steps", () => {
    expect(section.visible?.({ data: { spendingMonths: report(MONTHS.map(() => null)) } } as unknown as ReportContext)).toBe(false);
    expect(section.visible?.({ data: { spendingMonths: report([null, change(1_000), null, null, null, null]) } } as unknown as ReportContext)).toBe(true);
  });
});
