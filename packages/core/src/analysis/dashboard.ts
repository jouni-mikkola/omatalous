import { addMonths, monthEnd, monthIndex, monthOf, monthRange } from "../dates.ts";
import { cancelledSubjects, fixedMonthlyCents } from "../commitments.ts";
import { flagLoanPayment } from "../loan-payment.ts";
import { buildHoldings, type Holdings } from "../holdings.ts";
import { buildHousing, type Housing } from "../housing.ts";
import { type LoanProposal, loanProposals } from "../loan-detect.ts";
import { type BalanceInput, type IsoDate, NO_INPUTS, type UserInputs } from "../types.ts";
import { type CategoryTotal, categoryTotals } from "./category-totals.ts";
import { type ConnectNotice, connectNotice, dataQualityReport, type QualitySignal } from "./data-quality.ts";
import { type AheadData, cashAhead } from "./ahead.ts";
import { type Alert, buildAlerts } from "./alerts.ts";
import { type Bridge, buildBridge } from "./bridge.ts";
import { type AnalysisContext, type AnalysisTx, inDays, recurringAt, spendRows, spendTotals } from "./context.ts";
import { accountsCoverage, comparableWith } from "./coverage.ts";
import { fixedSeriesAt } from "./fixed-share.ts";
import { type PeriodTotals, totalsOf } from "./flows.ts";
import { buildInsights, type Insight } from "./insights/index.ts";
import { type MonthPace, monthPace } from "./forecast.ts";
import { type SpendingGoal, spendingGoal } from "./spending-goal.ts";
import { type DateRange, previousRange, toDayRange } from "./period.ts";
import { buildQuestions, type Questions, withoutRowIds } from "./questions.ts";
import { monthWaterfall, type Waterfall, withUsual } from "./waterfall.ts";
import { type ThemesReport, themesReport } from "./themes-report.ts";
import { isCompleteMonth } from "./usual.ts";

export type { CategoryTotal } from "./category-totals.ts";

/** A category of the month with what this month spent on it on the accounts both periods have, the sum its change is set against. */
type DashboardCategory = CategoryTotal & { comparedCents: number };

// the pace code lives in forecast.ts; these keep the names the package index has always exported
export { type MonthPace, monthPace } from "./forecast.ts";

export interface DashboardData {
  range: { from: IsoDate; to: IsoDate; previousFrom: IsoDate };
  /**
   * False when the history does not reach back over the previous period on enough of the accounts (those left out may
   * carry at most a tenth of the period's spending): deltas and swings are hidden. Otherwise `previousTotals` and the
   * categories' `previousCents` are the sums of the accounts both periods have.
   */
  comparable: boolean;
  /** An account with rows in only one of the two periods is left out of the comparison (shown or hidden): the page says so. */
  leftOutAccounts: boolean;
  /** The range reaches today (from <= today <= to). The previous period is then cut to the same days. */
  running: boolean;
  totals: PeriodTotals;
  previousTotals: PeriodTotals;
  /**
   * The whole calendar month before the month the range ends in (today's month when the range runs past today), every
   * day of it: "Tulos viime kuussa". `previousTotals` of a running month is cut to today's day and tells only part of
   * it. Summed as `totals` is (`spendTotals`). null when that month has no rows.
   */
  previousMonthTotals: { month: string; totals: PeriodTotals } | null;
  /** The split of income the overview shows: the period's complete months, or the latest complete month while it has none. */
  bridge: Bridge;
  fixedMonthlyCents: number;
  categories: DashboardCategory[];
  /**
   * What goes where: the themes of the last twelve complete months before today, whatever the range. null under three
   * complete months that every paying account covers.
   */
  themes: ThemesReport | null;
  /**
   * What the month has cost so far against the month before on the same days. The running month when the range
   * reaches today (the period can be longer than the month), else the month the range ends in.
   */
  pace: MonthPace;
  /** The user's monthly spending goal against `pace`; null when none is set. */
  goal: SpendingGoal | null;
  /** The days to the next payday, or 30 days when `ahead.reason` says there is none to wait for: pay days, bills and the three figures. null when the selected period does not include today. */
  ahead: AheadData | null;
  /** Cost traps and mistakes; the overview shows them before insights. */
  alerts: Alert[];
  /** The first warning from the data quality report but the card bills, which `connectNotice` says, so a user who never opens Reports still sees it. */
  dataNotice: QualitySignal | null;
  /** How much of the last twelve complete months a card or account that is not connected hides, whatever the range. null when every card and account is connected. */
  connectNotice: ConnectNotice | null;
  insights: Insight[];
  /** What the household has and owes today: the accounts, the cards with their limit and the loans. The same answer as `BalanceReport.holdings`. */
  holdings: Holdings;
  /** What the home costs a month and the terms of its loan, today whatever the range. null when the view has no home loan, no charge of a home and nothing to ask. */
  housing: Housing | null;
  /** How much of the last 365 days' money is classified, and the payees and loan payments that would mend it most. */
  questions: Questions;
  /**
   * The month the range ends in (today's when the range runs past it), told as steps from income to Tulos, whatever
   * the range's length. null when the range starts after today or the month has no rows.
   */
  waterfall: Waterfall | null;
}

/** The month's waterfall with the usual of each bar, read to the same day as the month is. */
function usualWaterfall(ctx: AnalysisContext, range: DateRange): Waterfall | null {
  const end = range.to < ctx.today ? range.to : ctx.today;
  const wf = monthWaterfall(ctx, monthOf(end), range);
  return wf && withUsual(ctx, wf, Number(end.slice(8, 10)));
}

