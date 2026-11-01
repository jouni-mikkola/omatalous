import { describe, expect, it } from "vitest";
import { spendingChange } from "../src/analysis/change.ts";
import { planOf } from "../src/analysis/change-plan.ts";
import { changeMonths } from "../src/analysis/change-text.ts";
import { createContext } from "../src/analysis/context.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import { randomHistory } from "./gen.ts";

describe("the twelve-month change of the month report", () => {
  const today = "2025-11-15";
  const households = Array.from({ length: 6 }, (_, i) => randomHistory(i + 1, 1500, { months: 30, settled: true }));
  const ctxOf = (h: (typeof households)[number]) => createContext(enrichTransactions(h.txs, h.accounts, h.rules), h.accounts, today);

  it("leaves the twelve-month view of the month report as it was: the default is twelve and an explicit twelve is the same answer", () => {
    for (const h of households) {
      const ctx = ctxOf(h);
      const { lastComplete } = changeMonths(ctx, { from: "2024-11-01", to: today });
      expect(spendingChange(ctx, "year", lastComplete, 12)).toEqual(spendingChange(ctx, "year", lastComplete));
    }
  }, 60_000);

  it("gives every view the same plan and the same change with an explicit twelve as with the default, so what reads the default (the year view of Yhteenveto and the insights, which call spendingChange without a count) is unmoved", () => {
    for (const h of households) {
      const ctx = ctxOf(h);
      const { lastComplete } = changeMonths(ctx, { from: "2024-11-01", to: today });
      for (const view of ["expected", "season", "year"] as const) {
        expect(planOf(ctx, view, lastComplete, 12)).toEqual(planOf(ctx, view, lastComplete));
        expect(spendingChange(ctx, view, lastComplete, 12)).toEqual(spendingChange(ctx, view, lastComplete));
      }
    }
  }, 60_000);
});
