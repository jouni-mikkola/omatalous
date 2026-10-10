import { type CategoryKind, getCategory } from "../categories.ts";
import { dayNumber, monthIndex, weekdayOf } from "../dates.ts";
import { detectRecurring, type RecurringSeries } from "../recurring.ts";
import type { Account, IsoDate, Transaction } from "../types.ts";
import { type Flows, flowsOf } from "./flows.ts";
import type { DayRange } from "./period.ts";

/** A transaction with everything the reports need precomputed once. */
export interface AnalysisTx extends Transaction {
  day: number;
  month: number;
  weekday: number;
  kind: CategoryKind;
  group: string;
  flows: Flows;
  /** consumption + debt: what category and trend charts show. */
  spend: number;
}

/**
 * Built once per data change (the server caches it) and shared by the
 * dashboard and every report, so a request only filters and sums.
 */
export interface AnalysisContext {
  today: IsoDate;
  todayDay: number;
  /** First booking date in the history, or null when there is none. */
  dataFrom: IsoDate | null;
  accounts: readonly Account[];
  /** Sorted by day ascending. */
  txs: readonly AnalysisTx[];
  recurring: readonly RecurringSeries[];
  /** Category ids that own colour slots 1–7 (by all-time spend). */
  colorOrder: readonly string[];
  /** Transaction ids in active subscriptions/bills (fixed costs). */
  fixedIds: ReadonlySet<string>;
  /** Transaction ids in habit series. */
  habitIds: ReadonlySet<string>;
}

export function createContext(transactions: readonly Transaction[], accounts: readonly Account[], today: IsoDate): AnalysisContext {
  const savingsIds = new Set(accounts.filter((a) => a.type === "savings").map((a) => a.id));
  const loanIds = new Set(accounts.filter((a) => a.type === "loan").map((a) => a.id));
  const txs = transactions
    .map((t): AnalysisTx => {
      const category = getCategory(t.category);
      const flows = flowsOf(t, savingsIds, loanIds);
      return {
        ...t,
        day: dayNumber(t.bookingDate),
        month: monthIndex(t.bookingDate),
        weekday: weekdayOf(t.bookingDate),
        kind: category.kind,
        group: category.group,
        flows,
        spend: flows.consumption + flows.debt,
      };
    })
    .sort((a, b) => a.day - b.day);

  const recurring = detectRecurring(txs, today);
  const fixedIds = new Set<string>();
  const habitIds = new Set<string>();
  for (const s of recurring) {
    const target = s.kind === "subscription" || s.kind === "bill" ? fixedIds : s.kind === "habit" ? habitIds : null;
    if (target) for (const id of s.transactionIds) target.add(id);
  }

  const allTime = new Map<string, number>();
  for (const t of txs) if (t.spend) allTime.set(t.category, (allTime.get(t.category) ?? 0) + t.spend);
  const colorOrder = [...allTime.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 7)
    .map(([c]) => c);

  return { today, todayDay: dayNumber(today), dataFrom: txs[0]?.bookingDate ?? null, accounts, txs, recurring, colorOrder, fixedIds, habitIds };
}

/** Bank exports start on a weekday with bookings: a history from the 3rd still covers a month from the 1st. */
const COVER_SLACK_DAYS = 3;

/** Does the history reach back to `from`? */
export function historyCovers(ctx: Pick<AnalysisContext, "dataFrom">, from: IsoDate): boolean {
  return ctx.dataFrom !== null && dayNumber(ctx.dataFrom) <= dayNumber(from) + COVER_SLACK_DAYS;
}

const pastRecurring = new WeakMap<AnalysisContext, Map<IsoDate, readonly RecurringSeries[]>>();

/**
 * Recurring series as they looked on `date`: what was active, what had
 * changed price. A past period is judged by its own end, not by today.
 * Cached per context, so a dashboard and its reports detect once.
 */
export function recurringAt(ctx: AnalysisContext, date: IsoDate): readonly RecurringSeries[] {
  if (date >= ctx.today) return ctx.recurring;
  let cache = pastRecurring.get(ctx);
  if (!cache) pastRecurring.set(ctx, (cache = new Map()));
  let found = cache.get(date);
  if (!found) {
    found = detectRecurring(ctx.txs.filter((t) => t.bookingDate <= date), date);
    if (cache.size > 16) cache.delete(cache.keys().next().value!);
    cache.set(date, found);
  }
  return found;
}

export function inDays(ctx: AnalysisContext, r: DayRange): AnalysisTx[] {
  // txs are sorted, so binary search the start and walk to the end
  const list = ctx.txs;
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid]!.day < r.fromDay) lo = mid + 1;
    else hi = mid;
  }
  const out: AnalysisTx[] = [];
  for (let i = lo; i < list.length && list[i]!.day <= r.toDay; i++) out.push(list[i]!);
  return out;
}

/**
 * Categories that are costs of living or money handled, not something bought:
 * "largest purchase" skips them (a tax payment or an insurance premium is not a purchase, nor is the weekly food shop).
 */
const NOT_PURCHASES = new Set(["taxes", "card_bill", "p2p", "cash", "fees", "insurance", "housing", "utilities", "telecom", "memberships", "groceries"]);

/** A one-off spend on goods or services, for "largest purchases". */
export function isPurchase(t: Pick<AnalysisTx, "category" | "kind">): boolean {
  return t.kind === "expense" && !NOT_PURCHASES.has(t.category);
}
