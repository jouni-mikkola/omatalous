import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { buildReports } from "../src/reports/index.ts";
import type { Account } from "../src/types.ts";
import { dataset } from "./report-dataset.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };

describe("figure parts", () => {
  const ctx = createContext(dataset(), [checking], "2026-10-09");
  const r = buildReports({ ctx, range: { from: "2026-01-01", to: "2026-09-30" }, balances: [] });

  it("the parts add up to each Menot figure, and the usual month is made of the same months", () => {
    const { cashflowSpend: cash, categorySpend: c } = r.figureParts;
    expect(cash).not.toBeNull();
    expect(cash!.months.reduce((sum, m) => sum + m.cents, 0)).toBe(cash!.cents);
    expect(cash!.cents).toBe(r.cashflowMonths.completeTotals!.spendCents);
    expect(cash!.usual!.cents).toBe(r.cashflowMonths.usualSpendCents);
    expect(Math.round((cash!.cents - cash!.usual!.largePurchasesCents) / cash!.usual!.months)).toBe(cash!.usual!.cents);
    expect(c.cents).toBe(r.categories.totalCents);
    expect(c.completeMonthsCents).toBe(cash!.cents);
    expect(c.completeMonthsCents + c.partialMonths.reduce((sum, m) => sum + m.cents, 0) + c.fromSavingsCents + c.otherCents).toBe(c.cents);
    expect(c.completeMonths + c.partialMonths.length).toBeLessThanOrEqual(c.monthsInRange);
  });

  it("a range to today holds the running month as a part, and no row is left to the remainder", () => {
    const { categorySpend: c } = buildReports({ ctx, range: { from: "2026-01-01", to: "2026-10-09" }, balances: [] }).figureParts;
    expect(c.partialMonths.map((m) => m.month)).toEqual(["2026-10"]);
    expect(c.monthsInRange).toBe(10);
    expect(c.otherCents).toBe(0);
  });
});
