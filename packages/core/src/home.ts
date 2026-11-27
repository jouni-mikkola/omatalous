/**
 * Decision: do the accounts hold out to the payday, how is the month going against the expected one, and where is the
 * household heading.
 *
 * Everything the first page (Yhteenveto) says in its four blocks, as data the page only draws: the answer (what is left
 * after the payments, per day, and on the payday as a range), the month's pace against the expected month with the
 * range of the base months, the few categories that make the difference, the findings worth acting on, and the
 * buffer. Every figure is one of the registry (`figures.ts`); the page adds up and compares no money.
 */
import { addDays, dayNumber, daysBetween, monthOf } from "./dates.ts";
import { type LowPoint, lowPoint } from "./low-point.ts";
import { type BufferGap, bufferReport } from "./reports/buffer.ts";
import type { BalanceInput, IsoDate, UserInputs } from "./types.ts";
import type { AheadBasis } from "./analysis/ahead.ts";
import { cardGapCause } from "./analysis/card-bills.ts";
import type { AnalysisContext } from "./analysis/context.ts";
import { knownSpending } from "./analysis/data-quality.ts";
import type { MonthPace } from "./analysis/forecast.ts";
import { expectedFor } from "./analysis/expected.ts";
import { balanceWalk } from "./analysis/balance-walk.ts";
import { paydayOf, type Runway, runwayOf } from "./analysis/runway.ts";

/**
 * The answer in one word. "enough": the payments are covered and the payday's range stays above zero. "tight": the
 * payments are covered, but the lower end of the payday's range is below zero. "short": the payments are not covered, or
 * even the upper end of the range is below zero. "covered": the payments are covered, but the payday or the everyday
 * spending is not known, so nothing is said of the payday. "unknown": no balance to say it from.
 */
type Verdict = "enough" | "tight" | "short" | "covered" | "unknown";

interface HomeRunway {
  verdict: Verdict;
  /** The counted accounts today, what leaves them before the payday, what the cards owe beyond their bills and what is left (Käytettävissä). null without a balance, and without a balance of a card in view. */
  sum: { balanceCents: number; paymentsCents: number; cardDebtCents: number; freeCents: number } | null;
  /** `Käytettävissä päivässä`: the free sum over the days up to the payday. null without a payday to count to, under one day, or with nothing free. */
  allowancePerDayCents: number | null;
  /** The days it is spread over: from today to the day before the payday. null with `allowancePerDayCents`. */
  days: number | null;
  /** The expected everyday spending of a day over every account (`expectedEverydayPerDay`). 0 when it cannot be said. */
  everydayPerDayCents: number;
  /** The everyday spending of a day: the usual month's everyday spending (the rows outside every bill series) over its days, on every account, a card's purchases among them (`everydayPerDayCents`). It is not what leaves the counted accounts before the payday: a card's purchases leave them with a later bill. 0 when the payday cannot be said. */
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
  /** The month's end as the base months spent the rest of it; null for a month with no day left. `pointCents` is the one figure inside that range: what the month has cost plus the expected spending on the days left. */
  end: { lowCents: number; highCents: number; pointCents: number } | null;
  /** How many complete months the expected month is read from. */
  months: number;
}

/** Why the pace cannot be set against an expected month: under three complete months, or a linked card's purchases are missing from them. */
type PaceGap = "history" | "cards";

interface HomeDirection {
  /**
   * What the running month usually costs, all its days: the expected spending (`expectedSpending`, ADR 0021) that
   * Yhteenveto sets the month against and the buffer divides by, so the page has one usual spending. One-offs are left out
   * of it. null under three complete months.
   */
  usualCents: number | null;
  /** How many complete months `usualCents` is read from. */
  months: number;
  /** Cash on checking and savings accounts in months of expected spending; negative when the card debt and the bills due exceed the cash. null without a balance or an expected level. */
  bufferMonths: number | null;
  /** The two figures `bufferMonths` is the quotient of: net cash and the expected month's spending (Odotettu), which is not the average above. Both null with `bufferMonths`. */
  bufferNetCents: number | null;
  bufferSpendCents: number | null;
  /** Why `bufferMonths` is null: no balance of a savings or checking account, too short a history for an expected month, or an expected month with no spending. null with a figure. */
  bufferGap: BufferGap | null;
}

interface HomeReliability {
  /** Card purchases the data lacks: the bills' sum over the last twelve complete months and the cause in words. null when none are missing. */
  cardGap: { cents: number; cause: string } | null;
}

interface BalancePoint {
  date: IsoDate;
  cents: number;
}

