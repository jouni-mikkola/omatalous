/**
 * The user's transaction rows as ingestion and the pipeline use them: the whole history, one row, the keys that
 * duplicate detection compares, the statements of an import, and the writes of derived data (categories, merchant
 * names, search text). What the transaction list and the merchant pages read is in transaction-list.ts and
 * merchants.ts.
 */
import { fold, type Transaction } from "@banking/core";
import { yieldToLoop } from "../../platform/yield.ts";
import { type Row, type StoredTransaction, str, TX_COLUMNS, TX_COLUMNS_LIGHT, toTransaction } from "../rows.ts";
import { bumpUserDataVersionStatement, NEEDS_REPROCESS } from "../settings-repo.ts";
import type { Statement } from "../types.ts";
import { type FinanceContext, WRITE_CHUNK, writeBatch } from "./context.ts";

/** Rows per read of a whole history. */
const HISTORY_PAGE = 5000;

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
  bankTxnCode?: string | null;
  merchant: string;
}): string {
  return JSON.stringify([t.bookingDate, t.valueDate, t.amountCents, t.status, t.counterparty, t.counterpartyIban, t.description, t.reference, t.mcc, t.merchant, t.bankTxnCode ?? null]);
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
    bankTxnCode: str(r.bank_txn_code),
    merchant: String(r.merchant),
  });

/** An object or array SQLite's json_extract gave as text; a plain string that is no JSON gives null. */
const parsedJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const partyOf = (r: Row) => ({ merchant: String(r.merchant), counterparty: str(r.counterparty), description: str(r.description) });

/**
 * What the transaction search matches: merchant, counterparty and
 * description folded, so case and the dots of ä, å, ö do not matter. One
 * line per field keeps a search from matching across two fields.
 */
export function searchText(t: Pick<Transaction, "merchant" | "counterparty" | "description">): string {
  return fold([t.merchant, t.counterparty, t.description].filter(Boolean).join("\n"));
}

