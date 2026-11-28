import { describe, expect, it } from "vitest";
import { aheadBasis } from "../src/analysis/ahead.ts";
import { createContext } from "../src/analysis/context.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import { paydayOf, runwayOf } from "../src/analysis/runway.ts";
import { addDays, dateIn, daysBetween, daysInMonth, fromMonthIndex, monthIndex, weekdayOf } from "../src/dates.ts";
import { loanUnknownSubject } from "../src/loan-terms-answer.ts";
import { type LowPoint, lowPoint, plansBeforePayday } from "../src/low-point.ts";
import { billCalendar } from "../src/reports/bill-calendar.ts";
import { LOW_POINT_DAYS } from "../src/thresholds.ts";
import { type Account, type BalanceInput, type ExpectedBill, type IsoDate, type Loan, NO_INPUTS, type Transaction, type UserInputs } from "../src/types.ts";
import { cardGaps } from "../src/unconnected-cards.ts";
import { tx } from "./helpers.ts";
import { LATE_CARD_TODAY, lateCardContext } from "./late-card-household.ts";

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

/** The figure of a lowest balance without the walk's line and steps, which their own tests read. */
function figureOf(point: LowPoint): LowPoint {
  if (!point.known) return point;
  const { line: _line, steps: _steps, spending: _spending, startCents: _start, cardDebtCents: _debt, ...figure } = point;
  return figure as LowPoint;
}

/** The lowest balance of `days` days for the rows and the balance, with the figures it is held against; `walked` keeps the line and steps. */
function walk(rows: Transaction[], balances: BalanceInput[], days?: number, inputs: UserInputs = NO_INPUTS, accounts: Account[] = [own]) {
  const ctx = createContext(rows, accounts, TODAY);
  const basis = aheadBasis(ctx, balances, inputs);
  const walked = lowPoint(ctx, basis, balances, inputs, days);
  return { ctx, basis, point: figureOf(walked), walked, runway: runwayOf(ctx, basis, plansBeforePayday(billCalendar(ctx, inputs, balances), basis.ahead)) };
}

/** A corner of the line with no range. */
const flatCorner = (date: IsoDate, cents: number) => ({ date, cents, lowCents: cents, highCents: cents });

