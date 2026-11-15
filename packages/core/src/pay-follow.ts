/**
 * A bill the household pays by hand when the pay arrives has no day of its own: it comes when the pay comes, on the
 * Friday when the 10th is a Saturday. Such a series follows the pay, and its next day is the pay's next day and not a
 * month from its last charge. A pay is a regular income with a pay day (`payDayOf`): the day of the month and the way a
 * closed day moves it, the same rule that gives the payday of the window on the first page.
 */
import { addDays, addMonths, daysBetween, monthOf } from "./dates.ts";
import { type PayDay, payDate, payDayOf } from "./pay-day.ts";
import type { RecurringSeries } from "./recurring.ts";
import { DAY_SAMPLE, MIN_DAY_SAMPLE } from "./recurring-cadence.ts";
import { median } from "./stats.ts";
import type { IsoDate } from "./types.ts";

/** A charge on the day of a pay or at most this many days after it was paid from that pay. */
const AFTER_PAY_DAYS = 3;
/** A charge more than this many days before a pay did not wait for it: the series follows no pay. */
const BEFORE_PAY_DAYS = 1;

/** How a series follows a pay: the day of the month of the pay, the way a closed day moves it, and the usual days of the series after the pay. */
export interface PayFollow extends Pick<PayDay, "day" | "rule"> {
  afterDays: number;
}

/** The pay day nearest to `date` by the rule: the one of its month or of the month beside it. */
function payDayNear(date: IsoDate, rule: Pick<PayDay, "day" | "rule">): IsoDate {
  const far = (d: IsoDate) => Math.abs(daysBetween(d, date));
  return [0, -1, 1].map((k) => payDate(addMonths(monthOf(date), k), rule)).reduce((best, d) => (far(d) < far(best) ? d : best));
}

/** The day a series that follows a pay comes on, for the day it would come on by its own dates: the nearest pay day, plus its days after the pay. */
export function followDay(ownDay: IsoDate, follow: PayFollow): IsoDate {
  return addDays(payDayNear(addDays(ownDay, -follow.afterDays), follow), follow.afterDays);
}

/**
 * How many days after the pay the series' latest charges came, as their median, or null when the series does not follow
 * the pay. Each charge is held against the pay booked nearest to it, of two as near the earlier one. The series follows
 * when all but at most one of its last six charges came on the day of their pay or within three days after it, and
 * none more than a day before it. A charge older than the first pay cannot be told and is left out; under three
 * charges nothing is said.
 */
function daysAfterPay(charges: readonly IsoDate[], paid: readonly IsoDate[]): number | null {
  const told = charges.filter((c) => c >= addDays(paid[0]!, -BEFORE_PAY_DAYS)).slice(-DAY_SAMPLE);
  if (told.length < MIN_DAY_SAMPLE) return null;
  const after: number[] = [];
  for (const c of told) {
    const days = paid.reduce((best, p) => (Math.abs(daysBetween(p, c)) < Math.abs(best) ? daysBetween(p, c) : best), Number.POSITIVE_INFINITY);
    if (days < -BEFORE_PAY_DAYS) return null;
    if (days >= 0 && days <= AFTER_PAY_DAYS) after.push(days);
  }
  return told.length - after.length <= 1 ? Math.round(median(after)) : null;
}

/**
 * The series that follow a pay, each with the pay it follows. Money out only; of two pays a series fits, the larger.
 * `datesOf` gives the days the rows of a series were booked on, oldest first.
 */
export function payFollowOf(series: readonly RecurringSeries[], datesOf: (s: RecurringSeries) => IsoDate[]): Map<RecurringSeries, PayFollow> {
  const out = new Map<RecurringSeries, PayFollow>();
  const pays = series
    .filter((s) => s.kind === "income")
    .sort((a, b) => b.typicalAmountCents - a.typicalAmountCents)
    .flatMap((s) => {
      const paid = datesOf(s);
      const rule = payDayOf(paid);
      return rule ? [{ paid, rule }] : [];
    });
  if (!pays.length) return out;
  for (const s of series) {
    if (s.kind === "income" || !s.nextDate) continue;
    const charges = datesOf(s);
    for (const { paid, rule } of pays) {
      const afterDays = daysAfterPay(charges, paid);
      if (afterDays === null) continue;
      out.set(s, { day: rule.day, rule: rule.rule, afterDays });
      break;
    }
  }
  return out;
}
