// Decision: which bills and pays fall in each of the next twelve months, and what the household needs to have set aside for them
import { aheadBasis } from "../analysis/ahead.ts";
import { comingPays, payDates } from "../analysis/coming.ts";
import { type AnalysisContext, standingById } from "../analysis/context.ts";
import { expectedBillRows } from "../analysis/forecast.ts";
import { poolOf } from "../analysis/pool.ts";
import { rareOccurrences, rareSeries, rareYearCounted } from "../analysis/rare-bills.ts";
import { getCategory } from "../categories.ts";
import { cancelledSubjects, expectedCharges, isBillSeries, isCancelled } from "../commitments.ts";
import { COST_KINDS, type CostKind, costKindOf } from "../cost-kinds.ts";
import { addDays, addMonths, monthEnd, monthOf } from "../dates.ts";
import { fitsPayment, takenSeries } from "../loan-detect.ts";
import { loanRateLine } from "../loan-schedule.ts";
import { loanBalanceOn, loanNextPayment, loansOf, typedBill } from "../loans.ts";
import { parseSeriesId, projectDates, type RecurringSeries } from "../recurring.ts";
import { AHEAD_DAYS, YEAR_MONTHS } from "../thresholds.ts";
import { type BalanceInput, type IsoDate, isRevolving, NO_INPUTS, type UserInputs } from "../types.ts";
import { type UnknownSum, unknownsIn } from "../unknown-sums.ts";

/**
 * "known": a typed-in bill, a fixed-price series, a loan payment of its plan or a card's bill of its balance. "estimate":
 * a series whose charges vary, a loan payment counted at a rate that is set after today (the newest published fixing and the
 * margin), or a pay beyond the next two. "paid": already charged this month, so no part of what is
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
  /** A bill of the rare ones the year's figure adds up (`rareSeries` and the typed-in bills of `rareOccurrences`): the part of a month `lessOftenCents` holds. */
  rare?: true;
  /**
   * A card, or an account the balance does not count, pays it: no account the balance counts is charged, so it is in no
   * sum of the month (a card's bill holds it, as Nyt takes it).
   */
  onCard?: true;
  /**
   * A saved loan's key names the series (`takenSeries`), a credit line's too: the series is the loan's payment and no bill
   * the household can take off the list. Only on a series' row; a loan whose plan is its row is of kind "loan".
   */
  loanSeries?: true;
  /** A bullet loan's whole balance falling due on its end date: a row of the loan though the series that pays its interest is named, and no charge of that series. */
  lump?: true;
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
  /** The regular saving already charged this month (state "paid"), the ones on a card left out: what `paidCents` is to the bills. 0 in a month to come. */
  savingPaidCents: number;
  /** The pays of the month, known and estimated. */
  incomeCents: number;
  /** The month's bills still to pay, known and estimated: `knownCents` and `estimateCents` together. */
  billsCents: number;
  /** The bills and loan payments already charged this month (state "paid"), the ones on a card left out: in no sum above, so the running month's head tells them next to `billsCents`. 0 in a month to come. */
  paidCents: number;
  /** How many bills and loan payments `paidCents` adds up. */
  paidCount: number;
  /** The rare bills (`rare` rows) among `paidCents`; with `paidRegularCents` it is `paidCents`, to the cent. */
  paidLessOftenCents: number;
  /** The paid bills that are not rare: `paidCents` less `paidLessOftenCents`. */
  paidRegularCents: number;
  /** The month's bills and loan payments, paid and still to pay: `paidCents` and `billsCents` together, the whole height of the month's column in the chart. */
  wholeBillsCents: number;
  /**
   * `billsCents` by what the bills are for (`costKindOf`): the four add up to it, to the cent. A bill whose sum is not known is in none of
   * them, as it is in no `billsCents`; the month's count of those is `unknownsIn`.
   */
  essentialCents: number;
  debtCents: number;
  contractCents: number;
  optionalCents: number;
  /**
   * The pays less the bills and the regular saving still to come. Null while a sum of this month is not known (`unknownMarks` of the
   * calendar: a bill, a saving or a pay of this month, or one with no day) and while no pay is found at all, since an income that is not
   * known is no income of 0. A month with no pay, in a household with pays, is below 0. The months are not added up: a bill with no sum in
   * one month leaves the others their figure.
   */
  afterCents: number | null;
  /** The rows of `monthly` that are bills or loan payments still to pay, not on a card: how many, and what they add up to. */
  monthlyBillsCount: number;
  monthlyBillsCents: number;
  /** The month's rare bills still to pay (`rare` rows, not on a card): the part of `yearlyCents` that falls in the month, less what is paid. */
  lessOftenCents: number;
  /** The rest of `billsCents`: the regular bills and loan payments, and the next bill of a card. With `lessOftenCents` it is `billsCents`, to the cent. */
  regularCents: number;
  /** `billsCents` by day, date ascending, only the days with a bill still to pay: the days of the picked month's strip. Their sum is `billsCents`. */
  billDays: { date: IsoDate; cents: number }[];
}

