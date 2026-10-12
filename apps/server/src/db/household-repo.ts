/**
 * Cross-user reads for the household view. A user sees another member's
 * account only when its owner shared it (account_shares); sharing is
 * read-only and per account. Who uses an account (account_use) is kept apart
 * from that: a use never lets anybody see an account.
 */
import { accountBank, type Row, type StoredAccount, type StoredTransaction, str, TX_COLUMNS_LIGHT, toAccount, toTransaction } from "./rows.ts";
import type { Db } from "./types.ts";

export interface AccountShare {
  accountId: string;
  userId: string;
}

/**
 * The real account an `accounts` row stands for: the bank's stable identity, or the row's own id when it has none (an
 * imported or a demo account). A joint account both partners linked is two rows with one key.
 */
export const accountKey = (a: Pick<StoredAccount, "id" | "identity">): string => a.identity ?? a.id;
/** The same key in SQL, for the accounts table named or aliased `a`. */
const keyOf = (a: string) => `COALESCE(${a}.identity, ${a}.id)`;

/** One user of a real account as the household said it. `userId` null: the holders who are no user of this instance. */
interface UseRow {
  key: string;
  userId: string | null;
  weight: number;
}

/** An account as the derivation of a use reads it: who linked it, which real account it is, and the bank's line of holders. */
interface HeldAccount {
  id: string;
  userId: string;
  key: string;
  holder: string | null;
}

export class HouseholdRepo {
  constructor(private readonly db: Db) {}

  /**
   * Accounts other members shared with `userId`, with the owner's display name. Each carries the bank of its own
   * connection for the analysis (whose price list applies to a card). A response leaves it out (routes/finance.ts).
   */
  async sharedWith(userId: string): Promise<(StoredAccount & { ownerName: string })[]> {
    const rows = await this.db.all<Row>(
      `SELECT a.*, ${accountBank("a")}, u.display_name AS owner_name FROM account_shares s
       JOIN accounts a ON a.id = s.account_id JOIN users u ON u.id = a.user_id
       WHERE s.user_id = ? AND a.user_id != ? ORDER BY u.display_name, a.name`,
      [userId, userId],
    );
    return rows.map((r) => ({ ...toAccount(r), ownerName: String(r.owner_name) }));
  }

  async transactionsOfAccounts(accountIds: readonly string[]): Promise<StoredTransaction[]> {
    if (!accountIds.length) return [];
    const marks = accountIds.map(() => "?").join(",");
    return (await this.db.all<Row>(`SELECT ${TX_COLUMNS_LIGHT} FROM transactions WHERE account_id IN (${marks}) ORDER BY booking_date, id`, [...accountIds])).map(toTransaction);
  }

  /** Shares of the owner's accounts (who sees what). */
  async sharesOf(ownerId: string): Promise<AccountShare[]> {
    return (
      await this.db.all<Row>("SELECT s.account_id, s.user_id FROM account_shares s JOIN accounts a ON a.id = s.account_id WHERE a.user_id = ?", [ownerId])
    ).map((r) => ({ accountId: String(r.account_id), userId: String(r.user_id) }));
  }

  /** Only the account's owner can share it; the INSERT … SELECT enforces that. Sharing twice is fine. */
  async share(ownerId: string, accountId: string, withUserId: string): Promise<boolean> {
    if (ownerId === withUserId) return false;
    await this.db.run(
      `INSERT OR IGNORE INTO account_shares (account_id, user_id, created_at)
       SELECT a.id, u.id, ? FROM accounts a, users u WHERE a.id = ? AND a.user_id = ? AND u.id = ?`,
      [new Date().toISOString(), accountId, ownerId, withUserId],
    );
    const shared = await this.db.first(
      "SELECT 1 FROM account_shares s JOIN accounts a ON a.id = s.account_id WHERE s.account_id = ? AND s.user_id = ? AND a.user_id = ?",
      [accountId, withUserId, ownerId],
    );
    return shared !== null;
  }

