import { getCategory } from "../categories.ts";
import { addDays, addMonths, dayNumber, daysInMonth, fromDayNumber, fromMonthIndex, monthIndex, monthOf, monthRange } from "../dates.ts";
import { fixedMonthlyCents, projectDates } from "../recurring.ts";
import { median } from "../stats.ts";
import type { IsoDate } from "../types.ts";
import { dataQualityReport, type QualitySignal } from "../reports/data-quality.ts";
import { type Alert, buildAlerts } from "./alerts.ts";
import { type AnalysisContext, type AnalysisTx, historyCovers, inDays, netPurchase, recurringAt } from "./context.ts";
import { type PeriodTotals, totalsOf } from "./flows.ts";
import { buildInsights, type Insight } from "./insights.ts";
import { type DateRange, previousRange, rangeLength, rangeMonths, toDayRange } from "./period.ts";

export interface CategoryTotal {
  category: string;
  label: string;
  group: string;
  kind: string;
  cents: number;
  count: number;
  share: number;
  previousCents: number;
}

export interface MerchantStat {
  merchant: string;
  category: string;
  count: number;
  totalCents: number;
  avgCents: number;
  perMonth: number;
  lastDate: IsoDate;
}

export interface TrendSeries {
  category: string;
  label: string;
  values: number[];
}

export interface MonthlyTrend {
  months: string[];
  /** Up to 7 named categories + "other_rest", in fixed colour order. */
  series: TrendSeries[];
  income: number[];
  /** consumption + debt per month */
  expenses: number[];
  saved: number[];
  /**
   * Months the history fully covers and that have ended. The running month
   * and the first, partly fetched one are left out of averages.
   */
  complete: boolean[];
  /** The same 12 months one year earlier, per series category (incl. "other_rest"); zeros without data. */
  lastYear: { expenses: number[]; series: Record<string, number[]> };
}

export interface DailyTotal {
  date: IsoDate;
  cents: number;
  count: number;
}

export interface MonthPace {
  month: string;
  daysInMonth: number;
  /** Cumulative spending by day of month; null after today. */
  current: (number | null)[];
  /** Average cumulative spending of the three previous months. */
  average: number[];
  currentTotal: number;
  averageAtToday: number;
  averageMonthTotal: number;
}

export interface UpcomingCharge {
  merchant: string;
  category: string;
  /** Expected charge, positive. */
  amountCents: number;
  date: IsoDate;
}

/** Running month: spending so far, the forecast to month end and bills still to come. */
export interface MonthForecast {
  /** "2026-10" */
  month: string;
  /** consumption + debt so far this month */
  spentCents: number;
  /** spent + upcoming recurring + typical variable spending for the days left */
  forecastCents: number;
  /** Subscriptions and bills still due before the month ends. */
  billsLeftCents: number;
  /** Usual everyday spending for the days left. */
  usualLeftCents: number;
  /** Average of complete months (the chart's dashed line), 0 when none. */
  averageMonthCents: number;
  /** Subscriptions and bills in the next 14 days, date ascending. */
  upcoming: UpcomingCharge[];
}

export interface DashboardData {
  range: { from: IsoDate; to: IsoDate; previousFrom: IsoDate; previousTo: IsoDate };
  /** False when the history does not reach back over the previous period: deltas and swings are hidden. */
  comparable: boolean;
  /** The range reaches today (from <= today <= to). The previous period is then cut to the same days (range.previousTo). */
  running: boolean;
  /** First booking date in the history, or null. */
  dataFrom: IsoDate | null;
  totals: PeriodTotals;
  previousTotals: PeriodTotals;
  fixedMonthlyCents: number;
  trend: MonthlyTrend;
  categories: CategoryTotal[];
  /** Everyday merchants: subscriptions, bills (rent, insurance), payments to people and cash are left out, the categories carry them. */
  merchants: MerchantStat[];
  /** Everyday spending per day: subscriptions and bills are left out, or the days bills fall on would hide the pattern. */
  daily: DailyTotal[];
  pace: MonthPace;
  /** null when the selected period does not include today. */
  forecast: MonthForecast | null;
  /** Cost traps and mistakes; the overview shows them before insights. */
  alerts: Alert[];
  /** The first warning from the data quality report, so a user who never opens Reports still sees it. */
  dataNotice: QualitySignal | null;
  insights: Insight[];
  /** Category ids that own colour slots 1–7 (slot 8 is "Muut"). */
  colorOrder: string[];
}

