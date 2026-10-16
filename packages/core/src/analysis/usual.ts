/**
 * "Tavallisesti" and "valmis kuukausi": the one yardstick every view uses to say what is usual and which months may
 * be compared. A running month, or one the history does not cover from the 1st, is never part of it, and fewer than
 * three months say nothing. The usual spending, the usual earned income and the gate a cause must pass are defined here
 * once (ADR 0004). The page's "Säännölliset tulot kuukaudessa" is another figure: the income report's own median of twelve
 * months of regular income (`stability.medianCents`). See docs/MONEY_FLOWS.md.
 */
import { dayNumber, fromMonthIndex, monthEnd, monthIndex } from "../dates.ts";
import { median } from "../stats.ts";
import { type AnalysisContext, historyCovers } from "./context.ts";
import { accountCovers, LEFT_OUT_SHARE } from "./coverage.ts";
import { bookedSpendSelect, earnedOf, earnedSelect, spendOf, sumOf } from "./counted.ts";
import type { IsoDate } from "../types.ts";
import type { DayRange } from "./period.ts";

/** The usual level is the median of this many complete months at most. */
export const USUAL_MONTHS = 6;
/** Fewer complete months than this give no usual level and no comparison. */
export const MIN_COMPARE_MONTHS = 3;

/** The accounts with a row in each month (`2026-09`), found once per context. */
const rowAccounts = new WeakMap<AnalysisContext, Map<string, Set<string>>>();

function accountsWithRows(ctx: AnalysisContext, month: string): ReadonlySet<string> {
  let byMonth = rowAccounts.get(ctx);
  if (!byMonth) {
    rowAccounts.set(ctx, (byMonth = new Map()));
    for (const t of ctx.txs) {
      const label = t.bookingDate.slice(0, 7);
      let ids = byMonth.get(label);
      if (!ids) byMonth.set(label, (ids = new Set()));
      ids.add(t.accountId);
    }
  }
  return byMonth.get(month) ?? new Set();
}

/** The days a reader knows its rows are complete on (`rowsComplete`). */
type RowBounds = { from: IsoDate | null; today: IsoDate };

/**
 * The month (`2026-09`) has ended and the accounts a reader sums were in the data from the 1st (`accountCovers`). A
 * reader of the household total passes no accounts: the accounts with a row in the month are the ones it sums, so an
 * account connected later does not make the months before it incomplete, and its own first month is. A month without
 * a row is judged by the history of all rows. `rows` narrows it further for a reader that knows the days its rows are
 * complete on (`rowsComplete`): the month must also end before `rows.today` and start after `rows.from`.
 */
export function isCompleteMonth(ctx: AnalysisContext, month: string, accounts?: Iterable<string>, rows?: RowBounds): boolean {
  if (monthEnd(month) >= (rows?.today ?? ctx.today)) return false;
  const from = `${month}-01`;
  if (rows && !historyCovers({ dataFrom: rows.from }, from)) return false;
  if (accounts) return accountCovers(ctx, accounts, from);
  const own = accountsWithRows(ctx, month);
  return own.size ? accountCovers(ctx, own, from) : historyCovers(ctx, from);
}

/**
 * The complete months right before `month`, at most `n`, oldest first (for the accounts a reader sums, see
 * `isCompleteMonth`). It stops at the first month that is not complete, so a history that starts later gives fewer
 * (none when `month` itself is in the future). One month is skipped instead: the month an account joined, when that
 * is all that makes it incomplete and the joining accounts carry under `LEFT_OUT_SHARE` of the spending from that month
 * up to `month`: a small new card does not cut the usual level off, a main account does. A reader that names its
 * accounts always stops.
 */
export function completeMonthsBefore(ctx: AnalysisContext, month: string, n: number = USUAL_MONTHS, accounts?: Iterable<string>, rows?: RowBounds): string[] {
  const ids = accounts && [...accounts];
  const out: string[] = [];
  for (let i = monthIndex(month) - 1; out.length < n; i--) {
    const label = fromMonthIndex(i);
    if (isCompleteMonth(ctx, label, ids, rows)) out.push(label);
    else if (ids || !joinedSmall(ctx, label, month, rows)) break;
  }
  return out.reverse();
}

/** Is `label` incomplete only because accounts began in it, and do they carry under `LEFT_OUT_SHARE` of the spending from `label` to before `month`? */
function joinedSmall(ctx: AnalysisContext, label: string, month: string, rows?: RowBounds): boolean {
  const here = accountsWithRows(ctx, label);
  const joined = new Set([...here].filter((id) => !accountCovers(ctx, [id], `${label}-01`)));
  if (!joined.size || joined.size === here.size) return false;
  const others = [...here].filter((id) => !joined.has(id));
  if (!isCompleteMonth(ctx, label, others, rows)) return false;
  let all = 0;
  let theirs = 0;
  for (const t of bookedSpendSelect(ctx, { fromDay: dayNumber(`${label}-01`), toDay: dayNumber(monthEnd(fromMonthIndex(monthIndex(month) - 1))) }).counted) {
    all += spendOf(t);
    if (joined.has(t.accountId)) theirs += spendOf(t);
  }
  return all > 0 && theirs < LEFT_OUT_SHARE * all;
}

