/**
 * A proposal for who uses a joint account at what weights: what each user paid into it a month. A household says a
 * use in euros a month for each user, and this reads those euros from the bank's rows, so one press can take them.
 * It proposes and decides nothing: it stores no use, and no figure reads its answer.
 */
import { billCents } from "./account-use.ts";
import { addMonths, monthOf } from "./dates.ts";
import { type Name, nameOf, samePerson } from "./person-names.ts";
import type { Account, AccountUser, IsoDate, Transaction } from "./types.ts";

/** A user of the account, as a row's payer is told to be them. */
interface Payer {
  userId: string | null;
  /** The name the user's own accounts give (`userNameOf`), null when they tell none. A payer of this name is the user. */
  name: Name | null;
  /** The IBANs of the accounts in view the user pays from: a row from one of them is the user's. */
  ibans: readonly string[];
}

/** The complete months before today's that are read. */
const MONTHS = 6;
/** Fewer months than this with money from two users tell no habit. */
const MIN_SHARED_MONTHS = 3;
/** Sums this close are equal parts, in percent of the larger: what an account has with no proposal. */
const EQUAL_WITHIN = 5;

const sameIban = (a: string, b: string) => a.replace(/\s/g, "").toUpperCase() === b.replace(/\s/g, "").toUpperCase();

/**
 * What each user paid into `account` a month, in cents, over the last six complete months before `today`, in the
 * order of `users`. Only rows that name their payer count: money from an account in view that is a user's, or from a
 * payer whose name is one user's and no other's. Money out of the account is not read: a transfer to a user's savings
 * is no payment taken back. A row is read at the bank's amount, also where it is cut to a part. The months run from
 * the first one somebody paid in, so an account linked four months ago tells four.
 *
 * Null when fewer than three of the months have money from two users, and when every sum is within 5 % of the
 * largest: equal parts need no proposal.
 */
export function suggestWeights(
  txs: readonly Pick<Transaction, "accountId" | "bookingDate" | "amountCents" | "wholeCents" | "counterparty" | "counterpartyIban">[],
  account: Pick<Account, "id">,
  users: readonly Payer[],
  today: IsoDate,
): Pick<AccountUser, "userId" | "weight">[] | null {
  const months = Array.from({ length: MONTHS }, (_, i) => addMonths(monthOf(today), i - MONTHS));
  const payerOf = (t: (typeof txs)[number]): number | null => {
    const iban = t.counterpartyIban;
    const paying = iban ? users.findIndex((u) => u.ibans.some((own) => sameIban(own, iban))) : -1;
    if (paying >= 0) return paying;
    const name = nameOf(t.counterparty ?? "");
    const named = users.flatMap((u, i) => (u.name !== null && samePerson(u.name, name) ? [i] : []));
    // two users of one name: the row cannot tell which of them paid
    return named.length === 1 ? named[0]! : null;
  };
  const paid = users.map(() => new Map<string, number>());
  for (const t of txs) {
    const month = monthOf(t.bookingDate);
    if (t.accountId !== account.id || !months.includes(month) || billCents(t) <= 0) continue;
    const sums = paid[payerOf(t) ?? -1];
    sums?.set(month, (sums.get(month) ?? 0) + billCents(t));
  }
  const shared = months.filter((m) => paid.filter((sums) => (sums.get(m) ?? 0) > 0).length >= 2);
  if (shared.length < MIN_SHARED_MONTHS) return null;
  const counted = months.slice(months.findIndex((m) => paid.some((sums) => sums.has(m))));
  const weights = paid.map((sums) => Math.round(counted.reduce((sum, m) => sum + (sums.get(m) ?? 0), 0) / counted.length));
  if (Math.min(...weights) * 100 >= Math.max(...weights) * (100 - EQUAL_WITHIN)) return null;
  return users.map((u, i) => ({ userId: u.userId, weight: weights[i]! }));
}
