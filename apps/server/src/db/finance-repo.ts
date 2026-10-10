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
import { bumpUserDataVersionStatement, NEEDS_REPROCESS } from "./settings-repo.ts";
import { yieldToLoop } from "../yield.ts";
import type { Db, SqlValue, Statement } from "./types.ts";

/** Rows per read of a whole history, and statements per write transaction of derived data. */
const HISTORY_PAGE = 5000;
const WRITE_CHUNK = 2000;

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

/** What ingestion compares a stored row on: when, how much, where it came from and who it was with. */
export interface StoredParty {
  id: string;
  bookingDate: string;
  amountCents: number;
  source: string;
  merchant: string;
  counterparty: string | null;
  description: string | null;
  /** The bank-provided fields as `bankSignature` sums them up: equal to a fresh row's when nothing changed. */
  signature: string;
}

/**
 * The bank-provided fields of a transaction that its categories, flows and reports depend on. The raw payload
 * is left out: nothing derives from it, so a change in it alone is no reason to process the history again.
 */
export function bankSignature(t: {
  bookingDate: string;
  valueDate: string | null;
  amountCents: number;
  status: string;
  counterparty: string | null;
  counterpartyIban: string | null;
  description: string | null;
  reference: string | null;
  mcc: string | null;
  merchant: string;
}): string {
  return JSON.stringify([t.bookingDate, t.valueDate, t.amountCents, t.status, t.counterparty, t.counterpartyIban, t.description, t.reference, t.mcc, t.merchant]);
}

const signatureOf = (r: Row) =>
  bankSignature({
    bookingDate: String(r.booking_date),
    valueDate: str(r.value_date),
    amountCents: Number(r.amount_cents),
    status: String(r.status),
    counterparty: str(r.counterparty),
    counterpartyIban: str(r.counterparty_iban),
    description: str(r.description),
    reference: str(r.reference),
    mcc: str(r.mcc),
    merchant: String(r.merchant),
  });

const partyOf = (r: Row) => ({ merchant: String(r.merchant), counterparty: str(r.counterparty), description: str(r.description) });

export type NewAccount = Omit<StoredAccount, "userId" | "balanceCents" | "balanceAt" | "lastSyncedAt">;

/** A merchant whose spending no rule, code or register answer recognised. */
export interface UncategorisedMerchant {
  merchant: string;
  /** Money spent, positive cents (like the dashboard's merchant totals). */
  totalCents: number;
  count: number;
  lastDate: string;
}

/** Everything one merchant's rows add up to, for the summary above a merchant-filtered transaction list. */
export interface MerchantHistory {
  count: number;
  /** Money out and in over the whole history, positive cents. */
  outCents: number;
  inCents: number;
  firstDate: string;
  lastDate: string;
  /** Calendar months with at least one row. */
  months: number;
  /** The category most of its rows are in. */
  category: string;
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
  /**
   * The user's whole history, oldest first (date, then id). Read in pages by the last row seen, with the event
   * loop given back between pages: one query for 45 000 rows held every request for most of a second. A row
   * that changes between two pages is read in whichever state the page found it; the callers either rebuild
   * from a version they read first (the analysis cache) or write only what a guard allows (reprocess).
   */
  async allTransactions(): Promise<StoredTransaction[]> {
    const out: StoredTransaction[] = [];
    for await (const page of this.historyPages(HISTORY_PAGE, false)) out.push(...page.map(toTransaction));
    return out;
  }

  /** The history for the upgrade tasks: every row with the search text it has now, read once. */
  async allTransactionsWithSearchText(): Promise<(StoredTransaction & { searchText: string | null })[]> {
    const out: (StoredTransaction & { searchText: string | null })[] = [];
    for await (const page of this.historyPages(HISTORY_PAGE, true)) out.push(...page.map((r) => ({ ...toTransaction(r), searchText: str(r.search_text) })));
    return out;
  }

