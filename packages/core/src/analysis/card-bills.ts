/**
 * Card bills that count as spending, by month: the rows the `card_bills` signal of the data quality report adds up. A
 * card connected later, or a card that is not connected, leaves its bill as one payment from the account, with the
 * purchases behind it in no category. The months view and the food report name this sum so a list of categories is
 * not read as the whole.
 */
import { dateIn, fromMonthIndex, monthEnd } from "../dates.ts";
import { type AnalysisContext, inDays } from "./context.ts";
import { isCardBill } from "./data-quality.ts";
import { toDayRange } from "./period.ts";

/** The cents of card bills in each of `months` (month indexes), in the order of `months`; 0 for a month without one. */
export function cardBillsByMonth(ctx: AnalysisContext, months: readonly number[]): number[] {
  if (!months.length) return [];
  const range = toDayRange({ from: dateIn(fromMonthIndex(Math.min(...months)), 1), to: monthEnd(fromMonthIndex(Math.max(...months))) });
  const by = new Map<number, number>(months.map((m) => [m, 0]));
  for (const t of inDays(ctx, range)) if (isCardBill(t) && by.has(t.month)) by.set(t.month, by.get(t.month)! + t.spend);
  return months.map((m) => by.get(m)!);
}
