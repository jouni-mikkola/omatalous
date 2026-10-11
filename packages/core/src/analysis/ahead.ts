/**
 * Decision: when to move money to the checking account before pay day.
 *
 * The next 30 days as the forecast expects them: pay days, subscriptions and bills, the bills the household typed in,
 * and with a checking balance the balance each day after the usual everyday spending.
 */
import { getCategory } from "../categories.ts";
import { cancelledMerchants, expectedCharges } from "../commitments.ts";
import { addDays, dateIn, fromMonthIndex, monthIndex, monthOf, weekdayOf } from "../dates.ts";
import { projectDates, type RecurringSeries } from "../recurring.ts";
import { median } from "../stats.ts";
import type { BalanceInput, IsoDate, UserInputs } from "../types.ts";
import type { AnalysisContext } from "./context.ts";
import { everydayPerDay, expectedBillRows } from "./forecast.ts";
import { completeMonthsBefore } from "./usual.ts";

/** How many days after today the list and the balance run. */
export const AHEAD_DAYS = 30;

export interface AheadRow {
  date: IsoDate;
  /** The merchant, or the name the household gave the bill. */
  name: string;
  category: string | null;
  /** Money in is positive, bills and subscriptions negative. */
  cents: number;
  /** "income": a pay day. "recurring": a subscription or bill the history shows. "expected": a bill the household typed in. */
  source: "income" | "recurring" | "expected";
}

export interface AheadBalance {
  /** What the checking accounts in view hold now. */
  startCents: number;
  /** How many checking accounts it adds up, and the oldest time one of their balances was given (ISO), null when unknown. */
  accounts: number;
  balanceAt: string | null;
  /** The balance at the end of each day from today to the last day, after the rows and the usual everyday spending. */
  days: { date: IsoDate; cents: number }[];
  /** The lowest end-of-day balance and its first day. */
  lowest: { date: IsoDate; cents: number };
}

export interface AheadData {
  from: IsoDate;
  to: IsoDate;
  /** Date ascending; within a day the larger amount first. */
  rows: AheadRow[];
  /** The usual everyday spending a day, in whole cents. 0 without a complete month. */
  everydayPerDayCents: number;
  /** The usual everyday spending over the days after today that the balance line subtracts. */
  everydayCents: number;
  /** null without a checking balance or without a complete month to say what everyday spending is. */
  balance: AheadBalance | null;
  /** Why there is no balance line: "balance" for no checking balance given, "history" for no complete month. */
  missing: "balance" | "history" | null;
}

/**
 * The coming pay days of an income series. A monthly salary comes on its usual day of the month, the median of the days
 * it was paid on, so one early payday does not move the next one, and on the Friday before when that day is a weekend.
 * Other cadences follow the series' own dates.
 */
function payDates(s: RecurringSeries, paidOn: readonly IsoDate[], to: IsoDate): IsoDate[] {
  if (s.cadence !== "monthly" || !s.nextDate || !paidOn.length) return projectDates(s, to);
  const usual = Math.round(median(paidOn.map((d) => Number(d.slice(8, 10)))));
  const out: IsoDate[] = [];
  for (let m = monthIndex(monthOf(s.lastDate)) + 1; ; m++) {
    const month = fromMonthIndex(m);
    const date = dateIn(month, usual);
    const weekday = weekdayOf(date);
    // Saturday is 5 and Sunday 6, Friday 4
    const paid = weekday >= 5 ? addDays(date, 4 - weekday) : date;
    if (paid > to) return out;
    out.push(paid);
  }
}

/**
 * What is coming in the next 30 days and, with a checking balance, how the balance moves. `balances` are the accounts
 * in view (own and shared with the viewer); `inputs` are the household's marks and typed-in bills. Not part of the
 * cached context: both are read per request.
 */
export function cashAhead(ctx: AnalysisContext, balances: readonly BalanceInput[], inputs: UserInputs): AheadData {
  const from = ctx.today;
  const to = addDays(from, AHEAD_DAYS);
  const rows: AheadRow[] = [];

  // pay days: active income series that are not late, a late one is expected today
  const incomes = ctx.recurring.filter((s) => s.kind === "income" && s.active && !s.overdue && getCategory(s.category).kind === "income");
  const wanted = new Set(incomes.flatMap((s) => s.transactionIds));
  const dayOf = new Map<string, IsoDate>();
  for (const t of ctx.txs) if (wanted.has(t.id)) dayOf.set(t.id, t.bookingDate);
  for (const s of incomes) {
    const past = s.transactionIds.map((id) => dayOf.get(id)).filter((d): d is IsoDate => !!d);
    for (const d of payDates(s, past, to)) rows.push({ date: d < from ? from : d, name: s.merchant, category: s.category, cents: s.typicalAmountCents, source: "income" });
  }
  for (const c of expectedCharges(ctx.recurring, from, to, { cancelled: cancelledMerchants(inputs), savings: true })) {
    rows.push({ date: c.date, name: c.merchant, category: c.category, cents: -c.amountCents, source: "recurring" });
  }
  for (const b of expectedBillRows(ctx, inputs.expectedBills, from, to)) {
    rows.push({ date: b.date, name: b.name, category: b.category, cents: -b.amountCents, source: "expected" });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || Math.abs(b.cents) - Math.abs(a.cents) || a.name.localeCompare(b.name));

  const rate = everydayPerDay(ctx, monthOf(from));
  const checking = balances.filter((b) => b.type === "checking" && b.balanceCents !== null);
  const hasHistory = completeMonthsBefore(ctx, monthOf(from), 1).length > 0;
  const base = { from, to, rows, everydayPerDayCents: Math.round(rate), everydayCents: Math.round(rate * AHEAD_DAYS) };
  if (!checking.length) return { ...base, balance: null, missing: "balance" };
  if (!hasHistory) return { ...base, balance: null, missing: "history" };

  const start = checking.reduce((sum, b) => sum + b.balanceCents!, 0);
  const stamps = checking.map((b) => b.balanceAt).filter((x): x is string => !!x).sort();
  const days: AheadBalance["days"] = [];
  let next = 0;
  let inOut = 0;
  for (let i = 0; i <= AHEAD_DAYS; i++) {
    const date = addDays(from, i);
    while (next < rows.length && rows[next]!.date <= date) inOut += rows[next++]!.cents;
    // everyday spending starts tomorrow: today's balance already holds what was spent today
    days.push({ date, cents: start + inOut - Math.round(rate * i) });
  }
  const lowest = days.reduce((low, d) => (d.cents < low.cents ? d : low), days[0]!);
  return { ...base, balance: { startCents: start, accounts: checking.length, balanceAt: stamps[0] ?? null, days, lowest: { ...lowest } }, missing: null };
}
