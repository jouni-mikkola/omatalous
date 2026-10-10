/**
 * All financial data access for ONE user. Every query is filtered by the
 * user id given to the constructor, and every insert stores it, so services
 * holding a FinanceRepo cannot read or change another user's data by mistake.
 * Cross-user reads (household view) go through HouseholdRepo instead.
 */
import { type AccountType, type CategoryRule, fold, type IndustryCodeSet, type RuleField, type Transaction } from "@banking/core";
import {
  type Connection,
  type Row,
  type StoredAccount,
  type StoredTransaction,
  type SyncRun,
  str,
  TX_COLUMNS,
  TX_COLUMNS_LIGHT,
  toAccount,
  toConnection,
  toSyncRun,
  toTransaction,
} from "./rows.ts";
import type { Db, SqlValue, Statement } from "./types.ts";

export interface TransactionFilter {
  from?: string;
  to?: string;
  accountId?: string;
  category?: string;
  merchant?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

export type NewAccount = Omit<StoredAccount, "userId" | "balanceCents" | "balanceAt" | "lastSyncedAt">;

/** A merchant whose spending no rule, code or register answer recognised. */
export interface UncategorisedMerchant {
  merchant: string;
  /** Money spent, positive cents (like the dashboard's merchant totals). */
  totalCents: number;
  count: number;
  lastDate: string;
}

/** One merchant in the category settings. */
export interface MerchantSummary {
  merchant: string;
  /** The category most of its rows are in now. */
  category: string;
  count: number;
  /** Money out, positive cents. */
  totalCents: number;
  /** Money in, positive cents (a salary payer has only this). */
  inCents: number;
  lastDate: string;
  /** The "all of this merchant" rule, if the user made one. */
  rule: { id: number; category: string } | null;
  /** Rows in other categories than `category` (a bank: loan instalments and fees), most rows first. */
  otherCategories: { category: string; count: number; totalCents: number; inCents: number }[];
}

/**
 * What the transaction search matches: merchant, counterparty and
 * description folded, so case and the dots of ä, å, ö do not matter. One
 * line per field keeps a search from matching across two fields.
 */
export function searchText(t: Pick<Transaction, "merchant" | "counterparty" | "description">): string {
  return fold([t.merchant, t.counterparty, t.description].filter(Boolean).join("\n"));
}

/** A LIKE pattern for text anywhere in a value; `%`, `_` and `\` typed by the user are literal. */
const containsPattern = (text: string) => `%${text.replace(/[\\%_]/g, "\\$&")}%`;

/** Rules made with "all of this merchant". */
const MERCHANT_RULE_FIELDS = "('merchant', 'merchant_exact')";

export class FinanceRepo {
  constructor(
    private readonly db: Db,
    readonly userId: string,
  ) {}

  // ── accounts ─────────────────────────────────────────────
  async listAccounts(): Promise<StoredAccount[]> {
    return (await this.db.all<Row>("SELECT * FROM accounts WHERE user_id = ? ORDER BY created_at", [this.userId])).map(toAccount);
  }

  async getAccount(id: string): Promise<StoredAccount | null> {
    const r = await this.db.first<Row>("SELECT * FROM accounts WHERE id = ? AND user_id = ?", [id, this.userId]);
    return r ? toAccount(r) : null;
  }

  async upsertAccount(a: NewAccount): Promise<void> {
    // the WHERE on the update keeps an id collision from ever touching another user's row
    await this.db.run(
      `INSERT INTO accounts (id, user_id, connection_id, provider, external_id, identity, name, iban, currency, type, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET connection_id = excluded.connection_id, external_id = excluded.external_id,
         identity = COALESCE(excluded.identity, accounts.identity), name = excluded.name,
         iban = COALESCE(excluded.iban, accounts.iban), currency = excluded.currency
       WHERE accounts.user_id = excluded.user_id`,
      [a.id, this.userId, a.connectionId, a.provider, a.externalId, a.identity, a.name, a.iban, a.currency, a.type, new Date().toISOString()],
    );
  }

