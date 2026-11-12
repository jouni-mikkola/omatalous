/**
 * A month the fetch or the export missed is no month without spending. When an account that pays its way every month
 * has no row at all in one month between rows before and after it, that month is not complete: the averages and the
 * usual level leave it out instead of reading it as 0 €. A card used now and then has quiet months that are real.
 * Made-up sums only.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { completeMonthsBefore, isCompleteMonth } from "../src/analysis/usual.ts";
import { categoryReport } from "../src/reports/categories.ts";
import type { Account, Transaction } from "../src/types.ts";
import { series } from "./helpers.ts";

const today = "2026-10-16";
const A: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const C: Account = { id: "card-1", name: "Luottokortti", iban: null, currency: "EUR", type: "credit_card" };

/** Groceries every third day on the account from `from` to today, 100 euros a month. */
const filler = (accountId: string, from: string): Transaction[] =>
  series(from, 3, Math.floor((Date.parse(today) - Date.parse(from)) / 864e5 / 3) + 1, -1000, { accountId, merchant: "K-Market", category: "groceries", categorySource: "rule" });

/** The checking account's rows with July 2026 missing, as a bank that failed to give one month sends them. */
const withHole = () => filler("acc-1", "2025-11-01").filter((t) => !t.bookingDate.startsWith("2026-07"));

describe("a month with no row on an account that pays every month", () => {
  it("is not complete, for the household or for that account", () => {
    const ctx = createContext(withHole(), [A], today);
    expect(isCompleteMonth(ctx, "2026-07")).toBe(false);
    expect(isCompleteMonth(ctx, "2026-07", ["acc-1"])).toBe(false);
    expect(isCompleteMonth(ctx, "2026-06")).toBe(true);
    // the usual level is read from the whole months on both sides of it
    expect(completeMonthsBefore(ctx, "2026-10")).toEqual(["2026-03", "2026-04", "2026-05", "2026-06", "2026-08", "2026-09"]);
  });

  it("is left out of the monthly average of the spending report", () => {
    const ctx = createContext(withHole(), [A], today);
    const report = categoryReport(ctx, { from: "2025-11-01", to: "2026-10-31" });
    const groceries = report.groups.flatMap((g) => g.categories).find((c) => c.category === "groceries")!;
    // the ten complete months of about 100 euros, not eleven with one at 0 €
    expect(groceries.averageMonths).toBe(10);
    expect(groceries.monthlyAvgCents).toBeGreaterThanOrEqual(9000);
  });

  it("is a real quiet month on a card used now and then", () => {
    // the card buys something in three months of the twelve; the checking account has every month
    const card = ["2025-12-05", "2026-03-05", "2026-09-05"].map((day) => series(day, 1, 1, -2500, { accountId: "card-1", merchant: "Tokmanni", category: "shopping", categorySource: "rule" })[0]!);
    const ctx = createContext([...filler("acc-1", "2025-11-01"), ...card], [A, C], today);
    expect(isCompleteMonth(ctx, "2026-07")).toBe(true);
    expect(isCompleteMonth(ctx, "2026-07", ["card-1"])).toBe(true);
  });
});
