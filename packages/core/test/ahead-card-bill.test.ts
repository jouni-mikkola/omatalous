import { describe, expect, it } from "vitest";
import { cashAhead } from "../src/analysis/ahead.ts";
import { createContext } from "../src/analysis/context.ts";
import { addDays, daysBetween } from "../src/dates.ts";
import { type Account, type BalanceInput, type IsoDate, NO_INPUTS, type Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

// A card's bill in the payday window: a lump is expected only when the payments to the card follow a statement.
const own: Account = { id: "own", name: "Käyttötili", iban: "FI21 1234 5600 0007 85", currency: "EUR", type: "checking" };
const card: Account = { id: "card", name: "Luottokortti", iban: null, currency: "EUR", type: "credit_card" };

const everyDay = (until: IsoDate, row: (day: IsoDate) => Transaction[]): Transaction[] => {
  const rows: Transaction[] = [];
  for (let d = "2026-03-01"; d <= until; d = addDays(d, 1)) rows.push(...row(d));
  return rows;
};
/** The leg that leaves the own account: paid to the card's bank by reference, as a card's payment channel is. */
const paidOut = (bookingDate: IsoDate, cents: number): Transaction =>
  tx({ accountId: "own", bookingDate, amountCents: -cents, merchant: "Esimerkkipankki", counterparty: "Esimerkkipankki", counterpartyIban: "FI79 4405 2020 0360 82", reference: "1234561", category: "transfer", categorySource: "transfer", isTransfer: true });
const move = (bookingDate: IsoDate, cents: number): Transaction[] => [
  paidOut(bookingDate, cents),
  tx({ accountId: "card", bookingDate, amountCents: cents, merchant: "Maksu", category: "transfer", categorySource: "transfer", isTransfer: true }),
];
/** 20 euros of groceries a day from the own account and `cardDaily` cents a day on the card. */
const days = (until: IsoDate, cardDaily: number): Transaction[] =>
  everyDay(until, (d) => [
    tx({ accountId: "own", bookingDate: d, amountCents: -2000, merchant: "Ruokakauppa", category: "groceries" }),
    tx({ accountId: "card", bookingDate: d, amountCents: -cardDaily, merchant: "Kahvila", category: "restaurants" }),
  ]);
const bal = (a: Account, balanceCents: number, today: IsoDate): BalanceInput => ({ id: a.id, name: a.name, type: a.type, balanceCents, ownerName: null, balanceAt: `${today}T06:00:00Z` });
const run = (today: IsoDate, rows: Transaction[], ownCents: number, cardCents: number) => cashAhead(createContext(rows, [own, card], today), [bal(own, ownCents, today), bal(card, cardCents, today)], NO_INPUTS);
const cardRowsOf = (d: ReturnType<typeof cashAhead>) => d.rows.filter((r) => r.source === "card");
/** Day 9 of each month from March up to `until`. */
const ninths = (until: IsoDate): IsoDate[] => ["03", "04", "05", "06", "07", "08", "09", "10", "11"].map((m) => `2026-${m}-09`).filter((d) => d <= until);
/** Each 9th from April pays what the card's purchases came to since the 9th before: a statement paid in full. */
const statements = (until: IsoDate, daily: number): Transaction[] => ninths(until).slice(1).flatMap((d, i) => move(d, daysBetween(ninths(until)[i]!, d) * daily));

describe("the window: a card's bill", () => {
  it("a card paid as it goes, many times a month, has no bill: its purchases are everyday spending", () => {
    const today = "2026-10-12";
    // 25 euros a day on the card, paid from the own account every third or fourth day
    const pays: Transaction[] = [];
    for (let d = "2026-03-04", i = 0; d <= today; d = addDays(d, i % 2 ? 4 : 3), i++) pays.push(...move(d, i % 2 ? 10_000 : 7500));
    const d = run(today, [...days(today, 2500), ...pays], 50_000, -76_378);
    expect(cardRowsOf(d)).toEqual([]);
    expect(d.upcoming.filter((r) => r.source === "card")).toEqual([]);
    expect(d.balance).toMatchObject({ shortCents: 0, shortOn: null });
    expect(d.everydayPerDayCents).toBe(4500);
  });

  it("a statement paid on the 9th: the next bill is what the card owes, and a short balance is told", () => {
    const today = "2026-10-20";
    // the card owes the purchases of the 11 days since the bill
    const d = run(today, [...days(today, 1000), ...statements(today, 1000)], 6000, -11_000);
    expect(cardRowsOf(d)).toEqual([{ date: "2026-11-09", name: "Luottokortti", category: "transfer", cents: -11_000, source: "card", basis: "balance" }]);
    expect(d.balance).toMatchObject({ shortOn: "2026-11-09", shortCents: 5000 });
    expect(d.everydayPerDayCents).toBe(2000);
  });

  it("a statement paid in full with nothing left on the card: no bill and no warning", () => {
    const today = "2026-10-20";
    const d = run(today, [...days(today, 1000), ...statements(today, 1000)], 6000, 0);
    expect(cardRowsOf(d)).toEqual([]);
    expect(d.balance).toMatchObject({ shortCents: 0, shortOn: null });
  });

  it("minimum payments only: the usual payment is the bill, never more than the card owes", () => {
    const today = "2026-10-20";
    const pays = ninths(today).flatMap((d) => move(d, 5000));
    const debt = run(today, [...days(today, 300), ...pays], 100_000, -200_000);
    expect(cardRowsOf(debt)).toEqual([{ date: "2026-11-09", name: "Luottokortti", category: "transfer", cents: -5000, source: "card", basis: "usual" }]);
    const little = run(today, [...days(today, 300), ...pays], 100_000, -3000);
    expect(cardRowsOf(little).map((r) => r.cents)).toEqual([-3000]);
  });

  it("a payment that left the account before the card shows it is that card's bill: it is not expected again", () => {
    const today = "2026-10-10";
    const earlier = statements("2026-09-30", 1000);
    // September's 30 days left the own account on the 9th; the card shows it a day later, or pending
    const late = [...days(today, 1000), ...earlier, paidOut("2026-10-09", 30_000)];
    const pending = [...late, tx({ accountId: "card", bookingDate: today, amountCents: 30_000, merchant: "Maksu", category: "transfer", status: "pending" })];
    for (const rows of [late, pending]) {
      // the card's balance does not hold the payment yet
      const d = run(today, rows, 50_000, -32_000);
      expect(cardRowsOf(d).map((r) => [r.date, r.cents])).toEqual([["2026-11-09", -2000]]);
      expect(d.balance).toMatchObject({ shortCents: 0, shortOn: null });
    }
  });

  it("a bill paid before its day is paid: the next one is a month on", () => {
    const today = "2026-10-07";
    const rows = [...days(today, 1000), ...statements("2026-09-30", 1000), ...move("2026-10-05", 26_000)];
    const d = run(today, rows, 50_000, -2000);
    expect(cardRowsOf(d).map((r) => r.date)).toEqual([]);
    expect(d.upcoming.filter((r) => r.source === "card")).toEqual([]);
  });

  it("payments on days that never repeat, nine a month, are no statement", () => {
    const today = "2026-10-12";
    const payDays = [1, 4, 9, 10, 13, 19, 22, 24, 29];
    const months = ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
    const pays = months.flatMap((m, i) => payDays.map((n) => `${m}-${String(n).padStart(2, "0")}`).filter((d) => d <= today).flatMap((d, j) => move(d, 15_000 + ((i * 7 + j * 13) % 30) * 1000)));
    const d = run(today, [...days(today, 3000), ...pays], 20_000, -76_378);
    expect(cardRowsOf(d)).toEqual([]);
    expect(d.balance).toMatchObject({ shortCents: 0, shortOn: null });
  });
});
