/**
 * The income rows up to a day, their types and the regular series (one payer's salary, one benefit) that the change
 * detectors read, with the wording they share. See analysis/income.ts for the types.
 */
import { addMonths, monthOf } from "../dates.ts";
import { median } from "../stats.ts";
import type { IsoDate } from "../types.ts";
import type { InsightCalcLine } from "./insights/types.ts";
import type { AnalysisContext, AnalysisTx } from "./context.ts";
import { formatEur, formatFiDate } from "./format.ts";
import { byPayPeriod, INCOME_TYPES, type IncomeType, incomeTypes, isIncomeRow, type PayDay, payDayOf, payerKey, payersOf, periodOf } from "./income.ts";
import { gateFor, isCompleteMonth, usualIncome } from "./usual.ts";

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
  /** What it moves a month, signed (+ = more income). A one-off counts a twelfth. Ranks the list. */
  monthlyCents: number;
  /** Over a year, positive: a level change times twelve, or the one-off amount. */
  yearlyCents: number;
  txIds: string[];
  /** The working of the title's figure (`Insight.calc`). */
  calc?: InsightCalcLine[];
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
  /** Usual earned income of a complete month before `end` (`usualIncome`), null under three months. */
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
  const usualMonthlyCents = usualIncome(ctx, monthOf(end));
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
  const known = new Map(series.filter((s) => s.type === "salary" && s.periods.length >= 3).map((s) => [s.key, s]));
  let retyped = false;
  for (const [key, payerRows] of payersOf(rows)) {
    const s = known.get(`salary|${key}`);
    if (!s) continue;
    for (const [month, list] of byPayPeriod(payerRows)) {
      const t = list[0]!;
      const type = types.get(t.id)!;
      if (list.length !== 1 || (type !== "holiday_pay" && type !== "other_pay")) continue;
      const before = s.periods.filter((p) => p.date < t.bookingDate);
      const level = payLevel(before.length >= 3 ? before : s.periods);
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
export const COUNT_INESSIVE = ["", "yhdessä", "kahdessa", "kolmessa", "neljässä"];
export const elative = (d: IsoDate) => MONTH_ELATIVE[Number(d.slice(5, 7)) - 1]!;
export const inessive = (d: IsoDate) => MONTH_INESSIVE[Number(d.slice(5, 7)) - 1]!;
export const eur = (cents: number) => formatEur(Math.abs(cents), false);
/** "15.9." for a date this year or last, the full date otherwise. */
export const shortDate = (d: IsoDate) => formatFiDate(d).replace(/\d{4}$/, "");

/** Name of a benefit as the subject of a sentence: "Asumistuki", "Kelan etuus". */
export function benefitName(type: IncomeType): string {
  if (type === "kela_other") return "Kelan etuus";
  const label = INCOME_TYPES[type].label.replace(/^Kela: /, "");
  return label[0]!.toUpperCase() + label.slice(1);
}

/** "15. päivä tai sitä edeltävä pankkipäivä", "kuun ensimmäinen pankkipäivä". */
export function payDayText(pd: Pick<PayDay, "day" | "rule">): string {
  if (pd.day === 1 && pd.rule === "next") return "kuun ensimmäinen pankkipäivä";
  if (pd.day >= 28 && pd.rule === "prev") return pd.day === 31 ? "kuun viimeinen pankkipäivä" : `${pd.day}. päivä tai sitä edeltävä pankkipäivä`;
  return `${pd.day}. päivä tai sitä ${pd.rule === "prev" ? "edeltävä" : "seuraava"} pankkipäivä`;
}

export const payDayAdessive = (pd: Pick<PayDay, "day" | "rule">) =>
  pd.day === 1 && pd.rule === "next" ? "kuun ensimmäisenä pankkipäivänä" : pd.day === 31 && pd.rule === "prev" ? "kuun viimeisenä pankkipäivänä" : `${pd.day}. päivänä tai sitä ${pd.rule === "prev" ? "edeltävänä" : "seuraavana"} pankkipäivänä`;


/** Stage C gate for income: `gateFor` the usual monthly income, with a floor of 30 € a month. */
const INCOME_GATE_FLOOR_CENTS = 3000;

export const passes = (b: IncomeBase, monthly: number) => Math.abs(monthly) >= gateFor(b.usualMonthlyCents ?? 0, INCOME_GATE_FLOOR_CENTS);
