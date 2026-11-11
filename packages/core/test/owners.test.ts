/**
 * One owner per figure (ADR 0004): the usual income, the usual spending and the gate have one definition each, so every
 * view that names them shows the same number. The debt total has one list (`householdDebts`) behind the Lainat report and net worth, and a loan's figures are those of loans.ts.
 */
import { describe, expect, it } from "vitest";
import { spendingChange } from "../src/analysis/change.ts";
import { createContext } from "../src/analysis/context.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import { incomeBase } from "../src/analysis/income-series.ts";
import { INCOME_TYPES, incomeTypeOf, isEarnedIncome } from "../src/analysis/income.ts";
import { debtShareOf } from "../src/analysis/insights/borrowing.ts";
import { gateMonthly } from "../src/analysis/insights/shared.ts";
import { expectedIncome, expectedSpending } from "../src/analysis/expected.ts";
import { gateFor } from "../src/analysis/usual.ts";
import { GATE_FLOOR_CENTS } from "../src/thresholds.ts";
import { CATEGORIES } from "../src/categories.ts";
import { addDays, addMonths } from "../src/dates.ts";
import { loanInterestNext12Months, loanPayoffDate, loanRateScenario } from "../src/loans.ts";
import { fixedShareOn } from "../src/analysis/fixed-share.ts";
import { bufferReport } from "../src/reports/buffer.ts";
import { type Account, type Loan, NO_INPUTS, type Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const today = "2026-10-09";

function monthlyOn(day: number, amount: (i: number) => number, partial: Partial<Transaction>): Transaction[] {
  return Array.from({ length: 14 }, (_, i) => tx({ ...partial, bookingDate: `${addMonths("2025-09", i)}-${String(day).padStart(2, "0")}`, amountCents: amount(i) })).filter(
    (t) => t.bookingDate <= today && t.amountCents !== 0,
  );
}

/**
 * Pay 3 000 € a month, 200 € a month by MobilePay from a partner and a refund every second month: earned income is
 * 3 000 €, all income 3 200 € or more. Rent and a loan are the fixed costs.
 */
const household = [
  ...monthlyOn(25, () => 300000, { category: "salary", merchant: "Acme Oy" }),
  ...monthlyOn(15, () => 20000, { category: "p2p_in", merchant: "Maija Meikäläinen" }),
  ...monthlyOn(20, (i) => (i % 2 ? 8000 : 0), { category: "reimbursements", merchant: "Verkkokauppa.com" }),
  ...monthlyOn(2, () => -105000, { category: "housing", merchant: "Sato Oyj" }),
  ...monthlyOn(10, () => -40000, { category: "loans", merchant: "Nordea Rahoitus" }),
  ...monthlyOn(12, (i) => -48000 - (i % 3) * 1500, { category: "groceries", merchant: "K-Market" }),
];
const ctx = createContext(household, [checking], today);

describe("usual income has one owner", () => {
  it("leaves out money from people and refunds by the income report's own split", () => {
    for (const c of CATEGORIES.filter((c) => c.kind === "income")) {
      const row = { category: c.id, merchant: "Maksaja", counterparty: null, description: null, amountCents: 10000, flows: { consumption: 0, debt: 0, saved: 0, income: 10000, borrowed: 0 } };
      expect(isEarnedIncome(row), c.id).toBe(INCOME_TYPES[incomeTypeOf(row)].earned);
    }
    expect(expectedIncome(ctx, "2026-10")).toBe(300000);
  });

  it("the buffer report, the fixed costs share, debt service, the overview and the income views read the same income", () => {
    const buffer = bufferReport(ctx, [], NO_INPUTS);
    const share = { incomeCents: buffer.incomeMonthlyCents! };
    expect(share.incomeCents).toBe(300000);
    expect(debtShareOf(ctx, today, NO_INPUTS)!.incomeCents).toBe(share.incomeCents);
    expect(incomeBase(ctx, today).usualMonthlyCents).toBe(share.incomeCents);

    const bridge = buildDashboard(ctx, { from: "2026-10-01", to: "2026-10-31" }).bridge;
    expect(bridge.month).toBe("2026-09");
    // the bar keeps every income row
    expect(bridge.totals.incomeCents).toBe(320000);

    // the commitments insight's share of today is the same share, under the words of the same label
    expect(fixedShareOn(ctx, today, NO_INPUTS)).toEqual({ fixedMonthlyCents: buffer.fixedMonthlyCents, incomeMonthlyCents: 300000, fixedShare: buffer.fixedShare, fixedShareLabel: buffer.fixedShareLabel });
    expect(buffer.fixedShareLabel).toBe("Kiinteät menot tavallisista tuloista, viimeiset 6 kuukautta");
  });
});

describe("the shares of the usual income name their months", () => {
  it("with four complete months the fixed costs and the debt service say four", () => {
    // the history starts in June: June to September are complete before October
    const c = createContext(household.filter((t) => t.bookingDate >= "2026-06-01"), [checking], today);
    const buffer = bufferReport(c, [], NO_INPUTS);
    expect(buffer.fixedShare).not.toBeNull();
    expect(buffer.fixedShareLabel).toBe("Kiinteät menot tavallisista tuloista, viimeiset 4 kuukautta");
  });
});

describe("usual spending has one owner", () => {
  it("the buffer report and the insights' gate read the same usual month", () => {
    const usual = expectedSpending(ctx, "2026-10")!;
    expect(usual).toBeGreaterThan(0);
    expect(bufferReport(ctx, [], NO_INPUTS).expectedSpendCents).toBe(usual);
    expect(gateMonthly(ctx, today)).toBe(gateFor(usual));
  });

  it("Yhteenveto says one usual total per month: the change report's, a running month on its days so far", () => {
    // a dinner and a coat now and then: a median of each is nothing, yet the expected month holds them; the headline is
    // the sum of the categories' expected figures, so nothing is left over
    const sparse = [
      ...monthlyOn(18, (i) => (i % 3 === 0 ? -9000 : 0), { category: "restaurants", merchant: "Ravintola" }),
      ...monthlyOn(7, (i) => (i % 3 === 1 ? -9000 : 0), { category: "shopping", merchant: "Vaatekauppa" }),
    ];
    const c = createContext([...household, ...sparse], [checking], today);
    const september = spendingChange(c, "expected", "2026-09")!;
    expect(september.baseCents).toBe(expectedSpending(c, "2026-09"));
    const levels = september.categories.filter((r) => r.kind === "category").reduce((s, r) => s + r.baseCents, 0);
    const smaller = september.categories.find((r) => r.kind === "smaller");
    expect(levels + (smaller?.baseCents ?? 0)).toBe(september.baseCents);
    // the case this guards: the categories' own levels leave no part of the expected month to Muut
    expect(september.pieces.some((p) => p.category === null && p.kind === "spread")).toBe(false);

    const october = spendingChange(c, "expected", "2026-10")!;
    expect(october.running).toBe(true);
    expect(october.baseCents).toBe(expectedSpending(c, "2026-10", 9));
  });
});

describe("the gate has one owner", () => {
  it("is 2 % of its base a month and never under its floor", () => {
    expect(gateFor(0)).toBe(GATE_FLOOR_CENTS);
    expect(gateFor(200000)).toBe(4000);
    expect(gateFor(200000, 5000)).toBe(5000);
  });

  it("the change sentences of a complete month pass the gate the insights use", () => {
    const change = spendingChange(ctx, "expected", "2026-09")!;
    expect(change.gateCents).toBeGreaterThan(GATE_FLOOR_CENTS);
    expect(change.gateCents).toBe(gateMonthly(ctx, "2026-09-30"));
  });
});

const loan = (p: Partial<Loan> & Pick<Loan, "id" | "kind" | "balanceCents">): Loan => ({
  name: p.id, lender: null, grantedCents: null, balanceDate: "2026-10-01", rateBp: null, reference: null, marginBp: null, repayment: null, intervalMonths: null, paymentCents: null, endDate: null, limitCents: null, seriesKey: null, ...p,
});

describe("a move in the reference rate reads the loan's own plan", () => {
  const day = "2026-10-09";
  const home = loan({ id: "home", kind: "mortgage", balanceCents: 12000000, rateBp: 400, reference: "euribor_12", marginBp: 60, repayment: "annuity", intervalMonths: 1, paymentCents: 100000 });
  const car = loan({ id: "car", kind: "car", balanceCents: 1200000, rateBp: 600, reference: "euribor_3", repayment: "equal_principal", intervalMonths: 1, paymentCents: 50000 });

  it("changes nothing at zero, costs more up and less down", () => {
    const base = loanInterestNext12Months(home, day).cents!;
    expect(loanRateScenario(home, day, 0)).toEqual({ shiftBp: 0, movedBp: 0, rateBp: 400, paymentCents: 100000, interestCents: base, unknown: null });
    const [down, up] = [loanRateScenario(home, day, -100), loanRateScenario(home, day, 100)];
    expect([down.rateBp, up.rateBp]).toEqual([300, 500]);
    expect(down.paymentCents!).toBeLessThan(100000);
    expect(up.paymentCents!).toBeGreaterThan(100000);
    expect(down.interestCents!).toBeLessThan(base);
    expect(up.interestCents!).toBeGreaterThan(base);
    // the new annuity ends the loan on the due date the old one did
    expect(loanPayoffDate({ ...home, rateBp: 500, paymentCents: up.paymentCents })).toMatchObject({ date: loanPayoffDate(home).date });
  });

  it("equal principal pays its interest on top, a fixed instalment keeps its payment, and what is missing is named", () => {
    // 500 € and a month of 7 % on 12 000 €
    expect(loanRateScenario(car, day, 100)).toMatchObject({ rateBp: 700, paymentCents: 57000, unknown: null });
    expect(loanRateScenario(car, day, 0).interestCents).toBe(loanInterestNext12Months(car, day).cents);
    const fixed = loanRateScenario({ ...home, repayment: "fixed_instalment" }, day, 100);
    expect(fixed.paymentCents).toBe(100000);
    expect(fixed.interestCents!).toBeGreaterThan(loanRateScenario(home, day, 100).interestCents!);
    // a rate falls at most to its margin, to zero without one; a loan without a plan keeps its balance, so a year at 5 % on 10 000 € is 500 €
    expect(loanRateScenario(car, day, -900)).toMatchObject({ rateBp: 0, movedBp: -600 });
    expect(loanRateScenario(home, day, -900)).toMatchObject({ rateBp: 60, movedBp: -340 });
    expect(loanRateScenario(loan({ id: "line", kind: "credit_line", balanceCents: 1000000, rateBp: 400, reference: "euribor_3" }), day, 100)).toEqual({ shiftBp: 100, movedBp: 100, rateBp: 500, paymentCents: null, interestCents: 50000, unknown: "repayment" });
    expect(loanRateScenario(loan({ id: "card", kind: "card", balanceCents: 124000 }), day, 100)).toMatchObject({ paymentCents: null, interestCents: null, unknown: "rate" });
    // 300 € a month does not cover the interest and the loan has no last due date: no new payment can be told
    expect(loanRateScenario({ ...home, paymentCents: 30000 }, day, 100)).toMatchObject({ paymentCents: null, interestCents: null, unknown: "end_date" });
    expect(loanRateScenario(home, addDays(home.balanceDate, -1), 100)).toMatchObject({ interestCents: null, unknown: "before_balance_date" });
  });
});
