/**
 * Decision: does the money hold out past the next payday, and if it dips, on which day and how far, so the household
 * moves money or puts a purchase off before that day.
 *
 * Alin saldo starts from the figure Käytettävissä starts from: the counted accounts' balance of today less the cards'
 * debt that no bill of the payday window holds (`ahead.balance.cardDebtCents`, taken off whole from today). It walks
 * through the rows of the bill calendar (`billCalendar`: the bills, the loan payments, the regular savings and the pays)
 * day by day for `days` days, today included, and takes the expected everyday spending off as it goes. A pay counts for
 * the payments of the days after its own: on a day with a payment and a pay, the payment is met from the balance before
 * it, as in `aheadBasis`. A card's bill beyond the window holds that same debt, so its row is left out of the walk, never
 * taking the debt off twice.
 *
 * The everyday spending is what `runwayOf` takes off (`expectedEveryday`): what the counted accounts pay themselves, and
 * a card's purchases once its next bill falls. The line is the balance of the counted accounts, so a card's purchases
 * leave it with a bill, never on the day they are made. A card's purchases after its next bill, or with no bill to come,
 * wait for a bill that no row of the walk holds: its day is not known, and the runway takes them off nothing up to the
 * payday. So the walk takes them off together on the day after the payday (the earliest day a bill the runway leaves out
 * can fall), and day by day from then on: the figure answers how low the money can go, and on the payday the line is
 * `runwayOf`'s Jää palkkapäivänä. A card that is not connected and shows only as its bills (a card_bill series
 * of the counted accounts) is walked the same way: its bills of the payday window and of Laskut's 30 days (`ahead.rows`,
 * `ahead.upcoming`) are rows of the walk, as Käytettävissä takes them, and hold its purchases up to their day, so its
 * bills' sums spread over the base months' days (`expectedEveryday`, every card_bill row of its name on the counted
 * accounts, as the runway leaves out every card_bill row) wait for the bill after the last of them. With none of the
 * spending, inside the payday window the lowest point is the one `aheadBasis` finds (`shortOn`, `shortCents`).
 *
 * The lowest day is the one of the expected everyday spending. The range is the lowest balance when the base months
 * with the most everyday spending repeat to when the ones with the least do, so `lowCents <= cents <= highCents`.
 * Without a payday, a balance or a history to expect everyday spending from, it gives the reason `runwayOf` gives, and
 * while a bill's sum is not known and it falls on or before the last day looked at, or its day is not known (`unknowns` of
 * the calendar), it says so: a figure with a bill missing would pass for a safe one. An unknown bill beyond the last day, one
 * a card pays and a pay that is not known leave the figure as it is: none of them can make the lowest balance lower.
 *
 * The walk is also told day by day for the first page's chart (`line`, `steps`), so the chart and the figure are one
 * walk: the lowest corner of the line is the figure, on its day.
 */
import type { AheadBasis } from "./analysis/ahead.ts";
import type { AnalysisContext, AnalysisTx } from "./analysis/context.ts";
import { everydaySpans } from "./analysis/expected.ts";
import { type Runway, runwayOf } from "./analysis/runway.ts";
import { addDays, monthOf } from "./dates.ts";
import { billCalendar, unknownPaymentBy } from "./reports/bill-calendar.ts";
import { AHEAD_DAYS, LOW_POINT_DAYS } from "./thresholds.ts";
import { openCardRows } from "./unconnected-cards.ts";
import type { BalanceInput, IsoDate, UserInputs } from "./types.ts";

