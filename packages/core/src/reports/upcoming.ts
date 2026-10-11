// Decision: how much to set aside each month for rare bills
import { getCategory } from "../categories.ts";
import type { AnalysisContext } from "../analysis/context.ts";
import { formatEur } from "../analysis/format.ts";
import { expectedDates } from "../commitments.ts";
import { addDays, addMonths, monthEnd, monthIndex, monthOf } from "../dates.ts";
import { fold } from "../merchant.ts";
import { type Cadence, projectDates, type RecurringSeries } from "../recurring.ts";
import { type ExpectedCadence, type IsoDate, NO_INPUTS, type UserInputs } from "../types.ts";

/** Bills that come every second month or less often: the ones a household forgets. */
const RARE: ReadonlySet<Cadence> = new Set(["bimonthly", "quarterly", "semiannual", "yearly"]);
const HORIZON_DAYS = 92;
/** Shops and visits: a quarterly pet food order is a purchase, not a bill. */
const PURCHASE_LIKE = new Set(["groceries", "restaurants", "food_delivery", "alcohol", "shopping", "home", "entertainment", "travel", "personal_care", "gifts_donations", "gambling", "pets", "health", "other"]);
/** A small yearly charge (a 2 € storage plan) is not worth a line. */
const MIN_CENTS = 1000;
/** The year the costs are counted over, from the month of today. */
const YEAR_MONTHS = 12;
/** Days after today in which the next due date of a typed-in bill is looked for (a yearly bill is at most a year away). */
const NEXT_DATE_DAYS = 400;

export type BillSource = "detected" | "manual";

export interface UpcomingBill {
  merchant: string;
  /** Null for a typed-in bill without a category. */
  category: string | null;
  cadence: Cadence | ExpectedCadence;
  /** Expected date; today for a charge that is a few days late. */
  date: IsoDate;
  /** What the last charges were (detected) or what the user typed (manual), positive. */
  amountCents: number;
  /** Found in the bank history, or typed in by the user. */
  source: BillSource;
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

/** A bill the user typed in, for the list where it can be removed. */
export interface ManualBill {
  id: string;
  name: string;
  amountCents: number;
  /** The first due date as typed. */
  dueDate: IsoDate;
  cadence: ExpectedCadence;
  category: string | null;
  /** The next due date from today; null for a one-off that has passed. */
  nextDate: IsoDate | null;
  /** False when a bill found in the bank history has the same name: that one is counted, this one is not. */
  counted: boolean;
}

export interface UpcomingReport {
  from: IsoDate;
  to: IsoDate;
  /** Date ascending. */
  items: UpcomingBill[];
  totalCents: number;
  /** What to set aside each month so the rare bills are paid from savings, not from the month they fall in. */
  reserveMonthlyCents: number;
  /** The rare bills of the twelve months from the start of this month. */
  yearlyCents: number;
  /** Twelve months, this one first. */
  months: BillMonth[];
  /** Every bill the user typed in, the soonest first. */
  manual: ManualBill[];
  /** One sentence on the reserve; "" without bills. */
  advice: string;
}

/** One due date of a bill, found or typed in. */
interface Occurrence {
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
  /** The last charge of a found bill, booked on `date`. */
  paid: boolean;
}

/**
 * Detected series that are bills nobody remembers: rare, still running, a bill or subscription in an expense or
 * debt category, not a shop and not a small charge. One that is a few days overdue is still a bill: it counts in
 * the year, so the figure does not drop on the day its due date passes.
 */
function rareSeries(ctx: AnalysisContext): RecurringSeries[] {
  return ctx.recurring.filter((s) => {
    if (!s.active || !s.cadence || !RARE.has(s.cadence) || (s.kind !== "subscription" && s.kind !== "bill")) return false;
    const kind = getCategory(s.category).kind;
    return (kind === "expense" || kind === "debt") && s.category !== "card_bill" && !PURCHASE_LIKE.has(s.category) && s.typicalAmountCents >= MIN_CENTS;
  });
}

/**
 * Bills that do not come every month: quarterly insurance, yearly taxes and memberships, found in the bank history
 * or typed in by the user (a yearly bill needs two charges before it is found). The monthly ones are in the forecast
 * and on the recurring page; these are the ones that surprise. Always about today, whatever period the page shows.
 *
 * The year runs over whole calendar months from this one and counts what was already paid this month, so the
 * figure does not change when a bill is paid or goes overdue and stays the same all month. A one-off bill is not a
 * yearly cost: it adds to the year, and its amount is spread over the months from this one to the month it is due.
 */
export function upcomingReport(ctx: AnalysisContext, inputs: UserInputs = NO_INPUTS): UpcomingReport {
  const from = ctx.today;
  const to = addDays(from, HORIZON_DAYS);
  const firstMonth = monthOf(from);
  const lastMonth = addMonths(firstMonth, YEAR_MONTHS - 1);
  const windowStart = `${firstMonth}-01`;
  const windowEnd = monthEnd(lastMonth);

  const found = rareSeries(ctx);
  const occurrences: Occurrence[] = [];
  for (const s of found) {
    const base = { merchant: s.merchant, category: s.category, cadence: s.cadence!, amountCents: s.typicalAmountCents, source: "detected" as const };
    if (s.lastDate >= windowStart) occurrences.push({ ...base, date: s.lastDate, inYear: true, ahead: false, paid: true });
    // a charge a few days late is still ahead of us: it shows as today. An overdue series may have stopped, so it is
    // not listed, but its charges stay in the year. A charge late from last month is no part of this year's twelve.
    for (const d of projectDates(s, windowEnd)) occurrences.push({ ...base, date: d < from ? from : d, inYear: d >= windowStart, ahead: !s.overdue, paid: false });
  }

  // a typed-in bill that the history already found is the same bill: the found one is counted
  const foundNames = new Set(found.map((s) => fold(s.merchant)));
  const isDuplicate = (name: string) => foundNames.has(fold(name));
  for (const b of inputs.expectedBills) {
    if (isDuplicate(b.name)) continue;
    const base = { merchant: b.name, category: b.category, cadence: b.cadence, amountCents: b.amountCents, source: "manual" as const };
    // from the start of the month for every cadence, so a one-off due on the 20th counts all month, not until the 20th
    for (const d of expectedDates(b, windowStart, windowEnd)) occurrences.push({ ...base, date: d, inYear: true, ahead: d >= from, paid: false });
  }

  const items: UpcomingBill[] = occurrences
    .filter((o) => o.ahead && o.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date) || b.amountCents - a.amountCents || a.merchant.localeCompare(b.merchant))
    .map(({ inYear: _inYear, ahead: _ahead, paid: _paid, ...bill }) => bill);
  const totalCents = items.reduce((s, i) => s + i.amountCents, 0);

