import { describe, expect, it } from "vitest";
import { cashAhead } from "../src/analysis/ahead.ts";
import { createContext } from "../src/analysis/context.ts";
import { addDays, dateIn, fromMonthIndex, monthIndex, weekdayOf } from "../src/dates.ts";
import { type Account, type BalanceInput, type ExpectedBill, type IsoDate, NO_INPUTS, type Transaction, type UserInputs } from "../src/types.ts";
import { randomHistory } from "./gen.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: "FI21 1234 5600 0007 85", currency: "EUR", type: "checking" };
const balance = (balanceCents: number): BalanceInput => ({ id: "acc-1", name: "Käyttötili", type: "checking", balanceCents, ownerName: null, balanceAt: "2026-10-03T06:00:00Z" });

interface Payer {
  name: string;
  cents: number;
  /** The day of the month the pay is meant for; at a weekend it is paid on the Friday before. */
  day: number;
}

/** The pay of one payer in each month from `first` to `last` (month keys). */
function pays(p: Payer, first: string, last: string): Transaction[] {
  const rows: Transaction[] = [];
  for (let m = monthIndex(first); m <= monthIndex(last); m++) {
    const date = dateIn(fromMonthIndex(m), p.day);
    const weekday = weekdayOf(date);
    rows.push(tx({ bookingDate: weekday >= 5 ? addDays(date, 4 - weekday) : date, amountCents: p.cents, merchant: p.name, category: "salary" }));
  }
  return rows;
}

/** Rent on the 2nd and 20 euros of groceries a day, so the household has an everyday level and a bill. */
function living(from: IsoDate, to: IsoDate): Transaction[] {
  const rows: Transaction[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    rows.push(tx({ bookingDate: d, amountCents: -2000, merchant: "Prisma", category: "groceries" }));
    if (d.endsWith("-02")) rows.push(tx({ bookingDate: d, amountCents: -90_000, merchant: "Sato", category: "housing" }));
  }
  return rows;
}

const BIG: Payer = { name: "Esimerkki Oy", cents: 300_000, day: 15 };
const SMALL: Payer = { name: "Pieni Esimerkki Oy", cents: 80_000, day: 12 };

const run = (rows: Transaction[], today: IsoDate, inputs: UserInputs = NO_INPUTS, start = 200_000) => cashAhead(createContext(rows.filter((t) => t.bookingDate <= today), [checking], today), [balance(start)], inputs);
/** The same with the balance given on the day itself, so that `start` is what the account holds whatever day it is. */
const runOn = (rows: Transaction[], today: IsoDate, inputs: UserInputs, start: number) =>
  cashAhead(createContext(rows.filter((t) => t.bookingDate <= today), [checking], today), [{ ...balance(start), balanceAt: `${today}T06:00:00Z` }], inputs);
const typed = (name: string, amountCents: number, dueDate: IsoDate): UserInputs => ({ ...NO_INPUTS, expectedBills: [{ id: name, name, amountCents, dueDate, cadence: "once", category: "insurance" }] });

/** A pay that varies by month, as a commission does: the payer's sums in the order the months came. */
function varying(p: Payer, first: string, sums: number[]): Transaction[] {
  return sums.flatMap((cents, i) => pays({ ...p, cents }, fromMonthIndex(monthIndex(first) + i), fromMonthIndex(monthIndex(first) + i)));
}

