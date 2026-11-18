/**
 * Raportit: the tax-year card has no explanation lines and names the days it covers in its caption, and the months table of
 * Menot kategorioittain draws the column of debt paid from savings only when a month holds some.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import "@banking/core/late";
import { section as spending } from "../src/pages/reports/sections/SpendingMonths.tsx";
import { section as tax } from "../src/pages/reports/sections/TaxYear.tsx";
import type { ReportContext } from "../src/pages/reports/types.ts";
import type { ReportsData } from "../src/types.ts";
import "./fixed-clock.ts";

afterEach(cleanup);

const plain = (s: string | null) => (s ?? "").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
const row = (id: string, name: string, cents: number) => ({ id, date: "2025-03-14", name, cents });

type Tax = ReportsData["taxYear"];
const taxReport = (partial: boolean): Tax =>
  ({
    year: partial ? 2026 : 2025,
    // A year in progress is the running year of the fixed clock (2026-11-11), whose days a date writes without the year.
    range: partial ? { from: "2026-01-01", to: "2026-11-11" } : { from: "2025-01-01", to: "2025-12-31" },
    partial,
    income: { totalCents: 0, types: [] },
    refunds: { cents: 40000, rows: [row("r1", "Verotoimisto", 40000)] },
    residual: { cents: -12000, rows: [row("r2", "Verotoimisto", -12000)] },
    interest: { cents: 0, rows: [] },
    loanPayments: [],
    household: { cents: -9000, rows: [row("r3", "Siivouspalvelu", -9000)] },
  }) as unknown as Tax;

const taxContext = (taxYear: Tax): ReportContext => ({ data: { taxYear }, label: (id: string) => id }) as unknown as ReportContext;
const showTax = (r: Tax) => render(createElement(tax.Component, { ctx: taxContext(r) }));

describe("Verovuoden rivit", () => {
  it("has no explanation line, a year in progress included, and every part keeps its rows", () => {
    const { container } = showTax(taxReport(true));
    expect(container.querySelector(".sheet-note")).toBeNull();
    expect(plain(container.textContent)).not.toContain("Vuosi on kesken");
    for (const name of ["Veronpalautukset", "Jäännösverot", "Rivit, jotka voivat liittyä kotitalousvähennykseen"]) expect(screen.getByRole("table", { name })).toBeTruthy();
  });

  it("shows the income by source with its total, as the printed sheet and the CSV carry it", () => {
    const types = [
      { type: "salary", label: "Palkka", group: "earned", earned: true, totalCents: 3_000_000 },
      { type: "benefit", label: "Etuudet", group: "benefit", earned: false, totalCents: 120_050 },
    ];
    showTax({ ...taxReport(false), income: { totalCents: 3_120_050, types } } as unknown as Tax);
    const table = screen.getByRole("table", { name: "Tulot lähteittäin" });
    const text = plain(table.textContent);
    expect(text).toContain("Palkka");
    expect(text).toContain("30 000,00 €");
    expect(text).toContain("Etuudet");
    expect(text).toContain("1 200,50 €");
    expect(text).toMatch(/Yhteensä\s*31 200,50 €/);
    expect(within(table).getAllByRole("row")).toHaveLength(4);
  });

  it("names the days it covers in the caption, for a year in progress and a whole one", () => {
    const part = showTax(taxReport(true));
    expect(plain(part.container.querySelector(".card-datum")!.textContent)).toBe("1.1.–11.11.2026");
    cleanup();
    const whole = showTax(taxReport(false));
    expect(plain(whole.container.querySelector(".card-datum")!.textContent)).toBe("1.1.–31.12.2025");
  });

  it("shows an interest sum that is not known as unknown, never 0, also with no interest row", () => {
    const unknown = { ...taxReport(true), interest: { cents: null, rows: [] }, loanPayments: [{ category: "mortgage", cents: 138_200, count: 1 }] } as unknown as Tax;
    const onlyUnknown = { ...unknown, refunds: { cents: 0, rows: [] }, residual: { cents: 0, rows: [] }, loanPayments: [], household: { cents: 0, rows: [] } } as unknown as Tax;
    expect(tax.visible?.(taxContext(onlyUnknown))).toBe(true);
    showTax(unknown);
    const text = plain(screen.getByRole("table", { name: "Lainojen ja luottojen korot" }).textContent);
    expect(text).toMatch(/Yhteensä\s*–/);
    expect(text).not.toContain("0,00 €");
  });
});

type Spending = ReportsData["spendingMonths"];
const MONTHS = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
const spendingReport = (fromSavings: number[]): Spending => {
  const values = [30000, 30000, 30000, 30000, 30000, 10000];
  return {
    months: MONTHS,
    from: "2026-05-01",
    complete: [true, true, true, true, true, false],
    totals: values,
    totalCents: values.reduce((a, b) => a + b, 0),
    fromSavings,
    fromSavingsCents: fromSavings.reduce((a, b) => a + b, 0),
    typicalCents: 30000,
    typicalFlowCents: 30000,
    typicalMonths: 5,
    categoryMonths: 5,
    cardGap: false,
    last: 4,
    categories: [{ category: "groceries", label: "Ruokakauppa", values, totalCents: 160000, typicalCents: 30000, lastDiffCents: 0, payees: [], otherPayeesCents: 160000, statementCents: 0 }],
  } as unknown as Spending;
};
const spendingContext = (spendingMonths: Spending): ReportContext =>
  ({ data: { spendingMonths }, meta: { today: "2026-10-09", accounts: [{ id: "acc-1" }], sharedAccounts: [] }, range: { from: "2026-05-01", to: "2026-10-09" }, scope: "own", running: "2026-10", label: (id: string) => id, exportHref: () => "/export.csv" }) as unknown as ReportContext;
const monthHeaders = (fromSavings: number[]) => {
  render(createElement(spending.Component, { ctx: spendingContext(spendingReport(fromSavings)) }));
  return within(screen.getByRole("table", { name: "Menot kuukausittain" })).getAllByRole("columnheader").map((h) => plain(h.textContent));
};

describe("Menot kategorioittain: the column of debt paid from savings", () => {
  it("is absent when every month is 0", () => {
    expect(monthHeaders([0, 0, 0, 0, 0, 0])).toEqual(["Kuukausi", "Summa"]);
  });

  it("is present when one month is not 0", () => {
    // the sum holds the debt paid from savings, so it is not named like the first page's Menot, which leave it out
    expect(monthHeaders([0, 0, 0, 0, 0, 46000])).toEqual(["Kuukausi", "Maksettu yhteensä", "Säästöistä maksettu"]);
  });

  it("is present when months of both signs add up to 0", () => {
    expect(monthHeaders([0, 0, 0, 0, 50000, -50000])).toEqual(["Kuukausi", "Maksettu yhteensä", "Säästöistä maksettu"]);
  });
});
