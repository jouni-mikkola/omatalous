import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import type { Account, IsoDate, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

/**
 * The first page tells the spending of a month twice: as the figure "Menot" and as the last point of the chart "Menojen
 * kertymä". They are one sum, whatever the month holds, so the page can show both and add nothing itself.
 */
const checking: Account = { id: "acc-1", name: "Käyttötili", iban: "FI21 1234 5600 0007 85", currency: "EUR", type: "checking" };
const savings: Account = { id: "acc-2", name: "Säästötili", iban: null, currency: "EUR", type: "savings" };
const today: IsoDate = "2026-10-12";

const buy = (bookingDate: IsoDate, cents: number, partial: Partial<Transaction> = {}) => tx({ bookingDate, amountCents: -cents, merchant: "Prisma", category: "groceries", ...partial });

/** September whole, October to the 12th: a salary, purchases, a refund, a loan payment and an own transfer to savings. */
const rows = [
  tx({ bookingDate: "2026-09-25", amountCents: 300_000, merchant: "Acme Oy", category: "salary" }),
  buy("2026-09-03", 12_000),
  buy("2026-09-20", 8_000),
  tx({ bookingDate: "2026-10-05", amountCents: 300_000, merchant: "Acme Oy", category: "salary" }),
  buy("2026-10-02", 10_000),
  buy("2026-10-09", 4_500),
  // a refund of part of the purchase on the 2nd
  tx({ bookingDate: "2026-10-10", amountCents: 2_500, merchant: "Prisma", category: "groceries" }),
  // the payment of a loan is spending too: debt service
  buy("2026-10-11", 90_000, { merchant: "Esimerkkipankki Oyj", category: "mortgage" }),
  // an own transfer to the savings account, both legs: neither is spending nor income
  tx({ bookingDate: "2026-10-06", amountCents: -20_000, merchant: "Oma siirto", category: "transfer", isTransfer: true }),
  tx({ bookingDate: "2026-10-06", amountCents: 20_000, accountId: "acc-2", merchant: "Oma siirto", category: "transfer", isTransfer: true }),
];
const ctx = createContext(rows, [checking, savings], today);

describe("the month's spending is one sum", () => {
  it("in the running month `totals.expenseCents` is the last point of the running curve of `pace`", () => {
    const d = buildDashboard(ctx, { from: "2026-10-01", to: today });
    const running = d.pace.current.filter((v): v is number => v !== null);
    // 100 + 45 + 900 less the refund of 25, in cents
    expect(d.totals.expenseCents).toBe(10_000 + 4_500 + 90_000 - 2_500);
    expect(d.totals.expenseCents).toBe(running.at(-1));
    expect(d.totals.expenseCents).toBe(d.pace.currentTotal);
    // the salary is income and the transfer is neither: they are in no sum of spending
    expect(d.totals.incomeCents).toBe(300_000);
  });

  it("holds for the whole month asked for before it has ended, and the curve stops at today", () => {
    const d = buildDashboard(ctx, { from: "2026-10-01", to: "2026-10-31" });
    expect(d.pace.current[11]).toBe(d.totals.expenseCents);
    expect(d.pace.current[12]).toBeNull();
  });

  it("holds for a month that has ended: the whole curve ends on the figure", () => {
    const d = buildDashboard(ctx, { from: "2026-09-01", to: "2026-09-30" });
    expect(d.totals.expenseCents).toBe(20_000);
    expect(d.pace.month).toBe("2026-09");
    expect(d.pace.current.at(-1)).toBe(d.totals.expenseCents);
  });

  it("a month with no row has the figure 0 and a curve that never leaves it", () => {
    const d = buildDashboard(createContext([buy("2026-08-15", 1_000)], [checking], today), { from: "2026-10-01", to: today });
    expect(d.totals.expenseCents).toBe(0);
    expect(d.pace.currentTotal).toBe(0);
    expect(d.pace.current.filter((v) => v !== null).every((v) => v === 0)).toBe(true);
  });
});
