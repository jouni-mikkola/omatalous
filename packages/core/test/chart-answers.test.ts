/**
 * The figures the charts and tables draw come from core (CLAUDE.md: the web adds up no money): shares printed
 * side by side that add up, and the change of a year comparison. Checked on seeded households, so each holds on any data and not only on one example.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { roundedShares } from "../src/analysis/bridge-view.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import { buildReports } from "../src/reports/index.ts";
import { randomHistory } from "./gen.ts";

const today = "2025-11-15";
const households = Array.from({ length: 8 }, (_, i) => {
  const { txs, accounts, rules } = randomHistory(i + 1, 400, { months: 24 });
  const ctx = createContext(enrichTransactions(txs, accounts, rules), accounts, today);
  return { seed: i + 1, r: buildReports({ ctx, range: { from: "2025-01-01", to: today }, balances: [] }, ["yearOverYear"]) };
});

describe("shares printed side by side", () => {
  it("are rounded together so they add up to 100", () => {
    expect(roundedShares([47_600, 37_800, 0, 14_600], 100_000)).toEqual([48, 38, 0, 14]);
    expect(roundedShares([1, 1, 1], 3)).toEqual([34, 33, 33]);
  });
});

describe("the change of a year comparison", () => {
  it("is this year against the last as a share, null without last year's spending", () => {
    for (const { r } of households) {
      const y = r.yearOverYear;
      expect(y.ytdChange).toBe(y.previousYtdCents ? (y.ytdCents - y.previousYtdCents) / y.previousYtdCents : null);
    }
  });
});
