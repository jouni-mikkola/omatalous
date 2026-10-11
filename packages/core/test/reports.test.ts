import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import { type Flows, totalsOf } from "../src/analysis/flows.ts";
import { completeMonthsBefore, isCompleteMonth, USUAL_MONTHS, usualCents } from "../src/analysis/usual.ts";
import { SUBSCRIPTION_CATEGORIES } from "../src/categories.ts";
import { expectedDates, fixedMonthlyCents, fixedSplit, isSubscription, subscriptionsMonthlyCents } from "../src/commitments.ts";
import type { BalanceInput } from "../src/reports/balances.ts";
import { buildReports } from "../src/reports/index.ts";
import { fullMonths } from "../src/reports/shared.ts";
import { addDays, addMonths, monthIndex } from "../src/dates.ts";
import type { Account, ExpectedCadence, Transaction } from "../src/types.ts";
import { series, tx } from "./helpers.ts";

// test helpers put every transaction on account "acc-1"
const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const today = "2026-10-09";

function dataset(): Transaction[] {
  return [
    ...series("2025-09-25", 30.44, 13, 300000, { category: "salary", merchant: "Acme Oy" }),
    ...series("2025-09-02", 30.44, 13, -105000, { category: "housing", merchant: "Sato Oyj" }),
    ...series("2025-09-12", 30.44, 13, -1199, { category: "subscriptions", merchant: "Spotify" }),
    ...series("2025-09-05", 30.44, 13, -25000, { category: "loans", merchant: "Nordea Rahoitus Suomi Oy" }),
    ...series("2025-09-06", 30.44, 13, -20000, { category: "investments", merchant: "Nordnet" }),
    ...series("2025-09-01", 3.5, 115, (i) => -(2000 + (i % 7) * 900), { category: "groceries", merchant: "K-Market" }),
    ...monthlyOn("2025-09", 8, 14, (i) => (i < 9 ? -1399 : -1599), { category: "subscriptions", merchant: "Netflix" }),
    tx({ bookingDate: "2026-06-14", amountCents: -38900, category: "travel", merchant: "Finnair" }),
    tx({ bookingDate: "2026-09-20", amountCents: -12900, category: "home", merchant: "Uusi Kauppa" }),
  ].filter((t) => t.bookingDate <= today);
}

/** `count` charges on day `day` of consecutive months from `firstMonth`. */
function monthlyOn(firstMonth: string, day: number, count: number, amount: (i: number) => number, partial: Partial<Transaction>): Transaction[] {
  return Array.from({ length: count }, (_, i) => tx({ ...partial, bookingDate: `${addMonths(firstMonth, i)}-${String(day).padStart(2, "0")}`, amountCents: amount(i) }));
}

