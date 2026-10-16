/**
 * From which day each account's rows are known: what the reports lean on to tell a month with no spending from a
 * month the app has no rows for. See docs/MONEY_FLOWS.md, "Coverage by day".
 */
import { addMonthsToDate, fromMonthIndex, monthIndex, monthOf } from "../dates.ts";
import type { Account, IsoDate } from "../types.ts";
import type { AnalysisContext } from "./context.ts";
import { isCompleteMonth } from "./usual.ts";

export interface Coverage {
  /** Was the account in the data for the whole of the month? */
  covers: (accountId: string, month: number) => boolean;
  /** The month of the account's first row. In a month before it the account has no row to miss. */
  began: (accountId: string) => number;
  /** The first day the account's record says its rows are known from; null when that is unknown (an account linked before the record, or one with nothing recorded). */
  knownFrom: (accountId: string) => IsoDate | null;
  /** The day a card account's purchases are known from; null for an account that is no card account the bank gave, and when the day is unknown. */
  purchasesFrom: (accountId: string) => IsoDate | null;
}

/** What a bank gives one length of history to: its cards, or its deposit accounts. A loan is neither. */
const kindOf = (a: Account) => (a.type === "credit_card" ? "card" : a.type === "loan" ? null : "deposit");

/**
 * The day the record of each account says its rows are known from, the earliest of the copies of it (a joint account
 * is recorded by each member who linked it). The oldest row the bank sent decides. When the bank was asked for its
 * longest history and sent no row, the day it was asked from does: it had nothing to give for the whole of it. A
 * default fetch that found no row proves nothing, since a bank may give less than was asked. An account the record
 * does not hold, or holds with neither, is not in the map.
 */
function recordedDays(ctx: AnalysisContext): Map<string, IsoDate> {
  const known = new Map<string, IsoDate>();
  for (const h of ctx.history) {
    const day = h.firstRowDay ?? (h.source === "longest" ? h.askedFrom : null);
    if (day && (!known.has(h.accountId) || day < known.get(h.accountId)!)) known.set(h.accountId, day);
  }
  return known;
}

/**
 * From when each account was in the data. The day its record gives (`recordedDays`) or else its first row decides,
 * with the days of slack the oldest row of all has (`isCompleteMonth`): a card opened later than its history reaches
 * is read as one connected later, the safe side. An account linked before the record has no recorded day, so its first
 * row decides until its next consent asks for the longest history.
 *
 * One thing says more than that day. When another account of the same bank and of the same kind has a day a whole
 * month or more before it, the bank gave older history for an account of that kind and would have given this one's
 * too: the account was in the data from that older day on, with nothing to show. A card vouches for a card and a
 * deposit account for a deposit account, never one for the other, since banks give cards a shorter history. An account
 * without a bank is vouched for by none and vouches for none.
 *
 * A reader may rely on `covers(account, month)` (the account was in the data from the 1st of the month), on
 * `began(account)` (the month index of its first row, infinity without one), on `knownFrom` (the recorded day, never a
 * guess) and on `purchasesFrom` (the same for a card account); how the first day is guessed may change.
 */
export function coverage(ctx: AnalysisContext): Coverage {
  const first = new Map<string, IsoDate>();
  for (const t of ctx.txs) if (!first.has(t.accountId)) first.set(t.accountId, t.bookingDate);
  const known = recordedDays(ctx);
  const own = new Map(first);
  for (const [id, day] of known) if (!own.has(id) || day < own.get(id)!) own.set(id, day);
  const from = new Map(own);
  for (const a of ctx.accounts) {
    const mine = own.get(a.id);
    const kind = kindOf(a);
    if (!mine || !a.bank || !kind) continue;
    const monthBefore = addMonthsToDate(mine, -1);
    for (const b of ctx.accounts) {
      const theirs = own.get(b.id);
      if (b.id !== a.id && b.bank === a.bank && kindOf(b) === kind && theirs && theirs <= monthBefore && theirs < from.get(a.id)!) from.set(a.id, theirs);
    }
  }
  const cards = new Set(ctx.accounts.filter((a) => a.type === "credit_card").map((a) => a.id));
  return {
    covers: (accountId, month) => isCompleteMonth({ dataFrom: from.get(accountId) ?? null, today: ctx.today }, fromMonthIndex(month)),
    began: (accountId) => {
      const day = first.get(accountId);
      return day ? monthIndex(monthOf(day)) : Number.POSITIVE_INFINITY;
    },
    knownFrom: (accountId) => known.get(accountId) ?? null,
    purchasesFrom: (accountId) => (cards.has(accountId) ? (known.get(accountId) ?? null) : null),
  };
}
