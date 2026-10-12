/**
 * One owner per figure (ADR 0004): the usual income, the usual spending and the gate have one definition each, so every
 * view that names them shows the same number. A series' cost per year has its guard in optimise/outcome.test.ts and
 * repo rule 17. The debt total has one list (`householdDebts`) behind the Lainat report, net worth and the loan area
 * of Säästövinkit, and a loan's figures are those of loans.ts.
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
import { addDays, addMonths } from "../src/dates.ts";
import { householdDebts } from "../src/household-debts.ts";
import { loanBalanceOn, loanInterestNext12Months, loanPayoffDate, loanRateScenario } from "../src/loans.ts";
import { loans as loanArea } from "../src/optimise/areas/loans.ts";
import { eur, pct } from "../src/optimise/common.ts";
import { areaInputOf } from "../src/optimise/index.ts";
import { situationOf } from "../src/optimise/situation.ts";
import { bufferReport } from "../src/reports/buffer.ts";
import { buildReports } from "../src/reports/index.ts";
import { type Account, type Loan, NO_INPUTS, type Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";
import { FRAME, householdInput, joinHousehold, type PartHousehold } from "./optimise/household.ts";
import * as loansPart from "./optimise/parts/loans.ts";

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

  it("Kuukausi says one usual total per month: the forecast, the pace chart and the change report, a running month on its days so far", () => {
    // a dinner and a coat now and then: each median is nothing, yet most months have one, so the usual month is more
    // than the sum of the categories' levels
    const sparse = [
      ...monthlyOn(18, (i) => (i % 3 === 0 ? -9000 : 0), { category: "restaurants", merchant: "Ravintola" }),
      ...monthlyOn(7, (i) => (i % 3 === 1 ? -9000 : 0), { category: "shopping", merchant: "Vaatekauppa" }),
    ];
    const c = createContext([...household, ...sparse], [checking], today);
    const september = spendingChange(c, "usual", "2026-09")!;
    expect(september.baseCents).toBe(usualSpending(c, "2026-09"));
    const levels = september.categories.filter((r) => r.kind === "category").reduce((s, r) => s + r.baseCents, 0);
    const smaller = september.categories.find((r) => r.kind === "smaller");
    expect(levels + (smaller?.baseCents ?? 0)).toBe(september.baseCents);
    // the case this guards: the categories' own levels leave part of the usual month to Muut
    expect(september.pieces.some((p) => p.category === null && p.kind === "spread")).toBe(true);

    const d = buildDashboard(c, { from: "2026-10-01", to: today });
    const october = spendingChange(c, "usual", "2026-10")!;
    expect(october.running).toBe(true);
    expect(d.pace.usualAtToday).toBe(usualSpending(c, "2026-10", 9));
    expect(october.baseCents).toBe(d.pace.usualAtToday);
    expect(d.pace.usualMonthTotal).toBe(d.forecast!.usualMonthCents);
    expect(d.forecast!.usualMonthCents).toBe(usualSpending(c, "2026-10"));
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

const loan = (p: Partial<Loan> & Pick<Loan, "id" | "kind" | "balanceCents">): Loan => ({
  name: p.id, lender: null, grantedCents: null, balanceDate: "2026-10-01", rateBp: null, reference: null, marginBp: null, repayment: null, intervalMonths: null, paymentCents: null, endDate: null, limitCents: null, seriesKey: null, ...p,
});

/** A part on the base as the server hands it over. `joinHousehold` joins marks and bills only, so the part's loans are put back. */
const withLoans = (part: PartHousehold) => {
  const h = joinHousehold([part]);
  return { h, input: householdInput({ ...h, inputs: { ...h.inputs, loans: part.inputs?.loans ?? [] } }) };
};