  async updateAccount(id: string, patch: { name?: string; type?: AccountType }): Promise<void> {
    await this.db.run("UPDATE accounts SET name = COALESCE(?, name), type = COALESCE(?, type) WHERE id = ? AND user_id = ?", [
      patch.name ?? null,
      patch.type ?? null,
      id,
      this.userId,
    ]);
  }

  /** Fills a missing IBAN only: an IBAN the bank sent is never replaced. */
  async setAccountIbanIfMissing(id: string, iban: string): Promise<void> {
    await this.db.run("UPDATE accounts SET iban = ? WHERE id = ? AND user_id = ? AND iban IS NULL", [iban, id, this.userId]);
  }

  /** Removes one account with its transactions (shares go with ON DELETE CASCADE). */
  async deleteAccount(id: string): Promise<void> {
    await this.db.batch([
      { sql: "DELETE FROM transactions WHERE user_id = ? AND account_id = ?", params: [this.userId, id] },
      { sql: "DELETE FROM accounts WHERE id = ? AND user_id = ?", params: [id, this.userId] },
    ]);
  }

  /** The rows of one account, as `allTransactions` gives them (for folding a CSV account into a bank account). */
  async transactionsOfAccount(accountId: string): Promise<StoredTransaction[]> {
    return (await this.db.all<Row>(`SELECT ${TX_COLUMNS_LIGHT} FROM transactions WHERE user_id = ? AND account_id = ? ORDER BY booking_date, id`, [this.userId, accountId])).map(toTransaction);
  }

  /**
   * Moves every row and share of account `from` to account `to` and removes `from`. `newIds` gives rows a new id
   * (ids derive from the account id). A row whose new id exists already in `to` is a duplicate and is dropped
   * with the old account.
   */
  async mergeAccountInto(from: string, to: string, newIds: ReadonlyMap<string, string>): Promise<void> {
    await this.db.batch([
      ...[...newIds].map(([oldId, newId]) => ({
        sql: "UPDATE OR IGNORE transactions SET id = ?, account_id = ? WHERE id = ? AND user_id = ? AND account_id = ?",
        params: [newId, to, oldId, this.userId, from],
      })),
      { sql: "UPDATE OR IGNORE transactions SET account_id = ? WHERE user_id = ? AND account_id = ?", params: [to, this.userId, from] },
      {
        sql: "INSERT OR IGNORE INTO account_shares (account_id, user_id, created_at) SELECT ?, user_id, created_at FROM account_shares WHERE account_id = ?",
        params: [to, from],
      },
      { sql: "DELETE FROM transactions WHERE user_id = ? AND account_id = ?", params: [this.userId, from] },
      { sql: "DELETE FROM accounts WHERE id = ? AND user_id = ?", params: [from, this.userId] },
    ]);
  }

  async setAccountBalance(id: string, cents: number, at: string): Promise<void> {
    await this.db.run("UPDATE accounts SET balance_cents = ?, balance_at = ? WHERE id = ? AND user_id = ?", [cents, at, id, this.userId]);
  }

  async markAccountSynced(id: string, at: string): Promise<void> {
    await this.db.run("UPDATE accounts SET last_synced_at = ? WHERE id = ? AND user_id = ?", [at, id, this.userId]);
  }

  /** Removes accounts (and through ON DELETE CASCADE their transactions and shares) of one provider. */
  async deleteProviderData(provider: string): Promise<void> {
    await this.db.batch([
      { sql: "DELETE FROM transactions WHERE user_id = ? AND account_id IN (SELECT id FROM accounts WHERE user_id = ? AND provider = ?)", params: [this.userId, this.userId, provider] },
      { sql: "DELETE FROM accounts WHERE user_id = ? AND provider = ?", params: [this.userId, provider] },
    ]);
  }

  // ── connections ──────────────────────────────────────────
  async listConnections(): Promise<Connection[]> {
    return (await this.db.all<Row>("SELECT * FROM connections WHERE user_id = ? ORDER BY created_at DESC", [this.userId])).map(toConnection);
  }

