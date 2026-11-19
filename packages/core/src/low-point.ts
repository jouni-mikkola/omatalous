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
 * a card's purchases once its next bill falls. A card's purchases after that bill, or with no bill to come, have no row
 * to leave the account with, so they are taken off the day they are made: the later bill's day is not known, and the
 * figure answers how low the money can go. A card that is not connected and shows only as its bills (a card_bill series
 * of the counted accounts) is walked the same way: its bills of the payday window and of Laskut's 30 days (`ahead.rows`,
 * `ahead.upcoming`) are rows of the walk, as Käytettävissä takes them, and hold its purchases up to their day, so its
 * bills' sums spread over the base months' days (`expectedEveryday`, every card_bill row of its name on the counted
 * accounts, as the runway leaves out every card_bill row) are taken off only after the last of them. With none of the
 * spending, inside the payday window the lowest point is the one `aheadBasis` finds (`shortOn`, `shortCents`).
 *
 * The lowest day is the one of the expected everyday spending. The range is the lowest balance when the base months
 * with the most everyday spending repeat to when the ones with the least do, so `lowCents <= cents <= highCents`.
 * Without a payday, a balance or a history to expect everyday spending from, it gives the reason `runwayOf` gives, and
 * while a bill's sum is not known and it falls on or before the last day looked at, or its day is not known (`unknowns` of
 * the calendar), it says so: a figure with a bill missing would pass for a safe one. An unknown bill beyond the last day, one
 * a card pays and a pay that is not known leave the figure as it is: none of them can make the lowest balance lower.
 */
import type { AheadBasis } from "./analysis/ahead.ts";
import type { AnalysisContext, AnalysisTx } from "./analysis/context.ts";
import { expectedEveryday } from "./analysis/expected.ts";
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
    };

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
  const income = rows.filter((r) => r.kind === "income");
  const payments: { date: IsoDate; cents: number }[] = [...rows.filter((r) => r.kind !== "income"), ...cardBills.map((r) => ({ date: r.date, cents: Math.abs(r.cents!) }))];

  // the cards' debt of today is taken off whole, as Käytettävissä does: the day a bill falls is never guessed
  const startCents = ahead.balance.startCents - ahead.balance.cardDebtCents;

  // the base months of today's month, for every span, so the spans of one walk read the same months
  const month = monthOf(from);
  const cost = (since: IsoDate, until: IsoDate, keep: (t: AnalysisTx) => boolean): Spent => {
    if (until < since) return NONE;
    const found = expectedEveryday(ctx, since, until, keep, month);
    return typeof found === "string" ? NONE : found;
  };
  // the cards the pool pays, as far as the rows show: one with a bill coming, one paid in full, or one that owes something
  const payers = new Set([...settling.map((s) => s.cardId), ...ahead.balance.cardDebts.map((c) => c.cardId), ...ahead.upcoming.flatMap((r) => (r.source === "card" && r.cardId ? [r.cardId] : []))]);
  const cards = ctx.accounts.filter((a) => a.type === "credit_card" && !direct.has(a.id) && payers.has(a.id));
  const billDay = new Map(settling.map((s) => [s.cardId, s.date] as const));
  // what has gone on everyday spending by the start of `day`, whose own days are not spent yet
  const spentBefore = (day: IsoDate): Spent => {
    let spent = cost(from, addDays(day, -1), (t) => direct.has(t.accountId) && !heldByBills(t));
    for (const { id } of cards) {
      const bill = billDay.get(id);
      const mine = (t: AnalysisTx) => t.accountId === id;
      // the purchases of a card from tomorrow to its bill leave with the bill, as the runway takes them off
      if (bill !== undefined) {
        if (bill <= day) spent = plus(plus(spent, cost(addDays(from, 1), bill, mine)), cost(addDays(bill, 1), addDays(day, -1), mine));
      } else spent = plus(spent, cost(addDays(from, 1), addDays(day, -1), mine));
    }
    // a card shown only by its bills: its bills hold its purchases to the last one's day, after it they go day by day
    for (const [name, bill] of billOnly) spent = plus(spent, cost(addDays(bill, 1), addDays(day, -1), (t) => paysBillOnly(t, name)));
    return spent;
  };

  // the balance falls with a payment and with a card's bill, and rises only with a pay: its lowest points are those days and the last
  const billDays = [...billDay.values()].filter((d) => d >= from && d <= last);
  const checked = [...new Set([...rows.map((r) => r.date), ...cardBills.map((r) => r.date), ...billDays, last])].sort();
  const sum = (list: readonly { date: IsoDate; cents: number }[], keep: (date: IsoDate) => boolean) => list.reduce((total, r) => (keep(r.date) ? total + r.cents : total), 0);
  let point = { date: last, cents: Infinity };
  let [lowest, highest] = [Infinity, Infinity];
  for (const day of checked) {
    const held = startCents + sum(income, (d) => d < day) - sum(payments, (d) => d <= day);
    const spent = spentBefore(day);
    const cents = held - spent.cents;
    if (cents < point.cents) point = { date: day, cents };
    lowest = Math.min(lowest, held - spent.highCents);
    highest = Math.min(highest, held - spent.lowCents);
  }
  return { known: true, date: point.date, cents: point.cents, lowCents: lowest, highCents: highest, days };
}
