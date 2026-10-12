/**
 * Decision: do I have enough on the account until the pay comes, and when to move money to it.
 *
 * The days up to the next payday as the forecast expects them: pay days, subscriptions and bills, the bills the household
 * typed in, the bill of a connected card and regular transfers to other accounts, and with a checking balance the
 * balance each day after the usual everyday spending. The window follows the accounts whose balance it counts
 * (`countedAccounts`): a charge is a row when one of them pays it. The window ends the day before the payday of the
 * largest regular income; without one it is the next 30 days.
 */
import { getCategory } from "../categories.ts";
import { cancelledSubjects, type ExpectedCharge, expectedCharges } from "../commitments.ts";
import { addDays, daysBetween, monthOf } from "../dates.ts";
import { parseSeriesId, projectDates, type RecurringSeries } from "../recurring.ts";
import type { BalanceInput, IsoDate, UserInputs } from "../types.ts";
import { type Counted, countedAccounts, expectedMoves } from "./ahead-moves.ts";
import { balanceWalk } from "./balance-walk.ts";
import type { AnalysisContext } from "./context.ts";
import { everydayPerDay, expectedBillRows } from "./forecast.ts";
import { nextPayDate, payDayOf } from "./income.ts";
import { completeMonthsBefore } from "./usual.ts";

/** How many days after today the list and the balance run when no payday sets the window. */
const AHEAD_DAYS = 30;
/** A payday farther away than this many days is not waited for: the window is `AHEAD_DAYS` instead. */
const MAX_PAYDAY_DAYS = 45;
/** A monthly pay is expected at least this many days after the last one: a nearer day is the last pay itself, early or late. */
const MIN_PAY_GAP_DAYS = 15;

export interface AheadRow {
  date: IsoDate;
  /** The merchant, the name the household gave the bill, the card, or the account a transfer goes to. */
  name: string;
  /** "transfer" on a card's bill and on a transfer: they move a balance and are spending nowhere. */
  category: string | null;
  /** Money in is positive, everything that leaves the counted accounts negative. */
  cents: number;
  /**
   * "income": a pay day. "recurring": a subscription or bill the history shows. "expected": a bill the household typed
   * in. "card": the bill of a connected card. "transfer": a regular transfer to an account the balance does not count.
   */
  source: "income" | "recurring" | "expected" | "card" | "transfer";
  /** On a card's bill only: "balance" when the sum is what the card owes today, "usual" when it is the median of its paid bills. */
  basis?: "balance" | "usual";
}

export interface AheadBalance {
  /** What the counted checking accounts hold today: the bank's balance walked to today (`balanceWalk`), as the first page and Saldot have it. */
  startCents: number;
  /** Which checking accounts are counted (`Counted` in ahead-moves.ts). */
  counts: Counted["counts"];
  /** How many checking accounts it adds up, and the oldest time one of the balances it walks from was given (ISO), null when unknown. */
  accounts: number;
  balanceAt: string | null;
  /** The balance at the end of each day from today to the last day, after the rows and the usual everyday spending. */
  days: { date: IsoDate; cents: number }[];
  /** The balance on the last day of the window, the day before the payday when there is one. */
  last: { date: IsoDate; cents: number };
  /** The lowest end-of-day balance and its first day. */
  lowest: { date: IsoDate; cents: number };
}

/** The pay the window waits for. */
interface Payday {
  /** The coming pay day. For a late pay the day it was expected, which has gone by. */
  date: IsoDate;
  /**
   * The day the pay was expected, when that day has gone by and the pay is not late yet: `date` is today then, since
   * the window and its balance count from today. Left out when `date` is the expected day itself.
   */
  expected?: IsoDate;
  /** The payer. */
  name: string;
  /** The usual amount of the series. */
  cents: number;
}

/** What the window holds, each in positive cents, so that start + income - recurring - typed - card - transfer - everyday is the balance of the last day. */
interface AheadTotals {
  /** Subscriptions and bills the history shows. */
  recurringCents: number;
  /** Bills the household typed in. */
  typedCents: number;
  /** Bills of connected cards. */
  cardCents: number;
  /** Regular transfers to accounts the balance does not count. */
  transferCents: number;
  /** The usual everyday spending for the days after today that the balance line subtracts. */
  everydayCents: number;
  /** Other pay that lands inside the window; the payday itself is no part of it. */
  incomeCents: number;
}