  async upsertConnection(c: Omit<Connection, "userId">): Promise<void> {
    await this.db.run(
      `INSERT INTO connections (id, user_id, provider, institution, country, status, valid_until, created_at, last_synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status = excluded.status, valid_until = excluded.valid_until
       WHERE connections.user_id = excluded.user_id`,
      [c.id, this.userId, c.provider, c.institution, c.country, c.status, c.validUntil, c.createdAt, c.lastSyncedAt],
    );
  }

  async setConnectionStatus(id: string, status: Connection["status"]): Promise<void> {
    await this.db.run("UPDATE connections SET status = ? WHERE id = ? AND user_id = ?", [status, id, this.userId]);
  }

  async markConnectionSynced(id: string, at: string): Promise<void> {
    await this.db.run("UPDATE connections SET last_synced_at = ? WHERE id = ? AND user_id = ?", [at, id, this.userId]);
  }

  // ── transactions ─────────────────────────────────────────
  async allTransactions(): Promise<StoredTransaction[]> {
    return (await this.db.all<Row>(`SELECT ${TX_COLUMNS_LIGHT} FROM transactions WHERE user_id = ? ORDER BY booking_date, id`, [this.userId])).map(toTransaction);
  }

  /** Spending rows nothing categorised: the input of the trade register lookup. */
  async uncategorisedSpending(): Promise<Pick<Transaction, "accountId" | "amountCents" | "isTransfer" | "categorySource" | "merchant" | "mcc" | "counterparty" | "counterpartyIban" | "description">[]> {
    const rows = await this.db.all<Row>(
      `SELECT account_id, amount_cents, merchant, mcc, counterparty, counterparty_iban, description FROM transactions
       WHERE user_id = ? AND category_source = 'default' AND amount_cents < 0 AND is_transfer = 0`,
      [this.userId],
    );
    return rows.map((r) => ({
      accountId: String(r.account_id),
      amountCents: Number(r.amount_cents),
      isTransfer: false,
      categorySource: "default" as const,
      merchant: String(r.merchant),
      mcc: r.mcc === null ? null : String(r.mcc),
      counterparty: r.counterparty === null ? null : String(r.counterparty),
      counterpartyIban: r.counterparty_iban === null ? null : String(r.counterparty_iban),
      description: r.description === null ? null : String(r.description),
    }));
  }

  async listTransactions(f: TransactionFilter, accountIds?: readonly string[]): Promise<{ total: number; inCents: number; outCents: number; items: StoredTransaction[] }> {
    const where: string[] = [];
    const params: SqlValue[] = [];
    const add = (condition: string, ...values: SqlValue[]) => {
      where.push(condition);
      params.push(...values);
    };
    if (accountIds) {
      // household view: own rows plus explicitly shared accounts (resolved by HouseholdRepo)
      add(`(user_id = ? OR account_id IN (${accountIds.map(() => "?").join(",") || "NULL"}))`, this.userId, ...accountIds);
    } else {
      add("user_id = ?", this.userId);
    }
    if (f.from) add("booking_date >= ?", f.from);
    if (f.to) add("booking_date <= ?", f.to);
    if (f.accountId) add("account_id = ?", f.accountId);
    if (f.category) add("category = ?", f.category);
    if (f.merchant) add("merchant = ?", f.merchant);
    const q = f.q ? fold(f.q.trim()) : "";
    if (q) add("search_text LIKE ? ESCAPE '\\'", containsPattern(q));
    const clause = `WHERE ${where.join(" AND ")}`;
    // money in and out over every matching row, so the list says what the whole filter adds up to
    const total = await this.db.first<{ c: number; inc: number | null; outc: number | null }>(
      `SELECT COUNT(*) AS c, SUM(CASE WHEN amount_cents > 0 THEN amount_cents END) AS inc, -SUM(CASE WHEN amount_cents < 0 THEN amount_cents END) AS outc FROM transactions ${clause}`,
      params,
    );
    const rows = await this.db.all<Row>(`SELECT ${TX_COLUMNS} FROM transactions ${clause} ORDER BY booking_date DESC, id LIMIT ? OFFSET ?`, [
      ...params,
      Math.min(Math.max(f.limit ?? 100, 1), 5000),
      Math.max(f.offset ?? 0, 0),
    ]);
    return { total: Number(total?.c ?? 0), inCents: Number(total?.inc ?? 0), outCents: Number(total?.outc ?? 0), items: rows.map(toTransaction) };
  }

