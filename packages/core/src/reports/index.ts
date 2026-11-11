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
import { categoryReport } from "./categories.ts";
import { incomeReport } from "./income.ts";
import { loansReport } from "./loans.ts";
import { buildHousing } from "../housing.ts";
import { spendingChangeReport } from "./spending-change.ts";
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
  /** The language of the texts the reports write; the Finnish ones are the default. */
  lang: Language;
}

export const REPORTS = {
  categories: ({ ctx, range, lang }: ReportInput) => categoryReport(ctx, range, lang),
  yearOverYear: ({ ctx, range }: ReportInput) => yearOverYearReport(ctx, range),
  balances: ({ ctx, range, balances, inputs }: ReportInput) => balanceReport(ctx, range, balances, inputs),
  upcoming: ({ ctx, inputs }: ReportInput) => upcomingReport(ctx, inputs),
  income: ({ ctx, range, balances, lang }: ReportInput) => incomeReport(ctx, range, balances, lang),
  loans: ({ ctx, balances, inputs }: ReportInput) => loansReport(ctx, balances, inputs),
  housing: ({ ctx, balances, inputs }: ReportInput) => buildHousing(ctx, balances, inputs),
  taxYear: ({ ctx, range, balances, lang }: ReportInput) => taxYearReport(ctx, range, incomeReport(ctx, taxYearDays(ctx, range), balances, lang)),
  thisMonth: ({ ctx, inputs, lang }: ReportInput) => thisMonthReport(ctx, inputs, lang),
  // Kuukausi reads an earlier month from it (pages/reports/Month.tsx)
  spendingChange: ({ ctx, range, lang }: ReportInput) => spendingChangeReport(ctx, range, lang),
} as const;

export type ReportId = keyof typeof REPORTS;
export type ReportsData = { [K in ReportId]: ReturnType<(typeof REPORTS)[K]> };

export const isReportId = (id: string): id is ReportId => Object.hasOwn(REPORTS, id);

/**
 * `inputs` may be left out by a caller without marks or bills: every report gets it filled in. `only` builds just those
 * reports, for a page that shows a few sections (Yhteenveto reads one); the others are missing from the answer.
 */
export function buildReports(input: Omit<ReportInput, "inputs" | "lang"> & { inputs?: UserInputs; lang?: Language }, only?: readonly ReportId[]): ReportsData {
  const full: ReportInput = { ...input, balances: flagLoanPayment(input.ctx, input.balances), inputs: input.inputs ?? NO_INPUTS, lang: input.lang ?? "fi" };
  const ids = only?.length ? (Object.keys(REPORTS) as ReportId[]).filter((id) => only.includes(id)) : (Object.keys(REPORTS) as ReportId[]);
  return Object.fromEntries(ids.map((id) => [id, REPORTS[id](full)])) as ReportsData;
}

export type { BalanceInput, BalanceReport, BalanceSeries } from "./balances.ts";
export type { CashflowReport, CashflowRow } from "./cashflow.ts";
export { cashflowReport } from "./cashflow.ts";
export type { MoneyBridge } from "../analysis/money-bridge.ts";
export type { GroupStat } from "./categories.ts";
export { type FiledWithoutAsking, filedWithoutAsking } from "../analysis/filed.ts";
export type { IncomeMember, IncomeMonth, IncomePayDay, IncomePayerRow, IncomeStability } from "./income.ts";
export type { IncomeChange, IncomeChangeKind } from "../analysis/income-changes.ts";
export type { LoanRow, LoansReport, MaybeTwice } from "./loans.ts";
export type { PivotRow } from "./pivot.ts";
export { pivotReport } from "./pivot.ts";
export type { ChangeViewReport, SpendingChangeReport } from "./spending-change.ts";
export type { GapRow, ThisMonthReport } from "./this-month.ts";
export { spentRows } from "./this-month.ts";
export type { UpcomingBill, UpcomingReport } from "./upcoming.ts";
export type { TaxRow, TaxYearReport } from "./tax-year.ts";
export type { YearOverYearReport } from "./year-over-year.ts";
export { comparisonYearRange, comparisonYears, yearComparisonNote } from "./year-over-year.ts";

/** The questions of Raportit, in the order of the list. The id is in the address (`?q=menot`). */
export const QUESTIONS = ["kuukausi", "menot", "tulot", "velat", "saldot", "yhteiset"] as const;
export type QuestionId = (typeof QUESTIONS)[number];