describe("reports", () => {
  const ctx = createContext(dataset(), [checking], today);
  const range = { from: "2026-01-01", to: "2026-09-30" };
  const r = buildReports({ ctx, range, balances: [{ id: "acc-1", name: "Käyttötili", type: "checking", balanceCents: 123456, ownerName: null, balanceAt: null }] });

  it("cash flow rows add up to the period totals", () => {
    expect(r.cashflow.rows).toHaveLength(9);
    const sum = (k: "incomeCents" | "consumptionCents" | "debtCents" | "savedCents") => r.cashflow.rows.reduce((s, x) => s + x[k], 0);
    expect(sum("incomeCents")).toBe(r.cashflow.totals.incomeCents);
    expect(sum("consumptionCents")).toBe(r.cashflow.totals.consumptionCents);
    expect(sum("debtCents")).toBe(9 * 25000);
    expect(sum("savedCents")).toBe(9 * 20000);
    expect(r.cashflow.totals.netCents).toBe(r.cashflow.totals.incomeCents - r.cashflow.totals.consumptionCents - r.cashflow.totals.debtCents);
  });

  it("category stats, pivot and cash flow agree on total spending", () => {
    const spend = r.cashflow.totals.consumptionCents + r.cashflow.totals.debtCents;
    expect(r.categories.totalCents).toBe(spend);
    expect(r.pivot.totalCents).toBe(spend);
    expect(r.pivot.rows.reduce((s, x) => s + x.totalCents, 0)).toBe(spend);
    const housing = r.categories.groups.find((g) => g.group === "Asuminen")!.categories.find((c) => c.category === "housing")!;
    expect(housing).toMatchObject({ monthsActive: 9, monthlyAvgCents: 105000, medianMonthCents: 105000, count: 9 });
    expect(r.categories.groups.find((g) => g.group === "Velanhoito")!.totalCents).toBe(9 * 25000);
  });

  it("median month of a category is whole cents when the middle two months average to half a cent", () => {
    const two = [
      tx({ bookingDate: "2026-01-10", amountCents: -10001, category: "home", merchant: "Kodin Terra" }),
      tx({ bookingDate: "2026-02-10", amountCents: -10002, category: "home", merchant: "Kodin Terra" }),
    ];
    const c = buildReports({ ctx: createContext(two, [checking], "2026-03-15"), range: { from: "2026-01-01", to: "2026-02-28" }, balances: [] }).categories;
    const home = c.groups.flatMap((g) => g.categories).find((x) => x.category === "home")!;
    expect(home.medianMonthCents).toBe(10002);
    expect(Number.isInteger(home.medianMonthCents)).toBe(true);
  });

  it("splits spending into fixed (loan instalments included), habits, variable and other debt service", () => {
    const t = r.fixedVariable.totals;
    expect(t.fixedCents + t.habitCents + t.variableCents + t.debtCents).toBe(r.cashflow.totals.consumptionCents + r.cashflow.totals.debtCents);
    expect(t.fixedCents).toBeGreaterThanOrEqual(9 * (105000 + 1199 + 25000));
    // the monthly instalment is a fixed series, so no debt service is left outside it
    expect(t.debtCents).toBe(0);
  });

  it("summary agrees with cash flow and the category report", () => {
    const t = r.cashflow.totals;
    expect(r.summary).toMatchObject({ incomeCents: t.incomeCents, spendingCents: t.expenseCents, savedCents: t.savedCents, netCents: t.netCents });
    expect(r.summary.netCents).toBe(r.summary.incomeCents - r.summary.spendingCents);
    const largest = r.categories.groups.flatMap((g) => g.categories).sort((a, b) => b.totalCents - a.totalCents).slice(0, 3);
    expect(r.summary.topCategories.map((c) => [c.category, c.cents])).toEqual(largest.map((c) => [c.category, c.totalCents]));
    // January–September 2025 is before the history: no year-on-year changes
    expect(r.summary.comparable).toBe(false);
    expect(r.summary.changes).toEqual([]);
  });

  it("summary compares with the same period a year earlier when the history covers it", () => {
    const s = buildReports({ ctx, range: { from: "2026-09-01", to: "2026-09-30" }, balances: [] }).summary;
    expect(s.comparable).toBe(true);
    expect(s.changes.length).toBeGreaterThan(0);
    expect(s.changes.length).toBeLessThanOrEqual(3);
    const diffs = s.changes.map((c) => Math.abs(c.cents - c.previousCents));
    expect(diffs).toEqual([...diffs].sort((a, b) => b - a));
    const sept = (y: number, category: string) =>
      ctx.txs.filter((t) => t.category === category && t.bookingDate >= `${y}-09-01` && t.bookingDate <= `${y}-09-30`).reduce((a, t) => a + t.spend, 0);
    for (const c of s.changes) expect([c.cents, c.previousCents]).toEqual([sept(2026, c.category), sept(2025, c.category)]);
  });

  it("insights: every one that passed its gate, largest yearly figure first, each with its basis and rows", () => {
    const loan = series("2025-07-20", 30.44, 12, -25000, { merchant: "Autolaina", category: "loans" });
    const withLoan = createContext([...dataset(), ...loan], [checking], today);
    const { items, months } = buildReports({ ctx: withLoan, range, balances: [] }).insights;
    expect(items.length).toBeGreaterThan(0);
    expect(items.map((i) => i.yearlyCents)).toEqual(items.map((i) => i.yearlyCents).sort((a, b) => b - a));
    for (const i of items) {
      expect(i.yearlyCents, i.id).toBeGreaterThan(0);
      expect(i.detail, i.id).toMatch(/\.$/);
      expect(i.rows?.length || i.link, i.id).toBeTruthy();
    }
    expect(months).toBe(completeMonthsBefore(withLoan, "2026-09", 36).length);
    // the overview shows the first three of the same list
    expect(buildDashboard(withLoan, range).insights.map((i) => i.id)).toEqual(items.slice(0, 3).map((i) => i.id));
  });

  it("price changes: dated in the window, yearly effects add up", () => {
    const p = r.priceChanges;
    expect(p.items).toEqual([
      { merchant: "Netflix", category: "subscriptions", fromCents: 1399, toCents: 1599, date: "2026-06-08", yearlyEffectCents: 200 * 12 },
    ]);
    expect(p.totalYearlyEffectCents).toBe(p.items.reduce((s, i) => s + i.yearlyEffectCents, 0));
    // a one-month range still shows the changes of the 12 months before its end
    expect(buildReports({ ctx, range: { from: "2026-09-01", to: "2026-09-30" }, balances: [] }).priceChanges.items).toHaveLength(1);
    // a change after the range's end is not known yet then
    expect(buildReports({ ctx, range: { from: "2026-01-01", to: "2026-05-31" }, balances: [] }).priceChanges.items).toEqual([]);
  });

  it("pivot total average is over complete months only", () => {
    const partial = buildReports({ ctx, range: { from: "2026-08-01", to: today }, balances: [] }).pivot;
    expect(partial.averageCents).toBe(Math.round((partial.monthTotals[0]! + partial.monthTotals[1]!) / 2));
    expect(r.pivot.averageCents).toBe(Math.round(r.pivot.totalCents / 9));
  });

  it("year over year compares only months both years have data for", () => {
    const y = r.yearOverYear;
    expect(y.year).toBe(2026);
    expect(y.current.slice(9)).toEqual([null, null, null]);
    // history starts 1.9.2025, so January–August 2025 is unknown, not zero
    expect(y.comparableFromMonth).toBe(9);
    expect(y.previous.slice(0, 8)).toEqual([null, null, null, null, null, null, null, null]);
    expect(y.previous[8]).toBeGreaterThan(0);
    // year to date: September only, in both years
    const sept = (year: number) =>
      ctx.txs.filter((t) => t.bookingDate >= `${year}-09-01` && t.bookingDate <= `${year}-09-30`).reduce((s, t) => s + t.spend, 0);
    expect(y.ytdCents).toBe(sept(2026));
    expect(y.previousYtdCents).toBe(sept(2025));
  });

  it("reconstructs month-end balances backwards from today's balance", () => {
    const b = r.balances.accounts[0]!;
    const after = ctx.txs.filter((t) => t.bookingDate > "2026-09-30").reduce((s, t) => s + t.amountCents, 0);
    expect(b.values.at(-1)).toBe(123456 - after);
    const sep = ctx.txs.filter((t) => t.bookingDate >= "2026-09-01" && t.bookingDate <= "2026-09-30").reduce((s, t) => s + t.amountCents, 0);
    expect(b.values.at(-2)).toBe(b.values.at(-1)! - sep);
  });
});

