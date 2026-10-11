/**
 * What a household has committed to: fixed costs, subscriptions, the charges its series are expected to bring and the
 * bills it typed in, without the merchants it marked as cancelled. One definition each, used by the overview, the
 * recurring page and the reports (docs/MONEY_FLOWS.md).
 */
import type { AnalysisContext } from "./analysis/context.ts";
import { completeMonthsBefore } from "./analysis/usual.ts";
import { getCategory, SUBSCRIPTION_CATEGORIES } from "./categories.ts";
import { addMonthsToDate, monthIndex, monthOf } from "./dates.ts";
import { projectDates, type RecurringSeries } from "./recurring.ts";
import type { ExpectedBill, IsoDate, UserInputs } from "./types.ts";

type FixedInput = Pick<RecurringSeries, "active" | "kind" | "category" | "monthlyCents"> & { merchant?: string };

/**
 * An active subscription or bill that is a fixed cost. The credit card bill
 * is regular, but it pays last month's everyday card purchases, so it is
 * left out (the month forecast still expects it).
 */
export function isFixedCost(s: Pick<RecurringSeries, "active" | "kind" | "category">): boolean {
  return s.active && (s.kind === "subscription" || s.kind === "bill") && s.category !== "card_bill";
}

/**
 * Monthly cost of active subscriptions and bills by what they are: spending,
 * debt service (loan instalments) or saving (a monthly fund saving). A merchant the user marked as cancelled is
 * left out when the caller passes the set: its series stays active until the last charge is old enough, and the
 * household has already acted on it.
 */
export function fixedSplit(series: readonly FixedInput[], cancelled: ReadonlySet<string> = new Set()): { consumptionCents: number; debtCents: number; savingsCents: number } {
  const out = { consumptionCents: 0, debtCents: 0, savingsCents: 0 };
  for (const s of series) {
    if (!isFixedCost(s) || (s.merchant !== undefined && cancelled.has(s.merchant))) continue;
    const kind = getCategory(s.category).kind;
    if (kind === "expense") out.consumptionCents += s.monthlyCents;
    else if (kind === "debt") out.debtCents += s.monthlyCents;
    else if (isSavingsPlan(s)) out.savingsCents += s.monthlyCents;
  }
  return out;
}

/**
 * A fixed cost that is not a subscription: phone, insurance, housing, utilities, day care, a loan instalment. Spending
 * or debt service only, so the contracts and the subscriptions add up to `fixedMonthlyCents`.
 */
export function isContract(s: Pick<RecurringSeries, "active" | "kind" | "category">): boolean {
  if (!isFixedCost(s) || isSubscription(s)) return false;
  const kind = getCategory(s.category).kind;
  return kind === "expense" || kind === "debt";
}

/** An active monthly saving (a fund saving plan): it leaves the account like a bill, but the money is kept, so it is not a fixed cost. */
export function isSavingsPlan(s: Pick<RecurringSeries, "active" | "kind" | "category">): boolean {
  return isFixedCost(s) && getCategory(s.category).kind === "savings";
}

/** Fixed costs per month: spending and debt service (what leaves for good), savings not included. */
export function fixedMonthlyCents(series: readonly FixedInput[], cancelled: ReadonlySet<string> = new Set()): number {
  const split = fixedSplit(series, cancelled);
  return split.consumptionCents + split.debtCents;
}

/** An active fixed-amount series in a subscription category. */
export function isSubscription(s: Pick<RecurringSeries, "active" | "kind" | "category">): boolean {
  return s.active && s.kind === "subscription" && SUBSCRIPTION_CATEGORIES.has(s.category);
}

/**
 * Subscriptions per month. A merchant the user marked as cancelled is not counted: the series stays active until
 * its last charge is old enough, and the household has already acted on it.
 */
export function subscriptionsMonthlyCents(
  series: readonly (FixedInput & Pick<RecurringSeries, "merchant">)[],
  cancelled: ReadonlySet<string> = new Set(),
): number {
  let sum = 0;
  for (const s of series) if (isSubscription(s) && !cancelled.has(s.merchant)) sum += s.monthlyCents;
  return sum;
}

/** A merchant without an active series is counted over this many complete months at most. */
export const MERCHANT_MONTHS = 12;

/** What a merchant's figure per month reads: the last complete months, oldest first, and the active spending series. */
export interface MerchantBasis {
  /** At most `MERCHANT_MONTHS`; none for a history without a complete month. */
  months: readonly string[];
  /** Each merchant's active series, their figures summed: a series owns its cost (ADR 0004). */
  series: ReadonlyMap<string, { monthlyCents: number; yearlyCents: number }>;
}

