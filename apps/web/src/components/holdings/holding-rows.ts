/**
 * The choices Holdings makes about its rows that are not figures: which accounts fold away, which accounts need their
 * number to be told apart, and what the debt total is called. None of them adds anything up.
 */
import type { DashboardData } from "../../types.ts";

type Answer = DashboardData["holdings"];

/** With more accounts than this, the ones with next to nothing in them fold into one line. */
const FOLD_ABOVE = 4;
/** A balance closer to zero than this many cents, on either side, is next to nothing. */
const NEXT_TO_NOTHING = 100;

/**
 * The accounts to list and the ones that fold: with more than `FOLD_ABOVE` accounts, those whose balance is between
 * -1,00 and 1,00 euros (a balance of exactly 1,00 stays, and so does one the bank did not give). Both keep the order
 * they came in, and the folded ones are still in the total.
 */
export function splitAccounts<A extends Pick<Answer["accounts"][number], "balanceCents">>(accounts: readonly A[]): { shown: A[]; folded: A[] } {
  if (accounts.length <= FOLD_ABOVE) return { shown: [...accounts], folded: [] };
  const folds = (a: A) => a.balanceCents !== null && Math.abs(a.balanceCents) < NEXT_TO_NOTHING;
  return { shown: accounts.filter((a) => !folds(a)), folded: accounts.filter(folds) };
}

/**
 * The accounts that share their name with another, by the last four characters of their number: account id to mask.
 * Names are compared without case and extra spaces. An account with a name of its own, or without a number, is not in it.
 */
export function maskedNames(accounts: readonly Pick<Answer["accounts"][number], "id" | "name" | "mask">[]): Map<string, string> {
  const key = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();
  const count = new Map<string, number>();
  for (const a of accounts) count.set(key(a.name), (count.get(key(a.name)) ?? 0) + 1);
  return new Map(accounts.flatMap((a) => (a.mask && (count.get(key(a.name)) ?? 0) > 1 ? [[a.id, a.mask] as const] : [])));
}

/**
 * What the debt total under Lainat is called. `debtCents` holds the loans and, as the cards owe on them, the cards' use
 * as well: it is "Velat yhteensä" as soon as one card has something used, else it is the loans alone.
 */
export function debtTotalName(cards: readonly Pick<Answer["cards"][number], "usedCents">[]): "Velat yhteensä" | "Lainat yhteensä" {
  return cards.some((c) => (c.usedCents ?? 0) > 0) ? "Velat yhteensä" : "Lainat yhteensä";
}