export const REST_CATEGORY = "other_rest";

/** Payments to people and cash withdrawals are not shops: the overview's merchant list leaves them out. */
const NOT_MERCHANTS = new Set(["p2p", "cash"]);

/** Spending (consumption + debt) per category, with the previous period alongside. */
export function categoryTotals(current: readonly AnalysisTx[], previous: readonly AnalysisTx[] = []): CategoryTotal[] {
  const totals = new Map<string, { cents: number; count: number }>();
  for (const t of current) {
    if (!t.spend) continue;
    const e = totals.get(t.category) ?? { cents: 0, count: 0 };
    e.cents += t.spend;
    e.count += 1;
    totals.set(t.category, e);
  }
  const prev = new Map<string, number>();
  for (const t of previous) if (t.spend) prev.set(t.category, (prev.get(t.category) ?? 0) + t.spend);
  let all = 0;
  for (const e of totals.values()) if (e.cents > 0) all += e.cents;
  return [...totals.entries()]
    .filter(([, e]) => e.cents > 0)
    .map(([category, e]) => {
      const c = getCategory(category);
      return { category, label: c.label, group: c.group, kind: c.kind, cents: e.cents, count: e.count, share: all ? e.cents / all : 0, previousCents: prev.get(category) ?? 0 };
    })
    .sort((a, b) => b.cents - a.cents);
}

/** Consumption per merchant: how much, how often. */
export function merchantStats(txs: readonly AnalysisTx[], range: DateRange): MerchantStat[] {
  const months = rangeMonths(range);
  const byMerchant = new Map<string, { category: string; count: number; total: number; last: IsoDate }>();
  for (const t of txs) {
    const c = netPurchase(t);
    if (c <= 0) continue;
    const e = byMerchant.get(t.merchant) ?? { category: t.category, count: 0, total: 0, last: t.bookingDate };
    e.count += 1;
    e.total += c;
    if (t.bookingDate > e.last) e.last = t.bookingDate;
    byMerchant.set(t.merchant, e);
  }
  return [...byMerchant.entries()]
    .map(([merchant, e]) => ({
      merchant,
      category: e.category,
      count: e.count,
      totalCents: e.total,
      avgCents: Math.round(e.total / e.count),
      perMonth: Math.round((e.count / months) * 10) / 10,
      lastDate: e.last,
    }))
    .sort((a, b) => b.totalCents - a.totalCents);
}

export function monthlyTrend(ctx: AnalysisContext, months: readonly string[]): MonthlyTrend {
  const first = monthIndex(months[0]!);
  const named = new Set(ctx.colorOrder);
  const zeros = () => months.map(() => 0);
  const per = new Map<string, number[]>();
  const income = zeros();
  const expenses = zeros();
  const saved = zeros();
  const lastYearExpenses = zeros();
  const lastYearPer = new Map<string, number[]>();
  for (const t of ctx.txs) {
    const i = t.month - first;
    if (i >= -12 && i < months.length - 12 && t.spend) {
      const j = i + 12;
      lastYearExpenses[j]! += t.spend;
      const key = named.has(t.category) ? t.category : REST_CATEGORY;
      const arr = lastYearPer.get(key) ?? zeros();
      arr[j]! += t.spend;
      lastYearPer.set(key, arr);
    }
    if (i < 0 || i >= months.length) continue;
    income[i]! += t.flows.income;
    saved[i]! += t.flows.saved;
    if (!t.spend) continue;
    expenses[i]! += t.spend;
    const key = named.has(t.category) ? t.category : REST_CATEGORY;
    const arr = per.get(key) ?? zeros();
    arr[i]! += t.spend;
    per.set(key, arr);
  }
  const series = [...ctx.colorOrder, REST_CATEGORY]
    .filter((c) => per.has(c))
    .map((category) => ({
      category,
      label: category === REST_CATEGORY ? "Muut" : getCategory(category).label,
      values: per.get(category)!.map((v) => Math.max(0, v)),
    }));
  const complete = months.map((m) => historyCovers(ctx, `${m}-01`) && `${m}-${String(daysInMonth(m)).padStart(2, "0")}` < ctx.today);
  const lastYearSeries: Record<string, number[]> = {};
  for (const key of new Set([...series.map((x) => x.category), ...lastYearPer.keys()])) {
    lastYearSeries[key] = (lastYearPer.get(key) ?? zeros()).map((v) => Math.max(0, v));
  }
  return {
    months: [...months],
    series,
    income,
    expenses,
    saved,
    complete,
    lastYear: { expenses: lastYearExpenses, series: lastYearSeries },
  };
}

