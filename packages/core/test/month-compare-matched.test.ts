/**
 * Yhteenveto's "last month, same day" lines (Menot's and Tulos's) read one matched basis: a monthly fixed payment (a rent,
 * a loan instalment, an insurance) that one month booked by this day and the other has not is no difference between the
 * two months. The month before is counted with as many payments of each such series as this month has, in both
 * directions. The month's own totals keep every row.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import { matchPrevious } from "../src/analysis/matched-fixed.ts";
import { addMonths, monthEnd } from "../src/dates.ts";
import type { RecurringSeries } from "../src/recurring.ts";
import type { Account, IsoDate, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: "FI21 1234 5600 0007 85", currency: "EUR", type: "checking" };
const other: Account = { id: "acc-2", name: "Toinen tili", iban: null, currency: "EUR", type: "checking" };

/** One row a month on `day` from 2025-09 up to the month before `lastMonth`, and `lastMonth` too when `through` is set. */
function monthly(day: number, cents: number, partial: Partial<Transaction>, lastMonth: string, through: boolean): Transaction[] {
  const months = Array.from({ length: 14 }, (_, i) => addMonths("2025-09", i)).filter((m) => (through ? m <= lastMonth : m < lastMonth));
  return months.map((m) => tx({ ...partial, bookingDate: `${m}-${String(day).padStart(2, "0")}`, amountCents: cents }));
}

const salary = () => monthly(1, 300_000, { category: "salary", merchant: "Acme Oy" }, "2026-10", true);
const rent = (through: boolean, partial: Partial<Transaction> = {}) => monthly(2, -105_000, { category: "housing", merchant: "Sato Oyj", ...partial }, "2026-10", through);
const insurance = { category: "insurance", merchant: "Esimerkkivakuutus" };
const groceries = () => [
  tx({ bookingDate: "2026-09-05", amountCents: -10_000, merchant: "Prisma", category: "groceries" }),
  tx({ bookingDate: "2026-10-05", amountCents: -12_000, merchant: "Prisma", category: "groceries" }),
];

/**
 * A household with a salary on the 1st, a rent on the 2nd, an insurance paid monthly on the 16th and two grocery
 * purchases, one in September and one in October. The insurance of October is booked only when `booked` is set.
 */
function household(booked: boolean): Transaction[] {
  return [...salary(), ...rent(true), ...monthly(16, -35_000, insurance, "2026-10", booked), ...groceries()];
}

/** The same, with the insurance on the 18th until September and on the 15th in October: this month books it earlier. */
function earlier(): Transaction[] {
  return [...salary(), ...rent(true), ...monthly(18, -35_000, insurance, "2026-10", false), tx({ ...insurance, bookingDate: "2026-10-15", amountCents: -35_000 }), ...groceries()];
}

const october = (today: IsoDate, rows: Transaction[], accounts: Account[] = [checking]) => buildDashboard(createContext(rows, accounts, today), { from: "2026-10-01", to: today });

/** Both same-day lines of Yhteenveto: Menot's (`pace`) and Tulos's (`previousTotals`). */
const lines = (d: ReturnType<typeof october>) => ({ menot: d.pace.previous!.toToday, tulos: d.previousTotals.expenseCents });

