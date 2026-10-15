/**
 * What the readers of a series make of a bill that was paid another way: the year of rare bills, the window before
 * payday and the forecast's typed-in bills. The rule that settles a bill is in recurring-settled.test.ts.
 */
import { describe, expect, it } from "vitest";
import { cashAhead } from "../src/analysis/ahead.ts";
import { createContext } from "../src/analysis/context.ts";
import { expectedBillRows } from "../src/analysis/forecast.ts";
import { expectedCharges } from "../src/commitments.ts";
import { upcomingReport } from "../src/reports/upcoming.ts";
import { type Account, type BalanceInput, type ExpectedBill, NO_INPUTS, type Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const PAYEE = "ESIMERKKI VAKUUTUS OY";
const acc = (id: string, type: Account["type"] = "checking"): Account => ({ id, name: id, iban: null, currency: "EUR", type });
const ACCOUNTS = [acc("acc-1"), acc("acc-2"), acc("sav", "savings"), acc("card", "credit_card")];
const bal = (a: Account, balanceCents: number, today: string): BalanceInput => ({ id: a.id, name: a.name, type: a.type, balanceCents, ownerName: null, balanceAt: `${today}T06:00:00Z` });
const paid = (over: Partial<Transaction> & Pick<Transaction, "bookingDate">): Transaction => tx({ merchant: PAYEE, category: "insurance", amountCents: -12_000, ...over });

describe("the year of rare bills: a yearly bill paid from another account", () => {
  const history = ["2023-12-15", "2024-12-15", "2025-12-15"].map((bookingDate) => paid({ bookingDate }));
  const today = "2026-12-10";
  const year = (extra: Transaction[], on = today) => upcomingReport(createContext([...history, ...extra], ACCOUNTS, on), NO_INPUTS);
  const december = (u: ReturnType<typeof year>) => u.months[0]!;

  it("is the same figure before and after the paying row, and the month's entry is paid", () => {
    const before = year([]);
    expect(before).toMatchObject({ yearlyCents: 12_000 });
    expect(december(before)).toMatchObject({ month: "2026-12", cents: 12_000, paid: [] });
    expect(before.items.map((i) => i.merchant)).toEqual([PAYEE]);

    for (const status of ["booked", "pending"] as const) {
      const after = year([paid({ bookingDate: "2026-12-09", accountId: "acc-2", status })]);
      expect(after.yearlyCents).toBe(before.yearlyCents);
      expect(after.reserveMonthlyCents).toBe(before.reserveMonthlyCents);
      expect(after.months.map((m) => m.cents)).toEqual(before.months.map((m) => m.cents));
      // the bill is paid in the month it fell due, with the series' typical sum, and is no longer coming
      expect(december(after).paid).toEqual([{ merchant: PAYEE, date: "2026-12-15" }]);
      expect(december(after).names).toEqual([PAYEE]);
      expect(after.items).toEqual([]);
    }
  });

  it("counts nothing twice when the series' own row comes later too", () => {
    const [a, b] = [paid({ bookingDate: "2026-12-09", accountId: "acc-2" }), paid({ bookingDate: "2026-12-16" })];
    const later = year([a, b], "2026-12-17");
    expect(later.yearlyCents).toBe(12_000);
    expect(later.months[0]!.cents).toBe(12_000);
    expect(later.months[0]!.paid).toEqual([{ merchant: PAYEE, date: "2026-12-16" }]);
    // the next one is a year on, outside the twelve months
    expect(later.months.slice(1).every((m) => m.cents === 0)).toBe(true);
  });

  it("a payment made last month for a bill due in this one keeps the figure, as the series' own row does", () => {
    // 28.11. is 17 days before the 15.12.: it settles the bill, the year starts on 1.12. and the bill stays in it
    const early = year([paid({ bookingDate: "2026-11-28", accountId: "acc-2" })]);
    expect(early.yearlyCents).toBe(12_000);
    expect(december(early).paid).toEqual([{ merchant: PAYEE, date: "2026-12-15" }]);
    expect(year([paid({ bookingDate: "2026-11-28" })]).yearlyCents).toBe(12_000);
    // a quarterly bill: four a year in the same way, the settled one among them
    const quarterly = ["2025-06-15", "2025-09-15", "2025-12-15", "2026-03-15", "2026-06-15", "2026-09-15"].map((bookingDate) => paid({ bookingDate }));
    const paidEarly = upcomingReport(createContext([...quarterly, paid({ bookingDate: "2026-11-28", accountId: "acc-2" })], ACCOUNTS, today), NO_INPUTS);
    expect(paidEarly.yearlyCents).toBe(upcomingReport(createContext(quarterly, ACCOUNTS, today), NO_INPUTS).yearlyCents);
    expect(paidEarly.yearlyCents).toBe(4 * 12_000);
  });

  it("a bill due last month and paid late from another account is no part of this year, with or without the row", () => {
    const lateHistory = ["2023-11-15", "2024-11-15", "2025-11-15"].map((bookingDate) => paid({ bookingDate }));
    const on = (extra: Transaction[]) => upcomingReport(createContext([...lateHistory, ...extra], ACCOUNTS, "2026-12-03"), NO_INPUTS);
    const [without, withRow] = [on([]), on([paid({ bookingDate: "2026-12-02", accountId: "acc-2" })])];
    expect(createContext([...lateHistory, paid({ bookingDate: "2026-12-02", accountId: "acc-2" })], ACCOUNTS, "2026-12-03").recurring[0]!.settled).toHaveLength(1);
    expect(withRow.yearlyCents).toBe(without.yearlyCents);
    expect(withRow.months.map((m) => m.cents)).toEqual(without.months.map((m) => m.cents));
    expect(withRow.months.every((m) => m.paid.length === 0)).toBe(true);
  });

  it("a payment that settles no bill (another sum) changes nothing in the year", () => {
    const stray = year([paid({ bookingDate: "2026-12-09", accountId: "acc-2", amountCents: -4_000 })]);
    expect(stray.yearlyCents).toBe(12_000);
    expect(december(stray).paid).toEqual([]);
    expect(stray.items).toHaveLength(1);
  });
});

describe("the window before payday: a monthly bill paid from another account", () => {
  const today = "2026-10-14";
  const base = [4, 5, 6, 7, 8, 9].map((m) => tx({ merchant: PAYEE, category: "subscriptions", amountCents: -5000, bookingDate: `2026-0${m}-15` }));
  const BALANCES = [bal(ACCOUNTS[0]!, 200_000, today), bal(ACCOUNTS[1]!, 100_000, today)];
  const run = (extra: Transaction[], balances: BalanceInput[] = BALANCES) => cashAhead(createContext([...base, ...extra], ACCOUNTS, today), balances, NO_INPUTS);
  const pay = (over: Partial<Transaction>) => tx({ merchant: PAYEE, category: "subscriptions", amountCents: -5000, bookingDate: "2026-10-14", accountId: "acc-2", ...over });
  const bills = (d: ReturnType<typeof run>) => d.rows.filter((r) => r.source === "recurring");

  it("nobody paid it: one row on its day and the sum", () => {
    const d = run([]);
    expect(bills(d)).toEqual([{ date: "2026-10-15", name: PAYEE, category: "subscriptions", cents: -5000, source: "recurring" }]);
    expect(d.totals.dueCents).toBe(5000);
    expect(d.upcoming).toHaveLength(1);
  });

  it("booked on a counted account: in neither the rows nor the sum", () => {
    const d = run([pay({})]);
    expect(bills(d)).toHaveLength(0);
    expect(d.totals.dueCents).toBe(0);
    expect(d.upcoming).toHaveLength(0);
    expect(d.balance!.freeCents).toBe(300_000);
  });

  it("pending on a counted account: stays in the rows and the sum, marked, and agrees with the list", () => {
    for (const account of ["acc-2", "acc-1"]) {
      const d = run([pay({ status: "pending", accountId: account })]);
      expect(bills(d)).toEqual([{ date: "2026-10-15", name: PAYEE, category: "subscriptions", cents: -5000, source: "recurring", pending: true }]);
      expect(d.totals.dueCents).toBe(5000);
      expect(d.rows.filter((r) => r.cents < 0).reduce((sum, r) => sum - r.cents, 0)).toBe(d.totals.dueCents);
      // the balance still holds the payment's money: it is taken off once
      expect(d.balance!.freeCents).toBe(300_000 - 5000);
      // Laskut's list holds the same row, marked the same, so the two pages show one sum
      expect(d.upcoming).toEqual(bills(d));
    }
  });

  it("pending on a card or on an account the balance does not count: in neither", () => {
    for (const account of ["card", "sav"]) {
      const d = run([pay({ status: "pending", accountId: account })]);
      expect(bills(d)).toHaveLength(0);
      expect(d.totals.dueCents).toBe(0);
      expect(d.upcoming).toHaveLength(0);
    }
  });

  it("turns booked: gone from the rows and the sum, whatever the account", () => {
    const pending = pay({ status: "pending" });
    expect(run([pending]).totals.dueCents).toBe(5000);
    const booked = run([{ ...pending, status: "booked" }]);
    expect(bills(booked)).toHaveLength(0);
    expect(booked.totals.dueCents).toBe(0);
  });

  it("the next month's bill is due as before while this month's pending one stays", () => {
    // a window of 30 days holds the 15.10. only; with the payment dated 14.10. nothing else is added or lost
    const d = run([pay({ status: "pending" })]);
    expect(bills(d).map((r) => r.date)).toEqual(["2026-10-15"]);
    expect(run([]).rows.filter((r) => r.source === "recurring")).toHaveLength(1);
  });

  it("a pending payment that settles no bill (another sum) adds no row", () => {
    const d = run([pay({ status: "pending", amountCents: -2000 })]);
    expect(d.rows.filter((r) => r.pending)).toEqual([]);
    expect(d.totals.dueCents).toBe(5000);
  });
});

describe("the forecast: a typed-in bill of a series' name", () => {
  const today = "2026-10-14";
  const base = [4, 5, 6, 7, 8, 9].map((m) => tx({ merchant: PAYEE, category: "subscriptions", amountCents: -5000, bookingDate: `2026-0${m}-15` }));
  const typed: ExpectedBill = { id: "b1", name: PAYEE, amountCents: 5000, dueDate: "2026-10-15", cadence: "once", category: "subscriptions" };

  it("counts each date once, the settled one not at all", () => {
    for (const status of ["booked", "pending"] as const) {
      const rows = [...base, tx({ merchant: PAYEE, category: "subscriptions", amountCents: -5000, bookingDate: "2026-10-14", accountId: "acc-2", status })];
      const ctx = createContext(rows, ACCOUNTS, today);
      const dates = [...expectedCharges(ctx.recurring, today, "2026-12-31").map((c) => c.date), ...expectedBillRows(ctx, [typed], today, "2026-12-31").map((r) => r.date)].sort();
      expect(dates).toEqual(["2026-11-15", "2026-12-15"]);
    }
  });

  it("without the paying row the 15.10. is counted once too", () => {
    const ctx = createContext(base, ACCOUNTS, today);
    const dates = [...expectedCharges(ctx.recurring, today, "2026-12-31").map((c) => c.date), ...expectedBillRows(ctx, [typed], today, "2026-12-31").map((r) => r.date)].sort();
    expect(dates).toEqual(["2026-10-15", "2026-11-15", "2026-12-15"]);
  });
});
