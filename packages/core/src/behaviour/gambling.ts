/**
 * Gambling stakes: the rows of category `gambling` going out, counted and summed by week and month. Payouts are not
 * netted here yet.
 */
import type { AnalysisTx } from "../analysis/context.ts";
import { type Counter, type Covers, type Tally, type Windows, usualWeekly } from "./week.ts";

export const isStake = (t: AnalysisTx): boolean => t.category === "gambling" && t.amountCents < 0 && !t.isTransfer;

export interface GamblingBehaviour {
  week: Tally;
  month: Tally;
  lastMonth: Tally;
  /** The median stakes a week over the covered weeks before; null without it. */
  usual: number | null;
  covered: boolean;
  confidence: "known" | "estimated";
  evidenceIds: string[];
}

export function gamblingOf(c: Counter, w: Windows, covers: Covers): GamblingBehaviour {
  const week = c.tally("week", covers);
  return {
    week,
    month: c.tally("month", covers),
    lastMonth: c.tally("lastMonth", covers),
    usual: usualWeekly(c.byWeek, w, covers)?.usual ?? null,
    covered: week.covered,
    confidence: week.covered ? "known" : "estimated",
    evidenceIds: c.ids,
  };
}
