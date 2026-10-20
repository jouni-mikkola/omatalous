/**
 * One-offs: the rows a usual level leaves out (ADR 0005). Every view that strikes a row from a level asks `oneOffs`
 * with a named policy, so the same sofa is a one-off on the overview, in the change report, in the alerts and in
 * Optimoi. See docs/MONEY_FLOWS.md.
 */
import { median } from "../stats.ts";
import { type AnalysisContext, type AnalysisTx, netSpend } from "./context.ts";

export interface OneOffPolicy {
  name: "level" | "pay" | "large";
  /** A row is a one-off over this many times its usual size; for `large`, over this share of the rest of its category. */
  multiple: number;
  /** The usual size needs this many values. */
  minValues: number;
}

/**
 * `level`: a purchase over three times its usual ticket and at least 50 €. The usual ticket is the median of its
 * merchant's purchases in the rows, or of its category's in the other months when the merchant has under three,
 * bills included; with neither, a purchase of 150 € or more stands alone. Subscriptions, bills, card bills, debt and transfers are never
 * one-offs.
 */
export const LEVEL: OneOffPolicy = { name: "level", multiple: 3, minValues: 3 };

/**
 * `pay`: a payment of one payer's pay, 1.4 times the median of the up to six before it and with the next one back
 * under 1.2 times. Pay is a sequence, so its own policy: a holiday bonus is one-off only when the pay after it is
 * ordinary again.
 */
export const PAY: OneOffPolicy = { name: "pay", multiple: 1.4, minValues: 3 };

/**
 * `large`: a purchase a household makes once, to show apart from the spending of the months. At least 500 € and over a
 * quarter of what the rest of its category took in the twelve months around it; a row of Auton osto is one whatever
 * its sum. The rows of a series (`fixed`: subscriptions, bills, habits) never are, and neither are debt, card bills
 * and transfers, which are no purchases. Its mirror for income is in large.ts, which gives both sets of a household.
 * `minValues` is 0: the row is set against a sum, not against a usual size.
 */
export const LARGE: OneOffPolicy = { name: "large", multiple: 0.25, minValues: 0 };

const MIN_ONE_OFF_CENTS = 5000;
const ALONE_CENTS = 15000;
const PAY_BACK = 1.2;
const PAY_WINDOW = 6;
const LARGE_MIN_CENTS = 50000;
const LARGE_MONTHS = 12;
/** Auton osto: a car is bought once, whatever else the category holds. */
const ALWAYS_LARGE = "vehicle_purchase";

const NONE: ReadonlySet<string> = new Set();

/** A payment for goods or services: what a usual ticket is read from, the bills of a series included. */
const isPurchase = (t: AnalysisTx) => t.kind === "expense" && !t.isTransfer && t.category !== "card_bill" && netSpend(t) > 0;

function medians(rows: readonly AnalysisTx[], key: (t: AnalysisTx) => string, min: number): Map<string, number> {
  const by = new Map<string, number[]>();
  for (const t of rows) {
    const list = by.get(key(t));
    if (list) list.push(netSpend(t));
    else by.set(key(t), [netSpend(t)]);
  }
  return new Map([...by].filter(([, xs]) => xs.length >= min).map(([k, xs]) => [k, median(xs)]));
}

function levelOneOffs(rows: readonly AnalysisTx[], p: OneOffPolicy, fixed: ReadonlySet<string>): Set<string> {
  const buys = rows.filter(isPurchase);
  const byMerchant = medians(buys, (t) => t.merchant, p.minValues);
  // a category's ticket comes from its other months: a trip's flight, hotel and car are no usual of travel
  const byCategory = medians(buys, (t) => t.category, 1);
  const elsewhere = new Map<string, number | undefined>();
  const categoryTicket = (t: AnalysisTx) => {
    const key = `${t.category}\u0000${t.month}`;
    if (!elsewhere.has(key)) {
      const xs = buys.filter((x) => x.category === t.category && x.month !== t.month).map(netSpend);
      elsewhere.set(key, xs.length >= p.minValues ? median(xs) : undefined);
    }
    return byCategory.has(t.category) ? elsewhere.get(key) : undefined;
  };
  const out = new Set<string>();
  // a subscription or a bill is the usual itself: it sets the ticket and is never struck
  for (const t of buys) {
    if (fixed.has(t.id)) continue;
    const ticket = byMerchant.get(t.merchant) ?? categoryTicket(t);
    const cents = netSpend(t);
    if (ticket === undefined ? cents >= ALONE_CENTS : cents >= MIN_ONE_OFF_CENTS && cents > p.multiple * ticket) out.add(t.id);
  }
  return out;
}

