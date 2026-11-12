/**
 * Decision: do the accounts hold out to the payday, how is the month going against the expected one, and where is the
 * household heading.
 *
 * Everything the first page (Yhteenveto) says in its five blocks, as data the page only draws: the answer (what is left
 * after the payments, per day, and on the payday as a range), the month's pace against the expected month with the
 * range of the base months, the few categories that make the difference, the findings worth acting on, and the
 * direction of spending. Every figure is one of the registry (`figures.ts`); the page adds up and compares no money.
 */
import { daysBetween, monthOf } from "./dates.ts";
import { bufferReport } from "./reports/buffer.ts";
import { DIRECTION_MONTHS, DIRECTION_RECENT_MONTHS, MIN_COMPARE_MONTHS } from "./thresholds.ts";
import type { BalanceInput, IsoDate, UserInputs } from "./types.ts";
import type { AheadBasis } from "./analysis/ahead.ts";
import { cardGapCause } from "./analysis/card-bills.ts";
import type { AnalysisContext } from "./analysis/context.ts";
import { knownSpending } from "./analysis/data-quality.ts";
import type { MonthPace } from "./analysis/forecast.ts";
import type { Insight } from "./analysis/insights/index.ts";
import { expectedLevel } from "./analysis/expected.ts";
import { paydayOf, type Runway, runwayOf } from "./analysis/runway.ts";
import { completeMonthsBefore, gateFor, spendingThrough } from "./analysis/usual.ts";

/**
 * The answer in one word. "enough": the payments are covered and the payday's range stays above zero. "tight": the
 * payments are covered, but the lower end of the payday's range is below zero. "short": the payments are not covered, or
 * even the upper end of the range is below zero. "covered": the payments are covered, but the payday or the everyday
 * spending is not known, so nothing is said of the payday. "unknown": no balance to say it from.
 */
type Verdict = "enough" | "tight" | "short" | "covered" | "unknown";

interface HomeRunway {
  verdict: Verdict;
  /** The counted accounts today, what leaves them before the payday and what is left (Käytettävissä). null without a balance. */
  sum: { balanceCents: number; paymentsCents: number; freeCents: number } | null;
  /** `Käytettävissä päivässä`: the free sum over the days up to the payday. null without a payday to count to, under one day, or with nothing free. */
  allowancePerDayCents: number | null;
  /** The days it is spread over: from today to the day before the payday. null with `allowancePerDayCents`. */
  days: number | null;
  /** The expected everyday spending of a day over every account (`expectedEverydayPerDay`). 0 when it cannot be said. */
  everydayPerDayCents: number;
  /** The everyday spending of a day that the sentence of `home.based` states: the usual month's everyday spending (the rows outside every bill series) over its days, on every account, a card's purchases among them (`everydayPerDayCents`). It is not what leaves the counted accounts before the payday: a card's purchases leave them with a later bill. 0 when the payday cannot be said. */
  takenOffPerDayCents: number;
  /** The pay the days run to, and who pays it. null without a regular pay to wait for. */
  payday: { date: IsoDate; name: string } | null;
  /** What is left on the payday, with its range; the reason when it cannot be said. */
  leftOnPayday: Runway;
}

interface HomePace {
  month: string;
  /** The day of the month the figures run to. */
  day: number;
  daysInMonth: number;
  /** The month's spending so far. */
  spentCents: number;
  /** The expected spending to the same day. */
  expectedCents: number;
  /** `spentCents` less `expectedCents`: above zero the month has cost more than expected so far. */
  diffCents: number;
  /** The lower and the upper quartile of the base months to the same day. */
  lowCents: number;
  highCents: number;
  /** Where the month stands against that range. */
  position: "below" | "within" | "above";
  /** The month's end as the base months spent the rest of it; null for a month with no day left. */
  end: { lowCents: number; highCents: number } | null;
  /** How many complete months the expected month is read from. */
  months: number;
}

/** Why the pace cannot be set against an expected month: under three complete months, or a linked card's purchases are missing from them. */
type PaceGap = "history" | "cards";

interface HomeDirection {
  /** The mean spending of up to twelve complete months. null under three of them. A card bill counts as spending, so a card's missing purchases leave the total whole. */
  averageCents: number | null;
  /** How many months the average is of. */
  months: number;
  /** The last three complete months' mean less the average; null with the average. */
  recentChangeCents: number | null;
  direction: "up" | "down" | "flat" | null;
  /** Cash on checking and savings accounts in months of expected spending. null without a balance or an expected level. */
  bufferMonths: number | null;
  /** The two figures `bufferMonths` is the quotient of: net cash and the expected month's spending (Odotettu), which is not the average above. Both null with `bufferMonths`. */
  bufferNetCents: number | null;
  bufferSpendCents: number | null;
}

interface HomeReliability {
  /** Card purchases the data lacks: the bills' sum over the last twelve complete months and the cause in words. null when none are missing. */
  cardGap: { cents: number; cause: string } | null;
}

export interface Home {
  /** null when the range does not include today. */
  runway: HomeRunway | null;
  /** null when the month has no expected figure; `paceGap` says why. */
  pace: HomePace | null;
  paceGap: PaceGap | null;
  /** The findings worth acting on, three at most, each with what it is worth a year (`effectPerYear` is set). */
  notable: Insight[];
  direction: HomeDirection;
  reliability: HomeReliability;
}

