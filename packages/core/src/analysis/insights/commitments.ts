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
import { usualIncome } from "../usual.ts";
import type { Insight, InsightArgs } from "./types.ts";

/** A change under five percentage points is ordinary movement of pay and small subscriptions (random households reach 3). */
const MIN_POINTS = 5;

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
      // the words of the share's label on Raportit and Tilanne
      title: `Kiinteät menot ${now} % tavallisista tuloista, vuosi sitten ${then} %`,
      detail: `Kiinteät menot ${formatEur(fixedNow, false)} ja tavalliset tulot ${formatEur(incomeNow, false)} kuussa; vuosi sitten ${formatEur(fixedThen, false)} ja ${formatEur(incomeThen, false)}.`,
      yearlyCents: yearly,
      // the latest charge of each fixed cost
      rows: series.filter(isFixedCost).map((s) => s.transactionIds[s.transactionIds.length - 1]!),
      calc: [
        { label: "Kiinteät menot kuussa", value: formatEur(fixedNow, false) },
        { label: "Tavalliset tulot kuussa", value: formatEur(incomeNow, false) },
        { label: "Osuus nyt", value: `${now} %` },
        { label: "Kiinteät menot vuosi sitten", value: formatEur(fixedThen, false) },
        { label: "Tavalliset tulot vuosi sitten", value: formatEur(incomeThen, false) },
        { label: "Osuus vuosi sitten", value: `${then} %` },
      ],
    },
  ];
}
