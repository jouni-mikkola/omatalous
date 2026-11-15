/**
 * What is coming, as Tulossa lists it (docs/design/README.md 1.3): the charges the series are expected to bring
 * (commitments.ts), the bills the household typed in and the regular income, one row each, from today to the payday
 * after next and grouped by payday period. Each period's sums are its rows added up.
 *
 * The pays to wait for are found here once (`comingPays`), for this list and for the window of `aheadBasis` alike, so
 * both name the same paydays.
 */
import { getCategory } from "../categories.ts";
import { cancelledSubjects, expectedCharges } from "../commitments.ts";
import { addDays, daysBetween } from "../dates.ts";
import { projectDates, type RecurringSeries } from "../recurring.ts";
import { AHEAD_DAYS, MAJOR_PAY_SHARE, MAX_PAYDAY_DAYS, MIN_PAY_GAP_DAYS } from "../thresholds.ts";
import type { IsoDate, UserInputs } from "../types.ts";
import { type AnalysisContext, type AnalysisTx, standingOf } from "./context.ts";
import { expectedBillRows } from "./forecast.ts";
import { nextPayDate, payDayOf } from "./income.ts";

/**
 * The coming pay days of an income series. A monthly salary comes on its pay day as `payDayOf` finds it from the days it
 * was paid on (a nominal day and how a closed day moves it), so one early payday does not move the next one and a
 * weekend or a bank holiday is not a pay day. Other cadences, and a payer with no fixed day, follow the series' own
 * dates. The month of the last pay is tried too: a pay booked late in the next month, or on the Friday before the 1st,
 * leaves that month's pay still to come. A day less than 15 days after the last pay is that pay itself, not the next one.
 */
function payDates(s: RecurringSeries, paidOn: readonly IsoDate[], to: IsoDate): IsoDate[] {
  const pd = s.cadence === "monthly" && s.nextDate ? payDayOf(paidOn) : null;
  if (!pd) return projectDates(s, to);
  const out: IsoDate[] = [];
  for (let d = nextPayDate(s.lastDate, pd); d <= to; d = nextPayDate(d, pd)) {
    if (daysBetween(s.lastDate, d) >= MIN_PAY_GAP_DAYS) out.push(d);
  }
  return out;
}

/** An income that is not late, with its coming pay days. */
interface ComingPay {
  s: RecurringSeries;
  /** The days it was paid on. */
  past: IsoDate[];
  /** Its pay days as far as two paydays reach; the first may be a day gone by, of a pay that is not late yet. */
  expected: IsoDate[];
  /** The same days as rows: a day gone by is today. */
  dates: IsoDate[];
}

interface ComingPays {
  /** The regular incomes, a late one included. */
  incomes: RecurringSeries[];
  /** The largest of them; of two equal usual amounts the first one listed. */
  top: RecurringSeries | null;
  /** The rows of the incomes, by id. */
  rowsOf: Map<string, AnalysisTx>;
  /** A late income is no row and no payday to wait for. */
  pays: ComingPay[];
  /** The pays to wait for: at least `MAJOR_PAY_SHARE` of the largest income; the larger first. */
  major: ComingPay[];
  /** The nearest pay among them whose day is still to come, at most `MAX_PAYDAY_DAYS` away: the payday, whatever else is late or behind. */
  next: { s: RecurringSeries; past: IsoDate[]; day: IsoDate } | null;
}

/** The incomes and their coming pay days, as far as two paydays reach (each at most `MAX_PAYDAY_DAYS` after the one before). */
export function comingPays(ctx: AnalysisContext): ComingPays {
  const from = ctx.today;
  const incomes = ctx.recurring.filter((s) => s.kind === "income" && s.active && getCategory(s.category).kind === "income");
  const top = incomes.reduce<RecurringSeries | null>((best, s) => (!best || s.typicalAmountCents > best.typicalAmountCents ? s : best), null);
  const wanted = new Set(incomes.flatMap((s) => s.transactionIds));
  const rowsOf = new Map<string, AnalysisTx>();
  for (const t of standingOf(ctx).txs) if (wanted.has(t.id)) rowsOf.set(t.id, t);
  const reach = addDays(from, 2 * MAX_PAYDAY_DAYS);
  const pays = incomes
    .filter((s) => !s.overdue)
    .map((s) => {
      const past = s.transactionIds.map((id) => rowsOf.get(id)?.bookingDate).filter((d): d is IsoDate => !!d);
      const expected = payDates(s, past, reach);
      return { s, past, expected, dates: expected.map((d) => (d < from ? from : d)) };
    });
  const major = (top ? pays.filter((p) => p.s.typicalAmountCents >= top.typicalAmountCents * MAJOR_PAY_SHARE) : []).sort((a, b) => b.s.typicalAmountCents - a.s.typicalAmountCents);
  const near = addDays(from, MAX_PAYDAY_DAYS);
  const [next = null] = major.flatMap((p) => p.expected.filter((d) => d >= from && d <= near).slice(0, 1).map((day) => ({ s: p.s, past: p.past, day }))).sort((a, b) => a.day.localeCompare(b.day));
  return { incomes, top, rowsOf, pays, major, next };
}

