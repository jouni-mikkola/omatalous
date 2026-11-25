/**
 * The Lainat report on the inputs of its review: each case is a figure that was told wrong. Made-up loans only.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { debtPaymentsPerMonth, debtTotalOn, loanBalanceOn, loanInterestNext12Months, loanNextPayment, loanRateScenario } from "../src/loans.ts";
import type { BalanceInput } from "../src/reports/balances.ts";
import { monthlyPayments } from "../src/reports/loans.ts";
import { buildReports } from "../src/reports/index.ts";
import type { Account, Loan } from "../src/types.ts";
import { tx } from "./helpers.ts";

const today = "2026-10-09";
const account = (id: string, name: string, type: Account["type"]): Account => ({ id, name, iban: null, currency: "EUR", type });
const checking = account("acc-1", "Käyttötili", "checking");
const loan = (p: Partial<Loan> & Pick<Loan, "id" | "balanceCents">): Loan => ({
  name: p.id, lender: null, kind: "consumer", grantedCents: null, balanceDate: "2026-10-01", rateBp: null, reference: null, marginBp: null, repayment: null, intervalMonths: null, paymentCents: null, endDate: null, limitCents: null, seriesKey: null, ...p,
});
const annuity = (p: Partial<Loan> & Pick<Loan, "id" | "balanceCents" | "paymentCents">): Loan => loan({ rateBp: 500, repayment: "annuity", intervalMonths: 1, ...p });

/** The reports of a household with these loans and connected accounts (cents, as the bank tells them). */
function run(loans: Loan[], connected: [Account, number][] = [[checking, 200000]]) {
  const balances = connected.map(([a, balanceCents]): BalanceInput => ({ id: a.id, name: a.name, type: a.type, balanceCents, ownerName: null, balanceAt: null }));
  const ctx = createContext([tx({ bookingDate: "2026-09-03", amountCents: -50000 })], connected.map(([a]) => a), today);
  return buildReports({ ctx, range: { from: "2026-08-01", to: today }, balances, inputs: { marks: [], expectedBills: [], loans } });
}

describe("a payment is never more than what is owed with its interest", () => {
  it("a loan that owes nothing has no payment and is out of the payments of a month", () => {
    // 300 € on 1.1.2026 at 5 %, 200 € a month: paid on 1.3.2026
    const paid = annuity({ id: "paid", balanceCents: 30000, balanceDate: "2026-01-01", paymentCents: 20000 });
    // a balance typed as zero, and a last due date that has passed
    const zero = annuity({ id: "zero", balanceCents: 0, paymentCents: 20000 });
    const ended = annuity({ id: "ended", balanceCents: 30000, balanceDate: "2026-01-01", paymentCents: 1000, endDate: "2026-06-01" });
    const r = run([paid, zero, ended]).loans;
    for (const row of r.loans) {
      expect(row.balance.cents, row.id).toBe(0);
      expect(row.payment, row.id).toEqual({ cents: null, interestCents: null, amortisationCents: null, intervalMonths: 1, unknown: null, date: null });
    }
    expect(r.loans[0]!.payoff.date).toBe("2026-03-01");
    expect(r.payments).toEqual({ monthlyCents: 0, counted: 0, unknown: 0, bullets: 0 });
  });

  it("the last payment is what is left with its interest, in the row, in the sum and after a move of the rate", () => {
    // 150 € at 5 % against 1 000 € a month: a month's interest is 62,5 cents, a half cent up
    const last = annuity({ id: "last", balanceCents: 15000, paymentCents: 100000, reference: "euribor_12" });
    const r = run([last]).loans;
    expect(r.loans[0]!.payment).toEqual({ cents: 15063, interestCents: 63, amortisationCents: 15000, intervalMonths: 1, unknown: null, date: "2026-11-01" });
    expect(r.payments).toEqual({ monthlyCents: 15063, counted: 1, unknown: 0, bullets: 0 });
    expect(r.loans[0]!.scenarios.map((s) => [s.rateBp, s.paymentCents])).toEqual([[400, 15050], [600, 15075]]);
    // the scenario reads the same payment as the row when nothing moves
    expect(loanRateScenario(last, today, 0).paymentCents).toBe(loanNextPayment(last, today).cents);
  });

  it("a payment less often than monthly is spread over its interval, each loan's share to the nearest cent, a half up", () => {
    // 100,01 € of amortisation a quarter with 83,25 € of interest: 183,26 / 3 = 61,0867
    const quarterly = loan({ id: "q", balanceCents: 666000, rateBp: 500, repayment: "equal_principal", intervalMonths: 3, paymentCents: 10001 });
    expect(loanNextPayment(quarterly, today)).toMatchObject({ cents: 18326, interestCents: 8325, amortisationCents: 10001 });
    expect(debtPaymentsPerMonth([quarterly], today).monthlyCents).toBe(6109);
    // 0,25 € every second month is 12,5 cents a month: 13
    expect(debtPaymentsPerMonth([loan({ id: "half", balanceCents: 100000, rateBp: 0, repayment: "annuity", intervalMonths: 2, paymentCents: 25 })], today).monthlyCents).toBe(13);
  });
});

