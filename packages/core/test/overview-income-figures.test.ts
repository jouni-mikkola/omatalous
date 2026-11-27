/** The figures the strip and the income table of Raportit > Tulot ja menot print: core adds them up, the web only draws them. */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import { buildReports } from "../src/reports/index.ts";
import type { Account } from "../src/types.ts";
import { tx } from "./helpers.ts";
import { dataset } from "./report-dataset.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const today = "2026-10-09";

describe("the income report's share of all the money in", () => {
  it("is a type's total over the whole, apart from its share of the earned", () => {
    const refund = tx({ bookingDate: "2026-04-12", amountCents: 41250, category: "tax_refund", merchant: "Verohallinto" });
    const ctx = createContext([...dataset(), refund], [checking], today);
    const income = buildReports({ ctx, range: { from: "2026-01-01", to: "2026-09-30" }, balances: [] }, ["income"]).income;
    const salary = income.types.find((ty) => ty.type === "salary")!;
    const taxRefund = income.types.find((ty) => ty.type === "tax_refund")!;
    expect(income.notEarnedCents).toBe(41250);
    expect(taxRefund.shareOfAll).toBe(41250 / income.totalCents);
    expect(salary.shareOfAll).toBe(salary.totalCents / income.totalCents);
    // the share of the earned is another figure: null for money that is not earned, and the salary's is the whole of it
    expect(taxRefund.share).toBeNull();
    expect(salary.share).toBe(1);
    expect(salary.shareOfAll).toBeLessThan(1);
    expect(income.types.reduce((sum, ty) => sum + ty.shareOfAll, 0)).toBeCloseTo(1, 10);
  });
});

describe("the overview's totals of the complete months", () => {
  it("add up their income and spending and give the difference of the two", () => {
    const ctx = createContext(dataset(), [checking], today);
    const { months, completeTotals } = buildDashboard(ctx, { from: "2026-01-01", to: today }).overview;
    const whole = months.filter((m) => m.complete && m.incomeCents !== null && m.spendCents !== null);
    expect(whole.length).toBeGreaterThan(1);
    expect(months.at(-1)!.complete).toBe(false);
    expect(completeTotals).not.toBeNull();
    expect(completeTotals!.months).toBe(whole.length);
    expect(completeTotals!.incomeCents).toBe(whole.reduce((sum, m) => sum + m.incomeCents!, 0));
    expect(completeTotals!.spendCents).toBe(whole.reduce((sum, m) => sum + m.spendCents!, 0));
    // one definition: the average a month over the very months the total adds up
    expect(completeTotals!.averageIncomeCents).toBe(Math.round(completeTotals!.incomeCents / whole.length));
    expect(completeTotals!.netCents).toBe(completeTotals!.incomeCents - completeTotals!.spendCents);
    expect(completeTotals!.averageNetCents).toBe(Math.round(completeTotals!.netCents / whole.length));
  });

  it("are none without a complete month, and a single month is its own average", () => {
    const none = buildDashboard(createContext([], [checking], today), { from: "2026-01-01", to: today }).overview;
    expect(none.months.some((m) => m.complete)).toBe(false);
    expect(none.completeTotals).toBeNull();
    // the history starts on 2025-09-01: on 2025-10-09 September is its one complete month
    const early = "2025-10-09";
    const single = buildDashboard(createContext(dataset().filter((t) => t.bookingDate <= early), [checking], early), { from: "2025-01-01", to: early }).overview;
    expect(single.months.filter((m) => m.complete).map((m) => m.month)).toEqual(["2025-09"]);
    expect(single.completeTotals).toMatchObject({ months: 1 });
    expect(single.completeTotals!.averageIncomeCents).toBe(single.completeTotals!.incomeCents);
    expect(single.completeTotals!.averageNetCents).toBe(single.completeTotals!.netCents);
  });
});
