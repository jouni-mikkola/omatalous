/**
 * Tarkistettavat's notice of cards whose payer the rows do not show (`AheadBalance.unresolved`, reason
 * `card_payer_unseen`): one notice for all of them, with the debt Käytettävissä takes off for them. Its answers are the
 * bank connections, where connecting the account that pays the card proves it, and a mark `dismissed` that holds until a
 * card joins that no dismissal named (core unresolved-answer.ts). A card paid from the counted accounts and from
 * others, and a balance no row proves, have no answer of the household's: they show in Tietojen laatu only.
 */
import { cashAhead, type UnresolvedReason, unresolvedDismissed, unresolvedSubject } from "@banking/core";
import { requestInputs } from "./analysis.ts";
import type { Services } from "./context.ts";
import { memoOn } from "./context-memo.ts";
import { withoutWrongBills } from "./wrong-bills.ts";

/** The notice: `cents` is the debt that rests on it, `names` the cards. */
export interface UnresolvedItem {
  kind: "unresolved";
  id: string;
  cents: number;
  reason: UnresolvedReason;
  names: string[];
  /** The mark that dismisses the notice for these cards. */
  subject: string;
  /** The queue's own fields of every item: a notice has no rows. */
  rows?: { id: string; date: string; cents: number; name: string; text: string }[];
  rowCount?: number;
}

export const unresolvedItems = async (s: Services, userId: string): Promise<UnresolvedItem[]> => {
  const { ctx, accounts } = await s.analysis.get(s, userId, "own");
  if (!ctx.txs.length) return [];
  const { balances, inputs } = await requestInputs(s, userId, accounts);
  return memoOn(ctx, "review:unresolved", [balances, inputs], (): UnresolvedItem[] => {
    const open = (cashAhead(withoutWrongBills(ctx, inputs.marks), balances, inputs).balance?.unresolved ?? []).filter((c) => c.reason === "card_payer_unseen");
    const ids = open.map((c) => c.cardId);
    if (!open.length || unresolvedDismissed(inputs.marks, "card_payer_unseen", ids)) return [];
    return [{ kind: "unresolved", id: "unresolved:card_payer_unseen", reason: "card_payer_unseen", names: open.map((c) => c.name), cents: open.reduce((total, c) => total + c.cents, 0), subject: unresolvedSubject("card_payer_unseen", ids) }];
  });
};