describe("a typed payment without a plan", () => {
  it("an annuity without an interval tells its payment and no interval", () => {
    const r = run([annuity({ id: "no-interval", balanceCents: 300000, paymentCents: 20000, intervalMonths: null })]).loans;
    expect(r.loans[0]!.payment).toEqual({ cents: 20000, interestCents: null, amortisationCents: null, intervalMonths: null, unknown: "interval", date: null });
    // no interval, no share of a month: the sum says the loan is missing
    expect(r.payments).toEqual({ monthlyCents: 0, counted: 0, unknown: 1, bullets: 0 });
  });

  it("a card and a credit line count the payment typed for them, at most what is owed with its interest", () => {
    const card = loan({ id: "card", kind: "card", balanceCents: 124000, paymentCents: 5000, intervalMonths: 1 });
    const line = loan({ id: "line", kind: "credit_line", balanceCents: 3000, rateBp: 1200, paymentCents: 5000, intervalMonths: 1 });
    const bare = loan({ id: "bare", kind: "card", balanceCents: 50000 });
    const r = run([card, line, bare]).loans;
    expect(r.loans.map((l) => [l.payment.cents, l.payment.unknown])).toEqual([[5000, "repayment"], [3030, null], [null, "repayment"]]);
    expect(r.payments).toEqual({ monthlyCents: 8030, counted: 2, unknown: 1, bullets: 0 });
  });

  it("a card with a typed payment and rate owes what its plan leaves, in the row and in the debt total, as the drill counts it", () => {
    // 1 000 € at 18 % on 1.1.2026, 50 € a month: 819,67 € after the fifth payment (see loanBalanceByPlan), 15.6.2026
    const card = loan({ id: "card", kind: "card", balanceCents: 100000, balanceDate: "2026-01-15", rateBp: 1800, paymentCents: 5000, intervalMonths: 1 });
    const bare = loan({ id: "bare", kind: "card", balanceCents: 50000, balanceDate: "2026-01-15" });
    const day = "2026-06-15";
    expect(loanBalanceOn(card, day)).toEqual({ cents: 81967, unknown: null });
    expect(loanBalanceOn(card, "2026-01-15")).toEqual({ cents: 100000, unknown: null });
    // no payment typed: the stated balance stays, and it says the repayment is missing
    expect(loanBalanceOn(bare, day)).toEqual({ cents: 50000, unknown: "repayment" });
    expect(debtTotalOn([card, bare], day).cents).toBe(81967 + 50000);
    // the plan ends the loan: a payment of 1 000 € clears it, and nothing is owed after its last day
    expect(loanBalanceOn(loan({ id: "clears", kind: "credit_line", balanceCents: 30000, balanceDate: "2026-01-15", rateBp: 1200, paymentCents: 100000, intervalMonths: 1 }), day)).toEqual({ cents: 0, unknown: null });
  });

  it("a payment that does not cover the interest leaves the stated balance, and the interest and next payment stay unknown with it", () => {
    // 1 000 € at 18 % is 15 € of interest a month: 10 € a month would only make the debt grow
    const slow = loan({ id: "slow", kind: "card", balanceCents: 100000, balanceDate: "2026-01-15", rateBp: 1800, paymentCents: 1000, intervalMonths: 1 });
    const day = "2026-06-15";
    expect(loanBalanceOn(slow, day)).toEqual({ cents: 100000, unknown: "repayment" });
    expect(loanNextPayment(slow, day)).toMatchObject({ cents: 1000, date: null, unknown: "repayment" });
    expect(loanInterestNext12Months(slow, day)).toEqual({ cents: 18000, unknown: "repayment" });
  });

  it("the interest and the next payment of a card whose balance follows its plan are the plan's", () => {
    const card = loan({ id: "card", kind: "card", balanceCents: 100000, balanceDate: "2026-01-15", rateBp: 1800, paymentCents: 5000, intervalMonths: 1 });
    const day = "2026-06-15";
    // after 819,67 € the month's interest is 12,30 € and the rest of the 50 € pays the balance
    expect(loanNextPayment(card, day)).toEqual({ cents: 5000, interestCents: 1230, amortisationCents: 3770, intervalMonths: 1, date: "2026-07-15", unknown: null });
    // the twelve payments to come carry less than the rate of the whole balance, 147,54 €
    expect(loanInterestNext12Months(card, day)).toEqual({ cents: 10829, unknown: null });
  });
});

