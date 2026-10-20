import { monthIndex, monthOf } from "../../dates.ts";
import { monthName, monthStem } from "../format.ts";
import { fold } from "../../merchant.ts";
import type { RecurringSeries } from "../../recurring.ts";
import { type AnalysisContext, type AnalysisTx, netSpend, standingOf } from "../context.ts";
import { monthOneOffs } from "../one-offs.ts";
import { completeMonthsBefore, gateFor, GATE_FLOOR_CENTS, usualSpending } from "../usual.ts";
import { isLenderName } from "../../wording.ts";
import type { IsoDate, UserInputs } from "../../types.ts";
import { coveringMark, inUseQuietsQuestion, type MarkedSeries, marksBySubject } from "../subscription-alerts.ts";

const COUNT_WORDS = ["", "yksi", "kaksi", "kolme", "neljä", "viisi", "kuusi", "seitsemän", "kahdeksan", "yhdeksän"];

/** "kolme", or the digits from ten on. */
export const countWord = (n: number) => COUNT_WORDS[n] ?? String(n);
export const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

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

export interface MonthRows {
  txs: AnalysisTx[];
  /** consumption + debt */
  spend: number;
  /** Spending outside subscriptions and bills: "ostokset ilman laskuja ja tilauksia". */
  purchases: number;
}

const months = new WeakMap<AnalysisContext, Map<number, MonthRows>>();

/** Rows and sums per month index, built once per context. */
export function monthRows(ctx: AnalysisContext, month: string): MonthRows {
  let byMonth = months.get(ctx);
  if (!byMonth) {
    byMonth = new Map();
    for (const t of ctx.txs) {
      let e = byMonth.get(t.month);
      if (!e) byMonth.set(t.month, (e = { txs: [], spend: 0, purchases: 0 }));
      e.txs.push(t);
      e.spend += t.spend;
      if (!ctx.fixedIds.has(t.id)) e.purchases += t.spend;
    }
    months.set(ctx, byMonth);
  }
  return byMonth.get(monthIndex(month)) ?? { txs: [], spend: 0, purchases: 0 };
}


/** What the one-offs of a month (`monthOneOffs`, the level policy) cost in the end. */
export function oneOffCents(ctx: AnalysisContext, month: string): number {
  return monthOneOffs(ctx, month, completeMonthsBefore(ctx, month)).reduce((s, t) => s + netSpend(t), 0);
}

/** The purchases of a month (`MonthRows.purchases`) with its one-offs taken out. */
export function purchasesWithoutOneOff(ctx: AnalysisContext, month: string): number {
  return monthRows(ctx, month).purchases - oneOffCents(ctx, month);
}

/**
 * The smallest finding worth a line, per month: `gateFor` the usual monthly spending, 2 % of it or 10 €, whichever is
 * more (H-insights section 1). 10 € without a usual level.
 */
export function gateMonthly(ctx: AnalysisContext, end: string): number {
  return gateFor(usualSpending(ctx, monthOf(end)) ?? 0);
}

/**
 * The gate of a finding about one contract or charge (a renewal, a price rise, a trial turned paid, new subscriptions):
 * 10 € a month, as the catalogue sets it. The household-wide gate above would silence a 13 € subscription in a household
 * that spends 3 000 € a month, and that charge is exactly what the household did not think to check.
 */
export const ITEM_GATE_MONTHLY_CENTS = GATE_FLOOR_CENTS;

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
  if (!days) dayOfId.set(ctx, (days = new Map(standingOf(ctx).txs.map((t) => [t.id, t.day]))));
  const sorted = s.transactionIds.map((id) => days.get(id)!).sort((a, b) => a - b);
  return sorted.every((d, i) => i === 0 || d - sorted[i - 1]! >= s.intervalDays / 2);
}

/** Payment services that sell instalment plans: their charges are instalments (instalments.ts), not subscriptions or prices. */
export const isLender = (merchant: string) => isLenderName(fold(merchant));

/** What the household said about a subscription, and on which day. */
export interface SubscriptionAnswer {
  mark: "cancelled" | "in_use";
  day: IsoDate;
}

/**
 * The household's answers on subscriptions (`user_marks`): Lopetettu, or Käytössä within the last 12 months, the rule
 * that quiets the forgotten-service question. Säästövinkit tells no subscription finding or insight about an answered
 * series again. Keyed as `marksBySubject` keys the marks (a series' subject, or the merchant's name for an old mark on
 * a merchant): read it with `answerOf`.
 */
export function answeredSubscriptions(inputs: UserInputs, today: IsoDate): ReadonlyMap<string, SubscriptionAnswer> {
  const out = new Map<string, SubscriptionAnswer>();
  for (const [key, m] of marksBySubject(inputs.marks)) {
    // the server stores the mark in the instance's time zone, so its date part is the local day
    if (m.mark === "cancelled" || (m.mark === "in_use" && inUseQuietsQuestion(m, today))) out.set(key, { mark: m.mark, day: m.markedAt.slice(0, 10) });
  }
  return out;
}

/** The answer on a series: its own, or an old one on its merchant, which covers every series of the merchant. */
export function answerOf(answered: ReadonlyMap<string, SubscriptionAnswer>, s: MarkedSeries): SubscriptionAnswer | undefined {
  return coveringMark(answered, s, (a) => a.day);
}

/**
 * Whether an answer settles a statement whose news is from `since` (the day a price changed). Lopetettu always does;
 * Käytössä only when it was given on or after that day, since an earlier answer did not know the new price.
 */
export function settledBy(answer: SubscriptionAnswer | undefined, since: IsoDate | null = null): boolean {
  if (!answer) return false;
  return answer.mark === "cancelled" || since === null || answer.day >= since;
}