/** What every line holds: one day after another from today, the range around each corner, and the figure as its lowest corner. */
function expectLineHolds(point: LowPoint) {
  if (!point.known) throw new Error("no figure");
  const { line } = point;
  expect(line[0]!.date).toBe(TODAY);
  expect(line[line.length - 1]!.date).toBe(addDays(TODAY, point.days - 1));
  for (let i = 1; i < line.length; i++) expect([line[i - 1]!.date, addDays(line[i - 1]!.date, 1)]).toContain(line[i]!.date);
  expect(new Set(line.map((c) => c.date)).size).toBe(point.days);
  for (const c of line) {
    expect(c.lowCents).toBeLessThanOrEqual(c.cents);
    expect(c.cents).toBeLessThanOrEqual(c.highCents);
  }
  expect(Math.min(...line.map((c) => c.cents))).toBe(point.cents);
  expect(Math.min(...line.map((c) => c.lowCents))).toBe(point.lowCents);
  expect(Math.min(...line.map((c) => c.highCents))).toBe(point.highCents);
  expect(line.some((c) => c.date === point.date && c.cents === point.cents)).toBe(true);
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

  it("leaves a payment on the payday out, as the window and Jää palkkapäivänä do: the lowest point and the headline are one figure", () => {
    // the rent is booked on the 13th, the day of the pay: it is paid from the pay, in no figure of the window
    const { basis, point, runway } = walk([...pays(), ...rents("2026-03", 13)], [bal(50_000)], 19);
    if (!point.known || !runway.known) throw new Error("no figure");
    expect(basis.ahead.to).toBe("2026-11-12");
    expect(basis.ahead.balance!.shortOn).toBeNull();
    expect(point.cents).toBe(runway.leftCents);
    expect(point).toEqual({ known: true, date: "2026-11-13", cents: 50_000, lowCents: 50_000, highCents: 50_000, days: 19 });
    // a longer walk is unchanged: the rent on the pay day is met from the balance before the pay
    expect(walk([...pays(), ...rents("2026-03", 13)], [bal(50_000)], 20).point).toMatchObject({ date: "2026-11-13", cents: -40_000 });
  });

  it("counts the walk of the payday itself as the headline when the pay is due today", () => {
    // the rent is booked on the dates of the pay, so it follows the pay and the October one is due today
    const salary = pays("2026-03", "2026-09", 26);
    const rent = salary.map((p) => tx({ accountId: own.id, bookingDate: p.bookingDate, amountCents: -RENT, merchant: "Sato Oyj", category: "housing" }));
    const { basis, point, runway } = walk([...salary, ...rent], [bal(50_000)], 1);
    if (!point.known || !runway.known) throw new Error("no figure");
    expect(basis.ahead.upcoming.some((r) => r.withPay)).toBe(true);
    expect(point.cents).toBe(runway.leftCents);
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

    it("the line walks the bill on its day and meets Jää palkkapäivänä on the payday: the purchases after the bill wait for the bill after it", () => {
      for (const days of [19, 30]) {
        const { point, runway, walked } = walk(rows, [bal(900_000)], days);
        if (!point.known || !runway.known || !walked.known) throw new Error("no lowest balance");
        // 13.11. starts with the figure of Jää palkkapäivänä, the purchases of 10.-12.11. not taken off yet
        expect(point.date).toBe("2026-11-13");
        expect(point.cents).toBe(runway.leftCents);
        expect(walked.line.find((c) => c.date === runway.payday.date)!.cents).toBe(runway.leftCents);
        expect(point.highCents).toBeLessThanOrEqual(runway.leftCents);
        expect(point.lowCents).toBeLessThanOrEqual(point.cents);
        expect(point.cents).toBeLessThanOrEqual(point.highCents);
      }
      // the day after the payday they leave together: 10.-13.11., the pay of 3 000 € in
      const { walked, runway } = walk(rows, [bal(900_000)], 30);
      if (!walked.known || !runway.known) throw new Error("no lowest balance");
      const next = walked.line.find((c) => c.date === "2026-11-14")!;
      expect(Math.abs(next.cents - (runway.leftCents + 300_000 - 4000 - 4 * perDay))).toBeLessThanOrEqual(2);
      // the line never goes under the figure beyond the payday either
      const longer = walk(rows, [bal(900_000)], 60);
      if (!longer.point.known) throw new Error("no lowest balance");
      expect(longer.point.cents).toBeLessThanOrEqual(runway.leftCents);
    });

    it("walks a bill of a payday window longer than Laskut's 30 days on its day, and ends on the payday at Jää palkkapäivänä", () => {
      // the pay of 3 000 € comes every second month on the 9th (on 7.8. for a Sunday): the payday is 9.12., 44 days away.
      // The card's bills fall on the 29th, the same sums as above: the next two, 380 € each, on 29.10. and on 29.11., the 35th day
      const bimonthly = pays("2026-04", "2026-10", 9).filter((t) => Number(t.bookingDate.slice(5, 7)) % 2 === 0);
      const onThe29th = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"].map((m) =>
        tx({ accountId: own.id, bookingDate: `${m}-29`, amountCents: -billOf(m), merchant: "Esimerkkipankki", counterparty: "Esimerkkipankki", category: "card_bill" }),
      );
      const { basis, point, runway } = walk([...bimonthly, ...rents(), ...shopping("2026-03-01", 4000), ...onThe29th], [bal(900_000)], 45);
      if (!point.known || !runway.known) throw new Error("no lowest balance");
      expect([basis.ahead.to, runway.payday.date]).toEqual(["2026-12-08", "2026-12-09"]);
      // 9 000 € less two rents of 900 € and two bills of 380 €, less 44 days of 40 €
      expect(runway.freeCents).toBe(644_000);
      expect(runway.leftCents).toBe(468_000);
      // 9.12. starts with 6 440 € less the 44 days of 40 € before it: the card's purchases of 30.11.-8.12., the days after its last bill, wait for the bill after the payday
      expect(point.date).toBe("2026-12-09");
      expect(point.cents).toBe(runway.leftCents);
      expect(point.highCents).toBeLessThanOrEqual(runway.leftCents);
      expect(point.lowCents).toBeLessThanOrEqual(point.cents);
      expect(point.cents).toBeLessThanOrEqual(point.highCents);
    });

    it("holds back a payment of the card that its series does not hold, as the runway leaves out every card bill", () => {
      // the card's bill is 350 € on the 9th, and on 20.6. the household paid 200 € more to it: a row of no series
      const fixed = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"].map((m) =>
        tx({ accountId: own.id, bookingDate: `${m}-09`, amountCents: -35_000, merchant: "Esimerkkipankki", counterparty: "Esimerkkipankki", category: "card_bill" }),
      );
      const extra = tx({ accountId: own.id, bookingDate: "2026-06-20", amountCents: -20_000, merchant: "Esimerkkipankki", counterparty: "Esimerkkipankki", category: "card_bill" });
      const { ctx, point, runway } = walk([...pays(), ...rents(), ...shopping("2026-03-01", 4000), ...fixed, extra], [bal(900_000)], 19);
      if (!point.known || !runway.known) throw new Error("no lowest balance");
      expect(ctx.recurring.some((s) => s.transactionIds.includes(extra.id))).toBe(false);
      // 9 000 € less the rent and the bill of 350 € on 9.11., less 18 days of 40 €
      expect(runway.leftCents).toBe(703_000);
      // 13.11. starts with 7 030 €, the figure of Jää palkkapäivänä: the card's purchases of 10.-12.11., the extra payment among them, wait for the next bill
      expect(point.date).toBe("2026-11-13");
      expect(point.cents).toBe(runway.leftCents);
      expect(point.highCents).toBeLessThanOrEqual(runway.leftCents);
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
  it("leaves the debt of a card whose bill falls on the payday out of a walk that ends on it", () => {
    const rows = [...pays(), ...rents(), ...cardShopping(), ...statements("13")].filter((t) => t.bookingDate <= TODAY);
    const { point, runway } = walk(rows, balBoth(200_000), 19, NO_INPUTS, [own, card]);
    if (!point.known || !runway.known) throw new Error("no figure");
    expect(point.cents).toBe(runway.leftCents);
  });

  it("takes the card's bill off once and its purchases after the bill day with the bill after the payday: the bill of 9.11. holds the debt", () => {
    const rows = [...pays(), ...rents(), ...cardShopping(), ...statements()].filter((t) => t.bookingDate <= TODAY);
    const { point, runway, basis } = walk(rows, balBoth(200_000), undefined, NO_INPUTS, [own, card]);
    // 2 000 € - 900 € rent on 1.11. = 1 100 €, - the bill of 680 € on 9.11. = 420 €, and the 14 days of card purchases it holds (560 €) = -140 € on 9.11.
    // the 4 days of purchases after it, to the payday, wait for the bill after the payday: -140 € to the payday 13.11., before the pay of 3 000 €
    expect(basis.ahead.balance!.cardDebtCents).toBe(0);
    expect(point).toEqual({ known: true, date: "2026-11-09", cents: -14_000, lowCents: -14_000, highCents: -14_000, days: 60 });
    expect(runway.known && runway.leftCents).toBe(-14_000);
  });

  it("ends the line's payday at Jää palkkapäivänä, whether the card's bill falls before the payday or after it", () => {
    for (const billDay of ["09", "20"]) {
      const rows = [...pays(), ...rents(), ...cardShopping(), ...statements(billDay)].filter((t) => t.bookingDate <= TODAY);
      const { walked, runway } = walk(rows, balBoth(200_000), undefined, NO_INPUTS, [own, card]);
      if (!walked.known || !runway.known) throw new Error("no figure");
      // the first corner of the payday is what its day opens with, before the pay
      expect(walked.line.find((c) => c.date === runway.payday.date)!.cents, `a bill on the ${billDay}th`).toBe(runway.leftCents);
    }
    // the purchases of 10.-13.11. leave the account together the day after the payday
    const rows = [...pays(), ...rents(), ...cardShopping(), ...statements()].filter((t) => t.bookingDate <= TODAY);
    const { walked } = walk(rows, balBoth(200_000), undefined, NO_INPUTS, [own, card]);
    if (!walked.known) throw new Error("no figure");
    expect(walked.line.find((c) => c.date === "2026-11-14")!.cents).toBe(-14_000 + 300_000 - 4 * DAILY);
  });

  it("reads the payday's figure and range from the walk when a small income lands before the payday", () => {
    const interest = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"].map((m) => tx({ accountId: own.id, bookingDate: `${m}-30`, amountCents: 468, merchant: "Pankki", category: "investment_income" }));
    const { walked, runway } = walk([...pays(), ...rents(), ...interest, ...shopping("2026-03-01", 4000, ["2026-07", "2026-08", "2026-09"])], [bal(900_000)]);
    if (!walked.known || !runway.known) throw new Error("no figure");
    const atPayday = walked.line.find((c) => c.date === runway.payday.date)!;
    expect([atPayday.cents, atPayday.lowCents, atPayday.highCents]).toEqual([runway.leftCents, runway.lowCents, runway.highCents]);
    // the income is in the balance of the days after the payday
    const without = walk([...pays(), ...rents(), ...shopping("2026-03-01", 4000, ["2026-07", "2026-08", "2026-09"])], [bal(900_000)]).walked;
    if (!without.known) throw new Error("no figure");
    const dayAfter = addDays(runway.payday.date, 1);
    expect(walked.line.find((c) => c.date === dayAfter)!.cents - without.line.find((c) => c.date === dayAfter)!.cents).toBe(468);
  });

  it("ends the line's payday at Jää palkkapäivänä with a saved loan whose plan rows no series pays", () => {
    const loan: Loan = {
      id: "loan-1", name: "Remonttilaina", lender: "ESIMERKKIPANKKI", kind: "consumer", grantedCents: null, balanceCents: 1_000_000, balanceDate: "2026-10-01", rateBp: 400,
      reference: null, marginBp: null, repayment: "annuity", intervalMonths: 1, paymentCents: 50_000, endDate: null, limitCents: null, seriesKey: "out:own:ESIMERKKIPANKKI",
    };
    // two repayments only: too few for a series, so the plan's rows are the loan's payments
    const repayments = ["2026-09-20", "2026-10-20"].map((bookingDate) => tx({ accountId: own.id, bookingDate, amountCents: -50_000, merchant: "ESIMERKKIPANKKI", counterparty: "ESIMERKKIPANKKI", category: "mortgage" }));
    const inputs: UserInputs = { ...NO_INPUTS, loans: [loan] };
    const rows = [...pays(), ...rents(), ...repayments, ...shopping("2026-03-01", 4000)];
    const { ctx, basis, walked, runway } = walk(rows, [bal(900_000)], undefined, inputs);
    if (!walked.known || !runway.known) throw new Error("no figure");
    expect(plansBeforePayday(billCalendar(ctx, inputs, [bal(900_000)]), basis.ahead).length).toBeGreaterThan(0);
    const plain = runwayOf(ctx, basis);
    expect(plain.known && plain.leftCents).not.toBe(runway.leftCents);
    expect(walked.line.find((c) => c.date === runway.payday.date)!.cents).toBe(runway.leftCents);
  });

  it("ends the line's payday at Jää palkkapäivänä with a saved loan a series pays on other days and sums than its plan", () => {
    const loan: Loan = {
      id: "loan-1", name: "Remonttilaina", lender: "ESIMERKKIPANKKI", kind: "consumer", grantedCents: null, balanceCents: 1_000_000, balanceDate: "2026-10-01", rateBp: 400,
      reference: null, marginBp: null, repayment: "annuity", intervalMonths: 1, paymentCents: 50_000, endDate: "2026-12-10", limitCents: null, seriesKey: "out:own:ESIMERKKIPANKKI",
    };
    // four repayments on the 20th at 470 €: a series pays the loan, its next charge is after the payday and the plan's payment of the 1.11. is not the row
    const repayments = ["2026-07-20", "2026-08-20", "2026-09-20", "2026-10-20"].map((bookingDate) => tx({ accountId: own.id, bookingDate, amountCents: -47_000, merchant: "ESIMERKKIPANKKI", counterparty: "ESIMERKKIPANKKI", category: "mortgage" }));
    const inputs: UserInputs = { ...NO_INPUTS, loans: [loan] };
    const { walked, runway } = walk([...pays(), ...rents(), ...repayments, ...shopping("2026-03-01", 4000)], [bal(900_000)], undefined, inputs);
    if (!walked.known || !runway.known) throw new Error("no figure");
    expect(walked.line.find((c) => c.date === runway.payday.date)!.cents).toBe(runway.leftCents);
    // the series' charge of the 20th is the one row of the loan: no plan row of the 1st, and none of the 20th of December, after the end date
    expect(walked.steps.filter((s) => s.payee === "Remonttilaina").map((s) => [s.date, s.cents])).toEqual([["2026-11-20", -47_000]]);
  });

  it("leaves a series charge after the loan's end date out of the walk and of Jää palkkapäivänä alike", () => {
    const loan: Loan = {
      id: "loan-1", name: "Remonttilaina", lender: "ESIMERKKIPANKKI", kind: "consumer", grantedCents: null, balanceCents: 1_000_000, balanceDate: "2026-10-01", rateBp: 400,
      reference: null, marginBp: null, repayment: "annuity", intervalMonths: 1, paymentCents: 50_000, endDate: "2026-10-31", limitCents: null, seriesKey: "out:own:ESIMERKKIPANKKI",
    };
    // the series charges 470 € on the 5th: its next charge, 5.11., is after the end date and before the payday, 13.11.
    const repayments = ["2026-07-05", "2026-08-05", "2026-09-05", "2026-10-05"].map((bookingDate) => tx({ accountId: own.id, bookingDate, amountCents: -47_000, merchant: "ESIMERKKIPANKKI", counterparty: "ESIMERKKIPANKKI", category: "mortgage" }));
    const inputs: UserInputs = { ...NO_INPUTS, loans: [loan] };
    const { basis, walked, runway } = walk([...pays(), ...rents(), ...repayments, ...shopping("2026-03-01", 4000)], [bal(900_000)], undefined, inputs);
    if (!walked.known || !runway.known) throw new Error("no figure");
    expect(walked.line.find((c) => c.date === runway.payday.date)!.cents).toBe(runway.leftCents);
    expect(walked.steps.filter((s) => s.payee === "Remonttilaina")).toEqual([]);
    expect(basis.ahead.rows.filter((r) => r.name === "ESIMERKKIPANKKI")).toEqual([]);
  });

  it("takes a bullet loan's lump sum and its interest series' charges off before the payday, as Jää palkkapäivänä does", () => {
    const loan: Loan = {
      id: "loan-1", name: "Siltalaina", lender: "ESIMERKKIPANKKI", kind: "car", grantedCents: null, balanceCents: 4_000_000, balanceDate: "2026-10-01", rateBp: null,
      reference: null, marginBp: null, repayment: "bullet", intervalMonths: null, paymentCents: 91_240, endDate: "2026-11-05", limitCents: null, seriesKey: "out:own:ESIMERKKIPANKKI",
    };
    // the interest series charges on the 2nd; the bullet's row is its lump sum on the 5th, both before the payday of 13.11.
    const interest = ["2026-06-02", "2026-07-02", "2026-08-02", "2026-09-02", "2026-10-02"].map((bookingDate) => tx({ accountId: own.id, bookingDate, amountCents: -91_240, merchant: "ESIMERKKIPANKKI", counterparty: "ESIMERKKIPANKKI", category: "mortgage" }));
    const inputs: UserInputs = { ...NO_INPUTS, loans: [loan] };
    const { walked, runway } = walk([...pays(), ...rents(), ...interest, ...shopping("2026-03-01", 4000)], [bal(9_000_000)], undefined, inputs);
    if (!walked.known || !runway.known) throw new Error("no figure");
    expect(walked.steps.filter((s) => s.date === "2026-11-05").map((s) => s.cents)).toContain(-4_000_000);
    expect(walked.steps.filter((s) => s.date === "2026-11-02").map((s) => s.cents)).toContain(-91_240);
    expect(walked.steps.some((s) => s.payee === "Siltalaina" && s.date > "2026-11-05")).toBe(false);
    expect(walked.line.find((c) => c.date === runway.payday.date)!.cents).toBe(runway.leftCents);
  });

  it("keeps the lowest balance at or under Jää palkkapäivänä and Käytettävissä inside the payday window", () => {
    const rows = [...pays(), ...rents(), ...cardShopping(), ...statements()].filter((t) => t.bookingDate <= TODAY);
    const { point, runway } = walk(rows, balBoth(200_000), undefined, NO_INPUTS, [own, card]);
    if (!point.known || !runway.known) throw new Error("no figure");
    expect(point.highCents).toBeLessThanOrEqual(runway.leftCents);
    expect(point.highCents).toBeLessThanOrEqual(runway.freeCents);
  });

  it("takes the debt of a card whose bill falls after the payday off on the bill's day, once", () => {
    // the bill is paid on the 20th, after the payday of 13.11.: the debt waits for it, so Käytettävissä takes nothing off for it
    const rows = [...pays(), ...rents(), ...cardShopping(), ...statements("20")].filter((t) => t.bookingDate <= TODAY);
    const { point, runway, basis, walked } = walk(rows, balBoth(200_000), undefined, NO_INPUTS, [own, card]);
    if (!point.known || !runway.known || !walked.known) throw new Error("no figure");
    expect(basis.ahead.balance!.cardDebtCents).toBe(0);
    expect(walked.cardDebtCents).toBe(0);
    expect(runway.freeCents).toBe(200_000 - RENT);
    expect(point.highCents).toBeLessThanOrEqual(runway.freeCents);
    // the debt is one step on the bill's day, in place of the bill's own row
    expect(walked.steps.filter((s) => s.date === "2026-11-20" && s.payee === card.name).map((s) => s.cents)).toEqual([-OWED]);
  });

  it("takes only the debt beside a typed bill of the card off on the bill's day: the typed row pays its own sum", () => {
    const iban = "FI80 1234 5600 0099 11";
    const owner: Account = { ...card, iban };
    const typedOn = (dueDate: string, amountCents: number) => ({ id: "typed", name: "Korttilasku", amountCents, dueDate, cadence: "once", category: null, payeeIban: iban }) as ExpectedBill;
    const rows = [...pays(), ...rents(), ...cardShopping(), ...statements("20")].filter((t) => t.bookingDate <= TODAY);
    const walkWith = (bill: ExpectedBill) => walk(rows, balBoth(200_000), undefined, { ...NO_INPUTS, expectedBills: [bill] }, [own, owner]);
    // a typed bill smaller than the debt, before the predicted day: the rest of the debt is still taken off
    const small = walkWith(typedOn("2026-11-18", 50_000));
    if (!small.walked.known) throw new Error("no figure");
    expect(small.basis.ahead.balance!.laterCardDebts).toEqual([{ cardId: card.id, name: card.name, cents: OWED, date: "2026-11-18", typedCents: 50_000 }]);
    expect(small.walked.steps.filter((s) => s.date === "2026-11-18" && s.cents < 0).map((s) => s.cents)).toEqual([-50_000, -(OWED - 50_000)]);
    // a typed bill on the predicted bill's day: paid once, the debt is not taken off beside it in full
    const same = walkWith(typedOn("2026-11-20", 50_000));
    if (!same.walked.known) throw new Error("no figure");
    expect(same.walked.steps.filter((s) => s.date === "2026-11-20" && s.cents < 0).map((s) => s.cents)).toEqual([-50_000, -(OWED - 50_000)]);
    // a typed bill that covers the debt leaves no step of it
    const whole = walkWith(typedOn("2026-11-18", OWED));
    if (!whole.walked.known) throw new Error("no figure");
    expect(whole.walked.steps.some((s) => s.payee === card.name)).toBe(false);
    expect(whole.walked.steps.filter((s) => s.date === "2026-11-18" && s.cents < 0).map((s) => s.cents)).toEqual([-OWED]);
  });


  it("takes only the debt of the card whose bill falls after the payday off on its day, beside a card billed before it", () => {
    const second: Account = { ...card, id: "card2", name: "Toinen kortti" };
    const toSecond = (t: Transaction): Transaction => ({ ...t, accountId: second.id });
    const before = [...cardShopping(), ...statements("09")];
    // the second card's purchases and bills: the account's payment is the first card's rows' twin on the 20th
    const after = [...cardShopping(), ...statements("20")].filter((t) => t.accountId === card.id).map(toSecond);
    const ownLegs = statements("20").filter((t) => t.accountId === own.id);
    const rows = [...pays(), ...rents(), ...before, ...after, ...ownLegs].filter((t) => t.bookingDate <= TODAY);
    const balances = [...balBoth(400_000), { id: second.id, name: second.name, type: second.type, balanceCents: -OWED, ownerName: null, balanceAt: `${TODAY}T06:00:00Z` }];
    const { walked, basis } = walk(rows, balances, undefined, NO_INPUTS, [own, card, second]);
    if (!walked.known) throw new Error("no figure");
    expect(basis.ahead.balance!.laterCardDebts.map((d) => d.cardId)).toEqual([second.id]);
    expect(walked.steps.filter((s) => s.payee === second.name).map((s) => [s.date, s.cents])).toEqual([["2026-11-20", -OWED]]);
    expect(walked.steps.filter((s) => s.payee === card.name && s.date > "2026-11-13")).toEqual([]);
  });
});

describe("lowPoint's line and steps", () => {
  it("steps down by the rent on its day and up by the pay on its day, after the day's payments, with no spending to slope by", () => {
    // 500 € to 31.10., the rent of 900 € on 1.11. leaves -400 € to the payday 13.11., and the pay of 3 000 € lands that day
    const { walked } = walk([...pays(), ...rents()], [bal(50_000)], 19);
    if (!walked.known) throw new Error("no figure");
    const days = (first: IsoDate, n: number, cents: number) => Array.from({ length: n }, (_, i) => flatCorner(addDays(first, i), cents));
    // 1.11. opens at 500 € and its rent takes it to -400 €; 13.11. is at -400 € until its pay lifts it to 2 600 €
    expect(walked.line).toEqual([...days("2026-10-26", 6, 50_000), flatCorner("2026-11-01", 50_000), ...days("2026-11-01", 13, -40_000), flatCorner("2026-11-13", 260_000)]);
    expect(walked.steps).toEqual([
      { date: "2026-11-01", payee: "Sato Oyj", cents: -90_000, estimate: false, afterCents: -40_000, rowAfterCents: -40_000 },
      { date: "2026-11-13", payee: "Esimerkki Oy", cents: 300_000, estimate: false, afterCents: 260_000, rowAfterCents: 260_000 },
    ]);
    expectLineHolds(walked);
  });

  it("falls by the day's expected spending between days, so a step stands between the day's opening and its payments", () => {
    // 9 000 €, 40 € a day: 31.10. at 9 000 € - 5 days = 8 800 €, 1.11. opens at 8 760 € and the rent takes it to 7 860 €
    const { walked } = walk([...pays(), ...rents(), ...shopping("2026-03-01", 4000)], [bal(900_000)], 30);
    if (!walked.known) throw new Error("no figure");
    const on = (date: IsoDate) => walked.line.filter((c) => c.date === date).map((c) => c.cents);
    expect(on("2026-10-26")).toEqual([900_000]);
    expect(on("2026-10-31")).toEqual([880_000]);
    expect(on("2026-11-01")).toEqual([876_000, 786_000]);
    // the payday: 7 380 € before the pay, the figure of Jää palkkapäivänä, and 10 380 € with it
    expect(on("2026-11-13")).toEqual([738_000, 1_038_000]);
    expect(walked.steps.map((s) => [s.date, s.cents, s.afterCents])).toEqual([
      ["2026-11-01", -90_000, 786_000],
      ["2026-11-13", 300_000, 1_038_000],
    ]);
    expectLineHolds(walked);
  });

  it("carries the range of the spending on every corner, its lowest ends the figure's range", () => {
    const rows = [...pays(), ...rents(), ...shopping("2026-03-01", 4000, ["2026-07", "2026-08", "2026-09"])];
    const { walked } = walk(rows, [bal(900_000)], 30);
    if (!walked.known) throw new Error("no figure");
    expect(walked.line.find((c) => c.date === "2026-11-13")).toEqual({ date: "2026-11-13", cents: 702_000, lowCents: 666_000, highCents: 738_000 });
    expectLineHolds(walked);
  });

  it("holds with a card, whose bill and the purchases it takes are steps of the line", () => {
    const rows = [...pays(), ...rents(), ...cardShopping(), ...statements()].filter((t) => t.bookingDate <= TODAY);
    const { walked } = walk(rows, balBoth(200_000), undefined, NO_INPUTS, [own, card]);
    expectLineHolds(walked);
    expect(walked.known && walked.steps.some((s) => s.date === "2026-11-09" && s.cents === -68_000)).toBe(true);
  });
});

/**
 * The table of the first page reads the walk as rows: the balance of the start, then for each step day its spending
 * rows and its steps. The balance of every row, a step among them, is the one before it plus its sum, and the last step
 * of a day ends at the day's own balance.
 */
function expectRowsAddUp(point: LowPoint) {
  if (!point.known) throw new Error("no figure");
  let running = point.startCents;
  for (const date of [...new Set(point.steps.map((s) => s.date))]) {
    for (const p of point.spending.filter((p) => p.date === date)) {
      expect(p.afterCents).toBe(running + p.cents);
      expect(p.cents).toBeLessThan(0);
      running = p.afterCents;
    }
    const day = point.steps.filter((s) => s.date === date);
    for (const s of day) {
      running += s.cents;
      expect(s.rowAfterCents).toBe(running);
    }
    expect(day[day.length - 1]!.afterCents).toBe(running);
  }
}

describe("lowPoint's spending between the steps", () => {
  it("is a row for each gap that adds the table's balance up", () => {
    // 9 000 € and 40 € a day, the rent on 1.11. and the pay on 13.11.: the gaps are 26.10.–31.10. and 1.11.–12.11.
    const { walked } = walk([...pays(), ...rents(), ...shopping("2026-03-01", 4000)], [bal(900_000)], 30);
    if (!walked.known) throw new Error("no figure");
    expect(walked.startCents).toBe(900_000);
    expect(walked.cardDebtCents).toBe(0);
    expect(walked.spending).toEqual([
      { date: "2026-11-01", since: "2026-10-26", until: "2026-10-31", kind: "everyday", cents: -24_000, afterCents: 876_000 },
      { date: "2026-11-13", since: "2026-11-01", until: "2026-11-12", kind: "everyday", cents: -48_000, afterCents: 738_000 },
    ]);
    expectRowsAddUp(walked);
  });

  it("gives each of two bills on one day its own balance, the one before it plus its sum", () => {
    // the rent of 900 € and a bill of 80 € both fall on the 1st
    const power = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"].map((m) => tx({ accountId: own.id, bookingDate: `${m}-01`, amountCents: -8000, merchant: "Sähkö Oy", category: "utilities" }));
    const { walked } = walk([...pays(), ...rents(), ...power, ...shopping("2026-03-01", 4000)], [bal(900_000)], 30);
    if (!walked.known) throw new Error("no figure");
    const first = walked.steps.filter((s) => s.date === "2026-11-01");
    expect(first.map((s) => s.cents).sort()).toEqual([-RENT, -8000].sort());
    expect(first[0]!.rowAfterCents).not.toBe(first[1]!.rowAfterCents);
    expect(first[0]!.afterCents).toBe(first[1]!.afterCents);
    expect(first[1]!.rowAfterCents).toBe(first[1]!.afterCents);
    expectRowsAddUp(walked);
  });

  it("names the card's purchases that no bill holds as a row of their own, and the card debt of today", () => {
    const rows = [...pays(), ...rents(), ...cardShopping(), ...statements()].filter((t) => t.bookingDate <= TODAY);
    const { walked } = walk(rows, balBoth(200_000), undefined, NO_INPUTS, [own, card]);
    if (!walked.known) throw new Error("no figure");
    expect(walked.spending.length).toBeGreaterThan(0);
    expectRowsAddUp(walked);
  });
});

describe("lowPoint in the dashboard answer", () => {
  const rows = [...pays(), ...rents(), ...shopping("2026-03-01", 4000, ["2026-07", "2026-08", "2026-09"])];

  it("is a field of home, the same as the function gives, for the days from today to the payday", () => {
    const ctx = createContext(rows, [own], TODAY);
    const home = buildDashboard(ctx, RANGE, [bal(900_000)], NO_INPUTS).home;
    const basis = aheadBasis(ctx, [bal(900_000)], NO_INPUTS);
    const payday = paydayOf(basis.ahead);
    if (!payday) throw new Error("no payday");
    const days = daysBetween(basis.ahead.from, payday.date) + 1;
    expect(days).toBeLessThan(LOW_POINT_DAYS);
    expect(home.lowPoint).toEqual(lowPoint(ctx, basis, [bal(900_000)], NO_INPUTS, days));
    expect(home.lowPoint).toMatchObject({ known: true, days });
  });

  it("is not told for a range that does not include today", () => {
    const ctx = createContext(rows, [own], TODAY);
    expect(buildDashboard(ctx, { from: "2026-09-01", to: "2026-09-30" }, [bal(900_000)], NO_INPUTS).home.lowPoint).toBeNull();
  });
});

describe("pastPeriods in the dashboard answer", () => {
  const rows = [...pays(), ...rents(), ...shopping("2026-03-01", 4000)];
  const ctx = createContext(rows, [own], TODAY);
  const endOfDay = (day: IsoDate) => 900_000 - rows.filter((r) => r.bookingDate > day && r.bookingDate <= TODAY).reduce((sum, r) => sum + r.amountCents, 0);

  it("holds each complete period between two pays, a day at a time to the day before its payday", () => {
    const past = buildDashboard(ctx, RANGE, [bal(900_000)], NO_INPUTS).home.pastPeriods!;
    const paydays = rows.filter((r) => r.category === "salary").map((r) => r.bookingDate).sort();
    // the period that runs now is not among them
    expect(past.periods.map((p) => p.payday)).toEqual(paydays.slice(1));
    for (const [i, p] of past.periods.entries()) {
      const start = paydays[i]!;
      expect(p.points.map((q) => q.daysBefore)).toEqual(Array.from({ length: daysBetween(start, p.payday) }, (_, k) => daysBetween(start, p.payday) - k));
      for (const q of p.points) expect(q.cents).toBe(endOfDay(addDays(p.payday, -q.daysBefore)));
      expect(p.enough).toBe(p.points.every((q) => q.cents >= 0));
    }
    expect(past.enoughCount).toBe(past.periods.filter((p) => p.enough).length);
  });

  it("counts a period that went below zero as not enough", () => {
    const poor = buildDashboard(ctx, RANGE, [bal(100_000)], NO_INPUTS).home.pastPeriods!;
    const rich = buildDashboard(ctx, RANGE, [bal(900_000)], NO_INPUTS).home.pastPeriods!;
    expect(poor.periods.length).toBe(rich.periods.length);
    expect(poor.enoughCount).toBeLessThan(rich.enoughCount);
  });

  it("is null under three complete periods, for a range without today and for an account without a balance", () => {
    const few = createContext([...pays("2026-08", "2026-10"), ...rents(), ...shopping("2026-03-01", 4000)], [own], TODAY);
    expect(buildDashboard(few, RANGE, [bal(900_000)], NO_INPUTS).home.pastPeriods).toBeNull();
    expect(buildDashboard(ctx, { from: "2026-09-01", to: "2026-09-30" }, [bal(900_000)], NO_INPUTS).home.pastPeriods).toBeNull();
    expect(buildDashboard(ctx, RANGE, [{ ...bal(900_000), balanceCents: null }], NO_INPUTS).home.pastPeriods).toBeNull();
  });
});

describe("lowPoint when the reason is a card's missing purchases", () => {
  // the card's rows begin in September and nothing is billed before: the base of the usual spending is too short
  const ctx = lateCardContext("2026-09", LATE_CARD_TODAY, false);
  const at = `${LATE_CARD_TODAY}T06:00:00Z`;
  const balances: BalanceInput[] = [
    { id: "chk", name: "Käyttötili", type: "checking", balanceCents: 500_000, ownerName: null, balanceAt: at },
    { id: "card", name: "Esimerkki Gold", type: "credit_card", balanceCents: -20_000, ownerName: null, balanceAt: at },
  ];
  const lowOf = (inputs: UserInputs) => lowPoint(ctx, aheadBasis(ctx, balances, inputs), balances, inputs);

  it("tells that a card row of Täydennä lainat is open, until En tiedä sets the card aside", () => {
    expect(lowOf(NO_INPUTS)).toEqual({ known: false, reason: "cards", days: LOW_POINT_DAYS, cardRowOpen: true });
    const [gap] = cardGaps(ctx, NO_INPUTS);
    expect(gap).toMatchObject({ cardId: "card", cents: null });
    const marked: UserInputs = { ...NO_INPUTS, marks: [{ subject: loanUnknownSubject(null, gap!.key), mark: "in_use", markedAt: "2026-10-09T10:00:00Z" }] };
    expect(lowOf(marked)).toEqual({ known: false, reason: "cards", days: LOW_POINT_DAYS, cardRowOpen: false });
  });

  it("says nothing of card rows for the other reasons", () => {
    const { point } = walk(rents(), [bal(50_000)]);
    expect(point).toEqual({ known: false, reason: "no-payday", days: LOW_POINT_DAYS });
  });
});