describe("bullets, loans without a rate and loans that owe nothing", () => {
  it("a bullet has no payment: it is counted apart, and a move of the rate tells its interest alone", () => {
    const bullet = loan({ id: "bullet", balanceCents: 5000000, rateBp: 400, reference: "euribor_3", marginBp: 150, repayment: "bullet", endDate: "2028-01-01" });
    const r = run([bullet]).loans;
    expect(r.loans[0]!.payment).toMatchObject({ cents: null, unknown: null });
    expect(r.payments).toEqual({ monthlyCents: 0, counted: 0, unknown: 0, bullets: 1 });
    expect(r.loans[0]!.scenarios.map((s) => [s.paymentCents, s.interestCents])).toEqual([[null, 150000], [null, 250000]]);
  });

  it("a loan a reference rate moves has no scenario without a rate, and none for a fall that has no room", () => {
    const noRate = annuity({ id: "no-rate", balanceCents: 1000000, paymentCents: 20000, rateBp: null, reference: "euribor_12" });
    // 0,50 % with a margin of 0,50: the reference rate is at zero, and 2,00 % with a margin of 1,50 has half a point to fall
    const atMargin = annuity({ id: "at-margin", balanceCents: 1000000, paymentCents: 20000, rateBp: 50, marginBp: 50, reference: "euribor_12", endDate: "2031-10-01" });
    const near = annuity({ id: "near", balanceCents: 1000000, paymentCents: 20000, rateBp: 200, marginBp: 150, reference: "euribor_12", endDate: "2031-10-01" });
    const r = run([noRate, atMargin, near]).loans;
    expect(r.loans.map((l) => l.scenarios.map((s) => [s.shiftBp, s.movedBp, s.rateBp]))).toEqual([[], [[100, 100, 150]], [[-100, -50, 150], [100, 100, 300]]]);
    expect(loanRateScenario(atMargin, today, -100)).toMatchObject({ rateBp: 50, movedBp: 0, interestCents: loanRateScenario(atMargin, today, 0).interestCents });
  });

  it("a debt that owes nothing lacks no rate: the interest is zero, and the sum is unknown only when a loan that owes has no rate", () => {
    const undrawn = loan({ id: "undrawn", kind: "credit_line", balanceCents: 0, limitCents: 500000 });
    const paid = loan({ id: "paid", balanceCents: 30000, balanceDate: "2026-01-01", repayment: "equal_principal", intervalMonths: 1, paymentCents: 30000 });
    const quiet = run([undrawn, paid]).loans;
    expect(quiet.loans.map((l) => l.interest.cents)).toEqual([0, 0]);
    expect(quiet).toMatchObject({ interest: { cents: 0 }, interestKnown: true });
    expect(quiet.interest.unknown.filter((u) => !u.counted)).toEqual([]);
    expect(quiet.loans[0]!.payoff).toEqual({ date: null, unknown: null, never: false });
    // beside them a card that owes and has no rate: nothing is known of the interest, and it is not zero
    const owing = run([undrawn, paid, loan({ id: "card", kind: "card", balanceCents: 124000 })]).loans;
    expect(owing.interestKnown).toBe(false);
    expect(owing.interest.unknown.filter((u) => !u.counted).map((u) => u.loanId)).toEqual(["card"]);
    // a loan with a rate beside it does not make the sum known: its interest alone is not the household's
    const rated = annuity({ id: "rated", balanceCents: 1000000, paymentCents: 20000 });
    const mixed = run([rated, loan({ id: "card", kind: "card", balanceCents: 124000 })]).loans;
    expect(mixed.interestKnown).toBe(false);
    expect(mixed.interest.cents).toBeGreaterThan(0);
    expect(mixed.loans[0]!.interest.cents).toBe(mixed.interest.cents);
    expect(run([rated]).loans.interestKnown).toBe(true);
  });
});

