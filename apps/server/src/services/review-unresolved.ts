/**
 * Tarkistettavat's notices of figures the app cannot prove: a balance no row proves (the `unknown` answers of the
 * reconcile) and a card whose payer the rows do not show (`AheadBalance.unresolved`). Grouped by reason, so a household
 * has a few of them at most. Each names the figure it touches by its amount and gives one answer, Ohita, a mark
 * `dismissed` that holds until the reason changes or the amount moves a quarter (core unresolved-answer.ts).
 * Nothing here asks the household for a fact the app could use: a payment seen from the pool's account proves a card by itself.
 */
import { cashAhead, type UnresolvedReason, unprovenOf, unresolvedDismissed, unresolvedSubject } from "@banking/core";
import { requestInputs } from "./analysis.ts";
import type { Services } from "./context.ts";
import { memoOn } from "./context-memo.ts";
import { reconcileOf, withProof } from "./reconcile.ts";
import { withoutWrongBills } from "./wrong-bills.ts";

/** A reason's notice: `cents` is the amount of the figure that rests on it, `names` the accounts or cards. */
export interface UnresolvedItem {
  kind: "unresolved";
  id: string;
  cents: number;
  reason: UnresolvedReason;
  names: string[];
  /** The mark that dismisses the notice at this amount. */
  subject: string;
  /** The queue's own fields of every item: a notice has no rows. */
  rows?: { id: string; date: string; cents: number; name: string; text: string }[];
  rowCount?: number;
  /** `card_payer_mixed`: what the rows show paid to these cards from the pool's accounts and from outside them. */
  paidFromPoolCents?: number;
  paidFromOutsideCents?: number;
}

const sum = (cents: readonly number[]) => cents.reduce((total, c) => total + c, 0);

export const unresolvedItems = async (s: Services, userId: string): Promise<UnresolvedItem[]> => {
  const { ctx, accounts } = await s.analysis.get(s, userId, "own");
  if (!ctx.txs.length) return [];
  const { balances: stated, inputs } = await requestInputs(s, userId, accounts);
  const balances = withProof(stated, await reconcileOf(s, userId, accounts));
  return memoOn(ctx, "review:unresolved", [balances, inputs], (): UnresolvedItem[] => {
    const cards = cashAhead(withoutWrongBills(ctx, inputs.marks), balances, inputs).balance?.unresolved ?? [];
    const found: Omit<UnresolvedItem, "kind" | "id" | "subject">[] = [
      ...unprovenOf(balances).map(({ reason, accounts: open }) => ({ reason, names: open.map((b) => b.name), cents: sum(open.map((b) => Math.abs(b.balanceCents!))) })),
      ...(["card_payer_unseen", "card_payer_mixed"] as const).flatMap((reason) => {
        const open = cards.filter((c) => c.reason === reason);
        if (!open.length) return [];
        const mixed = reason === "card_payer_mixed" ? { paidFromPoolCents: sum(open.map((c) => c.paidFromPoolCents ?? 0)), paidFromOutsideCents: sum(open.map((c) => c.paidFromOutsideCents ?? 0)) } : {};
        return [{ reason, names: open.map((c) => c.name), cents: sum(open.map((c) => c.cents)), ...mixed }];
      }),
    ];
    return found.filter((f) => !unresolvedDismissed(inputs.marks, f.reason, f.cents)).map((f) => ({ ...f, kind: "unresolved" as const, id: `unresolved:${f.reason}`, subject: unresolvedSubject(f.reason, f.cents) }));
  });
};
