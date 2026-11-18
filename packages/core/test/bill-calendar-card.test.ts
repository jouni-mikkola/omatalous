import { describe, expect, it } from "vitest";
import { aheadBasis } from "../src/analysis/ahead.ts";
import { createContext } from "../src/analysis/context.ts";
import { nytAnswer } from "../src/analysis/nyt.ts";
import { addDays, dateIn, daysBetween, weekdayOf } from "../src/dates.ts";
import { billCalendar } from "../src/reports/bill-calendar.ts";
import { type Account, type BalanceInput, type IsoDate, NO_INPUTS, type Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

// The bill calendar beside a connected card: the card's next bill is a row, what the card pays is in no sum of its own,
// and the rows up to the payday are the bills of Nyt.
const own: Account = { id: "own", name: "Käyttötili", iban: "FI21 1234 5600 0007 85", currency: "EUR", type: "checking" };
const card: Account = { id: "card", name: "Luottokortti", iban: null, currency: "EUR", type: "credit_card" };
const TODAY = "2026-10-20";
const PAYDAY = "2026-11-13";
const RENT = 90_017;
const STREAM = 1_299;
const OWED = 11_000;
const MONTHS = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];

const everyDay = (row: (day: IsoDate) => Transaction[]): Transaction[] => {
  const rows: Transaction[] = [];
  for (let d = "2026-03-01"; d <= TODAY; d = addDays(d, 1)) rows.push(...row(d));
  return rows;
};
/** The leg that leaves the own account, paid to the card's bank by reference, as a card's payment channel is. */
const move = (bookingDate: IsoDate, cents: number): Transaction[] => [
  tx({ accountId: "own", bookingDate, amountCents: -cents, merchant: "Esimerkkipankki", counterparty: "Esimerkkipankki", counterpartyIban: "FI49 5000 9420 0287 30", reference: "1234561", category: "transfer", categorySource: "transfer", isTransfer: true }),
  tx({ accountId: "card", bookingDate, amountCents: cents, merchant: "Maksu", category: "transfer", categorySource: "transfer", isTransfer: true }),
];
/** 20 euros of groceries a day from the own account and 10 on the card, the card's statement paid in full on each 9th from April. */
const spending = (): Transaction[] => {
  const ninths = MONTHS.slice(0, 7).map((m) => `${m}-09`);
  return [
    ...everyDay((d) => [
      tx({ accountId: "own", bookingDate: d, amountCents: -2000, merchant: "Ruokakauppa", category: "groceries" }),
      tx({ accountId: "card", bookingDate: d, amountCents: -1000, merchant: "Kahvila", category: "restaurants" }),
    ]),
    ...ninths.slice(1).flatMap((d, i) => move(d, daysBetween(ninths[i]!, d) * 1000)),
  ];
};
const household = (): Transaction[] => [
  ...spending(),
  ...MONTHS.map((m) => {
    const date = dateIn(m, 15);
    const weekday = weekdayOf(date);
    return tx({ accountId: "own", bookingDate: weekday >= 5 ? addDays(date, 4 - weekday) : date, amountCents: 300_000, merchant: "Esimerkki Oy", category: "salary" });
  }),
  ...MONTHS.map((m) => tx({ accountId: "own", bookingDate: `${m}-01`, amountCents: -RENT, merchant: "Sato Oyj", category: "housing" })),
  // a stream the card pays
  ...MONTHS.map((m) => tx({ accountId: "card", bookingDate: `${m}-03`, amountCents: -STREAM, merchant: "Esimerkki Suoratoisto", category: "entertainment" })),
].filter((t) => t.bookingDate <= TODAY);
const bal = (a: Account, balanceCents: number): BalanceInput => ({ id: a.id, name: a.name, type: a.type, balanceCents, ownerName: null, balanceAt: `${TODAY}T06:00:00Z` });
const BALANCES = [bal(own, 500_000), bal(card, -OWED)];

describe("the bill calendar with a connected card", () => {
  const ctx = createContext(household(), [own, card], TODAY);
  const cal = billCalendar(ctx, NO_INPUTS, BALANCES);
  const november = cal.months[1]!;

  it("has the card's next bill, sized by its balance, as one known row, and no other bill of the card", () => {
    const bills = cal.months.flatMap((m) => m.rows).filter((r) => r.payee === "Luottokortti");
    expect(bills).toEqual([{ date: "2026-11-09", payee: "Luottokortti", category: "card_bill", cents: OWED, state: "known", kind: "bill", seriesId: null }]);
  });

  it("leaves what the card pays out of the sums of the month, and marks the row", () => {
    const stream = november.rows.find((r) => r.payee === "Esimerkki Suoratoisto")!;
    expect(stream).toMatchObject({ cents: STREAM, state: "known", onCard: true });
    expect(november.rows.find((r) => r.payee === "Sato Oyj")!.onCard).toBeUndefined();
    expect(november.knownCents).toBe(RENT + OWED);
    // with no balances every account counts, so nothing is a card's and the bill of the card is not listed
    const all = billCalendar(ctx, NO_INPUTS).months[1]!;
    expect(all.knownCents).toBe(RENT + STREAM);
    expect(all.rows.some((r) => r.onCard)).toBe(false);
  });

  it("adds the rows up to the payday to the bills of Nyt", () => {
    const answer = nytAnswer(ctx, aheadBasis(ctx, BALANCES, NO_INPUTS));
    if (!answer.left.known) throw new Error(`no sum: ${answer.left.reason}`);
    expect(answer.left.payday?.date).toBe(PAYDAY);
    const before = cal.months.flatMap((m) => m.rows).filter((r) => r.kind !== "income" && r.state !== "paid" && !r.onCard && r.date < PAYDAY);
    expect(before.map((r) => r.payee).sort()).toEqual(["Luottokortti", "Sato Oyj"]);
    expect(before.reduce((sum, r) => sum + r.cents, 0)).toBe(answer.left.billsCents);
    expect(answer.left.billsCents).toBe(RENT + OWED);
  });

  it("has no row for the card bills the history shows as a series: they are the spending of the card", () => {
    const bills = MONTHS.map((m) => tx({ accountId: "own", bookingDate: `${m}-12`, amountCents: -40_000 - Number(m.slice(5)) * 100, merchant: "Esimerkkipankki Kortti", category: "card_bill" }));
    const onlyOwn = createContext(bills, [own], TODAY);
    expect(onlyOwn.recurring.some((s) => s.category === "card_bill" && s.active)).toBe(true);
    const rows = billCalendar(onlyOwn, NO_INPUTS).months.flatMap((m) => m.rows);
    expect(rows).toEqual([]);
  });
});