describe("averages and partial periods", () => {
  const ctx = createContext(dataset(), [checking], today);

  it("a partial current month does not pull the monthly averages down", () => {
    // 1.8.–9.10.: August and September are complete, October has 9 days
    const r = buildReports({ ctx, range: { from: "2026-08-01", to: today }, balances: [] });
    expect(r.cashflow.rows).toHaveLength(3);
    expect(r.cashflow.average?.incomeCents).toBe(300000);
    const housing = r.categories.groups.flatMap((g) => g.categories).find((s) => s.category === "housing");
    expect(housing?.monthlyAvgCents).toBe(105000);
  });

  it("months before the first transaction are not averaged", () => {
    const r = buildReports({ ctx, range: { from: "2025-01-01", to: "2025-12-31" }, balances: [] });
    expect(r.cashflow.average?.incomeCents).toBe(300000); // September–December 2025, not /12
  });

  it("cash flow has no average without a complete month", () => {
    const r = buildReports({ ctx, range: { from: "2026-10-01", to: today }, balances: [] });
    expect(r.cashflow.average).toBeNull();
  });

  it("year over year marks the running month", () => {
    expect(buildReports({ ctx, range: { from: "2026-01-01", to: today }, balances: [] }).yearOverYear.partialMonth).toBe(10);
    expect(buildReports({ ctx, range: { from: "2026-01-01", to: "2026-09-30" }, balances: [] }).yearOverYear.partialMonth).toBeNull();
    expect(buildReports({ ctx, range: { from: "2026-01-01", to: "2026-09-20" }, balances: [] }).yearOverYear.partialMonth).toBe(9);
  });

  it("categories leave the previous period at zero when the history does not cover it", () => {
    const year = buildReports({ ctx, range: { from: "2026-01-01", to: "2026-09-30" }, balances: [] }).categories;
    expect(year.comparable).toBe(false);
    expect(year.groups.every((g) => g.previousCents === 0 && g.categories.every((c) => c.previousCents === 0))).toBe(true);
    const month = buildReports({ ctx, range: { from: "2026-09-01", to: "2026-09-30" }, balances: [] }).categories;
    expect(month.comparable).toBe(true);
    expect(month.groups.find((g) => g.group === "Asuminen")!.previousCents).toBe(105000);
  });

  it("this year's total is shown even without last year to compare to", () => {
    const young = createContext(dataset().filter((t) => t.bookingDate >= "2026-02-01"), [checking], today);
    const r = buildReports({ ctx: young, range: { from: "2026-01-01", to: today }, balances: [] });
    expect(r.yearOverYear.comparableFromMonth).toBeNull();
    expect(r.yearOverYear.ytdCents).toBeGreaterThan(0);
    expect(r.yearOverYear.incomeYtdCents).toBe(9 * 300000 - 300000); // Feb–Sep salaries
  });

  it("the pivot's month totals are the sum of its rows", () => {
    const refunds = [...dataset(), tx({ bookingDate: "2026-09-21", amountCents: 50000, category: "home", merchant: "Uusi Kauppa" })];
    const r = buildReports({ ctx: createContext(refunds, [checking], today), range: { from: "2026-01-01", to: "2026-09-30" }, balances: [] });
    r.pivot.months.forEach((_, i) => expect(r.pivot.monthTotals[i]).toBe(r.pivot.rows.reduce((s, row) => s + row.values[i]!, 0)));
    expect(r.pivot.rows.some((row) => row.category === "home")).toBe(false);
  });

  it("a smaller loan instalment is kept apart from price rises", () => {
    const rows = [...dataset(), ...monthlyOn("2025-09", 20, 13, (i) => (i < 6 ? -98450 : -95120), { category: "mortgage", merchant: "Nordea Bank Abp" })];
    const p = buildReports({ ctx: createContext(rows, [checking], today), range: { from: "2026-01-01", to: "2026-09-30" }, balances: [] }).priceChanges;
    expect(p.items.map((i) => i.merchant).sort()).toEqual(["Netflix", "Nordea Bank Abp"]);
    expect(p.totalYearlyEffectCents).toBe(200 * 12);
    expect(p.debtYearlyEffectCents).toBe(-3330 * 12);
  });

  it("year over year has nothing to compare when last year's data starts after this year's months", () => {
    // the history starts in October 2025: January–September 2026 has no counterpart
    const young = createContext(dataset().filter((t) => t.bookingDate >= "2025-10-01"), [checking], today);
    const y = buildReports({ ctx: young, range: { from: "2026-09-01", to: "2026-09-30" }, balances: [] }).yearOverYear;
    expect(y.comparableFromMonth).toBeNull();
    expect(y.previous.every((v) => v === null)).toBe(true);
    expect(y.ytdCents).toBe(young.txs.filter((t) => t.bookingDate >= "2026-01-01" && t.bookingDate <= "2026-09-30").reduce((s, t) => s + t.spend, 0));
  });

  it("card bills count as variable spending, not fixed costs", () => {
    const bills = series("2025-09-10", 30.44, 13, (i) => -(40000 + (i % 3) * 5000), { category: "card_bill", merchant: "Nordea Rahoitus Suomi Oy" });
    const r = buildReports({ ctx: createContext([...dataset(), ...bills], [checking], today), range: { from: "2026-01-01", to: "2026-09-30" }, balances: [] });
    const billTotal = r.categories.groups.flatMap((g) => g.categories).find((c) => c.category === "card_bill")!.totalCents;
    const t = r.fixedVariable.totals;
    expect(t.variableCents).toBeGreaterThanOrEqual(billTotal);
    expect(t.fixedCents + t.habitCents + t.variableCents + t.debtCents).toBe(r.cashflow.totals.consumptionCents + r.cashflow.totals.debtCents);
  });
});

describe("data quality signals", () => {
  const range = { from: "2026-08-01", to: "2026-10-09" };
  const ids = (txs: Transaction[], accounts: Account[] = [checking]) =>
    buildReports({ ctx: createContext(txs, accounts, today), range, balances: [] }).dataQuality.signals.map((s) => s.id);

  it("says nothing about a long, tidy history", () => {
    // the monthly Nordnet rows go to a fund that is not connected: own_unconnected, tested in trust.test.ts
    expect(ids(dataset().filter((t) => t.category !== "investments"))).toEqual([]);
  });

  it("flags a history shorter than three months", () => {
    expect(ids(series("2026-08-20", 3, 20, -2500, { category: "groceries", merchant: "K-Market" }))).toContain("short_history");
  });

  it("flags a high share of uncategorised spending, naming the biggest merchants", () => {
    const rows = [...dataset(), ...series("2026-08-02", 5, 14, -9000, { category: "other", merchant: "Puhtaaksi Oy" })];
    const s = buildReports({ ctx: createContext(rows, [checking], today), range, balances: [] }).dataQuality.signals.find((x) => x.id === "uncategorised")!;
    expect(s.detail).toContain("Puhtaaksi Oy");
  });

  it("flags a gap in an account's dates and an account that went quiet", () => {
    const rows = [...series("2026-05-01", 2, 40, -1500, { category: "groceries", merchant: "Lidl" }), ...series("2026-08-10", 2, 5, -1500, { category: "groceries", merchant: "Lidl" })];
    const found = ids(rows);
    expect(found).toContain("gap");
    expect(found).toContain("stale");
  });

  it("flags card bills counted as spending only while no card account is connected", () => {
    const bills = series("2025-09-10", 30.44, 14, -45000, { category: "card_bill", merchant: "Nordea Rahoitus Suomi Oy" });
    expect(ids([...dataset(), ...bills])).toContain("card_bills");
    const card: Account = { id: "card", name: "Nordea Gold", iban: null, currency: "EUR", type: "credit_card" };
    expect(ids([...dataset(), ...bills], [checking, card])).not.toContain("card_bills");
  });

});


