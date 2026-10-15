/**
 * Decision: does the account cover what is due before the next pay.
 *
 * The days up to the next payday as the bank's rows and the household's own bills give them: pay days, subscriptions and
 * bills, the bills the household typed in, the bill of a connected card and regular transfers to other accounts, and
 * with a checking balance what is left of it after those payments. Nothing else is taken off: the usual spending of a
 * day is told beside the figures and is in none of them. The window follows the accounts whose balance it counts
 * (`countedAccounts`): a charge is a row when one of them pays it. The window ends the day before the nearest payday of
 * the pays to wait for; without one it is the next 30 days.
 */
import { getCategory } from "../categories.ts";
import { cancelledSubjects, type ExpectedCharge, expectedCharges } from "../commitments.ts";
import { addDays, daysBetween, monthOf } from "../dates.ts";
import { parseSeriesId, projectDates, type RecurringSeries } from "../recurring.ts";
import type { BalanceInput, IsoDate, UserInputs } from "../types.ts";
import { type Counted, countedAccounts, expectedMoves } from "./ahead-moves.ts";
import { balanceWalk } from "./balance-walk.ts";
import { type AnalysisContext, type AnalysisTx, standingOf } from "./context.ts";
import { everydayPerDay, expectedBillRows } from "./forecast.ts";
import { INCOME_TYPES, type IncomeType, incomeTypes, nextPayDate, payDayOf } from "./income.ts";
import { type PayEstimate, payEstimate } from "./pay-estimate.ts";

/** How many days after today the window runs when no payday sets it. */
const AHEAD_DAYS = 30;
/** A payday farther away than this many days is not waited for: the window is `AHEAD_DAYS` instead. */
const MAX_PAYDAY_DAYS = 45;
/** A monthly pay is expected at least this many days after the last one: a nearer day is the last pay itself, early or late. */
const MIN_PAY_GAP_DAYS = 15;
/** A regular income of at least this share of the largest one is a pay to wait for: the smaller of two salaries is, a child benefit is not. */
const MAJOR_PAY_SHARE = 0.5;

export interface AheadRow {
  date: IsoDate;
  /** The merchant, the name the household gave the bill, the card, or the account a transfer goes to. */
  name: string;
  /** "transfer" on a card's bill and on a transfer: they move a balance and are spending nowhere. */
  category: string | null;
  /**
   * Money in is positive, everything that leaves the counted accounts negative. On a pay day: the least the pay is
   * expected to be (`pay.floorCents`), 0 when it has no estimate. It is the only sum of a pay that any figure adds.
   */
  cents: number;
  /**
   * "income": a pay day. "recurring": a subscription or bill the history shows. "expected": a bill the household typed
   * in. "card": the bill of a connected card. "transfer": a regular transfer to an account the balance does not count.
   */
  source: "income" | "recurring" | "expected" | "card" | "transfer";
  /** On a card's bill only: "balance" when the sum is what the card owes today, "usual" when it is the median of its paid bills. */
  basis?: "balance" | "usual";
  /**
   * In `upcoming` only, on a payment dated today whose series follows the pay that is expected today and is not booked
   * yet: it is paid from that pay, so it is no row of the window and Laskut lists it after the payday.
   */
  withPay?: boolean;
  /**
   * On a bill of a series that a payment from another account, or under another payee name, has settled while the bank has
   * not booked that payment yet, on an account the balance counts: the bill is paid, but its money is still in the balance
   * the window starts from, so it stays in the rows and in `dueCents` until the payment is booked. Laskut's list (`upcoming`) holds it too, marked the same.
   */
  pending?: true;
  /** On a pay day: the estimate of the pay from the pays that came, null when they are too few to say a sum. */
  pay?: PayEstimate | null;
  /**
   * In `upcoming` only: the series is charged to a credit card, so no account pays it. It is in the card's bill, and
   * Laskut lists it in a group of its own, outside the sums of what the accounts pay.
   */
  onCard?: boolean;
}

export interface AheadBalance {
  /** What the counted checking accounts hold today: the bank's balance walked to today (`balanceWalk`), as the first page and Saldot have it. */
  startCents: number;
  /** Which checking accounts are counted (`Counted` in ahead-moves.ts). */
  counts: Counted["counts"];
  /** How many checking accounts it adds up, and the oldest time one of the balances it walks from was given (ISO), null when unknown. */
  accounts: number;
  balanceAt: string | null;
  /** `startCents` less `totals.dueCents`. Nothing else is taken off and no pay is added, so it is below zero when the payments exceed the balance. */
  freeCents: number;
  /**
   * The most the account lacks at a payment of the window, the pay dated before the payment's day counted: `-freeCents`
   * when no pay comes before a payment and that is below zero. What a balance below zero lacks before any payment
   * counts too. Else 0.
   */
  shortCents: number;
  /** The day of the first payment, in the order of `rows`, that `startCents` and the pay dated before its day do not cover. Null when none is. */
  shortOn: IsoDate | null;
}

