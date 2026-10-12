/**
 * Who uses an account, for the accounts a member sees: what the household said of the real account, else what the
 * bank's holder names give. A use is one statement for one real account, so a joint account both partners linked reads
 * the same on both copies. It never lets anybody see an account: that is the shares' matter.
 *
 * A member is matched to a holder by the name their own accounts give. Those names stay here: a response carries
 * display names, and a holder's name only on the account whose own line of holders already shows it.
 */
import { type AccountUse, type AccountUser, deriveUse, holdersIn, OTHER_HOLDER, type Part, partOf, saidUse, suggestWeights, type UseMember, userNameOf } from "@banking/core";
import { accountKey } from "../db/household-repo.ts";
import type { StoredAccount } from "../db/rows.ts";
import { NotFound, UserError } from "../platform/errors.ts";
import { strictObject } from "../platform/validate.ts";
import type { Services } from "./context.ts";

/** The use of an account and the viewer's part of it. */
interface UseInView {
  use: AccountUse;
  part: Part;
}

/** What a member says of one user: a user of the instance, or null for the holders who are none, and their weight. */
type SaidUser = Pick<AccountUser, "userId" | "weight">;

/** A household has a handful of people. */
const MAX_USERS = 8;
/** A million euros a month in cents: more than a part is ever typed as, and small enough that eight of them add up exactly. */
const MAX_WEIGHT = 100_000_000;

/**
 * The line of holders read for a real account: of its copies' lines the one that names the most holders, and of
 * those the first in order, so every copy reads the same line. A copy linked before holders were read must not make
 * its owner the only user while the partner's copy says two.
 */
function fullestLine(lines: readonly (string | null)[]): string | null {
  const count = (line: string | null) => holdersIn(line).length;
  return lines.reduce<string | null>((best, line) => (count(line) > count(best) || (count(line) === count(best) && (line ?? "") < (best ?? "")) ? line : best), null);
}

/**
 * The use and the viewer's part of each account in `accounts`, by account id. The accounts are ones the viewer may
 * see, their own and those shared with them: nothing here checks that, and nothing here widens it.
 */
export async function usesInView(s: Services, userId: string, accounts: readonly Pick<StoredAccount, "id" | "identity" | "holder">[]): Promise<Map<string, UseInView>> {
  if (!accounts.length) return new Map();
  const [said, held, users] = await Promise.all([s.household.useRows(accounts.map(accountKey)), s.household.heldAccounts(), s.users.list()]);
  const members: UseMember[] = users.map((u) => ({ id: u.id, label: u.displayName, name: userNameOf(held.filter((a) => a.userId === u.id)) }));
  return new Map(
    accounts.map((account) => {
      const key = accountKey(account);
      const copies = held.filter((a) => a.key === key);
      const linkedBy = [...new Set(copies.map((a) => a.userId))].sort();
      const holder = fullestLine(copies.map((a) => a.holder));
      const rows = said.filter((row) => row.key === key);
      const use = saidUse(rows, { holder }, linkedBy, members) ?? deriveUse({ holder }, linkedBy, members);
      // a holder's name is shown only where the viewer's own copy of the line has it
      const shown = holder === account.holder ? use : { ...use, users: use.users.map((u) => (u.userId === null ? { ...u, label: OTHER_HOLDER } : u)) };
      return [account.id, { use: shown, part: partOf(use, userId) }];
    }),
  );
}

/** The users a request names, checked: at most eight rows, each user once, whole weights, one of them above zero. */
export function parseSaidUsers(value: unknown): SaidUser[] {
  if (!Array.isArray(value) || value.length === 0) throw new UserError("Valitse tilille ainakin yksi käyttäjä.");
  if (value.length > MAX_USERS) throw new UserError("Tilillä voi olla enintään kahdeksan käyttäjää.");
  const users = value.map((row): SaidUser => {
    const { userId, weight } = strictObject(row, ["userId", "weight"] as const);
    if (userId !== null && (typeof userId !== "string" || !userId)) throw new UserError("Käyttäjää ei löydy.");
    if (typeof weight !== "number" || !Number.isInteger(weight) || weight < 0 || weight > MAX_WEIGHT) throw new UserError("Virheellinen osuus.");
    return { userId, weight };
  });
  if (new Set(users.map((u) => u.userId)).size !== users.length) throw new UserError("Sama käyttäjä on valittu kahdesti.");
  if (!users.some((u) => u.weight > 0)) throw new UserError("Ainakin yhdellä käyttäjällä pitää olla osuus.");
  return users;
}

