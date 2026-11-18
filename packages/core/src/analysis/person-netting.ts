/**
 * Money between people nets inside a month. Decision: whether what came in from a person is income or the other half
 * of what the household sent to that same person.
 *
 * Money from a person that no rule, pair or answer placed (Maksut henkilöiltä, income that is not earned) settles what
 * the household sent to the same person (Maksut henkilöille, one payer key, `identifiedPayerKeyOf`; an account that many
 * unrelated senders pay from is told apart by name, `pooledIbans`, the one set of the context) in the same month. The row
 * takes what is left of those payments, oldest first, and lowers Maksut henkilöille by that much, as a row with its
 * minus. Only the rest of the row stays income, as Maksut henkilöiltä, which is no earned income. Income less spending
 * stays what it was, since the cents leave the income and the spending together, and Tulos is the same with and
 * without the netting. Payments to other people are not touched, and a row that names nobody (unnamed wallet money) nets
 * with nothing, since its key is the key of every such row.
 *
 * A row the user categorised, or whose payer the user answered for (a role), is the user's word and is never netted.
 * Neither is money from a steady payer (a lodger's rent, an allowance): that is regular income whatever else the month
 * sent. A row the split guess claims (`splitShareIds`) is a friend's share of a bill, which is asked about, and is left
 * alone. The result depends on the rows only, not on their order.
 */
import { identifiedPayerKeyOf, steadyPayers } from "../payer-role.ts";
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

/**
 * Every row of money from a person that settles payments to the same person in its month, by its id, with what it takes
 * of each: less than its amount where the month sent less. Call it after `moneyIn` was applied. `pooled`: the accounts
 * that many senders pay from (`pooledIbans` of the rows). `claimed` gives the ids the split guess claims; it is asked
 * only when a row could net.
 */
export function netPersons(rows: readonly Row[], pooled: ReadonlySet<string>, claimed: () => ReadonlySet<string> = () => new Set()): Map<string, Netting> {
  const out = new Map<string, Netting>();
  const incoming = rows
    .filter(
      (t) =>
        t.amountCents > 0 &&
        !t.isTransfer &&
        t.category === FROM_PERSONS &&
        t.categorySource !== "user" &&
        t.categorySource !== "payer" &&
        // income as the flows read it: a refund that `moneyIn` already placed is no candidate
        t.flows.income === t.amountCents,
    )
    .sort(byDay);
  if (!incoming.length) return out;
  const open = new Map<string, { id: string; left: number }[]>();
  for (const t of [...rows].sort(byDay)) {
    const left = t.spend - t.refunded;
    const payer = identifiedPayerKeyOf(t, pooled);
    if (t.category !== TO_PERSONS || t.amountCents >= 0 || t.isTransfer || left <= 0 || !payer) continue;
    const key = `${monthOfRow(t)}|${payer}`;
    const list = open.get(key);
    if (list) list.push({ id: t.id, left });
    else open.set(key, [{ id: t.id, left }]);
  }
  if (!open.size) return out;
  const steady = steadyPayers(rows, pooled);
  const split = claimed();
  for (const t of incoming) {
    const payer = identifiedPayerKeyOf(t, pooled);
    if (!payer || steady.has(payer) || split.has(t.id)) continue;
    const taken: [string, number][] = [];
    let rest = t.amountCents;
    for (const p of open.get(`${monthOfRow(t)}|${payer}`) ?? []) {
      const part = Math.min(rest, p.left);
      if (part === 0) continue;
      p.left -= part;
      rest -= part;
      taken.push([p.id, part]);
      if (rest === 0) break;
    }
    if (taken.length) out.set(t.id, taken);
  }
  return out;
}