describe("a coming pay is an estimate", () => {
  const home = [...living("2026-03-01", "2026-10-31"), ...pays(BIG, "2026-03", "2026-09")];
  const commission = varying(SMALL, "2026-03", [80_000, 90_000, 100_000, 110_000, 120_000, 100_000, 90_000]);

  it("tells a steady pay with its day and the range of its pays", () => {
    const d = run(home, "2026-10-03");
    expect(d.payday?.pay).toEqual({ count: 7, lowCents: 300_000, highCents: 300_000, usualCents: 300_000, floorCents: 300_000, ceilCents: 300_000, kind: "steady", baseCents: 300_000 });
  });

  it("gives other pay that varies its range, and counts only the floor of it as a sum", () => {
    const d = run([...home, ...commission], "2026-10-03");
    const [row] = d.rows.filter((r) => r.source === "income");
    expect(row).toMatchObject({ date: "2026-10-12", name: "Pieni Esimerkki Oy", cents: 90_000, pay: { kind: "varies", lowCents: 80_000, highCents: 120_000, usualCents: 100_000, floorCents: 90_000, ceilCents: 105_000 } });
    expect(d.totals.incomeCents).toBe(90_000);
  });

  it("reads the pay before a payment as its floor: a payment the floor does not cover is short, one it covers is not", () => {
    // 100 000 held, a payment of 195 000 on the 13th: the pay of the 12th is at least 90 000 and its usual 100 000
    const short = run([...home, ...commission], "2026-10-03", typed("Vakuutus", 195_000, "2026-10-13"), 100_000);
    expect(short.balance).toMatchObject({ shortOn: "2026-10-13", shortCents: 5000 });
    const covered = run([...home, ...commission], "2026-10-03", typed("Vakuutus", 185_000, "2026-10-13"), 100_000);
    expect(covered.balance).toMatchObject({ shortOn: null, shortCents: 0 });
  });

  it("has no estimate and counts no sum when the pays are too few to say one", () => {
    // three pays, the last two after a raise: one pay of the new level is no evidence
    const raise = varying(SMALL, "2026-02", [80_000, 80_000, 80_000, 80_000, 80_000, 80_000, 100_000, 100_000]);
    const [row] = run([...home, ...raise], "2026-10-03").rows.filter((r) => r.source === "income");
    expect(row).toMatchObject({ cents: 0, pay: null });
  });

  it("leaves holiday pay out of the evidence", () => {
    const holiday = tx({ bookingDate: "2026-06-20", amountCents: 150_000, merchant: "Pieni Esimerkki Oy", category: "salary", description: "LOMARAHA" });
    const d = run([...home, ...pays(SMALL, "2026-03", "2026-09"), holiday], "2026-10-03");
    expect(d.rows.find((r) => r.source === "income")?.pay).toMatchObject({ highCents: 80_000, kind: "steady" });
  });
});