  const months: BillMonth[] = Array.from({ length: YEAR_MONTHS }, (_, i) => {
    const month = addMonths(firstMonth, i);
    const here = occurrences.filter((o) => o.inYear && monthOf(o.date) === month).sort((a, b) => b.amountCents - a.amountCents || a.merchant.localeCompare(b.merchant));
    const paid = here.filter((o) => o.paid).map((o) => ({ merchant: o.merchant, date: o.date }));
    return { month, cents: here.reduce((s, o) => s + o.amountCents, 0), names: [...new Set(here.map((o) => o.merchant))], paid };
  });
  const yearlyCents = months.reduce((s, m) => s + m.cents, 0);

  // repeating bills: a twelfth of the year each month. A one-off: its amount over the months until its due month.
  let monthly = 0;
  for (const o of occurrences) if (o.inYear) monthly += o.cadence === "once" ? o.amountCents / (monthIndex(monthOf(o.date)) - monthIndex(firstMonth) + 1) : o.amountCents / YEAR_MONTHS;
  const reserveMonthlyCents = Math.round(monthly);

  const manual = inputs.expectedBills
    .map((b): ManualBill => ({
      id: b.id,
      name: b.name,
      amountCents: b.amountCents,
      dueDate: b.dueDate,
      cadence: b.cadence,
      category: b.category,
      nextDate: expectedDates(b, from, addDays(from, NEXT_DATE_DAYS))[0] ?? null,
      counted: !isDuplicate(b.name),
    }))
    .sort((a, b) => (a.nextDate ?? "9999").localeCompare(b.nextDate ?? "9999") || a.name.localeCompare(b.name));

  return { from, to, items, totalCents, reserveMonthlyCents, yearlyCents, months, manual, advice: yearlyCents > 0 ? advice(reserveMonthlyCents, yearlyCents) : "" };
}

function advice(reserve: number, yearly: number): string {
  return `Varaa ${formatEur(reserve, false)} kuussa, harvinaiset laskut ovat ${formatEur(yearly, false)} vuodessa.`;
}
