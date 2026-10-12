/**
 * The choices Holdings makes about its rows: which accounts and which cards need their number to be told apart, how a
 * card is named, and when the block has a line of its own for the debts. No sum is made here: every total is core's.
 */
import type { DashboardData } from "../../types.ts";

type Answer = DashboardData["holdings"];

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

/** The words a bank puts in brackets after a card's name to tell its type, in the lower case they are compared in. */
const CARD_TYPES = ["credit", "debit", "credit card", "debit card", "luotto", "luottokortti", "debetti", "kredit"];
const TYPE_IN_BRACKETS = new RegExp(String.raw`\s*\(\s*(?:${CARD_TYPES.join("|")})\s*\)`, "gi");

/**
 * The bank's name for a card without the type it adds in brackets ("Nordea Gold (credit)" gives "Nordea Gold"). Only a
 * bracket that holds nothing but a type word goes: the owner's name of a shared card, "(Eero)", stays, and so does a name
 * that would be left empty.
 */
export function cardName(name: string): string {
  const plain = name.replace(TYPE_IN_BRACKETS, "").replace(/\s+/g, " ").trim();
  return plain || name.trim();
}

/**
 * The cards that share their name (as `cardName` gives it), by the last four characters of the number the bank gave
 * ("•••• 1234" gives "1234"): card id to mask, as `maskedNames` makes it for accounts.
 */
export function cardMasks(cards: readonly Pick<Answer["cards"][number], "id" | "name" | "mask">[]): Map<string, string> {
  return maskedNames(cards.map((c) => ({ id: c.id, name: cardName(c.name), mask: c.mask?.slice(-4) ?? null })));
}

/**
 * Whether a card has something used. The debts of the whole block (`debtCents`) differ from the loans alone only then,
 * so only then is there a line for them at the foot of the block.
 */
export function cardsOwe(cards: readonly Pick<Answer["cards"][number], "usedCents">[]): boolean {
  return cards.some((c) => (c.usedCents ?? 0) > 0);
}
