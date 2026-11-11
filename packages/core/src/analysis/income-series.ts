/**
 * The income rows up to a day, their types and the regular series (one payer's salary, one benefit) that the change
 * detectors read, with the wording they share. See analysis/income.ts for the types.
 */
import { addMonths, monthOf } from "../dates.ts";
import { median } from "../stats.ts";
import { INCOME_GATE_FLOOR_CENTS } from "../thresholds.ts";
import type { IsoDate } from "../types.ts";
import type { CalcLine } from "../optimise/types.ts";
import type { AnalysisContext, AnalysisTx } from "./context.ts";
import { formatEur, formatFiDayMonth, monthNameIn } from "./format.ts";
import { messageIn } from "../messages.ts";
import { DEFAULT_LANGUAGE, type Language } from "../locale.ts";
import { byPayPeriod, INCOME_TYPES, type IncomeType, incomeTypes, isIncomeRow, type PayDay, payDayOf, payerKey, payersOf, periodOf } from "./income.ts";
import { expectedIncome } from "./expected.ts";
import { gateFor, isCompleteMonth } from "./usual.ts";

export type IncomeChangeKind =
  | "raise"
  | "cut"
  | "tax_card"
  | "tax_limit"
  | "variable"
  | "benefit_ended"
  | "benefit_started"
  | "benefit_changed"
  | "benefit_step"
  | "payer_changed"
  | "stopped"
  | "missing"
  | "new_source"
  | "windfall"
  | "windfall_ahead"
  | "residual_tax";

export interface IncomeChange {
  id: string;
  kind: IncomeChangeKind;
  type: IncomeType | null;
  payer: string | null;
  title: string;
  detail: string;
  /** A residual tax whose last year cannot be read (the paying account starts later): the day of its last instalment, which the insight sets in place of a year ago. */
  unknownBefore?: IsoDate;
  /** The monthly level before the change in cents, when the change has one: what an insight sets the new level against. */
  beforeCents?: number;
  /** What it moves a month, signed (+ = more income). A one-off counts a twelfth. Ranks the list. */
  monthlyCents: number;
  /** Over a year, positive: a level change times twelve, or the one-off amount. */
  yearlyCents: number;
  txIds: string[];
  /** The working of the title's figure (`Insight.calc`). */
  calc?: CalcLine[];
  /** A change of payer or pay that stopped: the day the old payer was last paid. The first page tells it only while that is recent. */
  lastPaid?: IsoDate;
}

export interface Period {
  month: string;
  cents: number;
  date: IsoDate;
}

/** A run of regular income from one payer: main salary payments, or one benefit. */
export interface IncomeSeries {
  key: string;
  type: IncomeType;
  payer: string;
  accountId: string;
  rows: AnalysisTx[];
  periods: Period[];
  payDay: PayDay | null;
  /** Median of the last six pay periods. */
  usualCents: number;
  /** Median days between payments. */
  gapDays: number;
}

/** Income rows up to `end` and their types: what every income view starts from. */
export interface IncomeBase {
  ctx: AnalysisContext;
  end: IsoDate;
  rows: AnalysisTx[];
  types: Map<string, IncomeType>;
  series: IncomeSeries[];
  /** Latest booking day per account: the sync covers dates up to it. */
  lastDay: Map<string, number>;
  /** Expected earned income of a complete month before `end` (`expectedIncome`), null under three months. */
  usualMonthlyCents: number | null;
  /** The pay period (month) of each row of a regular series: pay for the 1st booked on the 31st belongs to the 1st's month. */
  periodMonth: Map<string, string>;
  /**
   * A regular payer's only payment in a pay period, when it stands above the payer's usual level: the cents of it that
   * are regular pay (the level). The row keeps its extra type for the rest. See `settleLonePay`.
   */
  regularPart: Map<string, number>;
  /** The last of the twelve months the income views show: the month `end` falls in when complete, else the one before. */
  anchor: string;
  /** First day of those twelve months: the window a change has to fall in to be told. */
  from: IsoDate;
}

export const isKela = (type: IncomeType) => INCOME_TYPES[type].group === "kela";

