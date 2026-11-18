// Decision: which bills and pays fall in each of the next twelve months, and what the household needs to have set aside for them
import { aheadBasis } from "../analysis/ahead.ts";
import { comingPays, payDates } from "../analysis/coming.ts";
import { type AnalysisContext, standingById } from "../analysis/context.ts";
import { expectedBillRows } from "../analysis/forecast.ts";
import { poolOf } from "../analysis/pool.ts";
import { rareOccurrences, rareSeries, rareYear } from "../analysis/rare-bills.ts";
import { getCategory } from "../categories.ts";
import { cancelledSubjects, isBillSeries, isCancelled } from "../commitments.ts";
import { addDays, addMonths, monthEnd, monthOf } from "../dates.ts";
import { fitsPayment, takenSeries } from "../loan-detect.ts";
import { loanBalanceOn, loanNextPayment, loansOf, typedBill } from "../loans.ts";
import { parseSeriesId, projectDates, type RecurringSeries } from "../recurring.ts";
import { AHEAD_DAYS, YEAR_MONTHS } from "../thresholds.ts";
import { type BalanceInput, type IsoDate, isRevolving, NO_INPUTS, type UserInputs } from "../types.ts";

/**
 * "known": a typed-in bill, a fixed-price series, a loan payment of its plan or a card's bill of its balance. "estimate":
 * a series whose charges vary, or a pay beyond the next two. "paid": already charged this month, so no part of what is
 * still to come.
 */
type BillState = "known" | "estimate" | "paid";

interface BillRow {
  date: IsoDate;
  /** The merchant, the lender's loan, the card or the payer. */
  payee: string;
  category: string | null;
  /** Positive, whatever the direction: `kind` says it. Never 0: a sum that is not known is no row, it is in `unknownCount`. */
  cents: number;
  state: BillState;
  /** "saving": a regular saving, which leaves the account but is no bill. */
  kind: "bill" | "income" | "loan" | "saving";
  /** The series the row comes from; null on a typed-in bill, a card's bill and a loan no series pays. */
  seriesId: string | null;
  /** A bill, loan payment or saving that comes every month: a series of a monthly cadence, or a plan that pays each month. A long view folds these. */
  monthly?: true;
  /**
   * A card, or an account the balance does not count, pays it: no account the balance counts is charged, so it is in no
   * sum of the month (a card's bill holds it, as Nyt takes it).
   */
  onCard?: true;
}

interface BillMonth {
  /** `YYYY-MM`. */
  month: string;
  /** Date ascending; within a day the pay last, the larger first. */
  rows: BillRow[];
  /** What the month's rows of state "known" add up to, bills and loan payments, the ones on a card left out. */
  knownCents: number;
  /** The same for state "estimate". Known and estimate are the month's bills still to pay. */
  estimateCents: number;
  /** The regular saving still to come, known and estimated: no bill, so it is in neither sum above. */
  savingCents: number;
  /** The pays of the month, known and estimated. */
  incomeCents: number;
  /** The month's bills still to pay, known and estimated: `knownCents` and `estimateCents` together. */
  billsCents: number;
  /** The pays less the bills and the regular saving still to come. Null while a bill's sum is not known (`unknownCount`): that is not a figure of 0. */
  afterCents: number | null;
  /** The rows of `monthly` that are bills or loan payments still to pay, not on a card: how many, and what they add up to. */
  monthlyBillsCount: number;
  monthlyBillsCents: number;
}

interface BillCalendar {
  from: IsoDate;
  /** The last day of the twelfth month. */
  to: IsoDate;
  /** Twelve calendar months from the one of today. */
  months: BillMonth[];
  /** The bills still to pay of the twelve months, the months' `billsCents` together. */
  billsCents: number;
  /** The rare bills of the same twelve months, whichever account pays them, and what to set aside each month for them, as `upcoming` has them. */
  yearlyCents: number;
  reserveMonthlyCents: number;
  /** The bills and loans whose sum or date is not known, so they have no row. */
  unknownCount: number;
}

const byDay = (a: BillRow, b: BillRow) =>
  a.date.localeCompare(b.date) || Number(a.kind === "income") - Number(b.kind === "income") || b.cents - a.cents || a.payee.localeCompare(b.payee);

