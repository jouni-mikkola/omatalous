import { describe, expect, it } from "vitest";
import { aheadBasis } from "../src/analysis/ahead.ts";
import { createContext } from "../src/analysis/context.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import { runwayOf } from "../src/analysis/runway.ts";
import { addDays, dateIn, daysBetween, daysInMonth, fromMonthIndex, monthIndex, weekdayOf } from "../src/dates.ts";
import { lowPoint } from "../src/low-point.ts";
import { LOW_POINT_DAYS } from "../src/thresholds.ts";
import { type Account, type BalanceInput, type ExpectedBill, type IsoDate, type Loan, NO_INPUTS, type Transaction, type UserInputs } from "../src/types.ts";
import { tx } from "./helpers.ts";

// The lowest balance of the next days, worked by hand. One household on one checking account, today 26.10.2026: the pay
// lands on the 15th (13.11. when the 15th is a Sunday), the rent of 900 € on the 1st, and with everyday spending a purchase
// of 40 € a day. The payday that the first page waits for is 13.11.
const own: Account = { id: "own", name: "Käyttötili", iban: "FI21 1234 5600 0007 85", currency: "EUR", type: "checking" };
const TODAY = "2026-10-26";
const RANGE = { from: "2026-10-01", to: "2026-10-31" };
const RENT = 90_000;
const bal = (balanceCents: number): BalanceInput => ({ id: own.id, name: own.name, type: own.type, balanceCents, ownerName: null, balanceAt: `${TODAY}T06:00:00Z` });

function pays(first = "2026-03", last = "2026-10", day = 15, cents = 300_000): Transaction[] {
  const rows: Transaction[] = [];
  for (let m = monthIndex(first); m <= monthIndex(last); m++) {
    const date = dateIn(fromMonthIndex(m), day);
    const weekday = weekdayOf(date);
    rows.push(tx({ accountId: own.id, bookingDate: weekday >= 5 ? addDays(date, 4 - weekday) : date, amountCents: cents, merchant: "Esimerkki Oy", category: "salary" }));
  }
  return rows;
}
const rents = (first = "2026-03", day = 1): Transaction[] =>
  Array.from({ length: monthIndex("2026-10") - monthIndex(first) + 1 }, (_, i) => tx({ accountId: own.id, bookingDate: dateIn(fromMonthIndex(monthIndex(first) + i), day), amountCents: -RENT, merchant: "Sato Oyj", category: "housing" }));
/** A purchase of `cents` every day from `from` to today; `more` names the months that have a second one of the same size from another shop. */
function shopping(from: IsoDate, cents: number, more: readonly string[] = []): Transaction[] {
  const rows: Transaction[] = [];
  for (let d = from; d <= TODAY; d = addDays(d, 1)) {
    rows.push(tx({ accountId: own.id, bookingDate: d, amountCents: -cents, merchant: "Ruokakauppa", category: "groceries" }));
    if (more.includes(d.slice(0, 7))) rows.push(tx({ accountId: own.id, bookingDate: d, amountCents: -cents, merchant: "Kioski", category: "groceries" }));
  }
  return rows;
}

/** The lowest balance of `days` days for the rows and the balance, with the figures it is held against. */
function walk(rows: Transaction[], balances: BalanceInput[], days?: number, inputs: UserInputs = NO_INPUTS, accounts: Account[] = [own]) {
  const ctx = createContext(rows, accounts, TODAY);
  const basis = aheadBasis(ctx, balances, inputs);
  return { ctx, basis, point: lowPoint(ctx, basis, balances, inputs, days), runway: runwayOf(ctx, basis) };
}