  /** Money-out rows nothing recognised, per merchant, biggest spending first. */
  async uncategorisedMerchants(limit = 50): Promise<UncategorisedMerchant[]> {
    const rows = await this.db.all<{ merchant: string; total: number; n: number; last: string }>(
      `SELECT merchant, -SUM(amount_cents) AS total, COUNT(*) AS n, MAX(booking_date) AS last FROM transactions
       WHERE user_id = ? AND amount_cents < 0 AND category_source = 'default' AND category = 'other' AND is_transfer = 0
       GROUP BY merchant ORDER BY total DESC, merchant LIMIT ?`,
      [this.userId, limit],
    );
    return rows.map((r) => ({ merchant: String(r.merchant), totalCents: Number(r.total), count: Number(r.n), lastDate: String(r.last) }));
  }

  /**
   * The user's merchants, biggest spending first, for the category settings.
   * Transfers are left out because transfer detection decides those and a rule cannot.
   * `category` and `q` (matched on the folded name) narrow the list.
   */
  async merchantSummaries(f: { q?: string; category?: string; limit: number }): Promise<MerchantSummary[]> {
    // the first row of a merchant is its most common category
    const rows = await this.db.all<{ merchant: string; category: string; n: number; total: number; income: number; last: string }>(
      `SELECT merchant, category, COUNT(*) AS n, SUM(CASE WHEN amount_cents < 0 THEN -amount_cents ELSE 0 END) AS total,
              SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END) AS income, MAX(booking_date) AS last
       FROM transactions WHERE user_id = ? AND is_transfer = 0
       GROUP BY merchant, category ORDER BY merchant, n DESC, category`,
      [this.userId],
    );
    // rules come in the order they run, so the first one for a name is the one that applies
    const rules = new Map<string, { id: number; category: string }>();
    for (const r of await this.listRules()) {
      if ((r.field === "merchant" || r.field === "merchant_exact") && !rules.has(r.pattern)) rules.set(r.pattern, { id: r.id!, category: r.category });
    }
    const merchants = new Map<string, MerchantSummary>();
    for (const r of rows) {
      const m = merchants.get(r.merchant);
      if (!m) {
        merchants.set(r.merchant, {
          merchant: r.merchant,
          category: r.category,
          count: Number(r.n),
          totalCents: Number(r.total),
          inCents: Number(r.income),
          lastDate: r.last,
          rule: rules.get(r.merchant) ?? null,
          otherCategories: [],
        });
        continue;
      }
      // the total covers every category: the page shows the others, so a bank's loan instalments do not read as fees
      m.otherCategories.push({ category: r.category, count: Number(r.n), totalCents: Number(r.total), inCents: Number(r.income) });
      m.count += Number(r.n);
      m.totalCents += Number(r.total);
      m.inCents += Number(r.income);
      if (r.last > m.lastDate) m.lastDate = r.last;
    }
    const q = f.q ? fold(f.q.trim()) : "";
    return [...merchants.values()]
      .filter((m) => (!f.category || m.category === f.category) && (!q || fold(m.merchant).includes(q)))
      .sort((a, b) => b.totalCents - a.totalCents || b.inCents - a.inCents || b.count - a.count || a.merchant.localeCompare(b.merchant))
      .slice(0, f.limit);
  }

  async hasMerchant(merchant: string): Promise<boolean> {
    return (await this.db.first("SELECT 1 FROM transactions WHERE user_id = ? AND merchant = ? AND is_transfer = 0 LIMIT 1", [this.userId, merchant])) !== null;
  }

  async getTransaction(id: string): Promise<StoredTransaction | null> {
    const r = await this.db.first<Row>(`SELECT ${TX_COLUMNS} FROM transactions WHERE id = ? AND user_id = ?`, [id, this.userId]);
    return r ? toTransaction(r) : null;
  }