describe("upcoming bills, rising costs and the buffer", () => {
  const range = { from: "2026-01-01", to: "2026-09-30" };
  const reports = (rows: Transaction[], balances: BalanceInput[] = []) =>
    buildReports({ ctx: createContext(rows, [checking], today), range, balances });
  /** Five charges a quarter apart, the last on `last`. */
  const quarterly = (merchant: string, last: string, cents = -9640, category = "insurance") => series(addDays(last, -365), 91.31, 5, cents, { category, merchant });

  it("tells the rare bills of the next three months, in date order, and leaves the monthly ones out", () => {
    // the next charge is 2026-11-19, the one after it is outside the window
    const rows = [...dataset(), ...quarterly("If", "2026-08-20"), ...series("2025-08-20", 182.62, 3, -8900, { category: "insurance", merchant: "Lähitapiola" })];
    const u = reports(rows).upcoming;
    expect(u.from).toBe(today);
    expect(u.items.map((i) => i.merchant)).toEqual(["If"]);
    expect(u.items[0]!.date >= today && u.items[0]!.date <= u.to).toBe(true);
    expect(u.totalCents).toBe(u.items.reduce((s, i) => s + i.amountCents, 0));
    expect(u.items.map((i) => i.date)).toEqual([...u.items.map((i) => i.date)].sort());
    // the year counts the half-yearly one too: 4 x 96,40 + 2 x 89 = 563,60
    expect(u.advice.replace(/\u00a0/g, " ")).toBe("Varaa 47 € kuussa, harvinaiset laskut ovat 564 € vuodessa.");
    // monthly bills (Spotify, rent) are in the forecast, not here
    expect(u.items.every((i) => !["Spotify", "Sato Oyj", "Netflix"].includes(i.merchant))).toBe(true);
  });

  it("a pet food order every quarter is a purchase, not a bill, and nothing to tell stays quiet", () => {
    const pets = reports([...dataset(), ...quarterly("Musti ja Mirri", "2026-08-20", -3541, "pets")]).upcoming;
    expect(pets.items).toEqual([]);
    expect(pets.advice).toBe("");
    expect(reports(dataset()).upcoming.items).toEqual([]);
  });

  /** `level` cents of groceries every month from `first`, the months in `high` at `highLevel`. */
  function monthly(first: string, months: number, level: number, high: Record<string, number> = {}): Transaction[] {
    return Array.from({ length: months }, (_, i) => {
      const month = addMonths(first, i);
      return tx({ bookingDate: `${month}-12`, amountCents: -(high[month] ?? level), category: "groceries", merchant: `Kauppa ${i % 4}` });
    });
  }
  const food = (rows: Transaction[]) => reports([...dataset().filter((t) => t.category !== "groceries"), ...rows]).drift;

  it("a category above its own level for three months in a row is told, with the yearly cost", () => {
    const d = food(monthly("2025-09", 13, 40000, { "2026-07": 52000, "2026-08": 53000, "2026-09": 54000 }));
    expect(d.months).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(d.items.map((i) => i.category)).toEqual(["groceries"]);
    expect(d.items[0]).toMatchObject({ usualCents: 40000, recentCents: 53000, extraYearlyCents: 13000 * 12 });
    expect(d.advice).toContain("Ruokakauppa");
  });

  it("one dear month, a rise of two months, or a small rise is not a new level", () => {
    expect(food(monthly("2025-09", 13, 40000, { "2026-08": 90000 })).items).toEqual([]);
    expect(food(monthly("2025-09", 13, 40000, { "2026-08": 54000, "2026-09": 54000 })).items).toEqual([]);
    expect(food(monthly("2025-09", 13, 40000, { "2026-07": 43000, "2026-08": 44000, "2026-09": 43500 })).items).toEqual([]);
    // 20 % above a usual month of 20 euros is 4 euros
    expect(food(monthly("2025-09", 13, 2000, { "2026-07": 2600, "2026-08": 2600, "2026-09": 2600 })).items).toEqual([]);
  });

  it("the same months a year earlier were as dear: a season, not a new level", () => {
    const d = food(monthly("2025-04", 18, 40000, { "2025-07": 52000, "2025-08": 53000, "2025-09": 54000, "2026-07": 52000, "2026-08": 53000, "2026-09": 54000 }));
    expect(d.items).toEqual([]);
  });

  it("is quiet without nine months of history and when most of the category is bills", () => {
    const short = monthly("2026-03", 7, 40000, { "2026-07": 52000, "2026-08": 53000, "2026-09": 54000 });
    expect(buildReports({ ctx: createContext(short, [checking], today), range, balances: [] }).drift).toMatchObject({ months: [], items: [], advice: "", checked: 0 });
    const bills = [
      ...series("2025-09-03", 30.44, 13, (i) => (i < 10 ? -9000 : -15000), { category: "utilities", merchant: "Oomi" }),
    ];
    expect(reports([...dataset(), ...bills]).drift.items.map((i) => i.category)).not.toContain("utilities");
  });

  it("a past period is judged at its own end", () => {
    const rows = monthly("2025-09", 13, 40000, { "2026-07": 52000, "2026-08": 53000, "2026-09": 54000 });
    const at = (to: string) => buildReports({ ctx: createContext([...dataset().filter((t) => t.category !== "groceries"), ...rows], [checking], today), range: { from: "2026-01-01", to }, balances: [] }).drift;
    expect(at("2026-09-30").items).toHaveLength(1);
    expect(at("2026-06-30").items).toEqual([]);
    // a running month is left out: the last whole month is September
    expect(at("2026-10-09").months).toEqual(["2026-07", "2026-08", "2026-09"]);
  });

  /** The yardstick by hand: spending of each complete month before today's, groceries and loan instalments included. */
  const usualSpend = (rows: Transaction[]) => {
    const c = createContext(rows, [checking], today);
    return usualCents(completeMonthsBefore(c, "2026-10").map((m) => c.txs.filter((t) => t.bookingDate.startsWith(m)).reduce((sum, t) => sum + t.spend, 0)));
  };
  const account = (id: string, type: BalanceInput["type"], balanceCents: number | null): BalanceInput => ({ id, name: id, type, balanceCents, ownerName: null, balanceAt: null });

  it("fixed costs as a share of income, and the cash in months of usual spending where a balance exists", () => {
    const b = reports(dataset(), [account("sav", "savings", 300000)]).buffer;
    // rent 1 050 €, loan 250 € and the subscriptions, against 3 000 € of income
    expect(b.incomeMonthlyCents).toBe(300000);
    expect(b.fixedShare).toBeCloseTo(b.fixedMonthlyCents / 300000, 6);
    expect(b.fixedMonthlyCents).toBeGreaterThanOrEqual(130000);
    expect(b.usualSpendCents).toBe(usualSpend(dataset()));
    expect(b.bufferMonths).toBeCloseTo(300000 / b.usualSpendCents!, 6);
    // under three months: says what it counted and how much is missing
    expect(b.bufferMonths!).toBeLessThan(3);
    expect(b.advice).toContain("Säästötileillä on");
    expect(b.advice).toContain("kun menot ovat tavallisesti");
    // the months the usual level stands on are named, as on the overview
    expect(b.advice).toMatch(/kuukaudessa \([a-zä]+–[a-zä]+kuu \d{4}\)\./);
    expect(b.advice).toContain("puuttuu");
    expect(b.advice).toContain("% tuloista");
    const big = reports(dataset(), [account("sav", "savings", 900000)]).buffer;
    expect(big.bufferMonths!).toBeGreaterThanOrEqual(3);
    // three months or more is a number, not a verdict
    expect(big.advice).not.toMatch(/riittävä|puuttuu|sitoumuksia/);
  });

  it("the buffer is told against all usual spending, groceries included, and counts savings and checking, not cards or loans", () => {
    const withFood = reports(dataset(), [account("sav", "savings", 300000), account("acc-1", "checking", 500000)]).buffer;
    const noFood = reports(dataset().filter((t) => t.category !== "groceries"), [account("sav", "savings", 300000)]).buffer;
    // the food shop is in the base: leaving it out would make the buffer look longer
    expect(withFood.usualSpendCents!).toBeGreaterThan(noFood.usualSpendCents! + 20000);
    expect(noFood.usualSpendCents!).toBeGreaterThanOrEqual(noFood.fixedMonthlyCents);
    expect(withFood.cashCents).toBe(800000);
    expect(withFood.cashTypes).toEqual(["savings", "checking"]);
    expect(withFood.bufferMonths).toBeCloseTo(800000 / withFood.usualSpendCents!, 6);
    expect(withFood.advice).toContain("Säästö- ja käyttötileillä on");
    // a checking balance alone is a buffer too
    const checkingOnly = reports(dataset(), [account("acc-1", "checking", 500000)]).buffer;
    expect(checkingOnly.bufferMonths).toBeCloseTo(500000 / checkingOnly.usualSpendCents!, 6);
    expect(checkingOnly.advice).toContain("Käyttötileillä on");
    // a card in debt and a loan are not cash
    const withDebts = reports(dataset(), [account("sav", "savings", 300000), account("card", "credit_card", -80000), account("loan", "loan", -9000000)]).buffer;
    expect(withDebts.cashCents).toBe(300000);
  });

  it("the month in progress is not part of the usual spending", () => {
    const before = reports(dataset(), [account("sav", "savings", 300000)]).buffer.usualSpendCents;
    const big = tx({ bookingDate: "2026-10-05", amountCents: -400000, category: "home", merchant: "Isompi Kauppa" });
    expect(reports([...dataset(), big], [account("sav", "savings", 300000)]).buffer.usualSpendCents).toBe(before);
  });

  it("no buffer without a balance, no usual level under three whole months, nothing without fixed costs", () => {
    const none = reports(dataset()).buffer;
    expect(none.bufferMonths).toBeNull();
    expect(none.cashCents).toBeNull();
    // a card or loan balance alone is no buffer
    expect(reports(dataset(), [account("card", "credit_card", -80000)]).buffer.cashCents).toBeNull();
    // two months of history: no income level, no share, and the buffer says when it will show
    const short = reports(dataset().filter((t) => t.bookingDate >= "2026-08-01"), [account("sav", "savings", 300000)]).buffer;
    expect(short.fixedShare).toBeNull();
    expect(short.usualSpendCents).toBeNull();
    expect(short.bufferMonths).toBeNull();
    expect(short.advice).toContain("Puskurin pituus näkyy 1.11.2026.");
    expect(reports(monthly("2025-09", 13, 40000)).buffer.advice).toBe("");
    // without fixed costs the buffer still reads from the spending
    const food = reports(monthly("2025-09", 13, 40000), [account("acc-1", "checking", 500000)]).buffer;
    expect(food.usualSpendCents).toBe(40000);
    expect(food.bufferMonths).toBeCloseTo(12.5, 6);
    expect(food.advice).not.toContain("Kiinteät menot");
  });
});

