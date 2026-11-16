/**
 * A connected card beside a saved loan in the Lainat report (`analysis/card-settled.ts`): a card whose statement is
 * paid in full costs no interest and reaches zero at its next statement, so the household's interest and path stay known.
 * A card the rows do not show paid in full stays unknown. Made-up accounts and loans only.
 */
import { describe, expect, it } from "vitest";
import { debtsOf } from "../src/analysis/card-settled.ts";
import { createContext } from "../src/analysis/context.ts";
import { addDays, daysBetween } from "../src/dates.ts";
import { loansReport } from "../src/reports/loans.ts";
import type { Account, BalanceInput, IsoDate, Loan, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const today = "2026-10-20";
const own: Account = { id: "own", name: "Käyttötili", iban: "FI21 1234 5600 0007 85", currency: "EUR", type: "checking" };
const card: Account = { id: "card", name: "Luottokortti", iban: null, currency: "EUR", type: "credit_card" };
const mortgage: Loan = {
  id: "mortgage", name: "Asuntolaina", lender: null, kind: "mortgage", grantedCents: null, balanceCents: 10_000_000, balanceDate: "2026-10-01", rateBp: 400, reference: null, marginBp: null,
  repayment: "annuity", intervalMonths: 1, paymentCents: 100_000, endDate: null, limitCents: null, seriesKey: null,
};

const everyDay = (until: IsoDate, row: (day: IsoDate) => Transaction[]): Transaction[] => {
  const rows: Transaction[] = [];
  for (let d = "2026-03-01"; d <= until; d = addDays(d, 1)) rows.push(...row(d));
  return rows;
};
const move = (bookingDate: IsoDate, cents: number): Transaction[] => [
  tx({ accountId: "own", bookingDate, amountCents: -cents, merchant: "Esimerkkipankki", counterparty: "Esimerkkipankki", counterpartyIban: "FI49 5000 9420 0287 30", reference: "1234561", category: "transfer", categorySource: "transfer", isTransfer: true }),
  tx({ accountId: "card", bookingDate, amountCents: cents, merchant: "Maksu", category: "transfer", categorySource: "transfer", isTransfer: true }),
];
/** 20 euros of groceries a day from the own account and `cardDaily` cents a day on the card. */
const days = (cardDaily: number): Transaction[] =>
  everyDay(today, (d) => [
    tx({ accountId: "own", bookingDate: d, amountCents: -2000, merchant: "Ruokakauppa", category: "groceries" }),
    tx({ accountId: "card", bookingDate: d, amountCents: -cardDaily, merchant: "Kahvila", category: "restaurants" }),
  ]);
const ninths = ["03", "04", "05", "06", "07", "08", "09", "10"].map((m) => `2026-${m}-09`);
/** Each 9th from April pays what the card's purchases came to since the 9th before: a statement paid in full. `paid` names the sum of a 9th that is another. */
const statements = (daily: number, paid: Record<string, number> = {}, extra = 0): Transaction[] =>
  ninths.slice(1).flatMap((d, i) => move(d, paid[d] ?? daysBetween(ninths[i]!, d) * daily + extra));
/** The interest the card charges, on each of the given days. */
const interest = (days: readonly IsoDate[], cents: number): Transaction[] =>
  days.map((bookingDate) => tx({ accountId: "card", bookingDate, amountCents: -cents, merchant: "Korko", category: "interest" }));
/** The 9th pays 50 euros whatever the card owes: minimum payments only. */
const minimums = (): Transaction[] => ninths.flatMap((d) => move(d, 5000));

const bal = (a: Account, balanceCents: number): BalanceInput => ({ id: a.id, name: a.name, type: a.type, balanceCents, ownerName: null, balanceAt: `${today}T06:00:00Z` });
function run(rows: Transaction[], cardCents: number) {
  const balances = [bal(own, 600_000), bal(card, cardCents)];
  const ctx = createContext(rows, [own, card], today);
  return loansReport(ctx, balances, { marks: [], expectedBills: [], loans: [mortgage] });
}

describe("a card beside a rated loan in Lainat", () => {
  it("a card paid in full costs no interest and is paid at its next statement: the household's interest and path are known", () => {
    const r = run([...days(1000), ...statements(1000)], -11_000);
    const cardRow = r.loans.find((l) => l.id === "account:card")!;
    expect(cardRow.interest).toEqual({ cents: 0, unknown: null });
    expect(r.interestKnown).toBe(true);
    // the mortgage's interest is the household's: the card adds none
    expect(r.interest.cents).toBe(r.loans.find((l) => l.id === "mortgage")!.interest.cents);
    expect(r.totalKnown).toBe(true);
    expect(r.path).not.toBeNull();
    // today the card's 110 euros are in what is owed; at its statement of 9.11. they are paid
    expect(r.path!.balanceCents[0]).toBe(10_000_000 + 11_000);
    expect(r.path!.balanceCents[1]).toBeLessThan(10_000_000);
    expect(r.path!.tops.at(-1)).toBe(0);
  });

  it("a card that is not paid in full has no interest figure, and the household's is unknown with it", () => {
    const r = run([...days(300), ...minimums()], -200_000);
    const cardRow = r.loans.find((l) => l.id === "account:card")!;
    expect(cardRow.interest.cents).toBeNull();
    expect(r.interestKnown).toBe(false);
    expect(r.path).toBeNull();
  });

  it("a card paid in full by its bills that also charges interest every month stays unknown", () => {
    const firsts = ["04", "05", "06", "07", "08", "09", "10"].map((m) => `2026-${m}-01`);
    const r = run([...days(1000), ...statements(1000, {}, 500), ...interest(firsts, 500)], -11_000);
    expect(r.interestKnown).toBe(false);
    expect(r.path).toBeNull();
  });

  it("a card paid in full before but only partly on its last bill stays unknown: the interest that follows shows it", () => {
    // the 9th of October pays 5 euros of its 300, so the card owes the rest still, and it charges interest after the bill
    const r = run([...days(1000), ...statements(1000, { "2026-10-09": 500 }), ...interest(["2026-10-15"], 500)], -41_000);
    expect(r.interestKnown).toBe(false);
    expect(r.path).toBeNull();
  });

  it("a card whose last bill was fine but one of the two before it was a small one stays unknown", () => {
    // August's bill leaves most of the statement to carry and September's is less than what was carried into it: October then pays it all
    const r = run([...days(1000), ...statements(1000, { "2026-08-09": 5_000, "2026-09-09": 20_000, "2026-10-09": 67_000 })], -11_000);
    expect(r.interestKnown).toBe(false);
    expect(r.path).toBeNull();
  });

  it("a card with no rows to tell its statement from is unknown too", () => {
    const r = run([], -11_000);
    expect(r.interestKnown).toBe(false);
    expect(r.path).toBeNull();
  });
});

describe("the debts of a card paid in full", () => {
  const rateOf = (rows: Transaction[], loans: Loan[], cardCents = -11_000) => {
    const balances = [bal(own, 600_000), bal(card, cardCents)];
    const debts = debtsOf(createContext(rows, [own, card], today), balances, { marks: [], expectedBills: [], loans });
    return debts.connected[debts.sources.findIndex((s) => s.accountId === "card")]!.rateBp;
  };
  const linked: Loan = { ...mortgage, id: "card-loan", name: "Kortti", kind: "card", balanceCents: 11_000, rateBp: null, repayment: null, intervalMonths: null, paymentCents: null, limitCents: 200_000, accountId: "card" };

  it("is told as a rate of 0, and a card the rows do not show paid in full has none", () => {
    expect(rateOf([...days(1000), ...statements(1000)], [])).toBe(0);
    expect(rateOf([...days(300), ...minimums()], [], -200_000)).toBeNull();
  });

  it("keeps the rate of the loan linked to it, so a card with a loan saved without a rate shows no 0", () => {
    expect(rateOf([...days(1000), ...statements(1000)], [linked])).toBeNull();
    expect(rateOf([...days(1000), ...statements(1000)], [{ ...linked, rateBp: 1_900 }])).toBe(1_900);
  });
});
