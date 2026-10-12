/**
 * Who uses an account, and how much of it is one user's. Who may see an account is another matter (its shares), and
 * nothing here reads that. A use is what the household said, or it is derived from the bank's holder names on every
 * read. A part is a range of the users' weights, so the users' parts of a row add up to the row, to the cent.
 */
import { type Holder, holdersIn, type Name, samePerson } from "./person-names.ts";
import type { Account, AccountUse, AccountUser, Part, Transaction } from "./types.ts";

/** All of an account. */
export const WHOLE: Part = Object.freeze({ from: 0, to: 1, of: 1 });
/** None of it: an account somebody else uses alone. */
export const NONE: Part = Object.freeze({ from: 0, to: 0, of: 1 });

/** The user with no id, when the bank's line does not name them. */
export const OTHER_HOLDER = "Muu tilinomistaja";

/**
 * A user of the instance as a use reads one. `name` is the name their own accounts give (`userNameOf`), null when the
 * accounts do not tell it: it matches a member to a holder and never leaves the server. `label` is what is shown.
 */
export interface UseMember {
  id: string;
  label: string;
  name: Name | null;
}

type Said = Pick<AccountUser, "userId" | "weight">;

/** The order of the parts: by user id as its code units compare (no locale, so two servers give one answer), the user with no id last. */
const byUser = (a: Pick<AccountUser, "userId">, b: Pick<AccountUser, "userId">): number =>
  a.userId === b.userId ? 0 : a.userId === null ? 1 : b.userId === null ? -1 : a.userId < b.userId ? -1 : 1;

const labelsOf = (members: readonly UseMember[]) => {
  const labels = new Map(members.map((m) => [m.id, m.label]));
  return (id: string) => labels.get(id) ?? "";
};

/**
 * What the bank's line of holders says of an account: how many it names, which members are among them, and the label
 * of the holders who are no member (null when there is none).
 */
function heldBy(account: Pick<Account, "holder">, linkedBy: readonly string[], members: readonly UseMember[]): { count: number; members: string[]; other: string | null } {
  const holders = holdersIn(account.holder);
  const memberOf = (holder: Holder): UseMember | null => {
    const hits = members.filter((m) => m.name !== null && samePerson(m.name, holder.name));
    // two members of one name: the one who linked the account, else the line cannot tell which
    return hits.find((m) => linkedBy.includes(m.id)) ?? (hits.length === 1 ? hits[0]! : null);
  };
  const found = holders.map(memberOf);
  const ids = [...new Set(found.flatMap((m) => (m ? [m.id] : [])))];
  const strangers = holders.filter((_, i) => !found[i]);
  // a member who linked the account and whose own accounts tell no name is one of the holders nobody matched
  const unnamed = linkedBy.filter((id) => !ids.includes(id) && members.some((m) => m.id === id && m.name === null)).length;
  // which of them the unnamed member is cannot be told, so the others are not named either
  const other = strangers.length > unnamed ? (unnamed ? OTHER_HOLDER : strangers.map((h) => h.text).join(", ")) : null;
  return { count: holders.length, members: ids, other };
}

/**
 * Who uses an account when nobody has said it. `linkedBy` holds the members who linked the real account: both
 * partners when each linked a joint account, so both copies give one answer.
 *
 * Two holders or more by the bank make a joint account: each holder who is a member is a user, the holders who are
 * no member are one user with no id, and a member who linked the account is always a user. Everyone weighs 1.
 * One holder, none, or a line not read yet: the members who linked it, unless the one holder is a member, who then
 * uses it alone (a child's account a parent linked).
 */
export function deriveUse(account: Pick<Account, "holder">, linkedBy: readonly string[], members: readonly UseMember[]): AccountUse {
  const held = heldBy(account, linkedBy, members);
  const labelOf = labelsOf(members);
  const users = (ids: readonly string[]): AccountUser[] => [...new Set(ids)].map((userId) => ({ userId, label: labelOf(userId), weight: 1 }));
  if (held.count >= 2) {
    const joint = users([...held.members, ...linkedBy]);
    if (held.other !== null) joint.push({ userId: null, label: held.other, weight: 1 });
    return { users: joint.sort(byUser), source: "bank" };
  }
  const holder = held.members[0];
  if (holder !== undefined && linkedBy.some((id) => id !== holder)) return { users: users([holder]), source: "bank" };
  return { users: users(linkedBy).sort(byUser), source: "owner" };
}

/**
 * The use the household said, from its stored rows. Null when no weight above zero is left (the user who had it was
 * removed): rows that give nobody a part say nothing, and the use is derived again.
 */
export function saidUse(rows: readonly Said[], account: Pick<Account, "holder">, linkedBy: readonly string[], members: readonly UseMember[]): AccountUse | null {
  if (!rows.some((row) => row.weight > 0)) return null;
  const labelOf = labelsOf(members);
  const other = heldBy(account, linkedBy, members).other ?? OTHER_HOLDER;
  const users = rows.map((row): AccountUser => ({ userId: row.userId, label: row.userId === null ? other : labelOf(row.userId), weight: row.weight }));
  return { users: users.sort(byUser), source: "said" };
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/**
 * One user's part of an account (null: the user with no id): their weight's place among the users', in the order of
 * the parts, in lowest terms (600 and 400 euros a month are 3 and 2). `WHOLE` itself when they use the account alone,
 * `NONE` itself when they are no user of it or weigh nothing.
 */
export function partOf(use: AccountUse, viewerId: string | null): Part {
  let from = 0;
  let weight = 0;
  let of = 0;
  for (const user of [...use.users].sort(byUser)) {
    if (user.userId === viewerId) {
      from = of;
      weight = user.weight;
    }
    of += user.weight;
  }
  if (weight === 0) return NONE;
  if (weight === of) return WHOLE;
  const by = gcd(gcd(from, weight), of);
  return { from: from / by, to: (from + weight) / by, of: of / by };
}

/** `abs * weight / of` to a whole cent, a half up, in whole numbers: past what a double holds exactly, in BigInt. */
function centsUpTo(abs: number, weight: number, of: number): number {
  const twice = 2 * abs * weight + of;
  // a safe integer here is the exact sum, and a quotient of two such numbers never rounds across a whole number
  if (Number.isSafeInteger(twice)) return Math.floor(twice / (2 * of));
  return Number((2n * BigInt(abs) * BigInt(weight) + BigInt(of)) / (2n * BigInt(of)));
}

/**
 * A part of an amount in cents, with the amount's sign. Both ends of the range are rounded the same way and the part
 * is what lies between them, so the parts of every user add up to the amount: the members' own views of a joint
 * account add up to the household's. The one place a part of money is worked out.
 */
export function partCents(amountCents: number, part: Part): number {
  const abs = Math.abs(amountCents);
  const cents = centsUpTo(abs, part.to, part.of) - centsUpTo(abs, part.from, part.of);
  return amountCents < 0 && cents !== 0 ? -cents : cents;
}

/** The bank's amount of a row, also when the row is cut to a part: what a typed bill or a loan's payment is matched by. */
export const billCents = (t: Pick<Transaction, "amountCents" | "wholeCents">): number => t.wholeCents ?? t.amountCents;