export interface Home {
  /** null when the range does not include today. */
  runway: HomeRunway | null;
  /** The lowest balance from today to the payday of `runway`, with the day and a range; the reason when it cannot be said. null when the range does not include today. */
  lowPoint: LowPoint | null;
  /**
   * The counted accounts' balance at the end of each day from the last pay that came to today, date ascending, as
   * `balanceWalk` gives it (Saldot's own figure). The last point is today's balance, `runway.sum.balanceCents`; the line of
   * `lowPoint` starts from it less the cards' debt. null without a pay that came (the payday has no pay estimate), a balance of every counted account or a
   * day before today, and when the range does not include today.
   */
  balancePast: BalancePoint[] | null;
  /** null when the month has no expected figure; `paceGap` says why. */
  pace: HomePace | null;
  paceGap: PaceGap | null;
  direction: HomeDirection;
  reliability: HomeReliability;
}

/** The answer: what is left after the payments, per day and on the payday. */
function homeRunway(ctx: AnalysisContext, basis: Pick<AheadBasis, "ahead" | "direct" | "settling">): HomeRunway {
  const { ahead } = basis;
  const sum = ahead.balance ? { balanceCents: ahead.balance.startCents, paymentsCents: ahead.totals.leavingCents, cardDebtCents: ahead.balance.cardDebtCents, freeCents: ahead.balance.freeCents } : null;
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

/** The counted accounts' end-of-day balance from the last pay that came to today; see `Home.balancePast`. */
function homeBalancePast(ctx: AnalysisContext, basis: Pick<AheadBasis, "ahead" | "checking" | "pays">, balances: readonly BalanceInput[]): BalancePoint[] | null {
  const lastPay = basis.pays.at(-1);
  if (!lastPay || !basis.ahead.balance || lastPay.date >= ctx.today) return null;
  const walks = basis.checking.map((c) => balances.find((b) => b.id === c.id)).map((b) => (b ? balanceWalk(ctx, b) : null));
  const points: BalancePoint[] = [];
  for (let day = lastPay.date; day <= ctx.today; day = addDays(day, 1)) {
    const at = walks.map((w) => w?.at(dayNumber(day)) ?? null);
    if (at.some((cents) => cents === null)) return null;
    points.push({ date: day, cents: at.reduce<number>((sum, cents) => sum + cents!, 0) });
  }
  return points;
}

/** The month so far against the expected month; null without an expected month or before the 1st. */
function homePace(pace: MonthPace): HomePace | null {
  const { expected } = pace;
  const day = pace.current.reduce<number>((n, v, i) => (v === null ? n : i + 1), 0);
  if (!expected || day === 0) return null;
  const lowCents = expected.low[day - 1]!;
  const highCents = expected.high[day - 1]!;
  // the range and the point come from different sums (quartile months vs summed category expectations), so the point is
  // held inside the range: a card never shows an estimate outside the span drawn next to it
  const end = pace.projection
    ? {
        lowCents: pace.projection.low.at(-1)!,
        highCents: pace.projection.high.at(-1)!,
        pointCents: Math.min(
          pace.projection.high.at(-1)!,
          Math.max(pace.projection.low.at(-1)!, pace.currentTotal + expected.curve.at(-1)! - expected.toToday),
        ),
      }
    : null;
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

/** The month's usual spending and the buffer the accounts hold against it. */
function homeDirection(ctx: AnalysisContext, balances: readonly BalanceInput[], inputs: UserInputs): HomeDirection {
  const buffer = bufferReport(ctx, balances, inputs);
  const basis = buffer.bufferMonths === null ? { bufferNetCents: null, bufferSpendCents: null, bufferGap: buffer.bufferGap } : { bufferNetCents: buffer.netCents, bufferSpendCents: buffer.expectedSpendCents, bufferGap: null };
  return {
    usualCents: buffer.expectedSpendCents,
    months: expectedFor(ctx, monthOf(ctx.today))?.months.length ?? 0,
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
  basis: Pick<AheadBasis, "ahead" | "direct" | "settling" | "checking" | "pays"> | null;
  pace: MonthPace;
  balances: readonly BalanceInput[];
  inputs: UserInputs;
}

/** The days from today to the payday of the answer, both included: the walk of the first page ends where Jää palkkapäivänä does. Without a payday the figure has no answer and the default stands. */
function lowPointDays(ahead: Pick<AheadBasis["ahead"], "reason" | "payday" | "from">): number | undefined {
  const payday = paydayOf(ahead);
  return payday ? daysBetween(ahead.from, payday.date) + 1 : undefined;
}

/** The first page's answer, month and buffer. */
export function buildHome(ctx: AnalysisContext, { basis, pace, balances, inputs }: HomeInput): Home {
  const homePaced = homePace(pace);
  return {
    runway: basis ? homeRunway(ctx, basis) : null,
    lowPoint: basis ? lowPoint(ctx, basis, balances, inputs, lowPointDays(basis.ahead)) : null,
    balancePast: basis ? homeBalancePast(ctx, basis, balances) : null,
    pace: homePaced,
    paceGap: pace.expected ? null : pace.cardGap ? "cards" : "history",
    direction: homeDirection(ctx, balances, inputs),
    reliability: homeReliability(ctx),
  };
}