export type LowPoint =
  | {
      known: false;
      /** The reasons of `runwayOf`, and "bills": the sum or day of a bill is not known. */
      reason: Extract<Runway, { known: false }>["reason"] | "bills";
      /** The days the figure looks at, to say what it is the lowest balance of. */
      days: number;
      /** Only with the reason "cards": whether a card row of Täydennä lainat is open to answer. False once En tiedä has set each aside, and then the statement is the way to mend it. */
      cardRowOpen?: boolean;
    }
  | {
      known: true;
      /** The day the balance is lowest, the first of them when two days tie. */
      date: IsoDate;
      /** The lowest balance with the expected everyday spending taken off, and its range. Below zero when the accounts do not hold out. */
      cents: number;
      lowCents: number;
      highCents: number;
      /** The days looked at, from today. */
      days: number;
      /**
       * The balance of the walk as a line, date ascending, from today to the last day looked at. A day has a corner for
       * the balance after its payments, with the spending of the days before it taken off (the figure's own measure, so
       * the lowest corner is the figure). A day whose payments move the balance has a corner before it, what
       * the day opens with, and a day with a pay one after it, the pay in: corners of one date are a step, down by the
       * payments and then up by the pay. Between days the line falls by a day's expected spending. Each corner has the
       * range of that spending, `lowCents <= cents <= highCents`.
       */
      line: LowPointCorner[];
      /** The payments and pays of the walk, date ascending; within a day the calendar's order (`billCalendar`), the bills of a card shown only by them last. */
      steps: LowPointStep[];
      /**
       * The balance of today after the cards' debt that no bill of the walk holds, and that debt: what the table starts
       * from, so its balance column adds up row by row with `spending` and `steps`.
       */
      startCents: number;
      cardDebtCents: number;
      /**
       * The spending taken off between two step days, date ascending: before the steps of `date`, for the days `since`
       * to `until`. `afterCents` is the balance once the row is taken off, so the balance of the earlier step day (or
       * `startCents`) plus the sums of the rows before a step day is the balance before that day's steps. "everyday" is what
       * the counted accounts pay themselves; "cards" is what the cards' purchases that no bill of the walk holds take (the
       * lump on the day after the payday, and a card's purchases on its bill's day), in the gaps that begin before that day.
       * After it the cards' purchases are part of the everyday row.
       */
      spending: LowPointSpending[];
    };

/** A corner of the balance line of `lowPoint`. */
interface LowPointCorner {
  date: IsoDate;
  cents: number;
  lowCents: number;
  highCents: number;
}

/** Expected spending taken off between two days of the steps. */
interface LowPointSpending {
  date: IsoDate;
  since: IsoDate;
  until: IsoDate;
  kind: "everyday" | "cards";
  /** Negative. */
  cents: number;
  afterCents: number;
}

/** A payment or a pay the balance of `lowPoint` steps by. */
interface LowPointStep {
  date: IsoDate;
  /** The merchant, the lender's loan, the card or the payer. */
  payee: string;
  /** Negative for a payment, positive for a pay. */
  cents: number;
  /** A sum that is the usual of a series whose charges vary, or a pay beyond the next two, rather than a known one. */
  estimate: boolean;
  /** The balance at the end of its day, after all its payments and pays and the spending to it: the same for every step of a day, the line's own figure. */
  afterCents: number;
  /** The balance after this step in the table: the one before it (the day's opening, or the step before it that day) plus its sum. The last step of a day ends at `afterCents`. */
  rowAfterCents: number;
}

/** The expected everyday spending taken off by the end of a day: its mean, and the lower and upper quartile of the base months. */
interface Spent {
  cents: number;
  lowCents: number;
  highCents: number;
}

const NONE: Spent = { cents: 0, lowCents: 0, highCents: 0 };
const plus = (a: Spent, b: Spent): Spent => ({ cents: a.cents + b.cents, lowCents: a.lowCents + b.lowCents, highCents: a.highCents + b.highCents });

