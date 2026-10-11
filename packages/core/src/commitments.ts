/**
 * What a household has committed to: fixed costs, subscriptions and the bills it typed in. One definition each, used
 * by the overview, the recurring page and the reports (docs/MONEY_FLOWS.md).
 */
import { getCategory } from "./categories.ts";
import { addMonths, daysInMonth, monthIndex, monthOf } from "./dates.ts";
import type { RecurringSeries } from "./recurring.ts";
import type { ExpectedBill, IsoDate } from "./types.ts";

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
export function fixedSplit(series: readonly FixedInput[], cancelledMerchants: ReadonlySet<string> = new Set()): { consumptionCents: number; debtCents: number; savingsCents: number } {
  const out = { consumptionCents: 0, debtCents: 0, savingsCents: 0 };
  for (const s of series) {
    if (!isFixedCost(s) || (s.merchant !== undefined && cancelledMerchants.has(s.merchant))) continue;
    const kind = getCategory(s.category).kind;
    if (kind === "expense") out.consumptionCents += s.monthlyCents;
    else if (kind === "debt") out.debtCents += s.monthlyCents;
    else if (kind === "savings") out.savingsCents += s.monthlyCents;
  }
  return out;
}

/** Fixed costs per month: spending and debt service (what leaves for good), savings not included. */
export function fixedMonthlyCents(series: readonly FixedInput[], cancelledMerchants: ReadonlySet<string> = new Set()): number {
  const split = fixedSplit(series, cancelledMerchants);
  return split.consumptionCents + split.debtCents;
}

/**
 * Where a fixed-amount series is a subscription the household chose and may drop. Telecom, insurance, housing,
 * utilities, memberships and loans are contracts: they stay in the fixed costs and are not offered for review.
 */
export const SUBSCRIPTION_CATEGORIES: ReadonlySet<string> = new Set(["subscriptions", "fitness", "entertainment", "education", "shopping", "other"]);

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
  cancelledMerchants: ReadonlySet<string> = new Set(),
): number {
  let sum = 0;
  for (const s of series) if (isSubscription(s) && !cancelledMerchants.has(s.merchant)) sum += s.monthlyCents;
  return sum;
}

/** Same day of month `n` months later, clamped to the month's length (31.1. + 1 gives 28.2.). */
function monthsLater(date: IsoDate, n: number): IsoDate {
  const month = addMonths(monthOf(date), n);
  return `${month}-${String(Math.min(Number(date.slice(8, 10)), daysInMonth(month))).padStart(2, "0")}`;
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
    const d = monthsLater(bill.dueDate, k * step);
    if (d > until) break;
    if (d >= from) out.push(d);
  }
  return out;
}
