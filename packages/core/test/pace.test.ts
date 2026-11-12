import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import { monthPace } from "../src/analysis/forecast.ts";
import type { Account, IsoDate, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";
import { LATE_CARD_TODAY, lateCardContext } from "./late-card-household.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: "FI21 1234 5600 0007 85", currency: "EUR", type: "checking" };

/** A grocery purchase of `cents` on `date`. */
const buy = (date: IsoDate, cents: number) => tx({ bookingDate: date, amountCents: -cents, merchant: "Prisma", category: "groceries" });
/** Pay of 3 000 € on `date`: money in, no spending. */
const pay = (date: IsoDate) => tx({ bookingDate: date, amountCents: 300_000, merchant: "Acme Oy", category: "salary" });
const paceOf = (rows: Transaction[], month: string, today: IsoDate) => monthPace(createContext(rows, [checking], today), month, today);

describe("pace: the month against the month before", () => {
  const today = "2026-10-12";
  // September: 100 € on the 2nd, 50 € on the 12th, 7 € on the 13th and 10 € on the 30th; October: 40 € on the 3rd, 60 € on the 12th
  const rows = [buy("2026-09-02", 10_000), buy("2026-09-12", 5_000), buy("2026-09-13", 700), buy("2026-09-30", 1_000), buy("2026-10-03", 4_000), buy("2026-10-12", 6_000)];

  it("holds the sums of the rows of this month and of the month before, by day", () => {
    const pace = paceOf(rows, "2026-10", today);
    expect(pace.month).toBe("2026-10");
    expect(pace.current).toHaveLength(31);
    expect(pace.current.slice(0, 4)).toEqual([0, 0, 4_000, 4_000]);
    expect(pace.current[11]).toBe(10_000);
    expect(pace.current[12]).toBeNull();
    // the figure on the card is the last point of the curve
    expect(pace.currentTotal).toBe(pace.current.filter((v) => v !== null).at(-1));
    expect(pace.currentTotal).toBe(10_000);
    expect(pace.previous).toMatchObject({ month: "2026-09", day: 12, toToday: 15_000 });
    expect(pace.previous!.curve).toHaveLength(30);
    // the 13th is after today's day of the month, the 30th ends the curve at the whole month
    expect(pace.previous!.curve[11]).toBe(15_000);
    expect(pace.previous!.curve[12]).toBe(15_700);
    expect(pace.previous!.curve[29]).toBe(16_700);
    // under three complete months there is no expected month and so no projection
    expect(Object.keys(pace).sort()).toEqual(["cardGap", "current", "currentTotal", "daysInMonth", "expected", "month", "payDays", "previous", "projection"]);
    expect(pace.expected).toBeNull();
    expect(pace.projection).toBeNull();
  });

  it("counts spending only: money in is none, a refund takes back what it returns", () => {
    const pace = paceOf(
      [
        buy("2026-09-02", 10_000),
        pay("2026-09-05"),
        // a refund of 40 € to the shop that took the 100 €
        tx({ bookingDate: "2026-09-08", amountCents: 4_000, merchant: "Prisma", category: "groceries" }),
        buy("2026-10-01", 2_000),
        pay("2026-10-05"),
        tx({ bookingDate: "2026-10-09", amountCents: 500, merchant: "Prisma", category: "groceries" }),
      ],
      "2026-10",
      today,
    );
    expect(pace.previous!.toToday).toBe(6_000);
    expect(pace.current[4]).toBe(2_000);
    expect(pace.currentTotal).toBe(1_500);
  });

  it("reads a month before that is shorter than today's day to its last day", () => {
    // September has 30 days: the 31st of October meets its 30th, the 30th too, the 29th does not reach the 30th
    const sept = [pay("2026-09-01"), buy("2026-09-15", 3_000), buy("2026-09-30", 9_000), buy("2026-10-29", 100)];
    const at = (day: IsoDate) => paceOf(sept, "2026-10", day).previous!;
    expect(at("2026-10-31")).toMatchObject({ day: 30, toToday: 12_000 });
    expect(at("2026-10-30")).toMatchObject({ day: 30, toToday: 12_000 });
    expect(at("2026-10-29")).toMatchObject({ day: 29, toToday: 3_000 });
    // February of 2027 has 28 days
    const feb = [pay("2027-02-01"), buy("2027-02-14", 1_000), buy("2027-02-28", 5_000)];
    const march = paceOf(feb, "2027-03", "2027-03-31");
    expect(march.previous).toMatchObject({ month: "2027-02", day: 28, toToday: 6_000 });
    expect(march.previous!.curve).toHaveLength(28);
  });

  it("takes December of the year before for a January", () => {
    const dec = [pay("2026-12-01"), buy("2026-12-05", 4_000), buy("2026-12-20", 9_000), buy("2027-01-04", 1_000)];
    expect(paceOf(dec, "2027-01", "2027-01-12").previous).toMatchObject({ month: "2026-12", day: 12, toToday: 4_000 });
    expect(paceOf(dec, "2027-01", "2027-01-31").previous).toMatchObject({ month: "2026-12", day: 31, toToday: 13_000 });
  });

  it("leaves the month before out when the history has no row in it, and keeps it for a row that is no spending", () => {
    // the history starts in October
    expect(paceOf([buy("2026-10-03", 4_000)], "2026-10", today).previous).toBeNull();
    // August and October have rows, September has none: nothing to set October against
    expect(paceOf([buy("2026-08-03", 8_000), buy("2026-10-03", 4_000)], "2026-10", today).previous).toBeNull();
    // a month of pay alone is a month the history reaches: it cost nothing so far
    const paid = paceOf([pay("2026-09-01"), buy("2026-10-03", 4_000)], "2026-10", today);
    expect(paid.previous).toMatchObject({ month: "2026-09", day: 12, toToday: 0 });
    expect(paid.previous!.curve.every((v) => v === 0)).toBe(true);
  });

  // the sentence and the line of Yhteenveto set last month against this one: a curve of other accounts said what the data does not hold
  it("leaves the month before out when it was not on the same accounts as this month", () => {
    // the history begins on the 20th of September: its first days hold nothing because nothing was read, not because nothing was spent
    expect(paceOf([buy("2026-09-20", 5_000), buy("2026-10-03", 4_000)], "2026-10", today).previous).toBeNull();
    // a card linked in October: its purchases are in October's curve and September holds only what checking paid
    const card: Account = { id: "card", name: "Kortti", iban: null, currency: "EUR", type: "credit_card" };
    const linked = [pay("2026-09-01"), buy("2026-09-14", 52_000), pay("2026-10-01"), tx({ accountId: "card", bookingDate: "2026-10-03", amountCents: -40_000, merchant: "K-Market", category: "groceries" })];
    expect(monthPace(createContext(linked, [checking, card], today), "2026-10", today).previous).toBeNull();
    const late = lateCardContext("2026-10");
    expect(monthPace(late, "2026-10", LATE_CARD_TODAY).previous).toBeNull();
    // the card's history reaching September as well: the month before is there again
    const both = lateCardContext("2026-07");
    expect(monthPace(both, "2026-10", LATE_CARD_TODAY).previous).toMatchObject({ month: "2026-09", day: 9 });
  });

  // a card never linked: its bill holds a month of purchases on one day, booked on the 15th in September and the 16th in October
  it("leaves the month before out when either month paid a card bill for purchases the rows do not hold", () => {
    const bill = (date: IsoDate) => tx({ accountId: "acc-1", bookingDate: date, amountCents: -80_000, merchant: "Korttiyhtiö", category: "card_bill" });
    const billed = [pay("2026-09-01"), buy("2026-09-05", 10_000), bill("2026-09-15"), buy("2026-10-05", 10_000), bill("2026-10-16")];
    expect(paceOf(billed, "2026-10", "2026-10-15").previous).toBeNull();
    // near miss: the same months with no card bill are set against each other
    expect(paceOf(billed.filter((t) => t.category !== "card_bill"), "2026-10", "2026-10-15").previous).toMatchObject({ toToday: 10_000 });
  });

  // the curves are of spending: an account that only received money in the months changes neither
  it("keeps the month before when an account that began in between only received money", () => {
    const savings: Account = { id: "sav", name: "Säästötili", iban: null, currency: "EUR", type: "savings" };
    const rows = [pay("2026-09-01"), buy("2026-09-05", 10_000), buy("2026-10-05", 10_000), tx({ accountId: "sav", bookingDate: "2026-10-06", amountCents: 50_000, merchant: "Kela", category: "benefits" })];
    expect(monthPace(createContext(rows, [checking, savings], today), "2026-10", today).previous).toMatchObject({ month: "2026-09", toToday: 10_000 });
    // near miss: the same account spending is in October's curve alone
    const spent = [...rows, tx({ accountId: "sav", bookingDate: "2026-10-07", amountCents: -20_000, merchant: "Kauppa", category: "groceries" })];
    expect(monthPace(createContext(spent, [checking, savings], today), "2026-10", today).previous).toBeNull();
  });

  it("starts on the first day of a month with that day's spending against the month before's first day", () => {
    const oct = [buy("2026-10-01", 3_000), buy("2026-10-15", 2_000)];
    const first = paceOf([...oct, buy("2026-11-01", 1_000)], "2026-11", "2026-11-01");
    expect(first.current[0]).toBe(1_000);
    expect(first.current.slice(1).every((v) => v === null)).toBe(true);
    expect(first.currentTotal).toBe(1_000);
    expect(first.previous).toMatchObject({ month: "2026-10", day: 1, toToday: 3_000 });
    // nothing spent yet: the figure is nothing and the month before is still there to compare with
    expect(paceOf(oct, "2026-11", "2026-11-01")).toMatchObject({ currentTotal: 0, previous: { day: 1, toToday: 3_000 } });
  });

  it("is whole for a month that has ended and empty for one that has not begun", () => {
    const ended = paceOf([pay("2026-08-01"), buy("2026-08-30", 500), buy("2026-08-31", 200), ...rows], "2026-09", today);
    expect(ended.current.every((v) => v !== null)).toBe(true);
    expect(ended.currentTotal).toBe(16_700);
    // August has 31 days and September 30: the whole of September meets August's 30th, and August's curve goes on to the 31st
    expect(ended.previous).toMatchObject({ month: "2026-08", day: 30, toToday: 500 });
    expect(ended.previous!.curve.at(-1)).toBe(700);
    const ahead = paceOf(rows, "2026-11", today);
    expect(ahead.current.every((v) => v === null)).toBe(true);
    expect(ahead).toMatchObject({ currentTotal: 0, previous: { month: "2026-10", day: 0, toToday: 0 } });
  });
});

describe("pace: in the dashboard", () => {
  const today = "2026-10-12";
  const rows = [buy("2026-09-02", 10_000), buy("2026-09-12", 5_000), buy("2026-10-03", 4_000), buy("2026-10-12", 6_000), pay("2026-10-05")];
  const ctx = createContext(rows, [checking], today);

  it("is the running month's whatever period is on the page, and its figure is the sum of the rows so far", () => {
    const sofar = ctx.txs.filter((t) => t.bookingDate >= "2026-10-01" && t.bookingDate <= today).reduce((sum, t) => sum + t.spend, 0);
    expect(sofar).toBe(10_000);
    for (const to of ["2026-10-31", "2026-12-31"]) {
      const d = buildDashboard(ctx, { from: "2026-01-01", to });
      expect(d.pace).toMatchObject({ month: "2026-10", currentTotal: sofar, previous: { month: "2026-09", day: 12, toToday: 15_000 } });
    }
    // nothing is forecast on the answer
    expect("forecast" in buildDashboard(ctx, { from: "2026-10-01", to: "2026-10-31" })).toBe(false);
  });

  it("is the month the period ends in when it does not reach today", () => {
    const d = buildDashboard(ctx, { from: "2026-09-01", to: "2026-09-30" });
    expect(d.running).toBe(false);
    expect(d.pace).toMatchObject({ month: "2026-09", currentTotal: 15_000, previous: null });
  });
});

describe("pace: the usual month and the rest of this one", () => {
  const today = "2026-10-10";
  // five complete months (the history starts on 30 April), each with pay on the 1st, 100 € on the 5th and a sum on the 20th of 100, 150, 200, 250 and 300 € (none is a one-off, which the expected figure leaves out)
  const months = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
  const history = [pay("2026-04-30"), ...months.flatMap((m, i) => [pay(`${m}-01`), buy(`${m}-05`, 10_000), buy(`${m}-20`, (i + 2) * 5_000)])];
  const rows = [...history, pay("2026-10-01"), buy("2026-10-05", 15_000)];

  it("is the mean of the complete months on each day, with their quartiles as the band", () => {
    const { expected: usual } = paceOf(rows, "2026-10", today);
    expect(usual!.months).toBe(5);
    expect(usual!.curve).toHaveLength(31);
    expect(usual!.curve[3]).toBe(0);
    expect(usual!.curve[4]).toBe(10_000);
    // on the 20th: 100 € and the mean of 100 to 300 €, the quartiles of the five months around it
    expect(usual!.curve[19]).toBe(30_000);
    expect([usual!.low[19], usual!.high[19]]).toEqual([25_000, 35_000]);
    // today, the 10th: 150 € spent against the usual 100 €
    expect(usual!.toToday).toBe(10_000);
    expect(usual!.diffCents).toBe(5_000);
  });

  it("projects the rest of the month from today's total by what the quartile months added after the same day", () => {
    const { projection } = paceOf(rows, "2026-10", today);
    expect(projection!.fromDay).toBe(10);
    expect(projection!.low).toHaveLength(22);
    expect([projection!.low[0], projection!.high[0]]).toEqual([15_000, 15_000]);
    expect([projection!.low.at(-1), projection!.high.at(-1)]).toEqual([15_000 + 15_000, 15_000 + 25_000]);
  });

  it("has no projection for a month that has ended", () => {
    const pace = paceOf(rows, "2026-09", today);
    expect(pace.projection).toBeNull();
    expect(pace.expected).not.toBeNull();
  });

  it("marks the pay day", () => {
    expect(paceOf(rows, "2026-10", today).payDays).toEqual([1]);
  });
});

describe("dashboard: the whole month before", () => {
  // September: pay 3 000 € on the 1st, 100 € on the 5th, 500 € on the 25th; October: 40 € on the 3rd; today the 18th
  const rows = [pay("2026-08-31"), pay("2026-09-01"), buy("2026-09-05", 10_000), buy("2026-09-25", 50_000), buy("2026-10-03", 4_000)];
  const today = "2026-10-18";

  it("on the 18th holds every day of September, where previousTotals is cut to the 18th", () => {
    const d = buildDashboard(createContext(rows, [checking], today), { from: "2026-10-01", to: "2026-10-31" });
    expect(d.previousTotals.expenseCents).toBe(10_000);
    expect(d.previousMonthTotals!.month).toBe("2026-09");
    expect(d.previousMonthTotals!.totals.expenseCents).toBe(60_000);
    expect(d.previousMonthTotals!.totals.leftCents).toBe(300_000 - 60_000);
  });

  it("is the month before the range's own month when the range has ended, and null when that month has no rows", () => {
    const ctx = createContext(rows, [checking], today);
    expect(buildDashboard(ctx, { from: "2026-09-01", to: "2026-09-30" }).previousMonthTotals!.month).toBe("2026-08");
    expect(buildDashboard(ctx, { from: "2026-08-01", to: "2026-08-31" }).previousMonthTotals).toBeNull();
  });
});
