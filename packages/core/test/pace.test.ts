import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import { monthPace } from "../src/analysis/forecast.ts";
import type { Account, IsoDate, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

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
    // nothing of the old usual curve is left
    expect(Object.keys(pace).sort()).toEqual(["current", "currentTotal", "daysInMonth", "month", "previous"]);
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
    const sept = [buy("2026-09-15", 3_000), buy("2026-09-30", 9_000), buy("2026-10-29", 100)];
    const at = (day: IsoDate) => paceOf(sept, "2026-10", day).previous!;
    expect(at("2026-10-31")).toMatchObject({ day: 30, toToday: 12_000 });
    expect(at("2026-10-30")).toMatchObject({ day: 30, toToday: 12_000 });
    expect(at("2026-10-29")).toMatchObject({ day: 29, toToday: 3_000 });
    // February of 2027 has 28 days
    const feb = [buy("2027-02-14", 1_000), buy("2027-02-28", 5_000)];
    const march = paceOf(feb, "2027-03", "2027-03-31");
    expect(march.previous).toMatchObject({ month: "2027-02", day: 28, toToday: 6_000 });
    expect(march.previous!.curve).toHaveLength(28);
  });

  it("takes December of the year before for a January", () => {
    const dec = [buy("2026-12-05", 4_000), buy("2026-12-20", 9_000), buy("2027-01-04", 1_000)];
    expect(paceOf(dec, "2027-01", "2027-01-12").previous).toMatchObject({ month: "2026-12", day: 12, toToday: 4_000 });
    expect(paceOf(dec, "2027-01", "2027-01-31").previous).toMatchObject({ month: "2026-12", day: 31, toToday: 13_000 });
  });

  it("leaves the month before out when the history has no row in it, and keeps it for a row that is no spending", () => {
    // the history starts in October
    expect(paceOf([buy("2026-10-03", 4_000)], "2026-10", today).previous).toBeNull();
    // August and October have rows, September has none: nothing to set October against
    expect(paceOf([buy("2026-08-03", 8_000), buy("2026-10-03", 4_000)], "2026-10", today).previous).toBeNull();
    // a month of pay alone is a month the history reaches: it cost nothing so far
    const paid = paceOf([pay("2026-09-05"), buy("2026-10-03", 4_000)], "2026-10", today);
    expect(paid.previous).toMatchObject({ month: "2026-09", day: 12, toToday: 0 });
    expect(paid.previous!.curve.every((v) => v === 0)).toBe(true);
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
    const ended = paceOf([buy("2026-08-30", 500), buy("2026-08-31", 200), ...rows], "2026-09", today);
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
