/**
 * The steps of Menot kategorioittain from the usual month to a month's spending, on the same made-up household as reports.test.ts.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { gateFor } from "../src/analysis/usual.ts";
import { buildReports } from "../src/reports/index.ts";
import type { Account } from "../src/types.ts";
import { dataset } from "./report-dataset.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const today = "2026-10-09";

describe("reports: spending steps", () => {
  const ctx = createContext(dataset(), [checking], today);
  const range = { from: "2026-01-01", to: "2026-09-30" };
  const r = buildReports({ ctx, range, balances: [] });

  it("spending by month: the steps from the usual month add up to the month's spending, each one the category's gap to its level", () => {
    const s = r.spendingMonths;
    const levels = s.categories.reduce((sum, c) => sum + c.typicalCents!, 0);
    const withChange = s.changes.flatMap((c, i) => (c ? [{ c, i }] : []));
    expect(withChange.length).toBe(s.categoryMonths);
    for (const { c, i } of withChange) {
      // the month is a complete one, and the steps lie end to end from the usual month to the month's own spending
      expect(s.complete[i]).toBe(true);
      expect(c.startCents).toBe(levels);
      expect(c.endCents).toBe(s.totals[i]);
      expect(c.startCents + c.steps.reduce((sum, st) => sum + st.cents, 0)).toBe(c.endCents);
      c.steps.reduce((running, st) => {
        expect(st.fromCents).toBe(running);
        expect(st.toCents).toBe(running + st.cents);
        return st.toCents;
      }, c.startCents);
      // the named steps are a category's whole gap, the rises first, and the rest is one last step
      const named = c.steps.slice(0, -1);
      expect(named.length).toBeLessThanOrEqual(5);
      expect(c.steps.at(-1)).toMatchObject({ category: null, label: null });
      for (const st of named) expect(st.cents).toBe(s.categories.find((x) => x.category === st.category)!.values[i]! - s.categories.find((x) => x.category === st.category)!.typicalCents!);
      expect(named.map((st) => st.cents)).toEqual([...named.map((st) => st.cents)].sort((a, b) => b - a));
    }
    // the newest complete month's step is the category's lastDiffCents, and it is off its level when the gap passes the gate
    for (const st of s.changes[s.last!]!.steps.slice(0, -1)) expect(st.cents).toBe(s.categories.find((x) => x.category === st.category)!.lastDiffCents);
    for (const c of s.categories) expect(c.lastOff).toBe(Math.abs(c.lastDiffCents!) >= gateFor(c.typicalCents!));
    // a month that has not ended, or that the levels do not read, has no steps
    expect(s.changes.every((c, i) => c === null || s.complete[i])).toBe(true);
    const short = buildReports({ ctx, range: { from: "2026-08-01", to: "2026-10-31" }, balances: [] }, ["spendingMonths"]).spendingMonths;
    expect(short.changes.every((c) => c === null)).toBe(true);
  });
});
