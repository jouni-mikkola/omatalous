/**
 * Nyt: how much can we still spend before payday? The four figures of the view from one place.
 *
 * The sum left is what the counted accounts hold today less what leaves them before the payday (`Käytettävissä`,
 * `cashAhead`): the bills, the card's bill and the own transfers of the window. No everyday spending is taken off: the
 * view sets the sum per day left against the usual everyday spending of a day instead (`expectedEverydayPerDay`).
 *
 * The pace is the running month's spending to today against the band of the expected month to the same day
 * (`expectedFor`, ADR 0021): the band the pace chart draws under the sentence and the figure Kuukausi names as usual.
 */
import { daysBetween, monthOf } from "../dates.ts";
import type { IsoDate } from "../types.ts";
import { type AheadBasis, upcomingElsewhereCents } from "./ahead.ts";
import { type AnalysisContext, standingOf } from "./context.ts";
import { expectedFor } from "./expected.ts";
import { monthPace } from "./forecast.ts";
import { INCOME_TYPES, incomeTypes, payersOf } from "./income.ts";
import { payEvidence } from "./pay-estimate.ts";
import { paydayOf } from "./runway.ts";

/** The usual spending on the days 1 to `day` of a month: the range of the expected month at that day (`ExpectedAt`). */
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
        /**
         * What accounts the balance leaves out pay before the payday (`ahead.outside`, which runs to the payday when it is more than 30 days off): in no figure
         * above, so the page says it beside `billsCents`, which reads 0 when only such an account pays.
         */
        elsewhereCents: number;
      };
  /** What everyday spending usually takes a day in the running month (`expectedEverydayPerDay`). null without a figure. */
  usualPerDayCents: number | null;
  pace: {
    /** Today's day of the month. */
    day: number;
    /** The running month's spending on its days 1 to `day` (`spendingThrough`). */
    spentCents: number;
    /** null without an expected month: under `MIN_COMPARE_MONTHS` complete months, or when they lack the purchases of a linked card. */
    usual: UsualBand | null;
  };
}

/**
 * The band of `month` to its `day`: the one the pace chart draws (`MonthPace.expected`). A second band read straight
 * from the base months' quartiles stood here before, and the sentence above the chart named other sums than the chart showed.
 */
function usualBand(ctx: AnalysisContext, month: string, day: number): UsualBand | null {
  const figure = expectedFor(ctx, month);
  if (!figure || !figure.itemised) return null;
  const at = figure.at(day);
  return { lowCents: at.lowCents, highCents: at.highCents, months: figure.months.length };
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
  const elsewhereCents = upcomingElsewhereCents(ahead.outside.filter((r) => r.date < payday.date));
  return { known: true, payday, days, balanceCents, billsCents, leftCents, perDayCents: days > 0 ? Math.round(leftCents / days) : leftCents, elsewhereCents };
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
    // the rows of the pace chart and of the band (`spendRows`), so the sum is the one the chart's line ends on
    pace: { day, spentCents: monthPace(ctx, month, from).currentTotal, usual: usualBand(ctx, month, day) },
  };
}
