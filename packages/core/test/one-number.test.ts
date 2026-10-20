/**
 * One number per idea on every page (0.65.0 RV4): the dashboard, the reports and Säästövinkit built for the demo and
 * seeded households give the same figure wherever the same idea shows, or a label that names why it differs.
 */
import { describe, expect, it } from "vitest";
import { contextOf, demoHousehold, type Household, seededHousehold } from "../../../tools/findings/households.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import { spendTotals } from "../src/analysis/context.ts";
import { toDayRange } from "../src/analysis/period.ts";
import { addMonths, monthEnd, monthOf } from "../src/dates.ts";
import { buildOptimise } from "../src/optimise/index.ts";
import { buildReports } from "../src/reports/index.ts";

const households: Household[] = [demoHousehold(), seededHousehold(3, true), seededHousehold(4, false)];

describe.each(households.map((h) => [h.name, h] as const))("%s", (_, h) => {
  const ctx = contextOf(h);
  const month = monthOf(h.today);
  // the 12 kk preset of Raportit: the twelve months before this one
  const year = { from: `${addMonths(month, -12)}-01`, to: monthEnd(addMonths(month, -1)) };
  const reports = buildReports({ ctx, range: year, balances: h.balances, inputs: h.inputs });
  const optimise = buildOptimise({ ctx, balances: h.balances, inputs: h.inputs, values: h.values, states: [], industry: h.industry });
  const fact = (id: string) => optimise.situation.find((f) => f.id === id)!;

  it("tells fixed costs as a share of income once, under one label", () => {
    expect(fact("fixed_share").value).toBe(reports.buffer.fixedShare);
    expect(fact("fixed_share").label).toBe(reports.buffer.fixedShareLabel);
  });

  it("splits the income of Tulojen käyttö into the earned and the rest of Tulot", () => {
    const r = reports.income;
    expect(r.months.map((m) => m.month)).toEqual(Array.from({ length: 12 }, (_, i) => addMonths(month, i - 12)));
    expect(reports.cashflow.totals.incomeCents).toBe(r.earnedCents + r.notEarnedCents);
    expect(r.unknownCents).toBeGreaterThanOrEqual(0);
    expect(r.unknownCents).toBeLessThanOrEqual(r.notEarnedCents);
  });

  it("groups the categories as Menot kuukausittain does", () => {
    const placed = new Set(reports.categories.groups.flatMap((g) => g.categories.map((c) => `${g.group}/${c.category}`)));
    for (const row of reports.pivot.rows) expect(placed.has(`${row.group}/${row.category}`), `${row.group}/${row.category}`).toBe(true);
    // the large purchases stand apart in Menot kuukausittain; without them each theme is its group to the cent
    const themes = [...reports.pivot.themes, ...(reports.pivot.rest?.themes ?? [])];
    expect(themes.reduce((s, t) => s + t.totalCents, 0) + (reports.pivot.large?.totalCents ?? 0)).toBe(reports.categories.totalCents);
    if (!reports.pivot.large) {
      // one placement (`placeOf` reads `themeOf`): each group of Kategoriat is its theme of Menot kuukausittain
      const groups = Object.fromEntries(reports.categories.groups.filter((g) => g.totalCents !== 0).map((g) => [g.group, g.totalCents]));
      const byTheme = Object.fromEntries(themes.filter((t) => t.totalCents !== 0).map((t) => [t.label, t.totalCents]));
      expect(byTheme).toEqual(groups);
    }
  });

  it("draws the running month's pace on the waterfall's rows", () => {
    const range = { from: `${month}-01`, to: h.today };
    const d = buildDashboard(ctx, range, h.balances, h.inputs);
    expect(d.pace.currentTotal).toBe(spendTotals(ctx, toDayRange(range)).expenseCents);
  });
});
