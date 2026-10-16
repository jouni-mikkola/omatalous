import { describe, expect, it } from "vitest";
import { type AnalysisContext, createContext } from "../src/analysis/context.ts";
import { cashflowReport } from "../src/reports/cashflow.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import type { Account, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const accounts: Account[] = [
  { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" },
  { id: "acc-2", name: "Säästötili", iban: null, currency: "EUR", type: "savings" },
];
const today = "2026-10-09";
/** The waterfall the dashboard gives for a range. */
const dashboardWaterfall = (c: AnalysisContext, range: { from: string; to: string }) => buildDashboard(c, range).waterfall;
const monthOnly = (c: AnalysisContext, month: string) => dashboardWaterfall(c, { from: `${month}-01`, to: `${month}-28` });
const bar = (w: ReturnType<typeof dashboardWaterfall>, key: string) => w?.bars.find((b) => b.key === key)?.cents;
const sum = (w: NonNullable<ReturnType<typeof dashboardWaterfall>>) => w.bars.reduce((n, b) => n + b.cents, 0);
const by = (category: string, bookingDate: string, amountCents: number, more: Partial<Transaction> = {}) => tx({ category, bookingDate, amountCents, categorySource: "rule", merchant: `ESIMERKKI ${category}`, ...more });

/** September: pay, eight kinds of spending, an unknown payment each way, savings, a transfer to the savings account, credit drawn. */
const september: Transaction[] = [
  by("salary", "2026-09-25", 300000),
  by("housing", "2026-09-02", -105000),
  by("groceries", "2026-09-03", -40000),
  by("groceries", "2026-09-12", -15000),
  by("transport", "2026-09-04", -9000),
  by("restaurants", "2026-09-05", -8000),
  by("health", "2026-09-06", -7000),
  by("shopping", "2026-09-07", -6000),
  by("entertainment", "2026-09-08", -5000),
  by("fees", "2026-09-09", -2000),
  by("other", "2026-09-10", -2500, { categorySource: "default" }),
  by("income", "2026-09-11", 1000, { categorySource: "default" }),
  by("investments", "2026-09-06", -30000),
  by("transfer", "2026-09-13", -20000, { isTransfer: true }),
  by("transfer", "2026-09-13", 20000, { isTransfer: true, accountId: "acc-2" }),
  by("credit_draw", "2026-09-14", 10000),
];
const ctx = createContext(september, accounts, today);

describe("the month waterfall", () => {
  it("adds up to Yli jäi of the cash flow report, with transfers and unknown rows as bars of their own", () => {
    const w = monthOnly(ctx, "2026-09")!;
    expect(w.leftCents).toBe(cashflowReport(ctx, { from: "2026-09-01", to: "2026-09-30" }).totals.leftCents);
    expect(sum(w)).toBe(w.leftCents);
    expect(bar(w, "income")).toBe(300000);
    // savings (30 000) and the money landing on the savings account (20 000) leave Yli jäi; the credit drawn is in it
    expect(bar(w, "transfers")).toBe(-30000 - 20000 + 10000);
    expect(bar(w, "unknown")).toBe(-2500 + 1000);
    expect(w.bars.map((b) => b.key)).toEqual(["income", "category:housing", "category:groceries", "category:transport", "category:restaurants", "category:health", "category:shopping", "other", "transfers", "unknown"]);
    // the rest of the spending: entertainment and fees
    expect(bar(w, "other")).toBe(-5000 - 2000);
    expect(bar(w, "category:groceries")).toBe(-55000);
  });

  it("a row the household classified is no unknown row: the same payment with a rule is a category", () => {
    const classified = september.map((t) => (t.category === "other" || t.category === "income" ? { ...t, categorySource: "rule" as const } : t));
    const w = monthOnly(createContext(classified, accounts, today), "2026-09")!;
    expect(bar(w, "unknown")).toBeUndefined();
    // nine categories now: the three smallest are the rest of the spending
    expect(bar(w, "other")).toBe(-5000 - 2000 - 2500);
    expect(sum(w)).toBe(w.leftCents);
    // the income the default called unknown was money in: now it is income
    expect(bar(w, "income")).toBe(301000);
  });

  it("a refund lowers its category and the sum rule still holds", () => {
    const withRefund = [...september, by("shopping", "2026-09-20", 6000, { merchant: "ESIMERKKI shopping" })];
    const w = monthOnly(createContext(withRefund, accounts, today), "2026-09")!;
    expect(sum(w)).toBe(w.leftCents);
    expect(w.leftCents).toBe(monthOnly(ctx, "2026-09")!.leftCents + 6000);
    // the refund took the purchase back: the category nets to nothing and the refund is no income
    expect(bar(w, "category:shopping")).toBeUndefined();
    expect(bar(w, "income")).toBe(300000);
  });

  it("is null for a month with no rows and for a range after today; a long range ends in today's month", () => {
    expect(monthOnly(ctx, "2026-08")).toBeNull();
    expect(dashboardWaterfall(ctx, { from: "2026-11-01", to: "2026-11-30" })).toBeNull();
    expect(dashboardWaterfall(ctx, { from: "2026-08-01", to: "2026-08-31" })).toBeNull();
    // a range running past today: today's month (October has no rows here), a range ending in September: September
    expect(dashboardWaterfall(ctx, { from: "2026-09-01", to: "2026-12-31" })).toBeNull();
    expect(dashboardWaterfall(ctx, { from: "2026-07-01", to: "2026-09-30" })?.month).toBe("2026-09");
  });

  it("a month with pay alone has income as its only bar", () => {
    const w = monthOnly(createContext([by("salary", "2026-09-25", 300000)], accounts, today), "2026-09")!;
    expect(w.bars).toEqual([{ key: "income", cents: 300000 }]);
    expect(w.leftCents).toBe(300000);
  });
});
