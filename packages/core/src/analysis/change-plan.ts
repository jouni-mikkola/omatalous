/**
 * The periods a spending change compares (change.ts): the target and its base, which months are complete for the
 * comparison, and the day a running month is cut at.
 */
import { addDays, addMonths, dateIn, fromDayNumber, fromMonthIndex, monthEnd, monthIndex, monthOf } from "../dates.ts";
import type { IsoDate } from "../types.ts";
import type { ChangeView, ChangeWindow } from "./change.ts";
import type { AnalysisContext } from "./context.ts";
import { completeMonthsBefore, isCompleteMonth, MIN_COMPARE_MONTHS, USUAL_MONTHS } from "./usual.ts";

export interface Plan {
  view: ChangeView;
  target: string[];
  base: string[];
  /** Rows on later days of the month are left out: a running month is compared on the days it has had. */
  cap: number;
  running: boolean;
  /** The base is the mean of several months (the usual view). Otherwise it is the sum over as many months as the target. */
  mean: boolean;
  /** The complete months before the target its noise is read from (usual and season views; the year view reads its own). */
  noise: string[];
}

/** Months a category's noise is read from: a busy month comes a few times a year, so six months cannot show it (ADR 0011). */
const NOISE_MONTHS = 24;

/** Days with rows a paying account's own rhythm expects since its last row before its silence reads as a lag. */
const LAG_ROW_DAYS = 5;
/** The rhythm is read from this many days before the account's last row. */
const RHYTHM_DAYS = 180;
/** An account silent for longer than this was closed or replaced: its silence no longer cuts the comparison. */
const LAG_HORIZON_DAYS = 92;
/** The household's purchases keep up when they reach this share of their own rhythm: rows moved to another account. */
const KEPT_UP = 0.75;
/** A late account is judged on this many days of purchases before and after its first row. */
const HEAD_DAYS = 90;
/** An account whose first row is this close to the history's start was there from the start. */
const HEAD_SLACK_DAYS = 7;

interface Accounts {
  /** Days with rows per account, ascending, and whether the account has spending. */
  byAccount: Map<string, { days: number[]; pays: boolean }>;
  /** The day of every purchase of the household, ascending. */
  buys: number[];
}

function accountsOf(ctx: AnalysisContext): Accounts {
  const byAccount = new Map<string, { days: number[]; pays: boolean }>();
  const buys: number[] = [];
  for (const t of ctx.txs) {
    const e = byAccount.get(t.accountId) ?? (byAccount.set(t.accountId, { days: [], pays: false }), byAccount.get(t.accountId)!);
    if (e.days[e.days.length - 1] !== t.day) e.days.push(t.day);
    if (t.spend > 0) {
      e.pays = true;
      buys.push(t.day);
    }
  }
  return { byAccount, buys };
}

/** The household's purchases on days after `from` up to `to`. */
const buysIn = (buys: readonly number[], from: number, to: number) => buys.filter((d) => d > from && d <= to).length;

const bounds = new WeakMap<AnalysisContext, { from: IsoDate | null; through: IsoDate }>();

/**
 * The days the household's rows are complete on. `through`: today, or the last row of a paying account that went
 * quiet while the household's purchases fell short of their rhythm (a sync that lags, a card that stopped syncing).
 * When the purchases kept up, they moved to another account: a card closed or replaced, no lag. `from`: the history's
 * first day, or the first row of a paying account connected later, when the household's purchases before it fall
 * short of those after it (the mirror: months before a card was connected miss its purchases).
 */
