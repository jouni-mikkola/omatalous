/**
 * Tarkistettavat's question of money a merchant may owe back: a charge made twice, and a charge after a subscription
 * was marked Lopetettu (core `moneyBackOf`, the definitions the alerts use). One item for each finding, `cents` what the
 * merchant owes. The answer is the mark of the alert, `alert:<id>` (PUT /api/marks): Veloitus on oikein is `dismissed`,
 * Pyydän hyvityksen is `in_use`. A refund that lands closes the item, since a charge paid back is no finding. A refund
 * asked for and not seen after 30 days brings the item back once, with the day it was asked (`askedOn`), and the answer
 * to that is `cancelled`, which closes it for good. Only the member's own rows are read.
 */
import { moneyBackOf } from "@banking/core";
import type { Services } from "./context.ts";

export interface MoneyBackItem {
  kind: "money_back";
  id: string;
  cents: number;
  merchant: string;
  /** A charge made twice, or a charge after Lopetettu. */
  reason: "double" | "cancelled";
  /** How many charges, and the day of the latest. */
  count: number;
  lastDate: string;
  /** The day the refund was asked on, when the item comes back for it. */
  askedOn: string | null;
  subject: string;
  /** The queue's own fields of every item: the charges, newest first. */
  rows?: { id: string; date: string; cents: number; name: string; text: string }[];
  rowCount?: number;
}

export const moneyBackItems = async (s: Services, userId: string): Promise<(MoneyBackItem & { rowIds: string[] })[]> => {
  const [{ ctx }, marks] = await Promise.all([s.analysis.get(s, userId, "own"), s.finance(userId).listMarks()]);
  return moneyBackOf(ctx, marks, s.today()).map((m) => ({ kind: "money_back", id: `money_back:${m.id}`, cents: m.cents, merchant: m.merchant, reason: m.kind, count: m.rowIds.length, lastDate: m.lastDate, askedOn: m.askedOn, subject: m.subject, rowIds: m.rowIds }));
};