interface ComingRow {
  date: IsoDate;
  /** The merchant, the payer, or the name the household gave the bill. */
  name: string;
  category: string | null;
  /** Money in is positive (an income at its usual amount), a bill negative. */
  cents: number;
  /** "income": a regular income. "recurring": a subscription, bill or monthly saving the history shows. "expected": a bill the household typed in. */
  source: "income" | "recurring" | "expected";
  /** On a "recurring" row: what the series charged last, positive, to compare the bill against. Null on any other. */
  lastCents: number | null;
}

export interface ComingPeriod {
  from: IsoDate;
  /** The last day: the payday that ends the period, which is a row of it. */
  to: IsoDate;
  /** Null when no pay ends the period: it is the 30 days then. */
  payday: IsoDate | null;
  /** Date ascending; within a day money in last, the larger first. */
  rows: ComingRow[];
  /** What the bills of the rows add up to, positive. */
  billsCents: number;
  /** What the income of the rows adds up to. */
  incomeCents: number;
}

const byDay = (a: ComingRow, b: ComingRow) =>
  a.date.localeCompare(b.date) || Number(a.cents > 0) - Number(b.cents > 0) || Math.abs(b.cents) - Math.abs(a.cents) || a.name.localeCompare(b.name);

/**
 * The coming list: at most two periods, the first from today to the next payday and the second from the day after it to
 * the payday after next. The first payday is the one the window of `aheadBasis` waits for (`found.next`; `found` is
 * the pays of `aheadBasis` when it has them), the second the next day of a pay to wait for, at most `MAX_PAYDAY_DAYS`
 * later. A child benefit ends no period. Without a payday it is one period of 30 days.
 *
 * The rows are those of the window of `aheadBasis`, of every account: a pay to wait for whose day has gone by has not
 * come, so it is no row and ends no period, while any other income or charge a few days late is expected today. A
 * monthly saving is a row. A typed-in bill that was paid, or that a series carries, is left out (`expectedBillRows`),
 * and so is what the household marked as cancelled.
 */
export function comingList(ctx: AnalysisContext, inputs: UserInputs, found: ComingPays = comingPays(ctx)): ComingPeriod[] {
  const today = ctx.today;
  const waited = new Set(found.major.map((p) => p.s));
  const first = found.next?.day;
  const second = first && found.major.flatMap((p) => p.expected.filter((d) => d > first && d <= addDays(first, MAX_PAYDAY_DAYS))).sort()[0];
  const paydays = [first, second].filter((d): d is IsoDate => !!d);
  const until = paydays.at(-1) ?? addDays(today, AHEAD_DAYS);

  const rows: ComingRow[] = [];
  for (const { s, expected, dates } of found.pays) {
    dates.forEach((date, i) => {
      if (date > until || (waited.has(s) && expected[i]! < today)) return;
      rows.push({ date, name: s.merchant, category: s.category, cents: s.typicalAmountCents, source: "income", lastCents: null });
    });
  }
  const opts = { cancelled: cancelledSubjects(inputs, today), savings: true };
  // a series at a time: a charge does not name its series, and the row has the series' last amount
  for (const s of ctx.recurring) {
    for (const c of expectedCharges([s], today, until, opts)) rows.push({ date: c.date, name: c.merchant, category: c.category, cents: -c.amountCents, source: "recurring", lastCents: s.lastAmountCents });
  }
  for (const b of expectedBillRows(ctx, inputs.expectedBills, today, until)) rows.push({ date: b.date, name: b.name, category: b.category, cents: -b.amountCents, source: "expected", lastCents: null });
  rows.sort(byDay);

  const period = (from: IsoDate, to: IsoDate, payday: IsoDate | null): ComingPeriod => {
    const own = rows.filter((r) => r.date >= from && r.date <= to);
    const sum = (keep: (r: ComingRow) => boolean) => own.reduce((total, r) => (keep(r) ? total + Math.abs(r.cents) : total), 0);
    return { from, to, payday, rows: own, billsCents: sum((r) => r.cents < 0), incomeCents: sum((r) => r.cents > 0) };
  };
  if (!paydays.length) return [period(today, until, null)];
  return paydays.map((payday, i) => period(i === 0 ? today : addDays(paydays[0]!, 1), payday, payday));
}