describe("the same-day comparison of a running month", () => {
  it("leaves out a monthly payment the month before booked by this day and this month has not booked yet, in both lines", () => {
    const d = october("2026-10-16", household(false));
    // 1.–16.9.: the rent and the groceries; the insurance of the 16th is a payment this month has not booked yet
    expect(d.previousTotals.expenseCents).toBe(105_000 + 10_000);
    expect(d.previousTotals.incomeCents).toBe(300_000);
    expect(d.previousTotals.leftCents).toBe(300_000 - 105_000 - 10_000);
    expect(lines(d)).toEqual({ menot: 115_000, tulos: 115_000 });
    expect(d.categories.reduce((sum, c) => sum + c.previousCents, 0)).toBe(115_000);
  });

  it("adds the payment the month before books later when this month booked it earlier, in both lines", () => {
    const d = october("2026-10-16", earlier());
    // 1.–16.9. holds the rent and the groceries, the insurance of the 18th is the one this month booked on the 15th
    expect(lines(d)).toEqual({ menot: 150_000, tulos: 150_000 });
    expect(d.previousTotals.leftCents).toBe(300_000 - 150_000);
    expect(d.categories.reduce((sum, c) => sum + c.previousCents, 0)).toBe(150_000);
    expect(d.categories.every((c) => c.comparedCents === c.cents)).toBe(true);
    expect(d.top.rows.find((c) => c.category === "insurance")?.previousCents).toBe(35_000);
  });

  it("never changes the month's own totals, nor the whole month before", () => {
    for (const rows of [household(false), earlier()]) {
      const d = october("2026-10-16", rows);
      const paid = rows.some((t) => t.bookingDate === "2026-10-15");
      expect(d.totals.expenseCents).toBe(105_000 + 12_000 + (paid ? 35_000 : 0));
      expect(d.previousMonthTotals!.totals.expenseCents).toBe(105_000 + 35_000 + 10_000);
    }
  });

  it("counts the payment on both sides once both months have booked it", () => {
    const d = october("2026-10-17", household(true));
    expect(lines(d)).toEqual({ menot: 150_000, tulos: 150_000 });
    expect(d.totals.expenseCents).toBe(105_000 + 35_000 + 12_000);
  });

  it("counts a rent paid from another account this month as this month's payment", () => {
    // the rent of the month before came from the first account, this month's from the second, which spends in both months
    const second = Array.from({ length: 14 }, (_, i) => tx({ accountId: "acc-2", bookingDate: `${addMonths("2025-09", i)}-${String(3 + ((i * 7) % 20)).padStart(2, "0")}`, amountCents: -(1_000 + i * 137), merchant: "Lidl", category: "groceries" }));
    const rows = [...salary(), ...rent(false), tx({ accountId: "acc-2", bookingDate: "2026-10-02", amountCents: -105_000, category: "housing", merchant: "Sato Oyj" }), ...second, ...groceries()];
    const ctx = createContext(rows, [checking, other], "2026-10-16");
    expect(ctx.recurring.some((s) => s.settled?.length)).toBe(true);
    const d = buildDashboard(ctx, { from: "2026-10-01", to: "2026-10-16" });
    const sept = rows.filter((t) => t.bookingDate >= "2026-09-01" && t.bookingDate <= "2026-09-16" && t.amountCents < 0).reduce((sum, t) => sum - t.amountCents, 0);
    // every payment of September stays: the rent is one on each side
    expect(d.previousTotals.expenseCents).toBe(sept);
    expect(d.previousTotals.expenseCents).toBeGreaterThanOrEqual(105_000);
  });

  it("compares a period that is over as it is", () => {
    const ended = buildDashboard(createContext(household(false), [checking], "2026-11-20"), { from: "2026-10-01", to: "2026-10-31" });
    expect(ended.running).toBe(false);
    expect(ended.previousTotals.expenseCents).toBe(105_000 + 35_000 + 10_000);
  });

  it("compares a running range that is no month as it is", () => {
    // 1.9.–16.10. against 1.7.–16.8.: a series that has a payment more in one is a real difference there
    const d = buildDashboard(createContext(household(false), [checking], "2026-10-16"), { from: "2026-09-01", to: "2026-10-16" });
    expect(d.running).toBe(true);
    expect(d.previousTotals.expenseCents).toBe(2 * 105_000 + 2 * 35_000);
  });
});

/**
 * A salary on the 1st and a rent on the last day of each month through `lastMonth`, a grocery purchase on the 5th of
 * `lastMonth` and of the month of `today`, which has not booked its rent.
 */
function monthEndHousehold(today: IsoDate, lastMonth: string): Transaction[] {
  const months = Array.from({ length: 24 }, (_, i) => addMonths("2025-09", i));
  return [
    ...months.filter((m) => m <= today.slice(0, 7)).map((m) => tx({ bookingDate: `${m}-01`, amountCents: 300_000, category: "salary", merchant: "Acme Oy" })),
    ...months.filter((m) => m <= lastMonth).map((m) => tx({ bookingDate: monthEnd(m), amountCents: -105_000, category: "housing", merchant: "Sato Oyj" })),
    tx({ bookingDate: `${lastMonth}-05`, amountCents: -10_000, merchant: "Prisma", category: "groceries" }),
    tx({ bookingDate: `${today.slice(0, 7)}-05`, amountCents: -12_000, merchant: "Prisma", category: "groceries" }),
  ];
}

const daysOf = (month: string): number => Number(monthEnd(month).slice(8));

describe("the last days of a month", () => {
  it.each([
    ["2026-04-30", "2026-03"],
    ["2027-02-28", "2027-01"],
  ] as const)("on %s a rent the month before booked on its last day is the payment this month has not booked, and is left out of both lines", (today, lastMonth) => {
    const d = buildDashboard(createContext(monthEndHousehold(today, lastMonth), [checking], today), { from: `${today.slice(0, 7)}-01`, to: today });
    expect(d.pace.previous!.day).toBe(daysOf(lastMonth));
    expect(d.range.previousFrom).toBe(`${lastMonth}-01`);
    expect(lines(d)).toEqual({ menot: 10_000, tulos: 10_000 });
  });

  it.each([
    ["2026-04-30", "2026-03"],
    ["2027-02-28", "2027-01"],
    ["2026-05-31", "2026-04"],
  ] as const)("on %s a purchase of the month before's last day is in Menot and in Tulos, which read all of the month before", (today, lastMonth) => {
    const rows = [...monthEndHousehold(today, lastMonth), tx({ bookingDate: monthEnd(lastMonth), amountCents: -4_000, merchant: "Prisma", category: "groceries" })];
    const d = buildDashboard(createContext(rows, [checking], today), { from: `${today.slice(0, 7)}-01`, to: today });
    expect(d.pace.previous).toMatchObject({ month: lastMonth, day: daysOf(lastMonth) });
    expect(d.range.previousFrom).toBe(`${lastMonth}-01`);
    expect(lines(d)).toEqual({ menot: 14_000, tulos: 14_000 });
  });

  it("reads a month before that is shorter than today's day whole, with its last payment, in both lines", () => {
    // 31.10. against September: its rent on the 30th is part of the whole month the line says it shows
    const d = buildDashboard(createContext(monthEndHousehold("2026-10-31", "2026-09"), [checking], "2026-10-31"), { from: "2026-10-01", to: "2026-10-31" });
    expect(d.pace.previous!.day).toBe(30);
    expect(lines(d)).toEqual({ menot: 115_000, tulos: 115_000 });
    expect(d.previousMonthTotals!.totals.expenseCents).toBe(115_000);
  });
});

