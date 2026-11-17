/**
 * The charges after a Lopetettu mark, cut into segments by the answers. A segment is the charges after the mark that no
 * earlier answer covers; its id is made of the mark and the segment's first charge, so it holds while later charges
 * come. An answer covers the charges of its segment up to the day it was given, and a charge after that day starts a
 * new segment with a new id. No answer is overwritten, so the settled boundary is the latest answered segment.
 * The review item (money-back.ts) and the warning of the alerts (subscription-alerts.ts) use the same ids, so one
 * answer settles both.
 * Decision: the household answers for the charges it has seen, and is asked again only for the ones it has not.
 */
import type { IsoDate, UserMark } from "../types.ts";
import { type AnalysisContext, type AnalysisTx, inDays } from "./context.ts";
import { isCharge } from "./double-charges.ts";
import { toDayRange } from "./period.ts";

/** The day a mark was made. The server writes the timestamp in the instance's time zone, so its date part is the local day. */
export const markedDay = (m: Pick<UserMark, "markedAt">): IsoDate => m.markedAt.slice(0, 10);

/** The subject an answer to an alert is stored under. */
export const alertSubject = (id: string): string => `alert:${id}`;

/** A short stable hash of a text (cyrb53), in base 36, so a long subject keeps the id under the limit of a mark's subject. */
function shortHash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** The charges one Lopetettu mark did not stop, oldest first. */
export interface ChargesAfterMark {
  merchant: string;
  mark: UserMark;
  charges: AnalysisTx[];
}

export interface CancelledSegment extends ChargesAfterMark {
  /** `cancelled:<hash of the mark's subject>@<day of the mark>@<first charge>`. */
  id: string;
  /** The answer to this segment, if the household gave one. */
  answer: UserMark | undefined;
  /** What the charges came to, the refunds taken off. */
  netCents: number;
}

/** The first day of any Lopetettu mark on a merchant or a series, or null when there is none. */
export function lopetettuSince(marks: readonly UserMark[]): IsoDate | null {
  let first: IsoDate | null = null;
  for (const m of marks) {
    const day = markedDay(m);
    if (m.mark === "cancelled" && (m.subject.startsWith("merchant:") || m.subject.startsWith("series:")) && (first === null || day < first)) first = day;
  }
  return first;
}

/** The charges from the first Lopetettu mark to `to`: a segment's id comes from its first charge, so they reach back to the mark, not to the start of a period. */
export function chargesSinceMarks(ctx: AnalysisContext, marks: readonly UserMark[], to: IsoDate): AnalysisTx[] {
  const from = lopetettuSince(marks);
  return from === null || from > to ? [] : inDays(ctx, toDayRange({ from, to })).filter(isCharge);
}

/** Cuts the charges after each mark into segments, the oldest first within a mark. `marks` are the household's marks, whose answers are `alert:<id>`. */
export function cancelledSegments(found: readonly ChargesAfterMark[], marks: readonly UserMark[]): CancelledSegment[] {
  const answers = new Map(marks.map((m) => [m.subject, m]));
  const out: CancelledSegment[] = [];
  for (const { merchant, mark, charges } of found) {
    for (let rest = charges; rest.length; ) {
      const id = `cancelled:${shortHash(mark.subject)}@${markedDay(mark)}@${rest[0]!.id}`;
      const answer = answers.get(alertSubject(id));
      // an answer covers the charges up to its day, and at least the first one
      const covered = answer ? Math.max(1, rest.filter((t) => t.bookingDate <= markedDay(answer)).length) : rest.length;
      const segment = rest.slice(0, covered);
      out.push({ id, merchant, mark, charges: segment, answer, netCents: segment.reduce((sum, t) => sum - t.amountCents - t.refunded, 0) });
      rest = rest.slice(covered);
    }
  }
  return out;
}