  /** Keys of booked transactions in a date range, for duplicate detection. */
  async transactionKeys(accountId: string, from: string, to: string): Promise<{ id: string; bookingDate: string; amountCents: number; source: string }[]> {
    return (
      await this.db.all<Row>(
        "SELECT id, booking_date, amount_cents, source FROM transactions WHERE user_id = ? AND account_id = ? AND status = 'booked' AND booking_date BETWEEN ? AND ?",
        [this.userId, accountId, from, to],
      )
    ).map((r) => ({ id: String(r.id), bookingDate: String(r.booking_date), amountCents: Number(r.amount_cents), source: String(r.source) }));
  }

  /** Latest booked date from one source: CSV rows imported into a bank account must not move the bank's sync window. */
  async latestBookingDate(accountId: string, source: string): Promise<string | null> {
    const r = await this.db.first<{ d: string | null }>(
      "SELECT MAX(booking_date) AS d FROM transactions WHERE user_id = ? AND account_id = ? AND status = 'booked' AND source = ?",
      [this.userId, accountId, source],
    );
    return r?.d ?? null;
  }

  /** Pending rows the user categorised by hand; their choice survives when the row is booked. */
  async userCategorisedPending(accountId: string): Promise<{ id: string; bookingDate: string; amountCents: number; merchant: string; category: string }[]> {
    const rows = await this.db.all<Row>(
      "SELECT id, booking_date, amount_cents, merchant, category FROM transactions WHERE user_id = ? AND account_id = ? AND status = 'pending' AND category_source = 'user'",
      [this.userId, accountId],
    );
    return rows.map((r) => ({
      id: String(r.id),
      bookingDate: String(r.booking_date),
      amountCents: Number(r.amount_cents),
      merchant: String(r.merchant),
      category: String(r.category),
    }));
  }

  /**
   * Inserts new transactions and refreshes bank-provided fields of existing
   * ones. Enrichment (category, transfer flag) is never overwritten here.
   */
  upsertStatements(txs: Omit<StoredTransaction, "userId">[], importedAt: string): Statement[] {
    return txs.map((t) => ({
      sql: `INSERT INTO transactions (${TX_COLUMNS}, search_text, imported_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET booking_date = excluded.booking_date, value_date = excluded.value_date,
              amount_cents = excluded.amount_cents, status = excluded.status, counterparty = excluded.counterparty,
              counterparty_iban = excluded.counterparty_iban, description = excluded.description,
              reference = excluded.reference, mcc = excluded.mcc, merchant = excluded.merchant, raw = excluded.raw,
              search_text = excluded.search_text
            WHERE transactions.user_id = excluded.user_id`,
      params: [
        t.id, this.userId, t.accountId, t.bookingDate, t.valueDate, t.amountCents, t.currency, t.status, t.counterparty,
        t.counterpartyIban, t.description, t.reference, t.mcc, t.merchant, t.category, t.categorySource,
        t.isTransfer ? 1 : 0, t.source, t.raw, searchText(t), importedAt,
      ],
    }));
  }

  deletePendingStatement(accountId: string): Statement {
    return { sql: "DELETE FROM transactions WHERE user_id = ? AND account_id = ? AND status = 'pending'", params: [this.userId, accountId] };
  }

  async batch(statements: Statement[]): Promise<void> {
    if (statements.length) await this.db.batch(statements);
  }

  async updateEnrichment(txs: Pick<Transaction, "id" | "category" | "categorySource" | "isTransfer">[]): Promise<void> {
    await this.batch(
      // a hand-set category is never written here, even one set between reprocess's read and this write
      txs.map((t) =>
        t.categorySource === "user"
          ? { sql: "UPDATE transactions SET is_transfer = ? WHERE id = ? AND user_id = ? AND category_source = 'user'", params: [t.isTransfer ? 1 : 0, t.id, this.userId] }
          : {
              sql: "UPDATE transactions SET category = ?, category_source = ?, is_transfer = ? WHERE id = ? AND user_id = ? AND category_source != 'user'",
              params: [t.category, t.categorySource, t.isTransfer ? 1 : 0, t.id, this.userId],
            },
      ),
    );
  }

  /** After an upgrade: stored merchant names re-derived with the current normalisation. */
  async updateMerchants(changes: { id: string; merchant: string }[]): Promise<void> {
    await this.batch(
      changes.map((c) => ({ sql: "UPDATE transactions SET merchant = ? WHERE id = ? AND user_id = ?", params: [c.merchant, c.id, this.userId] })),
    );
  }

