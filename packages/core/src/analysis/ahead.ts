/**
 * Decision: does the account cover what is due before the next pay.
 *
 * The days up to the next payday as the bank's rows and the household's own bills give them: pay days, subscriptions and
 * bills, the bills the household typed in, the bill of a connected card and regular transfers to other accounts, and
 * with a checking balance what is left of it after those payments. Nothing else is taken off here: the expected everyday
 * spending is told beside the figures, and the runway (`runway.ts`) takes off the part that leaves before the payday. The window follows the accounts whose balance it counts
 * (`countedAccounts`): a charge is a row when one of them pays it. The window ends the day before the nearest payday of
 * the pays to wait for; without one it is the next 30 days.
 */
import { cancelledSubjects, type ExpectedCharge, expectedCharges } from "../commitments.ts";
import { addDays, daysBetween, monthOf } from "../dates.ts";
import { parseSeriesId, type RecurringSeries } from "../recurring.ts";
import type { BalanceInput, IsoDate, UserInputs } from "../types.ts";
import { type Counted, countedAccounts, expectedMoves, type Settling } from "./ahead-moves.ts";
import { balanceWalk } from "./balance-walk.ts";
import { type ComingPeriod, comingList, comingPays } from "./coming.ts";
import { type AnalysisContext, standingOf } from "./context.ts";
import { expectedEverydayPerDay } from "./expected.ts";
import { expectedBillRows } from "./forecast.ts";
import { INCOME_TYPES, type IncomeType, incomeTypes, payDayOf } from "./income.ts";
import { type Pay, type PayEstimate, payEstimate, payEvidence } from "./pay-estimate.ts";
import { AHEAD_DAYS } from "../thresholds.ts";

export interface AheadRow {
  date: IsoDate;
  /** The merchant, the name the household gave the bill, the card, or the account a transfer goes to. */
  name: string;
  /** "transfer" on a card's bill and on a transfer: they move a balance and are spending nowhere. */
  category: string | null;
  /**
   * Money in is positive, everything that leaves the counted accounts negative. On a pay day: the least the pay is
   * expected to be (`pay.floorCents`), null when it has no estimate (a figure adds nothing for it). It is the only sum
   * of a pay that any figure adds. A payment always has its sum.
   */
  cents: number | null;
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
  /** In `upcoming` only: an account the balance leaves out pays it (not a card), so it is in no figure of the window. */
  outside?: true;
}

export interface AheadBalance {
  /** What the counted checking accounts hold today: the bank's balance walked to today (`balanceWalk`), as the first page and Saldot have it. */
  startCents: number;
  /** Which checking accounts are counted (`Counted` in ahead-moves.ts). */
  counts: Counted["counts"];
  /** How many checking accounts it adds up, and the oldest time one of the balances it walks from was given (ISO), null when unknown. */
  accounts: number;
  balanceAt: string | null;
  /** `startCents` less `totals.leavingCents`: the payments and the own transfers. Nothing else is taken off and no pay is added, so it is below zero when the payments exceed the balance. */
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
  /** The payments of the window: the first three added up. An own transfer is no payment, so it is not in it. */
  dueCents: number;
  /** Everything that leaves the counted accounts in the window: the payments and the own transfers, the four above added up. */
  leavingCents: number;
  /** The least of the other pay that lands inside the window (the floor of each estimate); the payday itself is no part of it. */
  incomeCents: number;
}