describe("the window to the next payday", () => {
  const history = [...living("2026-03-01", "2026-10-31"), ...pays(BIG, "2026-03", "2026-09")];

  it("a monthly pay on the 15th, today the 3rd: the window ends on the 14th and the pay is not a row", () => {
    const d = run(history, "2026-10-03");
    expect(d.reason).toBe("payday");
    expect(d.payday).toEqual({ date: "2026-10-15", name: "Esimerkki Oy", pay: expect.objectContaining({ usualCents: 300_000, kind: "steady" }) });
    expect([d.from, d.to, d.days]).toEqual(["2026-10-03", "2026-10-14", 11]);
    expect(d.rows.some((r) => r.source === "income")).toBe(false);
    expect(d.totals.incomeCents).toBe(0);
    // the rent of 2.10. is paid and the next one comes after the pay: nothing is due, so the whole balance is free
    expect(d.balance).toMatchObject({ startCents: 200_000, freeCents: 200_000, shortCents: 0, shortOn: null });
  });

  it("the 15th is a Sunday: the payday is the Friday before, and the window ends on the Thursday", () => {
    // 15.2.2026 is a Sunday, the pay of the household came on the Fridays before its Saturdays and Sundays
    expect(weekdayOf("2026-02-15")).toBe(6);
    const rows = [...living("2025-09-01", "2026-02-28"), ...pays(BIG, "2025-09", "2026-01")];
    const d = run(rows, "2026-02-03");
    expect(d.payday!.date).toBe("2026-02-13");
    expect(weekdayOf(d.to)).toBe(3);
    expect(d.to).toBe("2026-02-12");
  });

  it("two payers: the larger one sets the window, the smaller one's pay inside it is a row", () => {
    const d = run([...history, ...pays(SMALL, "2026-03", "2026-09")], "2026-10-03");
    expect(d.payday).toMatchObject({ date: "2026-10-15", name: "Esimerkki Oy" });
    expect(d.rows.filter((r) => r.source === "income")).toEqual([{ date: "2026-10-12", name: "Pieni Esimerkki Oy", category: "salary", cents: 80_000, source: "income", pay: expect.objectContaining({ usualCents: 80_000, floorCents: 80_000 }) }]);
    expect(d.totals.incomeCents).toBe(80_000);
    expect(d.to).toBe("2026-10-14");
  });

  it("no regular payer: 30 days, reason none", () => {
    const d = run(living("2026-03-01", "2026-10-31"), "2026-10-03");
    expect(d).toMatchObject({ reason: "none", payday: null, to: "2026-11-02", days: 30 });
    // the rent of 2.11. is the last day's
    expect(d.rows.map((r) => [r.date, r.cents])).toEqual([["2026-11-02", -90_000]]);
    expect(d.balance).toMatchObject({ startCents: 200_000, freeCents: 110_000 });
  });

  it("a pay that is late today: 30 days, reason late, with the day it was expected", () => {
    // paid until Friday 14.8.; the next one was due about 14.9., eight days ago, and the series is still alive
    const rows = [...living("2026-03-01", "2026-10-31"), ...pays(BIG, "2026-03", "2026-08")];
    const d = run(rows, "2026-09-22");
    expect(d).toMatchObject({ reason: "late", days: 30, to: "2026-10-22" });
    expect(d.payday).toMatchObject({ name: "Esimerkki Oy", pay: expect.objectContaining({ usualCents: 300_000, kind: "steady" }) });
    expect(d.payday!.date < d.from).toBe(true);
    expect(d.rows.some((r) => r.source === "income")).toBe(false);
  });

  it("a pay expected yesterday and not late yet ends no window: it runs to the day before the next pay, and the payday keeps the day it was expected", () => {
    // the pay of Thursday 15.10. has not come; the next one is that of Friday 13.11., since the 15th is a Sunday
    const d = run(history, "2026-10-16");
    expect(d).toMatchObject({ reason: "payday", days: 27, from: "2026-10-16", to: "2026-11-12" });
    expect(d.payday).toEqual({ date: "2026-10-16", expected: "2026-10-15", next: "2026-11-13", name: "Esimerkki Oy", pay: expect.objectContaining({ usualCents: 300_000, kind: "steady" }) });
    // the pay that has not come is no row, and the rent of 2.11. is due
    expect(d.rows.map((r) => [r.date, r.source, r.cents])).toEqual([["2026-11-02", "recurring", -90_000]]);
    // near misses: on the day itself and the day before nothing has gone by, so there is no second day to tell
    expect(run(history, "2026-10-15").payday).toEqual({ date: "2026-10-15", name: "Esimerkki Oy", pay: expect.objectContaining({ usualCents: 300_000, kind: "steady" }) });
    expect(run(history, "2026-10-14").payday).toEqual({ date: "2026-10-15", name: "Esimerkki Oy", pay: expect.objectContaining({ usualCents: 300_000, kind: "steady" }) });
  });

  const everyOtherMonth = ["02", "04", "06", "08"].map((m) => tx({ bookingDate: `2026-${m}-10`, amountCents: 150_000, merchant: "Kausi Esimerkki Oy", category: "salary" }));

  it("a payer who pays every other month, next pay in 50 days: 30 days", () => {
    const rows = [...living("2026-01-01", "2026-12-31"), ...everyOtherMonth];
    // 10.10. is 50 days after 21.8.
    const d = run(rows, "2026-08-21");
    expect(d).toMatchObject({ reason: "none", payday: null, days: 30 });
    // 45 days is still a payday to wait for, and the window is 44 days
    const near = run(rows, "2026-08-26");
    expect(near).toMatchObject({ reason: "payday", days: 44 });
    expect(near.payday!.date).toBe("2026-10-10");
  });

  it("that payer's pay two days behind, the one after it 59 days away: the payday names no next pay, and the window is the 30 days", () => {
    const d = run([...living("2026-01-01", "2026-12-31"), ...everyOtherMonth], "2026-10-12");
    expect(d.payday).toEqual({ date: "2026-10-12", expected: "2026-10-10", name: "Kausi Esimerkki Oy", pay: expect.objectContaining({ usualCents: 150_000, kind: "steady" }) });
    expect(d).toMatchObject({ reason: "payday", days: 30, to: "2026-11-11" });
  });

  it("the payday today with the pay not yet in: the window is today alone, and tomorrow's payday gives the same window", () => {
    // Rule: a pay that is due today and not late is the payday. The window runs from today to the day before it, which
    // is empty, so it is today alone: the balance of today is the last one before the pay.
    const today = run(history, "2026-10-15");
    expect(today).toMatchObject({ reason: "payday", days: 0, from: "2026-10-15", to: "2026-10-15" });
    expect(today.payday!.date).toBe("2026-10-15");
    expect(today.rows.some((r) => r.source === "income")).toBe(false);
    // the balance given on 3.10. less the twelve days of purchases booked since, and nothing is due today
    expect(today.balance).toMatchObject({ startCents: 176_000, freeCents: 176_000 });
    const tomorrow = run(history, "2026-10-14");
    expect(tomorrow).toMatchObject({ reason: "payday", days: 0, to: "2026-10-14" });
    expect(tomorrow.payday!.date).toBe("2026-10-15");
  });

  it("a typed-in bill on the payday itself is outside the window, one the day before is in it", () => {
    const bill = (id: string, dueDate: IsoDate): ExpectedBill => ({ id, name: `Lasku ${id}`, amountCents: 10_000, dueDate, cadence: "once", category: "insurance" });
    const d = run(history, "2026-10-03", { ...NO_INPUTS, expectedBills: [bill("a", "2026-10-14"), bill("b", "2026-10-15")] });
    expect(d.rows.map((r) => r.name)).toEqual(["Lasku a"]);
    expect(d.totals).toMatchObject({ typedCents: 10_000, dueCents: 10_000 });
    expect(d.balance!.freeCents).toBe(190_000);
  });

  it("a bill due after the payday is in the 30-day list and not in the window, which it leaves as it was", () => {
    const bill: ExpectedBill = { id: "c", name: "Lasku c", amountCents: 25_000, dueDate: "2026-10-20", cadence: "once", category: "insurance" };
    const plain = run(history, "2026-10-03");
    const d = run(history, "2026-10-03", { ...NO_INPUTS, expectedBills: [bill] });
    expect(d.upcoming.map((r) => [r.date, r.name, r.cents])).toContainEqual(["2026-10-20", "Lasku c", -25_000]);
    expect(d.rows.map((r) => r.name)).not.toContain("Lasku c");
    expect(d.totals).toEqual(plain.totals);
    expect(d.balance).toEqual(plain.balance);
    // the payments of the window are the first part of the list: the rent on the 2nd is the last day of the 30
    expect(plain.upcoming.map((r) => r.date)).toEqual(["2026-11-02"]);
    expect(d.upcoming.map((r) => r.name)).toEqual(["Lasku c", "Sato"]);
  });

  it("the 30-day list is the same list when no payday sets the window", () => {
    const d = run(living("2026-03-01", "2026-10-31"), "2026-10-03");
    expect(d.upcoming).toEqual(d.rows.filter((r) => r.cents < 0));
  });

  it("a window longer than 30 days still gives 30 days of payments, and the window its own", () => {
    const rows = [...living("2026-01-01", "2026-12-31"), ...["02", "04", "06", "08"].map((m) => tx({ bookingDate: `2026-${m}-10`, amountCents: 150_000, merchant: "Kausi Esimerkki Oy", category: "salary" }))];
    // the pay comes on 10.10., 45 days after 26.8.: the window is 44 days, the rent of 2.9. and 2.10. is in it
    const d = run(rows, "2026-08-26");
    expect(d.days).toBe(44);
    expect(d.rows.filter((r) => r.source === "recurring").map((r) => r.date)).toEqual(["2026-09-02", "2026-10-02"]);
    expect(d.upcoming.map((r) => r.date)).toEqual(["2026-09-02"]);
  });
});

