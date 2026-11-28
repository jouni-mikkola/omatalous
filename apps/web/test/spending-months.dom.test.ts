/**
 * Raportit > Menot kategorioittain: a category's average and its gap to the newest month read only the months that hold a
 * connected card's purchases as the newest one does (core `cardGap`). The page says nothing of it (the gap is not mended here), shows no
 * gap to an average where a category has none, and has no average under the totals. The months of all spending are on Tulot ja menot,
 * so the card has one table and no chart.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import "@banking/core/late";
import { section } from "../src/pages/reports/sections/SpendingMonths.tsx";
import type { ReportContext } from "../src/pages/reports/types.ts";
import type { ReportsData } from "../src/types.ts";
import "./fixed-clock.ts";

afterEach(cleanup);

type Report = ReportsData["spendingMonths"];
const MONTHS = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
const category = (id: string, label: string, values: number[], typicalCents: number | null, lastDiffCents: number | null) => ({
  category: id,
  label,
  values,
  totalCents: values.reduce((a, b) => a + b, 0),
  typicalCents,
  lastDiffCents,
  lastOff: lastDiffCents !== null && lastDiffCents !== 0,
  payees: [],
  otherPayeesCents: values.reduce((a, b) => a + b, 0),
  statementCents: 0,
});

/** Card bills until June, the card's own purchases since July: the totals keep their level, the categories read July to September. */
const report = (typical: boolean): Report => {
  const groceries = [0, 0, 40000, 40000, 40000, 12000];
  const bills = [52000, 52000, 0, 0, 0, 0];
  const totals = MONTHS.map((_, i) => groceries[i]! + bills[i]!);
  return {
    months: MONTHS,
    from: "2026-05-01",
    complete: [true, true, true, true, true, false],
    totals,
    totalCents: totals.reduce((a, b) => a + b, 0),
    fromSavings: MONTHS.map(() => 0),
    fromSavingsCents: 0,
    typicalCents: 44800,
    typicalFlowCents: 44800,
    largeFlowCompleteCents: 0,
    againstUsual: MONTHS.map(() => null),
    typicalMonths: 5,
    categoryMonths: typical ? 3 : 1,
    cardGap: true,
    last: 4,
    changes: MONTHS.map(() => null),
    categories: [category("card_bill", "Luottokortin lasku", bills, typical ? 0 : null, typical ? 0 : null), category("groceries", "Ruokakauppa", groceries, typical ? 40000 : null, typical ? 0 : null)],
  };
};

const context = (spendingMonths: Report): ReportContext =>
  ({ data: { spendingMonths }, meta: { today: "2026-10-09", accounts: [{ id: "acc-1" }], sharedAccounts: [] }, range: { from: "2026-05-01", to: "2026-10-09" }, scope: "own", running: "2026-10", label: (id: string) => id, exportHref: () => "/export.csv" }) as unknown as ReportContext;
const show = (r: Report) => render(createElement(section.Component, { ctx: context(r) }));
const plain = (s: string | null) => (s ?? "").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();

describe("Menot kategorioittain: a category's average beside a card connected late", () => {
  it("shows no average under the totals, no chart or table of the months, and no sentence on the card", () => {
    show(report(true));
    expect(plain(document.body.textContent)).not.toContain("kortin ostot");
    const table = screen.getByRole("table", { name: "Kategoriat" });
    expect(within(table).getAllByRole("columnheader").map((h) => plain(h.textContent))).toEqual(["Kategoria", "Kehitys", "Yhteensä", "Ero keskiarvoon, syyskuu 2026"]);
    // 400 € over July to September is not added up with the totals' 448 € over May to September
    expect(plain(table.querySelector("tfoot")!.textContent)).not.toContain("448");
    expect(screen.getAllByRole("table", { hidden: true })).toHaveLength(1);
    expect(document.querySelector("g.ms-month")).toBeNull();
  });

  it("with too few such months the categories have no average column, and no link sends to an import that would not help", () => {
    show(report(false));
    expect(plain(document.body.textContent)).not.toContain("kortin ostot");
    expect(screen.queryByRole("link", { name: "Tuo kortin tiliote" })).toBeNull();
    const table = screen.getByRole("table", { name: "Kategoriat" });
    expect(within(table).getAllByRole("columnheader").map((h) => plain(h.textContent))).toEqual(["Kategoria", "Yhteensä"]);
  });

  it("without a card gap says nothing of cards and the footer holds the total only", () => {
    show({ ...report(true), cardGap: false, categoryMonths: 5, typicalCents: 40000 });
    expect(plain(document.body.textContent)).not.toContain("kortin ostot");
    expect(plain(screen.getByRole("table", { name: "Kategoriat" }).querySelector("tfoot")!.textContent)).not.toContain("400 €");
  });
});

describe("Menot kategorioittain: the line of a category's months", () => {
  it("draws a line with the level dashed for a category that has one, and marks the dot only where the report says the month is off and above the level", () => {
    const base = report(true);
    // a near miss: the card bills are off their level too, but below it
    const { container } = show({ ...base, categories: base.categories.map((c) => (c.category === "groceries" ? { ...c, lastOff: true, lastDiffCents: 150_00 } : { ...c, lastOff: true, lastDiffCents: -150_00 })) });
    const table = screen.getByRole("table", { name: "Kategoriat" });
    const lines = Array.from(table.querySelectorAll("svg.rt-spark"));
    expect(lines).toHaveLength(2);
    expect(container.querySelectorAll("line.rt-spark-usual")).toHaveLength(2);
    expect(lines.map((l) => l.hasAttribute("data-off"))).toEqual([false, true]);
    expect(plain(lines[1]!.getAttribute("aria-label")!)).toBe("Ruokakauppa: viimeisin kuukausi 400 €, keskimäärin 400 €");
  });

  it("draws none for a category with no level", () => {
    show(report(false));
    expect(document.querySelector("svg.rt-spark")).toBeNull();
  });
});

describe("Menot kategorioittain: an opened category", () => {
  it("has a row for each of its own months", () => {
    show(report(true));
    fireEvent.click(screen.getByRole("button", { name: "Ruokakauppa" }));
    const own = screen.getByRole("table", { name: "Ruokakauppa kuukausittain" });
    expect(own.querySelectorAll("tbody tr")).toHaveLength(6);
  });

  it("names the part of a category that was read off a card statement, only when there is one", () => {
    const base = report(true);
    show({ ...base, categories: base.categories.map((c) => (c.category === "groceries" ? { ...c, statementCents: 12000 } : c)) });
    fireEvent.click(screen.getByRole("button", { name: "Ruokakauppa" }));
    expect(plain(document.body.textContent)).toMatch(/Kortin erittelystä luettu\s*120 €/);
    cleanup();
    show(base);
    fireEvent.click(screen.getByRole("button", { name: "Ruokakauppa" }));
    expect(plain(document.body.textContent)).not.toContain("Kortin erittelystä luettu");
  });
});
