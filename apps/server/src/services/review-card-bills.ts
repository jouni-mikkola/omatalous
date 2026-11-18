/**
 * Tarkistettavat's question of a card the household pays the bills of and has not connected (core `unconnectedCards`):
 * its debt is in no figure, so the item is asked high in the queue, by the year of bills. Three answers: the card is
 * connected where the connections are (the item goes at once), its debt is saved as a loan of kind card with the series
 * key `key` (POST /api/loans), which takes the series out of the card list too, or the card is already saved under
 * Lainat (`savedCards`, offered only when such a loan exists), which is answered by linking that loan to the series
 * (PUT /api/loans/:id with `seriesKey`). Only the member's own rows are read.
 */
import { paymentOf, unconnectedCards, unlinkedCardLoans } from "@banking/core";
import type { Services } from "./context.ts";
import type { OwnView } from "./review-own.ts";

export interface CardBillItem {
  kind: "card_bill";
  id: string;
  cents: number;
  /** The series key of the card's bills: what a loan saved from it is linked by. */
  key: string;
  payee: string;
  /** The card loans saved with no link to their bills: the card may be one of them. */
  savedCards: { id: string; name: string }[];
  /** The latest bill, as the bank charged it. */
  paymentCents: number;
  months: number;
  firstDate: string;
  lastDate: string;
  /** The queue's own fields of every item: the card's bills, newest first. */
  rows?: { id: string; date: string; cents: number; name: string; text: string }[];
  rowCount?: number;
}

type Asked = CardBillItem & { rowIds: string[]; whole: true };

/** The card's rows are its series' own, at the bank's whole charge as a loan's are. */
export const cardBillItems = async (_s: Services, _userId: string, { ctx, inputs }: OwnView): Promise<Asked[]> => {
  const rowsOf = new Map(ctx.recurring.map((r) => [r.id, r.transactionIds]));
  const savedCards = unlinkedCardLoans(inputs).map((loan) => ({ id: loan.id, name: loan.name }));
  return unconnectedCards(ctx, inputs).map((c): Asked => ({
    kind: "card_bill",
    id: `card_bill:${c.key}`,
    cents: 12 * paymentOf(c).whole,
    key: c.key,
    payee: c.payee,
    savedCards,
    paymentCents: paymentOf(c).whole,
    months: c.months,
    firstDate: c.firstDate,
    lastDate: c.lastDate,
    rowIds: [...(rowsOf.get(c.seriesId) ?? [])],
    whole: true,
  }));
};
