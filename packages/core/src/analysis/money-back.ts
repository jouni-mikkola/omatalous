/**
 * Money the household can ask a merchant to give back: a charge made twice and a charge after a subscription was
 * marked Lopetettu. Tarkistettavat asks about each one. Both come from the definitions the alerts use
 * (double-charges.ts, subscription-alerts.ts), so a charge the merchant has paid back is no finding.
 * Decision: the household asks a merchant for money back, or says the charge is right.
 *
 * The answer is the mark of the alert, `alert:<id>`: `dismissed` is "the charge is right", `in_use` is "I asked for the
 * refund", and `cancelled` is "I asked again", which closes the question for good. A question asked for a refund waits
 * `REFUND_WAIT_DAYS`, then comes back once with the day it was asked.
 * The charges after Lopetettu are cut into segments (cancelled-segments.ts): an answer covers the charges of its
 * segment up to its day, so the refund asked for is those charges, and a later charge is a new item with its own id.
 * A charge that arrives late and is dated on or before the answer's day counts as covered: the rows carry no day
 * they were first seen on.
 */
import { addDays } from "../dates.ts";
import { MONEY_BACK_DAYS, REFUND_WAIT_DAYS } from "../thresholds.ts";
import type { IsoDate, UserMark } from "../types.ts";
import type { AnalysisContext } from "./context.ts";
import { inDays } from "./context.ts";
import { alertSubject, cancelledSegments, chargesSinceMarks, markedDay } from "./cancelled-segments.ts";
import { findDoubleCharges } from "./double-charges.ts";
import { toDayRange } from "./period.ts";
import { cancelledCharges, marksBySubject } from "./subscription-alerts.ts";

export interface MoneyBack {
  /** The id of the alert it is: `double:<row>` for a double charge, `cancelled:<hash>@<day>@<first charge>` after Lopetettu. */
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

/** What an answer means on `today`: whether the question is open, and the day the refund was asked when it comes back for it. */
function answerOn(mark: UserMark | undefined, today: IsoDate): { open: boolean; askedOn: IsoDate | null } {
  if (!mark) return { open: true, askedOn: null };
  if (mark.mark !== "in_use") return { open: false, askedOn: null };
  const asked = markedDay(mark);
  return today >= addDays(asked, REFUND_WAIT_DAYS) ? { open: true, askedOn: asked } : { open: false, askedOn: null };
}

/**
 * The open questions of money back on `today`, the most money first: the last `MONEY_BACK_DAYS` days of the household's
 * own rows, and for a question that comes back for a refund asked for, `MONEY_BACK_DAYS` before the day it was asked.
 */
export function moneyBackOf(ctx: AnalysisContext, marks: readonly UserMark[], today: IsoDate): MoneyBack[] {
  const startOf = (day: IsoDate) => addDays(day, -MONEY_BACK_DAYS);
  const answers = new Map(marks.map((m) => [m.subject, m]));
  const asked = marks.filter((m) => m.mark === "in_use" && m.subject.startsWith("alert:")).map(markedDay);
  const range = { from: asked.reduce((min, d) => (startOf(d) < min ? startOf(d) : min), startOf(today)), to: today };
  const current = inDays(ctx, toDayRange(range));
  const segments = cancelledSegments(cancelledCharges(chargesSinceMarks(ctx, marks, today), marksBySubject(marks), ctx.recurring), marks);
  // the same rows are asked about once: a double charge after Lopetettu is the charge after Lopetettu
  const covered = new Set(segments.flatMap((s) => s.charges.map((t) => t.id)));

  const doubles = findDoubleCharges(ctx, current, ctx.recurring, range)
    .filter((d) => !d.rowIds.some((id) => covered.has(id)))
    .flatMap((d): MoneyBack[] => {
      const subject = alertSubject(d.id);
      const { open, askedOn } = answerOn(answers.get(subject), today);
      const cents = d.amountCents * (d.count - 1) - d.refundedCents;
      const lastDate = d.dates[d.dates.length - 1]!;
      return open && lastDate >= startOf(askedOn ?? today) && cents > 0 ? [{ id: d.id, kind: "double", merchant: d.merchant, cents, rowIds: d.rowIds, lastDate, subject, askedOn }] : [];
    });

  const afterLopetettu = segments.flatMap((s): MoneyBack[] => {
    const subject = alertSubject(s.id);
    const { open, askedOn } = answerOn(s.answer, today);
    const from = startOf(askedOn ?? today);
    const charges = s.charges.filter((t) => t.bookingDate >= from);
    const cents = charges.reduce((sum, t) => sum - t.amountCents - t.refunded, 0);
    if (!open || !charges.length || cents <= 0) return [];
    return [{ id: s.id, kind: "cancelled", merchant: s.merchant, cents, rowIds: charges.map((t) => t.id), lastDate: charges[charges.length - 1]!.bookingDate, subject, askedOn }];
  });

  return [...doubles, ...afterLopetettu].sort((a, b) => b.cents - a.cents || b.lastDate.localeCompare(a.lastDate));
}
