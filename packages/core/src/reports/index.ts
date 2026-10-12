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
import { loansReport } from "./loans.ts";
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
  /** Marks, expected bills and loans of the user, read per request and kept out of the cached context. */
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
  balances: ({ ctx, range, balances, inputs }: ReportInput) => balanceReport(ctx, range, balances, inputs),
  upcoming: ({ ctx, inputs }: ReportInput) => upcomingReport(ctx, inputs),
  drift: ({ ctx, range }: ReportInput) => driftReport(ctx, range),
  buffer: ({ ctx, balances, inputs }: ReportInput) => bufferReport(ctx, balances, inputs),
  spendingChange: ({ ctx, range }: ReportInput) => spendingChangeReport(ctx, range),
  income: ({ ctx, range, balances }: ReportInput) => incomeReport(ctx, range, balances),
  insights: ({ ctx, range, inputs }: ReportInput) => insightsReport(ctx, range, inputs),
  loans: ({ ctx, balances, inputs }: ReportInput) => loansReport(ctx, balances, inputs),
} as const;

export type ReportId = keyof typeof REPORTS;
export type ReportsData = { [K in ReportId]: ReturnType<(typeof REPORTS)[K]> };

export const isReportId = (id: string): id is ReportId => Object.hasOwn(REPORTS, id);

/**
 * `inputs` may be left out by a caller without marks or bills: every report gets it filled in. `only` builds just those
 * reports, for a page that shows a few sections (Yhteenveto reads one); the others are missing from the answer.
 */
export function buildReports(input: Omit<ReportInput, "inputs"> & { inputs?: UserInputs }, only?: readonly ReportId[]): ReportsData {
  const full: ReportInput = { ...input, inputs: input.inputs ?? NO_INPUTS };
  const ids = only?.length ? (Object.keys(REPORTS) as ReportId[]).filter((id) => only.includes(id)) : (Object.keys(REPORTS) as ReportId[]);
  return Object.fromEntries(ids.map((id) => [id, REPORTS[id](full)])) as ReportsData;
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
export type { LoanRow, LoansReport, MaybeTwice } from "./loans.ts";
export { ACCOUNTS_LESS_DEBT, FIGURE_UNKNOWN, loansWithout, SAME_DEBT_TWICE } from "./loans.ts";
export type { PivotReport, PivotRow } from "./pivot.ts";
export type { PriceChangeItem, PriceChangesReport } from "./price-changes.ts";
export type { SummaryCategory, SummaryChange, SummaryReport } from "./summary.ts";
export type { ChangeBar, ChangeViewReport, SpendingChangeReport } from "./spending-change.ts";
export type { UpcomingBill, UpcomingReport } from "./upcoming.ts";
export type { YearOverYearReport } from "./year-over-year.ts";
