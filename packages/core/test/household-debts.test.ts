/**
 * The household's debts (`household-debts.ts`): a saved loan linked to a connected account is one debt, in the list and
 * in each of its three readers (the Lainat report, the accounts less the debts in Saldot, the loan area of
 * Säästövinkit). Without a link every figure is what it was. Made-up loans and accounts only.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { addDays, addMonthsToDate } from "../src/dates.ts";
import { householdDebts } from "../src/household-debts.ts";
import { creditAccountLoan, loanBalanceOn, loanInterestNext12Months, loanLastDueDate, loanPayoffDate } from "../src/loans.ts";
import { loans as loanArea } from "../src/optimise/areas/loans.ts";
import { eur } from "../src/optimise/common.ts";
import { areaInputOf } from "../src/optimise/index.ts";
import { buildReports } from "../src/reports/index.ts";
import { SAME_DEBT_TWICE } from "../src/reports/loans.ts";
import type { Account, BalanceInput, Loan } from "../src/types.ts";
import { tx } from "./helpers.ts";
import { FRAME, householdInput, joinHousehold, type PartHousehold } from "./optimise/household.ts";
import * as loansPart from "./optimise/parts/loans.ts";

const today = "2026-10-09";
const loan = (p: Partial<Loan> & Pick<Loan, "id" | "balanceCents">): Loan => ({
  name: p.id, lender: null, kind: "consumer", grantedCents: null, balanceDate: "2026-10-01", rateBp: null, reference: null, marginBp: null, repayment: null, intervalMonths: null, paymentCents: null, endDate: null, limitCents: null, seriesKey: null, ...p,
});
const account = (id: string, name: string, type: Account["type"], balanceCents: number | null): BalanceInput => ({ id, name, type, balanceCents, ownerName: null, balanceAt: null });
const inputsOf = (loans: Loan[]) => ({ marks: [], expectedBills: [], loans });

// 150 000 € at 3,6 % paid 900 € a month, and a card typed in with its rate and its limit
const home = loan({ id: "home", name: "Kodin laina", kind: "mortgage", balanceCents: 15_000_000, rateBp: 360, reference: "euribor_12", marginBp: 110, repayment: "annuity", intervalMonths: 1, paymentCents: 90_000 });
const typedCard = loan({ id: "typed", name: "Oma kortti", kind: "card", balanceCents: 124_000, rateBp: 1800, limitCents: 300_000 });
// the bank tells 800 € on the card and 149 123,45 € on the loan account
const checking = account("acc-1", "Käyttötili", "checking", 200_000);
const card = account("card", "Kortti", "credit_card", -80_000);
const loanAccount = account("loan-acc", "Asuntolaina", "loan", -14_912_345);
const accounts = [checking, card, loanAccount];

describe("the household's debts without a link", () => {
  it("every saved loan counts as typed and every card and loan account that owes as the bank tells it", () => {
    const debts = householdDebts(accounts, inputsOf([home, typedCard]), today);
    expect(debts.saved).toEqual([home, typedCard]);
    expect(debts.connected).toEqual([creditAccountLoan(card, today), creditAccountLoan(loanAccount, today)]);
    expect(debts.sources).toEqual([{ loanId: "account:card", accountId: "card", linked: false, typed: null }, { loanId: "account:loan-acc", accountId: "loan-acc", linked: false, typed: null }]);
    expect(debts.loans).toEqual([...debts.saved, ...debts.connected]);
    expect(debts.total).toEqual({ cents: 15_000_000 + 124_000 + 80_000 + 14_912_345, unknown: [{ loanId: "typed", unknown: "repayment", counted: true }, { loanId: "account:card", unknown: "repayment", counted: true }, { loanId: "account:loan-acc", unknown: "repayment", counted: true }] });
    // a checking account below zero and an account in credit are no debts of the list
    expect(householdDebts([account("acc-1", "Käyttötili", "checking", -5_000), account("card", "Kortti", "credit_card", 100)], inputsOf([]), today)).toMatchObject({ loans: [], sources: [], total: { cents: 0 } });
  });

  it("a link that cannot hold changes nothing: the account is gone, is no card or loan account any more, or has no balance", () => {
    const cases: [string, BalanceInput[]][] = [
      ["the account is not among the accounts", [checking, loanAccount]],
      ["its type was changed after the link was made", [checking, { ...card, type: "checking" }, loanAccount]],
      ["the bank told no balance", [checking, { ...card, balanceCents: null }, loanAccount]],
    ];
    for (const [why, list] of cases) {
      const plain = householdDebts(list, inputsOf([home, typedCard]), today);
      const named = householdDebts(list, inputsOf([home, { ...typedCard, accountId: "card" }]), today);
      expect(named.saved, why).toEqual([home, { ...typedCard, accountId: "card" }]);
      // the saved card owes its typed 1 240 €, and the loan account stands beside as before
      expect(named.connected, why).toEqual(plain.connected);
      expect(named.sources, why).toEqual([{ loanId: "account:loan-acc", accountId: "loan-acc", linked: false, typed: null }]);
      expect({ total: named.total, interest: named.interest, interestKnown: named.interestKnown }, why).toEqual({ total: plain.total, interest: plain.interest, interestKnown: plain.interestKnown });
    }
    // a link left empty is no link
    const empty = householdDebts(accounts, inputsOf([{ ...typedCard, accountId: null }]), today);
    expect(empty.total.cents).toBe(124_000 + 80_000 + 14_912_345);
    expect(empty.sources.map((s) => s.linked)).toEqual([false, false]);
  });
});

describe("a saved loan linked to a connected account is one debt", () => {
  const linkedHome: Loan = { ...home, accountId: "loan-acc" };
  const linkedCard: Loan = { ...typedCard, accountId: "card" };

  it("the pair is once in the list: the account's balance on the saved loan's terms, and the total falls by the typed balance", () => {
    const plain = householdDebts(accounts, inputsOf([home, typedCard]), today);
    const debts = householdDebts(accounts, inputsOf([linkedHome, typedCard]), today);
    expect(debts.saved).toEqual([typedCard]);
    // no due date has passed since the balance was typed on the 1st, so the bank's balance is dated there
    expect(debts.connected).toEqual([creditAccountLoan(card, today), { ...linkedHome, balanceCents: 14_912_345 }]);
    expect(debts.sources).toEqual([{ loanId: "account:card", accountId: "card", linked: false, typed: null }, { loanId: "home", accountId: "loan-acc", linked: true, typed: linkedHome }]);
    expect(debts.loans.map((l) => l.id)).toEqual(["typed", "account:card", "home"]);
    expect(debts.total.cents).toBe(124_000 + 80_000 + 14_912_345);
    expect(plain.total.cents - debts.total.cents).toBe(15_000_000);
    // the mortgage has its plan, so nothing of it is counted at a stated balance
    expect(debts.total.unknown.map((u) => u.loanId)).toEqual(["typed", "account:card"]);
    // both linked: no saved loan is left outside the accounts
    const both = householdDebts(accounts, inputsOf([linkedHome, linkedCard]), today);
    expect(both.saved).toEqual([]);
    expect(both.loans.map((l) => [l.id, l.balanceCents])).toEqual([["typed", 80_000], ["home", 14_912_345]]);
    expect(both.total.cents).toBe(80_000 + 14_912_345);
  });

  it("the interest of 12 months is the saved rate on the bank's balance, and it stays known", () => {
    const debts = householdDebts([checking, card], inputsOf([linkedCard]), today);
    // 18 % a year of the bank's 800 €, not of the typed 1 240 €
    expect(debts.interest).toEqual({ cents: 14_400, unknown: [{ loanId: "typed", unknown: "repayment", counted: true }] });
    expect(debts.interestKnown).toBe(true);
    // the saved limit stays, and the bank's fills in for a loan that has none
    expect(debts.connected[0]!.limitCents).toBe(300_000);
    const bankLimit = householdDebts([{ ...card, creditLimitCents: 200_000 }], inputsOf([{ ...linkedCard, limitCents: null }]), today);
    expect(bankLimit.connected[0]!.limitCents).toBe(200_000);
    // a mortgage: the interest parts of its payments from the bank's balance on, each at the saved 3,6 %
    const mortgage = householdDebts(accounts, inputsOf([linkedHome]), today);
    const interest = loanInterestNext12Months({ ...home, balanceCents: 14_912_345 }, today).cents!;
    expect(mortgage.interest).toEqual({ cents: interest, unknown: [{ loanId: "account:card", unknown: "rate", counted: false }] });
    // under a whole year's 3,6 % of the balance, since each payment brings it down
    expect(interest).toBeLessThan(536_844);
    expect(interest).toBeGreaterThan(520_000);
    // without a rate on the saved loan the pair is like any card without one: nothing is known of the interest
    expect(householdDebts([card], inputsOf([{ ...linkedCard, rateBp: null }]), today)).toMatchObject({ interestKnown: false, interest: { cents: 0, unknown: [{ loanId: "typed", unknown: "rate", counted: false }] } });
  });

  it("a linked account at zero is the pair's balance too: the loan is paid, and the typed balance is in no sum", () => {
    const debts = householdDebts([{ ...card, balanceCents: 0 }], inputsOf([linkedCard]), today);
    expect(debts.saved).toEqual([]);
    expect(debts.connected.map((l) => [l.id, l.balanceCents])).toEqual([["typed", 0]]);
    expect(debts).toMatchObject({ total: { cents: 0 }, interest: { cents: 0 }, interestKnown: true });
  });

  // 150 000 € at 3,6 % paid 900 € on the 5th, typed on 5.9.2026 with no last due date: 149 550 € after the 5.10. payment
  const sept = loan({ id: "sept", name: "Kodin laina", kind: "mortgage", balanceCents: 15_000_000, balanceDate: "2026-09-05", rateBp: 360, repayment: "annuity", intervalMonths: 1, paymentCents: 90_000, accountId: "loan-acc" });

  it("the bank's balance is dated on the plan's latest due date, so the payoff date keeps the loan's due day from day to day", () => {
    const owing = [{ ...loanAccount, balanceCents: -14_955_000 }];
    expect(loanPayoffDate(sept).date).toBe("2046-01-05");
    for (const day of ["2026-10-09", "2026-10-10", "2026-11-04"]) {
      const pair = householdDebts(owing, inputsOf([sept]), day).connected[0]!;
      expect([pair.balanceCents, pair.balanceDate], day).toEqual([14_955_000, "2026-10-05"]);
      expect(loanPayoffDate(pair).date, day).toBe("2046-01-05");
      expect(loanBalanceOn(pair, day), day).toEqual({ cents: 14_955_000, unknown: null });
    }
    // before the first due date the balance is dated where the loan's own is, and the next due date moves it on
    expect(householdDebts(owing, inputsOf([sept]), "2026-09-20").connected[0]!.balanceDate).toBe("2026-09-05");
    expect(householdDebts(owing, inputsOf([sept]), "2026-11-05").connected[0]!.balanceDate).toBe("2026-11-05");
    // a loan with no plan has no due dates: its own balance date stays
    expect(householdDebts([card], inputsOf([linkedCard]), today).connected[0]).toMatchObject({ balanceCents: 80_000, balanceDate: "2026-10-01" });
  });

  it("a plan with a last due date counts its due dates back from it, and goes on past it while the bank still tells a debt", () => {
    const ending = { ...sept, endDate: "2026-12-20" };
    expect(["2026-09-19", "2026-09-20", "2026-12-19", "2026-12-20", "2027-02-25"].map((day) => loanLastDueDate(ending, day))).toEqual([null, "2026-09-20", "2026-11-20", "2026-12-20", "2027-02-20"]);
    // a loan with no payments to place has one due date, its last: past it the typed loan is paid, and the pair owes
    // what the bank tells
    const bullet = loan({ id: "bullet", name: "Kertalyhenteinen", balanceCents: 15_000_000, repayment: "bullet", balanceDate: "2026-09-05", endDate: "2026-10-05", accountId: "loan-acc" });
    expect(loanLastDueDate(bullet, "2026-10-04")).toBeNull();
    expect(loanBalanceOn(bullet, today).cents).toBe(0);
    const debts = householdDebts([loanAccount], inputsOf([bullet]), today);
    expect(debts.connected[0]).toMatchObject({ balanceCents: 14_912_345, balanceDate: "2026-10-05" });
    expect(debts.total.cents).toBe(14_912_345);
  });

  it("the link holds only while the account is at or below zero: a loan account told with a plus leaves both as with no link", () => {
    const plus = [checking, { ...loanAccount, balanceCents: 14_912_345 }];
    const plain = householdDebts(plus, inputsOf([{ ...sept, accountId: null }]), today);
    const debts = householdDebts(plus, inputsOf([sept]), today);
    expect(debts).toMatchObject({ saved: [sept], connected: [], sources: [], total: { cents: 14_955_000 } });
    expect({ total: debts.total, interest: debts.interest }).toEqual({ total: plain.total, interest: plain.interest });
    const r = run([sept], plus);
    expect(r.loans.loans).toMatchObject([{ id: "sept", linkedAccount: null, balance: { cents: 14_955_000 } }]);
    expect(r.balances.accountsLessDebt.at(-1)).toBe(200_000 + 14_912_345 - 14_955_000);
  });

  it("an account balance given before the loan's balance was typed is the older word: the pair keeps the typed balance, once", () => {
    const typedLater = loan({ id: "later", name: "Kodin laina", kind: "mortgage", balanceCents: 14_700_000, balanceDate: "2026-10-05", accountId: "loan-acc" });
    const old = { ...loanAccount, balanceCents: -15_000_000, balanceAt: "2026-03-31" };
    const debts = householdDebts([old], inputsOf([typedLater]), today);
    expect(debts).toMatchObject({ saved: [], connected: [typedLater], sources: [{ loanId: "later", accountId: "loan-acc", linked: true, typed: typedLater }], total: { cents: 14_700_000 } });
    // a balance given on the loan's day or after it, or on a day nobody knows (it stands for today), is the bank's word
    for (const balanceAt of ["2026-10-05", "2026-10-06T08:00:00.000Z", null]) {
      expect(householdDebts([{ ...old, balanceAt }], inputsOf([typedLater]), today).total.cents, String(balanceAt)).toBe(15_000_000);
    }
  });

  it("two saved loans that name one account: the first in saved order takes it and the other counts as typed", () => {
    // the ids run against the saved order, so the order decides and not the id
    const first = loan({ id: "z-first", name: "Kortti A", kind: "card", balanceCents: 50_000, rateBp: 1500, accountId: "card" });
    const second = loan({ id: "a-second", name: "Kortti B", kind: "card", balanceCents: 70_000, accountId: "card" });
    const debts = householdDebts([card], inputsOf([first, second]), today);
    expect(debts.saved).toEqual([second]);
    expect(debts.connected).toEqual([{ ...first, balanceCents: 80_000 }]);
    expect(debts.total.cents).toBe(70_000 + 80_000);
    const turned = householdDebts([card], inputsOf([second, first]), today);
    expect(turned.saved).toEqual([first]);
    expect(turned.connected.map((l) => [l.id, l.balanceCents])).toEqual([["a-second", 80_000]]);
    expect(turned.total.cents).toBe(50_000 + 80_000);
    // the first names an account that cannot hold a link: nobody takes it, and both count as typed
    const gone = householdDebts([checking], inputsOf([first, second]), today);
    expect(gone).toMatchObject({ saved: [first, second], connected: [], total: { cents: 120_000 } });
  });
});

/** The reports of a household with these loans and connected accounts: one row on the checking account, on `rowDay`. */
function run(loans: Loan[], balances: BalanceInput[], from = "2026-08-01", rowDay = "2026-09-03") {
  const ctx = createContext([tx({ bookingDate: rowDay, amountCents: -50000 })], balances.map((b): Account => ({ id: b.id, name: b.name, iban: null, currency: "EUR", type: b.type })), today);
  return buildReports({ ctx, range: { from, to: today }, balances, inputs: inputsOf(loans) });
}

