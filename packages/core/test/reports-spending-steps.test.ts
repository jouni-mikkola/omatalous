/**
 * The steps of Menot kategorioittain from the usual month to a month's spending, on the same made-up household as reports.test.ts.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { gateFor } from "../src/analysis/usual.ts";
import { buildReports } from "../src/reports/index.ts";
import type { Account } from "../src/types.ts";
import { tx } from "./helpers.ts";
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
      // the named steps are a category's whole gap, the rises first, and the rest is one last step that is there only when it is not zero
      const named = c.steps.filter((st) => st.category !== null);
      expect(named).toEqual(c.steps.slice(0, named.length));
      expect(named.length).toBeLessThanOrEqual(5);
      expect(c.steps.length - named.length).toBeLessThanOrEqual(1);
      for (const st of c.steps.slice(named.length)) expect(st).toMatchObject({ category: null, label: null });
      for (const st of c.steps) expect(st.cents).not.toBe(0);
      for (const st of named) expect(st.cents).toBe(s.categories.find((x) => x.category === st.category)!.values[i]! - s.categories.find((x) => x.category === st.category)!.typicalCents!);
      expect(named.map((st) => st.cents)).toEqual([...named.map((st) => st.cents)].sort((a, b) => b - a));
    }
    // the newest complete month's step is the category's lastDiffCents, and it is off its level when the gap passes the gate
    for (const st of s.changes[s.last!]!.steps.filter((x) => x.category !== null)) expect(st.cents).toBe(s.categories.find((x) => x.category === st.category)!.lastDiffCents);
    for (const c of s.categories) expect(c.lastOff).toBe(Math.abs(c.lastDiffCents!) >= gateFor(c.typicalCents!));
    // a month that has not ended, or that the levels do not read, has no steps
    expect(s.changes.every((c, i) => c === null || s.complete[i])).toBe(true);
    const short = buildReports({ ctx, range: { from: "2026-08-01", to: "2026-10-31" }, balances: [] }, ["spendingMonths"]).spendingMonths;
    expect(short.changes.every((c) => c === null)).toBe(true);
  });
});

describe("reports: the two usual figures of Menot kategorioittain", () => {
  const savings: Account = { id: "acc-2", name: "Säästötili", iban: null, currency: "EUR", type: "savings" };
  const MONTHS = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
  const GROCERIES = 30_000;
  const INSTALMENT = 40_000;
  // every month pays a loan instalment from the savings account: a category level, but no part of the month's Menot
  const rows = MONTHS.flatMap((month) => [
    tx({ bookingDate: `${month}-05`, amountCents: 300_000, merchant: "Acme Oy", category: "salary" }),
    tx({ bookingDate: `${month}-02`, amountCents: -20_000, merchant: "Prisma", category: "groceries" }),
    tx({ bookingDate: `${month}-10`, amountCents: -10_000, merchant: "Prisma", category: "groceries" }),
    tx({ bookingDate: `${month}-06`, amountCents: -50_000, merchant: "Oma siirto", category: "transfer", isTransfer: true }),
    tx({ bookingDate: `${month}-06`, amountCents: 50_000, accountId: "acc-2", merchant: "Oma siirto", category: "transfer", isTransfer: true }),
    tx({ bookingDate: `${month}-09`, amountCents: -INSTALMENT, accountId: "acc-2", merchant: "Esimerkkipankki Oyj", category: "mortgage" }),
  ]);
  const s = buildReports({ ctx: createContext(rows, [checking, savings], today), range: { from: "2026-04-01", to: today }, balances: [] }, ["spendingMonths"]).spendingMonths;

  it("the usual month of the steps (the categories' levels added up) is not the line of the months (Menot) when a debt is paid from savings", () => {
    const steps = s.changes[s.last!]!;
    // each has its own label on the page: Kategoriat keskimäärin kuussa and Tavallinen kuukausi
    expect(steps.startCents).toBe(GROCERIES + INSTALMENT);
    expect(s.typicalFlowCents).toBe(GROCERIES);
    expect(steps.startCents).not.toBe(s.typicalFlowCents);
  });

  it("the steps still lie from their own start to the month's spending, the debt included", () => {
    const steps = s.changes[s.last!]!;
    expect(steps.endCents).toBe(s.totals[s.last!]);
    expect(steps.startCents + steps.steps.reduce((sum, st) => sum + st.cents, 0)).toBe(steps.endCents);
  });
});
