/**
 * What a household has committed to: fixed costs, subscriptions, the charges its series are expected to bring and the
 * bills it typed in, without the subscriptions it marked as cancelled. One definition each, used by the overview, the
 * recurring page and the reports (docs/MONEY_FLOWS.md).
 */
import type { AnalysisContext } from "./analysis/context.ts";
import { countingMark, covers, type MarkedSeries, marksBySubject } from "./analysis/subscription-alerts.ts";
import { completeMonthsBefore } from "./analysis/usual.ts";
import { getCategory, SUBSCRIPTION_CATEGORIES } from "./categories.ts";
import { hasEnded } from "./contract.ts";
import { addMonthsToDate, daysBetween, monthIndex, monthOf } from "./dates.ts";
import { endedPlanSubjects } from "./plan-answer.ts";
import { isOverdue, projectDates, type RecurringSeries } from "./recurring.ts";
import type { ExpectedBill, IsoDate, UserInputs, UserMark } from "./types.ts";

/** What a mark can find a series by. A caller may pass less than a whole series, and then only a mark on its merchant covers it. */
type Markable = Pick<RecurringSeries, "kind"> & Partial<Omit<MarkedSeries, "kind">>;

type FixedInput = Pick<RecurringSeries, "active" | "category" | "monthlyCents"> & Markable;

/**
 * Whether the household marked a series as cancelled: a mark on the series itself, or an old one on its merchant, which
 * covers every series of the merchant. `cancelled` comes from `cancelledSubjects`; a set of merchant names works too.
 */
export function isCancelled(cancelled: ReadonlySet<string>, s: Markable): boolean {
  const { id, merchant, typicalAmountCents } = s;
  if (merchant === undefined || !cancelled.size) return false;
  if (cancelled.has(merchant)) return true;
  if (id === undefined || typicalAmountCents === undefined) return false;
  const series = { id, merchant, kind: s.kind, typicalAmountCents, priceChange: s.priceChange ?? null };
  for (const key of cancelled) if (covers(key, series)) return true;
  return false;
}

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
 * debt service (loan instalments) or saving (a monthly fund saving). A series the user marked as cancelled is
 * left out when the caller passes the set (`cancelledSubjects`): it stays active until the last charge is old enough,
 * and the household has already acted on it.
 */
export function fixedSplit(series: readonly FixedInput[], cancelled: ReadonlySet<string> = new Set()): { consumptionCents: number; debtCents: number; savingsCents: number } {
  const out = { consumptionCents: 0, debtCents: 0, savingsCents: 0 };
  for (const s of series) {
    if (isFixedSpending(s, cancelled)) {
      if (getCategory(s.category).kind === "expense") out.consumptionCents += s.monthlyCents;
      else out.debtCents += s.monthlyCents;
    } else if (isFixedCost(s) && !isCancelled(cancelled, s) && isSavingsPlan(s)) out.savingsCents += s.monthlyCents;
  }
  return out;
}

/**
 * A series the fixed costs of a month count: a fixed cost the household has not cancelled, spending or debt service.
 * Its `monthlyCents` are in `consumptionCents + debtCents` of `fixedSplit`, so a list of these adds up to that figure.
 */