/**
 * The usual level of a month figure: the median of the values of `completeMonthsBefore(ctx, month, USUAL_MONTHS)`,
 * in whole cents, or null under three values.
 */
export function usualCents(values: readonly number[]): number | null {
  return values.length < MIN_COMPARE_MONTHS ? null : Math.round(median(values));
}

interface MonthSums {
  /** Spending (consumption + debt) on days 1 to d at index d − 1: a running month is set against the same days. */
  through: number[];
}

const ZERO: MonthSums = { through: new Array<number>(31).fill(0) };
const sums = new WeakMap<AnalysisContext, Map<string, MonthSums>>();
const earnedSums = new WeakMap<AnalysisContext, Map<string, number>>();

/** The days of a month. */
const monthDays = (month: string): DayRange => ({ fromDay: dayNumber(`${month}-01`), toDay: dayNumber(monthEnd(month)) });

/** A month's spending, summed once per context from the rows `bookedSpendSelect` counts. */
function monthSums(ctx: AnalysisContext, month: string): MonthSums {
  let byMonth = sums.get(ctx);
  if (!byMonth) sums.set(ctx, (byMonth = new Map()));
  let e = byMonth.get(month);
  if (!e) {
    const r = monthDays(month);
    const rows = bookedSpendSelect(ctx, r).counted;
    if (!rows.length) e = ZERO;
    else {
      e = { through: new Array<number>(31).fill(0) };
      for (const t of rows) e.through[Number(t.bookingDate.slice(8, 10)) - 1]! += spendOf(t);
      for (let d = 1; d < 31; d++) e.through[d]! += e.through[d - 1]!;
    }
    byMonth.set(month, e);
  }
  return e;
}

/** A month's earned income (`isEarnedIncome`): what `usualIncome` is the median of. */
export function earnedIncome(ctx: AnalysisContext, month: string): number {
  let cache = earnedSums.get(ctx);
  if (!cache) earnedSums.set(ctx, (cache = new Map()));
  let cents = cache.get(month);
  if (cents === undefined) {
    cents = sumOf(earnedSelect(ctx, monthDays(month)).counted, earnedOf);
    cache.set(month, cents);
  }
  return cents;
}

/** A month's spending (consumption + debt) on its days 1 to `day`; 31 is the whole month. */
export function spendingThrough(ctx: AnalysisContext, month: string, day = 31): number {
  return monthSums(ctx, month).through[Math.min(31, Math.max(1, day)) - 1]!;
}

/**
 * The usual level of spending over `months`, each counted on its days 1 to `day` (31: whole months): their median,
 * null under three. Every view that says what a month usually costs reads it, so a month has one usual total
 * (`usualSpending`); a view that leaves out months the rows do not cover passes its own months.
 */
export function usualSpendingOver(ctx: AnalysisContext, months: readonly string[], day = 31): number | null {
  return usualCents(months.map((m) => spendingThrough(ctx, m, day)));
}

/**
 * The usual level of a month's total spending: the median of the complete months before it, on its days 1 to `day`
 * (31: whole months, the forecast's "Tavallisesti kuussa"; a running month's day: "tavallisesti tähän mennessä").
 * null under three complete months.
 */
export function usualSpending(ctx: AnalysisContext, month: string, day = 31): number | null {
  return usualSpendingOver(ctx, completeMonthsBefore(ctx, month), day);
}

/**
 * The median earned income of the complete months before `month` (at most six): the yardstick of the income shares and
 * gates of the insights (borrowing, commitments, large income, the income series), written out in their texts as "tavalliset
 * tulot". Money from people, refunds and own money are left out. null under three complete months. The income page's
 * figure of the same name is the report's `stability.medianCents`, a longer window of regular income.
 */
export function usualIncome(ctx: AnalysisContext, month: string): number | null {
  return usualCents(completeMonthsBefore(ctx, month).map((m) => earnedIncome(ctx, m)));
}

/** A cause or a finding is worth its own line from this share of its base a month (H-insights section 1). */
export const GATE_SHARE = 0.02;
/** The gate is never under 10 € a month. */
export const GATE_FLOOR_CENTS = 1000;

/**
 * The smallest figure worth its own line against `baseCents` a month: 2 % of it, at least `floorCents` (10 €). The
 * income views pass their own floor.
 */
export function gateFor(baseCents: number, floorCents: number = GATE_FLOOR_CENTS): number {
  return Math.max(floorCents, Math.round(GATE_SHARE * baseCents));
}
