/**
 * Vuosivertailu sets the days of the period against the same days a year earlier: a period that ends mid-month holds
 * that month up to the same day in both years, in the year's figures and in the month by month lines.
 * Made-up data: groceries on the 2nd (100 €) and the 25th (200 €) of every month from January 2025.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { buildReports } from "../src/reports/index.ts";
import type { Account, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const account: Account = { id: "a", name: "a", iban: null, currency: "EUR", type: "checking" };

function rows(until: string): Transaction[] {
  const out: Transaction[] = [];
  for (const year of [2025, 2026]) {
    for (let month = 1; month <= 12; month++) {
      const mm = String(month).padStart(2, "0");
      for (const [day, cents] of [["02", -100_00], ["25", -200_00]] as const) {
        const bookingDate = `${year}-${mm}-${day}`;
        // last year is whole; this year has the days up to the cut
        if (year === 2025 || bookingDate <= until) out.push(tx({ bookingDate, amountCents: cents, accountId: "a", category: "groceries", merchant: "K-Market" }));
      }
    }
  }
  return out;
}

const yoy = (to: string, today = to) => buildReports({ ctx: createContext(rows(to), [account], today), range: { from: "2026-01-01", to }, balances: [] }).yearOverYear;

describe("Vuosivertailu with a period that ends mid-month", () => {
  const y = yoy("2026-09-14");

  it("holds the running month up to the same day a year earlier", () => {
    // 14.9.2026 has the 2nd only, so 14.9.2025 has the 2nd only: the 25th of last September is a later day
    expect(y.partialMonth).toBe(9);
    expect(y.current[8]).toBe(100_00);
    expect(y.previous[8]).toBe(100_00);
  });

  it("sums the year to date up to the same day in both years", () => {
    // January to August hold 300 € a month; September 100 €
    expect(y.ytdCents).toBe(8 * 300_00 + 100_00);
    expect(y.previousYtdCents).toBe(8 * 300_00 + 100_00);
    expect(y.ytdChangeCents).toBe(0);
  });

  it("keeps the months after the period whole, as the line to read against", () => {
    expect(y.previous[9]).toBe(300_00);
    expect(y.previous[11]).toBe(300_00);
    expect(y.current.slice(9)).toEqual([null, null, null]);
  });

  it("holds both years' whole month when the period ends on its last day", () => {
    const whole = yoy("2026-09-30", "2026-10-09");
    expect(whole.partialMonth).toBeNull();
    expect(whole.previous[8]).toBe(300_00);
    expect(whole.previousYtdCents).toBe(9 * 300_00);
    expect(whole.ytdCents).toBe(9 * 300_00);
  });

  it("moves the figures only by the days between the two cuts", () => {
    // the 25th is still ahead on 24.9.2026 and passed on 25.9.2026: last year's figure follows the same day
    expect(yoy("2026-09-24").previousYtdCents).toBe(8 * 300_00 + 100_00);
    expect(yoy("2026-09-25").previousYtdCents).toBe(9 * 300_00);
    expect(yoy("2026-09-25").ytdCents).toBe(9 * 300_00);
  });
});
