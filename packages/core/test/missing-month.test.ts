/**
 * A month the bank or the file missed is no month at 0 €. When an account in daily use has no row at all in one month
 * between rows before and after it, that month is not complete: the averages and the usual level leave it out. A card
 * used now and then, a small account and an account left unused for a while have quiet months that are real.
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
const B: Account = { id: "acc-2", name: "Toinen tili", iban: null, currency: "EUR", type: "checking" };
const C: Account = { id: "card-1", name: "Luottokortti", iban: null, currency: "EUR", type: "credit_card" };

/** Groceries every third day on the account from `from` to today, 10 euros each. */
const filler = (accountId: string, from: string, cents = 1000): Transaction[] =>
  series(from, 3, Math.floor((Date.parse(today) - Date.parse(from)) / 864e5 / 3) + 1, -cents, { accountId, merchant: "K-Market", category: "groceries", categorySource: "rule" });

const without = (rows: Transaction[], ...months: string[]) => rows.filter((t) => !months.some((m) => t.bookingDate.startsWith(m)));

describe("a month with no row on an account in daily use", () => {
  it("is not complete, for the household or for that account", () => {
    const ctx = createContext(without(filler("acc-1", "2025-11-01"), "2026-07"), [A], today);
    expect(isCompleteMonth(ctx, "2026-07")).toBe(false);
    expect(isCompleteMonth(ctx, "2026-07", ["acc-1"])).toBe(false);
    expect(isCompleteMonth(ctx, "2026-06")).toBe(true);
    // the usual level is read from the whole months on both sides of it, for the household and for the account
    const around = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-08", "2026-09"];
    expect(completeMonthsBefore(ctx, "2026-10")).toEqual(around);
    expect(completeMonthsBefore(ctx, "2026-10", 6, ["acc-1"])).toEqual(around);
  });

  it("is left out of the monthly average of the spending report", () => {
    const ctx = createContext(without(filler("acc-1", "2025-11-01"), "2026-07"), [A], today);
    const report = categoryReport(ctx, { from: "2025-11-01", to: "2026-10-31" });
    const groceries = report.groups.flatMap((g) => g.categories).find((c) => c.category === "groceries")!;
    // the ten complete months of about 100 euros, not eleven with one at 0 €
    expect(groceries.averageMonths).toBe(10);
    expect(groceries.monthlyAvgCents).toBeGreaterThanOrEqual(9000);
  });

  it("skips one run of missing months and stops at the second", () => {
    const ctx = createContext(without(filler("acc-1", "2024-11-01"), "2026-02", "2026-07", "2026-08"), [A], today);
    expect(isCompleteMonth(ctx, "2026-08")).toBe(false);
    expect(completeMonthsBefore(ctx, "2026-10")).toEqual(["2026-03", "2026-04", "2026-05", "2026-06", "2026-09"]);
  });
});

describe("a quiet month that is real", () => {
  it("on a card used in seven months of twelve", () => {
    const card = ["2025-11", "2025-12", "2026-02", "2026-04", "2026-06", "2026-08", "2026-09"].flatMap((m) =>
      series(`${m}-05`, 1, 9, -500, { accountId: "card-1", merchant: "Tokmanni", category: "shopping", categorySource: "rule" }),
    );
    const ctx = createContext([...filler("acc-1", "2025-11-01"), ...card], [A, C], today);
    expect(isCompleteMonth(ctx, "2026-07")).toBe(true);
    expect(isCompleteMonth(ctx, "2026-07", ["card-1"])).toBe(true);
  });

  it("on an account left unused for three months", () => {
    const ctx = createContext(without(filler("acc-1", "2025-11-01"), "2026-05", "2026-06", "2026-07"), [A], today);
    expect(isCompleteMonth(ctx, "2026-06")).toBe(true);
  });

  it("for the household when the account that misses it carries a small share of the spending", () => {
    // the second account spends a twentieth of the first: its missing month is its own
    const ctx = createContext([...filler("acc-1", "2025-11-01", 2000), ...without(filler("acc-2", "2025-11-01", 100), "2026-07")], [A, B], today);
    expect(isCompleteMonth(ctx, "2026-07")).toBe(true);
    expect(isCompleteMonth(ctx, "2026-07", ["acc-2"])).toBe(false);
  });
});
