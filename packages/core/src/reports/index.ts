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
import { figurePartsReport } from "./figure-parts.ts";
import { fixedCostsReport } from "./fixed-costs.ts";
import { incomeReport } from "./income.ts";
import { loansReport } from "./loans.ts";
import { monthLeadReport } from "./month-lead.ts";
import { buildHousing } from "../housing.ts";
import { cashflowMonthsReport } from "../overview.ts";
import { spendingChangeReport } from "./spending-change.ts";
import { spendingMonthsReport } from "./spending-months.ts";
import { billCalendar } from "./bill-calendar.ts";
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
  upcoming: ({ ctx, inputs, balances }: ReportInput) => upcomingReport(ctx, inputs, balances),
  billCalendar: ({ ctx, inputs, balances }: ReportInput) => billCalendar(ctx, inputs, balances),
  income: ({ ctx, range, balances, lang }: ReportInput) => incomeReport(ctx, range, balances, lang),
  loans: ({ ctx, balances, inputs }: ReportInput) => loansReport(ctx, balances, inputs),
  housing: ({ ctx, balances, inputs }: ReportInput) => buildHousing(ctx, balances, inputs),
  taxYear: ({ ctx, range, balances, inputs, lang }: ReportInput) => taxYearReport(ctx, range, incomeReport(ctx, taxYearDays(ctx, range), balances, lang), inputs),
  // no page shows it: the findings tool and the figure tests of the server read its views
  spendingChange: ({ ctx, range, lang }: ReportInput) => spendingChangeReport(ctx, range, lang),
  spendingMonths: ({ ctx, range, lang }: ReportInput) => spendingMonthsReport(ctx, range, lang),
  fixedCosts: ({ ctx, inputs, lang }: ReportInput) => fixedCostsReport(ctx, inputs, lang),
  monthLead: ({ ctx }: ReportInput) => monthLeadReport(ctx),
  // Tulot ja menot: the bars, the usual month and the complete months' sums over the period, as Yhteenveto has them for twelve months
  cashflowMonths: ({ ctx, range, lang }: ReportInput) => cashflowMonthsReport(ctx, range, lang),
  // the parts of the two Menot figures and of the usual month: what their panels open
  figureParts: ({ ctx, range, lang }: ReportInput) => figurePartsReport(ctx, range, lang),
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

export type { BalanceInput, BalanceReport } from "./balances.ts";

export { cashflowReport } from "./cashflow.ts";


export { type FiledWithoutAsking } from "../analysis/filed.ts";


export { inCostOrder, type LoanRow, type LoansReport, type MaybeTwice } from "./loans.ts";

export { pivotReport } from "./pivot.ts";

export type { TaxRow } from "./tax-year.ts";

export { comparisonYearRange, comparisonYears, yearComparisonNote } from "./year-over-year.ts";

export { QUESTIONS, type QuestionId } from "../question-ids.ts";
