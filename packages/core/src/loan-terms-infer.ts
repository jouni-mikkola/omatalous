/**
 * The terms a loan's payment rows tell, so its form starts from them: the latest payment, the due date it was for, the
 * interval, and the way of paying back, with the review cycle of the reference rate where the payments show one.
 * Decision: the household types only what the bank's rows cannot tell.
 *
 * The rows of an annuity on a reference rate hold one payment between reviews and step at each review, every 3, 6 or 12
 * months. One step tells no cycle (a fixed loan's payment may change once), so a cycle needs two steps at least, and two
 * steps in one month (an extra payment and the usual one after it) count as one. An equal principal loan's payment falls
 * a little at nearly every payment, as its interest follows the balance.
 * A fixed instalment holds the same payment for more than a year. A bank that moves a payment off a weekend still pays
 * most of them on the due day, so the day most rows fall on is the due day.
 */
import { addMonthsToDate, dateIn, daysBetween, fromMonthIndex, monthIndex, monthOf } from "./dates.ts";
import type { IsoDate, Loan, LoanReference } from "./types.ts";

/** One payment of a loan's series: its day and the bank's whole charge, above zero. */
interface LoanPaymentRow {
  date: IsoDate;
  cents: number;
}

export interface InferredLoanTerms {
  /** The latest payment. */
  paymentCents: number;
  /** The due date the latest payment was for: the due day in its month, or in the month beside it when that is nearer. */
  dueDate: IsoDate;
  /** Months between the payments, null when the rows keep no one interval. */
  intervalMonths: number | null;
  /** Null when the rows do not tell it. A card or a credit line has none, which the form decides by the kind. */
  repayment: Exclude<Loan["repayment"], "bullet"> | null;
  /** The euribor whose review cycle the payments step at, null when they show none. */
  reference: Exclude<LoanReference, "fixed"> | null;
  /** The first review after the latest payment, counted from the due date of the latest step. */
  nextReview: IsoDate | null;
}

/** Rows a way of paying back is told from: two changes at least. */
const MIN_ROWS = 3;
/** A change of the payment is a step when it is above the larger of 1 EUR and this part of the payment. */
const STEP_MIN_CENTS = 100;
const STEP_PER_MILLE = 2.5;
/** An equal principal loan's payment falls at this share of its changes at least. */
const FALLING_SHARE = 0.75;
/** A payment held this many months with no step is a fixed instalment. */
const FIXED_MONTHS = 12;
/** Steps whose spacing tells a review cycle: one step alone may be a fixed loan changed once. */
const MIN_STEPS = 2;
const CYCLES = [[12, "euribor_12"], [6, "euribor_6"], [3, "euribor_3"]] as const;

/** The day of the month most rows fall on, the earliest of a tie: a moved payment falls after its due day. */
function dueDayOf(rows: readonly LoanPaymentRow[]): number {
  const counts = new Map<number, number>();
  for (const r of rows) {
    const day = Number(r.date.slice(8, 10));
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0];
}

/** The due date nearest to a payment's day: the due day in the payment's month or in the month before or after it. */
function dueDateOf(date: IsoDate, dueDay: number): IsoDate {
  const month = monthIndex(monthOf(date));
  const near = [month - 1, month, month + 1].map((m) => dateIn(fromMonthIndex(m), dueDay));
  return near.sort((a, b) => Math.abs(daysBetween(date, a)) - Math.abs(daysBetween(date, b)) || (a < b ? -1 : 1))[0]!;
}

const median = (values: readonly number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;

/**
 * The review cycle the steps fit, by the months of their due dates: a cycle every step month is a whole number of
 * cycles apart in, with the fewest reviews inside the rows' months that moved nothing, the longer cycle of a tie (a
 * review may leave the payment as it was when the fixing did not move). Null when no cycle fits.
 */
function cycleOf(steps: readonly number[], first: number, last: number): (typeof CYCLES)[number] | null {
  let best: { cycle: (typeof CYCLES)[number]; silent: number } | null = null;
  for (const cycle of CYCLES) {
    const months = cycle[0];
    if (steps.some((m) => (m - steps[0]!) % months !== 0)) continue;
    let silent = 0;
    for (let m = steps[0]! - months * Math.floor((steps[0]! - first) / months); m <= last; m += months) if (m > first && !steps.includes(m)) silent++;
    if (best === null || silent < best.silent) best = { cycle, silent };
  }
  return best?.cycle ?? null;
}

/** The terms the payment rows of one loan tell, oldest or newest first. Null without a row. */
export function inferLoanTerms(rows: readonly LoanPaymentRow[]): InferredLoanTerms | null {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const latest = sorted.at(-1)!;
  const dueDay = dueDayOf(sorted);
  const dues = sorted.map((r) => dueDateOf(r.date, dueDay));
  const months = dues.map((d) => monthIndex(monthOf(d)));
  const gaps = months.slice(1).map((m, i) => m - months[i]!);
  const interval = gaps.length > 0 ? median(gaps) : null;
  const terms: InferredLoanTerms = {
    paymentCents: latest.cents,
    dueDate: dues.at(-1)!,
    intervalMonths: interval !== null && interval >= 1 && interval <= 12 ? interval : null,
    repayment: null,
    reference: null,
    nextReview: null,
  };
  if (sorted.length < MIN_ROWS) return terms;
  const changes = sorted.slice(1).map((r, i) => r.cents - sorted[i]!.cents);
  if (changes.filter((c) => c < 0).length >= FALLING_SHARE * changes.length) return { ...terms, repayment: "equal_principal" };
  const steps = changes.flatMap((c, i) => (Math.abs(c) > Math.max(STEP_MIN_CENTS, (sorted[i]!.cents * STEP_PER_MILLE) / 1000) ? [i + 1] : []));
  if (steps.length === 0) return months.at(-1)! - months[0]! >= FIXED_MONTHS ? { ...terms, repayment: "fixed_instalment" } : terms;
  // steps 0 months apart are one change of the month, not two reviews
  const stepMonths = steps.map((i) => months[i]!).filter((m, j, all) => j === 0 || m !== all[j - 1]);
  if (stepMonths.length < MIN_STEPS) return terms;
  const cycle = cycleOf(stepMonths, months[0]!, months.at(-1)!);
  if (cycle === null) return terms;
  const lastStep = dues[steps.at(-1)!]!;
  let next = lastStep;
  for (let k = 1; next <= latest.date; k++) next = addMonthsToDate(lastStep, k * cycle[0]);
  return { ...terms, repayment: "annuity", reference: cycle[1], nextReview: next };
}