describe("a debt that may be in the total twice", () => {
  const loanAccount = account("loan-acc", "Asuntolaina", "loan");
  const savings = account("sav", "Säästötili", "savings");
  const card = account("card", "Kortti", "credit_card");
  const connected: [Account, number][] = [[checking, 3000000], [savings, 1500000], [card, -120000], [loanAccount, -15000000]];
  const home = loan({ id: "home", name: "Asuntolaina", kind: "mortgage", balanceCents: 15000000 });

  it("a connected loan account beside a saved mortgage: both count, and the report names the pair", () => {
    const r = run([home], connected);
    expect(r.loans.total.cents).toBe(15000000 + 15000000 + 120000);
    expect(r.balances.accountsLessDebt.at(-1)).toBe(3000000 + 1500000 - 120000 - 15000000 - 15000000);
    expect(r.loans.maybeTwice).toEqual([{ loans: [{ id: "home", name: "Asuntolaina" }], accounts: [{ id: "loan-acc", name: "Asuntolaina" }] }]);
  });

  it("names every saved loan that is no card beside the loan account, every saved card and credit line beside the card, and none that owes nothing", () => {
    const car = loan({ id: "car", name: "Autolaina", kind: "car", balanceCents: 800000 });
    const typedCard = loan({ id: "typed", name: "kortti", kind: "card", balanceCents: 50000 });
    const otherCard = loan({ id: "other", name: "Toinen kortti", kind: "card", balanceCents: 50000 });
    const paid = loan({ id: "paid", name: "Vanha laina", balanceCents: 0 });
    const paidCard = loan({ id: "paid-card", name: "Kortti", kind: "card", balanceCents: 0 });
    expect(run([home, car, typedCard, otherCard, paid, paidCard], connected).loans.maybeTwice).toEqual([
      { loans: [{ id: "typed", name: "kortti" }, { id: "other", name: "Toinen kortti" }], accounts: [{ id: "card", name: "Kortti" }] },
      { loans: [{ id: "home", name: "Asuntolaina" }, { id: "car", name: "Autolaina" }], accounts: [{ id: "loan-acc", name: "Asuntolaina" }] },
    ]);
    // a loan account in credit owes nothing, and a checking account's overdraft is no loan account
    expect(run([home], [[checking, -5000], [loanAccount, 100]]).loans.maybeTwice).toEqual([]);
  });

  it("a connected card beside the same card saved under another name, or saved as a credit line", () => {
    const accounts: [Account, number][] = [[checking, 300055], [account("card", "ESIMERKKIPANKKI Credit", "credit_card"), -120040]];
    const pair = (name: string) => [{ loans: [{ id: "v", name }], accounts: [{ id: "card", name: "ESIMERKKIPANKKI Credit" }] }];
    const r = run([loan({ id: "v", name: "Oma kortti", kind: "card", balanceCents: 120000 })], accounts);
    // both are in the sums, so the page has to say that they may be one debt
    expect(r.loans.total.cents).toBe(240040);
    expect(r.balances.accountsLessDebt.at(-1)).toBe(300055 - 120040 - 120000);
    expect(r.loans.maybeTwice).toEqual(pair("Oma kortti"));
    expect(run([loan({ id: "v", name: "ESIMERKKIPANKKI Credit", kind: "credit_line", balanceCents: 120000 })], accounts).loans.maybeTwice).toEqual(pair("ESIMERKKIPANKKI Credit"));
    // a card is no mortgage
    expect(run([home], accounts).loans.maybeTwice).toEqual([]);
  });

  it("two connected accounts beside one saved loan are one entry that lists both", () => {
    const second = account("loan-acc-2", "Asuntolaina", "loan");
    const r = run([loan({ id: "home", name: "Kodin laina", kind: "mortgage", balanceCents: 15000000 })], [[checking, 300055], [loanAccount, -10000000], [second, -5000000]]);
    expect(r.loans.maybeTwice).toEqual([{ loans: [{ id: "home", name: "Kodin laina" }], accounts: [{ id: "loan-acc", name: "Asuntolaina" }, { id: "loan-acc-2", name: "Asuntolaina" }] }]);
  });

  it("an account below zero beside a saved credit line is twice in the accounts less the debts alone", () => {
    const line = loan({ id: "cl", name: "Tililuotto", kind: "credit_line", balanceCents: 50000, limitCents: 200000 });
    const r = run([line], [[checking, -50000]]);
    // the overdraft is no debt of the list, so the debt total holds the credit once
    expect(r.loans.total.cents).toBe(50000);
    expect(r.loans.maybeTwice).toEqual([]);
    // the accounts' total holds it as the account's minus, and the saved loan takes it off again
    expect(r.balances.accountsLessDebt.at(-1)).toBe(-100000);
    expect(r.loans.overdraftTwice).toEqual([{ loans: [{ id: "cl", name: "Tililuotto" }], accounts: [{ id: "acc-1", name: "Käyttötili" }] }]);
    // an account in credit, a credit line that owes nothing and a saved loan of another kind are no such pair
    expect(run([line], [[checking, 50000]]).loans.overdraftTwice).toEqual([]);
    expect(run([{ ...line, balanceCents: 0 }], [[checking, -50000]]).loans.overdraftTwice).toEqual([]);
    expect(run([{ ...line, kind: "card" }, home], [[checking, -50000]]).loans.overdraftTwice).toEqual([]);
    // a card that owes is in the debt total: its pair is in `maybeTwice`
    expect(run([line], [[card, -50000]]).loans).toMatchObject({ overdraftTwice: [], maybeTwice: [{ loans: [{ id: "cl" }], accounts: [{ id: "card" }] }] });
  });
});

