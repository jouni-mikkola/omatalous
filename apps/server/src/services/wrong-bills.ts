/**
 * A bill the app found in the rows and the member says is no recurring bill: the mark `not-recurring:<series key>`
 * (`dismissed`), and the context without the series it names. The key is the one a mark on the series carries after
 * `series:` (core `seriesMarkSubject`), so it holds over a new charge and a change of price as that mark does.
 *
 * The cached context keeps every series: it is shared by what does not ask the marks, and a mark moves no data
 * version. What is coming and its sums (the coming list, the Nyt sum, Laskut) read the context
 * through `withoutWrongBills`. The member's own marks count in both views, as every mark does.
 */
import { type AnalysisContext, isCancelled, seriesOfMarkSubject, type UserMark } from "@banking/core";
import { memoOn } from "./context-memo.ts";

/** The subject prefix of the mark. */
export const NOT_RECURRING = "not-recurring:";

/** The mark on the series a subject names, as core reads one (`series:<key>`), or null for any other subject and a key no series has. */
export function wrongBillKey(subject: string): string | null {
  if (!subject.startsWith(NOT_RECURRING)) return null;
  const key = `series:${subject.slice(NOT_RECURRING.length)}`;
  return seriesOfMarkSubject(key)?.accountId ? key : null;
}

/**
 * The context without the series the member marked as no recurring bill; the same context when there is no such mark.
 * One context per set of marks (kept in the memo of the context), so what the context keeps (the dashboard's answers,
 * core's own) is found again. A member changes these marks now and then; an older set is built again when asked.
 */
export function withoutWrongBills(ctx: AnalysisContext, marks: readonly UserMark[]): AnalysisContext {
  const keys = marks.flatMap((m) => (m.mark === "dismissed" ? [wrongBillKey(m.subject)] : [])).filter((k): k is string => k !== null).sort();
  if (!keys.length) return ctx;
  return memoOn(ctx, "without-wrong-bills", keys, () => {
    const wrong = new Set(keys);
    const without = (c: AnalysisContext): AnalysisContext => {
      const recurring = c.recurring.filter((r) => !isCancelled(wrong, r));
      const standing = c.standing && without(c.standing);
      return recurring.length === c.recurring.length && standing === c.standing ? c : { ...c, recurring, ...(standing ? { standing } : {}) };
    };
    return without(ctx);
  });
}