export interface AheadData {
  from: IsoDate;
  /** The last day of the window. */
  to: IsoDate;
  /** How many days after today the window runs: `to` less `from`. */
  days: number;
  /**
   * "payday": the window ends the day before the next pay of the largest regular income (today alone when it is today or
   * tomorrow). "none": no regular income, or its next pay is more than 45 days away, so 30 days. "late": that pay is
   * late, so 30 days.
   */
  reason: "payday" | "none" | "late";
  /** Set for "payday" and "late", null for "none". */
  payday: Payday | null;
  /** The window's rows, what the counted accounts get and pay: date ascending; within a day the larger amount first. */
  rows: AheadRow[];
  /**
   * The bills, subscriptions and typed-in bills of the next 30 days, in the same order, whatever the window is and
   * whatever account pays them: Laskut lists a subscription a card pays too. No pay, no card's bill and no transfer.
   */
  upcoming: AheadRow[];
  /** The usual everyday spending of the counted accounts a day, in whole cents. 0 without a complete month. */
  everydayPerDayCents: number;
  totals: AheadTotals;
  /** null without a checking balance or without a complete month to say what everyday spending is. */
  balance: AheadBalance | null;
  /** Why there is no balance line: "balance" for no checking balance given, "history" for no complete month. */
  missing: "balance" | "history" | null;
}

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

const sumOf = (rows: readonly AheadRow[], source: AheadRow["source"]) => rows.filter((r) => r.source === source).reduce((sum, r) => sum + Math.abs(r.cents), 0);

const byDay = (a: AheadRow, b: AheadRow) => a.date.localeCompare(b.date) || Math.abs(b.cents) - Math.abs(a.cents) || a.name.localeCompare(b.name);
const chargeRow = (c: ExpectedCharge): AheadRow => ({ date: c.date, name: c.merchant, category: c.category, cents: -c.amountCents, source: "recurring" });

/**
 * What is coming until the next payday and, with a checking balance, how the balance moves. The payday is the first
 * coming pay of the regular income with the largest usual amount; the window runs from today to the day before it, at
 * most 45 days. Without such an income, or when its next pay is farther away, it is 30 days, and when that income is
 * late it is 30 days too, since a late pay is not a day to wait for. When the payday is today or tomorrow the window is
 * today alone: today's balance is the last one before the pay. `balances` are the accounts in view (own and shared with
 * the viewer); `inputs` are the household's marks and typed-in bills. Not part of the cached context: both are read per
 * request.
 *
 * The payday is that of the whole view, whatever account the pay lands on. Everything else follows the counted
 * accounts: other pay is a row when one of them gets it, a charge when one of them pays it (a series is one account's,
 * the account in its id), and the everyday spending is their own, so a card's purchases are in the card's bill and not
 * in the rate. A typed-in bill names no account and always counts.
 */