describe("the pays to wait for", () => {
  const FIRST: Payer = { name: "Esimerkki Oy", cents: 278_000, day: 23 };
  const SECOND: Payer = { name: "Toinen Esimerkki Oy", cents: 210_000, day: 5 };
  const home = living("2026-03-01", "2026-12-31");

  it("two salaries of 2 780 and 2 100 euros on the 23rd and the 5th: the window ends before the nearer one, whichever it is", () => {
    const rows = [...home, ...pays(FIRST, "2026-03", "2026-10"), ...pays(SECOND, "2026-03", "2026-10")];
    // on 9.10. the pay of the 5th has come: the 23rd is next, and the smaller salary of 5.11. is far behind it
    const d = run(rows, "2026-10-09");
    expect(d.payday).toEqual({ date: "2026-10-23", name: "Esimerkki Oy", pay: expect.objectContaining({ usualCents: 278_000, kind: "steady" }) });
    expect([d.reason, d.to]).toEqual(["payday", "2026-10-22"]);
    // on 26.10. the larger pay has come: the smaller salary of 5.11. ends the window, and it is named
    const later = run(rows, "2026-10-26");
    expect(later.payday).toEqual({ date: "2026-11-05", name: "Toinen Esimerkki Oy", pay: expect.objectContaining({ usualCents: 210_000, kind: "steady" }) });
    expect([later.reason, later.to, later.days]).toEqual(["payday", "2026-11-04", 9]);
    // neither pay is a row: one ends the window, the other comes after it
    expect([...d.rows, ...later.rows].some((r) => r.source === "income")).toBe(false);
  });

  it("a child benefit of 95 euros does not end the window: it is a row of it", () => {
    const benefit = pays({ name: "Kela", cents: 9500, day: 12 }, "2026-03", "2026-09").map((t) => ({ ...t, category: "benefits" }));
    const d = run([...home, ...pays(FIRST, "2026-03", "2026-09"), ...benefit], "2026-10-09");
    expect(d.payday).toMatchObject({ date: "2026-10-23", name: "Esimerkki Oy" });
    expect(d.rows.filter((r) => r.source === "income").map((r) => [r.date, r.name, r.cents])).toEqual([["2026-10-12", "Kela", 9500]]);
  });

  it("a salary of 49 % of the largest does not end the window, one of 50 % does", () => {
    const other = (cents: number) => pays({ name: "Pieni Esimerkki Oy", cents, day: 12 }, "2026-03", "2026-09");
    const under = run([...home, ...pays(BIG, "2026-03", "2026-09"), ...other(147_000)], "2026-10-03");
    expect(under.payday).toMatchObject({ date: "2026-10-15", name: "Esimerkki Oy" });
    expect(under.rows.filter((r) => r.source === "income").map((r) => [r.date, r.cents])).toEqual([["2026-10-12", 147_000]]);
    const half = run([...home, ...pays(BIG, "2026-03", "2026-09"), ...other(150_000)], "2026-10-03");
    expect(half.payday).toEqual({ date: "2026-10-12", name: "Pieni Esimerkki Oy", pay: expect.objectContaining({ usualCents: 150_000, kind: "steady" }) });
    expect(half.to).toBe("2026-10-11");
    expect(half.rows.some((r) => r.source === "income")).toBe(false);
  });

  it("of two pays to wait for on one day the larger one is named, and the other is no row of a window that ends before it", () => {
    const same = run([...home, ...pays(BIG, "2026-03", "2026-09"), ...pays({ name: "Pieni Esimerkki Oy", cents: 150_000, day: 15 }, "2026-03", "2026-09")], "2026-10-03");
    expect(same.payday).toEqual({ date: "2026-10-15", name: "Esimerkki Oy", pay: expect.objectContaining({ usualCents: 300_000, kind: "steady" }) });
    expect(same.rows.some((r) => r.source === "income")).toBe(false);
  });

  it("the largest pay late: the late pay is told, and the window still ends the day before the other salary, so no salary is inside it", () => {
    // the larger salary came last on Friday 21.8.; on 29.9. the pay of 23.9. is six days late. The other one comes on 5.10.
    const rows = [...home, ...pays(FIRST, "2026-03", "2026-08"), ...pays(SECOND, "2026-03", "2026-10")];
    const d = runOn(rows, "2026-09-29", typed("Autovakuutus", 80_000, "2026-10-20"), 150_000);
    expect(d).toMatchObject({ reason: "late", days: 5, to: "2026-10-04" });
    expect(d.payday).toMatchObject({ name: "Esimerkki Oy", pay: expect.objectContaining({ usualCents: 278_000, kind: "steady" }) });
    expect(d.payday!.date < d.from).toBe(true);
    // the rent of 2.10. is the window's one row; the bill of the 20th comes after the salary and is in the 30 days of Laskut
    expect(d.rows.map((r) => [r.date, r.source, r.cents])).toEqual([["2026-10-02", "recurring", -90_000]]);
    expect(d.upcoming.map((r) => r.date)).toEqual(["2026-10-02", "2026-10-20"]);
    // 1 500 euros cover the 900: nothing says the account is short of the 800 the salary of the 5th comes before
    expect(d.balance).toMatchObject({ startCents: 150_000, freeCents: 60_000, shortCents: 0, shortOn: null });
  });

  it("a salary two days behind ends no window: tomorrow's bill is due, and the pay keeps the day it was expected", () => {
    // Wednesday 7.10.: the pay of Monday 5.10. has not come and is not late yet; the next pay to wait for is that of the 23rd
    const rows = [...home, ...pays(FIRST, "2026-03", "2026-09"), ...pays(SECOND, "2026-03", "2026-09")];
    const d = runOn(rows, "2026-10-07", typed("Autovakuutus", 90_000, "2026-10-08"), 40_000);
    expect(d.payday).toEqual({ date: "2026-10-07", expected: "2026-10-05", next: "2026-10-23", name: "Toinen Esimerkki Oy", pay: expect.objectContaining({ usualCents: 210_000, kind: "steady" }) });
    expect([d.reason, d.to, d.days]).toEqual(["payday", "2026-10-22", 15]);
    // the pay that has not come is no row and covers nothing: 400 euros do not reach the 900 of tomorrow
    expect(d.rows.map((r) => [r.date, r.source, r.cents])).toEqual([["2026-10-08", "expected", -90_000]]);
    expect(d.balance).toMatchObject({ freeCents: -50_000, shortCents: 50_000, shortOn: "2026-10-08" });
    // near miss: on the day itself nothing has gone by, the pay ends the window and the bill of the 8th is after it
    const onDay = runOn(rows, "2026-10-05", typed("Autovakuutus", 90_000, "2026-10-08"), 40_000);
    expect(onDay.payday).toEqual({ date: "2026-10-05", name: "Toinen Esimerkki Oy", pay: expect.objectContaining({ usualCents: 210_000, kind: "steady" }) });
    expect([onDay.to, onDay.rows.length]).toEqual(["2026-10-05", 0]);
  });

  it("the smaller salary late: the payday of the larger one ends the window, and the late pay is no row", () => {
    // the smaller salary came last on 5.8.; on 14.9. the pay of Friday 4.9. is ten days late
    const rows = [...home, ...pays(FIRST, "2026-03", "2026-08"), ...pays(SECOND, "2026-03", "2026-08")];
    const d = run(rows, "2026-09-14");
    expect(d.payday).toEqual({ date: "2026-09-23", name: "Esimerkki Oy", pay: expect.objectContaining({ usualCents: 278_000, kind: "steady" }) });
    expect([d.reason, d.to]).toEqual(["payday", "2026-09-22"]);
    expect(d.rows.some((r) => r.source === "income")).toBe(false);
  });

  it("money a shop pays back every month is no pay, however large", () => {
    const refunds = pays({ name: "Verkkokauppa", cents: 350_000, day: 10 }, "2026-03", "2026-09").map((t) => ({ ...t, category: "shopping" }));
    const d = run([...home, ...pays(BIG, "2026-03", "2026-09"), ...refunds], "2026-10-03");
    expect(d.payday).toEqual({ date: "2026-10-15", name: "Esimerkki Oy", pay: expect.objectContaining({ usualCents: 300_000, kind: "steady" }) });
    expect(d.rows.map((r) => r.name)).not.toContain("Verkkokauppa");
    expect(d.totals.incomeCents).toBe(0);
    // alone it gives no payday at all
    expect(run([...home, ...refunds], "2026-10-03")).toMatchObject({ reason: "none", payday: null });
  });
});

