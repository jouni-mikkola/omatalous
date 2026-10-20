/** The user's accounts: the list, the bank's fields, balances, and removing or merging an account with its rows. */
import type { AccountType } from "@banking/core";
import { accountBank, type Row, type StoredAccount, type StoredTransaction, toAccount, toTransaction, TX_COLUMNS_LIGHT } from "../rows.ts";
import { SWEEP_UNHELD_KEYS } from "../household-repo.ts";
import type { FinanceContext } from "./context.ts";

/**
 * What a link, an import or the demo writes. `name` is the bank's own name for the account (what `bankName` reads
 * back); the user's name is set apart with `updateAccount` and no link or sync touches it.
 */
export type NewAccount = Pick<StoredAccount, "id" | "connectionId" | "provider" | "externalId" | "identity" | "name" | "iban" | "currency" | "type"> &
  Partial<Pick<StoredAccount, "holder" | "cardMask" | "creditLimitCents" | BankField>> & {
    /** "user" when the link found a type stored before migration 0023 that was set by hand: it is kept and marked. */
    typeSource?: "bank" | "user";
  };

/** What the bank says the account is (migration 0023), as a link or a fetch reads it. */
type BankField = "bankTypeCode" | "bankUsage" | "bankProduct" | "psuStatus";

/** `customName`: a name replaces the user's own, null takes it away (the bank's shows again), undefined leaves it. */
export interface AccountPatch {
  customName?: string | null;
  type?: AccountType;
}

/** What a fetch reads of an account linked before these fields were stored (`readDetails` in sync.ts). */
type AccountBankDetails = Pick<StoredAccount, "holder" | "cardMask" | "creditLimitCents" | BankField> & {
  name: string | null;
  type: AccountType | null;
  /** "user" keeps the stored type as the user's: one set by hand before migration 0023. */
  typeSource: "bank" | "user";
};

export class AccountsRepo {
  constructor(private readonly ctx: FinanceContext) {}

  async listAccounts(): Promise<StoredAccount[]> {
    return (await this.ctx.db.all<Row>(`SELECT accounts.*, ${accountBank("accounts")} FROM accounts WHERE user_id = ? ORDER BY created_at`, [this.ctx.userId])).map(toAccount);
  }

  async getAccount(id: string): Promise<StoredAccount | null> {
    const r = await this.ctx.db.first<Row>(`SELECT accounts.*, ${accountBank("accounts")} FROM accounts WHERE id = ? AND user_id = ?`, [id, this.ctx.userId]);
    return r ? toAccount(r) : null;
  }

  /**
   * A link writes the bank's side again: its name, the fields it says of the account (each kept when the bank sends none
   * this time) and the type, unless the user chose the type (`type_source = 'user'`).
   */
  async upsertAccount(a: NewAccount): Promise<void> {
    // the WHERE on the update keeps an id collision from ever touching another user's row
    await this.ctx.db.run(
      `INSERT INTO accounts (id, user_id, connection_id, provider, external_id, identity, name, holder, card_mask, credit_limit_cents, iban, currency, type,
         bank_type_code, bank_usage, bank_product, psu_status, type_source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET connection_id = excluded.connection_id, external_id = excluded.external_id,
         identity = COALESCE(excluded.identity, accounts.identity), name = excluded.name,
         holder = COALESCE(excluded.holder, accounts.holder), card_mask = COALESCE(excluded.card_mask, accounts.card_mask),
         credit_limit_cents = COALESCE(excluded.credit_limit_cents, accounts.credit_limit_cents),
         iban = COALESCE(excluded.iban, accounts.iban), currency = excluded.currency,
         type = CASE WHEN accounts.type_source = 'user' THEN accounts.type ELSE excluded.type END,
         type_source = CASE WHEN accounts.type_source = 'user' THEN 'user' ELSE excluded.type_source END,
         bank_type_code = COALESCE(excluded.bank_type_code, accounts.bank_type_code), bank_usage = COALESCE(excluded.bank_usage, accounts.bank_usage),
         bank_product = COALESCE(excluded.bank_product, accounts.bank_product), psu_status = COALESCE(excluded.psu_status, accounts.psu_status)
       WHERE accounts.user_id = excluded.user_id`,
      [
        a.id, this.ctx.userId, a.connectionId, a.provider, a.externalId, a.identity, a.name,
        a.holder ?? null, a.cardMask ?? null, a.creditLimitCents ?? null, a.iban, a.currency, a.type,
        a.bankTypeCode ?? null, a.bankUsage ?? null, a.bankProduct ?? null, a.psuStatus ?? null, a.typeSource ?? "bank", new Date().toISOString(),
      ],
    );
  }