describe("lowPoint with no everyday spending", () => {
  // 500 € on the account, the rent of 900 € on 1.11. and the pay of 3 000 € on 13.11.
  const rows = [...pays(), ...rents()];

  it("is the lowest point of the payday window that Käytettävissä finds: the day it runs short and by how much", () => {
    const { basis, point } = walk(rows, [bal(50_000)], 19);
    const { balance } = basis.ahead;
    expect(basis.ahead.to).toBe("2026-11-12");
    expect(point).toEqual({ known: true, date: "2026-11-01", cents: -40_000, lowCents: -40_000, highCents: -40_000, days: 19 });
    expect(balance!.shortOn).toBe(point.known ? point.date : null);
    expect(balance!.shortCents).toBe(point.known ? -point.cents : null);
  });

  it("counts a pay only from its own day: a payment on the payday is met from the balance before it", () => {
    // the rent is booked on the 13th, the day of the pay: 500 € less 900 € is -400 € that day, not +2 600 €
    const { basis, point } = walk([...pays(), ...rents("2026-03", 13)], [bal(50_000)], 19);
    // the payday window of Käytettävissä ends the day before the pay, so it does not see this payment
    expect(point).toEqual({ known: true, date: "2026-11-13", cents: -40_000, lowCents: -40_000, highCents: -40_000, days: 19 });
    expect(basis.ahead.to).toBe("2026-11-12");
    expect(basis.ahead.balance!.shortOn).toBeNull();
  });

  it("counts the 60th day and not the 61st: a payment on the last day is the lowest, one a day later is left out", () => {
    // 24.12. is the 60th day from today, 26.10., counted as day one. 1 500 €, the pay of 600 € on 13.11. and 15.12., rent of 900 €
    const small = (day: number) => [...pays("2026-03", "2026-10", 15, 60_000), ...rents("2026-03", day)];
    // rent on the 24th: 1 500 € + 600 € - 900 € = 1 200 € on 24.11., and 1 200 € + 600 € - 900 € = 900 € on 24.12., the 60th day
    expect(walk(small(24), [bal(150_000)]).point).toEqual({ known: true, date: "2026-12-24", cents: 90_000, lowCents: 90_000, highCents: 90_000, days: 60 });
    expect(walk(small(24), [bal(150_000)], 59).point).toMatchObject({ known: true, date: "2026-11-24", cents: 120_000 });
    // rent on the 25th falls on the 61st day: the lowest of 60 days is the one of 25.11., and 61 days reach 25.12.
    expect(walk(small(25), [bal(150_000)]).point).toMatchObject({ known: true, date: "2026-11-25", cents: 120_000 });
    expect(walk(small(25), [bal(150_000)], 61).point).toMatchObject({ known: true, date: "2026-12-25", cents: 90_000 });
  });

  it("looks 60 days ahead by default, past the next payday, where the pay of 600 € does not cover the rent of 900 €", () => {
    const small = [...pays("2026-03", "2026-10", 15, 60_000), ...rents()];
    // 1 500 € - 900 € on 1.11. = 600 €, +600 € on 13.11. = 1 200 €, - 900 € on 1.12. = 300 €
    const long = walk(small, [bal(150_000)]).point;
    expect(long).toMatchObject({ known: true, date: "2026-12-01", cents: 30_000, days: LOW_POINT_DAYS });
    expect(LOW_POINT_DAYS).toBe(60);
    // the payday window alone ends before it
    expect(walk(small, [bal(150_000)], 19).point).toMatchObject({ known: true, date: "2026-11-01", cents: 60_000 });
  });
});

