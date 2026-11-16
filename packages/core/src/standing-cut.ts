/**
 * The cut of a pool's rows that what is ahead is read from. The past counts each row by who paid it (`applyUse` with
 * the viewer's shares); a series is detected on one stable cut instead, so a payment the partner made once does not
 * move its amount. The stable cut of a series is what the viewer's past cents were over its recent rows, counted the way
 * `shareOf` counts a row: what the trace says the viewer paid, and their weighted part of the money nobody owns (the
 * weights of a pool cut by who paid only share what nobody owns, ADR 0017). A series with no recent row the trace
 * knows keeps the weights' cut as `applyUse` gave it.
 */
import { billCents, partCents, WHOLE } from "./account-use.ts";
import type { PaidOf } from "./money-trace-answers.ts";
import { uncutRow } from "./shared.ts";
import type { Part, Transaction } from "./types.ts";

/** How many of a series' latest rows tell who pays it: a year's quarterly bill and a half year of monthly ones. */
const RECENT_ROWS = 6;

/**
 * The viewer's part of a series as two ranges over the series' whole, so that the members' cuts of one amount add up to
 * it to the cent (`partCents` rounds both ends of a range alike). `own` lies in the money users paid, which the members
 * place one after the other in the order of their owner keys; `unknown` lies in the money nobody owns, where the
 * viewer's weighted part of the account places it.
 */
interface SeriesPart {
  own: Part;
  unknown: Part;
}

/**
 * The rows of a pool cut by who paid the recent rows of their series. A series is the rows of one account, one
 * direction and one merchant, as `detectRecurring` groups them. `rows` is the stable cut as `applyUse` gave it, by the
 * accounts' parts in `parts`; `paid` is what the trace says of each row by id (only the rows of traced accounts have one).
 *
 * Of the latest `RECENT_ROWS` booked rows of a series with a trace, the viewer's part is what they paid of what those
 * rows came to, plus their weighted part of the rest. That part cuts every row of the series, so past and coming
 * amounts of a series agree. A series the viewer paid none of has no rows here.
 */
export function standingCut<T extends Transaction>(rows: readonly T[], parts: ReadonlyMap<string, Part>, paid: ReadonlyMap<string, PaidOf>): readonly T[] {
  const seriesOf = (t: T) => `${t.accountId}\u0000${billCents(t) < 0 ? "out" : "in"}\u0000${t.merchant}`;
  const series = new Map<string, T[]>();
  for (const t of rows) {
    if (!paid.has(t.id)) continue;
    const key = seriesOf(t);
    const group = series.get(key);
    if (group) group.push(t);
    else series.set(key, [t]);
  }
  const cuts = new Map<string, SeriesPart | null>();
  for (const [key, group] of series) cuts.set(key, recentPart(group, parts.get(group[0]!.accountId) ?? WHOLE, paid));
  const cut = (t: T): T | null => {
    const part = cuts.get(seriesOf(t)) ?? null;
    if (part === null) return t;
    const whole = billCents(t);
    const cents = partCents(whole, part.own) + partCents(whole, part.unknown);
    if (cents === 0) return null;
    return cents === whole ? uncutRow(t) : { ...t, amountCents: cents, wholeCents: whole };
  };
  const out: T[] = [];
  for (const t of rows) {
    const row = cut(t);
    if (row !== null) out.push(row);
  }
  return out;
}

/** The viewer's part of the recent rows of one series that the trace knows; null when it knows none. */
function recentPart<T extends Transaction>(group: readonly T[], account: Part, paid: ReadonlyMap<string, PaidOf>): SeriesPart | null {
  const recent = group
    .filter((t) => t.status === "booked")
    .sort((a, b) => (a.bookingDate === b.bookingDate ? (a.id < b.id ? 1 : -1) : a.bookingDate < b.bookingDate ? 1 : -1))
    .slice(0, RECENT_ROWS);
  let own = 0;
  let before = 0;
  let known = 0;
  let whole = 0;
  for (const t of recent) {
    const p = paid.get(t.id);
    if (p === undefined || p.whole === 0) continue;
    own += p.own;
    before += p.before;
    known += p.known;
    whole += p.whole;
  }
  if (whole === 0) return null;
  const rest = whole - known;
  return {
    own: { from: before, to: before + own, of: whole },
    unknown: { from: known * account.of + rest * account.from, to: known * account.of + rest * account.to, of: whole * account.of },
  };
}
