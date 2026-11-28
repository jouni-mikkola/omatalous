/**
 * The figures of Yhteenveto that no other part of the dashboard gives: this month's income and its earned part,
 * the last twelve months of income and spending, and this month's categories against their usual month. Every other part reads a figure of `nyt`, `home`, `ahead` or `holdings` as it is.
 */
import { addMonths, monthEnd, monthIndex, monthOf } from "./dates.ts";
import { type AgainstUsual, againstUsual, earnedIncome, monthIncome } from "./analysis/usual.ts";
import { type AnalysisContext, inDays } from "./analysis/context.ts";
import { coverOf, totalsOf } from "./analysis/flows.ts";
import { type DateRange, toDayRange } from "./analysis/period.ts";
import { DEFAULT_LANGUAGE, type Language } from "./locale.ts";
import { knownMonths } from "./reports/shared.ts";
import { type SpendingMonthsReport, spendingMonthsReport } from "./reports/spending-months.ts";

/** How many months the chart of Yhteenveto draws, the running one included. */
const OVERVIEW_MONTHS = 12;
/** How many categories Yhteenveto names; the rest are one sum. */
const OVERVIEW_CATEGORIES = 6;

interface OverviewMonth {
  month: string;
  /** All income (`monthIncome`, Tulot): in the running month Yhteenveto's Tulot. Null in a month the data does not reach (`knownMonths`), as the other two sums are. */
  incomeCents: number | null;
  /**
   * Spending as the bridge counts it (`flowSpendOf`, the consumption and debt of the flows): in the running month Yhteenveto's
   * Menot. Income less this, less what went to savings, is Tulos. A debt paid from a savings account is not in it
   * (it is Säästöön), which Raportit's Menot kuukausittain counts as spending: `fromSavingsCents` is the difference.
   */
  spendCents: number | null;
  /** What the month's rows of Raportit's Menot kuukausittain hold beyond `spendCents`: debt paid from a savings account (`fromSavings` of `spendingMonthsReport`). */
  fromSavingsCents: number | null;
  /** Ended, and the accounts were in the data from its 1st (`isCompleteMonth`). The running month never is. */
  complete: boolean;
  /** `spendCents` against `usualSpendCents`, both on the base of the bars; null in a month that is not complete or within the euro of the level. */
  againstUsual: AgainstUsual | null;
}

interface OverviewCategory {
  category: string;
  label: string;
  /** This month's spending in the category so far. */
  cents: number;
  /** The category's usual month (`typicalCents` of Menot kuukausittain over the months of the chart); null without one. */
  usualCents: number | null;
}

/** What the complete months of the chart took above their income and what paid it (`coverOf`, ADR 0014), added up over those months. */
interface OverviewGap {
  /** What the spending and the money moved to savings took above the income; above zero. */
  gapCents: number;
  creditCents: number;
  savingsCents: number;
  accountsCents: number;
}

/** The complete months of `months` that have both sums, added up: the strip of Tulot ja menot says them once. */
interface OverviewCompleteTotals {
  /** How many months the sums cover. */
  months: number;
  incomeCents: number;
  /** `incomeCents` over `months`, in whole cents: the average the strip names beside the total, over the same months. */
  averageIncomeCents: number;
  spendCents: number;
  /** Erotus: `incomeCents` less `spendCents`. Money moved to savings is not taken off, so it is not Tulos. */
  netCents: number;
  /** `netCents` over `months`, in whole cents. */
  averageNetCents: number;
}

/** What Tulot ja menot says of a window of months: the bars, the usual month, the complete months' sums and their gap. Yhteenveto's overview holds the last twelve months of it, Raportit the period. */
interface CashflowMonths {
  /** The months of the window the history reaches (24 at most, as `spendingMonthsReport` has them), oldest first. */
  months: OverviewMonth[];
  /** The usual month's spending over the complete months of `months`, on the base of the bars (`typicalFlowCents` of Menot kuukausittain, without large purchases); null under three of them. */
  usualSpendCents: number | null;
  /** How many complete months `usualSpendCents` is the mean of, which the chart's key names. */
  usualMonths: number;
  /** The complete months' income and spending added up and their difference; null without a complete month that has both sums. */
  completeTotals: OverviewCompleteTotals | null;
  /** The gap the complete months of `months` left between their income and what they took; absent when they took no more than the income or none is complete. */
  gap?: OverviewGap;
}

export interface Overview extends CashflowMonths {
  /**
   * The running month's income so far (`monthIncome`, the month's Tulot of the income report) and the earned part of it
   * (`earnedIncome`, Ansiotulot). Tulot shows the first; the second is its sub-line when it differs. There is no usual
   * of the first: Tavalliset tulot is the mean of the second, so it stays on the income report.
   */
  income: { cents: number; earnedCents: number };
  /**
   * This month's largest `OVERVIEW_CATEGORIES` categories with spending above zero, largest first, and the rest as one
   * sum, as the categories of Raportit count them. `totalCents` is the running month's `spendCents`, Menot of Yhteenveto.
   * The categories also hold the debt paid from a savings account, which Menot leaves out (`fromSavingsCents`):
   * `rows` and `otherCents` add up to `totalCents` and `fromSavingsCents` together.
   */
  categories: { rows: OverviewCategory[]; otherCents: number; otherCount: number; totalCents: number; fromSavingsCents: number; usualMonths: number };
}