describe("lowPoint with everyday spending", () => {
  it("takes 40 € a day off as the runway does: the balance of 13.11. is the figure of Jää palkkapäivänä", () => {
    // 9 000 € - 900 € rent = 8 100 €, less 18 days (26.10. to 12.11.) of 40 € = 7 380 € on the payday, the lowest of the 30 days
    const { point, runway } = walk([...pays(), ...rents(), ...shopping("2026-03-01", 4000)], [bal(900_000)], 30);
    expect(point).toEqual({ known: true, date: "2026-11-13", cents: 738_000, lowCents: 738_000, highCents: 738_000, days: 30 });
    expect(runway.known && runway.leftCents).toBe(738_000);
  });

  it("gives a range from the base months that spent the most to those that spent the least", () => {
    // Jul to Sep spent 80 € a day (a second shop), Apr to Jun 40 €: the mean is 60 €, the quartiles 40 € and 80 €
    const rows = [...pays(), ...rents(), ...shopping("2026-03-01", 4000, ["2026-07", "2026-08", "2026-09"])];
    const { point, runway } = walk(rows, [bal(900_000)], 30);
    // 8 100 € on 13.11. less 18 days of 60 € = 7 020 €; of 80 € = 6 660 €; of 40 € = 7 380 €
    expect(point).toEqual({ known: true, date: "2026-11-13", cents: 702_000, lowCents: 666_000, highCents: 738_000, days: 30 });
    expect(runway.known && [runway.leftCents, runway.lowCents, runway.highCents]).toEqual([702_000, 666_000, 738_000]);
  });

  describe("where a card's purchases are only a bill", () => {
    // a card never connected pays by a bill on the 9th, 300 € + 10 € a month (330 € in March, 400 € in October), which
    // holds its purchases in no category and on no day. The next bill is the median of the last three, 390 € on 9.11.
    const billOf = (month: string) => 30_000 + 1000 * Number(month.slice(5, 7));
    const bills = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"].map((m) =>
      tx({ accountId: own.id, bookingDate: `${m}-09`, amountCents: -billOf(m), merchant: "Esimerkkipankki", counterparty: "Esimerkkipankki", category: "card_bill" }),
    );
    const rows = [...pays(), ...rents(), ...shopping("2026-03-01", 4000), ...bills];
    // the base months April to September spread each bill over the days of its month: the card's purchases of a day
    const perDay = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"].reduce((n, m) => n + billOf(m) / daysInMonth(m), 0) / 6;

    it("Jää palkkapäivänä takes the next bill off once: the purchases after it wait for the bill after the payday", () => {
      const { basis, runway } = walk(rows, [bal(900_000)], 19);
      if (!runway.known) throw new Error("no runway");
      expect(basis.ahead.to).toBe("2026-11-12");
      // 9 000 € less the rent of 900 € and the bill of 390 € (Käytettävissä), less 40 € a day on the 18 days 26.10.-12.11.
      expect(runway.freeCents).toBe(900_000 - RENT - 39_000);
      expect(runway.everydayCents).toBe(18 * 4000);
      expect(runway.leftCents).toBe(699_000);
      expect([runway.lowCents, runway.highCents]).toEqual([699_000, 699_000]);
      // the card's purchases of the 18 days are in a bill after the payday
      expect(Math.abs(runway.laterCents - 18 * perDay)).toBeLessThanOrEqual(1);
    });

    it("the lowest balance walks the bill on its day and takes the card's purchases off only after it, never above Jää palkkapäivänä", () => {
      for (const days of [19, 30, 60]) {
        const { point, runway } = walk(rows, [bal(900_000)], days);
        if (!point.known || !runway.known) throw new Error("no lowest balance");
        // 13.11. starts with 699 000 less the card's purchases of 10.-12.11., the three days after its bill
        expect(point.date).toBe("2026-11-13");
        expect(Math.abs(point.cents - (runway.leftCents - 3 * perDay))).toBeLessThanOrEqual(1);
        expect(point.highCents).toBeLessThanOrEqual(runway.leftCents);
        expect(point.lowCents).toBeLessThanOrEqual(point.cents);
        expect(point.cents).toBeLessThanOrEqual(point.highCents);
      }
    });
  });

  it("keeps the low end of the range at or under the figure and the figure at or under the high end", () => {
    const rows = [...pays(), ...rents(), ...shopping("2026-03-01", 4000, ["2026-07", "2026-08", "2026-09"])];
    for (const days of [1, 7, 19, 45, 60]) {
      const { point } = walk(rows, [bal(900_000)], days);
      if (!point.known) throw new Error("no lowest balance");
      expect(point.lowCents).toBeLessThanOrEqual(point.cents);
      expect(point.cents).toBeLessThanOrEqual(point.highCents);
    }
  });
});

