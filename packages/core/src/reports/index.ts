/**
 * Report registry. A report is a pure function (context, range) → data.
 * To add one: write `reports/<name>.ts`, register it here, give it a
 * section in apps/web/src/pages/Reports.tsx and an invariant test in
 * packages/core/test/reports.test.ts. The server and its types pick it up.
 */
import type { AnalysisContext } from "../analysis/context.ts";
import type { DateRange } from "../analysis/period.ts";
import { type BalanceInput, balanceReport } from "./balances.ts";
import { cashflowReport } from "./cashflow.ts";
import { categoryReport } from "./categories.ts";
import { dataQualityReport } from "./data-quality.ts";
import { fixedVariableReport } from "./fixed-variable.ts";
import { highlightsReport } from "./highlights.ts";
import { pivotReport } from "./pivot.ts";
import { priceChangesReport } from "./price-changes.ts";
import { summaryReport } from "./summary.ts";
import { yearOverYearReport } from "./year-over-year.ts";

export interface ReportInput {
  ctx: AnalysisContext;
  range: DateRange;
  balances: readonly BalanceInput[];
}

export const REPORTS = {
  summary: ({ ctx, range }: ReportInput) => summaryReport(ctx, range),
  cashflow: ({ ctx, range }: ReportInput) => cashflowReport(ctx, range),
  categories: ({ ctx, range }: ReportInput) => categoryReport(ctx, range),
  pivot: ({ ctx, range }: ReportInput) => pivotReport(ctx, range),
  fixedVariable: ({ ctx, range }: ReportInput) => fixedVariableReport(ctx, range),
  priceChanges: ({ ctx, range }: ReportInput) => priceChangesReport(ctx, range),
  highlights: ({ ctx, range }: ReportInput) => highlightsReport(ctx, range),
  dataQuality: ({ ctx, range }: ReportInput) => dataQualityReport(ctx, range),
  yearOverYear: ({ ctx, range }: ReportInput) => yearOverYearReport(ctx, range),
  balances: ({ ctx, range, balances }: ReportInput) => balanceReport(ctx, range, balances),
} as const;

export type ReportId = keyof typeof REPORTS;
export type ReportsData = { [K in ReportId]: ReturnType<(typeof REPORTS)[K]> };

export function buildReports(input: ReportInput): ReportsData {
  return Object.fromEntries(Object.entries(REPORTS).map(([id, report]) => [id, report(input)])) as ReportsData;
}

export type { BalanceInput, BalanceReport, BalanceSeries } from "./balances.ts";
export type { CashflowReport, CashflowRow } from "./cashflow.ts";
export type { CategoryReport, CategoryStat, GroupStat } from "./categories.ts";
export type { DataQualityReport, QualitySignal } from "./data-quality.ts";
export type { FixedVariableReport, FixedVariableRow } from "./fixed-variable.ts";
export type { HighlightsReport, LargePurchase, NewMerchant } from "./highlights.ts";
export type { PivotReport, PivotRow } from "./pivot.ts";
export type { PriceChangeItem, PriceChangesReport } from "./price-changes.ts";
export type { SummaryCategory, SummaryChange, SummaryReport } from "./summary.ts";
export type { YearOverYearReport } from "./year-over-year.ts";