describe("a move of the rate that has nothing to tell, and a loan whose balance is dated after today", () => {
  const mortgage = (p: Partial<Loan>) => annuity({ id: "home", name: "Kodin laina", kind: "mortgage", balanceCents: 15000000, rateBp: 360, reference: "euribor_12", marginBp: 110, paymentCents: 90000, ...p });

  it("an annuity that never ends has no scenario, and a credit line's tells its interest alone", () => {
    // 500 € a month is the month's interest of 150 000 € at 4 %: the loan never ends, so no move has a payment or an interest to tell
    expect(run([mortgage({ rateBp: 400, paymentCents: 50000 })]).loans.loans[0]!.scenarios).toEqual([]);
    const line = loan({ id: "cl", name: "Joustoluotto", kind: "credit_line", balanceCents: 300000, rateBp: 700, reference: "euribor_3", marginBp: 450, paymentCents: 10000, intervalMonths: 1 });
    // its balance follows its payment of 100 € a month, so a year's interest at 6 % and at 8 % is less than the rate of the whole balance
    expect(run([line]).loans.loans[0]!.scenarios.map((s) => [s.paymentCents, s.interestCents])).toEqual([[null, 15149], [null, 20401]]);
  });

  it("a credit line on a rate path moves every review's rate with the scenario, a fall at most to the margin", () => {
    // 7 % now and 7,5 % from the review on 1.1.2027, both over the margin of 4,5 %
    const line = loan({ id: "cl", kind: "credit_line", balanceCents: 300000, rateBp: 700, reference: "euribor_3", marginBp: 450, paymentCents: 10000, intervalMonths: 1, ratePath: [["2026-10-01", 7000], ["2027-01-01", 7500]] });
    const at = (shiftBp: number) => loanRateScenario(line, today, shiftBp).interestCents!;
    expect(at(0)).toBe(loanInterestNext12Months(line, today).cents);
    expect(at(100)).toBeGreaterThan(at(0));
    expect(at(-100)).toBeLessThan(at(0));
    // a fall of 3 % takes both reviews to the margin, so a fall of 5 % falls no further
    expect(at(-500)).toBe(at(-300));
  });

  it("a balance dated after today is a payment that is not known, and no loan without a rate", () => {
    const later = mortgage({ balanceDate: "2026-11-01" });
    expect(debtPaymentsPerMonth([later], today)).toEqual({ monthlyCents: 0, counted: 0, unknown: 1, bullets: 0 });
    expect(debtPaymentsPerMonth([{ ...later, repayment: "bullet" }], today)).toEqual({ monthlyCents: 0, counted: 0, unknown: 1, bullets: 0 });
    const r = run([later]).loans;
    expect(r.payments).toEqual({ monthlyCents: 0, counted: 0, unknown: 1, bullets: 0 });
    // the interest leaves it out for its balance: its rate is known
    expect(r.interest.unknown).toEqual([{ loanId: "home", unknown: "before_balance_date", counted: false }]);
    expect(r.withoutRate).toBe(0);
    // what it owed today is not known, so neither the debt total nor the interest has a figure, and nor has the path
    expect([r.totalKnown, r.interestKnown, r.path]).toEqual([false, false, null]);
    expect(run([annuity({ id: "now", balanceCents: 1000000, paymentCents: 20000 })]).loans).toMatchObject({ totalKnown: true, interestKnown: true });
    // beside it a card that owes and has no rate, and one that owes nothing
    expect(run([later, loan({ id: "card", kind: "card", balanceCents: 124000 }), loan({ id: "undrawn", kind: "card", balanceCents: 0 })]).loans.withoutRate).toBe(1);
  });
});

