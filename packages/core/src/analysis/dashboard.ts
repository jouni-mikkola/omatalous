import { DEFAULT_LANGUAGE, type Language } from "../locale.ts";
import { addDays, addMonths, monthEnd, monthIndex, monthOf, monthRange } from "../dates.ts";
import { cancelledSubjects } from "../commitments.ts";
import { flagLoanPayment } from "../loan-payment.ts";
import { buildHoldings, type Holdings } from "../holdings.ts";
import { type LoanProposal, loanProposals } from "../loan-detect.ts";
import { type BalanceInput, type IsoDate, NO_INPUTS, type UserInputs } from "../types.ts";
import { type DebtSplit, debtSplit } from "./debt-split.ts";
import { type CategoryTotal, categoryTotals, type TopCategories, topCategories } from "./category-totals.ts";
import { dataQualityReport, type QualitySignal } from "./data-quality.ts";
import { type AheadData, aheadBasis } from "./ahead.ts";
import { type Alert, buildAlerts } from "./alerts.ts";
import { type Bridge, buildBridge } from "./bridge.ts";
import { type AnalysisContext, type AnalysisTx, spendRows, spendTotals } from "./context.ts";
import { accountsCoverage, comparableWith } from "./coverage.ts";
import { fixedSeriesAt } from "./fixed-share.ts";
import { type MatchedPrevious, matchPrevious } from "./matched-fixed.ts";
import { type PeriodTotals, totalsOf } from "./flows.ts";
import { type MonthPace, monthPace } from "./forecast.ts";
import { type NytAnswer, nytAnswer } from "./nyt.ts";
import { buildHome, type Home } from "../home.ts";
import { buildOverview, type Overview } from "../overview.ts";
import { type SpendingGoal, spendingGoal } from "./spending-goal.ts";
import { type DateRange, previousRange, toDayRange } from "./period.ts";
import { buildQuestions, type Questions, withoutRowIds } from "./questions.ts";
import { type ThemesReport, themesReport } from "./themes-report.ts";
import { isCompleteMonth } from "./usual.ts";

export type { CategoryTotal } from "./category-totals.ts";

/** A category of the month with what this month spent on it on the accounts both periods have, the sum its change is set against. */
type DashboardCategory = CategoryTotal & { comparedCents: number };

// the pace code lives in forecast.ts; these keep the names the package index has always exported


