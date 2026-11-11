/**
 * The year picker of Vuosivertailu: the years it offers (`comparisonYears`), the range a picked year asks
 * (`comparisonYearRange`), and what the year report then says. Made-up data: five years of groceries on one account,
 * each year's month 100 € dearer than the year before, and a restaurant month that stays the same.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { buildReports, comparisonYearRange, comparisonYears } from "../src/reports/index.ts";
import type { Account, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const today = "2026-10-09";
const FIRST = 2022;
const accounts: Account[] = [{ id: "a", name: "a", iban: null, currency: "EUR", type: "checking" }];
const DAYS = ["01", "10", "20", "28"];
/** A month of groceries in `year`, in cents: 400 € in 2022, 100 € more each year. Four equal visits. */
const groceries = (year: number) => (year - FIRST + 4) * 100_00;
const RESTAURANTS = 80_00;

const rows: Transaction[] = [];
for (let year = FIRST; year <= 2026; year++)
  for (let m = 1; m <= 12; m++)
    for (const d of DAYS) {
      const bookingDate = `${year}-${String(m).padStart(2, "0")}-${d}`;
      if (bookingDate > today) continue;
      rows.push(tx({ bookingDate, amountCents: -groceries(year) / DAYS.length, accountId: "a", category: "groceries", merchant: "K-Market" }));
      rows.push(tx({ bookingDate, amountCents: -RESTAURANTS / DAYS.length, accountId: "a", category: "restaurants", merchant: "Ravintola Esimerkki" }));
    }
const ctx = createContext(rows, accounts, today);
const pick = (year: number) => buildReports({ ctx, range: comparisonYearRange(year, today), balances: [] }).yearOverYear;

describe("the year picker of the year comparison", () => {
  it("offers every year that has the year before it, newest first", () => {
    const current = buildReports({ ctx, range: { from: "2026-01-01", to: today }, balances: [] }).yearOverYear;
    expect(current.dataFrom).toBe("2022-01");
    expect(comparisonYears(current.dataFrom, today)).toEqual([2026, 2025, 2024, 2023]);
    expect(comparisonYears(null, today)).toEqual([]);
    // a history that starts mid-year: the year after it is the first one to pick
    expect(comparisonYears("2024-07", today)).toEqual([2026, 2025]);
    expect(comparisonYears("2026-02", today)).toEqual([]);
  });

  it("asks an earlier year whole and the running year up to today", () => {
    expect(comparisonYearRange(2024, today)).toEqual({ from: "2024-01-01", to: "2024-12-31" });
    expect(comparisonYearRange(2026, today)).toEqual({ from: "2026-01-01", to: today });
  });

  it("gives each picked earlier year, all twelve months, against the year before it", () => {
    for (const year of [2025, 2024, 2023]) {
      const r = pick(year);
      expect(r.year).toBe(year);
      expect(r).toMatchObject({ comparable: true, comparableMonths: 12, partialMonth: null, leftOutAccounts: false, shortHistory: false });
      expect(r.comparedMonths).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      expect(r.ytdCents).toBe(12 * (groceries(year) + RESTAURANTS));
      expect(r.previousYtdCents).toBe(12 * (groceries(year - 1) + RESTAURANTS));
      expect(r.ytdChangeCents).toBe(12 * 100_00);
      expect(r.current).toEqual(Array(12).fill(groceries(year) + RESTAURANTS));
      expect(r.previous).toEqual(Array(12).fill(groceries(year - 1) + RESTAURANTS));
      expect(r.categories).toEqual([
        { category: "groceries", currentCents: 12 * groceries(year), previousCents: 12 * groceries(year - 1), changeCents: 12 * 100_00 },
        { category: "restaurants", currentCents: 12 * RESTAURANTS, previousCents: 12 * RESTAURANTS, changeCents: 0 },
      ]);
    }
  });

  it("gives the running year to the same day of the year before", () => {
    const r = pick(2026);
    expect(r).toMatchObject({ year: 2026, comparable: true, comparableMonths: 9, partialMonth: 10 });
    // nine whole months and the first of October's four visits, both years
    expect(r.ytdCents).toBe(9.25 * (groceries(2026) + RESTAURANTS));
    expect(r.previousYtdCents).toBe(9.25 * (groceries(2025) + RESTAURANTS));
  });

  it("does not compare the first year of the history: it has no year before it", () => {
    const r = pick(2022);
    expect(r).toMatchObject({ year: 2022, comparable: false, comparedMonths: [], categories: [] });
  });
});
