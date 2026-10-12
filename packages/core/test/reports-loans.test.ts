/**
 * The Lainat report on the inputs of its review: each case is a figure that was told wrong. Made-up loans only.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { debtPaymentsPerMonth, loanNextPayment, loanRateScenario } from "../src/loans.ts";
import type { BalanceInput } from "../src/reports/balances.ts";
import { buildReports } from "../src/reports/index.ts";
import { loansWithout } from "../src/reports/loans.ts";
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
    expect(r.loans.map((l) => [l.payment.cents, l.payment.unknown])).toEqual([[5000, "repayment"], [3030, "repayment"], [null, "repayment"]]);
    expect(r.payments).toEqual({ monthlyCents: 8030, counted: 2, unknown: 1, bullets: 0 });
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
    expect(run([line]).loans.loans[0]!.scenarios.map((s) => [s.paymentCents, s.interestCents])).toEqual([[null, 18000], [null, 24000]]);
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
    // beside it a card that owes and has no rate, and one that owes nothing
    expect(run([later, loan({ id: "card", kind: "card", balanceCents: 124000 }), loan({ id: "undrawn", kind: "card", balanceCents: 0 })]).loans.withoutRate).toBe(1);
  });
});

describe("the words the report shares with Saldot and Optimoi", () => {
  it("counts the loans a figure cannot be told of, in the case the sentence needs", () => {
    expect(loansWithout(1, "korkoa")).toBe("yksi laina, jonka korkoa ei tiedetä");
    expect(loansWithout(3, "maksuerää")).toBe("3 lainaa, joiden maksuerää ei tiedetä");
    expect(loansWithout(1, "korkoa", true)).toBe("yhtä lainaa, jonka korkoa ei tiedetä");
    expect(loansWithout(2, "korkoa", true)).toBe("2 lainaa, joiden korkoa ei tiedetä");
  });
});