/** The pay the window waits for. */
interface Payday {
  /** The coming pay day. For a late pay the day it was expected, which has gone by. */
  date: IsoDate;
  /**
   * The day the pay was expected, when that day has gone by and the pay is not late yet: `date` is today then, and
   * the window runs on to the next pay to wait for, since a pay that has not come ends none. Left out when `date` is
   * the expected day itself.
   */
  expected?: IsoDate;
  /** With `expected`: the day of the pay that ends the window, the nearest one to wait for whose day is to come. Left out when none is within the days looked at: the window is the 30 days then. */
  next?: IsoDate;
  /** The payer. */
  name: string;
  /** What the pay is expected to be, from the regular pays of the series; null under three pays. */
  pay: PayEstimate | null;
}

/** What the window holds, each in positive cents. */
interface AheadTotals {
  /** Subscriptions and bills the history shows. */
  recurringCents: number;
  /** Bills the household typed in. */
  typedCents: number;
  /** Bills of connected cards. */
  cardCents: number;
  /** Regular transfers to accounts the balance does not count. */
  transferCents: number;
  /** Everything that leaves the counted accounts in the window: the four above added up. */
  dueCents: number;
  /** The least of the other pay that lands inside the window (the floor of each estimate); the payday itself is no part of it. */
  incomeCents: number;
}

export interface AheadData {
  from: IsoDate;
  /** The last day of the window. */
  to: IsoDate;
  /** How many days after today the window runs: `to` less `from`. */
  days: number;
  /**
   * "payday": a pay to wait for is coming, or one is behind its day and not late yet. "late": the largest regular
   * income is late. In both the window ends the day before the nearest pay to wait for whose day is still to come
   * (today alone when that is today or tomorrow), and is 30 days without one. "none": no regular income, or no pay to
   * wait for within 45 days, so 30 days.
   */
  reason: "payday" | "none" | "late";
  /** Set for "payday" and "late", null for "none". */
  payday: Payday | null;
  /** The window's rows, what the counted accounts get and pay: date ascending; within a day the larger amount first. */
  rows: AheadRow[];
  /**
   * The bills, subscriptions and typed-in bills of the next 30 days, in the same order, whatever the window is and
   * whatever account pays them: Laskut lists a subscription a card pays too, marked `onCard`. No pay, no card's bill
   * and no transfer.
   */
  upcoming: AheadRow[];
  /** The usual everyday spending of the counted accounts a day, in whole cents (`everydayPerDay`): told beside the figures and taken off none. 0 under eight whole weeks of history. */
  everydayPerDayCents: number;
  totals: AheadTotals;
  /** null unless every counted checking account has a balance. */
  balance: AheadBalance | null;
  /** Why the balance has no figures: "balance" when a counted checking account has no balance given. */
  missing: "balance" | null;
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
 * What is due until the next payday and, with a checking balance, what is left of it after that. The pays to wait for
 * are the regular incomes that are not late and whose usual amount is at least half of the largest one; the payday is
 * the nearest coming pay among them, and the window runs from today to the day before it, at most 45 days. Without
 * such a pay within those days it is 30 days. When the payday is today or tomorrow the window is today alone; on the
 * payday itself, until the pay is booked, a bill that follows the pay is paid from it and is no row of the window. A pay
 * that is late, or behind its day and not late yet, has not come and ends no window: it is told as the payday, and the
 * window still ends before the nearest pay to wait for whose day is to come, so no such pay is ever inside a window.
 * `balances` are the accounts in view (own and shared with the viewer); `inputs` are the household's marks and
 * typed-in bills. Not part of the cached context: both are read per request.
 *
 * What is due and what is free hold the payments and nothing else: what is free is the balance less what is due. The
 * day the balance runs short is the day of the first payment that the balance and the pay dated before that day do
 * not cover: other pay of the window is a row, and it is money only for what is due after it, as much as its estimate
 * says it is at least (`PayEstimate.floorCents`, 0 without an estimate). The figures need the balance of every counted
 * account, since the rows are those of all of them.
 *
 * The payday is that of the whole view, whatever account the pay lands on. Everything else follows the counted
 * accounts: other pay is a row when one of them gets it, a charge when one of them pays it (a series is one account's,
 * the account in its id), and the usual day is their own, so a card's purchases are in the card's bill and not in it.
 * A typed-in bill names no account and always counts.
 *
 * A bill that a payment from another account, or under another payee name, settled is no row once that payment is
 * booked. While the bank has not booked it (`pending`) the bill stays a row, marked, when the payment is on a counted
 * account, because the balance still holds its money; a payment on an account the balance does not count leaves no row.
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
  const wanted = new Set(incomes.flatMap((s) => s.transactionIds));
  const dayOf = new Map<string, IsoDate>();
  const rowsOf = new Map<string, AnalysisTx>();
  for (const t of standingOf(ctx).txs) if (wanted.has(t.id)) (dayOf.set(t.id, t.bookingDate), rowsOf.set(t.id, t));
  // the estimate of a series' next pay: from its regular pays only, holiday pay and other pay left out
  let types: Map<string, IncomeType> | null = null;
  const payOf = (s: RecurringSeries, due: IsoDate): PayEstimate | null => {
    types ??= incomeTypes(standingOf(ctx).txs);
    const regular = s.transactionIds.flatMap((id) => {
      const t = rowsOf.get(id);
      return t && t.amountCents > 0 && INCOME_TYPES[types!.get(id) ?? "other_income"].regular ? [{ date: t.bookingDate, cents: t.amountCents }] : [];
    });
    return payEstimate(regular, from, due);
  };
  const reach = addDays(from, MAX_PAYDAY_DAYS);
  const pays = coming.map((s) => {
    const past = s.transactionIds.map((id) => dayOf.get(id)).filter((d): d is IsoDate => !!d);
    const expected = payDates(s, past, reach);
    // a pay expected on a day gone by and not late yet is a row of today
    return { s, past, expected, dates: expected.map((d) => (d < from ? from : d)) };
  });