export function cashAhead(ctx: AnalysisContext, balances: readonly BalanceInput[], inputs: UserInputs): AheadData {
  const from = ctx.today;
  const counted = countedAccounts(balances);
  // without a checking account in view nothing is left out
  const onCounted = (s: RecurringSeries) => !counted || counted.ids.has(parseSeriesId(s.id)?.accountId ?? "");

  const incomes = ctx.recurring.filter((s) => s.kind === "income" && s.active && getCategory(s.category).kind === "income");
  // the larger of two equal usual amounts is the first one listed
  const top = incomes.reduce<RecurringSeries | null>((best, s) => (!best || s.typicalAmountCents > best.typicalAmountCents ? s : best), null);
  // a late income is no row and no payday to wait for
  const coming = incomes.filter((s) => !s.overdue);
  const wanted = new Set(coming.flatMap((s) => s.transactionIds));
  const dayOf = new Map<string, IsoDate>();
  for (const t of ctx.txs) if (wanted.has(t.id)) dayOf.set(t.id, t.bookingDate);
  const reach = addDays(from, MAX_PAYDAY_DAYS);
  const pays = coming.map((s) => {
    const past = s.transactionIds.map((id) => dayOf.get(id)).filter((d): d is IsoDate => !!d);
    const expected = payDates(s, past, reach);
    // a pay expected on a day gone by and not late yet is waited for today
    return { s, expected, dates: expected.map((d) => (d < from ? from : d)) };
  });

  let reason: AheadData["reason"] = "none";
  let payday: Payday | null = null;
  if (top?.overdue) {
    reason = "late";
    payday = { date: top.nextDate ?? top.lastDate, name: top.merchant, cents: top.typicalAmountCents };
  } else if (top) {
    const pay = pays.find((p) => p.s === top)!;
    const [next, expected] = [pay.dates[0], pay.expected[0]];
    if (next) {
      reason = "payday";
      payday = { date: next, name: top.merchant, cents: top.typicalAmountCents, ...(expected && expected < next ? { expected } : {}) };
    }
  }
  const to = reason !== "payday" ? addDays(from, AHEAD_DAYS) : payday!.date > from ? addDays(payday!.date, -1) : from;
  const days = daysBetween(from, to);

  // what the counted accounts get and pay, found once: income to the end of the window, payments as far as the window
  // or the 30 days of `upcoming` reach, whichever is longer. `rows` and the counted part of `upcoming` are cut from it.
  const thirty = addDays(from, AHEAD_DAYS);
  const reachPayments = to > thirty ? to : thirty;
  const all: AheadRow[] = [];
  for (const { s, dates } of pays) {
    // the pay the window waits for lands after it
    if ((reason === "payday" && s === top) || !onCounted(s)) continue;
    for (const d of dates) if (d <= to) all.push({ date: d, name: s.merchant, category: s.category, cents: s.typicalAmountCents, source: "income" });
  }
  const expected = { cancelled: cancelledSubjects(inputs), savings: true };
  for (const c of expectedCharges(ctx.recurring.filter(onCounted), from, reachPayments, expected)) all.push(chargeRow(c));
  for (const b of expectedBillRows(ctx, inputs.expectedBills, from, reachPayments)) {
    all.push({ date: b.date, name: b.name, category: b.category, cents: -b.amountCents, source: "expected" });
  }
  // what a card or an account outside the balance pays is in Laskut's 30 days and not in the window
  const elsewhere = expectedCharges(ctx.recurring.filter((s) => !onCounted(s)), from, thirty, expected).map(chargeRow);
  const upcoming = [...all.filter((r) => r.source !== "income" && r.date <= thirty), ...elsewhere].sort(byDay);
  for (const m of counted ? expectedMoves(ctx, counted.ids, balances, from, to) : []) {
    all.push({ date: m.date, name: m.name, category: "transfer", cents: -m.amountCents, source: m.source, ...(m.basis ? { basis: m.basis } : {}) });
  }
  const rows = all.filter((r) => r.date <= to).sort(byDay);

  const rate = everydayPerDay(ctx, monthOf(from), counted?.ids);
  // today's balance is the day walk's, the same as on the first page and in Saldot: the bank's balance with the rows booked since it was given
  const checking = (counted?.accounts ?? []).flatMap((b) => {
    const cents = balanceWalk(ctx, b)?.at(ctx.todayDay) ?? null;
    return cents === null ? [] : [{ cents, balanceAt: b.balanceAt }];
  });
  const hasHistory = completeMonthsBefore(ctx, monthOf(from), 1).length > 0;
  const totals: AheadTotals = {
    recurringCents: sumOf(rows, "recurring"),
    typedCents: sumOf(rows, "expected"),
    cardCents: sumOf(rows, "card"),
    transferCents: sumOf(rows, "transfer"),
    everydayCents: Math.round(rate * days),
    incomeCents: sumOf(rows, "income"),
  };
  const base = { from, to, days, reason, payday, rows, upcoming, everydayPerDayCents: Math.round(rate), totals };
  if (!checking.length) return { ...base, balance: null, missing: "balance" };
  if (!hasHistory) return { ...base, balance: null, missing: "history" };

  const start = checking.reduce((sum, b) => sum + b.cents, 0);
  const stamps = checking.map((b) => b.balanceAt).filter((x): x is string => !!x).sort();
  const walk: AheadBalance["days"] = [];
  let next = 0;
  let inOut = 0;
  for (let i = 0; i <= days; i++) {
    const date = addDays(from, i);
    while (next < rows.length && rows[next]!.date <= date) inOut += rows[next++]!.cents;
    // everyday spending starts tomorrow: today's balance already holds what was spent today
    walk.push({ date, cents: start + inOut - Math.round(rate * i) });
  }
  const lowest = walk.reduce((low, d) => (d.cents < low.cents ? d : low), walk[0]!);
  return { ...base, balance: { startCents: start, counts: counted!.counts, accounts: checking.length, balanceAt: stamps[0] ?? null, days: walk, last: { ...walk.at(-1)! }, lowest: { ...lowest } }, missing: null };
}