describe("the Lainat report and Saldot with a link", () => {
  const linkedHome: Loan = { ...home, accountId: "loan-acc" };
  const linkedCard: Loan = { ...typedCard, accountId: "card" };

  it("the linked row is the saved loan with the bank's balance: its rate, payment and payoff stay known", () => {
    const r = run([linkedHome], accounts).loans;
    expect(r.saved).toBe(1);
    expect(r.loans.map((l) => l.id)).toEqual(["account:card", "home"]);
    const row = r.loans[1]!;
    expect(row).toMatchObject({ name: "Kodin laina", kind: "mortgage", accountType: null, linkedAccount: { id: "loan-acc", name: "Asuntolaina" }, balance: { cents: 14_912_345, unknown: null }, balanceDate: "2026-10-01", rateBp: 360, reference: "euribor_12", repayment: "annuity" });
    // a month of 3,6 % on the bank's balance: 14 912 345 × 0,003 = 44 737,035
    expect(row.payment).toEqual({ cents: 90_000, interestCents: 44_737, amortisationCents: 45_263, intervalMonths: 1, unknown: null });
    expect(row.interest).toEqual(loanInterestNext12Months({ ...home, balanceCents: 14_912_345 }, today));
    expect(row.payoff).toMatchObject({ unknown: null, never: false });
    // the loan is paid on the 1st, its own due day, whatever day the report is read
    expect(row.payoff.date).toMatch(/^20\d\d-\d\d-01$/);
    // the reference rate moves it: one point down and one up, as for the saved loan alone
    expect(row.scenarios.map((s) => s.rateBp)).toEqual([260, 460]);
    expect(r.payments).toEqual({ monthlyCents: 90_000, counted: 1, unknown: 1, bullets: 0 });
    // the connected card beside it is a row of its own, as before
    expect(r.loans[0]).toMatchObject({ accountType: "credit_card", linkedAccount: null, balance: { cents: 80_000 } });
    expect(r.total.cents).toBe(80_000 + 14_912_345);
  });

  it("a link that cannot hold leaves the row a saved loan, and the pair stays in the fallback", () => {
    const r = run([linkedCard], [checking, { ...card, balanceCents: null }]).loans;
    expect(r.loans).toMatchObject([{ id: "typed", linkedAccount: null, accountType: null, balance: { cents: 124_000 } }]);
    const overdrawn = run([{ ...typedCard, kind: "credit_line", accountId: "card" }], [checking, { ...card, type: "checking" }]).loans;
    expect(overdrawn.total.cents).toBe(124_000);
    expect(overdrawn.loans).toMatchObject([{ id: "typed", linkedAccount: null }]);
    expect(overdrawn.overdraftTwice).toEqual([{ loans: [{ id: "typed", name: "Oma kortti" }], accounts: [{ id: "card", name: "Kortti" }] }]);
  });

  it("a linked pair is in neither list of debts that may be there twice, and loans with no link stay in them", () => {
    const line = loan({ id: "line", name: "Joustoluotto", kind: "credit_line", balanceCents: 30_000 });
    // no link: the card stands beside both saved revolving credits, the loan account beside every saved loan that is no card
    const beside = { loans: [{ id: "home", name: "Kodin laina" }, { id: "line", name: "Joustoluotto" }], accounts: [{ id: "loan-acc", name: "Asuntolaina" }] };
    expect(run([home, typedCard, line], accounts).loans.maybeTwice).toEqual([{ loans: [{ id: "typed", name: "Oma kortti" }, { id: "line", name: "Joustoluotto" }], accounts: [{ id: "card", name: "Kortti" }] }, beside]);
    // the card linked: neither it nor its account is named, and the loan account's pair stays as it was
    const linked = run([home, linkedCard, line], accounts).loans;
    expect(linked.maybeTwice).toEqual([beside]);
    expect(linked.total.cents).toBe(15_000_000 + 30_000 + 80_000 + 14_912_345);
    // a linked account is taken: the credit line has no card to stand beside
    expect(run([typedCard, line], [checking, card]).loans.maybeTwice).toHaveLength(1);
    expect(run([linkedCard, line], [checking, card]).loans.maybeTwice).toEqual([]);
    expect(run([linkedHome, linkedCard], accounts).loans.maybeTwice).toEqual([]);
    // a linked card below zero is a debt of the list, no overdraft beside the saved credit line
    expect(linked.overdraftTwice).toEqual([]);
    const overdrawn = run([linkedCard, line], [{ ...checking, balanceCents: -20_000 }, card]).loans;
    expect(overdrawn.overdraftTwice).toEqual([{ loans: [{ id: "line", name: "Joustoluotto" }], accounts: [{ id: "acc-1", name: "Käyttötili" }] }]);
  });

  it("the accounts less the debts do not take a linked loan where its account tells it", () => {
    const plain = run([home, typedCard], accounts).balances;
    const linked = run([linkedHome, typedCard], accounts).balances;
    expect(linked.total).toEqual(plain.total);
    expect(plain.debt).toEqual({ day: today, cents: 15_000_000 + 124_000 + 80_000 + 14_912_345, savedCents: 15_000_000 + 124_000 });
    expect(linked.debt).toEqual({ day: today, cents: 124_000 + 80_000 + 14_912_345, savedCents: 124_000 });
    expect(linked.accountsLessDebt.at(-1)).toBe(plain.accountsLessDebt.at(-1)! + 15_000_000);
    // every saved loan linked: nothing is outside the accounts today, and the months before the accounts' first
    // known day read as with no link
    const all = run([linkedHome, { ...typedCard, accountId: "card" }], accounts).balances;
    expect(all.debt.savedCents).toBe(0);
    expect(all.accountsLessDebt.at(-1)).toBe(all.total.at(-1));
    expect(all.accountsLessDebt.slice(0, -1)).toEqual(plain.accountsLessDebt.slice(0, -1));
  });

  it("at a month end before the linked account's first known day the typed loan counts as with no link: the debt is in every month once", () => {
    // a checking account with one row in January, a loan account with no rows whose balance was given today, and
    // 150 000 € at 3,6 % paid 900 € on the 5th, typed on 5.6.2026: June to October
    const june = loan({ id: "june", name: "Kodin laina", kind: "mortgage", balanceCents: 15_000_000, balanceDate: "2026-06-05", rateBp: 360, repayment: "annuity", intervalMonths: 1, paymentCents: 90_000 });
    const balances = [checking, { ...loanAccount, balanceAt: today }];
    const less = (loans: Loan[]) => run(loans, balances, "2026-06-01", "2026-01-15").balances;
    const plain = less([june]);
    expect(plain.total).toEqual([200_000, 200_000, 200_000, 200_000, 200_000 - 14_912_345]);
    // no link: the typed loan each month, and in October the loan account on top of it
    expect(plain.accountsLessDebt).toEqual([-14_800_000, -14_755_000, -14_709_865, -14_664_595, -29_531_534]);
    const linked = less([{ ...june, accountId: "loan-acc" }]);
    // linked: the same four months, where the account tells nothing yet, and in October the account alone
    expect(linked.accountsLessDebt).toEqual([-14_800_000, -14_755_000, -14_709_865, -14_664_595, 200_000 - 14_912_345]);
    expect(linked.debt).toEqual({ day: today, cents: 14_912_345, savedCents: 0 });
  });
});