/**
 * The bills, loan payments and pays of the twelve calendar months from the one of today, a row for each. The bills are
 * the series the history shows (`expectedCharges` as the forecast has them), the bills typed in (`expectedBillRows`),
 * the plans of the loans typed in and the next bill of a connected card whose balance is known; a loan's own series is its
 * row and no row of its own. A card's bill that a series of category `card_bill` shows is no row: it is the spending of
 * the card, and the next bill is the card's own row. A series that charges a fixed price is known, one that varies is an
 * estimate: a monthly one with a charge in the same month of last year takes the largest of them (the winter's electricity),
 * any other its typical one. A charge made this month is a row of state "paid". The bills to the payday that Nyt waits for
 * keep their typical sum, so the rows of those days add up to Nyt's bills (see MONEY_FLOWS.md for what Nyt holds besides).
 *
 * With the balances the accounts the balance counts are those of `aheadBasis` (`poolOf`): a series charged to a card or to
 * another account is a row marked `onCard`, in no sum of the month. Without them every account counts.
 *
 * A pay is known as far as `comingPays` finds it (the next two paydays) and beyond that it comes at its typical sum, on the
 * days its cadence and pay day give (`payDates`). A pay that is late has no row, and money from people never is one: only a
 * series of an income category is.
 *
 * What is not known has no row: a sum of 0 would pass for a bill that costs nothing. The bills of a card beyond its next
 * one are the card's spending, not bills.
 */
