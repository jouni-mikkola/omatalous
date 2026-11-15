import type { Language } from "../../locale.ts";
import type { CalcLine, IsoDate, UserInputs } from "../../types.ts";
import type { Alert } from "../alerts.ts";
import type { AnalysisContext, AnalysisTx } from "../context.ts";
import type { CategoryTotal } from "../dashboard.ts";
import type { PeriodTotals } from "../flows.ts";
import type { DateRange } from "../period.ts";

/** The transaction list filter that shows the rows behind an insight. */
interface InsightLink {
  merchant?: string;
  category?: string;
  from?: IsoDate;
  to?: IsoDate;
}

/** A number or a day with its unit, so a sentence formats it in one place (`explain/insights.ts`). */
export type Quantity =
  | { unit: "cents"; value: number }
  | { unit: "percent"; value: number }
  | { unit: "count"; value: number }
  | { unit: "times"; value: number }
  | { unit: "date"; value: IsoDate };

/** The ways to write a `Quantity` in a source. */
export const q = {
  cents: (value: number): Quantity => ({ unit: "cents", value }),
  percent: (value: number): Quantity => ({ unit: "percent", value }),
  count: (value: number): Quantity => ({ unit: "count", value }),
  times: (value: number): Quantity => ({ unit: "times", value }),
  date: (value: IsoDate): Quantity => ({ unit: "date", value }),
} as const;

/** What an insight is set against. The words of each label are in `explain/insights.ts`. */
type ComparisonLabel =
  /** The price or the amount before the change. */
  | "before"
  | "yearAgo"
  | "yearAgoCost"
  | "yearAgoSubscriptions"
  | "yearAgoTicket"
  | "yearAgoVisits"
  /** The expected spending of a month (`analysis/expected.ts`). */
  | "expectedMonth"
  | "shareOfExpectedSpending"
  | "shareOfExpectedIncome"
  | "expectedIncome"
  /** A line the app draws itself (`DEBT_SHARE`). */
  | "limit"
  | "incomeChange"
  /** The monthly level before an income change; 0 = none before. */
  | "incomeBefore"
  | "paidInFull"
  | "weekBeforePay"
  | "otherDays"
  | "lastCharge"
  /** The last instalment of a residual tax whose last year is not in the data. */
  | "lastInstalment"
  | "usualMonthly";

export interface Comparison {
  label: ComparisonLabel;
  value: Quantity;
}

/** What the household can do next. The words of each label are in `explain/insights.ts`. */
type ActionLabel =
  | "seeRows" | "seeDraws"
  | "setAside"
  | "checkPrice"
  | "decideRenewal"
  | "decideSubscription"
  | "checkStop"
  | "useFreed"
  | "seeInstalments"
  | "seeGrowth"
  | "seeFixedCosts"
  | "seeLoans"
  | "seeIncome"
  | "seePayday"
  | "seeWeekday"
  | "seeCardInterest";

/** A page of the app, with what it needs to open at the right place. */
type ActionTarget = { page: "transactions"; filter: InsightLink } | { page: "bills" } | { page: "reports"; anchor: string };

export interface Action {
  label: ActionLabel;
  target: ActionTarget;
}

/**
 * What an insight is worth over a year, as a calc line. `cents` is from the household's side: negative = it pays or
 * earns that much less, positive = more. `value` is `cents` as the page shows it ("−360 €", "+3 000 €").
 */
export interface EffectLine extends CalcLine {
  cents: number;
}

/**
 * What an insight is about, as data. Each variant names the figures its sentence reads; `explain/insights.ts` makes the
 * Finnish sentence from it and nothing else does.
 */
