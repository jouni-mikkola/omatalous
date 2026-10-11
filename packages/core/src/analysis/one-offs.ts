/**
 * One-offs: the rows a usual level leaves out (ADR 0005). Every view that strikes a row from a level asks `oneOffs`
 * with a named policy, so the same sofa is a one-off on the overview, in the change report, in the alerts and in
 * Optimoi. See docs/MONEY_FLOWS.md.
 */
import { median } from "../stats.ts";
import { type AnalysisContext, type AnalysisTx, netSpend } from "./context.ts";

export interface OneOffPolicy {
  name: "level" | "pay";
  /** A row is a one-off over this many times its usual size. */
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

const MIN_ONE_OFF_CENTS = 5000;
const ALONE_CENTS = 15000;
const PAY_BACK = 1.2;
const PAY_WINDOW = 6;

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
 * The ids of the one-offs among `rows` by `policy`. `rows` are the window the level is read from (the target and the
 * months it is set against), so a row is judged against its own merchant there. `fixed` holds the rows of
 * subscriptions and bills (`ctx.fixedIds`).
 */
export function oneOffs(rows: readonly AnalysisTx[], policy: OneOffPolicy, fixed: ReadonlySet<string> = NONE): Set<string> {
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