export function rowsComplete(ctx: AnalysisContext): { from: IsoDate | null; through: IsoDate } {
  const found = bounds.get(ctx);
  if (found) return found;
  const { byAccount, buys } = accountsOf(ctx);
  const latest = Math.min(ctx.todayDay, ctx.txs[ctx.txs.length - 1]?.day ?? ctx.todayDay);
  const start = ctx.txs[0]?.day ?? ctx.todayDay;
  let through = ctx.today;
  let from = ctx.dataFrom;
  for (const { days, pays } of byAccount.values()) {
    if (!pays) continue;
    const last = days[days.length - 1]!;
    // silent against the household's latest row: a history that simply ends is no lag of one account
    const silent = latest - last;
    const rate = days.filter((d) => d > last - RHYTHM_DAYS).length / RHYTHM_DAYS;
    const pace = buysIn(buys, last - RHYTHM_DAYS, last) / RHYTHM_DAYS;
    const lags = silent <= LAG_HORIZON_DAYS && rate * silent >= LAG_ROW_DAYS && buysIn(buys, last, latest) < KEPT_UP * pace * silent;
    if (lags && fromDayNumber(last) < through) through = fromDayNumber(last);
    const first = days[0]!;
    const before = Math.min(HEAD_DAYS, first - start);
    const late = first - start > HEAD_SLACK_DAYS && buysIn(buys, first - before - 1, first - 1) < KEPT_UP * (buysIn(buys, first - 1, first - 1 + HEAD_DAYS) * before) / HEAD_DAYS;
    if (late && (from === null || fromDayNumber(first) > from)) from = fromDayNumber(first);
  }
  const out = { from, through };
  bounds.set(ctx, out);
  return out;
}

/**
 * The periods of a view for `month`: the month itself (usual and season) or the month the last twelve end in (year).
 * null when the history cannot support the comparison: under three complete months before, no complete month a year
 * earlier, or under three months to compare. A month the rows do not reach to its end (`rowsComplete`) is not
 * complete here: as a target it is cut at that day, as a base it is not used; nor is a month before a late account.
 */
export function planOf(full: AnalysisContext, view: ChangeView, month: string): Plan | null {
  const { from, through } = rowsComplete(full);
  // a month is complete for the comparison only from the day and up to the day every paying account's rows reach
  const today = through < full.today ? addDays(through, 1) : full.today;
  const complete = (m: string) => isCompleteMonth(full, m, undefined, { from, today });
  const before = (m: string) => completeMonthsBefore(full, m, USUAL_MONTHS, undefined, { from, today });
  // the noise is read from every complete month back to the first day: an account connected in between leaves its own
  // first month out and does not cut the months before it off (a replaced card must not leave the noise empty)
  const noiseBefore = (m: string): string[] => {
    const out: string[] = [];
    for (let i = monthIndex(m) - 1; from && i >= monthIndex(monthOf(from)) && out.length < NOISE_MONTHS; i--) if (complete(fromMonthIndex(i))) out.unshift(fromMonthIndex(i));
    return out;
  };
  if (month > monthOf(full.today) || `${month}-01` > through) return null;
  const running = through < monthEnd(month);
  const cap = running ? Number(through.slice(8, 10)) : 31;
  if (view === "usual") {
    const base = before(month);
    return base.length < MIN_COMPARE_MONTHS ? null : { view, target: [month], base, cap, running, mean: true, noise: noiseBefore(month) };
  }
  if (view === "season") {
    const base = addMonths(month, -12);
    return complete(base) ? { view, target: [month], base: [base], cap, running, mean: false, noise: noiseBefore(month) } : null;
  }
  if (!complete(month) || !from) return null;
  let first = monthIndex(monthOf(from));
  while (!complete(fromMonthIndex(first)) && first < monthIndex(month)) first++;
  // a month of the target pairs with the month twelve earlier, which must be complete
  const k = Math.min(12, monthIndex(month) - 12 - first + 1);
  if (k < MIN_COMPARE_MONTHS) return null;
  const target = Array.from({ length: k }, (_, i) => addMonths(month, i - k + 1));
  return { view, target, base: target.map((m) => addMonths(m, -12)), cap: 31, running: false, mean: false, noise: [] };
}

export const windowOf = (ctx: AnalysisContext, months: string[], cut: number | null): ChangeWindow => {
  const last = months[months.length - 1]!;
  const end = dateIn(last, cut ?? 31);
  return { months, from: `${months[0]}-01`, to: end < ctx.today ? end : ctx.today };
};
