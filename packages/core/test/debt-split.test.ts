/**
 * The debt service told in interest, repayments and what no evidence splits (`analysis/debt-split.ts`, ADR 0028).
 * Made-up lenders, payees and sums only.
 */
import { describe, expect, it } from "vitest";
import { bridgeView } from "../src/analysis/bridge-view.ts";
import { createContext, spendTotals } from "../src/analysis/context.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import { debtSplit } from "../src/analysis/debt-split.ts";
import { toDayRange } from "../src/analysis/period.ts";
import { totalsOf } from "../src/analysis/flows.ts";
import { cashflowReport } from "../src/reports/cashflow.ts";
import { type Account, type Loan, NO_INPUTS, type Transaction, type UserInputs } from "../src/types.ts";
import { tx } from "./helpers.ts";

const today = "2026-11-18";
const range = { from: "2026-09-01", to: "2026-11-30" };
const IBAN_CHECKING = "FI2112345600000785";
const IBAN_LOAN = "FI1410093000123458";
const LENDER = "Esimerkkirahoitus Oy";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: IBAN_CHECKING, currency: "EUR", type: "checking", bank: "Esimerkkipankki", balanceCents: 250_000 };
const loanAccount: Account = { id: "acc-2", name: "Asuntolaina", iban: IBAN_LOAN, currency: "EUR", type: "loan", bank: "Esimerkkipankki", balanceCents: -14_000_000 };

/** An annuity of 10 000 € at 6 % with 300 € a month, its balance as of the 5th of August. */
const annuity = (over: Partial<Loan> = {}): Loan => ({
  id: "loan-1", name: "Autolaina", lender: LENDER, kind: "car", grantedCents: null, balanceCents: 1_000_000, balanceDate: "2026-08-05", rateBp: 600,
  reference: null, marginBp: null, repayment: "annuity", intervalMonths: 1, paymentCents: 30_000, endDate: null, limitCents: null, seriesKey: `out:acc-1:${LENDER}`, ...over,
});
const inputs = (...loans: Loan[]): UserInputs => ({ marks: [], expectedBills: [], loans });

const instalment = (date: string, cents: number, over: Partial<Transaction> = {}) =>
  tx({ bookingDate: date, amountCents: -cents, merchant: LENDER, counterparty: LENDER.toUpperCase(), description: "Lainan lyhennys", category: "loans", categorySource: "rule", ...over });
const dues = (cents: number, over: Partial<Transaction> = {}) => ["2026-09-05", "2026-10-05", "2026-11-05"].map((d) => instalment(d, cents, over));

const split = (rows: Transaction[], input: UserInputs, accounts: Account[] = [checking]) => {
  const ctx = createContext(rows, accounts, today);
  return { ctx, split: debtSplit(ctx, range, input), debt: spendTotals(ctx, toDayRange(range)).debtCents };
};
const sum = (s: { interestCents: number; principalCents: number; unsplitCents: number }) => s.interestCents + s.principalCents + s.unsplitCents;

