/**
 * A category's usual to the same day (design A2): Kuukausi sets what each category has cost on the month's days so far
 * against what it usually has by that day, and lists the largest gap first.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { expectedFor } from "../src/analysis/expected.ts";
import { usualToDay } from "../src/analysis/usual.ts";
import { addMonths, dateIn } from "../src/dates.ts";
import type { Account, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const today = "2026-11-09";

/** Twelve whole months, November 2025 to October 2026, and the nine first days of November 2026. */
function household(): Transaction[] {
  const out: Transaction[] = [];
  const spend = (m: string, day: number, cents: number, merchant: string, category: string) => out.push(tx({ bookingDate: dateIn(m, day), amountCents: -cents, merchant, category }));
  for (let m = "2025-11", i = 0; i < 12; m = addMonths(m, 1), i++) {
    spend(m, 1, 90_000, "Asunto Oy Esimerkki", "housing");
    // 100 € on the 3rd, 80 € on the 8th in turn with 120 €, and 100 € after the 9th: 200 € by the 9th on average
    spend(m, 3, 10_000, "Kauppa Esimerkki", "groceries");
    spend(m, 8, i % 2 ? 12_000 : 8_000, "Kauppa Esimerkki", "groceries");
    spend(m, 20, 10_000, "Kauppa Esimerkki", "groceries");
    spend(m, 5, 6_000, "Liikenne Esimerkki", "transport");
    spend(m, 15, 6_000, "Liikenne Esimerkki", "transport");
    // only after the 9th: no usual to day 9
    spend(m, 25, 4_000, "Ravintola Esimerkki", "restaurants");
    out.push(tx({ bookingDate: dateIn(m, 25), amountCents: 300_000, merchant: "Esimerkki Oy", category: "salary" }));
  }
  spend("2026-11", 1, 90_000, "Asunto Oy Esimerkki", "housing");
  spend("2026-11", 3, 18_000, "Kauppa Esimerkki", "groceries");
  spend("2026-11", 8, 15_000, "Kauppa Esimerkki", "groceries");
  spend("2026-11", 6, 2_500, "Ravintola Esimerkki", "restaurants");
  // nothing on transport yet
  return out;
}

describe("each category's usual to the same day", () => {
  const ctx = createContext(household(), [checking], today);
  const expected = expectedFor(ctx, "2026-11")!;
  const list = usualToDay(ctx, expected, 9);

  it("reads the usual from the six complete months before, by day 9", () => {
    expect(expected.months).toEqual(["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(list).toEqual([
      { category: "groceries", cents: 33_000, usualCents: 20_000, gapCents: 13_000 },
      { category: "restaurants", cents: 2_500, usualCents: 0, gapCents: 2_500 },
      { category: "housing", cents: 90_000, usualCents: 90_000, gapCents: 0 },
      { category: "transport", cents: 0, usualCents: 6_000, gapCents: -6_000 },
    ]);
  });

  it("is sorted by the gap, the largest first", () => {
    const gaps = list.map((c) => c.gapCents);
    expect(gaps).toEqual([...gaps].sort((a, b) => b - a));
  });

  it("adds up to the expected figure of the same day", () => {
    expect(list.reduce((sum, c) => sum + c.usualCents, 0)).toBe(expected.at(9).cents);
  });

  it("moves with the day: the whole month holds the days after the 9th", () => {
    const usual = (day: number) => Object.fromEntries(usualToDay(ctx, expected, day).map((c) => [c.category, c.usualCents]));
    expect(usual(2)).toEqual({ housing: 90_000 });
    expect(usual(31)).toEqual({ housing: 90_000, groceries: 30_000, transport: 12_000, restaurants: 4_000 });
  });

  it("stops at the month's end: the whole of a 30-day month holds no row of the 1st of the next", () => {
    const december = tx({ bookingDate: "2026-12-01", amountCents: -90_000, merchant: "Asunto Oy Esimerkki", category: "housing" });
    const later = createContext([...household(), december], [checking], "2026-12-02");
    const whole = usualToDay(later, expectedFor(later, "2026-11")!, 31);
    expect(whole.find((c) => c.category === "housing")).toEqual({ category: "housing", cents: 90_000, usualCents: 90_000, gapCents: 0 });
  });
});