/** The lowest balance of the next `days` days, with the day it falls on; the reason when it cannot be said. */
export function lowPoint(ctx: AnalysisContext, basis: Pick<AheadBasis, "ahead" | "direct" | "settling">, balances: readonly BalanceInput[], inputs: UserInputs, days: number = LOW_POINT_DAYS): LowPoint {
  const { ahead, direct, settling } = basis;
  const runway = runwayOf(ctx, basis);
  if (!runway.known) {
    if (runway.reason !== "cards") return { known: false, reason: runway.reason, days };
    const { cards, gaps } = openCardRows(ctx, inputs);
    return { known: false, reason: runway.reason, days, cardRowOpen: cards.length + gaps.length > 0 };
  }
  if (!direct || !ahead.balance) return { known: false, reason: "no-balance", days };
  const calendar = billCalendar(ctx, inputs, balances);
  const { from } = ahead;
  const last = addDays(from, days - 1);
  if (unknownPaymentBy(calendar, last)) return { known: false, reason: "bills", days };
  // a card's bill beyond the payday window holds the debt that is taken off whole from today: it is no row of the walk
  const heldByDebt = new Set(ahead.upcoming.flatMap((r) => (r.source === "card" && r.basis === "balance" && r.cents && r.date > ahead.to ? [`${r.date}|${r.name}|${Math.abs(r.cents)}`] : [])));
  const rows = calendar.months
    .flatMap((m) => m.rows)
    .filter((r) => r.state !== "paid" && !r.onCard && r.date >= from && r.date <= last && !(r.seriesId === null && r.kind === "bill" && heldByDebt.has(`${r.date}|${r.payee}|${r.cents}`)));
  // the bills of a card shown only by them, which the bill calendar leaves out. `upcoming` reaches Laskut's 30 days and
  // `rows` the payday window, which can be longer: the window's rows after the 30 days complete the list, none twice
  const thirty = addDays(from, AHEAD_DAYS);
  const cardBills = [...ahead.upcoming, ...ahead.rows.filter((r) => r.date > thirty)].filter((r) => r.source === "recurring" && r.category === "card_bill" && !r.onCard && !r.outside && r.cents && r.date >= from && r.date <= last);
  // by payee, the day of the last one walked
  const billOnly = new Map<string, IsoDate>();
  for (const r of cardBills) if ((billOnly.get(r.name) ?? r.date) <= r.date) billOnly.set(r.name, r.date);
  // a card_bill row of a counted account paid that card's purchases, whether its series holds it or not
  const paysBillOnly = (t: AnalysisTx, name: string) => t.category === "card_bill" && t.merchant === name && direct.has(t.accountId);
  const heldByBills = (t: AnalysisTx) => billOnly.has(t.merchant) && paysBillOnly(t, t.merchant);
  // a regular transfer to an account the balance does not count: Käytettävissä takes it off, and the bill calendar has no row of it
  const transfers = ahead.rows.filter((r) => r.source === "transfer" && r.cents && r.date >= from && r.date <= last);
  const income = rows.filter((r) => r.kind === "income");
  const payments: { date: IsoDate; cents: number }[] = [...rows.filter((r) => r.kind !== "income"), ...[...cardBills, ...transfers].map((r) => ({ date: r.date, cents: Math.abs(r.cents!) }))];
  const moves = [
    ...rows.map((r) => ({ date: r.date, payee: r.payee, cents: r.kind === "income" ? r.cents : -r.cents, estimate: r.state === "estimate" })),
    // a card shown only by its bills: a bill is the usual of its series
    ...cardBills.map((r) => ({ date: r.date, payee: r.name, cents: -Math.abs(r.cents!), estimate: true })),
    ...transfers.map((r) => ({ date: r.date, payee: r.name, cents: -Math.abs(r.cents!), estimate: false })),
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // the cards' debt of today is taken off whole, as Käytettävissä does: the day a bill falls is never guessed
  const startCents = ahead.balance.startCents - ahead.balance.cardDebtCents;

  // the base months of today's month, for every span, so the spans of one walk read the same months
  const month = monthOf(from);
  // the days of the rows `keep` takes are read once, then each span of them is a sum
  const costOf = (keep: (t: AnalysisTx) => boolean) => {
    const spans = everydaySpans(ctx, keep, month);
    return (since: IsoDate, until: IsoDate): Spent => (until < since || typeof spans === "string" ? NONE : spans(since, until));
  };
  // the cards the pool pays, as far as the rows show: one with a bill coming, one paid in full, or one that owes something
  const payers = new Set([...settling.map((s) => s.cardId), ...ahead.balance.cardDebts.map((c) => c.cardId), ...ahead.upcoming.flatMap((r) => (r.source === "card" && r.cardId ? [r.cardId] : []))]);
  const cards = ctx.accounts.filter((a) => a.type === "credit_card" && !direct.has(a.id) && payers.has(a.id));
  const billDay = new Map(settling.map((s) => [s.cardId, s.date] as const));
  // the runway's own: what the counted accounts pay themselves, every card_bill row left out
  const ownCost = costOf((t) => direct.has(t.accountId) && t.category !== "card_bill");
  const cardCosts = cards.map(({ id }) => ({ bill: billDay.get(id), cost: costOf((t) => t.accountId === id) }));
  const billOnlyCosts = [...billOnly].map(([name, bill]) => ({ since: addDays(bill, 1), cost: costOf((t) => paysBillOnly(t, name)) }));
  // the card_bill rows of the counted accounts that no bill of the walk holds
  const looseBills = costOf((t) => direct.has(t.accountId) && t.category === "card_bill" && !heldByBills(t));
  // the day the purchases that no bill of the walk holds leave the account: the day after the runway's payday
  const afterPayday = addDays(runway.payday.date, 1);
  // what has gone on everyday spending by the start of `day`, whose own days are not spent yet
  const spentBefore = (day: IsoDate): Spent => {
    const before = addDays(day, -1);
    // purchases a bill that falls later holds, taken off once the payday is behind
    const waiting = (cost: (since: IsoDate, until: IsoDate) => Spent, since: IsoDate) => (day >= afterPayday ? cost(since, before) : NONE);
    let spent = ownCost(from, before);
    for (const { bill, cost } of cardCosts) {
      // the purchases of a card from tomorrow to its bill leave with the bill, as the runway takes them off
      if (bill !== undefined && bill <= day) spent = plus(spent, cost(addDays(from, 1), bill));
      spent = plus(spent, waiting(cost, bill === undefined ? addDays(from, 1) : addDays(bill, 1)));
    }
    // a card shown only by its bills: its bills hold its purchases to the last one's day, the bill after it is not known
    for (const { since, cost } of billOnlyCosts) spent = plus(spent, waiting(cost, since));
    return plus(spent, waiting(looseBills, from));
  };

  // the balance falls with a payment and with a card's bill, and rises only with a pay: its lowest points are those days and the last
  const billDays = [...billDay.values()].filter((d) => d >= from && d <= last);
  const checked = [...new Set([...rows.map((r) => r.date), ...cardBills.map((r) => r.date), ...transfers.map((r) => r.date), ...billDays, last])].sort();
  const sum = (list: readonly { date: IsoDate; cents: number }[], keep: (date: IsoDate) => boolean) => list.reduce((total, r) => (keep(r.date) ? total + r.cents : total), 0);
  // the spending before each day of the walk, read once for the figure and the line
  const spentBy = new Map<IsoDate, Spent>();
  for (let day = from; day <= last; day = addDays(day, 1)) spentBy.set(day, spentBefore(day));
  const spentAt = (day: IsoDate) => spentBy.get(day)!;
  // what the payments and pays have left by the day's payments: a pay counts from the day after its own
  const heldOn = (day: IsoDate) => startCents + sum(income, (d) => d < day) - sum(payments, (d) => d <= day);
  const corner = (date: IsoDate, held: number, spent: Spent): LowPointCorner => ({ date, cents: held - spent.cents, lowCents: held - spent.highCents, highCents: held - spent.lowCents });
  let point = { date: last, cents: Infinity };
  let [lowest, highest] = [Infinity, Infinity];
  for (const day of checked) {
    const { cents, lowCents, highCents } = corner(day, heldOn(day), spentAt(day));
    if (cents < point.cents) point = { date: day, cents };
    lowest = Math.min(lowest, lowCents);
    highest = Math.min(highest, highCents);
  }
  const paidIn = (day: IsoDate) => sum(income, (d) => d === day);
  const same = (a: LowPointCorner, b: LowPointCorner) => a.cents === b.cents && a.lowCents === b.lowCents && a.highCents === b.highCents;
  const line: LowPointCorner[] = [];
  for (let day = from; day <= last; day = addDays(day, 1)) {
    const before = addDays(day, -1);
    // what the day opens with: the day before with its pay, less its spending
    const opened = corner(day, heldOn(before) + paidIn(before), spentAt(day));
    const paid = corner(day, heldOn(day), spentAt(day));
    const landed = corner(day, heldOn(day) + paidIn(day), spentAt(day));
    if (day > from && !same(opened, paid)) line.push(opened);
    line.push(paid);
    if (!same(paid, landed)) line.push(landed);
  }
  const afterOf = (day: IsoDate) => heldOn(day) + paidIn(day) - spentAt(day).cents;

  // the spending between the days of the steps, from the same walk: each row is the change of the spending taken off
  const spending: LowPointSpending[] = [];
  const ownAt = (day: IsoDate) => ownCost(from, addDays(day, -1)).cents;
  let since: IsoDate = from;
  let running = startCents;
  let spentThen = 0;
  let ownThen = 0;
  // the balance each step day opens its steps with: the spending rows before them are taken off
  const openedBy = new Map<IsoDate, number>();
  for (const date of [...new Set(moves.map((m) => m.date))]) {
    const total = spentAt(date).cents;
    const own = ownAt(date);
    const until = date > since ? addDays(date, -1) : since;
    // from the day after the payday on, the cards' purchases are daily spending like the rest
    const parts: [LowPointSpending["kind"], number][] = since < afterPayday ? [["everyday", own - ownThen], ["cards", total - spentThen - (own - ownThen)]] : [["everyday", total - spentThen]];
    for (const [kind, delta] of parts) {
      if (delta === 0) continue;
      running -= delta;
      spending.push({ date, since, until, kind, cents: -delta, afterCents: running });
    }
    openedBy.set(date, running);
    since = date;
    running = afterOf(date);
    spentThen = total;
    ownThen = own;
  }
  const stepped = new Map<IsoDate, number>();
  const steps = moves.map((m) => {
    const rowAfterCents = (stepped.get(m.date) ?? openedBy.get(m.date)!) + m.cents;
    stepped.set(m.date, rowAfterCents);
    return { ...m, afterCents: afterOf(m.date), rowAfterCents };
  });
  return { known: true, date: point.date, cents: point.cents, lowCents: lowest, highCents: highest, days, line, steps, startCents, cardDebtCents: ahead.balance.cardDebtCents, spending };
}

/**
 * Jää palkkapäivänä told in the rows of the walk that make it: the payments of the days up to the payday, the payday's own
 * included and its pay left out (it lands after them), and the spending rows taken off before the payday's steps. With the
 * balance after the cards' debt (`startCents`) they add up to `leftCents`, the figure of `runwayOf`, to the cent. null when
 * they do not (a payday with no step of its own, a pay before it that the runway leaves out): the figure then has no working to show.
 */
export function paydayParts(low: Extract<LowPoint, { known: true }>, payday: IsoDate, leftCents: number) {
  const steps = low.steps.filter((s) => s.date < payday || (s.date === payday && s.cents < 0));
  const spending = low.spending.filter((p) => p.date <= payday);
  const total = [...steps, ...spending].reduce((n, r) => n + r.cents, low.startCents);
  return total === leftCents ? { balanceCents: low.startCents + low.cardDebtCents, steps, spending } : null;
}
