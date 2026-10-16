/**
 * Whose a bill paid to a card account is. One function, read by the money trace (the person a bill is for) and by
 * the settlement between partners (how a bill is shared). It reads no database and no clock.
 */
import { dayNumber } from "./dates.ts";
import { compareOwners, type Owner } from "./money-trace-lots.ts";

/** A card account: its key and the users the household (or the bank's holder line) says use it, with their weights. */
export interface CardUse {
  key: string;
  users: readonly { owner: Owner; weight: number }[];
}

/** A dated agreement on an account key: from `validFrom` (`YYYY-MM-DD`) it holds until the next one of the same key. */
interface Agreement {
  accountKey: string;
  validFrom: string;
}

/** The cards a pool's bills may go to, by account id, with the pool's members and the agreements there are. */
export interface CardBook {
  byAccount: ReadonlyMap<string, CardUse>;
  /** The owners that use the pool: an owner of a card who is none of them is not counted. */
  members: ReadonlySet<Owner>;
  agreements: readonly Agreement[];
}

/**
 * 1 `agreement`: the card has an agreement valid on the day, the bill is a shared cost split by it.
 * 2 `one`: exactly one weighted user, who uses the pool: the bill is theirs.
 * 3 `shared`: two or more weighted users: a bill of the pool split by their weights (users who do not use the pool left out).
 * 4 `unknown`: no weighted user, only the holder nobody names, or no one who uses the pool.
 */
type CardHolder = { rule: 1; kind: "agreement" } | { rule: 2; kind: "one"; owner: Owner } | { rule: 3; kind: "shared"; weights: { owner: Owner; weight: number }[] } | { rule: 4; kind: "unknown" };

/** Whose the bill of `card` booked on `day` is, by the first rule that says. */
export function cardHolderOf(card: CardUse, day: number, members: ReadonlySet<Owner>, agreements: readonly Agreement[] = []): CardHolder {
  if (agreements.some((a) => a.accountKey === card.key && dayNumber(a.validFrom) <= day)) return { rule: 1, kind: "agreement" };
  const users = card.users.filter((u) => u.weight > 0);
  const one = users.length === 1 ? users[0]! : undefined;
  if (one && one.owner !== "u:" && members.has(one.owner)) return { rule: 2, kind: "one", owner: one.owner };
  if (users.length >= 2) {
    const weights = users.filter((u) => members.has(u.owner)).sort((a, b) => compareOwners(a.owner, b.owner));
    if (weights.length) return { rule: 3, kind: "shared", weights };
  }
  return { rule: 4, kind: "unknown" };
}
