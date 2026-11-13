/**
 * From which day each account's rows are known: what the reports lean on to tell a month with no spending from a
 * month the app has no rows for. See docs/MONEY_FLOWS.md, "Coverage by day".
 */
import { addMonthsToDate, dayNumber, fromDayNumber, fromMonthIndex, monthEnd, monthIndex, monthOf } from "../dates.ts";
import { DAILY_MONTHS_SHARE, DAILY_PAID_SHARE, DAILY_ROWS, HOLE_MONTHS } from "../thresholds.ts";
import type { Account, IsoDate } from "../types.ts";
import { type AnalysisContext, COVER_SLACK_DAYS } from "./context.ts";

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

interface StartDays {
  first: Map<string, IsoDate>;
  known: Map<string, IsoDate>;
  from: Map<string, IsoDate>;
}

const startDaysOf = new WeakMap<AnalysisContext, StartDays>();

/** The day each account's rows are known from, as `coverage` reads it (see there), with the maps it is made of. */
function startDays(ctx: AnalysisContext): StartDays {
  let found = startDaysOf.get(ctx);
  if (!found) startDaysOf.set(ctx, (found = computeStartDays(ctx)));
  return found;
}

function computeStartDays(ctx: AnalysisContext): StartDays {
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
  return { first, known, from };
}

/**
 * From when each account was in the data. The day its record gives (`recordedDays`) or else its first row decides,
 * with the days of slack the oldest row of all has (`COVER_SLACK_DAYS`): a card opened later than its history reaches
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
  const { first, known } = startDays(ctx);
  const cards = new Set(ctx.accounts.filter((a) => a.type === "credit_card").map((a) => a.id));
  return {
    covers: (accountId, month) => {
      const label = fromMonthIndex(month);
      return monthEnd(label) < ctx.today && accountCovers(ctx, [accountId], `${label}-01`);
    },
    began: (accountId) => {
      const day = first.get(accountId);
      return day ? monthIndex(monthOf(day)) : Number.POSITIVE_INFINITY;
    },
    knownFrom: (accountId) => known.get(accountId) ?? null,
    purchasesFrom: (accountId) => (cards.has(accountId) ? (known.get(accountId) ?? null) : null),
  };
}

/**
 * Was every one of the accounts in the data from `from` on (with the slack of `COVER_SLACK_DAYS`)? What a reader asks
 * about a figure made of the rows of some accounts, such as one payer's income or one card's subscriptions: an account
 * connected later than `from` has no history there, however old the oldest row of the other accounts is. False for no
 * account, and for an account with no known first day.
 */
export function accountCovers(ctx: AnalysisContext, accountIds: Iterable<string>, from: IsoDate): boolean {
  const { from: starts } = startDays(ctx);
  let any = false;
  for (const id of accountIds) {
    const day = starts.get(id);
    if (!day || dayNumber(day) > dayNumber(from) + COVER_SLACK_DAYS) return false;
    any = true;
  }
  return any;
}

/*
 * An account in daily use: `DAILY_ROWS` rows a month on average over the months it has rows in, spending in
 * `DAILY_PAID_SHARE` of those months or more, and rows in `DAILY_MONTHS_SHARE` of the months from its first row to its
 * last. `HOLE_MONTHS` is the longest run of empty months read as missing rows (thresholds.ts gives each its reason).
 */

interface Holes {
  /** The accounts each month (an index) misses the rows of. */
  byMonth: Map<number, Set<string>>;
  /** Those of them that carry over `LEFT_OUT_SHARE` of the household's spending over the months they have rows in. */
  main: ReadonlySet<string>;
}

const holesOf = new WeakMap<AnalysisContext, Holes>();

/**
 * The months whose rows are missing on an account in daily use (`DAILY_ROWS`, `DAILY_PAID_SHARE`): a run of one or two
 * months with no row of any kind between months with rows. Such an account has rows every month, so the bank or the
 * file missed them. A card used now and then, a savings account and an account for a few bills have none.
 */