export function incomeBase(ctx: AnalysisContext, end: IsoDate): IncomeBase {
  const all = ctx.txs.filter((t) => t.bookingDate <= end);
  const rows = all.filter(isIncomeRow);
  const types = incomeTypes(rows);
  const lastDay = new Map<string, number>();
  for (const t of all) lastDay.set(t.accountId, Math.max(lastDay.get(t.accountId) ?? 0, t.day));
  const periodMonth = new Map<string, string>();
  let series = seriesOfRows(rows, types);
  const settled = settleLonePay(rows, types, series, periodMonth);
  if (settled.retyped) series = seriesOfRows(rows, types);
  const usualMonthlyCents = expectedIncome(ctx, monthOf(end));
  for (const s of series) {
    const period = periodOf(s.rows.map((t) => t.bookingDate));
    for (const t of s.rows) periodMonth.set(t.id, period(t.bookingDate));
  }
  const endMonth = monthOf(end);
  const anchor = isCompleteMonth(ctx, endMonth) ? endMonth : addMonths(endMonth, -1);
  return { ctx, end, rows, types, series, lastDay, usualMonthlyCents, periodMonth, regularPart: settled.regularPart, anchor, from: `${addMonths(anchor, -11)}-01` };
}

function seriesOfRows(rows: readonly AnalysisTx[], types: ReadonlyMap<string, IncomeType>): IncomeSeries[] {
  const groups = new Map<string, AnalysisTx[]>();
  for (const t of rows) {
    const type = types.get(t.id)!;
    if (!INCOME_TYPES[type].regular || t.amountCents <= 0) continue;
    const key = isKela(type) ? type : `${type}|${payerKey(t)}`;
    const list = groups.get(key);
    if (list) list.push(t);
    else groups.set(key, [t]);
  }
  return [...groups.entries()].map(([key, list]) => seriesOf(key, types.get(list[0]!.id)!, list));
}

/**
 * The usual level of a pay series: the median of its last six pay periods. The one place that says it; `usualCents` is
 * its value at the end of the rows, and a payment in the past is read against the level before it.
 */
function payLevel(periods: readonly Period[]): number {
  return Math.round(median(periods.slice(-6).map((p) => p.cents)));
}

/**
 * A regular payer's only payment in a pay period is regular pay up to the payer's usual level (`payLevel` of the
 * periods before it): at or below the level the whole payment is regular, above it only the excess is extra. The text
 * of a payment (bonus, holiday pay) or a size 1.4 times over the pay before it had set it apart whole (`incomeTypes`);
 * a second payment in the same period keeps that rule. A payer needs three pay periods to have a level.
 */
function settleLonePay(
  rows: readonly AnalysisTx[],
  types: Map<string, IncomeType>,
  series: readonly IncomeSeries[],
  periodMonth: Map<string, string>,
): { regularPart: Map<string, number>; retyped: boolean } {
  const regularPart = new Map<string, number>();
  const known = new Map(series.filter((s) => s.type === "salary" && s.periods.length >= 1).map((s) => [s.key, s]));
  let retyped = false;
  for (const [key, payerRows] of payersOf(rows)) {
    const s = known.get(`salary|${key}`);
    if (!s) continue;
    const byPeriod = byPayPeriod(payerRows);
    // a payer of two payments a month is not read this way
    if (median([...byPeriod.values()].map((l) => l.length)) >= 2) continue;
    for (const [month, list] of byPeriod) {
      const t = list[0]!;
      const type = types.get(t.id)!;
      if (list.length !== 1 || (type !== "holiday_pay" && type !== "other_pay")) continue;
      const before = s.periods.filter((p) => p.date < t.bookingDate);
      if (before.length < 3) continue;
      const level = payLevel(before);
      periodMonth.set(t.id, month);
      if (t.amountCents <= level) {
        types.set(t.id, "salary");
        retyped = true;
      } else regularPart.set(t.id, level);
    }
  }
  return { regularPart, retyped };
}

/** What a row says in the income views: its whole amount under its type, or for a split payment the regular pay and the extra. */
export function payPieces(b: IncomeBase, t: AnalysisTx): { type: IncomeType; cents: number }[] {
  const type = b.types.get(t.id)!;
  const regular = b.regularPart.get(t.id);
  return regular === undefined ? [{ type, cents: t.amountCents }] : [{ type: "salary", cents: regular }, { type, cents: t.amountCents - regular }];
}

