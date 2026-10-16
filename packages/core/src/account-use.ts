/**
 * Who uses an account, and how much of it is one user's. Who may see an account is another matter (its shares), and
 * nothing here reads that. A use is what the household said, or it is derived from the bank's holder names on every
 * read. A part is a range of the users' weights, so the users' parts of a row add up to the row, to the cent.
 */
import type { WhyCollector } from "./explain/types.ts";
import { type Holder, holdersIn, type Name, nameOf, samePerson } from "./person-names.ts";
import { normalizeIban, pairTransfers } from "./transfers.ts";
import type { Account, AccountUse, AccountUser, Part, RowShare, Transaction } from "./types.ts";

/** All of an account. */
export const WHOLE: Part = Object.freeze({ from: 0, to: 1, of: 1 });
/** None of it: an account somebody else uses alone. */
export const NONE: Part = Object.freeze({ from: 0, to: 0, of: 1 });

/** Whether a part is all of an account. */
export const isWhole = (part: Part): boolean => part.from === 0 && part.to === part.of;
/** Whether a part is none of it. */
export const isNone = (part: Part): boolean => part.to === part.from;

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

/**
 * A member's own view of rows: what the member uses. `parts` is the viewer's part of each account by its id, and an
 * account it does not name counts whole. `txs` and `accounts` are everything the viewer may see of the view, the
 * accounts they have no part in included: those rows tell where the money of the others went. `owners` names the
 * member who linked an account, by its id, where the accounts are not all one member's: each member's rows were
 * categorised on their own.
 *
 * - A row of an account the viewer has no part in is dropped. The other leg of a movement to or from such an account
 *   is no own transfer any more: it becomes money between people, `p2p` out and `p2p_in` in.
 * - A row of an account the viewer has a part of gets `amountCents` cut to the part, and `wholeCents` keeps the bank's.
 * - Money into such an account from an account of the household, or from one of its holders, is a transfer: a user
 *   paying for their part of what the account pays. So is a movement between the accounts of two members, and the
 *   payment of one member's account that is the bill of a card another member linked: the card's purchases are the
 *   spending, at the viewer's part of the card.
 *
 * What a member's categorisation decided of that member's rows stays: a stored transfer keeps its other leg, and two
 * rows it left unpaired are never paired here. A category set by hand stays. When every account of `accounts` counts
 * whole the rows come back as they were given, the same array, whatever `shares` holds.
 *
 * `shares` holds the viewer's own cents of a row by its id, where the account's money is told by who paid it. A row
 * with one counts those cents, signed: `amountCents` is the share's, `wholeCents` the bank's, and `openCents` is set
 * when the share has some open. A share that is a transfer makes the row one, unless the category was set by hand, and
 * the reading of the other end of a movement does not apply to it; a share that is none leaves the category as the row
 * has it. A share of 0 drops the row. A row without one is cut by the part, on the same account too.
 */