describe("a running month in the cash flow", () => {
  it("the margin is told from the months that ended, the running month has its bills but not yet its salary", () => {
    const ctx = createContext(dataset().filter((t) => t.bookingDate <= "2026-10-09"), [checking], today);
    const run = buildReports({ ctx, range: { from: "2026-01-01", to: today }, balances: [] }).cashflow;
    expect(run.running).toBe(true);
    const ended = run.rows.filter((x) => x.month < "2026-10");
    expect(run.closed!.incomeCents).toBe(ended.reduce((s, x) => s + x.incomeCents, 0));
    expect(run.closed!.netCents).toBe(ended.reduce((s, x) => s + x.netCents, 0));
    expect(run.totals.netCents).toBe(run.rows.reduce((s, x) => s + x.netCents, 0));
    const past = buildReports({ ctx, range: { from: "2026-01-01", to: "2026-09-30" }, balances: [] }).cashflow;
    expect(past).toMatchObject({ running: false, closed: null });
    // the running month alone has nothing that ended
    expect(buildReports({ ctx, range: { from: "2026-10-01", to: today }, balances: [] }).cashflow.closed).toBeNull();
  });

  it("each row says what stayed on the accounts and whether the month is complete, and the closed totals leave out the partial ones", () => {
    // the history starts on 20.9.2025: that month is partial, like the running one
    const ctx = createContext(dataset().filter((t) => t.bookingDate >= "2025-09-20"), [checking], today);
    const cash = buildReports({ ctx, range: { from: "2025-09-01", to: today }, balances: [] }).cashflow;
    expect(cash.rows.map((x) => x.complete)).toEqual([false, ...Array<boolean>(12).fill(true), false]);
    for (const x of cash.rows) expect(x.leftCents).toBe(x.incomeCents - x.consumptionCents - x.debtCents - x.savedCents);
    expect(cash.rows.reduce((s, x) => s + x.leftCents, 0)).toBe(cash.totals.leftCents);
    const whole = cash.rows.filter((x) => x.complete);
    expect(cash.closed!.incomeCents).toBe(whole.reduce((s, x) => s + x.incomeCents, 0));
    expect(cash.closed!.leftCents).toBe(whole.reduce((s, x) => s + x.leftCents, 0));
    expect(cash.average!.leftCents).toBe(Math.round(whole.reduce((s, x) => s + x.leftCents, 0) / whole.length));
  });
});

