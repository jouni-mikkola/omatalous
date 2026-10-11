/**
 * H-insights 11: the share of usual income that fixed costs take, now and a year ago. Fixed costs are
 * `fixedMonthlyCents` of today's series: those active now, and those that ran a year ago at today's amount (so a price
 * rise counts against the rise); usual income is `usualIncome`, the one the buffer report and the overview use. The
 * detail gives both sides, so it shows whether costs or income moved.
 */
import { cancelledMerchants, fixedMonthlyCents, isFixedCost } from "../../commitments.ts";
import { addDays, daysBetween, monthOf } from "../../dates.ts";
import type { RecurringSeries } from "../../recurring.ts";
import type { IsoDate, UserInputs } from "../../types.ts";
import { type AnalysisContext, historyCovers, recurringAt } from "../context.ts";
import { formatEur } from "../format.ts";
import { usualIncome } from "../usual.ts";
import type { Insight, InsightArgs } from "./types.ts";

/** A change under five percentage points is ordinary movement of pay and small subscriptions (random households reach 3). */
const MIN_POINTS = 5;

/** Fixed costs a month against usual income a month. */
export interface FixedShare {
  fixedCents: number;
  incomeCents: number;
  /** Whole percent, as the insight shows it. */
  pct: number;
}

export interface CommitmentsShare {
  /** Null without a usual income. */
  now: FixedShare | null;
  /** A year before `end`, seen from today's series. Null when the history is too short or had no usual income then. */
  then: FixedShare | null;
  /** The series on `end`. */
  series: readonly RecurringSeries[];
}

/** Both sides of the insight below, without its gate. Optimoi shows `now` in its Tilanne block. */
export function commitmentsShareOf(ctx: AnalysisContext, end: IsoDate, inputs: UserInputs): CommitmentsShare {
  const yearAgo = addDays(end, -365);
  const series = recurringAt(ctx, end);
  const share = (fixedCents: number, incomeCents: number | null): FixedShare | null =>
    incomeCents && incomeCents > 0 ? { fixedCents, incomeCents, pct: Math.round((fixedCents / incomeCents) * 100) } : null;
  const now = share(fixedMonthlyCents(series, cancelledMerchants(inputs)), usualIncome(ctx, monthOf(end)));
  // a quarterly bill needs half a year of rows before it shows as a series: without them a year ago looks cheaper
  if (!historyCovers(ctx, addDays(yearAgo, -183))) return { now, then: null, series };
  // a year ago seen from today: a contract that had just started then (a new electricity company, a yearly plan paid
  // once) had no series yet, and leaving it out would read as a rise
  const ranThen = series.filter((s) => (s.kind === "subscription" || s.kind === "bill") && s.firstDate <= yearAgo && daysBetween(s.lastDate, yearAgo) <= s.intervalDays + 5);
  const then = share(fixedMonthlyCents(ranThen.map((s) => ({ ...s, active: true }))), usualIncome(ctx, monthOf(yearAgo)));
  return { now, then, series };
}

export function commitmentsShare({ ctx, end, inputs, gateMonthlyCents }: InsightArgs): Insight[] {
  const share = commitmentsShareOf(ctx, end, inputs);
  if (!share.now || !share.then) return [];
  const { series } = share;
  const { fixedCents: fixedNow, incomeCents: incomeNow, pct: now } = share.now;
  const { fixedCents: fixedThen, incomeCents: incomeThen, pct: then } = share.then;
  const yearly = Math.round((Math.abs(now - then) / 100) * incomeNow * 12);
  // a falling share is told where it comes from: a loan that ended (stopped.ts) or a raise (income insights)
  if (now - then < MIN_POINTS || yearly < 12 * gateMonthlyCents) return [];
  return [
    {
      id: "commitments-share",
      tone: "warning",
      title: `Kiinteät menot vievät ${now} % tuloista, vuosi sitten ${then} %`,
      detail: `Kiinteät menot ${formatEur(fixedNow, false)} ja tavalliset tulot ${formatEur(incomeNow, false)} kuussa; vuosi sitten ${formatEur(fixedThen, false)} ja ${formatEur(incomeThen, false)}.`,
      yearlyCents: yearly,
      // the latest charge of each fixed cost
      rows: series.filter(isFixedCost).map((s) => s.transactionIds[s.transactionIds.length - 1]!),
    },
  ];
}
