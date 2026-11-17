/**
 * Money the household can ask a merchant to give back: a charge made twice and a charge after a subscription was
 * marked Lopetettu. Tarkistettavat asks about each one. Both come from the definitions the alerts use
 * (double-charges.ts, subscription-alerts.ts), so a charge the merchant has paid back is no finding.
 * Decision: the household asks a merchant for money back, or says the charge is right.
 *
 * The answer is the mark of the alert, `alert:<id>`: `dismissed` is "the charge is right", `in_use` is "I asked for the
 * refund", and `cancelled` is "I asked again", which closes the question for good. A question asked for a refund waits
 * `REFUND_WAIT_DAYS`, then comes back once with the day it was asked.
 */
import { addDays } from "../dates.ts";
import { MONEY_BACK_DAYS, REFUND_WAIT_DAYS } from "../thresholds.ts";
import type { IsoDate, UserMark } from "../types.ts";
import type { AnalysisContext } from "./context.ts";
import { inDays } from "./context.ts";
import { findDoubleCharges, isCharge } from "./double-charges.ts";
import { toDayRange } from "./period.ts";
import { cancelledCharges, markedDay, marksBySubject } from "./subscription-alerts.ts";

export interface MoneyBack {
  /** The id of the alert it is: `double:<row>` or `cancelled:<row>`. */
  id: string;
  kind: "double" | "cancelled";
  merchant: string;
  /** What the merchant owes: the extra charges, the refunds taken off. Positive. */
  cents: number;
  rowIds: string[];
  /** The day of the latest of the charges. */
  lastDate: IsoDate;
  /** The mark an answer is stored under. */
  subject: string;
  /** The day the household asked for the refund, when the question comes back for it. */
  askedOn: IsoDate | null;
}

/** The subject of the answer to an alert about money back. */
const moneyBackSubject = (id: string): string => `alert:${id}`;

/** Whether an answer leaves the question open on `today`, and the day the refund was asked on when it does. */
function openAfter(mark: UserMark | undefined, today: IsoDate): { open: boolean; askedOn: IsoDate | null } {
  if (!mark) return { open: true, askedOn: null };
  if (mark.mark !== "in_use") return { open: false, askedOn: null };
  const asked = markedDay(mark);
  return today >= addDays(asked, REFUND_WAIT_DAYS) ? { open: true, askedOn: asked } : { open: false, askedOn: null };
}

/** The open questions of money back on `today`, the most money first: the last `MONEY_BACK_DAYS` days of the household's own rows. */
export function moneyBackOf(ctx: AnalysisContext, marks: readonly UserMark[], today: IsoDate): MoneyBack[] {
  const range = { from: addDays(today, -MONEY_BACK_DAYS), to: today };
  const current = inDays(ctx, toDayRange(range));
  const found: Omit<MoneyBack, "subject" | "askedOn">[] = [
    ...findDoubleCharges(ctx, current, ctx.recurring, range).map((d) => ({ id: d.id, kind: "double" as const, merchant: d.merchant, cents: d.amountCents * (d.count - 1), rowIds: d.rowIds, lastDate: d.dates[d.dates.length - 1]! })),
    ...cancelledCharges(current.filter(isCharge), marksBySubject(marks), ctx.recurring).map((c) => ({ id: c.id, kind: "cancelled" as const, merchant: c.merchant, cents: c.netCents, rowIds: c.charges.map((t) => t.id), lastDate: c.charges[c.charges.length - 1]!.bookingDate })),
  ];
  const answers = new Map(marks.map((m) => [m.subject, m]));
  return found
    .flatMap((f): MoneyBack[] => {
      const subject = moneyBackSubject(f.id);
      const { open, askedOn } = openAfter(answers.get(subject), today);
      return open && f.cents > 0 ? [{ ...f, subject, askedOn }] : [];
    })
    .sort((a, b) => b.cents - a.cents || b.lastDate.localeCompare(a.lastDate));
}