  /** The user's own edits: the name apart from the bank's, and the type, which no link or fetch changes after this. */
  async updateAccount(id: string, patch: AccountPatch): Promise<void> {
    const name = patch.customName !== undefined;
    await this.ctx.db.run(
      "UPDATE accounts SET custom_name = CASE WHEN ? THEN ? ELSE custom_name END, type = COALESCE(?, type), type_source = CASE WHEN ? IS NULL THEN type_source ELSE 'user' END WHERE id = ? AND user_id = ?",
      [name ? 1 : 0, patch.customName ?? null, patch.type ?? null, patch.type ?? null, id, this.ctx.userId],
    );
  }

  /**
   * The bank's side of an account, read again for one linked before these fields were stored. The name moves only when the
   * bank named the account; the holder is "" when the bank was asked and gave none, and so is the type code: either
   * stops asking again. The type is the one worked out from what the bank sent, unless the user chose it or the bank sent
   * nothing to tell it by. The user's own
   * name is not touched.
   */
  async setAccountBankDetails(id: string, d: AccountBankDetails): Promise<void> {
    await this.ctx.db.run(
      `UPDATE accounts SET name = COALESCE(?, name), holder = ?, card_mask = COALESCE(?, card_mask), credit_limit_cents = COALESCE(?, credit_limit_cents),
         bank_type_code = ?, bank_usage = COALESCE(?, bank_usage), bank_product = COALESCE(?, bank_product), psu_status = COALESCE(?, psu_status),
         type = CASE WHEN type_source = 'user' OR ? = 'user' THEN type ELSE COALESCE(?, type) END,
         type_source = CASE WHEN type_source = 'user' THEN 'user' ELSE ? END
       WHERE id = ? AND user_id = ?`,
      [d.name, d.holder ?? "", d.cardMask, d.creditLimitCents, d.bankTypeCode, d.bankUsage, d.bankProduct, d.psuStatus, d.typeSource, d.type, d.typeSource, id, this.ctx.userId],
    );
  }

  /** Removes one account with its transactions (shares go with ON DELETE CASCADE). */
  async deleteAccount(id: string): Promise<void> {
    await this.ctx.db.batch([
      { sql: "DELETE FROM transactions WHERE user_id = ? AND account_id = ?", params: [this.ctx.userId, id] },
      { sql: "DELETE FROM accounts WHERE id = ? AND user_id = ?", params: [id, this.ctx.userId] },
      ...SWEEP_UNHELD_KEYS,
    ]);
  }

  /** The rows of one account, as `allTransactions` gives them (for folding a CSV account into a bank account). */
  async transactionsOfAccount(accountId: string): Promise<StoredTransaction[]> {
    return (await this.ctx.db.all<Row>(`SELECT ${TX_COLUMNS_LIGHT} FROM transactions WHERE user_id = ? AND account_id = ? ORDER BY booking_date, id`, [this.ctx.userId, accountId])).map(toTransaction);
  }

