import { fromMonthIndex, monthIndex, monthOf } from "../../dates.ts";
import { fold } from "../../merchant.ts";
import type { RecurringSeries } from "../../recurring.ts";
import type { AnalysisContext, AnalysisTx } from "../context.ts";
import { usualSpending } from "../explain.ts";
import { completeMonthsBefore } from "../usual.ts";

const COUNT_WORDS = ["", "yksi", "kaksi", "kolme", "neljä", "viisi", "kuusi", "seitsemän", "kahdeksan", "yhdeksän"];

/** "kolme", or the digits from ten on. */
export const countWord = (n: number) => COUNT_WORDS[n] ?? String(n);
export const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const MONTHS = ["tammi", "helmi", "maalis", "huhti", "touko", "kesä", "heinä", "elo", "syys", "loka", "marras", "joulu"];
/** "joulukuu" for "2025-12". */
export const monthName = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]}kuu`;
/** "joulu" for "2025-12": the first half of "joulu- ja heinäkuu". */
export const monthStem = (month: string) => MONTHS[Number(month.slice(5, 7)) - 1]!;
/** "kesä–marraskuu 2026", or "joulu 2025 – toukokuu 2026" over a year's end. */
export function monthSpan(from: string, to: string): string {
  if (from.slice(0, 4) === to.slice(0, 4)) return `${monthStem(from)}–${monthName(to)} ${to.slice(0, 4)}`;
  return `${monthName(from)} ${from.slice(0, 4)} – ${monthName(to)} ${to.slice(0, 4)}`;
}

/** "1.–30.9.2026", "1.7.–30.9.2026" or "1.12.2025–28.2.2026". */
export function dateSpan(from: string, to: string): string {
  const [y1, m1, d1] = from.split("-").map(Number);
  const [y2, m2, d2] = to.split("-").map(Number);
  if (y1 !== y2) return `${d1}.${m1}.${y1}–${d2}.${m2}.${y2}`;
  return m1 === m2 ? `${d1}.–${d2}.${m2}.${y2}` : `${d1}.${m1}.–${d2}.${m2}.${y2}`;
}

/** Money paid back to the household or sent by people: not income it earned (H-insights section 5). */
const NOT_EARNED = new Set(["p2p_in", "reimbursements"]);

export interface MonthRows {
  txs: AnalysisTx[];
  /** consumption + debt */
  spend: number;
  /** Spending outside subscriptions and bills: "ostokset ilman laskuja ja tilauksia". */
  purchases: number;
  /** Income without refunds and payments from people. */
  income: number;
}

const months = new WeakMap<AnalysisContext, Map<number, MonthRows>>();

/** Rows and sums per month index, built once per context. */
export function monthRows(ctx: AnalysisContext, month: string): MonthRows {
  let byMonth = months.get(ctx);
  if (!byMonth) {
    byMonth = new Map();
    for (const t of ctx.txs) {
      let e = byMonth.get(t.month);
      if (!e) byMonth.set(t.month, (e = { txs: [], spend: 0, purchases: 0, income: 0 }));
      e.txs.push(t);
      e.spend += t.spend;
      if (!ctx.fixedIds.has(t.id)) e.purchases += t.spend;
      if (!NOT_EARNED.has(t.category)) e.income += t.flows.income;
    }
    months.set(ctx, byMonth);
  }
  return byMonth.get(monthIndex(month)) ?? { txs: [], spend: 0, purchases: 0, income: 0 };
}

const netSpend = (t: Pick<AnalysisTx, "spend" | "refunded">) => Math.max(0, t.spend - t.refunded);

/**
 * The one-off in a month that is `excess` above its usual level, by the month explanation's rule (explain.ts): one
 * payment outside subscriptions and bills that is half the excess or more and larger than any payment in its category
 * in the months before. Returns the payment, or null.
 */
export function oneOff(ctx: AnalysisContext, month: string, excess: number): AnalysisTx | null {
  let biggest: AnalysisTx | null = null;
  for (const t of monthRows(ctx, month).txs) {
    if (t.category !== "card_bill" && !ctx.fixedIds.has(t.id) && netSpend(t) > (biggest ? netSpend(biggest) : 0)) biggest = t;
  }
  if (!biggest || netSpend(biggest) * 2 < excess) return null;
  for (const m of completeMonthsBefore(ctx, month)) {
    for (const t of monthRows(ctx, m).txs) if (t.category === biggest.category && netSpend(t) >= netSpend(biggest)) return null;
  }
  return biggest;
}

/** The purchases of a month (`MonthRows.purchases`) with its one-off taken out. */
export function purchasesWithoutOneOff(ctx: AnalysisContext, month: string, usual: number | null): number {
  const p = monthRows(ctx, month).purchases;
  const one = usual === null ? null : oneOff(ctx, month, p - usual);
  return one ? p - netSpend(one) : p;
}

/**
 * The smallest finding worth a line, per month: 2 % of usual monthly spending or 10 €, whichever is more
 * (H-insights section 1). 10 € without a usual level.
 */
export function gateMonthly(ctx: AnalysisContext, end: string): number {
  const usual = usualSpending(ctx, monthOf(end));
  return usual === null ? 1000 : Math.max(1000, Math.round(0.02 * usual));
}

/**
 * The gate of a finding about one contract or charge (a renewal, a price rise, a trial turned paid, new subscriptions):
 * 10 € a month, as the catalogue sets it. The household-wide gate above would silence a 13 € subscription in a household
 * that spends 3 000 € a month, and that charge is exactly what the household did not think to check.
 */
export const ITEM_GATE_MONTHLY_CENTS = 1000;

/** The complete months up to the one before `end`'s month, newest last, at most `n`. */
export function lastCompleteMonths(ctx: AnalysisContext, end: string, n: number): string[] {
  return completeMonthsBefore(ctx, monthOf(end), n);
}

/** Cadences of contracts, subscriptions and loans. A fixed sum every week or two is a habit (lunch, a club). */
export const MONTHLY_OR_LONGER: ReadonlySet<string> = new Set(["monthly", "bimonthly", "quarterly", "semiannual", "yearly"]);

const dayOfId = new WeakMap<AnalysisContext, Map<string, number>>();

/**
 * Every charge of the series at least half an interval after the one before. Two overlapping runs of the same sum
 * can pass the series detector with two charges a week apart; a contract never bills like that.
 */
export function evenlySpaced(ctx: AnalysisContext, s: Pick<RecurringSeries, "transactionIds" | "intervalDays">): boolean {
  let days = dayOfId.get(ctx);
  if (!days) dayOfId.set(ctx, (days = new Map(ctx.txs.map((t) => [t.id, t.day]))));
  const sorted = s.transactionIds.map((id) => days.get(id)!).sort((a, b) => a - b);
  return sorted.every((d, i) => i === 0 || d - sorted[i - 1]! >= s.intervalDays / 2);
}

const LENDERS = /KLARNA|WALLEY|RIVERTY|AFTERPAY|RESURS|ANYDAY/;

/** Payment services that sell instalment plans: their charges are instalments (instalments.ts), not subscriptions or prices. */
export const isLender = (merchant: string) => LENDERS.test(fold(merchant));

export const shiftMonth = (month: string, n: number) => fromMonthIndex(monthIndex(month) + n);
