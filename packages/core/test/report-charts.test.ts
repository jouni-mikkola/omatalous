import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { totalsOf } from "../src/analysis/flows.ts";
import { buildReports } from "../src/reports/index.ts";
import type { Account } from "../src/types.ts";
import { series, tx } from "./helpers.ts";

// the fields the charts of Raportit read (PD-raportit): cumulative Yli jäi, the usual savings rate, like-for-like
// change per category, the lowest day and the events of the balance line
const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const today = "2026-10-09";
const rows = [
  ...series("2024-12-25", 30.44, 22, 300000, { category: "salary", merchant: "Acme Oy" }),
  ...series("2024-12-02", 30.44, 22, -105000, { category: "housing", merchant: "Sato Oyj" }),
  ...series("2024-12-01", 3.5, 190, (i) => -(2000 + (i % 7) * 900), { category: "groceries", merchant: "K-Market" }),
  tx({ bookingDate: "2026-06-14", amountCents: -189000, category: "travel", merchant: "Finnair" }),
].filter((t) => t.bookingDate <= today);
const ctx = createContext(rows, [checking], today);

describe("report fields of the Raportit charts", () => {
  const r = buildReports({ ctx, range: { from: "2025-11-01", to: "2026-10-09" }, balances: [{ id: "acc-1", name: "Käyttötili", type: "checking", balanceCents: 500000, ownerName: null, balanceAt: null }] });

  it("adds up Yli jäi from January, and the running month ends this year's line", () => {
    const y = r.cashflow.yearToDate;
    expect(y.year).toBe(2026);
    expect(y.partialMonth).toBe(9);
    const left = (from: string, to: string) => totalsOf(rows.filter((t) => t.bookingDate >= from && t.bookingDate <= to).map((t) => ctx.txs.find((x) => x.id === t.id)!.flows)).leftCents;
    expect(y.current[8]).toBe(left("2026-01-01", "2026-09-30"));
    expect(y.current[9]).toBe(left("2026-01-01", today));
    expect(y.current[10]).toBeNull();
    expect(y.previous[11]).toBe(left("2025-01-01", "2025-12-31"));
    expect(y.compared).toEqual({ month: 8, cents: y.current[8]! - y.previous[8]! });
  });

  it("draws no line for a year whose January the history does not cover", () => {
    const late = createContext(rows.filter((t) => t.bookingDate >= "2025-03-01"), [checking], today);
    const y = buildReports({ ctx: late, range: { from: "2025-11-01", to: "2026-10-09" }, balances: [] }).cashflow.yearToDate;
    expect(y.previous.every((v) => v === null)).toBe(true);
    expect(y.current[0]).not.toBeNull();
  });

  it("gives the middle half of the complete months' savings rates", () => {
    const u = r.cashflow.usualRate!;
    const rates = r.cashflow.rows.filter((x) => x.complete && x.savingsRate !== null).map((x) => x.savingsRate!);
    expect(u.months).toBe(rates.length);
    expect(u.low).toBeLessThanOrEqual(u.mid);
    expect(u.mid).toBeLessThanOrEqual(u.high);
    expect(rates).toContain(u.mid);
  });

  it("tells each category's change like for like, and a group's as the sum of its categories", () => {
    const q = buildReports({ ctx, range: { from: "2026-07-01", to: "2026-09-30" }, balances: [] }).categories;
    expect(q.comparable).toBe(true);
    expect(r.categories.groups[0]!.changeCents).toBeNull();
    for (const g of q.groups) {
      for (const c of g.categories) expect(c.changeCents).toBe(c.comparedCents - c.previousCents);
      expect(g.changeCents).toBe(g.categories.reduce((s, c) => s + c.changeCents!, 0));
    }
  });

  it("prints the shares as whole percents: the groups add up to 100 and each group's categories to the group's", () => {
    const groups = r.categories.groups;
    expect(groups.reduce((s, g) => s + (g.shareUnits ?? 0), 0)).toBe(100);
    for (const g of groups) expect(g.categories.reduce((s, c) => s + (c.shareUnits ?? 0), 0)).toBe(g.shareUnits);
  });

  it("gives a group of one category that category's average a month", () => {
    for (const g of r.categories.groups.filter((x) => x.categories.length === 1)) expect(g.monthlyAvgCents).toBe(g.categories[0]!.monthlyAvgCents);
    expect(r.categories.groups.some((g) => g.monthlyAvgCents !== null)).toBe(true);
  });

  it("gives each income type its months and its change against the same months a year before", () => {
    const income = buildReports({ ctx, range: { from: "2026-01-01", to: "2026-09-30" }, balances: [] }).income;
    expect(income.totalCents).toBe(income.earnedCents + income.notEarnedCents);
    expect(income.fromPeopleCents).toBe(income.notEarnedCents - income.unknownCents);
    const salary = income.types.find((t) => t.type === "salary")!;
    expect(salary.months).toHaveLength(income.months.length);
    expect(salary.months.reduce((a, b) => a + b, 0)).toBe(salary.totalCents);
    expect(salary.previousCents).toBe(9 * 300000);
    expect(salary.changeCents).toBe(salary.totalCents - salary.previousCents!);
    const earned = income.kinds.find((k) => k.earned)!;
    expect(earned.totalCents).toBe(income.earnedCents);
    expect(earned.changeCents).toBe(income.types.filter((t) => t.earned).reduce((sum, t) => sum + t.changeCents!, 0));
    // the first year has no year before it
    expect(r.income.types.every((t) => t.changeCents === null)).toBe(true);
  });

  it("names the lowest day and marks the large purchase", () => {
    expect(r.balances.lowest).not.toBeNull();
    expect(r.balances.lowest!.day >= "2025-11-01" && r.balances.lowest!.day <= today).toBe(true);
    expect(r.balances.events.map((e) => e.day)).toContain("2026-06-14");
    expect(r.balances.events.find((e) => e.day === "2026-06-14")!.cents).toBe(-189000);
  });

  it("draws the balance by day from the range's first day, with the dip of the purchase on its day", () => {
    const d = r.balances.daily;
    expect(d.from).toBe("2025-11-01");
    const at = (iso: string) => d.cents[(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8)) - Date.UTC(2025, 10, 1)) / 86_400_000]!;
    // the purchase and that day's groceries
    expect(at("2026-06-14") - at("2026-06-13")).toBeLessThanOrEqual(-189000);
    expect(d.cents[d.cents.length - 1]).toBe(500000);
    expect(r.balances.change).toEqual({ from: "2025-11-01", to: today, cents: d.cents[d.cents.length - 1]! - d.cents.find((v) => v !== null)! });
    expect(Math.min(...d.cents.filter((v): v is number => v !== null))).toBe(r.balances.lowest!.cents);
  });

  it("gives a purchase its step on the line, and none when pay the same day hides it", () => {
    const finnair = r.balances.events.find((e) => e.day === "2026-06-14")!;
    expect(finnair.step).not.toBeNull();
    expect(finnair.step!.afterCents - finnair.step!.beforeCents).toBeLessThanOrEqual(-189000);
    const pay = rows.find((t) => t.category === "salary" && t.bookingDate.startsWith("2026-07"))!.bookingDate;
    const payday = createContext([...rows, tx({ bookingDate: pay, amountCents: -150000, category: "electronics", merchant: "Verkkokauppa" })], [checking], today);
    const b = buildReports({ ctx: payday, range: { from: "2025-11-01", to: today }, balances: [{ id: "acc-1", name: "Käyttötili", type: "checking", balanceCents: 500000, ownerName: null, balanceAt: null }] }).balances;
    expect(b.events.find((e) => e.day === pay)!.step).toBeNull();
    expect(b.events.find((e) => e.day === "2026-06-14")!.step).not.toBeNull();
  });

  it("names the pay days of the line's days", () => {
    const pays = r.balances.payDays;
    expect(pays.length).toBeGreaterThanOrEqual(10);
    expect(pays.every((d) => d >= r.balances.daily.from && d <= today)).toBe(true);
    expect(pays).toEqual([...pays].sort());
  });

  it("gives the stacked area its tops and the fixed share of each month", () => {
    for (const row of r.fixedVariable.rows) {
      expect(row.tops).toEqual([row.fixedCents, row.fixedCents + row.habitCents, row.fixedCents + row.habitCents + row.variableCents, row.fixedCents + row.habitCents + row.variableCents + row.debtCents]);
      if (row.tops[3] > 0) expect(row.fixedShare).toBeCloseTo(row.fixedCents / row.tops[3]);
      // the end labels: whole percents that add up to a hundred
      if (row.tops[3] > 0 && row.debtCents >= 0) expect(row.shares.reduce<number>((s, v) => s + v!, 0)).toBe(100);
    }
  });

  it("gives the period's spending and its fixed share under the months", () => {
    const t = r.fixedVariable.totals;
    expect(t.spendingCents).toBe(r.fixedVariable.rows.reduce((sum, x) => sum + x.tops[3], 0));
    expect(t.fixedShare).toBeCloseTo(t.fixedCents / t.spendingCents, 12);
  });

  it("marks rent as fixed and groceries as not", () => {
    const stats = r.categories.groups.flatMap((g) => g.categories);
    expect(stats.find((c) => c.category === "housing")!.fixedShare).toBeGreaterThan(0.9);
    expect(stats.find((c) => c.category === "groceries")!.fixedShare).toBe(0);
  });

  it("pairs each category's year to date with last year's", () => {
    const y = r.yearOverYear;
    expect(y.comparable).toBe(true);
    const housing = y.categories.find((c) => c.category === "housing")!;
    expect(housing.currentCents).toBeGreaterThan(0);
    expect(housing.changeCents).toBe(housing.currentCents - housing.previousCents);
  });

  it("the accounts' changes are over the head's two days and add up to it to the cent", () => {
    const two: Account = { id: "acc-2", name: "Säästötili", iban: null, currency: "EUR", type: "savings" };
    const moves = [
      ...rows,
      tx({ bookingDate: "2025-12-05", amountCents: -40000, category: "transfer", merchant: "Oma siirto", accountId: "acc-1" }),
      tx({ bookingDate: "2025-12-05", amountCents: 40000, category: "transfer", merchant: "Oma siirto", accountId: "acc-2" }),
      tx({ bookingDate: "2026-03-01", amountCents: 12345, category: "interest", merchant: "Korko", accountId: "acc-2" }),
    ];
    const both = createContext(moves, [checking, two], today);
    const b = buildReports({ ctx: both, range: { from: "2025-11-01", to: today }, balances: [
      { id: "acc-1", name: "Käyttötili", type: "checking", balanceCents: 500000, ownerName: null, balanceAt: null },
      { id: "acc-2", name: "Säästötili", type: "savings", balanceCents: 300000, ownerName: null, balanceAt: null },
    ] }).balances;
    expect(b.change).not.toBeNull();
    expect(b.accounts.reduce((s, a) => s + a.changeCents!, 0)).toBe(b.change!.cents);
    // each account's own change is its walk between the same two days
    expect(b.accounts.find((a) => a.accountId === "acc-2")!.changeCents).toBeGreaterThanOrEqual(12345);
  });
});