describe("the debt total has one owner", () => {
  // The loans part's household with its mortgage saved 200 days ago, so the balance today is the plan's and not the
  // stated one, the card a connected account, and a connected loan account that owes an amount with cents.
  const part = loansPart.savedMortgage(FRAME, { balanceDate: addDays(FRAME.today, -200) });
  const carLoan = { id: "h-car-loan", name: "Autolaina", type: "loan" as const, balanceCents: -812345, ownerName: null, balanceAt: null };
  const { h, input } = withLoans({ ...part, balances: [...part.balances!, carLoan] });
  const mortgage = input.inputs!.loans![0]!;
  const reports = buildReports({ ctx: input.ctx, range: { from: "2026-01-01", to: FRAME.today }, balances: input.balances, inputs: input.inputs });
  const area = loanArea.assess(areaInputOf(input));
  const calc = (kind: string, label: string) => area.findings.find((f) => f.kind === kind)?.calc.find((c) => c.label === label)?.value;

  it("the Lainat report, the accounts less the debts and the loan area of Säästövinkit tell one number", () => {
    const owed = loanBalanceOn(mortgage, FRAME.today).cents!;
    // a view that read the stated balance would be whole euros off, which the euro text of the area shows too
    expect(mortgage.balanceCents - owed).toBeGreaterThan(100000);
    const debts = householdDebts(input.balances, input.inputs!, FRAME.today);
    expect(debts.total.cents).toBe(owed + 120000 + 812345);
    expect(reports.loans.total.cents).toBe(debts.total.cents);
    expect(reports.balances.debt).toEqual({ day: FRAME.today, cents: debts.total.cents, savedCents: owed });
    expect(reports.balances.accountsLessDebt.at(-1)).toBe(reports.balances.total.at(-1)! - owed);
    expect(area.summary?.lines[0]).toEqual({ label: "Velkaa yhteensä", value: eur(debts.total.cents) });
    expect(reports.loans.interest).toEqual(debts.interest);
    // the card and the loan account have no rate: both views read the one count of the loans left out for it
    expect(reports.loans.withoutRate).toBe(2);
    expect(area.summary?.lines[1]).toEqual({ label: "Korot 12 kuukaudessa (ilman 2 lainaa, joiden korkoa ei tiedetä)", value: eur(debts.interest.cents) });
    // the loan account may be the saved mortgage: both stay in the sums, and both pages say so
    expect(reports.loans.maybeTwice).toEqual([{ loans: [{ id: mortgage.id, name: mortgage.name }], accounts: [{ id: carLoan.id, name: "Autolaina" }] }]);
    expect(area.summary?.lines[2]).toEqual({ label: "Sama velka voi olla summassa kahdesti", value: "katso Raportit > Lainat" });
  });

  it("a loan whose balance is dated after today is not left out for its rate, and an overdraft is not twice in the debt total", () => {
    const later = loan({ id: "later", kind: "consumer", balanceCents: 500000, rateBp: 500, balanceDate: addDays(FRAME.today, 20) });
    const bare = loan({ id: "bare", kind: "consumer", balanceCents: 100000 });
    const line = loan({ id: "line", kind: "credit_line", balanceCents: 50000, rateBp: 900 });
    const overdrawn = { id: "h-overdrawn", name: "Toinen tili", type: "checking" as const, balanceCents: -50000, ownerName: null, balanceAt: null };
    // without the connected card, which would stand beside the credit line
    const balances = [...part.balances!.filter((b) => b.type !== "credit_card"), overdrawn];
    const more = withLoans({ ...part, balances, inputs: { ...part.inputs!, loans: [...part.inputs!.loans!, later, bare, line] } }).input;
    const lines = loanArea.assess(areaInputOf(more)).summary!.lines;
    // one loan has no rate, and the one dated after today has
    expect(lines[1]!.label).toBe("Korot 12 kuukaudessa (ilman yhtä lainaa, jonka korkoa ei tiedetä)");
    // the overdraft beside the credit line is twice in the accounts less the debts, which this summary does not tell
    expect(buildReports({ ctx: more.ctx, range: { from: "2026-01-01", to: FRAME.today }, balances: more.balances, inputs: more.inputs }).loans.overdraftTwice).toHaveLength(1);
    expect(lines).toHaveLength(2);
  });

  it("a saved mortgage answers for the loan rate: nothing is asked, and the balance and the rate are the saved loan's", () => {
    expect(h.values.loan_rate).toBeUndefined();
    expect(area.checks.map((c) => `${c.id} ${c.status}`)).toEqual(["loans:margin finding", "loans:prepay finding", "loans:card_interest finding"]);
    const row = reports.loans.loans.find((l) => l.id === mortgage.id)!;
    expect(calc("margin", "Lainan saldo")).toBe(eur(row.balance.cents!));
    expect(calc("margin", "Oma marginaali")).toBe(pct(mortgage.marginBp! / 10_000));
    expect(calc("prepay", "Lainan saldo")).toBe(eur(row.balance.cents!));
    // the saved rate, not a range of Euribor months
    expect(calc("prepay", "Lainan korko")).toBe(pct(mortgage.rateBp! / 10_000));
    expect(calc("prepay", "Marginaali")).toBeUndefined();
    expect(area.findings.find((f) => f.kind === "prepay")).toMatchObject({ weaknesses: [], facts: [] });
  });

  it("without a margin the saved mortgage leaves the question, and without saved loans the area is as it was", () => {
    const bare = withLoans(loansPart.savedMortgage(FRAME, { marginBp: null, reference: null })).input;
    expect(loanArea.assess(areaInputOf(bare)).checks.slice(0, 2)).toMatchObject([{ status: "needs_input", input: "loan_rate" }, { status: "needs_input", input: "loan_rate" }]);
    // no loan account beside the saved mortgage: nothing can be there twice, and the summary has its two lines
    expect(loanArea.assess(areaInputOf(bare)).summary?.lines).toHaveLength(2);
    // a saved fixed rate needs no margin: it is neither compared nor prepaid, and nothing is asked
    const fixed = withLoans(loansPart.savedMortgage(FRAME, { marginBp: null, reference: "fixed" })).input;
    expect(loanArea.assess(areaInputOf(fixed)).checks.slice(0, 2).map((c) => `${c.id} ${c.status}`)).toEqual(["loans:margin clear", "loans:prepay clear"]);
    const plain = loanArea.assess(areaInputOf(householdInput(joinHousehold([loansPart.hit(FRAME)]))));
    expect(plain.summary).toBeUndefined();
    expect(plain.findings.find((f) => f.kind === "prepay")?.weaknesses.map((w) => w.id)).toEqual(["estimate"]);
  });
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
