import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(import.meta.dirname, "../src");

/** The files of `src` that read the `spend` of a row. */
function readers(dir = SRC): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return readers(path);
    return /\.ts$/.test(name) && /\.spend\b|\bnetSpend\b|\bspend:/.test(readFileSync(path, "utf8")) ? [relative(SRC, path).replaceAll("\\", "/")] : [];
  });
}

/**
 * Card statement rows move spending of one bill between days and categories, and only the readers named here show that:
 * they read the rows through `spendRows` or `loweredRows` (context.ts). Every other reader of `spend` sees the bill whole,
 * as it did before there were statements, so its figure is the bank's and no row can change it. A file that reads `spend`
 * and is in neither list fails here: decide which it is, and give it a test in statement-explain.test.ts if it is the first.
 */
const USES_SPEND_ROWS = [
  "analysis/card-bills.ts",
  "analysis/category-totals.ts",
  "analysis/context.ts",
  "analysis/counted.ts",
  "analysis/filed.ts",
  "analysis/food.ts",
  "analysis/questions.ts",
  "analysis/themes-report.ts",
  "analysis/waterfall.ts",
  "reports/categories.ts",
  "reports/pivot.ts",
  "reports/summary.ts",
];

/** Reads `spend` of the bill whole on purpose: the series, the returns, a change plan, a bill's own cost, a single-merchant list. */
const BILL_WHOLE = [
  "analysis/alerts.ts",
  "analysis/change-plan.ts",
  "analysis/change-signal.ts",
  "analysis/change-split.ts",
  "analysis/change.ts",
  "analysis/credit.ts",
  "analysis/data-quality.ts",
  "analysis/fees.ts",
  "analysis/forecast.ts",
  "analysis/insights/instalments.ts",
  "analysis/insights/seasons.ts",
  "analysis/insights/shared.ts",
  "analysis/insights/spending.ts",
  "analysis/insights/stopped.ts",
  "analysis/money-in.ts",
  "analysis/one-offs.ts",
  "analysis/statement-explain.ts",
  // name the figure "usual.spend" only
  "explain/explain.ts",
  "explain/types.ts",
  "optimise/areas/bank.ts",
  "optimise/areas/electricity.ts",
  "optimise/areas/housing.ts",
  "optimise/areas/insurance.ts",
  "optimise/common.ts",
  "reports/drift.ts",
  "reports/year-over-year.ts",
];

describe("every reader of spend is classified", () => {
  it("names each file that reads spend in exactly one list", () => {
    const found = readers().sort();
    const listed = [...USES_SPEND_ROWS, ...BILL_WHOLE].sort();
    expect(found.filter((f) => !listed.includes(f)), "a file reads spend and is in neither list").toEqual([]);
    expect(listed.filter((f) => !found.includes(f)), "a listed file no longer reads spend").toEqual([]);
    expect(USES_SPEND_ROWS.filter((f) => BILL_WHOLE.includes(f))).toEqual([]);
  });

  it("a total shown beside converted categories is worked out from the same rows", () => {
    // the totals of the summary, the first page and its bridge read `spendTotals`, never the flows of `inDays` themselves
    for (const f of ["reports/summary.ts", "analysis/dashboard.ts", "analysis/bridge.ts"]) {
      const source = readFileSync(join(SRC, f), "utf8");
      expect(source, f).toMatch(/\bspendTotals\b|\bspendRows\b/);
      expect(source, f).not.toMatch(/totalsOf\(\s*(inDays|current|previous)/);
    }
  });

  it("the readers that show what a bill paid for take their rows from spendRows or loweredRows", () => {
    for (const f of USES_SPEND_ROWS.filter((f) => f !== "analysis/context.ts" && f !== "analysis/food.ts")) {
      expect(readFileSync(join(SRC, f), "utf8"), f).toMatch(/\b(spendRows|loweredRows)\b/);
    }
  });
});
