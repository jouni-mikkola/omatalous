/**
 * Rule 9: Optimoi stays silent on households without the patterns, with no inputs and with every part's neutral
 * inputs. Few findings and never a wrong one: a finding here is a false finding to fix, not a threshold to tune.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../../src/analysis/context.ts";
import { allFindings, buildOptimise, type InputValues, type OptimiseData } from "../../src/optimise/index.ts";
import { randomHistory } from "../gen.ts";
import { enrich, neutralValues } from "./household.ts";

const JUDGED = "2025-11-15";
const plain = (s: string) => s.replace(/[  ]/g, " ");

function loud(seed: number, data: OptimiseData): string[] {
  return allFindings(data).map((f) => `${seed} ${f.id}: ${plain(f.title)}`);
}

function judge(histories: (seed: number) => ReturnType<typeof randomHistory>): { loud: string[]; situation: number } {
  const out: string[] = [];
  let situation = 0;
  const neutral: InputValues = neutralValues();
  for (let seed = 1; seed <= 50; seed++) {
    const { txs, accounts, rules } = histories(seed);
    const ctx = createContext(enrich(txs, accounts, rules), accounts, JUDGED);
    const balances = accounts.map((a) => ({ id: a.id, name: a.name, type: a.type, balanceCents: a.type === "loan" ? null : 150000, ownerName: null, balanceAt: JUDGED }));
    for (const values of [{}, neutral]) {
      const data = buildOptimise({ ctx, balances, values });
      out.push(...loud(seed, data));
      situation += data.situation.filter((s) => s.value !== null).length;
    }
  }
  return { loud: out, situation };
}

describe("optimise on random households", () => {
  it("stays quiet on 50 plain histories", () => {
    const { loud } = judge((seed) => randomHistory(seed, 600));
    expect(loud).toEqual([]);
  });

  it("stays quiet on 50 settled households of 30 months, and Tilanne has its figures", () => {
    const { loud, situation } = judge((seed) => randomHistory(seed, 1500, { months: 30, settled: true }));
    expect(loud).toEqual([]);
    // four facts, two runs, fifty households: the settled ones have pay, balances and a loan
    expect(situation).toBe(4 * 2 * 50);
  });
});
