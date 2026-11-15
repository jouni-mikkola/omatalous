/**
 * The figures the charts and tables draw come from core (CLAUDE.md: the web adds up no money): the bar of Tulojen
 * käyttö with its shares and the change of a year comparison. Checked on seeded households, so each holds on any data and not only on one example.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { bridgeView, roundedShares } from "../src/analysis/bridge-view.ts";
import { totalsOf } from "../src/analysis/flows.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import { buildReports } from "../src/reports/index.ts";
import { randomHistory } from "./gen.ts";

const today = "2025-11-15";
const households = Array.from({ length: 8 }, (_, i) => {
  const { txs, accounts, rules } = randomHistory(i + 1, 400, { months: 24 });
  const ctx = createContext(enrichTransactions(txs, accounts, rules), accounts, today);
  return { seed: i + 1, r: buildReports({ ctx, range: { from: "2025-01-01", to: today }, balances: [] }, ["yearOverYear"]) };
});

describe("the bar of Tulojen käyttö", () => {
  it("prints shares of the income that add up to 100", () => {
    const v = bridgeView(totalsOf([{ income: 100_000, consumption: 47_600, debt: 37_800, saved: 0, borrowed: 0 }]));
    expect(v.figures.filter((f) => f.ofIncome).map((f) => f.incomeUnits)).toEqual([48, 38, 0, 14]);
    expect(v.rows.find((x) => x.key === "income")).toMatchObject({ incomeUnits: null, incomeShare: 1 });
    expect(roundedShares([1, 1, 1], 3)).toEqual([34, 33, 33]);
  });

  it("is not drawn with a part below zero, and then nothing is a share of the income", () => {
    const v = bridgeView(totalsOf([{ income: 300_000, consumption: -10_000, debt: 0, saved: 0, borrowed: 100_000 }]));
    expect(v.draws).toBe(false);
    expect(v.rows.every((x) => !x.ofIncome && x.incomeUnits === null)).toBe(true);
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
