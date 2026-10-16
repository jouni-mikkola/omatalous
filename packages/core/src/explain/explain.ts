/**
 * `explain(figure, ctx, args)`: the rows a sum figure adds, each with the rules that placed it, and the check that they
 * add up to the figure. The rows are the select the reports call (`analysis/counted.ts`), and the figure is the
 * report's own number, as the page shows it; `diffCents` is that number less the sum of the lines, never hidden. Where
 * no report holds the figure (a figure of some accounts) the figure is the select's own sum. `ctx` is the view's
 * context already (own or household), so a row counts here as that view counts it. The reasons come from `args.why`,
 * the collector of the same view, filled by the run that built `ctx`.
 */
import type { AnalysisContext, AnalysisTx } from "../analysis/context.ts";
import { bookedLeftSelect, bookedSpendSelect, earnedOf, earnedSelect, incomeCentsOf, incomeSelect, leftCentsOf, spendOf, spendSelect, sumOf } from "../analysis/counted.ts";
import { toDayRange } from "../analysis/period.ts";
import { completeMonthsBefore, earnedIncome, spendingThrough, usualCents, usualSpending } from "../analysis/usual.ts";
import { monthEnd, monthOf, monthRange } from "../dates.ts";
import { cashflowReport } from "../reports/cashflow.ts";
import { categoryReport } from "../reports/categories.ts";
import { incomeReport, regularIncomeMonths, USUAL_INCOME_MONTHS, usualRegularCents } from "../reports/income.ts";
import { incomeRule, medianRule, medianTie, tooFewMonths } from "./catalogue.ts";
import { explainShare } from "./figures.ts";
import type { ExplainArgs, Explanation, FigureId, Line, Reason } from "./types.ts";

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

/** `booked`: a month's spending as the usual level reads it (`bookedSpendSelect`), which `usual.spend` lists month by month. */
function sumOfFigure(figure: FigureId, ctx: AnalysisContext, args: ExplainArgs, booked: boolean): Sum {
  const range = toDayRange(args.range);
  const keep = (t: AnalysisTx) => (!args.accountIds || args.accountIds.includes(t.accountId)) && (figure !== "spend.category" || t.category === args.category);
  const of = (s: { rows: AnalysisTx[]; counted: AnalysisTx[] }) => ({ rows: s.rows.filter(keep), counted: s.counted.filter(keep) });
  switch (figure) {
    case "spend.month":
      if (booked) return { ...of(bookedSpendSelect(ctx, range)), cents: spendOf, sign: -1, leftOut: false };
      return { ...of(spendSelect(ctx, range)), cents: spendOf, sign: -1, leftOut: true };
    case "spend.category":
      if (!args.category) throw new Error("explain: spend.category needs a category");
      return { ...of(spendSelect(ctx, range)), cents: spendOf, sign: -1, leftOut: true };
    case "income.month":
      return { ...of(incomeSelect(ctx, range)), cents: incomeCentsOf, sign: 1, leftOut: false };
    case "income.earned":
      return { ...of(earnedSelect(ctx, range)), cents: earnedOf, sign: 1, leftOut: false };
    case "yli_jai.month":
      return { ...of(bookedLeftSelect(ctx, range)), cents: leftCentsOf, sign: 1, leftOut: false };
    default:
      throw new Error(`explain: ${figure} is not a sum figure`);
  }
}

/** The number the report that owns the figure gives for the range; null when the report has no such figure (a category it does not list). */
function reportFigure(figure: FigureId, ctx: AnalysisContext, args: ExplainArgs, booked: boolean): number | null {
  switch (figure) {
    case "spend.month":
      if (booked) return spendingThrough(ctx, monthOf(args.range.from));
      return categoryReport(ctx, args.range).totalCents;
    case "spend.category":
      return categoryReport(ctx, args.range).groups.flatMap((g) => g.categories).find((c) => c.category === args.category)?.totalCents ?? null;
    case "income.month":
      return cashflowReport(ctx, args.range).rows.reduce((s, r) => s + r.incomeCents, 0);
    case "yli_jai.month":
      return cashflowReport(ctx, args.range).totals.leftCents;
    default:
      return monthRange(monthOf(args.range.from), monthOf(args.range.to)).reduce((s, m) => s + earnedIncome(ctx, m), 0);
  }
}