/** The answer: what is left after the payments, per day and on the payday. */
function homeRunway(ctx: AnalysisContext, basis: Pick<AheadBasis, "ahead" | "direct" | "settling">): HomeRunway {
  const { ahead } = basis;
  const sum = ahead.balance ? { balanceCents: ahead.balance.startCents, paymentsCents: ahead.totals.leavingCents, freeCents: ahead.balance.freeCents } : null;
  const left = runwayOf(ctx, basis);
  const payday = paydayOf(ahead);
  // the days from today to the day before the payday, as the runway counts them, also when the everyday spending is not known
  const days = payday ? daysBetween(ahead.from, payday.date) : null;
  const spread = sum && days !== null && days > 0 && sum.freeCents > 0;
  const verdict: Verdict = !sum ? "unknown" : sum.freeCents < 0 || (left.known && left.highCents < 0) ? "short" : left.known && left.lowCents < 0 ? "tight" : left.known ? "enough" : "covered";
  return {
    verdict,
    sum,
    allowancePerDayCents: spread ? Math.round(sum.freeCents / days) : null,
    days: spread ? days : null,
    everydayPerDayCents: ahead.everydayPerDayCents,
    takenOffPerDayCents: left.known ? ahead.everydayPerDayCents : 0,
    payday,
    leftOnPayday: left,
  };
}

/** The month so far against the expected month; null without an expected month or before the 1st. */
function homePace(pace: MonthPace): HomePace | null {
  const { expected } = pace;
  const day = pace.current.reduce<number>((n, v, i) => (v === null ? n : i + 1), 0);
  if (!expected || day === 0) return null;
  const lowCents = expected.low[day - 1]!;
  const highCents = expected.high[day - 1]!;
  const end = pace.projection ? { lowCents: pace.projection.low.at(-1)!, highCents: pace.projection.high.at(-1)! } : null;
  return {
    month: pace.month,
    day,
    daysInMonth: pace.daysInMonth,
    spentCents: pace.currentTotal,
    expectedCents: expected.toToday,
    diffCents: expected.diffCents,
    lowCents,
    highCents,
    position: pace.currentTotal < lowCents ? "below" : pace.currentTotal > highCents ? "above" : "within",
    end,
    months: expected.months,
  };
}

/**
 * "Menot keskimäärin": the complete months before `month` (at most `DIRECTION_MONTHS`, oldest first), the spending of
 * each and their mean, null under `MIN_COMPARE_MONTHS` months. `spend.average` lists the same months with their rows.
 */
export function averageSpending(ctx: AnalysisContext, month: string): { months: string[]; spent: number[]; averageCents: number | null } {
  const months = completeMonthsBefore(ctx, month, DIRECTION_MONTHS);
  const spent = months.map((m) => spendingThrough(ctx, m));
  return { months, spent, averageCents: months.length < MIN_COMPARE_MONTHS ? null : expectedLevel(spent) };
}

/** The mean of whole months' spending and where the last three stand against it. */
function homeDirection(ctx: AnalysisContext, balances: readonly BalanceInput[], inputs: UserInputs): HomeDirection {
  const month = monthOf(ctx.today);
  const buffer = bufferReport(ctx, balances, inputs);
  const basis = buffer.bufferMonths === null ? { bufferNetCents: null, bufferSpendCents: null } : { bufferNetCents: Math.max(0, buffer.netCents!), bufferSpendCents: buffer.expectedSpendCents };
  const { months, spent, averageCents } = averageSpending(ctx, month);
  if (averageCents === null) {
    return { averageCents: null, months: months.length, recentChangeCents: null, direction: null, bufferMonths: buffer.bufferMonths, ...basis };
  }
  const recentChangeCents = expectedLevel(spent.slice(-DIRECTION_RECENT_MONTHS))! - averageCents;
  const gate = gateFor(averageCents);
  return {
    averageCents,
    months: months.length,
    recentChangeCents,
    direction: recentChangeCents > gate ? "up" : recentChangeCents < -gate ? "down" : "flat",
    bufferMonths: buffer.bufferMonths,
    ...basis,
  };
}

/** What the page tells of how far its figures can be trusted. */
function homeReliability(ctx: AnalysisContext): HomeReliability {
  const { cards } = knownSpending(ctx);
  const cause = cardGapCause(cards.bills);
  return { cardGap: cause ? { cents: cards.cents, cause } : null };
}

/** What `buildHome` reads from the dashboard's own parts, so nothing is worked out twice. */
interface HomeInput {
  /** The window of the payments and the balance; null when the range does not include today. */
  basis: Pick<AheadBasis, "ahead" | "direct" | "settling"> | null;
  pace: MonthPace;
  /** The dashboard's insights: ranked, dismissed ones left out, at most `OVERVIEW_INSIGHTS`. */
  insights: readonly Insight[];
  balances: readonly BalanceInput[];
  inputs: UserInputs;
}

/** The first page's answer, month, findings and direction. */
export function buildHome(ctx: AnalysisContext, { basis, pace, insights, balances, inputs }: HomeInput): Home {
  const homePaced = homePace(pace);
  return {
    runway: basis ? homeRunway(ctx, basis) : null,
    pace: homePaced,
    paceGap: pace.expected ? null : pace.cardGap ? "cards" : "history",
    // every finding on the page says what it is worth a year; one that cannot say it stays on the Säästövinkit page
    notable: insights.filter((i) => i.effectPerYear !== null),
    direction: homeDirection(ctx, balances, inputs),
    reliability: homeReliability(ctx),
  };
}
