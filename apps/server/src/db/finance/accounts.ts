/** The user's accounts: the list, the bank's fields, balances, and removing or merging an account with its rows. */
import type { AccountType } from "@banking/core";
import { accountBank, type Row, type StoredAccount, type StoredTransaction, toAccount, toTransaction, TX_COLUMNS_LIGHT } from "../rows.ts";
import type { FinanceContext } from "./context.ts";

/**
 * What a link, an import or the demo writes. `name` is the bank's own name for the account (what `bankName` reads
 * back); the user's name is set apart with `updateAccount` and no link or sync touches it.
 */
export type NewAccount = Pick<StoredAccount, "id" | "connectionId" | "provider" | "externalId" | "identity" | "name" | "iban" | "currency" | "type"> &
  Partial<Pick<StoredAccount, "holder" | "cardMask" | "creditLimitCents">>;

/** `customName`: a name replaces the user's own, null takes it away (the bank's shows again), undefined leaves it. */
export interface AccountPatch {
  customName?: string | null;
  type?: AccountType;
}

export class AccountsRepo {
  constructor(private readonly ctx: FinanceContext) {}

  async listAccounts(): Promise<StoredAccount[]> {
    return (await this.ctx.db.all<Row>(`SELECT accounts.*, ${accountBank("accounts")} FROM accounts WHERE user_id = ? ORDER BY created_at`, [this.ctx.userId])).map(toAccount);
  }

  async getAccount(id: string): Promise<StoredAccount | null> {
    const r = await this.ctx.db.first<Row>(`SELECT accounts.*, ${accountBank("accounts")} FROM accounts WHERE id = ? AND user_id = ?`, [id, this.ctx.userId]);
    return r ? toAccount(r) : null;
  }

  async upsertAccount(a: NewAccount): Promise<void> {
    // the WHERE on the update keeps an id collision from ever touching another user's row
    await this.ctx.db.run(
      `INSERT INTO accounts (id, user_id, connection_id, provider, external_id, identity, name, holder, card_mask, credit_limit_cents, iban, currency, type, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET connection_id = excluded.connection_id, external_id = excluded.external_id,
         identity = COALESCE(excluded.identity, accounts.identity), name = excluded.name,
         holder = COALESCE(excluded.holder, accounts.holder), card_mask = COALESCE(excluded.card_mask, accounts.card_mask),
         credit_limit_cents = COALESCE(excluded.credit_limit_cents, accounts.credit_limit_cents),
         iban = COALESCE(excluded.iban, accounts.iban), currency = excluded.currency
       WHERE accounts.user_id = excluded.user_id`,
      [
        a.id, this.ctx.userId, a.connectionId, a.provider, a.externalId, a.identity, a.name,
        a.holder ?? null, a.cardMask ?? null, a.creditLimitCents ?? null, a.iban, a.currency, a.type, new Date().toISOString(),
      ],
    );
  }

  /** The user's own edits: the name apart from the bank's, and the type (which a link sets only the first time). */
  async updateAccount(id: string, patch: AccountPatch): Promise<void> {
    const name = patch.customName !== undefined;
    await this.ctx.db.run("UPDATE accounts SET custom_name = CASE WHEN ? THEN ? ELSE custom_name END, type = COALESCE(?, type) WHERE id = ? AND user_id = ?", [
      name ? 1 : 0,
      patch.customName ?? null,
      patch.type ?? null,
      id,
      this.ctx.userId,
    ]);
  }

  /**
   * The bank's side of an account, read again for one linked before these fields were stored. The name moves only when the
   * bank named the account; the holder is "" when the bank was asked and gave none, which is what stops asking again.
   * The user's own name and the type are not touched.
   */
  async setAccountBankDetails(id: string, d: { name: string | null; holder: string | null; cardMask: string | null; creditLimitCents: number | null }): Promise<void> {
    await this.ctx.db.run(
      "UPDATE accounts SET name = COALESCE(?, name), holder = ?, card_mask = COALESCE(?, card_mask), credit_limit_cents = COALESCE(?, credit_limit_cents) WHERE id = ? AND user_id = ?",
      [d.name, d.holder ?? "", d.cardMask, d.creditLimitCents, id, this.ctx.userId],
    );
  }