describe("the three figures: the balance, what is due and what is free", () => {
  const history = [...living("2026-03-01", "2026-10-31"), ...pays(BIG, "2026-03", "2026-09")];
  const bill = (id: string, dueDate: IsoDate, amountCents: number): ExpectedBill => ({ id, name: `Lasku ${id}`, amountCents, dueDate, cadence: "once", category: "insurance" });
  // 100 euros on the 6th, 60 and 50 on the 8th, 30 on the 12th: 240 euros before the pay of the 15th
  const BILLS = [bill("a", "2026-10-06", 10_000), bill("b", "2026-10-08", 5000), bill("c", "2026-10-08", 6000), bill("d", "2026-10-12", 3000)];
  const on = (start: number, rows: Transaction[] = history, bills: ExpectedBill[] = BILLS) => run(rows, "2026-10-03", { ...NO_INPUTS, expectedBills: bills }, start);

  it("what is free is the balance less what is due, and nothing is short while the balance covers the payments", () => {
    const d = on(100_000);
    expect(d.totals).toMatchObject({ typedCents: 24_000, dueCents: 24_000, incomeCents: 0 });
    expect(d.balance).toMatchObject({ startCents: 100_000, freeCents: 76_000, shortCents: 0, shortOn: null });
    // the usual day is told and taken off nothing: 20 euros a day for eleven days would be 220 euros more
    expect(d.everydayPerDayCents).toBe(2000);
  });

  it("the day it runs short is the day of the payment that takes the payments over the balance, the larger of a day first", () => {
    // 200 euros: 100 on the 6th and 60 on the 8th are covered, the 50 of the 8th is not
    expect(on(20_000).balance).toMatchObject({ freeCents: -4000, shortCents: 4000, shortOn: "2026-10-08" });
    // 150 euros: the first payment of the 8th already goes over
    expect(on(15_000).balance).toMatchObject({ freeCents: -9000, shortCents: 9000, shortOn: "2026-10-08" });
    expect(on(9999).balance).toMatchObject({ shortCents: 14_001, shortOn: "2026-10-06" });
  });

  it("the last cent covers: 240,00 is not short, 239,99 is short by a cent on the day of the last payment", () => {
    expect(on(24_000).balance).toMatchObject({ freeCents: 0, shortCents: 0, shortOn: null });
    expect(on(23_999).balance).toMatchObject({ freeCents: -1, shortCents: 1, shortOn: "2026-10-12" });
  });

  it("a pay that lands in the window is a row and changes none of the three", () => {
    const withPay = on(20_000, [...history, ...pays(SMALL, "2026-03", "2026-09")]);
    expect(withPay.rows.filter((r) => r.source === "income").map((r) => [r.date, r.cents])).toEqual([["2026-10-12", 80_000]]);
    expect(withPay.totals.incomeCents).toBe(80_000);
    expect(withPay.totals.dueCents).toBe(24_000);
    // 800 euros come on the 12th, and the balance is still short on the 8th
    expect(withPay.balance).toEqual(on(20_000).balance);
  });

  it("pay dated before a payment counts for it, pay of the same day does not, and what is short is the most the account lacks", () => {
    // a part-time pay of 1 300 euros on Monday 12.10., under half of the salary: a row of the window to the 15th
    const withPay = [...history, ...pays({ name: "Pieni Esimerkki Oy", cents: 130_000, day: 12 }, "2026-03", "2026-09")];
    // 200 euros and a bill of 300 on the 13th: the pay of the 12th has come, so nothing is short, and what is free stays the balance less the payments
    expect(on(20_000, withPay, [bill("e", "2026-10-13", 30_000)]).balance).toMatchObject({ freeCents: -10_000, shortCents: 0, shortOn: null });
    // the same bill on the 12th itself: the pay of that day is not there yet
    expect(on(20_000, withPay, [bill("e", "2026-10-12", 30_000)]).balance).toMatchObject({ freeCents: -10_000, shortCents: 10_000, shortOn: "2026-10-12" });
    // 300 on the 10th and 300 on the 13th: short by 100 on the 10th, and the pay covers the rest
    expect(on(20_000, withPay, [bill("e", "2026-10-10", 30_000), bill("f", "2026-10-13", 30_000)]).balance).toMatchObject({ freeCents: -40_000, shortCents: 10_000, shortOn: "2026-10-10" });
  });

  it("a counted account without a balance leaves no figures: its payments are not taken off the balance of another", () => {
    const joint: Account = { id: "joint", name: "Yhteinen tili", iban: "FI14 1009 3000 1234 58", currency: "EUR", type: "checking" };
    const today = "2026-10-09";
    // the joint account pays the rent of 900 on the 2nd; the other account holds 500 euros and pays nothing
    const ctx = createContext(living("2026-03-01", today).map((t) => ({ ...t, accountId: "joint" })), [checking, joint], today);
    const given = (balanceCents: number | null): BalanceInput => ({ id: "joint", name: "Yhteinen tili", type: "checking", balanceCents, ownerName: null, balanceAt: `${today}T06:00:00Z` });
    const d = cashAhead(ctx, [balance(50_000), given(null)], NO_INPUTS);
    expect(d.rows.map((r) => [r.date, r.name, r.cents])).toEqual([["2026-11-02", "Sato", -90_000]]);
    expect([d.balance, d.missing, d.totals.dueCents]).toEqual([null, "balance", 90_000]);
    // near miss: with the balance of both the figures are there, the two added up
    const both = cashAhead(ctx, [balance(50_000), given(60_000)], NO_INPUTS);
    expect(both.balance).toMatchObject({ startCents: 110_000, accounts: 2, freeCents: 20_000, shortCents: 0, shortOn: null });
    expect(both.missing).toBeNull();
  });

  it("an account below zero with nothing due is short by what it is below, on no day", () => {
    expect(on(-5000, history, []).balance).toMatchObject({ startCents: -5000, freeCents: -5000, shortCents: 5000, shortOn: null });
    // with a payment the first one is the day
    expect(on(-5000, history, [BILLS[3]!]).balance).toMatchObject({ freeCents: -8000, shortCents: 8000, shortOn: "2026-10-12" });
  });
});

