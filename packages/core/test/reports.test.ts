import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { buildReports } from "../src/reports/index.ts";
import { addDays, addMonths } from "../src/dates.ts";
import type { Account, Transaction } from "../src/types.ts";
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
  const r = buildReports({ ctx, range, balances: [{ id: "acc-1", name: "Käyttötili", type: "checking", balanceCents: 123456 }] });

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

  it("splits consumption into fixed, habits and variable", () => {
    const t = r.fixedVariable.totals;
    expect(t.fixedCents + t.habitCents + t.variableCents).toBe(r.cashflow.totals.consumptionCents);
    expect(t.fixedCents).toBeGreaterThanOrEqual(9 * (105000 + 1199));
    expect(t.debtCents).toBe(9 * 25000);
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

  it("highlights: largest first, new merchants only if first seen in range and visited again", () => {
    expect(r.highlights.largest[0]!.cents).toBeGreaterThanOrEqual(r.highlights.largest[1]!.cents);
    // one visit is a purchase under the largest, not a new place
    expect(r.highlights.newMerchants.map((m) => m.merchant)).not.toContain("Uusi Kauppa");
    const again = [...dataset(), tx({ bookingDate: "2026-09-27", amountCents: -4500, category: "home", merchant: "Uusi Kauppa" })];
    const second = buildReports({ ctx: createContext(again, [checking], today), range, balances: [] });
    expect(second.highlights.newMerchants.map((m) => m.merchant)).toContain("Uusi Kauppa");
    expect(second.highlights.newMerchants.map((m) => m.merchant)).not.toContain("K-Market");
    // a subscription that started in the range is told as a new recurring payment, not as a new shop
    expect(second.highlights.newMerchants.map((m) => m.merchant)).not.toContain("Netflix");
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

  it("largest purchases skip known fixed costs like rent", () => {
    expect(r.highlights.largest.map((t) => t.merchant)).not.toContain("Sato Oyj");
    expect(r.highlights.largest[0]!.merchant).toBe("Finnair");
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

  it("a shop is new only well after the history starts, and a person is never a shop", () => {
    const rows = [...dataset(), tx({ bookingDate: "2026-09-12", amountCents: -2500, category: "p2p", merchant: "Laura Korhonen" })];
    const r = buildReports({ ctx: createContext(rows, [checking], today), range: { from: "2026-01-01", to: "2026-09-30" }, balances: [] });
    expect(r.highlights.newMerchants.map((m) => m.merchant)).not.toContain("Laura Korhonen");
    // the first month of the history: every shop is seen for the first time, none is news
    const first = buildReports({ ctx: createContext(rows, [checking], today), range: { from: "2025-09-01", to: "2025-09-30" }, balances: [] });
    expect(first.highlights.newMerchants).toEqual([]);
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
    expect(t.fixedCents + t.habitCents + t.variableCents).toBe(r.cashflow.totals.consumptionCents);
  });
});

describe("data quality signals", () => {
  const range = { from: "2026-08-01", to: "2026-10-09" };
  const ids = (txs: Transaction[], accounts: Account[] = [checking]) =>
    buildReports({ ctx: createContext(txs, accounts, today), range, balances: [] }).dataQuality.signals.map((s) => s.id);

  it("says nothing about a long, tidy history", () => {
    expect(ids(dataset())).toEqual([]);
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

  it("the largest purchases leave out taxes and insurance premiums", () => {
    const rows = [...dataset(), tx({ bookingDate: "2026-09-14", amountCents: -240000, category: "taxes", merchant: "Verohallinto" }), tx({ bookingDate: "2026-09-15", amountCents: -90000, category: "insurance", merchant: "If" })];
    const r = buildReports({ ctx: createContext(rows, [checking], today), range: { from: "2026-01-01", to: "2026-09-30" }, balances: [] });
    expect(r.highlights.largest.some((p) => p.merchant === "Verohallinto" || p.merchant === "If")).toBe(false);
  });
});


describe("upcoming bills, rising costs and the buffer", () => {
  const range = { from: "2026-01-01", to: "2026-09-30" };
  const reports = (rows: Transaction[], balances: { id: string; name: string; type: "checking" | "savings"; balanceCents: number | null }[] = []) =>
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
    expect(u.advice).toContain("yksi lasku");
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
    expect(buildReports({ ctx: createContext(short, [checking], today), range, balances: [] }).drift).toEqual({ months: [], items: [], advice: "" });
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

  it("fixed costs as a share of income, and the savings in months of them where a balance exists", () => {
    const b = reports(dataset(), [{ id: "sav", name: "Säästötili", type: "savings", balanceCents: 300000 }]).buffer;
    // rent 1 050 €, loan 250 € and the subscriptions, against 3 000 € of income
    expect(b.incomeMonthlyCents).toBe(300000);
    expect(b.fixedShare).toBeCloseTo(b.fixedMonthlyCents / 300000, 6);
    expect(b.fixedMonthlyCents).toBeGreaterThanOrEqual(130000);
    expect(b.bufferMonths).toBeCloseTo(300000 / b.fixedMonthlyCents, 6);
    // under three months: says how much is missing
    expect(b.bufferMonths!).toBeLessThan(3);
    expect(b.advice).toContain("puuttuu");
    expect(b.advice).toContain("% tuloista");
    const big = reports(dataset(), [{ id: "sav", name: "Säästötili", type: "savings", balanceCents: 900000 }]).buffer;
    expect(big.bufferMonths!).toBeGreaterThanOrEqual(3);
    expect(big.advice).toContain("Puskuri on riittävä");
  });

  it("no buffer without a savings balance, no share without three whole months of income, nothing without fixed costs", () => {
    expect(reports(dataset()).buffer.bufferMonths).toBeNull();
    expect(reports(dataset(), [{ id: "acc-1", name: "Käyttötili", type: "checking", balanceCents: 500000 }]).buffer.bufferMonths).toBeNull();
    const short = reports(dataset().filter((t) => t.bookingDate >= "2026-08-01")).buffer;
    expect(short.fixedShare).toBeNull();
    const none = reports(monthly("2025-09", 13, 40000)).buffer;
    expect(none.advice).toBe("");
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
});
