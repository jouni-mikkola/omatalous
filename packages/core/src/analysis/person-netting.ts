/**
 * Money between people nets inside a month. Decision: whether what came in from people is income or the other half of
 * what was sent to them.
 *
 * Money from a person that no rule, pair or answer placed (Maksut henkilöiltä, income that is not earned) is a share
 * of what the household sent to people (Maksut henkilöille) when the same month holds enough of it: the row lowers
 * Maksut henkilöille as a row with its minus, so the spending shows what the household paid in the end. Income less
 * spending stays what it was, since the cents leave the income and the spending together, and Tulos is the same with
 * and without the netting. A row the month's payments cannot hold whole stays income, so a month that took in more
 * than it sent shows the surplus as Maksut henkilöiltä, which is no earned income.
 *
 * A row the user categorised, or whose payer the user answered for (a role), is the user's word and is never netted.
 * Neither is money from a steady payer (a lodger's rent, an allowance): that is regular income whatever else the month
 * sent. The result depends on the rows only, not on their order.
 */
import { payerKeyOf, steadyPayers } from "../payer-role.ts";
import type { AnalysisTx } from "./context.ts";

/** Maksut henkilöille: money in on it is from a person. */
const TO_PERSONS = "p2p";
/** Maksut henkilöiltä. */
const FROM_PERSONS = "p2p_in";

type Row = Pick<AnalysisTx, "id" | "counterparty" | "counterpartyIban" | "bookingDate" | "day" | "amountCents" | "category" | "categorySource" | "spend" | "refunded" | "isTransfer" | "flows">;

/** The payments a row takes back, with the cents of each: the shape `moneyIn` gives a refund. */
type Netting = readonly (readonly [paymentId: string, cents: number])[];

const monthOfRow = (t: Pick<Row, "bookingDate">) => t.bookingDate.slice(0, 7);
const byDay = (a: Pick<Row, "day" | "id">, b: Pick<Row, "day" | "id">) => a.day - b.day || (a.id < b.id ? -1 : 1);

/** Every row of money from people that nets against the payments to people of its month, by its id. Call it after `moneyIn` was applied. */
export function netPersons(rows: readonly Row[]): Map<string, Netting> {
  const out = new Map<string, Netting>();
  const incoming = rows
    .filter(
      (t) =>
        t.amountCents > 0 &&
        !t.isTransfer &&
        (t.category === FROM_PERSONS || t.category === TO_PERSONS) &&
        t.categorySource !== "user" &&
        t.categorySource !== "payer" &&
        // income as the flows read it: a refund that `moneyIn` already placed is no candidate
        t.flows.income === t.amountCents,
    )
    .sort(byDay);
  if (!incoming.length) return out;
  const steady = steadyPayers(rows);
  const open = new Map<string, { id: string; day: number; left: number }[]>();
  for (const t of rows) {
    const left = t.spend - t.refunded;
    if (t.category !== TO_PERSONS || t.amountCents >= 0 || t.isTransfer || left <= 0) continue;
    const list = open.get(monthOfRow(t));
    const payment = { id: t.id, day: t.day, left };
    if (list) list.push(payment);
    else open.set(monthOfRow(t), [payment]);
  }
  for (const list of open.values()) list.sort(byDay);
  for (const t of incoming) {
    if (steady.has(payerKeyOf(t) ?? "")) continue;
    const payments = open.get(monthOfRow(t)) ?? [];
    if (payments.reduce((sum, p) => sum + p.left, 0) < t.amountCents) continue;
    const taken: [string, number][] = [];
    let rest = t.amountCents;
    for (const p of payments) {
      if (rest === 0) break;
      const part = Math.min(rest, p.left);
      if (part === 0) continue;
      p.left -= part;
      rest -= part;
      taken.push([p.id, part]);
    }
    out.set(t.id, taken);
  }
  return out;
}
