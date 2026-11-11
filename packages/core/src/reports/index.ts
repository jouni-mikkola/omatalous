import { flagLoanPayment } from "../loan-payment.ts";
/**
 * Report registry. A report is a pure function (context, range) → data.
 * To add one: write `reports/<name>.ts`, register it here, give it a
 * section file in apps/web/src/pages/reports/sections/ (named by a page of
 * apps/web/src/pages/reports/pages/) and an invariant test in packages/core/test/reports.test.ts. Both files start with a
 * `// Decision: <what the household decides with it>` comment (a repo rule
 * checks it). The server and its types pick it up.
 */
import type { AnalysisContext } from "../analysis/context.ts";
import type { DateRange } from "../analysis/period.ts";
import type { Language } from "../locale.ts";
import { NO_INPUTS, type UserInputs } from "../types.ts";
import { type BalanceInput, balanceReport } from "./balances.ts";
import { bufferReport } from "./buffer.ts";
import { cashflowReport } from "./cashflow.ts";
import { type ConclusionsReport, conclusionsReport, type ReportReads } from "./conclusion.ts";
import { categoryReport } from "./categories.ts";
import { dataQualityReport } from "../analysis/data-quality.ts";
import { foodReport } from "../analysis/food.ts";
import { driftReport } from "./drift.ts";
import { fixedCostsReport } from "./fixed-costs.ts";
import { fixedVariableReport } from "./fixed-variable.ts";
import { incomeReport } from "./income.ts";
import { loansReport } from "./loans.ts";
import { longForecastReport } from "./long-forecast.ts";
import { buildHousing } from "../housing.ts";
import { pivotReport } from "./pivot.ts";
import { spendingChangeReport } from "./spending-change.ts";
import { spendingTableReport } from "./spending-table.ts";
import { summaryReport } from "./summary.ts";
import { priceChangeReport } from "./price-change.ts";
import { thisMonthReport } from "./this-month.ts";
import { upcomingReport } from "./upcoming.ts";
import { taxYearDays, taxYearReport } from "./tax-year.ts";
import { yearOverYearReport } from "./year-over-year.ts";

export interface ReportInput {
  ctx: AnalysisContext;
  range: DateRange;
  balances: readonly BalanceInput[];
  /** Marks, expected bills and loans of the user, read per request and kept out of the cached context. */
  inputs: UserInputs;
  /** Another report of this answer, built once however many read it (`buildReports`): the conclusions read the reports their figures come from. */
  read: <K extends keyof ReportReads>(id: K) => ReportReads[K];
  /** The language of the texts the reports write; the Finnish ones are the default. */
  lang: Language;
}

export const REPORTS = {
  summary: ({ ctx, range, lang }: ReportInput) => summaryReport(ctx, range, lang),
  cashflow: ({ ctx, range, balances }: ReportInput) => cashflowReport(ctx, range, balances),
  categories: ({ ctx, range, lang }: ReportInput) => categoryReport(ctx, range, lang),
  pivot: ({ ctx, range, lang }: ReportInput) => pivotReport(ctx, range, lang),
  fixedVariable: ({ ctx, range }: ReportInput) => fixedVariableReport(ctx, range),
  fixedCosts: ({ ctx, range, inputs }: ReportInput) => fixedCostsReport(ctx, range, inputs),
  dataQuality: ({ ctx, range, balances, lang }: ReportInput) => dataQualityReport(ctx, range, balances, lang),
  yearOverYear: ({ ctx, range }: ReportInput) => yearOverYearReport(ctx, range),
  balances: ({ ctx, range, balances, inputs }: ReportInput) => balanceReport(ctx, range, balances, inputs),
  upcoming: ({ ctx, inputs }: ReportInput) => upcomingReport(ctx, inputs),
  drift: ({ ctx, range, lang }: ReportInput) => driftReport(ctx, range, lang),
  buffer: ({ ctx, balances, inputs, lang }: ReportInput) => bufferReport(ctx, balances, inputs, lang),
  spendingChange: ({ ctx, range, lang }: ReportInput) => spendingChangeReport(ctx, range, lang),
  income: ({ ctx, range, balances, lang }: ReportInput) => incomeReport(ctx, range, balances, lang),
  spendingTable: ({ ctx, range, lang }: ReportInput) => spendingTableReport(ctx, range, lang),
  loans: ({ ctx, balances, inputs }: ReportInput) => loansReport(ctx, balances, inputs),
  housing: ({ ctx, balances, inputs }: ReportInput) => buildHousing(ctx, balances, inputs),
  food: ({ ctx, lang }: ReportInput) => foodReport(ctx, lang),
  longForecast: ({ ctx, balances, inputs }: ReportInput) => longForecastReport(ctx, balances, inputs),
  taxYear: ({ ctx, range, balances, lang }: ReportInput) => taxYearReport(ctx, range, incomeReport(ctx, taxYearDays(ctx, range), balances, lang)),
  priceChange: ({ ctx, inputs }: ReportInput) => priceChangeReport(ctx, inputs),
  thisMonth: ({ ctx, inputs, lang }: ReportInput) => thisMonthReport(ctx, inputs, lang),
  conclusions: (input: ReportInput): ConclusionsReport => conclusionsReport(input),
} as const;

