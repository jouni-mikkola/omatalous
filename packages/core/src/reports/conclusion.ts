// Decision: what to do about the question a page of Raportit asks, from one sentence with one figure
/**
 * The frame of the question pages of Raportit. Each page asks one question and answers with a `Conclusion`: one figure,
 * what it is set beside, why, and the one thing worth doing about it. A page's own file in `conclusions/` makes it
 * from the reports it reads (`ConclusionInput.read`), so a figure has the definition of its report (ADR 0004) and the
 * parts of `basis.rows` add up to it to the cent. The comparison with the expected level, the period before, a year ago
 * and the budget is made once (`conclusions/shared.ts`), and the page only picks one.
 */
import type { AnalysisContext } from "../analysis/context.ts";
import { type CoverageNotice } from "../analysis/notices.ts";
import { type Insight, insightInputOf, rankInsights } from "../analysis/insights/index.ts";
import type { DateRange } from "../analysis/period.ts";
import type { Language } from "../locale.ts";
import type { BalanceInput, UserInputs } from "../types.ts";
import type { BalanceReport } from "./balances.ts";
import type { BufferReport } from "./buffer.ts";
import type { CashflowReport } from "./cashflow.ts";
import type { CategoryReport } from "./categories.ts";
import { balancesConclusion } from "./conclusions/saldot.ts";
import { debtConclusion } from "./conclusions/velat.ts";
import { fixedConclusion } from "./conclusions/kiinteat.ts";
import { incomeConclusion } from "./conclusions/tulot.ts";
import { monthConclusion } from "./conclusions/kuukausi.ts";
import { sharedConclusion } from "./conclusions/yhteiset.ts";
import { spendingConclusion } from "./conclusions/menot.ts";
import type { LoansReport } from "./loans.ts";
import type { SpendingTableReport } from "./spending-table.ts";
import type { ThisMonthReport } from "./this-month.ts";

import type { CompareKind, QuestionId } from "./conclusions/kinds.ts";
export { COMPARE_KINDS, type CompareKind, QUESTIONS, type QuestionId } from "./conclusions/kinds.ts";

/** The figure a page answers with. Spending and debt are the amounts, positive; a balance and a result keep their sign. */
export interface ConclusionFigure {
  label: string;
  cents: number;
}

/** A figure set beside another: `cents` is the other one, `deltaCents` the figure less it on the same accounts, `text` the difference in words. */
export interface FigureComparison {
  kind: CompareKind;
  /** What it is set beside, as the page names it: "Odotettu", "Edellinen kuukausi". */
  name: string;
  cents: number;
  deltaCents: number;
  text: string;
}

/** One part of the figure. The parts of `basis.rows` add up to the figure to the cent. */
export interface BasisRow {
  label: string;
  cents: number;
}

export interface Conclusion {
  /** What the figure leaves out, each with its amount (`coverageNotices`); empty when it leaves nothing out. */
  notices: CoverageNotice[];
  /** The question the page asks, as its heading. */
  question: string;
  verdict: {
    figure: ConclusionFigure;
    /** The first comparison that has a figure, in the order of `COMPARE_KINDS`; null when none has. The page's switch picks another from `compare`. */
    comparison: FigureComparison | null;
  };
  /** One or two sentences that tell where the figure comes from. */
  explanation: string;
  /** The one action the page recommends, read from the insights of its subject; null when none passed its gate. */
  recommendation: Insight | null;
  /** The comparisons by kind; null where there is nothing to set beside, and `gaps` says why. */
  compare: Record<CompareKind, FigureComparison | null>;
  /** Why a comparison is missing, in words for the switch. */
  gaps: Partial<Record<CompareKind, string>>;
  /** How the figure is made: the method in a sentence, the parts that add up to it, and the accounts it reads. */
  basis: {
    method: string;
    rows: BasisRow[];
    accounts: { id: string; name: string }[];
  };
}

/** The conclusion of each question; null for a page with nothing to say (no joint account, no balance). */
export type ConclusionsReport = Record<QuestionId, Conclusion | null>;

/** The reports a conclusion reads, by id: each is built once per answer however many conclusions read it. */
export interface ReportReads {
  cashflow: CashflowReport;
  categories: CategoryReport;
  spendingTable: SpendingTableReport;
  balances: BalanceReport;
  loans: LoansReport;
  buffer: BufferReport;
  thisMonth: ThisMonthReport;
}

/** What a conclusion is made from: the inputs of every report and the way to read another report. */
export interface ConclusionInput {
  ctx: AnalysisContext;
  range: DateRange;
  balances: readonly BalanceInput[];
  inputs: UserInputs;
  /** The language of the texts the conclusions say. */
  lang: Language;
  /** Every insight of the period that passed its gate, largest yearly effect first (`rankInsights`), made once for all the pages. */
  insights: readonly Insight[];
  read: <K extends keyof ReportReads>(id: K) => ReportReads[K];
}

/** The conclusions of every page. */
export function conclusionsReport(base: Omit<ConclusionInput, "insights">): ConclusionsReport {
  const input: ConclusionInput = { ...base, insights: rankInsights(insightInputOf(base.ctx, base.range, base.inputs, base.lang)) };
  return {
    kuukausi: monthConclusion(input),
    menot: spendingConclusion(input),
    tulot: incomeConclusion(input),
    kiinteat: fixedConclusion(input),
    velat: debtConclusion(input),
    saldot: balancesConclusion(input),
    yhteiset: sharedConclusion(input),
  };
}
