/**
 * Money in that nothing has told yet (a default Muut tulot row) is no earned income until the user answers
 * (analysis/income.ts `incomeTypeOf`): it stays out of the usual income, the gates read from it and the earned total,
 * and Tulot and Tulojen käyttö give its share of the same window as one figure.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { incomeBase, passes } from "../src/analysis/income-series.ts";
import { usualIncome } from "../src/analysis/usual.ts";
import { addMonths, dateIn, monthEnd } from "../src/dates.ts";
import { buildReports } from "../src/reports/index.ts";
import type { Account, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const today = "2026-10-09";

/** From October 2025: 3 000 € of salary on the 15th, 1 000 € of untold money in on the 20th and rent on the 2nd. */
function household(source: Transaction["categorySource"]): Transaction[] {
  const out: Transaction[] = [];
  for (let m = "2025-10"; m <= "2026-10"; m = addMonths(m, 1)) {
    out.push(tx({ bookingDate: dateIn(m, 2), amountCents: -120_000, merchant: "Asunto Oy Esimerkki", category: "housing", categorySource: "rule" }));
    if (dateIn(m, 15) > today) continue;
    out.push(tx({ bookingDate: dateIn(m, 15), amountCents: 300_000, merchant: "Esimerkki Oy", description: "PALKKA", category: "salary", categorySource: "rule" }));
    if (dateIn(m, 20) <= today) out.push(tx({ bookingDate: dateIn(m, 20), amountCents: 100_000, merchant: "Matti Esimerkki", category: "income", categorySource: source }));
  }
  return out;
}

const year = { from: "2025-10-01", to: monthEnd("2026-09") };

describe("unknown money in", () => {
  const unknown = createContext(household("default"), [checking], today);
  const told = createContext(household("rule"), [checking], today);

  it("stays out of the usual income until the user says what it is", () => {
    expect(usualIncome(unknown, "2026-10")).toBe(300_000);
    expect(usualIncome(told, "2026-10")).toBe(400_000);
  });

  it("stays out of the gate the income views read from the usual income", () => {
    // 2 % of 3 000 € is 60 €, of 4 000 € 80 €
    expect(passes(incomeBase(unknown, today), 7000)).toBe(true);
    expect(passes(incomeBase(told, today), 7000)).toBe(false);
  });

  it("is no earned income in Tulot, and its share is one figure in Tulot and Tulojen käyttö", () => {
    const r = buildReports({ ctx: unknown, range: year, balances: [] });
    expect(r.income.earnedCents).toBe(12 * 300_000);
    expect(r.income.unknownCents).toBe(12 * 100_000);
    expect(r.income.window).toEqual(year);
    expect(r.income.unknownShare).toBe(0.25);
    expect(r.cashflow.unknownIncomeShare).toBe(r.income.unknownShare);
    const answered = buildReports({ ctx: told, range: year, balances: [] });
    expect(answered.income.earnedCents).toBe(12 * 400_000);
    expect([answered.income.unknownShare, answered.cashflow.unknownIncomeShare]).toEqual([0, 0]);
  });
});