function holes(ctx: AnalysisContext): Holes {
  const cached = holesOf.get(ctx);
  if (cached) return cached;
  const byMonth = new Map<number, Set<string>>();
  const main = new Set<string>();
  const rows = new Map<string, { months: Set<number>; paid: Set<number>; count: number; spend: number }>();
  const spendOf = new Map<number, number>();
  for (const t of ctx.txs) {
    const a = rows.get(t.accountId) ?? rows.set(t.accountId, { months: new Set(), paid: new Set(), count: 0, spend: 0 }).get(t.accountId)!;
    a.months.add(t.month);
    a.count++;
    if (t.spend > 0) {
      a.paid.add(t.month);
      a.spend += t.spend;
      spendOf.set(t.month, (spendOf.get(t.month) ?? 0) + t.spend);
    }
  }
  for (const [id, a] of rows) {
    const first = Math.min(...a.months);
    const last = Math.max(...a.months);
    const daily = a.count >= DAILY_ROWS * a.months.size && a.paid.size >= DAILY_PAID_SHARE * a.months.size && a.months.size >= DAILY_MONTHS_SHARE * (last - first + 1);
    if (a.months.size < 3 || !daily) continue;
    let found = false;
    for (let m = first + 1; m < last; m++) {
      if (a.months.has(m)) continue;
      let end = m;
      while (!a.months.has(end + 1)) end++;
      if (end - m < HOLE_MONTHS) {
        found = true;
        for (let h = m; h <= end; h++) (byMonth.get(h) ?? byMonth.set(h, new Set()).get(h)!).add(id);
      }
      m = end;
    }
    let household = 0;
    for (const m of a.months) household += spendOf.get(m) ?? 0;
    if (found && a.spend > LEFT_OUT_SHARE * household) main.add(id);
  }
  const out = { byMonth, main };
  holesOf.set(ctx, out);
  return out;
}

/**
 * Are rows missing from `month` (`2026-07`) on one of the accounts (`holes`)? With none named, the household's month
 * misses rows when an account that carries over `LEFT_OUT_SHARE` of its spending does. `except` leaves accounts out of either.
 */
export function rowsMissing(ctx: AnalysisContext, month: string, accounts?: Iterable<string>, except?: ReadonlySet<string>): boolean {
  const { byMonth, main } = holes(ctx);
  const ids = byMonth.get(monthIndex(month));
  if (!ids) return false;
  for (const id of accounts ?? main) if (ids.has(id) && !except?.has(id)) return true;
  return false;
}

/** A period: its first and last day. */
interface Span {
  from: IsoDate;
  to: IsoDate;
}

/** What setting a later period against an earlier one leaves of the accounts. */
interface Comparison {
  /** The accounts with data for the whole of both periods: the only rows a comparison may sum. */
  shared: ReadonlySet<string>;
  /** An account with rows in either period is left out (it began, or ended, in between). */
  leftOut: boolean;
  /** Cents going out of the left-out accounts in the later period, and of all accounts: how much the comparison leaves aside. */
  leftOutCents: number;
  laterCents: number;
}

interface AccountsCoverage {
  /** The accounts shared by two periods, or null when none is. */
  compare: (earlier: Span, later: Span) => Comparison | null;
  /** The month (`2024-05`) of the earliest account's first known day; null without rows. */
  firstMonth: string | null;
}

/** An account has ended when it has no row for this many days, or 2.5 times its own median gap between rows when that is more, before the newest row of the scope. */
const ENDED_DAYS = 61;
const ENDED_GAPS = 2.5;
/** The comparison is told only while the accounts left out carry no more than this share of the later period's spending. */
export const LEFT_OUT_SHARE = 0.1;

const accountCoverages = new WeakMap<AnalysisContext, AccountsCoverage>();

interface AccountSpan {
  id: string;
  start: number;
  last: number;
  ended: boolean;
}

const accountSpansOf = new WeakMap<AnalysisContext, AccountSpan[]>();

/** Each account's first known day, its last row and whether it has ended (see `accountsCoverage`), once per context. */
function accountSpans(ctx: AnalysisContext): AccountSpan[] {
  const cached = accountSpansOf.get(ctx);
  if (cached) return cached;
  const { from } = startDays(ctx);
  const days = new Map<string, number[]>();
  let newest = Number.NEGATIVE_INFINITY;
  for (const t of ctx.txs) {
    if (!t.amountCents || t.isTransfer) continue;
    const d = dayNumber(t.bookingDate);
    (days.get(t.accountId) ?? days.set(t.accountId, []).get(t.accountId)!).push(d);
    if (d > newest) newest = d;
  }
  const spans = [...days]
    .filter(([id]) => from.has(id))
    .map(([id, ds]) => {
      ds.sort((x, y) => x - y);
      const last = ds[ds.length - 1]!;
      const gaps = ds.slice(1).map((d, i) => d - ds[i]!).filter((g) => g > 0);
      const gap = gaps.length ? [...gaps].sort((x, y) => x - y)[Math.floor(gaps.length / 2)]! : 0;
      return { id, start: dayNumber(from.get(id)!), last, ended: newest - last > Math.max(ENDED_DAYS, ENDED_GAPS * gap) };
    });
  accountSpansOf.set(ctx, spans);
  return spans;
}

