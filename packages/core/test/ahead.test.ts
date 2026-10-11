import { describe, expect, it } from "vitest";
import { cashAhead } from "../src/analysis/ahead.ts";
import { createContext } from "../src/analysis/context.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import { monthForecast, monthPace } from "../src/analysis/forecast.ts";
import { addDays, weekdayOf } from "../src/dates.ts";
import { type Account, type BalanceInput, type ExpectedBill, type IsoDate, NO_INPUTS, type Transaction, type UserInputs } from "../src/types.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: "FI21 1234 5600 0007 85", currency: "EUR", type: "checking" };
const today = "2026-10-09";

describe("pace: the usual curve", () => {
  // one purchase on the 2nd of each month; February and March fall outside the six months before October
  const amounts = [900_000, 800_000, 1000, 2000, 3000, 4000, 5000, 9000];
  const months = ["2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
  const rows = (from: number) => months.slice(from).map((m, i) => tx({ bookingDate: `${m}-02`, amountCents: -amounts[from + i]!, merchant: `Shop ${m}` }));

  it("is the per-day median of the last six complete months, not their mean", () => {
    const ctx = createContext([...rows(0), tx({ bookingDate: "2026-10-03", amountCents: -4000, merchant: "Shop October" })], [checking], today);
    const pace = monthPace(ctx, "2026-10", today);
    expect(pace.usual![0]).toBe(0);
    // median of 1000, 2000, 3000, 4000, 5000, 9000
    expect(pace.usual![1]).toBe(3500);
    expect(pace.usualAtToday).toBe(3500);
    expect(pace.usualMonthTotal).toBe(3500);
    expect(pace.usual).toHaveLength(31);
    expect(pace.currentTotal).toBe(4000);
    expect(pace.current[8]).toBe(4000);
    expect(pace.current[9]).toBeNull();
  });

  it("is missing under three complete months, and a month ahead counts back from the running one", () => {
    const two = createContext(rows(6), [checking], today);
    const pace = monthPace(two, "2026-10", today);
    expect(pace).toMatchObject({ usual: null, usualAtToday: null, usualMonthTotal: null });
    const six = createContext(rows(0), [checking], today);
    expect(monthPace(six, "2026-11", today).usual![1]).toBe(3500);
  });
});

/**
 * A household with no surprises: 30 € of groceries every day, rent on the 2nd, Spotify on the 11th, salary on the
 * 25th (the Friday before at a weekend), and one purchase on the 20th that cycles through 30, 50 and 70 euros. Rows from `from` to `to`.
 */
function steady(from: IsoDate, to: IsoDate): Transaction[] {
  const rows: Transaction[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const month = d.slice(0, 7);
    const day = Number(d.slice(8, 10));
    rows.push(tx({ bookingDate: d, amountCents: -3000, merchant: "Prisma", category: "groceries" }));
    if (day === 2) rows.push(tx({ bookingDate: d, amountCents: -95000, merchant: "Sato", category: "housing" }));
    if (day === 11) rows.push(tx({ bookingDate: d, amountCents: -1199, merchant: "Spotify", category: "subscriptions" }));
    // salary on the 25th, paid on the Friday before when the 25th is a weekend
    const weekday = weekdayOf(`${month}-25`);
    if (d === addDays(`${month}-25`, weekday >= 5 ? 4 - weekday : 0)) rows.push(tx({ bookingDate: d, amountCents: 300000, merchant: "Acme Oy", category: "salary" }));
    if (day === 20) {
      const n = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7));
      rows.push(tx({ bookingDate: d, amountCents: -[3000, 5000, 7000][n % 3]!, merchant: `Extra ${month}`, category: "other" }));
    }
  }
  return rows;
}
const upTo = (rows: Transaction[], day: IsoDate) => rows.filter((t) => t.bookingDate <= day);
const spendOf = (rows: Transaction[], month: string) => rows.filter((t) => t.bookingDate.startsWith(month) && t.amountCents < 0).reduce((sum, t) => sum - t.amountCents, 0);

