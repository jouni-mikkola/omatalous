/**
 * One number per idea on every page (0.65.0 RV4): the dashboard, the reports and Säästövinkit built for the demo and
 * seeded households give the same figure wherever the same idea shows, or a label that names why it differs.
 */
import { describe, expect, it } from "vitest";
import { contextOf, demoHousehold, type Household, seededHousehold } from "../../../tools/findings/households.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import { spendTotals } from "../src/analysis/context.ts";
import { toDayRange } from "../src/analysis/period.ts";
import { monthOf } from "../src/dates.ts";

const households: Household[] = [demoHousehold(), seededHousehold(3, true), seededHousehold(4, false)];

describe.each(households.map((h) => [h.name, h] as const))("%s", (_, h) => {
  const ctx = contextOf(h);
  const month = monthOf(h.today);

  it("draws the running month's pace on the waterfall's rows", () => {
    const range = { from: `${month}-01`, to: h.today };
    const d = buildDashboard(ctx, range, h.balances, h.inputs);
    expect(d.pace.currentTotal).toBe(spendTotals(ctx, toDayRange(range)).expenseCents);
  });
});
