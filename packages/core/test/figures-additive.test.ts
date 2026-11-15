/**
 * The `additive` flag of the figure registry (`figures.ts`) is a promise: the figures of the members' own views add up to
 * the household's, to the cent, where the split of the joint account is said. Over invented households of two to four
 * members, each figure flagged additive is read in the household view and in every member's view and the members' sum is
 * held to the household's. A figure flagged additive needs a reader here, or the reason it has none.
 */
import { describe, expect, it } from "vitest";
import { viewsOf, type HouseholdView } from "../../../tools/findings/households.ts";
import { earnedIncome } from "../src/analysis/usual.ts";
import { addMonths, monthEnd, monthOf } from "../src/dates.ts";
import { FIGURES } from "../src/figures.ts";
import { buildHoldings } from "../src/holdings.ts";
import { cashflowReport } from "../src/reports/cashflow.ts";
import { NO_INPUTS } from "../src/types.ts";
import { generateHousehold } from "./kit/generate.ts";
import type { Spec } from "./kit/truth.ts";

const LONG = 120_000;

type FigureKey = keyof typeof FIGURES;
type Reader = (view: HouseholdView, today: string) => number | null;

const lastMonth = (today: string) => {
  const month = addMonths(monthOf(today), -1);
  return { month, range: { from: `${month}-01`, to: monthEnd(month) } };
};

const READERS: Partial<Record<FigureKey, Reader>> = {
  spending: (v, today) => cashflowReport(v.ctx, lastMonth(today).range).totals.expenseCents,
  consumption: (v, today) => cashflowReport(v.ctx, lastMonth(today).range).totals.consumptionCents,
  left: (v, today) => cashflowReport(v.ctx, lastMonth(today).range).totals.leftCents,
  saved: (v, today) => cashflowReport(v.ctx, lastMonth(today).range).totals.savedCents,
  income: (v, today) => cashflowReport(v.ctx, lastMonth(today).range).totals.incomeCents,
  earnedIncome: (v, today) => earnedIncome(v.ctx, lastMonth(today).month),
  netWorth: (v) => buildHoldings(v.ctx, v.balances, NO_INPUTS).netCents,
  cash: (v) => buildHoldings(v.ctx, v.balances, NO_INPUTS).accountsCents,
  periodLeft: (v, today) => cashflowReport(v.ctx, { from: `${addMonths(monthOf(today), -11)}-01`, to: today }).whole.leftCents,
};

/** Figures flagged additive that this file does not read, and where they are held. */
const ELSEWHERE: Partial<Record<FigureKey, string>> = {
  // a loan's payment is read at a part by each member: shared-additivity.test.ts adds the parts up to the household's
  loanMonthly: "shared-additivity.test.ts",
};

const SPECS: Spec[] = ([2, 3, 4] as const).flatMap((members) => (["joint", "checking"] as const).map((loan): Spec => ({ members, joint: "said", loan, cards: "connected" })));

describe("the figures flagged additive in the registry", () => {
  it("each have a reader here or name the test that holds them", () => {
    const additive = (Object.keys(FIGURES) as FigureKey[]).filter((k) => FIGURES[k].additive);
    const covered = [...Object.keys(READERS), ...Object.keys(ELSEWHERE)];
    expect(additive.sort()).toEqual(covered.sort());
  });

  it(
    "add up from the members' views to the household's view, to the cent, where the split is said",
    () => {
      for (const spec of SPECS) {
        const h = generateHousehold(spec, 1);
        const [household, ...members] = viewsOf(h);
        expect(members.length, h.name).toBe(spec.members);
        for (const [key, read] of Object.entries(READERS) as [FigureKey, Reader][]) {
          const whole = read(household!, h.today);
          // a figure nobody tells would pass by being empty
          expect(whole, `${h.name}: ${key} in the household`).not.toBeNull();
          const sum = members.reduce((total, v) => total + (read(v, h.today) ?? 0), 0);
          expect(sum, `${h.name}: ${key}, the members against the household`).toBe(whole);
        }
      }
    },
    LONG,
  );
});
