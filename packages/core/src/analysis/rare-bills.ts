/**
 * The rare bills of the twelve calendar months from the one of today: the due dates of the bills that come every second
 * month or less often, found in the bank history or typed in, and what they come to in a year. `upcoming` lists them and
 * the bill calendar adds them up with the monthly ones, so both read the same step.
 */
import { getCategory } from "../categories.ts";
import { expectedDates } from "../commitments.ts";
import { addMonths, monthEnd, monthIndex, monthOf } from "../dates.ts";
import { fold } from "../merchant.ts";
import { type Cadence, projectDates, type RecurringSeries } from "../recurring.ts";
import { MIN_RARE_BILL_CENTS, YEAR_MONTHS } from "../thresholds.ts";
import type { ExpectedCadence, IsoDate, UserInputs } from "../types.ts";
import type { AnalysisContext } from "./context.ts";

/** Bills that come every second month or less often: the ones a household forgets. */
const RARE: ReadonlySet<Cadence> = new Set(["bimonthly", "quarterly", "semiannual", "yearly"]);
/** Shops and visits: a quarterly pet food order is a purchase, not a bill. */
const PURCHASE_LIKE = new Set(["groceries", "restaurants", "food_delivery", "alcohol", "shopping", "home", "entertainment", "travel", "personal_care", "gifts_donations", "gambling", "pets", "health", "other"]);

export type BillSource = "detected" | "manual";

/** One due date of a bill, found or typed in. */
interface Occurrence {
  merchant: string;
  category: string | null;
  cadence: Cadence | ExpectedCadence;
  /** Today for a charge that is late. */
  date: IsoDate;
  amountCents: number;
  source: BillSource;
  /** The series a found bill comes from, whose id names the account that pays it; null on a typed-in bill. */
  seriesId: string | null;
  /** Falls in the twelve months counted: paid this month counts, a charge late from last month does not. */
  inYear: boolean;
  /** Listed as coming: not paid, not past and not from a series that has stopped on time. */
  ahead: boolean;
  /** The last charge of a found bill, booked on `date`, or an occurrence that a payment elsewhere settled, dated by the day it fell due. */
  paid: boolean;
}

/**
 * Detected series that are bills nobody remembers: rare, still running, a bill or subscription in an expense or
 * debt category, not a shop and not a small charge. One that is a few days overdue is still a bill: it counts in
 * the year, so the figure does not drop on the day its due date passes.
 */
export function rareSeries(ctx: AnalysisContext): RecurringSeries[] {
  return ctx.recurring.filter((s) => {
    if (!s.active || !s.cadence || !RARE.has(s.cadence) || (s.kind !== "subscription" && s.kind !== "bill")) return false;
    const kind = getCategory(s.category).kind;
    return (kind === "expense" || kind === "debt") && s.category !== "card_bill" && !PURCHASE_LIKE.has(s.category) && s.typicalAmountCents >= MIN_RARE_BILL_CENTS;
  });
}

/**
 * The due dates of the rare bills in the twelve calendar months from this one, found or typed in, with what was already
 * paid this month, by the series' own row or by a payment from another account that settled the bill. `isDuplicate`
 * tells a typed-in bill that the history already found under the same name: the found one is counted.
 */
export function rareOccurrences(ctx: AnalysisContext, inputs: UserInputs): { occurrences: Occurrence[]; isDuplicate: (name: string) => boolean } {
  const from = ctx.today;
  const firstMonth = monthOf(from);
  const lastMonth = addMonths(firstMonth, YEAR_MONTHS - 1);
  const windowStart = `${firstMonth}-01`;
  const windowEnd = monthEnd(lastMonth);

  const found = rareSeries(ctx);
  const occurrences: Occurrence[] = [];
  for (const s of found) {
    const base = { merchant: s.merchant, category: s.category, cadence: s.cadence!, amountCents: s.typicalAmountCents, source: "detected" as const, seriesId: s.id };
    if (s.lastDate >= windowStart) occurrences.push({ ...base, date: s.lastDate, inYear: true, ahead: false, paid: true });
    // an occurrence that a payment from another account, or under another payee name, settled is paid in the month it fell
    // due: the series' next date has moved on, so without this the year would lose the bill when the payment arrives
    // (a payment made last month for a bill due in this one counts here: the next date is a step on from the due date)
    for (const o of s.settled ?? []) if (o.due >= windowStart && o.due <= windowEnd) occurrences.push({ ...base, date: o.due, inYear: true, ahead: false, paid: true });
    // a charge a few days late is still ahead of us: it shows as today. An overdue series may have stopped, so it is
    // not listed, but its charges stay in the year. A charge late from last month is no part of this year's twelve.
    for (const d of projectDates(s, windowEnd)) occurrences.push({ ...base, date: d < from ? from : d, inYear: d >= windowStart, ahead: !s.overdue, paid: false });
  }

  // a typed-in bill that the history already found is the same bill: the found one is counted
  const foundNames = new Set(found.map((s) => fold(s.merchant)));
  const isDuplicate = (name: string) => foundNames.has(fold(name));
  for (const b of inputs.expectedBills) {
    if (isDuplicate(b.name)) continue;
    const base = { merchant: b.name, category: b.category, cadence: b.cadence, amountCents: b.amountCents, source: "manual" as const, seriesId: null };
    // from the start of the month for every cadence, so a one-off due on the 20th counts all month, not until the 20th
    for (const d of expectedDates(b, windowStart, windowEnd)) occurrences.push({ ...base, date: d, inYear: true, ahead: d >= from, paid: false });
  }
  return { occurrences, isDuplicate };
}

/**
 * What the rare bills of the year come to, and what to set aside each month for them. Repeating bills: a twelfth of the
 * year each month. A one-off: its amount over the months until its due month.
 */
export function rareYear(occurrences: readonly Occurrence[], today: IsoDate): { yearlyCents: number; reserveMonthlyCents: number } {
  const firstMonth = monthOf(today);
  let monthly = 0;
  let yearlyCents = 0;
  for (const o of occurrences) {
    if (!o.inYear) continue;
    yearlyCents += o.amountCents;
    monthly += o.cadence === "once" ? o.amountCents / (monthIndex(monthOf(o.date)) - monthIndex(firstMonth) + 1) : o.amountCents / YEAR_MONTHS;
  }
  return { yearlyCents, reserveMonthlyCents: Math.round(monthly) };
}