interface BillCalendar {
  from: IsoDate;
  /** The last day of the twelfth month. */
  to: IsoDate;
  /** Twelve calendar months from the one of today. */
  months: BillMonth[];
  /** The bills still to pay of the twelve months, the months' `billsCents` together. */
  billsCents: number;
  /** The month after today's, whose bills are all still to come. Null when it has no bills. */
  next: { month: string; billsCents: number } | null;
  /**
   * The rare bills of the same twelve months and what to set aside each month for them. As `billsCents` does, it leaves out a bill that
   * a card or an account the balance does not count pays (the card's own bill is a row of the months), and it keeps a bill paid this month.
   */
  yearlyCents: number;
  reserveMonthlyCents: number;
  /** The bills and loans whose sum or date is not known, so they have no row: `unknowns` counted. */
  unknownCount: number;
  unknowns: UnknownSum[];
}

/**
 * Whether a bill, loan payment or saving whose sum is not known may fall on or before `last`: one with no day may, as may a dated one.
 * A card's or an outside account's is no payment of the balance, and a pay that is not known cannot lower it, so neither counts.
 */
export const unknownPaymentBy = (calendar: Pick<BillCalendar, "unknowns">, last: IsoDate): boolean =>
  calendar.unknowns.some((u) => !u.onCard && u.kind !== "income" && (u.days.length === 0 || u.days.some((d) => d <= last)));

