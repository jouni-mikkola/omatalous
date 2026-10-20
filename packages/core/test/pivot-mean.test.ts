/**
 * The monthly mean of Menot kuukausittain (reports/pivot.ts) and Kategoriat (reports/categories.ts): a category's mean
 * is over the complete months its own accounts cover, and says how many ("ka. N kk"). The mean times its months is the
 * sum of those months, so a card linked late gives its categories a short mean, never one diluted by months it has no
 * rows for.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { addMonths, dateIn, monthEnd } from "../src/dates.ts";
import { categoryReport } from "../src/reports/categories.ts";
import { pivotReport } from "../src/reports/pivot.ts";
import type { Account, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking", bank: "Pankki" };
const card: Account = { id: "card-1", name: "Luottokortti", iban: null, currency: "EUR", type: "credit_card", bank: "Pankki" };
const TODAY = "2026-12-05";
const RANGE = { from: "2025-12-01", to: monthEnd("2026-11") };

/** `cents` in all, spread over the months from `first` to November, on `accountId`, the last month taking the rounding. */
function spread(first: string, cents: number, category: string, accountId: string, day = 15): Transaction[] {
  const months: string[] = [];
  for (let m = first; m <= "2026-11"; m = addMonths(m, 1)) months.push(m);
  const each = Math.floor(cents / months.length);
  return months.map((m, i) => tx({ bookingDate: dateIn(m, day), amountCents: -(i === months.length - 1 ? cents - each * i : each), merchant: "Kauppa", category, categorySource: "rule", accountId }));
}

/** Rent on the 1st: the checking account is in the data from the first day of the range. */
const rent = spread("2025-12", 12 * 90_000, "housing", "acc-1", 1);

describe("a category's monthly mean", () => {
  it("527 € over the 12 months its account covers is 44 €/kk, ka. 12 kk", () => {
    const ctx = createContext([...rent, ...spread("2025-12", 52_700, "groceries", "acc-1")], [checking], TODAY);
    const row = pivotReport(ctx, RANGE).rows.find((r) => r.category === "groceries")!;
    expect(row.averageMonths).toBe(12);
    expect(row.averageCents).toBe(4392);
    const stat = categoryReport(ctx, RANGE).groups.flatMap((g) => g.categories).find((c) => c.category === "groceries")!;
    expect([stat.monthlyAvgCents, stat.averageMonths]).toEqual([4392, 12]);
  });

  it("a card that covers 2 months gives its category ka. 2 kk, and the checking account's keeps 12", () => {
    // the card's first row is on 10 September: September is not whole for it, October and November are
    const cardRows = [tx({ bookingDate: "2026-09-10", amountCents: -4_000, merchant: "Kauppa", category: "groceries", categorySource: "rule", accountId: "card-1" }), ...spread("2026-10", 52_700, "groceries", "card-1")];
    const ctx = createContext([...rent, ...cardRows], [checking, card], TODAY);
    const r = pivotReport(ctx, RANGE);
    const groceries = r.rows.find((x) => x.category === "groceries")!;
    expect(groceries.averageMonths).toBe(2);
    expect(groceries.averageCents).toBe(26_350);
    // mean × N is the sum of those N months
    const at = (m: string) => r.months.indexOf(m);
    expect(groceries.averageCents! * 2).toBe(groceries.values[at("2026-10")]! + groceries.values[at("2026-11")]!);
    const housing = r.rows.find((x) => x.category === "housing")!;
    expect([housing.averageCents, housing.averageMonths]).toEqual([90_000, 12]);
    const stat = categoryReport(ctx, RANGE).groups.flatMap((g) => g.categories).find((c) => c.category === "groceries")!;
    expect([stat.monthlyAvgCents, stat.averageMonths]).toEqual([26_350, 2]);
  });
});

describe("the shade of a month is set against the row's usual month, not its mean", () => {
  it("a row of 100 € months with one 400 € month: the dear month is shade 4 and the jump names the usual 100 €, where the mean says 125 €", () => {
    const rows = Array.from({ length: 12 }, (_, i) => {
      const m = addMonths("2025-12", i);
      return tx({ bookingDate: dateIn(m, 15), amountCents: -(m === "2026-08" ? 40_000 : 10_000), merchant: "Kauppa", category: "groceries", categorySource: "rule", accountId: "acc-1" });
    });
    const ctx = createContext([...rent, ...rows], [checking], TODAY);
    const r = pivotReport(ctx, RANGE);
    const row = r.rows.find((x) => x.category === "groceries")!;
    expect(row.usualCents).toBe(10_000);
    expect(row.averageCents).toBe(12_500);
    expect(r.jump).toMatchObject({ category: "groceries", cents: 40_000, usualCents: 10_000 });
  });

  it("near miss: a month 9 € over a 15 € usual is shade 4 and under the household's gate, so there is no jump", () => {
    const rows = Array.from({ length: 12 }, (_, i) => {
      const m = addMonths("2025-12", i);
      return tx({ bookingDate: dateIn(m, 15), amountCents: -(m === "2026-08" ? 2_400 : 1_500), merchant: "Kauppa", category: "groceries", categorySource: "rule", accountId: "acc-1" });
    });
    const ctx = createContext([...rent, ...rows], [checking], TODAY);
    expect(pivotReport(ctx, RANGE).jump).toBeNull();
  });
});

