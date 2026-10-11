/**
 * Report registry. A report is a pure function (context, range) → data.
 * To add one: write `reports/<name>.ts`, register it here, give it a
 * section file in apps/web/src/pages/reports/sections/ and an invariant
 * test in packages/core/test/reports.test.ts. Both files start with a
 * `// Decision: <what the household decides with it>` comment (a repo rule
 * checks it). The server and its types pick it up.
 */
import type { AnalysisContext } from "../analysis/context.ts";
import type { DateRange } from "../analysis/period.ts";
import { NO_INPUTS, type UserInputs } from "../types.ts";
import { type BalanceInput, balanceReport } from "./balances.ts";
import { bufferReport } from "./buffer.ts";
import { cashflowReport } from "./cashflow.ts";
import { categoryReport } from "./categories.ts";
import { dataQualityReport } from "../analysis/data-quality.ts";
import { driftReport } from "./drift.ts";
import { fixedVariableReport } from "./fixed-variable.ts";
import { incomeReport } from "./income.ts";
import { insightsReport } from "./insights.ts";
import { pivotReport } from "./pivot.ts";
import { spendingChangeReport } from "./spending-change.ts";
import { priceChangesReport } from "./price-changes.ts";
import { summaryReport } from "./summary.ts";
import { upcomingReport } from "./upcoming.ts";
import { yearOverYearReport } from "./year-over-year.ts";

export interface ReportInput {
  ctx: AnalysisContext;
  range: DateRange;
  balances: readonly BalanceInput[];
  /** Marks and expected bills of the user, read per request and kept out of the cached context. */
  inputs: UserInputs;
}

export const REPORTS = {
  summary: ({ ctx, range }: ReportInput) => summaryReport(ctx, range),
  cashflow: ({ ctx, range }: ReportInput) => cashflowReport(ctx, range),
  categories: ({ ctx, range }: ReportInput) => categoryReport(ctx, range),
  pivot: ({ ctx, range }: ReportInput) => pivotReport(ctx, range),
  fixedVariable: ({ ctx, range }: ReportInput) => fixedVariableReport(ctx, range),
  priceChanges: ({ ctx, range }: ReportInput) => priceChangesReport(ctx, range),
  dataQuality: ({ ctx, range, balances }: ReportInput) => dataQualityReport(ctx, range, balances),
  yearOverYear: ({ ctx, range }: ReportInput) => yearOverYearReport(ctx, range),
  balances: ({ ctx, range, balances }: ReportInput) => balanceReport(ctx, range, balances),
  upcoming: ({ ctx, inputs }: ReportInput) => upcomingReport(ctx, inputs),
  drift: ({ ctx, range }: ReportInput) => driftReport(ctx, range),
  buffer: ({ ctx, balances, inputs }: ReportInput) => bufferReport(ctx, balances, inputs),
  spendingChange: ({ ctx, range }: ReportInput) => spendingChangeReport(ctx, range),
  income: ({ ctx, range, balances }: ReportInput) => incomeReport(ctx, range, balances),
  insights: ({ ctx, range, inputs }: ReportInput) => insightsReport(ctx, range, inputs),
} as const;

export type ReportId = keyof typeof REPORTS;
export type ReportsData = { [K in ReportId]: ReturnType<(typeof REPORTS)[K]> };

/** `inputs` may be left out by a caller without marks or bills: every report gets it filled in. */
export function buildReports(input: Omit<ReportInput, "inputs"> & { inputs?: UserInputs }): ReportsData {
  const full: ReportInput = { ...input, inputs: input.inputs ?? NO_INPUTS };
  return Object.fromEntries(Object.entries(REPORTS).map(([id, report]) => [id, report(full)])) as ReportsData;
}

export type { BalanceInput, BalanceReport, BalanceSeries } from "./balances.ts";
export type { BufferReport } from "./buffer.ts";
export type { CashflowReport, CashflowRow } from "./cashflow.ts";
export type { CategoryReport, CategoryStat, GroupStat } from "./categories.ts";
export type { DataQualityReport, QualitySignal } from "../analysis/data-quality.ts";
export type { DriftItem, DriftReport } from "./drift.ts";
export type { FixedVariableReport, FixedVariableRow } from "./fixed-variable.ts";
export type { IncomeMember, IncomeMonth, IncomePayDay, IncomePayerRow, IncomeReport, IncomeStability, IncomeTypeRow } from "./income.ts";
export type { IncomeChange, IncomeChangeKind } from "../analysis/income-changes.ts";
export type { PivotReport, PivotRow } from "./pivot.ts";
export type { PriceChangeItem, PriceChangesReport } from "./price-changes.ts";
export type { SummaryCategory, SummaryChange, SummaryReport } from "./summary.ts";
export type { ChangeBar, ChangeViewReport, SpendingChangeReport } from "./spending-change.ts";
export type { UpcomingBill, UpcomingReport } from "./upcoming.ts";
export type { YearOverYearReport } from "./year-over-year.ts";
