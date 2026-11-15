/**
 * The bills that come every second month or less often, found in the bank history or typed in, and what they add up to
 * over a year. Laskut (`reports/upcoming.ts`) lists them and the insight about them (`insights/rare-bills.ts`) tells
 * what to set aside, both from this one set, so the two never name different bills or different sums.
 */
import { getCategory } from "../categories.ts";
import { expectedDates } from "../commitments.ts";
import { addMonths, monthEnd, monthIndex, monthOf } from "../dates.ts";
import { fold } from "../merchant.ts";
import { type Cadence, projectDates, type RecurringSeries } from "../recurring.ts";
import { RARE_BILL_MIN_CENTS, RARE_BILL_YEAR_MONTHS } from "../thresholds.ts";
import type { ExpectedCadence, IsoDate, UserInputs } from "../types.ts";
import type { AnalysisContext } from "./context.ts";

/** Bills that come every second month or less often: the ones a household forgets. */
const RARE: ReadonlySet<Cadence> = new Set(["bimonthly", "quarterly", "semiannual", "yearly"]);
/** Shops and visits: a quarterly pet food order is a purchase, not a bill. */
const PURCHASE_LIKE = new Set(["groceries", "restaurants", "food_delivery", "alcohol", "shopping", "home", "entertainment", "travel", "personal_care", "gifts_donations", "gambling", "pets", "health", "other"]);

type BillSource = "detected" | "manual";

/** One due date of a bill, found or typed in. */
export interface Occurrence {
  merchant: string;
  category: string | null;
  cadence: Cadence | ExpectedCadence;
  /** Today for a charge that is late. */
  date: IsoDate;
  amountCents: number;
  source: BillSource;
  /** Falls in the twelve months counted: paid this month counts, a charge late from last month does not. */
  inYear: boolean;
  /** Listed as coming: not paid, not past and not from a series that has stopped on time. */
  ahead: boolean;
  /** The last charge of a found bill, booked on `date`, or an occurrence that a payment elsewhere settled, dated by the day it fell due. */
  paid: boolean;
}

/** Rare bills that fall due in one calendar month. */
export interface BillMonth {
  /** `YYYY-MM`. */
  month: string;
  cents: number;
  /** Which bills, the dearest first. */
  names: string[];
  /** The bills of the month already paid, with the day: a bill paid on the 5th is not coming. */
  paid: { merchant: string; date: IsoDate }[];
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
    return (kind === "expense" || kind === "debt") && s.category !== "card_bill" && !PURCHASE_LIKE.has(s.category) && s.typicalAmountCents >= RARE_BILL_MIN_CENTS;
  });
}

/**
 * Every due date of the rare bills in the twelve calendar months from the month of today, found bills and typed-in
 * ones. A typed-in bill that the history already found is the same bill: the found one is counted. `names` are the
 * names of the found bills, which Laskut reads to tell a typed-in duplicate.
 */
export function rareOccurrences(ctx: AnalysisContext, inputs: UserInputs): { occurrences: Occurrence[]; names: Set<string> } {
  const from = ctx.today;
  const windowStart = `${monthOf(from)}-01`;
  const windowEnd = monthEnd(addMonths(monthOf(from), RARE_BILL_YEAR_MONTHS - 1));
  const found = rareSeries(ctx);
  const occurrences: Occurrence[] = [];
  for (const s of found) {
    const base = { merchant: s.merchant, category: s.category, cadence: s.cadence!, amountCents: s.typicalAmountCents, source: "detected" as const };
    if (s.lastDate >= windowStart) occurrences.push({ ...base, date: s.lastDate, inYear: true, ahead: false, paid: true });
    // an occurrence that a payment from another account, or under another payee name, settled is paid in the month it fell
    // due: the series' next date has moved on, so without this the year would lose the bill when the payment arrives
    // (a payment made last month for a bill due in this one counts here: the next date is a step on from the due date)
    for (const o of s.settled ?? []) if (o.due >= windowStart && o.due <= windowEnd) occurrences.push({ ...base, date: o.due, inYear: true, ahead: false, paid: true });
    // a charge a few days late is still ahead of us: it shows as today. An overdue series may have stopped, so it is
    // not listed, but its charges stay in the year. A charge late from last month is no part of this year's twelve.
    for (const d of projectDates(s, windowEnd)) occurrences.push({ ...base, date: d < from ? from : d, inYear: d >= windowStart, ahead: !s.overdue, paid: false });
  }
  const names = new Set(found.map((s) => fold(s.merchant)));
  for (const b of inputs.expectedBills) {
    if (names.has(fold(b.name))) continue;
    const base = { merchant: b.name, category: b.category, cadence: b.cadence, amountCents: b.amountCents, source: "manual" as const };
    // from the start of the month for every cadence, so a one-off due on the 20th counts all month, not until the 20th
    for (const d of expectedDates(b, windowStart, windowEnd)) occurrences.push({ ...base, date: d, inYear: true, ahead: d >= from, paid: false });
  }
  return { occurrences, names };
}

/** The year of rare bills: each calendar month's sum, the year's sum and what to set aside each month. */
export function rareYear(occurrences: readonly Occurrence[], today: IsoDate): { months: BillMonth[]; yearlyCents: number; reserveMonthlyCents: number } {
  const firstMonth = monthOf(today);
  const months: BillMonth[] = Array.from({ length: RARE_BILL_YEAR_MONTHS }, (_, i) => {
    const month = addMonths(firstMonth, i);
    const here = occurrences.filter((o) => o.inYear && monthOf(o.date) === month).sort((a, b) => b.amountCents - a.amountCents || a.merchant.localeCompare(b.merchant));
    const paid = here.filter((o) => o.paid).map((o) => ({ merchant: o.merchant, date: o.date }));
    return { month, cents: here.reduce((s, o) => s + o.amountCents, 0), names: [...new Set(here.map((o) => o.merchant))], paid };
  });
  const yearlyCents = months.reduce((s, m) => s + m.cents, 0);
  // repeating bills: a twelfth of the year each month. A one-off: its amount over the months until its due month.
  let monthly = 0;
  for (const o of occurrences) if (o.inYear) monthly += o.cadence === "once" ? o.amountCents / (monthIndex(monthOf(o.date)) - monthIndex(firstMonth) + 1) : o.amountCents / RARE_BILL_YEAR_MONTHS;
  return { months, yearlyCents, reserveMonthlyCents: Math.round(monthly) };
}
