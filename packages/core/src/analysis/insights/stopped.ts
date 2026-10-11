/**
 * H-insights 8 on top of the old `stopped:`: a subscription, contract or loan payment of six payments or more that
 * has stopped. From 30 € a month the title says how much is free each month. It waits two intervals and five
 * days after the last payment, counted to the last booking of the account it was paid from: a late charge, a sync
 * that lags or an account that stopped syncing is not a stop. A school's summer break is no stop. A new series from
 * the same payee, a new payee in the same category within 60 days (Helen to Oomi, If to LähiTapiola) or a new loan
 * payment within 60 days of a loan's last one is a switch, a refinancing or a moved payment: no insight then. A last
 * payment of several months at once (a yearly fee in place of monthly ones) is a new cadence: the wait counts the
 * months it paid for.
 */
import { getCategory } from "../../categories.ts";
import { daysBetween } from "../../dates.ts";
import type { RecurringSeries } from "../../recurring.ts";
import { type AnalysisContext, recurringAt } from "../context.ts";
import { formatEur, formatFiDate } from "../format.ts";
import { PLAN_CATEGORIES } from "./prices.ts";
import { evenlySpaced, MONTHLY_OR_LONGER } from "./shared.ts";
import type { Insight, InsightArgs } from "./types.ts";

/** Day care, after-school clubs, music lessons and hobby groups pause from June to mid-August. */
const TERM_CATEGORIES = new Set(["kids", "education", "fitness", "entertainment"]);
/** A payment that ran for half a year is part of the household's month; a shorter one was a try. */
const MIN_PAYMENTS = 6;
/** A loan or contract that ended frees at least this much a month before it is news (H-insights 8). */
const FREED_MIN_MONTHLY = 3000;
const MAX_DAYS = 120;
const REFINANCE_DAYS = 60;
/** A charge over this many times the usual one pays for months ahead (a yearly fee instead of monthly ones). */
const PREPAID_FACTOR = 3;

/** Whether a charge of `cents` pays for months ahead of a usual charge of `usualCents`. The follow-up reads it too. */
export const paysAhead = (cents: number, usualCents: number) => cents > PREPAID_FACTOR * usualCents;

/** Contracts that can be paid for a year at once: subscriptions, phone and insurance. */
const PREPAID_CATEGORIES: ReadonlySet<string> = new Set([...PLAN_CATEGORIES, "insurance"]);

/**
 * How many intervals the series' last payment covered: 1, or about twelve when one yearly payment followed monthly
 * ones. The recurring detector reads such a payment as a price change of the series on its last charge. A large last
 * payment on a loan or credit pays it off: the loan ended.
 */
function intervalsPaid(s: Pick<RecurringSeries, "priceChange" | "lastDate" | "category">): number {
  const p = s.priceChange;
  if (!PREPAID_CATEGORIES.has(s.category) || !p || p.date !== s.lastDate || !paysAhead(p.toCents, p.fromCents)) return 1;
  return Math.round(p.toCents / p.fromCents);
}

/**
 * What the series cost a month before its last payment: a payoff on a loan is no month's cost, and the detector reads it
 * as the series' new price.
 */
function monthlyBefore(s: Pick<RecurringSeries, "priceChange" | "lastDate" | "monthlyCents">): number {
  const p = s.priceChange;
  return p && p.date === s.lastDate && paysAhead(p.toCents, p.fromCents) ? Math.round((s.monthlyCents * p.fromCents) / p.toCents) : s.monthlyCents;
}

/** The last booking day of each account up to `end`, and the account of each transaction. */
function accountDays(ctx: AnalysisContext, end: string): { lastBooking: Map<string, string>; accountOf: Map<string, string> } {
  const lastBooking = new Map<string, string>();
  const accountOf = new Map<string, string>();
  for (const t of ctx.txs) {
    accountOf.set(t.id, t.accountId);
    if (t.bookingDate <= end) lastBooking.set(t.accountId, t.bookingDate);
  }
  return { lastBooking, accountOf };
}

/** The payee that took over a stopped payment, and the day of its first charge in the category. */
export interface Replacement {
  merchant: string;
  firstDate: string;
}

/**
 * Did another payee take over the payment within REFINANCE_DAYS of `last`? A recurring series in the category that
 * starts then does, and so does a first charge of at least half the old amount (a new contract has billed once and is
 * no series yet). A single small purchase from a new shop in the category is no switch. Optimoi's follow-up reads the
 * payee from here, so the insight and the follow-up never disagree on a switch.
 */