describe("lowPoint that cannot be said", () => {
  const everyday = shopping("2026-03-01", 4000);

  it("gives the reason, never 0, without a payday", () => {
    expect(walk([...rents(), ...everyday], [bal(200_000)]).point).toEqual({ known: false, reason: "no-payday", days: 60 });
  });

  it("gives the reason when the pay is late", () => {
    // the pay of the 20th is six days late
    expect(walk([...pays("2026-03", "2026-09", 20), ...rents(), ...everyday], [bal(200_000)]).point).toEqual({ known: false, reason: "late", days: 60 });
  });

  it("gives the reason when a counted account has no balance", () => {
    expect(walk([...pays(), ...rents(), ...everyday], []).point).toEqual({ known: false, reason: "no-balance", days: 60 });
  });

  it("gives the reason when there are under three complete months to expect everyday spending from", () => {
    expect(walk([...pays("2026-08"), ...rents("2026-08"), ...shopping("2026-08-01", 4000)], [bal(200_000)]).point).toEqual({ known: false, reason: "history", days: 60 });
  });

  it("gives the reason, not a complete figure, while the sum or day of a bill is not known", () => {
    // a typed bill with no sum: its day passes, but what it costs is not known, so a lowest balance would pass for a safe one
    const unknown: ExpectedBill = { id: "b1", name: "Sähkö Oy", amountCents: 0, dueDate: "2026-11-20", cadence: "once", category: "utilities" };
    const inputs = { ...NO_INPUTS, expectedBills: [unknown] };
    expect(walk([...pays(), ...rents(), ...everyday], [bal(900_000)], undefined, inputs).point).toEqual({ known: false, reason: "bills", days: 60 });
    // the same household with the sum known has a figure
    const typed = { ...NO_INPUTS, expectedBills: [{ ...unknown, amountCents: 8000 }] };
    expect(walk([...pays(), ...rents(), ...everyday], [bal(900_000)], undefined, typed).point.known).toBe(true);
  });

  it("gives the reason for a bill with no sum on the 60th day, and a figure for one on the 61st or far beyond", () => {
    // the 60 days run from 26.10. to 24.12.
    const rows = [...pays(), ...rents(), ...everyday];
    const bills = (dueDate: string): UserInputs => ({ ...NO_INPUTS, expectedBills: [{ id: "b2", name: "Sähkö Oy", amountCents: 0, dueDate, cadence: "once", category: "utilities" }] });
    const without = walk(rows, [bal(900_000)]).point;
    expect(without.known).toBe(true);
    expect(walk(rows, [bal(900_000)], undefined, bills("2026-12-24")).point).toEqual({ known: false, reason: "bills", days: 60 });
    // a bill that falls on the 61st day or ten months later cannot change the lowest balance of the 60 days
    expect(walk(rows, [bal(900_000)], undefined, bills("2026-12-25")).point).toEqual(without);
    expect(walk(rows, [bal(900_000)], undefined, bills("2027-09-05")).point).toEqual(without);
  });

  it("gives the reason while the day of a loan's payment is not known", () => {
    const loan: Loan = {
      id: "loan-1", name: "Remonttilaina", lender: "ESIMERKKIPANKKI", kind: "mortgage", grantedCents: null, balanceCents: 1_000_000, balanceDate: "2026-10-01", rateBp: null,
      reference: null, marginBp: null, repayment: "annuity", intervalMonths: 1, paymentCents: null, endDate: null, limitCents: null, seriesKey: null,
    };
    expect(walk([...pays(), ...rents(), ...everyday], [bal(900_000)], undefined, { ...NO_INPUTS, loans: [loan] }).point).toEqual({ known: false, reason: "bills", days: 60 });
  });
});

// A connected card: it owes what its purchases since the 9th came to, and its bill is paid from the account on the 9th.
// The account holds 2 000 €, the rent is 900 € on the 1st, the pay 3 000 € on 13.11., and everyday spending is 40 € a day, all on the card.
const card: Account = { id: "card", name: "Luottokortti", iban: null, currency: "EUR", type: "credit_card" };
const NINTHS = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"].map((m) => `${m}-09`);
const DAILY = 4000;
const OWED = daysBetween("2026-10-09", TODAY) * DAILY;
const balBoth = (accountCents: number): BalanceInput[] => [bal(accountCents), { id: card.id, name: card.name, type: card.type, balanceCents: -OWED, ownerName: null, balanceAt: `${TODAY}T06:00:00Z` }];
const cardShopping = (): Transaction[] => shopping("2026-03-01", DAILY).map((t) => ({ ...t, accountId: card.id }));
/** The bill of the card paid in full on the `day` of each month from April, with the account's payment and the card's leg. */
const statements = (day = "09"): Transaction[] =>
  NINTHS.slice(1).flatMap((d, i) => {
    const cents = daysBetween(NINTHS[i]!, d) * DAILY;
    const paid = `${d.slice(0, 8)}${day}`;
    return [
      tx({ accountId: own.id, bookingDate: paid, amountCents: -cents, merchant: "Esimerkkipankki", counterparty: "Esimerkkipankki", counterpartyIban: "FI14 1009 3000 1234 58", reference: "1234561", category: "transfer", categorySource: "transfer", isTransfer: true }),
      tx({ accountId: card.id, bookingDate: paid, amountCents: cents, merchant: "Maksu", category: "transfer", categorySource: "transfer", isTransfer: true }),
    ];
  });