/** A part on the base as the server hands it over. `joinHousehold` joins marks and bills only, so the part's loans are put back. */
const withLoans = (part: PartHousehold) => {
  const h = joinHousehold([part]);
  return householdInput({ ...h, inputs: { ...h.inputs, loans: part.inputs?.loans ?? [] } });
};

describe("the three readers of the debt total with a link", () => {
  // The loans part's household: a mortgage saved 200 days ago, so what it counts as today is the plan's and not the
  // stated balance, a connected card, and the loan account the bank shows for the same mortgage.
  const part = loansPart.savedMortgage(FRAME, { balanceDate: addDays(FRAME.today, -200) });
  const mortgageAccount = { id: "h-mortgage-account", name: "Asuntolaina", type: "loan" as const, balanceCents: -14_612_345, ownerName: null, balanceAt: null };
  const readers = (accountId: string | null) => {
    const mortgage: Loan = { ...part.inputs!.loans![0]!, accountId };
    const input = withLoans({ ...part, balances: [...part.balances!, mortgageAccount], inputs: { ...part.inputs!, loans: [mortgage] } });
    const reports = buildReports({ ctx: input.ctx, range: { from: "2026-01-01", to: FRAME.today }, balances: input.balances, inputs: input.inputs });
    const area = loanArea.assess(areaInputOf(input));
    const calc = (kind: string, label: string) => area.findings.find((f) => f.kind === kind)?.calc.find((c) => c.label === label)?.value;
    return { mortgage, reports, area, calc, debts: householdDebts(input.balances, input.inputs!, FRAME.today) };
  };
  const plain = readers(null);
  const linked = readers(mortgageAccount.id);
  /** What the saved mortgage counts as today when nothing links it. */
  const typed = loanBalanceOn(plain.mortgage, FRAME.today).cents!;

  it("the total falls by exactly the saved loan's typed balance in the Lainat report, in Saldot and in Säästövinkit", () => {
    expect(typed).toBeGreaterThan(14_000_000);
    expect(plain.debts.total.cents).toBe(typed + 120_000 + 14_612_345);
    expect(linked.debts.total.cents).toBe(120_000 + 14_612_345);
    // Lainat
    expect(plain.reports.loans.total.cents).toBe(plain.debts.total.cents);
    expect(linked.reports.loans.total.cents).toBe(plain.reports.loans.total.cents - typed);
    // Saldot: the debt total, and the accounts less the debts rise by what was taken twice
    expect(linked.reports.balances.debt).toEqual({ day: FRAME.today, cents: plain.reports.balances.debt.cents - typed, savedCents: 0 });
    expect(linked.reports.balances.total).toEqual(plain.reports.balances.total);
    expect(linked.reports.balances.accountsLessDebt.at(-1)).toBe(plain.reports.balances.accountsLessDebt.at(-1)! + typed);
    expect(linked.reports.balances.accountsLessDebt.at(-1)).toBe(linked.reports.balances.total.at(-1));
    // Säästövinkit
    expect(plain.area.summary?.lines[0]).toEqual({ label: "Velkaa yhteensä", value: eur(plain.debts.total.cents) });
    expect(linked.area.summary?.lines[0]).toEqual({ label: "Velkaa yhteensä", value: eur(plain.debts.total.cents - typed) });
    // the warning of the pair is gone from both pages
    expect(plain.reports.loans.maybeTwice).toHaveLength(1);
    expect(plain.area.summary?.lines.map((l) => l.label)).toContain(SAME_DEBT_TWICE);
    expect(linked.reports.loans.maybeTwice).toEqual([]);
    expect(linked.area.summary?.lines.map((l) => l.label)).not.toContain(SAME_DEBT_TWICE);
  });

  it("the interest is one figure in the report and the area, counted with the saved rate on the bank's balance", () => {
    // the mortgage's sixth due date is the latest one behind today: the bank's balance is dated there
    const due = addMonthsToDate(plain.mortgage.balanceDate, 6);
    expect([due <= FRAME.today, addMonthsToDate(plain.mortgage.balanceDate, 7) > FRAME.today]).toEqual([true, true]);
    const restated = loanInterestNext12Months({ ...plain.mortgage, balanceCents: 14_612_345, balanceDate: due }, FRAME.today);
    expect(restated.cents).toBeGreaterThan(0);
    expect(linked.debts.interest.cents).toBe(restated.cents);
    expect(linked.reports.loans.interest).toEqual(linked.debts.interest);
    expect(linked.reports.loans.interestKnown).toBe(true);
    // the card has no rate and is said to be left out; the linked mortgage is not
    expect(linked.reports.loans.withoutRate).toBe(1);
    expect(linked.area.summary?.lines[1]).toEqual({ label: "Korot 12 kuukaudessa (ilman yhtä lainaa, jonka korkoa ei tiedetä)", value: eur(restated.cents!) });
  });

  it("the mortgage findings of Säästövinkit read the same debt: the bank's balance, the saved margin and rate", () => {
    expect(plain.calc("margin", "Lainan saldo")).toBe(eur(typed));
    expect(linked.calc("margin", "Lainan saldo")).toBe(eur(14_612_345));
    expect(linked.calc("prepay", "Lainan saldo")).toBe(eur(14_612_345));
    expect(linked.calc("margin", "Oma marginaali")).toBe(plain.calc("margin", "Oma marginaali"));
    expect(linked.calc("prepay", "Lainan korko")).toBe(plain.calc("prepay", "Lainan korko"));
    expect(linked.area.checks.map((c) => `${c.id} ${c.status}`)).toEqual(plain.area.checks.map((c) => `${c.id} ${c.status}`));
  });
});
