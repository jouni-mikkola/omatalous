/**
 * The rows a member typed in from a card statement (`statement_bill`, `statement_rows`): one header per bill and the rows
 * under it. Own rows only. A write bumps the user's data version, so the cached analysis is built again; the rows are read
 * by `createContext` (core `statement-explain.ts`), which is what makes them count, and by nothing else.
 */
import { bumpUserDataVersionStatement } from "../settings-repo.ts";
import type { Statement } from "../types.ts";
import type { FinanceContext } from "./context.ts";

interface StatementHeader {
  billId: string;
  accountKey: string;
  periodFrom: string;
  periodTo: string;
  statementCents: number | null;
  savedAt: string;
  detachedAt: string | null;
  detachedReason: string | null;
}

interface StatementRowRecord {
  id: string;
  day: string;
  cents: number;
  text: string;
  rowKey: string;
}

interface StoredStatement extends StatementHeader {
  rows: StatementRowRecord[];
}

export class StatementRepo {
  constructor(private readonly ctx: FinanceContext) {}

  /** The statements of the user, each with its rows by day. */
  async statementBills(): Promise<StoredStatement[]> {
    const { db, userId } = this.ctx;
    const heads = await db.all<Record<string, unknown>>(
      "SELECT bill_tx_id, account_key, period_from, period_to, statement_cents, saved_at, detached_at, detached_reason FROM statement_bill WHERE user_id = ? ORDER BY period_from, bill_tx_id",
      [userId],
    );
    const rows = await db.all<Record<string, unknown>>("SELECT id, bill_tx_id, day, cents, text, row_key FROM statement_rows WHERE user_id = ? ORDER BY day, row_key", [userId]);
    const by = new Map<string, StatementRowRecord[]>();
    for (const r of rows) {
      const list = by.get(String(r.bill_tx_id)) ?? [];
      list.push({ id: String(r.id), day: String(r.day), cents: Number(r.cents), text: String(r.text), rowKey: String(r.row_key) });
      by.set(String(r.bill_tx_id), list);
    }
    return heads.map((h) => ({
      billId: String(h.bill_tx_id),
      accountKey: String(h.account_key),
      periodFrom: String(h.period_from),
      periodTo: String(h.period_to),
      statementCents: h.statement_cents === null ? null : Number(h.statement_cents),
      savedAt: String(h.saved_at),
      detachedAt: h.detached_at === null ? null : String(h.detached_at),
      detachedReason: h.detached_reason === null ? null : String(h.detached_reason),
      rows: by.get(String(h.bill_tx_id)) ?? [],
    }));
  }

  /** Replaces the header and all rows of one bill in one transaction. A saved statement is attached again: why it was set aside is read anew. */
  async saveStatement(head: Pick<StatementHeader, "billId" | "accountKey" | "periodFrom" | "periodTo" | "statementCents">, rows: readonly StatementRowRecord[], at: string): Promise<void> {
    const { userId } = this.ctx;
    const statements: Statement[] = [
      { sql: "DELETE FROM statement_rows WHERE bill_tx_id = ? AND user_id = ?", params: [head.billId, userId] },
      {
        sql: `INSERT INTO statement_bill (bill_tx_id, user_id, account_key, period_from, period_to, statement_cents, saved_at, detached_at, detached_reason) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)
              ON CONFLICT (bill_tx_id) DO UPDATE SET account_key = excluded.account_key, period_from = excluded.period_from, period_to = excluded.period_to,
                statement_cents = excluded.statement_cents, saved_at = excluded.saved_at, detached_at = NULL, detached_reason = NULL
              WHERE statement_bill.user_id = excluded.user_id`,
        params: [head.billId, userId, head.accountKey, head.periodFrom, head.periodTo, head.statementCents, at],
      },
      ...rows.map((r): Statement => ({
        sql: "INSERT INTO statement_rows (id, bill_tx_id, account_key, user_id, day, cents, text, row_key, imported_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params: [r.id, head.billId, head.accountKey, userId, r.day, r.cents, r.text, r.rowKey, at],
      })),
      bumpUserDataVersionStatement(userId, at),
    ];
    await this.ctx.db.batch(statements);
  }

  /** Takes a bill's statement away, header and rows. False when the user has none for it. */
  async deleteStatement(billId: string, at: string): Promise<boolean> {
    const { db, userId } = this.ctx;
    const held = await db.all("SELECT 1 FROM statement_bill WHERE bill_tx_id = ? AND user_id = ?", [billId, userId]);
    if (!held.length) return false;
    await db.batch([{ sql: "DELETE FROM statement_bill WHERE bill_tx_id = ? AND user_id = ?", params: [billId, userId] }, bumpUserDataVersionStatement(userId, at)]);
    return true;
  }

  /** Marks a statement's rows as set aside (and why) or attached. Reading the rows does not depend on it, so no data version moves. */
  async setStatementDetached(billId: string, at: string | null, reason: string | null): Promise<void> {
    await this.ctx.db.run("UPDATE statement_bill SET detached_at = ?, detached_reason = ? WHERE bill_tx_id = ? AND user_id = ?", [at, reason, billId, this.ctx.userId]);
  }

  /** Which of the user's bills of the real account holds each row key among `keys`; the bill `except` is left out. */
  async rowKeyHolders(accountKey: string, keys: readonly string[], except: string): Promise<Map<string, string>> {
    if (!keys.length) return new Map();
    const marks = keys.map(() => "?").join(",");
    const found = await this.ctx.db.all<{ row_key: string; bill_tx_id: string }>(
      `SELECT row_key, bill_tx_id FROM statement_rows WHERE user_id = ? AND account_key = ? AND bill_tx_id <> ? AND row_key IN (${marks})`,
      [this.ctx.userId, accountKey, except, ...keys],
    );
    return new Map(found.map((r) => [r.row_key, r.bill_tx_id]));
  }

  /** The user's other bill of the real account whose period shares a day with the given one, if any. */
  async overlappingBill(accountKey: string, from: string, to: string, except: string): Promise<string | null> {
    const found = await this.ctx.db.all<{ bill_tx_id: string }>(
      "SELECT bill_tx_id FROM statement_bill WHERE user_id = ? AND account_key = ? AND bill_tx_id <> ? AND period_from <= ? AND period_to >= ? LIMIT 1",
      [this.ctx.userId, accountKey, except, to, from],
    );
    return found[0]?.bill_tx_id ?? null;
  }
}