describe("one definition", () => {
  const ctx = createContext(dataset(), [checking], today);

  it("a complete month has ended and the history covers it from the 1st", () => {
    expect(isCompleteMonth(ctx, "2026-09")).toBe(true);
    expect(isCompleteMonth(ctx, "2025-09")).toBe(true);
    // the running month, a month before the history and one the history joins halfway
    expect(isCompleteMonth(ctx, "2026-10")).toBe(false);
    expect(isCompleteMonth(ctx, "2025-08")).toBe(false);
    const late = createContext(dataset().filter((t) => t.bookingDate >= "2025-09-10"), [checking], today);
    expect(isCompleteMonth(late, "2025-09")).toBe(false);
    expect(isCompleteMonth(late, "2025-10")).toBe(true);
    expect(isCompleteMonth(createContext([], [checking], today), "2026-09")).toBe(false);
  });

  it("the months before a month are the latest complete ones, oldest first, six at most", () => {
    expect(USUAL_MONTHS).toBe(6);
    expect(completeMonthsBefore(ctx, "2026-10")).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(completeMonthsBefore(ctx, "2026-10", 2)).toEqual(["2026-08", "2026-09"]);
    expect(completeMonthsBefore(ctx, "2025-12")).toEqual(["2025-09", "2025-10", "2025-11"]);
    expect(completeMonthsBefore(ctx, "2025-09")).toEqual([]);
    // a month that has not begun has no complete months right before it
    expect(completeMonthsBefore(ctx, "2026-12")).toEqual([]);
  });

  describe("fixed costs and subscriptions", () => {
    const steady = [
      ...monthlyOn("2025-09", 25, 14, () => 300000, { category: "salary", merchant: "Acme Oy" }),
      ...monthlyOn("2025-09", 2, 14, () => -105000, { category: "housing", merchant: "Sato Oyj" }),
      ...monthlyOn("2025-09", 5, 14, () => -25000, { category: "loans", merchant: "Nordea Rahoitus Suomi Oy" }),
      ...monthlyOn("2025-09", 12, 14, () => -1199, { category: "subscriptions", merchant: "Spotify" }),
      ...monthlyOn("2025-09", 6, 14, () => -20000, { category: "investments", merchant: "Nordnet" }),
      ...series("2025-09-01", 3.5, 115, (i) => -(2000 + (i % 7) * 900), { category: "groceries", merchant: "K-Market" }),
    ].filter((t) => t.bookingDate <= today);
    const steadyCtx = createContext(steady, [checking], today);
    const range = { from: "2026-01-01", to: "2026-09-30" };

    it("the monthly figure is the sum of the split: spending and debt service, saving left out", () => {
      const split = fixedSplit(steadyCtx.recurring);
      expect(split).toEqual({ consumptionCents: 105000 + 1199, debtCents: 25000, savingsCents: 20000 });
      expect(fixedMonthlyCents(steadyCtx.recurring)).toBe(split.consumptionCents + split.debtCents);
    });

    it("a steady complete month has that figure in the report column, the buffer and the overview", () => {
      const fixed = fixedMonthlyCents(steadyCtx.recurring);
      const r = buildReports({ ctx: steadyCtx, range, balances: [] });
      expect(r.fixedVariable.rows).toHaveLength(9);
      for (const row of r.fixedVariable.rows) expect(row.fixedCents, row.month).toBe(fixed);
      // the instalment is inside the fixed column, so nothing is left for the debt column
      expect(r.fixedVariable.totals.debtCents).toBe(0);
      expect(r.buffer.fixedMonthlyCents).toBe(fixed);
      expect(buildDashboard(steadyCtx, range).fixedMonthlyCents).toBe(fixed);
    });

    it("a subscription marked as cancelled leaves the fixed costs of the buffer and the overview alike", () => {
      const inputs = { marks: [{ subject: "merchant:Spotify", mark: "cancelled" as const, markedAt: "2026-10-01T10:00:00Z" }], expectedBills: [] };
      const fixed = fixedMonthlyCents(steadyCtx.recurring);
      const r = buildReports({ ctx: steadyCtx, range, balances: [], inputs });
      expect(r.buffer.fixedMonthlyCents).toBe(fixed - 1199);
      expect(buildDashboard(steadyCtx, range, [], inputs).fixedMonthlyCents).toBe(fixed - 1199);
      // a mark on another merchant, or none, changes nothing
      expect(buildDashboard(steadyCtx, range, [], { marks: [{ ...inputs.marks[0]!, subject: "merchant:Nobody" }], expectedBills: [] }).fixedMonthlyCents).toBe(fixed);
    });

    it("the overview counts the signals of the data quality report it takes its notice from", () => {
      const d = buildDashboard(steadyCtx, range);
      const signals = buildReports({ ctx: steadyCtx, range, balances: [] }).dataQuality.signals;
      expect(d.dataSignals).toBe(signals.length);
      expect(d.dataNotice).toEqual(signals.find((x) => x.tone === "warning") ?? null);
    });

    it("debt service outside the fixed series stays in the debt column", () => {
      const extra = tx({ bookingDate: "2026-05-20", amountCents: -4000, category: "loans", merchant: "Nordea Rahoitus Suomi Oy" });
      const r = buildReports({ ctx: createContext([...steady, extra], [checking], today), range, balances: [] });
      expect(r.fixedVariable.totals.debtCents).toBe(4000);
      const t = r.fixedVariable.totals;
      expect(t.fixedCents + t.habitCents + t.variableCents + t.debtCents).toBe(r.cashflow.totals.consumptionCents + r.cashflow.totals.debtCents);
    });

    it("a subscription is an active fixed-amount series of a service the household chose", () => {
      const byMerchant = (name: string) => steadyCtx.recurring.find((s) => s.merchant === name)!;
      expect(isSubscription(byMerchant("Spotify"))).toBe(true);
      // rent and a loan are contracts: fixed costs, not subscriptions
      expect(isSubscription(byMerchant("Sato Oyj"))).toBe(false);
      expect(isSubscription(byMerchant("Nordea Rahoitus Suomi Oy"))).toBe(false);
      expect(isSubscription({ ...byMerchant("Spotify"), active: false })).toBe(false);
      expect(isSubscription({ ...byMerchant("Spotify"), kind: "bill" })).toBe(false);
      expect(subscriptionsMonthlyCents(steadyCtx.recurring)).toBe(1199);
      expect(subscriptionsMonthlyCents(steadyCtx.recurring, new Set(["Spotify"]))).toBe(0);
      // the review question is asked about the same categories
      expect([...SUBSCRIPTION_CATEGORIES].sort()).toEqual(["education", "entertainment", "fitness", "other", "shopping", "subscriptions"]);
    });
  });

  describe("savings", () => {
    const flow = (f: Partial<Flows>): Flows => ({ consumption: 0, debt: 0, saved: 0, income: 0, borrowed: 0, ...f });

    it("the savings rate is saved over income, and what stayed on the accounts is the rest", () => {
      const t = totalsOf([flow({ income: 300000 }), flow({ consumption: 100000 }), flow({ debt: 20000 }), flow({ saved: 50000 })]);
      expect(t.savingsRate).toBeCloseTo(50000 / 300000, 10);
      expect(t.leftCents).toBe(300000 - 120000 - 50000);
      // the margin before saving is unchanged
      expect(t.netCents).toBe(180000);
      expect(t.netCents - t.savedCents).toBe(t.leftCents);
    });

    it("money taken out of savings is a negative rate, and no income gives none", () => {
      expect(totalsOf([flow({ income: 100000 }), flow({ saved: -20000 })]).savingsRate).toBeCloseTo(-0.2, 10);
      expect(totalsOf([flow({ consumption: 1000 }), flow({ saved: 500 })]).savingsRate).toBeNull();
    });

    it("the dashboard, the cash flow rows and the summary tell the same rate", () => {
      const range = { from: "2026-01-01", to: "2026-09-30" };
      const d = buildDashboard(ctx, range);
      expect(d.totals.savedCents).toBeGreaterThan(0);
      expect(d.totals.savingsRate).toBeCloseTo(d.totals.savedCents / d.totals.incomeCents, 10);
      const cash = buildReports({ ctx, range, balances: [] }).cashflow;
      expect(cash.totals.savingsRate).toBe(d.totals.savingsRate);
      for (const row of cash.rows) expect(row.savingsRate, row.month).toBeCloseTo(row.savedCents / row.incomeCents, 10);
    });

    it("settled leaves the running month out of a running range", () => {
      const running = createContext(dataset().filter((t) => t.bookingDate <= today), [checking], today);
      const upToNow = buildDashboard(running, { from: "2026-01-01", to: today });
      expect(upToNow.running).toBe(true);
      expect(upToNow.settled).toEqual(buildDashboard(running, { from: "2026-01-01", to: "2026-09-30" }).totals);
      // the running month has its bills and some of its income: the totals include it, settled does not
      expect(upToNow.totals.expenseCents).toBeGreaterThan(upToNow.settled!.expenseCents);
      // a range that has ended, and the running month alone, have none
      expect(buildDashboard(running, { from: "2026-01-01", to: "2026-09-30" }).settled).toBeNull();
      expect(buildDashboard(running, { from: "2026-10-01", to: today }).settled).toBeNull();
      // a range that starts inside a month leaves that month out: August 15 to today settles September alone
      expect(buildDashboard(running, { from: "2026-08-15", to: today }).settled).toEqual(buildDashboard(running, { from: "2026-09-01", to: "2026-09-30" }).totals);
    });

    it("settled leaves the first, partly fetched month out too", () => {
      const partly = createContext(dataset().filter((t) => t.bookingDate >= "2026-02-10"), [checking], today);
      const run = buildDashboard(partly, { from: "2026-01-01", to: today });
      expect(run.settled).toEqual(buildDashboard(partly, { from: "2026-03-01", to: "2026-09-30" }).totals);
    });
  });

  describe("expected bills", () => {
    const bill = (dueDate: string, cadence: ExpectedCadence) => ({ dueDate, cadence });

    it("a one-off bill has one date, inside the window or none", () => {
      expect(expectedDates(bill("2026-11-15", "once"), "2026-10-09", "2026-12-31")).toEqual(["2026-11-15"]);
      expect(expectedDates(bill("2026-10-09", "once"), "2026-10-09", "2026-10-09")).toEqual(["2026-10-09"]);
      expect(expectedDates(bill("2026-09-30", "once"), "2026-10-09", "2026-12-31")).toEqual([]);
      expect(expectedDates(bill("2027-01-01", "once"), "2026-10-09", "2026-12-31")).toEqual([]);
    });

    it("a repeating bill follows its cadence from its first due date", () => {
      expect(expectedDates(bill("2026-01-15", "quarterly"), "2026-10-09", "2027-04-30")).toEqual(["2026-10-15", "2027-01-15", "2027-04-15"]);
      expect(expectedDates(bill("2026-03-01", "semiannual"), "2026-01-01", "2027-12-31")).toEqual(["2026-03-01", "2026-09-01", "2027-03-01", "2027-09-01"]);
      // nothing before the first due date
      expect(expectedDates(bill("2027-02-01", "yearly"), "2026-01-01", "2027-01-31")).toEqual([]);
    });

    it("the day is clamped to the month and does not drift", () => {
      expect(expectedDates(bill("2026-01-31", "quarterly"), "2026-02-01", "2026-12-31")).toEqual(["2026-04-30", "2026-07-31", "2026-10-31"]);
      expect(expectedDates(bill("2024-02-29", "yearly"), "2026-01-01", "2028-12-31")).toEqual(["2026-02-28", "2027-02-28", "2028-02-29"]);
    });

    it("a bill typed in years ago is found without walking every date since", () => {
      expect(expectedDates(bill("1990-05-15", "yearly"), "2026-01-01", "2026-12-31")).toEqual(["2026-05-15"]);
      expect(expectedDates(bill("2000-01-01", "quarterly"), "2026-10-01", "2026-10-01")).toEqual(["2026-10-01"]);
    });
  });

  it("the averages of the reports divide by the same months", () => {
    const months = ["2026-07", "2026-08", "2026-09", "2026-10"].map(monthIndex);
    expect(fullMonths(ctx, { from: "2026-01-01", to: today }, months)).toEqual(months.slice(0, 3));
    // a range that ends mid-month leaves that month out too
    expect(fullMonths(ctx, { from: "2026-01-01", to: "2026-09-20" }, months)).toEqual(months.slice(0, 2));
  });
});