  private async *historyPages(size: number, withSearchText: boolean): AsyncGenerator<Row[]> {
    const columns = withSearchText ? `${TX_COLUMNS_LIGHT}, search_text` : TX_COLUMNS_LIGHT;
    let after: { date: string; id: string } | null = null;
    for (;;) {
      const rows: Row[] = after
        ? await this.db.all<Row>(
            `SELECT ${columns} FROM transactions WHERE user_id = ? AND (booking_date > ? OR (booking_date = ? AND id > ?)) ORDER BY booking_date, id LIMIT ?`,
            [this.userId, after.date, after.date, after.id, size],
          )
        : await this.db.all<Row>(`SELECT ${columns} FROM transactions WHERE user_id = ? ORDER BY booking_date, id LIMIT ?`, [this.userId, size]);
      if (rows.length) yield rows;
      if (rows.length < size) return;
      const last = rows[rows.length - 1]!;
      after = { date: String(last.booking_date), id: String(last.id) };
      await yieldToLoop();
    }
  }

  /** Every row of the given merchants, in the order `allTransactions` gives them. */
  async transactionsOfMerchants(merchants: readonly string[]): Promise<StoredTransaction[]> {
    const out: StoredTransaction[] = [];
    // keeps each statement well under SQLite's bound-parameter limit
    for (let i = 0; i < merchants.length; i += 500) {
      const chunk = merchants.slice(i, i + 500);
      const rows = await this.db.all<Row>(`SELECT ${TX_COLUMNS_LIGHT} FROM transactions WHERE user_id = ? AND merchant IN (${chunk.map(() => "?").join(",")})`, [this.userId, ...chunk]);
      out.push(...rows.map(toTransaction));
    }
    return out.sort((a, b) => (a.bookingDate < b.bookingDate ? -1 : a.bookingDate > b.bookingDate ? 1 : a.id < b.id ? -1 : 1));
  }

  /** The distinct merchant names of the user's rows. */
  async merchantNames(): Promise<string[]> {
    return (await this.db.all<{ merchant: string }>("SELECT merchant FROM transactions WHERE user_id = ? GROUP BY merchant", [this.userId])).map((r) => String(r.merchant));
  }

