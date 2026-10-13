/**
 * What each member of a joint account paid in, bore of its costs and moved away, month by month, and what is left of
 * whose money. It only adds up the parts of a settled trace (money-trace.ts): nothing here is cut, so the columns of a
 * month add up to the account's rows of that month and the balances to the walked balance at its end, to the cent.
 */
import { fromDayNumber, monthOf } from "./dates.ts";
import { isUserOwner, type Owner, type Trace } from "./money-trace.ts";

/** One member's figures of a month; the last column of a month is every part no member owns (`owner` null). */
interface SourceColumn {
  owner: Owner | null;
  /** Parts of money in that was the payer's own, a payment, money from another pool or unknown money. */
  paidInCents: number;
  /** Parts of money out for all, less the parts of refunds of them and money back: below zero when the refunds are more. */
  costsCents: number;
  /** Parts of money out for one person and to another pool, less the parts of refunds of rows for one person. */
  movedCents: number;
  /** What this member took out of other members' money in rows for them, by the taker, less what refunds of those rows gave back. Not part of the balance. */
  takenCents: number;
  /** What is left of this member's money at the month's end: below zero while a cost waits for the money that paid it. */
  leftCents: number;
}

interface MonthSources {
  month: string;
  columns: SourceColumn[];
}

/** The kinds of money in that are somebody's own money arriving; every other kind in a row of money in gives a cost back. */
const PAID_IN = new Set(["own", "payment", "pool", "unknown"]);

/** A row only one of two disagreeing copies has: unknown whole, neither taking nor making a lot (see `trace`). */
const isUnmatched = (parts: Trace["rows"][number]["parts"]): boolean => parts.length === 1 && parts[0]!.owner === "g:text:unmatched" && parts[0]!.kind === "unknown";

/**
 * The months with a booked row, newest first, a column for each of `users` (members, in the order given) and one for
 * the rest. `left` is walked backward from the lots that remain less the open credit, so the opening needs no rule of
 * its own. Pending rows are not counted. The trace should be the settled one: the answers have relabelled its owners.
 */
export function sourcesByMonth(t: Trace, users: readonly Owner[]): MonthSources[] {
  const slot = new Map(users.filter(isUserOwner).map((u, i) => [u, i] as const));
  const width = slot.size + 1;
  const at = (owner: Owner): number => slot.get(owner) ?? width - 1;
  const empty = (): number[] => new Array<number>(width).fill(0);

  const months = new Map<string, { paidIn: number[]; costs: number[]; moved: number[]; taken: number[] }>();
  for (const row of t.rows) {
    if (row.pending || row.cents === 0 || isUnmatched(row.parts)) continue;
    const month = monthOf(fromDayNumber(row.day));
    let m = months.get(month);
    if (!m) months.set(month, (m = { paidIn: empty(), costs: empty(), moved: empty(), taken: empty() }));
    for (const p of row.parts) {
      const i = at(p.owner);
      if (row.what === "in") {
        if (PAID_IN.has(p.kind)) m.paidIn[i]! += p.cents;
        else if (row.refundFor !== undefined && p.kind !== "back") {
          // the refund of a row for one person takes back what that row was counted in
          m.moved[i]! -= p.cents;
          if (isUserOwner(p.owner) && p.owner !== row.refundFor) m.taken[at(row.refundFor)]! -= p.cents;
        } else m.costs[i]! -= p.cents;
      } else if (row.what === "all") m.costs[i]! += p.cents;
      else {
        m.moved[i]! += p.cents;
        // a part paid on credit gets its payer later and has no flag: it is the taker's when its owner is another member
        if (row.to !== undefined && isUserOwner(p.owner) && p.owner !== row.to) m.taken[at(row.to)]! += p.cents;
      }
    }
  }

  // the end of the history first: the lots that are left, less the credit nobody has paid yet
  const left = empty();
  for (const lot of t.lots) left[at(lot.owner)]! += lot.cents;
  left[width - 1]! -= t.creditCents;

  const out: MonthSources[] = [];
  for (const month of [...months.keys()].sort().reverse()) {
    const m = months.get(month)!;
    out.push({
      month,
      columns: [...users.filter(isUserOwner), null].map((owner, i): SourceColumn => ({
        owner,
        paidInCents: m.paidIn[i]!,
        costsCents: m.costs[i]!,
        movedCents: m.moved[i]!,
        takenCents: m.taken[i]!,
        leftCents: left[i]!,
      })),
    });
    // the month before ended with what this one began with
    for (let i = 0; i < width; i++) left[i]! += m.costs[i]! + m.moved[i]! - m.paidIn[i]!;
  }
  return out;
}
