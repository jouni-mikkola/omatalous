// Decision: where did the month's money go
import { dateIn, monthEnd } from "../dates.ts";
import { categoryTotals, NAMED_CATEGORIES } from "./category-totals.ts";
import { type AnalysisContext, spendRows } from "./context.ts";
import { leftOf } from "./flows.ts";
import { type DateRange, toDayRange } from "./period.ts";
import { completeMonthsBefore, usualCents } from "./usual.ts";
import { type CategoryPart, categoryParts } from "./row-parts.ts";

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
  /**
   * The same bar in the usual month: the median of the complete months before, each on its days 1 to the day this month
   * is read to (`other`: the same categories). null under three complete months, and for `transfers`: savings and
   * credit drawn are a choice of the month, not a cost with a usual size. Set by `withUsual`.
   */
  usualCents?: number | null;
  /** `cents` less `usualCents`, null with no usual: below zero a spending bar took more than usual. */
  vsUsualCents?: number | null;
  /** Where the bar starts: the running total of the bars before it, 0 for the first. The web draws from it and adds nothing. */
  fromCents: number;
  /** Where the bar ends: `fromCents` plus `cents`; the last bar ends at `leftCents`. */
  toCents: number;
  /** A category's spending a level under it (`categoryParts`), of the sign of spending, adding up to `-cents`; only when a build's extension told some of its rows. */
  split?: CategoryPart[];
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
  /** The table's Tulot: the income bar. */
  incomeCents: number;
  /** The table's Menot, positive: the spending bars together. */
  spentCents: number;
  /** What went to savings and credit, negative when it left (the transfers bar, 0 without one). Income less Menot plus this is Yli jäi. */
  transfersCents: number;
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
  const steps: Omit<WaterfallBar, "fromCents" | "toCents">[] = [
    { key: "income", cents: income, parts: payeeParts(payers, 1) },
    ...ranked.slice(0, NAMED_CATEGORIES).map((c) => {
      const split = ctx.rowParts && categoryParts(rows.filter((t) => t.category === c.category), ctx.rowParts, c.category);
      return { key: `category:${c.category}`, cents: -c.cents, parts: payeeParts(payees.get(c.category) ?? new Map(), -1), ...(split ? { split } : {}) };
    }),
    ...(other ? [{ key: "other", cents: -other, count: rest.length, parts: rest.map((c) => ({ key: `category:${c.category}`, cents: -c.cents })) }] : []),
    ...(transfers ? [{ key: "transfers", cents: transfers, parts: moved }] : []),
  ];
  // the running total each bar starts and ends at: the bars add up to Yli jäi, so the last ends at `left`
  let at = 0;
  const bars: WaterfallBar[] = steps.map((b) => ({ ...b, fromCents: at, toCents: (at += b.cents) }));
  return { month, bars, leftCents: left, incomeCents: income, spentCents: ranked.reduce((sum, c) => sum + c.cents, 0), transfersCents: transfers };
}

/**
 * The waterfall with the usual of each bar (`WaterfallBar.usualCents`): the same steps in the complete months before
 * (`completeMonthsBefore`), each cut to the day this one runs to, so a running month is set against the same days.
 */
export function withUsual(ctx: AnalysisContext, wf: Waterfall, toDay: number): Waterfall {
  const months = completeMonthsBefore(ctx, wf.month);
  const steps = months.map((m) => {
    const cut = dateIn(m, toDay);
    const past = monthWaterfall(ctx, m, { from: `${m}-01`, to: cut });
    const by = new Map<string, number>();
    for (const b of past?.bars ?? []) {
      if (b.key === "other") for (const p of b.parts) by.set(p.key, p.cents);
      else by.set(b.key, b.cents);
    }
    return by;
  });
  const valueIn = (by: Map<string, number>, bar: WaterfallBar) => (bar.key === "other" ? bar.parts.reduce((n, p) => n + (by.get(p.key) ?? 0), 0) : (by.get(bar.key) ?? 0));
  return {
    ...wf,
    bars: wf.bars.map((b) => {
      const usual = b.key === "transfers" ? null : usualCents(steps.map((by) => valueIn(by, b)));
      return { ...b, usualCents: usual, vsUsualCents: usual === null ? null : b.cents - usual };
    }),
  };
}
