import type { IsoDate, UserInputs } from "../../types.ts";
import type { Alert } from "../alerts.ts";
import type { AnalysisContext, AnalysisTx } from "../context.ts";
import type { CategoryTotal } from "../dashboard.ts";
import type { PeriodTotals } from "../flows.ts";
import type { DateRange } from "../period.ts";

export type InsightTone = "good" | "warning" | "info";

/** The transaction list filter that shows the rows behind an insight. */
export interface InsightLink {
  merchant?: string;
  category?: string;
  from?: IsoDate;
  to?: IsoDate;
}

/**
 * An observation about the household's money: a title with the number, one sentence of basis, the rows behind it and
 * what it is worth over a year. The overview shows the top three by `yearlyCents`, the Havainnot report all of them.
 */
export interface Insight {
  /** Stable for the same finding, e.g. "price:<series id>". */
  id: string;
  tone: InsightTone;
  /** With the number, at most eight words. */
  title: string;
  /** One sentence: the months, the payee or the charges the number rests on. */
  detail: string;
  /** What the finding is worth over a year, positive cents. The ranking key. */
  yearlyCents: number;
  /** Set when the finding is a change of spending: 1 up, −1 down. The yearly figure then shows with its sign. */
  direction?: 1 | -1;
  /** Ids of the transactions behind the number. */
  rows?: string[];
  /** Where those rows are in the transaction list. */
  link?: InsightLink;
  /** The one merchant the insight is about; the overview links it to that merchant's transactions. */
  merchant?: string;
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
}

/** One file per insight: it returns the findings that passed its own gate and history rule. */
export type InsightSource = (a: InsightArgs) => Insight[];