export const byDay = (a: BillRow, b: BillRow) =>
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
  const unknowns: UnknownSum[] = [];
  const byId = standingById(ctx);
  const rowsOf = (s: RecurringSeries) => s.transactionIds.flatMap((id) => byId.get(id) ?? []);
  const cancelled = cancelledSubjects(inputs, today);
  const found = comingPays(ctx);
  // the last day of the window Nyt reads (`aheadBasis`): its bills are the series' typical sums
  const nytTo = !found.next ? addDays(today, AHEAD_DAYS) : found.next.day > today ? addDays(found.next.day, -1) : today;
  // the accounts the balance counts; with none in view nothing is left out, as in `aheadBasis`
  const counted = poolOf(balances).ids;
  const paidElsewhere = (seriesId: string): boolean => counted.size > 0 && !counted.has(parseSeriesId(seriesId)?.accountId ?? "");
  const offOf = (s: RecurringSeries): Pick<BillRow, "onCard"> => (paidElsewhere(s.id) ? { onCard: true } : {});

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
  const payingIds = new Set([...paying.values()].map((s) => s.id));
  // the keys of every saved loan, the revolving ones too, which have no plan and so no row of their own
  const namedByLoan = takenSeries({ ...inputs, marks: [] });

  // the largest charge of the month a year ago: the months of one bill do not add up
  const sameMonthLastYear = (s: RecurringSeries, month: string): number => {
    const ago = addMonths(month, -YEAR_MONTHS);
    return rowsOf(s).reduce((most, t) => (monthOf(t.bookingDate) === ago ? Math.max(most, Math.abs(t.amountCents)) : most), 0);
  };

  // a rare bill that is a few days late keeps its later dates, as in the year of `upcoming`: it may have stopped, so the late one is no row
  const rare = new Set(rareSeries(ctx).map((s) => s.id));
  for (const s of ctx.recurring) {
    if (payingIds.has(s.id) || !s.active || (s.overdue && !rare.has(s.id)) || s.category === "card_bill" || !isBillSeries(s, true) || isCancelled(cancelled, s)) continue;
    const base = {
      payee: s.merchant,
      category: s.category,
      kind: getCategory(s.category).kind === "savings" ? ("saving" as const) : ("bill" as const),
      seriesId: s.id,
      ...(s.cadence === "monthly" ? { monthly: true as const } : {}),
      ...(rare.has(s.id) ? { rare: true as const } : {}),
      ...offOf(s),
      ...(namedByLoan(s, rowsOf(s)) ? { loanSeries: true as const } : {}),
    };
    if (s.lastDate >= windowStart && s.lastAmountCents !== 0) rows.push({ ...base, state: "paid", date: s.lastDate, cents: Math.abs(s.lastAmountCents) });
    // a bill that a payment from another account settled is paid in the month it fell due
    for (const o of s.settled ?? []) if (o.due >= windowStart && o.due <= windowEnd && s.typicalAmountCents > 0) rows.push({ ...base, state: "paid", date: o.due, cents: s.typicalAmountCents });
    const dates = projectDates(s, windowEnd).filter((d) => !s.overdue || d >= today);
    if (!dates.length) continue;
    if (s.typicalAmountCents <= 0) {
      unknowns.push({ days: dates.map((d) => (d < today ? today : d)), open: false, kind: base.kind, onCard: paidElsewhere(s.id) });
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
    if (b.amountCents <= 0) unknowns.push({ days: [b.date], open: false, kind: "bill", onCard: false });
    else rows.push({ date: b.date, payee: b.name, category: b.category, cents: b.amountCents, state: "known", kind: "bill", seriesId: null, rare: true });
  }

  // the next bill of a card whose balance is known, as the window of Nyt has it; the bills after it are the card's spending
  if (balances.some((b) => b.type === "credit_card")) {
    for (const r of aheadBasis(ctx, balances, inputs).ahead.upcoming) {
      // the row of the window says "transfer", a category no cost kind knows: the card's bill is debt service
      if (r.source === "card" && r.basis === "balance" && r.cents && r.date <= windowEnd) rows.push({ date: r.date, payee: r.name, category: "card_bill", cents: Math.abs(r.cents), state: "known", kind: "bill", seriesId: null });
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
        if (owed === null) unknowns.push({ days: [loan.endDate], open: false, kind: "loan", onCard: series ? paidElsewhere(series.id) : false });
        // the lump sum is no monthly bill, whatever the cadence of the interest series that pays the loan
        else if (owed > 0) rows.push({ ...row(loan.endDate, owed, "known", false), lump: true });
      }
      continue;
    }
    const first = loanNextPayment(loan, today);
    // the next day the bank sets the rate again: a payment whose interval starts on or after it is counted at the newest fixing
    // and the margin (the loan's rate path), so it is an estimate. A loan with no path keeps its typed rate.
    const review = loan.ratePath === undefined ? null : (loanRateLine(loan, today)?.reviewDate ?? null);
    // nothing is due: the loan is paid
    if (first.unknown === null && first.cents === null) continue;
    if (first.date === null) {
      // no plan places the payment: the series that pays it does, at the typed payment
      const bill = typedBill(loan, today);
      const dates = series && bill !== null ? projectDates(series, windowEnd) : [];
      if (bill === null || !dates.length) unknowns.push({ days: [], open: false, kind: "loan", onCard: series ? paidElsewhere(series.id) : false });
      else for (const d of dates) rows.push(row(d < today ? today : d, bill));
      continue;
    }
    if (series) {
      // the series that pays the loan has the bank's real days and sums (as the runway takes them): they are the rows, up to the
      // loan's end date or, with none, the plan's last due date
      let last: IsoDate | null = loan.endDate;
      if (last === null) {
        let end: IsoDate = first.date;
        for (let next = loanNextPayment(loan, first.date); next.date !== null && next.date <= windowEnd; next = loanNextPayment(loan, next.date)) end = next.date;
        if (loanNextPayment(loan, end).date === null) last = end;
      }
      const state = series.kind === "subscription" ? "known" : "estimate";
      for (const c of expectedCharges([series], today, windowEnd, { cancelled, savings: true })) {
        if (last !== null && c.date > last) continue;
        if (c.amountCents <= 0) unknowns.push({ days: [c.date], open: false, kind: "loan", onCard: paidElsewhere(series.id) });
        else rows.push(row(c.date, c.amountCents, state));
      }
      continue;
    }
    // the due date before the payment: where its interval starts, and so which rate counts. The first payment's started on or before today.
    let intervalStart: IsoDate | null = null;
    for (let next = first; next.date !== null && next.date <= windowEnd; next = loanNextPayment(loan, next.date)) {
      const started = intervalStart;
      intervalStart = next.date;
      if (paidNow && monthOf(next.date) === firstMonth) continue;
      if (next.cents === null || next.cents <= 0) {
        unknowns.push({ days: [next.date], open: true, kind: "loan", onCard: series ? paidElsewhere(series.id) : false });
        break;
      }
      rows.push(row(next.date, next.cents, review !== null && started !== null && started >= review ? "estimate" : "known", next.intervalMonths === 1));
    }
  }

  const waited = new Set(found.major.map((p) => p.s));
  for (const { s, past, expected, dates } of found.pays) {
    if (s.typicalAmountCents <= 0) {
      unknowns.push({ days: dates, open: true, kind: "income", onCard: false });
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
    const kindCents = (kind: CostKind) => sum((r) => (bill(r, "known") || bill(r, "estimate")) && costKindOf(r.category, r.kind === "loan") === kind);
    const [essentialCents, debtCents, contractCents, optionalCents] = COST_KINDS.map(kindCents) as [number, number, number, number];
    const paidBill = (r: BillRow) => (r.kind === "bill" || r.kind === "loan") && r.state === "paid" && !r.onCard;
    const paidCents = sum(paidBill);
    const paidLessOftenCents = sum((r) => paidBill(r) && r.rare === true);
    const paidCount = count(paidBill);
    const savingCents = sum(saving);
    const savingPaidCents = sum((r) => r.kind === "saving" && r.state === "paid" && !r.onCard);
    const incomeCents = sum((r) => r.kind === "income");
    return {
      month,
      rows: own,
      knownCents,
      estimateCents,
      savingCents,
      savingPaidCents,
      incomeCents,
      billsCents: knownCents + estimateCents,
      paidCents,
      paidCount,
      paidLessOftenCents,
      paidRegularCents: paidCents - paidLessOftenCents,
      wholeBillsCents: paidCents + knownCents + estimateCents,
      essentialCents,
      debtCents,
      contractCents,
      optionalCents,
      afterCents: found.pays.length === 0 || unknownsIn(unknowns, month) > 0 ? null : incomeCents - knownCents - estimateCents - savingCents,
      monthlyBillsCount: count((r) => r.monthly === true && toPay(r) && !r.onCard),
      monthlyBillsCents: sum((r) => r.monthly === true && toPay(r) && !r.onCard),
      lessOftenCents: sum((r) => r.rare === true && toPay(r) && !r.onCard),
      regularCents: sum((r) => r.rare !== true && toPay(r) && !r.onCard),
      billDays: [...new Set(own.filter((r) => toPay(r) && !r.onCard).map((r) => r.date))].map((date) => ({ date, cents: sum((r) => toPay(r) && !r.onCard && r.date === date) })),
    };
  });
  const billsCents = months.reduce((total, m) => total + m.billsCents, 0);
  const following = months[1]!;
  return {
    from: today,
    to: windowEnd,
    months,
    billsCents,
    next: following.billsCents > 0 ? { month: following.month, billsCents: following.billsCents } : null,
    ...rareYearCounted(occurrences, today, balances),
    unknownCount: unknowns.length,
    unknowns,
  };
}