export function dailySpending(txs: readonly AnalysisTx[], fromDay: number, toDay: number): DailyTotal[] {
  const out: DailyTotal[] = [];
  for (let d = fromDay; d <= toDay; d++) out.push({ date: fromDayNumber(d), cents: 0, count: 0 });
  for (const t of txs) {
    const e = out[t.day - fromDay];
    if (!e || netPurchase(t) <= 0) continue;
    e.cents += netPurchase(t);
    e.count += 1;
  }
  return out;
}

/** Is this month's spending running ahead of or behind a normal month? */
export function monthPace(ctx: AnalysisContext, month: string, today: IsoDate): MonthPace {
  const days = daysInMonth(month);
  const target = monthIndex(month);
  const curves = new Map<number, number[]>();
  for (const t of ctx.txs) {
    if (t.month < target - 3 || t.month > target || !t.spend) continue;
    const daily = curves.get(t.month) ?? new Array<number>(days).fill(0);
    daily[Math.min(days, Number(t.bookingDate.slice(8, 10))) - 1]! += t.spend;
    curves.set(t.month, daily);
  }
  const cumulative = (m: number) => {
    let acc = 0;
    return (curves.get(m) ?? new Array<number>(days).fill(0)).map((v) => (acc += v));
  };
  const prevCurves = [1, 2, 3].map((n) => cumulative(target - n));
  const average = Array.from({ length: days }, (_, i) => Math.round(prevCurves.reduce((s, c) => s + c[i]!, 0) / 3));
  const cur = cumulative(target);
  const lastDay = monthOf(today) === month ? Number(today.slice(8, 10)) : today < `${month}-01` ? 0 : days;
  return {
    month: fromMonthIndex(target),
    daysInMonth: days,
    current: cur.map((v, i) => (i < lastDay ? v : null)),
    average,
    currentTotal: lastDay ? cur[lastDay - 1]! : 0,
    averageAtToday: lastDay ? average[lastDay - 1]! : 0,
    averageMonthTotal: average[days - 1] ?? 0,
  };
}

const isSpendingCategory = (category: string) => {
  const kind = getCategory(category).kind;
  return kind === "expense" || kind === "debt";
};

const FORECAST_HORIZON_DAYS = 14;
const VARIABLE_BASE_MONTHS = 6;

/**
 * Where this month is heading: what has gone so far, the subscriptions and
 * bills still due, and the usual everyday spending for the days left (the
 * median day of recent complete months, so one sofa does not move it).
 */