export function billCalendar(ctx: AnalysisContext, inputs: UserInputs = NO_INPUTS, balances: readonly BalanceInput[] = []): BillCalendar {
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
  // the accounts the balance counts; with none in view nothing is left out, as in `aheadBasis`
  const counted = poolOf(balances).ids;
  const offOf = (s: RecurringSeries): Pick<BillRow, "onCard"> => (counted.size && !counted.has(parseSeriesId(s.id)?.accountId ?? "") ? { onCard: true } : {});

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

  // the largest charge of the month a year ago: the months of one bill do not add up
  const sameMonthLastYear = (s: RecurringSeries, month: string): number => {
    const ago = addMonths(month, -YEAR_MONTHS);
    return rowsOf(s).reduce((most, t) => (monthOf(t.bookingDate) === ago ? Math.max(most, Math.abs(t.amountCents)) : most), 0);
  };

  // a rare bill that is a few days late keeps its later dates, as in the year of `upcoming`: it may have stopped, so the late one is no row
  const rare = new Set(rareSeries(ctx).map((s) => s.id));
  for (const s of ctx.recurring) {
    if (loanSeries.has(s.id) || !s.active || (s.overdue && !rare.has(s.id)) || s.category === "card_bill" || !isBillSeries(s, true) || isCancelled(cancelled, s)) continue;
    const base = {
      payee: s.merchant,
      category: s.category,
      kind: getCategory(s.category).kind === "savings" ? ("saving" as const) : ("bill" as const),
      seriesId: s.id,
      ...(s.cadence === "monthly" ? { monthly: true as const } : {}),
      ...offOf(s),
    };
    if (s.lastDate >= windowStart && s.lastAmountCents !== 0) rows.push({ ...base, state: "paid", date: s.lastDate, cents: Math.abs(s.lastAmountCents) });
    // a bill that a payment from another account settled is paid in the month it fell due
    for (const o of s.settled ?? []) if (o.due >= windowStart && o.due <= windowEnd && s.typicalAmountCents > 0) rows.push({ ...base, state: "paid", date: o.due, cents: s.typicalAmountCents });
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
      rows.push({ ...base, date, cents: lastYear || s.typicalAmountCents, state: varies ? "estimate" : "known" });
    }
  }

  // a bill typed in under the name of a rare bill the history found is the found one (`ManualBill.counted`)
  const { occurrences, isDuplicate } = rareOccurrences(ctx, inputs);
  for (const b of expectedBillRows(ctx, inputs.expectedBills.filter((e) => !isDuplicate(e.name)), today, windowEnd)) {
    if (b.amountCents <= 0) unknownCount++;
    else rows.push({ date: b.date, payee: b.name, category: b.category, cents: b.amountCents, state: "known", kind: "bill", seriesId: null });
  }

  // the next bill of a card whose balance is known, as the window of Nyt has it; the bills after it are the card's spending
  if (balances.some((b) => b.type === "credit_card")) {
    for (const r of aheadBasis(ctx, balances, inputs).ahead.upcoming) {
      if (r.source === "card" && r.basis === "balance" && r.cents && r.date <= windowEnd) rows.push({ date: r.date, payee: r.name, category: r.category, cents: Math.abs(r.cents), state: "known", kind: "bill", seriesId: null });
    }
  }

  for (const loan of loans) {
    const series = paying.get(loan.id);
    const row = (date: IsoDate, cents: number, state: BillState = "known", monthly = series?.cadence === "monthly"): BillRow => ({
      date, payee: loan.name, category: series?.category ?? null, cents, state, kind: "loan", seriesId: series?.id ?? null, ...(monthly ? { monthly: true as const } : {}), ...(series ? offOf(series) : {}),
    });
    // the series charged this month: that is the month's payment, so the plan's payment of the month is no second row
    const paidNow = series !== undefined && series.lastDate >= windowStart && series.lastAmountCents !== 0;
    if (paidNow) rows.push(row(series.lastDate, Math.abs(series.lastAmountCents), "paid"));
    if (loan.repayment === "bullet") {
      // the whole balance falls due on the last day; a bullet with no day, or a day past, has nothing in these months
      if (loan.endDate !== null && loan.endDate >= today && loan.endDate <= windowEnd && loan.endDate > loan.balanceDate) {
        const owed = loanBalanceOn(loan, addDays(loan.endDate, -1)).cents;
        if (owed === null) unknownCount++;
        else if (owed > 0) rows.push(row(loan.endDate, owed));
      }
      continue;
    }
    const first = loanNextPayment(loan, today);
    // nothing is due: the loan is paid
    if (first.unknown === null && first.cents === null) continue;
    if (first.date === null) {
      // no plan places the payment: the series that pays it does, at the typed payment
      const bill = typedBill(loan, today);
      const dates = series && bill !== null ? projectDates(series, windowEnd) : [];
      if (bill === null || !dates.length) unknownCount++;
      else for (const d of dates) rows.push(row(d < today ? today : d, bill));
      continue;
    }
    for (let next = first; next.date !== null && next.date <= windowEnd; next = loanNextPayment(loan, next.date)) {
      if (paidNow && monthOf(next.date) === firstMonth) continue;
      if (next.cents === null || next.cents <= 0) {
        unknownCount++;
        break;
      }
      rows.push(row(next.date, next.cents, "known", next.intervalMonths === 1));
    }
  }

  const waited = new Set(found.major.map((p) => p.s));
  for (const { s, past, expected, dates } of found.pays) {
    if (s.typicalAmountCents <= 0) {
      unknownCount++;
      continue;
    }
    const income = { payee: s.merchant, category: s.category, kind: "income" as const, seriesId: s.id };
    for (const [i, date] of dates.entries()) {
      // a pay to wait for whose day has gone by has not come: it is no row
      if (date > windowEnd || (waited.has(s) && expected[i]! < today)) continue;
      rows.push({ ...income, date, cents: s.typicalAmountCents, state: "known" });
    }
    // beyond the pays found, a regular pay comes at its typical sum, on the days of the same rule
    const reached = expected.at(-1) ?? today;
    for (const d of payDates(s, past, windowEnd)) if (d > reached) rows.push({ ...income, date: d, cents: s.typicalAmountCents, state: "estimate" });
  }

  const months = Array.from({ length: YEAR_MONTHS }, (_, i): BillMonth => {
    const month = addMonths(firstMonth, i);
    const own = rows.filter((r) => monthOf(r.date) === month).sort(byDay);
    const sum = (keep: (r: BillRow) => boolean) => own.reduce((total, r) => (keep(r) ? total + r.cents : total), 0);
    const count = (keep: (r: BillRow) => boolean) => own.filter(keep).length;
    const bill = (r: BillRow, state: BillState) => (r.kind === "bill" || r.kind === "loan") && r.state === state && !r.onCard;
    const toPay = (r: BillRow) => (r.kind === "bill" || r.kind === "loan") && r.state !== "paid";
    const saving = (r: BillRow) => r.kind === "saving" && r.state !== "paid" && !r.onCard;
    const knownCents = sum((r) => bill(r, "known"));
    const estimateCents = sum((r) => bill(r, "estimate"));
    const savingCents = sum(saving);
    const incomeCents = sum((r) => r.kind === "income");
    return {
      month,
      rows: own,
      knownCents,
      estimateCents,
      savingCents,
      incomeCents,
      billsCents: knownCents + estimateCents,
      afterCents: unknownCount > 0 ? null : incomeCents - knownCents - estimateCents - savingCents,
      monthlyBillsCount: count((r) => r.monthly === true && toPay(r) && !r.onCard),
      monthlyBillsCents: sum((r) => r.monthly === true && toPay(r) && !r.onCard),
    };
  });
  const billsCents = months.reduce((total, m) => total + m.billsCents, 0);
  return { from: today, to: windowEnd, months, billsCents, ...rareYear(occurrences, today), unknownCount };
}
