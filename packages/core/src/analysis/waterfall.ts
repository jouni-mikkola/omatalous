// Decision: where did the month's money go
import { monthEnd } from "../dates.ts";
import { type AnalysisContext, type AnalysisTx, inDays } from "./context.ts";
import { leftOf, totalsOf } from "./flows.ts";
import { incomeTypeOf } from "./income.ts";
import { toDayRange } from "./period.ts";

/** One step of the waterfall: `income`, `category:<id>`, `other`, `transfers` or `unknown`, with the cents it adds to Yli jäi. */
interface WaterfallBar {
  key: string;
  cents: number;
}

/** A month told as steps from income to Yli jäi. The bars add up to `leftCents` exactly. */
export interface Waterfall {
  /** The calendar month, `2026-09`. */
  month: string;
  /** Income (always), at most six spending categories by size, the rest of spending, transfers and unknown; the last three only when they are not zero. */
  bars: WaterfallBar[];
  /** Yli jäi of the month as the cash flow report has it (`totalsOf` the booked rows, each bill whole): the number Raportit's bridge shows. */
  leftCents: number;
}

const CATEGORY_BARS = 6;

/**
 * A row nobody has classified: money out left in Muut menot by the default, money in the default put in Muut tulot. A
 * category, a rule, a pairing or a payer's role set by the household gives the row another source and takes it out.
 */
const isUnknown = (t: AnalysisTx): boolean => t.categorySource === "default" && ((t.category === "other" && t.spend !== 0) || (t.flows.income !== 0 && incomeTypeOf(t) === "other_income"));

/**
 * The booked rows of a month as the cash flow report counts them (each bill whole), every row in exactly one bar by its
 * flow: income, spending by category, or a transfer (savings and credit drawn: money that is neither income nor spending);
 * a row nobody classified is in `unknown` whichever way it went. Null when the month has no rows.
 */
export function monthWaterfall(ctx: AnalysisContext, month: string): Waterfall | null {
  const range = { from: `${month}-01`, to: monthEnd(month) };
  const rows = inDays(ctx, toDayRange(range));
  if (!rows.length) return null;
  let income = 0;
  let transfers = 0;
  let unknown = 0;
  const spending = new Map<string, number>();
  for (const t of rows) {
    const cents = leftOf(t.flows);
    if (cents === 0) continue;
    if (isUnknown(t)) unknown += cents;
    else if (t.flows.income !== 0) income += cents;
    else if (t.spend !== 0) spending.set(t.category, (spending.get(t.category) ?? 0) + cents);
    else transfers += cents;
  }
  // the largest spending first (the most below zero), a tie by the category's id
  const ranked = [...spending].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1));
  const shown = ranked.slice(0, CATEGORY_BARS);
  const other = ranked.slice(CATEGORY_BARS).reduce((sum, [, cents]) => sum + cents, 0);
  const bars: WaterfallBar[] = [
    { key: "income", cents: income },
    ...shown.filter(([, cents]) => cents !== 0).map(([id, cents]) => ({ key: `category:${id}`, cents })),
    ...[["other", other], ["transfers", transfers], ["unknown", unknown]].flatMap(([key, cents]) => (cents ? [{ key: key as string, cents: cents as number }] : [])),
  ];
  return { month, bars, leftCents: totalsOf(rows.map((t) => t.flows)).leftCents };
}