export class TransactionsRepo {
  constructor(private readonly ctx: FinanceContext) {}

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
        ? await this.ctx.db.all<Row>(
            `SELECT ${columns} FROM transactions WHERE user_id = ? AND (booking_date > ? OR (booking_date = ? AND id > ?)) ORDER BY booking_date, id LIMIT ?`,
            [this.ctx.userId, after.date, after.date, after.id, size],
          )
        : await this.ctx.db.all<Row>(`SELECT ${columns} FROM transactions WHERE user_id = ? ORDER BY booking_date, id LIMIT ?`, [this.ctx.userId, size]);
      if (rows.length) yield rows;
      if (rows.length < size) return;
      const last = rows[rows.length - 1]!;
      after = { date: String(last.booking_date), id: String(last.id) };
      await yieldToLoop();
    }
  }

  async getTransaction(id: string): Promise<StoredTransaction | null> {
    const r = await this.ctx.db.first<Row>(`SELECT ${TX_COLUMNS_LIGHT} FROM transactions WHERE id = ? AND user_id = ?`, [id, this.ctx.userId]);
    return r ? toTransaction(r) : null;
  }

  /** Booked transactions in a date range, for duplicate detection. */
  async transactionKeys(accountId: string, from: string, to: string): Promise<StoredParty[]> {
    return (
      await this.ctx.db.all<Row>(
        "SELECT id, booking_date, value_date, amount_cents, status, source, merchant, counterparty, counterparty_iban, description, reference, mcc, bank_txn_code FROM transactions WHERE user_id = ? AND account_id = ? AND status = 'booked' AND booking_date BETWEEN ? AND ?",
        [this.ctx.userId, accountId, from, to],
      )
    ).map((r) => ({ id: String(r.id), bookingDate: String(r.booking_date), amountCents: Number(r.amount_cents), source: String(r.source), ...partyOf(r), signature: signatureOf(r) }));
  }

  /** Latest booked date from one source: CSV rows imported into a bank account must not move the bank's sync window. */
  async latestBookingDate(accountId: string, source: string): Promise<string | null> {
    const r = await this.ctx.db.first<{ d: string | null }>(
      "SELECT MAX(booking_date) AS d FROM transactions WHERE user_id = ? AND account_id = ? AND status = 'booked' AND source = ?",
      [this.ctx.userId, accountId, source],
    );
    return r?.d ?? null;
  }

  /** The earliest booked date from one source: where the bank's history of the account is known to begin, as far as it has been asked. */
  async earliestBookingDate(accountId: string, source: string): Promise<string | null> {
    const r = await this.ctx.db.first<{ d: string | null }>(
      "SELECT MIN(booking_date) AS d FROM transactions WHERE user_id = ? AND account_id = ? AND status = 'booked' AND source = ?",
      [this.ctx.userId, accountId, source],
    );
    return r?.d ?? null;
  }

  /** The account's pending rows: a booked row replaces one, and a category the user set on it moves along. */
  async pendingRows(accountId: string): Promise<(StoredParty & { category: string; categorySource: string })[]> {
    const rows = await this.ctx.db.all<Row>(
      "SELECT id, booking_date, value_date, amount_cents, status, source, merchant, counterparty, counterparty_iban, description, reference, mcc, bank_txn_code, category, category_source FROM transactions WHERE user_id = ? AND account_id = ? AND status = 'pending'",
      [this.ctx.userId, accountId],
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

  /**
   * Inserts new transactions and refreshes bank-provided fields of existing
   * ones. Enrichment (category, transfer flag) is never overwritten here.
   */
  upsertStatements(txs: Omit<StoredTransaction, "userId">[], importedAt: string): Statement[] {
    return txs.map((t) => ({
      sql: `INSERT INTO transactions (${TX_COLUMNS}, search_text, imported_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET booking_date = excluded.booking_date, value_date = excluded.value_date,
              amount_cents = excluded.amount_cents, status = excluded.status, counterparty = excluded.counterparty,
              counterparty_iban = excluded.counterparty_iban, description = excluded.description,
              reference = excluded.reference, mcc = excluded.mcc, bank_txn_code = excluded.bank_txn_code,
              merchant = excluded.merchant, raw = excluded.raw, search_text = excluded.search_text
            WHERE transactions.user_id = excluded.user_id`,
      params: [
        t.id, this.ctx.userId, t.accountId, t.bookingDate, t.valueDate, t.amountCents, t.currency, t.status, t.counterparty,
        t.counterpartyIban, t.description, t.reference, t.mcc, t.bankTxnCode ?? null, t.merchant, t.category, t.categorySource,
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
        params: [`${NEEDS_REPROCESS}${this.ctx.userId}`, crypto.randomUUID(), at],
      },
      bumpUserDataVersionStatement(this.ctx.userId, at),
    ];
  }

  /** The mark's current value (null when nothing waits). */
  async unprocessedMark(): Promise<string | null> {
    return (await this.ctx.db.first<{ value: string }>("SELECT value FROM settings WHERE key = ?", [`${NEEDS_REPROCESS}${this.ctx.userId}`]))?.value ?? null;
  }

  /** Clears the mark only if it still has the value it had when reprocess began: rows imported meanwhile keep it set. */
  async clearUnprocessedMark(seen: string | null): Promise<void> {
    if (seen === null) return;
    await this.ctx.db.run("DELETE FROM settings WHERE key = ? AND value = ?", [`${NEEDS_REPROCESS}${this.ctx.userId}`, seen]);
  }

  deletePendingStatement(accountId: string): Statement {
    return { sql: "DELETE FROM transactions WHERE user_id = ? AND account_id = ? AND status = 'pending'", params: [this.ctx.userId, accountId] };
  }

  async batch(statements: Statement[]): Promise<void> {
    await writeBatch(this.ctx.db, statements);
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
      await this.ctx.db.batch(statements.slice(i, i + WRITE_CHUNK));
    }
  }

  /**
   * The categories of a reprocess in pieces with turns of the event loop between them (one transaction of 60 000 rows
   * holds every request for a second or more), and the user's data version bumped in the last piece. A list read in
   * between may show part of the new categories; the analysis is not built from such rows (`AnalysisCache`).
   */
  async updateEnrichment(txs: Pick<Transaction, "id" | "category" | "categorySource" | "isTransfer">[]): Promise<void> {
    // a hand-set category is never written here, even one set between reprocess's read and this write
    const rows = txs.map(
      (t): Statement =>
        t.categorySource === "user"
          ? { sql: "UPDATE transactions SET is_transfer = ? WHERE id = ? AND user_id = ? AND category_source = 'user'", params: [t.isTransfer ? 1 : 0, t.id, this.ctx.userId] }
          : {
              sql: "UPDATE transactions SET category = ?, category_source = ?, is_transfer = ? WHERE id = ? AND user_id = ? AND category_source != 'user'",
              params: [t.category, t.categorySource, t.isTransfer ? 1 : 0, t.id, this.ctx.userId],
            },
    );
    const bump = bumpUserDataVersionStatement(this.ctx.userId, new Date().toISOString());
    // the version goes with the last piece of rows, not in a piece of its own after another turn of the loop
    const last = rows.length ? rows.length - ((rows.length - 1) % WRITE_CHUNK) - 1 : 0;
    if (last) {
      await this.batchInChunks(rows.slice(0, last));
      await yieldToLoop();
    }
    await this.ctx.db.batch([...rows.slice(last), bump]);
  }

  /** After an upgrade: stored merchant names re-derived with the current normalisation. */
  async updateMerchants(changes: { id: string; merchant: string }[]): Promise<void> {
    await this.batchInChunks(
      changes.map((c) => ({ sql: "UPDATE transactions SET merchant = ? WHERE id = ? AND user_id = ?", params: [c.merchant, c.id, this.ctx.userId] })),
    );
  }

  /**
   * Recomputes search_text where it differs from the stored fields: rows
   * written before it existed, merchant names re-derived by an upgrade, a
   * fold() that changed. Returns how many rows were written.
   */
  async refreshSearchText(): Promise<number> {
    const rows = await this.ctx.db.all<Row>("SELECT id, merchant, counterparty, description, search_text FROM transactions WHERE user_id = ?", [this.ctx.userId]);
    return this.writeSearchText(
      rows.map((r) => ({ id: String(r.id), merchant: String(r.merchant), counterparty: str(r.counterparty), description: str(r.description), searchText: str(r.search_text) })),
    );
  }

  /**
   * Rows of one source fetched before `bank_txn_code` was stored: fills the column from one field of the bank's stored
   * payload, a page at a time. Only that field (`path`, a JSON path into `raw`) leaves the database and goes to
   * `codeOf`, so the payload is neither returned nor logged. A row whose field gives no code, or whose payload does
   * not parse, stays as it is. Returns how many rows got a code.
   */
  async fillBankCodes(source: string, path: string, codeOf: (field: unknown) => string | null): Promise<number> {
    let filled = 0;
    let after = "";
    for (;;) {
      const rows = await this.ctx.db.all<Row>(
        `SELECT id, CASE WHEN json_valid(raw) THEN json_extract(raw, ?) END AS field FROM transactions
         WHERE user_id = ? AND source = ? AND bank_txn_code IS NULL AND raw IS NOT NULL AND id > ? ORDER BY id LIMIT ?`,
        [path, this.ctx.userId, source, after, HISTORY_PAGE],
      );
      const writes: Statement[] = [];
      for (const r of rows) {
        const code = r.field == null ? null : codeOf(parsedJson(String(r.field)));
        if (code) writes.push({ sql: "UPDATE transactions SET bank_txn_code = ? WHERE id = ? AND user_id = ? AND bank_txn_code IS NULL", params: [code, String(r.id), this.ctx.userId] });
      }
      await this.batchInChunks(writes);
      filled += writes.length;
      if (rows.length < HISTORY_PAGE) return filled;
      after = String(rows[rows.length - 1]!.id);
      await yieldToLoop();
    }
  }

  /** The same for rows a caller has read already (the upgrade tasks read a history once). */
  async writeSearchText(rows: readonly { id: string; merchant: string; counterparty: string | null; description: string | null; searchText: string | null }[]): Promise<number> {
    const stale: Statement[] = [];
    for (const r of rows) {
      const text = searchText(r);
      if (text !== r.searchText) stale.push({ sql: "UPDATE transactions SET search_text = ? WHERE id = ? AND user_id = ?", params: [text, r.id, this.ctx.userId] });
    }
    await this.batchInChunks(stale);
    return stale.length;
  }

  /** `null` hands the transaction back to the rules (they run right after). */
  async setUserCategory(id: string, category: string | null): Promise<void> {
    await this.ctx.db.run("UPDATE transactions SET category = COALESCE(?, category), category_source = ? WHERE id = ? AND user_id = ?", [
      category,
      category ? "user" : "default",
      id,
      this.ctx.userId,
    ]);
  }
}
