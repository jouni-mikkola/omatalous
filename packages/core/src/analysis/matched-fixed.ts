/**
 * Decision: whether a running month is doing better or worse than the month before on the same days. A monthly fixed
 * cost (rent, a loan instalment) that the month before booked by this day and this month has not booked yet makes the
 * month before look dearer, and one this month booked earlier than the month before did makes this month look dearer.
 * Such a payment is a difference of timing, so the month before is read with each monthly fixed series' payments counted
 * as many times as this month has them: its extra payment by this day is left out, a payment it books later is added.
 * One matched basis, read by Menot's and Tulos's "last month, same day" lines alike; the month's own totals stay whole.
 */
import { isCancelled, isFixedCost } from "../commitments.ts";
import type { RecurringSeries } from "../recurring.ts";
import type { AnalysisTx } from "./context.ts";

/** The ids of the rows the month before is read without by this day, and of its later rows it is read with. */
export interface MatchedPrevious {
  dropped: ReadonlySet<string>;
  added: ReadonlySet<string>;
}

/**
 * For each monthly fixed series, the payments of this month (`now`) set against those of the month before by the same
 * day (`sameDay`): when the month before has more, its latest ones are `dropped`; when it has fewer, the earliest ones
 * it books after that day (`later`, the rest of that month) are `added`. A series' payments are its own rows and the
 * rows that settled one of its occurrences from another account or under another payee name (`settled`), so a rent
 * paid from elsewhere this month is still this month's rent. `cancelled` comes from `cancelledSubjects`; a series the
 * household cancelled is no fixed cost and is compared as any other rows.
 */
export function matchPrevious(
  series: readonly RecurringSeries[],
  cancelled: ReadonlySet<string>,
  now: readonly AnalysisTx[],
  sameDay: readonly AnalysisTx[],
  later: readonly AnalysisTx[],
): MatchedPrevious {
  const byId = (rows: readonly AnalysisTx[]) => new Map(rows.map((t) => [t.id, t]));
  const [nowById, sameDayById, laterById] = [byId(now), byId(sameDay), byId(later)];
  const out = { dropped: new Set<string>(), added: new Set<string>() };
  for (const s of series) {
    if (s.cadence !== "monthly" || !isFixedCost(s) || isCancelled(cancelled, s)) continue;
    const ids = [...s.transactionIds, ...(s.settled ?? []).map((paid) => paid.id)];
    const rowsIn = (by: ReadonlyMap<string, AnalysisTx>) => ids.flatMap((id) => by.get(id) ?? []).sort((a, b) => a.day - b.day);
    const here = rowsIn(nowById).length;
    const before = rowsIn(sameDayById);
    if (before.length > here) for (const t of before.slice(here)) out.dropped.add(t.id);
    else if (here > before.length) for (const t of rowsIn(laterById).slice(0, here - before.length)) out.added.add(t.id);
  }
  return out;
}
