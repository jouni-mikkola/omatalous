import { describe, expect, it } from "vitest";
import { aheadBasis } from "../src/analysis/ahead.ts";
import { createContext } from "../src/analysis/context.ts";
import { runwayOf } from "../src/analysis/runway.ts";
import { bufferReport } from "../src/reports/buffer.ts";
import { addDays, dateIn, daysBetween, fromMonthIndex, monthIndex, weekdayOf } from "../src/dates.ts";
import { type Account, type BalanceInput, type IsoDate, NO_INPUTS, type Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

// Jää palkkapäivänä: the counted accounts' balance less what leaves before the payday, a card's purchases once.
const own: Account = { id: "own", name: "Käyttötili", iban: "FI21 1234 5600 0007 85", currency: "EUR", type: "checking" };
const card: Account = { id: "card", name: "Luottokortti", iban: null, currency: "EUR", type: "credit_card" };
const TODAY = "2026-10-26";
const DAILY = 4000;
/** The 15th of November is a Sunday: the pay comes on the Friday before. */
const PAYDAY = "2026-11-13";
const RENT = 90_000;
const bal = (a: Account, balanceCents: number): BalanceInput => ({ id: a.id, name: a.name, type: a.type, balanceCents, ownerName: null, balanceAt: `${TODAY}T06:00:00Z` });

/** A pay on the `day` of each month from `first` to `last`, on the Friday before when it falls on a weekend. */
function pays(first: string, last: string, day = 15): Transaction[] {
  const rows: Transaction[] = [];
  for (let m = monthIndex(first); m <= monthIndex(last); m++) {
    const date = dateIn(fromMonthIndex(m), day);
    const weekday = weekdayOf(date);
    rows.push(tx({ accountId: "own", bookingDate: weekday >= 5 ? addDays(date, 4 - weekday) : date, amountCents: 300_000, merchant: "Esimerkki Oy", category: "salary" }));
  }
  return rows;
}
/** Rent on the 1st of each month from `first`. */
const rents = (first: string): Transaction[] =>
  Array.from({ length: monthIndex("2026-10") - monthIndex(first) + 1 }, (_, i) => tx({ accountId: "own", bookingDate: `${fromMonthIndex(monthIndex(first) + i)}-01`, amountCents: -RENT, merchant: "Sato Oyj", category: "housing" }));
/** A purchase of `cents` every day from `from` to today, on `accountId`. */
const shopping = (accountId: string, from: IsoDate, cents: (day: IsoDate) => number = () => DAILY, today: IsoDate = TODAY): Transaction[] => {
  const rows: Transaction[] = [];
  for (let d = from; d <= today; d = addDays(d, 1)) rows.push(tx({ accountId, bookingDate: d, amountCents: -cents(d), merchant: "Ruokakauppa", category: "groceries" }));
  return rows;
};
/** The 9th of each month the card is paid on, up to today. */
const NINTHS = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"].map((m) => `${m}-09`);
/** A card bill paid in full on each 9th from April: what the card's purchases came to since the 9th before. */
const statements = (): Transaction[] =>
  NINTHS.slice(1).flatMap((d, i) => {
    const cents = daysBetween(NINTHS[i]!, d) * DAILY;
    return [
      tx({ accountId: "own", bookingDate: d, amountCents: -cents, merchant: "Esimerkkipankki", counterparty: "Esimerkkipankki", counterpartyIban: "FI79 4405 2020 0360 82", reference: "1234561", category: "transfer", categorySource: "transfer", isTransfer: true }),
      tx({ accountId: "card", bookingDate: d, amountCents: cents, merchant: "Maksu", category: "transfer", categorySource: "transfer", isTransfer: true }),
    ];
  });

/** The days since the last 9th are on the card: it owes them, and that is the bill of the 9th of November. */
const OWED = daysBetween("2026-10-09", TODAY) * DAILY;

function run(rows: Transaction[], balances: BalanceInput[] = [bal(own, 200_000), bal(card, -OWED)], today: IsoDate = TODAY) {
  const ctx = createContext(rows.filter((t) => t.bookingDate <= today), [own, card], today);
  const basis = aheadBasis(ctx, balances, NO_INPUTS);
  return { ...basis, runway: runwayOf(ctx, basis) };
}
const known = (r: ReturnType<typeof runwayOf>) => {
  if (!r.known) throw new Error(`no runway: ${r.reason}`);
  return r;
};

describe("Jää palkkapäivänä", () => {
  const onCard = [...pays("2026-03", "2026-10"), ...rents("2026-03"), ...shopping("card", "2026-03-01"), ...statements()];
  const onDebit = [...pays("2026-03", "2026-10"), ...rents("2026-03"), ...shopping("own", "2026-03-01")];

  it("a household that buys on a monthly billed card has everyday spending above 0 a day, and the first page tells it", () => {
    const { ahead, runway } = run(onCard);
    const r = known(runway);
    // the bill names its card, so the card's row of the first page can say when its next bill is paid
    expect(ahead.rows.filter((x) => x.source === "card")).toMatchObject([{ date: "2026-11-09", cents: -OWED, basis: "balance", cardId: card.id }]);
    expect(r.payday).toEqual({ date: PAYDAY, name: "Esimerkki Oy" });
    expect(ahead.everydayPerDayCents).toBeGreaterThan(0);
    // the same purchases on the account itself would be spent from it: the card's share is the whole of what the account pays here
    expect(r.everydayCents + r.billedCents + r.laterCents).toBe(known(run(onDebit, [bal(own, 200_000)]).runway).everydayCents);
  });

  it("the first page's payments before the payday are the Velat lines added: the card's debt and the other bills", () => {
    const balances = [bal(own, 200_000), bal(card, -OWED)];
    const { ahead } = run(onCard, balances);
    const buffer = bufferReport(createContext(onCard, [own, card], TODAY), balances);
    // the first page counts the card's bill among the payments; Velat names it Korttivelka and the rest Muut laskut
    expect(ahead.totals.transferCents).toBe(0);
    expect(buffer.cardDebtCents).toBe(ahead.totals.cardCents);
    expect(buffer.cardDebtCents + buffer.dueBeforePaydayCents).toBe(ahead.totals.leavingCents);
    expect(buffer.dueBeforePaydayCents).toBe(RENT);
  });

  it("on the last day of the month the card's bill still has everyday spending to read: the next month has no complete month yet", () => {
    const LAST: IsoDate = "2026-10-31";
    const rows = [...pays("2026-03", "2026-10"), ...rents("2026-03"), ...shopping("card", "2026-03-01", () => DAILY, LAST), ...statements()];
    const owed = daysBetween("2026-10-09", LAST) * DAILY;
    const r = run(rows, [bal(own, 200_000), bal(card, -owed)], LAST).runway;
    expect(r.known, r.known ? "" : `no runway: ${r.reason}`).toBe(true);
    expect(known(r).billedCents).toBe(daysBetween(LAST, "2026-11-09") * DAILY);
  });

  it("takes the card's bill off once: the bill holds what the card owes and the purchases to its day, and later purchases wait for the next one", () => {
    const { ahead, runway } = run(onCard);
    const r = known(runway);
    expect(r.freeCents).toBe(ahead.balance!.freeCents);
    // the card owes 17 days; the bill of the 9th takes the 14 days after today as well, so it is 31 days, as the bills of the history are
    const BILLED = daysBetween(TODAY, "2026-11-09") * DAILY;
    expect(BILLED).toBe(14 * DAILY);
    expect(r.freeCents).toBe(200_000 - OWED - RENT);
    expect(r.everydayCents).toBe(0);
    expect(r.billedCents).toBe(BILLED);
    expect(r.leftCents).toBe(200_000 - (OWED + BILLED) - RENT);
    // today and the three days from the 10th to the payday's eve: the bill of the 9th does not hold them
    expect(r.laterCents).toBe(4 * DAILY);
    expect(r.lowCents).toBe(r.leftCents);
    expect(r.highCents).toBe(r.leftCents);
  });

  it("a card paid in full with nothing owed today still has a bill before the payday that takes the days to its day", () => {
    const { ahead, runway } = run(onCard, [bal(own, 200_000), bal(card, 0)]);
    const r = known(runway);
    expect(ahead.rows.filter((x) => x.source === "card")).toEqual([]);
    expect(r.billedCents).toBe(14 * DAILY);
    expect(r.leftCents).toBe(200_000 - RENT - 14 * DAILY);
  });

  it("a bill after the payday takes nothing off", () => {
    // paid on the 20th: the payday is the 13th, so the card's bill and its purchases are all after it
    const late = onCard.filter((t) => !t.isTransfer || t.bookingDate < "2026-04-01");
    const lateBills = [...NINTHS.slice(1)].flatMap((d, i) =>
      ["own", "card"].map((accountId, k) => tx({ accountId, bookingDate: `${d.slice(0, 8)}20`, amountCents: (k ? 1 : -1) * daysBetween(NINTHS[i]!, d) * DAILY, merchant: k ? "Maksu" : "Esimerkkipankki", counterparty: k ? null : "Esimerkkipankki", counterpartyIban: k ? null : "FI79 4405 2020 0360 82", reference: k ? null : "1234561", category: "transfer", categorySource: "transfer", isTransfer: true })),
    );
    const { ahead, runway } = run([...late, ...lateBills.filter((t) => t.bookingDate <= TODAY)], [bal(own, 200_000), bal(card, -OWED)]);
    const r = known(runway);
    const bills = ahead.upcoming.filter((x) => x.source === "card");
    expect(bills.length).toBeGreaterThan(0);
    expect(bills.every((x) => x.date > PAYDAY)).toBe(true);
    expect(ahead.rows.some((x) => x.source === "card")).toBe(false);
    expect(r.billedCents).toBe(0);
    expect(r.leftCents).toBe(r.freeCents);
  });

  it("takes the everyday spending of the account itself off the days to the payday, with a range from the months", () => {
    // 10 euros more a day in a month than in the one before: the base months differ
    const varies = [...pays("2026-03", "2026-10"), ...rents("2026-03"), ...shopping("own", "2026-03-01", (d) => DAILY + 1000 * (monthIndex(d.slice(0, 7)) % 3))];
    const { ahead, runway } = run(varies, [bal(own, 500_000)]);
    const r = known(runway);
    expect(r.days).toBe(daysBetween(TODAY, PAYDAY));
    expect(r.everydayCents).toBeGreaterThan(0);
    expect(r.laterCents).toBe(0);
    expect(r.leftCents).toBe(ahead.balance!.freeCents - r.everydayCents);
    expect(r.lowCents).toBeLessThan(r.leftCents);
    expect(r.highCents).toBeGreaterThan(r.leftCents);
    // an ordinary stretch of days: about what a day costs times the days
    expect(r.everydayCents / r.days).toBeGreaterThan(DAILY * 0.9);
    expect(r.everydayCents / r.days).toBeLessThan(DAILY * 1.5);
  });

  it("is a range of one figure when every base month spent the same", () => {
    const r = known(run(onDebit, [bal(own, 500_000)]).runway);
    expect(r.lowCents).toBeLessThanOrEqual(r.leftCents);
    expect(r.highCents).toBeGreaterThanOrEqual(r.leftCents);
  });
});

describe("when it says why it cannot say", () => {
  it("an unknown payday gives the reason and no figure", () => {
    const { runway } = run([...rents("2026-03"), ...shopping("own", "2026-03-01")], [bal(own, 200_000)]);
    expect(runway).toEqual({ known: false, reason: "no-payday" });
  });

  it("a pay that is late gives that reason", () => {
    const { runway } = run([...pays("2026-03", "2026-09", 20), ...rents("2026-03"), ...shopping("own", "2026-03-01")], [bal(own, 200_000)]);
    // the pay of the 20th is six days late
    expect(runway).toEqual({ known: false, reason: "late" });
  });

  it("a counted account without a balance gives that reason", () => {
    const { runway } = run([...pays("2026-03", "2026-10"), ...rents("2026-03"), ...shopping("own", "2026-03-01")], []);
    expect(runway).toEqual({ known: false, reason: "no-balance" });
  });

  it("under three complete months there is no everyday spending to expect", () => {
    const { runway } = run([...pays("2026-08", "2026-10"), ...rents("2026-08"), ...shopping("own", "2026-08-01")], [bal(own, 200_000)]);
    expect(runway).toEqual({ known: false, reason: "history" });
  });
});