const NO_REASONS: readonly Reason[] = [];

function sumExplanation(figure: FigureId, ctx: AnalysisContext, args: ExplainArgs, booked: boolean): Explanation {
  const s = sumOfFigure(figure, ctx, args, booked);
  const figureCents = args.accountIds ? sumOf(s.counted, s.cents) : reportFigure(figure, ctx, args, booked);
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
  return { figure, kind: "sum", cents: figureCents, lines, check: { kind: "sum", diffCents: (figureCents ?? 0) - sumOf(lines, (l) => l.cents) } };
}

/** The one `diffCents` of a recomputation: 0 when both say the same, also when both say nothing. */
const recomputeDiff = (figure: number | null, again: number | null): number => (figure === again ? 0 : (figure ?? 0) - (again ?? 0) || 1);

/**
 * `usual.spend`: the median of the complete months before the range's month, each month a sum of its own, listed. The
 * check recomputes the median from the listed values; under `MIN_COMPARE_MONTHS` months the figure is null and the
 * method says how many there were.
 */
function usualSpendExplanation(ctx: AnalysisContext, args: ExplainArgs): Explanation {
  if (args.accountIds) throw new Error("explain: usual.spend is not a figure of some accounts");
  const month = monthOf(args.range.from);
  const values = completeMonthsBefore(ctx, month).map((label) => {
    const explain = sumExplanation("spend.month", ctx, { ...args, range: { from: `${label}-01`, to: monthEnd(label) }, accountIds: undefined }, true);
    return { label, cents: explain.cents!, explain };
  });
  const cents = usualSpending(ctx, month);
  const again = usualCents(values.map((v) => v.cents));
  const rule = again === null ? tooFewMonths(values.length) : medianRule();
  return { figure: "usual.spend", kind: "median", cents, lines: [], method: { kind: "median", values, rule, tie: medianTie(values.length) }, check: { kind: "recompute", diffCents: recomputeDiff(cents, again) } };
}

/**
 * `usual.income`: the page's "Tavalliset tulot kuukaudessa", the income report's own median (`stability.medianCents`),
 * over the months that report reads, each listed with the payments of its pay period. The check recomputes the median
 * from the listed months and compares it with the report's number; under twelve complete months the report has none.
 */
function usualIncomeExplanation(ctx: AnalysisContext, args: ExplainArgs): Explanation {
  if (args.accountIds) throw new Error("explain: usual.income is not a figure of some accounts");
  const cents = incomeReport(ctx, args.range).stability?.medianCents ?? null;
  const values = regularIncomeMonths(ctx, args.range).map((m) => {
    const lines = m.rows.map((r): Line => ({ id: r.id, day: r.day, cents: r.cents, ...(r.whole !== r.cents ? { whole: r.whole } : {}), why: [...(args.why?.of(r.id) ?? NO_REASONS)] }));
    lines.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.id < b.id ? -1 : 1));
    const explain: Explanation = { figure: "usual.income", kind: "sum", cents: m.cents, lines, check: { kind: "sum", diffCents: m.cents - sumOf(lines, (l) => l.cents) } };
    return { label: m.month, cents: m.cents, explain };
  });
  const again = usualRegularCents(values.map((v) => v.cents));
  const rule = again === null ? tooFewMonths(values.length, USUAL_INCOME_MONTHS) : incomeRule();
  return { figure: "usual.income", kind: "median", cents, lines: [], method: { kind: "median", values, rule, tie: medianTie(values.length) }, check: { kind: "recompute", diffCents: recomputeDiff(cents, again) } };
}

export function explain(figure: FigureId, ctx: AnalysisContext, args: ExplainArgs): Explanation {
  if (args.why && args.why.view !== args.view) throw new Error("explain: the collector is of another view");
  switch (figure) {
    case "usual.spend":
      return usualSpendExplanation(ctx, args);
    case "usual.income":
      return usualIncomeExplanation(ctx, args);
    case "share.part":
      return explainShare(ctx, args);
    default:
      return sumExplanation(figure, ctx, args, false);
  }
}
