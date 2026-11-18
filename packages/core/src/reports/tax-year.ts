// Decision: which rows of one calendar year the household checks against the pre-filled tax return, and whether a refund or a residual tax is on the accounts
import type { AnalysisContext } from "../analysis/context.ts";
import { spendSelect } from "../analysis/counted.ts";
import { debtRowParts, savedLoanPaidBy } from "../analysis/debt-split.ts";
import { monthOf } from "../dates.ts";
import { type DateRange, toDayRange } from "../analysis/period.ts";
import type { IncomeGroup, IncomeType } from "../analysis/income.ts";
import { paysHouseholdCreditWork } from "../household-credit.ts";
import { fold } from "../merchant.ts";
import { isBuildingWorkText, isCleaningWorkText, isOtherTaxText, isResidualTaxText } from "../wording.ts";
import type { AnalysisTx } from "../analysis/context.ts";
import type { IsoDate, LoanKind, UserInputs } from "../types.ts";

/** One bank row the sheet lists, so the household can find it: the amount as the spending or income figure counts it (a refund inside spending is negative). */
export interface TaxRow {
  id: string;
  date: IsoDate;
  name: string;
  cents: number;
}

interface TaxIncomeRow {
  type: IncomeType;
  label: string;
  group: IncomeGroup;
  earned: boolean;
  totalCents: number;
}

/**
 * The categories of a loan's payment that a return may ask about, interest and principal together, since the bank row
 * does not split them. A return may ask about a home loan and a student loan; consumer credit asks nothing of a return
 * and is left out. Their interest is no deduction (vero.fi): the sheet lists the rows and decides nothing.
 */
const LOAN_PAYMENT_CATEGORIES = ["mortgage", "student_loan"] as const;

/** The kinds of saved loan whose interest the sheet lists: home and student loans. Consumer credit, a car loan and a card are not. */
const HOME_AND_STUDENT_KINDS: readonly LoanKind[] = ["mortgage", "student"];

interface TaxLoanPayment {
  category: (typeof LOAN_PAYMENT_CATEGORIES)[number];
  cents: number;
  count: number;
}

export interface TaxYearReport {
  year: number;
  /** The days the figures cover: the whole year, or up to today while it runs. */
  range: DateRange;
  /** The year has not ended: every figure is the year so far. */
  partial: boolean;
  /** Income by source: the types of the income report over the same days, so the sums are that report's own. */
  income: { totalCents: number; types: TaxIncomeRow[] };
  /** Veronpalautukset: the refund type of `income`, with its rows. */
  refunds: { cents: number; rows: TaxRow[] };
  /** Rows of the tax office that name residual tax. */
  residual: { cents: number; rows: TaxRow[] };
  /**
   * The interest of home and student loans, and its sum: the interest rows that pay a saved home or student loan
   * (`HOME_AND_STUDENT_KINDS`), and the interest part of each home or student loan payment the debt split splits
   * (`debtRowParts`), the fee left out. The sum is null while any of it is not known: an interest row that reaches no
   * saved loan, or a payment the split leaves whole. A payment that reaches a saved loan whose interest the bank booked
   * as a row of its own in the same month holds no interest. A row of a saved loan of another kind is known not to count
   * and leaves the sum as it is.
   */
  interest: { cents: number | null; rows: TaxRow[] };
  /** What the loans were paid, interest and principal together, by loan category. */
  loanPayments: TaxLoanPayment[];
  /**
   * Payments for work the household credit may cover: rows of the home category whose text names such work, and rows of
   * any category whose payee's trade-register industry is a class the credit covers (`paysHouseholdCreditWork`). The
   * rows are what the bank booked, in whole: the work share is on the invoice, so no deduction is computed.
   */
  household: { cents: number; rows: TaxRow[] };
}

const rowOf = (t: AnalysisTx, cents: number): TaxRow => ({ id: t.id, date: t.bookingDate, name: t.merchant, cents });
const sum = (rows: readonly TaxRow[]): number => rows.reduce((s, r) => s + r.cents, 0);
const textOf = (t: AnalysisTx): string => fold(`${t.merchant} ${t.counterparty ?? ""} ${t.description ?? ""}`);

/** The days the sheet covers: the range's year from January 1 to its last day, or to today in the running year. */
export function taxYearDays(ctx: Pick<AnalysisContext, "today">, range: DateRange): DateRange {
  const year = Number((range.to < ctx.today ? range.to : ctx.today).slice(0, 4));
  const last = `${year}-12-31`;
  return { from: `${year}-01-01`, to: ctx.today < last ? ctx.today : last };
}