describe("the payments of a month over every debt the page lists", () => {
  const none = { monthlyCents: 0, counted: 0, unknown: 0, bullets: 0 };
  const row = (monthlyCents: number | null) => ({ debtId: "proposal:esimerkki", name: "Esimerkkirahoitus", monthlyCents, card: false });
  /** The unsaved debts as `unsavedDebts` tells them: the rows and the lenders paid only a few times. */
  const unsaved = (rows: ReturnType<typeof row>[], few = 0) => ({ rows, few });

  it("adds the saved loans' payments and the unsaved rows' known ones, and counts the debts that tell none", () => {
    // four unsaved rows with a figure and one without, beside a saved loan with no payment: 1 382,24 € and two unknown
    const rows = [row(50_000), row(40_000), row(30_000), row(18_224), row(null)];
    expect(monthlyPayments({ ...none, unknown: 1 }, unsaved(rows))).toEqual({ cents: 138_224, unknown: 2 });
    // a saved loan paid 1 000 € and a saved card with no payment, beside one lender's payment nobody saved: 1 289 € and one unknown
    expect(monthlyPayments({ monthlyCents: 100_000, counted: 1, unknown: 1, bullets: 0 }, unsaved([row(28_900)]))).toEqual({ cents: 128_900, unknown: 1 });
    // a saved loan's payment is added to theirs
    expect(monthlyPayments({ monthlyCents: 20_000, counted: 1, unknown: 0, bullets: 0 }, unsaved([row(10_000)]))).toEqual({ cents: 30_000, unknown: 0 });
  });

  it("counts a lender paid only a few times as one more unknown debt, with no figure of its own", () => {
    expect(monthlyPayments({ monthlyCents: 20_000, counted: 1, unknown: 0, bullets: 0 }, unsaved([row(10_000)], 2))).toEqual({ cents: 30_000, unknown: 2 });
    expect(monthlyPayments(none, unsaved([], 1))).toEqual({ cents: null, unknown: 1 });
  });

  it("is null, never 0, while no payment is known", () => {
    expect(monthlyPayments({ ...none, unknown: 1 }, unsaved([row(null)]))).toEqual({ cents: null, unknown: 2 });
    expect(monthlyPayments(none, unsaved([]))).toEqual({ cents: null, unknown: 0 });
    expect(monthlyPayments({ ...none, bullets: 1 }, unsaved([]))).toEqual({ cents: null, unknown: 0 });
  });

  it("is the saved loans' payments when nothing is unsaved", () => {
    const r = run([annuity({ id: "a", balanceCents: 1000000, paymentCents: 20000 })]).loans;
    expect(r.monthly).toEqual({ cents: r.payments.monthlyCents, unknown: 0 });
  });
});