  async unshare(ownerId: string, accountId: string, withUserId: string): Promise<void> {
    await this.db.run("DELETE FROM account_shares WHERE account_id = ? AND user_id = ? AND account_id IN (SELECT id FROM accounts WHERE user_id = ?)", [
      accountId,
      withUserId,
      ownerId,
    ]);
  }

  /** What the household said of who uses these real accounts. A key with no row was never said, or was taken back. */
  async useRows(keys: readonly string[]): Promise<UseRow[]> {
    if (!keys.length) return [];
    const marks = keys.map(() => "?").join(",");
    return (await this.db.all<Row>(`SELECT account_key, user_id, weight FROM account_use WHERE account_key IN (${marks}) ORDER BY account_key, user_id IS NULL, user_id`, [...keys])).map(
      (r) => ({ key: String(r.account_key), userId: str(r.user_id), weight: Number(r.weight) }),
    );
  }

  /** Says who uses a real account. The rows replace what was said before, in one transaction, so a read never sees half of a statement. */
  async setUse(key: string, rows: readonly Pick<UseRow, "userId" | "weight">[], saidBy: string, at: string): Promise<void> {
    await this.db.batch([
      { sql: "DELETE FROM account_use WHERE account_key = ?", params: [key] },
      ...rows.map((r) => ({ sql: "INSERT INTO account_use (account_key, user_id, weight, said_by, said_at) VALUES (?, ?, ?, ?, ?)", params: [key, r.userId, r.weight, saidBy, at] })),
    ]);
  }

  /** Takes back what was said: the use is derived from the bank's holders again. */
  async clearUse(key: string): Promise<void> {
    await this.db.run("DELETE FROM account_use WHERE account_key = ?", [key]);
  }

  /**
   * Deletes a member, and with them their rows of `account_use` (the cascade). What they weighed is not lost to the
   * others first: on each real account where somebody else has a row too, it is added to the row of the holders who
   * are no user (made if there is none), so the ratio that was said stays. A weight of nothing moves nothing. Where
   * the member had the only row, the statement goes with them and the use is derived again. What was said of a real
   * account that nobody holds a copy of now (the member's was the last) goes too, so the next member who links it
   * starts without a statement. One transaction.
   */
  async removeMember(userId: string): Promise<void> {
    await this.db.batch([
      {
        sql: `INSERT INTO account_use (account_key, user_id, weight, said_by, said_at)
              SELECT account_key, NULL, weight, said_by, said_at FROM account_use
              WHERE user_id = ? AND weight > 0
                AND EXISTS (SELECT 1 FROM account_use o WHERE o.account_key = account_use.account_key AND o.user_id IS NOT ?)
              ON CONFLICT (account_key, COALESCE(user_id, '')) DO UPDATE SET weight = weight + excluded.weight`,
        params: [userId, userId],
      },
      { sql: "DELETE FROM users WHERE id = ?", params: [userId] },
      { sql: `DELETE FROM account_use WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE ${keyOf("a")} = account_use.account_key)` },
    ]);
  }

  /**
   * Every account of the instance with its holders, for deriving who uses an account: a member is matched to a holder
   * by the name their own accounts give. The ids tell which real account a loan of another member is paid from
   * (services/loans-in-view.ts). The names and the ids are compared on the server and are not for a response.
   */
  async heldAccounts(): Promise<HeldAccount[]> {
    return (await this.db.all<Row>(`SELECT a.id, a.user_id, ${keyOf("a")} AS account_key, a.holder FROM accounts a ORDER BY a.id`)).map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      key: String(r.account_key),
      holder: str(r.holder),
    }));
  }

  /** Everyone whose figures hold a real account: the members who linked it and the members it is shared with. */
  async seenBy(key: string): Promise<string[]> {
    const rows = await this.db.all<Row>(
      `SELECT a.user_id FROM accounts a WHERE ${keyOf("a")} = ?
       UNION SELECT s.user_id FROM account_shares s JOIN accounts a ON a.id = s.account_id WHERE ${keyOf("a")} = ?`,
      [key, key],
    );
    return rows.map((r) => String(r.user_id));
  }
}
