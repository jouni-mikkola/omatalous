/**
 * Interest and a loan instalment paid from a savings account. The money was counted as saved when it left the checking
 * account, so Tulos counts the payment once and its figures (income, spending, difference) carry no flow of the row. The
 * payment is still spending: the categories, the months, the tax-year sheet and the figures of loans show it. Made-up
 * household only.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import { leftOf } from "../src/analysis/flows.ts";
import { buildReports } from "../src/reports/index.ts";
import type { Account, IsoDate, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: "FI21 1234 5600 0007 85", currency: "EUR", type: "checking" };
const savings: Account = { id: "acc-2", name: "Säästötili", iban: null, currency: "EUR", type: "savings" };
const today: IsoDate = "2026-10-12";
const range = { from: "2026-10-01", to: today };

const fromSavings = (bookingDate: IsoDate, cents: number, partial: Partial<Transaction>) => tx({ bookingDate, amountCents: -cents, accountId: "acc-2", merchant: "Esimerkkipankki Oyj", ...partial });

const INTEREST = 6_000;
const INSTALMENT = 40_000;
const rows = [
  tx({ bookingDate: "2026-10-05", amountCents: 300_000, merchant: "Acme Oy", category: "salary" }),
  tx({ bookingDate: "2026-10-02", amountCents: -20_000, merchant: "Prisma", category: "groceries" }),
  // 500 euro to the savings account, both legs: the checking account pays, the savings account receives
  tx({ bookingDate: "2026-10-06", amountCents: -50_000, merchant: "Oma siirto", category: "transfer", isTransfer: true }),
  tx({ bookingDate: "2026-10-06", amountCents: 50_000, accountId: "acc-2", merchant: "Oma siirto", category: "transfer", isTransfer: true }),
  fromSavings("2026-10-08", INTEREST, { category: "interest" }),
  fromSavings("2026-10-09", INSTALMENT, { category: "mortgage" }),
];
const ctx = createContext(rows, [checking, savings], today);

describe("a debt paid from a savings account", () => {
  it("has no flow and is still spending on its category", () => {
    const paid = ctx.txs.filter((t) => t.accountId === "acc-2" && !t.isTransfer);
    expect(paid).toHaveLength(2);
    for (const t of paid) {
      expect(leftOf(t.flows)).toBe(0);
      expect(t.flows).toMatchObject({ consumption: 0, debt: 0, saved: 0 });
    }
    expect(paid.map((t) => t.spend).sort((a, b) => a - b)).toEqual([INTEREST, INSTALMENT]);
  });

  it("is counted once in the figures of Tulos, which add up to what the checking account changed", () => {
    const { totals } = buildDashboard(ctx, range);
    expect(totals.incomeCents).toBe(300_000);
    expect(totals.expenseCents).toBe(20_000);
    expect(totals.savedCents).toBe(50_000);
    expect(totals.netCents).toBe(totals.incomeCents - totals.expenseCents);
    expect(totals.leftCents).toBe(totals.incomeCents + totals.borrowedCents - totals.expenseCents - totals.savedCents);
    const changed = ctx.txs.filter((t) => t.accountId === "acc-1").reduce((sum, t) => sum + t.amountCents, 0);
    expect(totals.leftCents).toBe(changed);
  });

  it("is in the category totals, spending by month and the tax-year sheet", () => {
    const d = buildDashboard(ctx, range);
    expect(d.categories.find((c) => c.category === "interest")?.cents).toBe(INTEREST);
    expect(d.categories.find((c) => c.category === "mortgage")?.cents).toBe(INSTALMENT);
    // the categories hold what the identity leaves out, and nothing else
    expect(d.categories.reduce((sum, c) => sum + c.cents, 0)).toBe(d.totals.expenseCents + INTEREST + INSTALMENT);

    const r = buildReports({ ctx, range, balances: [] }, ["spendingMonths", "taxYear"]);
    expect(r.spendingMonths.totalCents).toBe(d.totals.expenseCents + INTEREST + INSTALMENT);
    expect(r.taxYear.interest.cents).toBe(INTEREST);
    expect(r.taxYear.interest.rows).toHaveLength(1);
    expect(r.taxYear.loanPayments).toEqual([{ category: "mortgage", cents: INSTALMENT, count: 1 }]);
  });
});