describe("the extra monthly payments of the debt-free choice", () => {
  it("gives each extra payment an earlier end, a saving and the debt of each day of the path, below the debts' own", () => {
    const r = run([annuity({ id: "a", balanceCents: 1_000_000, paymentCents: 20_000 })]).loans;
    const path = r.path!;
    expect(r.extra.map((s) => s.extraCents)).toEqual([5_000, 10_000, 20_000]);
    for (const [i, s] of r.extra.entries()) {
      expect(s.debtFreeDate < r.plan!.baseDebtFreeDate, `${s.extraCents} ends earlier`).toBe(true);
      expect(s.monthsEarlier).toBeGreaterThan(0);
      expect(s.savedCents).toBeGreaterThan(0);
      expect(s.owedCents).toHaveLength(path.days.length);
      expect(s.owedCents[0]).toBe(path.balanceCents[0]);
      expect(s.owedCents.at(-1)).toBe(0);
      s.owedCents.forEach((owed, k) => {
        expect(owed, `${s.extraCents} on day ${k}`).toBeLessThanOrEqual(path.balanceCents[k]!);
        if (k > 0) expect(owed).toBeLessThanOrEqual(s.owedCents[k - 1]!);
      });
      if (i > 0) {
        expect(s.debtFreeDate <= r.extra[i - 1]!.debtFreeDate).toBe(true);
        expect(s.savedCents).toBeGreaterThan(r.extra[i - 1]!.savedCents);
      }
    }
  });

  it("starts each scenario where the path does and names the same month for the debts' own payments, with a card paid in full among them", () => {
    // the card's whole 800 € is due 15.11.2026: it is owed, and no debt the extra money pays
    const card = loan({ id: "card", kind: "card", repayment: "bullet", rateBp: 0, balanceCents: 80_000, endDate: "2026-11-15" });
    const r = run([annuity({ id: "a", balanceCents: 1_000_000, paymentCents: 20_000 }), card]).loans;
    const path = r.path!;
    expect(path.balanceCents[0]).toBe(1_080_000);
    expect(r.extra.length).toBeGreaterThan(0);
    for (const s of r.extra) {
      expect(s.owedCents[0], `${s.extraCents} on day 0`).toBe(path.balanceCents[0]);
      // the months earlier are counted from the month the path ends, the one 'Ei lisää' shows
      expect(s.monthsEarlier).toBe(Number(path.payoff!.slice(0, 4)) * 12 + Number(path.payoff!.slice(5, 7)) - (Number(s.debtFreeDate.slice(0, 4)) * 12 + Number(s.debtFreeDate.slice(5, 7))));
    }
  });

  it("keeps the plan of the debts' own payments: the ended debt's payment goes to the next, which saves 23,00 € with no extra money", () => {
    const r = run([annuity({ id: "a", balanceCents: 500_000, rateBp: 1_000, paymentCents: 23_072, endDate: "2028-10-01" }), annuity({ id: "b", balanceCents: 1_000_000, rateBp: 300, paymentCents: 29_081, endDate: "2029-10-01" })]).loans;
    expect(r.plan).toEqual({
      debtFreeDate: "2029-05-01",
      baseDebtFreeDate: "2029-10-01",
      savedCents: 2_300,
      bufferCents: 0,
      bufferFullDate: null,
      debts: [
        { id: "a", order: 1, endDate: "2028-10-01", baseEndDate: "2028-10-01" },
        { id: "b", order: 2, endDate: "2029-05-01", baseEndDate: "2029-10-01" },
      ],
      snowballExtraCents: 0,
    });
  });

  it("is empty while a debt has no plan, so no date tells a part of the debt as all of it", () => {
    const r = run([annuity({ id: "a", balanceCents: 1_000_000, paymentCents: 20_000 }), loan({ id: "no-rate", balanceCents: 100_000 })]).loans;
    expect(r.path).toBeNull();
    expect(r.extra).toEqual([]);
  });
});