function seriesOf(key: string, type: IncomeType, rows: AnalysisTx[]): IncomeSeries {
  const period = periodOf(rows.map((t) => t.bookingDate));
  const byMonth = new Map<string, Period>();
  for (const t of rows) {
    const month = period(t.bookingDate);
    const p = byMonth.get(month);
    if (p) p.cents += t.amountCents;
    else byMonth.set(month, { month, cents: t.amountCents, date: t.bookingDate });
  }
  const periods = [...byMonth.values()].sort((a, b) => (a.month < b.month ? -1 : 1));
  const last = rows[rows.length - 1]!;
  const gaps = rows.slice(1).map((t, i) => t.day - rows[i]!.day);
  return {
    key,
    type,
    payer: isKela(type) ? "Kela" : last.merchant,
    accountId: last.accountId,
    rows,
    periods,
    payDay: payDayOf(rows.map((t) => t.bookingDate)),
    usualCents: payLevel(periods),
    gapDays: gaps.length ? median(gaps) : 30,
  };
}

// ── wording ──

const MONTH_ELATIVE = ["tammikuusta", "helmikuusta", "maaliskuusta", "huhtikuusta", "toukokuusta", "kesäkuusta", "heinäkuusta", "elokuusta", "syyskuusta", "lokakuusta", "marraskuusta", "joulukuusta"];
const MONTH_INESSIVE = ["tammikuussa", "helmikuussa", "maaliskuussa", "huhtikuussa", "toukokuussa", "kesäkuussa", "heinäkuussa", "elokuussa", "syyskuussa", "lokakuussa", "marraskuussa", "joulukuussa"];
/** The month of a date as a sentence takes it: "syyskuusta" (a start) or "syyskuussa" (a time); English has the plain name for both. */
export const monthFrom = (d: IsoDate, lang: Language = DEFAULT_LANGUAGE) => (lang === "en" ? monthNameIn(d, lang) : MONTH_ELATIVE[Number(d.slice(5, 7)) - 1]!);
export const monthIn = (d: IsoDate, lang: Language = DEFAULT_LANGUAGE) => (lang === "en" ? monthNameIn(d, lang) : MONTH_INESSIVE[Number(d.slice(5, 7)) - 1]!);
export const eur = (cents: number, lang: Language = DEFAULT_LANGUAGE) => formatEur(Math.abs(cents), false, lang);
/** "15.9." for a date this year or last, the full date otherwise. */
export const shortDate = (d: IsoDate, lang: Language = DEFAULT_LANGUAGE) => formatFiDayMonth(d, lang);

/** The name of an income type in a language (the table in `income.ts` is the Finnish one). */
export const typeName = (type: IncomeType, lang: Language = DEFAULT_LANGUAGE): string => messageIn(lang, `income.type_${type}` as "income.shared");

/** Name of a benefit as the subject of a sentence: "Asumistuki", "Kelan etuus". */
export function benefitName(type: IncomeType, lang: Language = DEFAULT_LANGUAGE): string {
  if (type === "kela_other") return lang === "en" ? "Kela benefit" : "Kelan etuus";
  const label = typeName(type, lang).replace(/^Kela: /, "");
  return label[0]!.toUpperCase() + label.slice(1);
}

/** "15. päivä tai sitä edeltävä pankkipäivä", "kuun ensimmäinen pankkipäivä". */
export function payDayText(pd: Pick<PayDay, "day" | "rule">, lang: Language = DEFAULT_LANGUAGE): string {
  if (pd.day === 1 && pd.rule === "next") return messageIn(lang, "income.pay_first");
  if (pd.day === 31 && pd.rule === "prev") return messageIn(lang, "income.pay_last");
  return messageIn(lang, pd.rule === "prev" ? "income.pay_before" : "income.pay_after", { day: pd.day });
}

/** The same as a time of the month: "kuun ensimmäisenä pankkipäivänä", "on the first banking day of the month". */
export const payDayWhen = (pd: Pick<PayDay, "day" | "rule">, lang: Language = DEFAULT_LANGUAGE) =>
  pd.day === 1 && pd.rule === "next" ? messageIn(lang, "inc.when_first") : pd.day === 31 && pd.rule === "prev" ? messageIn(lang, "inc.when_last") : messageIn(lang, pd.rule === "prev" ? "inc.when_before" : "inc.when_after", { day: pd.day });

/** Stage C gate for income: `gateFor` the usual monthly income, with its own floor (`INCOME_GATE_FLOOR_CENTS`). */
export const passes = (b: IncomeBase, monthly: number) => Math.abs(monthly) >= gateFor(b.usualMonthlyCents ?? 0, INCOME_GATE_FLOOR_CENTS);
