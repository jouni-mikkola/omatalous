/**
 * Decision: whether a running month is doing better or worse than the month before on the same days. A monthly fixed
 * cost (rent, a loan instalment) that the month before booked by this day and this month has not booked yet makes the
 * month before look dearer, and one booked here earlier makes this month look dearer. Such a payment is a difference of
 * timing, so the comparison leaves it out on the side that has it and the month's own totals stay whole.
 */
import { isCancelled, isFixedCost } from "../commitments.ts";
import type { RecurringSeries } from "../recurring.ts";
import type { AnalysisTx } from "./context.ts";

/** The ids of the rows a comparison of two periods leaves out, on each side. */
interface UnmatchedFixed {
  now: ReadonlySet<string>;
  previous: ReadonlySet<string>;
}

/**
 * For each monthly fixed series, the payments one period holds more of than the other: the latest of them, so a payment
 * that came in both periods stays on both sides. `cancelled` comes from `cancelledSubjects`; a series the household
 * cancelled is no fixed cost and is compared as any other rows.
 */
export function unmatchedFixed(series: readonly RecurringSeries[], cancelled: ReadonlySet<string>, now: readonly AnalysisTx[], previous: readonly AnalysisTx[]): UnmatchedFixed {
  const nowById = new Map(now.map((t) => [t.id, t]));
  const previousById = new Map(previous.map((t) => [t.id, t]));
  const out = { now: new Set<string>(), previous: new Set<string>() };
  for (const s of series) {
    if (s.cadence !== "monthly" || !isFixedCost(s) || isCancelled(cancelled, s)) continue;
    const rowsIn = (by: ReadonlyMap<string, AnalysisTx>) => s.transactionIds.flatMap((id) => by.get(id) ?? []).sort((a, b) => a.day - b.day);
    const here = rowsIn(nowById);
    const before = rowsIn(previousById);
    const extra = before.length - here.length;
    const [side, rows] = extra > 0 ? [out.previous, before] : [out.now, here];
    for (const t of rows.slice(rows.length - Math.abs(extra))) side.add(t.id);
  }
  return out;
}
