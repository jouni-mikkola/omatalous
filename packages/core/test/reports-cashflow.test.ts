import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { addMonths } from "../src/dates.ts";
import { buildOverview } from "../src/overview.ts";
import { buildReports } from "../src/reports/index.ts";
import type { Account } from "../src/types.ts";
import { dataset, monthlyOn } from "./report-dataset.ts";

// test helpers put every transaction on account "acc-1"
const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };

describe("Tulot ja menot report", () => {
  it("over the last twelve months it is the front page's overview", () => {
    const ctx = createContext(dataset(), [checking], "2026-10-09");
    const range = { from: `${addMonths(ctx.today.slice(0, 7), -11)}-01`, to: ctx.today };
    const months = buildReports({ ctx, range, balances: [] }, ["cashflowMonths"]).cashflowMonths;
    const overview = buildOverview(ctx);
    expect(months.months).toEqual(overview.months);
    expect(months.usualSpendCents).toEqual(overview.usualSpendCents);
    expect(months.completeTotals).toEqual(overview.completeTotals);
    expect(months.gap).toEqual(overview.gap);
  });

  it("over a past year it has twelve complete months and none running", () => {
    const rows = [
      ...monthlyOn("2025-01", 25, 25, () => 300000, { category: "salary", merchant: "Acme Oy" }),
      ...monthlyOn("2025-01", 2, 25, () => -105000, { category: "housing", merchant: "Sato Oyj" }),
      ...monthlyOn("2025-01", 10, 25, () => -40000, { category: "groceries", merchant: "K-Market" }),
    ];
    const ctx = createContext(rows, [checking], "2027-02-10");
    const pastYear = buildReports({ ctx, range: { from: "2026-01-01", to: "2026-12-31" }, balances: [] }, ["cashflowMonths"]).cashflowMonths;
    expect(pastYear.months.map((m) => m.month)).toEqual(Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`));
    expect(pastYear.months.every((m) => m.complete)).toBe(true);
    expect(pastYear.completeTotals?.months).toBe(12);
  });
});
