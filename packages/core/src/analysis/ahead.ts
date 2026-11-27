/**
 * Decision: does the account cover what is due before the next pay.
 *
 * The days up to the next payday as the bank's rows and the household's own bills give them: pay days, subscriptions and
 * bills, the bills the household typed in, the bill of a connected card and regular transfers to other accounts, and
 * with a checking balance what is left of it after those payments. Nothing else is taken off here: the expected everyday
 * spending is told beside the figures, and the runway (`runway.ts`) takes off the part that leaves before the payday. The window follows the accounts of the pool
 * (`poolOf`), the same that Tulos speaks for: a charge is a row when one of them pays it. The window ends the day before the nearest payday of
 * the pays to wait for; without one it is the next 30 days.
 */
import { cancelledSubjects, type ExpectedCharge, expectedCharges } from "../commitments.ts";
import { addDays, daysBetween, monthOf } from "../dates.ts";
import { accountDigits } from "../day-bins.ts";
import { cardDebtOf, householdDebts } from "../household-debts.ts";
import { creditUse } from "../loans.ts";
import { parseSeriesId, type RecurringSeries } from "../recurring.ts";
import { normalizeIban } from "../transfers.ts";
import type { BalanceInput, IsoDate, UserInputs } from "../types.ts";
import { expectedMoves, type Settling } from "./ahead-moves.ts";
import { balanceWalk } from "./balance-walk.ts";
import { reconcileCardPayments, type TypedCardBill } from "./card-payments.ts";
import { type ComingPeriod, comingList, comingPays } from "./coming.ts";
import { type AnalysisContext, standingOf } from "./context.ts";
import { expectedEverydayPerDay } from "./expected.ts";
import { expectedBillRows } from "./forecast.ts";
import { INCOME_TYPES, type IncomeType, incomeTypes, payDayOf } from "./income.ts";
import { cardPayments, type Pool, poolOf, poolPays, type UnresolvedCard, unresolvedCards } from "./pool.ts";
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
   * On a card's bill, and on a typed bill whose payee account is that connected card's own account number (nothing
   * else proves it): the card's account, so the card's row of the first page names its next bill and the card's debt
   * is taken off once besides it.
   */
  cardId?: string;
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
  /** In `upcoming` and `outside` only: an account the balance leaves out pays it (not a card), so it is in no figure of the window. */
  outside?: true;
  /** On an `outside` row: the account that pays it, by the household's name for it and its last four digits, so the page names it. */
  account?: { name: string; digits: string | null };
}