export function replacementOf(ctx: AnalysisContext, s: RecurringSeries, end: string): Replacement | null {
  const near = (day: string) => Math.abs(daysBetween(s.lastDate, day)) <= REFINANCE_DAYS;
  const series = ctx.recurring.find((o) => o.category === s.category && o.merchant !== s.merchant && o.firstDate <= end && near(o.firstDate));
  if (series) return { merchant: series.merchant, firstDate: series.firstDate };
  const first = new Map<string, { day: string; cents: number }>();
  for (const t of ctx.txs) {
    if (t.category !== s.category || t.spend <= 0 || t.bookingDate > end || t.merchant === s.merchant || first.has(t.merchant)) continue;
    first.set(t.merchant, { day: t.bookingDate, cents: t.spend });
  }
  for (const [merchant, f] of first) if (near(f.day) && f.cents * 2 >= s.lastAmountCents) return { merchant, firstDate: f.day };
  return null;
}

/** The switch test of the insight: true when `replacementOf` finds a payee. */
export function newPayeeIn(ctx: AnalysisContext, s: RecurringSeries, end: string): boolean {
  return replacementOf(ctx, s, end) !== null;
}

/** A term fee last paid in May or June and looked at before the autumn term has started billing. */
function summerBreak(s: RecurringSeries, end: string): boolean {
  const lastMonth = Number(s.lastDate.slice(5, 7));
  return TERM_CATEGORIES.has(s.category) && (lastMonth === 5 || lastMonth === 6) && end.slice(0, 4) === s.lastDate.slice(0, 4) && end.slice(5) <= "09-30";
}

export function stoppedPayments({ ctx, end, gateMonthlyCents }: InsightArgs): Insight[] {
  const recurring = recurringAt(ctx, end);
  const kindOf = (s: RecurringSeries) => getCategory(s.category).kind;
  const { lastBooking, accountOf } = accountDays(ctx, end);
  const out: Insight[] = [];
  for (const s of recurring) {
    const kind = kindOf(s);
    if ((s.kind !== "subscription" && s.kind !== "bill") || s.active || s.category === "card_bill" || (kind !== "expense" && kind !== "debt")) continue;
    const account = accountOf.get(s.transactionIds[s.transactionIds.length - 1]!);
    const since = daysBetween(s.lastDate, (account && lastBooking.get(account)) ?? s.lastDate);
    // the next payment is due an interval after what the last one paid for, and may be an interval late
    if (since <= (intervalsPaid(s) + 1) * s.intervalDays + 5 || daysBetween(s.lastDate, end) > MAX_DAYS || summerBreak(s, end)) continue;
    const moved = recurring.some(
      (o) =>
        o !== s &&
        o.active &&
        o.firstDate >= s.firstDate &&
        ((o.merchant === s.merchant && Math.abs(o.monthlyCents - s.monthlyCents) <= 0.2 * s.monthlyCents) ||
          (kind === "debt" && kindOf(o) === "debt" && Math.abs(daysBetween(s.lastDate, o.firstDate)) <= REFINANCE_DAYS)),
    );
    if (moved || !MONTHLY_OR_LONGER.has(s.cadence ?? "") || s.occurrences < MIN_PAYMENTS || !evenlySpaced(ctx, s)) continue;
    const perMonth = monthlyBefore(s);
    if (perMonth < gateMonthlyCents) continue;
    if (newPayeeIn(ctx, s, end)) continue;
    const freed = perMonth >= FREED_MIN_MONTHLY;
    const monthly = formatEur(perMonth, false);
    out.push({
      id: `stopped:${s.id}`,
      tone: freed ? "good" : "info",
      title: freed ? `${s.merchant}: ${monthly} kuussa vapautui` : `${s.merchant}: ei maksuja ${formatFiDate(s.lastDate)} jälkeen`,
      detail: freed
        ? `Viimeinen maksu ${formatFiDate(s.lastDate)}, ${s.occurrences} maksua ${formatFiDate(s.firstDate)} alkaen.`
        : `Viimeksi ${formatEur(s.lastAmountCents)}, tavallisesti ${monthly} kuussa.`,
      yearlyCents: perMonth * 12,
      rows: s.transactionIds,
      link: { merchant: s.merchant },
      merchant: s.merchant,
    });
  }
  return out;
}
