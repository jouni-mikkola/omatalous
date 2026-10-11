/**
 * H-insights 11: the share of usual income that fixed costs take, now and a year ago. Fixed costs are
 * `fixedMonthlyCents` of today's series: those active now, and those that ran a year ago at today's amount (so a price
 * rise counts against the rise); usual income is the median of the six complete months
 * before (refunds and payments from people left out). The detail gives both sides, so it shows whether costs or
 * income moved.
 */
import { fixedMonthlyCents, isFixedCost } from "../../commitments.ts";
import { addDays, daysBetween, monthOf } from "../../dates.ts";
import { historyCovers, recurringAt } from "../context.ts";
import { cancelledMerchants } from "../forecast.ts";
import { formatEur } from "../format.ts";
import { completeMonthsBefore, usualCents } from "../usual.ts";
import { monthRows } from "./shared.ts";
import type { Insight, InsightArgs } from "./types.ts";

/** A change under five percentage points is ordinary movement of pay and small subscriptions (random households reach 3). */
const MIN_POINTS = 5;

export function commitmentsShare({ ctx, end, inputs, gateMonthlyCents }: InsightArgs): Insight[] {
  const yearAgo = addDays(end, -365);
  // a quarterly bill needs half a year of rows before it shows as a series: without them a year ago looks cheaper
  if (!historyCovers(ctx, addDays(yearAgo, -183))) return [];
  const usualIncome = (day: string) => usualCents(completeMonthsBefore(ctx, monthOf(day)).map((m) => monthRows(ctx, m).income));
  const incomeNow = usualIncome(end);
  const incomeThen = usualIncome(yearAgo);
  if (!incomeNow || !incomeThen || incomeNow <= 0 || incomeThen <= 0) return [];
  const series = recurringAt(ctx, end);
  const fixedNow = fixedMonthlyCents(series, cancelledMerchants(inputs));
  // a year ago seen from today: a contract that had just started then (a new electricity company, a yearly plan paid
  // once) had no series yet, and leaving it out would read as a rise
  const ranThen = series.filter((s) => (s.kind === "subscription" || s.kind === "bill") && s.firstDate <= yearAgo && daysBetween(s.lastDate, yearAgo) <= s.intervalDays + 5);
  const fixedThen = fixedMonthlyCents(ranThen.map((s) => ({ ...s, active: true })));
  const now = Math.round((fixedNow / incomeNow) * 100);
  const then = Math.round((fixedThen / incomeThen) * 100);
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