describe("balances and the total of the accounts", () => {
  const card: Account = { id: "card", name: "Kortti", iban: null, currency: "EUR", type: "credit_card" };
  const savings: Account = { id: "sav", name: "Säästötili", iban: null, currency: "EUR", type: "savings" };
  const given = (account: Account, balanceCents: number | null, balanceAt: string | null = null): BalanceInput => ({
    id: account.id, name: account.name, type: account.type, balanceCents, ownerName: null, balanceAt,
  });
  const run = (rows: Transaction[], accounts: Account[], balances: BalanceInput[], range = { from: "2026-05-01", to: "2026-10-09" }) =>
    buildReports({ ctx: createContext(rows, accounts, today), range, balances }).balances;
  const rows = [
    ...monthlyOn("2026-05", 3, 6, () => -50000, { accountId: "acc-1" }),
    ...monthlyOn("2026-05", 10, 5, () => -20000, { accountId: "card", category: "groceries" }),
    tx({ accountId: "sav", bookingDate: "2026-07-15", amountCents: 100000, category: "investments", isTransfer: true }),
  ];
  const balances = [given(checking, 200000), given(card, -80000), given(savings, 300000)];

  it("the total is the sum of the accounts at every month end, a card in debt taking from it", () => {
    const r = run(rows, [checking, card, savings], balances);
    expect(r.total).toHaveLength(r.months.length);
    r.total.forEach((total, m) => {
      const values = r.accounts.map((a) => a.values[m]).filter((v): v is number => v !== null);
      expect(total, r.months[m]).toBe(values.length ? values.reduce((s, v) => s + v, 0) : null);
    });
    // the month in progress is today: the balances as given, 2 000 € and 3 000 € less the card's 800 €
    expect(r.total.at(-1)).toBe(200000 - 80000 + 300000);
  });

  it("an account that has not started adds nothing to the months before its first transaction", () => {
    const r = run(rows, [checking, card, savings], balances);
    const sav = r.accounts.find((a) => a.accountId === "sav")!;
    const iJune = r.months.indexOf("2026-06");
    expect(sav.values[iJune]).toBeNull();
    expect(r.total[iJune]).toBe(r.accounts.filter((a) => a.accountId !== "sav").reduce((s, a) => s + a.values[iJune]!, 0));
    // no balance, no series, and no total from nothing
    expect(run(rows, [checking], [given(checking, null)]).total.every((v) => v === null)).toBe(true);
  });

  it("the walk starts at the day the balance was given: later rows are added, not taken off", () => {
    const own = [
      tx({ bookingDate: "2026-09-20", amountCents: -10000 }),
      tx({ bookingDate: "2026-10-02", amountCents: -4000 }),
      tx({ bookingDate: "2026-10-07", amountCents: -3000 }),
    ];
    const septOct = { from: "2026-09-01", to: "2026-10-09" };
    const dated = run(own, [checking], [given(checking, 100000, "2026-10-05T08:00:00.000Z")], septOct);
    expect(dated.accounts[0]!.asOf).toBe("2026-10-05");
    // the 7th is not in the balance of the 5th, so it counts on top; the 2nd is in it and comes off for September
    expect(dated.accounts[0]!.values).toEqual([100000 + 4000, 100000 - 3000]);
    // without a date the balance is today's and everything after a month end is taken off
    const undated = run(own, [checking], [given(checking, 100000)], septOct);
    expect(undated.accounts[0]!.asOf).toBe(today);
    expect(undated.accounts[0]!.values).toEqual([100000 + 7000, 100000]);
    // a balance dated after today stands for today
    expect(run(own, [checking], [given(checking, 100000, "2026-12-01T00:00:00.000Z")], septOct).accounts[0]!.asOf).toBe(today);
  });

  it("an account with a balance and no transactions is known from the day the balance was given", () => {
    const empty: Account = { id: "empty", name: "Tyhjä", iban: null, currency: "EUR", type: "savings" };
    const r = run([], [empty], [given(empty, 50000, "2026-10-05T08:00:00.000Z")], { from: "2026-09-01", to: "2026-10-09" });
    expect(r.accounts[0]!.values).toEqual([null, 50000]);
    expect(r.total).toEqual([null, 50000]);
  });
});