  /**
   * Recomputes search_text where it differs from the stored fields: rows
   * written before it existed, merchant names re-derived by an upgrade, a
   * fold() that changed. Returns how many rows were written.
   */
  async refreshSearchText(): Promise<number> {
    const rows = await this.db.all<Row>("SELECT id, merchant, counterparty, description, search_text FROM transactions WHERE user_id = ?", [this.userId]);
    const stale: Statement[] = [];
    for (const r of rows) {
      const text = searchText({ merchant: String(r.merchant), counterparty: str(r.counterparty), description: str(r.description) });
      if (text !== r.search_text) stale.push({ sql: "UPDATE transactions SET search_text = ? WHERE id = ? AND user_id = ?", params: [text, String(r.id), this.userId] });
    }
    await this.batch(stale);
    return stale.length;
  }

  /** `null` hands the transaction back to the rules (they run right after). */
  async setUserCategory(id: string, category: string | null): Promise<void> {
    await this.db.run("UPDATE transactions SET category = COALESCE(?, category), category_source = ? WHERE id = ? AND user_id = ?", [
      category,
      category ? "user" : "default",
      id,
      this.userId,
    ]);
  }

  // ── trade register ───────────────────────────────────────
  /**
   * Register industry codes for the names this user's own lookups asked
   * about (merchant_industry_users). The register table is shared, but an
   * answer found for another member does not show up here.
   */
  async industryCodes(): Promise<Map<string, { code: string; codeSet: IndustryCodeSet }>> {
    const rows = await this.db.all<{ merchant: string; industry_code: string; code_set: string }>(
      `SELECT m.merchant, m.industry_code, m.code_set FROM merchant_industry m
       JOIN merchant_industry_users r ON r.merchant = m.merchant AND r.user_id = ?
       WHERE m.status = 'found' AND m.industry_code IS NOT NULL`,
      [this.userId],
    );
    const out = new Map<string, { code: string; codeSet: IndustryCodeSet }>();
    for (const r of rows) if (r.code_set === "TOL2008" || r.code_set === "TOL2025") out.set(r.merchant, { code: r.industry_code, codeSet: r.code_set });
    return out;
  }

  /**
   * Register details (business id, industry) for the transactions list:
   * names that this user's lookups, or those of `sharedOwners` (owners of
   * accounts shared with this user that are in view), asked about.
   */
  async industryDetails(
    merchants: readonly string[],
    sharedOwners: readonly string[] = [],
  ): Promise<Map<string, { companyName: string | null; businessId: string | null; label: string | null }>> {
    const out = new Map<string, { companyName: string | null; businessId: string | null; label: string | null }>();
    const owners = [...new Set([this.userId, ...sharedOwners])];
    const names = [...new Set(merchants)];
    // keeps each statement well under SQLite's bound-parameter limit
    const size = 99 - owners.length;
    if (size < 1) throw new Error("too many account owners for one statement");
    for (let i = 0; i < names.length; i += size) {
      const chunk = names.slice(i, i + size);
      const rows = await this.db.all<{ merchant: string; company_name: string | null; business_id: string | null; industry_label: string | null }>(
        `SELECT m.merchant, m.company_name, m.business_id, m.industry_label FROM merchant_industry m
         WHERE m.status = 'found' AND m.merchant IN (${chunk.map(() => "?").join(", ")})
           AND EXISTS (SELECT 1 FROM merchant_industry_users r WHERE r.merchant = m.merchant AND r.user_id IN (${owners.map(() => "?").join(", ")}))`,
        [...chunk, ...owners],
      );
      for (const r of rows) out.set(r.merchant, { companyName: r.company_name, businessId: r.business_id, label: r.industry_label });
    }
    return out;
  }

  // ── rules ────────────────────────────────────────────────
  async listRules(): Promise<CategoryRule[]> {
    return (await this.db.all<Row>("SELECT * FROM category_rules WHERE user_id = ? ORDER BY priority, id", [this.userId])).map((r) => ({
      id: Number(r.id),
      field: String(r.field) as RuleField,
      pattern: String(r.pattern),
      category: String(r.category),
      priority: Number(r.priority),
    }));
  }

