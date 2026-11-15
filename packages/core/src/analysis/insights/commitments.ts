/**
 * H-insights 11: the share of usual income that fixed costs take, now and a year ago. Now is the buffer report's own
 * share (`fixedShareOn`), which Raportit and Säästövinkit > Tilanne show. A year ago is `fixedMonthlyCents` of the
 * series that ran then at today's amount (so a price rise counts against the rise) against the usual income of that
 * month. The detail gives both sides, so it shows whether costs or income moved.
 */
import { fixedMonthlyCents, isFixedCost } from "../../commitments.ts";
import { addDays, daysBetween, monthOf } from "../../dates.ts";
import { parseSeriesId, type RecurringSeries } from "../../recurring.ts";
import type { IsoDate, UserInputs } from "../../types.ts";
import type { AnalysisContext } from "../context.ts";
import { accountCovers } from "../coverage.ts";
import { formatEur } from "../format.ts";
import { fixedSeriesAt, fixedShareOn } from "../fixed-share.ts";
import { expectedIncome } from "../expected.ts";
import { MIN_FIXED_SHARE_POINTS } from "../../thresholds.ts";
import { insightOf, REPORT } from "./shared.ts";
import { messageIn } from "../../messages.ts";
import { type Insight, type InsightArgs, q } from "./types.ts";

/** Fixed costs a month against usual income a month. */
interface FixedShare {
  fixedCents: number;
  incomeCents: number;
  /** Whole percent, as the insight shows it. */
  pct: number;
}

interface CommitmentsShare {
  /** Null without a usual income. */
  now: FixedShare | null;
  /** A year before `end`, seen from today's series. Null when the history is too short or had no usual income then. */
  then: FixedShare | null;
  /** The series on `end`. */
  series: readonly RecurringSeries[];
}

/** Both sides of the insight below, without its gate. `now` is `fixedShareOn` itself: on today, the buffer report's `fixedShare`. */
function commitmentsShareOf(ctx: AnalysisContext, end: IsoDate, inputs: UserInputs): CommitmentsShare {
  const yearAgo = addDays(end, -365);
  const series = fixedSeriesAt(ctx, end);
  const share = (fixedCents: number, incomeCents: number | null): FixedShare | null =>
    incomeCents && incomeCents > 0 ? { fixedCents, incomeCents, pct: Math.round((fixedCents / incomeCents) * 100) } : null;
  const own = fixedShareOn(ctx, end, inputs);
  const now = own.fixedShare === null ? null : { fixedCents: own.fixedMonthlyCents, incomeCents: own.incomeMonthlyCents!, pct: Math.round(own.fixedShare * 100) };
  // a year ago seen from today: a contract that had just started then (a new electricity company, a yearly plan paid
  // once) had no series yet, and leaving it out would read as a rise
  const ranThen = series.filter((s) => (s.kind === "subscription" || s.kind === "bill") && s.firstDate <= yearAgo && daysBetween(s.lastDate, yearAgo) <= s.intervalDays + 5);
  // a quarterly bill needs half a year of rows before it shows as a series: without them a year ago looks cheaper. Every
  // account that carries a fixed cost, now or then, needs them: a card connected later would make the costs look risen
  const carriers = new Set([...series.filter(isFixedCost), ...ranThen].map((s) => parseSeriesId(s.id)?.accountId ?? ""));
  if (carriers.size && !accountCovers(ctx, carriers, addDays(yearAgo, -183))) return { now, then: null, series };
  const then = share(fixedMonthlyCents(ranThen.map((s) => ({ ...s, active: true }))), expectedIncome(ctx, monthOf(yearAgo)));
  return { now, then, series };
}

export function commitmentsShare({ ctx, end, inputs, gateMonthlyCents, lang }: InsightArgs): Insight[] {
  const share = commitmentsShareOf(ctx, end, inputs);
  if (!share.now || !share.then) return [];
  const { series } = share;
  const { fixedCents: fixedNow, incomeCents: incomeNow, pct: now } = share.now;
  const { fixedCents: fixedThen, incomeCents: incomeThen, pct: then } = share.then;
  const yearly = Math.round((Math.abs(now - then) / 100) * incomeNow * 12);
  // a falling share is told where it comes from: a loan that ended (stopped.ts) or a raise (income insights)
  if (now - then < MIN_FIXED_SHARE_POINTS || yearly < 12 * gateMonthlyCents) return [];
  return [
    insightOf({
      lang,
      id: "commitments-share",
      fact: { type: "commitments-share", percent: now, fixedCents: fixedNow, incomeCents: incomeNow },
      comparison: { label: "yearAgo", value: q.percent(then) },
      action: { label: "seeFixedCosts", target: { page: "reports", anchor: REPORT.fixed } },
      yearlyCents: -yearly,
      kind: "pattern",
      // the latest charge of each fixed cost
      rows: series.filter(isFixedCost).map((s) => s.transactionIds[s.transactionIds.length - 1]!),
      calc: [
        { label: messageIn(lang, "calc.fixed_month"), value: formatEur(fixedNow, false, lang) },
        { label: messageIn(lang, "calc.expected_income_month"), value: formatEur(incomeNow, false, lang) },
        { label: messageIn(lang, "calc.share_now"), value: `${now} %` },
        { label: messageIn(lang, "calc.fixed_year_ago"), value: formatEur(fixedThen, false, lang) },
        { label: messageIn(lang, "calc.income_year_ago"), value: formatEur(incomeThen, false, lang) },
        { label: messageIn(lang, "calc.share_year_ago"), value: `${then} %` },
      ],
    }),
  ];
}