describe("lowPoint with a card", () => {
  it("takes the card's bill off once and its purchases after the bill day by day: the bill of 9.11. holds the debt", () => {
    const rows = [...pays(), ...rents(), ...cardShopping(), ...statements()].filter((t) => t.bookingDate <= TODAY);
    const { point, runway, basis } = walk(rows, balBoth(200_000), undefined, NO_INPUTS, [own, card]);
    // 2 000 € - 900 € rent on 1.11. = 1 100 €, - the bill of 680 € on 9.11. = 420 €, and the 14 days of card purchases it holds (560 €) = -140 € on 9.11.
    // then 3 days more of purchases by 13.11., before the pay: 420 € - 560 € - 120 € = -260 €. The pay of 3 000 € comes after.
    expect(basis.ahead.balance!.cardDebtCents).toBe(0);
    expect(point).toEqual({ known: true, date: "2026-11-13", cents: -26_000, lowCents: -26_000, highCents: -26_000, days: 60 });
    // Jää palkkapäivänä stops at the bill: the three days after it are told and taken off nothing
    expect(runway.known && runway.leftCents).toBe(-14_000);
  });

  it("keeps the lowest balance at or under Jää palkkapäivänä and Käytettävissä inside the payday window", () => {
    const rows = [...pays(), ...rents(), ...cardShopping(), ...statements()].filter((t) => t.bookingDate <= TODAY);
    const { point, runway } = walk(rows, balBoth(200_000), undefined, NO_INPUTS, [own, card]);
    if (!point.known || !runway.known) throw new Error("no figure");
    expect(point.highCents).toBeLessThanOrEqual(runway.leftCents);
    expect(point.highCents).toBeLessThanOrEqual(runway.freeCents);
  });

  it("takes the debt of a card whose bill falls after the payday off whole from today, and never a second time with its bill", () => {
    // the bill is paid on the 20th, after the payday of 13.11.: Käytettävissä takes the 680 € off whole, as no bill of the window holds it
    const rows = [...pays(), ...rents(), ...cardShopping(), ...statements("20")].filter((t) => t.bookingDate <= TODAY);
    const { point, runway, basis } = walk(rows, balBoth(200_000), undefined, NO_INPUTS, [own, card]);
    if (!point.known || !runway.known) throw new Error("no figure");
    expect(basis.ahead.balance!.cardDebtCents).toBe(OWED);
    expect(runway.freeCents).toBe(200_000 - OWED - RENT);
    expect(point.highCents).toBeLessThanOrEqual(runway.freeCents);
    // the bill on 20.11. holds that debt, so the 680 € is not taken off a second time. Taking the purchases off day by day
    // gives the lowest on 13.11.: 1 100 € - 680 € - 17 days of 40 € = -260 €; a second 680 € would give -940 €
    expect(point.cents).toBeGreaterThanOrEqual(-26_000);
    expect(point.cents).toBeLessThanOrEqual(runway.freeCents);
  });
});

describe("lowPoint in the dashboard answer", () => {
  const rows = [...pays(), ...rents(), ...shopping("2026-03-01", 4000, ["2026-07", "2026-08", "2026-09"])];

  it("is a field of home, the same as the function gives, for the days the figure looks at", () => {
    const ctx = createContext(rows, [own], TODAY);
    const home = buildDashboard(ctx, RANGE, [bal(900_000)], NO_INPUTS).home;
    expect(home.lowPoint).toEqual(lowPoint(ctx, aheadBasis(ctx, [bal(900_000)], NO_INPUTS), [bal(900_000)], NO_INPUTS));
    expect(home.lowPoint).toMatchObject({ known: true, days: LOW_POINT_DAYS });
  });

  it("is not told for a range that does not include today", () => {
    const ctx = createContext(rows, [own], TODAY);
    expect(buildDashboard(ctx, { from: "2026-09-01", to: "2026-09-30" }, [bal(900_000)], NO_INPUTS).home.lowPoint).toBeNull();
  });
});