  // the pays to wait for; of two on one day the larger comes first
  const major = (top ? pays.filter((p) => p.s.typicalAmountCents >= top.typicalAmountCents * MAJOR_PAY_SHARE) : []).sort((a, b) => b.s.typicalAmountCents - a.s.typicalAmountCents);
  // the nearest pay among them whose day is still to come: it ends the window, whatever else is late or behind
  const [next] = major.flatMap((p) => p.expected.filter((d) => d >= from).slice(0, 1).map((day) => ({ s: p.s, past: p.past, day }))).sort((a, b) => a.day.localeCompare(b.day));
  // one whose day has gone by and that is not late yet: it has not come, so it ends no window
  const behind = major.find((p) => p.expected.length > 0 && p.expected[0]! < from);

  let reason: AheadData["reason"] = "none";
  let payday: Payday | null = null;
  if (top?.overdue) {
    reason = "late";
    const due = top.nextDate ?? top.lastDate;
    payday = { date: due, name: top.merchant, pay: payOf(top, due) };
  } else if (behind) {
    reason = "payday";
    payday = { date: from, expected: behind.expected[0]!, ...(next ? { next: next.day } : {}), name: behind.s.merchant, pay: payOf(behind.s, behind.expected[0]!) };
  } else if (next) {
    reason = "payday";
    payday = { date: next.day, name: next.s.merchant, pay: payOf(next.s, next.day) };
  }
  const to = !next ? addDays(from, AHEAD_DAYS) : next.day > from ? addDays(next.day, -1) : from;
  const days = daysBetween(from, to);

