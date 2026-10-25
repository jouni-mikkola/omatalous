/**
 * The figures the charts and tables draw come from core (CLAUDE.md: the web adds up no money): the heights of the
 * cash flow stacks, the bar of Tulojen käyttö with its shares, the shade of each month in the category table and the
 * change of a year comparison. Checked on seeded households, so each holds on any data and not only on one example.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { gateFor } from "../src/analysis/usual.ts";
import { bridgeView, roundedShares } from "../src/analysis/bridge-view.ts";
import { coverOf, totalsOf } from "../src/analysis/flows.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import { buildReports } from "../src/reports/index.ts";
import { randomHistory } from "./gen.ts";

const today = "2025-11-15";
const households = Array.from({ length: 8 }, (_, i) => {
  const { txs, accounts, rules } = randomHistory(i + 1, 400, { months: 24 });
  const ctx = createContext(enrichTransactions(txs, accounts, rules), accounts, today);
  return { seed: i + 1, r: buildReports({ ctx, range: { from: "2025-01-01", to: today }, balances: [] }, ["cashflow", "pivot", "yearOverYear"]) };
});

it("the seeded households reach every case: a bar, a shaded month, a year to compare", () => {
  expect(households.filter(({ r }) => r.cashflow.bridge?.draws).length).toBeGreaterThan(0);
  expect(households.filter(({ r }) => r.pivot.rows.some((x) => x.heat.some((h) => h > 0))).length).toBeGreaterThan(0);
  expect(households.filter(({ r }) => r.yearOverYear.ytdChange !== null).length).toBeGreaterThan(0);
});

describe("the cash flow stacks", () => {
  it("are each part from zero up, and in less out", () => {
    for (const { seed, r } of households) {
      for (const x of r.cashflow.rows) {
        const up = Math.max(0, x.incomeCents) + Math.max(0, x.borrowedCents);
        const down = Math.max(0, x.consumptionCents) + Math.max(0, x.debtCents) + Math.max(0, x.savedCents);
        expect(x.stack, `seed ${seed} ${x.month}`).toEqual({ inCents: up, outCents: down, gapCents: up - down });
      }
    }
  }, 30_000);
});

describe("the bar of Tulojen käyttö", () => {
  it("is the settled totals' bar: `closed` in a running range, else the range's totals", () => {
    for (const { r } of households) {
      const settled = r.cashflow.running ? r.cashflow.closed : r.cashflow.totals;
      expect(r.cashflow.bridge?.totals ?? null).toEqual(settled);
    }
  });

  it("fills each bar with its parts' shares, and the table adds up to Tulos", () => {
    for (const { seed, r } of households) {
      const v = r.cashflow.bridge;
      if (!v) continue;
      for (const bar of [v.parts, v.sources]) {
        const shown = bar.filter((p) => p.cents > 0);
        if (shown.length) expect(shown.reduce((s, p) => s + p.share, 0), `seed ${seed}`).toBeCloseTo(1, 9);
        for (const p of bar) if (p.cents <= 0) expect(p.share).toBe(0);
      }
      const side = (k: string) => v.rows.filter((x) => x.side === k).reduce((s, x) => s + x.cents, 0);
      expect(side("in") - side("out"), `seed ${seed}`).toBe(v.totals.leftCents);
      expect(v.cover).toEqual(coverOf(v.totals));
    }
  });

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

describe("the shade of the category table", () => {
  it("is plain on months that are not complete or hold no spending, and 1 to 4 against the row's usual month (the median)", () => {
    for (const { seed, r } of households) {
      for (const row of r.pivot.rows) {
        expect(row.heat).toHaveLength(r.pivot.months.length);
        const full = row.values.filter((v, i) => r.pivot.complete[i] && v > 0);
        const steady = !full.length || Math.max(...full) <= Math.min(...full) * 1.15;
        row.heat.forEach((h, i) => {
          const v = row.values[i]!;
          if (!r.pivot.complete[i] || v <= 0 || steady || row.usualCents === null || row.usualCents <= 0) return expect(h, `seed ${seed} ${row.category} ${i}`).toBe(0);
          const avg = row.usualCents;
          expect(h, `seed ${seed} ${row.category} ${i}`).toBe(v < avg / 2 ? 1 : v <= avg ? 2 : v <= avg * 1.5 ? 3 : 4);
        });
      }
    }
  });

  it("names the jump of the strip: a month of shade 4, the furthest above its row's usual month, over the gate", () => {
    const jumps = households.filter(({ r }) => r.pivot.jump !== null);
    expect(jumps.length).toBeGreaterThan(0);
    for (const { seed, r } of households) {
      const over = r.pivot.rows.flatMap((row) => r.pivot.strip.filter((i) => row.heat[i] === 4).map((i) => row.values[i]! - row.usualCents!).filter((o) => o >= gateFor(row.usualCents!)));
      if (!over.length) {
        expect(r.pivot.jump, `seed ${seed}`).toBeNull();
        continue;
      }
      const j = r.pivot.jump!;
      const row = r.pivot.rows.find((x) => x.category === j.category && x.label === j.label)!;
      expect(r.pivot.strip).toContain(j.month);
      expect(row.heat[j.month]).toBe(4);
      expect(j.cents).toBe(row.values[j.month]);
      expect(j.usualCents).toBe(row.usualCents);
      expect(j.cents - j.usualCents).toBe(Math.max(...over));
    }
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
