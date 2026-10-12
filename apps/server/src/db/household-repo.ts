/**
 * Cross-user reads for the household view. A user sees another member's
 * account only when its owner shared it (account_shares); sharing is
 * read-only and per account.
 */
import { accountBank, type Row, type StoredAccount, type StoredTransaction, TX_COLUMNS_LIGHT, toAccount, toTransaction } from "./rows.ts";
import type { Db } from "./types.ts";

export interface AccountShare {
  accountId: string;
  userId: string;
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
}