export function isFixedSpending(s: FixedInput, cancelled: ReadonlySet<string>): boolean {
  if (!isFixedCost(s) || isCancelled(cancelled, s)) return false;
  const kind = getCategory(s.category).kind;
  return kind === "expense" || kind === "debt";
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

/**
 * Whether a contract (contract.ts) has ended: the user's mark first, Lopetettu says it did and Käytössä, said in the
 * last twelve months, says it did not; without one the payments say (`contract.ended`). A series that is no contract
 * has not.
 */
export function isEndedContract(s: Pick<RecurringSeries, "id" | "merchant" | "kind" | "typicalAmountCents" | "priceChange" | "contract">, marks: ReadonlyMap<string, UserMark>, today: IsoDate): boolean {
  if (!s.contract) return false;
  const mark = countingMark(marks, s, today);
  return mark ? mark.mark === "cancelled" : s.contract.ended;
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
 * Subscriptions per month. A series the user marked as cancelled is not counted: it stays active until its last
 * charge is old enough, and the household has already acted on it.
 */
export function subscriptionsMonthlyCents(
  series: readonly (FixedInput & Pick<RecurringSeries, "merchant">)[],
  cancelled: ReadonlySet<string> = new Set(),
): number {
  let sum = 0;
  for (const s of series) if (isSubscription(s) && !isCancelled(cancelled, s)) sum += s.monthlyCents;
  return sum;
}

/** A merchant without an active series is counted over this many complete months at most. */
const MERCHANT_MONTHS = 12;

/** What a merchant's figure per month reads: the last complete months, oldest first, and the active spending series. */
export interface MerchantBasis {
  /** At most `MERCHANT_MONTHS`; none for a history without a complete month. */
  months: readonly string[];
  /** Each merchant's active series, their figures summed: a series owns its cost (ADR 0004). */
  series: ReadonlyMap<string, { monthlyCents: number; yearlyCents: number }>;
}

/** The basis of a view (own or household): an income series is money in, and the figure is money out. */
export function merchantBasis(ctx: AnalysisContext): MerchantBasis {
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

/**
 * What the household marked as cancelled, for `isCancelled` and the totals here: the keys of `marksBySubject`, so the
 * whole subject of a mark on one series, and the merchant's name for an old mark on a merchant (the name of this
 * function is from when every mark was one). A marked series stays active until its last charge is old. Given the day,
 * a plan the household said the end of, when that month has passed, is among them.
 */
export function cancelledSubjects(inputs: UserInputs, today?: IsoDate): ReadonlySet<string> {
  const cancelled = [...marksBySubject(inputs.marks)].filter(([, m]) => m.mark === "cancelled").map(([key]) => key);
  // with a day: an instalment plan whose answered end month has passed is over as a cancelled series is (plan-answer.ts)
  return new Set(today === undefined ? cancelled : [...cancelled, ...endedPlanSubjects(inputs, today)]);
}

/**
 * A subscription or bill that is spending or debt service: what the forecast expects. With `savings` a monthly saving is one too.
 */
export function isBillSeries(s: Pick<RecurringSeries, "kind" | "category">, savings = false): boolean {
  if (s.kind !== "subscription" && s.kind !== "bill") return false;
  const kind = getCategory(s.category).kind;
  return kind === "expense" || kind === "debt" || (savings && kind === "savings");
}

/**
 * How many days past its due day a bill that did not come and is no longer `active` is still named so: a monthly
 * series has ended by then (contract.ts), and a quarterly or yearly one, which ends months later, is not asked about
 * for a whole season. While `active` it is always named, since the forecast already treats it as late then.
 */
const MISSED_DAYS = 45;

/**
 * The day a bill or subscription was due and did not come, or null. Late is `overdue`'s more than five days past the
 * next date. It stays late after the series is no longer `active` (from day 11 of a monthly one), until it has ended by
 * contract.ts's rule (`contract.ended`, else the same rule on the series' own dates) or is `MISSED_DAYS` late and no
 * longer active. With today's `ENDED_CADENCES`, `ENDED_LATE_DAYS` and cadence tolerances that is days 6 to 45 of a
 * monthly or quarterly series, 6 to about 50 of a yearly one (it stays active that long), 6 to 19 of a weekly one and 6
 * to 22 of one paid twice a month (the tests hold these spans). Nothing ahead counts a missed bill: `active` and
 * `overdue` keep their meaning.
 */
export function missedOn(s: Pick<RecurringSeries, "kind" | "category" | "nextDate" | "intervalDays" | "contract" | "active">, today: IsoDate): IsoDate | null {
  if (!s.nextDate || !isBillSeries(s) || !isOverdue(true, s.nextDate, today) || (!s.active && daysBetween(s.nextDate, today) > MISSED_DAYS)) return null;
  const ended = s.contract ? s.contract.ended : hasEnded(s.nextDate, s.intervalDays, today);
  return ended ? null : s.nextDate;
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
 * each at its typical amount on its projected dates, which start at the series' next date: an occurrence that a
 * payment from another account settled is no charge (`settled`). A date before `from` is a charge a few days late,
 * expected on `from`. A series `cancelled` covers is left out (`isCancelled`). Savings plans leave the checking account but are not spending, so
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
    if (!s.active || s.overdue || !isBillSeries(s, opts.savings) || (opts.cancelled && isCancelled(opts.cancelled, s))) continue;
    for (const d of projectDates(s, until)) out.push({ merchant: s.merchant, category: s.category, amountCents: s.typicalAmountCents, date: d < from ? from : d });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || b.amountCents - a.amountCents);
}
