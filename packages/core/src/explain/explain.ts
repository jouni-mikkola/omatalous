/**
 * `explain(figure, ctx, args)`: the rows a sum figure adds, each with the rules that placed it, and the check that they
 * add up to the figure. The rows are the select the reports call (`analysis/counted.ts`), and the figure is the
 * report's own number, as the page shows it; `diffCents` is that number less the sum of the lines, never hidden. Where
 * no report holds the figure (a figure of some accounts) the figure is the select's own sum. `ctx` is the view's
 * context already (own or household), so a row counts here as that view counts it. The reasons come from `args.why`,
 * the collector of the same view, filled by the run that built `ctx`.
 */
import { type AnalysisContext, type AnalysisTx } from "../analysis/context.ts";
import { earnedOf, earnedSelect, incomeCentsOf, incomeSelect, spendOf, spendSelect, sumOf } from "../analysis/counted.ts";
import { type DateRange, toDayRange } from "../analysis/period.ts";
import { earnedIncome } from "../analysis/usual.ts";
import { monthOf, monthRange } from "../dates.ts";
import { cashflowReport } from "../reports/cashflow.ts";
import { categoryReport } from "../reports/categories.ts";
import type { Explanation, FigureId, Line, Reason, WhyCollector } from "./types.ts";

interface ExplainArgs {
  /** Own or household: `ctx` is that view's, and so is `why`. */
  view: "own" | "household";
  range: DateRange;
  /** Where the page restricts the figure to accounts, their keys: a figure of one account is a figure of its own. */
  accountIds?: readonly string[];
  /** `spend.category`: the category. */
  category?: string;
  why?: WhyCollector;
}

interface Sum {
  rows: AnalysisTx[];
  counted: AnalysisTx[];
  cents: (t: AnalysisTx) => number;
  /** What an amount of the bank's is multiplied by to be in the sign `cents` has. */
  sign: 1 | -1;
  /** Spending lists the rows it leaves out because a transfer or a card bill is not spending, with 0 cents. */
  leftOut: boolean;
}

/** Reasons that say why a row adds nothing to spending. */
const NOT_SPENDING = new Set(["transfer.pair", "transfer.channel", "card.bill"]);

function sumOfFigure(figure: FigureId, ctx: AnalysisContext, args: ExplainArgs): Sum {
  const range = toDayRange(args.range);
  const keep = (t: AnalysisTx) => (!args.accountIds || args.accountIds.includes(t.accountId)) && (figure !== "spend.category" || t.category === args.category);
  const of = (s: { rows: AnalysisTx[]; counted: AnalysisTx[] }) => ({ rows: s.rows.filter(keep), counted: s.counted.filter(keep) });
  switch (figure) {
    case "spend.month":
      return { ...of(spendSelect(ctx, range)), cents: spendOf, sign: -1, leftOut: true };
    case "spend.category":
      if (!args.category) throw new Error("explain: spend.category needs a category");
      return { ...of(spendSelect(ctx, range)), cents: spendOf, sign: -1, leftOut: true };
    case "income.month":
      return { ...of(incomeSelect(ctx, range)), cents: incomeCentsOf, sign: 1, leftOut: false };
    case "income.earned":
      return { ...of(earnedSelect(ctx, range)), cents: earnedOf, sign: 1, leftOut: false };
    default:
      throw new Error(`explain: ${figure} is not a sum figure`);
  }
}

/** The number the report that owns the figure gives for the range. */
function reportFigure(figure: FigureId, ctx: AnalysisContext, args: ExplainArgs): number {
  switch (figure) {
    case "spend.month":
      return categoryReport(ctx, args.range).totalCents;
    case "spend.category":
      return categoryReport(ctx, args.range).groups.flatMap((g) => g.categories).find((c) => c.category === args.category)?.totalCents ?? 0;
    case "income.month":
      return cashflowReport(ctx, args.range).rows.reduce((s, r) => s + r.incomeCents, 0);
    default:
      return monthRange(monthOf(args.range.from), monthOf(args.range.to)).reduce((s, m) => s + earnedIncome(ctx, m), 0);
  }
}

const NO_REASONS: readonly Reason[] = [];

export function explain(figure: FigureId, ctx: AnalysisContext, args: ExplainArgs): Explanation {
  if (args.why && args.why.view !== args.view) throw new Error("explain: the collector is of another view");
  const s = sumOfFigure(figure, ctx, args);
  const figureCents = args.accountIds ? sumOf(s.counted, s.cents) : reportFigure(figure, ctx, args);
  const why = (id: string): readonly Reason[] => args.why?.of(id) ?? NO_REASONS;
  const lineOf = (t: AnalysisTx): Line => ({
    id: t.id,
    day: t.bookingDate,
    cents: s.cents(t),
    ...(t.wholeCents !== undefined && t.wholeCents !== t.amountCents ? { whole: s.sign * t.wholeCents } : {}),
    why: [...why(t.id)],
  });
  const lines = s.counted.map(lineOf);
  if (s.leftOut && args.why) {
    const shown = new Set(s.counted.map((t) => t.id));
    for (const t of s.rows) if (!shown.has(t.id) && why(t.id).some((r) => NOT_SPENDING.has(r.rule))) lines.push(lineOf(t));
  }
  lines.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.id < b.id ? -1 : 1));
  return { figure, kind: "sum", cents: figureCents, lines, check: { kind: "sum", diffCents: figureCents - sumOf(lines, (l) => l.cents) } };
}