/** A group of `upcoming` as Laskut lists it, with the group's one sum. */
export interface AheadGroup {
  /**
   * "window": paid to the window's last day; "after": paid after the pay that ends the window, a bill paid from the pay
   * on its own day (`withPay`) too; "days": the 30 days, when no pay ends the window; "card": charged to a credit card,
   * which leaves no account. The first group of a pay stays without rows too, the others only with rows.
   */
  key: "window" | "after" | "days" | "card";
  /** Indexes into `upcoming`, in its order: the rows that pay a known sum. */
  rows: number[];
  /** What the rows pay, in positive cents. */
  cents: number;
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
   * whatever account pays them: Laskut lists a subscription a card pays too, marked `onCard`, and a connected card's
   * bill on its due date, as Yhteenveto lists it. No pay and no transfer.
   */
  upcoming: AheadRow[];
  /**
   * The expected everyday spending of a day in the running month, in whole cents, over every account in view, a card's
   * purchases included (`expectedEverydayPerDay`). Taken off none of these figures: the runway (`runwayOf`) takes off
   * the part the counted accounts pay before the payday. 0 under three complete months or when a linked card's
   * purchases are missing from them.
   */
  everydayPerDayCents: number;
  totals: AheadTotals;
  /** null unless every counted checking account has a balance. */
  balance: AheadBalance | null;
  /** Why the balance has no figures: "balance" when a counted checking account has no balance given. */
  missing: "balance" | null;
}

/**
 * The month Yhteenveto opens on: the running one once its pay has come, else the last complete one, so the page does
 * not open on a month that holds the bills but not yet the pay ("Tulos" deep below zero before payday). The pay is the
 * one the window waits for (`payday`): when it is due this month, or is behind its day this month, it has not come. A
 * household with no regular pay opens on the running month.
 */
export function openingMonth({ from, payday }: Pick<AheadData, "from" | "payday">): "month" | "last-month" {
  if (!payday) return "month";
  const month = from.slice(0, 7);
  return (payday.expected ?? payday.date).slice(0, 7) === month ? "last-month" : "month";
}

/**
 * `upcoming` in Laskut's groups, each with its sum (GET /api/ahead sends them with the window): the page lists and sums
 * none itself. A pay ends the window when one is to wait for, or when the pay behind its day has a next one to come.
 */
export function upcomingGroups({ upcoming, to, reason, payday }: Pick<AheadData, "upcoming" | "to" | "reason" | "payday">): AheadGroup[] {
  const untilPay = reason === "payday" && payday !== null && (!payday.expected || payday.next !== undefined);
  const paid = upcoming.flatMap((r, i) => (r.cents !== null && r.cents < 0 ? [i] : []));
  const group = (key: AheadGroup["key"], rows: number[]): AheadGroup => ({ key, rows, cents: rows.reduce((sum, i) => sum - upcoming[i]!.cents!, 0) });
  const own = paid.filter((i) => !upcoming[i]!.onCard);
  const card = paid.filter((i) => upcoming[i]!.onCard);
  const inWindow = (i: number) => upcoming[i]!.date <= to && !upcoming[i]!.withPay;
  const after = own.filter((i) => !inWindow(i));
  const groups = !untilPay ? [group("days", own)] : after.length ? [group("window", own.filter(inWindow)), group("after", after)] : [group("window", own)];
  return card.length ? [...groups, group("card", card)] : groups;
}

/** What accounts the balance leaves out pay in the 30 days: the rows marked `outside`, in no figure of the window. */
export function upcomingElsewhereCents(upcoming: readonly AheadRow[]): number {
  return upcoming.reduce((sum, r) => (r.outside && r.cents !== null && r.cents < 0 ? sum - r.cents : sum), 0);
}

/** What a row adds to a figure: a pay with no estimate adds nothing. */
const centsOf = (r: AheadRow): number => r.cents ?? 0;

const sumOf = (rows: readonly AheadRow[], source: AheadRow["source"]) => rows.filter((r) => r.source === source).reduce((sum, r) => sum + Math.abs(centsOf(r)), 0);

const byDay = (a: AheadRow, b: AheadRow) => a.date.localeCompare(b.date) || Math.abs(centsOf(b)) - Math.abs(centsOf(a)) || a.name.localeCompare(b.name);
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
 * says it is at least (`PayEstimate.floorCents`; nothing without an estimate). The figures need the balance of every counted
 * account, since the rows are those of all of them.
 *
 * The payday is that of the whole view, whatever account the pay lands on. Everything else follows the counted
 * accounts: other pay is a row when one of them gets it, a charge when one of them pays it (a series is one account's,
 * the account in its id), so a card's purchases are in the card's bill and not in a row.
 * A typed-in bill names no account and always counts.
 *
 * A bill that a payment from another account, or under another payee name, settled is no row once that payment is
 * booked. While the bank has not booked it (`pending`) the bill stays a row, marked, when the payment is on a counted
 * account, because the balance still holds its money; a payment on an account the balance does not count leaves no row.
 */
