// Decision: where did the month's money go
import { monthEnd } from "../dates.ts";
import { categoryTotals, NAMED_CATEGORIES } from "./category-totals.ts";
import { type AnalysisContext, spendRows } from "./context.ts";
import { leftOf } from "./flows.ts";
import { type DateRange, toDayRange } from "./period.ts";

/** One step of the waterfall: `income`, `category:<id>`, `other` or `transfers`, with the cents it adds to Yli jäi. */
interface WaterfallBar {
  key: string;
  cents: number;
  /** For `other` only: how many categories the bar holds, the n of "Muut (n)". */
  count?: number;
}

/** A month told as steps from income to Yli jäi. The bars add up to `leftCents` exactly. */
export interface Waterfall {
  /** The calendar month, `2026-09`. */
  month: string;
  /**
   * Income (always), the nine largest spending categories as the category table beside it lists them, the rest of the
   * spending, and what is neither income nor spending (savings, credit drawn); the last two only when they are not zero.
   * Income and the spending bars are the table's Tulot and Menot to the cent.
   */
  bars: WaterfallBar[];
  /** Yli jäi of the month as the table beside the waterfall has it (`spendTotals` of the same rows): the bars add up to it. Raportit's cash flow report counts a card bill whole and can differ by what a statement moves between months. */
  leftCents: number;
}

/**
 * The rows of a month, cut to `within` (the dashboard's range), as the month table and its categories count them (`spendRows`), every row in exactly one bar by
 * its flow: income, spending by category (a row nobody classified is in its category, Muut menot), or a transfer
 * (savings and credit drawn: money that is neither income nor spending). Null when the month has no rows.
 */
export function monthWaterfall(ctx: AnalysisContext, month: string, within: DateRange): Waterfall | null {
  const first = `${month}-01`;
  const last = monthEnd(month);
  const range = { from: first > within.from ? first : within.from, to: last < within.to ? last : within.to };
  const rows = spendRows(ctx, toDayRange(range));
  if (!rows.length) return null;
  let income = 0;
  let transfers = 0;
  let left = 0;
  for (const t of rows) {
    const cents = leftOf(t.flows);
    left += cents;
    income += t.flows.income;
    // what moves Yli jäi and is neither income nor spending
    transfers += cents - t.flows.income + t.spend;
  }
  const ranked = categoryTotals(rows);
  const rest = ranked.slice(NAMED_CATEGORIES);
  const other = rest.reduce((sum, c) => sum + c.cents, 0);
  const bars: WaterfallBar[] = [
    { key: "income", cents: income },
    ...ranked.slice(0, NAMED_CATEGORIES).map((c) => ({ key: `category:${c.category}`, cents: -c.cents })),
    ...(other ? [{ key: "other", cents: -other, count: rest.length }] : []),
    ...(transfers ? [{ key: "transfers", cents: transfers }] : []),
  ];
  return { month, bars, leftCents: left };
}
