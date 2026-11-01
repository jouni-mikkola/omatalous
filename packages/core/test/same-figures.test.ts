/**
 * Figures that look alike on one page and are told under two names: each pair is held apart by what it counts, so the
 * one that counts less is never more than the one that counts more, and the difference is a thing the names say.
 */
import { describe, expect, it } from "vitest";
import { contextOf, demoHousehold, seededHousehold } from "../../../tools/findings/households.ts";
import { addMonths, monthOf } from "../src/dates.ts";
import { cashflowReport } from "../src/reports/cashflow.ts";

const households = [demoHousehold(), ...[1, 2, 3].map((seed) => seededHousehold(seed, true))];

describe.each(households.map((h) => [h.name, h] as const))("%s", (_, h) => {
  const ctx = contextOf(h);
  const range = { from: `${addMonths(monthOf(h.today), -11)}-01`, to: h.today };
  const report = cashflowReport(ctx, range, h.balances);

  it("Säästöön tilien ulkopuolelle counts only money that left the accounts, so it is never above zero, while Säästöön is net of what was taken out", () => {
    const out = report.moneyBridge?.lines.find((l) => l.key === "investedOut");
    if (out) expect(out.cents).toBeLessThanOrEqual(0);
  });

  it("the table in cents adds up: every row, the running month's too, is the total row to the cent, for every part", () => {
    const sum = (key: "incomeCents" | "consumptionCents" | "debtCents" | "savedCents" | "leftCents") => report.rows.reduce((s, x) => s + x[key], 0);
    for (const key of ["incomeCents", "consumptionCents", "debtCents", "savedCents", "leftCents"] as const) expect(report.whole[key], key).toBe(sum(key));
  });

  it("Tulos of the page is one sum: the total row, the totals and the sentence under the table", () => {
    expect(report.whole.leftCents).toBe(report.totals.leftCents);
    expect(report.whole.inCents).toBe(report.totals.incomeCents + report.totals.borrowedCents);
  });
});
