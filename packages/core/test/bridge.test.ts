import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import { addMonths } from "../src/dates.ts";
import type { Account, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const today = "2026-10-09";

function monthlyOn(firstMonth: string, day: number, count: number, amount: (i: number) => number, partial: Partial<Transaction>): Transaction[] {
  return Array.from({ length: count }, (_, i) => tx({ ...partial, bookingDate: `${addMonths(firstMonth, i)}-${String(day).padStart(2, "0")}`, amountCents: amount(i) }));
}

/** Salary 3 000 € and 300 € saved every month from 2025-09; the salary of the running month has not come yet. */
const household = [
  ...monthlyOn("2025-09", 25, 13, () => 300000, { category: "salary", merchant: "Acme Oy" }),
  ...monthlyOn("2025-09", 2, 14, () => -105000, { category: "housing", merchant: "Sato Oyj" }),
  ...monthlyOn("2025-09", 6, 14, () => -30000, { category: "investments", merchant: "Nordnet" }),
  ...monthlyOn("2025-09", 12, 14, () => -50000, { category: "groceries", merchant: "K-Market" }),
].filter((t) => t.bookingDate <= today);

const ctx = createContext(household, [checking], today);
const dash = (from: string, to: string) => buildDashboard(ctx, { from, to }).bridge;

describe("the bridge of the overview", () => {
  it("the running month alone falls back to the latest complete month and names it", () => {
    const b = dash("2026-10-01", "2026-10-31");
    expect(b.basis).toBe("last");
    expect(b.month).toBe("2026-09");
    expect(b.totals.incomeCents).toBe(300000);
    expect(b.totals.consumptionCents).toBe(155000);
    expect(b.totals.savedCents).toBe(30000);
    expect(b.totals.leftCents).toBe(300000 - 155000 - 30000);
  });

  it("gives the usual income and savings rate of the months before that month", () => {
    const b = dash("2026-10-01", "2026-10-31");
    expect(b.usualIncomeCents).toBe(300000);
    expect(b.usualSavingsRate).toBeCloseTo(0.1, 10);
  });

  it("a running period with complete months uses them, and names a month only when there is one", () => {
    const quarter = dash("2026-08-01", "2026-10-31");
    expect(quarter.basis).toBe("settled");
    expect(quarter.month).toBeNull();
    expect(quarter.totals.incomeCents).toBe(600000);
    expect(quarter.usualIncomeCents).toBeNull();
    // September is the only complete month from the 1st in a range that starts there
    const fromSeptember = dash("2026-09-01", "2026-10-31");
    expect(fromSeptember.basis).toBe("settled");
    expect(fromSeptember.month).toBe("2026-09");
    expect(fromSeptember.usualIncomeCents).toBe(300000);
  });

  it("a period that is over is its own totals, a single month with its usual", () => {
    const august = dash("2026-08-01", "2026-08-31");
    expect(august).toMatchObject({ basis: "range", month: "2026-08", usualIncomeCents: 300000 });
    const year = dash("2026-01-01", "2026-09-30");
    expect(year).toMatchObject({ basis: "range", month: null, usualIncomeCents: null, usualSavingsRate: null });
  });

  it("says nothing usual before three complete months, and without a complete month there is no fallback", () => {
    // the history starts on 2026-08-01: only 2026-09 is complete before today
    const young = createContext(household.filter((t) => t.bookingDate >= "2026-08-01"), [checking], today);
    const b = buildDashboard(young, { from: "2026-10-01", to: "2026-10-31" }).bridge;
    expect(b).toMatchObject({ basis: "last", month: "2026-09", usualIncomeCents: null, usualSavingsRate: null });
    const none = createContext(household.filter((t) => t.bookingDate >= "2026-10-01"), [checking], today);
    expect(buildDashboard(none, { from: "2026-10-01", to: "2026-10-31" }).bridge).toMatchObject({ basis: "running", month: null });
  });
});
