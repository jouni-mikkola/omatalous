/**
 * Decision: how much of a card's debt is still to come off the money that is free before the payday, once every payment
 * that pays the card is counted once.
 *
 * The one place where the money that pays a card is reconciled with the card's debt (`aheadBasis`). Every way money
 * reaches a card meets here, and each euro of the debt is taken off once:
 *
 * - a payment already booked on a counted account is in that account's balance. When the card's balance may not hold it
 *   yet (its leg is not on the card, `unapplied` of `expectedMoves`: a leg pending or not yet synced, a payment that
 *   names the card's account or that goes to the payee its paid bills went to) it comes off the debt first;
 * - a bill the household typed in that names the card's own account number is a payment of the card (the caller proves
 *   that; a bill with no proof stays beside the debt);
 * - the predicted bill of the card is a guess at the next payment of the same debt: the typed bills cut it, in the
 *   order of the days, and a bill they cover is dropped.
 *
 * What the typed and the predicted bills of a card come to in the window, and the debt left beside them, is the larger
 * of the debt after the booked payments and the typed bills. A payment that is not proven to be the card's is not here.
 */
import type { IsoDate } from "../types.ts";

/** A bill the household typed in that is proven to be a payment of a card. Positive. */
export interface TypedCardBill {
  cardId: string;
  date: IsoDate;
  amountCents: number;
}

/** The debt of a card after the payments its balance may not hold yet: never below zero. */
export const owedAfter = (usedCents: number, unappliedCents: number): number => Math.max(0, usedCents - unappliedCents);

/**
 * `predicted` are the bills of a card that is expected to be paid (the ones with a `cardId`), `typed` the proven typed
 * bills and `used` what each card owes now (`null` when its balance is not known). `inWindow` says which days the
 * figure counts as leaving. Returns the predicted bills cut by the typed ones, in the same order, and per card the
 * debt that no bill of the window holds (`null` for a card with no known debt).
 */
export function reconcileCardPayments<M extends { date: IsoDate; amountCents: number; cardId?: string }>(input: {
  used: ReadonlyMap<string, number | null>;
  unapplied: ReadonlyMap<string, number>;
  typed: readonly TypedCardBill[];
  predicted: readonly M[];
  inWindow: (date: IsoDate) => boolean;
}): { predicted: M[]; rest: Map<string, number | null> } {
  const { used, unapplied, typed, predicted, inWindow } = input;
  // what the typed bills of a card still have to cut from its predicted bills
  const credit = new Map<string, number>();
  const heldByTyped = new Map<string, number>();
  for (const b of typed) {
    credit.set(b.cardId, (credit.get(b.cardId) ?? 0) + b.amountCents);
    if (inWindow(b.date)) heldByTyped.set(b.cardId, (heldByTyped.get(b.cardId) ?? 0) + b.amountCents);
  }
  const cut = new Map<M, number>();
  const heldByPredicted = new Map<string, number>();
  for (const m of [...predicted].sort((a, b) => a.date.localeCompare(b.date))) {
    const covered = m.cardId ? Math.min(m.amountCents, credit.get(m.cardId) ?? 0) : 0;
    if (covered > 0) credit.set(m.cardId!, credit.get(m.cardId!)! - covered);
    cut.set(m, m.amountCents - covered);
    if (m.cardId && inWindow(m.date)) heldByPredicted.set(m.cardId, (heldByPredicted.get(m.cardId) ?? 0) + m.amountCents - covered);
  }
  const rest = new Map<string, number | null>();
  for (const [cardId, usedCents] of used) {
    const held = (heldByTyped.get(cardId) ?? 0) + (heldByPredicted.get(cardId) ?? 0);
    rest.set(cardId, usedCents === null ? null : Math.max(0, owedAfter(usedCents, unapplied.get(cardId) ?? 0) - held));
  }
  return { predicted: predicted.flatMap((m) => (cut.get(m)! > 0 ? [{ ...m, amountCents: cut.get(m)! }] : [])), rest };
}
