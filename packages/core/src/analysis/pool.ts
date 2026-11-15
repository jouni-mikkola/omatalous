import { billCents, isWhole } from "../account-use.ts";
import { normalizeIban } from "../iban.ts";
import { incomingLegFinder } from "../pairing.ts";
import type { BalanceInput } from "../types.ts";
import type { AnalysisContext } from "./context.ts";

/**
 * The pool of a view: the one value that Tulos and Käytettävissä both speak for. It holds every account of the view that
 * carries daily money, the household's own and the joint ones, each at the viewer's part (ADR 0016). Savings,
 * investment, loan and card accounts are outside it: money reaches them only by a flow that crosses the pool's boundary.
 * The balances arrive already cut to the viewer's part (`partCents`, as the server's own view gives them), so the pool
 * adds them as they are: cutting them again would weigh a part twice and round each account on its own, and the
 * members' pools would no longer add up to the household's.
 *
 * Decision: what the household can spend today and what stayed of the month are one pool, so a figure that follows
 * fewer accounts, or deducts a debt the pool does not pay, is a different figure under the same name.
 */
export interface Pool {
  ids: ReadonlySet<string>;
  /** The balances of the pool's accounts, in the order of the view. */
  accounts: readonly BalanceInput[];
  /** "part": some account is counted at less than its whole; "all": every account is counted whole. */
  kind: "all" | "part";
  /** What the pool holds, each account at the viewer's part; an account with no known balance adds nothing. */
  cents: number;
}

/** An account is in the pool when it is a checking account (a joint one included) of which the viewer has some part. */
export function poolOf(balances: readonly BalanceInput[]): Pool {
  const accounts = balances.filter((b) => b.type === "checking" && (!b.part || b.part.to > b.part.from));
  return {
    ids: new Set(accounts.map((b) => b.id)),
    accounts,
    kind: accounts.some((b) => b.part && !isWhole(b.part)) ? "part" : "all",
    cents: accounts.reduce((sum, b) => sum + (b.balanceCents ?? 0), 0),
  };
}

/**
 * What each account paid to each card of the view, from the transfer rows: an account whose money left to a card, found
 * the way the window follows a bill (the account the payment names by IBAN, else the account of its other leg, the
 * bank's sums at most five days apart). A card nobody is seen to pay has no entry, and neither has one paid from an
 * account the view does not hold. The sums are the payments seen, not what the card owes.
 */
export function cardPayments(ctx: Pick<AnalysisContext, "txs" | "accounts">): Map<string, Map<string, number>> {
  const cards = new Set(ctx.accounts.filter((a) => a.type === "credit_card").map((a) => a.id));
  const byIban = new Map<string, string | null>();
  for (const a of ctx.accounts) {
    const key = normalizeIban(a.iban);
    if (key) byIban.set(key, byIban.has(key) ? null : a.id);
  }
  const moved = ctx.txs.filter((t) => t.isTransfer && t.status === "booked");
  const legOf = incomingLegFinder(moved, billCents);
  const out = moved.filter((t) => t.amountCents < 0 && !cards.has(t.accountId)).map((t) => ({ t, named: byIban.get(normalizeIban(t.counterpartyIban) ?? "") ?? null }));
  const paid = new Map<string, Map<string, number>>();
  // a payment that names its account takes its other leg first, as the window does
  for (const { t, named } of [...out.filter((o) => o.named !== null), ...out.filter((o) => o.named === null)]) {
    const leg = legOf(t, named);
    const to = named ?? leg?.accountId ?? null;
    if (to === null || !cards.has(to)) continue;
    const by = paid.get(to) ?? paid.set(to, new Map()).get(to)!;
    by.set(t.accountId, (by.get(t.accountId) ?? 0) + Math.abs(billCents(t)));
  }
  return paid;
}

type Payments = ReadonlyMap<string, ReadonlyMap<string, number>>;

/**
 * Who pays a card, as far as the rows prove it: `pool` when every seen payer is in the pool, `outside` when every seen
 * payer is outside it, `mixed` when both are seen and `unseen` when the rows show none.
 */
function cardPayerOf(pool: Pick<Pool, "ids">, payments: Payments, cardId: string): "pool" | "outside" | "mixed" | "unseen" {
  const from = [...(payments.get(cardId)?.keys() ?? [])];
  if (!from.length) return "unseen";
  const inside = from.filter((id) => pool.ids.has(id)).length;
  return inside === from.length ? "pool" : inside === 0 ? "outside" : "mixed";
}

/**
 * Whether the pool pays a card, as far as the rows show. A card with no payer seen is the pool's: its debt is taken off
 * Käytettävissä whole, so the figure is never more than it is. Only a card whose every seen payer is outside the pool
 * is not. A card the rows do not prove to the pool alone (`unseen`, `mixed`) is still taken off whole, and the figure
 * says so as unresolved with its reason (`unresolvedCards`).
 */
export function poolPays(pool: Pick<Pool, "ids">, payments: Payments, cardId: string): boolean {
  return cardPayerOf(pool, payments, cardId) !== "outside";
}

/** A card whose debt Käytettävissä takes off whole although the rows do not prove that the pool pays it. */
export interface UnresolvedCard {
  /** `card_payer_unseen`: the card owes and no payment to it is seen. `card_payer_mixed`: payments are seen from the pool and from outside it. */
  reason: "card_payer_unseen" | "card_payer_mixed";
  cardId: string;
  name: string;
  /** The debt taken off Käytettävissä for this card. */
  cents: number;
  /** `card_payer_mixed` only: the payments seen from the pool's accounts and from the others. */
  paidFromPoolCents?: number;
  paidFromOutsideCents?: number;
}

/** The cards of `debts` whose payer the rows leave open, each with its reason. */
export function unresolvedCards(pool: Pick<Pool, "ids">, payments: Payments, debts: readonly { cardId: string; name: string; cents: number }[]): UnresolvedCard[] {
  return debts.flatMap((d): UnresolvedCard[] => {
    const verdict = cardPayerOf(pool, payments, d.cardId);
    if (verdict === "unseen") return [{ reason: "card_payer_unseen", cardId: d.cardId, name: d.name, cents: d.cents }];
    if (verdict !== "mixed") return [];
    const by = [...(payments.get(d.cardId) ?? [])];
    const sum = (inside: boolean) => by.filter(([id]) => pool.ids.has(id) === inside).reduce((s, [, cents]) => s + cents, 0);
    return [{ reason: "card_payer_mixed", cardId: d.cardId, name: d.name, cents: d.cents, paidFromPoolCents: sum(true), paidFromOutsideCents: sum(false) }];
  });
}