describe("forecast range", () => {
  const all = steady("2025-09-01", "2026-10-31");

  it("a steady history's range holds the actual total", () => {
    const ctx = createContext(upTo(all, today), [checking], today);
    const f = monthForecast(ctx);
    const actual = spendOf(all, "2026-10");
    expect(f).toMatchObject({ rangeBasis: "own", rangeMonths: 6 });
    expect(f.rangePercent).toBeGreaterThan(0);
    expect(f.lowCents).toBeLessThanOrEqual(actual);
    expect(f.highCents).toBeGreaterThanOrEqual(actual);
    expect(f.lowCents).toBeLessThan(f.forecastCents);
    expect(f.highCents).toBeGreaterThan(f.forecastCents);
  });

  it("a forecast that was exact in every past month gives a range with no width", () => {
    // 30 euros a day and no surprises: the forecast is exact, so the range closes to the forecast
    const flat = all.filter((t) => !t.merchant.startsWith("Extra"));
    const f = monthForecast(createContext(upTo(flat, today), [checking], today));
    expect(f).toMatchObject({ rangeBasis: "own", rangePercent: 0, lowCents: f.forecastCents, highCents: f.forecastCents });
    expect(f.forecastCents).toBe(spendOf(flat, "2026-10"));
  });

  it("past months are compared by days left, so the last day of a short month meets the last day of the others", () => {
    // 28.2.2027 is the last day of February: on the last day of every month the forecast is the actual total
    const feb = "2027-02-28";
    const long = steady("2025-09-01", feb);
    const f = monthForecast(createContext(long, [checking], feb));
    expect(f).toMatchObject({ rangeBasis: "own", rangeMonths: 6, rangePercent: 0 });
    expect(f.lowCents).toBe(f.highCents);
  });

  it("the table applies under three months and gives its figure for the day", () => {
    const short = steady("2026-08-01", "2026-10-31");
    const at = (day: IsoDate) => monthForecast(createContext(upTo(short, day), [checking], day));
    expect(at("2026-10-05")).toMatchObject({ rangeBasis: "table", rangeMonths: 0, rangePercent: 8 });
    expect(at("2026-10-09").rangePercent).toBe(6.4);
    expect(at("2026-10-10").rangePercent).toBe(6);
    expect(at("2026-10-20").rangePercent).toBe(2.5);
    const last = at("2026-10-31");
    expect(last).toMatchObject({ rangePercent: 0, lowCents: last.forecastCents, highCents: last.forecastCents });
    const day = at("2026-10-09");
    expect(day.highCents).toBe(Math.round(day.forecastCents * 1.064));
    expect(day.lowCents).toBe(Math.round(day.forecastCents * 0.936));
  });

  it("a month ago the history was too short to grade, so the first months are skipped, not the range", () => {
    // four complete months: July has no complete month before it and is left out, three remain
    const four = steady("2026-06-01", "2026-10-31");
    expect(monthForecast(createContext(upTo(four, today), [checking], today))).toMatchObject({ rangeBasis: "own", rangeMonths: 3 });
    const three = steady("2026-07-01", "2026-10-31");
    expect(monthForecast(createContext(upTo(three, today), [checking], today))).toMatchObject({ rangeBasis: "table" });
  });
});

describe("no forecast before a complete month", () => {
  const all = steady("2026-09-15", "2026-11-30");

  it("a first run with one partial month waits for the first complete month and says when it comes", () => {
    // from 15 September: September is not complete, October will be on 1 November
    const f = monthForecast(createContext(upTo(all, today), [checking], today));
    expect(f.pendingUntil).toBe("2026-11-01");
    expect(f.usualLeftCents).toBe(0);
    // October is complete on 1 November, so November has a forecast
    expect(monthForecast(createContext(upTo(all, "2026-11-09"), [checking], "2026-11-09")).pendingUntil).toBeNull();
  });

  it("a history from the 1st of last month has its forecast now", () => {
    expect(monthForecast(createContext(upTo(steady("2026-09-01", "2026-10-31"), today), [checking], today)).pendingUntil).toBeNull();
    // from the 1st of this month: the forecast comes when this month has ended
    expect(monthForecast(createContext(upTo(steady("2026-10-01", "2026-10-31"), today), [checking], today)).pendingUntil).toBe("2026-11-01");
  });
});