export function monthForecast(ctx: AnalysisContext, trend: Pick<MonthlyTrend, "expenses" | "complete">): MonthForecast {
  const today = ctx.today;
  const month = monthOf(today);
  const monthEnd = `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;
  const spent = inDays(ctx, { fromDay: dayNumber(`${month}-01`), toDay: ctx.todayDay }).reduce((s, t) => s + t.spend, 0);

  const horizon = addDays(today, FORECAST_HORIZON_DAYS);
  const until = horizon > monthEnd ? horizon : monthEnd;
  const upcoming: UpcomingCharge[] = [];
  let due = 0;
  for (const s of ctx.recurring) {
    if (!s.active || s.overdue || (s.kind !== "subscription" && s.kind !== "bill") || !isSpendingCategory(s.category)) continue;
    for (const d of projectDates(s, until)) {
      // a charge a few days late is still coming: expect it now
      const date = d < today ? today : d;
      if (date <= monthEnd) due += s.typicalAmountCents;
      if (date <= horizon) upcoming.push({ merchant: s.merchant, category: s.category, amountCents: s.typicalAmountCents, date });
    }
  }
  upcoming.sort((a, b) => a.date.localeCompare(b.date) || b.amountCents - a.amountCents);

  const current = monthIndex(month);
  const rates: number[] = [];
  for (let m = current - 1; m >= current - VARIABLE_BASE_MONTHS; m--) {
    const label = fromMonthIndex(m);
    if (!historyCovers(ctx, `${label}-01`)) break;
    let variable = 0;
    for (const t of ctx.txs) if (t.month === m && !ctx.fixedIds.has(t.id)) variable += t.spend;
    rates.push(variable / daysInMonth(label));
  }
  const daysLeft = daysInMonth(month) - Number(today.slice(8, 10));
  const variableLeft = Math.max(0, Math.round(median(rates) * daysLeft));

  const full = trend.expenses.filter((_, i) => trend.complete[i]);
  return {
    month,
    spentCents: spent,
    forecastCents: spent + due + variableLeft,
    billsLeftCents: due,
    usualLeftCents: variableLeft,
    averageMonthCents: full.length ? Math.round(full.reduce((s, v) => s + v, 0) / full.length) : 0,
    upcoming: upcoming.filter((u) => u.date <= horizon),
  };
}

/**
 * Everything the overview page shows. The trend always covers the 12 months
 * ending at `to`, so it stays readable when a single month is selected.
 */
export function buildDashboard(ctx: AnalysisContext, range: DateRange): DashboardData {
  // a running period is compared with the same days of the previous one, or the
  // salary on the 15th makes the first nine days look like a loss of income
  const running = range.from <= ctx.today && ctx.today <= range.to;
  const [previousFrom, previousTo] = previousRange(range.from, running ? ctx.today : range.to);
  const comparable = historyCovers(ctx, previousFrom);
  const current = inDays(ctx, toDayRange(range));
  const previous = inDays(ctx, toDayRange({ from: previousFrom, to: previousTo }));
  const totals = totalsOf(current.map((t) => t.flows));
  const previousTotals = totalsOf(previous.map((t) => t.flows));
  const categories = categoryTotals(current, previous);
  const toMonth = monthOf(range.to);
  // heatmap: the selected range, but at least half a year and at most a year;
  // days before the first transaction are missing data, not days without spending
  const toDay = toDayRange(range).toDay;
  const heatDays = Math.min(Math.max(rangeLength(range), 7 * 26), 7 * 53);
  const heatFrom = Math.min(toDay, Math.max(toDay - heatDays + 1, ctx.dataFrom ? dayNumber(ctx.dataFrom) : -Infinity));
  const heatTxs = inDays(ctx, { fromDay: heatFrom, toDay });
  const trend = monthlyTrend(ctx, monthRange(addMonths(toMonth, -11), toMonth));
  const alerts = buildAlerts(ctx, range);

  return {
    range: { from: range.from, to: range.to, previousFrom, previousTo },
    comparable,
    running,
    dataFrom: ctx.dataFrom,
    totals,
    previousTotals,
    // the fixed costs as they were at the end of the period
    fixedMonthlyCents: fixedMonthlyCents(recurringAt(ctx, range.to)),
    trend,
    categories,
    merchants: merchantStats(current.filter((t) => !ctx.fixedIds.has(t.id) && !NOT_MERCHANTS.has(t.category)), range).slice(0, 20),
    daily: dailySpending(heatTxs.filter((t) => !ctx.fixedIds.has(t.id)), heatFrom, toDay),
    pace: monthPace(ctx, toMonth, ctx.today < range.to ? ctx.today : range.to),
    forecast: range.from <= ctx.today && ctx.today <= range.to ? monthForecast(ctx, trend) : null,
    alerts,
    dataNotice: dataQualityReport(ctx, range).signals.find((x) => x.tone === "warning") ?? null,
    insights: buildInsights({ ctx, range, current, previous, categories, totals, comparable, running, alerts }),
    colorOrder: [...ctx.colorOrder],
  };
}