  /** Rows that returns matched (a refund, a friend's share) outside the given merchants: where they are, not what they are. */
  async matchedRowsOutside(merchants: readonly string[]): Promise<Pick<Transaction, "accountId" | "bookingDate" | "amountCents">[]> {
    const rows = await this.db.all<Row>("SELECT account_id, booking_date, amount_cents, merchant FROM transactions WHERE user_id = ? AND category_source = 'match'", [this.userId]);
    const inside = new Set(merchants);
    return rows.filter((r) => !inside.has(String(r.merchant))).map((r) => ({ accountId: String(r.account_id), bookingDate: String(r.booking_date), amountCents: Number(r.amount_cents) }));
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

  /**
   * The WHERE parts of a transaction filter for one side of the view: the user's own rows, or (household view)
   * the shared accounts' rows. The two sides never overlap, because a shared account belongs to another user.
   * Reading them apart lets each side use its own index and stop at the limit; one OR over both sorted every row.
   */
  private filterSide(f: TransactionFilter, side: { own: true } | { shared: readonly string[] }): { where: string[]; params: SqlValue[] } {
    const where: string[] = [];
    const params: SqlValue[] = [];
    const add = (condition: string, ...values: SqlValue[]) => {
      where.push(condition);
      params.push(...values);
    };
    if ("own" in side) add("user_id = ?", this.userId);
    else add(`user_id != ? AND account_id IN (${side.shared.map(() => "?").join(",")})`, this.userId, ...side.shared);
    if (f.from) add("booking_date >= ?", f.from);
    if (f.to) add("booking_date <= ?", f.to);
    if (f.accountId) add("account_id = ?", f.accountId);
    if (f.category) add("category = ?", f.category);
    if (f.merchant) add("merchant = ?", f.merchant);
    const q = f.q ? fold(f.q.trim()) : "";
    if (q) add("search_text LIKE ? ESCAPE '\\'", containsPattern(q));
    return { where, params };
  }

  private filterSides(f: TransactionFilter, accountIds?: readonly string[]) {
    // household view: own rows plus explicitly shared accounts (resolved by HouseholdRepo)
    const sides = [this.filterSide(f, { own: true })];
    if (accountIds?.length) sides.push(this.filterSide(f, { shared: accountIds }));
    return sides;
  }

  /** `limit` rows of the sides, newest first (date, then id), starting after `offset` rows or after the keyset row. */
  private async pageRows(sides: { where: string[]; params: SqlValue[] }[], limit: number, offset: number, after?: { date: string; id: string }): Promise<StoredTransaction[]> {
    const keyset = after ? " AND booking_date <= ? AND (booking_date < ? OR id > ?)" : "";
    const keysetParams = after ? [after.date, after.date, after.id] : [];
    const select = (side: { where: string[] }) => `SELECT ${TX_COLUMNS_LIGHT} FROM transactions WHERE ${side.where.join(" AND ")}${keyset} ORDER BY booking_date DESC, id LIMIT ?`;
    if (sides.length === 1) {
      const side = sides[0]!;
      return (await this.db.all<Row>(`${select(side)} OFFSET ?`, [...side.params, ...keysetParams, limit, offset])).map(toTransaction);
    }
    // each side is cut at offset + limit rows before the merge
    const params = sides.flatMap((side) => [...side.params, ...keysetParams, limit + offset]);
    const rows = await this.db.all<Row>(
      `SELECT * FROM (${sides.map((side) => `SELECT * FROM (${select(side)})`).join(" UNION ALL ")}) ORDER BY booking_date DESC, id LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    return rows.map(toTransaction);
  }

  async listTransactions(f: TransactionFilter, accountIds?: readonly string[]): Promise<{ total: number; inCents: number; outCents: number; items: StoredTransaction[] }> {
    const sides = this.filterSides(f, accountIds);
    // money in and out over every matching row, so the list says what the whole filter adds up to
    let total = 0;
    let inCents = 0;
    let outCents = 0;
    for (const side of sides) {
      const r = await this.db.first<{ c: number; inc: number | null; outc: number | null }>(
        `SELECT COUNT(*) AS c, SUM(CASE WHEN amount_cents > 0 THEN amount_cents END) AS inc, -SUM(CASE WHEN amount_cents < 0 THEN amount_cents END) AS outc FROM transactions WHERE ${side.where.join(" AND ")}`,
        side.params,
      );
      total += Number(r?.c ?? 0);
      inCents += Number(r?.inc ?? 0);
      outCents += Number(r?.outc ?? 0);
    }
    const items = await this.pageRows(sides, Math.min(Math.max(f.limit ?? 100, 1), 5000), Math.max(f.offset ?? 0, 0));
    return { total, inCents, outCents, items };
  }

  /**
   * One page of the same rows in the same order for the export: no count, and the next page starts after the
   * last row of this one (`after`), so a long history costs the same at its end as at its start.
   */
  async exportPage(f: TransactionFilter, accountIds: readonly string[] | undefined, limit: number, after?: { date: string; id: string }): Promise<StoredTransaction[]> {
    return this.pageRows(this.filterSides(f, accountIds), limit, 0, after);
  }

  /**
   * One merchant's whole history in one grouped read per side (own rows, shared accounts in the household view).
   * It runs on idx_tx_user_merchant_date, so it reads only that merchant's rows however long the history is.
   * The same rows as the transaction list filtered to the merchant, so the counts agree.
   */
  async merchantHistory(merchant: string, accountIds?: readonly string[]): Promise<MerchantHistory | null> {
    const months = new Set<string>();
    const categories = new Map<string, number>();
    let count = 0;
    let outCents = 0;
    let inCents = 0;
    let firstDate = "";
    let lastDate = "";
    for (const side of this.filterSides({ merchant }, accountIds)) {
      const rows = await this.db.all<{ category: string; m: string; n: number; inc: number | null; outc: number | null; first: string; last: string }>(
        `SELECT category, substr(booking_date, 1, 7) AS m, COUNT(*) AS n, SUM(CASE WHEN amount_cents > 0 THEN amount_cents END) AS inc,
                -SUM(CASE WHEN amount_cents < 0 THEN amount_cents END) AS outc, MIN(booking_date) AS first, MAX(booking_date) AS last
         FROM transactions INDEXED BY idx_tx_user_merchant_date WHERE ${side.where.join(" AND ")} GROUP BY category, m`,
        side.params,
      );
      for (const r of rows) {
        count += Number(r.n);
        inCents += Number(r.inc ?? 0);
        outCents += Number(r.outc ?? 0);
        months.add(r.m);
        categories.set(r.category, (categories.get(r.category) ?? 0) + Number(r.n));
        if (!firstDate || r.first < firstDate) firstDate = r.first;
        if (r.last > lastDate) lastDate = r.last;
      }
    }
    if (!count) return null;
    const category = [...categories].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0];
    return { count, outCents, inCents, firstDate, lastDate, months: months.size, category };
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
    const r = await this.db.first<Row>(`SELECT ${TX_COLUMNS_LIGHT} FROM transactions WHERE id = ? AND user_id = ?`, [id, this.userId]);
    return r ? toTransaction(r) : null;
  }

  /** Booked transactions in a date range, for duplicate detection. */
  async transactionKeys(accountId: string, from: string, to: string): Promise<StoredParty[]> {
    return (
      await this.db.all<Row>(
        "SELECT id, booking_date, value_date, amount_cents, status, source, merchant, counterparty, counterparty_iban, description, reference, mcc FROM transactions WHERE user_id = ? AND account_id = ? AND status = 'booked' AND booking_date BETWEEN ? AND ?",
        [this.userId, accountId, from, to],
      )
    ).map((r) => ({ id: String(r.id), bookingDate: String(r.booking_date), amountCents: Number(r.amount_cents), source: String(r.source), ...partyOf(r), signature: signatureOf(r) }));
  }

  /** Latest booked date from one source: CSV rows imported into a bank account must not move the bank's sync window. */
  async latestBookingDate(accountId: string, source: string): Promise<string | null> {
    const r = await this.db.first<{ d: string | null }>(
      "SELECT MAX(booking_date) AS d FROM transactions WHERE user_id = ? AND account_id = ? AND status = 'booked' AND source = ?",
      [this.userId, accountId, source],
    );
    return r?.d ?? null;
  }

  /** The account's pending rows: a booked row replaces one, and a category the user set on it moves along. */
  async pendingRows(accountId: string): Promise<(StoredParty & { category: string; categorySource: string })[]> {
    const rows = await this.db.all<Row>(
      "SELECT id, booking_date, value_date, amount_cents, status, source, merchant, counterparty, counterparty_iban, description, reference, mcc, category, category_source FROM transactions WHERE user_id = ? AND account_id = ? AND status = 'pending'",
      [this.userId, accountId],
    );
    return rows.map((r) => ({
      id: String(r.id),
      bookingDate: String(r.booking_date),
      amountCents: Number(r.amount_cents),
      source: String(r.source),
      ...partyOf(r),
      signature: signatureOf(r),
      category: String(r.category),
      categorySource: String(r.category_source),
    }));
  }

  deletePendingByIdStatement(accountId: string, id: string): Statement {
    return { sql: "DELETE FROM transactions WHERE id = ? AND user_id = ? AND account_id = ? AND status = 'pending'", params: [id, this.userId, accountId] };
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

  /**
   * Part of the batch that stores imported rows: the rows and "these still need categories" land together, so
   * a process killed before reprocess ran leaves the mark behind. The user's data version moves with the rows too.
   */
  unprocessedStatements(at: string): Statement[] {
    return [
      {
        sql: "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params: [`${NEEDS_REPROCESS}${this.userId}`, crypto.randomUUID(), at],
      },
      bumpUserDataVersionStatement(this.userId, at),
    ];
  }

  /** The mark's current value (null when nothing waits). */
  async unprocessedMark(): Promise<string | null> {
    return (await this.db.first<{ value: string }>("SELECT value FROM settings WHERE key = ?", [`${NEEDS_REPROCESS}${this.userId}`]))?.value ?? null;
  }

  /** Clears the mark only if it still has the value it had when reprocess began: rows imported meanwhile keep it set. */
  async clearUnprocessedMark(seen: string | null): Promise<void> {
    if (seen === null) return;
    await this.db.run("DELETE FROM settings WHERE key = ? AND value = ?", [`${NEEDS_REPROCESS}${this.userId}`, seen]);
  }

  deletePendingStatement(accountId: string): Statement {
    return { sql: "DELETE FROM transactions WHERE user_id = ? AND account_id = ? AND status = 'pending'", params: [this.userId, accountId] };
  }

  async batch(statements: Statement[]): Promise<void> {
    if (statements.length) await this.db.batch(statements);
  }

  /**
   * Writes derived data (categories, merchant names, search text) in transactions of a couple of thousand
   * statements, with the event loop given back in between. Each statement is idempotent and the run is repeated
   * by whoever started it, so a stop halfway costs nothing that the next run does not redo. Rows of an import
   * go through `batch` instead: those must land together.
   */
  async batchInChunks(statements: Statement[]): Promise<void> {
    for (let i = 0; i < statements.length; i += WRITE_CHUNK) {
      if (i) await yieldToLoop();
      await this.db.batch(statements.slice(i, i + WRITE_CHUNK));
    }
  }

  async updateEnrichment(txs: Pick<Transaction, "id" | "category" | "categorySource" | "isTransfer">[]): Promise<void> {
    await this.batchInChunks(
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
    await this.batchInChunks(
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
    return this.writeSearchText(
      rows.map((r) => ({ id: String(r.id), merchant: String(r.merchant), counterparty: str(r.counterparty), description: str(r.description), searchText: str(r.search_text) })),
    );
  }

  /** The same for rows a caller has read already (the upgrade tasks read a history once). */
  async writeSearchText(rows: readonly { id: string; merchant: string; counterparty: string | null; description: string | null; searchText: string | null }[]): Promise<number> {
    const stale: Statement[] = [];
    for (const r of rows) {
      const text = searchText(r);
      if (text !== r.searchText) stale.push({ sql: "UPDATE transactions SET search_text = ? WHERE id = ? AND user_id = ?", params: [text, r.id, this.userId] });
    }
    await this.batchInChunks(stale);
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

  /** Runs a killed process left as "running" end as failed; the header must not show their start as a success. */
  async failInterruptedSyncRuns(): Promise<number> {
    const r = await this.db.run(
      "UPDATE sync_runs SET status = 'failed', finished_at = ?, message = 'Haku keskeytyi, palvelin käynnistyi uudelleen.' WHERE user_id = ? AND status = 'running'",
      [new Date().toISOString(), this.userId],
    );
    return r.changes;
  }

  /** Keeps the newest `keep` runs of this user. */
  async pruneSyncRuns(keep = 200): Promise<void> {
    await this.db.run("DELETE FROM sync_runs WHERE user_id = ? AND id NOT IN (SELECT id FROM sync_runs WHERE user_id = ? ORDER BY id DESC LIMIT ?)", [this.userId, this.userId, keep]);
  }

  async listSyncRuns(limit = 20): Promise<SyncRun[]> {
    return (await this.db.all<Row>("SELECT * FROM sync_runs WHERE user_id = ? ORDER BY id DESC LIMIT ?", [this.userId, limit])).map(toSyncRun);
  }
}