  async ruleCount(): Promise<number> {
    return (await this.db.first<{ n: number }>("SELECT count(*) AS n FROM category_rules WHERE user_id = ?", [this.userId]))?.n ?? 0;
  }

  async hasMerchantRule(merchant: string): Promise<boolean> {
    return (await this.db.first(`SELECT 1 FROM category_rules WHERE user_id = ? AND field IN ${MERCHANT_RULE_FIELDS} AND pattern = ?`, [this.userId, merchant])) !== null;
  }

  /**
   * "All of this merchant": one rule per merchant, the latest choice
   * replacing an earlier one (also a whole-word rule for exactly this name,
   * which older versions made). It matches the exact name only, so "Matti
   * Meikäläinen" does not catch "Mobilepay Matti Meikäläinen", and runs
   * before the other user rules (priority 5): a broader rule made earlier
   * must not keep the merchant's other rows in the old category.
   */
  async setMerchantRule(merchant: string, category: string): Promise<void> {
    await this.batch([
      { sql: `DELETE FROM category_rules WHERE user_id = ? AND field IN ${MERCHANT_RULE_FIELDS} AND pattern = ?`, params: [this.userId, merchant] },
      {
        sql: "INSERT INTO category_rules (user_id, field, pattern, category, priority, created_at) VALUES (?, 'merchant_exact', ?, ?, 5, ?)",
        params: [this.userId, merchant, category, new Date().toISOString()],
      },
    ]);
  }

  /** Back to automatic. Removes the merchant's "all of this merchant" rules and returns how many there were. */
  async deleteMerchantRules(merchant: string): Promise<number> {
    return (await this.db.run(`DELETE FROM category_rules WHERE user_id = ? AND field IN ${MERCHANT_RULE_FIELDS} AND pattern = ?`, [this.userId, merchant])).changes;
  }

  async addRule(rule: Omit<CategoryRule, "id">): Promise<void> {
    await this.db.run("INSERT INTO category_rules (user_id, field, pattern, category, priority, created_at) VALUES (?, ?, ?, ?, ?, ?)", [
      this.userId,
      rule.field,
      rule.pattern,
      rule.category,
      rule.priority,
      new Date().toISOString(),
    ]);
  }

  /** Keeps "always this category for this merchant" rules working when a merchant's name is re-derived. */
  async renameMerchantRules(renames: ReadonlyMap<string, string>): Promise<void> {
    await this.batch(
      [...renames].map(([from, to]) => ({
        sql: `UPDATE category_rules SET pattern = ? WHERE user_id = ? AND field IN ${MERCHANT_RULE_FIELDS} AND pattern = ?`,
        params: [to, this.userId, from],
      })),
    );
  }

  async deleteRule(id: number): Promise<void> {
    await this.db.run("DELETE FROM category_rules WHERE id = ? AND user_id = ?", [id, this.userId]);
  }

  // ── sync runs ────────────────────────────────────────────
  async startSyncRun(trigger: string): Promise<number> {
    const r = await this.db.first<{ id: number }>(
      "INSERT INTO sync_runs (user_id, trigger, started_at, status) VALUES (?, ?, ?, 'running') RETURNING id",
      [this.userId, trigger, new Date().toISOString()],
    );
    return Number(r?.id);
  }

  async finishSyncRun(id: number, r: Pick<SyncRun, "status" | "fetched" | "inserted" | "message">): Promise<void> {
    await this.db.run("UPDATE sync_runs SET finished_at = ?, status = ?, fetched = ?, inserted = ?, message = ? WHERE id = ? AND user_id = ?", [
      new Date().toISOString(),
      r.status,
      r.fetched,
      r.inserted,
      r.message,
      id,
      this.userId,
    ]);
  }

  async listSyncRuns(limit = 20): Promise<SyncRun[]> {
    return (await this.db.all<Row>("SELECT * FROM sync_runs WHERE user_id = ? ORDER BY id DESC LIMIT ?", [this.userId, limit])).map(toSyncRun);
  }
}
