import { describe, expect, it } from "vitest";
import { partCents } from "../src/account-use.ts";
import { cashAhead } from "../src/analysis/ahead.ts";
import { createContext } from "../src/analysis/context.ts";
import { addDays, dateIn, fromMonthIndex, monthIndex, weekdayOf } from "../src/dates.ts";
import { detectRecurring } from "../src/recurring.ts";
import { type Account, type BalanceInput, type IsoDate, NO_INPUTS, type Part, type Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const own: Account = { id: "own", name: "Käyttötili", iban: "FI21 1234 5600 0007 85", currency: "EUR", type: "checking" };
const joint: Account = { id: "joint", name: "Yhteinen tili", iban: "FI14 1009 3000 1234 58", currency: "EUR", type: "checking" };
const bal = (a: Account, balanceCents: number, today: IsoDate, extra: Partial<BalanceInput> = {}): BalanceInput => ({ id: a.id, name: a.name, type: a.type, balanceCents, ownerName: null, balanceAt: `${today}T06:00:00Z`, ...extra });

/** Day `day` of each month from `first` to `last` (month keys), or the Friday before when it is a Saturday or a Sunday. */
function payDays(day: number, first: string, last: string): IsoDate[] {
  const out: IsoDate[] = [];
  for (let m = monthIndex(first); m <= monthIndex(last); m++) {
    const date = dateIn(fromMonthIndex(m), day);
    const weekday = weekdayOf(date);
    out.push(weekday >= 5 ? addDays(date, 4 - weekday) : date);
  }
  return out;
}
const pay = (days: readonly IsoDate[]): Transaction[] => days.map((d) => tx({ accountId: "own", bookingDate: d, amountCents: 300_000, merchant: "Esimerkki Oy", category: "salary" }));

/** The four bills the household pays by hand, 1 500 euros in all. */
const BILLS = [
  { merchant: "Asunto Oy Esimerkki", category: "housing", cents: 65_000 },
  { merchant: "Sähkö Esimerkki Oy", category: "utilities", cents: 42_000 },
  { merchant: "Vakuutus Esimerkki Oy", category: "insurance", cents: 25_000 },
  { merchant: "Vesi Esimerkki Oy", category: "utilities", cents: 18_000 },
];
/** Every bill on each of the days, each day moved by `shift` days. */
const bills = (days: readonly IsoDate[], accountId = "own", shift = 0): Transaction[] =>
  days.flatMap((d) => BILLS.map((b) => tx({ accountId, bookingDate: addDays(d, shift), amountCents: -b.cents, merchant: b.merchant, category: b.category })));
const billDays = (rows: readonly Transaction[], today: IsoDate) =>
  detectRecurring(rows, today)
    .filter((s) => s.kind !== "income")
    .map((s) => s.nextDate);
/** The rows of `account` as the own view of a member holds them at `part`. */
const cut = (rows: readonly Transaction[], account: string, part: Part): Transaction[] =>
  rows.map((t) => (t.accountId === account ? { ...t, amountCents: partCents(t.amountCents, part), wholeCents: t.amountCents } : t));
const HALF: Part = { from: 0, to: 1, of: 2 };

describe("a bill paid on the day the pay arrives", () => {
  // the pay comes on the 10th, or on the Friday before: 10.7., 10.8., 10.9. and, the 10th being a Saturday, 9.10.
  const days = payDays(10, "2026-03", "2026-10");
  const TODAY = "2026-10-12";
  const rows = [...pay(days), ...bills(days)];

  it("the four bills come with the next pay on 10.11., are outside the sum of the block, and the balance is not short", () => {
    expect(days.slice(-4)).toEqual(["2026-07-10", "2026-08-10", "2026-09-10", "2026-10-09"]);
    expect(billDays(rows, TODAY)).toEqual(["2026-11-10", "2026-11-10", "2026-11-10", "2026-11-10"]);
    const d = cashAhead(createContext(rows, [own], TODAY), [bal(own, 100_000, TODAY)], NO_INPUTS);
    expect(d.payday).toMatchObject({ date: "2026-11-10", name: "Esimerkki Oy" });
    expect(d.to).toBe("2026-11-09");
    expect(d.rows).toEqual([]);
    expect(d.totals.dueCents).toBe(0);
    expect(d.balance).toMatchObject({ startCents: 100_000, freeCents: 100_000, shortCents: 0, shortOn: null });
    // Laskut still has them: in its 30 days, after the pay
    expect(d.upcoming.map((r) => [r.date, r.cents])).toEqual([["2026-11-10", -65_000], ["2026-11-10", -42_000], ["2026-11-10", -25_000], ["2026-11-10", -18_000]]);
  });

  it("on the pay day, once the pay is booked and the bills are not paid yet, they are due today and the balance holds the pay", () => {
    const unpaid = [...pay(days), ...bills(days.slice(0, -1))];
    expect(billDays(unpaid, "2026-10-09")).toEqual(["2026-10-09", "2026-10-09", "2026-10-09", "2026-10-09"]);
    const d = cashAhead(createContext(unpaid, [own], "2026-10-09"), [bal(own, 400_000, "2026-10-09")], NO_INPUTS);
    expect(d.payday).toMatchObject({ date: "2026-11-10" });
    expect(d.rows.map((r) => r.date)).toEqual(["2026-10-09", "2026-10-09", "2026-10-09", "2026-10-09"]);
    expect(d.balance).toMatchObject({ startCents: 400_000, freeCents: 250_000, shortCents: 0 });
    // before the pay is booked the bills wait for the same day: the one the pay is expected on
    const morning = [...pay(days.slice(0, -1)), ...bills(days.slice(0, -1))];
    expect(billDays(morning, "2026-10-09")).toEqual(["2026-10-09", "2026-10-09", "2026-10-09", "2026-10-09"]);
  });

  it("on the morning of the pay day, before the pay is booked, the bills that follow it are no rows of today: the balance is not short of them, and a debit of the 9th is a row", () => {
    const MORNING = "2026-10-09";
    // a direct debit on the 9th of every month: a day of its own, due today by chance
    const debit = ["03", "04", "05", "06", "07", "08", "09"].map((m) => tx({ accountId: "own", bookingDate: `2026-${m}-09`, amountCents: -2_990, merchant: "Puhelin Esimerkki Oy", category: "phone_internet" }));
    const before = [...pay(days.slice(0, -1)), ...bills(days.slice(0, -1)), ...debit];
    const d = cashAhead(createContext(before, [own], MORNING), [bal(own, 100_000, MORNING)], NO_INPUTS);
    expect(d).toMatchObject({ reason: "payday", to: MORNING, payday: { date: MORNING, name: "Esimerkki Oy" } });
    expect(d.rows.map((r) => [r.date, r.name, r.cents])).toEqual([[MORNING, "Puhelin Esimerkki Oy", -2_990]]);
    expect(d.totals.dueCents).toBe(2_990);
    expect(d.balance).toMatchObject({ startCents: 100_000, freeCents: 97_010, shortCents: 0, shortOn: null });
    // Laskut still lists the four, marked as paid from the pay, and the debit without the mark
    expect(d.upcoming.filter((r) => r.date === MORNING).map((r) => [r.name, r.withPay ?? false])).toEqual([
      ["Asunto Oy Esimerkki", true],
      ["Sähkö Esimerkki Oy", true],
      ["Vakuutus Esimerkki Oy", true],
      ["Vesi Esimerkki Oy", true],
      ["Puhelin Esimerkki Oy", false],
    ]);

    // the near miss: the pay is booked, so the same four bills are rows of today against a balance that holds the pay
    const booked = cashAhead(createContext([...before, ...pay(days.slice(-1))], [own], MORNING), [bal(own, 400_000, MORNING)], NO_INPUTS);
    expect(booked.rows.filter((r) => r.date === MORNING).map((r) => r.cents)).toEqual([-65_000, -42_000, -25_000, -18_000, -2_990]);
    expect(booked.upcoming.some((r) => r.withPay)).toBe(false);
    // and the day before the pay day the window is that day alone, with nothing of the pay day in it
    const eve = cashAhead(createContext(before, [own], "2026-10-08"), [bal(own, 100_000, "2026-10-08")], NO_INPUTS);
    expect(eve).toMatchObject({ to: "2026-10-08", rows: [] });
    expect(eve.upcoming.some((r) => r.withPay)).toBe(false);
  });
});

describe("which series follow a pay", () => {
  // 8.5. (the 10th is a Sunday), 10.6., 10.7., 10.8., 10.9., 9.10., 10.11., 10.12.; the next pay is Friday 8.1.2027, the 10th being a Sunday
  const days = payDays(10, "2026-05", "2026-12");
  const TODAY = "2026-12-14";
  const [WITH_PAY, OWN_DAY] = ["2027-01-08", "2027-01-10"];
  /** The one next day of the four bills, or all of them when they differ. */
  const dayOf = (rows: readonly Transaction[], today: IsoDate = TODAY) => {
    const found = [...new Set(billDays(rows, today))];
    return found.length === 1 ? found[0] : found;
  };
  /** The bills on the days of the pay, some of the days swapped for others. */
  const billsWith = (swap: Record<IsoDate, IsoDate>) => bills(days.map((d) => swap[d] ?? d));

  it("the pay moves to a Friday: the bills move with it, and the payday of the block is their day", () => {
    const rows = [...pay(days), ...bills(days)];
    expect(dayOf(rows)).toBe(WITH_PAY);
    const d = cashAhead(createContext(rows, [own], TODAY), [bal(own, 100_000, TODAY)], NO_INPUTS);
    expect([d.payday!.date, d.to, d.totals.dueCents]).toEqual([WITH_PAY, "2027-01-07", 0]);
    // without a pay in the history the bills have the day of their own: the 10th
    expect(dayOf(bills(days))).toBe(OWN_DAY);
  });

  it("bills paid the day after the pay come the day after it, and a Saturday stays a Saturday", () => {
    expect(dayOf([...pay(days), ...bills(days, "own", 1)])).toBe("2027-01-09");
    expect(weekdayOf("2027-01-09")).toBe(5);
  });

  it("three days after the pay is paid from the pay, four days after is not", () => {
    expect(dayOf([...pay(days), ...bills(days, "own", 3)])).toBe("2027-01-11");
    // the 14th of every month but one: the day of their own
    expect(dayOf([...pay(days), ...bills(days, "own", 4)])).toBe("2027-01-14");
  });

  it("with the pay in five of the last six months: yes; in four of six: no", () => {
    expect(dayOf([...pay(days), ...billsWith({ "2026-08-10": "2026-08-20" })])).toBe(WITH_PAY);
    expect(dayOf([...pay(days), ...billsWith({ "2026-08-10": "2026-08-20", "2026-09-10": "2026-09-20" })])).toBe(OWN_DAY);
  });

  it("one payment two days before its pay: no; one day before is the one that may differ", () => {
    expect(dayOf([...pay(days), ...billsWith({ "2026-09-10": "2026-09-08" })])).toBe(OWN_DAY);
    expect(dayOf([...pay(days), ...billsWith({ "2026-09-10": "2026-09-09" })])).toBe(WITH_PAY);
  });

  it("two charges say nothing yet, three do; and a charge older than the first pay is not counted", () => {
    const service = (on: readonly IsoDate[]) => on.map((d) => tx({ accountId: "own", bookingDate: d, amountCents: -1299, merchant: "Esimerkki Musiikki", category: "subscriptions" }));
    const next = (rows: Transaction[]) => detectRecurring(rows, TODAY).find((s) => s.merchant === "Esimerkki Musiikki")!.nextDate;
    expect(next([...pay(days), ...service(days.slice(-2))])).toBe(OWN_DAY);
    expect(next([...pay(days), ...service(days.slice(-3))])).toBe(WITH_PAY);
    // the pay began in October: of the eight charges of a bill two can be held against it, then three
    expect(dayOf([...pay(days.slice(-3)), ...bills([...days.slice(0, -3), ...days.slice(-2)])])).toBe(OWN_DAY);
    expect(dayOf([...pay(days.slice(-3)), ...bills(days)])).toBe(WITH_PAY);
  });

  it("a payer without a fixed day is no pay to follow", () => {
    const drifting = ["2026-05-01", "2026-06-05", "2026-07-09", "2026-08-13", "2026-09-17", "2026-10-21", "2026-11-25"];
    const rows = [...pay(drifting), ...bills(drifting)];
    expect(detectRecurring(rows, TODAY).find((s) => s.kind === "income")).toMatchObject({ merchant: "Esimerkki Oy", cadence: "monthly" });
    expect(dayOf(rows)).toEqual(dayOf(bills(drifting)));
  });

  it("money in follows no pay, and a refund from the payee of a bill changes nothing", () => {
    const benefit = days.map((d) => tx({ accountId: "own", bookingDate: d, amountCents: 20_000, merchant: "Kela", category: "benefits" }));
    const refund = tx({ accountId: "own", bookingDate: "2026-11-20", amountCents: 5000, merchant: "Sähkö Esimerkki Oy", category: "utilities" });
    const rows = [...pay(days), ...bills(days), ...benefit, refund];
    expect(detectRecurring(rows, TODAY).find((s) => s.merchant === "Kela")).toMatchObject({ kind: "income", nextDate: OWN_DAY });
    expect(dayOf(rows)).toBe(WITH_PAY);
  });

  it("of two pays the bills follow the one whose days they were paid on, here the smaller one before Christmas", () => {
    const second = payDays(25, "2026-05", "2026-11");
    const other = second.map((d) => tx({ accountId: "own", bookingDate: d, amountCents: 200_000, merchant: "Toinen Esimerkki Oy", category: "salary" }));
    const rows = [...pay(days), ...other, ...bills(second)];
    // 25.12. and 24.12. are closed, so the pay of the 25th comes on Wednesday 23.12.
    expect(dayOf(rows)).toBe("2026-12-23");
    const d = cashAhead(createContext(rows, [own], TODAY), [bal(own, 100_000, TODAY)], NO_INPUTS);
    expect([d.payday!.name, d.payday!.date, d.totals.dueCents]).toEqual(["Toinen Esimerkki Oy", "2026-12-23", 0]);
  });

  it("the own view and the view of the household give the same days, and the bills of the joint account at the part of the viewer", () => {
    const rows = [...pay(days), ...bills(days, "joint")];
    const [household, mine] = [createContext(rows, [own, joint], TODAY), createContext(cut(rows, "joint", HALF), [own, joint], TODAY)];
    const of = (ctx: typeof household) => ctx.recurring.filter((s) => s.kind !== "income").map((s) => [s.merchant, s.nextDate, s.typicalAmountCents]);
    expect(of(household)).toEqual(BILLS.map((b) => [b.merchant, WITH_PAY, b.cents]));
    expect(of(mine)).toEqual(BILLS.map((b) => [b.merchant, WITH_PAY, b.cents / 2]));
    const [h, m] = [
      cashAhead(household, [bal(own, 100_000, TODAY), bal(joint, 50_000, TODAY)], NO_INPUTS),
      cashAhead(mine, [bal(own, 100_000, TODAY, { part: { from: 0, to: 1, of: 1 } }), bal(joint, 25_000, TODAY, { part: HALF })], NO_INPUTS),
    ];
    expect(m.upcoming.map((r) => [r.date, r.cents * 2])).toEqual(h.upcoming.map((r) => [r.date, r.cents]));
    expect(h.upcoming.map((r) => r.date)).toEqual([WITH_PAY, WITH_PAY, WITH_PAY, WITH_PAY]);
  });
});
