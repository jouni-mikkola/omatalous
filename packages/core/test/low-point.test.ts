import { describe, expect, it } from "vitest";
import { aheadBasis } from "../src/analysis/ahead.ts";
import { createContext } from "../src/analysis/context.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import { runwayOf } from "../src/analysis/runway.ts";
import { addDays, dateIn, fromMonthIndex, monthIndex, weekdayOf } from "../src/dates.ts";
import { lowPoint } from "../src/low-point.ts";
import { LOW_POINT_DAYS } from "../src/thresholds.ts";
import { type Account, type BalanceInput, type IsoDate, NO_INPUTS, type Transaction } from "../src/types.ts";
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
function walk(rows: Transaction[], balances: BalanceInput[], days?: number) {
  const ctx = createContext(rows, [own], TODAY);
  const basis = aheadBasis(ctx, balances, NO_INPUTS);
  return { ctx, basis, point: lowPoint(ctx, basis, balances, NO_INPUTS, days), runway: runwayOf(ctx, basis) };
}

describe("lowPoint with no everyday spending", () => {
  // 500 € on the account, the rent of 900 € on 1.11. and the pay of 3 000 € on 13.11.
  const rows = [...pays(), ...rents()];

  it("is the lowest point of the payday window that Käytettävissä finds: the day it runs short and by how much", () => {
    const { basis, point } = walk(rows, [bal(50_000)], 19);
    const { balance } = basis.ahead;
    expect(basis.ahead.to).toBe("2026-11-13");
    expect(point).toEqual({ known: true, date: "2026-11-01", cents: -40_000, lowCents: -40_000, highCents: -40_000, days: 19 });
    expect(balance!.shortOn).toBe(point.known ? point.date : null);
    expect(balance!.shortCents).toBe(point.known ? -point.cents : null);
  });

  it("counts a pay only from its own day: a payment on the payday is met from the balance before it", () => {
    // the rent is booked on the 13th, the day of the pay: 500 € less 900 € is -400 € that day, not +2 600 €
    const { basis, point } = walk([...pays(), ...rents("2026-03", 13)], [bal(50_000)], 19);
    expect(point).toEqual({ known: true, date: "2026-11-13", cents: -40_000, lowCents: -40_000, highCents: -40_000, days: 19 });
    expect(basis.ahead.balance!.shortOn).toBe("2026-11-13");
    expect(basis.ahead.balance!.shortCents).toBe(40_000);
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
    expect(walk([...rents(), ...everyday], [bal(200_000)]).point).toEqual({ known: false, reason: "no-payday" });
  });

  it("gives the reason when the pay is late", () => {
    // the pay of the 20th is six days late
    expect(walk([...pays("2026-03", "2026-09", 20), ...rents(), ...everyday], [bal(200_000)]).point).toEqual({ known: false, reason: "late" });
  });

  it("gives the reason when a counted account has no balance", () => {
    expect(walk([...pays(), ...rents(), ...everyday], []).point).toEqual({ known: false, reason: "no-balance" });
  });

  it("gives the reason when there are under three complete months to expect everyday spending from", () => {
    expect(walk([...pays("2026-08"), ...rents("2026-08"), ...shopping("2026-08-01", 4000)], [bal(200_000)]).point).toEqual({ known: false, reason: "history" });
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
