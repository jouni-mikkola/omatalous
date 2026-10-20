import { describe, expect, it } from "vitest";
import { spendingChange } from "../src/analysis/change.ts";
import { planOf } from "../src/analysis/change-plan.ts";
import { changeMonths } from "../src/analysis/change-text.ts";
import { createContext } from "../src/analysis/context.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import { rangeChangeReport, spendingChangeReport } from "../src/reports/spending-change.ts";
import { addMonths } from "../src/dates.ts";
import { randomHistory } from "./gen.ts";

describe("the change of the range's months against a year earlier", () => {
  const today = "2025-11-15";
  const households = Array.from({ length: 6 }, (_, i) => randomHistory(i + 1, 1500, { months: 30, settled: true }));
  const ctxOf = (h: (typeof households)[number]) => createContext(enrichTransactions(h.txs, h.accounts, h.rules), h.accounts, today);

  it("takes as many target months as the range holds, each paired with the month twelve earlier, and the bars add up to the change", () => {
    let told = 0;
    for (const [i, h] of households.entries()) {
      const ctx = ctxOf(h);
      for (const [from, count] of [["2025-08-01", 3], ["2025-05-01", 6], ["2024-11-01", 12]] as const) {
        const report = rangeChangeReport(ctx, { from, to: today });
        const name = `household ${i} from ${from}`;
        if (!report) continue;
        told += 1;
        // the newest month of the range may be one the rows do not reach to its end: then the target stops a month before it
        expect(report.change.target.months[0], name).toBe(from.slice(0, 7));
        expect([count - 1, count], name).toContain(report.change.target.months.length);
        expect(report.change.base.months, name).toEqual(report.change.target.months.map((m) => addMonths(m, -12)));
        if (report.bars.length) expect(report.bars.reduce((s, b) => s + b.cents, 0), name).toBe(report.change.changeCents);
      }
    }
    expect(told).toBeGreaterThan(6);
  }, 60_000);

  it("leaves the twelve-month view of the month report as it was: the default is twelve and an explicit twelve is the same answer", () => {
    for (const h of households) {
      const ctx = ctxOf(h);
      const { lastComplete } = changeMonths(ctx, { from: "2024-11-01", to: today });
      expect(spendingChange(ctx, "year", lastComplete, 12)).toEqual(spendingChange(ctx, "year", lastComplete));
      const year = spendingChangeReport(ctx, { from: "2024-11-01", to: today }).views.find((v) => v.view === "year");
      const long = rangeChangeReport(ctx, { from: "2024-12-01", to: today });
      if (year && long) expect(long.change.target.months).toEqual(year.change.target.months);
    }
  }, 60_000);

  it("gives every view the same plan and the same change with an explicit twelve as with the default, so what reads the default (the year view of Yhteenveto and the insights, which call spendingChange without a count) is unmoved", () => {
    for (const h of households) {
      const ctx = ctxOf(h);
      const { lastComplete } = changeMonths(ctx, { from: "2024-11-01", to: today });
      for (const view of ["usual", "season", "year"] as const) {
        expect(planOf(ctx, view, lastComplete, 12)).toEqual(planOf(ctx, view, lastComplete));
        expect(spendingChange(ctx, view, lastComplete, 12)).toEqual(spendingChange(ctx, view, lastComplete));
      }
    }
  }, 60_000);

  it("is null under three complete months", () => {
    expect(rangeChangeReport(ctxOf(households[0]!), { from: "2025-10-01", to: today })).toBeNull();
  });
});