  // what the counted accounts get and pay, found once: income to the end of the window, payments as far as the window
  // or the 30 days of `upcoming` reach, whichever is longer. `rows` and the counted part of `upcoming` are cut from it.
  const thirty = addDays(from, AHEAD_DAYS);
  const reachPayments = to > thirty ? to : thirty;
  const all: AheadRow[] = [];
  const waited = new Set(major.map((p) => p.s));
  for (const { s, expected: due, dates } of pays) {
    if (!onCounted(s)) continue;
    dates.forEach((d, i) => {
      // the pay that ends the window lands after it, and a pay to wait for whose day has gone by has not come
      if (d > to || (s === next?.s && d === next.day) || (waited.has(s) && due[i]! < from)) return;
      const pay = payOf(s, due[i]!);
      all.push({ date: d, name: s.merchant, category: s.category, cents: pay?.floorCents ?? 0, source: "income", pay });
    });
  }
  const expected = { cancelled: cancelledSubjects(inputs), savings: true };
  // The payday itself, the pay not booked yet: a bill that follows this pay (`follows`, the pay's own day and rule) is
  // paid from it. It is no row of today's window, so the balance is not said to be short of it; any other payment dated
  // today is a row, a follower that is late from an earlier pay included.
  const awaited = next?.day === from ? payDayOf(next.past) : null;
  const withPay = (s: RecurringSeries) => !!awaited && s.follows?.day === awaited.day && s.follows.rule === awaited.rule && s.nextDate === from;
  const paying = ctx.recurring.filter(onCounted);
  // a bill settled by a payment the bank has not booked: the balance read from the bank does not hold that payment yet, so
  // the bill's money is still in it and the bill stays due until the payment is booked. Payments of an account the balance
  // does not count are in no figure of it.
  const pendingIds = new Set(paying.flatMap((s) => (s.settled ?? []).filter((o) => o.pending).map((o) => o.id)));
  const heldBy = new Map<string, string>();
  if (pendingIds.size) for (const t of standingOf(ctx).txs) if (pendingIds.has(t.id)) heldBy.set(t.id, t.accountId);
  for (const s of paying) {
    for (const o of s.settled ?? []) {
      if (!o.pending || (counted && !counted.ids.has(heldBy.get(o.id) ?? ""))) continue;
      for (const c of expectedCharges([{ ...s, nextDate: o.due }], from, o.due, expected)) if (c.date <= reachPayments) all.push({ ...chargeRow(c), pending: true });
    }
  }
  for (const c of expectedCharges(paying.filter((s) => !withPay(s)), from, reachPayments, expected)) all.push(chargeRow(c));
  for (const c of expectedCharges(paying.filter(withPay), from, reachPayments, expected)) all.push(c.date === from ? { ...chargeRow(c), withPay: true } : chargeRow(c));
  for (const b of expectedBillRows(ctx, inputs.expectedBills, from, reachPayments)) {
    all.push({ date: b.date, name: b.name, category: b.category, cents: -b.amountCents, source: "expected" });
  }
  // what a card or an account outside the balance pays is in Laskut's 30 days and not in the window; a card's is marked
  const cards = new Set(ctx.accounts.filter((a) => a.type === "credit_card").map((a) => a.id));
  const onCard = (s: RecurringSeries) => cards.has(parseSeriesId(s.id)?.accountId ?? "");
  const outside = ctx.recurring.filter((s) => !onCounted(s));
  const elsewhere = [
    ...expectedCharges(outside.filter((s) => !onCard(s)), from, thirty, expected).map(chargeRow),
    ...expectedCharges(outside.filter(onCard), from, thirty, expected).map((c): AheadRow => ({ ...chargeRow(c), onCard: true })),
  ];
  const upcoming = [...all.filter((r) => r.source !== "income" && r.date <= thirty), ...elsewhere].sort(byDay);
  for (const m of counted ? expectedMoves(ctx, counted.ids, balances, from, to) : []) {
    all.push({ date: m.date, name: m.name, category: "transfer", cents: -m.amountCents, source: m.source, ...(m.basis ? { basis: m.basis } : {}) });
  }
  const rows = all.filter((r) => r.date <= to && !r.withPay).sort(byDay);

  const rate = everydayPerDay(ctx, monthOf(from), counted?.ids);
  // today's balance is the day walk's, the same as on the first page and in Saldot: the bank's balance with the rows booked since it was given
  const checking = (counted?.accounts ?? []).flatMap((b) => {
    const cents = balanceWalk(ctx, b)?.at(ctx.todayDay) ?? null;
    return cents === null ? [] : [{ cents, balanceAt: b.balanceAt }];
  });
  const [recurringCents, typedCents, cardCents, transferCents] = [sumOf(rows, "recurring"), sumOf(rows, "expected"), sumOf(rows, "card"), sumOf(rows, "transfer")];
  const totals: AheadTotals = { recurringCents, typedCents, cardCents, transferCents, dueCents: recurringCents + typedCents + cardCents + transferCents, incomeCents: sumOf(rows, "income") };
  const base = { from, to, days, reason, payday, rows, upcoming, everydayPerDayCents: Math.round(rate), totals };
  // the rows are those of every counted account, so the figures need the balance of every one of them
  if (!checking.length || checking.length < counted!.accounts.length) return { ...base, balance: null, missing: "balance" };

  const startCents = checking.reduce((sum, b) => sum + b.cents, 0);
  const stamps = checking.map((b) => b.balanceAt).filter((x): x is string => !!x).sort();
  // the payments in the rows' order, each against the balance with the pay dated before its day: the first one it does
  // not reach, and the most it lacks
  let [paid, lowest] = [0, startCents];
  let shortOn: IsoDate | null = null;
  for (const r of rows) {
    if (r.source === "income") continue;
    paid += Math.abs(r.cents);
    const left = startCents + rows.reduce((sum, p) => (p.source === "income" && p.date < r.date ? sum + p.cents : sum), 0) - paid;
    if (left < 0) shortOn ??= r.date;
    lowest = Math.min(lowest, left);
  }
  const balance: AheadBalance = { startCents, counts: counted!.counts, accounts: checking.length, balanceAt: stamps[0] ?? null, freeCents: startCents - totals.dueCents, shortCents: Math.max(0, -lowest), shortOn };
  return { ...base, balance, missing: null };
}