describe("the debt service told in its kinds", () => {
  it("splits the payments of a saved loan by its plan: the interest of each interval, the rest repays", () => {
    const w = split(dues(30_000), inputs(annuity()));
    // 50,00 + 48,75 + 47,49 of interest at 6 % on the balance that is left each month
    expect(w.split).toEqual({ interestCents: 5_000 + 4_875 + 4_749, principalCents: 25_000 + 25_125 + 25_251, unsplitCents: 0 });
    expect(sum(w.split)).toBe(w.debt);
  });

  it("leaves every payment unsplit without a saved loan", () => {
    const w = split(dues(30_000), NO_INPUTS);
    expect(w.split).toEqual({ interestCents: 0, principalCents: 0, unsplitCents: 90_000 });
    expect(w.debt).toBe(90_000);
  });

  it("changes no cash figure: Tulos, Menot and Velanhoito are the same with and without the loan", () => {
    const rows = [...dues(30_000), tx({ bookingDate: "2026-10-25", amountCents: 300_000, category: "salary", merchant: "Esimerkki Oy" })];
    const ctx = createContext(rows, [checking], today);
    const a = buildDashboard(ctx, range, [], NO_INPUTS);
    const b = buildDashboard(ctx, range, [], inputs(annuity()));
    expect(b.totals).toEqual(a.totals);
    expect(sum(b.split)).toBe(b.totals.debtCents);
    expect(cashflowReport(ctx, range, [], 24, inputs(annuity())).totals).toEqual(cashflowReport(ctx, range).totals);
  });

  it("tells the cash report's split over the rows its totals are over", () => {
    const ctx = createContext(dues(30_000), [checking], today);
    const report = cashflowReport(ctx, range, [], 24, inputs(annuity()));
    expect(sum(report.split)).toBe(report.totals.debtCents);
    expect(report.split.interestCents).toBe(5_000 + 4_875 + 4_749);
  });

  it("takes the fee a document stated as a cost, and the rest of the payment repays", () => {
    const loan = annuity({ paymentParts: [{ dueDate: "2026-08-05", principalCents: 25_000, interestCents: 5_000, feeCents: 500 }] });
    const w = split(dues(30_500), inputs(loan));
    expect(w.split.interestCents).toBe(5_000 + 500 + 4_875 + 500 + 4_749 + 500);
    expect(w.split.principalCents).toBe(25_000 + 25_125 + 25_251);
    expect(sum(w.split)).toBe(w.debt);
  });

  it("leaves a payment far from a due date unsplit", () => {
    const w = split([instalment("2026-09-20", 30_000)], inputs(annuity()));
    expect(w.split).toEqual({ interestCents: 0, principalCents: 0, unsplitCents: 30_000 });
  });

  it("leaves a payment that is not the plan's unsplit", () => {
    const w = split([instalment("2026-09-05", 45_000)], inputs(annuity()));
    expect(w.split).toEqual({ interestCents: 0, principalCents: 0, unsplitCents: 45_000 });
  });

  it("splits a payment inside the tolerance of the plan's", () => {
    const w = split([instalment("2026-09-05", 30_050)], inputs(annuity()));
    expect(w.split.interestCents).toBe(5_000);
    expect(w.split.principalCents).toBe(25_050);
  });

  it("leaves a payment unsplit when its interest would leave less than nothing to repay", () => {
    const w = split([instalment("2026-09-05", 30_000)], inputs(annuity({ balanceCents: 100_000_000 })));
    expect(w.split).toEqual({ interestCents: 0, principalCents: 0, unsplitCents: 30_000 });
  });

  it("gives one due date to its nearest payment; the other stays unsplit", () => {
    const w = split([instalment("2026-09-05", 30_000), instalment("2026-09-08", 30_000)], inputs(annuity()));
    expect(w.split).toEqual({ interestCents: 5_000, principalCents: 25_000, unsplitCents: 30_000 });
    expect(sum(w.split)).toBe(w.debt);
  });

  it("leaves a loan with no known rate unsplit", () => {
    const w = split(dues(30_000), inputs(annuity({ rateBp: null })));
    expect(w.split).toEqual({ interestCents: 0, principalCents: 0, unsplitCents: 90_000 });
  });

  it("tells a row of the category interest as interest, whole, and a card bill or collection as unsplit, whole", () => {
    const rows = [
      tx({ bookingDate: "2026-10-03", amountCents: -1_250, merchant: "Esimerkkipankki", category: "interest", categorySource: "rule" }),
      tx({ bookingDate: "2026-10-09", amountCents: -20_000, merchant: "Esimerkkikortti", category: "card_bill", categorySource: "rule" }),
      tx({ bookingDate: "2026-10-12", amountCents: -8_000, merchant: "Esimerkkiperintä Oy", category: "collection", categorySource: "rule" }),
    ];
    const w = split(rows, NO_INPUTS);
    expect(w.split).toEqual({ interestCents: 1_250, principalCents: 0, unsplitCents: 28_000 });
    expect(sum(w.split)).toBe(w.debt);
  });

  describe("a connected loan account", () => {
    const booked = (day: string, instalmentCents: number, interestCents: number): Transaction[] => [
      tx({ bookingDate: day, amountCents: -instalmentCents, merchant: "Esimerkkipankki", counterparty: "ESIMERKKIPANKKI OYJ", counterpartyIban: IBAN_LOAN, category: "mortgage", categorySource: "rule" }),
      tx({ bookingDate: day, amountCents: instalmentCents, accountId: "acc-2", merchant: "Oma tili", counterpartyIban: IBAN_CHECKING }),
      tx({ bookingDate: day, amountCents: -interestCents, accountId: "acc-2", merchant: "Esimerkkipankki", category: "interest", categorySource: "rule" }),
    ];

    it("gives the interest it booked on the day of the payment; the rest repays", () => {
      const w = split([...booked("2026-09-05", 100_000, 12_000), ...booked("2026-10-05", 100_000, 11_800)], NO_INPUTS, [checking, loanAccount]);
      expect(w.split).toEqual({ interestCents: 23_800, principalCents: 176_200, unsplitCents: 0 });
      expect(sum(w.split)).toBe(w.debt);
    });

    it("is the evidence before the plan: the booked interest holds where a saved loan reads the row too", () => {
      const rows = booked("2026-09-05", 30_000, 4_000);
      const loan = annuity({ seriesKey: "out:acc-1:Esimerkkipankki", accountId: "acc-2" });
      const w = split(rows, inputs(loan), [checking, loanAccount]);
      expect(w.split).toEqual({ interestCents: 4_000, principalCents: 26_000, unsplitCents: 0 });
    });

    it("leaves a payment unsplit on a day the account booked no interest", () => {
      const w = split(booked("2026-09-05", 100_000, 0).slice(0, 2), NO_INPUTS, [checking, loanAccount]);
      expect(w.split).toEqual({ interestCents: 0, principalCents: 0, unsplitCents: 100_000 });
    });
  });
});