/** What the sheet reads of the income report of those days, which the registry builds (a report imports no report). */
interface TaxIncomeInput {
  totalCents: number;
  types: readonly {
    type: IncomeType;
    label: string;
    group: IncomeGroup;
    earned: boolean;
    totalCents: number;
    payers: readonly { payer: string; rows: readonly { id: string; date: IsoDate; amountCents: number }[] }[];
  }[];
}

/**
 * One calendar year (the year of the range's last day) gathered from the rows for checking the tax return. Nothing is
 * counted again: income is the income report's types over the year, and the spending rows are the ones every spending
 * figure counts (`spendSelect`, on the rows of `spendRows`), so a category's sum here is that category's sum on the dashboard.
 * The exception is interest: the interest rows that pay a saved home or student loan and the interest parts of home and student
 * loan payments. The household credit
 * and residual tax lines are rows whose category and words suggest them; the sheet says "may be related" and decides
 * nothing, and it never says what can be deducted.
 */
export function taxYearReport(ctx: AnalysisContext, range: DateRange, income: TaxIncomeInput, inputs: UserInputs): TaxYearReport {
  const days = taxYearDays(ctx, range);
  const year = Number(days.from.slice(0, 4));
  // A refund is no income of the year: its rows are their own part, and the income total leaves them out.
  const types = income.types.filter((t) => t.totalCents !== 0 && t.type !== "tax_refund").map((t): TaxIncomeRow => ({ type: t.type, label: t.label, group: t.group, earned: t.earned, totalCents: t.totalCents }));
  const { rows: dayRows, counted } = spendSelect(ctx, toDayRange(days));
  const pick = (category: string, also?: (t: AnalysisTx) => boolean): TaxRow[] => counted.filter((t) => t.category === category && (!also || also(t))).map((t) => rowOf(t, t.spend));
  const loanOf = savedLoanPaidBy(ctx, inputs);
  const interestRows: TaxRow[] = [];
  let interestKnown = true;
  // the saved loans and months whose interest the bank booked as rows of their own
  const bookedApart = new Set<string>();
  for (const t of counted.filter((x) => x.category === "interest")) {
    const loan = loanOf(t);
    if (loan === undefined) interestKnown = false;
    else {
      bookedApart.add(`${loan.id}:${monthOf(t.bookingDate)}`);
      if (HOME_AND_STUDENT_KINDS.includes(loan.kind)) interestRows.push(rowOf(t, t.spend));
    }
  }
  const parts = debtRowParts(ctx, dayRows, inputs);
  for (const t of counted.filter((x) => (LOAN_PAYMENT_CATEGORIES as readonly string[]).includes(x.category))) {
    const split = parts.get(t.id);
    if (split !== undefined) {
      if (split.interestCents !== 0) interestRows.push(rowOf(t, split.interestCents));
      continue;
    }
    const loan = loanOf(t);
    if (loan === undefined || !bookedApart.has(`${loan.id}:${monthOf(t.bookingDate)}`)) interestKnown = false;
  }
  interestRows.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const residualRows = pick("taxes", (t) => isResidualTaxText(textOf(t)) && !isOtherTaxText(textOf(t)));
  const householdRows = counted
    .filter((t) => (t.category === "home" && (isCleaningWorkText(textOf(t)) || isBuildingWorkText(textOf(t)))) || paysHouseholdCreditWork(t.merchant, ctx.industries?.get(t.merchant)))
    .map((t) => rowOf(t, t.spend));
  const refundRows = (income.types.find((t) => t.type === "tax_refund")?.payers ?? []).flatMap((p) => p.rows.map((r): TaxRow => ({ id: r.id, date: r.date, name: p.payer, cents: r.amountCents }))).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return {
    year,
    range: days,
    partial: days.to < `${year}-12-31`,
    income: { totalCents: types.reduce((a, t) => a + t.totalCents, 0), types },
    refunds: { cents: income.types.find((t) => t.type === "tax_refund")?.totalCents ?? 0, rows: refundRows },
    residual: { cents: sum(residualRows), rows: residualRows },
    interest: { cents: interestKnown ? sum(interestRows) : null, rows: interestRows },
    loanPayments: LOAN_PAYMENT_CATEGORIES.map((category) => {
      const rows = pick(category);
      return { category, cents: sum(rows), count: rows.length };
    }).filter((p) => p.count > 0),
    household: { cents: sum(householdRows), rows: householdRows },
  };
}