export function applyUse<T extends Transaction>(
  txs: readonly T[],
  accounts: readonly Account[],
  parts: ReadonlyMap<string, Part>,
  owners: ReadonlyMap<string, string> = new Map(),
  shares?: ReadonlyMap<string, RowShare>,
  why?: WhyCollector,
): readonly T[] {
  const partIn = (accountId: string): Part => parts.get(accountId) ?? WHOLE;
  // a part of an account that is not in the view cuts nothing in it
  if (accounts.every((a) => isWhole(partIn(a.id)))) return txs;
  const gone = (accountId: string) => isNone(partIn(accountId));
  const ownerOf = (accountId: string) => owners.get(accountId) ?? "";
  const members = [...new Set(accounts.map((a) => ownerOf(a.id)))];
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const byIban = new Map(accounts.flatMap((a): [string, string][] => (normalizeIban(a.iban) ? [[normalizeIban(a.iban)!, a.id]] : [])));
  const accountOf = new Map(txs.map((t) => [t.id, t.accountId]));
  const settled = (t: T) => t.categorySource === "transfer";
  /** The account of the other leg of a movement, by row id. */
  const otherLeg = new Map<string, string>();
  const link = (pairs: ReadonlyMap<string, string>) => {
    for (const [out, into] of pairs) {
      otherLeg.set(out, accountOf.get(into)!);
      otherLeg.set(into, accountOf.get(out)!);
    }
  };
  // a stored transfer does not say which account its other leg is on. The legs one member's categorisation stored
  // pair among themselves again: none of them can take a row which that categorisation left alone.
  for (const member of members) {
    const legs = txs.filter((t) => settled(t) && ownerOf(t.accountId) === member).map((t) => ({ ...t, categorySource: "default" as const }));
    link(pairTransfers(legs, accounts.filter((a) => ownerOf(a.id) === member)).pairs);
  }
  // The rows of two members were never looked at together: money out of one member's account pairs with money into
  // another member's. Two rows of one member stay unpaired, as that member's categorisation left them (a payment
  // that came back and an equal sum on another account, say), and so does a row that returns a payment.
  const between = new Set<string>();
  if (members.length > 1) {
    const open = txs.filter((t) => !settled(t) && t.categorySource !== "match");
    for (const member of members) {
      const found = pairTransfers(open.filter((t) => !otherLeg.has(t.id) && t.amountCents < 0 === (ownerOf(t.accountId) === member)), accounts);
      link(found.pairs);
      for (const id of found.transfers) between.add(id);
    }
    // Money into a card is stored as a transfer whoever paid it. The leg that reached a card and has no other leg
    // among its member's rows in the view was paid from elsewhere: by another member's account, or by a joint account
    // that is in the view as the viewer's own copy. A payment of that sum which another member's categorisation, with
    // no card to pair it with, left open is the card's bill. Only what the open rows left unpaired is looked at, and
    // never two rows of one member.
    const onCard = (t: T) => accountById.get(t.accountId)?.type === "credit_card";
    const reached = txs.filter((t) => settled(t) && t.amountCents > 0 && onCard(t)).map((t) => ({ ...t, categorySource: "default" as const }));
    for (const member of reached.length ? members : []) {
      const unpaid = reached.filter((t) => !otherLeg.has(t.id) && ownerOf(t.accountId) !== member);
      link(pairTransfers([...open.filter((t) => !otherLeg.has(t.id) && t.amountCents < 0 && ownerOf(t.accountId) === member), ...unpaid], accounts).pairs);
    }
  }
  /** The account at the other end of a movement inside the household, when the rows tell it: the paired leg's, else the one the row names by its IBAN. */
  const otherEnd = (t: T): string | undefined => {
    const paired = otherLeg.get(t.id);
    if (paired !== undefined) return paired;
    const named = byIban.get(normalizeIban(t.counterpartyIban) ?? "");
    if (named === undefined || named === t.accountId) return undefined;
    // a row its member's categorisation left a payment names an account of that member in vain
    return settled(t) || (between.has(t.id) && ownerOf(named) !== ownerOf(t.accountId)) ? named : undefined;
  };
  const fromHolder = (t: T): boolean => {
    const payer = t.counterparty ? nameOf(t.counterparty) : null;
    return !!payer && t.category === "p2p_in" && holdersIn(accountById.get(t.accountId)?.holder).some((holder) => samePerson(payer, holder.name));
  };
  const transfer = (t: T): T => (t.isTransfer ? t : { ...t, category: "transfer", isTransfer: true });

  const out: T[] = [];
  for (const t of txs) {
    const share = shares?.get(t.id);
    if (share !== undefined) {
      if (share.cents === 0) continue;
      const row = share.transfer && t.categorySource !== "user" ? transfer(t) : t;
      out.push({ ...row, amountCents: share.cents, wholeCents: t.amountCents, ...(share.openCents !== 0 ? { openCents: share.openCents } : {}) });
      continue;
    }
    const part = partIn(t.accountId);
    if (isNone(part)) continue;
    const joint = !isWhole(part);
    let row = t;
    if (t.categorySource !== "user") {
      const other = otherEnd(t);
      const paidIn = joint && t.amountCents > 0;
      if (other !== undefined && gone(other) && !paidIn) {
        row = { ...t, category: t.amountCents > 0 ? "p2p_in" : "p2p", categorySource: "rule", isTransfer: false };
        // no longer a movement between the viewer's own accounts: money between people, counted
        if (why) {
          const was = why.of(t.id).find((r) => r.rule === "transfer.pair");
          why.drop(t.id, "transfer.pair");
          why.add(t.id, { rule: "transfer.pair", people: true, ...(typeof was?.other === "string" ? { other: was.other } : {}) });
        }
      }
      else if (other !== undefined || (paidIn && fromHolder(t))) row = transfer(t);
    }
    if (joint && why) why.add(t.id, { rule: "part.use", from: part.from, to: part.to, of: part.of });
    out.push(joint ? { ...row, amountCents: partCents(row.amountCents, part), wholeCents: row.amountCents } : row);
  }
  return out;
}