export type InsightFact =
  | { type: "price-rise"; merchant: string; debt: boolean; fromCents: number; toCents: number; since: IsoDate }
  | { type: "price-rises"; merchants: string[]; since: IsoDate }
  | { type: "stopped"; merchant: string; lastDate: IsoDate; lastCents: number; monthlyCents: number; payments: number; paidCents: number; firstDate: IsoDate; freed: boolean }
  | { type: "new-subscription"; merchant: string; monthlyCents: number; firstDate: IsoDate; charges: number; trial: { cents: number; date: IsoDate } | null }
  | { type: "subscriptions-added"; merchants: string[]; now: number; monthlyCents: number }
  | { type: "renewal"; merchant: string; date: IsoDate; cents: number; cadence: "yearly" | "semiannual"; lastDate: IsoDate }
  | { type: "renewals"; items: { merchant: string; date: IsoDate }[]; cents: number; days: number; yearly: boolean }
  | { type: "instalments"; services: string[]; plans: number; monthlyCents: number; interestMonthlyCents: number }
  | { type: "season"; month: string; months: string[]; extraCents: number; years: number }
  | { type: "spending-growth"; purchasesPercent: number; first: string; last: string }
  | { type: "commitments-share"; percent: number; fixedCents: number; incomeCents: number }
  | { type: "debt-share"; percent: number; debtCents: number; incomeCents: number }
  | { type: "credit-drawn"; cents: number; draws: number; from: IsoDate; to: IsoDate }
  | { type: "card-interest"; cards: string[]; cents: number; months: number; carried: number }
  | { type: "groceries"; byPrice: boolean; percent: number; visitsPerMonth: number }
  | { type: "payday"; ratio: number; cycles: number; extraCents: number }
  | { type: "small-purchases"; monthlyCents: number; perMonth: number; top: string[]; limitCents: number; up: boolean }
  | { type: "weekday"; weekday: number; cents: number; weeks: number }
  /** `title` is the sentence of the income report (`analysis/income-changes.ts`), which the report shares. */
  | { type: "income"; change: string; title: string; monthlyCents: number };

/** The rows, the filter and the working behind an insight, so the household can check it. */
export interface InsightEvidence {
  /** Ids of the transactions behind the number. */
  rows: string[];
  /** Where those rows are in the transaction list. */
  link?: InsightLink;
  /** The one merchant the insight is about; the overview links it to that merchant's transactions. */
  merchant?: string;
  /** One line per number of the sentences, with the inputs of a derived one, and the effect line last. */
  calc: CalcLine[];
}

/**
 * An observation about the household's money in three parts, every one required: the fact, what it is set against and
 * what to do next. A `pattern` is something that recurs (a charge, a habit, a level) and outranks a `single`, which
 * rests on one row or a few and is shown only when it is large (`SINGLE_MIN_YEARLY_CENTS`) and among the largest rows
 * of its month (`SINGLE_TOP_ROWS`). The fields are data: the sentences are made in `explain/insights.ts`.
 */
export interface Insight {
  /** Stable for the same finding, e.g. "price:<series id>". */
  id: string;
  fact: InsightFact;
  comparison: Comparison;
  action: Action;
  /** What the finding is worth over a year; null when its cost has no yearly figure. The ranking key. */
  effectPerYear: EffectLine | null;
  kind: "pattern" | "single";
  evidence: InsightEvidence;
}

/** What the dashboard hands in. Fields after `totals` are optional so the report can call it with less. */
export interface InsightInput {
  ctx: AnalysisContext;
  range: DateRange;
  current: readonly AnalysisTx[];
  totals: PeriodTotals;
  previous?: readonly AnalysisTx[];
  categories?: readonly CategoryTotal[];
  comparable?: boolean;
  /** The period reaches today: insights about what is coming (renewals) are shown only then. */
  running?: boolean;
  /** Shown already as alerts: not repeated here. */
  alerts?: readonly Alert[];
  /** The user's marks: a dismissed insight stays hidden until its number moves 25 %. */
  inputs?: UserInputs;
  /** The language of the working lines and of the income findings' words; Finnish when absent. */
  lang?: Language;
}

/** What every insight source gets. */
export interface InsightArgs {
  ctx: AnalysisContext;
  range: DateRange;
  /** The day the insights are judged on: the end of the period, or today when the period runs on. */
  end: IsoDate;
  running: boolean;
  current: readonly AnalysisTx[];
  totals: PeriodTotals;
  inputs: UserInputs;
  alerts: readonly Alert[];
  /** The smallest finding worth a line, per month (`gateMonthly`). */
  gateMonthlyCents: number;
  lang: Language;
}

/** One file per insight: it returns the findings that passed its own gate and history rule. */
export type InsightSource = (a: InsightArgs) => Insight[];
