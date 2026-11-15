/**
 * One definition of a complete month for income (`isCompleteIncomeMonth`): the base of the usual earned income
 * (`expectedIncome`), the months the regular income median reads and the income report's `complete` flag agree on a
 * month that is incomplete for spending only, such as the month a credit card was linked in. Made-up household.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { expectedIncome } from "../src/analysis/expected.ts";
import { completeIncomeMonthsBefore, completeMonthsBefore, isCompleteIncomeMonth, isCompleteMonth } from "../src/analysis/usual.ts";
import { addMonths, dateIn } from "../src/dates.ts";
import { incomeReport, regularIncomeMonths } from "../src/reports/income.ts";
import type { Account, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking", bank: "Pankki" };
const card: Account = { id: "card-1", name: "Luottokortti", iban: null, currency: "EUR", type: "credit_card", bank: "Pankki" };
const TODAY = "2026-12-05";
const RANGE = { from: "2025-12-01", to: "2026-11-30" };

const monthly = (first: string, last: string, cents: number, merchant: string, category: string, accountId: string, day: number): Transaction[] => {
  const out: Transaction[] = [];
  for (let m = first; m <= last; m = addMonths(m, 1)) out.push(tx({ bookingDate: dateIn(m, day), amountCents: cents, merchant, counterparty: merchant, category, categorySource: "rule", accountId }));
  return out;
};

// the card joins on 10 September and carries far more than a tenth of the spending, so September is incomplete for spending
const ctx = createContext(
  [
    ...monthly("2025-12", "2026-11", 250_000, "Acme Oy", "salary", "acc-1", 5),
    ...monthly("2025-12", "2026-11", -90_000, "Asunto Oy Esimerkki", "housing", "acc-1", 2),
    ...monthly("2026-09", "2026-11", -60_000, "Vaateliike", "shopping", "card-1", 12),
  ],
  [checking, card],
  TODAY,
);
const BASE = ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"];

describe("the month a card was linked in", () => {
  it("is incomplete for spending and complete for income", () => {
    expect(isCompleteMonth(ctx, "2026-09")).toBe(false);
    expect(isCompleteIncomeMonth(ctx, "2026-09")).toBe(true);
    expect(completeMonthsBefore(ctx, "2026-12")).toEqual(["2026-10", "2026-11"]);
  });

  it("is in the base of the usual earned income", () => {
    expect(completeIncomeMonthsBefore(ctx, "2026-12")).toEqual(BASE);
    expect(expectedIncome(ctx, "2026-12")).toBe(250_000);
  });

  it("is in the months of the regular income median and complete in the report", () => {
    expect(regularIncomeMonths(ctx, RANGE).map((m) => m.month)).toEqual(BASE);
    const months = incomeReport(ctx, RANGE).months;
    for (const month of BASE) expect(months.find((m) => m.month === month)?.complete, month).toBe(true);
  });

  it("gives every income figure the same months", () => {
    for (const month of BASE) expect(isCompleteIncomeMonth(ctx, month), month).toBe(true);
    const report = incomeReport(ctx, RANGE);
    expect(report.months.find((m) => m.month === "2026-11")?.usualCents).toBe(expectedIncome(ctx, "2026-11"));
  });
});
