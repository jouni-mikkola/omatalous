/**
 * One owner per figure (ADR 0004): the usual income, the usual spending and the gate have one definition each, so every
 * view that names them shows the same number. A series' cost per year has its guard in optimise/outcome.test.ts and
 * repo rule 17.
 */
import { describe, expect, it } from "vitest";
import { spendingChange } from "../src/analysis/change.ts";
import { createContext } from "../src/analysis/context.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import { incomeBase } from "../src/analysis/income-series.ts";
import { INCOME_TYPES, incomeTypeOf, isEarnedIncome } from "../src/analysis/income.ts";
import { debtShareOf } from "../src/analysis/insights/borrowing.ts";
import { commitmentsShareOf } from "../src/analysis/insights/commitments.ts";
import { gateMonthly } from "../src/analysis/insights/shared.ts";
import { GATE_FLOOR_CENTS, gateFor, usualIncome, usualSpending } from "../src/analysis/usual.ts";
import { CATEGORIES } from "../src/categories.ts";
import { addMonths } from "../src/dates.ts";
import { situationOf } from "../src/optimise/situation.ts";
import { bufferReport } from "../src/reports/buffer.ts";
import { type Account, NO_INPUTS, type Transaction } from "../src/types.ts";
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
    expect(usualIncome(ctx, "2026-10")).toBe(300000);
  });

  it("the buffer report, the fixed costs share, debt service, the overview and the income views read the same income", () => {
    const share = commitmentsShareOf(ctx, today, NO_INPUTS).now!;
    expect(share.incomeCents).toBe(300000);
    const buffer = bufferReport(ctx, [], NO_INPUTS);
    expect(buffer.incomeMonthlyCents).toBe(share.incomeCents);
    expect(buffer.fixedMonthlyCents).toBe(share.fixedCents);
    expect(buffer.fixedShare).toBe(share.fixedCents / share.incomeCents);
    // one N in both sentences
    expect(buffer.advice).toContain(`vievät ${share.pct} % tuloista`);
    expect(debtShareOf(ctx, today, NO_INPUTS)!.incomeCents).toBe(share.incomeCents);
    expect(incomeBase(ctx, today).usualMonthlyCents).toBe(share.incomeCents);

    const bridge = buildDashboard(ctx, { from: "2026-10-01", to: "2026-10-31" }).bridge;
    expect(bridge.month).toBe("2026-09");
    expect(bridge.usualIncomeCents).toBe(share.incomeCents);
    // the month is compared like with like; the bar keeps every income row
    expect(bridge.earnedIncomeCents).toBe(300000);
    expect(bridge.totals.incomeCents).toBe(320000);

    const fact = situationOf(ctx, [], [], NO_INPUTS).find((f) => f.id === "fixed_share")!;
    expect(fact.value).toBe(buffer.fixedShare);
  });
});

describe("usual spending has one owner", () => {
  it("the forecast, the buffer report and the insights' gate read the same usual month", () => {
    const usual = usualSpending(ctx, "2026-10")!;
    expect(usual).toBeGreaterThan(0);
    expect(bufferReport(ctx, [], NO_INPUTS).usualSpendCents).toBe(usual);
    expect(buildDashboard(ctx, { from: "2026-10-01", to: "2026-10-31" }).forecast!.usualMonthCents).toBe(usual);
    expect(gateMonthly(ctx, today)).toBe(gateFor(usual));
  });
});

describe("the gate has one owner", () => {
  it("is 2 % of its base a month and never under its floor", () => {
    expect(gateFor(0)).toBe(GATE_FLOOR_CENTS);
    expect(gateFor(200000)).toBe(4000);
    expect(gateFor(200000, 5000)).toBe(5000);
  });

  it("the change sentences of a complete month pass the gate the insights use", () => {
    const change = spendingChange(ctx, "usual", "2026-09")!;
    expect(change.gateCents).toBeGreaterThan(GATE_FLOOR_CENTS);
    expect(change.gateCents).toBe(gateMonthly(ctx, "2026-09-30"));
  });
});