  /** Removes one account with its transactions (shares go with ON DELETE CASCADE). */
  async deleteAccount(id: string): Promise<void> {
    await this.ctx.db.batch([
      { sql: "DELETE FROM transactions WHERE user_id = ? AND account_id = ?", params: [this.ctx.userId, id] },
      { sql: "DELETE FROM accounts WHERE id = ? AND user_id = ?", params: [id, this.ctx.userId] },
    ]);
  }

  /** The rows of one account, as `allTransactions` gives them (for folding a CSV account into a bank account). */
  async transactionsOfAccount(accountId: string): Promise<StoredTransaction[]> {
    return (await this.ctx.db.all<Row>(`SELECT ${TX_COLUMNS_LIGHT} FROM transactions WHERE user_id = ? AND account_id = ? ORDER BY booking_date, id`, [this.ctx.userId, accountId])).map(toTransaction);
  }

  /**
   * Moves every row and share of account `from` to account `to` and removes `from`. `newIds` gives rows a new id
   * (ids derive from the account id). A row whose new id exists already in `to` is a duplicate and is dropped
   * with the old account.
   * A saved loan linked to `from` follows to `to`: the household said once that the two are one debt. An account has
   * one saved loan (`loans.ts`), so when a loan holds `to` already the one of `from` stays put and ends unlinked as
   * its account goes (ON DELETE SET NULL).
   */
  async mergeAccountInto(from: string, to: string, newIds: ReadonlyMap<string, string>): Promise<void> {
    await this.ctx.db.batch([
      ...[...newIds].map(([oldId, newId]) => ({
        sql: "UPDATE OR IGNORE transactions SET id = ?, account_id = ? WHERE id = ? AND user_id = ? AND account_id = ?",
        params: [newId, to, oldId, this.ctx.userId, from],
      })),
      { sql: "UPDATE OR IGNORE transactions SET account_id = ? WHERE user_id = ? AND account_id = ?", params: [to, this.ctx.userId, from] },
      {
        sql: "INSERT OR IGNORE INTO account_shares (account_id, user_id, created_at) SELECT ?, user_id, created_at FROM account_shares WHERE account_id = ?",
        params: [to, from],
      },
      {
        sql: "UPDATE loans SET account_id = ? WHERE user_id = ? AND account_id = ? AND NOT EXISTS (SELECT 1 FROM loans AS held WHERE held.user_id = ? AND held.account_id = ?)",
        params: [to, this.ctx.userId, from, this.ctx.userId, to],
      },
      { sql: "DELETE FROM transactions WHERE user_id = ? AND account_id = ?", params: [this.ctx.userId, from] },
      { sql: "DELETE FROM accounts WHERE id = ? AND user_id = ?", params: [from, this.ctx.userId] },
    ]);
  }

  async setAccountBalance(id: string, cents: number, at: string): Promise<void> {
    await this.ctx.db.run("UPDATE accounts SET balance_cents = ?, balance_at = ? WHERE id = ? AND user_id = ?", [cents, at, id, this.ctx.userId]);
  }

  /**
   * Accounts of type loan stored at a plus take it as a minus (`storedBalanceCents`, connectors/balance-sign.ts): what
   * an earlier version stored as the bank told it. Returns how many were turned; none is above zero after one run.
   */
  async negateLoanBalances(): Promise<number> {
    const r = await this.ctx.db.run("UPDATE accounts SET balance_cents = -balance_cents WHERE user_id = ? AND type = 'loan' AND balance_cents > 0", [this.ctx.userId]);
    return r.changes;
  }

  async markAccountSynced(id: string, at: string): Promise<void> {
    await this.ctx.db.run("UPDATE accounts SET last_synced_at = ? WHERE id = ? AND user_id = ?", [at, id, this.ctx.userId]);
  }

  /** Removes accounts (and through ON DELETE CASCADE their transactions and shares) of one provider. */
  async deleteProviderData(provider: string): Promise<void> {
    await this.ctx.db.batch([
      { sql: "DELETE FROM transactions WHERE user_id = ? AND account_id IN (SELECT id FROM accounts WHERE user_id = ? AND provider = ?)", params: [this.ctx.userId, this.ctx.userId, provider] },
      { sql: "DELETE FROM accounts WHERE user_id = ? AND provider = ?", params: [this.ctx.userId, provider] },
    ]);
  }
}
