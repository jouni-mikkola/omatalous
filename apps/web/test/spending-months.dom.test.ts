/**
 * Raportit > Rahankäyttö: a category's average and its gap to the newest month read only the months that hold a
 * connected card's purchases as the newest one does (core `cardGap`). The page says so above the table, shows no
 * average where a category has none, and leaves the footer's average to the months table when the two read other months.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
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
  payees: [],
  otherPayeesCents: values.reduce((a, b) => a + b, 0),
  statementCents: 0,
  lowered: false,
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
    typicalCents: 44800,
    typicalMonths: 5,
    categoryMonths: typical ? 3 : 1,
    cardGap: true,
    last: 4,
    categories: [category("card_bill", "Luottokortin lasku", bills, typical ? 0 : null, typical ? 0 : null), category("groceries", "Ruokakauppa", groceries, typical ? 40000 : null, typical ? 0 : null)],
  };
};

const context = (spendingMonths: Report): ReportContext =>
  ({ data: { spendingMonths }, meta: { today: "2026-10-09", accounts: [{ id: "acc-1" }], sharedAccounts: [] }, range: { from: "2026-05-01", to: "2026-10-09" }, scope: "own", running: "2026-10", label: (id: string) => id, exportHref: () => "/export.csv" }) as unknown as ReportContext;
const show = (r: Report) => render(createElement(section.Component, { ctx: context(r) }));
const plain = (s: string | null) => (s ?? "").replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();

describe("Rahankäyttö: a category's average beside a card connected late", () => {
  it("says which months the categories' average is of, and keeps the footer's average to the months table", () => {
    show(report(true));
    expect(plain(document.body.textContent)).toContain("Kategorioiden keskiarvo on 3 kuukaudelta, joilla yhdistetyn kortin ostot ovat mukana.");
    const table = screen.getByRole("table", { name: "Kategoriat" });
    expect(within(table).getAllByRole("columnheader").map((h) => plain(h.textContent))).toEqual(["Kategoria", "Yhteensä", "Keskimäärin kuussa", "Ero keskiarvoon, syyskuu 2026"]);
    // 400 € over July to September is not added up with the totals' 448 € over May to September
    expect(plain(table.querySelector("tfoot")!.textContent)).not.toContain("448");
    const months = screen.getByRole("table", { name: "Menot kuukausittain" });
    expect(plain(months.querySelector("tfoot")!.textContent)).toContain("448 €");
  });

  it("with too few such months the categories have no average column, and the page says why", () => {
    show(report(false));
    expect(plain(document.body.textContent)).toContain("Kategorioilla ei ole vielä keskiarvoa, koska yhdistetyn kortin ostot puuttuvat aiemmilta kuukausilta.");
    const table = screen.getByRole("table", { name: "Kategoriat" });
    expect(within(table).getAllByRole("columnheader").map((h) => plain(h.textContent))).toEqual(["Kategoria", "Yhteensä"]);
    expect(plain(screen.getByRole("table", { name: "Menot kuukausittain" }).querySelector("tfoot")!.textContent)).toContain("448 €");
  });

  it("without a card gap says nothing of cards and the footer has the average month", () => {
    show({ ...report(true), cardGap: false, categoryMonths: 5, typicalCents: 40000 });
    expect(plain(document.body.textContent)).not.toContain("kortin ostot");
    expect(plain(screen.getByRole("table", { name: "Kategoriat" }).querySelector("tfoot")!.textContent)).toContain("400 €");
  });
});