/** The basis of a view (own or household): an income series is money in, and the figure is money out. */
export function merchantBasis(ctx: Pick<AnalysisContext, "today" | "dataFrom" | "recurring">): MerchantBasis {
  const series = new Map<string, { monthlyCents: number; yearlyCents: number }>();
  for (const s of ctx.recurring) {
    if (!s.active || s.kind === "income") continue;
    const had = series.get(s.merchant) ?? { monthlyCents: 0, yearlyCents: 0 };
    series.set(s.merchant, { monthlyCents: had.monthlyCents + s.monthlyCents, yearlyCents: had.yearlyCents + s.yearlyCents });
  }
  return { months: completeMonthsBefore(ctx, monthOf(ctx.today), MERCHANT_MONTHS), series };
}

/** A merchant's figure per month and the year it comes from. */
export interface MerchantMonthly {
  /** Positive cents; null without an active series and without a complete month. */
  monthlyCents: number | null;
  /** The series' year, or the money out of the months counted. */
  yearCents: number;
  /** The complete months counted; 0 when a series gives the figure. */
  months: number;
  fromSeries: boolean;
}

/**
 * A merchant's figure per month, one definition for Laskut, Kauppiaat and the merchant summary: an active series gives
 * its own cost; any other merchant the money out of the basis months (`outInMonths`, own transfers left out) over their
 * number, so the running month and the months before the history began never pull it down.
 */
export function merchantMonthly(basis: MerchantBasis, merchant: string, outInMonths: number): MerchantMonthly {
  const series = basis.series.get(merchant);
  if (series) return { monthlyCents: series.monthlyCents, yearCents: series.yearlyCents, months: 0, fromSeries: true };
  const n = basis.months.length;
  return { monthlyCents: n ? Math.round(outInMonths / n) : null, yearCents: outInMonths, months: n, fromSeries: false };
}

const CADENCE_MONTHS = { quarterly: 3, semiannual: 6, yearly: 12 } as const;

/** The dates of an expected bill from `from` to `until`, both included, oldest first. A one-off bill has at most one. */
export function expectedDates(bill: Pick<ExpectedBill, "dueDate" | "cadence">, from: IsoDate, until: IsoDate): IsoDate[] {
  if (bill.cadence === "once") return bill.dueDate >= from && bill.dueDate <= until ? [bill.dueDate] : [];
  const step = CADENCE_MONTHS[bill.cadence];
  const out: IsoDate[] = [];
  // start at the last due date of the month `from` falls in: a bill typed in years ago must not walk every date since
  const first = Math.max(0, Math.floor((monthIndex(from) - monthIndex(bill.dueDate)) / step));
  for (let k = first; ; k++) {
    const d = addMonthsToDate(bill.dueDate, k * step);
    if (d > until) break;
    if (d >= from) out.push(d);
  }
  return out;
}

/** The merchants the household marked as cancelled (`merchant:<name>`): the series stays active until its last charge is old. */
export function cancelledMerchants(inputs: UserInputs): ReadonlySet<string> {
  const prefix = "merchant:";
  return new Set(inputs.marks.filter((m) => m.mark === "cancelled" && m.subject.startsWith(prefix)).map((m) => m.subject.slice(prefix.length)));
}

/** A subscription or bill charge the forecast expects on a date. */
export interface ExpectedCharge {
  merchant: string;
  category: string;
  /** Expected charge, positive. */
  amountCents: number;
  date: IsoDate;
}

/**
 * The charges the forecast expects between `from` and `until`: active subscriptions and bills that are not overdue,
 * each at its typical amount on its projected dates. A date before `from` is a charge a few days late, expected on
 * `from`. A merchant in `cancelled` is left out. Savings plans leave the checking account but are not spending, so
 * they come only with `savings`. Date ascending, the larger first.
 */
export function expectedCharges(
  series: readonly RecurringSeries[],
  from: IsoDate,
  until: IsoDate,
  opts: { cancelled?: ReadonlySet<string>; savings?: boolean } = {},
): ExpectedCharge[] {
  const out: ExpectedCharge[] = [];
  for (const s of series) {
    if (!s.active || s.overdue || (s.kind !== "subscription" && s.kind !== "bill") || opts.cancelled?.has(s.merchant)) continue;
    const kind = getCategory(s.category).kind;
    if (kind !== "expense" && kind !== "debt" && !(opts.savings && kind === "savings")) continue;
    for (const d of projectDates(s, until)) out.push({ merchant: s.merchant, category: s.category, amountCents: s.typicalAmountCents, date: d < from ? from : d });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || b.amountCents - a.amountCents);
}
