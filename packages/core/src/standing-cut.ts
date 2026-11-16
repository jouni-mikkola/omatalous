/**
 * The cut of a pool's rows that what is ahead is read from. The past counts each row by who paid it (`applyUse` with
 * the viewer's shares); a series is detected on one stable cut instead, so a payment the partner made once does not
 * move its amount. The stable cut of a series is what the money trace says of its recent rows: the share of them the
 * viewer paid. With no row of the series that the trace tells whole, nothing says who will pay, and a split nobody
 * said is not guessed (ADR 0017): the viewer counts the bank's whole amount.
 */
import { billCents, isNone, isWhole, partCents } from "./account-use.ts";
import type { PaidOf } from "./money-trace-answers.ts";
import { uncutRow } from "./shared.ts";
import type { Part, Transaction } from "./types.ts";

/** How many of a series' latest rows tell who pays it: a year's quarterly bill and a half year of monthly ones. */
const RECENT_ROWS = 6;

/**
 * The rows of a pool cut by who paid the recent rows of their series. A series is the rows of one account, one
 * direction and one merchant, as `detectRecurring` groups them. `rows` is the stable cut as `applyUse` gave it, by the
 * accounts' parts; `paid` is what the trace says of each row by id (only the rows of traced accounts have one);
 * `untold` holds the accounts whose weights nobody said, which count the bank's whole amount where the trace says nothing.
 *
 * Of the latest `RECENT_ROWS` booked rows of a series with a trace, those it tells whole give the viewer's part: what
 * they paid of what those rows came to. That part cuts every row of the series, so past and coming amounts of a
 * series agree. A series the viewer paid none of has no rows here. A series with no such row keeps the weights of an
 * account whose weights were said, and the whole amount of one in `untold`.
 */
export function standingCut<T extends Transaction>(rows: readonly T[], untold: ReadonlySet<string>, paid: ReadonlyMap<string, PaidOf>): readonly T[] {
  const seriesOf = (t: T) => `${t.accountId}\u0000${billCents(t) < 0 ? "out" : "in"}\u0000${t.merchant}`;
  const series = new Map<string, T[]>();
  for (const t of rows) {
    if (!paid.has(t.id) && !untold.has(t.accountId)) continue;
    const key = seriesOf(t);
    const group = series.get(key);
    if (group) group.push(t);
    else series.set(key, [t]);
  }
  const parts = new Map<string, Part | null>();
  for (const [key, group] of series) parts.set(key, recentPart(group, paid));
  const cut = (t: T): T | null => {
    const key = seriesOf(t);
    if (!series.has(key)) return t;
    const part = parts.get(key) ?? null;
    if (part === null) return untold.has(t.accountId) ? uncutRow(t) : t;
    if (isNone(part)) return null;
    if (isWhole(part)) return uncutRow(t);
    const whole = billCents(t);
    return { ...t, amountCents: partCents(whole, part), wholeCents: whole };
  };
  const out: T[] = [];
  for (const t of rows) {
    const row = cut(t);
    if (row !== null) out.push(row);
  }
  return out;
}

/** The viewer's part of the recent rows of one series that the trace tells whole; null when none is. */
function recentPart<T extends Transaction>(group: readonly T[], paid: ReadonlyMap<string, PaidOf>): Part | null {
  const recent = group
    .filter((t) => t.status === "booked")
    .sort((a, b) => (a.bookingDate === b.bookingDate ? (a.id < b.id ? 1 : -1) : a.bookingDate < b.bookingDate ? 1 : -1))
    .slice(0, RECENT_ROWS);
  let own = 0;
  let whole = 0;
  for (const t of recent) {
    const p = paid.get(t.id);
    if (p === undefined || p.whole === 0 || p.known !== p.whole) continue;
    own += p.own;
    whole += p.whole;
  }
  return whole === 0 ? null : { from: 0, to: own, of: whole };
}