/** An account the member linked. Another member's account looks the same as a missing one, also when it is shared with them. */
async function ownAccount(s: Services, userId: string, accountId: string): Promise<StoredAccount> {
  const account = await s.finance(userId).getAccount(accountId);
  if (!account) throw new NotFound("Tiliä ei löydy.");
  return account;
}

/** The real account behind an account the member linked. */
async function ownKey(s: Services, userId: string, accountId: string): Promise<string> {
  return accountKey(await ownAccount(s, userId, accountId));
}

/** A use changes the figures of everyone who sees the account, and of nobody else. */
async function bumpSeers(s: Services, key: string): Promise<void> {
  await Promise.all((await s.household.seenBy(key)).map((id) => s.settings.bumpUserDataVersion(id)));
}

/** Says who uses an account the member linked. It replaces what was said of the real account, by either partner. */
export async function sayAccountUse(s: Services, userId: string, accountId: string, users: readonly SaidUser[]): Promise<void> {
  const key = await ownKey(s, userId, accountId);
  const known = new Set((await s.users.list()).map((u) => u.id));
  if (users.some((u) => u.userId !== null && !known.has(u.userId))) throw new UserError("Käyttäjää ei löydy.");
  await s.household.setUse(key, users, userId, s.now().toISOString());
  await bumpSeers(s, key);
}

/** Takes back what was said of an account the member linked: its use follows the bank's holders again. */
export async function clearAccountUse(s: Services, userId: string, accountId: string): Promise<void> {
  const key = await ownKey(s, userId, accountId);
  await s.household.clearUse(key);
  await bumpSeers(s, key);
}

/**
 * What the page needs beside an account's use: the weights the bank's rows propose (null when the account has fewer than
 * two users, or its rows tell no habit), and the members the use names who cannot see the account (neither linked it nor
 * were given it), so the page can offer the share. Asked by the member who linked the account; no name leaves here.
 */
export async function suggestAccountUse(s: Services, userId: string, accountId: string): Promise<{ weights: SaidUser[] | null; unseen: string[] }> {
  const account = await ownAccount(s, userId, accountId);
  const key = accountKey(account);
  const use = (await usesInView(s, userId, [account])).get(account.id)!.use;
  const using = use.users.filter((u) => u.weight > 0);
  const seen = new Set(await s.household.seenBy(key));
  const unseen = using.flatMap((u) => (u.userId !== null && !seen.has(u.userId) ? [u.userId] : []));
  if (using.length < 2) return { weights: null, unseen };
  const [held, own, shared] = await Promise.all([s.household.heldAccounts(), s.finance(userId).listAccounts(), s.household.sharedWith(userId)]);
  // the accounts in view a user pays from: the member's own, and those shared with the member; never this account itself
  const inView = [...own, ...shared].filter((a) => accountKey(a) !== key);
  const payers = use.users.map((u) => {
    // a holder who is no member has no accounts here: the bank's line of holders is the only name, when it is one person's
    const holders = u.userId === null && u.label !== OTHER_HOLDER ? holdersIn(u.label) : [];
    return {
      userId: u.userId,
      name: u.userId === null ? (holders.length === 1 ? holders[0]!.name : null) : userNameOf(held.filter((a) => a.userId === u.userId)),
      ibans: inView.flatMap((a) => (a.userId === u.userId && a.iban ? [a.iban] : [])),
    };
  });
  return { weights: suggestWeights(await s.finance(userId).transactionsOfAccount(account.id), account, payers, s.today()), unseen };
}