interface AheadBalance {
  /** What the counted checking accounts hold today: the bank's balance walked to today (`balanceWalk`), as the first page and Saldot have it. */
  startCents: number;
  /** Whether every account of the pool is counted whole or some at the viewer's part (`Pool` in pool.ts). */
  counts: Pool["kind"];
  /** How many checking accounts it adds up, and the oldest time one of the balances it walks from was given (ISO), null when unknown. */
  accounts: number;
  balanceAt: string | null;
  /**
   * What the connected cards owe that no bill of the window holds and that falls due in it: each card's whole debt today
   * (`creditUse`, as Varat ja velat has it), less a payment its balance does not hold yet (booked after the balance day,
   * with no leg on the card), less the card's bills in `rows`. A card the counted accounts pay as it goes has no bill, so
   * all of its debt is here, and so is the debt of a card whose next bill is not known: with no day to put it on it is
   * taken off whole, so the figure never shows free money the debt may claim (ADR 0031). A card whose next bill is known
   * and falls after the window has its debt in `laterCardDebts` instead. Only cards that owe something are listed. A card
   * whose bills the rows show paid only from accounts outside the pool is not (`poolPays`): the pool does not owe it.
   */
  cardDebts: { cardId: string; name: string; cents: number }[];
  /**
   * The debt of the cards whose next bill is known and falls after the window (on the payday itself, which the pay
   * pays, or later), with that bill's day. It is paid from the coming pay, so `freeCents` takes nothing off for it; the
   * low point takes it off on that day. What counts as debt is the same as for `cardDebts`. `typedCents` is what the
   * household typed in for that card on that day: those rows pay the card themselves, so the low point takes only the
   * debt beside them off on that day (the same rule as `reconcileCardPayments` inside the window).
   */
  laterCardDebts: { cardId: string; name: string; cents: number; date: IsoDate; typedCents: number }[];
  /**
   * The cards of `cardDebts` whose payer the rows do not prove to be the pool alone: no payment to the card is seen, or
   * payments are seen from the pool and from outside it. Their debt is taken off whole all the same, so the figure
   * does not show free money the debt may claim. There is no cap: a debt larger than the money takes `freeCents` below zero. This says which part of the debt rests on that and why. Empty when every payer is proven.
   */
  unresolved: UnresolvedCard[];
  /** The `cardDebts` added up. */
  cardDebtCents: number;
  /**
   * Per card that owes something: what was paid to it with no leg on the card, booked on or before the day its balance
   * stands for or with no such day (`claimUnknown`). Its balance may or may not hold it, so the debt is left whole and
   * the money free is never more than it is. Absent when no card has such a payment.
   */
  unshown?: { cardId: string; name: string; cents: number }[];
  /** `startCents` less `totals.leavingCents` (the payments and the own transfers) and `cardDebtCents`. Nothing else is taken off and no pay is added, so it is below zero when these exceed the balance. */
  freeCents: number;
  /**
   * The most the account lacks at a payment of the window, the pay dated before the payment's day counted: `-freeCents`
   * when no pay comes before a payment and that is below zero (a card's debt has no day, so it is in `freeCents` only). What a balance below zero lacks before any payment
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
   * What an account the balance leaves out pays (`outside`), as far as the window reaches when that is past the 30 days
   * of `upcoming`: in no figure of the window. Yhteenveto names their sum before the payday and Laskut lists them there.
   */
  outside: AheadRow[];
  /**
   * The expected everyday spending of a day in the running month, in whole cents, over every account in view, a card's
   * purchases included (`expectedEverydayPerDay`). Taken off none of these figures: the runway (`runwayOf`) takes off
   * the part the counted accounts pay before the payday. 0 under three complete months or when a linked card's
   * purchases are missing from them.
   */
  everydayPerDayCents: number;
  totals: AheadTotals;
  /**
   * What the counted accounts pay on the day of the pay that ends the window, from that pay: the bills dated that day,
   * found however far off it is, and on the payday itself the bills that follow the pay (`withPay`). In no figure of the
   * window, so a household whose bills fall on the payday reads no payments before it; Yhteenveto says this sum apart.
   * 0 without a pay that ends the window. Own transfers are not in it.
   */
  paydayCents: number;
  /** null unless every counted checking account has a balance. */
  balance: AheadBalance | null;
  /** Why the balance has no figures: "balance" when a counted checking account has no balance given, "card" when a card in view has none (what it owes is part of what is free). */
  missing: "balance" | "card" | null;
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

/** What a figure of the window rests on: the window, the counted checking accounts' balances of today and the pays the payday's estimate counts. */
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
  const pool = poolOf(balances);
  const counted = pool.ids.size ? pool : null;
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
  // the counted accounts' payments reach the day of the pay that ends the window too: `paydayCents` holds that day's
  const reachPayday = next && next.day > reachPayments ? next.day : reachPayments;
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
      for (const c of expectedCharges([{ ...s, nextDate: o.due }], from, o.due, expected)) if (c.date <= reachPayday) all.push({ ...chargeRow(c), pending: true });
    }
  }
  for (const c of expectedCharges(paying.filter((s) => !withPay(s)), from, reachPayday, expected)) all.push(chargeRow(c));
  for (const c of expectedCharges(paying.filter(withPay), from, reachPayday, expected)) all.push(c.date === from ? { ...chargeRow(c), withPay: true } : chargeRow(c));
  // a typed bill names its card only by the card's own account number, and only when one connected card has it
  const cardByIban = new Map<string, string | null>();
  for (const a of ctx.accounts) {
    const key = a.type === "credit_card" ? normalizeIban(a.iban) : null;
    if (key) cardByIban.set(key, cardByIban.has(key) ? null : a.id);
  }
  for (const b of expectedBillRows(ctx, inputs.expectedBills, from, reachPayday)) {
    const cardId = b.payeeIban ? cardByIban.get(b.payeeIban) : null;
    all.push({ date: b.date, name: b.name, category: b.category, cents: -b.amountCents, source: "expected", ...(cardId ? { cardId } : {}) });
  }
  // what a card or an account outside the balance pays is in Laskut's 30 days and not in the window; a card's is marked
  const cards = new Set(ctx.accounts.filter((a) => a.type === "credit_card").map((a) => a.id));
  const onCard = (s: RecurringSeries) => cards.has(parseSeriesId(s.id)?.accountId ?? "");
  const outside = ctx.recurring.filter((s) => !onCounted(s));
  // an account's rows are found to the window's end too: a payday can be more than 30 days off
  const accountOf = new Map(ctx.accounts.map((a) => [a.id, a]));
  const outsideRows = outside
    .filter((s) => !onCard(s))
    .flatMap((s) => {
      const a = accountOf.get(parseSeriesId(s.id)?.accountId ?? "");
      return expectedCharges([s], from, reachPayments, expected).map((c): AheadRow => ({ ...chargeRow(c), outside: true, ...(a ? { account: { name: a.name, digits: accountDigits(a) } } : {}) }));
    })
    // as `expectedCharges` orders one list: by day, the larger first
    .sort((a, b) => a.date.localeCompare(b.date) || (a.cents ?? 0) - (b.cents ?? 0));
  const elsewhere = [
    ...outsideRows.filter((r) => r.date <= thirty),
    ...expectedCharges(outside.filter(onCard), from, thirty, expected).map((c): AheadRow => ({ ...chargeRow(c), onCard: true })),
  ];
  // the moves are found to the end of Laskut's 30 days: a card's bill is in the list like any bill, a transfer is not
  const { moves, asItGoes, settling, unapplied, unshown } = counted ? expectedMoves(ctx, counted.ids, balances, from, reachPayday) : { moves: [], asItGoes: new Set<string>(), settling: [], unapplied: new Map<string, number>(), unshown: new Map<string, number>() };
  // every card in view owes what `creditUse` says, null while its balance is not known. The payments that pay a card are
  // reconciled with that debt in one place (`reconcileCardPayments`), whatever way they reach it
  const debts = householdDebts(balances, inputs, from);
  const used = new Map(
    balances
      .filter((b) => b.type === "credit_card")
      .map((b) => {
        const debt = cardDebtOf(debts, b);
        return [b.id, debt ? creditUse(debt, from).usedCents : null] as const;
      }),
  );
  const typedToCards = all.flatMap((r): TypedCardBill[] => (r.source === "expected" && r.cardId ? [{ cardId: r.cardId, date: r.date, amountCents: Math.abs(centsOf(r)) }] : []));
  // a row of the window is one that `rows` keeps
  const inWindow = (date: IsoDate) => date <= to;
  const reconciled = reconcileCardPayments({ used, unapplied, typed: typedToCards, predicted: moves, inWindow });
  for (const m of reconciled.predicted) {
    all.push({ date: m.date, name: m.name, category: "transfer", cents: -m.amountCents, source: m.source, ...(m.basis ? { basis: m.basis } : {}), ...(m.cardId ? { cardId: m.cardId } : {}) });
  }
  const upcoming = [...all.filter((r) => r.source !== "income" && r.source !== "transfer" && r.date <= thirty), ...elsewhere].sort(byDay);
  // a payment of the day the pay lands on, paid from it: dated that day after the window, or following the pay that is due today
  const fromPay = (r: AheadRow) => r.source !== "income" && r.source !== "transfer" && !!next && ((r.date === next.day && r.date > to) || !!r.withPay);
  const paydayCents = all.reduce((sum, r) => (fromPay(r) ? sum + Math.abs(centsOf(r)) : sum), 0);
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
  const base = { from, to, days, reason, payday, rows, upcoming, outside: outsideRows.sort(byDay), everydayPerDayCents: expectedEverydayPerDay(ctx, monthOf(from)), totals, paydayCents };
  const evidence: Pay[] = payday?.pay && paySeries ? payEvidence(regularOf(paySeries), from) : [];
  const periods = comingList(ctx, inputs, found);
  // the rows are those of every counted account, so the figures need the balance of every one of them
  if (!checking.length || checking.length < counted!.accounts.length) return { ahead: { ...base, balance: null, missing: "balance" }, direct, settling, checking, pays: evidence, coming: periods };

  // every card in view takes its whole debt off what is free. A card whose balance is not known leaves the figure unsaid, not 0
  if ([...used.values()].some((cents) => cents === null)) return { ahead: { ...base, balance: null, missing: "card" }, direct, settling, checking, pays: evidence, coming: periods };
  // a bill of the window holds part of the debt: only the rest is taken off besides it, never the debt twice
  const payments = cardPayments(ctx);
  const owing = balances.flatMap((b) => {
    const rest = reconciled.rest.get(b.id) ?? 0;
    return rest > 0 && poolPays(pool, payments, b.id) ? [{ cardId: b.id, name: b.name, cents: rest }] : [];
  });
  // a card's next bill: the first day of its predicted, settling or typed bills. A debt whose bill falls after the window waits for it
  const nextBill = new Map<string, IsoDate>();
  for (const { cardId, date } of [...moves.flatMap((m) => (m.cardId ? [{ cardId: m.cardId, date: m.date }] : [])), ...settling, ...typedToCards]) {
    if ((nextBill.get(cardId) ?? date) >= date) nextBill.set(cardId, date);
  }
  const laterCardDebts = owing.flatMap((d) => {
    const date = nextBill.get(d.cardId);
    const typedCents = typedToCards.filter((t) => t.cardId === d.cardId && t.date === date).reduce((n, t) => n + t.amountCents, 0);
    return date !== undefined && date > to ? [{ ...d, date, typedCents }] : [];
  });
  const cardDebts = owing.filter((d) => !laterCardDebts.some((l) => l.cardId === d.cardId));
  const cardDebtCents = cardDebts.reduce((sum, c) => sum + c.cents, 0);
  const unresolved = unresolvedCards(pool, payments, cardDebts);
  // named whether a bill of the window holds the debt or not: the household is told of the payment either way
  const unshownCards = balances.flatMap((b) => {
    const cents = unshown.get(b.id) ?? 0;
    return cents > 0 && (used.get(b.id) ?? 0) > 0 ? [{ cardId: b.id, name: b.name, cents }] : [];
  });

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
  const balance: AheadBalance = { startCents, counts: pool.kind, accounts: checking.length, balanceAt: stamps[0] ?? null, cardDebts, laterCardDebts, unresolved, cardDebtCents, ...(unshownCards.length ? { unshown: unshownCards } : {}), freeCents: startCents - totals.leavingCents - cardDebtCents, shortCents: Math.max(0, -lowest), shortOn };
  return { ahead: { ...base, balance, missing: null }, direct, settling, checking, pays: evidence, coming: periods };
}