describe("cash ahead", () => {
  const all = steady("2025-09-01", "2026-10-31");
  const ctx = createContext(upTo(all, today), [checking], today);
  const balance = (balanceCents: number | null, extra: Partial<BalanceInput> = {}): BalanceInput => ({
    id: "acc-1",
    name: "Käyttötili",
    type: "checking",
    balanceCents,
    ownerName: null,
    balanceAt: "2026-10-09T06:00:00Z",
    ...extra,
  });
  const inputs = (partial: Partial<UserInputs>): UserInputs => ({ ...NO_INPUTS, ...partial });
  const bill = (partial: Partial<ExpectedBill>): ExpectedBill => ({ id: "b1", name: "Autovakuutus", amountCents: 41_000, dueDate: "2026-10-20", cadence: "once", category: "insurance", ...partial });
  const sum = (rows: { cents: number }[]) => rows.reduce((s, r) => s + r.cents, 0);

  it("the last day's balance is the start plus the rows minus the everyday spending", () => {
    const d = cashAhead(ctx, [balance(200_000)], NO_INPUTS);
    const b = d.balance!;
    expect([d.from, d.to]).toEqual(["2026-10-09", "2026-11-08"]);
    expect(b.days).toHaveLength(31);
    // nothing is booked on the day itself and its everyday spending is already in the balance
    expect(b.days[0]).toEqual({ date: today, cents: 200_000 });
    expect(b.days[30]!.cents).toBe(200_000 + sum(d.rows) - d.everydayCents);
    // 30 euros a day plus a purchase of 30 to 70 euros a month
    expect(d.everydayPerDayCents).toBeGreaterThanOrEqual(3000);
    expect(d.everydayPerDayCents).toBeLessThan(3300);
    expect(d.rows.map((r) => [r.date, r.name, r.cents])).toEqual([
      ["2026-10-11", "Spotify", -1199],
      ["2026-10-23", "Acme Oy", 300_000],
      ["2026-11-02", "Sato", -95_000],
    ]);
  });

  it("a salary lands on its usual day, the Friday before at a weekend, and the lowest point is the day before it", () => {
    const d = cashAhead(ctx, [balance(200_000)], NO_INPUTS);
    // the 25th of October 2026 is a Sunday
    expect(d.rows.find((r) => r.source === "income")).toMatchObject({ date: "2026-10-23", name: "Acme Oy", cents: 300_000 });
    const days = d.balance!.days;
    expect(days.find((x) => x.date === "2026-10-23")!.cents).toBeGreaterThan(days.find((x) => x.date === "2026-10-22")!.cents + 250_000);
    expect(d.balance!.lowest.date).toBe("2026-10-22");
    expect(d.balance!.lowest.cents).toBe(Math.min(...days.map((x) => x.cents)));
  });

  it("a salary follows the usual day of the month, not the day of the last one", () => {
    // paid on Friday 24.7. because the 25th was a Saturday; the next one is on Tuesday 25.8., not on the 24th
    const day = "2026-08-11";
    const early = createContext(upTo(all, day), [checking], day);
    expect(cashAhead(early, [], NO_INPUTS).rows.find((r) => r.source === "income")).toMatchObject({ date: "2026-08-25" });
    // 25.9. is a Friday, 25.11. a Wednesday; the 25th of a month with no weekend problem stays
    const later = createContext(upTo(all, "2026-09-11"), [checking], "2026-09-11");
    expect(cashAhead(later, [], NO_INPUTS).rows.find((r) => r.source === "income")).toMatchObject({ date: "2026-09-25" });
  });

  it("a cancelled subscription is not expected", () => {
    const cancelled = inputs({ marks: [{ subject: "merchant:Spotify", mark: "cancelled", markedAt: "2026-10-08T10:00:00Z" }] });
    const d = cashAhead(ctx, [balance(200_000)], cancelled);
    expect(d.rows.map((r) => r.name)).toEqual(["Acme Oy", "Sato"]);
    expect(d.balance!.days[30]!.cents).toBe(cashAhead(ctx, [balance(200_000)], NO_INPUTS).balance!.days[30]!.cents + 1199);
    // an in-use mark changes nothing, and the month forecast leaves the cancelled one out too
    expect(cashAhead(ctx, [balance(200_000)], inputs({ marks: [{ subject: "merchant:Spotify", mark: "in_use", markedAt: "2026-10-08T10:00:00Z" }] })).rows).toHaveLength(3);
    expect(buildDashboard(ctx, { from: "2026-10-01", to: today }, [], cancelled).forecast!.billsLeftCents).toBe(monthForecast(ctx).billsLeftCents - 1199);
  });

  it("an expected bill shows on its date, a yearly one comes back, and one the history already knows is not counted twice", () => {
    const typed = inputs({
      expectedBills: [
        bill({}),
        bill({ id: "b2", name: "Auton vero", amountCents: 9500, dueDate: "2024-11-03", cadence: "yearly", category: "taxes" }),
        bill({ id: "b3", name: "Joulu", amountCents: 5000, dueDate: "2026-12-24" }),
        bill({ id: "b4", name: "SPOTIFY", amountCents: 1199, dueDate: "2026-10-11", cadence: "quarterly", category: "subscriptions" }),
      ],
    });
    const d = cashAhead(ctx, [balance(200_000)], typed);
    expect(d.rows.filter((r) => r.source === "expected").map((r) => [r.date, r.name, r.cents, r.category])).toEqual([
      ["2026-10-20", "Autovakuutus", -41_000, "insurance"],
      ["2026-11-03", "Auton vero", -9500, "taxes"],
    ]);
    const plain = cashAhead(ctx, [balance(200_000)], NO_INPUTS);
    expect(d.balance!.days[30]!.cents).toBe(plain.balance!.days[30]!.cents - 41_000 - 9500);
  });

  it("a typed-in bill that was already paid is not listed or subtracted again", () => {
    const typed = inputs({ expectedBills: [bill({ amountCents: 64_000 })] });
    const paid = (cents: number, day: IsoDate) => createContext([...upTo(all, today), tx({ bookingDate: day, amountCents: -cents, merchant: "Pohjola Vakuutus", category: "insurance" })], [checking], today);
    const names = (c: ReturnType<typeof createContext>) => cashAhead(c, [balance(200_000)], typed).rows.map((r) => r.name);
    expect(names(ctx)).toContain("Autovakuutus");
    // paid on the 9th, within 5 % of the amount: the 20th is the same bill
    expect(names(paid(64_000, "2026-10-09"))).not.toContain("Autovakuutus");
    expect(names(paid(61_000, "2026-10-09"))).not.toContain("Autovakuutus");
    // another amount, or a payment more than a month before the date, is something else
    expect(names(paid(50_000, "2026-10-09"))).toContain("Autovakuutus");
    expect(names(paid(64_000, "2026-09-10"))).toContain("Autovakuutus");
    const d = cashAhead(paid(64_000, "2026-10-09"), [balance(200_000)], typed);
    expect(d.balance!.days[30]!.cents).toBe(cashAhead(ctx, [balance(200_000)], NO_INPUTS).balance!.days[30]!.cents);
  });

  it("the month forecast counts the typed-in bills still to come this month, but not in the backtest", () => {
    const plain = monthForecast(ctx);
    const typed = inputs({ expectedBills: [bill({ amountCents: 64_000 }), bill({ id: "b2", name: "Joulu", dueDate: "2026-11-20", amountCents: 5000 }), bill({ id: "b3", name: "Maksettu", dueDate: "2026-10-30", amountCents: 12_000 })] });
    const paid = createContext([...upTo(all, today), tx({ bookingDate: "2026-10-08", amountCents: -12_100, merchant: "Joku", category: "other" })], [checking], today);
    const f = monthForecast(ctx, typed);
    // the November bill is not this month's, the 30th is still to pay
    expect(f.billsLeftCents).toBe(plain.billsLeftCents + 64_000 + 12_000);
    expect(f.forecastCents).toBe(plain.forecastCents + 64_000 + 12_000);
    expect(monthForecast(paid, typed).billsLeftCents).toBe(monthForecast(paid).billsLeftCents + 64_000);
    // the past months were forecast without them: the error, and so the range's width in percent, is the same
    expect(f.rangePercent).toBe(plain.rangePercent);
    expect(buildDashboard(ctx, { from: "2026-10-01", to: today }, [], typed).forecast!.billsLeftCents).toBe(f.billsLeftCents);
  });

  it("a standing transfer to an own account is no series, so it is not in the line (NextDays says so)", () => {
    const savings: Account = { id: "sav", name: "Säästötili", iban: "FI14 1009 3000 1234 58", currency: "EUR", type: "savings" };
    const moves = ["2026-07-26", "2026-08-26", "2026-09-26"].flatMap((bookingDate) => [
      tx({ bookingDate, amountCents: -30_000, merchant: "Säästö", category: "transfer", isTransfer: true }),
      tx({ accountId: "sav", bookingDate, amountCents: 30_000, merchant: "Säästö", category: "transfer", isTransfer: true }),
    ]);
    const withMoves = createContext([...upTo(all, today), ...moves], [checking, savings], today);
    expect(withMoves.recurring.some((r) => r.merchant === "Säästö")).toBe(false);
    expect(cashAhead(withMoves, [balance(200_000)], NO_INPUTS).rows.map((r) => r.name)).not.toContain("Säästö");
  });

  it("without a checking balance there is the list and no balance line", () => {
    for (const balances of [[], [balance(null)], [balance(80_000, { type: "savings" }), balance(-20_000, { type: "credit_card" })]]) {
      const d = cashAhead(ctx, balances, NO_INPUTS);
      expect(d).toMatchObject({ balance: null, missing: "balance" });
      expect(d.rows).toHaveLength(3);
    }
  });

  it("checking balances of the household add up, shared ones too", () => {
    const d = cashAhead(ctx, [balance(100_000), balance(50_000, { id: "acc-2", ownerName: "Maija", balanceAt: "2026-10-08T06:00:00Z" }), balance(900_000, { id: "sav", type: "savings" })], NO_INPUTS);
    expect(d.balance).toMatchObject({ startCents: 150_000, accounts: 2, balanceAt: "2026-10-08T06:00:00Z" });
  });

  it("a history without a complete month has no everyday level, so no balance line", () => {
    const first = createContext(upTo(steady("2026-10-01", "2026-10-31"), today), [checking], today);
    expect(cashAhead(first, [balance(200_000)], NO_INPUTS)).toMatchObject({ balance: null, missing: "history", everydayPerDayCents: 0 });
  });

  it("the dashboard has it for a period that reaches today and not for a past one", () => {
    expect(buildDashboard(ctx, { from: "2026-10-01", to: today }, [balance(200_000)], NO_INPUTS).ahead!.balance!.startCents).toBe(200_000);
    expect(buildDashboard(ctx, { from: "2026-10-01", to: "2026-10-31" }).ahead).not.toBeNull();
    expect(buildDashboard(ctx, { from: "2026-09-01", to: "2026-09-30" }).ahead).toBeNull();
  });
});
