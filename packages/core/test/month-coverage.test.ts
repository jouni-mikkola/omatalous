/**
 * A month before the household's accounts began is unknown: its figure is null in every monthly series, never 0, and it
 * is in no average. A small account with a few old rows (interest on a savings account) does not make those months known.
 * Made-up household: the daily account starts in April 2025, a savings account has rows from January.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { householdKnownFrom, monthKnown } from "../src/analysis/coverage.ts";
import { addMonths, dateIn } from "../src/dates.ts";
import { buildOverview } from "../src/overview.ts";
import { balanceReport } from "../src/reports/balances.ts";
import { incomeReport } from "../src/reports/income.ts";
import { spendingMonthsReport } from "../src/reports/spending-months.ts";
import { taxYearDays, taxYearReport } from "../src/reports/tax-year.ts";
import type { Account, BalanceInput, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking", bank: "Pankki" };
// another bank: a bank that gave the savings account its history from January would be read as giving the daily account the same
const savings: Account = { id: "sav-1", name: "Säästötili", iban: null, currency: "EUR", type: "savings", bank: "Säästöpankki" };
const TODAY = "2026-01-05";
const RANGE = { from: "2025-01-01", to: "2025-12-31" };
const UNKNOWN = ["2025-01", "2025-02", "2025-03"];
const KNOWN = Array.from({ length: 9 }, (_, i) => addMonths("2025-04", i));

const monthly = (months: readonly string[], cents: number, merchant: string, category: string, accountId: string, day: number): Transaction[] =>
  months.map((m) => tx({ bookingDate: dateIn(m, day), amountCents: cents, merchant, counterparty: merchant, category, categorySource: "rule", accountId }));

const rows: Transaction[] = [
  ...monthly(KNOWN, 250_000, "Acme Oy", "salary", "acc-1", 5),
  ...monthly(KNOWN, -90_000, "Asunto Oy Esimerkki", "housing", "acc-1", 3),
  ...monthly(KNOWN, -40_000, "Ruokakauppa", "groceries", "acc-1", 10),
  // a savings account with one small row a month before the daily account was connected
  ...monthly(UNKNOWN, 100, "Pankki", "other", "sav-1", 15),
];
const ctx = createContext(rows, [checking, savings], TODAY);
const balances: BalanceInput[] = [
  { id: "acc-1", name: "Käyttötili", type: "checking", balanceCents: 400_000, ownerName: null, balanceAt: null },
  { id: "sav-1", name: "Säästötili", type: "savings", balanceCents: 300, ownerName: null, balanceAt: null },
];

describe("a month before the household's data", () => {
  it("is known from the day the account that pays out begins, not from a small account's old rows", () => {
    expect(householdKnownFrom(ctx)! >= "2025-04-01").toBe(true);
    for (const month of UNKNOWN) expect(monthKnown(ctx, month), month).toBe(false);
    for (const month of KNOWN) expect(monthKnown(ctx, month), month).toBe(true);
  });

  it("gives spending no figure, and the average month reads the covered months only", () => {
    const s = spendingMonthsReport(ctx, RANGE);
    const at = (month: string) => s.months.indexOf(month);
    for (const month of UNKNOWN) {
      expect(s.totals[at(month)], month).toBeNull();
      expect(s.fromSavings[at(month)], month).toBeNull();
      expect(s.complete[at(month)], month).toBe(false);
      for (const c of s.categories) expect(c.values[at(month)], `${month} ${c.category}`).toBeNull();
    }
    for (const month of KNOWN) expect(s.totals[at(month)], month).toBe(130_000);
    expect(s.totalCents).toBe(9 * 130_000);
    // three zero months would pull the level down to 97 500
    expect(s.typicalMonths).toBe(9);
    expect(s.typicalCents).toBe(130_000);
    for (const c of s.categories) expect(c.values.filter((v) => v !== null).reduce((a, b) => a! + b!, 0), c.category).toBe(c.totalCents);
  });

  it("gives income no figure, and the usual level and each type's monthly figure read the covered months only", () => {
    const r = incomeReport(ctx, RANGE);
    const at = (month: string) => r.months.findIndex((m) => m.month === month);
    for (const month of UNKNOWN) {
      const m = r.months[at(month)]!;
      expect(m.totalCents, month).toBeNull();
      expect(m.earnedCents, month).toBeNull();
      expect(m.usualCents, month).toBeNull();
      expect(m.complete, month).toBe(false);
      for (const type of r.types) expect(type.months[at(month)], `${month} ${type.type}`).toBeNull();
      for (const kind of r.kinds) expect(kind.months[at(month)], `${month} ${kind.id}`).toBeNull();
    }
    for (const month of KNOWN) expect(r.months[at(month)]!.totalCents, month).toBe(250_000);
    // the three small rows of the unknown months are money that came in: the range total holds them, no cell does
    expect(r.totalCents).toBe(9 * 250_000 + 3 * 100);
    expect(r.completeMonths).toBe(9);
    const salary = r.types.find((t) => t.type === "salary")!;
    // three zero months would give 187 500
    expect(salary.monthlyCents).toBe(250_000);
    expect(r.monthlyCents).toBe(250_000);
  });

  it("gives the balances no total, and every change is the difference of the totals shown", () => {
    const r = balanceReport(ctx, RANGE, balances);
    const at = (month: string) => r.months.indexOf(month);
    for (const month of UNKNOWN) {
      expect(r.total[at(month)], month).toBeNull();
      expect(r.monthChange[at(month)], month).toBeNull();
      expect(r.accountsLessDebt[at(month)], month).toBeNull();
    }
    let checked = 0;
    r.monthChange.forEach((change, i) => {
      if (i === 0) return;
      const before = r.total[i - 1];
      const now = r.total[i];
      if (before === null || before === undefined || now === null || now === undefined) {
        expect(change, r.months[i]).toBeNull();
        return;
      }
      checked++;
      expect(change, r.months[i]).toBe(now - before);
    });
    expect(checked).toBeGreaterThan(3);
  });

  it("makes the change of a month an account joined in the plain difference, its whole balance in it", () => {
    // a second savings account with its first row in August: its balance is in the totals from then on
    const late: Account = { id: "sav-2", name: "Uusi säästötili", iban: null, currency: "EUR", type: "savings", bank: "Säästöpankki" };
    const withLate = createContext([...rows, tx({ bookingDate: "2025-08-12", amountCents: 50_000, merchant: "Siirto", category: "transfer", isTransfer: true, accountId: "sav-2" })], [checking, savings, late], TODAY);
    const more: BalanceInput[] = [...balances, { id: "sav-2", name: "Uusi säästötili", type: "savings", balanceCents: 50_000, ownerName: null, balanceAt: null }];
    const r = balanceReport(withLate, RANGE, more);
    let checked = 0;
    r.monthChange.forEach((change, i) => {
      if (change === null) return;
      checked++;
      expect(change, r.months[i]).toBe(r.total[i]! - r.total[i - 1]!);
    });
    expect(checked).toBeGreaterThan(3);
  });
});

describe("the money of an unknown month", () => {
  // the savings account also earns a little in June, so the share it pays out is judged against the months it has rows in
  const old = [
    tx({ bookingDate: "2025-02-10", amountCents: 50_000, merchant: "Vanha Työnantaja Oy", counterparty: "Vanha Työnantaja Oy", category: "salary", categorySource: "rule", accountId: "sav-1" }),
    tx({ bookingDate: "2025-02-12", amountCents: -5_000, merchant: "Kioski", counterparty: "Kioski", category: "groceries", categorySource: "rule", accountId: "sav-1" }),
    tx({ bookingDate: "2025-06-15", amountCents: 100, merchant: "Pankki", counterparty: "Pankki", category: "other", categorySource: "rule", accountId: "sav-1" }),
  ];
  const withOld = createContext([...rows, ...old], [checking, savings], TODAY);

  it("has no cell, but the totals, the types and the tax year still add its rows", () => {
    expect(monthKnown(withOld, "2025-02")).toBe(false);
    const r = incomeReport(withOld, RANGE, balances);
    expect(r.months.find((m) => m.month === "2025-02")!.totalCents).toBeNull();
    for (const type of r.types) expect(type.months[r.months.findIndex((m) => m.month === "2025-02")], type.type).toBeNull();
    expect(r.totalCents).toBe(9 * 250_000 + 50_000 + 4 * 100);
    expect(r.types.reduce((a, t) => a + t.totalCents, 0)).toBe(r.totalCents);
    const year = taxYearReport(withOld, RANGE, incomeReport(withOld, taxYearDays(withOld, RANGE), balances));
    expect(year.income.totalCents).toBe(9 * 250_000 + 50_000 + 4 * 100);
    const s = spendingMonthsReport(withOld, RANGE);
    expect(s.totals[s.months.indexOf("2025-02")]).toBeNull();
    expect(s.totalCents).toBe(9 * 130_000 + 5_000);
    // the groceries of February are in the category's total and in no cell
    const groceries = s.categories.find((c) => c.category === "groceries")!;
    expect(groceries.totalCents).toBe(9 * 40_000 + 5_000);
    expect(groceries.values.reduce<number>((a, v) => a + (v ?? 0), 0)).toBe(9 * 40_000);
  });

  it("gives the first page's twelve months no figure for an unknown month", () => {
    const o = buildOverview(createContext(rows, [checking, savings], "2025-12-20"));
    for (const m of o.months.filter((x) => UNKNOWN.includes(x.month))) {
      expect(m.incomeCents, m.month).toBeNull();
      expect(m.spendCents, m.month).toBeNull();
      expect(m.fromSavingsCents, m.month).toBeNull();
    }
    for (const m of o.months.filter((x) => KNOWN.includes(x.month))) expect(m.incomeCents, m.month).toBe(250_000);
  });
});

describe("the months a household is known from do not change as accounts come and go", () => {
  const own = (id: string): Account => ({ id, name: id, iban: null, currency: "EUR", type: "checking", bank: "Pankki" });
  const knownOf = (c: ReturnType<typeof createContext>, months: readonly string[]) => months.map((m) => monthKnown(c, m));

  it("keeps the months known when a partner's account with large spending joins later", () => {
    const partner = monthly(["2026-01", "2026-02"], -10_000_000, "Kumppanin kauppa", "groceries", "partner-1", 8);
    const joined = createContext([...rows, ...partner], [checking, savings, own("partner-1")], "2026-03-05");
    // acc-1 pays out all of the household's spending in the months it has rows in, so April stays the first known month
    expect(knownOf(joined, [...UNKNOWN, ...KNOWN])).toEqual([...UNKNOWN.map(() => false), ...KNOWN.map(() => true)]);
  });

  it("keeps the months known when the account that began them is closed and another takes over", () => {
    const first = ["2025-04", "2025-05", "2025-06", "2025-07", "2025-08"];
    const second = ["2025-09", "2025-10", "2025-11", "2025-12"];
    const closing = [
      ...monthly(first, 250_000, "Acme Oy", "salary", "acc-1", 5),
      ...monthly(first, -130_000, "Ruokakauppa", "groceries", "acc-1", 10),
      ...monthly(second, 250_000, "Acme Oy", "salary", "acc-2", 5),
      ...monthly(second, -130_000, "Ruokakauppa", "groceries", "acc-2", 10),
      ...monthly(UNKNOWN, 100, "Pankki", "other", "sav-1", 15),
    ];
    const c = createContext(closing, [checking, savings, own("acc-2")], TODAY);
    expect(knownOf(c, [...UNKNOWN, ...first, ...second])).toEqual([...UNKNOWN, ...first, ...second].map((m) => !UNKNOWN.includes(m)));
    const s = spendingMonthsReport(c, RANGE);
    for (const m of [...first, ...second]) expect(s.totals[s.months.indexOf(m)], m).toBe(130_000);
  });
});
