import { type CategoryKind, getCategory } from "../categories.ts";
import { dayNumber, monthIndex, weekdayOf } from "../dates.ts";
import { isMobilePay } from "../industry.ts";
import { fold } from "../merchant.ts";
import { detectRecurring, type RecurringSeries } from "../recurring.ts";
import { normalizeIban } from "../transfers.ts";
import type { Account, IsoDate, Transaction } from "../types.ts";
import { hasPayeeForm } from "../wording.ts";
import { type Flows, flowsOf, incomeOf } from "./flows.ts";
import { moneyIn } from "./money-in.ts";
import type { DayRange } from "./period.ts";

/**
 * A transaction with everything the reports need precomputed once. `category` is the stored one, except on a refund
 * whose payments are in another category: it counts in theirs (`moneyIn`).
 */
export interface AnalysisTx extends Transaction {
  day: number;
  month: number;
  weekday: number;
  kind: CategoryKind;
  group: string;
  flows: Flows;
  /** consumption + debt: what category and trend charts show. */
  spend: number;
  /** Cents of this purchase that came back later: a shop refund, a person paying back, friends' shares (see `moneyIn`). */
  refunded: number;
}

/**
 * Net of refunds, one helper per base. `netPurchase`: what a purchase cost in the end, its consumption less what came
 * back, never below zero.
 */
export function netPurchase(t: Pick<AnalysisTx, "flows" | "refunded">): number {
  return Math.max(0, t.flows.consumption - t.refunded);
}

/** A MobilePay or Pivo payment to a person: never food, whatever category it was given. */
export const paidToPerson = (t: AnalysisTx): boolean => isMobilePay(t) && !t.mcc && !hasPayeeForm(fold(t.counterparty ?? ""));

/** What a row of spending (consumption + debt) cost in the end, less what came back, never below zero. */
export function netSpend(t: Pick<AnalysisTx, "spend" | "refunded">): number {
  return Math.max(0, t.spend - t.refunded);
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
  /** Money in that takes a payment back (`moneyIn`): the returning row's id to the payment whose category it lowers. */
  returns: ReadonlyMap<string, string>;
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
        refunded: 0,
      };
    })
    .sort((a, b) => a.day - b.day);
  // money in on a spending category: a refund lowers the category of the payments it takes back (or the one the user
  // put it in), the rest is income
  const byId = new Map(txs.map((t) => [t.id, t]));
  const ownIbans = new Set(accounts.map((a) => normalizeIban(a.iban)).filter((x): x is string => !!x));
  const returns = new Map<string, string>();
  for (const [id, refund] of moneyIn(txs, ownIbans)) {
    const t = byId.get(id)!;
    if (!refund) {
      t.flows = incomeOf(t.amountCents);
      t.spend = 0;
      continue;
    }
    // a refund by the user's word alone takes back no payment and stays in the category it was put in
    if (!refund.length) continue;
    const first = byId.get(refund[0]![0])!;
    if (first.category !== t.category) {
      Object.assign(t, { category: first.category, kind: first.kind, group: first.group });
      t.flows = flowsOf(t, savingsIds, loanIds);
      t.spend = t.flows.consumption + t.flows.debt;
    }
    for (const [paymentId, cents] of refund) byId.get(paymentId)!.refunded += cents;
    returns.set(id, first.id);
  }

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

  return { today, todayDay: dayNumber(today), dataFrom: txs[0]?.bookingDate ?? null, accounts, txs, returns, recurring, colorOrder, fixedIds, habitIds };
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