describe("the next pay after one that came early or late", () => {
  const once = { name: "Esimerkki Oy", cents: 300_000, day: 1 };

  it("a pay meant for the 1st that came on the Friday before is not expected again: the next one is a month on", () => {
    // 1.8.2026 and 1.11.2026 are a Saturday and a Sunday, so the pay of that month came on the Friday before
    expect([weekdayOf("2026-08-01"), weekdayOf("2026-11-01")]).toEqual([5, 6]);
    const august = run([...living("2026-04-01", "2026-12-31"), ...pays(once, "2026-06", "2026-08")], "2026-08-10");
    expect(august.reason).toBe("payday");
    expect(august.payday!.date).toBe("2026-09-01");
    expect(august.days).toBe(21);
    const november = run([...living("2026-04-01", "2026-12-31"), ...pays(once, "2026-09", "2026-11")], "2026-11-05");
    expect(november.payday!.date).toBe("2026-12-01");
  });

  it("a pay booked late in the next month does not hide that month's pay", () => {
    const late: Payer = { name: "Toinen Oy", cents: 300_000, day: 28 };
    // October's pay was booked on 2.11., and the 28th of November is a Saturday, so the pay is on Friday the 27th
    const rows = [...living("2026-03-01", "2026-12-31"), ...pays(late, "2026-03", "2026-09"), tx({ bookingDate: "2026-11-02", amountCents: 300_000, merchant: late.name, category: "salary" })];
    const d = run(rows, "2026-11-05");
    expect(d.reason).toBe("payday");
    expect(d.payday!.date).toBe("2026-11-27");
  });

  it("a pay day on a bank holiday moves to the banking day before, as the income report has it", () => {
    // paid on the 24th, or the Friday before at a weekend; 24.12.2026 is a Thursday, Christmas Eve, a closed day
    expect(weekdayOf("2026-12-24")).toBe(3);
    const rows = [...living("2026-04-01", "2026-12-31"), ...pays({ name: "Esimerkki Oy", cents: 300_000, day: 24 }, "2026-05", "2026-11")];
    const d = run(rows, "2026-12-03");
    expect(d.reason).toBe("payday");
    expect(d.payday!.date).toBe("2026-12-23");
    expect(d.to).toBe("2026-12-22");
  });
});