export type ReportId = keyof typeof REPORTS;
export type ReportsData = { [K in ReportId]: ReturnType<(typeof REPORTS)[K]> };

export const isReportId = (id: string): id is ReportId => Object.hasOwn(REPORTS, id);

/**
 * `inputs` may be left out by a caller without marks or bills: every report gets it filled in. `only` builds just those
 * reports, for a page that shows a few sections (Yhteenveto reads one); the others are missing from the answer.
 */
export function buildReports(input: Omit<ReportInput, "inputs" | "read" | "lang"> & { inputs?: UserInputs; lang?: Language }, only?: readonly ReportId[]): ReportsData {
  const built = new Map<ReportId, unknown>();
  const read = <K extends ReportId>(id: K): ReportsData[K] => {
    if (!built.has(id)) built.set(id, REPORTS[id](full));
    return built.get(id) as ReportsData[K];
  };
  const full: ReportInput = { ...input, balances: flagLoanPayment(input.ctx, input.balances), inputs: input.inputs ?? NO_INPUTS, lang: input.lang ?? "fi", read };
  const ids = only?.length ? (Object.keys(REPORTS) as ReportId[]).filter((id) => only.includes(id)) : (Object.keys(REPORTS) as ReportId[]);
  return Object.fromEntries(ids.map((id) => [id, read(id)])) as ReportsData;
}

export type { BalanceInput, BalanceReport, BalanceSeries } from "./balances.ts";
export type { BufferReport } from "./buffer.ts";
export type { CashflowReport, CashflowRow } from "./cashflow.ts";
export type { MoneyBridge } from "../analysis/money-bridge.ts";
export type { CategoryReport, GroupStat } from "./categories.ts";
export type { DataQualityReport, QualitySignal } from "../analysis/data-quality.ts";
export { type FiledWithoutAsking, filedWithoutAsking } from "../analysis/filed.ts";
export type { DriftItem, DriftReport } from "./drift.ts";
export type { FixedVariableReport, FixedVariableRow } from "./fixed-variable.ts";
export type { IncomeMember, IncomeMonth, IncomePayDay, IncomePayerRow, IncomeReport, IncomeStability, IncomeTypeRow } from "./income.ts";
export type { IncomeChange, IncomeChangeKind } from "../analysis/income-changes.ts";
export type { LoanRow, LoansReport, MaybeTwice } from "./loans.ts";
export type { ForecastMonth, ForecastRange } from "./long-forecast.ts";
export { FORECAST_MONTHS } from "./long-forecast.ts";
export type { PivotRow } from "./pivot.ts";
export type { SummaryCategory, SummaryChange, SummaryReport } from "./summary.ts";
export type { ChangeViewReport, SpendingChangeReport } from "./spending-change.ts";
export type { SpendingTableReport, SpendingTableRow, TableOneOff } from "./spending-table.ts";
export type { GapRow, ThisMonthReport } from "./this-month.ts";
export type { UpcomingBill, UpcomingReport } from "./upcoming.ts";
export type { PriceChangeMonth, PriceChangeService } from "./price-change.ts";
export type { TaxRow, TaxYearReport } from "./tax-year.ts";
export type { YearOverYearReport } from "./year-over-year.ts";
export type { BasisRow, CompareKind, Conclusion, ConclusionFigure, ConclusionsReport, FigureComparison, QuestionId } from "./conclusion.ts";
export { COMPARE_KINDS, QUESTIONS } from "./conclusion.ts";
export { yearComparisonNote } from "./year-over-year.ts";
