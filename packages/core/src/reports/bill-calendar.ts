// Decision: which bills and pays fall in each of the next twelve months, and what the household needs to have set aside for them
import { comingPays } from "../analysis/coming.ts";
import { type AnalysisContext, standingById } from "../analysis/context.ts";
import { expectedBillRows } from "../analysis/forecast.ts";
import { cancelledSubjects, isBillSeries, isCancelled } from "../commitments.ts";
import { addDays, addMonths, monthEnd, monthOf } from "../dates.ts";
import { fitsPayment, takenSeries } from "../loan-detect.ts";
import { loanNextPayment, loansOf, typedBill } from "../loans.ts";
import { projectDates, type RecurringSeries } from "../recurring.ts";
import { AHEAD_DAYS } from "../thresholds.ts";
import { type IsoDate, isRevolving, NO_INPUTS, type UserInputs } from "../types.ts";
import { rareOccurrences, rareSeries, rareYear, YEAR_MONTHS } from "./upcoming.ts";

/**
 * "known": a typed-in bill, a fixed-price series or a loan payment of its plan. "estimate": a series whose charges vary,
 * or a pay beyond the next two. "paid": already charged this month, so no part of what is still to come.
 */
type BillState = "known" | "estimate" | "paid";

interface BillRow {
  date: IsoDate;
  /** The merchant, the lender's loan or the payer. */
  payee: string;
  category: string | null;
  /** Positive, whatever the direction: `kind` says it. Never 0: a sum that is not known is no row, it is in `unknownCount`. */
  cents: number;
  state: BillState;
  kind: "bill" | "income" | "loan";
  /** The series the row comes from; null on a typed-in bill and on a loan no series pays. */
  seriesId: string | null;
}

interface BillMonth {
  /** `YYYY-MM`. */
  month: string;
  /** Date ascending; within a day the pay last, the larger first. */
  rows: BillRow[];
  /** What the month's rows of state "known" add up to, bills and loan payments. */
  knownCents: number;
  /** The same for state "estimate". Known and estimate are the month's bills still to pay. */
  estimateCents: number;
  /** The pays of the month, known and estimated. */
  incomeCents: number;
}

interface BillCalendar {
  from: IsoDate;
  /** The last day of the twelfth month. */
  to: IsoDate;
  /** Twelve calendar months from the one of today. */
  months: BillMonth[];
  /** The rare bills of the same twelve months and what to set aside each month for them, as `upcoming` has them. */
  yearlyCents: number;
  reserveMonthlyCents: number;
  /** The bills and loans whose sum or date is not known, so they have no row. */
  unknownCount: number;
}

const byDay = (a: BillRow, b: BillRow) =>
  a.date.localeCompare(b.date) || Number(a.kind === "income") - Number(b.kind === "income") || b.cents - a.cents || a.payee.localeCompare(b.payee);

/**
 * The bills, loan payments and pays of the twelve calendar months from the one of today, a row for each. The bills are
 * the series the history shows (`expectedCharges` as the forecast has them), the bills typed in (`expectedBillRows`) and
 * the plans of the loans typed in; a loan's own series is its row and no row of its own. A series that charges a fixed
 * price is known, one that varies is an estimate: a monthly one with a charge in the same month of last year takes that
 * charge (the winter's electricity), any other its typical one. A charge made this month is a row of state "paid".
 * The bills to the payday that Nyt waits for keep their typical sum, so the rows of those days add up to Nyt's bills.
 *
 * A pay is known as far as `comingPays` finds it (the next two paydays) and a regular monthly pay is estimated beyond
 * that at its typical sum. A pay that is late has no row, and money from people never is one: only a series of an
 * income category is.
 *
 * What is not known has no row: a sum of 0 would pass for a bill that costs nothing. Cards' bills are not here: their
 * sums come from the balance of each card, which this report does not read.
 */
