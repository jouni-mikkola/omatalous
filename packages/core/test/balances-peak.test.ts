/**
 * Saldot: the highest balance the answer names is a day of the line the chart draws. A card known only from a late day
 * leaves the early days of the line unknown, while the month ends still add up the accounts that had started.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { dayNumber, fromDayNumber } from "../src/dates.ts";
import { buildReports } from "../src/reports/index.ts";
import type { Account } from "../src/types.ts";
import { dataset } from "./report-dataset.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const card: Account = { id: "acc-6", name: "Myöhäinen kortti", iban: null, currency: "EUR", type: "credit_card" };
const today = "2026-10-09";
const main = { id: "acc-1", name: "Käyttötili", type: "checking" as const, balanceCents: 123_456, ownerName: null, balanceAt: null };
const lateCard = { id: "acc-6", name: "Myöhäinen kortti", type: "credit_card" as const, balanceCents: -500_000, ownerName: null, balanceAt: null };

describe("Saldot: the peak and the line of the chart", () => {
  const range = { from: "2026-01-01", to: today };
  const ctx = createContext(dataset(), [checking, card], today);
  const r = buildReports({ ctx, range, balances: [main, lateCard] }, ["balances"]).balances;
  const known = r.daily.cents.flatMap((cents, i) => (cents === null ? [] : [{ cents, day: fromDayNumber(dayNumber(r.daily.from) + i) }]));

  it("has month ends from before the card was known that the line does not reach", () => {
    // the line starts on the day the card is known, the month ends before it are the checking account alone
    expect(known.length).toBeGreaterThan(0);
    expect(known[0]!.day > `${r.months[1]}-01`).toBe(true);
    const earlier = r.total.slice(0, -1).filter((c): c is number => c !== null);
    expect(earlier.length).toBeGreaterThan(0);
    expect(Math.max(...earlier)).toBeGreaterThan(Math.max(...known.map((k) => k.cents)));
  });

  it("is the first day of the highest value of the chart's line, with that value", () => {
    const highest = Math.max(...known.map((k) => k.cents));
    expect(r.peak).toEqual({ day: known.find((k) => k.cents === highest)!.day, cents: highest });
  });

  it("is null when the line has no known day", () => {
    const none = buildReports({ ctx, range, balances: [] }, ["balances"]).balances;
    expect(none.peak).toBeNull();
  });
});
