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

describe("the window to the next payday", () => {
  const history = [...living("2026-03-01", "2026-10-31"), ...pays(BIG, "2026-03", "2026-09")];

  it("a monthly pay on the 15th, today the 3rd: the window ends on the 14th and the pay is not a row", () => {
    const d = run(history, "2026-10-03");
    expect(d.reason).toBe("payday");
    expect(d.payday).toEqual({ date: "2026-10-15", name: "Esimerkki Oy", cents: 300_000 });
    expect([d.from, d.to, d.days]).toEqual(["2026-10-03", "2026-10-14", 11]);
    expect(d.rows.some((r) => r.source === "income")).toBe(false);
    expect(d.totals.incomeCents).toBe(0);
    expect(d.balance!.days).toHaveLength(12);
    expect(d.balance!.last).toEqual(d.balance!.days.at(-1));
    expect(d.balance!.last.date).toBe("2026-10-14");
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
    expect(d.rows.filter((r) => r.source === "income")).toEqual([{ date: "2026-10-12", name: "Pieni Esimerkki Oy", category: "salary", cents: 80_000, source: "income" }]);
    expect(d.totals.incomeCents).toBe(80_000);
    expect(d.to).toBe("2026-10-14");
  });

  it("no regular payer: 30 days, reason none", () => {
    const d = run(living("2026-03-01", "2026-10-31"), "2026-10-03");
    expect(d).toMatchObject({ reason: "none", payday: null, to: "2026-11-02", days: 30 });
    expect(d.balance!.days).toHaveLength(31);
  });

  it("a pay that is late today: 30 days, reason late, with the day it was expected", () => {
    // paid until Friday 14.8.; the next one was due about 14.9., eight days ago, and the series is still alive
    const rows = [...living("2026-03-01", "2026-10-31"), ...pays(BIG, "2026-03", "2026-08")];
    const d = run(rows, "2026-09-22");
    expect(d).toMatchObject({ reason: "late", days: 30, to: "2026-10-22" });
    expect(d.payday).toMatchObject({ name: "Esimerkki Oy", cents: 300_000 });
    expect(d.payday!.date < d.from).toBe(true);
    expect(d.rows.some((r) => r.source === "income")).toBe(false);
  });

  it("a pay expected yesterday and not late yet: the window is today alone, and the payday keeps the day it was expected", () => {
    const d = run(history, "2026-10-16");
    expect(d).toMatchObject({ reason: "payday", days: 0, from: "2026-10-16", to: "2026-10-16" });
    expect(d.payday).toEqual({ date: "2026-10-16", expected: "2026-10-15", name: "Esimerkki Oy", cents: 300_000 });
    // the balance counts from today, as it does when the payday is today
    expect(d.balance!.days.map((x) => x.date)).toEqual(["2026-10-16"]);
    expect(d.rows.some((r) => r.source === "income")).toBe(false);
    // near misses: on the day itself and the day before nothing has gone by, so there is no second day to tell
    expect(run(history, "2026-10-15").payday).toEqual({ date: "2026-10-15", name: "Esimerkki Oy", cents: 300_000 });
    expect(run(history, "2026-10-14").payday).toEqual({ date: "2026-10-15", name: "Esimerkki Oy", cents: 300_000 });
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

  it("the payday today with the pay not yet in: the window is today alone, and tomorrow's payday gives the same window", () => {
    // Rule: a pay that is due today and not late is the payday. The window runs from today to the day before it, which
    // is empty, so it is today alone: the balance of today is the last one before the pay.
    const today = run(history, "2026-10-15");
    expect(today).toMatchObject({ reason: "payday", days: 0, from: "2026-10-15", to: "2026-10-15" });
    expect(today.payday!.date).toBe("2026-10-15");
    expect(today.rows.some((r) => r.source === "income")).toBe(false);
    // the balance given on 3.10. less the twelve days of purchases booked since
    expect(today.balance!.days).toEqual([{ date: "2026-10-15", cents: 176_000 }]);
    expect(today.totals.everydayCents).toBe(0);
    const tomorrow = run(history, "2026-10-14");
    expect(tomorrow).toMatchObject({ reason: "payday", days: 0, to: "2026-10-14" });
    expect(tomorrow.payday!.date).toBe("2026-10-15");
  });

  it("names the last day and the lowest day once, as the walk has them", () => {
    const d = run(history, "2026-10-03", NO_INPUTS, 10_000);
    const days = d.balance!.days;
    expect(d.balance!.last).toEqual(days.at(-1));
    expect(d.balance!.lowest).toEqual(days.reduce((low, x) => (x.cents < low.cents ? x : low), days[0]!));
    // 20 euros a day from 100 euros: the account runs out before the pay
    expect(d.balance!.lowest.cents).toBeLessThan(0);
  });

  it("a typed-in bill on the payday itself is outside the window, one the day before is in it", () => {
    const bill = (id: string, dueDate: IsoDate): ExpectedBill => ({ id, name: `Lasku ${id}`, amountCents: 10_000, dueDate, cadence: "once", category: "insurance" });
    const d = run(history, "2026-10-03", { ...NO_INPUTS, expectedBills: [bill("a", "2026-10-14"), bill("b", "2026-10-15")] });
    expect(d.rows.map((r) => r.name)).toEqual(["Lasku a"]);
    expect(d.totals.typedCents).toBe(10_000);
  });

  it("a bill due after the payday is in the 30-day list and not in the window, which it leaves as it was", () => {
    const bill: ExpectedBill = { id: "c", name: "Lasku c", amountCents: 25_000, dueDate: "2026-10-20", cadence: "once", category: "insurance" };
    const plain = run(history, "2026-10-03");
    const d = run(history, "2026-10-03", { ...NO_INPUTS, expectedBills: [bill] });
    expect(d.upcoming.map((r) => [r.date, r.name, r.cents])).toContainEqual(["2026-10-20", "Lasku c", -25_000]);
    expect(d.rows.map((r) => r.name)).not.toContain("Lasku c");
    expect(d.totals).toEqual(plain.totals);
    expect(d.balance!.last).toEqual(plain.balance!.last);
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

describe("the totals add up to the walk", () => {
  const bills: ExpectedBill[] = [{ id: "b1", name: "Autovakuutus", amountCents: 41_000, dueDate: "2025-11-12", cadence: "once", category: "insurance" }];
  const sumOfWalk = (d: ReturnType<typeof cashAhead>, start: number) =>
    start + d.totals.incomeCents - d.totals.recurringCents - d.totals.typedCents - d.totals.cardCents - d.totals.transferCents - d.totals.everydayCents;

  it("start plus income less bills, card bills, transfers and everyday spending is the last day's balance, to the cent, in every seeded household", () => {
    let paydays = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      for (const settled of [true, false]) {
        const { txs, accounts } = randomHistory(seed, 1500, { months: 14, settled });
        for (const offset of [1, 6, 11, 16, 21, 26]) {
          const today = addDays("2025-10-28", offset);
          const ctx = createContext(txs.filter((t) => t.bookingDate <= today), accounts, today);
          const start = 150_000 + seed * 1000;
          const d = cashAhead(ctx, [balance(start)], { ...NO_INPUTS, expectedBills: bills });
          const label = `seed ${seed}, settled ${settled}, ${today}`;
          if (d.balance) {
            expect(d.balance.last.cents, label).toBe(sumOfWalk(d, start));
            expect(d.balance.last.date, label).toBe(d.to);
          }
          expect(d.totals.recurringCents, label).toBe(d.rows.filter((r) => r.source === "recurring").reduce((s, r) => s - r.cents, 0));
          expect(d.rows.every((r) => r.date >= d.from && r.date <= d.to), label).toBe(true);
          // the 30 days of payments hold the window's own bills, the same rows in the same order, and the bills an
          // account outside the balance pays; a card's bill and a transfer are rows of the window only
          expect(d.upcoming.every((r) => r.cents < 0 && r.date >= d.from && r.date <= addDays(d.from, 30)), label).toBe(true);
          const to30 = (d.to < addDays(d.from, 30) ? d.to : addDays(d.from, 30));
          const ownBills = d.rows.filter((r) => (r.source === "recurring" || r.source === "expected") && r.date <= to30);
          expect(d.upcoming.filter((r) => ownBills.includes(r)), label).toEqual(ownBills);
          expect(d.upcoming.every((r) => r.source === "recurring" || r.source === "expected"), label).toBe(true);
          if (d.reason === "payday") {
            paydays++;
            expect(d.days, label).toBeLessThanOrEqual(44);
            // the window ends the day before the pay, or is today alone when the pay is today or tomorrow
            expect(d.payday!.date === addDays(d.to, 1) || (d.days === 0 && d.payday!.date <= addDays(d.from, 1)), label).toBe(true);
          } else {
            expect(d.days, label).toBe(30);
          }
        }
      }
    }
    // the check is no check if no household had a payday
    expect(paydays).toBeGreaterThan(10);
  }, 30_000);
});
