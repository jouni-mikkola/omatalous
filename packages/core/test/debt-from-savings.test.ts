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
import type { Account, IsoDate, Loan, Transaction, UserInputs } from "../src/types.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: "FI21 1234 5600 0007 85", currency: "EUR", type: "checking" };
const savings: Account = { id: "acc-2", name: "Säästötili", iban: null, currency: "EUR", type: "savings" };
const IBAN_LOAN = "FI1410093000123458";
const loanAccount: Account = { id: "acc-3", name: "Asuntolaina", iban: IBAN_LOAN, currency: "EUR", type: "loan" };
const mortgage: Loan = {
  id: "loan-1", name: "Asuntolaina", lender: "Esimerkkipankki Oyj", kind: "mortgage", grantedCents: null, balanceCents: 10_000_000, balanceDate: "2026-10-01", rateBp: 400,
  reference: null, marginBp: null, repayment: "annuity", intervalMonths: 1, paymentCents: 40_000, endDate: null, limitCents: null, seriesKey: null, accountId: "acc-3",
};
const saved: UserInputs = { marks: [], expectedBills: [], loans: [mortgage] };
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
  fromSavings("2026-10-08", INTEREST, { category: "interest", counterpartyIban: IBAN_LOAN }),
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

    // the interest counts on the sheet as it pays a saved home loan, whichever account paid it
    const withLoan = createContext(rows, [checking, savings, loanAccount], today);
    const r = buildReports({ ctx: withLoan, range, balances: [], inputs: saved }, ["spendingMonths", "taxYear"]);
    expect(r.spendingMonths.totalCents).toBe(d.totals.expenseCents + INTEREST + INSTALMENT);
    expect(r.taxYear.interest.cents).toBe(INTEREST);
    expect(r.taxYear.interest.rows).toHaveLength(1);
    expect(r.taxYear.loanPayments).toEqual([{ category: "mortgage", cents: INSTALMENT, count: 1 }]);
  });

  it("is no part of the first page's Menot, which are the bridge's spending, so its tiles add up to Tulos", () => {
    const d = buildDashboard(ctx, range);
    const month = d.overview.months.at(-1)!;
    expect(month.month).toBe("2026-10");
    // the Menot tile and the month's bar are the bridge's spending
    expect(month.spendCents).toBe(d.totals.expenseCents);
    expect(month.spendCents).toBe(20_000);
    // income less spending less what went to savings is Tulos
    expect(month.incomeCents).toBe(d.totals.incomeCents);
    expect(month.incomeCents! - month.spendCents! - d.totals.savedCents).toBe(d.totals.leftCents);
    expect(month.incomeCents! - month.spendCents!).toBe(d.totals.netCents);
    // the categories hold the debt paid from savings, so the first page names it beside them
    const { rows: top, otherCents, totalCents, fromSavingsCents } = d.overview.categories;
    expect(totalCents).toBe(month.spendCents);
    expect(fromSavingsCents).toBe(INTEREST + INSTALMENT);
    expect(top.reduce((sum, c) => sum + c.cents, 0) + otherCents).toBe(totalCents + fromSavingsCents);
    expect(month.fromSavingsCents).toBe(fromSavingsCents);
  });

  it("is named in the spending by month, whose sum less it is the first page's Menot", () => {
    const { spendingMonths } = buildReports({ ctx, range, balances: [] }, ["spendingMonths"]);
    const month = buildDashboard(ctx, range).overview.months.at(-1)!;
    expect(spendingMonths.fromSavingsCents).toBe(INTEREST + INSTALMENT);
    expect(spendingMonths.totals.at(-1)! - spendingMonths.fromSavings.at(-1)!).toBe(month.spendCents);
  });

  it("leaves a household with none with a zero to show nothing for", () => {
    const plain = createContext(rows.filter((t) => t.accountId !== "acc-2" || t.isTransfer), [checking, savings], today);
    expect(buildDashboard(plain, range).overview.categories.fromSavingsCents).toBe(0);
    expect(buildReports({ ctx: plain, range, balances: [] }, ["spendingMonths"]).spendingMonths.fromSavingsCents).toBe(0);
  });
});