function payOneOffs(rows: readonly AnalysisTx[], p: OneOffPolicy): Set<string> {
  const sorted = [...rows].sort((a, b) => a.day - b.day);
  const out = new Set<string>();
  for (let i = p.minValues; i < sorted.length; i++) {
    const t = sorted[i]!;
    const base = median(sorted.slice(Math.max(0, i - PAY_WINDOW), i).map((x) => x.amountCents));
    const next = sorted[i + 1];
    if (t.amountCents >= base * p.multiple && (!next || next.amountCents < base * PAY_BACK)) out.add(t.id);
  }
  return out;
}

/**
 * What the rows of one key (a category, a payer) sum to in the twelve months around a row: its own month in the middle,
 * moved to stay inside the months `rows` cover. `cents` gives what a row counts for, 0 for a row that does not count.
 */
export function yearAround(rows: readonly AnalysisTx[], key: (t: AnalysisTx) => string, cents: (t: AnalysisTx) => number): (t: AnalysisTx) => number {
  const sums = new Map<string, Map<number, number>>();
  let first = Infinity;
  let last = -Infinity;
  for (const t of rows) {
    first = Math.min(first, t.month);
    last = Math.max(last, t.month);
    const months = sums.get(key(t)) ?? new Map<number, number>();
    sums.set(key(t), months.set(t.month, (months.get(t.month) ?? 0) + cents(t)));
  }
  return (t) => {
    const from = Math.max(first, Math.min(t.month - LARGE_MONTHS / 2, last - LARGE_MONTHS + 1));
    let sum = 0;
    for (let m = from; m < from + LARGE_MONTHS; m++) sum += sums.get(key(t))?.get(m) ?? 0;
    return sum;
  };
}

function largeOneOffs(rows: readonly AnalysisTx[], p: OneOffPolicy, fixed: ReadonlySet<string>): Set<string> {
  const around = yearAround(rows, (t) => t.category, (t) => (isPurchase(t) ? netSpend(t) : 0));
  const out = new Set<string>();
  for (const t of rows) {
    if (!isPurchase(t)) continue;
    const cents = netSpend(t);
    if (t.category === ALWAYS_LARGE || (!fixed.has(t.id) && cents >= LARGE_MIN_CENTS && cents > p.multiple * (around(t) - cents))) out.add(t.id);
  }
  return out;
}

/**
 * The ids of the one-offs among `rows` by `policy`. `rows` are the window the level is read from (the target and the
 * months it is set against), so a row is judged against its own merchant there. `fixed` holds the rows of
 * subscriptions and bills (`ctx.fixedIds`); for `large`, of every series.
 */
export function oneOffs(rows: readonly AnalysisTx[], policy: OneOffPolicy, fixed: ReadonlySet<string> = NONE): Set<string> {
  if (policy.name === "large") return largeOneOffs(rows, policy, fixed);
  return policy.name === "pay" ? payOneOffs(rows, policy) : levelOneOffs(rows, policy, fixed);
}

const monthCache = new WeakMap<AnalysisContext, Map<number, readonly AnalysisTx[]>>();

/**
 * The one-offs of `month` by the level policy, judged against the month and `usualMonths`, the complete months before
 * it (`completeMonthsBefore`, the usual window), largest first. Cached per context and month.
 */
export function monthOneOffs(ctx: AnalysisContext, month: string, usualMonths: readonly string[]): readonly AnalysisTx[] {
  let cache = monthCache.get(ctx);
  if (!cache) monthCache.set(ctx, (cache = new Map()));
  const window = new Set([...usualMonths, month]);
  const key = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7));
  let found = cache.get(key);
  if (!found) {
    const rows = ctx.txs.filter((t) => window.has(t.bookingDate.slice(0, 7)));
    const struck = oneOffs(rows, LEVEL, ctx.fixedIds);
    found = rows.filter((t) => struck.has(t.id) && t.bookingDate.startsWith(month)).sort((a, b) => netSpend(b) - netSpend(a) || a.id.localeCompare(b.id));
    cache.set(key, found);
  }
  return found;
}
