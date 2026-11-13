/**
 * The tiles of Yhteenveto (`overview.ts`): the month's income against the usual month's is one quantity on both sides,
 * and the month's change of what the household has net is the rows of the month on the accounts, less what the saved
 * loans no account holds moved. Made-up households only.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import { expectedIncome } from "../src/analysis/expected.ts";
import { earnedIncome } from "../src/analysis/usual.ts";
import { addMonthsToDate, dayNumber } from "../src/dates.ts";
import { explain } from "../src/explain/explain.ts";
import { explainNow } from "../src/explain/now.ts";
import { buildHoldings } from "../src/holdings.ts";
import { loanBalanceOn } from "../src/loans.ts";
import { buildOverview } from "../src/overview.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import { accountsLessDebtOn } from "../src/reports/balances.ts";
import type { BalanceInput, Loan, UserInputs } from "../src/types.ts";
import { ACCOUNTS, randomHistory } from "./gen.ts";

const ON = "2025-10-20";
const input = (id: string, name: string, type: BalanceInput["type"], balanceCents: number | null): BalanceInput => ({ id, name, type, balanceCents, ownerName: null, balanceAt: null });
const inputsOf = (loans: Loan[]): UserInputs => ({ marks: [], expectedBills: [], loans });
const typedLoan: Loan = {
  id: "car", name: "Autolaina", lender: null, kind: "consumer", grantedCents: 1_200_000, balanceCents: 900_000, balanceDate: "2025-08-01", rateBp: 500, reference: null, marginBp: null,
  repayment: "annuity", intervalMonths: 1, paymentCents: 30_000, endDate: null, limitCents: null, seriesKey: null,
};

function household(seed: number) {
  const { txs, accounts, rules } = randomHistory(seed, 400, { settled: true });
  const ctx = createContext(enrichTransactions(txs, accounts, rules), accounts, ON);
  // the loan account has no rows, so the walk knows it only from today on: it has no balance here
  const balances = ACCOUNTS.map((a) => input(a.id, a.name, a.type, a.type === "credit_card" ? -45_000 : a.type === "loan" ? null : 250_000));
  return { ctx, balances };
}

describe("the tiles' figures", () => {
  it("the change of the net is the month's rows on the accounts, less what a typed loan moved, on every seeded household", () => {
    const since = addMonthsToDate(ON, -1);
    const problems: string[] = [];
    for (let seed = 1; seed <= 12; seed++) {
      const { ctx, balances } = household(seed);
      const moved = ctx.txs.filter((t) => t.day > dayNumber(since) && t.day <= ctx.todayDay).reduce((s, t) => s + t.amountCents, 0);
      const plain = buildOverview(ctx, balances, inputsOf([])).net;
      if (plain?.since !== since || plain.changeCents !== moved) problems.push(`${seed}: ${JSON.stringify(plain)} against ${moved}`);
      // a typed loan paid down in the month makes the net grow by what it fell
      const fell = loanBalanceOn(typedLoan, since).cents! - loanBalanceOn(typedLoan, ON).cents!;
      const withLoan = buildOverview(ctx, balances, inputsOf([typedLoan])).net;
      if (withLoan?.changeCents !== moved + fell) problems.push(`${seed}: with the loan ${withLoan?.changeCents} against ${moved + fell}`);
      // today's end of the change is the tile's own figure
      const inputs = inputsOf([typedLoan]);
      if (accountsLessDebtOn(ctx, balances, inputs, ON) !== buildHoldings(ctx, balances, inputs).netCents) problems.push(`${seed}: today against holdings`);
    }
    expect(problems).toEqual([]);
  }, 30_000);

  it("the change is not known when an account has no balance a month ago", () => {
    const { ctx, balances } = household(3);
    // an account whose first row is today is not known a month ago
    const fresh = createContext([...ctx.txs], [...ctx.accounts, { id: "new", name: "Uusi", iban: null, currency: "EUR", type: "checking" }], ON);
    expect(buildOverview(fresh, [...balances, input("new", "Uusi", "checking", 1_000)], inputsOf([])).net).toBeNull();
  }, 30_000);

  // the tiles of what is left and of the spending open the panel of these figures: its rows add up to the tile's own sum
  it("the panels the tiles open hold the tiles' figures, on every seeded household", () => {
    const problems: string[] = [];
    let known = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const { ctx, balances } = household(seed);
      const d = buildDashboard(ctx, { from: "2025-10-01", to: "2025-10-31" }, balances, inputsOf([]));
      const spent = d.home.pace?.spentCents ?? d.nyt!.pace.spentCents;
      const panel = explain("spend.month", ctx, { view: "own", range: { from: "2025-10-01", to: d.nyt!.from } }).cents;
      if (panel !== spent) problems.push(`${seed}: spending ${panel} against ${spent}`);
      const left = d.nyt!.left;
      if (left.known) known++;
      if (left.known && explainNow("ahead.free", ctx, balances, inputsOf([])).explanation.cents !== left.leftCents) problems.push(`${seed}: left`);
    }
    expect(problems).toEqual([]);
    expect(known).toBeGreaterThan(0);
  }, 30_000);

  it("the income of the month and the usual month are the earned income on both sides", () => {
    const { ctx, balances } = household(5);
    const { income } = buildDashboard(ctx, { from: "2025-10-01", to: "2025-10-31" }, balances, inputsOf([])).overview;
    expect(income).toEqual({ cents: earnedIncome(ctx, "2025-10"), usualCents: expectedIncome(ctx, "2025-10") });
    expect(income.usualCents).not.toBeNull();
  }, 30_000);
});