export interface DashboardData {
  range: { from: IsoDate; to: IsoDate; previousFrom: IsoDate };
  /**
   * False when the history does not reach back over the previous period on enough of the accounts (those left out may
   * carry at most a tenth of the period's spending): deltas and swings are hidden. Otherwise `previousTotals` and the
   * categories' `previousCents` are the sums of the accounts both periods have. In the running month the previous month is
   * read on a matched basis (`matchPrevious`): each monthly fixed series counts as many payments as this month has, and
   * `pace.previous.toToday` reads the same basis. `totals` never changes.
   */
  comparable: boolean;
  /** An account with rows in only one of the two periods is left out of the comparison (shown or hidden): the page says so. */
  leftOutAccounts: boolean;
  /** The range reaches today (from <= today <= to). The previous period is then cut to the same days. */
  running: boolean;
  totals: PeriodTotals;
  /** `totals.debtCents` in interest, repayments and what no evidence splits (ADR 0028): their sum is `totals.debtCents`. The cash figures do not change. */
  split: DebtSplit;
  previousTotals: PeriodTotals;
  /**
   * The whole calendar month before the month the range ends in (today's month when the range runs past today), every
   * day of it: "Tulos viime kuussa". `previousTotals` of a running month is cut to today's day and tells only part of
   * it. Summed as `totals` is (`spendTotals`). null when that month has no rows.
   */
  previousMonthTotals: { month: string; totals: PeriodTotals } | null;
  /** The split of income the overview shows: the period's complete months, or the latest complete month while it has none. */
  bridge: Bridge;
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
  /** Nyt: the sum left before the payday, the days left, the usual everyday spending of a day and the pace band (`nytAnswer`). null when `ahead` is. */
  nyt: NytAnswer | null;
  /** Nyt: the largest categories of the period as bars, each against the same days of the period before (`topCategories`). */
  top: TopCategories;
  /** What the first page says in its five blocks; the page only draws it. */
  home: Home;
  /** Cost traps and mistakes. */
  alerts: Alert[];
  /** The first warning from the data quality report but the card bills, which `home.reliability` says over the twelve complete months, so a user who never opens Reports still sees it. */
  dataNotice: QualitySignal | null;
  /** What the household has and owes today: the accounts, the cards with their limit and the loans. The same answer as `BalanceReport.holdings`. */
  holdings: Holdings;
  /** The tiles' figures no other field gives: the month's income against the usual, and the month's change of `holdings.netCents`. */
  overview: Overview;
  /** How much of the last 365 days' money is classified, and the payees and loan payments that would mend it most. */
  questions: Questions;
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

/**
 * The month before read on the matched basis (`matchPrevious`) when `range` is the running month to date, else as it
 * is: its same-day rows less the dropped payments plus the added ones from the rest of that month. Other running
 * ranges (a year so far, a span of months) count payments a series is ahead by as real differences, so they stay as they are.
 * So does a month whose month before is shorter than today's day of the month (31.10. against September): that month is
 * read whole and its figure is labelled as the whole month, which a dropped payment would make smaller.
 */
function matchedPrevious(ctx: AnalysisContext, range: DateRange, inputs: UserInputs, rows: AnalysisTx[], sameDay: AnalysisTx[], previousTo: IsoDate): { matched: MatchedPrevious | null; previousRows: AnalysisTx[] } {
  const month = monthOf(ctx.today);
  const shorter = Number(previousTo.slice(8, 10)) < Number(ctx.today.slice(8, 10));
  if (range.from !== `${month}-01` || range.to < ctx.today || monthOf(range.to) !== month || shorter) return { matched: null, previousRows: sameDay };
  const later = spendRows(ctx, toDayRange({ from: addDays(previousTo, 1), to: monthEnd(monthOf(previousTo)) }));
  const matched = matchPrevious(fixedSeriesAt(ctx, ctx.today), cancelledSubjects(inputs, ctx.today), rows, sameDay, later);
  return { matched, previousRows: [...sameDay.filter((t) => !matched.dropped.has(t.id)), ...later.filter((t) => matched.added.has(t.id))] };
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
 * account balances and the user's marks and expected bills, read per request. `proposals` are the member's own and feed
 * the questions; `scopeProposals` are those of the view asked for (a joint loan's whole payment in the household's view)
 * and feed the total of unsaved loans.
 */
export function buildDashboard(ctx: AnalysisContext, range: DateRange, accountBalances: readonly BalanceInput[] = [], inputs: UserInputs = NO_INPUTS, proposals: readonly LoanProposal[] = loanProposals(ctx, inputs), lang: Language = DEFAULT_LANGUAGE, scopeProposals: readonly LoanProposal[] = proposals): DashboardData {
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
  const rows = spendRows(ctx, toDayRange(range));
  const previousRows = spendRows(ctx, toDayRange(span));
  const totals = spendTotals(ctx, toDayRange(range));
  // a monthly fixed cost one month booked by now and the other has not is a matter of timing: the month before is read with
  // as many payments of it as this month has, in the two same-day lines alike. This month's own totals never change.
  const { matched, previousRows: previousMatched } = matchedPrevious(ctx, range, inputs, rows, previousRows, previousTo);
  const matchedBefore = onShared(previousMatched);
  const previousTotals = totalsOf(matchedBefore.map((t) => t.flows));
  const comparedNow = new Map<string, number>();
  for (const t of onShared(rows)) if (t.spend) comparedNow.set(t.category, (comparedNow.get(t.category) ?? 0) + t.spend);
  const categories = categoryTotals(rows, matchedBefore).map((c) => ({ ...c, comparedCents: comparedNow.get(c.category) ?? 0 }));
  const alerts = buildAlerts(ctx, range, inputs, lang);
  const quality = dataQualityReport(ctx, range, balances);
  const settled = running ? settledTotals(ctx, range) : null;
  const basis = running ? aheadBasis(ctx, balances, inputs) : null;
  const pace = monthPace(ctx, monthOf(running ? ctx.today : range.to), ctx.today < range.to ? ctx.today : range.to, matched);

  return {
    range: { from: range.from, to: range.to, previousFrom },
    comparable,
    leftOutAccounts,
    running,
    totals,
    split: debtSplit(ctx, range, inputs),
    previousTotals,
    previousMonthTotals: previousMonthOf(ctx, monthOf(running ? ctx.today : range.to)),
    bridge: buildBridge(ctx, range, running, totals, settled),
    categories,
    themes: themesReport(ctx),
    pace,
    goal: inputs.spendingGoalCents ? spendingGoal(pace, inputs.spendingGoalCents) : null,
    ahead: basis?.ahead ?? null,
    nyt: basis && nytAnswer(ctx, basis),
    top: topCategories(categories, comparable, lang),
    alerts,
    dataNotice: quality.signals.find((x) => x.tone === "warning" && x.id !== "card_bills") ?? null,
    home: buildHome(ctx, { basis, pace, balances, inputs }),
    holdings: buildHoldings(ctx, balances, inputs, scopeProposals),
    overview: buildOverview(ctx, lang),
    questions: withoutRowIds(buildQuestions(ctx, range, inputs, proposals)),
  };
}
