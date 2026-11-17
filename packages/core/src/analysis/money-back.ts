/**
 * Money the household can ask a merchant to give back: a charge made twice and a charge after a subscription was
 * marked Lopetettu. Tarkistettavat asks about each one. Both come from the definitions the alerts use
 * (double-charges.ts, subscription-alerts.ts), so a charge the merchant has paid back is no finding.
 * Decision: the household asks a merchant for money back, or says the charge is right.
 *
 * The answer is the mark of the alert, `alert:<id>`: `dismissed` is "the charge is right", `in_use` is "I asked for the
 * refund", and `cancelled` is "I asked again", which closes the question for good. A question asked for a refund waits
 * `REFUND_WAIT_DAYS`, then comes back once with the day it was asked.
 * The id of a charge after Lopetettu is the mark's (`cancelled:<mark subject>@<day>`), so one answer covers the item
 * while charges keep coming. An answer settles the charges booked up to its day: a later charge is a new question for
 * only the new charges.
 */
import { addDays } from "../dates.ts";
import { MONEY_BACK_DAYS, REFUND_WAIT_DAYS } from "../thresholds.ts";
import type { IsoDate, UserMark } from "../types.ts";
import type { AnalysisContext, AnalysisTx } from "./context.ts";
import { inDays } from "./context.ts";
import { findDoubleCharges, isCharge } from "./double-charges.ts";
import { toDayRange } from "./period.ts";
import { cancelledCharges, markedDay, marksBySubject } from "./subscription-alerts.ts";

export interface MoneyBack {
  /** The id of the alert it is: `double:<row>` for a double charge, `cancelled:<mark subject>@<day>` after Lopetettu. */
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

/** What is found before the answers: `charges` are the rows of a charge after Lopetettu, which an answer can settle in part. */
type Finding = Omit<MoneyBack, "subject" | "askedOn"> & { charges?: AnalysisTx[] };

/** The subject of the answer to an alert about money back. */
const moneyBackSubject = (id: string): string => `alert:${id}`;

/** What an answer means on `today`: whether the question is open, the day the refund was asked, and the day up to which charges are settled. */
function answerOn(mark: UserMark | undefined, today: IsoDate): { open: boolean; askedOn: IsoDate | null; settledThrough: IsoDate | null } {
  if (!mark) return { open: true, askedOn: null, settledThrough: null };
  if (mark.mark !== "in_use") return { open: true, askedOn: null, settledThrough: markedDay(mark) };
  const asked = markedDay(mark);
  return today >= addDays(asked, REFUND_WAIT_DAYS) ? { open: true, askedOn: asked, settledThrough: null } : { open: false, askedOn: null, settledThrough: null };
}

const owedBy = (charges: readonly AnalysisTx[]) => charges.reduce((sum, t) => sum - t.amountCents - t.refunded, 0);

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
  const cancelled: Finding[] = cancelledCharges(current.filter(isCharge), marksBySubject(marks), ctx.recurring).map((c) => ({
    id: `cancelled:${c.mark.subject}@${markedDay(c.mark)}`,
    kind: "cancelled" as const,
    merchant: c.merchant,
    cents: c.netCents,
    rowIds: c.charges.map((t) => t.id),
    lastDate: c.charges[c.charges.length - 1]!.bookingDate,
    charges: c.charges,
  }));
  // the same rows are asked about once: a double charge after Lopetettu is the charge after Lopetettu
  const covered = new Set(cancelled.flatMap((c) => c.rowIds));
  const doubles: Finding[] = findDoubleCharges(ctx, current, ctx.recurring, range)
    .filter((d) => !d.rowIds.some((id) => covered.has(id)))
    .map((d) => ({ id: d.id, kind: "double" as const, merchant: d.merchant, cents: d.amountCents * (d.count - 1) - d.refundedCents, rowIds: d.rowIds, lastDate: d.dates[d.dates.length - 1]! }));

  return [...doubles, ...cancelled]
    .flatMap((f): MoneyBack[] => {
      const subject = moneyBackSubject(f.id);
      const { open, askedOn, settledThrough } = answerOn(answers.get(subject), today);
      if (!open) return [];
      const from = startOf(askedOn ?? today);
      if (f.kind === "double") return settledThrough === null && f.lastDate >= from && f.cents > 0 ? [{ ...f, subject, askedOn }] : [];
      const charges = (f.charges ?? []).filter((t) => t.bookingDate >= from && (settledThrough === null || t.bookingDate > settledThrough));
      const cents = owedBy(charges);
      if (!charges.length || cents <= 0) return [];
      return [{ id: f.id, kind: f.kind, merchant: f.merchant, cents, rowIds: charges.map((t) => t.id), lastDate: charges[charges.length - 1]!.bookingDate, subject, askedOn }];
    })
    .sort((a, b) => b.cents - a.cents || b.lastDate.localeCompare(a.lastDate));
}