describe("the bridge with the debt told in its kinds", () => {
  const totals = totalsOf([{ income: 300_000, consumption: 100_000, debt: 40_000, saved: 0, borrowed: 0 }]);

  it("reads Tulot, Kulutus, the interest, what is not split, the subtotal, the repayments and Tulos in that order", () => {
    const view = bridgeView(totals, { interestCents: 5_000, principalCents: 25_000, unsplitCents: 10_000 });
    expect(view.debtSplit).toBe(true);
    expect(view.figures.map((f) => [f.key, f.cents])).toEqual([
      ["income", 300_000],
      ["consumption", 100_000],
      ["interest", 5_000],
      ["debt", 10_000],
      ["subtotal", 185_000],
      ["principal", 25_000],
      ["left", 160_000],
    ]);
  });

  it("leaves out what is not split when nothing is, and Tulos is the same", () => {
    const view = bridgeView(totals, { interestCents: 5_000, principalCents: 35_000, unsplitCents: 0 });
    expect(view.figures.map((f) => f.key)).toEqual(["income", "consumption", "interest", "subtotal", "principal", "left"]);
    expect(view.figures.at(-1)!.cents).toBe(totals.leftCents);
  });

  it("tells the debt whole when the split tells no interest and no repayment", () => {
    const view = bridgeView(totals, { interestCents: 0, principalCents: 0, unsplitCents: 40_000 });
    expect(view.debtSplit).toBe(false);
    expect(view.figures.map((f) => f.key)).toEqual(["income", "consumption", "debt", "left"]);
    expect(view.figures.map((f) => f.key)).toEqual(bridgeView(totals).figures.map((f) => f.key));
  });

  it("adds up: the rows of the table that went out are the income less Tulos", () => {
    const view = bridgeView(totals, { interestCents: 5_000, principalCents: 25_000, unsplitCents: 10_000 });
    const out = view.rows.filter((r) => r.side === "out").reduce((s, r) => s + r.cents, 0);
    expect(totals.incomeCents - out).toBe(totals.leftCents);
  });
});
