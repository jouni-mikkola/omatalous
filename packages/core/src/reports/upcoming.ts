// Decision: how much to set aside each month for rare bills
import { type BillSource, rareOccurrences, rareYear } from "../analysis/rare-bills.ts";
import type { AnalysisContext } from "../analysis/context.ts";
import { expectedDates } from "../commitments.ts";
import { addDays } from "../dates.ts";
import type { Cadence } from "../recurring.ts";
import { type ExpectedCadence, type IsoDate, NO_INPUTS, type UserInputs } from "../types.ts";

const HORIZON_DAYS = 92;
/** Days after today in which the next due date of a typed-in bill is looked for (a yearly bill is at most a year away). */
const NEXT_DATE_DAYS = 400;

interface UpcomingBill {
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

/** A bill the user typed in, for the list where it can be removed. */
interface ManualBill {
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
  /** Every bill the user typed in, the soonest first. */
  manual: ManualBill[];
}

/**
 * Bills that do not come every month: quarterly insurance, yearly taxes and memberships, found in the bank history
 * or typed in by the user (a yearly bill needs two charges before it is found). The monthly ones are in the forecast
 * and on the recurring page; these are the ones that surprise. Always about today, whatever period the page shows.
 *
 * The year runs over whole calendar months from this one and counts what was already paid this month, so the figure
 * does not change when a bill is paid or goes overdue and stays the same all month. A one-off bill is not a
 * yearly cost: it adds to the year, and its amount is spread over the months from this one to the month it is due.
 */
export function upcomingReport(ctx: AnalysisContext, inputs: UserInputs = NO_INPUTS): UpcomingReport {
  const from = ctx.today;
  const to = addDays(from, HORIZON_DAYS);
  const { occurrences, isDuplicate } = rareOccurrences(ctx, inputs);

  const items: UpcomingBill[] = occurrences
    .filter((o) => o.ahead && o.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date) || b.amountCents - a.amountCents || a.merchant.localeCompare(b.merchant))
    .map(({ inYear: _inYear, ahead: _ahead, paid: _paid, ...bill }) => bill);
  const totalCents = items.reduce((s, i) => s + i.amountCents, 0);

  const { yearlyCents, reserveMonthlyCents } = rareYear(occurrences, from);

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

  return { from, to, items, totalCents, reserveMonthlyCents, yearlyCents, manual };
}