describe("matchPrevious", () => {
  const rows = createContext(household(true), [checking], "2026-10-16").txs;
  const ofSeries = rows.filter((t) => t.merchant === "Esimerkkivakuutus");
  const septEarly = rows.filter((t) => t.bookingDate >= "2026-09-01" && t.bookingDate <= "2026-09-15");
  const septLate = rows.filter((t) => t.bookingDate >= "2026-09-16" && t.bookingDate <= "2026-09-30");
  const septSame = rows.filter((t) => t.bookingDate >= "2026-09-01" && t.bookingDate <= "2026-09-16");
  const octRows = rows.filter((t) => t.bookingDate >= "2026-10-01" && t.bookingDate <= "2026-10-16");
  const octEarly = octRows.filter((t) => t.bookingDate <= "2026-10-15");
  const idOf = (month: string) => ofSeries.find((t) => t.bookingDate.startsWith(month))!.id;
  const series = (partial: Partial<RecurringSeries> = {}) => ({ cadence: "monthly", kind: "subscription", active: true, category: "insurance", merchant: "Esimerkkivakuutus", transactionIds: ofSeries.map((t) => t.id), ...partial }) as RecurringSeries;

  it("drops the month before's payment that this month lacks", () => {
    const out = matchPrevious([series()], new Set(), octEarly, septSame, septLate);
    expect([...out.dropped]).toEqual([idOf("2026-09")]);
    expect(out.added.size).toBe(0);
  });

  it("adds the month before's later payment when this month has one more", () => {
    const out = matchPrevious([series()], new Set(), octRows, septEarly, septLate);
    expect([...out.added]).toEqual([idOf("2026-09")]);
    expect(out.dropped.size).toBe(0);
  });

  it("counts a payment that settled an occurrence from elsewhere as the series' own", () => {
    const own = ofSeries.filter((t) => !t.bookingDate.startsWith("2026-10")).map((t) => t.id);
    const paid = series({ transactionIds: own, settled: [{ due: "2026-10-16", paidOn: "2026-10-16", id: idOf("2026-10"), pending: false }] });
    expect(matchPrevious([paid], new Set(), octRows, septSame, septLate)).toEqual({ dropped: new Set(), added: new Set() });
    expect([...matchPrevious([series({ transactionIds: own })], new Set(), octRows, septSame, septLate).dropped]).toEqual([idOf("2026-09")]);
  });

  it("leaves out the latest of two payments in the month before and adds the earliest of two it books later", () => {
    const all = createContext(
      ["2026-09-02", "2026-09-09", "2026-09-20", "2026-09-25", "2026-10-03", "2026-10-10"].map((bookingDate) => tx({ bookingDate, amountCents: -35_000, ...insurance })),
      [checking],
      "2026-10-16",
    ).txs;
    const at = (...dates: string[]) => dates.map((date) => all.find((t) => t.bookingDate === date)!);
    const own = series({ transactionIds: all.map((t) => t.id) });
    // one payment this month, two in the month before by this day: the later one goes, whichever order the rows come in
    const dropped = matchPrevious([own], new Set(), at("2026-10-03"), at("2026-09-09", "2026-09-02"), []);
    expect([...dropped.dropped]).toEqual([at("2026-09-09")[0]!.id]);
    expect(dropped.added.size).toBe(0);
    // two payments this month, one in the month before by this day: the earlier of its two later ones comes in
    const added = matchPrevious([own], new Set(), at("2026-10-03", "2026-10-10"), at("2026-09-02"), at("2026-09-25", "2026-09-20"));
    expect([...added.added]).toEqual([at("2026-09-20")[0]!.id]);
    expect(added.dropped.size).toBe(0);
  });

  it("changes nothing when both months have the payment, nor for a series that is no monthly fixed cost", () => {
    const none = { dropped: new Set(), added: new Set() };
    expect(matchPrevious([series()], new Set(), octRows, septSame, septLate)).toEqual(none);
    expect(matchPrevious([series({ cadence: "weekly" as never })], new Set(), octEarly, septSame, septLate)).toEqual(none);
    expect(matchPrevious([series({ kind: "habit" })], new Set(), octEarly, septSame, septLate)).toEqual(none);
    expect(matchPrevious([series({ active: false })], new Set(), octEarly, septSame, septLate)).toEqual(none);
    expect(matchPrevious([series()], new Set(["Esimerkkivakuutus"]), octEarly, septSame, septLate)).toEqual(none);
  });
});
