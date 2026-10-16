// Decision: where did the month's money go
import { monthEnd } from "../dates.ts";
import { categoryTotals, NAMED_CATEGORIES } from "./category-totals.ts";
import { type AnalysisContext, spendRows } from "./context.ts";
import { leftOf } from "./flows.ts";
import { type DateRange, toDayRange } from "./period.ts";

/** The payees a bar tells before the rest are one row. */
const NAMED_PAYEES = 8;

/**
 * One line of what a bar is made of, with the bar's own sign, so the parts add up to the bar to the cent. `payee:<name>`
 * (a category's payees, income's payers), `category:<id>` (what `other` folds), `saved` or `borrowed` (what
 * `transfers` holds), `rest` (the payees past the named ones; `count` of them).
 */
interface WaterfallPart {
  key: string;
  cents: number;
  count?: number;
}

/** One step of the waterfall: `income`, `category:<id>`, `other` or `transfers`, with the cents it adds to Yli jäi. */
interface WaterfallBar {
  key: string;
  cents: number;
  /** For `other` only: how many categories the bar holds, the n of "Muut (n)". */
  count?: number;
  /** What the bar is made of, largest first; they add up to `cents`. */
  parts: WaterfallPart[];
}

/** The rows' sums by payee, as parts with the sign of `sign`: the largest first, the ones past the eighth as `rest`; a payee that nets to nothing is left out. */
function payeeParts(sums: ReadonlyMap<string, number>, sign: 1 | -1): WaterfallPart[] {
  const all = [...sums].filter(([, cents]) => cents !== 0).map(([name, cents]) => ({ key: `payee:${name}`, cents: cents * sign }));
  all.sort((a, b) => (b.cents - a.cents) * sign || (a.key < b.key ? -1 : 1));
  const named = all.slice(0, NAMED_PAYEES);
  const rest = all.slice(NAMED_PAYEES);
  return rest.length ? [...named, { key: "rest", cents: rest.reduce((n, p) => n + p.cents, 0), count: rest.length }] : named;
}

const add = (map: Map<string, number>, key: string, cents: number) => map.set(key, (map.get(key) ?? 0) + cents);

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
  let saved = 0;
  let borrowed = 0;
  const payers = new Map<string, number>();
  const payees = new Map<string, Map<string, number>>();
  for (const t of rows) {
    const cents = leftOf(t.flows);
    left += cents;
    income += t.flows.income;
    // what moves Yli jäi and is neither income nor spending: savings set aside and credit drawn, as `saved` and `borrowed` below
    transfers += cents - t.flows.income + t.spend;
    saved += t.flows.saved;
    borrowed += t.flows.borrowed;
    if (t.flows.income) add(payers, t.merchant, t.flows.income);
    if (t.spend) add(payees.get(t.category) ?? payees.set(t.category, new Map()).get(t.category)!, t.merchant, t.spend);
  }
  const ranked = categoryTotals(rows);
  const rest = ranked.slice(NAMED_CATEGORIES);
  const other = rest.reduce((sum, c) => sum + c.cents, 0);
  const moved: WaterfallPart[] = [
    { key: "saved", cents: -saved },
    { key: "borrowed", cents: borrowed },
  ].filter((p) => p.cents !== 0);
  const bars: WaterfallBar[] = [
    { key: "income", cents: income, parts: payeeParts(payers, 1) },
    ...ranked.slice(0, NAMED_CATEGORIES).map((c) => ({ key: `category:${c.category}`, cents: -c.cents, parts: payeeParts(payees.get(c.category) ?? new Map(), -1) })),
    ...(other ? [{ key: "other", cents: -other, count: rest.length, parts: rest.map((c) => ({ key: `category:${c.category}`, cents: -c.cents })) }] : []),
    ...(transfers ? [{ key: "transfers", cents: transfers, parts: moved }] : []),
  ];
  return { month, bars, leftCents: left };
}