function completeTotalsOf(months: readonly OverviewMonth[]): OverviewCompleteTotals | null {
  const whole = months.flatMap((m) => (m.complete && m.incomeCents !== null && m.spendCents !== null ? [{ incomeCents: m.incomeCents, spendCents: m.spendCents }] : []));
  if (whole.length === 0) return null;
  const incomeCents = whole.reduce((sum, m) => sum + m.incomeCents, 0);
  const spendCents = whole.reduce((sum, m) => sum + m.spendCents, 0);
  return {
    months: whole.length,
    incomeCents,
    averageIncomeCents: Math.round(incomeCents / whole.length),
    spendCents,
    netCents: incomeCents - spendCents,
    averageNetCents: Math.round((incomeCents - spendCents) / whole.length),
  };
}

/** The complete months of `spending` and the rows of exactly those months: the window the tiles of Tulot ja menot and the picture of sources and uses share. */
function completeMonthRows(ctx: AnalysisContext, spending: SpendingMonthsReport) {
  const months = spending.months.filter((_, i) => spending.complete[i]);
  const indexes = new Set(months.map(monthIndex));
  const rows = months.length === 0 ? [] : inDays(ctx, toDayRange({ from: `${months[0]}-01`, to: monthEnd(months.at(-1)!) })).filter((x) => indexes.has(x.month));
  return { months, rows };
}

/** `completeMonthRows` of the months of `range`. */
export function completeMonthRowsOf(ctx: AnalysisContext, range: DateRange, lang: Language = DEFAULT_LANGUAGE) {
  return completeMonthRows(ctx, spendingMonthsReport(ctx, range, lang));
}

/** The bars and sums of Tulot ja menot over the months `spending` covers: one definition for Yhteenveto's twelve months and Raportit's period. */
function cashflowOf(ctx: AnalysisContext, spending: SpendingMonthsReport): CashflowMonths {
  // the months' Menot are the bridge's spending, so a month's bars and Tulos add up; the report's sum is that and the debt paid from savings
  const spent = spending.totals.map((cents, i) => (cents === null ? null : cents - (spending.fromSavings[i] ?? 0)));
  const known = knownMonths(ctx, spending.months);
  const cover = coverOf(totalsOf(completeMonthRows(ctx, spending).rows.map((x) => x.flows)));
  const months: OverviewMonth[] = spending.months.map((m, i) => ({ month: m, incomeCents: known[i] ? monthIncome(ctx, m) : null, spendCents: spent[i] ?? null, fromSavingsCents: spending.fromSavings[i] ?? null, complete: spending.complete[i]!, againstUsual: spending.complete[i] ? againstUsual(spent[i] ?? null, spending.typicalFlowCents) : null }));
  return {
    months,
    usualSpendCents: spending.typicalFlowCents,
    usualMonths: spending.typicalMonths,
    completeTotals: completeTotalsOf(months),
    gap: cover.gapCents > 0 ? { gapCents: cover.gapCents, creditCents: cover.creditCents, savingsCents: cover.savingsCents, accountsCents: cover.accountsCents } : undefined,
  };
}

/** Tulot ja menot of Raportit for the period: `cashflowOf` over the months of `range`. */
export function cashflowMonthsReport(ctx: AnalysisContext, range: DateRange, lang: Language = DEFAULT_LANGUAGE): CashflowMonths {
  return cashflowOf(ctx, spendingMonthsReport(ctx, range, lang));
}

export function buildOverview(ctx: AnalysisContext, lang: Language = DEFAULT_LANGUAGE): Overview {
  const month = monthOf(ctx.today);
  // one report, so a month's bar, the usual line and the categories are the sums Raportit shows for the same months
  const spending = spendingMonthsReport(ctx, { from: `${addMonths(month, 1 - OVERVIEW_MONTHS)}-01`, to: ctx.today }, lang);
  const at = spending.months.length - 1;
  const spent = spending.totals.map((cents, i) => (cents === null ? null : cents - (spending.fromSavings[i] ?? 0)));
  const totalCents = spent[at] ?? 0;
  const top = spending.categories
    .filter((c) => (c.values[at] ?? 0) > 0)
    .sort((a, b) => b.values[at]! - a.values[at]! || a.category.localeCompare(b.category))
    .slice(0, OVERVIEW_CATEGORIES)
    .map((c): OverviewCategory => ({ category: c.category, label: c.label, cents: c.values[at]!, usualCents: c.typicalCents }));
  return {
    income: { cents: monthIncome(ctx, month), earnedCents: earnedIncome(ctx, month) },
    ...cashflowOf(ctx, spending),
    categories: {
      rows: top,
      otherCents: (spending.totals[at] ?? 0) - top.reduce((sum, c) => sum + c.cents, 0),
      otherCount: spending.categories.filter((c) => (c.values[at] ?? 0) !== 0).length - top.length,
      totalCents,
      fromSavingsCents: spending.fromSavings[at] ?? 0,
      // a category's usual reads its own months, fewer than the chart's when a card's rows are missing from some
      usualMonths: spending.categoryMonths,
    },
  };
}
