import { getCategory } from "../categories.ts";
import { addMonths, monthIndex, monthOf, monthRange } from "../dates.ts";
import { fixedMonthlyCents } from "../commitments.ts";
import { type BalanceInput, type IsoDate, NO_INPUTS, type UserInputs } from "../types.ts";
import { dataQualityReport, type QualitySignal } from "./data-quality.ts";
import { type AheadData, cashAhead } from "./ahead.ts";
import { type Alert, buildAlerts } from "./alerts.ts";
import { type Bridge, buildBridge } from "./bridge.ts";
import { type AnalysisContext, type AnalysisTx, historyCovers, inDays, netPurchase, recurringAt } from "./context.ts";
import { explainMonth, type MonthExplanation, usualSpending } from "./explain.ts";
import { type PeriodTotals, totalsOf } from "./flows.ts";
import { buildInsights, type Insight } from "./insights/index.ts";
import { cancelledMerchants, type MonthForecast, type MonthPace, monthForecast, monthPace } from "./forecast.ts";
import { type DateRange, previousRange, rangeMonths, toDayRange } from "./period.ts";
import { isCompleteMonth } from "./usual.ts";

// the pace and forecast code lives in forecast.ts; these keep the names the package index has always exported
export { type MonthForecast, type MonthPace, monthForecast, monthPace, type ExpectedCharge } from "./forecast.ts";

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
  /** The usual level of each month's spending (`usualCents` over the complete months before it); null under three. */
  usual: (number | null)[];
  /** Why each month differs from its usual level (`explainMonth`); null where there is no usual level. */
  explanations: (MonthExplanation | null)[];
  /** The same 12 months one year earlier, per series category (incl. "other_rest"); zeros without data. */
  lastYear: { expenses: number[]; series: Record<string, number[]> };
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
  /**
   * The totals of the complete months of a running range. The running month has its bills but often not its salary
   * yet, so the savings rate is told from these. null when the range does not reach today or holds no complete month.
   */
  settled: PeriodTotals | null;
  /** The split of income the overview shows: the period's complete months, or the latest complete month while it has none. */
  bridge: Bridge;
  fixedMonthlyCents: number;
  trend: MonthlyTrend;
  categories: CategoryTotal[];
  /** Everyday merchants: subscriptions, bills (rent, insurance), payments to people and cash are left out, the categories carry them. */
  merchants: MerchantStat[];
  pace: MonthPace;
  /** null when the selected period does not include today. */
  forecast: MonthForecast | null;
  /** The next 30 days: pay days, bills and the balance line. null when the selected period does not include today. */
  ahead: AheadData | null;
  /** Cost traps and mistakes; the overview shows them before insights. */
  alerts: Alert[];
  /** The first warning from the data quality report, so a user who never opens Reports still sees it. */
  dataNotice: QualitySignal | null;
  /** How many signals the data quality report holds (warnings and notes), for the line at the top of the overview. */
  dataSignals: number;
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
  const complete = months.map((m) => isCompleteMonth(ctx, m));
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
    usual: months.map((m) => usualSpending(ctx, m)),
    explanations: months.map((m) => explainMonth(ctx, m)),
    lastYear: { expenses: lastYearExpenses, series: lastYearSeries },
  };
}

/** The totals of the complete months the range covers from their first day; null without one. */
function settledTotals(ctx: AnalysisContext, range: DateRange, current: readonly AnalysisTx[]): PeriodTotals | null {
  // a range from the 15th holds half of that month, as fullMonths says
  const covered = (m: string) => `${m}-01` >= range.from && isCompleteMonth(ctx, m);
  const months = new Set(monthRange(monthOf(range.from), monthOf(range.to)).filter(covered).map(monthIndex));
  return months.size ? totalsOf(current.filter((t) => months.has(t.month)).map((t) => t.flows)) : null;
}

/**
 * Everything the overview page shows. The trend always covers the 12 months
 * ending at `to`, so it stays readable when a single month is selected.
 * `balances` and `inputs` are what the cached context does not hold: the
 * account balances and the user's marks and expected bills, read per request.
 */
export function buildDashboard(ctx: AnalysisContext, range: DateRange, balances: readonly BalanceInput[] = [], inputs: UserInputs = NO_INPUTS): DashboardData {
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
  const trend = monthlyTrend(ctx, monthRange(addMonths(toMonth, -11), toMonth));
  const alerts = buildAlerts(ctx, range, inputs);
  // one report for the notice and the count, so the two cannot disagree
  const quality = dataQualityReport(ctx, range, balances);
  const settled = running ? settledTotals(ctx, range, current) : null;

  return {
    range: { from: range.from, to: range.to, previousFrom, previousTo },
    comparable,
    running,
    dataFrom: ctx.dataFrom,
    totals,
    previousTotals,
    settled,
    bridge: buildBridge(ctx, range, running, totals, settled),
    // the fixed costs as they were at the end of the period; a subscription the household marked as cancelled has left them
    fixedMonthlyCents: fixedMonthlyCents(recurringAt(ctx, range.to), cancelledMerchants(inputs)),
    trend,
    categories,
    merchants: merchantStats(current.filter((t) => !ctx.fixedIds.has(t.id) && !NOT_MERCHANTS.has(t.category)), range).slice(0, 20),
    pace: monthPace(ctx, toMonth, ctx.today < range.to ? ctx.today : range.to),
    forecast: range.from <= ctx.today && ctx.today <= range.to ? monthForecast(ctx, inputs) : null,
    ahead: running ? cashAhead(ctx, balances, inputs) : null,
    alerts,
    dataNotice: quality.signals.find((x) => x.tone === "warning") ?? null,
    dataSignals: quality.signals.length,
    insights: buildInsights({ ctx, range, current, previous, categories, totals, comparable, running, alerts, inputs }),
    colorOrder: [...ctx.colorOrder],
  };
}
