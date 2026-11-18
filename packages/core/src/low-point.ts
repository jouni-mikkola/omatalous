/**
 * Decision: does the money hold out past the next payday, and if it dips, on which day and how far, so the household
 * moves money or puts a purchase off before that day.
 *
 * Alin saldo walks the counted accounts' balance of today through the rows of the bill calendar (`billCalendar`: the
 * bills, the loan payments, the regular savings and the pays) day by day for `days` days, today included, and takes
 * the expected everyday spending off as it goes. A pay counts for the payments of the days after its own: on a day
 * with a payment and a pay, the payment is met from the balance before it, as in `aheadBasis`. The everyday spending
 * is what `runwayOf` takes off (`expectedEveryday`): what the counted accounts pay themselves, and a card's purchases
 * once its next bill falls. With none of it, the lowest point is the one `aheadBasis` finds (`shortOn`, `shortCents`).
 *
 * The lowest day is the one of the expected everyday spending. The range is the lowest balance when the base months
 * with the most everyday spending repeat to when the ones with the least do, so `lowCents <= cents <= highCents`.
 * Without a payday, a balance or a history to expect everyday spending from, it gives the reason `runwayOf` gives.
 */
import type { AheadBasis } from "./analysis/ahead.ts";
import type { AnalysisContext } from "./analysis/context.ts";
import { expectedEveryday } from "./analysis/expected.ts";
import { type Runway, runwayOf } from "./analysis/runway.ts";
import { addDays, monthOf } from "./dates.ts";
import { billCalendar } from "./reports/bill-calendar.ts";
import { LOW_POINT_DAYS } from "./thresholds.ts";
import type { BalanceInput, IsoDate, UserInputs } from "./types.ts";

export type LowPoint =
  | { known: false; reason: Extract<Runway, { known: false }>["reason"] }
  | {
      known: true;
      /** The day the balance is lowest, the first of them when two days tie. */
      date: IsoDate;
      /** The lowest balance with the expected everyday spending taken off, and its range. Below zero when the accounts do not hold out. */
      cents: number;
      lowCents: number;
      highCents: number;
      /** The days looked at, from today. */
      days: number;
    };

/** The expected everyday spending taken off by the end of a day: its mean, and the lower and upper quartile of the base months. */
interface Spent {
  cents: number;
  lowCents: number;
  highCents: number;
}

/** The lowest balance of the next `days` days, with the day it falls on; the reason when it cannot be said. */
export function lowPoint(ctx: AnalysisContext, basis: Pick<AheadBasis, "ahead" | "direct" | "settling">, balances: readonly BalanceInput[], inputs: UserInputs, days: number = LOW_POINT_DAYS): LowPoint {
  const { ahead, direct, settling } = basis;
  const runway = runwayOf(ctx, basis);
  if (!runway.known) return { known: false, reason: runway.reason };
  if (!direct) return { known: false, reason: "no-balance" };
  const { from } = ahead;
  const last = addDays(from, days - 1);
  const rows = billCalendar(ctx, inputs, balances).months.flatMap((m) => m.rows).filter((r) => r.state !== "paid" && !r.onCard && r.date >= from && r.date <= last);
  const income = rows.filter((r) => r.kind === "income");
  const payments = rows.filter((r) => r.kind !== "income");

  // the purchases of a card that its next bill holds, from tomorrow to the day of that bill, as the runway takes them off
  const billed = settling.flatMap(({ cardId, date }) => {
    if (date > ahead.to || direct.has(cardId)) return [];
    const found = expectedEveryday(ctx, addDays(from, 1), date, (t) => t.accountId === cardId, monthOf(from));
    return typeof found === "string" ? [] : [{ date, found }];
  });
  // what has gone on everyday spending by the start of `day`, whose own days are not spent yet
  const spentBefore = (day: IsoDate): Spent => {
    const own = expectedEveryday(ctx, from, addDays(day, -1), (t) => direct.has(t.accountId));
    const base: Spent = typeof own === "string" ? { cents: 0, lowCents: 0, highCents: 0 } : own;
    return billed.filter((b) => b.date <= day).reduce((sum, b) => ({ cents: sum.cents + b.found.cents, lowCents: sum.lowCents + b.found.lowCents, highCents: sum.highCents + b.found.highCents }), base);
  };

  // the balance only falls between two rows, so its lowest points are the days of a row and the last day
  const checked = [...new Set([...rows.map((r) => r.date), last])].sort();
  const sum = (list: typeof rows, keep: (date: IsoDate) => boolean) => list.reduce((total, r) => (keep(r.date) ? total + r.cents : total), 0);
  let point = { date: last, cents: Infinity };
  let [lowest, highest] = [Infinity, Infinity];
  for (const day of checked) {
    const held = runway.balanceCents + sum(income, (d) => d < day) - sum(payments, (d) => d <= day);
    const spent = spentBefore(day);
    const cents = held - spent.cents;
    if (cents < point.cents) point = { date: day, cents };
    lowest = Math.min(lowest, held - spent.highCents);
    highest = Math.min(highest, held - spent.lowCents);
  }
  return { known: true, date: point.date, cents: point.cents, lowCents: lowest, highCents: highest, days };
}