describe("what is free is the balance less the payments of the window", () => {
  const bills: ExpectedBill[] = [{ id: "b1", name: "Autovakuutus", amountCents: 41_000, dueDate: "2025-11-12", cadence: "once", category: "insurance" }];

  it("to the cent in every seeded household, and the day it runs short is the first payment the balance does not reach", () => {
    let paydays = 0;
    let short = 0;
    let rows = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      for (const settled of [true, false]) {
        const { txs, accounts } = randomHistory(seed, 1500, { months: 14, settled });
        for (const offset of [1, 6, 11, 16, 21, 26]) {
          const today = addDays("2025-10-28", offset);
          const ctx = createContext(txs.filter((t) => t.bookingDate <= today), accounts, today);
          // the checking account of the seeded household, with a balance that covers the payments of some windows and not of others
          const chk: BalanceInput = { id: "chk", name: "Käyttötili", type: "checking", balanceCents: seed * 25_000, ownerName: null, balanceAt: `${today}T06:00:00Z` };
          const d = cashAhead(ctx, [chk], { ...NO_INPUTS, expectedBills: bills });
          rows += d.rows.length;
          const label = `seed ${seed}, settled ${settled}, ${today}`;
          const payments = d.rows.filter((r) => r.cents < 0);
          const b = d.balance!;
          expect(d.totals.dueCents, label).toBe(payments.reduce((s, r) => s - r.cents, 0));
          expect(d.totals.dueCents, label).toBe(d.totals.recurringCents + d.totals.typedCents + d.totals.cardCents + d.totals.transferCents);
          expect(b.freeCents, label).toBe(b.startCents - d.totals.dueCents);
          // walked by hand: the payments in the order of the rows, each against the balance and the pay dated before its day
          let [paid, lowest] = [0, b.startCents];
          let crossing: IsoDate | null = null;
          for (const r of payments) {
            paid -= r.cents;
            const left = b.startCents + d.rows.filter((p) => p.cents > 0 && p.date < r.date).reduce((s, p) => s + p.cents, 0) - paid;
            if (left < 0) crossing ??= r.date;
            lowest = Math.min(lowest, left);
          }
          expect(b.shortOn, label).toBe(crossing);
          expect(b.shortCents, label).toBe(Math.max(0, -lowest));
          // with no pay in the window that is what the payments exceed the balance by
          if (d.totals.incomeCents === 0) expect(b.shortCents, label).toBe(Math.max(0, -b.freeCents));
          if (b.shortOn) short++;
          expect(d.totals.recurringCents, label).toBe(d.rows.filter((r) => r.source === "recurring").reduce((s, r) => s - r.cents, 0));
          expect(d.rows.every((r) => r.date >= d.from && r.date <= d.to), label).toBe(true);
          // the 30 days of payments hold the bills of the window, the same rows in the same order, and the bills an
          // account outside the balance pays; the bill of a card and a transfer are rows of the window only
          expect(d.upcoming.every((r) => r.cents < 0 && r.date >= d.from && r.date <= addDays(d.from, 30)), label).toBe(true);
          const to30 = (d.to < addDays(d.from, 30) ? d.to : addDays(d.from, 30));
          const ownBills = d.rows.filter((r) => (r.source === "recurring" || r.source === "expected") && r.date <= to30);
          expect(d.upcoming.filter((r) => ownBills.includes(r)), label).toEqual(ownBills);
          expect(d.upcoming.every((r) => r.source === "recurring" || r.source === "expected"), label).toBe(true);
          if (d.reason === "payday") {
            paydays++;
            expect(d.days, label).toBeLessThanOrEqual(44);
            // the window ends the day before the pay, or is today alone when the pay is today or tomorrow; a pay whose
            // day has gone by is named for today and ends no window
            if (d.payday!.expected) expect([d.payday!.date, d.payday!.expected < d.from], label).toEqual([d.from, true]);
            else expect(d.payday!.date === addDays(d.to, 1) || (d.days === 0 && d.payday!.date <= addDays(d.from, 1)), label).toBe(true);
          } else if (d.reason === "late") {
            // 30 days, or to the day before another pay to wait for
            expect(d.days, label).toBeLessThanOrEqual(44);
          } else {
            expect(d.days, label).toBe(30);
          }
          // no pay to wait for is inside a window: a row of pay is under half of the largest, so smaller than the pay it names
          if (d.reason === "payday") for (const r of d.rows) if (r.cents > 0) expect(r.cents, label).toBeLessThan(d.payday!.pay!.usualCents);
        }
      }
    }
    // the check is no check if no household had a payday or a row, or if none ran short and none was covered
    expect(paydays).toBeGreaterThan(10);
    expect(rows).toBeGreaterThan(96);
    expect(short).toBeGreaterThan(5);
    expect(short).toBeLessThan(90);
  }, 30_000);
});