  /**
   * Moves every row and share of account `from` to account `to` and removes `from`. `newIds` gives rows a new id
   * (ids derive from the account id). A row whose new id exists already in `to` is a duplicate and is dropped
   * with the old account, after its split and a category set by hand have moved to the kept row where that has none. The stored parts of a renamed row (`tx_part`) follow it.
   * A saved loan linked to `from` follows to `to`: the household said once that the two are one debt. An account has
   * one saved loan (`loans.ts`), so when a loan holds `to` already the one of `from` stays put and ends unlinked as
   * its account goes (ON DELETE SET NULL).
   */
  async mergeAccountInto(from: string, to: string, newIds: ReadonlyMap<string, string>): Promise<void> {
    await this.ctx.db.batch([
      // `tx_part` keys the row id without ON UPDATE: the check waits for the commit, and each renamed row's parts are
      // pointed at the new id before it
      { sql: "PRAGMA defer_foreign_keys = ON", params: [] },
      ...[...newIds].flatMap(([oldId, newId]) => [
        {
          sql: "UPDATE OR IGNORE transactions SET id = ?, account_id = ? WHERE id = ? AND user_id = ? AND account_id = ?",
          params: [newId, to, oldId, this.ctx.userId, from],
        },
        // only when the rename happened: a duplicate keeps its id and the kept row keeps its own parts
        {
          sql: "UPDATE tx_part SET tx_id = ? WHERE tx_id = ? AND NOT EXISTS (SELECT 1 FROM transactions WHERE id = ?) AND EXISTS (SELECT 1 FROM transactions WHERE id = ? AND user_id = ?)",
          params: [newId, oldId, oldId, newId, this.ctx.userId],
        },
        // a rename that was ignored left the file copy of a row `to` holds already. What the user said about the copy
        // moves to the kept row where that has nothing of its own: the split, and a category set by hand (with whether
        // it is a transfer, which a hand-set category owns). Then the copy goes, and is not moved beside the kept row
        // by the account update below.
        {
          sql: `UPDATE tx_part SET tx_id = ? WHERE tx_id = ? AND NOT EXISTS (SELECT 1 FROM tx_part WHERE tx_id = ?)
                AND EXISTS (SELECT 1 FROM transactions WHERE id = ? AND user_id = ? AND account_id = ?)
                AND EXISTS (SELECT 1 FROM transactions WHERE id = ? AND user_id = ? AND account_id = ?)`,
          params: [newId, oldId, newId, oldId, this.ctx.userId, from, newId, this.ctx.userId, to],
        },
        {
          sql: `UPDATE transactions SET
                  category = (SELECT c.category FROM transactions c WHERE c.id = ? AND c.user_id = ? AND c.account_id = ?),
                  category_source = 'user',
                  is_transfer = (SELECT c.is_transfer FROM transactions c WHERE c.id = ? AND c.user_id = ? AND c.account_id = ?)
                WHERE id = ? AND user_id = ? AND account_id = ? AND category_source != 'user'
                AND EXISTS (SELECT 1 FROM transactions c WHERE c.id = ? AND c.user_id = ? AND c.account_id = ? AND c.category_source = 'user')`,
          params: [oldId, this.ctx.userId, from, oldId, this.ctx.userId, from, newId, this.ctx.userId, to, oldId, this.ctx.userId, from],
        },
        { sql: "DELETE FROM transactions WHERE id = ? AND user_id = ? AND account_id = ?", params: [oldId, this.ctx.userId, from] },
      ]),
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
      // how far back the app asked for the account's rows goes to the kept account, the earlier of the two; the other's row goes with the sweep
      {
        sql: `INSERT INTO account_history (account_id, asked_from, first_row_day, source, recorded_at)
              SELECT ?, asked_from, first_row_day, source, recorded_at FROM account_history WHERE account_id = ? AND EXISTS (SELECT 1 FROM accounts WHERE id = ? AND user_id = ?)
              ON CONFLICT (account_id) DO UPDATE SET
                asked_from = MIN(account_history.asked_from, excluded.asked_from),
                first_row_day = CASE WHEN account_history.first_row_day IS NULL THEN excluded.first_row_day
                                     WHEN excluded.first_row_day IS NULL THEN account_history.first_row_day
                                     ELSE MIN(account_history.first_row_day, excluded.first_row_day) END`,
        params: [to, from, to, this.ctx.userId],
      },
      { sql: "DELETE FROM accounts WHERE id = ? AND user_id = ?", params: [from, this.ctx.userId] },
      ...SWEEP_UNHELD_KEYS,
    ]);
  }

  async setAccountBalance(id: string, cents: number | null, at: string | null): Promise<void> {
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
      ...SWEEP_UNHELD_KEYS,
    ]);
  }
}