export function billCalendar(ctx: AnalysisContext, inputs: UserInputs = NO_INPUTS): BillCalendar {
  const today = ctx.today;
  const firstMonth = monthOf(today);
  const windowStart = `${firstMonth}-01`;
  const windowEnd = monthEnd(addMonths(firstMonth, YEAR_MONTHS - 1));
  const rows: BillRow[] = [];
  let unknownCount = 0;
  const byId = standingById(ctx);
  const rowsOf = (s: RecurringSeries) => s.transactionIds.flatMap((id) => byId.get(id) ?? []);
  const cancelled = cancelledSubjects(inputs, today);
  const found = comingPays(ctx);
  // the last day of the window Nyt reads (`aheadBasis`): its bills are the series' typical sums
  const nytTo = !found.next ? addDays(today, AHEAD_DAYS) : found.next.day > today ? addDays(found.next.day, -1) : today;

  // the series that pays a loan is the loan's row: the one its key names, or the one whose charges fit its typed payment
  const loans = loansOf(inputs).filter((loan) => !isRevolving(loan.kind));
  const paying = new Map<string, RecurringSeries>();
  for (const loan of loans) {
    const named = loan.seriesKey ? takenSeries({ marks: [], expectedBills: [], loans: [loan] }) : null;
    const bill = typedBill(loan, today);
    const taken = new Set([...paying.values()].map((s) => s.id));
    const s = ctx.recurring.find((c) => c.active && isBillSeries(c) && !taken.has(c.id) && (named ? named(c, rowsOf(c)) : bill !== null && fitsPayment(bill, c, rowsOf(c))));
    if (s) paying.set(loan.id, s);
  }
  const loanSeries = new Set([...paying.values()].map((s) => s.id));

  const sameMonthLastYear = (s: RecurringSeries, month: string): number => {
    const ago = addMonths(month, -YEAR_MONTHS);
    return rowsOf(s).reduce((sum, t) => (monthOf(t.bookingDate) === ago ? sum + Math.abs(t.amountCents) : sum), 0);
  };

  // a rare bill that is a few days late keeps its later dates, as in the year of `upcoming`: it may have stopped, so the late one is no row
  const rare = new Set(rareSeries(ctx).map((s) => s.id));
  for (const s of ctx.recurring) {
    if (loanSeries.has(s.id) || !s.active || (s.overdue && !rare.has(s.id)) || !isBillSeries(s, true) || isCancelled(cancelled, s)) continue;
    const paid = { payee: s.merchant, category: s.category, state: "paid" as const, kind: "bill" as const, seriesId: s.id };
    if (s.lastDate >= windowStart && s.lastAmountCents !== 0) rows.push({ ...paid, date: s.lastDate, cents: Math.abs(s.lastAmountCents) });
    // a bill that a payment from another account settled is paid in the month it fell due
    for (const o of s.settled ?? []) if (o.due >= windowStart && o.due <= windowEnd && s.typicalAmountCents > 0) rows.push({ ...paid, date: o.due, cents: s.typicalAmountCents });
    const dates = projectDates(s, windowEnd).filter((d) => !s.overdue || d >= today);
    if (!dates.length) continue;
    if (s.typicalAmountCents <= 0) {
      unknownCount++;
      continue;
    }
    // a fixed-price series is of kind "subscription" (`isFixedAmount`): any other kind of bill varies
    const varies = s.kind !== "subscription";
    for (const d of dates) {
      // a charge a few days late is expected today
      const date = d < today ? today : d;
      const lastYear = varies && s.cadence === "monthly" && date > nytTo ? sameMonthLastYear(s, monthOf(date)) : 0;
      rows.push({ date, payee: s.merchant, category: s.category, cents: lastYear || s.typicalAmountCents, state: varies ? "estimate" : "known", kind: "bill", seriesId: s.id });
    }
  }

  // a bill typed in under the name of a rare bill the history found is the found one (`ManualBill.counted`)
  const { occurrences, isDuplicate } = rareOccurrences(ctx, inputs);
  for (const b of expectedBillRows(ctx, inputs.expectedBills.filter((e) => !isDuplicate(e.name)), today, windowEnd)) {
    if (b.amountCents <= 0) unknownCount++;
    else rows.push({ date: b.date, payee: b.name, category: b.category, cents: b.amountCents, state: "known", kind: "bill", seriesId: null });
  }

  for (const loan of loans) {
    const series = paying.get(loan.id);
    const first = loanNextPayment(loan, today);
    // nothing is due: the loan is paid, or a bullet that has not reached its day
    if (first.unknown === null && first.cents === null) continue;
    const row = (date: IsoDate, cents: number): BillRow => ({ date, payee: loan.name, category: series?.category ?? null, cents, state: "known", kind: "loan", seriesId: series?.id ?? null });
    if (first.date === null) {
      // no plan places the payment: the series that pays it does, at the typed payment
      const bill = typedBill(loan, today);
      const dates = series && bill !== null ? projectDates(series, windowEnd) : [];
      if (bill === null || !dates.length) unknownCount++;
      else for (const d of dates) rows.push(row(d < today ? today : d, bill));
      continue;
    }
    for (let next = first; next.date !== null && next.date <= windowEnd; next = loanNextPayment(loan, next.date)) {
      if (next.cents === null || next.cents <= 0) {
        unknownCount++;
        break;
      }
      rows.push(row(next.date, next.cents));
    }
  }

  const waited = new Set(found.major.map((p) => p.s));
  for (const { s, expected, dates } of found.pays) {
    if (s.typicalAmountCents <= 0) {
      unknownCount++;
      continue;
    }
    const income = { payee: s.merchant, category: s.category, kind: "income" as const, seriesId: s.id };
    let last: IsoDate | null = null;
    for (const [i, date] of dates.entries()) {
      // a pay to wait for whose day has gone by has not come: it is no row
      if (date > windowEnd || (waited.has(s) && expected[i]! < today)) continue;
      rows.push({ ...income, date, cents: s.typicalAmountCents, state: "known" });
      last = date;
    }
    if (s.cadence !== "monthly") continue;
    // beyond the pays found, a regular pay comes at its typical sum; a day near a known one is that pay itself
    const after = last === null ? today : addDays(last, Math.floor(s.intervalDays / 2));
    for (const d of projectDates(s, windowEnd)) if (d >= today && d > after) rows.push({ ...income, date: d, cents: s.typicalAmountCents, state: "estimate" });
  }

  const months = Array.from({ length: YEAR_MONTHS }, (_, i): BillMonth => {
    const month = addMonths(firstMonth, i);
    const own = rows.filter((r) => monthOf(r.date) === month).sort(byDay);
    const sum = (keep: (r: BillRow) => boolean) => own.reduce((total, r) => (keep(r) ? total + r.cents : total), 0);
    return {
      month,
      rows: own,
      knownCents: sum((r) => r.kind !== "income" && r.state === "known"),
      estimateCents: sum((r) => r.kind !== "income" && r.state === "estimate"),
      incomeCents: sum((r) => r.kind === "income"),
    };
  });
  return { from: today, to: windowEnd, months, ...rareYear(occurrences, today), unknownCount };
}
