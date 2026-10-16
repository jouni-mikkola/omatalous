/**
 * What money in on a spending category does to the sums. It lowers spending only as a refund; anything else is
 * income. So money that comes in never takes a month's spending below what was paid unless the user said so, and a
 * category nets below zero in two ways: a refund arrives in a later month than its payment, or the user put money in
 * on it by hand.
 *
 * - A refund: the same payee was paid from the accounts of the view in the days before the row in which the
 *   categoriser pairs a shop's refund (`REFUND_WINDOW_DAYS`), and the row is not larger than what is left of those
 *   payments. It lowers the category of the payments, in the month it arrives.
 * - A contract's closing refund (contract.ts): the payee's contract ended with its last payment within 60 days before the
 *   row, and the row is no more than the contract cost. It lowers the category of the contract's payments, the latest
 *   first, whatever the 120 days: a lease gives back more than one rent.
 * - A row whose category the user set by hand is a refund in that category, whatever the payee and the days: the
 *   user's word. It takes back the payee's payments of that category when they hold it, and no payment otherwise.
 * - Money from a person (a row on Maksut henkilöille) is never set against payments to persons. Two pairs the
 *   categorisation made stay (`pairedReturns`): a payment that came back whole from the person it was sent to, and
 *   friends' shares of a bill.
 * - Anything else is income, of the type `incomeTypeOf` gives it: money from a person, or a compensation or refund.
 *
 * The rows are the view's, as the view counts them: on a joint account the rule works on the member's part.
 */
import { closedContract } from "../contract.ts";
import { monthIndex } from "../dates.ts";
import type { WhyCollector } from "../explain/types.ts";
import type { IsoDate } from "../types.ts";
import { isNamed, pairedReturns, REFUND_WINDOW_DAYS } from "../returns.ts";
import type { AnalysisTx } from "./context.ts";

/** Maksut henkilöille: money in on it is from a person. */
const TO_PERSONS = "p2p";

type Row = Pick<AnalysisTx, "id" | "accountId" | "bookingDate" | "day" | "amountCents" | "merchant" | "counterparty" | "counterpartyIban" | "description" | "category" | "categorySource" | "spend" | "isTransfer" | "status">;

/**
 * The payments a refund takes back, with the cents of each. It lowers the category of the first; with none it lowers
 * the row's own category, which the user set.
 */
type Refund = readonly (readonly [paymentId: string, cents: number])[];

interface Payment {
  t: Row;
  /** Cents of the payment that have not come back. */
  left: number;
}

/**
 * Every row of money in that `flowsOf` reads as spending below zero, by its id: the refund it is, or null when it is
 * income. The result depends on the rows only, not on their order.
 */
export function moneyIn(rows: readonly Row[], ownIbans: ReadonlySet<string>, why?: WhyCollector, today?: IsoDate): Map<string, Refund | null> {
  const out = new Map<string, Refund | null>();
  // the view's today; the newest row where the caller gives none
  const now = today ?? rows.reduce((day, t) => (t.bookingDate > day ? t.bookingDate : day), "0000-00-00");
  const incoming = rows.filter((t) => t.amountCents > 0 && t.spend < 0).sort((a, b) => a.day - b.day || (a.id < b.id ? -1 : 1));
  if (!incoming.length) return out;
  const payments = new Map<string, Payment>();
  const byPayee = new Map<string, Payment[]>();
  for (const t of rows) {
    if (t.amountCents >= 0 || t.spend <= 0) continue;
    const p = { t, left: t.spend };
    payments.set(t.id, p);
    if (t.category === TO_PERSONS || !isNamed(t, ownIbans)) continue;
    const list = byPayee.get(t.merchant);
    if (list) list.push(p);
    else byPayee.set(t.merchant, [p]);
  }

  // the pairs that stay as they are: a shop's refund is told by the rule below, whatever pair it had
  const paired = pairedReturns(rows, ownIbans, now);
  // the user's category stands: such a row takes back only payments of the category it was put in
  const fits = (t: Row, p: Payment) => t.categorySource !== "user" || p.t.category === t.category;
  for (const t of incoming) {
    const p = payments.get(paired.get(t.id) ?? "");
    if (!p || p.left < t.amountCents || (p.t.category !== TO_PERSONS && p.t.merchant === t.merchant) || !fits(t, p)) continue;
    p.left -= t.amountCents;
    out.set(t.id, [[p.t.id, t.amountCents]]);
  }
  for (const t of incoming) {
    if (out.has(t.id)) continue;
    const paid = t.category === TO_PERSONS || !isNamed(t, ownIbans) ? [] : (byPayee.get(t.merchant) ?? []).filter((p) => fits(t, p));
    out.set(t.id, refundOf(t, paid) ?? contractRefundOf(t, paid, now) ?? (t.categorySource === "user" || t.categorySource === "payer" ? [] : null));
  }
  if (why) {
    const byId = new Map(rows.map((t) => [t.id, t]));
    for (const [id, refund] of out) {
      const at = monthIndex(byId.get(id)!.bookingDate.slice(0, 7));
      for (const [paymentId, cents] of refund ?? []) why.add(id, { rule: "refund.net", purchase: paymentId, months: at - monthIndex(byId.get(paymentId)!.bookingDate.slice(0, 7)), cents });
    }
  }
  return out;
}

/** The payee's payments that `t` takes back, or null when they do not hold it: the money is income then. */
function refundOf(t: Row, paid: readonly Payment[]): Refund | null {
  const cents = t.amountCents;
  const open = paid.filter((p) => p.left > 0 && p.t.day <= t.day && t.day - p.t.day <= REFUND_WINDOW_DAYS);
  if (open.reduce((sum, p) => sum + p.left, 0) < cents) return null;
  // a payment that holds the whole row first, then one of the row's own category, of the same sum, the latest
  const rank = (p: Payment) => 4 * Number(p.left >= cents) + 2 * Number(p.t.category === t.category) + Number(p.left === cents);
  open.sort((a, b) => rank(b) - rank(a) || b.t.day - a.t.day || (a.t.id < b.t.id ? -1 : 1));
  const taken: [string, number][] = [];
  let rest = cents;
  for (const p of open) {
    if (rest === 0) break;
    const part = Math.min(rest, p.left);
    p.left -= part;
    rest -= part;
    taken.push([p.t.id, part]);
  }
  return taken;
}

/** The payments of the contract that `t` closes, the latest first, or null when it closes none or they do not hold it. */
function contractRefundOf(t: Row, paid: readonly Payment[], today: IsoDate): Refund | null {
  const closed = closedContract(paid.map((p) => p.t), t, today);
  if (!closed) return null;
  const byId = new Map(paid.map((p) => [p.t.id, p]));
  const open = closed.map((row) => byId.get(row.id)!).filter((p) => p.left > 0).reverse();
  if (open.reduce((sum, p) => sum + p.left, 0) < t.amountCents) return null;
  const taken: [string, number][] = [];
  let rest = t.amountCents;
  for (const p of open) {
    if (rest === 0) break;
    const part = Math.min(rest, p.left);
    p.left -= part;
    rest -= part;
    taken.push([p.t.id, part]);
  }
  return taken;
}
