// Decision: which of the two Menot figures of Raportit to plan with, and what each is made of
import { type AnalysisContext } from "../analysis/context.ts";
import { spendOf, spendSelect, sumOf } from "../analysis/counted.ts";
import { type DateRange, toDayRange } from "../analysis/period.ts";
import { monthEnd } from "../dates.ts";

/** What of the spending months report (`spendingMonthsReport`, which the registry passes in) the parts are made of. */
interface SpendingMonthsInput {
  months: string[];
  complete: boolean[];
  totals: (number | null)[];
  fromSavings: (number | null)[];
  fromSavingsCents: number;
  typicalFlowCents: number | null;
  typicalMonths: number;
  largeFlowCompleteCents: number;
}

/** One month's spending and the days Tapahtumat lists for it (the running month to today). */
interface FigureMonth {
  month: string;
  cents: number;
  from: string;
  to: string;
}

/** What "Menot" of Tulot ja menot is made of: the complete months' spending, month by month. */
interface CashflowSpendParts {
  /** The figure: the complete months' spending of the flows (`completeTotals.spendCents` of `cashflowMonths`). */
  cents: number;
  /** The complete months, oldest first; their `cents` add up to `cents`. */
  months: FigureMonth[];
  /**
   * How the "tavallinen kuukausi" next to it is made: `months` less the large purchases they hold, over their number,
   * rounded to whole cents. Null under the months a level needs.
   */
  usual: { cents: number; months: number; largePurchasesCents: number } | null;
}

/** What "Kaikki menot" of Menot kategorioittain is made of, and what it holds beyond the Menot of Tulot ja menot. */
interface CategorySpendParts {
  /** The figure: the spending of the range (`totalCents` of `categories`). */
  cents: number;
  /** The Menot of the complete months: the figure of `cashflowSpend`. */
  completeMonthsCents: number;
  /** The months of the range that have not ended, or that the accounts do not whole cover, as Tulot ja menot leaves them out. */
  partialMonths: FigureMonth[];
  /** Debt paid from a savings account: spending here, Säästöön on the first page. */
  fromSavingsCents: number;
  /** What no month above holds (rows of months the data does not reach, or before the first month shown); the rest of the figure, so the parts add up. */
  otherCents: number;
  /** How many months the range has, and how many of them are complete. */
  monthsInRange: number;
  completeMonths: number;
}

/** The parts of the two Menot figures of Raportit and of the usual month, so a page can open a figure and bridge from one to the other. */
interface FigurePartsReport {
  cashflowSpend: CashflowSpendParts | null;
  categorySpend: CategorySpendParts;
}

/**
 * The figures of Raportit that carry a panel (`FigurePanel`): one definition each, the web adds up nothing. The
 * categories' figure is the one `categoryReport` prints (`spendSelect`), the months' the one Tulot ja menot prints
 * (`spendingMonthsReport` less the debt paid from savings).
 */
export function figurePartsReport(ctx: AnalysisContext, range: DateRange, spending: SpendingMonthsInput): FigurePartsReport {
  const monthAt = (i: number): FigureMonth | null => {
    const total = spending.totals[i];
    if (total === null || total === undefined) return null;
    const month = spending.months[i]!;
    const end = monthEnd(month);
    return { month, cents: total - (spending.fromSavings[i] ?? 0), from: `${month}-01`, to: end < ctx.today ? end : ctx.today };
  };
  const all = spending.months.map((_, i) => ({ part: monthAt(i), complete: spending.complete[i]! }));
  const months = all.flatMap((m) => (m.complete && m.part ? [m.part] : []));
  const partialMonths = all.flatMap((m) => (!m.complete && m.part ? [m.part] : []));
  const completeCents = months.reduce((s, m) => s + m.cents, 0);
  const cents = sumOf(spendSelect(ctx, toDayRange(range)).counted, spendOf);
  const fromSavingsCents = spending.fromSavingsCents;
  const partialCents = partialMonths.reduce((s, m) => s + m.cents, 0);
  const usualCents = spending.typicalFlowCents;
  return {
    cashflowSpend:
      months.length === 0
        ? null
        : { cents: completeCents, months, usual: usualCents === null ? null : { cents: usualCents, months: spending.typicalMonths, largePurchasesCents: spending.largeFlowCompleteCents } },
    categorySpend: { cents, completeMonthsCents: completeCents, partialMonths, fromSavingsCents, otherCents: cents - completeCents - partialCents - fromSavingsCents, monthsInRange: spending.months.length, completeMonths: months.length },
  };
}
