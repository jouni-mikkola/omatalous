/**
 * Tarkistettavat's notice of cards whose payer the rows do not show (`AheadBalance.unresolved`, reason
 * `card_payer_unseen`): one notice for all of them, with the debt Käytettävissä takes off for them. Its answers are the
 * bank connections, where connecting the account that pays the card proves it, and a mark `dismissed` per card that holds
 * until a card joins that has none (core unresolved-answer.ts). A card paid from the counted accounts and from
 * others, and a balance no row proves, have no answer of the household's: they show in Tietojen laatu only.
 */
import { cashAhead, type UnresolvedReason, unresolvedDismissed, unresolvedSubjects } from "@banking/core";
import type { Services } from "./context.ts";
import { memoOn } from "./context-memo.ts";
import type { OwnView } from "./review-own.ts";
import { withoutWrongBills } from "./wrong-bills.ts";

/** The notice: `cents` is the debt that rests on it, `names` the cards. */
export interface UnresolvedItem {
  kind: "unresolved";
  id: string;
  cents: number;
  reason: UnresolvedReason;
  names: string[];
  /** The marks that dismiss the notice for these cards, one per card. */
  subjects: string[];
  /** The queue's own fields of every item: a notice has no rows. */
  rows?: { id: string; date: string; cents: number; name: string; text: string }[];
  rowCount?: number;
}

export const unresolvedItems = async (_s: Services, _userId: string, own: OwnView): Promise<UnresolvedItem[]> => {
  const { ctx, balances, inputs, stamp } = own;
  if (!ctx.txs.length) return [];
  return memoOn(ctx, "review:unresolved", stamp, (): UnresolvedItem[] => {
    const open = (cashAhead(withoutWrongBills(ctx, inputs.marks), balances, inputs).balance?.unresolved ?? []).filter((c) => c.reason === "card_payer_unseen");
    const ids = open.map((c) => c.cardId);
    if (!open.length || unresolvedDismissed(inputs.marks, "card_payer_unseen", ids)) return [];
    return [{ kind: "unresolved", id: "unresolved:card_payer_unseen", reason: "card_payer_unseen", names: open.map((c) => c.name), cents: open.reduce((total, c) => total + c.cents, 0), subjects: unresolvedSubjects("card_payer_unseen", ids) }];
  });
};
