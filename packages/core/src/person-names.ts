/**
 * People's names as a bank writes them on an account: told apart by their words, since one bank writes the surname
 * first and another last, and one leaves a middle name out. The category rules and the use of an account both read a
 * person through these, so a name is compared one way everywhere.
 */
import { fold } from "./merchant.ts";
import type { Account } from "./types.ts";

/** A name as its folded words: a bank writes the surname first or last. */
export type Name = ReadonlySet<string>;
export const nameOf = (text: string): Name => new Set(fold(text).split(/[^\p{L}]+/u).filter(Boolean));

/** One person: every word of the shorter name is in the longer one, and it has two at least. One bank leaves a middle name out. */
export function samePerson(a: Name, b: Name): boolean {
  const [few, many] = a.size <= b.size ? [a, b] : [b, a];
  return few.size >= 2 && [...few].every((word) => many.has(word));
}

/** A holder of an account: the name as the bank wrote it, and its words. */
export interface Holder {
  text: string;
  name: Name;
}

/**
 * The holders of an account from the line the bank gives ("A, B"). A holder has two words at least: one word tells no
 * person apart, and "SURNAME, FIRST" is one person the line cannot name, never two.
 */
export const holdersIn = (holder: string | null | undefined): Holder[] =>
  (holder ?? "")
    .split(",")
    .map((text) => ({ text: text.trim(), name: nameOf(text) }))
    .filter((h) => h.name.size >= 2);

/**
 * The user's own name, from the holders of their accounts. It is the one name on the most accounts: a joint account's
 * other holder and a child's account each stand on fewer. A joint account alone leaves two names on as many, and so do
 * two people's own accounts: null then, the accounts do not tell it.
 */
export function userNameOf(accounts: readonly Pick<Account, "holder">[]): Name | null {
  const lists = accounts.map((a) => holdersIn(a.holder).map((h) => h.name)).filter((names) => names.length > 0);
  const names = lists.flat();
  const accountsOf = (name: Name) => lists.filter((list) => list.some((other) => samePerson(name, other))).length;
  const most = Math.max(0, ...names.map(accountsOf));
  // one person may be written two ways on two accounts: those are one name, two people on as many accounts are a tie
  const top = names.filter((name) => accountsOf(name) === most);
  return top.length > 0 && top.every((name) => samePerson(name, top[0]!)) ? top[0]! : null;
}
