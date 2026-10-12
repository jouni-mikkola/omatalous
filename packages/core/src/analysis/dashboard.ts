import { getCategory } from "../categories.ts";
import { addMonths, monthIndex, monthOf, monthRange } from "../dates.ts";
import { cancelledSubjects, fixedMonthlyCents } from "../commitments.ts";
import { buildHoldings, type Holdings } from "../holdings.ts";
import { type BalanceInput, type IsoDate, NO_INPUTS, type UserInputs } from "../types.ts";
import { dataQualityReport, type QualitySignal, spendingBase } from "./data-quality.ts";
import { type AheadData, cashAhead } from "./ahead.ts";
import { type Alert, buildAlerts } from "./alerts.ts";
import { type Bridge, buildBridge } from "./bridge.ts";
import { type AnalysisContext, type AnalysisTx, historyCovers, inDays, recurringAt } from "./context.ts";
import { type PeriodTotals, totalsOf } from "./flows.ts";
import { buildInsights, type Insight } from "./insights/index.ts";
import { type MonthForecast, type MonthPace, monthForecast, monthPace } from "./forecast.ts";
import { type DateRange, previousRange, toDayRange } from "./period.ts";
import { isCompleteMonth } from "./usual.ts";

// the pace and forecast code lives in forecast.ts; these keep the names the package index has always exported
export { type MonthForecast, type MonthPace, monthForecast, monthPace } from "./forecast.ts";

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
  categories: CategoryTotal[];
  pace: MonthPace;
  /** null when the selected period does not include today. */
  forecast: MonthForecast | null;
  /** The days to the next payday, or 30 days when `ahead.reason` says there is none to wait for: pay days, bills and the balance line. null when the selected period does not include today. */
  ahead: AheadData | null;
  /** Cost traps and mistakes; the overview shows them before insights. */
  alerts: Alert[];
  /** The first warning from the data quality report, so a user who never opens Reports still sees it. */
  dataNotice: QualitySignal | null;
  /** How many signals the data quality report holds (warnings and notes), for the line at the top of the overview. */
  dataSignals: number;
  insights: Insight[];
  /** What the household has and owes today: the accounts, the cards with their limit and the loans. The same answer as `BalanceReport.holdings`. */
  holdings: Holdings;
  /** Category ids that own colour slots 1–7 (slot 8 is "Muut"). */
  colorOrder: string[];
}

/** The colour key of the categories that have no colour slot of their own ("Muut"). */
export const REST_CATEGORY = "other_rest";

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
  const all = spendingBase(current);
  return [...totals.entries()]
    .filter(([, e]) => e.cents > 0)
    .map(([category, e]) => {
      const c = getCategory(category);
      return { category, label: c.label, group: c.group, kind: c.kind, cents: e.cents, count: e.count, share: all ? e.cents / all : 0, previousCents: prev.get(category) ?? 0 };
    })
    .sort((a, b) => b.cents - a.cents);
}

/** The totals of the complete months the range covers from their first day; null without one. */
function settledTotals(ctx: AnalysisContext, range: DateRange, current: readonly AnalysisTx[]): PeriodTotals | null {
  // a range from the 15th holds half of that month, as fullMonths says
  const covered = (m: string) => `${m}-01` >= range.from && isCompleteMonth(ctx, m);
  const months = new Set(monthRange(monthOf(range.from), monthOf(range.to)).filter(covered).map(monthIndex));
  return months.size ? totalsOf(current.filter((t) => months.has(t.month)).map((t) => t.flows)) : null;
}

/**
 * Everything the month page shows (Kuukausi). Why a past month differed is the spending change report's usual view.
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
    fixedMonthlyCents: fixedMonthlyCents(recurringAt(ctx, range.to), cancelledSubjects(inputs)),
    categories,
    pace: monthPace(ctx, toMonth, ctx.today < range.to ? ctx.today : range.to),
    forecast: range.from <= ctx.today && ctx.today <= range.to ? monthForecast(ctx, inputs) : null,
    ahead: running ? cashAhead(ctx, balances, inputs) : null,
    alerts,
    dataNotice: quality.signals.find((x) => x.tone === "warning") ?? null,
    dataSignals: quality.signals.length,
    insights: buildInsights({ ctx, range, current, previous, categories, totals, comparable, running, alerts, inputs }),
    holdings: buildHoldings(ctx, balances, inputs),
    colorOrder: [...ctx.colorOrder],
  };
}
