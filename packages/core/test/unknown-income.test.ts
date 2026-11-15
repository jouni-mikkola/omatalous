/**
 * Money in that nothing has told yet (a default Muut tulot row) is no earned income until the user answers
 * (analysis/income.ts `incomeTypeOf`): it stays out of the usual income, the gates read from it and the earned total,
 * and Tulot and Tulojen käyttö give its share of the same window as one figure.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { incomeBase, passes } from "../src/analysis/income-series.ts";
import { expectedIncome } from "../src/analysis/expected.ts";
import { incomeChanges, incomeInsights } from "../src/analysis/income-changes.ts";
import { addMonths, dateIn } from "../src/dates.ts";
import { type Account, NO_INPUTS, type Transaction } from "../src/types.ts";
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


describe("unknown money in", () => {
  const unknown = createContext(household("default"), [checking], today);
  const told = createContext(household("rule"), [checking], today);

  it("stays out of the usual income until the user says what it is", () => {
    expect(expectedIncome(unknown, "2026-10")).toBe(300_000);
    expect(expectedIncome(told, "2026-10")).toBe(400_000);
  });

  it("stays out of the gate the income views read from the usual income", () => {
    // 2 % of 3 000 € is 60 €, of 4 000 € 80 €
    expect(passes(incomeBase(unknown, today), 7000)).toBe(true);
    expect(passes(incomeBase(told, today), 7000)).toBe(false);
  });

  /** Salary from 2025-10 to 2026-10 and two rows from one sender in the last 92 days. */
  function sender(source: Transaction["categorySource"], category: string): Transaction[] {
    const rows = household("rule").filter((t) => t.merchant !== "Matti Esimerkki");
    return [
      ...rows,
      tx({ bookingDate: "2026-08-12", amountCents: 140_000, merchant: "Osto Oy", category, categorySource: source }),
      tx({ bookingDate: "2026-09-12", amountCents: 200_000, merchant: "Osto Oy", category, categorySource: source }),
    ];
  }
  const newOf = (rows: Transaction[]) => {
    const ctx = createContext(rows, [checking], today);
    return {
      changes: incomeChanges(incomeBase(ctx, today), true).filter((c) => c.kind === "new_source"),
      insights: incomeInsights(ctx, { from: "2025-10-01", to: today }, NO_INPUTS).filter((i) => i.fact.type === "income" && i.fact.change === "new_source"),
    };
  };

  it("gives no new source and no insight for two untold rows from one sender", () => {
    const found = newOf(sender("default", "income"));
    expect(found.changes).toEqual([]);
    expect(found.insights).toEqual([]);
  });

  it("gives the new source once the user has typed the same rows", () => {
    const found = newOf(sender("rule", "sales"));
    expect(found.changes.map((c) => c.payer)).toEqual(["Osto Oy"]);
    expect(found.insights).toHaveLength(1);
  });

});