/** The totals of every day of the calendar month before `month`; null when it has no rows. */
function previousMonthOf(ctx: AnalysisContext, month: string): DashboardData["previousMonthTotals"] {
  const before = addMonths(month, -1);
  const days = toDayRange({ from: `${before}-01`, to: monthEnd(before) });
  return spendRows(ctx, days).length ? { month: before, totals: spendTotals(ctx, days) } : null;
}

/** The totals of the complete months the range covers from their first day; null without one. */
function settledTotals(ctx: AnalysisContext, range: DateRange): PeriodTotals | null {
  // a range from the 15th holds half of that month, as fullMonths says
  const covered = (m: string) => `${m}-01` >= range.from && isCompleteMonth(ctx, m);
  const months = new Set(monthRange(monthOf(range.from), monthOf(range.to)).filter(covered).map(monthIndex));
  return months.size ? totalsOf(spendRows(ctx, toDayRange(range)).filter((t) => months.has(t.month)).map((t) => t.flows)) : null;
}

/** How an account's bank balances stand against its rows, the tick beside its balance: they add up, they do not, or it cannot be told. */
export type ReconcileVerdict = "ok" | "diff" | "unknown";

/** One joint pool's running month: what each member paid above (positive) or under (negative) their share. */
export interface RunningPool {
  accountKey: string;
  month: string;
  lines: { owner: string; name: string; overCents: number }[];
}

/** What `GET /api/dashboard` sends: the dashboard with what the server adds (a verdict for each account and card, the joint pools' running month). */
export type DashboardAnswer = Omit<DashboardData, "holdings"> & {
  holdings: Omit<DashboardData["holdings"], "accounts" | "cards"> & {
    accounts: (DashboardData["holdings"]["accounts"][number] & { reconcile?: ReconcileVerdict })[];
    cards: (DashboardData["holdings"]["cards"][number] & { reconcile?: ReconcileVerdict })[];
  };
  settlement: RunningPool[];
};

/**
 * Everything the month page shows (Yhteenveto). Why a past month differed is the spending change report's usual view.
 * `balances` and `inputs` are what the cached context does not hold: the
 * account balances and the user's marks and expected bills, read per request.
 */
export function buildDashboard(ctx: AnalysisContext, range: DateRange, accountBalances: readonly BalanceInput[] = [], inputs: UserInputs = NO_INPUTS, proposals: readonly LoanProposal[] = loanProposals(ctx, inputs)): DashboardData {
  const balances = flagLoanPayment(ctx, accountBalances);
  // a running period is compared with the same days of the previous one, or the
  // salary on the 15th makes the first nine days look like a loss of income
  const running = range.from <= ctx.today && ctx.today <= range.to;
  const [previousFrom, previousTo] = previousRange(range.from, running ? ctx.today : range.to);
  const span = { from: previousFrom, to: previousTo };
  // the accounts both periods have the whole of: the earlier period is summed on those only, as the summary report does
  const compared = comparableWith(ctx, span, range);
  const shared = compared?.shared ?? null;
  const comparable = shared !== null;
  const leftOutAccounts = accountsCoverage(ctx).compare(span, range)?.leftOut ?? false;
  const onShared = (rows: AnalysisTx[]) => (shared ? rows.filter((t) => shared.has(t.accountId)) : rows);
  const current = inDays(ctx, toDayRange(range));
  const previous = inDays(ctx, toDayRange(span));
  const rows = spendRows(ctx, toDayRange(range));
  const previousRows = spendRows(ctx, toDayRange(span));
  const totals = spendTotals(ctx, toDayRange(range));
  const previousTotals = totalsOf(onShared(previousRows).map((t) => t.flows));
  const comparedNow = new Map<string, number>();
  for (const t of onShared(rows)) if (t.spend) comparedNow.set(t.category, (comparedNow.get(t.category) ?? 0) + t.spend);
  const categories = categoryTotals(rows, onShared(previousRows)).map((c) => ({ ...c, comparedCents: comparedNow.get(c.category) ?? 0 }));
  const alerts = buildAlerts(ctx, range, inputs);
  const quality = dataQualityReport(ctx, range, balances);
  const settled = running ? settledTotals(ctx, range) : null;
  const pace = monthPace(ctx, monthOf(running ? ctx.today : range.to), ctx.today < range.to ? ctx.today : range.to);

  return {
    range: { from: range.from, to: range.to, previousFrom },
    comparable,
    leftOutAccounts,
    running,
    totals,
    previousTotals,
    previousMonthTotals: previousMonthOf(ctx, monthOf(running ? ctx.today : range.to)),
    bridge: buildBridge(ctx, range, running, totals, settled),
    // the fixed costs as they were at the end of the period, a lender paid each month on no steady day among them; a
    // subscription the household marked as cancelled has left them
    fixedMonthlyCents: fixedMonthlyCents(fixedSeriesAt(ctx, range.to), cancelledSubjects(inputs, range.to < ctx.today ? range.to : ctx.today)),
    categories,
    themes: themesReport(ctx),
    pace,
    goal: inputs.spendingGoalCents ? spendingGoal(pace, inputs.spendingGoalCents) : null,
    ahead: running ? cashAhead(ctx, balances, inputs) : null,
    alerts,
    dataNotice: quality.signals.find((x) => x.tone === "warning" && x.id !== "card_bills") ?? null,
    connectNotice: connectNotice(ctx),
    insights: buildInsights({ ctx, range, current, previous, categories, totals, comparable, running, alerts, inputs }),
    holdings: buildHoldings(ctx, balances, inputs, proposals),
    housing: buildHousing(ctx, balances, inputs),
    questions: withoutRowIds(buildQuestions(ctx, range, inputs, proposals)),
    waterfall: range.from > ctx.today ? null : usualWaterfall(ctx, range),
  };
}
