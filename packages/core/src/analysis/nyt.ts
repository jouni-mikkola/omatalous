/**
 * Nyt: how much can we still spend before payday? The four figures of the view from one place.
 *
 * The sum left is what the counted accounts hold today less what leaves them before the payday (`Käytettävissä`,
 * `cashAhead`): the bills, the card's bill and the own transfers of the window. No everyday spending is taken off: the
 * view sets the sum per day left against the usual everyday spending of a day instead (`expectedEverydayPerDay`).
 *
 * The pace is the running month's spending to today against the band of `usual.ts`: the lower to the upper quartile of
 * what the complete months before (`completeMonthsBefore`) had spent by the same day (`spendingThrough`).
 */
import { daysBetween, monthOf } from "../dates.ts";
import { MIN_COMPARE_MONTHS, RANGE_HIGH, RANGE_LOW } from "../thresholds.ts";
import type { IsoDate } from "../types.ts";
import type { AheadBasis } from "./ahead.ts";
import { type AnalysisContext, standingOf } from "./context.ts";
import { quantile } from "./expected.ts";
import { INCOME_TYPES, incomeTypes, payersOf } from "./income.ts";
import { payEvidence } from "./pay-estimate.ts";
import { paydayOf } from "./runway.ts";
import { cardsBreakUsual, completeMonthsBefore, spendingThrough } from "./usual.ts";

/** The usual spending on the days 1 to `day` of a month: the lower and the upper quartile of the base months. */
interface UsualBand {
  lowCents: number;
  highCents: number;
  /** How many complete months it is read from. */
  months: number;
}

export interface NytAnswer {
  from: IsoDate;
  /**
   * The sum left before the payday. Not known with "no-payday" (no regular pay to wait for, or one behind its day with
   * no next one), "late" (the largest regular income is late) or "no-balance" (a counted checking account has no balance).
   */
  left:
    | { known: false; reason: "late" }
    | { known: false; reason: "no-balance" }
    /** `found`: the salary pays seen so far from the payer with most of them; the estimate waits for `MIN_PAYS`. */
    | { known: false; reason: "no-payday"; found: number }
    | {
        known: true;
        /** The pay the sum lasts to, and who pays it. */
        payday: { date: IsoDate; name: string };
        /** The days from today to the day before the payday, today included: 0 when the payday is today. */
        days: number;
        /** What the counted accounts hold today. */
        balanceCents: number;
        /** What leaves them before the payday: the payments and the own transfers of the window. */
        billsCents: number;
        /** `Käytettävissä` (`freeCents`): `balanceCents` less `billsCents`. Below zero when the bills exceed the balance. */
        leftCents: number;
        /** `leftCents` over `days`, in whole cents; `leftCents` itself when the payday is today. */
        perDayCents: number;
      };
  /** What everyday spending usually takes a day in the running month (`expectedEverydayPerDay`). null without a figure. */
  usualPerDayCents: number | null;
  pace: {
    /** Today's day of the month. */
    day: number;
    /** The running month's spending on its days 1 to `day` (`spendingThrough`). */
    spentCents: number;
    /** null under `MIN_COMPARE_MONTHS` complete months, or when they lack the purchases of a linked card (`cardsBreakUsual`). */
    usual: UsualBand | null;
  };
}

/** The band of `month` to its `day`, from the complete months before it. */
function usualBand(ctx: AnalysisContext, month: string, day: number): UsualBand | null {
  const months = completeMonthsBefore(ctx, month);
  if (months.length < MIN_COMPARE_MONTHS || cardsBreakUsual(ctx, month)) return null;
  const sorted = months.map((m) => spendingThrough(ctx, m, day)).sort((a, b) => a - b);
  return { lowCents: quantile(sorted, RANGE_LOW), highCents: quantile(sorted, RANGE_HIGH), months: months.length };
}

/** The regular pays an estimate would rest on (`payEvidence`), from the payer with most of them. */
function paysFound(ctx: AnalysisContext): number {
  const txs = standingOf(ctx).txs;
  const types = incomeTypes(txs);
  const counts = [...payersOf(txs).values()].map(
    (rows) => payEvidence(rows.filter((t) => INCOME_TYPES[types.get(t.id) ?? "other_income"].regular).map((t) => ({ id: t.id, date: t.bookingDate, cents: t.amountCents })), ctx.today).length,
  );
  return Math.max(0, ...counts);
}

function leftOf(ctx: AnalysisContext, { ahead }: Pick<AheadBasis, "ahead">): NytAnswer["left"] {
  const payday = paydayOf(ahead);
  if (!payday) return ahead.reason === "late" ? { known: false, reason: "late" } : { known: false, reason: "no-payday", found: paysFound(ctx) };
  if (!ahead.balance) return { known: false, reason: "no-balance" };
  const days = daysBetween(ahead.from, payday.date);
  const balanceCents = ahead.balance.startCents;
  const billsCents = ahead.totals.leavingCents;
  const leftCents = ahead.balance.freeCents;
  return { known: true, payday, days, balanceCents, billsCents, leftCents, perDayCents: days > 0 ? Math.round(leftCents / days) : leftCents };
}

/** The sum left before the payday, the days left, the usual everyday spending of a day and the pace band. */
export function nytAnswer(ctx: AnalysisContext, basis: Pick<AheadBasis, "ahead">): NytAnswer {
  const { from } = basis.ahead;
  const month = monthOf(from);
  const day = Number(from.slice(8, 10));
  return {
    from,
    left: leftOf(ctx, basis),
    usualPerDayCents: basis.ahead.everydayPerDayCents || null,
    pace: { day, spentCents: spendingThrough(ctx, month, day), usual: usualBand(ctx, month, day) },
  };
}