/**
 * Which accounts two periods can be compared on, the one answer every comparison reads: the year comparison, the period
 * against the one before, the changes of the summary and the categories, the months that cost more than usual. An
 * account counts when the scope holds a row of it that is no transfer (money in or out), from its first known day
 * (`coverage`; the first 3 days of a month count as the month's start). It has data for a period when it began by the
 * period's first day and had not ended before the period's last day. An account has ended when it has no row for 61
 * days, or for 2.5 times its own median gap between rows when that is longer (a quarterly bill stays in), before the
 * newest row of the scope. The accounts with data for both periods are `shared`; the rest are left out of both sides.
 */
export function accountsCoverage(ctx: AnalysisContext): AccountsCoverage {
  const cached = accountCoverages.get(ctx);
  if (cached) return cached;
  const accounts = accountSpans(ctx);
  /** Begun by the day, with the slack of the history's own first day. */
  const began = (a: { start: number }, day: IsoDate) => a.start <= dayNumber(day) + COVER_SLACK_DAYS;
  const memo = new Map<string, Comparison | null>();
  // the rows parsed once and in day order: a comparison reads only its two periods, and the months that cost more than
  // usual ask for some hundred of them, so a scan of every row each time was most of Optimoi's run
  const rowsByDay = ctx.txs
    .filter((t) => t.amountCents && !t.isTransfer)
    .map((t) => ({ d: dayNumber(t.bookingDate), accountId: t.accountId, cents: t.amountCents }))
    .sort((x, y) => x.d - y.d);
  const firstAtOrAfter = (day: number) => {
    let lo = 0;
    let hi = rowsByDay.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (rowsByDay[mid]!.d < day) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  let firstDay = Number.POSITIVE_INFINITY;
  for (const a of accounts) firstDay = Math.min(firstDay, a.start);
  const result: AccountsCoverage = {
    compare: (earlier, later) => {
      const key = `${earlier.from}|${earlier.to}|${later.from}|${later.to}`;
      if (memo.has(key)) return memo.get(key)!;
      const shared = new Set(accounts.filter((a) => began(a, earlier.from) && began(a, later.from) && (!a.ended || a.last >= dayNumber(later.to))).map((a) => a.id));
      let out: Comparison | null = null;
      if (shared.size) {
        const rows = new Map<string, boolean>();
        let leftOutCents = 0;
        let laterCents = 0;
        for (const span of [earlier, later]) {
          for (let i = firstAtOrAfter(dayNumber(span.from)); i < rowsByDay.length && rowsByDay[i]!.d <= dayNumber(span.to); i++) {
            const t = rowsByDay[i]!;
            if (!shared.has(t.accountId)) rows.set(t.accountId, true);
            if (span === later && t.cents < 0) {
              laterCents -= t.cents;
              if (!shared.has(t.accountId)) leftOutCents -= t.cents;
            }
          }
        }
        out = { shared, leftOut: rows.size > 0, leftOutCents, laterCents };
      }
      memo.set(key, out);
      return out;
    },
    firstMonth: accounts.length ? monthOf(fromDayNumber(firstDay)) : null,
  };
  accountCoverages.set(ctx, result);
  return result;
}

/** The accounts of a comparison that may be told: some account is shared and the ones left out carry at most `LEFT_OUT_SHARE` of the later period's spending. null otherwise. */
export function comparableWith(ctx: AnalysisContext, earlier: Span, later: Span): Comparison | null {
  const c = accountsCoverage(ctx).compare(earlier, later);
  return c && c.leftOutCents <= LEFT_OUT_SHARE * c.laterCents ? c : null;
}

/** The same accounts in both periods, none left out: for a figure that sums every account of the household and cannot leave one aside. */
export function sameAccounts(ctx: AnalysisContext, earlier: Span, later: Span): boolean {
  const c = accountsCoverage(ctx).compare(earlier, later);
  return c !== null && !c.leftOut;
}

/** A calendar month (`2026-03`) as a period. */
export const monthSpan = (month: string): Span => ({ from: `${month}-01`, to: monthEnd(month) });
