import { monthIndex, monthOf } from "../../dates.ts";
import { formatEur, monthNameIn, monthStem } from "../format.ts";
import { DEFAULT_LANGUAGE, type Language } from "../../locale.ts";
import { messageIn } from "../../messages.ts";
import { fold } from "../../merchant.ts";
import type { RecurringSeries } from "../../recurring.ts";
import { type AnalysisContext, type AnalysisTx, netSpend, standingOf } from "../context.ts";
import { monthOneOffs } from "../one-offs.ts";
import { expectedIncome, expectedSpending } from "../expected.ts";
import { completeMonthsBefore, gateFor } from "../usual.ts";
import { GATE_FLOOR_CENTS, SINGLE_TOP_ROWS } from "../../thresholds.ts";
import { isLenderName } from "../../wording.ts";
import type { IsoDate, UserInputs } from "../../types.ts";
import { coveringMark, inUseQuietsQuestion, type MarkedSeries, marksBySubject } from "../subscription-alerts.ts";
import type { CalcLine } from "../../optimise/types.ts";
import { type Action, type Comparison, type EffectLine, type Insight, type InsightEvidence, type InsightFact, q } from "./types.ts";

const COUNT_WORDS = { fi: ["", "yksi", "kaksi", "kolme", "neljä", "viisi", "kuusi", "seitsemän", "kahdeksan", "yhdeksän"], en: ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"] };

/** The sections of Raportit an action can open, by the anchor of the section. */
export const REPORT = { income: "tulot", fixed: "kiinteat", loans: "lainat", years: "vuodet", prices: "kiinteat-hinnat" } as const;

/**
 * What an insight is worth over a year, from the household's side: negative = it pays or earns that much less. The
 * value is signed, "−360 €" or "+3 000 €". Null for zero, which has nothing to rank.
 */
function effectOf(yearlyCents: number | null, lang: Language): EffectLine | null {
  if (yearlyCents === null) return null;
  const rounded = Math.round(yearlyCents);
  if (rounded === 0) return null;
  return { label: messageIn(lang, "calc.effect_year"), value: `${rounded > 0 ? "+" : ""}${formatEur(rounded, false, lang)}`, cents: rounded };
}

/** What a source hands `insightOf`: the three parts, the yearly effect and the evidence without the effect line. */
interface InsightParts extends Pick<InsightEvidence, "link" | "merchant"> {
  id: string;
  fact: InsightFact;
  comparison: Comparison;
  action: Action;
  /** Signed, from the household's side; null when the finding has no yearly figure. */
  yearlyCents: number | null;
  kind: Insight["kind"];
  rows?: string[];
  calc: CalcLine[];
  /** The language of the effect line, which is the last line of the working; Finnish when absent. */
  lang?: Language;
}

/** The one place an `Insight` is made: the effect is a calc line, and it is the last line of the working. */
export function insightOf(p: InsightParts): Insight {
  const effectPerYear = effectOf(p.yearlyCents, p.lang ?? DEFAULT_LANGUAGE);
  const { id, fact, comparison, action, kind, rows = [], link, merchant, calc } = p;
  return { id, fact, comparison, action, effectPerYear, kind, evidence: { rows, ...(link ? { link } : {}), ...(merchant ? { merchant } : {}), calc: effectPerYear ? [...calc, effectPerYear] : calc } };
}

/** The comparison "its share of the expected spending of a month", or null while no month is expected (under three complete months). */
export function shareOfExpectedSpending(ctx: AnalysisContext, end: string, cents: number): Comparison | null {
  const expected = expectedSpending(ctx, monthOf(end));
  return expected && expected > 0 ? { label: "shareOfExpectedSpending", value: q.percent(Math.round((cents / expected) * 100)) } : null;
}

/** The comparison "its share of the expected income of a month", or null while no month is expected. */
export function shareOfExpectedIncome(ctx: AnalysisContext, end: string, cents: number): Comparison | null {
  const expected = expectedIncome(ctx, monthOf(end));
  return expected && expected > 0 ? { label: "shareOfExpectedIncome", value: q.percent(Math.round((cents / expected) * 100)) } : null;
}

/**
 * Whether one of the rows an insight rests on is among the `SINGLE_TOP_ROWS` largest rows of its own month: the test a
 * single finding passes before it is told. A finding that rests on one row is news only when that row is a big one of
 * its month, so each row is set against its own month and not the figure of the year against the current one.
 * Transfers are not rows of the household's money. An insight with no row of the data cannot be judged and is not told.
 */
export function amongLargestRows(ctx: AnalysisContext, rowIds: readonly string[]): boolean {
  const wanted = new Set(rowIds);
  return ctx.txs.some((row) => {
    if (!wanted.has(row.id) || row.isTransfer) return false;
    const larger = monthRows(ctx, monthOf(row.bookingDate)).txs.filter((t) => !t.isTransfer && Math.abs(t.amountCents) > Math.abs(row.amountCents)).length;
    return larger < SINGLE_TOP_ROWS;
  });
}

/** "kolme", in English "three", or the digits from ten on. */
export const countWord = (n: number, lang: Language = DEFAULT_LANGUAGE) => COUNT_WORDS[lang][n] ?? String(n);
export const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "kesä–marraskuu 2026", or "joulu 2025–toukokuu 2026" over a year's end; in English "June–November 2026". */
export function monthSpan(from: string, to: string, lang: Language = DEFAULT_LANGUAGE): string {
  const first = lang === "en" ? monthNameIn(from, lang) : monthStem(from);
  if (from.slice(0, 4) === to.slice(0, 4)) return `${first}–${monthNameIn(to, lang)} ${to.slice(0, 4)}`;
  return `${monthNameIn(from, lang)} ${from.slice(0, 4)}–${monthNameIn(to, lang)} ${to.slice(0, 4)}`;
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
  return gateFor(expectedSpending(ctx, monthOf(end)) ?? 0);
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