export function cashAhead(ctx: AnalysisContext, balances: readonly BalanceInput[], inputs: UserInputs): AheadData {
  return aheadBasis(ctx, balances, inputs).ahead;
}

/** What a figure of the window rests on, for its basis (explain/now.ts): the window, the counted checking accounts' balances of today and the pays the payday's estimate counts. */
export interface AheadBasis {
  ahead: AheadData;
  /** The accounts that pay their own purchases before the payday: the counted ones and the cards they pay as it goes. null without a checking account in view. A card's purchases wait for its bill. */
  direct: ReadonlySet<string> | null;
  /** The next bills of the cards paid in full: each takes the card's purchases up to its day too (`runwayOf`). */
  settling: readonly Settling[];
  checking: { id: string; name: string; cents: number; balanceAt: string | null }[];
  /** The pays the payday's estimate rests on, each with its row, oldest first; empty without a payday or an estimate. */
  pays: Pay[];
  /** What is coming to the payday after next, by payday period (coming.ts): Tulossa's list, of the window's own pays to wait for (`comingPays`). */
  coming: ComingPeriod[];
}

/** `cashAhead` with what its figures rest on: one run, so the basis is of the very figures the page shows. */
export function aheadBasis(ctx: AnalysisContext, balances: readonly BalanceInput[], inputs: UserInputs): AheadBasis {
  const from = ctx.today;
  const counted = countedAccounts(balances);
  // without a checking account in view nothing is left out
  const onCounted = (s: RecurringSeries) => !counted || counted.ids.has(parseSeriesId(s.id)?.accountId ?? "");

  // the incomes and the pays to wait for, as the coming list has them (coming.ts); its reach is past this window's
  const found = comingPays(ctx);
  const { top, rowsOf, pays, major, next } = found;
  // the estimate of a series' next pay: from its regular pays only, holiday pay and other pay left out
  let types: Map<string, IncomeType> | null = null;
  const regularOf = (s: RecurringSeries): Pay[] => {
    types ??= incomeTypes(standingOf(ctx).txs);
    return s.transactionIds.flatMap((id) => {
      const t = rowsOf.get(id);
      return t && t.amountCents > 0 && INCOME_TYPES[types!.get(id) ?? "other_income"].regular ? [{ id, date: t.bookingDate, cents: t.amountCents }] : [];
    });
  };
  const payOf = (s: RecurringSeries, due: IsoDate): PayEstimate | null => payEstimate(regularOf(s), from, due);
  // `next`, the nearest pay among them whose day is still to come, ends the window
  // one whose day has gone by and that is not late yet: it has not come, so it ends no window
  const behind = major.find((p) => p.expected.length > 0 && p.expected[0]! < from);

  let reason: AheadData["reason"] = "none";
  let payday: Payday | null = null;
  // the series whose pay the window waits for: its estimate's pays are the payday's basis
  let paySeries: RecurringSeries | null = null;
  if (top?.overdue) {
    reason = "late";
    const due = top.nextDate ?? top.lastDate;
    payday = { date: due, name: top.merchant, pay: payOf(top, due) };
    paySeries = top;
  } else if (behind) {
    reason = "payday";
    payday = { date: from, expected: behind.expected[0]!, ...(next ? { next: next.day } : {}), name: behind.s.merchant, pay: payOf(behind.s, behind.expected[0]!) };
    paySeries = behind.s;
  } else if (next) {
    reason = "payday";
    payday = { date: next.day, name: next.s.merchant, pay: payOf(next.s, next.day) };
    paySeries = next.s;
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
      all.push({ date: d, name: s.merchant, category: s.category, cents: pay?.floorCents ?? null, source: "income", pay });
    });
  }
  const expected = { cancelled: cancelledSubjects(inputs, ctx.today), savings: true };
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
    ...expectedCharges(outside.filter((s) => !onCard(s)), from, thirty, expected).map((c): AheadRow => ({ ...chargeRow(c), outside: true })),
    ...expectedCharges(outside.filter(onCard), from, thirty, expected).map((c): AheadRow => ({ ...chargeRow(c), onCard: true })),
  ];
  // the moves are found to the end of Laskut's 30 days: a card's bill is in the list like any bill, a transfer is not
  const { moves, asItGoes, settling } = counted ? expectedMoves(ctx, counted.ids, balances, from, reachPayments) : { moves: [], asItGoes: new Set<string>(), settling: [] };
  for (const m of moves) {
    all.push({ date: m.date, name: m.name, category: "transfer", cents: -m.amountCents, source: m.source, ...(m.basis ? { basis: m.basis } : {}) });
  }
  const upcoming = [...all.filter((r) => r.source !== "income" && r.source !== "transfer" && r.date <= thirty), ...elsewhere].sort(byDay);
  const rows = all.filter((r) => r.date <= to && !r.withPay).sort(byDay);

  // a card the counted accounts pay as it goes has no bill row: its purchases are spent from them day by day
  const direct = counted ? new Set([...counted.ids, ...asItGoes]) : null;
  // today's balance is the day walk's, the same as on the first page and in Saldot: the bank's balance with the rows booked since it was given
  const checking = (counted?.accounts ?? []).flatMap((b) => {
    const cents = balanceWalk(ctx, b)?.at(ctx.todayDay) ?? null;
    return cents === null ? [] : [{ id: b.id, name: b.name, cents, balanceAt: b.balanceAt }];
  });
  const [recurringCents, typedCents, cardCents, transferCents] = [sumOf(rows, "recurring"), sumOf(rows, "expected"), sumOf(rows, "card"), sumOf(rows, "transfer")];
  const totals: AheadTotals = { recurringCents, typedCents, cardCents, transferCents, dueCents: recurringCents + typedCents + cardCents, leavingCents: recurringCents + typedCents + cardCents + transferCents, incomeCents: sumOf(rows, "income") };
  const base = { from, to, days, reason, payday, rows, upcoming, everydayPerDayCents: expectedEverydayPerDay(ctx, monthOf(from)), totals };
  const evidence: Pay[] = payday?.pay && paySeries ? payEvidence(regularOf(paySeries), from) : [];
  const periods = comingList(ctx, inputs, found);
  // the rows are those of every counted account, so the figures need the balance of every one of them
  if (!checking.length || checking.length < counted!.accounts.length) return { ahead: { ...base, balance: null, missing: "balance" }, direct, settling, checking, pays: evidence, coming: periods };

  const startCents = checking.reduce((sum, b) => sum + b.cents, 0);
  const stamps = checking.map((b) => b.balanceAt).filter((x): x is string => !!x).sort();
  // the payments in the rows' order, each against the balance with the pay dated before its day: the first one it does
  // not reach, and the most it lacks
  let [paid, lowest] = [0, startCents];
  let shortOn: IsoDate | null = null;
  for (const r of rows) {
    if (r.source === "income") continue;
    paid += Math.abs(centsOf(r));
    const left = startCents + rows.reduce((sum, p) => (p.source === "income" && p.date < r.date ? sum + centsOf(p) : sum), 0) - paid;
    if (left < 0) shortOn ??= r.date;
    lowest = Math.min(lowest, left);
  }
  const balance: AheadBalance = { startCents, counts: counted!.counts, accounts: checking.length, balanceAt: stamps[0] ?? null, freeCents: startCents - totals.leavingCents, shortCents: Math.max(0, -lowest), shortOn };
  return { ahead: { ...base, balance, missing: null }, direct, settling, checking, pays: evidence, coming: periods };
}
